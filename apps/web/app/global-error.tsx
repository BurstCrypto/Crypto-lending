'use client';

import Link from 'next/link';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="page-shell portfolio-page-shell">
          <section id="main-content" className="portfolio-state-card portfolio-state-error">
            <span className="portfolio-state-mark" aria-hidden="true">
              !
            </span>
            <h1>Crypto Lending is temporarily unavailable.</h1>
            <p>No wallet or financial action was submitted. Retry, or return to the home page.</p>
            <div className="hero-actions">
              <button className="primary-action" type="button" onClick={reset}>
                Try again
              </button>
              <Link className="secondary-action" href="/">
                Go home
              </Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
