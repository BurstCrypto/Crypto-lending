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
  const unexpected = FORBIDDEN_EXTERNAL_CONFIGURATION.find(
    (name) => environment[name] !== undefined,
  );
  if (unexpected !== undefined) return fail(unexpected);

  return Object.freeze({
    mode: 'enabled',
    apiHost: '127.0.0.1',
    publicOrigin: 'http://127.0.0.1:3000',
  });
}
