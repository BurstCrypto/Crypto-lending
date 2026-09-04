import { Inject, Injectable } from '@nestjs/common';

import { isAccountId, type AccountId } from '../../accounts/domain/account-profile';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoinAsset,
} from '../../blockchain/domain/supported-asset-registry';
import {
  STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
  evaluateStablecoinValuation,
  type StablecoinValuationAssetReference,
} from '../../valuation';
import {
  parseIndexedPortfolioBalanceSnapshot,
  PortfolioBalanceSnapshotValidationError,
} from '../domain/portfolio-balance-snapshot';
import { parseActivePortfolioWalletRegistrations } from '../domain/active-portfolio-wallet-registrations';
import {
  buildUnifiedPortfolio,
  PortfolioAggregationError,
  type PortfolioAssetReference,
  type UnifiedPortfolio,
  type ValuedPortfolioBalance,
} from '../domain/unified-portfolio';
import {
  PORTFOLIO_BALANCE_READER,
  type IndexedPortfolioBalanceObservation,
  type PortfolioBalanceReader,
} from './ports/portfolio-balance-reader.port';
import {
  PORTFOLIO_PRICE_EVIDENCE_READER,
  type PortfolioPriceEvidenceReader,
  type PortfolioPriceEvidenceSnapshot,
} from './ports/portfolio-price-evidence-reader.port';
import {
  PORTFOLIO_WALLET_REGISTRATION_READER,
  type PortfolioWalletRegistrationReader,
} from './ports/portfolio-wallet-registration-reader.port';
import { PortfolioUnavailableError } from './portfolio.errors';

const CORRELATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const MAX_PRICE_OBSERVATIONS = 8;
const MAX_PRICE_WATERMARKS = 8;

export const PORTFOLIO_CLOCK = Symbol('PORTFOLIO_CLOCK');

export interface PortfolioClock {
  now(): Date;
}

export const SYSTEM_PORTFOLIO_CLOCK: PortfolioClock = Object.freeze({
  now: (): Date => new Date(),
});

export interface ReadUnifiedPortfolioRequest {
  readonly accountId: AccountId;
  readonly correlationId: string;
}

interface SupportedBalance {
  readonly observation: IndexedPortfolioBalanceObservation;
  readonly registryAsset: SupportedStablecoinAsset;
  readonly asset: PortfolioAssetReference;
  readonly valuationAsset: StablecoinValuationAssetReference;
}

function unavailable(): never {
  throw new PortfolioUnavailableError();
}

function assetKey(asset: StablecoinValuationAssetReference): string {
  return `${asset.networkId}\u0000${asset.identity}`;
}

function dataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return null;
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function dataArray(value: unknown, maximum: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > maximum) {
      return null;
    }
    const expectedKeys = new Set([
      'length',
      ...Array.from({ length: length as number }, (_, index) => String(index)),
    ]);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.size ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
      return null;
    }
    const result: unknown[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch {
    return null;
  }
}

function parsePriceEvidence(value: unknown): PortfolioPriceEvidenceSnapshot | null {
  const record = dataRecord(value, ['snapshotId', 'observations', 'sourceWatermarks']);
  const observations =
    record === null ? null : dataArray(record.observations, MAX_PRICE_OBSERVATIONS);
  const sourceWatermarks =
    record === null ? null : dataArray(record.sourceWatermarks, MAX_PRICE_WATERMARKS);
  if (
    record === null ||
    typeof record.snapshotId !== 'string' ||
    !SAFE_SNAPSHOT_ID.test(record.snapshotId) ||
    observations === null ||
    sourceWatermarks === null
  ) {
    return null;
  }
  return Object.freeze({
    snapshotId: record.snapshotId,
    observations: observations as PortfolioPriceEvidenceSnapshot['observations'],
    sourceWatermarks: sourceWatermarks as PortfolioPriceEvidenceSnapshot['sourceWatermarks'],
  });
}

@Injectable()
export class PortfolioService {
  constructor(
    @Inject(PORTFOLIO_WALLET_REGISTRATION_READER)
    private readonly wallets: PortfolioWalletRegistrationReader,
    @Inject(PORTFOLIO_BALANCE_READER)
    private readonly balances: PortfolioBalanceReader,
    @Inject(PORTFOLIO_PRICE_EVIDENCE_READER)
    private readonly prices: PortfolioPriceEvidenceReader,
    @Inject(PORTFOLIO_CLOCK)
    private readonly clock: PortfolioClock,
  ) {}

  async readUnifiedPortfolio(request: ReadUnifiedPortfolioRequest): Promise<UnifiedPortfolio> {
    const requestRecord = dataRecord(request, ['accountId', 'correlationId']);
    if (
      requestRecord === null ||
      !isAccountId(requestRecord.accountId) ||
      typeof requestRecord.correlationId !== 'string' ||
      !CORRELATION_ID.test(requestRecord.correlationId)
    ) {
      return unavailable();
    }
    const accountId = requestRecord.accountId;
    const correlationId = requestRecord.correlationId;
    const asOf = this.trustedNow();

    let expectedWallets: ReturnType<typeof parseActivePortfolioWalletRegistrations>;
    let balanceSnapshot: ReturnType<typeof parseIndexedPortfolioBalanceSnapshot>;
    try {
      expectedWallets = parseActivePortfolioWalletRegistrations(
        await this.wallets.readActiveWalletRegistrations({
          accountId,
          evaluatedAt: asOf,
          correlationId,
        }),
      );
      balanceSnapshot = parseIndexedPortfolioBalanceSnapshot(
        await this.balances.readCurrentBalances({
          accountId,
          evaluatedAt: asOf,
          correlationId,
          expectedWallets,
        }),
        asOf,
        expectedWallets,
      );
    } catch {
      return unavailable();
    }

    const supported: SupportedBalance[] = [];
    const excluded: IndexedPortfolioBalanceObservation[] = [];
    for (const observation of balanceSnapshot.observations) {
      const registryAsset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(
        observation.networkId,
        observation.assetIdentity,
      );
      if (registryAsset === undefined) {
        excluded.push(observation);
        continue;
      }
      const references = this.assetReferences(registryAsset);
      supported.push({ observation, registryAsset, ...references });
    }

    const evidenceByAsset = new Map<string, PortfolioPriceEvidenceSnapshot | null>();
    const uniqueAssets = [
      ...new Map(
        supported.map(({ valuationAsset }) => [assetKey(valuationAsset), valuationAsset]),
      ).values(),
    ].sort((left, right) => assetKey(left).localeCompare(assetKey(right)));
    for (const asset of uniqueAssets) {
      evidenceByAsset.set(
        assetKey(asset),
        await this.safeReadPriceEvidence(asset, asOf, correlationId),
      );
    }

    const valuedBalances: ValuedPortfolioBalance[] = supported.map((balance) => {
      const evidence = evidenceByAsset.get(assetKey(balance.valuationAsset)) ?? null;
      return {
        observation: balance.observation,
        registryAsset: balance.registryAsset,
        asset: balance.asset,
        priceSnapshotId: evidence?.snapshotId ?? null,
        valuation: evaluateStablecoinValuation({
          asset: balance.valuationAsset,
          amountAtomic: balance.observation.amountAtomic,
          evaluatedAt: asOf,
          sourceWatermarks: evidence?.sourceWatermarks ?? STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
          observations: evidence?.observations ?? [],
        }),
      };
    });

    try {
      return buildUnifiedPortfolio({
        asOf,
        balanceSnapshotId: balanceSnapshot.snapshotId,
        balanceCapturedAt: balanceSnapshot.capturedAt,
        balanceSnapshotFreshness: balanceSnapshot.freshnessClass,
        balanceCoverage: balanceSnapshot.coverage,
        valuedBalances,
        excludedBalances: excluded,
      });
    } catch (error) {
      if (
        error instanceof PortfolioAggregationError ||
        error instanceof PortfolioBalanceSnapshotValidationError
      ) {
        return unavailable();
      }
      throw error;
    }
  }

  private assetReferences(registryAsset: SupportedStablecoinAsset): {
    readonly asset: PortfolioAssetReference;
    readonly valuationAsset: StablecoinValuationAssetReference;
  } {
    const snapshot = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
    if (snapshot.environment !== 'MAINNET' || snapshot.version !== 1) return unavailable();
    const common = {
      registryEnvironment: 'MAINNET' as const,
      registryVersion: 1 as const,
      registryFingerprintSha256: snapshot.fingerprintSha256,
      stablecoin: registryAsset.stablecoin,
      networkId: registryAsset.networkId,
      identity: registryAsset.identity,
      decimals: registryAsset.decimals,
    };
    return {
      asset: common,
      valuationAsset: common,
    };
  }

  private async safeReadPriceEvidence(
    asset: StablecoinValuationAssetReference,
    evaluatedAt: string,
    correlationId: string,
  ): Promise<PortfolioPriceEvidenceSnapshot | null> {
    try {
      return parsePriceEvidence(
        await this.prices.readPriceEvidence({ asset, evaluatedAt, correlationId }),
      );
    } catch {
      return null;
    }
  }

  private trustedNow(): string {
    try {
      const now = this.clock.now();
      if (
        typeof now !== 'object' ||
        now === null ||
        Object.getPrototypeOf(now) !== Date.prototype
      ) {
        return unavailable();
      }
      const milliseconds = Date.prototype.getTime.call(now);
      if (!Number.isFinite(milliseconds)) return unavailable();
      return Date.prototype.toISOString.call(now);
    } catch {
      return unavailable();
    }
  }
}
