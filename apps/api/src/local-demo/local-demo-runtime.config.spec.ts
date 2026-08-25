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

  it.each(['HTTPS_PROXY', 'EVM_RPC_URL', 'SOLANA_RPC_URL', 'WALLETCONNECT_PROJECT_ID']) (
    'rejects external configuration through %s',
    (field) => {
      const environment = enabledEnvironment();
      environment[field] = 'http://127.0.0.1:9';
      expect(() => loadLocalDemoRuntimeConfig(environment)).toThrow(
        LocalDemoRuntimeConfigurationError,
      );
    },
  );
});
