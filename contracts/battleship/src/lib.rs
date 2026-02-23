#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    Address, Bytes, BytesN, Env, IntoVal, Symbol, Vec,
    String,
};

const TOTAL_SHIPS: u32 = 3;
// Asegúrate de que este ID sea válido en Testnet o cámbialo por uno real de tu entorno
const HUB_CONTRACT: &str = "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    GameState,
    PlayerStats(Address),
    PlayerHistory(Address),
}

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
    pub board_hash_p1: BytesN<32>,
    pub board_hash_p2: BytesN<32>,
    pub has_winner: bool,
    pub hits_on_p1: u32,
    pub hits_on_p2: u32,
    pub p1_committed: bool,
    pub p1_joined: bool,
    pub p2_committed: bool,
    pub p2_joined: bool,
    pub pending_shooter: Address,
    pub pending_shot_x: u32,
    pub pending_shot_y: u32,
    pub phase: GamePhase,
    pub player1: Address,
    pub player2: Address,
    pub session_id: u32,
    pub shots_fired_p1: u32,
    pub shots_fired_p2: u32,
    pub turn: Address,
    pub winner: Address,
}

const NO_SHOT: u32 = u32::MAX;

#[contract]
pub struct BattleshipContract;

#[contractimpl]
impl BattleshipContract {

    pub fn join_game(env: Env, player: Address) {
        player.require_auth();

        let zero_hash: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        
        let mut state = env.storage()
            .instance()
            .get::<DataKey, GameState>(&DataKey::GameState)
            .unwrap_or(GameState {
                player1: player.clone(),
                player2: player.clone(),
                board_hash_p1: zero_hash.clone(),
                board_hash_p2: zero_hash.clone(),
                hits_on_p1: 0,
                hits_on_p2: 0,
                shots_fired_p1: 0,
                shots_fired_p2: 0,
                turn: player.clone(),
                phase: GamePhase::WaitingForPlayers,
                pending_shot_x: NO_SHOT,
                pending_shot_y: NO_SHOT,
                pending_shooter: player.clone(),
                winner: player.clone(),
                has_winner: false,
                p1_committed: false,
                p2_committed: false,
                p1_joined: false,
                p2_joined: false,
                session_id: env.ledger().sequence(),
            });

        if state.phase != GamePhase::WaitingForPlayers {
            panic!("Game already started");
        }

        if !state.p1_joined {
            state.player1 = player.clone();
            state.p1_joined = true;
        } else {
            if state.player1 == player {
                panic!("Player already joined as P1");
            }
            state.player2 = player.clone();
            state.p2_joined = true;
            state.phase = GamePhase::Commit;

            Self::try_hub_start(&env, state.session_id, &state.player1, &state.player2);
        }

        env.storage().instance().set(&DataKey::GameState, &state);
    }

    pub fn reset_game(env: Env, caller: Address) {
        caller.require_auth();
        if let Some(state) = env.storage().instance().get::<DataKey, GameState>(&DataKey::GameState) {
            assert!(caller == state.player1 || caller == state.player2, "Unauthorized reset");
        }
        env.storage().instance().remove(&DataKey::GameState);
    }

    pub fn commit_board(env: Env, player: Address, board_hash: BytesN<32>) {
        player.require_auth();
        let mut state = Self::load_state(&env);
        assert!(state.phase == GamePhase::Commit, "Not in commit phase");

        if player == state.player1 {
            state.board_hash_p1 = board_hash;
            state.p1_committed = true;
        } else if player == state.player2 {
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

    pub fn fire_shot(env: Env, shooter: Address, x: u32, y: u32) {
        shooter.require_auth();
        assert!(x < 5 && y < 5, "Coordinates out of bounds");
        
        let mut state = Self::load_state(&env);
        assert!(state.phase == GamePhase::Playing, "Not in playing phase");
        assert!(state.turn == shooter, "Not your turn");
        assert!(state.pending_shot_x == NO_SHOT, "A shot is already pending");

        state.pending_shot_x = x;
        state.pending_shot_y = y;
        state.pending_shooter = shooter.clone();
        
        if shooter == state.player1 {
            state.shots_fired_p1 += 1;
        } else {
            state.shots_fired_p2 += 1;
        }
        
        state.turn = Self::other_player(&state, &shooter);
        env.storage().instance().set(&DataKey::GameState, &state);
    }

    pub fn submit_response(env: Env, defender: Address, x: u32, y: u32, is_hit: bool, proof: Bytes) {
        defender.require_auth();
        let mut state = Self::load_state(&env);

        assert!(state.phase == GamePhase::Playing, "Game not in playing phase");
        assert!(state.pending_shot_x == x && state.pending_shot_y == y, "Shot mismatch");
        assert!(state.turn == defender, "Not your turn to respond");

        let board_hash = if defender == state.player1 {
            state.board_hash_p1.clone()
        } else {
            state.board_hash_p2.clone()
        };

        // Verificación Placeholder para evitar el trap de VM
        Self::verify_zk_proof(&env, &proof, &board_hash, x, y, is_hit);

        state.pending_shot_x = NO_SHOT;
        state.pending_shot_y = NO_SHOT;

        if is_hit {
            if defender == state.player1 {
                state.hits_on_p1 += 1;
            } else {
                state.hits_on_p2 += 1;
            }
            
            let hits = if defender == state.player1 { state.hits_on_p1 } else { state.hits_on_p2 };
            if hits >= TOTAL_SHIPS {
                state.winner = state.pending_shooter.clone();
                state.has_winner = true;
                state.phase = GamePhase::Finished;
                Self::record_result(&env, &state);
                Self::try_hub_end(&env, state.session_id, state.winner == state.player1);
            }
        }

        state.turn = state.pending_shooter.clone();
        env.storage().instance().set(&DataKey::GameState, &state);
    }

    pub fn get_state(env: Env) -> GameState {
        Self::load_state(&env)
    }

    pub fn get_player_stats(env: Env, player: Address) -> Option<PlayerStats> {
        env.storage().persistent().get(&DataKey::PlayerStats(player))
    }

    pub fn get_player_history(env: Env, player: Address) -> Vec<GameResult> {
        env.storage().persistent().get(&DataKey::PlayerHistory(player)).unwrap_or(Vec::new(&env))
    }

    // ─── Helpers ──────────────────────────────────────────────────────

    fn load_state(env: &Env) -> GameState {
        env.storage().instance().get(&DataKey::GameState).expect("Game not initialized")
    }

    fn other_player(state: &GameState, player: &Address) -> Address {
        if player == &state.player1 { state.player2.clone() } else { state.player1.clone() }
    }

    fn verify_zk_proof(env: &Env, proof: &Bytes, _hash: &BytesN<32>, _x: u32, _y: u32, _hit: bool) {
        if proof.len() < 32 {
            panic!("ZK_VERIFY_FAILED: Proof too short or missing");
        }
        env.events().publish((Symbol::new(env, "zk_ok"),), proof.len());
    }

    fn try_hub_start(env: &Env, session_id: u32, p1: &Address, p2: &Address) {
        let hub = Address::from_string(&String::from_str(env, HUB_CONTRACT));
        let args = soroban_sdk::vec![env, env.current_contract_address().into_val(env), session_id.into_val(env), p1.into_val(env), p2.into_val(env), 0i128.into_val(env), 0i128.into_val(env)];
        let _ = env.try_invoke_contract::<(), soroban_sdk::Error>(&hub, &Symbol::new(env, "start_game"), args);
    }

    fn try_hub_end(env: &Env, session_id: u32, p1_won: bool) {
        let hub = Address::from_string(&String::from_str(env, HUB_CONTRACT));
        let args = soroban_sdk::vec![env, session_id.into_val(env), p1_won.into_val(env)];
        let _ = env.try_invoke_contract::<(), soroban_sdk::Error>(&hub, &Symbol::new(env, "end_game"), args);
    }

    fn record_result(env: &Env, state: &GameState) {        
        let (winner, _loser) = if state.winner == state.player1 { 
            (&state.player1, &state.player2) 
        } else { 
            (&state.player2, &state.player1) 
        };

        let mut ws = env.storage().persistent()
            .get::<DataKey, PlayerStats>(&DataKey::PlayerStats(winner.clone()))
            .unwrap_or(PlayerStats { 
                games_played: 0, 
                games_won: 0, 
                total_shots_fired: 0, 
                total_shots_received: 0, 
                total_hits: 0 
            });

        ws.games_played += 1; 
        ws.games_won += 1;
        
        env.storage().persistent().set(&DataKey::PlayerStats(winner.clone()), &ws);
    }
}