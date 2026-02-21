export const GRID_SIZE = 10;

/**
 * Decode a u128 shot bitmap from the contract into a set of "x,y" coordinate strings.
 * Bit index = y * 10 + x, so each set bit maps to one cell on the 10x10 grid.
 */
export function decodeShotBitmap(bitmap: bigint | number): Set<string> {
  const shots = new Set<string>();
  const val = BigInt(bitmap);
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const bit = BigInt(1) << BigInt(y * GRID_SIZE + x);
      if (val & bit) shots.add(`${x},${y}`);
    }
  }
  return shots;
}
