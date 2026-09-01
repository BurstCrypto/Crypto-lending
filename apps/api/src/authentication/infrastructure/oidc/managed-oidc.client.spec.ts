import type { OidcAuthenticationConfig } from '../config/authentication.config';
import { loadAuthenticationConfig } from '../config/authentication.config';
import {
  createPkceS256Challenge,
  generateOpaqueAuthenticationSecret,
  generatePkceVerifier,
} from '../crypto/authentication-crypto';
import {
  ManagedOidcClient,
  OidcClientError,
  PinnedRemoteJwksProvider,
  type OidcFetch,
} from './managed-oidc.client';
import { loadJoseRuntime } from './jose-runtime';

const NOW_SECONDS = 1_800_000_000;
const NOW = new Date(NOW_SECONDS * 1_000);

function configEnvironment(): NodeJS.ProcessEnv {
  const key = (fill: number): string => Buffer.alloc(32, fill).toString('base64url');
  return {
    NODE_ENV: 'test',
    AUTH_MODE: 'oidc',
    OIDC_PROVIDER_KEY: 'primary',
    OIDC_ISSUER_URL: 'https://identity.example.test/tenant',
    OIDC_AUTHORIZATION_ENDPOINT: 'https://identity.example.test/authorize',
    OIDC_TOKEN_ENDPOINT: 'https://identity.example.test/token',
    OIDC_JWKS_URI: 'https://identity.example.test/jwks',
    OIDC_CLIENT_ID: 'crypto-lending-web',
    OIDC_AUDIENCE: 'crypto-lending-web',
    OIDC_SIGNING_ALGORITHM: 'RS256',
    OIDC_TOKEN_AUTH_METHOD: 'client_secret_basic',
    OIDC_CLIENT_SECRET: 'token-client-secret-canary',
    AUTH_PUBLIC_ORIGIN: 'https://app.example.test',
    OIDC_REDIRECT_URI: 'https://app.example.test/api/v1/auth/callback',
    OIDC_HTTP_TIMEOUT_MS: '1000',
    OIDC_TOKEN_RESPONSE_MAX_BYTES: '4096',
    OIDC_JWKS_RESPONSE_MAX_BYTES: '8192',
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

function oidcConfig(): OidcAuthenticationConfig {
  const config = loadAuthenticationConfig(configEnvironment());
  if (config.mode !== 'oidc') throw new Error('Expected OIDC config');
  return config;
}

function cognitoConfig(): OidcAuthenticationConfig {
  const environment = configEnvironment();
  environment.OIDC_PROVIDER_KEY = 'cognito';
  environment.OIDC_AUTHORIZATION_ENDPOINT = 'https://identity.example.test/oauth2/authorize';
  environment.OIDC_TOKEN_ENDPOINT = 'https://identity.example.test/oauth2/token';
  environment.OIDC_JWKS_URI = 'https://identity.example.test/tenant/.well-known/jwks.json';
  environment.OIDC_TOKEN_AUTH_METHOD = 'none';
  delete environment.OIDC_CLIENT_SECRET;
  environment.OIDC_REQUIRED_TOKEN_USE = 'id';
  environment.OIDC_END_SESSION_ENDPOINT = 'https://identity.example.test/logout';
  environment.OIDC_POST_LOGOUT_REDIRECT_URI = 'https://app.example.test/login';
  const config = loadAuthenticationConfig(environment);
  if (config.mode !== 'oidc') throw new Error('Expected OIDC config');
  return config;
}

interface Fixture {
  readonly privateKey: CryptoKey;
  readonly jwks: { readonly keys: readonly Record<string, unknown>[] };
}

async function fixture(kid = 'fixture-key'): Promise<Fixture> {
  const jose = await loadJoseRuntime();
  const pair = await jose.generateKeyPair('RS256', { extractable: true });
  const publicJwk = await jose.exportJWK(pair.publicKey);
  return {
    privateKey: pair.privateKey,
    jwks: { keys: [{ ...publicJwk, alg: 'RS256', kid, use: 'sig', key_ops: ['verify'] }] },
  };
}

async function idToken(
  key: CryptoKey,
  nonce: string,
  overrides: Readonly<Record<string, unknown>> = {},
  header: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const jose = await loadJoseRuntime();
  const claims = {
    iss: 'https://identity.example.test/tenant',
    sub: 'CaseSensitiveSubject',
    aud: 'crypto-lending-web',
    azp: 'crypto-lending-web',
    nonce,
    iat: NOW_SECONDS,
    nbf: NOW_SECONDS - 1,
    exp: NOW_SECONDS + 300,
    ...overrides,
  };
  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key', typ: 'JWT', ...header })
    .sign(key);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWithResponses(
  config: OidcAuthenticationConfig,
  token: string,
  jwks: unknown,
  calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [],
): ManagedOidcClient {
  const fetcher: OidcFetch = (input, init) => {
    const url = input.toString();
    calls.push({ url, ...(init ? { init } : {}) });
    if (url === config.tokenEndpoint) return Promise.resolve(jsonResponse({ id_token: token }));
    if (url === config.jwksUri) return Promise.resolve(jsonResponse(jwks));
    return Promise.reject(new Error('unexpected outbound URL'));
  };
  return new ManagedOidcClient(config, fetcher, undefined, () => NOW);
}

describe('managed OIDC client', () => {
  it('builds an exact Authorization Code + PKCE request without provider discovery', () => {
    const config = oidcConfig();
    const client = new ManagedOidcClient(config, jest.fn() as OidcFetch, {
      load: () => Promise.resolve({ keys: [] }),
    });
    const state = generateOpaqueAuthenticationSecret('oidc-state');
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const verifier = generatePkceVerifier();
    const url = client.createAuthorizationUrl({
      state,
      nonce,
      codeChallenge: createPkceS256Challenge(verifier),
    });

    expect(url.origin + url.pathname).toBe(config.authorizationEndpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: 'openid',
      state,
      nonce,
      code_challenge: createPkceS256Challenge(verifier),
      code_challenge_method: 'S256',
    });
  });

  it('posts a bounded exact token request and verifies a pinned-key ID token', async () => {
    const config = oidcConfig();
    const keys = await fixture();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const token = await idToken(keys.privateKey, nonce);
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const client = clientWithResponses(config, token, keys.jwks, calls);

    await expect(
      client.exchangeAuthorizationCode({
        code: 'one-time-authorization-code',
        codeVerifier: generatePkceVerifier(),
        expectedNonce: nonce,
      }),
    ).resolves.toEqual({
      providerKey: 'primary',
      issuer: config.issuer,
      subject: 'CaseSensitiveSubject',
      issuedAtEpochSeconds: NOW_SECONDS,
      expiresAtEpochSeconds: NOW_SECONDS + 300,
    });

    expect(calls.map((call) => call.url)).toEqual([config.tokenEndpoint, config.jwksUri]);
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init?.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'one-time-authorization-code',
      redirect_uri: config.redirectUri,
      code_verifier: expect.any(String),
    });
    expect(String(calls[0]?.init?.body)).not.toContain('token-client-secret-canary');
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toMatch(/^Basic /u);
    expect(calls[1]?.init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
  });

  it.each([
    ['nonce', { nonce: 'wrong-nonce' }],
    ['issuer', { iss: 'https://attacker.example.test/' }],
    ['audience', { aud: 'different-audience' }],
    ['mixed audience', { aud: ['crypto-lending-web', 123] }],
    ['empty audience', { aud: [] }],
    ['duplicate audience', { aud: ['crypto-lending-web', 'crypto-lending-web'] }],
    ['authorized party', { aud: ['crypto-lending-web', 'other'], azp: 'other' }],
    ['expired', { exp: NOW_SECONDS - 60 }],
    ['not before', { nbf: NOW_SECONDS + 60 }],
    ['future issued-at', { iat: NOW_SECONDS + 60 }],
    ['stale issued-at', { iat: NOW_SECONDS - 700 }],
    ['invalid subject', { sub: 'line\nbreak' }],
  ])('rejects a token with invalid %s claims', async (_name, overrides) => {
    const config = oidcConfig();
    const keys = await fixture();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const token = await idToken(keys.privateKey, nonce, overrides);
    const client = clientWithResponses(config, token, keys.jwks);

    await expect(
      client.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: generatePkceVerifier(),
        expectedNonce: nonce,
      }),
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
  });

  it('accepts optional single-audience azp and nbf claims when absent', async () => {
    const config = oidcConfig();
    const keys = await fixture();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const token = await idToken(keys.privateKey, nonce, { azp: undefined, nbf: undefined });
    const client = clientWithResponses(config, token, keys.jwks);

    await expect(
      client.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: generatePkceVerifier(),
        expectedNonce: nonce,
      }),
    ).resolves.toMatchObject({ subject: 'CaseSensitiveSubject' });
  });

  it('enforces the configured Cognito ID-token use without constraining generic providers', async () => {
    const config = cognitoConfig();
    const keys = await fixture();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const validToken = await idToken(keys.privateKey, nonce, { token_use: 'id' });

    await expect(
      clientWithResponses(config, validToken, keys.jwks).exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: generatePkceVerifier(),
        expectedNonce: nonce,
      }),
    ).resolves.toMatchObject({ providerKey: 'cognito', subject: 'CaseSensitiveSubject' });

    for (const tokenUse of [undefined, 'access', ['id']]) {
      const token = await idToken(keys.privateKey, nonce, { token_use: tokenUse });
      await expect(
        clientWithResponses(config, token, keys.jwks).exchangeAuthorizationCode({
          code: 'authorization-code',
          codeVerifier: generatePkceVerifier(),
          expectedNonce: nonce,
        }),
      ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
    }

    const genericConfig = oidcConfig();
    const genericToken = await idToken(keys.privateKey, nonce, { token_use: 'access' });
    await expect(
      clientWithResponses(genericConfig, genericToken, keys.jwks).exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: generatePkceVerifier(),
        expectedNonce: nonce,
      }),
    ).resolves.toMatchObject({ providerKey: 'primary' });
  });

  it('selects eligible signing keys from a mixed provider JWKS', async () => {
    const config = oidcConfig();
    const keys = await fixture();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const token = await idToken(keys.privateKey, nonce);
    const publicKey = keys.jwks.keys[0] as Record<string, unknown>;
    const mixedJwks = {
      provider_metadata: 'ignored',
      keys: [
        { kty: 'oct', k: 'not-selected', kid: 'symmetric', alg: 'HS256' },
        { ...publicKey, kid: 'other-algorithm', alg: 'PS256' },
        { ...publicKey, alg: undefined },
      ],
    };

    await expect(
      clientWithResponses(config, token, mixedJwks).exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: generatePkceVerifier(),
        expectedNonce: nonce,
      }),
    ).resolves.toMatchObject({ subject: 'CaseSensitiveSubject' });
  });

  it('rejects attacker-controlled key headers without fetching their URL', async () => {
    const config = oidcConfig();
    const keys = await fixture();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const attackerJwks = 'https://attacker.example.test/jwks';
    const token = await idToken(keys.privateKey, nonce, {}, { jku: attackerJwks });
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const client = clientWithResponses(config, token, keys.jwks, calls);

    await expect(
      client.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: generatePkceVerifier(),
        expectedNonce: nonce,
      }),
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' });
    expect(calls.map((call) => call.url)).toEqual([config.tokenEndpoint]);
    expect(JSON.stringify(calls)).not.toContain(attackerJwks);
  });

  it('rejects symmetric/private, duplicate, and wrong-algorithm JWKS entries', async () => {
    const config = oidcConfig();
    const keys = await fixture();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const token = await idToken(keys.privateKey, nonce);
    const publicKey = keys.jwks.keys[0] as Record<string, unknown>;
    for (const invalidJwks of [
      { keys: [{ kty: 'oct', k: 'secret', kid: 'fixture-key', alg: 'RS256' }] },
      { keys: [{ ...publicKey, d: 'private-canary' }] },
      { keys: [publicKey, publicKey] },
      { keys: [{ ...publicKey, alg: 'PS256' }] },
      { keys: [{ ...publicKey, e: 'AQ' }] },
      {
        keys: [
          {
            ...publicKey,
            n: Buffer.concat([Buffer.from([1]), Buffer.alloc(255, 255)]).toString('base64url'),
          },
        ],
      },
    ]) {
      const client = clientWithResponses(config, token, invalidJwks);
      await expect(
        client.exchangeAuthorizationCode({
          code: 'authorization-code',
          codeVerifier: generatePkceVerifier(),
          expectedNonce: nonce,
        }),
      ).rejects.toBeInstanceOf(OidcClientError);
    }
  });

  it('returns an immutable pinned JWKS cache projection', async () => {
    const config = oidcConfig();
    const keys = await fixture();
    const provider = new PinnedRemoteJwksProvider(
      config,
      () => Promise.resolve(jsonResponse(keys.jwks)),
      () => NOW,
    );

    const loaded = await provider.load();
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.keys)).toBe(true);
    expect(Object.isFrozen(loaded.keys[0])).toBe(true);
    expect(Object.isFrozen(loaded.keys[0]?.key_ops)).toBe(true);
  });

  it('bounds token responses and never reflects secret response data', async () => {
    const config = oidcConfig();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const secretCanary = 'raw-provider-secret-canary';
    const fetcher: OidcFetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ id_token: secretCanary.repeat(5_000) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const client = new ManagedOidcClient(config, fetcher, undefined, () => NOW);

    let captured: unknown;
    try {
      await client.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: generatePkceVerifier(),
        expectedNonce: nonce,
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(OidcClientError);
    expect(String(captured)).not.toContain(secretCanary);
  });

  it('bounds pinned JWKS responses and never reflects their content', async () => {
    const config = oidcConfig();
    const keys = await fixture();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const token = await idToken(keys.privateKey, nonce);
    const canary = 'oversized-jwks-canary';
    const fetcher: OidcFetch = (input) => {
      if (input.toString() === config.tokenEndpoint) {
        return Promise.resolve(jsonResponse({ id_token: token }));
      }
      return Promise.resolve(
        jsonResponse({ keys: [{ canary: canary.repeat(config.jwksResponseMaxBytes) }] }),
      );
    };
    const client = new ManagedOidcClient(config, fetcher, undefined, () => NOW);

    let captured: unknown;
    try {
      await client.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: generatePkceVerifier(),
        expectedNonce: nonce,
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({ code: 'OIDC_JWKS_UNAVAILABLE' });
    expect(String(captured)).not.toContain(canary);
  });

  it('cancels rejected token and JWKS response bodies before returning generic errors', async () => {
    const config = oidcConfig();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const verifier = generatePkceVerifier();
    const tokenCancellation = jest.fn();
    const tokenClient = new ManagedOidcClient(
      config,
      () =>
        Promise.resolve(
          new Response(new ReadableStream({ cancel: tokenCancellation }), { status: 503 }),
        ),
      undefined,
      () => NOW,
    );

    await expect(
      tokenClient.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: verifier,
        expectedNonce: nonce,
      }),
    ).rejects.toMatchObject({ code: 'OIDC_TOKEN_SERVICE_UNAVAILABLE' });
    expect(tokenCancellation).toHaveBeenCalledTimes(1);

    const jwksCancellation = jest.fn();
    const provider = new PinnedRemoteJwksProvider(
      config,
      () =>
        Promise.resolve(
          new Response(new ReadableStream({ cancel: jwksCancellation }), { status: 503 }),
        ),
      () => NOW,
    );
    await expect(provider.load()).rejects.toMatchObject({ code: 'OIDC_JWKS_UNAVAILABLE' });
    expect(jwksCancellation).toHaveBeenCalledTimes(1);

    const contentTypeCancellation = jest.fn();
    const malformedClient = new ManagedOidcClient(
      config,
      () =>
        Promise.resolve(
          new Response(new ReadableStream({ cancel: contentTypeCancellation }), {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
        ),
      undefined,
      () => NOW,
    );
    await expect(
      malformedClient.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: verifier,
        expectedNonce: nonce,
      }),
    ).rejects.toMatchObject({ code: 'OIDC_TOKEN_RESPONSE_INVALID' });
    expect(contentTypeCancellation).toHaveBeenCalledTimes(1);
  });

  it('rejects transport failures, redirects, malformed content types, and invalid codes generically', async () => {
    const config = oidcConfig();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const verifier = generatePkceVerifier();
    for (const fetcher of [
      (() => Promise.reject(new Error('client-secret-canary'))) as OidcFetch,
      (() => Promise.resolve(new Response(null, { status: 302 }))) as OidcFetch,
      (() =>
        Promise.resolve(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
        )) as OidcFetch,
      (() =>
        Promise.resolve(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/jsonp' } }),
        )) as OidcFetch,
    ]) {
      const client = new ManagedOidcClient(config, fetcher, undefined, () => NOW);
      await expect(
        client.exchangeAuthorizationCode({
          code: 'authorization-code',
          codeVerifier: verifier,
          expectedNonce: nonce,
        }),
      ).rejects.toBeInstanceOf(OidcClientError);
    }
    const client = new ManagedOidcClient(config, jest.fn() as OidcFetch);
    await expect(
      client.exchangeAuthorizationCode({
        code: 'line\nbreak',
        codeVerifier: verifier,
        expectedNonce: nonce,
      }),
    ).rejects.toMatchObject({ code: 'OIDC_TOKEN_RESPONSE_INVALID' });
  });

  it('distinguishes rejected grants from token and JWKS provider outages', async () => {
    const config = oidcConfig();
    const nonce = generateOpaqueAuthenticationSecret('oidc-nonce');
    const verifier = generatePkceVerifier();
    for (const [status, code] of [
      [400, 'OIDC_TOKEN_EXCHANGE_REJECTED'],
      [429, 'OIDC_TOKEN_SERVICE_UNAVAILABLE'],
      [503, 'OIDC_TOKEN_SERVICE_UNAVAILABLE'],
    ] as const) {
      const client = new ManagedOidcClient(
        config,
        () => Promise.resolve(new Response(null, { status })),
        undefined,
        () => NOW,
      );
      await expect(
        client.exchangeAuthorizationCode({
          code: 'authorization-code',
          codeVerifier: verifier,
          expectedNonce: nonce,
        }),
      ).rejects.toMatchObject({ code });
    }

    const keys = await fixture();
    const token = await idToken(keys.privateKey, nonce);
    const client = new ManagedOidcClient(
      config,
      () => Promise.resolve(jsonResponse({ id_token: token })),
      { load: () => Promise.reject(new OidcClientError('OIDC_JWKS_UNAVAILABLE')) },
      () => NOW,
    );
    await expect(
      client.exchangeAuthorizationCode({
        code: 'authorization-code',
        codeVerifier: verifier,
        expectedNonce: nonce,
      }),
    ).rejects.toMatchObject({ code: 'OIDC_JWKS_UNAVAILABLE' });
  });
});
