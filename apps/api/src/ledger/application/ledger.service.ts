import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { loggingContext } from '../../infrastructure/logging';
import {
  normalizePostLedgerJournalCommand,
  normalizePostLedgerJournalInput,
  normalizeReverseLedgerJournalCommand,
  normalizeReverseLedgerJournalInput,
  parseLedgerActorAccountId,
  parseLedgerCorrelationId,
  parseLedgerJournalId,
  type LedgerActorAccountId,
  type LedgerCorrelationId,
  type LedgerJournalId,
  type PostLedgerJournalInput,
  type ReverseLedgerJournalInput,
} from '../domain/ledger';
import { LEDGER_ACTOR_RESOLVER, type LedgerActorResolver } from './ledger-actor-resolver.port';
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
  ) {}

  async postJournal(input: PostLedgerJournalInput): Promise<LedgerJournalId> {
    const journal = normalizePostLedgerJournalInput(input);
    const context = await resolveLedgerContext(this.actorResolver);
    const journalId = parseLedgerJournalId(randomUUID());
    const command = normalizePostLedgerJournalCommand({
      ...context,
      journalId,
      ...journal,
    });
    return this.repository.postJournal(command);
  }

  async reverseJournal(input: ReverseLedgerJournalInput): Promise<LedgerJournalId> {
    const reversal = normalizeReverseLedgerJournalInput(input);
    const context = await resolveLedgerContext(this.actorResolver);
    const reversalJournalId = parseLedgerJournalId(randomUUID());
    const command = normalizeReverseLedgerJournalCommand({
      ...context,
      reversalJournalId,
      ...reversal,
    });
    return this.repository.reverseJournal(command);
  }
}
