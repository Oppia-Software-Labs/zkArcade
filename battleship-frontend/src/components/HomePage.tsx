import { useState } from 'react';
import { useNavigate } from 'react-router';

export function HomePage() {
  const navigate = useNavigate();
  const [showLoadInput, setShowLoadInput] = useState(false);
  const [sessionInput, setSessionInput] = useState('');

  const handleLoadGo = () => {
    const trimmed = sessionInput.trim();
    if (!trimmed) return;
    navigate(`/game?mode=load&session=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="home-page">
      <div className="home-bg-glow home-bg-glow-1" />
      <div className="home-bg-glow home-bg-glow-2" />

      <div className="home-content">
        <img
          src="/zkBattleship_logo.svg"
          alt="zkBattleship"
          className="home-logo"
        />

        <div className="home-buttons">
          <button
            onClick={() => navigate('/game?mode=quickstart')}
            className="mil-btn mil-btn-delay-1"
          >
            New Game
            <span className="mil-btn-sub">dev wallets, testnet</span>
          </button>

          {!showLoadInput ? (
            <button
              onClick={() => setShowLoadInput(true)}
              className="mil-btn mil-btn-delay-2"
            >
              Load Game
            </button>
          ) : (
            <div className="home-load-row">
              <input
                type="text"
                value={sessionInput}
                onChange={(e) => setSessionInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoadGo()}
                placeholder="Session ID"
                className="home-load-input"
                autoFocus
              />
              <button onClick={handleLoadGo} className="home-load-go">
                Go
              </button>
            </div>
          )}

          <button
            onClick={() => {}}
            className="mil-btn mil-btn-delay-3"
            style={{ opacity: 0.5, cursor: 'not-allowed' }}
          >
            Jump Into Game
            <span className="mil-btn-sub">coming soon</span>
          </button>
        </div>
      </div>
    </div>
  );
}
