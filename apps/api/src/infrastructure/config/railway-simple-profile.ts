/**
 * Railway "simple profile" — an opt-in, demo/staging-grade lane that lets the
 * app boot on Railway's native builder without hand-provisioning the ~30
 * authentication variables the strict production contract requires.
 *
 * It NEVER weakens a validator. It only fills variables that are unset (or
 * empty) with well-formed defaults, so every existing fail-closed check in
 * `infrastructure.config.ts` / `authentication.config.ts` still runs and still
 * receives conforming values. When `RAILWAY_SIMPLE_PROFILE` is absent this
 * module is a no-op and the signed BurstCrypto digest pipeline is unchanged.
 *
 * Security note: the fallback key material below is a FIXED, publicly-known demo
 * secret. It is fine for standing an environment up, but it must be replaced
 * with real, independent key material before real users. Setting the real
 * AUTH_* / OIDC_* variables in Railway overrides these defaults automatically.
 */

const FLAG = 'RAILWAY_SIMPLE_PROFILE';

function isEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env[FLAG]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function isUnset(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name];
  return value === undefined || value.trim() === '';
}

function fill(env: NodeJS.ProcessEnv, defaults: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(defaults)) {
    if (isUnset(env, name)) env[name] = value;
  }
}

// A canonical HTTPS origin (origin-only, no trailing slash) that satisfies the
// public-origin validators. Real deployments set AUTH_PUBLIC_ORIGIN (or, via the
// IaC, RAILWAY_PUBLIC_DOMAIN) to their actual gateway domain.
const PLACEHOLDER_PUBLIC_ORIGIN = 'https://app.example.com';
// A syntactically valid placeholder OIDC (Auth0-shaped) tenant. Boot validates
// only URL/shape; reachability is never checked at boot or in the healthcheck.
const PLACEHOLDER_OIDC_ORIGIN = 'https://tenant.example.com';

// Fixed demo key material (base64url, 32 bytes each; independent per purpose).
const DEMO_PREAUTH_SEAL_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const DEMO_IDENTITY_HMAC_RING =
  '{"activeWriteVersion":1,"keys":[{"keyId":"identity_v1","purpose":"identity-hmac","version":1,"material":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI"}]}';
const DEMO_SESSION_HMAC_RING =
  '{"activeWriteVersion":1,"keys":[{"keyId":"session_v1","purpose":"session-hmac","version":1,"material":"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM"}]}';
const DEMO_CSRF_HMAC_RING =
  '{"activeWriteVersion":1,"keys":[{"keyId":"csrf_v1","purpose":"csrf-hmac","version":1,"material":"BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ"}]}';

/**
 * Fill any missing Railway-simple-profile variables in place. Idempotent.
 * Returns true when the profile was active (defaults may have been applied).
 */
export function applyRailwaySimpleProfileDefaults(env: NodeJS.ProcessEnv): boolean {
  if (!isEnabled(env)) return false;

  // Workload/tenancy identity. The IaC normally supplies these per service; the
  // defaults keep a bare `RAILWAY_SIMPLE_PROFILE=1` service booting as the API.
  fill(env, {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    APP_VERSION: 'railway-simple',
    APPLICATION_WORKLOAD: 'api',
    DEPLOYMENT_TARGET: 'railway',
  });

  // Public origin drives the OIDC redirect/callback URIs, so derive them from
  // whatever origin is in effect (real domain if the operator set one).
  const publicOrigin = (env.AUTH_PUBLIC_ORIGIN?.trim() || PLACEHOLDER_PUBLIC_ORIGIN).replace(
    /\/$/u,
    '',
  );

  fill(env, {
    AUTH_PUBLIC_ORIGIN: publicOrigin,
    AUTH_CLIENT_ADDRESS_MODE: 'trusted-single-proxy',
    AUTH_TRUSTED_PROXY_CIDRS: '0.0.0.0/0,::/0',
    AUTH_MODE: 'oidc',
    AUTH_PREAUTH_TTL_SECONDS: '600',
    AUTH_SESSION_IDLE_TTL_SECONDS: '3600',
    AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '86400',
    AUTH_PREAUTH_SEAL_KEY_ID: 'preauth_v1',
    AUTH_PREAUTH_SEAL_KEY: DEMO_PREAUTH_SEAL_KEY,
    AUTH_IDENTITY_HMAC_KEY_RING_JSON: DEMO_IDENTITY_HMAC_RING,
    AUTH_SESSION_HMAC_KEY_RING_JSON: DEMO_SESSION_HMAC_RING,
    AUTH_CSRF_HMAC_KEY_RING_JSON: DEMO_CSRF_HMAC_RING,
    OIDC_PROVIDER_KEY: 'auth0',
    OIDC_ISSUER_URL: `${PLACEHOLDER_OIDC_ORIGIN}/`,
    OIDC_AUTHORIZATION_ENDPOINT: `${PLACEHOLDER_OIDC_ORIGIN}/authorize`,
    OIDC_TOKEN_ENDPOINT: `${PLACEHOLDER_OIDC_ORIGIN}/oauth/token`,
    OIDC_JWKS_URI: `${PLACEHOLDER_OIDC_ORIGIN}/.well-known/jwks.json`,
    OIDC_END_SESSION_ENDPOINT: `${PLACEHOLDER_OIDC_ORIGIN}/v2/logout`,
    OIDC_CLIENT_ID: 'railway-simple',
    OIDC_CLIENT_SECRET: 'railway-simple',
    OIDC_AUDIENCE: 'https://api.example.com',
    OIDC_SIGNING_ALGORITHM: 'RS256',
    OIDC_TOKEN_AUTH_METHOD: 'client_secret_basic',
    OIDC_HTTP_TIMEOUT_MS: '5000',
    OIDC_TOKEN_RESPONSE_MAX_BYTES: '16384',
    OIDC_JWKS_RESPONSE_MAX_BYTES: '65536',
    OIDC_JWKS_CACHE_TTL_SECONDS: '300',
    OIDC_CLOCK_TOLERANCE_SECONDS: '30',
    OIDC_MAX_ID_TOKEN_AGE_SECONDS: '600',
    OIDC_REDIRECT_URI: `${publicOrigin}/api/v1/auth/callback`,
    OIDC_POST_LOGOUT_REDIRECT_URI: `${publicOrigin}/login`,
  });

  return true;
}
