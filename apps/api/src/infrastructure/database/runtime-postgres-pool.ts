import { Pool } from 'pg';

import type { RuntimeInfrastructureConfig } from '../config/infrastructure.config';
import { postgresStartupOptions } from './postgres-startup-options';

export interface RuntimeDatabaseCapabilityRoles {
  api: string;
  balanceConsumer: string;
  worker: string;
}

const PRODUCTION_RUNTIME_DATABASE_ROLES: Readonly<RuntimeDatabaseCapabilityRoles> = Object.freeze({
  api: 'crypto_api_runtime',
  balanceConsumer: 'crypto_balance_consumer_runtime',
  worker: 'crypto_worker_runtime',
});

function expectedRuntimeDatabaseRole(
  config: RuntimeInfrastructureConfig,
  capabilityRoles: Readonly<RuntimeDatabaseCapabilityRoles>,
): string {
  if (config.workload === 'api') return capabilityRoles.api;
  if (config.workload === 'worker') return capabilityRoles.worker;
  return capabilityRoles.balanceConsumer;
}

export function createPostgresPool(
  config: RuntimeInfrastructureConfig,
  capabilityRoles: Readonly<RuntimeDatabaseCapabilityRoles> = PRODUCTION_RUNTIME_DATABASE_ROLES,
): Pool {
  const expectedSessionRole = expectedRuntimeDatabaseRole(config, capabilityRoles);
  if (config.database.sessionRole && config.database.sessionRole !== expectedSessionRole) {
    throw new Error(
      `Database session role ${config.database.sessionRole} does not match ${config.workload} workload`,
    );
  }
  return new Pool({
    connectionString: config.database.connectionString,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    idleTimeoutMillis: config.database.idleTimeoutMs,
    lock_timeout: config.database.lockTimeoutMs,
    max: config.database.poolMax,
    maxLifetimeSeconds: config.database.maxLifetimeSeconds,
    statement_timeout: config.database.statementTimeoutMs,
    application_name: `crypto-lending-${config.workload}`,
    ...(config.database.sessionRole
      ? {
          // libpq startup options are applied before node-postgres exposes the
          // client, so no application query can race ahead of SET ROLE.
          options: postgresStartupOptions(config.database.sessionRole),
        }
      : {}),
    ssl: config.database.ssl,
  });
}
