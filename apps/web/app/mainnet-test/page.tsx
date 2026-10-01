import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { isLocalMainnetRequest, localMainnetConfig } from '@/lib/local-mainnet/config.server';
import { MAINNET_TEST } from '@/lib/mainnet/policy';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Local mainnet test', robots: { index: false, follow: false } };

export default async function MainnetTestPage() {
  const config = localMainnetConfig();
  if (!config || !isLocalMainnetRequest({ url: MAINNET_TEST.origin, headers: await headers() }, false)) notFound();
  redirect('/portfolio');
}
