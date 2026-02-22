// ZK Battleship Circuit
// Proves that a hit/miss response is correct for a committed board,
// without revealing the board positions.
//
// Board layout: 5x5 grid, row-major order
// Ships: 3 cells marked with 1, rest are 0
// board[row][col] - row = y axis, col = x axis

// Private inputs:
//   board : [[u8; 5]; 5]  - the real board (1 = ship, 0 = water)
//   salt  : Field         - random blinding factor for the hash
//
// Public inputs:
//   board_hash : Field    - Poseidon2 hash of the serialized board + salt
//   shot_x     : u8       - column of the incoming shot (0-4)
//   shot_y     : u8       - row of the incoming shot (0-4)
//   is_hit     : bool     - defender's claimed answer

// Poseidon2 sponge hash over 26 field elements (25 board cells + salt).
// Fully unrolled: 26 inputs / rate-3 = 8 full absorb+permute rounds, then
// 2 remaining inputs absorbed before the final permute+squeeze.
// IV = 26 * 2^64 (fixed-length mode, matches Noir stdlib hash_internal).
fn poseidon2_hash_26(inputs: [Field; 26]) -> Field {
    let two_pow_64: Field = 18446744073709551616;
    let iv: Field = 26 as Field * two_pow_64;

    // state = [0, 0, 0, iv]
    let mut s: [Field; 4] = [0, 0, 0, iv];

    // Round 0: absorb inputs[0..2], permute
    s[0] += inputs[0]; s[1] += inputs[1]; s[2] += inputs[2];
    s = std::hash::poseidon2_permutation(s, 4);

    // Round 1: absorb inputs[3..5], permute
    s[0] += inputs[3]; s[1] += inputs[4]; s[2] += inputs[5];
    s = std::hash::poseidon2_permutation(s, 4);

    // Round 2: absorb inputs[6..8], permute
    s[0] += inputs[6]; s[1] += inputs[7]; s[2] += inputs[8];
    s = std::hash::poseidon2_permutation(s, 4);

    // Round 3: absorb inputs[9..11], permute
    s[0] += inputs[9]; s[1] += inputs[10]; s[2] += inputs[11];
    s = std::hash::poseidon2_permutation(s, 4);

    // Round 4: absorb inputs[12..14], permute
    s[0] += inputs[12]; s[1] += inputs[13]; s[2] += inputs[14];
    s = std::hash::poseidon2_permutation(s, 4);

    // Round 5: absorb inputs[15..17], permute
    s[0] += inputs[15]; s[1] += inputs[16]; s[2] += inputs[17];
    s = std::hash::poseidon2_permutation(s, 4);

    // Round 6: absorb inputs[18..20], permute
    s[0] += inputs[18]; s[1] += inputs[19]; s[2] += inputs[20];
    s = std::hash::poseidon2_permutation(s, 4);

    // Round 7: absorb inputs[21..23], permute
    s[0] += inputs[21]; s[1] += inputs[22]; s[2] += inputs[23];
    s = std::hash::poseidon2_permutation(s, 4);

    // Final: absorb remaining inputs[24..25] (2 elements, s[2] unchanged)
    s[0] += inputs[24]; s[1] += inputs[25];
    s = std::hash::poseidon2_permutation(s, 4);

    s[0]
}

// Compute Poseidon2 hash of the board (row-major, 25 cells) + salt.
fn compute_board_hash(board: [[u8; 5]; 5], salt: Field) -> Field {
    let mut inputs: [Field; 26] = [0; 26];
    for row in 0..5 {
        for col in 0..5 {
            inputs[row * 5 + col] = board[row][col] as Field;
        }
    }
    inputs[25] = salt;
    poseidon2_hash_26(inputs)
}

fn main(
    // Private
    board : [[u8; 5]; 5],
    salt  : Field,
    // Public
    board_hash : pub Field,
    shot_x     : pub u8,
    shot_y     : pub u8,
    is_hit     : pub bool,
) {
    // Constraint 1: board values must be 0 or 1
    for row in 0..5 {
        for col in 0..5 {
            let cell = board[row][col] as Field;
            // cell * (cell - 1) == 0  =>  cell in {0, 1}
            assert(cell * (cell - 1) == 0, "Board cell must be 0 or 1");
        }
    }

    // Constraint 2: exactly 3 ships on the board
    let mut ship_count: Field = 0;
    for row in 0..5 {
        for col in 0..5 {
            ship_count += board[row][col] as Field;
        }
    }
    assert(ship_count == 3, "Board must have exactly 3 ships");

    // Constraint 3: board hash matches the public commitment
    let computed_hash = compute_board_hash(board, salt);
    assert(computed_hash == board_hash, "Board hash mismatch");

    // Constraint 4: shot coordinates are in range [0, 4]
    assert(shot_x < 5, "shot_x out of range");
    assert(shot_y < 5, "shot_y out of range");

    // Constraint 5: is_hit matches the actual board cell
    // board is indexed [row][col] = [shot_y][shot_x]
    let cell_value = board[shot_y as u32][shot_x as u32] as Field;
    let claimed    = if is_hit { 1 } else { 0 } as Field;
    assert(cell_value == claimed, "Hit/miss claim does not match board");
}

// Tests

#[test]
fn test_hit_correct() {
    // Board: ships at col=0 row=0, col=2 row=1, col=4 row=4
    let board: [[u8; 5]; 5] = [
        [1, 0, 0, 0, 0],  // row 0 - ship at col 0
        [0, 0, 1, 0, 0],  // row 1 - ship at col 2
        [0, 0, 0, 0, 0],  // row 2
        [0, 0, 0, 0, 0],  // row 3
        [0, 0, 0, 0, 1],  // row 4 - ship at col 4
    ];
    let salt: Field = 0xdeadbeef;

    let board_hash = compute_board_hash(board, salt);

    // Shot at col=0, row=0 -> HIT
    main(board, salt, board_hash, 0, 0, true);
}

#[test]
fn test_miss_correct() {
    let board: [[u8; 5]; 5] = [
        [1, 0, 0, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 1],
    ];
    let salt: Field = 0xdeadbeef;

    let board_hash = compute_board_hash(board, salt);

    // Shot at col=1, row=0 -> MISS (cell is 0)
    main(board, salt, board_hash, 1, 0, false);
}

#[test]
fn test_hit_at_corner() {
    let board: [[u8; 5]; 5] = [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 0, 0, 0],
        [1, 0, 0, 0, 1],
    ];
    let salt: Field = 0xcafebabe;

    let board_hash = compute_board_hash(board, salt);

    // Shot at col=4, row=4 -> HIT (bottom-right corner)
    main(board, salt, board_hash, 4, 4, true);
}

#[test]
fn test_miss_center() {
    let board: [[u8; 5]; 5] = [
        [1, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 1, 0, 0, 1],
    ];
    let salt: Field = 0x1234567890;

    let board_hash = compute_board_hash(board, salt);

    // Shot at col=2, row=2 -> MISS (center is empty)
    main(board, salt, board_hash, 2, 2, false);
}
