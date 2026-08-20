import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  validateNodeVersionSource,
  validateRepositoryWorkflows,
  validateWorkflowSource,
} from './validate-workflows.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const canonicalWorkflow = readFileSync(
  join(repositoryRoot, '.github', 'workflows', 'ci.yml'),
  'utf8',
);
const applicationInvocationMock = readFileSync(
  join(repositoryRoot, 'infra', 'aws', 'test-invoke-application-baseline.ps1'),
  'utf8',
);
const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

function mutate(search, replacement) {
  if (search instanceof RegExp) {
    assert.match(
      canonicalWorkflow,
      search,
      'mutation precondition did not match canonical workflow',
    );
  } else {
    assert.ok(
      canonicalWorkflow.includes(search),
      'mutation precondition did not match canonical workflow',
    );
  }
  return canonicalWorkflow.replace(search, replacement);
}

function assertRejected(source, expected) {
  const report = validateWorkflowSource(source);
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), expected);
}

function makeTemporaryRepository(workflow = canonicalWorkflow, nodeVersion = '22.23.2\n') {
  const root = mkdtempSync(join(tmpdir(), 'kan35-workflow-policy-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), workflow);
  writeFileSync(join(root, '.node-version'), nodeVersion);
  return root;
}

test('accepts the single offline, immutable, fail-closed CI workflow', () => {
  const report = validateRepositoryWorkflows({ repositoryRoot });
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.deepEqual(report.workflows, [join('.github', 'workflows', 'ci.yml')]);
  assert.equal(report.externalCallsMade, 0);
  assert.equal(report.cloudResourcesCreated, 0);
  assert.equal(report.paidServicesActivated, 0);
});

test('requires the exact Node.js patch version', () => {
  assert.equal(validateNodeVersionSource('22.23.2\n').ok, true);
  assert.match(
    validateNodeVersionSource('22\n').errors.join('\n'),
    /must contain exactly 22\.23\.2/,
  );
});

test('rejects privileged or broadened triggers', () => {
  assertRejected(mutate('  pull_request:\n', '  pull_request_target:\n'), /triggers|Privileged/);
});

test('rejects write and OIDC permissions', () => {
  assertRejected(
    mutate('  contents: read', '  contents: write\n  id-token: write'),
    /permissions|OIDC/,
  );
});

test('rejects mutable or unreviewed actions', () => {
  assertRejected(
    mutate('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@v7'),
    /immutable commit/,
  );
});

test('rejects retained checkout credentials', () => {
  assertRejected(
    mutate('persist-credentials: false', 'persist-credentials: true'),
    /must not retain/,
  );
});

test('rejects floating runner and Node.js versions', () => {
  assertRejected(mutate('runs-on: ubuntu-24.04', 'runs-on: ubuntu-latest'), /ubuntu-24\.04/);
  assertRejected(
    mutate('node-version-file: .node-version', 'node-version: 22'),
    /Node\.js must be read|Floating Node/,
  );
});

test('requires lifecycle scripts to stay disabled while pinning the npm CLI', () => {
  assertRejected(
    mutate(
      'npm install --global npm@11.6.4 --ignore-scripts --no-audit --no-fund',
      'npm install --global npm@11.6.4 --no-audit --no-fund',
    ),
    /Offline workflow policy and pinned tooling/,
  );
});

test('rejects secret and deployment-environment access', () => {
  assertRejected(
    mutate('    timeout-minutes: 30', '    environment: nonproduction\n    timeout-minutes: 30'),
    /deployment environment/,
  );
  assertRejected(
    mutate("  CI: 'true'", "  CI: 'true'\n  DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}"),
    /must not reference/,
  );
});

test('rejects cloud, registry-push, and arbitrary network commands', () => {
  assertRejected(
    mutate('run: npm run build', 'run: aws cloudformation deploy'),
    /cloud, deployment, registry-push/,
  );
  assertRejected(
    mutate('run: npm run build', 'run: docker push example.invalid/app'),
    /registry-push/,
  );
});

test('rejects an obfuscated deployment command even when command-pattern checks cannot see it', () => {
  assertRejected(
    `${canonicalWorkflow}\n      - name: Obfuscated deployment\n        run: a$@ws cloudformation deploy\n`,
    /reviewed canonical source/,
  );
});

test('rejects every unreviewed extra step, including an otherwise benign command', () => {
  assertRejected(
    `${canonicalWorkflow}\n      - name: Unreviewed extra step\n        run: echo unexpected\n`,
    /reviewed canonical source/,
  );
});

test('rejects the implicit GitHub workflow token explicitly', () => {
  assertRejected(
    mutate("  CI: 'true'", "  CI: 'true'\n  GH_TOKEN: ${{ github.token }}"),
    /must not reference github\.token/,
  );
});

test('requires ordered fail-closed migration verification', () => {
  assertRejected(
    mutate(
      '          npm run db:verify:compiled --workspace @crypto-lending/api\n          npm run db:rollback:compiled',
      '          npm run db:rollback:compiled',
    ),
    /up, verify, down, up, and verify/,
  );
});

test('requires every offline container and release-binding gate', () => {
  assertRejected(
    mutate('          node --test scripts/containers/validate-container-artifacts.test.mjs\n', ''),
    /Offline workflow policy and pinned tooling/,
  );
  assertRejected(
    mutate('          node scripts/containers/validate-container-artifacts.mjs\n', ''),
    /Offline workflow policy and pinned tooling/,
  );
  assertRejected(
    mutate(
      '          node infra/aws/validate-release-deployment-control-record.mjs --record infra/aws/release-deployment-control-record.example.json --mode example\n',
      '',
    ),
    /Offline workflow policy and pinned tooling/,
  );
  assertRejected(
    mutate(
      '          node --test infra/aws/validate-release-deployment-control-record.test.mjs\n',
      '',
    ),
    /Release-record mutations/,
  );
  assertRejected(
    mutate('          pwsh -NoProfile -File infra/aws/test-invoke-application-baseline.ps1\n', ''),
    /mocked release-bound invocation guard/,
  );
});

test('the invoked PowerShell mock suite exercises fail-closed KAN-35 release binding', () => {
  for (const fragment of [
    'ReleaseControlRecordFile = $approvedReleaseRecordPath',
    "[void] $missingArguments.Remove('ReleaseControlRecordFile')",
    '$failedArguments.ReleaseControlRecordFile = $incompleteReleaseRecordPath',
    'Missing KAN-35 release record reached AWS discovery.',
    'Failed KAN-35 gate reached AWS discovery.',
    'does not match the approved KAN-35',
  ]) {
    assert.ok(
      applicationInvocationMock.includes(fragment),
      `PowerShell release-binding mock is missing: ${fragment}`,
    );
  }
});

test('requires SHA-versioned, non-overwriting artifacts with internal and action digests', () => {
  assertRejected(
    mutate(
      'name: crypto-lending-openapi-${{ github.sha }}-${{ github.run_attempt }}',
      'name: crypto-lending-openapi',
    ),
    /source commit SHA/,
  );
  assertRejected(
    mutate(
      '          include-hidden-files: false\n          retention-days: 14',
      '          overwrite: true\n          retention-days: 14',
    ),
    /exclude hidden files|must not overwrite/,
  );
  assertRejected(
    mutate('          sha256sum --check SHA256SUMS', '          echo unchecked'),
    /Artifacts must be created/,
  );
});

test('rejects any additional active workflow until deployment is separately approved', () => {
  const root = makeTemporaryRepository();
  writeFileSync(join(root, '.github', 'workflows', 'deploy.yml'), 'name: Deploy\n');
  const report = validateRepositoryWorkflows({ repositoryRoot: root });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /Active workflows must be exactly ci\.yml/);
  assert.match(report.errors.join('\n'), /not approved by the zero-deploy KAN-35 policy/);
});

test('fails closed when the repository Node pin drifts', () => {
  const root = makeTemporaryRepository(canonicalWorkflow, '22\n');
  const report = validateRepositoryWorkflows({ repositoryRoot: root });
  assert.equal(report.ok, false);
  assert.match(report.errors.join('\n'), /must contain exactly 22\.23\.2/);
});
