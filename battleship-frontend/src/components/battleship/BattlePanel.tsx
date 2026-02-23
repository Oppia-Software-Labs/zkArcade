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

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 5)}...${addr.slice(-5)}`;
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
        <div className={isPlayer1 ? 'active' : ''}>
          <div>P1: {gameState.hits_on_p1}H / {popcount(gameState.sunk_ships_on_p1)}S</div>
          <div className="hud-panel-address" title={gameState.player1}>
            {truncateAddress(gameState.player1)}
          </div>
        </div>
        <div className={isPlayer2 ? 'active' : ''}>
          <div>P2: {gameState.hits_on_p2}H / {popcount(gameState.sunk_ships_on_p2)}S</div>
          <div className="hud-panel-address" title={gameState.player2}>
            {truncateAddress(gameState.player2)}
          </div>
        </div>
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

      <div className="hud-legend">
        <div className="hud-legend-title">Legend</div>
        <div className="hud-legend-items">
          <span><span className="hud-legend-swatch" style={{ background: '#2563eb' }} />Water</span>
          <span><span className="hud-legend-swatch" style={{ background: '#16a34a' }} />Ship</span>
          <span><span className="hud-legend-swatch" style={{ background: '#c41e3a' }} />Hit</span>
          <span><span className="hud-legend-swatch" style={{ background: '#6b7280' }} />Miss</span>
          <span><span className="hud-legend-swatch" style={{ background: '#f59e0b' }} />Pending</span>
        </div>
      </div>
    </div>
  );
}
