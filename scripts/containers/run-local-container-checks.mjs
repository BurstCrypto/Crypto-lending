/**
 * Local KAN-35/KAN-228 container build and test harness. Validation is the
 * filesystem-only default. Builds never push and require acknowledgement for
 * exact npm/RDS downloads. Smoke is network-none; integration uses only an
 * internal network and isolated resources on existing local Compose services.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { CONTAINER_POLICY, validateContainerArtifacts } from './validate-container-artifacts.mjs';

function parseOptions(arguments_) {
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith('--')) throw new Error(`Unknown positional argument: ${argument}`);
    const name = argument.slice(2);
    if (name === 'allow-network-downloads' || name === 'allow-local-infrastructure') {
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
  if (status) throw new Error('Refusing immutable image checks from a dirty checkout.');
}

export function createGitBuildContext(
  revision,
  parentDirectory,
  repositoryDirectory = new URL('../..', import.meta.url),
) {
  const contextDirectory = join(parentDirectory, 'git-context');
  mkdirSync(contextDirectory, { mode: 0o700 });
  const archive = execFileSync('git', ['archive', '--format=tar', revision], {
    cwd: repositoryDirectory,
    encoding: null,
    maxBuffer: 100 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  execFileSync('tar', ['--extract', '--file', '-', '--directory', contextDirectory], {
    cwd: repositoryDirectory,
    input: archive,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (!existsSync(join(contextDirectory, '.dockerignore'))) {
    throw new Error('Git-derived Docker context is missing the reviewed .dockerignore.');
  }
  return contextDirectory;
}

export function imageTags(revision) {
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

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export function resolveNpmCli(environment = process.env, nodeExecutable = process.execPath) {
  const nodeDirectory = dirname(nodeExecutable);
  const candidates = [
    environment.npm_execpath,
    environment.APPDATA
      ? join(environment.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : undefined,
    join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDirectory, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  const reviewedSuffix = '/node_modules/npm/bin/npm-cli.js';
  for (const candidate of new Set(candidates)) {
    if (!existsSync(candidate)) continue;
    const resolvedCandidate = realpathSync(candidate);
    if (!statSync(resolvedCandidate).isFile()) continue;
    if (!resolvedCandidate.replaceAll('\\', '/').toLowerCase().endsWith(reviewedSuffix)) continue;
    const packageRoot = resolve(dirname(resolvedCandidate), '..');
    const packageJsonPath = join(packageRoot, 'package.json');
    if (!existsSync(packageJsonPath) || !statSync(packageJsonPath).isFile()) continue;
    const metadata = parseJson(readFileSync(packageJsonPath, 'utf8'), 'npm package metadata');
    if (metadata.version === CONTAINER_POLICY.npmVersion) return resolvedCandidate;
  }
  throw new Error('Unable to locate the installed npm JavaScript CLI for local SBOM generation.');
}

function validateBuildMetadata(metadataPath, target, revision) {
  const raw = readFileSync(metadataPath, 'utf8');
  const metadata = parseJson(raw, `${target} BuildKit metadata`);
  const provenance = metadata['buildx.build.provenance'];
  const digest = metadata['containerimage.digest'];
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error(`${target} BuildKit metadata is missing an immutable image digest.`);
  }
  if (metadata['containerimage.descriptor']?.digest !== digest) {
    throw new Error(`${target} BuildKit descriptor does not match the image digest.`);
  }
  if (provenance?.buildType !== 'https://mobyproject.org/buildkit@v1') {
    throw new Error(`${target} image is missing reviewed BuildKit provenance.`);
  }
  const parameters = provenance.invocation?.parameters;
  if (
    parameters?.args?.target !== target ||
    parameters?.args?.['build-arg:SOURCE_REVISION'] !== revision ||
    provenance.invocation?.environment?.platform !== 'linux/amd64'
  ) {
    throw new Error(
      `${target} provenance does not bind the reviewed target, revision, and platform.`,
    );
  }

  const materialDigests = (provenance.materials ?? [])
    .flatMap((material) => Object.values(material.digest ?? {}))
    .sort();
  const expectedMaterialDigests = [
    CONTAINER_POLICY.nodeImage.slice(CONTAINER_POLICY.nodeImage.indexOf('sha256:') + 7),
    CONTAINER_POLICY.npmTarballSha256,
    ...(target === 'web' ? [] : [CONTAINER_POLICY.rdsBundleSha256]),
  ].sort();
  if (JSON.stringify(materialDigests) !== JSON.stringify(expectedMaterialDigests)) {
    throw new Error(`${target} provenance materials do not match the reviewed immutable inputs.`);
  }

  process.stdout.write(
    `Ephemeral ${target} BuildKit provenance validated (image ${digest}, metadata sha256:${sha256(raw)}).\n`,
  );
  return digest;
}

function validateDependencySbom(workspace, expectedPurlFragment) {
  const npmCli = resolveNpmCli();
  const npmVersion = captured(process.execPath, [npmCli, '--version']);
  if (npmVersion !== CONTAINER_POLICY.npmVersion) {
    throw new Error(
      `Local npm CLI must be exactly ${CONTAINER_POLICY.npmVersion}; received ${npmVersion}.`,
    );
  }
  const raw = captured(process.execPath, [
    npmCli,
    'sbom',
    '--package-lock-only',
    '--omit=dev',
    '--workspace',
    workspace,
    '--sbom-format',
    'cyclonedx',
    '--sbom-type',
    'application',
  ]);
  const sbom = parseJson(raw, `${workspace} dependency SBOM`);
  const npmTool = sbom.metadata?.tools?.find(
    (tool) => tool.name === 'cli' && tool.vendor === 'npm',
  );
  if (
    sbom.bomFormat !== 'CycloneDX' ||
    sbom.specVersion !== '1.5' ||
    npmTool?.version !== CONTAINER_POLICY.npmVersion ||
    !sbom.components?.some((component) => component.purl?.includes(expectedPurlFragment)) ||
    !Array.isArray(sbom.dependencies) ||
    sbom.dependencies.length === 0
  ) {
    throw new Error(
      `${workspace} lockfile did not produce the reviewed CycloneDX dependency graph.`,
    );
  }

  // npm intentionally emits a fresh serial number and timestamp. Remove only
  // those volatile fields before hashing the otherwise complete in-memory BOM.
  delete sbom.serialNumber;
  if (sbom.metadata) delete sbom.metadata.timestamp;
  process.stdout.write(
    `Ephemeral ${workspace} production-dependency SBOM validated (${sbom.components.length} components, normalized sha256:${sha256(JSON.stringify(sbom))}).\n`,
  );
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
  const digests = {};
  const builds = [
    ['apps/api/Dockerfile', 'api', tags.api],
    ['apps/api/Dockerfile', 'worker', tags.worker],
    ['apps/web/Dockerfile', 'web', tags.web],
  ];
  const evidenceDirectory = mkdtempSync(join(tmpdir(), 'crypto-lending-kan228-build-'));
  try {
    const contextDirectory = createGitBuildContext(revision, evidenceDirectory);
    for (const [dockerfile, target, tag] of builds) {
      const metadataPath = join(evidenceDirectory, `${target}.provenance.json`);
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
        '--provenance=mode=max',
        '--metadata-file',
        metadataPath,
        '--file',
        join(contextDirectory, dockerfile),
        contextDirectory,
      ]);
      digests[target] = validateBuildMetadata(metadataPath, target, revision);
    }
  } finally {
    rmSync(evidenceDirectory, { force: true, recursive: true });
  }

  validateDependencySbom('@crypto-lending/api', '/api@');
  validateDependencySbom('@crypto-lending/web', '/web@');
  process.stdout.write(
    'Dependency SBOMs cover npm production dependencies only; image/OS SBOM and vulnerability scanning remain separate gates.\n',
  );
  return { digests, tags };
}

function inspectImage(tag) {
  return JSON.parse(captured('docker', ['image', 'inspect', tag]))[0];
}

function suppliedImageDigests(options) {
  return Object.fromEntries(
    ['api', 'worker', 'web'].map((name) => {
      const digest = options.get(`${name}-digest`);
      if (!/^sha256:[a-f0-9]{64}$/u.test(digest ?? '')) {
        throw new Error(
          `Standalone image checks require --${name}-digest sha256:<64 lowercase hex characters>.`,
        );
      }
      return [name, digest];
    }),
  );
}

export function assertImageConfiguration(tags, revision, expectedDigests) {
  const expectedCommands = {
    api: ['node', 'dist/main.js'],
    web: ['node', 'server.js'],
    worker: ['node', 'dist/infrastructure/outbox/outbox-worker.cli.js'],
  };

  for (const [name, tag] of Object.entries(tags)) {
    const image = inspectImage(tag);
    const expectedDigest = expectedDigests[name];
    const repoDigestMatches = image.RepoDigests?.some((value) =>
      value.endsWith(`@${expectedDigest}`),
    );
    if (image.Id !== expectedDigest && !repoDigestMatches) {
      throw new Error(`${name} tag does not resolve to the expected locally built image digest.`);
    }
    if (image.Os !== 'linux' || image.Architecture !== 'amd64') {
      throw new Error(`${name} image must target linux/amd64.`);
    }
    if (image.Config.User !== CONTAINER_POLICY.runtimeUser) {
      throw new Error(`${name} image must run as ${CONTAINER_POLICY.runtimeUser}.`);
    }
    if (image.Config.Labels?.['org.opencontainers.image.revision'] !== revision) {
      throw new Error(`${name} image revision label does not match the requested source.`);
    }
    if (image.Config.Labels?.['org.opencontainers.image.version'] !== revision) {
      throw new Error(`${name} image version label does not match the requested source.`);
    }
    if (JSON.stringify(image.Config.Cmd) !== JSON.stringify(expectedCommands[name])) {
      throw new Error(`${name} image command is not the reviewed entrypoint.`);
    }
    if (JSON.stringify(image.Config.Entrypoint) !== JSON.stringify(['docker-entrypoint.sh'])) {
      throw new Error(`${name} image does not retain the reviewed pinned-base entrypoint.`);
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

export function verifyRuntimeFiles(tags, revision) {
  const backendCheck = [
    "const {createHash}=require('node:crypto');",
    "const {readFileSync,statSync}=require('node:fs');",
    `if(process.version!=='v${CONTAINER_POLICY.nodeVersion}'||process.getuid?.()!==10001) process.exit(1);`,
    "for(const path of ['dist/main.js','dist/infrastructure/database/migration.cli.js','dist/infrastructure/outbox/outbox-worker.cli.js','dist/infrastructure/outbox/outbox-worker-health.cli.js']) readFileSync(path);",
    `if((statSync('/etc/ssl/certs').mode&0o111)!==0o111) process.exit(2);`,
    `const bundle=readFileSync('${CONTAINER_POLICY.rdsBundlePath}');`,
    `if(bundle.length!==${CONTAINER_POLICY.rdsBundleBytes}) process.exit(3);`,
    `if(createHash('sha256').update(bundle).digest('hex')!=='${CONTAINER_POLICY.rdsBundleSha256}') process.exit(4);`,
  ].join('');
  for (const tag of [tags.api, tags.worker]) runOneShot(tag, backendCheck);
  runOneShot(
    tags.web,
    `const {readFileSync}=require('node:fs');if(process.version!=='v${CONTAINER_POLICY.nodeVersion}'||process.getuid?.()!==10001)process.exit(1);readFileSync('server.js');if(readFileSync('.next/BUILD_ID','utf8').trim()!=='${revision}')process.exit(2);`,
  );
}

function serviceArguments(name, tag, environment, options = {}) {
  const arguments_ = [
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--network',
    options.network ?? 'none',
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
  arguments_.push(...(options.extraArguments ?? []));
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

export async function smokeServices(tags, revision) {
  const runId = randomUUID().replaceAll('-', '');
  const apiContainer = `crypto-lending-kan35-api-${runId}`;
  const webContainer = `crypto-lending-kan35-web-${runId}`;
  const ownershipArguments = [
    '--label',
    'com.crypto-lending.test=KAN-228',
    '--label',
    `com.crypto-lending.run=${runId}`,
  ];
  let apiCreated = false;
  let webCreated = false;
  try {
    captured(
      'docker',
      serviceArguments(
        apiContainer,
        tags.api,
        {
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
        },
        { extraArguments: ownershipArguments },
      ),
    );
    apiCreated = true;
    await waitForEndpoint(apiContainer, 'http://127.0.0.1:3001/api/v1/health');

    captured(
      'docker',
      serviceArguments(
        webContainer,
        tags.web,
        {
          APP_ENV: 'local',
          APP_VERSION: revision,
          HOSTNAME: '0.0.0.0',
          NODE_ENV: 'production',
          PORT: '3000',
        },
        { extraArguments: ownershipArguments },
      ),
    );
    webCreated = true;
    await waitForEndpoint(webContainer, 'http://127.0.0.1:3000/api/health');
  } finally {
    if (webCreated) removeOwnedContainer(webContainer, runId);
    if (apiCreated) removeOwnedContainer(apiContainer, runId);
  }
}

function requireHealthyLocalServices() {
  const services = {};
  for (const service of ['postgres', 'redis', 'localstack']) {
    const identifiers = captured('docker', ['compose', 'ps', '--quiet', service])
      .split(/\r?\n/u)
      .filter(Boolean);
    if (identifiers.length !== 1) {
      throw new Error(`Expected exactly one running Docker Compose ${service} container.`);
    }
    const inspection = JSON.parse(captured('docker', ['container', 'inspect', identifiers[0]]))[0];
    if (!inspection.State?.Running || inspection.State?.Health?.Status !== 'healthy') {
      throw new Error(`Docker Compose ${service} must already be running and healthy.`);
    }
    services[service] = identifiers[0];
  }
  return services;
}

function hardenedOneShotArguments(tag, network, environment, processArguments) {
  const arguments_ = [
    'run',
    '--rm',
    '--network',
    network,
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
  for (const [key, value] of Object.entries(environment)) {
    arguments_.push('--env', `${key}=${value}`);
  }
  arguments_.push(tag, ...processArguments);
  return arguments_;
}

async function waitForDependencyReadiness(container) {
  const url = 'http://127.0.0.1:3001/api/v1/health/dependencies';
  const probe = [
    'fetch(process.argv[1])',
    '.then(async r=>({ok:r.ok,body:await r.json()}))',
    ".then(({ok,body})=>{const c=body.checks;if(!ok||body.status!=='ok'||!c||c.postgres?.status!=='up'||c.redis?.status!=='up'||c.sqs?.status!=='up')process.exit(2);process.exit(0)})",
    '.catch(()=>process.exit(1))',
  ].join('');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      captured('docker', ['exec', container, 'node', '-e', probe, url]);
      return;
    } catch {
      await delay(500);
    }
  }
  command('docker', ['logs', container]);
  throw new Error(`${container} did not report all local dependencies ready.`);
}

async function waitForWorkerHealth(container) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = captured('docker', [
      'container',
      'inspect',
      container,
      '--format',
      '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}',
    ]);
    if (state === 'running|healthy') return;
    if (!state.startsWith('running|')) break;
    await delay(500);
  }
  command('docker', ['logs', container]);
  throw new Error(`${container} did not reach Docker health status healthy.`);
}

function localSqs(localstackContainer, arguments_) {
  return captured('docker', [
    'exec',
    localstackContainer,
    'awslocal',
    'sqs',
    ...arguments_,
    '--region',
    'us-east-1',
  ]);
}

function cleanupStep(label, cleanupErrors, callback) {
  try {
    callback();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cleanupErrors.push(`${label}: ${message}`);
  }
}

function removeOwnedContainer(name, runId) {
  let inspection;
  try {
    inspection = JSON.parse(captured('docker', ['container', 'inspect', name]))[0];
  } catch {
    return;
  }
  if (
    inspection.Config?.Labels?.['com.crypto-lending.test'] !== 'KAN-228' ||
    inspection.Config?.Labels?.['com.crypto-lending.run'] !== runId
  ) {
    throw new Error(`Refusing to remove container ${name} without this run's ownership labels.`);
  }
  captured('docker', ['rm', '--force', name]);
}

function removeOwnedNetwork(name, runId) {
  const inspection = JSON.parse(captured('docker', ['network', 'inspect', name]))[0];
  if (
    inspection.Labels?.['com.crypto-lending.test'] !== 'KAN-228' ||
    inspection.Labels?.['com.crypto-lending.run'] !== runId
  ) {
    throw new Error(`Refusing to remove network ${name} without this run's ownership labels.`);
  }
  captured('docker', ['network', 'rm', name]);
}

function assertOwnedQueue(localstackContainer, queueUrl, runId) {
  const response = parseJson(
    localSqs(localstackContainer, ['list-queue-tags', '--queue-url', queueUrl, '--output', 'json']),
    'LocalStack queue tags',
  );
  if (response.Tags?.CryptoLendingTest !== 'KAN-228' || response.Tags?.RunId !== runId) {
    throw new Error(
      "Refusing to use or delete a LocalStack queue without this run's ownership tags.",
    );
  }
}

export async function localInfrastructureIntegration(tags, options) {
  if (!options.has('allow-local-infrastructure')) {
    throw new Error(
      'Local infrastructure integration is blocked by default. Re-run with --allow-local-infrastructure only for the reviewed local Docker Compose services.',
    );
  }

  const services = requireHealthyLocalServices();
  const suffix = randomUUID().replaceAll('-', '');
  const network = `crypto-lending-kan228-${suffix}`;
  const database = `kan228_${suffix}`;
  const sourceQueueName = `kan228-${suffix}-jobs`;
  const deadLetterQueueName = `kan228-${suffix}-jobs-dlq`;
  const apiContainer = `crypto-lending-kan228-api-${suffix}`;
  const workerContainer = `crypto-lending-kan228-worker-${suffix}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(database)) {
    throw new Error('Generated local integration database name is invalid.');
  }

  const connectedServices = [];
  const cleanupErrors = [];
  let apiCreated = false;
  let databaseCreated = false;
  let deadLetterQueueOwned = false;
  let sourceQueueUrl;
  let deadLetterQueueUrl;
  let integrationError;
  let networkCreated = false;
  let sourceQueueOwned = false;
  let workerCreated = false;
  try {
    captured('docker', [
      'network',
      'create',
      '--driver',
      'bridge',
      '--internal',
      '--label',
      'com.crypto-lending.test=KAN-228',
      '--label',
      `com.crypto-lending.run=${suffix}`,
      network,
    ]);
    networkCreated = true;
    for (const [service, alias] of [
      ['postgres', 'kan228-postgres'],
      ['redis', 'kan228-redis'],
      ['localstack', 'kan228-localstack'],
    ]) {
      captured('docker', ['network', 'connect', '--alias', alias, network, services[service]]);
      connectedServices.push(services[service]);
    }

    command('docker', [
      'exec',
      services.postgres,
      'createdb',
      '--username',
      'crypto_lending',
      '--owner',
      'crypto_lending',
      database,
    ]);
    databaseCreated = true;

    deadLetterQueueUrl = localSqs(services.localstack, [
      'create-queue',
      '--queue-name',
      deadLetterQueueName,
      '--attributes',
      JSON.stringify({ MessageRetentionPeriod: '1200' }),
      '--tags',
      `CryptoLendingTest=KAN-228,RunId=${suffix}`,
      '--query',
      'QueueUrl',
      '--output',
      'text',
    ]);
    assertOwnedQueue(services.localstack, deadLetterQueueUrl, suffix);
    deadLetterQueueOwned = true;
    const deadLetterArn = `arn:aws:sqs:us-east-1:000000000000:${deadLetterQueueName}`;
    sourceQueueUrl = localSqs(services.localstack, [
      'create-queue',
      '--queue-name',
      sourceQueueName,
      '--attributes',
      JSON.stringify({
        MessageRetentionPeriod: '1200',
        ReceiveMessageWaitTimeSeconds: '0',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: deadLetterArn,
          maxReceiveCount: '3',
        }),
        VisibilityTimeout: '30',
      }),
      '--tags',
      `CryptoLendingTest=KAN-228,RunId=${suffix}`,
      '--query',
      'QueueUrl',
      '--output',
      'text',
    ]);
    assertOwnedQueue(services.localstack, sourceQueueUrl, suffix);
    sourceQueueOwned = true;

    const databaseUrl = `postgresql://crypto_lending:local_only_password@kan228-postgres:5432/${database}`;
    const migrationEnvironment = {
      MIGRATION_DATABASE_SSL_MODE: 'disable',
      MIGRATION_DATABASE_URL: databaseUrl,
      NODE_ENV: 'test',
    };
    for (const migrationCommand of ['up', 'verify']) {
      command(
        'docker',
        hardenedOneShotArguments(tags.api, network, migrationEnvironment, [
          'node',
          'dist/infrastructure/database/migration.cli.js',
          migrationCommand,
        ]),
      );
    }

    const sourceQueuePath = new URL(sourceQueueUrl).pathname;
    const deadLetterQueuePath = new URL(deadLetterQueueUrl).pathname;
    const runtimeEnvironment = {
      API_DOCS_ENABLED: 'false',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_EC2_METADATA_DISABLED: 'true',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_ACCESS_KEY: 'test',
      DATABASE_RUNTIME_SSL_MODE: 'disable',
      DATABASE_RUNTIME_URL: databaseUrl,
      NODE_ENV: 'test',
      OUTBOX_POLL_INTERVAL_MS: '100',
      PORT: '3001',
      REDIS_KEY_PREFIX: `crypto-lending:kan228:${suffix}:`,
      REDIS_URL: 'redis://kan228-redis:6379',
      SQS_DEAD_LETTER_QUEUE_URL: `http://kan228-localstack:4566${deadLetterQueuePath}`,
      SQS_ENDPOINT: 'http://kan228-localstack:4566',
      SQS_QUEUE_URL: `http://kan228-localstack:4566${sourceQueuePath}`,
      SQS_REQUEST_TIMEOUT_MS: '5000',
      SQS_SDK_MAX_ATTEMPTS: '1',
    };

    captured(
      'docker',
      serviceArguments(apiContainer, tags.api, runtimeEnvironment, {
        extraArguments: [
          '--label',
          'com.crypto-lending.test=KAN-228',
          '--label',
          `com.crypto-lending.run=${suffix}`,
        ],
        network,
      }),
    );
    apiCreated = true;
    await waitForDependencyReadiness(apiContainer);

    captured(
      'docker',
      serviceArguments(workerContainer, tags.worker, runtimeEnvironment, {
        extraArguments: [
          '--label',
          'com.crypto-lending.test=KAN-228',
          '--label',
          `com.crypto-lending.run=${suffix}`,
          '--health-start-period',
          '1s',
          '--health-interval',
          '2s',
          '--health-timeout',
          '10s',
          '--health-retries',
          '10',
        ],
        network,
      }),
    );
    workerCreated = true;
    command('docker', [
      'exec',
      workerContainer,
      'node',
      'dist/infrastructure/outbox/outbox-worker-health.cli.js',
    ]);
    await waitForWorkerHealth(workerContainer);
    process.stdout.write(
      'Exact-image migrations, API dependency readiness, and worker health passed on isolated local services.\n',
    );
  } catch (error) {
    integrationError = error;
  } finally {
    if (workerCreated) {
      cleanupStep('remove worker container', cleanupErrors, () =>
        removeOwnedContainer(workerContainer, suffix),
      );
    }
    if (apiCreated) {
      cleanupStep('remove API container', cleanupErrors, () =>
        removeOwnedContainer(apiContainer, suffix),
      );
    }
    if (sourceQueueOwned) {
      cleanupStep('delete source queue', cleanupErrors, () => {
        assertOwnedQueue(services.localstack, sourceQueueUrl, suffix);
        localSqs(services.localstack, ['delete-queue', '--queue-url', sourceQueueUrl]);
      });
    }
    if (deadLetterQueueOwned) {
      cleanupStep('delete dead-letter queue', cleanupErrors, () => {
        assertOwnedQueue(services.localstack, deadLetterQueueUrl, suffix);
        localSqs(services.localstack, ['delete-queue', '--queue-url', deadLetterQueueUrl]);
      });
    }
    if (databaseCreated) {
      cleanupStep('drop isolated database', cleanupErrors, () =>
        command('docker', [
          'exec',
          services.postgres,
          'dropdb',
          '--username',
          'crypto_lending',
          '--force',
          '--if-exists',
          database,
        ]),
      );
    }
    for (const container of connectedServices.reverse()) {
      cleanupStep(`disconnect ${container}`, cleanupErrors, () =>
        captured('docker', ['network', 'disconnect', '--force', network, container]),
      );
    }
    if (networkCreated) {
      cleanupStep('remove internal network', cleanupErrors, () =>
        removeOwnedNetwork(network, suffix),
      );
    }
  }

  if (integrationError) {
    if (cleanupErrors.length > 0) {
      const message =
        integrationError instanceof Error ? integrationError.message : String(integrationError);
      throw new Error(
        `Local integration failed: ${message}\nCleanup also failed:\n${cleanupErrors.join('\n')}`,
        { cause: integrationError },
      );
    }
    throw integrationError;
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`Local integration cleanup failed:\n${cleanupErrors.join('\n')}`);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const action = options.get('action') ?? 'validate';
  const actions = [
    'validate',
    'build',
    'smoke',
    'integration',
    'build-and-smoke',
    'build-and-integration',
  ];
  if (!actions.includes(action)) {
    throw new Error(`Action must be one of: ${actions.join(', ')}.`);
  }

  const report = validateContainerArtifacts();
  if (!report.ok) throw new Error(report.errors.join('\n'));
  process.stdout.write(
    'Static container policy validation passed with zero cloud/network calls.\n',
  );
  if (action === 'validate') return;

  const revision = sourceRevision(options);
  const buildRequested = ['build', 'build-and-smoke', 'build-and-integration'].includes(action);
  const smokeRequested = ['smoke', 'build-and-smoke', 'build-and-integration'].includes(action);
  const integrationRequested = ['integration', 'build-and-integration'].includes(action);
  let tags = imageTags(revision);
  let digests;
  if (buildRequested) {
    ({ digests, tags } = buildImages(revision, options));
  } else {
    assertCleanCheckout(revision);
    digests = suppliedImageDigests(options);
  }

  ensureDockerAndBaseImage();
  assertImageConfiguration(tags, revision, digests);
  verifyRuntimeFiles(tags, revision);
  if (smokeRequested) {
    await smokeServices(tags, revision);
    process.stdout.write('Network-isolated, read-only container smoke tests passed.\n');
  }
  if (integrationRequested) await localInfrastructureIntegration(tags, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Container checks failed: ${message}\n`);
    process.exitCode = 1;
  });
}
