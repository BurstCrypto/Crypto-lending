import type { ChainId } from '../wallet-adapter';

export type EvmChainId = Extract<ChainId, `eip155:${string}`>;
export type EvmNetworkEnvironment = 'MAINNET' | 'TESTNET';

export interface EvmNetworkDefinition {
  readonly chainId: EvmChainId;
  /** Canonical, lowercase EIP-1193 hexadecimal chain ID. */
  readonly providerChainId: `0x${string}`;
  readonly displayName: string;
  readonly environment: EvmNetworkEnvironment;
}

const DECIMAL_CHAIN_REFERENCE = /^(?:0|[1-9][0-9]{0,77})$/u;
const PROVIDER_CHAIN_ID = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const MAX_NETWORKS = 32;

function fail(): never {
  throw new TypeError('supported EVM network configuration is invalid');
}

function validateDefinition(value: EvmNetworkDefinition): EvmNetworkDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail();
  const reference = value.chainId.startsWith('eip155:') ? value.chainId.slice(7) : '';
  if (
    !DECIMAL_CHAIN_REFERENCE.test(reference) ||
    !PROVIDER_CHAIN_ID.test(value.providerChainId) ||
    BigInt(reference) !== BigInt(value.providerChainId) ||
    typeof value.displayName !== 'string' ||
    value.displayName.length < 1 ||
    value.displayName.length > 80 ||
    /[\0-\x1f\x7f]/u.test(value.displayName) ||
    (value.environment !== 'MAINNET' && value.environment !== 'TESTNET')
  ) {
    fail();
  }

  return Object.freeze({
    chainId: value.chainId,
    providerChainId: value.providerChainId,
    displayName: value.displayName,
    environment: value.environment,
  });
}

/**
 * Copies and validates the application allowlist before any provider value is
 * compared with it. Mainnet and testnet definitions cannot be mixed.
 */
export function createSupportedEvmNetworks(
  values: readonly EvmNetworkDefinition[],
): readonly EvmNetworkDefinition[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_NETWORKS) fail();

  const definitions = values.map(validateDefinition);
  const environments = new Set(definitions.map(({ environment }) => environment));
  const chainIds = new Set(definitions.map(({ chainId }) => chainId));
  const providerChainIds = new Set(definitions.map(({ providerChainId }) => providerChainId));
  if (
    environments.size !== 1 ||
    chainIds.size !== definitions.length ||
    providerChainIds.size !== definitions.length
  ) {
    fail();
  }
  return Object.freeze(definitions);
}

/** Converts only canonical EIP-1193 chain IDs into a bounded CAIP-2 identity. */
export function parseEip1193ChainId(value: unknown): EvmChainId | null {
  if (typeof value !== 'string' || !PROVIDER_CHAIN_ID.test(value)) return null;
  return `eip155:${BigInt(value).toString(10)}`;
}

export function findSupportedEvmNetwork(
  providerChainId: unknown,
  supportedNetworks: readonly EvmNetworkDefinition[],
): EvmNetworkDefinition | null {
  const chainId = parseEip1193ChainId(providerChainId);
  if (chainId === null) return null;
  return supportedNetworks.find((network) => network.chainId === chainId) ?? null;
}
