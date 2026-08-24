import {
  BUYING_POWER_DEDUCTION_KINDS,
  BUYING_POWER_USD_SCALE,
  BuyingPowerValidationError,
  addBuyingPowerUsdMantissas,
  normalizeBuyingPowerUsdMantissa,
  subtractBuyingPowerUsdMantissas,
  totalBuyingPowerDeductions,
  zeroBuyingPowerDeductions,
  type BuyingPowerContributionInput,
  type BuyingPowerContributionResult,
  type BuyingPowerDeductionBreakdown,
  type BuyingPowerFreshness,
  type BuyingPowerResult,
  type BuyingPowerUnavailableReason,
  type BuyingPowerUsdMantissa,
  type BuyingPowerValuationUse,
} from '../domain/buying-power';
import type {
  BuyingPowerAdjustmentPort,
  BuyingPowerAdjustmentRequest,
  BuyingPowerAdjustmentUnavailableReason,
  BuyingPowerClockPort,
} from './ports/buying-power-adjustment.ports';

const MAX_CONTRIBUTIONS = 128;
const MAX_IDENTIFIER_LENGTH = 256;
const SAFE_IDENTIFIER = /^[\x21-\x7e]+$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const ADJUSTMENT_UNAVAILABLE_REASONS = Object.freeze([
  'LIQUIDITY_DATA_UNAVAILABLE',
  'CONVERSION_COST_UNAVAILABLE',
  'SLIPPAGE_DATA_UNAVAILABLE',
  'NETWORK_COST_UNAVAILABLE',
  'ROUTING_DATA_UNAVAILABLE',
  'ROUTE_UNAVAILABLE',
] as const satisfies readonly BuyingPowerAdjustmentUnavailableReason[]);

export type BuyingPowerCalculationErrorCode =
  'INVALID_REQUEST' | 'CLOCK_FAILED' | 'NUMERIC_LIMIT_EXCEEDED';

export class BuyingPowerCalculationError extends Error {
  constructor(readonly code: BuyingPowerCalculationErrorCode) {
    super(code);
    this.name = 'BuyingPowerCalculationError';
  }
}

interface ParsedContribution extends Omit<BuyingPowerContributionInput, 'usdValueMantissa'> {
  readonly usdValueMantissa: BuyingPowerUsdMantissa | null;
}

interface ParsedRequest {
  readonly portfolioSnapshotId: string;
  readonly contributions: readonly ParsedContribution[];
}

interface AvailableAdjustment {
  readonly status: 'AVAILABLE';
  readonly quoteId: string;
  readonly contributionId: string;
  readonly quotedAt: string;
  readonly validUntil: string;
  readonly deductions: BuyingPowerDeductionBreakdown;
}

interface UnavailableAdjustment {
  readonly status: 'UNAVAILABLE';
  readonly contributionId: string;
  readonly reasons: readonly BuyingPowerAdjustmentUnavailableReason[];
}

/**
 * Calculates a conservative local estimate from a normalized portfolio. It has
 * no route, market-data, RPC, database, queue, or clock implementation of its
 * own. Every cost category comes from the injected adjustment port.
 */
export class BuyingPowerCalculator {
  constructor(
    private readonly adjustments: BuyingPowerAdjustmentPort,
    private readonly clock: BuyingPowerClockPort,
  ) {}

  async calculate(input: unknown): Promise<BuyingPowerResult> {
    const request = parseRequest(input);
    const evaluatedAt = this.readEvaluationTime();
    const supportedPortfolioValues: BuyingPowerUsdMantissa[] = [];
    const eligibleGrossValues: BuyingPowerUsdMantissa[] = [];
    const contributionResults: BuyingPowerContributionResult[] = [];

    for (const contribution of request.contributions) {
      if (contribution.asOf > evaluatedAt) throw calculationError('INVALID_REQUEST');
      if (contribution.supported && contribution.usdValueMantissa !== null) {
        supportedPortfolioValues.push(contribution.usdValueMantissa);
      }
      const initialReasons = contributionUnavailableReasons(contribution);
      if (initialReasons.length === 0 && contribution.usdValueMantissa !== null) {
        eligibleGrossValues.push(contribution.usdValueMantissa);
      }
    }

    let supportedPortfolioValueMantissa: BuyingPowerUsdMantissa;
    let eligibleGrossValueMantissa: BuyingPowerUsdMantissa;
    try {
      supportedPortfolioValueMantissa = addBuyingPowerUsdMantissas(supportedPortfolioValues);
      eligibleGrossValueMantissa = addBuyingPowerUsdMantissas(eligibleGrossValues);
    } catch {
      throw calculationError('NUMERIC_LIMIT_EXCEEDED');
    }

    for (const contribution of request.contributions) {
      const initialReasons = contributionUnavailableReasons(contribution);
      if (initialReasons.length > 0 || contribution.usdValueMantissa === null) {
        contributionResults.push(unavailableContribution(contribution, initialReasons));
        continue;
      }
      contributionResults.push(
        await this.adjustContribution(contribution, contribution.usdValueMantissa, evaluatedAt),
      );
    }

    let totalDeductions: BuyingPowerDeductionBreakdown;
    let totalDeductionUsdMantissa: BuyingPowerUsdMantissa;
    let availableBuyingPowerUsdMantissa: BuyingPowerUsdMantissa;
    try {
      totalDeductions = sumDeductionBreakdowns(
        contributionResults.flatMap(({ deductions }) => (deductions === null ? [] : [deductions])),
      );
      totalDeductionUsdMantissa = totalBuyingPowerDeductions(totalDeductions);
      availableBuyingPowerUsdMantissa = addBuyingPowerUsdMantissas(
        contributionResults.map(({ availableBuyingPowerUsdMantissa }) =>
          normalizeBuyingPowerUsdMantissa(availableBuyingPowerUsdMantissa),
        ),
      );
    } catch (error) {
      if (error instanceof BuyingPowerValidationError) {
        throw calculationError('NUMERIC_LIMIT_EXCEEDED');
      }
      throw error;
    }

    if (
      BigInt(availableBuyingPowerUsdMantissa) > BigInt(eligibleGrossValueMantissa) ||
      BigInt(availableBuyingPowerUsdMantissa) > BigInt(supportedPortfolioValueMantissa)
    ) {
      throw calculationError('NUMERIC_LIMIT_EXCEEDED');
    }

    const unavailableReasons = uniqueReasons(
      contributionResults.flatMap(({ unavailableReasons }) => unavailableReasons),
    );
    if (contributionResults.length === 0) {
      unavailableReasons.push('NO_ELIGIBLE_CONTRIBUTIONS');
    }
    const availableCount = contributionResults.filter(
      ({ availability }) => availability === 'AVAILABLE',
    ).length;

    return deepFreeze({
      portfolioSnapshotId: request.portfolioSnapshotId,
      evaluatedAt,
      usdScale: BUYING_POWER_USD_SCALE,
      supportedPortfolioValueMantissa,
      eligibleGrossValueMantissa,
      totalDeductions,
      totalDeductionUsdMantissa,
      availableBuyingPowerUsdMantissa,
      availability:
        availableCount === 0
          ? 'UNAVAILABLE'
          : availableCount === contributionResults.length
            ? 'AVAILABLE'
            : 'PARTIAL',
      unavailableReasons,
      contributions: contributionResults,
      use: 'LOCAL_DEMO_ESTIMATE_ONLY',
      mayAuthorizeFinancialAction: false,
    });
  }

  private readEvaluationTime(): string {
    let value: unknown;
    try {
      value = this.clock.now();
      return canonicalTimestamp(value);
    } catch {
      throw calculationError('CLOCK_FAILED');
    }
  }

  private async adjustContribution(
    contribution: ParsedContribution,
    grossUsdValueMantissa: BuyingPowerUsdMantissa,
    evaluatedAt: string,
  ): Promise<BuyingPowerContributionResult> {
    const adjustmentRequest: BuyingPowerAdjustmentRequest = deepFreeze({
      contributionId: contribution.contributionId,
      walletId: contribution.walletId,
      networkId: contribution.networkId,
      assetId: contribution.assetId,
      grossUsdValueMantissa,
      usdScale: BUYING_POWER_USD_SCALE,
      evaluatedAt,
    });

    let response: unknown;
    try {
      response = await this.adjustments.evaluate(adjustmentRequest);
    } catch {
      return unavailableContribution(contribution, ['ADJUSTMENT_SOURCE_FAILED']);
    }

    let adjustment: AvailableAdjustment | UnavailableAdjustment;
    try {
      adjustment = parseAdjustment(response, contribution.contributionId, evaluatedAt);
    } catch {
      return unavailableContribution(contribution, ['INVALID_ADJUSTMENT_RESPONSE']);
    }
    if (adjustment.status === 'UNAVAILABLE') {
      return unavailableContribution(contribution, adjustment.reasons);
    }

    let totalDeductionUsdMantissa: BuyingPowerUsdMantissa;
    let availableBuyingPowerUsdMantissa: BuyingPowerUsdMantissa;
    try {
      totalDeductionUsdMantissa = totalBuyingPowerDeductions(adjustment.deductions);
      availableBuyingPowerUsdMantissa = subtractBuyingPowerUsdMantissas(
        grossUsdValueMantissa,
        totalDeductionUsdMantissa,
      );
    } catch {
      return unavailableContribution(contribution, ['ADJUSTMENTS_EXCEED_VALUE']);
    }

    return deepFreeze({
      contributionId: contribution.contributionId,
      walletId: contribution.walletId,
      networkId: contribution.networkId,
      assetId: contribution.assetId,
      grossUsdValueMantissa,
      deductions: adjustment.deductions,
      totalDeductionUsdMantissa,
      availableBuyingPowerUsdMantissa,
      availability: 'AVAILABLE',
      unavailableReasons: [],
      asOf: contribution.asOf,
      adjustmentQuoteId: adjustment.quoteId,
      adjustmentQuotedAt: adjustment.quotedAt,
      adjustmentValidUntil: adjustment.validUntil,
    });
  }
}

function parseRequest(value: unknown): ParsedRequest {
  try {
    const record = exactDataRecord(value, ['portfolioSnapshotId', 'contributions']);
    const portfolioSnapshotId = safeIdentifier(record.portfolioSnapshotId);
    if (!Array.isArray(record.contributions) || record.contributions.length > MAX_CONTRIBUTIONS) {
      throw new TypeError('invalid contributions');
    }
    const contributions = record.contributions.map(parseContribution);
    const ids = new Set(contributions.map(({ contributionId }) => contributionId));
    if (ids.size !== contributions.length) throw new TypeError('duplicate contribution');
    return Object.freeze({ portfolioSnapshotId, contributions: Object.freeze(contributions) });
  } catch {
    throw calculationError('INVALID_REQUEST');
  }
}

function parseContribution(value: unknown): ParsedContribution {
  const record = exactDataRecord(value, [
    'contributionId',
    'walletId',
    'networkId',
    'assetId',
    'supported',
    'freshness',
    'valuationUse',
    'usdValueMantissa',
    'asOf',
  ]);
  if (typeof record.supported !== 'boolean') throw new TypeError('invalid supported flag');
  const freshness = oneOf(record.freshness, [
    'CURRENT',
    'STALE',
    'UNAVAILABLE',
  ] as const) as BuyingPowerFreshness;
  const valuationUse = oneOf(record.valuationUse, [
    'CONSERVATIVE_REPORTING_ONLY',
    'BLOCKED',
  ] as const) as BuyingPowerValuationUse;
  return Object.freeze({
    contributionId: safeIdentifier(record.contributionId),
    walletId: safeIdentifier(record.walletId),
    networkId: safeIdentifier(record.networkId),
    assetId: safeIdentifier(record.assetId),
    supported: record.supported,
    freshness,
    valuationUse,
    usdValueMantissa:
      record.usdValueMantissa === null
        ? null
        : normalizeBuyingPowerUsdMantissa(record.usdValueMantissa),
    asOf: canonicalTimestamp(record.asOf),
  });
}

function contributionUnavailableReasons(
  contribution: ParsedContribution,
): BuyingPowerUnavailableReason[] {
  const reasons: BuyingPowerUnavailableReason[] = [];
  if (!contribution.supported) reasons.push('UNSUPPORTED_ASSET');
  if (contribution.usdValueMantissa === null) reasons.push('UNPRICED_ASSET');
  if (contribution.freshness === 'STALE') reasons.push('STALE_DATA');
  if (contribution.freshness === 'UNAVAILABLE') reasons.push('SOURCE_UNAVAILABLE');
  if (contribution.valuationUse === 'BLOCKED') reasons.push('VALUATION_USE_BLOCKED');
  return reasons;
}

function unavailableContribution(
  contribution: ParsedContribution,
  reasons: readonly BuyingPowerUnavailableReason[],
): BuyingPowerContributionResult {
  const zero = normalizeBuyingPowerUsdMantissa('0');
  return deepFreeze({
    contributionId: contribution.contributionId,
    walletId: contribution.walletId,
    networkId: contribution.networkId,
    assetId: contribution.assetId,
    grossUsdValueMantissa: contribution.usdValueMantissa,
    deductions: null,
    totalDeductionUsdMantissa: null,
    availableBuyingPowerUsdMantissa: zero,
    availability: 'UNAVAILABLE',
    unavailableReasons: [...reasons],
    asOf: contribution.asOf,
    adjustmentQuoteId: null,
    adjustmentQuotedAt: null,
    adjustmentValidUntil: null,
  });
}

function parseAdjustment(
  value: unknown,
  expectedContributionId: string,
  evaluatedAt: string,
): AvailableAdjustment | UnavailableAdjustment {
  const base = exactDataRecordWithAllowedKeys(
    value,
    ['status', 'contributionId'],
    ['quoteId', 'quotedAt', 'validUntil', 'deductions', 'reasons'],
  );
  const status = oneOf(base.status, ['AVAILABLE', 'UNAVAILABLE'] as const);
  const contributionId = safeIdentifier(base.contributionId);
  if (contributionId !== expectedContributionId) throw new TypeError('contribution mismatch');

  if (status === 'UNAVAILABLE') {
    assertExactKeys(base, ['status', 'contributionId', 'reasons']);
    if (!Array.isArray(base.reasons) || base.reasons.length === 0) {
      throw new TypeError('missing unavailable reasons');
    }
    const reasons = base.reasons.map((reason) => oneOf(reason, ADJUSTMENT_UNAVAILABLE_REASONS));
    if (new Set(reasons).size !== reasons.length) throw new TypeError('duplicate reason');
    return Object.freeze({ status, contributionId, reasons: Object.freeze(reasons) });
  }

  assertExactKeys(base, [
    'status',
    'quoteId',
    'contributionId',
    'quotedAt',
    'validUntil',
    'deductions',
  ]);
  const quotedAt = canonicalTimestamp(base.quotedAt);
  const validUntil = canonicalTimestamp(base.validUntil);
  if (quotedAt > evaluatedAt || validUntil < evaluatedAt || validUntil < quotedAt) {
    throw new TypeError('invalid adjustment lifetime');
  }
  return Object.freeze({
    status,
    quoteId: safeIdentifier(base.quoteId),
    contributionId,
    quotedAt,
    validUntil,
    deductions: parseDeductions(base.deductions),
  });
}

function parseDeductions(value: unknown): BuyingPowerDeductionBreakdown {
  const record = exactDataRecord(value, BUYING_POWER_DEDUCTION_KINDS);
  return Object.freeze({
    liquidity: normalizeBuyingPowerUsdMantissa(record.liquidity),
    conversion: normalizeBuyingPowerUsdMantissa(record.conversion),
    slippage: normalizeBuyingPowerUsdMantissa(record.slippage),
    network: normalizeBuyingPowerUsdMantissa(record.network),
    routing: normalizeBuyingPowerUsdMantissa(record.routing),
  });
}

function sumDeductionBreakdowns(
  values: readonly BuyingPowerDeductionBreakdown[],
): BuyingPowerDeductionBreakdown {
  if (values.length === 0) return zeroBuyingPowerDeductions();
  return Object.freeze({
    liquidity: addBuyingPowerUsdMantissas(values.map(({ liquidity }) => liquidity)),
    conversion: addBuyingPowerUsdMantissas(values.map(({ conversion }) => conversion)),
    slippage: addBuyingPowerUsdMantissas(values.map(({ slippage }) => slippage)),
    network: addBuyingPowerUsdMantissas(values.map(({ network }) => network)),
    routing: addBuyingPowerUsdMantissas(values.map(({ routing }) => routing)),
  });
}

function uniqueReasons(
  values: readonly BuyingPowerUnavailableReason[],
): BuyingPowerUnavailableReason[] {
  return [...new Set(values)];
}

function safeIdentifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !SAFE_IDENTIFIER.test(value)
  ) {
    throw new TypeError('invalid identifier');
  }
  return value;
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) {
    throw new TypeError('invalid timestamp');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new TypeError('invalid timestamp');
  }
  return value;
}

function oneOf<const Value extends string>(value: unknown, allowed: readonly Value[]): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value)) {
    throw new TypeError('unsupported value');
  }
  return value as Value;
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  const record = exactDataRecordWithAllowedKeys(value, expectedKeys, []);
  assertExactKeys(record, expectedKeys);
  return record;
}

function exactDataRecordWithAllowedKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('expected data record');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('expected data record');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
    requiredKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some(
      (descriptor) => !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true,
    )
  ) {
    throw new TypeError('unexpected record shape');
  }
  const record: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    record[key] = descriptor.value;
  }
  return record;
}

function assertExactKeys(record: Record<string, unknown>, expectedKeys: readonly string[]): void {
  const actual = Object.keys(record);
  if (
    actual.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new TypeError('unexpected record shape');
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function calculationError(code: BuyingPowerCalculationErrorCode): BuyingPowerCalculationError {
  return new BuyingPowerCalculationError(code);
}
