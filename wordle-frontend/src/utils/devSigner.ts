/**
 * Dev signer for Wordle: signs with both player keypairs so start_game (multi-sig) works in dev.
 * Use when VITE_DEV_PLAYER1_SECRET and VITE_DEV_PLAYER2_SECRET are set.
 */

import { Buffer } from 'buffer';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-sdk';
import type { WalletError } from '@stellar/stellar-sdk/contract';

export function isDevSignerAvailable(): boolean {
  const p1 = typeof import.meta.env !== 'undefined' && (import.meta.env as Record<string, string>).VITE_DEV_PLAYER1_SECRET;
  const p2 = typeof import.meta.env !== 'undefined' && (import.meta.env as Record<string, string>).VITE_DEV_PLAYER2_SECRET;
  return !!(p1 && p2 && p1 !== 'NOT_AVAILABLE' && p2 !== 'NOT_AVAILABLE');
}

function getKeypairs(): { kp1: Keypair; kp2: Keypair } | null {
  const env = typeof import.meta.env !== 'undefined' ? (import.meta.env as Record<string, string>) : {};
  const s1 = env.VITE_DEV_PLAYER1_SECRET;
  const s2 = env.VITE_DEV_PLAYER2_SECRET;
  if (!s1 || !s2 || s1 === 'NOT_AVAILABLE' || s2 === 'NOT_AVAILABLE') return null;
  try {
    return { kp1: Keypair.fromSecret(s1), kp2: Keypair.fromSecret(s2) };
  } catch {
    return null;
  }
}

/**
 * Returns signAndSend options that sign the transaction with sourceKeypair
 * and each auth entry with the keypair that matches the entry's address.
 * Use for start_game so both player1 and player2 auth entries get signed.
 * Includes publicKey so the AssembledTransaction has a valid source account.
 */
export function getDevSignerOptions(sourceAddress: string): {
  publicKey: string;
  signTransaction: (txXdr: string, opts?: { networkPassphrase?: string }) => Promise<{
    signedTxXdr?: string;
    signerAddress?: string;
    error?: WalletError;
  }>;
  signAuthEntry: (preimageXdr: string, opts?: { address?: string }) => Promise<{
    signedAuthEntry?: string;
    signerAddress?: string;
    error?: WalletError;
  }>;
} | null {
  const keypairs = getKeypairs();
  if (!keypairs) return null;

  const addr1 = keypairs.kp1.publicKey();
  const addr2 = keypairs.kp2.publicKey();
  const sourceKp = sourceAddress === addr1 ? keypairs.kp1 : sourceAddress === addr2 ? keypairs.kp2 : null;
  if (!sourceKp) return null;

  const toWalletError = (message: string): WalletError => ({ message, code: -1 });

  return {
    publicKey: sourceAddress,
    signTransaction: async (txXdr: string, opts?: { networkPassphrase?: string }) => {
      try {
        if (!opts?.networkPassphrase) throw new Error('Missing networkPassphrase');
        const transaction = TransactionBuilder.fromXDR(txXdr, opts.networkPassphrase);
        transaction.sign(sourceKp);
        return { signedTxXdr: transaction.toXDR(), signerAddress: sourceKp.publicKey() };
      } catch (e) {
        return { signerAddress: sourceKp.publicKey(), error: toWalletError(e instanceof Error ? e.message : 'Failed to sign') };
      }
    },
    signAuthEntry: async (preimageXdr: string, opts?: { address?: string }) => {
      const address = opts?.address;
      const kp = address === addr1 ? keypairs.kp1 : address === addr2 ? keypairs.kp2 : null;
      if (!kp) return { signerAddress: address, error: toWalletError('Unknown address for auth entry') };
      try {
        const preimageBytes = Buffer.from(preimageXdr, 'base64');
        const payload = hash(preimageBytes);
        const signatureBytes = kp.sign(payload);
        return { signedAuthEntry: Buffer.from(signatureBytes).toString('base64'), signerAddress: kp.publicKey() };
      } catch (e) {
        return { signerAddress: kp.publicKey(), error: toWalletError(e instanceof Error ? e.message : 'Failed to sign auth entry') };
      }
    },
  };
}
