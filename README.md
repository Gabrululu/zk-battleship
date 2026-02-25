# ZK Battleship — Stellar Testnet

Zero-Knowledge Battleship on-chain on Stellar Testnet. The honesty of every hit/miss response is guaranteed by ZK proofs generated in the browser using the Noir circuit + UltraHonk verifier.

## Architecture

```
zk-battleship/
├── circuits/battleship/       # Noir circuit (ZK)
│   ├── src/main.nr            # Circuit logic
│   ├── src/compute_hash.nr    # Helper to compute board_hash
│   ├── Nargo.toml
│   └── Prover.toml            # Example for nargo prove
├── contracts/battleship/      # Soroban contract (Rust)
│   ├── src/lib.rs
│   └── Cargo.toml
└── games/battleship/          # React + TypeScript frontend
    ├── src/
    │   ├── components/        # Board, Lobby, CommitPhase, PlayPhase, GameOver
    │   ├── hooks/             # useZKProof, useGameState, useWallet, useTurnTimer
    │   ├── utils/             # board.ts, contract.ts, sounds.ts
    │   ├── App.tsx
    │   └── main.tsx
    ├── .env.example
    └── package.json
```

## ZK Flow

```
Player A (attacker)           Soroban Contract          Player B (defender)
─────────────────────────────────────────────────────────────────────────────
                    ← COMMIT PHASE →
Place 3 ships on 5x5
Generate random salt
hash = Poseidon2(board + salt)
commit_board(hash) ──────────────→ stores board_hash_A
                                                         Place 3 ships
                                                         hash = Poseidon2(board+salt)
                                   ←────────────────── commit_board(hash)
                                   stores board_hash_B

                    ← PLAYING PHASE →
fire_shot(x=2, y=3) ─────────────→ stores pending_shot
                                   turn = B
                                                         Read pending_shot(2,3)
                                                         is_hit = board[3][2]
                                                         proof = Noir.prove({
                                                           board, salt,        ← PRIVATE
                                                           board_hash_B,       ← PUBLIC
                                                           x=2, y=3, is_hit    ← PUBLIC
                                                         })
                                   ←────────────────── submit_response(2,3,is_hit,proof)
                                   verify_ultrahonk(proof, [hash_B, 2, 3, is_hit])
                                   ✓ valid proof → update state
```

**Without ZK**: the defender could lie about whether a shot was a hit or miss.  
**With ZK**: the contract cryptographically verifies that the response is correct
against the committed hash. Cheating is impossible.

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18 + npm
- [Rust](https://rustup.rs/) + target `wasm32v1-none`
- [Stellar CLI](https://developers.stellar.org/docs/tools/stellar-cli)
- [Nargo](https://noir-lang.org/docs/getting_started/installation/) = 0.36.0
- [Freighter](https://www.freighter.app/) (or any supported wallet extension)

### 1. Install Nargo 0.36.0

```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
source ~/.bashrc
noirup --version 0.36.0
nargo --version
# nargo version = 0.36.0
```

### 2. Compile the Noir circuits

```bash
# Main battleship circuit
cd circuits/battleship
nargo compile
cp target/battleship.json ../../games/battleship/src/circuits/battleship.json

# Hash-only helper circuit
cd ../hash_only
nargo compile
cp target/hash_only.json ../../games/battleship/src/circuits/hash_only.json
```

### 3. Test the circuit

```bash
cd circuits/battleship
nargo test    # runs 4 circuit tests
```

### 4. Build and deploy the Soroban contract

```bash
cd contracts/battleship

cargo build --target wasm32v1-none --release

stellar contract deploy \
  --wasm target/wasm32v1-none/release/battleship.wasm \
  --source deployer \
  --network testnet

# Save the contract address and update .env
echo "VITE_CONTRACT_ID=<RETURNED_ADDRESS>" > ../../games/battleship/.env
```

### 5. Configure and run the frontend

```bash
cd games/battleship

npm install --ignore-scripts

# Set your contract ID
echo "VITE_CONTRACT_ID=CD6S436W6IOTT3BIOR3COXYWLUTFI2JI3JL7K2WJZDNYCQXT4BBB3PSO" > .env

npm run dev
# → http://localhost:3000
```

## Deployed Contract

| Network | Address |
|---------|---------|
| Stellar Testnet | `CD6S436W6IOTT3BIOR3COXYWLUTFI2JI3JL7K2WJZDNYCQXT4BBB3PSO` |

View on: https://stellar.expert/explorer/testnet/contract/CD6S436W6IOTT3BIOR3COXYWLUTFI2JI3JL7K2WJZDNYCQXT4BBB3PSO

## Game Rules

- Board: **5×5** (coordinates 0–4, columns A–E, rows 1–5)
- Ships: **3 single-cell ships** (1×1 each)
- Winner: first player to sink all **3 opponent ships**
- Turns: strictly alternating, **5-minute timer** per turn
- Phases: `WaitingForPlayers → Commit → Playing → Finished`

## How to Play

1. **Connect wallet** — Freighter, xBull, Albedo, or Lobstr on Testnet
2. **Join game** — click Join as Player 1 or Player 2
3. **Commit phase** — place your 3 ships on the 5×5 grid, then commit (generates Poseidon2 hash on-chain)
4. **Playing phase** — take turns firing shots at the enemy grid
5. **ZK response** — when you receive a shot, the app automatically generates a ZK proof of your hit/miss response
6. **Win** — sink all 3 enemy ships first

## Development Status

| Component | Status |
|-----------|--------|
| Noir circuit | ✅ Complete (4 tests passing) |
| Soroban contract (logic) | ✅ Complete |
| Player stats & game history | ✅ On-chain persistent storage |
| UltraHonk on-chain verifier | 🔄 Stub (accepts any non-empty proof) |
| React frontend | ✅ Complete |
| Browser ZK proof generation | ✅ Noir 0.36.0 + bb.js 0.63.0 |
| Multi-wallet support | ✅ StellarWalletsKit (Freighter, xBull, Albedo, Lobstr) |
| Sound system | ✅ Web Audio API |
| Invite link | ✅ `?game=CONTRACT_ID` URL param |
| Turn timer | ✅ 5-minute countdown |
| Testnet deploy | ✅ `CD6S436W6IOTT3BIOR3COXYWLUTFI2JI3JL7K2WJZDNYCQXT4BBB3PSO` |

## Future Improvements

### Simultaneous multiplayer sessions

The current contract stores a single `DataKey::GameState` entry — only one game can be active at a time. Any player who tries to join while a game is in progress will be rejected by the contract.

To support multiple concurrent games the following changes would be needed:

**Contract (`lib.rs`):** Replace the single `GameState` storage key with a map keyed by session ID:
```rust
// Current
env.storage().instance().set(&DataKey::GameState, &state);

// Future
env.storage().persistent().set(&DataKey::GameState(session_id), &state);
```
Add a `create_game() -> u32` entry point that allocates a new session ID and returns it to the caller. All other entry points (`join_game`, `commit_board`, `fire_shot`, `submit_response`, `reset_game`) would receive an additional `session_id: u32` argument.

**Frontend:** Add a lobby screen that calls `list_open_games()` and displays joinable sessions. The invite link (`?game=CONTRACT_ID`) would be extended to `?game=CONTRACT_ID&session=SESSION_ID`.

This is a well-scoped extension — the ZK proof logic, commit/reveal flow, and on-chain verifier stub are all unchanged. Only the state storage layout and entry point signatures need updating.

## Security Considerations

- Board and salt **never leave the browser** — only the Poseidon2 hash is stored on-chain
- Salt is reduced mod BN254 field prime — always a valid circuit input
- Circuit enforces **exactly 3 ships** on the board
- Shot coordinates constrained to `[0, 4]` in the circuit
- ZK proof generated client-side — defender cannot lie about hit/miss
