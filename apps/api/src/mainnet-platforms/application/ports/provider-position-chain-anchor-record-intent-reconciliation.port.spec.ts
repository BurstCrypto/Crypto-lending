import * as mainnetPlatformsFeature from '../../index';
import * as reconciliationModule from './provider-position-chain-anchor-record-intent-reconciliation.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
  type ProviderPositionChainAnchorRecordIntentReconciliationDeadlineViolationResultV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationIdleResultV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationNotRecordedResultV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationPort,
  type ProviderPositionChainAnchorRecordIntentReconciliationRecordedResultV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationResultV1,
  type ProviderPositionChainAnchorRecordIntentReconciliationUncertainPhase,
  type ProviderPositionChainAnchorRecordIntentState,
  type ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
} from './provider-position-chain-anchor-record-intent-reconciliation.port';

const INTENT_SHA256 = 'a'.repeat(64);
const EVIDENCE_SHA256 = 'b'.repeat(64);
const BINDING_SHA256 = 'c'.repeat(64);
const DEADLINE_AT = '2026-09-05T17:00:05.000Z';
const RECORDED_AT = '2026-09-05T17:00:01.000Z';
const RESOLVED_AT = '2026-09-05T17:00:02.000Z';
const RETRY_NOT_BEFORE = '2026-09-05T17:00:10.000Z';

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
  'reconciliationVersion' | 'use' | 'mayAuthorizeFinancialAction' | 'signal';
type ExpectedIdleKey = 'reconciliationVersion' | 'use' | 'mayAuthorizeFinancialAction' | 'outcome';
type ExpectedRecordedKey =
  | ExpectedIdleKey
  | 'recordIntentFingerprintSha256'
  | 'evidenceFingerprintSha256'
  | 'deadlineBindingSha256'
  | 'producerDeadlineAt'
  | 'evidenceRecordedAt'
  | 'resolvedAt';
type ExpectedNotRecordedKey =
  | ExpectedIdleKey
  | 'recordIntentFingerprintSha256'
  | 'evidenceFingerprintSha256'
  | 'producerDeadlineAt'
  | 'resolvedAt';
type ExpectedDeadlineViolationKey = ExpectedNotRecordedKey | 'evidenceRecordedAt';
type ExpectedDeferredKey =
  | ExpectedIdleKey
  | 'recordIntentFingerprintSha256'
  | 'evidenceFingerprintSha256'
  | 'knownIntentState'
  | 'uncertainPhase'
  | 'retryNotBefore';
type ForbiddenRequestKey =
  | 'recordIntentFingerprintSha256'
  | 'intentId'
  | 'batch'
  | 'batchSize'
  | 'lease'
  | 'leaseDuration'
  | 'leaseToken'
  | 'token'
  | 'candidate'
  | 'database'
  | 'config'
  | 'mayPersist'
  | 'persistence';

type RequestKeysAreExact = ExactKeys<
  ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
  ExpectedRequestKey
>;
type IdleKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorRecordIntentReconciliationIdleResultV1,
  ExpectedIdleKey
>;
type RecordedKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorRecordIntentReconciliationRecordedResultV1,
  ExpectedRecordedKey
>;
type NotRecordedKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorRecordIntentReconciliationNotRecordedResultV1,
  ExpectedNotRecordedKey
>;
type DeadlineViolationKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorRecordIntentReconciliationDeadlineViolationResultV1,
  ExpectedDeadlineViolationKey
>;
type DeferredKeysAreExact = ExactKeys<
  ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1,
  ExpectedDeferredKey
>;
type OutcomeIsExact = ExactKeys<
  Record<ProviderPositionChainAnchorRecordIntentReconciliationResultV1['outcome'], true>,
  'IDLE' | 'RECORDED' | 'NOT_RECORDED' | 'DEADLINE_VIOLATION' | 'DEFERRED'
>;
type IntentStateIsExact = ExactType<
  ProviderPositionChainAnchorRecordIntentState,
  'NEW' | 'RECORD_DISPATCHED' | 'UNKNOWN'
>;
type UncertainPhaseIsExact = ExactType<
  ProviderPositionChainAnchorRecordIntentReconciliationUncertainPhase,
  'LEASE_RECONCILIATION' | 'RECONCILE_RECORD'
>;
type DeferredIntentFingerprintIsExact = ExactType<
  ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1['recordIntentFingerprintSha256'],
  string | null
>;
type DeferredEvidenceFingerprintIsExact = ExactType<
  ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1['evidenceFingerprintSha256'],
  string | null
>;
type DeferredKnownStateIsExact = ExactType<
  ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1['knownIntentState'],
  ProviderPositionChainAnchorRecordIntentState | null
>;
type DeferredRetryAtIsExact = ExactType<
  ProviderPositionChainAnchorRecordIntentReconciliationDeferredResultV1['retryNotBefore'],
  string | null
>;
type DeadlineViolationRecordedAtIsExact = ExactType<
  ProviderPositionChainAnchorRecordIntentReconciliationDeadlineViolationResultV1['evidenceRecordedAt'],
  string
>;
type RequestHasForbiddenKey =
  Extract<
    keyof ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
    ForbiddenRequestKey
  > extends never
    ? false
    : true;
type RequestMayAuthorizeIsFalse =
  ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type ResultMayAuthorizeIsFalse =
  ProviderPositionChainAnchorRecordIntentReconciliationResultV1['mayAuthorizeFinancialAction'] extends false
    ? true
    : false;
type ResultHasMayPersist =
  'mayPersist' extends keyof ProviderPositionChainAnchorRecordIntentReconciliationResultV1
    ? true
    : false;
type ReconcileResult = Awaited<
  ReturnType<ProviderPositionChainAnchorRecordIntentReconciliationPort['reconcileNext']>
>;
type ReconcileResultHasStructuralFields = 'outcome' extends keyof ReconcileResult ? true : false;
type ReviewedResult = ReturnType<
  ProviderPositionChainAnchorRecordIntentReconciliationPort['reviewResult']
>;
type ReviewedResultIsExact = [ReviewedResult] extends [
  ProviderPositionChainAnchorRecordIntentReconciliationResultV1 | null,
]
  ? [ProviderPositionChainAnchorRecordIntentReconciliationResultV1 | null] extends [ReviewedResult]
    ? true
    : false
  : false;

const REQUEST_KEYS_ARE_EXACT: RequestKeysAreExact = true;
const IDLE_KEYS_ARE_EXACT: IdleKeysAreExact = true;
const RECORDED_KEYS_ARE_EXACT: RecordedKeysAreExact = true;
const NOT_RECORDED_KEYS_ARE_EXACT: NotRecordedKeysAreExact = true;
const DEADLINE_VIOLATION_KEYS_ARE_EXACT: DeadlineViolationKeysAreExact = true;
const DEFERRED_KEYS_ARE_EXACT: DeferredKeysAreExact = true;
const OUTCOME_IS_EXACT: OutcomeIsExact = true;
const INTENT_STATE_IS_EXACT: IntentStateIsExact = true;
const UNCERTAIN_PHASE_IS_EXACT: UncertainPhaseIsExact = true;
const DEFERRED_INTENT_FINGERPRINT_IS_EXACT: DeferredIntentFingerprintIsExact = true;
const DEFERRED_EVIDENCE_FINGERPRINT_IS_EXACT: DeferredEvidenceFingerprintIsExact = true;
const DEFERRED_KNOWN_STATE_IS_EXACT: DeferredKnownStateIsExact = true;
const DEFERRED_RETRY_AT_IS_EXACT: DeferredRetryAtIsExact = true;
const DEADLINE_VIOLATION_RECORDED_AT_IS_EXACT: DeadlineViolationRecordedAtIsExact = true;
const REQUEST_HAS_FORBIDDEN_KEY: RequestHasForbiddenKey = false;
const REQUEST_MAY_AUTHORIZE_IS_FALSE: RequestMayAuthorizeIsFalse = true;
const RESULT_MAY_AUTHORIZE_IS_FALSE: ResultMayAuthorizeIsFalse = true;
const RESULT_HAS_MAY_PERSIST: ResultHasMayPersist = false;
const RECONCILE_RESULT_HAS_STRUCTURAL_FIELDS: ReconcileResultHasStructuralFields = false;
const REVIEWED_RESULT_IS_EXACT: ReviewedResultIsExact = true;

type FixtureOutcome =
  | ProviderPositionChainAnchorRecordIntentReconciliationResultV1['outcome']
  | 'DEFERRED_AFTER_RECONCILE';

function request(
  signal: AbortSignal,
): ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1 {
  return Object.freeze({
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
    mayAuthorizeFinancialAction: false,
    signal,
  });
}

function resultFor(
  outcome: FixtureOutcome,
): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  const common = {
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
    mayAuthorizeFinancialAction: false,
  } as const;

  switch (outcome) {
    case 'IDLE':
      return Object.freeze({ ...common, outcome });
    case 'RECORDED':
      return Object.freeze({
        ...common,
        outcome,
        recordIntentFingerprintSha256: INTENT_SHA256,
        evidenceFingerprintSha256: EVIDENCE_SHA256,
        deadlineBindingSha256: BINDING_SHA256,
        producerDeadlineAt: DEADLINE_AT,
        evidenceRecordedAt: RECORDED_AT,
        resolvedAt: RESOLVED_AT,
      });
    case 'NOT_RECORDED':
      return Object.freeze({
        ...common,
        outcome,
        recordIntentFingerprintSha256: INTENT_SHA256,
        evidenceFingerprintSha256: EVIDENCE_SHA256,
        producerDeadlineAt: DEADLINE_AT,
        resolvedAt: RESOLVED_AT,
      });
    case 'DEADLINE_VIOLATION':
      return Object.freeze({
        ...common,
        outcome,
        recordIntentFingerprintSha256: INTENT_SHA256,
        evidenceFingerprintSha256: EVIDENCE_SHA256,
        producerDeadlineAt: DEADLINE_AT,
        evidenceRecordedAt: RECORDED_AT,
        resolvedAt: RESOLVED_AT,
      });
    case 'DEFERRED':
      return Object.freeze({
        ...common,
        outcome,
        recordIntentFingerprintSha256: null,
        evidenceFingerprintSha256: null,
        knownIntentState: null,
        uncertainPhase: 'LEASE_RECONCILIATION',
        retryNotBefore: null,
      });
    case 'DEFERRED_AFTER_RECONCILE':
      return Object.freeze({
        ...common,
        outcome: 'DEFERRED',
        recordIntentFingerprintSha256: INTENT_SHA256,
        evidenceFingerprintSha256: EVIDENCE_SHA256,
        knownIntentState: 'UNKNOWN',
        uncertainPhase: 'RECONCILE_RECORD',
        retryNotBefore: RETRY_NOT_BEFORE,
      });
  }
}

describe('ProviderPositionChainAnchorRecordIntentReconciliationPort', () => {
  it('is an exact source-only dormant boundary with no caller selection or persistence fields', () => {
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION).toBe(1);
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ONLY',
    );
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_ONLY',
    );
    expect(REQUEST_KEYS_ARE_EXACT).toBe(true);
    expect(IDLE_KEYS_ARE_EXACT).toBe(true);
    expect(RECORDED_KEYS_ARE_EXACT).toBe(true);
    expect(NOT_RECORDED_KEYS_ARE_EXACT).toBe(true);
    expect(DEADLINE_VIOLATION_KEYS_ARE_EXACT).toBe(true);
    expect(DEFERRED_KEYS_ARE_EXACT).toBe(true);
    expect(OUTCOME_IS_EXACT).toBe(true);
    expect(INTENT_STATE_IS_EXACT).toBe(true);
    expect(UNCERTAIN_PHASE_IS_EXACT).toBe(true);
    expect(DEFERRED_INTENT_FINGERPRINT_IS_EXACT).toBe(true);
    expect(DEFERRED_EVIDENCE_FINGERPRINT_IS_EXACT).toBe(true);
    expect(DEFERRED_KNOWN_STATE_IS_EXACT).toBe(true);
    expect(DEFERRED_RETRY_AT_IS_EXACT).toBe(true);
    expect(DEADLINE_VIOLATION_RECORDED_AT_IS_EXACT).toBe(true);
    expect(REQUEST_HAS_FORBIDDEN_KEY).toBe(false);
    expect(REQUEST_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(RESULT_MAY_AUTHORIZE_IS_FALSE).toBe(true);
    expect(RESULT_HAS_MAY_PERSIST).toBe(false);
    expect(RECONCILE_RESULT_HAS_STRUCTURAL_FIELDS).toBe(false);
    expect(REVIEWED_RESULT_IS_EXACT).toBe(true);
    expect(Object.keys(reconciliationModule).sort()).toEqual([
      'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION',
    ]);
    expect(mainnetPlatformsFeature).not.toHaveProperty(
      'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION',
    );
  });

  it('authenticates minimum frozen results against the exact genuine-signal request', async () => {
    const issuedResults = new WeakMap<
      object,
      Readonly<{
        request: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1;
        result: ProviderPositionChainAnchorRecordIntentReconciliationResultV1;
      }>
    >();
    let nextOutcome: FixtureOutcome = 'IDLE';
    const reconciliation: ProviderPositionChainAnchorRecordIntentReconciliationPort = Object.freeze(
      {
        reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
        reconcileNext: jest.fn(
          async (
            reconcileRequest: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
          ) => {
            if (
              reconcileRequest.mayAuthorizeFinancialAction !== false ||
              !(reconcileRequest.signal instanceof AbortSignal)
            ) {
              throw new Error('unavailable');
            }
            const result = resultFor(nextOutcome);
            issuedResults.set(result, Object.freeze({ request: reconcileRequest, result }));
            return result;
          },
        ),
        reviewResult: (
          capability: unknown,
          reconcileRequest: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
        ): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 | null => {
          if (typeof capability !== 'object' || capability === null) {
            return null;
          }
          const issued = issuedResults.get(capability);
          return issued?.request === reconcileRequest ? issued.result : null;
        },
      },
    );
    const outcomes: readonly FixtureOutcome[] = Object.freeze([
      'IDLE',
      'RECORDED',
      'NOT_RECORDED',
      'DEADLINE_VIOLATION',
      'DEFERRED',
      'DEFERRED_AFTER_RECONCILE',
    ]);

    for (const outcome of outcomes) {
      nextOutcome = outcome;
      const signal = new AbortController().signal;
      const exactRequest = request(signal);
      const capability = await reconciliation.reconcileNext(exactRequest);
      const reviewed = reconciliation.reviewResult(capability, exactRequest);

      expect(reviewed).toBe(capability);
      expect(reviewed).toEqual(resultFor(outcome));
      expect(Object.isFrozen(exactRequest)).toBe(true);
      expect(Object.isFrozen(reviewed)).toBe(true);
      expect(exactRequest.signal).toBeInstanceOf(AbortSignal);
      expect(exactRequest.signal).toBe(signal);
      expect(Object.keys(exactRequest).sort()).toEqual([
        'mayAuthorizeFinancialAction',
        'reconciliationVersion',
        'signal',
        'use',
      ]);
      expect(reviewed).not.toHaveProperty('mayPersist');
      expect(reviewed).not.toHaveProperty('rawToken');
      expect(reviewed).not.toHaveProperty('leaseToken');
      expect(reconciliation.reviewResult(structuredClone(capability), exactRequest)).toBeNull();
      expect(reconciliation.reviewResult(capability, { ...exactRequest })).toBeNull();
      expect(
        reconciliation.reviewResult(capability, {
          ...exactRequest,
          signal: new AbortController().signal,
        }),
      ).toBeNull();
    }

    await expect(
      reconciliation.reconcileNext(
        request(Object.freeze({ aborted: false }) as unknown as AbortSignal),
      ),
    ).rejects.toThrow('unavailable');
    expect(reconciliation.reconcileNext).toHaveBeenCalledTimes(outcomes.length + 1);
    expect(Object.keys(reconciliation).sort()).toEqual([
      'reconcileNext',
      'reconciliationVersion',
      'reviewResult',
    ]);
    expect(Object.keys(reconciliation)).not.toEqual(
      expect.arrayContaining([
        'authorize',
        'batch',
        'client',
        'database',
        'grant',
        'lease',
        'persist',
        'query',
        'repository',
        'token',
        'writer',
      ]),
    );
  });
});
