import { useState, useEffect, useRef, useMemo } from 'react';
import { BattleshipService } from './battleshipService';
import { requestCache, createCacheKey } from '@/utils/requestCache';
import { useWallet } from '@/hooks/useWallet';
import { BATTLESHIP_CONTRACT } from '@/utils/constants';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import { computeBoardCommitment, buildResolveShotInput, generateResolveShotProof, type ShipPosition } from './proofService';
import { canPlaceShip, getShipCells } from '@/game/placement';
import type { Game, GamePhase } from './bindings';
import { Buffer } from 'buffer';

/** Unwrap Option<Buffer> from contract (tag/values or raw Buffer). Returns null if None or missing. */
function unwrapOptionBuffer(opt: Game['board_commitment_p1']): Buffer | null {
  if (opt == null || opt === undefined) return null;
  if (Buffer.isBuffer(opt)) return opt;
  const o = opt as { tag?: string; values?: unknown[] };
  if (o.tag === 'Some' && Array.isArray(o.values) && o.values[0] != null && Buffer.isBuffer(o.values[0])) return o.values[0] as Buffer;
  return null;
}

/** Unwrap Option<string> from contract (tag/values or raw string). Returns null if None or missing. */
function unwrapOptionString(opt: Game['pending_shot_shooter']): string | null {
  if (opt == null || opt === undefined) return null;
  if (typeof opt === 'string') return opt;
  const o = opt as { tag?: string; values?: unknown[] };
  if (o.tag === 'Some' && Array.isArray(o.values) && o.values[0] != null && typeof o.values[0] === 'string') return o.values[0] as string;
  return null;
}

const GRID_SIZE = 10;
/** Order: Carrier, Battleship, Cruiser, Submarine, Destroyer */
const SHIP_LENGTHS = [5, 4, 3, 3, 2] as const;

const createRandomSessionId = (): number => {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    let value = 0;
    const buffer = new Uint32Array(1);
    while (value === 0) {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    }
    return value;
  }

  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
};

/**
 * Decode a u128 shot bitmap from the contract into a set of "x,y" coordinate strings.
 * Bit index = y * 10 + x, so each set bit maps to one cell on the 10x10 grid.
 */
export function decodeShotBitmap(bitmap: bigint | number): Set<string> {
  const shots = new Set<string>();
  const val = BigInt(bitmap);
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const bit = BigInt(1) << BigInt(y * GRID_SIZE + x);
      if (val & bit) shots.add(`${x},${y}`);
    }
  }
  return shots;
}

// Create service instance with the contract ID
const battleshipService = new BattleshipService(BATTLESHIP_CONTRACT);

interface BattleshipGameProps {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  initialXDR?: string | null;
  initialSessionId?: number | null;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

/** Per-player UI state cached when switching dev wallets. Key: `${sessionId}:${userAddress}` */
export interface PlayerUiState {
  placementShips: { x: number; y: number; dir: number }[];
  placementIndex: number;
  placementOrientation: 'horizontal' | 'vertical';
  mySalt: string;
  myBoardCommitment: Uint8Array | null;
  resolvedHitsOnMyBoard: Set<string>;
  myPendingShot: { x: number; y: number } | null;
  myShotsOnOpponent: Record<string, { hit: boolean; sunkShip: number }>;
  lastCommitTxHash: string | null;
}

const SESSION_STORAGE_KEY_PREFIX = 'battleship_perPlayerUi_';

interface SerializedPlayerUiState {
  placementShips: { x: number; y: number; dir: number }[];
  placementIndex: number;
  placementOrientation: 'horizontal' | 'vertical';
  mySalt: string;
  myBoardCommitment: number[] | null;
  resolvedHitsOnMyBoard: string[];
  myPendingShot: { x: number; y: number } | null;
  myShotsOnOpponent: Record<string, { hit: boolean; sunkShip: number }>;
  lastCommitTxHash: string | null;
}

function serializePerPlayerUi(map: Record<string, PlayerUiState>): Record<string, SerializedPlayerUiState> {
  const out: Record<string, SerializedPlayerUiState> = {};
  for (const [key, val] of Object.entries(map)) {
    out[key] = {
      ...val,
      myBoardCommitment: val.myBoardCommitment ? Array.from(val.myBoardCommitment) : null,
      resolvedHitsOnMyBoard: Array.from(val.resolvedHitsOnMyBoard),
    };
  }
  return out;
}

function deserializePerPlayerUi(raw: Record<string, SerializedPlayerUiState>): Record<string, PlayerUiState> {
  const out: Record<string, PlayerUiState> = {};
  for (const [key, val] of Object.entries(raw)) {
    out[key] = {
      ...val,
      myBoardCommitment: val.myBoardCommitment ? new Uint8Array(val.myBoardCommitment) : null,
      resolvedHitsOnMyBoard: new Set(val.resolvedHitsOnMyBoard),
    };
  }
  return out;
}

export function BattleshipGame({
  userAddress,
  availablePoints,
  initialXDR,
  initialSessionId,
  onStandingsRefresh,
  onGameComplete
}: BattleshipGameProps) {
  const DEFAULT_POINTS = '0.1';
  const { getContractSigner, walletType } = useWallet();
  // Use a random session ID that fits in u32 (avoid 0 because UI validation treats <=0 as invalid)
  const [sessionId, setSessionId] = useState<number>(() => createRandomSessionId());
  const [player1Address, setPlayer1Address] = useState(userAddress);
  const [player1Points, setPlayer1Points] = useState(DEFAULT_POINTS);
  const [gameState, setGameState] = useState<Game | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickstartLoading, setQuickstartLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [gamePhase, setGamePhase] = useState<'create' | 'placement' | 'battle' | 'ended'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'import' | 'load'>('create');
  const [exportedAuthEntryXDR, setExportedAuthEntryXDR] = useState<string | null>(null);
  const [importAuthEntryXDR, setImportAuthEntryXDR] = useState('');
  const [importSessionId, setImportSessionId] = useState('');
  const [importPlayer1, setImportPlayer1] = useState('');
  const [importPlayer1Points, setImportPlayer1Points] = useState('');
  const [importPlayer2Points, setImportPlayer2Points] = useState(DEFAULT_POINTS);
  const [loadSessionId, setLoadSessionId] = useState('');
  const [authEntryCopied, setAuthEntryCopied] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  const [xdrParsing, setXdrParsing] = useState(false);
  const [xdrParseError, setXdrParseError] = useState<string | null>(null);
  const [xdrParseSuccess, setXdrParseSuccess] = useState(false);
  // Placement: 5 ships { x: col, y: row, dir: 0|1 }, then commit
  const [placementShips, setPlacementShips] = useState<{ x: number; y: number; dir: number }[]>([]);
  const [placementIndex, setPlacementIndex] = useState(0);
  const [placementOrientation, setPlacementOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
  const [mySalt, setMySalt] = useState<string>('');
  const [myBoardCommitment, setMyBoardCommitment] = useState<Uint8Array | null>(null);
  /** Cells on my board that were resolved as hit (key "x,y" = col,row). Used for prior_hits and sunk check. */
  const [resolvedHitsOnMyBoard, setResolvedHitsOnMyBoard] = useState<Set<string>>(new Set());
  /** Pending shot we submitted (as shooter) so we can match last_resolved_* on poll. */
  const [myPendingShot, setMyPendingShot] = useState<{ x: number; y: number } | null>(null);
  /** My shots on opponent's board: key "x,y" -> { hit, sunkShip }. Filled from last_resolved_* when we're the shooter. */
  const [myShotsOnOpponent, setMyShotsOnOpponent] = useState<Record<string, { hit: boolean; sunkShip: number }>>({});
  /** Transaction hash from last commit_board (for View on Explorer link). */
  const [lastCommitTxHash, setLastCommitTxHash] = useState<string | null>(null);

  /** Per-player UI state cache keyed by `${sessionId}:${userAddress}` so switching players restores each board. */
  const [perPlayerUi, setPerPlayerUi] = useState<Record<string, PlayerUiState>>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY_PREFIX + 'current');
      if (raw) return deserializePerPlayerUi(JSON.parse(raw));
    } catch { /* ignore corrupt data */ }
    return {};
  });

  // Persist perPlayerUi to sessionStorage whenever it changes
  useEffect(() => {
    try {
      const keys = Object.keys(perPlayerUi);
      if (keys.length === 0) {
        sessionStorage.removeItem(SESSION_STORAGE_KEY_PREFIX + 'current');
      } else {
        sessionStorage.setItem(
          SESSION_STORAGE_KEY_PREFIX + 'current',
          JSON.stringify(serializePerPlayerUi(perPlayerUi))
        );
      }
    } catch { /* sessionStorage full or unavailable */ }
  }, [perPlayerUi]);

  // #region agent log
  useEffect(()=>{const _keys=Object.keys(perPlayerUi);const _detail=Object.fromEntries(_keys.map(k=>[k,{ships:perPlayerUi[k]?.placementShips?.length??0,commitment:!!perPlayerUi[k]?.myBoardCommitment}]));console.warn('[DBG:mount:perPlayerUi]',{keys:_keys,detail:_detail,userAddress,sessionId});fetch('http://127.0.0.1:7246/ingest/698c3a6d-203c-4b30-9d53-445256ecd091',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BattleshipGame.tsx:mount:perPlayerUi',message:'initial perPlayerUi',data:{keys:_keys,detail:_detail,userAddress,sessionId},timestamp:Date.now(),hypothesisId:'MOUNT'})}).catch(()=>{});},[]);
  // #endregion

  const prevUserAddressRef = useRef<string>(userAddress);

  const placementShipsRef = useRef(placementShips);
  const placementIndexRef = useRef(placementIndex);
  const placementOrientationRef = useRef(placementOrientation);
  const mySaltRef = useRef(mySalt);
  const myBoardCommitmentRef = useRef(myBoardCommitment);
  const resolvedHitsOnMyBoardRef = useRef(resolvedHitsOnMyBoard);
  const myPendingShotRef = useRef(myPendingShot);
  const myShotsOnOpponentRef = useRef(myShotsOnOpponent);
  const lastCommitTxHashRef = useRef(lastCommitTxHash);

  useEffect(() => { placementShipsRef.current = placementShips; }, [placementShips]);
  useEffect(() => { placementIndexRef.current = placementIndex; }, [placementIndex]);
  useEffect(() => { placementOrientationRef.current = placementOrientation; }, [placementOrientation]);
  useEffect(() => { mySaltRef.current = mySalt; }, [mySalt]);
  useEffect(() => { myBoardCommitmentRef.current = myBoardCommitment; }, [myBoardCommitment]);
  useEffect(() => { resolvedHitsOnMyBoardRef.current = resolvedHitsOnMyBoard; }, [resolvedHitsOnMyBoard]);
  useEffect(() => { myPendingShotRef.current = myPendingShot; }, [myPendingShot]);
  useEffect(() => { myShotsOnOpponentRef.current = myShotsOnOpponent; }, [myShotsOnOpponent]);
  useEffect(() => { lastCommitTxHashRef.current = lastCommitTxHash; }, [lastCommitTxHash]);

  useEffect(() => {
    setPlayer1Address(userAddress);
  }, [userAddress]);

  /** When switching player (dev wallet), save outgoing player's UI state and restore incoming player's cached state. */
  useEffect(() => {
    if (prevUserAddressRef.current === userAddress) return;

    const prevKey = `${sessionId}:${prevUserAddressRef.current}`;
    const nextKey = `${sessionId}:${userAddress}`;

    // Read cached state for the incoming player BEFORE the state update.
    // React 18 defers updater functions, so side-effects inside setPerPlayerUi
    // are not available synchronously after the call.
    const cachedForNext: PlayerUiState | undefined = perPlayerUi[nextKey];

    setPerPlayerUi((prev) => {
      // #region agent log
      const _sw={prevKey,nextKey,prevKeys:Object.keys(prev),savingShips:placementShipsRef.current.length,savingCommitment:!!myBoardCommitmentRef.current,hasNextInPrev:!!prev[nextKey],nextShips:prev[nextKey]?.placementShips?.length??0,nextCommitment:!!prev[nextKey]?.myBoardCommitment};console.warn('[DBG:walletSwitch:updater]',_sw);fetch('http://127.0.0.1:7246/ingest/698c3a6d-203c-4b30-9d53-445256ecd091',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BattleshipGame.tsx:walletSwitch:updater',message:'perPlayerUi updater',data:_sw,timestamp:Date.now(),hypothesisId:'SWITCH'})}).catch(()=>{});
      // #endregion
      return {
        ...prev,
        [prevKey]: {
          placementShips: [...placementShipsRef.current],
          placementIndex: placementIndexRef.current,
          placementOrientation: placementOrientationRef.current,
          mySalt: mySaltRef.current,
          myBoardCommitment: myBoardCommitmentRef.current ? new Uint8Array(myBoardCommitmentRef.current) : null,
          resolvedHitsOnMyBoard: new Set(resolvedHitsOnMyBoardRef.current),
          myPendingShot: myPendingShotRef.current ? { ...myPendingShotRef.current } : null,
          myShotsOnOpponent: { ...myShotsOnOpponentRef.current },
          lastCommitTxHash: lastCommitTxHashRef.current,
        },
      };
    });

    prevUserAddressRef.current = userAddress;

    // #region agent log
    const _sw2={cachedFound:!!cachedForNext,cachedShips:cachedForNext?.placementShips?.length??0,cachedCommitment:!!cachedForNext?.myBoardCommitment};console.warn('[DBG:walletSwitch:restore]',_sw2);fetch('http://127.0.0.1:7246/ingest/698c3a6d-203c-4b30-9d53-445256ecd091',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BattleshipGame.tsx:walletSwitch:restore',message:'restoring cached state',data:_sw2,timestamp:Date.now(),hypothesisId:'SWITCH'})}).catch(()=>{});
    // #endregion

    if (cachedForNext) {
      setPlacementShips(cachedForNext.placementShips);
      setPlacementIndex(cachedForNext.placementIndex);
      setPlacementOrientation(cachedForNext.placementOrientation);
      setMySalt(cachedForNext.mySalt);
      setMyBoardCommitment(cachedForNext.myBoardCommitment ? new Uint8Array(cachedForNext.myBoardCommitment) : null);
      setResolvedHitsOnMyBoard(new Set(cachedForNext.resolvedHitsOnMyBoard));
      setMyPendingShot(cachedForNext.myPendingShot ? { ...cachedForNext.myPendingShot } : null);
      setMyShotsOnOpponent({ ...cachedForNext.myShotsOnOpponent });
      setLastCommitTxHash(cachedForNext.lastCommitTxHash);
    } else {
      setPlacementShips([]);
      setPlacementIndex(0);
      setPlacementOrientation('horizontal');
      setMySalt('');
      setMyBoardCommitment(null);
      setResolvedHitsOnMyBoard(new Set());
      setMyPendingShot(null);
      setMyShotsOnOpponent({});
      setLastCommitTxHash(null);
    }
  }, [userAddress, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps -- perPlayerUi read from closure is intentional; effect must only fire on wallet/session change

  /** Restore current player's state from sessionStorage on load (e.g. after refresh) so placement/salt match what was committed. */
  const currentPlayerKey = `${sessionId}:${userAddress}`;
  useEffect(() => {
    const cached = perPlayerUi[currentPlayerKey];
    if (!cached?.placementShips?.length) return;
    if (placementShips.length === 0 && cached.placementShips.length === 5) {
      setPlacementShips(cached.placementShips);
      setPlacementIndex(cached.placementIndex);
      setPlacementOrientation(cached.placementOrientation);
      setMySalt(cached.mySalt);
      setMyBoardCommitment(cached.myBoardCommitment ? new Uint8Array(cached.myBoardCommitment) : null);
      setResolvedHitsOnMyBoard(new Set(cached.resolvedHitsOnMyBoard));
      setMyPendingShot(cached.myPendingShot ? { ...cached.myPendingShot } : null);
      setMyShotsOnOpponent({ ...cached.myShotsOnOpponent });
      setLastCommitTxHash(cached.lastCommitTxHash);
    }
  }, [currentPlayerKey, perPlayerUi, placementShips.length]);

  /** Keep current player's state in perPlayerUi (and thus sessionStorage) so it survives refresh. Only sync when we have state worth saving so we don't overwrite cached state with empty on load. */
  useEffect(() => {
    const hasState = placementShips.length > 0 || mySalt !== '' || myBoardCommitment != null;
    if (!hasState) return;
    setPerPlayerUi((prev) => ({
      ...prev,
      [currentPlayerKey]: {
        placementShips: [...placementShips],
        placementIndex,
        placementOrientation,
        mySalt,
        myBoardCommitment: myBoardCommitment ? new Uint8Array(myBoardCommitment) : null,
        resolvedHitsOnMyBoard: new Set(resolvedHitsOnMyBoard),
        myPendingShot: myPendingShot ? { ...myPendingShot } : null,
        myShotsOnOpponent: { ...myShotsOnOpponent },
        lastCommitTxHash,
      },
    }));
  }, [
    currentPlayerKey,
    placementShips,
    placementIndex,
    placementOrientation,
    mySalt,
    myBoardCommitment,
    resolvedHitsOnMyBoard,
    myPendingShot,
    myShotsOnOpponent,
    lastCommitTxHash,
  ]);

  useEffect(() => {
    if (createMode === 'import' && !importPlayer2Points.trim()) {
      setImportPlayer2Points(DEFAULT_POINTS);
    }
  }, [createMode, importPlayer2Points]);

  const POINTS_DECIMALS = 7;
  const isBusy = loading || quickstartLoading;
  const actionLock = useRef(false);
  const quickstartAvailable = walletType === 'dev'
    && DevWalletService.isDevModeAvailable()
    && DevWalletService.isPlayerAvailable(1)
    && DevWalletService.isPlayerAvailable(2);

  const runAction = async (action: () => Promise<void>) => {
    if (actionLock.current || isBusy) {
      return;
    }
    actionLock.current = true;
    try {
      await action();
    } finally {
      actionLock.current = false;
    }
  };

  /** Map contract GamePhase to UI phase */
  const phaseFromGame = (phase: GamePhase): 'placement' | 'battle' | 'ended' => {
    if (phase.tag === 'WaitingForBoards') return 'placement';
    if (phase.tag === 'InProgress') return 'battle';
    return 'ended';
  };

  const handleStartNewGame = () => {
    if (gameState?.winner) {
      onGameComplete();
    }

    actionLock.current = false;
    setGamePhase('create');
    setSessionId(createRandomSessionId());
    setGameState(null);
    setLoading(false);
    setQuickstartLoading(false);
    setError(null);
    setSuccess(null);
    setCreateMode('create');
    setExportedAuthEntryXDR(null);
    setImportAuthEntryXDR('');
    setImportSessionId('');
    setImportPlayer1('');
    setImportPlayer1Points('');
    setImportPlayer2Points(DEFAULT_POINTS);
    setLoadSessionId('');
    setAuthEntryCopied(false);
    setShareUrlCopied(false);
    setXdrParsing(false);
    setXdrParseError(null);
    setXdrParseSuccess(false);
    setPlayer1Address(userAddress);
    setPlayer1Points(DEFAULT_POINTS);
    setPerPlayerUi({});
    resetPlacementState();
  };

  const parsePoints = (value: string): bigint | null => {
    try {
      const cleaned = value.replace(/[^\d.]/g, '');
      if (!cleaned || cleaned === '.') return null;

      const [whole = '0', fraction = ''] = cleaned.split('.');
      const paddedFraction = fraction.padEnd(POINTS_DECIMALS, '0').slice(0, POINTS_DECIMALS);
      return BigInt(whole + paddedFraction);
    } catch {
      return null;
    }
  };

  const loadGameState = async () => {
    try {
      const game = await battleshipService.getGame(sessionId);
      // #region agent log
      const _ld={shooter:game?.pending_shot_shooter??null,phase:game?.phase?.tag??null,shotX:game?.pending_shot_x,shotY:game?.pending_shot_y};console.warn('[DBG:loadGameState]',_ld);fetch('http://127.0.0.1:7246/ingest/698c3a6d-203c-4b30-9d53-445256ecd091',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BattleshipGame.tsx:loadGameState',message:'polled game state',data:_ld,timestamp:Date.now(),hypothesisId:'POLL'})}).catch(()=>{});
      // #endregion
      setGameState(game);
      if (game) {
        setGamePhase(phaseFromGame(game.phase));
      }
    } catch (err) {
      setGameState(null);
    }
  };

  // Apply last_resolved_* for shooter: when we poll and our shot was resolved (no pending), update my shots on opponent
  useEffect(() => {
    if (!gameState || !userAddress) return;
    const pendingNow = gameState.pending_shot_shooter;
    const noPending = pendingNow == null || pendingNow === undefined || pendingNow === '';
    if (!noPending) return;
    const lr = gameState.last_resolved_shooter;
    const isMe = lr != null && lr !== undefined && lr !== '' && lr === userAddress;
    if (!isMe) return;
    const px = gameState.last_resolved_x;
    const py = gameState.last_resolved_y;
    const key = `${px},${py}`;
    setMyShotsOnOpponent((prev) => {
      if (prev[key] !== undefined) return prev;
      return { ...prev, [key]: { hit: gameState.last_resolved_is_hit, sunkShip: gameState.last_resolved_sunk_ship } };
    });
    if (myPendingShot && myPendingShot.x === px && myPendingShot.y === py) setMyPendingShot(null);
  }, [gameState, userAddress, myPendingShot]);

  useEffect(() => {
    if (gamePhase !== 'create') {
      loadGameState();
      const interval = setInterval(loadGameState, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [sessionId, gamePhase]);

  // Auto-refresh standings when game ends
  useEffect(() => {
    if (gamePhase === 'ended' && gameState?.winner) {
      console.log('Game completed! Refreshing standings and dashboard data...');
      onStandingsRefresh(); // Refresh standings and available points; don't call onGameComplete() here or it will close the game!
    }
  }, [gamePhase, gameState?.winner]);

  // Handle initial values from URL deep linking or props
  // Expected URL formats:
  //   - With auth entry: ?game=battleship&auth=AAAA... (Session ID, P1 address, P1 points parsed from auth entry)
  //   - With session ID: ?game=battleship&session-id=123 (Load existing game)
  // Note: GamesCatalog cleans URL params, so we prioritize props over URL
  useEffect(() => {
    // Priority 1: Check initialXDR prop (from GamesCatalog after URL cleanup)
    if (initialXDR) {
      console.log('[Deep Link] Using initialXDR prop from GamesCatalog');

      try {
        const parsed = battleshipService.parseAuthEntry(initialXDR);
        const sessionId = parsed.sessionId;

        console.log('[Deep Link] Parsed session ID from initialXDR:', sessionId);

        // Check if game already exists (both players have signed)
        battleshipService.getGame(sessionId)
          .then((game) => {
            if (game) {
              console.log('[Deep Link] Game already exists, loading directly');
              setGameState(game);
              setGamePhase(phaseFromGame(game.phase));
              setSessionId(sessionId);
            } else {
              // Game doesn't exist yet, go to import mode
              console.log('[Deep Link] Game not found, entering import mode');
              setCreateMode('import');
              setImportAuthEntryXDR(initialXDR);
              setImportSessionId(sessionId.toString());
              setImportPlayer1(parsed.player1);
              setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
              setImportPlayer2Points('0.1');
            }
          })
          .catch((err) => {
            console.error('[Deep Link] Error checking game existence:', err);
            console.error('[Deep Link] Error details:', {
              message: err?.message,
              stack: err?.stack,
              sessionId: sessionId,
            });
            // If we can't check, default to import mode
            setCreateMode('import');
            setImportAuthEntryXDR(initialXDR);
            setImportSessionId(parsed.sessionId.toString());
            setImportPlayer1(parsed.player1);
            setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
            setImportPlayer2Points('0.1');
          });
      } catch (err) {
        console.log('[Deep Link] Failed to parse initialXDR, will retry on import');
        setCreateMode('import');
        setImportAuthEntryXDR(initialXDR);
        setImportPlayer2Points('0.1');
      }
      return; // Exit early - we processed initialXDR
    }

    // Priority 2: Check URL parameters (for direct navigation without GamesCatalog)
    const urlParams = new URLSearchParams(window.location.search);
    const authEntry = urlParams.get('auth');
    const urlSessionId = urlParams.get('session-id');

    if (authEntry) {
      // Simplified URL format - only auth entry is needed
      // Session ID, Player 1 address, and points are parsed from auth entry
      console.log('[Deep Link] Auto-populating game from URL with auth entry');

      // Try to parse auth entry to get session ID
      try {
        const parsed = battleshipService.parseAuthEntry(authEntry);
        const sessionId = parsed.sessionId;

        console.log('[Deep Link] Parsed session ID from URL auth entry:', sessionId);

        // Check if game already exists (both players have signed)
        battleshipService.getGame(sessionId)
          .then((game) => {
            if (game) {
              // Game exists! Load it directly instead of going to import mode
              console.log('[Deep Link] Game already exists (URL), loading directly to guess phase');
              console.log('[Deep Link] Game data:', game);

              setGameState(game);
              setGamePhase(phaseFromGame(game.phase));
              setSessionId(sessionId);
            } else {
              console.log('[Deep Link] Game not found (URL), entering import mode');
              setCreateMode('import');
              setImportAuthEntryXDR(authEntry);
              setImportSessionId(sessionId.toString());
              setImportPlayer1(parsed.player1);
              setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
              setImportPlayer2Points('0.1');
            }
          })
          .catch((err) => {
            console.error('[Deep Link] Error checking game existence (URL):', err);
            console.error('[Deep Link] Error details:', {
              message: err?.message,
              stack: err?.stack,
              sessionId: sessionId,
            });
            // If we can't check, default to import mode
            setCreateMode('import');
            setImportAuthEntryXDR(authEntry);
            setImportSessionId(parsed.sessionId.toString());
            setImportPlayer1(parsed.player1);
            setImportPlayer1Points((Number(parsed.player1Points) / 10_000_000).toString());
            setImportPlayer2Points('0.1');
          });
      } catch (err) {
        console.log('[Deep Link] Failed to parse auth entry from URL, will retry on import');
        setCreateMode('import');
        setImportAuthEntryXDR(authEntry);
        setImportPlayer2Points('0.1');
      }
    } else if (urlSessionId) {
      // Load existing game by session ID
      console.log('[Deep Link] Auto-populating game from URL with session ID');
      setCreateMode('load');
      setLoadSessionId(urlSessionId);
    } else if (initialSessionId !== null && initialSessionId !== undefined) {
      console.log('[Deep Link] Auto-populating session ID from prop:', initialSessionId);
      setCreateMode('load');
      setLoadSessionId(initialSessionId.toString());
    }
  }, [initialXDR, initialSessionId]);

  // Auto-parse Auth Entry XDR when pasted
  useEffect(() => {
    // Only parse if in import mode and XDR is not empty
    if (createMode !== 'import' || !importAuthEntryXDR.trim()) {
      // Reset parse states when XDR is cleared
      if (!importAuthEntryXDR.trim()) {
        setXdrParsing(false);
        setXdrParseError(null);
        setXdrParseSuccess(false);
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      }
      return;
    }

    // Auto-parse the XDR
    const parseXDR = async () => {
      setXdrParsing(true);
      setXdrParseError(null);
      setXdrParseSuccess(false);

      try {
        console.log('[Auto-Parse] Parsing auth entry XDR...');
        const gameParams = battleshipService.parseAuthEntry(importAuthEntryXDR.trim());

        // Check if user is trying to import their own auth entry (self-play prevention)
        if (gameParams.player1 === userAddress) {
          throw new Error('You cannot play against yourself. This auth entry was created by you (Player 1).');
        }

        // Successfully parsed - auto-fill fields
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());
        setXdrParseSuccess(true);
        console.log('[Auto-Parse] Successfully parsed auth entry:', {
          sessionId: gameParams.sessionId,
          player1: gameParams.player1,
          player1Points: (Number(gameParams.player1Points) / 10_000_000).toString(),
        });
      } catch (err) {
        console.error('[Auto-Parse] Failed to parse auth entry:', err);
        const errorMsg = err instanceof Error ? err.message : 'Invalid auth entry XDR';
        setXdrParseError(errorMsg);
        // Clear auto-filled fields on error
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
      } finally {
        setXdrParsing(false);
      }
    };

    // Debounce parsing to avoid parsing on every keystroke
    const timeoutId = setTimeout(parseXDR, 500);
    return () => clearTimeout(timeoutId);
  }, [importAuthEntryXDR, createMode, userAddress]);

  const handlePrepareTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);

        const p1Points = parsePoints(player1Points);

        if (!p1Points || p1Points <= 0n) {
          throw new Error('Enter a valid points amount');
        }

        const signer = getContractSigner();

        // Use placeholder values for Player 2 (they'll rebuild with their own values).
        // We still need a real, funded account as the transaction source for build/simulation.
        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([player1Address, userAddress]);
        const placeholderP2Points = p1Points; // Same as P1 for simulation

        console.log('Preparing transaction for Player 1 to sign...');
        console.log('Using placeholder Player 2 values for simulation only');
        const authEntryXDR = await battleshipService.prepareStartGame(
          sessionId,
          player1Address,
          placeholderPlayer2Address,
          p1Points,
          placeholderP2Points,
          signer
        );

        console.log('Transaction prepared successfully! Player 1 has signed their auth entry.');
        setExportedAuthEntryXDR(authEntryXDR);
        setSuccess('Auth entry signed! Copy the auth entry XDR or share URL below and send it to Player 2. Waiting for them to sign...');

        // Start polling for the game to be created by Player 2
        const pollInterval = setInterval(async () => {
          try {
            // Try to load the game
            const game = await battleshipService.getGame(sessionId);
            if (game) {
              console.log('Game found! Player 2 has finalized. Transitioning to placement.');
              clearInterval(pollInterval);
              setGameState(game);
              setExportedAuthEntryXDR(null);
              setSuccess('Game created! Player 2 has signed and submitted.');
              setGamePhase(phaseFromGame(game.phase));

              // Refresh dashboard to show updated available points (locked in game)
              onStandingsRefresh();

              // Clear success message after 2 seconds
              setTimeout(() => setSuccess(null), 2000);
            } else {
              console.log('Game not found yet, continuing to poll...');
            }
          } catch (err) {
            // Game doesn't exist yet, keep polling
            console.log('Polling for game creation...', err instanceof Error ? err.message : 'checking');
          }
        }, 3000); // Poll every 3 seconds

        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          console.log('Stopped polling after 5 minutes');
        }, 300000);
      } catch (err) {
        console.error('Prepare transaction error:', err);
        // Extract detailed error message
        let errorMessage = 'Failed to prepare transaction';
        if (err instanceof Error) {
          errorMessage = err.message;

          // Check for common errors
          if (err.message.includes('insufficient')) {
            errorMessage = `Insufficient points: ${err.message}. Make sure you have enough points for this game.`;
          } else if (err.message.includes('auth')) {
            errorMessage = `Authorization failed: ${err.message}. Check your wallet connection.`;
          }
        }

        setError(errorMessage);

        // Keep the component in 'create' phase so user can see the error and retry
      } finally {
        setLoading(false);
      }
    });
  };

  const handleQuickStart = async () => {
    await runAction(async () => {
      try {
        setQuickstartLoading(true);
        setError(null);
        setSuccess(null);
        if (walletType !== 'dev') {
          throw new Error('Quickstart only works with dev wallets in the Games Library.');
        }

        if (!DevWalletService.isDevModeAvailable() || !DevWalletService.isPlayerAvailable(1) || !DevWalletService.isPlayerAvailable(2)) {
          throw new Error('Quickstart requires both dev wallets. Run "bun run setup" and connect a dev wallet.');
        }

        const p1Points = parsePoints(player1Points);
        if (!p1Points || p1Points <= 0n) {
          throw new Error('Enter a valid points amount');
        }

        const originalPlayer = devWalletService.getCurrentPlayer();
        let player1AddressQuickstart = '';
        let player2AddressQuickstart = '';
        let player1Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
        let player2Signer: ReturnType<typeof devWalletService.getSigner> | null = null;

        try {
          await devWalletService.initPlayer(1);
          player1AddressQuickstart = devWalletService.getPublicKey();
          player1Signer = devWalletService.getSigner();

          await devWalletService.initPlayer(2);
          player2AddressQuickstart = devWalletService.getPublicKey();
          player2Signer = devWalletService.getSigner();
        } finally {
          if (originalPlayer) {
            await devWalletService.initPlayer(originalPlayer);
          }
        }

        if (!player1Signer || !player2Signer) {
          throw new Error('Quickstart failed to initialize dev wallet signers.');
        }

        if (player1AddressQuickstart === player2AddressQuickstart) {
          throw new Error('Quickstart requires two different dev wallets.');
        }

        const quickstartSessionId = createRandomSessionId();
        setSessionId(quickstartSessionId);
        setPlayer1Address(player1AddressQuickstart);
        setCreateMode('create');
        setExportedAuthEntryXDR(null);
        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);
        setLoadSessionId('');

        const placeholderPlayer2Address = await getFundedSimulationSourceAddress([
          player1AddressQuickstart,
          player2AddressQuickstart,
        ]);

        const authEntryXDR = await battleshipService.prepareStartGame(
          quickstartSessionId,
          player1AddressQuickstart,
          placeholderPlayer2Address,
          p1Points,
          p1Points,
          player1Signer
        );

        const fullySignedTxXDR = await battleshipService.importAndSignAuthEntry(
          authEntryXDR,
          player2AddressQuickstart,
          p1Points,
          player2Signer
        );

        await battleshipService.finalizeStartGame(
          fullySignedTxXDR,
          player2AddressQuickstart,
          player2Signer
        );

        try {
          const game = await battleshipService.getGame(quickstartSessionId);
          setGameState(game);
          if (game) setGamePhase(phaseFromGame(game.phase));
          else setGamePhase('placement');
        } catch (err) {
          console.log('Quickstart game not available yet:', err);
          setGamePhase('placement');
        }
        onStandingsRefresh();
        setSuccess('Quickstart complete! Both players signed and the game is ready.');
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Quickstart error:', err);
        setError(err instanceof Error ? err.message : 'Quickstart failed');
      } finally {
        setQuickstartLoading(false);
      }
    });
  };

  const handleImportTransaction = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        // Validate required inputs (only auth entry and player 2 points)
        if (!importAuthEntryXDR.trim()) {
          throw new Error('Enter auth entry XDR from Player 1');
        }
        if (!importPlayer2Points.trim()) {
          throw new Error('Enter your points amount (Player 2)');
        }

        // Parse Player 2's points
        const p2Points = parsePoints(importPlayer2Points);
        if (!p2Points || p2Points <= 0n) {
          throw new Error('Invalid Player 2 points');
        }

        // Parse auth entry to extract game parameters
        // The auth entry contains: session_id, player1, player1_points
        console.log('Parsing auth entry to extract game parameters...');
        const gameParams = battleshipService.parseAuthEntry(importAuthEntryXDR.trim());

        console.log('Extracted from auth entry:', {
          sessionId: gameParams.sessionId,
          player1: gameParams.player1,
          player1Points: gameParams.player1Points.toString(),
        });

        // Auto-populate read-only fields from parsed auth entry (for display)
        setImportSessionId(gameParams.sessionId.toString());
        setImportPlayer1(gameParams.player1);
        setImportPlayer1Points((Number(gameParams.player1Points) / 10_000_000).toString());

        // Verify the user is Player 2 (prevent self-play)
        if (gameParams.player1 === userAddress) {
          throw new Error('Invalid game: You cannot play against yourself (you are Player 1 in this auth entry)');
        }

        // Additional validation: Ensure Player 2 address is different from Player 1
        // (In case user manually edits the Player 2 field)
        if (userAddress === gameParams.player1) {
          throw new Error('Cannot play against yourself. Player 2 must be different from Player 1.');
        }

        const signer = getContractSigner();

        // Step 1: Import Player 1's signed auth entry and rebuild transaction
        // New simplified API - only needs: auth entry, player 2 address, player 2 points
        console.log('Importing Player 1 auth entry and rebuilding transaction...');
        const fullySignedTxXDR = await battleshipService.importAndSignAuthEntry(
          importAuthEntryXDR.trim(),
          userAddress, // Player 2 address (current user)
          p2Points,
          signer
        );

        // Step 2: Player 2 finalizes and submits (they are the transaction source)
        console.log('Simulating and submitting transaction...');
        await battleshipService.finalizeStartGame(
          fullySignedTxXDR,
          userAddress,
          signer
        );

        // If we get here, transaction succeeded! Now update state.
        console.log('Transaction submitted successfully! Updating state...');
        setSessionId(gameParams.sessionId);
        setSuccess('Game created successfully! Both players signed.');
        setGamePhase('placement');

        // Clear import fields
        setImportAuthEntryXDR('');
        setImportSessionId('');
        setImportPlayer1('');
        setImportPlayer1Points('');
        setImportPlayer2Points(DEFAULT_POINTS);

        // Load the newly created game state
        await loadGameState();

        // Refresh dashboard to show updated available points (locked in game)
        onStandingsRefresh();

        // Clear success message after 2 seconds
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Import transaction error:', err);
        // Extract detailed error message if available
        let errorMessage = 'Failed to import and sign transaction';
        if (err instanceof Error) {
          errorMessage = err.message;

          // Check for common Soroban errors
          if (err.message.includes('simulation failed')) {
            errorMessage = `Simulation failed: ${err.message}. Check that you have enough Points and the game parameters are correct.`;
          } else if (err.message.includes('transaction failed')) {
            errorMessage = `Transaction failed: ${err.message}. The game could not be created on the blockchain.`;
          }
        }

        setError(errorMessage);

        // Keep the component in 'create' phase so user can see the error and retry
        // Don't change gamePhase or clear any fields - let the user see what went wrong
      } finally {
        setLoading(false);
      }
    });
  };

  const handleLoadExistingGame = async () => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        const parsedSessionId = parseInt(loadSessionId.trim());
        if (isNaN(parsedSessionId) || parsedSessionId <= 0) {
          throw new Error('Enter a valid session ID');
        }

        // Try to load the game (use cache to prevent duplicate calls)
        const game = await requestCache.dedupe(
          createCacheKey('game-state', parsedSessionId),
          () => battleshipService.getGame(parsedSessionId),
          5000
        );

        // Verify game exists and user is one of the players
        if (!game) {
          throw new Error('Game not found');
        }

        if (game.player1 !== userAddress && game.player2 !== userAddress) {
          throw new Error('You are not a player in this game');
        }

        setSessionId(parsedSessionId);
        setGameState(game);
        setLoadSessionId('');
        setGamePhase(phaseFromGame(game.phase));
        const isWinner = game.winner && game.winner !== null && game.winner !== undefined && game.winner === userAddress;
        setSuccess(game.phase.tag === 'Ended' && isWinner ? '🎉 You won this game!' : 'Game loaded.');

        // Clear success message after 2 seconds
        setTimeout(() => setSuccess(null), 2000);
      } catch (err) {
        console.error('Load game error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load game');
      } finally {
        setLoading(false);
      }
    });
  };

  const copyAuthEntryToClipboard = async () => {
    if (exportedAuthEntryXDR) {
      try {
        await navigator.clipboard.writeText(exportedAuthEntryXDR);
        setAuthEntryCopied(true);
        setTimeout(() => setAuthEntryCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy auth entry XDR:', err);
        setError('Failed to copy to clipboard');
      }
    }
  };

  const copyShareGameUrlWithAuthEntry = async () => {
    if (exportedAuthEntryXDR) {
      try {
        // Build URL with only Player 1's info and auth entry
        // Player 2 will specify their own points when they import
        const params = new URLSearchParams({
          'game': 'battleship',
          'auth': exportedAuthEntryXDR,
        });

        const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        await navigator.clipboard.writeText(shareUrl);
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy share URL:', err);
        setError('Failed to copy to clipboard');
      }
    }
  };

  const copyShareGameUrlWithSessionId = async () => {
    if (loadSessionId) {
      try {
        const shareUrl = `${window.location.origin}${window.location.pathname}?game=battleship&session-id=${loadSessionId}`;
        await navigator.clipboard.writeText(shareUrl);
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy share URL:', err);
        setError('Failed to copy to clipboard');
      }
    }
  };

  const isPlayer1 = gameState && gameState.player1 === userAddress;
  const isPlayer2 = gameState && gameState.player2 === userAddress;
  const isMyTurn = gameState?.turn && gameState.turn !== null && gameState.turn !== undefined && gameState.turn === userAddress;
  const hasPendingShot =
    gameState?.pending_shot_shooter != null &&
    gameState?.pending_shot_shooter !== undefined &&
    gameState?.pending_shot_shooter !== '';
  const iAmDefender = hasPendingShot && gameState?.pending_shot_shooter !== userAddress;
  const iAmShooter = hasPendingShot && gameState?.pending_shot_shooter === userAddress;

  const haveICommittedBoard = useMemo(() => {
    if (!gameState) return false;
    if (isPlayer1 && gameState.board_commitment_p1 != null && gameState.board_commitment_p1 !== undefined) return true;
    if (isPlayer2 && gameState.board_commitment_p2 != null && gameState.board_commitment_p2 !== undefined) return true;
    return false;
  }, [gameState, isPlayer1, isPlayer2]);

  const placementGrid = useMemo(() => {
    const grid: boolean[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));
    for (let i = 0; i < placementShips.length; i++) {
      const { x: col, y: row, dir } = placementShips[i];
      const orientation = dir === 1 ? 'horizontal' : 'vertical';
      const cells = getShipCells(row, col, SHIP_LENGTHS[i], orientation);
      for (const c of cells) grid[c.row][c.col] = true;
    }
    return grid;
  }, [placementShips]);

  const handlePlacementCellClick = (row: number, col: number) => {
    if (placementIndex >= 5) return;
    const length = SHIP_LENGTHS[placementIndex];
    const orientation = placementOrientation;
    const gridForCheck = placementGrid.map((r) => r.map((hasShip) => ({ hasShip })));
    if (!canPlaceShip(gridForCheck, row, col, length, orientation)) return;
    const dir = orientation === 'horizontal' ? 1 : 0;
    setPlacementShips((prev) => [...prev, { x: col, y: row, dir }]);
    setPlacementIndex((prev) => prev + 1);
  };

  const handleCommitBoard = async () => {
    if (placementShips.length !== 5) return;
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        const salt = mySalt.trim() ? BigInt(mySalt) : BigInt('0x' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join(''));
        const shipPositions: ShipPosition = {
          ship_x: placementShips.map((s) => s.x),
          ship_y: placementShips.map((s) => s.y),
          ship_dir: placementShips.map((s) => s.dir),
        };
        const commitment = await computeBoardCommitment(shipPositions, salt);
        const signer = getContractSigner();
        const { txHash } = await battleshipService.commitBoard(sessionId, userAddress, Buffer.from(commitment), signer);
        setMyBoardCommitment(commitment);
        setMySalt(salt.toString());
        setLastCommitTxHash(txHash ?? null);
        setSuccess('Board committed on-chain.');
        await loadGameState();
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        console.error('Commit board error:', err);
        setError(err instanceof Error ? err.message : 'Failed to commit board');
      } finally {
        setLoading(false);
      }
    });
  };

  const resetPlacementState = () => {
    setPlacementShips([]);
    setPlacementIndex(0);
    setPlacementOrientation('horizontal');
    setMySalt('');
    setMyBoardCommitment(null);
    setResolvedHitsOnMyBoard(new Set());
    setMyPendingShot(null);
    setMyShotsOnOpponent({});
    setLastCommitTxHash(null);
    const uiKey = `${sessionId}:${userAddress}`;
    setPerPlayerUi((prev) => {
      const next = { ...prev };
      delete next[uiKey];
      return next;
    });
  };

  /** 17 board cells in circuit layout order (Carrier, Battleship, Cruiser, Submarine, Destroyer). Each { x: col, y: row }. */
  const boardLayoutCells = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    for (let s = 0; s < 5; s++) {
      const len = SHIP_LENGTHS[s];
      const col = placementShips[s]?.x ?? 0;
      const row = placementShips[s]?.y ?? 0;
      const dir = placementShips[s]?.dir ?? 0;
      for (let k = 0; k < len; k++) {
        out.push({
          x: col + (dir === 1 ? k : 0),
          y: row + (dir === 0 ? k : 0),
        });
      }
    }
    return out.length === 17 ? out : [];
  }, [placementShips]);

  // Reconstruct resolvedHitsOnMyBoard from blockchain shot bitmap + local board layout.
  // The defender knows their own ship positions, so incoming-shot-bitmap ∩ ship-cells = hits.
  useEffect(() => {
    if (!gameState || (!isPlayer1 && !isPlayer2)) return;
    if (boardLayoutCells.length !== 17) return;

    const incomingBitmap = isPlayer1 ? gameState.shots_p2_to_p1 : gameState.shots_p1_to_p2;
    const incomingShots = decodeShotBitmap(incomingBitmap);
    if (incomingShots.size === 0) return;

    const shipCellKeys = new Set(boardLayoutCells.map(c => `${c.x},${c.y}`));
    setResolvedHitsOnMyBoard(prev => {
      const merged = new Set(prev);
      let changed = false;
      for (const key of incomingShots) {
        if (shipCellKeys.has(key) && !merged.has(key)) {
          merged.add(key);
          changed = true;
        }
      }
      return changed ? merged : prev;
    });
  }, [gameState, isPlayer1, isPlayer2, boardLayoutCells]);

  // Reconstruct myShotsOnOpponent from blockchain shot bitmap, layering cached hit/miss on top.
  // The bitmap provides the complete set of cells fired at. For cells absent from local cache
  // (e.g. lost during player switch), default to miss — this prevents double-firing and shows a
  // "shot fired" marker. Actual hit/miss data from the cache takes priority when present.
  useEffect(() => {
    if (!gameState || (!isPlayer1 && !isPlayer2)) return;

    const myBitmap = isPlayer1 ? gameState.shots_p1_to_p2 : gameState.shots_p2_to_p1;
    const allMyShots = decodeShotBitmap(myBitmap);
    if (allMyShots.size === 0) return;

    setMyShotsOnOpponent(prev => {
      let changed = false;
      const merged = { ...prev };
      for (const key of allMyShots) {
        if (merged[key] === undefined) {
          merged[key] = { hit: false, sunkShip: 0 };
          changed = true;
        }
      }
      return changed ? merged : prev;
    });
  }, [gameState, isPlayer1, isPlayer2]);

  const handleFire = async (x: number, y: number) => {
    await runAction(async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(null);
        setMyPendingShot({ x, y });
        const signer = getContractSigner();
        await battleshipService.fire(sessionId, userAddress, x, y, signer);
        setSuccess(`Shot at (${x}, ${y}) submitted. Waiting for defender to resolve.`);
        await loadGameState();
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        setMyPendingShot(null);
        console.error('Fire error:', err);
        setError(err instanceof Error ? err.message : 'Failed to fire');
      } finally {
        setLoading(false);
      }
    });
  };

  const autoResolveInProgressRef = useRef(false);

  const handleResolveShot = async () => {
    const gs = gameState;
    const ships = placementShipsRef.current;
    const salt = mySaltRef.current;
    const hits = resolvedHitsOnMyBoardRef.current;
    // #region agent log
    const _g1={hasGs:!!gs,shipsLen:ships.length,hasSalt:!!salt,boardLayoutLen:boardLayoutCells.length,autoInProgress:autoResolveInProgressRef.current};console.warn('[DBG:resolveShot:guard1]',_g1);fetch('http://127.0.0.1:7246/ingest/698c3a6d-203c-4b30-9d53-445256ecd091',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BattleshipGame.tsx:handleResolveShot:guard1',message:'handleResolveShot entered',data:_g1,timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (!gs || ships.length !== 5 || !salt || boardLayoutCells.length !== 17) return;
    if (autoResolveInProgressRef.current) return;

    autoResolveInProgressRef.current = true;
    // #region agent log
    const _pra={actionLock:actionLock.current,isBusy,loading,quickstartLoading};console.warn('[DBG:resolveShot:preRunAction]',_pra);fetch('http://127.0.0.1:7246/ingest/698c3a6d-203c-4b30-9d53-445256ecd091',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BattleshipGame.tsx:handleResolveShot:preRunAction',message:'about to call runAction',data:_pra,timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    await runAction(async () => {
      try {
        // #region agent log
        console.warn('[DBG:resolveShot:insideRunAction] callback executing');fetch('http://127.0.0.1:7246/ingest/698c3a6d-203c-4b30-9d53-445256ecd091',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BattleshipGame.tsx:handleResolveShot:insideRunAction',message:'runAction callback executing',data:{},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        setLoading(true);
        setError(null);
        setSuccess('Auto-resolving shot... generating ZK proof');

        // 1) Fetch fresh game from chain and derive shot + defender commitment (on-chain only)
        const game = await battleshipService.getGame(sessionId);
        if (!game) {
          setError('Game not found on-chain');
          return;
        }
        const shotX = game.pending_shot_x;
        const shotY = game.pending_shot_y;
        const shooter = unwrapOptionString(game.pending_shot_shooter);
        if (shooter == null || shooter === '') {
          setError('Pending shot not found on-chain');
          return;
        }
        const defenderCommitmentRaw = userAddress === game.player1 ? game.board_commitment_p1 : game.board_commitment_p2;
        const boardCommitment = unwrapOptionBuffer(defenderCommitmentRaw);
        if (!boardCommitment || boardCommitment.length !== 32) {
          setError('Board commitment not found on-chain');
          return;
        }
        setGameState(game);

        // Optional: warn if local commitment differs from on-chain
        const localCommitment = myBoardCommitmentRef.current;
        if (localCommitment && localCommitment.length === 32) {
          let same = true;
          for (let i = 0; i < 32; i++) {
            if ((boardCommitment as Uint8Array)[i] !== localCommitment[i]) { same = false; break; }
          }
          if (!same) {
            console.warn('Your stored board commitment does not match the chain; using on-chain commitment to resolve.');
          }
        }

        const hitCellIndex = boardLayoutCells.findIndex((c) => c.x === shotX && c.y === shotY);
        const isHit = hitCellIndex >= 0;
        let sunkShip = 0;
        if (isHit) {
          const shipIndex = hitCellIndex < 5 ? 0 : hitCellIndex < 9 ? 1 : hitCellIndex < 12 ? 2 : hitCellIndex < 15 ? 3 : 4;
          const shipStart = [0, 5, 9, 12, 15][shipIndex];
          const shipLen = SHIP_LENGTHS[shipIndex];
          const shipCells = boardLayoutCells.slice(shipStart, shipStart + shipLen);
          const hitsIncludingThis = new Set(hits);
          hitsIncludingThis.add(`${shotX},${shotY}`);
          const allHit = shipCells.every((c) => hitsIncludingThis.has(`${c.x},${c.y}`));
          if (allHit) sunkShip = shipIndex + 1;
        }

        const shipPositions: ShipPosition = {
          ship_x: ships.map((s) => s.x),
          ship_y: ships.map((s) => s.y),
          ship_dir: ships.map((s) => s.dir),
        };
        // ResolveShot circuit (line 37) constrains: Poseidon(ships, salt) === board_commitment_hi*2^128+lo.
        // If local (ships, salt) don't match what was committed, the circuit throws "Assert Failed".
        const recomputedCommitment = await computeBoardCommitment(shipPositions, salt || '0');
        if (recomputedCommitment.length !== 32 || boardCommitment.length !== 32) {
          setError('Board commitment length mismatch');
          return;
        }
        let commitmentMatch = true;
        for (let i = 0; i < 32; i++) {
          if (recomputedCommitment[i] !== (boardCommitment as Uint8Array)[i]) {
            commitmentMatch = false;
            break;
          }
        }
        if (!commitmentMatch) {
          setError(
            "Your saved board or salt doesn't match the on-chain commitment. Try refreshing the page so we can restore your placement from this browser's storage. If you committed from another device or cleared site data, you won't be able to resolve this game."
          );
          return;
        }

        const priorHits = boardLayoutCells.map((c) => (hits.has(`${c.x},${c.y}`) ? 1 : 0));
        const boardCommitmentBytes = new Uint8Array(boardCommitment);
        const publicInputsHash = await battleshipService.buildPublicInputsHash(
          sessionId,
          userAddress,
          shooter,
          shotX,
          shotY,
          isHit,
          sunkShip,
          boardCommitment
        );
        const witnessInput = buildResolveShotInput(
          shipPositions,
          salt || '0',
          priorHits,
          shotX,
          shotY,
          isHit ? 1 : 0,
          sunkShip,
          boardCommitmentBytes,
          new Uint8Array(publicInputsHash)
        );
        const proofPayload = await generateResolveShotProof(witnessInput);
        const signer = getContractSigner();
        const { result } = await battleshipService.resolveShot(
          sessionId,
          userAddress,
          isHit,
          sunkShip,
          Buffer.from(proofPayload),
          publicInputsHash,
          signer
        );
        if (isHit) setResolvedHitsOnMyBoard((prev) => new Set(prev).add(`${shotX},${shotY}`));
        setSuccess(result.winner != null && result.winner !== undefined && result.winner !== '' ? 'Game over!' : isHit ? (sunkShip ? `Hit! Ship sunk.` : 'Hit!') : 'Miss.');
        await loadGameState();
        if (result.winner != null && result.winner !== undefined && result.winner !== '') onStandingsRefresh();
        setTimeout(() => setSuccess(null), 3000);
      } catch (err) {
        console.error('Resolve shot error:', err);
        // #region agent log
        const _err=err instanceof Error ? err.message : String(err);console.warn('[DBG:resolveShot:catch]',_err);fetch('http://127.0.0.1:7246/ingest/698c3a6d-203c-4b30-9d53-445256ecd091',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BattleshipGame.tsx:handleResolveShot:catch',message:'error in resolve',data:{error:_err},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        setError(err instanceof Error ? err.message : 'Failed to resolve shot');
      } finally {
        setLoading(false);
        autoResolveInProgressRef.current = false;
      }
    });
  };

  // #region agent log
  console.warn('[DBG:render]',{iAmDefender,hasPendingShot,shipsLen:placementShipsRef.current.length,hasCommitment:!!myBoardCommitmentRef.current,autoInProgress:autoResolveInProgressRef.current,shooter:gameState?.pending_shot_shooter,user:userAddress,boardLayoutLen:boardLayoutCells.length,loading,actionLock:actionLock.current});
  // #endregion

  // Auto-resolve: when the defender has board data and a pending shot exists, resolve automatically
  useEffect(() => {
    // #region agent log
    const _ae={iAmDefender,hasPendingShot,shipsLen:placementShipsRef.current.length,hasCommitment:!!myBoardCommitmentRef.current,autoInProgress:autoResolveInProgressRef.current,pendingShotShooter:gameState?.pending_shot_shooter,userAddress,boardLayoutLen:boardLayoutCells.length};console.warn('[DBG:useEffect-autoResolve]',_ae);fetch('http://127.0.0.1:7246/ingest/698c3a6d-203c-4b30-9d53-445256ecd091',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'BattleshipGame.tsx:useEffect-autoResolve',message:'auto-resolve useEffect fired',data:_ae,timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (!iAmDefender || !hasPendingShot) return;
    if (placementShipsRef.current.length !== 5 || !myBoardCommitmentRef.current) return;
    if (autoResolveInProgressRef.current) return;
    handleResolveShot();
  }, [iAmDefender, hasPendingShot, gameState?.pending_shot_shooter, myBoardCommitment]);

  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-8 shadow-xl border-2 border-purple-200">
      <div className="flex items-center mb-6">
        <div>
          <h2 className="text-3xl font-black bg-gradient-to-r from-purple-600 via-pink-600 to-red-600 bg-clip-text text-transparent">
            Battleship Game 🎲
          </h2>
          <p className="text-sm text-gray-700 font-semibold mt-1">
            Place ships, commit your board, then take turns firing. ZK proofs resolve hits.
          </p>
          <p className="text-xs text-gray-500 font-mono mt-1">
            Session ID: {sessionId}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-xl">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
          <p className="text-sm font-semibold text-green-700">{success}</p>
        </div>
      )}

      {/* CREATE GAME PHASE */}
      {gamePhase === 'create' && (
        <div className="space-y-6">
          {/* Mode Toggle */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 p-2 bg-gray-100 rounded-xl">
            <button
              onClick={() => {
                setCreateMode('create');
                setExportedAuthEntryXDR(null);
                setImportAuthEntryXDR('');
                setImportSessionId('');
                setImportPlayer1('');
                setImportPlayer1Points('');
                setImportPlayer2Points(DEFAULT_POINTS);
                setLoadSessionId('');
              }}
              className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                createMode === 'create'
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Create & Export
            </button>
            <button
              onClick={() => {
                setCreateMode('import');
                setExportedAuthEntryXDR(null);
                setLoadSessionId('');
              }}
              className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                createMode === 'import'
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Import Auth Entry
            </button>
            <button
              onClick={() => {
                setCreateMode('load');
                setExportedAuthEntryXDR(null);
                setImportAuthEntryXDR('');
                setImportSessionId('');
                setImportPlayer1('');
                setImportPlayer1Points('');
                setImportPlayer2Points(DEFAULT_POINTS);
              }}
              className={`flex-1 py-3 px-4 rounded-lg font-bold text-sm transition-all ${
                createMode === 'load'
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Load Existing Game
            </button>
          </div>

          <div className="p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 rounded-xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-yellow-900">⚡ Quickstart (Dev)</p>
                <p className="text-xs font-semibold text-yellow-800">
                  Creates and signs for both dev wallets in one click. Works only in the Games Library.
                </p>
              </div>
              <button
                onClick={handleQuickStart}
                disabled={isBusy || !quickstartAvailable}
                className="px-4 py-3 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none"
              >
                {quickstartLoading ? 'Quickstarting...' : '⚡ Quickstart Game'}
              </button>
            </div>
          </div>

          {createMode === 'create' ? (
            <div className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Your Address (Player 1)
              </label>
              <input
                type="text"
                value={player1Address}
                onChange={(e) => setPlayer1Address(e.target.value.trim())}
                placeholder="G..."
                className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium text-gray-700"
              />
              <p className="text-xs font-semibold text-gray-600 mt-1">
                Pre-filled from your connected wallet. If you change it, you must be able to sign as that address.
              </p>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Your Points
              </label>
              <input
                type="text"
                value={player1Points}
                onChange={(e) => setPlayer1Points(e.target.value)}
                placeholder="0.1"
                className="w-full px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-100 text-sm font-medium"
              />
              <p className="text-xs font-semibold text-gray-600 mt-1">
                Available: {(Number(availablePoints) / 10000000).toFixed(2)} Points
              </p>
            </div>

            <div className="p-3 bg-blue-50 border-2 border-blue-200 rounded-xl">
              <p className="text-xs font-semibold text-blue-800">
                ℹ️ Player 2 will specify their own address and points when they import your auth entry. You only need to prepare and export your signature.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t-2 border-gray-100 space-y-4">
            <p className="text-xs font-semibold text-gray-600">
              Session ID: {sessionId}
            </p>

            {!exportedAuthEntryXDR ? (
              <button
                onClick={handlePrepareTransaction}
                disabled={isBusy}
                className="w-full py-4 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none"
              >
                {loading ? 'Preparing...' : 'Prepare & Export Auth Entry'}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                  <p className="text-xs font-bold uppercase tracking-wide text-green-700 mb-2">
                    Auth Entry XDR (Player 1 Signed)
                  </p>
                  <div className="bg-white p-3 rounded-lg border border-green-200 mb-3">
                    <code className="text-xs font-mono text-gray-700 break-all">
                      {exportedAuthEntryXDR}
                    </code>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      onClick={copyAuthEntryToClipboard}
                      className="py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold text-sm transition-all shadow-md hover:shadow-lg transform hover:scale-105"
                    >
                      {authEntryCopied ? '✓ Copied!' : '📋 Copy Auth Entry'}
                    </button>
                    <button
                      onClick={copyShareGameUrlWithAuthEntry}
                      className="py-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold text-sm transition-all shadow-md hover:shadow-lg transform hover:scale-105"
                    >
                      {shareUrlCopied ? '✓ Copied!' : '🔗 Share URL'}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-600 text-center font-semibold">
                  Copy the auth entry XDR or share URL with Player 2 to complete the transaction
                </p>
              </div>
            )}
          </div>
            </div>
          ) : createMode === 'import' ? (
            /* IMPORT MODE */
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-200 rounded-xl">
                <p className="text-sm font-semibold text-blue-800 mb-2">
                  📥 Import Auth Entry from Player 1
                </p>
                <p className="text-xs text-gray-700 mb-4">
                  Paste the auth entry XDR from Player 1. Session ID, Player 1 address, and their points will be auto-extracted. You only need to enter your points amount.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-2">
                      Auth Entry XDR
                      {xdrParsing && (
                        <span className="text-blue-500 text-xs animate-pulse">Parsing...</span>
                      )}
                      {xdrParseSuccess && (
                        <span className="text-green-600 text-xs">✓ Parsed successfully</span>
                      )}
                      {xdrParseError && (
                        <span className="text-red-600 text-xs">✗ Parse failed</span>
                      )}
                    </label>
                    <textarea
                      value={importAuthEntryXDR}
                      onChange={(e) => setImportAuthEntryXDR(e.target.value)}
                      placeholder="Paste Player 1's signed auth entry XDR here..."
                      rows={4}
                      className={`w-full px-4 py-3 rounded-xl bg-white border-2 focus:outline-none focus:ring-4 text-xs font-mono resize-none transition-colors ${
                        xdrParseError
                          ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
                          : xdrParseSuccess
                          ? 'border-green-300 focus:border-green-400 focus:ring-green-100'
                          : 'border-blue-200 focus:border-blue-400 focus:ring-blue-100'
                      }`}
                    />
                    {xdrParseError && (
                      <p className="text-xs text-red-600 font-semibold mt-1">
                        {xdrParseError}
                      </p>
                    )}
                  </div>
                  {/* Auto-populated fields from auth entry (read-only) */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Session ID (auto-filled)</label>
                      <input
                        type="text"
                        value={importSessionId}
                        readOnly
                        placeholder="Auto-filled from auth entry"
                        className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Player 1 Points (auto-filled)</label>
                      <input
                        type="text"
                        value={importPlayer1Points}
                        readOnly
                        placeholder="Auto-filled from auth entry"
                        className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs text-gray-600 cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Player 1 Address (auto-filled)</label>
                    <input
                      type="text"
                      value={importPlayer1}
                      readOnly
                      placeholder="Auto-filled from auth entry"
                      className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed"
                    />
                  </div>
                  {/* User inputs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 mb-1">Player 2 (You)</label>
                      <input
                        type="text"
                        value={userAddress}
                        readOnly
                        className="w-full px-4 py-2 rounded-xl bg-gray-50 border-2 border-gray-200 text-xs font-mono text-gray-600 cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Your Points *</label>
                      <input
                        type="text"
                        value={importPlayer2Points}
                        onChange={(e) => setImportPlayer2Points(e.target.value)}
                        placeholder="e.g., 0.1"
                        className="w-full px-4 py-2 rounded-xl bg-white border-2 border-blue-200 focus:outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleImportTransaction}
                disabled={isBusy || !importAuthEntryXDR.trim() || !importPlayer2Points.trim()}
                className="w-full py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500 hover:from-blue-600 hover:via-cyan-600 hover:to-teal-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
              >
                {loading ? 'Importing & Signing...' : 'Import & Sign Auth Entry'}
              </button>
            </div>
          ) : createMode === 'load' ? (
            /* LOAD EXISTING GAME MODE */
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl">
                <p className="text-sm font-semibold text-green-800 mb-2">
                  🎮 Load Existing Game by Session ID
                </p>
                <p className="text-xs text-gray-700 mb-4">
                  Enter a session ID to load and continue an existing game. You must be one of the players.
                </p>
                <input
                  type="text"
                  value={loadSessionId}
                  onChange={(e) => setLoadSessionId(e.target.value)}
                  placeholder="Enter session ID (e.g., 123456789)"
                  className="w-full px-4 py-3 rounded-xl bg-white border-2 border-green-200 focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-100 text-sm font-mono"
                />
              </div>

              <div className="p-4 bg-gradient-to-br from-yellow-50 to-amber-50 border-2 border-yellow-200 rounded-xl">
                <p className="text-xs font-bold text-yellow-800 mb-2">
                  Requirements
                </p>
                <ul className="text-xs text-gray-700 space-y-1 list-disc list-inside">
                  <li>You must be Player 1 or Player 2 in the game</li>
                  <li>Game must be active (not completed)</li>
                  <li>Valid session ID from an existing game</li>
                </ul>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleLoadExistingGame}
                  disabled={isBusy || !loadSessionId.trim()}
                  className="py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 hover:from-green-600 hover:via-emerald-600 hover:to-teal-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
                >
                  {loading ? 'Loading...' : '🎮 Load Game'}
                </button>
                <button
                  onClick={copyShareGameUrlWithSessionId}
                  disabled={!loadSessionId.trim()}
                  className="py-4 rounded-xl font-bold text-white text-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 disabled:from-gray-200 disabled:to-gray-300 disabled:text-gray-500 transition-all shadow-xl hover:shadow-2xl transform hover:scale-105 disabled:transform-none"
                >
                  {shareUrlCopied ? '✓ Copied!' : '🔗 Share Game'}
                </button>
              </div>
              <p className="text-xs text-gray-600 text-center font-semibold">
                Load the game to continue playing, or share the URL with another player
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* PLACEMENT PHASE — place ships then commit via proof service */}
      {gamePhase === 'placement' && gameState && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`p-5 rounded-xl border-2 ${isPlayer1 ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-600 mb-1">Player 1</div>
              <div className="font-mono text-sm text-gray-800">{gameState.player1.slice(0, 8)}...{gameState.player1.slice(-4)}</div>
              <div className="mt-2 text-xs text-gray-600">
                Board: {gameState.board_commitment_p1 != null && gameState.board_commitment_p1 !== undefined ? '✓ Committed' : 'Waiting...'}
              </div>
            </div>
            <div className={`p-5 rounded-xl border-2 ${isPlayer2 ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-600 mb-1">Player 2</div>
              <div className="font-mono text-sm text-gray-800">{gameState.player2.slice(0, 8)}...{gameState.player2.slice(-4)}</div>
              <div className="mt-2 text-xs text-gray-600">
                Board: {gameState.board_commitment_p2 != null && gameState.board_commitment_p2 !== undefined ? '✓ Committed' : 'Waiting...'}
              </div>
            </div>
          </div>

          {(isPlayer1 || isPlayer2) && !haveICommittedBoard && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-gray-700">
                Place your 5 ships (click a cell to set the bow). Order: Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2).
              </p>
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-gray-600">Orientation:</span>
                <button
                  type="button"
                  onClick={() => setPlacementOrientation((o) => (o === 'horizontal' ? 'vertical' : 'horizontal'))}
                  className="px-3 py-1.5 rounded-lg border-2 border-purple-300 bg-white font-medium text-sm text-purple-700 hover:bg-purple-50"
                >
                  {placementOrientation === 'horizontal' ? 'Horizontal' : 'Vertical'}
                </button>
                <span className="text-xs text-gray-500">
                  Ship {placementIndex + 1}/5 — length {placementIndex < 5 ? SHIP_LENGTHS[placementIndex] : ''}
                </span>
              </div>
              <div className="inline-block border-2 border-gray-300 rounded-lg p-1 bg-gray-50">
                <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1.75rem)` }}>
                  {Array.from({ length: GRID_SIZE }, (_, row) =>
                    Array.from({ length: GRID_SIZE }, (_, col) => (
                      <button
                        key={`${row}-${col}`}
                        type="button"
                        disabled={placementIndex >= 5}
                        onClick={() => handlePlacementCellClick(row, col)}
                        className={`w-7 h-7 rounded border text-xs font-mono flex items-center justify-center transition-colors ${
                          placementGrid[row][col]
                            ? 'bg-purple-500 border-purple-600 text-white'
                            : 'bg-white border-gray-300 hover:border-purple-400 hover:bg-purple-50 disabled:opacity-50'
                        }`}
                      >
                        {placementGrid[row][col] ? '■' : ''}
                      </button>
                    ))
                  )}
                </div>
              </div>
              {placementIndex < 5 && (
                <button
                  type="button"
                  onClick={resetPlacementState}
                  className="text-xs text-gray-500 underline hover:text-gray-700"
                >
                  Reset placement
                </button>
              )}
              {placementShips.length === 5 && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-gray-600">Salt (optional, random if empty)</label>
                  <input
                    type="text"
                    value={mySalt}
                    onChange={(e) => setMySalt(e.target.value)}
                    placeholder="Leave empty for random"
                    className="w-full max-w-xs px-3 py-2 rounded-lg border-2 border-gray-200 text-sm font-mono"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCommitBoard}
                      disabled={isBusy}
                      className="py-3 px-4 rounded-xl font-bold text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50"
                    >
                      {loading ? 'Committing...' : 'Commit board (on-chain)'}
                    </button>
                    {lastCommitTxHash && (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${lastCommitTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:text-blue-800 underline"
                      >
                        View on Explorer
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {haveICommittedBoard && (
            <div className="p-4 bg-green-50 border-2 border-green-200 rounded-xl space-y-2">
              <p className="text-sm font-semibold text-green-800">✓ You have committed your board. Waiting for the other player…</p>
              {lastCommitTxHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${lastCommitTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800 underline"
                >
                  View on Explorer
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* BATTLE PHASE — fire (shooter) and resolve_shot (defender with proof) */}
      {gamePhase === 'battle' && gameState && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`p-5 rounded-xl border-2 ${isPlayer1 ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-600 mb-1">Player 1</div>
              <div className="font-mono text-sm text-gray-800">{gameState.player1.slice(0, 8)}...{gameState.player1.slice(-4)}</div>
              <div className="text-xs text-gray-600 mt-1">Hits: {gameState.hits_on_p1} · Sunk: {gameState.sunk_ships_on_p1}</div>
            </div>
            <div className={`p-5 rounded-xl border-2 ${isPlayer2 ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-white'}`}>
              <div className="text-xs font-bold uppercase text-gray-600 mb-1">Player 2</div>
              <div className="font-mono text-sm text-gray-800">{gameState.player2.slice(0, 8)}...{gameState.player2.slice(-4)}</div>
              <div className="text-xs text-gray-600 mt-1">Hits: {gameState.hits_on_p2} · Sunk: {gameState.sunk_ships_on_p2}</div>
            </div>
          </div>

          {hasPendingShot && (
            <div className="p-4 bg-amber-50 border-2 border-amber-200 rounded-xl space-y-3">
              <p className="text-sm font-semibold text-amber-800">
                Pending shot at ({gameState.pending_shot_x}, {gameState.pending_shot_y}).{' '}
                {iAmDefender
                  ? loading
                    ? 'Generating ZK proof & resolving...'
                    : 'Auto-resolving incoming shot...'
                  : 'Waiting for defender to resolve.'}
              </p>
              {iAmDefender && !loading && (
                <button
                  type="button"
                  onClick={handleResolveShot}
                  disabled={isBusy || placementShips.length !== 5 || !myBoardCommitment}
                  className="py-2 px-3 rounded-lg text-xs font-semibold text-amber-700 border border-amber-300 hover:bg-amber-100 disabled:opacity-50"
                >
                  Retry resolve manually
                </button>
              )}
            </div>
          )}

          {/* Two fixed boards: left = Player 1's side, right = Player 2's side. When you switch player, you see the other board. */}
          {(isPlayer1 || isPlayer2) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left: Player 1's board — if you're P1 you see your ships + hits; if you're P2 you see your shots on P1 */}
              <div className={`p-4 rounded-xl border-2 ${isPlayer1 ? 'border-teal-300 bg-teal-50' : 'border-gray-200 bg-white'}`}>
                <p className="text-sm font-bold text-gray-800 mb-1">Player 1&apos;s board</p>
                <p className="text-xs text-gray-600 mb-2">{isPlayer1 ? 'Your board — your ships and opponent hits' : 'Your shots on Player 1'}</p>
                {isPlayer1 ? (
                  <div className="inline-block border-2 border-gray-300 rounded-lg p-1 bg-white">
                    <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1.75rem)` }}>
                      {Array.from({ length: GRID_SIZE }, (_, row) =>
                        Array.from({ length: GRID_SIZE }, (_, col) => {
                          const key = `${col},${row}`;
                          const hasShip = placementGrid[row][col];
                          const isHit = resolvedHitsOnMyBoard.has(key);
                          return (
                            <div
                              key={`p1-${row}-${col}`}
                              className={`w-7 h-7 rounded border text-xs font-mono flex items-center justify-center ${
                                isHit ? 'bg-red-500 border-red-600 text-white' : hasShip ? 'bg-teal-500 border-teal-600 text-white' : 'bg-white border-gray-300'
                              }`}
                            >
                              {isHit ? '✓' : hasShip ? '■' : ''}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="inline-block border-2 border-gray-300 rounded-lg p-1 bg-gray-50">
                    <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1.75rem)` }}>
                      {Array.from({ length: GRID_SIZE }, (_, row) =>
                        Array.from({ length: GRID_SIZE }, (_, col) => {
                          const key = `${col},${row}`;
                          const result = myShotsOnOpponent[key];
                          return (
                            <div
                              key={`p1-shot-${row}-${col}`}
                              className={`w-7 h-7 rounded border text-xs font-mono flex items-center justify-center ${
                                result !== undefined
                                  ? result.hit
                                    ? result.sunkShip ? 'bg-red-600 border-red-700 text-white' : 'bg-orange-500 border-orange-600 text-white'
                                    : 'bg-gray-400 border-gray-500 text-white'
                                  : 'bg-white border-gray-300'
                              }`}
                            >
                              {result !== undefined ? (result.hit ? (result.sunkShip ? '☠' : '✓') : '✗') : ''}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Player 2's board — if you're P2 you see your ships + hits; if you're P1 you see your shots on P2 (and fire here when your turn) */}
              <div className={`p-4 rounded-xl border-2 ${isPlayer2 ? 'border-teal-300 bg-teal-50' : 'border-gray-200 bg-white'}`}>
                <p className="text-sm font-bold text-gray-800 mb-1">Player 2&apos;s board</p>
                <p className="text-xs text-gray-600 mb-2">
                  {isPlayer2 ? 'Your board — your ships and opponent hits' : 'Your shots on Player 2' + (isMyTurn ? ' — pick a cell to fire' : '')}
                </p>
                {isPlayer2 ? (
                  <div className="inline-block border-2 border-gray-300 rounded-lg p-1 bg-white">
                    <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1.75rem)` }}>
                      {Array.from({ length: GRID_SIZE }, (_, row) =>
                        Array.from({ length: GRID_SIZE }, (_, col) => {
                          const key = `${col},${row}`;
                          const hasShip = placementGrid[row][col];
                          const isHit = resolvedHitsOnMyBoard.has(key);
                          return (
                            <div
                              key={`p2-${row}-${col}`}
                              className={`w-7 h-7 rounded border text-xs font-mono flex items-center justify-center ${
                                isHit ? 'bg-red-500 border-red-600 text-white' : hasShip ? 'bg-teal-500 border-teal-600 text-white' : 'bg-white border-gray-300'
                              }`}
                            >
                              {isHit ? '✓' : hasShip ? '■' : ''}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="inline-block border-2 border-gray-300 rounded-lg p-1 bg-gray-50">
                    <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1.75rem)` }}>
                      {Array.from({ length: GRID_SIZE }, (_, row) =>
                        Array.from({ length: GRID_SIZE }, (_, col) => {
                          const key = `${col},${row}`;
                          const result = myShotsOnOpponent[key];
                          return (
                            <button
                              key={`fire-${row}-${col}`}
                              type="button"
                              disabled={isBusy || result !== undefined || !isMyTurn}
                              onClick={() => handleFire(col, row)}
                              className={`w-7 h-7 rounded border text-xs font-mono flex items-center justify-center disabled:opacity-50 ${
                                result !== undefined
                                  ? result.hit
                                    ? result.sunkShip ? 'bg-red-600 border-red-700 text-white' : 'bg-orange-500 border-orange-600 text-white'
                                    : 'bg-gray-400 border-gray-500 text-white'
                                  : 'border-gray-300 bg-white hover:border-red-400 hover:bg-red-50'
                              }`}
                            >
                              {result !== undefined ? (result.hit ? (result.sunkShip ? '☠' : '✓') : '✗') : `${col},${row}`}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ENDED PHASE */}
      {gamePhase === 'ended' && gameState && (
        <div className="space-y-6">
          <div className="p-10 bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 border-2 border-green-300 rounded-2xl text-center shadow-2xl">
            <div className="text-7xl mb-6">🏆</div>
            <h3 className="text-3xl font-black text-gray-900 mb-4">Game Over</h3>
            {gameState.winner != null && gameState.winner !== undefined && gameState.winner !== '' ? (
              <>
                <p className="text-sm text-gray-600 mb-2">Winner</p>
                <p className="font-mono text-lg font-bold text-gray-800 mb-4">
                  {gameState.winner.slice(0, 12)}...{gameState.winner.slice(-4)}
                </p>
                {gameState.winner === userAddress && (
                  <p className="text-green-700 font-black text-xl">🎉 You won!</p>
                )}
              </>
            ) : (
              <p className="text-gray-600">Game ended.</p>
            )}
          </div>
          <button
            onClick={handleStartNewGame}
            className="w-full py-4 rounded-xl font-bold text-gray-700 bg-gradient-to-r from-gray-200 to-gray-300 hover:from-gray-300 hover:to-gray-400 transition-all shadow-lg hover:shadow-xl"
          >
            Start New Game
          </button>
        </div>
      )}
    </div>
  );
}
