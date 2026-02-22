// contract.ts — ZK Battleship
// Parses Soroban XDR directly without scValToNative to avoid
// "Bad union switch" errors on unknown enum discriminants.

import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  StrKey,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? '';

// Public read-only account for simulations (no signing needed)
const SIM_ACCOUNT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

// ─── Types ────────────────────────────────────────────────────────────────────

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

export type SignTransaction = (xdrStr: string) => Promise<string>;

// ─── RPC singleton ────────────────────────────────────────────────────────────

let _server: SorobanRpc.Server | null = null;

async function getServer(): Promise<SorobanRpc.Server> {
  if (!_server) {
    _server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  }
  return _server;
}

// ─── Safe primitive extractors ────────────────────────────────────────────────
// These never throw — return a default on any failure.

function safeNum(val: unknown, fallback = 0): number {
  try {
    const n = Number(val);
    return isNaN(n) ? fallback : n;
  } catch {
    return fallback;
  }
}

function safeBool(val: unknown): boolean {
  try { return Boolean(val); } catch { return false; }
}

// ─── Direct XDR parsers ───────────────────────────────────────────────────────
// We parse xdr.ScVal fields directly instead of calling scValToNative,
// which fails with "Bad union switch" on Soroban enum types.

function svAddress(sv: xdr.ScVal | undefined): string {
  if (!sv) return '';
  try {
    if (sv.switch().value !== xdr.ScValType.scvAddress().value) return '';
    const addr = sv.address();
    if (addr.switch().value === xdr.ScAddressType.scAddressTypeAccount().value) {
      return StrKey.encodeEd25519PublicKey(addr.accountId().ed25519());
    }
    if (addr.switch().value === xdr.ScAddressType.scAddressTypeContract().value) {
      return StrKey.encodeContract(addr.contractId());
    }
    return '';
  } catch { return ''; }
}

function svU32(sv: xdr.ScVal | undefined, fallback = 0): number {
  if (!sv) return fallback;
  try {
    if (sv.switch().value === xdr.ScValType.scvU32().value) return sv.u32();
    return fallback;
  } catch { return fallback; }
}

function svBool(sv: xdr.ScVal | undefined): boolean {
  if (!sv) return false;
  try {
    if (sv.switch().value === xdr.ScValType.scvBool().value) return sv.b();
    return false;
  } catch { return false; }
}

function svBytes(sv: xdr.ScVal | undefined): string {
  if (!sv) return '';
  try {
    if (sv.switch().value === xdr.ScValType.scvBytes().value) {
      return '0x' + Buffer.from(sv.bytes()).toString('hex');
    }
    return '';
  } catch { return ''; }
}

// Parse a ScvMap into a lookup by key symbol/string
function svMap(sv: xdr.ScVal | undefined): Record<string, xdr.ScVal> {
  const out: Record<string, xdr.ScVal> = {};
  if (!sv) return out;
  try {
    if (sv.switch().value !== xdr.ScValType.scvMap().value) return out;
    for (const entry of sv.map() ?? []) {
      let key = '';
      const k = entry.key();
      try {
        if (k.switch().value === xdr.ScValType.scvSymbol().value) key = k.sym().toString();
        else if (k.switch().value === xdr.ScValType.scvString().value) key = k.str().toString();
      } catch { continue; }
      if (key) out[key] = entry.val();
    }
  } catch { /* return partial */ }
  return out;
}

// Parse a Soroban enum (unit or tuple) — returns the variant name
// Soroban unit enums are encoded as ScvVec([ScvSymbol("Variant")])
// or sometimes ScvSymbol("Variant") directly.
function svEnumVariant(sv: xdr.ScVal | undefined): string {
  if (!sv) return '';
  try {
    const t = sv.switch().value;
    // Unit variant encoded as a vec with one symbol element
    if (t === xdr.ScValType.scvVec().value) {
      const vec = sv.vec() ?? [];
      if (vec.length > 0) {
        const first = vec[0];
        if (first.switch().value === xdr.ScValType.scvSymbol().value) {
          return first.sym().toString();
        }
      }
    }
    // Variant encoded directly as a symbol
    if (t === xdr.ScValType.scvSymbol().value) return sv.sym().toString();
    // Tuple variant encoded as a map with one key
    if (t === xdr.ScValType.scvMap().value) {
      const entries = sv.map() ?? [];
      if (entries.length > 0) {
        const k = entries[0].key();
        if (k.switch().value === xdr.ScValType.scvSymbol().value) {
          return k.sym().toString();
        }
      }
    }
    return '';
  } catch { return ''; }
}

// ─── State parser ─────────────────────────────────────────────────────────────

function parseGameState(retval: xdr.ScVal): GameState {
  const f = svMap(retval);

  let phase: GameState['phase'] = 'WaitingForPlayers';
  const variant = svEnumVariant(f['phase']);
  if (variant === 'Commit') phase = 'Commit';
  else if (variant === 'Playing') phase = 'Playing';
  else if (variant === 'Finished') phase = 'Finished';

  return {
    player1:         svAddress(f['player1']),
    player2:         svAddress(f['player2']),
    board_hash_p1:   svBytes(f['board_hash_p1']),
    board_hash_p2:   svBytes(f['board_hash_p2']),
    hits_on_p1:      svU32(f['hits_on_p1']),
    hits_on_p2:      svU32(f['hits_on_p2']),
    shots_fired_p1:  svU32(f['shots_fired_p1']),
    shots_fired_p2:  svU32(f['shots_fired_p2']),
    turn:            svAddress(f['turn']),
    phase,
    pending_shot_x:  svU32(f['pending_shot_x'], NO_SHOT),
    pending_shot_y:  svU32(f['pending_shot_y'], NO_SHOT),
    pending_shooter: svAddress(f['pending_shooter']),
    winner:          svAddress(f['winner']),
    has_winner:      svBool(f['has_winner']),
    p1_committed:    svBool(f['p1_committed']),
    p2_committed:    svBool(f['p2_committed']),
    p1_joined:       svBool(f['p1_joined']),
    p2_joined:       svBool(f['p2_joined']),
    session_id:      svU32(f['session_id']),
  };
}

// ─── fetchGameState ───────────────────────────────────────────────────────────

export async function fetchGameState(): Promise<GameState | null> {
  if (!CONTRACT_ID) return null;
  try {
    const server = await getServer();
    const contract = new Contract(CONTRACT_ID);

    const tx = new TransactionBuilder(
      await server.getAccount(SIM_ACCOUNT),
      { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(contract.call('get_state'))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ('error' in result) return null;

    const sim = result as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    if (!sim.result?.retval) return null;

    return parseGameState(sim.result.retval);
  } catch (e) {
    console.warn('fetchGameState:', e);
    return null;
  }
}

// ─── getPlayerStats ───────────────────────────────────────────────────────────

export async function getPlayerStats(address: string): Promise<PlayerStats | null> {
  try {
    if (!CONTRACT_ID || !isValidStellarAddress(address)) return null;

    const server = await getServer();
    const contract = new Contract(CONTRACT_ID);
    const playerVal = new Address(address).toScVal();

    const tx = new TransactionBuilder(
      await server.getAccount(SIM_ACCOUNT),
      { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(contract.call('get_player_stats', playerVal))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ('error' in result) return null;

    const sim = result as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    if (!sim.result?.retval) return null;

    const retval = sim.result.retval;

    // Option<PlayerStats>: None → scvVoid, Some(x) → scvVec([x]) or direct map
    if (retval.switch().value === xdr.ScValType.scvVoid().value) return null;

    let statsSv = retval;
    if (retval.switch().value === xdr.ScValType.scvVec().value) {
      const vec = retval.vec() ?? [];
      if (vec.length === 0) return null;
      statsSv = vec[0];
    }

    const f = svMap(statsSv);
    return {
      games_played:         safeNum(svU32(f['games_played'])),
      games_won:            safeNum(svU32(f['games_won'])),
      total_shots_fired:    safeNum(svU32(f['total_shots_fired'])),
      total_shots_received: safeNum(svU32(f['total_shots_received'])),
      total_hits:           safeNum(svU32(f['total_hits'])),
    };
  } catch (e) {
    console.warn('getPlayerStats:', e);
    return null;
  }
}

// ─── invokeContract ───────────────────────────────────────────────────────────

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
    const raw = String((simResult as { error: unknown }).error ?? '');
    const match = raw.match(/value:String\("([^"]+)"\)/) ??
                  raw.match(/Error\([^)]+\)[^:]*:\s*(.+?)(?:\n|$)/);
    throw new Error(match?.[1] ?? raw.slice(0, 300) ?? 'Contract simulation failed');
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  const signedXdrStr = await signTx(assembled.toXDR());

  const { Transaction } = await import('@stellar/stellar-sdk');
  const signedTx = new Transaction(signedXdrStr, NETWORK_PASSPHRASE);
  const sendResult = await server.sendTransaction(signedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const status = await server.getTransaction(sendResult.hash);
    if (status.status === 'SUCCESS') return;
    if (status.status === 'FAILED') throw new Error('Transaction failed on-chain');
  }
  throw new Error('Transaction confirmation timeout');
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function isValidStellarAddress(addr: string | null | undefined): boolean {
  if (!addr || typeof addr !== 'string' || addr.length !== 56) return false;
  if (!addr.startsWith('G') && !addr.startsWith('C')) return false;
  try { new Address(addr); return true; } catch { return false; }
}

function requireAddress(addr: string | null | undefined, field = 'Address'): xdr.ScVal {
  if (!addr?.trim()) throw new Error(`${field} is required`);
  try {
    return new Address(addr.trim()).toScVal();
  } catch {
    throw new Error(`${field} is not a valid Stellar address`);
  }
}

// ─── Public error helper ──────────────────────────────────────────────────────

export function parseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e['message'] === 'string') return e['message'];
    if (typeof e['error'] === 'string') return e['error'];
    const j = JSON.stringify(err);
    if (j !== '{}') return j.slice(0, 200);
  }
  return 'Unknown error';
}

// ─── Contract function wrappers ───────────────────────────────────────────────

export async function joinGame(
  playerAddress: string,
  signTx: SignTransaction,
): Promise<void> {
  const state = await fetchGameState();
  if (state && state.phase !== 'WaitingForPlayers') {
    throw new Error(
      `Contract has an active game (${state.phase}). Reset the contract first.`,
    );
  }
  if (state?.p1_joined && state.player1 === playerAddress) {
    throw new Error('You already joined as Player 1.');
  }
  const playerVal = requireAddress(playerAddress, 'Player address');
  await invokeContract('join_game', [playerVal], playerAddress, signTx);
}

export async function commitBoard(
  playerAddress: string,
  boardHashHex: string,
  signTx: SignTransaction,
): Promise<void> {
  const playerVal = requireAddress(playerAddress, 'Player address');
  const hashBytes = hexToBytes(boardHashHex);
  if (hashBytes.length !== 32) throw new Error(`Board hash must be 32 bytes, got ${hashBytes.length}`);
  const hashVal = xdr.ScVal.scvBytes(Buffer.from(hashBytes));
  await invokeContract('commit_board', [playerVal, hashVal], playerAddress, signTx);
}

export async function fireShot(
  shooterAddress: string,
  x: number,
  y: number,
  signTx: SignTransaction,
): Promise<void> {
  const shooterVal = requireAddress(shooterAddress, 'Shooter address');
  await invokeContract(
    'fire_shot',
    [shooterVal, nativeToScVal(x, { type: 'u32' }), nativeToScVal(y, { type: 'u32' })],
    shooterAddress,
    signTx,
  );
}

export async function submitResponse(
  defenderAddress: string,
  x: number,
  y: number,
  isHit: boolean,
  proofBytes: Uint8Array,
  signTx: SignTransaction,
): Promise<void> {
  const defenderVal = requireAddress(defenderAddress, 'Defender address');
  await invokeContract(
    'submit_response',
    [
      defenderVal,
      nativeToScVal(x, { type: 'u32' }),
      nativeToScVal(y, { type: 'u32' }),
      nativeToScVal(isHit, { type: 'bool' }),
      xdr.ScVal.scvBytes(Buffer.from(proofBytes)),
    ],
    defenderAddress,
    signTx,
  );
}

export async function resetGame(
  callerAddress: string,
  signTx: SignTransaction,
): Promise<void> {
  const callerVal = requireAddress(callerAddress, 'Caller address');
  await invokeContract('reset_game', [callerVal], callerAddress, signTx);
}

// ─── Hex helper ───────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const padded = clean.padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}