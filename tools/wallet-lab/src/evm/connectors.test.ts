import { describe, expect, it, vi } from 'vitest';
import { createEvmConnectors, type EvmConnectorFactories } from './connectors';
import { resolveEvmRuntimeSettings, type ReadyEvmRuntimeSettings } from './runtime-env';

const baseEnvironment = {
  DEV: true,
  VITE_WALLET_LAB_ENABLED: 'true',
  VITE_WALLETCONNECT_TERMS_ACCEPTED: 'true',
  VITE_WALLETCONNECT_PROJECT_ID: '0123456789abcdef0123456789abcdef',
  VITE_SEPOLIA_RPC_URL: 'https://sepolia.example.test/rpc',
  VITE_BASE_SEPOLIA_RPC_URL: 'https://base-sepolia.example.test/rpc',
} as const;

function settings(projectId: string | undefined): ReadyEvmRuntimeSettings {
  const result = resolveEvmRuntimeSettings(
    { ...baseEnvironment, VITE_WALLETCONNECT_PROJECT_ID: projectId },
    'http://127.0.0.1:4173',
  );

  if (!result.enabled) throw new Error(`Expected a ready runtime, got ${result.reason}`);

  return result;
}

function fakeFactories() {
  const markers = {
    injected: (() => undefined) as never,
    coinbaseWallet: (() => undefined) as never,
    walletConnect: (() => undefined) as never,
  };
  const spies = {
    injected: vi.fn((parameters: unknown) => {
      void parameters;
      return markers.injected;
    }),
    coinbaseWallet: vi.fn((parameters: unknown) => {
      void parameters;
      return markers.coinbaseWallet;
    }),
    walletConnect: vi.fn((parameters: unknown) => {
      void parameters;
      return markers.walletConnect;
    }),
  };
  const factories: EvmConnectorFactories = {
    injected: spies.injected as unknown as EvmConnectorFactories['injected'],
    coinbaseWallet: spies.coinbaseWallet as unknown as EvmConnectorFactories['coinbaseWallet'],
    loadWalletConnect: vi.fn(
      async () =>
        spies.walletConnect as unknown as Awaited<
          ReturnType<EvmConnectorFactories['loadWalletConnect']>
        >,
    ),
  };

  return { factories, markers, spies };
}

describe('createEvmConnectors', () => {
  it('configures the injected, Coinbase, and WalletConnect factories', async () => {
    const { factories, markers, spies } = fakeFactories();
    const connectors = await createEvmConnectors(
      settings(baseEnvironment.VITE_WALLETCONNECT_PROJECT_ID),
      factories,
    );

    expect(connectors).toEqual([markers.injected, markers.coinbaseWallet, markers.walletConnect]);
    expect(spies.injected).toHaveBeenCalledWith({ shimDisconnect: true });
    expect(spies.coinbaseWallet).toHaveBeenCalledWith(
      expect.objectContaining({ preference: { options: 'eoaOnly' } }),
    );
    expect(spies.walletConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        methods: [],
        events: [],
        optionalMethods: ['personal_sign', 'wallet_switchEthereumChain'],
        optionalEvents: ['accountsChanged', 'chainChanged'],
        showQrModal: false,
        telemetryEnabled: false,
        isNewChainsStale: true,
      }),
    );
  });

  it('does not load WalletConnect when terms are not accepted', async () => {
    const { factories, markers, spies } = fakeFactories();
    const result = resolveEvmRuntimeSettings(
      {
        ...baseEnvironment,
        VITE_WALLETCONNECT_TERMS_ACCEPTED: 'false',
      },
      'http://127.0.0.1:4173',
    );
    if (!result.enabled) throw new Error(`Expected a ready runtime, got ${result.reason}`);
    const connectors = await createEvmConnectors(result, factories);

    expect(connectors).toEqual([markers.injected, markers.coinbaseWallet]);
    expect(spies.walletConnect).not.toHaveBeenCalled();
    expect(factories.loadWalletConnect).not.toHaveBeenCalled();
  });
});
