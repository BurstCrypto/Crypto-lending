import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('CI has no cloud identity, provider credential, or deployment capability', () => {
  assert.equal((workflow.match(/^permissions:\s*$/gm) ?? []).length, 1);
  assert.match(workflow, /^permissions:\s*\r?\n\s+contents:\s*read\s*$/m);
  assert.doesNotMatch(workflow, /^\s+[a-z-]+:\s*write\s*$/m);
  assert.doesNotMatch(workflow, /^\s*id-token:\s*write\s*$/m);
  assert.doesNotMatch(workflow, /^\s*runs-on:\s*self-hosted\s*$/m);
  assert.doesNotMatch(workflow, /aws-actions\/configure-aws-credentials/i);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./i);
  assert.doesNotMatch(workflow, /^\s*environment:\s*/m);
});

test('CI scans full history without retaining checkout credentials before dependency install', () => {
  const checkout = workflow.match(/- name: Check out repository[\s\S]*?(?=\n\s{6}- name:)/u)?.[0];
  assert.ok(checkout);
  assert.match(checkout, /^\s+fetch-depth:\s*0\s*$/m);
  assert.match(checkout, /^\s+persist-credentials:\s*false\s*$/m);

  const setupIndex = workflow.indexOf('- name: Set up Node.js');
  const scannerIndex = workflow.indexOf('- name: Scan repository history and index for secrets');
  const installIndex = workflow.indexOf('- name: Install dependencies');
  assert(setupIndex >= 0);
  assert(scannerIndex > setupIndex);
  assert(installIndex > scannerIndex);
  assert.match(
    workflow.slice(scannerIndex, installIndex),
    /run:\s*node infra\/security\/validate-repository-secrets\.mjs/u,
  );
});

test('CI requires the offline secret, transition, and SQS mutation suites', () => {
  assert.match(workflow, /^\s+npm run infra:test:sqs\s*$/m);
  assert.match(workflow, /^\s+npm run infra:test:auth-wallet-transition\s*$/m);
  assert.match(workflow, /^\s+npm run infra:test:redis-operator-transition\s*$/m);
  assert.match(
    workflow,
    /^\s+npm run infra:test:auth-wallet-transition\s*\r?\n\s+npm run infra:test:credential-transition\s*\r?\n\s+npm run infra:test:redis-operator-transition\s*$/m,
  );
  assert.match(workflow, /^\s+npm run security:test:secrets\s*$/m);
});

test('CI disables metadata discovery and confines AWS-compatible tests to loopback fakes', () => {
  assert.match(workflow, /^\s+AWS_EC2_METADATA_DISABLED:\s*'true'\s*$/m);
  assert.match(workflow, /^\s+AWS_ACCESS_KEY_ID:\s*test\s*$/m);
  assert.match(workflow, /^\s+AWS_SECRET_ACCESS_KEY:\s*test\s*$/m);
  assert.match(workflow, /^\s+SQS_ENDPOINT:\s*http:\/\/127\.0\.0\.1:4566\s*$/m);
  assert.doesNotMatch(
    workflow,
    /^\s+(?:aws|terraform|tofu|pulumi|cdk|dig|nslookup|Resolve-DnsName|curl|wget)\b/im,
  );
});
