import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { WalletLabClient } from './wallet-lab-client';
import { decideWalletLabAccess, readWalletLabAccessConfiguration } from '@/lib/wallets/lab/access';

export const metadata: Metadata = {
  title: 'Restricted wallet validation lab',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function WalletLabPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get('host') ?? 'invalid.local';
  const forwardedProtocol = requestHeaders.get('x-forwarded-proto');
  const protocol = forwardedProtocol?.split(',')[0]?.trim() === 'https' ? 'https:' : 'http:';
  const decision = decideWalletLabAccess({
    authorization: requestHeaders.get('authorization'),
    configuration: readWalletLabAccessConfiguration(process.env),
    forwardedProtocol,
    requestUrl: new URL(`${protocol}//${host}/internal/wallet-lab`),
  });

  if (!decision.allowed) notFound();

  return <WalletLabClient />;
}
