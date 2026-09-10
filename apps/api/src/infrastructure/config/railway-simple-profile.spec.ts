import { loadAuthenticationConfig } from '../../authentication/infrastructure/config/authentication.config';
import { bindExecutableWorkload } from './application-workload';
import { loadInfrastructureConfig } from './infrastructure.config';
import { applyRailwaySimpleProfileDefaults } from './railway-simple-profile';

/**
 * The env the IaC (`.railway/railway.ts`) injects into the API service under the
 * simple profile: Railway's managed Postgres/Redis plus RAILWAY_SIMPLE_PROFILE=1
 * and nothing from the sealed Auth0 contract.
 */
function railwaySimpleApiEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    APP_VERSION: 'railway-simple',
    APPLICATION_WORKLOAD: 'api',
    DEPLOYMENT_TARGET: 'railway',
    RAILWAY_SIMPLE_PROFILE: '1',
    AUTH_PUBLIC_ORIGIN: 'https://app.example.com',
    DATABASE_RUNTIME_HOST: 'postgres.railway.internal',
    DATABASE_RUNTIME_NAME: 'railway',
    DATABASE_RUNTIME_PASSWORD: 'railway-simple',
    DATABASE_RUNTIME_PORT: '5432',
    DATABASE_RUNTIME_SSL_MODE: 'disable',
    DATABASE_RUNTIME_USERNAME: 'crypto_api_login_railway',
    REDIS_URL: 'redis://default:railway-simple@redis.railway.internal:6379',
    PORT: '3001',
  };
}

describe('applyRailwaySimpleProfileDefaults', () => {
  it('is a no-op when the profile flag is absent', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    expect(applyRailwaySimpleProfileDefaults(env)).toBe(false);
    expect(env).toEqual({ NODE_ENV: 'production' });
  });

  it('fills the Auth0/OIDC contract so the fail-closed validators pass', () => {
    const env = railwaySimpleApiEnvironment();
    expect(applyRailwaySimpleProfileDefaults(env)).toBe(true);
    expect(() => bindExecutableWorkload(env, 'api')).not.toThrow();

    // The API runtime start command strips MIGRATION_DATABASE_URL; it is never
    // present at boot, and the infrastructure loader rejects it if it is.
    const runtimeEnv = { ...env };
    delete runtimeEnv.MIGRATION_DATABASE_URL;

    const infrastructure = loadInfrastructureConfig(runtimeEnv);
    expect(infrastructure.database?.sessionRole).toBe('crypto_api_runtime');
    expect(infrastructure.redis?.username).toBe('default');

    const authentication = loadAuthenticationConfig(runtimeEnv);
    expect(authentication.mode).toBe('oidc');
  });

  it('derives the OIDC redirect URIs from a real public origin when provided', () => {
    const env = railwaySimpleApiEnvironment();
    env.AUTH_PUBLIC_ORIGIN = 'https://lending.example.com';
    applyRailwaySimpleProfileDefaults(env);
    expect(env.OIDC_REDIRECT_URI).toBe('https://lending.example.com/api/v1/auth/callback');
    expect(env.OIDC_POST_LOGOUT_REDIRECT_URI).toBe('https://lending.example.com/login');
  });

  it('never overrides an operator-supplied value', () => {
    const env = railwaySimpleApiEnvironment();
    env.OIDC_CLIENT_SECRET = 'real-secret';
    env.OIDC_ISSUER_URL = 'https://real-tenant.auth0.com/';
    applyRailwaySimpleProfileDefaults(env);
    expect(env.OIDC_CLIENT_SECRET).toBe('real-secret');
    expect(env.OIDC_ISSUER_URL).toBe('https://real-tenant.auth0.com/');
  });
});
