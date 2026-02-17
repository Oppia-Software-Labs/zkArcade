import type * as THREE from 'three';

export type GameState =
  | 'PLACEMENT'
  | 'BATTLE'
  | 'PLAYER_TURN'
  | 'AI_TURN'
  | 'GAME_OVER';

export interface GridCell {
  hasShip: boolean;
  hit: boolean;
  mesh: THREE.Mesh;
}

export interface ShipCell {
  row: number;
  col: number;
}

export interface Ship {
  cells: ShipCell[];
  hits: number;
  mesh: THREE.Object3D;
}

export interface AiShip {
  cells: ShipCell[];
  hits: number;
}

export const SHIP_LENGTHS = [2, 3, 3, 4, 5] as const;

const INITIAL_AVAILABLE_SHIPS = [5, 4, 3, 3, 2];

export const gameState: {
  grid: GridCell[][];
  aiGrid: GridCell[][];
  state: GameState;
  ships: Ship[];
  aiShips: AiShip[];
  availableShips: number[];
  placementOrientation: 'horizontal' | 'vertical';
  winner: 'player' | 'ai' | null;
} = {
  grid: [],
  aiGrid: [],
  state: 'PLACEMENT',
  ships: [],
  aiShips: [],
  availableShips: [...INITIAL_AVAILABLE_SHIPS],
  placementOrientation: 'horizontal',
  winner: null
};

export function resetAvailableShips(): void {
  gameState.availableShips = [...INITIAL_AVAILABLE_SHIPS];
}
