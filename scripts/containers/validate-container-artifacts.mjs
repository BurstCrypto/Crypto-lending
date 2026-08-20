/**
 * Static KAN-35 container policy validation. This module reads only local files;
 * it never invokes Docker, Git, a package registry, a cloud CLI, or the network.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONTAINER_POLICY = Object.freeze({
  backendDockerfileSha256: 'f81f2b49fb6a8c00edb4f0a8dc96870eab6176b0e2175e5fe6ad31b79e6e1b92',
  localRunnerSha256: '8f25b797ff10b224e195918b1fe978ddc8ec1446cf334f7c00d70d65564fde9f',
  nodeImage: 'node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46',
  nodeVersion: '22.23.2',
  npmTarballBytes: 2407857,
  npmTarballPath: '/tmp/npm-11.6.4.tgz',
  npmTarballSha256: '9c07edca12853cddbf4fed4e372485aa60c064f9bf3e4cd157a2db5518a1792b',
  npmTarballUrl: 'https://registry.npmjs.org/npm/-/npm-11.6.4.tgz',
  npmVersion: '11.6.4',
  rdsBundleBytes: 165408,
  rdsBundlePath: '/etc/ssl/certs/aws-rds-global-bundle.pem',
  rdsBundleSha256: 'e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3',
  rdsBundleUrl: 'https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem',
  runtimeUser: '10001:10001',
  webDockerfileSha256: 'a355f81d02b8820a9d00bc9d66260c300a038d854db3d4db557fe733bdfb3ec7',
});

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(moduleDirectory, '..', '..');

function readRequired(root, relativePath, errors) {
  try {
    return readFileSync(resolve(root, relativePath), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${relativePath} is required: ${message}`);
    return '';
  }
}

export function loadContainerSources(root = repositoryRoot) {
  const errors = [];
  const sources = {
    backendDockerfile: readRequired(root, 'apps/api/Dockerfile', errors),
    buildIdSource: readRequired(root, 'apps/web/lib/build-id.ts', errors),
    dockerignore: readRequired(root, '.dockerignore', errors),
    localRunner: readRequired(root, 'scripts/containers/run-local-container-checks.mjs', errors),
    nextConfig: readRequired(root, 'apps/web/next.config.ts', errors),
    packageJson: readRequired(root, 'package.json', errors),
    packageLock: readRequired(root, 'package-lock.json', errors),
    webDockerfile: readRequired(root, 'apps/web/Dockerfile', errors),
  };

  return { errors, sources };
}

function requireText(source, expected, label, errors) {
  if (!source.includes(expected)) errors.push(`${label} must include: ${expected}`);
}

function canonicalSourceSha256(source) {
  const canonical = `${source.replace(/\r\n?/gu, '\n').trimEnd()}\n`;
  return createHash('sha256').update(canonical).digest('hex');
}

function validateReviewedSource(source, expectedSha256, label, errors) {
  if (canonicalSourceSha256(source) !== expectedSha256) {
    errors.push(`${label} must match the reviewed canonical SHA-256.`);
  }
}

const REVIEWED_DOCKERIGNORE_RULES = Object.freeze([
  '*',
  '!.dockerignore',
  '!package.json',
  '!package-lock.json',
  '!tsconfig.base.json',
  '!apps/',
  '!apps/api/',
  '!apps/api/Dockerfile',
  '!apps/api/package.json',
  '!apps/api/nest-cli.json',
  '!apps/api/tsconfig.json',
  '!apps/api/tsconfig.build.json',
  '!apps/api/src/',
  '!apps/api/src/**',
  '!apps/web/',
  '!apps/web/Dockerfile',
  '!apps/web/package.json',
  '!apps/web/next.config.ts',
  '!apps/web/next-env.d.ts',
  '!apps/web/proxy.ts',
  '!apps/web/tsconfig.json',
  '!apps/web/app/',
  '!apps/web/app/**',
  '!apps/web/components/',
  '!apps/web/components/**',
  '!apps/web/lib/',
  '!apps/web/lib/**',
  '!apps/web/public/',
  '!apps/web/public/**',
]);

function logicalDockerfileInstructions(source) {
  const instructions = [];
  let logicalLine = '';
  for (const rawLine of source.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (!logicalLine && (!trimmed || trimmed.startsWith('#'))) continue;
    logicalLine += `${logicalLine ? ' ' : ''}${trimmed}`;
    if (/\\$/u.test(logicalLine)) {
      logicalLine = logicalLine.slice(0, -1).trimEnd();
      continue;
    }
    const match = logicalLine.match(/^([A-Za-z]+)(?:\s+(.*))?$/u);
    if (match) {
      instructions.push({ directive: match[1].toUpperCase(), value: match[2] ?? '' });
    }
    logicalLine = '';
  }
  if (logicalLine) instructions.push({ directive: 'INVALID', value: logicalLine });
  return instructions;
}

function parseDockerfileStages(source, label, errors) {
  const stages = [];
  let currentStage = null;
  for (const instruction of logicalDockerfileInstructions(source)) {
    if (instruction.directive === 'FROM') {
      const match = instruction.value.match(
        /^(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+([A-Za-z0-9._-]+))?$/iu,
      );
      if (!match) {
        errors.push(`${label} contains an invalid FROM instruction.`);
        currentStage = null;
        continue;
      }
      currentStage = {
        base: match[1],
        instructions: [],
        name: match[2]?.toLowerCase() ?? '',
      };
      stages.push(currentStage);
      continue;
    }
    if (currentStage) currentStage.instructions.push(instruction);
  }
  return stages;
}

function validateStageGraph(stages, expected, label, errors) {
  const actual = stages.map(({ base, name }) => [name, base]);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label} must use the exact reviewed literal stage graph.`);
  }
}

function validateFinalStage(stages, name, expectedCommand, label, errors) {
  const matches = stages.filter((stage) => stage.name === name);
  if (matches.length !== 1) {
    errors.push(`${label} must define exactly one ${name} final stage.`);
    return;
  }
  const instructions = matches[0].instructions;
  const users = instructions
    .filter(({ directive }) => directive === 'USER')
    .map(({ value }) => value);
  if (JSON.stringify(users) !== JSON.stringify([CONTAINER_POLICY.runtimeUser])) {
    errors.push(
      `${label} ${name} final stage must contain exactly one final USER ${CONTAINER_POLICY.runtimeUser}.`,
    );
  }
  const commands = instructions
    .filter(({ directive }) => directive === 'CMD')
    .map(({ value }) => value);
  if (JSON.stringify(commands) !== JSON.stringify([expectedCommand])) {
    errors.push(`${label} ${name} final stage must contain exactly the reviewed command.`);
  }
  if (instructions.some(({ directive }) => directive === 'ENTRYPOINT')) {
    errors.push(
      `${label} ${name} final stage must not override the reviewed command with ENTRYPOINT.`,
    );
  }
}

function validateDockerfileCommon(source, label, errors) {
  requireText(source, `FROM ${CONTAINER_POLICY.nodeImage} AS npm-toolchain`, label, errors);
  requireText(
    source,
    `ADD --checksum=sha256:${CONTAINER_POLICY.npmTarballSha256} --chmod=0444 ${CONTAINER_POLICY.npmTarballUrl} ${CONTAINER_POLICY.npmTarballPath}`,
    label,
    errors,
  );
  requireText(
    source,
    `test "$(wc -c < ${CONTAINER_POLICY.npmTarballPath})" -eq ${CONTAINER_POLICY.npmTarballBytes}`,
    label,
    errors,
  );
  requireText(
    source,
    `printf '%s  %s\\n' ${CONTAINER_POLICY.npmTarballSha256} ${CONTAINER_POLICY.npmTarballPath} | sha256sum --check --strict`,
    label,
    errors,
  );
  requireText(source, "require('/opt/npm/package.json').version", label, errors);
  requireText(source, `test "$(npm --version)" = ${CONTAINER_POLICY.npmVersion}`, label, errors);
  requireText(source, `USER ${CONTAINER_POLICY.runtimeUser}`, label, errors);
  requireText(source, 'org.opencontainers.image.revision="${SOURCE_REVISION}"', label, errors);
  requireText(source, 'org.opencontainers.image.version="${SOURCE_REVISION}"', label, errors);
  requireText(source, "grep -Eq '^[a-f0-9]{40}$'", label, errors);
  requireText(source, 'npm ci --ignore-scripts --no-audit --no-fund', label, errors);
  requireText(source, '--include-workspace-root=false', label, errors);

  if (/^\s*ARG\s+(?:NODE_IMAGE|NPM_VERSION)(?:\s|=|$)/imu.test(source)) {
    errors.push(
      `${label} must not expose the reviewed Node image or npm version as build arguments.`,
    );
  }
  if (/^\s*FROM\s+[^\n]*\$[{(]/imu.test(source)) {
    errors.push(`${label} FROM inputs must be literal and non-overrideable.`);
  }
  if (/\bnpm\s+(?:install|i)\b/i.test(source)) {
    errors.push(`${label} dependency installation must use npm ci, not npm install.`);
  }
  if (/\b(?:latest|edge)\b/i.test(source)) {
    errors.push(`${label} must not use mutable latest/edge inputs.`);
  }
  if (/\b(?:curl|wget)\b/i.test(source)) {
    errors.push(
      `${label} must use checksum-pinned ADD for the RDS bundle, not an unchecked downloader.`,
    );
  }
  const instructions = logicalDockerfileInstructions(source);
  if (instructions.some(({ directive }) => directive === 'ONBUILD')) {
    errors.push(`${label} must not contain inherited ONBUILD behavior.`);
  }
  if (instructions.some(({ directive }) => directive === 'ENTRYPOINT')) {
    errors.push(`${label} must use only the reviewed per-target CMD values.`);
  }
  if (
    instructions.some(
      ({ directive, value }) =>
        directive === 'USER' && value.trim() !== CONTAINER_POLICY.runtimeUser,
    )
  ) {
    errors.push(
      `${label} must not contain a root or alternate USER instruction; runtime stages use only ${CONTAINER_POLICY.runtimeUser}.`,
    );
  }
}

function validateOfflineBuild(source, workspace, label, errors) {
  requireText(
    source,
    `RUN --network=none npm run build --workspace @crypto-lending/${workspace}`,
    label,
    errors,
  );
}

function validateDockerignore(source, errors) {
  const rules = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (JSON.stringify(rules) !== JSON.stringify(REVIEWED_DOCKERIGNORE_RULES)) {
    errors.push('.dockerignore must match the exact reviewed deny-all allowlist.');
  }
}

function parseJson(source, label, errors) {
  try {
    return JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${label} must be valid JSON: ${message}`);
    return null;
  }
}

function validatePackageLock(packageJsonSource, packageLockSource, errors) {
  const packageJson = parseJson(packageJsonSource, 'package.json', errors);
  const packageLock = parseJson(packageLockSource, 'package-lock.json', errors);
  if (!packageJson || !packageLock) return;

  if (packageJson.packageManager !== `npm@${CONTAINER_POLICY.npmVersion}`) {
    errors.push(`package.json packageManager must be npm@${CONTAINER_POLICY.npmVersion}.`);
  }
  if (packageLock.lockfileVersion !== 3) {
    errors.push('package-lock.json must use lockfileVersion 3.');
  }

  for (const [path, metadata] of Object.entries(packageLock.packages ?? {})) {
    if (!path.startsWith('node_modules/') || metadata.link) continue;
    if (typeof metadata.integrity !== 'string' || !metadata.integrity) {
      errors.push(`package-lock.json dependency ${path} is missing an integrity value.`);
    }
    if (
      typeof metadata.resolved === 'string' &&
      !metadata.resolved.startsWith('https://registry.npmjs.org/')
    ) {
      errors.push(`package-lock.json dependency ${path} uses a non-registry source.`);
    }
  }
}

export function validateContainerSources(sources, initialErrors = []) {
  const errors = [...initialErrors];
  const { backendDockerfile, buildIdSource, dockerignore, localRunner, nextConfig, packageJson } =
    sources;
  const { packageLock, webDockerfile } = sources;

  validateReviewedSource(
    localRunner,
    CONTAINER_POLICY.localRunnerSha256,
    'local container runner',
    errors,
  );

  validateDockerfileCommon(backendDockerfile, 'apps/api/Dockerfile', errors);
  validateOfflineBuild(backendDockerfile, 'api', 'apps/api/Dockerfile', errors);
  validateReviewedSource(
    backendDockerfile,
    CONTAINER_POLICY.backendDockerfileSha256,
    'apps/api/Dockerfile',
    errors,
  );
  const backendStages = parseDockerfileStages(backendDockerfile, 'apps/api/Dockerfile', errors);
  validateStageGraph(
    backendStages,
    [
      ['npm-toolchain', CONTAINER_POLICY.nodeImage],
      ['api-build', 'npm-toolchain'],
      ['api-production-dependencies', 'npm-toolchain'],
      ['backend-runtime', CONTAINER_POLICY.nodeImage],
      ['api', 'backend-runtime'],
      ['worker', 'backend-runtime'],
    ],
    'apps/api/Dockerfile',
    errors,
  );
  validateFinalStage(
    backendStages,
    'api',
    '["node", "dist/main.js"]',
    'apps/api/Dockerfile',
    errors,
  );
  validateFinalStage(
    backendStages,
    'worker',
    '["node", "dist/infrastructure/outbox/outbox-worker.cli.js"]',
    'apps/api/Dockerfile',
    errors,
  );
  requireText(
    backendDockerfile,
    'CMD ["node", "dist/infrastructure/outbox/outbox-worker-health.cli.js"]',
    'apps/api/Dockerfile',
    errors,
  );
  requireText(
    backendDockerfile,
    'dist/infrastructure/database/migration.cli.js',
    'apps/api/Dockerfile',
    errors,
  );
  requireText(
    backendDockerfile,
    'install --directory --owner 0 --group 0 --mode 0755 /etc/ssl/certs',
    'apps/api/Dockerfile',
    errors,
  );
  requireText(
    backendDockerfile,
    `ADD --checksum=sha256:${CONTAINER_POLICY.rdsBundleSha256} --chmod=0444 ${CONTAINER_POLICY.rdsBundleUrl} ${CONTAINER_POLICY.rdsBundlePath}`,
    'apps/api/Dockerfile',
    errors,
  );
  requireText(
    backendDockerfile,
    `test "$(wc -c < ${CONTAINER_POLICY.rdsBundlePath})" -eq ${CONTAINER_POLICY.rdsBundleBytes}`,
    'apps/api/Dockerfile',
    errors,
  );
  requireText(
    backendDockerfile,
    `printf '%s  %s\\n' ${CONTAINER_POLICY.rdsBundleSha256} ${CONTAINER_POLICY.rdsBundlePath} | sha256sum --check --strict`,
    'apps/api/Dockerfile',
    errors,
  );

  validateDockerfileCommon(webDockerfile, 'apps/web/Dockerfile', errors);
  validateOfflineBuild(webDockerfile, 'web', 'apps/web/Dockerfile', errors);
  validateReviewedSource(
    webDockerfile,
    CONTAINER_POLICY.webDockerfileSha256,
    'apps/web/Dockerfile',
    errors,
  );
  const webStages = parseDockerfileStages(webDockerfile, 'apps/web/Dockerfile', errors);
  validateStageGraph(
    webStages,
    [
      ['npm-toolchain', CONTAINER_POLICY.nodeImage],
      ['web-build', 'npm-toolchain'],
      ['web', CONTAINER_POLICY.nodeImage],
    ],
    'apps/web/Dockerfile',
    errors,
  );
  validateFinalStage(webStages, 'web', '["node", "server.js"]', 'apps/web/Dockerfile', errors);
  requireText(
    webDockerfile,
    'test "$(cat apps/web/.next/BUILD_ID)" = "${SOURCE_REVISION}"',
    'apps/web/Dockerfile',
    errors,
  );
  validateDockerignore(dockerignore, errors);
  validatePackageLock(packageJson, packageLock, errors);

  requireText(
    nextConfig,
    'generateBuildId: () => resolveBuildId()',
    'apps/web/next.config.ts',
    errors,
  );
  requireText(
    buildIdSource,
    'const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;',
    'apps/web/lib/build-id.ts',
    errors,
  );
  requireText(
    buildIdSource,
    "export const LOCAL_BUILD_ID = 'local-unversioned';",
    'apps/web/lib/build-id.ts',
    errors,
  );

  requireText(
    localRunner,
    "const action = options.get('action') ?? 'validate';",
    'local container runner',
    errors,
  );
  requireText(
    localRunner,
    "options.has('allow-network-downloads')",
    'local container runner',
    errors,
  );
  for (const secureSmokeValue of [
    "DATABASE_RUNTIME_SSL_MODE: 'verify-full'",
    "REDIS_URL: 'rediss://",
    'https://sqs.us-east-1.amazonaws.com/',
  ]) {
    requireText(localRunner, secureSmokeValue, 'local container runner', errors);
  }
  const productionSmoke = localRunner.match(
    /async function smokeServices\([\s\S]+?\n\}\n\nfunction requireHealthyLocalServices/u,
  )?.[0];
  if (!productionSmoke) {
    errors.push('Local container runner must retain the reviewed production-mode smoke function.');
  } else if (
    /DATABASE_RUNTIME_SSL_MODE:\s*['"]disable['"]/u.test(productionSmoke) ||
    /REDIS_URL:\s*['"]redis:\/\//u.test(productionSmoke) ||
    /\bSQS_ENDPOINT:/u.test(productionSmoke)
  ) {
    errors.push(
      'Production-mode container smoke values must preserve TLS and canonical SQS policy.',
    );
  }
  if (
    /['"](?:--push|push)['"]/u.test(localRunner) ||
    /['"]aws(?:\.exe)?['"]/iu.test(localRunner) ||
    /\becr\b/iu.test(localRunner)
  ) {
    errors.push('Local container runner must not contain registry-push, ECR, or AWS actions.');
  }

  return {
    cloudCallsMade: 0,
    errors,
    networkCallsMade: 0,
    ok: errors.length === 0,
    policy: CONTAINER_POLICY,
  };
}

export function validateContainerArtifacts(root = repositoryRoot) {
  const { errors, sources } = loadContainerSources(root);
  return validateContainerSources(sources, errors);
}

function runCli() {
  const json = process.argv.includes('--json');
  const report = validateContainerArtifacts();
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.ok) {
    process.stdout.write(
      `Container policy valid (Node ${report.policy.nodeVersion}, npm ${report.policy.npmVersion}, zero cloud/network calls).\n`,
    );
  } else {
    for (const error of report.errors) process.stderr.write(`- ${error}\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli();
