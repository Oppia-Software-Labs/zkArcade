/**
 * Word commitment for Wordle: Poseidon(word[5], salt) -> 32 bytes.
 * Must match circuits/wordle_utils.circom WordCommitment (Poseidon(6)).
 */

const WORD_LENGTH = 5;

function bigIntToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0').slice(-64);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

let poseidonInstance: ((inputs: bigint[]) => bigint) | undefined;

async function getPoseidon(): Promise<(inputs: bigint[]) => bigint> {
  if (poseidonInstance) return poseidonInstance;
  const { buildPoseidon } = await import('circomlibjs');
  const instance = await buildPoseidon();
  poseidonInstance = instance;
  return instance;
}

/**
 * Letters A-Z to 0-25.
 */
export function wordToIndices(word: string): number[] {
  const upper = word.toUpperCase().replace(/[^A-Z]/g, '').slice(0, WORD_LENGTH).padEnd(WORD_LENGTH, ' ');
  return Array.from(upper).map((c) => (c === ' ' ? 0 : c.charCodeAt(0) - 65));
}

/**
 * Compute word commitment as 32 bytes (Poseidon(word[5], salt)).
 * word: 5-letter string (A-Z). salt: number or string (used as bigint).
 */
export async function computeWordCommitment(word: string, salt: bigint | number | string): Promise<Uint8Array> {
  const indices = wordToIndices(word);
  const saltBn = typeof salt === 'bigint' ? salt : BigInt(salt);
  const poseidon = await getPoseidon();
  const inputs = [...indices.map((i) => BigInt(i)), saltBn];
  const out = poseidon(inputs);
  return bigIntToBytes32(out);
}
