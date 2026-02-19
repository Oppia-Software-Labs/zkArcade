import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Layout } from './Layout';
import { init, type ShipPositions, type ContractModeState } from '../battleship3d/main';
import { BattleshipService } from '../games/battleship/battleshipService';
import { useWallet } from '../hooks/useWallet';
import { BATTLESHIP_CONTRACT } from '@/utils/constants';
import { getFundedSimulationSourceAddress } from '@/utils/simulationUtils';
import { devWalletService, DevWalletService } from '@/services/devWalletService';
import {
  computeBoardCommitment,
  buildResolveShotInput,
  generateResolveShotProof,
  type ShipPosition,
} from '../games/battleship/proofService';
import type { Game, GamePhase } from '../games/battleship/bindings';
import { Buffer } from 'buffer';

const GRID_SIZE = 10;
const SHIP_LENGTHS = [5, 4, 3, 3, 2] as const;
const DEFAULT_POINTS = '0.1';

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

function phaseFromGame(phase: GamePhase): 'placement' | 'battle' | 'ended' {
  if (phase.tag === 'WaitingForBoards') return 'placement';
  if (phase.tag === 'InProgress') return 'battle';
  return 'ended';
}

/** Build 17 board cells in circuit layout order from ShipPositions. */
function boardLayoutCellsFromPositions(positions: ShipPositions): { x: number; y: number }[] {
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

export function Battleship3DWithContract() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initResultRef = useRef<ReturnType<typeof init> | null>(null);
  const { getContractSigner, walletType, publicKey } = useWallet();
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
  const [success, setSuccess] = useState<string | null>(null);

  const isPlayer1 = gameState && gameState.player1 === userAddress;
  const isPlayer2 = gameState && gameState.player2 === userAddress;
  const isMyTurn = gameState?.turn != null && gameState.turn !== '' && gameState.turn === userAddress;
  const hasPendingShot =
    gameState?.pending_shot_shooter != null &&
    gameState?.pending_shot_shooter !== undefined &&
    gameState?.pending_shot_shooter !== '';
  const iAmDefender = hasPendingShot && gameState?.pending_shot_shooter !== userAddress;
  const quickstartAvailable =
    walletType === 'dev' &&
    DevWalletService.isDevModeAvailable() &&
    DevWalletService.isPlayerAvailable(1) &&
    DevWalletService.isPlayerAvailable(2);

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

  // Apply last_resolved_* for shooter
  useEffect(() => {
    if (!gameState || !userAddress) return;
    const noPending =
      gameState.pending_shot_shooter == null ||
      gameState.pending_shot_shooter === undefined ||
      gameState.pending_shot_shooter === '';
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

  // Sync contract state into 3D when in battle
  useEffect(() => {
    const setContractState = initResultRef.current?.setContractState;
    if (!setContractState || gamePhase !== 'battle') return;
    setContractState({
      phase: 'battle',
      isMyTurn,
      hasPendingShot,
      iAmDefender,
      pendingShotX: gameState?.pending_shot_x,
      pendingShotY: gameState?.pending_shot_y,
      resolvedHitsOnMyBoard,
      myShotsOnOpponent,
    });
  }, [gamePhase, isMyTurn, hasPendingShot, iAmDefender, gameState?.pending_shot_x, gameState?.pending_shot_y, resolvedHitsOnMyBoard, myShotsOnOpponent]);

  // Init 3D once when we have a container and we're in placement or battle; do not re-init when going placement -> battle
  useEffect(() => {
    const container = containerRef.current;
    if (gamePhase !== 'placement' && gamePhase !== 'battle') return;
    if (!container) return;
    if (initResultRef.current) return;

    const handlePlacementComplete = (positions: ShipPositions) => {
      setPlacementFrom3D(positions);
    };

    const handleFire = (col: number, row: number) => {
      setMyPendingShot({ x: col, y: row });
      setLoading(true);
      setError(null);
      battleshipService
        .fire(sessionId, userAddress, col, row, getContractSigner())
        .then(() => {
          setSuccess(`Shot at (${col}, ${row}) submitted. Waiting for defender to resolve.`);
          loadGameState();
          setTimeout(() => setSuccess(null), 3000);
        })
        .catch((err) => {
          setMyPendingShot(null);
          setError(err instanceof Error ? err.message : 'Failed to fire');
        })
        .finally(() => setLoading(false));
    };

    const result = init(container, {
      contractMode: true,
      callbacks: {
        onPlacementComplete: handlePlacementComplete,
        onFire: handleFire,
      },
    });
    initResultRef.current = result;
    // Do not dispose here when deps change (e.g. placement -> battle); see cleanup effect below
  }, [gamePhase, sessionId, userAddress]);

  // Dispose 3D when leaving placement/battle or on unmount
  useEffect(() => {
    if (gamePhase === 'placement' || gamePhase === 'battle') return;
    if (initResultRef.current) {
      initResultRef.current.dispose();
      initResultRef.current = null;
    }
  }, [gamePhase]);

  useEffect(() => {
    return () => {
      if (initResultRef.current) {
        initResultRef.current.dispose();
        initResultRef.current = null;
      }
    };
  }, []);

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
      const authXDR = await battleshipService.prepareStartGame(
        sid,
        p1Address,
        placeholderP2,
        p1Points,
        p1Points,
        p1Signer
      );
      const signedXDR = await battleshipService.importAndSignAuthEntry(authXDR, p2Address, p1Points, p2Signer);
      await battleshipService.finalizeStartGame(signedXDR, p2Address, p2Signer);

      const game = await battleshipService.getGame(sid);
      setGameState(game);
      setGamePhase(game ? phaseFromGame(game.phase) : 'placement');
      setSuccess('Quickstart complete! Place your ships.');
      setTimeout(() => setSuccess(null), 3000);
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
      setSuccess('Game loaded.');
      setTimeout(() => setSuccess(null), 2000);
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
      await battleshipService.commitBoard(sessionId, userAddress, Buffer.from(commitment), getContractSigner());
      setMyBoardCommitment(commitment);
      setMySalt(salt.toString());
      setSuccess('Board committed on-chain.');
      await loadGameState();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit board');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveShot = async () => {
    if (!gameState || !placementFrom3D || !myBoardCommitment || !mySalt) return;
    const shotX = gameState.pending_shot_x;
    const shotY = gameState.pending_shot_y;
    const shooter = gameState.pending_shot_shooter;
    if (shooter == null || shooter === undefined || shooter === '') return;

    const boardLayoutCells = boardLayoutCellsFromPositions(placementFrom3D);
    if (boardLayoutCells.length !== 17) return;
    const hitCellIndex = boardLayoutCells.findIndex((c) => c.x === shotX && c.y === shotY);
    const isHit = hitCellIndex >= 0;
    let sunkShip = 0;
    if (isHit) {
      const shipIndex = hitCellIndex < 5 ? 0 : hitCellIndex < 9 ? 1 : hitCellIndex < 12 ? 2 : hitCellIndex < 15 ? 3 : 4;
      const shipStart = [0, 5, 9, 12, 15][shipIndex];
      const shipLen = SHIP_LENGTHS[shipIndex];
      const shipCells = boardLayoutCells.slice(shipStart, shipStart + shipLen);
      const hitsIncludingThis = new Set(resolvedHitsOnMyBoard);
      hitsIncludingThis.add(`${shotX},${shotY}`);
      if (shipCells.every((c) => hitsIncludingThis.has(`${c.x},${c.y}`))) sunkShip = shipIndex + 1;
    }

    setLoading(true);
    setError(null);
    try {
      const publicInputsHash = await battleshipService.buildPublicInputsHash(
        sessionId,
        userAddress,
        shooter,
        shotX,
        shotY,
        isHit,
        sunkShip,
        Buffer.from(myBoardCommitment)
      );
      const priorHits = boardLayoutCells.map((c) => (resolvedHitsOnMyBoard.has(`${c.x},${c.y}`) ? 1 : 0));
      const witnessInput = buildResolveShotInput(
        placementFrom3D as ShipPosition,
        mySalt,
        priorHits,
        shotX,
        shotY,
        isHit ? 1 : 0,
        sunkShip,
        myBoardCommitment,
        new Uint8Array(publicInputsHash)
      );
      const proofPayload = await generateResolveShotProof(witnessInput);
      await battleshipService.resolveShot(
        sessionId,
        userAddress,
        isHit,
        sunkShip,
        Buffer.from(proofPayload),
        publicInputsHash,
        getContractSigner()
      );
      if (isHit) setResolvedHitsOnMyBoard((prev) => new Set(prev).add(`${shotX},${shotY}`));
      setSuccess(isHit ? (sunkShip ? 'Hit! Ship sunk.' : 'Hit!') : 'Miss.');
      await loadGameState();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve shot');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout title="Battleship 3D" subtitle="Two-player on-chain">
      <div className="studio-main" style={{ display: 'flex', flexDirection: 'column', minHeight: '60vh' }}>
        {error && (
          <div className="notice error" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}
        {success && (
          <div className="notice info" style={{ marginBottom: 8 }}>
            {success}
          </div>
        )}

        {gamePhase === 'create' && (
          <div className="card" style={{ maxWidth: 480, marginBottom: 24 }}>
            <h3 className="gradient-text">3D Two-Player Game</h3>
            {!userAddress && (
              <p className="notice info" style={{ marginTop: 8, marginBottom: 12 }}>
                Connect a dev wallet (Player 1 or 2) to start or load a game.
              </p>
            )}
            <p style={{ color: 'var(--color-ink-muted)', marginTop: 8, marginBottom: 16 }}>
              Quickstart (both players sign with dev wallets) or load an existing game by session ID.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quickstartAvailable && (
                <button
                  type="button"
                  onClick={handleQuickstart}
                  disabled={loading || !userAddress}
                  className="btn primary"
                >
                  {loading ? 'Creating...' : 'Quickstart (Player 1 & 2 sign)'}
                </button>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  value={loadSessionId}
                  onChange={(e) => setLoadSessionId(e.target.value)}
                  placeholder="Session ID"
                  className="input"
                  style={{ flex: 1 }}
                />
                <button type="button" onClick={handleLoadGame} disabled={loading || !userAddress} className="btn secondary">
                  Load game
                </button>
              </div>
            </div>
            <Link to="/play" style={{ display: 'inline-block', marginTop: 16, fontSize: 14 }}>
              ← 2D Game
            </Link>
          </div>
        )}

        {(gamePhase === 'placement' || gamePhase === 'battle') && (
          <>
            <div
              ref={containerRef}
              style={{
                width: '100%',
                height: 'min(70vh, 560px)',
                minHeight: 320,
                background: '#0f172a',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            />
            <div className="card" style={{ marginTop: 16, maxWidth: 560 }}>
              {gamePhase === 'placement' && (
                <>
                  <p className="text-sm text-gray-700 mb-2">
                    Place your 5 ships on the left grid (drag from dock). When done, enter an optional salt and commit.
                  </p>
                  {placementFrom3D && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label className="text-xs font-bold text-gray-600">Salt (optional)</label>
                      <input
                        type="text"
                        value={mySalt}
                        onChange={(e) => setMySalt(e.target.value)}
                        placeholder="Leave empty for random"
                        className="input"
                      />
                      <button
                        type="button"
                        onClick={handleCommitBoard}
                        disabled={loading || !placementFrom3D}
                        className="btn primary"
                      >
                        {loading ? 'Committing...' : 'Commit board (on-chain)'}
                      </button>
                    </div>
                  )}
                </>
              )}
              {gamePhase === 'battle' && (
                <>
                  {hasPendingShot && iAmDefender && (
                    <button
                      type="button"
                      onClick={handleResolveShot}
                      disabled={loading || !myBoardCommitment}
                      className="btn primary"
                      style={{ marginBottom: 8 }}
                    >
                      {loading ? 'Generating proof...' : 'Resolve shot (proof + submit)'}
                    </button>
                  )}
                  {hasPendingShot && !iAmDefender && (
                    <p className="text-sm text-amber-800">Waiting for defender to resolve your shot.</p>
                  )}
                  {!hasPendingShot && isMyTurn && (
                    <p className="text-sm text-gray-700">Your turn — click the right grid to fire.</p>
                  )}
                  {!hasPendingShot && !isMyTurn && (isPlayer1 || isPlayer2) && (
                    <p className="text-sm text-gray-600">Opponent&apos;s turn.</p>
                  )}
                </>
              )}
              <Link to="/play" style={{ display: 'inline-block', marginTop: 12, fontSize: 14 }}>
                ← 2D Game
              </Link>
            </div>
          </>
        )}

        {gamePhase === 'ended' && gameState && (
          <div className="card">
            <h3>Game Over</h3>
            {gameState.winner != null && gameState.winner !== '' && (
              <p className="mt-2">
                Winner: {gameState.winner.slice(0, 12)}...{gameState.winner.slice(-4)}
                {gameState.winner === userAddress && ' (You!)'}
              </p>
            )}
            <Link to="/" style={{ display: 'inline-block', marginTop: 12, fontSize: 14 }}>
              ← Back
            </Link>
          </div>
        )}
      </div>
    </Layout>
  );
}
