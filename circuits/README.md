# Battleship Circuits

This folder contains two Circom circuits for the Battleship flow:

- `board_commit.circom`: proves board validity and outputs `board_commitment`
- `resolve_shot.circom`: proves shot hit/miss + sunk-ship transition

Shared helpers are in `battleship_utils.circom`.

## Constraints Implemented

### board_commit
- Board is `10x10`
- Ships fixed to lengths `5,4,3,3,2`
- Ship direction is boolean (`0` vertical, `1` horizontal)
- Ship cells are in range `0..9`
- No overlap across all 17 occupied cells
- Commitment is Poseidon over 17 occupied indices + salt

### resolve_shot
- Recomputes same board commitment from private board + salt
- Verifies shot coordinate range `0..9`
- Verifies `is_hit` against board occupancy at shot coordinate
- Uses `prior_hits[17]` to prevent repeated hit on same ship cell
- Verifies `sunk_ship` tag (`0..5`) against ship hit transitions

## Security TODO (Required)

`resolve_shot.circom` currently exposes `public_inputs_hash_hi/lo` but does **not** yet constrain them to the same keccak preimage used in Soroban `build_public_inputs_hash`.

Before production:
1. Add keccak constraints in-circuit (or equivalent binding proof) so hash is derived from:
- `session_id`, `defender`, `shooter`, `x`, `y`, `is_hit`, `sunk_ship`, `board_commitment`
2. Bind `prior_hits` to on-chain history (or a committed state root), not only private witness.

## resolve_shot witness and public inputs

The main component exposes **four public inputs** in this order (must match the verifier adapter and contract):

1. `board_commitment_hi` – high 16 bytes of the 32-byte board commitment, as a field element (right-aligned 32-byte encoding).
2. `board_commitment_lo` – low 16 bytes of the board commitment, same encoding.
3. `public_inputs_hash_hi` – high 16 bytes of the contract’s `public_inputs_hash` (from `build_public_inputs_hash`).
4. `public_inputs_hash_lo` – low 16 bytes of `public_inputs_hash`.

Encoding matches the adapter’s `split_u256_to_fr_limbs`: for a 32-byte value, `hi` is bytes 0..15 (right-aligned in 32 bytes), `lo` is bytes 16..31.

### Example input.json

Use an input JSON that includes all **private inputs** and the **four public inputs** above. The prover must set `board_commitment_hi`/`board_commitment_lo` so that `board_commitment_hi * 2^128 + board_commitment_lo` equals the Poseidon board commitment (same as `BoardLayout` output). The hash limbs must match the contract’s `build_public_inputs_hash(session_id, defender, shooter, x, y, is_hit, sunk_ship, board_commitment)`.

See `example_input_resolve_shot.json` for the required keys and types. Replace placeholder `"0"` values with the actual field elements (as decimal strings for large numbers). Example structure:

```json
{
  "ship_x": [0, 2, 5, 7, 0],
  "ship_y": [0, 0, 0, 0, 5],
  "ship_dir": [1, 1, 1, 1, 0],
  "salt": "<field element or decimal string>",
  "prior_hits": [0, 0, ... ],
  "shot_x": 3,
  "shot_y": 0,
  "is_hit": 1,
  "sunk_ship": 0,
  "board_commitment_hi": "<decimal string>",
  "board_commitment_lo": "<decimal string>",
  "public_inputs_hash_hi": "<decimal string>",
  "public_inputs_hash_lo": "<decimal string>"
}
```

When generating the witness (`snarkjs wtns calculate ...`) and when calling the contract, pass the **same four public values in the same order** so they match the stored `board_commitment` and the `public_inputs_hash` used in the call.

## Trusted setup and verification key

1. **Build circuits** (requires circom and circomlib):  
   `bun run circuits:build`

2. **Obtain a powers-of-tau (ptau) file.** The ptau size must be at least as large as the number of constraints. Run:
   ```bash
   npx snarkjs r1cs info circuits/build/resolve_shot.r1cs
   ```
   Use a ptau with power ≥ log2(constraints). You can download from the [Hermez Phase 1](https://github.com/hermeznetwork/phase2ceremony) ceremony (e.g. `powersOfTau28_hez_final_12.ptau` for 2^12) or generate one with:
   ```bash
   npx snarkjs ptn bn128 12 ptau.ptau
   ```

3. **Run Groth16 setup and export vkey:**  
   `bun run circuits:setup-vkey -- --ptau <path-to.ptau>`  
   Optionally add `--contribute` to run an interactive zkey contribution.  
   This writes `circuits/build/resolve_shot_0000.zkey` and `circuits/build/vkey.json`.

4. **Convert vkey for Soroban:**  
   `bun run circuits:vkey-to-soroban.ts circuits/build/vkey.json --out circuits/build/vkey_soroban.json`  
   (or `bun run circuits:vkey-to-soroban` for defaults).  
   Use `vkey_soroban.json` as the verification key when deploying the circom-groth16-verifier contract.

## Compile Example

Requires Circom and circomlib include path.

```bash
circom circuits/board_commit.circom --r1cs --wasm --sym -o circuits/build
circom circuits/resolve_shot.circom --r1cs --wasm --sym -o circuits/build
```

If circomlib is not globally resolved, compile with include path:

```bash
circom circuits/resolve_shot.circom --r1cs --wasm --sym -l node_modules -o circuits/build
```
