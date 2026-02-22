declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmUrl: string,
      zkeyUrl: string
    ): Promise<{
      proof: { pi_a: unknown[]; pi_b: unknown[][]; pi_c: unknown[] };
      publicSignals: unknown[];
    }>;
  };
}
