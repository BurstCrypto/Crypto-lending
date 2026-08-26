import { Injectable } from '@nestjs/common';

import {
  YIELD_OPPORTUNITY_SCHEMA_VERSION,
  normalizeYieldOpportunityV1,
  yieldDecimalFromString,
  yieldDecimalToString,
} from '../yield';
import {
  KAMINO_YIELD_SNAPSHOT,
  type KaminoYieldOpportunitySnapshot,
} from './kamino-yield-catalog.snapshot';
import {
  MORPHO_YIELD_SNAPSHOT,
  type MorphoYieldOpportunitySnapshot,
} from './morpho-yield-catalog.snapshot';

const DECIMAL_TEXT = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const USD_MINOR = /^(?:0|[1-9][0-9]{0,17})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_SELECTED_OPPORTUNITIES_PER_ECOSYSTEM = 2;

export const LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID = 'managed-rate-snapshot-v2' as const;

export const LOCAL_DEMO_YIELD_ECOSYSTEMS = Object.freeze(['EVM', 'SOLANA'] as const);
export const LOCAL_DEMO_YIELD_ASSET_SYMBOLS = Object.freeze(['USDC', 'USDT'] as const);
export const LOCAL_DEMO_YIELD_PROVIDER_IDS = Object.freeze(['MORPHO', 'KAMINO'] as const);
export const LOCAL_DEMO_YIELD_NETWORK_IDS = Object.freeze([
  'eip155:1',
  'eip155:8453',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
] as const);

export type LocalDemoYieldEcosystem = (typeof LOCAL_DEMO_YIELD_ECOSYSTEMS)[number];
export type LocalDemoYieldAssetSymbol = (typeof LOCAL_DEMO_YIELD_ASSET_SYMBOLS)[number];
export type LocalDemoYieldProviderId = (typeof LOCAL_DEMO_YIELD_PROVIDER_IDS)[number];
export type LocalDemoYieldNetworkId = (typeof LOCAL_DEMO_YIELD_NETWORK_IDS)[number];
export type LocalDemoYieldCatalogFreshness = 'CURRENT' | 'STALE';

export interface LocalDemoCustomYieldFilters {
  readonly assetSymbols: readonly LocalDemoYieldAssetSymbol[];
  readonly providerIds: readonly LocalDemoYieldProviderId[];
  readonly networkIds: readonly LocalDemoYieldNetworkId[];
  readonly minimumApyBasisPoints: number;
  readonly minimumTvlUsdMinor: string;
  readonly minimumExitLiquidityUsdMinor: string;
  readonly maximumUtilizationBasisPoints: number;
}

export interface LocalDemoYieldRewardApr {
  readonly assetSymbol: string;
  readonly rateDecimal: string;
  readonly basisPoints: number;
}

export interface LocalDemoYieldOpportunitySummary {
  readonly opportunityId: string;
  readonly ecosystem: LocalDemoYieldEcosystem;
  readonly provider: Readonly<{
    id: LocalDemoYieldProviderId;
    name: 'Morpho' | 'Kamino';
  }>;
  readonly protocol: Readonly<{
    id: 'MORPHO_BLUE' | 'KAMINO_LEND';
    name: 'Morpho Blue' | 'Kamino Lend';
    marketId: string;
  }>;
  readonly asset: Readonly<{
    symbol: LocalDemoYieldAssetSymbol;
    contract: string;
    decimals: 6;
  }>;
  readonly network: Readonly<{
    id: LocalDemoYieldNetworkId;
    name: 'Ethereum' | 'Base' | 'Solana';
  }>;
  readonly apy: Readonly<{
    baseRateDecimal: string;
    baseBasisPoints: number;
    observedAt: string;
    rewardAprs: readonly LocalDemoYieldRewardApr[];
    providerFee:
      | Readonly<{
          status: 'REPORTED';
          rateDecimal: string;
          basisPoints: number;
        }>
      | Readonly<{
          status: 'NOT_REPORTED';
          rateDecimal: null;
          basisPoints: null;
        }>;
  }>;
  readonly tvl: Readonly<{
    sourceAmountUsdDecimal: string;
    amountUsdMinor: string;
    observedAt: string;
  }>;
  readonly exitLiquidity: Readonly<{
    sourceAmountUsdDecimal: string;
    amountUsdMinor: string;
    observedAt: string;
    interpretation: 'AVAILABLE_TO_BORROW_PROXY';
  }>;
  readonly utilization: Readonly<{
    rateDecimal: string;
    basisPoints: number;
    observedAt: string;
  }>;
  readonly availability: Readonly<{
    status: 'LISTED_ONLY';
    providerListed: true;
    depositsEnabled: 'NOT_VERIFIED';
    withdrawalsEnabled: 'NOT_VERIFIED';
    asOf: string;
  }>;
  readonly provenance: Readonly<{
    sourceKind: 'API';
    sourceId: string;
    sourceReference: string;
    sourceObservedAt: string;
    retrievedAt: string;
    payloadSha256: string;
    normalizerId: 'morpho-local-demo-snapshot' | 'kamino-local-demo-snapshot';
    normalizerVersion: '1.0.0';
    attributes: readonly Readonly<{ key: string; value: string }>[];
  }>;
}

export interface LocalDemoYieldCatalogMetadata {
  readonly snapshotId: typeof LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID;
  readonly capturedAt: string;
  readonly staleAfter: string;
  readonly freshness: LocalDemoYieldCatalogFreshness;
  readonly staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE';
  readonly riskClassificationAvailable: false;
  readonly riskClassification: 'NOT_ASSESSED';
}

export interface LocalDemoYieldCatalogResponse {
  readonly use: 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY';
  readonly mayAuthorizeFinancialAction: false;
  readonly riskClassificationAvailable: false;
  readonly strategyMode: 'PORTFOLIO_CROSS_CHAIN_BLEND';
  readonly ecosystems: readonly ['EVM', 'SOLANA'];
  readonly snapshot: Readonly<{
    id: typeof LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID;
    capturedAt: string;
    staleAfter: string;
    freshness: LocalDemoYieldCatalogFreshness;
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE';
    riskClassification: 'NOT_ASSESSED';
  }>;
}

export interface LocalDemoYieldCatalogSelection {
  readonly metadata: LocalDemoYieldCatalogMetadata;
  readonly matchedOpportunities: readonly LocalDemoYieldOpportunitySummary[];
  readonly selectedOpportunities: readonly LocalDemoYieldOpportunitySummary[];
}

export class LocalDemoYieldCatalogUnavailableError extends Error {
  constructor() {
    super('Local demo yield catalog is unavailable');
    this.name = 'LocalDemoYieldCatalogUnavailableError';
  }
}

export class LocalDemoNoMatchingYieldOpportunitiesError extends Error {
  constructor() {
    super('The managed yield strategy is unavailable for this snapshot');
    this.name = 'LocalDemoNoMatchingYieldOpportunitiesError';
  }
}

interface ParsedDecimal {
  readonly numerator: bigint;
  readonly scale: number;
}

function parseDecimal(value: string): ParsedDecimal {
  if (!DECIMAL_TEXT.test(value)) throw new TypeError('invalid managed-yield snapshot decimal');
  const [whole, fraction = ''] = value.split('.');
  if (whole === undefined) throw new TypeError('invalid managed-yield snapshot decimal');
  return Object.freeze({ numerator: BigInt(`${whole}${fraction}`), scale: fraction.length });
}

function decimalDenominator(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function decimalToBasisPoints(value: string): number {
  const parsed = parseDecimal(value);
  const result = (parsed.numerator * 10_000n) / decimalDenominator(parsed.scale);
  if (result > 10_000n || result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('managed-yield snapshot ratio exceeds local-demo limits');
  }
  return Number(result);
}

function decimalToUsdMinor(value: string): string {
  const parsed = parseDecimal(value);
  const result = (parsed.numerator * 100n) / decimalDenominator(parsed.scale);
  const canonical = result.toString();
  if (!USD_MINOR.test(canonical)) {
    throw new TypeError('managed-yield snapshot USD amount exceeds limits');
  }
  return canonical;
}

function compareDecimals(left: string, right: string): number {
  const leftValue = parseDecimal(left);
  const rightValue = parseDecimal(right);
  const scale = Math.max(leftValue.scale, rightValue.scale);
  const leftScaled = leftValue.numerator * decimalDenominator(scale - leftValue.scale);
  const rightScaled = rightValue.numerator * decimalDenominator(scale - rightValue.scale);
  return leftScaled === rightScaled ? 0 : leftScaled > rightScaled ? 1 : -1;
}

function compareDecimalToBasisPoints(value: string, basisPoints: number): number {
  return compareDecimals(
    value,
    `${Math.floor(basisPoints / 10_000)}.${String(basisPoints % 10_000).padStart(4, '0')}`,
  );
}

function renderDecimal(numerator: bigint, scale: number): string {
  if (numerator < 0n || !Number.isSafeInteger(scale) || scale < 0 || scale > 96) {
    throw new TypeError('invalid managed-yield decimal result');
  }
  if (scale === 0) return numerator.toString();
  const digits = numerator.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function subtractDecimals(minuend: string, subtrahend: string): string {
  const left = parseDecimal(minuend);
  const right = parseDecimal(subtrahend);
  const scale = Math.max(left.scale, right.scale);
  const difference =
    left.numerator * decimalDenominator(scale - left.scale) -
    right.numerator * decimalDenominator(scale - right.scale);
  if (difference < 0n) throw new TypeError('invalid managed-yield liquidity values');
  return renderDecimal(difference, scale);
}

function divideDecimals(numeratorValue: string, denominatorValue: string, scale: number): string {
  const numerator = parseDecimal(numeratorValue);
  const denominator = parseDecimal(denominatorValue);
  if (denominator.numerator === 0n) throw new TypeError('invalid managed-yield ratio divisor');
  const scaled =
    (numerator.numerator * decimalDenominator(denominator.scale + scale)) /
    (denominator.numerator * decimalDenominator(numerator.scale));
  return renderDecimal(scaled, scale);
}

function canonicalTimestamp(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError('invalid managed-yield snapshot timestamp');
  }
  return value;
}

function safeText(value: string, maximumLength = 192): string {
  if (
    value.length < 1 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  ) {
    throw new TypeError('invalid managed-yield snapshot text');
  }
  return value;
}

function normalizeRewardAprs(
  opportunity: MorphoYieldOpportunitySnapshot,
): readonly LocalDemoYieldRewardApr[] {
  return Object.freeze(
    opportunity.rewardAprs.map((reward) => {
      if (
        reward.networkId !== opportunity.networkId ||
        !Number.isSafeInteger(reward.assetDecimals) ||
        reward.assetDecimals < 0 ||
        reward.assetDecimals > 255
      ) {
        throw new TypeError('invalid Morpho reward identity');
      }
      return Object.freeze({
        assetSymbol: safeText(reward.assetSymbol, 32),
        rateDecimal: yieldDecimalToString(yieldDecimalFromString(reward.rateDecimal)),
        basisPoints: decimalToBasisPoints(reward.rateDecimal),
      });
    }),
  );
}

function normalizeMorphoOpportunity(
  opportunity: MorphoYieldOpportunitySnapshot,
): LocalDemoYieldOpportunitySummary {
  if (
    !LOCAL_DEMO_YIELD_ASSET_SYMBOLS.includes(opportunity.assetSymbol) ||
    !LOCAL_DEMO_YIELD_NETWORK_IDS.includes(opportunity.networkId) ||
    opportunity.assetDecimals !== 6 ||
    opportunity.providerListed !== true ||
    opportunity.riskClassification !== 'NOT_ASSESSED' ||
    opportunity.mayAuthorizeFinancialAction !== false
  ) {
    throw new TypeError('invalid Morpho opportunity policy boundary');
  }
  const observedAt = canonicalTimestamp(opportunity.providerObservedAt);
  const attributes = Object.freeze([
    Object.freeze({
      key: 'chain.last_indexed_block',
      value: safeText(opportunity.lastIndexedBlock),
    }),
    Object.freeze({
      key: 'market.collateral_symbol',
      value: safeText(opportunity.collateralSymbol),
    }),
    Object.freeze({
      key: 'market.collateral_contract',
      value: safeText(opportunity.collateralContract),
    }),
    Object.freeze({
      key: 'snapshot.request_sha256',
      value: MORPHO_YIELD_SNAPSHOT.source.requestBodySha256,
    }),
    Object.freeze({ key: 'snapshot.risk_classification', value: 'NOT_ASSESSED' }),
    Object.freeze({ key: 'snapshot.raw_response_retained', value: 'false' }),
  ]);
  if (!SHA256.test(MORPHO_YIELD_SNAPSHOT.source.responseSha256)) {
    throw new TypeError('invalid Morpho snapshot provenance');
  }

  const normalized = normalizeYieldOpportunityV1({
    schemaVersion: YIELD_OPPORTUNITY_SCHEMA_VERSION,
    opportunityId: opportunity.opportunityId,
    provider: { id: 'MORPHO', name: 'Morpho' },
    protocol: { id: 'MORPHO_BLUE', name: 'Morpho Blue', marketId: opportunity.marketId },
    asset: {
      symbol: opportunity.assetSymbol,
      contract: opportunity.assetContract,
      decimals: opportunity.assetDecimals,
    },
    chain: { id: opportunity.networkId, name: opportunity.networkName },
    apy: { rate: yieldDecimalFromString(opportunity.apyRateDecimal), asOf: observedAt },
    tvl: {
      amount: { value: yieldDecimalFromString(opportunity.tvlUsdDecimal), denomination: 'USD' },
      asOf: observedAt,
    },
    utilization: {
      rate: yieldDecimalFromString(opportunity.utilizationRateDecimal),
      asOf: observedAt,
    },
    exitLiquidity: {
      amount: {
        value: yieldDecimalFromString(opportunity.exitLiquidityUsdDecimal),
        denomination: 'USD',
      },
      asOf: observedAt,
    },
    fees: {
      status: 'REPORTED',
      entries: [
        {
          kind: 'PROTOCOL',
          label: 'Morpho market borrow-interest fee',
          charge: {
            kind: 'RATE',
            rate: yieldDecimalFromString(opportunity.providerFeeRateDecimal),
          },
        },
      ],
    },
    limits: { status: 'NOT_REPORTED', entries: [] },
    availability: {
      status: 'LIMITED',
      depositsEnabled: false,
      withdrawalsEnabled: false,
      asOf: observedAt,
      reasonCodes: ['PROVIDER_LISTED_ONLY'],
    },
    provenance: {
      sourceKind: 'API',
      sourceId: `${opportunity.networkId}:${opportunity.lastIndexedBlock}:${opportunity.marketId}`,
      sourceReference: MORPHO_YIELD_SNAPSHOT.source.reference,
      sourceObservedAt: observedAt,
      retrievedAt: MORPHO_YIELD_SNAPSHOT.source.retrievedAt,
      payloadSha256: MORPHO_YIELD_SNAPSHOT.source.responseSha256,
      normalizerId: 'morpho-local-demo-snapshot',
      normalizerVersion: '1.0.0',
      attributes,
    },
  });

  const providerFee = normalized.fees.entries[0];
  if (!providerFee || providerFee.charge.kind !== 'RATE') {
    throw new TypeError('missing Morpho provider fee');
  }
  return Object.freeze({
    opportunityId: normalized.opportunityId,
    ecosystem: 'EVM' as const,
    provider: Object.freeze({ id: 'MORPHO', name: 'Morpho' }),
    protocol: Object.freeze({
      id: 'MORPHO_BLUE',
      name: 'Morpho Blue',
      marketId: normalized.protocol.marketId,
    }),
    asset: Object.freeze({
      symbol: normalized.asset.symbol as LocalDemoYieldAssetSymbol,
      contract: normalized.asset.contract,
      decimals: 6 as const,
    }),
    network: Object.freeze({
      id: normalized.chain.id as LocalDemoYieldNetworkId,
      name: normalized.chain.name as 'Ethereum' | 'Base',
    }),
    apy: Object.freeze({
      baseRateDecimal: yieldDecimalToString(normalized.apy.rate),
      baseBasisPoints: decimalToBasisPoints(opportunity.apyRateDecimal),
      observedAt: normalized.apy.asOf,
      rewardAprs: normalizeRewardAprs(opportunity),
      providerFee: Object.freeze({
        status: 'REPORTED' as const,
        rateDecimal: yieldDecimalToString(providerFee.charge.rate),
        basisPoints: decimalToBasisPoints(opportunity.providerFeeRateDecimal),
      }),
    }),
    tvl: Object.freeze({
      sourceAmountUsdDecimal: yieldDecimalToString(normalized.tvl.amount.value),
      amountUsdMinor: decimalToUsdMinor(opportunity.tvlUsdDecimal),
      observedAt: normalized.tvl.asOf,
    }),
    exitLiquidity: Object.freeze({
      sourceAmountUsdDecimal: yieldDecimalToString(normalized.exitLiquidity.amount.value),
      amountUsdMinor: decimalToUsdMinor(opportunity.exitLiquidityUsdDecimal),
      observedAt: normalized.exitLiquidity.asOf,
      interpretation: 'AVAILABLE_TO_BORROW_PROXY' as const,
    }),
    utilization: Object.freeze({
      rateDecimal: yieldDecimalToString(normalized.utilization.rate),
      basisPoints: decimalToBasisPoints(opportunity.utilizationRateDecimal),
      observedAt: normalized.utilization.asOf,
    }),
    availability: Object.freeze({
      status: 'LISTED_ONLY' as const,
      providerListed: true as const,
      depositsEnabled: 'NOT_VERIFIED' as const,
      withdrawalsEnabled: 'NOT_VERIFIED' as const,
      asOf: normalized.availability.asOf,
    }),
    provenance: Object.freeze({
      sourceKind: 'API' as const,
      sourceId: normalized.provenance.sourceId,
      sourceReference: normalized.provenance.sourceReference,
      sourceObservedAt: normalized.provenance.sourceObservedAt,
      retrievedAt: normalized.provenance.retrievedAt,
      payloadSha256: normalized.provenance.payloadSha256,
      normalizerId: 'morpho-local-demo-snapshot' as const,
      normalizerVersion: '1.0.0' as const,
      attributes: normalized.provenance.attributes,
    }),
  });
}

function normalizeKaminoOpportunity(
  opportunity: KaminoYieldOpportunitySnapshot,
): LocalDemoYieldOpportunitySummary {
  if (
    opportunity.assetSymbol !== 'USDC' ||
    opportunity.assetDecimals !== 6 ||
    opportunity.networkId !== 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' ||
    opportunity.networkName !== 'Solana' ||
    opportunity.providerListed !== true ||
    opportunity.riskClassification !== 'NOT_ASSESSED' ||
    opportunity.mayAuthorizeFinancialAction !== false
  ) {
    throw new TypeError('invalid Kamino opportunity policy boundary');
  }
  const observedAt = canonicalTimestamp(opportunity.providerObservedAt);
  const exitLiquidityUsdDecimal = subtractDecimals(
    opportunity.totalSupplyUsdDecimal,
    opportunity.totalBorrowUsdDecimal,
  );
  const utilizationRateDecimal = divideDecimals(
    opportunity.totalBorrowUsdDecimal,
    opportunity.totalSupplyUsdDecimal,
    18,
  );
  if (!SHA256.test(KAMINO_YIELD_SNAPSHOT.source.responseSha256)) {
    throw new TypeError('invalid Kamino snapshot provenance');
  }
  const attributes = Object.freeze([
    Object.freeze({ key: 'market.lending_market', value: safeText(opportunity.marketId) }),
    Object.freeze({ key: 'market.reserve', value: safeText(opportunity.reserveId) }),
    Object.freeze({ key: 'snapshot.risk_classification', value: 'NOT_ASSESSED' }),
    Object.freeze({ key: 'snapshot.raw_response_retained', value: 'false' }),
  ]);
  const normalized = normalizeYieldOpportunityV1({
    schemaVersion: YIELD_OPPORTUNITY_SCHEMA_VERSION,
    opportunityId: opportunity.opportunityId,
    provider: { id: 'KAMINO', name: 'Kamino' },
    protocol: { id: 'KAMINO_LEND', name: 'Kamino Lend', marketId: opportunity.reserveId },
    asset: {
      symbol: opportunity.assetSymbol,
      contract: opportunity.assetMint,
      decimals: opportunity.assetDecimals,
    },
    chain: { id: opportunity.networkId, name: opportunity.networkName },
    apy: { rate: yieldDecimalFromString(opportunity.supplyApyRateDecimal), asOf: observedAt },
    tvl: {
      amount: {
        value: yieldDecimalFromString(opportunity.totalSupplyUsdDecimal),
        denomination: 'USD',
      },
      asOf: observedAt,
    },
    utilization: {
      rate: yieldDecimalFromString(utilizationRateDecimal),
      asOf: observedAt,
    },
    exitLiquidity: {
      amount: {
        value: yieldDecimalFromString(exitLiquidityUsdDecimal),
        denomination: 'USD',
      },
      asOf: observedAt,
    },
    fees: { status: 'NOT_REPORTED', entries: [] },
    limits: { status: 'NOT_REPORTED', entries: [] },
    availability: {
      status: 'LIMITED',
      depositsEnabled: false,
      withdrawalsEnabled: false,
      asOf: observedAt,
      reasonCodes: ['PROVIDER_LISTED_ONLY'],
    },
    provenance: {
      sourceKind: 'API',
      sourceId: `${opportunity.networkId}:${opportunity.marketId}:${opportunity.reserveId}`,
      sourceReference: KAMINO_YIELD_SNAPSHOT.source.reference,
      sourceObservedAt: observedAt,
      retrievedAt: KAMINO_YIELD_SNAPSHOT.capturedAt,
      payloadSha256: KAMINO_YIELD_SNAPSHOT.source.responseSha256,
      normalizerId: 'kamino-local-demo-snapshot',
      normalizerVersion: '1.0.0',
      attributes,
    },
  });

  return Object.freeze({
    opportunityId: normalized.opportunityId,
    ecosystem: 'SOLANA' as const,
    provider: Object.freeze({ id: 'KAMINO' as const, name: 'Kamino' as const }),
    protocol: Object.freeze({
      id: 'KAMINO_LEND' as const,
      name: 'Kamino Lend' as const,
      marketId: normalized.protocol.marketId,
    }),
    asset: Object.freeze({
      symbol: normalized.asset.symbol as LocalDemoYieldAssetSymbol,
      contract: normalized.asset.contract,
      decimals: 6 as const,
    }),
    network: Object.freeze({
      id: normalized.chain.id as LocalDemoYieldNetworkId,
      name: 'Solana' as const,
    }),
    apy: Object.freeze({
      baseRateDecimal: yieldDecimalToString(normalized.apy.rate),
      baseBasisPoints: decimalToBasisPoints(opportunity.supplyApyRateDecimal),
      observedAt: normalized.apy.asOf,
      rewardAprs: Object.freeze([]),
      providerFee: Object.freeze({
        status: 'NOT_REPORTED' as const,
        rateDecimal: null,
        basisPoints: null,
      }),
    }),
    tvl: Object.freeze({
      sourceAmountUsdDecimal: yieldDecimalToString(normalized.tvl.amount.value),
      amountUsdMinor: decimalToUsdMinor(opportunity.totalSupplyUsdDecimal),
      observedAt: normalized.tvl.asOf,
    }),
    exitLiquidity: Object.freeze({
      sourceAmountUsdDecimal: yieldDecimalToString(normalized.exitLiquidity.amount.value),
      amountUsdMinor: decimalToUsdMinor(exitLiquidityUsdDecimal),
      observedAt: normalized.exitLiquidity.asOf,
      interpretation: 'AVAILABLE_TO_BORROW_PROXY' as const,
    }),
    utilization: Object.freeze({
      rateDecimal: yieldDecimalToString(normalized.utilization.rate),
      basisPoints: decimalToBasisPoints(utilizationRateDecimal),
      observedAt: normalized.utilization.asOf,
    }),
    availability: Object.freeze({
      status: 'LISTED_ONLY' as const,
      providerListed: true as const,
      depositsEnabled: 'NOT_VERIFIED' as const,
      withdrawalsEnabled: 'NOT_VERIFIED' as const,
      asOf: normalized.availability.asOf,
    }),
    provenance: Object.freeze({
      sourceKind: 'API' as const,
      sourceId: normalized.provenance.sourceId,
      sourceReference: normalized.provenance.sourceReference,
      sourceObservedAt: normalized.provenance.sourceObservedAt,
      retrievedAt: normalized.provenance.retrievedAt,
      payloadSha256: normalized.provenance.payloadSha256,
      normalizerId: 'kamino-local-demo-snapshot' as const,
      normalizerVersion: '1.0.0' as const,
      attributes: normalized.provenance.attributes,
    }),
  });
}

const MANAGED_RATE_SNAPSHOT_CAPTURED_AT = '2026-08-26T21:20:06.659Z';
const MANAGED_RATE_SNAPSHOT_STALE_AFTER = '2026-08-27T14:14:54.580Z';

function parseSnapshot(): readonly LocalDemoYieldOpportunitySummary[] {
  canonicalTimestamp(MORPHO_YIELD_SNAPSHOT.capturedAt);
  canonicalTimestamp(MORPHO_YIELD_SNAPSHOT.staleAfter);
  canonicalTimestamp(KAMINO_YIELD_SNAPSHOT.capturedAt);
  canonicalTimestamp(KAMINO_YIELD_SNAPSHOT.staleAfter);
  if (
    MORPHO_YIELD_SNAPSHOT.schemaVersion !== 1 ||
    MORPHO_YIELD_SNAPSHOT.use !== 'LOCAL_DEMO_STATIC_CAPTURE_ONLY' ||
    MORPHO_YIELD_SNAPSHOT.staleBehavior !== 'LABEL_STALE_KEEP_NON_EXECUTABLE' ||
    MORPHO_YIELD_SNAPSHOT.mayAuthorizeFinancialAction !== false ||
    MORPHO_YIELD_SNAPSHOT.source.providerId !== 'MORPHO_PUBLIC_API' ||
    MORPHO_YIELD_SNAPSHOT.source.reference !== 'https://api.morpho.org/graphql' ||
    MORPHO_YIELD_SNAPSHOT.source.rawResponseRetained !== false ||
    Date.parse(MORPHO_YIELD_SNAPSHOT.staleAfter) <= Date.parse(MORPHO_YIELD_SNAPSHOT.capturedAt)
  ) {
    throw new TypeError('invalid Morpho snapshot boundary');
  }
  if (
    KAMINO_YIELD_SNAPSHOT.schemaVersion !== 1 ||
    KAMINO_YIELD_SNAPSHOT.use !== 'LOCAL_DEMO_STATIC_CAPTURE_ONLY' ||
    KAMINO_YIELD_SNAPSHOT.staleBehavior !== 'LABEL_STALE_KEEP_NON_EXECUTABLE' ||
    KAMINO_YIELD_SNAPSHOT.mayAuthorizeFinancialAction !== false ||
    KAMINO_YIELD_SNAPSHOT.source.providerId !== 'KAMINO_PUBLIC_API' ||
    KAMINO_YIELD_SNAPSHOT.source.protocolId !== 'KAMINO_LEND' ||
    KAMINO_YIELD_SNAPSHOT.source.reference !==
      'https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/reserves/metrics?env=mainnet-beta' ||
    KAMINO_YIELD_SNAPSHOT.source.rawResponseRetained !== false ||
    Date.parse(KAMINO_YIELD_SNAPSHOT.staleAfter) <= Date.parse(KAMINO_YIELD_SNAPSHOT.capturedAt)
  ) {
    throw new TypeError('invalid Kamino snapshot boundary');
  }
  if (
    MANAGED_RATE_SNAPSHOT_CAPTURED_AT !== KAMINO_YIELD_SNAPSHOT.capturedAt ||
    MANAGED_RATE_SNAPSHOT_STALE_AFTER !== MORPHO_YIELD_SNAPSHOT.staleAfter ||
    Date.parse(MANAGED_RATE_SNAPSHOT_STALE_AFTER) <= Date.parse(MANAGED_RATE_SNAPSHOT_CAPTURED_AT)
  ) {
    throw new TypeError('invalid managed-rate snapshot boundary');
  }
  const normalized = Object.freeze([
    ...MORPHO_YIELD_SNAPSHOT.opportunities.map(normalizeMorphoOpportunity),
    ...KAMINO_YIELD_SNAPSHOT.opportunities.map(normalizeKaminoOpportunity),
  ]);
  if (
    normalized.length < 1 ||
    normalized.length > 64 ||
    new Set(normalized.map(({ opportunityId }) => opportunityId)).size !== normalized.length ||
    LOCAL_DEMO_YIELD_ECOSYSTEMS.some(
      (ecosystem) => !normalized.some((opportunity) => opportunity.ecosystem === ecosystem),
    ) ||
    LOCAL_DEMO_YIELD_PROVIDER_IDS.some(
      (providerId) => !normalized.some((opportunity) => opportunity.provider.id === providerId),
    )
  ) {
    throw new TypeError('invalid managed-yield snapshot catalog');
  }
  return normalized;
}

let parsedSnapshot: readonly LocalDemoYieldOpportunitySummary[] | null = null;
try {
  parsedSnapshot = parseSnapshot();
} catch {
  parsedSnapshot = null;
}

function catalogMetadata(now: Date): LocalDemoYieldCatalogMetadata {
  const nowMilliseconds = now.getTime();
  const capturedAtMilliseconds = Date.parse(MANAGED_RATE_SNAPSHOT_CAPTURED_AT);
  if (!Number.isFinite(nowMilliseconds) || nowMilliseconds < capturedAtMilliseconds) {
    throw new LocalDemoYieldCatalogUnavailableError();
  }
  return Object.freeze({
    snapshotId: LOCAL_DEMO_PUBLIC_RATE_SNAPSHOT_ID,
    capturedAt: MANAGED_RATE_SNAPSHOT_CAPTURED_AT,
    staleAfter: MANAGED_RATE_SNAPSHOT_STALE_AFTER,
    freshness:
      nowMilliseconds < Date.parse(MANAGED_RATE_SNAPSHOT_STALE_AFTER) ? 'CURRENT' : 'STALE',
    staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
    riskClassificationAvailable: false,
    riskClassification: 'NOT_ASSESSED',
  });
}

function assertUniqueMembers<const Value extends string>(
  values: readonly Value[],
  allowed: readonly Value[],
): void {
  if (
    values.length < 1 ||
    values.length > allowed.length ||
    new Set(values).size !== values.length ||
    values.some((value) => !allowed.includes(value))
  ) {
    throw new TypeError('invalid local demo yield filters');
  }
}

export function assertLocalDemoCustomYieldFilters(
  filters: LocalDemoCustomYieldFilters,
): LocalDemoCustomYieldFilters {
  assertUniqueMembers(filters.assetSymbols, LOCAL_DEMO_YIELD_ASSET_SYMBOLS);
  assertUniqueMembers(filters.providerIds, LOCAL_DEMO_YIELD_PROVIDER_IDS);
  assertUniqueMembers(filters.networkIds, LOCAL_DEMO_YIELD_NETWORK_IDS);
  for (const basisPoints of [
    filters.minimumApyBasisPoints,
    filters.maximumUtilizationBasisPoints,
  ]) {
    if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
      throw new TypeError('invalid local demo yield filters');
    }
  }
  if (
    !USD_MINOR.test(filters.minimumTvlUsdMinor) ||
    !USD_MINOR.test(filters.minimumExitLiquidityUsdMinor)
  ) {
    throw new TypeError('invalid local demo yield filters');
  }
  return filters;
}

function matchesFilters(
  opportunity: LocalDemoYieldOpportunitySummary,
  filters: LocalDemoCustomYieldFilters,
): boolean {
  return (
    filters.assetSymbols.includes(opportunity.asset.symbol) &&
    filters.providerIds.includes(opportunity.provider.id) &&
    filters.networkIds.includes(opportunity.network.id) &&
    compareDecimalToBasisPoints(opportunity.apy.baseRateDecimal, filters.minimumApyBasisPoints) >=
      0 &&
    BigInt(opportunity.tvl.amountUsdMinor) >= BigInt(filters.minimumTvlUsdMinor) &&
    BigInt(opportunity.exitLiquidity.amountUsdMinor) >=
      BigInt(filters.minimumExitLiquidityUsdMinor) &&
    compareDecimalToBasisPoints(
      opportunity.utilization.rateDecimal,
      filters.maximumUtilizationBasisPoints,
    ) <= 0 &&
    opportunity.availability.status === 'LISTED_ONLY' &&
    opportunity.availability.providerListed
  );
}

function rankOpportunities(
  opportunities: readonly LocalDemoYieldOpportunitySummary[],
): readonly LocalDemoYieldOpportunitySummary[] {
  return Object.freeze(
    [...opportunities].sort((left, right) => {
      const apyOrder = compareDecimals(right.apy.baseRateDecimal, left.apy.baseRateDecimal);
      return apyOrder === 0 ? left.opportunityId.localeCompare(right.opportunityId) : apyOrder;
    }),
  );
}

function ecosystemForNetwork(networkId: LocalDemoYieldNetworkId): LocalDemoYieldEcosystem {
  return networkId === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' ? 'SOLANA' : 'EVM';
}

function requestedEcosystems(
  filters: LocalDemoCustomYieldFilters | null,
): readonly LocalDemoYieldEcosystem[] {
  if (filters === null) return LOCAL_DEMO_YIELD_ECOSYSTEMS;
  return Object.freeze(
    LOCAL_DEMO_YIELD_ECOSYSTEMS.filter((ecosystem) =>
      filters.networkIds.some((networkId) => ecosystemForNetwork(networkId) === ecosystem),
    ),
  );
}

function selectPerEcosystem(
  matches: readonly LocalDemoYieldOpportunitySummary[],
  filters: LocalDemoCustomYieldFilters | null,
): readonly LocalDemoYieldOpportunitySummary[] {
  const selected: LocalDemoYieldOpportunitySummary[] = [];
  for (const ecosystem of requestedEcosystems(filters)) {
    const matchingEcosystem = rankOpportunities(
      matches.filter((opportunity) => opportunity.ecosystem === ecosystem),
    );
    if (matchingEcosystem.length === 0) throw new LocalDemoNoMatchingYieldOpportunitiesError();
    selected.push(...matchingEcosystem.slice(0, MAX_SELECTED_OPPORTUNITIES_PER_ECOSYSTEM));
  }
  return rankOpportunities(selected);
}

@Injectable()
export class LocalDemoYieldCatalogService {
  read(now = new Date()): LocalDemoYieldCatalogResponse {
    if (parsedSnapshot === null) throw new LocalDemoYieldCatalogUnavailableError();
    const metadata = catalogMetadata(now);
    return Object.freeze({
      use: 'LOCAL_DEMO_MANAGED_RATE_SNAPSHOT_ONLY',
      mayAuthorizeFinancialAction: false,
      riskClassificationAvailable: false,
      strategyMode: 'PORTFOLIO_CROSS_CHAIN_BLEND',
      ecosystems: LOCAL_DEMO_YIELD_ECOSYSTEMS,
      snapshot: Object.freeze({
        id: metadata.snapshotId,
        capturedAt: metadata.capturedAt,
        staleAfter: metadata.staleAfter,
        freshness: metadata.freshness,
        staleBehavior: metadata.staleBehavior,
        riskClassification: metadata.riskClassification,
      }),
    });
  }

  select(
    filters: LocalDemoCustomYieldFilters | null,
    now = new Date(),
  ): LocalDemoYieldCatalogSelection {
    const opportunities = parsedSnapshot;
    if (opportunities === null) throw new LocalDemoYieldCatalogUnavailableError();
    const metadata = catalogMetadata(now);
    if (filters !== null) assertLocalDemoCustomYieldFilters(filters);
    const matches = rankOpportunities(
      filters === null
        ? opportunities
        : opportunities.filter((opportunity) => matchesFilters(opportunity, filters)),
    );
    if (matches.length === 0) throw new LocalDemoNoMatchingYieldOpportunitiesError();
    const selectedOpportunities = selectPerEcosystem(matches, filters);
    return Object.freeze({
      metadata: Object.freeze({
        snapshotId: metadata.snapshotId,
        capturedAt: metadata.capturedAt,
        staleAfter: metadata.staleAfter,
        freshness: metadata.freshness,
        staleBehavior: metadata.staleBehavior,
        riskClassificationAvailable: false,
        riskClassification: metadata.riskClassification,
      }),
      matchedOpportunities: matches,
      selectedOpportunities,
    });
  }
}
