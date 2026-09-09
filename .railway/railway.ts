import {
  defineRailway,
  group,
  image,
  postgres,
  preserve,
  project,
  redis,
  service,
} from 'railway/iac';

/**
 * Railway image sources are immutable digests supplied by the release CI job.
 * Refuse a mutable tag so a Railway configuration review always names the
 * exact bytes that will run.
 */
function releaseImage(name: 'RAILWAY_GATEWAY_IMAGE' | 'RAILWAY_WEB_IMAGE' | 'RAILWAY_API_IMAGE') {
  const value = process.env[name];
  if (!value || !/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${name} must be a lowercase GHCR image digest`);
  }
  return value;
}

function publicDomain(): string {
  const value = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (
    !value ||
    value.length > 253 ||
    value.endsWith('.') ||
    !value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  ) {
    throw new Error('RAILWAY_PUBLIC_DOMAIN must be a lowercase DNS hostname');
  }
  return value;
}

export default defineRailway((ctx) => {
  const production = ctx.environment === 'production';
  const database = postgres('postgres');
  const cache = redis('redis');

  const api = service('api', {
    source: image(releaseImage('RAILWAY_API_IMAGE')),
    healthcheck: '/api/v1/health',
    healthcheckTimeout: 120,
    replicas: production ? 2 : 1,
    env: {
      // APP_ENV is an application tenancy label, not NODE_ENV. "staging" is
      // the reviewed production-safe label until a signed production tenancy
      // is created in the database and Redis ACLs.
      APP_ENV: 'staging',
      APP_VERSION: ctx.shared.APP_VERSION,
      APPLICATION_WORKLOAD: 'api',
      AUTH_MODE: 'oidc',
      AUTH_PUBLIC_ORIGIN: ctx.shared.AUTH_PUBLIC_ORIGIN,
      DATABASE_RUNTIME_URL: database.env.DATABASE_URL,
      PORT: '3001',
      OIDC_AUDIENCE: preserve(),
      OIDC_AUTHORIZATION_ENDPOINT: preserve(),
      OIDC_CLIENT_ID: preserve(),
      OIDC_CLIENT_SECRET: preserve(),
      OIDC_END_SESSION_ENDPOINT: preserve(),
      OIDC_ISSUER_URL: preserve(),
      OIDC_JWKS_URI: preserve(),
      OIDC_POST_LOGOUT_REDIRECT_URI: preserve(),
      OIDC_PROVIDER_KEY: 'auth0',
      OIDC_REDIRECT_URI: ctx.shared.OIDC_REDIRECT_URI,
      OIDC_SIGNING_ALGORITHM: 'RS256',
      OIDC_TOKEN_AUTH_METHOD: 'client_secret_basic',
      OIDC_TOKEN_ENDPOINT: preserve(),
      REDIS_URL: cache.env.REDIS_URL,
      // Existing signed key-ring values are deliberately retained as sealed
      // Railway variables and never copied into source control.
      AUTH_CSRF_HMAC_KEY_RING_JSON: preserve(),
      AUTH_IDENTITY_HMAC_KEY_RING_JSON: preserve(),
      AUTH_PREAUTH_SEAL_KEY: preserve(),
      AUTH_PREAUTH_SEAL_KEY_ID: preserve(),
      AUTH_SESSION_HMAC_KEY_RING_JSON: preserve(),
    },
  });

  const web = service('web', {
    source: image(releaseImage('RAILWAY_WEB_IMAGE')),
    healthcheck: '/api/health',
    healthcheckTimeout: 120,
    replicas: production ? 2 : 1,
    env: {
      APP_ENV: 'staging',
      APP_VERSION: ctx.shared.APP_VERSION,
      AUTH_PUBLIC_ORIGIN: ctx.shared.AUTH_PUBLIC_ORIGIN,
      PORT: '3000',
    },
  });

  const gateway = service('gateway', {
    source: image(releaseImage('RAILWAY_GATEWAY_IMAGE')),
    ...(production ? { domains: [{ domain: publicDomain(), port: 8080 }] } : {}),
    healthcheck: '/healthz',
    healthcheckTimeout: 30,
    replicas: production ? 2 : 1,
    env: {
      // Railway expands reference expressions inside raw variable values.
      // A JavaScript template literal would stringify the reference object as
      // "[object Object]" and leave the gateway unable to reach either service.
      API_ORIGIN: { value: 'http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3001' },
      PORT: '8080',
      WEB_ORIGIN: { value: 'http://${{web.RAILWAY_PRIVATE_DOMAIN}}:3000' },
    },
  });

  return project('crypto-lending', {
    resources: [group('Application', [gateway, web, api]), group('Data', [database, cache])],
  });
});
