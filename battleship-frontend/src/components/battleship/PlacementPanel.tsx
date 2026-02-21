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

  const p1Committed = gameState.board_commitment_p1 != null;
  const p2Committed = gameState.board_commitment_p2 != null;

  return (
    <div className="hud-panel">
      <div className="hud-panel-title">Ship Placement</div>

      <div className="hud-panel-scores">
        <span className={isPlayer1 ? 'active' : ''}>
          P1: {p1Committed ? 'READY' : 'PLACING'}
        </span>
        <span className={isPlayer2 ? 'active' : ''}>
          P2: {p2Committed ? 'READY' : 'PLACING'}
        </span>
      </div>

      {haveICommittedBoard ? (
        <div className="hud-panel-status">
          Board committed. <strong>Waiting for opponent...</strong>
        </div>
      ) : (
        <>
          {placementFrom3D ? (
            <>
              <input
                type="text"
                value={mySalt}
                onChange={(e) => setMySalt(e.target.value)}
                placeholder="Salt (optional)"
                className="hud-input"
              />
              <button type="button" onClick={onCommitBoard} disabled={loading} className="hud-btn">
                {loading ? 'Committing...' : 'Commit Board'}
              </button>
            </>
          ) : (
            <div className="hud-panel-status">
              Place all 5 ships on your grid, then commit.
            </div>
          )}
        </>
      )}
    </div>
  );
}
