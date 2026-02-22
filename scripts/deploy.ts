#!/usr/bin/env bun

/**
 * Deploy script for Soroban contracts to testnet
 *
 * Deploys Soroban contracts to testnet
 * Returns the deployed contract IDs
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFile, getEnvValue } from './utils/env';
import { getWorkspaceContracts, listContractNames, selectContracts } from "./utils/contracts";

type StellarKeypair = {
  publicKey(): string;
  secret(): string;
};

type StellarKeypairFactory = {
  random(): StellarKeypair;
  fromSecret(secret: string): StellarKeypair;
};

async function loadKeypairFactory(): Promise<StellarKeypairFactory> {
  try {
    const sdk = await import("@stellar/stellar-sdk");
    return sdk.Keypair;
  } catch (error) {
    console.warn("⚠️  @stellar/stellar-sdk is not installed. Running `bun install`...");
    try {
      await $`bun install`;
      const sdk = await import("@stellar/stellar-sdk");
      return sdk.Keypair;
    } catch (installError) {
      console.error("❌ Failed to load @stellar/stellar-sdk.");
      console.error("Run `bun install` in the repository root, then retry.");
      process.exit(1);
    }
  }
}

function usage() {
  console.log(`
Usage: bun run deploy [contract-name...]

Examples:
  bun run deploy
  bun run deploy number-guess
  bun run deploy twenty-one number-guess
`);
}

console.log("🚀 Deploying contracts to Stellar testnet...\n");
const Keypair = await loadKeypairFactory();

const NETWORK = 'testnet';
const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
// Required Game Hub for submissions: contracts must call start_game() and end_game() on this hub.
const EXISTING_GAME_HUB_TESTNET_CONTRACT_ID = 'CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG';
/** Deploy order: verifier stack (circom → adapter) then battleship which needs adapter + game_hub */
const DEPLOY_ORDER = ["circom-groth16-verifier", "battleship-verifier-adapter", "battleship"];
const VKEY_SOROBAN_PATH = "circuits/build/vkey_soroban.json";

async function testnetAccountExists(address: string): Promise<boolean> {
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}`, { method: 'GET' });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Horizon error ${res.status} checking ${address}`);
  return true;
}

async function ensureTestnetFunded(address: string): Promise<void> {
  if (await testnetAccountExists(address)) return;
  console.log(`💰 Funding ${address} via friendbot...`);
  const fundRes = await fetch(`https://friendbot.stellar.org?addr=${address}`, { method: 'GET' });
  if (!fundRes.ok) {
    throw new Error(`Friendbot funding failed (${fundRes.status}) for ${address}`);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    if (await testnetAccountExists(address)) return;
  }
  throw new Error(`Funded ${address} but it still doesn't appear on Horizon yet`);
}

async function testnetContractExists(contractId: string): Promise<boolean> {
  const tmpPath = join(tmpdir(), `stellar-contract-${contractId}.wasm`);
  try {
    await $`stellar -q contract fetch --id ${contractId} --network ${NETWORK} --out-file ${tmpPath}`;
    return true;
  } catch {
    return false;
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore missing temp file
    }
  }
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const allContracts = await getWorkspaceContracts();
const selection = selectContracts(allContracts, args);
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
  console.error(`\nAvailable contracts: ${listContractNames(allContracts)}`);
  process.exit(1);
}

const contracts = selection.contracts;

const BATTLESHIP_CHAIN_PACKAGES = ["battleship", "circom-groth16-verifier", "battleship-verifier-adapter"] as const;
const needsBattleshipChain = contracts.some((c) =>
  (BATTLESHIP_CHAIN_PACKAGES as readonly string[]).includes(c.packageName),
);
const standardGameContracts = contracts.filter(
  (c) => !(BATTLESHIP_CHAIN_PACKAGES as readonly string[]).includes(c.packageName),
);

const mock = allContracts.find((c) => c.isMockHub);
if (!mock && standardGameContracts.length > 0) {
  console.error("❌ Error: mock-game-hub contract not found in workspace members (required for standard games)");
  process.exit(1);
}

const needsMock = standardGameContracts.some((c) => !c.isMockHub);
const deployMockRequested = contracts.some((c) => c.isMockHub);
const shouldEnsureMock = deployMockRequested || needsMock;

// Check required WASM files exist for selected contracts (non-mock first)
const missingWasm: string[] = [];
for (const contract of contracts) {
  if (contract.isMockHub) continue;
  if (!await Bun.file(contract.wasmPath).exists()) missingWasm.push(contract.wasmPath);
}
if (missingWasm.length > 0) {
  console.error("❌ Error: Missing WASM build outputs:");
  for (const p of missingWasm) console.error(`  - ${p}`);
  console.error("\nRun 'bun run build [contract-name]' first");
  process.exit(1);
}

// Create three testnet identities: admin, player1, player2
// Admin signs deployments directly via secret key (no CLI identity required).
// Player1 and player2 are keypairs for frontend dev use.
const walletAddresses: Record<string, string> = {};
const walletSecrets: Record<string, string> = {};

// Load existing secrets from .env if available
let existingSecrets: Record<string, string | null> = {
  player1: null,
  player2: null,
};

const existingEnv = await readEnvFile('.env');
for (const identity of ['player1', 'player2']) {
  const key = `VITE_DEV_${identity.toUpperCase()}_SECRET`;
  const v = getEnvValue(existingEnv, key);
  if (v && v !== 'NOT_AVAILABLE') existingSecrets[identity] = v;
}

// Load existing deployment info so partial deploys can preserve other IDs.
const existingContractIds: Record<string, string> = {};
let existingDeployment: any = null;
if (existsSync("deployment.json")) {
  try {
    existingDeployment = await Bun.file("deployment.json").json();
    if (existingDeployment?.contracts && typeof existingDeployment.contracts === "object") {
      Object.assign(existingContractIds, existingDeployment.contracts);
    } else {
      // Backwards compatible fallback
      if (existingDeployment?.mockGameHubId) existingContractIds["mock-game-hub"] = existingDeployment.mockGameHubId;
      if (existingDeployment?.twentyOneId) existingContractIds["twenty-one"] = existingDeployment.twentyOneId;
      if (existingDeployment?.numberGuessId) existingContractIds["number-guess"] = existingDeployment.numberGuessId;
    }
  } catch (error) {
    console.warn("⚠️  Warning: Failed to parse deployment.json, continuing...");
  }
}

for (const contract of allContracts) {
  if (existingContractIds[contract.packageName]) continue;
  const envId = getEnvValue(existingEnv, `VITE_${contract.envKey}_CONTRACT_ID`);
  if (envId) existingContractIds[contract.packageName] = envId;
}

// Handle admin identity (needs to be in Stellar CLI for deployment)
console.log('Setting up admin identity...');
console.log('📝 Generating new admin identity...');
const adminKeypair = Keypair.random();

walletAddresses.admin = adminKeypair.publicKey();

try {
  await ensureTestnetFunded(walletAddresses.admin);
  console.log('✅ admin funded');
} catch (error) {
  console.error('❌ Failed to ensure admin is funded. Deployment cannot proceed.');
  process.exit(1);
}

// Handle player identities (don't need to be in CLI, just keypairs)
for (const identity of ['player1', 'player2']) {
  console.log(`Setting up ${identity}...`);

  let keypair: StellarKeypair;
  if (existingSecrets[identity]) {
    console.log(`✅ Using existing ${identity} from .env`);
    keypair = Keypair.fromSecret(existingSecrets[identity]!);
  } else {
    console.log(`📝 Generating new ${identity}...`);
    keypair = Keypair.random();
  }

  walletAddresses[identity] = keypair.publicKey();
  walletSecrets[identity] = keypair.secret();
  console.log(`✅ ${identity}: ${keypair.publicKey()}`);

  // Ensure player accounts exist on testnet (even if reusing keys from .env)
  try {
    await ensureTestnetFunded(keypair.publicKey());
    console.log(`✅ ${identity} funded\n`);
  } catch (error) {
    console.warn(`⚠️  Warning: Failed to ensure ${identity} is funded, continuing anyway...`);
  }
}

// Save to deployment.json and .env for setup script to use
console.log("🔐 Player secret keys will be saved to .env (gitignored)\n");

console.log("💼 Wallet addresses:");
console.log(`  Admin:   ${walletAddresses.admin}`);
console.log(`  Player1: ${walletAddresses.player1}`);
console.log(`  Player2: ${walletAddresses.player2}\n`);

// Use admin secret for contract deployment
const adminAddress = walletAddresses.admin;
const adminSecret = adminKeypair.secret();

const deployed: Record<string, string> = { ...existingContractIds };

// Ensure mock Game Hub exists so we can pass it into game constructors (when we have mock in workspace).
let mockGameHubId =
  existingContractIds[mock?.packageName ?? ""] ||
  existingDeployment?.mockGameHubId ||
  existingDeployment?.contracts?.["mock-game-hub"] ||
  EXISTING_GAME_HUB_TESTNET_CONTRACT_ID;

if (mock && shouldEnsureMock) {
  const candidateMockIds = [
    existingContractIds[mock.packageName],
    existingDeployment?.mockGameHubId,
    EXISTING_GAME_HUB_TESTNET_CONTRACT_ID,
  ].filter(Boolean) as string[];

  for (const candidate of candidateMockIds) {
    if (await testnetContractExists(candidate)) {
      mockGameHubId = candidate;
      break;
    }
  }

  if (mockGameHubId) {
    deployed[mock.packageName] = mockGameHubId;
    console.log(`✅ Using existing ${mock.packageName} on testnet: ${mockGameHubId}\n`);
  } else {
    if (!(await Bun.file(mock.wasmPath).exists())) {
      console.error("❌ Error: Missing WASM build output for mock-game-hub:");
      console.error(`  - ${mock.wasmPath}`);
      console.error("\nRun 'bun run build mock-game-hub' first");
      process.exit(1);
    }

    console.warn(`⚠️  ${mock.packageName} not found on testnet (archived or reset). Deploying a new one...`);
    console.log(`Deploying ${mock.packageName}...`);
    try {
      const result =
        await $`stellar contract deploy --wasm ${mock.wasmPath} --source-account ${adminSecret} --network ${NETWORK}`.text();
      mockGameHubId = result.trim();
      deployed[mock.packageName] = mockGameHubId;
      console.log(`✅ ${mock.packageName} deployed: ${mockGameHubId}\n`);
    } catch (error) {
      console.error(`❌ Failed to deploy ${mock.packageName}:`, error);
      process.exit(1);
    }
  }
}

// Deploy non-mock contracts in dependency order with correct constructor args
const orderedContracts = [...contracts]
  .filter((c) => !c.isMockHub)
  .sort((a, b) => {
    const ia = DEPLOY_ORDER.indexOf(a.packageName);
    const ib = DEPLOY_ORDER.indexOf(b.packageName);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
// Deploy Battleship verifier chain (circom-groth16-verifier → adapter → battleship) when any of them are selected.
if (needsBattleshipChain) {
  const vkeyPath = join(import.meta.dir, "..", "circuits", "build", "vkey_soroban.json");
  if (!existsSync(vkeyPath)) {
    console.error("❌ Battleship chain requires circuits verification key. Run:");
    console.error("   bun run circuits:build");
    console.error("   bun run circuits:setup-vkey -- --ptau <path-to.ptau>");
    console.error("   bun run circuits:vkey-to-soroban");
    process.exit(1);
  }
  const vkeyJson = await Bun.file(vkeyPath).json();
  const vkeyArg = JSON.stringify(vkeyJson);

  const wasmPath = (name: string) =>
    join(import.meta.dir, "..", "target", "wasm32v1-none", "release", `${name}.wasm`);

  console.log("Deploying Battleship verifier chain...\n");

  const groth16Wasm = wasmPath("circom_groth16_verifier");
  const installGroth16 = await $`stellar contract install --wasm ${groth16Wasm} --source-account ${adminSecret} --network ${NETWORK}`.text();
  const deployGroth16 = await $`stellar contract deploy --wasm-hash ${installGroth16.trim()} --source-account ${adminSecret} --network ${NETWORK} -- --vk ${vkeyArg}`.text();
  const circomGroth16VerifierId = deployGroth16.trim();
  deployed["circom-groth16-verifier"] = circomGroth16VerifierId;
  console.log(`✅ circom-groth16-verifier: ${circomGroth16VerifierId}\n`);

  const adapterWasm = wasmPath("battleship_verifier_adapter");
  const installAdapter = await $`stellar contract install --wasm ${adapterWasm} --source-account ${adminSecret} --network ${NETWORK}`.text();
  const deployAdapter = await $`stellar contract deploy --wasm-hash ${installAdapter.trim()} --source-account ${adminSecret} --network ${NETWORK} -- --admin ${adminAddress} --verifier ${circomGroth16VerifierId}`.text();
  const battleshipVerifierAdapterId = deployAdapter.trim();
  deployed["battleship-verifier-adapter"] = battleshipVerifierAdapterId;
  console.log(`✅ battleship-verifier-adapter: ${battleshipVerifierAdapterId}\n`);

  const battleshipWasm = wasmPath("battleship");
  const installBattleship = await $`stellar contract install --wasm ${battleshipWasm} --source-account ${adminSecret} --network ${NETWORK}`.text();
  const deployBattleship = await $`stellar contract deploy --wasm-hash ${installBattleship.trim()} --source-account ${adminSecret} --network ${NETWORK} -- --admin ${adminAddress} --game-hub ${mockGameHubId} --verifier ${battleshipVerifierAdapterId}`.text();
  deployed["battleship"] = deployBattleship.trim();
  console.log(`✅ battleship: ${deployed["battleship"]}\n`);
}

for (const contract of standardGameContracts) {
  if (contract.isMockHub) continue;

for (const contract of orderedContracts) {
  console.log(`Deploying ${contract.packageName}...`);
  try {
    console.log("  Installing WASM...");
    const installResult =
      await $`stellar contract install --wasm ${contract.wasmPath} --source-account ${adminSecret} --network ${NETWORK}`.text();
    const wasmHash = installResult.trim();
    console.log(`  WASM hash: ${wasmHash}`);

    let constructorArgs: string[];
    if (contract.packageName === "circom-groth16-verifier") {
      if (!existsSync(VKEY_SOROBAN_PATH)) {
        console.error(`❌ Error: ${VKEY_SOROBAN_PATH} not found. Run circuits setup first:`);
        console.error("   bun run circuits:build && bun run circuits:setup-vkey -- --ptau circuits/build/ptau.ptau && bun run circuits:vkey-to-soroban");
        process.exit(1);
      }
      constructorArgs = ["--vk-file-path", VKEY_SOROBAN_PATH];
    } else if (contract.packageName === "battleship-verifier-adapter") {
      const verifierId = deployed["circom-groth16-verifier"];
      if (!verifierId) {
        console.error("❌ Error: circom-groth16-verifier must be deployed before battleship-verifier-adapter.");
        process.exit(1);
      }
      constructorArgs = ["--admin", adminAddress, "--verifier", verifierId];
    } else if (contract.packageName === "battleship") {
      const verifierId = deployed["battleship-verifier-adapter"];
      if (!verifierId) {
        console.error("❌ Error: battleship-verifier-adapter must be deployed before battleship.");
        process.exit(1);
      }
      constructorArgs = ["--admin", adminAddress, "--game-hub", mockGameHubId, "--verifier", verifierId];
    } else {
      constructorArgs = ["--admin", adminAddress, "--game-hub", mockGameHubId];
    }

    console.log("  Deploying and initializing...");
    const deployResult =
      await $`stellar contract deploy --wasm-hash ${wasmHash} --source-account ${adminSecret} --network ${NETWORK} -- ${constructorArgs}`.text();
    const contractId = deployResult.trim();
    deployed[contract.packageName] = contractId;
    console.log(`✅ ${contract.packageName} deployed: ${contractId}\n`);
  } catch (error) {
    console.error(`❌ Failed to deploy ${contract.packageName}:`, error);
    process.exit(1);
  }
}

console.log("🎉 Deployment complete!\n");
console.log("Contract IDs:");
const outputContracts = new Set<string>();
for (const contract of contracts) outputContracts.add(contract.packageName);
if (mock && shouldEnsureMock) outputContracts.add(mock.packageName);
if (needsBattleshipChain) {
  outputContracts.add("circom-groth16-verifier");
  outputContracts.add("battleship-verifier-adapter");
  outputContracts.add("battleship");
}
for (const contract of allContracts) {
  if (!outputContracts.has(contract.packageName)) continue;
  const id = deployed[contract.packageName];
  if (id) console.log(`  ${contract.packageName}: ${id}`);
}

const twentyOneId = deployed["twenty-one"] || "";
const numberGuessId = deployed["number-guess"] || "";

const deploymentContracts = allContracts.reduce<Record<string, string>>((acc, contract) => {
  acc[contract.packageName] = deployed[contract.packageName] || "";
  return acc;
}, {});
if (deployed["circom-groth16-verifier"]) deploymentContracts["circom-groth16-verifier"] = deployed["circom-groth16-verifier"];
if (deployed["battleship-verifier-adapter"]) deploymentContracts["battleship-verifier-adapter"] = deployed["battleship-verifier-adapter"];
if (deployed["battleship"]) deploymentContracts["battleship"] = deployed["battleship"];

const deploymentInfo = {
  mockGameHubId,
  twentyOneId,
  numberGuessId,
  circomGroth16VerifierId: deployed["circom-groth16-verifier"] || "",
  battleshipVerifierAdapterId: deployed["battleship-verifier-adapter"] || "",
  contracts: deploymentContracts,
  network: NETWORK,
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  wallets: {
    admin: walletAddresses.admin,
    player1: walletAddresses.player1,
    player2: walletAddresses.player2,
  },
  deployedAt: new Date().toISOString(),
};

await Bun.write('deployment.json', JSON.stringify(deploymentInfo, null, 2) + '\n');
console.log("\n✅ Wrote deployment info to deployment.json");

const contractEnvLines = allContracts
  .map((c) => `VITE_${c.envKey}_CONTRACT_ID=${deploymentContracts[c.packageName] || ""}`)
  .join("\n");

const envContent = `# Auto-generated by deploy script
# Do not edit manually - run 'bun run deploy' (or 'bun run setup') to regenerate
# WARNING: This file contains secret keys. Never commit to git!

VITE_SOROBAN_RPC_URL=${RPC_URL}
VITE_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}
${contractEnvLines}

# Dev wallet addresses for testing
VITE_DEV_ADMIN_ADDRESS=${walletAddresses.admin}
VITE_DEV_PLAYER1_ADDRESS=${walletAddresses.player1}
VITE_DEV_PLAYER2_ADDRESS=${walletAddresses.player2}

# Dev wallet secret keys (WARNING: Never commit this file!)
VITE_DEV_PLAYER1_SECRET=${walletSecrets.player1}
VITE_DEV_PLAYER2_SECRET=${walletSecrets.player2}
`;

await Bun.write('.env', envContent + '\n');
console.log("✅ Wrote secrets to .env (gitignored)");

export { mockGameHubId, deployed };
