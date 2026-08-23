import { randomBytes, randomUUID } from 'node:crypto';

import {
  WalletRegistrationCryptoError,
  createWalletRegistrationKey,
  digestWalletChallengeValue,
  digestWalletIdentity,
  digestWalletSubjectBinding,
  openWalletRegistrationValue,
  sealWalletRegistrationValue,
  walletRegistrationDigestEquals,
  type WalletRegistrationSealBinding,
} from './wallet-registration-crypto';

function encodedKey(): string {
  return randomBytes(32).toString('base64url');
}

function binding(
  addressDigest = digestWalletIdentity(
    createWalletRegistrationKey('identity-hmac', 1, encodedKey()),
    'eip155:11155111',
    '0xde709f2102306220921060314715629080e2fb77',
  ),
): WalletRegistrationSealBinding {
  return {
    field: 'address',
    walletId: randomUUID(),
    challengeId: randomUUID(),
    accountId: randomUUID(),
    networkId: 'eip155:11155111',
    addressDigest,
  };
}

describe('wallet registration cryptography', () => {
  it('creates hidden, purpose-bound keys and deterministic domain-separated digests', () => {
    const keyMaterial = encodedKey();
    const identity = createWalletRegistrationKey('identity-hmac', 7, keyMaterial);
    const challenge = createWalletRegistrationKey('challenge-hmac', 8, encodedKey());
    const first = digestWalletIdentity(
      identity,
      'eip155:11155111',
      '0xde709f2102306220921060314715629080e2fb77',
    );
    const second = digestWalletIdentity(
      identity,
      'eip155:11155111',
      '0xde709f2102306220921060314715629080e2fb77',
    );

    expect(first).toEqual(second);
    expect(first.version).toBe(7);
    expect(first.value).toMatch(/^[0-9a-f]{64}$/u);
    expect(walletRegistrationDigestEquals(first, second)).toBe(true);
    expect(
      digestWalletIdentity(identity, 'eip155:1', '0xde709f2102306220921060314715629080e2fb77'),
    ).not.toEqual(first);
    expect(digestWalletChallengeValue('nonce', challenge, 'same-value')).not.toEqual(
      digestWalletChallengeValue('message', challenge, 'same-value'),
    );
    const accountId = randomUUID();
    const challengeId = randomUUID();
    const subject = digestWalletSubjectBinding(challenge, accountId, challengeId);
    expect(subject).toEqual(digestWalletSubjectBinding(challenge, accountId, challengeId));
    expect(subject).not.toEqual(digestWalletSubjectBinding(challenge, accountId, randomUUID()));
    expect(subject).not.toEqual(digestWalletSubjectBinding(challenge, randomUUID(), challengeId));
    expect(JSON.stringify(identity)).not.toContain(keyMaterial);
    expect(Reflect.ownKeys(identity)).toEqual(['purpose', 'version']);
  });

  it('seals values with random AES-GCM nonces and exact row-bound AAD', () => {
    const key = createWalletRegistrationKey('metadata-seal', 3, encodedKey());
    const rowBinding = binding();
    const first = sealWalletRegistrationValue(key, rowBinding, 'sensitive-wallet-value');
    const second = sealWalletRegistrationValue(key, rowBinding, 'sensitive-wallet-value');

    expect(first).not.toEqual(second);
    expect(first.keyVersion).toBe(3);
    expect(first.iv).not.toBe(second.iv);
    expect(JSON.stringify(first)).not.toContain('sensitive-wallet-value');
    expect(openWalletRegistrationValue(key, rowBinding, first)).toBe('sensitive-wallet-value');
  });

  it('rejects ciphertext tampering, row swapping, wrong keys, and malformed key material', () => {
    const key = createWalletRegistrationKey('metadata-seal', 1, encodedKey());
    const rowBinding = binding();
    const sealed = sealWalletRegistrationValue(key, rowBinding, 'wallet-metadata');

    expect(() =>
      openWalletRegistrationValue(key, { ...rowBinding, accountId: randomUUID() }, sealed),
    ).toThrow(WalletRegistrationCryptoError);
    expect(() =>
      openWalletRegistrationValue(
        createWalletRegistrationKey('metadata-seal', 1, encodedKey()),
        rowBinding,
        sealed,
      ),
    ).toThrow(WalletRegistrationCryptoError);
    expect(() =>
      openWalletRegistrationValue(key, rowBinding, {
        ...sealed,
        ciphertext: `${sealed.ciphertext.slice(0, -1)}A`,
      }),
    ).toThrow(WalletRegistrationCryptoError);
    expect(() => createWalletRegistrationKey('identity-hmac', 1, 'raw-secret')).toThrow(
      WalletRegistrationCryptoError,
    );
  });
});
