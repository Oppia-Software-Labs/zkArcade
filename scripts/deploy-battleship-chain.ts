#!/usr/bin/env bun

/**
 * Deploy the Battleship verifier chain: circom-groth16-verifier → battleship-verifier-adapter → battleship.
 *
 * Prerequisites:
 * - Run `bun run circuits:build`, `bun run circuits:setup-vkey -- --ptau <path>`, `bun run circuits:vkey-to-soroban`
 * - Run `bun run build circom-groth16-verifier battleship-verifier-adapter battleship`
 * - deployment.json must exist with mockGameHubId and wallets.admin (from a prior `bun run deploy` or manual setup)
 * - .env should have VITE_DEV_PLAYER1_SECRET (or set STELLAR_ACCOUNT) for the deployer
 *
 * Usage: bun run scripts/deploy-battleship-chain.ts
 *
 * Writes circomGroth16VerifierId, battleshipVerifierAdapterId, and battleship ID to deployment.json
 * and the corresponding VITE_*_CONTRACT_ID entries to .env (merged with existing .env).
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readEnvFile, getEnvValue } from "./utils/env";

const NETWORK = "testnet";
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const ROOT = import.meta.dir + "/..";
const VKEY_SOROBAN_PATH = join(ROOT, "circuits", "build", "vkey_soroban.json");

// Required Game Hub for submissions (Stellar Testnet); battleship must call start_game/end_game on this.
const GAME_HUB_TESTNET_ID = "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";

const CONTRACTS = [
  { packageName: "circom-groth16-verifier", wasmName: "circom_groth16_verifier" },
  { packageName: "battleship-verifier-adapter", wasmName: "battleship_verifier_adapter" },
  { packageName: "battleship", wasmName: "battleship" },
] as const;

function wasmPath(name: string): string {
  return join(ROOT, "target", "wasm32v1-none", "release", `${name}.wasm`);
}

async function main() {
  if (!existsSync(VKEY_SOROBAN_PATH)) {
    console.error("❌ Missing verification key. Run:");
    console.error("   bun run circuits:build");
    console.error("   bun run circuits:setup-vkey -- --ptau <path-to.ptau>");
    console.error("   bun run circuits:vkey-to-soroban");
    console.error("   Then re-run this script.");
    process.exit(1);
  }

  const deploymentPath = join(ROOT, "deployment.json");
  if (!existsSync(deploymentPath)) {
    console.error("❌ deployment.json not found. Run 'bun run deploy' first to create it (with mock-game-hub and wallets).");
    process.exit(1);
  }

  const deployment = (await Bun.file(deploymentPath).json()) as {
    mockGameHubId?: string;
    contracts?: Record<string, string>;
    wallets?: { admin?: string; player1?: string; player2?: string };
    network?: string;
    rpcUrl?: string;
    networkPassphrase?: string;
    deployedAt?: string;
  };

  const adminAddress = deployment.wallets?.admin;
  const mockGameHubId =
    deployment.mockGameHubId ??
    deployment.contracts?.["mock-game-hub"] ??
    GAME_HUB_TESTNET_ID;
  if (!adminAddress) {
    console.error("❌ deployment.json must contain wallets.admin.");
    process.exit(1);
  }

  const existingEnv = await readEnvFile(join(ROOT, ".env"));
  const deployerSecret =
    process.env.STELLAR_ACCOUNT ??
    getEnvValue(existingEnv, "VITE_DEV_PLAYER1_SECRET") ??
    getEnvValue(existingEnv, "VITE_DEV_ADMIN_SECRET");
  if (!deployerSecret || deployerSecret === "NOT_AVAILABLE") {
    console.error("❌ Set VITE_DEV_PLAYER1_SECRET in .env (or STELLAR_ACCOUNT) to sign deployments.");
    process.exit(1);
  }

  for (const { wasmName } of CONTRACTS) {
    const path = wasmPath(wasmName);
    if (!existsSync(path)) {
      console.error(`❌ Missing WASM: ${path}. Run 'bun run build circom-groth16-verifier battleship-verifier-adapter battleship'`);
      process.exit(1);
    }
  }

  const vkeyJson = await Bun.file(VKEY_SOROBAN_PATH).json();
  const vkeyArg = JSON.stringify(vkeyJson);

  console.log("🚀 Deploying Battleship verifier chain (circom-groth16-verifier → adapter → battleship)...\n");

  // 1. Deploy circom-groth16-verifier with vk
  console.log("Deploying circom-groth16-verifier...");
  const groth16Wasm = wasmPath(CONTRACTS[0].wasmName);
  const installGroth16 = await $`stellar contract install --wasm ${groth16Wasm} --source-account ${deployerSecret} --network ${NETWORK}`.text();
  const groth16Hash = installGroth16.trim();
  const deployGroth16 = await $`stellar contract deploy --wasm-hash ${groth16Hash} --source-account ${deployerSecret} --network ${NETWORK} -- --vk ${vkeyArg}`.text();
  const circomGroth16VerifierId = deployGroth16.trim();
  console.log(`✅ circom-groth16-verifier: ${circomGroth16VerifierId}\n`);

  // 2. Deploy battleship-verifier-adapter with admin + verifier
  console.log("Deploying battleship-verifier-adapter...");
  const adapterWasm = wasmPath(CONTRACTS[1].wasmName);
  const installAdapter = await $`stellar contract install --wasm ${adapterWasm} --source-account ${deployerSecret} --network ${NETWORK}`.text();
  const adapterHash = installAdapter.trim();
  const deployAdapter = await $`stellar contract deploy --wasm-hash ${adapterHash} --source-account ${deployerSecret} --network ${NETWORK} -- --admin ${adminAddress} --verifier ${circomGroth16VerifierId}`.text();
  const battleshipVerifierAdapterId = deployAdapter.trim();
  console.log(`✅ battleship-verifier-adapter: ${battleshipVerifierAdapterId}\n`);

  // 3. Deploy battleship with admin + game_hub + verifier (adapter)
  console.log("Deploying battleship...");
  const battleshipWasm = wasmPath(CONTRACTS[2].wasmName);
  const installBattleship = await $`stellar contract install --wasm ${battleshipWasm} --source-account ${deployerSecret} --network ${NETWORK}`.text();
  const battleshipHash = installBattleship.trim();
  const deployBattleship = await $`stellar contract deploy --wasm-hash ${battleshipHash} --source-account ${deployerSecret} --network ${NETWORK} -- --admin ${adminAddress} --game-hub ${mockGameHubId} --verifier ${battleshipVerifierAdapterId}`.text();
  const battleshipId = deployBattleship.trim();
  console.log(`✅ battleship: ${battleshipId}\n`);

  // Persist to deployment.json
  const updatedContracts: Record<string, string> = {
    ...(typeof deployment.contracts === "object" ? deployment.contracts : {}),
    "circom-groth16-verifier": circomGroth16VerifierId,
    "battleship-verifier-adapter": battleshipVerifierAdapterId,
    battleship: battleshipId,
  };

  const deploymentInfo = {
    ...deployment,
    mockGameHubId: deployment.mockGameHubId ?? mockGameHubId,
    circomGroth16VerifierId,
    battleshipVerifierAdapterId,
    contracts: updatedContracts,
    deployedAt: new Date().toISOString(),
  };
  await Bun.write(deploymentPath, JSON.stringify(deploymentInfo, null, 2) + "\n");
  console.log("✅ Updated deployment.json");

  // Merge into .env: read full file, update or append the three contract ID lines
  const envPath = join(ROOT, ".env");
  let envContent = existsSync(envPath) ? await Bun.file(envPath).text() : "";
  const envUpdates: Record<string, string> = {
    VITE_CIRCOM_GROTH16_VERIFIER_CONTRACT_ID: circomGroth16VerifierId,
    VITE_BATTLESHIP_VERIFIER_ADAPTER_CONTRACT_ID: battleshipVerifierAdapterId,
    VITE_BATTLESHIP_CONTRACT_ID: battleshipId,
  };
  for (const [key, value] of Object.entries(envUpdates)) {
    const re = new RegExp(`^${key}=.*`, "m");
    if (re.test(envContent)) envContent = envContent.replace(re, `${key}=${value}`);
    else envContent = envContent.trimEnd() + (envContent ? "\n" : "") + `${key}=${value}\n`;
  }
  await Bun.write(envPath, envContent);
  console.log("✅ Updated .env with contract IDs");

  console.log("\n🎉 Battleship verifier chain deployed.");
  console.log("  circom-groth16-verifier:      ", circomGroth16VerifierId);
  console.log("  battleship-verifier-adapter:  ", battleshipVerifierAdapterId);
  console.log("  battleship:                  ", battleshipId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
