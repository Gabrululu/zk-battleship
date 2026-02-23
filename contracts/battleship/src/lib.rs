#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    Address, Bytes, BytesN, Env,
};

const TOTAL_SHIPS: u32 = 3;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    GameState,
    PlayerStats(Address),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PlayerStats {
    pub games_played: u32,
    pub games_won: u32,
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

        assert!(state.phase == GamePhase::WaitingForPlayers, "Game already started");

        if !state.p1_joined {
            state.player1 = player.clone();
            state.p1_joined = true;
        } else {
            assert!(state.player1 != player, "Already joined as P1");
            state.player2 = player.clone();
            state.p2_joined = true;
            state.phase = GamePhase::Commit;
        }

        env.storage().instance().set(&DataKey::GameState, &state);
    }

    pub fn reset_game(env: Env, caller: Address) {
        caller.require_auth();
        // Anyone can reset — simplifies demo flow
        env.storage().instance().remove(&DataKey::GameState);
    }

    pub fn commit_board(env: Env, player: Address, board_hash: BytesN<32>) {
        player.require_auth();

        let mut state = env.storage()
            .instance()
            .get::<DataKey, GameState>(&DataKey::GameState)
            .expect("No game");

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
            panic!("Not a player");
        }

        if state.p1_committed && state.p2_committed {
            state.phase = GamePhase::Playing;
            state.turn = state.player1.clone();
        }

        env.storage().instance().set(&DataKey::GameState, &state);
    }

    pub fn fire_shot(env: Env, shooter: Address, x: u32, y: u32) {
        shooter.require_auth();

        assert!(x < 5, "x out of range");
        assert!(y < 5, "y out of range");

        let mut state = env.storage()
            .instance()
            .get::<DataKey, GameState>(&DataKey::GameState)
            .expect("No game");

        assert!(state.phase == GamePhase::Playing, "Not playing");
        assert!(state.turn == shooter, "Not your turn");
        assert!(state.pending_shot_x == NO_SHOT, "Shot pending");

        state.pending_shot_x = x;
        state.pending_shot_y = y;
        state.pending_shooter = shooter.clone();

        if shooter == state.player1 {
            state.shots_fired_p1 += 1;
        } else {
            state.shots_fired_p2 += 1;
        }

        state.turn = if shooter == state.player1 {
            state.player2.clone()
        } else {
            state.player1.clone()
        };

        env.storage().instance().set(&DataKey::GameState, &state);
    }

    pub fn submit_response(
        env: Env,
        defender: Address,
        x: u32,
        y: u32,
        is_hit: bool,
        proof: Bytes,
    ) {
        defender.require_auth();

        let mut state = env.storage()
            .instance()
            .get::<DataKey, GameState>(&DataKey::GameState)
            .expect("No game");

        assert!(state.phase == GamePhase::Playing, "Not playing");
        assert!(state.pending_shot_x != NO_SHOT, "No pending shot");
        assert!(state.pending_shot_x == x, "x mismatch");
        assert!(state.pending_shot_y == y, "y mismatch");
        assert!(defender != state.pending_shooter, "Shooter can't respond");
        assert!(state.turn == defender, "Not your turn");
        assert!(proof.len() >= 32, "Proof too short");

        // Save shooter before clearing — needed for turn/winner assignment
        let shooter = state.pending_shooter.clone();

        // Clear pending shot
        state.pending_shot_x = NO_SHOT;
        state.pending_shot_y = NO_SHOT;

        if is_hit {
            if defender == state.player1 {
                state.hits_on_p1 += 1;
            } else {
                state.hits_on_p2 += 1;
            }

            let hits = if defender == state.player1 {
                state.hits_on_p1
            } else {
                state.hits_on_p2
            };

            if hits >= TOTAL_SHIPS {
                // Game over — shooter wins
                state.winner = shooter.clone();
                state.has_winner = true;
                state.phase = GamePhase::Finished;

                // Update winner stats
                let mut stats = env.storage()
                    .persistent()
                    .get::<DataKey, PlayerStats>(&DataKey::PlayerStats(shooter.clone()))
                    .unwrap_or(PlayerStats { games_played: 0, games_won: 0 });
                stats.games_played += 1;
                stats.games_won += 1;
                env.storage().persistent().set(&DataKey::PlayerStats(shooter), &stats);

                env.storage().instance().set(&DataKey::GameState, &state);
                return; // ← early return, don't update turn
            }
        }

        // Turn passes back to the shooter to fire again
        state.turn = shooter;
        env.storage().instance().set(&DataKey::GameState, &state);
    }

    // Returns GameState directly — panics (→ simulation error) if not initialized.
    // Frontend catches simulation errors and treats them as "no game yet".
    pub fn get_state(env: Env) -> GameState {
        env.storage()
            .instance()
            .get::<DataKey, GameState>(&DataKey::GameState)
            .expect("No game")
    }

    pub fn get_player_stats(env: Env, player: Address) -> Option<PlayerStats> {
        env.storage()
            .persistent()
            .get::<DataKey, PlayerStats>(&DataKey::PlayerStats(player))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, Address, Address, BattleshipContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, BattleshipContract);
        let client = BattleshipContractClient::new(&env, &id);
        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);
        (env, p1, p2, client)
    }

    fn hash(env: &Env, s: u8) -> BytesN<32> { BytesN::from_array(env, &[s; 32]) }
    fn proof(env: &Env) -> Bytes { Bytes::from_slice(env, &[1u8; 64]) }

    #[test]
    fn test_full_game() {
        let (env, p1, p2, client) = setup();

        client.join_game(&p1);
        client.join_game(&p2);
        assert_eq!(client.get_state().phase, GamePhase::Commit);

        client.commit_board(&p1, &hash(&env, 1));
        client.commit_board(&p2, &hash(&env, 2));
        assert_eq!(client.get_state().phase, GamePhase::Playing);

        // P1 wins by sinking all 3 ships
        for coord in [(0u32, 0u32), (1, 1), (2, 2)] {
            client.fire_shot(&p1, &coord.0, &coord.1);
            client.submit_response(&p2, &coord.0, &coord.1, &true, &proof(&env));
        }

        let state = client.get_state();
        assert_eq!(state.phase, GamePhase::Finished);
        assert_eq!(state.winner, p1);
    }

    #[test]
    fn test_miss_and_reset() {
        let (env, p1, p2, client) = setup();
        client.join_game(&p1);
        client.join_game(&p2);
        client.commit_board(&p1, &hash(&env, 1));
        client.commit_board(&p2, &hash(&env, 2));

        client.fire_shot(&p1, &0, &0);
        client.submit_response(&p2, &0, &0, &false, &proof(&env));

        let state = client.get_state();
        assert_eq!(state.hits_on_p2, 0);
        assert_eq!(state.turn, p1); // back to P1
        assert_eq!(state.pending_shot_x, NO_SHOT);

        client.reset_game(&p1);
    }
}