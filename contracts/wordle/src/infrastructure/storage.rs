use soroban_sdk::{contracttype, Address, Env};

use crate::domain::{DomainError, Game};

/// Storage keys for contract data
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Game state by session ID
    Game(u32),
    /// Game Hub contract address
    GameHubAddress,
    /// Verifier adapter contract address
    VerifierAddress,
    /// Admin address
    Admin,
}

/// TTL for game storage (~30 days)
pub const GAME_TTL_LEDGERS: u32 = 518_400;

/// Repository pattern for game persistence
pub struct GameRepository;

impl GameRepository {
    /// Checks if a game exists
    pub fn exists(env: &Env, session_id: u32) -> bool {
        let key = DataKey::Game(session_id);
        env.storage().temporary().has(&key)
    }

    /// Loads a game from storage
    pub fn load(env: &Env, session_id: u32) -> Result<Game, DomainError> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(DomainError::GameNotFound)
    }

    /// Saves a game to storage with TTL extension
    pub fn save(env: &Env, session_id: u32, game: &Game) {
        let key = DataKey::Game(session_id);
        env.storage().temporary().set(&key, game);
        env.storage()
            .temporary()
            .extend_ttl(&key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
    }
}

/// Repository for admin configuration
pub struct AdminRepository;

impl AdminRepository {
    pub fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: &Env, admin: &Address) {
        env.storage().instance().set(&DataKey::Admin, admin);
    }

    pub fn get_game_hub(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set")
    }

    pub fn set_game_hub(env: &Env, address: &Address) {
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, address);
    }

    pub fn get_verifier(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::VerifierAddress)
            .expect("Verifier address not set")
    }

    pub fn set_verifier(env: &Env, address: &Address) {
        env.storage()
            .instance()
            .set(&DataKey::VerifierAddress, address);
    }
}
