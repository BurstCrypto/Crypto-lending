import { EVM_TESTNET_CHAIN_IDS, type EvmTestnetChainId } from './chains';
import { WALLET_LAB_ORIGIN } from '../local-boundary';

export const EVM_CONNECTOR_IDS = ['injected', 'coinbaseWallet', 'walletConnect'] as const;

export type EvmConnectorId = (typeof EVM_CONNECTOR_IDS)[number];

export type EvmRuntimeGateReason =
  | 'explicit-enable-required'
  | 'development-build-required'
  | 'loopback-origin-required'
  | 'sepolia-https-rpc-required'
  | 'base-sepolia-https-rpc-required';

export type EvmConnectorUnavailableReason =
  | EvmRuntimeGateReason
  | 'walletconnect-terms-not-accepted'
  | 'walletconnect-project-id-missing'
  | 'walletconnect-project-id-invalid';

export type EvmConnectorAvailability = Readonly<
  Record<
    EvmConnectorId,
    | Readonly<{ enabled: true }>
    | Readonly<{ enabled: false; reason: EvmConnectorUnavailableReason }>
  >
>;

export type EvmRuntimeEnvironment = Readonly<{
  DEV?: boolean | undefined;
  VITE_WALLET_LAB_ENABLED?: string | undefined;
  VITE_WALLETCONNECT_TERMS_ACCEPTED?: string | undefined;
  VITE_WALLETCONNECT_PROJECT_ID?: string | undefined;
  VITE_SEPOLIA_RPC_URL?: string | undefined;
  VITE_BASE_SEPOLIA_RPC_URL?: string | undefined;
}>;

export type DisabledEvmRuntimeSettings = Readonly<{
  enabled: false;
  reason: EvmRuntimeGateReason;
  connectorAvailability: EvmConnectorAvailability;
}>;

export type ReadyEvmRuntimeSettings = Readonly<{
  enabled: true;
  dapp: Readonly<{
    name: string;
    description: string;
    origin: string;
    iconUrl: string;
  }>;
  rpcUrls: Readonly<Record<EvmTestnetChainId, string>>;
  walletConnectProjectId?: string;
  connectorAvailability: EvmConnectorAvailability;
}>;

export type EvmRuntimeSettings = DisabledEvmRuntimeSettings | ReadyEvmRuntimeSettings;

const enabledAvailability = Object.freeze({ enabled: true } as const);

function disabledAvailability(reason: EvmConnectorUnavailableReason): EvmConnectorAvailability {
  const unavailable = Object.freeze({ enabled: false, reason } as const);

  return Object.freeze({
    injected: unavailable,
    coinbaseWallet: unavailable,
    walletConnect: unavailable,
  });
}

function disabledRuntime(reason: EvmRuntimeGateReason): DisabledEvmRuntimeSettings {
  return Object.freeze({
    enabled: false,
    reason,
    connectorAvailability: disabledAvailability(reason),
  });
}

function parseLabOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    const hasCredentials = Boolean(url.username || url.password);

    if (hasCredentials || url.origin !== WALLET_LAB_ORIGIN) return undefined;

    return url.origin;
  } catch {
    return undefined;
  }
}

function parseHttpsRpcUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;

  try {
    const url = new URL(value.trim());

    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return undefined;

    return url.toString();
  } catch {
    return undefined;
  }
}

function parseWalletConnectSettings(
  termsAccepted: string | undefined,
  value: string | undefined,
):
  | Readonly<{ enabled: true; projectId: string }>
  | Readonly<{
      enabled: false;
      reason:
        | 'walletconnect-terms-not-accepted'
        | 'walletconnect-project-id-missing'
        | 'walletconnect-project-id-invalid';
    }> {
  if (termsAccepted !== 'true') {
    return Object.freeze({ enabled: false, reason: 'walletconnect-terms-not-accepted' });
  }

  const projectId = value?.trim();

  if (!projectId) {
    return Object.freeze({ enabled: false, reason: 'walletconnect-project-id-missing' });
  }

  if (!/^[a-f\d]{32}$/iu.test(projectId)) {
    return Object.freeze({ enabled: false, reason: 'walletconnect-project-id-invalid' });
  }

  return Object.freeze({ enabled: true, projectId });
}

/**
 * Resolves browser-exposed Vite values without ever reading process.env or
 * importing secrets. Call this with import.meta.env and window.location.origin.
 */
export function resolveEvmRuntimeSettings(
  environment: EvmRuntimeEnvironment,
  currentOrigin: string,
): EvmRuntimeSettings {
  if (environment.VITE_WALLET_LAB_ENABLED !== 'true') {
    return disabledRuntime('explicit-enable-required');
  }

  if (environment.DEV !== true) return disabledRuntime('development-build-required');

  const origin = parseLabOrigin(currentOrigin);

  if (!origin) return disabledRuntime('loopback-origin-required');

  const sepoliaRpcUrl = parseHttpsRpcUrl(environment.VITE_SEPOLIA_RPC_URL);

  if (!sepoliaRpcUrl) return disabledRuntime('sepolia-https-rpc-required');

  const baseSepoliaRpcUrl = parseHttpsRpcUrl(environment.VITE_BASE_SEPOLIA_RPC_URL);

  if (!baseSepoliaRpcUrl) return disabledRuntime('base-sepolia-https-rpc-required');

  const walletConnect = parseWalletConnectSettings(
    environment.VITE_WALLETCONNECT_TERMS_ACCEPTED,
    environment.VITE_WALLETCONNECT_PROJECT_ID,
  );

  const connectorAvailability: EvmConnectorAvailability = Object.freeze({
    injected: enabledAvailability,
    coinbaseWallet: enabledAvailability,
    walletConnect: walletConnect.enabled
      ? enabledAvailability
      : Object.freeze({ enabled: false, reason: walletConnect.reason }),
  });

  return Object.freeze({
    enabled: true,
    dapp: Object.freeze({
      name: 'CryptoLending Wallet Lab',
      description: 'Local-only EVM testnet wallet compatibility lab',
      origin,
      iconUrl: new URL('/favicon.ico', origin).toString(),
    }),
    rpcUrls: Object.freeze({
      [EVM_TESTNET_CHAIN_IDS.sepolia]: sepoliaRpcUrl,
      [EVM_TESTNET_CHAIN_IDS.baseSepolia]: baseSepoliaRpcUrl,
    }),
    ...(walletConnect.enabled ? { walletConnectProjectId: walletConnect.projectId } : {}),
    connectorAvailability,
  });
}
