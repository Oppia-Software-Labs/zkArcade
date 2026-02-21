import type { Game } from '../../games/battleship/bindings';

function popcount(n: number | bigint): number {
  let v = Number(n) >>> 0;
  let c = 0;
  while (v) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}

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

  let statusText = '';
  if (hasPendingShot && iAmDefender) {
    statusText = loading ? 'Generating ZK proof & resolving...' : 'Auto-resolving incoming shot...';
  } else if (hasPendingShot && !iAmDefender) {
    statusText = 'Shot submitted. Switch wallets to resolve as defender.';
  } else if (!hasPendingShot && isMyTurn) {
    statusText = 'Your turn — click opponent grid to fire.';
  } else if (!hasPendingShot && !isMyTurn && (isPlayer1 || isPlayer2)) {
    statusText = "Opponent's turn. Switch wallets to play as the other player.";
  }

  return (
    <div className="hud-panel">
      <div className="hud-panel-title">Battle</div>

      <div className="hud-panel-scores">
        <span className={isPlayer1 ? 'active' : ''}>
          P1: {gameState.hits_on_p1}H / {popcount(gameState.sunk_ships_on_p1)}S
        </span>
        <span className={isPlayer2 ? 'active' : ''}>
          P2: {gameState.hits_on_p2}H / {popcount(gameState.sunk_ships_on_p2)}S
        </span>
      </div>

      {statusText && (
        <div className="hud-panel-status">{statusText}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono, monospace)' }}>
          {myPendingShot ? `TARGET (${myPendingShot.x},${myPendingShot.y})` : 'NO TARGET'}
        </span>
        <span className="hud-btn hud-btn-secondary" style={{ cursor: 'default', fontSize: '0.65rem' }}>
          {fireStatusLabel}
        </span>
      </div>
    </div>
  );
}
