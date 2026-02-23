import { contract } from '@stellar/stellar-sdk';

export async function signAndSendViaLaunchtube(
  tx: contract.AssembledTransaction<any> | string,
  _timeoutInSeconds: number = 30,
  _validUntilLedgerSeq?: number
): Promise<contract.SentTransaction<any>> {
  if (typeof tx !== 'string' && 'simulate' in tx) {
    const simulated = await tx.simulate();
    try {
      return await simulated.signAndSend();
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const isNoSignatureNeeded =
        errMessage.includes('NoSignatureNeededError') ||
        errMessage.includes('This is a read call') ||
        errMessage.includes('requires no signature') ||
        errMessage.includes('force: true');
      if (isNoSignatureNeeded) {
        try {
          return await simulated.signAndSend({ force: true });
        } catch (forceErr: unknown) {
          const forceMessage =
            forceErr instanceof Error ? forceErr.message : String(forceErr);
          if (
            forceMessage.includes('NoSignatureNeededError') ||
            forceMessage.includes('This is a read call') ||
            forceMessage.includes('requires no signature')
          ) {
            const sim = simulated as unknown as {
              result?: unknown;
              simulationResult?: { result?: unknown };
              returnValue?: unknown;
            };
            const result =
              sim.result ?? sim.simulationResult?.result ?? sim.returnValue;
            return {
              result,
              getTransactionResponse: undefined,
            } as unknown as contract.SentTransaction<any>;
          }
          throw forceErr;
        }
      }
      throw err;
    }
  }
  throw new Error('Direct XDR submission not implemented. Use AssembledTransaction.signAndSend().');
}
