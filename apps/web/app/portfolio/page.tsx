import type { Metadata } from 'next';

import { SiteHeader } from '@/components/site-header';
import { MainnetWorkspace } from '@/components/mainnet/workspace';
import { localMainnetConfig } from '@/lib/local-mainnet/config.server';

export const metadata: Metadata = {
  title: 'Portfolio',
  description: 'Your wallets, balances, and automatic USDC lending on Ethereum and Solana.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function PortfolioPage() {
  const localWalletMode = localMainnetConfig() !== null;
  return (
    <main className="page-shell portfolio-page-shell">
      <SiteHeader
        activePage="portfolio"
        localWalletMode={localWalletMode}
        authenticationActions="sign-in"
        signInHref="/login?returnTo=%2Fportfolio"
      />

      <section
        id="main-content"
        className="portfolio-introduction portfolio-intro"
        aria-labelledby="portfolio-page-title"
        tabIndex={-1}
      >
        <div className="portfolio-introduction__copy">
          <p className="eyebrow">Your portfolio</p>
          <h1 id="portfolio-page-title" className="portfolio-introduction__title">
            Your supported balances, in one clear view.
          </h1>
          <p className="portfolio-introduction__description">
            Connect your wallet, choose how much USDC to lend, and let Smart Lending select the destination. Manage your deposits and withdrawals here.
          </p>
        </div>
      </section>

      <MainnetWorkspace />

      <footer className="site-footer">
        <p>Bonsai Lending · Ethereum and Solana mainnet</p>
      </footer>
    </main>
  );
}
