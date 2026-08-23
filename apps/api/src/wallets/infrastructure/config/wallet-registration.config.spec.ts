import { randomBytes } from 'node:crypto';

import {
  WalletRegistrationConfigurationError,
  loadWalletRegistrationConfig,
} from './wallet-registration.config';

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    AUTH_MODE: 'oidc',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    WALLET_REGISTRATION_MODE: 'enabled',
    WALLET_REGISTRATION_REGISTRY_ENVIRONMENT: 'TESTNET',
    WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS: '300',
    WALLET_IDENTITY_HMAC_KEY_VERSION: '1',
    WALLET_IDENTITY_HMAC_KEY: randomBytes(32).toString('base64url'),
    WALLET_CHALLENGE_HMAC_KEY_VERSION: '1',
    WALLET_CHALLENGE_HMAC_KEY: randomBytes(32).toString('base64url'),
    WALLET_METADATA_SEAL_KEY_VERSION: '1',
    WALLET_METADATA_SEAL_KEY: randomBytes(32).toString('base64url'),
  };
}

describe('wallet registration configuration', () => {
  it('is disabled by default and rejects stray wallet secrets while disabled', () => {
    expect(loadWalletRegistrationConfig({})).toEqual({ mode: 'disabled' });
    expect(() => loadWalletRegistrationConfig({ WALLET_IDENTITY_HMAC_KEY: 'unexpected' })).toThrow(
      WalletRegistrationConfigurationError,
    );
  });

  it('loads a complete, explicitly enabled local-test configuration', () => {
    const config = loadWalletRegistrationConfig(enabledEnvironment());

    expect(config.mode).toBe('enabled');
    if (config.mode !== 'enabled') throw new Error('Expected enabled config');
    expect(config.publicOrigin).toBe('http://127.0.0.1:3000');
    expect(config.registryEnvironment).toBe('TESTNET');
    expect(config.challengeTtlSeconds).toBe(300);
    expect(config.identityHmacKey).toEqual({ purpose: 'identity-hmac', version: 1 });
    expect(config.challengeHmacKey).toEqual({ purpose: 'challenge-hmac', version: 1 });
    expect(config.metadataSealKey).toEqual({ purpose: 'metadata-seal', version: 1 });
  });

  it('requires HTTPS outside tests and only permits an exact loopback HTTP test origin', () => {
    const production = enabledEnvironment();
    production.NODE_ENV = 'production';
    expect(() => loadWalletRegistrationConfig(production)).toThrow(
      WalletRegistrationConfigurationError,
    );

    for (const origin of [
      'http://example.test',
      'http://127.0.0.1:3000/path',
      ['http://', 'user', '@', '127.0.0.1:3000'].join(''),
      'https://example.test/',
    ]) {
      const environment = enabledEnvironment();
      environment.AUTH_PUBLIC_ORIGIN = origin;
      expect(() => loadWalletRegistrationConfig(environment)).toThrow(
        WalletRegistrationConfigurationError,
      );
    }

    const secure = enabledEnvironment();
    secure.NODE_ENV = 'production';
    secure.AUTH_PUBLIC_ORIGIN = 'https://app.example.test';
    expect(loadWalletRegistrationConfig(secure)).toMatchObject({
      mode: 'enabled',
      publicOrigin: 'https://app.example.test',
    });
  });

  it('fails closed on bad bounds, key reuse, and partial configurations', () => {
    for (const mutate of [
      (environment: NodeJS.ProcessEnv): void => {
        environment.WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS = '59';
      },
      (environment: NodeJS.ProcessEnv): void => {
        environment.WALLET_REGISTRATION_REGISTRY_ENVIRONMENT = 'DEVELOPMENT';
      },
      (environment: NodeJS.ProcessEnv): void => {
        environment.WALLET_IDENTITY_HMAC_KEY_VERSION = '0';
      },
      (environment: NodeJS.ProcessEnv): void => {
        environment.WALLET_IDENTITY_HMAC_KEY = 'not-a-key';
      },
      (environment: NodeJS.ProcessEnv): void => {
        environment.WALLET_CHALLENGE_HMAC_KEY = environment.WALLET_IDENTITY_HMAC_KEY;
      },
      (environment: NodeJS.ProcessEnv): void => {
        environment.WALLET_CHALLENGE_HMAC_KEY_VERSION = '2';
        environment.WALLET_CHALLENGE_HMAC_KEY = environment.WALLET_IDENTITY_HMAC_KEY;
      },
      (environment: NodeJS.ProcessEnv): void => {
        delete environment.WALLET_METADATA_SEAL_KEY;
      },
      (environment: NodeJS.ProcessEnv): void => {
        environment.AUTH_MODE = 'disabled';
      },
    ]) {
      const environment = enabledEnvironment();
      mutate(environment);
      expect(() => loadWalletRegistrationConfig(environment)).toThrow(
        WalletRegistrationConfigurationError,
      );
    }
  });
});
