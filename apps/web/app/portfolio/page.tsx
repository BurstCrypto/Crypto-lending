import type { Metadata } from 'next';

import { LocalDemoPortfolio } from '@/components/portfolio/local-demo-portfolio';
import { SiteHeader } from '@/components/site-header';
import { loadLocalDemoWebConfig } from '@/lib/local-demo/config-server';

export const metadata: Metadata = {
  title: 'Portfolio',
  description: 'Authenticated synthetic wallet and portfolio demonstration.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function PortfolioPage() {
  const localDemo = loadLocalDemoWebConfig();
  return (
    <main id="main-content" className="page-shell portfolio-page-shell">
      <SiteHeader
        activePage="portfolio"
        authenticationActions="sign-in"
        signInHref="/login?returnTo=%2Fportfolio"
      />

      <section
        className="portfolio-introduction portfolio-intro"
        aria-labelledby="portfolio-page-title"
      >
        <div className="portfolio-introduction__copy">
          <p className="eyebrow">Your portfolio</p>
          <h1 id="portfolio-page-title" className="portfolio-introduction__title">
            Everything important, in one clear view.
          </h1>
          <p className="portfolio-introduction__description">
            {localDemo.enabled
              ? 'Start with your demo wallets, confirm what is available, then review opportunities when you are ready.'
              : 'Review the current portfolio status and return whenever the demo experience is available.'}
          </p>
        </div>

        <nav
          className="portfolio-jump-navigation portfolio-jump-nav"
          aria-label="Jump to portfolio sections"
        >
          {localDemo.enabled ? (
            <a className="portfolio-jump-link navigation-button" href="#wallets">
              Demo wallets
            </a>
          ) : null}
          <a className="portfolio-jump-link navigation-button" href="#balances">
            Balances
          </a>
          {localDemo.enabled ? (
            <a className="portfolio-jump-link navigation-button" href="#opportunities">
              Opportunities
            </a>
          ) : null}
        </nav>
      </section>

      <LocalDemoPortfolio enabled={localDemo.enabled} />

      <footer className="site-footer">
        <p>Crypto Lending synthetic local portfolio</p>
      </footer>
    </main>
  );
}
