use soroban_sdk::{Bytes, BytesN, Env};

use crate::domain::proof::{PayloadParser, PublicInputs};
use crate::infrastructure::Groth16VerifierGateway;

/// Command: Verify a ZK proof
pub struct VerifyProofCommand;

impl VerifyProofCommand {
    /// Verifies a proof payload and binds it to on-chain game context
    pub fn execute(
        env: &Env,
        word_commitment: &BytesN<32>,
        public_inputs_hash: &BytesN<32>,
        proof_payload: &Bytes,
    ) -> bool {
        // Parse the payload
        let parsed = match PayloadParser::parse(env, proof_payload) {
            Ok(p) => p,
            Err(_) => return false,
        };

        // Check expected number of public inputs
        if parsed.public_inputs.len() != PublicInputs::EXPECTED_COUNT {
            return false;
        }

        // Validate binding inputs match
        if PublicInputs::validate_binding(
            env,
            &parsed.public_inputs,
            word_commitment,
            public_inputs_hash,
        )
        .is_err()
        {
            return false;
        }

        // Verify with the Groth16 verifier
        match Groth16VerifierGateway::verify(env, &parsed.proof, &parsed.public_inputs) {
            Ok(result) => result,
            Err(_) => false,
        }
    }
}
