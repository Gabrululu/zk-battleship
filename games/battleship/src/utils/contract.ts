// contract.ts — ZK Battleship
// Uses raw fetch for RPC to bypass SDK's internal scValToNative
// which throws "Bad union switch: 4" on Soroban diagnostic events.

import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  StrKey,
  Transaction,
  Account,
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

// ─── RPC server (for getAccount + sendTransaction only) ──────────────────────

let _server: SorobanRpc.Server | null = null;
async function getServer(): Promise<SorobanRpc.Server> {
  if (!_server) _server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  return _server;
}

// ─── Raw RPC fetch ────────────────────────────────────────────────────────────
// We bypass SorobanRpc.Server.simulateTransaction() because it calls
// scValToNative() internally on diagnostic events, throwing "Bad union switch: 4".

interface RawSimResult {
  error?: string;
  results?: Array<{ xdr: string; auth: string[] }>;
  minResourceFee?: string;
  transactionData?: string;
  latestLedger?: string;
}

async function rawSimulate(txXdr: string): Promise<RawSimResult> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: { transaction: txXdr },
    }),
  });
  const json = await res.json() as { result?: RawSimResult; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? {};
}

// ─── Build a transaction (SDK for account + tx construction) ─────────────────

async function buildTx(
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string,
): Promise<Transaction> {
  const server = await getServer();
  const accountData = await server.getAccount(sourceAddress);
  const account = new Account(accountData.accountId(), accountData.sequenceNumber());
  const contract = new Contract(CONTRACT_ID);
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(300)
    .build();
}

// ─── XDR parsers ─────────────────────────────────────────────────────────────

function svAddress(sv: xdr.ScVal | undefined): string {
  try {
    if (!sv || sv.switch().value !== xdr.ScValType.scvAddress().value) return '';
    const addr = sv.address();
    if (addr.switch().value === xdr.ScAddressType.scAddressTypeAccount().value)
      return StrKey.encodeEd25519PublicKey(addr.accountId().ed25519());
    if (addr.switch().value === xdr.ScAddressType.scAddressTypeContract().value)
      return StrKey.encodeContract(addr.contractId());
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
  } catch { /* partial ok */ }
  return out;
}

function svEnum(sv: xdr.ScVal | undefined): string {
  try {
    if (!sv) return '';
    const t = sv.switch().value;
    if (t === xdr.ScValType.scvVec().value) {
      const vec = sv.vec() ?? [];
      if (vec.length > 0 && vec[0].switch().value === xdr.ScValType.scvSymbol().value)
        return vec[0].sym().toString();
    }
    if (t === xdr.ScValType.scvSymbol().value) return sv.sym().toString();
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

function parseGameState(retvalXdr: string): GameState {
  const retval = xdr.ScVal.fromXDR(retvalXdr, 'base64');
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

// ─── fetchGameState ───────────────────────────────────────────────────────────

export async function fetchGameState(): Promise<GameState | null> {
  if (!CONTRACT_ID) return null;
  try {
    const tx = await buildTx('get_state', [], SIM_ACCOUNT);
    const sim = await rawSimulate(tx.toXDR());
    // error or no results = contract uninitialized = no game yet
    if (sim.error || !sim.results?.[0]?.xdr) return null;
    return parseGameState(sim.results[0].xdr);
  } catch (e) {
    console.debug('fetchGameState: no active game', e);
    return null;
  }
}

// ─── getPlayerStats ───────────────────────────────────────────────────────────

export async function getPlayerStats(address: string): Promise<PlayerStats | null> {
  try {
    if (!CONTRACT_ID || !isValidStellarAddress(address)) return null;
    const tx = await buildTx('get_player_stats', [new Address(address).toScVal()], SIM_ACCOUNT);
    const sim = await rawSimulate(tx.toXDR());
    if (sim.error || !sim.results?.[0]?.xdr) return null;

    const retval = xdr.ScVal.fromXDR(sim.results[0].xdr, 'base64');
    if (retval.switch().value === xdr.ScValType.scvVoid().value) return null;

    let sv = retval;
    if (retval.switch().value === xdr.ScValType.scvVec().value) {
      const vec = retval.vec() ?? [];
      if (vec.length === 0) return null;
      sv = vec[0];
    }

    const f = svMap(sv);
    return {
      games_played:         svU32(f['games_played']),
      games_won:            svU32(f['games_won']),
      total_shots_fired:    svU32(f['total_shots_fired']),
      total_shots_received: svU32(f['total_shots_received']),
      total_hits:           svU32(f['total_hits']),
    };
  } catch { return null; }
}

// ─── invokeContract ───────────────────────────────────────────────────────────

async function invokeContract(
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string,
  signTx: SignTransaction,
): Promise<void> {
  const server = await getServer();
  const tx = await buildTx(method, args, sourceAddress);

  // Raw simulate — avoids SDK scValToNative bug on error diagnostic events
  const sim = await rawSimulate(tx.toXDR());

  if (sim.error) {
    const raw = sim.error;
    // Try to extract a human-readable message from the Soroban error format
    const match =
      raw.match(/value:String\("([^"]+)"\)/) ??
      raw.match(/details=Some\("([^"]+)"\)/) ??
      raw.match(/message: "([^"]+)"/) ??
      raw.match(/"([A-Za-z][^"]{4,80})"/);
    throw new Error(match?.[1] ?? raw.slice(0, 250));
  }

  if (!sim.results) throw new Error('Simulation returned no results');

  // Feed raw sim data to assembleTransaction
  const simForAssemble = {
    results: sim.results,
    minResourceFee: sim.minResourceFee,
    transactionData: sim.transactionData,
    latestLedger: sim.latestLedger ?? '0',
  } as unknown as SorobanRpc.Api.SimulateTransactionSuccessResponse;

  const assembled = SorobanRpc.assembleTransaction(tx, simForAssemble).build();
  const signedXdr = await signTx(assembled.toXDR());
  const signedTx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
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
  throw new Error('Confirmation timeout');
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
    const j = JSON.stringify(err);
    if (j !== '{}') return j.slice(0, 200);
  }
  return 'Unknown error';
}

// ─── Public contract functions ────────────────────────────────────────────────

export async function joinGame(addr: string, sign: SignTransaction): Promise<void> {
  await invokeContract('join_game', [requireAddress(addr, 'Player')], addr, sign);
}

export async function commitBoard(addr: string, hashHex: string, sign: SignTransaction): Promise<void> {
  const clean = hashHex.startsWith('0x') ? hashHex.slice(2) : hashHex;
  const padded = clean.padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  await invokeContract(
    'commit_board',
    [requireAddress(addr, 'Player'), xdr.ScVal.scvBytes(Buffer.from(bytes))],
    addr, sign,
  );
}

export async function fireShot(addr: string, x: number, y: number, sign: SignTransaction): Promise<void> {
  await invokeContract(
    'fire_shot',
    [requireAddress(addr, 'Shooter'), nativeToScVal(x, { type: 'u32' }), nativeToScVal(y, { type: 'u32' })],
    addr, sign,
  );
}

export async function submitResponse(
  addr: string, x: number, y: number, hit: boolean, proof: Uint8Array, sign: SignTransaction,
): Promise<void> {
  await invokeContract(
    'submit_response',
    [
      requireAddress(addr, 'Defender'),
      nativeToScVal(x, { type: 'u32' }),
      nativeToScVal(y, { type: 'u32' }),
      nativeToScVal(hit, { type: 'bool' }),
      xdr.ScVal.scvBytes(Buffer.from(proof)),
    ],
    addr, sign,
  );
}

export async function resetGame(addr: string, sign: SignTransaction): Promise<void> {
  await invokeContract('reset_game', [requireAddress(addr, 'Caller')], addr, sign);
}