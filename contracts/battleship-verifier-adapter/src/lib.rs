#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    crypto::bn254::{
        Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine, Fr, BN254_G1_SERIALIZED_SIZE,
        BN254_G2_SERIALIZED_SIZE,
    },
    Address, Bytes, BytesN, Env, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Groth16Proof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Groth16Error {
    NotInitialized = 1,
    MalformedPublicInputs = 2,
    InvalidProof = 3,
    MalformedProof = 4,
}

#[contractclient(name = "CircomGroth16VerifierClient")]
pub trait CircomGroth16Verifier {
    fn verify(env: Env, proof: Groth16Proof, public_inputs: Vec<Fr>) -> Result<bool, Groth16Error>;
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Verifier,
}

const PAYLOAD_HEADER_BYTES: u32 = 4;
const FR_BYTES: u32 = 32;
const PROOF_BYTES: u32 =
    (BN254_G1_SERIALIZED_SIZE + BN254_G2_SERIALIZED_SIZE + BN254_G1_SERIALIZED_SIZE) as u32;
const PROOF_OFFSET: u32 = PAYLOAD_HEADER_BYTES;
const A_OFFSET: u32 = PROOF_OFFSET;
const B_OFFSET: u32 = A_OFFSET + BN254_G1_SERIALIZED_SIZE as u32;
const C_OFFSET: u32 = B_OFFSET + BN254_G2_SERIALIZED_SIZE as u32;
const INPUTS_OFFSET: u32 = PROOF_OFFSET + PROOF_BYTES;

#[contract]
pub struct BattleshipVerifierAdapter;

#[contractimpl]
impl BattleshipVerifierAdapter {
    pub fn __constructor(env: Env, admin: Address, verifier: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
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
    /// Public inputs 0..3 are reserved for context binding:
    /// - [0]: board_commitment high 16 bytes, right-aligned in 32 bytes
    /// - [1]: board_commitment low 16 bytes, right-aligned in 32 bytes
    /// - [2]: public_inputs_hash high 16 bytes, right-aligned in 32 bytes
    /// - [3]: public_inputs_hash low 16 bytes, right-aligned in 32 bytes
    pub fn verify(
        env: Env,
        board_commitment: BytesN<32>,
        public_inputs_hash: BytesN<32>,
        proof_payload: Bytes,
    ) -> bool {
        let parsed = match Self::parse_payload(&env, &proof_payload) {
            Some(v) => v,
            None => return false,
        };

        if !Self::binding_inputs_match(
            &env,
            &parsed.public_inputs,
            &board_commitment,
            &public_inputs_hash,
        ) {
            return false;
        }

        let verifier_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .expect("Verifier not set");
        let verifier = CircomGroth16VerifierClient::new(&env, &verifier_addr);

        verifier.verify(&parsed.proof, &parsed.public_inputs)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn get_verifier(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Verifier)
            .expect("Verifier not set")
    }

    pub fn set_verifier(env: Env, new_verifier: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Verifier, &new_verifier);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    fn parse_payload(env: &Env, payload: &Bytes) -> Option<ParsedPayload> {
        if payload.len() < INPUTS_OFFSET {
            return None;
        }

        let public_inputs_count = Self::read_u32_be(payload, 0)?;
        let expected_len = INPUTS_OFFSET.checked_add(public_inputs_count.checked_mul(FR_BYTES)?)?;
        if payload.len() != expected_len {
            return None;
        }

        let a_bytes = Self::read_array::<{ BN254_G1_SERIALIZED_SIZE }>(payload, A_OFFSET)?;
        let b_bytes = Self::read_array::<{ BN254_G2_SERIALIZED_SIZE }>(payload, B_OFFSET)?;
        let c_bytes = Self::read_array::<{ BN254_G1_SERIALIZED_SIZE }>(payload, C_OFFSET)?;

        let proof = Groth16Proof {
            a: G1Affine::from_array(env, &a_bytes),
            b: G2Affine::from_array(env, &b_bytes),
            c: G1Affine::from_array(env, &c_bytes),
        };

        let mut public_inputs = Vec::new(env);
        let mut cursor = INPUTS_OFFSET;
        for _ in 0..public_inputs_count {
            let limb = Self::read_array::<32>(payload, cursor)?;
            public_inputs.push_back(Fr::from_bytes(BytesN::from_array(env, &limb)));
            cursor += FR_BYTES;
        }

        Some(ParsedPayload {
            proof,
            public_inputs,
        })
    }

    fn binding_inputs_match(
        env: &Env,
        public_inputs: &Vec<Fr>,
        board_commitment: &BytesN<32>,
        public_inputs_hash: &BytesN<32>,
    ) -> bool {
        if public_inputs.len() < 4 {
            return false;
        }

        let (board_hi, board_lo) = Self::split_u256_to_fr_limbs(board_commitment);
        let (hash_hi, hash_lo) = Self::split_u256_to_fr_limbs(public_inputs_hash);

        let expected0 = BytesN::from_array(env, &board_hi);
        let expected1 = BytesN::from_array(env, &board_lo);
        let expected2 = BytesN::from_array(env, &hash_hi);
        let expected3 = BytesN::from_array(env, &hash_lo);

        public_inputs
            .get(0)
            .expect("public input 0 missing")
            .to_bytes()
            == expected0
            && public_inputs
                .get(1)
                .expect("public input 1 missing")
                .to_bytes()
                == expected1
            && public_inputs
                .get(2)
                .expect("public input 2 missing")
                .to_bytes()
                == expected2
            && public_inputs
                .get(3)
                .expect("public input 3 missing")
                .to_bytes()
                == expected3
    }

    fn split_u256_to_fr_limbs(value: &BytesN<32>) -> ([u8; 32], [u8; 32]) {
        let full = value.to_array();

        let mut hi = [0u8; 32];
        let mut lo = [0u8; 32];

        hi[16..32].copy_from_slice(&full[0..16]);
        lo[16..32].copy_from_slice(&full[16..32]);

        (hi, lo)
    }

    fn read_u32_be(payload: &Bytes, offset: u32) -> Option<u32> {
        if offset.checked_add(4)? > payload.len() {
            return None;
        }

        let b0 = payload.get(offset)? as u32;
        let b1 = payload.get(offset + 1)? as u32;
        let b2 = payload.get(offset + 2)? as u32;
        let b3 = payload.get(offset + 3)? as u32;

        Some((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)
    }

    fn read_array<const N: usize>(payload: &Bytes, offset: u32) -> Option<[u8; N]> {
        if offset.checked_add(N as u32)? > payload.len() {
            return None;
        }

        let mut out = [0u8; N];
        let mut i = 0usize;
        while i < N {
            out[i] = payload.get(offset + i as u32)?;
            i += 1;
        }

        Some(out)
    }
}

struct ParsedPayload {
    proof: Groth16Proof,
    public_inputs: Vec<Fr>,
}

#[cfg(test)]
mod test;
