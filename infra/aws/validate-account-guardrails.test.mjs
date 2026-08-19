import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { validateAccountGuardrails } from './validate-account-guardrails.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const paths = {
  template: join(root, 'infra', 'aws', 'account-guardrails.yaml'),
  guard: join(root, 'infra', 'aws', 'invoke-account-guardrails.ps1'),
  applicationGuard: join(root, 'infra', 'aws', 'invoke-application-baseline.ps1'),
  record: join(root, 'infra', 'aws', 'billing-control-record.example.json'),
};

function withMutatedTemplate(replace) {
  const directory = mkdtempSync(join(tmpdir(), 'kan-229-validator-'));
  const path = join(directory, 'account-guardrails.yaml');
  writeFileSync(path, replace(readFileSync(paths.template, 'utf8')), 'utf8');
  return {
    result: validateAccountGuardrails({ ...paths, template: path }),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('accepts the repository account guardrail contract', () => {
  const result = validateAccountGuardrails(paths);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.awsCallsMade, 0);
});

test('rejects enabling anomaly detection by default', () => {
  const mutation = withMutatedTemplate((source) =>
    source.replace('Default: Disabled', 'Default: Create'),
  );
  try {
    assert.equal(mutation.result.ok, false);
    assert(mutation.result.errors.some((error) => error.includes('Default: Disabled')));
  } finally {
    mutation.cleanup();
  }
});

test('rejects a paid or fan-out notification resource', () => {
  const mutation = withMutatedTemplate((source) =>
    source.replace(
      'Resources:',
      ['Resources:', '  UnexpectedTopic:', '    Type: AWS::SNS::Topic'].join('\n'),
    ),
  );
  try {
    assert.equal(mutation.result.ok, false);
    assert(mutation.result.errors.some((error) => error.includes('AWS::SNS::Topic')));
  } finally {
    mutation.cleanup();
  }
});

test('rejects any resource outside the exact account-control allowlist', () => {
  const mutation = withMutatedTemplate((source) =>
    source.replace(
      'Resources:',
      [
        'Resources:',
        '  UnexpectedDatabase:',
        '    Type: AWS::RDS::DBInstance',
        '    Properties:',
        '      Engine: postgres',
      ].join('\n'),
    ),
  );
  try {
    assert.equal(mutation.result.ok, false);
    assert(
      mutation.result.errors.some((error) => error.includes('UnexpectedDatabase')),
      mutation.result.errors.join('\n'),
    );
  } finally {
    mutation.cleanup();
  }
});

test('rejects a quoted resource outside the exact account-control allowlist', () => {
  const mutation = withMutatedTemplate((source) =>
    source.replace(
      'Resources:',
      [
        'Resources:',
        '  "UnexpectedDatabase":',
        '    Type: AWS::RDS::DBInstance',
        '    Properties:',
        '      Engine: postgres',
      ].join('\n'),
    ),
  );
  try {
    assert.equal(mutation.result.ok, false);
    assert(
      mutation.result.errors.some((error) => error.includes('UnexpectedDatabase')),
      mutation.result.errors.join('\n'),
    );
  } finally {
    mutation.cleanup();
  }
});

test('rejects transforms that could expand beyond the exact resource allowlist', () => {
  const mutation = withMutatedTemplate((source) =>
    source.replace(
      'Description: KAN-229 account-level non-production cost notification guardrails.',
      [
        'Description: KAN-229 account-level non-production cost notification guardrails.',
        '"Transform" : ExistingAccountMacro',
      ].join('\n'),
    ),
  );
  try {
    assert.equal(mutation.result.ok, false);
    assert(mutation.result.errors.some((error) => error.includes('transforms or macros')));
  } finally {
    mutation.cleanup();
  }
});

test('rejects a tag-filtered or non-retained primary budget', () => {
  const mutation = withMutatedTemplate((source) =>
    source
      .replace('DeletionPolicy: Retain', 'DeletionPolicy: Delete')
      .replace('        BudgetType: COST', '        BudgetType: COST\n        CostFilters: {}'),
  );
  try {
    assert.equal(mutation.result.ok, false);
    assert(mutation.result.errors.some((error) => error.includes('DeletionPolicy: Retain')));
    assert(mutation.result.errors.some((error) => error.includes('account-wide')));
  } finally {
    mutation.cleanup();
  }
});

test('rejects missing governance tags', () => {
  const mutation = withMutatedTemplate((source) =>
    source.replaceAll('        - Key: cost-center\n          Value: !Ref CostCenter\n', ''),
  );
  try {
    assert.equal(mutation.result.ok, false);
    assert(mutation.result.errors.some((error) => error.includes('Key: cost-center')));
  } finally {
    mutation.cleanup();
  }
});

test('rejects parameter/output interface drift and external SNS delivery', () => {
  const mutation = withMutatedTemplate((source) =>
    source
      .replace('  AnomalyPercentage:', '  UnexpectedAnomalyPercentage:')
      .replace('  PolicyVersion:', '  UnexpectedPolicyVersion:')
      .replace('SubscriptionType: EMAIL', 'SubscriptionType: SNS'),
  );
  try {
    assert.equal(mutation.result.ok, false);
    assert(mutation.result.errors.some((error) => error.includes('UnexpectedAnomalyPercentage')));
    assert(mutation.result.errors.some((error) => error.includes('UnexpectedPolicyVersion')));
    assert(mutation.result.errors.some((error) => error.includes('never SNS')));
  } finally {
    mutation.cleanup();
  }
});
