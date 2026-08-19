import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  assertWalletLabTlsMaterial,
  resolveWalletLabSecureAccess,
  WALLET_LAB_AUTHORITY,
  type WalletLabSecureAccessEnvironment,
} from '../server/secure-access';

const CERTIFICATE_PATH = resolve('wallet-lab-test-certificate.pem');
const PRIVATE_KEY_PATH = resolve('wallet-lab-test-private-key.pem');
const CERTIFICATE_BYTES = Buffer.from('test-certificate-bytes');
const PRIVATE_KEY_BYTES = Buffer.from('test-private-key-bytes');
const USERNAME = 'wallet-lab-reviewer';
const PASSWORD = 'correct-horse-battery-staple-lab';

const ENVIRONMENT: WalletLabSecureAccessEnvironment = {
  WALLET_LAB_ACCESS_PASSWORD: PASSWORD,
  WALLET_LAB_ACCESS_USERNAME: USERNAME,
  WALLET_LAB_HTTPS_CERT_PATH: CERTIFICATE_PATH,
  WALLET_LAB_HTTPS_KEY_PATH: PRIVATE_KEY_PATH,
};

function resolveFixture(environment: WalletLabSecureAccessEnvironment = ENVIRONMENT) {
  const validateTlsMaterial = vi.fn();
  const now = new Date('2026-08-19T12:00:00.000Z');
  const secureAccess = resolveWalletLabSecureAccess(environment, {
    now,
    readFile(path) {
      if (path === CERTIFICATE_PATH) return CERTIFICATE_BYTES;
      if (path === PRIVATE_KEY_PATH) return PRIVATE_KEY_BYTES;
      throw new Error('unexpected test path');
    },
    validateTlsMaterial,
  });

  return { now, secureAccess, validateTlsMaterial };
}

function basicAuthorization(username = USERNAME, password = PASSWORD): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

describe('wallet lab secure access', () => {
  it('loads bounded TLS material and delegates strict certificate validation', () => {
    const { now, secureAccess, validateTlsMaterial } = resolveFixture();

    expect(validateTlsMaterial).toHaveBeenCalledWith(CERTIFICATE_BYTES, PRIVATE_KEY_BYTES, now);
    expect(secureAccess.https).toEqual({
      cert: CERTIFICATE_BYTES,
      key: PRIVATE_KEY_BYTES,
      minVersion: 'TLSv1.2',
    });
  });

  it('accepts exact Basic credentials and issues a secure host-only session cookie', () => {
    const { secureAccess } = resolveFixture();
    const decision = secureAccess.access.authorize(
      {
        authorization: basicAuthorization(),
        host: WALLET_LAB_AUTHORITY,
      },
      'http',
    );

    expect(decision).toEqual({ allowed: true, via: 'basic' });
    expect(secureAccess.access.sessionCookie).toMatch(
      /^__Host-wallet_lab_access=[A-Za-z\d_-]+; Path=\/; Secure; HttpOnly; SameSite=Strict$/u,
    );
  });

  it('accepts the session cookie for same-origin WSS without exposing Basic credentials', () => {
    const { secureAccess } = resolveFixture();
    const cookie = secureAccess.access.sessionCookie.split(';', 1)[0];

    expect(
      secureAccess.access.authorize(
        {
          cookie: `unrelated=value; ${cookie}`,
          host: WALLET_LAB_AUTHORITY,
          origin: 'https://127.0.0.1:4173',
        },
        'websocket',
      ),
    ).toEqual({ allowed: true, via: 'cookie' });
  });

  it.each([
    [
      'wrong host',
      { authorization: basicAuthorization(), host: 'localhost:4173' },
      'http' as const,
      'invalid-host',
    ],
    [
      'wrong WebSocket origin',
      {
        authorization: basicAuthorization(),
        host: WALLET_LAB_AUTHORITY,
        origin: 'https://localhost:4173',
      },
      'websocket' as const,
      'invalid-origin',
    ],
    [
      'missing credentials',
      { host: WALLET_LAB_AUTHORITY },
      'http' as const,
      'access-credentials-required',
    ],
    [
      'wrong password',
      {
        authorization: basicAuthorization(USERNAME, `${PASSWORD}-wrong`),
        host: WALLET_LAB_AUTHORITY,
      },
      'http' as const,
      'access-credentials-required',
    ],
    [
      'ambiguous Authorization headers',
      { authorization: [basicAuthorization(), basicAuthorization()], host: WALLET_LAB_AUTHORITY },
      'http' as const,
      'access-credentials-required',
    ],
  ])('rejects %s', (_label, headers, transport, reason) => {
    const { secureAccess } = resolveFixture();

    expect(secureAccess.access.authorize(headers, transport)).toEqual({ allowed: false, reason });
  });

  it.each([
    ['missing certificate path', { ...ENVIRONMENT, WALLET_LAB_HTTPS_CERT_PATH: undefined }],
    ['relative certificate path', { ...ENVIRONMENT, WALLET_LAB_HTTPS_CERT_PATH: 'cert.pem' }],
    ['shared key path', { ...ENVIRONMENT, WALLET_LAB_HTTPS_KEY_PATH: CERTIFICATE_PATH }],
    ['invalid username', { ...ENVIRONMENT, WALLET_LAB_ACCESS_USERNAME: 'reviewer:name' }],
    ['short password', { ...ENVIRONMENT, WALLET_LAB_ACCESS_PASSWORD: 'too-short' }],
    ['whitespace password', { ...ENVIRONMENT, WALLET_LAB_ACCESS_PASSWORD: 'a'.repeat(23) + ' ' }],
  ])('fails closed for %s', (_label, environment) => {
    expect(() => resolveFixture(environment)).toThrow();
  });

  it('rejects unreadable TLS paths without echoing the configured path', () => {
    expect(() =>
      resolveWalletLabSecureAccess(ENVIRONMENT, {
        readFile() {
          throw new Error('filesystem detail');
        },
      }),
    ).toThrow('Wallet lab HTTPS certificate could not be read.');

    try {
      resolveWalletLabSecureAccess(ENVIRONMENT, {
        readFile() {
          throw new Error('filesystem detail');
        },
      });
    } catch (error) {
      expect(String(error)).not.toContain(CERTIFICATE_PATH);
      expect(String(error)).not.toContain(PASSWORD);
    }
  });

  it('rejects malformed certificate material with a generic error', () => {
    expect(() =>
      assertWalletLabTlsMaterial(
        Buffer.from('not-a-certificate'),
        Buffer.from('not-a-private-key'),
      ),
    ).toThrow('Wallet lab HTTPS certificate is not valid PEM X.509 material.');
  });
});
