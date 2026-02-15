import type { ShipCell } from './gameState';

const GRID_SIZE = 10;

/**
 * Get cells that a ship would occupy from start position and orientation.
 */
export function getShipCells(
  startRow: number,
  startCol: number,
  length: number,
  orientation: 'horizontal' | 'vertical'
): ShipCell[] {
  const cells: ShipCell[] = [];
  for (let i = 0; i < length; i++) {
    if (orientation === 'horizontal') {
      cells.push({ row: startRow, col: startCol + i });
    } else {
      cells.push({ row: startRow + i, col: startCol });
    }
  }
  return cells;
}

/**
 * Check if placement is valid: no overflow, no overlapping ships.
 */
export function canPlaceShip(
  grid: { hasShip: boolean }[][],
  startRow: number,
  startCol: number,
  length: number,
  orientation: 'horizontal' | 'vertical'
): boolean {
  const cells = getShipCells(startRow, startCol, length, orientation);

  for (const { row, col } of cells) {
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
      return false;
    }
    if (grid[row][col].hasShip) {
      return false;
    }
  }
  return true;
}

