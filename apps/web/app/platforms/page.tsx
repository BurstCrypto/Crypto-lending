import type { Metadata } from 'next';

import { ProductionPlatformDirectory } from '@/components/platforms/production-platform-directory';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'Platforms',
  description: 'Authenticated directory of planned mainnet lending-platform integrations.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function PlatformsPage() {
  return (
    <main className="page-shell platforms-page-shell">
      <SiteHeader
        activePage="platforms"
        authenticationActions="sign-in"
        signInHref="/login?returnTo=%2Fplatforms"
      />

      <section
        id="main-content"
        className="platforms-introduction"
        aria-labelledby="platforms-page-title"
        tabIndex={-1}
      >
        <div>
          <p className="eyebrow">Lending platforms</p>
          <h1 id="platforms-page-title">See what is planned—and what is available.</h1>
        </div>
        <p>
          Track the Ethereum and Solana protocols being evaluated for a production launch.
          Availability is stated plainly before any action can be offered.
        </p>
      </section>

      <ProductionPlatformDirectory />

      <footer className="site-footer">
        <p>Crypto Lending mainnet platform planning directory</p>
      </footer>
    </main>
  );
}
