/**
 * Local KAN-35 container build/smoke harness. Validation is the default and is
 * filesystem-only. Builds never push and require an explicit acknowledgement
 * because clean builds download exact npm packages and the checksum-pinned RDS
 * CA bundle. Smoke tests use Docker's network-none/read-only sandbox.
 */
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { CONTAINER_POLICY, validateContainerArtifacts } from './validate-container-artifacts.mjs';

function parseOptions(arguments_) {
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith('--')) throw new Error(`Unknown positional argument: ${argument}`);
    const name = argument.slice(2);
    if (name === 'allow-network-downloads') {
      options.set(name, true);
      continue;
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
    options.set(name, value);
    index += 1;
  }
  return options;
}

function command(file, arguments_, options = {}) {
  return execFileSync(file, arguments_, {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function captured(file, arguments_) {
  return command(file, arguments_, { capture: true }).trim();
}

function sourceRevision(options) {
  const revision = options.get('source-revision') ?? captured('git', ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error('Source revision must be a full lowercase 40-character Git commit SHA.');
  }
  return revision;
}

function assertCleanCheckout(revision) {
  const head = captured('git', ['rev-parse', 'HEAD']);
  if (head !== revision) throw new Error('Source revision must equal the checked-out Git commit.');
  const status = captured('git', ['status', '--porcelain', '--untracked-files=all']);
  if (status) throw new Error('Refusing to build an immutable artifact from a dirty checkout.');
}

function imageTags(revision) {
  const suffix = revision.slice(0, 12);
  return {
    api: `crypto-lending-api:kan35-${suffix}`,
    web: `crypto-lending-web:kan35-${suffix}`,
    worker: `crypto-lending-worker:kan35-${suffix}`,
  };
}

function ensureDockerAndBaseImage() {
  captured('docker', ['version', '--format', '{{.Server.Version}}']);
  captured('docker', ['buildx', 'version']);
  try {
    captured('docker', ['image', 'inspect', CONTAINER_POLICY.nodeImage, '--format', '{{.Id}}']);
  } catch {
    throw new Error(
      `Required base image is not cached locally; refusing an implicit pull: ${CONTAINER_POLICY.nodeImage}`,
    );
  }
}

function buildImages(revision, options) {
  if (!options.has('allow-network-downloads')) {
    throw new Error(
      'Build is blocked by default. Re-run with --allow-network-downloads only after authorizing exact npm and official RDS bundle downloads.',
    );
  }
  assertCleanCheckout(revision);
  ensureDockerAndBaseImage();

  const tags = imageTags(revision);
  const builds = [
    ['apps/api/Dockerfile', 'api', tags.api],
    ['apps/api/Dockerfile', 'worker', tags.worker],
    ['apps/web/Dockerfile', 'web', tags.web],
  ];
  for (const [dockerfile, target, tag] of builds) {
    command('docker', [
      'buildx',
      'build',
      '--pull=false',
      '--platform',
      'linux/amd64',
      '--target',
      target,
      '--build-arg',
      `SOURCE_REVISION=${revision}`,
      '--tag',
      tag,
      '--load',
      '--file',
      dockerfile,
      '.',
    ]);
  }
  return tags;
}

function inspectImage(tag) {
  return JSON.parse(captured('docker', ['image', 'inspect', tag]))[0];
}

function assertImageConfiguration(tags, revision) {
  const expectedCommands = {
    api: ['node', 'dist/main.js'],
    web: ['node', 'server.js'],
    worker: ['node', 'dist/infrastructure/outbox/outbox-worker.cli.js'],
  };

  for (const [name, tag] of Object.entries(tags)) {
    const image = inspectImage(tag);
    if (image.Config.User !== CONTAINER_POLICY.runtimeUser) {
      throw new Error(`${name} image must run as ${CONTAINER_POLICY.runtimeUser}.`);
    }
    if (image.Config.Labels?.['org.opencontainers.image.revision'] !== revision) {
      throw new Error(`${name} image revision label does not match the requested source.`);
    }
    if (JSON.stringify(image.Config.Cmd) !== JSON.stringify(expectedCommands[name])) {
      throw new Error(`${name} image command is not the reviewed entrypoint.`);
    }
  }

  const workerHealth = inspectImage(tags.worker).Config.Healthcheck?.Test;
  const expectedWorkerHealth = [
    'CMD',
    'node',
    'dist/infrastructure/outbox/outbox-worker-health.cli.js',
  ];
  if (JSON.stringify(workerHealth) !== JSON.stringify(expectedWorkerHealth)) {
    throw new Error('Worker image health check is not the dependency-aware entrypoint.');
  }
}

function runOneShot(tag, code) {
  command('docker', [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    CONTAINER_POLICY.runtimeUser,
    tag,
    'node',
    '-e',
    code,
  ]);
}

function verifyRuntimeFiles(tags) {
  const backendCheck = [
    "const {createHash}=require('node:crypto');",
    "const {readFileSync}=require('node:fs');",
    "for(const path of ['dist/main.js','dist/infrastructure/database/migration.cli.js','dist/infrastructure/outbox/outbox-worker.cli.js','dist/infrastructure/outbox/outbox-worker-health.cli.js']) readFileSync(path);",
    `const bundle=readFileSync('${CONTAINER_POLICY.rdsBundlePath}');`,
    `if(bundle.length!==${CONTAINER_POLICY.rdsBundleBytes}) process.exit(2);`,
    `if(createHash('sha256').update(bundle).digest('hex')!=='${CONTAINER_POLICY.rdsBundleSha256}') process.exit(3);`,
  ].join('');
  runOneShot(tags.api, backendCheck);
  runOneShot(
    tags.web,
    "const {readFileSync}=require('node:fs');readFileSync('server.js');readFileSync('.next/BUILD_ID');",
  );
}

function serviceArguments(name, tag, environment) {
  const arguments_ = [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,noexec,size=16777216',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '256',
    '--user',
    CONTAINER_POLICY.runtimeUser,
  ];
  for (const [key, value] of Object.entries(environment))
    arguments_.push('--env', `${key}=${value}`);
  arguments_.push(tag);
  return arguments_;
}

async function waitForEndpoint(container, url) {
  const probe =
    'fetch(process.argv[1]).then(r=>{if(!r.ok)process.exit(2);return r.json()}).then(()=>process.exit(0)).catch(()=>process.exit(1))';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      captured('docker', ['exec', container, 'node', '-e', probe, url]);
      return;
    } catch {
      await delay(500);
    }
  }
  command('docker', ['logs', container]);
  throw new Error(`${container} did not become healthy at ${url}.`);
}

function removeContainer(name) {
  try {
    execFileSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  } catch {
    // The --rm container may already be gone. Names are generated by this process.
  }
}

async function smokeServices(tags, revision) {
  const suffix = `${process.pid}-${Date.now()}`;
  const apiContainer = `crypto-lending-kan35-api-${suffix}`;
  const webContainer = `crypto-lending-kan35-web-${suffix}`;
  try {
    captured(
      'docker',
      serviceArguments(apiContainer, tags.api, {
        API_DOCS_ENABLED: 'false',
        AWS_ACCESS_KEY_ID: 'test',
        AWS_EC2_METADATA_DISABLED: 'true',
        AWS_REGION: 'us-east-1',
        AWS_SECRET_ACCESS_KEY: 'test',
        DATABASE_RUNTIME_SSL_MODE: 'verify-full',
        DATABASE_RUNTIME_URL:
          'postgresql://crypto_runtime:container-smoke-only@database.invalid:5432/crypto_lending?sslmode=verify-full',
        NODE_ENV: 'production',
        PORT: '3001',
        REDIS_KEY_PREFIX: 'crypto-lending:container-smoke:v1:',
        REDIS_URL: 'rediss://:container-smoke-only@redis.invalid:6379',
        SQS_DEAD_LETTER_QUEUE_URL:
          'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-jobs-dlq',
        SQS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/000000000000/crypto-lending-jobs',
      }),
    );
    await waitForEndpoint(apiContainer, 'http://127.0.0.1:3001/api/v1/health');

    captured(
      'docker',
      serviceArguments(webContainer, tags.web, {
        APP_ENV: 'local',
        APP_VERSION: revision,
        HOSTNAME: '0.0.0.0',
        NODE_ENV: 'production',
        PORT: '3000',
      }),
    );
    await waitForEndpoint(webContainer, 'http://127.0.0.1:3000/api/health');
  } finally {
    removeContainer(webContainer);
    removeContainer(apiContainer);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const action = options.get('action') ?? 'validate';
  if (!['validate', 'build', 'smoke', 'build-and-smoke'].includes(action)) {
    throw new Error('Action must be validate, build, smoke, or build-and-smoke.');
  }

  const report = validateContainerArtifacts();
  if (!report.ok) throw new Error(report.errors.join('\n'));
  process.stdout.write(
    'Static container policy validation passed with zero cloud/network calls.\n',
  );
  if (action === 'validate') return;

  const revision = sourceRevision(options);
  let tags = imageTags(revision);
  if (action === 'build' || action === 'build-and-smoke') tags = buildImages(revision, options);
  if (action === 'smoke' || action === 'build-and-smoke') {
    ensureDockerAndBaseImage();
    assertImageConfiguration(tags, revision);
    verifyRuntimeFiles(tags);
    await smokeServices(tags, revision);
    process.stdout.write('Network-isolated, read-only container smoke tests passed.\n');
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Container checks failed: ${message}\n`);
  process.exitCode = 1;
});
