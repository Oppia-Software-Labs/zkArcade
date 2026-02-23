use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env};

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
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

/// Adapter verifier interface for Battleship proofs.
/// A verifier contract can internally call a Groth16 verifier and return `true` only for valid proofs.
#[contractclient(name = "BattleshipVerifierClient")]
pub trait BattleshipVerifier {
    fn verify(
        env: Env,
        board_commitment: BytesN<32>,
        public_inputs_hash: BytesN<32>,
        proof_payload: Bytes,
    ) -> bool;
}
