import type {
  CreateYieldOperationCommand,
  TransitionYieldOperationCommand,
  YieldOperationCommandResult,
} from '../domain/yield-operation';
import type { YieldOperationIdempotencyContext } from '../domain/yield-operation-idempotency';

export const YIELD_OPERATION_REPOSITORY = Symbol('YIELD_OPERATION_REPOSITORY');

export interface YieldOperationRepository {
  create(
    command: CreateYieldOperationCommand,
    idempotency: YieldOperationIdempotencyContext,
  ): Promise<YieldOperationCommandResult>;
  transition(
    command: TransitionYieldOperationCommand,
    idempotency: YieldOperationIdempotencyContext,
  ): Promise<YieldOperationCommandResult>;
}
