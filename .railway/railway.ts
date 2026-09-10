import { defineRailway, group, image, postgres, project, redis, service } from 'railway/iac';

/**
 * Railway image sources are immutable digests supplied by the release CI job.
 * Refuse a mutable tag so a Railway configuration review always names the
 * exact bytes that will run.
 */
function releaseImage(name: 'RAILWAY_GATEWAY_IMAGE' | 'RAILWAY_WEB_IMAGE' | 'RAILWAY_API_IMAGE') {
  const value = process.env[name];
  const repository = {
    RAILWAY_API_IMAGE: 'ghcr.io/burstcrypto/crypto-lending-api',
    RAILWAY_GATEWAY_IMAGE: 'ghcr.io/burstcrypto/crypto-lending-gateway',
    RAILWAY_WEB_IMAGE: 'ghcr.io/burstcrypto/crypto-lending-web',
  }[name];
  if (
    !value ||
    !new RegExp(`^${repository.replaceAll('.', '\\.')}@sha256:[a-f0-9]{64}$`, 'u').test(value)
  ) {
    throw new Error(`${name} must be an immutable digest from ${repository}`);
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
  const domain = production ? publicDomain() : undefined;
  const publicOrigin = domain ? `https://${domain}` : ctx.shared.AUTH_PUBLIC_ORIGIN;
  const database = postgres('postgres');
  const cache = redis('redis');

  const api = service('api', {
    source: image(releaseImage('RAILWAY_API_IMAGE')),
    start: 'env -u MIGRATION_DATABASE_URL node dist/main.js',
    preDeploy:
      'node dist/infrastructure/database/railway-database-bootstrap.cli.js && env -u APPLICATION_WORKLOAD -u DATABASE_RUNTIME_HOST -u DATABASE_RUNTIME_PORT -u DATABASE_RUNTIME_NAME -u DATABASE_RUNTIME_USERNAME -u DATABASE_RUNTIME_PASSWORD -u DATABASE_RUNTIME_SSL_MODE -u REDIS_URL node dist/infrastructure/database/migration.cli.js --production up',
    healthcheck: '/api/v1/internal/health/dependencies',
    healthcheckTimeout: 120,
    networking: { serviceDomains: {}, customDomains: {}, tcpProxies: {} },
    replicas: production ? 2 : 1,
    env: {
      // APP_ENV is an application tenancy label, not NODE_ENV. "staging" is
      // the reviewed production-safe label until a signed production tenancy
      // is created in the database and Redis ACLs.
      APP_ENV: 'staging',
      APP_VERSION: ctx.shared.APP_VERSION,
      APPLICATION_WORKLOAD: 'api',
      AUTH_CLIENT_ADDRESS_MODE: 'trusted-single-proxy',
      AUTH_CSRF_HMAC_KEY_RING_JSON: ctx.shared.AUTH_CSRF_HMAC_KEY_RING_JSON,
      AUTH_IDENTITY_HMAC_KEY_RING_JSON: ctx.shared.AUTH_IDENTITY_HMAC_KEY_RING_JSON,
      AUTH_MODE: 'oidc',
      AUTH_PREAUTH_SEAL_KEY: ctx.shared.AUTH_PREAUTH_SEAL_KEY,
      AUTH_PREAUTH_SEAL_KEY_ID: ctx.shared.AUTH_PREAUTH_SEAL_KEY_ID,
      AUTH_PREAUTH_TTL_SECONDS: '600',
      AUTH_PUBLIC_ORIGIN: publicOrigin,
      AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '86400',
      AUTH_SESSION_HMAC_KEY_RING_JSON: ctx.shared.AUTH_SESSION_HMAC_KEY_RING_JSON,
      AUTH_SESSION_IDLE_TTL_SECONDS: '3600',
      AUTH_TRUSTED_PROXY_CIDRS: ctx.shared.AUTH_TRUSTED_PROXY_CIDRS,
      DEPLOYMENT_TARGET: 'railway',
      DATABASE_RUNTIME_HOST: database.env.PGHOST,
      DATABASE_RUNTIME_NAME: database.env.PGDATABASE,
      DATABASE_RUNTIME_PASSWORD: ctx.shared.RAILWAY_API_DATABASE_PASSWORD,
      DATABASE_RUNTIME_PORT: database.env.PGPORT,
      DATABASE_RUNTIME_SSL_MODE: 'disable',
      DATABASE_RUNTIME_USERNAME: 'crypto_api_login_railway',
      MIGRATION_DATABASE_URL: database.env.DATABASE_URL,
      PORT: '3001',
      OIDC_AUDIENCE: ctx.shared.OIDC_AUDIENCE,
      OIDC_AUTHORIZATION_ENDPOINT: ctx.shared.OIDC_AUTHORIZATION_ENDPOINT,
      OIDC_CLIENT_ID: ctx.shared.OIDC_CLIENT_ID,
      OIDC_CLIENT_SECRET: ctx.shared.OIDC_CLIENT_SECRET,
      OIDC_CLOCK_TOLERANCE_SECONDS: '30',
      OIDC_END_SESSION_ENDPOINT: ctx.shared.OIDC_END_SESSION_ENDPOINT,
      OIDC_HTTP_TIMEOUT_MS: '5000',
      OIDC_ISSUER_URL: ctx.shared.OIDC_ISSUER_URL,
      OIDC_JWKS_CACHE_TTL_SECONDS: '300',
      OIDC_JWKS_RESPONSE_MAX_BYTES: '65536',
      OIDC_JWKS_URI: ctx.shared.OIDC_JWKS_URI,
      OIDC_MAX_ID_TOKEN_AGE_SECONDS: '600',
      OIDC_POST_LOGOUT_REDIRECT_URI: domain
        ? `${publicOrigin}/login`
        : ctx.shared.OIDC_POST_LOGOUT_REDIRECT_URI,
      OIDC_PROVIDER_KEY: 'auth0',
      OIDC_REDIRECT_URI: domain
        ? `${publicOrigin}/api/v1/auth/callback`
        : ctx.shared.OIDC_REDIRECT_URI,
      OIDC_SIGNING_ALGORITHM: 'RS256',
      OIDC_TOKEN_AUTH_METHOD: 'client_secret_basic',
      OIDC_TOKEN_ENDPOINT: ctx.shared.OIDC_TOKEN_ENDPOINT,
      OIDC_TOKEN_RESPONSE_MAX_BYTES: '16384',
      REDIS_URL: cache.env.REDIS_URL,
      // Auth0 credentials, key material, and reviewed proxy ranges are sealed
      // shared Railway variables referenced only by the API service. They can
      // therefore be provisioned before this service exists without entering
      // source control or the immutable plan artifact.
    },
  });

  const web = service('web', {
    source: image(releaseImage('RAILWAY_WEB_IMAGE')),
    start: 'node server.js',
    healthcheck: '/api/health',
    healthcheckTimeout: 120,
    networking: { serviceDomains: {}, customDomains: {}, tcpProxies: {} },
    replicas: production ? 2 : 1,
    env: {
      APP_ENV: 'staging',
      APP_VERSION: ctx.shared.APP_VERSION,
      AUTH_PUBLIC_ORIGIN: publicOrigin,
      PORT: '3000',
    },
  });

  const gateway = service('gateway', {
    source: image(releaseImage('RAILWAY_GATEWAY_IMAGE')),
    healthcheck: '/healthz',
    healthcheckTimeout: 30,
    replicas: production ? 2 : 1,
    env: {
      // Railway expands reference expressions inside raw variable values.
      // A JavaScript template literal would stringify the reference object as
      // "[object Object]" and leave the gateway unable to reach either service.
      API_ORIGIN: { value: 'http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3001' },
      ...(domain ? { PUBLIC_DOMAIN: domain } : {}),
      PORT: '8080',
      WEB_ORIGIN: { value: 'http://${{web.RAILWAY_PRIVATE_DOMAIN}}:3000' },
    },
  });

  const worker = service('worker', {
    source: image(releaseImage('RAILWAY_API_IMAGE')),
    start: 'env -u MIGRATION_DATABASE_URL node dist/infrastructure/outbox/outbox-worker.cli.js',
    preDeploy: 'node dist/infrastructure/database/railway-database-bootstrap.cli.js',
    healthcheck: '/api/v1/internal/health/dependencies',
    healthcheckTimeout: 180,
    networking: { serviceDomains: {}, customDomains: {}, tcpProxies: {} },
    replicas: 1,
    env: {
      APP_ENV: 'staging',
      APP_VERSION: ctx.shared.APP_VERSION,
      APPLICATION_WORKLOAD: 'worker',
      DEPLOYMENT_TARGET: 'railway',
      DATABASE_RUNTIME_HOST: database.env.PGHOST,
      DATABASE_RUNTIME_NAME: database.env.PGDATABASE,
      DATABASE_RUNTIME_PASSWORD: ctx.shared.RAILWAY_WORKER_DATABASE_PASSWORD,
      DATABASE_RUNTIME_PORT: database.env.PGPORT,
      DATABASE_RUNTIME_SSL_MODE: 'disable',
      DATABASE_RUNTIME_USERNAME: 'crypto_worker_login_railway',
      MIGRATION_DATABASE_URL: database.env.DATABASE_URL,
      OUTBOX_POLL_INTERVAL_MS: '1000',
      PORT: '3001',
    },
  });

  return project('crypto-lending', {
    resources: [
      group('Application', [gateway, web, api, worker]),
      group('Data', [database, cache]),
    ],
  });
});
