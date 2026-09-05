import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import {
  applyVerifiedPublicLaunchAuthorityDecision,
  evaluateProductionPreflight,
  formatProductionPreflightReport,
  inspectAuthenticationDeploymentTemplate,
  inspectBalanceConsumerDeploymentArtifacts,
  inspectDatabaseMasterDeploymentTemplate,
  inspectProductionInfrastructureDeploymentArtifacts,
  inspectRedisOperatorDeploymentTemplates,
  loadRepositoryProductionPreflightInput,
  parseProductionPreflightArguments,
  productionDirectoryConfigurationSha256,
  productionPreflightCliErrorCode,
  productionPreflightExitCode,
  type BalanceConsumerArtifactSources,
  type ProductionPreflightBlockerId,
  type ProductionInfrastructureArtifactSources,
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
const APPLICATION_WORKLOAD_BOUNDARIES = readFileSync(
  resolve(__dirname, '../infra/aws/application-workload-boundaries.yaml'),
  'utf8',
);
const APPLICATION_OBSERVABILITY = readFileSync(
  resolve(__dirname, '../infra/aws/application-observability.yaml'),
  'utf8',
);
const PRODUCTION_INFRASTRUCTURE_ARTIFACTS = Object.freeze({
  applicationTemplateSource: APPLICATION_BASELINE,
  workloadTemplateSource: APPLICATION_WORKLOAD_BOUNDARIES,
  observabilityTemplateSource: APPLICATION_OBSERVABILITY,
  migrationTemplateSource: readFileSync(
    resolve(__dirname, '../infra/aws/database-migration-task.yaml'),
    'utf8',
  ),
  accountGuardrailsTemplateSource: readFileSync(
    resolve(__dirname, '../infra/aws/account-guardrails.yaml'),
    'utf8',
  ),
  applicationInvokerSource: readFileSync(
    resolve(__dirname, '../infra/aws/invoke-application-baseline.ps1'),
    'utf8',
  ),
  accountGuardrailsInvokerSource: readFileSync(
    resolve(__dirname, '../infra/aws/invoke-account-guardrails.ps1'),
    'utf8',
  ),
  applicationValidatorSource: readFileSync(
    resolve(__dirname, '../infra/aws/validate-application-baseline.mjs'),
    'utf8',
  ),
  fixedSlotTransitionValidatorSource: readFileSync(
    resolve(__dirname, '../infra/aws/validate-fixed-slot-credential-transition.mjs'),
    'utf8',
  ),
  billingControlValidatorSource: readFileSync(
    resolve(__dirname, '../infra/aws/validate-billing-control-record.mjs'),
    'utf8',
  ),
  egressPolicyValidatorSource: readFileSync(
    resolve(__dirname, '../infra/egress/validate-egress-policy.mjs'),
    'utf8',
  ),
  authWalletTransitionValidatorSource: readFileSync(
    resolve(__dirname, '../infra/aws/validate-auth-wallet-secret-version-transition.mjs'),
    'utf8',
  ),
  redisOperatorTransitionValidatorSource: readFileSync(
    resolve(__dirname, '../infra/aws/validate-redis-operator-secret-version-transition.mjs'),
    'utf8',
  ),
} satisfies ProductionInfrastructureArtifactSources);
const VERIFIED_PRODUCTION_INFRASTRUCTURE_DEPLOYMENT =
  inspectProductionInfrastructureDeploymentArtifacts(PRODUCTION_INFRASTRUCTURE_ARTIFACTS);
const BALANCE_CONSUMER_ARTIFACTS = Object.freeze({
  activationSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/balance-sync-consumer.activation.ts',
    ),
    'utf8',
  ),
  cliSource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain-sync/application/balance-sync-consumer.cli.ts'),
    'utf8',
  ),
  cliModeSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/balance-sync-consumer.cli-mode.ts',
    ),
    'utf8',
  ),
  runtimeSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/balance-sync-consumer.runtime.ts',
    ),
    'utf8',
  ),
  compositionSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/balance-sync-consumer.composition.ts',
    ),
    'utf8',
  ),
  balanceConsumerResourceSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/balance-sync-consumer.resource.ts',
    ),
    'utf8',
  ),
  balanceConsumerLifecycleSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/balance-sync-consumer.lifecycle.ts',
    ),
    'utf8',
  ),
  balanceJsonRpcSource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain-sync/infrastructure/rpc/balance-json-rpc.ts'),
    'utf8',
  ),
  ethereumBalanceIndexerSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/infrastructure/rpc/ethereum-mainnet-balance-indexer.adapter.ts',
    ),
    'utf8',
  ),
  solanaBalanceIndexerSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/infrastructure/rpc/solana-mainnet-balance-indexer.adapter.ts',
    ),
    'utf8',
  ),
  balanceConsumerPersistenceResourceSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/infrastructure/postgres/balance-consumer-persistence.resource.ts',
    ),
    'utf8',
  ),
  balanceConsumerSqsReceiptResourceSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/infrastructure/sqs/balance-consumer-sqs-receipt.resource.ts',
    ),
    'utf8',
  ),
  runtimePostgresPoolSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/database/runtime-postgres-pool.ts'),
    'utf8',
  ),
  postgresServiceSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/database/postgres.service.ts'),
    'utf8',
  ),
  balanceSyncCheckpointRepositorySource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/infrastructure/postgres/postgres-balance-sync-checkpoint.repository.ts',
    ),
    'utf8',
  ),
  balanceSyncWalletAddressResolverSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/infrastructure/postgres/postgres-balance-sync-wallet-address.resolver.ts',
    ),
    'utf8',
  ),
  balanceConsumerConfigSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/infrastructure/config/balance-consumer.config.ts',
    ),
    'utf8',
  ),
  blockchainSyncIndexSource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain-sync/index.ts'),
    'utf8',
  ),
  jobEnvelopeSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/outbox/job-envelope.ts'),
    'utf8',
  ),
  blockchainSyncModuleSource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain-sync/blockchain-sync.module.ts'),
    'utf8',
  ),
  appModuleSource: readFileSync(resolve(__dirname, '../apps/api/src/app.module.ts'), 'utf8'),
  applicationRootSource: readFileSync(
    resolve(__dirname, '../apps/api/src/application-root.ts'),
    'utf8',
  ),
  localDevelopmentAppModuleSource: readFileSync(
    resolve(__dirname, '../apps/api/src/local-development-app.module.ts'),
    'utf8',
  ),
  mainSource: readFileSync(resolve(__dirname, '../apps/api/src/main.ts'), 'utf8'),
  outboxWorkerCliSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/outbox/outbox-worker.cli.ts'),
    'utf8',
  ),
  redisSessionRevocationCliSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/redis/redis-session-revocation.cli.ts'),
    'utf8',
  ),
  migrationCliSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/database/migration.cli.ts'),
    'utf8',
  ),
  balanceSyncOrchestratorSource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain-sync/application/balance-sync-orchestrator.ts'),
    'utf8',
  ),
  balanceSyncDomainSource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain-sync/domain/balance-sync.ts'),
    'utf8',
  ),
  chainObservationPolicySource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain/domain/chain-observation-policy.ts'),
    'utf8',
  ),
  failClosedJobDispositionSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/fail-closed-balance-sync-job.port.ts',
    ),
    'utf8',
  ),
  reviewedJobDispatcherSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/sqs/reviewed-job-dispatcher.ts'),
    'utf8',
  ),
  infrastructureConfigSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/config/infrastructure.config.ts'),
    'utf8',
  ),
  pinnedQueueReceiptSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/sqs/sqs-queue-receipt.port.ts'),
    'utf8',
  ),
  sqsJobWorkerSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/sqs/sqs-job.worker.ts'),
    'utf8',
  ),
  observabilitySource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/observability/observability.ts'),
    'utf8',
  ),
  sqsServiceSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/sqs/sqs.service.ts'),
    'utf8',
  ),
  sqsModuleSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/sqs/sqs.module.ts'),
    'utf8',
  ),
  sqsTokensSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/sqs/sqs.tokens.ts'),
    'utf8',
  ),
  apiPackageSource: readFileSync(resolve(__dirname, '../apps/api/package.json'), 'utf8'),
  rootPackageSource: readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
  applicationTemplateSource: APPLICATION_BASELINE,
  applicationValidatorSource: readFileSync(
    resolve(__dirname, '../infra/aws/validate-application-baseline.mjs'),
    'utf8',
  ),
  workloadTemplateSource: APPLICATION_WORKLOAD_BOUNDARIES,
  workloadValidatorSource: readFileSync(
    resolve(__dirname, '../infra/aws/validate-application-workload-boundaries.mjs'),
    'utf8',
  ),
  balanceConsumerEnvelopeSource: readFileSync(
    resolve(__dirname, '../infra/aws/balance-consumer-deployment-envelope.yaml'),
    'utf8',
  ),
  balanceConsumerEnvelopeValidatorSource: readFileSync(
    resolve(__dirname, '../infra/aws/validate-balance-consumer-deployment-envelope.mjs'),
    'utf8',
  ),
  balanceConsumerMetadataTransitionValidatorSource: readFileSync(
    resolve(
      __dirname,
      '../infra/aws/validate-balance-consumer-metadata-secret-version-transition.mjs',
    ),
    'utf8',
  ),
  bootstrapPrincipalsSource: readFileSync(
    resolve(__dirname, '../infra/postgres/bootstrap-principals.sql'),
    'utf8',
  ),
  bootstrapPrincipalsValidatorSource: readFileSync(
    resolve(__dirname, '../infra/postgres/validate-bootstrap-principals.mjs'),
    'utf8',
  ),
  walletAddressMigrationSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/infrastructure/database/migrations/0023-create-balance-consumer-wallet-address-boundary.migration.ts',
    ),
    'utf8',
  ),
  workerAuthoritySuspensionMigrationSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/infrastructure/database/migrations/0028-suspend-generic-worker-balance-authority.migration.ts',
    ),
    'utf8',
  ),
  migrationIndexSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/database/migrations/index.ts'),
    'utf8',
  ),
  releaseManifestSource: readFileSync(
    resolve(__dirname, './release-candidate-manifest.mjs'),
    'utf8',
  ),
  productionContainerValidatorSource: readFileSync(
    resolve(__dirname, '../infra/containers/validate-production-containers.mjs'),
    'utf8',
  ),
} satisfies BalanceConsumerArtifactSources);
const VERIFIED_BALANCE_CONSUMER_DEPLOYMENT = inspectBalanceConsumerDeploymentArtifacts(
  BALANCE_CONSUMER_ARTIFACTS,
);
const EXPECTED_DORMANT_BALANCE_CONSUMER_DEPLOYMENT = Object.freeze({
  inspected: true,
  contractValid: true,
  sourceActivation: 'DISABLED',
  runtimeComposition: 'NOT_COMPOSED',
  taskDeployment: 'NOT_PROVISIONED',
  iamCapability: 'NOT_PROVISIONED',
  databaseCapability: 'DORMANT_SOURCE_ONLY',
  deploymentEvidence: 'MISSING',
} as const);
const EXPECTED_DORMANT_BALANCE_CONSUMER_BLOCKERS = Object.freeze([
  'BALANCE_CONSUMER_SOURCE_ACTIVATION_DISABLED',
  'BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED',
  'BALANCE_CONSUMER_TASK_NOT_PROVISIONED',
  'BALANCE_CONSUMER_IAM_NOT_PROVISIONED',
  'BALANCE_CONSUMER_DATABASE_CAPABILITY_NOT_ENABLED',
  'BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING',
] satisfies readonly ProductionPreflightBlockerId[]);
const PREFLIGHT_SCRIPT_PATH = resolve(__dirname, 'production-go-live-preflight.ts');
const RDS_MANAGED_DATABASE_TEMPLATE = APPLICATION_BASELINE;
const VERIFIED_DATABASE_MASTER_DEPLOYMENT = inspectDatabaseMasterDeploymentTemplate(
  RDS_MANAGED_DATABASE_TEMPLATE,
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
    productionInfrastructureDeployment: VERIFIED_PRODUCTION_INFRASTRUCTURE_DEPLOYMENT,
    balanceConsumerDeployment: VERIFIED_BALANCE_CONSUMER_DEPLOYMENT,
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
    redisOperatorDeployment: {
      inspected: true,
      syntaxValid: true,
    },
    databaseMasterDeployment: VERIFIED_DATABASE_MASTER_DEPLOYMENT,
    rdsMasterLifecycleEvidenceAccepted: true,
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
  assert.deepEqual(input.productionInfrastructureDeployment, {
    inspected: true,
    syntaxValid: true,
    environmentContract: 'NON_PRODUCTION_ONLY',
  });
  assert.deepEqual(input.balanceConsumerDeployment, EXPECTED_DORMANT_BALANCE_CONSUMER_DEPLOYMENT);
  assert.deepEqual(input.databaseMasterDeployment, { inspected: true, syntaxValid: true });
  assert.equal(input.rdsMasterLifecycleEvidenceAccepted, false);
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
  assert.deepEqual(
    readOnly.checks.find(({ id }) => id === 'PRODUCTION_INFRASTRUCTURE'),
    {
      id: 'PRODUCTION_INFRASTRUCTURE',
      localValidation: 'PASS',
      launchReadiness: 'BLOCKED',
      blockerIds: ['PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_PATH_NOT_ENABLED'],
    },
  );
  assert.deepEqual(
    readOnly.checks.find(({ id }) => id === 'BALANCE_CONSUMER'),
    {
      id: 'BALANCE_CONSUMER',
      localValidation: 'PASS',
      launchReadiness: 'BLOCKED',
      blockerIds: EXPECTED_DORMANT_BALANCE_CONSUMER_BLOCKERS,
    },
  );
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
  assert.equal(
    readOnly.checks
      .find(({ id }) => id === 'AUTHENTICATION')
      ?.blockerIds.includes('DATABASE_MASTER_SECRET_NOT_RDS_MANAGED'),
    false,
  );
  assert.equal(
    readOnly.checks
      .find(({ id }) => id === 'AUTHENTICATION')
      ?.blockerIds.includes('RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING'),
    true,
  );
  assert.equal(productionPreflightExitCode(readOnly), 1);
  assert.equal(productionPreflightExitCode(writes), 1);

  const cli = spawnSync(process.execPath, ['--import', 'tsx', PREFLIGHT_SCRIPT_PATH, '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(cli.status, 1);
  assert.equal(cli.stderr, '');
  const cliReport = JSON.parse(cli.stdout) as {
    readonly checks: readonly {
      readonly id: string;
      readonly blockerIds: readonly string[];
    }[];
  };
  assert.equal(
    cliReport.checks
      .find(({ id }) => id === 'AUTHENTICATION')
      ?.blockerIds.includes('DATABASE_MASTER_SECRET_NOT_RDS_MANAGED'),
    false,
  );
  assert.equal(
    cliReport.checks
      .find(({ id }) => id === 'AUTHENTICATION')
      ?.blockerIds.includes('RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING'),
    true,
  );
  assert.deepEqual(
    cliReport.checks.find(({ id }) => id === 'PRODUCTION_INFRASTRUCTURE')?.blockerIds,
    ['PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_PATH_NOT_ENABLED'],
  );
  assert.deepEqual(
    cliReport.checks.find(({ id }) => id === 'BALANCE_CONSUMER')?.blockerIds,
    EXPECTED_DORMANT_BALANCE_CONSUMER_BLOCKERS,
  );
});

function mutateProductionInfrastructureArtifact(
  key: keyof ProductionInfrastructureArtifactSources,
  approved: string,
  rejected: string,
): ProductionInfrastructureArtifactSources {
  const source = PRODUCTION_INFRASTRUCTURE_ARTIFACTS[key];
  assert.ok(source.includes(approved), `fixture is missing ${key} mutation target`);
  return {
    ...PRODUCTION_INFRASTRUCTURE_ARTIFACTS,
    [key]: source.replace(approved, rejected),
  };
}

test('production infrastructure inspection brands only the exact non-production artifact matrix', () => {
  const inspected = inspectProductionInfrastructureDeploymentArtifacts(
    PRODUCTION_INFRASTRUCTURE_ARTIFACTS,
  );
  assert.deepEqual(inspected, {
    inspected: true,
    syntaxValid: true,
    environmentContract: 'NON_PRODUCTION_ONLY',
  });
  assert.equal(Object.isFrozen(inspected), true);

  const readOnly = evaluateProductionPreflight(completeInput(platformDirectory('LIVE_READ_ONLY')));
  const mainnetWrite = evaluateProductionPreflight(
    completeInput(platformDirectory('TRANSACTION_ENABLED')),
    'mainnet-write',
  );
  for (const report of [readOnly, mainnetWrite]) {
    assert.deepEqual(
      report.checks.find(({ id }) => id === 'PRODUCTION_INFRASTRUCTURE'),
      {
        id: 'PRODUCTION_INFRASTRUCTURE',
        localValidation: 'PASS',
        launchReadiness: 'BLOCKED',
        blockerIds: ['PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_PATH_NOT_ENABLED'],
      },
    );
    assert.equal(report.selectedTargetReadiness, 'BLOCKED');
  }
});

test('production infrastructure inspection fails closed for drift in every reviewed artifact', () => {
  const nonProductionYaml = "AllowedPattern: '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'";
  const widenedYaml = "AllowedPattern: '^(dev|test|qa|sandbox|staging|production)(-[a-z0-9]+)*$'";
  const nonProductionJavascript = '/^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/u';
  const productionAwareJavascript =
    '/^(?:dev|test|qa|sandbox|staging|production)(?:-[a-z0-9]+)*$/u';
  const mutations: readonly (readonly [
    string,
    keyof ProductionInfrastructureArtifactSources,
    string,
    string,
  ])[] = [
    ['application template', 'applicationTemplateSource', nonProductionYaml, widenedYaml],
    ['workload template', 'workloadTemplateSource', nonProductionYaml, widenedYaml],
    ['observability template', 'observabilityTemplateSource', nonProductionYaml, widenedYaml],
    [
      'observability log identity',
      'observabilityTemplateSource',
      "(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*/api$'",
      "(?:dev|test|qa|sandbox|staging|production)(?:-[a-z0-9]+)*/api$'",
    ],
    ['migration template', 'migrationTemplateSource', nonProductionYaml, widenedYaml],
    ['guardrail template', 'accountGuardrailsTemplateSource', nonProductionYaml, widenedYaml],
    [
      'application invoker',
      'applicationInvokerSource',
      "'^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'",
      "'^(dev|test|qa|sandbox|staging|production)(-[a-z0-9]+)*$'",
    ],
    [
      'guardrail invoker',
      'accountGuardrailsInvokerSource',
      "'^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'",
      "'^(dev|test|qa|sandbox|staging|production)(-[a-z0-9]+)*$'",
    ],
    [
      'application validator',
      'applicationValidatorSource',
      "'^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'",
      "'^(dev|test|qa|sandbox|staging|production)(-[a-z0-9]+)*$'",
    ],
    [
      'fixed-slot validator',
      'fixedSlotTransitionValidatorSource',
      nonProductionJavascript,
      productionAwareJavascript,
    ],
    [
      'billing validator',
      'billingControlValidatorSource',
      '/^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/',
      '/^(?:dev|test|qa|sandbox|staging|production)(?:-[a-z0-9]+)*$/',
    ],
    [
      'egress validator',
      'egressPolicyValidatorSource',
      '/^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/',
      '/^(?:dev|test|qa|sandbox|staging|production)(?:-[a-z0-9]+)*$/',
    ],
    [
      'auth/wallet transition validator',
      'authWalletTransitionValidatorSource',
      productionAwareJavascript,
      nonProductionJavascript,
    ],
    [
      'Redis transition validator',
      'redisOperatorTransitionValidatorSource',
      productionAwareJavascript,
      nonProductionJavascript,
    ],
  ];
  for (const [label, key, approved, rejected] of mutations) {
    const inspected = inspectProductionInfrastructureDeploymentArtifacts(
      mutateProductionInfrastructureArtifact(key, approved, rejected),
    );
    assert.deepEqual(
      inspected,
      { inspected: true, syntaxValid: false, environmentContract: 'INVALID' },
      label,
    );
    assert.equal(Object.isFrozen(inspected), true, label);
  }

  for (const key of Object.keys(
    BALANCE_CONSUMER_ARTIFACTS,
  ) as readonly (keyof BalanceConsumerArtifactSources)[]) {
    const source = BALANCE_CONSUMER_ARTIFACTS[key];
    const replacement = source.endsWith('x') ? 'y' : 'x';
    const inspected = inspectBalanceConsumerDeploymentArtifacts({
      ...BALANCE_CONSUMER_ARTIFACTS,
      [key]: `${source.slice(0, -1)}${replacement}`,
    });
    assert.deepEqual(inspected, INVALID_BALANCE_CONSUMER_DEPLOYMENT, `${key} byte drift`);
  }
});

test('balance-consumer inspection rejects retained-marker semantic overrides and decoys', () => {
  const dynamicCredentialMutation = [
    'ALTER ROLE crypto_balance_consumer_login_a',
    'PASSWORD',
    "pg_catalog.current_setting('runtime.credential');",
  ].join(' ');
  const candidates: readonly BalanceConsumerArtifactSources[] = [
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      activationSource: `${BALANCE_CONSUMER_ARTIFACTS.activationSource}\nBALANCE_CONSUMER_SOURCE_ACTIVATION['enabled'] = true;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      cliModeSource: `/*\n${BALANCE_CONSUMER_ARTIFACTS.cliModeSource}\n*/\nexport const activeConsumer = true;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      infrastructureConfigSource: `${BALANCE_CONSUMER_ARTIFACTS.infrastructureConfigSource}\nexport const genericBalanceQueueBypass = { queueUrl: 'jobs' };\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceConsumerPersistenceResourceSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceConsumerPersistenceResourceSource}\nexport const leakedPersistence = { query: true };\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      runtimeSource: `${BALANCE_CONSUMER_ARTIFACTS.runtimeSource}\nvoid import('../infrastructure/postgres/balance-consumer-persistence.resource');\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      pinnedQueueReceiptSource: `${BALANCE_CONSUMER_ARTIFACTS.pinnedQueueReceiptSource}\nPinnedSqsQueueReceiptAdapter.prototype.publish = async () => ({});\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      sqsJobWorkerSource: `${BALANCE_CONSUMER_ARTIFACTS.sqsJobWorkerSource}\nSqsJobWorker.prototype.queueUrl = 'jobs';\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      sqsServiceSource: `${BALANCE_CONSUMER_ARTIFACTS.sqsServiceSource}\nSqsService.prototype.publisherSqsConfig = function () { return this.config.sqs; };\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      sqsModuleSource: `${BALANCE_CONSUMER_ARTIFACTS.sqsModuleSource}\nconst unreviewedBalanceWorker = new SqsJobWorker(receipt, config.sqs, undefined, 'balance');\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      sqsTokensSource: `${BALANCE_CONSUMER_ARTIFACTS.sqsTokensSource}\nexport const COLLIDING_QUEUE_TOKEN = SQS_PINNED_QUEUE_RECEIPT;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      cliSource: `${BALANCE_CONSUMER_ARTIFACTS.cliSource}\nvoid import('./balance-sync-consumer.runtime').then(({ runBalanceSyncConsumer }) => runBalanceSyncConsumer());\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      workloadTemplateSource: `${BALANCE_CONSUMER_ARTIFACTS.workloadTemplateSource}\n  NestedBalanceConsumer:\n    Type: AWS::CloudFormation::Stack\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      workloadTemplateSource: BALANCE_CONSUMER_ARTIFACTS.workloadTemplateSource.replace(
        'Action: sqs:GetQueueAttributes',
        'Action: sqs:Receive*',
      ),
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      applicationTemplateSource: `${BALANCE_CONSUMER_ARTIFACTS.applicationTemplateSource}\n# balance-consumer-deployment-envelope.yaml\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceConsumerEnvelopeSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceConsumerEnvelopeSource}\n  UnreviewedBalanceConsumerActivator:\n    Type: Custom::Activator\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceConsumerEnvelopeValidatorSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceConsumerEnvelopeValidatorSource}\nvoid fetch('https://unreviewed.invalid');\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceConsumerMetadataTransitionValidatorSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceConsumerMetadataTransitionValidatorSource}\nvoid fetch('https://unreviewed.invalid');\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      bootstrapPrincipalsSource: `${BALANCE_CONSUMER_ARTIFACTS.bootstrapPrincipalsSource}\n${dynamicCredentialMutation}\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      workerAuthoritySuspensionMigrationSource: `${BALANCE_CONSUMER_ARTIFACTS.workerAuthoritySuspensionMigrationSource}\nexport const activateBalanceConsumer = true;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      migrationIndexSource: `${BALANCE_CONSUMER_ARTIFACTS.migrationIndexSource.replace(
        '  suspendGenericWorkerBalanceAuthorityMigrationV0028,\n]);',
        ']);',
      )}\n/* suspendGenericWorkerBalanceAuthorityMigrationV0028, */\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      releaseManifestSource: `${BALANCE_CONSUMER_ARTIFACTS.releaseManifestSource.replace(
        "'blockchain-sync/application/balance-sync-consumer.cli.js',",
        '',
      )}\n/* name: 'api-runtime'; 'blockchain-sync/application/balance-sync-consumer.cli.js', */\n`,
    },
  ];
  for (const candidate of candidates) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(candidate),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
    );
  }
});

test('production infrastructure input shape and brand cannot be forged or bypassed', () => {
  const missing = { ...PRODUCTION_INFRASTRUCTURE_ARTIFACTS } as Record<string, unknown>;
  delete missing.applicationTemplateSource;
  const malformedCandidates: readonly unknown[] = [
    null,
    {},
    missing,
    { ...PRODUCTION_INFRASTRUCTURE_ARTIFACTS, unexpected: 'value' },
    { ...PRODUCTION_INFRASTRUCTURE_ARTIFACTS, migrationTemplateSource: 1 },
    new Proxy(PRODUCTION_INFRASTRUCTURE_ARTIFACTS, {
      ownKeys() {
        throw new Error('untrusted proxy');
      },
    }),
  ];
  for (const candidate of malformedCandidates) {
    assert.doesNotThrow(() => inspectProductionInfrastructureDeploymentArtifacts(candidate));
    assert.deepEqual(inspectProductionInfrastructureDeploymentArtifacts(candidate), {
      inspected: false,
      syntaxValid: false,
      environmentContract: 'INVALID',
    });
  }

  const complete = completeInput(platformDirectory('LIVE_READ_ONLY'));
  const { productionInfrastructureDeployment: intentionallyOmitted, ...legacyInput } = complete;
  assert.notEqual(intentionallyOmitted, undefined);
  const forgedInputs = [
    legacyInput,
    {
      ...complete,
      productionInfrastructureDeployment: Object.freeze({
        inspected: true,
        syntaxValid: true,
        environmentContract: 'NON_PRODUCTION_ONLY' as const,
      }),
    },
    {
      ...complete,
      productionInfrastructureDeployment: Object.freeze({
        inspected: true,
        syntaxValid: true,
        environmentContract: 'PRODUCTION_ENABLED' as const,
      }),
    },
  ];
  for (const input of forgedInputs) {
    const report = evaluateProductionPreflight(input);
    assert.deepEqual(
      report.checks.find(({ id }) => id === 'PRODUCTION_INFRASTRUCTURE'),
      {
        id: 'PRODUCTION_INFRASTRUCTURE',
        localValidation: 'FAIL',
        launchReadiness: 'BLOCKED',
        blockerIds: ['PRODUCTION_INFRASTRUCTURE_INSPECTION_FAILED'],
      },
    );
    assert.equal(report.readiness.publicReadOnly, 'BLOCKED');
    assert.match(
      formatProductionPreflightReport(report),
      /PRODUCTION_INFRASTRUCTURE_INSPECTION_FAILED/u,
    );
  }
});

function mutateBalanceConsumerArtifact(
  key: keyof BalanceConsumerArtifactSources,
  approved: string,
  rejected: string,
): BalanceConsumerArtifactSources {
  const source = BALANCE_CONSUMER_ARTIFACTS[key];
  assert.ok(source.includes(approved), `fixture is missing ${key} mutation target`);
  return {
    ...BALANCE_CONSUMER_ARTIFACTS,
    [key]: source.replace(approved, rejected),
  };
}

const INVALID_BALANCE_CONSUMER_DEPLOYMENT = Object.freeze({
  inspected: true,
  contractValid: false,
  sourceActivation: 'INVALID',
  runtimeComposition: 'INVALID',
  taskDeployment: 'INVALID',
  iamCapability: 'INVALID',
  databaseCapability: 'INVALID',
  deploymentEvidence: 'INVALID',
} as const);

test('balance-consumer inspection rejects dormant SQS receipt capability drift', () => {
  const mutations: readonly (readonly [keyof BalanceConsumerArtifactSources, string, string])[] = [
    ['balanceConsumerSqsReceiptResourceSource', 'ReceiveMessageCommand,', 'SendMessageCommand,'],
    [
      'balanceConsumerSqsReceiptResourceSource',
      'useQueueUrlAsEndpoint: false,',
      'useQueueUrlAsEndpoint: true,',
    ],
    [
      'balanceConsumerSqsReceiptResourceSource',
      'ignoreConfiguredEndpointUrls: true,',
      'ignoreConfiguredEndpointUrls: false,',
    ],
    [
      'balanceConsumerSqsReceiptResourceSource',
      'parsed.hostname !== `sqs.${region}.amazonaws.com`',
      'parsed.hostname !== `sqs.${region}.amazonaws.com.cn`',
    ],
    ['balanceConsumerSqsReceiptResourceSource', '!COMMERCIAL_AWS_REGION.test(value)', '!value'],
    [
      'balanceConsumerSqsReceiptResourceSource',
      'resourceLifecycle.abort(new BalanceConsumerSqsReceiptClosedError());',
      'void resourceLifecycle.signal;',
    ],
    [
      'balanceConsumerSqsReceiptResourceSource',
      "controller.abort(new Error('SQS request aborted'));",
      'controller.abort(signals[0]);',
    ],
    [
      'balanceConsumerSqsReceiptResourceSource',
      'await Promise.allSettled(acceptedOperationGates);',
      'void acceptedOperationGates;',
    ],
    [
      'balanceConsumerSqsReceiptResourceSource',
      'const acceptedOperationGates = [...inFlight];',
      'const acceptedOperationGates: Promise<void>[] = [];',
    ],
    ['balanceConsumerSqsReceiptResourceSource', '-balance-sync$/u;', '-jobs$/u;'],
    [
      'balanceConsumerSqsReceiptResourceSource',
      'return parseJobEnvelope<Payload>(JSON.parse(body) as unknown);',
      'return JSON.parse(body) as JobEnvelope<Payload>;',
    ],
    [
      'jobEnvelopeSource',
      'export function parseJobEnvelope<Payload = unknown>',
      'export function parseUncheckedJobEnvelope<Payload = unknown>',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(
        mutateBalanceConsumerArtifact(key, approved, rejected),
      ),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      `${key}: ${approved}`,
    );
  }

  assert.deepEqual(
    inspectBalanceConsumerDeploymentArtifacts({
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceConsumerSqsReceiptResourceSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceConsumerSqsReceiptResourceSource}\nimport { SqsService } from '../../../infrastructure/sqs/sqs.service';\nvoid SqsService;\nconst unnecessaryAttributes = { MessageAttributeNames: ['All'] };\nvoid unnecessaryAttributes;\n`,
    }),
    INVALID_BALANCE_CONSUMER_DEPLOYMENT,
  );
});

test('balance-consumer inspection rejects dormant aggregate lifecycle and capability drift', () => {
  const mutations: readonly (readonly [keyof BalanceConsumerArtifactSources, string, string])[] = [
    [
      'balanceConsumerResourceSource',
      'BALANCE_SYNC_CONSUMER_RESOURCE_CONFIGURATION_INVALID',
      'BALANCE_SYNC_CONSUMER_RESOURCE_CONFIGURATION_UNREVIEWED',
    ],
    [
      'balanceConsumerResourceSource',
      'await createDormantBalanceConsumerSqsReceiptResource(reviewed.infrastructure),',
      'await createDormantBalanceConsumerSqsReceiptResource({ ...reviewed.infrastructure }),',
    ],
    [
      'balanceConsumerResourceSource',
      'reviewed.infrastructure,',
      'dependencies.infrastructureConfig,',
    ],
    [
      'balanceConsumerResourceSource',
      'visibilityTimeoutSeconds: reviewed.infrastructure.sqs.visibilityTimeoutSeconds,',
      'visibilityTimeoutSeconds: 30,',
    ],
    [
      'balanceConsumerResourceSource',
      'return frozenNullPrototype<DormantBalanceSyncConsumerResource>({ run, close });',
      'return frozenNullPrototype({ run, close, composition });',
    ],
    [
      'balanceConsumerResourceSource',
      "controller.abort(new Error('Balance sync consumer run aborted'));",
      'controller.abort(signal.reason);',
    ],
    [
      'balanceConsumerResourceSource',
      'const controller = new AbortController();',
      'const controller = new AbortController();\n      void AbortSignal.any([signal]);',
    ],
    [
      'balanceConsumerResourceSource',
      'if (started) {',
      'if (started && activeRun !== undefined) {',
    ],
    [
      'balanceConsumerResourceSource',
      'if (acceptedRun !== undefined) await Promise.allSettled([acceptedRun]);',
      'void acceptedRun;',
    ],
    [
      'balanceConsumerResourceSource',
      'const acceptedRunController = activeRunController;',
      'const acceptedRunController = undefined;',
    ],
    [
      'balanceConsumerResourceSource',
      'const sqsClosed = await attemptClose(resourceSqsClose);\n        const persistenceClosed = await attemptClose(resourcePersistenceClose);',
      'const persistenceClosed = await attemptClose(resourcePersistenceClose);\n        const sqsClosed = await attemptClose(resourceSqsClose);',
    ],
    [
      'balanceConsumerResourceSource',
      'const persistenceClosed = await attemptClose(resourcePersistenceClose);',
      'const persistenceClosed = true;',
    ],
    [
      'balanceConsumerResourceSource',
      'if (closePromise !== undefined) return closePromise;',
      'if (closePromise !== undefined) closePromise = undefined;',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(
        mutateBalanceConsumerArtifact(key, approved, rejected),
      ),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      `${key}: ${approved}`,
    );
  }

  const launchRegistrations: readonly BalanceConsumerArtifactSources[] = [
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      blockchainSyncIndexSource: `${BALANCE_CONSUMER_ARTIFACTS.blockchainSyncIndexSource}\nexport { createDormantBalanceSyncConsumerResource } from './application/balance-sync-consumer.resource';\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      runtimeSource: `${BALANCE_CONSUMER_ARTIFACTS.runtimeSource}\nimport { createDormantBalanceSyncConsumerResource } from './balance-sync-consumer.resource';\nvoid createDormantBalanceSyncConsumerResource;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      blockchainSyncModuleSource: `${BALANCE_CONSUMER_ARTIFACTS.blockchainSyncModuleSource}\nimport { createDormantBalanceSyncConsumerResource } from './application/balance-sync-consumer.resource';\nvoid createDormantBalanceSyncConsumerResource;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      activationSource: `${BALANCE_CONSUMER_ARTIFACTS.activationSource}\nimport { createDormantBalanceSyncConsumerResource } from './balance-sync-consumer.resource';\nvoid createDormantBalanceSyncConsumerResource;\n`,
    },
  ];
  for (const candidate of launchRegistrations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(candidate),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
    );
  }
});

test('balance-consumer inspection rejects dormant lifecycle coordinator drift', () => {
  const mutations: readonly (readonly [keyof BalanceConsumerArtifactSources, string, string])[] = [
    [
      'balanceConsumerLifecycleSource',
      'BALANCE_SYNC_CONSUMER_LIFECYCLE_CONFIGURATION_INVALID',
      'BALANCE_SYNC_CONSUMER_LIFECYCLE_CONFIGURATION_UNREVIEWED',
    ],
    [
      'balanceConsumerLifecycleSource',
      'readonly record: (event: BalanceSyncConsumerLifecycleEvent) => void | Promise<void>;',
      'readonly record: (event: BalanceSyncConsumerLifecycleEvent) => void;',
    ],
    [
      'balanceConsumerLifecycleSource',
      'if (Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) {',
      'if (Object.getPrototypeOf(value) !== null) {',
    ],
    [
      'balanceConsumerLifecycleSource',
      'void Promise.resolve(recorder(lifecycleEvent(event))).catch(() => undefined);',
      'void Promise.resolve(recorder(lifecycleEvent(event)));',
    ],
    [
      'balanceConsumerLifecycleSource',
      "controller.abort(new Error('Balance sync consumer lifecycle stop requested'));",
      'controller.abort(reviewed.signal.reason);',
    ],
    [
      'balanceConsumerLifecycleSource',
      'const controller = new AbortController();',
      'const controller = new AbortController();\n  void AbortSignal.any([]);',
    ],
    [
      'balanceConsumerLifecycleSource',
      'if (reviewed.signal.aborted()) requestStop();',
      'void reviewed.signal.aborted();',
    ],
    [
      'balanceConsumerLifecycleSource',
      'runOperation = Promise.resolve(reviewed.runResource(controller.signal));',
      'runOperation = Promise.resolve().then(() => reviewed.runResource(controller.signal));',
    ],
    [
      'balanceConsumerLifecycleSource',
      "  try {\n    runOperation = Promise.resolve(reviewed.runResource(controller.signal));\n  } catch {\n    runFailed = true;\n  }\n  if (runOperation !== undefined) {\n    if (!stopRequested) recordEvent(reviewed.recordEvent, 'STARTED');",
      "  if (!stopRequested) recordEvent(reviewed.recordEvent, 'STARTED');\n  try {\n    runOperation = Promise.resolve(reviewed.runResource(controller.signal));\n  } catch {\n    runFailed = true;\n  }\n  if (runOperation !== undefined) {",
    ],
    ['balanceConsumerLifecycleSource', 'if (runOperation !== undefined) {', 'if (true) {'],
    ['balanceConsumerLifecycleSource', 'await runOperation;', 'void runOperation;'],
    ['balanceConsumerLifecycleSource', 'prematureExit = !stopRequested;', 'prematureExit = false;'],
    ['balanceConsumerLifecycleSource', 'await Promise.resolve().then(close);', 'await close();'],
    [
      'balanceConsumerLifecycleSource',
      'throw new BalanceSyncConsumerLifecycleCloseError();',
      'throw new BalanceSyncConsumerLifecycleRunError();',
    ],
    ['balanceConsumerLifecycleSource', 'started = true;', 'started = false;'],
    [
      'balanceConsumerLifecycleSource',
      'return frozenNullPrototype<DormantBalanceSyncConsumerLifecycleCoordinator>({ run });',
      'return frozenNullPrototype({ run, reviewed });',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(
        mutateBalanceConsumerArtifact(key, approved, rejected),
      ),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      `${key}: ${approved}`,
    );
  }

  const launchRegistrations: readonly BalanceConsumerArtifactSources[] = [
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      blockchainSyncIndexSource: `${BALANCE_CONSUMER_ARTIFACTS.blockchainSyncIndexSource}\nexport { createDormantBalanceSyncConsumerLifecycleCoordinator } from './application/balance-sync-consumer.lifecycle';\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      runtimeSource: `${BALANCE_CONSUMER_ARTIFACTS.runtimeSource}\nimport { createDormantBalanceSyncConsumerLifecycleCoordinator } from './balance-sync-consumer.lifecycle';\nvoid createDormantBalanceSyncConsumerLifecycleCoordinator;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      blockchainSyncModuleSource: `${BALANCE_CONSUMER_ARTIFACTS.blockchainSyncModuleSource}\nimport { createDormantBalanceSyncConsumerLifecycleCoordinator } from './application/balance-sync-consumer.lifecycle';\nvoid createDormantBalanceSyncConsumerLifecycleCoordinator;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceConsumerResourceSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceConsumerResourceSource}\nimport { createDormantBalanceSyncConsumerLifecycleCoordinator } from './balance-sync-consumer.lifecycle';\nvoid createDormantBalanceSyncConsumerLifecycleCoordinator;\n`,
    },
  ];
  for (const candidate of launchRegistrations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(candidate),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
    );
  }
});

test('balance-consumer inspection rejects provider-neutral JSON-RPC capability and registration drift', () => {
  const capabilityMutations: readonly (readonly [
    keyof BalanceConsumerArtifactSources,
    string,
    string,
  ])[] = [
    [
      'balanceJsonRpcSource',
      "import { createHash } from 'node:crypto';",
      "import { createHash } from 'node:crypto';\nimport { request } from 'node:https';",
    ],
    [
      'balanceJsonRpcSource',
      'response = await transport.exchange(request);',
      "response = await fetch('https://unreviewed.invalid');",
    ],
    [
      'ethereumBalanceIndexerSource',
      'private readonly transport: BalanceJsonRpcTransport,',
      'private readonly endpoint: URL,',
    ],
    [
      'solanaBalanceIndexerSource',
      'private readonly transport: BalanceJsonRpcTransport,',
      'private readonly client: UnreviewedSolanaClient,',
    ],
    [
      'ethereumBalanceIndexerSource',
      'exchangeBalanceRpc(this.transport,',
      'this.transport.exchange(',
    ],
    [
      'solanaBalanceIndexerSource',
      'exchangeBalanceRpc(this.transport,',
      'this.transport.exchange(',
    ],
  ];
  for (const [key, approved, rejected] of capabilityMutations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(
        mutateBalanceConsumerArtifact(key, approved, rejected),
      ),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      `${key}: ${approved}`,
    );
  }

  const directCapabilities: readonly BalanceConsumerArtifactSources[] = [
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceJsonRpcSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceJsonRpcSource}\nimport 'node:https';\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceJsonRpcSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceJsonRpcSource}\nfunction retry(): void { setTimeout(() => undefined, 1); }\nvoid retry;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      ethereumBalanceIndexerSource: `${BALANCE_CONSUMER_ARTIFACTS.ethereumBalanceIndexerSource}\nconst rpcUrl = process.env.ETHEREUM_RPC_URL;\nvoid rpcUrl;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      solanaBalanceIndexerSource: `${BALANCE_CONSUMER_ARTIFACTS.solanaBalanceIndexerSource}\n@Module({ providers: [SolanaMainnetBalanceIndexerAdapter] })\nclass UnreviewedRpcModule {}\n`,
    },
  ];
  for (const candidate of directCapabilities) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(candidate),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
    );
  }

  const launchRegistrations: readonly BalanceConsumerArtifactSources[] = [
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      runtimeSource: `${BALANCE_CONSUMER_ARTIFACTS.runtimeSource}\nvoid EthereumMainnetBalanceIndexerAdapter;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      blockchainSyncModuleSource: `${BALANCE_CONSUMER_ARTIFACTS.blockchainSyncModuleSource}\nvoid SolanaMainnetBalanceIndexerAdapter;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      activationSource: `${BALANCE_CONSUMER_ARTIFACTS.activationSource}\nvoid exchangeBalanceRpc;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      cliSource: `${BALANCE_CONSUMER_ARTIFACTS.cliSource}\nvoid BalanceJsonRpcTransport;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      compositionSource: `${BALANCE_CONSUMER_ARTIFACTS.compositionSource}\nvoid exchangeBalanceRpc;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceConsumerResourceSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceConsumerResourceSource}\nvoid EthereumMainnetBalanceIndexerAdapter;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceConsumerLifecycleSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceConsumerLifecycleSource}\nvoid BalanceJsonRpcTransport;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceSyncOrchestratorSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceSyncOrchestratorSource}\nvoid SolanaMainnetBalanceIndexerAdapter;\n`,
    },
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      reviewedJobDispatcherSource: `${BALANCE_CONSUMER_ARTIFACTS.reviewedJobDispatcherSource}\nvoid balanceRpcRequest;\n`,
    },
  ];
  for (const candidate of launchRegistrations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(candidate),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
    );
  }

  assert.match(
    BALANCE_CONSUMER_ARTIFACTS.blockchainSyncIndexSource,
    /export \{ EthereumMainnetBalanceIndexerAdapter \}/u,
  );
  assert.match(
    BALANCE_CONSUMER_ARTIFACTS.blockchainSyncIndexSource,
    /export \{ SolanaMainnetBalanceIndexerAdapter \}/u,
  );
});

test('balance-consumer inspection brands and freezes only the exact dormant local contract', () => {
  const inspected = inspectBalanceConsumerDeploymentArtifacts(BALANCE_CONSUMER_ARTIFACTS);
  assert.deepEqual(inspected, EXPECTED_DORMANT_BALANCE_CONSUMER_DEPLOYMENT);
  assert.equal(Object.isFrozen(inspected), true);

  const readOnly = evaluateProductionPreflight(completeInput(platformDirectory('LIVE_READ_ONLY')));
  const mainnetWrite = evaluateProductionPreflight(
    completeInput(platformDirectory('TRANSACTION_ENABLED')),
    'mainnet-write',
  );
  for (const report of [readOnly, mainnetWrite]) {
    assert.deepEqual(
      report.checks.find(({ id }) => id === 'BALANCE_CONSUMER'),
      {
        id: 'BALANCE_CONSUMER',
        localValidation: 'PASS',
        launchReadiness: 'BLOCKED',
        blockerIds: EXPECTED_DORMANT_BALANCE_CONSUMER_BLOCKERS,
      },
    );
    assert.equal(report.selectedTargetReadiness, 'BLOCKED');
    assert.match(
      formatProductionPreflightReport(report),
      /BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING/u,
    );
  }
});

test('balance-consumer launch blockers participate in both readiness calculations', () => {
  const source = readFileSync(PREFLIGHT_SCRIPT_PATH, 'utf8');
  const readOnlyStart = source.indexOf('const publicReadOnly = readinessFor([');
  const mainnetStart = source.indexOf('const mainnetWrites = readinessFor([', readOnlyStart);
  const readinessEnd = source.indexOf('return Object.freeze({', mainnetStart);
  assert.ok(readOnlyStart >= 0 && mainnetStart > readOnlyStart && readinessEnd > mainnetStart);
  assert.equal(source.slice(readOnlyStart, mainnetStart).split("'BALANCE_CONSUMER'").length - 1, 1);
  assert.equal(source.slice(mainnetStart, readinessEnd).split("'BALANCE_CONSUMER'").length - 1, 1);
});

test('balance-consumer inspection fails closed for drift in every reviewed artifact', () => {
  const mutations: readonly (readonly [
    string,
    keyof BalanceConsumerArtifactSources,
    string,
    string,
  ])[] = [
    ['activation', 'activationSource', 'enabled: false as boolean,', 'enabled: true as boolean,'],
    [
      'CLI entrypoint',
      'cliSource',
      "from './balance-sync-consumer.cli-mode'",
      "from './balance-sync-consumer.runtime'",
    ],
    [
      'CLI source gate',
      'cliModeSource',
      "blockers.push('SOURCE_ACTIVATION_DISABLED');",
      "blockers.push('SOURCE_ACTIVATION_APPROVED');",
    ],
    [
      'runtime refusal',
      'runtimeSource',
      'BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED',
      'BALANCE_CONSUMER_RUNTIME_COMPOSED',
    ],
    [
      'dependency-empty dormant runtime',
      'runtimeSource',
      '@Module({})',
      '@Module({ imports: [PostgresModule] })',
    ],
    [
      'inert composition',
      'compositionSource',
      'const jobDisposition = new FailClosedBalanceSyncJobPort();',
      'const jobDisposition = dependencies.jobDisposition;',
    ],
    [
      'persistence narrow checkpoint facade',
      'balanceConsumerPersistenceResourceSource',
      'load: (scope) => whileOpen(() => checkpointRepository.load(scope)),',
      'query: (text) => postgres.query(text),',
    ],
    [
      'persistence close memoization',
      'balanceConsumerPersistenceResourceSource',
      'closePromise ??= closePool(resourcePool, () => new BalanceConsumerPersistenceCloseError());',
      'closePromise = closePool(resourcePool, () => new BalanceConsumerPersistenceCloseError());',
    ],
    [
      'persistence immutable database snapshot',
      'balanceConsumerPersistenceResourceSource',
      'database: databaseSnapshot(infrastructureRecord.database),',
      'database: infrastructureRecord.database,',
    ],
    [
      'persistence connection parameter exclusion',
      'balanceConsumerPersistenceResourceSource',
      "value.includes('?') ||",
      'false ||',
    ],
    [
      'persistence explicit database port',
      'balanceConsumerPersistenceResourceSource',
      '!/^[1-9][0-9]{0,4}$/u.test(parsed.port) ||',
      'parsed.port.length > 5 ||',
    ],
    [
      'persistence synchronous closed-state transition',
      'balanceConsumerPersistenceResourceSource',
      'closed = true;',
      'closed = false;',
    ],
    [
      'runtime pool balance role',
      'runtimePostgresPoolSource',
      "balanceConsumer: 'crypto_balance_consumer_runtime',",
      "balanceConsumer: 'crypto_worker_runtime',",
    ],
    [
      'database-only runtime pool input',
      'runtimePostgresPoolSource',
      'readonly database: Readonly<DatabaseInfrastructureConfig>;',
      'readonly sqs: Readonly<SqsInfrastructureConfig>;',
    ],
    [
      'private postgres pool',
      'postgresServiceSource',
      'constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}',
      'constructor(@Inject(POSTGRES_POOL) readonly pool: Pool) {}',
    ],
    [
      'private checkpoint database service',
      'balanceSyncCheckpointRepositorySource',
      'constructor(private readonly postgres: PostgresService) {}',
      'constructor(readonly postgres: PostgresService) {}',
    ],
    [
      'private wallet resolver key configuration',
      'balanceSyncWalletAddressResolverSource',
      '@Inject(BALANCE_CONSUMER_CONFIG) private readonly config: BalanceConsumerConfig,',
      '@Inject(BALANCE_CONSUMER_CONFIG) readonly config: BalanceConsumerConfig,',
    ],
    [
      'read-only balance metadata keys',
      'balanceConsumerConfigSource',
      '/** Read-only key selection; this boundary exposes no sealing operation. */',
      '/** Key selection and sealing authority. */',
    ],
    [
      'persistence resource remains outside the public barrel',
      'blockchainSyncIndexSource',
      "from './application/balance-sync-orchestrator';",
      "from './infrastructure/postgres/balance-consumer-persistence.resource';",
    ],
    [
      'persistence resource remains outside the Nest module graph',
      'blockchainSyncModuleSource',
      'providers: [',
      'providers: [createDormantBalanceConsumerPersistenceResource,',
    ],
    [
      'trusted retry signal preservation',
      'balanceSyncOrchestratorSource',
      'if (balanceSyncReceiptRetryMinimumDelaySeconds(error) !== undefined) throw error;',
      "throw orchestratorError('BALANCE_SYNC_JOB_DISPOSITION_FAILED');",
    ],
    [
      'dedicated infrastructure loader',
      'cliModeSource',
      'infrastructure = loadBalanceConsumerInfrastructureConfig(environment);',
      'infrastructure = loadInfrastructureConfig(environment);',
    ],
    [
      'already-pinned balance receipt dependency',
      'compositionSource',
      'readonly sqs: Readonly<PinnedSqsQueueReceiptPort>;',
      'readonly sqs: SqsQueueReceiptTransport;',
    ],
    [
      'direct pinned receipt capability wiring',
      'compositionSource',
      'dependencies.sqs,',
      'new PinnedSqsQueueReceiptAdapter(dependencies.sqs),',
    ],
    [
      'composition receipt policy snapshot',
      'compositionSource',
      'const receiptPolicy = snapshotReceiptPolicy(dependencies.receiptPolicy);',
      'const receiptPolicy = dependencies.receiptPolicy;',
    ],
    [
      'visibility-only composition receipt policy',
      'compositionSource',
      'visibilityTimeoutSeconds: receiptPolicy.visibilityTimeoutSeconds,',
      'visibilityTimeoutSeconds: dependencies.infrastructureConfig.sqs.visibilityTimeoutSeconds,',
    ],
    [
      'domain-derived composition retry policy',
      'compositionSource',
      'retryBaseDelaySeconds: BALANCE_SYNC_POLICY.retryBaseDelaySeconds,',
      'retryBaseDelaySeconds: dependencies.receiptPolicy.retryBaseDelaySeconds,',
    ],
    [
      'balance retry base policy',
      'balanceSyncDomainSource',
      'retryBaseDelaySeconds: 5,',
      'retryBaseDelaySeconds: 1,',
    ],
    [
      'observation attempt policy',
      'chainObservationPolicySource',
      'maxAttempts: 3,',
      'maxAttempts: 4,',
    ],
    [
      'fail-closed receipt disposition',
      'failClosedJobDispositionSource',
      'throw new BalanceSyncJobDispositionNotApprovedError();',
      'return Promise.resolve();',
    ],
    [
      'first-attempt-only balance ingress',
      'reviewedJobDispatcherSource',
      'job.payload.attempt !== 1 ||',
      'job.payload.attempt < 1 ||',
    ],
    [
      'balance-only infrastructure configuration',
      'infrastructureConfigSource',
      "const rawBalanceQueueUrl = required(env, 'SQS_BALANCE_QUEUE_URL');",
      "const rawBalanceQueueUrl = required(env, 'SQS_QUEUE_URL');",
    ],
    [
      'balance receipt policy mapping',
      'infrastructureConfigSource',
      'retryMaxDelaySeconds: BALANCE_SYNC_POLICY.retryMaximumDelaySeconds,',
      'retryMaxDelaySeconds: 900,',
    ],
    [
      'balance loader receipt policy revalidation',
      'infrastructureConfigSource',
      'assertBalanceConsumerSqsReceiptRedrivePolicy(sqsClient);',
      'void sqsClient;',
    ],
    [
      'private pinned receipt queue',
      'pinnedQueueReceiptSource',
      'readonly #queueUrl: string;',
      'readonly queueUrl: string;',
    ],
    [
      'worker narrow receipt port',
      'sqsJobWorkerSource',
      "import type { PinnedSqsQueueReceiptPort } from './sqs-queue-receipt.port';",
      "import type { SqsQueueReceiptTransport } from './sqs-queue-receipt.port';",
    ],
    [
      'balance-only receipt disposition telemetry',
      'sqsJobWorkerSource',
      "if (this.queue === 'balance') {",
      "if (this.queue === 'jobs') {",
    ],
    [
      'bounded receipt telemetry validation',
      'observabilitySource',
      'const MAX_BALANCE_RECEIPT_RECEIVE_COUNT = 3;',
      'const MAX_BALANCE_RECEIPT_RECEIVE_COUNT = 30;',
    ],
    [
      'raw balance service publication denial',
      'sqsServiceSource',
      "if (this.config.workload === 'balance-consumer') {",
      "if (this.config.workload === 'balance-consumer-disabled') {",
    ],
    [
      'generic worker jobs queue pin',
      'sqsModuleSource',
      "{ provide: SQS_WORKER_QUEUE, useValue: 'jobs' },",
      "{ provide: SQS_WORKER_QUEUE, useValue: 'balance' },",
    ],
    [
      'distinct pinned receipt token',
      'sqsTokensSource',
      "export const SQS_PINNED_QUEUE_RECEIPT = Symbol('SQS_PINNED_QUEUE_RECEIPT');",
      'export const SQS_PINNED_QUEUE_RECEIPT = SQS_CLIENT;',
    ],
    [
      'API entrypoint',
      'apiPackageSource',
      'node dist/blockchain-sync/application/balance-sync-consumer.cli.js',
      'node dist/blockchain-sync/application/disabled-balance-consumer.cli.js',
    ],
    [
      'bootstrap validator command',
      'rootPackageSource',
      'node infra/aws/validate-database-migration-task.mjs && node infra/postgres/validate-bootstrap-principals.mjs',
      'node infra/aws/validate-database-migration-task.mjs',
    ],
    [
      'application task graph',
      'applicationTemplateSource',
      ' WorkerService:',
      ' WorkerServiceOld:',
    ],
    [
      'application balance queue redrive bound',
      'applicationTemplateSource',
      '    maxReceiveCount: 3',
      '    maxReceiveCount: !Ref SqsMaxReceiveCount',
    ],
    [
      'application task inventory validator',
      'applicationValidatorSource',
      "['AWS::ECS::TaskDefinition', 3],",
      "['AWS::ECS::TaskDefinition', 4],",
    ],
    [
      'application balance queue redrive validator',
      'applicationValidatorSource',
      'the exact dead-letter target and domain-pinned maxReceiveCount of 3',
      'the exact dead-letter target and configurable maxReceiveCount',
    ],
    [
      'workload queue capability',
      'workloadTemplateSource',
      'Action: sqs:GetQueueAttributes',
      'Action: sqs:ReceiveMessage',
    ],
    [
      'workload resource allowlist validator',
      'workloadValidatorSource',
      "requireExactIds(resources, resourceTypes, 'Resource allowlist', errors);",
      "requireExactIds(resources, resourceTypes, 'Resource inventory', errors);",
    ],
    [
      'standalone envelope non-production gate',
      'balanceConsumerEnvelopeSource',
      "AllowedPattern: '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'",
      "AllowedPattern: '^(dev|test|qa|sandbox|staging|production)(-[a-z0-9]+)*$'",
    ],
    [
      'standalone envelope receipt-only IAM',
      'balanceConsumerEnvelopeSource',
      '- sqs:ReceiveMessage',
      '- sqs:SendMessage',
    ],
    [
      'standalone envelope hard-zero service',
      'balanceConsumerEnvelopeSource',
      'DesiredCount: 0',
      'DesiredCount: 1',
    ],
    [
      'standalone envelope max receives',
      'balanceConsumerEnvelopeSource',
      "{ Name: SQS_MAX_RECEIVE_COUNT, Value: '3' }",
      "{ Name: SQS_MAX_RECEIVE_COUNT, Value: '4' }",
    ],
    [
      'standalone envelope retry base',
      'balanceConsumerEnvelopeSource',
      "{ Name: SQS_RETRY_BASE_DELAY_SECONDS, Value: '5' }",
      "{ Name: SQS_RETRY_BASE_DELAY_SECONDS, Value: '1' }",
    ],
    [
      'standalone envelope retry maximum',
      'balanceConsumerEnvelopeSource',
      "{ Name: SQS_RETRY_MAX_DELAY_SECONDS, Value: '60' }",
      "{ Name: SQS_RETRY_MAX_DELAY_SECONDS, Value: '59' }",
    ],
    [
      'standalone envelope validator resource allowlist',
      'balanceConsumerEnvelopeValidatorSource',
      "requireExactIds(resources, expectedResources, 'Resource allowlist', errors);",
      "requireExactIds(resources, new Map(resources), 'Resource allowlist', errors);",
    ],
    [
      'standalone envelope validator hard-zero enforcement',
      'balanceConsumerEnvelopeValidatorSource',
      "['DesiredCount', '0'],",
      "['DesiredCount', '1'],",
    ],
    [
      'standalone envelope validator reviewed digest',
      'balanceConsumerEnvelopeValidatorSource',
      "const reviewedTemplateSha256 = '3b621023e516cd553c34fbe09e4b0047d1395fab45e105eef7692570d6429045';",
      "const reviewedTemplateSha256 = '0b621023e516cd553c34fbe09e4b0047d1395fab45e105eef7692570d6429045';",
    ],
    [
      'standalone envelope validator receipt policy enforcement',
      'balanceConsumerEnvelopeValidatorSource',
      'SQS_RETRY_BASE_DELAY_SECONDS',
      'SQS_RETRY_BASE_DELAY_DISABLED_SECONDS',
    ],
    [
      'metadata transition production-aware environment',
      'balanceConsumerMetadataTransitionValidatorSource',
      'const ENVIRONMENT_PATTERN = /^(?:dev|test|qa|sandbox|staging|production)(?:-[a-z0-9]+)*$/u;',
      'const ENVIRONMENT_PATTERN = /^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/u;',
    ],
    [
      'metadata transition empty production authority',
      'balanceConsumerMetadataTransitionValidatorSource',
      'keys: [],',
      "keys: [{ status: 'APPROVED' }],",
    ],
    [
      'metadata transition zero external calls',
      'balanceConsumerMetadataTransitionValidatorSource',
      'externalCallsMade: 0,',
      'externalCallsMade: 1,',
    ],
    [
      'metadata transition zero file writes',
      'balanceConsumerMetadataTransitionValidatorSource',
      'filesWritten: 0,',
      'filesWritten: 1,',
    ],
    [
      'metadata transition ignored local record root',
      'balanceConsumerMetadataTransitionValidatorSource',
      "'.local-validation',",
      "'.production-validation',",
    ],
    [
      'metadata transition secure operational read',
      'balanceConsumerMetadataTransitionValidatorSource',
      '? readSecureLocalFile(resolvedPath, MAX_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD_BYTES)',
      '? readFileSync(resolvedPath)',
    ],
    [
      'bootstrap principal input',
      'bootstrapPrincipalsSource',
      '\\if :{?balance_consumer_runtime_role}',
      '\\if :{?balance_consumer_runtime_role_disabled}',
    ],
    [
      'bootstrap principal validator',
      'bootstrapPrincipalsValidatorSource',
      'Bootstrap must keep balance-consumer database, schema, and object ACLs denied',
      'Bootstrap may grant balance-consumer database, schema, and object ACLs',
    ],
    [
      'wallet resolver ACL',
      'walletAddressMigrationSource',
      'GRANT EXECUTE ON FUNCTION ${RESOLVE_ACTIVE_ADDRESS} TO ${worker};',
      'GRANT EXECUTE ON FUNCTION ${RESOLVE_ACTIVE_ADDRESS} TO ${balance_consumer_runtime_role};',
    ],
    [
      'worker authority suspension migration',
      'workerAuthoritySuspensionMigrationSource',
      '(functionIdentity) => `REVOKE EXECUTE ON FUNCTION ${functionIdentity} FROM ${worker};`,',
      '(functionIdentity) => `GRANT EXECUTE ON FUNCTION ${functionIdentity} TO ${worker};`,',
    ],
    [
      'worker authority suspension inventory',
      'workerAuthoritySuspensionMigrationSource',
      'MARK_STALE,',
      'MARK_STALE_DISABLED,',
    ],
    [
      'worker-only suspension target',
      'workerAuthoritySuspensionMigrationSource',
      "const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');",
      "const worker = identifier(names.balanceConsumerRuntimeRole, 'balanceConsumerRuntimeRole');",
    ],
    [
      'forward-only suspension',
      'workerAuthoritySuspensionMigrationSource',
      "USING ERRCODE = '55000';",
      "USING ERRCODE = '0A000';",
    ],
    [
      '0027 verification supersession',
      'workerAuthoritySuspensionMigrationSource',
      "supersedesVerificationOf: ['0027'],",
      "supersedesVerificationOf: ['0026'],",
    ],
    [
      'worker authority migration registration',
      'migrationIndexSource',
      '  suspendGenericWorkerBalanceAuthorityMigrationV0028,\n]);',
      ']);',
    ],
    [
      'worker authority test migration registration',
      'migrationIndexSource',
      '  suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028,\n]);',
      ']);',
    ],
    [
      'worker authority migration import',
      'migrationIndexSource',
      "} from './0028-suspend-generic-worker-balance-authority.migration';",
      "} from './0028-suspend-generic-worker-balance-authority.disabled';",
    ],
    [
      'worker authority migration export',
      'migrationIndexSource',
      '  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,',
      '  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS_DISABLED,',
    ],
    [
      'release entrypoint',
      'releaseManifestSource',
      "'blockchain-sync/application/balance-sync-consumer.cli.js',",
      "'blockchain-sync/application/disabled-balance-consumer.cli.js',",
    ],
    [
      'production container CLI boundary validator',
      'productionContainerValidatorSource',
      '...validateBalanceConsumerExecutable(sources),',
      '...validateBalanceConsumerExecutable({ ...sources, balanceConsumerCli: sources.balanceConsumerRuntime }),',
    ],
    [
      'production container dependency-empty runtime validator',
      'productionContainerValidatorSource',
      'runtimeWithoutComments === expectedDormantRuntime &&',
      'runtimeWithoutComments.length > 0 &&',
    ],
    [
      'metadata transition validation script',
      'rootPackageSource',
      'node infra/aws/validate-balance-consumer-metadata-secret-version-transition.mjs',
      'node infra/aws/validate-balance-consumer-metadata-secret-version-transition.disabled.mjs',
    ],
    [
      'metadata transition test script',
      'rootPackageSource',
      'node --test infra/aws/validate-balance-consumer-metadata-secret-version-transition.test.mjs',
      'node --test infra/aws/validate-balance-consumer-metadata-secret-version-transition.disabled.test.mjs',
    ],
  ];

  for (const [label, key, approved, rejected] of mutations) {
    const inspected = inspectBalanceConsumerDeploymentArtifacts(
      mutateBalanceConsumerArtifact(key, approved, rejected),
    );
    assert.deepEqual(inspected, INVALID_BALANCE_CONSUMER_DEPLOYMENT, label);
    assert.equal(Object.isFrozen(inspected), true, label);
  }
});

test('balance-consumer artifact shape, bounds, and private brand fail closed', () => {
  const missing = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missing.activationSource;
  const missingMetadataValidator = {
    ...BALANCE_CONSUMER_ARTIFACTS,
  } as Record<string, unknown>;
  delete missingMetadataValidator.balanceConsumerMetadataTransitionValidatorSource;
  const missingLifecycle = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingLifecycle.balanceConsumerLifecycleSource;
  const missingBalanceJsonRpc = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingBalanceJsonRpc.balanceJsonRpcSource;
  const missingEthereumIndexer = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingEthereumIndexer.ethereumBalanceIndexerSource;
  const missingSolanaIndexer = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingSolanaIndexer.solanaBalanceIndexerSource;
  const accessor = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  Object.defineProperty(accessor, 'activationSource', {
    enumerable: true,
    get() {
      throw new Error('must not read accessor');
    },
  });
  const withSymbol = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<PropertyKey, unknown>;
  withSymbol[Symbol('unexpected')] = 'value';
  const oversized = {
    ...BALANCE_CONSUMER_ARTIFACTS,
    activationSource: 'x'.repeat(256 * 1024 + 1),
  };
  const oversizedTotal = Object.fromEntries(
    Object.keys(BALANCE_CONSUMER_ARTIFACTS).map((key) => [key, 'x'.repeat(80 * 1024)]),
  );
  const malformedCandidates: readonly unknown[] = [
    null,
    {},
    missing,
    missingMetadataValidator,
    missingLifecycle,
    missingBalanceJsonRpc,
    missingEthereumIndexer,
    missingSolanaIndexer,
    { ...BALANCE_CONSUMER_ARTIFACTS, unexpected: 'value' },
    { ...BALANCE_CONSUMER_ARTIFACTS, runtimeSource: 1 },
    accessor,
    withSymbol,
    oversized,
    oversizedTotal,
    new Proxy(BALANCE_CONSUMER_ARTIFACTS, {
      ownKeys() {
        throw new Error('untrusted proxy');
      },
    }),
  ];
  for (const candidate of malformedCandidates) {
    assert.doesNotThrow(() => inspectBalanceConsumerDeploymentArtifacts(candidate));
    assert.deepEqual(inspectBalanceConsumerDeploymentArtifacts(candidate), {
      ...INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      inspected: false,
    });
  }

  const complete = completeInput(platformDirectory('LIVE_READ_ONLY'));
  const { balanceConsumerDeployment: intentionallyOmitted, ...legacyInput } = complete;
  assert.notEqual(intentionallyOmitted, undefined);
  const hostileInput = { ...complete } as ProductionPreflightInput;
  Object.defineProperty(hostileInput, 'balanceConsumerDeployment', {
    enumerable: true,
    get() {
      throw new Error('untrusted input getter');
    },
  });
  const forgedInputs: readonly ProductionPreflightInput[] = [
    legacyInput,
    hostileInput,
    {
      ...complete,
      balanceConsumerDeployment: Object.freeze({
        ...EXPECTED_DORMANT_BALANCE_CONSUMER_DEPLOYMENT,
      }),
    },
  ];
  for (const input of forgedInputs) {
    const report = evaluateProductionPreflight(input);
    assert.deepEqual(
      report.checks.find(({ id }) => id === 'BALANCE_CONSUMER'),
      {
        id: 'BALANCE_CONSUMER',
        localValidation: 'FAIL',
        launchReadiness: 'BLOCKED',
        blockerIds: ['BALANCE_CONSUMER_INSPECTION_FAILED'],
      },
    );
    assert.equal(report.readiness.publicReadOnly, 'BLOCKED');
  }
});

test('RDS master lifecycle evidence remains a private fail-closed launch gate', () => {
  const baseline = completeInput(platformDirectory('PLANNED'));
  const candidates: readonly unknown[] = [undefined, false, true, 'true', 1, null];
  for (const candidate of candidates) {
    const report = evaluateProductionPreflight({
      ...baseline,
      rdsMasterLifecycleEvidenceAccepted: candidate,
    } as ProductionPreflightInput);
    const authentication = report.checks.find(({ id }) => id === 'AUTHENTICATION');
    assert.equal(authentication?.localValidation, 'PASS');
    assert.ok(authentication?.blockerIds.includes('RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING'));
    assert.equal(report.selectedTargetReadiness, 'BLOCKED');
  }

  const authEvidenceMissing = evaluateProductionPreflight({
    ...baseline,
    authentication: { ...baseline.authentication, deployedEvidenceAccepted: false },
  });
  const authEvidenceBlockers =
    authEvidenceMissing.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds ?? [];
  assert.ok(authEvidenceBlockers.includes('AUTH_DEPLOYED_EVIDENCE_MISSING'));
  assert.ok(authEvidenceBlockers.includes('RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING'));

  const rdsEvidenceMissing = evaluateProductionPreflight({
    ...baseline,
    rdsMasterLifecycleEvidenceAccepted: false,
  });
  const rdsEvidenceBlockers =
    rdsEvidenceMissing.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds ?? [];
  assert.ok(rdsEvidenceBlockers.includes('RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING'));
  assert.equal(rdsEvidenceBlockers.includes('AUTH_DEPLOYED_EVIDENCE_MISSING'), false);
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
      .filter(
        ({ id }) =>
          id !== 'PRODUCTION_INFRASTRUCTURE' &&
          id !== 'BALANCE_CONSUMER' &&
          id !== 'AUTHENTICATION' &&
          id !== 'PUBLIC_LAUNCH_AUTHORITIES' &&
          id !== 'MAINNET_WRITES',
      )
      .every(({ launchReadiness }) => launchReadiness === 'LOCAL_GATES_CLEAR'),
  );
  assert.deepEqual(readOnlyReport.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds, [
    'RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING',
  ]);

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
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::${AuthWalletKeysSecretVersionId}'",
    "!Sub '${AuthWalletKeysSecretArn}:WRONG_PREAUTH_KEY::${AuthWalletKeysSecretVersionId}'",
    'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED',
  ],
  [
    'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_IDENTITY_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
    "!Sub '${AttackerSecretArn}:AUTH_IDENTITY_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
    'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED',
  ],
  [
    'AUTH_SESSION_HMAC_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_SESSION_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
    "!Sub '${AuthWalletKeysSecretArn}:WRONG_SESSION_KEY::${AuthWalletKeysSecretVersionId}'",
    'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED',
  ],
  [
    'AUTH_CSRF_HMAC_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_CSRF_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
    "!Sub '${AttackerSecretArn}:AUTH_CSRF_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
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
    "!Sub '${AuthWalletKeysSecretArn}:WALLET_IDENTITY_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
    "!Sub '${AuthWalletKeysSecretArn}:WRONG_WALLET_IDENTITY_KEY::${AuthWalletKeysSecretVersionId}'",
    'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
  ],
  [
    'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:WALLET_CHALLENGE_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
    "!Sub '${AttackerSecretArn}:WALLET_CHALLENGE_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
    'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED',
  ],
  [
    'WALLET_METADATA_SEAL_KEY_RING_JSON',
    'ValueFrom',
    "!Sub '${AuthWalletKeysSecretArn}:WALLET_METADATA_SEAL_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
    "!Sub '${AuthWalletKeysSecretArn}:WRONG_WALLET_SEAL_KEY::${AuthWalletKeysSecretVersionId}'",
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
      ['RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING', expectedBlocker, 'AUTH_DEPLOYED_EVIDENCE_MISSING'],
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
  assert.deepEqual(authentication?.blockerIds, [
    'RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING',
    'AUTH_DEPLOYED_EVIDENCE_MISSING',
  ]);
});

test('template inspection binds API and outbox worker to one API artifact', () => {
  const mutations = [
    [
      '      Command: [node, dist/infrastructure/outbox/outbox-worker.cli.js]\n      Essential: true\n      Image: !Ref ApiImageUri',
      '      Command: [node, dist/infrastructure/outbox/outbox-worker.cli.js]\n      Essential: true\n      Image: !Ref WebImageUri',
    ],
    ['      Image: !Ref ApiImageUri', '      Image: !Ref WebImageUri'],
    [' RdsCaBundlePath:', ' WorkerImageUri:\n  Type: String\n RdsCaBundlePath:'],
    ['/crypto-lending-api@sha256:[a-f0-9]{64}$', '/crypto-lending-[a-z0-9-]+@sha256:[a-f0-9]{64}$'],
  ] as const;

  for (const [approved, rejected] of mutations) {
    const mutated = APPLICATION_BASELINE.replace(approved, rejected);
    assert.notEqual(mutated, APPLICATION_BASELINE, approved);
    const inspected = inspectAuthenticationDeploymentTemplate(mutated);
    const input = completeInput(platformDirectory('PLANNED'));
    const report = evaluateProductionPreflight({ ...input, authentication: inspected });
    const blockers = report.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds ?? [];

    assert.equal(inspected.syntaxValid, false, approved);
    assert.ok(blockers.includes('AUTH_TEMPLATE_INSPECTION_FAILED'), approved);
  }
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

  assert.deepEqual(directReport.checks.find(({ id }) => id === 'AUTHENTICATION')?.blockerIds, [
    'RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING',
  ]);

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
    'RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING',
    'AUTH_DEPLOYED_EVIDENCE_MISSING',
  ]);
});

test('template inspection rejects every legacy single-key field mixed with key rings', () => {
  const environmentAnchor = '       - { Name: AUTH_PREAUTH_SEAL_KEY_ID, Value: preauth-v1 }';
  const secretAnchor =
    "       - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::${AuthWalletKeysSecretVersionId}' }";
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
      `${secretAnchor}\n       - { Name: ${name}, ValueFrom: !Sub '\${AuthWalletKeysSecretArn}:${name}::\${AuthWalletKeysSecretVersionId}' }`,
    );
    assert.notEqual(mutated, APPLICATION_BASELINE, name);
    const inspected = inspectAuthenticationDeploymentTemplate(mutated);
    assert.equal(inspected.syntaxValid, false, name);
  }
});

test('template inspection rejects unknown managed names, wrong sections, and local demo mode', () => {
  const environmentAnchor = '       - { Name: AUTH_PREAUTH_SEAL_KEY_ID, Value: preauth-v1 }';
  const secretAnchor =
    "       - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::${AuthWalletKeysSecretVersionId}' }";
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
      "       - { Name: AUTH_PUBLIC_ORIGIN, ValueFrom: !Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::${AuthWalletKeysSecretVersionId}' }",
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
Parameters:
 AuthWalletKeysSecretVersionId:
  Type: String
  MinLength: 32
  MaxLength: 64
  AllowedPattern: '^[A-Za-z0-9_-]{32,64}$'
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
       - { Name: AUTH_PREAUTH_SEAL_KEY, ValueFrom: !Sub '\${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::\${AuthWalletKeysSecretVersionId}' }
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

test('auth inspection requires one exact auditable auth/wallet secret VersionId parameter', () => {
  const parameterBlock = [
    ' AuthWalletKeysSecretVersionId:',
    '  Type: String',
    '  MinLength: 32',
    '  MaxLength: 64',
    "  AllowedPattern: '^[A-Za-z0-9_-]{32,64}$'",
  ].join('\n');
  const moveOutsideParameters = APPLICATION_BASELINE.replace(`${parameterBlock}\n`, '').replace(
    'Resources:\n',
    `Resources:\n${parameterBlock}\n`,
  );
  const nestedParameterBlock = parameterBlock
    .split('\n')
    .map((line) => ` ${line}`)
    .join('\n');
  const nestUnderAnotherParameter = APPLICATION_BASELINE.replace(`${parameterBlock}\n`, '').replace(
    ' EnvironmentName:\n',
    ` EnvironmentName:\n${nestedParameterBlock}\n`,
  );
  const mutations = [
    APPLICATION_BASELINE.replace(`${parameterBlock}\n`, ''),
    APPLICATION_BASELINE.replace(
      parameterBlock,
      parameterBlock.replace('  Type: String', '  Type: Number'),
    ),
    APPLICATION_BASELINE.replace(
      parameterBlock,
      parameterBlock.replace('  MinLength: 32', '  MinLength: 1'),
    ),
    APPLICATION_BASELINE.replace(
      parameterBlock,
      parameterBlock.replace('  MaxLength: 64', '  MaxLength: 128'),
    ),
    APPLICATION_BASELINE.replace(
      parameterBlock,
      parameterBlock.replace(
        "  AllowedPattern: '^[A-Za-z0-9_-]{32,64}$'",
        "  AllowedPattern: '^.+$'",
      ),
    ),
    APPLICATION_BASELINE.replace(
      parameterBlock,
      parameterBlock.replace('  Type: String', '  Type: String\n  Default: AWSCURRENT'),
    ),
    APPLICATION_BASELINE.replace(
      parameterBlock,
      parameterBlock.replace('  Type: String', '  Type: String\n  NoEcho: true'),
    ),
    APPLICATION_BASELINE.replace(`${parameterBlock}\n`, `${parameterBlock}\n${parameterBlock}\n`),
    moveOutsideParameters,
    nestUnderAnotherParameter,
  ];

  for (const mutated of mutations) {
    assert.notEqual(mutated, APPLICATION_BASELINE);
    assert.equal(inspectAuthenticationDeploymentTemplate(mutated).syntaxValid, false);
  }
});

test('auth inspection rejects mutable, omitted, or alternate auth/wallet secret versions', () => {
  const exact =
    '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::${AuthWalletKeysSecretVersionId}';
  for (const replacement of [
    '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::',
    '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY:AWSCURRENT:',
    '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY:AWSPREVIOUS:',
    '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::${ApiDatabaseSlotAVersionId}',
  ]) {
    const mutated = APPLICATION_BASELINE.replace(exact, replacement);
    assert.notEqual(mutated, APPLICATION_BASELINE, replacement);
    const authentication = inspectAuthenticationDeploymentTemplate(mutated);
    assert.equal(authentication.apiSecretNames.has('AUTH_PREAUTH_SEAL_KEY'), false, replacement);
    const report = evaluateProductionPreflight({
      ...completeInput(platformDirectory('PLANNED')),
      authentication,
    });
    assert.ok(
      report.checks
        .find(({ id }) => id === 'AUTHENTICATION')
        ?.blockerIds.includes('AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED'),
      replacement,
    );
  }
});

test('database master inspection accepts only the RDS-managed compatibility contract', () => {
  const inspected = inspectDatabaseMasterDeploymentTemplate(RDS_MANAGED_DATABASE_TEMPLATE);
  assert.deepEqual(inspected, { inspected: true, syntaxValid: true });

  const report = evaluateProductionPreflight({
    ...completeInput(platformDirectory('PLANNED')),
    databaseMasterDeployment: inspected,
  });
  const authentication = report.checks.find(({ id }) => id === 'AUTHENTICATION');
  assert.equal(authentication?.localValidation, 'PASS');
  assert.equal(
    authentication?.blockerIds.includes('DATABASE_MASTER_SECRET_NOT_RDS_MANAGED'),
    false,
  );

  const complete = completeInput(platformDirectory('PLANNED'));
  const { databaseMasterDeployment: intentionallyOmitted, ...legacyInput } = complete;
  assert.notEqual(intentionallyOmitted, undefined);
  const legacyReport = evaluateProductionPreflight(legacyInput);
  const legacyAuthentication = legacyReport.checks.find(({ id }) => id === 'AUTHENTICATION');
  assert.equal(legacyAuthentication?.localValidation, 'FAIL');
  assert.ok(legacyAuthentication?.blockerIds.includes('DATABASE_MASTER_SECRET_NOT_RDS_MANAGED'));
  assert.match(
    formatProductionPreflightReport(legacyReport),
    /DATABASE_MASTER_SECRET_NOT_RDS_MANAGED/u,
  );

  const forgedReport = evaluateProductionPreflight({
    ...completeInput(platformDirectory('PLANNED')),
    databaseMasterDeployment: Object.freeze({ inspected: true, syntaxValid: true }),
  });
  const forgedAuthentication = forgedReport.checks.find(({ id }) => id === 'AUTHENTICATION');
  assert.equal(forgedAuthentication?.localValidation, 'FAIL');
  assert.ok(forgedAuthentication?.blockerIds.includes('DATABASE_MASTER_SECRET_NOT_RDS_MANAGED'));
});

test('database master inspection rejects custom, mutable, counterfeit, or ambiguous bindings', () => {
  const mutate = (approved: string, rejected: string, label: string): string => {
    const result = RDS_MANAGED_DATABASE_TEMPLATE.replace(approved, rejected);
    assert.notEqual(result, RDS_MANAGED_DATABASE_TEMPLATE, label);
    return result;
  };
  const mutations = [
    [
      'managed password disabled',
      mutate('   ManageMasterUserPassword: true', '   ManageMasterUserPassword: false', 'mode'),
    ],
    ['managed password omitted', mutate('   ManageMasterUserPassword: true\n', '', 'missing mode')],
    [
      'managed password duplicated',
      mutate(
        '   ManageMasterUserPassword: true',
        '   ManageMasterUserPassword: true\n   ManageMasterUserPassword: true',
        'duplicate mode',
      ),
    ],
    [
      'counterfeit master username',
      mutate('   MasterUsername: crypto_admin', '   MasterUsername: attacker_admin', 'username'),
    ],
    [
      'mutable master username',
      mutate(
        '   MasterUsername: crypto_admin',
        "   MasterUsername: !Sub '{{resolve:secretsmanager:${DatabaseCredentialsSecret}:SecretString:username}}'",
        'dynamic username',
      ),
    ],
    [
      'master password dynamic reference',
      mutate(
        '   ManageMasterUserPassword: true',
        "   ManageMasterUserPassword: true\n   MasterUserPassword: !Sub '{{resolve:secretsmanager:${DatabaseCredentialsSecret}:SecretString:password}}'",
        'dynamic password',
      ),
    ],
    [
      'master password exact-version reference',
      mutate(
        '   ManageMasterUserPassword: true',
        "   ManageMasterUserPassword: true\n   MasterUserPassword: !Sub '{{resolve:secretsmanager:${DatabaseCredentialsSecret}:SecretString:password::${DatabaseCredentialsSecretVersionId}}'",
        'versioned password',
      ),
    ],
    [
      'wrong master-secret KMS key',
      mutate(
        '    KmsKeyId: !GetAtt ApplicationDataKey.Arn',
        '    KmsKeyId: alias/aws/secretsmanager',
        'KMS key',
      ),
    ],
    [
      'counterfeit ApplicationDataKey resource',
      mutate('  Type: AWS::KMS::Key', '  Type: AWS::SSM::Parameter', 'key resource'),
    ],
    [
      'custom database secret',
      mutate(
        ' Database:',
        ' DatabaseCredentialsSecret:\n  Type: AWS::SecretsManager::Secret\n Database:',
        'custom secret',
      ),
    ],
    [
      'quoted custom database secret',
      mutate(
        ' Database:',
        ' "DatabaseCredentialsSecret":\n  Type: AWS::SecretsManager::Secret\n Database:',
        'quoted custom secret',
      ),
    ],
    [
      'commented custom database secret',
      mutate(
        ' Database:',
        ' DatabaseCredentialsSecret: # legacy secret\n  Type: AWS::SecretsManager::Secret\n Database:',
        'commented custom secret',
      ),
    ],
    [
      'flow-form custom database secret',
      mutate(
        ' Database:',
        ' DatabaseCredentialsSecret: { Type: AWS::SecretsManager::Secret }\n Database:',
        'flow custom secret',
      ),
    ],
    [
      'quoted duplicate master username',
      mutate(
        '   MasterUsername: crypto_admin',
        '   MasterUsername: crypto_admin\n   "MasterUsername": attacker_admin',
        'quoted duplicate username',
      ),
    ],
    [
      'quoted duplicate managed-password mode',
      mutate(
        '   ManageMasterUserPassword: true',
        '   ManageMasterUserPassword: true\n   "ManageMasterUserPassword": false',
        'quoted duplicate mode',
      ),
    ],
    [
      'quoted duplicate master-secret block',
      mutate(
        '   MasterUserSecret:',
        '   MasterUserSecret:\n   "MasterUserSecret": { KmsKeyId: alias/aws/secretsmanager }',
        'quoted duplicate master secret',
      ),
    ],
    [
      'legacy compatibility output',
      mutate(
        '  Value: !GetAtt Database.MasterUserSecret.SecretArn',
        '  Value: !Ref DatabaseCredentialsSecret',
        'legacy output',
      ),
    ],
    [
      'alternate managed-secret output',
      mutate(
        '  Value: !GetAtt Database.MasterUserSecret.SecretArn',
        '  Value: !GetAtt AlternateDatabase.MasterUserSecret.SecretArn',
        'alternate output',
      ),
    ],
    [
      'ambiguous compatibility output',
      mutate(
        '  Value: !GetAtt Database.MasterUserSecret.SecretArn',
        '  Value: !GetAtt Database.MasterUserSecret.SecretArn\n  Value: !GetAtt Database.MasterUserSecret.SecretArn',
        'duplicate output',
      ),
    ],
    ['invalid trailing YAML', `${RDS_MANAGED_DATABASE_TEMPLATE}\n[`],
  ] as const;

  assert.deepEqual(inspectDatabaseMasterDeploymentTemplate(APPLICATION_BASELINE), {
    inspected: true,
    syntaxValid: true,
  });
  for (const [label, source] of mutations) {
    const inspected = inspectDatabaseMasterDeploymentTemplate(source);
    assert.equal(inspected.syntaxValid, false, label);
    const report = evaluateProductionPreflight({
      ...completeInput(platformDirectory('PLANNED')),
      databaseMasterDeployment: inspected,
    });
    const authentication = report.checks.find(({ id }) => id === 'AUTHENTICATION');
    assert.equal(authentication?.localValidation, 'FAIL', label);
    assert.ok(authentication?.blockerIds.includes('DATABASE_MASTER_SECRET_NOT_RDS_MANAGED'), label);
  }
});

test('production inspection accepts only the exact pinned Redis operator deployment contract', () => {
  const inspected = inspectRedisOperatorDeploymentTemplates(
    APPLICATION_BASELINE,
    APPLICATION_WORKLOAD_BOUNDARIES,
    APPLICATION_OBSERVABILITY,
  );
  assert.deepEqual(inspected, { inspected: true, syntaxValid: true });

  const report = evaluateProductionPreflight({
    ...completeInput(platformDirectory('PLANNED')),
    redisOperatorDeployment: inspected,
  });
  assert.equal(
    report.checks
      .find(({ id }) => id === 'AUTHENTICATION')
      ?.blockerIds.includes('REDIS_OPERATOR_SECRET_VERSION_NOT_WIRED'),
    false,
  );

  const complete = completeInput(platformDirectory('PLANNED'));
  const { redisOperatorDeployment: intentionallyOmitted, ...missingRedisInput } = complete;
  assert.notEqual(intentionallyOmitted, undefined);
  const missingReport = evaluateProductionPreflight(missingRedisInput);
  const missingCheck = missingReport.checks.find(({ id }) => id === 'AUTHENTICATION');
  assert.equal(missingCheck?.localValidation, 'FAIL');
  assert.ok(missingCheck?.blockerIds.includes('REDIS_OPERATOR_SECRET_VERSION_NOT_WIRED'));
});

test('Redis operator inspection rejects mutable selectors, unsafe adoption, and counterfeit parameters', () => {
  type Mutation = readonly [label: string, parent: string, workload: string, observability: string];
  const unchanged = [
    APPLICATION_BASELINE,
    APPLICATION_WORKLOAD_BOUNDARIES,
    APPLICATION_OBSERVABILITY,
  ] as const;
  const mutate = (source: string, approved: string, rejected: string, label: string): string => {
    const result = source.replace(approved, rejected);
    assert.notEqual(result, source, label);
    return result;
  };
  const mutateOccurrence = (
    source: string,
    approved: string,
    rejected: string,
    occurrence: number,
    label: string,
  ): string => {
    let offset = -1;
    for (let index = 0; index <= occurrence; index += 1) {
      offset = source.indexOf(approved, offset + 1);
      assert.notEqual(offset, -1, label);
    }
    return `${source.slice(0, offset)}${rejected}${source.slice(offset + approved.length)}`;
  };
  const parentParameter = [
    ' RedisOperatorSecretVersionId:',
    '  Type: String',
    "  AllowedPattern: '^(UNPINNED|[A-Za-z0-9_-]{32,64})$'",
  ].join('\n');
  const childParameter = [
    '  RedisOperatorSecretVersionId:',
    '    Type: String',
    "    AllowedPattern: '^(UNPINNED|[A-Za-z0-9_-]{32,64})$'",
  ].join('\n');
  const workloadSelector =
    '${RedisOperatorSecret}:SecretString:password::${RedisOperatorSecretVersionId}';
  const observabilitySelector =
    '${RedisOperatorSecretArn}:password::${RedisOperatorSecretVersionId}';
  const mutations: Mutation[] = [
    [
      'parent parameter default',
      mutate(
        unchanged[0],
        parentParameter,
        parentParameter.replace('  Type: String', '  Type: String\n  Default: UNPINNED'),
        'parent parameter default',
      ),
      unchanged[1],
      unchanged[2],
    ],
    [
      'parent counterfeit nested parameter',
      mutate(
        unchanged[0],
        parentParameter,
        parentParameter
          .split('\n')
          .map((line) => ` ${line}`)
          .join('\n'),
        'parent counterfeit nested parameter',
      ),
      unchanged[1],
      unchanged[2],
    ],
    [
      'workload propagation omitted',
      mutate(
        unchanged[0],
        '    RedisOperatorSecretVersionId: !Ref RedisOperatorSecretVersionId',
        '    RedisOperatorSecretVersionId: UNPINNED',
        'workload propagation omitted',
      ),
      unchanged[1],
      unchanged[2],
    ],
    [
      'observability propagation uses alternate parameter',
      mutateOccurrence(
        unchanged[0],
        '    RedisOperatorSecretVersionId: !Ref RedisOperatorSecretVersionId',
        '    RedisOperatorSecretVersionId: !Ref RedisApiSlotAVersionId',
        1,
        'observability propagation uses alternate parameter',
      ),
      unchanged[1],
      unchanged[2],
    ],
    [
      'parent unpinned state can enable operator',
      mutate(
        unchanged[0],
        '!Equals [!Ref RedisOperatorMode, DISABLED]',
        '!Equals [!Ref RedisOperatorMode, ENABLED]',
        'parent unpinned state can enable operator',
      ),
      unchanged[1],
      unchanged[2],
    ],
    [
      'parent rule permits an extra always-true OR branch',
      mutate(
        unchanged[0],
        '     AssertDescription: Credential versions must be all pinned or an inert A_ONLY adoption sentinel.',
        '      - !Equals [1, 1]\n     AssertDescription: Credential versions must be all pinned or an inert A_ONLY adoption sentinel.',
        'parent rule permits an extra always-true OR branch',
      ),
      unchanged[1],
      unchanged[2],
    ],
    [
      'parent rule duplicates the operator UNPINNED condition',
      mutateOccurrence(
        unchanged[0],
        '!Equals [!Ref RedisOperatorSecretVersionId, UNPINNED]',
        '!Equals [!Ref RedisOperatorSecretVersionId, UNPINNED], !Equals [!Ref RedisOperatorSecretVersionId, UNPINNED]',
        0,
        'parent rule duplicates the operator UNPINNED condition',
      ),
      unchanged[1],
      unchanged[2],
    ],
    [
      'workload parameter default',
      unchanged[0],
      mutate(
        unchanged[1],
        childParameter,
        childParameter.replace('    Type: String', '    Type: String\n    Default: UNPINNED'),
        'workload parameter default',
      ),
      unchanged[2],
    ],
    [
      'workload rule permits an extra always-true OR branch',
      unchanged[0],
      mutate(
        unchanged[1],
        '        AssertDescription: Fixed-slot and operator versions must be all pinned or an inert A_ONLY adoption sentinel.',
        '          - !Equals [1, 1]\n        AssertDescription: Fixed-slot and operator versions must be all pinned or an inert A_ONLY adoption sentinel.',
        'workload rule permits an extra always-true OR branch',
      ),
      unchanged[2],
    ],
    [
      'workload rule duplicates the operator UNPINNED condition',
      unchanged[0],
      mutate(
        unchanged[1],
        '                !Equals [!Ref RedisOperatorSecretVersionId, UNPINNED],',
        '                !Equals [!Ref RedisOperatorSecretVersionId, UNPINNED],\n                !Equals [!Ref RedisOperatorSecretVersionId, UNPINNED],',
        'workload rule duplicates the operator UNPINNED condition',
      ),
      unchanged[2],
    ],
    [
      'workload counterfeit nested parameter',
      unchanged[0],
      mutate(
        unchanged[1],
        childParameter,
        childParameter
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
        'workload counterfeit nested parameter',
      ),
      unchanged[2],
    ],
    [
      'workload duplicates the exact operator selector',
      unchanged[0],
      mutate(
        unchanged[1],
        "                !Sub '{{resolve:secretsmanager:${RedisOperatorSecret}:SecretString:password::${RedisOperatorSecretVersionId}}',",
        "                !Sub '{{resolve:secretsmanager:${RedisOperatorSecret}:SecretString:password::${RedisOperatorSecretVersionId}}',\n                !Sub '{{resolve:secretsmanager:${RedisOperatorSecret}:SecretString:password::${RedisOperatorSecretVersionId}}',",
        'workload duplicates the exact operator selector',
      ),
      unchanged[2],
    ],
    [
      'workload unpinned fallback still uses password',
      unchanged[0],
      mutateOccurrence(
        unchanged[1],
        '- { Type: no-password-required }',
        '- { Passwords: [mutable], Type: password }',
        2,
        'workload unpinned fallback still uses password',
      ),
      unchanged[2],
    ],
    [
      'workload alternate version',
      unchanged[0],
      mutate(
        unchanged[1],
        workloadSelector,
        '${RedisOperatorSecret}:SecretString:password::${RedisApiSlotAVersionId}',
        'workload alternate version',
      ),
      unchanged[2],
    ],
    [
      'observability parameter default',
      unchanged[0],
      unchanged[1],
      mutate(
        unchanged[2],
        childParameter,
        childParameter.replace('    Type: String', '    Type: String\n    Default: UNPINNED'),
        'observability parameter default',
      ),
    ],
    [
      'observability rule duplicates the operator version condition',
      unchanged[0],
      unchanged[1],
      mutate(
        unchanged[2],
        '            - !Not [!Equals [!Ref RedisOperatorSecretVersionId, UNPINNED]]',
        '            - !Not [!Equals [!Ref RedisOperatorSecretVersionId, UNPINNED]]\n            - !Not [!Equals [!Ref RedisOperatorSecretVersionId, UNPINNED]]',
        'observability rule duplicates the operator version condition',
      ),
    ],
    [
      'observability counterfeit nested parameter',
      unchanged[0],
      unchanged[1],
      mutate(
        unchanged[2],
        childParameter,
        childParameter
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
        'observability counterfeit nested parameter',
      ),
    ],
    [
      'observability duplicates the exact operator selector',
      unchanged[0],
      unchanged[1],
      mutate(
        unchanged[2],
        "              ValueFrom: !Sub '${RedisOperatorSecretArn}:password::${RedisOperatorSecretVersionId}'",
        "              ValueFrom: !Sub '${RedisOperatorSecretArn}:password::${RedisOperatorSecretVersionId}'\n              ValueFrom: !Sub '${RedisOperatorSecretArn}:password::${RedisOperatorSecretVersionId}'",
        'observability duplicates the exact operator selector',
      ),
    ],
    [
      'observability enabled rule omits version',
      unchanged[0],
      unchanged[1],
      mutate(
        unchanged[2],
        '            - !Not [!Equals [!Ref RedisOperatorSecretVersionId, UNPINNED]]\n',
        '',
        'observability enabled rule omits version',
      ),
    ],
    [
      'observability alternate version',
      unchanged[0],
      unchanged[1],
      mutate(
        unchanged[2],
        observabilitySelector,
        '${RedisOperatorSecretArn}:password::${RedisApiSlotAVersionId}',
        'observability alternate version',
      ),
    ],
  ];

  for (const [selectorName, exact, mutableCurrent, mutablePrevious] of [
    [
      'workload',
      workloadSelector,
      '${RedisOperatorSecret}:SecretString:password:AWSCURRENT:',
      '${RedisOperatorSecret}:SecretString:password:AWSPREVIOUS:',
    ],
    [
      'observability',
      observabilitySelector,
      '${RedisOperatorSecretArn}:password:AWSCURRENT:',
      '${RedisOperatorSecretArn}:password:AWSPREVIOUS:',
    ],
  ] as const) {
    const target = selectorName === 'workload' ? 1 : 2;
    for (const [kind, replacement] of [
      ['omitted', exact.replace(/::\$\{RedisOperatorSecretVersionId\}$/u, '::')],
      ['AWSCURRENT', mutableCurrent],
      ['AWSPREVIOUS', mutablePrevious],
    ] as const) {
      const sources: [string, string, string] = [...unchanged];
      sources[target] = mutate(sources[target], exact, replacement, `${selectorName} ${kind}`);
      mutations.push([`${selectorName} ${kind}`, sources[0], sources[1], sources[2]]);
    }
  }

  for (const [label, parent, workload, observability] of mutations) {
    const inspected = inspectRedisOperatorDeploymentTemplates(parent, workload, observability);
    assert.equal(inspected.syntaxValid, false, label);
    const report = evaluateProductionPreflight({
      ...completeInput(platformDirectory('PLANNED')),
      redisOperatorDeployment: inspected,
    });
    assert.ok(
      report.checks
        .find(({ id }) => id === 'AUTHENTICATION')
        ?.blockerIds.includes('REDIS_OPERATOR_SECRET_VERSION_NOT_WIRED'),
      label,
    );
  }
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
