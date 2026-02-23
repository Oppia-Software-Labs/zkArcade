#!/usr/bin/env bun

/**
 * Build script for Soroban contracts
 *
 * Pipeline: circom circuits → Groth16 proofs → circom-groth16-verifier (Rust)
 *   → stellar contract build --optimize → target/wasm32v1-none/release/<name>.wasm
 *
 * Uses stellar CLI with wasm32v1-none target. --optimize is REQUIRED: without it,
 * stellar produces 0-byte WASM files that fail at deploy with "unexpected end-of-file".
 * Package names with hyphens (e.g. circom-groth16-verifier) become underscores in
 * the output filename (circom_groth16_verifier.wasm).
 */

import { $ } from "bun";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

const ROOT = join(import.meta.dir, "..");

// Ensure cwd is project root so stellar/cargo resolve paths correctly (avoids "Failed to read module")
process.chdir(ROOT);

function usage() {
  console.log(`
Usage: bun run build [contract-name...]

Examples:
  bun run build
  bun run build number-guess
  bun run build twenty-one number-guess
`);
}

console.log("🔨 Building Soroban contracts...\n");

// Check if stellar CLI is available
try {
  await $`stellar --version`.quiet();
} catch (error) {
  console.error("❌ Error: stellar CLI not found");
  console.error("Please install it: https://developers.stellar.org/docs/tools/developer-tools");
  process.exit(1);
}

// Check if wasm32v1-none target is installed
try {
  const result = await $`rustup target list --installed`.text();
  if (!result.includes("wasm32v1-none")) {
    console.log("📦 Installing wasm32v1-none target...");
    await $`rustup target add wasm32v1-none`;
  }
} catch (error) {
  console.error("❌ Error checking Rust targets:", error);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const contracts = await getWorkspaceContracts();
const selection = selectContracts(contracts, args);
if (selection.unknown.length > 0 || selection.ambiguous.length > 0) {
  console.error("❌ Error: Unknown or ambiguous contract names.");
  if (selection.unknown.length > 0) {
    console.error("Unknown:");
    for (const name of selection.unknown) console.error(`  - ${name}`);
  }
  if (selection.ambiguous.length > 0) {
    console.error("Ambiguous:");
    for (const entry of selection.ambiguous) {
      console.error(`  - ${entry.target}: ${entry.matches.join(", ")}`);
    }
  }
  console.error(`\nAvailable contracts: ${listContractNames(contracts)}`);
  process.exit(1);
}

const contractsToBuild = selection.contracts;

for (const contract of contractsToBuild) {
  console.log(`Building ${contract.packageName}...`);
  const manifestPath = contract.manifestPath;
  const outDir = contract.wasmPath.replace(/\/[^/]+\.wasm$/, "");
  const wasmPath = join(ROOT, contract.wasmPath);
  let built = false;

  for (let attempt = 1; attempt <= 2 && !built; attempt++) {
    try {
      await $`stellar contract build --manifest-path ${manifestPath} --out-dir ${outDir} --optimize`;
      const size = statSync(wasmPath).size;
      if (size === 0) throw new Error("0 bytes");
      console.log(`✅ ${contract.packageName} built (${size} bytes)\n`);
      built = true;
    } catch (error: unknown) {
      const msg = String(error);
      const stderr = (error as { stderr?: string })?.stderr ?? "";
      const hasOptimizerError = msg.includes("Failed to read module") || stderr.includes("Failed to read module");
      if (attempt < 2 && hasOptimizerError) {
        console.warn(`⚠️  Optimizer error (attempt ${attempt}/2), retrying...`);
        await new Promise((r) => setTimeout(r, 1500));
      } else if (hasOptimizerError) {
        // Fallback: stellar build's optimizer can fail with "Failed to read module" on some setups.
        // Use cargo build (output in deps/) + stellar contract optimize instead.
        console.warn(`⚠️  Using fallback: cargo build + stellar contract optimize`);
        try {
          await $`cargo build --manifest-path ${manifestPath} --target wasm32v1-none --release`;
          const depsWasm = join(ROOT, "target", "wasm32v1-none", "release", "deps", `${contract.wasmName}.wasm`);
          if (!existsSync(depsWasm) || statSync(depsWasm).size === 0) {
            throw new Error(`cargo did not produce ${contract.wasmName}.wasm in deps/`);
          }
          await $`stellar contract optimize --wasm ${depsWasm} --wasm-out ${wasmPath}`;
          const size = statSync(wasmPath).size;
          if (size === 0) throw new Error("optimize produced 0 bytes");
          console.log(`✅ ${contract.packageName} built (${size} bytes, fallback)\n`);
          built = true;
        } catch (fallbackErr) {
          console.error(`❌ Failed to build ${contract.packageName}:`, fallbackErr);
          process.exit(1);
        }
      } else {
        console.error(`❌ Failed to build ${contract.packageName}:`, error);
        process.exit(1);
      }
    }
  }
}

console.log("🎉 Contracts built successfully!");
console.log("\nWASM files:");
for (const contract of contractsToBuild) {
  console.log(`  - ${contract.wasmPath}`);
}
