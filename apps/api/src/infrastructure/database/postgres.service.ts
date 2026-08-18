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
const ISOLATION_SQL: Record<TransactionIsolationLevel, string> = {
  'read committed': 'READ COMMITTED',
  'repeatable read': 'REPEATABLE READ',
  serializable: 'SERIALIZABLE',
};

interface PostgresError extends Error {
  code?: string;
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
    await this.pool.end();
  }
}
