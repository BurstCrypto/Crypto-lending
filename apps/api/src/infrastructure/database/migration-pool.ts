import { Pool } from 'pg';

import type { DatabaseInfrastructureConfig } from '../config/infrastructure.config';

export function createMigrationPool(config: DatabaseInfrastructureConfig): Pool {
  return new Pool({
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    lock_timeout: config.lockTimeoutMs,
    max: 1,
    maxLifetimeSeconds: config.maxLifetimeSeconds,
    statement_timeout: config.statementTimeoutMs,
    application_name: 'crypto-lending-migrations',
    ssl: config.ssl,
  });
}
