import type { Metadata } from 'next';
import Link from 'next/link';

import { UnifiedBalanceView } from '@/components/portfolio/unified-balance-view';
import { UNIFIED_BALANCE_DEMO_PAYLOAD } from '@/lib/portfolio/unified-balance.fixtures';
import { parseUnifiedBalanceResponse } from '@/lib/portfolio/unified-balance';

export const metadata: Metadata = {
  title: 'Sample portfolio preview',
  description: 'A local preview of unified portfolio value and available buying power.',
  robots: { index: false, follow: false },
};

const DEMO_SNAPSHOT = parseUnifiedBalanceResponse(UNIFIED_BALANCE_DEMO_PAYLOAD);

export default function PortfolioPage() {
  return (
    <main id="main-content" className="page-shell portfolio-page-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Crypto Lending home">
          <span className="brand-mark" aria-hidden="true">
            CL
          </span>
          <span>Crypto Lending</span>
        </Link>
        <nav className="site-navigation" aria-label="Portfolio preview">
          <Link href="/">Home</Link>
          <Link className="navigation-action" href="/register">
            Create account
          </Link>
        </nav>
      </header>

      <aside className="portfolio-preview-notice" aria-label="Local preview notice">
        <span className="portfolio-preview-badge">Sample data</span>
        <p>Deterministic local preview - not live wallet data, a quote, or available credit.</p>
      </aside>

      <UnifiedBalanceView state={{ status: 'READY', snapshot: DEMO_SNAPSHOT }} />

      <footer>
        <p>Crypto Lending portfolio preview</p>
      </footer>
    </main>
  );
}
