import { Inject, Injectable } from '@nestjs/common';

import { loggingContext } from '../../infrastructure/logging';
import {
  normalizePostLedgerJournalCommand,
  normalizePostLedgerJournalInput,
  normalizeReverseLedgerJournalCommand,
  normalizeReverseLedgerJournalInput,
  parseLedgerActorAccountId,
  parseLedgerCorrelationId,
  type LedgerActorAccountId,
  type LedgerCorrelationId,
  type LedgerJournalId,
  type PostLedgerJournalInput,
  type ReverseLedgerJournalInput,
} from '../domain/ledger';
import { LEDGER_ACTOR_RESOLVER, type LedgerActorResolver } from './ledger-actor-resolver.port';
import {
  LEDGER_CAPABILITY_RESOLVER,
  type LedgerCapabilityResolver,
} from './ledger-capability-resolver.port';
import { LEDGER_REPOSITORY, type LedgerRepository } from './ledger.repository.port';

export type LedgerCommandContextCode = 'LEDGER_COMMAND_CONTEXT_REQUIRED';

export class LedgerCommandContextError extends Error {
  readonly code: LedgerCommandContextCode = 'LEDGER_COMMAND_CONTEXT_REQUIRED';

  constructor() {
    super('Ledger command context is unavailable');
    this.name = 'LedgerCommandContextError';
  }
}

async function resolveLedgerContext(actorResolver: LedgerActorResolver): Promise<{
  actorAccountId: LedgerActorAccountId;
  correlationId: LedgerCorrelationId;
}> {
  const context = loggingContext.current();
  try {
    if (!context) throw new LedgerCommandContextError();
    const resolvedActor = await actorResolver.resolve();
    if (!resolvedActor) throw new LedgerCommandContextError();
    const actorAccountId = parseLedgerActorAccountId(resolvedActor);
    if (context.initiatorActorId !== undefined && context.initiatorActorId !== actorAccountId) {
      throw new LedgerCommandContextError();
    }
    return {
      actorAccountId,
      correlationId: parseLedgerCorrelationId(context.correlationId),
    };
  } catch {
    throw new LedgerCommandContextError();
  }
}

@Injectable()
export class LedgerService {
  constructor(
    @Inject(LEDGER_REPOSITORY) private readonly repository: LedgerRepository,
    @Inject(LEDGER_ACTOR_RESOLVER) private readonly actorResolver: LedgerActorResolver,
    @Inject(LEDGER_CAPABILITY_RESOLVER)
    private readonly capabilityResolver: LedgerCapabilityResolver,
  ) {}

  async postJournal(input: PostLedgerJournalInput): Promise<LedgerJournalId> {
    const journal = normalizePostLedgerJournalInput(input);
    const context = await resolveLedgerContext(this.actorResolver);
    let capability;
    try {
      capability = await this.capabilityResolver.resolvePosting(
        Object.freeze({
          actorAccountId: context.actorAccountId,
          bookId: journal.bookId,
          transactionId: journal.transactionId,
          legId: journal.legId,
          economicEventType: journal.economicEventType,
          reason: journal.reason,
        }),
      );
      if (!capability) throw new LedgerCommandContextError();
    } catch {
      throw new LedgerCommandContextError();
    }
    const command = normalizePostLedgerJournalCommand({
      correlationId: context.correlationId,
      ...journal,
    });
    return this.repository.postJournal(command, capability);
  }

  async reverseJournal(input: ReverseLedgerJournalInput): Promise<LedgerJournalId> {
    const reversal = normalizeReverseLedgerJournalInput(input);
    const context = await resolveLedgerContext(this.actorResolver);
    let capability;
    try {
      capability = await this.capabilityResolver.resolveReversal(
        Object.freeze({
          actorAccountId: context.actorAccountId,
          originalJournalId: reversal.originalJournalId,
          reason: reversal.reason,
        }),
      );
      if (!capability) throw new LedgerCommandContextError();
    } catch {
      throw new LedgerCommandContextError();
    }
    const command = normalizeReverseLedgerJournalCommand({
      correlationId: context.correlationId,
      ...reversal,
    });
    return this.repository.reverseJournal(command, capability);
  }
}
