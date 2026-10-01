import { localMainnetConfig } from '@/lib/local-mainnet/config.server';
import { localMainnetPageContext } from '@/lib/local-mainnet/page-context.server';
import { MAINNET_TREASURIES } from '@/lib/mainnet/public-config';
import { LocalMainnetTest } from './mainnet-test';

/** Both environments use this workspace; local testing adds read-only provider details. */
export async function MainnetWorkspace() {
  const context = localMainnetConfig() ? await localMainnetPageContext() : null;
  return <LocalMainnetTest setupToken={context?.setupToken ?? ''} initialTreasuries={MAINNET_TREASURIES} showProviderDetails={context !== null} />;
}
