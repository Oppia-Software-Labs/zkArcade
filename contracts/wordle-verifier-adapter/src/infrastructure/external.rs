use soroban_sdk::{contractclient, crypto::bn254::Fr, Env, Vec};

use crate::domain::{Groth16Proof, VerifierError};

use super::storage::AdminRepository;

/// Groth16 verifier contract interface
#[allow(dead_code)] // Trait is used by contractclient macro
#[contractclient(name = "CircomGroth16VerifierClient")]
pub trait CircomGroth16Verifier {
    fn verify(env: Env, proof: Groth16Proof, public_inputs: Vec<Fr>) -> Result<bool, VerifierError>;
}

/// Gateway for interacting with the Groth16 verifier contract
pub struct Groth16VerifierGateway;

impl Groth16VerifierGateway {
    /// Verifies a Groth16 proof
    pub fn verify(
        env: &Env,
        proof: &Groth16Proof,
        public_inputs: &Vec<Fr>,
    ) -> Result<bool, VerifierError> {
        let verifier_addr = AdminRepository::get_verifier(env);
        let verifier = CircomGroth16VerifierClient::new(env, &verifier_addr);

        Ok(verifier.verify(proof, public_inputs))
    }
}
