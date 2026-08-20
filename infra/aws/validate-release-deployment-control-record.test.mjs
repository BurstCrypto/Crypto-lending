import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  canonicalizeReleaseDeploymentControlRecord,
  RELEASE_PARAMETER_NAMES,
  validateReleaseDeploymentControlRecord,
} from './validate-release-deployment-control-record.mjs';

const validatorPath = join(import.meta.dirname, 'validate-release-deployment-control-record.mjs');
const schema = JSON.parse(
  readFileSync(join(import.meta.dirname, 'release-deployment-control-record.schema.json'), 'utf8'),
);
const schemaValidator = new Ajv2020({
  strict: true,
  allErrors: true,
  validateFormats: false,
}).compile(schema);
const example = JSON.parse(
  readFileSync(join(import.meta.dirname, 'release-deployment-control-record.example.json'), 'utf8'),
);
const NOW = new Date('2026-08-20T12:00:00Z');

function approvedRecord() {
  const account = '111122223333';
  const region = 'us-west-2';
  const imagePrefix = `${account}.dkr.ecr.${region}.amazonaws.com/`;
  const sourceRevision = 'a'.repeat(40);
  const apiImageUri = `${imagePrefix}crypto-lending-api@sha256:${'b'.repeat(64)}`;
  const webImageUri = `${imagePrefix}crypto-lending-web@sha256:${'c'.repeat(64)}`;
  const workerImageUri = `${imagePrefix}crypto-lending-worker@sha256:${'d'.repeat(64)}`;
  return {
    schemaVersion: 2,
    artifactType: 'KAN_35_RELEASE_DEPLOYMENT_CONTROL',
    status: 'APPROVED',
    recordId: 'KAN-35:RELEASE:STAGING-V1',
    approvedAt: '2026-08-20T10:00:00Z',
    expiresAt: '2026-08-21T12:00:00Z',
    action: 'DEPLOY',
    templateSha256: 'f'.repeat(64),
    aws: { accountId: account, region },
    target: {
      environmentName: 'staging-kan35',
      stackName: 'crypto-lending-application-staging',
      changeSetName: 'kan35-release-staging-v1',
      changeSetType: 'CREATE',
    },
    artifact: {
      sourceRevision,
      apiImageUri,
      webImageUri,
      workerImageUri,
      buildEvidenceSha256: 'e'.repeat(64),
      provenanceReference: 'evidence:KAN-35/build-staging-v1',
    },
    parameters: {
      BillingAcknowledgement: 'I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES',
      EnvironmentName: 'staging-kan35',
      ApplicationVersion: sourceRevision,
      ApiImageUri: apiImageUri,
      WebImageUri: webImageUri,
      WorkerImageUri: workerImageUri,
      RdsCaBundlePath: '/etc/ssl/certs/aws-rds-global-bundle.pem',
      ApiDesiredCount: '0',
      WebDesiredCount: '0',
      WorkerDesiredCount: '0',
      VpcCidr: '10.42.0.0/16',
      PublicSubnetACidr: '10.42.0.0/24',
      PublicSubnetBCidr: '10.42.1.0/24',
      PrivateSubnetACidr: '10.42.10.0/24',
      PrivateSubnetBCidr: '10.42.11.0/24',
      PrivateEgressMode: 'VpcEndpoints',
      S3ManagedPrefixListId: 'pl-12345678',
      AllowedIngressIpv4Cidr: '203.0.113.10/32',
      AlbCertificateArn:
        'arn:aws:acm:us-west-2:111122223333:certificate/11111111-2222-3333-4444-555555555555',
      ApplicationHostname: 'app.staging.example.com',
      DatabaseName: 'crypto_lending',
      DatabaseInstanceClass: 'db.t4g.micro',
      DatabaseAllocatedStorageGiB: '20',
      PostgresEngineVersion: '16.4',
      DatabaseDeletionProtection: 'false',
      EnableDatabaseMultiAz: 'false',
      RedisNodeType: 'cache.t4g.micro',
      EnableRedisReplica: 'false',
      StatefulBackupRetentionDays: '1',
      SqsMaxReceiveCount: '3',
      SqsVisibilityTimeoutSeconds: '30',
      LogRetentionDays: '14',
      EnableOperationalAlarms: 'true',
      EnableOperationalDashboard: 'false',
      EnableContainerInsights: 'disabled',
    },
    gates: {
      continuousIntegration: 'PASS',
      unitTests: 'PASS',
      integrationTests: 'PASS',
      migrationValidation: 'PASS',
      reproducibleBuild: 'PASS',
      artifactVersioning: 'PASS',
      evidenceReference: 'evidence:KAN-35/gates-staging-v1',
    },
    rollback: {
      intent: 'NONE',
      fromApplicationVersion: 'NOT_APPLICABLE',
      priorReleaseRecordSha256: 'NOT_APPLICABLE',
      parameterDifferences: [],
      databaseCompatibility: 'NOT_APPLICABLE',
      evidenceReference: 'NOT_APPLICABLE',
    },
    authority: {
      deploymentApprovers: ['release-owner', 'billing-finance-owner'],
      rollbackApprovers: ['incident-commander', 'database-owner'],
    },
    independentVerification: {
      verifier: 'independent-release-verifier',
      decision: 'APPROVED',
      verifiedAt: '2026-08-20T11:00:00Z',
    },
  };
}

function validate(record, overrides = {}) {
  return validateReleaseDeploymentControlRecord(record, {
    mode: 'approved',
    now: NOW,
    ...overrides,
  });
}

function rollbackRecord(prior = approvedRecord()) {
  const record = structuredClone(prior);
  record.recordId = 'KAN-35:ROLLBACK:STAGING-V1';
  record.action = 'ROLLBACK';
  record.target.changeSetName = 'kan35-rollback-staging-v1';
  record.target.changeSetType = 'UPDATE';
  record.rollback = {
    intent: 'REDEPLOY_PRIOR_VERSION',
    fromApplicationVersion: '9'.repeat(40),
    priorReleaseRecordSha256: validate(prior).canonicalSha256,
    parameterDifferences: [],
    databaseCompatibility: 'BACKWARD_COMPATIBLE_SCHEMA',
    evidenceReference: 'evidence:KAN-35/rollback-compatibility-v1',
  };
  return record;
}

function expectRejected(mutate, pattern) {
  const record = approvedRecord();
  mutate(record);
  const result = validate(record);
  assert.equal(result.ok, false);
  assert(
    result.errors.some((error) => pattern.test(error)),
    `Expected ${pattern}; received:\n${result.errors.join('\n')}`,
  );
}

test('the committed example is schema-valid, inert, and makes no external call', () => {
  assert.equal(schemaValidator(example), true, JSON.stringify(schemaValidator.errors));

  const result = validateReleaseDeploymentControlRecord(example, { mode: 'example', now: NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.match(result.canonicalSha256, /^[a-f0-9]{64}$/);
});

test('accepts one exact approved CREATE record and returns stable canonical binding material', () => {
  const record = approvedRecord();
  const result = validate(record, {
    expectedAccount: record.aws.accountId,
    expectedRegion: record.aws.region,
    expectedEnvironment: record.target.environmentName,
    expectedStack: record.target.stackName,
    expectedChangeSet: record.target.changeSetName,
    expectedChangeSetType: record.target.changeSetType,
    expectedTemplateSha256: record.templateSha256,
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(Object.keys(record.parameters), RELEASE_PARAMETER_NAMES);

  const reordered = Object.fromEntries(Object.entries(record).reverse());
  assert.equal(
    canonicalizeReleaseDeploymentControlRecord(record),
    canonicalizeReleaseDeploymentControlRecord(reordered),
  );
});

test('rejects missing, additional, non-string, and mismatched full parameter entries', () => {
  expectRejected(
    (record) => delete record.parameters.EnableContainerInsights,
    /parameters\.EnableContainerInsights is required/,
  );
  expectRejected(
    (record) => (record.parameters.UnreviewedParameter = 'value'),
    /parameters\.UnreviewedParameter is not allowed/,
  );
  expectRejected(
    (record) => (record.parameters.LogRetentionDays = 14),
    /LogRetentionDays must be a non-empty explicit string/,
  );
  expectRejected(
    (record) => (record.parameters.EnvironmentName = 'staging-other'),
    /EnvironmentName must equal record\.target/,
  );
});

test('binds source revision and every image URI to the full CloudFormation parameter map', () => {
  expectRejected(
    (record) => (record.parameters.ApplicationVersion = '9'.repeat(40)),
    /ApplicationVersion must equal record\.artifact\.sourceRevision/,
  );
  for (const [parameter, artifact] of [
    ['ApiImageUri', 'apiImageUri'],
    ['WebImageUri', 'webImageUri'],
    ['WorkerImageUri', 'workerImageUri'],
  ]) {
    expectRejected(
      (record) => (record.parameters[parameter] = record.parameters[parameter].replace(/.$/, '0')),
      new RegExp(`${parameter} must equal record\\.artifact\\.${artifact}`),
    );
  }
  expectRejected((record) => {
    const wrong = record.artifact.apiImageUri.replace('111122223333', '999999999999');
    record.artifact.apiImageUri = wrong;
    record.parameters.ApiImageUri = wrong;
  }, /ApiImageUri must use the approved account and Region/);
});

test('binds each workload to its exact reviewed ECR repository', () => {
  assert.equal(schemaValidator(approvedRecord()), true, JSON.stringify(schemaValidator.errors));

  for (const [artifactName, parameterName, substitutedArtifactName, expectedRepository] of [
    ['apiImageUri', 'ApiImageUri', 'webImageUri', 'crypto-lending-api'],
    ['webImageUri', 'WebImageUri', 'workerImageUri', 'crypto-lending-web'],
    ['workerImageUri', 'WorkerImageUri', 'apiImageUri', 'crypto-lending-worker'],
  ]) {
    const record = approvedRecord();
    record.artifact[artifactName] = record.artifact[substitutedArtifactName];
    record.parameters[parameterName] = record.artifact[artifactName];

    const result = validate(record);
    assert.equal(result.ok, false, `${artifactName} accepted a swapped workload image`);
    assert.equal(schemaValidator(record), false, `${artifactName} passed the release schema`);
    assert(
      result.errors.some((error) => error.includes(`'${expectedRepository}' ECR repository`)),
      result.errors.join('\n'),
    );
  }

  const allApi = approvedRecord();
  for (const [artifactName, parameterName] of [
    ['webImageUri', 'WebImageUri'],
    ['workerImageUri', 'WorkerImageUri'],
  ]) {
    allApi.artifact[artifactName] = allApi.artifact.apiImageUri;
    allApi.parameters[parameterName] = allApi.artifact.apiImageUri;
  }
  const allApiResult = validate(allApi);
  assert.equal(allApiResult.ok, false, 'accepted one API image for every workload');
  assert.equal(schemaValidator(allApi), false, 'one API image passed the release schema');
  assert(allApiResult.errors.some((error) => /crypto-lending-web/.test(error)));
  assert(allApiResult.errors.some((error) => /crypto-lending-worker/.test(error)));

  const wrongRepository = approvedRecord();
  const wrongUri = wrongRepository.artifact.apiImageUri.replace(
    '/crypto-lending-api@',
    '/crypto-lending-unreviewed@',
  );
  wrongRepository.artifact.apiImageUri = wrongUri;
  wrongRepository.parameters.ApiImageUri = wrongUri;
  const wrongRepositoryResult = validate(wrongRepository);
  assert.equal(wrongRepositoryResult.ok, false, 'accepted an unreviewed workload repository');
  assert.equal(
    schemaValidator(wrongRepository),
    false,
    'unreviewed repo passed the release schema',
  );
  assert(wrongRepositoryResult.errors.some((error) => /crypto-lending-api/.test(error)));
});

test('rejects any failed release gate and unsafe CREATE activation', () => {
  expectRejected(
    (record) => (record.gates.integrationTests = 'FAIL'),
    /gates\.integrationTests must equal PASS/,
  );
  expectRejected(
    (record) => (record.parameters.ApiDesiredCount = '1'),
    /CREATE release records require every desired count to equal 0/,
  );
});

test('rejects pairwise subnet overlap, including nested ranges', () => {
  expectRejected((record) => {
    record.parameters.PublicSubnetACidr = '10.42.0.0/23';
    record.parameters.PublicSubnetBCidr = '10.42.1.0/24';
  }, /PublicSubnetACidr overlaps record\.parameters\.PublicSubnetBCidr/);

  expectRejected((record) => {
    record.parameters.PrivateSubnetACidr = '10.42.0.128/25';
  }, /PublicSubnetACidr overlaps record\.parameters\.PrivateSubnetACidr/);
});

test('requires all caller-supplied target bindings to match exactly', () => {
  const record = approvedRecord();
  for (const [option, expected, pattern] of [
    ['expectedAccount', '999999999999', /approved account/],
    ['expectedRegion', 'us-east-1', /approved Region/],
    ['expectedEnvironment', 'staging-other', /approved environment/],
    ['expectedStack', 'different-stack', /approved stack/],
    ['expectedChangeSet', 'different-change-set', /approved change set/],
    ['expectedChangeSetType', 'UPDATE', /approved change-set type/],
    ['expectedTemplateSha256', '0'.repeat(64), /approved template SHA-256/],
  ]) {
    const result = validate(record, { [option]: expected });
    assert.equal(result.ok, false);
    assert(
      result.errors.some((error) => pattern.test(error)),
      result.errors.join('\n'),
    );
  }
});

test('accepts only an explicit, prior-record-bound, non-destructive rollback intent', () => {
  const prior = approvedRecord();
  const record = rollbackRecord(prior);
  const result = validate(record, { priorRecord: prior });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(
    result.priorReleaseBinding.canonicalSha256,
    record.rollback.priorReleaseRecordSha256,
  );

  for (const [mutate, pattern] of [
    [
      (value) => (value.target.changeSetType = 'CREATE'),
      /ROLLBACK requires target\.changeSetType UPDATE/,
    ],
    [(value) => (value.rollback.intent = 'NONE'), /ROLLBACK requires rollback\.intent/],
    [
      (value) => (value.rollback.fromApplicationVersion = value.artifact.sourceRevision),
      /target source revision must differ/,
    ],
    [
      (value) => (value.rollback.priorReleaseRecordSha256 = 'NOT_APPLICABLE'),
      /canonical prior release record SHA-256/,
    ],
    [
      (value) => (value.rollback.databaseCompatibility = 'NOT_APPLICABLE'),
      /non-destructive database compatibility/,
    ],
  ]) {
    const candidate = structuredClone(record);
    mutate(candidate);
    const rejected = validate(candidate, { priorRecord: prior });
    assert.equal(rejected.ok, false);
    assert(
      rejected.errors.some((error) => pattern.test(error)),
      rejected.errors.join('\n'),
    );
  }
});

test('rollback loads, hashes, and validates the exact prior DEPLOY record', () => {
  const prior = approvedRecord();
  const record = rollbackRecord(prior);

  const missing = validate(record);
  assert.equal(missing.ok, false);
  assert(missing.errors.some((error) => /requires a local --prior-record/.test(error)));

  const wrongDigest = structuredClone(record);
  wrongDigest.rollback.priorReleaseRecordSha256 = '8'.repeat(64);
  const digestRejected = validate(wrongDigest, { priorRecord: prior });
  assert.equal(digestRejected.ok, false);
  assert(digestRejected.errors.some((error) => /canonical SHA-256 does not match/.test(error)));

  const substitutedPrior = structuredClone(prior);
  substitutedPrior.artifact.sourceRevision = '7'.repeat(40);
  substitutedPrior.parameters.ApplicationVersion = substitutedPrior.artifact.sourceRevision;
  for (const [artifactName, parameterName, digest] of [
    ['apiImageUri', 'ApiImageUri', '1'],
    ['webImageUri', 'WebImageUri', '2'],
    ['workerImageUri', 'WorkerImageUri', '3'],
  ]) {
    const uri = substitutedPrior.artifact[artifactName].replace(/[a-f0-9]{64}$/, digest.repeat(64));
    substitutedPrior.artifact[artifactName] = uri;
    substitutedPrior.parameters[parameterName] = uri;
  }
  const substituted = structuredClone(record);
  substituted.rollback.priorReleaseRecordSha256 = validate(substitutedPrior).canonicalSha256;
  const artifactRejected = validate(substituted, { priorRecord: substitutedPrior });
  assert.equal(artifactRejected.ok, false);
  assert(
    artifactRejected.errors.some((error) => /artifact\.sourceRevision must equal/.test(error)),
  );
});

test('rollback matches every prior parameter except explicitly bound desired-count rollout knobs', () => {
  const prior = approvedRecord();
  prior.expiresAt = '2026-08-20T11:00:00Z';
  const record = rollbackRecord(prior);
  record.expiresAt = '2026-08-21T12:00:00Z';
  record.parameters.ApiDesiredCount = '1';
  record.rollback.parameterDifferences = [
    {
      parameterName: 'ApiDesiredCount',
      priorValue: '0',
      rollbackValue: '1',
      justification: 'CURRENT_ROLLOUT_CAPACITY',
    },
  ];
  const accepted = validate(record, { priorRecord: prior });
  assert.equal(accepted.ok, true, accepted.errors.join('\n'));

  const unapprovedDifference = structuredClone(record);
  unapprovedDifference.parameters.LogRetentionDays = '30';
  const rejected = validate(unapprovedDifference, { priorRecord: prior });
  assert.equal(rejected.ok, false);
  assert(
    rejected.errors.some((error) => /LogRetentionDays.*must equal the prior DEPLOY/.test(error)),
  );

  const forgedJustification = structuredClone(record);
  forgedJustification.rollback.parameterDifferences[0].rollbackValue = '2';
  const forgedRejected = validate(forgedJustification, { priorRecord: prior });
  assert.equal(forgedRejected.ok, false);
  assert(forgedRejected.errors.some((error) => /rollbackValue must equal/.test(error)));
});

test('compares the active record to an independently supplied expected canonical digest', () => {
  const record = approvedRecord();
  const digest = validate(record).canonicalSha256;
  assert.equal(validate(record, { expectedRecordSha256: digest }).ok, true);
  const rejected = validate(record, { expectedRecordSha256: '0'.repeat(64) });
  assert.equal(rejected.ok, false);
  assert(rejected.errors.some((error) => /does not match the expected digest/.test(error)));
});

test('rejects secret-shaped material and an approval that is expired or not independent', () => {
  expectRejected(
    (record) => (record.artifact.provenanceReference = 'password=do-not-store'),
    /secret-shaped/,
  );
  expectRejected(
    (record) => (record.expiresAt = '2026-08-20T11:59:59Z'),
    /expiresAt must be in the future/,
  );
  expectRejected(
    (record) => (record.independentVerification.verifier = record.authority.deploymentApprovers[0]),
    /independent verifier must be distinct/,
  );
});

test('CLI emits an explicit zero-call report and rejects URI inputs before access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kan35-release-record-'));
  const recordPath = join(directory, 'approved.json');
  try {
    const record = approvedRecord();
    const expectedDigest = validate(record).canonicalSha256;
    writeFileSync(recordPath, JSON.stringify(record), 'utf8');
    const accepted = spawnSync(
      process.execPath,
      [
        validatorPath,
        '--record',
        recordPath,
        '--mode',
        'approved',
        '--now',
        NOW.toISOString(),
        '--expected-record-sha256',
        expectedDigest,
        '--json',
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(accepted.status, 0, accepted.stderr);
    const report = JSON.parse(accepted.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.externalCallsMade, 0);
    assert.equal(report.awsCallsMade, 0);
    assert.equal(report.registryCallsMade, 0);
    assert.equal(report.resourcesCreated, 0);
    assert.equal(report.binding.parameters.ApplicationVersion, 'a'.repeat(40));

    const rejected = spawnSync(
      process.execPath,
      [validatorPath, '--record', 'https://example.invalid/release.json', '--mode', 'approved'],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /local filesystem path, not a URI/);
    assert.match(rejected.stderr, /External calls made: 0/);

    const rejectedPrior = spawnSync(
      process.execPath,
      [
        validatorPath,
        '--record',
        recordPath,
        '--prior-record',
        'https://example.invalid/prior.json',
        '--mode',
        'approved',
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(rejectedPrior.status, 2);
    assert.match(rejectedPrior.stderr, /--prior-record must be a local filesystem path/);
    assert.match(rejectedPrior.stderr, /External calls made: 0/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
