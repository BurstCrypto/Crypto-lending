import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export type WalletRegistrationKeyPurpose = 'challenge-hmac' | 'identity-hmac' | 'metadata-seal';
export type WalletRegistrationDigestPurpose =
  'account-binding' | 'address' | 'domain' | 'message' | 'nonce' | 'rate-limit';
export type WalletRegistrationSealedField = 'address' | 'challenge' | 'metadata';

declare const walletRegistrationKeyBrand: unique symbol;
declare const walletRegistrationDigestBrand: unique symbol;

export interface WalletRegistrationKey<Purpose extends WalletRegistrationKeyPurpose> {
  readonly keyId: string;
  readonly purpose: Purpose;
  readonly version: number;
  readonly [walletRegistrationKeyBrand]: true;
}

export interface WalletRegistrationKeyRing<Purpose extends WalletRegistrationKeyPurpose> {
  readonly purpose: Purpose;
  readonly activeWriteVersion: number;
  readonly keys: readonly WalletRegistrationKey<Purpose>[];
}

export type WalletRegistrationDigest<Purpose extends WalletRegistrationDigestPurpose> = string & {
  readonly [walletRegistrationDigestBrand]: Purpose;
};

export interface WalletRegistrationDigestReference<
  Purpose extends WalletRegistrationDigestPurpose = WalletRegistrationDigestPurpose,
> {
  readonly version: number;
  readonly value: WalletRegistrationDigest<Purpose>;
}

export interface SealedWalletRegistrationValue {
  readonly keyVersion: number;
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
}

interface WalletRegistrationSealBindingBase {
  readonly challengeId: string;
  readonly accountId: string;
  readonly networkId: string;
  readonly addressDigest: WalletRegistrationDigestReference<'address'>;
}

export type WalletRegistrationSealBinding =
  | (WalletRegistrationSealBindingBase & {
      readonly field: 'challenge';
    })
  | (WalletRegistrationSealBindingBase & {
      readonly field: 'address' | 'metadata';
      readonly walletId: string;
    });

const keyBytes = new WeakMap<object, Buffer>();
const validKeyRings = new WeakSet<object>();
const KEY_ID = /^[a-z][a-z0-9_-]{0,47}$/u;
const LOWER_HEX_DIGEST = /^[0-9a-f]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NETWORK_ID = /^(?:eip155:[1-9][0-9]{0,18}|solana:[1-9A-HJ-NP-Za-km-z]{32})$/u;
const DIGEST_INPUT_MAX_BYTES = 16_384;
const ADDRESS_PLAINTEXT_MAX_BYTES = 128;
const STRUCTURED_PLAINTEXT_MAX_BYTES = 8_192;
export const MAX_WALLET_REGISTRATION_KEYS_PER_PURPOSE = 3 as const;

export class WalletRegistrationCryptoError extends Error {
  readonly code = 'WALLET_REGISTRATION_CRYPTO_ERROR' as const;

  constructor() {
    super('Wallet registration cryptographic operation failed');
    this.name = 'WalletRegistrationCryptoError';
  }
}

function fail(): never {
  throw new WalletRegistrationCryptoError();
}

function decodeCanonicalBase64Url(value: unknown, expectedBytes?: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return fail();
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (
      (expectedBytes !== undefined && bytes.length !== expectedBytes) ||
      bytes.toString('base64url') !== value
    ) {
      return fail();
    }
    return bytes;
  } catch {
    return fail();
  }
}

function positiveSmallint(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 32_767) {
    return fail();
  }
  return value as number;
}

export function createWalletRegistrationKey<Purpose extends WalletRegistrationKeyPurpose>(
  purpose: Purpose,
  version: unknown,
  encodedKey: unknown,
  keyId: unknown = `wallet-${purpose}-v${String(version)}`,
): WalletRegistrationKey<Purpose> {
  if (purpose !== 'challenge-hmac' && purpose !== 'identity-hmac' && purpose !== 'metadata-seal') {
    return fail();
  }
  if (typeof keyId !== 'string' || !KEY_ID.test(keyId)) return fail();
  const key = Object.freeze({
    keyId,
    purpose,
    version: positiveSmallint(version),
  }) as WalletRegistrationKey<Purpose>;
  keyBytes.set(key, decodeCanonicalBase64Url(encodedKey, 32));
  return key;
}

function revealKey<Purpose extends WalletRegistrationKeyPurpose>(
  key: WalletRegistrationKey<Purpose>,
  purpose: Purpose,
): Buffer {
  try {
    if (
      !key ||
      typeof key !== 'object' ||
      !Object.isFrozen(key) ||
      !KEY_ID.test(key.keyId) ||
      key.purpose !== purpose
    ) {
      return fail();
    }
    positiveSmallint(key.version);
    const bytes = keyBytes.get(key);
    if (!bytes || bytes.length !== 32) return fail();
    return bytes;
  } catch {
    return fail();
  }
}

function validatedKeyRing<Purpose extends WalletRegistrationKeyPurpose>(
  ring: WalletRegistrationKeyRing<Purpose>,
  purpose: Purpose,
): readonly WalletRegistrationKey<Purpose>[] {
  if (
    !ring ||
    typeof ring !== 'object' ||
    !Object.isFrozen(ring) ||
    !validKeyRings.has(ring) ||
    ring.purpose !== purpose ||
    !Array.isArray(ring.keys) ||
    !Object.isFrozen(ring.keys) ||
    ring.keys.length < 1 ||
    ring.keys.length > MAX_WALLET_REGISTRATION_KEYS_PER_PURPOSE
  ) {
    return fail();
  }
  return ring.keys;
}

export function createWalletRegistrationKeyRing<Purpose extends WalletRegistrationKeyPurpose>(
  purpose: Purpose,
  activeWriteVersion: unknown,
  candidates: readonly WalletRegistrationKey<Purpose>[],
): WalletRegistrationKeyRing<Purpose> {
  try {
    const activeVersion = positiveSmallint(activeWriteVersion);
    if (
      !Array.isArray(candidates) ||
      candidates.length < 1 ||
      candidates.length > MAX_WALLET_REGISTRATION_KEYS_PER_PURPOSE
    ) {
      return fail();
    }
    const keys = [...candidates].sort((left, right) => left.version - right.version);
    const versions = new Set<number>();
    const keyIds = new Set<string>();
    const materials: Buffer[] = [];
    for (const key of keys) {
      const material = revealKey(key, purpose);
      if (
        versions.has(key.version) ||
        keyIds.has(key.keyId) ||
        materials.some((candidate) => candidate.equals(material))
      ) {
        return fail();
      }
      versions.add(key.version);
      keyIds.add(key.keyId);
      materials.push(material);
    }
    if (!versions.has(activeVersion) || keys.some((key) => key.version > activeVersion)) {
      return fail();
    }
    const ring = Object.freeze({
      purpose,
      activeWriteVersion: activeVersion,
      keys: Object.freeze(keys),
    }) as WalletRegistrationKeyRing<Purpose>;
    validKeyRings.add(ring);
    return ring;
  } catch {
    return fail();
  }
}

export function activeWalletRegistrationKey<Purpose extends WalletRegistrationKeyPurpose>(
  ring: WalletRegistrationKeyRing<Purpose>,
): WalletRegistrationKey<Purpose> {
  const keys = validatedKeyRing(ring, ring?.purpose);
  const active = keys.find((candidate) => candidate.version === ring.activeWriteVersion);
  if (!active) return fail();
  return active;
}

export function walletRegistrationKeyForVersion<Purpose extends WalletRegistrationKeyPurpose>(
  ring: WalletRegistrationKeyRing<Purpose>,
  version: unknown,
): WalletRegistrationKey<Purpose> {
  const keys = validatedKeyRing(ring, ring?.purpose);
  const exactVersion = positiveSmallint(version);
  const selected = keys.find((candidate) => candidate.version === exactVersion);
  if (!selected) return fail();
  return selected;
}

export function assertWalletRegistrationKeyRingsIndependent(
  rings: readonly WalletRegistrationKeyRing<WalletRegistrationKeyPurpose>[],
): void {
  try {
    if (!Array.isArray(rings) || rings.length !== 3) return fail();
    const purposes = new Set<WalletRegistrationKeyPurpose>();
    const keyIds = new Set<string>();
    const materials: Buffer[] = [];
    for (const ring of rings) {
      const keys = validatedKeyRing(ring, ring?.purpose);
      if (purposes.has(ring.purpose)) return fail();
      purposes.add(ring.purpose);
      for (const key of keys) {
        const material = revealKey(key, ring.purpose);
        if (keyIds.has(key.keyId) || materials.some((candidate) => candidate.equals(material))) {
          return fail();
        }
        keyIds.add(key.keyId);
        materials.push(material);
      }
    }
    if (
      !purposes.has('identity-hmac') ||
      !purposes.has('challenge-hmac') ||
      !purposes.has('metadata-seal')
    ) {
      return fail();
    }
  } catch {
    return fail();
  }
}

function exactText(value: unknown, maximumBytes: number): string {
  if (typeof value !== 'string' || value.length < 1 || /\0/u.test(value)) return fail();
  const length = Buffer.byteLength(value, 'utf8');
  if (length < 1 || length > maximumBytes) return fail();
  return value;
}

function digestWithKey<Purpose extends WalletRegistrationDigestPurpose>(
  purpose: Purpose,
  key: WalletRegistrationKey<'challenge-hmac' | 'identity-hmac'>,
  parts: readonly string[],
): WalletRegistrationDigestReference<Purpose> {
  const expectedKeyPurpose = purpose === 'address' ? 'identity-hmac' : 'challenge-hmac';
  if (key.purpose !== expectedKeyPurpose) return fail();
  const hmac = createHmac('sha256', revealKey(key, expectedKeyPurpose));
  hmac.update(`crypto-lending:wallet-registration:${purpose}:v1\0`, 'utf8');
  for (const part of parts) {
    const value = exactText(part, DIGEST_INPUT_MAX_BYTES);
    const encoded = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.length);
    hmac.update(length);
    hmac.update(encoded);
  }
  return Object.freeze({
    version: key.version,
    value: hmac.digest('hex') as WalletRegistrationDigest<Purpose>,
  });
}

export function digestWalletIdentity(
  key: WalletRegistrationKey<'identity-hmac'>,
  networkId: string,
  canonicalAddress: string,
): WalletRegistrationDigestReference<'address'> {
  if (!NETWORK_ID.test(networkId)) return fail();
  return digestWithKey('address', key, [networkId, canonicalAddress]);
}

export function digestWalletSubjectBinding(
  key: WalletRegistrationKey<'challenge-hmac'>,
  accountId: string,
  challengeId: string,
): WalletRegistrationDigestReference<'account-binding'> {
  if (!UUID_V4.test(accountId) || !UUID_V4.test(challengeId)) return fail();
  return digestWithKey('account-binding', key, [accountId, challengeId]);
}

export function digestWalletChallengeValue<
  Purpose extends Exclude<WalletRegistrationDigestPurpose, 'account-binding' | 'address'>,
>(
  purpose: Purpose,
  key: WalletRegistrationKey<'challenge-hmac'>,
  value: string,
): WalletRegistrationDigestReference<Purpose> {
  if (
    purpose !== 'domain' &&
    purpose !== 'message' &&
    purpose !== 'nonce' &&
    purpose !== 'rate-limit'
  ) {
    return fail();
  }
  return digestWithKey(purpose, key, [value]);
}

function digestReferenceText(reference: WalletRegistrationDigestReference<'address'>): string {
  if (
    !reference ||
    typeof reference !== 'object' ||
    positiveSmallint(reference.version) < 1 ||
    typeof reference.value !== 'string' ||
    !LOWER_HEX_DIGEST.test(reference.value)
  ) {
    return fail();
  }
  return `${reference.version}:${reference.value}`;
}

function sealAad(binding: WalletRegistrationSealBinding, keyVersion: number): Buffer {
  const walletId = binding.field === 'challenge' ? '-' : binding.walletId;
  if (
    (binding.field !== 'address' &&
      binding.field !== 'challenge' &&
      binding.field !== 'metadata') ||
    (binding.field !== 'challenge' && !UUID_V4.test(walletId)) ||
    !UUID_V4.test(binding.challengeId) ||
    !UUID_V4.test(binding.accountId) ||
    !NETWORK_ID.test(binding.networkId)
  ) {
    return fail();
  }
  return Buffer.from(
    [
      'crypto-lending:wallet-registration:sealed:v1',
      binding.field,
      String(keyVersion),
      walletId,
      binding.challengeId,
      binding.accountId,
      binding.networkId,
      digestReferenceText(binding.addressDigest),
    ].join('\0'),
    'utf8',
  );
}

export function sealWalletRegistrationValue(
  key: WalletRegistrationKey<'metadata-seal'>,
  binding: WalletRegistrationSealBinding,
  plaintextValue: string,
): SealedWalletRegistrationValue {
  try {
    const plaintext = Buffer.from(
      exactText(
        plaintextValue,
        binding.field === 'address' ? ADDRESS_PLAINTEXT_MAX_BYTES : STRUCTURED_PLAINTEXT_MAX_BYTES,
      ),
      'utf8',
    );
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', revealKey(key, 'metadata-seal'), iv, {
      authTagLength: 16,
    });
    cipher.setAAD(sealAad(binding, key.version));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Object.freeze({
      keyVersion: key.version,
      ciphertext: ciphertext.toString('base64url'),
      iv: iv.toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url'),
    });
  } catch {
    return fail();
  }
}

export function openWalletRegistrationValue(
  key: WalletRegistrationKey<'metadata-seal'>,
  binding: WalletRegistrationSealBinding,
  sealed: SealedWalletRegistrationValue,
): string {
  try {
    if (!sealed || typeof sealed !== 'object' || sealed.keyVersion !== key.version) return fail();
    const ciphertext = decodeCanonicalBase64Url(sealed.ciphertext);
    if (
      ciphertext.length < 1 ||
      ciphertext.length >
        (binding.field === 'address' ? ADDRESS_PLAINTEXT_MAX_BYTES : STRUCTURED_PLAINTEXT_MAX_BYTES)
    ) {
      return fail();
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      revealKey(key, 'metadata-seal'),
      decodeCanonicalBase64Url(sealed.iv, 12),
      { authTagLength: 16 },
    );
    decipher.setAAD(sealAad(binding, key.version));
    decipher.setAuthTag(decodeCanonicalBase64Url(sealed.authTag, 16));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return fail();
  }
}

export function walletRegistrationDigestEquals(
  left: WalletRegistrationDigestReference,
  right: WalletRegistrationDigestReference,
): boolean {
  try {
    if (left.version !== right.version) return false;
    if (!LOWER_HEX_DIGEST.test(left.value) || !LOWER_HEX_DIGEST.test(right.value)) return false;
    return timingSafeEqual(Buffer.from(left.value, 'hex'), Buffer.from(right.value, 'hex'));
  } catch {
    return false;
  }
}
