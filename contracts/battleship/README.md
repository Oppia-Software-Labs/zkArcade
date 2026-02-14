# Battleship Contract (Soroban)

This contract implements a 2-player Battleship game with Game Hub lifecycle integration and proof-based shot resolution.

## Rules

- Board size: `10x10` (coordinates `0..9`)
- Ships:
  - Carrier: `5`
  - Battleship: `4`
  - Cruiser: `3`
  - Submarine: `3`
  - Destroyer: `2`
- Total hits to win: `17`

## Lifecycle

1. `start_game(session_id, player1, player2, player1_points, player2_points)`
2. `commit_board(session_id, player, board_commitment)` (both players)
3. `fire(session_id, shooter, x, y)`
4. `resolve_shot(session_id, defender, is_hit, sunk_ship, proof_payload, public_inputs_hash)`
5. Automatic `game_hub.end_game(...)` once one side reaches 17 hits

## Game Hub Integration

- `start_game` calls Game Hub `start_game(...)` before storing game state
- Win path in `resolve_shot` calls Game Hub `end_game(...)` before winner finalization

## Storage

- Game state is stored in temporary storage
- TTL is extended to 30 days on every game-state write

## Proof Integration

`resolve_shot` is callable by anyone, but requires a valid payload:

- `public_inputs_hash` must match contract-computed hash from:
  - `session_id`, `defender`, `shooter`, `x`, `y`, `is_hit`, `sunk_ship`, `board_commitment`
- `proof_payload` is verified through the configured verifier contract

Current verifier interface expected by this contract:

```rust
fn verify(
    env: Env,
    board_commitment: BytesN<32>,
    public_inputs_hash: BytesN<32>,
    proof_payload: Bytes,
) -> bool;
```

Use `contracts/battleship-verifier-adapter` as the bridge layer. It decodes `proof_payload`, checks context-binding public inputs, then calls a Groth16 verifier contract.

Recommended public input prefix for the adapter:

- `[0]` board commitment high 16-byte limb (right-aligned in 32 bytes)
- `[1]` board commitment low 16-byte limb
- `[2]` `public_inputs_hash` high 16-byte limb
- `[3]` `public_inputs_hash` low 16-byte limb

## Read Methods

- `get_game(session_id)`
- `get_rules()`
- `build_public_inputs_hash(...)`

## Admin Methods

- `get_admin`, `set_admin`
- `get_hub`, `set_hub`
- `get_verifier`, `set_verifier`
- `upgrade`
