/**
 * Contract signer interface for Stellar SDK bindings.
 * Compatible with dev wallets and future wallet (Freighter / passkey).
 */
import type { WalletError } from '@stellar/stellar-sdk/contract';

export interface ContractSigner {
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string }
  ) => Promise<{ signedTxXdr: string; signerAddress?: string; error?: WalletError }>;

  signAuthEntry: (
    authEntry: string,
    opts?: { networkPassphrase?: string; address?: string }
  ) => Promise<{ signedAuthEntry: string; signerAddress?: string; error?: WalletError }>;
}
