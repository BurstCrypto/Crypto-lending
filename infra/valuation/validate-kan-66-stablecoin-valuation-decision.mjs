import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DECISION_PATH = 'docs/valuation/kan-66-stablecoin-valuation-decision.json';
export const SIDECAR_PATH = 'docs/valuation/kan-66-stablecoin-valuation-decision.sha256';

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const LOWER_RECOVERY_EVENT_ID = /^[0-9a-f]{64}$/u;
const LOWER_SHA256 = /^[0-9a-f]{64}\n$/u;
const PACKET_RECOVERY_FIRST_SAMPLE_MS = Date.parse('2026-08-22T10:00:00.000Z');
const TOP_KEYS = [
  'schemaVersion',
  'ticket',
  'specification',
  'decisionReference',
  'asOfDate',
  'localStatus',
  'externalStatus',
  'selection',
  'approvalBoundary',
  'gates',
  'sourcePolicy',
  'thresholds',
  'assetMatrix',
  'deterministicExamples',
  'sourceResearch',
  'commercialResearch',
  'sourceEvidence',
  'undocumentedOrUnverified',
  'zeroCostEvidence',
];
const SELECTION_KEYS = [
  'architecture',
  'primaryProvider',
  'primaryRole',
  'primaryStatus',
  'fallbackProvider',
  'fallbackRole',
  'fallbackStatus',
  'independenceStatus',
  'runtimeStatus',
  'financialUseStatus',
  'onchainWriteStatus',
  'nominalPegStatus',
];
const APPROVAL_KEYS = [
  'approved',
  'riskPolicyApproval',
  'legalTermsApproval',
  'financePlanApproval',
  'approvedGitCommit',
  'approvedGitTree',
  'approvedDecisionPacketSha256',
  'approvedRegistryFingerprintSha256',
  'providerAccount',
  'plan',
  'apiEndpointHostnames',
  'rpcEndpointHostnames',
  'chainlinkContractAddresses',
  'credentialReferences',
  'regions',
  'sla',
  'monthlyCostUsd',
  'egressDestinations',
  'runtimeActivation',
  'manualRiskClear',
  'prohibitedUntilGatesPass',
];
const GATE_KEYS = ['ticket', 'kind', 'status', 'blocks', 'requiredEvidence', 'scopeBoundary'];
const SOURCE_POLICY_KEYS = [
  'quoteCurrency',
  'registryBinding',
  'providerOrder',
  'providers',
  'valuation',
  'freshness',
  'confidence',
  'agreement',
  'depeg',
  'recovery',
  'unavailableBehavior',
  'financialAuthorization',
];
const REGISTRY_KEYS = ['version', 'environment', 'fingerprintSha256', 'status', 'testnetStatus'];
const PROVIDER_KEYS = [
  'provider',
  'role',
  'product',
  'transport',
  'network',
  'priceField',
  'timestampField',
  'sequenceRule',
  'sequenceRuleStatus',
  'durableCheckpointRequired',
  'confidence',
  'eligibility',
  'endpointStatus',
  'credentialStatus',
  'liveValidationStatus',
];
const PROVIDER_CONFIDENCE_KEYS = ['kind', 'field', 'lowerBoundRule'];
const VALUATION_KEYS = [
  'availableRateRule',
  'pythLowerBoundRule',
  'chainlinkLowerBoundRule',
  'upsideCapUsdMantissa',
  'upsideCapUsdScale',
  'downsideFloorUsd',
  'nominalOneDollarAssumption',
  'arithmetic',
  'valueScale',
];
const FRESHNESS_KEYS = [
  'ageRule',
  'providerHeartbeatCanExtendRiskFreshness',
  'futureTimestamp',
  'nonMonotonicTimestamp',
  'missingTimestamp',
  'trustedLastAcceptedCheckpointRequired',
  'inRequestOrderingAloneSufficient',
  'checkpointScope',
  'checkpointFields',
  'checkpointDurability',
  'historicalUpdateIdUniqueness',
  'staleObservationEligibleForValuation',
  'unavailableObservationEligibleForValuation',
];
const CONFIDENCE_KEYS = ['highClassPermitted', 'mediumRule', 'lowRule', 'unusableRule'];
const AGREEMENT_KEYS = [
  'comparisonRule',
  'corroboratedRule',
  'softDisagreementRule',
  'sourceConflictRule',
  'sourceConflictValuation',
  'sourceConflictEvidence',
  'sourceConflictDownsideAlarm',
];
const DEPEG_KEYS = [
  'classificationInput',
  'normalRule',
  'watchRule',
  'depeggedRule',
  'sourceConflictRule',
  'newFinancialIncreaseDuringWatch',
  'newFinancialIncreaseDuringDepeg',
  'settledExactAssetJournalDuringUnavailable',
];
const RECOVERY_KEYS = [
  'automaticRepeg',
  'requiredDistinctObservations',
  'requiredMinimumSpanSeconds',
  'requiredSourceAgreement',
  'requiredFreshness',
  'requiredMaximumDownsideBps',
  'requiredMaximumPythConfidenceBps',
  'sampleEvaluatedAtMustBeStrictlyMonotonic',
  'sourceSequenceMustStrictlyIncrease',
  'sourceUpdateIdMustBeUniqueAcrossWindow',
  'sourceTimestampsMustBeNonRegressing',
  'depegLatchReferenceShape',
  'trustedRecoveryEvaluatedAtRequired',
  'allEvidenceAtOrAfterLatch',
  'allLatchEvidenceAndClearTimesAtOrBeforeEvaluation',
  'manualRiskClearRequired',
  'manualRiskClearReferenceShape',
  'manualRiskClearMustFollowFinalSample',
  'durableLatchClearPersistenceAuthentication',
  'statusWhenAutomatedPredicatesFail',
  'statusWhenPredicatesPassWithoutManualClear',
  'statusAfterManualClear',
  'candidateClearAuthorizesFinancialUse',
];
const UNAVAILABLE_KEYS = [
  'newQuote',
  'newRiskIncrease',
  'buyingPowerIncrease',
  'existingDisplay',
  'settledMovement',
  'backfill',
];
const FINANCIAL_KEYS = [
  'localStatus',
  'singleSourceFutureUse',
  'softDisagreementFutureUse',
  'sourceConflictFutureUse',
  'futureIncreaseRequires',
];
const THRESHOLD_KEYS = [
  'rateScale',
  'valueScale',
  'currentMaxAgeSeconds',
  'staleMaxAgeSeconds',
  'pythMaximumConfidenceBps',
  'dualSourceMediumMaximumDivergenceBps',
  'dualSourceMaximumUsableDivergenceBps',
  'normalMaximumDownsideBps',
  'depeggedMinimumDownsideBps',
  'repegMaximumDownsideBps',
  'repegMaximumPythConfidenceBps',
  'repegRequiredDistinctObservations',
  'repegMinimumSpanSeconds',
];
const ASSET_KEYS = [
  'asset',
  'quote',
  'registryVersion',
  'pythFeedSymbol',
  'pythStableFeedId',
  'chainlinkNetwork',
  'chainlinkEnsSelector',
  'chainlinkContractAddress',
  'chainlinkDocumentedDeviationBps',
  'chainlinkHeartbeatSeconds',
  'chainlinkHeartbeatStatus',
  'coverageStatus',
];
const EXAMPLE_KEYS = ['id', 'asset', 'amountAtomic', 'assetDecimals', 'input', 'result'];
const EXAMPLE_INPUT_KEYS = [
  'recoveryEvaluatedAt',
  'depegLatch',
  'manualRiskClear',
  'observations',
  'recoveryObservations',
];
const DEPEG_LATCH_KEYS = ['latchId', 'latchedAt'];
const MANUAL_RISK_CLEAR_KEYS = ['clearId', 'latchId', 'clearedAt'];
const OBSERVATION_KEYS = [
  'provider',
  'freshness',
  'ageSeconds',
  'monotonic',
  'priceMantissa',
  'priceScale',
  'confidence',
];
const OBSERVATION_CONFIDENCE_KEYS = ['kind', 'mantissa', 'scale'];
const RECOVERY_OBSERVATION_KEYS = [
  'id',
  'elapsedFromFirstSeconds',
  'dualSource',
  'sourceAgreement',
  'maximumDownsideBps',
  'pythConfidenceBps',
  'wasCurrent',
  'monotonic',
];
const EXAMPLE_RESULT_KEYS = [
  'availability',
  'selection',
  'selectedSourceId',
  'sourceAgreement',
  'confidenceClass',
  'freshnessClass',
  'usdRateMantissa',
  'usdRateScale',
  'usdValueMantissa',
  'usdValueScale',
  'depegClass',
  'downsideBand',
  'recoveryStatus',
  'reportingUse',
  'mayIncreaseBuyingPower',
  'mayAuthorizeFinancialUse',
];
const SOURCE_RESEARCH_KEYS = [
  'provider',
  'role',
  'coverage',
  'timestampSemantics',
  'confidenceSemantics',
  'delivery',
  'documentedRateLimit',
  'documentedSla',
  'costStatus',
  'termsStatus',
  'liveStatus',
];
const COMMERCIAL_KEYS = [
  'provider',
  'documentedStartingMonthlyUsd',
  'documentedStartingPriceSourceDate',
  'selectedPlan',
  'approvedMonthlyUsd',
  'accountCreated',
  'trialStarted',
  'paymentMethodAdded',
  'note',
];
const SOURCE_EVIDENCE_KEYS = ['id', 'provider', 'topic', 'url', 'observedFact', 'reviewedOn'];
const ZERO_COST_KEYS = [
  'providerAccountsCreated',
  'providerTrialsStarted',
  'paymentMethodsAdded',
  'apiCredentialsIssued',
  'rpcCredentialsIssued',
  'providerConnectionsOpened',
  'marketDataRequestsSent',
  'rpcRequestsSent',
  'onchainTransactionsSent',
  'externalEgressRulesOpened',
  'cloudResourcesCreated',
  'costIncurredUsd',
  'liveValidation',
];

const EXPECTED_SECTION_HASHES = Object.freeze({
  selection: '161232de431cff61e09d068f23da316fb52016a2feb4991abe19d1a6d796550b',
  approvalBoundary: '38054ed0ddbc8ba6d8ecff5c111e2d3fee96a5883163067e70c5a239f8b0edfe',
  gates: '5ec3edf99f4bacf1fe2e3994b461090642304d9a343a60f463ab05cc2e583b94',
  sourcePolicy: '18d8b992d7b29e471cd92fb51394d829eff8cf0e093a6f0ac6503e76df7ca432',
  thresholds: '32688307441fd41d623110df47afa1819a1b1e7e456ed5def551c57764cf2d8e',
  assetMatrix: 'b9b1f10b8e9ba691727247db0eefca7916d43113a5e380fe7485225cefa71793',
  deterministicExamples: 'e3ebf8528f6eaa7c0ee99ed519569bc8d679275e50a58f0986dff7da1353d097',
  sourceResearch: '0fd0d4652e3d287a3dbfcb39fb9c7897afa5355b71b0cfb4344999e56e92e807',
  commercialResearch: 'd68dac49396d86408968b044b43349345b97c750086b1fea489b15e5f2289dad',
  sourceEvidence: '54ae5a4c4dfecc1f5321f61ba9882bafb13e73520865210f1674a480a7b34aaa',
  undocumentedOrUnverified: 'b920f3c902d7c4aa5cdccd139901a95cf8a60e06b164d1cda2756e6b5379ddac',
  zeroCostEvidence: '6d07aacf555037d64fcb1eb54bb5f01031ef29379c83b8ccaf91562b1075db2b',
});
const EXPECTED_CANONICAL_RECORD_SHA256 =
  '3b50fd1ceb2f94924426d1015ffb7a0941579a115ef2f104915b0928e06ad370';
const EXPECTED_DECISION_SHA256 = '6c36c7bc78d70102c74255b9630f7a7e18e842e6daff52c9a73eed182121b7f3';
const EXPECTED_SELECTION = Object.freeze({
  architecture: 'DUAL_ORACLE_CANDIDATE_CONSERVATIVE_USD_VALUATION',
  primaryProvider: 'PYTH_CORE',
  primaryRole: 'PRIMARY',
  primaryStatus: 'PROPOSED',
  fallbackProvider: 'CHAINLINK_DATA_FEEDS',
  fallbackRole: 'FALLBACK_AND_CROSS_CHECK',
  fallbackStatus: 'PROPOSED',
  independenceStatus: 'INDEPENDENT_ORACLE_NETWORKS_UNDERLYING_VENUE_OVERLAP_UNVERIFIED',
  runtimeStatus: 'NOT_APPROVED',
  financialUseStatus: 'NOT_APPROVED',
  onchainWriteStatus: 'OUT_OF_SCOPE_PROHIBITED',
  nominalPegStatus: 'NEVER_ASSUMED',
});
const EXPECTED_THRESHOLDS = Object.freeze({
  rateScale: 8,
  valueScale: 18,
  currentMaxAgeSeconds: 60,
  staleMaxAgeSeconds: 300,
  pythMaximumConfidenceBps: 50,
  dualSourceMediumMaximumDivergenceBps: 25,
  dualSourceMaximumUsableDivergenceBps: 50,
  normalMaximumDownsideBps: 50,
  depeggedMinimumDownsideBps: 200,
  repegMaximumDownsideBps: 25,
  repegMaximumPythConfidenceBps: 25,
  repegRequiredDistinctObservations: 4,
  repegMinimumSpanSeconds: 1800,
});
const EXPECTED_ASSETS = Object.freeze([
  Object.freeze({
    asset: 'USDC',
    symbol: 'Crypto.USDC/USD',
    pythId: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    ens: 'usdc-usd.data.eth',
    deviationBps: 25,
  }),
  Object.freeze({
    asset: 'USDT',
    symbol: 'Crypto.USDT/USD',
    pythId: '2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
    ens: 'usdt-usd.data.eth',
    deviationBps: 25,
  }),
  Object.freeze({
    asset: 'PYUSD',
    symbol: 'Crypto.PYUSD/USD',
    pythId: 'c1da1b73d7f01e7ddd54b3766cf7fcd644395ad14f70aa706ec5384c59e76692',
    ens: 'pyusd-usd.data.eth',
    deviationBps: 30,
  }),
]);
const EXPECTED_EXAMPLE_IDS = Object.freeze([
  'NORMAL_DUAL_SOURCE',
  'UPSIDE_CAP_DUAL_SOURCE',
  'SOFT_DISAGREEMENT_WATCH',
  'CORROBORATED_DEPEG',
  'PYTH_PRIMARY_ONLY',
  'CHAINLINK_FALLBACK_ONLY',
  'SOURCE_CONFLICT_DOWNSIDE_ALARM',
  'NO_CURRENT_SOURCE',
  'REPEG_OBSERVATIONS_MANUAL_CLEAR_MISSING',
  'BOUNDARY_25_BPS_EXACT',
  'BOUNDARY_25_BPS_ONE_RATE_UNIT_OVER',
  'BOUNDARY_50_BPS_EXACT',
  'DIVERGENCE_50_BPS_ONE_RATE_UNIT_OVER',
  'CONFIDENCE_50_BPS_ONE_RATE_UNIT_OVER',
  'DOWNSIDE_200_BPS_ONE_RATE_UNIT_BELOW',
  'DOWNSIDE_200_BPS_EXACT',
  'DOWNSIDE_200_BPS_ONE_RATE_UNIT_OVER',
]);
const OFFICIAL_SOURCE_HOSTS = new Set([
  'docs.pyth.network',
  'www.pyth.network',
  'docs.chain.link',
  'data.chain.link',
  'chain.link',
]);
const CANONICAL_INTEGER = /^(0|[1-9][0-9]*)$/u;
const SENSITIVE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/u,
  /\b(?:api[_-]?key|authorization|password|secret|token)\s*[:=]\s*(?:bearer\s+)?[A-Za-z0-9._~+/=-]{8,}/iu,
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateJsonDataShape(value, path, errors, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') {
    if (Number.isFinite(value) && !Object.is(value, -0)) return true;
    errors.push(`${path} must contain only finite canonical JSON numbers.`);
    return false;
  }
  if (typeof value !== 'object') {
    errors.push(`${path} must contain only JSON data values.`);
    return false;
  }
  if (ancestors.has(value)) {
    errors.push(`${path} must not contain a cyclic reference.`);
    return false;
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    errors.push(`${path} must use a plain JSON object or array prototype.`);
    return false;
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) {
    errors.push(`${path} must not contain symbol properties.`);
    return false;
  }
  if (isArray) {
    const dataKeys = ownKeys.filter((key) => key !== 'length');
    const canonicalIndices = dataKeys.every((key) => {
      const index = Number(key);
      return (
        Number.isSafeInteger(index) && index >= 0 && index < value.length && String(index) === key
      );
    });
    if (
      ownKeys.length !== value.length + 1 ||
      !ownKeys.includes('length') ||
      dataKeys.length !== value.length ||
      !canonicalIndices
    ) {
      errors.push(`${path} must be a dense JSON array without aliases or extra properties.`);
      return false;
    }
  }

  ancestors.add(value);
  let valid = true;
  for (const key of ownKeys) {
    if (isArray && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) {
      errors.push(`${path}.${key} must be an enumerable JSON data property without accessors.`);
      valid = false;
      continue;
    }
    if (!validateJsonDataShape(descriptor.value, `${path}.${key}`, errors, ancestors))
      valid = false;
  }
  ancestors.delete(value);
  return valid;
}

function exactKeys(value, expectedKeys, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(`${path} must contain exactly: ${expected.join(', ')}.`);
    return false;
  }
  return true;
}

function expectExact(actual, expected, path, errors) {
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(`${path} must equal the closed KAN-66 value.`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateDateOnlyFreshness(value, now, maxAgeDays, path, errors) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    errors.push('validation time must be a valid Date.');
    return;
  }
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    errors.push(`${path} must be a canonical YYYY-MM-DD date.`);
    return;
  }
  const observedMs = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(observedMs) || new Date(observedMs).toISOString().slice(0, 10) !== value) {
    errors.push(`${path} must be a real calendar date.`);
    return;
  }
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = (todayUtc - observedMs) / DAY_MS;
  if (ageDays < 0) errors.push(`${path} cannot be in the future.`);
  if (ageDays > maxAgeDays) {
    errors.push(`KAN-66 source and commercial evidence is stale after ${maxAgeDays} days.`);
  }
}

function parseCanonicalTimestamp(value, path, errors) {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) {
    errors.push(`${path} must be a canonical UTC timestamp with millisecond precision.`);
    return null;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    errors.push(`${path} must be a real canonical UTC timestamp.`);
    return null;
  }
  return milliseconds;
}

function validateClosedArray(value, length, keys, path, errors) {
  if (!Array.isArray(value) || value.length !== length) {
    errors.push(`${path} must contain exactly ${length} closed row(s).`);
    return false;
  }
  value.forEach((entry, index) => exactKeys(entry, keys, `${path}[${index}]`, errors));
  return true;
}

function expectClosedHash(value, expectedHash, path, errors) {
  if (sha256(canonicalJson(value)) !== expectedHash) {
    errors.push(`${path} must retain its closed KAN-66 semantic digest.`);
  }
}

function parseFixed(mantissa, scale, path, errors) {
  if (typeof mantissa !== 'string' || !CANONICAL_INTEGER.test(mantissa) || mantissa.length > 78) {
    errors.push(`${path}.mantissa must be a canonical non-negative integer of at most 78 digits.`);
    return null;
  }
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 36) {
    errors.push(`${path}.scale must be an integer from 0 through 36.`);
    return null;
  }
  return { mantissa: BigInt(mantissa), scale };
}

function powerOfTen(exponent) {
  return 10n ** BigInt(exponent);
}

function alignFixed(value, scale) {
  return value.mantissa * powerOfTen(scale - value.scale);
}

function compareFixed(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const leftMantissa = alignFixed(left, scale);
  const rightMantissa = alignFixed(right, scale);
  return leftMantissa < rightMantissa ? -1 : leftMantissa > rightMantissa ? 1 : 0;
}

function absoluteDifference(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const leftMantissa = alignFixed(left, scale);
  const rightMantissa = alignFixed(right, scale);
  return {
    mantissa:
      leftMantissa >= rightMantissa ? leftMantissa - rightMantissa : rightMantissa - leftMantissa,
    scale,
  };
}

function subtractFixedFloorZero(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const leftMantissa = alignFixed(left, scale);
  const rightMantissa = alignFixed(right, scale);
  return {
    mantissa: leftMantissa > rightMantissa ? leftMantissa - rightMantissa : 0n,
    scale,
  };
}

function minimumFixed(values) {
  return values.reduce((minimum, value) => (compareFixed(value, minimum) < 0 ? value : minimum));
}

function fixedAtOrBelowBps(value, bps) {
  return value.mantissa * 10_000n <= BigInt(bps) * powerOfTen(value.scale);
}

function fixedAtOrAboveBps(value, bps) {
  return value.mantissa * 10_000n >= BigInt(bps) * powerOfTen(value.scale);
}

function classifyScaleEightDivergenceUnits(value) {
  if (typeof value !== 'string' || !CANONICAL_INTEGER.test(value)) return 'INVALID';
  const difference = { mantissa: BigInt(value), scale: 8 };
  if (fixedAtOrBelowBps(difference, 25)) return 'CORROBORATED';
  if (fixedAtOrBelowBps(difference, 50)) return 'SOFT_DISAGREEMENT';
  return 'SOURCE_CONFLICT';
}

function classifyScaleEightDownsideRate(value) {
  if (typeof value !== 'string' || !CANONICAL_INTEGER.test(value)) return 'INVALID';
  const peg = { mantissa: 100_000_000n, scale: 8 };
  const rate = { mantissa: BigInt(value), scale: 8 };
  const downside = subtractFixedFloorZero(peg, rate);
  if (fixedAtOrAboveBps(downside, 200)) return 'DEPEGGED';
  if (fixedAtOrBelowBps(downside, 50)) return 'NORMAL';
  return 'WATCH';
}

export const VALUATION_VALIDATOR_TEST_HOOKS = Object.freeze({
  classifyScaleEightDivergenceUnits,
  classifyScaleEightDownsideRate,
});

function divideRoundHalfEven(numerator, denominator) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder * 2n;
  if (doubled < denominator) return quotient;
  if (doubled > denominator) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

function calculateExampleValue(amount, assetDecimals, rate, errors, path) {
  const product = amount * rate.mantissa;
  if (product.toString().length > 156) {
    errors.push(`${path} exact amount/rate product exceeds 156 digits.`);
    return null;
  }
  const numerator = product * powerOfTen(18);
  const denominator = powerOfTen(assetDecimals + rate.scale);
  const value = divideRoundHalfEven(numerator, denominator);
  if (value.toString().length > 96) {
    errors.push(`${path} half-even USD result exceeds 96 digits.`);
    return null;
  }
  return value;
}

function validateRecoveryRows(example, errors, path) {
  const rows = example.input.recoveryObservations;
  if (!Array.isArray(rows)) {
    errors.push(`${path}.input.recoveryObservations must be an array.`);
    return false;
  }
  const identifiers = new Set();
  let previousElapsed = -1;
  let valid = rows.length >= 4;
  rows.forEach((row, index) => {
    const rowPath = `${path}.input.recoveryObservations[${index}]`;
    exactKeys(row, RECOVERY_OBSERVATION_KEYS, rowPath, errors);
    if (typeof row?.id !== 'string' || identifiers.has(row.id)) valid = false;
    else identifiers.add(row.id);
    if (
      !Number.isSafeInteger(row?.elapsedFromFirstSeconds) ||
      row.elapsedFromFirstSeconds < 0 ||
      row.elapsedFromFirstSeconds <= previousElapsed
    ) {
      valid = false;
    } else {
      previousElapsed = row.elapsedFromFirstSeconds;
    }
    if (
      row?.dualSource !== true ||
      row?.sourceAgreement !== 'CORROBORATED' ||
      !Number.isSafeInteger(row?.maximumDownsideBps) ||
      row.maximumDownsideBps < 0 ||
      row.maximumDownsideBps > 25 ||
      !Number.isSafeInteger(row?.pythConfidenceBps) ||
      row.pythConfidenceBps < 0 ||
      row.pythConfidenceBps > 25 ||
      row?.wasCurrent !== true ||
      row?.monotonic !== true
    ) {
      valid = false;
    }
  });
  if (rows.length > 0 && previousElapsed < 1800) valid = false;
  return valid;
}

function validateRecoveryReferences(example, errors, path) {
  const input = example.input;
  const rows = input.recoveryObservations;
  const hasRows = Array.isArray(rows) && rows.length > 0;
  const evaluatedAtMs = parseCanonicalTimestamp(
    input.recoveryEvaluatedAt,
    `${path}.input.recoveryEvaluatedAt`,
    errors,
  );

  let latchId = null;
  let latchedAtMs = null;
  let latchValid = input.depegLatch !== null;
  if (input.depegLatch !== null) {
    latchValid = exactKeys(input.depegLatch, DEPEG_LATCH_KEYS, `${path}.input.depegLatch`, errors);
    latchId = input.depegLatch?.latchId;
    if (typeof latchId !== 'string' || !LOWER_RECOVERY_EVENT_ID.test(latchId)) {
      errors.push(`${path}.input.depegLatch.latchId must be exactly 64 lowercase hex characters.`);
      latchValid = false;
    }
    latchedAtMs = parseCanonicalTimestamp(
      input.depegLatch?.latchedAt,
      `${path}.input.depegLatch.latchedAt`,
      errors,
    );
    if (latchedAtMs === null) latchValid = false;
    if (latchedAtMs !== null && evaluatedAtMs !== null && latchedAtMs > evaluatedAtMs) {
      errors.push(`${path}.input.depegLatch cannot occur after the trusted recovery evaluation.`);
      latchValid = false;
    }
  }

  let clearValid = input.manualRiskClear !== null;
  let clearedAtMs = null;
  if (input.manualRiskClear !== null) {
    clearValid = exactKeys(
      input.manualRiskClear,
      MANUAL_RISK_CLEAR_KEYS,
      `${path}.input.manualRiskClear`,
      errors,
    );
    const clearId = input.manualRiskClear?.clearId;
    const clearLatchId = input.manualRiskClear?.latchId;
    if (typeof clearId !== 'string' || !LOWER_RECOVERY_EVENT_ID.test(clearId)) {
      errors.push(
        `${path}.input.manualRiskClear.clearId must be exactly 64 lowercase hex characters.`,
      );
      clearValid = false;
    }
    if (typeof clearLatchId !== 'string' || !LOWER_RECOVERY_EVENT_ID.test(clearLatchId)) {
      errors.push(
        `${path}.input.manualRiskClear.latchId must be exactly 64 lowercase hex characters.`,
      );
      clearValid = false;
    }
    if (input.depegLatch === null) {
      errors.push(`${path}.input.manualRiskClear cannot exist without an asset-bound depeg latch.`);
      clearValid = false;
    } else {
      if (clearLatchId !== latchId) {
        errors.push(`${path}.input.manualRiskClear.latchId must match the depeg latch.`);
        clearValid = false;
      }
      if (clearId === latchId) {
        errors.push(`${path}.input.manualRiskClear.clearId must be distinct from the latchId.`);
        clearValid = false;
      }
    }
    clearedAtMs = parseCanonicalTimestamp(
      input.manualRiskClear?.clearedAt,
      `${path}.input.manualRiskClear.clearedAt`,
      errors,
    );
    if (clearedAtMs === null) clearValid = false;
    if (clearedAtMs !== null && evaluatedAtMs !== null && clearedAtMs > evaluatedAtMs) {
      errors.push(`${path}.input.manualRiskClear cannot occur after the trusted evaluation.`);
      clearValid = false;
    }
  }

  let evidenceTimesValid = true;
  let finalSampleAtMs = null;
  if (hasRows) {
    if (!latchValid || latchedAtMs === null) {
      errors.push(`${path}.input recovery evidence requires a valid asset-bound depeg latch.`);
      evidenceTimesValid = false;
    }
    rows.forEach((row, index) => {
      if (!Number.isSafeInteger(row?.elapsedFromFirstSeconds) || row.elapsedFromFirstSeconds < 0) {
        evidenceTimesValid = false;
        return;
      }
      const sampleAtMs = PACKET_RECOVERY_FIRST_SAMPLE_MS + row.elapsedFromFirstSeconds * 1_000;
      if (!Number.isSafeInteger(sampleAtMs)) {
        errors.push(`${path}.input.recoveryObservations[${index}] has an unsafe sample time.`);
        evidenceTimesValid = false;
        return;
      }
      finalSampleAtMs = sampleAtMs;
      if (evaluatedAtMs !== null && sampleAtMs > evaluatedAtMs) {
        errors.push(
          `${path}.input.recoveryObservations[${index}] occurs after the trusted evaluation.`,
        );
        evidenceTimesValid = false;
      }
      const pythAgeMs = row.wasCurrent === true ? 1_000 : 60_001;
      const chainlinkAgeMs = row.wasCurrent === true ? 2_000 : 60_001;
      const earliestObservationMs =
        sampleAtMs - (row.dualSource === true ? Math.max(pythAgeMs, chainlinkAgeMs) : pythAgeMs);
      if (latchedAtMs !== null && earliestObservationMs < latchedAtMs) {
        errors.push(
          `${path}.input.recoveryObservations[${index}] contains evidence before the depeg latch.`,
        );
        evidenceTimesValid = false;
      }
    });
  }

  if (input.manualRiskClear !== null) {
    if (!hasRows || finalSampleAtMs === null) {
      errors.push(`${path}.input.manualRiskClear requires final recovery evidence.`);
      clearValid = false;
    } else if (clearedAtMs !== null && clearedAtMs < finalSampleAtMs) {
      errors.push(`${path}.input.manualRiskClear must occur at or after the final sample.`);
      clearValid = false;
    }
  }

  return {
    hasRows,
    hasLatch: input.depegLatch !== null,
    hasClear: input.manualRiskClear !== null,
    latchValid,
    clearValid,
    evidenceTimesValid,
  };
}

function validateDeterministicExample(example, index, errors) {
  const path = `deterministicExamples[${index}]`;
  if (!exactKeys(example, EXAMPLE_KEYS, path, errors)) return;
  exactKeys(example.input, EXAMPLE_INPUT_KEYS, `${path}.input`, errors);
  exactKeys(example.result, EXAMPLE_RESULT_KEYS, `${path}.result`, errors);
  const recoveryReferences = validateRecoveryReferences(example, errors, path);

  if (
    typeof example.amountAtomic !== 'string' ||
    !CANONICAL_INTEGER.test(example.amountAtomic) ||
    example.amountAtomic.length > 78
  ) {
    errors.push(`${path}.amountAtomic must be a canonical integer of at most 78 digits.`);
    return;
  }
  if (
    !Number.isSafeInteger(example.assetDecimals) ||
    example.assetDecimals < 0 ||
    example.assetDecimals > 36
  ) {
    errors.push(`${path}.assetDecimals must be an integer from 0 through 36.`);
    return;
  }
  if (!EXPECTED_ASSETS.some(({ asset }) => asset === example.asset)) {
    errors.push(`${path}.asset must be in the exact KAN-61-bound asset set.`);
  }
  if (!Array.isArray(example.input?.observations) || example.input.observations.length !== 2) {
    errors.push(`${path}.input.observations must contain the two ordered source slots.`);
    return;
  }

  const candidates = [];
  const seenProviders = new Set();
  for (const [observationIndex, observation] of example.input.observations.entries()) {
    const observationPath = `${path}.input.observations[${observationIndex}]`;
    exactKeys(observation, OBSERVATION_KEYS, observationPath, errors);
    exactKeys(
      observation?.confidence,
      OBSERVATION_CONFIDENCE_KEYS,
      `${observationPath}.confidence`,
      errors,
    );
    const expectedProvider = observationIndex === 0 ? 'PYTH_CORE' : 'CHAINLINK_DATA_FEEDS';
    if (observation?.provider !== expectedProvider || seenProviders.has(observation?.provider)) {
      errors.push(`${observationPath}.provider must preserve distinct ordered source roles.`);
    }
    seenProviders.add(observation?.provider);
    const age = observation?.ageSeconds;
    if (!Number.isSafeInteger(age) || age < 0) {
      errors.push(`${observationPath}.ageSeconds cannot represent a future timestamp.`);
      continue;
    }
    const expectedFreshness = age <= 60 ? 'CURRENT' : age <= 300 ? 'STALE' : 'UNAVAILABLE';
    if (observation.freshness !== expectedFreshness) {
      errors.push(
        `${observationPath}.freshness must be derived from the absolute 60/300-second cap.`,
      );
    }
    const rate = parseFixed(
      observation?.priceMantissa,
      observation?.priceScale,
      `${observationPath}.price`,
      errors,
    );
    if (rate === null) continue;

    let lowerBound = rate;
    let pythConfidence = null;
    if (observation.provider === 'PYTH_CORE') {
      if (observation.confidence?.kind !== 'PUBLISHED_ABSOLUTE_USD') {
        errors.push(`${observationPath}.confidence must retain Pyth's published absolute model.`);
        continue;
      }
      pythConfidence = parseFixed(
        observation.confidence.mantissa,
        observation.confidence.scale,
        `${observationPath}.confidence`,
        errors,
      );
      if (pythConfidence === null || !fixedAtOrBelowBps(pythConfidence, 50)) continue;
      lowerBound = subtractFixedFloorZero(rate, pythConfidence);
    } else if (
      observation.confidence?.kind !== 'NOT_PUBLISHED' ||
      observation.confidence?.mantissa !== null ||
      observation.confidence?.scale !== null
    ) {
      errors.push(`${observationPath}.confidence must not invent Chainlink confidence.`);
      continue;
    }

    if (expectedFreshness === 'CURRENT' && observation.monotonic === true) {
      candidates.push({ provider: observation.provider, rate, lowerBound, pythConfidence });
    }
  }

  const result = example.result;
  if (candidates.length === 0) {
    expectExact(
      [
        result.availability,
        result.selection,
        result.selectedSourceId,
        result.sourceAgreement,
        result.confidenceClass,
        result.freshnessClass,
        result.usdRateMantissa,
        result.usdRateScale,
        result.usdValueMantissa,
        result.usdValueScale,
        result.depegClass,
        result.downsideBand,
        result.recoveryStatus,
        result.reportingUse,
        result.mayIncreaseBuyingPower,
        result.mayAuthorizeFinancialUse,
      ],
      [
        'UNAVAILABLE',
        'NONE',
        null,
        'NOT_AVAILABLE',
        'UNAVAILABLE',
        'UNAVAILABLE',
        null,
        null,
        null,
        18,
        'NOT_ASSESSED',
        'NOT_ASSESSED',
        'NOT_APPLICABLE',
        'BLOCKED',
        false,
        false,
      ],
      `${path}.result stale/unavailable behavior`,
      errors,
    );
    return;
  }

  let agreement = 'SINGLE_SOURCE';
  if (candidates.length === 2) {
    const difference = absoluteDifference(candidates[0].rate, candidates[1].rate);
    agreement = fixedAtOrBelowBps(difference, 25)
      ? 'CORROBORATED'
      : fixedAtOrBelowBps(difference, 50)
        ? 'SOFT_DISAGREEMENT'
        : 'SOURCE_CONFLICT';
    if (agreement === 'SOURCE_CONFLICT') {
      const peg = { mantissa: 1n, scale: 0 };
      const downsideAlarm = candidates.some(({ lowerBound }) =>
        fixedAtOrAboveBps(subtractFixedFloorZero(peg, lowerBound), 200),
      );
      expectExact(
        [
          result.availability,
          result.selection,
          result.selectedSourceId,
          result.sourceAgreement,
          result.confidenceClass,
          result.freshnessClass,
          result.usdRateMantissa,
          result.usdRateScale,
          result.usdValueMantissa,
          result.usdValueScale,
          result.depegClass,
          result.downsideBand,
          result.recoveryStatus,
          result.reportingUse,
          result.mayIncreaseBuyingPower,
          result.mayAuthorizeFinancialUse,
        ],
        [
          'UNAVAILABLE',
          'NONE',
          null,
          'CONFLICT',
          'UNAVAILABLE',
          'UNAVAILABLE',
          null,
          null,
          null,
          18,
          downsideAlarm ? 'OUTSIDE_POLICY' : 'NOT_ASSESSED',
          downsideAlarm ? 'DEPEGGED' : 'NOT_ASSESSED',
          downsideAlarm ? 'RECOVERY_PENDING' : 'NOT_APPLICABLE',
          'BLOCKED',
          false,
          false,
        ],
        `${path}.result source-conflict freeze`,
        errors,
      );
      return;
    }
  }

  const peg = { mantissa: 100_000_000n, scale: 8 };
  const conservativeRate = minimumFixed([...candidates.map(({ lowerBound }) => lowerBound), peg]);
  const amount = BigInt(example.amountAtomic);
  const value = calculateExampleValue(
    amount,
    example.assetDecimals,
    conservativeRate,
    errors,
    path,
  );
  const downside = subtractFixedFloorZero(peg, conservativeRate);
  const downsideBand = fixedAtOrAboveBps(downside, 200)
    ? 'DEPEGGED'
    : fixedAtOrBelowBps(downside, 50)
      ? 'NORMAL'
      : 'WATCH';
  const pyth = candidates.find(({ provider }) => provider === 'PYTH_CORE');
  const confidenceClass =
    candidates.length === 2 &&
    agreement === 'CORROBORATED' &&
    pyth?.pythConfidence !== null &&
    pyth?.pythConfidence !== undefined &&
    fixedAtOrBelowBps(pyth.pythConfidence, 25)
      ? 'MEDIUM'
      : 'LOW';
  const selectedCandidate = candidates.reduce((selected, candidate) =>
    compareFixed(candidate.lowerBound, selected.lowerBound) < 0 ? candidate : selected,
  );
  const selection =
    candidates.length === 2
      ? 'CONSERVATIVE_MINIMUM'
      : selectedCandidate.provider === 'PYTH_CORE'
        ? 'PRIMARY'
        : 'FALLBACK';
  const recoveryRowsValid = validateRecoveryRows(example, errors, path);
  const recoveryStatus = recoveryReferences.hasRows
    ? !recoveryReferences.hasLatch
      ? 'NOT_APPLICABLE'
      : recoveryRowsValid && recoveryReferences.latchValid && recoveryReferences.evidenceTimesValid
        ? recoveryReferences.hasClear && recoveryReferences.clearValid
          ? 'RECOVERY_CANDIDATE_CLEARED'
          : 'MANUAL_RISK_CLEAR_REQUIRED'
        : 'RECOVERY_PENDING'
    : downsideBand === 'DEPEGGED'
      ? 'RECOVERY_PENDING'
      : 'NOT_APPLICABLE';
  const depegClass = downsideBand === 'DEPEGGED' ? 'OUTSIDE_POLICY' : 'WITHIN_POLICY';
  expectExact(
    [
      result.availability,
      result.selection,
      result.selectedSourceId,
      result.sourceAgreement,
      result.confidenceClass,
      result.freshnessClass,
      result.usdRateMantissa,
      result.usdRateScale,
      result.usdValueMantissa,
      result.usdValueScale,
      result.depegClass,
      result.downsideBand,
      result.recoveryStatus,
      result.reportingUse,
      result.mayIncreaseBuyingPower,
      result.mayAuthorizeFinancialUse,
    ],
    [
      'AVAILABLE',
      selection,
      selectedCandidate.provider,
      agreement,
      confidenceClass,
      'CURRENT',
      conservativeRate.mantissa.toString(),
      conservativeRate.scale,
      value?.toString() ?? null,
      18,
      depegClass,
      downsideBand,
      recoveryStatus,
      'CONSERVATIVE_REPORTING_ONLY',
      false,
      false,
    ],
    `${path}.result deterministic integer evaluation`,
    errors,
  );
}

function findSensitiveOrUnexpectedUrls(value, path, errors, seen = new Set()) {
  if (typeof value === 'string') {
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))) {
      errors.push(`${path} contains secret-like material.`);
    }
    if (
      /\b(?:https?|wss?):\/\/[^\s]+/u.test(value) &&
      !/^sourceEvidence\[\d+\]\.url$/u.test(path)
    ) {
      errors.push(`${path} must not contain an endpoint or URL.`);
    }
    return;
  }
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      findSensitiveOrUnexpectedUrls(entry, `${path}[${index}]`, errors, seen),
    );
    return;
  }
  for (const key of Object.keys(value)) {
    findSensitiveOrUnexpectedUrls(value[key], path === '' ? key : `${path}.${key}`, errors, seen);
  }
}

function validateCore(record, now) {
  const errors = [];
  if (!validateJsonDataShape(record, 'record', errors)) return errors;
  if (!exactKeys(record, TOP_KEYS, 'record', errors)) return errors;

  if (record.schemaVersion !== 1) errors.push('schemaVersion must equal 1.');
  if (record.ticket !== 'KAN-66') errors.push('ticket must equal KAN-66.');
  if (record.specification !== 'BAL-001') errors.push('specification must equal BAL-001.');
  if (record.decisionReference !== 'jira:KAN-66/stablecoin-valuation-decision-v1') {
    errors.push('decisionReference must bind stablecoin-valuation-decision-v1.');
  }
  if (record.localStatus !== 'READY_FOR_INDEPENDENT_REVIEW') {
    errors.push('localStatus must remain READY_FOR_INDEPENDENT_REVIEW.');
  }
  if (record.externalStatus !== 'PENDING_EXTERNAL_APPROVAL') {
    errors.push('externalStatus must remain PENDING_EXTERNAL_APPROVAL.');
  }
  validateDateOnlyFreshness(record.asOfDate, now, 30, 'asOfDate', errors);

  for (const [section, expectedHash] of Object.entries(EXPECTED_SECTION_HASHES)) {
    expectClosedHash(record[section], expectedHash, section, errors);
  }

  if (exactKeys(record.selection, SELECTION_KEYS, 'selection', errors)) {
    expectExact(record.selection, EXPECTED_SELECTION, 'selection', errors);
  }

  if (exactKeys(record.approvalBoundary, APPROVAL_KEYS, 'approvalBoundary', errors)) {
    const boundary = record.approvalBoundary;
    if (boundary.approved !== false) errors.push('approvalBoundary.approved must remain false.');
    for (const field of [
      'riskPolicyApproval',
      'legalTermsApproval',
      'financePlanApproval',
      'approvedGitCommit',
      'approvedGitTree',
      'approvedDecisionPacketSha256',
      'approvedRegistryFingerprintSha256',
      'providerAccount',
      'plan',
      'sla',
      'monthlyCostUsd',
      'runtimeActivation',
      'manualRiskClear',
    ]) {
      if (boundary[field] !== null) {
        errors.push(`approvalBoundary.${field} must remain null pending KAN-252.`);
      }
    }
    for (const field of [
      'apiEndpointHostnames',
      'rpcEndpointHostnames',
      'chainlinkContractAddresses',
      'credentialReferences',
      'regions',
      'egressDestinations',
    ]) {
      if (!Array.isArray(boundary[field]) || boundary[field].length !== 0) {
        errors.push(`approvalBoundary.${field} must remain empty pending KAN-252 and KAN-231.`);
      }
    }
  }

  if (validateClosedArray(record.gates, 2, GATE_KEYS, 'gates', errors)) {
    expectExact(
      record.gates.map(({ ticket, status }) => [ticket, status]),
      [
        ['KAN-252', 'PENDING_EXTERNAL_APPROVAL'],
        ['KAN-231', 'PENDING_EXTERNAL_APPROVAL'],
      ],
      'gates pending tickets',
      errors,
    );
    if (
      !record.gates[0].requiredEvidence.includes(
        'PINNED_IDENTITIES_DURABLE_UNIQUE_UPDATE_ID_AND_SEQUENCE_TIMESTAMP_CHECKPOINT',
      )
    ) {
      errors.push(
        'KAN-252 must retain durable source identity, unique update history, and sequence/timestamp checkpoint evidence.',
      );
    }
    if (
      !record.gates[0].requiredEvidence.includes(
        'MERGED_GIT_COMMIT_TREE_PACKET_SHA256_AND_KAN_61_FINGERPRINT_BINDING',
      )
    ) {
      errors.push('KAN-252 must bind approval to the exact merged code, packet, and registry.');
    }
    if (
      !record.gates[0].requiredEvidence.includes(
        'DURABLE_ASSET_BOUND_DEPEG_LATCH_AND_AUTHENTICATED_MANUAL_CLEAR_RECORDS',
      )
    ) {
      errors.push('KAN-252 must retain durable asset-bound latch and Risk-clear evidence.');
    }
  }

  if (exactKeys(record.sourcePolicy, SOURCE_POLICY_KEYS, 'sourcePolicy', errors)) {
    const policy = record.sourcePolicy;
    if (exactKeys(policy.registryBinding, REGISTRY_KEYS, 'sourcePolicy.registryBinding', errors)) {
      expectExact(
        policy.registryBinding,
        {
          version: 1,
          environment: 'MAINNET',
          fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
          status: 'REQUIRED_EXACT_BINDING',
          testnetStatus: 'OUT_OF_SCOPE_NONFINANCIAL_NO_VALUATION',
        },
        'sourcePolicy.registryBinding',
        errors,
      );
    }
    expectExact(
      policy.providerOrder,
      ['PYTH_CORE', 'CHAINLINK_DATA_FEEDS'],
      'sourcePolicy.providerOrder',
      errors,
    );
    if (validateClosedArray(policy.providers, 2, PROVIDER_KEYS, 'sourcePolicy.providers', errors)) {
      for (const [index, provider] of policy.providers.entries()) {
        exactKeys(
          provider.confidence,
          PROVIDER_CONFIDENCE_KEYS,
          `sourcePolicy.providers[${index}].confidence`,
          errors,
        );
      }
      expectExact(
        policy.providers.map(
          ({ provider, role, endpointStatus, credentialStatus, liveValidationStatus }) => [
            provider,
            role,
            endpointStatus,
            credentialStatus,
            liveValidationStatus,
          ],
        ),
        [
          ['PYTH_CORE', 'PRIMARY', 'NOT_SELECTED', 'NOT_ISSUED', 'NOT_RUN'],
          [
            'CHAINLINK_DATA_FEEDS',
            'FALLBACK_AND_CROSS_CHECK',
            'NOT_SELECTED',
            'NOT_ISSUED',
            'NOT_RUN',
          ],
        ],
        'sourcePolicy.providers activation boundary',
        errors,
      );
      expectExact(
        policy.providers.map(
          ({
            provider,
            timestampField,
            sequenceRule,
            sequenceRuleStatus,
            durableCheckpointRequired,
          }) => [
            provider,
            timestampField,
            sequenceRule,
            sequenceRuleStatus,
            durableCheckpointRequired,
          ],
        ),
        [
          [
            'PYTH_CORE',
            'publish_time',
            'CANONICAL_PROVIDER_UPDATE_IDENTIFIER_PLUS_PUBLISH_TIME',
            'PENDING_KAN_252_NOT_SAFE_TO_INFER_FROM_PUBLISH_TIME',
            true,
          ],
          [
            'CHAINLINK_DATA_FEEDS',
            'latestRoundData.updatedAt',
            'LATEST_ROUND_DATA_ROUND_ID_AND_UPDATED_AT',
            'PENDING_KAN_252_LIVE_MONOTONICITY_AND_PROXY_LIFECYCLE_PROOF',
            true,
          ],
        ],
        'sourcePolicy.providers durable source checkpoint semantics',
        errors,
      );
    }
    exactKeys(policy.valuation, VALUATION_KEYS, 'sourcePolicy.valuation', errors);
    exactKeys(policy.freshness, FRESHNESS_KEYS, 'sourcePolicy.freshness', errors);
    exactKeys(policy.confidence, CONFIDENCE_KEYS, 'sourcePolicy.confidence', errors);
    exactKeys(policy.agreement, AGREEMENT_KEYS, 'sourcePolicy.agreement', errors);
    exactKeys(policy.depeg, DEPEG_KEYS, 'sourcePolicy.depeg', errors);
    exactKeys(policy.recovery, RECOVERY_KEYS, 'sourcePolicy.recovery', errors);
    exactKeys(
      policy.unavailableBehavior,
      UNAVAILABLE_KEYS,
      'sourcePolicy.unavailableBehavior',
      errors,
    );
    exactKeys(
      policy.financialAuthorization,
      FINANCIAL_KEYS,
      'sourcePolicy.financialAuthorization',
      errors,
    );
    expectExact(
      [
        policy.confidence.mediumRule,
        policy.confidence.lowRule,
        policy.confidence.unusableRule,
        policy.agreement.corroboratedRule,
        policy.agreement.softDisagreementRule,
        policy.agreement.sourceConflictRule,
        policy.depeg.normalRule,
        policy.depeg.watchRule,
        policy.depeg.depeggedRule,
      ],
      [
        'TWO_CURRENT_SOURCES_DIVERGENCE_AT_MOST_25_BPS_AND_PYTH_CONFIDENCE_AT_MOST_25_BPS',
        'ONE_CURRENT_SOURCE_OR_DIVERGENCE_ABOVE_25_BPS_AT_OR_BELOW_50_BPS_OR_PYTH_CONFIDENCE_ABOVE_25_BPS_AT_OR_BELOW_50_BPS',
        'NO_ELIGIBLE_SOURCE_OR_MALFORMED_SOURCE_OR_PYTH_CONFIDENCE_ABOVE_50_BPS',
        'DIVERGENCE_0_TO_25_BPS',
        'DIVERGENCE_ABOVE_25_BPS_AT_OR_BELOW_50_BPS',
        'DIVERGENCE_ABOVE_50_BPS',
        'DOWNSIDE_0_TO_50_BPS',
        'DOWNSIDE_ABOVE_50_BPS_BELOW_200_BPS',
        'DOWNSIDE_AT_LEAST_200_BPS',
      ],
      'sourcePolicy exact fractional-bps boundaries',
      errors,
    );
    expectExact(
      [
        policy.recovery.sampleEvaluatedAtMustBeStrictlyMonotonic,
        policy.recovery.sourceSequenceMustStrictlyIncrease,
        policy.recovery.sourceUpdateIdMustBeUniqueAcrossWindow,
        policy.recovery.sourceTimestampsMustBeNonRegressing,
        policy.recovery.depegLatchReferenceShape,
        policy.recovery.trustedRecoveryEvaluatedAtRequired,
        policy.recovery.allEvidenceAtOrAfterLatch,
        policy.recovery.allLatchEvidenceAndClearTimesAtOrBeforeEvaluation,
        policy.recovery.manualRiskClearRequired,
        policy.recovery.manualRiskClearReferenceShape,
        policy.recovery.manualRiskClearMustFollowFinalSample,
        policy.recovery.durableLatchClearPersistenceAuthentication,
        policy.recovery.statusWhenAutomatedPredicatesFail,
        policy.recovery.statusWhenPredicatesPassWithoutManualClear,
        policy.recovery.statusAfterManualClear,
        policy.recovery.candidateClearAuthorizesFinancialUse,
      ],
      [
        true,
        true,
        true,
        true,
        'EXACT_KAN_61_ASSET_64_LOWER_HEX_LATCH_ID_CANONICAL_LATCHED_AT',
        true,
        true,
        true,
        true,
        'EXACT_KAN_61_ASSET_DISTINCT_64_LOWER_HEX_CLEAR_ID_MATCHING_LATCH_ID_CANONICAL_CLEARED_AT',
        true,
        'PENDING_KAN_252_DURABLE_UNIQUE_LATCH_AND_CLEAR_IDS_AUTHENTICATED_RISK_CLEAR',
        'RECOVERY_PENDING',
        'MANUAL_RISK_CLEAR_REQUIRED',
        'RECOVERY_CANDIDATE_CLEARED',
        false,
      ],
      'sourcePolicy exact recovery timestamp and state transition semantics',
      errors,
    );
    expectExact(
      [
        policy.freshness.ageRule,
        policy.freshness.providerHeartbeatCanExtendRiskFreshness,
        policy.freshness.trustedLastAcceptedCheckpointRequired,
        policy.freshness.inRequestOrderingAloneSufficient,
        policy.freshness.checkpointScope,
        policy.freshness.checkpointFields,
        policy.freshness.checkpointDurability,
        policy.freshness.historicalUpdateIdUniqueness,
        policy.freshness.staleObservationEligibleForValuation,
        policy.freshness.unavailableObservationEligibleForValuation,
        policy.confidence.highClassPermitted,
        policy.agreement.sourceConflictValuation,
        policy.valuation.downsideFloorUsd,
        policy.valuation.nominalOneDollarAssumption,
        policy.recovery.automaticRepeg,
        policy.recovery.manualRiskClearRequired,
        policy.financialAuthorization.localStatus,
      ],
      [
        'EVALUATED_AT_MINUS_SOURCE_PRICED_AT',
        false,
        true,
        false,
        'REGISTRY_FINGERPRINT_ASSET_SOURCE',
        'SEQUENCE_PRICED_AT_OBSERVED_AT_UPDATE_ID',
        'ATOMIC_PERSISTED_ACROSS_PROCESS_RESTART',
        'PENDING_KAN_252_DURABLE_UNIQUE_REGISTRY_FINGERPRINT_ASSET_SOURCE_UPDATE_ID_CONSTRAINT',
        false,
        false,
        false,
        'UNAVAILABLE_NULL_FREEZE',
        null,
        'PROHIBITED',
        false,
        true,
        'ALWAYS_BLOCKED_PENDING_EXTERNAL_GATES',
      ],
      'sourcePolicy fail-closed controls',
      errors,
    );
  }

  if (exactKeys(record.thresholds, THRESHOLD_KEYS, 'thresholds', errors)) {
    expectExact(record.thresholds, EXPECTED_THRESHOLDS, 'thresholds', errors);
  }

  if (validateClosedArray(record.assetMatrix, 3, ASSET_KEYS, 'assetMatrix', errors)) {
    record.assetMatrix.forEach((asset, index) => {
      const expected = EXPECTED_ASSETS[index];
      expectExact(
        [
          asset.asset,
          asset.quote,
          asset.registryVersion,
          asset.pythFeedSymbol,
          asset.pythStableFeedId,
          asset.chainlinkNetwork,
          asset.chainlinkEnsSelector,
          asset.chainlinkContractAddress,
          asset.chainlinkDocumentedDeviationBps,
          asset.chainlinkHeartbeatSeconds,
          asset.chainlinkHeartbeatStatus,
        ],
        [
          expected.asset,
          'USD',
          1,
          expected.symbol,
          expected.pythId,
          'eip155:1',
          expected.ens,
          null,
          expected.deviationBps,
          null,
          'PENDING_KAN_252',
        ],
        `assetMatrix[${index}] exact provider mapping`,
        errors,
      );
    });
  }

  if (
    validateClosedArray(
      record.deterministicExamples,
      EXPECTED_EXAMPLE_IDS.length,
      EXAMPLE_KEYS,
      'deterministicExamples',
      errors,
    )
  ) {
    expectExact(
      record.deterministicExamples.map(({ id }) => id),
      EXPECTED_EXAMPLE_IDS,
      'deterministicExamples ids',
      errors,
    );
    record.deterministicExamples.forEach((example, index) =>
      validateDeterministicExample(example, index, errors),
    );
  }

  if (
    validateClosedArray(record.sourceResearch, 2, SOURCE_RESEARCH_KEYS, 'sourceResearch', errors)
  ) {
    expectExact(
      record.sourceResearch.map(({ provider, role, liveStatus }) => [provider, role, liveStatus]),
      [
        ['PYTH_CORE', 'PRIMARY', 'NOT_TESTED'],
        ['CHAINLINK_DATA_FEEDS', 'FALLBACK_AND_CROSS_CHECK', 'NOT_TESTED'],
      ],
      'sourceResearch unapproved roles',
      errors,
    );
  }

  if (
    validateClosedArray(record.commercialResearch, 2, COMMERCIAL_KEYS, 'commercialResearch', errors)
  ) {
    for (const [index, research] of record.commercialResearch.entries()) {
      if (
        research.selectedPlan !== null ||
        research.approvedMonthlyUsd !== null ||
        research.accountCreated !== false ||
        research.trialStarted !== false ||
        research.paymentMethodAdded !== false
      ) {
        errors.push(
          `commercialResearch[${index}] cannot claim plan, spend, account, or trial approval.`,
        );
      }
    }
  }

  if (
    validateClosedArray(record.sourceEvidence, 15, SOURCE_EVIDENCE_KEYS, 'sourceEvidence', errors)
  ) {
    for (const [index, source] of record.sourceEvidence.entries()) {
      validateDateOnlyFreshness(
        source.reviewedOn,
        now,
        30,
        `sourceEvidence[${index}].reviewedOn`,
        errors,
      );
      if (source.reviewedOn !== record.asOfDate) {
        errors.push(`sourceEvidence[${index}].reviewedOn must equal asOfDate.`);
      }
      try {
        const parsed = new URL(source.url);
        if (
          parsed.protocol !== 'https:' ||
          parsed.username !== '' ||
          parsed.password !== '' ||
          parsed.search !== '' ||
          parsed.hash !== '' ||
          !OFFICIAL_SOURCE_HOSTS.has(parsed.hostname)
        ) {
          errors.push(`sourceEvidence[${index}].url must use an allowlisted official HTTPS page.`);
        }
      } catch {
        errors.push(`sourceEvidence[${index}].url must be a valid official HTTPS URL.`);
      }
    }
  }

  if (
    !Array.isArray(record.undocumentedOrUnverified) ||
    record.undocumentedOrUnverified.length !== 14
  ) {
    errors.push('undocumentedOrUnverified must retain all 14 external unknowns.');
  } else if (
    !record.undocumentedOrUnverified.includes(
      'EXACT_PROVIDER_SEQUENCE_SEMANTICS_DURABLE_UNIQUE_UPDATE_ID_HISTORY_AND_LAST_ACCEPTED_WATERMARK',
    )
  ) {
    errors.push('undocumentedOrUnverified must retain durable replay-protection uncertainty.');
  } else if (
    !record.undocumentedOrUnverified.includes(
      'MERGED_GIT_COMMIT_TREE_AND_EXTERNAL_APPROVAL_PACKET_BINDING',
    )
  ) {
    errors.push('undocumentedOrUnverified must retain exact candidate-binding uncertainty.');
  } else if (
    !record.undocumentedOrUnverified.includes(
      'NORMAL_WATCH_DEPEG_CONFLICT_UNAVAILABLE_RECOVERY_DURABLE_LATCH_AND_MANUAL_CLEAR_LIVE_EVIDENCE',
    )
  ) {
    errors.push('undocumentedOrUnverified must retain durable latch and manual-clear uncertainty.');
  }
  if (exactKeys(record.zeroCostEvidence, ZERO_COST_KEYS, 'zeroCostEvidence', errors)) {
    for (const [key, value] of Object.entries(record.zeroCostEvidence)) {
      const expected =
        key === 'costIncurredUsd' ? '0.00' : key === 'liveValidation' ? 'NOT_RUN' : 0;
      if (value !== expected)
        errors.push(`zeroCostEvidence.${key} must retain the zero-cost value.`);
    }
  }

  findSensitiveOrUnexpectedUrls(record, '', errors);
  if (sha256(canonicalJson(record)) !== EXPECTED_CANONICAL_RECORD_SHA256) {
    errors.push('record must retain the complete closed KAN-66 canonical semantic digest.');
  }

  return errors;
}

export function validateValuationDecisionRecord(record, { now = new Date() } = {}) {
  try {
    return validateCore(record, now);
  } catch {
    return ['record is malformed and could not be safely validated.'];
  }
}

export function validateValuationDecisionSidecar(decisionBytes, sidecar) {
  try {
    if (typeof sidecar !== 'string' || !LOWER_SHA256.test(sidecar)) {
      return ['KAN-66 SHA-256 sidecar must be one lowercase digest followed by LF.'];
    }
    return sidecar === `${sha256(decisionBytes)}\n`
      ? []
      : ['KAN-66 SHA-256 sidecar must exactly bind the decision JSON bytes.'];
  } catch {
    return ['KAN-66 SHA-256 sidecar input is malformed.'];
  }
}

export function validateValuationDecisionFiles({
  repositoryRoot = REPOSITORY_ROOT,
  now = new Date(),
} = {}) {
  try {
    const decisionBytes = readFileSync(resolve(repositoryRoot, DECISION_PATH));
    const sidecar = readFileSync(resolve(repositoryRoot, SIDECAR_PATH), 'utf8');
    let record;
    try {
      record = JSON.parse(decisionBytes.toString('utf8'));
    } catch {
      return { errors: ['KAN-66 valuation decision is not valid JSON.'], fingerprint: null };
    }
    const fingerprint = sha256(decisionBytes);
    return {
      errors: [
        ...validateValuationDecisionRecord(record, { now }),
        ...validateValuationDecisionSidecar(decisionBytes, sidecar),
        ...(fingerprint === EXPECTED_DECISION_SHA256
          ? []
          : ['KAN-66 decision bytes must retain the reviewed closed fingerprint.']),
      ],
      fingerprint,
      canonicalFingerprint: sha256(canonicalJson(record)),
    };
  } catch {
    return {
      errors: ['KAN-66 valuation decision or SHA-256 sidecar is missing or unreadable.'],
      fingerprint: null,
      canonicalFingerprint: null,
    };
  }
}

function main() {
  const result = validateValuationDecisionFiles();
  if (result.errors.length > 0) {
    console.error('KAN-66 stablecoin valuation decision validation failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `KAN-66 stablecoin valuation decision is locally valid and pending external approval (sha256 ${result.fingerprint}).`,
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
