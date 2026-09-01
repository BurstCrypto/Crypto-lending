import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';

export default function HomePage() {
  return (
    <main id="main-content" className="page-shell home-page-shell">
      <SiteHeader activePage="home" />

      <div className="hero-grid home-hero-grid">
        <section className="hero home-hero" aria-labelledby="page-title">
          <p className="eyebrow">Crypto lending, explained clearly</p>
          <h1 id="page-title">Understand your portfolio before you borrow or lend.</h1>
          <p className="hero-copy">
            Crypto Lending brings supported balances, estimated buying power, and illustrative
            lending allocations into one focused view. Trace where the numbers come from and review
            the context before deciding what to do next.
          </p>
          <div className="hero-actions action-group">
            <Link className="primary-action action-button" href="/portfolio">
              View portfolio
            </Link>
            <Link className="secondary-action action-button" href="/register">
              Create an account
            </Link>
          </div>

          <ul className="home-hero-points" aria-label="Platform highlights">
            <li>Traceable balances</li>
            <li>Clear estimates</li>
            <li>Demo and testnet labels</li>
          </ul>
        </section>

        <aside className="home-preview-card" aria-labelledby="home-preview-title">
          <div className="home-preview-heading">
            <p className="eyebrow">How the preview works</p>
            <h2 id="home-preview-title">From balances to a lending estimate.</h2>
          </div>

          <ol className="home-steps">
            <li className="home-step">
              <span aria-hidden="true">01</span>
              <div>
                <h3>Review supported positions</h3>
                <p>See wallet, network, asset, and freshness details in one portfolio view.</p>
              </div>
            </li>
            <li className="home-step">
              <span aria-hidden="true">02</span>
              <div>
                <h3>Separate value from buying power</h3>
                <p>Understand which inputs are included and why an estimate may be lower.</p>
              </div>
            </li>
            <li className="home-step">
              <span aria-hidden="true">03</span>
              <div>
                <h3>Preview an allocation</h3>
                <p>Explore modeled rates, fees, and liquidity settings before any next step.</p>
              </div>
            </li>
          </ol>
        </aside>
      </div>

      <section className="home-purpose" aria-labelledby="home-purpose-title">
        <div className="home-section-heading">
          <div>
            <p className="eyebrow">What we do</p>
            <h2 id="home-purpose-title">Make every estimate easier to understand.</h2>
          </div>
          <p>
            Crypto lending data can be scattered across wallets, networks, and protocols. We bring
            the important parts together and show how each figure was formed.
          </p>
        </div>

        <div className="home-benefit-grid">
          <article className="home-benefit-card">
            <span className="home-benefit-number" aria-hidden="true">
              01
            </span>
            <h3>Trace what is included</h3>
            <p>
              Inspect the wallet, network, asset, source, and observation time behind a balance.
            </p>
          </article>

          <article className="home-benefit-card">
            <span className="home-benefit-number" aria-hidden="true">
              02
            </span>
            <h3>See why buying power changes</h3>
            <p>
              Keep portfolio value separate from estimates that account for known deductions,
              unsupported inputs, or stale data.
            </p>
          </article>

          <article className="home-benefit-card">
            <span className="home-benefit-number" aria-hidden="true">
              03
            </span>
            <h3>Explore without real funds</h3>
            <p>
              Try illustrative allocations with synthetic data before any separately labeled
              public-testnet action.
            </p>
          </article>
        </div>
      </section>

      <section className="home-scope-panel" aria-labelledby="home-scope-title">
        <div>
          <p className="eyebrow">Built for informed exploration</p>
          <h2 id="home-scope-title">Review first. Act only when you are ready.</h2>
        </div>
        <p>
          Local balances, prices, rates, and allocation results are synthetic or locally cached
          estimates. Optional public-testnet actions are labeled separately and use test assets. The
          preview does not assess risk or make a financial recommendation.
        </p>
        <Link className="secondary-action action-button" href="/portfolio">
          Open the portfolio workspace
        </Link>
      </section>

      <footer className="site-footer">
        <p>Crypto Lending platform</p>
      </footer>
    </main>
  );
}
