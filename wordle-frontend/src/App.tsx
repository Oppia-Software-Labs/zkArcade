import { Toaster } from 'sileo';
import { Layout } from '@/components/Layout';
import { WordleGame } from '@/wordle/WordleGame';
import { config } from '@/config';
import { useWallet } from '@/hooks/useWallet';
import { DevWalletService } from '@/services/devWalletService';

const GAME_TITLE = import.meta.env.VITE_GAME_TITLE ?? 'Wordchain';
const GAME_TAGLINE = import.meta.env.VITE_GAME_TAGLINE ?? '5 letters, 6 tries · On-chain on Stellar';

function HomePage() {
  const { publicKey, isConnected, isConnecting, error: walletError } = useWallet();

  const player1Address = config.devPlayer1Address || import.meta.env.VITE_DEV_PLAYER1_ADDRESS || '';
  const player2Address = config.devPlayer2Address || import.meta.env.VITE_DEV_PLAYER2_ADDRESS || '';
  const hasDevAddresses = !!(player1Address && player2Address);
  const devModeAvailable = DevWalletService.isDevModeAvailable();

  if (!devModeAvailable && !hasDevAddresses) {
    return (
      <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
        <div className="rounded-2xl bg-white/10 p-6 text-center text-gray-300">
          <p>
            Set <code className="rounded bg-white/10 px-1">VITE_DEV_PLAYER1_SECRET</code>,{' '}
            <code className="rounded bg-white/10 px-1">VITE_DEV_PLAYER2_SECRET</code>, and addresses in the repo root{' '}
            <code className="rounded bg-white/10 px-1">.env</code> (or run{' '}
            <code className="rounded bg-white/10 px-1">bun run setup</code>), then reload.
          </p>
        </div>
      </Layout>
    );
  }

  if (!isConnected && !isConnecting) {
    return (
      <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
        <div className="rounded-2xl bg-white/10 p-6 text-center text-gray-300">
          Connecting wallet…
        </div>
      </Layout>
    );
  }

  if (walletError && !isConnected) {
    return (
      <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
        <div className="rounded-2xl bg-red-500/20 p-6 text-center text-red-200">
          <p>{walletError}</p>
        </div>
      </Layout>
    );
  }

  if (!publicKey) {
    return (
      <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
        <div className="rounded-2xl bg-white/10 p-6 text-center text-gray-300">
          No wallet connected. Use the header to connect.
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
      <div className="space-y-4">
        <WordleGame
          userAddress={publicKey}
          player1Address={player1Address || undefined}
          player2Address={player2Address || undefined}
        />
      </div>
    </Layout>
  );
}

export default function App() {
  return (
    <>
      <Toaster position="top-right" />
      <HomePage />
    </>
  );
}
