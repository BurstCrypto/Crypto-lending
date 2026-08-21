import { Pool } from 'pg';

import type { DatabaseInfrastructureConfig } from '../config/infrastructure.config';
import { postgresStartupOptions } from './postgres-startup-options';

export function createMigrationPool(
  config: DatabaseInfrastructureConfig,
  expectedSessionRole = 'crypto_schema_owner',
): Pool {
  if (config.sessionRole && config.sessionRole !== expectedSessionRole) {
    throw new Error(`Unsupported database migration session role: ${config.sessionRole}`);
  }
  return new Pool({
    connectionString: config.connectionString,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    lock_timeout: config.lockTimeoutMs,
    max: 1,
    maxLifetimeSeconds: config.maxLifetimeSeconds,
    statement_timeout: config.statementTimeoutMs,
    application_name: 'crypto-lending-migrations',
    ...(config.sessionRole ? { options: postgresStartupOptions(config.sessionRole) } : {}),
    ssl: config.ssl,
  });
}
