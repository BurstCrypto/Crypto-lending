import { isIP } from 'node:net';

import type { AssetRegistryEnvironment } from '../../../blockchain/domain/supported-asset-registry';
import {
  createWalletRegistrationKey,
  type WalletRegistrationKey,
} from '../crypto/wallet-registration-crypto';

export interface DisabledWalletRegistrationConfig {
  readonly mode: 'disabled';
}

export interface EnabledWalletRegistrationConfig {
  readonly mode: 'enabled';
  readonly publicOrigin: string;
  readonly registryEnvironment: AssetRegistryEnvironment;
  readonly challengeTtlSeconds: number;
  readonly identityHmacKey: WalletRegistrationKey<'identity-hmac'>;
  readonly challengeHmacKey: WalletRegistrationKey<'challenge-hmac'>;
  readonly metadataSealKey: WalletRegistrationKey<'metadata-seal'>;
}

export type WalletRegistrationConfig =
  DisabledWalletRegistrationConfig | EnabledWalletRegistrationConfig;

export const WALLET_REGISTRATION_CONFIG = Symbol('WALLET_REGISTRATION_CONFIG');

const WALLET_REGISTRATION_VARIABLES = Object.freeze([
  'WALLET_REGISTRATION_REGISTRY_ENVIRONMENT',
  'WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS',
  'WALLET_IDENTITY_HMAC_KEY_VERSION',
  'WALLET_IDENTITY_HMAC_KEY',
  'WALLET_CHALLENGE_HMAC_KEY_VERSION',
  'WALLET_CHALLENGE_HMAC_KEY',
  'WALLET_METADATA_SEAL_KEY_VERSION',
  'WALLET_METADATA_SEAL_KEY',
] as const);

export class WalletRegistrationConfigurationError extends Error {
  readonly code = 'WALLET_REGISTRATION_CONFIGURATION_ERROR' as const;

  constructor(readonly field: string) {
    super(`Invalid wallet registration configuration: ${field}`);
    this.name = 'WalletRegistrationConfigurationError';
  }
}

function fail(field: string): never {
  throw new WalletRegistrationConfigurationError(field);
}

function required(environment: Readonly<NodeJS.ProcessEnv>, name: string): string {
  const value = environment[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value)
  ) {
    return fail(name);
  }
  return value;
}

function positiveInteger(
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const raw = required(environment, name);
  if (!/^[1-9][0-9]*$/u.test(raw)) return fail(name);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fail(name);
  return parsed;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    (isIP(hostname) === 6 && hostname === '::1')
  );
}

function exactPublicOrigin(value: string, testRuntime: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail('AUTH_PUBLIC_ORIGIN');
  }
  const secure = parsed.protocol === 'https:';
  const testLoopback = testRuntime && parsed.protocol === 'http:' && isLoopback(parsed.hostname);
  if (
    (!secure && !testLoopback) ||
    parsed.origin !== value ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    value.length > 2_048 ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    return fail('AUTH_PUBLIC_ORIGIN');
  }
  return value;
}

function registryEnvironment(value: string): AssetRegistryEnvironment {
  if (value !== 'MAINNET' && value !== 'TESTNET') {
    return fail('WALLET_REGISTRATION_REGISTRY_ENVIRONMENT');
  }
  return value;
}

function walletKey<Purpose extends 'challenge-hmac' | 'identity-hmac' | 'metadata-seal'>(
  environment: Readonly<NodeJS.ProcessEnv>,
  purpose: Purpose,
  versionName: string,
  keyName: string,
): WalletRegistrationKey<Purpose> {
  try {
    return createWalletRegistrationKey(
      purpose,
      positiveInteger(environment, versionName, 1, 32_767),
      required(environment, keyName),
    );
  } catch {
    return fail(keyName);
  }
}

export function loadWalletRegistrationConfig(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): WalletRegistrationConfig {
  const mode = environment.WALLET_REGISTRATION_MODE ?? 'disabled';
  if (mode !== 'disabled' && mode !== 'enabled') return fail('WALLET_REGISTRATION_MODE');
  if (mode === 'disabled') {
    const unexpected = WALLET_REGISTRATION_VARIABLES.find(
      (name) => environment[name] !== undefined,
    );
    if (unexpected) return fail(unexpected);
    return Object.freeze({ mode: 'disabled' });
  }

  if (environment.AUTH_MODE !== 'oidc') return fail('AUTH_MODE');

  const identityHmacKey = walletKey(
    environment,
    'identity-hmac',
    'WALLET_IDENTITY_HMAC_KEY_VERSION',
    'WALLET_IDENTITY_HMAC_KEY',
  );
  const challengeHmacKey = walletKey(
    environment,
    'challenge-hmac',
    'WALLET_CHALLENGE_HMAC_KEY_VERSION',
    'WALLET_CHALLENGE_HMAC_KEY',
  );
  const metadataSealKey = walletKey(
    environment,
    'metadata-seal',
    'WALLET_METADATA_SEAL_KEY_VERSION',
    'WALLET_METADATA_SEAL_KEY',
  );
  if (environment.WALLET_IDENTITY_HMAC_KEY === environment.WALLET_CHALLENGE_HMAC_KEY) {
    return fail('WALLET_KEY_MATERIAL');
  }
  if (
    environment.WALLET_METADATA_SEAL_KEY === environment.WALLET_IDENTITY_HMAC_KEY ||
    environment.WALLET_METADATA_SEAL_KEY === environment.WALLET_CHALLENGE_HMAC_KEY
  ) {
    return fail('WALLET_KEY_MATERIAL');
  }

  return Object.freeze({
    mode: 'enabled',
    publicOrigin: exactPublicOrigin(
      required(environment, 'AUTH_PUBLIC_ORIGIN'),
      environment.NODE_ENV === 'test',
    ),
    registryEnvironment: registryEnvironment(
      required(environment, 'WALLET_REGISTRATION_REGISTRY_ENVIRONMENT'),
    ),
    challengeTtlSeconds: positiveInteger(
      environment,
      'WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS',
      60,
      300,
    ),
    identityHmacKey,
    challengeHmacKey,
    metadataSealKey,
  });
}
