import type { AccountId } from '../../../accounts/domain/account-profile';

export const PORTFOLIO_BALANCE_READER = Symbol('PORTFOLIO_BALANCE_READER');

export type IndexedBalanceFreshness = 'CURRENT' | 'STALE';

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
  readonly observations: readonly IndexedPortfolioBalanceObservation[];
}

export interface ReadPortfolioBalancesRequest {
  readonly accountId: AccountId;
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

export interface PortfolioBalanceReader {
  readCurrentBalances(
    request: ReadPortfolioBalancesRequest,
  ): Promise<IndexedPortfolioBalanceSnapshot>;
}
