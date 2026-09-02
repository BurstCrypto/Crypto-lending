import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { AccountId } from '../accounts/domain/account-profile';
import { BuyingPowerCalculator } from '../buying-power/application/buying-power-calculator';
import type {
  BuyingPowerAdjustmentPort,
  BuyingPowerAdjustmentRequest,
} from '../buying-power/application/ports/buying-power-adjustment.ports';
import type { BuyingPowerResult } from '../buying-power/domain/buying-power';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoinAsset,
  type SupportedStablecoin,
} from '../blockchain/domain/supported-asset-registry';
import {
  LOCAL_EVM_DEVELOPMENT_MANIFEST,
  normalizeLocalEvmDevelopmentAsset,
} from '../blockchain/domain/local-evm-development';
import type { BalanceSyncObservation } from '../blockchain-sync/domain/balance-sync';
import type { IndexedPortfolioBalanceObservation } from '../portfolio/application/ports/portfolio-balance-reader.port';
import { parseLocalDemoPortfolioBalanceSnapshot } from '../portfolio/domain/portfolio-balance-snapshot';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import {
  buildUnifiedPortfolio,
  type PortfolioSourceBreakdown,
  type UnifiedPortfolio,
  type ValuedPortfolioBalance,
} from '../portfolio/domain/unified-portfolio';
import {
  STABLECOIN_VALUATION_FEED_REFERENCES,
  STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
  evaluateStablecoinValuation,
  type StablecoinPriceObservation,
  type StablecoinValuationAssetReference,
} from '../valuation';
import {
  LOCAL_DEMO_PORTFOLIO_AS_OF,
  LocalDemoChainPipeline,
  type LocalDemoChainWallet,
} from './local-demo-chain.runtime';
import { LOCAL_EVM_CHAIN_RUNTIME, type LocalEvmChainRuntimePort } from './local-evm-chain.runtime';
import {
  LocalDemoWalletService,
  type LocalDemoWalletConnection,
} from './local-demo-wallet.service';

const MAINNET_SOLANA_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const PRICE_TIME = '2026-08-24T18:29:50.000Z';
const QUOTE_TIME = '2026-08-24T18:29:59.000Z';
const QUOTE_EXPIRY = '2026-08-24T18:35:00.000Z';
const SCALE_18_PER_USD_CENT = 10_000_000_000_000_000n;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const EVM_DEMO_CONNECTOR_NETWORK = 'eip155:11155111';
const SOLANA_DEMO_CONNECTOR_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

export type LocalDemoBuyingPowerDeductionCode =
  'LIQUIDITY' | 'CONVERSION' | 'SLIPPAGE' | 'NETWORK' | 'ROUTING';

export interface LocalDemoPortfolioAsset {
  readonly stablecoin: SupportedStablecoin;
  readonly assetIdentity: string;
  readonly amountAtomic: string;
  readonly decimals: 6;
  readonly portfolioValueUsdMinor: string;
  readonly buyingPowerUsdMinor: string;
  readonly buyingPowerAvailability: 'INCLUDED';
  readonly buyingPowerReason: null;
  readonly observedAt: string;
  readonly freshness: 'CURRENT';
}

export interface LocalDemoPortfolioChain {
  readonly networkId: string;
  readonly portfolioValueUsdMinor: string;
  readonly buyingPowerUsdMinor: string;
  readonly assets: readonly LocalDemoPortfolioAsset[];
}

export interface LocalDemoPortfolioWallet {
  readonly walletId: string;
  readonly label: string;
  readonly namespace: 'EVM' | 'SOLANA';
  readonly address: string;
  readonly portfolioValueUsdMinor: string;
  readonly buyingPowerUsdMinor: string;
  readonly chains: readonly LocalDemoPortfolioChain[];
}

export interface LocalDemoPortfolioResponse {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly asOf: string;
  readonly freshness: 'CURRENT';
  readonly portfolioValueUsdMinor: string;
  readonly buyingPower: Readonly<{
    status: 'AVAILABLE';
    amountUsdMinor: string;
    freshness: 'CURRENT';
    deductions: readonly Readonly<{
      code: LocalDemoBuyingPowerDeductionCode;
      amountUsdMinor: string;
    }>[];
    reasons: readonly never[];
  }>;
  readonly wallets: readonly LocalDemoPortfolioWallet[];
  readonly use: 'LOCAL_DEMO_ESTIMATE_ONLY';
  readonly mayAuthorizeFinancialAction: false;
}

export class LocalDemoPortfolioUnavailableError extends Error {
  readonly code = 'LOCAL_DEMO_PORTFOLIO_UNAVAILABLE' as const;

  constructor() {
    super('Local demo portfolio is unavailable');
    this.name = 'LocalDemoPortfolioUnavailableError';
  }
}

/**
 * Local-only composition root for KAN-63 through KAN-68. Connected wallet
 * ownership is preserved while EVM balances come from the fixed loopback LOCAL
 * chain and Solana/valuation inputs remain deterministic fixtures.
 */
@Injectable()
export class LocalDemoPortfolioService {
  private readonly chainPipeline: LocalDemoChainPipeline;

  constructor(
    private readonly walletService: LocalDemoWalletService,
    @Inject(LOCAL_EVM_CHAIN_RUNTIME) localEvm: LocalEvmChainRuntimePort,
  ) {
    this.chainPipeline = new LocalDemoChainPipeline(localEvm);
  }

  async read(
    accountId: AccountId,
    correlation: JobCorrelationContext,
  ): Promise<LocalDemoPortfolioResponse> {
    try {
      const wallets = this.walletService.list(accountId);
      if (wallets.length === 0) throw new LocalDemoPortfolioUnavailableError();
      assertConnectionProjections(wallets);

      const chainWallets = wallets.map(toDemoChainWallet);
      const chainObservations = await this.chainPipeline.synchronize(
        accountId,
        correlation,
        chainWallets,
      );
      const balanceSnapshot = projectBalanceSnapshot(accountId, chainObservations);
      const unified = valueAndAggregate(balanceSnapshot);
      const buyingPower = await calculateBuyingPower(unified);
      return projectWebResponse(wallets, unified, buyingPower);
    } catch (error) {
      if (error instanceof LocalDemoPortfolioUnavailableError) throw error;
      throw new LocalDemoPortfolioUnavailableError();
    }
  }
}

function assertConnectionProjections(wallets: readonly LocalDemoWalletConnection[]): void {
  const connectionIds = new Set<string>();
  for (const wallet of wallets) {
    if (
      !UUID_V4.test(wallet.connectionId) ||
      wallet.connectionId !== wallet.walletId ||
      connectionIds.has(wallet.connectionId) ||
      wallet.label.length < 1 ||
      wallet.label.length > 48 ||
      wallet.label.trim() !== wallet.label ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(wallet.label) ||
      !CANONICAL_TIMESTAMP.test(wallet.registeredAt) ||
      new Date(wallet.registeredAt).toISOString() !== wallet.registeredAt ||
      (wallet.namespace === 'EVM' && wallet.chainId !== EVM_DEMO_CONNECTOR_NETWORK) ||
      (wallet.namespace === 'SOLANA' && wallet.chainId !== SOLANA_DEMO_CONNECTOR_NETWORK) ||
      (wallet.namespace !== 'EVM' && wallet.namespace !== 'SOLANA')
    ) {
      throw new TypeError('invalid local demo wallet projection');
    }
    connectionIds.add(wallet.connectionId);
  }
}

/**
 * The portfolio view reports idle, eligible capital before a route has been
 * selected. Cost estimates belong to an allocation preview, so this adapter
 * explicitly supplies zero for every required adjustment category. Eligibility
 * exclusions still come from BuyingPowerCalculator before this boundary.
 */
class DeterministicLocalDemoIdleAdjustment implements BuyingPowerAdjustmentPort {
  async evaluate(request: BuyingPowerAdjustmentRequest): Promise<unknown> {
    const gross = BigInt(request.grossUsdValueMantissa);
    if (gross % SCALE_18_PER_USD_CENT !== 0n) throw new TypeError('non-cent demo valuation');

    return Object.freeze({
      status: 'AVAILABLE',
      quoteId: `local-demo-quote:${digest(request.contributionId).slice(0, 32)}`,
      contributionId: request.contributionId,
      quotedAt: QUOTE_TIME,
      validUntil: QUOTE_EXPIRY,
      deductions: Object.freeze({
        liquidity: '0',
        conversion: '0',
        slippage: '0',
        network: '0',
        routing: '0',
      }),
    });
  }
}

function toDemoChainWallet(wallet: LocalDemoWalletConnection): LocalDemoChainWallet {
  return Object.freeze({
    walletId: wallet.walletId,
    namespace: wallet.namespace,
    // The proven testnet wallet address is retained while its EVM balance is
    // observed only on the explicit keyless LOCAL chain identity.
    chainId:
      wallet.namespace === 'EVM'
        ? LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId
        : MAINNET_SOLANA_NETWORK,
    address: wallet.namespace === 'EVM' ? wallet.address.toLowerCase() : wallet.address,
  });
}

function projectBalanceSnapshot(
  accountId: AccountId,
  observations: readonly BalanceSyncObservation[],
): ReturnType<typeof parseLocalDemoPortfolioBalanceSnapshot> {
  const projected: IndexedPortfolioBalanceObservation[] = [];
  for (const observation of observations) {
    if (observation.accountId !== accountId || observation.positions.length !== 1) {
      throw new TypeError('invalid account-scoped demo observation');
    }
    for (const position of observation.positions) {
      projected.push(
        Object.freeze({
          observationId: deterministicUuid(
            'local-demo-portfolio-observation-v1',
            observation.observationId,
            position.positionId,
          ),
          walletId: observation.walletId,
          networkId: observation.networkId,
          assetIdentity: position.assetIdentity,
          amountAtomic: position.amountAtomic,
          observedAt: observation.source.retrievedAt,
          freshnessClass: 'CURRENT',
        }),
      );
    }
  }
  projected.sort((left, right) => left.walletId.localeCompare(right.walletId));
  return parseLocalDemoPortfolioBalanceSnapshot(
    {
      snapshotId: `local-demo-balances:${digest(
        'local-demo-balance-snapshot-v2',
        accountId,
        ...projected.flatMap((observation) => [
          observation.observationId,
          observation.amountAtomic,
        ]),
      ).slice(0, 32)}`,
      capturedAt: LOCAL_DEMO_PORTFOLIO_AS_OF,
      freshnessClass: 'CURRENT',
      observations: projected,
    },
    LOCAL_DEMO_PORTFOLIO_AS_OF,
  );
}

function valueAndAggregate(
  snapshot: ReturnType<typeof parseLocalDemoPortfolioBalanceSnapshot>,
): UnifiedPortfolio {
  const mainnetRegistry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  if (mainnetRegistry.environment !== 'MAINNET' || mainnetRegistry.version !== 1) {
    throw new TypeError('invalid demo asset registry');
  }
  const valuedBalances: ValuedPortfolioBalance[] = snapshot.observations.map((observation) => {
    const registryAsset = portfolioRegistryAsset(observation.networkId, observation.assetIdentity);
    if (registryAsset === undefined || registryAsset.decimals !== 6) {
      throw new TypeError('unsupported demo asset');
    }
    const valuationReference = mainnetValuationReference(registryAsset);
    const valuation = evaluateStablecoinValuation({
      asset: valuationReference,
      amountAtomic: observation.amountAtomic,
      evaluatedAt: LOCAL_DEMO_PORTFOLIO_AS_OF,
      sourceWatermarks: STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
      observations: priceEvidence(valuationReference),
    });
    if (valuation.availability !== 'AVAILABLE' || valuation.usdValueMantissa === null) {
      throw new TypeError('demo valuation unavailable');
    }
    return Object.freeze({
      observation,
      registryAsset,
      // The shared portfolio/valuation contract remains MAINNET-only. This
      // isolated demo adapter projects the local asset identity at its edge.
      asset: valuationReference,
      priceSnapshotId: `local-demo-price:${registryAsset.stablecoin}:${digest(
        registryAsset.networkId,
      ).slice(0, 16)}`,
      valuation,
    });
  });

  const unified = buildUnifiedPortfolio({
    asOf: LOCAL_DEMO_PORTFOLIO_AS_OF,
    balanceSnapshotId: snapshot.snapshotId,
    balanceCapturedAt: snapshot.capturedAt,
    balanceSnapshotFreshness: snapshot.freshnessClass,
    balanceCoverage: snapshot.coverage,
    valuedBalances,
    excludedBalances: [],
  });
  if (
    unified.overallTotal.completeness !== 'COMPLETE' ||
    unified.overallTotal.freshnessClass !== 'CURRENT' ||
    unified.overallTotal.usdValue === null
  ) {
    throw new TypeError('incomplete demo aggregation');
  }
  return unified;
}

function portfolioRegistryAsset(
  networkId: string,
  identity: string,
): SupportedStablecoinAsset | undefined {
  return networkId === LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId
    ? normalizeLocalEvmDevelopmentAsset(networkId, identity)
    : MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(networkId, identity);
}

function mainnetValuationReference(
  registryAsset: SupportedStablecoinAsset,
): StablecoinValuationAssetReference {
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const asset =
    MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(
      registryAsset.networkId,
      registryAsset.identity,
    ) ??
    registry.assets.find(
      (candidate) =>
        candidate.stablecoin === registryAsset.stablecoin &&
        candidate.networkId === 'eip155:1' &&
        candidate.activationState === 'ACTIVE',
    );
  if (asset === undefined) throw new TypeError('missing local demo valuation proxy');
  return Object.freeze({
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: registry.fingerprintSha256,
    stablecoin: asset.stablecoin,
    networkId: asset.networkId,
    identity: asset.identity,
    decimals: asset.decimals,
  });
}

function priceEvidence(
  asset: StablecoinValuationAssetReference,
): readonly StablecoinPriceObservation[] {
  const references = STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin];
  const updateId = digest('local-demo-price-v1', asset.networkId, asset.identity);
  return Object.freeze([
    Object.freeze({
      asset,
      sourceId: 'PYTH_CORE',
      sourceReference: references.PYTH_CORE,
      sourceSequence: '1',
      sourceUpdateId: updateId,
      pricedAt: PRICE_TIME,
      observedAt: LOCAL_DEMO_PORTFOLIO_AS_OF,
      usdRateMantissa: '100000000',
      usdRateScale: 8,
      confidence: Object.freeze({
        kind: 'PUBLISHED_ABSOLUTE_USD',
        mantissa: '0',
        scale: 8,
      }),
    }),
    Object.freeze({
      asset,
      sourceId: 'CHAINLINK_DATA_FEEDS',
      sourceReference: references.CHAINLINK_DATA_FEEDS,
      sourceSequence: '1',
      sourceUpdateId: '1',
      pricedAt: PRICE_TIME,
      observedAt: LOCAL_DEMO_PORTFOLIO_AS_OF,
      usdRateMantissa: '100000000',
      usdRateScale: 8,
      confidence: Object.freeze({ kind: 'NOT_PUBLISHED' }),
    }),
  ]);
}

async function calculateBuyingPower(unified: UnifiedPortfolio): Promise<BuyingPowerResult> {
  const result = await new BuyingPowerCalculator(new DeterministicLocalDemoIdleAdjustment(), {
    now: () => LOCAL_DEMO_PORTFOLIO_AS_OF,
  }).calculate({
    portfolioSnapshotId: unified.balanceSnapshot.snapshotId,
    contributions: unified.sources.map((source) => ({
      contributionId: source.observationId,
      walletId: source.walletId,
      networkId: source.networkId,
      assetId: `${source.networkId}:${portfolioAssetIdentity(source)}`,
      supported: source.includedInOverallTotal,
      freshness: source.freshnessClass,
      valuationUse: source.valuation.reportingUse,
      usdValueMantissa: source.usdValue?.mantissa ?? null,
      asOf: source.balanceObservedAt,
    })),
  });
  if (
    result.availability !== 'AVAILABLE' ||
    result.use !== 'LOCAL_DEMO_ESTIMATE_ONLY' ||
    result.mayAuthorizeFinancialAction !== false
  ) {
    throw new TypeError('demo buying power unavailable');
  }
  return result;
}

function projectWebResponse(
  connections: readonly LocalDemoWalletConnection[],
  unified: UnifiedPortfolio,
  buyingPower: BuyingPowerResult,
): LocalDemoPortfolioResponse {
  const connectionByWallet = new Map(
    connections.map((connection) => [connection.walletId, connection]),
  );
  const buyingPowerByContribution = new Map(
    buyingPower.contributions.map((contribution) => [contribution.contributionId, contribution]),
  );
  const wallets = [...new Set(unified.sources.map(({ walletId }) => walletId))]
    .sort()
    .map((walletId): LocalDemoPortfolioWallet => {
      const connection = connectionByWallet.get(walletId);
      if (connection === undefined) throw new TypeError('missing demo wallet metadata');
      const walletSources = unified.sources.filter((source) => source.walletId === walletId);
      const networkIds = [...new Set(walletSources.map(({ networkId }) => networkId))].sort();
      const chains = networkIds.map((networkId): LocalDemoPortfolioChain => {
        const sources = walletSources.filter((source) => source.networkId === networkId);
        const assets = sources.map((source) =>
          projectAsset(source, requiredContribution(buyingPowerByContribution, source)),
        );
        return Object.freeze({
          networkId,
          portfolioValueUsdMinor: sumMinor(
            assets.map(({ portfolioValueUsdMinor }) => portfolioValueUsdMinor),
          ),
          buyingPowerUsdMinor: sumMinor(
            assets.map(({ buyingPowerUsdMinor }) => buyingPowerUsdMinor),
          ),
          assets: Object.freeze(assets),
        });
      });
      return Object.freeze({
        walletId,
        label: connection.label,
        namespace: connection.namespace,
        address:
          connection.namespace === 'EVM' ? connection.address.toLowerCase() : connection.address,
        portfolioValueUsdMinor: sumMinor(
          chains.map(({ portfolioValueUsdMinor }) => portfolioValueUsdMinor),
        ),
        buyingPowerUsdMinor: sumMinor(chains.map(({ buyingPowerUsdMinor }) => buyingPowerUsdMinor)),
        chains: Object.freeze(chains),
      });
    });

  const totalPortfolioMinor = usdMinor(unified.overallTotal.usdValue?.mantissa ?? '0');
  const totalBuyingPowerMinor = usdMinor(buyingPower.availableBuyingPowerUsdMantissa);
  if (
    sumMinor(wallets.map(({ portfolioValueUsdMinor }) => portfolioValueUsdMinor)) !==
      totalPortfolioMinor ||
    sumMinor(wallets.map(({ buyingPowerUsdMinor }) => buyingPowerUsdMinor)) !==
      totalBuyingPowerMinor
  ) {
    throw new TypeError('invalid demo projection totals');
  }

  return Object.freeze({
    schemaVersion: 1,
    snapshotId: `local-demo-portfolio:${digest(unified.balanceSnapshot.snapshotId).slice(0, 32)}`,
    asOf: LOCAL_DEMO_PORTFOLIO_AS_OF,
    freshness: 'CURRENT',
    portfolioValueUsdMinor: totalPortfolioMinor,
    buyingPower: Object.freeze({
      status: 'AVAILABLE',
      amountUsdMinor: totalBuyingPowerMinor,
      freshness: 'CURRENT',
      deductions: Object.freeze([]),
      reasons: Object.freeze([]),
    }),
    wallets: Object.freeze(wallets),
    use: 'LOCAL_DEMO_ESTIMATE_ONLY',
    mayAuthorizeFinancialAction: false,
  });
}

function projectAsset(
  source: PortfolioSourceBreakdown,
  contribution: BuyingPowerResult['contributions'][number],
): LocalDemoPortfolioAsset {
  if (
    source.freshnessClass !== 'CURRENT' ||
    source.usdValue === null ||
    contribution.availability !== 'AVAILABLE' ||
    contribution.deductions === null
  ) {
    throw new TypeError('unavailable demo source');
  }
  return Object.freeze({
    stablecoin: source.asset.stablecoin,
    assetIdentity: portfolioAssetIdentity(source),
    amountAtomic: source.balance.atomic,
    decimals: 6,
    portfolioValueUsdMinor: usdMinor(source.usdValue.mantissa),
    buyingPowerUsdMinor: usdMinor(contribution.availableBuyingPowerUsdMantissa),
    buyingPowerAvailability: 'INCLUDED',
    buyingPowerReason: null,
    observedAt: source.balanceObservedAt,
    freshness: 'CURRENT',
  });
}

function portfolioAssetIdentity(source: PortfolioSourceBreakdown): string {
  if (source.networkId !== LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId) {
    return source.asset.identity;
  }
  const asset = LOCAL_EVM_DEVELOPMENT_MANIFEST.assets.find(
    (candidate) => candidate.stablecoin === source.asset.stablecoin,
  );
  if (asset === undefined) throw new TypeError('missing local demo asset identity');
  return asset.contractAddress;
}

function requiredContribution(
  contributions: ReadonlyMap<string, BuyingPowerResult['contributions'][number]>,
  source: PortfolioSourceBreakdown,
): BuyingPowerResult['contributions'][number] {
  const contribution = contributions.get(source.observationId);
  if (contribution === undefined) throw new TypeError('missing demo buying power contribution');
  return contribution;
}

function usdMinor(scale18Mantissa: string): string {
  return (BigInt(scale18Mantissa) / SCALE_18_PER_USD_CENT).toString();
}

function sumMinor(values: readonly string[]): string {
  return values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

function digest(...parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
}

function deterministicUuid(...parts: readonly string[]): string {
  const hash = [...digest(...parts)];
  hash[12] = '4';
  hash[16] = ((Number.parseInt(hash[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const value = hash.join('').slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(
    16,
    20,
  )}-${value.slice(20)}`;
}
