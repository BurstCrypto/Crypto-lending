import type { ReactNode } from 'react';

import { SiteHeader, type SitePage } from '@/components/site-header';

export interface AuthenticationShellProps {
  readonly activePage: Extract<SitePage, 'login' | 'register' | 'account'>;
  readonly authenticationActionHref?: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function AuthenticationShell({
  activePage,
  authenticationActionHref,
  eyebrow,
  title,
  description,
  children,
  footer,
}: AuthenticationShellProps) {
  const authenticationActions = activePage === 'login' ? 'create-account' : 'sign-in';

  return (
    <main className="page-shell authentication-shell">
      <SiteHeader
        activePage={activePage}
        authenticationActions={authenticationActions}
        signInHref={authenticationActionHref}
        createAccountHref={authenticationActionHref}
        createAccountLabel={activePage === 'login' ? 'Create an account' : undefined}
      />

      <div
        id="main-content"
        className="authentication-layout authentication-layout--simple"
        tabIndex={-1}
      >
        <section className="authentication-introduction" aria-labelledby="authentication-title">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="authentication-title">{title}</h1>
          <p className="authentication-description">{description}</p>
          <div className="authentication-assurance" aria-label="Security information">
            <span className="security-label-dot" aria-hidden="true" />
            <p>Your secure session stays out of browser storage.</p>
          </div>
        </section>

        <section className="authentication-card authentication-card--focused">{children}</section>
      </div>

      <footer className="authentication-footer site-footer">
        <p>Crypto Lending platform</p>
        {footer}
      </footer>
    </main>
  );
}
