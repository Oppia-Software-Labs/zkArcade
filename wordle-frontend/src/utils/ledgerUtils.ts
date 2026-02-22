import { rpc } from '@stellar/stellar-sdk';

/**
 * Calculate a future ledger sequence number based on TTL in minutes.
 */
export async function calculateValidUntilLedger(
  rpcUrl: string,
  ttlMinutes: number
): Promise<number> {
  const server = new rpc.Server(rpcUrl);
  const latestLedger = await server.getLatestLedger();
  const LEDGERS_PER_MINUTE = 12;
  const ledgersToAdd = Math.ceil(ttlMinutes * LEDGERS_PER_MINUTE);
  return latestLedger.sequence + ledgersToAdd;
}
