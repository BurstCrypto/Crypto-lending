import '../config/load-dotenv';

import { performance } from 'node:perf_hooks';

import { Pool } from 'pg';

import { loadMigrationDatabaseConfig } from '../config/infrastructure.config';
import { installFatalProcessBoundary, LOG_EVENTS, StructuredLogger } from '../logging';
import { bootstrapRailwayDatabase } from './railway-database-bootstrap';

const logger = new StructuredLogger({ workload: 'migration' });

async function main(): Promise<void> {
  if (process.env.DEPLOYMENT_TARGET !== 'railway') {
    throw new Error('Railway database bootstrap requires DEPLOYMENT_TARGET=railway');
  }
  process.env.NODE_ENV = 'production';
  installFatalProcessBoundary(logger);
  const startedAt = performance.now();
  const workload = process.env.APPLICATION_WORKLOAD;
  if (workload !== 'api' && workload !== 'worker') {
    throw new Error('Railway database bootstrap requires APPLICATION_WORKLOAD=api or worker');
  }
  const username = process.env.DATABASE_RUNTIME_USERNAME;
  const password = process.env.DATABASE_RUNTIME_PASSWORD;
  if (!username || !password) {
    throw new Error('Railway database bootstrap requires runtime username and password');
  }
  const migrationEnvironment = { ...process.env };
  delete migrationEnvironment.APPLICATION_WORKLOAD;
  for (const name of Object.keys(migrationEnvironment)) {
    if (name.startsWith('DATABASE_RUNTIME_')) delete migrationEnvironment[name];
  }
  const config = loadMigrationDatabaseConfig(migrationEnvironment);
  const pool = new Pool({
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    max: 1,
    maxLifetimeSeconds: config.maxLifetimeSeconds,
    statement_timeout: config.statementTimeoutMs,
    ssl: config.ssl,
  });
  try {
    await bootstrapRailwayDatabase(pool, { workload, username, password });
    logger.emit(LOG_EVENTS.migrationCompleted, 'info', {
      outcome: 'success',
      migrationCommand: 'up',
      migrationId: 'railway-bootstrap',
      migrationState: 'up',
      changed: 1,
      durationMs: performance.now() - startedAt,
    });
  } finally {
    await pool.end();
  }
}

void main().catch(() => {
  logger.emit(LOG_EVENTS.migrationFailed, 'fatal', {
    outcome: 'failure',
    errorCode: 'RAILWAY_DATABASE_BOOTSTRAP_FAILED',
  });
  process.exitCode = 1;
});
