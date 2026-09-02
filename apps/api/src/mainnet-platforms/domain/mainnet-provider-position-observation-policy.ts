import { createHash } from 'node:crypto';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedAssetRegistrySnapshot,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';

export const MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION = 1 as const;
export const MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE =
  'MAINNET_PROVIDER_POSITION_OBSERVATION_APPROVALS' as const;

export type MainnetProviderPositionSourceKind = 'RPC' | 'INDEXER' | 'PROVIDER_API';

export interface MainnetProviderPositionAssetApprovalV1 {
  readonly stablecoin: SupportedStablecoin;
  readonly identity: string;
}

export interface MainnetProviderPositionMarketApprovalV1 {
  readonly networkId: string;
  readonly marketId: string;
  readonly assets: readonly MainnetProviderPositionAssetApprovalV1[];
}

export interface MainnetProviderPositionProtocolApprovalV1 {
  readonly protocolId: string;
  readonly markets: readonly MainnetProviderPositionMarketApprovalV1[];
}

export interface MainnetProviderPositionProviderApprovalV1 {
  readonly providerId: string;
  readonly protocols: readonly MainnetProviderPositionProtocolApprovalV1[];
}

export interface MainnetProviderPositionSourceApprovalV1 {
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly networkId: string;
}

/**
 * An explicit allow-list for observation attribution. This is intentionally a
 * parser input: this module does not ship a production policy or bind a live
 * data source.
 */
export interface MainnetProviderPositionObservationPolicyContentV1 {
  readonly policyVersion: typeof MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION;
  readonly use: typeof MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE;
  readonly policyId: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly providers: readonly MainnetProviderPositionProviderApprovalV1[];
  readonly sources: readonly MainnetProviderPositionSourceApprovalV1[];
}

export interface MainnetProviderPositionObservationPolicyV1 extends MainnetProviderPositionObservationPolicyContentV1 {
  readonly fingerprintSha256: string;
}

export class MainnetProviderPositionObservationPolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MainnetProviderPositionObservationPolicyValidationError';
  }
}

const POLICY_CONTENT_KEYS = [
  'policyVersion',
  'use',
  'policyId',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'providers',
  'sources',
] as const;
const POLICY_KEYS = [...POLICY_CONTENT_KEYS, 'fingerprintSha256'] as const;
const PROVIDER_KEYS = ['providerId', 'protocols'] as const;
const PROTOCOL_KEYS = ['protocolId', 'markets'] as const;
const MARKET_KEYS = ['networkId', 'marketId', 'assets'] as const;
const ASSET_KEYS = ['stablecoin', 'identity'] as const;
const SOURCE_KEYS = ['sourceId', 'sourceKind', 'networkId'] as const;
const SOURCE_KINDS = new Set<MainnetProviderPositionSourceKind>(['RPC', 'INDEXER', 'PROVIDER_API']);
const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SAFE_POLICY_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const EVM_NETWORK = /^eip155:[1-9][0-9]*$/;
const SOLANA_NETWORK = /^solana:[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_HEX_ID = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const SAFE_MARKET_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_PROVIDERS = 64;
const MAX_PROTOCOLS_PER_PROVIDER = 32;
const MAX_MARKETS_PER_PROTOCOL = 64;
const MAX_ASSETS_PER_MARKET = 32;
const MAX_SOURCES = 128;
const MAX_TOTAL_PROTOCOLS = 256;
const MAX_TOTAL_MARKETS = 1_024;
const MAX_TOTAL_ASSETS = 4_096;

interface PolicyParseBudget {
  protocols: number;
  markets: number;
  assets: number;
}

function fail(message: string): never {
  throw new MainnetProviderPositionObservationPolicyValidationError(message);
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function dataRecord(value: unknown, path: string): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail(`${path} must be an object`);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail(`${path} must be a plain data object`);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) {
        return fail(`${path} must contain only enumerable data properties`);
      }
      record[key] = descriptor.value;
    }

    return record;
  } catch {
    return fail(`${path} must be a plain data object`);
  }
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = dataRecord(value, path);
  const actualKeys = Object.keys(record).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    return fail(`${path} has unexpected or missing fields`);
  }
  return record;
}

function dataArray(value: unknown, path: string, maximumLength: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return fail(`${path} must be an array`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength ||
      lengthDescriptor.enumerable !== false
    ) {
      return fail(`${path} has an invalid length`);
    }
    const length = lengthDescriptor.value;
    const indexKeys = Array.from({ length }, (_, index) => String(index));
    const expectedKeys = [...indexKeys, 'length'];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail(`${path} must be a dense data array`);
    }
    return indexKeys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail(`${path}.${key} must be an enumerable data property`);
      }
      return descriptor.value;
    });
  } catch {
    return fail(`${path} must be an array`);
  }
}

function stringField(value: unknown, path: string): string {
  if (typeof value !== 'string') return fail(`${path} must be a string`);
  return value;
}

function canonicalId(value: unknown, path: string): string {
  const id = stringField(value, path);
  if (!SAFE_ID.test(id)) return fail(`${path} is not a canonical identifier`);
  return id;
}

function canonicalNetworkId(value: unknown, path: string): string {
  const networkId = stringField(value, path);
  if (!EVM_NETWORK.test(networkId) && !SOLANA_NETWORK.test(networkId)) {
    return fail(`${path} is not a supported CAIP-2 mainnet identifier`);
  }

  const chainPolicy = chainObservationPolicyForNetwork(networkId);
  if (!chainPolicy || chainPolicy.environment !== 'MAINNET') {
    return fail(`${path} has no active mainnet chain observation policy`);
  }
  return networkId;
}

function canonicalMarketId(value: unknown, networkId: string, path: string): string {
  const marketId = stringField(value, path);
  if (networkId.startsWith('eip155:') && marketId.toLowerCase().startsWith('0x')) {
    if (!EVM_HEX_ID.test(marketId) || /^0x0+$/iu.test(marketId)) {
      return fail(`${path} is not a canonical EVM market identifier`);
    }
    return marketId.toLowerCase();
  }
  if (!SAFE_MARKET_ID.test(marketId)) {
    return fail(`${path} is not a canonical market identifier`);
  }
  return marketId;
}

function registrySnapshot(
  versionValue: unknown,
  fingerprintValue: unknown,
): SupportedAssetRegistrySnapshot {
  if (
    typeof versionValue !== 'number' ||
    !Number.isSafeInteger(versionValue) ||
    versionValue < 1 ||
    typeof fingerprintValue !== 'string' ||
    !SHA256.test(fingerprintValue)
  ) {
    return fail('observationPolicy asset registry binding is invalid');
  }
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.atVersion(versionValue);
  if (!registry || registry.fingerprintSha256 !== fingerprintValue) {
    return fail('observationPolicy asset registry binding is unknown');
  }
  return registry;
}

function parseAsset(
  value: unknown,
  networkId: string,
  registry: SupportedAssetRegistrySnapshot,
  path: string,
): MainnetProviderPositionAssetApprovalV1 {
  const record = exactRecord(value, ASSET_KEYS, path);
  if (typeof record.identity !== 'string' || typeof record.stablecoin !== 'string') {
    return fail(`${path} is invalid`);
  }
  const asset = registry.identifyAsset(networkId, record.identity);
  const network = registry.networks.find((entry) => entry.networkId === networkId);
  if (
    !asset ||
    !network ||
    asset.activationState !== 'ACTIVE' ||
    network.activationState !== 'ACTIVE' ||
    asset.stablecoin !== record.stablecoin
  ) {
    return fail(`${path} is not an active approved registry asset`);
  }
  return Object.freeze({ stablecoin: asset.stablecoin, identity: asset.identity });
}

function parseMarket(
  value: unknown,
  registry: SupportedAssetRegistrySnapshot,
  budget: PolicyParseBudget,
  path: string,
): MainnetProviderPositionMarketApprovalV1 {
  const record = exactRecord(value, MARKET_KEYS, path);
  const networkId = canonicalNetworkId(record.networkId, `${path}.networkId`);
  const assetsInput = dataArray(record.assets, `${path}.assets`, MAX_ASSETS_PER_MARKET);
  if (assetsInput.length === 0) {
    return fail(`${path}.assets must contain at least one entry`);
  }
  budget.assets += assetsInput.length;
  if (budget.assets > MAX_TOTAL_ASSETS) {
    return fail(`observationPolicy exceeds the aggregate asset approval budget`);
  }
  const assets = assetsInput.map((asset, index) =>
    parseAsset(asset, networkId, registry, `${path}.assets[${index}]`),
  );
  const assetKeys = new Set<string>();
  for (const asset of assets) {
    const key = `${asset.stablecoin}\u0000${asset.identity}`;
    if (assetKeys.has(key)) return fail(`${path}.assets contains a duplicate`);
    assetKeys.add(key);
  }
  assets.sort((left, right) =>
    compareCanonical(
      `${left.stablecoin}\u0000${left.identity}`,
      `${right.stablecoin}\u0000${right.identity}`,
    ),
  );
  return Object.freeze({
    networkId,
    marketId: canonicalMarketId(record.marketId, networkId, `${path}.marketId`),
    assets: Object.freeze(assets),
  });
}

function parseProtocol(
  value: unknown,
  registry: SupportedAssetRegistrySnapshot,
  budget: PolicyParseBudget,
  path: string,
): MainnetProviderPositionProtocolApprovalV1 {
  const record = exactRecord(value, PROTOCOL_KEYS, path);
  const marketsInput = dataArray(record.markets, `${path}.markets`, MAX_MARKETS_PER_PROTOCOL);
  if (marketsInput.length === 0 || marketsInput.length > MAX_MARKETS_PER_PROTOCOL) {
    return fail(`${path}.markets must contain 1-${MAX_MARKETS_PER_PROTOCOL} entries`);
  }
  budget.markets += marketsInput.length;
  if (budget.markets > MAX_TOTAL_MARKETS) {
    return fail(`observationPolicy exceeds the aggregate market approval budget`);
  }

  const markets = marketsInput.map((market, index) =>
    parseMarket(market, registry, budget, `${path}.markets[${index}]`),
  );
  const marketKeys = new Set<string>();
  for (const market of markets) {
    const key = `${market.networkId}\u0000${market.marketId}`;
    if (marketKeys.has(key)) return fail(`${path}.markets contains a duplicate`);
    marketKeys.add(key);
  }
  markets.sort((left, right) =>
    compareCanonical(
      `${left.networkId}\u0000${left.marketId}`,
      `${right.networkId}\u0000${right.marketId}`,
    ),
  );

  return Object.freeze({
    protocolId: canonicalId(record.protocolId, `${path}.protocolId`),
    markets: Object.freeze(markets),
  });
}

function parseProvider(
  value: unknown,
  registry: SupportedAssetRegistrySnapshot,
  budget: PolicyParseBudget,
  path: string,
): MainnetProviderPositionProviderApprovalV1 {
  const record = exactRecord(value, PROVIDER_KEYS, path);
  const protocolsInput = dataArray(
    record.protocols,
    `${path}.protocols`,
    MAX_PROTOCOLS_PER_PROVIDER,
  );
  if (protocolsInput.length === 0 || protocolsInput.length > MAX_PROTOCOLS_PER_PROVIDER) {
    return fail(`${path}.protocols must contain 1-${MAX_PROTOCOLS_PER_PROVIDER} entries`);
  }
  budget.protocols += protocolsInput.length;
  if (budget.protocols > MAX_TOTAL_PROTOCOLS) {
    return fail(`observationPolicy exceeds the aggregate protocol approval budget`);
  }

  const protocols = protocolsInput.map((protocol, index) =>
    parseProtocol(protocol, registry, budget, `${path}.protocols[${index}]`),
  );
  const protocolIds = new Set<string>();
  for (const protocol of protocols) {
    if (protocolIds.has(protocol.protocolId)) {
      return fail(`${path}.protocols contains a duplicate protocolId`);
    }
    protocolIds.add(protocol.protocolId);
  }
  protocols.sort((left, right) => compareCanonical(left.protocolId, right.protocolId));

  return Object.freeze({
    providerId: canonicalId(record.providerId, `${path}.providerId`),
    protocols: Object.freeze(protocols),
  });
}

function parseSource(value: unknown, path: string): MainnetProviderPositionSourceApprovalV1 {
  const record = exactRecord(value, SOURCE_KEYS, path);
  const sourceKind = stringField(record.sourceKind, `${path}.sourceKind`);
  if (!SOURCE_KINDS.has(sourceKind as MainnetProviderPositionSourceKind)) {
    return fail(`${path}.sourceKind is not supported`);
  }

  return Object.freeze({
    sourceId: canonicalId(record.sourceId, `${path}.sourceId`),
    sourceKind: sourceKind as MainnetProviderPositionSourceKind,
    networkId: canonicalNetworkId(record.networkId, `${path}.networkId`),
  });
}

function normalizePolicyContent(value: unknown): MainnetProviderPositionObservationPolicyContentV1 {
  const record = exactRecord(value, POLICY_CONTENT_KEYS, 'observationPolicy');
  if (record.policyVersion !== MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION) {
    return fail('observationPolicy.policyVersion is not supported');
  }
  if (record.use !== MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE) {
    return fail('observationPolicy.use is not supported');
  }

  const policyId = stringField(record.policyId, 'observationPolicy.policyId');
  if (!SAFE_POLICY_ID.test(policyId)) {
    return fail('observationPolicy.policyId is not canonical');
  }
  const registry = registrySnapshot(
    record.assetRegistryVersion,
    record.assetRegistryFingerprintSha256,
  );

  const providersInput = dataArray(record.providers, 'observationPolicy.providers', MAX_PROVIDERS);
  if (providersInput.length === 0) {
    return fail('observationPolicy.providers must contain at least one entry');
  }
  const budget: PolicyParseBudget = { protocols: 0, markets: 0, assets: 0 };
  const providers = providersInput.map((provider, index) =>
    parseProvider(provider, registry, budget, `observationPolicy.providers[${index}]`),
  );
  const providerIds = new Set<string>();
  const approvedNetworkIds = new Set<string>();
  for (const provider of providers) {
    if (providerIds.has(provider.providerId)) {
      return fail('observationPolicy.providers contains a duplicate providerId');
    }
    providerIds.add(provider.providerId);
    for (const protocol of provider.protocols) {
      for (const market of protocol.markets) {
        approvedNetworkIds.add(market.networkId);
      }
    }
  }
  providers.sort((left, right) => compareCanonical(left.providerId, right.providerId));

  const sourcesInput = dataArray(record.sources, 'observationPolicy.sources', MAX_SOURCES);
  if (sourcesInput.length === 0) {
    return fail('observationPolicy.sources must contain at least one entry');
  }
  const sources = sourcesInput.map((source, index) =>
    parseSource(source, `observationPolicy.sources[${index}]`),
  );
  const sourceIds = new Set<string>();
  const sourceNetworkIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.sourceId)) {
      return fail('observationPolicy.sources contains a duplicate sourceId');
    }
    if (!approvedNetworkIds.has(source.networkId)) {
      return fail('observationPolicy.sources contains an unbound networkId');
    }
    sourceIds.add(source.sourceId);
    sourceNetworkIds.add(source.networkId);
  }
  for (const networkId of approvedNetworkIds) {
    if (!sourceNetworkIds.has(networkId)) {
      return fail('observationPolicy has a market network without an approved source');
    }
  }
  sources.sort((left, right) =>
    compareCanonical(
      `${left.sourceId}\u0000${left.sourceKind}\u0000${left.networkId}`,
      `${right.sourceId}\u0000${right.sourceKind}\u0000${right.networkId}`,
    ),
  );

  return Object.freeze({
    policyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
    policyId,
    assetRegistryVersion: registry.version,
    assetRegistryFingerprintSha256: registry.fingerprintSha256,
    providers: Object.freeze(providers),
    sources: Object.freeze(sources),
  });
}

function fingerprintNormalizedPolicy(
  policy: MainnetProviderPositionObservationPolicyContentV1,
): string {
  const canonical = [
    'crypto-lending:mainnet-provider-position-observation-policy:v1',
    policy.policyVersion,
    policy.use,
    policy.policyId,
    policy.assetRegistryVersion,
    policy.assetRegistryFingerprintSha256,
    policy.providers.map((provider) => [
      provider.providerId,
      provider.protocols.map((protocol) => [
        protocol.protocolId,
        protocol.markets.map((market) => [
          market.networkId,
          market.marketId,
          market.assets.map((asset) => [asset.stablecoin, asset.identity]),
        ]),
      ]),
    ]),
    policy.sources.map((source) => [source.sourceId, source.sourceKind, source.networkId]),
  ] as const;
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

/** Computes the canonical digest after strict normalization and lexical sorting. */
export function mainnetProviderPositionObservationPolicyFingerprintV1(value: unknown): string {
  return fingerprintNormalizedPolicy(normalizePolicyContent(value));
}

export function parseMainnetProviderPositionObservationPolicyV1(
  value: unknown,
): MainnetProviderPositionObservationPolicyV1 {
  const record = exactRecord(value, POLICY_KEYS, 'observationPolicy');
  const contentInput = Object.fromEntries(POLICY_CONTENT_KEYS.map((key) => [key, record[key]]));
  const content = normalizePolicyContent(contentInput);
  const fingerprintSha256 = stringField(
    record.fingerprintSha256,
    'observationPolicy.fingerprintSha256',
  );
  if (
    !SHA256.test(fingerprintSha256) ||
    fingerprintSha256 !== fingerprintNormalizedPolicy(content)
  ) {
    return fail('observationPolicy.fingerprintSha256 does not match normalized content');
  }

  return Object.freeze({ ...content, fingerprintSha256 });
}

export function mainnetProviderPositionPolicyAllowsMarket(
  policy: MainnetProviderPositionObservationPolicyV1,
  providerId: string,
  protocolId: string,
  networkId: string,
  marketId: string,
  stablecoin: SupportedStablecoin,
  assetIdentity: string,
): boolean {
  return policy.providers.some(
    (provider) =>
      provider.providerId === providerId &&
      provider.protocols.some(
        (protocol) =>
          protocol.protocolId === protocolId &&
          protocol.markets.some(
            (market) =>
              market.networkId === networkId &&
              market.marketId === marketId &&
              market.assets.some(
                (asset) => asset.stablecoin === stablecoin && asset.identity === assetIdentity,
              ),
          ),
      ),
  );
}

export function mainnetProviderPositionPolicyAllowsSource(
  policy: MainnetProviderPositionObservationPolicyV1,
  sourceId: string,
  sourceKind: MainnetProviderPositionSourceKind,
  networkId: string,
): boolean {
  return policy.sources.some(
    (source) =>
      source.sourceId === sourceId &&
      source.sourceKind === sourceKind &&
      source.networkId === networkId,
  );
}
