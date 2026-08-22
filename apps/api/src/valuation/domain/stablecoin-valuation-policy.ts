import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  SUPPORTED_STABLECOINS,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';

const CANONICAL_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const SOURCE_REFERENCE_PATTERN = /^[\x21-\x7e]{1,192}$/u;
const PYTH_UPDATE_ID_PATTERN = /^[0-9a-f]{64}$/u;
const RECOVERY_EVENT_ID_PATTERN = /^[0-9a-f]{64}$/u;
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_ATOMIC_AMOUNT =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export const STABLECOIN_VALUATION_POLICY_VERSION = 1 as const;
export const STABLECOIN_VALUATION_SOURCES = Object.freeze([
  'PYTH_CORE',
  'CHAINLINK_DATA_FEEDS',
] as const);
export const STABLECOIN_VALUATION_AVAILABILITY = Object.freeze([
  'AVAILABLE',
  'UNAVAILABLE',
] as const);

export type StablecoinValuationSourceId = (typeof STABLECOIN_VALUATION_SOURCES)[number];
export type StablecoinValuationAvailability = (typeof STABLECOIN_VALUATION_AVAILABILITY)[number];
export type StablecoinValuationFreshness = 'CURRENT' | 'STALE' | 'UNAVAILABLE';
export type StablecoinValuationConfidenceClass = 'MEDIUM' | 'LOW' | 'UNAVAILABLE';
export type StablecoinValuationDepegClass = 'NOT_ASSESSED' | 'WITHIN_POLICY' | 'OUTSIDE_POLICY';
export type StablecoinDownsideBand = 'NORMAL' | 'WATCH' | 'DEPEGGED' | 'NOT_ASSESSED';
export type StablecoinSourceAgreement =
  'CORROBORATED' | 'SOFT_DISAGREEMENT' | 'CONFLICT' | 'SINGLE_SOURCE' | 'NOT_AVAILABLE';
export type StablecoinValuationSelection = 'PRIMARY' | 'FALLBACK' | 'CONSERVATIVE_MINIMUM' | 'NONE';

export type StablecoinValuationReason =
  | 'INVALID_INPUT'
  | 'NO_ELIGIBLE_SOURCE'
  | 'SOURCE_CONFLICT'
  | 'SINGLE_SOURCE'
  | 'FALLBACK_SOURCE_SELECTED'
  | 'SOFT_SOURCE_DISAGREEMENT'
  | 'PUBLISHED_CONFIDENCE_LOWER_BOUND'
  | 'UPSIDE_CAPPED_AT_PEG'
  | 'WATCH_DOWNSIDE'
  | 'DEPEG_DETECTED'
  | 'NUMERIC_LIMIT_EXCEEDED';

export type StablecoinSourceEligibility =
  | 'ELIGIBLE_CURRENT'
  | 'STALE'
  | 'MISSING'
  | 'EXPIRED'
  | 'FUTURE_TIMESTAMP'
  | 'NON_MONOTONIC_SEQUENCE'
  | 'REPLAYED_OR_REGRESSED'
  | 'WIDE_CONFIDENCE';

export interface StablecoinValuationAssetReference {
  readonly registryEnvironment: 'MAINNET';
  readonly registryVersion: 1;
  readonly registryFingerprintSha256: string;
  readonly stablecoin: SupportedStablecoin;
  readonly networkId: string;
  readonly identity: string;
  readonly decimals: number;
}

export const STABLECOIN_VALUATION_FEED_REFERENCES = deepFreeze({
  USDC: {
    PYTH_CORE: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    CHAINLINK_DATA_FEEDS: 'usdc-usd.data.eth',
  },
  USDT: {
    PYTH_CORE: '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
    CHAINLINK_DATA_FEEDS: 'usdt-usd.data.eth',
  },
  PYUSD: {
    PYTH_CORE: 'c1da1b73d7f01e7ddd54b3766cf7fcd644395ad14f70aa706ec5384c59e76692',
    CHAINLINK_DATA_FEEDS: 'pyusd-usd.data.eth',
  },
} as const);

export const STABLECOIN_VALUATION_FIRST_USE_WATERMARKS = deepFreeze([
  {
    sourceId: 'PYTH_CORE',
    lastAcceptedSequence: null,
    lastAcceptedPricedAt: null,
    lastAcceptedObservedAt: null,
    lastAcceptedUpdateId: null,
  },
  {
    sourceId: 'CHAINLINK_DATA_FEEDS',
    lastAcceptedSequence: null,
    lastAcceptedPricedAt: null,
    lastAcceptedObservedAt: null,
    lastAcceptedUpdateId: null,
  },
] as const satisfies readonly StablecoinSourceWatermark[]);

export type StablecoinPriceConfidence =
  | Readonly<{
      kind: 'PUBLISHED_ABSOLUTE_USD';
      mantissa: string;
      scale: number;
    }>
  | Readonly<{
      kind: 'NOT_PUBLISHED';
    }>;

export interface StablecoinPriceObservation {
  readonly asset: StablecoinValuationAssetReference;
  readonly sourceId: StablecoinValuationSourceId;
  readonly sourceReference: string;
  readonly sourceSequence: string;
  readonly sourceUpdateId: string;
  readonly pricedAt: string;
  readonly observedAt: string;
  readonly usdRateMantissa: string;
  readonly usdRateScale: number;
  readonly confidence: StablecoinPriceConfidence;
}

export interface StablecoinSourceWatermark {
  readonly sourceId: StablecoinValuationSourceId;
  readonly lastAcceptedSequence: string | null;
  readonly lastAcceptedPricedAt: string | null;
  readonly lastAcceptedObservedAt: string | null;
  readonly lastAcceptedUpdateId: string | null;
}

export interface StablecoinValuationRequest {
  readonly asset: StablecoinValuationAssetReference;
  readonly amountAtomic: string;
  readonly evaluatedAt: string;
  readonly sourceWatermarks: readonly StablecoinSourceWatermark[];
  readonly observations: readonly StablecoinPriceObservation[];
}

export interface StablecoinUsdValueCalculation {
  readonly amountAtomic: string;
  readonly assetDecimals: number;
  readonly usdRateMantissa: string;
  readonly usdRateScale: number;
}

export interface StablecoinRecoverySample {
  readonly evaluatedAt: string;
  readonly observations: readonly StablecoinPriceObservation[];
}

export interface StablecoinDepegLatchReference {
  readonly asset: StablecoinValuationAssetReference;
  readonly latchId: string;
  readonly latchedAt: string;
}

export interface StablecoinManualRiskClearReference {
  readonly asset: StablecoinValuationAssetReference;
  readonly clearId: string;
  readonly latchId: string;
  readonly clearedAt: string;
}

export interface StablecoinRecoveryRequest {
  readonly asset: StablecoinValuationAssetReference;
  readonly evaluatedAt: string;
  readonly depegLatch: StablecoinDepegLatchReference | null;
  readonly manualRiskClear: StablecoinManualRiskClearReference | null;
  readonly samples: readonly StablecoinRecoverySample[];
}

export type StablecoinRecoveryStatus =
  | 'INVALID_INPUT'
  | 'NOT_APPLICABLE'
  | 'RECOVERY_PENDING'
  | 'MANUAL_RISK_CLEAR_REQUIRED'
  | 'RECOVERY_CANDIDATE_CLEARED';

export type StablecoinRecoveryReason =
  | 'INVALID_INPUT'
  | 'NO_PRIOR_DEPEG_LATCH'
  | 'INSUFFICIENT_DISTINCT_OBSERVATIONS'
  | 'NON_MONOTONIC_EVIDENCE'
  | 'INSUFFICIENT_OBSERVATION_SPAN'
  | 'DEPEG_LATCH_AFTER_RECOVERY_EVALUATION'
  | 'EVIDENCE_PRECEDES_DEPEG_LATCH'
  | 'EVIDENCE_AFTER_RECOVERY_EVALUATION'
  | 'OBSERVATION_NOT_CURRENT'
  | 'OBSERVATION_NOT_CORROBORATED'
  | 'OBSERVATION_OUTSIDE_REPEG_BAND'
  | 'MANUAL_RISK_CLEAR_REQUIRED'
  | 'MANUAL_RISK_CLEAR_LATCH_MISMATCH'
  | 'MANUAL_RISK_CLEAR_PRECEDES_FINAL_SAMPLE'
  | 'MANUAL_RISK_CLEAR_AFTER_RECOVERY_EVALUATION'
  | 'LOCAL_CANDIDATE_CLEAR_ONLY';

export interface StablecoinRecoveryResult {
  readonly policyVersion: typeof STABLECOIN_VALUATION_POLICY_VERSION;
  readonly policyApprovalState: 'PENDING_EXTERNAL_APPROVAL';
  readonly status: StablecoinRecoveryStatus;
  readonly asset: StablecoinValuationAssetReference | null;
  readonly evaluatedAt: string | null;
  readonly depegLatch: StablecoinDepegLatchReference | null;
  readonly acceptedManualRiskClear: StablecoinManualRiskClearReference | null;
  readonly evidenceCount: number;
  readonly evidenceSpanMs: number | null;
  readonly reasons: readonly StablecoinRecoveryReason[];
  readonly manualRiskClearAccepted: boolean;
  readonly mayIncreaseBuyingPower: false;
  readonly mayAuthorizeFinancialUse: false;
}

export interface StablecoinSourceAssessment {
  readonly sourceId: StablecoinValuationSourceId;
  readonly role: 'PRIMARY' | 'FALLBACK_AND_CROSS_CHECK';
  readonly eligibility: StablecoinSourceEligibility;
  readonly observation: StablecoinPriceObservation | null;
  readonly conservativeUsdRateMantissa: string | null;
  readonly conservativeUsdRateScale: number | null;
}

export interface StablecoinValuationResult {
  readonly policyVersion: typeof STABLECOIN_VALUATION_POLICY_VERSION;
  readonly policyApprovalState: 'PENDING_EXTERNAL_APPROVAL';
  readonly availability: StablecoinValuationAvailability;
  readonly asset: StablecoinValuationAssetReference | null;
  readonly amountAtomic: string | null;
  readonly evaluatedAt: string | null;
  readonly selection: StablecoinValuationSelection;
  readonly selectedSourceId: StablecoinValuationSourceId | null;
  readonly selectedSourceReference: string | null;
  readonly selectedSourceSequence: string | null;
  readonly pricedAt: string | null;
  readonly observedAt: string | null;
  readonly usdRateMantissa: string | null;
  readonly usdRateScale: number | null;
  readonly usdValueMantissa: string | null;
  readonly usdValueScale: 18;
  readonly roundingMode: 'ROUND_HALF_EVEN';
  readonly freshnessClass: StablecoinValuationFreshness;
  readonly confidenceClass: StablecoinValuationConfidenceClass;
  readonly depegClass: StablecoinValuationDepegClass;
  readonly downsideBand: StablecoinDownsideBand;
  readonly sourceAgreement: StablecoinSourceAgreement;
  readonly reasons: readonly StablecoinValuationReason[];
  readonly sourceAssessments: readonly StablecoinSourceAssessment[];
  readonly reportingUse: 'CONSERVATIVE_REPORTING_ONLY' | 'BLOCKED';
  readonly mayIncreaseBuyingPower: false;
  readonly mayAuthorizeFinancialUse: false;
}

export const STABLECOIN_VALUATION_POLICY = deepFreeze({
  version: STABLECOIN_VALUATION_POLICY_VERSION,
  localStatus: 'READY_FOR_INDEPENDENT_REVIEW',
  externalStatus: 'PENDING_EXTERNAL_APPROVAL',
  supportedStablecoins: SUPPORTED_STABLECOINS,
  registryBinding: {
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  },
  sourceOrder: [
    {
      sourceId: 'PYTH_CORE',
      role: 'PRIMARY',
      confidenceModel: 'PUBLISHED_ABSOLUTE_USD',
      sequenceSemantic: 'VERIFIED_MONOTONIC_ADAPTER_CURSOR_NOT_PUBLISH_TIME',
      updateIdSemantic: 'CANONICAL_SIGNED_UPDATE_DIGEST',
      activationState: 'PROPOSED_PENDING_KAN_252',
    },
    {
      sourceId: 'CHAINLINK_DATA_FEEDS',
      role: 'FALLBACK_AND_CROSS_CHECK',
      confidenceModel: 'NOT_PUBLISHED',
      sequenceSemantic: 'CHAINLINK_ROUND_ID',
      updateIdSemantic: 'CHAINLINK_ROUND_ID',
      activationState: 'PROPOSED_PENDING_KAN_252',
    },
  ],
  bounds: {
    maxObservations: 8,
    maxAmountDigits: 78,
    maxRateDigits: 78,
    maxRateScale: 36,
    maxAssetDecimals: 36,
    maxProductDigits: 156,
    maxUsdValueDigits: 96,
    usdValueScale: 18,
    normalizedUsdRateScale: 8,
  },
  freshness: {
    currentWithinMs: 60_000,
    unavailableAfterMs: 300_000,
    providerHeartbeatMayExtendRiskLimit: false,
  },
  confidence: {
    publishedWidthEligibleAtOrBelowBps: '50',
    mediumPublishedWidthAtOrBelowBps: '25',
    absentConfidenceNeverBecomesZero: true,
    absentConfidenceNeverBecomesHigh: true,
    highClassEnabled: false,
  },
  sourceAgreement: {
    corroboratedAtOrBelowBps: '25',
    softDisagreementAtOrBelowBps: '50',
    conflictBehavior: 'UNAVAILABLE_PRESERVE_EVIDENCE',
  },
  downside: {
    pegUsdMantissa: '1',
    pegUsdScale: 0,
    upsideTreatment: 'CAP_AT_PEG',
    normalAtOrBelowBps: '50',
    depeggedAtOrAboveBps: '200',
    fullDownsidePreserved: true,
  },
  recovery: {
    consecutiveDualCorroboratedObservations: 4,
    withinPegBps: '25',
    minimumSpanMs: 1_800_000,
    depegLatchReferenceRequired: true,
    trustedEvaluationTimeRequired: true,
    evidenceMustNotPrecedeLatch: true,
    clearMustMatchLatchAndFollowEvidence: true,
    manualRiskClearRequired: true,
  },
  externalGates: {
    KAN_252: 'PENDING',
    KAN_231: 'PENDING',
  },
  trustBoundary: {
    acceptedConstructor: 'SERVER_CLOCK_AND_CRYPTOGRAPHIC_OR_ONCHAIN_VERIFIED_ADAPTER_ONLY',
    httpPayloadIsSourceProof: false,
    structuralParsingIsSourceProof: false,
    durableWatermarkPersistenceImplemented: false,
    durableUpdateIdUniquenessImplemented: false,
    durableDepegLatchPersistenceImplemented: false,
    manualRiskClearAuthenticationImplemented: false,
    runtimeAdapterImplemented: false,
  },
  authorization: {
    reportingUse: 'CONSERVATIVE_ONLY',
    newCredit: 'FROZEN',
    financialUse: 'BLOCKED_PENDING_EXTERNAL_APPROVAL',
  },
} as const);

interface FixedDecimal {
  readonly mantissa: bigint;
  readonly scale: number;
}

interface ParsedObservation extends StablecoinPriceObservation {
  readonly pricedAtMs: number;
  readonly observedAtMs: number;
  readonly rate: FixedDecimal;
  readonly confidenceAmount: FixedDecimal | null;
}

interface ParsedRequest {
  readonly asset: StablecoinValuationAssetReference;
  readonly amountAtomic: string;
  readonly amount: bigint;
  readonly evaluatedAt: string;
  readonly evaluatedAtMs: number;
  readonly sourceWatermarks: readonly ParsedSourceWatermark[];
  readonly observations: readonly ParsedObservation[];
}

interface ParsedSourceWatermark extends StablecoinSourceWatermark {
  readonly lastAcceptedPricedAtMs: number | null;
  readonly lastAcceptedObservedAtMs: number | null;
}

interface ParsedRecoverySample {
  readonly evaluatedAt: string;
  readonly evaluatedAtMs: number;
  readonly observations: readonly ParsedObservation[];
  readonly valuation: StablecoinValuationResult;
}

interface ParsedRecoveryRequest {
  readonly asset: StablecoinValuationAssetReference;
  readonly evaluatedAt: string;
  readonly evaluatedAtMs: number;
  readonly depegLatch: ParsedDepegLatchReference | null;
  readonly manualRiskClear: ParsedManualRiskClearReference | null;
  readonly samples: readonly ParsedRecoverySample[];
}

interface ParsedDepegLatchReference extends StablecoinDepegLatchReference {
  readonly latchedAtMs: number;
}

interface ParsedManualRiskClearReference extends StablecoinManualRiskClearReference {
  readonly clearedAtMs: number;
}

interface SourceCandidate {
  readonly assessment: StablecoinSourceAssessment;
  readonly observation: ParsedObservation;
  readonly conservativeRate: FixedDecimal;
  readonly freshness: Exclude<StablecoinValuationFreshness, 'UNAVAILABLE'>;
  readonly confidenceLowerBoundApplied: boolean;
}

interface InternalAssessment {
  readonly publicAssessment: StablecoinSourceAssessment;
  readonly candidate: SourceCandidate | null;
}

class InvalidValuationInput extends Error {}

/**
 * Pure candidate classifier. Structural validation is not source authentication. Runtime callers must
 * supply a server-clock evaluation time, adapter-verified signed/onchain evidence, durable prior
 * watermarks, and a repository-enforced unique update-ID history. The last-accepted watermark can
 * detect only an immediate replay, not A -> B -> A across requests. This function is not an HTTP
 * payload boundary and never authorizes financial use.
 */
export function evaluateStablecoinValuation(input: unknown): StablecoinValuationResult {
  let request: ParsedRequest;
  try {
    request = parseRequest(input);
  } catch {
    return unavailableResult(null, null, null, 'NOT_AVAILABLE', ['INVALID_INPUT'], []);
  }

  const internalAssessments = STABLECOIN_VALUATION_POLICY.sourceOrder.map((source) =>
    assessSource(request, source.sourceId, source.role),
  );
  const assessments = internalAssessments.map(({ publicAssessment }) => publicAssessment);
  const candidates = internalAssessments.flatMap(({ candidate }) =>
    candidate === null ? [] : [candidate],
  );
  const currentCandidates = candidates.filter(({ freshness }) => freshness === 'CURRENT');
  const selectionPool = currentCandidates;

  if (selectionPool.length === 0) {
    return unavailableResult(
      request.asset,
      request.amountAtomic,
      request.evaluatedAt,
      'NOT_AVAILABLE',
      ['NO_ELIGIBLE_SOURCE'],
      assessments,
    );
  }

  if (
    selectionPool.length === 2 &&
    selectionPool.every(({ freshness }) => freshness === 'CURRENT')
  ) {
    const first = selectionPool[0];
    const second = selectionPool[1];
    if (!first || !second) {
      return unavailableResult(
        request.asset,
        request.amountAtomic,
        request.evaluatedAt,
        'NOT_AVAILABLE',
        ['INVALID_INPUT'],
        assessments,
      );
    }
    const disagreement = classifySourceAgreement(first.observation.rate, second.observation.rate);
    if (disagreement === 'CONFLICT') {
      const downsideBand = mostSevereDownsideBand([
        classifyDownside(first.conservativeRate),
        classifyDownside(second.conservativeRate),
      ]);
      return unavailableResult(
        request.asset,
        request.amountAtomic,
        request.evaluatedAt,
        'CONFLICT',
        downsideBand === 'DEPEGGED' ? ['SOURCE_CONFLICT', 'DEPEG_DETECTED'] : ['SOURCE_CONFLICT'],
        assessments,
        downsideBand === 'DEPEGGED' ? 'OUTSIDE_POLICY' : 'NOT_ASSESSED',
        downsideBand === 'DEPEGGED' ? 'DEPEGGED' : 'NOT_ASSESSED',
      );
    }
    return availableResult(
      request,
      selectionPool,
      assessments,
      disagreement,
      disagreement === 'CORROBORATED' && pythConfidenceAllowsMedium(selectionPool)
        ? 'MEDIUM'
        : 'LOW',
    );
  }

  return availableResult(request, selectionPool, assessments, 'SINGLE_SOURCE', 'LOW');
}

/** Exact ADR-0003 arithmetic only; this does not validate or authorize a price source. */
export function calculateStablecoinUsdValueMantissa(input: unknown): string | null {
  try {
    const record = dataRecord(input, [
      'amountAtomic',
      'assetDecimals',
      'usdRateMantissa',
      'usdRateScale',
    ]);
    const amountAtomic = parseAmount(record.amountAtomic);
    const assetDecimals = record.assetDecimals;
    const rateMantissa = record.usdRateMantissa;
    const rateScale = parseScale(record.usdRateScale);
    if (
      typeof assetDecimals !== 'number' ||
      !Number.isSafeInteger(assetDecimals) ||
      assetDecimals < 0 ||
      assetDecimals > STABLECOIN_VALUATION_POLICY.bounds.maxAssetDecimals ||
      typeof rateMantissa !== 'string' ||
      !CANONICAL_INTEGER_PATTERN.test(rateMantissa) ||
      rateMantissa.length > STABLECOIN_VALUATION_POLICY.bounds.maxRateDigits
    ) {
      return invalidInput();
    }
    const result = calculateUsdValue(BigInt(amountAtomic), assetDecimals, {
      mantissa: BigInt(rateMantissa),
      scale: rateScale,
    });
    return result?.toString() ?? null;
  } catch {
    return null;
  }
}

/**
 * Pure recovery classifier. Runtime callers must supply a server-clock evaluation time, a durable
 * asset-bound latch, and an independently authenticated Risk-clear record. Structural parsing does
 * not persist or authenticate either event, and every result remains financially unauthorized.
 */
export function evaluateStablecoinRecovery(input: unknown): StablecoinRecoveryResult {
  let request: ParsedRecoveryRequest;
  try {
    request = parseRecoveryRequest(input);
  } catch {
    return recoveryResult('INVALID_INPUT', null, null, null, null, 0, null, ['INVALID_INPUT']);
  }
  if (request.depegLatch === null) {
    return recoveryResult(
      'NOT_APPLICABLE',
      request.asset,
      request.evaluatedAt,
      null,
      null,
      request.samples.length,
      recoverySpan(request.samples),
      ['NO_PRIOR_DEPEG_LATCH'],
    );
  }

  const depegLatch = publicDepegLatchReference(request.depegLatch);
  const reasons: StablecoinRecoveryReason[] = [];
  if (
    request.samples.length <
    STABLECOIN_VALUATION_POLICY.recovery.consecutiveDualCorroboratedObservations
  ) {
    reasons.push('INSUFFICIENT_DISTINCT_OBSERVATIONS');
  }
  if (!recoveryEvidenceIsStrictlyMonotonic(request.samples)) {
    reasons.push('NON_MONOTONIC_EVIDENCE');
  }
  const spanMs = recoverySpan(request.samples);
  if (spanMs === null || spanMs < STABLECOIN_VALUATION_POLICY.recovery.minimumSpanMs) {
    reasons.push('INSUFFICIENT_OBSERVATION_SPAN');
  }
  if (request.depegLatch.latchedAtMs > request.evaluatedAtMs) {
    reasons.push('DEPEG_LATCH_AFTER_RECOVERY_EVALUATION');
  }
  for (const sample of request.samples) {
    if (
      sample.evaluatedAtMs < request.depegLatch.latchedAtMs ||
      sample.observations.some(
        ({ pricedAtMs, observedAtMs }) =>
          pricedAtMs < request.depegLatch!.latchedAtMs ||
          observedAtMs < request.depegLatch!.latchedAtMs,
      )
    ) {
      reasons.push('EVIDENCE_PRECEDES_DEPEG_LATCH');
    }
    if (sample.evaluatedAtMs > request.evaluatedAtMs) {
      reasons.push('EVIDENCE_AFTER_RECOVERY_EVALUATION');
    }
    if (
      sample.valuation.sourceAssessments.some(
        ({ eligibility }) => eligibility !== 'ELIGIBLE_CURRENT',
      )
    ) {
      reasons.push('OBSERVATION_NOT_CURRENT');
    }
    if (
      sample.valuation.availability !== 'AVAILABLE' ||
      sample.valuation.sourceAgreement !== 'CORROBORATED' ||
      sample.valuation.confidenceClass !== 'MEDIUM'
    ) {
      reasons.push('OBSERVATION_NOT_CORROBORATED');
    }
    if (!valuationWithinRecoveryBand(sample.valuation)) {
      reasons.push('OBSERVATION_OUTSIDE_REPEG_BAND');
    }
  }
  const uniqueReasons = orderedRecoveryReasons(reasons);
  if (uniqueReasons.length > 0) {
    return recoveryResult(
      'RECOVERY_PENDING',
      request.asset,
      request.evaluatedAt,
      depegLatch,
      null,
      request.samples.length,
      spanMs,
      uniqueReasons,
    );
  }
  if (request.manualRiskClear === null) {
    return recoveryResult(
      'MANUAL_RISK_CLEAR_REQUIRED',
      request.asset,
      request.evaluatedAt,
      depegLatch,
      null,
      request.samples.length,
      spanMs,
      ['MANUAL_RISK_CLEAR_REQUIRED'],
    );
  }
  if (request.manualRiskClear.latchId !== request.depegLatch.latchId) {
    return recoveryResult(
      'MANUAL_RISK_CLEAR_REQUIRED',
      request.asset,
      request.evaluatedAt,
      depegLatch,
      null,
      request.samples.length,
      spanMs,
      ['MANUAL_RISK_CLEAR_LATCH_MISMATCH'],
    );
  }
  const lastSample = request.samples.at(-1);
  if (!lastSample || request.manualRiskClear.clearedAtMs < lastSample.evaluatedAtMs) {
    return recoveryResult(
      'MANUAL_RISK_CLEAR_REQUIRED',
      request.asset,
      request.evaluatedAt,
      depegLatch,
      null,
      request.samples.length,
      spanMs,
      ['MANUAL_RISK_CLEAR_PRECEDES_FINAL_SAMPLE'],
    );
  }
  if (request.manualRiskClear.clearedAtMs > request.evaluatedAtMs) {
    return recoveryResult(
      'MANUAL_RISK_CLEAR_REQUIRED',
      request.asset,
      request.evaluatedAt,
      depegLatch,
      null,
      request.samples.length,
      spanMs,
      ['MANUAL_RISK_CLEAR_AFTER_RECOVERY_EVALUATION'],
    );
  }
  return recoveryResult(
    'RECOVERY_CANDIDATE_CLEARED',
    request.asset,
    request.evaluatedAt,
    depegLatch,
    publicManualRiskClearReference(request.manualRiskClear),
    request.samples.length,
    spanMs,
    ['LOCAL_CANDIDATE_CLEAR_ONLY'],
  );
}

function availableResult(
  request: ParsedRequest,
  candidates: readonly SourceCandidate[],
  assessments: readonly StablecoinSourceAssessment[],
  sourceAgreement: Exclude<StablecoinSourceAgreement, 'CONFLICT'>,
  confidenceClass: Exclude<StablecoinValuationConfidenceClass, 'UNAVAILABLE'>,
): StablecoinValuationResult {
  const selected = candidates.reduce((lowest, candidate) =>
    compareFixed(candidate.conservativeRate, lowest.conservativeRate) < 0 ? candidate : lowest,
  );
  const uncappedRate = selected.conservativeRate;
  const effectiveRate = minimumFixed(uncappedRate, { mantissa: 100_000_000n, scale: 8 });
  const upsideCapped = compareFixed(uncappedRate, effectiveRate) > 0;
  const usdValue = calculateUsdValue(request.amount, request.asset.decimals, effectiveRate);
  if (usdValue === null) {
    return unavailableResult(
      request.asset,
      request.amountAtomic,
      request.evaluatedAt,
      sourceAgreement,
      ['NUMERIC_LIMIT_EXCEEDED'],
      assessments,
    );
  }
  const downsideBand = classifyDownside(effectiveRate);
  const selectedObservation = selected.observation;
  const selection: StablecoinValuationSelection =
    candidates.length > 1
      ? 'CONSERVATIVE_MINIMUM'
      : selectedObservation.sourceId === 'PYTH_CORE'
        ? 'PRIMARY'
        : 'FALLBACK';
  const freshnessClass = candidates.every(({ freshness }) => freshness === 'CURRENT')
    ? 'CURRENT'
    : 'STALE';
  const reasons = orderedReasons([
    ...(candidates.length === 1 ? (['SINGLE_SOURCE'] as const) : []),
    ...(selectedObservation.sourceId === 'CHAINLINK_DATA_FEEDS'
      ? (['FALLBACK_SOURCE_SELECTED'] as const)
      : []),
    ...(sourceAgreement === 'SOFT_DISAGREEMENT' ? (['SOFT_SOURCE_DISAGREEMENT'] as const) : []),
    ...(selected.confidenceLowerBoundApplied
      ? (['PUBLISHED_CONFIDENCE_LOWER_BOUND'] as const)
      : []),
    ...(upsideCapped ? (['UPSIDE_CAPPED_AT_PEG'] as const) : []),
    ...(downsideBand === 'WATCH' ? (['WATCH_DOWNSIDE'] as const) : []),
    ...(downsideBand === 'DEPEGGED' ? (['DEPEG_DETECTED'] as const) : []),
  ]);

  return deepFreeze({
    policyVersion: STABLECOIN_VALUATION_POLICY_VERSION,
    policyApprovalState: 'PENDING_EXTERNAL_APPROVAL',
    availability: 'AVAILABLE',
    asset: request.asset,
    amountAtomic: request.amountAtomic,
    evaluatedAt: request.evaluatedAt,
    selection,
    selectedSourceId: selectedObservation.sourceId,
    selectedSourceReference: selectedObservation.sourceReference,
    selectedSourceSequence: selectedObservation.sourceSequence,
    pricedAt: selectedObservation.pricedAt,
    observedAt: selectedObservation.observedAt,
    usdRateMantissa: effectiveRate.mantissa.toString(),
    usdRateScale: effectiveRate.scale,
    usdValueMantissa: usdValue.toString(),
    usdValueScale: 18,
    roundingMode: 'ROUND_HALF_EVEN',
    freshnessClass,
    confidenceClass: freshnessClass === 'STALE' ? 'LOW' : confidenceClass,
    depegClass: downsideBand === 'DEPEGGED' ? 'OUTSIDE_POLICY' : 'WITHIN_POLICY',
    downsideBand,
    sourceAgreement,
    reasons,
    sourceAssessments: assessments,
    reportingUse: 'CONSERVATIVE_REPORTING_ONLY',
    mayIncreaseBuyingPower: false,
    mayAuthorizeFinancialUse: false,
  } as const);
}

function unavailableResult(
  asset: StablecoinValuationAssetReference | null,
  amountAtomic: string | null,
  evaluatedAt: string | null,
  sourceAgreement: StablecoinSourceAgreement,
  reasons: readonly StablecoinValuationReason[],
  sourceAssessments: readonly StablecoinSourceAssessment[],
  depegClass: StablecoinValuationDepegClass = 'NOT_ASSESSED',
  downsideBand: StablecoinDownsideBand = 'NOT_ASSESSED',
): StablecoinValuationResult {
  return deepFreeze({
    policyVersion: STABLECOIN_VALUATION_POLICY_VERSION,
    policyApprovalState: 'PENDING_EXTERNAL_APPROVAL',
    availability: 'UNAVAILABLE',
    asset,
    amountAtomic,
    evaluatedAt,
    selection: 'NONE',
    selectedSourceId: null,
    selectedSourceReference: null,
    selectedSourceSequence: null,
    pricedAt: null,
    observedAt: null,
    usdRateMantissa: null,
    usdRateScale: null,
    usdValueMantissa: null,
    usdValueScale: 18,
    roundingMode: 'ROUND_HALF_EVEN',
    freshnessClass: 'UNAVAILABLE',
    confidenceClass: 'UNAVAILABLE',
    depegClass,
    downsideBand,
    sourceAgreement,
    reasons: orderedReasons(reasons),
    sourceAssessments,
    reportingUse: 'BLOCKED',
    mayIncreaseBuyingPower: false,
    mayAuthorizeFinancialUse: false,
  } as const);
}

function recoveryResult(
  status: StablecoinRecoveryStatus,
  asset: StablecoinValuationAssetReference | null,
  evaluatedAt: string | null,
  depegLatch: StablecoinDepegLatchReference | null,
  acceptedManualRiskClear: StablecoinManualRiskClearReference | null,
  evidenceCount: number,
  evidenceSpanMs: number | null,
  reasons: readonly StablecoinRecoveryReason[],
): StablecoinRecoveryResult {
  return deepFreeze({
    policyVersion: STABLECOIN_VALUATION_POLICY_VERSION,
    policyApprovalState: 'PENDING_EXTERNAL_APPROVAL',
    status,
    asset,
    evaluatedAt,
    depegLatch,
    acceptedManualRiskClear,
    evidenceCount,
    evidenceSpanMs,
    reasons: orderedRecoveryReasons(reasons),
    manualRiskClearAccepted: acceptedManualRiskClear !== null,
    mayIncreaseBuyingPower: false,
    mayAuthorizeFinancialUse: false,
  } as const);
}

function publicDepegLatchReference(
  reference: ParsedDepegLatchReference,
): StablecoinDepegLatchReference {
  return deepFreeze({
    asset: reference.asset,
    latchId: reference.latchId,
    latchedAt: reference.latchedAt,
  });
}

function publicManualRiskClearReference(
  reference: ParsedManualRiskClearReference,
): StablecoinManualRiskClearReference {
  return deepFreeze({
    asset: reference.asset,
    clearId: reference.clearId,
    latchId: reference.latchId,
    clearedAt: reference.clearedAt,
  });
}

function recoverySpan(samples: readonly ParsedRecoverySample[]): number | null {
  const first = samples[0];
  const last = samples.at(-1);
  return first && last ? last.evaluatedAtMs - first.evaluatedAtMs : null;
}

function recoveryEvidenceIsStrictlyMonotonic(samples: readonly ParsedRecoverySample[]): boolean {
  let previous: ParsedRecoverySample | null = null;
  const updateIdsBySource = new Map<StablecoinValuationSourceId, Set<string>>(
    STABLECOIN_VALUATION_SOURCES.map((sourceId) => [sourceId, new Set<string>()]),
  );
  for (const sample of samples) {
    for (const sourceId of STABLECOIN_VALUATION_SOURCES) {
      const observation = sample.observations.find((candidate) => candidate.sourceId === sourceId);
      const updateIds = updateIdsBySource.get(sourceId);
      if (!observation || !updateIds || updateIds.has(observation.sourceUpdateId)) return false;
      updateIds.add(observation.sourceUpdateId);
    }
    if (previous !== null) {
      if (sample.evaluatedAtMs <= previous.evaluatedAtMs) return false;
      for (const sourceId of STABLECOIN_VALUATION_SOURCES) {
        const before = previous.observations.find(
          (observation) => observation.sourceId === sourceId,
        );
        const after = sample.observations.find((observation) => observation.sourceId === sourceId);
        if (
          !before ||
          !after ||
          BigInt(after.sourceSequence) <= BigInt(before.sourceSequence) ||
          after.sourceUpdateId === before.sourceUpdateId ||
          after.pricedAtMs < before.pricedAtMs ||
          after.observedAtMs < before.observedAtMs
        ) {
          return false;
        }
      }
    }
    previous = sample;
  }
  return true;
}

function valuationWithinRecoveryBand(valuation: StablecoinValuationResult): boolean {
  if (
    valuation.availability !== 'AVAILABLE' ||
    valuation.usdRateMantissa === null ||
    valuation.usdRateScale === null
  ) {
    return false;
  }
  const rate: FixedDecimal = {
    mantissa: BigInt(valuation.usdRateMantissa),
    scale: valuation.usdRateScale,
  };
  const peg: FixedDecimal = { mantissa: 100_000_000n, scale: 8 };
  return (
    compareFixed(rate, peg) <= 0 &&
    !absoluteUsdAmountExceedsBps(
      subtractFixedFloorZero(peg, rate),
      STABLECOIN_VALUATION_POLICY.recovery.withinPegBps,
    )
  );
}

function assessSource(
  request: ParsedRequest,
  sourceId: StablecoinValuationSourceId,
  role: StablecoinSourceAssessment['role'],
): InternalAssessment {
  const observations = request.observations
    .filter((observation) => observation.sourceId === sourceId)
    .sort((left, right) =>
      compareBigInt(BigInt(left.sourceSequence), BigInt(right.sourceSequence)),
    );
  if (observations.length === 0) {
    return internalAssessment(sourceId, role, 'MISSING', null, null);
  }
  if (!hasMonotonicSequenceAndTime(observations)) {
    return internalAssessment(
      sourceId,
      role,
      'NON_MONOTONIC_SEQUENCE',
      observations.at(-1) ?? null,
      null,
    );
  }
  const observation = observations.at(-1);
  if (!observation) {
    return internalAssessment(sourceId, role, 'MISSING', null, null);
  }
  const watermark = request.sourceWatermarks.find((candidate) => candidate.sourceId === sourceId);
  if (
    !watermark ||
    (watermark.lastAcceptedSequence !== null &&
      (BigInt(observation.sourceSequence) <= BigInt(watermark.lastAcceptedSequence) ||
        watermark.lastAcceptedPricedAtMs === null ||
        watermark.lastAcceptedObservedAtMs === null ||
        observation.pricedAtMs < watermark.lastAcceptedPricedAtMs ||
        observation.observedAtMs < watermark.lastAcceptedObservedAtMs ||
        observation.sourceUpdateId === watermark.lastAcceptedUpdateId))
  ) {
    return internalAssessment(sourceId, role, 'REPLAYED_OR_REGRESSED', observation, null);
  }
  if (
    observation.pricedAtMs > request.evaluatedAtMs ||
    observation.observedAtMs > request.evaluatedAtMs ||
    observation.pricedAtMs > observation.observedAtMs
  ) {
    return internalAssessment(sourceId, role, 'FUTURE_TIMESTAMP', observation, null);
  }
  const ageMs = request.evaluatedAtMs - observation.pricedAtMs;
  if (ageMs > STABLECOIN_VALUATION_POLICY.freshness.unavailableAfterMs) {
    return internalAssessment(sourceId, role, 'EXPIRED', observation, null);
  }

  let conservativeRate = observation.rate;
  let confidenceLowerBoundApplied = false;
  if (sourceId === 'PYTH_CORE') {
    const confidence = observation.confidenceAmount;
    if (
      confidence === null ||
      absoluteUsdAmountExceedsBps(
        confidence,
        STABLECOIN_VALUATION_POLICY.confidence.publishedWidthEligibleAtOrBelowBps,
      )
    ) {
      return internalAssessment(sourceId, role, 'WIDE_CONFIDENCE', observation, null);
    }
    conservativeRate = subtractFixedFloorZero(observation.rate, confidence);
    confidenceLowerBoundApplied = confidence.mantissa > 0n;
  }
  if (conservativeRate.mantissa.toString().length > 78) {
    return internalAssessment(sourceId, role, 'WIDE_CONFIDENCE', observation, null);
  }
  if (ageMs > STABLECOIN_VALUATION_POLICY.freshness.currentWithinMs) {
    return internalAssessment(sourceId, role, 'STALE', observation, conservativeRate);
  }

  const freshness = 'CURRENT' as const;
  const eligibility: StablecoinSourceEligibility = 'ELIGIBLE_CURRENT';
  const assessment = publicAssessment(sourceId, role, eligibility, observation, conservativeRate);
  return {
    publicAssessment: assessment,
    candidate: {
      assessment,
      observation,
      conservativeRate,
      freshness,
      confidenceLowerBoundApplied,
    },
  };
}

function internalAssessment(
  sourceId: StablecoinValuationSourceId,
  role: StablecoinSourceAssessment['role'],
  eligibility: StablecoinSourceEligibility,
  observation: ParsedObservation | null,
  rate: FixedDecimal | null,
): InternalAssessment {
  return {
    publicAssessment: publicAssessment(sourceId, role, eligibility, observation, rate),
    candidate: null,
  };
}

function publicAssessment(
  sourceId: StablecoinValuationSourceId,
  role: StablecoinSourceAssessment['role'],
  eligibility: StablecoinSourceEligibility,
  observation: ParsedObservation | null,
  rate: FixedDecimal | null,
): StablecoinSourceAssessment {
  return deepFreeze({
    sourceId,
    role,
    eligibility,
    observation: observation === null ? null : publicObservation(observation),
    conservativeUsdRateMantissa: rate === null ? null : rate.mantissa.toString(),
    conservativeUsdRateScale: rate === null ? null : rate.scale,
  });
}

function publicObservation(observation: ParsedObservation): StablecoinPriceObservation {
  return deepFreeze({
    asset: observation.asset,
    sourceId: observation.sourceId,
    sourceReference: observation.sourceReference,
    sourceSequence: observation.sourceSequence,
    sourceUpdateId: observation.sourceUpdateId,
    pricedAt: observation.pricedAt,
    observedAt: observation.observedAt,
    usdRateMantissa: observation.usdRateMantissa,
    usdRateScale: observation.usdRateScale,
    confidence: observation.confidence,
  });
}

function hasMonotonicSequenceAndTime(observations: readonly ParsedObservation[]): boolean {
  let previous: ParsedObservation | null = null;
  const updateIds = new Set<string>();
  for (const observation of observations) {
    if (updateIds.has(observation.sourceUpdateId)) return false;
    updateIds.add(observation.sourceUpdateId);
    if (
      previous !== null &&
      (BigInt(observation.sourceSequence) <= BigInt(previous.sourceSequence) ||
        observation.pricedAtMs < previous.pricedAtMs ||
        observation.observedAtMs < previous.observedAtMs)
    ) {
      return false;
    }
    previous = observation;
  }
  return true;
}

function classifySourceAgreement(
  first: FixedDecimal,
  second: FixedDecimal,
): Extract<StablecoinSourceAgreement, 'CORROBORATED' | 'SOFT_DISAGREEMENT' | 'CONFLICT'> {
  const difference = absoluteDifference(first, second);
  if (
    !absoluteUsdAmountExceedsBps(
      difference,
      STABLECOIN_VALUATION_POLICY.sourceAgreement.corroboratedAtOrBelowBps,
    )
  ) {
    return 'CORROBORATED';
  }
  if (
    !absoluteUsdAmountExceedsBps(
      difference,
      STABLECOIN_VALUATION_POLICY.sourceAgreement.softDisagreementAtOrBelowBps,
    )
  ) {
    return 'SOFT_DISAGREEMENT';
  }
  return 'CONFLICT';
}

function pythConfidenceAllowsMedium(candidates: readonly SourceCandidate[]): boolean {
  const pyth = candidates.find(({ observation }) => observation.sourceId === 'PYTH_CORE');
  const confidence = pyth?.observation.confidenceAmount;
  return (
    confidence !== null &&
    confidence !== undefined &&
    !absoluteUsdAmountExceedsBps(
      confidence,
      STABLECOIN_VALUATION_POLICY.confidence.mediumPublishedWidthAtOrBelowBps,
    )
  );
}

function classifyDownside(rate: FixedDecimal): Exclude<StablecoinDownsideBand, 'NOT_ASSESSED'> {
  const peg = { mantissa: 1n, scale: 0 };
  if (compareFixed(rate, peg) >= 0) {
    return 'NORMAL';
  }
  const downside = subtractFixedFloorZero(peg, rate);
  if (
    !absoluteUsdAmountExceedsBps(downside, STABLECOIN_VALUATION_POLICY.downside.normalAtOrBelowBps)
  ) {
    return 'NORMAL';
  }
  if (
    absoluteUsdAmountAtOrAboveBps(
      downside,
      STABLECOIN_VALUATION_POLICY.downside.depeggedAtOrAboveBps,
    )
  ) {
    return 'DEPEGGED';
  }
  return 'WATCH';
}

function mostSevereDownsideBand(
  bands: readonly Exclude<StablecoinDownsideBand, 'NOT_ASSESSED'>[],
): Exclude<StablecoinDownsideBand, 'NOT_ASSESSED'> {
  if (bands.includes('DEPEGGED')) return 'DEPEGGED';
  if (bands.includes('WATCH')) return 'WATCH';
  return 'NORMAL';
}

function calculateUsdValue(
  amountAtomic: bigint,
  assetDecimals: number,
  rate: FixedDecimal,
): bigint | null {
  const product = amountAtomic * rate.mantissa;
  if (product.toString().length > STABLECOIN_VALUATION_POLICY.bounds.maxProductDigits) {
    return null;
  }
  const numerator = product * powerOfTen(STABLECOIN_VALUATION_POLICY.bounds.usdValueScale);
  const denominator = powerOfTen(assetDecimals + rate.scale);
  const value = divideRoundHalfEven(numerator, denominator);
  return value.toString().length <= STABLECOIN_VALUATION_POLICY.bounds.maxUsdValueDigits
    ? value
    : null;
}

function divideRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubledRemainder = remainder * 2n;
  if (doubledRemainder < denominator) return quotient;
  if (doubledRemainder > denominator) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

function absoluteUsdAmountExceedsBps(amount: FixedDecimal, thresholdBps: string): boolean {
  const canonical = canonicalFixed(amount);
  return canonical.mantissa * 10_000n > BigInt(thresholdBps) * powerOfTen(canonical.scale);
}

function absoluteUsdAmountAtOrAboveBps(amount: FixedDecimal, thresholdBps: string): boolean {
  const canonical = canonicalFixed(amount);
  return canonical.mantissa * 10_000n >= BigInt(thresholdBps) * powerOfTen(canonical.scale);
}

function absoluteDifference(first: FixedDecimal, second: FixedDecimal): FixedDecimal {
  const scale = first.scale >= second.scale ? first.scale : second.scale;
  const firstMantissa = first.mantissa * powerOfTen(scale - first.scale);
  const secondMantissa = second.mantissa * powerOfTen(scale - second.scale);
  return canonicalFixed({
    mantissa:
      firstMantissa >= secondMantissa
        ? firstMantissa - secondMantissa
        : secondMantissa - firstMantissa,
    scale,
  });
}

function subtractFixedFloorZero(minuend: FixedDecimal, subtrahend: FixedDecimal): FixedDecimal {
  const scale = minuend.scale >= subtrahend.scale ? minuend.scale : subtrahend.scale;
  const minuendMantissa = minuend.mantissa * powerOfTen(scale - minuend.scale);
  const subtrahendMantissa = subtrahend.mantissa * powerOfTen(scale - subtrahend.scale);
  return {
    mantissa: minuendMantissa > subtrahendMantissa ? minuendMantissa - subtrahendMantissa : 0n,
    scale,
  };
}

function minimumFixed(first: FixedDecimal, second: FixedDecimal): FixedDecimal {
  return compareFixed(first, second) <= 0 ? first : second;
}

function compareFixed(first: FixedDecimal, second: FixedDecimal): number {
  const left = first.mantissa * powerOfTen(second.scale);
  const right = second.mantissa * powerOfTen(first.scale);
  return compareBigInt(left, right);
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalFixed(value: FixedDecimal): FixedDecimal {
  let mantissa = value.mantissa;
  let scale = value.scale;
  while (scale > 0 && mantissa % 10n === 0n) {
    mantissa /= 10n;
    scale -= 1;
  }
  return { mantissa, scale };
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

const REASON_ORDER: readonly StablecoinValuationReason[] = Object.freeze([
  'INVALID_INPUT',
  'NO_ELIGIBLE_SOURCE',
  'SOURCE_CONFLICT',
  'NUMERIC_LIMIT_EXCEEDED',
  'SINGLE_SOURCE',
  'FALLBACK_SOURCE_SELECTED',
  'SOFT_SOURCE_DISAGREEMENT',
  'PUBLISHED_CONFIDENCE_LOWER_BOUND',
  'UPSIDE_CAPPED_AT_PEG',
  'WATCH_DOWNSIDE',
  'DEPEG_DETECTED',
] as const);

function orderedReasons(
  reasons: readonly StablecoinValuationReason[],
): readonly StablecoinValuationReason[] {
  const reasonSet = new Set(reasons);
  return Object.freeze(REASON_ORDER.filter((reason) => reasonSet.has(reason)));
}

const RECOVERY_REASON_ORDER: readonly StablecoinRecoveryReason[] = Object.freeze([
  'INVALID_INPUT',
  'NO_PRIOR_DEPEG_LATCH',
  'INSUFFICIENT_DISTINCT_OBSERVATIONS',
  'NON_MONOTONIC_EVIDENCE',
  'INSUFFICIENT_OBSERVATION_SPAN',
  'DEPEG_LATCH_AFTER_RECOVERY_EVALUATION',
  'EVIDENCE_PRECEDES_DEPEG_LATCH',
  'EVIDENCE_AFTER_RECOVERY_EVALUATION',
  'OBSERVATION_NOT_CURRENT',
  'OBSERVATION_NOT_CORROBORATED',
  'OBSERVATION_OUTSIDE_REPEG_BAND',
  'MANUAL_RISK_CLEAR_REQUIRED',
  'MANUAL_RISK_CLEAR_LATCH_MISMATCH',
  'MANUAL_RISK_CLEAR_PRECEDES_FINAL_SAMPLE',
  'MANUAL_RISK_CLEAR_AFTER_RECOVERY_EVALUATION',
  'LOCAL_CANDIDATE_CLEAR_ONLY',
] as const);

function orderedRecoveryReasons(
  reasons: readonly StablecoinRecoveryReason[],
): readonly StablecoinRecoveryReason[] {
  const reasonSet = new Set(reasons);
  return Object.freeze(RECOVERY_REASON_ORDER.filter((reason) => reasonSet.has(reason)));
}

function parseRequest(input: unknown): ParsedRequest {
  const record = dataRecord(input, [
    'asset',
    'amountAtomic',
    'evaluatedAt',
    'sourceWatermarks',
    'observations',
  ]);
  const asset = parseAsset(record.asset);
  const amountAtomic = parseAmount(record.amountAtomic);
  const evaluatedAt = parseTimestamp(record.evaluatedAt);
  const sourceWatermarks = parseSourceWatermarks(record.sourceWatermarks);
  const observations = dataArray(
    record.observations,
    0,
    STABLECOIN_VALUATION_POLICY.bounds.maxObservations,
  ).map((observation) => parseObservation(observation, asset));
  return Object.freeze({
    asset,
    amountAtomic,
    amount: BigInt(amountAtomic),
    evaluatedAt: evaluatedAt.canonical,
    evaluatedAtMs: evaluatedAt.milliseconds,
    sourceWatermarks,
    observations: Object.freeze(observations),
  });
}

function parseSourceWatermarks(input: unknown): readonly ParsedSourceWatermark[] {
  const values = dataArray(
    input,
    STABLECOIN_VALUATION_SOURCES.length,
    STABLECOIN_VALUATION_SOURCES.length,
  ).map((value) => parseSourceWatermark(value));
  if (
    STABLECOIN_VALUATION_SOURCES.some(
      (sourceId) => values.filter((watermark) => watermark.sourceId === sourceId).length !== 1,
    )
  ) {
    return invalidInput();
  }
  return Object.freeze(values);
}

function parseSourceWatermark(input: unknown): ParsedSourceWatermark {
  const record = dataRecord(input, [
    'sourceId',
    'lastAcceptedSequence',
    'lastAcceptedPricedAt',
    'lastAcceptedObservedAt',
    'lastAcceptedUpdateId',
  ]);
  const sourceId = parseSourceId(record.sourceId);
  const sequence = record.lastAcceptedSequence;
  const pricedAt = record.lastAcceptedPricedAt;
  const observedAt = record.lastAcceptedObservedAt;
  const updateId = record.lastAcceptedUpdateId;
  if (sequence === null && pricedAt === null && observedAt === null && updateId === null) {
    return Object.freeze({
      sourceId,
      lastAcceptedSequence: null,
      lastAcceptedPricedAt: null,
      lastAcceptedObservedAt: null,
      lastAcceptedUpdateId: null,
      lastAcceptedPricedAtMs: null,
      lastAcceptedObservedAtMs: null,
    });
  }
  if (
    typeof sequence !== 'string' ||
    !POSITIVE_INTEGER_PATTERN.test(sequence) ||
    sequence.length > STABLECOIN_VALUATION_POLICY.bounds.maxAmountDigits ||
    typeof updateId !== 'string' ||
    !validSourceUpdateId(sourceId, updateId, sequence)
  ) {
    return invalidInput();
  }
  const parsedPricedAt = parseTimestamp(pricedAt);
  const parsedObservedAt = parseTimestamp(observedAt);
  if (parsedPricedAt.milliseconds > parsedObservedAt.milliseconds) return invalidInput();
  return Object.freeze({
    sourceId,
    lastAcceptedSequence: sequence,
    lastAcceptedPricedAt: parsedPricedAt.canonical,
    lastAcceptedObservedAt: parsedObservedAt.canonical,
    lastAcceptedUpdateId: updateId,
    lastAcceptedPricedAtMs: parsedPricedAt.milliseconds,
    lastAcceptedObservedAtMs: parsedObservedAt.milliseconds,
  });
}

function parseRecoveryRequest(input: unknown): ParsedRecoveryRequest {
  const record = dataRecord(input, [
    'asset',
    'evaluatedAt',
    'depegLatch',
    'manualRiskClear',
    'samples',
  ]);
  const asset = parseAsset(record.asset);
  const evaluatedAt = parseTimestamp(record.evaluatedAt);
  const depegLatch =
    record.depegLatch === null ? null : parseDepegLatchReference(record.depegLatch, asset);
  const manualRiskClear =
    record.manualRiskClear === null
      ? null
      : parseManualRiskClearReference(record.manualRiskClear, asset);
  if (depegLatch === null && manualRiskClear !== null) return invalidInput();
  if (depegLatch !== null && manualRiskClear?.clearId === depegLatch.latchId) {
    return invalidInput();
  }
  const samples = dataArray(
    record.samples,
    0,
    STABLECOIN_VALUATION_POLICY.bounds.maxObservations,
  ).map((sample) => parseRecoverySample(sample, asset));
  return Object.freeze({
    asset,
    evaluatedAt: evaluatedAt.canonical,
    evaluatedAtMs: evaluatedAt.milliseconds,
    depegLatch,
    manualRiskClear,
    samples: Object.freeze(samples),
  });
}

function parseDepegLatchReference(
  input: unknown,
  requestedAsset: StablecoinValuationAssetReference,
): ParsedDepegLatchReference {
  const record = dataRecord(input, ['asset', 'latchId', 'latchedAt']);
  const asset = parseAsset(record.asset);
  if (!sameAsset(asset, requestedAsset)) return invalidInput();
  const latchId = parseRecoveryEventId(record.latchId);
  const latchedAt = parseTimestamp(record.latchedAt);
  return Object.freeze({
    asset,
    latchId,
    latchedAt: latchedAt.canonical,
    latchedAtMs: latchedAt.milliseconds,
  });
}

function parseManualRiskClearReference(
  input: unknown,
  requestedAsset: StablecoinValuationAssetReference,
): ParsedManualRiskClearReference {
  const record = dataRecord(input, ['asset', 'clearId', 'latchId', 'clearedAt']);
  const asset = parseAsset(record.asset);
  if (!sameAsset(asset, requestedAsset)) return invalidInput();
  const clearId = parseRecoveryEventId(record.clearId);
  const latchId = parseRecoveryEventId(record.latchId);
  const clearedAt = parseTimestamp(record.clearedAt);
  return Object.freeze({
    asset,
    clearId,
    latchId,
    clearedAt: clearedAt.canonical,
    clearedAtMs: clearedAt.milliseconds,
  });
}

function parseRecoveryEventId(input: unknown): string {
  if (typeof input !== 'string' || !RECOVERY_EVENT_ID_PATTERN.test(input)) {
    return invalidInput();
  }
  return input;
}

function parseRecoverySample(
  input: unknown,
  asset: StablecoinValuationAssetReference,
): ParsedRecoverySample {
  const record = dataRecord(input, ['evaluatedAt', 'observations']);
  const evaluatedAt = parseTimestamp(record.evaluatedAt);
  const observations = dataArray(record.observations, 2, 2).map((observation) =>
    parseObservation(observation, asset),
  );
  if (
    STABLECOIN_VALUATION_SOURCES.some(
      (sourceId) =>
        observations.filter((observation) => observation.sourceId === sourceId).length !== 1,
    )
  ) {
    return invalidInput();
  }
  const publicObservations = observations.map(publicObservation);
  const valuation = evaluateStablecoinValuation({
    asset,
    amountAtomic: '1',
    evaluatedAt: evaluatedAt.canonical,
    sourceWatermarks: STABLECOIN_VALUATION_FIRST_USE_WATERMARKS,
    observations: publicObservations,
  });
  return Object.freeze({
    evaluatedAt: evaluatedAt.canonical,
    evaluatedAtMs: evaluatedAt.milliseconds,
    observations: Object.freeze(observations),
    valuation,
  });
}

function parseAsset(input: unknown): StablecoinValuationAssetReference {
  const record = dataRecord(input, [
    'registryEnvironment',
    'registryVersion',
    'registryFingerprintSha256',
    'stablecoin',
    'networkId',
    'identity',
    'decimals',
  ]);
  const registryEnvironment = record.registryEnvironment;
  const registryVersion = record.registryVersion;
  const registryFingerprintSha256 = record.registryFingerprintSha256;
  const stablecoin = record.stablecoin;
  const networkId = record.networkId;
  const identity = record.identity;
  const decimals = record.decimals;
  if (
    registryEnvironment !== 'MAINNET' ||
    typeof registryVersion !== 'number' ||
    registryVersion !== 1 ||
    typeof registryFingerprintSha256 !== 'string' ||
    !FINGERPRINT_PATTERN.test(registryFingerprintSha256) ||
    typeof stablecoin !== 'string' ||
    !SUPPORTED_STABLECOINS.includes(stablecoin as SupportedStablecoin) ||
    typeof networkId !== 'string' ||
    typeof identity !== 'string' ||
    typeof decimals !== 'number' ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > STABLECOIN_VALUATION_POLICY.bounds.maxAssetDecimals
  ) {
    return invalidInput();
  }
  const snapshot = MAINNET_SUPPORTED_ASSET_REGISTRY.atVersion(registryVersion);
  const asset = snapshot?.identifyAsset(networkId, identity);
  const network = snapshot?.networks.find((candidate) => candidate.networkId === networkId);
  if (
    !snapshot ||
    snapshot.fingerprintSha256 !== registryFingerprintSha256 ||
    !asset ||
    asset.stablecoin !== stablecoin ||
    asset.identity !== identity ||
    asset.decimals !== decimals ||
    asset.activationState !== 'ACTIVE' ||
    network?.activationState !== 'ACTIVE'
  ) {
    return invalidInput();
  }
  return Object.freeze({
    registryEnvironment,
    registryVersion,
    registryFingerprintSha256,
    stablecoin: stablecoin as SupportedStablecoin,
    networkId,
    identity,
    decimals,
  });
}

function parseObservation(
  input: unknown,
  requestedAsset: StablecoinValuationAssetReference,
): ParsedObservation {
  const record = dataRecord(input, [
    'asset',
    'sourceId',
    'sourceReference',
    'sourceSequence',
    'sourceUpdateId',
    'pricedAt',
    'observedAt',
    'usdRateMantissa',
    'usdRateScale',
    'confidence',
  ]);
  const asset = parseAsset(record.asset);
  if (!sameAsset(asset, requestedAsset)) return invalidInput();
  const sourceId = parseSourceId(record.sourceId);
  const sourceReference = record.sourceReference;
  const sourceSequence = record.sourceSequence;
  const sourceUpdateId = record.sourceUpdateId;
  const usdRateMantissa = record.usdRateMantissa;
  const usdRateScale = parseScale(record.usdRateScale);
  const expectedSourceReference = STABLECOIN_VALUATION_FEED_REFERENCES[asset.stablecoin][sourceId];
  if (
    typeof sourceReference !== 'string' ||
    !SOURCE_REFERENCE_PATTERN.test(sourceReference) ||
    sourceReference !== expectedSourceReference ||
    typeof sourceSequence !== 'string' ||
    !POSITIVE_INTEGER_PATTERN.test(sourceSequence) ||
    sourceSequence.length > STABLECOIN_VALUATION_POLICY.bounds.maxAmountDigits ||
    typeof sourceUpdateId !== 'string' ||
    !validSourceUpdateId(sourceId, sourceUpdateId, sourceSequence) ||
    typeof usdRateMantissa !== 'string' ||
    !CANONICAL_INTEGER_PATTERN.test(usdRateMantissa) ||
    usdRateMantissa.length > STABLECOIN_VALUATION_POLICY.bounds.maxRateDigits ||
    usdRateScale !== STABLECOIN_VALUATION_POLICY.bounds.normalizedUsdRateScale
  ) {
    return invalidInput();
  }
  const pricedAt = parseTimestamp(record.pricedAt);
  const observedAt = parseTimestamp(record.observedAt);
  const confidence = parseConfidence(record.confidence, sourceId);
  return Object.freeze({
    asset,
    sourceId,
    sourceReference,
    sourceSequence,
    sourceUpdateId,
    pricedAt: pricedAt.canonical,
    observedAt: observedAt.canonical,
    usdRateMantissa,
    usdRateScale,
    confidence,
    pricedAtMs: pricedAt.milliseconds,
    observedAtMs: observedAt.milliseconds,
    rate: Object.freeze({ mantissa: BigInt(usdRateMantissa), scale: usdRateScale }),
    confidenceAmount:
      confidence.kind === 'PUBLISHED_ABSOLUTE_USD'
        ? Object.freeze({ mantissa: BigInt(confidence.mantissa), scale: confidence.scale })
        : null,
  });
}

function parseConfidence(
  input: unknown,
  sourceId: StablecoinValuationSourceId,
): StablecoinPriceConfidence {
  if (sourceId === 'PYTH_CORE') {
    const record = dataRecord(input, ['kind', 'mantissa', 'scale']);
    const scale = parseScale(record.scale);
    if (
      record.kind !== 'PUBLISHED_ABSOLUTE_USD' ||
      typeof record.mantissa !== 'string' ||
      !CANONICAL_INTEGER_PATTERN.test(record.mantissa) ||
      record.mantissa.length > STABLECOIN_VALUATION_POLICY.bounds.maxRateDigits ||
      scale !== STABLECOIN_VALUATION_POLICY.bounds.normalizedUsdRateScale
    ) {
      return invalidInput();
    }
    return Object.freeze({
      kind: 'PUBLISHED_ABSOLUTE_USD',
      mantissa: record.mantissa,
      scale,
    });
  }
  const record = dataRecord(input, ['kind']);
  if (record.kind !== 'NOT_PUBLISHED') return invalidInput();
  return Object.freeze({ kind: 'NOT_PUBLISHED' });
}

function parseSourceId(input: unknown): StablecoinValuationSourceId {
  if (
    typeof input !== 'string' ||
    !STABLECOIN_VALUATION_SOURCES.includes(input as StablecoinValuationSourceId)
  ) {
    return invalidInput();
  }
  return input as StablecoinValuationSourceId;
}

function validSourceUpdateId(
  sourceId: StablecoinValuationSourceId,
  updateId: string,
  sequence: string,
): boolean {
  return sourceId === 'PYTH_CORE' ? PYTH_UPDATE_ID_PATTERN.test(updateId) : updateId === sequence;
}

function parseAmount(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !POSITIVE_INTEGER_PATTERN.test(input) ||
    input.length > STABLECOIN_VALUATION_POLICY.bounds.maxAmountDigits ||
    input.length > MAX_ATOMIC_AMOUNT.length ||
    (input.length === MAX_ATOMIC_AMOUNT.length && input > MAX_ATOMIC_AMOUNT)
  ) {
    return invalidInput();
  }
  return input;
}

function parseScale(input: unknown): number {
  if (
    typeof input !== 'number' ||
    !Number.isSafeInteger(input) ||
    input < 0 ||
    input > STABLECOIN_VALUATION_POLICY.bounds.maxRateScale
  ) {
    return invalidInput();
  }
  return input;
}

function parseTimestamp(input: unknown): Readonly<{ canonical: string; milliseconds: number }> {
  if (typeof input !== 'string' || !CANONICAL_TIMESTAMP_PATTERN.test(input)) {
    return invalidInput();
  }
  const milliseconds = Date.parse(input);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    new Date(milliseconds).toISOString() !== input
  ) {
    return invalidInput();
  }
  return { canonical: input, milliseconds };
}

function sameAsset(
  first: StablecoinValuationAssetReference,
  second: StablecoinValuationAssetReference,
): boolean {
  return (
    first.registryEnvironment === second.registryEnvironment &&
    first.registryVersion === second.registryVersion &&
    first.registryFingerprintSha256 === second.registryFingerprintSha256 &&
    first.stablecoin === second.stablecoin &&
    first.networkId === second.networkId &&
    first.identity === second.identity &&
    first.decimals === second.decimals
  );
}

function dataRecord(
  input: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return invalidInput();
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return invalidInput();
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return invalidInput();
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return invalidInput();
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return invalidInput();
  }
}

function dataArray(input: unknown, minimum: number, maximum: number): readonly unknown[] {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
      return invalidInput();
    }
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return invalidInput();
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < minimum ||
      length > maximum
    ) {
      return invalidInput();
    }
    const expectedKeys = new Set([
      'length',
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    if (
      Reflect.ownKeys(descriptors).length !== expectedKeys.size ||
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
      return invalidInput();
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return invalidInput();
      }
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return invalidInput();
  }
}

function invalidInput(): never {
  throw new InvalidValuationInput();
}

function deepFreeze<const Value extends object>(value: Value): Readonly<Value> {
  for (const key of Reflect.ownKeys(value)) {
    const child: unknown = Reflect.get(value, key);
    if ((typeof child === 'object' && child !== null) || typeof child === 'function') {
      deepFreeze(child as object);
    }
  }
  return Object.freeze(value);
}
