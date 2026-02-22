// contract.ts — ZK Battleship
// Parses Soroban XDR directly. Never calls scValToNative (causes Bad union switch).

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

export const NO_SHOT = 4294967295;
export type SignTransaction = (xdrStr: string) => Promise<string>;

// ─── RPC singleton ────────────────────────────────────────────────────────────

let _server: SorobanRpc.Server | null = null;
async function getServer(): Promise<SorobanRpc.Server> {
  if (!_server) _server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  return _server;
}

// ─── Direct XDR field readers ─────────────────────────────────────────────────
// Read xdr.ScVal fields directly without scValToNative.
// scValToNative throws "Bad union switch: 4" on Soroban enum discriminants.

function svAddress(sv: xdr.ScVal | undefined): string {
  try {
    if (!sv) return '';
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
  try {
    if (!sv || sv.switch().value !== xdr.ScValType.scvU32().value) return fallback;
    return sv.u32();
  } catch { return fallback; }
}

function svBool(sv: xdr.ScVal | undefined): boolean {
  try {
    if (!sv || sv.switch().value !== xdr.ScValType.scvBool().value) return false;
    return sv.b();
  } catch { return false; }
}

function svBytes(sv: xdr.ScVal | undefined): string {
  try {
    if (!sv || sv.switch().value !== xdr.ScValType.scvBytes().value) return '';
    return '0x' + Buffer.from(sv.bytes()).toString('hex');
  } catch { return ''; }
}

// Build a key→ScVal lookup from a ScvMap
function svMap(sv: xdr.ScVal | undefined): Record<string, xdr.ScVal> {
  const out: Record<string, xdr.ScVal> = {};
  try {
    if (!sv || sv.switch().value !== xdr.ScValType.scvMap().value) return out;
    for (const entry of sv.map() ?? []) {
      let key = '';
      try {
        const k = entry.key();
        if (k.switch().value === xdr.ScValType.scvSymbol().value) key = k.sym().toString();
        else if (k.switch().value === xdr.ScValType.scvString().value) key = k.str().toString();
      } catch { continue; }
      if (key) out[key] = entry.val();
    }
  } catch { /* return partial */ }
  return out;
}

// Extract the variant name from a Soroban enum ScVal.
// Soroban encodes unit enums as ScvVec([ScvSymbol("Variant")]).
// They are NOT encoded as the raw discriminant integer —
// that only appears in the XDR union switch for XDR types, not contract types.
function svEnum(sv: xdr.ScVal | undefined): string {
  try {
    if (!sv) return '';
    const t = sv.switch().value;
    // Unit variant: Vec([Symbol("Name")])
    if (t === xdr.ScValType.scvVec().value) {
      const vec = sv.vec() ?? [];
      if (vec.length > 0 && vec[0].switch().value === xdr.ScValType.scvSymbol().value) {
        return vec[0].sym().toString();
      }
    }
    // Sometimes encoded as a bare symbol
    if (t === xdr.ScValType.scvSymbol().value) return sv.sym().toString();
    // Tuple/struct variant: Map({Name: payload})
    if (t === xdr.ScValType.scvMap().value) {
      const entries = sv.map() ?? [];
      if (entries.length > 0) {
        const k = entries[0].key();
        if (k.switch().value === xdr.ScValType.scvSymbol().value) return k.sym().toString();
      }
    }
    return '';
  } catch { return ''; }
}

// ─── State parser ─────────────────────────────────────────────────────────────

function parseGameState(retval: xdr.ScVal): GameState {
  const f = svMap(retval);

  let phase: GameState['phase'] = 'WaitingForPlayers';
  const v = svEnum(f['phase']);
  if (v === 'Commit') phase = 'Commit';
  else if (v === 'Playing') phase = 'Playing';
  else if (v === 'Finished') phase = 'Finished';

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

// ─── Simulate helper ──────────────────────────────────────────────────────────
// Runs a read-only contract call and returns the raw retval ScVal.
// Returns null on simulation error (contract not initialized, etc.)

async function simulate(method: string, args: xdr.ScVal[] = []): Promise<xdr.ScVal | null> {
  try {
    const server = await getServer();
    const contract = new Contract(CONTRACT_ID);
    const account = await server.getAccount(SIM_ACCOUNT);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ('error' in result) return null;
    const sim = result as SorobanRpc.Api.SimulateTransactionSuccessResponse;
    return sim.result?.retval ?? null;
  } catch {
    return null;
  }
}

// ─── fetchGameState ───────────────────────────────────────────────────────────

export async function fetchGameState(): Promise<GameState | null> {
  if (!CONTRACT_ID) return null;
  try {
    const retval = await simulate('get_state');
    if (!retval) return null;           // no state yet — contract uninitialized
    return parseGameState(retval);
  } catch (e) {
    console.debug('fetchGameState error (treating as empty):', e);
    return null;
  }
}

// ─── getPlayerStats ───────────────────────────────────────────────────────────

export async function getPlayerStats(address: string): Promise<PlayerStats | null> {
  try {
    if (!CONTRACT_ID || !isValidStellarAddress(address)) return null;
    const playerVal = new Address(address).toScVal();
    const retval = await simulate('get_player_stats', [playerVal]);
    if (!retval) return null;

    // Option<PlayerStats>: None → scvVoid
    if (retval.switch().value === xdr.ScValType.scvVoid().value) return null;

    // Some(x) — unwrap vec wrapper if present
    let statsSv = retval;
    if (retval.switch().value === xdr.ScValType.scvVec().value) {
      const vec = retval.vec() ?? [];
      if (vec.length === 0) return null;
      statsSv = vec[0];
    }

    const f = svMap(statsSv);
    return {
      games_played:         svU32(f['games_played']),
      games_won:            svU32(f['games_won']),
      total_shots_fired:    svU32(f['total_shots_fired']),
      total_shots_received: svU32(f['total_shots_received']),
      total_hits:           svU32(f['total_hits']),
    };
  } catch {
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

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidStellarAddress(addr: string | null | undefined): boolean {
  if (!addr || typeof addr !== 'string' || addr.length !== 56) return false;
  if (!addr.startsWith('G') && !addr.startsWith('C')) return false;
  try { new Address(addr); return true; } catch { return false; }
}

function requireAddress(addr: string | null | undefined, field = 'Address'): xdr.ScVal {
  if (!addr?.trim()) throw new Error(`${field} is required`);
  try { return new Address(addr.trim()).toScVal(); }
  catch { throw new Error(`${field} is not a valid Stellar address`); }
}

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

// ─── Contract functions ───────────────────────────────────────────────────────

export async function joinGame(
  playerAddress: string,
  signTx: SignTransaction,
): Promise<void> {
  // Pre-flight: check state but DON'T throw if fetchGameState fails —
  // the contract may have state we can't parse yet, but join_game itself
  // will succeed or give a clear error from the chain.
  try {
    const state = await fetchGameState();
    if (state) {
      if (state.phase !== 'WaitingForPlayers') {
        throw new Error(`Game already active (${state.phase}). Reset the contract first.`);
      }
      if (state.p1_joined && state.player1 === playerAddress) {
        throw new Error('You already joined as Player 1.');
      }
    }
    // If state is null: contract may be empty OR we couldn't parse it.
    // Either way, let the chain decide — join_game will panic with a clear message if needed.
  } catch (e) {
    // Only re-throw errors we explicitly created above
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('already active') || msg.includes('already joined')) throw e;
    // For parsing errors, proceed to the chain call
    console.debug('joinGame pre-flight failed (proceeding anyway):', e);
  }

  await invokeContract(
    'join_game',
    [requireAddress(playerAddress, 'Player')],
    playerAddress,
    signTx,
  );
}

export async function commitBoard(
  playerAddress: string,
  boardHashHex: string,
  signTx: SignTransaction,
): Promise<void> {
  const hashBytes = hexToBytes(boardHashHex);
  if (hashBytes.length !== 32) throw new Error(`Board hash must be 32 bytes, got ${hashBytes.length}`);
  await invokeContract(
    'commit_board',
    [requireAddress(playerAddress, 'Player'), xdr.ScVal.scvBytes(Buffer.from(hashBytes))],
    playerAddress,
    signTx,
  );
}

export async function fireShot(
  shooterAddress: string,
  x: number,
  y: number,
  signTx: SignTransaction,
): Promise<void> {
  await invokeContract(
    'fire_shot',
    [
      requireAddress(shooterAddress, 'Shooter'),
      nativeToScVal(x, { type: 'u32' }),
      nativeToScVal(y, { type: 'u32' }),
    ],
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
  await invokeContract(
    'submit_response',
    [
      requireAddress(defenderAddress, 'Defender'),
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
  await invokeContract(
    'reset_game',
    [requireAddress(callerAddress, 'Caller')],
    callerAddress,
    signTx,
  );
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