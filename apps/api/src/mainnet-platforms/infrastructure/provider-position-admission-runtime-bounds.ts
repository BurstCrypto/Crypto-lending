import type { Pool } from 'pg';
import { isProxy } from 'node:util/types';

import type { DatabaseInfrastructureConfig } from '../../infrastructure/config/infrastructure.config';
import {
  createPostgresPool,
  type RuntimePostgresPoolConfig,
} from '../../infrastructure/database/runtime-postgres-pool';
import type { ProviderPositionAdmissionOptions } from '../application/provider-position-admission.coordinator';

export const PROVIDER_POSITION_ADMISSION_MAX_DEADLINE_MILLISECONDS = 30_000 as const;
export const PROVIDER_POSITION_ADMISSION_MAX_CONCURRENCY = 8 as const;

const POSTGRES_CONFIG_KEYS = Object.freeze(['workload', 'database'] as const);
const ADMISSION_OPTION_KEYS = Object.freeze([
  'deadlineMilliseconds',
  'maximumConcurrency',
] as const);
const DATABASE_REQUIRED_KEYS = Object.freeze([
  'connectionString',
  'connectionTimeoutMs',
  'idleTimeoutMs',
  'lockTimeoutMs',
  'maxLifetimeSeconds',
  'poolMax',
  'statementTimeoutMs',
  'ssl',
  'sessionRole',
] as const);
const API_DATABASE_SESSION_ROLE = 'crypto_api_runtime' as const;
const API_DATABASE_MAXIMUMS = Object.freeze({
  connectionTimeoutMs: 60_000,
  idleTimeoutMs: 600_000,
  lockTimeoutMs: 60_000,
  maxLifetimeSeconds: 86_400,
  poolMax: 100,
  statementTimeoutMs: 300_000,
} as const);

export interface DormantProviderPositionAdmissionRuntimeResource {
  readonly pool: Pool;
  /**
   * Exact frozen options object reserved for the future gated coordinator
   * composition. Returning it does not register or construct that coordinator.
   */
  readonly admissionOptions: Readonly<ProviderPositionAdmissionOptions>;
}

export type ProviderPositionAdmissionRuntimeBoundsErrorCode =
  | 'PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID'
  | 'PROVIDER_POSITION_ADMISSION_RUNTIME_CONSTRUCTION_FAILED';

export class ProviderPositionAdmissionRuntimeBoundsError extends Error {
  constructor(readonly code: ProviderPositionAdmissionRuntimeBoundsErrorCode) {
    super('Provider-position admission runtime is unavailable.');
    this.name = 'ProviderPositionAdmissionRuntimeBoundsError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function fail(code: ProviderPositionAdmissionRuntimeBoundsErrorCode): never {
  throw new ProviderPositionAdmissionRuntimeBoundsError(code);
}

function exactDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
    }

    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const keys = Reflect.ownKeys(descriptors);
    const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
    if (
      keys.length < requiredKeys.length ||
      keys.length > allowedKeys.size ||
      requiredKeys.some((key) => !keys.includes(key)) ||
      keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))
    ) {
      return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
    }

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch (error) {
    if (error instanceof ProviderPositionAdmissionRuntimeBoundsError) throw error;
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }
}

function boundedPositiveSafeInteger(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }
  return value as number;
}

interface ReviewedConnectionString {
  readonly value: string;
  readonly loopback: boolean;
}

function connectionStringSnapshot(value: unknown): ReviewedConnectionString {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 16_384 ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value) ||
    value.includes('?') ||
    value.includes('#')
  ) {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }

  try {
    const parsed = new URL(value);
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const database = decodeURIComponent(parsed.pathname);
    if (
      (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') ||
      parsed.toString() !== value ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      !parsed.hostname ||
      !/^crypto_api_login_[a-z0-9]{1,32}$/u.test(username) ||
      password.length < 1 ||
      /[\0\r\n]/u.test(password) ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(database)
    ) {
      return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
    }
    return Object.freeze({
      value,
      loopback:
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]' ||
        parsed.hostname === '::1',
    });
  } catch {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }
}

function sslSnapshot(value: unknown, loopback: boolean): DatabaseInfrastructureConfig['ssl'] {
  if (value === false) {
    if (!loopback) return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
    return false;
  }
  const record = exactDataRecord(value, ['rejectUnauthorized'], ['ca']);
  if (typeof record.rejectUnauthorized !== 'boolean') {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }
  if (
    'ca' in record &&
    (record.rejectUnauthorized !== true ||
      typeof record.ca !== 'string' ||
      record.ca.length < 1 ||
      record.ca.length > 1_048_576 ||
      record.ca.includes('\0'))
  ) {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }
  const snapshot = Object.freeze(
    Object.assign(Object.create(null) as { rejectUnauthorized: boolean; ca?: string }, {
      rejectUnauthorized: record.rejectUnauthorized,
      ...('ca' in record ? { ca: record.ca as string } : {}),
    }),
  );
  if (!loopback && (snapshot.rejectUnauthorized !== true || snapshot.ca === undefined)) {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }
  return snapshot;
}

function databaseSnapshot(value: unknown): Readonly<DatabaseInfrastructureConfig> {
  const record = exactDataRecord(value, DATABASE_REQUIRED_KEYS);
  const connection = connectionStringSnapshot(record.connectionString);
  const connectionTimeoutMs = boundedPositiveSafeInteger(
    record.connectionTimeoutMs,
    API_DATABASE_MAXIMUMS.connectionTimeoutMs,
  );
  const idleTimeoutMs = boundedPositiveSafeInteger(
    record.idleTimeoutMs,
    API_DATABASE_MAXIMUMS.idleTimeoutMs,
  );
  const lockTimeoutMs = boundedPositiveSafeInteger(
    record.lockTimeoutMs,
    API_DATABASE_MAXIMUMS.lockTimeoutMs,
  );
  const maxLifetimeSeconds = boundedPositiveSafeInteger(
    record.maxLifetimeSeconds,
    API_DATABASE_MAXIMUMS.maxLifetimeSeconds,
  );
  const poolMax = boundedPositiveSafeInteger(record.poolMax, API_DATABASE_MAXIMUMS.poolMax);
  const statementTimeoutMs = boundedPositiveSafeInteger(
    record.statementTimeoutMs,
    API_DATABASE_MAXIMUMS.statementTimeoutMs,
  );
  const ssl = sslSnapshot(record.ssl, connection.loopback);
  if (record.sessionRole !== API_DATABASE_SESSION_ROLE) {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }

  return Object.freeze(
    Object.assign(Object.create(null) as DatabaseInfrastructureConfig, {
      connectionString: connection.value,
      connectionTimeoutMs,
      idleTimeoutMs,
      lockTimeoutMs,
      maxLifetimeSeconds,
      poolMax,
      statementTimeoutMs,
      ssl,
      sessionRole: API_DATABASE_SESSION_ROLE,
    }),
  );
}

function postgresConfigSnapshot(value: unknown): Readonly<RuntimePostgresPoolConfig> {
  const record = exactDataRecord(value, POSTGRES_CONFIG_KEYS);
  if (record.workload !== 'api') {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }
  return Object.freeze(
    Object.assign(Object.create(null) as RuntimePostgresPoolConfig, {
      workload: 'api' as const,
      database: databaseSnapshot(record.database),
    }),
  );
}

function admissionOptionsSnapshot(value: unknown): Readonly<ProviderPositionAdmissionOptions> {
  const record = exactDataRecord(value, ADMISSION_OPTION_KEYS);
  const deadlineMilliseconds = boundedPositiveSafeInteger(
    record.deadlineMilliseconds,
    PROVIDER_POSITION_ADMISSION_MAX_DEADLINE_MILLISECONDS,
  );
  const maximumConcurrency = boundedPositiveSafeInteger(
    record.maximumConcurrency,
    PROVIDER_POSITION_ADMISSION_MAX_CONCURRENCY,
  );
  return Object.freeze(
    Object.assign(Object.create(null) as ProviderPositionAdmissionOptions, {
      deadlineMilliseconds,
      maximumConcurrency,
    }),
  );
}

/**
 * Creates a lazy PostgreSQL pool only after one API database snapshot and one
 * admission-options snapshot pass the reviewed runtime bounds. It performs no
 * query, environment lookup, feature registration, or other I/O. Pool timeout
 * ordering is a configuration bound, not hard end-to-end latency evidence;
 * the future composition must pass this resource's exact `admissionOptions`
 * object to the coordinator and remains separately blocked.
 */
export function createDormantProviderPositionAdmissionRuntimeResource(
  postgresConfigInput: RuntimePostgresPoolConfig,
  admissionOptionsInput: ProviderPositionAdmissionOptions,
): Readonly<DormantProviderPositionAdmissionRuntimeResource> {
  const postgresPoolConfig = postgresConfigSnapshot(postgresConfigInput);
  const admissionOptions = admissionOptionsSnapshot(admissionOptionsInput);
  if (postgresPoolConfig.database.connectionTimeoutMs > admissionOptions.deadlineMilliseconds) {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_BOUNDS_INVALID');
  }

  let pool: Pool;
  try {
    pool = createPostgresPool(postgresPoolConfig);
  } catch {
    return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_CONSTRUCTION_FAILED');
  }
  return Object.freeze(
    Object.assign(Object.create(null) as DormantProviderPositionAdmissionRuntimeResource, {
      pool,
      admissionOptions,
    }),
  );
}
