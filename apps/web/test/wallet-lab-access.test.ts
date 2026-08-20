import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import webPackage from '../package.json';
import { decideWalletLabAccess, readWalletLabAccessConfiguration } from '../lib/wallets/lab/access';

const validLocalEnvironment = {
  NODE_ENV: 'development',
  WALLET_LAB_ENABLED: 'true',
  WALLET_LAB_ENVIRONMENT: 'local',
  WALLET_LAB_BASIC_AUTH_USERNAME: 'reviewer',
  WALLET_LAB_BASIC_AUTH_PASSWORD: 'a-long-preview-only-password',
};

function authorization(username = 'reviewer', password = 'a-long-preview-only-password') {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

describe('wallet lab access gate', () => {
  it('binds the development server to the IPv4 loopback interface', () => {
    expect(webPackage.scripts.dev).toBe('next dev --hostname 127.0.0.1');
  });

  it('fails closed when disabled or incompletely configured', () => {
    expect(
      decideWalletLabAccess({
        authorization: authorization(),
        configuration: readWalletLabAccessConfiguration({}),
        forwardedProtocol: 'https',
        requestUrl: new URL('https://preview.example/internal/wallet-lab'),
      }),
    ).toMatchObject({ allowed: false, reason: 'disabled', status: 404 });

    expect(
      decideWalletLabAccess({
        authorization: authorization(),
        configuration: readWalletLabAccessConfiguration({
          ...validLocalEnvironment,
          WALLET_LAB_BASIC_AUTH_PASSWORD: 'short',
        }),
        forwardedProtocol: 'https',
        requestUrl: new URL('https://127.0.0.1:3000/internal/wallet-lab'),
      }),
    ).toMatchObject({ allowed: false, reason: 'invalid-configuration', status: 404 });
  });

  it('allows exact HTTP and HTTPS loopback URLs only in a development runtime', () => {
    expect(
      decideWalletLabAccess({
        authorization: authorization(),
        configuration: readWalletLabAccessConfiguration(validLocalEnvironment),
        forwardedProtocol: null,
        requestUrl: new URL('http://127.0.0.1:3000/internal/wallet-lab'),
      }),
    ).toEqual({ allowed: true });

    expect(
      decideWalletLabAccess({
        authorization: authorization(),
        configuration: readWalletLabAccessConfiguration(validLocalEnvironment),
        forwardedProtocol: null,
        requestUrl: new URL('https://localhost:3000/internal/wallet-lab'),
      }),
    ).toEqual({ allowed: true });

    expect(
      decideWalletLabAccess({
        authorization: authorization(),
        configuration: readWalletLabAccessConfiguration({
          ...validLocalEnvironment,
          NODE_ENV: 'production',
        }),
        forwardedProtocol: 'https',
        requestUrl: new URL('https://127.0.0.1:3000/internal/wallet-lab'),
      }),
    ).toMatchObject({ allowed: false, reason: 'insecure-transport', status: 404 });
  });

  it('rejects non-loopback requests even when forwarded protocol claims HTTPS', () => {
    expect(
      decideWalletLabAccess({
        authorization: authorization(),
        configuration: readWalletLabAccessConfiguration(validLocalEnvironment),
        forwardedProtocol: 'https',
        requestUrl: new URL('http://preview.example/internal/wallet-lab'),
      }),
    ).toMatchObject({ allowed: false, reason: 'insecure-transport', status: 404 });
  });

  it('keeps preview mode fail-closed under the current authorization', () => {
    expect(
      decideWalletLabAccess({
        authorization: authorization(),
        configuration: readWalletLabAccessConfiguration({
          ...validLocalEnvironment,
          NODE_ENV: 'production',
          WALLET_LAB_ENVIRONMENT: 'preview',
        }),
        forwardedProtocol: 'https',
        requestUrl: new URL('https://preview.example/internal/wallet-lab'),
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'environment-not-authorized',
      status: 404,
    });
  });

  it('rejects malformed or incorrect Basic credentials', () => {
    const configuration = readWalletLabAccessConfiguration(validLocalEnvironment);
    const input = {
      configuration,
      forwardedProtocol: null,
      requestUrl: new URL('http://127.0.0.1:3000/internal/wallet-lab'),
    };

    expect(decideWalletLabAccess({ ...input, authorization: null })).toMatchObject({
      allowed: false,
      reason: 'unauthorized',
      status: 401,
    });
    expect(
      decideWalletLabAccess({ ...input, authorization: authorization('reviewer', 'wrong') }),
    ).toMatchObject({ allowed: false, reason: 'unauthorized', status: 401 });
    expect(decideWalletLabAccess({ ...input, authorization: authorization() })).toEqual({
      allowed: true,
    });
  });
});
