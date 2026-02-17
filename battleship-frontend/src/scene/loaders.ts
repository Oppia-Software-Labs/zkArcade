import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let gltfLoaderInstance: GLTFLoader | null = null;

/**
 * Returns a configured GLTFLoader instance.
 * DRACO support can be enabled later by setting a DRACOLoader:
 *   const draco = new DRACOLoader();
 *   draco.setDecoderPath('/path/to/draco/');
 *   loader.setDRACOLoader(draco);
 */
export function getGLTFLoader(): GLTFLoader {
  if (!gltfLoaderInstance) {
    gltfLoaderInstance = new GLTFLoader();
    // DRACO support: uncomment when needed
    // import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
    // const draco = new DRACOLoader();
    // draco.setDecoderPath('/path/to/draco/');
    // gltfLoaderInstance.setDRACOLoader(draco);
  }
  return gltfLoaderInstance;
}
