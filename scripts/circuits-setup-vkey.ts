#!/usr/bin/env bun

/**
 * Groth16 trusted setup and verification key export for resolve_shot.
 *
 * Prerequisites:
 * - Circuits built: bun run circuits:build (produces circuits/build/resolve_shot.r1cs)
 * - snarkjs installed: bun install (or npm install) so npx snarkjs works
 * - A powers-of-tau (ptau) file. The ptau size must be at least as large as the
 *   number of constraints. Run: npx snarkjs r1cs info circuits/build/resolve_shot.r1cs
 *   to get # constraints, then use a ptau with power >= log2(constraints).
 *   Download e.g. from Hermez Phase 1 (see circuits/README.md) or generate with
 *   snarkjs powersoftau new bn128 <power> ptau.ptau
 *
 * Usage:
 *   bun run scripts/circuits-setup-vkey.ts --ptau <path-to.ptau>
 *   PTAU=path/to.ptau bun run scripts/circuits-setup-vkey.ts
 *
 * Optional:
 *   --contribute  Run zkey contribute after setup (interactive) to get resolve_shot_final.zkey
 *
 * Outputs:
 *   circuits/build/resolve_shot_0000.zkey  (initial zkey; or resolve_shot_final.zkey if --contribute)
 *   circuits/build/vkey.json               (snarkjs-format verification key for resolve_shot)
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

const ROOT = import.meta.dir + "/..";
const BUILD_DIR = join(ROOT, "circuits", "build");
const R1CS = join(BUILD_DIR, "resolve_shot.r1cs");
const ZKEY_INITIAL = join(BUILD_DIR, "resolve_shot_0000.zkey");
const ZKEY_FINAL = join(BUILD_DIR, "resolve_shot_final.zkey");
const VKEY_JSON = join(BUILD_DIR, "vkey.json");

function usage(): never {
  console.error(`
Usage: bun run scripts/circuits-setup-vkey.ts --ptau <path-to.ptau>
       PTAU=path/to.ptau bun run scripts/circuits-setup-vkey.ts

Options:
  --ptau PATH   Path to powers-of-tau file (required if PTAU not set)
  --contribute  After setup, run snarkjs zkey contribute (interactive)

The ptau must support at least as many constraints as resolve_shot.
Check with: npx snarkjs r1cs info circuits/build/resolve_shot.r1cs
`);
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  let ptau = process.env.PTAU;
  let contribute = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ptau" && args[i + 1]) {
      ptau = args[++i];
    } else if (args[i] === "--contribute") {
      contribute = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      usage();
    }
  }

  if (!ptau) {
    console.error("Error: ptau file required. Set --ptau <path> or PTAU=<path>.");
    usage();
  }

  if (!existsSync(R1CS)) {
    console.error("Error: resolve_shot.r1cs not found. Run: bun run circuits:build");
    process.exit(1);
  }

  if (!existsSync(ptau)) {
    console.error(`Error: ptau file not found: ${ptau}`);
    process.exit(1);
  }

  console.log("Groth16 setup for resolve_shot...\n");

  // 1) groth16 setup: circuit.r1cs + ptau -> circuit_0000.zkey
  console.log("Running snarkjs groth16 setup...");
  await $`npx snarkjs g16s ${R1CS} ${ptau} ${ZKEY_INITIAL}`.quiet();
  console.log("Wrote", ZKEY_INITIAL);

  let zkeyForVkey = ZKEY_INITIAL;
  if (contribute) {
    console.log("\nRunning snarkjs zkey contribute (interactive)...");
    await $`npx snarkjs zkc ${ZKEY_INITIAL} ${ZKEY_FINAL}`;
    zkeyForVkey = ZKEY_FINAL;
    console.log("Wrote", ZKEY_FINAL);
  }

  // 2) export verification key
  console.log("\nExporting verification key...");
  await $`npx snarkjs zkev ${zkeyForVkey} ${VKEY_JSON}`.quiet();
  console.log("Wrote", VKEY_JSON);

  console.log("\nDone. Next: convert vkey for Soroban with bun run scripts/circuits-vkey-to-soroban.ts circuits/build/vkey.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
