import {
  defineRailway,
  github,
  group,
  image,
  postgres,
  project,
  redis,
  service,
} from 'railway/iac';

type ImageEnvName = 'RAILWAY_GATEWAY_IMAGE' | 'RAILWAY_WEB_IMAGE' | 'RAILWAY_API_IMAGE';

/**
 * The "simple profile" is an opt-in lane that builds the services from the
 * connected GitHub repository instead of pulling the immutable CI-signed image
 * digests. It exists so the app can deploy on Railway without the BurstCrypto
 * release pipeline. When RAILWAY_SIMPLE_PROFILE is unset, every strict digest
 * and domain check below behaves exactly as before.
 */
function simpleProfileEnabled(): boolean {
  const value = process.env.RAILWAY_SIMPLE_PROFILE?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/** The GitHub "owner/name" the simple profile builds every service from. */
function simpleSourceRepo(): string {
  const value = process.env.RAILWAY_SOURCE_REPO?.trim();
  if (!value || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(
      'RAILWAY_SOURCE_REPO must be a GitHub "owner/name" repository when RAILWAY_SIMPLE_PROFILE is enabled',
    );
  }
  return value;
}

type RailwayContext = Parameters<Parameters<typeof defineRailway>[0]>[0];

/**
 * Resolve a service's source: an immutable digest in the signed pipeline, or a
 * Dockerfile build from the connected repository under the simple profile.
 */
function serviceSource(
  imageEnvName: ImageEnvName,
  dockerfilePath: string,
  simpleProfile: boolean,
  sourceRepo: string,
) {
  if (simpleProfile) {
    return {
      source: github(sourceRepo),
      build: { builder: 'DOCKERFILE' as const, dockerfilePath },
    };
  }
  return { source: image(releaseImage(imageEnvName)) };
}

/**
 * A sealed shared value in the signed pipeline; a plain (optionally
 * environment-supplied) literal under the simple profile so no shared Railway
 * variables must be pre-provisioned to stand an environment up.
 */
function sealedOrLiteral(
  ctx: RailwayContext,
  name: string,
  simpleDefault: string,
  simpleProfile: boolean,
) {
  if (simpleProfile) return process.env[name]?.trim() || simpleDefault;
  return ctx.shared[name];
}

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
  const simpleProfile = simpleProfileEnabled();
  const sourceRepo = simpleProfile ? simpleSourceRepo() : '';
  // The signed pipeline requires a reviewed production domain. The simple
  // profile treats it as optional (falling back to a placeholder origin) so a
  // service can deploy and pass its healthcheck before a custom domain is
  // attached; set RAILWAY_PUBLIC_DOMAIN to make login work end-to-end.
  const domain =
    production && (!simpleProfile || process.env.RAILWAY_PUBLIC_DOMAIN?.trim())
      ? publicDomain()
      : undefined;
  const publicOrigin = domain
    ? `https://${domain}`
    : simpleProfile
      ? 'https://app.example.com'
      : ctx.shared.AUTH_PUBLIC_ORIGIN;
  const database = postgres('postgres');
  const cache = redis('redis');

  // The full Auth0/OIDC contract, sourced from sealed shared Railway variables.
  // Under the simple profile these are omitted here and supplied in-container by
  // applyRailwaySimpleProfileDefaults(), so no shared variables must be created
  // to stand an environment up.
  const apiAuthEnvironment = simpleProfile
    ? { RAILWAY_SIMPLE_PROFILE: '1' }
    : {
        AUTH_CLIENT_ADDRESS_MODE: 'trusted-single-proxy',
        AUTH_CSRF_HMAC_KEY_RING_JSON: ctx.shared.AUTH_CSRF_HMAC_KEY_RING_JSON,
        AUTH_IDENTITY_HMAC_KEY_RING_JSON: ctx.shared.AUTH_IDENTITY_HMAC_KEY_RING_JSON,
        AUTH_MODE: 'oidc',
        AUTH_PREAUTH_SEAL_KEY: ctx.shared.AUTH_PREAUTH_SEAL_KEY,
        AUTH_PREAUTH_SEAL_KEY_ID: ctx.shared.AUTH_PREAUTH_SEAL_KEY_ID,
        AUTH_PREAUTH_TTL_SECONDS: '600',
        AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '86400',
        AUTH_SESSION_HMAC_KEY_RING_JSON: ctx.shared.AUTH_SESSION_HMAC_KEY_RING_JSON,
        AUTH_SESSION_IDLE_TTL_SECONDS: '3600',
        AUTH_TRUSTED_PROXY_CIDRS: ctx.shared.AUTH_TRUSTED_PROXY_CIDRS,
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
      };

  const api = service('api', {
    ...serviceSource('RAILWAY_API_IMAGE', 'Dockerfile.api', simpleProfile, sourceRepo),
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
      APP_VERSION: sealedOrLiteral(ctx, 'APP_VERSION', 'railway-simple', simpleProfile),
      APPLICATION_WORKLOAD: 'api',
      AUTH_PUBLIC_ORIGIN: publicOrigin,
      DEPLOYMENT_TARGET: 'railway',
      DATABASE_RUNTIME_HOST: database.env.PGHOST,
      DATABASE_RUNTIME_NAME: database.env.PGDATABASE,
      DATABASE_RUNTIME_PASSWORD: sealedOrLiteral(
        ctx,
        'RAILWAY_API_DATABASE_PASSWORD',
        'railway-simple',
        simpleProfile,
      ),
      DATABASE_RUNTIME_PORT: database.env.PGPORT,
      DATABASE_RUNTIME_SSL_MODE: 'disable',
      DATABASE_RUNTIME_USERNAME: 'crypto_api_login_railway',
      MIGRATION_DATABASE_URL: database.env.DATABASE_URL,
      PORT: '3001',
      REDIS_URL: cache.env.REDIS_URL,
      ...apiAuthEnvironment,
      // Auth0 credentials, key material, and reviewed proxy ranges are sealed
      // shared Railway variables referenced only by the API service. They can
      // therefore be provisioned before this service exists without entering
      // source control or the immutable plan artifact.
    },
  });

  const web = service('web', {
    ...serviceSource('RAILWAY_WEB_IMAGE', 'Dockerfile.web', simpleProfile, sourceRepo),
    start: 'node server.js',
    healthcheck: '/api/health',
    healthcheckTimeout: 120,
    networking: { serviceDomains: {}, customDomains: {}, tcpProxies: {} },
    replicas: production ? 2 : 1,
    env: {
      APP_ENV: 'staging',
      APP_VERSION: sealedOrLiteral(ctx, 'APP_VERSION', 'railway-simple', simpleProfile),
      AUTH_PUBLIC_ORIGIN: publicOrigin,
      PORT: '3000',
    },
  });

  const gateway = service('gateway', {
    ...serviceSource(
      'RAILWAY_GATEWAY_IMAGE',
      'deploy/railway/gateway/Dockerfile',
      simpleProfile,
      sourceRepo,
    ),
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
    ...serviceSource('RAILWAY_API_IMAGE', 'Dockerfile.api', simpleProfile, sourceRepo),
    start: 'env -u MIGRATION_DATABASE_URL node dist/infrastructure/outbox/outbox-worker.cli.js',
    preDeploy: 'node dist/infrastructure/database/railway-database-bootstrap.cli.js',
    healthcheck: '/api/v1/internal/health/dependencies',
    healthcheckTimeout: 180,
    networking: { serviceDomains: {}, customDomains: {}, tcpProxies: {} },
    replicas: 1,
    env: {
      APP_ENV: 'staging',
      APP_VERSION: sealedOrLiteral(ctx, 'APP_VERSION', 'railway-simple', simpleProfile),
      APPLICATION_WORKLOAD: 'worker',
      DEPLOYMENT_TARGET: 'railway',
      DATABASE_RUNTIME_HOST: database.env.PGHOST,
      DATABASE_RUNTIME_NAME: database.env.PGDATABASE,
      DATABASE_RUNTIME_PASSWORD: sealedOrLiteral(
        ctx,
        'RAILWAY_WORKER_DATABASE_PASSWORD',
        'railway-simple',
        simpleProfile,
      ),
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
