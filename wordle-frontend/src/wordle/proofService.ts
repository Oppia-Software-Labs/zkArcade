/**
 * Wordle resolve_guess proof generation in the browser (same pattern as Battleship).
 * Fetches resolve_guess WASM and zkey from circuitsBaseUrl, runs snarkjs fullProve,
 * then serializes to the adapter payload format (word_commitment_hi/lo, public_inputs_hash_hi/lo, guess[5], feedback[5], is_correct).
 */

const DEFAULT_CIRCUITS_BASE = '/circuits/build';

const TWO_128 = BigInt('340282366920938463463374607431768211456');

function bigIntToBytes32Be(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0').slice(-64);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
} // 2^128, matches circuit

const PUBLIC_COUNT = 15;
const PROOF_A_BYTES = 64;
const PROOF_B_BYTES = 128;
const PROOF_C_BYTES = 64;
const FR_BYTES = 32;
// Circuit public order: guess[5], feedback[5], is_correct, word_commitment_hi, word_commitment_lo, public_inputs_hash_hi, public_inputs_hash_lo
// Adapter order: word_commitment_hi, word_commitment_lo, public_inputs_hash_hi, public_inputs_hash_lo, guess[5], feedback[5], is_correct
const CIRCUIT_TO_ADAPTER_INDEX = [11, 12, 13, 14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export interface ProofServiceConfig {
  circuitsBaseUrl?: string;
}

function bigIntToBe32(n: bigint): Uint8Array {
  const buf = new Uint8Array(32);
  const hex = n.toString(16).padStart(64, '0');
  for (let i = 0; i < 32; i++) buf[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return buf;
}

/**
 * Proof encoding: Soroban BN254 expects be_bytes(X)||be_bytes(Y) for G1;
 * G2: be_bytes(x_c1)||be_bytes(x_c0)||be_bytes(y_c1)||be_bytes(y_c0).
 * Snarkjs pi_a/pi_c are [x,y]; pi_b is [[x_c0,x_c1],[y_c0,y_c1]] (Fp2 = c0 + c1*u).
 */
function proofLimb(n: bigint): Uint8Array {
  return bigIntToBe32(n);
}

function parseProof(proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }) {
  const a = new Uint8Array(PROOF_A_BYTES);
  a.set(proofLimb(BigInt(proof.pi_a[0]!)), 0);
  a.set(proofLimb(BigInt(proof.pi_a[1]!)), 32);
  const b = new Uint8Array(PROOF_B_BYTES);
  const [bx0, bx1, by0, by1] = [
    proof.pi_b[0]![0]!,
    proof.pi_b[0]![1]!,
    proof.pi_b[1]![0]!,
    proof.pi_b[1]![1]!,
  ];
  b.set(proofLimb(BigInt(bx1)), 0);
  b.set(proofLimb(BigInt(bx0)), 32);
  b.set(proofLimb(BigInt(by1)), 64);
  b.set(proofLimb(BigInt(by0)), 96);
  const c = new Uint8Array(PROOF_C_BYTES);
  c.set(proofLimb(BigInt(proof.pi_c[0]!)), 0);
  c.set(proofLimb(BigInt(proof.pi_c[1]!)), 32);
  return { a, b, c };
}

function buildAdapterPayload(proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }, publicSignals: string[]): Uint8Array {
  const { a, b, c } = parseProof(proof);
  const payload = new Uint8Array(4 + PROOF_A_BYTES + PROOF_B_BYTES + PROOF_C_BYTES + PUBLIC_COUNT * FR_BYTES);
  let o = 0;
  payload[o++] = (PUBLIC_COUNT >> 24) & 0xff;
  payload[o++] = (PUBLIC_COUNT >> 16) & 0xff;
  payload[o++] = (PUBLIC_COUNT >> 8) & 0xff;
  payload[o++] = PUBLIC_COUNT & 0xff;
  payload.set(a, o); o += PROOF_A_BYTES;
  payload.set(b, o); o += PROOF_B_BYTES;
  payload.set(c, o); o += PROOF_C_BYTES;
  for (let i = 0; i < PUBLIC_COUNT; i++) {
    payload.set(bigIntToBe32(BigInt(publicSignals[CIRCUIT_TO_ADAPTER_INDEX[i]!]!)), o);
    o += FR_BYTES;
  }
  return payload;
}

/**
 * Compute word_commitment_hi and word_commitment_lo using the word_commit WASM
 * so they match the circuit's Poseidon (same as resolve_guess).
 * wordIndices: 5 numbers 0–25 (A–Z). salt: decimal string (e.g. "1").
 */
export async function getWordCommitmentHiLoFromWasm(
  wordIndices: number[],
  salt: string,
  config?: ProofServiceConfig
): Promise<{ hi: string; lo: string }> {
  const base = config?.circuitsBaseUrl ?? DEFAULT_CIRCUITS_BASE;
  const wasmUrl = `${base}/word_commit_js/word_commit.wasm`;
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`Failed to fetch word_commit WASM: ${wasmUrl}`);
  const wasmBuffer = await res.arrayBuffer();
  const { WitnessCalculatorBuilder } = await import('circom_runtime');
  const wc = await WitnessCalculatorBuilder(wasmBuffer);
  const witness = await wc.calculateWitness({ word: wordIndices, salt });
  // Circom 2 witness order: [1, outputs..., inputs..., intermediates...]. Output at index 1 (same as Battleship board_commit).
  const commitmentField = witness[1];
  if (commitmentField == null) throw new Error('Word commitment witness output missing');
  const commitment = BigInt(commitmentField.toString());
  const hi = commitment / TWO_128;
  const lo = commitment % TWO_128;
  return { hi: hi.toString(), lo: lo.toString() };
}

/**
 * Compute word commitment as 32 bytes using word_commit WASM (same as circuit).
 * Use this for commit_word so the on-chain commitment matches the proof.
 */
export async function getWordCommitmentBytesFromWasm(
  wordIndices: number[],
  salt: string,
  config?: ProofServiceConfig
): Promise<Uint8Array> {
  const { hi, lo } = await getWordCommitmentHiLoFromWasm(wordIndices, salt, config);
  const commitment = BigInt(hi) * TWO_128 + BigInt(lo);
  return bigIntToBytes32Be(commitment);
}

/** Witness input for resolve_guess (same shape as buildResolveInput in WordleGame). */
export interface ResolveGuessWitnessInput {
  word: number[];
  salt: string;
  guess: number[];
  feedback: number[];
  is_correct: number;
  word_commitment_hi: string;
  word_commitment_lo: string;
  public_inputs_hash_hi: string;
  public_inputs_hash_lo: string;
}

/**
 * Generate resolve_guess proof in the browser (WASM + snarkjs), return adapter payload.
 * Requires circuits at circuitsBaseUrl: resolve_guess.wasm and resolve_guess_final.zkey.
 * Use the same zkey as the one used to export the vkey (resolve_guess_final.zkey from circuits:setup-vkey-wordle).
 */
export async function generateResolveGuessProof(
  witnessInput: ResolveGuessWitnessInput,
  config?: ProofServiceConfig
): Promise<Uint8Array> {
  const base = config?.circuitsBaseUrl ?? DEFAULT_CIRCUITS_BASE;
  const wasmUrl = `${base}/resolve_guess_js/resolve_guess.wasm`;
  const zkeyUrl = `${base}/resolve_guess_final.zkey`;

  const { groth16 } = await import('snarkjs');
  const { proof, publicSignals } = await groth16.fullProve(
    witnessInput as unknown as Record<string, unknown>,
    wasmUrl,
    zkeyUrl
  );

  const publicStr = (publicSignals as (string | number)[]).map((x) => String(x));
  return buildAdapterPayload(
    proof as { pi_a: string[]; pi_b: string[][]; pi_c: string[] },
    publicStr
  );
}
