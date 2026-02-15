import * as THREE from 'three';
import type { ShipCell } from '../game/gameState';

const GRID_SIZE = 10;
const TILE_SIZE = 1;
const CELL_OFFSET = (GRID_SIZE - 1) / 2;
const SHIP_HEIGHT = 0.2;
const SHIP_COLOR = 0x16a34a;

/**
 * Creates a ship mesh (BoxGeometry) aligned on the grid.
 * @param scene - Three.js scene to add the mesh to
 * @param cells - Array of { row, col } for each cell the ship occupies
 * @param offsetX - X offset for grid position (default 0)
 * @param offsetZ - Z offset for grid position (default 0)
 * @returns The ship mesh
 */
export function createShipMesh(
  scene: THREE.Scene,
  cells: ShipCell[],
  offsetX = 0,
  offsetZ = 0
): THREE.Mesh {
  const minRow = Math.min(...cells.map((c) => c.row));
  const maxRow = Math.max(...cells.map((c) => c.row));
  const minCol = Math.min(...cells.map((c) => c.col));
  const maxCol = Math.max(...cells.map((c) => c.col));

  const width = maxCol - minCol + 1;
  const depth = maxRow - minRow + 1;

  const geometry = new THREE.BoxGeometry(
    width * TILE_SIZE,
    SHIP_HEIGHT,
    depth * TILE_SIZE
  );
  const material = new THREE.MeshStandardMaterial({
    color: SHIP_COLOR,
    metalness: 0.2,
    roughness: 0.7
  });
  const mesh = new THREE.Mesh(geometry, material);

  const centerRow = (minRow + maxRow) / 2;
  const centerCol = (minCol + maxCol) / 2;

  mesh.position.set(
    offsetX + centerCol - CELL_OFFSET,
    SHIP_HEIGHT / 2 + 0.1,
    offsetZ + centerRow - CELL_OFFSET
  );

  scene.add(mesh);
  return mesh;
}
