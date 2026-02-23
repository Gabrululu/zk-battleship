// contract.ts — ZK Battleship
import {
  Contract, Networks, TransactionBuilder, BASE_FEE,
  xdr, Address, nativeToScVal, Transaction, Account,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? '';
const SIM_ACCOUNT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

export interface PlayerStats {
  games_played: number; games_won: number;
  total_shots_fired: number; total_shots_received: number; total_hits: number;
}
export interface GameState {
  player1: string; player2: string;
  board_hash_p1: string; board_hash_p2: string;
  hits_on_p1: number; hits_on_p2: number;
  shots_fired_p1: number; shots_fired_p2: number;
  turn: string;
  phase: 'WaitingForPlayers' | 'Commit' | 'Playing' | 'Finished';
  pending_shot_x: number; pending_shot_y: number; pending_shooter: string;
  winner: string; has_winner: boolean;
  p1_committed: boolean; p2_committed: boolean;
  p1_joined: boolean; p2_joined: boolean;
  session_id: number;
}
export const NO_SHOT = 4294967295;
export type SignTransaction = (xdrStr: string) => Promise<string>;

let _server: SorobanRpc.Server | null = null;
async function getServer() {
  if (!_server) _server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  return _server;
}

interface RawSim {
  error?: string;
  results?: Array<{ xdr: string; auth: string[] }>;
  minResourceFee?: string; transactionData?: string; latestLedger?: string;
}
async function rawSim(txXdr: string): Promise<RawSim> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'simulateTransaction', params:{ transaction: txXdr } }),
  });
  const j = await res.json() as { result?: RawSim; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result ?? {};
}

async function buildTx(method: string, args: xdr.ScVal[], src: string): Promise<Transaction> {
  const server = await getServer();
  const a = await server.getAccount(src);
  const acc = new Account(a.accountId(), a.sequenceNumber());
  return new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(CONTRACT_ID).call(method, ...args))
    .setTimeout(300).build();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAny = (v: unknown): any => v;

function svAddress(sv?: xdr.ScVal): string {
  try {
    if (!sv || sv.switch().value !== xdr.ScValType.scvAddress().value) return '';
    const addr = sv.address();
    if (addr.switch().value === xdr.ScAddressType.scAddressTypeAccount().value)
      return Address.fromScAddress(addr).toString();
    if (addr.switch().value === xdr.ScAddressType.scAddressTypeContract().value)
      return Address.fromScAddress(addr).toString();
    return '';
  } catch { return ''; }
}
function svU32(sv?: xdr.ScVal, fb = 0): number {
  try { return sv?.switch().value === xdr.ScValType.scvU32().value ? sv.u32() : fb; } catch { return fb; }
}
function svBool(sv?: xdr.ScVal): boolean {
  try { return sv?.switch().value === xdr.ScValType.scvBool().value ? sv.b() : false; } catch { return false; }
}
function svBytes(sv?: xdr.ScVal): string {
  try {
    if (!sv || sv.switch().value !== xdr.ScValType.scvBytes().value) return '';
    return '0x' + Array.from(asAny(sv.bytes()) as Uint8Array)
      .map((b: number) => b.toString(16).padStart(2,'0')).join('');
  } catch { return ''; }
}
function svMap(sv?: xdr.ScVal): Record<string, xdr.ScVal> {
  const out: Record<string, xdr.ScVal> = {};
  try {
    if (!sv || sv.switch().value !== xdr.ScValType.scvMap().value) return out;
    for (const e of sv.map() ?? []) {
      let k = '';
      try {
        const key = e.key();
        if (key.switch().value === xdr.ScValType.scvSymbol().value) k = asAny(key.sym()).toString();
        else if (key.switch().value === xdr.ScValType.scvString().value) k = asAny(key.str()).toString();
      } catch { continue; }
      if (k) out[k] = e.val();
    }
  } catch { /**/ }
  return out;
}
function svEnum(sv?: xdr.ScVal): string {
  try {
    if (!sv) return '';
    const t = sv.switch().value;
    if (t === xdr.ScValType.scvVec().value) {
      const vec = sv.vec() ?? [];
      if (vec.length > 0 && vec[0].switch().value === xdr.ScValType.scvSymbol().value)
        return asAny(vec[0].sym()).toString();
    }
    if (t === xdr.ScValType.scvSymbol().value) return asAny(sv.sym()).toString();
    return '';
  } catch { return ''; }
}

function parseState(xdrB64: string): GameState {
  const f = svMap(xdr.ScVal.fromXDR(xdrB64, 'base64'));
  let phase: GameState['phase'] = 'WaitingForPlayers';
  const v = svEnum(f['phase']);
  if (v === 'Commit') phase = 'Commit';
  else if (v === 'Playing') phase = 'Playing';
  else if (v === 'Finished') phase = 'Finished';
  return {
    player1: svAddress(f['player1']), player2: svAddress(f['player2']),
    board_hash_p1: svBytes(f['board_hash_p1']), board_hash_p2: svBytes(f['board_hash_p2']),
    hits_on_p1: svU32(f['hits_on_p1']), hits_on_p2: svU32(f['hits_on_p2']),
    shots_fired_p1: svU32(f['shots_fired_p1']), shots_fired_p2: svU32(f['shots_fired_p2']),
    turn: svAddress(f['turn']), phase,
    pending_shot_x: svU32(f['pending_shot_x'], NO_SHOT),
    pending_shot_y: svU32(f['pending_shot_y'], NO_SHOT),
    pending_shooter: svAddress(f['pending_shooter']),
    winner: svAddress(f['winner']), has_winner: svBool(f['has_winner']),
    p1_committed: svBool(f['p1_committed']), p2_committed: svBool(f['p2_committed']),
    p1_joined: svBool(f['p1_joined']), p2_joined: svBool(f['p2_joined']),
    session_id: svU32(f['session_id']),
  };
}

export async function fetchGameState(): Promise<GameState | null> {
  if (!CONTRACT_ID) return null;
  try {
    const sim = await rawSim((await buildTx('get_state', [], SIM_ACCOUNT)).toXDR());
    if (sim.error || !sim.results?.[0]?.xdr) return null;
    return parseState(sim.results[0].xdr);
  } catch { return null; }
}

export async function getPlayerStats(address: string): Promise<PlayerStats | null> {
  try {
    if (!CONTRACT_ID) return null;
    const sim = await rawSim((await buildTx('get_player_stats', [new Address(address).toScVal()], SIM_ACCOUNT)).toXDR());
    if (sim.error || !sim.results?.[0]?.xdr) return null;
    const rv = xdr.ScVal.fromXDR(sim.results[0].xdr, 'base64');
    if (rv.switch().value === xdr.ScValType.scvVoid().value) return null;
    const f = svMap(rv.switch().value === xdr.ScValType.scvVec().value ? (rv.vec()?.[0] ?? rv) : rv);
    return {
      games_played: svU32(f['games_played']), games_won: svU32(f['games_won']),
      total_shots_fired: svU32(f['total_shots_fired']),
      total_shots_received: svU32(f['total_shots_received']),
      total_hits: svU32(f['total_hits']),
    };
  } catch { return null; }
}

function toScvBytes(u8: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(asAny(u8));
}

async function invoke(method: string, args: xdr.ScVal[], src: string, sign: SignTransaction) {
  const server = await getServer();
  const tx = await buildTx(method, args, src);
  const sim = await rawSim(tx.toXDR());
  if (sim.error) {
    const m = sim.error.match(/value:String\("([^"]+)"\)/) ??
              sim.error.match(/details=Some\("([^"]+)"\)/) ??
              sim.error.match(/"([A-Za-z][^"]{4,80})"/);
    throw new Error(m?.[1] ?? sim.error.slice(0, 250));
  }
  if (!sim.results) throw new Error('No simulation results');
  const assembled = SorobanRpc.assembleTransaction(tx, asAny({
    results: sim.results, minResourceFee: sim.minResourceFee,
    transactionData: sim.transactionData, latestLedger: sim.latestLedger ?? '0',
  })).build();
  const signed = new Transaction(await sign(assembled.toXDR()), NETWORK_PASSPHRASE);
  const sent = await server.sendTransaction(signed);
  if (sent.status === 'ERROR') throw new Error(`Send failed: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const s = await server.getTransaction(sent.hash);
    if (s.status === 'SUCCESS') return;
    if (s.status === 'FAILED') throw new Error('Transaction failed on-chain');
  }
  throw new Error('Confirmation timeout');
}

function reqAddr(addr: string | null | undefined, f = 'Address'): xdr.ScVal {
  if (!addr?.trim()) throw new Error(`${f} required`);
  return new Address(addr.trim()).toScVal();
}

export function parseError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

export async function joinGame(addr: string, sign: SignTransaction) {
  await invoke('join_game', [reqAddr(addr, 'Player')], addr, sign);
}
export async function commitBoard(addr: string, hex: string, sign: SignTransaction) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = parseInt(clean.padStart(64,'0').slice(i*2, i*2+2), 16);
  await invoke('commit_board', [reqAddr(addr,'Player'), toScvBytes(b)], addr, sign);
}
export async function fireShot(addr: string, x: number, y: number, sign: SignTransaction) {
  await invoke('fire_shot', [reqAddr(addr,'Shooter'), nativeToScVal(x,{type:'u32'}), nativeToScVal(y,{type:'u32'})], addr, sign);
}
export async function submitResponse(addr: string, x: number, y: number, hit: boolean, proof: Uint8Array, sign: SignTransaction) {
  await invoke('submit_response', [
    reqAddr(addr,'Defender'), nativeToScVal(x,{type:'u32'}), nativeToScVal(y,{type:'u32'}),
    nativeToScVal(hit,{type:'bool'}), toScvBytes(proof),
  ], addr, sign);
}
export async function resetGame(addr: string, sign: SignTransaction) {
  await invoke('reset_game', [reqAddr(addr,'Caller')], addr, sign);
}