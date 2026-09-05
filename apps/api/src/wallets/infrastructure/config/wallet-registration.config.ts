import { isIP } from 'node:net';

import type { AssetRegistryEnvironment } from '../../../blockchain/domain/supported-asset-registry';
import {
  assertWalletRegistrationKeyRingsIndependent,
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
  type WalletRegistrationKeyPurpose,
  type WalletRegistrationKeyRing,
} from '../crypto/wallet-registration-crypto';

export interface DisabledWalletRegistrationConfig {
  readonly mode: 'disabled';
}

export interface EnabledWalletRegistrationConfig {
  readonly mode: 'enabled';
  readonly publicOrigin: string;
  readonly registryEnvironment: AssetRegistryEnvironment;
  readonly challengeTtlSeconds: number;
  readonly identityHmacKeys: WalletRegistrationKeyRing<'identity-hmac'>;
  readonly challengeHmacKeys: WalletRegistrationKeyRing<'challenge-hmac'>;
  readonly metadataSealKeys: WalletRegistrationKeyRing<'metadata-seal'>;
}

export type WalletRegistrationConfig =
  DisabledWalletRegistrationConfig | EnabledWalletRegistrationConfig;

export const WALLET_REGISTRATION_CONFIG = Symbol('WALLET_REGISTRATION_CONFIG');

const WALLET_REGISTRATION_VARIABLES = Object.freeze([
  'WALLET_REGISTRATION_REGISTRY_ENVIRONMENT',
  'WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS',
  'WALLET_IDENTITY_HMAC_KEY_VERSION',
  'WALLET_IDENTITY_HMAC_KEY',
  'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
  'WALLET_CHALLENGE_HMAC_KEY_VERSION',
  'WALLET_CHALLENGE_HMAC_KEY',
  'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
  'WALLET_METADATA_SEAL_KEY_VERSION',
  'WALLET_METADATA_SEAL_KEY',
  'WALLET_METADATA_SEAL_KEY_RING_JSON',
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

function registryEnvironment(
  value: string,
  nodeEnvironment: string | undefined,
): AssetRegistryEnvironment {
  if (value !== 'MAINNET' && value !== 'TESTNET') {
    return fail('WALLET_REGISTRATION_REGISTRY_ENVIRONMENT');
  }
  if (value === 'TESTNET' && nodeEnvironment !== 'development' && nodeEnvironment !== 'test') {
    return fail('WALLET_REGISTRATION_REGISTRY_ENVIRONMENT');
  }
  return value;
}

interface WalletKeyRingDocumentEntry {
  readonly keyId: string;
  readonly purpose: WalletRegistrationKeyPurpose;
  readonly version: number;
  readonly material: string;
}

interface WalletKeyRingDocument {
  readonly activeWriteVersion: number;
  readonly keys: readonly WalletKeyRingDocumentEntry[];
}

function isExactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).join('\0') === keys.join('\0');
}

function parseKeyRingDocument(value: string, field: string): WalletKeyRingDocument {
  if (value.length > 4_096 || /[\0\r\n]/u.test(value)) return fail(field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return fail(field);
  }
  if (
    !isExactObject(parsed, ['activeWriteVersion', 'keys']) ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length < 1 ||
    parsed.keys.length > 3 ||
    JSON.stringify(parsed) !== value
  ) {
    return fail(field);
  }
  let previousVersion = 0;
  for (const candidate of parsed.keys) {
    if (
      !isExactObject(candidate, ['keyId', 'purpose', 'version', 'material']) ||
      typeof candidate.keyId !== 'string' ||
      typeof candidate.purpose !== 'string' ||
      typeof candidate.version !== 'number' ||
      !Number.isInteger(candidate.version) ||
      candidate.version <= previousVersion ||
      typeof candidate.material !== 'string'
    ) {
      return fail(field);
    }
    previousVersion = candidate.version;
  }
  return parsed as unknown as WalletKeyRingDocument;
}

function walletKeyRing<Purpose extends 'challenge-hmac' | 'identity-hmac' | 'metadata-seal'>(
  environment: Readonly<NodeJS.ProcessEnv>,
  purpose: Purpose,
  versionName: string,
  keyName: string,
  ringName: string,
): WalletRegistrationKeyRing<Purpose> {
  try {
    const encodedRing = environment[ringName];
    if (encodedRing === undefined) {
      const version = positiveInteger(environment, versionName, 1, 32_767);
      return createWalletRegistrationKeyRing(purpose, version, [
        createWalletRegistrationKey(purpose, version, required(environment, keyName)),
      ]);
    }
    if (environment[versionName] !== undefined || environment[keyName] !== undefined) {
      return fail(ringName);
    }
    const document = parseKeyRingDocument(required(environment, ringName), ringName);
    const keys = document.keys.map((candidate) => {
      if (candidate.purpose !== purpose) return fail(ringName);
      return createWalletRegistrationKey(
        purpose,
        candidate.version,
        candidate.material,
        candidate.keyId,
      );
    });
    return createWalletRegistrationKeyRing(purpose, document.activeWriteVersion, keys);
  } catch {
    return fail(ringName);
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
  const localDemo = environment.LOCAL_DEMO_MODE === 'enabled';
  if (
    localDemo &&
    ((environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') ||
      environment.API_HOST !== '127.0.0.1' ||
      environment.AUTH_PUBLIC_ORIGIN !== 'http://127.0.0.1:3000')
  ) {
    return fail('LOCAL_DEMO_MODE');
  }

  const identityHmacKeys = walletKeyRing(
    environment,
    'identity-hmac',
    'WALLET_IDENTITY_HMAC_KEY_VERSION',
    'WALLET_IDENTITY_HMAC_KEY',
    'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
  );
  const challengeHmacKeys = walletKeyRing(
    environment,
    'challenge-hmac',
    'WALLET_CHALLENGE_HMAC_KEY_VERSION',
    'WALLET_CHALLENGE_HMAC_KEY',
    'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
  );
  const metadataSealKeys = walletKeyRing(
    environment,
    'metadata-seal',
    'WALLET_METADATA_SEAL_KEY_VERSION',
    'WALLET_METADATA_SEAL_KEY',
    'WALLET_METADATA_SEAL_KEY_RING_JSON',
  );
  try {
    assertWalletRegistrationKeyRingsIndependent([
      identityHmacKeys,
      challengeHmacKeys,
      metadataSealKeys,
    ]);
  } catch {
    return fail('WALLET_KEY_MATERIAL');
  }

  return Object.freeze({
    mode: 'enabled',
    publicOrigin: exactPublicOrigin(
      required(environment, 'AUTH_PUBLIC_ORIGIN'),
      environment.NODE_ENV === 'test' || localDemo,
    ),
    registryEnvironment: registryEnvironment(
      required(environment, 'WALLET_REGISTRATION_REGISTRY_ENVIRONMENT'),
      environment.NODE_ENV,
    ),
    challengeTtlSeconds: positiveInteger(
      environment,
      'WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS',
      60,
      300,
    ),
    identityHmacKeys,
    challengeHmacKeys,
    metadataSealKeys,
  });
}
