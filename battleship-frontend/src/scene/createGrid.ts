import * as THREE from 'three';
import type { GridCell } from '../game/gameState';

export const GRID_SIZE = 10;
export const TILE_SIZE = 1;
const TILE_HEIGHT = 0.08;
const GAP = 0.04;
const BLUE = 0x2563eb;
const RED = 0xc41e3a;
const GRAY = 0x6b7280;

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
 * Update tile color for hit (red) or miss (gray).
 */
export function setTileColor(
  mesh: THREE.Mesh,
  hit: boolean,
  hasShip: boolean
): void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  if (hit) {
    mat.color.setHex(hasShip ? RED : GRAY);
  } else {
    mat.color.setHex(BLUE);
  }
}
