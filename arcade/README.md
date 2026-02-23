# Oppia zkArcade

Landing page and game launcher for the Stellar Game Studio ZK games. Games run as separate frontends and are embedded via iframes when selected from the arcade carousel.

## Default Ports

| App        | Port |
|------------|------|
| Arcade     | 3000 |
| Battleship | 3001 |
| Wordle     | 3002 |

## Development

```bash
# Install dependencies
bun install

# Start the arcade (port 3000 by default)
bun run dev

# Start each game frontend in separate terminals
# (refer to each game's own README for details)
```

## Environment Variables

Game iframe URLs are configured through environment variables. Copy the example file and adjust as needed:

```bash
cp .env.example .env.local
```

| Variable                      | Default                  | Description                |
|-------------------------------|--------------------------|----------------------------|
| `NEXT_PUBLIC_BATTLESHIP_URL`  | `http://localhost:3001`  | Battleship frontend URL    |
| `NEXT_PUBLIC_WORDLE_URL`      | `http://localhost:3002`  | Wordle frontend URL        |

## Deployment

When deploying, set the environment variables to the production URLs of each game frontend:

```
NEXT_PUBLIC_BATTLESHIP_URL=https://battleship.example.com
NEXT_PUBLIC_WORDLE_URL=https://wordle.example.com
```

These can be set in your hosting provider's dashboard (Vercel, Netlify, etc.) or in a `.env.local` file for local builds.
