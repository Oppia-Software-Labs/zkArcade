use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env};

use super::storage::AdminRepository;

/// Game Hub contract interface
#[allow(dead_code)] // Trait is used by contractclient macro
#[contractclient(name = "GameHubClient")]
pub trait GameHubContract {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

/// Verifier adapter contract interface
#[allow(dead_code)] // Trait is used by contractclient macro
#[contractclient(name = "VerifierAdapterClient")]
pub trait VerifierAdapterContract {
    fn verify(
        env: Env,
        word_commitment: BytesN<32>,
        public_inputs_hash: BytesN<32>,
        proof_payload: Bytes,
    ) -> bool;
}

/// Gateway for interacting with Game Hub
pub struct GameHubGateway;

impl GameHubGateway {
    /// Notifies Game Hub that a game has started
    pub fn notify_game_started(
        env: &Env,
        session_id: u32,
        word_setter: &Address,
        guesser: &Address,
        word_setter_points: i128,
        guesser_points: i128,
    ) {
        let hub_addr = AdminRepository::get_game_hub(env);
        let hub = GameHubClient::new(env, &hub_addr);

        hub.start_game(
            &env.current_contract_address(),
            &session_id,
            word_setter,
            guesser,
            &word_setter_points,
            &guesser_points,
        );
    }

    /// Notifies Game Hub that a game has ended
    pub fn notify_game_ended(env: &Env, session_id: u32, word_setter_won: bool) {
        let hub_addr = AdminRepository::get_game_hub(env);
        let hub = GameHubClient::new(env, &hub_addr);

        hub.end_game(&session_id, &word_setter_won);
    }
}

/// Gateway for ZK proof verification
pub struct VerifierGateway;

impl VerifierGateway {
    /// Verifies a ZK proof
    pub fn verify_proof(
        env: &Env,
        word_commitment: &BytesN<32>,
        public_inputs_hash: &BytesN<32>,
        proof_payload: &Bytes,
    ) -> bool {
        let verifier_addr = AdminRepository::get_verifier(env);
        let verifier = VerifierAdapterClient::new(env, &verifier_addr);

        verifier.verify(word_commitment, public_inputs_hash, proof_payload)
    }
}
