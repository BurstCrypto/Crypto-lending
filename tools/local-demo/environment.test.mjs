import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertLocalDockerEndpoint,
  createLocalDemoEnvironments,
  LOCAL_DEMO_API_ORIGIN,
  LOCAL_DEMO_COMPOSE_PROJECT,
  LOCAL_DEMO_LOCALSTACK_IMAGE,
  LOCAL_DEMO_REQUIRED_DOCKER_IMAGES,
  LOCAL_DEMO_WEB_ORIGIN,
  safeLocalProcessEnvironment,
} from './environment.mjs';
import { composeArguments, localStackBuildArguments } from './processes.mjs';

function deterministicRandom(length) {
  deterministicRandom.value = (deterministicRandom.value ?? 0) + 1;
  return Buffer.alloc(length, deterministicRandom.value);
}

describe('local demo process configuration', () => {
  it('passes only an explicit operating-system allowlist to child processes', () => {
    const safe = safeLocalProcessEnvironment({
      PATH: 'bin',
      SystemRoot: 'windows',
      AWS_PROFILE: 'forbidden',
      DATABASE_URL: 'forbidden',
      HTTPS_PROXY: 'forbidden',
      VENDOR_API_KEY: 'forbidden',
    });
    assert.deepEqual(safe, { PATH: 'bin', SystemRoot: 'windows' });
  });

  it('builds separated least-privilege environments with distinct ephemeral key material', () => {
    deterministicRandom.value = 0;
    const environments = createLocalDemoEnvironments({
      randomBytes: deterministicRandom,
      sourceEnvironment: { PATH: 'bin', AWS_PROFILE: 'forbidden' },
    });
    assert.equal(environments.web.LOCAL_DEMO_API_ORIGIN, LOCAL_DEMO_API_ORIGIN);
    assert.equal(environments.web.AUTH_PUBLIC_ORIGIN, LOCAL_DEMO_WEB_ORIGIN);
    assert.equal(environments.api.API_HOST, '127.0.0.1');
    assert.equal(environments.api.OIDC_TOKEN_AUTH_METHOD, 'none');
    assert.equal(environments.api.WALLET_REGISTRATION_REGISTRY_ENVIRONMENT, 'TESTNET');
    assert.equal(environments.api.AWS_EC2_METADATA_DISABLED, 'true');
    const apiDatabase = new URL(environments.api.DATABASE_RUNTIME_URL);
    const workerDatabase = new URL(environments.worker.DATABASE_RUNTIME_URL);
    const migrationDatabase = new URL(environments.migration.MIGRATION_DATABASE_URL);
    assert.equal(apiDatabase.hostname, '127.0.0.1');
    assert.equal(apiDatabase.username, 'crypto_api_login_a');
    assert.equal(environments.api.AWS_PROFILE, undefined);
    assert.equal(environments.web.DATABASE_RUNTIME_URL, undefined);
    assert.equal(workerDatabase.username, 'crypto_worker_login_a');
    assert.equal(environments.worker.REDIS_PASSWORD, undefined);
    assert.equal(environments.worker.AUTH_SESSION_HMAC_KEY, undefined);
    assert.equal(migrationDatabase.hostname, '127.0.0.1');
    assert.equal(migrationDatabase.username, 'crypto_migration');
    assert.equal(environments.migration.DATABASE_RUNTIME_URL, undefined);
    assert.equal(environments.migration.AWS_ACCESS_KEY_ID, undefined);
    const apiKeys = [
      environments.api.AUTH_PREAUTH_SEAL_KEY,
      environments.api.AUTH_IDENTITY_HMAC_KEY,
      environments.api.AUTH_SESSION_HMAC_KEY,
      environments.api.AUTH_CSRF_HMAC_KEY,
      environments.api.WALLET_IDENTITY_HMAC_KEY,
      environments.api.WALLET_CHALLENGE_HMAC_KEY,
      environments.api.WALLET_METADATA_SEAL_KEY,
    ];
    assert.equal(new Set(apiKeys).size, apiKeys.length);
    assert.ok(apiKeys.every((value) => /^[A-Za-z0-9_-]{43}$/u.test(value)));
  });

  it('accepts only local Docker transports and a fixed demo-owned compose project', () => {
    assert.equal(
      assertLocalDockerEndpoint('npipe:////./pipe/docker_engine'),
      'npipe:////./pipe/docker_engine',
    );
    assert.equal(
      assertLocalDockerEndpoint('unix:///var/run/docker.sock'),
      'unix:///var/run/docker.sock',
    );
    for (const endpoint of [
      'tcp://127.0.0.1:2375',
      'https://docker.example',
      'ssh://remote-docker-host',
      '',
      undefined,
    ]) {
      assert.throws(() => assertLocalDockerEndpoint(endpoint));
    }
    assert.equal(LOCAL_DEMO_COMPOSE_PROJECT, 'crypto-lending-local-demo');
    assert.deepEqual(composeArguments('down').slice(-3), ['down', '--volumes', '--remove-orphans']);
    assert.ok(composeArguments('up').includes('never'));
    assert.ok(composeArguments('up').includes('--no-build'));
    assert.equal(LOCAL_DEMO_REQUIRED_DOCKER_IMAGES.length, 3);
    assert.deepEqual(localStackBuildArguments(), [
      'build',
      '--pull=false',
      '--network',
      'none',
      '--tag',
      LOCAL_DEMO_LOCALSTACK_IMAGE,
      '--file',
      'infra/localstack/Dockerfile',
      'infra/localstack',
    ]);
  });
});
