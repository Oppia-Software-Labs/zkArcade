use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    NotInitialized = 1,
    MalformedPublicInputs = 2,
    InvalidProof = 3,
    MalformedProof = 4,
    InvalidPayloadLength = 5,
    BindingMismatch = 6,
}
