import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { getGLTFLoader } from './loaders';
import { SHIP_MODEL_PATHS, SHIP_MODEL_FALLBACK } from './shipModels';
import { GRID_SIZE, TILE_SIZE } from './createGrid';
import type { ShipCell } from '../game/gameState';

const GRID_Y_OFFSET = 0.1;
const CELL_OFFSET = (GRID_SIZE - 1) / 2;

const modelCache = new Map<number, THREE.Object3D>();

/**
 * Placeholder BoxGeometry when GLB fails to load.
 */
function createPlaceholderShip(
  length: number,
  orientation: 'horizontal' | 'vertical'
): THREE.Mesh {
  const width = orientation === 'horizontal' ? length * TILE_SIZE : TILE_SIZE;
  const depth = orientation === 'horizontal' ? TILE_SIZE : length * TILE_SIZE;
  const geometry = new THREE.BoxGeometry(width, 0.2, depth);
  const material = new THREE.MeshStandardMaterial({
    color: 0x16a34a,
    metalness: 0.2,
    roughness: 0.7
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Get model path for ship length. Falls back to SHIP_MODEL_FALLBACK if not in registry.
 */
function getModelPath(length: number): string {
  return SHIP_MODEL_PATHS[length] ?? SHIP_MODEL_FALLBACK;
}

/**
 * Load and cache a GLB model for the given ship length.
 */
async function loadAndCacheModel(length: number): Promise<THREE.Object3D> {
  const cached = modelCache.get(length);
  if (cached) return cached;

  const loader = getGLTFLoader();
  const path = getModelPath(length);

  let gltf: GLTF;
  try {
    gltf = await loader.loadAsync(path);
  } catch {
    if (path !== SHIP_MODEL_FALLBACK) {
      gltf = await loader.loadAsync(SHIP_MODEL_FALLBACK);
    } else {
      throw new Error(`Failed to load ship model: ${path}`);
    }
  }
  const scene = gltf.scene;

  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  scene.position.sub(center);

  const targetLength = length * TILE_SIZE;
  const modelLength = Math.max(size.x, size.z, 0.001);
  const scale = targetLength / modelLength;
  scene.scale.setScalar(scale);

  const normalizedBox = new THREE.Box3().setFromObject(scene);
  const minY = normalizedBox.min.y;
  scene.position.y = -minY + GRID_Y_OFFSET;

  scene.userData.normalizedLength = length;
  modelCache.set(length, scene);
  return scene;
}

/**
 * Creates a ship mesh (GLB or placeholder) ready to place on the grid.
 * Caches loaded models. Falls back to BoxGeometry on load failure.
 */
export async function createShipMeshFromModel(
  length: number,
  orientation: 'horizontal' | 'vertical'
): Promise<THREE.Object3D> {
  try {
    const cached = await loadAndCacheModel(length);
    const clone = cached.clone(true);
    if (orientation === 'horizontal') {
      clone.rotation.y = Math.PI / 2;
    }
    return clone;
  } catch (err) {
    console.warn(
      `[createShipMesh] Failed to load ship model for length ${length}, using placeholder:`,
      err
    );
    return createPlaceholderShip(length, orientation);
  }
}

/**
 * Positions a ship mesh on the grid given its cells and grid offset.
 */
export function positionShipMesh(
  mesh: THREE.Object3D,
  cells: ShipCell[],
  offsetX: number,
  offsetZ: number
): void {
  const minRow = Math.min(...cells.map((c) => c.row));
  const maxRow = Math.max(...cells.map((c) => c.row));
  const minCol = Math.min(...cells.map((c) => c.col));
  const maxCol = Math.max(...cells.map((c) => c.col));

  const centerRow = (minRow + maxRow) / 2;
  const centerCol = (minCol + maxCol) / 2;

  // Match grid: (0,0) bottom-left, so row 0 → position 9
  mesh.position.set(
    offsetX + centerCol - CELL_OFFSET,
    GRID_Y_OFFSET,
    offsetZ + (9 - centerRow) - CELL_OFFSET
  );
}
