import type { Metadata } from 'next';

import { LocalDemoPortfolio } from '@/components/portfolio/local-demo-portfolio';
import { ProductionPortfolio } from '@/components/portfolio/production-portfolio';
import { SiteHeader } from '@/components/site-header';
import { loadLocalDemoWebConfig } from '@/lib/local-demo/config-server';

export const metadata: Metadata = {
  title: 'Portfolio',
  description: 'Authenticated portfolio reporting and source-freshness workspace.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function PortfolioPage() {
  const localDemo = loadLocalDemoWebConfig();

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
            {localDemo.enabled
              ? 'Your isolated demo balances, in one clear view.'
              : 'Your supported balances, in one clear view.'}
          </h1>
          <p className="portfolio-introduction__description">
            {localDemo.enabled
              ? 'Exercise synthetic wallets and portfolio reporting inside the guarded loopback-only regression harness.'
              : 'Preview conservative Ethereum, Base, and Solana reporting, source attribution, and freshness while approved live-data providers remain pending.'}
          </p>
        </div>
      </section>

      {localDemo.enabled ? <LocalDemoPortfolio enabled /> : <ProductionPortfolio />}

      <footer className="site-footer">
        <p>
          {localDemo.enabled
            ? 'Crypto Lending isolated synthetic regression harness'
            : 'Crypto Lending multi-chain mainnet read-only preview'}
        </p>
      </footer>
    </main>
  );
}
