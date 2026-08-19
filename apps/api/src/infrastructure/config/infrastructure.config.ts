import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';

export interface DatabaseInfrastructureConfig {
  connectionString: string;
  poolMax: number;
  statementTimeoutMs: number;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
}

export interface RedisInfrastructureConfig {
  url: string;
  keyPrefix: string;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
}

export interface SqsInfrastructureConfig {
  region: string;
  endpoint?: string;
  queueUrl: string;
  deadLetterQueueUrl: string;
  sdkMaxAttempts: number;
  maxReceiveCount: number;
  visibilityTimeoutSeconds: number;
  retryBaseDelaySeconds: number;
  retryMaxDelaySeconds: number;
}

export interface InfrastructureConfig {
  database: DatabaseInfrastructureConfig;
  redis: RedisInfrastructureConfig;
  sqs: SqsInfrastructureConfig;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requiredSensitive(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  if (/[\0\r\n]/.test(value)) {
    throw new Error(`${name} contains unsupported control characters`);
  }
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function requiredPort(env: NodeJS.ProcessEnv, name: string): number {
  const raw = required(env, name);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function serviceHostname(env: NodeJS.ProcessEnv, name: string): string {
  const hostname = required(env, name);
  if (!/^[A-Za-z0-9.-]+$/.test(hostname)) {
    throw new Error(`${name} must be a DNS hostname`);
  }
  return hostname;
}

function hasAny(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  return names.some((name) => Boolean(optional(env, name)));
}

const DATABASE_COMPONENT_NAMES = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
] as const;

function databaseConnectionString(env: NodeJS.ProcessEnv): string {
  const directUrl = optional(env, 'DATABASE_URL');
  if (directUrl) {
    if (hasAny(env, DATABASE_COMPONENT_NAMES)) {
      throw new Error(
        'Configure DATABASE_URL or the DATABASE_* connection components, but not both',
      );
    }
    return directUrl;
  }

  const hostname = serviceHostname(env, 'DATABASE_HOST');
  const port = requiredPort(env, 'DATABASE_PORT');
  const database = required(env, 'DATABASE_NAME');
  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(database)) {
    throw new Error(
      'DATABASE_NAME must start with a letter and contain only letters, numbers, or _',
    );
  }

  const username = required(env, 'DATABASE_USERNAME');
  const password = requiredSensitive(env, 'DATABASE_PASSWORD');
  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostname}:${port}/${encodeURIComponent(database)}`;
}

const REDIS_COMPONENT_NAMES = ['REDIS_HOST', 'REDIS_PORT', 'REDIS_AUTH_TOKEN'] as const;

function redisConnectionString(env: NodeJS.ProcessEnv): string {
  const directUrl = optional(env, 'REDIS_URL');
  if (directUrl) {
    if (hasAny(env, REDIS_COMPONENT_NAMES)) {
      throw new Error('Configure REDIS_URL or the REDIS_* connection components, but not both');
    }
    return directUrl;
  }

  const hostname = serviceHostname(env, 'REDIS_HOST');
  const port = requiredPort(env, 'REDIS_PORT');
  const authToken = requiredSensitive(env, 'REDIS_AUTH_TOKEN');
  return `rediss://:${encodeURIComponent(authToken)}@${hostname}:${port}`;
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function loadCaBundle(path: string): string {
  let ca: string;
  try {
    ca = readFileSync(path, 'utf8');
  } catch {
    throw new Error('NODE_EXTRA_CA_CERTS must reference a readable CA bundle');
  }

  try {
    const certificates = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates?.length) {
      throw new Error('CA bundle contains no certificates');
    }
    for (const certificate of certificates) {
      new X509Certificate(certificate);
    }
    createSecureContext({ ca });
  } catch {
    throw new Error('NODE_EXTRA_CA_CERTS must contain a valid PEM CA bundle');
  }
  return ca;
}

function databaseSsl(env: NodeJS.ProcessEnv): false | { rejectUnauthorized: boolean; ca?: string } {
  const mode = (env.DATABASE_SSL_MODE ?? 'disable').toLowerCase();
  const managedComponents = !optional(env, 'DATABASE_URL');
  const caPath = optional(env, 'NODE_EXTRA_CA_CERTS');
  if (managedComponents) {
    if (mode !== 'verify-full') {
      throw new Error(
        'Managed DATABASE_* connection components require DATABASE_SSL_MODE=verify-full',
      );
    }
    if (!caPath) {
      throw new Error('Managed DATABASE_* connection components require NODE_EXTRA_CA_CERTS');
    }
  }
  switch (mode) {
    case 'disable':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-full': {
      const ca = caPath ? loadCaBundle(caPath) : undefined;
      return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
    }
    default:
      throw new Error('DATABASE_SSL_MODE must be one of disable, require, or verify-full');
  }
}

/**
 * Reads infrastructure settings once at provider construction time. Required
 * values intentionally have no production fallback, preventing an accidental
 * connection to a developer service.
 */
export function loadInfrastructureConfig(
  env: NodeJS.ProcessEnv = process.env,
): InfrastructureConfig {
  const endpoint = env.SQS_ENDPOINT?.trim();

  return {
    database: {
      connectionString: databaseConnectionString(env),
      poolMax: positiveInteger(env, 'DATABASE_POOL_MAX', 10, 100),
      statementTimeoutMs: positiveInteger(env, 'DATABASE_STATEMENT_TIMEOUT_MS', 15_000, 300_000),
      ssl: databaseSsl(env),
    },
    redis: {
      url: redisConnectionString(env),
      keyPrefix: required(env, 'REDIS_KEY_PREFIX'),
      connectTimeoutMs: positiveInteger(env, 'REDIS_CONNECT_TIMEOUT_MS', 5_000, 60_000),
      commandTimeoutMs: positiveInteger(env, 'REDIS_COMMAND_TIMEOUT_MS', 2_000, 60_000),
    },
    sqs: {
      region: env.AWS_REGION?.trim() || 'us-east-1',
      ...(endpoint ? { endpoint } : {}),
      queueUrl: required(env, 'SQS_QUEUE_URL'),
      deadLetterQueueUrl: required(env, 'SQS_DEAD_LETTER_QUEUE_URL'),
      sdkMaxAttempts: positiveInteger(env, 'SQS_SDK_MAX_ATTEMPTS', 3, 10),
      maxReceiveCount: positiveInteger(env, 'SQS_MAX_RECEIVE_COUNT', 3, 100),
      visibilityTimeoutSeconds: positiveInteger(env, 'SQS_VISIBILITY_TIMEOUT_SECONDS', 30, 43_200),
      retryBaseDelaySeconds: positiveInteger(env, 'SQS_RETRY_BASE_DELAY_SECONDS', 1, 900),
      retryMaxDelaySeconds: positiveInteger(env, 'SQS_RETRY_MAX_DELAY_SECONDS', 60, 900),
    },
  };
}
