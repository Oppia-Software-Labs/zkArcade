#!/usr/bin/env bun

/**
 * Generate a ZK proof for Wordle resolve_guess and output the payload in hex
 * for pasting into the wordle-frontend "Proof ZK (hex)" field.
 *
 * Prerequisites:
 * - bun run circuits:build (builds resolve_guess)
 * - resolve_guess zkey exists: run setup for resolve_guess, e.g.:
 *   npx snarkjs pt2 circuits/build/ptau.ptau circuits/build/ptau_phase2.ptau
 *   npx snarkjs g16s circuits/build/resolve_guess.r1cs circuits/build/ptau_phase2.ptau circuits/build/resolve_guess_0000.zkey
 *
 * Usage (from repo root):
 *   bun run scripts/circuits-prove-resolve-guess.ts [input.json]
 *
 * Default input: circuits/example_input_resolve_guess.json
 *
 * Output: One line of hex (the proof payload for resolve_guess). Copy into the frontend.
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

const ROOT = import.meta.dir + "/..";
const CIRCUITS = join(ROOT, "circuits");
const BUILD = join(CIRCUITS, "build");
const WASM = join(BUILD, "resolve_guess_js", "resolve_guess.wasm");
const WITNESS_GEN = join(BUILD, "resolve_guess_js", "generate_witness.js");
const ZKEY = join(BUILD, "resolve_guess_0000.zkey");
const DEFAULT_INPUT = join(CIRCUITS, "example_input_resolve_guess.json");

// Adapter expects: 4 bytes count (15), proof a(64), b(128), c(64), then 15 × 32-byte public inputs
const PUBLIC_COUNT = 15;
const PROOF_A_BYTES = 64;
const PROOF_B_BYTES = 128;
const PROOF_C_BYTES = 64;
const FR_BYTES = 32;

function bigIntToBe32(n: bigint): Uint8Array {
  const buf = new Uint8Array(32);
  const hex = n.toString(16).padStart(64, "0");
  for (let i = 0; i < 32; i++) buf[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return buf;
}

function parseProof(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): { a: Uint8Array; b: Uint8Array; c: Uint8Array } {
  const a = new Uint8Array(PROOF_A_BYTES);
  const ax = bigIntToBe32(BigInt(proof.pi_a[0]));
  const ay = bigIntToBe32(BigInt(proof.pi_a[1]));
  a.set(ax, 0);
  a.set(ay, 32);

  const b = new Uint8Array(PROOF_B_BYTES);
  const [bx1, bx0, by1, by0] = [
    proof.pi_b[0][1],
    proof.pi_b[0][0],
    proof.pi_b[1][1],
    proof.pi_b[1][0],
  ];
  b.set(bigIntToBe32(BigInt(bx1)), 0);
  b.set(bigIntToBe32(BigInt(bx0)), 32);
  b.set(bigIntToBe32(BigInt(by1)), 64);
  b.set(bigIntToBe32(BigInt(by0)), 96);

  const c = new Uint8Array(PROOF_C_BYTES);
  const cx = bigIntToBe32(BigInt(proof.pi_c[0]));
  const cy = bigIntToBe32(BigInt(proof.pi_c[1]));
  c.set(cx, 0);
  c.set(cy, 32);

  return { a, b, c };
}

// Circuit public order: guess[5], feedback[5], is_correct, word_commitment_hi, word_commitment_lo, public_inputs_hash_hi, public_inputs_hash_lo
// Adapter order: word_commitment_hi, word_commitment_lo, public_inputs_hash_hi, public_inputs_hash_lo, guess[5], feedback[5], is_correct
const CIRCUIT_TO_ADAPTER_INDEX = [11, 12, 13, 14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function buildPayload(proofJson: any, publicJson: any): Uint8Array {
  const proof = parseProof(proofJson);
  const publics = publicJson as string[];

  const payloadSize = 4 + PROOF_A_BYTES + PROOF_B_BYTES + PROOF_C_BYTES + PUBLIC_COUNT * FR_BYTES;
  const payload = new Uint8Array(payloadSize);
  let offset = 0;

  payload[offset] = (PUBLIC_COUNT >> 24) & 0xff;
  payload[offset + 1] = (PUBLIC_COUNT >> 16) & 0xff;
  payload[offset + 2] = (PUBLIC_COUNT >> 8) & 0xff;
  payload[offset + 3] = PUBLIC_COUNT & 0xff;
  offset += 4;

  payload.set(proof.a, offset);
  offset += PROOF_A_BYTES;
  payload.set(proof.b, offset);
  offset += PROOF_B_BYTES;
  payload.set(proof.c, offset);
  offset += PROOF_C_BYTES;

  for (let i = 0; i < PUBLIC_COUNT; i++) {
    const idx = CIRCUIT_TO_ADAPTER_INDEX[i];
    const fr = bigIntToBe32(BigInt(publics[idx]));
    payload.set(fr, offset);
    offset += FR_BYTES;
  }

  return payload;
}

async function main() {
  const inputPath = process.argv[2] || DEFAULT_INPUT;
  if (!existsSync(inputPath)) {
    console.error("Error: input file not found:", inputPath);
    process.exit(1);
  }
  if (!existsSync(WASM)) {
    console.error("Error: resolve_guess WASM not found. Run: bun run circuits:build");
    process.exit(1);
  }
  if (!existsSync(ZKEY)) {
    console.error("Error: resolve_guess_0000.zkey not found. Run Groth16 setup for resolve_guess:");
    console.error("  npx snarkjs pt2 circuits/build/ptau.ptau circuits/build/ptau_phase2.ptau");
    console.error("  npx snarkjs g16s circuits/build/resolve_guess.r1cs circuits/build/ptau_phase2.ptau circuits/build/resolve_guess_0000.zkey");
    process.exit(1);
  }

  const witnessPath = join(BUILD, "witness_resolve_guess.wtns");
  const proofPath = join(BUILD, "proof_resolve_guess.json");
  const publicPath = join(BUILD, "public_resolve_guess.json");

  console.log("Generating witness...");
  await $`node ${WITNESS_GEN} ${WASM} ${inputPath} ${witnessPath}`.quiet();

  console.log("Proving...");
  await $`npx snarkjs groth16 prove ${ZKEY} ${witnessPath} ${proofPath} ${publicPath}`.quiet();

  const proofJson = await Bun.file(proofPath).json();
  const publicJson = await Bun.file(publicPath).json();
  const payload = buildPayload(proofJson, publicJson);
  const hex = Array.from(payload)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  console.log("\nProof payload (hex) — paste into Wordle frontend \"Proof ZK (hex)\":\n");
  console.log(hex);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
