import Link from 'next/link';

import { ServiceStatus } from '@/components/service-status';
import { getApplicationEnvironment, getApplicationVersion } from '@/lib/application';

// APP_ENV and APP_VERSION are injected when the production container starts,
// so this page must not freeze build-host values into the image.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <main id="main-content" className="page-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Crypto Lending home">
          <span className="brand-mark" aria-hidden="true">
            CL
          </span>
          <span>Crypto Lending</span>
        </Link>
        <p className="foundation-label">Platform foundation</p>
      </header>

      <div className="hero-grid">
        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">Lending infrastructure</p>
          <h1 id="page-title">Built for a clearer way to borrow and lend.</h1>
          <p className="hero-copy">
            The web foundation is running. Secure account, collateral, and lending experiences will
            land here as the platform grows.
          </p>
        </section>

        <ServiceStatus
          environment={getApplicationEnvironment()}
          version={getApplicationVersion()}
        />
      </div>

      <footer>
        <p>Crypto Lending platform</p>
      </footer>
    </main>
  );
}
