import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  assertLocalDockerEndpoint,
  createLocalDemoEnvironments,
  LOCAL_DEMO_API_ORIGIN,
  LOCAL_DEMO_COMPOSE_PROJECT,
  LOCAL_DEMO_DOCKER_CONFIG,
  LOCAL_DEMO_LOCALSTACK_IMAGE,
  LOCAL_DEMO_OWNERSHIP_LABEL,
  LOCAL_DEMO_OWNERSHIP_VALUE,
  LOCAL_DEMO_REQUIRED_DOCKER_IMAGES,
  LOCAL_DEMO_WEB_ORIGIN,
  safeLocalProcessEnvironment,
} from './environment.mjs';
import {
  assertLocalDemoResourceOwnership,
  composeArguments,
  localDemoResourceQueries,
  localStackBuildArguments,
  parseLocalDemoResourceIdentifiers,
  resolveComposeInvocation,
  resourceLabelInspectionArguments,
} from './processes.mjs';
import {
  assertLocalDemoHasNoAmbientEnvironmentFiles,
  findLocalDemoForbiddenEnvironmentFiles,
} from './safety-preflight.mjs';

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
    assert.equal(environments.api.APP_ENV, 'dev-local-demo');
    assert.equal(environments.api.LOCAL_DEMO_MODE, 'enabled');
    assert.equal(environments.api.OIDC_TOKEN_AUTH_METHOD, 'none');
    assert.equal(environments.api.WALLET_REGISTRATION_REGISTRY_ENVIRONMENT, 'TESTNET');
    for (const forbidden of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'EVM_RPC_URL',
      'SOLANA_RPC_URL',
      'WALLETCONNECT_PROJECT_ID',
    ]) {
      assert.equal(environments.api[forbidden], undefined);
    }
    assert.equal(environments.api.AWS_EC2_METADATA_DISABLED, 'true');
    const apiDatabase = new URL(environments.api.DATABASE_RUNTIME_URL);
    const workerDatabase = new URL(environments.worker.DATABASE_RUNTIME_URL);
    const migrationDatabase = new URL(environments.migration.MIGRATION_DATABASE_URL);
    assert.equal(apiDatabase.hostname, '127.0.0.1');
    assert.equal(apiDatabase.port, '55433');
    assert.equal(apiDatabase.username, 'crypto_api_login_a');
    assert.equal(environments.api.AWS_PROFILE, undefined);
    assert.equal(environments.web.DATABASE_RUNTIME_URL, undefined);
    assert.equal(workerDatabase.username, 'crypto_worker_login_a');
    assert.equal(workerDatabase.port, '55433');
    assert.equal(environments.worker.REDIS_PASSWORD, undefined);
    assert.equal(environments.worker.AUTH_SESSION_HMAC_KEY, undefined);
    assert.equal(environments.worker.LOCAL_DEMO_MODE, 'enabled');
    assert.equal(migrationDatabase.hostname, '127.0.0.1');
    assert.equal(migrationDatabase.port, '55433');
    assert.equal(migrationDatabase.username, 'crypto_migration');
    assert.equal(environments.migration.DATABASE_RUNTIME_URL, undefined);
    assert.equal(environments.migration.AWS_ACCESS_KEY_ID, undefined);
    assert.equal(environments.migration.LOCAL_DEMO_MODE, 'enabled');
    assert.equal(environments.web.NEXT_DISABLE_SWC_WASM, '1');
    assert.equal(environments.web.NEXT_TELEMETRY_DISABLED, '1');
    assert.equal(environments.docker.DOCKER_CONTEXT, 'default');
    assert.equal(environments.docker.DOCKER_CONFIG, LOCAL_DEMO_DOCKER_CONFIG);
    assert.equal(environments.docker.COMPOSE_DISABLE_ENV_FILE, '1');
    assert.equal(environments.docker.AWS_PROFILE, undefined);
    assert.equal(environments.identity.DOCKER_CONTEXT, undefined);
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
    assert.equal(
      assertLocalDockerEndpoint('npipe:////./pipe/dockerDesktopLinuxEngine'),
      'npipe:////./pipe/dockerDesktopLinuxEngine',
    );
    assert.equal(
      assertLocalDockerEndpoint('unix:///run/user/1000/docker.sock'),
      'unix:///run/user/1000/docker.sock',
    );
    for (const endpoint of [
      'tcp://127.0.0.1:2375',
      'https://docker.example',
      'ssh://remote-docker-host',
      'unix:///tmp/forwarded-docker.sock',
      'npipe:////./pipe/forwarded-docker',
      '',
      undefined,
    ]) {
      assert.throws(() => assertLocalDockerEndpoint(endpoint));
    }
    assert.equal(LOCAL_DEMO_COMPOSE_PROJECT, 'crypto-lending-local-demo');
    assert.deepEqual(composeArguments('down').slice(-3), ['down', '--volumes', '--remove-orphans']);
    assert.deepEqual(composeArguments('up').slice(2, 4), [
      '--env-file',
      'tools/local-demo/compose.safe.env',
    ]);
    assert.ok(composeArguments('up').includes('never'));
    assert.ok(composeArguments('up').includes('--no-build'));
    const probes = [];
    const compose = resolveComposeInvocation({
      cwd: '.',
      env: {},
      spawnSyncImpl(command, args) {
        probes.push([command, args]);
        return { status: command === 'docker-compose' ? 0 : 1 };
      },
    });
    assert.deepEqual(probes, [
      ['docker', ['compose', 'version']],
      ['docker-compose', ['version']],
    ]);
    assert.deepEqual(compose, { command: 'docker-compose', prefix: [] });
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

  it('refuses ambient env files before any launcher subprocess runs', () => {
    const root = resolve('fixture-root');
    const presentPath = resolve(root, 'apps/web/.env.local');
    const fileExists = (path) => path === presentPath;
    assert.deepEqual(findLocalDemoForbiddenEnvironmentFiles(root, fileExists), [
      'apps/web/.env.local',
    ]);
    assert.throws(
      () => assertLocalDemoHasNoAmbientEnvironmentFiles(root, fileExists),
      /apps\/web\/\.env\.local/u,
    );
    assert.doesNotThrow(() => assertLocalDemoHasNoAmbientEnvironmentFiles(root, () => false));
  });

  it('requires a KAN-253 ownership marker on every Compose project resource', () => {
    const queries = localDemoResourceQueries();
    assert.deepEqual(
      queries.map(({ kind }) => kind),
      ['container', 'volume', 'network'],
    );
    assert.deepEqual(parseLocalDemoResourceIdentifiers('abc123\r\ndemo_volume\n'), [
      'abc123',
      'demo_volume',
    ]);
    assert.deepEqual(resourceLabelInspectionArguments(queries[0], 'abc123'), [
      'container',
      'inspect',
      '--format',
      '{{json .Config.Labels}}',
      'abc123',
    ]);
    const labels = JSON.stringify({
      'com.docker.compose.project': LOCAL_DEMO_COMPOSE_PROJECT,
      [LOCAL_DEMO_OWNERSHIP_LABEL]: LOCAL_DEMO_OWNERSHIP_VALUE,
    });
    assert.doesNotThrow(() => assertLocalDemoResourceOwnership(labels));
    assert.throws(() => assertLocalDemoResourceOwnership('{}'), /not owned by KAN-253/u);
    assert.throws(() => parseLocalDemoResourceIdentifiers('../other-project'));

    const override = readFileSync(
      new URL('./docker-compose.local-demo.yml', import.meta.url),
      'utf8',
    );
    assert.equal(override.match(/com\.crypto-lending\.local-demo\.owner: kan-253/gu)?.length, 6);
    assert.deepEqual(
      JSON.parse(readFileSync(new URL('./docker-config/config.json', import.meta.url), 'utf8')),
      { auths: {}, proxies: {} },
    );
    const localStackDockerfile = readFileSync(
      new URL('../../infra/localstack/Dockerfile', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(localStackDockerfile, /COPY\s+--chmod=/u);
    assert.match(
      localStackDockerfile,
      /RUN chmod 0755 \/etc\/localstack\/init\/ready\.d\/10-create-queues\.sh/u,
    );
  });

  it('runs installed CLIs directly and prevents API dotenv reload in demo mode', () => {
    const launcher = readFileSync(new URL('./start.mjs', import.meta.url), 'utf8');
    const dotenvLoader = readFileSync(
      new URL('../../apps/api/src/infrastructure/config/load-dotenv.ts', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(launcher, /(?:runChecked|spawnOwned)\('npm'/u);
    assert.match(launcher, /require\.resolve\('next\/dist\/bin\/next'\)/u);
    assert.match(launcher, /require\.resolve\('ts-node\/dist\/bin\.js'\)/u);
    assert.match(
      launcher,
      /\[tsNodeCli, 'src\/infrastructure\/outbox\/outbox-worker\.cli\.ts'\]/u,
    );
    assert.match(
      launcher,
      /require\('next\/dist\/build\/swc'\)\.transformSync\('const localDemoCompilerProbe = true;', \{\}\)/u,
    );
    assert.match(dotenvLoader, /process\.env\.LOCAL_DEMO_MODE !== 'enabled'/u);
  });
});
