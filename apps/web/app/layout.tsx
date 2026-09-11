import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Bonsai Lending',
    template: '%s | Bonsai Lending',
  },
  description:
    'Preview a protected Ethereum and Solana workspace for wallet ownership and conservative, source-attributed portfolio reporting.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
