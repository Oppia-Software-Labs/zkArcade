import * as THREE from 'three';
import type { GridCell } from '../game/gameState';

export const GRID_SIZE = 10;
export const TILE_SIZE = 1;
const TILE_HEIGHT = 0.08;
const GAP = 0.04;
const BLUE = 0x2563eb;
const RED = 0xc41e3a;
const GRAY = 0x6b7280;
const GREEN = 0x16a34a;
const PENDING = 0xf59e0b;

/**
 * Creates a 10x10 Battleship grid of clickable tiles.
 * Uses BoxGeometry so tiles are visible 3D blocks above the ocean.
 * @param orientation - 'horizontal' = flat on XZ plane; 'vertical' = standing in YZ plane facing -X
 */
export function createGrid(
  scene: THREE.Scene,
  offsetX = 0,
  offsetZ = 0,
  orientation: 'horizontal' | 'vertical' = 'horizontal'
): GridCell[][] {
  const grid: GridCell[][] = [];
  const cellOffset = (GRID_SIZE - 1) / 2;

  for (let row = 0; row < GRID_SIZE; row++) {
    grid[row] = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      const geometry = new THREE.BoxGeometry(
        TILE_SIZE - GAP,
        TILE_HEIGHT,
        TILE_SIZE - GAP
      );
      const material = new THREE.MeshStandardMaterial({
        color: BLUE,
        metalness: 0.1,
        roughness: 0.8
      });
      const mesh = new THREE.Mesh(geometry, material);
      if (orientation === 'horizontal') {
        mesh.position.set(
          offsetX + col - cellOffset,
          TILE_HEIGHT / 2 + 0.02,
          offsetZ + row - cellOffset
        );
      } else {
        mesh.position.set(
          offsetX + col - cellOffset,
          row + 0.5,
          offsetZ
        );
        mesh.rotation.x = Math.PI / 2;
      }
      mesh.userData = { row, col };

      scene.add(mesh);
      grid[row][col] = {
        hasShip: false,
        hit: false,
        mesh
      };
    }
  }

  return grid;
}

/**
 * Update tile color.
 * @param showShip — if true, un-hit tiles with ships render green (player's own grid)
 */
export function setTileColor(
  mesh: THREE.Mesh,
  hit: boolean,
  hasShip: boolean,
  showShip = false
): void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  if (hit) {
    mat.color.setHex(hasShip ? RED : GRAY);
  } else if (showShip && hasShip) {
    mat.color.setHex(GREEN);
  } else {
    mat.color.setHex(BLUE);
  }
}

/**
 * Mark a tile as "pending shot" (amber). Used for optimistic UI on click.
 */
export function setTilePending(mesh: THREE.Mesh): void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.color.setHex(PENDING);
}
