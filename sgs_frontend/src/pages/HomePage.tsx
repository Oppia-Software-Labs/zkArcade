import { useWallet } from '@/hooks/useWallet';
import type { Page } from '../types/navigation';
import '../components/GamesCatalog.css';

interface HomePageProps {
  onNavigate: (page: Page) => void;
}

export function HomePage({ onNavigate }: HomePageProps) {
  const { isConnected, isConnecting, error } = useWallet();

  return (
    <div className="studio-home">
      <section className="hero">
        <div className="hero-content">
          <h2>Development Tools For Web3 Game Builders On Stellar</h2>
          <p>
            Ecosystem ready game templates and examples ready to scaffold into into your development workflow
          </p>
          <div className="hero-actions">
            <button type="button" onClick={() => onNavigate('games')}>
              Explore Games
            </button>
            <button type="button" className="btn-secondary" onClick={() => onNavigate('docs')}>
              Open Docs
            </button>
            <a
              className="button btn-secondary"
              href="https://github.com/jamesbachini/Stellar-Game-Studio"
              target="_blank"
              rel="noreferrer"
            >
              Fork on GitHub
            </a>
          </div>
        </div>
        <div className="hero-panel">
          <div className="panel-title">Dev-to-Publish Pipeline</div>
          <ol className="panel-steps">
            <li>Fork and clone the repo</li>
            <li>Deploy contracts to testnet</li>
            <li>Build the standalone game frontend</li>
            <li>Publish with a production wallet flow</li>
          </ol>
          <pre>
            <code>{`bun run setup\nbun run create my-game\nbun run dev:game my-game\nbun run publish my-game --build`}</code>
          </pre>
        </div>
      </section>

      {!isConnected && (
        <div className="card wallet-banner">
          {error ? (
            <>
              <h3>Wallet Connection Error</h3>
              <p>{error}</p>
            </>
          ) : (
              <>
              <h3>{isConnecting ? 'Connecting...' : 'Connect a Dev Wallet'}</h3>
              <p>Use the switcher above to auto-connect and swap between demo players.</p>
            </>
          )}
        </div>
      )}

      <section id="quickstart" className="quickstart-section">
        <div className="section-header">
          <h3>Quickstart</h3>
          <p>Deploy contracts, generate bindings, and start the studio frontend in minutes.</p>
        </div>
        <div className="quickstart-grid">
          <div className="quickstart-card">
            <h4>1. Fork Repository</h4>
            <p>Fork and clone the Stellar Game Studio repo.</p>
            <code className="code-compact">git clone https://github.com/jamesbachini/Stellar-Game-Studio</code>
          </div>
          <div className="quickstart-card">
            <h4>2. Setup</h4>
            <p>Install dependencies, build, and deploy contracts.</p>
            <code>bun run setup</code>
          </div>
          <div className="quickstart-card">
            <h4>3. Build The Game</h4>
            <p>Export a standalone build for your new game.</p>
            <code>bun run publish my-game</code>
          </div>
        </div>
      </section>

      <section id="commands" className="commands-section">
        <div className="section-header">
          <h3>Bun Commands</h3>
          <p>Automate contracts, bindings, and standalone builds.</p>
        </div>
        <div className="commands-grid">
          <div className="command-card">
            <h4>All-in-one setup</h4>
            <p>Build contracts, deploy to testnet, generate bindings, and start the studio.</p>
            <code>bun run setup</code>
          </div>
          <div className="command-card">
            <h4>Contracts only</h4>
            <p>Build all Soroban contracts or a single game.</p>
            <code>bun run build my-game</code>
          </div>
          <div className="command-card">
            <h4>Deploy + IDs</h4>
            <p>Deploy contracts to testnet (all or one) and write contract IDs.</p>
            <code>bun run deploy my-game</code>
          </div>
          <div className="command-card">
            <h4>Generate bindings</h4>
            <p>Create TypeScript bindings for all or one contract.</p>
            <code>bun run bindings my-game</code>
          </div>
          <div className="command-card">
            <h4>Create a game</h4>
            <p>Scaffold a new contract and standalone frontend.</p>
            <code>bun run create my-game</code>
          </div>
          <div className="command-card">
            <h4>Publish frontend</h4>
            <p>Export a standalone build for hosting.</p>
            <code>bun run publish my-game</code>
          </div>
        </div>
      </section>

    </div>
  );
}
