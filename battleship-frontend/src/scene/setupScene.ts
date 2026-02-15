import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRID_SIZE, TILE_SIZE } from './createGrid';

export interface SceneSetup {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
}

/**
 * Creates and configures the Three.js scene, camera, renderer, controls, and basic lighting.
 * Adds a compact ocean floor plane sized to the arena.
 * All positions derived from GRID_SIZE and TILE_SIZE -- no magic numbers.
 */
export function setupScene(container: HTMLElement): SceneSetup {
  const gridWidth = GRID_SIZE * TILE_SIZE;
  const halfGrid = (GRID_SIZE - 1) / 2;

  const scene = new THREE.Scene();
  const width = container.clientWidth;
  const height = container.clientHeight;
  const aspect = width / height;

  // Camera: above and behind the player board, looking toward the enemy wall
  const arenaCenter = new THREE.Vector3(0, gridWidth * 0.3, gridWidth * 0.45);
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
  camera.position.set(0, gridWidth * 1.4, gridWidth * 1.6);
  camera.lookAt(arenaCenter);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // OrbitControls with limits to keep the arena readable
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.copy(arenaCenter);
  controls.minDistance = gridWidth * 0.8;
  controls.maxDistance = gridWidth * 3;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.minPolarAngle = 0.2;
  controls.update();

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, 10);
  scene.add(directionalLight);

  // Fill light for the vertical enemy board (shines from +Z toward -Z)
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(0, 10, -15);
  scene.add(fillLight);

  // Ocean floor plane -- just large enough to cover the arena
  const planeSize = gridWidth + 4;
  const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize);
  const planeMaterial = new THREE.MeshStandardMaterial({
    color: 0x0e3a5f,
    metalness: 0.1,
    roughness: 0.8
  });
  const oceanFloor = new THREE.Mesh(planeGeometry, planeMaterial);
  oceanFloor.rotation.x = -Math.PI / 2;
  oceanFloor.position.set(0, 0, halfGrid);
  scene.add(oceanFloor);

  return { scene, camera, renderer, controls };
}
