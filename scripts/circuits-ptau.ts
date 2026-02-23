#!/usr/bin/env bun

/**
 * Generate a phase-1 powers-of-tau file for circuit trusted setup.
 * Runs from repo root so circuits/build/ptau.ptau is always correct.
 *
 * Usage: bun run circuits:ptau [power]
 * Default power: 12 (enough for resolve_shot).
 */

import { $ } from "bun";
import { mkdir } from "fs/promises";
import { join } from "path";

const ROOT = import.meta.dir + "/..";
const BUILD_DIR = join(ROOT, "circuits", "build");
const PTAU_PATH = join(BUILD_DIR, "ptau.ptau");

const power = process.argv[2] ?? "12";

async function main() {
  console.log("🔢 Generating powers of tau (phase 1)...\n");
  await mkdir(BUILD_DIR, { recursive: true });
  await $`npx snarkjs ptn bn128 ${power} ${PTAU_PATH}`;
  console.log("\n✅ Wrote", PTAU_PATH);
  console.log("Next: bun run circuits:setup-vkey -- --ptau circuits/build/ptau.ptau");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
