import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { isLocalMainnetRequest, localMainnetConfig } from './config.server';

export async function localMainnetPageContext() {
  const config = localMainnetConfig();
  if (!config || !isLocalMainnetRequest({ url: config.origin, headers: await headers() }, false))
    notFound();
  const { readTreasurySetup } = await import('./bridge-config.server');
  return {
    setupToken: process.env.LOCAL_MAINNET_TEST_LAUNCH_TOKEN!,
    treasuries: readTreasurySetup(),
  };
}
