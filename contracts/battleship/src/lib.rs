#![no_std]

mod error;
mod interfaces;
mod storage;
mod types;

pub use error::Error;
pub use types::{Game, GamePhase, GameRules, ShotResult, ShipType};

use soroban_sdk::{contract, contractimpl, vec, Address, Bytes, BytesN, Env, IntoVal};

use interfaces::{BattleshipVerifierClient, GameHubClient};
use storage::{load_game, save_game, DataKey, BOARD_SIZE, SHIP_BATTLESHIP_LEN, SHIP_CARRIER_LEN,
              SHIP_CRUISER_LEN, SHIP_DESTROYER_LEN, SHIP_SUBMARINE_LEN, TOTAL_SHIP_CELLS};

#[contract]
pub struct BattleshipContract;

#[contractimpl]
impl BattleshipContract {
    pub fn __constructor(env: Env, admin: Address, game_hub: Address, verifier: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
        env.storage()
            .instance()
            .set(&DataKey::VerifierAddress, &verifier);
    }

    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        if player1 == player2 {
            return Err(Error::SelfPlayNotAllowed);
        }

        let key = DataKey::Game(session_id);
        if env.storage().temporary().has(&key) {
            return Err(Error::GameAlreadyExists);
        }

        player1.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player1_points.into_val(&env),
        ]);
        player2.require_auth_for_args(vec![
            &env,
            session_id.into_val(&env),
            player2_points.into_val(&env),
        ]);

        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);

        // Required ordering: notify hub first.
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        let game = Game {
            player1,
            player2,
            player1_points,
            player2_points,
            phase: GamePhase::WaitingForBoards,
            turn: None,
            board_commitment_p1: None,
            board_commitment_p2: None,
            pending_shot_shooter: None,
            pending_shot_x: 0,
            pending_shot_y: 0,
            shots_p1_to_p2: 0,
            shots_p2_to_p1: 0,
            hits_on_p1: 0,
            hits_on_p2: 0,
            sunk_ships_on_p1: 0,
            sunk_ships_on_p2: 0,
            winner: None,
            last_resolved_shooter: None,
            last_resolved_x: 0,
            last_resolved_y: 0,
            last_resolved_is_hit: false,
            last_resolved_sunk_ship: 0,
        };

        save_game(&env, &key, &game);
        Ok(())
    }

    pub fn commit_board(
        env: Env,
        session_id: u32,
        player: Address,
        board_commitment: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game = load_game(&env, &key)?;

        if game.phase == GamePhase::Ended {
            return Err(Error::GameAlreadyEnded);
        }

        if game.phase != GamePhase::WaitingForBoards {
            return Err(Error::InvalidPhase);
        }

        if player == game.player1 {
            if game.board_commitment_p1.is_some() {
                return Err(Error::BoardAlreadyCommitted);
            }
            game.board_commitment_p1 = Some(board_commitment);
        } else if player == game.player2 {
            if game.board_commitment_p2.is_some() {
                return Err(Error::BoardAlreadyCommitted);
            }
            game.board_commitment_p2 = Some(board_commitment);
        } else {
            return Err(Error::NotPlayer);
        }

        if game.board_commitment_p1.is_some() && game.board_commitment_p2.is_some() {
            game.phase = GamePhase::InProgress;
            // Deterministic first turn.
            game.turn = Some(game.player1.clone());
        }

        save_game(&env, &key, &game);
        Ok(())
    }

    pub fn fire(env: Env, session_id: u32, shooter: Address, x: u32, y: u32) -> Result<(), Error> {
        shooter.require_auth();

        let key = DataKey::Game(session_id);
        let mut game = load_game(&env, &key)?;

        if game.phase == GamePhase::Ended {
            return Err(Error::GameAlreadyEnded);
        }

        if game.phase != GamePhase::InProgress {
            return Err(Error::InvalidPhase);
        }

        if game.pending_shot_shooter.is_some() {
            return Err(Error::PendingShotExists);
        }

        let turn = game.turn.clone().ok_or(Error::InvalidPhase)?;
        if shooter != turn {
            return Err(Error::NotYourTurn);
        }

        let bit = Self::coord_to_bit(x, y)?;

        // Duplicate shot check against already resolved shots.
        if shooter == game.player1 {
            if game.shots_p1_to_p2 & bit != 0 {
                return Err(Error::ShotAlreadyResolved);
            }
        } else if shooter == game.player2 {
            if game.shots_p2_to_p1 & bit != 0 {
                return Err(Error::ShotAlreadyResolved);
            }
        } else {
            return Err(Error::NotPlayer);
        }

        // Clear last resolved so only the most recent resolve is visible to shooter.
        game.last_resolved_shooter = None;
        game.last_resolved_x = 0;
        game.last_resolved_y = 0;
        game.last_resolved_is_hit = false;
        game.last_resolved_sunk_ship = 0;

        game.pending_shot_shooter = Some(shooter);
        game.pending_shot_x = x;
        game.pending_shot_y = y;
        save_game(&env, &key, &game);

        Ok(())
    }

    pub fn resolve_shot(
        env: Env,
        session_id: u32,
        defender: Address,
        is_hit: bool,
        sunk_ship: u32,
        proof_payload: Bytes,
        public_inputs_hash: BytesN<32>,
    ) -> Result<ShotResult, Error> {
        let key = DataKey::Game(session_id);
        let mut game = load_game(&env, &key)?;

        if game.phase == GamePhase::Ended {
            return Err(Error::GameAlreadyEnded);
        }

        if game.phase != GamePhase::InProgress {
            return Err(Error::InvalidPhase);
        }

        let shooter = game
            .pending_shot_shooter
            .clone()
            .ok_or(Error::NoPendingShot)?;
        let shot_x = game.pending_shot_x;
        let shot_y = game.pending_shot_y;

        let expected_defender = Self::opponent(&game, &shooter)?;
        if defender != expected_defender {
            return Err(Error::InvalidDefender);
        }

        let ship = Self::parse_ship_type(sunk_ship)?;
        if ship.is_some() && !is_hit {
            return Err(Error::InvalidSunkShip);
        }

        let bit = Self::coord_to_bit(shot_x, shot_y)?;
        if shooter == game.player1 {
            if game.shots_p1_to_p2 & bit != 0 {
                return Err(Error::ShotAlreadyResolved);
            }
        } else {
            if game.shots_p2_to_p1 & bit != 0 {
                return Err(Error::ShotAlreadyResolved);
            }
        }

        let board_commitment = if defender == game.player1 {
            game.board_commitment_p1
                .clone()
                .ok_or(Error::BoardNotCommitted)?
        } else {
            game.board_commitment_p2
                .clone()
                .ok_or(Error::BoardNotCommitted)?
        };

        let expected_hash = Self::build_public_inputs_hash_internal(
            &env,
            session_id,
            defender.clone(),
            shooter.clone(),
            shot_x,
            shot_y,
            is_hit,
            sunk_ship,
            board_commitment.clone(),
        );

        if expected_hash != public_inputs_hash {
            return Err(Error::InvalidPublicInputsHash);
        }

        let verifier_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::VerifierAddress)
            .expect("Verifier address not set");
        let verifier = BattleshipVerifierClient::new(&env, &verifier_addr);
        if !verifier.verify(&board_commitment, &public_inputs_hash, &proof_payload) {
            return Err(Error::InvalidProof);
        }

        // Mark shot as resolved.
        if shooter == game.player1 {
            game.shots_p1_to_p2 |= bit;
        } else {
            game.shots_p2_to_p1 |= bit;
        }

        if is_hit {
            if defender == game.player1 {
                game.hits_on_p1 += 1;
                if game.hits_on_p1 > TOTAL_SHIP_CELLS {
                    return Err(Error::TooManyHits);
                }
            } else {
                game.hits_on_p2 += 1;
                if game.hits_on_p2 > TOTAL_SHIP_CELLS {
                    return Err(Error::TooManyHits);
                }
            }
        }

        if let Some(ship_kind) = ship.clone() {
            let bit = Self::ship_bit(ship_kind);
            if defender == game.player1 {
                if game.sunk_ships_on_p1 & bit != 0 {
                    return Err(Error::ShipAlreadySunk);
                }
                game.sunk_ships_on_p1 |= bit;
            } else {
                if game.sunk_ships_on_p2 & bit != 0 {
                    return Err(Error::ShipAlreadySunk);
                }
                game.sunk_ships_on_p2 |= bit;
            }
        }

        let defender_hits = if defender == game.player1 {
            game.hits_on_p1
        } else {
            game.hits_on_p2
        };

        let mut winner: Option<Address> = None;
        let mut next_turn: Option<Address> = None;

        if defender_hits >= TOTAL_SHIP_CELLS {
            // Required ordering: end in hub before final winner state.
            let game_hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .expect("GameHub address not set");
            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            let player1_won = shooter == game.player1;
            game_hub.end_game(&session_id, &player1_won);

            game.phase = GamePhase::Ended;
            game.winner = Some(shooter.clone());
            game.turn = None;
            winner = Some(shooter.clone());
        } else {
            game.turn = Some(defender.clone());
            next_turn = Some(defender);
        }

        // Expose last resolved shot so shooter can learn result from get_game().
        game.last_resolved_shooter = Some(shooter.clone());
        game.last_resolved_x = shot_x;
        game.last_resolved_y = shot_y;
        game.last_resolved_is_hit = is_hit;
        game.last_resolved_sunk_ship = sunk_ship;

        game.pending_shot_shooter = None;
        save_game(&env, &key, &game);

        Ok(ShotResult {
            is_hit,
            sunk_ship,
            winner,
            next_turn,
        })
    }

    pub fn build_public_inputs_hash(
        env: Env,
        session_id: u32,
        defender: Address,
        shooter: Address,
        x: u32,
        y: u32,
        is_hit: bool,
        sunk_ship: u32,
        board_commitment: BytesN<32>,
    ) -> BytesN<32> {
        Self::build_public_inputs_hash_internal(
            &env,
            session_id,
            defender,
            shooter,
            x,
            y,
            is_hit,
            sunk_ship,
            board_commitment,
        )
    }

    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        let key = DataKey::Game(session_id);
        load_game(&env, &key)
    }

    /// Notify the Game Hub that the game has ended. Idempotent; safe to call when the game
    /// is already in Ended state (e.g. if hub was not notified during resolve_shot).
    pub fn notify_game_ended_to_hub(env: Env, session_id: u32) -> Result<(), Error> {
        let key = DataKey::Game(session_id);
        let game = load_game(&env, &key)?;
        if game.phase != GamePhase::Ended {
            return Err(Error::InvalidPhase);
        }
        let winner = game.winner.ok_or(Error::InvalidPhase)?;
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);
        let player1_won = winner == game.player1;
        game_hub.end_game(&session_id, &player1_won);
        Ok(())
    }

    pub fn get_rules(_env: Env) -> GameRules {
        GameRules {
            board_size: BOARD_SIZE,
            carrier_len: SHIP_CARRIER_LEN,
            battleship_len: SHIP_BATTLESHIP_LEN,
            cruiser_len: SHIP_CRUISER_LEN,
            submarine_len: SHIP_SUBMARINE_LEN,
            destroyer_len: SHIP_DESTROYER_LEN,
            total_ship_cells: TOTAL_SHIP_CELLS,
        }
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set")
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    pub fn get_verifier(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::VerifierAddress)
            .expect("Verifier address not set")
    }

    pub fn set_verifier(env: Env, new_verifier: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::VerifierAddress, &new_verifier);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    fn build_public_inputs_hash_internal(
        env: &Env,
        session_id: u32,
        defender: Address,
        shooter: Address,
        x: u32,
        y: u32,
        is_hit: bool,
        sunk_ship: u32,
        board_commitment: BytesN<32>,
    ) -> BytesN<32> {
        let mut fixed = [0u8; 17];
        fixed[0..4].copy_from_slice(&session_id.to_be_bytes());
        fixed[4..8].copy_from_slice(&x.to_be_bytes());
        fixed[8..12].copy_from_slice(&y.to_be_bytes());
        fixed[12] = if is_hit { 1 } else { 0 };
        fixed[13..17].copy_from_slice(&sunk_ship.to_be_bytes());

        let mut payload = Bytes::from_array(env, &fixed);
        payload.append(&Bytes::from_array(env, &board_commitment.to_array()));
        payload.append(&defender.to_string().to_bytes());
        payload.append(&shooter.to_string().to_bytes());
        env.crypto().keccak256(&payload).into()
    }

    fn opponent(game: &Game, player: &Address) -> Result<Address, Error> {
        if *player == game.player1 {
            Ok(game.player2.clone())
        } else if *player == game.player2 {
            Ok(game.player1.clone())
        } else {
            Err(Error::NotPlayer)
        }
    }

    fn coord_to_bit(x: u32, y: u32) -> Result<u128, Error> {
        if x >= BOARD_SIZE || y >= BOARD_SIZE {
            return Err(Error::InvalidCoordinate);
        }

        let index = y * BOARD_SIZE + x;
        Ok(1u128 << index)
    }

    fn parse_ship_type(raw: u32) -> Result<Option<ShipType>, Error> {
        match raw {
            0 => Ok(None),
            1 => Ok(Some(ShipType::Carrier)),
            2 => Ok(Some(ShipType::Battleship)),
            3 => Ok(Some(ShipType::Cruiser)),
            4 => Ok(Some(ShipType::Submarine)),
            5 => Ok(Some(ShipType::Destroyer)),
            _ => Err(Error::InvalidShipType),
        }
    }

    fn ship_bit(ship: ShipType) -> u32 {
        match ship {
            ShipType::Carrier => 1 << 0,
            ShipType::Battleship => 1 << 1,
            ShipType::Cruiser => 1 << 2,
            ShipType::Submarine => 1 << 3,
            ShipType::Destroyer => 1 << 4,
        }
    }
}

#[cfg(test)]
mod test;
