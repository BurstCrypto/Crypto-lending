import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  assertUnambiguousJson,
  canonicalizeNonproductionRehearsalRecord,
  REHEARSAL_STEP_ORDER,
  validateNonproductionRehearsalRecord,
} from './validate-nonproduction-rehearsal-record.mjs';

const ACCOUNT = '111122223333';
const REGION = 'us-west-2';
const ENVIRONMENT = 'staging-kan234';
const STACK_NAME = 'crypto-lending-staging-kan234';
const SOURCE = 'a'.repeat(40);
const PRIOR_SOURCE = 'b'.repeat(40);
const API_DIGEST = 'c'.repeat(64);
const WEB_DIGEST = 'd'.repeat(64);
const WORKER_DIGEST = 'e'.repeat(64);
const API_IMAGE = `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/crypto-lending-api@sha256:${API_DIGEST}`;
const WEB_IMAGE = `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/crypto-lending-web@sha256:${WEB_DIGEST}`;
const WORKER_IMAGE = `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/crypto-lending-worker@sha256:${WORKER_DIGEST}`;
const STACK_ID = `arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK_NAME}/11111111-2222-3333-4444-555555555555`;
const MESSAGE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NOW = new Date('2026-08-20T12:00:00Z');

const schema = JSON.parse(
  readFileSync(join(import.meta.dirname, 'nonproduction-rehearsal-record.schema.json'), 'utf8'),
);
const example = JSON.parse(
  readFileSync(join(import.meta.dirname, 'nonproduction-rehearsal-record.example.json'), 'utf8'),
);
const validateSchema = new Ajv2020({
  strict: true,
  allErrors: true,
  validateFormats: false,
}).compile(schema);

function digest(value) {
  return createHash('sha256')
    .update(canonicalizeNonproductionRehearsalRecord(value), 'utf8')
    .digest('hex');
}

function image(repository, character) {
  return `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${repository}@sha256:${character.repeat(64)}`;
}

function releaseRecord({ prior = false } = {}) {
  const sourceRevision = prior ? PRIOR_SOURCE : SOURCE;
  return {
    schemaVersion: 2,
    artifactType: 'KAN_35_RELEASE_DEPLOYMENT_CONTROL',
    status: 'APPROVED',
    recordId: prior ? 'KAN-35:prior-release' : 'KAN-35:target-release',
    approvedAt: '2026-08-20T08:00:00Z',
    expiresAt: '2026-08-21T12:00:00Z',
    action: 'DEPLOY',
    templateSha256: '1'.repeat(64),
    aws: { accountId: ACCOUNT, region: REGION },
    target: {
      environmentName: ENVIRONMENT,
      stackName: STACK_NAME,
      changeSetName: prior ? 'kan234-prior-deploy' : 'kan234-zero-create',
      changeSetType: prior ? 'UPDATE' : 'CREATE',
    },
    artifact: {
      sourceRevision,
      apiImageUri: prior ? image('crypto-lending-api', '2') : API_IMAGE,
      webImageUri: prior ? image('crypto-lending-web', '3') : WEB_IMAGE,
      workerImageUri: prior ? image('crypto-lending-worker', '4') : WORKER_IMAGE,
      buildEvidenceSha256: '5'.repeat(64),
      provenanceReference: prior ? 'evidence:prior-build' : 'evidence:target-build',
    },
    parameters: {
      ApiDesiredCount: prior ? '1' : '0',
      WebDesiredCount: prior ? '1' : '0',
      WorkerDesiredCount: prior ? '1' : '0',
    },
    gates: {
      continuousIntegration: 'PASS',
      unitTests: 'PASS',
      integrationTests: 'PASS',
      migrationValidation: 'PASS',
      reproducibleBuild: 'PASS',
      artifactVersioning: 'PASS',
    },
    independentVerification: { decision: 'APPROVED' },
  };
}

function billingRecord() {
  return {
    schemaVersion: 1,
    status: 'APPROVED',
    recordId: 'KAN-229:staging-budget',
    expiresAt: '2026-08-21T12:00:00Z',
    aws: { accountId: ACCOUNT, applicationRegion: REGION },
    environment: { name: ENVIRONMENT },
    independentVerification: { decision: 'APPROVED' },
  };
}

function evidenceDigest(name) {
  return createHash('sha256').update(`KAN-234:${name}`).digest('hex');
}

function localRecord() {
  const current = releaseRecord();
  const prior = releaseRecord({ prior: true });
  const stepTimes = [
    ['10:00:00', '10:02:00'],
    ['10:03:00', '10:05:00'],
    ['10:06:00', '10:08:00'],
    ['10:09:00', '10:12:00'],
    ['10:13:00', '10:16:00'],
    ['10:17:00', '10:20:00'],
    ['10:21:00', '10:24:00'],
    ['10:25:00', '10:28:00'],
    ['10:29:00', '10:32:00'],
  ];
  const steps = Object.fromEntries(
    REHEARSAL_STEP_ORDER.map((name, index) => [
      name,
      {
        sequence: index + 1,
        scope: 'LOCAL_FIXTURE_ONLY',
        result: 'DRY_PASS',
        executionId: `KAN-234:dry:${index + 1}`,
        ownerRole: 'release-rehearsal-owner',
        startedAt: `2026-08-20T${stepTimes[index][0]}Z`,
        completedAt: `2026-08-20T${stepTimes[index][1]}Z`,
        expiresAt: '2026-08-21T12:00:00Z',
        evidenceReference: `evidence:KAN-234/dry-${index + 1}`,
        evidenceSha256: evidenceDigest(`step-${index + 1}`),
      },
    ]),
  );
  const taskPrefix = `arn:aws:ecs:${REGION}:${ACCOUNT}`;
  const loadBalancerPrefix = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT}`;
  const record = {
    schemaVersion: 1,
    artifactType: 'KAN_234_NONPRODUCTION_REHEARSAL_EVIDENCE',
    stage: 'LOCAL_DRY_REHEARSAL',
    overallResult: 'DRY_PASS',
    recordId: 'KAN-234:local-dry-rehearsal-v1',
    startedAt: '2026-08-20T09:59:00Z',
    completedAt: '2026-08-20T10:33:00Z',
    binding: {
      ticket: 'KAN-234',
      environmentName: ENVIRONMENT,
      accountId: ACCOUNT,
      region: REGION,
      stackId: STACK_ID,
      sourceRevision: SOURCE,
      priorSourceRevision: PRIOR_SOURCE,
      apiImageUri: API_IMAGE,
      webImageUri: WEB_IMAGE,
      workerImageUri: WORKER_IMAGE,
      releaseControlRecordSha256: digest(current),
      priorReleaseControlRecordSha256: digest(prior),
      applicationTemplateSha256: '1'.repeat(64),
      billingControlRecordSha256: 'NOT_RUN',
    },
    executionBoundary: {
      mode: 'FILESYSTEM_ONLY',
      cloudActions: 'PROHIBITED_ZERO',
      networkActions: 'PROHIBITED_ZERO',
      dnsChanges: 'PROHIBITED_ZERO',
      registryWrites: 'PROHIBITED_ZERO',
      hostedCiRuns: 'PROHIBITED_ZERO',
      paidOperations: 'PROHIBITED_ZERO',
    },
    authority: {
      executionAuthorizationReference: 'NOT_APPROVED',
      costAuthorizationReference: 'NOT_APPROVED',
      operatorRole: 'NOT_APPROVED',
      independentVerifierRole: 'NOT_APPROVED',
      windowStartsAt: 'NOT_RUN',
      windowEndsAt: 'NOT_RUN',
    },
    steps,
    observations: {
      release: {
        zeroCountCreateChangeSetId: 'kan234-zero-create',
        zeroCountCreateChangeSetArn: `arn:aws:cloudformation:${REGION}:${ACCOUNT}:changeSet/kan234-zero-create/11111111-2222-3333-4444-555555555555`,
        zeroCountCreateChangeSetType: 'CREATE',
        zeroCountCreateResult: 'DRY_PASS',
        zeroDesiredCountsVerified: 'DRY_PASS',
        migrationTaskDefinitionSha256: '6'.repeat(64),
        migrationTaskDefinitionArn: `${taskPrefix}:task-definition/crypto-lending-${ENVIRONMENT}-database-migration:1`,
        migrationImageDigest: API_DIGEST,
        migrationApplyTaskExecutionId: '1'.repeat(32),
        migrationApplyTaskArn: `${taskPrefix}:task/crypto-lending-${ENVIRONMENT}/${'1'.repeat(32)}`,
        migrationApplyCommand: 'node dist/infrastructure/database/migration.cli.js --production up',
        migrationApplyExitCode: 0,
        migrationApplyResult: 'DRY_PASS',
        migrationVerifyTaskExecutionId: '2'.repeat(32),
        migrationVerifyTaskArn: `${taskPrefix}:task/crypto-lending-${ENVIRONMENT}/${'2'.repeat(32)}`,
        migrationVerifyCommand:
          'node dist/infrastructure/database/migration.cli.js --production verify',
        migrationVerifyExitCode: 0,
        migrationVerifyResult: 'DRY_PASS',
        serviceActivationChangeSetId: 'kan234-service-activation',
        serviceActivationChangeSetArn: `arn:aws:cloudformation:${REGION}:${ACCOUNT}:changeSet/kan234-service-activation/66666666-7777-8888-9999-000000000000`,
        serviceActivationChangeSetType: 'UPDATE',
        serviceActivationResult: 'DRY_PASS',
        activatedApiDesiredCount: '1',
        activatedWebDesiredCount: '1',
        activatedWorkerDesiredCount: '1',
        deployedSourceRevision: SOURCE,
        rollbackSourceRevision: PRIOR_SOURCE,
        priorArtifactManifestSha256: digest(prior.artifact),
        databaseCompatibility: 'BACKWARD_COMPATIBLE',
        rollbackDataIntegrityResult: 'DRY_PASS',
        rollbackResult: 'DRY_PASS',
      },
      dependencies: {
        database: 'DRY_PASS',
        cache: 'DRY_PASS',
        queue: 'DRY_PASS',
        privateNetwork: 'DRY_PASS',
        artifactAvailability: 'DRY_PASS',
      },
      runtime: {
        apiTaskDefinitionArn: `${taskPrefix}:task-definition/crypto-lending-${ENVIRONMENT}-api:1`,
        webTaskDefinitionArn: `${taskPrefix}:task-definition/crypto-lending-${ENVIRONMENT}-web:1`,
        workerTaskDefinitionArn: `${taskPrefix}:task-definition/crypto-lending-${ENVIRONMENT}-outbox-worker:1`,
        apiTaskArn: `${taskPrefix}:task/crypto-lending-${ENVIRONMENT}/${'3'.repeat(32)}`,
        webTaskArn: `${taskPrefix}:task/crypto-lending-${ENVIRONMENT}/${'4'.repeat(32)}`,
        workerTaskArn: `${taskPrefix}:task/crypto-lending-${ENVIRONMENT}/${'5'.repeat(32)}`,
        applicationLoadBalancerArn: `${loadBalancerPrefix}:loadbalancer/app/crypto-lending/${'6'.repeat(16)}`,
        apiTargetGroupArn: `${loadBalancerPrefix}:targetgroup/crypto-api/${'7'.repeat(16)}`,
        webTargetGroupArn: `${loadBalancerPrefix}:targetgroup/crypto-web/${'8'.repeat(16)}`,
        apiTargetHealthId: '10.42.10.21:3001',
        webTargetHealthId: '10.42.11.22:3000',
        queueArn: `arn:aws:sqs:${REGION}:${ACCOUNT}:crypto-lending-${ENVIRONMENT}-jobs`,
        queueKmsKeyArn: `arn:aws:kms:${REGION}:${ACCOUNT}:key/11111111-2222-3333-4444-555555555555`,
        outboxMessageId: MESSAGE_ID,
        workerFailureInjectionId: 'KAN-234:publisher-stop-before-send',
        workerReplacementTaskArn: `${taskPrefix}:task/crypto-lending-${ENVIRONMENT}/${'9'.repeat(32)}`,
        workerRecoveryResult: 'DRY_PASS',
      },
      healthBeforeRollback: Object.fromEntries(
        [
          'ecsApiService',
          'ecsWebService',
          'ecsWorkerService',
          'applicationLoadBalancer',
          'api',
          'web',
          'worker',
          'privateNetwork',
        ].map((key) => [key, 'DRY_PASS']),
      ),
      healthAfterRollback: Object.fromEntries(
        [
          'ecsApiService',
          'ecsWebService',
          'ecsWorkerService',
          'applicationLoadBalancer',
          'api',
          'web',
          'worker',
          'privateNetwork',
        ].map((key) => [key, 'DRY_PASS']),
      ),
      outbox: {
        eventReference: `outbox-message:${MESSAGE_ID}`,
        enqueuedCount: '1',
        publishedCount: '1',
        markedPublishedCount: '1',
        recoveredPendingCount: '1',
        duplicatePublicationCount: '0',
        duplicateSideEffectCount: '0',
        deadLetterCount: '0',
        maximumObservedLagSeconds: '4',
        allowedMaximumLagSeconds: '30',
      },
      cleanup: {
        inventoryBeforeSha256: '7'.repeat(64),
        inventoryAfterSha256: '8'.repeat(64),
        temporaryResourcesCreated: '3',
        temporaryResourcesRemoved: '3',
        unexpectedResidualResourceCount: '0',
        credentialArtifactsRemoved: 'DRY_PASS',
        retainedResources: [],
      },
      costInventory: {
        inventoryBeforeSha256: '7'.repeat(64),
        inventoryAfterCleanupSha256: '8'.repeat(64),
        maximumAuthorizedIncrementUsd: '0.00',
        observedIncrementUsd: '0.00',
        projectedRecurringIncrementUsd: '0.00',
        unexpectedBillableResourceCount: '0',
        result: 'DRY_PASS',
      },
    },
    findings: {
      blockerCount: '0',
      unresolvedHighSeverityCount: '0',
      acceptedRiskCount: '0',
      ownerRole: 'release-findings-owner',
      expiresAt: '2026-08-21T12:00:00Z',
      evidenceReference: 'evidence:KAN-234/findings-v1',
      evidenceSha256: evidenceDigest('findings'),
    },
  };
  return { record, current, prior };
}

function optionsFor(record, current, prior, overrides = {}) {
  return {
    mode: 'local-dry-run',
    now: NOW,
    expectedEnvironment: record.binding.environmentName,
    expectedAccount: record.binding.accountId,
    expectedRegion: record.binding.region,
    expectedStackId: record.binding.stackId,
    expectedSourceRevision: record.binding.sourceRevision,
    expectedPriorSourceRevision: record.binding.priorSourceRevision,
    expectedApiImageUri: record.binding.apiImageUri,
    expectedWebImageUri: record.binding.webImageUri,
    expectedWorkerImageUri: record.binding.workerImageUri,
    expectedReleaseControlRecordSha256: record.binding.releaseControlRecordSha256,
    expectedPriorReleaseControlRecordSha256: record.binding.priorReleaseControlRecordSha256,
    expectedApplicationTemplateSha256: record.binding.applicationTemplateSha256,
    expectedPriorArtifactManifestSha256: record.observations.release.priorArtifactManifestSha256,
    expectedMigrationTaskDefinitionSha256:
      record.observations.release.migrationTaskDefinitionSha256,
    releaseRecord: current,
    priorReleaseRecord: prior,
    ...overrides,
  };
}

function liveFixture() {
  const fixture = localRecord();
  const billing = billingRecord();
  fixture.record.stage = 'LIVE_ACCEPTANCE';
  fixture.record.overallResult = 'LIVE_PASS';
  fixture.record.binding.billingControlRecordSha256 = digest(billing);
  fixture.record.executionBoundary = {
    mode: 'APPROVED_LIVE_NONPRODUCTION',
    cloudActions: 'AUTHORIZED_EVIDENCED',
    networkActions: 'AUTHORIZED_EVIDENCED',
    dnsChanges: 'PROHIBITED_ZERO',
    registryWrites: 'PROHIBITED_ZERO',
    hostedCiRuns: 'PROHIBITED_ZERO',
    paidOperations: 'AUTHORIZED_EVIDENCED',
  };
  fixture.record.authority = {
    executionAuthorizationReference: 'approval:KAN-234/execution-v1',
    costAuthorizationReference: 'approval:KAN-234/cost-v1',
    operatorRole: 'release-rehearsal-operator',
    independentVerifierRole: 'release-evidence-verifier',
    windowStartsAt: '2026-08-20T09:55:00Z',
    windowEndsAt: '2026-08-20T11:00:00Z',
  };
  for (const step of Object.values(fixture.record.steps)) {
    step.scope = 'LIVE_NONPRODUCTION';
    step.result = 'LIVE_PASS';
  }
  const replaceDryPass = (value) => {
    if (Array.isArray(value)) return value.map(replaceDryPass);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, replaceDryPass(entry)]),
      );
    }
    return value === 'DRY_PASS' ? 'LIVE_PASS' : value;
  };
  fixture.record.observations = replaceDryPass(fixture.record.observations);
  return { ...fixture, billing };
}

test('schema accepts the exact inert template and example validation makes no live claim', () => {
  assert.equal(validateSchema(example), true, JSON.stringify(validateSchema.errors));
  const result = validateNonproductionRehearsalRecord(example, { mode: 'example' });
  assert.equal(result.ok, true);
  assert.equal(result.liveAcceptanceSatisfied, false);
  assert.equal(result.localDryRehearsalSatisfied, false);
});

test('example mode rejects any premature live or dry evidence', () => {
  const record = structuredClone(example);
  record.overallResult = 'DRY_PASS';
  const result = validateNonproductionRehearsalRecord(record, { mode: 'example' });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('exact inert')));
});

test('accepts a complete filesystem-only dry rehearsal without live acceptance', () => {
  const { record, current, prior } = localRecord();
  assert.equal(validateSchema(record), true, JSON.stringify(validateSchema.errors));
  const result = validateNonproductionRehearsalRecord(record, optionsFor(record, current, prior));
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.localDryRehearsalSatisfied, true);
  assert.equal(result.liveAcceptanceSatisfied, false);
});

test('fails live acceptance closed even when the current draft record is internally consistent', () => {
  const { record, current, prior, billing } = liveFixture();
  const result = validateNonproductionRehearsalRecord(
    record,
    optionsFor(record, current, prior, {
      mode: 'live-acceptance',
      billingControlRecord: billing,
      expectedBillingControlRecordSha256: record.binding.billingControlRecordSha256,
      expectedRecordSha256: digest(record),
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.liveAcceptanceSatisfied, false);
  assert(result.errors.some((error) => error.includes('Live acceptance is NOT_IMPLEMENTED')));
});

test('fails closed when service activation precedes migration verification or verify fails', () => {
  const first = localRecord();
  first.record.steps.serviceActivation.startedAt = '2026-08-20T10:11:00Z';
  let result = validateNonproductionRehearsalRecord(
    first.record,
    optionsFor(first.record, first.current, first.prior),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('strictly after')));

  const second = localRecord();
  second.record.observations.release.migrationVerifyResult = 'FAIL';
  result = validateNonproductionRehearsalRecord(
    second.record,
    optionsFor(second.record, second.current, second.prior),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('migrationVerifyResult')));
});

test('requires separate exact compiled migration apply and verify tasks before UPDATE', () => {
  for (const mutate of [
    (record) => (record.observations.release.migrationApplyCommand = 'npm run db:migrate'),
    (record) =>
      (record.observations.release.migrationVerifyTaskArn =
        record.observations.release.migrationApplyTaskArn),
    (record) => (record.observations.release.migrationVerifyExitCode = 1),
    (record) => (record.observations.release.serviceActivationChangeSetType = 'CREATE'),
  ]) {
    const fixture = localRecord();
    mutate(fixture.record);
    const result = validateNonproductionRehearsalRecord(
      fixture.record,
      optionsFor(fixture.record, fixture.current, fixture.prior),
    );
    assert.equal(result.ok, false);
  }
});

test('missing rollback, outbox, cleanup, cost, or findings evidence blocks acceptance', () => {
  for (const remove of [
    (record) => delete record.observations.release.rollbackDataIntegrityResult,
    (record) => delete record.observations.outbox.publishedCount,
    (record) => delete record.observations.cleanup.inventoryAfterSha256,
    (record) => delete record.observations.costInventory.result,
    (record) => delete record.findings.evidenceSha256,
  ]) {
    const fixture = localRecord();
    remove(fixture.record);
    const result = validateNonproductionRehearsalRecord(
      fixture.record,
      optionsFor(fixture.record, fixture.current, fixture.prior),
    );
    assert.equal(result.ok, false);
  }
});

test('binds account, Region, stack, change sets, exact repositories, and ECS families', () => {
  for (const mutate of [
    (record) => (record.binding.apiImageUri = record.binding.webImageUri.replace('-web@', '-api@')),
    (record) =>
      (record.observations.runtime.queueArn = `arn:aws:sqs:${REGION}:${ACCOUNT}:crypto-lending-${ENVIRONMENT}-jobs.fifo`),
    (record) =>
      (record.observations.runtime.workerTaskDefinitionArn = `arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/crypto-lending-${ENVIRONMENT}-worker:1`),
    (record) =>
      (record.observations.release.serviceActivationChangeSetArn = `arn:aws:cloudformation:us-east-1:${ACCOUNT}:changeSet/kan234-service-activation/66666666-7777-8888-9999-000000000000`),
  ]) {
    const fixture = localRecord();
    mutate(fixture.record);
    const result = validateNonproductionRehearsalRecord(
      fixture.record,
      optionsFor(fixture.record, fixture.current, fixture.prior),
    );
    assert.equal(result.ok, false);
  }
});

test('requires one encrypted publisher recovery with no duplicate publication or DLQ result', () => {
  for (const [key, value] of [
    ['enqueuedCount', '2'],
    ['publishedCount', '0'],
    ['markedPublishedCount', '0'],
    ['recoveredPendingCount', '0'],
    ['duplicatePublicationCount', '1'],
    ['duplicateSideEffectCount', '1'],
    ['deadLetterCount', '1'],
  ]) {
    const fixture = localRecord();
    fixture.record.observations.outbox[key] = value;
    const result = validateNonproductionRehearsalRecord(
      fixture.record,
      optionsFor(fixture.record, fixture.current, fixture.prior),
    );
    assert.equal(result.ok, false, key);
  }
});

test('binds both release records and zero-count CREATE inputs', () => {
  const tampered = localRecord();
  tampered.current.parameters.ApiDesiredCount = '1';
  let result = validateNonproductionRehearsalRecord(
    tampered.record,
    optionsFor(tampered.record, tampered.current, tampered.prior),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('zero desired count')));

  const prior = localRecord();
  prior.prior.artifact.sourceRevision = 'f'.repeat(40);
  result = validateNonproductionRehearsalRecord(
    prior.record,
    optionsFor(prior.record, prior.current, prior.prior),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('priorReleaseRecord')));
});

test('rejects failed health, stale evidence, operator/verifier overlap, and open findings', () => {
  const health = localRecord();
  health.record.observations.healthAfterRollback.worker = 'FAIL';
  assert.equal(
    validateNonproductionRehearsalRecord(
      health.record,
      optionsFor(health.record, health.current, health.prior),
    ).ok,
    false,
  );

  const stale = localRecord();
  stale.record.steps.cleanupAndCostInventory.expiresAt = '2026-08-20T11:00:00Z';
  assert.equal(
    validateNonproductionRehearsalRecord(
      stale.record,
      optionsFor(stale.record, stale.current, stale.prior),
    ).ok,
    false,
  );

  const live = liveFixture();
  live.record.authority.independentVerifierRole = live.record.authority.operatorRole;
  assert.equal(
    validateNonproductionRehearsalRecord(
      live.record,
      optionsFor(live.record, live.current, live.prior, {
        mode: 'live-acceptance',
        billingControlRecord: live.billing,
        expectedBillingControlRecordSha256: live.record.binding.billingControlRecordSha256,
        expectedRecordSha256: digest(live.record),
      }),
    ).ok,
    false,
  );

  const findings = localRecord();
  findings.record.findings.blockerCount = '1';
  assert.equal(
    validateNonproductionRehearsalRecord(
      findings.record,
      optionsFor(findings.record, findings.current, findings.prior),
    ).ok,
    false,
  );
});

test('requires complete cleanup and reconciles retained-resource recurring cost', () => {
  const fixture = liveFixture();
  fixture.record.observations.cleanup.retainedResources.push({
    resourceArn: `arn:aws:rds:${REGION}:${ACCOUNT}:db:crypto-lending-${ENVIRONMENT}`,
    resourceType: 'AWS::RDS::DBInstance',
    ownerRole: 'database-retention-owner',
    expiresAt: '2026-08-21T12:00:00Z',
    projectedMonthlyCostUsd: '12.50',
    evidenceSha256: evidenceDigest('retained-db'),
  });
  fixture.record.observations.costInventory.projectedRecurringIncrementUsd = '12.50';
  const options = optionsFor(fixture.record, fixture.current, fixture.prior, {
    mode: 'live-acceptance',
    billingControlRecord: fixture.billing,
    expectedBillingControlRecordSha256: fixture.record.binding.billingControlRecordSha256,
    expectedRecordSha256: digest(fixture.record),
  });
  const reconciled = validateNonproductionRehearsalRecord(fixture.record, options);
  assert.equal(reconciled.ok, false);
  assert(reconciled.errors.some((error) => error.includes('NOT_IMPLEMENTED')));
  assert.equal(
    reconciled.errors.some((error) => error.includes('retained-resource')),
    false,
  );

  fixture.record.observations.costInventory.projectedRecurringIncrementUsd = '0.00';
  options.expectedRecordSha256 = digest(fixture.record);
  const mismatch = validateNonproductionRehearsalRecord(fixture.record, options);
  assert.equal(mismatch.ok, false);
  assert(mismatch.errors.some((error) => error.includes('retained-resource')));
});

test('rejects ambiguous JSON and secret-shaped or extra data', () => {
  assert.throws(() => assertUnambiguousJson('{"stage":"EXAMPLE","stage":"LIVE_ACCEPTANCE"}'), {
    message: /Duplicate JSON object key/,
  });
  const fixture = localRecord();
  fixture.record.credential = 'AKIA1234567890ABCDEF';
  const result = validateNonproductionRehearsalRecord(
    fixture.record,
    optionsFor(fixture.record, fixture.current, fixture.prior),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes('secret-shaped')));
  assert(result.errors.some((error) => error.includes('additional')));
});

test('CLI validates only the inert local file and reports zero external and paid operations', () => {
  const validatorPath = join(import.meta.dirname, 'validate-nonproduction-rehearsal-record.mjs');
  const examplePath = join(import.meta.dirname, 'nonproduction-rehearsal-record.example.json');
  const result = spawnSync(
    process.execPath,
    [validatorPath, '--record', examplePath, '--mode', 'example'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Live acceptance satisfied: false/);
  assert.match(result.stdout, /External calls made: 0/);
  assert.match(result.stdout, /Paid operations made: 0/);

  const forgedClock = spawnSync(
    process.execPath,
    [
      validatorPath,
      '--record',
      examplePath,
      '--mode',
      'live-acceptance',
      '--now',
      '2026-08-20T12:00:00Z',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(forgedClock.status, 2);
  assert.match(forgedClock.stderr, /--now is test-only and is forbidden/);
  assert.match(forgedClock.stderr, /External calls made: 0/);
});

test('validator source contains no network, provider, subprocess, dynamic-code, or deployment APIs', () => {
  const source = readFileSync(
    join(import.meta.dirname, 'validate-nonproduction-rehearsal-record.mjs'),
    'utf8',
  );
  for (const forbidden of [
    "from 'node:http'",
    "from 'node:https'",
    "from 'node:dns'",
    "from 'node:net'",
    "from 'node:tls'",
    "from 'node:child_process'",
    '@aws-sdk/',
    'fetch(',
    'eval(',
    'Function(',
    'spawn(',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
