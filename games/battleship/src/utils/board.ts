// Board utilities for ZK Battleship
// Board is 5x5: board[row][col], row = y-axis, col = x-axis
// Ships are represented as 1, water as 0.

export const BOARD_SIZE = 5;
export const TOTAL_SHIPS = 3;

export type Board = number[][];
export type CellState = 'water' | 'ship' | 'hit' | 'miss' | 'sunk';

/** Create an empty 5x5 board filled with zeros */
export function emptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

/** Count how many ships are placed on the board */
export function countShips(board: Board): number {
  return board.flat().reduce((sum, cell) => sum + cell, 0);
}

/** Toggle a ship cell; respects the max ship count */
export function toggleCell(board: Board, row: number, col: number): Board {
  const next = board.map((r) => [...r]);
  if (next[row][col] === 1) {
    next[row][col] = 0;
  } else if (countShips(board) < TOTAL_SHIPS) {
    next[row][col] = 1;
  }
  return next;
}

/** Serialize board to a flat array of 25 numbers (row-major order) */
export function serializeBoard(board: Board): number[] {
  return board.flat();
}

/** Generate a cryptographically random salt as a hex string.
 *  Must be within the BN254 scalar field modulus (254 bits).
 *  We use 31 bytes (248 bits) which is always safely below the modulus.
 */
export function generateSalt(): string {
  const BN254_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Reduce modulo BN254 field to guarantee the value is a valid Field element
  const raw = BigInt('0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(''));
  const reduced = raw % BN254_MODULUS;
  return '0x' + reduced.toString(16).padStart(64, '0');
}

/**
 * Compute the Poseidon2 board hash by executing the hash_only Noir circuit.
 *
 * Uses @noir-lang/noir_js witness execution (no proof generated) against
 * circuits/hash_only — a minimal circuit that takes board+salt and returns
 * the hash as its public return value.  This is guaranteed to produce the
 * exact same Field value that the main battleship circuit verifies.
 */
export async function computeBoardHash(board: Board, salt: string): Promise<string> {
  const { Noir } = await import('@noir-lang/noir_js');
  const circuit = await import('../circuits/hash_only.json');

  const noir = new Noir(circuit as never);

  // Reshape flat board to [[u8;5];5] as Noir expects
  const boardMatrix = Array.from({ length: BOARD_SIZE }, (_, row) =>
    board[row].map(String),
  );

  const { returnValue } = await noir.execute({ board: boardMatrix as never, salt });

  // returnValue is the public Field output — a hex string like "0x..."
  const hex = String(returnValue);
  return hex.startsWith('0x') ? hex : '0x' + hex;
}

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

const LS_PREFIX = 'zk-battleship';

export function savePlayerSecret(
  contractId: string,
  playerAddress: string,
  board: Board,
  salt: string,
): void {
  const key = `${LS_PREFIX}:${contractId}:${playerAddress}`;
  localStorage.setItem(key, JSON.stringify({ board, salt }));
}

export function loadPlayerSecret(
  contractId: string,
  playerAddress: string,
): { board: Board; salt: string } | null {
  const key = `${LS_PREFIX}:${contractId}:${playerAddress}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { board: Board; salt: string };
  } catch {
    return null;
  }
}

export function clearPlayerSecret(contractId: string, playerAddress: string): void {
  const key = `${LS_PREFIX}:${contractId}:${playerAddress}`;
  localStorage.removeItem(key);
}
