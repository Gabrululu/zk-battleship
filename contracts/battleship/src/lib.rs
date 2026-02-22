#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    Address, Bytes, BytesN, Env, IntoVal, Symbol, Vec,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_SHIPS: u32 = 3;
const HUB_CONTRACT: &str = "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";

// ─── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    GameState,
    PlayerStats(Address),
    PlayerHistory(Address),
}

// ─── Player stats & history types ─────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct PlayerStats {
    pub games_played: u32,
    pub games_won: u32,
    pub total_shots_fired: u32,
    pub total_shots_received: u32,
    pub total_hits: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct GameResult {
    pub opponent: Address,
    pub won: bool,
    pub shots_fired: u32,
    pub shots_received: u32,
    pub hits_scored: u32,
    pub timestamp: u64,
}

// ─── Game types ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum GamePhase {
    WaitingForPlayers,
    Commit,
    Playing,
    Finished,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct GameState {
    pub player1: Address,
    pub player2: Address,
    pub board_hash_p1: BytesN<32>,
    pub board_hash_p2: BytesN<32>,
    /// How many of P1's ships have been sunk (shots that hit P1's board)
    pub hits_on_p1: u32,
    /// How many of P2's ships have been sunk (shots that hit P2's board)
    pub hits_on_p2: u32,
    /// Total shots fired by P1 (incremented in fire_shot)
    pub shots_fired_p1: u32,
    /// Total shots fired by P2 (incremented in fire_shot)
    pub shots_fired_p2: u32,
    /// Whose turn it is to act (fire or respond)
    pub turn: Address,
    pub phase: GamePhase,
    /// Pending shot coordinates (-1 encoded as u32::MAX when none)
    pub pending_shot_x: u32,
    pub pending_shot_y: u32,
    /// Address of the player who fired the pending shot
    pub pending_shooter: Address,
    pub winner: Address,
    pub has_winner: bool,
    /// Whether P1 has committed their board hash
    pub p1_committed: bool,
    /// Whether P2 has committed their board hash
    pub p2_committed: bool,
    /// Whether P1 has joined
    pub p1_joined: bool,
    /// Whether P2 has joined
    pub p2_joined: bool,
    /// Hub session ID for this game instance
    pub session_id: u32,
}

// Sentinel value meaning "no pending shot"
const NO_SHOT: u32 = u32::MAX;

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct BattleshipContract;

#[contractimpl]
impl BattleshipContract {
    // ── join_game ──────────────────────────────────────────────────────────────
    /// A player calls this to register for the game.
    /// The first caller becomes player1, the second becomes player2.
    /// When both have joined the phase advances to Commit and start_game()
    /// is called on the hub contract.
    pub fn join_game(env: Env, player: Address) {
        player.require_auth();

        let zero_hash: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        let zero_addr = player.clone(); // placeholder; overwritten before use

        let mut state = env.storage().instance().get::<DataKey, GameState>(&DataKey::GameState).unwrap_or(GameState {
            player1: zero_addr.clone(),
            player2: zero_addr.clone(),
            board_hash_p1: zero_hash.clone(),
            board_hash_p2: zero_hash.clone(),
            hits_on_p1: 0,
            hits_on_p2: 0,
            shots_fired_p1: 0,
            shots_fired_p2: 0,
            turn: zero_addr.clone(),
            phase: GamePhase::WaitingForPlayers,
            pending_shot_x: NO_SHOT,
            pending_shot_y: NO_SHOT,
            pending_shooter: zero_addr.clone(),
            winner: zero_addr.clone(),
            has_winner: false,
            p1_committed: false,
            p2_committed: false,
            p1_joined: false,
            p2_joined: false,
            session_id: env.ledger().sequence(),
        });

        assert!(
            state.phase == GamePhase::WaitingForPlayers,
            "Game already started"
        );

        if !state.p1_joined {
            state.player1 = player.clone();
            state.p1_joined = true;
        } else {
            assert!(state.player1 != player, "Player already joined");
            state.player2 = player.clone();
            state.p2_joined = true;
            state.phase = GamePhase::Commit;
            Self::call_hub_start(&env, &state);
        }

        env.storage().instance().set(&DataKey::GameState, &state);
    }

    // ── commit_board ───────────────────────────────────────────────────────────
    /// A player commits their board hash (Poseidon2 hash of board + salt).
    /// When both players have committed, the phase advances to Playing.
    pub fn commit_board(env: Env, player: Address, board_hash: BytesN<32>) {
        player.require_auth();

        let mut state = Self::load_state(&env);
        assert!(state.phase == GamePhase::Commit, "Not in commit phase");

        if player == state.player1 {
            assert!(!state.p1_committed, "P1 already committed");
            state.board_hash_p1 = board_hash;
            state.p1_committed = true;
        } else if player == state.player2 {
            assert!(!state.p2_committed, "P2 already committed");
            state.board_hash_p2 = board_hash;
            state.p2_committed = true;
        } else {
            panic!("Unknown player");
        }

        if state.p1_committed && state.p2_committed {
            state.phase = GamePhase::Playing;
            state.turn = state.player1.clone();
        }

        env.storage().instance().set(&DataKey::GameState, &state);
    }

    // ── fire_shot ──────────────────────────────────────────────────────────────
    /// The attacker fires at coordinates (x, y) on the defender's board.
    /// Stores the shot as pending; the defender must respond with a ZK proof.
    pub fn fire_shot(env: Env, shooter: Address, x: u32, y: u32) {
        shooter.require_auth();

        assert!(x < 5, "x out of range");
        assert!(y < 5, "y out of range");

        let mut state = Self::load_state(&env);
        assert!(state.phase == GamePhase::Playing, "Not in playing phase");
        assert!(state.turn == shooter, "Not your turn");
        assert!(state.pending_shot_x == NO_SHOT, "A shot is already pending");

        state.pending_shot_x = x;
        state.pending_shot_y = y;
        state.pending_shooter = shooter.clone();

        // Track shots fired per player
        if shooter == state.player1 {
            state.shots_fired_p1 += 1;
        } else {
            state.shots_fired_p2 += 1;
        }

        // Turn passes to the defender so they can respond
        state.turn = Self::other_player(&state, &shooter);

        env.storage().instance().set(&DataKey::GameState, &state);
    }

    // ── submit_response ────────────────────────────────────────────────────────
    /// The defender responds to the pending shot with a ZK proof.
    /// proof: raw bytes of the Ultrahonk proof generated in the browser.
    pub fn submit_response(
        env: Env,
        defender: Address,
        x: u32,
        y: u32,
        is_hit: bool,
        proof: Bytes,
    ) {
        defender.require_auth();

        let mut state = Self::load_state(&env);
        assert!(state.phase == GamePhase::Playing, "Not in playing phase");
        assert!(state.pending_shot_x != NO_SHOT, "No pending shot");
        assert!(state.pending_shot_x == x, "Shot x mismatch");
        assert!(state.pending_shot_y == y, "Shot y mismatch");
        assert!(defender != state.pending_shooter, "Shooter cannot respond");
        assert!(state.turn == defender, "Not your turn to respond");

        // Determine which board hash belongs to the defender
        let board_hash = if defender == state.player1 {
            state.board_hash_p1.clone()
        } else if defender == state.player2 {
            state.board_hash_p2.clone()
        } else {
            panic!("Unknown defender");
        };

        // ── ZK Proof Verification ──────────────────────────────────────────────
        // Public inputs layout (must match the Noir circuit):
        //   [0]    board_hash  (32 bytes as Field)
        //   [1]    shot_x      (u8 as Field)
        //   [2]    shot_y      (u8 as Field)
        //   [3]    is_hit      (bool as Field: 0 or 1)
        //
        // NOTE: In production this calls the on-chain Ultrahonk verifier.
        // The verifier contract address must be set and the call wired up.
        // For the stub phase, we accept any non-empty proof.
        Self::verify_zk_proof(&env, &proof, &board_hash, x, y, is_hit);

        // ── Update game state ──────────────────────────────────────────────────
        // Clear pending shot
        state.pending_shot_x = NO_SHOT;
        state.pending_shot_y = NO_SHOT;

        if is_hit {
            if defender == state.player1 {
                state.hits_on_p1 += 1;
            } else {
                state.hits_on_p2 += 1;
            }

            // Check win condition
            let hits_on_defender = if defender == state.player1 {
                state.hits_on_p1
            } else {
                state.hits_on_p2
            };

            if hits_on_defender >= TOTAL_SHIPS {
                let winner = state.pending_shooter.clone();
                state.winner = winner.clone();
                state.has_winner = true;
                state.phase = GamePhase::Finished;
                let player1_won = state.winner == state.player1;
                Self::record_result(&env, &state);
                Self::call_hub_end(&env, state.session_id, player1_won);
                env.storage().instance().set(&DataKey::GameState, &state);
                return;
            }
        }

        // Turn passes back to the original shooter to fire again
        state.turn = state.pending_shooter.clone();

        env.storage().instance().set(&DataKey::GameState, &state);
    }

    // ── get_state ──────────────────────────────────────────────────────────────
    pub fn get_state(env: Env) -> Option<GameState> {
        env.storage()
            .instance()
            .get::<DataKey, GameState>(&DataKey::GameState)
    }

    // ── get_player_stats ───────────────────────────────────────────────────────
    pub fn get_player_stats(env: Env, player: Address) -> Option<PlayerStats> {
        env.storage()
            .persistent()
            .get::<DataKey, PlayerStats>(&DataKey::PlayerStats(player))
    }

    // ── get_player_history ─────────────────────────────────────────────────────
    pub fn get_player_history(env: Env, player: Address) -> Vec<GameResult> {
        env.storage()
            .persistent()
            .get::<DataKey, Vec<GameResult>>(&DataKey::PlayerHistory(player))
            .unwrap_or(Vec::new(&env))
    }

    // ─── Internal helpers ──────────────────────────────────────────────────────

    fn record_result(env: &Env, state: &GameState) {
        let winner = &state.winner;
        let loser = if winner == &state.player1 {
            &state.player2
        } else {
            &state.player1
        };

        let (winner_shots, loser_shots) = if winner == &state.player1 {
            (state.shots_fired_p1, state.shots_fired_p2)
        } else {
            (state.shots_fired_p2, state.shots_fired_p1)
        };

        let ts = env.ledger().timestamp();

        // ── Update winner stats ────────────────────────────────────────────────
        let mut ws = env.storage()
            .persistent()
            .get::<DataKey, PlayerStats>(&DataKey::PlayerStats(winner.clone()))
            .unwrap_or(PlayerStats {
                games_played: 0, games_won: 0,
                total_shots_fired: 0, total_shots_received: 0, total_hits: 0,
            });
        ws.games_played += 1;
        ws.games_won += 1;
        ws.total_shots_fired += winner_shots;
        ws.total_shots_received += loser_shots;
        ws.total_hits += TOTAL_SHIPS;
        env.storage().persistent().set(&DataKey::PlayerStats(winner.clone()), &ws);

        // ── Update loser stats ─────────────────────────────────────────────────
        let mut ls = env.storage()
            .persistent()
            .get::<DataKey, PlayerStats>(&DataKey::PlayerStats(loser.clone()))
            .unwrap_or(PlayerStats {
                games_played: 0, games_won: 0,
                total_shots_fired: 0, total_shots_received: 0, total_hits: 0,
            });
        ls.games_played += 1;
        ls.total_shots_fired += loser_shots;
        ls.total_shots_received += winner_shots;
        env.storage().persistent().set(&DataKey::PlayerStats(loser.clone()), &ls);

        // ── Append to winner history ───────────────────────────────────────────
        let mut wh = env.storage()
            .persistent()
            .get::<DataKey, Vec<GameResult>>(&DataKey::PlayerHistory(winner.clone()))
            .unwrap_or(Vec::new(env));
        wh.push_back(GameResult {
            opponent: loser.clone(),
            won: true,
            shots_fired: winner_shots,
            shots_received: loser_shots,
            hits_scored: TOTAL_SHIPS,
            timestamp: ts,
        });
        env.storage().persistent().set(&DataKey::PlayerHistory(winner.clone()), &wh);

        // ── Append to loser history ────────────────────────────────────────────
        let mut lh = env.storage()
            .persistent()
            .get::<DataKey, Vec<GameResult>>(&DataKey::PlayerHistory(loser.clone()))
            .unwrap_or(Vec::new(env));
        lh.push_back(GameResult {
            opponent: winner.clone(),
            won: false,
            shots_fired: loser_shots,
            shots_received: winner_shots,
            hits_scored: 0,
            timestamp: ts,
        });
        env.storage().persistent().set(&DataKey::PlayerHistory(loser.clone()), &lh);
    }

    fn load_state(env: &Env) -> GameState {
        env.storage()
            .instance()
            .get::<DataKey, GameState>(&DataKey::GameState)
            .expect("Game not initialized")
    }

    fn other_player(state: &GameState, player: &Address) -> Address {
        if player == &state.player1 {
            state.player2.clone()
        } else {
            state.player1.clone()
        }
    }

    /// ZK proof verification.
    ///
    /// STUB PHASE: accepts any non-empty proof bytes.
    /// PRODUCTION: invoke the on-chain Ultrahonk verifier contract.
    ///
    /// To wire up the real verifier, replace the body with:
    ///
    /// ```rust
    /// let verifier: Address = Address::from_str(env, VERIFIER_CONTRACT);
    /// let mut public_inputs: Vec<Bytes> = Vec::new(env);
    /// // pack board_hash, x, y, is_hit as 32-byte big-endian Fields
    /// public_inputs.push_back(bytes_from_field(env, board_hash));
    /// public_inputs.push_back(bytes_from_u32(env, x));
    /// public_inputs.push_back(bytes_from_u32(env, y));
    /// public_inputs.push_back(bytes_from_bool(env, is_hit));
    /// let result: bool = env.invoke_contract(
    ///     &verifier,
    ///     &Symbol::new(env, "verify"),
    ///     soroban_sdk::vec![env, proof.into_val(env), public_inputs.into_val(env)],
    /// );
    /// assert!(result, "INVALID_PROOF");
    /// ```
    fn verify_zk_proof(
        env: &Env,
        proof: &Bytes,
        _board_hash: &BytesN<32>,
        _x: u32,
        _y: u32,
        _is_hit: bool,
    ) {
        // Stub: require a plausible proof size (>= 32 bytes).
        // Replace with real Ultrahonk verifier call in Step 3.
        assert!(proof.len() >= 32, "INVALID_PROOF: proof too short");

        // Emit an event visible in stellar.expert explorer
        env.events().publish(
            (Symbol::new(env, "zk_verified"),),
            proof.len(),
        );
    }

    fn call_hub_start(env: &Env, state: &GameState) {
        let hub: Address = Address::from_str(env, HUB_CONTRACT);
        let game_id = env.current_contract_address();
        let args = soroban_sdk::vec![
            env,
            game_id.into_val(env),
            state.session_id.into_val(env),
            state.player1.into_val(env),
            state.player2.into_val(env),
            0i128.into_val(env),
            0i128.into_val(env),
        ];
        env.invoke_contract::<()>(&hub, &Symbol::new(env, "start_game"), args);
    }

    fn call_hub_end(env: &Env, session_id: u32, player1_won: bool) {
        let hub: Address = Address::from_str(env, HUB_CONTRACT);
        let args = soroban_sdk::vec![
            env,
            session_id.into_val(env),
            player1_won.into_val(env),
        ];
        env.invoke_contract::<()>(&hub, &Symbol::new(env, "end_game"), args);
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, Address, Address, BattleshipContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, BattleshipContract);
        let client = BattleshipContractClient::new(&env, &contract_id);
        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);
        (env, p1, p2, client)
    }

    fn dummy_hash(env: &Env, seed: u8) -> BytesN<32> {
        BytesN::from_array(env, &[seed; 32])
    }

    fn dummy_proof(env: &Env) -> Bytes {
        Bytes::from_slice(env, &[0xde, 0xad, 0xbe, 0xef])
    }

    #[test]
    fn test_join_and_commit() {
        let (env, p1, p2, client) = setup();

        client.join_game(&p1);
        client.join_game(&p2);

        let state = client.get_state();
        assert_eq!(state.phase, GamePhase::Commit);

        client.commit_board(&p1, &dummy_hash(&env, 1));
        client.commit_board(&p2, &dummy_hash(&env, 2));

        let state = client.get_state();
        assert_eq!(state.phase, GamePhase::Playing);
        assert_eq!(state.turn, p1);
    }

    #[test]
    fn test_fire_and_respond_miss() {
        let (env, p1, p2, client) = setup();

        client.join_game(&p1);
        client.join_game(&p2);
        client.commit_board(&p1, &dummy_hash(&env, 1));
        client.commit_board(&p2, &dummy_hash(&env, 2));

        // P1 fires at (0,0)
        client.fire_shot(&p1, &0, &0);

        let state = client.get_state();
        assert_eq!(state.pending_shot_x, 0);
        assert_eq!(state.pending_shot_y, 0);
        assert_eq!(state.turn, p2); // P2 must respond

        // P2 responds: miss
        client.submit_response(&p2, &0, &0, &false, &dummy_proof(&env));

        let state = client.get_state();
        assert_eq!(state.hits_on_p2, 0);
        assert_eq!(state.turn, p1); // back to P1 to fire
        assert_eq!(state.pending_shot_x, NO_SHOT);
    }

    #[test]
    fn test_fire_and_respond_hit() {
        let (env, p1, p2, client) = setup();

        client.join_game(&p1);
        client.join_game(&p2);
        client.commit_board(&p1, &dummy_hash(&env, 1));
        client.commit_board(&p2, &dummy_hash(&env, 2));

        client.fire_shot(&p1, &2, &3);
        client.submit_response(&p2, &2, &3, &true, &dummy_proof(&env));

        let state = client.get_state();
        assert_eq!(state.hits_on_p2, 1);
        assert_eq!(state.phase, GamePhase::Playing);
    }

    #[test]
    fn test_win_condition() {
        let (env, p1, p2, client) = setup();

        client.join_game(&p1);
        client.join_game(&p2);
        client.commit_board(&p1, &dummy_hash(&env, 1));
        client.commit_board(&p2, &dummy_hash(&env, 2));

        // P1 sinks all 3 of P2's ships
        for shot in [(0u32, 0u32), (1, 1), (2, 2)] {
            client.fire_shot(&p1, &shot.0, &shot.1);
            client.submit_response(&p2, &shot.0, &shot.1, &true, &dummy_proof(&env));
        }

        let state = client.get_state();
        assert_eq!(state.phase, GamePhase::Finished);
        assert!(state.has_winner);
        assert_eq!(state.winner, p1);
        assert_eq!(state.hits_on_p2, 3);
    }
}
