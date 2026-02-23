use soroban_sdk::{contracttype, Env};

use crate::error::Error;
use crate::types::Game;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),
    GameHubAddress,
    VerifierAddress,
    Admin,
}

pub const GAME_TTL_LEDGERS: u32 = 518_400;
pub const BOARD_SIZE: u32 = 10;
pub const TOTAL_SHIP_CELLS: u32 = 17;
pub const SHIP_CARRIER_LEN: u32 = 5;
pub const SHIP_BATTLESHIP_LEN: u32 = 4;
pub const SHIP_CRUISER_LEN: u32 = 3;
pub const SHIP_SUBMARINE_LEN: u32 = 3;
pub const SHIP_DESTROYER_LEN: u32 = 2;

pub fn load_game(env: &Env, key: &DataKey) -> Result<Game, Error> {
    env.storage()
        .temporary()
        .get(key)
        .ok_or(Error::GameNotFound)
}

pub fn save_game(env: &Env, key: &DataKey, game: &Game) {
    env.storage().temporary().set(key, game);
    env.storage()
        .temporary()
        .extend_ttl(key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);
}
