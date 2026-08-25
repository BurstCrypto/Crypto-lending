import type { Metadata } from 'next';
import Link from 'next/link';

import { LocalDemoPortfolio } from '@/components/portfolio/local-demo-portfolio';
import { loadLocalDemoWebConfig } from '@/lib/local-demo/config-server';

export const metadata: Metadata = {
  title: 'Portfolio',
  description: 'Authenticated synthetic wallet and portfolio demonstration.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function PortfolioPage() {
  const localDemo = loadLocalDemoWebConfig();
  return (
    <main id="main-content" className="page-shell portfolio-page-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Crypto Lending home">
          <span className="brand-mark" aria-hidden="true">
            CL
          </span>
          <span>Crypto Lending</span>
        </Link>
        <nav className="site-navigation" aria-label="Portfolio">
          <Link href="/">Home</Link>
          <Link className="navigation-action" href="/account">
            Account
          </Link>
        </nav>
      </header>

      <LocalDemoPortfolio enabled={localDemo.enabled} />

      <footer>
        <p>Crypto Lending synthetic local portfolio</p>
      </footer>
    </main>
  );
}
