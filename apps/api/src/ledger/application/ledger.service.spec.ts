import { loggingContext } from '../../infrastructure/logging';
import {
  parseLedgerActorAccountId,
  parseLedgerJournalId,
  type PostLedgerJournalCommand,
  type PostLedgerJournalInput,
  type ReverseLedgerJournalCommand,
  type ReverseLedgerJournalInput,
} from '../domain/ledger';
import type { LedgerActorResolver } from './ledger-actor-resolver.port';
import {
  createLedgerCapability,
  type LedgerPostingCapability,
  type LedgerPostingCapabilityRequest,
  type LedgerReversalCapability,
  type LedgerReversalCapabilityRequest,
  type LedgerCapabilityResolver,
} from './ledger-capability-resolver.port';
import type { LedgerRepository } from './ledger.repository.port';
import { LedgerCommandContextError, LedgerService } from './ledger.service';

const ids = {
  actor: '00000000-0000-4000-8000-000000000001',
  otherActor: '00000000-0000-4000-8000-000000000002',
  correlation: '00000000-0000-4000-8000-000000000003',
  book: '00000000-0000-4000-8000-000000000004',
  transaction: '00000000-0000-4000-8000-000000000005',
  leg: '00000000-0000-4000-8000-000000000006',
  asset: '00000000-0000-4000-8000-000000000007',
  debitAccount: '00000000-0000-4000-8000-000000000008',
  creditAccount: '00000000-0000-4000-8000-000000000009',
  originalJournal: '00000000-0000-4000-8000-00000000000a',
  postedJournal: '00000000-0000-4000-8000-00000000000b',
  reversalJournal: '00000000-0000-4000-8000-00000000000c',
} as const;

const POST_CAPABILITY_VALUE = '00'.repeat(32);
const REVERSAL_CAPABILITY_VALUE = '11'.repeat(32);

const postInput: PostLedgerJournalInput = {
  bookId: ids.book,
  transactionId: ids.transaction,
  legId: ids.leg,
  economicEventType: 'SETTLEMENT',
  effectiveAt: new Date('2026-08-21T12:00:00.000Z'),
  observedAt: new Date('2026-08-21T12:00:01.000Z'),
  reason: 'CHAIN_FINALITY_CONFIRMED',
  postings: [
    {
      accountId: ids.debitAccount,
      assetRevisionId: ids.asset,
      side: 'DEBIT',
      amountAtomic: '9007199254740993',
    },
    {
      accountId: ids.creditAccount,
      assetRevisionId: ids.asset,
      side: 'CREDIT',
      amountAtomic: '9007199254740993',
    },
  ],
};

const reversalInput: ReverseLedgerJournalInput = {
  originalJournalId: ids.originalJournal,
  reason: 'RECOGNITION_INVALIDATED',
  effectiveAt: new Date('2026-08-21T12:01:00.000Z'),
  observedAt: new Date('2026-08-21T12:01:01.000Z'),
};

function repositoryStub(): jest.Mocked<LedgerRepository> {
  return {
    postJournal: jest.fn<
      ReturnType<LedgerRepository['postJournal']>,
      [PostLedgerJournalCommand, LedgerPostingCapability]
    >(async () => parseLedgerJournalId(ids.postedJournal)),
    reverseJournal: jest.fn<
      ReturnType<LedgerRepository['reverseJournal']>,
      [ReverseLedgerJournalCommand, LedgerReversalCapability]
    >(async () => parseLedgerJournalId(ids.reversalJournal)),
  };
}

function actorResolverStub(actorId: string | null = ids.actor): jest.Mocked<LedgerActorResolver> {
  return {
    resolve: jest
      .fn()
      .mockResolvedValue(actorId === null ? null : parseLedgerActorAccountId(actorId)),
  };
}

function capabilityResolverStub(): jest.Mocked<LedgerCapabilityResolver> {
  return {
    resolvePosting: jest.fn<
      ReturnType<LedgerCapabilityResolver['resolvePosting']>,
      [LedgerPostingCapabilityRequest]
    >(async () => createLedgerCapability('POST', POST_CAPABILITY_VALUE)),
    resolveReversal: jest.fn<
      ReturnType<LedgerCapabilityResolver['resolveReversal']>,
      [LedgerReversalCapabilityRequest]
    >(async () => createLedgerCapability('REVERSE', REVERSAL_CAPABILITY_VALUE)),
  };
}

function serviceWith(
  repository = repositoryStub(),
  actorResolver = actorResolverStub(),
  capabilityResolver = capabilityResolverStub(),
): {
  service: LedgerService;
  repository: jest.Mocked<LedgerRepository>;
  actorResolver: jest.Mocked<LedgerActorResolver>;
  capabilityResolver: jest.Mocked<LedgerCapabilityResolver>;
} {
  return {
    service: new LedgerService(repository, actorResolver, capabilityResolver),
    repository,
    actorResolver,
    capabilityResolver,
  };
}

describe('LedgerService', () => {
  it('posts through a trusted actor and non-serializable scoped capability', async () => {
    const { service, repository, actorResolver, capabilityResolver } = serviceWith();

    const journalId = await loggingContext.run(
      { correlationId: ids.correlation, initiatorActorId: ids.actor },
      () => service.postJournal(postInput),
    );

    expect(journalId).toBe(ids.postedJournal);
    expect(actorResolver.resolve).toHaveBeenCalledTimes(1);
    expect(capabilityResolver.resolvePosting).toHaveBeenCalledWith({
      actorAccountId: ids.actor,
      bookId: ids.book,
      transactionId: ids.transaction,
      legId: ids.leg,
      economicEventType: 'SETTLEMENT',
      reason: 'CHAIN_FINALITY_CONFIRMED',
    });
    expect(repository.postJournal).toHaveBeenCalledTimes(1);
    const [command, capability] = repository.postJournal.mock.calls[0] ?? [];
    expect(command).toEqual({
      correlationId: ids.correlation,
      bookId: ids.book,
      transactionId: ids.transaction,
      legId: ids.leg,
      economicEventType: 'SETTLEMENT',
      effectiveAt: '2026-08-21T12:00:00.000Z',
      observedAt: '2026-08-21T12:00:01.000Z',
      reason: 'CHAIN_FINALITY_CONFIRMED',
      postings: postInput.postings,
    });
    expect(Object.isFrozen(command)).toBe(true);
    expect(JSON.stringify(capability)).toBe('{}');
    expect(JSON.stringify([command, capability])).not.toContain(POST_CAPABILITY_VALUE);
  });

  it('never accepts actor, correlation, or capability overrides in the payload', async () => {
    const { service, repository, capabilityResolver } = serviceWith();
    const forged = {
      ...postInput,
      actorAccountId: ids.otherActor,
      correlationId: ids.otherActor,
      capability: POST_CAPABILITY_VALUE,
    } as unknown as PostLedgerJournalInput;

    await expect(
      loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.actor }, () =>
        service.postJournal(forged),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_LEDGER_JOURNAL' });
    expect(capabilityResolver.resolvePosting).not.toHaveBeenCalled();
    expect(repository.postJournal).not.toHaveBeenCalled();
  });

  it('fails closed without resolver-backed actor, UUID context, or capability', async () => {
    const base = serviceWith();
    await expect(base.service.postJournal(postInput)).rejects.toBeInstanceOf(
      LedgerCommandContextError,
    );
    await expect(
      loggingContext.run({ correlationId: `legacy:${'a'.repeat(64)}` }, () =>
        base.service.postJournal(postInput),
      ),
    ).rejects.toBeInstanceOf(LedgerCommandContextError);

    const missingActor = serviceWith(repositoryStub(), actorResolverStub(null));
    await expect(
      loggingContext.run({ correlationId: ids.correlation }, () =>
        missingActor.service.postJournal(postInput),
      ),
    ).rejects.toBeInstanceOf(LedgerCommandContextError);

    const capabilityResolver = capabilityResolverStub();
    capabilityResolver.resolvePosting.mockResolvedValue(null);
    const missingCapability = serviceWith(
      repositoryStub(),
      actorResolverStub(),
      capabilityResolver,
    );
    await expect(
      loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.actor }, () =>
        missingCapability.service.postJournal(postInput),
      ),
    ).rejects.toBeInstanceOf(LedgerCommandContextError);
    expect(missingCapability.repository.postJournal).not.toHaveBeenCalled();
  });

  it('maps resolver failures to a fixed error without exposing their message or cause', async () => {
    const capabilityResolver = capabilityResolverStub();
    capabilityResolver.resolvePosting.mockRejectedValue(
      new Error(`raw capability ${POST_CAPABILITY_VALUE}`),
    );
    const { service, repository } = serviceWith(
      repositoryStub(),
      actorResolverStub(),
      capabilityResolver,
    );

    let thrown: unknown;
    try {
      await loggingContext.run(
        { correlationId: ids.correlation, initiatorActorId: ids.actor },
        () => service.postJournal(postInput),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new LedgerCommandContextError());
    expect(thrown).not.toHaveProperty('cause');
    expect(String(thrown)).not.toContain(POST_CAPABILITY_VALUE);
    expect(repository.postJournal).not.toHaveBeenCalled();
  });

  it('rejects a spoofed logging actor before capability resolution', async () => {
    const { service, repository, capabilityResolver } = serviceWith();

    await expect(
      loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.otherActor }, () =>
        service.postJournal(postInput),
      ),
    ).rejects.toBeInstanceOf(LedgerCommandContextError);

    expect(capabilityResolver.resolvePosting).not.toHaveBeenCalled();
    expect(repository.postJournal).not.toHaveBeenCalled();
  });

  it('requests a capability-bound exact reversal without caller approval or replacement lines', async () => {
    const { service, repository, capabilityResolver } = serviceWith();

    const reversalJournalId = await loggingContext.run(
      { correlationId: ids.correlation, initiatorActorId: ids.actor },
      () => service.reverseJournal(reversalInput),
    );

    expect(reversalJournalId).toBe(ids.reversalJournal);
    expect(capabilityResolver.resolveReversal).toHaveBeenCalledWith({
      actorAccountId: ids.actor,
      originalJournalId: ids.originalJournal,
      reason: 'RECOGNITION_INVALIDATED',
    });
    expect(repository.reverseJournal).toHaveBeenCalledWith(
      {
        correlationId: ids.correlation,
        originalJournalId: ids.originalJournal,
        reason: 'RECOGNITION_INVALIDATED',
        effectiveAt: '2026-08-21T12:01:00.000Z',
        observedAt: '2026-08-21T12:01:01.000Z',
      },
      expect.any(Object),
    );

    const forged = {
      ...reversalInput,
      approvalReference: ids.otherActor,
      reversalJournalId: ids.otherActor,
      postings: postInput.postings,
      capability: REVERSAL_CAPABILITY_VALUE,
    } as unknown as ReverseLedgerJournalInput;
    await expect(
      loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.actor }, () =>
        service.reverseJournal(forged),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_LEDGER_JOURNAL' });
    expect(repository.reverseJournal).toHaveBeenCalledTimes(1);
  });
});
