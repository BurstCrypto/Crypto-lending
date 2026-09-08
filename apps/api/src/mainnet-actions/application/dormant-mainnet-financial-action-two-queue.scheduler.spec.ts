import * as schedulerModule from './dormant-mainnet-financial-action-two-queue.scheduler';
import * as schedulerPortModule from './ports/dormant-mainnet-financial-action-two-queue-scheduler.port';
import {
  DormantMainnetFinancialActionSchedulerUnavailableError,
  DormantMainnetFinancialActionTwoQueueScheduler,
  type DormantMainnetFinancialActionSchedulerFailureCode,
} from './dormant-mainnet-financial-action-two-queue.scheduler';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY,
  DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE,
  type ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  type ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  type CompleteDormantMainnetFinancialActionPreBroadcastRequestV1,
  type CompleteDormantMainnetFinancialActionReconciliationRequestV1,
  type DormantMainnetFinancialActionPreBroadcastJobV1,
  type DormantMainnetFinancialActionPreBroadcastSourceClaimV1,
  type DormantMainnetFinancialActionReconciliationJobV1,
  type DormantMainnetFinancialActionReconciliationSourceClaimV1,
  type DormantMainnetFinancialActionSchedulerClock,
  type DormantMainnetFinancialActionTwoQueueClaimSourcePort,
} from './ports/dormant-mainnet-financial-action-two-queue-scheduler.port';

const NOW = '2026-09-08T12:00:00.000Z';
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_ID = '44444444-4444-4444-8444-444444444444';
const TRANSACTION_ID = `0x${'d'.repeat(64)}`;
const RAW_SIGNED_TRANSACTION = 'raw-signed-transaction-must-never-escape';

const AUTHORITY_DENIAL = Object.freeze({
  mayAuthorizeFinancialAction: false as const,
  mayConstructTransaction: false as const,
  apiMaySign: false as const,
  apiMayBroadcast: false as const,
  mayResubmitTransaction: false as const,
  ledgerSettlementAuthority: false as const,
});

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function isoAfter(milliseconds: number): string {
  return new Date(Date.parse(NOW) + milliseconds).toISOString();
}

class MutableClock implements DormantMainnetFinancialActionSchedulerClock {
  private value = NOW;

  now(): Date {
    return new Date(this.value);
  }

  set(value: string): void {
    this.value = value;
  }
}

function preBroadcastJob(
  overrides: Readonly<Record<string, unknown>> = {},
): DormantMainnetFinancialActionPreBroadcastJobV1 {
  return frozen({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    ...AUTHORITY_DENIAL,
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    intentId: INTENT_ID,
    intentRecordFingerprintSha256: 'a'.repeat(64),
    networkId: 'eip155:1',
    action: 'SUPPLY',
    lifecycleRevision: '1',
    lifecycleSnapshotSha256: 'b'.repeat(64),
    queue: 'PRE_BROADCAST',
    purpose: 'PRE_BROADCAST_SAFETY_REVIEW',
    lifecycleStage: 'PREPARED',
    transactionId: null,
    reconciliationOutcome: null,
    ...overrides,
  }) as DormantMainnetFinancialActionPreBroadcastJobV1;
}

function reconciliationJob(
  overrides: Readonly<Record<string, unknown>> = {},
): DormantMainnetFinancialActionReconciliationJobV1 {
  return frozen({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    ...AUTHORITY_DENIAL,
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    intentId: INTENT_ID,
    intentRecordFingerprintSha256: 'a'.repeat(64),
    networkId: 'eip155:1',
    action: 'SUPPLY',
    lifecycleRevision: '3',
    lifecycleSnapshotSha256: 'b'.repeat(64),
    queue: 'RECONCILIATION',
    purpose: 'RECONCILIATION_ADMISSION',
    lifecycleStage: 'RECONCILIATION_AMBIGUOUS',
    transactionId: TRANSACTION_ID,
    reconciliationOutcome: 'UNKNOWN',
    ...overrides,
  }) as DormantMainnetFinancialActionReconciliationJobV1;
}

function preBroadcastSourceClaim(
  job: DormantMainnetFinancialActionPreBroadcastJobV1 = preBroadcastJob(),
  overrides: Readonly<Record<string, unknown>> = {},
): DormantMainnetFinancialActionPreBroadcastSourceClaimV1 {
  return frozen({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE,
    mayPersist: false,
    ...AUTHORITY_DENIAL,
    queue: 'PRE_BROADCAST',
    job,
    attempt: 1,
    leaseId: LEASE_ID,
    fencingToken: '7',
    claimedAt: NOW,
    leaseExpiresAt: isoAfter(5 * 60_000),
    ...overrides,
  }) as DormantMainnetFinancialActionPreBroadcastSourceClaimV1;
}

function reconciliationSourceClaim(
  job: DormantMainnetFinancialActionReconciliationJobV1 = reconciliationJob(),
  overrides: Readonly<Record<string, unknown>> = {},
): DormantMainnetFinancialActionReconciliationSourceClaimV1 {
  return frozen({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE,
    mayPersist: false,
    ...AUTHORITY_DENIAL,
    queue: 'RECONCILIATION',
    job,
    attempt: 1,
    leaseId: LEASE_ID,
    fencingToken: '7',
    claimedAt: NOW,
    leaseExpiresAt: isoAfter(5 * 60_000),
    ...overrides,
  }) as DormantMainnetFinancialActionReconciliationSourceClaimV1;
}

class IssuingSource implements DormantMainnetFinancialActionTwoQueueClaimSourcePort {
  readonly schedulerVersion = DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION;
  preBroadcastClaim: unknown = preBroadcastSourceClaim();
  reconciliationClaim: unknown = reconciliationSourceClaim();
  readonly #issued = new WeakMap<
    object,
    Readonly<{
      queue: 'PRE_BROADCAST' | 'RECONCILIATION';
      request:
        | ClaimDormantMainnetFinancialActionPreBroadcastRequestV1
        | ClaimDormantMainnetFinancialActionReconciliationRequestV1;
    }>
  >();

  claimPreBroadcast(
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): Promise<unknown> {
    const capability = frozen({ sourceClaim: true });
    this.#issued.set(capability, frozen({ queue: 'PRE_BROADCAST', request }));
    return Promise.resolve(capability);
  }

  claimReconciliation(
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown> {
    const capability = frozen({ sourceClaim: true });
    this.#issued.set(capability, frozen({ queue: 'RECONCILIATION', request }));
    return Promise.resolve(capability);
  }

  reviewPreBroadcastClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  ): DormantMainnetFinancialActionPreBroadcastSourceClaimV1 | null {
    if (typeof capability !== 'object' || capability === null) return null;
    const issued = this.#issued.get(capability);
    return issued?.queue === 'PRE_BROADCAST' && issued.request === request
      ? (this.preBroadcastClaim as DormantMainnetFinancialActionPreBroadcastSourceClaimV1)
      : null;
  }

  reviewReconciliationClaim(
    capability: unknown,
    request: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  ): DormantMainnetFinancialActionReconciliationSourceClaimV1 | null {
    if (typeof capability !== 'object' || capability === null) return null;
    const issued = this.#issued.get(capability);
    return issued?.queue === 'RECONCILIATION' && issued.request === request
      ? (this.reconciliationClaim as DormantMainnetFinancialActionReconciliationSourceClaimV1)
      : null;
  }
}

function preBroadcastRequest(
  signal: AbortSignal = new AbortController().signal,
): ClaimDormantMainnetFinancialActionPreBroadcastRequestV1 {
  return frozen({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE,
    mayPersist: false,
    ...AUTHORITY_DENIAL,
    signal,
  });
}

function reconciliationRequest(
  signal: AbortSignal = new AbortController().signal,
): ClaimDormantMainnetFinancialActionReconciliationRequestV1 {
  return frozen({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE,
    mayPersist: false,
    ...AUTHORITY_DENIAL,
    signal,
  });
}

function preBroadcastCompletionRequest(
  claimCapability: unknown,
  claimRequest: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  overrides: Readonly<Record<string, unknown>> = {},
): CompleteDormantMainnetFinancialActionPreBroadcastRequestV1 {
  return frozen({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_USE,
    mayPersist: false,
    ...AUTHORITY_DENIAL,
    claimCapability,
    claimRequest,
    signal: claimRequest.signal,
    disposition: 'RETRY_PRE_BROADCAST_REVIEW_ONLY',
    ...overrides,
  }) as CompleteDormantMainnetFinancialActionPreBroadcastRequestV1;
}

function reconciliationCompletionRequest(
  claimCapability: unknown,
  claimRequest: ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  overrides: Readonly<Record<string, unknown>> = {},
): CompleteDormantMainnetFinancialActionReconciliationRequestV1 {
  return frozen({
    schedulerVersion: DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_USE,
    mayPersist: false,
    ...AUTHORITY_DENIAL,
    claimCapability,
    claimRequest,
    signal: claimRequest.signal,
    disposition: 'RETRY_RECONCILIATION_ONLY',
    ...overrides,
  }) as CompleteDormantMainnetFinancialActionReconciliationRequestV1;
}

function schedulerFixture(source: IssuingSource = new IssuingSource()): Readonly<{
  source: IssuingSource;
  clock: MutableClock;
  scheduler: DormantMainnetFinancialActionTwoQueueScheduler;
}> {
  const clock = new MutableClock();
  return frozen({
    source,
    clock,
    scheduler: new DormantMainnetFinancialActionTwoQueueScheduler(source, clock),
  });
}

async function expectFailure(
  promise: Promise<unknown>,
  code: DormantMainnetFinancialActionSchedulerFailureCode,
): Promise<void> {
  await expect(promise).rejects.toEqual(
    expect.objectContaining({
      name: 'DormantMainnetFinancialActionSchedulerUnavailableError',
      code,
      message: 'Dormant mainnet financial-action scheduled work is unavailable.',
    }),
  );
}

describe('DormantMainnetFinancialActionTwoQueueScheduler', () => {
  it('issues an opaque pre-broadcast lease and completes it once without gaining authority', async () => {
    const { scheduler } = schedulerFixture();
    const claimRequest = preBroadcastRequest();
    const claimCapability = await scheduler.claimPreBroadcast(claimRequest);
    const claim = scheduler.reviewPreBroadcastClaim(claimCapability, claimRequest);

    expect(claim).toMatchObject({
      ...AUTHORITY_DENIAL,
      mayPersist: false,
      queue: 'PRE_BROADCAST',
      attempt: 1,
      maximumAttempts: 3,
      leaseId: LEASE_ID,
      fencingToken: '7',
      claimedAt: NOW,
      leaseExpiresAt: isoAfter(5 * 60_000),
    });
    expect(Object.keys(claimCapability as object).sort()).toEqual([
      'apiMayBroadcast',
      'apiMaySign',
      'ledgerSettlementAuthority',
      'mayAuthorizeFinancialAction',
      'mayConstructTransaction',
      'mayPersist',
      'mayResubmitTransaction',
      'schedulerVersion',
      'use',
    ]);

    const completionRequest = preBroadcastCompletionRequest(claimCapability, claimRequest);
    const completionCapability = await scheduler.completePreBroadcast(completionRequest);
    const result = scheduler.reviewCompletion(completionCapability, completionRequest);
    expect(result).toMatchObject({
      ...AUTHORITY_DENIAL,
      mayPersist: false,
      queue: 'PRE_BROADCAST',
      jobId: JOB_ID,
      accountId: ACCOUNT_ID,
      intentId: INTENT_ID,
      intentRecordFingerprintSha256: 'a'.repeat(64),
      networkId: 'eip155:1',
      action: 'SUPPLY',
      lifecycleRevision: '1',
      lifecycleSnapshotSha256: 'b'.repeat(64),
      lifecycleStage: 'PREPARED',
      purpose: 'PRE_BROADCAST_SAFETY_REVIEW',
      transactionId: null,
      requestedDisposition: 'RETRY_PRE_BROADCAST_REVIEW_ONLY',
      completionDisposition: 'RELEASE_PRE_BROADCAST_ONLY',
      nextQueue: 'PRE_BROADCAST',
      completedAt: NOW,
    });
    expect(scheduler.reviewCompletion(completionCapability, completionRequest)).toBeNull();
    expect(JSON.stringify(result)).not.toContain(RAW_SIGNED_TRANSACTION);
    await expectFailure(scheduler.completePreBroadcast(completionRequest), 'CLAIM_UNAVAILABLE');
  });

  it('keeps UNKNOWN and every transaction-bound retry in reconciliation only', async () => {
    const source = new IssuingSource();
    source.reconciliationClaim = reconciliationSourceClaim(reconciliationJob(), { attempt: 11 });
    const { scheduler } = schedulerFixture(source);
    const request = reconciliationRequest();
    const claimCapability = await scheduler.claimReconciliation(request);
    const completionRequest = reconciliationCompletionRequest(claimCapability, request);
    const completionCapability = await scheduler.completeReconciliation(completionRequest);
    const result = scheduler.reviewCompletion(completionCapability, completionRequest);

    expect(result).toMatchObject({
      queue: 'RECONCILIATION',
      lifecycleRevision: '3',
      lifecycleStage: 'RECONCILIATION_AMBIGUOUS',
      reconciliationOutcome: 'UNKNOWN',
      mayResubmitTransaction: false,
      completionDisposition: 'RELEASE_RECONCILIATION_ONLY',
      nextQueue: 'RECONCILIATION',
    });

    source.reconciliationClaim = reconciliationSourceClaim(reconciliationJob(), { attempt: 12 });
    const finalRequest = reconciliationRequest();
    const finalClaim = await scheduler.claimReconciliation(finalRequest);
    const finalCompletionRequest = reconciliationCompletionRequest(finalClaim, finalRequest);
    const finalCompletion = await scheduler.completeReconciliation(finalCompletionRequest);
    expect(scheduler.reviewCompletion(finalCompletion, finalCompletionRequest)).toMatchObject({
      completionDisposition: 'ATTEMPT_LIMIT_REACHED',
      nextQueue: null,
    });
  });

  it.each([
    reconciliationJob({
      lifecycleRevision: '2',
      lifecycleStage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      purpose: 'POST_FINALITY_REVIEW',
      reconciliationOutcome: null,
    }),
    reconciliationJob({
      lifecycleStage: 'FINALIZED_SUCCESS',
      purpose: 'RECONCILIATION_ADMISSION',
      reconciliationOutcome: 'FINALIZED_SUCCESS',
    }),
    reconciliationJob({ lifecycleStage: 'REORG_QUARANTINED' }),
    reconciliationJob({ lifecycleStage: 'DEEP_REORG_QUARANTINED' }),
    reconciliationJob({ lifecycleStage: 'AUTHORITY_QUARANTINED' }),
  ])('rejects incoherent or quarantined reconciliation job %#', async (job) => {
    const source = new IssuingSource();
    source.reconciliationClaim = reconciliationSourceClaim(job);
    const { scheduler } = schedulerFixture(source);
    await expectFailure(
      scheduler.claimReconciliation(reconciliationRequest()),
      'CLAIM_UNAVAILABLE',
    );
  });

  it.each([
    reconciliationJob({
      lifecycleRevision: '2',
      lifecycleStage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      purpose: 'RECONCILIATION_ADMISSION',
      reconciliationOutcome: null,
    }),
    reconciliationJob({
      lifecycleStage: 'BROADCAST_OUTCOME_AMBIGUOUS',
      reconciliationOutcome: null,
    }),
    reconciliationJob(),
    reconciliationJob({
      lifecycleStage: 'FINALIZED_SUCCESS',
      purpose: 'POST_FINALITY_REVIEW',
      reconciliationOutcome: 'FINALIZED_SUCCESS',
    }),
    reconciliationJob({
      lifecycleStage: 'FINALIZED_FAILURE',
      purpose: 'POST_FINALITY_REVIEW',
      reconciliationOutcome: 'FINALIZED_FAILURE',
    }),
  ])('accepts only the reviewed purpose-to-stage mapping %#', async (job) => {
    const source = new IssuingSource();
    source.reconciliationClaim = reconciliationSourceClaim(job);
    const { scheduler } = schedulerFixture(source);
    const request = reconciliationRequest();
    const capability = await scheduler.claimReconciliation(request);
    expect(scheduler.reviewReconciliationClaim(capability, request)?.job).toBe(job);
  });

  it('will not route signed-bound work through pre-broadcast or back to it on completion', async () => {
    const source = new IssuingSource();
    source.preBroadcastClaim = preBroadcastSourceClaim(
      reconciliationJob({
        lifecycleRevision: '2',
        lifecycleStage: 'WALLET_SIGNED_SUBMISSION_BOUND',
        reconciliationOutcome: null,
      }) as unknown as DormantMainnetFinancialActionPreBroadcastJobV1,
    );
    const { scheduler } = schedulerFixture(source);
    await expectFailure(scheduler.claimPreBroadcast(preBroadcastRequest()), 'CLAIM_UNAVAILABLE');

    const reconciliationClaimRequest = reconciliationRequest();
    const claimCapability = await scheduler.claimReconciliation(reconciliationClaimRequest);
    const crossQueueCompletion = preBroadcastCompletionRequest(
      claimCapability,
      preBroadcastRequest(reconciliationClaimRequest.signal),
    );
    await expectFailure(scheduler.completePreBroadcast(crossQueueCompletion), 'CROSS_QUEUE_CLAIM');
  });

  it.each([
    [1_000, 0, true],
    [15 * 60_000, 0, true],
    [999, 0, false],
    [15 * 60_000 + 1, 0, false],
    [5 * 60_000, 1, false],
  ])(
    'enforces lease interval %dms and claimedAt offset %dms (valid=%s)',
    async (leaseLength, claimedOffset, valid) => {
      const source = new IssuingSource();
      source.preBroadcastClaim = preBroadcastSourceClaim(preBroadcastJob(), {
        claimedAt: isoAfter(claimedOffset),
        leaseExpiresAt: isoAfter(claimedOffset + leaseLength),
      });
      const { scheduler } = schedulerFixture(source);
      const result = scheduler.claimPreBroadcast(preBroadcastRequest());
      if (valid) await expect(result).resolves.toBeDefined();
      else await expectFailure(result, 'CLAIM_EXPIRED');
    },
  );

  it('invalidates expired and aborted claims and consumes before concurrent completion can race', async () => {
    const expiring = schedulerFixture();
    const expiringRequest = preBroadcastRequest();
    const expiringCapability = await expiring.scheduler.claimPreBroadcast(expiringRequest);
    expiring.clock.set(isoAfter(5 * 60_000));
    expect(
      expiring.scheduler.reviewPreBroadcastClaim(expiringCapability, expiringRequest),
    ).toBeNull();

    const expiredCompletion = schedulerFixture();
    const expiredCompletionRequest = preBroadcastRequest();
    const expiredCompletionCapability =
      await expiredCompletion.scheduler.claimPreBroadcast(expiredCompletionRequest);
    expiredCompletion.clock.set(isoAfter(5 * 60_000));
    await expectFailure(
      expiredCompletion.scheduler.completePreBroadcast(
        preBroadcastCompletionRequest(expiredCompletionCapability, expiredCompletionRequest),
      ),
      'CLAIM_EXPIRED',
    );

    const controller = new AbortController();
    const aborted = schedulerFixture();
    const abortedRequest = reconciliationRequest(controller.signal);
    const abortedCapability = await aborted.scheduler.claimReconciliation(abortedRequest);
    controller.abort();
    await expectFailure(
      aborted.scheduler.completeReconciliation(
        reconciliationCompletionRequest(abortedCapability, abortedRequest),
      ),
      'INVALID_REQUEST',
    );

    const racing = schedulerFixture();
    const racingRequest = preBroadcastRequest();
    const racingCapability = await racing.scheduler.claimPreBroadcast(racingRequest);
    const completionRequest = preBroadcastCompletionRequest(racingCapability, racingRequest);
    const outcomes = await Promise.allSettled([
      racing.scheduler.completePreBroadcast(completionRequest),
      racing.scheduler.completePreBroadcast(completionRequest),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);

    const regressed = schedulerFixture();
    const regressedRequest = preBroadcastRequest();
    const regressedCapability = await regressed.scheduler.claimPreBroadcast(regressedRequest);
    const regressedCompletion = preBroadcastCompletionRequest(
      regressedCapability,
      regressedRequest,
    );
    regressed.clock.set(isoAfter(-1));
    await expectFailure(
      regressed.scheduler.completePreBroadcast(regressedCompletion),
      'INVALID_CONFIGURATION',
    );
    await expectFailure(
      regressed.scheduler.completePreBroadcast(regressedCompletion),
      'CLAIM_UNAVAILABLE',
    );
  });

  it('requires the exact native signal, claim request, and authenticated scheduler instance', async () => {
    const first = schedulerFixture();
    const second = schedulerFixture();
    const claimRequest = preBroadcastRequest();
    const claimCapability = await first.scheduler.claimPreBroadcast(claimRequest);

    expect(second.scheduler.reviewPreBroadcastClaim(claimCapability, claimRequest)).toBeNull();
    expect(
      first.scheduler.reviewReconciliationClaim(claimCapability, claimRequest as never),
    ).toBeNull();
    expect(
      first.scheduler.reviewPreBroadcastClaim(structuredClone(claimCapability), claimRequest),
    ).toBeNull();
    await expectFailure(
      first.scheduler.completePreBroadcast(
        preBroadcastCompletionRequest(claimCapability, frozen({ ...claimRequest })),
      ),
      'CLAIM_UNAVAILABLE',
    );
    await expectFailure(
      first.scheduler.completePreBroadcast(
        preBroadcastCompletionRequest(claimCapability, claimRequest, {
          signal: new AbortController().signal,
        }),
      ),
      'INVALID_REQUEST',
    );
    await expectFailure(
      first.scheduler.completePreBroadcast(
        preBroadcastCompletionRequest(claimCapability, claimRequest, {
          signal: frozen({ aborted: false }),
        }),
      ),
      'INVALID_REQUEST',
    );

    const completionCapability = await first.scheduler.completePreBroadcast(
      preBroadcastCompletionRequest(claimCapability, claimRequest),
    );
    expect(
      second.scheduler.reviewCompletion(
        completionCapability,
        preBroadcastCompletionRequest(claimCapability, claimRequest),
      ),
    ).toBeNull();
    expect(
      first.scheduler.reviewCompletion(
        structuredClone(completionCapability),
        preBroadcastCompletionRequest(claimCapability, claimRequest),
      ),
    ).toBeNull();
  });

  it('rejects caller-authored lease fields and raw signed bytes without leaking them', async () => {
    const source = new IssuingSource();
    source.preBroadcastClaim = preBroadcastSourceClaim(
      preBroadcastJob({ signedTransaction: RAW_SIGNED_TRANSACTION }),
    );
    const { scheduler } = schedulerFixture(source);
    const claimRequest = preBroadcastRequest();
    let failure: unknown;
    try {
      await scheduler.claimPreBroadcast(claimRequest);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DormantMainnetFinancialActionSchedulerUnavailableError);
    expect(JSON.stringify(failure)).not.toContain(RAW_SIGNED_TRANSACTION);

    const clean = schedulerFixture();
    const cleanRequest = preBroadcastRequest();
    await expectFailure(
      clean.scheduler.claimPreBroadcast(frozen({ ...cleanRequest, leaseId: LEASE_ID }) as never),
      'INVALID_REQUEST',
    );
    await expectFailure(
      clean.scheduler.claimPreBroadcast(frozen({ ...cleanRequest, claimedAt: NOW }) as never),
      'INVALID_REQUEST',
    );
    const capability = await clean.scheduler.claimPreBroadcast(cleanRequest);
    for (const extra of [
      { leaseId: LEASE_ID },
      { claimedAt: NOW },
      { completedAt: NOW },
      { signedTransaction: RAW_SIGNED_TRANSACTION },
    ]) {
      await expectFailure(
        clean.scheduler.completePreBroadcast(
          preBroadcastCompletionRequest(capability, cleanRequest, extra),
        ),
        'INVALID_REQUEST',
      );
    }
    expect(JSON.stringify(capability)).not.toContain(RAW_SIGNED_TRANSACTION);
  });

  it('fails closed on source proxies, method getters, reviewed getters, and non-native thenables', async () => {
    let proxyRead = false;
    const proxied = new Proxy(new IssuingSource(), {
      get(target, key, receiver): unknown {
        proxyRead = true;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(
      () => new DormantMainnetFinancialActionTwoQueueScheduler(proxied, new MutableClock()),
    ).toThrow(DormantMainnetFinancialActionSchedulerUnavailableError);
    expect(proxyRead).toBe(false);

    let methodGetterRead = false;
    const getterSource = Object.freeze(
      Object.defineProperty({}, 'claimPreBroadcast', {
        configurable: false,
        enumerable: true,
        get(): unknown {
          methodGetterRead = true;
          return undefined;
        },
      }),
    );
    expect(
      () =>
        new DormantMainnetFinancialActionTwoQueueScheduler(
          getterSource as never,
          new MutableClock(),
        ),
    ).toThrow(DormantMainnetFinancialActionSchedulerUnavailableError);
    expect(methodGetterRead).toBe(false);

    const reviewedGetterSource = new IssuingSource();
    let reviewedGetterRead = false;
    reviewedGetterSource.preBroadcastClaim = Object.freeze(
      Object.defineProperty({ ...preBroadcastSourceClaim() }, 'leaseId', {
        configurable: false,
        enumerable: true,
        get(): string {
          reviewedGetterRead = true;
          return LEASE_ID;
        },
      }),
    );
    await expectFailure(
      schedulerFixture(reviewedGetterSource).scheduler.claimPreBroadcast(preBroadcastRequest()),
      'CLAIM_UNAVAILABLE',
    );
    expect(reviewedGetterRead).toBe(false);

    let thenGetterRead = false;
    const thenableSource = new IssuingSource();
    thenableSource.claimPreBroadcast = (() =>
      Object.freeze(
        Object.defineProperty({}, 'then', {
          configurable: false,
          enumerable: true,
          get(): unknown {
            thenGetterRead = true;
            return undefined;
          },
        }),
      )) as never;
    await expectFailure(
      schedulerFixture(thenableSource).scheduler.claimPreBroadcast(preBroadcastRequest()),
      'CLAIM_UNAVAILABLE',
    );
    expect(thenGetterRead).toBe(false);
  });

  it.each([
    [0, 'CLAIM_UNAVAILABLE'],
    [4, 'CLAIM_UNAVAILABLE'],
  ] as const)(
    'rejects pre-broadcast attempt %d beyond the bounded policy',
    async (attempt, code) => {
      const source = new IssuingSource();
      source.preBroadcastClaim = preBroadcastSourceClaim(preBroadcastJob(), { attempt });
      await expectFailure(
        schedulerFixture(source).scheduler.claimPreBroadcast(preBroadcastRequest()),
        code,
      );
    },
  );

  it('exports no runtime provider, transport, timer, repository, or worker registration', () => {
    expect(DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY).toEqual({
      PRE_BROADCAST: { maximumAttempts: 3 },
      RECONCILIATION: { maximumAttempts: 12 },
    });
    expect(Object.isFrozen(DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY)).toBe(true);
    expect(Object.keys(schedulerModule).sort()).toEqual([
      'DormantMainnetFinancialActionSchedulerUnavailableError',
      'DormantMainnetFinancialActionTwoQueueScheduler',
    ]);
    expect(Object.keys(schedulerPortModule).sort()).toEqual([
      'DORMANT_MAINNET_FINANCIAL_ACTION_ATTEMPT_POLICY',
      'DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_CAPABILITY_USE',
      'DORMANT_MAINNET_FINANCIAL_ACTION_CLAIM_VIEW_USE',
      'DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_CAPABILITY_USE',
      'DORMANT_MAINNET_FINANCIAL_ACTION_COMPLETION_RESULT_USE',
      'DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_LEASE_MILLISECONDS',
      'DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE',
      'DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_USE',
      'DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE',
      'DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_USE',
      'DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION',
      'DORMANT_MAINNET_FINANCIAL_ACTION_SOURCE_CLAIM_USE',
    ]);
  });
});
