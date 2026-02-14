# Battleship Verifier Adapter

Adapter contract exposing the interface expected by the Battleship game contract:

```rust
fn verify(
    env: Env,
    board_commitment: BytesN<32>,
    public_inputs_hash: BytesN<32>,
    proof_payload: Bytes,
) -> bool;
```

## What It Does

1. Parses `proof_payload` into:
- Groth16 proof `(a,b,c)`
- BN254 `public_inputs` vector

2. Binds public inputs to game context:
- Public input `[0]`: board commitment high 16-byte limb
- Public input `[1]`: board commitment low 16-byte limb
- Public input `[2]`: `public_inputs_hash` high 16-byte limb
- Public input `[3]`: `public_inputs_hash` low 16-byte limb

3. Calls a Groth16 verifier contract (`verify(proof, public_inputs)`) and returns `true` only when valid.

## Payload Encoding

`proof_payload` is a binary blob:

- `u32` big-endian public input count `N`
- `a` (64 bytes)
- `b` (128 bytes)
- `c` (64 bytes)
- `N * 32` bytes public inputs

Total size: `260 + 32*N` bytes.

## Important

This adapter only enforces the first four public input bindings and proof validity.
Your Circom circuit must still enforce the full shot logic and hash-binding constraints.
