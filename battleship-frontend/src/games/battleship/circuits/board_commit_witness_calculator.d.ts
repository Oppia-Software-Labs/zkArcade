declare function buildBoardCommitWitnessCalculator(
  code: ArrayBuffer,
  options?: { sanityCheck?: boolean }
): Promise<{
  calculateWitness(input: unknown, sanityCheck?: number): Promise<bigint[]>;
}>;

export default buildBoardCommitWitnessCalculator;
