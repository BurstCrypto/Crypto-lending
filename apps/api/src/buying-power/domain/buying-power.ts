const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const MAX_USD_MANTISSA_DIGITS = 96;

declare const buyingPowerUsdMantissaBrand: unique symbol;

export type BuyingPowerUsdMantissa = string & {
  readonly [buyingPowerUsdMantissaBrand]: 'BuyingPowerUsdMantissa';
};

export const BUYING_POWER_USD_SCALE = 18 as const;

export const BUYING_POWER_DEDUCTION_KINDS = Object.freeze([
  'liquidity',
  'conversion',
  'slippage',
  'network',
  'routing',
] as const);

export type BuyingPowerDeductionKind = (typeof BUYING_POWER_DEDUCTION_KINDS)[number];

export type BuyingPowerFreshness = 'CURRENT' | 'STALE' | 'UNAVAILABLE';

export type BuyingPowerValuationUse = 'CONSERVATIVE_REPORTING_ONLY' | 'BLOCKED';

export type BuyingPowerUnavailableReason =
  | 'NO_ELIGIBLE_CONTRIBUTIONS'
  | 'UNSUPPORTED_ASSET'
  | 'UNPRICED_ASSET'
  | 'STALE_DATA'
  | 'SOURCE_UNAVAILABLE'
  | 'VALUATION_USE_BLOCKED'
  | 'LIQUIDITY_DATA_UNAVAILABLE'
  | 'CONVERSION_COST_UNAVAILABLE'
  | 'SLIPPAGE_DATA_UNAVAILABLE'
  | 'NETWORK_COST_UNAVAILABLE'
  | 'ROUTING_DATA_UNAVAILABLE'
  | 'ROUTE_UNAVAILABLE'
  | 'ADJUSTMENT_SOURCE_FAILED'
  | 'INVALID_ADJUSTMENT_RESPONSE'
  | 'ADJUSTMENTS_EXCEED_VALUE';

export type BuyingPowerValidationCode =
  'INVALID_USD_MANTISSA' | 'NUMERIC_LIMIT_EXCEEDED' | 'NEGATIVE_USD_RESULT';

export class BuyingPowerValidationError extends Error {
  constructor(readonly code: BuyingPowerValidationCode) {
    super(code);
    this.name = 'BuyingPowerValidationError';
  }
}

export interface BuyingPowerContributionInput {
  readonly contributionId: string;
  readonly walletId: string;
  readonly networkId: string;
  readonly assetId: string;
  readonly supported: boolean;
  readonly freshness: BuyingPowerFreshness;
  readonly valuationUse: BuyingPowerValuationUse;
  readonly usdValueMantissa: string | null;
  readonly asOf: string;
}

export interface BuyingPowerCalculationRequest {
  readonly portfolioSnapshotId: string;
  readonly contributions: readonly BuyingPowerContributionInput[];
}

export interface BuyingPowerDeductionBreakdown {
  readonly liquidity: BuyingPowerUsdMantissa;
  readonly conversion: BuyingPowerUsdMantissa;
  readonly slippage: BuyingPowerUsdMantissa;
  readonly network: BuyingPowerUsdMantissa;
  readonly routing: BuyingPowerUsdMantissa;
}

export interface BuyingPowerContributionResult {
  readonly contributionId: string;
  readonly walletId: string;
  readonly networkId: string;
  readonly assetId: string;
  readonly grossUsdValueMantissa: BuyingPowerUsdMantissa | null;
  readonly deductions: BuyingPowerDeductionBreakdown | null;
  readonly totalDeductionUsdMantissa: BuyingPowerUsdMantissa | null;
  readonly availableBuyingPowerUsdMantissa: BuyingPowerUsdMantissa;
  readonly availability: 'AVAILABLE' | 'UNAVAILABLE';
  readonly unavailableReasons: readonly BuyingPowerUnavailableReason[];
  readonly asOf: string;
  readonly adjustmentQuoteId: string | null;
  readonly adjustmentQuotedAt: string | null;
  readonly adjustmentValidUntil: string | null;
}

export interface BuyingPowerResult {
  readonly portfolioSnapshotId: string;
  readonly evaluatedAt: string;
  readonly usdScale: typeof BUYING_POWER_USD_SCALE;
  readonly supportedPortfolioValueMantissa: BuyingPowerUsdMantissa;
  readonly eligibleGrossValueMantissa: BuyingPowerUsdMantissa;
  readonly totalDeductions: BuyingPowerDeductionBreakdown;
  readonly totalDeductionUsdMantissa: BuyingPowerUsdMantissa;
  readonly availableBuyingPowerUsdMantissa: BuyingPowerUsdMantissa;
  readonly availability: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  readonly unavailableReasons: readonly BuyingPowerUnavailableReason[];
  readonly contributions: readonly BuyingPowerContributionResult[];
  readonly use: 'LOCAL_DEMO_ESTIMATE_ONLY';
  readonly mayAuthorizeFinancialAction: false;
}

export function normalizeBuyingPowerUsdMantissa(value: unknown): BuyingPowerUsdMantissa {
  if (
    typeof value !== 'string' ||
    !CANONICAL_UNSIGNED_INTEGER.test(value) ||
    value.length > MAX_USD_MANTISSA_DIGITS
  ) {
    throw new BuyingPowerValidationError('INVALID_USD_MANTISSA');
  }
  return value as BuyingPowerUsdMantissa;
}

export function addBuyingPowerUsdMantissas(
  values: readonly BuyingPowerUsdMantissa[],
): BuyingPowerUsdMantissa {
  const sum = values.reduce((total, value) => total + BigInt(value), 0n).toString();
  if (sum.length > MAX_USD_MANTISSA_DIGITS) {
    throw new BuyingPowerValidationError('NUMERIC_LIMIT_EXCEEDED');
  }
  return sum as BuyingPowerUsdMantissa;
}

export function subtractBuyingPowerUsdMantissas(
  minuend: BuyingPowerUsdMantissa,
  subtrahend: BuyingPowerUsdMantissa,
): BuyingPowerUsdMantissa {
  const result = BigInt(minuend) - BigInt(subtrahend);
  if (result < 0n) throw new BuyingPowerValidationError('NEGATIVE_USD_RESULT');
  return result.toString() as BuyingPowerUsdMantissa;
}

export function zeroBuyingPowerDeductions(): BuyingPowerDeductionBreakdown {
  const zero = normalizeBuyingPowerUsdMantissa('0');
  return Object.freeze({
    liquidity: zero,
    conversion: zero,
    slippage: zero,
    network: zero,
    routing: zero,
  });
}

export function totalBuyingPowerDeductions(
  deductions: BuyingPowerDeductionBreakdown,
): BuyingPowerUsdMantissa {
  return addBuyingPowerUsdMantissas(BUYING_POWER_DEDUCTION_KINDS.map((kind) => deductions[kind]));
}
