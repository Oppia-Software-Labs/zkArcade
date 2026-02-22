#!/usr/bin/env bun

/**
 * Build script for Circom circuits.
 *
 * Battleship circuits: board_commit, resolve_shot
 * Wordle circuits: word_commit, resolve_guess
 *
 * Compiles circuits with circom using circomlib from node_modules.
 * Outputs R1CS, WASM, and symbol file to circuits/build.
 *
 * Prerequisites:
 * - circom installed (e.g. npm install -g circom, or use npx; recommend 2.1.x)
 * - bun install (or npm install) so node_modules/circomlib exists
 */

import { $ } from "bun";
import { mkdir, readdir, copyFile } from "fs/promises";
import { join } from "path";

const ROOT = import.meta.dir + "/..";
const CIRCUITS_DIR = join(ROOT, "circuits");
const BUILD_DIR = join(CIRCUITS_DIR, "build");
const NODE_MODULES = join(ROOT, "node_modules");

const CIRCUITS = [
  // Battleship circuits
  "board_commit",
  "resolve_shot",
  // Wordle circuits
  "word_commit",
  "resolve_guess",
] as const;

async function main() {
  console.log("🔌 Building Circom circuits...\n");

  // Ensure circom is available
  try {
    await $`circom --version`.quiet();
  } catch {
    console.error("❌ Error: circom not found.");
    console.error("Install it e.g.: npm install -g circom@2.1.x");
    console.error("See https://docs.circom.io/getting-started/installation/");
    process.exit(1);
  }

  // Ensure circomlib is present
  try {
    const p = await Bun.file(join(NODE_MODULES, "circomlib", "circuits", "poseidon.circom")).exists();
    if (!p) {
      throw new Error("poseidon.circom not found");
    }
  } catch {
    console.error("❌ Error: circomlib not found in node_modules.");
    console.error("Run: bun install (or npm install)");
    process.exit(1);
  }

  await mkdir(BUILD_DIR, { recursive: true });

  for (const name of CIRCUITS) {
    const inputPath = join(CIRCUITS_DIR, `${name}.circom`);
    console.log(`Building ${name}.circom...`);
    try {
      await $`circom ${inputPath} -l ${NODE_MODULES} --r1cs --wasm --sym -o ${BUILD_DIR}`;
      console.log(`✅ ${name} built\n`);
    } catch (err) {
      console.error(`❌ Failed to build ${name}:`, err);
      process.exit(1);
    }
  }

  console.log("✅ All circuits built in circuits/build");

  async function copyDir(src: string, dest: string) {
    await mkdir(dest, { recursive: true });
    for (const e of await readdir(src, { withFileTypes: true })) {
      const s = join(src, e.name);
      const d = join(dest, e.name);
      if (e.isDirectory()) await copyDir(s, d);
      else await copyFile(s, d);
    }
  }
  const publicCircuitsBattleship = join(ROOT, "battleship-frontend", "public", "circuits", "build");
  await mkdir(publicCircuitsBattleship, { recursive: true });
  await copyDir(BUILD_DIR, publicCircuitsBattleship);
  console.log("✅ Copied circuits/build to battleship-frontend/public/circuits/build");
  const publicCircuitsWordle = join(ROOT, "wordle-frontend", "public", "circuits", "build");
  await mkdir(publicCircuitsWordle, { recursive: true });
  await copyDir(BUILD_DIR, publicCircuitsWordle);
  console.log("✅ Copied circuits/build to wordle-frontend/public/circuits/build");
}

main();
