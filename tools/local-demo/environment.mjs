import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LOCAL_DEMO_COMPOSE_PROJECT = 'crypto-lending-local-demo';
export const LOCAL_DEMO_OWNERSHIP_LABEL = 'com.crypto-lending.local-demo.owner';
export const LOCAL_DEMO_OWNERSHIP_VALUE = 'kan-253';
export const LOCAL_DEMO_DOCKER_CONFIG = fileURLToPath(new URL('./docker-config', import.meta.url));
export const LOCAL_DEMO_API_ORIGIN = 'http://127.0.0.1:3001';
export const LOCAL_DEMO_WEB_ORIGIN = 'http://127.0.0.1:3000';
export const LOCAL_DEMO_LOCALSTACK_IMAGE = 'crypto-lending-local-demo-localstack:kan-253';
export const LOCAL_DEMO_REQUIRED_DOCKER_IMAGES = Object.freeze([
  'postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685',
  'redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2',
  'localstack/localstack:4@sha256:3ebc37595918b8accb852f8048fef2aff047d465167edd655528065b07bc364a',
]);

const SAFE_INHERITED_NAMES = new Set([
  'APPDATA',
  'CI',
  'COLORTERM',
  'COMSPEC',
  'ComSpec',
  'FORCE_COLOR',
  'LOCALAPPDATA',
  'NO_COLOR',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'Path',
  'PROCESSOR_ARCHITECTURE',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'USERPROFILE',
  'WINDIR',
  'windir',
]);

function key(random) {
  return random(32).toString('base64url');
}

export function safeLocalProcessEnvironment(source = process.env) {
  const safe = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && SAFE_INHERITED_NAMES.has(name)) safe[name] = value;
  }
  return safe;
}

function loopbackDatabaseUrl(databaseCredentials) {
  const url = new URL('postgresql://127.0.0.1:55433/crypto_lending');
  url.username = databaseCredentials.username;
  url.password = databaseCredentials.password;
  return url.toString();
}

function infrastructureEnvironment(databaseCredentials, workload) {
  return {
    NODE_ENV: 'development',
    APP_ENV: 'dev-local-demo',
    LOCAL_DEMO_MODE: 'enabled',
    APPLICATION_WORKLOAD: workload,
    DATABASE_RUNTIME_URL: loopbackDatabaseUrl(databaseCredentials),
    DATABASE_RUNTIME_SSL_MODE: 'disable',
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_EC2_METADATA_DISABLED: 'true',
    SQS_ENDPOINT: 'http://127.0.0.1:4566',
    SQS_QUEUE_URL: 'http://127.0.0.1:4566/000000000000/crypto-lending-jobs',
    SQS_DEAD_LETTER_QUEUE_URL: 'http://127.0.0.1:4566/000000000000/crypto-lending-jobs-dlq',
  };
}

export function createLocalDemoEnvironments(options = {}) {
  const random = options.randomBytes ?? randomBytes;
  const inherited = safeLocalProcessEnvironment(options.sourceEnvironment ?? process.env);
  const api = {
    ...inherited,
    ...infrastructureEnvironment(
      { username: 'crypto_api_login_a', password: 'local_api_database_a' },
      'api',
    ),
    PORT: '3001',
    API_HOST: '127.0.0.1',
    LOCAL_DEMO_MODE: 'enabled',
    AUTH_MODE: 'oidc',
    OIDC_PROVIDER_KEY: 'local_demo',
    OIDC_ISSUER_URL: 'https://127.0.0.1:3400/local-demo',
    OIDC_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1:3400/authorize',
    OIDC_TOKEN_ENDPOINT: 'http://127.0.0.1:3400/token',
    OIDC_JWKS_URI: 'http://127.0.0.1:3400/jwks.json',
    OIDC_CLIENT_ID: 'crypto-lending-local-demo',
    OIDC_AUDIENCE: 'crypto-lending-local-demo',
    OIDC_SIGNING_ALGORITHM: 'ES256',
    OIDC_TOKEN_AUTH_METHOD: 'none',
    AUTH_PUBLIC_ORIGIN: LOCAL_DEMO_WEB_ORIGIN,
    OIDC_REDIRECT_URI: `${LOCAL_DEMO_WEB_ORIGIN}/api/v1/auth/callback`,
    OIDC_HTTP_TIMEOUT_MS: '3000',
    OIDC_TOKEN_RESPONSE_MAX_BYTES: '65536',
    OIDC_JWKS_RESPONSE_MAX_BYTES: '131072',
    OIDC_JWKS_CACHE_TTL_SECONDS: '30',
    OIDC_CLOCK_TOLERANCE_SECONDS: '5',
    OIDC_MAX_ID_TOKEN_AGE_SECONDS: '300',
    AUTH_PREAUTH_TTL_SECONDS: '300',
    AUTH_SESSION_IDLE_TTL_SECONDS: '3600',
    AUTH_SESSION_ABSOLUTE_TTL_SECONDS: '28800',
    AUTH_PREAUTH_SEAL_KEY_ID: 'demo_seal_v1',
    AUTH_PREAUTH_SEAL_KEY: key(random),
    AUTH_IDENTITY_HMAC_KEY_ID: 'demo_identity_v1',
    AUTH_IDENTITY_HMAC_KEY: key(random),
    AUTH_SESSION_HMAC_KEY_ID: 'demo_session_v1',
    AUTH_SESSION_HMAC_KEY: key(random),
    AUTH_CSRF_HMAC_KEY_ID: 'demo_csrf_v1',
    AUTH_CSRF_HMAC_KEY: key(random),
    WALLET_REGISTRATION_MODE: 'enabled',
    WALLET_REGISTRATION_REGISTRY_ENVIRONMENT: 'TESTNET',
    WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS: '300',
    WALLET_IDENTITY_HMAC_KEY_VERSION: '1',
    WALLET_IDENTITY_HMAC_KEY: key(random),
    WALLET_CHALLENGE_HMAC_KEY_VERSION: '1',
    WALLET_CHALLENGE_HMAC_KEY: key(random),
    WALLET_METADATA_SEAL_KEY_VERSION: '1',
    WALLET_METADATA_SEAL_KEY: key(random),
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
    REDIS_TLS: 'false',
    REDIS_USERNAME: 'crypto_api_a',
    REDIS_PASSWORD: 'local-api-current',
  };
  const worker = {
    ...inherited,
    ...infrastructureEnvironment(
      { username: 'crypto_worker_login_a', password: 'local_worker_database_a' },
      'worker',
    ),
  };
  const migration = {
    ...inherited,
    NODE_ENV: 'development',
    LOCAL_DEMO_MODE: 'enabled',
    MIGRATION_DATABASE_URL: loopbackDatabaseUrl({
      username: 'crypto_migration',
      password: 'local_migration_only',
    }),
    MIGRATION_DATABASE_SSL_MODE: 'disable',
  };
  const web = {
    ...inherited,
    NODE_ENV: 'development',
    APP_ENV: 'local-demo',
    APP_VERSION: '0.1.0-local-demo',
    LOCAL_DEMO_MODE: 'enabled',
    LOCAL_DEMO_API_ORIGIN,
    AUTH_PUBLIC_ORIGIN: LOCAL_DEMO_WEB_ORIGIN,
    NEXT_DISABLE_SWC_WASM: '1',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const identity = { ...inherited, NODE_ENV: 'development' };
  const docker = {
    ...inherited,
    COMPOSE_DISABLE_ENV_FILE: '1',
    DOCKER_CONFIG: LOCAL_DEMO_DOCKER_CONFIG,
    DOCKER_CONTEXT: 'default',
  };

  return Object.freeze({
    api: Object.freeze(api),
    docker: Object.freeze(docker),
    identity: Object.freeze(identity),
    migration: Object.freeze(migration),
    web: Object.freeze(web),
    worker: Object.freeze(worker),
  });
}

export function assertLocalDockerEndpoint(value) {
  const canonicalNamedPipe =
    value === 'npipe:////./pipe/docker_engine' ||
    value === 'npipe:////./pipe/dockerDesktopLinuxEngine';
  const canonicalUnixSocket =
    typeof value === 'string' &&
    (/^unix:\/\/(?:\/var\/run\/docker\.sock|\/run\/docker\.sock)$/u.test(value) ||
      /^unix:\/\/\/run\/user\/[1-9][0-9]*\/docker\.sock$/u.test(value));
  if (!canonicalNamedPipe && !canonicalUnixSocket) {
    throw new Error('Local demo requires a local Docker engine endpoint');
  }
  return value;
}
