# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stellar Game Studio with zero-knowledge games on Stellar: Circom circuits for ZK proofs (Groth16) + Soroban smart contracts + React/Three.js frontend.

**Games:**
- **Battleship** - Classic battleship with ZK proofs for hit/miss verification
- **Wordle** - Word guessing game with ZK proofs for feedback verification

## Common Commands

Run all commands from repo root using `bun run`:

```bash
# Full setup (build contracts, circuits, deploy to testnet, generate bindings)
bun run setup

# Individual build/deploy steps
bun run build                    # Build Soroban contracts
bun run deploy                   # Deploy to testnet (requires vkey_soroban.json)
bun run bindings                 # Generate TypeScript bindings from WASM

# Run frontend
bun run dev:game battleship      # Dev server with wallet switching
cd battleship-frontend && bun run dev

# Circuit setup (order matters)
bun run circuits:build           # Compile Circom circuits
bun run circuits:ptau            # Generate phase-1 ptau
bun run circuits:setup-vkey -- --ptau circuits/build/ptau.ptau
bun run circuits:vkey-to-soroban # Convert vkey for Soroban verifier

# Contract tests
cargo test -p battleship
cargo test -p battleship-verifier-adapter
cargo test -p wordle
cargo test -p wordle-verifier-adapter
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     STELLAR TESTNET                          │
│                                                              │
│  battleship ──► battleship-verifier-adapter ──► circom-groth16-verifier
│  (game logic)        (proof extraction)         (BN254 Groth16)
│                                                              │
│  mock-game-hub (lifecycle: start_game/end_game)              │
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │ Stellar SDK
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND (React + Three.js)                                 │
│  - Generated bindings call contracts                         │
│  - Witness generation via circuits/build/*_js/               │
│  - Proof generation via snarkjs                              │
└──────────────────────────────────────────────────────────────┘
```

**Contract Deployment Order:** circom-groth16-verifier → battleship-verifier-adapter → battleship

**ZK Proof Flow:**
1. Frontend generates witness using resolve_shot.wasm
2. Frontend creates Groth16 proof with snarkjs
3. battleship.resolve_shot() → adapter.verify_shot() → verifier.verify()
4. If valid: update board state, check win condition, call game_hub.end_game() if finished

## Key Files

### Battleship
| Path | Purpose |
|------|---------|
| `contracts/battleship/src/lib.rs` | Main game contract |
| `contracts/battleship-verifier-adapter/src/lib.rs` | Extracts proof, calls verifier |
| `circuits/resolve_shot.circom` | Proves shot hit/miss and ship sunk |
| `circuits/board_commit.circom` | Proves board validity, outputs commitment |

### Wordle
| Path | Purpose |
|------|---------|
| `contracts/wordle/src/lib.rs` | Main game contract |
| `contracts/wordle-verifier-adapter/src/lib.rs` | Extracts proof, calls verifier |
| `circuits/resolve_guess.circom` | Proves feedback (green/yellow/gray) is correct |
| `circuits/word_commit.circom` | Commits word with Poseidon hash |

### Shared
| Path | Purpose |
|------|---------|
| `contracts/circom-groth16-verifier/` | Generic Groth16 verifier (BN254) |
| `contracts/mock-game-hub/` | Test stub for Game Hub |
| `deployment.json` | Deployed contract IDs and testnet config |

## Contract Patterns

From AGENTS.md golden rules:
- Every game must call Game Hub `start_game` before storing state and `end_game` when finished
- Use `env.prng()` with seeded inputs for randomness (never ledger time/sequence)
- Use temporary storage with 30-day TTL, extend on every write
- Both players must call `require_auth_for_args()` for starting
- Use Error enums, not panics

## Circuit Public Inputs

### Battleship (resolve_shot)
4 public inputs:
1. board_commitment_hi/lo (split 256-bit)
2. public_inputs_hash_hi/lo

### Wordle (resolve_guess)
15 public inputs:
1. word_commitment_hi/lo (split 256-bit)
2. public_inputs_hash_hi/lo
3. guess[5] (letters 0-25)
4. feedback[5] (0=absent, 1=present, 2=correct)
5. is_correct (0 or 1)

Encoding: hi = bytes 0..15, lo = bytes 16..31 (matches adapter `split_u256_to_fr_limbs`)

## Tech Stack

**Contracts:** Rust + Soroban SDK 25.0.2 + Arkworks (BN254, Groth16)
**Circuits:** Circom 2.1.x + circomlib + snarkjs
**Frontend:** React 19 + TypeScript + Vite + Three.js + TailwindCSS + Zustand
**Blockchain:** Stellar SDK, Freighter wallet

## Generated Files (Do Not Edit)

- `bindings/` - TypeScript contract bindings
- `circuits/build/` - Compiled circuits, zkeys, verification keys
- `.env` - Runtime config (gitignored)
- `deployment.json` - Written by deploy script
