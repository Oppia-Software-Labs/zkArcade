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
