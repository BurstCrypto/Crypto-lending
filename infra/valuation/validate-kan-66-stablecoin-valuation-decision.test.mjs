import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  DECISION_PATH,
  REPOSITORY_ROOT,
  SIDECAR_PATH,
  VALUATION_VALIDATOR_TEST_HOOKS,
  validateValuationDecisionFiles,
  validateValuationDecisionRecord,
  validateValuationDecisionSidecar,
} from './validate-kan-66-stablecoin-valuation-decision.mjs';

const NOW = new Date('2026-08-22T23:59:59.999Z');

function loadDecision() {
  return JSON.parse(readFileSync(`${REPOSITORY_ROOT}/${DECISION_PATH}`, 'utf8'));
}

function validate(record, now = NOW) {
  return validateValuationDecisionRecord(record, { now });
}

function assertMutationRejected(name, mutate, expectedText) {
  const record = loadDecision();
  mutate(record);
  const errors = validate(record);
  assert.ok(errors.length > 0, `${name} should fail closed`);
  if (expectedText !== undefined) {
    assert.match(errors.join('\n'), expectedText, `${name} should identify its failed invariant`);
  }
}

test('the exact canonical packet and byte sidecar are valid but activate nothing', () => {
  const record = loadDecision();
  assert.deepEqual(validate(record), []);
  assert.deepEqual(validateValuationDecisionFiles({ now: NOW }), {
    errors: [],
    fingerprint: '6c36c7bc78d70102c74255b9630f7a7e18e842e6daff52c9a73eed182121b7f3',
    canonicalFingerprint: '3b50fd1ceb2f94924426d1015ffb7a0941579a115ef2f104915b0928e06ad370',
  });
  assert.equal(record.externalStatus, 'PENDING_EXTERNAL_APPROVAL');
  assert.equal(record.selection.runtimeStatus, 'NOT_APPROVED');
  assert.equal(record.selection.financialUseStatus, 'NOT_APPROVED');
  assert.equal(record.approvalBoundary.approved, false);
});

test('malformed runtime values fail closed without escaping as exceptions', () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const negativeZero = loadDecision();
  negativeZero.zeroCostEvidence.providerAccountsCreated = -0;
  const malformed = [
    null,
    undefined,
    false,
    42,
    'KAN-66',
    [],
    {},
    { schemaVersion: 1 },
    { ...loadDecision(), sourcePolicy: null },
    { ...loadDecision(), sourceEvidence: [{ observedFact: 1n }] },
    negativeZero,
    revoked.proxy,
  ];
  for (const value of malformed) {
    assert.doesNotThrow(() => validate(value));
    assert.ok(validate(value).length > 0);
  }
});

test('accessors, symbols, inherited aliases, and array properties cannot bypass closure', () => {
  let getterCalls = 0;
  const accessorRecord = loadDecision();
  Object.defineProperty(accessorRecord.selection, 'approvalAlias', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'APPROVED';
    },
  });
  assert.ok(validate(accessorRecord).length > 0);
  assert.equal(getterCalls, 0, 'validation must reject accessors without invoking them');

  const mutations = [
    (record) => Object.defineProperty(record.approvalBoundary, 'approvalAlias', { value: true }),
    (record) => (record.selection[Symbol('approval')] = 'APPROVED'),
    (record) => Object.setPrototypeOf(record.selection, { financialUseStatus: 'APPROVED' }),
    (record) => (record.gates.approvalAlias = 'APPROVED'),
    (record) => (record.approvalBoundary.egressDestinations.approvalAlias = 'APPROVED'),
    (record) => (record.deterministicExamples[0].input.observations.alias = 'CURRENT'),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`non-JSON closure bypass ${index}`, mutate),
  );
});

test('all packet object kinds are closed against aliases and unknown keys', () => {
  const mutations = [
    (record) => (record.unknown = true),
    (record) => (record.selection.unknown = true),
    (record) => (record.approvalBoundary.unknown = true),
    (record) => (record.gates[0].unknown = true),
    (record) => (record.sourcePolicy.unknown = true),
    (record) => (record.sourcePolicy.registryBinding.unknown = true),
    (record) => (record.sourcePolicy.providers[0].unknown = true),
    (record) => (record.sourcePolicy.providers[0].confidence.unknown = true),
    (record) => (record.sourcePolicy.valuation.unknown = true),
    (record) => (record.sourcePolicy.freshness.unknown = true),
    (record) => (record.sourcePolicy.confidence.unknown = true),
    (record) => (record.sourcePolicy.agreement.unknown = true),
    (record) => (record.sourcePolicy.depeg.unknown = true),
    (record) => (record.sourcePolicy.recovery.unknown = true),
    (record) => (record.sourcePolicy.unavailableBehavior.unknown = true),
    (record) => (record.sourcePolicy.financialAuthorization.unknown = true),
    (record) => (record.thresholds.unknown = true),
    (record) => (record.assetMatrix[0].unknown = true),
    (record) => (record.deterministicExamples[0].unknown = true),
    (record) => (record.deterministicExamples[0].input.unknown = true),
    (record) => (record.deterministicExamples[0].input.observations[0].unknown = true),
    (record) => (record.deterministicExamples[0].input.observations[0].confidence.unknown = true),
    (record) => (record.deterministicExamples[8].input.recoveryObservations[0].unknown = true),
    (record) => (record.deterministicExamples[8].input.depegLatch.unknown = true),
    (record) => {
      const input = record.deterministicExamples[8].input;
      input.manualRiskClear = {
        clearId: 'c'.repeat(64),
        latchId: input.depegLatch.latchId,
        clearedAt: input.recoveryEvaluatedAt,
        unknown: true,
      };
    },
    (record) => (record.deterministicExamples[0].result.unknown = true),
    (record) => (record.sourceResearch[0].unknown = true),
    (record) => (record.commercialResearch[0].unknown = true),
    (record) => (record.sourceEvidence[0].unknown = true),
    (record) => (record.zeroCostEvidence.unknown = true),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`unknown object key ${index}`, mutate),
  );
});

test('absolute freshness rejects stale success, future age, nonmonotonic input, and heartbeat extension', () => {
  const mutations = [
    (record) => (record.thresholds.currentMaxAgeSeconds = 61),
    (record) => (record.thresholds.staleMaxAgeSeconds = 301),
    (record) => (record.sourcePolicy.freshness.providerHeartbeatCanExtendRiskFreshness = true),
    (record) => (record.sourcePolicy.freshness.staleObservationEligibleForValuation = true),
    (record) => (record.sourcePolicy.freshness.unavailableObservationEligibleForValuation = true),
    (record) => (record.deterministicExamples[7].input.observations[0].freshness = 'CURRENT'),
    (record) => (record.deterministicExamples[0].input.observations[0].ageSeconds = -1),
    (record) => (record.deterministicExamples[0].input.observations[0].monotonic = false),
    (record) => {
      const result = record.deterministicExamples[7].result;
      result.availability = 'AVAILABLE';
      result.usdRateMantissa = '100000000';
      result.usdRateScale = 8;
      result.usdValueMantissa = '10000000000000000000';
      result.usdValueScale = 18;
    },
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`freshness invariant ${index}`, mutate),
  );
});

test('durable replay checkpoints cannot be replaced by timestamps or in-request ordering', () => {
  const mutations = [
    (record) => (record.sourcePolicy.providers[0].sequenceRule = 'PUBLISH_TIME_ONLY'),
    (record) => (record.sourcePolicy.providers[0].sequenceRuleStatus = 'LOCALLY_INFERRED'),
    (record) => (record.sourcePolicy.providers[0].durableCheckpointRequired = false),
    (record) =>
      (record.sourcePolicy.providers[1].sequenceRule = 'LATEST_ROUND_DATA_UPDATED_AT_ONLY'),
    (record) => (record.sourcePolicy.providers[1].durableCheckpointRequired = false),
    (record) => (record.sourcePolicy.freshness.trustedLastAcceptedCheckpointRequired = false),
    (record) => (record.sourcePolicy.freshness.inRequestOrderingAloneSufficient = true),
    (record) => (record.sourcePolicy.freshness.checkpointScope = 'SOURCE_ONLY'),
    (record) =>
      (record.sourcePolicy.freshness.checkpointFields =
        'SEQUENCE_PRICED_AT_UPDATE_ID_WITHOUT_OBSERVED_AT'),
    (record) => (record.sourcePolicy.freshness.checkpointDurability = 'PROCESS_MEMORY_ONLY'),
    (record) =>
      (record.sourcePolicy.freshness.historicalUpdateIdUniqueness =
        'ENFORCED_BY_LAST_ACCEPTED_CHECKPOINT'),
    (record) =>
      record.gates[0].requiredEvidence.splice(
        record.gates[0].requiredEvidence.indexOf(
          'PINNED_IDENTITIES_DURABLE_UNIQUE_UPDATE_ID_AND_SEQUENCE_TIMESTAMP_CHECKPOINT',
        ),
        1,
      ),
    (record) =>
      record.undocumentedOrUnverified.splice(
        record.undocumentedOrUnverified.indexOf(
          'EXACT_PROVIDER_SEQUENCE_SEMANTICS_DURABLE_UNIQUE_UPDATE_ID_HISTORY_AND_LAST_ACCEPTED_WATERMARK',
        ),
        1,
      ),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`durable checkpoint invariant ${index}`, mutate),
  );
});

test('fractional basis-point boundaries have no integer-wording gaps', () => {
  const { classifyScaleEightDivergenceUnits, classifyScaleEightDownsideRate } =
    VALUATION_VALIDATOR_TEST_HOOKS;
  assert.equal(classifyScaleEightDivergenceUnits('250000'), 'CORROBORATED');
  assert.equal(classifyScaleEightDivergenceUnits('250001'), 'SOFT_DISAGREEMENT');
  assert.equal(classifyScaleEightDivergenceUnits('500000'), 'SOFT_DISAGREEMENT');
  assert.equal(classifyScaleEightDivergenceUnits('500001'), 'SOURCE_CONFLICT');
  assert.equal(classifyScaleEightDownsideRate('99500000'), 'NORMAL');
  assert.equal(classifyScaleEightDownsideRate('99499999'), 'WATCH');
  assert.equal(classifyScaleEightDownsideRate('98000001'), 'WATCH');
  assert.equal(classifyScaleEightDownsideRate('98000000'), 'DEPEGGED');
  assert.equal(classifyScaleEightDivergenceUnits('2.5'), 'INVALID');

  const mutations = [
    (record) => (record.sourcePolicy.agreement.softDisagreementRule = 'DIVERGENCE_26_TO_50_BPS'),
    (record) => (record.sourcePolicy.agreement.sourceConflictRule = 'DIVERGENCE_51_BPS_OR_MORE'),
    (record) => (record.sourcePolicy.depeg.watchRule = 'DOWNSIDE_51_TO_199_BPS'),
    (record) =>
      (record.sourcePolicy.confidence.lowRule = 'ONE_CURRENT_SOURCE_OR_DIVERGENCE_26_TO_50_BPS'),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`fractional boundary wording ${index}`, mutate),
  );
});

test('confidence and source independence cannot be promoted or silently correlated', () => {
  const mutations = [
    (record) => (record.selection.architecture = 'DUAL_INDEPENDENT_ORACLE_VALUATION'),
    (record) => (record.selection.independenceStatus = 'VERIFIED_INDEPENDENT'),
    (record) => (record.sourcePolicy.providerOrder[1] = 'PYTH_CORE'),
    (record) => (record.sourcePolicy.providers[1].provider = 'PYTH_CORE'),
    (record) => (record.sourcePolicy.confidence.highClassPermitted = true),
    (record) => (record.thresholds.pythMaximumConfidenceBps = 100),
    (record) =>
      (record.deterministicExamples[0].input.observations[1].confidence.kind =
        'PUBLISHED_ABSOLUTE_USD'),
    (record) => (record.deterministicExamples[4].result.confidenceClass = 'MEDIUM'),
    (record) => (record.deterministicExamples[5].result.confidenceClass = 'HIGH'),
    (record) =>
      (record.deterministicExamples[0].input.observations[0].confidence.mantissa = '500001'),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`confidence or independence ${index}`, mutate),
  );
});

test('single-source fallback stays conservative LOW reporting and cannot increase buying power', () => {
  const mutations = [
    (record) => (record.selection.primaryProvider = 'CHAINLINK_DATA_FEEDS'),
    (record) => (record.deterministicExamples[5].result.selection = 'CONSERVATIVE_MINIMUM'),
    (record) => (record.deterministicExamples[5].result.confidenceClass = 'MEDIUM'),
    (record) => (record.deterministicExamples[5].result.mayIncreaseBuyingPower = true),
    (record) => (record.deterministicExamples[4].result.confidenceClass = 'MEDIUM'),
    (record) => (record.sourcePolicy.financialAuthorization.singleSourceFutureUse = 'ALLOWED'),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`fallback downgrade ${index}`, mutate),
  );
});

test('integer arithmetic, half-even output, scale, and overflow ceilings are closed', () => {
  const canonical = loadDecision();
  assert.equal(canonical.deterministicExamples[0].result.usdValueMantissa, '9998000000000000000');
  assert.equal(canonical.thresholds.valueScale, 18);
  const mutations = [
    (record) => (record.deterministicExamples[0].amountAtomic = '0'.repeat(2)),
    (record) => (record.deterministicExamples[0].amountAtomic = '9'.repeat(79)),
    (record) => (record.deterministicExamples[0].input.observations[0].priceMantissa = '1e8'),
    (record) => (record.deterministicExamples[0].input.observations[0].priceMantissa = '-1'),
    (record) => (record.deterministicExamples[0].input.observations[0].priceScale = 37),
    (record) => (record.deterministicExamples[0].assetDecimals = 37),
    (record) => (record.deterministicExamples[0].result.usdValueMantissa = '9998000000000000001'),
    (record) => (record.deterministicExamples[0].result.usdValueScale = 17),
    (record) => (record.sourcePolicy.valuation.arithmetic = 'FLOATING_POINT'),
    (record) => (record.thresholds.rateScale = 18),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`numeric safety ${index}`, mutate));
});

test('depeg conflict alarm and repeg hysteresis remain latched and manual', () => {
  const mutations = [
    (record) => (record.thresholds.normalMaximumDownsideBps = 100),
    (record) => (record.thresholds.depeggedMinimumDownsideBps = 300),
    (record) => (record.sourcePolicy.recovery.automaticRepeg = true),
    (record) => (record.sourcePolicy.recovery.requiredDistinctObservations = 3),
    (record) => (record.sourcePolicy.recovery.requiredMinimumSpanSeconds = 1799),
    (record) => (record.sourcePolicy.recovery.manualRiskClearRequired = false),
    (record) => (record.sourcePolicy.recovery.sampleEvaluatedAtMustBeStrictlyMonotonic = false),
    (record) => (record.sourcePolicy.recovery.sourceSequenceMustStrictlyIncrease = false),
    (record) => (record.sourcePolicy.recovery.sourceUpdateIdMustBeUniqueAcrossWindow = false),
    (record) => (record.sourcePolicy.recovery.sourceTimestampsMustBeNonRegressing = false),
    (record) => (record.sourcePolicy.recovery.depegLatchReferenceShape = 'BOOLEAN_LATCH'),
    (record) => (record.sourcePolicy.recovery.trustedRecoveryEvaluatedAtRequired = false),
    (record) => (record.sourcePolicy.recovery.allEvidenceAtOrAfterLatch = false),
    (record) =>
      (record.sourcePolicy.recovery.allLatchEvidenceAndClearTimesAtOrBeforeEvaluation = false),
    (record) => (record.sourcePolicy.recovery.manualRiskClearReferenceShape = 'BOOLEAN_CLEAR'),
    (record) => (record.sourcePolicy.recovery.manualRiskClearMustFollowFinalSample = false),
    (record) =>
      (record.sourcePolicy.recovery.durableLatchClearPersistenceAuthentication = 'IMPLEMENTED'),
    (record) =>
      (record.sourcePolicy.recovery.statusWhenAutomatedPredicatesFail =
        'MANUAL_RISK_CLEAR_REQUIRED'),
    (record) =>
      (record.sourcePolicy.recovery.statusWhenPredicatesPassWithoutManualClear =
        'RECOVERY_PENDING'),
    (record) => (record.sourcePolicy.recovery.statusAfterManualClear = 'AUTOMATICALLY_CLEARED'),
    (record) => (record.sourcePolicy.recovery.candidateClearAuthorizesFinancialUse = true),
    (record) => (record.deterministicExamples[3].result.depegClass = 'WITHIN_POLICY'),
    (record) => (record.deterministicExamples[6].result.depegClass = 'NOT_ASSESSED'),
    (record) => (record.deterministicExamples[6].result.availability = 'AVAILABLE'),
    (record) => (record.deterministicExamples[8].result.recoveryStatus = 'AUTOMATICALLY_CLEARED'),
    (record) =>
      (record.deterministicExamples[8].input.recoveryObservations[3].elapsedFromFirstSeconds = 1799),
    (record) =>
      (record.deterministicExamples[8].input.recoveryObservations[2].elapsedFromFirstSeconds = 600),
    (record) =>
      (record.deterministicExamples[8].input.recoveryObservations[2].id =
        record.deterministicExamples[8].input.recoveryObservations[1].id),
    (record) => (record.deterministicExamples[8].input.depegLatch.latchId = 'D'.repeat(64)),
    (record) =>
      (record.deterministicExamples[8].input.depegLatch.latchedAt = '2026-08-22T10:30:00.001Z'),
    (record) =>
      (record.deterministicExamples[8].input.depegLatch.latchedAt = '2026-08-22T09:59:58.001Z'),
    (record) =>
      (record.deterministicExamples[8].input.recoveryEvaluatedAt = '2026-08-22T10:29:59.999Z'),
    (record) => (record.deterministicExamples[8].input.depegLatch = null),
    (record) => {
      const input = record.deterministicExamples[8].input;
      input.manualRiskClear = {
        clearId: 'c'.repeat(64),
        latchId: input.depegLatch.latchId,
        clearedAt: input.recoveryEvaluatedAt,
      };
      input.depegLatch = null;
    },
    (record) => {
      const input = record.deterministicExamples[8].input;
      input.manualRiskClear = {
        clearId: input.depegLatch.latchId,
        latchId: input.depegLatch.latchId,
        clearedAt: input.recoveryEvaluatedAt,
      };
    },
    (record) => {
      const input = record.deterministicExamples[8].input;
      input.manualRiskClear = {
        clearId: 'c'.repeat(64),
        latchId: 'e'.repeat(64),
        clearedAt: input.recoveryEvaluatedAt,
      };
    },
    (record) => {
      const input = record.deterministicExamples[8].input;
      input.manualRiskClear = {
        clearId: 'c'.repeat(64),
        latchId: input.depegLatch.latchId,
        clearedAt: '2026-08-22T10:29:59.999Z',
      };
    },
    (record) => {
      const input = record.deterministicExamples[8].input;
      input.manualRiskClear = {
        clearId: 'c'.repeat(64),
        latchId: input.depegLatch.latchId,
        clearedAt: '2026-08-22T10:30:00.001Z',
      };
    },
    (record) => (record.deterministicExamples[8].input.depegLatch.asset = 'USDC'),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`depeg or recovery ${index}`, mutate),
  );
});

test('unavailable never becomes a zero or nominal-dollar financial value', () => {
  const mutations = [
    (record) => (record.sourcePolicy.valuation.nominalOneDollarAssumption = 'ALLOWED'),
    (record) => (record.sourcePolicy.valuation.downsideFloorUsd = '0'),
    (record) => (record.sourcePolicy.unavailableBehavior.newQuote = 'USE_ONE_DOLLAR'),
    (record) => (record.sourcePolicy.unavailableBehavior.buyingPowerIncrease = 'ALLOW'),
    (record) => (record.sourcePolicy.unavailableBehavior.existingDisplay = 'SHOW_AS_CURRENT'),
    (record) => (record.deterministicExamples[7].result.usdRateMantissa = '0'),
    (record) => (record.deterministicExamples[7].result.usdValueMantissa = '0'),
    (record) => (record.deterministicExamples[6].result.usdRateMantissa = '97000000'),
    (record) => (record.deterministicExamples[6].result.selectedSourceId = 'CHAINLINK_DATA_FEEDS'),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`unavailable behavior ${index}`, mutate),
  );
});

test('deterministic examples and exact asset/feed mappings cannot drift', () => {
  const record = loadDecision();
  assert.deepEqual(
    record.deterministicExamples.map(({ id }) => id),
    [
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
    ],
  );
  const mutations = [
    (value) => value.deterministicExamples.pop(),
    (value) => value.deterministicExamples.reverse(),
    (value) => (value.deterministicExamples[0].id = 'HAPPY_PATH'),
    (value) => (value.assetMatrix[0].pythStableFeedId = value.assetMatrix[1].pythStableFeedId),
    (value) => (value.assetMatrix[0].chainlinkEnsSelector = 'usdt-usd.data.eth'),
    (value) =>
      (value.assetMatrix[0].chainlinkContractAddress =
        '0x0000000000000000000000000000000000000000'),
    (value) => (value.assetMatrix[0].chainlinkHeartbeatSeconds = 3600),
    (value) => (value.sourcePolicy.registryBinding.environment = 'TESTNET'),
    (value) => (value.sourcePolicy.registryBinding.testnetStatus = 'APPROVED_FINANCIAL_VALUATION'),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`example or asset mapping ${index}`, mutate),
  );
});

test('approval aliases, gate bypasses, endpoints, credentials, and spend are rejected', () => {
  const canonical = loadDecision();
  assert.deepEqual(
    [
      canonical.approvalBoundary.approvedGitCommit,
      canonical.approvalBoundary.approvedGitTree,
      canonical.approvalBoundary.approvedDecisionPacketSha256,
      canonical.approvalBoundary.approvedRegistryFingerprintSha256,
    ],
    [null, null, null, null],
  );
  const mutations = [
    (record) => (record.externalStatus = 'APPROVED_BY_RISK'),
    (record) => (record.selection.primaryStatus = 'APPROVED'),
    (record) => (record.selection.financialUseStatus = 'APPROVED'),
    (record) => (record.approvalBoundary.approved = true),
    (record) => (record.approvalBoundary.riskPolicyApproval = 'TEAM_ALIAS'),
    (record) => (record.approvalBoundary.plan = 'FREE'),
    (record) => record.approvalBoundary.apiEndpointHostnames.push('api.example.invalid'),
    (record) => record.approvalBoundary.rpcEndpointHostnames.push('rpc.example.invalid'),
    (record) => record.approvalBoundary.credentialReferences.push('credential-ref:unapproved'),
    (record) => (record.approvalBoundary.monthlyCostUsd = 500),
    (record) => (record.approvalBoundary.runtimeActivation = 'ACTIVE'),
    (record) => (record.approvalBoundary.approvedGitCommit = 'a'.repeat(40)),
    (record) => (record.approvalBoundary.approvedGitTree = 'b'.repeat(40)),
    (record) => (record.approvalBoundary.approvedDecisionPacketSha256 = 'c'.repeat(64)),
    (record) =>
      (record.approvalBoundary.approvedRegistryFingerprintSha256 = '5058b141'.padEnd(64, '0')),
    (record) => (record.gates[0].ticket = 'KAN-231'),
    (record) => (record.gates[0].status = 'APPROVED'),
    (record) =>
      record.gates[0].requiredEvidence.splice(
        record.gates[0].requiredEvidence.indexOf(
          'MERGED_GIT_COMMIT_TREE_PACKET_SHA256_AND_KAN_61_FINGERPRINT_BINDING',
        ),
        1,
      ),
    (record) =>
      record.gates[0].requiredEvidence.splice(
        record.gates[0].requiredEvidence.indexOf(
          'DURABLE_ASSET_BOUND_DEPEG_LATCH_AND_AUTHENTICATED_MANUAL_CLEAR_RECORDS',
        ),
        1,
      ),
    (record) => (record.gates[1].status = 'COMPLETE'),
    (record) =>
      record.undocumentedOrUnverified.splice(
        record.undocumentedOrUnverified.indexOf(
          'MERGED_GIT_COMMIT_TREE_AND_EXTERNAL_APPROVAL_PACKET_BINDING',
        ),
        1,
      ),
    (record) =>
      record.undocumentedOrUnverified.splice(
        record.undocumentedOrUnverified.indexOf(
          'NORMAL_WATCH_DEPEG_CONFLICT_UNAVAILABLE_RECOVERY_DURABLE_LATCH_AND_MANUAL_CLEAR_LIVE_EVIDENCE',
        ),
        1,
      ),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`approval boundary ${index}`, mutate),
  );
});

test('source citations are official HTTPS-only and packet text cannot leak secrets or endpoints', () => {
  const record = loadDecision();
  assert.equal(
    record.sourceEvidence.at(-1).url,
    'https://docs.chain.link/data-feeds/selecting-data-feeds',
  );
  const mutations = [
    (value) => (value.sourceEvidence[0].url = 'http://docs.pyth.network/price-feeds/core'),
    (value) => (value.sourceEvidence[0].url = 'https://evil.example/price-feeds/core'),
    (value) =>
      (value.sourceEvidence[0].url = [
        'https://',
        'user',
        '@docs.pyth.network/price-feeds/core',
      ].join('')),
    (value) => (value.sourceEvidence[0].url = 'https://docs.pyth.network/price-feeds/core?key=x'),
    (value) => (value.commercialResearch[0].note = 'https://api.example.invalid/private'),
    (value) => (value.commercialResearch[0].note = 'api_key=abcdefghijklmnop'),
    (value) =>
      (value.commercialResearch[0].note = [
        '-----BEGIN ',
        'PRIVATE KEY----- secret -----END ',
        'PRIVATE KEY-----',
      ].join('')),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`source or secret leakage ${index}`, mutate),
  );
});

test('research evidence has a closed 30-day validity window and rejects future dates', () => {
  assert.deepEqual(validate(loadDecision(), new Date('2026-09-21T23:59:59.999Z')), []);
  assert.ok(
    validate(loadDecision(), new Date('2026-09-22T00:00:00.000Z')).some((error) =>
      error.includes('stale after 30 days'),
    ),
  );
  assert.ok(validate(loadDecision(), new Date('invalid')).length > 0);
  assertMutationRejected('future reviewedOn', (record) => {
    record.sourceEvidence[0].reviewedOn = '2026-08-23';
  });
  assertMutationRejected('stale reviewedOn', (record) => {
    record.sourceEvidence[0].reviewedOn = '2026-01-01';
  });
  assertMutationRejected('fabricated selected plan', (record) => {
    record.commercialResearch[0].selectedPlan = 'STARTER';
  });
});

test('the sidecar rejects byte drift, uppercase, missing LF, aliases, and malformed input', () => {
  const bytes = readFileSync(`${REPOSITORY_ROOT}/${DECISION_PATH}`);
  const sidecar = readFileSync(`${REPOSITORY_ROOT}/${SIDECAR_PATH}`, 'utf8');
  assert.deepEqual(validateValuationDecisionSidecar(bytes, sidecar), []);
  assert.ok(
    validateValuationDecisionSidecar(Buffer.concat([bytes, Buffer.from(' ')]), sidecar).length > 0,
  );
  assert.ok(validateValuationDecisionSidecar(bytes, sidecar.toUpperCase()).length > 0);
  assert.ok(validateValuationDecisionSidecar(bytes, sidecar.trim()).length > 0);
  assert.ok(
    validateValuationDecisionSidecar(bytes, `${sidecar.trim()}  decision.json\n`).length > 0,
  );
  assert.doesNotThrow(() => validateValuationDecisionSidecar(null, null));
  assert.ok(validateValuationDecisionSidecar(null, null).length > 0);
});

test('the closed packet records zero external activity and validator has no network or cost path', () => {
  const record = loadDecision();
  assert.deepEqual(record.zeroCostEvidence, {
    providerAccountsCreated: 0,
    providerTrialsStarted: 0,
    paymentMethodsAdded: 0,
    apiCredentialsIssued: 0,
    rpcCredentialsIssued: 0,
    providerConnectionsOpened: 0,
    marketDataRequestsSent: 0,
    rpcRequestsSent: 0,
    onchainTransactionsSent: 0,
    externalEgressRulesOpened: 0,
    cloudResourcesCreated: 0,
    costIncurredUsd: '0.00',
    liveValidation: 'NOT_RUN',
  });
  const source = readFileSync(
    `${REPOSITORY_ROOT}/infra/valuation/validate-kan-66-stablecoin-valuation-decision.mjs`,
    'utf8',
  );
  for (const forbidden of [
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:dns',
    'node:child_process',
    'fetch(',
    'new WebSocket',
    '@pythnetwork',
    '@chainlink',
    '@aws-sdk',
  ]) {
    assert.equal(source.includes(forbidden), false, `validator must not contain ${forbidden}`);
  }
  assertMutationRejected('fabricated request', (value) => {
    value.zeroCostEvidence.marketDataRequestsSent = 1;
  });
  assertMutationRejected('fabricated zero cost', (value) => {
    value.zeroCostEvidence.costIncurredUsd = '500.00';
  });
});
