import Link from 'next/link';
import type { ReactNode } from 'react';

export interface AuthenticationShellProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function AuthenticationShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: AuthenticationShellProps) {
  return (
    <main id="main-content" className="page-shell authentication-shell">
      <header className="site-header authentication-header">
        <Link className="brand" href="/" aria-label="Crypto Lending home">
          <span className="brand-mark" aria-hidden="true">
            CL
          </span>
          <span>Crypto Lending</span>
        </Link>
        <p className="security-label">
          <span className="security-label-dot" aria-hidden="true" />
          Secure account access
        </p>
      </header>

      <div className="authentication-layout">
        <section className="authentication-introduction" aria-labelledby="authentication-title">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="authentication-title">{title}</h1>
          <p className="authentication-description">{description}</p>
          <div className="authentication-assurance" aria-label="Security information">
            <span aria-hidden="true">01</span>
            <p>
              Your session stays in secure, host-only cookies. Crypto Lending never stores an
              account bearer token in browser storage.
            </p>
          </div>
        </section>

        <section className="authentication-card">{children}</section>
      </div>

      <footer className="authentication-footer">
        <p>Crypto Lending platform</p>
        {footer}
      </footer>
    </main>
  );
}
