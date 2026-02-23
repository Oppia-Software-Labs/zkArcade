import { getContractId } from './utils/constants';

export const config = {
  rpcUrl: import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
  networkPassphrase:
    import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
  wordleContractId: getContractId('wordle'),
  mockGameHubId: getContractId('mock-game-hub'),
  devPlayer1Address: import.meta.env.VITE_DEV_PLAYER1_ADDRESS || '',
  devPlayer2Address: import.meta.env.VITE_DEV_PLAYER2_ADDRESS || '',
};
