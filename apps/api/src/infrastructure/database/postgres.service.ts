import { AsyncLocalStorage } from 'node:async_hooks';

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { Pool, PoolClient, QueryConfig, QueryResult, QueryResultRow } from 'pg';

import { POSTGRES_POOL } from './postgres.tokens';

export type TransactionIsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

export interface TransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  readOnly?: boolean;
  /** Number of retries after the initial attempt for serialization/deadlock errors. */
  maxRetries?: number;
  retryDelayMs?: number;
}

export type TransactionWork<T> = (client: PoolClient) => Promise<T>;

const RETRYABLE_TRANSACTION_CODES = new Set(['40001', '40P01']);
const CANCELLABLE_QUERY_TIMEOUT_MS = 16_000;
const ISOLATION_SQL: Record<TransactionIsolationLevel, string> = {
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
};

interface PostgresError extends Error {
  code?: string;
}

export type PostgresCancellableQueryErrorCode =
  | 'POSTGRES_CANCELLABLE_QUERY_INVALID_SIGNAL'
  | 'POSTGRES_CANCELLABLE_QUERY_ACTIVE_TRANSACTION'
  | 'POSTGRES_CANCELLABLE_QUERY_CLOSED'
  | 'POSTGRES_CANCELLABLE_QUERY_ABORTED'
  | 'POSTGRES_CANCELLABLE_QUERY_TIMEOUT'
  | 'POSTGRES_CANCELLABLE_QUERY_FAILED'
  | 'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED';

const VERIFIED_POSTGRES_CANCELLABLE_QUERY_ERRORS = new WeakSet<object>();

export class PostgresCancellableQueryError extends Error {
  constructor(readonly code: PostgresCancellableQueryErrorCode) {
    super(code);
    this.name = 'PostgresCancellableQueryError';
    Object.freeze(this);
  }
}

function cancellableQueryError(
  code: PostgresCancellableQueryErrorCode,
): PostgresCancellableQueryError {
  const error = new PostgresCancellableQueryError(code);
  VERIFIED_POSTGRES_CANCELLABLE_QUERY_ERRORS.add(error);
  return error;
}

function isVerifiedTeardownFailure(value: unknown): boolean {
  try {
    return (
      (typeof value === 'object' || typeof value === 'function') &&
      value !== null &&
      VERIFIED_POSTGRES_CANCELLABLE_QUERY_ERRORS.has(value as object) &&
      Object.getOwnPropertyDescriptor(value, 'code')?.value ===
        'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED'
    );
  } catch {
    return false;
  }
}

interface ReviewedAbortSignal {
  readonly aborted: () => boolean;
  readonly add: (listener: EventListener) => void;
  readonly remove: (listener: EventListener) => void;
}

interface ClientRemovalObserver {
  readonly completed: Promise<void>;
  readonly stop: () => void;
}

const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)?.get;
const ABORT_CONTROLLER_SIGNAL_GETTER = Object.getOwnPropertyDescriptor(
  AbortController.prototype,
  'signal',
)?.get;
const ABORT_CONTROLLER_ABORT = Object.getOwnPropertyDescriptor(AbortController.prototype, 'abort')
  ?.value as ((reason?: unknown) => void) | undefined;
const EVENT_TARGET_ADD_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'addEventListener',
)?.value as EventTarget['addEventListener'] | undefined;
const EVENT_TARGET_REMOVE_EVENT_LISTENER = Object.getOwnPropertyDescriptor(
  EventTarget.prototype,
  'removeEventListener',
)?.value as EventTarget['removeEventListener'] | undefined;

function reviewAbortSignal(value: unknown): Readonly<ReviewedAbortSignal> | null {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      ABORT_SIGNAL_ABORTED_GETTER === undefined ||
      typeof EVENT_TARGET_ADD_EVENT_LISTENER !== 'function' ||
      typeof EVENT_TARGET_REMOVE_EVENT_LISTENER !== 'function'
    ) {
      return null;
    }
    const signal = value as AbortSignal;
    Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []);
    return Object.freeze({
      aborted: (): boolean => Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) as boolean,
      add: (listener: EventListener): void => {
        Reflect.apply(EVENT_TARGET_ADD_EVENT_LISTENER, signal, ['abort', listener, { once: true }]);
      },
      remove: (listener: EventListener): void => {
        Reflect.apply(EVENT_TARGET_REMOVE_EVENT_LISTENER, signal, ['abort', listener]);
      },
    });
  } catch {
    return null;
  }
}

function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

@Injectable()
export class PostgresService implements OnApplicationShutdown {
  private readonly transactionContext = new AsyncLocalStorage<PoolClient>();
  private readonly cancellableQueryController = new AbortController();
  private readonly cancellableQueryOperations = new Set<Promise<void>>();
  private cancellableQueryAdmissionOpen = true;
  private cancellableQueryClosePromise: Promise<void> | undefined;
  private cancellableQueryTeardownFailed = false;

  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  hasActiveTransaction(): boolean {
    return this.transactionContext.getStore() !== undefined;
  }

  /** Uses the current transaction client when called inside withTransaction. */
  query<Row extends QueryResultRow = QueryResultRow>(
    queryTextOrConfig: string | QueryConfig,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    const executor = this.transactionContext.getStore() ?? this.pool;
    return executor.query<Row>(queryTextOrConfig, values);
  }

  /**
   * Runs one cancellable query on an exclusively acquired client. The caller's
   * signal and this service's lifecycle both discard the connection, then the
   * method drains the wire query and client teardown before settling.
   */
  queryWithCancellation<Row extends QueryResultRow = QueryResultRow>(
    queryTextOrConfig: string | QueryConfig,
    values: unknown[] | undefined,
    signal: AbortSignal,
  ): Promise<QueryResult<Row>> {
    if (this.transactionContext.getStore() !== undefined) {
      return Promise.reject(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_ACTIVE_TRANSACTION'));
    }
    if (reviewAbortSignal(signal) === null) {
      return Promise.reject(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_INVALID_SIGNAL'));
    }
    if (!this.cancellableQueryAdmissionOpen) {
      return Promise.reject(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_CLOSED'));
    }

    let finishGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finishGate = resolve;
    });
    this.cancellableQueryOperations.add(gate);
    const operation = Promise.resolve().then(() =>
      this.executeCancellableQuery<Row>(queryTextOrConfig, values, signal),
    );
    void operation.then(
      () => finishGate?.(),
      (error) => {
        if (isVerifiedTeardownFailure(error)) this.cancellableQueryTeardownFailed = true;
        finishGate?.();
      },
    );
    void gate.then(
      () => this.cancellableQueryOperations.delete(gate),
      () => this.cancellableQueryOperations.delete(gate),
    );
    return operation;
  }

  /** Closes admission synchronously, aborts accepted queries, and memoizes their drain. */
  closeCancellableQueries(): Promise<void> {
    if (this.cancellableQueryClosePromise !== undefined) {
      return this.cancellableQueryClosePromise;
    }
    this.cancellableQueryAdmissionOpen = false;
    let finish: (() => void) | undefined;
    let fail: ((error: PostgresCancellableQueryError) => void) | undefined;
    const closePromise = new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    this.cancellableQueryClosePromise = closePromise;

    if (
      ABORT_CONTROLLER_SIGNAL_GETTER !== undefined &&
      typeof ABORT_CONTROLLER_ABORT === 'function'
    ) {
      const signal = Reflect.apply(
        ABORT_CONTROLLER_SIGNAL_GETTER,
        this.cancellableQueryController,
        [],
      ) as AbortSignal;
      const reviewed = reviewAbortSignal(signal);
      if (reviewed !== null && !reviewed.aborted()) {
        Reflect.apply(ABORT_CONTROLLER_ABORT, this.cancellableQueryController, []);
      }
    }
    void this.drainCancellableQueries().then(
      () => {
        if (this.cancellableQueryTeardownFailed) {
          fail?.(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED'));
          return;
        }
        finish?.();
      },
      () => fail?.(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED')),
    );
    return closePromise;
  }

  /**
   * Executes work atomically and propagates the client through async calls.
   * Nested calls join the outer transaction so repositories can compose safely.
   */
  async withTransaction<T>(work: TransactionWork<T>, options: TransactionOptions = {}): Promise<T> {
    const activeClient = this.transactionContext.getStore();
    if (activeClient) {
      return work(activeClient);
    }

    const client = await this.pool.connect();
    const isolationLevel = options.isolationLevel ?? 'read committed';
    const maxRetries = options.maxRetries ?? 0;
    const retryDelayMs = options.retryDelayMs ?? 25;

    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      client.release();
      throw new Error('Transaction maxRetries must be a non-negative integer');
    }

    try {
      for (let attempt = 0; ; attempt += 1) {
        const beginStatement = [
          'BEGIN ISOLATION LEVEL',
          ISOLATION_SQL[isolationLevel],
          options.readOnly ? 'READ ONLY' : 'READ WRITE',
        ].join(' ');

        await client.query(beginStatement);
        try {
          const result = await this.transactionContext.run(client, () => work(client));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          const code = (error as PostgresError).code;
          if (!code || !RETRYABLE_TRANSACTION_CODES.has(code) || attempt >= maxRetries) {
            throw error;
          }
          await sleep(Math.min(retryDelayMs * 2 ** attempt, 1_000));
        }
      }
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<void> {
    await this.pool.query('SELECT 1 AS healthy');
  }

  async onApplicationShutdown(): Promise<void> {
    const [drain] = await Promise.allSettled([this.closeCancellableQueries()]);
    const [poolClose] = await Promise.allSettled([this.pool.end()]);
    if (drain?.status === 'rejected' || poolClose?.status === 'rejected') {
      throw cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED');
    }
  }

  private async executeCancellableQuery<Row extends QueryResultRow>(
    queryTextOrConfig: string | QueryConfig,
    values: unknown[] | undefined,
    signal: AbortSignal,
  ): Promise<QueryResult<Row>> {
    const supplied = reviewAbortSignal(signal);
    const lifecycleSignal =
      ABORT_CONTROLLER_SIGNAL_GETTER === undefined
        ? undefined
        : (Reflect.apply(
            ABORT_CONTROLLER_SIGNAL_GETTER,
            this.cancellableQueryController,
            [],
          ) as AbortSignal);
    const lifecycle = reviewAbortSignal(lifecycleSignal);
    if (supplied === null || lifecycle === null) {
      throw cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_INVALID_SIGNAL');
    }

    let cancellation:
      | 'POSTGRES_CANCELLABLE_QUERY_ABORTED'
      | 'POSTGRES_CANCELLABLE_QUERY_TIMEOUT'
      | 'POSTGRES_CANCELLABLE_QUERY_CLOSED'
      | 'POSTGRES_CANCELLABLE_QUERY_FAILED'
      | null = null;
    let client: PoolClient | undefined;
    let removal: ClientRemovalObserver | undefined;
    let discard: Promise<void> | undefined;
    let clientState: 'ACTIVE' | 'NORMAL_RELEASING' | 'DISCARDING' | 'RELEASED' = 'ACTIVE';
    let finishNormalRelease: (() => void) | undefined;
    const normalReleaseCompleted = new Promise<void>((resolve) => {
      finishNormalRelease = resolve;
    });
    const requestDiscard = (): Promise<void> => {
      if (client === undefined || removal === undefined) return Promise.resolve();
      if (discard !== undefined) return discard;
      if (clientState === 'NORMAL_RELEASING') return normalReleaseCompleted;
      if (clientState === 'RELEASED') return Promise.resolve();
      clientState = 'DISCARDING';
      const fixedError = cancellableQueryError(cancellation ?? 'POSTGRES_CANCELLABLE_QUERY_FAILED');
      let finishDiscard: (() => void) | undefined;
      let failDiscard: ((error: PostgresCancellableQueryError) => void) | undefined;
      discard = new Promise<void>((resolve, reject) => {
        finishDiscard = resolve;
        failDiscard = reject;
      });
      try {
        client.release(fixedError);
      } catch {
        const acquiredClient = client;
        const removalObserver = removal;
        void Promise.resolve()
          .then(() => acquiredClient.end())
          .then(
            () => {
              removalObserver.stop();
              clientState = 'RELEASED';
              failDiscard?.(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED'));
            },
            () => {
              removalObserver.stop();
              clientState = 'RELEASED';
              failDiscard?.(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED'));
            },
          );
        return discard;
      }
      void removal.completed.then(
        () => {
          clientState = 'RELEASED';
          finishDiscard?.();
        },
        () => {
          clientState = 'RELEASED';
          failDiscard?.(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED'));
        },
      );
      return discard;
    };
    const cancelFromSignal = (): void => {
      cancellation ??= 'POSTGRES_CANCELLABLE_QUERY_ABORTED';
      void requestDiscard().catch(() => undefined);
    };
    const cancelFromLifecycle = (): void => {
      cancellation ??= 'POSTGRES_CANCELLABLE_QUERY_CLOSED';
      void requestDiscard().catch(() => undefined);
    };
    const timeout = setTimeout(() => {
      cancellation ??= 'POSTGRES_CANCELLABLE_QUERY_TIMEOUT';
      void requestDiscard().catch(() => undefined);
    }, CANCELLABLE_QUERY_TIMEOUT_MS);
    timeout.unref?.();
    supplied.add(cancelFromSignal);
    lifecycle.add(cancelFromLifecycle);

    try {
      if (supplied.aborted()) cancelFromSignal();
      if (lifecycle.aborted()) cancelFromLifecycle();
      if (cancellation !== null) {
        throw cancellableQueryError(cancellation);
      }

      try {
        client = await this.pool.connect();
      } catch {
        throw cancellableQueryError(cancellation ?? 'POSTGRES_CANCELLABLE_QUERY_FAILED');
      }
      removal = this.observeClientRemoval(client);
      if (cancellation !== null || supplied.aborted() || lifecycle.aborted()) {
        if (supplied.aborted()) cancelFromSignal();
        if (lifecycle.aborted()) cancelFromLifecycle();
        await requestDiscard();
        throw cancellableQueryError(cancellation ?? 'POSTGRES_CANCELLABLE_QUERY_ABORTED');
      }

      const querySettlement = Promise.resolve()
        .then(() => client?.query<Row>(queryTextOrConfig, values))
        .then(
          (result) => Object.freeze({ status: 'fulfilled' as const, result }),
          () => Object.freeze({ status: 'rejected' as const }),
        );
      const outcome = await querySettlement;
      if (outcome.status === 'rejected') {
        cancellation ??= 'POSTGRES_CANCELLABLE_QUERY_FAILED';
      }
      if (cancellation !== null || supplied.aborted() || lifecycle.aborted()) {
        if (supplied.aborted()) cancelFromSignal();
        if (lifecycle.aborted()) cancelFromLifecycle();
        const teardown = requestDiscard();
        const teardownFailure = (await Promise.allSettled([querySettlement, teardown])).find(
          (settlement) => settlement.status === 'rejected',
        );
        if (teardownFailure !== undefined) {
          throw cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED');
        }
        throw cancellableQueryError(cancellation ?? 'POSTGRES_CANCELLABLE_QUERY_ABORTED');
      }

      if (outcome.status !== 'fulfilled' || outcome.result === undefined) {
        throw cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_FAILED');
      }
      clientState = 'NORMAL_RELEASING';
      try {
        client.release();
      } catch {
        clientState = 'DISCARDING';
        let failReleaseTeardown: ((error: PostgresCancellableQueryError) => void) | undefined;
        discard = new Promise<void>((_resolve, reject) => {
          failReleaseTeardown = reject;
        });
        const acquiredClient = client;
        void Promise.resolve()
          .then(() => acquiredClient.end())
          .then(
            () => {
              removal?.stop();
              failReleaseTeardown?.(
                cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED'),
              );
            },
            () => {
              removal?.stop();
              failReleaseTeardown?.(
                cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED'),
              );
            },
          );
        await Promise.allSettled([discard]);
        clientState = 'RELEASED';
        finishNormalRelease?.();
        throw cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED');
      }
      clientState = 'RELEASED';
      finishNormalRelease?.();
      removal.stop();
      if (supplied.aborted()) cancelFromSignal();
      if (lifecycle.aborted()) cancelFromLifecycle();
      if (cancellation !== null) throw cancellableQueryError(cancellation);
      return outcome.result;
    } finally {
      clearTimeout(timeout);
      supplied.remove(cancelFromSignal);
      lifecycle.remove(cancelFromLifecycle);
      if (client === undefined) removal?.stop();
    }
  }

  private observeClientRemoval(client: PoolClient): ClientRemovalObserver {
    let finish: (() => void) | undefined;
    let listening = true;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onRemove = (removed: PoolClient): void => {
      if (removed !== client || !listening) return;
      listening = false;
      this.pool.removeListener('remove', onRemove);
      finish?.();
    };
    this.pool.on('remove', onRemove);
    return Object.freeze({
      completed,
      stop: (): void => {
        if (!listening) return;
        listening = false;
        this.pool.removeListener('remove', onRemove);
        finish?.();
      },
    });
  }

  private async drainCancellableQueries(): Promise<void> {
    while (this.cancellableQueryOperations.size > 0) {
      await Promise.allSettled([...this.cancellableQueryOperations]);
    }
  }
}
