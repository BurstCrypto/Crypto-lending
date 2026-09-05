import {
  createBalanceSyncRetryEnvelope,
  parseBalanceSyncJobEnvelope,
  type BalanceSyncJobPayload,
} from '../../blockchain-sync/domain/balance-sync';
import { createJobEnvelope, type JobEnvelope } from '../outbox/job-envelope';
import {
  BalanceSyncJobDispatcher,
  ReviewedJobDispatchError,
  ReviewedJobDispatcher,
  parseReviewedConsumerJobEnvelope,
  parseReviewedGenericConsumerJobEnvelope,
  parseBalanceSyncConsumerJobEnvelope,
  type ReviewedJobHandlers,
} from './reviewed-job-dispatcher';

const UUIDS = Object.freeze({
  job: '00000000-0000-4000-8000-000000000001',
  journal: '00000000-0000-4000-8000-000000000002',
  operation: '00000000-0000-4000-8000-000000000003',
  ledger: '00000000-0000-4000-8000-000000000004',
  plan: '00000000-0000-4000-8000-000000000005',
  quote: '00000000-0000-4000-8000-000000000006',
  account: '00000000-0000-4000-8000-000000000007',
  wallet: '00000000-0000-4000-8000-000000000008',
  correlation: '00000000-0000-4000-8000-000000000009',
});

function ledgerJob(): JobEnvelope {
  return createJobEnvelope(
    'ledger.journal-committed',
    { journalId: UUIDS.journal, operation: 'POST_JOURNAL' },
    {
      id: UUIDS.job,
      occurredAt: '2026-09-04T12:00:00.000Z',
      correlation: { correlationId: UUIDS.correlation, ledgerEventId: UUIDS.journal },
    },
  );
}

function yieldJob(): JobEnvelope {
  return createJobEnvelope(
    'yield.operation.submit',
    {
      submissionId: UUIDS.job,
      operationId: UUIDS.operation,
      operationType: 'ALLOCATE',
      ledgerTransactionId: UUIDS.ledger,
      planReferenceId: UUIDS.plan,
      quoteReferenceId: UUIDS.quote,
    },
    {
      id: UUIDS.job,
      occurredAt: '2026-09-04T12:00:00.000Z',
      correlation: {
        correlationId: UUIDS.correlation,
        transactionId: UUIDS.ledger,
        quoteId: UUIDS.quote,
      },
    },
  );
}

function balanceJob(
  networkId = 'eip155:1',
  payloadOverrides: Partial<BalanceSyncJobPayload> = {},
): JobEnvelope {
  return createJobEnvelope(
    'blockchain.balance-sync',
    {
      schemaVersion: 1,
      accountId: UUIDS.account,
      walletId: UUIDS.wallet,
      networkId,
      requiredTier: 'PROVISIONAL',
      cause: 'SCHEDULED',
      attempt: 1,
      rescanFromPosition: null,
      ...payloadOverrides,
    },
    {
      id: UUIDS.job,
      occurredAt: '2026-09-04T12:00:00.000Z',
      correlation: { correlationId: UUIDS.correlation },
    },
  );
}

type MutableMockHandlers = {
  -readonly [Kind in keyof ReviewedJobHandlers]: jest.MockedFunction<ReviewedJobHandlers[Kind]>;
};

function handlers(): MutableMockHandlers {
  return {
    'ledger.journal-committed': jest.fn().mockResolvedValue(undefined),
    'yield.operation.submit': jest.fn().mockResolvedValue(undefined),
  };
}

function expectDispatchCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error('expected dispatch error');
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewedJobDispatchError);
    expect((error as ReviewedJobDispatchError).code).toBe(code);
    expect(String(error)).not.toMatch(/secret|provider-private|database/u);
  }
}

describe('ReviewedJobDispatcher', () => {
  it.each([
    ['ledger.journal-committed', ledgerJob()],
    ['yield.operation.submit', yieldJob()],
  ] as const)('dispatches an exact %s@1 job to only its reviewed handler', async (kind, job) => {
    const configured = handlers();
    const dispatcher = new ReviewedJobDispatcher(configured);

    await dispatcher.dispatch(job);

    for (const [handlerKind, handler] of Object.entries(configured)) {
      expect(handler).toHaveBeenCalledTimes(handlerKind === kind ? 1 : 0);
    }
    const dispatched = configured[kind].mock.calls[0]?.[0];
    expect(dispatched && Object.isFrozen(dispatched)).toBe(true);
    expect(dispatched && Object.isFrozen(dispatched.payload)).toBe(true);
  });

  it('rejects balance traffic before a generic handler can run', async () => {
    const configured = handlers();
    const dispatcher = new ReviewedJobDispatcher(configured);
    await expect(dispatcher.dispatch(balanceJob())).rejects.toMatchObject({
      code: 'UNREVIEWED_JOB',
    });
    expect(configured['ledger.journal-committed']).not.toHaveBeenCalled();
    expect(configured['yield.operation.submit']).not.toHaveBeenCalled();
    expect(() => parseReviewedGenericConsumerJobEnvelope(balanceJob())).toThrow(
      ReviewedJobDispatchError,
    );
  });

  it('dedicates the balance dispatcher to exact balance jobs and rejects all others before invocation', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new BalanceSyncJobDispatcher(handler);
    await dispatcher.dispatch(balanceJob());
    await dispatcher.dispatch(balanceJob('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'));
    await dispatcher.dispatch(
      balanceJob('eip155:1', { cause: 'MANUAL_RECOVERY', rescanFromPosition: '0' }),
    );
    expect(handler).toHaveBeenCalledTimes(3);
    for (const candidate of [ledgerJob(), yieldJob(), { ...balanceJob(), kind: 'unknown' }]) {
      await expect(dispatcher.dispatch(candidate)).rejects.toMatchObject({
        code: 'UNREVIEWED_JOB',
      });
    }
    expect(handler).toHaveBeenCalledTimes(3);
    expect(parseBalanceSyncConsumerJobEnvelope(balanceJob()).kind).toBe('blockchain.balance-sync');
  });

  it('rejects valid abstract retry envelopes before native-redrive handler invocation', async () => {
    const initial = parseBalanceSyncJobEnvelope(balanceJob());
    const secondAttempt = createBalanceSyncRetryEnvelope(initial, '2026-09-04T12:01:00.000Z');
    const thirdAttempt = createBalanceSyncRetryEnvelope(secondAttempt, '2026-09-04T12:02:00.000Z');
    const handler = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new BalanceSyncJobDispatcher(handler);

    for (const candidate of [secondAttempt, thirdAttempt]) {
      expect(parseReviewedConsumerJobEnvelope(candidate)).toMatchObject({
        kind: 'blockchain.balance-sync',
        payload: { cause: 'RETRY', attempt: candidate.payload.attempt },
      });
      expectDispatchCode(() => parseBalanceSyncConsumerJobEnvelope(candidate), 'UNREVIEWED_JOB');
      await expect(dispatcher.dispatch(candidate)).rejects.toMatchObject({
        code: 'UNREVIEWED_JOB',
        message: 'Reviewed job dispatch failed',
      });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a valid later-attempt manual recovery at native-redrive ingress', async () => {
    const candidate = balanceJob('eip155:1', {
      cause: 'MANUAL_RECOVERY',
      attempt: 2,
      rescanFromPosition: '100',
    });
    const parsed = parseReviewedConsumerJobEnvelope(candidate);
    const handler = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new BalanceSyncJobDispatcher(handler);

    expect(parsed).toMatchObject({
      kind: 'blockchain.balance-sync',
      payload: { cause: 'MANUAL_RECOVERY', attempt: 2, rescanFromPosition: '100' },
    });
    expectDispatchCode(() => parseBalanceSyncConsumerJobEnvelope(candidate), 'UNREVIEWED_JOB');
    await expect(dispatcher.dispatch(candidate)).rejects.toMatchObject({
      code: 'UNREVIEWED_JOB',
      message: 'Reviewed job dispatch failed',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects unknown versions, kinds, legacy envelopes, and non-launch networks', () => {
    const exact = ledgerJob();
    const legacy = {
      id: exact.id,
      kind: exact.kind,
      version: exact.version,
      occurredAt: exact.occurredAt,
      payload: exact.payload,
    };
    for (const candidate of [
      { ...exact, version: 2 },
      { ...exact, kind: 'ledger.unknown' },
      legacy,
      balanceJob('eip155:8453'),
    ]) {
      expectDispatchCode(() => parseReviewedConsumerJobEnvelope(candidate), 'UNREVIEWED_JOB');
    }
  });

  it('rejects extra, accessor-bearing, and custom-prototype envelopes without reading accessors', () => {
    let reads = 0;
    const accessor = { ...ledgerJob() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'payload', {
      enumerable: true,
      get: () => {
        reads += 1;
        return { journalId: UUIDS.journal, operation: 'POST_JOURNAL' };
      },
    });
    for (const candidate of [
      { ...ledgerJob(), authorization: 'provider-private-secret' },
      accessor,
      Object.assign(Object.create({ polluted: true }), ledgerJob()),
    ]) {
      expectDispatchCode(() => parseReviewedConsumerJobEnvelope(candidate), 'UNREVIEWED_JOB');
    }
    expect(reads).toBe(0);
  });

  it('rejects malformed payloads and broken envelope-to-correlation bindings', () => {
    const ledger = ledgerJob();
    const submission = yieldJob();
    for (const candidate of [
      {
        ...ledger,
        payload: { ...(ledger.payload as Record<string, unknown>), unexpected: true },
      },
      { ...ledger, correlation: { correlationId: UUIDS.correlation } },
      { ...submission, id: UUIDS.operation },
      {
        ...submission,
        correlation: { correlationId: UUIDS.correlation, transactionId: UUIDS.operation },
      },
      {
        ...balanceJob(),
        payload: { ...(balanceJob().payload as Record<string, unknown>), attempt: 2 },
      },
    ]) {
      expectDispatchCode(() => parseReviewedConsumerJobEnvelope(candidate), 'UNREVIEWED_JOB');
    }
  });

  it('requires an exact all-contract handler registry and never reads accessors', () => {
    const incomplete: Partial<MutableMockHandlers> = handlers();
    delete incomplete['yield.operation.submit'];
    expectDispatchCode(
      () => new ReviewedJobDispatcher(incomplete as ReviewedJobHandlers),
      'INVALID_HANDLER_REGISTRY',
    );

    let reads = 0;
    const accessor = handlers() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'ledger.journal-committed', {
      enumerable: true,
      get: () => {
        reads += 1;
        return jest.fn();
      },
    });
    expectDispatchCode(
      () => new ReviewedJobDispatcher(accessor as unknown as ReviewedJobHandlers),
      'INVALID_HANDLER_REGISTRY',
    );
    expect(reads).toBe(0);
  });

  it('copies the registry and sanitizes handler failures', async () => {
    const configured = handlers();
    const original = configured['ledger.journal-committed'];
    const dispatcher = new ReviewedJobDispatcher(configured);
    configured['ledger.journal-committed'] = jest.fn().mockResolvedValue(undefined);
    original.mockRejectedValueOnce(new Error('provider-private-secret'));

    await expect(dispatcher.dispatch(ledgerJob())).rejects.toMatchObject({
      code: 'JOB_HANDLER_FAILED',
      message: 'Reviewed job dispatch failed',
    });
    expect(configured['ledger.journal-committed']).not.toHaveBeenCalled();
  });
});
