#!/usr/bin/env bun

/**
 * Groth16 trusted setup and verification key export for resolve_guess (Wordle).
 *
 * Prerequisites:
 * - Circuits built: bun run circuits:build (produces circuits/build/resolve_guess.r1cs)
 * - snarkjs installed
 * - A powers-of-tau (ptau) file. Check constraint count: npx snarkjs r1cs info circuits/build/resolve_guess.r1cs
 *
 * Usage:
 *   bun run scripts/circuits-setup-vkey-wordle.ts --ptau <path-to.ptau>
 *   PTAU=path/to.ptau bun run scripts/circuits-setup-vkey-wordle.ts
 *
 * Outputs:
 *   circuits/build/resolve_guess_0000.zkey
 *   circuits/build/vkey_wordle.json
 *
 * Then convert for Soroban:
 *   bun run scripts/circuits-vkey-to-soroban.ts circuits/build/vkey_wordle.json --out circuits/build/vkey_wordle_soroban.json
 *
 * Deploy a separate circom-groth16-verifier instance with vkey_wordle_soroban.json
 * and point wordle-verifier-adapter to that verifier (not the Battleship one).
 */

import { $ } from "bun";
import { existsSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..");
const BUILD_DIR = join(ROOT, "circuits", "build");
const R1CS = resolve(BUILD_DIR, "resolve_guess.r1cs");
const ZKEY_INITIAL = resolve(BUILD_DIR, "resolve_guess_0000.zkey");
const ZKEY_FINAL = resolve(BUILD_DIR, "resolve_guess_final.zkey");
const VKEY_JSON = resolve(BUILD_DIR, "vkey_wordle.json");

function usage(): never {
  console.error(`
Usage: bun run scripts/circuits-setup-vkey-wordle.ts --ptau <path-to.ptau>
       PTAU=path/to.ptau bun run scripts/circuits-setup-vkey-wordle.ts

Options:
  --ptau PATH   Path to powers-of-tau file (required if PTAU not set)

The ptau must support at least as many constraints as resolve_guess.
Check with: npx snarkjs r1cs info circuits/build/resolve_guess.r1cs

After this, run:
  bun run scripts/circuits-vkey-to-soroban.ts circuits/build/vkey_wordle.json --out circuits/build/vkey_wordle_soroban.json
Then deploy circom-groth16-verifier with vkey_wordle_soroban.json and use that ID for wordle-verifier-adapter.
`);
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  let ptau = process.env.PTAU;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ptau" && args[i + 1]) {
      ptau = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      usage();
    }
  }

  if (!ptau) {
    console.error("Error: ptau file required. Set --ptau <path> or PTAU=<path>.");
    usage();
  }

  if (!existsSync(R1CS)) {
    console.error("Error: resolve_guess.r1cs not found. Run: bun run circuits:build");
    process.exit(1);
  }

  const ptauPath = resolve(ptau);
  if (!existsSync(ptauPath)) {
    console.error(`Error: ptau file not found: ${ptauPath}`);
    process.exit(1);
  }
  const ptauStat = statSync(ptauPath);
  if (ptauStat.size === 0) {
    console.error(`Error: ptau file is empty: ${ptauPath}`);
    process.exit(1);
  }

  console.log("Groth16 setup for resolve_guess (Wordle)...\n");

  // snarkjs 0.7 g16s requires a "phase 2 prepared" ptau. Prepare it first (pt2).
  const ptauPhase2 = resolve(BUILD_DIR, "ptau_phase2_wordle.ptau");
  console.log("Preparing ptau for phase 2...");
  await $`npx snarkjs pt2 ${ptauPath} ${ptauPhase2}`.cwd(ROOT).quiet();
  console.log("Running snarkjs groth16 setup...");
  await $`npx snarkjs g16s ${R1CS} ${ptauPhase2} ${ZKEY_INITIAL}`.cwd(ROOT).quiet();
  if (!existsSync(ZKEY_INITIAL) || statSync(ZKEY_INITIAL).size === 0) {
    console.error("Error: groth16 setup did not produce a valid zkey. Check that the ptau has enough constraints for resolve_guess.");
    process.exit(1);
  }
  console.log("Wrote", ZKEY_INITIAL);

  // snarkjs 0.7+ exports vkey only from a "phase 2" zkey; contribute once (non-interactive).
  console.log("\nRunning snarkjs zkey contribute (phase 2)...");
  const entropy = Bun.env.ZKEY_ENTROPY ?? crypto.randomUUID() + "-" + Date.now();
  await $`echo ${entropy} | npx snarkjs zkc ${ZKEY_INITIAL} ${ZKEY_FINAL}`.cwd(ROOT).quiet();
  if (!existsSync(ZKEY_FINAL)) {
    console.error("Error: zkey contribute did not create", ZKEY_FINAL);
    process.exit(1);
  }
  console.log("Wrote", ZKEY_FINAL);

  console.log("\nExporting verification key...");
  await $`npx snarkjs zkev ${ZKEY_FINAL} ${VKEY_JSON}`.cwd(ROOT).quiet();
  console.log("Wrote", VKEY_JSON);

  console.log("\nDone. Next:");
  console.log("  bun run scripts/circuits-vkey-to-soroban.ts circuits/build/vkey_wordle.json --out circuits/build/vkey_wordle_soroban.json");
  console.log("Then deploy circom-groth16-verifier with --vk-file-path circuits/build/vkey_wordle_soroban.json");
  console.log("and deploy wordle-verifier-adapter with --verifier <that_verifier_id>.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
