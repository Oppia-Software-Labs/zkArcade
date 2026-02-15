/**
 * Maps ship lengths to GLB model paths.
 * Models are served from /public, so paths are relative to site root.
 * Using boat.glb for all lengths; add per-length models to /public/models/ when available.
 */
export const SHIP_MODEL_PATHS: Record<number, string> = {
  2: '/3d-models/boat.glb',
  3: '/3d-models/boat.glb',
  4: '/3d-models/boat.glb',
  5: '/3d-models/boat.glb'
};

/** Fallback model when per-length model fails to load */
export const SHIP_MODEL_FALLBACK = '/3d-models/boat.glb';
