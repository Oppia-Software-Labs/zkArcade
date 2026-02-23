import { WalletSwitcher } from './WalletSwitcher';

interface LayoutProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Layout({ title, subtitle, children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-[#121213]">
      <header className="border-b border-white/10 py-4">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-4 px-4">
          <div className="text-center sm:text-left">
            <h1 className="text-2xl font-bold tracking-wider text-white">
              {title ?? 'Wordle'}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
            )}
          </div>
          <div className="ml-auto">
            <WalletSwitcher />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8">{children}</main>
      <footer className="border-t border-white/10 py-4 text-center text-xs text-gray-500">
        Stellar · Wordle on-chain
      </footer>
    </div>
  );
}
