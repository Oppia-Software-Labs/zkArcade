/**
 * Game frontend URLs. Set in .env.local for production or different ports.
 * Defaults: battleship on 3001, wordle on 3002.
 */
export const GAME_URLS = {
  battleship:
    process.env.NEXT_PUBLIC_BATTLESHIP_URL ?? "http://localhost:3001",
  wordle: process.env.NEXT_PUBLIC_WORDLE_URL ?? "http://localhost:3002",
};
