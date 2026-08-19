import type { CreateConnectorFn } from 'wagmi';
import { coinbaseWallet } from '@wagmi/connectors/coinbaseWallet';
import { injected } from '@wagmi/connectors/injected';
import type { walletConnect, WalletConnectParameters } from '@wagmi/connectors/walletConnect';

import type { ReadyEvmRuntimeSettings } from './runtime-env';

export type EvmConnectorFactories = Readonly<{
  injected: typeof injected;
  coinbaseWallet: typeof coinbaseWallet;
  loadWalletConnect: () => Promise<typeof walletConnect>;
}>;

const connectorFactories: EvmConnectorFactories = Object.freeze({
  injected,
  coinbaseWallet,
  async loadWalletConnect() {
    const module = await import('@wagmi/connectors/walletConnect');
    return module.walletConnect;
  },
});

/**
 * Creates connector definitions only. It never calls connect, reconnect, or a
 * signing action; those actions belong behind explicit lab UI gestures.
 */
export async function createEvmConnectors(
  settings: ReadyEvmRuntimeSettings,
  factories: EvmConnectorFactories = connectorFactories,
): Promise<readonly CreateConnectorFn[]> {
  const connectors: CreateConnectorFn[] = [
    // EIP-6963 discovery is enabled on createConfig; this is its EIP-1193 fallback.
    factories.injected({ shimDisconnect: true }),
    factories.coinbaseWallet({
      appName: settings.dapp.name,
      appLogoUrl: settings.dapp.iconUrl,
      preference: { options: 'eoaOnly' },
    }),
  ];

  const walletConnectAvailability = settings.connectorAvailability.walletConnect;

  if (walletConnectAvailability.enabled && typeof settings.walletConnectProjectId === 'string') {
    // Wagmi currently omits these provider fields from its public alias even
    // though it forwards them to the public EthereumProvider.init API.
    const walletConnectParameters: WalletConnectParameters & {
      methods: string[];
      events: string[];
      optionalMethods: string[];
      optionalEvents: string[];
    } = {
      methods: [],
      events: [],
      optionalMethods: ['personal_sign', 'wallet_switchEthereumChain'],
      optionalEvents: ['accountsChanged', 'chainChanged'],
      projectId: settings.walletConnectProjectId,
      metadata: {
        name: settings.dapp.name,
        description: settings.dapp.description,
        url: settings.dapp.origin,
        icons: [settings.dapp.iconUrl],
      },
      // The lab renders the emitted display_uri itself; no AppKit is required.
      showQrModal: false,
      telemetryEnabled: false,
      isNewChainsStale: true,
    };

    const walletConnect = await factories.loadWalletConnect();
    connectors.push(walletConnect(walletConnectParameters));
  }

  return Object.freeze(connectors);
}
