/** JSON view contract, shared by lending presentation and the local mainnet adapter. */
import type { LendingProvider } from './markets';
export type LendingNetwork = 'eip155:1' | 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export interface SmartLendingInput {
  sourceNetwork: LendingNetwork;
  amount: string;
  holdingDays: number;
  includeCrossChain: boolean;
}
export interface SmartLendingRoute {
  id: LendingProvider;
  network: LendingNetwork;
  name: string;
  market?: string;
  routeKind: 'SAME_CHAIN' | 'CROSS_CHAIN';
  apyBasisPoints: string | null;
  observedAt: number | null;
  source: string;
  entryCostUsd: string | null;
  exitCostUsd: string | null;
  projectedYieldUsd: string | null;
  netBenefitUsd: string | null;
  breakEvenDays: string | null;
  routingFee?: {
    basisPoints: number;
    depositUsdc: string;
    estimatedReturnUsdc: string;
    totalSourceDebitUsdc: string;
  };
  reasons: string[];
  fundingReasons: string[];
}
export interface SmartLendingQuote {
  id: string;
  input: SmartLendingInput;
  createdAt: number;
  expiresAt: number;
  selectedId: SmartLendingRoute['id'] | null;
  unavailableReason?: string | null;
  routes: SmartLendingRoute[];
}
export interface LendingMarketView {
  id: LendingProvider;
  apyBasisPoints: string | null;
  observedAt: number | null;
  supplied: string | null;
  shares: string | null;
  /** USDC per Kamino receipt token, scaled to 18 decimal places. Local diagnostics only. */
  receiptExchangeRate?: string | null;
  capacity: string | null;
  available: boolean;
  entryCostNative: string | null;
  error: string | null;
}
