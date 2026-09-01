import { isIP } from 'node:net';

import { parseOidcProviderKey, type OidcProviderKey } from '../../domain/authentication';
import {
  createAuthenticationKey,
  createSensitiveAuthenticationText,
  type AuthenticationKey,
  type SensitiveAuthenticationText,
} from '../crypto/authentication-crypto';

export type OidcSigningAlgorithm = 'ES256' | 'PS256' | 'RS256';
export type OidcTokenEndpointAuthenticationMethod = 'client_secret_basic' | 'none';
export type OidcRequiredTokenUse = 'id';

export interface DisabledAuthenticationConfig {
  readonly mode: 'disabled';
}

export interface OidcAuthenticationConfig {
  readonly mode: 'oidc';
  readonly localDemo: boolean;
  readonly providerKey: OidcProviderKey;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly clientId: string;
  readonly audience: string;
  readonly requiredTokenUse?: OidcRequiredTokenUse;
  readonly endSessionEndpoint?: string;
  readonly postLogoutRedirectUri?: string;
  readonly signingAlgorithm: OidcSigningAlgorithm;
  readonly tokenEndpointAuthenticationMethod: OidcTokenEndpointAuthenticationMethod;
  readonly clientSecret?: SensitiveAuthenticationText<'oidc-client-secret'>;
  readonly publicOrigin: string;
  readonly redirectUri: string;
  readonly httpTimeoutMs: number;
  readonly tokenResponseMaxBytes: number;
  readonly jwksResponseMaxBytes: number;
  readonly jwksCacheTtlSeconds: number;
  readonly clockToleranceSeconds: number;
  readonly maximumIdTokenAgeSeconds: number;
  readonly preAuthenticationTtlSeconds: number;
  readonly sessionIdleTtlSeconds: number;
  readonly sessionAbsoluteTtlSeconds: number;
  readonly preAuthenticationSealKey: AuthenticationKey<'preauth-seal'>;
  readonly identityHmacKey: AuthenticationKey<'identity-hmac'>;
  readonly sessionHmacKey: AuthenticationKey<'session-hmac'>;
  readonly csrfHmacKey: AuthenticationKey<'csrf-hmac'>;
}

export type AuthenticationConfig = DisabledAuthenticationConfig | OidcAuthenticationConfig;

const OIDC_VARIABLES = [
  'OIDC_PROVIDER_KEY',
  'OIDC_ISSUER_URL',
  'OIDC_AUTHORIZATION_ENDPOINT',
  'OIDC_TOKEN_ENDPOINT',
  'OIDC_JWKS_URI',
  'OIDC_CLIENT_ID',
  'OIDC_AUDIENCE',
  'OIDC_REQUIRED_TOKEN_USE',
  'OIDC_END_SESSION_ENDPOINT',
  'OIDC_POST_LOGOUT_REDIRECT_URI',
  'OIDC_SIGNING_ALGORITHM',
  'OIDC_TOKEN_AUTH_METHOD',
  'OIDC_CLIENT_SECRET',
  'AUTH_PUBLIC_ORIGIN',
  'OIDC_REDIRECT_URI',
  'OIDC_HTTP_TIMEOUT_MS',
  'OIDC_TOKEN_RESPONSE_MAX_BYTES',
  'OIDC_JWKS_RESPONSE_MAX_BYTES',
  'OIDC_JWKS_CACHE_TTL_SECONDS',
  'OIDC_CLOCK_TOLERANCE_SECONDS',
  'OIDC_MAX_ID_TOKEN_AGE_SECONDS',
  'AUTH_PREAUTH_TTL_SECONDS',
  'AUTH_SESSION_IDLE_TTL_SECONDS',
  'AUTH_SESSION_ABSOLUTE_TTL_SECONDS',
  'AUTH_PREAUTH_SEAL_KEY_ID',
  'AUTH_PREAUTH_SEAL_KEY',
  'AUTH_IDENTITY_HMAC_KEY_ID',
  'AUTH_IDENTITY_HMAC_KEY',
  'AUTH_SESSION_HMAC_KEY_ID',
  'AUTH_SESSION_HMAC_KEY',
  'AUTH_CSRF_HMAC_KEY_ID',
  'AUTH_CSRF_HMAC_KEY',
] as const;

export class AuthenticationConfigurationError extends Error {
  readonly code = 'AUTHENTICATION_CONFIGURATION_ERROR' as const;

  constructor(readonly field: string) {
    super(`Invalid authentication configuration: ${field}`);
    this.name = 'AuthenticationConfigurationError';
  }
}

function fail(field: string): never {
  throw new AuthenticationConfigurationError(field);
}

function localDemoEnabled(environment: Readonly<NodeJS.ProcessEnv>): boolean {
  const mode = environment.LOCAL_DEMO_MODE;
  if (mode === undefined || mode === 'disabled') return false;
  if (mode !== 'enabled') return fail('LOCAL_DEMO_MODE');
  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    return fail('NODE_ENV');
  }
  if (environment.API_HOST !== '127.0.0.1') return fail('API_HOST');
  if (environment.AUTH_MODE !== 'oidc') return fail('AUTH_MODE');
  return true;
}

function required(environment: Readonly<NodeJS.ProcessEnv>, name: string): string {
  const value = environment[name];
  if (
    value === undefined ||
    value.length < 1 ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value)
  ) {
    return fail(name);
  }
  return value;
}

function boundedInteger(
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const raw = required(environment, name);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) return fail(name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) return fail(name);
  return value;
}

function exactText(
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  maximumLength: number,
): string {
  const value = required(environment, name);
  if (value.length > maximumLength || !/^[\x21-\x7e]+$/u.test(value)) return fail(name);
  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    (isIP(hostname) === 6 && hostname === '::1')
  );
}

interface ExactUrlOptions {
  readonly originOnly?: boolean;
  readonly allowPath?: boolean;
  readonly allowBareOrigin?: boolean;
  readonly testRuntime: boolean;
}

function exactUrl(value: string, field: string, options: ExactUrlOptions): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail(field);
  }
  const secure = parsed.protocol === 'https:';
  const permittedTestLoopback =
    options.testRuntime && parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname);
  if (
    (!secure && !permittedTestLoopback) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    parsed.search !== '' ||
    (!options.allowPath && parsed.pathname !== '/') ||
    (options.originOnly && parsed.origin !== value) ||
    (!options.originOnly &&
      parsed.href !== value &&
      !(options.allowBareOrigin && parsed.origin === value)) ||
    value.length > 2_048 ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    return fail(field);
  }
  return value;
}

function signingAlgorithm(value: string): OidcSigningAlgorithm {
  if (value !== 'ES256' && value !== 'PS256' && value !== 'RS256') {
    return fail('OIDC_SIGNING_ALGORITHM');
  }
  return value;
}

function tokenAuthenticationMethod(value: string): OidcTokenEndpointAuthenticationMethod {
  if (value !== 'client_secret_basic' && value !== 'none') {
    return fail('OIDC_TOKEN_AUTH_METHOD');
  }
  return value;
}

function requiredTokenUse(
  environment: Readonly<NodeJS.ProcessEnv>,
  providerKey: OidcProviderKey,
): OidcRequiredTokenUse | undefined {
  const value = environment.OIDC_REQUIRED_TOKEN_USE;
  if (value === undefined) {
    if (providerKey === 'cognito') return fail('OIDC_REQUIRED_TOKEN_USE');
    return undefined;
  }
  if (value !== 'id') return fail('OIDC_REQUIRED_TOKEN_USE');
  return value;
}

interface ConfiguredOidcLogout {
  readonly endSessionEndpoint?: string;
  readonly postLogoutRedirectUri?: string;
}

function configuredOidcLogout(
  environment: Readonly<NodeJS.ProcessEnv>,
  providerKey: OidcProviderKey,
  authorizationEndpoint: string,
  publicOrigin: string,
  clientId: string,
  providerTestRuntime: boolean,
  browserTestRuntime: boolean,
): ConfiguredOidcLogout {
  const rawEndpoint = environment.OIDC_END_SESSION_ENDPOINT;
  const rawRedirect = environment.OIDC_POST_LOGOUT_REDIRECT_URI;
  if (rawEndpoint === undefined && rawRedirect === undefined) {
    if (providerKey === 'cognito') return fail('OIDC_END_SESSION_ENDPOINT');
    return Object.freeze({});
  }
  if (rawEndpoint === undefined) return fail('OIDC_END_SESSION_ENDPOINT');
  if (rawRedirect === undefined) return fail('OIDC_POST_LOGOUT_REDIRECT_URI');

  const endSessionEndpoint = exactUrl(rawEndpoint, 'OIDC_END_SESSION_ENDPOINT', {
    allowPath: true,
    testRuntime: providerTestRuntime,
  });
  const parsedEndpoint = new URL(endSessionEndpoint);
  if (
    parsedEndpoint.origin !== new URL(authorizationEndpoint).origin ||
    parsedEndpoint.pathname !== '/logout'
  ) {
    return fail('OIDC_END_SESSION_ENDPOINT');
  }

  const postLogoutRedirectUri = exactUrl(rawRedirect, 'OIDC_POST_LOGOUT_REDIRECT_URI', {
    allowPath: true,
    testRuntime: browserTestRuntime,
  });
  const parsedRedirect = new URL(postLogoutRedirectUri);
  if (parsedRedirect.origin !== publicOrigin || parsedRedirect.pathname !== '/login') {
    return fail('OIDC_POST_LOGOUT_REDIRECT_URI');
  }

  const providerLogoutUrl = new URL(endSessionEndpoint);
  providerLogoutUrl.searchParams.set('client_id', clientId);
  providerLogoutUrl.searchParams.set('logout_uri', postLogoutRedirectUri);
  if (providerLogoutUrl.href.length > 4_096) return fail('OIDC_END_SESSION_ENDPOINT');

  return Object.freeze({ endSessionEndpoint, postLogoutRedirectUri });
}

function authenticationKey<
  Purpose extends 'csrf-hmac' | 'identity-hmac' | 'preauth-seal' | 'session-hmac',
>(
  environment: Readonly<NodeJS.ProcessEnv>,
  purpose: Purpose,
  idName: string,
  keyName: string,
): AuthenticationKey<Purpose> {
  try {
    return createAuthenticationKey(
      purpose,
      required(environment, idName),
      required(environment, keyName),
    );
  } catch {
    return fail(keyName);
  }
}

export function loadAuthenticationConfig(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): AuthenticationConfig {
  const localDemo = localDemoEnabled(environment);
  const configuredMode = environment.AUTH_MODE;
  const mode = configuredMode === undefined ? 'disabled' : configuredMode;
  if (mode !== 'disabled' && mode !== 'oidc') return fail('AUTH_MODE');
  if (mode === 'disabled') {
    const unexpected = OIDC_VARIABLES.find((name) => environment[name] !== undefined);
    if (unexpected) return fail(unexpected);
    return Object.freeze({ mode: 'disabled' });
  }

  const testRuntime = environment.NODE_ENV === 'test';
  const allowProviderLoopbackHttp = testRuntime || localDemo;
  const providerKeyText = required(environment, 'OIDC_PROVIDER_KEY');
  let providerKey: OidcProviderKey;
  try {
    providerKey = parseOidcProviderKey(providerKeyText);
  } catch {
    return fail('OIDC_PROVIDER_KEY');
  }
  const issuer = exactUrl(required(environment, 'OIDC_ISSUER_URL'), 'OIDC_ISSUER_URL', {
    allowPath: true,
    allowBareOrigin: true,
    testRuntime: localDemo,
  });
  const authorizationEndpoint = exactUrl(
    required(environment, 'OIDC_AUTHORIZATION_ENDPOINT'),
    'OIDC_AUTHORIZATION_ENDPOINT',
    { allowPath: true, testRuntime: allowProviderLoopbackHttp },
  );
  const tokenEndpoint = exactUrl(
    required(environment, 'OIDC_TOKEN_ENDPOINT'),
    'OIDC_TOKEN_ENDPOINT',
    { allowPath: true, testRuntime: allowProviderLoopbackHttp },
  );
  const jwksUri = exactUrl(required(environment, 'OIDC_JWKS_URI'), 'OIDC_JWKS_URI', {
    allowPath: true,
    testRuntime: allowProviderLoopbackHttp,
  });
  const publicOrigin = exactUrl(required(environment, 'AUTH_PUBLIC_ORIGIN'), 'AUTH_PUBLIC_ORIGIN', {
    originOnly: true,
    testRuntime: localDemo,
  });
  const redirectUri = exactUrl(required(environment, 'OIDC_REDIRECT_URI'), 'OIDC_REDIRECT_URI', {
    allowPath: true,
    testRuntime: localDemo,
  });
  const parsedRedirect = new URL(redirectUri);
  if (
    parsedRedirect.origin !== publicOrigin ||
    parsedRedirect.pathname !== '/api/v1/auth/callback'
  ) {
    return fail('OIDC_REDIRECT_URI');
  }

  const clientId = exactText(environment, 'OIDC_CLIENT_ID', 256);
  const audience = exactText(environment, 'OIDC_AUDIENCE', 256);
  const configuredRequiredTokenUse = requiredTokenUse(environment, providerKey);
  const configuredLogout = configuredOidcLogout(
    environment,
    providerKey,
    authorizationEndpoint,
    publicOrigin,
    clientId,
    allowProviderLoopbackHttp,
    localDemo,
  );
  const tokenEndpointAuthenticationMethod = tokenAuthenticationMethod(
    required(environment, 'OIDC_TOKEN_AUTH_METHOD'),
  );
  const configuredSigningAlgorithm = signingAlgorithm(
    required(environment, 'OIDC_SIGNING_ALGORITHM'),
  );
  const configuredClientSecret = environment.OIDC_CLIENT_SECRET;
  let clientSecret: SensitiveAuthenticationText<'oidc-client-secret'> | undefined;
  if (tokenEndpointAuthenticationMethod === 'client_secret_basic') {
    try {
      clientSecret = createSensitiveAuthenticationText(
        'oidc-client-secret',
        required(environment, 'OIDC_CLIENT_SECRET'),
      );
    } catch {
      return fail('OIDC_CLIENT_SECRET');
    }
  } else if (configuredClientSecret !== undefined) {
    return fail('OIDC_CLIENT_SECRET');
  }

  if (providerKey === 'cognito') {
    const authorizationUrl = new URL(authorizationEndpoint);
    const tokenUrl = new URL(tokenEndpoint);
    const expectedJwksUri = `${issuer.replace(/\/$/u, '')}/.well-known/jwks.json`;
    if (authorizationUrl.pathname !== '/oauth2/authorize') {
      return fail('OIDC_AUTHORIZATION_ENDPOINT');
    }
    if (tokenUrl.origin !== authorizationUrl.origin || tokenUrl.pathname !== '/oauth2/token') {
      return fail('OIDC_TOKEN_ENDPOINT');
    }
    if (jwksUri !== expectedJwksUri) return fail('OIDC_JWKS_URI');
    if (audience !== clientId) return fail('OIDC_AUDIENCE');
    if (configuredSigningAlgorithm !== 'RS256') return fail('OIDC_SIGNING_ALGORITHM');
    if (tokenEndpointAuthenticationMethod !== 'none') return fail('OIDC_TOKEN_AUTH_METHOD');
  }

  if (localDemo) {
    const expected = {
      providerKey: 'local_demo',
      issuer: 'https://127.0.0.1:3400/local-demo',
      authorizationEndpoint: 'http://127.0.0.1:3400/authorize',
      tokenEndpoint: 'http://127.0.0.1:3400/token',
      jwksUri: 'http://127.0.0.1:3400/jwks.json',
      clientId: 'crypto-lending-local-demo',
      audience: 'crypto-lending-local-demo',
      publicOrigin: 'http://127.0.0.1:3000',
      redirectUri: 'http://127.0.0.1:3000/api/v1/auth/callback',
    } as const;
    const mismatched = Object.entries(expected).find(
      ([name, expectedValue]) =>
        ({
          providerKey,
          issuer,
          authorizationEndpoint,
          tokenEndpoint,
          jwksUri,
          clientId,
          audience,
          publicOrigin,
          redirectUri,
        })[name as keyof typeof expected] !== expectedValue,
    );
    if (mismatched) return fail(mismatched[0]);
    if (tokenEndpointAuthenticationMethod !== 'none') {
      return fail('OIDC_TOKEN_AUTH_METHOD');
    }
  }

  const httpTimeoutMs = boundedInteger(environment, 'OIDC_HTTP_TIMEOUT_MS', 100, 30_000);
  const tokenResponseMaxBytes = boundedInteger(
    environment,
    'OIDC_TOKEN_RESPONSE_MAX_BYTES',
    1_024,
    262_144,
  );
  const jwksResponseMaxBytes = boundedInteger(
    environment,
    'OIDC_JWKS_RESPONSE_MAX_BYTES',
    1_024,
    1_048_576,
  );
  const jwksCacheTtlSeconds = boundedInteger(
    environment,
    'OIDC_JWKS_CACHE_TTL_SECONDS',
    30,
    86_400,
  );
  const clockToleranceSeconds = boundedInteger(environment, 'OIDC_CLOCK_TOLERANCE_SECONDS', 0, 300);
  const maximumIdTokenAgeSeconds = boundedInteger(
    environment,
    'OIDC_MAX_ID_TOKEN_AGE_SECONDS',
    60,
    3_600,
  );
  const preAuthenticationTtlSeconds = boundedInteger(
    environment,
    'AUTH_PREAUTH_TTL_SECONDS',
    60,
    900,
  );
  const sessionIdleTtlSeconds = boundedInteger(
    environment,
    'AUTH_SESSION_IDLE_TTL_SECONDS',
    300,
    604_800,
  );
  const sessionAbsoluteTtlSeconds = boundedInteger(
    environment,
    'AUTH_SESSION_ABSOLUTE_TTL_SECONDS',
    600,
    2_592_000,
  );
  if (sessionIdleTtlSeconds > sessionAbsoluteTtlSeconds) {
    return fail('AUTH_SESSION_TTL_ORDER');
  }

  const rawKeyIds = [
    required(environment, 'AUTH_PREAUTH_SEAL_KEY_ID'),
    required(environment, 'AUTH_IDENTITY_HMAC_KEY_ID'),
    required(environment, 'AUTH_SESSION_HMAC_KEY_ID'),
    required(environment, 'AUTH_CSRF_HMAC_KEY_ID'),
  ];
  const rawKeys = [
    required(environment, 'AUTH_PREAUTH_SEAL_KEY'),
    required(environment, 'AUTH_IDENTITY_HMAC_KEY'),
    required(environment, 'AUTH_SESSION_HMAC_KEY'),
    required(environment, 'AUTH_CSRF_HMAC_KEY'),
  ];
  if (new Set(rawKeyIds).size !== rawKeyIds.length) return fail('AUTH_KEY_IDS');
  if (new Set(rawKeys).size !== rawKeys.length) return fail('AUTH_KEY_MATERIAL');

  return Object.freeze({
    mode: 'oidc',
    localDemo,
    providerKey,
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    clientId,
    audience,
    ...(configuredRequiredTokenUse === undefined
      ? {}
      : { requiredTokenUse: configuredRequiredTokenUse }),
    ...configuredLogout,
    signingAlgorithm: configuredSigningAlgorithm,
    tokenEndpointAuthenticationMethod,
    ...(clientSecret ? { clientSecret } : {}),
    publicOrigin,
    redirectUri,
    httpTimeoutMs,
    tokenResponseMaxBytes,
    jwksResponseMaxBytes,
    jwksCacheTtlSeconds,
    clockToleranceSeconds,
    maximumIdTokenAgeSeconds,
    preAuthenticationTtlSeconds,
    sessionIdleTtlSeconds,
    sessionAbsoluteTtlSeconds,
    preAuthenticationSealKey: authenticationKey(
      environment,
      'preauth-seal',
      'AUTH_PREAUTH_SEAL_KEY_ID',
      'AUTH_PREAUTH_SEAL_KEY',
    ),
    identityHmacKey: authenticationKey(
      environment,
      'identity-hmac',
      'AUTH_IDENTITY_HMAC_KEY_ID',
      'AUTH_IDENTITY_HMAC_KEY',
    ),
    sessionHmacKey: authenticationKey(
      environment,
      'session-hmac',
      'AUTH_SESSION_HMAC_KEY_ID',
      'AUTH_SESSION_HMAC_KEY',
    ),
    csrfHmacKey: authenticationKey(
      environment,
      'csrf-hmac',
      'AUTH_CSRF_HMAC_KEY_ID',
      'AUTH_CSRF_HMAC_KEY',
    ),
  });
}
