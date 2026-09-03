import { createHash } from 'node:crypto';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import {
  SMART_LENDING_PROVIDER_IDS,
  type LiveLendingMarketObservation,
  type LiveLendingMarketSnapshot,
  type SmartLendingProviderId,
} from '../../application/ports/live-lending-market-feed.port';

const MAX_UPSTREAM_POOLS = 50_000;
const MAX_MARKETS_PER_PROVIDER_ASSET = 8;
const MAX_APY_PERCENT = 10_000;
const MAX_TVL_USD = 1_000_000_000_000_000;
const INDICATIVE_TTL_MILLISECONDS = 75 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DECIMAL_NUMBER = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:e([+-]?[0-9]+))?$/u;

interface ProviderSource {
  readonly providerId: SmartLendingProviderId;
  readonly project: string;
  readonly chain: 'Ethereum' | 'Solana';
  readonly networkId: MainnetLaunchNetworkId;
}

const PROVIDERS: readonly ProviderSource[] = Object.freeze([
  provider('aave', 'aave-v3', 'Ethereum', 'eip155:1'),
  provider('morpho', 'morpho-blue', 'Ethereum', 'eip155:1'),
  provider('compound', 'compound-v3', 'Ethereum', 'eip155:1'),
  provider('spark', 'sparklend', 'Ethereum', 'eip155:1'),
  provider('euler', 'euler-v2', 'Ethereum', 'eip155:1'),
  provider('gearbox', 'gearbox', 'Ethereum', 'eip155:1'),
  provider('kamino', 'kamino-lend', 'Solana', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
  provider('save', 'save', 'Solana', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
  provider('project-0', 'project-0', 'Solana', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
  provider('jupiter', 'jupiter-lend', 'Solana', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
]);

interface CandidateObservation extends LiveLendingMarketObservation {
  readonly sourceProject: string;
}

export class DefiLlamaMarketFeedValidationError extends Error {
  readonly code = 'DEFILLAMA_MARKET_FEED_INVALID' as const;

  constructor() {
    super('DefiLlama market feed is invalid');
    this.name = 'DefiLlamaMarketFeedValidationError';
  }
}

function fail(): never {
  throw new DefiLlamaMarketFeedValidationError();
}

function provider(
  providerId: SmartLendingProviderId,
  project: string,
  chain: 'Ethereum' | 'Solana',
  networkId: MainnetLaunchNetworkId,
): ProviderSource {
  return Object.freeze({ providerId, project, chain, networkId });
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') return fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail();
  }
  return value;
}

function ownDataValue(value: unknown, key: string): unknown {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return fail();
    return descriptor.value;
  } catch (error) {
    if (error instanceof DefiLlamaMarketFeedValidationError) throw error;
    return fail();
  }
}

function ownDataArray(value: unknown, maximum: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors['length'] as PropertyDescriptor | undefined;
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return fail();
    const length = lengthDescriptor.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length > maximum) {
      return fail();
    }
    const expectedKeys = new Set([
      'length',
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
      return fail();
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return fail();
      result.push(descriptor.value);
    }
    return result;
  } catch (error) {
    if (error instanceof DefiLlamaMarketFeedValidationError) throw error;
    return fail();
  }
}

function decimalNumberToScaledFloor(value: unknown, scale: number, maximum: number): bigint | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    return null;
  }
  const text = String(value);
  const match = DECIMAL_NUMBER.exec(text);
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? '0');
  if (whole === undefined || !Number.isSafeInteger(exponent)) return null;

  const digits = `${whole}${fraction}`;
  const shift = exponent + scale - fraction.length;
  if (!Number.isSafeInteger(shift)) return null;
  if (shift >= 0) return BigInt(`${digits}${'0'.repeat(shift)}`);

  const retainedDigits = digits.length + shift;
  return retainedDigits <= 0 ? 0n : BigInt(digits.slice(0, retainedDigits));
}

function normalizedIdentity(networkId: MainnetLaunchNetworkId, identity: unknown): string | null {
  if (typeof identity !== 'string') return null;
  const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(networkId, identity);
  if (!asset || asset.activationState !== 'ACTIVE' || asset.decimals !== 6) return null;
  return asset.identity;
}

function parseCandidate(value: unknown): CandidateObservation | null {
  const projectValue = ownDataValue(value, 'project');
  const chainValue = ownDataValue(value, 'chain');
  const source = PROVIDERS.find(
    ({ project, chain }) => project === projectValue && chain === chainValue,
  );
  if (!source) return null;
  if (
    ownDataValue(value, 'stablecoin') !== true ||
    ownDataValue(value, 'exposure') !== 'single' ||
    ownDataValue(value, 'outlier') !== false
  ) {
    return null;
  }

  const symbol = ownDataValue(value, 'symbol');
  if (symbol !== 'USDC' && symbol !== 'USDT' && symbol !== 'PYUSD') return null;
  const pool = ownDataValue(value, 'pool');
  if (typeof pool !== 'string' || !UUID.test(pool)) return null;
  const underlyingTokens = ownDataArray(ownDataValue(value, 'underlyingTokens'), 8);
  if (underlyingTokens.length !== 1) return null;
  const assetId = normalizedIdentity(source.networkId, underlyingTokens[0]);
  if (!assetId) return null;
  const registryAsset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(source.networkId, assetId);
  if (!registryAsset || registryAsset.stablecoin !== symbol) return null;

  const grossApyBasisPoints = decimalNumberToScaledFloor(
    ownDataValue(value, 'apyBase'),
    2,
    MAX_APY_PERCENT,
  );
  const totalValueLockedUsdMantissa = decimalNumberToScaledFloor(
    ownDataValue(value, 'tvlUsd'),
    18,
    MAX_TVL_USD,
  );
  if (grossApyBasisPoints === null || totalValueLockedUsdMantissa === null) return null;

  return Object.freeze({
    providerId: source.providerId,
    sourceProject: source.project,
    networkId: source.networkId,
    marketId: pool,
    assetId,
    assetSymbol: symbol,
    assetDecimals: 6 as const,
    grossApyBasisPoints,
    totalValueLockedUsdMantissa,
    evidenceReferenceId: `defillama:${pool}`,
  });
}

function compareCandidates(left: CandidateObservation, right: CandidateObservation): number {
  const provider =
    SMART_LENDING_PROVIDER_IDS.indexOf(left.providerId) -
    SMART_LENDING_PROVIDER_IDS.indexOf(right.providerId);
  if (provider !== 0) return provider;
  const symbol = left.assetSymbol.localeCompare(right.assetSymbol);
  if (symbol !== 0) return symbol;
  if (left.totalValueLockedUsdMantissa !== right.totalValueLockedUsdMantissa) {
    return left.totalValueLockedUsdMantissa > right.totalValueLockedUsdMantissa ? -1 : 1;
  }
  return left.marketId.localeCompare(right.marketId);
}

function boundedMarkets(
  candidates: readonly CandidateObservation[],
): readonly CandidateObservation[] {
  const counts = new Map<string, number>();
  return [...candidates].sort(compareCandidates).filter((candidate) => {
    const key = `${candidate.providerId}\u0000${candidate.assetSymbol}`;
    const count = counts.get(key) ?? 0;
    if (count >= MAX_MARKETS_PER_PROVIDER_ASSET) return false;
    counts.set(key, count + 1);
    return true;
  });
}

function fingerprint(candidates: readonly CandidateObservation[]): string {
  const canonical = candidates.map((candidate) => ({
    providerId: candidate.providerId,
    sourceProject: candidate.sourceProject,
    networkId: candidate.networkId,
    marketId: candidate.marketId,
    assetId: candidate.assetId,
    assetSymbol: candidate.assetSymbol,
    grossApyBasisPoints: candidate.grossApyBasisPoints.toString(),
    totalValueLockedUsdMantissa: candidate.totalValueLockedUsdMantissa.toString(),
  }));
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export function parseDefiLlamaMarketFeed(
  value: unknown,
  retrievedAtValue: unknown,
): LiveLendingMarketSnapshot {
  const retrievedAt = canonicalTimestamp(retrievedAtValue);
  const rawPools = ownDataArray(ownDataValue(value, 'data'), MAX_UPSTREAM_POOLS);
  const candidates: CandidateObservation[] = [];
  for (const rawPool of rawPools) {
    try {
      const candidate = parseCandidate(rawPool);
      if (candidate) candidates.push(candidate);
    } catch (error) {
      if (!(error instanceof DefiLlamaMarketFeedValidationError)) throw error;
      // Heterogeneous unrelated rows are ignored. Exact coverage below still
      // fails the complete snapshot closed if a required provider disappears.
    }
  }
  const selected = boundedMarkets(candidates);
  const coverage = SMART_LENDING_PROVIDER_IDS.filter((providerId) =>
    selected.some((candidate) => candidate.providerId === providerId),
  );
  if (coverage.length !== SMART_LENDING_PROVIDER_IDS.length) return fail();
  const digest = fingerprint(selected);
  const validUntil = new Date(Date.parse(retrievedAt) + INDICATIVE_TTL_MILLISECONDS).toISOString();
  const observations = Object.freeze(
    selected.map((candidate) =>
      Object.freeze({
        providerId: candidate.providerId,
        networkId: candidate.networkId,
        marketId: candidate.marketId,
        assetId: candidate.assetId,
        assetSymbol: candidate.assetSymbol,
        assetDecimals: candidate.assetDecimals,
        grossApyBasisPoints: candidate.grossApyBasisPoints,
        totalValueLockedUsdMantissa: candidate.totalValueLockedUsdMantissa,
        evidenceReferenceId: `${candidate.evidenceReferenceId}:${digest}`,
      }),
    ),
  );
  return Object.freeze({
    schemaVersion: 1 as const,
    source: 'DEFILLAMA_YIELDS' as const,
    use: 'INDICATIVE_CORROBORATION_ONLY' as const,
    mayEstablishRecommendationEligibility: false as const,
    snapshotId: `defillama-yields:${digest}`,
    fingerprintSha256: digest,
    retrievedAt,
    validUntil,
    providerCoverage: Object.freeze([...coverage]),
    observations,
  });
}
