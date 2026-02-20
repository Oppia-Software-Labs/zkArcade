# Battleship Circuits

Two Circom circuits for the Battleship ZK flow:

- **board_commit.circom** — proves board validity, outputs `board_commitment`
- **resolve_shot.circom** — proves shot hit/miss and sunk-ship transition

Shared helpers: `battleship_utils.circom`. On-chain verification uses **resolve_shot** only (it embeds board validity). Build both if the frontend uses `board_commit` WASM for commitments.

**Run all commands from the repo root** and use `bun run` so paths resolve correctly.

---

## Prerequisites

- **Circom 2.1.x** on your PATH:
  ```bash
  npm install -g circom@2.1.x
  ```
  [Circom installation](https://docs.circom.io/getting-started/installation/)

- **JS deps** (from repo root): `bun install` — adds `circomlib` and `snarkjs` to `node_modules`.

---

## Quick reference: get the verification key

Do this once to produce `circuits/build/vkey_soroban.json` (needed for deploying the circom-groth16-verifier contract). **Order matters.**

From repo root:

```bash
# 1. Compile circuits (needs circom + bun install)
bun run circuits:build

# 2. Generate phase-1 ptau (use this script, not raw npx — paths are from repo root)
bun run circuits:ptau
# Custom power: bun run circuits:ptau 14

# 3. Trusted setup + export vkey (script prepares phase 2 automatically)
bun run circuits:setup-vkey -- --ptau circuits/build/ptau.ptau
# Optional: add --contribute for interactive zkey contribution

# 4. Convert vkey for the Soroban verifier
bun run circuits:vkey-to-soroban
```

Result: **circuits/build/vkey_soroban.json** — use this when deploying the **circom-groth16-verifier** contract (see main [README](../README.md) for full deploy flow).

---

## Commands summary

| Command | Description |
|--------|-------------|
| `bun run circuits:build` | Compile board_commit + resolve_shot → circuits/build (R1CS, WASM, .sym) |
| `bun run circuits:ptau` | Generate circuits/build/ptau.ptau (phase 1). **Use this instead of** `npx snarkjs ptn` to avoid wrong-path errors. |
| `bun run circuits:setup-vkey -- --ptau circuits/build/ptau.ptau` | Groth16 setup + export vkey.json (script runs phase-2 prepare) |
| `bun run circuits:vkey-to-soroban` | Convert vkey.json → vkey_soroban.json for the contract |

Custom paths for vkey conversion:

```bash
bun run circuits:vkey-to-soroban circuits/build/vkey.json --out circuits/build/vkey_soroban.json
```

---

## Build (detail)

From repo root:

```bash
bun run circuits:build
```

Compiles both circuits into **circuits/build** with `-l node_modules` for circomlib. Requires `circom` and `node_modules/circomlib`.

Manual compile (if needed):

```bash
circom circuits/resolve_shot.circom --r1cs --wasm --sym -l node_modules -o circuits/build
circom circuits/board_commit.circom --r1cs --wasm --sym -l node_modules -o circuits/build
```

---

## Powers-of-tau (ptau)

Groth16 trusted setup needs a **phase-1** ptau with enough capacity for `resolve_shot`.

- **Generate (recommended):** `bun run circuits:ptau` — creates `circuits/build/ptau.ptau` from repo root. Do **not** run `npx snarkjs ptn bn128 12 circuits/build/ptau.ptau` from another directory (paths will be wrong).
- **Check constraints:** `npx snarkjs r1cs info circuits/build/resolve_shot.r1cs` — use ptau power ≥ log₂(constraints). Power 12 is usually enough.
- **Download instead:** [Hermez Phase 1](https://github.com/hermeznetwork/phase2ceremony) (e.g. `powersOfTau28_hez_final_12.ptau`).

The setup script **prepares phase 2** automatically, so you only need a phase-1 ptau.

---

## Witness and proof (optional)

To run the full pipeline locally (witness → prove → verify):

1. Build circuits and run trusted setup (see Quick reference above).

2. Create `input.json` with private and public inputs (see [resolve_shot witness and public inputs](#resolve_shot-witness-and-public-inputs) and `example_input_resolve_shot.json`).

3. Generate witness:
   ```bash
   node circuits/build/resolve_shot_js/generate_witness.js circuits/build/resolve_shot_js/resolve_shot.wasm input.json witness.wtns
   ```

4. Prove:
   ```bash
   npx snarkjs groth16 prove circuits/build/resolve_shot_0000.zkey witness.wtns proof.json public.json
   ```

5. Verify off-chain:
   ```bash
   npx snarkjs groth16 verify circuits/build/vkey.json public.json proof.json
   ```

The same **four public inputs** order (board_commitment_hi, board_commitment_lo, public_inputs_hash_hi, public_inputs_hash_lo) must be used when calling the on-chain verifier.

---

## Deploy order (on-chain)

1. Build circuits → `bun run circuits:build`
2. Trusted setup + vkey → `bun run circuits:setup-vkey -- --ptau circuits/build/ptau.ptau`
3. Convert vkey → `bun run circuits:vkey-to-soroban` → `vkey_soroban.json`
4. Deploy **circom-groth16-verifier** with `vkey_soroban.json`
5. Deploy **battleship-verifier-adapter** with the verifier contract ID
6. Deploy **battleship** with the adapter ID (and game hub ID)

Full deploy is automated by `bun run deploy` from the repo root; see main [README](../README.md).

---

## Constraints

### board_commit

- Board 10×10; ships lengths 5,4,3,3,2; direction boolean; cells in 0..9; no overlap; commitment = Poseidon(17 indices + salt).

### resolve_shot

- Recomputes board commitment; checks shot in range; verifies `is_hit`; uses `prior_hits[17]`; verifies `sunk_ship` tag.

---

## Security TODO (required before production)

- **resolve_shot** exposes `public_inputs_hash_hi/lo` but does **not** yet constrain them to the same keccak preimage as Soroban `build_public_inputs_hash`. Add keccak (or binding) constraints so the hash is derived from session_id, defender, shooter, x, y, is_hit, sunk_ship, board_commitment.
- Bind `prior_hits` to on-chain history or a committed state root, not only private witness.

---

## resolve_shot witness and public inputs

**Four public inputs** (order must match verifier adapter and contract):

1. **board_commitment_hi** — high 16 bytes of 32-byte board commitment (field element, right-aligned).
2. **board_commitment_lo** — low 16 bytes, same encoding.
3. **public_inputs_hash_hi** — high 16 bytes of contract `public_inputs_hash` from `build_public_inputs_hash`.
4. **public_inputs_hash_lo** — low 16 bytes of that hash.

Encoding matches adapter `split_u256_to_fr_limbs`: for 32 bytes, hi = bytes 0..15, lo = bytes 16..31.

### Example input.json

Include all **private inputs** and the **four public inputs** above. Prover must set board_commitment limbs so they match the Poseidon output, and hash limbs to match `build_public_inputs_hash(session_id, defender, shooter, x, y, is_hit, sunk_ship, board_commitment)`. See `example_input_resolve_shot.json` for keys and types. Example shape:

```json
{
  "ship_x": [0, 2, 5, 7, 0],
  "ship_y": [0, 0, 0, 0, 5],
  "ship_dir": [1, 1, 1, 1, 0],
  "salt": "<field element>",
  "prior_hits": [0, 0, ...],
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

Use the **same four public values in the same order** for witness generation and for the on-chain verifier call.
