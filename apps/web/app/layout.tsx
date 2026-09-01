import type { Metadata } from 'next';

import { LocalDemoBanner } from '@/components/local-demo-banner';
import { loadLocalDemoWebConfig } from '@/lib/local-demo/config-server';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Crypto Lending',
    template: '%s | Crypto Lending',
  },
  description:
    'Review supported crypto balances, estimated buying power, and illustrative lending allocations in one clear workspace.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const localDemo = loadLocalDemoWebConfig();

  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <LocalDemoBanner enabled={localDemo.enabled} />
        {children}
      </body>
    </html>
  );
}
