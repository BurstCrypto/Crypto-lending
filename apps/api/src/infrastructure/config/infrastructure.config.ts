import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';

import { BALANCE_SYNC_POLICY } from '../../blockchain-sync/domain/balance-sync';
import {
  configuredRedisEnvironmentVariableNames,
  hasRedisEnvironmentVariables,
} from './redis-environment';

export interface DatabaseInfrastructureConfig {
  connectionString: string;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  lockTimeoutMs: number;
  maxLifetimeSeconds: number;
  poolMax: number;
  statementTimeoutMs: number;
  ssl: false | { rejectUnauthorized: boolean; ca?: string };
  sessionRole?: string;
}

interface RuntimeDatabaseTimeoutLimits {
  readonly connectionTimeoutMs: number;
  readonly lockTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

export const BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS: Readonly<RuntimeDatabaseTimeoutLimits> =
  Object.freeze({
    connectionTimeoutMs: 5_000,
    lockTimeoutMs: 5_000,
    statementTimeoutMs: 15_000,
  });

const DEFAULT_RUNTIME_DATABASE_TIMEOUT_LIMITS: Readonly<RuntimeDatabaseTimeoutLimits> =
  Object.freeze({
    connectionTimeoutMs: 60_000,
    lockTimeoutMs: 60_000,
    statementTimeoutMs: 300_000,
  });

export interface RedisInfrastructureConfig {
  url: string;
  username?: string;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
}

export type ApplicationWorkload = 'api' | 'worker' | 'balance-consumer';

export interface SqsClientInfrastructureConfig {
  region: string;
  endpoint?: string;
  credentialRelativeUri?: string;
  requestTimeoutMs: number;
  sdkMaxAttempts: number;
  maxReceiveCount: number;
  visibilityTimeoutSeconds: number;
  retryBaseDelaySeconds: number;
  retryMaxDelaySeconds: number;
}

export interface SqsInfrastructureConfig extends SqsClientInfrastructureConfig {
  queueUrl: string;
  deadLetterQueueUrl: string;
  balanceQueueUrl: string;
  balanceDeadLetterQueueUrl: string;
}

export interface BalanceConsumerSqsInfrastructureConfig extends SqsClientInfrastructureConfig {
  balanceQueueUrl: string;
  balanceDeadLetterQueueUrl: string;
}

export interface InfrastructureConfig {
  workload: 'api' | 'worker';
  database: DatabaseInfrastructureConfig;
  redis?: RedisInfrastructureConfig;
  sqs: SqsInfrastructureConfig;
}

export interface BalanceConsumerInfrastructureConfig {
  workload: 'balance-consumer';
  database: DatabaseInfrastructureConfig;
  sqs: BalanceConsumerSqsInfrastructureConfig;
}

export type RuntimeInfrastructureConfig =
  InfrastructureConfig | BalanceConsumerInfrastructureConfig;

type SqsReceiptRedrivePolicy = Pick<
  SqsClientInfrastructureConfig,
  'maxReceiveCount' | 'retryBaseDelaySeconds' | 'retryMaxDelaySeconds'
>;

/**
 * Native source-receipt visibility plus the queue's redrive policy are the
 * balance consumer's only retry/DLQ authority. These values therefore remain
 * identical to the domain attempt policy instead of inheriting generic worker
 * defaults.
 */
export const BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY = Object.freeze({
  maxReceiveCount: BALANCE_SYNC_POLICY.maxAttempts,
  retryBaseDelaySeconds: BALANCE_SYNC_POLICY.retryBaseDelaySeconds,
  retryMaxDelaySeconds: BALANCE_SYNC_POLICY.retryMaximumDelaySeconds,
} as const) satisfies SqsReceiptRedrivePolicy;

export function assertBalanceConsumerSqsReceiptRedrivePolicy(
  policy: SqsReceiptRedrivePolicy,
): void {
  if (
    policy.maxReceiveCount !== BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY.maxReceiveCount ||
    policy.retryBaseDelaySeconds !==
      BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY.retryBaseDelaySeconds ||
    policy.retryMaxDelaySeconds !== BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY.retryMaxDelaySeconds
  ) {
    throw new Error(
      'Balance-consumer SQS receipt redrive policy must exactly match BALANCE_SYNC_POLICY',
    );
  }
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

function assertNoProductionTlsVerificationOverride(env: NodeJS.ProcessEnv): void {
  if (isProduction(env) && env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined) {
    throw new Error(
      'Production processes must not set NODE_TLS_REJECT_UNAUTHORIZED; certificate verification is pinned',
    );
  }
}

function applicationWorkload(env: NodeJS.ProcessEnv): ApplicationWorkload {
  const configured = env.APPLICATION_WORKLOAD;
  if (configured === undefined || configured === '') {
    if (isProduction(env)) {
      throw new Error(
        'Production runtime requires APPLICATION_WORKLOAD=api, worker, or balance-consumer',
      );
    }
    return 'api';
  }
  if (configured !== 'api' && configured !== 'worker' && configured !== 'balance-consumer') {
    throw new Error('APPLICATION_WORKLOAD must be exactly api, worker, or balance-consumer');
  }
  return configured;
}

function applicationEnvironment(env: NodeJS.ProcessEnv): string | undefined {
  const configured = optional(env, 'APP_ENV');
  if (configured === undefined) {
    if (isProduction(env)) {
      throw new Error('Production runtime requires APP_ENV');
    }
    return undefined;
  }
  if (!/^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/u.test(configured)) {
    throw new Error('APP_ENV must be a canonical reviewed environment name');
  }
  return configured;
}

const PRODUCTION_AWS_CREDENTIAL_OVERRIDES = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
  'AWS_ROLE_ARN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_ENDPOINT_URL',
  'AWS_ENDPOINT_URL_SQS',
  'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS',
] as const;

function assertNoProductionAwsCredentialOverrides(env: NodeJS.ProcessEnv): void {
  const configured = PRODUCTION_AWS_CREDENTIAL_OVERRIDES.filter(
    (variableName) => env[variableName] !== undefined,
  );
  if (configured.length > 0) {
    throw new Error(
      `Production runtime must use the ECS task role; remove AWS credential overrides: ${configured.join(', ')}`,
    );
  }
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
  expectedProductionUsernamePattern?: RegExp;
  expectedProductionUsernameDescription?: string;
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
};

const MIGRATION_DATABASE_VARIABLES: DatabaseConnectionVariables = {
  directUrl: 'MIGRATION_DATABASE_URL',
  hostname: 'MIGRATION_DATABASE_HOST',
  port: 'MIGRATION_DATABASE_PORT',
  database: 'MIGRATION_DATABASE_NAME',
  username: 'MIGRATION_DATABASE_USERNAME',
  password: 'MIGRATION_DATABASE_PASSWORD',
  sslMode: 'MIGRATION_DATABASE_SSL_MODE',
  expectedProductionUsernamePattern: /^crypto_migration$/u,
  expectedProductionUsernameDescription: 'crypto_migration',
};

function runtimeDatabaseVariables(workload: ApplicationWorkload): DatabaseConnectionVariables {
  const loginPrefix =
    workload === 'api'
      ? 'crypto_api_login_'
      : workload === 'worker'
        ? 'crypto_worker_login_'
        : 'crypto_balance_consumer_login_';
  return {
    ...RUNTIME_DATABASE_VARIABLES,
    expectedProductionUsernamePattern: new RegExp(`^${loginPrefix}[a-z0-9]{1,32}$`, 'u'),
    expectedProductionUsernameDescription: `${loginPrefix}<rotation-id>`,
  };
}

function runtimeDatabaseSessionRole(workload: ApplicationWorkload): string {
  if (workload === 'api') return 'crypto_api_runtime';
  if (workload === 'worker') return 'crypto_worker_runtime';
  return 'crypto_balance_consumer_runtime';
}

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
    const expectedUsernamePattern = variables.expectedProductionUsernamePattern;
    const expectedUsernameDescription = variables.expectedProductionUsernameDescription;
    let username: string;
    try {
      username = decodeURIComponent(parsedUrl.username);
    } catch {
      throw new Error(`Production ${variables.directUrl} username must use valid URL encoding`);
    }
    if (!expectedUsernamePattern?.test(username) || !parsedUrl.password) {
      throw new Error(
        `Production ${variables.directUrl} must contain the reviewed ${expectedUsernameDescription ?? 'scoped'} username and a password`,
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
    variables.expectedProductionUsernamePattern &&
    !variables.expectedProductionUsernamePattern.test(username)
  ) {
    throw new Error(
      `Production ${variables.username} must match ${variables.expectedProductionUsernameDescription ?? 'the reviewed scoped identity'}`,
    );
  }
  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostname}:${port}/${encodeURIComponent(database)}`;
}

const REDIS_COMPONENT_NAMES = [
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_TLS',
  'REDIS_USERNAME',
  'REDIS_PASSWORD',
] as const;

const REDIS_ENVIRONMENT_VARIABLES = [
  'REDIS_URL',
  ...REDIS_COMPONENT_NAMES,
  'REDIS_AUTH_TOKEN',
  'REDIS_KEY_PREFIX',
  'REDIS_CONNECT_TIMEOUT_MS',
  'REDIS_COMMAND_TIMEOUT_MS',
] as const;

const REVIEWED_REDIS_ENVIRONMENT_VARIABLES = new Set<string>(REDIS_ENVIRONMENT_VARIABLES);
const PRIVILEGED_DATABASE_ENVIRONMENT_VARIABLE =
  /^(?:DATABASE|POSTGRES|RDS)_(?:ADMIN|BOOTSTRAP|MASTER)(?:_|$)/u;

function configuredEnvironmentVariableNamesWithPrefix(
  env: NodeJS.ProcessEnv,
  prefix: string,
): readonly string[] {
  return Object.keys(env).filter(
    (variableName) => variableName.startsWith(prefix) && env[variableName] !== undefined,
  );
}

function hasPrivilegedDatabaseEnvironmentVariables(env: NodeJS.ProcessEnv): boolean {
  return Object.keys(env).some(
    (variableName) =>
      PRIVILEGED_DATABASE_ENVIRONMENT_VARIABLE.test(variableName) &&
      env[variableName] !== undefined,
  );
}

function assertNoUnknownProductionRedisVariables(env: NodeJS.ProcessEnv): void {
  const unknown = configuredRedisEnvironmentVariableNames(env).filter(
    (variableName) => !REVIEWED_REDIS_ENVIRONMENT_VARIABLES.has(variableName),
  );
  if (unknown.length > 0) {
    throw new Error('Production API must not receive an unreviewed REDIS_* environment variable');
  }
}

function redisUsername(value: string, production: boolean, expectedEnvironment?: string): string {
  let username: string;
  try {
    username = decodeURIComponent(value);
  } catch {
    throw new Error('REDIS_USERNAME must use valid URL encoding');
  }
  if (
    production &&
    (!expectedEnvironment ||
      (username !== `crypto_api_${expectedEnvironment}_a` &&
        username !== `crypto_api_${expectedEnvironment}_b`))
  ) {
    throw new Error('Production API Redis username must match the active APP_ENV slot');
  }
  if (username && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(username)) {
    throw new Error('REDIS_USERNAME must be a canonical ACL username');
  }
  return username;
}

function redisTlsEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = optional(env, 'REDIS_TLS');
  if (value === undefined) {
    if (isProduction(env)) {
      throw new Error('Production managed Redis components require REDIS_TLS=true');
    }
    return false;
  }
  if (value !== 'true' && value !== 'false') {
    throw new Error('REDIS_TLS must be exactly true or false');
  }
  if (isProduction(env) && value !== 'true') {
    throw new Error('Production managed Redis components require REDIS_TLS=true');
  }
  return value === 'true';
}

function redisConnection(
  env: NodeJS.ProcessEnv,
  expectedEnvironment?: string,
): Pick<RedisInfrastructureConfig, 'url' | 'username'> {
  if (isProduction(env) && env.REDIS_AUTH_TOKEN !== undefined) {
    throw new Error('Production API must use REDIS_PASSWORD; REDIS_AUTH_TOKEN is forbidden');
  }
  if (isProduction(env) && env.REDIS_KEY_PREFIX !== undefined) {
    throw new Error('Production API must not receive REDIS_KEY_PREFIX; Redis is health-only');
  }
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
      if ((parsedUrl.pathname !== '' && parsedUrl.pathname !== '/') || parsedUrl.port !== '6379') {
        throw new Error('Production REDIS_URL must use database 0 and the reviewed port 6379');
      }
      let password: string;
      try {
        password = decodeURIComponent(parsedUrl.password);
      } catch {
        throw new Error('Production REDIS_URL must include a non-empty, valid password');
      }
      if (!password.trim() || /[\0\r\n]/u.test(password)) {
        throw new Error('Production REDIS_URL must include a non-empty, valid password');
      }
      const username = redisUsername(parsedUrl.username, true, expectedEnvironment);
      return { url: parsedUrl.toString(), username };
    }
    // ioredis detects rediss:// case-sensitively. URL serialization normalizes
    // the protocol so a valid mixed-case input cannot silently disable TLS.
    const username = redisUsername(parsedUrl.username, false, expectedEnvironment);
    return { url: parsedUrl.toString(), ...(username ? { username } : {}) };
  }

  const hostname = serviceHostname(env, 'REDIS_HOST');
  const port = requiredPort(env, 'REDIS_PORT');
  if (isProduction(env) && port !== 6379) {
    throw new Error('Production managed Redis components must use the reviewed port 6379');
  }
  const username = redisUsername(
    required(env, 'REDIS_USERNAME'),
    isProduction(env),
    expectedEnvironment,
  );
  const password = requiredSensitive(env, 'REDIS_PASSWORD');
  const protocol = redisTlsEnabled(env) ? 'rediss' : 'redis';
  return {
    url: `${protocol}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostname}:${port}`,
    username,
  };
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

function sqsQueueAccountAndName(value: string): readonly [accountId: string, queueName: string] {
  const match = new URL(value).pathname.match(/^\/(\d{12})\/([A-Za-z0-9_-]{1,80})$/u);
  if (!match) {
    throw new Error('Production balance-consumer SQS queue identity is invalid');
  }
  return [match[1]!, match[2]!] as const;
}

const GENERIC_JOB_QUEUE_VARIABLES = new Set(['SQS_QUEUE_URL', 'SQS_DEAD_LETTER_QUEUE_URL']);

const BALANCE_CONSUMER_SQS_VARIABLES = new Set([
  'SQS_ENDPOINT',
  'SQS_BALANCE_QUEUE_URL',
  'SQS_BALANCE_DEAD_LETTER_QUEUE_URL',
  'SQS_REQUEST_TIMEOUT_MS',
  'SQS_SDK_MAX_ATTEMPTS',
  'SQS_MAX_RECEIVE_COUNT',
  'SQS_VISIBILITY_TIMEOUT_SECONDS',
  'SQS_RETRY_BASE_DELAY_SECONDS',
  'SQS_RETRY_MAX_DELAY_SECONDS',
]);

function assertBalanceConsumerSqsEnvironment(env: NodeJS.ProcessEnv): void {
  const configuredNames = Object.keys(env).filter((name) => env[name] !== undefined);
  if (configuredNames.some((name) => GENERIC_JOB_QUEUE_VARIABLES.has(name))) {
    throw new Error('Balance-consumer runtime must not receive generic job queue configuration');
  }
  if (
    configuredNames.some((name) => {
      const canonicalName = name.toUpperCase();
      return (
        /(?:^|_)SQS(?:_|$)/u.test(canonicalName) &&
        (!BALANCE_CONSUMER_SQS_VARIABLES.has(name) || name !== canonicalName)
      );
    })
  ) {
    throw new Error('Balance-consumer runtime must not receive an unreviewed SQS configuration');
  }
}

function localSqsEndpoint(value: string): string {
  const parsedUrl = parseUrl(value, 'SQS_ENDPOINT');
  const localHostnames = new Set(['127.0.0.1', '[::1]', '::1', 'localhost', 'localstack']);
  if (
    parsedUrl.protocol !== 'http:' ||
    !localHostnames.has(parsedUrl.hostname.toLowerCase()) ||
    parsedUrl.port !== '4566' ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== '' ||
    parsedUrl.pathname !== '/' ||
    parsedUrl.search !== '' ||
    parsedUrl.hash !== ''
  ) {
    throw new Error('SQS_ENDPOINT must be the canonical local SQS emulator endpoint on port 4566');
  }
  return parsedUrl.origin;
}

function productionEcsCredentialRelativeUri(env: NodeJS.ProcessEnv): string {
  const value = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  if (
    value === undefined ||
    value !== value.trim() ||
    !/^\/v2\/credentials\/[A-Za-z0-9_-]{1,200}$/u.test(value)
  ) {
    throw new Error(
      'Production runtime requires a canonical ECS-managed AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    );
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
  sessionRole?: string,
  runtimeTimeoutLimits: Readonly<RuntimeDatabaseTimeoutLimits> = DEFAULT_RUNTIME_DATABASE_TIMEOUT_LIMITS,
): DatabaseInfrastructureConfig {
  const migration = tuningPrefix === 'MIGRATION_DATABASE';
  return {
    connectionString: databaseConnectionString(env, variables),
    connectionTimeoutMs: positiveInteger(
      env,
      `${tuningPrefix}_CONNECTION_TIMEOUT_MS`,
      5_000,
      migration ? 60_000 : runtimeTimeoutLimits.connectionTimeoutMs,
    ),
    idleTimeoutMs: positiveInteger(env, `${tuningPrefix}_IDLE_TIMEOUT_MS`, 30_000, 600_000),
    lockTimeoutMs: positiveInteger(
      env,
      `${tuningPrefix}_LOCK_TIMEOUT_MS`,
      migration ? 10_000 : 5_000,
      migration ? 300_000 : runtimeTimeoutLimits.lockTimeoutMs,
    ),
    maxLifetimeSeconds: positiveInteger(env, `${tuningPrefix}_MAX_LIFETIME_SECONDS`, 1_800, 86_400),
    poolMax: migration ? 1 : positiveInteger(env, 'DATABASE_POOL_MAX', 10, 100),
    statementTimeoutMs: positiveInteger(
      env,
      `${tuningPrefix}_STATEMENT_TIMEOUT_MS`,
      migration ? 3_600_000 : 15_000,
      migration ? 43_200_000 : runtimeTimeoutLimits.statementTimeoutMs,
    ),
    ssl: databaseSsl(env, variables),
    ...(sessionRole ? { sessionRole } : {}),
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

function runtimeDatabaseSettings(
  env: NodeJS.ProcessEnv,
  workload: ApplicationWorkload,
): DatabaseInfrastructureConfig {
  const scopedConfigured = hasAny(env, connectionVariableNames(RUNTIME_DATABASE_VARIABLES));
  const legacyConfigured = hasAny(env, connectionVariableNames(LEGACY_DATABASE_VARIABLES));
  const timeoutLimits =
    workload === 'balance-consumer'
      ? BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS
      : DEFAULT_RUNTIME_DATABASE_TIMEOUT_LIMITS;

  if (isProduction(env)) {
    if (configuredEnvironmentVariableNamesWithPrefix(env, 'MIGRATION_DATABASE_').length > 0) {
      throw new Error('Production runtime must not receive any MIGRATION_DATABASE_* variable');
    }
    if (hasPrivilegedDatabaseEnvironmentVariables(env)) {
      throw new Error(
        'Production runtime must not receive database bootstrap, master, or admin variables',
      );
    }
    assertNoConfiguredVariables(
      env,
      LEGACY_DATABASE_VARIABLES,
      'Production runtime requires DATABASE_RUNTIME_* connection variables; legacy DATABASE_* credentials are not allowed',
    );
    return databaseSettings(
      env,
      runtimeDatabaseVariables(workload),
      'DATABASE',
      runtimeDatabaseSessionRole(workload),
      timeoutLimits,
    );
  }

  if (scopedConfigured && legacyConfigured) {
    throw new Error(
      'Configure scoped DATABASE_RUNTIME_* variables or legacy local DATABASE_* variables, but not both',
    );
  }
  return databaseSettings(
    env,
    scopedConfigured ? runtimeDatabaseVariables(workload) : LEGACY_DATABASE_VARIABLES,
    'DATABASE',
    scopedConfigured ? runtimeDatabaseSessionRole(workload) : undefined,
    timeoutLimits,
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
    assertNoProductionTlsVerificationOverride(env);
    if (env.APPLICATION_WORKLOAD !== undefined) {
      throw new Error('Production migration tasks must not receive APPLICATION_WORKLOAD');
    }
    if (hasRedisEnvironmentVariables(env)) {
      throw new Error(
        'Production migration tasks must not receive Redis configuration or credentials',
      );
    }
    if (configuredEnvironmentVariableNamesWithPrefix(env, 'DATABASE_RUNTIME_').length > 0) {
      throw new Error(
        'Production migration tasks must not receive any DATABASE_RUNTIME_* variable',
      );
    }
    if (hasPrivilegedDatabaseEnvironmentVariables(env)) {
      throw new Error(
        'Production migration tasks must not receive database bootstrap, master, or admin variables',
      );
    }
    assertNoConfiguredVariables(
      env,
      LEGACY_DATABASE_VARIABLES,
      'Production migration tasks require MIGRATION_DATABASE_* connection variables; legacy DATABASE_* credentials are not allowed',
    );
    return databaseSettings(
      env,
      MIGRATION_DATABASE_VARIABLES,
      'MIGRATION_DATABASE',
      'crypto_schema_owner',
    );
  }

  if (migrationConfigured) {
    return databaseSettings(
      env,
      MIGRATION_DATABASE_VARIABLES,
      'MIGRATION_DATABASE',
      'crypto_schema_owner',
    );
  }

  // Compatibility for existing local-only environments. Production never
  // reaches this path, and checked-in examples/CI set MIGRATION_DATABASE_URL.
  const runtime = runtimeDatabaseSettings(env, applicationWorkload(env));
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

const GENERIC_SQS_RECEIPT_REDRIVE_DEFAULTS = Object.freeze({
  maxReceiveCount: 3,
  retryBaseDelaySeconds: 1,
  retryMaxDelaySeconds: 60,
}) satisfies SqsReceiptRedrivePolicy;

function loadSqsClientInfrastructureConfig(
  env: NodeJS.ProcessEnv,
  production: boolean,
  receiptRedriveDefaults: SqsReceiptRedrivePolicy = GENERIC_SQS_RECEIPT_REDRIVE_DEFAULTS,
): SqsClientInfrastructureConfig {
  const configuredRegion = env.AWS_REGION?.trim();
  if (production && !configuredRegion) {
    throw new Error('Production runtime requires AWS_REGION');
  }
  const region = configuredRegion || 'us-east-1';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+){2,}$/u.test(region)) {
    throw new Error('AWS_REGION must be a canonical AWS region identifier');
  }
  const rawEndpoint = env.SQS_ENDPOINT?.trim();
  if (production && rawEndpoint) {
    throw new Error('SQS_ENDPOINT is not allowed in production');
  }
  const endpoint = rawEndpoint ? localSqsEndpoint(rawEndpoint) : undefined;
  const credentialRelativeUri = production ? productionEcsCredentialRelativeUri(env) : undefined;
  return {
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(credentialRelativeUri ? { credentialRelativeUri } : {}),
    requestTimeoutMs: positiveInteger(env, 'SQS_REQUEST_TIMEOUT_MS', 15_000, 60_000),
    sdkMaxAttempts: positiveInteger(env, 'SQS_SDK_MAX_ATTEMPTS', 3, 10),
    maxReceiveCount: positiveInteger(
      env,
      'SQS_MAX_RECEIVE_COUNT',
      receiptRedriveDefaults.maxReceiveCount,
      100,
    ),
    visibilityTimeoutSeconds: positiveInteger(env, 'SQS_VISIBILITY_TIMEOUT_SECONDS', 30, 43_200),
    retryBaseDelaySeconds: positiveInteger(
      env,
      'SQS_RETRY_BASE_DELAY_SECONDS',
      receiptRedriveDefaults.retryBaseDelaySeconds,
      900,
    ),
    retryMaxDelaySeconds: positiveInteger(
      env,
      'SQS_RETRY_MAX_DELAY_SECONDS',
      receiptRedriveDefaults.retryMaxDelaySeconds,
      900,
    ),
  };
}

/**
 * Reads API/outbox-worker infrastructure settings once at provider
 * construction time. The balance consumer uses its smaller dedicated loader.
 */
export function loadInfrastructureConfig(
  env: NodeJS.ProcessEnv = process.env,
): InfrastructureConfig {
  const production = isProduction(env);
  const workload = applicationWorkload(env);
  if (workload === 'balance-consumer') {
    throw new Error(
      'Balance-consumer runtime requires the dedicated balance-consumer infrastructure loader',
    );
  }
  const environment = applicationEnvironment(env);
  if (production) {
    assertNoProductionTlsVerificationOverride(env);
    assertNoProductionAwsCredentialOverrides(env);
    if (workload === 'worker' && hasRedisEnvironmentVariables(env)) {
      throw new Error('Production worker must not receive Redis configuration or credentials');
    }
    if (workload === 'api') assertNoUnknownProductionRedisVariables(env);
  }
  const sqsClient = loadSqsClientInfrastructureConfig(env, production);
  const rawQueueUrl = required(env, 'SQS_QUEUE_URL');
  const rawDeadLetterQueueUrl = required(env, 'SQS_DEAD_LETTER_QUEUE_URL');
  const rawBalanceQueueUrl = required(env, 'SQS_BALANCE_QUEUE_URL');
  const rawBalanceDeadLetterQueueUrl = required(env, 'SQS_BALANCE_DEAD_LETTER_QUEUE_URL');
  const queueUrl = production
    ? productionSqsQueueUrl(rawQueueUrl, 'SQS_QUEUE_URL', sqsClient.region)
    : rawQueueUrl;
  const deadLetterQueueUrl = production
    ? productionSqsQueueUrl(rawDeadLetterQueueUrl, 'SQS_DEAD_LETTER_QUEUE_URL', sqsClient.region)
    : rawDeadLetterQueueUrl;
  const balanceQueueUrl = production
    ? productionSqsQueueUrl(rawBalanceQueueUrl, 'SQS_BALANCE_QUEUE_URL', sqsClient.region)
    : rawBalanceQueueUrl;
  const balanceDeadLetterQueueUrl = production
    ? productionSqsQueueUrl(
        rawBalanceDeadLetterQueueUrl,
        'SQS_BALANCE_DEAD_LETTER_QUEUE_URL',
        sqsClient.region,
      )
    : rawBalanceDeadLetterQueueUrl;
  if (
    new Set([queueUrl, deadLetterQueueUrl, balanceQueueUrl, balanceDeadLetterQueueUrl]).size !== 4
  ) {
    throw new Error('SQS source and dead-letter queue URLs must be pairwise different');
  }

  const redisConnectionSettings =
    workload === 'api' ? redisConnection(env, environment) : undefined;

  return {
    workload,
    database: runtimeDatabaseSettings(env, workload),
    ...(redisConnectionSettings
      ? {
          redis: {
            ...redisConnectionSettings,
            connectTimeoutMs: positiveInteger(env, 'REDIS_CONNECT_TIMEOUT_MS', 5_000, 60_000),
            commandTimeoutMs: positiveInteger(env, 'REDIS_COMMAND_TIMEOUT_MS', 2_000, 60_000),
          },
        }
      : {}),
    sqs: {
      ...sqsClient,
      queueUrl,
      deadLetterQueueUrl,
      balanceQueueUrl,
      balanceDeadLetterQueueUrl,
    },
  };
}

/**
 * Loads the future balance consumer without accepting generic job-queue
 * coordinates or publication configuration.
 */
export function loadBalanceConsumerInfrastructureConfig(
  env: NodeJS.ProcessEnv = process.env,
): BalanceConsumerInfrastructureConfig {
  const production = isProduction(env);
  const workload = applicationWorkload(env);
  if (workload !== 'balance-consumer') {
    throw new Error(
      'Balance-consumer infrastructure requires APPLICATION_WORKLOAD=balance-consumer',
    );
  }
  const environment = applicationEnvironment(env);
  assertBalanceConsumerSqsEnvironment(env);
  if (production) {
    assertNoProductionTlsVerificationOverride(env);
    assertNoProductionAwsCredentialOverrides(env);
    if (hasRedisEnvironmentVariables(env)) {
      throw new Error(
        'Production balance-consumer must not receive Redis configuration or credentials',
      );
    }
  }

  const sqsClient = loadSqsClientInfrastructureConfig(
    env,
    production,
    BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY,
  );
  assertBalanceConsumerSqsReceiptRedrivePolicy(sqsClient);
  const rawBalanceQueueUrl = required(env, 'SQS_BALANCE_QUEUE_URL');
  const rawBalanceDeadLetterQueueUrl = required(env, 'SQS_BALANCE_DEAD_LETTER_QUEUE_URL');
  const balanceQueueUrl = production
    ? productionSqsQueueUrl(rawBalanceQueueUrl, 'SQS_BALANCE_QUEUE_URL', sqsClient.region)
    : rawBalanceQueueUrl;
  const balanceDeadLetterQueueUrl = production
    ? productionSqsQueueUrl(
        rawBalanceDeadLetterQueueUrl,
        'SQS_BALANCE_DEAD_LETTER_QUEUE_URL',
        sqsClient.region,
      )
    : rawBalanceDeadLetterQueueUrl;
  if (balanceQueueUrl === balanceDeadLetterQueueUrl) {
    throw new Error('Balance-consumer SQS source and dead-letter queue URLs must be different');
  }

  if (production) {
    const [sourceAccount, sourceName] = sqsQueueAccountAndName(balanceQueueUrl);
    const [deadLetterAccount, deadLetterName] = sqsQueueAccountAndName(balanceDeadLetterQueueUrl);
    if (
      !environment ||
      sourceAccount !== deadLetterAccount ||
      sourceName !== `crypto-lending-${environment}-balance-sync` ||
      deadLetterName !== `crypto-lending-${environment}-balance-sync-dlq`
    ) {
      throw new Error(
        'Production balance-consumer SQS pair must match the exact APP_ENV source and dead-letter identities in one account',
      );
    }
  }

  return {
    workload,
    database: runtimeDatabaseSettings(env, workload),
    sqs: {
      ...sqsClient,
      balanceQueueUrl,
      balanceDeadLetterQueueUrl,
    },
  };
}
