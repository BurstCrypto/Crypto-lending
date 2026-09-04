import {
  createDeterministicBalanceSyncJobEnvelope,
  type BalanceSyncJobEnvelope,
} from '../../blockchain-sync/domain/balance-sync';
import { createJobEnvelope, type JobEnvelope } from './job-envelope';
import type { LedgerOutboxLink } from './job-publisher.port';
import {
  assertReviewedOutboxJob,
  REVIEWED_JOB_CONTRACT_POLICY_VERSION,
  REVIEWED_JOB_CONTRACTS,
  ReviewedJobContractPolicyError,
} from './reviewed-job-contract-policy';

const ids = Object.freeze({
  account: '00000000-0000-4000-8000-000000000001',
  wallet: '00000000-0000-4000-8000-000000000002',
  correlation: '00000000-0000-4000-8000-000000000003',
  job: '00000000-0000-4000-8000-000000000004',
  journal: '00000000-0000-4000-8000-000000000005',
  command: '00000000-0000-4000-8000-000000000006',
  submission: '00000000-0000-4000-8000-000000000007',
  operation: '00000000-0000-4000-8000-000000000008',
  transaction: '00000000-0000-4000-8000-000000000009',
  plan: '00000000-0000-4000-8000-000000000010',
  quote: '00000000-0000-4000-8000-000000000011',
});

const occurredAt = '2026-09-04T16:00:00.000Z';

function ledgerJob(): Readonly<{
  destination: 'jobs';
  envelope: JobEnvelope<{ journalId: string; operation: string }>;
  messageAttributes: Readonly<Record<string, string>>;
  ledgerLink: LedgerOutboxLink;
}> {
  return {
    destination: 'jobs',
    envelope: createJobEnvelope(
      'ledger.journal-committed',
      { journalId: ids.journal, operation: 'POST_JOURNAL' },
      {
        id: ids.job,
        occurredAt,
        correlation: { correlationId: ids.correlation, ledgerEventId: ids.journal },
      },
    ),
    messageAttributes: {},
    ledgerLink: { commandId: ids.command, journalId: ids.journal },
  } as const;
}

function yieldJob(): Readonly<{
  destination: 'jobs';
  envelope: JobEnvelope<{
    submissionId: string;
    operationId: string;
    operationType: string;
    ledgerTransactionId: string;
    planReferenceId: string;
    quoteReferenceId: string;
  }>;
  messageAttributes: Readonly<Record<string, string>>;
}> {
  return {
    destination: 'jobs',
    envelope: createJobEnvelope(
      'yield.operation.submit',
      {
        submissionId: ids.submission,
        operationId: ids.operation,
        operationType: 'ALLOCATE',
        ledgerTransactionId: ids.transaction,
        planReferenceId: ids.plan,
        quoteReferenceId: ids.quote,
      },
      {
        id: ids.submission,
        occurredAt,
        correlation: {
          correlationId: ids.correlation,
          transactionId: ids.transaction,
          quoteId: ids.quote,
        },
      },
    ),
    messageAttributes: { operationType: 'ALLOCATE' },
  } as const;
}

function balanceSyncJob(): Readonly<{
  destination: 'jobs';
  envelope: BalanceSyncJobEnvelope;
  messageAttributes: Readonly<Record<string, string>>;
}> {
  return {
    destination: 'jobs',
    envelope: createDeterministicBalanceSyncJobEnvelope(
      {
        schemaVersion: 1,
        accountId: ids.account,
        walletId: ids.wallet,
        networkId: 'eip155:1',
        requiredTier: 'PROVISIONAL',
        cause: 'SCHEDULED',
        attempt: 1,
        rescanFromPosition: null,
      },
      {
        id: ids.job,
        occurredAt,
        correlation: { correlationId: ids.correlation },
      },
    ),
    messageAttributes: {},
  } as const;
}

function expectCode(run: () => void, code: ReviewedJobContractPolicyError['code']): void {
  try {
    run();
    throw new Error('expected reviewed job policy failure');
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewedJobContractPolicyError);
    expect(error).toMatchObject({ code });
  }
}

describe('reviewed persisted-job contract policy', () => {
  it('publishes an immutable, closed catalog and retention review for exactly three contracts', () => {
    expect(REVIEWED_JOB_CONTRACT_POLICY_VERSION).toBe(1);
    expect(REVIEWED_JOB_CONTRACTS.map(({ kind, version }) => `${kind}@${version}`)).toEqual([
      'ledger.journal-committed@1',
      'yield.operation.submit@1',
      'blockchain.balance-sync@1',
    ]);
    expect(REVIEWED_JOB_CONTRACTS.every(({ destination }) => destination === 'jobs')).toBe(true);
    expect(
      REVIEWED_JOB_CONTRACTS.every(
        ({ retentionReview }) =>
          retentionReview === 'OUTBOX_PUBLISHED_7_DAYS_FAILED_30_DAYS_PENDING_UNTIL_SETTLED',
      ),
    ).toBe(true);
    expect(Object.isFrozen(REVIEWED_JOB_CONTRACTS)).toBe(true);
    expect(REVIEWED_JOB_CONTRACTS.every(Object.isFrozen)).toBe(true);
  });

  it('accepts the exact ledger, yield submission, and balance-sync contracts', () => {
    expect(() => assertReviewedOutboxJob(ledgerJob())).not.toThrow();
    expect(() => assertReviewedOutboxJob(yieldJob())).not.toThrow();
    expect(() => assertReviewedOutboxJob(balanceSyncJob())).not.toThrow();
  });

  it('rejects unknown kinds and unreviewed versions', () => {
    expectCode(
      () =>
        assertReviewedOutboxJob({
          destination: 'jobs',
          envelope: createJobEnvelope(
            'future.unreviewed',
            {},
            {
              id: ids.job,
              occurredAt,
              correlation: { correlationId: ids.correlation },
            },
          ),
          messageAttributes: {},
        }),
      'UNREVIEWED_JOB_CONTRACT',
    );
    expectCode(
      () =>
        assertReviewedOutboxJob({
          ...yieldJob(),
          envelope: createJobEnvelope('yield.operation.submit', yieldJob().envelope.payload, {
            id: ids.job,
            version: 2,
            occurredAt,
            correlation: { correlationId: ids.correlation },
          }),
        }),
      'UNREVIEWED_JOB_CONTRACT',
    );
  });

  it('binds every reviewed contract to the jobs destination', () => {
    expectCode(
      () =>
        assertReviewedOutboxJob({
          ...ledgerJob(),
          destination: 'base-queue' as never,
        }),
      'INVALID_REVIEWED_JOB_DESTINATION',
    );
  });

  it('rejects accessor-backed, inherited, and surplus root fields without executing them', () => {
    const envelopeGetter = jest.fn(() => ledgerJob().envelope);
    const accessorRoot = {
      destination: 'jobs',
      messageAttributes: {},
      ledgerLink: ledgerJob().ledgerLink,
    } as Record<string, unknown>;
    Object.defineProperty(accessorRoot, 'envelope', {
      enumerable: true,
      get: envelopeGetter,
    });
    const inheritedRoot = Object.assign(Object.create({ inherited: true }), ledgerJob());
    const surplusRoot = { ...ledgerJob(), [Symbol('hidden')]: 'secret' };

    for (const candidate of [accessorRoot, inheritedRoot, surplusRoot]) {
      expectCode(() => assertReviewedOutboxJob(candidate as never), 'INVALID_REVIEWED_JOB_SHAPE');
    }
    expect(envelopeGetter).not.toHaveBeenCalled();
  });

  it('rejects extra, missing, malformed, and secret-shaped payload fields', () => {
    for (const payload of [
      { ...yieldJob().envelope.payload, privateKey: 'secret' },
      { ...yieldJob().envelope.payload, operationId: 'not-a-uuid' },
      { ...yieldJob().envelope.payload, operationType: 'DEPOSIT' },
      { ...yieldJob().envelope.payload, quoteReferenceId: undefined },
    ]) {
      expectCode(
        () =>
          assertReviewedOutboxJob({
            ...yieldJob(),
            envelope: createJobEnvelope('yield.operation.submit', payload, {
              id: ids.job,
              occurredAt,
              correlation: { correlationId: ids.correlation },
            }),
          }),
        'INVALID_REVIEWED_JOB_PAYLOAD',
      );
    }
  });

  it('requires exact reviewed message attributes and their payload binding', () => {
    for (const messageAttributes of [
      {},
      { operationType: 'WITHDRAW' },
      { operationType: 'ALLOCATE', walletAddress: '0x1234' },
    ]) {
      expectCode(
        () => assertReviewedOutboxJob({ ...yieldJob(), messageAttributes }),
        'INVALID_REVIEWED_JOB_ATTRIBUTES',
      );
    }
    expectCode(
      () => assertReviewedOutboxJob({ ...ledgerJob(), messageAttributes: { diagnostic: 'safe' } }),
      'INVALID_REVIEWED_JOB_ATTRIBUTES',
    );
  });

  it('binds financial payload identifiers to their envelope metadata', () => {
    const ledger = ledgerJob();
    expectCode(
      () =>
        assertReviewedOutboxJob({
          ...ledger,
          envelope: createJobEnvelope('ledger.journal-committed', ledger.envelope.payload, {
            id: ids.job,
            occurredAt,
            correlation: { correlationId: ids.correlation, ledgerEventId: ids.operation },
          }),
        }),
      'INVALID_REVIEWED_JOB_PAYLOAD',
    );

    const submission = yieldJob();
    expectCode(
      () =>
        assertReviewedOutboxJob({
          ...submission,
          envelope: createJobEnvelope('yield.operation.submit', submission.envelope.payload, {
            id: ids.job,
            occurredAt,
            correlation: {
              correlationId: ids.correlation,
              transactionId: ids.transaction,
              quoteId: ids.quote,
            },
          }),
        }),
      'INVALID_REVIEWED_JOB_PAYLOAD',
    );
    expectCode(
      () =>
        assertReviewedOutboxJob({
          ...submission,
          envelope: createJobEnvelope('yield.operation.submit', submission.envelope.payload, {
            id: ids.submission,
            occurredAt,
            correlation: {
              correlationId: ids.correlation,
              transactionId: ids.operation,
              quoteId: ids.quote,
            },
          }),
        }),
      'INVALID_REVIEWED_JOB_PAYLOAD',
    );
  });

  it('requires exact ledger linkage and forbids it on non-ledger contracts', () => {
    const linkedLedgerJob = ledgerJob();
    const unlinkedLedgerJob = {
      destination: linkedLedgerJob.destination,
      envelope: linkedLedgerJob.envelope,
      messageAttributes: linkedLedgerJob.messageAttributes,
    };
    expectCode(
      () => assertReviewedOutboxJob(unlinkedLedgerJob),
      'INVALID_REVIEWED_JOB_LEDGER_LINK',
    );
    expectCode(
      () =>
        assertReviewedOutboxJob({
          ...ledgerJob(),
          ledgerLink: { commandId: ids.command, journalId: ids.operation },
        }),
      'INVALID_REVIEWED_JOB_LEDGER_LINK',
    );
    expectCode(
      () => assertReviewedOutboxJob({ ...yieldJob(), ledgerLink: ledgerJob().ledgerLink }),
      'INVALID_REVIEWED_JOB_LEDGER_LINK',
    );
  });

  it('does not execute accessor-backed payload, attribute, or ledger-link fields', () => {
    const payloadGetter = jest.fn(() => ids.operation);
    const payload = { ...yieldJob().envelope.payload } as Record<string, unknown>;
    Object.defineProperty(payload, 'operationId', { enumerable: true, get: payloadGetter });
    expectCode(
      () =>
        assertReviewedOutboxJob({
          ...yieldJob(),
          envelope: createJobEnvelope('yield.operation.submit', payload, {
            id: ids.job,
            occurredAt,
            correlation: { correlationId: ids.correlation },
          }),
        }),
      'INVALID_REVIEWED_JOB_PAYLOAD',
    );
    expect(payloadGetter).not.toHaveBeenCalled();

    const attributeGetter = jest.fn(() => 'ALLOCATE');
    const attributes = {};
    Object.defineProperty(attributes, 'operationType', {
      enumerable: true,
      get: attributeGetter,
    });
    expectCode(
      () => assertReviewedOutboxJob({ ...yieldJob(), messageAttributes: attributes }),
      'INVALID_REVIEWED_JOB_ATTRIBUTES',
    );
    expect(attributeGetter).not.toHaveBeenCalled();

    const linkGetter = jest.fn(() => ids.command);
    const link = { journalId: ids.journal } as Record<string, unknown>;
    Object.defineProperty(link, 'commandId', { enumerable: true, get: linkGetter });
    expectCode(
      () => assertReviewedOutboxJob({ ...ledgerJob(), ledgerLink: link as never }),
      'INVALID_REVIEWED_JOB_LEDGER_LINK',
    );
    expect(linkGetter).not.toHaveBeenCalled();
  });

  it('keeps balance-sync restricted to its exact chain-aware domain contract', () => {
    const valid = balanceSyncJob();
    for (const payload of [
      { ...valid.envelope.payload, networkId: 'eip155:8453' },
      { ...valid.envelope.payload, accountId: 'not-a-uuid' },
      { ...valid.envelope.payload, cause: 'SCHEDULED', attempt: 2 },
      { ...valid.envelope.payload, walletAddress: '0x1234' },
    ]) {
      expectCode(
        () =>
          assertReviewedOutboxJob({
            ...valid,
            envelope: createJobEnvelope('blockchain.balance-sync', payload, {
              id: ids.job,
              occurredAt,
              correlation: { correlationId: ids.correlation },
            }),
          }),
        'INVALID_REVIEWED_JOB_PAYLOAD',
      );
    }
  });
});
