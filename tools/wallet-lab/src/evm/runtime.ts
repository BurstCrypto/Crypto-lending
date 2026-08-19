import { createConfig, http } from 'wagmi';

import { EVM_TESTNET_CHAINS, EVM_TESTNET_CHAIN_IDS } from './chains';
import { createEvmConnectors, type EvmConnectorFactories } from './connectors';
import {
  subscribeWalletConnectDisplayUri,
  type WalletConnectDisplayUriSubscription,
} from './display-uri';
import type { ReadyEvmRuntimeSettings } from './runtime-env';
import { preflightEvmTestnetRpcs } from './rpc-preflight';

export type EvmRuntimeDependencies = Readonly<{
  createConfig: typeof createConfig;
  http: typeof http;
  connectorFactories?: EvmConnectorFactories;
  preflightRpcs?: typeof preflightEvmTestnetRpcs;
}>;

const runtimeDependencies: EvmRuntimeDependencies = Object.freeze({ createConfig, http });

/**
 * Builds the local lab runtime in a disconnected state. The returned provider
 * props must be passed intact to WagmiProvider so it cannot reconnect on mount.
 */
export async function createEvmRuntime(
  settings: ReadyEvmRuntimeSettings,
  dependencies: EvmRuntimeDependencies = runtimeDependencies,
) {
  await (dependencies.preflightRpcs ?? preflightEvmTestnetRpcs)(settings);
  const connectors = await createEvmConnectors(settings, dependencies.connectorFactories);
  const config = dependencies.createConfig({
    chains: EVM_TESTNET_CHAINS,
    connectors,
    multiInjectedProviderDiscovery: true,
    ssr: false,
    transports: {
      [EVM_TESTNET_CHAIN_IDS.sepolia]: dependencies.http(
        settings.rpcUrls[EVM_TESTNET_CHAIN_IDS.sepolia],
      ),
      [EVM_TESTNET_CHAIN_IDS.baseSepolia]: dependencies.http(
        settings.rpcUrls[EVM_TESTNET_CHAIN_IDS.baseSepolia],
      ),
    },
  });

  const providerProps = Object.freeze({
    config,
    reconnectOnMount: false as const,
  });

  return Object.freeze({
    providerProps,
    connectorAvailability: settings.connectorAvailability,
    allowedChainIds: Object.freeze([
      EVM_TESTNET_CHAIN_IDS.sepolia,
      EVM_TESTNET_CHAIN_IDS.baseSepolia,
    ] as const),
    subscribeWalletConnectDisplayUri(
      onDisplayUri: (uri: string) => void,
    ): WalletConnectDisplayUriSubscription {
      return subscribeWalletConnectDisplayUri(
        config.connectors,
        settings.connectorAvailability.walletConnect,
        onDisplayUri,
      );
    },
  });
}

export type EvmRuntime = Awaited<ReturnType<typeof createEvmRuntime>>;
