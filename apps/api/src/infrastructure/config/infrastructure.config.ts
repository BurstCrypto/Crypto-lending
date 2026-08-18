export interface DatabaseInfrastructureConfig {
  connectionString: string;
  poolMax: number;
  statementTimeoutMs: number;
  ssl: false | { rejectUnauthorized: boolean };
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

function databaseSsl(env: NodeJS.ProcessEnv): false | { rejectUnauthorized: boolean } {
  const mode = (env.DATABASE_SSL_MODE ?? 'disable').toLowerCase();
  switch (mode) {
    case 'disable':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-full':
      return { rejectUnauthorized: true };
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
      connectionString: required(env, 'DATABASE_URL'),
      poolMax: positiveInteger(env, 'DATABASE_POOL_MAX', 10, 100),
      statementTimeoutMs: positiveInteger(env, 'DATABASE_STATEMENT_TIMEOUT_MS', 15_000, 300_000),
      ssl: databaseSsl(env),
    },
    redis: {
      url: required(env, 'REDIS_URL'),
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
