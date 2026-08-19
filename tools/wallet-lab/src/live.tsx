import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';

import { WalletLabApp } from './app';
import { createEvmRuntime } from './evm/runtime';
import { resolveEvmRuntimeSettings } from './evm/runtime-env';

export async function renderLiveWalletLab(root: Root): Promise<void> {
  const settings = resolveEvmRuntimeSettings(import.meta.env, window.location.origin);
  if (!settings.enabled) {
    throw new Error(`Wallet runtime gate closed: ${settings.reason}`);
  }
  const runtime = await createEvmRuntime(settings);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  root.render(
    <StrictMode>
      <WagmiProvider {...runtime.providerProps}>
        <QueryClientProvider client={queryClient}>
          <WalletLabApp runtime={runtime} />
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  );
}
