import { HomeSessionActions } from '@/components/authentication/home-session-actions';
import { SiteHeader } from '@/components/site-header';

export default function HomePage() {
  return (
    <main className="page-shell home-page-shell">
      <SiteHeader
        activePage="home"
        signInHref="/login?returnTo=%2Fportfolio"
        createAccountHref="/register?returnTo=%2Fportfolio"
      />

      <div className="hero-grid home-hero-grid">
        <section
          id="main-content"
          className="hero home-hero"
          aria-labelledby="page-title"
          tabIndex={-1}
        >
          <p className="eyebrow">Ethereum and Solana read-only preview</p>
          <h1 id="page-title">
            See how supported balances will be reported—without giving up wallet control.
          </h1>
          <p className="hero-copy">
            Crypto Lending is building one protected workspace for supported Ethereum and Solana
            wallet balances, conservative reporting totals, and source freshness. Live
            provider-backed balance data is not active yet; this rollout focuses on secure account
            access and wallet-ownership verification while your wallet keeps control.
          </p>
          <HomeSessionActions />

          <ul className="home-hero-points" aria-label="Platform highlights">
            <li>Ethereum and Solana scope</li>
            <li>Conservative reporting model</li>
            <li>Ownership-only signatures</li>
          </ul>
        </section>

        <aside className="home-preview-card" aria-labelledby="home-preview-title">
          <div className="home-preview-heading">
            <p className="eyebrow">How it works</p>
            <h2 id="home-preview-title">From secure access to an informed decision.</h2>
          </div>

          <ol className="home-steps">
            <li className="home-step">
              <span aria-hidden="true">01</span>
              <div>
                <h3>Sign in securely</h3>
                <p>Use a managed identity provider to access your private account workspace.</p>
              </div>
            </li>
            <li className="home-step">
              <span aria-hidden="true">02</span>
              <div>
                <h3>Verify your wallet</h3>
                <p>
                  Prove wallet ownership with a message signature that cannot move funds or approve
                  a loan.
                </p>
              </div>
            </li>
            <li className="home-step">
              <span aria-hidden="true">03</span>
              <div>
                <h3>Preview clear reporting</h3>
                <p>
                  See how network and asset totals will expose source coverage and freshness without
                  treating missing data as zero.
                </p>
              </div>
            </li>
          </ol>
        </aside>
      </div>

      <section className="home-purpose" aria-labelledby="home-purpose-title">
        <div className="home-section-heading">
          <div>
            <p className="eyebrow">What we do</p>
            <h2 id="home-purpose-title">Design every reported total to be easier to understand.</h2>
          </div>
          <p>
            Mainnet lending data can be scattered across wallets, networks, and protocols. We are
            building a reporting view that brings the important parts together and shows how each
            figure was formed.
          </p>
        </div>

        <div className="home-benefit-grid">
          <article className="home-benefit-card">
            <span className="home-benefit-number" aria-hidden="true">
              01
            </span>
            <h3>Unify supported balances</h3>
            <p>
              Once approved Ethereum and Solana data sources are active, review supported network
              and asset totals with source coverage and observation freshness.
            </p>
          </article>

          <article className="home-benefit-card">
            <span className="home-benefit-number" aria-hidden="true">
              02
            </span>
            <h3>Understand each reported total</h3>
            <p>
              See when unsupported inputs, missing prices, or stale data make a total partial or
              unavailable instead of treating missing information as zero.
            </p>
          </article>

          <article className="home-benefit-card">
            <span className="home-benefit-number" aria-hidden="true">
              03
            </span>
            <h3>Keep control in your wallet</h3>
            <p>
              Account sign-in and wallet ownership are separate. Neither one can silently approve or
              broadcast a financial transaction.
            </p>
          </article>
        </div>
      </section>

      <section className="home-scope-panel" aria-labelledby="home-scope-title">
        <div>
          <p className="eyebrow">Built for a careful mainnet rollout</p>
          <h2 id="home-scope-title">Review first. Act only when you are ready.</h2>
        </div>
        <p>
          Mainnet reads will only be enabled after approved provider and protocol checks. Financial
          actions will only be enabled after separate value-limit, cost, recovery, and
          emergency-stop controls are reviewed. When enabled, connecting a wallet proves ownership
          only. No financial action is available in this rollout; any future action would require a
          separate wallet confirmation after its network, amount, and estimated costs are shown.
          Portfolio figures are informational and are not financial advice.
        </p>
      </section>

      <footer className="site-footer">
        <p>Crypto Lending platform · Ethereum and Solana, wallet-controlled</p>
      </footer>
    </main>
  );
}
