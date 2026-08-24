import type { BuyingPowerUsdMantissa } from '../../domain/buying-power';

export interface BuyingPowerAdjustmentRequest {
  readonly contributionId: string;
  readonly walletId: string;
  readonly networkId: string;
  readonly assetId: string;
  readonly grossUsdValueMantissa: BuyingPowerUsdMantissa;
  readonly usdScale: 18;
  readonly evaluatedAt: string;
}

export type BuyingPowerAdjustmentUnavailableReason =
  | 'LIQUIDITY_DATA_UNAVAILABLE'
  | 'CONVERSION_COST_UNAVAILABLE'
  | 'SLIPPAGE_DATA_UNAVAILABLE'
  | 'NETWORK_COST_UNAVAILABLE'
  | 'ROUTING_DATA_UNAVAILABLE'
  | 'ROUTE_UNAVAILABLE';

/**
 * Local/provider-neutral adjustment boundary. Runtime adapters must explicitly
 * supply every deduction category or an unavailable reason. Omitting cost data
 * is never interpreted as a zero-cost route.
 */
export interface BuyingPowerAdjustmentPort {
  evaluate(request: BuyingPowerAdjustmentRequest): Promise<unknown>;
}

/** Trusted server clock boundary; local tests inject deterministic time. */
export interface BuyingPowerClockPort {
  now(): unknown;
}
