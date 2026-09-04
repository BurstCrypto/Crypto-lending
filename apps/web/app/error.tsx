'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

export default function ApplicationError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

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
      <section id="main-content" className="portfolio-state-card portfolio-state-error">
        <span className="portfolio-state-mark" aria-hidden="true">
          !
        </span>
        <h1 ref={heading} tabIndex={-1}>
          We could not load this page.
        </h1>
        <p>Your account has not been changed. Try the page again or return home.</p>
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
  );
}
