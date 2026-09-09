import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createRailwayContext, project, type ServiceNode } from 'railway/iac';

import railwayConfiguration from './railway.js';

const IMAGE_ENVIRONMENT = {
  RAILWAY_API_IMAGE: `ghcr.io/example/api@sha256:${'a'.repeat(64)}`,
  RAILWAY_GATEWAY_IMAGE: `ghcr.io/example/gateway@sha256:${'b'.repeat(64)}`,
  RAILWAY_WEB_IMAGE: `ghcr.io/example/web@sha256:${'c'.repeat(64)}`,
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
  it('pins images, ports, private origins, replicas, and the only public domain', async () => {
    const configuration = await compile('production');
    const api = serviceResource(configuration, 'api');
    const web = serviceResource(configuration, 'web');
    const gateway = serviceResource(configuration, 'gateway');

    assert.equal(api.source?.image, IMAGE_ENVIRONMENT.RAILWAY_API_IMAGE);
    assert.equal(web.source?.image, IMAGE_ENVIRONMENT.RAILWAY_WEB_IMAGE);
    assert.equal(gateway.source?.image, IMAGE_ENVIRONMENT.RAILWAY_GATEWAY_IMAGE);
    assert.equal(api.deploy?.numReplicas, 2);
    assert.equal(web.deploy?.numReplicas, 2);
    assert.equal(gateway.deploy?.numReplicas, 2);
    assert.deepEqual(gateway.networking?.customDomains, {
      'app.example.com': { port: 8080 },
    });
    assert.equal(api.networking, undefined);
    assert.equal(web.networking, undefined);
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
  });

  it('keeps non-production services single-replica and private', async () => {
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    const configuration = await compile('staging');

    for (const name of ['api', 'web', 'gateway']) {
      assert.equal(serviceResource(configuration, name).deploy?.numReplicas, 1);
    }
    assert.deepEqual(serviceResource(configuration, 'gateway').networking, undefined);
  });

  it('rejects mutable images and invalid production domains', async () => {
    process.env.RAILWAY_API_IMAGE = 'ghcr.io/example/api:latest';
    await assert.rejects(compile('production'), /RAILWAY_API_IMAGE/);

    process.env.RAILWAY_API_IMAGE = IMAGE_ENVIRONMENT.RAILWAY_API_IMAGE;
    process.env.RAILWAY_PUBLIC_DOMAIN = 'https://app.example.com';
    await assert.rejects(compile('production'), /RAILWAY_PUBLIC_DOMAIN/);
  });
});
