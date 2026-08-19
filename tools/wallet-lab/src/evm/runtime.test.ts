import { describe, expect, it, vi } from 'vitest';
import type { createConfig, http } from 'wagmi';

import { EVM_TESTNET_CHAIN_IDS } from './chains';
import type { EvmConnectorFactories } from './connectors';
import { createEvmRuntime, type EvmRuntimeDependencies } from './runtime';
import { resolveEvmRuntimeSettings, type ReadyEvmRuntimeSettings } from './runtime-env';

function readySettings(): ReadyEvmRuntimeSettings {
  const result = resolveEvmRuntimeSettings(
    {
      DEV: true,
      VITE_WALLET_LAB_ENABLED: 'true',
      VITE_WALLETCONNECT_TERMS_ACCEPTED: 'true',
      VITE_WALLETCONNECT_PROJECT_ID: '0123456789abcdef0123456789abcdef',
      VITE_SEPOLIA_RPC_URL: 'https://sepolia.example.test/rpc',
      VITE_BASE_SEPOLIA_RPC_URL: 'https://base-sepolia.example.test/rpc',
    },
    'http://127.0.0.1:4173',
  );

  if (!result.enabled) throw new Error(`Expected a ready runtime, got ${result.reason}`);

  return result;
}

describe('createEvmRuntime', () => {
  it('enables EIP-6963 discovery and returns a no-reconnect provider contract', async () => {
    type CapturedConfigParameters = {
      chains: readonly { id: number }[];
      connectors: readonly unknown[];
      multiInjectedProviderDiscovery: boolean;
      ssr: boolean;
      transports: Record<number, unknown>;
    };
    const connectorMarkers = [(() => undefined) as never, (() => undefined) as never];
    const connectorSpies = {
      coinbaseWallet: vi.fn((parameters: unknown) => {
        void parameters;
        return connectorMarkers[0];
      }),
      walletConnect: vi.fn((parameters: unknown) => {
        void parameters;
        return connectorMarkers[1];
      }),
    };
    const connectorFactories: EvmConnectorFactories = {
      coinbaseWallet:
        connectorSpies.coinbaseWallet as unknown as EvmConnectorFactories['coinbaseWallet'],
      loadWalletConnect: vi.fn(
        async () =>
          connectorSpies.walletConnect as unknown as Awaited<
            ReturnType<EvmConnectorFactories['loadWalletConnect']>
          >,
      ),
    };
    const configMarker = { connectors: [] };
    const createConfigSpy = vi.fn((parameters: CapturedConfigParameters) => {
      void parameters;
      return configMarker;
    });
    const httpSpy = vi.fn((url: string) => ({ url }));
    const dependencies: EvmRuntimeDependencies = {
      createConfig: createConfigSpy as unknown as typeof createConfig,
      http: httpSpy as unknown as typeof http,
      connectorFactories,
      preflightRpcs: vi.fn(async () => undefined),
    };

    const runtime = await createEvmRuntime(readySettings(), dependencies);
    const parameters = createConfigSpy.mock.calls[0]?.[0];

    expect(parameters).toMatchObject({
      multiInjectedProviderDiscovery: true,
      ssr: false,
    });
    expect(dependencies.preflightRpcs).toHaveBeenCalledOnce();
    if (!parameters) throw new Error('Expected createConfig to be called');

    expect(parameters.chains.map(({ id }) => id)).toEqual([
      EVM_TESTNET_CHAIN_IDS.sepolia,
      EVM_TESTNET_CHAIN_IDS.baseSepolia,
    ]);
    expect(
      Object.keys(parameters.transports)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(
      [EVM_TESTNET_CHAIN_IDS.sepolia, EVM_TESTNET_CHAIN_IDS.baseSepolia].sort((a, b) => a - b),
    );
    expect(runtime.providerProps).toEqual({
      config: configMarker,
      reconnectOnMount: false,
    });
    expect(runtime.allowedChainIds).toEqual([
      EVM_TESTNET_CHAIN_IDS.sepolia,
      EVM_TESTNET_CHAIN_IDS.baseSepolia,
    ]);
  });
});
