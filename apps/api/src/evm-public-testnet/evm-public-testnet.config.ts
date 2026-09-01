import type { LocalDemoRuntimeConfig } from '../local-demo/local-demo-runtime.config';
import { EVM_PUBLIC_TESTNET_RPC_ENDPOINT } from './evm-public-testnet.constants';

export const EVM_PUBLIC_TESTNET_EXECUTION_CONFIG = Symbol('EVM_PUBLIC_TESTNET_EXECUTION_CONFIG');

export type EvmPublicTestnetExecutionConfig =
  | Readonly<{ mode: 'disabled' }>
  | Readonly<{
      mode: 'enabled';
      rpcEndpoint: typeof EVM_PUBLIC_TESTNET_RPC_ENDPOINT;
      requestTimeoutMilliseconds: 7_000;
      responseMaximumBytes: 262_144;
    }>;

const FORBIDDEN_SIGNER_OR_OVERRIDE_NAMES = new Set([
  'EVM_PUBLIC_TESTNET_RPC_URL',
  'BASE_SEPOLIA_RPC_URL',
  'EVM_PUBLIC_TESTNET_PRIVATE_KEY',
  'EVM_PUBLIC_TESTNET_MNEMONIC',
  'EVM_PUBLIC_TESTNET_SEED',
  'EVM_PUBLIC_TESTNET_SEED_PHRASE',
  'EVM_PUBLIC_TESTNET_SIGNER_KEY',
  'BASE_SEPOLIA_PRIVATE_KEY',
]);

export class EvmPublicTestnetExecutionConfigurationError extends Error {
  readonly code = 'EVM_PUBLIC_TESTNET_EXECUTION_CONFIGURATION_ERROR' as const;

  constructor(readonly field: string) {
    super(`Invalid EVM public-testnet execution configuration: ${field}`);
    this.name = 'EvmPublicTestnetExecutionConfigurationError';
  }
}

function fail(field: string): never {
  throw new EvmPublicTestnetExecutionConfigurationError(field);
}

/**
 * Uses the same explicit, loopback-only local-demo gate as the Solana proof.
 * The Base Sepolia RPC is fixed and signer material is never accepted.
 */
export function loadEvmPublicTestnetExecutionConfig(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
  localDemoConfig: LocalDemoRuntimeConfig = { mode: 'disabled' },
): EvmPublicTestnetExecutionConfig {
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
    rpcEndpoint: EVM_PUBLIC_TESTNET_RPC_ENDPOINT,
    requestTimeoutMilliseconds: 7_000 as const,
    responseMaximumBytes: 262_144 as const,
  });
}
