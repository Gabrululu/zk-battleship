// Contract interaction wrappers for ZK Battleship
// Uses @stellar/stellar-sdk to call the deployed Soroban contract.

import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
  StrKey,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = 'https://soroban-testnet.stellar.org';

export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? '';

export interface PlayerStats {
  games_played: number;
  games_won: number;
  total_shots_fired: number;
  total_shots_received: number;
  total_hits: number;
}

export interface GameState {
  player1: string;
  player2: string;
  board_hash_p1: string;
  board_hash_p2: string;
  hits_on_p1: number;
  hits_on_p2: number;
  shots_fired_p1: number;
  shots_fired_p2: number;
  turn: string;
  phase: 'WaitingForPlayers' | 'Commit' | 'Playing' | 'Finished';
  pending_shot_x: number;
  pending_shot_y: number;
  pending_shooter: string;
  winner: string;
  has_winner: boolean;
  p1_committed: boolean;
  p2_committed: boolean;
  p1_joined: boolean;
  p2_joined: boolean;
  session_id: number;
}

export const NO_SHOT = 4294967295; // u32::MAX

// ─── RPC client (lazy singleton) ─────────────────────────────────────────────

let _server: SorobanRpc.Server | null = null;

async function getServer(): Promise<SorobanRpc.Server> {
  if (!_server) {
    const { rpc } = await import('@stellar/stellar-sdk');
    _server = new rpc.Server(RPC_URL, { allowHttp: false });
  }
  return _server;
}

// ─── Validation helpers ──────────────────────────────────────────────────────

// Returns true if the address looks like a valid Stellar account address (G...)
// Does NOT throw — use isStellarAddress for safe checks.
function isStellarAddress(address: string | null | undefined): boolean {
  if (!address || typeof address !== 'string') return false;
  if (address.length !== 56) return false;
  if (!address.startsWith('G') && !address.startsWith('C')) return false;
  try {
    // Let the SDK validate the checksum
    new Address(address);
    return true;
  } catch {
    return false;
  }
}

// Throws only for write operations where an invalid address would waste gas
function validateStellarAddress(address: string | null | undefined, fieldName = 'Address'): void {
  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  // Defer full checksum validation to the Address constructor in each caller
}

// ─── Read state (no auth needed) ─────────────────────────────────────────────

export async function fetchGameState(): Promise<GameState | null> {
  if (!CONTRACT_ID) return null;
  try {
    const server = await getServer();
    const contract = new Contract(CONTRACT_ID);

    const tx = new TransactionBuilder(
      await server.getAccount('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'),
      { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(contract.call('get_state'))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ('error' in result) return null;

    const simResult = result as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    if (!simResult.result) return null;

    return parseGameState(simResult.result.retval);
  } catch {
    return null;
  }
}

function parseGameState(val: xdr.ScVal): GameState {
  const native = scValToNative(val) as Record<string, unknown>;

  const phaseRaw = native['phase'] as Record<string, unknown>;
  let phase: GameState['phase'] = 'WaitingForPlayers';
  if ('Commit' in phaseRaw) phase = 'Commit';
  else if ('Playing' in phaseRaw) phase = 'Playing';
  else if ('Finished' in phaseRaw) phase = 'Finished';

  return {
    player1: addressToStr(native['player1']),
    player2: addressToStr(native['player2']),
    board_hash_p1: bytesToHex(native['board_hash_p1'] as Uint8Array),
    board_hash_p2: bytesToHex(native['board_hash_p2'] as Uint8Array),
    hits_on_p1: Number(native['hits_on_p1']),
    hits_on_p2: Number(native['hits_on_p2']),
    shots_fired_p1: Number(native['shots_fired_p1'] ?? 0),
    shots_fired_p2: Number(native['shots_fired_p2'] ?? 0),
    turn: addressToStr(native['turn']),
    phase,
    pending_shot_x: Number(native['pending_shot_x']),
    pending_shot_y: Number(native['pending_shot_y']),
    pending_shooter: addressToStr(native['pending_shooter']),
    winner: addressToStr(native['winner']),
    has_winner: Boolean(native['has_winner']),
    p1_committed: Boolean(native['p1_committed']),
    p2_committed: Boolean(native['p2_committed']),
    p1_joined: Boolean(native['p1_joined']),
    p2_joined: Boolean(native['p2_joined']),
    session_id: Number(native['session_id'] ?? 0),
  };
}

function addressToStr(val: unknown): string {
  if (typeof val === 'string') {
    // Only return if it looks like a real Stellar address
    return val.length === 56 && (val.startsWith('G') || val.startsWith('C')) ? val : '';
  }
  if (val instanceof Uint8Array && val.length === 32) {
    try {
      return StrKey.encodeEd25519PublicKey(Buffer.from(val));
    } catch {
      return '';
    }
  }
  return '';
}

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(bytes: Uint8Array): string {
  if (!bytes) return '';
  return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Write operations (require wallet signing) ────────────────────────────────

export type SignTransaction = (xdr: string) => Promise<string>;

async function invokeContract(
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string,
  signTx: SignTransaction,
): Promise<void> {
  const server = await getServer();
  const contract = new Contract(CONTRACT_ID);
  const account = await server.getAccount(sourceAddress);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if ('error' in simResult) {
    const raw = (simResult as { error: string }).error ?? '';
    const match = raw.match(/value:String\("([^"]+)"\)/);
    if (match) throw new Error(match[1]);
    const clean = raw.replace(/\s+/g, ' ').slice(0, 200);
    throw new Error(clean || 'Contract simulation failed');
  }

  const { rpc: SRpc } = await import('@stellar/stellar-sdk');
  const assembled = SRpc.assembleTransaction(tx, simResult).build();
  const signedXdr = await signTx(assembled.toXDR());

  const { Transaction } = await import('@stellar/stellar-sdk');
  const signedTx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await server.sendTransaction(signedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(`Transaction failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  let attempts = 0;
  while (attempts < 20) {
    await sleep(1500);
    const status = await server.getTransaction(sendResult.hash);
    if (status.status === 'SUCCESS') return;
    if (status.status === 'FAILED') throw new Error('Transaction failed on-chain');
    attempts++;
  }
  throw new Error('Transaction confirmation timeout');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function parseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e['message'] === 'string') return e['message'];
    if (typeof e['error'] === 'string') return e['error'];
    if (typeof e['code'] !== 'undefined') return `Wallet error (code ${e['code']})`;
    const json = JSON.stringify(err);
    if (json !== '{}') return json;
  }
  return 'Unknown error';
}

// ─── Contract function wrappers ───────────────────────────────────────────────

export async function joinGame(
  playerAddress: string,
  signTx: SignTransaction,
): Promise<void> {
  validateStellarAddress(playerAddress, 'Player address');

  const state = await fetchGameState();
  if (state) {
    if (state.phase !== 'WaitingForPlayers') {
      throw new Error(`Game already in progress (phase: ${state.phase}). Reset the contract to start a new game.`);
    }
    if (state.p1_joined && state.player1 === playerAddress) {
      throw new Error('You already joined this game as Player 1.');
    }
  }

  let playerVal: xdr.ScVal;
  try {
    playerVal = new Address(playerAddress).toScVal();
  } catch {
    throw new Error('Invalid player address format');
  }

  await invokeContract('join_game', [playerVal], playerAddress, signTx);
}

export async function commitBoard(
  playerAddress: string,
  boardHashHex: string,
  signTx: SignTransaction,
): Promise<void> {
  validateStellarAddress(playerAddress, 'Player address');

  let playerVal: xdr.ScVal;
  try {
    playerVal = new Address(playerAddress).toScVal();
  } catch {
    throw new Error('Invalid player address format');
  }

  const hashBytes = hexToBytes(boardHashHex);
  if (hashBytes.length !== 32) {
    throw new Error(`Board hash must be 32 bytes, got ${hashBytes.length}`);
  }
  const hashVal = xdr.ScVal.scvBytes(Buffer.from(hashBytes));

  await invokeContract('commit_board', [playerVal, hashVal], playerAddress, signTx);
}

export async function fireShot(
  shooterAddress: string,
  x: number,
  y: number,
  signTx: SignTransaction,
): Promise<void> {
  validateStellarAddress(shooterAddress, 'Shooter address');

  let shooterVal: xdr.ScVal;
  try {
    shooterVal = new Address(shooterAddress).toScVal();
  } catch {
    throw new Error('Invalid shooter address format');
  }

  const xVal = nativeToScVal(x, { type: 'u32' });
  const yVal = nativeToScVal(y, { type: 'u32' });
  await invokeContract('fire_shot', [shooterVal, xVal, yVal], shooterAddress, signTx);
}

export async function submitResponse(
  defenderAddress: string,
  x: number,
  y: number,
  isHit: boolean,
  proofBytes: Uint8Array,
  signTx: SignTransaction,
): Promise<void> {
  validateStellarAddress(defenderAddress, 'Defender address');

  let defenderVal: xdr.ScVal;
  try {
    defenderVal = new Address(defenderAddress).toScVal();
  } catch {
    throw new Error('Invalid defender address format');
  }

  const xVal = nativeToScVal(x, { type: 'u32' });
  const yVal = nativeToScVal(y, { type: 'u32' });
  const isHitVal = nativeToScVal(isHit, { type: 'bool' });
  const proofVal = xdr.ScVal.scvBytes(Buffer.from(proofBytes));

  await invokeContract(
    'submit_response',
    [defenderVal, xVal, yVal, isHitVal, proofVal],
    defenderAddress,
    signTx,
  );
}

export async function resetGame(
  callerAddress: string,
  signTx: SignTransaction,
): Promise<void> {
  validateStellarAddress(callerAddress, 'Caller address');

  let callerVal: xdr.ScVal;
  try {
    callerVal = new Address(callerAddress).toScVal();
  } catch {
    throw new Error('Invalid caller address format');
  }

  await invokeContract('reset_game', [callerVal], callerAddress, signTx);
}

// ─── Player stats ─────────────────────────────────────────────────────────────

export async function getPlayerStats(address: string): Promise<PlayerStats | null> {
  // ── SAFE: never throws, always returns null on any failure ──
  try {
    if (!CONTRACT_ID) return null;

    // Guard: must look like a real Stellar address before hitting the network
    if (!isStellarAddress(address)) return null;

    let playerVal: xdr.ScVal;
    try {
      playerVal = new Address(address).toScVal();
    } catch {
      return null;
    }

    const server = await getServer();
    const contract = new Contract(CONTRACT_ID);

    const tx = new TransactionBuilder(
      await server.getAccount('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'),
      { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(contract.call('get_player_stats', playerVal))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ('error' in result) return null;

    const simResult = result as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    if (!simResult.result) return null;

    const native = scValToNative(simResult.result.retval);

    // Contract returns Option<PlayerStats> — if None, native is null/undefined
    if (!native || typeof native !== 'object') return null;

    const s = native as Record<string, unknown>;
    return {
      games_played: Number(s['games_played'] ?? 0),
      games_won: Number(s['games_won'] ?? 0),
      total_shots_fired: Number(s['total_shots_fired'] ?? 0),
      total_shots_received: Number(s['total_shots_received'] ?? 0),
      total_hits: Number(s['total_hits'] ?? 0),
    };
  } catch {
    // Never surface errors from a stats fetch — it's non-critical
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const padded = clean.padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}