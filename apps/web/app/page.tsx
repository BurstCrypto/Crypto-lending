import Link from 'next/link';

import { ServiceStatus } from '@/components/service-status';
import { SiteHeader } from '@/components/site-header';
import { getApplicationEnvironment, getApplicationVersion } from '@/lib/application';

// APP_ENV and APP_VERSION are injected when the production container starts,
// so this page must not freeze build-host values into the image.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <main id="main-content" className="page-shell home-page-shell">
      <SiteHeader activePage="home" />

      <div className="hero-grid home-hero-grid">
        <section className="hero home-hero" aria-labelledby="page-title">
          <p className="eyebrow">Simple by design</p>
          <h1 id="page-title">Crypto lending, made clear.</h1>
          <p className="hero-copy">
            Review balances, understand buying power, and explore lending opportunities without
            digging through complicated menus.
          </p>
          <div className="hero-actions action-group">
            <Link className="primary-action action-button" href="/portfolio">
              View your portfolio
            </Link>
            <Link className="secondary-action action-button" href="/register">
              Create an account
            </Link>
          </div>
        </section>

        <ServiceStatus
          environment={getApplicationEnvironment()}
          version={getApplicationVersion()}
        />
      </div>

      <section className="next-steps" aria-labelledby="next-steps-title">
        <div className="section-heading">
          <p className="eyebrow">Three simple steps</p>
          <h2 id="next-steps-title">Choose what you want to do next.</h2>
        </div>

        <div className="next-step-grid">
          <article className="next-step-card">
            <span className="next-step-number" aria-hidden="true">
              01
            </span>
            <h3>Open your portfolio</h3>
            <p>Start in one clear workspace and see which portfolio features are available.</p>
            <Link className="card-action action-button" href="/portfolio">
              Open portfolio <span aria-hidden="true">&rarr;</span>
            </Link>
          </article>

          <article className="next-step-card">
            <span className="next-step-number" aria-hidden="true">
              02
            </span>
            <h3>Check your balances</h3>
            <p>See portfolio value and available buying power without hidden assumptions.</p>
            <Link className="card-action action-button" href="/portfolio">
              Review balances <span aria-hidden="true">&rarr;</span>
            </Link>
          </article>

          <article className="next-step-card">
            <span className="next-step-number" aria-hidden="true">
              03
            </span>
            <h3>Explore opportunities</h3>
            <p>Compare a straightforward lending preview before you approve anything.</p>
            <Link className="card-action action-button" href="/portfolio">
              View opportunities <span aria-hidden="true">&rarr;</span>
            </Link>
          </article>
        </div>
      </section>

      <footer className="site-footer">
        <p>Crypto Lending platform</p>
      </footer>
    </main>
  );
}
