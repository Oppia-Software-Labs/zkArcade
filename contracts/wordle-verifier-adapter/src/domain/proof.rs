use soroban_sdk::{
    contracttype,
    crypto::bn254::{
        Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine, Fr, BN254_G1_SERIALIZED_SIZE,
        BN254_G2_SERIALIZED_SIZE,
    },
    Bytes, BytesN, Env, Vec,
};

use super::errors::VerifierError;

/// Groth16 proof structure
#[contracttype]
#[derive(Clone)]
pub struct Groth16Proof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

/// Parsed payload containing proof and public inputs
pub struct ParsedPayload {
    pub proof: Groth16Proof,
    pub public_inputs: Vec<Fr>,
}

/// Wordle public inputs structure
/// Total 15 public inputs:
/// - [0]: word_commitment_hi
/// - [1]: word_commitment_lo
/// - [2]: public_inputs_hash_hi
/// - [3]: public_inputs_hash_lo
/// - [4-8]: guess[5] (5 letters)
/// - [9-13]: feedback[5] (5 status values)
/// - [14]: is_correct
pub struct PublicInputs;

impl PublicInputs {
    pub const EXPECTED_COUNT: u32 = 15;

    /// Splits a 32-byte value into hi/lo field elements
    pub fn split_u256_to_fr_limbs(value: &BytesN<32>) -> ([u8; 32], [u8; 32]) {
        let full = value.to_array();

        let mut hi = [0u8; 32];
        let mut lo = [0u8; 32];

        hi[16..32].copy_from_slice(&full[0..16]);
        lo[16..32].copy_from_slice(&full[16..32]);

        (hi, lo)
    }

    /// Validates that binding inputs match expected values
    pub fn validate_binding(
        env: &Env,
        public_inputs: &Vec<Fr>,
        word_commitment: &BytesN<32>,
        public_inputs_hash: &BytesN<32>,
    ) -> Result<(), VerifierError> {
        if public_inputs.len() < 4 {
            return Err(VerifierError::MalformedPublicInputs);
        }

        let (word_hi, word_lo) = Self::split_u256_to_fr_limbs(word_commitment);
        let (hash_hi, hash_lo) = Self::split_u256_to_fr_limbs(public_inputs_hash);

        let expected0 = BytesN::from_array(env, &word_hi);
        let expected1 = BytesN::from_array(env, &word_lo);
        let expected2 = BytesN::from_array(env, &hash_hi);
        let expected3 = BytesN::from_array(env, &hash_lo);

        let matches = public_inputs
            .get(0)
            .map(|v| v.to_bytes() == expected0)
            .unwrap_or(false)
            && public_inputs
                .get(1)
                .map(|v| v.to_bytes() == expected1)
                .unwrap_or(false)
            && public_inputs
                .get(2)
                .map(|v| v.to_bytes() == expected2)
                .unwrap_or(false)
            && public_inputs
                .get(3)
                .map(|v| v.to_bytes() == expected3)
                .unwrap_or(false);

        if matches {
            Ok(())
        } else {
            Err(VerifierError::BindingMismatch)
        }
    }
}

/// Payload parser for proof data
pub struct PayloadParser;

impl PayloadParser {
    const PAYLOAD_HEADER_BYTES: u32 = 4;
    const FR_BYTES: u32 = 32;
    const PROOF_BYTES: u32 =
        (BN254_G1_SERIALIZED_SIZE + BN254_G2_SERIALIZED_SIZE + BN254_G1_SERIALIZED_SIZE) as u32;
    const PROOF_OFFSET: u32 = Self::PAYLOAD_HEADER_BYTES;
    const A_OFFSET: u32 = Self::PROOF_OFFSET;
    const B_OFFSET: u32 = Self::A_OFFSET + BN254_G1_SERIALIZED_SIZE as u32;
    const C_OFFSET: u32 = Self::B_OFFSET + BN254_G2_SERIALIZED_SIZE as u32;
    const INPUTS_OFFSET: u32 = Self::PROOF_OFFSET + Self::PROOF_BYTES;

    /// Parses a payload into proof and public inputs
    pub fn parse(env: &Env, payload: &Bytes) -> Result<ParsedPayload, VerifierError> {
        if payload.len() < Self::INPUTS_OFFSET {
            return Err(VerifierError::MalformedProof);
        }

        let public_inputs_count = Self::read_u32_be(payload, 0)?;
        let expected_len = Self::INPUTS_OFFSET
            .checked_add(public_inputs_count.checked_mul(Self::FR_BYTES).ok_or(VerifierError::MalformedProof)?)
            .ok_or(VerifierError::MalformedProof)?;

        if payload.len() != expected_len {
            return Err(VerifierError::InvalidPayloadLength);
        }

        let a_bytes = Self::read_array::<{ BN254_G1_SERIALIZED_SIZE }>(payload, Self::A_OFFSET)?;
        let b_bytes = Self::read_array::<{ BN254_G2_SERIALIZED_SIZE }>(payload, Self::B_OFFSET)?;
        let c_bytes = Self::read_array::<{ BN254_G1_SERIALIZED_SIZE }>(payload, Self::C_OFFSET)?;

        let proof = Groth16Proof {
            a: G1Affine::from_array(env, &a_bytes),
            b: G2Affine::from_array(env, &b_bytes),
            c: G1Affine::from_array(env, &c_bytes),
        };

        let mut public_inputs = Vec::new(env);
        let mut cursor = Self::INPUTS_OFFSET;
        for _ in 0..public_inputs_count {
            let limb = Self::read_array::<32>(payload, cursor)?;
            public_inputs.push_back(Fr::from_bytes(BytesN::from_array(env, &limb)));
            cursor += Self::FR_BYTES;
        }

        Ok(ParsedPayload {
            proof,
            public_inputs,
        })
    }

    fn read_u32_be(payload: &Bytes, offset: u32) -> Result<u32, VerifierError> {
        if offset.checked_add(4).ok_or(VerifierError::MalformedProof)? > payload.len() {
            return Err(VerifierError::MalformedProof);
        }

        let b0 = payload.get(offset).ok_or(VerifierError::MalformedProof)? as u32;
        let b1 = payload.get(offset + 1).ok_or(VerifierError::MalformedProof)? as u32;
        let b2 = payload.get(offset + 2).ok_or(VerifierError::MalformedProof)? as u32;
        let b3 = payload.get(offset + 3).ok_or(VerifierError::MalformedProof)? as u32;

        Ok((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)
    }

    fn read_array<const N: usize>(payload: &Bytes, offset: u32) -> Result<[u8; N], VerifierError> {
        if offset.checked_add(N as u32).ok_or(VerifierError::MalformedProof)? > payload.len() {
            return Err(VerifierError::MalformedProof);
        }

        let mut out = [0u8; N];
        for i in 0..N {
            out[i] = payload.get(offset + i as u32).ok_or(VerifierError::MalformedProof)?;
        }

        Ok(out)
    }
}
