import type { Game } from '../../games/battleship/bindings';

interface PlacementPanelProps {
  gameState: Game | null;
  isPlayer1: boolean;
  isPlayer2: boolean;
  haveICommittedBoard: boolean;
  placementFrom3D: { ship_x: number[]; ship_y: number[]; ship_dir: number[] } | null;
  mySalt: string;
  setMySalt: (v: string) => void;
  loading: boolean;
  onCommitBoard: () => void;
}

export function PlacementPanel({
  gameState,
  isPlayer1,
  isPlayer2,
  haveICommittedBoard,
  placementFrom3D,
  mySalt,
  setMySalt,
  loading,
  onCommitBoard,
}: PlacementPanelProps) {
  if (!gameState) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
            Board: {gameState.board_commitment_p1 != null ? 'Committed' : 'Waiting...'}
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
            Board: {gameState.board_commitment_p2 != null ? 'Committed' : 'Waiting...'}
          </div>
        </div>
      </div>

      {haveICommittedBoard ? (
        <p className="text-sm" style={{ color: '#166534', fontWeight: 600 }}>
          Your board is committed. Waiting for the other player to commit theirs...
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="text-sm text-gray-700">
            Place your 5 ships on the left grid, then commit. Click commit only after all ships are placed.
          </p>
          {placementFrom3D ? (
            <>
              <label className="text-xs font-bold text-gray-600">Salt (optional)</label>
              <input
                type="text"
                value={mySalt}
                onChange={(e) => setMySalt(e.target.value)}
                placeholder="Leave empty for random"
                className="input"
              />
              <button type="button" onClick={onCommitBoard} disabled={loading} className="btn primary">
                {loading ? 'Committing...' : 'Commit Board'}
              </button>
            </>
          ) : (
            <p className="text-sm" style={{ color: '#6b7280' }}>
              Commit Board appears after all ships are placed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
