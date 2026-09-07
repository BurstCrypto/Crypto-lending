import * as mainnetPlatformsFeature from '../../index';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
  type ProduceProviderPositionChainAnchorEvidenceRequestV1,
} from '../dormant-provider-position-chain-anchor-evidence.producer';
import * as evidenceRecorderModule from './provider-position-chain-anchor-evidence-recorder.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
  type ProviderPositionChainAnchorEvidenceDeadlineViolationResultV2,
  type ProviderPositionChainAnchorEvidenceNotRecordedResultV2,
  type ProviderPositionChainAnchorEvidenceRecordedResultV2,
  type ProviderPositionChainAnchorEvidenceReconciliationRequiredResultV2,
  type ProviderPositionChainAnchorEvidenceRecorderPort,
  type ProviderPositionChainAnchorEvidenceRecordKnownIntentState,
  type ProviderPositionChainAnchorEvidenceRecordOutcome,
  type ProviderPositionChainAnchorEvidenceRecordResultV2,
  type ProviderPositionChainAnchorEvidenceRecordUncertainPhase,
  type RecordProviderPositionChainAnchorEvidenceRequestV2,
} from './provider-position-chain-anchor-evidence-recorder.port';

const ETHEREUM_MAINNET = 'eip155:1' as const;
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const INTENT_SHA256 = 'a'.repeat(64);
const EVIDENCE_SHA256 = 'b'.repeat(64);
const BINDING_SHA256 = 'c'.repeat(64);
const DEADLINE_AT = '2026-09-05T17:00:05.000Z';
const RECORDED_AT = '2026-09-05T17:00:01.000Z';
const RESOLVED_AT = '2026-09-05T17:00:02.000Z';

type ExactKeys<T, Expected> = [keyof T] extends [Expected]
  ? [Expected] extends [keyof T]
    ? true
    : false
  : false;
type ExactType<T, Expected> = [T] extends [Expected]
  ? [Expected] extends [T]
    ? true
    : false
  : false;
type ExpectedRequestKey =
  | 'recorderVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'producerCapability'
  | 'producerRequest'
  | 'signal';
type ExpectedRecordedKey =
  | 'recorderVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'producerDeadlineAt'
  | 'outcome'
  | 'recordOutcome'
  | 'recordIntentFingerprintSha256'
  | 'evidenceFingerprintSha256'
  | 'deadlineBindingSha256'
  | 'evidenceRecordedAt'
  | 'resolvedAt';
type ExpectedNotRecordedKey =
  | 'recorderVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'producerDeadlineAt'
  | 'outcome'
  | 'recordIntentFingerprintSha256'
  | 'evidenceFingerprintSha256'
  | 'resolvedAt';
type ExpectedReconciliationRequiredKey =
  | 'recorderVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'producerDeadlineAt'
  | 'outcome'
  | 'recordIntentFingerprintSha256'
  | 'evidenceFingerprintSha256'
  | 'uncertainPhase'
  | 'knownIntentState';
type ExpectedDeadlineViolationKey =
  | 'recorderVersion'
  | 'use'
  | 'mayAuthorizeFinancialAction'
  | 'producerDeadlineAt'
  | 'outcome'
  | 'recordIntentFingerprintSha256'
  | 'evidenceFingerprintSha256'
  | 'evidenceRecordedAt'
  | 'resolvedAt';

type RequestKeysAreExact = ExactKeys<
  RecordProviderPositionChainAnchorEvidenceRequestV2,
  ExpectedRequestKey
>;
type RecordedKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorEvidenceRecordedResultV2,
  ExpectedRecordedKey
>;
type NotRecordedKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorEvidenceNotRecordedResultV2,
  ExpectedNotRecordedKey
>;
type ReconciliationRequiredKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorEvidenceReconciliationRequiredResultV2,
  ExpectedReconciliationRequiredKey
>;
type DeadlineViolationKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorEvidenceDeadlineViolationResultV2,
  ExpectedDeadlineViolationKey
>;
type OutcomeIsExact = ExactKeys<
  Record<ProviderPositionChainAnchorEvidenceRecordResultV2['outcome'], true>,
  'RECORDED' | 'NOT_RECORDED' | 'RECONCILIATION_REQUIRED' | 'DEADLINE_VIOLATION'
>;
type RecordOutcomeIsExact = ExactType<
  ProviderPositionChainAnchorEvidenceRecordOutcome,
  'RECORDED' | 'IDEMPOTENT_REPLAY'
>;
type UncertainPhaseIsExact = ExactType<
  ProviderPositionChainAnchorEvidenceRecordUncertainPhase,
  'PREPARE' | 'CLAIM_DISPATCH' | 'EXECUTE_RECORD' | 'MARK_UNKNOWN'
>;
type KnownIntentStateIsExact = ExactType<
  ProviderPositionChainAnchorEvidenceRecordKnownIntentState,
  'NEW' | 'RECORD_DISPATCHED' | 'UNKNOWN'
>;
type DeadlineViolationRecordedAtIsExact = ExactType<
  ProviderPositionChainAnchorEvidenceDeadlineViolationResultV2['evidenceRecordedAt'],
  string
>;
type RequestMayAuthorizeIsFalse =
  RecordProviderPositionChainAnchorEvidenceRequestV2['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type ResultMayAuthorizeIsFalse =
  ProviderPositionChainAnchorEvidenceRecordResultV2['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type RequestHasMayPersist =
  'mayPersist' extends keyof RecordProviderPositionChainAnchorEvidenceRequestV2 ? true : false;
type ResultHasMayPersist =
  'mayPersist' extends keyof ProviderPositionChainAnchorEvidenceRecordResultV2 ? true : false;
type RequestHasDispatchToken =
  'dispatchToken' extends keyof RecordProviderPositionChainAnchorEvidenceRequestV2 ? true : false;
type RecordResult = Awaited<
  ReturnType<ProviderPositionChainAnchorEvidenceRecorderPort['recordEvidence']>
>;
type RecordResultHasStructuralFields = 'outcome' extends keyof RecordResult ? true : false;
type ReviewedResult = ReturnType<ProviderPositionChainAnchorEvidenceRecorderPort['reviewResult']>;
type ReviewedResultIsExact = [ReviewedResult] extends [
  ProviderPositionChainAnchorEvidenceRecordResultV2 | null,
]
  ? [ProviderPositionChainAnchorEvidenceRecordResultV2 | null] extends [ReviewedResult]
    ? true
    : false
  : false;

const REQUEST_KEYS_ARE_EXACT: RequestKeysAreExact = true;
const RECORDED_KEYS_ARE_EXACT: RecordedKeysAreExact = true;
const NOT_RECORDED_KEYS_ARE_EXACT: NotRecordedKeysAreExact = true;
const RECONCILIATION_REQUIRED_KEYS_ARE_EXACT: ReconciliationRequiredKeysAreExact = true;
const DEADLINE_VIOLATION_KEYS_ARE_EXACT: DeadlineViolationKeysAreExact = true;
const OUTCOME_IS_EXACT: OutcomeIsExact = true;
const RECORD_OUTCOME_IS_EXACT: RecordOutcomeIsExact = true;
const UNCERTAIN_PHASE_IS_EXACT: UncertainPhaseIsExact = true;
const KNOWN_INTENT_STATE_IS_EXACT: KnownIntentStateIsExact = true;
const DEADLINE_VIOLATION_RECORDED_AT_IS_EXACT: DeadlineViolationRecordedAtIsExact = true;
const REQUEST_MAY_AUTHORIZE_IS_FALSE: RequestMayAuthorizeIsFalse = true;
const RESULT_MAY_AUTHORIZE_IS_FALSE: ResultMayAuthorizeIsFalse = true;
const REQUEST_HAS_MAY_PERSIST: RequestHasMayPersist = false;
const RESULT_HAS_MAY_PERSIST: ResultHasMayPersist = false;
const REQUEST_HAS_DISPATCH_TOKEN: RequestHasDispatchToken = false;
const RECORD_RESULT_HAS_STRUCTURAL_FIELDS: RecordResultHasStructuralFields = false;
const REVIEWED_RESULT_IS_EXACT: ReviewedResultIsExact = true;

function producerRequest(
  networkId: typeof ETHEREUM_MAINNET | typeof SOLANA_MAINNET,
  signal: AbortSignal,
): ProduceProviderPositionChainAnchorEvidenceRequestV1 {
  if (networkId === ETHEREUM_MAINNET) {
    return Object.freeze({
      producerVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      networkId,
      sourceFamilyId: 'ethereum-rpc-family-a',
      sourceId: 'ethereum-rpc-primary',
      sourceKind: 'RPC',
      sourceObservationId: 'ethereum-block-50000001',
      continuityFloor: Object.freeze({
        kind: 'EVM_BLOCK',
        blockNumber: '50000000',
        blockHash: `0x${'1'.repeat(64)}`,
      }),
      chainAnchor: Object.freeze({
        kind: 'EVM_BLOCK',
        blockNumber: '50000001',
        blockHash: `0x${'2'.repeat(64)}`,
      }),
      observedAt: '2026-09-05T16:59:50.000Z',
      deadlineAt: DEADLINE_AT,
      signal,
    });
  }
  return Object.freeze({
    producerVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId,
    sourceFamilyId: 'solana-rpc-family-b',
    sourceId: 'solana-rpc-secondary',
    sourceKind: 'RPC',
    sourceObservationId: 'solana-slot-441990796',
    continuityFloor: Object.freeze({
      kind: 'SOLANA_SLOT',
      slot: '441990700',
      root: '441990699',
    }),
    chainAnchor: Object.freeze({
      kind: 'SOLANA_SLOT',
      slot: '441990796',
      root: '441990700',
    }),
    observedAt: '2026-09-05T16:59:55.000Z',
    deadlineAt: DEADLINE_AT,
    signal,
  });
}

function recordRequest(
  producerCapability: unknown,
  originalProducerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1,
): RecordProviderPositionChainAnchorEvidenceRequestV2 {
  return Object.freeze({
    recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
    mayAuthorizeFinancialAction: false,
    producerCapability,
    producerRequest: originalProducerRequest,
    signal: originalProducerRequest.signal,
  });
}

type FixtureOutcome =
  | 'RECORDED'
  | 'IDEMPOTENT_REPLAY'
  | 'NOT_RECORDED'
  | 'RECONCILIATION_REQUIRED'
  | 'DEADLINE_VIOLATION';

function resultFor(outcome: FixtureOutcome): ProviderPositionChainAnchorEvidenceRecordResultV2 {
  const common = {
    recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE,
    mayAuthorizeFinancialAction: false,
    producerDeadlineAt: DEADLINE_AT,
  } as const;

  switch (outcome) {
    case 'RECORDED':
    case 'IDEMPOTENT_REPLAY':
      return Object.freeze({
        ...common,
        outcome: 'RECORDED',
        recordOutcome: outcome,
        recordIntentFingerprintSha256: INTENT_SHA256,
        evidenceFingerprintSha256: EVIDENCE_SHA256,
        deadlineBindingSha256: BINDING_SHA256,
        evidenceRecordedAt: RECORDED_AT,
        resolvedAt: RESOLVED_AT,
      });
    case 'NOT_RECORDED':
      return Object.freeze({
        ...common,
        outcome,
        recordIntentFingerprintSha256: INTENT_SHA256,
        evidenceFingerprintSha256: EVIDENCE_SHA256,
        resolvedAt: RESOLVED_AT,
      });
    case 'RECONCILIATION_REQUIRED':
      return Object.freeze({
        ...common,
        outcome,
        recordIntentFingerprintSha256: null,
        evidenceFingerprintSha256: null,
        uncertainPhase: 'PREPARE',
        knownIntentState: null,
      });
    case 'DEADLINE_VIOLATION':
      return Object.freeze({
        ...common,
        outcome,
        recordIntentFingerprintSha256: INTENT_SHA256,
        evidenceFingerprintSha256: EVIDENCE_SHA256,
        evidenceRecordedAt: RECORDED_AT,
        resolvedAt: RESOLVED_AT,
      });
  }
}

describe('ProviderPositionChainAnchorEvidenceRecorderPort', () => {
  it('is an exact V2 dormant type boundary with no caller persistence authority', () => {
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION).toBe(2);
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ONLY',
    );
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_ONLY',
    );
    expect(REQUEST_KEYS_ARE_EXACT).toBe(true);
    expect(RECORDED_KEYS_ARE_EXACT).toBe(true);
    expect(NOT_RECORDED_KEYS_ARE_EXACT).toBe(true);
    expect(RECONCILIATION_REQUIRED_KEYS_ARE_EXACT).toBe(true);
    expect(DEADLINE_VIOLATION_KEYS_ARE_EXACT).toBe(true);
    expect(OUTCOME_IS_EXACT).toBe(true);
    expect(RECORD_OUTCOME_IS_EXACT).toBe(true);
    expect(UNCERTAIN_PHASE_IS_EXACT).toBe(true);
    expect(KNOWN_INTENT_STATE_IS_EXACT).toBe(true);
    expect(DEADLINE_VIOLATION_RECORDED_AT_IS_EXACT).toBe(true);
    expect(REQUEST_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(RESULT_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(REQUEST_HAS_MAY_PERSIST).toBe(false);
    expect(RESULT_HAS_MAY_PERSIST).toBe(false);
    expect(REQUEST_HAS_DISPATCH_TOKEN).toBe(false);
    expect(RECORD_RESULT_HAS_STRUCTURAL_FIELDS).toBe(false);
    expect(REVIEWED_RESULT_IS_EXACT).toBe(true);
    expect(Object.keys(evidenceRecorderModule).sort()).toEqual([
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE',
    ]);
    expect(mainnetPlatformsFeature).not.toHaveProperty(
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION',
    );
  });

  it('authenticates every opaque result against exact request and signal identities', async () => {
    const issuedProducerRequests = new WeakMap<
      object,
      ProduceProviderPositionChainAnchorEvidenceRequestV1
    >();
    const desiredOutcomes = new WeakMap<object, FixtureOutcome>();
    const issuedResults = new WeakMap<
      object,
      Readonly<{
        request: RecordProviderPositionChainAnchorEvidenceRequestV2;
        result: ProviderPositionChainAnchorEvidenceRecordResultV2;
      }>
    >();
    const recorder: ProviderPositionChainAnchorEvidenceRecorderPort = Object.freeze({
      recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
      recordEvidence: jest.fn(
        async (request: RecordProviderPositionChainAnchorEvidenceRequestV2) => {
          if (
            request.mayAuthorizeFinancialAction !== false ||
            request.signal !== request.producerRequest.signal ||
            typeof request.producerCapability !== 'object' ||
            request.producerCapability === null ||
            issuedProducerRequests.get(request.producerCapability) !== request.producerRequest
          ) {
            throw new Error('unavailable');
          }
          const desiredOutcome = desiredOutcomes.get(request.producerCapability);
          if (desiredOutcome === undefined) {
            throw new Error('unavailable');
          }
          const result = resultFor(desiredOutcome);
          issuedResults.set(result, Object.freeze({ request, result }));
          return result;
        },
      ),
      reviewResult: (
        capability: unknown,
        request: RecordProviderPositionChainAnchorEvidenceRequestV2,
      ): ProviderPositionChainAnchorEvidenceRecordResultV2 | null => {
        if (typeof capability !== 'object' || capability === null) {
          return null;
        }
        const issued = issuedResults.get(capability);
        return issued?.request === request ? issued.result : null;
      },
    });
    const fixtureOutcomes: readonly FixtureOutcome[] = Object.freeze([
      'RECORDED',
      'IDEMPOTENT_REPLAY',
      'NOT_RECORDED',
      'RECONCILIATION_REQUIRED',
      'DEADLINE_VIOLATION',
    ]);

    for (const [index, desiredOutcome] of fixtureOutcomes.entries()) {
      const networkId = index % 2 === 0 ? ETHEREUM_MAINNET : SOLANA_MAINNET;
      const signal = new AbortController().signal;
      const originalProducerRequest = producerRequest(networkId, signal);
      const producerCapability = Object.freeze({ networkId, desiredOutcome });
      issuedProducerRequests.set(producerCapability, originalProducerRequest);
      desiredOutcomes.set(producerCapability, desiredOutcome);
      const request = recordRequest(producerCapability, originalProducerRequest);
      const capability = await recorder.recordEvidence(request);
      const reviewed = recorder.reviewResult(capability, request);

      expect(reviewed).toBe(capability);
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(reviewed)).toBe(true);
      expect(request.signal).toBeInstanceOf(AbortSignal);
      expect(request.producerCapability).toBe(producerCapability);
      expect(request.producerRequest).toBe(originalProducerRequest);
      expect(request.signal).toBe(signal);
      expect(request.signal).toBe(request.producerRequest.signal);
      expect(reviewed).toEqual(resultFor(desiredOutcome));
      expect(reviewed).not.toHaveProperty('mayPersist');
      expect(reviewed).not.toHaveProperty('dispatchToken');
      expect(recorder.reviewResult(structuredClone(capability), request)).toBeNull();
      expect(recorder.reviewResult(capability, { ...request })).toBeNull();
      expect(
        recorder.reviewResult(capability, {
          ...request,
          producerCapability: structuredClone(producerCapability),
        }),
      ).toBeNull();
      expect(
        recorder.reviewResult(capability, {
          ...request,
          producerRequest: { ...originalProducerRequest },
        }),
      ).toBeNull();
      expect(
        recorder.reviewResult(capability, {
          ...request,
          signal: new AbortController().signal,
        }),
      ).toBeNull();
    }

    expect(recorder.recordEvidence).toHaveBeenCalledTimes(fixtureOutcomes.length);
    expect(Object.keys(recorder).sort()).toEqual([
      'recordEvidence',
      'recorderVersion',
      'reviewResult',
    ]);
    expect(Object.keys(recorder)).not.toEqual(
      expect.arrayContaining([
        'authorize',
        'client',
        'database',
        'execute',
        'grant',
        'persist',
        'query',
        'repository',
        'writer',
      ]),
    );
  });
});
