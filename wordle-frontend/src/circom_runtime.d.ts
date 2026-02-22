declare module 'circom_runtime' {
  export function WitnessCalculatorBuilder(
    wasmBuffer: ArrayBuffer,
    options?: unknown
  ): Promise<{
    calculateWitness(input: Record<string, unknown>): Promise<bigint[]>;
  }>;
}
