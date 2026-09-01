import type { LocalDemoRuntimeConfig } from '../local-demo/local-demo-runtime.config';
import { EVM_PUBLIC_TESTNET_RPC_ENDPOINT } from './evm-public-testnet.constants';
import {
  EvmPublicTestnetExecutionConfigurationError,
  loadEvmPublicTestnetExecutionConfig,
} from './evm-public-testnet.config';

const LOCAL_CONFIG = Object.freeze({
  mode: 'enabled' as const,
  apiHost: '127.0.0.1' as const,
  publicOrigin: 'http://127.0.0.1:3000' as const,
  localEvmRpcUrl: 'http://127.0.0.1:18545' as const,
  localEvmControl: Object.freeze({
    url: 'http://127.0.0.1:18546/control' as const,
    launchId: 'a'.repeat(32),
    capability: 'b'.repeat(64),
  }),
}) satisfies LocalDemoRuntimeConfig;

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    PUBLIC_TESTNET_DEMO_MODE: 'enabled',
    NODE_ENV: 'test',
    APP_ENV: 'dev-local-demo',
    API_HOST: '127.0.0.1',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
  };
}

describe('EVM public-testnet execution configuration', () => {
  it('is disabled by default', () => {
    expect(loadEvmPublicTestnetExecutionConfig({}, LOCAL_CONFIG)).toEqual({ mode: 'disabled' });
  });

  it('enables only the fixed Base Sepolia RPC', () => {
    expect(loadEvmPublicTestnetExecutionConfig(enabledEnvironment(), LOCAL_CONFIG)).toEqual({
      mode: 'enabled',
      rpcEndpoint: EVM_PUBLIC_TESTNET_RPC_ENDPOINT,
      requestTimeoutMilliseconds: 7_000,
      responseMaximumBytes: 262_144,
    });
  });

  it.each([
    'EVM_PUBLIC_TESTNET_RPC_URL',
    'BASE_SEPOLIA_RPC_URL',
    'EVM_PUBLIC_TESTNET_PRIVATE_KEY',
    'BASE_SEPOLIA_PRIVATE_KEY',
  ])('rejects override or signer field %s', (field) => {
    expect(() =>
      loadEvmPublicTestnetExecutionConfig(
        { ...enabledEnvironment(), [field]: 'forbidden' },
        LOCAL_CONFIG,
      ),
    ).toThrow(EvmPublicTestnetExecutionConfigurationError);
  });

  it('rejects CI, production, non-loopback, and disabled local-demo enablement', () => {
    for (const environment of [
      { ...enabledEnvironment(), NODE_ENV: 'production' },
      { ...enabledEnvironment(), CI: 'true' },
      { ...enabledEnvironment(), API_HOST: '0.0.0.0' },
      { ...enabledEnvironment(), AUTH_PUBLIC_ORIGIN: 'https://example.test' },
    ]) {
      expect(() => loadEvmPublicTestnetExecutionConfig(environment, LOCAL_CONFIG)).toThrow(
        EvmPublicTestnetExecutionConfigurationError,
      );
    }
    expect(() =>
      loadEvmPublicTestnetExecutionConfig(enabledEnvironment(), { mode: 'disabled' }),
    ).toThrow(EvmPublicTestnetExecutionConfigurationError);
  });
});
