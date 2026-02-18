# Battleship Circuits

This folder contains two Circom circuits for the Battleship flow:

- `board_commit.circom`: proves board validity and outputs `board_commitment`
- `resolve_shot.circom`: proves shot hit/miss + sunk-ship transition

Shared helpers are in `battleship_utils.circom`. On-chain verification uses only **resolve_shot** (it embeds board validity); build both if the frontend uses `board_commit` WASM for commitment generation.

---

## Prerequisites and install

1. **Circom** (recommend 2.1.x)  
   Install the compiler so `circom` is on your PATH:
   ```bash
   npm install -g circom@2.1.x
   ```
   See [Circom installation](https://docs.circom.io/getting-started/installation/).

2. **circomlib and snarkjs**  
   From the repo root, install JS dependencies (used for Poseidon in circuits and for Groth16 setup/prove):
   ```bash
   bun install
   ```
   This adds `circomlib` and `snarkjs` to `node_modules`. The build script uses `-l node_modules` so `include "circomlib/circuits/poseidon.circom"` resolves.

---

## Build

From the repo root:

```bash
bun run circuits:build
```

This compiles `board_commit.circom` and `resolve_shot.circom` with circom (R1CS, WASM, symbol files) into **circuits/build**, using `node_modules` for circomlib. Requires `circom` and `node_modules/circomlib` to be present.

Manual compile (if you need to run circom directly):

```bash
circom circuits/resolve_shot.circom --r1cs --wasm --sym -l node_modules -o circuits/build
circom circuits/board_commit.circom --r1cs --wasm --sym -l node_modules -o circuits/build
```

---

## Powers-of-tau (ptau)

The Groth16 trusted setup requires a **powers-of-tau** file whose size is at least as large as the number of constraints of `resolve_shot`.

1. **Check constraint count:**
   ```bash
   npx snarkjs r1cs info circuits/build/resolve_shot.r1cs
   ```
   Use a ptau with power ≥ log₂(constraints) (e.g. if you have ~2^10 constraints, use at least 2^10).

2. **Obtain a ptau file (must be “phase 2 prepared”):**
   - **Recommended:** Download a **prepared** file from the [Hermez Phase 1](https://github.com/hermeznetwork/phase2ceremony) ceremony. Use the `*_final_*` files (e.g. [powersOfTau28_hez_final_12.ptau](https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau) for 2^12). These are already prepared and work with `g16s`.
   - **Or generate one locally** (for testing). A raw ptau from `ptn` is **not** enough; you must contribute then **prepare phase 2**:
     ```bash
     npx snarkjs ptn bn128 12 ptau_0000.ptau
     npx snarkjs ptc ptau_0000.ptau ptau_0001.ptau --name="First" -v
     npx snarkjs pt2 ptau_0001.ptau ptau_final.ptau -v
     ```
     Then use `ptau_final.ptau` (not `ptau_0000.ptau` or `ptau_0001.ptau`) with `circuits:setup-vkey`.  
     If you skip `pt2`, you will get: **"Powers of tau is not prepared."**

---

## Trusted setup and verification key

1. **Build circuits** (if not already):
   ```bash
   bun run circuits:build
   ```

2. **Run Groth16 setup and export snarkjs vkey:**
   ```bash
   bun run circuits:setup-vkey -- --ptau <path-to.ptau>
   ```
   Optional: add `--contribute` to run an interactive zkey contribution (produces `resolve_shot_final.zkey`).  
   Outputs: `circuits/build/resolve_shot_0000.zkey`, `circuits/build/vkey.json`.

3. **Convert vkey for the Soroban verifier:**
   ```bash
   bun run circuits:vkey-to-soroban
   ```
   Default: reads `circuits/build/vkey.json`, writes `circuits/build/vkey_soroban.json`. Custom paths:
   ```bash
   bun run circuits:vkey-to-soroban circuits/build/vkey.json --out circuits/build/vkey_soroban.json
   ```
   Use `vkey_soroban.json` as the verification key when deploying the **circom-groth16-verifier** contract.

---

## Witness and proof (optional)

To exercise the full pipeline locally (compile → setup → witness → prove → verify):

1. **Build circuits and run trusted setup** (see above).

2. **Create an input file** (e.g. `input.json`) with all private and public inputs; see [resolve_shot witness and public inputs](#resolve_shot-witness-and-public-inputs) and `example_input_resolve_shot.json`.

3. **Generate witness:**
   ```bash
   node circuits/build/resolve_shot_js/generate_witness.js circuits/build/resolve_shot_js/resolve_shot.wasm input.json witness.wtns
   ```

4. **Generate proof:**
   ```bash
   npx snarkjs groth16 prove circuits/build/resolve_shot_0000.zkey witness.wtns proof.json public.json
   ```

5. **Verify (off-chain):**
   ```bash
   npx snarkjs groth16 verify circuits/build/vkey.json public.json proof.json
   ```

The same `public.json` ordering (four public inputs: board_commitment_hi, board_commitment_lo, public_inputs_hash_hi, public_inputs_hash_lo) must be used when calling the on-chain verifier.

---

## Deploy order

For on-chain verification, use this order:

1. **Build circuits** → `bun run circuits:build`
2. **Run trusted setup** → `bun run circuits:setup-vkey -- --ptau <ptau>`
3. **Export vkey** → written by setup script to `circuits/build/vkey.json`
4. **Convert vkey** → `bun run circuits:vkey-to-soroban` → `circuits/build/vkey_soroban.json`
5. **Deploy circom-groth16-verifier** with the converted verification key (VerificationKeyBytes).
6. **Deploy battleship-verifier-adapter** with the verifier contract address.
7. **Deploy battleship** with the adapter address (or, if the adapter is inlined, with the verifier address).

---

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
