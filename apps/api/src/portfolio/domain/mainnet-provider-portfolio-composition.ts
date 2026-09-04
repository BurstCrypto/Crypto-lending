import type { AccountId } from '../../accounts/domain/account-profile';
import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import type {
  IndexedPortfolioBalanceObservation,
  IndexedPortfolioBalanceSnapshot,
} from '../application/ports/portfolio-balance-reader.port';
import type { ActivePortfolioWalletRegistration } from '../application/ports/portfolio-wallet-registration-reader.port';
import { parseActivePortfolioWalletRegistrations } from './active-portfolio-wallet-registrations';
import { parseIndexedPortfolioBalanceSnapshot } from './portfolio-balance-snapshot';
import {
  parseCoveredMainnetProviderPositionSnapshotV1,
  type CoveredMainnetProviderPositionSnapshotV1,
  type MainnetProviderPositionCoverageContextV1,
} from '../../mainnet-platforms/domain/mainnet-provider-position-coverage';
import type { MainnetProviderPositionChainAssessmentVerifierPort } from '../../mainnet-platforms/domain/mainnet-provider-position-chain-assessment';
import type { MainnetProviderPositionObservationV1 } from '../../mainnet-platforms/domain/mainnet-provider-position-observation';

export const MAINNET_PROVIDER_PORTFOLIO_COMPOSITION_VERSION = 1 as const;
export const MAINNET_PROVIDER_PORTFOLIO_COMPOSITION_ONLY =
  'MAINNET_PROVIDER_PORTFOLIO_COMPOSITION_ONLY' as const;

const MAX_TOTAL_ATOMIC_DIGITS = 100;

export interface ComposeMainnetProviderPortfolioRequestV1 extends MainnetProviderPositionCoverageContextV1 {
  readonly coverageManifest: unknown;
  readonly positionSnapshot: unknown;
  readonly chainAssessment?: unknown;
  readonly chainAssessmentVerifier?: MainnetProviderPositionChainAssessmentVerifierPort;
  readonly walletBalanceSnapshot: unknown;
}

export interface NormalizedWalletTokenBalanceV1 {
  readonly observationId: string;
  readonly walletId: string;
  readonly asset: Readonly<{
    stablecoin: SupportedStablecoin;
    networkId: string;
    identity: string;
    decimals: number;
  }>;
  readonly balance: Readonly<{
    atomic: string;
    decimal: string;
  }>;
  readonly observedAt: string;
  readonly freshnessClass: 'CURRENT';
}

export interface MainnetProviderPortfolioAssetTotalV1 {
  readonly walletId: string;
  readonly asset: Readonly<{
    stablecoin: SupportedStablecoin;
    networkId: string;
    identity: string;
    decimals: number;
  }>;
  /** Liquid wallet tokens. Borrowed tokens present in the wallet occur here once. */
  readonly liquidWalletBalance: Readonly<{
    atomic: string;
    decimal: string;
  }>;
  /** Underlying assets represented by distinct provider SUPPLY positions. */
  readonly suppliedBalance: Readonly<{
    atomic: string;
    decimal: string;
  }>;
  /** BORROW is a liability only; it is never added to gross assets. */
  readonly borrowedLiability: Readonly<{
    atomic: string;
    decimal: string;
  }>;
  readonly grossAssets: Readonly<{
    atomic: string;
    decimal: string;
  }>;
  readonly netPosition: Readonly<{
    signedAtomic: string;
    signedDecimal: string;
  }>;
  readonly supplyPositionCount: number;
  readonly borrowPositionCount: number;
}

export interface MainnetProviderPortfolioCompositionV1 {
  readonly compositionVersion: typeof MAINNET_PROVIDER_PORTFOLIO_COMPOSITION_VERSION;
  readonly use: typeof MAINNET_PROVIDER_PORTFOLIO_COMPOSITION_ONLY;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayIncreaseBuyingPower: false;
  readonly accountId: AccountId;
  readonly asOf: string;
  readonly completeness: 'COMPLETE';
  readonly freshnessClass: 'CURRENT';
  readonly walletBalanceSnapshotId: string;
  readonly providerPositionSnapshotId: string;
  readonly providerCoverageManifestId: string;
  readonly providerCoverageFingerprintSha256: string;
  readonly walletBalances: readonly NormalizedWalletTokenBalanceV1[];
  /** Full provider/market/position/source identity is retained here. */
  readonly providerPositions: readonly MainnetProviderPositionObservationV1[];
  readonly assetTotals: readonly MainnetProviderPortfolioAssetTotalV1[];
}

export type MainnetProviderPortfolioUnavailableCode =
  | 'INVALID_ACCOUNT_CONTEXT'
  | 'PROVIDER_COVERAGE_UNAVAILABLE'
  | 'WALLET_BALANCE_UNAVAILABLE'
  | 'CROSS_SOURCE_DUPLICATE'
  | 'ASSET_MISMATCH'
  | 'ARITHMETIC_OVERFLOW';

export class MainnetProviderPortfolioUnavailableError extends Error {
  public readonly code: MainnetProviderPortfolioUnavailableCode;

  public constructor(code: MainnetProviderPortfolioUnavailableCode) {
    super('Mainnet provider portfolio composition is unavailable.');
    this.name = 'MainnetProviderPortfolioUnavailableError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface MutableAssetTotal {
  readonly walletId: string;
  readonly stablecoin: SupportedStablecoin;
  readonly networkId: string;
  readonly identity: string;
  readonly decimals: number;
  liquidAtomic: bigint;
  suppliedAtomic: bigint;
  borrowedAtomic: bigint;
  supplyPositionCount: number;
  borrowPositionCount: number;
}

function fail(code: MainnetProviderPortfolioUnavailableCode): never {
  throw new MainnetProviderPortfolioUnavailableError(code);
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, 'en');
}

function totalKey(
  walletId: string,
  networkId: string,
  stablecoin: SupportedStablecoin,
  identity: string,
): string {
  return `${walletId}|${networkId}|${stablecoin}|${identity}`;
}

function unsignedDecimal(atomic: bigint, decimals: number): string {
  const digits = atomic.toString();
  if (decimals === 0) {
    return digits;
  }

  const padded = digits.padStart(decimals + 1, '0');
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/u, '');
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

function signedDecimal(atomic: bigint, decimals: number): string {
  if (atomic >= 0n) {
    return unsignedDecimal(atomic, decimals);
  }
  return `-${unsignedDecimal(-atomic, decimals)}`;
}

function assertBounded(value: bigint): void {
  const unsigned = value < 0n ? -value : value;
  if (unsigned.toString().length > MAX_TOTAL_ATOMIC_DIGITS) {
    return fail('ARITHMETIC_OVERFLOW');
  }
}

function normalizeWalletBalance(
  observation: IndexedPortfolioBalanceObservation,
): NormalizedWalletTokenBalanceV1 {
  const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.identifyAsset(
    observation.networkId,
    observation.assetIdentity,
  );
  if (
    asset === undefined ||
    asset.activationState !== 'ACTIVE' ||
    observation.freshnessClass !== 'CURRENT'
  ) {
    return fail('ASSET_MISMATCH');
  }

  const atomic = BigInt(observation.amountAtomic);
  return Object.freeze({
    observationId: observation.observationId,
    walletId: observation.walletId,
    asset: Object.freeze({
      stablecoin: asset.stablecoin,
      networkId: asset.networkId,
      identity: asset.identity,
      decimals: asset.decimals,
    }),
    balance: Object.freeze({
      atomic: observation.amountAtomic,
      decimal: unsignedDecimal(atomic, asset.decimals),
    }),
    observedAt: observation.observedAt,
    freshnessClass: 'CURRENT',
  });
}

function parseAccountContext(
  accountIdInput: AccountId,
  expectedWalletsInput: unknown,
): Readonly<{
  accountId: AccountId;
  expectedWallets: readonly ActivePortfolioWalletRegistration[];
}> {
  try {
    return Object.freeze({
      accountId: parseAccountId(accountIdInput),
      expectedWallets: parseActivePortfolioWalletRegistrations(expectedWalletsInput),
    });
  } catch {
    return fail('INVALID_ACCOUNT_CONTEXT');
  }
}

function parseProviderSnapshot(
  request: ComposeMainnetProviderPortfolioRequestV1,
): CoveredMainnetProviderPositionSnapshotV1 {
  try {
    return parseCoveredMainnetProviderPositionSnapshotV1(request);
  } catch {
    return fail('PROVIDER_COVERAGE_UNAVAILABLE');
  }
}

function parseWalletSnapshot(
  request: ComposeMainnetProviderPortfolioRequestV1,
  expectedWallets: readonly ActivePortfolioWalletRegistration[],
): IndexedPortfolioBalanceSnapshot {
  let snapshot: IndexedPortfolioBalanceSnapshot;
  try {
    snapshot = parseIndexedPortfolioBalanceSnapshot(
      request.walletBalanceSnapshot,
      request.evaluatedAt,
      expectedWallets,
    );
  } catch {
    return fail('WALLET_BALANCE_UNAVAILABLE');
  }

  if (
    snapshot.freshnessClass !== 'CURRENT' ||
    snapshot.coverage.status !== 'COMPLETE' ||
    snapshot.coverage.targets.some((target) => target.status !== 'COMPLETE') ||
    snapshot.observations.some((observation) => observation.freshnessClass !== 'CURRENT')
  ) {
    return fail('WALLET_BALANCE_UNAVAILABLE');
  }

  return snapshot;
}

function seedTotals(
  expectedWallets: readonly ActivePortfolioWalletRegistration[],
): Map<string, MutableAssetTotal> {
  const totals = new Map<string, MutableAssetTotal>();
  for (const wallet of expectedWallets) {
    for (const asset of MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets) {
      if (asset.activationState !== 'ACTIVE' || asset.networkId !== wallet.networkId) {
        continue;
      }
      const key = totalKey(wallet.walletId, asset.networkId, asset.stablecoin, asset.identity);
      totals.set(key, {
        walletId: wallet.walletId,
        stablecoin: asset.stablecoin,
        networkId: asset.networkId,
        identity: asset.identity,
        decimals: asset.decimals,
        liquidAtomic: 0n,
        suppliedAtomic: 0n,
        borrowedAtomic: 0n,
        supplyPositionCount: 0,
        borrowPositionCount: 0,
      });
    }
  }
  return totals;
}

function addWalletBalances(
  totals: Map<string, MutableAssetTotal>,
  balances: readonly NormalizedWalletTokenBalanceV1[],
): void {
  for (const balance of balances) {
    const key = totalKey(
      balance.walletId,
      balance.asset.networkId,
      balance.asset.stablecoin,
      balance.asset.identity,
    );
    const total = totals.get(key);
    if (total === undefined) {
      return fail('ASSET_MISMATCH');
    }
    total.liquidAtomic += BigInt(balance.balance.atomic);
    assertBounded(total.liquidAtomic);
  }
}

function addProviderPositions(
  totals: Map<string, MutableAssetTotal>,
  positions: readonly MainnetProviderPositionObservationV1[],
): void {
  for (const position of positions) {
    const key = totalKey(
      position.walletId,
      position.asset.networkId,
      position.asset.stablecoin,
      position.asset.identity,
    );
    const total = totals.get(key);
    if (total === undefined || total.decimals !== position.asset.decimals) {
      return fail('ASSET_MISMATCH');
    }

    const amount = BigInt(position.balance.atomic);
    if (position.positionKind === 'SUPPLY') {
      total.suppliedAtomic += amount;
      total.supplyPositionCount += 1;
      assertBounded(total.suppliedAtomic);
    } else {
      // A borrow can also be present in the wallet balance. It remains solely a
      // liability here so the received token is not counted a second time.
      total.borrowedAtomic += amount;
      total.borrowPositionCount += 1;
      assertBounded(total.borrowedAtomic);
    }
  }
}

function immutableTotal(total: MutableAssetTotal): MainnetProviderPortfolioAssetTotalV1 {
  const grossAssets = total.liquidAtomic + total.suppliedAtomic;
  const netPosition = grossAssets - total.borrowedAtomic;
  assertBounded(grossAssets);
  assertBounded(netPosition);

  return Object.freeze({
    walletId: total.walletId,
    asset: Object.freeze({
      stablecoin: total.stablecoin,
      networkId: total.networkId,
      identity: total.identity,
      decimals: total.decimals,
    }),
    liquidWalletBalance: Object.freeze({
      atomic: total.liquidAtomic.toString(),
      decimal: unsignedDecimal(total.liquidAtomic, total.decimals),
    }),
    suppliedBalance: Object.freeze({
      atomic: total.suppliedAtomic.toString(),
      decimal: unsignedDecimal(total.suppliedAtomic, total.decimals),
    }),
    borrowedLiability: Object.freeze({
      atomic: total.borrowedAtomic.toString(),
      decimal: unsignedDecimal(total.borrowedAtomic, total.decimals),
    }),
    grossAssets: Object.freeze({
      atomic: grossAssets.toString(),
      decimal: unsignedDecimal(grossAssets, total.decimals),
    }),
    netPosition: Object.freeze({
      signedAtomic: netPosition.toString(),
      signedDecimal: signedDecimal(netPosition, total.decimals),
    }),
    supplyPositionCount: total.supplyPositionCount,
    borrowPositionCount: total.borrowPositionCount,
  });
}

/**
 * Produces a read-only accounting view. It does not value positions, authorize
 * lending, increase buying power, call a provider, or register a live reader.
 */
export function composeMainnetProviderPortfolioV1(
  request: ComposeMainnetProviderPortfolioRequestV1,
): MainnetProviderPortfolioCompositionV1 {
  const context = parseAccountContext(request.accountId, request.expectedWallets);
  const providerSnapshot = parseProviderSnapshot(request);
  const walletSnapshot = parseWalletSnapshot(request, context.expectedWallets);
  const walletBalances = walletSnapshot.observations
    .map(normalizeWalletBalance)
    .sort((left, right) =>
      compareStrings(
        `${left.walletId}|${left.asset.networkId}|${left.asset.identity}`,
        `${right.walletId}|${right.asset.networkId}|${right.asset.identity}`,
      ),
    );

  const walletObservationIds = new Set(walletBalances.map((balance) => balance.observationId));
  if (
    providerSnapshot.observations.some((position) =>
      walletObservationIds.has(position.observationId),
    )
  ) {
    return fail('CROSS_SOURCE_DUPLICATE');
  }

  const totals = seedTotals(context.expectedWallets);
  addWalletBalances(totals, walletBalances);
  addProviderPositions(totals, providerSnapshot.observations);
  const assetTotals = [...totals.values()]
    .map(immutableTotal)
    .sort((left, right) =>
      compareStrings(
        totalKey(left.walletId, left.asset.networkId, left.asset.stablecoin, left.asset.identity),
        totalKey(
          right.walletId,
          right.asset.networkId,
          right.asset.stablecoin,
          right.asset.identity,
        ),
      ),
    );

  return Object.freeze({
    compositionVersion: MAINNET_PROVIDER_PORTFOLIO_COMPOSITION_VERSION,
    use: MAINNET_PROVIDER_PORTFOLIO_COMPOSITION_ONLY,
    mayAuthorizeFinancialAction: false,
    mayIncreaseBuyingPower: false,
    accountId: context.accountId,
    asOf: request.evaluatedAt,
    completeness: 'COMPLETE',
    freshnessClass: 'CURRENT',
    walletBalanceSnapshotId: walletSnapshot.snapshotId,
    providerPositionSnapshotId: providerSnapshot.snapshotId,
    providerCoverageManifestId: providerSnapshot.coverageManifest.manifestId,
    providerCoverageFingerprintSha256: providerSnapshot.coverageManifest.fingerprintSha256,
    walletBalances: Object.freeze(walletBalances),
    providerPositions: providerSnapshot.observations,
    assetTotals: Object.freeze(assetTotals),
  });
}
