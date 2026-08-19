export const WALLET_LAB_NETWORKS = [
  {
    id: 'eip155:11155111',
    name: 'Sepolia',
    namespace: 'eip155',
    environment: 'testnet',
  },
  {
    id: 'eip155:84532',
    name: 'Base Sepolia',
    namespace: 'eip155',
    environment: 'testnet',
  },
  {
    id: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    name: 'Solana devnet',
    namespace: 'solana',
    environment: 'devnet',
  },
] as const;

export type WalletLabNetworkId = (typeof WALLET_LAB_NETWORKS)[number]['id'];
export type WalletLabNamespace = (typeof WALLET_LAB_NETWORKS)[number]['namespace'];

export const WALLET_LAB_CONNECTORS = [
  {
    id: 'metamask',
    name: 'MetaMask',
    namespaces: ['eip155'],
    mode: 'mock-only',
    telemetry: 'disabled',
    activationGate: 'KAN-222 MetaMask evaluation clearance',
  },
  {
    id: 'phantom',
    name: 'Phantom',
    namespaces: ['solana'],
    mode: 'mock-only',
    telemetry: 'disabled',
    activationGate: 'real-wallet adapter and device validation',
  },
  {
    id: 'coinbase',
    name: 'Coinbase/Base external wallet',
    namespaces: ['eip155'],
    mode: 'mock-only',
    telemetry: 'disabled',
    activationGate: 'external-wallet adapter and device validation',
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    namespaces: ['eip155'],
    mode: 'mock-only',
    telemetry: 'disabled',
    activationGate: 'KAN-222 Reown evaluation clearance',
  },
] as const;

export type WalletLabConnectorId = (typeof WALLET_LAB_CONNECTORS)[number]['id'];

const networkIds = new Set<string>(WALLET_LAB_NETWORKS.map(({ id }) => id));
const connectorIds = new Set<string>(WALLET_LAB_CONNECTORS.map(({ id }) => id));

export function isWalletLabNetworkId(value: unknown): value is WalletLabNetworkId {
  return typeof value === 'string' && networkIds.has(value);
}

export function isWalletLabConnectorId(value: unknown): value is WalletLabConnectorId {
  return typeof value === 'string' && connectorIds.has(value);
}

export function connectorSupportsNetwork(
  connectorId: WalletLabConnectorId,
  networkId: WalletLabNetworkId,
): boolean {
  const connector = WALLET_LAB_CONNECTORS.find(({ id }) => id === connectorId);
  const network = WALLET_LAB_NETWORKS.find(({ id }) => id === networkId);

  return Boolean(
    connector && network && connector.namespaces.some((item) => item === network.namespace),
  );
}
