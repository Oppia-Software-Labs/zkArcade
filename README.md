# zkBattleship

Two-player Battleship on Stellar with zero-knowledge proofs: ship positions are hidden onchain until hit. Built with Soroban smart contracts, a Circom/Groth16 verifier, and a 3D frontend.

## Quick Start

```bash
git clone https://github.com/Oppia-Software-Labs/zkbattleship.git
cd zkBattleship
bun install


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

The battleship contract is deployed with this Game Hub address in its constructor. It calls `game_hub.start_game(...)` when a match starts (after both players authorize) and `game_hub.end_game(...)` when a winner is determined (17 hits).

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

## Links

- [Stellar / Soroban docs](https://developers.stellar.org/)

## License

MIT - see LICENSE.
