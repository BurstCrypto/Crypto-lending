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
    'Preview a protected Base mainnet workspace for wallet ownership and conservative, source-attributed portfolio reporting.',
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
