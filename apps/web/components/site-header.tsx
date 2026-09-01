import Link from 'next/link';

export type SitePage = 'home' | 'portfolio' | 'account' | 'login' | 'register';

export type SiteHeaderAuthenticationActions = 'both' | 'sign-in' | 'create-account' | 'none';

interface SiteHeaderProps {
  readonly activePage: SitePage;
  readonly authenticationActions?: SiteHeaderAuthenticationActions;
  readonly signInHref?: string | undefined;
  readonly createAccountHref?: string | undefined;
  readonly createAccountLabel?: string | undefined;
}

const PRIMARY_LINKS = [
  { page: 'home', href: '/', label: 'Home' },
  { page: 'portfolio', href: '/portfolio', label: 'Portfolio' },
  { page: 'account', href: '/account', label: 'Account' },
] as const;

function isActionVisible(
  action: 'sign-in' | 'create-account',
  actions: SiteHeaderAuthenticationActions,
) {
  return actions === 'both' || actions === action;
}

export function SiteHeader({
  activePage,
  authenticationActions = 'both',
  signInHref = '/login',
  createAccountHref = '/register',
  createAccountLabel = 'Create account',
}: SiteHeaderProps) {
  return (
    <header className="site-header site-header--shared">
      <Link className="brand site-header__brand" href="/" aria-label="Crypto Lending home">
        <span className="brand-mark" aria-hidden="true">
          CL
        </span>
        <span className="brand-name">Crypto Lending</span>
      </Link>

      <div className="site-header__menus">
        <nav className="site-navigation site-navigation--primary" aria-label="Primary">
          {PRIMARY_LINKS.map((link) => (
            <Link
              key={link.page}
              className="navigation-link navigation-button"
              href={link.href}
              aria-current={activePage === link.page ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {authenticationActions !== 'none' ? (
          <nav className="site-navigation site-navigation--account" aria-label="Account actions">
            {isActionVisible('sign-in', authenticationActions) ? (
              <Link
                className="navigation-link navigation-button"
                href={signInHref}
                aria-current={activePage === 'login' ? 'page' : undefined}
              >
                Sign in
              </Link>
            ) : null}
            {isActionVisible('create-account', authenticationActions) ? (
              <Link
                className="navigation-action navigation-button"
                href={createAccountHref}
                aria-current={activePage === 'register' ? 'page' : undefined}
              >
                {createAccountLabel}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </header>
  );
}
