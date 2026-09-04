import {
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
  type WalletRegistrationKeyRing,
} from '../../../wallets/infrastructure/crypto/wallet-registration-crypto';

export interface DisabledBalanceConsumerConfig {
  readonly mode: 'disabled';
}

export interface EnabledBalanceConsumerConfig {
  readonly mode: 'enabled';
  /** Read-only key selection; this boundary exposes no sealing operation. */
  readonly walletMetadataSealKeys: WalletRegistrationKeyRing<'metadata-seal'>;
}

export type BalanceConsumerConfig = DisabledBalanceConsumerConfig | EnabledBalanceConsumerConfig;

export const BALANCE_CONSUMER_CONFIG = Symbol('BALANCE_CONSUMER_CONFIG');

const MODE_VARIABLE = 'BALANCE_CONSUMER_MODE';
const KEY_RING_VARIABLE = 'BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON';

interface MetadataKeyDocumentEntry {
  readonly keyId: string;
  readonly purpose: 'metadata-seal';
  readonly version: number;
  readonly material: string;
}

interface MetadataKeyRingDocument {
  readonly activeWriteVersion: number;
  readonly keys: readonly MetadataKeyDocumentEntry[];
}

export class BalanceConsumerConfigurationError extends Error {
  readonly code = 'BALANCE_CONSUMER_CONFIGURATION_ERROR' as const;

  constructor(readonly field: string) {
    super(`Invalid balance consumer configuration: ${field}`);
    this.name = 'BalanceConsumerConfigurationError';
  }
}

function fail(field: string): never {
  throw new BalanceConsumerConfigurationError(field);
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).join('\0') === keys.join('\0')
  );
}

function required(environment: Readonly<NodeJS.ProcessEnv>, name: string): string {
  const value = environment[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.length > 4_096 ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value)
  ) {
    return fail(name);
  }
  return value;
}

function metadataKeyRing(
  environment: Readonly<NodeJS.ProcessEnv>,
): WalletRegistrationKeyRing<'metadata-seal'> {
  const serialized = required(environment, KEY_RING_VARIABLE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return fail(KEY_RING_VARIABLE);
  }
  if (
    !exactObject(parsed, ['activeWriteVersion', 'keys']) ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length < 1 ||
    parsed.keys.length > 3 ||
    JSON.stringify(parsed) !== serialized
  ) {
    return fail(KEY_RING_VARIABLE);
  }
  const document = parsed as unknown as MetadataKeyRingDocument;
  try {
    return createWalletRegistrationKeyRing(
      'metadata-seal',
      document.activeWriteVersion,
      document.keys.map((candidate) => {
        if (
          !exactObject(candidate, ['keyId', 'purpose', 'version', 'material']) ||
          candidate.purpose !== 'metadata-seal'
        ) {
          return fail(KEY_RING_VARIABLE);
        }
        return createWalletRegistrationKey(
          'metadata-seal',
          candidate.version,
          candidate.material,
          candidate.keyId,
        );
      }),
    );
  } catch {
    return fail(KEY_RING_VARIABLE);
  }
}

/**
 * Loads only the future balance consumer's metadata-decryption capability.
 * It deliberately has no aliases for API wallet/auth/session/challenge keys.
 */
export function loadBalanceConsumerConfig(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): BalanceConsumerConfig {
  const mode = environment[MODE_VARIABLE] ?? 'disabled';
  if (mode !== 'disabled' && mode !== 'enabled') return fail(MODE_VARIABLE);
  if (mode === 'disabled') {
    if (environment[KEY_RING_VARIABLE] !== undefined) return fail(KEY_RING_VARIABLE);
    return Object.freeze({ mode: 'disabled' });
  }
  return Object.freeze({
    mode: 'enabled',
    walletMetadataSealKeys: metadataKeyRing(environment),
  });
}
