import type { AccountId } from '../../../accounts/domain/account-profile';
import type { ActivePortfolioWalletRegistration } from './portfolio-wallet-registration-reader.port';

export const PORTFOLIO_BALANCE_READER = Symbol('PORTFOLIO_BALANCE_READER');

export type IndexedBalanceFreshness = 'CURRENT' | 'STALE';
/**
 * COMPLETE means every configured supported-asset read for the exact active
 * wallet/network target succeeded, so absent observations may safely mean zero.
 * PARTIAL and UNAVAILABLE must never be interpreted as zero coverage.
 */
export type IndexedBalanceCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';

export interface IndexedPortfolioBalanceCoverageTarget extends ActivePortfolioWalletRegistration {
  readonly status: IndexedBalanceCoverageStatus;
}

export interface IndexedPortfolioBalanceCoverage {
  readonly status: IndexedBalanceCoverageStatus;
  readonly targets: readonly IndexedPortfolioBalanceCoverageTarget[];
}

/**
 * Account-scoped current-balance observation returned by the IDX-005 boundary.
 * The account ID is deliberately absent: it is supplied only in the read request.
 */
export interface IndexedPortfolioBalanceObservation {
  readonly observationId: string;
  readonly walletId: string;
  readonly networkId: string;
  readonly assetIdentity: string;
  readonly amountAtomic: string;
  readonly observedAt: string;
  readonly freshnessClass: IndexedBalanceFreshness;
}

export interface IndexedPortfolioBalanceSnapshot {
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly freshnessClass: IndexedBalanceFreshness;
  readonly coverage: IndexedPortfolioBalanceCoverage;
  readonly observations: readonly IndexedPortfolioBalanceObservation[];
}

export interface ReadPortfolioBalancesRequest {
  readonly accountId: AccountId;
  readonly evaluatedAt: string;
  readonly correlationId: string;
  /** Independently read active registrations that this balance read must cover exactly. */
  readonly expectedWallets: readonly ActivePortfolioWalletRegistration[];
}

export interface PortfolioBalanceReader {
  readCurrentBalances(
    request: ReadPortfolioBalancesRequest,
  ): Promise<IndexedPortfolioBalanceSnapshot>;
}
