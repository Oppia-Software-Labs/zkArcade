#!/usr/bin/env bun

/**
 * Generate TypeScript bindings for contracts
 *
 * Generates type-safe client bindings from deployed contracts
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { readEnvFile, getEnvValue } from "./utils/env";
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

function usage() {
  console.log(`
Usage: bun run bindings [contract-name...]

Examples:
  bun run bindings
  bun run bindings number-guess
  bun run bindings twenty-one number-guess
`);
}

console.log("📦 Generating TypeScript bindings...\n");

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

const contractsToBind = selection.contracts;
const contractIds: Record<string, string> = {};

if (existsSync("deployment.json")) {
  const deploymentInfo = await Bun.file("deployment.json").json();
  if (deploymentInfo?.contracts && typeof deploymentInfo.contracts === 'object') {
    Object.assign(contractIds, deploymentInfo.contracts);
  } else {
    // Backwards compatible fallback
    if (deploymentInfo?.mockGameHubId) contractIds["mock-game-hub"] = deploymentInfo.mockGameHubId;
    if (deploymentInfo?.twentyOneId) contractIds["twenty-one"] = deploymentInfo.twentyOneId;
    if (deploymentInfo?.numberGuessId) contractIds["number-guess"] = deploymentInfo.numberGuessId;
  }
} else {
  const env = await readEnvFile('.env');
  for (const contract of contracts) {
    contractIds[contract.packageName] = getEnvValue(env, `VITE_${contract.envKey}_CONTRACT_ID`);
  }
}

const missing: string[] = [];
for (const contract of contractsToBind) {
  const id = contractIds[contract.packageName];
  const useWasm = contract.packageName === "battleship" && existsSync(contract.wasmPath);
  if (!id && !useWasm) missing.push(`VITE_${contract.envKey}_CONTRACT_ID`);
}

if (missing.length > 0) {
  console.error("❌ Error: Missing contract IDs (need either deployment.json or .env):");
  for (const k of missing) console.error(`  - ${k}`);
  console.error("\nFor battleship, you can run 'bun run build battleship' first and bindings will be generated from WASM.");
  process.exit(1);
}

for (const contract of contractsToBind) {
  const contractId = contractIds[contract.packageName];
  const useWasm = contract.packageName === "battleship" && existsSync(contract.wasmPath);
  console.log(`Generating bindings for ${contract.packageName}${useWasm ? " (from WASM)" : ""}...`);
  try {
    if (useWasm) {
      await $`stellar contract bindings typescript --wasm ${contract.wasmPath} --output-dir ${contract.bindingsOutDir} --overwrite`;
    } else {
      await $`stellar contract bindings typescript --contract-id ${contractId} --output-dir ${contract.bindingsOutDir} --network testnet --overwrite`;
    }
    console.log(`✅ ${contract.packageName} bindings generated\n`);

    // Copy battleship bindings into the frontend
    if (contract.packageName === "battleship") {
      const frontendBindingsPath = "battleship-frontend/src/games/battleship/bindings.ts";
      if (existsSync("battleship-frontend")) {
        const generatedIndex = `${contract.bindingsOutDir}/src/index.ts`;
        if (existsSync(generatedIndex)) {
          let content = await Bun.file(generatedIndex).text();
          const id = contractId || "";
          if (content.includes("export const networks")) {
            if (id) content = content.replace(/contractId: "\w+"/, `contractId: "${id}"`);
          } else {
            // WASM-generated bindings don't include networks; inject after Buffer check
            const networksBlock = `\nexport const networks = {\n  testnet: {\n    networkPassphrase: "Test SDF Network ; September 2015",\n    contractId: "${id}"\n  }\n} as const;\n\n`;
            content = content.replace(/(if \(typeof window !== "undefined"\) \{[^}]+\}\n\n)/, `$1${networksBlock}`);
          }
          await Bun.write(frontendBindingsPath, content);
          console.log(`✅ Copied bindings to ${frontendBindingsPath}\n`);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Failed to generate ${contract.packageName} bindings:`, error);
    process.exit(1);
  }
}

console.log("🎉 Bindings generated successfully!");
console.log("\nGenerated files:");
for (const contract of contractsToBind) {
  console.log(`  - ${contract.bindingsOutDir}/`);
}
