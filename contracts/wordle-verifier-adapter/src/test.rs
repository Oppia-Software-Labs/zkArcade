#![cfg(test)]

use crate::{Groth16Proof, WordleVerifierAdapter, WordleVerifierAdapterClient};
use soroban_sdk::crypto::bn254::Fr;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Vec};

use crate::VerifierError;

#[contract]
pub struct MockGroth16Verifier;

#[contractimpl]
impl MockGroth16Verifier {
    pub fn verify(
        _env: Env,
        _proof: Groth16Proof,
        _public_inputs: Vec<Fr>,
    ) -> Result<bool, VerifierError> {
        Ok(true)
    }
}

fn setup_test() -> (Env, WordleVerifierAdapterClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let verifier_addr = env.register(MockGroth16Verifier, ());
    let admin = Address::generate(&env);
    let contract_id = env.register(WordleVerifierAdapter, (&admin, &verifier_addr));
    let client = WordleVerifierAdapterClient::new(&env, &contract_id);

    (env, client, admin)
}

#[test]
fn test_adapter_setup() {
    let (env, client, admin) = setup_test();

    assert_eq!(client.get_admin(), admin);

    let new_admin = Address::generate(&env);
    client.set_admin(&new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_verify_rejects_empty_payload() {
    let (env, client, _admin) = setup_test();

    let word_commitment = BytesN::from_array(&env, &[1u8; 32]);
    let public_inputs_hash = BytesN::from_array(&env, &[2u8; 32]);
    let empty_payload = Bytes::new(&env);

    let result = client.verify(&word_commitment, &public_inputs_hash, &empty_payload);
    assert!(!result);
}

#[test]
fn test_verify_rejects_short_payload() {
    let (env, client, _admin) = setup_test();

    let word_commitment = BytesN::from_array(&env, &[1u8; 32]);
    let public_inputs_hash = BytesN::from_array(&env, &[2u8; 32]);

    // Payload too short (less than header + proof)
    let short_payload = Bytes::from_array(&env, &[0u8; 100]);

    let result = client.verify(&word_commitment, &public_inputs_hash, &short_payload);
    assert!(!result);
}

#[test]
fn test_verify_rejects_mismatched_binding() {
    let (env, client, _admin) = setup_test();

    // Create a valid-looking payload structure
    // Header: 15 public inputs
    let mut payload_bytes = [0u8; 4 + 256 + 15 * 32]; // header + proof + 15 inputs

    // Set public input count to 15
    payload_bytes[0] = 0;
    payload_bytes[1] = 0;
    payload_bytes[2] = 0;
    payload_bytes[3] = 15;

    let word_commitment = BytesN::from_array(&env, &[1u8; 32]);
    let public_inputs_hash = BytesN::from_array(&env, &[2u8; 32]);
    let payload = Bytes::from_array(&env, &payload_bytes);

    // This should fail because the public inputs don't match the expected values
    let result = client.verify(&word_commitment, &public_inputs_hash, &payload);
    assert!(!result);
}

#[test]
fn test_admin_functions() {
    let (env, client, _admin) = setup_test();

    // Test get_verifier
    let _verifier = client.get_verifier();

    // Test set_verifier
    let new_verifier = Address::generate(&env);
    client.set_verifier(&new_verifier);
    assert_eq!(client.get_verifier(), new_verifier);
}
