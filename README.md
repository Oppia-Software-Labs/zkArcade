# zkBattleship

Battleship on Stellar with zero-knowledge proofs: Circom circuits + Groth16 verifier on Soroban.

**Start here:** [Stellar Game Studio](https://jamesbachini.github.io/Stellar-Game-Studio/)

---

## Prerequisites

- **Bun** (or Node) and **Rust** with `wasm32` target
- **Stellar CLI** (`stellar`) for deploy — [install](https://developers.stellar.org/docs/tools/developer-tools)
- **Circom 2.1.x** (only if you will build circuits and deploy the ZK verifier):
  ```bash
  npm install -g circom@2.1.x
  ```

Run all commands below **from the repo root** (or use `bun run` so paths are correct).

---

## Quick start (full setup)

One-time setup: build contracts, build circuits + verification key, deploy to testnet, generate bindings.

```bash
git clone <your-repo-url>
Two-player Battleship on Stellar with zero-knowledge proofs: ship positions are hidden onchain until hit. Built with Soroban smart contracts, a Circom/Groth16 verifier, and a 3D frontend.

## Quick Start

```bash
git clone https://github.com/Oppia-Software-Labs/zkbattleship.git
cd zkBattleship
bun install
```

<<<<<<< HEAD
Then either:

**Option A — Full setup (contracts + circuits + deploy)**  
Use this if you want to deploy and run the Battleship frontend with ZK verification.

```bash
bun run setup
```

If you don’t have Circom installed, `setup` skips the circuit build; **deploy will then fail** until the verification key exists. To complete ZK and deploy:

```bash
npm install -g circom@2.1.x
bun run circuits:build
bun run circuits:ptau
bun run circuits:setup-vkey -- --ptau circuits/build/ptau.ptau
bun run circuits:vkey-to-soroban
bun run deploy
bun run bindings
```

**Option B — Contracts and deploy only (no circuits)**  
If the repo already has `circuits/build/vkey_soroban.json` (e.g. from CI or a teammate), you can run:

```bash
bun run setup
```

and deploy will use that verification key.

---

## Run the Battleship frontend

After setup (and once `deployment.json` / `.env` exist):

```bash
bun run dev:game battleship
```

Or from the frontend folder:

```bash
cd battleship-frontend && bun run dev
```

## Commands (run from repo root)

| Command | Description |
|--------|-------------|
| `bun run setup` | Build contracts, (optional) circuits, deploy to testnet, bindings, write `.env` |
| `bun run build` | Build Soroban contracts only |
| `bun run deploy` | Deploy contracts to testnet (needs `vkey_soroban.json` for battleship) |
| `bun run bindings` | Generate TypeScript bindings from built WASM |
| `bun run dev:game battleship` | Run Battleship frontend with dev wallets |
| `bun run circuits:build` | Compile Circom circuits (requires `circom` on PATH) |
| `bun run circuits:ptau` | Generate phase-1 ptau file (always use this, not raw `npx snarkjs ptn`) |
| `bun run circuits:setup-vkey -- --ptau circuits/build/ptau.ptau` | Trusted setup + export vkey |
| `bun run circuits:vkey-to-soroban` | Convert vkey to format used by circom-groth16-verifier |

## Project structure

```
├── contracts/                  # Soroban: battleship, verifier adapter, circom-groth16-verifier, mock-game-hub
├── circuits/                   # Circom: board_commit, resolve_shot — see circuits/README.md
├── battleship-frontend/       # Battleship game UI
├── scripts/                    # Build, deploy, circuits, bindings
├── bindings/                   # Generated TypeScript bindings (do not edit)
├── deployment.json             # Written by deploy (testnet contract IDs + wallets)
└── .env                        # Written by setup/deploy (RPC, contract IDs, dev secrets — gitignored)
```

## Circuits (ZK setup)

Battleship uses Groth16 proofs; the verifier contract needs a verification key. To generate it once:

1. Install Circom: `npm install -g circom@2.1.x`
2. From repo root, in order:
   - `bun run circuits:build`
   - `bun run circuits:ptau` (creates `circuits/build/ptau.ptau`)
   - `bun run circuits:setup-vkey -- --ptau circuits/build/ptau.ptau`
   - `bun run circuits:vkey-to-soroban` → produces `circuits/build/vkey_soroban.json`

Full details and troubleshooting: **[circuits/README.md](circuits/README.md)**.

## Publish (production)

```bash
bun run publish battleship --build
# Then update runtime config in: dist/battleship-frontend/public/game-studio-config.js
```
=======

bun run circuits:build
bun run circuits:setup-vkey -- --ptau <path-to.ptau>
bun run circuits:vkey-to-soroban

bun run setup

# Run the Battleship frontend
bun run dev:game battleship
# or: cd battleship-frontend && bun run dev
```

Dev wallets and contract IDs are created during deploy and stored in `.env` (gitignored).

## Project Structure

```
├── contracts/
│   ├── battleship/              # Main game contract (board commit, shots, ZK verify)
│   ├── battleship-verifier-adapter/  # Wraps circom Groth16 verifier for Soroban
│   ├── circom-groth16-verifier/ # Onchain Groth16 verifier
│   └── mock-game-hub/           # Mock hub for local/testing (testnet uses shared hub)
├── circuits/                    # Circom circuits (board hash, shot resolution)
├── battleship-frontend/         # 3D Battleship UI + contract integration
├── scripts/                     # Build, deploy, bindings, circuits
├── bindings/                    # Generated TypeScript bindings (do not edit)
├── deployment.json             # Deployed contract IDs and network config
└── .env                         # Secrets and contract IDs (gitignored)
```

## Commands

| Command | Description |
|--------|-------------|
| `bun run setup` | Build + deploy testnet contracts, generate bindings, write `.env` |
| `bun run build [contract...]` | Build contracts (e.g. `battleship`, `circom-groth16-verifier`) |
| `bun run deploy [contract...]` | Deploy to Stellar Testnet |
| `bun run bindings [contract...]` | Regenerate TypeScript bindings |
| `bun run dev:game battleship` | Run Battleship frontend with dev wallet switching |
| `bun run publish battleship --build` | Production build of frontend → `dist/` |
| `bun run circuits:build` | Compile Circom circuits |
| `bun run circuits:setup-vkey -- --ptau <file>` | Trusted setup (Powers of Tau) |
| `bun run circuits:vkey-to-soroban` | Export verification key for Soroban verifier |

## Onchain / Game Hub Requirements

- **Network:** Stellar Testnet. All game state and contracts live onchain.
- **Game Hub:** The battleship contract must call `start_game()` and `end_game()` on the shared Game Hub:
  - **Testnet Game Hub:** `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`
>>>>>>> feat/zkbattleship-game

The battleship contract is deployed with this Game Hub address in its constructor. It calls `game_hub.start_game(...)` when a match starts (after both players authorize) and `game_hub.end_game(...)` when a winner is determined (17 hits).

<<<<<<< HEAD
- **Always run commands from the repo root.** Using `bun run <script>` ensures the correct working directory.
- Dev wallets and contract IDs are written to `.env` by `setup` / `deploy` (gitignored).
- If deploy fails with “Missing required argument 'verifier'” or “vkey_soroban.json not found”, complete the [Circuits (ZK setup)](#circuits-zk-setup) steps first.
- Testnet Game Hub (mock): `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG`

## Studio / docs

From repo root:

```bash
bun run dev                    # Studio frontend (sgs_frontend)
bun --cwd=sgs_frontend run build:docs   # Build docs into docs/
```
=======
**Game Hub interface (Soroban):**

```rust
#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );
    fn end_game(env: Env, session_id: u32, player1_won: bool);
}
```

## How the Game Works

- Two players commit to board placements (hash only onchain).
- Turns: shooter calls `fire`, then opponent submits a ZK proof that the shot is hit/miss (and optionally which ship) without revealing the full board.
- First to 17 hits wins; contract calls `end_game(session_id, player1_won)` and stores the winner.

## Config and Production

- **Runtime config:** Frontend reads contract IDs and RPC from `battleship-frontend/public/game-studio-config.js` (or env at build time). Update this for production.
- **Share link domain:** Set `VITE_APP_DOMAIN` (e.g. `https://zkbattleship.vercel.app`) so the winner’s “Share on X” button uses your production URL. If unset, the current origin is used.
- **Secrets:** `.env` holds dev wallet secrets and is not committed. Never commit secret keys.
>>>>>>> feat/zkbattleship-game

## Links

- [Stellar / Soroban docs](https://developers.stellar.org/)

## License

MIT - see LICENSE.
