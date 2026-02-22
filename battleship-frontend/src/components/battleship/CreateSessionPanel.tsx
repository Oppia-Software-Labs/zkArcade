interface CreateSessionPanelProps {
  userAddress: string;
  quickstartAvailable: boolean;
  loading: boolean;
  loadSessionId: string;
  setLoadSessionId: (v: string) => void;
  onQuickstart: () => void;
  onLoadGame: () => void;
}

export function CreateSessionPanel({
  userAddress,
  quickstartAvailable,
  loading,
  loadSessionId,
  setLoadSessionId,
  onQuickstart,
  onLoadGame,
}: CreateSessionPanelProps) {
  return (
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
            onClick={onQuickstart}
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
          <button type="button" onClick={onLoadGame} disabled={loading || !userAddress} className="btn secondary">
            Load game
          </button>
        </div>
      </div>
    </div>
  );
}
