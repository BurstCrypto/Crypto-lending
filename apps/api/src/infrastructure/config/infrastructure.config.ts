import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';

export interface DatabaseInfrastructureConfig {
  connectionString: string;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  lockTimeoutMs: number;
  maxLifetimeSeconds: number;
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
  requestTimeoutMs: number;
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

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV?.trim().toLowerCase() === 'production';
}

function parseUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function productionDatabaseUrl(value: string, variableName: string): string {
  const parsedUrl = parseUrl(value, variableName);
  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new Error(`Production ${variableName} must use postgresql:// or postgres://`);
  }

  const parameters = [...parsedUrl.searchParams.entries()];
  const urlSslModes = parameters
    .filter(([name]) => name.toLowerCase() === 'sslmode')
    .map(([, urlSslMode]) => urlSslMode.toLowerCase());
  if (urlSslModes.some((urlSslMode) => urlSslMode !== 'verify-full')) {
    throw new Error(`Production ${variableName} cannot override sslmode below verify-full`);
  }
  const unsupportedParameter = parameters.find(([name]) => name.toLowerCase() !== 'sslmode');
  if (unsupportedParameter) {
    throw new Error(
      `Production ${variableName} cannot contain connection parameter ${unsupportedParameter[0]}`,
    );
  }
  if (value.includes('#')) {
    throw new Error(`Production ${variableName} must not contain a fragment`);
  }
  if (parameters.length === 0 && value.includes('?')) {
    throw new Error(`Production ${variableName} must not contain an empty query delimiter`);
  }

  // node-postgres parses connection-string parameters after explicit Pool
  // options. Only a duplicate, verified sslmode is accepted and then all query
  // text is removed so pool safety and observability settings stay authoritative.
  parsedUrl.search = '';
  return parsedUrl.toString();
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

interface DatabaseConnectionVariables {
  directUrl: string;
  hostname: string;
  port: string;
  database: string;
  username: string;
  password: string;
  sslMode: string;
  expectedProductionUsername?: string;
}

const LEGACY_DATABASE_VARIABLES: DatabaseConnectionVariables = {
  directUrl: 'DATABASE_URL',
  hostname: 'DATABASE_HOST',
  port: 'DATABASE_PORT',
  database: 'DATABASE_NAME',
  username: 'DATABASE_USERNAME',
  password: 'DATABASE_PASSWORD',
  sslMode: 'DATABASE_SSL_MODE',
};

const RUNTIME_DATABASE_VARIABLES: DatabaseConnectionVariables = {
  directUrl: 'DATABASE_RUNTIME_URL',
  hostname: 'DATABASE_RUNTIME_HOST',
  port: 'DATABASE_RUNTIME_PORT',
  database: 'DATABASE_RUNTIME_NAME',
  username: 'DATABASE_RUNTIME_USERNAME',
  password: 'DATABASE_RUNTIME_PASSWORD',
  sslMode: 'DATABASE_RUNTIME_SSL_MODE',
  expectedProductionUsername: 'crypto_runtime',
};

const MIGRATION_DATABASE_VARIABLES: DatabaseConnectionVariables = {
  directUrl: 'MIGRATION_DATABASE_URL',
  hostname: 'MIGRATION_DATABASE_HOST',
  port: 'MIGRATION_DATABASE_PORT',
  database: 'MIGRATION_DATABASE_NAME',
  username: 'MIGRATION_DATABASE_USERNAME',
  password: 'MIGRATION_DATABASE_PASSWORD',
  sslMode: 'MIGRATION_DATABASE_SSL_MODE',
  expectedProductionUsername: 'crypto_admin',
};

function connectionVariableNames(variables: DatabaseConnectionVariables): readonly string[] {
  return [
    variables.directUrl,
    variables.hostname,
    variables.port,
    variables.database,
    variables.username,
    variables.password,
    variables.sslMode,
  ];
}

function databaseConnectionString(
  env: NodeJS.ProcessEnv,
  variables: DatabaseConnectionVariables,
): string {
  const directUrl = optional(env, variables.directUrl);
  const componentNames = [
    variables.hostname,
    variables.port,
    variables.database,
    variables.username,
    variables.password,
  ];
  if (directUrl) {
    if (hasAny(env, componentNames)) {
      throw new Error(
        `Configure ${variables.directUrl} or the ${variables.hostname}/${variables.port}/${variables.database}/${variables.username}/${variables.password} connection components, but not both`,
      );
    }
    if (!isProduction(env)) {
      return directUrl;
    }
    const normalizedUrl = productionDatabaseUrl(directUrl, variables.directUrl);
    const parsedUrl = new URL(normalizedUrl);
    const expectedUsername = variables.expectedProductionUsername;
    let username: string;
    try {
      username = decodeURIComponent(parsedUrl.username);
    } catch {
      throw new Error(`Production ${variables.directUrl} username must use valid URL encoding`);
    }
    if (!expectedUsername || username !== expectedUsername || !parsedUrl.password) {
      throw new Error(
        `Production ${variables.directUrl} must contain the reviewed ${expectedUsername ?? 'scoped'} username and a password`,
      );
    }
    return normalizedUrl;
  }

  const hostname = serviceHostname(env, variables.hostname);
  const port = requiredPort(env, variables.port);
  const database = required(env, variables.database);
  if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(database)) {
    throw new Error(
      `${variables.database} must start with a letter and contain only letters, numbers, or _`,
    );
  }

  const username = required(env, variables.username);
  const password = requiredSensitive(env, variables.password);
  if (
    isProduction(env) &&
    variables.expectedProductionUsername &&
    username !== variables.expectedProductionUsername
  ) {
    throw new Error(
      `Production ${variables.username} must equal ${variables.expectedProductionUsername}`,
    );
  }
  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostname}:${port}/${encodeURIComponent(database)}`;
}

const REDIS_COMPONENT_NAMES = ['REDIS_HOST', 'REDIS_PORT', 'REDIS_AUTH_TOKEN'] as const;

function redisConnectionString(env: NodeJS.ProcessEnv): string {
  const directUrl = optional(env, 'REDIS_URL');
  if (directUrl) {
    if (isProduction(env) && /[\0\r\n]/u.test(directUrl)) {
      throw new Error('Production REDIS_URL must include a non-empty, valid password');
    }
    if (hasAny(env, REDIS_COMPONENT_NAMES)) {
      throw new Error('Configure REDIS_URL or the REDIS_* connection components, but not both');
    }
    const parsedUrl = parseUrl(directUrl, 'REDIS_URL');
    if (!['redis:', 'rediss:'].includes(parsedUrl.protocol)) {
      throw new Error('REDIS_URL must use redis:// or rediss://');
    }
    if (!parsedUrl.hostname) {
      throw new Error('REDIS_URL must use an authority-form URL with a hostname');
    }
    if ([...parsedUrl.searchParams.keys()].some((name) => name.toLowerCase() === 'tls')) {
      throw new Error('REDIS_URL cannot override TLS through query parameters');
    }
    if (isProduction(env) && parsedUrl.protocol !== 'rediss:') {
      throw new Error('Production REDIS_URL must use rediss://');
    }
    if (isProduction(env) && (directUrl.includes('?') || directUrl.includes('#'))) {
      throw new Error('Production REDIS_URL must not contain a query or fragment');
    }
    if (isProduction(env)) {
      let password: string;
      try {
        password = decodeURIComponent(parsedUrl.password);
      } catch {
        throw new Error('Production REDIS_URL must include a non-empty, valid password');
      }
      if (!password.trim() || /[\0\r\n]/u.test(password)) {
        throw new Error('Production REDIS_URL must include a non-empty, valid password');
      }
    }
    // ioredis detects rediss:// case-sensitively. URL serialization normalizes
    // the protocol so a valid mixed-case input cannot silently disable TLS.
    return parsedUrl.toString();
  }

  const hostname = serviceHostname(env, 'REDIS_HOST');
  const port = requiredPort(env, 'REDIS_PORT');
  const authToken = requiredSensitive(env, 'REDIS_AUTH_TOKEN');
  return `rediss://:${encodeURIComponent(authToken)}@${hostname}:${port}`;
}

function productionSqsQueueUrl(value: string, name: string, region: string): string {
  const parsedUrl = parseUrl(value, name);
  const awsSqsHostnames = new Set([
    `sqs.${region}.amazonaws.com`,
    `sqs.${region}.amazonaws.com.cn`,
    `sqs.${region}.amazonaws.eu`,
    `sqs.${region}.c2s.ic.gov`,
    `sqs.${region}.sc2s.sgov.gov`,
    `sqs.${region}.cloud.adc-e.uk`,
    `sqs.${region}.csp.hci.ic.gov`,
  ]);
  // This adapter does not supply FIFO MessageGroupId values, so accepting a
  // .fifo URL would defer an invalid configuration to every publish attempt.
  const pathMatch = parsedUrl.pathname.match(/^\/(\d{12})\/([A-Za-z0-9_-]{1,80})$/u);
  if (
    parsedUrl.protocol !== 'https:' ||
    !awsSqsHostnames.has(parsedUrl.hostname) ||
    (parsedUrl.port !== '' && parsedUrl.port !== '443') ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== '' ||
    value.includes('?') ||
    value.includes('#') ||
    !pathMatch
  ) {
    throw new Error(`${name} must be a canonical HTTPS SQS queue URL for AWS_REGION`);
  }

  return parsedUrl.toString();
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

function databaseSsl(
  env: NodeJS.ProcessEnv,
  variables: DatabaseConnectionVariables,
): false | { rejectUnauthorized: boolean; ca?: string } {
  const mode = (env[variables.sslMode] ?? 'disable').toLowerCase();
  const directUrl = optional(env, variables.directUrl);
  const managedComponents = !directUrl;
  const caPath = optional(env, 'NODE_EXTRA_CA_CERTS');
  if (managedComponents) {
    if (mode !== 'verify-full') {
      throw new Error(
        `Managed ${variables.hostname} connection components require ${variables.sslMode}=verify-full`,
      );
    }
    if (!caPath) {
      throw new Error(
        `Managed ${variables.hostname} connection components require NODE_EXTRA_CA_CERTS`,
      );
    }
  }
  if (isProduction(env) && directUrl) {
    if (mode !== 'verify-full') {
      throw new Error(
        `Production ${variables.directUrl} requires ${variables.sslMode}=verify-full`,
      );
    }
    productionDatabaseUrl(directUrl, variables.directUrl);
    if (!caPath) {
      throw new Error(`Production ${variables.directUrl} requires NODE_EXTRA_CA_CERTS`);
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
      throw new Error(`${variables.sslMode} must be one of disable, require, or verify-full`);
  }
}

function databaseSettings(
  env: NodeJS.ProcessEnv,
  variables: DatabaseConnectionVariables,
  tuningPrefix: 'DATABASE' | 'MIGRATION_DATABASE',
): DatabaseInfrastructureConfig {
  const migration = tuningPrefix === 'MIGRATION_DATABASE';
  return {
    connectionString: databaseConnectionString(env, variables),
    connectionTimeoutMs: positiveInteger(
      env,
      `${tuningPrefix}_CONNECTION_TIMEOUT_MS`,
      5_000,
      60_000,
    ),
    idleTimeoutMs: positiveInteger(env, `${tuningPrefix}_IDLE_TIMEOUT_MS`, 30_000, 600_000),
    lockTimeoutMs: positiveInteger(
      env,
      `${tuningPrefix}_LOCK_TIMEOUT_MS`,
      migration ? 10_000 : 5_000,
      migration ? 300_000 : 60_000,
    ),
    maxLifetimeSeconds: positiveInteger(env, `${tuningPrefix}_MAX_LIFETIME_SECONDS`, 1_800, 86_400),
    poolMax: migration ? 1 : positiveInteger(env, 'DATABASE_POOL_MAX', 10, 100),
    statementTimeoutMs: positiveInteger(
      env,
      `${tuningPrefix}_STATEMENT_TIMEOUT_MS`,
      migration ? 3_600_000 : 15_000,
      migration ? 43_200_000 : 300_000,
    ),
    ssl: databaseSsl(env, variables),
  };
}

function assertNoConfiguredVariables(
  env: NodeJS.ProcessEnv,
  variables: DatabaseConnectionVariables,
  message: string,
): void {
  if (connectionVariableNames(variables).some((name) => env[name] !== undefined)) {
    throw new Error(message);
  }
}

function runtimeDatabaseSettings(env: NodeJS.ProcessEnv): DatabaseInfrastructureConfig {
  const scopedConfigured = hasAny(env, connectionVariableNames(RUNTIME_DATABASE_VARIABLES));
  const legacyConfigured = hasAny(env, connectionVariableNames(LEGACY_DATABASE_VARIABLES));

  if (isProduction(env)) {
    assertNoConfiguredVariables(
      env,
      MIGRATION_DATABASE_VARIABLES,
      'Production runtime must not receive MIGRATION_DATABASE_* connection variables',
    );
    assertNoConfiguredVariables(
      env,
      LEGACY_DATABASE_VARIABLES,
      'Production runtime requires DATABASE_RUNTIME_* connection variables; legacy DATABASE_* credentials are not allowed',
    );
    return databaseSettings(env, RUNTIME_DATABASE_VARIABLES, 'DATABASE');
  }

  if (scopedConfigured && legacyConfigured) {
    throw new Error(
      'Configure scoped DATABASE_RUNTIME_* variables or legacy local DATABASE_* variables, but not both',
    );
  }
  return databaseSettings(
    env,
    scopedConfigured ? RUNTIME_DATABASE_VARIABLES : LEGACY_DATABASE_VARIABLES,
    'DATABASE',
  );
}

/**
 * Loads only the privileged migration connection. Production migration tasks
 * cannot fall back to runtime or legacy credentials and do not need Redis/SQS
 * configuration merely to apply schema changes.
 */
export function loadMigrationDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseInfrastructureConfig {
  const migrationConfigured = hasAny(env, connectionVariableNames(MIGRATION_DATABASE_VARIABLES));

  if (isProduction(env)) {
    assertNoConfiguredVariables(
      env,
      RUNTIME_DATABASE_VARIABLES,
      'Production migration tasks must not receive DATABASE_RUNTIME_* connection variables',
    );
    assertNoConfiguredVariables(
      env,
      LEGACY_DATABASE_VARIABLES,
      'Production migration tasks require MIGRATION_DATABASE_* connection variables; legacy DATABASE_* credentials are not allowed',
    );
    return databaseSettings(env, MIGRATION_DATABASE_VARIABLES, 'MIGRATION_DATABASE');
  }

  if (migrationConfigured) {
    return databaseSettings(env, MIGRATION_DATABASE_VARIABLES, 'MIGRATION_DATABASE');
  }

  // Compatibility for existing local-only environments. Production never
  // reaches this path, and checked-in examples/CI set MIGRATION_DATABASE_URL.
  const runtime = runtimeDatabaseSettings(env);
  return {
    ...runtime,
    lockTimeoutMs: positiveInteger(env, 'MIGRATION_DATABASE_LOCK_TIMEOUT_MS', 10_000, 300_000),
    poolMax: 1,
    statementTimeoutMs: positiveInteger(
      env,
      'MIGRATION_DATABASE_STATEMENT_TIMEOUT_MS',
      3_600_000,
      43_200_000,
    ),
  };
}

/**
 * Reads infrastructure settings once at provider construction time. Required
 * values intentionally have no production fallback, preventing an accidental
 * connection to a developer service.
 */
export function loadInfrastructureConfig(
  env: NodeJS.ProcessEnv = process.env,
): InfrastructureConfig {
  const region = env.AWS_REGION?.trim() || 'us-east-1';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/u.test(region)) {
    throw new Error('AWS_REGION must be a canonical AWS region identifier');
  }
  const endpoint = env.SQS_ENDPOINT?.trim();
  if (isProduction(env) && endpoint) {
    throw new Error('SQS_ENDPOINT is not allowed in production');
  }
  const rawQueueUrl = required(env, 'SQS_QUEUE_URL');
  const rawDeadLetterQueueUrl = required(env, 'SQS_DEAD_LETTER_QUEUE_URL');
  const queueUrl = isProduction(env)
    ? productionSqsQueueUrl(rawQueueUrl, 'SQS_QUEUE_URL', region)
    : rawQueueUrl;
  const deadLetterQueueUrl = isProduction(env)
    ? productionSqsQueueUrl(rawDeadLetterQueueUrl, 'SQS_DEAD_LETTER_QUEUE_URL', region)
    : rawDeadLetterQueueUrl;
  if (queueUrl === deadLetterQueueUrl) {
    throw new Error('SQS_QUEUE_URL and SQS_DEAD_LETTER_QUEUE_URL must be different');
  }

  return {
    database: runtimeDatabaseSettings(env),
    redis: {
      url: redisConnectionString(env),
      keyPrefix: required(env, 'REDIS_KEY_PREFIX'),
      connectTimeoutMs: positiveInteger(env, 'REDIS_CONNECT_TIMEOUT_MS', 5_000, 60_000),
      commandTimeoutMs: positiveInteger(env, 'REDIS_COMMAND_TIMEOUT_MS', 2_000, 60_000),
    },
    sqs: {
      region,
      ...(endpoint ? { endpoint } : {}),
      queueUrl,
      deadLetterQueueUrl,
      requestTimeoutMs: positiveInteger(env, 'SQS_REQUEST_TIMEOUT_MS', 15_000, 60_000),
      sdkMaxAttempts: positiveInteger(env, 'SQS_SDK_MAX_ATTEMPTS', 3, 10),
      maxReceiveCount: positiveInteger(env, 'SQS_MAX_RECEIVE_COUNT', 3, 100),
      visibilityTimeoutSeconds: positiveInteger(env, 'SQS_VISIBILITY_TIMEOUT_SECONDS', 30, 43_200),
      retryBaseDelaySeconds: positiveInteger(env, 'SQS_RETRY_BASE_DELAY_SECONDS', 1, 900),
      retryMaxDelaySeconds: positiveInteger(env, 'SQS_RETRY_MAX_DELAY_SECONDS', 60, 900),
    },
  };
}
