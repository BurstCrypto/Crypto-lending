import { Inject, Injectable, Optional } from '@nestjs/common';

import { loggingContext } from '../../infrastructure/logging/logging-context';
import { LOG_EVENTS, structuredLogger } from '../../infrastructure/logging/structured-logger';
import {
  applicationObservability,
  OBSERVABILITY_PORT,
  type ObservabilityPort,
  type ObservabilityQuoteState,
  type ObservabilitySpanHandle,
} from '../../infrastructure/observability';
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
import {
  createPostLedgerIdempotencyContext,
  createReverseLedgerIdempotencyContext,
} from '../domain/idempotency';
import {
  normalizeLedgerLifecycleTransitionCommand,
  normalizeLedgerLifecycleTransitionInput,
  normalizeLedgerRecoveryTransitionCommand,
  normalizeLedgerRecoveryTransitionInput,
  type LedgerLifecycleTransitionInput,
  type LedgerRecoveryTransitionInput,
  type ValidatedLedgerLifecycleTransition,
} from '../domain/transaction-lifecycle';
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

function quoteStateForTransition(
  transition: ValidatedLedgerLifecycleTransition,
): ObservabilityQuoteState | undefined {
  switch (transition.reason) {
    case 'INTENT_CREATED':
      return 'CREATED';
    case 'QUOTE_CREATED':
      return 'AVAILABLE';
    case 'USER_APPROVAL_RECORDED':
      return 'SELECTED';
    case 'QUOTE_EXPIRED':
      return 'EXPIRED';
    case 'USER_REJECTED':
      return 'REJECTED';
    case 'PREFLIGHT_FAILED':
      return 'FAILED';
    case 'SUBMISSION_RECORDED':
    case 'OUTCOME_PENDING':
    case 'SETTLEMENT_RECORDED':
    case 'PROVIDER_REJECTED':
    case 'TERMINAL_FAILURE_CONFIRMED':
    case 'FULL_REVERSAL_RECORDED':
      return undefined;
  }
}

function startDiagnosticSpan(
  observability: ObservabilityPort,
): ObservabilitySpanHandle | undefined {
  try {
    return observability.startSpan({
      name: 'execution.transition',
      kind: 'internal',
      synthetic: false,
    });
  } catch {
    return undefined;
  }
}

function recordDiagnostic(work: () => unknown): void {
  try {
    work();
  } catch {
    // A telemetry adapter must never change a financial transition.
  }
}

@Injectable()
export class LedgerService {
  constructor(
    @Inject(LEDGER_REPOSITORY) private readonly repository: LedgerRepository,
    @Inject(LEDGER_ACTOR_RESOLVER) private readonly actorResolver: LedgerActorResolver,
    @Inject(LEDGER_CAPABILITY_RESOLVER)
    private readonly capabilityResolver: LedgerCapabilityResolver,
    @Optional()
    @Inject(OBSERVABILITY_PORT)
    private readonly observability: ObservabilityPort = applicationObservability,
  ) {}

  async postJournal(
    input: PostLedgerJournalInput,
    idempotencyKey: string,
  ): Promise<LedgerJournalId> {
    const journal = normalizePostLedgerJournalInput(input);
    const context = await resolveLedgerContext(this.actorResolver);
    const idempotency = createPostLedgerIdempotencyContext(
      idempotencyKey,
      context.actorAccountId,
      journal,
    );
    const replay = await this.repository.resolveIdempotency(idempotency);
    if (replay) return replay;
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
    return loggingContext.runWith({ transactionId: journal.transactionId }, () =>
      this.repository.postJournal(command, capability, idempotency),
    );
  }

  async reverseJournal(
    input: ReverseLedgerJournalInput,
    idempotencyKey: string,
  ): Promise<LedgerJournalId> {
    const reversal = normalizeReverseLedgerJournalInput(input);
    const context = await resolveLedgerContext(this.actorResolver);
    const idempotency = createReverseLedgerIdempotencyContext(
      idempotencyKey,
      context.actorAccountId,
      reversal,
    );
    const replay = await this.repository.resolveIdempotency(idempotency);
    if (replay) return replay;
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
    return this.repository.reverseJournal(command, capability, idempotency);
  }

  async transitionLifecycle(input: LedgerLifecycleTransitionInput): Promise<void> {
    const transition = normalizeLedgerLifecycleTransitionInput(input);
    const context = await resolveLedgerContext(this.actorResolver);
    const command = normalizeLedgerLifecycleTransitionCommand({
      actorAccountId: context.actorAccountId,
      correlationId: context.correlationId,
      ...transition,
    });
    const span = startDiagnosticSpan(this.observability);
    try {
      await this.repository.transitionLifecycle(command);
    } catch (error) {
      recordDiagnostic(() => span?.end('failure'));
      throw error;
    }
    recordDiagnostic(() => span?.end('success'));
    recordDiagnostic(() =>
      this.observability.recordExecutionState({ state: transition.nextState }),
    );
    const quoteState = quoteStateForTransition(transition);
    if (quoteState) {
      recordDiagnostic(() => this.observability.recordQuoteState({ state: quoteState }));
    }
    structuredLogger.emit(LOG_EVENTS.ledgerLifecycleTransitioned, 'info', {
      lifecycleScope: transition.legId ? 'leg' : 'transaction',
      state: transition.nextState,
      reason: transition.reason,
    });
  }

  async transitionRecovery(input: LedgerRecoveryTransitionInput): Promise<void> {
    const transition = normalizeLedgerRecoveryTransitionInput(input);
    const context = await resolveLedgerContext(this.actorResolver);
    const command = normalizeLedgerRecoveryTransitionCommand({
      actorAccountId: context.actorAccountId,
      correlationId: context.correlationId,
      ...transition,
    });
    await this.repository.transitionRecovery(command);
  }
}
