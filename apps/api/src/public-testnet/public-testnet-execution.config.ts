import type { LocalDemoRuntimeConfig } from '../local-demo/local-demo-runtime.config';
import {
  PUBLIC_TESTNET_GENESIS_HASH,
  PUBLIC_TESTNET_RPC_ENDPOINT,
} from './public-testnet-execution.constants';

export const PUBLIC_TESTNET_EXECUTION_CONFIG = Symbol('PUBLIC_TESTNET_EXECUTION_CONFIG');

export type PublicTestnetExecutionConfig =
  | Readonly<{ mode: 'disabled' }>
  | Readonly<{
      mode: 'enabled';
      rpcEndpoint: typeof PUBLIC_TESTNET_RPC_ENDPOINT;
      genesisHash: typeof PUBLIC_TESTNET_GENESIS_HASH;
      requestTimeoutMilliseconds: 7_000;
      responseMaximumBytes: 262_144;
    }>;

const FORBIDDEN_SIGNER_OR_OVERRIDE_NAMES = new Set([
  'PUBLIC_TESTNET_RPC_URL',
  'SOLANA_DEVNET_RPC_URL',
  'PUBLIC_TESTNET_PRIVATE_KEY',
  'PUBLIC_TESTNET_MNEMONIC',
  'PUBLIC_TESTNET_SEED',
  'PUBLIC_TESTNET_SEED_PHRASE',
  'PUBLIC_TESTNET_SIGNER_KEY',
  'SOLANA_PRIVATE_KEY',
  'SOLANA_KEYPAIR',
  'ANCHOR_WALLET',
]);

export class PublicTestnetExecutionConfigurationError extends Error {
  readonly code = 'PUBLIC_TESTNET_EXECUTION_CONFIGURATION_ERROR' as const;

  constructor(readonly field: string) {
    super(`Invalid public-testnet execution configuration: ${field}`);
    this.name = 'PublicTestnetExecutionConfigurationError';
  }
}

function fail(field: string): never {
  throw new PublicTestnetExecutionConfigurationError(field);
}

/**
 * The enabled form is deliberately loopback-only. Both the RPC endpoint and
 * Devnet genesis are fixed, and signer material is neither accepted nor stored.
 */
export function loadPublicTestnetExecutionConfig(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
  localDemoConfig: LocalDemoRuntimeConfig = { mode: 'disabled' },
): PublicTestnetExecutionConfig {
  const mode = environment.PUBLIC_TESTNET_DEMO_MODE;
  if (mode === undefined || mode === 'disabled') return Object.freeze({ mode: 'disabled' });
  if (mode !== 'enabled') return fail('PUBLIC_TESTNET_DEMO_MODE');
  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    return fail('NODE_ENV');
  }
  if (environment.CI !== undefined && !['', '0', 'false'].includes(environment.CI.toLowerCase())) {
    return fail('CI');
  }
  if (environment.APP_ENV !== 'dev-local-demo') return fail('APP_ENV');
  if (environment.API_HOST !== '127.0.0.1') return fail('API_HOST');
  if (environment.AUTH_PUBLIC_ORIGIN !== 'http://127.0.0.1:3000') {
    return fail('AUTH_PUBLIC_ORIGIN');
  }
  if (localDemoConfig.mode !== 'enabled') return fail('LOCAL_DEMO_MODE');

  const forbidden = Object.keys(environment).find(
    (name) =>
      FORBIDDEN_SIGNER_OR_OVERRIDE_NAMES.has(name.toUpperCase()) && environment[name] !== undefined,
  );
  if (forbidden !== undefined) return fail(forbidden.toUpperCase());

  return Object.freeze({
    mode: 'enabled',
    rpcEndpoint: PUBLIC_TESTNET_RPC_ENDPOINT,
    genesisHash: PUBLIC_TESTNET_GENESIS_HASH,
    requestTimeoutMilliseconds: 7_000 as const,
    responseMaximumBytes: 262_144 as const,
  });
}
