import {
  loadLocalDemoRuntimeConfig,
  LocalDemoRuntimeConfigurationError,
} from './local-demo-runtime.config';

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    LOCAL_DEMO_MODE: 'enabled',
    NODE_ENV: 'test',
    APP_ENV: 'dev-local-demo',
    API_HOST: '127.0.0.1',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    AUTH_MODE: 'oidc',
    WALLET_REGISTRATION_MODE: 'enabled',
    WALLET_REGISTRATION_REGISTRY_ENVIRONMENT: 'TESTNET',
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
  };
}

describe('local demo runtime configuration', () => {
  it('is disabled by default', () => {
    expect(loadLocalDemoRuntimeConfig({})).toEqual({ mode: 'disabled' });
    expect(loadLocalDemoRuntimeConfig({ LOCAL_DEMO_MODE: 'disabled' })).toEqual({
      mode: 'disabled',
    });
  });

  it('enables only the fixed loopback synthetic runtime', () => {
    expect(loadLocalDemoRuntimeConfig(enabledEnvironment())).toEqual({
      mode: 'enabled',
      apiHost: '127.0.0.1',
      publicOrigin: 'http://127.0.0.1:3000',
    });
  });

  it.each([
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'development'],
    ['API_HOST', '0.0.0.0'],
    ['AUTH_PUBLIC_ORIGIN', 'https://demo.example'],
    ['AUTH_MODE', 'disabled'],
    ['WALLET_REGISTRATION_MODE', 'disabled'],
    ['WALLET_REGISTRATION_REGISTRY_ENVIRONMENT', 'MAINNET'],
    ['LOCAL_DEMO_MODE', 'true'],
  ])('rejects drift in %s', (field, value) => {
    const environment = enabledEnvironment();
    environment[field] = value;
    expect(() => loadLocalDemoRuntimeConfig(environment)).toThrow(
      LocalDemoRuntimeConfigurationError,
    );
  });

  it.each(['HTTPS_PROXY', 'EVM_RPC_URL', 'SOLANA_RPC_URL', 'WALLETCONNECT_PROJECT_ID'])(
    'rejects external configuration through %s',
    (field) => {
      const environment = enabledEnvironment();
      environment[field] = 'http://127.0.0.1:9';
      expect(() => loadLocalDemoRuntimeConfig(environment)).toThrow(
        LocalDemoRuntimeConfigurationError,
      );
    },
  );

  it.each([
    ['APPLICATION_WORKLOAD', 'worker'],
    ['DATABASE_RUNTIME_URL', 'postgresql://demo:demo@database.example/crypto_lending'],
    ['DATABASE_RUNTIME_SSL_MODE', 'require'],
    ['REDIS_HOST', 'redis.example'],
    ['REDIS_PORT', '6380'],
    ['REDIS_TLS', 'true'],
    ['REDIS_USERNAME', 'other'],
    ['REDIS_PASSWORD', 'other'],
    ['AWS_REGION', 'us-west-2'],
    ['AWS_ACCESS_KEY_ID', 'ambient'],
    ['AWS_SECRET_ACCESS_KEY', 'ambient'],
    ['AWS_EC2_METADATA_DISABLED', 'false'],
    ['SQS_ENDPOINT', 'http://queue.example:4566'],
    ['SQS_QUEUE_URL', 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs'],
    ['SQS_DEAD_LETTER_QUEUE_URL', 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs-dlq'],
  ])('rejects local infrastructure drift in %s', (field, value) => {
    const environment = enabledEnvironment();
    environment[field] = value;
    expect(() => loadLocalDemoRuntimeConfig(environment)).toThrow(
      LocalDemoRuntimeConfigurationError,
    );
  });

  it.each([
    'DATABASE_RUNTIME_HOST',
    'DATABASE_URL',
    'REDIS_URL',
    'AWS_PROFILE',
    'AWS_ENDPOINT_URL_SQS',
    'SQS_REQUEST_TIMEOUT_MS',
  ])('rejects unreviewed infrastructure variable %s', (field) => {
    const environment = enabledEnvironment();
    environment[field] = 'unexpected';
    expect(() => loadLocalDemoRuntimeConfig(environment)).toThrow(
      LocalDemoRuntimeConfigurationError,
    );
  });

  it('rejects case-variant proxy configuration', () => {
    const environment = enabledEnvironment();
    environment.https_proxy = 'http://proxy.example';
    expect(() => loadLocalDemoRuntimeConfig(environment)).toThrow(
      LocalDemoRuntimeConfigurationError,
    );
  });
});
