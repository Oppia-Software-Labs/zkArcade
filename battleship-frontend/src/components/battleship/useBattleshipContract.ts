import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { init, resetPlayerBoard, restoreShipPlacements, type ShipPositions } from '../../battleship3d/main';
import { BattleshipService } from '../../games/battleship/battleshipService';
import { useWallet } from '../../hooks/useWallet';
import { BATTLESHIP_CONTRACT } from '@/utils/constants';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import {
  computeBoardCommitment,
  buildResolveShotInput,
  generateResolveShotProof,
  type ShipPosition,
} from '../../games/battleship/proofService';
import { decodeShotBitmap } from '../../games/battleship/shotUtils';
import { unwrapOptionBuffer, unwrapOptionString, phaseFromGame } from '../../games/battleship/contractUtils';
import type { Game } from '../../games/battleship/bindings';
import { Buffer } from 'buffer';

const SHIP_LENGTHS = [5, 4, 3, 3, 2] as const;
const SESSION_STORAGE_KEY_3D = 'battleship3d_perPlayerUi_current';

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

const battleshipService = new BattleshipService(BATTLESHIP_CONTRACT);

export interface PerPlayerState {
  placementFrom3D: ShipPositions | null;
  mySalt: string;
  myBoardCommitment: Uint8Array | null;
  resolvedHitsOnMyBoard: Set<string>;
  myShotsOnOpponent: Record<string, { hit: boolean; sunkShip: number }>;
  myPendingShot: { x: number; y: number } | null;
}

interface SerializedPerPlayerState {
  placementFrom3D: ShipPositions | null;
  mySalt: string;
  myBoardCommitment: number[] | null;
  resolvedHitsOnMyBoard: string[];
  myShotsOnOpponent: Record<string, { hit: boolean; sunkShip: number }>;
  myPendingShot: { x: number; y: number } | null;
}

function serializePerPlayerUi3D(map: Record<string, PerPlayerState>): Record<string, SerializedPerPlayerState> {
  const out: Record<string, SerializedPerPlayerState> = {};
  for (const [key, val] of Object.entries(map)) {
    out[key] = {
      ...val,
      myBoardCommitment: val.myBoardCommitment ? Array.from(val.myBoardCommitment) : null,
      resolvedHitsOnMyBoard: Array.from(val.resolvedHitsOnMyBoard),
    };
  }
  return out;
}

function deserializePerPlayerUi3D(raw: Record<string, SerializedPerPlayerState>): Record<string, PerPlayerState> {
  const out: Record<string, PerPlayerState> = {};
  for (const [key, val] of Object.entries(raw)) {
    out[key] = {
      ...val,
      myBoardCommitment: val.myBoardCommitment ? new Uint8Array(val.myBoardCommitment) : null,
      resolvedHitsOnMyBoard: new Set(val.resolvedHitsOnMyBoard),
    };
  }
  return out;
}

export function boardLayoutCellsFromPositions(positions: ShipPositions): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let s = 0; s < 5; s++) {
    const len = SHIP_LENGTHS[s];
    const col = positions.ship_x[s] ?? 0;
    const row = positions.ship_y[s] ?? 0;
    const dir = positions.ship_dir[s] ?? 0;
    for (let k = 0; k < len; k++) {
      out.push({
        x: col + (dir === 1 ? k : 0),
        y: row + (dir === 0 ? k : 0),
      });
    }
  }
  return out.length === 17 ? out : [];
}

export type InitResultRef = React.MutableRefObject<ReturnType<typeof init> | null>;

export function useBattleshipContract(initResultRef: InitResultRef) {
  const { getContractSigner, walletType, publicKey, switchPlayer, getCurrentDevPlayer, isConnecting, connectDev, isDevModeAvailable } = useWallet();
  const userAddress = publicKey ?? '';
  const [sessionId, setSessionId] = useState(() => createRandomSessionId());
  const [gameState, setGameState] = useState<Game | null>(null);
  const [gamePhase, setGamePhase] = useState<'create' | 'placement' | 'battle' | 'ended'>('create');
  const [createMode, setCreateMode] = useState<'create' | 'load'>('create');
  const [loadSessionId, setLoadSessionId] = useState('');
  const [placementFrom3D, setPlacementFrom3D] = useState<ShipPositions | null>(null);
  const [mySalt, setMySalt] = useState('');
  const [myBoardCommitment, setMyBoardCommitment] = useState<Uint8Array | null>(null);
  const [resolvedHitsOnMyBoard, setResolvedHitsOnMyBoard] = useState<Set<string>>(new Set());
  const [myShotsOnOpponent, setMyShotsOnOpponent] = useState<Record<string, { hit: boolean; sunkShip: number }>>({});
  const [myPendingShot, setMyPendingShot] = useState<{ x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ message: string; txHash?: string } | null>(null);
  const [perPlayerUi, setPerPlayerUi] = useState<Record<string, PerPlayerState>>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY_3D);
      if (raw) return deserializePerPlayerUi3D(JSON.parse(raw));
    } catch { /* ignore */ }
    return {};
  });
  const [contractSyncTrigger, setContractSyncTrigger] = useState(0);

  const perPlayerUiRef = useRef(perPlayerUi);
  const prevUserAddressRef = useRef<string>(userAddress);
  const playerSwitchPendingRef = useRef(false);
  const restoreTokenRef = useRef(0);
  const sessionIdRef = useRef(sessionId);
  const userAddressRef = useRef(userAddress);
  const getContractSignerRef = useRef(getContractSigner);
  const placementRef = useRef(placementFrom3D);
  const commitmentRef = useRef(myBoardCommitment);
  const saltRef = useRef(mySalt);
  const resolvedHitsRef = useRef(resolvedHitsOnMyBoard);
  const myShotsOnOpponentRef = useRef(myShotsOnOpponent);
  const myPendingShotRef = useRef(myPendingShot);
  const gameStateRef = useRef(gameState);
  const autoResolveInProgressRef = useRef(false);

  useEffect(() => { perPlayerUiRef.current = perPlayerUi; }, [perPlayerUi]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { userAddressRef.current = userAddress; }, [userAddress]);
  useEffect(() => { getContractSignerRef.current = getContractSigner; }, [getContractSigner]);
  useEffect(() => { placementRef.current = placementFrom3D; }, [placementFrom3D]);
  useEffect(() => { commitmentRef.current = myBoardCommitment; }, [myBoardCommitment]);
  useEffect(() => { saltRef.current = mySalt; }, [mySalt]);
  useEffect(() => { resolvedHitsRef.current = resolvedHitsOnMyBoard; }, [resolvedHitsOnMyBoard]);
  useEffect(() => { myShotsOnOpponentRef.current = myShotsOnOpponent; }, [myShotsOnOpponent]);
  useEffect(() => { myPendingShotRef.current = myPendingShot; }, [myPendingShot]);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  useEffect(() => {
    try {
      const keys = Object.keys(perPlayerUi);
      if (keys.length === 0) sessionStorage.removeItem(SESSION_STORAGE_KEY_3D);
      else sessionStorage.setItem(SESSION_STORAGE_KEY_3D, JSON.stringify(serializePerPlayerUi3D(perPlayerUi)));
    } catch { /* ignore */ }
  }, [perPlayerUi]);

  const isPlayer1 = !!gameState && gameState.player1 === userAddress;
  const isPlayer2 = !!gameState && gameState.player2 === userAddress;
  const pendingShotShooter = gameState ? unwrapOptionString(gameState.pending_shot_shooter) : null;
  const isMyTurn = gameState?.turn != null && gameState.turn !== '' && gameState.turn === userAddress;
  const hasPendingShot = pendingShotShooter != null && pendingShotShooter !== '';
  const iAmDefender = hasPendingShot && pendingShotShooter !== userAddress;
  const quickstartAvailable =
    walletType === 'dev' &&
    DevWalletService.isDevModeAvailable() &&
    DevWalletService.isPlayerAvailable(1) &&
    DevWalletService.isPlayerAvailable(2);

  const haveICommittedBoard = useMemo(() => {
    if (!gameState) return false;
    if (isPlayer1 && unwrapOptionBuffer(gameState.board_commitment_p1) != null) return true;
    if (isPlayer2 && unwrapOptionBuffer(gameState.board_commitment_p2) != null) return true;
    return false;
  }, [gameState, isPlayer1, isPlayer2]);

  const fireStatusLabel = hasPendingShot
    ? iAmDefender
      ? 'Waiting for defender resolve'
      : 'Shot submitted - switch wallet'
    : isMyTurn
      ? 'Ready to fire'
      : 'Opponent turn';

  const loadGameState = async () => {
    try {
      const game = await battleshipService.getGame(sessionId);
      setGameState(game);
      if (game) setGamePhase(phaseFromGame(game.phase));
    } catch {
      setGameState(null);
    }
  };

  useEffect(() => {
    if (gamePhase !== 'create') {
      loadGameState();
      const interval = setInterval(loadGameState, 5000);
      return () => clearInterval(interval);
    }
  }, [sessionId, gamePhase]);

  useEffect(() => {
    if (!gameState || !userAddress) return;
    const noPending = unwrapOptionString(gameState.pending_shot_shooter) == null;
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
    if (!gameState || (!isPlayer1 && !isPlayer2)) return;
    if (!placementFrom3D) return;
    const blCells = boardLayoutCellsFromPositions(placementFrom3D);
    if (blCells.length !== 17) return;
    const incomingBitmap = isPlayer1 ? gameState.shots_p2_to_p1 : gameState.shots_p1_to_p2;
    const incomingShots = decodeShotBitmap(incomingBitmap);
    if (incomingShots.size === 0) return;
    const shipCellKeys = new Set(blCells.map((c) => `${c.x},${c.y}`));
    setResolvedHitsOnMyBoard((prev) => {
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
  }, [gameState, isPlayer1, isPlayer2, placementFrom3D]);

  useEffect(() => {
    if (!gameState || (!isPlayer1 && !isPlayer2)) return;
    const myBitmap = isPlayer1 ? gameState.shots_p1_to_p2 : gameState.shots_p2_to_p1;
    const allMyShots = decodeShotBitmap(myBitmap);
    if (allMyShots.size === 0) return;
    setMyShotsOnOpponent((prev) => {
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

  useEffect(() => {
    if (prevUserAddressRef.current === userAddress) return;
    if (gamePhase === 'create') {
      prevUserAddressRef.current = userAddress;
      return;
    }
    const prevKey = `${sessionId}:${prevUserAddressRef.current}`;
    const nextKey = `${sessionId}:${userAddress}`;
    const cachedForNext: PerPlayerState | undefined = perPlayerUiRef.current[nextKey];
    const thisRestoreToken = ++restoreTokenRef.current;
    const outgoingSnapshot: PerPlayerState = {
      placementFrom3D: placementRef.current ? { ...placementRef.current } : null,
      mySalt: saltRef.current,
      myBoardCommitment: commitmentRef.current ? new Uint8Array(commitmentRef.current) : null,
      resolvedHitsOnMyBoard: new Set(resolvedHitsRef.current),
      myShotsOnOpponent: { ...myShotsOnOpponentRef.current },
      myPendingShot: myPendingShotRef.current ? { ...myPendingShotRef.current } : null,
    };
    setPerPlayerUi((prev) => {
      const updated = { ...prev };
      updated[prevKey] = outgoingSnapshot;
      return updated;
    });
    prevUserAddressRef.current = userAddress;
    const inBattle = gamePhase === 'battle';
    playerSwitchPendingRef.current = true;

    const nextPlacement = cachedForNext?.placementFrom3D ?? null;
    if (nextPlacement) {
      const cached = cachedForNext as PerPlayerState;
      placementRef.current = nextPlacement;
      saltRef.current = cached.mySalt;
      commitmentRef.current = cached.myBoardCommitment ? new Uint8Array(cached.myBoardCommitment) : null;
      resolvedHitsRef.current = new Set(cached.resolvedHitsOnMyBoard);
      myShotsOnOpponentRef.current = { ...cached.myShotsOnOpponent };
      myPendingShotRef.current = cached.myPendingShot ? { ...cached.myPendingShot } : null;
      setPlacementFrom3D(nextPlacement);
      setMySalt(cached.mySalt);
      setMyBoardCommitment(cached.myBoardCommitment ? new Uint8Array(cached.myBoardCommitment) : null);
      setResolvedHitsOnMyBoard(new Set(cached.resolvedHitsOnMyBoard));
      setMyShotsOnOpponent({ ...cached.myShotsOnOpponent });
      setMyPendingShot(cached.myPendingShot ? { ...cached.myPendingShot } : null);
      restoreShipPlacements(nextPlacement)
        .then(() => {
          if (restoreTokenRef.current !== thisRestoreToken) return;
          playerSwitchPendingRef.current = false;
          setContractSyncTrigger((c) => c + 1);
        })
        .catch((err) => {
          if (restoreTokenRef.current !== thisRestoreToken) return;
          console.error('Failed to restore ship placements:', err);
          playerSwitchPendingRef.current = false;
          setError('Failed to restore ship placements for this player.');
        });
    } else {
      if (initResultRef.current) {
        resetPlayerBoard({ showDock: !inBattle && !haveICommittedBoard });
      }
      if (cachedForNext) {
        placementRef.current = cachedForNext.placementFrom3D ? { ...cachedForNext.placementFrom3D } : null;
        saltRef.current = cachedForNext.mySalt;
        commitmentRef.current = cachedForNext.myBoardCommitment ? new Uint8Array(cachedForNext.myBoardCommitment) : null;
        resolvedHitsRef.current = new Set(cachedForNext.resolvedHitsOnMyBoard);
        myShotsOnOpponentRef.current = { ...cachedForNext.myShotsOnOpponent };
        myPendingShotRef.current = cachedForNext.myPendingShot ? { ...cachedForNext.myPendingShot } : null;
        setPlacementFrom3D(cachedForNext.placementFrom3D);
        setMySalt(cachedForNext.mySalt);
        setMyBoardCommitment(cachedForNext.myBoardCommitment ? new Uint8Array(cachedForNext.myBoardCommitment) : null);
        setResolvedHitsOnMyBoard(new Set(cachedForNext.resolvedHitsOnMyBoard));
        setMyShotsOnOpponent({ ...cachedForNext.myShotsOnOpponent });
        setMyPendingShot(cachedForNext.myPendingShot ? { ...cachedForNext.myPendingShot } : null);
      } else {
        placementRef.current = null;
        saltRef.current = '';
        commitmentRef.current = null;
        resolvedHitsRef.current = new Set();
        myShotsOnOpponentRef.current = {};
        myPendingShotRef.current = null;
        setPlacementFrom3D(null);
        setMySalt('');
        setMyBoardCommitment(null);
        setResolvedHitsOnMyBoard(new Set());
        setMyShotsOnOpponent({});
        setMyPendingShot(null);
      }
      playerSwitchPendingRef.current = false;
      setContractSyncTrigger((c) => c + 1);
    }
  }, [userAddress, sessionId]);

  useEffect(() => {
    if (!userAddress || gamePhase === 'create') return;
    const key = `${sessionId}:${userAddress}`;
    const hasState = placementFrom3D != null || mySalt !== '' || myBoardCommitment != null;
    if (!hasState) return;
    setPerPlayerUi((prev) => ({
      ...prev,
      [key]: {
        placementFrom3D: placementFrom3D ? { ...placementFrom3D } : null,
        mySalt,
        myBoardCommitment: myBoardCommitment ? new Uint8Array(myBoardCommitment) : null,
        resolvedHitsOnMyBoard: new Set(resolvedHitsOnMyBoard),
        myShotsOnOpponent: { ...myShotsOnOpponent },
        myPendingShot: myPendingShot ? { ...myPendingShot } : null,
      },
    }));
  }, [userAddress, sessionId, gamePhase, placementFrom3D, mySalt, myBoardCommitment, resolvedHitsOnMyBoard, myShotsOnOpponent, myPendingShot]);

  const handleQuickstart = async () => {
    if (!quickstartAvailable) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const p1Points = BigInt(Math.floor(0.1 * 10_000_000));
      const originalPlayer = devWalletService.getCurrentPlayer();
      let p1Address = '';
      let p2Address = '';
      let p1Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
      let p2Signer: ReturnType<typeof devWalletService.getSigner> | null = null;
      try {
        await devWalletService.initPlayer(1);
        p1Address = devWalletService.getPublicKey();
        p1Signer = devWalletService.getSigner();
        await devWalletService.initPlayer(2);
        p2Address = devWalletService.getPublicKey();
        p2Signer = devWalletService.getSigner();
      } finally {
        if (originalPlayer) await devWalletService.initPlayer(originalPlayer);
      }
      if (!p1Signer || !p2Signer) throw new Error('Failed to get signers');
      if (p1Address === p2Address) throw new Error('Two different dev wallets required');
      const sid = createRandomSessionId();
      setSessionId(sid);
      setGamePhase('create');
      setCreateMode('create');
      const placeholderP2 = await getFundedSimulationSourceAddress([p1Address, p2Address]);
      const authXDR = await battleshipService.prepareStartGame(sid, p1Address, placeholderP2, p1Points, p1Points, p1Signer);
      const signedXDR = await battleshipService.importAndSignAuthEntry(authXDR, p2Address, p1Points, p2Signer);
      await battleshipService.finalizeStartGame(signedXDR, p2Address, p2Signer);
      const game = await battleshipService.getGame(sid);
      setGameState(game);
      setGamePhase(game ? phaseFromGame(game.phase) : 'placement');
      setSuccess({ message: 'Quickstart complete! Place your ships.' });
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quickstart failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadGame = async () => {
    const parsed = parseInt(loadSessionId.trim(), 10);
    if (isNaN(parsed) || parsed <= 0) {
      setError('Enter a valid session ID');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const game = await battleshipService.getGame(parsed);
      if (!game) throw new Error('Game not found');
      if (game.player1 !== userAddress && game.player2 !== userAddress) throw new Error('You are not a player');
      setSessionId(parsed);
      setGameState(game);
      setLoadSessionId('');
      setGamePhase(phaseFromGame(game.phase));
      setSuccess({ message: 'Game loaded.' });
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load game');
    } finally {
      setLoading(false);
    }
  };

  const handleCommitBoard = async () => {
    if (!placementFrom3D) return;
    setLoading(true);
    setError(null);
    try {
      const salt = mySalt.trim()
        ? BigInt(mySalt)
        : BigInt('0x' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join(''));
      const commitment = await computeBoardCommitment(placementFrom3D as ShipPosition, salt);
      const { txHash } = await battleshipService.commitBoard(sessionId, userAddress, Buffer.from(commitment), getContractSigner());
      placementRef.current = placementFrom3D;
      saltRef.current = salt.toString();
      commitmentRef.current = commitment;
      setMyBoardCommitment(commitment);
      setMySalt(salt.toString());
      setSuccess({ message: 'Board committed on-chain.', txHash });
      await loadGameState();
      setTimeout(() => setSuccess(null), 8000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit board');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchPlayer = async () => {
    if (walletType !== 'dev') {
      setError('Switch Player is only available with dev wallets.');
      return;
    }
    const current = getCurrentDevPlayer();
    if (current !== 1 && current !== 2) {
      setError('Connect a dev wallet player first.');
      return;
    }
    setError(null);
    try {
      await switchPlayer(current === 1 ? 2 : 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch player');
    }
  };

  const handleResolveShot = async () => {
    const placement = placementRef.current;
    const salt = saltRef.current;
    const hits = resolvedHitsRef.current;
    if (!placement || !salt) return;
    if (autoResolveInProgressRef.current) return;
    autoResolveInProgressRef.current = true;
    setLoading(true);
    setError(null);
    setSuccess({ message: 'Generating ZK proof & resolving shot...' });
    try {
      const currentSession = sessionIdRef.current;
      const currentUser = userAddressRef.current;
      const currentSigner = getContractSignerRef.current;
      const game = await battleshipService.getGame(currentSession);
      if (!game) {
        setError('Game not found on-chain');
        return;
      }
      setGameState(game);
      const shotX = game.pending_shot_x;
      const shotY = game.pending_shot_y;
      const shooter = unwrapOptionString(game.pending_shot_shooter);
      if (shooter == null || shooter === '') {
        setError('Pending shot not found on-chain');
        return;
      }
      const defenderCommitmentRaw = currentUser === game.player1 ? game.board_commitment_p1 : game.board_commitment_p2;
      const boardCommitment = unwrapOptionBuffer(defenderCommitmentRaw);
      if (!boardCommitment || boardCommitment.length !== 32) {
        setError('Board commitment not found on-chain');
        return;
      }
      const boardLayoutCells = boardLayoutCellsFromPositions(placement);
      if (boardLayoutCells.length !== 17) return;
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
        if (shipCells.every((c) => hitsIncludingThis.has(`${c.x},${c.y}`))) sunkShip = shipIndex + 1;
      }
      const recomputedCommitment = await computeBoardCommitment(placement as ShipPosition, salt || '0');
      if (recomputedCommitment.length !== 32 || boardCommitment.length !== 32) {
        setError('Board commitment length mismatch');
        return;
      }
      for (let i = 0; i < 32; i++) {
        if (recomputedCommitment[i] !== (boardCommitment as Uint8Array)[i]) {
          setError(
            "Your saved board or salt doesn't match the on-chain commitment. Refresh to restore local placement/salt. If this state was committed on another device or local storage was cleared, this player cannot resolve."
          );
          return;
        }
      }
      const publicInputsHash = await battleshipService.buildPublicInputsHash(
        currentSession,
        currentUser,
        shooter,
        shotX,
        shotY,
        isHit,
        sunkShip,
        boardCommitment
      );
      const priorHits = boardLayoutCells.map((c) => (hits.has(`${c.x},${c.y}`) ? 1 : 0));
      const witnessInput = buildResolveShotInput(
        placement as ShipPosition,
        salt || '0',
        priorHits,
        shotX,
        shotY,
        isHit ? 1 : 0,
        sunkShip,
        new Uint8Array(boardCommitment),
        new Uint8Array(publicInputsHash)
      );
      const proofPayload = await generateResolveShotProof(witnessInput);
      const { txHash } = await battleshipService.resolveShot(
        currentSession,
        currentUser,
        isHit,
        sunkShip,
        Buffer.from(proofPayload),
        publicInputsHash,
        currentSigner()
      );
      if (isHit) setResolvedHitsOnMyBoard((prev) => new Set(prev).add(`${shotX},${shotY}`));
      setMyPendingShot(null);
      const msg = isHit ? (sunkShip ? 'Hit! Ship sunk.' : 'Hit!') : 'Miss.';
      setSuccess({ message: `Resolved: ${msg}`, txHash });
      await loadGameState();
      await new Promise((r) => setTimeout(r, 400));
      await loadGameState();
      setContractSyncTrigger((t) => t + 1);
      setTimeout(() => setSuccess(null), 8000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve shot');
    } finally {
      setLoading(false);
      autoResolveInProgressRef.current = false;
    }
  };

  useEffect(() => {
    if (!iAmDefender || !hasPendingShot) return;
    if (!placementFrom3D || !mySalt) return;
    if (autoResolveInProgressRef.current) return;
    handleResolveShot();
  }, [iAmDefender, hasPendingShot, placementFrom3D, mySalt, pendingShotShooter]);

  const onPlacementComplete = useCallback((positions: ShipPositions) => {
    placementRef.current = positions;
    setPlacementFrom3D(positions);
  }, []);

  const onFire = useCallback((col: number, row: number) => {
    const currentSession = sessionIdRef.current;
    const currentUser = userAddressRef.current;
    const currentSigner = getContractSignerRef.current;
    setMyPendingShot({ x: col, y: row });
    setError(null);
    setLoading(true);
    battleshipService.fire(currentSession, currentUser, col, row, currentSigner())
      .then(async ({ txHash }) => {
        setSuccess({ message: `Shot at (${col}, ${row}) submitted. Waiting for defender to resolve.`, txHash });
        const game = await battleshipService.getGame(currentSession);
        setGameState(game);
        if (game) setGamePhase(phaseFromGame(game.phase));
        setTimeout(() => setSuccess(null), 8000);
      })
      .catch((err) => {
        console.error('fire tx error:', err);
        setMyPendingShot(null);
        setError(err instanceof Error ? err.message : 'Failed to fire');
      })
      .finally(() => setLoading(false));
  }, []);

  return {
    // state
    sessionId,
    gameState,
    gamePhase,
    createMode,
    loadSessionId,
    setLoadSessionId,
    placementFrom3D,
    mySalt,
    setMySalt,
    myBoardCommitment,
    resolvedHitsOnMyBoard,
    myShotsOnOpponent,
    myPendingShot,
    loading,
    error,
    success,
    contractSyncTrigger,
    // derived
    userAddress,
    isPlayer1,
    isPlayer2,
    pendingShotShooter,
    isMyTurn,
    hasPendingShot,
    iAmDefender,
    haveICommittedBoard,
    fireStatusLabel,
    quickstartAvailable,
    isConnecting,
    walletType,
    // handlers
    loadGameState,
    handleQuickstart,
    handleLoadGame,
    handleCommitBoard,
    handleSwitchPlayer,
    handleResolveShot,
    onPlacementComplete,
    onFire,
    connectDev,
    isDevModeAvailable,
    // refs for sync effect (shell)
    playerSwitchPendingRef,
  };
}
