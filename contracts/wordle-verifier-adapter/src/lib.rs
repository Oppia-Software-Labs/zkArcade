#![no_std]

mod application;
mod domain;
mod infrastructure;

// Re-export public types
pub use domain::{Groth16Proof, VerifierError};

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

use application::VerifyProofCommand;
use infrastructure::AdminRepository;

#[contract]
pub struct WordleVerifierAdapter;

#[contractimpl]
impl WordleVerifierAdapter {
    /// Initialize adapter with admin and verifier contract addresses
    pub fn __constructor(env: Env, admin: Address, verifier: Address) {
        AdminRepository::set_admin(&env, &admin);
        AdminRepository::set_verifier(&env, &verifier);
    }

    /// Verifies a proof payload and binds it to on-chain game context.
    ///
    /// Payload format:
    /// - bytes[0..4]: big-endian u32 public input count (N)
    /// - bytes[4..68): proof.a (64 bytes)
    /// - bytes[68..196): proof.b (128 bytes)
    /// - bytes[196..260): proof.c (64 bytes)
    /// - bytes[260..): N public inputs, each 32 bytes
    ///
    /// Public inputs for Wordle (15 total):
    /// - [0]: word_commitment high 16 bytes, right-aligned in 32 bytes
    /// - [1]: word_commitment low 16 bytes, right-aligned in 32 bytes
    /// - [2]: public_inputs_hash high 16 bytes, right-aligned in 32 bytes
    /// - [3]: public_inputs_hash low 16 bytes, right-aligned in 32 bytes
    /// - [4-8]: guess letters (5 field elements, each 0-25)
    /// - [9-13]: feedback values (5 field elements, each 0-2)
    /// - [14]: is_correct (0 or 1)
    pub fn verify(
        env: Env,
        word_commitment: BytesN<32>,
        public_inputs_hash: BytesN<32>,
        proof_payload: Bytes,
    ) -> bool {
        VerifyProofCommand::execute(&env, &word_commitment, &public_inputs_hash, &proof_payload)
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
