#![no_std]

mod application;
mod domain;
mod infrastructure;

// Re-export public types for contract interface
pub use application::GuessResult;
pub use domain::{DomainError as Error, Game, GamePhase, GameRules};

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Vec};

use application::{
    CommitWordCommand, GetGameQuery, GetRulesQuery, GuessCommand, ResolveGuessCommand,
    StartGameCommand,
};
use infrastructure::storage::AdminRepository;

#[contract]
pub struct WordleContract;

#[contractimpl]
impl WordleContract {
    /// Initialize contract with admin, game hub, and verifier addresses
    pub fn __constructor(env: Env, admin: Address, game_hub: Address, verifier: Address) {
        AdminRepository::set_admin(&env, &admin);
        AdminRepository::set_game_hub(&env, &game_hub);
        AdminRepository::set_verifier(&env, &verifier);
    }

    // ==================== Game Commands ====================

    /// Start a new game between two players
    pub fn start_game(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        StartGameCommand::execute(
            &env,
            session_id,
            player1,
            player2,
            player1_points,
            player2_points,
        )
    }

    /// Word setter commits their secret word
    pub fn commit_word(
        env: Env,
        session_id: u32,
        player: Address,
        word_commitment: BytesN<32>,
    ) -> Result<(), Error> {
        CommitWordCommand::execute(&env, session_id, player, word_commitment)
    }

    /// Guesser submits a guess
    pub fn guess(
        env: Env,
        session_id: u32,
        guesser: Address,
        guess_letters: BytesN<5>,
    ) -> Result<(), Error> {
        GuessCommand::execute(&env, session_id, guesser, guess_letters)
    }

    /// Word setter resolves a guess with ZK proof
    pub fn resolve_guess(
        env: Env,
        session_id: u32,
        word_setter: Address,
        feedback: Vec<u32>,
        is_correct: bool,
        proof_payload: Bytes,
        public_inputs_hash: BytesN<32>,
    ) -> Result<GuessResult, Error> {
        ResolveGuessCommand::execute(
            &env,
            session_id,
            word_setter,
            feedback,
            is_correct,
            proof_payload,
            public_inputs_hash,
        )
    }

    // ==================== Queries ====================

    /// Get current game state
    pub fn get_game(env: Env, session_id: u32) -> Result<Game, Error> {
        GetGameQuery::execute(&env, session_id)
    }

    /// Get game rules
    pub fn get_rules(_env: Env) -> GameRules {
        GetRulesQuery::execute()
    }

    /// Build public inputs hash (utility for frontend)
    pub fn build_public_inputs_hash(
        env: Env,
        session_id: u32,
        word_setter: Address,
        guesser: Address,
        guess_letters: BytesN<5>,
        feedback: Vec<u32>,
        is_correct: bool,
        word_commitment: BytesN<32>,
    ) -> BytesN<32> {
        ResolveGuessCommand::build_public_inputs_hash(
            &env,
            session_id,
            &word_setter,
            &guesser,
            &guess_letters,
            &feedback,
            is_correct,
            &word_commitment,
        )
    }

    // ==================== Admin Functions ====================

    pub fn get_admin(env: Env) -> Address {
        AdminRepository::get_admin(&env)
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin = AdminRepository::get_admin(&env);
        admin.require_auth();
        AdminRepository::set_admin(&env, &new_admin);
    }

    pub fn get_hub(env: Env) -> Address {
        AdminRepository::get_game_hub(&env)
    }

    pub fn set_hub(env: Env, new_hub: Address) {
        let admin = AdminRepository::get_admin(&env);
        admin.require_auth();
        AdminRepository::set_game_hub(&env, &new_hub);
    }

    pub fn get_verifier(env: Env) -> Address {
        AdminRepository::get_verifier(&env)
    }

    pub fn set_verifier(env: Env, new_verifier: Address) {
        let admin = AdminRepository::get_admin(&env);
        admin.require_auth();
        AdminRepository::set_verifier(&env, &new_verifier);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = AdminRepository::get_admin(&env);
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test;
