import { Redis } from 'ioredis';

export const REDIS_SESSION_REVOCATION_NETWORK_SCOPE = 'ethereum-solana-mainnet' as const;
export const REDIS_SESSION_REVOCATION_WORKLOAD = 'redis-session-revocation' as const;

const REDIS_PORT = 6379;
const REDIS_CONNECT_TIMEOUT_MS = 5_000;
const REDIS_COMMAND_TIMEOUT_MS = 5_000;
const DEPLOYMENT_ENVIRONMENT = /^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/u;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const ALLOWED_REDIS_ENVIRONMENT = new Set([
  'REDIS_CREDENTIAL_PHASE',
  'REDIS_HOST',
  'REDIS_OPERATOR_PASSWORD',
  'REDIS_OPERATOR_USERNAME',
  'REDIS_PORT',
  'REDIS_TLS',
]);

type RedisCredentialPhase = 'A_ONLY' | 'B_ONLY';
export type RedisInactiveSlot = 'a' | 'b';

interface RedisSessionRevocationConfig {
  readonly host: string;
  readonly inactiveSlot: RedisInactiveSlot;
  readonly operatorPassword: string;
  readonly operatorUsername: string;
  readonly targetUsername: string;
}

export interface RedisSessionRevocationClient {
  connect(): Promise<void>;
  call(
    command: 'CLIENT',
    subcommand: 'KILL',
    filter: 'USER',
    username: string,
    skipme: 'SKIPME',
    skipmeValue: 'YES',
  ): Promise<unknown>;
  disconnect(reconnect?: boolean): void;
}

export type RedisSessionRevocationClientFactory = (
  config: Readonly<RedisSessionRevocationConfig>,
) => RedisSessionRevocationClient;

export type RedisSessionRevocationFailureCode =
  'ARGUMENTS_INVALID' | 'CONFIGURATION_INVALID' | 'OPERATION_FAILED' | 'RESULT_INVALID';

export type RedisSessionRevocationResult =
  | Readonly<{
      exitCode: 0;
      inactiveSlot: RedisInactiveSlot;
      killedClientCount: number;
      status: 'completed';
    }>
  | Readonly<{
      code: RedisSessionRevocationFailureCode;
      exitCode: 1;
      status: 'refused';
    }>;

function refuse(code: RedisSessionRevocationFailureCode): RedisSessionRevocationResult {
  return Object.freeze({ code, exitCode: 1, status: 'refused' });
}

function required(environment: Readonly<NodeJS.ProcessEnv>, name: string): string {
  const value = environment[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Invalid revocation configuration');
  }
  return value;
}

function snapshotEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
): Readonly<NodeJS.ProcessEnv> {
  if (Object.getOwnPropertySymbols(environment).length > 0) {
    throw new Error('Invalid revocation configuration');
  }
  const snapshot = Object.create(null) as NodeJS.ProcessEnv;
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(environment))) {
    if (!('value' in descriptor)) throw new Error('Invalid revocation configuration');
    const value = descriptor.value as unknown;
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error('Invalid revocation configuration');
    snapshot[name] = value;
  }
  return Object.freeze(snapshot);
}

function canonicalHost(value: string): string {
  if (
    value.length > 253 ||
    value !== value.toLowerCase() ||
    value.endsWith('.') ||
    value.includes('..') ||
    !value.includes('.') ||
    /^\d+(?:\.\d+){3}$/u.test(value) ||
    !value.split('.').every((label) => DNS_LABEL.test(label))
  ) {
    throw new Error('Invalid revocation configuration');
  }
  return value;
}

function credentialPhase(value: string): RedisCredentialPhase {
  if (value !== 'A_ONLY' && value !== 'B_ONLY') {
    throw new Error('Invalid revocation configuration');
  }
  return value;
}

function sensitiveValue(value: string): string {
  if (value.length > 4_096 || !value.trim() || /[\0\r\n]/u.test(value)) {
    throw new Error('Invalid revocation configuration');
  }
  return value;
}

function loadRedisSessionRevocationConfig(
  inputEnvironment: Readonly<NodeJS.ProcessEnv>,
): Readonly<RedisSessionRevocationConfig> {
  const environment = snapshotEnvironment(inputEnvironment);
  if (required(environment, 'NODE_ENV') !== 'production') {
    throw new Error('Invalid revocation configuration');
  }
  if (required(environment, 'APPLICATION_WORKLOAD') !== REDIS_SESSION_REVOCATION_WORKLOAD) {
    throw new Error('Invalid revocation configuration');
  }
  if (required(environment, 'PRODUCT_NETWORK_SCOPE') !== REDIS_SESSION_REVOCATION_NETWORK_SCOPE) {
    throw new Error('Invalid revocation configuration');
  }
  if (
    environment.NODE_TLS_REJECT_UNAUTHORIZED !== undefined ||
    Object.keys(environment).some(
      (name) => name.startsWith('REDIS_') && !ALLOWED_REDIS_ENVIRONMENT.has(name),
    )
  ) {
    throw new Error('Invalid revocation configuration');
  }

  const deploymentEnvironment = required(environment, 'APP_ENV');
  if (deploymentEnvironment.length > 31 || !DEPLOYMENT_ENVIRONMENT.test(deploymentEnvironment)) {
    throw new Error('Invalid revocation configuration');
  }
  const phase = credentialPhase(required(environment, 'REDIS_CREDENTIAL_PHASE'));
  const inactiveSlot = phase === 'A_ONLY' ? 'b' : 'a';
  const operatorUsername = required(environment, 'REDIS_OPERATOR_USERNAME');
  if (operatorUsername !== `crypto_operator_${deploymentEnvironment}`) {
    throw new Error('Invalid revocation configuration');
  }
  if (
    required(environment, 'REDIS_PORT') !== String(REDIS_PORT) ||
    required(environment, 'REDIS_TLS') !== 'true'
  ) {
    throw new Error('Invalid revocation configuration');
  }

  return Object.freeze({
    host: canonicalHost(required(environment, 'REDIS_HOST')),
    inactiveSlot,
    operatorPassword: sensitiveValue(required(environment, 'REDIS_OPERATOR_PASSWORD')),
    operatorUsername,
    targetUsername: `crypto_api_${deploymentEnvironment}_${inactiveSlot}`,
  });
}

export function createRedisSessionRevocationClient(
  config: Readonly<RedisSessionRevocationConfig>,
): RedisSessionRevocationClient {
  const client = new Redis({
    host: config.host,
    port: REDIS_PORT,
    username: config.operatorUsername,
    password: config.operatorPassword,
    db: 0,
    tls: { rejectUnauthorized: true },
    lazyConnect: true,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    disableClientInfo: true,
    autoResendUnfulfilledCommands: false,
    autoResubscribe: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    retryStrategy: null,
  });
  client.on('error', () => undefined);
  return client as RedisSessionRevocationClient;
}

function killedClientCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export async function runRedisSessionRevocation(
  argv: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
  clientFactory: RedisSessionRevocationClientFactory = createRedisSessionRevocationClient,
): Promise<RedisSessionRevocationResult> {
  if (argv.length !== 0) return refuse('ARGUMENTS_INVALID');

  let config: Readonly<RedisSessionRevocationConfig>;
  try {
    config = loadRedisSessionRevocationConfig(environment);
  } catch {
    return refuse('CONFIGURATION_INVALID');
  }

  let client: RedisSessionRevocationClient;
  try {
    client = clientFactory(config);
  } catch {
    return refuse('OPERATION_FAILED');
  }

  try {
    await client.connect();
    const response = await client.call(
      'CLIENT',
      'KILL',
      'USER',
      config.targetUsername,
      'SKIPME',
      'YES',
    );
    const count = killedClientCount(response);
    if (count === undefined) return refuse('RESULT_INVALID');
    return Object.freeze({
      exitCode: 0,
      inactiveSlot: config.inactiveSlot,
      killedClientCount: count,
      status: 'completed',
    });
  } catch {
    return refuse('OPERATION_FAILED');
  } finally {
    try {
      client.disconnect(false);
    } catch {
      // The command result is authoritative; socket teardown details are never exposed.
    }
  }
}
