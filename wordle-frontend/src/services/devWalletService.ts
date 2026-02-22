import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import type { ContractSigner } from '../types/signer';
import type { WalletError } from '@stellar/stellar-sdk/contract';

const env = typeof import.meta.env !== 'undefined' ? (import.meta.env as Record<string, string>) : {};

/**
 * Dev wallet service: uses VITE_DEV_PLAYER1_SECRET / VITE_DEV_PLAYER2_SECRET from .env (repo root).
 */
class DevWalletService {
  private currentPlayer: 1 | 2 | null = null;
  private keypairs: Record<string, Keypair> = {};

  static isDevModeAvailable(): boolean {
    return !!(env.VITE_DEV_PLAYER1_SECRET && env.VITE_DEV_PLAYER2_SECRET && env.VITE_DEV_PLAYER1_SECRET !== 'NOT_AVAILABLE' && env.VITE_DEV_PLAYER2_SECRET !== 'NOT_AVAILABLE');
  }

  static isPlayerAvailable(playerNumber: 1 | 2): boolean {
    const secret = playerNumber === 1 ? env.VITE_DEV_PLAYER1_SECRET : env.VITE_DEV_PLAYER2_SECRET;
    return !!secret && secret !== 'NOT_AVAILABLE';
  }

  async initPlayer(playerNumber: 1 | 2): Promise<void> {
    const playerKey = `player${playerNumber}`;
    const secretEnvVar = playerNumber === 1 ? env.VITE_DEV_PLAYER1_SECRET : env.VITE_DEV_PLAYER2_SECRET;
    if (!secretEnvVar || secretEnvVar === 'NOT_AVAILABLE') {
      throw new Error(`Player ${playerNumber} secret not available. Run "bun run setup" from repo root.`);
    }
    const keypair = Keypair.fromSecret(secretEnvVar);
    this.keypairs[playerKey] = keypair;
    this.currentPlayer = playerNumber;
  }

  getPublicKey(): string {
    if (!this.currentPlayer) throw new Error('No player initialized');
    const kp = this.keypairs[`player${this.currentPlayer}`];
    if (!kp) throw new Error(`Player ${this.currentPlayer} not initialized`);
    return kp.publicKey();
  }

  getCurrentPlayer(): 1 | 2 | null {
    return this.currentPlayer;
  }

  async switchPlayer(playerNumber: 1 | 2): Promise<void> {
    await this.initPlayer(playerNumber);
  }

  disconnect(): void {
    this.currentPlayer = null;
    this.keypairs = {};
  }

  getSigner(): ContractSigner {
    if (!this.currentPlayer) throw new Error('No player initialized');
    const keypair = this.keypairs[`player${this.currentPlayer}`];
    if (!keypair) throw new Error('No player initialized');
    const publicKey = keypair.publicKey();
    const toWalletError = (message: string): WalletError => ({ message, code: -1 });

    return {
      signTransaction: async (txXdr: string, opts?: { networkPassphrase?: string }) => {
        try {
          if (!opts?.networkPassphrase) throw new Error('Missing networkPassphrase');
          const transaction = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
          transaction.sign(keypair);
          return { signedTxXdr: transaction.toXDR(), signerAddress: publicKey };
        } catch (e) {
          return { signedTxXdr: txXdr, signerAddress: publicKey, error: toWalletError(e instanceof Error ? e.message : 'Failed to sign') };
        }
      },
      signAuthEntry: async (preimageXdr: string) => {
        try {
          const preimageBytes = Buffer.from(preimageXdr, 'base64');
          const payload = hash(preimageBytes);
          const signatureBytes = keypair.sign(payload);
          return { signedAuthEntry: Buffer.from(signatureBytes).toString('base64'), signerAddress: publicKey };
        } catch (e) {
          return { signedAuthEntry: preimageXdr, signerAddress: publicKey, error: toWalletError(e instanceof Error ? e.message : 'Failed to sign auth entry') };
        }
      },
    };
  }
}

export const devWalletService = new DevWalletService();
export { DevWalletService };
