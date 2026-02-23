// contract.ts — ZK Battleship
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

// ─── RPC singleton ────────────────────────────────────────────────────────────

let _server: SorobanRpc.Server | null = null;
async function getServer(): Promise<SorobanRpc.Server> {
  if (!_server) _server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  return _server;
}

// ─── Raw JSON-RPC fetch ───────────────────────────────────────────────────────

interface RawSimResult {
  error?: string;
  results?: Array<{ xdr: string; auth: string[] }>;
  minResourceFee?: string;
  transactionData?: string;
  latestLedger?: string;
  events?: string[];
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
  
  if (json.error) throw new Error(`RPC Error: ${json.error.message}`);
  
  const result = json.result ?? {};
  
  // PARCHE CRÍTICO: Si hay error, lanzamos el mensaje crudo ANTES de que el SDK 
  // intente parsear los eventos de diagnóstico (evita Bad union switch: 4)
  if (result.error) {
    const rawError = result.error;
    console.error("❌ Error de Simulación:", rawError);
    
    // Intenta extraer el mensaje del pánico del contrato
    const match = rawError.match(/value:String\("([^"]+)"\)/) ?? 
                  rawError.match(/details=Some\("([^"]+)"\)/) ??
                  rawError.match(/Error\(Contract, #(\d+)\)/);
    
    throw new Error(match ? `Contrato: ${match[1]}` : `Fallo en VM: ${rawError.slice(0, 200)}`);
  }

  return result;
}

// ─── Build sim tx ────────────────────────────────────────────────────────────

async function buildTx(method: string, args: xdr.ScVal[], sourceAddress: string): Promise<Transaction> {
  const server = await getServer();
  const accountData = await server.getAccount(sourceAddress);
  const account = new Account(accountData.accountId(), accountData.sequenceNumber());
  const contract = new Contract(CONTRACT_ID);
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
}

// ─── XDR parsers ──────────────────────────────────────────────────────────────

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
  } catch { }
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

// ─── Fetchers ─────────────────────────────────────────────────────────────────

export async function fetchGameState(): Promise<GameState | null> {
  if (!CONTRACT_ID) return null;
  try {
    const tx = await buildTx('get_state', [], SIM_ACCOUNT);
    const sim = await rawSimulate(tx.toXDR());
    if (!sim.results?.[0]?.xdr) return null;
    return parseGameState(sim.results[0].xdr);
  } catch (e) {
    console.debug('fetchGameState error:', e);
    return null;
  }
}

export async function getPlayerStats(address: string): Promise<PlayerStats | null> {
  try {
    if (!CONTRACT_ID || !isValidStellarAddress(address)) return null;
    const playerVal = new Address(address).toScVal();
    const tx = await buildTx('get_player_stats', [playerVal], SIM_ACCOUNT);
    const sim = await rawSimulate(tx.toXDR());
    if (!sim.results?.[0]?.xdr) return null;

    const retval = xdr.ScVal.fromXDR(sim.results[0].xdr, 'base64');
    if (retval.switch().value === xdr.ScValType.scvVoid().value) return null;

    const f = svMap(retval.switch().value === xdr.ScValType.scvVec().value ? (retval.vec()?.[0] ?? retval) : retval);
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
  const sim = await rawSimulate(tx.toXDR());

  const simSuccess = {
    results: sim.results,
    minResourceFee: sim.minResourceFee,
    transactionData: sim.transactionData,
    latestLedger: sim.latestLedger ?? '0',
  } as any;

  const assembled = SorobanRpc.assembleTransaction(tx, simSuccess).build();
  const signedXdr = await signTx(assembled.toXDR());
  const sendResult = await server.sendTransaction(new Transaction(signedXdr, NETWORK_PASSPHRASE));

  if (sendResult.status === 'ERROR') {
    throw new Error(`Error de envío: ${JSON.stringify(sendResult.errorResultXdr)}`);
  }

  // Polling
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const status = await server.getTransaction(sendResult.hash);
    if (status.status === 'SUCCESS') return;
    if (status.status === 'FAILED') throw new Error('Transacción falló en el Ledger');
  }
  throw new Error('Tiempo de espera agotado');
}

// ─── Validation & Helpers ─────────────────────────────────────────────────────

function isValidStellarAddress(addr: string | null | undefined): boolean {
  if (!addr || addr.length !== 56) return false;
  try { new Address(addr); return true; } catch { return false; }
}

function requireAddress(addr: string | null | undefined, field = 'Address'): xdr.ScVal {
  if (!addr?.trim()) throw new Error(`${field} requerido`);
  return new Address(addr.trim()).toScVal();
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++)
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// ─── Main Contract Actions ────────────────────────────────────────────────────

export async function joinGame(addr: string, sign: SignTransaction) {
  await invokeContract('join_game', [requireAddress(addr)], addr, sign);
}

export async function commitBoard(addr: string, hashHex: string, sign: SignTransaction) {
  const bytes = hexToBytes(hashHex);
  await invokeContract('commit_board', [requireAddress(addr), xdr.ScVal.scvBytes(Buffer.from(bytes))], addr, sign);
}

export async function fireShot(addr: string, x: number, y: number, sign: SignTransaction) {
  await invokeContract('fire_shot', [requireAddress(addr), nativeToScVal(x, {type:'u32'}), nativeToScVal(y, {type:'u32'})], addr, sign);
}

export async function submitResponse(addr: string, x: number, y: number, hit: boolean, proof: Uint8Array, sign: SignTransaction) {
  await invokeContract('submit_response', [
    requireAddress(addr),
    nativeToScVal(x, {type:'u32'}),
    nativeToScVal(y, {type:'u32'}),
    nativeToScVal(hit, {type:'bool'}),
    xdr.ScVal.scvBytes(Buffer.from(proof))
  ], addr, sign);
}

export async function resetGame(addr: string, sign: SignTransaction) {
  await invokeContract('reset_game', [requireAddress(addr)], addr, sign);
}