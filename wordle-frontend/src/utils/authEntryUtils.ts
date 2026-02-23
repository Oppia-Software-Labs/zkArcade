/**
 * Auth entry utilities for multi-sig start_game flow.
 */

import { Buffer } from 'buffer';
import { xdr, Address, authorizeEntry } from '@stellar/stellar-sdk';
import { calculateValidUntilLedger } from './ledgerUtils';
import { DEFAULT_AUTH_TTL_MINUTES } from './constants';

export interface AssembledTxWithAuth {
  simulationData?: { result?: { auth?: xdr.SorobanAuthorizationEntry[] } };
  options?: { rpcUrl?: string; networkPassphrase?: string };
  toXDR: () => string;
}

type ClientSigner = {
  signAuthEntry?: (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => Promise<{ signedAuthEntry?: string; error?: { message: string } }>;
};

/**
 * Inject Player 1's signed auth entry into the transaction and sign Player 2's auth entry.
 */
export async function injectSignedAuthEntry(
  tx: AssembledTxWithAuth,
  player1AuthEntryXDR: string,
  player2Address: string,
  player2Signer: ClientSigner,
  validUntilLedgerSeq?: number
): Promise<AssembledTxWithAuth> {
  const player1SignedAuthEntry = xdr.SorobanAuthorizationEntry.fromXDR(player1AuthEntryXDR, 'base64');
  const player1Address = Address.fromScAddress(
    player1SignedAuthEntry.credentials().address().address()
  ).toString();

  if (!tx.simulationData?.result?.auth) {
    throw new Error('No auth entries found in transaction simulation');
  }

  const authEntries = tx.simulationData.result.auth;
  let player1StubIndex = -1;
  let player2AuthEntry: xdr.SorobanAuthorizationEntry | null = null;
  let player2Index = -1;

  for (let i = 0; i < authEntries.length; i++) {
    const entry = authEntries[i];
    if (!entry) continue;
    try {
      if (entry.credentials().switch().name === 'sorobanCredentialsAddress') {
        const entryAddress = Address.fromScAddress(
          entry.credentials().address().address()
        ).toString();
        if (entryAddress === player1Address) player1StubIndex = i;
        else if (entryAddress === player2Address) {
          player2AuthEntry = entry;
          player2Index = i;
        }
      }
    } catch {
      continue;
    }
  }

  if (player1StubIndex === -1) {
    throw new Error('Could not find Player 1 stub entry in transaction');
  }

  authEntries[player1StubIndex] = player1SignedAuthEntry;

  if (player2AuthEntry && player2Index !== -1 && player2Signer.signAuthEntry) {
    const signAuthEntry = player2Signer.signAuthEntry;
    const authValidUntilLedgerSeq =
      validUntilLedgerSeq ??
      (await calculateValidUntilLedger(
        tx.options?.rpcUrl ?? '',
        DEFAULT_AUTH_TTL_MINUTES
      ));

    const player2SignedAuthEntry = await authorizeEntry(
      player2AuthEntry,
      async (preimage) => {
        const signResult = await signAuthEntry(preimage.toXDR('base64'), {
          networkPassphrase: tx.options?.networkPassphrase,
          address: player2Address,
        });
        if (signResult?.error) {
          throw new Error(signResult.error.message);
        }
        return Buffer.from(signResult!.signedAuthEntry!, 'base64');
      },
      authValidUntilLedgerSeq,
      tx.options?.networkPassphrase ?? 'Test SDF Network ; September 2015'
    );
    authEntries[player2Index] = player2SignedAuthEntry;
  }

  tx.simulationData.result.auth = authEntries;
  return tx;
}
