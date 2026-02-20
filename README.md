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
cd zkBattleship
bun install
```

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

## Notes

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

## Links
https://developers.stellar.org/
https://risczero.com/
https://jamesbachini.com
https://www.youtube.com/c/JamesBachini
https://bachini.substack.com
https://x.com/james_bachini
https://www.linkedin.com/in/james-bachini/
https://github.com/jamesbachini

## 📄 License

MIT License - see LICENSE file


**Built with ❤️ for Stellar developers**
