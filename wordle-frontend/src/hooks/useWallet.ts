import { useCallback } from 'react';
import { useWalletStore } from '../store/walletSlice';
import { devWalletService, DevWalletService } from '../services/devWalletService';
import { NETWORK, NETWORK_PASSPHRASE } from '../utils/constants';
import type { ContractSigner } from '../types/signer';

export function useWallet() {
  const {
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,
    setWallet,
    setConnecting,
    setNetwork,
    setError,
    disconnect: storeDisconnect,
  } = useWalletStore();

  const connectDev = useCallback(
    async (playerNumber: 1 | 2) => {
      try {
        setConnecting(true);
        setError(null);
        await devWalletService.initPlayer(playerNumber);
        const address = devWalletService.getPublicKey();
        setWallet(address, `dev-player${playerNumber}`, 'dev');
        setNetwork(NETWORK, NETWORK_PASSPHRASE);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to connect dev wallet';
        setError(msg);
        console.error('Dev wallet connection error:', err);
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [setWallet, setConnecting, setNetwork, setError]
  );

  const switchPlayer = useCallback(
    async (playerNumber: 1 | 2) => {
      if (walletType !== 'dev') throw new Error('Can only switch players in dev mode');
      try {
        setConnecting(true);
        setError(null);
        await devWalletService.switchPlayer(playerNumber);
        const address = devWalletService.getPublicKey();
        setWallet(address, `dev-player${playerNumber}`, 'dev');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to switch player';
        setError(msg);
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [walletType, setWallet, setConnecting, setError]
  );

  const disconnect = useCallback(async () => {
    if (walletType === 'dev') devWalletService.disconnect();
    storeDisconnect();
  }, [walletType, storeDisconnect]);

  const getContractSigner = useCallback((): ContractSigner => {
    if (!isConnected || !publicKey || !walletType) throw new Error('Wallet not connected');
    if (walletType === 'dev') return devWalletService.getSigner();
    throw new Error('Real wallet signing not yet implemented.');
  }, [isConnected, publicKey, walletType]);

  const isDevModeAvailable = useCallback(() => DevWalletService.isDevModeAvailable(), []);
  const isDevPlayerAvailable = useCallback((n: 1 | 2) => DevWalletService.isPlayerAvailable(n), []);
  const getCurrentDevPlayer = useCallback(() => (walletType === 'dev' ? devWalletService.getCurrentPlayer() : null), [walletType]);

  return {
    publicKey,
    walletId,
    walletType,
    isConnected,
    isConnecting,
    network,
    networkPassphrase,
    error,
    connectDev,
    switchPlayer,
    disconnect,
    getContractSigner,
    isDevModeAvailable,
    isDevPlayerAvailable,
    getCurrentDevPlayer,
  };
}
