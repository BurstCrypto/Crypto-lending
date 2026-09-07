import {
  loadAuthenticationConfig,
  AuthenticationConfigurationError,
} from './authentication.config';

function oidcEnvironment(): NodeJS.ProcessEnv {
  const key = (value: number): string => Buffer.alloc(32, value).toString('base64url');
  return {
    NODE_ENV: 'test',
    AUTH_MODE: 'oidc',
    OIDC_PROVIDER_KEY: 'primary',
    OIDC_ISSUER_URL: 'https://identity.example.test/tenant',
    OIDC_AUTHORIZATION_ENDPOINT: 'https://identity.example.test/oauth2/authorize',
    OIDC_TOKEN_ENDPOINT: 'https://identity.example.test/oauth2/token',
    OIDC_JWKS_URI: 'https://identity.example.test/.well-known/jwks.json',
    OIDC_CLIENT_ID: 'crypto-lending-web',
    OIDC_AUDIENCE: 'crypto-lending-web',
    OIDC_SIGNING_ALGORITHM: 'RS256',
    OIDC_TOKEN_AUTH_METHOD: 'client_secret_basic',
    OIDC_CLIENT_SECRET: 'client-secret-canary',
    AUTH_PUBLIC_ORIGIN: 'https://app.example.test',
    OIDC_REDIRECT_URI: 'https://app.example.test/api/v1/auth/callback',
    OIDC_HTTP_TIMEOUT_MS: '3000',
    OIDC_TOKEN_RESPONSE_MAX_BYTES: '65536',
    OIDC_JWKS_RESPONSE_MAX_BYTES: '131072',
    OIDC_JWKS_CACHE_TTL_SECONDS: '300',
    OIDC_CLOCK_TOLERANCE_SECONDS: '30',
    OIDC_MAX_ID_TOKEN_AGE_SECONDS: '600',
    AUTH_PREAUTH_TTL_SECONDS: '600',
    AUTH_SESSION_IDLE_TTL_SECONDS: '86400',
    AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
    AUTH_PREAUTH_SEAL_KEY_ID: 'seal_v1',
    AUTH_PREAUTH_SEAL_KEY: key(1),
    AUTH_IDENTITY_HMAC_KEY_ID: 'identity_v1',
    AUTH_IDENTITY_HMAC_KEY: key(2),
    AUTH_SESSION_HMAC_KEY_ID: 'session_v1',
    AUTH_SESSION_HMAC_KEY: key(3),
    AUTH_CSRF_HMAC_KEY_ID: 'csrf_v1',
    AUTH_CSRF_HMAC_KEY: key(4),
  };
}

function cognitoEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...oidcEnvironment(),
    OIDC_PROVIDER_KEY: 'cognito',
    OIDC_ISSUER_URL: 'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_ExampleUserPool',
    OIDC_JWKS_URI:
      'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_ExampleUserPool/.well-known/jwks.json',
    OIDC_TOKEN_AUTH_METHOD: 'none',
    OIDC_REQUIRED_TOKEN_USE: 'id',
    OIDC_END_SESSION_ENDPOINT: 'https://identity.example.test/logout',
    OIDC_POST_LOGOUT_REDIRECT_URI: 'https://app.example.test/login',
  };
  delete environment.OIDC_CLIENT_SECRET;
  return environment;
}

describe('authentication configuration', () => {
  it('defaults to an exact frozen disabled mode when no auth values are present', () => {
    const config = loadAuthenticationConfig({ NODE_ENV: 'test' });
    expect(config).toEqual({ mode: 'disabled' });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each(['production', 'Production', ' production '] as const)(
    'requires explicit managed OIDC when NODE_ENV is %s',
    (nodeEnvironment) => {
      for (const authMode of [undefined, 'disabled'] as const) {
        const environment: NodeJS.ProcessEnv = { NODE_ENV: nodeEnvironment };
        if (authMode !== undefined) environment.AUTH_MODE = authMode;

        expect(() => loadAuthenticationConfig(environment)).toThrow(
          expect.objectContaining({
            code: 'CONFIGURATION_ERROR',
            field: 'AUTH_MODE',
          }),
        );
      }
    },
  );

  it.each([
    'OIDC_CLIENT_ID',
    'OIDC_REQUIRED_TOKEN_USE',
    'OIDC_END_SESSION_ENDPOINT',
    'OIDC_POST_LOGOUT_REDIRECT_URI',
    'AUTH_PREAUTH_SEAL_PREVIOUS_KEY_ID',
  ])('rejects dormant %s values while disabled', (name) => {
    expect(() => loadAuthenticationConfig({ AUTH_MODE: 'disabled', [name]: 'dormant' })).toThrow(
      AuthenticationConfigurationError,
    );
  });

  it('loads a complete exact OIDC configuration without enumerating the client secret', () => {
    const config = loadAuthenticationConfig(oidcEnvironment());
    expect(config.mode).toBe('oidc');
    if (config.mode !== 'oidc') throw new Error('Expected OIDC configuration');
    expect(config).toMatchObject({
      localDemo: false,
      providerKey: 'primary',
      issuer: 'https://identity.example.test/tenant',
      signingAlgorithm: 'RS256',
      sessionIdleTtlSeconds: 86_400,
    });
    expect(config.preAuthenticationSealKeys).toEqual([config.preAuthenticationSealKey]);
    expect(Object.isFrozen(config.preAuthenticationSealKeys)).toBe(true);
    expect(JSON.stringify(config)).not.toContain('client-secret-canary');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    ['AUTH_MODE', 'OIDC'],
    ['AUTH_MODE', ''],
    ['OIDC_SIGNING_ALGORITHM', 'HS256'],
    ['OIDC_TOKEN_ENDPOINT', 'https://identity.example.test/oauth2/token?redirect=evil'],
    ['OIDC_TOKEN_ENDPOINT', 'https://identity.example.test/oauth2/\ttoken'],
    ['OIDC_TOKEN_ENDPOINT', 'https://identity.example.test/oauth2/../token'],
    ['OIDC_TOKEN_ENDPOINT', 'https://identity.example.test:443/oauth2/token'],
    ['OIDC_JWKS_URI', 'https://identity.example.test/jwks#fragment'],
    ['OIDC_REDIRECT_URI', 'https://evil.example.test/api/v1/auth/callback'],
    ['OIDC_REDIRECT_URI', 'https://app.example.test/another/callback'],
    ['AUTH_PUBLIC_ORIGIN', 'https://app.example.test/path'],
    ['OIDC_HTTP_TIMEOUT_MS', '0'],
    ['AUTH_SESSION_IDLE_TTL_SECONDS', '299'],
    ['AUTH_PREAUTH_SEAL_KEY', 'not-a-key'],
  ])('rejects invalid %s without reflecting its value', (name, value) => {
    const environment = oidcEnvironment();
    environment[name] = value;
    expect(() => loadAuthenticationConfig(environment)).toThrow(AuthenticationConfigurationError);
    try {
      loadAuthenticationConfig(environment);
    } catch (error) {
      if (value) expect(String(error)).not.toContain(value);
    }
  });

  it('requires a secret only for client_secret_basic and rejects ambiguous secret configuration', () => {
    const missing = oidcEnvironment();
    delete missing.OIDC_CLIENT_SECRET;
    expect(() => loadAuthenticationConfig(missing)).toThrow(AuthenticationConfigurationError);

    const publicClient = oidcEnvironment();
    publicClient.OIDC_TOKEN_AUTH_METHOD = 'none';
    delete publicClient.OIDC_CLIENT_SECRET;
    expect(loadAuthenticationConfig(publicClient)).toMatchObject({
      mode: 'oidc',
      tokenEndpointAuthenticationMethod: 'none',
    });

    publicClient.OIDC_CLIENT_SECRET = 'ambiguous';
    expect(() => loadAuthenticationConfig(publicClient)).toThrow(AuthenticationConfigurationError);
  });

  it('requires an exact ID-token use policy for Cognito while leaving generic providers opt-in', () => {
    const missing = oidcEnvironment();
    missing.OIDC_PROVIDER_KEY = 'cognito';
    expect(() => loadAuthenticationConfig(missing)).toThrow(
      expect.objectContaining({ field: 'OIDC_REQUIRED_TOKEN_USE' }),
    );

    for (const value of ['', 'ID', 'access', ' id']) {
      const invalid = { ...missing, OIDC_REQUIRED_TOKEN_USE: value };
      expect(() => loadAuthenticationConfig(invalid)).toThrow(
        expect.objectContaining({ field: 'OIDC_REQUIRED_TOKEN_USE' }),
      );
    }

    const cognito = cognitoEnvironment();
    expect(loadAuthenticationConfig(cognito)).toMatchObject({
      mode: 'oidc',
      providerKey: 'cognito',
      requiredTokenUse: 'id',
      endSessionEndpoint: 'https://identity.example.test/logout',
      postLogoutRedirectUri: 'https://app.example.test/login',
    });

    const generic = oidcEnvironment();
    expect(loadAuthenticationConfig(generic)).not.toHaveProperty('requiredTokenUse');
    generic.OIDC_REQUIRED_TOKEN_USE = 'id';
    expect(loadAuthenticationConfig(generic)).toMatchObject({ requiredTokenUse: 'id' });
  });

  it('requires a paired exact Cognito logout contract bound to the provider and app origins', () => {
    const missingEndpoint = cognitoEnvironment();
    delete missingEndpoint.OIDC_END_SESSION_ENDPOINT;
    expect(() => loadAuthenticationConfig(missingEndpoint)).toThrow(
      expect.objectContaining({ field: 'OIDC_END_SESSION_ENDPOINT' }),
    );

    const missingRedirect = cognitoEnvironment();
    delete missingRedirect.OIDC_POST_LOGOUT_REDIRECT_URI;
    expect(() => loadAuthenticationConfig(missingRedirect)).toThrow(
      expect.objectContaining({ field: 'OIDC_POST_LOGOUT_REDIRECT_URI' }),
    );

    for (const [field, value] of [
      ['OIDC_END_SESSION_ENDPOINT', 'https://identity.example.test/oauth2/logout'],
      ['OIDC_END_SESSION_ENDPOINT', 'https://other.example.test/logout'],
      ['OIDC_END_SESSION_ENDPOINT', 'https://identity.example.test/logout?client_id=shadow'],
      ['OIDC_POST_LOGOUT_REDIRECT_URI', 'https://app.example.test/account'],
      ['OIDC_POST_LOGOUT_REDIRECT_URI', 'https://other.example.test/login'],
    ] as const) {
      const invalid = cognitoEnvironment();
      invalid[field] = value;
      expect(() => loadAuthenticationConfig(invalid)).toThrow(expect.objectContaining({ field }));
    }

    const genericWithOneValue = oidcEnvironment();
    genericWithOneValue.OIDC_END_SESSION_ENDPOINT = 'https://identity.example.test/logout';
    expect(() => loadAuthenticationConfig(genericWithOneValue)).toThrow(
      expect.objectContaining({ field: 'OIDC_POST_LOGOUT_REDIRECT_URI' }),
    );
    genericWithOneValue.OIDC_POST_LOGOUT_REDIRECT_URI = 'https://app.example.test/login';
    expect(loadAuthenticationConfig(genericWithOneValue)).toMatchObject({
      endSessionEndpoint: 'https://identity.example.test/logout',
      postLogoutRedirectUri: 'https://app.example.test/login',
    });
  });

  it.each([
    ['OIDC_AUTHORIZATION_ENDPOINT', 'https://identity.example.test/authorize'],
    ['OIDC_TOKEN_ENDPOINT', 'https://identity.example.test/token'],
    ['OIDC_TOKEN_ENDPOINT', 'https://other.example.test/oauth2/token'],
    ['OIDC_JWKS_URI', 'https://identity.example.test/.well-known/jwks.json'],
    ['OIDC_AUDIENCE', 'another-public-client'],
    ['OIDC_SIGNING_ALGORITHM', 'ES256'],
    ['OIDC_TOKEN_AUTH_METHOD', 'client_secret_basic'],
  ] as const)('rejects a Cognito public-client contract drift in %s', (field, value) => {
    const environment = cognitoEnvironment();
    environment[field] = value;
    if (field === 'OIDC_TOKEN_AUTH_METHOD') {
      environment.OIDC_CLIENT_SECRET = 'not-a-public-client';
    }
    expect(() => loadAuthenticationConfig(environment)).toThrow(expect.objectContaining({ field }));
  });

  it('accepts HTTP only for exact loopback provider URLs in tests', () => {
    const environment = oidcEnvironment();
    environment.OIDC_AUTHORIZATION_ENDPOINT = 'http://127.0.0.1:4100/authorize';
    environment.OIDC_TOKEN_ENDPOINT = 'http://127.0.0.1:4100/token';
    environment.OIDC_JWKS_URI = 'http://127.0.0.1:4100/jwks';
    expect(loadAuthenticationConfig(environment)).toMatchObject({ mode: 'oidc' });

    environment.AUTH_PUBLIC_ORIGIN = 'http://127.0.0.1:4200';
    environment.OIDC_REDIRECT_URI = 'http://127.0.0.1:4200/api/v1/auth/callback';
    expect(() => loadAuthenticationConfig(environment)).toThrow(AuthenticationConfigurationError);

    environment.NODE_ENV = 'production';
    expect(() => loadAuthenticationConfig(environment)).toThrow(AuthenticationConfigurationError);
  });

  it('accepts the one exact loopback demo composition only behind the explicit guard', () => {
    const environment = oidcEnvironment();
    Object.assign(environment, {
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      LOCAL_DEMO_MODE: 'enabled',
      OIDC_PROVIDER_KEY: 'local_demo',
      OIDC_ISSUER_URL: 'https://127.0.0.1:3400/local-demo',
      OIDC_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1:3400/authorize',
      OIDC_TOKEN_ENDPOINT: 'http://127.0.0.1:3400/token',
      OIDC_JWKS_URI: 'http://127.0.0.1:3400/jwks.json',
      OIDC_CLIENT_ID: 'crypto-lending-local-demo',
      OIDC_AUDIENCE: 'crypto-lending-local-demo',
      OIDC_TOKEN_AUTH_METHOD: 'none',
      AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
      OIDC_REDIRECT_URI: 'http://127.0.0.1:3000/api/v1/auth/callback',
    });
    delete environment.OIDC_CLIENT_SECRET;

    expect(loadAuthenticationConfig(environment)).toMatchObject({
      mode: 'oidc',
      localDemo: true,
      providerKey: 'local_demo',
      publicOrigin: 'http://127.0.0.1:3000',
    });
  });

  it.each([
    ['NODE_ENV', 'production'],
    ['API_HOST', '0.0.0.0'],
    ['AUTH_MODE', 'disabled'],
    ['OIDC_PROVIDER_KEY', 'primary'],
    ['OIDC_ISSUER_URL', 'http://localhost:3400/local-demo'],
    ['OIDC_AUTHORIZATION_ENDPOINT', 'https://127.0.0.1:3400/authorize'],
    ['OIDC_TOKEN_ENDPOINT', 'http://127.0.0.1:3401/token'],
    ['OIDC_JWKS_URI', 'http://127.0.0.1:3400/other.json'],
    ['OIDC_CLIENT_ID', 'another-client'],
    ['OIDC_AUDIENCE', 'another-audience'],
    ['OIDC_TOKEN_AUTH_METHOD', 'client_secret_basic'],
    ['AUTH_PUBLIC_ORIGIN', 'http://localhost:3000'],
    ['OIDC_REDIRECT_URI', 'http://127.0.0.1:3000/api/v1/other'],
  ])('rejects local demo configuration drift in %s', (field, value) => {
    const environment = oidcEnvironment();
    Object.assign(environment, {
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      LOCAL_DEMO_MODE: 'enabled',
      OIDC_PROVIDER_KEY: 'local_demo',
      OIDC_ISSUER_URL: 'https://127.0.0.1:3400/local-demo',
      OIDC_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1:3400/authorize',
      OIDC_TOKEN_ENDPOINT: 'http://127.0.0.1:3400/token',
      OIDC_JWKS_URI: 'http://127.0.0.1:3400/jwks.json',
      OIDC_CLIENT_ID: 'crypto-lending-local-demo',
      OIDC_AUDIENCE: 'crypto-lending-local-demo',
      OIDC_TOKEN_AUTH_METHOD: 'none',
      AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
      OIDC_REDIRECT_URI: 'http://127.0.0.1:3000/api/v1/auth/callback',
    });
    delete environment.OIDC_CLIENT_SECRET;
    environment[field] = value;
    if (field === 'OIDC_TOKEN_AUTH_METHOD') {
      environment.OIDC_CLIENT_SECRET = 'local-demo-must-not-use-a-secret';
    }
    expect(() => loadAuthenticationConfig(environment)).toThrow(AuthenticationConfigurationError);
  });

  it('rejects malformed local demo modes even when authentication is otherwise disabled', () => {
    expect(() =>
      loadAuthenticationConfig({
        NODE_ENV: 'development',
        API_HOST: '127.0.0.1',
        AUTH_MODE: 'disabled',
        LOCAL_DEMO_MODE: 'true',
      }),
    ).toThrow(AuthenticationConfigurationError);
  });

  it('requires distinct key identifiers and material and ordered session TTLs', () => {
    const duplicateKey = oidcEnvironment();
    duplicateKey.AUTH_CSRF_HMAC_KEY = duplicateKey.AUTH_SESSION_HMAC_KEY;
    expect(() => loadAuthenticationConfig(duplicateKey)).toThrow(AuthenticationConfigurationError);

    const badTtls = oidcEnvironment();
    badTtls.AUTH_SESSION_IDLE_TTL_SECONDS = '2592001';
    expect(() => loadAuthenticationConfig(badTtls)).toThrow(AuthenticationConfigurationError);
  });

  it('loads one bounded previous pre-authentication decrypt key behind an exact pair', () => {
    const environment = oidcEnvironment();
    const previousMaterial = Buffer.alloc(32, 9).toString('base64url');
    environment.AUTH_PREAUTH_SEAL_PREVIOUS_KEY_ID = 'seal_previous';
    environment.AUTH_PREAUTH_SEAL_PREVIOUS_KEY = previousMaterial;
    const config = loadAuthenticationConfig(environment);
    if (config.mode !== 'oidc') throw new Error('Expected OIDC configuration');

    expect(config.preAuthenticationSealKeys.map(({ keyId }) => keyId)).toEqual([
      'seal_v1',
      'seal_previous',
    ]);
    expect(config.preAuthenticationSealKey).toBe(config.preAuthenticationSealKeys[0]);
    expect(JSON.stringify(config)).not.toContain(previousMaterial);
  });

  it('rejects partial, duplicate-ID, and duplicate-material pre-authentication key rotation', () => {
    const missingMaterial = oidcEnvironment();
    missingMaterial.AUTH_PREAUTH_SEAL_PREVIOUS_KEY_ID = 'seal_previous';
    expect(() => loadAuthenticationConfig(missingMaterial)).toThrow(
      expect.objectContaining({ field: 'AUTH_PREAUTH_SEAL_PREVIOUS_KEY' }),
    );

    const missingId = oidcEnvironment();
    missingId.AUTH_PREAUTH_SEAL_PREVIOUS_KEY = Buffer.alloc(32, 9).toString('base64url');
    expect(() => loadAuthenticationConfig(missingId)).toThrow(
      expect.objectContaining({ field: 'AUTH_PREAUTH_SEAL_PREVIOUS_KEY_ID' }),
    );

    const duplicateId = oidcEnvironment();
    duplicateId.AUTH_PREAUTH_SEAL_PREVIOUS_KEY_ID = duplicateId.AUTH_PREAUTH_SEAL_KEY_ID;
    duplicateId.AUTH_PREAUTH_SEAL_PREVIOUS_KEY = Buffer.alloc(32, 9).toString('base64url');
    expect(() => loadAuthenticationConfig(duplicateId)).toThrow(
      expect.objectContaining({ field: 'AUTH_KEY_IDS' }),
    );

    const duplicateMaterial = oidcEnvironment();
    duplicateMaterial.AUTH_PREAUTH_SEAL_PREVIOUS_KEY_ID = 'seal_previous';
    duplicateMaterial.AUTH_PREAUTH_SEAL_PREVIOUS_KEY = duplicateMaterial.AUTH_PREAUTH_SEAL_KEY;
    expect(() => loadAuthenticationConfig(duplicateMaterial)).toThrow(
      expect.objectContaining({ field: 'AUTH_KEY_MATERIAL' }),
    );
  });

  it('loads exact bounded HMAC key rings and selects only their declared active writes', () => {
    const environment = oidcEnvironment();
    const ring = (purpose: string, start: number): string =>
      JSON.stringify({
        activeWriteVersion: 2,
        keys: [
          {
            keyId: `${purpose.replace('-hmac', '')}_v1`,
            purpose,
            version: 1,
            material: Buffer.alloc(32, start).toString('base64url'),
          },
          {
            keyId: `${purpose.replace('-hmac', '')}_v2`,
            purpose,
            version: 2,
            material: Buffer.alloc(32, start + 1).toString('base64url'),
          },
        ],
      });
    delete environment.AUTH_IDENTITY_HMAC_KEY_ID;
    delete environment.AUTH_IDENTITY_HMAC_KEY;
    delete environment.AUTH_SESSION_HMAC_KEY_ID;
    delete environment.AUTH_SESSION_HMAC_KEY;
    delete environment.AUTH_CSRF_HMAC_KEY_ID;
    delete environment.AUTH_CSRF_HMAC_KEY;
    environment.AUTH_IDENTITY_HMAC_KEY_RING_JSON = ring('identity-hmac', 10);
    environment.AUTH_SESSION_HMAC_KEY_RING_JSON = ring('session-hmac', 12);
    environment.AUTH_CSRF_HMAC_KEY_RING_JSON = ring('csrf-hmac', 14);
    const config = loadAuthenticationConfig(environment);
    if (config.mode !== 'oidc') throw new Error('Expected OIDC config');
    expect(config.identityHmacKeys.activeWriteVersion).toBe(2);
    expect(config.identityHmacKey.version).toBe(2);
    expect(config.sessionHmacKeys.keys.map(({ version }) => version)).toEqual([1, 2]);
    expect(config.csrfHmacKey.version).toBe(2);
    expect(JSON.stringify(config)).not.toContain(Buffer.alloc(32, 10).toString('base64url'));
  });

  it('permits a read-only successor to be staged before its active-write cutover', () => {
    const environment = oidcEnvironment();
    const staged = (purpose: string, start: number): string =>
      JSON.stringify({
        activeWriteVersion: 1,
        keys: [
          {
            keyId: `${purpose.replace('-hmac', '')}_v1`,
            purpose,
            version: 1,
            material: Buffer.alloc(32, start).toString('base64url'),
          },
          {
            keyId: `${purpose.replace('-hmac', '')}_v2`,
            purpose,
            version: 2,
            material: Buffer.alloc(32, start + 1).toString('base64url'),
          },
        ],
      });
    for (const name of [
      'AUTH_IDENTITY_HMAC_KEY_ID',
      'AUTH_IDENTITY_HMAC_KEY',
      'AUTH_SESSION_HMAC_KEY_ID',
      'AUTH_SESSION_HMAC_KEY',
      'AUTH_CSRF_HMAC_KEY_ID',
      'AUTH_CSRF_HMAC_KEY',
    ]) {
      delete environment[name];
    }
    environment.AUTH_IDENTITY_HMAC_KEY_RING_JSON = staged('identity-hmac', 21);
    environment.AUTH_SESSION_HMAC_KEY_RING_JSON = staged('session-hmac', 23);
    environment.AUTH_CSRF_HMAC_KEY_RING_JSON = staged('csrf-hmac', 25);

    const config = loadAuthenticationConfig(environment);
    if (config.mode !== 'oidc') throw new Error('Expected OIDC config');
    expect(config.identityHmacKeys.keys.map(({ version }) => version)).toEqual([1, 2]);
    expect(config.identityHmacKey.version).toBe(1);
    expect(config.sessionHmacKey.version).toBe(1);
    expect(config.csrfHmacKey.version).toBe(1);
  });

  it('keeps legacy single HMAC keys only as an explicit non-production compatibility path', () => {
    const development = oidcEnvironment();
    development.NODE_ENV = 'development';
    expect(loadAuthenticationConfig(development)).toMatchObject({ mode: 'oidc' });

    const environment = oidcEnvironment();
    environment.NODE_ENV = 'production';
    try {
      loadAuthenticationConfig(environment);
      throw new Error('Expected production legacy HMAC configuration to fail');
    } catch (error) {
      expect(error).toEqual(
        expect.objectContaining({
          code: 'CONFIGURATION_ERROR',
          field: 'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
        }),
      );
      expect(String(error)).not.toContain(environment.AUTH_IDENTITY_HMAC_KEY ?? '');
      expect(JSON.stringify(error)).not.toContain(environment.AUTH_IDENTITY_HMAC_KEY ?? '');
    }
  });

  it('rejects non-canonical, oversized, mixed-mode, and cross-purpose-reused rings generically', () => {
    const environment = oidcEnvironment();
    const material = Buffer.alloc(32, 20).toString('base64url');
    environment.AUTH_IDENTITY_HMAC_KEY_RING_JSON = JSON.stringify({
      activeWriteVersion: 1,
      keys: [{ keyId: 'identity_ring', purpose: 'identity-hmac', version: 1, material }],
    });
    expect(() => loadAuthenticationConfig(environment)).toThrow(
      expect.objectContaining({ field: 'AUTH_IDENTITY_HMAC_KEY_RING_JSON' }),
    );

    delete environment.AUTH_IDENTITY_HMAC_KEY_ID;
    delete environment.AUTH_IDENTITY_HMAC_KEY;
    environment.AUTH_IDENTITY_HMAC_KEY_RING_JSON = `${environment.AUTH_IDENTITY_HMAC_KEY_RING_JSON} `;
    expect(() => loadAuthenticationConfig(environment)).toThrow(AuthenticationConfigurationError);
    expect(() => loadAuthenticationConfig(environment)).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining(material) }),
    );
  });
});
