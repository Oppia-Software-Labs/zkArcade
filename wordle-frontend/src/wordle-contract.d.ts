/** Type declaration for wordle-contract alias (real module at bindings/wordle) */
declare module 'wordle-contract' {
  export class Client {
    constructor(options: {
      contractId: string;
      networkPassphrase: string;
      rpcUrl: string;
    });
  }
}

/** snarkjs has no shipped types; declare what we use. */
declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmUrl: string,
      zkeyUrl: string
    ): Promise<{ proof: unknown; publicSignals: unknown }>;
  };
}
