import type { Metadata } from 'next';

import { ProductionPortfolio } from '@/components/portfolio/production-portfolio';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'Portfolio',
  description: 'Authenticated portfolio reporting and source-freshness workspace.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function PortfolioPage() {
  return (
    <main className="page-shell portfolio-page-shell">
      <SiteHeader
        activePage="portfolio"
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
            Preview conservative Ethereum and Solana reporting, source attribution, and freshness
            while approved live-data providers remain pending.
          </p>
        </div>
      </section>

      <ProductionPortfolio />

      <footer className="site-footer">
        <p>Bonsai Lending multi-chain mainnet read-only preview</p>
      </footer>
    </main>
  );
}
