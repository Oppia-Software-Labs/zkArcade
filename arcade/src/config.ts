/**
 * Game frontend URLs. Set in .env.local for production or different ports.
 * Defaults assume battleship on 5173 and wordle on 5174 when running separately.
 */
export const GAME_URLS = {
  battleship:
    process.env.NEXT_PUBLIC_BATTLESHIP_URL ?? "http://localhost:5173",
  wordle: process.env.NEXT_PUBLIC_WORDLE_URL ?? "http://localhost:5174",
};
