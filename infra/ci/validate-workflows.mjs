import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_NODE_VERSION = '22.23.2';
const WORKFLOW_FILE = 'ci.yml';
const REVIEWED_WORKFLOW_SHA256 = '639d037332689bf86752ebde5658a3c0904df8e9d1e4ff1f8a4fbe88b77cfcb3';
const ALLOWED_ACTIONS = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
]);
const EXPECTED_ACTION_COUNTS = new Map([
  ['actions/checkout', 1],
  ['actions/setup-node', 1],
  ['actions/upload-artifact', 2],
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, '..', '..');

function normalizeNewlines(value) {
  return value.replaceAll('\r\n', '\n');
}

function topLevelBlock(source, key) {
  const lines = normalizeNewlines(source).split('\n');
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) return undefined;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

function workflowStepBlocks(source) {
  const lines = normalizeNewlines(source).split('\n');
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^      - name:\s*(.+?)\s*$/.exec(lines[index] ?? '');
    if (match) starts.push({ index, name: match[1] });
  }

  return starts.map((start, position) => {
    const end = starts[position + 1]?.index ?? lines.length;
    return {
      name: start.name,
      source: lines.slice(start.index, end).join('\n').trimEnd(),
    };
  });
}

function requireFragment(source, fragment, message, errors) {
  if (!source.includes(fragment)) errors.push(message);
}

function requireOrderedFragments(source, fragments, message, errors) {
  let cursor = 0;
  for (const fragment of fragments) {
    const position = source.indexOf(fragment, cursor);
    if (position < 0) {
      errors.push(`${message}: missing or out-of-order fragment ${JSON.stringify(fragment)}.`);
      return;
    }
    cursor = position + fragment.length;
  }
}

export function validateNodeVersionSource(source) {
  const errors = [];
  if (normalizeNewlines(source) !== `${EXPECTED_NODE_VERSION}\n`) {
    errors.push(
      `.node-version must contain exactly ${EXPECTED_NODE_VERSION} followed by a newline.`,
    );
  }
  return { ok: errors.length === 0, errors };
}

export function validateWorkflowSource(source, { fileName = WORKFLOW_FILE } = {}) {
  const errors = [];
  const normalized = normalizeNewlines(source);
  const workflowSha256 = createHash('sha256').update(normalized).digest('hex');

  if (fileName !== WORKFLOW_FILE) {
    errors.push(`Active workflow ${fileName} is not approved by the zero-deploy KAN-35 policy.`);
  }
  if (fileName === WORKFLOW_FILE && workflowSha256 !== REVIEWED_WORKFLOW_SHA256) {
    errors.push(
      `Workflow ${WORKFLOW_FILE} must exactly match the reviewed canonical source ` +
        `(expected SHA-256 ${REVIEWED_WORKFLOW_SHA256}, received ${workflowSha256}).`,
    );
  }
  if (source.includes('\0')) errors.push('Workflow source must not contain NUL bytes.');

  const expectedTriggerBlock = [
    'on:',
    '  push:',
    '    branches:',
    '      - main',
    '  pull_request:',
    '  workflow_dispatch:',
  ].join('\n');
  if (topLevelBlock(normalized, 'on') !== expectedTriggerBlock) {
    errors.push(
      'CI triggers must be limited to main pushes, pull requests, and manual validation.',
    );
  }

  if (topLevelBlock(normalized, 'permissions') !== 'permissions:\n  contents: read') {
    errors.push('Workflow permissions must contain only contents: read.');
  }
  if ((normalized.match(/^permissions:\s*$/gm) ?? []).length !== 1) {
    errors.push('Workflow must declare exactly one top-level permissions block.');
  }
  if (/^\s+[a-z-]+:\s*write\s*$/m.test(normalized) || /^\s*id-token\s*:/m.test(normalized)) {
    errors.push('CI must not grant write or OIDC permissions.');
  }
  if (/\$\{\{\s*secrets\./i.test(normalized)) {
    errors.push('CI must not reference repository, organization, or environment secrets.');
  }
  if (/\bgithub(?:\.token|\[['"]token['"]\])/i.test(normalized)) {
    errors.push('CI must not reference github.token or an equivalent implicit workflow token.');
  }
  if (/^\s+environment\s*:/m.test(normalized)) {
    errors.push('CI must not target a GitHub deployment environment.');
  }
  if (/\b(?:pull_request_target|workflow_run|repository_dispatch|schedule)\s*:/m.test(normalized)) {
    errors.push('Privileged, chained, repository-dispatch, and scheduled triggers are prohibited.');
  }
  if (/^\s+continue-on-error:\s*true\s*$/m.test(normalized)) {
    errors.push('Required CI gates must not continue after an error.');
  }

  const expectedConcurrencyBlock = [
    'concurrency:',
    '  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
    '  cancel-in-progress: true',
  ].join('\n');
  if (topLevelBlock(normalized, 'concurrency') !== expectedConcurrencyBlock) {
    errors.push(
      'CI concurrency must cancel superseded validation for the same branch or pull request.',
    );
  }

  const jobsBlock = topLevelBlock(normalized, 'jobs') ?? '';
  const jobNames = [...jobsBlock.matchAll(/^  ([a-zA-Z][a-zA-Z0-9_-]*):\s*$/gm)].map(
    (match) => match[1],
  );
  if (jobNames.length !== 1 || jobNames[0] !== 'validate') {
    errors.push('CI must expose one fail-closed validate job and no deployment job.');
  }

  const runnerValues = [...normalized.matchAll(/^\s+runs-on:\s*(.+?)\s*$/gm)].map(
    (match) => match[1],
  );
  if (runnerValues.length !== 1 || runnerValues[0] !== 'ubuntu-24.04') {
    errors.push('The validation job must use the explicit ubuntu-24.04 runner family.');
  }
  requireFragment(
    normalized,
    '    timeout-minutes: 30',
    'Validation must have a 30-minute timeout.',
    errors,
  );

  const actionCounts = new Map();
  const uses = [...normalized.matchAll(/^\s+uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)];
  for (const match of uses) {
    const value = match[1];
    const separator = value.lastIndexOf('@');
    const action = separator > 0 ? value.slice(0, separator) : value;
    const revision = separator > 0 ? value.slice(separator + 1) : '';
    const expectedRevision = ALLOWED_ACTIONS.get(action);
    if (!expectedRevision) {
      errors.push(`Action ${JSON.stringify(value)} is not on the reviewed allowlist.`);
      continue;
    }
    if (!/^[a-f0-9]{40}$/.test(revision) || revision !== expectedRevision) {
      errors.push(`Action ${action} must use the reviewed immutable commit ${expectedRevision}.`);
    }
    actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
  }
  for (const [action, expectedCount] of EXPECTED_ACTION_COUNTS) {
    if ((actionCounts.get(action) ?? 0) !== expectedCount) {
      errors.push(`Workflow must use ${action} exactly ${expectedCount} time(s).`);
    }
  }

  const steps = workflowStepBlocks(normalized);
  const checkout = steps.find((step) => step.name === 'Check out repository')?.source ?? '';
  requireFragment(
    checkout,
    'persist-credentials: false',
    'Checkout must not retain GitHub credentials.',
    errors,
  );
  requireFragment(
    checkout,
    'fetch-depth: 1',
    'Checkout must use the reviewed shallow fetch.',
    errors,
  );

  const setupNode = steps.find((step) => step.name === 'Set up Node.js')?.source ?? '';
  requireFragment(
    setupNode,
    'node-version-file: .node-version',
    'Node.js must be read from .node-version.',
    errors,
  );
  requireFragment(
    setupNode,
    'cache-dependency-path: package-lock.json',
    'The npm cache must be keyed by the root lockfile.',
    errors,
  );
  if (/node-version:\s*(?:latest|22)\s*$/m.test(setupNode)) {
    errors.push('Floating Node.js versions are prohibited.');
  }

  requireOrderedFragments(
    normalized,
    [
      'node --test infra/ci/validate-workflows.test.mjs',
      'node infra/ci/validate-workflows.mjs',
      'node scripts/containers/validate-container-artifacts.mjs',
      'node infra/aws/validate-release-deployment-control-record.mjs --record infra/aws/release-deployment-control-record.example.json --mode example',
      'npm install --global npm@11.6.4 --ignore-scripts --no-audit --no-fund',
      'test "$(npm --version)" = "11.6.4"',
      'node --test scripts/containers/validate-container-artifacts.test.mjs',
      'npm ci --no-audit --no-fund',
    ],
    'Offline workflow policy and pinned tooling must run before dependency-based gates',
    errors,
  );

  requireOrderedFragments(
    normalized,
    [
      'npm run db:migrate:compiled --workspace @crypto-lending/api',
      'npm run db:verify:compiled --workspace @crypto-lending/api',
      'npm run db:rollback:compiled --workspace @crypto-lending/api',
      'npm run db:migrate:compiled --workspace @crypto-lending/api',
      'npm run db:verify:compiled --workspace @crypto-lending/api',
    ],
    'Compiled migrations must run up, verify, down, up, and verify',
    errors,
  );

  requireOrderedFragments(
    normalized,
    [
      'npm run format:check',
      'npm run lint',
      'npm run typecheck',
      'npm test',
      'npm run test:e2e --workspace @crypto-lending/api',
      'npm run build',
      'npm run openapi:generate',
      'git diff --exit-code -- apps/api/openapi.json',
      'docker compose up --detach --build --wait --wait-timeout 120',
      'npm run test:integration',
      'docker compose down --volumes',
      'sha256sum openapi.json > SHA256SUMS',
      'sha256sum --check SHA256SUMS',
      'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
      'OPENAPI_ARTIFACT_DIGEST: ${{ steps.upload_openapi.outputs.artifact-digest }}',
    ],
    'Artifacts must be created only after every deterministic validation and cleanup gate',
    errors,
  );

  requireOrderedFragments(
    normalized,
    [
      'npm run infra:validate',
      'npm run infra:test:rehearsal',
      'node --test infra/aws/validate-release-deployment-control-record.test.mjs',
      'pwsh -NoProfile -File infra/aws/test-invoke-application-baseline.ps1',
      'npm run format:check',
    ],
    'Rehearsal/release mutations and the mocked release-bound invocation guard must pass before application checks',
    errors,
  );

  const uploadSteps = steps.filter((step) =>
    step.source.includes('uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'),
  );
  if (uploadSteps.length !== 2) {
    errors.push('Workflow must contain exactly the reviewed failure-log and OpenAPI uploads.');
  }
  for (const upload of uploadSteps) {
    requireFragment(
      upload.source,
      '${{ github.sha }}',
      `${upload.name} must be named with the source commit SHA.`,
      errors,
    );
    requireFragment(
      upload.source,
      '${{ github.run_attempt }}',
      `${upload.name} must distinguish rerun attempts.`,
      errors,
    );
    requireFragment(
      upload.source,
      'if-no-files-found: error',
      `${upload.name} must fail when its payload is absent.`,
      errors,
    );
    requireFragment(
      upload.source,
      'include-hidden-files: false',
      `${upload.name} must exclude hidden files.`,
      errors,
    );
    if (/overwrite:\s*true/m.test(upload.source)) {
      errors.push(`${upload.name} must not overwrite a prior artifact.`);
    }
  }
  requireFragment(
    normalized,
    'if [[ ! "$OPENAPI_ARTIFACT_DIGEST" =~ ^[a-f0-9]{64}$ ]]; then',
    'The uploaded OpenAPI artifact digest must be fail-closed validated.',
    errors,
  );

  const prohibitedCommand =
    /^\s+(?:run:\s*)?(?:aws|az|gcloud|terraform|tofu|pulumi|kubectl|helm|curl|wget)\b/im;
  if (prohibitedCommand.test(normalized) || /\bdocker\s+(?:login|push)\b/i.test(normalized)) {
    errors.push(
      'CI must not contain cloud, deployment, registry-push, or arbitrary network commands.',
    );
  }
  if (/aws-actions\/configure-aws-credentials/i.test(normalized)) {
    errors.push('CI must not configure a cloud identity.');
  }
  for (const fragment of [
    "AWS_EC2_METADATA_DISABLED: 'true'",
    'AWS_ACCESS_KEY_ID: test',
    'AWS_SECRET_ACCESS_KEY: test',
    'SQS_ENDPOINT: http://127.0.0.1:4566',
  ]) {
    requireFragment(normalized, fragment, `Missing offline safety marker ${fragment}.`, errors);
  }

  return { ok: errors.length === 0, errors };
}

export function validateRepositoryWorkflows({ repositoryRoot = defaultRepositoryRoot } = {}) {
  const root = resolve(repositoryRoot);
  const errors = [];
  const workflowDirectory = join(root, '.github', 'workflows');
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((name) => ['.yml', '.yaml'].includes(extname(name).toLowerCase()))
    .sort();

  if (workflowFiles.length !== 1 || workflowFiles[0] !== WORKFLOW_FILE) {
    errors.push(
      `Active workflows must be exactly ${WORKFLOW_FILE}; found ${workflowFiles.join(', ') || 'none'}.`,
    );
  }

  for (const fileName of workflowFiles) {
    const path = join(workflowDirectory, fileName);
    if (lstatSync(path).isSymbolicLink()) {
      errors.push(`Workflow ${fileName} must not be a symbolic link.`);
      continue;
    }
    errors.push(...validateWorkflowSource(readFileSync(path, 'utf8'), { fileName }).errors);
  }

  const nodeVersionPath = join(root, '.node-version');
  if (lstatSync(nodeVersionPath).isSymbolicLink()) {
    errors.push('.node-version must not be a symbolic link.');
  } else {
    errors.push(...validateNodeVersionSource(readFileSync(nodeVersionPath, 'utf8')).errors);
  }

  return {
    ok: errors.length === 0,
    errors,
    repositoryRoot: root,
    workflows: workflowFiles.map((name) => relative(root, join(workflowDirectory, name))),
    externalCallsMade: 0,
    cloudResourcesCreated: 0,
    paidServicesActivated: 0,
  };
}

function isMainModule() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && pathToFileURL(resolve(entrypoint)).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const report = validateRepositoryWorkflows();
    if (!report.ok) {
      for (const error of report.errors) process.stderr.write(`- ${error}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(
        [
          'KAN-35 workflow policy validation passed.',
          `Workflows: ${report.workflows.join(', ')}`,
          'External API calls made: 0',
          'Cloud resources created: 0',
          'Paid services activated: 0',
          '',
        ].join('\n'),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Workflow policy validation failed closed: ${message}\n`);
    process.exitCode = 1;
  }
}
