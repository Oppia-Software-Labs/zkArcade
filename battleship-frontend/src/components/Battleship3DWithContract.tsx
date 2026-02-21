import { useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { init } from '../battleship3d/main';
import { useBattleshipContract } from './battleship/useBattleshipContract';
import { PlacementPanel } from './battleship/PlacementPanel';
import { BattlePanel } from './battleship/BattlePanel';
import { useToast, ToastContainer } from './Toast';
import { decodeShotBitmap } from '../games/battleship/shotUtils';

export function Battleship3DWithContract() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initResultRef = useRef<ReturnType<typeof init> | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const autoTriggeredRef = useRef(false);
  const pendingAutoLoadRef = useRef(false);

  const { toasts, addToast } = useToast();
  const contract = useBattleshipContract(initResultRef);

  const {
    gameState,
    gamePhase,
    loadSessionId,
    setLoadSessionId,
    placementFrom3D,
    mySalt,
    setMySalt,
    loading,
    error,
    success,
    sessionId,
    userAddress,
    isPlayer1,
    isPlayer2,
    haveICommittedBoard,
    hasPendingShot,
    iAmDefender,
    isMyTurn,
    myPendingShot,
    fireStatusLabel,
    contractSyncTrigger,
    quickstartAvailable,
    isConnecting,
    walletType,
    handleQuickstart,
    handleLoadGame,
    handleCommitBoard,
    handleSwitchPlayer,
    onPlacementComplete,
    onFire,
    connectDev,
    isDevModeAvailable,
    playerSwitchPendingRef,
  } = contract;

  // Surface error / success as toasts
  const prevErrorRef = useRef<string | null>(null);
  const prevSuccessRef = useRef<{ message: string; txHash?: string } | null>(null);
  const hasAutoConnectAttempted = useRef(false);

  // Auto-connect dev wallet when on game page so user never sees WalletSwitcher
  useEffect(() => {
    if (!userAddress && !isConnecting && isDevModeAvailable() && !hasAutoConnectAttempted.current) {
      hasAutoConnectAttempted.current = true;
      connectDev(1).catch(() => {});
    }
  }, [userAddress, isConnecting, connectDev, isDevModeAvailable]);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      addToast(error, 'error');
    }
    prevErrorRef.current = error;
  }, [error]);

  useEffect(() => {
    if (success && success !== prevSuccessRef.current) {
      addToast(success.message, 'success', success.txHash);
    }
    prevSuccessRef.current = success;
  }, [success]);

  // Auto-trigger quickstart or load from URL query params
  useEffect(() => {
    if (autoTriggeredRef.current || gamePhase !== 'create') return;
    const mode = searchParams.get('mode');
    if (!mode) return;

    if (mode === 'quickstart' && quickstartAvailable && userAddress) {
      autoTriggeredRef.current = true;
      setSearchParams({}, { replace: true });
      handleQuickstart();
    } else if (mode === 'load') {
      const sid = searchParams.get('session');
      if (sid && userAddress) {
        autoTriggeredRef.current = true;
        pendingAutoLoadRef.current = true;
        setSearchParams({}, { replace: true });
        setLoadSessionId(sid);
      }
    }
  }, [gamePhase, searchParams, quickstartAvailable, userAddress]);

  useEffect(() => {
    if (pendingAutoLoadRef.current && loadSessionId) {
      pendingAutoLoadRef.current = false;
      handleLoadGame();
    }
  }, [loadSessionId]);

  // Sync contract state into 3D when in battle
  useEffect(() => {
    if (playerSwitchPendingRef.current) return;
    const setContractState = initResultRef.current?.setContractState;
    if (!setContractState || gamePhase !== 'battle') return;
    const effectivePendingShot = hasPendingShot || myPendingShot != null;
    const incomingBitmap = gameState && isPlayer1 ? gameState.shots_p2_to_p1 : gameState && isPlayer2 ? gameState.shots_p1_to_p2 : BigInt(0);
    const resolvedShotsOnMyBoard = gameState ? decodeShotBitmap(incomingBitmap) : new Set<string>();
    setContractState({
      phase: 'battle',
      isMyTurn: isMyTurn && !effectivePendingShot,
      hasPendingShot: effectivePendingShot,
      iAmDefender,
      pendingShotX: gameState?.pending_shot_x,
      pendingShotY: gameState?.pending_shot_y,
      myPendingShot,
      resolvedHitsOnMyBoard: contract.resolvedHitsOnMyBoard,
      resolvedShotsOnMyBoard,
      myShotsOnOpponent: contract.myShotsOnOpponent,
    });
  }, [
    gamePhase,
    isMyTurn,
    hasPendingShot,
    iAmDefender,
    myPendingShot,
    gameState,
    isPlayer1,
    isPlayer2,
    contract.resolvedHitsOnMyBoard,
    contract.myShotsOnOpponent,
    contractSyncTrigger,
  ]);

  // Init 3D once when we have a container and we're in placement or battle
  useEffect(() => {
    const container = containerRef.current;
    if (gamePhase !== 'placement' && gamePhase !== 'battle') return;
    if (!container) return;
    if (initResultRef.current) return;

    const result = init(container, {
      contractMode: true,
      callbacks: {
        onPlacementComplete,
        onFire,
      },
    });
    initResultRef.current = result;
  }, [gamePhase]);

  // Dispose 3D when leaving placement/battle
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

  return (
    <div className="game-page">
      <ToastContainer toasts={toasts} />

      {/* 3D canvas fills entire screen */}
      <div ref={containerRef} className="game-3d" />

      {/* Create phase: connect wallet then auto quickstart or show status */}
      {gamePhase === 'create' && (
        <div className="game-loading-overlay">
          {loading ? (
            <>
              <div className="game-loading-spinner" />
              <span>Setting up game...</span>
            </>
          ) : (
            <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
              {userAddress ? 'Starting quickstart...' : 'Connect dev wallet to continue'}
            </span>
          )}
        </div>
      )}

      {/* HUD: top bar */}
      {(gamePhase === 'placement' || gamePhase === 'battle') && (
        <div className="game-hud-top">
          <span className="game-hud-session">Session ID: {sessionId}</span>
          <button
            type="button"
            onClick={handleSwitchPlayer}
            disabled={loading || isConnecting || walletType !== 'dev'}
            className="game-hud-switch"
          >
            {isConnecting ? 'Switching...' : 'Switch Player'}
          </button>
        </div>
      )}

      {/* HUD: bottom-left panels */}
      {(gamePhase === 'placement' || gamePhase === 'battle') && (
        <div className="game-hud-bottom">
          {gamePhase === 'placement' && (
            <PlacementPanel
              gameState={gameState}
              isPlayer1={isPlayer1}
              isPlayer2={isPlayer2}
              haveICommittedBoard={haveICommittedBoard}
              placementFrom3D={placementFrom3D}
              mySalt={mySalt}
              setMySalt={setMySalt}
              loading={loading}
              onCommitBoard={handleCommitBoard}
            />
          )}
          {gamePhase === 'battle' && (
            <BattlePanel
              gameState={gameState}
              isPlayer1={isPlayer1}
              isPlayer2={isPlayer2}
              hasPendingShot={hasPendingShot}
              iAmDefender={iAmDefender}
              isMyTurn={isMyTurn}
              loading={loading}
              myPendingShot={myPendingShot}
              fireStatusLabel={fireStatusLabel}
            />
          )}
        </div>
      )}

      {/* Game over overlay */}
      {gamePhase === 'ended' && gameState && (
        <div className="game-over-overlay">
          <h3>Game Over</h3>
          {gameState.winner != null && gameState.winner !== '' && (
            <p>
              Winner: {gameState.winner.slice(0, 12)}...{gameState.winner.slice(-4)}
              {gameState.winner === userAddress && ' (You!)'}
            </p>
          )}
          <Link to="/" className="mil-btn" style={{ minWidth: 'auto', animationDelay: '0s' }}>
            Back to Menu
          </Link>
        </div>
      )}
    </div>
  );
}
