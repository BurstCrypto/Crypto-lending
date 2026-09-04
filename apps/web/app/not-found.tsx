import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="page-shell portfolio-page-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Crypto Lending home">
          <span className="brand-mark" aria-hidden="true">
            CL
          </span>
          <span>Crypto Lending</span>
        </Link>
      </header>
      <section id="main-content" className="portfolio-state-card">
        <span className="portfolio-state-mark" aria-hidden="true">
          404
        </span>
        <h1>That page is not available.</h1>
        <p>Check the address, or use one of the simple paths below.</p>
        <div className="hero-actions">
          <Link className="primary-action" href="/">
            Go home
          </Link>
          <Link className="secondary-action" href="/login?returnTo=%2Fportfolio">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
