import { loggingContext } from '../../infrastructure/logging';
import {
  parseLedgerActorAccountId,
  parseLedgerJournalId,
  type PostLedgerJournalInput,
  type ReverseLedgerJournalInput,
} from '../domain/ledger';
import type { LedgerActorResolver } from './ledger-actor-resolver.port';
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
  approval: '00000000-0000-4000-8000-00000000000b',
} as const;

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
  approvalReference: ids.approval,
  effectiveAt: new Date('2026-08-21T12:01:00.000Z'),
  observedAt: new Date('2026-08-21T12:01:01.000Z'),
};

function repositoryStub(): jest.Mocked<LedgerRepository> {
  return {
    postJournal: jest.fn(async (command) => command.journalId),
    reverseJournal: jest.fn(async (command) => command.reversalJournalId),
  };
}

function actorResolverStub(actorId: string | null = ids.actor): jest.Mocked<LedgerActorResolver> {
  return {
    resolve: jest
      .fn()
      .mockResolvedValue(actorId === null ? null : parseLedgerActorAccountId(actorId)),
  };
}

describe('LedgerService', () => {
  it('posts with a server-generated ID and actor/correlation from the active trusted context', async () => {
    const repository = repositoryStub();
    const actorResolver = actorResolverStub();
    const service = new LedgerService(repository, actorResolver);

    const journalId = await loggingContext.run(
      {
        correlationId: ids.correlation,
        initiatorActorId: ids.actor,
      },
      () => service.postJournal(postInput),
    );

    expect(parseLedgerJournalId(journalId)).toBe(journalId);
    expect(actorResolver.resolve).toHaveBeenCalledTimes(1);
    expect(repository.postJournal).toHaveBeenCalledTimes(1);
    const command = repository.postJournal.mock.calls[0]?.[0];
    expect(command).toEqual({
      actorAccountId: ids.actor,
      correlationId: ids.correlation,
      journalId,
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
  });

  it('never accepts an actor or correlation override in the journal payload', async () => {
    const repository = repositoryStub();
    const service = new LedgerService(repository, actorResolverStub());
    const forged = {
      ...postInput,
      actorAccountId: ids.otherActor,
      correlationId: ids.otherActor,
    } as unknown as PostLedgerJournalInput;

    await expect(
      loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.actor }, () =>
        service.postJournal(forged),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_LEDGER_JOURNAL' });
    expect(repository.postJournal).not.toHaveBeenCalled();
  });

  it('fails closed without a resolver-backed actor and UUID correlation context', async () => {
    const repository = repositoryStub();
    const service = new LedgerService(repository, actorResolverStub());

    await expect(service.postJournal(postInput)).rejects.toBeInstanceOf(LedgerCommandContextError);
    await expect(
      loggingContext.run({ correlationId: `legacy:${'a'.repeat(64)}` }, () =>
        service.postJournal(postInput),
      ),
    ).rejects.toBeInstanceOf(LedgerCommandContextError);
    const missingActorService = new LedgerService(repository, actorResolverStub(null));
    await expect(
      loggingContext.run({ correlationId: ids.correlation }, () =>
        missingActorService.postJournal(postInput),
      ),
    ).rejects.toBeInstanceOf(LedgerCommandContextError);
    expect(repository.postJournal).not.toHaveBeenCalled();
  });

  it('rejects a spoofed logging actor without allowing it to select the command actor', async () => {
    const repository = repositoryStub();
    const service = new LedgerService(repository, actorResolverStub(ids.actor));

    await expect(
      loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.otherActor }, () =>
        service.postJournal(postInput),
      ),
    ).rejects.toBeInstanceOf(LedgerCommandContextError);

    expect(repository.postJournal).not.toHaveBeenCalled();
  });

  it('accepts an optional logging actor only when it matches the authenticated resolver', async () => {
    const repository = repositoryStub();
    const service = new LedgerService(repository, actorResolverStub(ids.actor));

    await loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.actor }, () =>
      service.postJournal(postInput),
    );

    expect(repository.postJournal).toHaveBeenCalledWith(
      expect.objectContaining({ actorAccountId: ids.actor }),
    );
  });

  it('requests an exact linked reversal without accepting caller-supplied lines or IDs', async () => {
    const repository = repositoryStub();
    const service = new LedgerService(repository, actorResolverStub());

    const reversalJournalId = await loggingContext.run(
      { correlationId: ids.correlation, initiatorActorId: ids.actor },
      () => service.reverseJournal(reversalInput),
    );

    expect(parseLedgerJournalId(reversalJournalId)).toBe(reversalJournalId);
    expect(reversalJournalId).not.toBe(ids.originalJournal);
    expect(repository.reverseJournal).toHaveBeenCalledWith({
      actorAccountId: ids.actor,
      correlationId: ids.correlation,
      reversalJournalId,
      originalJournalId: ids.originalJournal,
      reason: 'RECOGNITION_INVALIDATED',
      approvalReference: ids.approval,
      effectiveAt: '2026-08-21T12:01:00.000Z',
      observedAt: '2026-08-21T12:01:01.000Z',
    });

    const forged = {
      ...reversalInput,
      reversalJournalId: ids.otherActor,
      postings: postInput.postings,
    } as unknown as ReverseLedgerJournalInput;
    await expect(
      loggingContext.run({ correlationId: ids.correlation, initiatorActorId: ids.actor }, () =>
        service.reverseJournal(forged),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_LEDGER_JOURNAL' });
    expect(repository.reverseJournal).toHaveBeenCalledTimes(1);
  });
});
