import { Inject, Injectable } from '@nestjs/common';

import { loggingContext } from '../../infrastructure/logging';
import {
  LEDGER_ACTOR_RESOLVER,
  type LedgerActorResolver,
} from '../../ledger/application/ledger-actor-resolver.port';
import {
  parseLedgerActorAccountId,
  parseLedgerCorrelationId,
  type LedgerActorAccountId,
  type LedgerCorrelationId,
} from '../../ledger/domain/ledger';
import {
  createTransitionYieldOperationCommand,
  createYieldOperationCommand,
  normalizeCreateYieldOperationInput,
  normalizeTransitionYieldOperationInput,
  type CreateYieldOperationInput,
  type TransitionYieldOperationInput,
  type YieldOperationCommandResult,
} from '../domain/yield-operation';
import {
  createYieldOperationIdempotencyContext,
  createYieldTransitionIdempotencyContext,
} from '../domain/yield-operation-idempotency';
import {
  YIELD_OPERATION_REPOSITORY,
  type YieldOperationRepository,
} from './yield-operation.repository.port';

export class YieldOperationCommandContextError extends Error {
  readonly code = 'YIELD_OPERATION_COMMAND_CONTEXT_REQUIRED' as const;

  constructor() {
    super('Yield operation command context is unavailable');
    this.name = 'YieldOperationCommandContextError';
  }
}

async function resolveCommandContext(actorResolver: LedgerActorResolver): Promise<{
  actorAccountId: LedgerActorAccountId;
  correlationId: LedgerCorrelationId;
}> {
  try {
    const context = loggingContext.current();
    if (!context) throw new YieldOperationCommandContextError();
    const resolvedActor = await actorResolver.resolve();
    if (!resolvedActor) throw new YieldOperationCommandContextError();
    const actorAccountId = parseLedgerActorAccountId(resolvedActor);
    if (context.initiatorActorId !== undefined && context.initiatorActorId !== actorAccountId) {
      throw new YieldOperationCommandContextError();
    }
    return Object.freeze({
      actorAccountId,
      correlationId: parseLedgerCorrelationId(context.correlationId),
    });
  } catch {
    throw new YieldOperationCommandContextError();
  }
}

@Injectable()
export class YieldOperationService {
  constructor(
    @Inject(YIELD_OPERATION_REPOSITORY)
    private readonly repository: YieldOperationRepository,
    @Inject(LEDGER_ACTOR_RESOLVER)
    private readonly actorResolver: LedgerActorResolver,
  ) {}

  async create(
    input: CreateYieldOperationInput,
    idempotencyKey: string,
  ): Promise<YieldOperationCommandResult> {
    const operation = normalizeCreateYieldOperationInput(input);
    const context = await resolveCommandContext(this.actorResolver);
    const command = createYieldOperationCommand(
      operation,
      context.actorAccountId,
      context.correlationId,
    );
    const idempotency = createYieldOperationIdempotencyContext(idempotencyKey, command);
    return loggingContext.runWith({ transactionId: operation.ledgerTransactionId }, () =>
      this.repository.create(command, idempotency),
    );
  }

  async transition(
    input: TransitionYieldOperationInput,
    idempotencyKey: string,
  ): Promise<YieldOperationCommandResult> {
    const transition = normalizeTransitionYieldOperationInput(input);
    const context = await resolveCommandContext(this.actorResolver);
    const command = createTransitionYieldOperationCommand(
      transition,
      context.actorAccountId,
      context.correlationId,
    );
    const idempotency = createYieldTransitionIdempotencyContext(idempotencyKey, command);
    return this.repository.transition(command, idempotency);
  }
}
