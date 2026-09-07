import { EventEmitter } from 'node:events';

import type { Pool, PoolClient, QueryResult } from 'pg';

import { PostgresService } from './postgres.service';

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return Object.freeze({
    promise,
    resolve: (value: T): void => resolvePromise?.(value),
    reject: (error: unknown): void => rejectPromise?.(error),
  });
}

function queryResult(): QueryResult {
  return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
}

function clientFixture(): Readonly<{
  client: PoolClient;
  query: jest.Mock;
  release: jest.Mock;
  end: jest.Mock;
}> {
  const query = jest.fn();
  const release = jest.fn();
  const end = jest.fn().mockResolvedValue(undefined);
  return Object.freeze({
    client: { query, release, end } as unknown as PoolClient,
    query,
    release,
    end,
  });
}

function poolFixture(connect: jest.Mock): Readonly<{
  pool: Pool;
  events: EventEmitter;
  end: jest.Mock;
  query: jest.Mock;
}> {
  const events = new EventEmitter();
  const end = jest.fn().mockResolvedValue(undefined);
  const query = jest.fn().mockResolvedValue(queryResult());
  Object.assign(events, { connect, end, query });
  return Object.freeze({ pool: events as unknown as Pool, events, end, query });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function rejection(operation: Promise<unknown>): Promise<Error & { readonly code?: string }> {
  try {
    await operation;
  } catch (error) {
    return error as Error & { readonly code?: string };
  }
  throw new Error('Expected operation to reject');
}

describe('PostgresService cancellable queries', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('preserves the direct pooled health query when no signal is supplied', async () => {
    const connect = jest.fn();
    const testPool = poolFixture(connect);
    const service = new PostgresService(testPool.pool);

    await expect(service.healthCheck()).resolves.toBeUndefined();

    expect(testPool.query).toHaveBeenCalledWith('SELECT 1 AS healthy');
    expect(connect).not.toHaveBeenCalled();
  });

  it('cancels signaled health SQL and settles only after wire and client removal drain', async () => {
    const wireQuery = deferred<QueryResult>();
    const testClient = clientFixture();
    testClient.query.mockReturnValue(wireQuery.promise);
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    const service = new PostgresService(testPool.pool);
    const controller = new AbortController();
    const operation = service.healthCheck(controller.signal);
    await flushMicrotasks();

    expect(testClient.query).toHaveBeenCalledWith('SELECT 1 AS healthy', undefined);
    expect(testPool.query).not.toHaveBeenCalled();
    controller.abort();
    await flushMicrotasks();
    expect(testClient.release).toHaveBeenCalledTimes(1);

    let settled = false;
    void operation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    wireQuery.reject(new Error('wire terminated'));
    await flushMicrotasks();
    expect(settled).toBe(false);

    testPool.events.emit('remove', testClient.client);
    await expect(operation).rejects.toMatchObject({
      code: 'POSTGRES_CANCELLABLE_QUERY_ABORTED',
    });
  });

  it('rejects a pre-abort before acquisition and never issues SQL', async () => {
    const testClient = clientFixture();
    const connect = jest.fn().mockResolvedValue(testClient.client);
    const testPool = poolFixture(connect);
    const service = new PostgresService(testPool.pool);
    const controller = new AbortController();
    const reasonGetter = jest.fn(() => 'private');
    const reason = Object.create(null) as object;
    Object.defineProperty(reason, 'detail', { enumerable: true, get: reasonGetter });
    controller.abort(reason);

    const error = await rejection(
      service.queryWithCancellation('SELECT secret', [], controller.signal),
    );

    expect(error).toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_ABORTED' });
    expect(connect).not.toHaveBeenCalled();
    expect(testClient.query).not.toHaveBeenCalled();
    expect(testClient.release).not.toHaveBeenCalled();
    expect(reasonGetter).not.toHaveBeenCalled();
    expect(testPool.events.listenerCount('remove')).toBe(0);
  });

  it('waits for bounded acquisition after cancellation, then discards without SQL', async () => {
    const acquired = deferred<PoolClient>();
    const testClient = clientFixture();
    const connect = jest.fn().mockReturnValue(acquired.promise);
    const testPool = poolFixture(connect);
    testClient.release.mockImplementation(() => {
      testPool.events.emit('remove', testClient.client);
    });
    const service = new PostgresService(testPool.pool);
    const controller = new AbortController();
    const operation = service.queryWithCancellation('SELECT secret', [], controller.signal);
    let settled = false;
    void operation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await flushMicrotasks();

    controller.abort();
    await flushMicrotasks();
    expect(settled).toBe(false);
    expect(testClient.release).not.toHaveBeenCalled();

    acquired.resolve(testClient.client);
    const error = await rejection(operation);
    expect(error).toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_ABORTED' });
    expect(testClient.query).not.toHaveBeenCalled();
    expect(testClient.release).toHaveBeenCalledTimes(1);
  });

  it('drains both a mid-query rejection and exact client removal before operation and close settle', async () => {
    const wireQuery = deferred<QueryResult>();
    const testClient = clientFixture();
    testClient.query.mockReturnValue(wireQuery.promise);
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    const service = new PostgresService(testPool.pool);
    const controller = new AbortController();
    const operation = service.queryWithCancellation('SELECT secret', [], controller.signal);
    await flushMicrotasks();
    expect(testClient.query).toHaveBeenCalledTimes(1);

    controller.abort();
    const closing = service.closeCancellableQueries();
    let operationSettled = false;
    let closeSettled = false;
    void operation.then(
      () => {
        operationSettled = true;
      },
      () => {
        operationSettled = true;
      },
    );
    void closing.then(
      () => {
        closeSettled = true;
      },
      () => {
        closeSettled = true;
      },
    );
    await flushMicrotasks();
    expect(testClient.release).toHaveBeenCalledTimes(1);
    expect(operationSettled).toBe(false);
    expect(closeSettled).toBe(false);

    wireQuery.reject(new Error('private wire failure'));
    await flushMicrotasks();
    expect(operationSettled).toBe(false);
    expect(closeSettled).toBe(false);

    testPool.events.emit('remove', testClient.client);
    const error = await rejection(operation);
    await closing;
    expect(error).toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_ABORTED' });
    expect(testClient.release).toHaveBeenCalledTimes(1);
    expect(testPool.events.listenerCount('remove')).toBe(0);
  });

  it('enforces the local 16 second query timeout and drains the discarded client', async () => {
    jest.useFakeTimers();
    const wireQuery = deferred<QueryResult>();
    const testClient = clientFixture();
    testClient.query.mockReturnValue(wireQuery.promise);
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    testClient.release.mockImplementation(() => {
      wireQuery.reject(new Error('wire terminated'));
      testPool.events.emit('remove', testClient.client);
    });
    const service = new PostgresService(testPool.pool);

    const operation = service.queryWithCancellation(
      'SELECT secret',
      [],
      new AbortController().signal,
    );
    await flushMicrotasks();
    await jest.advanceTimersByTimeAsync(16_000);

    const error = await rejection(operation);
    expect(error).toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_TIMEOUT' });
    expect(testClient.release).toHaveBeenCalledTimes(1);
  });

  it('memoizes same-turn lifecycle close and starts no acquisition after admission closes', async () => {
    const testClient = clientFixture();
    const connect = jest.fn().mockResolvedValue(testClient.client);
    const testPool = poolFixture(connect);
    const service = new PostgresService(testPool.pool);
    const accepted = service.queryWithCancellation(
      'SELECT accepted',
      [],
      new AbortController().signal,
    );
    const firstClose = service.closeCancellableQueries();
    expect(service.closeCancellableQueries()).toBe(firstClose);
    const closedError = await rejection(
      service.queryWithCancellation('SELECT late', [], new AbortController().signal),
    );
    expect(closedError).toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_CLOSED' });

    const acceptedError = await rejection(accepted);
    await firstClose;
    expect(acceptedError).toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_CLOSED' });
    expect(connect).not.toHaveBeenCalled();
    expect(testClient.query).not.toHaveBeenCalled();
    expect(testClient.release).not.toHaveBeenCalled();
  });

  it('survives lifecycle-close reentrancy from a discard release without double release', async () => {
    const testClient = clientFixture();
    testClient.query.mockRejectedValue(new Error('query detail'));
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    const service = new PostgresService(testPool.pool);
    let closing: Promise<void> | undefined;
    testPool.events.on('release', () => {
      closing = service.closeCancellableQueries();
    });
    testClient.release.mockImplementation((error?: Error | boolean) => {
      testPool.events.emit('release', error, testClient.client);
      testPool.events.emit('remove', testClient.client);
    });

    const error = await rejection(
      service.queryWithCancellation('SELECT secret', [], new AbortController().signal),
    );
    await closing;

    expect(error).toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_FAILED' });
    expect(testClient.release).toHaveBeenCalledTimes(1);
    expect(testClient.end).not.toHaveBeenCalled();
  });

  it('linearizes successful-query release before lifecycle-close reentrancy', async () => {
    const testClient = clientFixture();
    testClient.query.mockResolvedValue(queryResult());
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    const service = new PostgresService(testPool.pool);
    let closing: Promise<void> | undefined;
    testPool.events.on('release', () => {
      closing = service.closeCancellableQueries();
    });
    testClient.release.mockImplementation((error?: Error | boolean) => {
      testPool.events.emit('release', error, testClient.client);
    });

    const error = await rejection(
      service.queryWithCancellation('SELECT 1', [], new AbortController().signal),
    );
    await closing;

    expect(error).toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_CLOSED' });
    expect(testClient.release).toHaveBeenCalledTimes(1);
    expect(testClient.end).not.toHaveBeenCalled();
    expect(testPool.events.listenerCount('remove')).toBe(0);
  });

  it('discards a rejected query and surfaces only the fixed failure', async () => {
    const testClient = clientFixture();
    testClient.query.mockRejectedValue(new Error('postgres://private.invalid/secret'));
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    testClient.release.mockImplementation(() => {
      testPool.events.emit('remove', testClient.client);
    });
    const service = new PostgresService(testPool.pool);

    const error = await rejection(
      service.queryWithCancellation('SELECT secret', [], new AbortController().signal),
    );
    expect(error).toMatchObject({ code: 'POSTGRES_CANCELLABLE_QUERY_FAILED' });
    expect(String(error)).not.toContain('private');
    expect(testClient.release).toHaveBeenCalledTimes(1);
  });

  it.each(['resolves', 'rejects'] as const)(
    'marks release-throw/client-end-%s as an undrained teardown failure',
    async (endMode) => {
      const testClient = clientFixture();
      testClient.query.mockRejectedValue(new Error('private query detail'));
      testClient.release.mockImplementation(() => {
        throw new Error('private release detail');
      });
      if (endMode === 'rejects') {
        testClient.end.mockRejectedValue(new Error('private end detail'));
      }
      const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
      const service = new PostgresService(testPool.pool);

      const operationError = await rejection(
        service.queryWithCancellation('SELECT secret', [], new AbortController().signal),
      );
      const closeError = await rejection(service.closeCancellableQueries());

      expect(operationError).toMatchObject({
        code: 'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED',
      });
      expect(closeError).toMatchObject({
        code: 'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED',
      });
      expect(testClient.end).toHaveBeenCalledTimes(1);
      expect(testPool.events.listenerCount('remove')).toBe(0);
    },
  );

  it('marks a successful result whose normal release throws as a teardown failure', async () => {
    const testClient = clientFixture();
    testClient.query.mockResolvedValue(queryResult());
    testClient.release.mockImplementation(() => {
      throw new Error('private release detail');
    });
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    const service = new PostgresService(testPool.pool);

    const operationError = await rejection(
      service.queryWithCancellation('SELECT 1', [], new AbortController().signal),
    );
    const closeError = await rejection(service.closeCancellableQueries());

    expect(operationError).toMatchObject({
      code: 'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED',
    });
    expect(closeError).toMatchObject({
      code: 'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED',
    });
    expect(testClient.end).toHaveBeenCalledTimes(1);
    expect(testPool.events.listenerCount('remove')).toBe(0);
  });

  it('publishes one fallback teardown across dual signals while client end is pending', async () => {
    const end = deferred<void>();
    const releaseAttempt = deferred<void>();
    const testClient = clientFixture();
    testClient.query.mockResolvedValue(queryResult());
    testClient.release.mockImplementation(() => {
      releaseAttempt.resolve(undefined);
      throw new Error('private release detail');
    });
    testClient.end.mockReturnValue(end.promise);
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    const service = new PostgresService(testPool.pool);
    const controller = new AbortController();
    const operation = service.queryWithCancellation('SELECT 1', [], controller.signal);
    await releaseAttempt.promise;
    await flushMicrotasks();
    expect(testClient.end).toHaveBeenCalledTimes(1);

    const closing = service.closeCancellableQueries();
    controller.abort();
    await flushMicrotasks();
    expect(testClient.release).toHaveBeenCalledTimes(1);
    expect(testClient.end).toHaveBeenCalledTimes(1);

    end.resolve(undefined);
    const operationError = await rejection(operation);
    const closeError = await rejection(closing);
    expect(operationError).toMatchObject({
      code: 'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED',
    });
    expect(closeError).toMatchObject({
      code: 'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED',
    });
  });

  it('rejects cancellable queries inside an active transaction without issuing their SQL', async () => {
    const testClient = clientFixture();
    testClient.query.mockResolvedValue(queryResult());
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    const service = new PostgresService(testPool.pool);

    const error = await rejection(
      service.withTransaction(() =>
        service.queryWithCancellation('SELECT forbidden', [], new AbortController().signal),
      ),
    );

    expect(error).toMatchObject({
      code: 'POSTGRES_CANCELLABLE_QUERY_ACTIVE_TRANSACTION',
    });
    expect(testClient.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE',
      'ROLLBACK',
    ]);
    expect(testClient.release).toHaveBeenCalledTimes(1);
  });

  it('releases successful queries normally and removes its teardown observer', async () => {
    const testClient = clientFixture();
    testClient.query.mockResolvedValue(queryResult());
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    const service = new PostgresService(testPool.pool);

    await expect(
      service.queryWithCancellation('SELECT 1', [], new AbortController().signal),
    ).resolves.toEqual(queryResult());
    expect(testClient.release).toHaveBeenCalledWith();
    expect(testPool.events.listenerCount('remove')).toBe(0);
  });

  it('still ends the pool and reports a fixed shutdown failure after an undrained query', async () => {
    const testClient = clientFixture();
    testClient.query.mockRejectedValue(new Error('query detail'));
    testClient.release.mockImplementation(() => {
      throw new Error('release detail');
    });
    const testPool = poolFixture(jest.fn().mockResolvedValue(testClient.client));
    const service = new PostgresService(testPool.pool);
    await rejection(
      service.queryWithCancellation('SELECT secret', [], new AbortController().signal),
    );

    const shutdownError = await rejection(service.onApplicationShutdown());
    expect(shutdownError).toMatchObject({
      code: 'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED',
    });
    expect(testPool.end).toHaveBeenCalledTimes(1);
  });
});
