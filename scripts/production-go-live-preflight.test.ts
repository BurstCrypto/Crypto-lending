import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  applyVerifiedPublicLaunchAuthorityDecision,
  evaluateProductionPreflight,
  formatProductionPreflightReport,
  inspectAuthenticationDeploymentTemplate,
  loadRepositoryProductionPreflightInput,
  parseProductionPreflightArguments,
  productionDirectoryConfigurationSha256,
  productionPreflightCliErrorCode,
  productionPreflightExitCode,
  type ProductionPreflightBlockerId,
  type ProductionPreflightInput,
} from './production-go-live-preflight';
import {
  canonicalPublicLaunchAuthorityJson,
  isVerifiedPublicLaunchAuthorityDecisionSet,
  PUBLIC_LAUNCH_AUTHORITY_ROLES,
  PUBLIC_LAUNCH_AUTHORITY_SCOPE,
  PublicLaunchAuthorityDecisionInvalidError,
  publicLaunchAuthorityDecisionSigningBytes,
  verifyPublicLaunchAuthorityDecisionBytesWithTestRegistry,
  type PublicLaunchAuthorityDecision,
  type PublicLaunchAuthorityDecisionSet,
  type PublicLaunchAuthorityKeyRegistry,
  type PublicLaunchTargetBinding,
  type UnsignedPublicLaunchAuthorityDecision,
  type VerifiedPublicLaunchAuthorityDecisionSet,
} from './public-launch-authority-decision';

const SOURCE_REVISION = 'a'.repeat(40);
const AUTHORITY_BINDING = Object.freeze({
  releaseCandidateManifestSha256: 'd'.repeat(64),
  deploymentTargetId: 'aws-production-us-east-1-crypto-lending',
  deploymentTargetConfigurationSha256: 'e'.repeat(64),
} satisfies PublicLaunchTargetBinding);
const APPLICATION_BASELINE = readFileSync(
  resolve(__dirname, '../infra/aws/application-baseline.yaml'),
  'utf8',
);

type AuthBindingMutation = readonly [
  name: string,
  valueKey: 'Value' | 'ValueFrom',
  approvedValue: string,
  rejectedValue: string,
  expectedBlocker: ProductionPreflightBlockerId,
  occurrence?: number,
];

function mutateInlineBinding(
  source: string,
  [name, valueKey, approvedValue, rejectedValue, , occurrence = 0]: AuthBindingMutation,
): string {
  const approved = `- { Name: ${name}, ${valueKey}: ${approvedValue} }`;
  const rejected = `- { Name: ${name}, ${valueKey}: ${rejectedValue} }`;
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    start = source.indexOf(approved, start + 1);
    assert.notEqual(start, -1, `missing approved ${name} occurrence ${occurrence}`);
  }
  return `${source.slice(0, start)}${rejected}${source.slice(start + approved.length)}`;
}

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
    networks: [{ id: 'eip155:1', name: 'Ethereum' }],
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
    'NODE_ENV',
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
    'AUTH_CLIENT_ADDRESS_MODE',
    'AUTH_TRUSTED_PROXY_CIDRS',
    'WALLET_REGISTRATION_MODE',
    'WALLET_REGISTRATION_REGISTRY_ENVIRONMENT',
    'WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS',
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
        'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
        'AUTH_SESSION_HMAC_KEY_RING_JSON',
        'AUTH_CSRF_HMAC_KEY_RING_JSON',
        'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
        'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
        'WALLET_METADATA_SEAL_KEY_RING_JSON',
      ]),
      webEnvironmentNames: new Set(['NODE_ENV', 'AUTH_PUBLIC_ORIGIN']),
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
    publicLaunchAuthorities: {
      decisionSet: null,
      evidenceBinding: null,
    },
  };
}

function unbrandedLaunchDecision(expired = false): VerifiedPublicLaunchAuthorityDecisionSet {
  const now = Date.now();
  const approvedAt = new Date(expired ? Date.UTC(2001, 0, 1) : now - 60_000).toISOString();
  const evaluatedAt = new Date(expired ? Date.UTC(2001, 0, 2) : now).toISOString();
  const expiresAt = new Date(expired ? Date.UTC(2001, 0, 3) : now + 3_600_000).toISOString();
  const validFrom = new Date(expired ? Date.UTC(2000, 11, 1) : now - 86_400_000).toISOString();
  const validUntil = new Date(expired ? Date.UTC(2001, 11, 1) : now + 172_800_000).toISOString();
  const authorities = PUBLIC_LAUNCH_AUTHORITY_ROLES.map((role, index) => ({
    role,
    keyId: `preflight-authority-${String(index + 1).padStart(2, '0')}`,
    keyPair: generateKeyPairSync('ed25519'),
  }));
  const authorityKeyRegistry: PublicLaunchAuthorityKeyRegistry = {
    schemaVersion: 1,
    artifactType: 'PUBLIC_LAUNCH_AUTHORITY_KEY_REGISTRY',
    keys: authorities.map(({ role, keyId, keyPair }) => ({
      keyId,
      role,
      scope: PUBLIC_LAUNCH_AUTHORITY_SCOPE,
      algorithm: 'Ed25519',
      status: 'APPROVED',
      publicKeySpkiDerBase64: Buffer.from(
        keyPair.publicKey.export({ format: 'der', type: 'spki' }),
      ).toString('base64'),
      validFrom,
      validUntil,
      approvalReferenceId: `preflight-test/${keyId}`,
    })),
  };
  const decisions = authorities.map(({ role, keyId, keyPair }): PublicLaunchAuthorityDecision => {
    const unsigned: UnsignedPublicLaunchAuthorityDecision = {
      role,
      scope: PUBLIC_LAUNCH_AUTHORITY_SCOPE,
      authorityKeyId: keyId,
      decision: 'APPROVED',
      approvedAt,
      expiresAt,
      approvalReferenceId: `preflight-test/decision-${keyId}`,
    };
    return {
      ...unsigned,
      signature: {
        algorithm: 'Ed25519',
        valueBase64: sign(
          null,
          publicLaunchAuthorityDecisionSigningBytes(AUTHORITY_BINDING, unsigned),
          keyPair.privateKey,
        ).toString('base64'),
      },
    };
  });
  const artifact: PublicLaunchAuthorityDecisionSet = {
    schemaVersion: 1,
    artifactType: 'PUBLIC_LAUNCH_AUTHORITY_DECISION_SET',
    ...AUTHORITY_BINDING,
    decisions,
  };
  return verifyPublicLaunchAuthorityDecisionBytesWithTestRegistry(
    Buffer.from(canonicalPublicLaunchAuthorityJson(artifact), 'utf8'),
    {
      evaluatedAt,
      ...AUTHORITY_BINDING,
      authorityKeyRegistry,
    },
  );
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
    directory: 10,
    planned: 10,
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
  assert.ok(
    readOnly.checks
      .find(({ id }) => id === 'PUBLIC_LAUNCH_AUTHORITIES')
      ?.blockerIds.includes('PUBLIC_LAUNCH_AUTHORITY_DECISION_MISSING'),
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

test('all synthetic technical inputs remain blocked without seven signed launch authorities', () => {
  const readOnlyInput = completeInput(platformDirectory('LIVE_READ_ONLY'));
  const readOnlyReport = evaluateProductionPreflight(readOnlyInput, 'read-only');
  assert.equal(readOnlyReport.readiness.publicReadOnly, 'BLOCKED');
  assert.equal(productionPreflightExitCode(readOnlyReport), 1);
  assert.ok(
    readOnlyReport.checks
      .filter(({ id }) => id !== 'PUBLIC_LAUNCH_AUTHORITIES' && id !== 'MAINNET_WRITES')
      .every(({ launchReadiness }) => launchReadiness === 'LOCAL_GATES_CLEAR'),
  );

  const directory = platformDirectory('TRANSACTION_ENABLED');
  const input = completeInput(directory);
  input.platforms.mainnetWriteEvidenceIndex = writeEvidence(directory);
  const report = evaluateProductionPreflight(input, 'mainnet-write');

  assert.equal(report.readiness.mainnetWrites, 'BLOCKED');
  assert.equal(productionPreflightExitCode(report), 1);
  assert.deepEqual(report.checks.find(({ id }) => id === 'PUBLIC_LAUNCH_AUTHORITIES')?.blockerIds, [
    'PUBLIC_LAUNCH_AUTHORITY_DECISION_MISSING',
  ]);
  assert.equal(report.auditMode, 'BOOTSTRAP_BLOCKER_AUDIT');
  assert.equal(report.assurance, 'LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL');
});

test('test-registry decisions, structural copies, booleans, wrong bindings, and expiry cannot clear launch authority', () => {
  const directory = platformDirectory('TRANSACTION_ENABLED');
  const technicalInput = completeInput(directory);
  technicalInput.platforms.mainnetWriteEvidenceIndex = writeEvidence(directory);
  const unbranded = unbrandedLaunchDecision();
  assert.equal(isVerifiedPublicLaunchAuthorityDecisionSet(unbranded), false);
  assert.throws(
    () => applyVerifiedPublicLaunchAuthorityDecision(technicalInput, unbranded),
    PublicLaunchAuthorityDecisionInvalidError,
  );

  const candidates: unknown[] = [
    {
      decisionSet: unbranded,
      evidenceBinding: AUTHORITY_BINDING,
    },
    {
      decisionSet: structuredClone(unbranded),
      evidenceBinding: AUTHORITY_BINDING,
    },
    true,
    {
      decisionSet: unbranded,
      evidenceBinding: {
        ...AUTHORITY_BINDING,
        deploymentTargetConfigurationSha256: 'f'.repeat(64),
      },
    },
  ];
  const expired = unbrandedLaunchDecision(true);
  assert.ok(expired.validUntil < new Date().toISOString());
  candidates.push({ decisionSet: expired, evidenceBinding: AUTHORITY_BINDING });

  for (const candidate of candidates) {
    const input = {
      ...technicalInput,
      publicLaunchAuthorities: candidate,
    } as unknown as ProductionPreflightInput;
    const report = evaluateProductionPreflight(input, 'mainnet-write');
    const authorities = report.checks.find(({ id }) => id === 'PUBLIC_LAUNCH_AUTHORITIES');
    assert.equal(authorities?.localValidation, 'FAIL');
    assert.deepEqual(authorities?.blockerIds, ['PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED']);
    assert.equal(report.readiness.publicReadOnly, 'BLOCKED');
    assert.equal(report.readiness.mainnetWrites, 'BLOCKED');
    assert.equal(productionPreflightExitCode(report), 1);
  }
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

  for (const network of [
    { id: 'eip155:8453', name: 'Base' },
    { id: 'eip155:56', name: 'BNB Smart Chain' },
  ]) {
    const outOfScopeNetwork = platformDirectory('LIVE_READ_ONLY');
    const providers = outOfScopeNetwork.providers as Record<string, unknown>[];
    providers[0] = { ...providers[0], networks: [network] };
    const networkReport = evaluateProductionPreflight(completeInput(outOfScopeNetwork));
    assert.equal(
      networkReport.checks.find(({ id }) => id === 'PLATFORM_DIRECTORY')?.localValidation,
      'FAIL',
    );
  }

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

const API_AUTH_BINDING_MUTATIONS = [
  ['NODE_ENV', 'Value', 'production', 'development', 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'],
  ['AUTH_MODE', 'Value', 'oidc', 'disabled', 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'],
  ['OIDC_PROVIDER_KEY', 'Value', 'cognito', 'attacker', 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'],
  [
    'OIDC_ISSUER_URL',
    'Value',
    "!Sub 'https://cognito-idp.${AWS::Region}.${AWS::URLSuffix}/${CognitoPoolId}'",
    "!Sub 'https://attacker.invalid/${CognitoPoolId}'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_AUTHORIZATION_ENDPOINT',
    'Value',
    "!Sub 'https://${CognitoLoginHostname}/oauth2/authorize'",
    "!Sub 'https://attacker.invalid/oauth2/authorize'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_TOKEN_ENDPOINT',
    'Value',
    "!Sub 'https://${CognitoLoginHostname}/oauth2/token'",
    "!Sub 'https://attacker.invalid/oauth2/token'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_JWKS_URI',
    'Value',
    "!Sub 'https://cognito-idp.${AWS::Region}.${AWS::URLSuffix}/${CognitoPoolId}/.well-known/jwks.json'",
    "!Sub 'https://attacker.invalid/.well-known/jwks.json'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_CLIENT_ID',
    'Value',
    '!Ref CognitoClientId',
    '!Ref AttackerClientId',
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_AUDIENCE',
    'Value',
    '!Ref CognitoClientId',
    '!Ref AttackerAudience',
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  ['OIDC_REQUIRED_TOKEN_USE', 'Value', 'id', 'access', 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'],
  [
    'OIDC_END_SESSION_ENDPOINT',
    'Value',
    "!Sub 'https://${CognitoLoginHostname}/logout'",
    "!Sub 'https://attacker.invalid/logout'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_POST_LOGOUT_REDIRECT_URI',
    'Value',
    "!Sub 'https://${ApplicationHostname}/login'",
    "!Sub 'https://attacker.invalid/login'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  ['OIDC_SIGNING_ALGORITHM', 'Value', 'RS256', 'HS256', 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'],
  [
    'OIDC_TOKEN_AUTH_METHOD',
    'Value',
    'none',
    'client_secret_post',
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'AUTH_PUBLIC_ORIGIN',
    'Value',
    "!Sub 'https://${ApplicationHostname}'",
    "!Sub 'https://attacker.invalid'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
    0,
  ],
  [
    'OIDC_REDIRECT_URI',
    'Value',
    "!Sub 'https://${ApplicationHostname}/api/v1/auth/callback'",
    "!Sub 'https://attacker.invalid/api/v1/auth/callback'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  ['OIDC_HTTP_TIMEOUT_MS', 'Value', "'5000'", "'5001'", 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'],
  [
    'OIDC_TOKEN_RESPONSE_MAX_BYTES',
    'Value',
    "'16384'",
    "'16385'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_JWKS_RESPONSE_MAX_BYTES',
    'Value',
    "'65536'",
    "'65537'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_JWKS_CACHE_TTL_SECONDS',
    'Value',
    "'300'",
    "'301'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_CLOCK_TOLERANCE_SECONDS',
    'Value',
    "'30'",
    "'31'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'OIDC_MAX_ID_TOKEN_AGE_SECONDS',
    'Value',
    "'600'",
    "'601'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'AUTH_PREAUTH_TTL_SECONDS',
    'Value',
    "'600'",
    "'601'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'AUTH_SESSION_IDLE_TTL_SECONDS',
    'Value',
    "'3600'",
    "'3601'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'AUTH_SESSION_ABSOLUTE_TTL_SECONDS',
    'Value',
    "'86400'",
    "'86401'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'AUTH_PREAUTH_SEAL_KEY_ID',
    'Value',
    'preauth-v1',
    'preauth-v2',
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'AUTH_CLIENT_ADDRESS_MODE',
    'Value',
    'trusted-single-proxy',
    'direct',
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
  [
    'AUTH_TRUSTED_PROXY_CIDRS',
    'Value',
    "!Sub '${PublicSubnetACidr},${PublicSubnetBCidr}'",
    "'0.0.0.0/0'",
    'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED',
  ],
] as const satisfies readonly AuthBindingMutation[];

const API_AUTH_SECRET_BINDING_MUTATIONS = [
  [
    'AUTH_PREAUTH_SEAL_KEY',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::'",
    "!Sub '${AuthWalletKeysSecretArn}:WRONG_PREAUTH_KEY::'",
    'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED',
  ],
  [
    'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_IDENTITY_HMAC_KEY_RING_JSON::'",
    "!Sub '${AttackerSecretArn}:AUTH_IDENTITY_HMAC_KEY_RING_JSON::'",
    'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED',
  ],
  [
    'AUTH_SESSION_HMAC_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_SESSION_HMAC_KEY_RING_JSON::'",
    "!Sub '${AuthWalletKeysSecretArn}:WRONG_SESSION_KEY::'",
    'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED',
  ],
  [
    'AUTH_CSRF_HMAC_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_CSRF_HMAC_KEY_RING_JSON::'",
    "!Sub '${AttackerSecretArn}:AUTH_CSRF_HMAC_KEY_RING_JSON::'",
    'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED',
  ],
] as const satisfies readonly AuthBindingMutation[];

const API_WALLET_BINDING_MUTATIONS = [
  [
    'WALLET_REGISTRATION_MODE',
    'Value',
    'enabled',
    'disabled',
    'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
  ],
  [
    'WALLET_REGISTRATION_REGISTRY_ENVIRONMENT',
    'Value',
    'MAINNET',
    'TESTNET',
    'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
  ],
  [
    'WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS',
    'Value',
    "'180'",
    "'181'",
    'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
  ],
  [
    'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:WALLET_IDENTITY_HMAC_KEY_RING_JSON::'",
    "!Sub '${AuthWalletKeysSecretArn}:WRONG_WALLET_IDENTITY_KEY::'",
    'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
  ],
  [
    'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:WALLET_CHALLENGE_HMAC_KEY_RING_JSON::'",
    "!Sub '${AttackerSecretArn}:WALLET_CHALLENGE_HMAC_KEY_RING_JSON::'",
    'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
  ],
  [
    'WALLET_METADATA_SEAL_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:WALLET_METADATA_SEAL_KEY_RING_JSON::'",
    "!Sub '${AuthWalletKeysSecretArn}:WRONG_WALLET_SEAL_KEY::'",
    'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
  ],
] as const satisfies readonly AuthBindingMutation[];

const WEB_AUTH_BINDING_MUTATIONS = [
  ['NODE_ENV', 'Value', 'production', 'development', 'AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED', 1],
  [
    'AUTH_PUBLIC_ORIGIN',
    'Value',
    "!Sub 'https://${ApplicationHostname}'",
    "!Sub 'https://attacker.invalid'",
    'AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED',
    1,
  ],
] as const satisfies readonly AuthBindingMutation[];

test('auth inspection verifies every reviewed API, wallet, secret, and web binding value', () => {
  const mutations = [
    ...API_AUTH_BINDING_MUTATIONS,
    ...API_AUTH_SECRET_BINDING_MUTATIONS,
    ...API_WALLET_BINDING_MUTATIONS,
    ...WEB_AUTH_BINDING_MUTATIONS,
  ];
  assert.equal(mutations.length, 40);

  for (const mutation of mutations) {
    const [name, valueKey, , , expectedBlocker] = mutation;
    const mutated = mutateInlineBinding(APPLICATION_BASELINE, mutation);
    const inspected = inspectAuthenticationDeploymentTemplate(mutated);
    const input = completeInput(platformDirectory('PLANNED'));
    const report = evaluateProductionPreflight({ ...input, authentication: inspected });
    const authentication = report.checks.find(({ id }) => id === 'AUTHENTICATION');
    const inspectedNames =
      expectedBlocker === 'AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED'
        ? inspected.webEnvironmentNames
        : valueKey === 'ValueFrom'
          ? inspected.apiSecretNames
          : inspected.apiEnvironmentNames;

    assert.equal(inspected.inspected, true, name);
    assert.equal(inspected.syntaxValid, true, name);
    assert.equal(inspectedNames.has(name), false, name);
    assert.equal(authentication?.localValidation, 'PASS', name);
    assert.deepEqual(
      authentication?.blockerIds,
      [expectedBlocker, 'AUTH_DEPLOYED_EVIDENCE_MISSING'],
      name,
    );
  }
});

test('the reviewed template exposes only preauth plus six key-ring secrets to production auth', () => {
  const inspected = inspectAuthenticationDeploymentTemplate(APPLICATION_BASELINE);
  const input = completeInput(platformDirectory('PLANNED'));
  const report = evaluateProductionPreflight({ ...input, authentication: inspected });
  const authentication = report.checks.find(({ id }) => id === 'AUTHENTICATION');

  assert.equal(inspected.inspected, true);
  assert.equal(inspected.syntaxValid, true);
  assert.deepEqual(
    [...inspected.apiSecretNames].filter((name) => /^(?:AUTH|WALLET)_/u.test(name)),
    [
      'AUTH_PREAUTH_SEAL_KEY',
      'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
      'AUTH_SESSION_HMAC_KEY_RING_JSON',
      'AUTH_CSRF_HMAC_KEY_RING_JSON',
      'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
      'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
      'WALLET_METADATA_SEAL_KEY_RING_JSON',
    ],
  );
  assert.deepEqual(authentication?.blockerIds, ['AUTH_DEPLOYED_EVIDENCE_MISSING']);
});

test('direct auth evaluation rejects managed-prefix supersets and local-demo controls', () => {
  const cases = [
    ['apiEnvironmentNames', 'AUTH_IDENTITY_HMAC_KEY_ID', 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'],
    ['apiEnvironmentNames', 'AUTH_UNREVIEWED_VALUE', 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'],
    ['apiEnvironmentNames', 'LOCAL_DEMO_MODE', 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'],
    ['apiSecretNames', 'AUTH_IDENTITY_HMAC_KEY', 'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED'],
    ['apiSecretNames', 'OIDC_UNREVIEWED_SECRET', 'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED'],
    ['apiSecretNames', 'NODE_ENV', 'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED'],
    ['apiSecretNames', 'LOCAL_DEMO_MODE', 'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED'],
    [
      'apiEnvironmentNames',
      'WALLET_IDENTITY_HMAC_KEY_VERSION',
      'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
    ],
    [
      'apiSecretNames',
      'WALLET_IDENTITY_HMAC_KEY',
      'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
    ],
    ['webEnvironmentNames', 'OIDC_CLIENT_ID', 'AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED'],
    ['webEnvironmentNames', 'LOCAL_DEMO_MODE', 'AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED'],
  ] as const satisfies readonly (readonly [
    'apiEnvironmentNames' | 'apiSecretNames' | 'webEnvironmentNames',
    string,
    ProductionPreflightBlockerId,
  ])[];

  for (const [field, extraName, expectedBlocker] of cases) {
    const input = completeInput(platformDirectory('PLANNED'));
    const authentication = {
      ...input.authentication,
      [field]: new Set([...input.authentication[field], extraName]),
    };
    const report = evaluateProductionPreflight({ ...input, authentication });
    const blockers = report.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds ?? [];

    assert.ok(blockers.includes(expectedBlocker), extraName);
  }
});

test('unrelated non-prefixed task bindings remain outside the exact auth and wallet scopes', () => {
  const input = completeInput(platformDirectory('PLANNED'));
  const authentication = {
    ...input.authentication,
    apiEnvironmentNames: new Set([
      ...input.authentication.apiEnvironmentNames,
      'OTEL_SERVICE_NAME',
    ]),
    apiSecretNames: new Set([...input.authentication.apiSecretNames, 'DATABASE_RUNTIME_PASSWORD']),
    webEnvironmentNames: new Set([...input.authentication.webEnvironmentNames, 'APP_VERSION']),
  };
  const directReport = evaluateProductionPreflight({ ...input, authentication });

  assert.deepEqual(directReport.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds, []);

  const anchor = '       - { Name: NODE_ENV, Value: production }';
  const mutated = APPLICATION_BASELINE.replace(
    anchor,
    `${anchor}\n       - { Name: OTEL_SERVICE_NAME, Value: crypto-lending-api }`,
  );
  assert.notEqual(mutated, APPLICATION_BASELINE);
  const inspected = inspectAuthenticationDeploymentTemplate(mutated);
  const inspectedReport = evaluateProductionPreflight({ ...input, authentication: inspected });

  assert.equal(inspected.syntaxValid, true);
  assert.deepEqual(inspectedReport.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds, [
    'AUTH_DEPLOYED_EVIDENCE_MISSING',
  ]);
});

test('template inspection rejects every legacy single-key field mixed with key rings', () => {
  const environmentAnchor = '       - { Name: AUTH_PREAUTH_SEAL_KEY_ID, Value: preauth-v1 }';
  const secretAnchor =
    "       - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::' }";
  const legacyEnvironmentNames = [
    'AUTH_IDENTITY_HMAC_KEY_ID',
    'AUTH_SESSION_HMAC_KEY_ID',
    'AUTH_CSRF_HMAC_KEY_ID',
    'WALLET_IDENTITY_HMAC_KEY_VERSION',
    'WALLET_CHALLENGE_HMAC_KEY_VERSION',
    'WALLET_METADATA_SEAL_KEY_VERSION',
  ];
  const legacySecretNames = [
    'AUTH_IDENTITY_HMAC_KEY',
    'AUTH_SESSION_HMAC_KEY',
    'AUTH_CSRF_HMAC_KEY',
    'WALLET_IDENTITY_HMAC_KEY',
    'WALLET_CHALLENGE_HMAC_KEY',
    'WALLET_METADATA_SEAL_KEY',
  ];

  for (const name of legacyEnvironmentNames) {
    const mutated = APPLICATION_BASELINE.replace(
      environmentAnchor,
      `${environmentAnchor}\n       - { Name: ${name}, Value: legacy }`,
    );
    assert.notEqual(mutated, APPLICATION_BASELINE, name);
    const inspected = inspectAuthenticationDeploymentTemplate(mutated);
    assert.equal(inspected.syntaxValid, false, name);
  }

  for (const name of legacySecretNames) {
    const mutated = APPLICATION_BASELINE.replace(
      secretAnchor,
      `${secretAnchor}\n       - { Name: ${name}, ValueFrom: !Sub '\${AuthWalletKeysSecretArn}:${name}::' }`,
    );
    assert.notEqual(mutated, APPLICATION_BASELINE, name);
    const inspected = inspectAuthenticationDeploymentTemplate(mutated);
    assert.equal(inspected.syntaxValid, false, name);
  }
});

test('template inspection rejects unknown managed names, wrong sections, and local demo mode', () => {
  const environmentAnchor = '       - { Name: AUTH_PREAUTH_SEAL_KEY_ID, Value: preauth-v1 }';
  const secretAnchor =
    "       - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::' }";
  const cases = [
    [environmentAnchor, '       - { Name: AUTH_UNREVIEWED_VALUE, Value: enabled }'],
    [environmentAnchor, '       - { Name: OIDC_UNREVIEWED_VALUE, Value: enabled }'],
    [environmentAnchor, '       - { Name: WALLET_UNREVIEWED_VALUE, Value: enabled }'],
    [environmentAnchor, '       - { Name: LOCAL_DEMO_MODE, Value: enabled }'],
    [
      environmentAnchor,
      '       - { Name: AUTH_IDENTITY_HMAC_KEY_RING_JSON, Value: plaintext-prohibited }',
    ],
    [secretAnchor, '       - { Name: AUTH_UNREVIEWED_SECRET, ValueFrom: unexpected }'],
    [secretAnchor, '       - { Name: OIDC_UNREVIEWED_SECRET, ValueFrom: unexpected }'],
    [secretAnchor, '       - { Name: WALLET_UNREVIEWED_SECRET, ValueFrom: unexpected }'],
    [secretAnchor, '       - { Name: AUTH_MODE, ValueFrom: unexpected }'],
    [secretAnchor, '       - { Name: NODE_ENV, ValueFrom: unexpected }'],
    [secretAnchor, '       - { Name: LOCAL_DEMO_MODE, ValueFrom: unexpected }'],
  ] as const;

  for (const [anchor, injected] of cases) {
    const mutated = APPLICATION_BASELINE.replace(anchor, `${anchor}\n${injected}`);
    assert.notEqual(mutated, APPLICATION_BASELINE, injected);
    const inspected = inspectAuthenticationDeploymentTemplate(mutated);
    const input = completeInput(platformDirectory('PLANNED'));
    const report = evaluateProductionPreflight({ ...input, authentication: inspected });
    const blockers = report.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds ?? [];

    assert.equal(inspected.syntaxValid, false, injected);
    assert.ok(blockers.includes('AUTH_TEMPLATE_INSPECTION_FAILED'), injected);
  }
});

test('template inspection requires the production web task to remain secret-free', () => {
  const anchor = [
    "       - { Name: AUTH_PUBLIC_ORIGIN, Value: !Sub 'https://${ApplicationHostname}' }",
    '      LinuxParameters:',
  ].join('\n');
  const mutated = APPLICATION_BASELINE.replace(
    anchor,
    [
      "       - { Name: AUTH_PUBLIC_ORIGIN, Value: !Sub 'https://${ApplicationHostname}' }",
      '      Secrets:',
      "       - { Name: AUTH_PUBLIC_ORIGIN, ValueFrom: !Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::' }",
      '      LinuxParameters:',
    ].join('\n'),
  );
  assert.notEqual(mutated, APPLICATION_BASELINE);

  const inspected = inspectAuthenticationDeploymentTemplate(mutated);
  const input = completeInput(platformDirectory('PLANNED'));
  const report = evaluateProductionPreflight({ ...input, authentication: inspected });
  const blockers = report.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds ?? [];

  assert.equal(inspected.inspected, true);
  assert.equal(inspected.syntaxValid, false);
  assert.ok(blockers.includes('AUTH_TEMPLATE_INSPECTION_FAILED'));
});

test('a rejected binding cannot be hidden before a duplicate approved binding', () => {
  const mutation = API_AUTH_BINDING_MUTATIONS.find(([name]) => name === 'AUTH_MODE');
  assert.ok(mutation);
  const wrongFirst = mutateInlineBinding(APPLICATION_BASELINE, mutation);
  const rejected = '- { Name: AUTH_MODE, Value: disabled }';
  const duplicate = wrongFirst.replace(
    rejected,
    `${rejected}\n        - { Name: AUTH_MODE, Value: oidc }`,
  );
  assert.notEqual(duplicate, wrongFirst);

  const inspected = inspectAuthenticationDeploymentTemplate(duplicate);
  const input = completeInput(platformDirectory('PLANNED'));
  const report = evaluateProductionPreflight({ ...input, authentication: inspected });
  const authentication = report.checks.find(({ id }) => id === 'AUTHENTICATION');

  assert.equal(inspected.syntaxValid, false);
  assert.ok(authentication?.blockerIds.includes('AUTH_TEMPLATE_INSPECTION_FAILED'));
  assert.ok(authentication?.blockerIds.includes('AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'));
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

  assert.deepEqual([...inspected.apiEnvironmentNames], []);
  assert.deepEqual([...inspected.apiSecretNames], []);
  assert.deepEqual([...inspected.webEnvironmentNames], []);
  assert.equal(serialized.includes(secretCanary), false);
  assert.equal(text.includes(secretCanary), false);
  assert.ok(
    report.checks
      .find(({ id }) => id === 'AUTHENTICATION')
      ?.blockerIds.includes('AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'),
  );
  assert.deepEqual(report.safety, {
    networkCallsMade: 0,
    dnsQueriesMade: 0,
    cloudCallsMade: 0,
    providerCallsMade: 0,
    secretValuesRead: 0,
    applicationConfigurationEnvironmentValuesRead: 0,
    operatingSystemEnvironmentVariableNamesMayBeReadForGit: [
      'COMSPEC',
      'PATHEXT',
      'SystemRoot',
      'TEMP',
      'TMP',
      'TMPDIR',
      'WINDIR',
    ],
    writesMade: 0,
  });
});

test('auth inspection accepts compact direct-upload YAML and quoted substitutions with braces', () => {
  const inspected = inspectAuthenticationDeploymentTemplate(`
Resources:
 ApiTaskDefinition:
  Type: AWS::ECS::TaskDefinition
  Properties:
   ContainerDefinitions:
    - Name: api
      Environment:
       - { Name: AUTH_MODE, Value: oidc }
       - { Name: AUTH_PUBLIC_ORIGIN, Value: !Sub 'https://\${ApplicationHostname}' }
      Secrets:
       - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !Sub '\${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::' }
 WebTaskDefinition:
  Type: AWS::ECS::TaskDefinition
  Properties:
   ContainerDefinitions:
    - Name: web
      Environment:
       - { Name: AUTH_PUBLIC_ORIGIN, Value: !Sub 'https://\${ApplicationHostname}' }
`);

  assert.equal(inspected.inspected, true);
  assert.equal(inspected.syntaxValid, true);
  assert.deepEqual([...inspected.apiEnvironmentNames], ['AUTH_MODE', 'AUTH_PUBLIC_ORIGIN']);
  assert.deepEqual([...inspected.apiSecretNames], ['AUTH_PREAUTH_SEAL_KEY']);
  assert.deepEqual([...inspected.webEnvironmentNames], ['AUTH_PUBLIC_ORIGIN']);
  assert.equal(inspected.deployedEvidenceAccepted, false);
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
    evidenceBundlePath: null,
    releaseManifestPath: null,
    sourceRevision: null,
    publicLaunchAuthorityDecisionPath: null,
  });
  assert.deepEqual(parseProductionPreflightArguments(['--target', 'mainnet-write', '--json']), {
    json: true,
    target: 'mainnet-write',
    evidenceBundlePath: null,
    releaseManifestPath: null,
    sourceRevision: null,
    publicLaunchAuthorityDecisionPath: null,
  });
  assert.deepEqual(
    parseProductionPreflightArguments([
      '--evidence-bundle',
      'controlled-evidence.json',
      '--release-manifest',
      'release-manifest.json',
      '--source-revision',
      SOURCE_REVISION,
    ]),
    {
      json: false,
      target: 'read-only',
      evidenceBundlePath: 'controlled-evidence.json',
      releaseManifestPath: 'release-manifest.json',
      sourceRevision: SOURCE_REVISION,
      publicLaunchAuthorityDecisionPath: null,
    },
  );
  assert.deepEqual(
    parseProductionPreflightArguments([
      '--evidence-bundle',
      'controlled-evidence.json',
      '--release-manifest',
      'release-manifest.json',
      '--source-revision',
      SOURCE_REVISION,
      '--public-launch-authority-decision',
      'public-launch-authorities.json',
    ]),
    {
      json: false,
      target: 'read-only',
      evidenceBundlePath: 'controlled-evidence.json',
      releaseManifestPath: 'release-manifest.json',
      sourceRevision: SOURCE_REVISION,
      publicLaunchAuthorityDecisionPath: 'public-launch-authorities.json',
    },
  );
  assert.throws(
    () => parseProductionPreflightArguments(['--evidence-bundle']),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () =>
      parseProductionPreflightArguments([
        '--target',
        'mainnet-write',
        '--evidence-bundle',
        'controlled-evidence.json',
        '--release-manifest',
        'release-manifest.json',
        '--source-revision',
        SOURCE_REVISION,
      ]),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () =>
      parseProductionPreflightArguments([
        '--public-launch-authority-decision',
        'public-launch-authorities.json',
      ]),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () => parseProductionPreflightArguments(['--public-launch-authority-decision']),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () =>
      parseProductionPreflightArguments([
        '--evidence-bundle',
        'controlled-evidence.json',
        '--release-manifest',
        'release-manifest.json',
        '--public-launch-authority-decision',
        'public-launch-authorities.json',
      ]),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () =>
      parseProductionPreflightArguments([
        '--evidence-bundle',
        'controlled-evidence.json',
        '--release-manifest',
        'release-manifest.json',
        '--source-revision',
        SOURCE_REVISION,
        '--public-launch-authority-decision',
        'one.json',
        '--public-launch-authority-decision',
        'two.json',
      ]),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () =>
      parseProductionPreflightArguments([
        '--evidence-bundle',
        'one.json',
        '--evidence-bundle',
        'two.json',
      ]),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () => parseProductionPreflightArguments(['--target', 'production']),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.throws(
    () => parseProductionPreflightArguments(['--unknown']),
    /PRODUCTION_PREFLIGHT_ARGUMENT_INVALID/u,
  );
  assert.equal(
    productionPreflightCliErrorCode(new PublicLaunchAuthorityDecisionInvalidError()),
    'PUBLIC_LAUNCH_AUTHORITY_DECISION_INVALID',
  );
});
