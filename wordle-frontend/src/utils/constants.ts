import { getRuntimeConfig } from './runtimeConfig';

const runtimeConfig = getRuntimeConfig();

export const RPC_URL =
  runtimeConfig?.rpcUrl ||
  import.meta.env.VITE_SOROBAN_RPC_URL ||
  'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE =
  runtimeConfig?.networkPassphrase ||
  import.meta.env.VITE_NETWORK_PASSPHRASE ||
  'Test SDF Network ; September 2015';
export const NETWORK = (RPC_URL?.includes('testnet') ? 'testnet' : 'mainnet') as string;

function contractEnvKey(crateName: string): string {
  const envKey = crateName.replace(/-/g, '_').toUpperCase();
  return `VITE_${envKey}_CONTRACT_ID`;
}

export function getContractId(crateName: string): string {
  const runtimeId = runtimeConfig?.contractIds?.[crateName];
  if (runtimeId) return runtimeId;
  const env = import.meta.env as unknown as Record<string, string>;
  return env[contractEnvKey(crateName)] || '';
}

export const WORDLE_CONTRACT_ID = getContractId('wordle');
export const MOCK_GAME_HUB_CONTRACT_ID = getContractId('mock-game-hub');

export const DEV_PLAYER1_ADDRESS = import.meta.env.VITE_DEV_PLAYER1_ADDRESS || '';
export const DEV_PLAYER2_ADDRESS = import.meta.env.VITE_DEV_PLAYER2_ADDRESS || '';

export const DEFAULT_METHOD_OPTIONS = { timeoutInSeconds: 30 };
export const DEFAULT_AUTH_TTL_MINUTES = 5;
export const MULTI_SIG_AUTH_TTL_MINUTES = 60;
