import { randomBytes } from 'node:crypto';

import {
  parseOidcProviderKey,
  parseOidcSubject,
  type PreAuthenticationTransactionCookiePayload,
} from '../../domain/authentication';
import {
  AuthenticationCryptoError,
  activeAuthenticationHmacKey,
  assertAuthenticationKeysIndependent,
  createAuthenticationHmacKeyRing,
  constantTimeAuthenticationValueEquals,
  createAuthenticationKey,
  createKeyedAuthenticationDigest,
  createOidcIdentityDigest,
  createPkceS256Challenge,
  createSensitiveAuthenticationText,
  digestOpaqueAuthenticationSecret,
  generateOpaqueAuthenticationSecret,
  generatePkceVerifier,
  openPreAuthenticationTransactionCookie,
  revealSensitiveAuthenticationText,
  sealPreAuthenticationTransactionCookie,
} from './authentication-crypto';

function encodedKey(fill?: number): string {
  return (fill === undefined ? randomBytes(32) : Buffer.alloc(32, fill)).toString('base64url');
}

describe('authentication cryptography', () => {
  it('generates independent 256-bit state, binding, nonce, session, and CSRF values', () => {
    const values = new Set([
      generateOpaqueAuthenticationSecret('oidc-state'),
      generateOpaqueAuthenticationSecret('browser-binding'),
      generateOpaqueAuthenticationSecret('oidc-nonce'),
      generateOpaqueAuthenticationSecret('session'),
      generateOpaqueAuthenticationSecret('csrf'),
    ]);
    expect(values.size).toBe(5);
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('creates an RFC 7636 S256 challenge from a 256-bit verifier', () => {
    const verifier = generatePkceVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(createPkceS256Challenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(createPkceS256Challenge(verifier)).toBe(createPkceS256Challenge(verifier));
  });

  it('domain-separates opaque, keyed, and identity digests', () => {
    const value = generateOpaqueAuthenticationSecret('oidc-state');
    const sessionKey = createAuthenticationKey('session-hmac', 'session_v1', encodedKey(1));
    const csrfKey = createAuthenticationKey('csrf-hmac', 'csrf_v1', encodedKey(2));
    const identityKey = createAuthenticationKey('identity-hmac', 'identity_v1', encodedKey(3));
    const digests = new Set([
      digestOpaqueAuthenticationSecret('oidc-state', value),
      createKeyedAuthenticationDigest('session', sessionKey, value),
      createKeyedAuthenticationDigest('csrf', csrfKey, value),
      createOidcIdentityDigest(
        identityKey,
        parseOidcProviderKey('primary'),
        'https://identity.example.test/',
        parseOidcSubject('CaseSensitiveSubject'),
      ),
    ]);
    expect(digests.size).toBe(4);
    for (const digest of digests) expect(digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('constructs a bounded versioned key ring with one active write key', () => {
    const prior = createAuthenticationKey('session-hmac', 'session_v1', encodedKey(8), 1);
    const successor = createAuthenticationKey('session-hmac', 'session_v2', encodedKey(9), 2);
    const staged = createAuthenticationHmacKeyRing('session-hmac', 1, [successor, prior]);
    expect(staged.keys.map(({ version }) => version)).toEqual([1, 2]);
    expect(activeAuthenticationHmacKey(staged)).toBe(prior);

    const ring = createAuthenticationHmacKeyRing('session-hmac', 2, [successor, prior]);
    expect(ring.keys.map(({ version }) => version)).toEqual([1, 2]);
    expect(activeAuthenticationHmacKey(ring)).toBe(successor);
    expect(Object.isFrozen(ring)).toBe(true);
    expect(Object.isFrozen(ring.keys)).toBe(true);
    expect(JSON.stringify(ring)).not.toContain(encodedKey(8));
  });

  it('rejects duplicate versions/material, missing active versions, and cross-purpose reuse', () => {
    const first = createAuthenticationKey('identity-hmac', 'identity_v1', encodedKey(10), 1);
    const duplicateMaterial = createAuthenticationKey(
      'identity-hmac',
      'identity_v2',
      encodedKey(10),
      2,
    );
    expect(() =>
      createAuthenticationHmacKeyRing('identity-hmac', 2, [first, duplicateMaterial]),
    ).toThrow(AuthenticationCryptoError);
    expect(() => createAuthenticationHmacKeyRing('identity-hmac', 2, [first])).toThrow(
      AuthenticationCryptoError,
    );
    const csrf = createAuthenticationKey('csrf-hmac', 'csrf_v1', encodedKey(10), 1);
    expect(() => assertAuthenticationKeysIndependent([first, csrf, first, csrf])).toThrow(
      AuthenticationCryptoError,
    );
  });

  it('does not expose wrapped client credentials through enumeration or JSON', () => {
    const raw = 'client-secret-canary';
    const wrapped = createSensitiveAuthenticationText('oidc-client-secret', raw);
    expect(Reflect.ownKeys(wrapped)).toEqual([]);
    expect(JSON.stringify(wrapped)).toBe('{}');
    expect(revealSensitiveAuthenticationText(wrapped)).toBe(raw);
  });

  it('seals and authenticates a bounded pre-authentication cookie payload', () => {
    const key = createAuthenticationKey('preauth-seal', 'seal_v1', encodedKey(4));
    const payload: PreAuthenticationTransactionCookiePayload = {
      version: 1,
      transactionId: '00000000-0000-4000-8000-000000000001',
      flow: 'registration',
      state: generateOpaqueAuthenticationSecret('oidc-state'),
      browserBinding: generateOpaqueAuthenticationSecret('browser-binding'),
      nonce: generateOpaqueAuthenticationSecret('oidc-nonce'),
      codeVerifier: generatePkceVerifier(),
      returnPath: '/dashboard',
      registration: {
        contactEmail: 'person@example.test',
        contactPhone: null,
        declaredResidencyCountryCode: 'US',
      },
      issuedAtEpochSeconds: 1_000,
      expiresAtEpochSeconds: 1_300,
    };
    const sealed = sealPreAuthenticationTransactionCookie(payload, key);

    expect(sealed).not.toContain(payload.state);
    expect(sealed).not.toContain(payload.nonce);
    expect(sealed).not.toContain(payload.browserBinding);
    expect(sealed).not.toContain(payload.codeVerifier);
    expect(sealed).not.toContain('person@example.test');
    expect(sealed.length).toBeLessThanOrEqual(2_048);
    expect(openPreAuthenticationTransactionCookie(sealed, [key], 1_100)).toEqual(payload);
  });

  it('rejects tampering, the wrong key, unknown key IDs, and expired cookies generically', () => {
    const key = createAuthenticationKey('preauth-seal', 'seal_v1', encodedKey(5));
    const wrongKey = createAuthenticationKey('preauth-seal', 'seal_v1', encodedKey(6));
    const payload: PreAuthenticationTransactionCookiePayload = {
      version: 1,
      transactionId: '00000000-0000-4000-8000-000000000001',
      flow: 'login',
      state: generateOpaqueAuthenticationSecret('oidc-state'),
      browserBinding: generateOpaqueAuthenticationSecret('browser-binding'),
      nonce: generateOpaqueAuthenticationSecret('oidc-nonce'),
      codeVerifier: generatePkceVerifier(),
      returnPath: '/dashboard',
      issuedAtEpochSeconds: 1_000,
      expiresAtEpochSeconds: 1_100,
    };
    const sealed = sealPreAuthenticationTransactionCookie(payload, key);
    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith('A') ? 'B' : 'A'}`;

    for (const operation of [
      () => openPreAuthenticationTransactionCookie(tampered, [key], 1_050),
      () => openPreAuthenticationTransactionCookie(sealed, [wrongKey], 1_050),
      () => openPreAuthenticationTransactionCookie(sealed, [], 1_050),
      () => openPreAuthenticationTransactionCookie(sealed, [key], 1_100),
    ]) {
      expect(operation).toThrow(AuthenticationCryptoError);
      try {
        operation();
      } catch (error) {
        expect(String(error)).not.toMatch(/seal_v1|oidc-state|private|secret/u);
      }
    }
  });

  it('rejects cross-purpose keyed digest use', () => {
    const key = createAuthenticationKey('session-hmac', 'session_v1', encodedKey(7));
    expect(() => createKeyedAuthenticationDigest('csrf', key, 'value')).toThrow(
      AuthenticationCryptoError,
    );
  });

  it('compares authentication values without accepting type or length ambiguity', () => {
    expect(constantTimeAuthenticationValueEquals('same', 'same')).toBe(true);
    expect(constantTimeAuthenticationValueEquals('same', 'different')).toBe(false);
    expect(constantTimeAuthenticationValueEquals('a', 'aa')).toBe(false);
    expect(constantTimeAuthenticationValueEquals({}, 'same')).toBe(false);
  });
});
