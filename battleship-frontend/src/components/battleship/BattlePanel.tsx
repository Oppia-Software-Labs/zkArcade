import type { Game } from '../../games/battleship/bindings';

interface BattlePanelProps {
  gameState: Game | null;
  isPlayer1: boolean;
  isPlayer2: boolean;
  hasPendingShot: boolean;
  iAmDefender: boolean;
  isMyTurn: boolean;
  loading: boolean;
  myPendingShot: { x: number; y: number } | null;
  fireStatusLabel: string;
}

export function BattlePanel({
  gameState,
  isPlayer1,
  isPlayer2,
  hasPendingShot,
  iAmDefender,
  isMyTurn,
  loading,
  myPendingShot,
  fireStatusLabel,
}: BattlePanelProps) {
  if (!gameState) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <div
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 8,
              border: `2px solid ${isPlayer1 ? '#a78bfa' : '#e5e7eb'}`,
              background: isPlayer1 ? '#f5f3ff' : '#fff',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Player 1</div>
            <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
              {gameState.player1.slice(0, 8)}...{gameState.player1.slice(-4)}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              Hits: {gameState.hits_on_p1} &middot; Sunk: {gameState.sunk_ships_on_p1}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 8,
              border: `2px solid ${isPlayer2 ? '#a78bfa' : '#e5e7eb'}`,
              background: isPlayer2 ? '#f5f3ff' : '#fff',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>Player 2</div>
            <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
              {gameState.player2.slice(0, 8)}...{gameState.player2.slice(-4)}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              Hits: {gameState.hits_on_p2} &middot; Sunk: {gameState.sunk_ships_on_p2}
            </div>
          </div>
        </div>

        {hasPendingShot && iAmDefender && (
          <p className="text-sm" style={{ color: '#92400e', fontWeight: 600 }}>
            {loading ? 'Generating ZK proof & resolving...' : 'Auto-resolving incoming shot...'}
          </p>
        )}
        {hasPendingShot && !iAmDefender && (
          <p className="text-sm" style={{ color: '#1d4ed8' }}>
            Shot submitted. Switch wallets to resolve as defender.
          </p>
        )}
        {!hasPendingShot && isMyTurn && (
          <p className="text-sm" style={{ color: '#1d4ed8', fontWeight: 600 }}>
            Your turn — click the opponent&apos;s grid (right) to fire.
          </p>
        )}
        {!hasPendingShot && !isMyTurn && (isPlayer1 || isPlayer2) && (
          <p className="text-sm" style={{ color: '#6b7280' }}>
            Opponent&apos;s turn. Switch wallets to play as the other player.
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', marginTop: 2 }}>
          <div style={{ fontSize: 12, color: '#4b5563' }}>
            {myPendingShot
              ? `Selected target: (${myPendingShot.x}, ${myPendingShot.y})`
              : 'No target selected yet. Fire by clicking a tile on opponent grid.'}
          </div>
          <button type="button" className="btn secondary" disabled style={{ opacity: 0.9 }}>
            {fireStatusLabel}
          </button>
        </div>
    </div>
  );
}
