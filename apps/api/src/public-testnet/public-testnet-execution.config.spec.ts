jest.mock('rpc-websockets', () => ({ CommonClient: class {}, WebSocket: jest.fn() }));

import type { LocalDemoRuntimeConfig } from '../local-demo/local-demo-runtime.config';
import {
  PUBLIC_TESTNET_GENESIS_HASH,
  PUBLIC_TESTNET_RPC_ENDPOINT,
} from './public-testnet-execution.constants';
import {
  PublicTestnetExecutionConfigurationError,
  loadPublicTestnetExecutionConfig,
} from './public-testnet-execution.config';

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

describe('public-testnet execution configuration', () => {
  it('is disabled by default', () => {
    expect(loadPublicTestnetExecutionConfig({}, LOCAL_CONFIG)).toEqual({ mode: 'disabled' });
  });

  it('enables only the fixed Solana Devnet RPC and full genesis hash', () => {
    expect(loadPublicTestnetExecutionConfig(enabledEnvironment(), LOCAL_CONFIG)).toEqual({
      mode: 'enabled',
      rpcEndpoint: PUBLIC_TESTNET_RPC_ENDPOINT,
      genesisHash: PUBLIC_TESTNET_GENESIS_HASH,
      requestTimeoutMilliseconds: 7_000,
      responseMaximumBytes: 262_144,
    });
  });

  it.each([
    'PUBLIC_TESTNET_RPC_URL',
    'SOLANA_DEVNET_RPC_URL',
    'SOLANA_PRIVATE_KEY',
    'ANCHOR_WALLET',
  ])('rejects override or signer field %s', (field) => {
    expect(() =>
      loadPublicTestnetExecutionConfig(
        { ...enabledEnvironment(), [field]: 'forbidden' },
        LOCAL_CONFIG,
      ),
    ).toThrow(PublicTestnetExecutionConfigurationError);
  });

  it('rejects non-loopback or production enablement', () => {
    expect(() =>
      loadPublicTestnetExecutionConfig(
        { ...enabledEnvironment(), NODE_ENV: 'production' },
        LOCAL_CONFIG,
      ),
    ).toThrow(PublicTestnetExecutionConfigurationError);
    expect(() =>
      loadPublicTestnetExecutionConfig(enabledEnvironment(), { mode: 'disabled' }),
    ).toThrow(PublicTestnetExecutionConfigurationError);
  });
});
