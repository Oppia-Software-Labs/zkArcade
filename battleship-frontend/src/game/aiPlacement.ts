import type { ShipCell } from './gameState';
import { gameState, SHIP_LENGTHS } from './gameState';
import { canPlaceShip, getShipCells } from './placement';

/**
 * Place all AI ships randomly on the AI grid.
 */
export function placeAIShips(): void {
  const grid = gameState.aiGrid;
  const ships: typeof gameState.aiShips = [];

  for (const length of SHIP_LENGTHS) {
    let placed = false;
    for (let attempt = 0; attempt < 200 && !placed; attempt++) {
      const orientation = Math.random() < 0.5 ? 'horizontal' : 'vertical';
      const startRow = Math.floor(Math.random() * 10);
      const startCol = Math.floor(Math.random() * 10);

      if (canPlaceShip(grid, startRow, startCol, length, orientation)) {
        const cells = getShipCells(startRow, startCol, length, orientation);
        for (const cell of cells) {
          grid[cell.row][cell.col].hasShip = true;
        }
        ships.push({ cells, hits: 0 });
        placed = true;
      }
    }
  }

  gameState.aiShips = ships;
}
