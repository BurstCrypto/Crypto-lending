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

function ring(
  purpose: 'challenge-hmac' | 'identity-hmac' | 'metadata-seal',
  activeWriteVersion: number,
  versions: readonly number[],
): string {
  return JSON.stringify({
    activeWriteVersion,
    keys: versions.map((version) => ({
      keyId: `test-${purpose}-${String(version)}`,
      purpose,
      version,
      material: randomBytes(32).toString('base64url'),
    })),
  });
}

function useRings(environment: NodeJS.ProcessEnv): void {
  for (const [purpose, prefix] of [
    ['identity-hmac', 'WALLET_IDENTITY_HMAC'],
    ['challenge-hmac', 'WALLET_CHALLENGE_HMAC'],
    ['metadata-seal', 'WALLET_METADATA_SEAL'],
  ] as const) {
    delete environment[`${prefix}_KEY_VERSION`];
    delete environment[`${prefix}_KEY`];
    environment[`${prefix}_KEY_RING_JSON`] = ring(purpose, 2, [1, 2]);
  }
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
    expect(config.identityHmacKeys).toEqual({
      purpose: 'identity-hmac',
      activeWriteVersion: 1,
      keys: [{ keyId: 'wallet-identity-hmac-v1', purpose: 'identity-hmac', version: 1 }],
    });
    expect(config.challengeHmacKeys).toEqual({
      purpose: 'challenge-hmac',
      activeWriteVersion: 1,
      keys: [{ keyId: 'wallet-challenge-hmac-v1', purpose: 'challenge-hmac', version: 1 }],
    });
    expect(config.metadataSealKeys).toEqual({
      purpose: 'metadata-seal',
      activeWriteVersion: 1,
      keys: [{ keyId: 'wallet-metadata-seal-v1', purpose: 'metadata-seal', version: 1 }],
    });
  });

  it('loads bounded current-plus-previous rings with explicit IDs and active write versions', () => {
    const environment = enabledEnvironment();
    useRings(environment);
    const config = loadWalletRegistrationConfig(environment);
    if (config.mode !== 'enabled') throw new Error('Expected enabled config');

    expect(config.identityHmacKeys).toMatchObject({
      purpose: 'identity-hmac',
      activeWriteVersion: 2,
      keys: [
        { keyId: 'test-identity-hmac-1', version: 1 },
        { keyId: 'test-identity-hmac-2', version: 2 },
      ],
    });
    expect(config.challengeHmacKeys.keys).toHaveLength(2);
    expect(config.metadataSealKeys.keys).toHaveLength(2);
  });

  it('permits the exact development loopback origin only in guarded local demo mode', () => {
    const environment = enabledEnvironment();
    Object.assign(environment, {
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      LOCAL_DEMO_MODE: 'enabled',
    });
    expect(loadWalletRegistrationConfig(environment)).toMatchObject({
      mode: 'enabled',
      publicOrigin: 'http://127.0.0.1:3000',
    });

    for (const [name, value] of [
      ['NODE_ENV', 'production'],
      ['API_HOST', '0.0.0.0'],
      ['AUTH_PUBLIC_ORIGIN', 'http://localhost:3000'],
    ] as const) {
      const invalid = { ...environment, [name]: value };
      expect(() => loadWalletRegistrationConfig(invalid)).toThrow(
        WalletRegistrationConfigurationError,
      );
    }
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

  it('rejects malformed, ambiguous, oversized, and non-independent key rings', () => {
    const mutations: readonly ((environment: NodeJS.ProcessEnv) => void)[] = [
      (environment) => {
        useRings(environment);
        environment.WALLET_IDENTITY_HMAC_KEY = randomBytes(32).toString('base64url');
      },
      (environment) => {
        useRings(environment);
        environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON = ` ${environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON}`;
      },
      (environment) => {
        useRings(environment);
        const material = randomBytes(32).toString('base64url');
        environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON = JSON.stringify({
          activeWriteVersion: 2,
          keys: [
            { keyId: 'identity-one', purpose: 'identity-hmac', version: 1, material },
            { keyId: 'identity-two', purpose: 'identity-hmac', version: 2, material },
          ],
        });
      },
      (environment) => {
        useRings(environment);
        environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON = ring('identity-hmac', 3, [1, 2]);
      },
      (environment) => {
        useRings(environment);
        environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON = ring('identity-hmac', 2, [1, 2, 3]);
      },
      (environment) => {
        useRings(environment);
        const parsed = JSON.parse(environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON ?? '') as {
          keys: Array<Record<string, unknown>>;
        };
        parsed.keys.reverse();
        environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON = JSON.stringify(parsed);
      },
      (environment) => {
        useRings(environment);
        const parsed = JSON.parse(environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON ?? '') as {
          keys: Array<Record<string, unknown>>;
        };
        parsed.keys[0] = { ...parsed.keys[0], purpose: 'challenge-hmac' };
        environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON = JSON.stringify(parsed);
      },
      (environment) => {
        useRings(environment);
        const identity = JSON.parse(environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON ?? '') as {
          keys: Array<{ keyId: string; material: string }>;
        };
        const challenge = JSON.parse(environment.WALLET_CHALLENGE_HMAC_KEY_RING_JSON ?? '') as {
          keys: Array<{ keyId: string; material: string }>;
        };
        if (!identity.keys[0] || !challenge.keys[0]) throw new Error('fixture key expected');
        challenge.keys[0].keyId = identity.keys[0].keyId;
        environment.WALLET_CHALLENGE_HMAC_KEY_RING_JSON = JSON.stringify(challenge);
      },
      (environment) => {
        useRings(environment);
        const identity = JSON.parse(environment.WALLET_IDENTITY_HMAC_KEY_RING_JSON ?? '') as {
          keys: Array<{ material: string }>;
        };
        const metadata = JSON.parse(environment.WALLET_METADATA_SEAL_KEY_RING_JSON ?? '') as {
          keys: Array<{ material: string }>;
        };
        if (!identity.keys[0] || !metadata.keys[0]) throw new Error('fixture key expected');
        metadata.keys[0].material = identity.keys[0].material;
        environment.WALLET_METADATA_SEAL_KEY_RING_JSON = JSON.stringify(metadata);
      },
    ];

    for (const mutate of mutations) {
      const environment = enabledEnvironment();
      mutate(environment);
      expect(() => loadWalletRegistrationConfig(environment)).toThrow(
        WalletRegistrationConfigurationError,
      );
    }
  });
});
