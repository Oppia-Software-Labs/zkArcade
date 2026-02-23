use soroban_sdk::Env;

use crate::domain::{DomainError, Game, GameRules};
use crate::infrastructure::GameRepository;

/// Query: Get game state
pub struct GetGameQuery;

impl GetGameQuery {
    pub fn execute(env: &Env, session_id: u32) -> Result<Game, DomainError> {
        GameRepository::load(env, session_id)
    }
}

/// Query: Get game rules
pub struct GetRulesQuery;

impl GetRulesQuery {
    pub fn execute() -> GameRules {
        GameRules::default()
    }
}
