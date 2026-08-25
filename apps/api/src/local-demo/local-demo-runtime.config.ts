export const LOCAL_DEMO_RUNTIME_CONFIG = Symbol('LOCAL_DEMO_RUNTIME_CONFIG');

export type LocalDemoRuntimeConfig =
  | Readonly<{ mode: 'disabled' }>
  | Readonly<{
      mode: 'enabled';
      apiHost: '127.0.0.1';
      publicOrigin: 'http://127.0.0.1:3000';
    }>;

const FORBIDDEN_EXTERNAL_CONFIGURATION = Object.freeze([
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALCHEMY_API_KEY',
  'INFURA_API_KEY',
  'QUICKNODE_API_KEY',
  'HELIUS_API_KEY',
  'WALLETCONNECT_PROJECT_ID',
  'EVM_RPC_URL',
  'SOLANA_RPC_URL',
  'BLOCKCHAIN_PROVIDER_URL',
  'ORACLE_URL',
  'PRICE_PROVIDER_URL',
] as const);

const REQUIRED_LOCAL_INFRASTRUCTURE = Object.freeze({
  APPLICATION_WORKLOAD: 'api',
  DATABASE_RUNTIME_URL:
    'postgresql://crypto_api_login_a:local_api_database_a@127.0.0.1:5432/crypto_lending',
  DATABASE_RUNTIME_SSL_MODE: 'disable',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  REDIS_TLS: 'false',
  REDIS_USERNAME: 'crypto_api_a',
  REDIS_PASSWORD: 'local-api-current',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_EC2_METADATA_DISABLED: 'true',
  SQS_ENDPOINT: 'http://127.0.0.1:4566',
  SQS_QUEUE_URL: 'http://127.0.0.1:4566/000000000000/crypto-lending-jobs',
  SQS_DEAD_LETTER_QUEUE_URL: 'http://127.0.0.1:4566/000000000000/crypto-lending-jobs-dlq',
} as const);

const REVIEWED_INFRASTRUCTURE_NAMES = new Set(Object.keys(REQUIRED_LOCAL_INFRASTRUCTURE));
const INFRASTRUCTURE_PREFIXES = Object.freeze(['AWS_', 'DATABASE_', 'REDIS_', 'SQS_']);

export class LocalDemoRuntimeConfigurationError extends Error {
  readonly code = 'LOCAL_DEMO_RUNTIME_CONFIGURATION_ERROR' as const;

  constructor(readonly field: string) {
    super(`Invalid local demo runtime configuration: ${field}`);
    this.name = 'LocalDemoRuntimeConfigurationError';
  }
}

function fail(field: string): never {
  throw new LocalDemoRuntimeConfigurationError(field);
}

function assertExactLocalInfrastructure(environment: Readonly<NodeJS.ProcessEnv>): void {
  const mismatched = Object.entries(REQUIRED_LOCAL_INFRASTRUCTURE).find(
    ([name, value]) => environment[name] !== value,
  );
  if (mismatched) return fail(mismatched[0]);

  const unreviewed = Object.keys(environment).find((name) => {
    const canonicalName = name.toUpperCase();
    return (
      INFRASTRUCTURE_PREFIXES.some((prefix) => canonicalName.startsWith(prefix)) &&
      !REVIEWED_INFRASTRUCTURE_NAMES.has(canonicalName)
    );
  });
  if (unreviewed) return fail(unreviewed);
}

function exactDisabledMode(environment: Readonly<NodeJS.ProcessEnv>): LocalDemoRuntimeConfig {
  const unexpected = FORBIDDEN_EXTERNAL_CONFIGURATION.find(
    (name) => environment[name] !== undefined,
  );
  if (unexpected !== undefined && environment.LOCAL_DEMO_MODE === 'enabled') {
    return fail(unexpected);
  }
  return Object.freeze({ mode: 'disabled' });
}

/**
 * Enables the synthetic runtime only inside the reviewed loopback harness.
 * There is deliberately no configurable host, origin, RPC, relay, or oracle.
 */
export function loadLocalDemoRuntimeConfig(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): LocalDemoRuntimeConfig {
  const mode = environment.LOCAL_DEMO_MODE;
  if (mode === undefined || mode === 'disabled') return exactDisabledMode(environment);
  if (mode !== 'enabled') return fail('LOCAL_DEMO_MODE');
  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    return fail('NODE_ENV');
  }
  if (environment.APP_ENV !== 'dev-local-demo') return fail('APP_ENV');
  if (environment.API_HOST !== '127.0.0.1') return fail('API_HOST');
  if (environment.AUTH_PUBLIC_ORIGIN !== 'http://127.0.0.1:3000') {
    return fail('AUTH_PUBLIC_ORIGIN');
  }
  if (environment.AUTH_MODE !== 'oidc') return fail('AUTH_MODE');
  if (environment.WALLET_REGISTRATION_MODE !== 'enabled') {
    return fail('WALLET_REGISTRATION_MODE');
  }
  if (environment.WALLET_REGISTRATION_REGISTRY_ENVIRONMENT !== 'TESTNET') {
    return fail('WALLET_REGISTRATION_REGISTRY_ENVIRONMENT');
  }
  const unexpected = FORBIDDEN_EXTERNAL_CONFIGURATION.find((name) =>
    Object.keys(environment).some((configuredName) => configuredName.toUpperCase() === name),
  );
  if (unexpected !== undefined) return fail(unexpected);
  assertExactLocalInfrastructure(environment);

  return Object.freeze({
    mode: 'enabled',
    apiHost: '127.0.0.1',
    publicOrigin: 'http://127.0.0.1:3000',
  });
}
