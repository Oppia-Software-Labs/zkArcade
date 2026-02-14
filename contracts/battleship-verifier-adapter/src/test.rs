#![cfg(test)]

use crate::{
    BattleshipVerifierAdapter, BattleshipVerifierAdapterClient, CircomGroth16VerifierClient,
    Groth16Error, Groth16Proof,
};
use soroban_sdk::crypto::bn254::{
    Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine, Fr, BN254_G1_SERIALIZED_SIZE,
    BN254_G2_SERIALIZED_SIZE,
};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Vec};

#[contract]
pub struct MockCircomVerifier;

#[contractimpl]
impl MockCircomVerifier {
    pub fn verify(
        _env: Env,
        _proof: Groth16Proof,
        public_inputs: Vec<Fr>,
    ) -> Result<bool, Groth16Error> {
        if public_inputs.len() < 4 {
            return Err(Groth16Error::MalformedPublicInputs);
        }
        Ok(true)
    }
}

fn split_to_limbs(v: &BytesN<32>) -> ([u8; 32], [u8; 32]) {
    let full = v.to_array();
    let mut hi = [0u8; 32];
    let mut lo = [0u8; 32];
    hi[16..32].copy_from_slice(&full[0..16]);
    lo[16..32].copy_from_slice(&full[16..32]);
    (hi, lo)
}

fn make_inputs(env: &Env, board: &BytesN<32>, hash: &BytesN<32>) -> Vec<Fr> {
    let (b_hi, b_lo) = split_to_limbs(board);
    let (h_hi, h_lo) = split_to_limbs(hash);

    let mut out = Vec::new(env);
    out.push_back(Fr::from_bytes(BytesN::from_array(env, &b_hi)));
    out.push_back(Fr::from_bytes(BytesN::from_array(env, &b_lo)));
    out.push_back(Fr::from_bytes(BytesN::from_array(env, &h_hi)));
    out.push_back(Fr::from_bytes(BytesN::from_array(env, &h_lo)));
    out
}

fn encode_payload(env: &Env, proof: &Groth16Proof, inputs: &Vec<Fr>) -> Bytes {
    let mut payload = Bytes::new(env);

    let count = inputs.len();
    payload.push_back(((count >> 24) & 0xff) as u8);
    payload.push_back(((count >> 16) & 0xff) as u8);
    payload.push_back(((count >> 8) & 0xff) as u8);
    payload.push_back((count & 0xff) as u8);

    payload.append(&Bytes::from_array(env, &proof.a.to_array()));
    payload.append(&Bytes::from_array(env, &proof.b.to_array()));
    payload.append(&Bytes::from_array(env, &proof.c.to_array()));

    for i in 0..inputs.len() {
        payload.append(&Bytes::from_array(
            env,
            &inputs.get(i).unwrap().to_bytes().to_array(),
        ));
    }

    payload
}

fn setup() -> (
    Env,
    BattleshipVerifierAdapterClient<'static>,
    BytesN<32>,
    BytesN<32>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let circom_addr = env.register(MockCircomVerifier, ());
    let _circom_client = CircomGroth16VerifierClient::new(&env, &circom_addr);

    let admin = Address::generate(&env);
    let adapter_addr = env.register(BattleshipVerifierAdapter, (&admin, &circom_addr));
    let adapter_client = BattleshipVerifierAdapterClient::new(&env, &adapter_addr);

    let board = BytesN::from_array(&env, &[7u8; 32]);
    let hash = BytesN::from_array(&env, &[9u8; 32]);

    (env, adapter_client, board, hash)
}

#[test]
fn test_verify_valid_payload() {
    let (env, adapter, board, hash) = setup();

    let proof = Groth16Proof {
        a: G1Affine::from_array(&env, &[0u8; BN254_G1_SERIALIZED_SIZE]),
        b: G2Affine::from_array(&env, &[0u8; BN254_G2_SERIALIZED_SIZE]),
        c: G1Affine::from_array(&env, &[0u8; BN254_G1_SERIALIZED_SIZE]),
    };

    let inputs = make_inputs(&env, &board, &hash);
    let payload = encode_payload(&env, &proof, &inputs);

    let ok = adapter.verify(&board, &hash, &payload);
    assert!(ok);
}

#[test]
fn test_verify_rejects_binding_mismatch() {
    let (env, adapter, board, hash) = setup();

    let proof = Groth16Proof {
        a: G1Affine::from_array(&env, &[0u8; BN254_G1_SERIALIZED_SIZE]),
        b: G2Affine::from_array(&env, &[0u8; BN254_G2_SERIALIZED_SIZE]),
        c: G1Affine::from_array(&env, &[0u8; BN254_G1_SERIALIZED_SIZE]),
    };

    let wrong_hash = BytesN::from_array(&env, &[11u8; 32]);
    let payload = encode_payload(&env, &proof, &make_inputs(&env, &board, &wrong_hash));

    let ok = adapter.verify(&board, &hash, &payload);
    assert!(!ok);
}

#[test]
fn test_verify_rejects_malformed_payload() {
    let (env, adapter, board, hash) = setup();

    let malformed = Bytes::from_array(&env, &[1u8, 2u8, 3u8]);
    let ok = adapter.verify(&board, &hash, &malformed);
    assert!(!ok);
}
