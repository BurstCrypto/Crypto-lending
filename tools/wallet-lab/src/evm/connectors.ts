import type { CreateConnectorFn } from 'wagmi';
import { coinbaseWallet } from '@wagmi/connectors/coinbaseWallet';
import type { walletConnect, WalletConnectParameters } from '@wagmi/connectors/walletConnect';
import type { Connector } from 'wagmi';

import type { ReadyEvmRuntimeSettings } from './runtime-env';

export type EvmConnectorFactories = Readonly<{
  coinbaseWallet: typeof coinbaseWallet;
  loadWalletConnect: () => Promise<typeof walletConnect>;
}>;

const connectorFactories: EvmConnectorFactories = Object.freeze({
  coinbaseWallet,
  async loadWalletConnect() {
    const module = await import('@wagmi/connectors/walletConnect');
    return module.walletConnect;
  },
});

/**
 * The real-wallet lab exposes only the three approved EVM targets. Generic
 * injected connectors and vendor-branded embedded/smart-account fallbacks stay
 * hidden even when an extension advertises them through EIP-6963.
 */
export function isApprovedEvmConnector(connector: Pick<Connector, 'id' | 'type'>): boolean {
  return (
    (connector.id === 'io.metamask' && connector.type === 'injected') ||
    (connector.id === 'coinbaseWalletSDK' && connector.type === 'coinbaseWallet') ||
    (connector.id === 'walletConnect' && connector.type === 'walletConnect')
  );
}

/**
 * Creates connector definitions only. It never calls connect, reconnect, or a
 * signing action; those actions belong behind explicit lab UI gestures.
 */
export async function createEvmConnectors(
  settings: ReadyEvmRuntimeSettings,
  factories: EvmConnectorFactories = connectorFactories,
): Promise<readonly CreateConnectorFn[]> {
  const connectors: CreateConnectorFn[] = [
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
      logger: string;
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
      // Provider error objects can contain session or pairing identifiers.
      // The lab maps failures to fixed messages and must not emit vendor logs.
      logger: 'silent',
      isNewChainsStale: true,
    };

    const walletConnect = await factories.loadWalletConnect();
    connectors.push(walletConnect(walletConnectParameters));
  }

  return Object.freeze(connectors);
}
