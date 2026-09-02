import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  evaluateProductionPreflight,
  formatProductionPreflightReport,
  inspectAuthenticationDeploymentTemplate,
  loadRepositoryProductionPreflightInput,
  parseProductionPreflightArguments,
  productionDirectoryConfigurationSha256,
  productionPreflightExitCode,
  type ProductionPreflightInput,
} from './production-go-live-preflight';

const SOURCE_REVISION = 'a'.repeat(40);

function platformEntry(
  id: string,
  integrationStatus: 'PLANNED' | 'LIVE_READ_ONLY' | 'TRANSACTION_ENABLED',
): Record<string, unknown> {
  const live = integrationStatus !== 'PLANNED';
  return {
    id,
    name: `Provider ${id}`,
    protocol: `Protocol ${id}`,
    ecosystem: 'EVM',
    networks: [{ id: 'eip155:8453', name: 'Base' }],
    integrationStatus,
    dataStatus: live ? 'LIVE' : 'NOT_CONNECTED',
    accessStatus: live ? 'AVAILABLE' : 'UNAVAILABLE',
    riskStatus: live ? 'ASSESSED' : 'NOT_ASSESSED',
    supportedActions: integrationStatus === 'TRANSACTION_ENABLED' ? ['SUPPLY', 'WITHDRAW'] : [],
  };
}

function platformDirectory(
  status: 'PLANNED' | 'LIVE_READ_ONLY' | 'TRANSACTION_ENABLED',
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    use: 'MAINNET_PLATFORM_DIRECTORY',
    mayAuthorizeFinancialAction: status === 'TRANSACTION_ENABLED',
    minimumProviderTarget: 10,
    providers: Array.from({ length: 10 }, (_, index) => platformEntry(`provider-${index}`, status)),
  };
}

function defaultProviderIds(): string[] {
  return Array.from({ length: 10 }, (_, index) => `provider-${index}`);
}

function readEvidence(
  directory: unknown,
  providerIds: readonly string[] = defaultProviderIds(),
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    artifactType: 'PRODUCTION_LIVE_READ_EVIDENCE_INDEX',
    status: 'ACCEPTED',
    sourceRevision: SOURCE_REVISION,
    directoryConfigurationSha256: productionDirectoryConfigurationSha256(directory),
    providerIds: [...providerIds],
    adapterBindings: 'COMPLETE',
    compositionEvidence: 'PASS',
  };
}

function writeEvidence(
  directory: unknown,
  providerIds: readonly string[] = defaultProviderIds(),
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    artifactType: 'PRODUCTION_MAINNET_WRITE_EVIDENCE_INDEX',
    status: 'ACCEPTED',
    sourceRevision: SOURCE_REVISION,
    directoryConfigurationSha256: productionDirectoryConfigurationSha256(directory),
    providerIds: [...providerIds],
    actionBindings: 'COMPLETE',
    simulationEvidence: 'PASS',
    reconciliationEvidence: 'PASS',
    independentSecurityReview: 'ACCEPTED',
  };
}

function completeAuthEnvironmentNames(): Set<string> {
  return new Set([
    'AUTH_MODE',
    'OIDC_PROVIDER_KEY',
    'OIDC_ISSUER_URL',
    'OIDC_AUTHORIZATION_ENDPOINT',
    'OIDC_TOKEN_ENDPOINT',
    'OIDC_JWKS_URI',
    'OIDC_CLIENT_ID',
    'OIDC_AUDIENCE',
    'OIDC_REQUIRED_TOKEN_USE',
    'OIDC_END_SESSION_ENDPOINT',
    'OIDC_POST_LOGOUT_REDIRECT_URI',
    'OIDC_SIGNING_ALGORITHM',
    'OIDC_TOKEN_AUTH_METHOD',
    'AUTH_PUBLIC_ORIGIN',
    'OIDC_REDIRECT_URI',
    'OIDC_HTTP_TIMEOUT_MS',
    'OIDC_TOKEN_RESPONSE_MAX_BYTES',
    'OIDC_JWKS_RESPONSE_MAX_BYTES',
    'OIDC_JWKS_CACHE_TTL_SECONDS',
    'OIDC_CLOCK_TOLERANCE_SECONDS',
    'OIDC_MAX_ID_TOKEN_AGE_SECONDS',
    'AUTH_PREAUTH_TTL_SECONDS',
    'AUTH_SESSION_IDLE_TTL_SECONDS',
    'AUTH_SESSION_ABSOLUTE_TTL_SECONDS',
    'AUTH_PREAUTH_SEAL_KEY_ID',
    'AUTH_IDENTITY_HMAC_KEY_ID',
    'AUTH_SESSION_HMAC_KEY_ID',
    'AUTH_CSRF_HMAC_KEY_ID',
    'AUTH_CLIENT_ADDRESS_MODE',
    'AUTH_TRUSTED_PROXY_CIDRS',
    'WALLET_REGISTRATION_MODE',
    'WALLET_REGISTRATION_REGISTRY_ENVIRONMENT',
    'WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS',
    'WALLET_IDENTITY_HMAC_KEY_VERSION',
    'WALLET_CHALLENGE_HMAC_KEY_VERSION',
    'WALLET_METADATA_SEAL_KEY_VERSION',
  ]);
}

function completeInput(directory: unknown): ProductionPreflightInput {
  return {
    authentication: {
      inspected: true,
      syntaxValid: true,
      apiEnvironmentNames: completeAuthEnvironmentNames(),
      apiSecretNames: new Set([
        'AUTH_PREAUTH_SEAL_KEY',
        'AUTH_IDENTITY_HMAC_KEY',
        'AUTH_SESSION_HMAC_KEY',
        'AUTH_CSRF_HMAC_KEY',
        'WALLET_IDENTITY_HMAC_KEY',
        'WALLET_CHALLENGE_HMAC_KEY',
        'WALLET_METADATA_SEAL_KEY',
      ]),
      webEnvironmentNames: new Set(['AUTH_PUBLIC_ORIGIN']),
      deployedEvidenceAccepted: true,
    },
    egress: {
      localValidationPassed: true,
      status: 'ACCEPTED',
      currentMode: 'APPROVED_DESTINATIONS_ONLY',
      liveEvidenceComplete: true,
    },
    rpcProviders: {
      localValidationPassed: true,
      externalStatus: 'APPROVED',
      runtimeStatus: 'APPROVED',
      approvalBoundaryApproved: true,
      liveEvidenceAccepted: true,
    },
    platforms: {
      directory,
      sourceRevision: SOURCE_REVISION,
      liveReadEvidenceIndex: readEvidence(directory),
      mainnetWriteEvidenceIndex: null,
    },
  };
}

test('current repository is a bootstrap blocker audit and exits nonzero for both targets', () => {
  const repositoryRoot = resolve(__dirname, '..');
  const input = loadRepositoryProductionPreflightInput(repositoryRoot);
  const readOnly = evaluateProductionPreflight(input, 'read-only');
  const writes = evaluateProductionPreflight(input, 'mainnet-write');

  assert.equal(readOnly.auditMode, 'BOOTSTRAP_BLOCKER_AUDIT');
  assert.equal(input.platforms.sourceRevision, null);
  assert.equal(readOnly.selectedTargetReadiness, 'BLOCKED');
  assert.equal(writes.selectedTargetReadiness, 'BLOCKED');
  assert.deepEqual(readOnly.providerCounts, {
    minimumTarget: 10,
    directory: 11,
    planned: 11,
    liveReadEvidenceBound: 0,
    transactionEvidenceBound: 0,
  });
  assert.equal(readOnly.checks.find(({ id }) => id === 'EXTERNAL_EGRESS')?.localValidation, 'PASS');
  assert.equal(readOnly.checks.find(({ id }) => id === 'RPC_INDEXING')?.localValidation, 'PASS');
  assert.ok(
    readOnly.checks
      .find(({ id }) => id === 'PLATFORM_LIVE_READS')
      ?.blockerIds.includes('LIVE_READ_EVIDENCE_INDEX_MISSING'),
  );
  assert.ok(
    writes.checks
      .find(({ id }) => id === 'MAINNET_WRITES')
      ?.blockerIds.includes('MAINNET_WRITE_EVIDENCE_INDEX_MISSING'),
  );
  assert.equal(productionPreflightExitCode(readOnly), 1);
  assert.equal(productionPreflightExitCode(writes), 1);
});

test('structurally valid inert egress remains launch-blocked', () => {
  const directory = platformDirectory('LIVE_READ_ONLY');
  const input = completeInput(directory);
  const report = evaluateProductionPreflight({
    ...input,
    egress: {
      localValidationPassed: true,
      status: 'NOT_APPROVED',
      currentMode: 'NO_EXTERNAL_EGRESS',
      liveEvidenceComplete: false,
    },
  });
  const egress = report.checks.find(({ id }) => id === 'EXTERNAL_EGRESS');

  assert.equal(egress?.localValidation, 'PASS');
  assert.equal(egress?.launchReadiness, 'BLOCKED');
  assert.deepEqual(egress?.blockerIds, [
    'EGRESS_POLICY_NOT_ACCEPTED',
    'EXTERNAL_EGRESS_DISABLED',
    'EGRESS_LIVE_EVIDENCE_INCOMPLETE',
  ]);
});

test('read-only isolation independently blocks authorization, status, and action exposure', () => {
  const authorizationFlag = platformDirectory('LIVE_READ_ONLY');
  authorizationFlag.mayAuthorizeFinancialAction = true;

  const transactionStatus = platformDirectory('TRANSACTION_ENABLED');

  const supportedAction = platformDirectory('LIVE_READ_ONLY');
  const supportedActionProviders = supportedAction.providers as Record<string, unknown>[];
  supportedActionProviders[0] = { ...supportedActionProviders[0], supportedActions: ['SUPPLY'] };

  for (const directory of [authorizationFlag, transactionStatus, supportedAction]) {
    const report = evaluateProductionPreflight(completeInput(directory), 'read-only');
    const isolation = report.checks.find(({ id }) => id === 'READ_ONLY_ISOLATION');

    assert.equal(isolation?.launchReadiness, 'BLOCKED');
    assert.ok(isolation?.blockerIds.includes('READ_ONLY_TRANSACTION_CAPABILITY_EXPOSED'));
    assert.equal(report.readiness.publicReadOnly, 'BLOCKED');
    assert.equal(productionPreflightExitCode(report), 1);
  }
});

test('strict synthetic write evidence can model a future local clear but is never approval', () => {
  const directory = platformDirectory('TRANSACTION_ENABLED');
  const input = completeInput(directory);
  input.platforms.mainnetWriteEvidenceIndex = writeEvidence(directory);
  const report = evaluateProductionPreflight(input, 'mainnet-write');

  assert.equal(report.readiness.mainnetWrites, 'LOCAL_GATES_CLEAR');
  assert.equal(productionPreflightExitCode(report), 0);
  assert.equal(report.auditMode, 'BOOTSTRAP_BLOCKER_AUDIT');
  assert.equal(report.assurance, 'LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL');
});

test('catalog status strings cannot establish live-read or write readiness without evidence', () => {
  const directory = platformDirectory('TRANSACTION_ENABLED');
  const input = completeInput(directory);
  input.platforms.liveReadEvidenceIndex = null;
  input.platforms.mainnetWriteEvidenceIndex = null;
  const report = evaluateProductionPreflight(input, 'mainnet-write');

  assert.equal(report.providerCounts.liveReadEvidenceBound, 0);
  assert.equal(report.providerCounts.transactionEvidenceBound, 0);
  assert.ok(
    report.checks
      .find(({ id }) => id === 'PLATFORM_LIVE_READS')
      ?.blockerIds.includes('LIVE_READ_EVIDENCE_INDEX_MISSING'),
  );
  assert.ok(
    report.checks
      .find(({ id }) => id === 'MAINNET_WRITES')
      ?.blockerIds.includes('MAINNET_WRITE_EVIDENCE_INDEX_MISSING'),
  );
  assert.equal(report.selectedTargetReadiness, 'BLOCKED');
});

test('an evidence index cannot promote providers that remain planned', () => {
  const directory = platformDirectory('PLANNED');
  const input = completeInput(directory);
  const report = evaluateProductionPreflight(input);
  const liveReads = report.checks.find(({ id }) => id === 'PLATFORM_LIVE_READS');

  assert.equal(liveReads?.localValidation, 'FAIL');
  assert.ok(liveReads?.blockerIds.includes('LIVE_READ_EVIDENCE_INDEX_INVALID'));
  assert.ok(liveReads?.blockerIds.includes('PLATFORM_LIVE_CAPABILITY_NOT_EXPOSED'));
  assert.equal(report.providerCounts.liveReadEvidenceBound, 0);
  assert.equal(report.selectedTargetReadiness, 'BLOCKED');
});

test('write evidence provider set must be covered by accepted live-read evidence', () => {
  const directory = platformDirectory('TRANSACTION_ENABLED');
  const providers = directory.providers as Record<string, unknown>[];
  providers.push(platformEntry('provider-10', 'TRANSACTION_ENABLED'));
  const input = completeInput(directory);
  input.platforms.liveReadEvidenceIndex = readEvidence(directory, defaultProviderIds());
  input.platforms.mainnetWriteEvidenceIndex = writeEvidence(
    directory,
    Array.from({ length: 10 }, (_, index) => `provider-${index + 1}`),
  );
  const report = evaluateProductionPreflight(input, 'mainnet-write');
  const writes = report.checks.find(({ id }) => id === 'MAINNET_WRITES');

  assert.equal(writes?.localValidation, 'PASS');
  assert.ok(
    writes?.blockerIds.includes('MAINNET_WRITE_PROVIDER_SET_NOT_COVERED_BY_LIVE_READ_EVIDENCE'),
  );
  assert.equal(writes?.launchReadiness, 'BLOCKED');
  assert.equal(report.providerCounts.liveReadEvidenceBound, 10);
  assert.equal(report.providerCounts.transactionEvidenceBound, 0);
  assert.equal(report.selectedTargetReadiness, 'BLOCKED');
});

test('evidence must bind the exact source revision and directory configuration', () => {
  const directory = platformDirectory('LIVE_READ_ONLY');
  const input = completeInput(directory);
  input.platforms.liveReadEvidenceIndex = {
    ...readEvidence(directory),
    sourceRevision: 'b'.repeat(40),
    directoryConfigurationSha256: 'c'.repeat(64),
  };
  const report = evaluateProductionPreflight(input);
  const liveReads = report.checks.find(({ id }) => id === 'PLATFORM_LIVE_READS');

  assert.equal(liveReads?.localValidation, 'FAIL');
  assert.ok(liveReads?.blockerIds.includes('LIVE_READ_EVIDENCE_REVISION_MISMATCH'));
  assert.ok(liveReads?.blockerIds.includes('LIVE_READ_EVIDENCE_DIRECTORY_BINDING_MISMATCH'));
  assert.equal(report.providerCounts.liveReadEvidenceBound, 0);
});

test('directory contract closes target, provider identity, shape, and actions', () => {
  const invalidTarget = platformDirectory('LIVE_READ_ONLY');
  invalidTarget.minimumProviderTarget = 0;
  const targetReport = evaluateProductionPreflight(completeInput(invalidTarget));
  assert.equal(
    targetReport.checks.find(({ id }) => id === 'PLATFORM_DIRECTORY')?.localValidation,
    'FAIL',
  );

  const duplicate = platformDirectory('LIVE_READ_ONLY');
  const duplicateProviders = duplicate.providers as Record<string, unknown>[];
  duplicateProviders[1] = { ...duplicateProviders[0] };
  const duplicateReport = evaluateProductionPreflight(completeInput(duplicate));
  assert.equal(
    duplicateReport.checks.find(({ id }) => id === 'PLATFORM_DIRECTORY')?.localValidation,
    'FAIL',
  );

  const invalidId = platformDirectory('LIVE_READ_ONLY');
  const invalidIdProviders = invalidId.providers as Record<string, unknown>[];
  invalidIdProviders[0] = { ...invalidIdProviders[0], id: 'Provider/0' };
  const invalidIdReport = evaluateProductionPreflight(completeInput(invalidId));
  assert.equal(
    invalidIdReport.checks.find(({ id }) => id === 'PLATFORM_DIRECTORY')?.localValidation,
    'FAIL',
  );

  const unsafeAction = platformDirectory('LIVE_READ_ONLY');
  const unsafeProviders = unsafeAction.providers as Record<string, unknown>[];
  unsafeProviders[0] = { ...unsafeProviders[0], supportedActions: ['BORROW'] };
  const actionReport = evaluateProductionPreflight(completeInput(unsafeAction));
  assert.equal(
    actionReport.checks.find(({ id }) => id === 'PLATFORM_DIRECTORY')?.localValidation,
    'FAIL',
  );

  const extraField = platformDirectory('LIVE_READ_ONLY');
  const extraProviders = extraField.providers as Record<string, unknown>[];
  extraProviders[0] = { ...extraProviders[0], executable: true };
  const shapeReport = evaluateProductionPreflight(completeInput(extraField));
  assert.equal(
    shapeReport.checks.find(({ id }) => id === 'PLATFORM_DIRECTORY')?.localValidation,
    'FAIL',
  );
});

test('auth inspection ignores comments and sidecars and rejects missing or wrong value bindings', () => {
  const inspected = inspectAuthenticationDeploymentTemplate(`
Resources:
  ApiTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      Metadata:
        - Name: OIDC_CLIENT_ID
          Value: sidecar-must-not-count
      ContainerDefinitions:
        - Name: metrics-sidecar
          Environment:
            - { Name: OIDC_CLIENT_ID, Value: sidecar-must-not-count }
          Secrets:
            - Name: AUTH_IDENTITY_HMAC_KEY
              ValueFrom: sidecar-must-not-count
        - Name: api
          Environment:
            # - { Name: OIDC_ISSUER_URL, Value: comment-must-not-count }
            - Name: AUTH_MODE
            - { Name: OIDC_PROVIDER_KEY, ValueFrom: wrong-key-must-not-count }
          Secrets:
            - Name: AUTH_PREAUTH_SEAL_KEY
              Value: plaintext-must-not-count
  WebTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      ContainerDefinitions:
        - Name: metrics-sidecar
          Environment:
            - { Name: AUTH_PUBLIC_ORIGIN, Value: sidecar-must-not-count }
        - Name: web
          Environment:
            - Name: AUTH_PUBLIC_ORIGIN
`);

  assert.equal(inspected.syntaxValid, false);
  assert.equal(inspected.apiEnvironmentNames.has('OIDC_CLIENT_ID'), false);
  assert.equal(inspected.apiEnvironmentNames.has('OIDC_ISSUER_URL'), false);
  assert.equal(inspected.apiEnvironmentNames.has('AUTH_MODE'), false);
  assert.equal(inspected.apiEnvironmentNames.has('OIDC_PROVIDER_KEY'), false);
  assert.equal(inspected.apiSecretNames.has('AUTH_PREAUTH_SEAL_KEY'), false);
  assert.equal(inspected.apiSecretNames.has('AUTH_IDENTITY_HMAC_KEY'), false);
  assert.equal(inspected.webEnvironmentNames.has('AUTH_PUBLIC_ORIGIN'), false);
});

test('auth inspection and report never disclose configuration values', () => {
  const secretCanary = 'do-not-print-secret-canary';
  const inspected = inspectAuthenticationDeploymentTemplate(`
Resources:
  ApiTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      ContainerDefinitions:
        - Name: api
          Environment:
            - { Name: AUTH_MODE, Value: ${secretCanary} }
          Secrets:
            - Name: AUTH_PREAUTH_SEAL_KEY
              ValueFrom: ${secretCanary}
  WebTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      ContainerDefinitions:
        - Name: web
          Environment:
            - { Name: AUTH_PUBLIC_ORIGIN, Value: ${secretCanary} }
`);
  const directory = platformDirectory('PLANNED');
  const input = completeInput(directory);
  const report = evaluateProductionPreflight({ ...input, authentication: inspected });
  const serialized = JSON.stringify(report);
  const text = formatProductionPreflightReport(report);

  assert.deepEqual([...inspected.apiEnvironmentNames], ['AUTH_MODE']);
  assert.deepEqual([...inspected.apiSecretNames], ['AUTH_PREAUTH_SEAL_KEY']);
  assert.equal(serialized.includes(secretCanary), false);
  assert.equal(text.includes(secretCanary), false);
  assert.deepEqual(report.safety, {
    networkCallsMade: 0,
    dnsQueriesMade: 0,
    cloudCallsMade: 0,
    providerCallsMade: 0,
    secretValuesRead: 0,
    environmentValuesRead: 0,
    writesMade: 0,
  });
});

test('auth inspection rejects absent, null, empty, and conditional bindings', () => {
  const invalidValues = [
    '',
    '# comment only',
    'null',
    '~',
    "''",
    '""',
    '!Ref AWS::NoValue',
    '!If [UseManagedAuth, configured, !Ref AWS::NoValue]',
    '{ Fn::If: [UseManagedAuth, configured, !Ref AWS::NoValue] }',
  ];

  for (const invalidValue of invalidValues) {
    const inspected = inspectAuthenticationDeploymentTemplate(`
Resources:
  ApiTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      ContainerDefinitions:
        - Name: api
          Environment:
            - Name: AUTH_MODE
              Value: ${invalidValue}
          Secrets:
            - Name: AUTH_PREAUTH_SEAL_KEY
              ValueFrom: ${invalidValue}
  WebTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      ContainerDefinitions:
        - Name: web
          Environment:
            - { Name: AUTH_PUBLIC_ORIGIN, Value: https://app.example }
`);

    assert.equal(inspected.syntaxValid, false, invalidValue || '<absent>');
    assert.equal(inspected.apiEnvironmentNames.has('AUTH_MODE'), false, invalidValue || '<absent>');
    assert.equal(
      inspected.apiSecretNames.has('AUTH_PREAUTH_SEAL_KEY'),
      false,
      invalidValue || '<absent>',
    );
  }

  const inlineConditional = inspectAuthenticationDeploymentTemplate(`
Resources:
  ApiTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      ContainerDefinitions:
        - Name: api
          Environment:
            - { Name: AUTH_MODE, Value: { Fn::If: [UseManagedAuth, managed, local] } }
          Secrets:
            - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !If [UseManagedAuth, secret, fallback] }
  WebTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      ContainerDefinitions:
        - Name: web
          Environment:
            - { Name: AUTH_PUBLIC_ORIGIN, Value: https://app.example }
`);

  assert.equal(inlineConditional.syntaxValid, false);
  assert.equal(inlineConditional.apiEnvironmentNames.has('AUTH_MODE'), false);
  assert.equal(inlineConditional.apiSecretNames.has('AUTH_PREAUTH_SEAL_KEY'), false);
});

test('CLI arguments are closed and default to the read-only target', () => {
  assert.deepEqual(parseProductionPreflightArguments([]), {
    json: false,
    target: 'read-only',
  });
  assert.deepEqual(parseProductionPreflightArguments(['--target', 'mainnet-write', '--json']), {
    json: true,
    target: 'mainnet-write',
  });
  assert.throws(
    () => parseProductionPreflightArguments(['--target', 'production']),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () => parseProductionPreflightArguments(['--unknown']),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
});
