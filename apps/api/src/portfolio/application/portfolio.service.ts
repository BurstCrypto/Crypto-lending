import { Inject, Injectable } from '@nestjs/common';

import type { AccountId } from '../../accounts/domain/account-profile';
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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  let actualKeys: string[];
  try {
    actualKeys = Object.keys(record);
  } catch {
    return null;
  }
  return actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key)) &&
    actualKeys.every((key) => keys.includes(key))
    ? record
    : null;
}

function parsePriceEvidence(value: unknown): PortfolioPriceEvidenceSnapshot | null {
  const record = dataRecord(value, ['snapshotId', 'observations', 'sourceWatermarks']);
  if (
    record === null ||
    typeof record.snapshotId !== 'string' ||
    !SAFE_SNAPSHOT_ID.test(record.snapshotId) ||
    !Array.isArray(record.observations) ||
    record.observations.length > MAX_PRICE_OBSERVATIONS ||
    !Array.isArray(record.sourceWatermarks) ||
    record.sourceWatermarks.length > MAX_PRICE_WATERMARKS
  ) {
    return null;
  }
  return {
    snapshotId: record.snapshotId,
    observations: [...record.observations] as PortfolioPriceEvidenceSnapshot['observations'],
    sourceWatermarks: [
      ...record.sourceWatermarks,
    ] as PortfolioPriceEvidenceSnapshot['sourceWatermarks'],
  };
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
    if (!CORRELATION_ID.test(request.correlationId)) return unavailable();
    const asOf = this.trustedNow();

    let expectedWallets: ReturnType<typeof parseActivePortfolioWalletRegistrations>;
    let balanceSnapshot: ReturnType<typeof parseIndexedPortfolioBalanceSnapshot>;
    try {
      expectedWallets = parseActivePortfolioWalletRegistrations(
        await this.wallets.readActiveWalletRegistrations({
          accountId: request.accountId,
          evaluatedAt: asOf,
          correlationId: request.correlationId,
        }),
      );
      balanceSnapshot = parseIndexedPortfolioBalanceSnapshot(
        await this.balances.readCurrentBalances({
          accountId: request.accountId,
          evaluatedAt: asOf,
          correlationId: request.correlationId,
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
        await this.safeReadPriceEvidence(asset, asOf, request.correlationId),
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
    const now = this.clock.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return unavailable();
    return now.toISOString();
  }
}
