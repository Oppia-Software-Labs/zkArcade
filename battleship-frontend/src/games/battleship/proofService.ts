/**
 * Proof service for Battleship: board commitment (BoardCommit WASM) and
 * resolve_shot proof generation with adapter payload serialization.
 *
 * Circuit artifacts (WASM, zkey) must be available at circuitsBaseUrl, e.g.
 * copy circuits/build to public/circuits/build so that:
 * - board_commit_js/board_commit.wasm
 * - resolve_shot_js/resolve_shot.wasm
 * - resolve_shot_0000.zkey (or resolve_shot_final.zkey)
 * are fetchable.
 */

import buildBoardCommitWitnessCalculator from "./circuits/board_commit_witness_calculator.js";

/** Ship lengths in cell count: Carrier, Battleship, Cruiser, Submarine, Destroyer */
const SHIP_LENS = [5, 4, 3, 3, 2] as const;

/** Board layout: 5 ships with (x, y, dir). dir: 0 = vertical, 1 = horizontal. */
export interface ShipPosition {
  ship_x: number[];
  ship_y: number[];
  ship_dir: number[];
}

export interface ProofServiceConfig {
  /** Base URL for circuit artifacts (default '/circuits/build'). */
  circuitsBaseUrl?: string;
}

const DEFAULT_CIRCUITS_BASE = "/circuits/build";

/** Encode a non-negative BigInt as 32-byte big-endian (pad with leading zeros). */
function bigIntToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Split a 32-byte value into hi/lo limbs as the adapter expects.
 * hi = bytes 0..15 right-aligned in 32 bytes, lo = bytes 16..31 right-aligned.
 * Returns two 32-byte arrays suitable for Fr encoding in the payload.
 */
export function splitU256ToFrLimbs(value: Uint8Array): { hi: Uint8Array; lo: Uint8Array } {
  if (value.length !== 32) throw new Error("splitU256ToFrLimbs: value must be 32 bytes");
  const hi = new Uint8Array(32);
  const lo = new Uint8Array(32);
  hi.set(value.subarray(0, 16), 16);
  lo.set(value.subarray(16, 32), 16);
  return { hi, lo };
}

/**
 * Encode a BigInt as a 32-byte limb for the adapter (right-aligned 16-byte value in 32 bytes).
 * Used for public inputs in the payload.
 */
function frLimbFromBigInt(value: bigint): Uint8Array {
  const limb = new Uint8Array(32);
  const hex = value.toString(16).padStart(32, "0"); // 16 bytes = 32 hex chars
  for (let i = 0; i < 16; i++) {
    limb[16 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return limb;
}

/**
 * 1) Implement computeBoardCommitment (BoardCommit WASM + 32-byte encoding).
 * Runs the BoardCommit circuit WASM with the given ship positions and salt,
 * returns the board commitment as 32 bytes (same encoding as used in commit_board and in proof public inputs).
 */
export async function computeBoardCommitment(
  shipPositions: ShipPosition,
  salt: bigint | string,
  config?: ProofServiceConfig
): Promise<Uint8Array> {
  const base = config?.circuitsBaseUrl ?? DEFAULT_CIRCUITS_BASE;
  const wasmUrl = `${base}/board_commit_js/board_commit.wasm`;
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`Failed to fetch board_commit WASM: ${wasmUrl}`);
  const wasmBuffer = await res.arrayBuffer();

  const wc = await buildBoardCommitWitnessCalculator(wasmBuffer);
  const saltStr = typeof salt === "bigint" ? salt.toString() : String(salt);
  const input = {
    ship_x: shipPositions.ship_x,
    ship_y: shipPositions.ship_y,
    ship_dir: shipPositions.ship_dir,
    salt: saltStr,
  };
  const witness = await wc.calculateWitness(input, 0);
  // Last witness element is the single output: board_commitment
  const commitmentField = witness[witness.length - 1];
  if (commitmentField == null) throw new Error("Board commitment witness output missing");
  return bigIntToBytes32(commitmentField);
}

/**
 * ResolveShot witness input (private + public). Public inputs must match adapter order:
 * board_commitment_hi, board_commitment_lo, public_inputs_hash_hi, public_inputs_hash_lo.
 */
export interface ResolveShotWitnessInput {
  ship_x: number[];
  ship_y: number[];
  ship_dir: number[];
  salt: string;
  prior_hits: number[];
  shot_x: number;
  shot_y: number;
  is_hit: number;
  sunk_ship: number;
  board_commitment_hi: string;
  board_commitment_lo: string;
  public_inputs_hash_hi: string;
  public_inputs_hash_lo: string;
}

/** Big-endian bytes to BigInt (for 16-byte hi/lo values used as circuit inputs). */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

/**
 * 2) Implement buildResolveShotInput with prior_hits from local state and public_inputs_hash hi/lo matching adapter.
 * prior_hits: 17 elements, 1 if that cell (in BoardLayout order) was already hit, 0 otherwise.
 * board_commitment and public_inputs_hash: 32-byte values; hi = bytes 0..15 as integer, lo = bytes 16..31 as integer (adapter convention); passed as decimal strings for snarkjs.
 */
export function buildResolveShotInput(
  shipPositions: ShipPosition,
  salt: bigint | string,
  prior_hits: number[],
  shot_x: number,
  shot_y: number,
  is_hit: number,
  sunk_ship: number,
  board_commitment: Uint8Array,
  public_inputs_hash: Uint8Array
): ResolveShotWitnessInput {
  if (prior_hits.length !== 17) throw new Error("prior_hits must have length 17");
  if (board_commitment.length !== 32) throw new Error("board_commitment must be 32 bytes");
  if (public_inputs_hash.length !== 32) throw new Error("public_inputs_hash must be 32 bytes");

  const board_commitment_hi = bytesToBigInt(board_commitment.subarray(0, 16)).toString();
  const board_commitment_lo = bytesToBigInt(board_commitment.subarray(16, 32)).toString();
  const public_inputs_hash_hi = bytesToBigInt(public_inputs_hash.subarray(0, 16)).toString();
  const public_inputs_hash_lo = bytesToBigInt(public_inputs_hash.subarray(16, 32)).toString();

  const saltStr = typeof salt === "bigint" ? salt.toString() : String(salt);
  return {
    ship_x: shipPositions.ship_x,
    ship_y: shipPositions.ship_y,
    ship_dir: shipPositions.ship_dir,
    salt: saltStr,
    prior_hits,
    shot_x,
    shot_y,
    is_hit,
    sunk_ship,
    board_commitment_hi,
    board_commitment_lo,
    public_inputs_hash_hi,
    public_inputs_hash_lo,
  };
}

/** Adapter payload: 4 bytes count (BE u32) + proof (a,b,c) + 4 public inputs × 32 bytes. */
const PAYLOAD_HEADER_BYTES = 4;
const G1_BYTES = 64;
const G2_BYTES = 128;
const FR_BYTES = 32;
const PUBLIC_INPUT_COUNT = 4;

/**
 * Serialize proof and public signals into the adapter payload format.
 * - bytes 0..4: big-endian u32 public input count (4)
 * - bytes 4..68: proof.a (64 bytes, G1)
 * - bytes 68..196: proof.b (128 bytes, G2)
 * - bytes 196..260: proof.c (64 bytes, G1)
 * - bytes 260..: 4 public inputs, each 32 bytes (Fr: right-aligned 16-byte value)
 */
function serializeAdapterPayload(
  proof: { pi_a: bigint[]; pi_b: bigint[][]; pi_c: bigint[] },
  publicSignals: bigint[]
): Uint8Array {
  if (publicSignals.length !== PUBLIC_INPUT_COUNT) {
    throw new Error(`Expected ${PUBLIC_INPUT_COUNT} public signals, got ${publicSignals.length}`);
  }
  const total =
    PAYLOAD_HEADER_BYTES + G1_BYTES + G2_BYTES + G1_BYTES + PUBLIC_INPUT_COUNT * FR_BYTES;
  const out = new Uint8Array(total);
  let offset = 0;

  const writeU32BE = (v: number) => {
    out[offset++] = (v >> 24) & 0xff;
    out[offset++] = (v >> 16) & 0xff;
    out[offset++] = (v >> 8) & 0xff;
    out[offset++] = v & 0xff;
  };
  const writeG1 = (p: bigint[]) => {
    const x = bigIntToBytes32(p[0]);
    const y = bigIntToBytes32(p[1]);
    out.set(x, offset);
    out.set(y, offset + 32);
    offset += G1_BYTES;
  };
  const writeG2 = (p: bigint[][]) => {
    // G2: two Fp2 elements (x, y). Each Fp2 = (c0, c1). Order for Soroban: typically x_c0, x_c1, y_c0, y_c1
    const [x0, x1] = p[0];
    const [y0, y1] = p[1];
    out.set(bigIntToBytes32(x0), offset);
    out.set(bigIntToBytes32(x1), offset + 32);
    out.set(bigIntToBytes32(y0), offset + 64);
    out.set(bigIntToBytes32(y1), offset + 96);
    offset += G2_BYTES;
  };

  writeU32BE(PUBLIC_INPUT_COUNT);
  writeG1(proof.pi_a);
  writeG2(proof.pi_b);
  writeG1(proof.pi_c);
  for (const s of publicSignals) {
    out.set(frLimbFromBigInt(s), offset);
    offset += FR_BYTES;
  }
  return out;
}

/**
 * 3) Implement generateResolveShotProof (resolve_shot WASM + snarkjs) and adapter payload serialization.
 * Fetches resolve_shot WASM and zkey from circuitsBaseUrl, runs snarkjs fullProve, then serializes to adapter payload.
 * Requires snarkjs and circuit artifacts to be available (in browser, serve circuits/build under public/circuits/build and add snarkjs as dependency).
 */
export async function generateResolveShotProof(
  witnessInput: ResolveShotWitnessInput,
  config?: ProofServiceConfig
): Promise<Uint8Array> {
  const base = config?.circuitsBaseUrl ?? DEFAULT_CIRCUITS_BASE;
  const wasmUrl = `${base}/resolve_shot_js/resolve_shot.wasm`;
  const zkeyUrl = `${base}/resolve_shot_0000.zkey`;

  const { groth16 } = await import("snarkjs");
  const { proof, publicSignals } = await groth16.fullProve(witnessInput, wasmUrl, zkeyUrl);

  const proofBigInt = {
    pi_a: proof.pi_a.map((x: string | number) => BigInt(x)),
    pi_b: proof.pi_b.map((row: (string | number)[]) => row.map((x: string | number) => BigInt(x))),
    pi_c: proof.pi_c.map((x: string | number) => BigInt(x)),
  };
  const publicBigInt = publicSignals.map((x: string | number) => BigInt(x));
  return serializeAdapterPayload(proofBigInt, publicBigInt);
}
