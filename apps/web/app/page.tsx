import Link from 'next/link';

import { HomeSessionActions } from '@/components/authentication/home-session-actions';
import { SiteHeader } from '@/components/site-header';
import { localMainnetConfig } from '@/lib/local-mainnet/config.server';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const localWalletMode = localMainnetConfig() !== null;
  return (
    <main className="page-shell home-page-shell">
      <SiteHeader
        activePage="home"
        localWalletMode={localWalletMode}
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
          <p className="eyebrow">Ethereum and Solana mainnet</p>
          <h1 id="page-title">
            Your stablecoins. Smarter lending.
          </h1>
          <p className="hero-copy">
            Connect an Ethereum wallet, a Solana wallet, or both. Choose your USDC amount and holding period. Smart Lending selects where to lend, and your wallet approves every transaction.
          </p>
          {localWalletMode ? <div className="hero-actions action-group">
            <Link className="primary-action action-button" href="/portfolio#wallets">Connect wallets</Link>
            <Link className="secondary-action action-button" href="/portfolio#lending">Explore Smart Lending</Link>
          </div> : <HomeSessionActions />}

          <ul className="home-hero-points" aria-label="Platform highlights">
            <li>Ethereum and Solana scope</li>
            <li>Automatic lending selection</li>
            <li>Wallet-approved transactions</li>
          </ul>
        </section>

        <aside className="home-preview-card" aria-labelledby="home-preview-title">
          <div className="home-preview-heading">
            <p className="eyebrow">How it works</p>
            <h2 id="home-preview-title">From your wallet to a reviewed deposit.</h2>
          </div>

          <ol className="home-steps">
            <li className="home-step">
              <span aria-hidden="true">01</span>
              <div>
                <h3>{localWalletMode ? 'Connect your wallets' : 'Sign in securely'}</h3>
                <p>{localWalletMode ? 'Choose Ethereum, Solana, or both. Your saved treasury addresses are ready.' : 'Use a managed identity provider to access your private account workspace.'}</p>
              </div>
            </li>
            <li className="home-step">
              <span aria-hidden="true">02</span>
              <div>
                <h3>Let Smart Lending choose</h3>
                <p>
                  Choose the USDC amount and holding period. Smart Lending selects a destination using current rates, available capacity, and estimated costs.
                </p>
              </div>
            </li>
            <li className="home-step">
              <span aria-hidden="true">03</span>
              <div>
                <h3>Review and confirm</h3>
                <p>
                  Review the amount, expected return, receiving wallet, and costs before approving each mainnet transaction in your wallet.
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
            <h2 id="home-purpose-title">Let Smart Lending do the comparison.</h2>
          </div>
          <p>
            Smart Lending checks rates and costs across supported markets, selects the destination,
            and gives you one deposit plan to review.
          </p>
        </div>

        <div className="home-benefit-grid">
          <article className="home-benefit-card">
            <span className="home-benefit-number" aria-hidden="true">
              01
            </span>
            <h3>Unify supported balances</h3>
            <p>
              Check the balances available in each connected wallet, and manage your supported USDC lending positions.
            </p>
          </article>

          <article className="home-benefit-card">
            <span className="home-benefit-number" aria-hidden="true">
              02
            </span>
            <h3>See returns after costs</h3>
            <p>
              See the selected plan’s current supply APY, estimated fees, and projected net earnings for your amount and holding period.
            </p>
          </article>

          <article className="home-benefit-card">
            <span className="home-benefit-number" aria-hidden="true">
              03
            </span>
            <h3>Keep control in your wallet</h3>
            <p>
              Connecting a wallet does not approve spending. Review and sign each transaction in your wallet or on your Ledger.
            </p>
          </article>
        </div>
      </section>

      <section className="home-scope-panel" aria-labelledby="home-scope-title">
        <div>
          <p className="eyebrow">Wallet-controlled lending</p>
          <h2 id="home-scope-title">Review first. Act only when you are ready.</h2>
        </div>
        <p>
          Deposit amounts are bounded by your connected wallet balance and the selected market’s capacity. Direct lending has no platform fee. Bridge fees, network fees, and account rent are shown before you sign. Supply rates and future returns can change.
        </p>
      </section>

      <footer className="site-footer">
        <p>Bonsai Lending platform · Ethereum and Solana, wallet-controlled</p>
      </footer>
    </main>
  );
}
