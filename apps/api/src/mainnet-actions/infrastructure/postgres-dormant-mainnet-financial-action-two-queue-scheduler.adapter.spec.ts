import { readFileSync } from 'node:fs';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import {
  DormantMainnetFinancialActionSchedulerUnavailableError,
  DormantMainnetFinancialActionTwoQueueScheduler,
} from '../application/dormant-mainnet-financial-action-two-queue.scheduler';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_CLAIM_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_PRE_BROADCAST_COMPLETION_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_CLAIM_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_RECONCILIATION_COMPLETION_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_SCHEDULER_VERSION,
  type ClaimDormantMainnetFinancialActionPreBroadcastRequestV1,
  type ClaimDormantMainnetFinancialActionReconciliationRequestV1,
  type CompleteDormantMainnetFinancialActionPreBroadcastRequestV1,
  type CompleteDormantMainnetFinancialActionReconciliationRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-two-queue-scheduler.port';
import * as adapterModule from './postgres-dormant-mainnet-financial-action-two-queue-scheduler.adapter';
import { PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter } from './postgres-dormant-mainnet-financial-action-two-queue-scheduler.adapter';

const NOW = '2026-09-08T12:00:00.000Z';
const COMPLETED_AT = '2026-09-08T12:00:00.050Z';
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_ID = '44444444-4444-4444-8444-444444444444';
const LEASE_MILLISECONDS = 60_000;
const RAW_SIGNED_TRANSACTION = 'raw-signed-material-must-not-cross-the-scheduler-boundary';
const EVM_TRANSACTION_ID = `0x${'d'.repeat(64)}`;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

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

function base58Filled(byte: number, byteLength: number): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const value of new Uint8Array(byteLength).fill(byte)) {
    let carry = value;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return digits
    .reverse()
    .map((digit) => alphabet[digit] ?? '')
    .join('');
}

function queryResult(row: unknown): Readonly<{ rows: readonly unknown[] }> {
  return { rows: [row] };
}

function claimRow(
  queue: 'PRE_BROADCAST' | 'RECONCILIATION' = 'PRE_BROADCAST',
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const reconciliation = queue === 'RECONCILIATION';
  return {
    schedulerVersion: 1,
    jobId: JOB_ID,
    accountId: ACCOUNT_ID,
    intentId: INTENT_ID,
    intentRecordFingerprintSha256: 'a'.repeat(64),
    networkId: 'eip155:1',
    action: 'SUPPLY',
    lifecycleRevision: reconciliation ? '3' : '1',
    lifecycleSnapshotSha256: 'b'.repeat(64),
    lifecycleStage: reconciliation ? 'RECONCILIATION_AMBIGUOUS' : 'PREPARED',
    queue,
    purpose: reconciliation ? 'RECONCILIATION_ADMISSION' : 'PRE_BROADCAST_SAFETY_REVIEW',
    transactionId: reconciliation ? EVM_TRANSACTION_ID : null,
    reconciliationOutcome: reconciliation ? 'UNKNOWN' : null,
    attempt: 1,
    maximumAttempts: reconciliation ? 12 : 3,
    leaseId: LEASE_ID,
    fencingToken: '7',
    claimedAt: NOW,
    leaseExpiresAt: new Date(Date.parse(NOW) + LEASE_MILLISECONDS).toISOString(),
    ...AUTHORITY_DENIAL,
    ...overrides,
  };
}

function completionRow(
  queue: 'PRE_BROADCAST' | 'RECONCILIATION' = 'PRE_BROADCAST',
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    recordOutcome: 'RECORDED',
    completionDisposition:
      queue === 'PRE_BROADCAST' ? 'RELEASE_PRE_BROADCAST_ONLY' : 'RELEASE_RECONCILIATION_ONLY',
    resultingJobStatus: 'READY',
    completedAt: COMPLETED_AT,
    attempt: 1,
    maximumAttempts: queue === 'PRE_BROADCAST' ? 3 : 12,
    ...overrides,
  };
}

function preBroadcastClaimRequest(
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

function reconciliationClaimRequest(
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

function fixture(rows: readonly unknown[]): Readonly<{
  query: jest.Mock;
  adapter: PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter;
}> {
  const query = jest.fn();
  for (const row of rows) query.mockResolvedValueOnce(queryResult(row));
  const adapter = new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
    { queryWithCancellation: query } as unknown as PostgresService,
    LEASE_MILLISECONDS,
  );
  return frozen({ query, adapter });
}

async function directPreBroadcastCompletion(test: ReturnType<typeof fixture>): Promise<
  Readonly<{
    sourceClaimCapability: unknown;
    claimRequest: ClaimDormantMainnetFinancialActionPreBroadcastRequestV1;
    request: CompleteDormantMainnetFinancialActionPreBroadcastRequestV1;
    completionCapability: unknown;
  }>
> {
  const claimRequest = preBroadcastClaimRequest();
  const sourceClaimCapability = await test.adapter.claimPreBroadcast(claimRequest);
  expect(test.adapter.reviewPreBroadcastClaim(sourceClaimCapability, claimRequest)).not.toBeNull();
  const request = preBroadcastCompletionRequest(frozen({ outerClaim: true }), claimRequest);
  const completionCapability = await test.adapter.completePreBroadcast(
    sourceClaimCapability,
    claimRequest,
    request,
  );
  return frozen({ sourceClaimCapability, claimRequest, request, completionCapability });
}

describe('PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter', () => {
  it('returns exact null for an empty queue without issuing a claim or retrying', async () => {
    const query = jest.fn(() => Promise.resolve({ rows: [] }));
    const adapter = new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
      { queryWithCancellation: query } as unknown as PostgresService,
      LEASE_MILLISECONDS,
    );
    const request = preBroadcastClaimRequest();

    await expect(adapter.claimPreBroadcast(request)).resolves.toBeNull();
    expect(adapter.reviewPreBroadcastClaim(null, request)).toBeNull();
    await expect(adapter.claimPreBroadcast(request)).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['undefined result', undefined],
    ['undefined rows', { rows: undefined }],
    ['multiple rows', { rows: [claimRow(), claimRow()] }],
  ])('distinguishes empty queues from malformed %s', async (_name, databaseResult) => {
    const query = jest.fn(() => Promise.resolve(databaseResult));
    const adapter = new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
      { queryWithCancellation: query } as unknown as PostgresService,
      LEASE_MILLISECONDS,
    );
    await expect(adapter.claimPreBroadcast(preBroadcastClaimRequest())).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('persists a DB-owned claim and completion with one fixed cancellable call each', async () => {
    const test = fixture([claimRow(), completionRow()]);
    const completed = await directPreBroadcastCompletion(test);
    const result = test.adapter.reviewPreBroadcastCompletion(
      completed.completionCapability,
      completed.sourceClaimCapability,
      completed.claimRequest,
      completed.request,
    );

    expect(result).toEqual({
      schedulerVersion: 1,
      use: 'DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_SOURCE_COMPLETION_ONLY',
      mayPersist: false,
      ...AUTHORITY_DENIAL,
      recordOutcome: 'RECORDED',
      queue: 'PRE_BROADCAST',
      jobId: JOB_ID,
      accountId: ACCOUNT_ID,
      intentId: INTENT_ID,
      lifecycleRevision: '1',
      lifecycleSnapshotSha256: 'b'.repeat(64),
      attempt: 1,
      maximumAttempts: 3,
      leaseId: LEASE_ID,
      fencingToken: '7',
      requestedDisposition: 'RETRY_PRE_BROADCAST_REVIEW_ONLY',
      completionDisposition: 'RELEASE_PRE_BROADCAST_ONLY',
      resultingJobStatus: 'READY',
      completedAt: COMPLETED_AT,
    });
    expect(test.query).toHaveBeenCalledTimes(2);
    expect(test.query.mock.calls[0]?.[0]).toContain(
      'claim_mainnet_financial_action_scheduler_job_v1($1::text, $2::integer)',
    );
    expect(test.query.mock.calls[0]?.[1]).toEqual(['PRE_BROADCAST', LEASE_MILLISECONDS]);
    expect(test.query.mock.calls[0]?.[2]).toBe(completed.claimRequest.signal);
    expect(test.query.mock.calls[1]?.[0]).toContain(
      'complete_mainnet_financial_action_scheduler_job_v1(',
    );
    expect(test.query.mock.calls[1]?.[1]).toEqual([
      JOB_ID,
      ACCOUNT_ID,
      INTENT_ID,
      'PRE_BROADCAST',
      '1',
      'b'.repeat(64),
      LEASE_ID,
      '7',
      'RETRY_PRE_BROADCAST_REVIEW_ONLY',
    ]);
    expect(test.query.mock.calls[1]?.[2]).toBe(completed.claimRequest.signal);
    expect(
      test.adapter.reviewPreBroadcastCompletion(
        completed.completionCapability,
        completed.sourceClaimCapability,
        completed.claimRequest,
        completed.request,
      ),
    ).toBeNull();
  });

  it('drives the public scheduler from the authenticated database completion timestamp', async () => {
    const test = fixture([claimRow(), completionRow()]);
    const scheduler = new DormantMainnetFinancialActionTwoQueueScheduler(test.adapter, {
      now: () => new Date(NOW),
    });
    const claimRequest = preBroadcastClaimRequest();
    const claimCapability = await scheduler.claimPreBroadcast(claimRequest);
    const request = preBroadcastCompletionRequest(claimCapability, claimRequest);
    const completionCapability = await scheduler.completePreBroadcast(request);
    const result = scheduler.reviewCompletion(completionCapability, request);

    expect(result).toMatchObject({
      queue: 'PRE_BROADCAST',
      jobId: JOB_ID,
      leaseId: LEASE_ID,
      fencingToken: '7',
      completedAt: COMPLETED_AT,
      completionDisposition: 'RELEASE_PRE_BROADCAST_ONLY',
      nextQueue: 'PRE_BROADCAST',
      ...AUTHORITY_DENIAL,
    });
    expect(test.query).toHaveBeenCalledTimes(2);
  });

  it('keeps Ethereum and Solana transaction-bound work in the reconciliation queue', async () => {
    const solanaTransaction = base58Filled(9, 64);
    for (const row of [
      claimRow('RECONCILIATION'),
      claimRow('RECONCILIATION', {
        networkId: SOLANA,
        transactionId: solanaTransaction,
      }),
    ]) {
      const test = fixture([row, completionRow('RECONCILIATION')]);
      const claimRequest = reconciliationClaimRequest();
      const sourceClaimCapability = await test.adapter.claimReconciliation(claimRequest);
      const claim = test.adapter.reviewReconciliationClaim(sourceClaimCapability, claimRequest);
      expect(claim).toMatchObject({ queue: 'RECONCILIATION' });
      expect(claim?.job).toMatchObject({
        queue: 'RECONCILIATION',
        transactionId: row.transactionId,
        lifecycleStage: 'RECONCILIATION_AMBIGUOUS',
      });
      const request = reconciliationCompletionRequest(frozen({ outerClaim: true }), claimRequest);
      const completionCapability = await test.adapter.completeReconciliation(
        sourceClaimCapability,
        claimRequest,
        request,
      );
      expect(
        test.adapter.reviewReconciliationCompletion(
          completionCapability,
          sourceClaimCapability,
          claimRequest,
          request,
        ),
      ).toMatchObject({
        queue: 'RECONCILIATION',
        completionDisposition: 'RELEASE_RECONCILIATION_ONLY',
      });
      expect(test.query.mock.calls[1]?.[1]).toContain('RECONCILIATION');
    }
  });

  it.each([[999], [900_001], [1.5], [Number.NaN]])(
    'rejects invalid fixed lease duration %p before any query',
    (leaseMilliseconds) => {
      const query = jest.fn();
      expect(
        () =>
          new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
            { queryWithCancellation: query } as unknown as PostgresService,
            leaseMilliseconds,
          ),
      ).toThrow('Dormant mainnet financial-action scheduler persistence is unavailable.');
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['queue', { queue: 'RECONCILIATION' }],
    ['authority', { apiMayBroadcast: true }],
    ['attempt', { attempt: 4 }],
    ['maximum attempts', { maximumAttempts: 12 }],
    ['lease interval', { leaseExpiresAt: '2026-09-08T12:00:59.999Z' }],
    ['zero intent fingerprint', { intentRecordFingerprintSha256: '0'.repeat(64) }],
    ['zero lifecycle fingerprint', { lifecycleSnapshotSha256: '0'.repeat(64) }],
    ['borrow action', { action: 'BORROW' }],
    ['repay action', { action: 'REPAY' }],
    ['extra raw signed material', { signedTransaction: RAW_SIGNED_TRANSACTION }],
  ])('rejects malformed claim %s without a reviewable capability', async (_name, override) => {
    const test = fixture([claimRow('PRE_BROADCAST', override)]);
    let failure: unknown;
    try {
      await test.adapter.claimPreBroadcast(preBroadcastClaimRequest());
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
      message: 'Dormant mainnet financial-action scheduler persistence is unavailable.',
    });
    expect(JSON.stringify(failure)).not.toContain(RAW_SIGNED_TRANSACTION);
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['outcome', { completionDisposition: 'COMPLETED' }],
    ['status', { resultingJobStatus: 'COMPLETED' }],
    ['attempt', { attempt: 2 }],
    ['maximum attempts', { maximumAttempts: 12 }],
    ['timestamp before claim', { completedAt: '2026-09-08T11:59:59.999Z' }],
    ['timestamp at expiry', { completedAt: '2026-09-08T12:01:00.000Z' }],
    ['extra field', { signedTransaction: RAW_SIGNED_TRANSACTION }],
  ])(
    'rejects malformed durable completion %s and consumes the lease locally',
    async (_name, override) => {
      const test = fixture([claimRow(), completionRow('PRE_BROADCAST', override)]);
      const claimRequest = preBroadcastClaimRequest();
      const sourceClaimCapability = await test.adapter.claimPreBroadcast(claimRequest);
      expect(
        test.adapter.reviewPreBroadcastClaim(sourceClaimCapability, claimRequest),
      ).not.toBeNull();
      const request = preBroadcastCompletionRequest(frozen({ outerClaim: true }), claimRequest);
      await expect(
        test.adapter.completePreBroadcast(sourceClaimCapability, claimRequest, request),
      ).rejects.toMatchObject({
        name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
      });
      await expect(
        test.adapter.completePreBroadcast(sourceClaimCapability, claimRequest, request),
      ).rejects.toMatchObject({
        name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
      });
      expect(test.query).toHaveBeenCalledTimes(2);
    },
  );

  it('fails closed on throws, non-native thenables, aborts, proxies, and accessors', async () => {
    const throwingQuery = jest.fn(() => {
      throw new Error(RAW_SIGNED_TRANSACTION);
    });
    const throwing = new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
      { queryWithCancellation: throwingQuery } as unknown as PostgresService,
      LEASE_MILLISECONDS,
    );
    await expect(throwing.claimPreBroadcast(preBroadcastClaimRequest())).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
      message: 'Dormant mainnet financial-action scheduler persistence is unavailable.',
    });

    let thenRead = false;
    const thenableQuery = jest.fn(() =>
      Object.defineProperty({}, 'then', {
        get(): unknown {
          thenRead = true;
          return undefined;
        },
      }),
    );
    const thenable = new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
      { queryWithCancellation: thenableQuery } as unknown as PostgresService,
      LEASE_MILLISECONDS,
    );
    await expect(thenable.claimPreBroadcast(preBroadcastClaimRequest())).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
    });
    expect(thenRead).toBe(false);

    let ownThenRead = false;
    const promiseWithThenAccessor = Object.defineProperty(
      Promise.resolve(queryResult(claimRow())),
      'then',
      {
        get(): unknown {
          ownThenRead = true;
          return undefined;
        },
      },
    );
    const promiseAccessor = new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
      {
        queryWithCancellation: jest.fn(() => promiseWithThenAccessor),
      } as unknown as PostgresService,
      LEASE_MILLISECONDS,
    );
    await expect(
      promiseAccessor.claimPreBroadcast(preBroadcastClaimRequest()),
    ).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
    });
    expect(ownThenRead).toBe(false);

    const controller = new AbortController();
    const abortedQuery = jest.fn(() => {
      controller.abort();
      return Promise.resolve(queryResult(claimRow()));
    });
    const aborted = new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
      { queryWithCancellation: abortedQuery } as unknown as PostgresService,
      LEASE_MILLISECONDS,
    );
    await expect(
      aborted.claimPreBroadcast(preBroadcastClaimRequest(controller.signal)),
    ).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
    });

    let proxyRead = false;
    const proxy = new Proxy(
      { queryWithCancellation: jest.fn() },
      {
        get(target, key, receiver): unknown {
          proxyRead = true;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    expect(
      () =>
        new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
          proxy as unknown as PostgresService,
          LEASE_MILLISECONDS,
        ),
    ).toThrow('Dormant mainnet financial-action scheduler persistence is unavailable.');
    expect(proxyRead).toBe(false);

    let accessorRead = false;
    const accessorRow = Object.defineProperty(claimRow(), 'leaseId', {
      enumerable: true,
      get(): string {
        accessorRead = true;
        return LEASE_ID;
      },
    });
    const accessor = fixture([accessorRow]);
    await expect(
      accessor.adapter.claimPreBroadcast(preBroadcastClaimRequest()),
    ).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
    });
    expect(accessorRead).toBe(false);
  });

  it('treats an unknown completion dispatch as unavailable and leaves recovery to lease expiry', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult(claimRow()))
      .mockRejectedValueOnce(new Error(RAW_SIGNED_TRANSACTION));
    const adapter = new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
      { queryWithCancellation: query } as unknown as PostgresService,
      LEASE_MILLISECONDS,
    );
    const claimRequest = preBroadcastClaimRequest();
    const sourceClaimCapability = await adapter.claimPreBroadcast(claimRequest);
    expect(adapter.reviewPreBroadcastClaim(sourceClaimCapability, claimRequest)).not.toBeNull();
    const request = preBroadcastCompletionRequest(frozen({ outerClaim: true }), claimRequest);

    let failure: unknown;
    try {
      await adapter.completePreBroadcast(sourceClaimCapability, claimRequest, request);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
      message: 'Dormant mainnet financial-action scheduler persistence is unavailable.',
    });
    expect(JSON.stringify(failure)).not.toContain(RAW_SIGNED_TRANSACTION);
    await expect(
      adapter.completePreBroadcast(sourceClaimCapability, claimRequest, request),
    ).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('binds every completion review identity and accepts DB replay only through its exact capability', async () => {
    const test = fixture([
      claimRow(),
      completionRow('PRE_BROADCAST', { recordOutcome: 'REPLAYED' }),
    ]);
    const completed = await directPreBroadcastCompletion(test);
    const wrongRequest = preBroadcastCompletionRequest(
      completed.request.claimCapability,
      completed.claimRequest,
    );
    expect(
      test.adapter.reviewPreBroadcastCompletion(
        completed.completionCapability,
        completed.sourceClaimCapability,
        completed.claimRequest,
        wrongRequest,
      ),
    ).toBeNull();
    expect(
      test.adapter.reviewPreBroadcastCompletion(
        completed.completionCapability,
        completed.sourceClaimCapability,
        completed.claimRequest,
        completed.request,
      ),
    ).toBeNull();

    const accepted = fixture([
      claimRow(),
      completionRow('PRE_BROADCAST', { recordOutcome: 'REPLAYED' }),
    ]);
    const exact = await directPreBroadcastCompletion(accepted);
    expect(
      accepted.adapter.reviewPreBroadcastCompletion(
        exact.completionCapability,
        exact.sourceClaimCapability,
        exact.claimRequest,
        exact.request,
      ),
    ).toMatchObject({ recordOutcome: 'REPLAYED' });
  });

  it('uses opaque capabilities once and never queries for forged or replayed requests', async () => {
    const test = fixture([claimRow(), completionRow()]);
    const claimRequest = preBroadcastClaimRequest();
    const sourceClaimCapability = await test.adapter.claimPreBroadcast(claimRequest);
    expect(Object.keys(sourceClaimCapability as object)).toEqual([]);
    expect(
      test.adapter.reviewPreBroadcastClaim(sourceClaimCapability, claimRequest),
    ).not.toBeNull();
    expect(test.adapter.reviewPreBroadcastClaim(sourceClaimCapability, claimRequest)).toBeNull();
    await expect(test.adapter.claimPreBroadcast(claimRequest)).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
    });

    const clonedClaimRequest = frozen({ ...claimRequest });
    const forgedCompletion = preBroadcastCompletionRequest(
      frozen({ outerClaim: true }),
      clonedClaimRequest,
    );
    await expect(
      test.adapter.completePreBroadcast(sourceClaimCapability, claimRequest, forgedCompletion),
    ).rejects.toMatchObject({
      name: 'PostgresDormantMainnetFinancialActionSchedulerUnavailableError',
    });
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('has no registration, transport, timer, signer, broadcaster, or raw material path', () => {
    expect(Object.keys(adapterModule)).toEqual([
      'PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter',
    ]);
    const source = readFileSync(__filename.replace(/\.spec\.ts$/u, '.ts'), 'utf8');
    expect(source).not.toMatch(/@Injectable|setTimeout|setInterval|fetch\(|axios|signTransaction/u);
    expect(source).not.toContain(RAW_SIGNED_TRANSACTION);
    expect(source).toContain('apiMayBroadcast: false');
    expect(source).toContain('mayResubmitTransaction: false');
    expect(source).toContain('ledgerSettlementAuthority: false');
  });

  it('maps source failures to the scheduler sanitized boundary without exposing database details', async () => {
    const query = jest.fn(() => Promise.reject(new Error(RAW_SIGNED_TRANSACTION)));
    const adapter = new PostgresDormantMainnetFinancialActionTwoQueueSchedulerAdapter(
      { queryWithCancellation: query } as unknown as PostgresService,
      LEASE_MILLISECONDS,
    );
    const scheduler = new DormantMainnetFinancialActionTwoQueueScheduler(adapter, {
      now: () => new Date(NOW),
    });
    let failure: unknown;
    try {
      await scheduler.claimPreBroadcast(preBroadcastClaimRequest());
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DormantMainnetFinancialActionSchedulerUnavailableError);
    expect(failure).toMatchObject({ code: 'CLAIM_UNAVAILABLE' });
    expect(JSON.stringify(failure)).not.toContain(RAW_SIGNED_TRANSACTION);
  });
});
