import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setupScene } from '../scene/setupScene';
import { createGrid, setTileColor, GRID_SIZE, TILE_SIZE } from '../scene/createGrid';
import {
  createShipMeshFromModel,
  positionShipMesh
} from '../scene/createShipMesh';
import { gameState, resetAvailableShips } from '../game/gameState';
import { canPlaceShip, getShipCells } from '../game/placement';
import { placeAIShips } from '../game/aiPlacement';
import { config } from '../config';
import type { GridCell } from '../game/gameState';

const halfGrid = (GRID_SIZE - 1) / 2;
const playerOffsetZ = halfGrid + 0.5; // shift so back edge of row 0 aligns with vertical grid at z=0
const AI_TURN_DELAY_MS = 800;

let animationId: number | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let raycaster: THREE.Raycaster | null = null;
let mouse: THREE.Vector2 | null = null;

function getGridCellFromScreenCoords(
  clientX: number,
  clientY: number
): { row: number; col: number; grid: 'player' | 'ai' } | null {
  if (!renderer || !camera || !raycaster || !mouse) return null;

  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const playerMeshes = gameState.grid.flatMap((row) => row.map((cell) => cell.mesh));
  const aiMeshes = gameState.aiGrid.flatMap((row) => row.map((cell) => cell.mesh));
  const allMeshes = [...playerMeshes, ...aiMeshes];
  const intersects = raycaster.intersectObjects(allMeshes);

  if (intersects.length > 0) {
    const hitMesh = intersects[0].object as THREE.Mesh;
    const { row, col } = intersects[0].object.userData as { row: number; col: number };
    const grid: 'player' | 'ai' = playerMeshes.includes(hitMesh) ? 'player' : 'ai';
    return { row, col, grid };
  }
  return null;
}

function getClickedTile(
  event: MouseEvent
): { row: number; col: number; grid: 'player' | 'ai' } | null {
  return getGridCellFromScreenCoords(event.clientX, event.clientY);
}

let currentDrag: { length: number; orientation: 'horizontal' | 'vertical' } | null = null;
let ghostPreview: THREE.Object3D | null = null;

async function placeShip(
  row: number,
  col: number,
  length: number,
  orientation: 'horizontal' | 'vertical'
): Promise<void> {
  if (!scene) return;

  const idx = gameState.availableShips.indexOf(length);
  if (idx === -1) return;

  if (!canPlaceShip(gameState.grid, row, col, length, orientation)) return;

  const cells = getShipCells(row, col, length, orientation);
  const mesh = await createShipMeshFromModel(length, orientation);
  positionShipMesh(mesh, cells, 0, playerOffsetZ);
  scene.add(mesh);

  for (const cell of cells) {
    gameState.grid[cell.row][cell.col].hasShip = true;
  }

  gameState.ships.push({ cells, hits: 0, mesh });
  gameState.availableShips.splice(idx, 1);
  updateShipDock();

  if (gameState.availableShips.length === 0) {
    placeAIShips();
    gameState.state = 'PLAYER_TURN';
    console.log('Battle start! Your turn.');
    removeShipDock();
  }
}

let shipDockEl: HTMLDivElement | null = null;

function createShipDock(): void {
  if (shipDockEl) return;

  shipDockEl = document.createElement('div');
  shipDockEl.style.cssText =
    'position:absolute;top:60px;left:16px;display:flex;flex-direction:column;gap:8px;z-index:15;pointer-events:auto;';

  const title = document.createElement('div');
  title.textContent = 'Drag ships to grid';
  title.style.cssText = 'color:white;font-weight:bold;font-size:14px;margin-bottom:4px;';
  shipDockEl.appendChild(title);

  const orientBtn = document.createElement('button');
  orientBtn.textContent = 'Orientation: Horizontal';
  orientBtn.style.cssText =
    'padding:6px 12px;background:rgba(0,0,0,0.6);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:6px;font-size:12px;cursor:pointer;margin-bottom:8px;';
  orientBtn.addEventListener('click', () => {
    gameState.placementOrientation =
      gameState.placementOrientation === 'horizontal' ? 'vertical' : 'horizontal';
    orientBtn.textContent = `Orientation: ${gameState.placementOrientation === 'horizontal' ? 'Horizontal' : 'Vertical'}`;
  });
  shipDockEl.appendChild(orientBtn);

  const shipsContainer = document.createElement('div');
  shipsContainer.style.display = 'flex';
  shipsContainer.style.flexDirection = 'column';
  shipsContainer.style.gap = '6px';
  shipsContainer.id = 'ship-dock-ships';
  shipDockEl.appendChild(shipsContainer);

  const parent = renderer?.domElement.parentElement;
  if (parent) {
    if (parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
      parent.style.position = 'relative';
    }
    parent.appendChild(shipDockEl);
  }

  updateShipDock();
}

function updateShipDock(): void {
  const container = document.getElementById('ship-dock-ships');
  if (!container) return;

  container.innerHTML = '';
  for (const length of gameState.availableShips) {
    const item = document.createElement('div');
    item.draggable = true;
    item.textContent = `Ship (${length})`;
    item.style.cssText =
      'padding:8px 14px;background:rgba(34,197,94,0.8);color:white;border-radius:8px;font-size:13px;font-weight:600;cursor:grab;user-select:none;';
    item.addEventListener('dragstart', (e: DragEvent) => {
      if (!e.dataTransfer) return;
      currentDrag = { length, orientation: gameState.placementOrientation };
      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({ length, orientation: gameState.placementOrientation })
      );
      e.dataTransfer.effectAllowed = 'move';
      item.style.opacity = '0.5';
    });
    item.addEventListener('dragend', () => {
      item.style.opacity = '1';
      currentDrag = null;
      removeGhostPreview();
    });
    container.appendChild(item);
  }
}

function removeShipDock(): void {
  if (shipDockEl?.parentElement) {
    shipDockEl.parentElement.removeChild(shipDockEl);
    shipDockEl = null;
  }
}

function removeGhostPreview(): void {
  if (ghostPreview && scene) {
    scene.remove(ghostPreview);
    disposeObject3D(ghostPreview);
    ghostPreview = null;
  }
}

function updateGhostPreview(clientX: number, clientY: number): void {
  if (!currentDrag || !scene) {
    removeGhostPreview();
    return;
  }

  const hit = getGridCellFromScreenCoords(clientX, clientY);
  if (!hit || hit.grid !== 'player') {
    removeGhostPreview();
    return;
  }

  const { length, orientation } = currentDrag;
  const valid = canPlaceShip(gameState.grid, hit.row, hit.col, length, orientation);

  removeGhostPreview();

  if (!valid) return;

  const cells = getShipCells(hit.row, hit.col, length, orientation);
  const width = orientation === 'horizontal' ? length : 1;
  const depth = orientation === 'horizontal' ? 1 : length;
  const geo = new THREE.BoxGeometry(width, 0.2, depth);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x22c55e,
    transparent: true,
    opacity: 0.5
  });
  const mesh = new THREE.Mesh(geo, mat);
  positionShipMesh(mesh, cells, 0, playerOffsetZ);
  scene.add(mesh);
  ghostPreview = mesh;
}

function fireAtCell(
  grid: GridCell[][],
  ships: { cells: { row: number; col: number }[]; hits: number }[],
  row: number,
  col: number
): 'hit' | 'miss' | 'already_hit' {
  const cell = grid[row][col];
  if (cell.hit) return 'already_hit';

  cell.hit = true;
  const hasShip = cell.hasShip;

  if (hasShip) {
    const ship = ships.find((s) =>
      s.cells.some((c) => c.row === row && c.col === col)
    );
    if (ship) ship.hits += 1;
  }

  setTileColor(cell.mesh, true, hasShip);
  return hasShip ? 'hit' : 'miss';
}

function checkWinCondition(): 'player' | 'ai' | null {
  const allPlayerShipsSunk = gameState.ships.every(
    (s) => s.hits >= s.cells.length
  );
  const allAIShipsSunk = gameState.aiShips.every(
    (s) => s.hits >= s.cells.length
  );
  if (allPlayerShipsSunk) return 'ai';
  if (allAIShipsSunk) return 'player';
  return null;
}

function playerFire(row: number, col: number): void {
  if (gameState.state !== 'PLAYER_TURN') return;

  const result = fireAtCell(gameState.aiGrid, gameState.aiShips, row, col);
  if (result === 'already_hit') return;

  if (result === 'miss') {
    console.log(`Miss at (${row}, ${col})`);
  } else {
    console.log(`Hit at (${row}, ${col})!`);
  }

  const winner = checkWinCondition();
  if (winner) {
    gameState.state = 'GAME_OVER';
    gameState.winner = winner;
    console.log(winner === 'player' ? 'You win!' : 'AI wins!');
    showGameOverOverlay(winner);
    return;
  }

  gameState.state = 'AI_TURN';
  setTimeout(aiTurn, AI_TURN_DELAY_MS);
}

function aiTurn(): void {
  if (gameState.state !== 'AI_TURN') return;

  const unhitTiles: { row: number; col: number }[] = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      if (!gameState.grid[row][col].hit) {
        unhitTiles.push({ row, col });
      }
    }
  }

  if (unhitTiles.length === 0) {
    gameState.state = 'GAME_OVER';
    gameState.winner = 'player';
    console.log('You win! (AI has no moves)');
    return;
  }

  const target = unhitTiles[Math.floor(Math.random() * unhitTiles.length)];
  const result = fireAtCell(
    gameState.grid,
    gameState.ships,
    target.row,
    target.col
  );

  if (result === 'hit') {
    console.log(`AI hit your ship at (${target.row}, ${target.col})!`);
  } else {
    console.log(`AI missed at (${target.row}, ${target.col})`);
  }

  const winner = checkWinCondition();
  if (winner) {
    gameState.state = 'GAME_OVER';
    gameState.winner = winner;
    console.log(winner === 'player' ? 'You win!' : 'AI wins!');
    showGameOverOverlay(winner);
    return;
  }

  gameState.state = 'PLAYER_TURN';
}

const getZkVerifierUrl = (): string =>
  config.zkVerifierUrl || `${window.location.origin}/verifier`;

let gameOverOverlay: HTMLDivElement | null = null;

function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material?.dispose();
      }
    }
  });
}

function resetGame(): void {
  if (!scene) return;

  for (const ship of gameState.ships) {
    scene.remove(ship.mesh);
    disposeObject3D(ship.mesh);
  }

  for (const row of gameState.grid) {
    for (const cell of row) {
      cell.hasShip = false;
      cell.hit = false;
      setTileColor(cell.mesh, false, false);
    }
  }

  for (const row of gameState.aiGrid) {
    for (const cell of row) {
      cell.hasShip = false;
      cell.hit = false;
      setTileColor(cell.mesh, false, false);
    }
  }

  gameState.ships = [];
  gameState.aiShips = [];
  gameState.state = 'PLACEMENT';
  resetAvailableShips();
  gameState.placementOrientation = 'horizontal';
  gameState.winner = null;

  removeGhostPreview();
  createShipDock();

  if (gameOverOverlay?.parentElement) {
    gameOverOverlay.parentElement.removeChild(gameOverOverlay);
    gameOverOverlay = null;
  }
}

function showGameOverOverlay(winner: 'player' | 'ai'): void {
  if (!renderer?.domElement.parentElement) return;

  gameOverOverlay = document.createElement('div');
  gameOverOverlay.style.cssText =
    'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5rem;background:rgba(0,0,0,0.7);color:white;font-size:2rem;font-weight:bold;z-index:20;pointer-events:auto;';

  const title = document.createElement('div');
  title.textContent = winner === 'player' ? 'You Win!' : 'AI Wins!';
  title.style.fontSize = '2rem';
  gameOverOverlay.appendChild(title);

  const btnContainer = document.createElement('div');
  btnContainer.style.display = 'flex';
  btnContainer.style.gap = '1rem';
  btnContainer.style.flexWrap = 'wrap';
  btnContainer.style.justifyContent = 'center';

  if (winner === 'player') {
    const shareBtn = document.createElement('a');
    shareBtn.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      'I just won zkBattleship! Verify my victory'
    )}&url=${encodeURIComponent(getZkVerifierUrl())}`;
    shareBtn.target = '_blank';
    shareBtn.rel = 'noopener noreferrer';
    shareBtn.textContent = 'Share on X (Twitter)';
    shareBtn.style.cssText =
      'padding:0.75rem 1.5rem;background:#1da1f2;color:white;border-radius:8px;text-decoration:none;font-size:1rem;font-weight:600;transition:background 0.2s;cursor:pointer;';
    shareBtn.addEventListener('mouseenter', () => {
      shareBtn.style.background = '#1a8cd8';
    });
    shareBtn.addEventListener('mouseleave', () => {
      shareBtn.style.background = '#1da1f2';
    });
    btnContainer.appendChild(shareBtn);
  }

  const replayBtn = document.createElement('button');
  replayBtn.textContent = 'Replay';
  replayBtn.style.cssText =
    'padding:0.75rem 1.5rem;background:#22c55e;color:white;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:background 0.2s;';
  replayBtn.addEventListener('mouseenter', () => {
    replayBtn.style.background = '#16a34a';
  });
  replayBtn.addEventListener('mouseleave', () => {
    replayBtn.style.background = '#22c55e';
  });
  replayBtn.addEventListener('click', resetGame);
  btnContainer.appendChild(replayBtn);

  gameOverOverlay.appendChild(btnContainer);

  const parent = renderer.domElement.parentElement;
  if (parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
    parent.style.position = 'relative';
  }
  parent.appendChild(gameOverOverlay);
}

/**
 * Initialize the 3D scene, append renderer to DOM, and start animation loop.
 * @returns dispose function for cleanup
 */
export function init(container: HTMLElement): () => void {
  if (!container) return () => {};

  const setup = setupScene(container);
  scene = setup.scene;
  camera = setup.camera;
  renderer = setup.renderer;
  controls = setup.controls;

  gameState.grid = createGrid(scene, 0, playerOffsetZ);
  gameState.aiGrid = createGrid(scene, 0, 0, 'vertical');
  gameState.state = 'PLACEMENT';
  gameState.ships = [];
  gameState.aiShips = [];
  resetAvailableShips();
  gameState.placementOrientation = 'horizontal';
  gameState.winner = null;

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  container.appendChild(renderer.domElement);
  createShipDock();

  const handleClick = (event: MouseEvent): void => {
    if (gameState.state !== 'PLAYER_TURN') return;
    const tile = getClickedTile(event);
    if (!tile) return;
    if (tile.grid === 'ai') {
      playerFire(tile.row, tile.col);
    }
  };

  const handleDragOver = (event: DragEvent): void => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (currentDrag && event.clientX && event.clientY) {
      updateGhostPreview(event.clientX, event.clientY);
    }
  };

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    removeGhostPreview();
    if (!event.dataTransfer) return;

    let data: { length: number; orientation: 'horizontal' | 'vertical' };
    try {
      data = JSON.parse(event.dataTransfer.getData('application/json'));
    } catch {
      return;
    }

    const hit = getGridCellFromScreenCoords(event.clientX, event.clientY);
    if (!hit || hit.grid !== 'player') return;

    void placeShip(hit.row, hit.col, data.length, data.orientation);
  };

  const handleDragLeave = (): void => {
    removeGhostPreview();
  };

  renderer.domElement.addEventListener('click', handleClick);
  renderer.domElement.addEventListener('dragover', handleDragOver);
  renderer.domElement.addEventListener('drop', handleDrop);
  renderer.domElement.addEventListener('dragleave', handleDragLeave);

  const handleResize = (): void => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera!.aspect = width / height;
    camera!.updateProjectionMatrix();
    renderer!.setSize(width, height);
  };

  window.addEventListener('resize', handleResize);

  function animate(): void {
    animationId = requestAnimationFrame(animate);
    controls!.update();
    renderer!.render(scene!, camera!);
  }
  animate();

  return () => {
    if (renderer) {
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.domElement.removeEventListener('dragover', handleDragOver);
      renderer.domElement.removeEventListener('drop', handleDrop);
      renderer.domElement.removeEventListener('dragleave', handleDragLeave);
    }
    removeShipDock();
    dispose();
    window.removeEventListener('resize', handleResize);
  };
}

/**
 * Stop animation loop and dispose resources.
 */
export function dispose(): void {
  removeShipDock();
  removeGhostPreview();
  if (gameOverOverlay?.parentElement) {
    gameOverOverlay.parentElement.removeChild(gameOverOverlay);
    gameOverOverlay = null;
  }
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (controls) {
    controls.dispose();
    controls = null;
  }
  if (renderer) {
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = null;
  }
  scene = null;
  camera = null;
  raycaster = null;
  mouse = null;
}
