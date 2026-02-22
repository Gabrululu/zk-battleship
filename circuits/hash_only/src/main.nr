// Hash-only circuit: takes board + salt, returns Poseidon2 hash as public output.
// Used by the frontend to compute board_hash via Noir.js witness execution
// (no proof needed), guaranteeing the hash matches the main battleship circuit.

fn poseidon2_hash_26(inputs: [Field; 26]) -> Field {
    let two_pow_64: Field = 18446744073709551616;
    let iv: Field = 26 as Field * two_pow_64;
    let mut s: [Field; 4] = [0, 0, 0, iv];
    s[0] += inputs[0];  s[1] += inputs[1];  s[2] += inputs[2];
    s = std::hash::poseidon2_permutation(s, 4);
    s[0] += inputs[3];  s[1] += inputs[4];  s[2] += inputs[5];
    s = std::hash::poseidon2_permutation(s, 4);
    s[0] += inputs[6];  s[1] += inputs[7];  s[2] += inputs[8];
    s = std::hash::poseidon2_permutation(s, 4);
    s[0] += inputs[9];  s[1] += inputs[10]; s[2] += inputs[11];
    s = std::hash::poseidon2_permutation(s, 4);
    s[0] += inputs[12]; s[1] += inputs[13]; s[2] += inputs[14];
    s = std::hash::poseidon2_permutation(s, 4);
    s[0] += inputs[15]; s[1] += inputs[16]; s[2] += inputs[17];
    s = std::hash::poseidon2_permutation(s, 4);
    s[0] += inputs[18]; s[1] += inputs[19]; s[2] += inputs[20];
    s = std::hash::poseidon2_permutation(s, 4);
    s[0] += inputs[21]; s[1] += inputs[22]; s[2] += inputs[23];
    s = std::hash::poseidon2_permutation(s, 4);
    s[0] += inputs[24]; s[1] += inputs[25];
    s = std::hash::poseidon2_permutation(s, 4);
    s[0]
}

// All inputs are private; the hash is the only public output.
// The frontend calls Noir.execute(inputs) and reads returnValue as the hash.
fn main(board: [[u8; 5]; 5], salt: Field) -> pub Field {
    let mut inputs: [Field; 26] = [0; 26];
    for row in 0..5 {
        for col in 0..5 {
            inputs[row * 5 + col] = board[row][col] as Field;
        }
    }
    inputs[25] = salt;
    poseidon2_hash_26(inputs)
}
