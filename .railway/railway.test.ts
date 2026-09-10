import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createRailwayContext, project, type ServiceNode } from 'railway/iac';

import railwayConfiguration from './railway.js';

const IMAGE_ENVIRONMENT = {
  RAILWAY_API_IMAGE: `ghcr.io/burstcrypto/crypto-lending-api@sha256:${'a'.repeat(64)}`,
  RAILWAY_GATEWAY_IMAGE: `ghcr.io/burstcrypto/crypto-lending-gateway@sha256:${'b'.repeat(64)}`,
  RAILWAY_WEB_IMAGE: `ghcr.io/burstcrypto/crypto-lending-web@sha256:${'c'.repeat(64)}`,
} as const;

const MANAGED_ENVIRONMENT_NAMES = [
  ...Object.keys(IMAGE_ENVIRONMENT),
  'RAILWAY_PUBLIC_DOMAIN',
] as const;

const originalEnvironment = Object.fromEntries(
  MANAGED_ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]),
);

beforeEach(() => {
  Object.assign(process.env, IMAGE_ENVIRONMENT);
  process.env.RAILWAY_PUBLIC_DOMAIN = 'app.example.com';
});

afterEach(() => {
  for (const name of MANAGED_ENVIRONMENT_NAMES) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function compile(environment: string) {
  return railwayConfiguration(createRailwayContext({ environment }), project);
}

function serviceResource(configuration: Awaited<ReturnType<typeof compile>>, name: string) {
  const resource = configuration.resources
    .flat()
    .find(
      (candidate): candidate is ServiceNode =>
        candidate.type === 'service' && candidate.name === name,
    );
  assert.ok(resource);
  return resource;
}

describe('Railway production topology', () => {
  it('pins images and defines a runnable private application plus public gateway', async () => {
    const configuration = await compile('production');
    const api = serviceResource(configuration, 'api');
    const web = serviceResource(configuration, 'web');
    const gateway = serviceResource(configuration, 'gateway');
    const worker = serviceResource(configuration, 'worker');

    assert.equal(api.source?.image, IMAGE_ENVIRONMENT.RAILWAY_API_IMAGE);
    assert.equal(web.source?.image, IMAGE_ENVIRONMENT.RAILWAY_WEB_IMAGE);
    assert.equal(gateway.source?.image, IMAGE_ENVIRONMENT.RAILWAY_GATEWAY_IMAGE);
    assert.equal(worker.source?.image, IMAGE_ENVIRONMENT.RAILWAY_API_IMAGE);
    assert.equal(api.deploy?.numReplicas, 2);
    assert.equal(web.deploy?.numReplicas, 2);
    assert.equal(gateway.deploy?.numReplicas, 2);
    assert.equal(worker.deploy?.numReplicas, 1);
    assert.equal(gateway.deploy?.healthcheckPath, '/healthz');
    assert.equal(api.deploy?.startCommand, 'env -u MIGRATION_DATABASE_URL node dist/main.js');
    assert.equal(api.deploy?.healthcheckPath, '/api/v1/internal/health/dependencies');
    assert.match(
      api.deploy?.preDeployCommand?.[0] ?? '',
      /railway-database-bootstrap\.cli\.js && env [^&]+ node dist\/infrastructure\/database\/migration\.cli\.js --production up/u,
    );
    assert.equal(web.deploy?.startCommand, 'node server.js');
    assert.equal(
      worker.deploy?.startCommand,
      'env -u MIGRATION_DATABASE_URL node dist/infrastructure/outbox/outbox-worker.cli.js',
    );
    assert.match(worker.deploy?.preDeployCommand?.[0] ?? '', /railway-database-bootstrap/u);
    assert.doesNotMatch(worker.deploy?.preDeployCommand?.[0] ?? '', /migration\.cli/u);
    assert.equal(worker.deploy?.healthcheckPath, '/api/v1/internal/health/dependencies');
    assert.deepEqual(api.variables?.PORT, { type: 'literal', value: '3001' });
    assert.deepEqual(web.variables?.PORT, { type: 'literal', value: '3000' });
    assert.deepEqual(gateway.variables?.PORT, { type: 'literal', value: '8080' });
    assert.deepEqual(gateway.variables?.API_ORIGIN, {
      type: 'raw',
      value: { value: 'http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3001' },
    });
    assert.deepEqual(gateway.variables?.WEB_ORIGIN, {
      type: 'raw',
      value: { value: 'http://${{web.RAILWAY_PRIVATE_DOMAIN}}:3000' },
    });
    assert.deepEqual(gateway.variables?.PUBLIC_DOMAIN, {
      type: 'literal',
      value: 'app.example.com',
    });
    assert.equal(gateway.networking, undefined);
    for (const privateService of [api, web, worker]) {
      assert.deepEqual(privateService.networking, {
        serviceDomains: {},
      });
    }
    assert.deepEqual(api.variables?.DEPLOYMENT_TARGET, { type: 'literal', value: 'railway' });
    assert.deepEqual(api.variables?.AUTH_PUBLIC_ORIGIN, {
      type: 'literal',
      value: 'https://app.example.com',
    });
    assert.deepEqual(api.variables?.OIDC_REDIRECT_URI, {
      type: 'literal',
      value: 'https://app.example.com/api/v1/auth/callback',
    });
    assert.deepEqual(api.variables?.OIDC_POST_LOGOUT_REDIRECT_URI, {
      type: 'literal',
      value: 'https://app.example.com/login',
    });
    assert.deepEqual(api.variables?.OIDC_CLIENT_SECRET, {
      type: 'sharedReference',
      name: 'OIDC_CLIENT_SECRET',
    });
    assert.deepEqual(api.variables?.AUTH_PREAUTH_SEAL_KEY, {
      type: 'sharedReference',
      name: 'AUTH_PREAUTH_SEAL_KEY',
    });
    assert.deepEqual(api.variables?.OIDC_HTTP_TIMEOUT_MS, {
      type: 'literal',
      value: '5000',
    });
    assert.equal(
      Object.values(api.variables ?? {}).some(
        (value) => typeof value === 'object' && value !== null && value.type === 'preserve',
      ),
      false,
    );
    assert.deepEqual(worker.variables?.APPLICATION_WORKLOAD, {
      type: 'literal',
      value: 'worker',
    });
    assert.deepEqual(api.variables?.DATABASE_RUNTIME_USERNAME, {
      type: 'literal',
      value: 'crypto_api_login_railway',
    });
    assert.deepEqual(worker.variables?.DATABASE_RUNTIME_USERNAME, {
      type: 'literal',
      value: 'crypto_worker_login_railway',
    });
    assert.deepEqual(api.variables?.DATABASE_RUNTIME_PASSWORD, {
      type: 'sharedReference',
      name: 'RAILWAY_API_DATABASE_PASSWORD',
    });
    assert.deepEqual(worker.variables?.DATABASE_RUNTIME_PASSWORD, {
      type: 'sharedReference',
      name: 'RAILWAY_WORKER_DATABASE_PASSWORD',
    });
    assert.equal(api.variables?.DATABASE_RUNTIME_URL, undefined);
    assert.equal(worker.variables?.DATABASE_RUNTIME_URL, undefined);
  });

  it('keeps pull requests plan-only', async () => {
    const workflow = await readFile('.github/workflows/railway-config.yml', 'utf8');
    assert.match(workflow, /command: plan/u);
    assert.match(workflow, /npm run test:railway/u);
    assert.match(workflow, /cli-version: 5\.51\.0/u);
    assert.match(workflow, /if: steps\.readiness\.outputs\.ready == 'true'/u);
    assert.match(workflow, /Live Railway plan unavailable/u);
    assert.doesNotMatch(workflow, /command: apply/u);
    assert.doesNotMatch(workflow, /^\s{2}apply:/mu);
  });

  it('applies only a digest-bound plan after a separate production approval', async () => {
    const workflow = await readFile('.github/workflows/railway-deploy.yml', 'utf8');
    assert.match(workflow, /workflow_dispatch:/u);
    assert.match(workflow, /environment: production-plan/u);
    assert.match(workflow, /environment: production-apply/u);
    assert.match(workflow, /--out railway\.plan/u);
    assert.match(workflow, /sha256sum --check railway\.plan\.sha256/u);
    assert.match(workflow, /verify-railway-deployment-approval\.ts/u);
    assert.match(workflow, /PUBLIC_LAUNCH_AUTHORITY_DECISION_BASE64/u);
    assert.doesNotMatch(workflow, /authority_decision_sha256:/u);
    assert.match(workflow, /config apply --yes --confirm-destructive[\s\S]+--plan railway\.plan/u);
    assert.match(workflow, /Refusing to leave unapproved gateway domain active/u);
    assert.ok(
      workflow.indexOf('Refuse unapproved existing gateway domains') <
        workflow.indexOf('Apply only the reviewed pinned plan'),
    );
    assert.doesNotMatch(workflow, /config apply --yes\s*$/mu);
  });

  it('keeps non-production services single-replica and private', async () => {
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    const configuration = await compile('staging');

    for (const name of ['api', 'web', 'gateway', 'worker']) {
      assert.equal(serviceResource(configuration, name).deploy?.numReplicas, 1);
    }
    assert.equal(serviceResource(configuration, 'gateway').networking, undefined);
  });

  it('rejects mutable images and invalid production domains', async () => {
    process.env.RAILWAY_API_IMAGE = 'ghcr.io/example/api:latest';
    await assert.rejects(compile('production'), /RAILWAY_API_IMAGE/);

    process.env.RAILWAY_API_IMAGE = IMAGE_ENVIRONMENT.RAILWAY_API_IMAGE;
    process.env.RAILWAY_PUBLIC_DOMAIN = 'https://app.example.com';
    await assert.rejects(compile('production'), /RAILWAY_PUBLIC_DOMAIN/);
  });
});
