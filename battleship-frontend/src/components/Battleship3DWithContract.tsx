import { useRef, useEffect } from 'react';
import { Link } from 'react-router';
import { Layout } from './Layout';
import { init } from '../battleship3d/main';
import { useBattleshipContract } from './battleship/useBattleshipContract';
import { CreateSessionPanel } from './battleship/CreateSessionPanel';
import { PlacementPanel } from './battleship/PlacementPanel';
import { BattlePanel } from './battleship/BattlePanel';

export function Battleship3DWithContract() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initResultRef = useRef<ReturnType<typeof init> | null>(null);

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
    loadGameState,
    handleQuickstart,
    handleLoadGame,
    handleCommitBoard,
    handleSwitchPlayer,
    onPlacementComplete,
    onFire,
    playerSwitchPendingRef,
  } = contract;

  // Sync contract state into 3D when in battle
  useEffect(() => {
    if (playerSwitchPendingRef.current) return;
    const setContractState = initResultRef.current?.setContractState;
    if (!setContractState || gamePhase !== 'battle') return;
    const effectivePendingShot = hasPendingShot || myPendingShot != null;
    setContractState({
      phase: 'battle',
      isMyTurn: isMyTurn && !effectivePendingShot,
      hasPendingShot: effectivePendingShot,
      iAmDefender,
      pendingShotX: gameState?.pending_shot_x,
      pendingShotY: gameState?.pending_shot_y,
      myPendingShot,
      resolvedHitsOnMyBoard: contract.resolvedHitsOnMyBoard,
      myShotsOnOpponent: contract.myShotsOnOpponent,
    });
  }, [
    gamePhase,
    isMyTurn,
    hasPendingShot,
    iAmDefender,
    myPendingShot,
    gameState?.pending_shot_x,
    gameState?.pending_shot_y,
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
    <Layout title="Battleship 3D" subtitle="Two-player on-chain">
      <div className="studio-main" style={{ display: 'flex', flexDirection: 'column', minHeight: '60vh' }}>
        {error && (
          <div className="notice error" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}
        {success && (
          <div className="notice info" style={{ marginBottom: 8 }}>
            {success.message}
            {success.txHash && (
              <>
                {' '}
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${success.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', textDecoration: 'underline', fontWeight: 600 }}
                >
                  View on Stellar Expert
                </a>
              </>
            )}
          </div>
        )}

        {gamePhase === 'create' && (
          <CreateSessionPanel
            userAddress={userAddress}
            quickstartAvailable={quickstartAvailable}
            loading={loading}
            loadSessionId={loadSessionId}
            setLoadSessionId={setLoadSessionId}
            onQuickstart={handleQuickstart}
            onLoadGame={handleLoadGame}
          />
        )}

        {(gamePhase === 'placement' || gamePhase === 'battle') && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Session {sessionId}</span>
              <button
                type="button"
                onClick={handleSwitchPlayer}
                disabled={loading || isConnecting || walletType !== 'dev'}
                className="btn secondary"
              >
                {isConnecting ? 'Switching...' : 'Switch Player'}
              </button>
            </div>
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
