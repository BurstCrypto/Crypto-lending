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
  inspectProviderPositionReadBoundaryArtifacts,
  inspectRedisOperatorDeploymentTemplates,
  loadRepositoryProductionPreflightInput,
  parseProductionPreflightArguments,
  productionDirectoryConfigurationSha256,
  productionPreflightCliErrorCode,
  productionPreflightExitCode,
  type BalanceConsumerArtifactSources,
  type ProviderPositionReadBoundaryArtifactSources,
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
  balanceSyncConsumerServiceSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/balance-sync-consumer.service.ts',
    ),
    'utf8',
  ),
  balanceSyncPortsSource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain-sync/application/ports/balance-sync.ports.ts'),
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
  mainnetBalanceIndexerRouterSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/mainnet-balance-indexer.router.ts',
    ),
    'utf8',
  ),
  mainnetBalanceTwoSourceAgreementCoordinatorSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/application/mainnet-balance-two-source-agreement.coordinator.ts',
    ),
    'utf8',
  ),
  balanceJsonRpcSource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain-sync/infrastructure/rpc/balance-json-rpc.ts'),
    'utf8',
  ),
  nodeHttpsBalanceJsonRpcTransportSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport.ts',
    ),
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
  supportedAssetRegistrySource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain/domain/supported-asset-registry.ts'),
    'utf8',
  ),
  walletIdentitySource: readFileSync(
    resolve(__dirname, '../apps/api/src/wallets/domain/wallet-identity.ts'),
    'utf8',
  ),
  solanaTokenAccountSource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain/domain/solana-token-account.ts'),
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
  rootPackageLockSource: readFileSync(resolve(__dirname, '../package-lock.json'), 'utf8'),
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
  providerPositionChainAnchorEvidenceMigrationSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/infrastructure/database/migrations/0029-create-provider-position-chain-anchor-evidence.migration.ts',
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
const PROVIDER_POSITION_READ_ARTIFACTS = Object.freeze({
  providerPositionReaderPortSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/ports/mainnet-provider-position-reader.port.ts',
    ),
    'utf8',
  ),
  providerPositionTrustedAssemblyPortSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/ports/provider-position-trusted-chain-assessment-assembly.port.ts',
    ),
    'utf8',
  ),
  providerPositionDurableChainAnchorReaderPortSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/ports/provider-position-durable-chain-anchor-reader.port.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorEvidenceSourcePortSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-source.port.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorEvidenceProducerSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/dormant-provider-position-chain-anchor-evidence.producer.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorCandidateFinalityPortSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/ports/provider-position-chain-anchor-candidate-finality.port.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorCandidateFinalityFinalizerSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/dormant-provider-position-chain-anchor-candidate-finality.finalizer.ts',
    ),
    'utf8',
  ),
  providerPositionAaveV3EthereumSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/dormant-aave-v3-ethereum-provider-position.source.ts',
    ),
    'utf8',
  ),
  providerPositionKaminoSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/dormant-kamino-provider-position-admission.source.ts',
    ),
    'utf8',
  ),
  providerPositionCompoundIIIEthereumSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/dormant-compound-iii-ethereum-provider-position.source.ts',
    ),
    'utf8',
  ),
  providerPositionSparkLendEthereumSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/dormant-sparklend-ethereum-provider-position.source.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorEvidenceRecorderPortSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-recorder.port.ts',
    ),
    'utf8',
  ),
  providerPositionPostgresChainAnchorEvidenceRecorderSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/postgres-provider-position-chain-anchor-evidence.recorder.ts',
    ),
    'utf8',
  ),
  providerPositionPostgresDurableChainAnchorReaderSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/postgres-provider-position-durable-chain-anchor.reader.ts',
    ),
    'utf8',
  ),
  providerPositionTrustedChainAssessmentAssemblerSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/dormant-provider-position-trusted-chain-assessment.assembler.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorEvidenceMigrationSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/infrastructure/database/migrations/0029-create-provider-position-chain-anchor-evidence.migration.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorRecordDeadlineMigrationSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/infrastructure/database/migrations/0030-enforce-provider-position-chain-anchor-record-deadline.migration.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorRecordIntentMigrationSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/infrastructure/database/migrations/0031-create-provider-position-chain-anchor-record-intents.migration.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorRecordIntentReconciliationPortSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/ports/provider-position-chain-anchor-record-intent-reconciliation.port.ts',
    ),
    'utf8',
  ),
  providerPositionPostgresChainAnchorRecordIntentReconciliationProcessorSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/postgres-provider-position-chain-anchor-record-intent.reconciliation-processor.ts',
    ),
    'utf8',
  ),
  providerPositionChainAnchorRecordIntentReconciliationLifecycleSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/provider-position-chain-anchor-record-intent-reconciliation.lifecycle.ts',
    ),
    'utf8',
  ),
  providerPositionMigrationIndexSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/database/migrations/index.ts'),
    'utf8',
  ),
  providerPositionAdmissionCoordinatorSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/application/provider-position-admission.coordinator.ts',
    ),
    'utf8',
  ),
  providerPositionDeadlineRunnerSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/node-provider-position-admission-deadline.runner.ts',
    ),
    'utf8',
  ),
  providerPositionRuntimeBoundsSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/provider-position-admission-runtime-bounds.ts',
    ),
    'utf8',
  ),
  providerPositionRuntimeCompositionSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/infrastructure/provider-position-admission-runtime.composition.ts',
    ),
    'utf8',
  ),
  providerPositionInfrastructureConfigSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/config/infrastructure.config.ts'),
    'utf8',
  ),
  providerPositionRuntimePostgresPoolSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/database/runtime-postgres-pool.ts'),
    'utf8',
  ),
  portfolioWalletRegistrationReaderPortSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/portfolio/application/ports/portfolio-wallet-registration-reader.port.ts',
    ),
    'utf8',
  ),
  registeredPortfolioWalletReaderSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/portfolio/infrastructure/registered-portfolio-wallet-reader.ts',
    ),
    'utf8',
  ),
  walletRegistrationServiceSource: readFileSync(
    resolve(__dirname, '../apps/api/src/wallets/application/wallet-registration.service.ts'),
    'utf8',
  ),
  walletRegistrationRepositoryPortSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/wallets/application/ports/wallet-registration-repository.port.ts',
    ),
    'utf8',
  ),
  postgresWalletRegistrationRepositorySource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/wallets/infrastructure/postgres/postgres-wallet-registration.repository.ts',
    ),
    'utf8',
  ),
  providerPositionPostgresServiceSource: readFileSync(
    resolve(__dirname, '../apps/api/src/infrastructure/database/postgres.service.ts'),
    'utf8',
  ),
  providerPositionCoverageSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/domain/mainnet-provider-position-coverage.ts',
    ),
    'utf8',
  ),
  providerPositionObservationSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/domain/mainnet-provider-position-observation.ts',
    ),
    'utf8',
  ),
  providerPositionChainAssessmentSource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/domain/mainnet-provider-position-chain-assessment.ts',
    ),
    'utf8',
  ),
  providerPositionObservationPolicySource: readFileSync(
    resolve(
      __dirname,
      '../apps/api/src/mainnet-platforms/domain/mainnet-provider-position-observation-policy.ts',
    ),
    'utf8',
  ),
  mainnetLaunchNetworkPolicySource: readFileSync(
    resolve(__dirname, '../apps/api/src/blockchain/domain/mainnet-launch-network-policy.ts'),
    'utf8',
  ),
  mainnetPlatformsModuleSource: readFileSync(
    resolve(__dirname, '../apps/api/src/mainnet-platforms/mainnet-platforms.module.ts'),
    'utf8',
  ),
  mainnetPlatformsIndexSource: readFileSync(
    resolve(__dirname, '../apps/api/src/mainnet-platforms/index.ts'),
    'utf8',
  ),
  mainnetPlatformsControllerSource: readFileSync(
    resolve(__dirname, '../apps/api/src/mainnet-platforms/http/mainnet-platforms.controller.ts'),
    'utf8',
  ),
} satisfies ProviderPositionReadBoundaryArtifactSources);
const VERIFIED_BALANCE_CONSUMER_DEPLOYMENT = inspectBalanceConsumerDeploymentArtifacts(
  BALANCE_CONSUMER_ARTIFACTS,
);
const VERIFIED_PROVIDER_POSITION_READ_BOUNDARY = inspectProviderPositionReadBoundaryArtifacts(
  PROVIDER_POSITION_READ_ARTIFACTS,
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
const EXPECTED_DORMANT_PROVIDER_POSITION_READ_BOUNDARY = Object.freeze({
  inspected: true,
  contractValid: true,
  readerFeatureRegistration: 'MISSING',
  trustedAssessmentFeatureRegistration: 'MISSING',
  deadlineRunnerFeatureRegistration: 'MISSING',
} as const);
const EXPECTED_DORMANT_PROVIDER_POSITION_READ_BOUNDARY_BLOCKERS = Object.freeze([
  'PROVIDER_POSITION_READER_FEATURE_REGISTRATION_MISSING',
  'PROVIDER_POSITION_TRUSTED_ASSESSMENT_FEATURE_REGISTRATION_MISSING',
  'PROVIDER_POSITION_DEADLINE_RUNNER_FEATURE_REGISTRATION_MISSING',
] satisfies readonly ProductionPreflightBlockerId[]);
const INVALID_PROVIDER_POSITION_READ_BOUNDARY = Object.freeze({
  inspected: true,
  contractValid: false,
  readerFeatureRegistration: 'INVALID',
  trustedAssessmentFeatureRegistration: 'INVALID',
  deadlineRunnerFeatureRegistration: 'INVALID',
} as const);
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
    providerPositionReadBoundary: VERIFIED_PROVIDER_POSITION_READ_BOUNDARY,
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
      dormantInventoryValidationPassed: true,
      activeScopeResearchCaptureValidationPassed: true,
      externalStatus: 'APPROVED',
      runtimeStatus: 'APPROVED',
      approvalBoundaryApproved: true,
      liveEvidenceAccepted: true,
    },
    platforms: {
      directory,
      dormantActionBoundaryValidationPassed: true,
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
  assert.deepEqual(
    input.providerPositionReadBoundary,
    EXPECTED_DORMANT_PROVIDER_POSITION_READ_BOUNDARY,
  );
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
  assert.equal(input.rpcProviders.dormantInventoryValidationPassed, true);
  assert.equal(input.rpcProviders.activeScopeResearchCaptureValidationPassed, true);
  assert.equal(input.platforms.dormantActionBoundaryValidationPassed, true);
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
  assert.deepEqual(
    readOnly.checks.find(({ id }) => id === 'PROVIDER_POSITION_READ_BOUNDARY'),
    {
      id: 'PROVIDER_POSITION_READ_BOUNDARY',
      localValidation: 'PASS',
      launchReadiness: 'BLOCKED',
      blockerIds: EXPECTED_DORMANT_PROVIDER_POSITION_READ_BOUNDARY_BLOCKERS,
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
  assert.deepEqual(
    cliReport.checks.find(({ id }) => id === 'PROVIDER_POSITION_READ_BOUNDARY')?.blockerIds,
    EXPECTED_DORMANT_PROVIDER_POSITION_READ_BOUNDARY_BLOCKERS,
  );
});

test('RPC provider decision, dormant inventory, and research capture fail independently', () => {
  const baseline = completeInput(platformDirectory('LIVE_READ_ONLY'));
  const inventoryFailed = {
    ...baseline,
    rpcProviders: {
      ...baseline.rpcProviders,
      dormantInventoryValidationPassed: false,
    },
  };

  for (const target of ['read-only', 'mainnet-write'] as const) {
    const report = evaluateProductionPreflight(inventoryFailed, target);
    assert.deepEqual(
      report.checks.find(({ id }) => id === 'RPC_INDEXING'),
      {
        id: 'RPC_INDEXING',
        localValidation: 'FAIL',
        launchReadiness: 'BLOCKED',
        blockerIds: ['RPC_PROVIDER_DORMANT_INVENTORY_LOCAL_VALIDATION_FAILED'],
      },
    );
    assert.equal(report.selectedTargetReadiness, 'BLOCKED');
  }

  const decisionFailed = evaluateProductionPreflight({
    ...baseline,
    rpcProviders: {
      ...baseline.rpcProviders,
      localValidationPassed: false,
    },
  });
  assert.deepEqual(
    decisionFailed.checks.find(({ id }) => id === 'RPC_INDEXING'),
    {
      id: 'RPC_INDEXING',
      localValidation: 'FAIL',
      launchReadiness: 'BLOCKED',
      blockerIds: ['RPC_PROVIDER_DECISION_LOCAL_VALIDATION_FAILED'],
    },
  );

  const researchCaptureFailed = {
    ...baseline,
    rpcProviders: {
      ...baseline.rpcProviders,
      activeScopeResearchCaptureValidationPassed: false,
    },
  };
  for (const target of ['read-only', 'mainnet-write'] as const) {
    const report = evaluateProductionPreflight(researchCaptureFailed, target);
    assert.deepEqual(
      report.checks.find(({ id }) => id === 'RPC_INDEXING'),
      {
        id: 'RPC_INDEXING',
        localValidation: 'FAIL',
        launchReadiness: 'BLOCKED',
        blockerIds: ['RPC_PROVIDER_ACTIVE_SCOPE_RESEARCH_CAPTURE_LOCAL_VALIDATION_FAILED'],
      },
    );
    assert.equal(report.selectedTargetReadiness, 'BLOCKED');
  }

  const { dormantInventoryValidationPassed: omitted, ...withoutInventoryResult } =
    baseline.rpcProviders;
  assert.equal(omitted, true);
  for (const dormantInventoryValidationPassed of [undefined, 'true', 1, null]) {
    const report = evaluateProductionPreflight({
      ...baseline,
      rpcProviders: {
        ...withoutInventoryResult,
        dormantInventoryValidationPassed,
      } as unknown as ProductionPreflightInput['rpcProviders'],
    });
    assert.ok(
      report.checks
        .find(({ id }) => id === 'RPC_INDEXING')
        ?.blockerIds.includes('RPC_PROVIDER_DORMANT_INVENTORY_LOCAL_VALIDATION_FAILED'),
    );
  }

  const { activeScopeResearchCaptureValidationPassed: captureOmitted, ...withoutCaptureResult } =
    baseline.rpcProviders;
  assert.equal(captureOmitted, true);
  for (const activeScopeResearchCaptureValidationPassed of [undefined, 'true', 1, null]) {
    const report = evaluateProductionPreflight({
      ...baseline,
      rpcProviders: {
        ...withoutCaptureResult,
        activeScopeResearchCaptureValidationPassed,
      } as unknown as ProductionPreflightInput['rpcProviders'],
    });
    assert.ok(
      report.checks
        .find(({ id }) => id === 'RPC_INDEXING')
        ?.blockerIds.includes('RPC_PROVIDER_ACTIVE_SCOPE_RESEARCH_CAPTURE_LOCAL_VALIDATION_FAILED'),
    );
  }
});

test('dormant mainnet action boundary fails the isolation and write gates independently', () => {
  const baseline = completeInput(platformDirectory('LIVE_READ_ONLY'));
  const { dormantActionBoundaryValidationPassed: omitted, ...withoutActionBoundaryResult } =
    baseline.platforms;
  assert.equal(omitted, true);

  for (const dormantActionBoundaryValidationPassed of [false, undefined, 'true', 1, null]) {
    const report = evaluateProductionPreflight({
      ...baseline,
      platforms: {
        ...withoutActionBoundaryResult,
        dormantActionBoundaryValidationPassed,
      } as unknown as ProductionPreflightInput['platforms'],
    });

    assert.equal(report.checks.find(({ id }) => id === 'RPC_INDEXING')?.localValidation, 'PASS');
    assert.deepEqual(
      report.checks.find(({ id }) => id === 'READ_ONLY_ISOLATION'),
      {
        id: 'READ_ONLY_ISOLATION',
        localValidation: 'FAIL',
        launchReadiness: 'BLOCKED',
        blockerIds: ['MAINNET_ACTION_BOUNDARY_LOCAL_VALIDATION_FAILED'],
      },
    );
    assert.ok(
      report.checks
        .find(({ id }) => id === 'MAINNET_WRITES')
        ?.blockerIds.includes('MAINNET_ACTION_BOUNDARY_LOCAL_VALIDATION_FAILED'),
    );
    assert.equal(report.selectedTargetReadiness, 'BLOCKED');
  }
});

function mutateProviderPositionReadArtifact(
  key: keyof ProviderPositionReadBoundaryArtifactSources,
  approved: string,
  rejected: string,
): ProviderPositionReadBoundaryArtifactSources {
  const source = PROVIDER_POSITION_READ_ARTIFACTS[key];
  assert.ok(source.includes(approved), `fixture is missing ${key} mutation target`);
  return {
    ...PROVIDER_POSITION_READ_ARTIFACTS,
    [key]: source.replace(approved, rejected),
  };
}

test('provider-position read inspection pins the exact dormant critical source slice', () => {
  assert.equal(Object.keys(PROVIDER_POSITION_READ_ARTIFACTS).length, 42);
  const inspected = inspectProviderPositionReadBoundaryArtifacts(PROVIDER_POSITION_READ_ARTIFACTS);
  assert.deepEqual(inspected, EXPECTED_DORMANT_PROVIDER_POSITION_READ_BOUNDARY);
  assert.equal(Object.isFrozen(inspected), true);

  for (const key of Object.keys(
    PROVIDER_POSITION_READ_ARTIFACTS,
  ) as readonly (keyof ProviderPositionReadBoundaryArtifactSources)[]) {
    const source = PROVIDER_POSITION_READ_ARTIFACTS[key];
    const replacement = source.endsWith('x') ? 'y' : 'x';
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts({
        ...PROVIDER_POSITION_READ_ARTIFACTS,
        [key]: `${source.slice(0, -1)}${replacement}`,
      }),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key} byte drift`,
    );
  }
});

test('provider-position read semantic gate contains no disabled-check bypass', () => {
  const source = readFileSync(PREFLIGHT_SCRIPT_PATH, 'utf8');
  const recordDeadlineMigrationStart = source.indexOf(
    'function hasDormantProviderPositionChainAnchorRecordDeadlineMigrationContract(',
  );
  const producerStart = source.indexOf(
    'function hasDormantProviderPositionChainAnchorEvidenceProducerContract(',
    recordDeadlineMigrationStart,
  );
  const finalityStart = source.indexOf(
    'function hasDormantProviderPositionChainAnchorCandidateFinalityContract(',
    producerStart,
  );
  const recorderStart = source.indexOf(
    'function hasDormantProviderPositionChainAnchorEvidenceRecorderContract(',
    finalityStart,
  );
  const recordIntentMigrationStart = source.indexOf(
    'function hasDormantProviderPositionChainAnchorRecordIntentMigrationContract(',
    recorderStart,
  );
  const reconciliationStart = source.indexOf(
    'function hasDormantProviderPositionChainAnchorRecordIntentReconciliationContract(',
    recordIntentMigrationStart,
  );
  const reconciliationLifecycleStart = source.indexOf(
    'function hasDormantProviderPositionChainAnchorRecordIntentReconciliationLifecycleContract(',
    reconciliationStart,
  );
  const aaveV3EthereumStart = source.indexOf(
    'function hasDormantAaveV3EthereumProviderPositionSourceContract(',
    reconciliationLifecycleStart,
  );
  const kaminoStart = source.indexOf(
    'function hasDormantKaminoProviderPositionSourceContract(',
    aaveV3EthereumStart,
  );
  const compoundIIIEthereumStart = source.indexOf(
    'function hasDormantCompoundIIIEthereumProviderPositionSourceContract(',
    kaminoStart,
  );
  const sparkLendEthereumStart = source.indexOf(
    'function hasDormantSparkLendEthereumProviderPositionSourceContract(',
    compoundIIIEthereumStart,
  );
  const start = source.indexOf(
    'function hasDormantProviderPositionReadBoundaryContract(',
    sparkLendEthereumStart,
  );
  const end = source.indexOf('\nfunction ', start + 1);
  assert.ok(
    recordDeadlineMigrationStart >= 0 &&
      producerStart > recordDeadlineMigrationStart &&
      finalityStart > producerStart &&
      recorderStart > finalityStart &&
      recordIntentMigrationStart > recorderStart &&
      reconciliationStart > recordIntentMigrationStart &&
      reconciliationLifecycleStart > reconciliationStart &&
      aaveV3EthereumStart > reconciliationLifecycleStart &&
      kaminoStart > aaveV3EthereumStart &&
      compoundIIIEthereumStart > kaminoStart &&
      sparkLendEthereumStart > compoundIIIEthereumStart &&
      start > sparkLendEthereumStart &&
      end > start,
  );
  const semanticGateSource = source
    .slice(recordDeadlineMigrationStart, end)
    .replaceAll('!== true ||', '!== true OR');
  assert.doesNotMatch(
    semanticGateSource,
    /(?:\btrue\s*\|\||\|\|\s*true\b|\bfalse\s*&&|&&\s*false\b|\.(?:skip|todo)\s*\()/u,
  );
});

test('provider-position read inspection rejects dormant two-source evidence producer drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionChainAnchorEvidenceSourcePortSource',
      'export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION = 1 as const;',
      'export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION = 2 as const;',
    ],
    [
      'providerPositionChainAnchorEvidenceSourcePortSource',
      'readonly mayPersist: false;',
      'readonly mayPersist: true;',
    ],
    [
      'providerPositionChainAnchorEvidenceSourcePortSource',
      '): Promise<unknown>;',
      '): Promise<ProviderPositionChainAnchorEvidenceSourceAttestationV1>;',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      "approvalStatus: 'NOT_APPROVED' as const,",
      "approvalStatus: 'APPROVED' as const,",
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'pairs: Object.freeze([]) as readonly ProviderPositionChainAnchorEvidenceSourcePairV1[],',
      'pairs: Object.freeze([{}]) as readonly ProviderPositionChainAnchorEvidenceSourcePairV1[],',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'primary.sourceFamilyId === corroborating.sourceFamilyId ||',
      'false ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'compare(identityKey(primary), identityKey(corroborating)) >= 0',
      'compare(identityKey(primary), identityKey(corroborating)) < 0',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'candidate.approvedAt,',
      'void candidate.approvedAt,',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      '[candidate.primary.sourceFamilyId, candidate.primary.sourceId, candidate.primary.sourceKind],',
      '[candidate.primary.sourceFamilyId, candidate.primary.sourceId],',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'current !== Object.prototype &&',
      'current !== null &&',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      "const readAttestation = stableDataMember(receiver, 'readAttestation', 'INVALID_CONFIGURATION');",
      'const readAttestation = receiver.readAttestation;',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'new Set(normalized.map(({ receiver }) => receiver)).size !== normalized.length ||',
      'false ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'identity.sourceKind === request.sourceKind,',
      'true,',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'signal: request.signal,',
      'signal: new AbortController().signal,',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'chainAnchor: request.chainAnchor,',
      'chainAnchor: request.continuityFloor,',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'request.deadlineAt.milliseconds - evaluatedAt.milliseconds > MAX_DEADLINE_MILLISECONDS',
      'request.deadlineAt.milliseconds - evaluatedAt.milliseconds > 300_000',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'const [primaryResult, corroboratingResult] = await Promise.allSettled([',
      'const [primaryResult, corroboratingResult] = await Promise.all([',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'settledAt.milliseconds >= request.deadlineAt.milliseconds ||',
      'settledAt.milliseconds > request.deadlineAt.milliseconds ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'currentPair(this.#registry, request.networkId, settledAt.milliseconds);',
      'void settledAt;',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'if (!primaryAuthentic || !corroboratingAuthentic) {',
      'if (!primaryAuthentic && !corroboratingAuthentic) {',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'verifiedAt.milliseconds >= request.deadlineAt.milliseconds ||',
      'verifiedAt.milliseconds > request.deadlineAt.milliseconds ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'verifiedAt.milliseconds >= request.deadlineAt.milliseconds ||\n      aborted(request.signal)',
      'verifiedAt.milliseconds >= request.deadlineAt.milliseconds ||\n      false',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'currentPair(this.#registry, request.networkId, verifiedAt.milliseconds);',
      'void verifiedAt;',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'primaryResult.value === corroboratingResult.value',
      'false',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'request,\n      evaluatedAt,\n      verifiedAt,',
      'request,\n      evaluatedAt,\n      settledAt,',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'evaluatedAt.milliseconds > assessedAt.milliseconds ||',
      'request.observedAt.milliseconds > assessedAt.milliseconds ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'assessedAt.milliseconds > completed.milliseconds ||',
      'assessedAt.milliseconds < completed.milliseconds ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      '!sameAnchor(primary.currentHead, corroborating.currentHead) ||',
      'false ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      '!sameAnchor(primary.finalizedHead, corroborating.finalizedHead)',
      'false',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'assessedAt.milliseconds >= request.deadlineAt.milliseconds ||',
      'assessedAt.milliseconds > request.deadlineAt.milliseconds ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'currentPair(this.#registry, request.networkId, assessedAt.milliseconds);',
      'void assessedAt;',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'completedMilliseconds >= currentHeadAdvancedAtMilliseconds + currentLifetime ||',
      'completedMilliseconds > currentHeadAdvancedAtMilliseconds + currentLifetime ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'reviewedRegistry.fingerprintSha256,',
      'void reviewedRegistry.fingerprintSha256,',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'corroborating.lineageProofSha256,',
      'primary.lineageProofSha256,',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'primary.currentHeadAdvancedAt.value,',
      'void primary.currentHeadAdvancedAt.value,',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'const identityProofSha256 = aggregateProof(',
      'const identityProofSha256 = primary.identityProofSha256 || aggregateProof(',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'if (new Set([identityProofSha256, liveCapabilityProofSha256, lineageProofSha256]).size !== 3) {',
      'if (false) {',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'request.sourceObservationId,\n      request.continuityFloor,',
      'selectedPair.corroborating.sourceId,\n      request.continuityFloor,',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'readonly #issued = new WeakMap<object, IssuedCandidate>();',
      'readonly #issued = new Map<object, IssuedCandidate>();',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'issuedAt.milliseconds >= request.deadlineAt.milliseconds ||',
      'issuedAt.milliseconds > request.deadlineAt.milliseconds ||',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'currentPair(this.#registry, request.networkId, issuedAt.milliseconds);',
      'void issuedAt;',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'if (issued === undefined || issued.request !== request || issued.candidate !== capability) {',
      'if (issued === undefined) {',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'currentPair(this.#registry, issued.networkId, reviewedAt.milliseconds);',
      'void reviewedAt;',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      "import { createHash } from 'node:crypto';",
      "import { request } from 'node:https';",
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'const PRODUCE_REQUEST_KEYS = Object.freeze([',
      'void process.env.PROVIDER_ENDPOINT;\nconst PRODUCE_REQUEST_KEYS = Object.freeze([',
    ],
    [
      'providerPositionChainAnchorEvidenceProducerSource',
      'const PRODUCE_REQUEST_KEYS = Object.freeze([',
      "void database.query('SELECT record_provider_position_chain_anchor_evidence()');\nconst PRODUCE_REQUEST_KEYS = Object.freeze([",
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor, DormantProviderPositionChainAnchorEvidenceProducer],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { DormantProviderPositionChainAnchorEvidenceProducer } from './application/dormant-provider-position-chain-anchor-evidence.producer';",
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read inspection rejects dormant candidate-finality drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionChainAnchorCandidateFinalityPortSource',
      'readonly mayAuthorizeFinancialAction: false;',
      'readonly mayAuthorizeFinancialAction: true;',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityPortSource',
      'readonly mayPersist: false;',
      'readonly mayPersist: true;',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityPortSource',
      'readonly mayCreatePositionSnapshot: false;',
      'readonly mayCreatePositionSnapshot: true;',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityPortSource',
      'readonly claimsSameSlotForkDetection: false;',
      'readonly claimsSameSlotForkDetection: true;',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityPortSource',
      'readonly producerCapability: unknown;',
      'readonly producerCapability: object;',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityPortSource',
      'readonly signal: AbortSignal;',
      'readonly assessedAt: string;',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      "import { isProxy } from 'node:util/types';",
      "import { request } from 'node:https';",
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'mayAuthorizeFinancialAction: false as const,',
      'mayAuthorizeFinancialAction: true as const,',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'mayPersist: false as const,',
      'mayPersist: true as const,',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'mayCreatePositionSnapshot: false as const,',
      'mayCreatePositionSnapshot: true as const,',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      "if (firstReview !== request.producerCapability) return fail('CANDIDATE_UNAVAILABLE');",
      'if (firstReview === request.producerCapability) return firstReview;',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'const candidate = reviewedCandidate(firstReview, request.producerRequest);',
      'const candidate = reviewedCandidate(request.producerCapability, request.producerRequest);',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'if (secondReview !== firstReview || secondReview !== candidate.candidate) {',
      'if (secondReview !== firstReview && secondReview !== candidate.candidate) {',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'return candidate.finalizedHead.blockHash === candidate.candidateAnchor.blockHash',
      'return candidate.finalizedHead.blockHash !== candidate.candidateAnchor.blockHash',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'const lineageProofSha256 = nonzeroSha256(values[15]);',
      'const lineageProofSha256 = String(values[15]);',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'const finalizedRoot = BigInt(candidate.finalizedHead.root);',
      'const finalizedRoot = BigInt(candidate.finalizedHead.slot);',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'if (finalizedRoot < candidateObservedRoot) {',
      'if (finalizedRoot > candidateObservedRoot) {',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'now.milliseconds >= candidate.expiresAtExclusive.milliseconds ||',
      'now.milliseconds > candidate.expiresAtExclusive.milliseconds ||',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'request.deadlineAt.milliseconds,\n      approvalExpiresAt.milliseconds,',
      'approvalExpiresAt.milliseconds,\n      approvalExpiresAt.milliseconds,',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'approvalExpiresAt.milliseconds,\n      currentHeadAdvancedAt.milliseconds + currentLifetime,',
      'request.deadlineAt.milliseconds,\n      currentHeadAdvancedAt.milliseconds + currentLifetime,',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'const SOLANA_CURRENT_HEAD_LIFETIME_MILLISECONDS = 15_000;',
      'const SOLANA_CURRENT_HEAD_LIFETIME_MILLISECONDS = 150_000;',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'assessedAt: assessedAt.value,',
      'assessedAt: request.producerRequest.observedAt.value,',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      "clock,\n      'now',\n      'INVALID_CONFIGURATION',",
      "clock,\n      'callerNow',\n      'INVALID_CONFIGURATION',",
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'readonly #issued = new WeakMap<object, IssuedAssessment>();',
      'readonly #issued = new Map<object, IssuedAssessment>();',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'issued === undefined || issued.request !== requestInput || issued.result !== capability',
      'issued === undefined || issued.request === requestInput || issued.result !== capability',
    ],
    [
      'providerPositionChainAnchorCandidateFinalityFinalizerSource',
      'claimsSameSlotForkDetection: false as const,',
      'claimsSameSlotForkDetection: true as const,',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'type DormantProviderPositionChainAnchorCandidateFinalityFinalizer = unknown;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, DormantProviderPositionChainAnchorCandidateFinalityFinalizer],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { DormantProviderPositionChainAnchorCandidateFinalityFinalizer } from './application/dormant-provider-position-chain-anchor-candidate-finality.finalizer';",
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly finalizer: DormantProviderPositionChainAnchorCandidateFinalityFinalizer) {}',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read inspection rejects dormant Aave V3 Ethereum source drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionAaveV3EthereumSource',
      'readonly mayAuthorizeFinancialAction: false;',
      'readonly mayAuthorizeFinancialAction: true;',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'this.#contextReader.receiver === this.#transcriptReader.receiver ||',
      'this.#contextReader.receiver !== this.#transcriptReader.receiver ||',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'const contextCapability = await this.#contextReader.read(issuedContextRequest);',
      'const contextCapability = await this.#transcriptReader.read(issuedContextRequest);',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'verified = reader.verify(capability, issuedRequest) === true;',
      'verified = reader.verify(capability, { ...issuedRequest }) === true;',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'const result = evidence(\n        transcriptCapability,\n        issuedTranscriptRequest,',
      'const result = evidence(\n        transcriptCapability,\n        { ...issuedTranscriptRequest },',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'durableContext: context.capability,',
      'durableContext: Object.freeze({}),',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'positions: positions(issuedRequest, balances),',
      'walletAddress: context.walletAddress,\n    positions: positions(issuedRequest, balances),',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'const EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;',
      'const EVM_ADDRESS = /^0x[0-9a-f]{40}$/iu;',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      "const BLOCK_SELECTOR = 'finalized' as const;",
      "const BLOCK_SELECTOR = 'latest' as const;",
    ],
    [
      'providerPositionAaveV3EthereumSource',
      "const BLOCK_BINDING = 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const;",
      "const BLOCK_BINDING = 'BLOCK_NUMBER' as const;",
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'blockBinding: BLOCK_BINDING,',
      "blockBinding: 'BLOCK_NUMBER',",
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'if (!sameBlock(before, after))',
      'if (before.number !== after.number)',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'blockParameter.requireCanonical !== true ||',
      'blockParameter.requireCanonical !== false ||',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'record.chainIdAfter !== EXPECTED_CHAIN_ID ||',
      'record.chainIdAfter === EXPECTED_CHAIN_ID ||',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'identity: AAVE_V3_ETHEREUM_USDT,',
      'identity: AAVE_V3_ETHEREUM_USDC,',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      "positionKind: 'SUPPLY' as const,",
      "positionKind: 'BORROW' as const,",
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'tokenAddress: definition.variableDebtTokenAddress,',
      'tokenAddress: definition.aTokenAddress,',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'stableDebtTokenAddress: ZERO_ADDRESS,',
      'stableDebtTokenAddress: AAVE_V3_ETHEREUM_USDC_A_TOKEN,',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'if (balances.size !== request.balanceReads.length) {',
      'if (balances.size > request.balanceReads.length) {',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'assertBoundedPlainData(capability, MAX_TRANSCRIPT_BYTES);',
      'void capability;',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      "record.status !== 'COMPLETE' ||",
      "record.status !== 'PARTIAL' ||",
    ],
    [
      'providerPositionAaveV3EthereumSource',
      "record.zeroPositionSemantics !== 'EXPLICIT_ZERO_BALANCE_FOR_EVERY_REQUESTED_ASSET'",
      "record.zeroPositionSemantics !== 'MISSING_MEANS_ZERO'",
    ],
    [
      'providerPositionAaveV3EthereumSource',
      "if (atomic === '0') continue;",
      "if (atomic === '0') return Object.freeze(result);",
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'blockNumber < floorNumber ||',
      'blockNumber > floorNumber ||',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      '(blockNumber === floorNumber && block.hash !== floor.blockHash)',
      '(blockNumber === floorNumber && block.hash === floor.blockHash)',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'request.signal.aborted ||',
      'request.signal.aborted &&',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'contextSettledAt.milliseconds >= request.deadlineAtMilliseconds',
      'contextSettledAt.milliseconds > request.deadlineAtMilliseconds',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      'const transcriptCapability = await this.#transcriptReader.read(issuedTranscriptRequest);',
      'const transcriptCapability = this.#transcriptReader.read(issuedTranscriptRequest);',
    ],
    [
      'providerPositionAaveV3EthereumSource',
      "super('Aave V3 Ethereum provider-position source is unavailable.');",
      'super(`Aave source failed: ${code}`);',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'type DormantAaveV3EthereumProviderPositionSource = unknown;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
    [
      'providerPositionInfrastructureConfigSource',
      'export interface InfrastructureConfig {',
      'type AaveV3EthereumFinalizedPositionTranscriptPort = unknown;\nexport interface InfrastructureConfig {',
    ],
    [
      'mainnetLaunchNetworkPolicySource',
      'export const MAINNET_LAUNCH_NETWORK_IDS = Object.freeze([',
      'type DormantAaveV3EthereumProviderPositionSource = unknown;\nexport const MAINNET_LAUNCH_NETWORK_IDS = Object.freeze([',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, DormantAaveV3EthereumProviderPositionSource],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { DormantAaveV3EthereumProviderPositionSource } from './infrastructure/dormant-aave-v3-ethereum-provider-position.source';",
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly source: DormantAaveV3EthereumProviderPositionSource) {}',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read inspection rejects dormant Kamino source drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionKaminoSource',
      'readonly mayAuthorizeFinancialAction: false;',
      'readonly mayAuthorizeFinancialAction: true;',
    ],
    [
      'providerPositionKaminoSource',
      "import { createHash } from 'node:crypto';",
      "import { request } from 'node:https';",
    ],
    [
      'providerPositionKaminoSource',
      'const contextCapability = await invoke(this.readContextMethod, [contextRequest]);',
      'const contextCapability = await invoke(this.readTranscriptMethod, [contextRequest]);',
    ],
    [
      'providerPositionKaminoSource',
      'invoke(this.reviewContextMethod, [contextCapability, contextRequest]) !== contextCapability',
      'invoke(this.reviewContextMethod, [contextCapability, { ...contextRequest }]) !== contextCapability',
    ],
    [
      'providerPositionKaminoSource',
      'invoke(this.reviewTranscriptMethod, [transcriptCapability, transcriptRequest]) !==',
      'invoke(this.reviewTranscriptMethod, [transcriptCapability, { ...transcriptRequest }]) !==',
    ],
    [
      'providerPositionKaminoSource',
      'contextCapability: context.capability,',
      'contextCapability: Object.freeze({}),',
    ],
    [
      'providerPositionKaminoSource',
      'record.providerId !== PROVIDER_ID ||',
      'record.providerId === PROVIDER_ID ||',
    ],
    [
      'providerPositionKaminoSource',
      'return parseSolanaWalletAddress(value);',
      'return String(value);',
    ],
    [
      'providerPositionKaminoSource',
      "record.kind !== 'SOLANA_SLOT' || BigInt(root) > BigInt(slot)",
      "record.kind !== 'SOLANA_SLOT' || BigInt(root) < BigInt(slot)",
    ],
    [
      'providerPositionKaminoSource',
      'slot !== context.continuityFloor.slot ||',
      'slot === context.continuityFloor.slot ||',
    ],
    [
      'providerPositionKaminoSource',
      'blockhash !== context.continuityFloorBlockhash',
      'blockhash === context.continuityFloorBlockhash',
    ],
    [
      'providerPositionKaminoSource',
      'parentBlockhash !== previousBlockhash ||',
      'parentBlockhash === previousBlockhash ||',
    ],
    [
      'providerPositionKaminoSource',
      'if (previousSlot !== finalizedRootSlot || previousBlockhash !== finalizedRootBlockhash) {',
      'if (previousSlot !== finalizedRootSlot && previousBlockhash !== finalizedRootBlockhash) {',
    ],
    [
      'providerPositionKaminoSource',
      'BigInt(finalizedRootSlot) < BigInt(context.continuityFloor.slot) ||',
      'BigInt(finalizedRootSlot) > BigInt(context.continuityFloor.slot) ||',
    ],
    [
      'providerPositionKaminoSource',
      "commitment: 'finalized' as const,",
      "commitment: 'confirmed' as const,",
    ],
    [
      'providerPositionKaminoSource',
      "record.commitment !== 'finalized' ||",
      "record.commitment !== 'confirmed' ||",
    ],
    [
      'providerPositionKaminoSource',
      'const MAX_TRANSCRIPT_BYTES = 1024 * 1024;',
      'const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;',
    ],
    ['providerPositionKaminoSource', 'assertBoundedTranscript(value);', 'void value;'],
    [
      'providerPositionKaminoSource',
      "record.status !== 'COMPLETE' ||",
      "record.status !== 'PARTIAL' ||",
    ],
    [
      'providerPositionKaminoSource',
      'record.nextPageToken !== null ||',
      'record.nextPageToken === null ||',
    ],
    [
      'providerPositionKaminoSource',
      'BigInt(matchedAccountCount) !== BigInt(accounts.length)',
      'BigInt(matchedAccountCount) < BigInt(accounts.length)',
    ],
    [
      'providerPositionKaminoSource',
      'const MAX_OBLIGATION_ACCOUNTS = 16;',
      'const MAX_OBLIGATION_ACCOUNTS = 1_600;',
    ],
    [
      'providerPositionKaminoSource',
      'seenAccounts.has(accountAddress) ||',
      'seenAccounts.has(accountAddress) &&',
    ],
    [
      'providerPositionKaminoSource',
      "if (supply > 0n) positions.push(position('SUPPLY', supply, asset));",
      "if (supply >= 0n) positions.push(position('SUPPLY', supply, asset));",
    ],
    [
      'providerPositionKaminoSource',
      "'finalizedRootSlot',",
      "'continuityFloor',\n  'finalizedRootSlot',",
    ],
    [
      'providerPositionKaminoSource',
      "'finalizedRootSlot',",
      "'observedAt',\n  'finalizedRootSlot',",
    ],
    [
      'providerPositionKaminoSource',
      'positions: transcript.positions,',
      'canonicalWalletAddress: context.canonicalWalletAddress,\n        positions: transcript.positions,',
    ],
    [
      'providerPositionKaminoSource',
      'positions: transcript.positions,',
      'finalizedRootBlockhash: context.continuityFloorBlockhash,\n        positions: transcript.positions,',
    ],
    [
      'providerPositionKaminoSource',
      'assertActive(request.signal, afterContext, request.deadlineAt);',
      'void afterContext;',
    ],
    [
      'providerPositionKaminoSource',
      'const transcriptCapability = await invoke(this.readTranscriptMethod, [transcriptRequest]);',
      'const transcriptCapability = invoke(this.readTranscriptMethod, [transcriptRequest]);',
    ],
    [
      'providerPositionKaminoSource',
      'request.deadlineAt.milliseconds - started.milliseconds > MAX_DEADLINE_MILLISECONDS',
      'request.deadlineAt.milliseconds - started.milliseconds > 300_000',
    ],
    [
      'providerPositionKaminoSource',
      "super('Kamino provider-position source is unavailable.');",
      'super(`Kamino source failed: ${code}`);',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'type DormantKaminoProviderPositionAdmissionSource = unknown;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
    [
      'providerPositionInfrastructureConfigSource',
      'export interface InfrastructureConfig {',
      'type DormantKaminoFinalizedAccountTranscriptTransport = unknown;\nexport interface InfrastructureConfig {',
    ],
    [
      'mainnetLaunchNetworkPolicySource',
      'export const MAINNET_LAUNCH_NETWORK_IDS = Object.freeze([',
      'type DormantKaminoProviderPositionAdmissionSource = unknown;\nexport const MAINNET_LAUNCH_NETWORK_IDS = Object.freeze([',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, DormantKaminoProviderPositionAdmissionSource],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { DormantKaminoProviderPositionAdmissionSource } from './infrastructure/dormant-kamino-provider-position-admission.source';",
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly source: DormantKaminoProviderPositionAdmissionSource) {}',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read inspection rejects dormant Compound III Ethereum source drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionCompoundIIIEthereumSource',
      "import { createHash } from 'node:crypto';",
      "import { request } from 'node:https';",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'this.#manifest = parseCompoundIIIUSDCFinalizedManifest(manifestValue);',
      'this.#manifest = manifestValue as CompoundIIIUSDCFinalizedManifest;',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'this.#manifestFingerprintSha256 = compoundIIIUSDCManifestFingerprintSha256(this.#manifest);',
      'this.#manifestFingerprintSha256 = compoundIIIUSDCManifestFingerprintSha256(manifestValue);',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'requiredManifestFingerprintSha256 !== this.#manifestFingerprintSha256',
      'requiredManifestFingerprintSha256 === this.#manifestFingerprintSha256',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'this.#contextReader.receiver === this.#transcriptReader.receiver ||',
      'this.#contextReader.receiver !== this.#transcriptReader.receiver ||',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'const contextCapability = await invoke(this.#contextReader.read, [issuedContextRequest]);',
      'const contextCapability = await invoke(this.#transcriptReader.read, [issuedContextRequest]);',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'invoke(this.#contextReader.review, [contextCapability, issuedContextRequest]) !==',
      'invoke(this.#contextReader.review, [contextCapability, { ...issuedContextRequest }]) !==',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'contextRequest: contextRequestValue,',
      'contextRequest: { ...contextRequestValue },',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'contextCapability: context.capability,',
      'contextCapability: Object.freeze({}),',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'invoke(this.#transcriptReader.review, [transcriptCapability, issuedTranscriptRequest]) !==',
      'invoke(this.#transcriptReader.review, [transcriptCapability, { ...issuedTranscriptRequest }]) !==',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "const BLOCK_SELECTOR = 'finalized' as const;",
      "const BLOCK_SELECTOR = 'latest' as const;",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "const BLOCK_BINDING = 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const;",
      "const BLOCK_BINDING = 'BLOCK_NUMBER_ONLY' as const;",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'record.blockHash !== selectedBlockHash || record.requireCanonical !== true',
      'record.blockHash !== selectedBlockHash || record.requireCanonical !== false',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'record.chainIdAfter !== EXPECTED_CHAIN_ID ||',
      'record.chainIdAfter === EXPECTED_CHAIN_ID ||',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'expectedRuntimeCodeSha256: manifest.runtimeCodeSha256.cometProxy,',
      "expectedRuntimeCodeSha256: '0'.repeat(64),",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'if (actual !== expectedSha256) {',
      'if (actual === expectedSha256) {',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "abiAddress(results.get('proxy-implementation')) !== request.manifest.implementation ||",
      "abiAddress(results.get('proxy-implementation')) === request.manifest.implementation ||",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "abiAddress(results.get('base-token')) !== request.manifest.baseAsset.address ||",
      "abiAddress(results.get('base-token')) === request.manifest.baseAsset.address ||",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "const BALANCE_OF_SELECTOR = '0x70a08231' as const;",
      "const BALANCE_OF_SELECTOR = '0x313ce567' as const;",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "const BORROW_BALANCE_OF_SELECTOR = '0x374c49b4' as const;",
      "const BORROW_BALANCE_OF_SELECTOR = '0x70a08231' as const;",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "return `${selector}${'0'.repeat(24)}${address.slice(2)}`;",
      "return `${selector}${'0'.repeat(22)}${address.slice(2)}`;",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'const ABI_WORD = /^0x[0-9a-f]{64}$/u;',
      'const ABI_WORD = /^0x[0-9a-f]+$/u;',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'if (values.length !== request.accountReads.length) {',
      'if (values.length < request.accountReads.length) {',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'record.data !== expected.data ||',
      'record.data === expected.data ||',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'results.set(expected.operationId, abiUint(record.result).toString(10));',
      'results.set(expected.operationId, abiUint(record.result).toString(16));',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "record.status !== 'COMPLETE' ||",
      "record.status !== 'PARTIAL' ||",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "record.zeroPositionSemantics !== 'EXACT_ZERO_RESULT_FOR_BOTH_COMET_BASE_BALANCE_CALLS'",
      "record.zeroPositionSemantics !== 'OMIT_ZERO_RESULTS'",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "(supplyAtomic !== '0' && borrowAtomic !== '0')",
      "(supplyAtomic !== '0' || borrowAtomic !== '0')",
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      '!sameHeader(selectedBefore, selectedAfter) ||',
      'sameHeader(selectedBefore, selectedAfter) ||',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      '!sameHeader(floorBefore, floorAfter) ||',
      'sameHeader(floorBefore, floorAfter) ||',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'floorBefore.hash !== context.continuityFloor.blockHash ||',
      'floorBefore.hash === context.continuityFloor.blockHash ||',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'BigInt(selectedBefore.numberDecimal) < BigInt(floorBefore.numberDecimal) ||',
      'BigInt(selectedBefore.numberDecimal) > BigInt(floorBefore.numberDecimal) ||',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'selectedBefore.hash !== floorBefore.hash)',
      'selectedBefore.hash === floorBefore.hash)',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'assertBoundedPlainData(capability, MAX_TRANSCRIPT_BYTES);',
      'void capability;',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'positions: Object.freeze(positions),',
      'walletAddress: context.walletAddress,\n    positions: Object.freeze(positions),',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'positions: Object.freeze(positions),',
      'manifestFingerprintSha256: transcript.manifestFingerprintSha256,\n    positions: Object.freeze(positions),',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,\n    mayAuthorizeFinancialAction: false as const,',
      'use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,\n    mayAuthorizeFinancialAction: true as const,',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'const MAX_DEADLINE_MILLISECONDS = 30_000;',
      'const MAX_DEADLINE_MILLISECONDS = 300_000;',
    ],
    ['providerPositionCompoundIIIEthereumSource', 'aborted(signal) ||', 'aborted(signal) &&'],
    [
      'providerPositionCompoundIIIEthereumSource',
      'assertActive(request, completedAt, transcriptSettledAt);',
      'void completedAt;',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      'const transcriptCapability = await invoke(this.#transcriptReader.read, [',
      'const transcriptCapability = invoke(this.#transcriptReader.read, [',
    ],
    [
      'providerPositionCompoundIIIEthereumSource',
      "super('Compound III Ethereum provider-position source is unavailable.');",
      'super(`Compound source failed: ${code}`);',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'type DormantCompoundIIIEthereumProviderPositionSource = unknown;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
    [
      'providerPositionInfrastructureConfigSource',
      'export interface InfrastructureConfig {',
      'type CompoundIIIEthereumFinalizedPositionTranscriptPort = unknown;\nexport interface InfrastructureConfig {',
    ],
    [
      'mainnetLaunchNetworkPolicySource',
      'export const MAINNET_LAUNCH_NETWORK_IDS = Object.freeze([',
      'type DormantCompoundIIIEthereumProviderPositionSource = unknown;\nexport const MAINNET_LAUNCH_NETWORK_IDS = Object.freeze([',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, DormantCompoundIIIEthereumProviderPositionSource],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { DormantCompoundIIIEthereumProviderPositionSource } from './infrastructure/dormant-compound-iii-ethereum-provider-position.source';",
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly source: DormantCompoundIIIEthereumProviderPositionSource) {}',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read inspection rejects dormant SparkLend Ethereum source drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionSparkLendEthereumSource',
      "import { Buffer } from 'node:buffer';",
      "import { request } from 'node:https';",
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'const manifest = parseSparkLendEthereumUSDCManifest(input);',
      'const manifest = input as SparkLendEthereumUSDCManifest;',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'const fingerprint = sparkLendManifestFingerprintSha256(manifest);',
      'const fingerprint = sparkLendManifestFingerprintSha256(input);',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'fingerprint !== requiredFingerprint',
      'fingerprint === requiredFingerprint',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'this.#contextReader.receiver === this.#transcriptReader.receiver ||',
      'this.#contextReader.receiver !== this.#transcriptReader.receiver ||',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'const contextCapability = await this.#contextReader.read(issuedContextRequest);',
      'const contextCapability = await this.#transcriptReader.read(issuedContextRequest);',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'if (reader.verify(capability, request) !== true) {',
      'if (reader.verify(capability, { ...request }) !== true) {',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'durableContext: context.capability,',
      'durableContext: Object.freeze({}),',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'const transcriptCapability = await this.#transcriptReader.read(issuedTranscriptRequest);',
      'const transcriptCapability = this.#transcriptReader.read(issuedTranscriptRequest);',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      "const BLOCK_SELECTOR = 'finalized' as const;",
      "const BLOCK_SELECTOR = 'latest' as const;",
    ],
    [
      'providerPositionSparkLendEthereumSource',
      "const BLOCK_BINDING = 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const;",
      "const BLOCK_BINDING = 'BLOCK_NUMBER_ONLY' as const;",
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'record.blockHash !== block.hash || record.requireCanonical !== true',
      'record.blockHash !== block.hash || record.requireCanonical !== false',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      '!/^0x[0-9a-f]{192}$/u.test(value)',
      '!/^0x[0-9a-f]+$/u.test(value)',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'record.to !== request.reserveTokenRead.to ||',
      'record.to === request.reserveTokenRead.to ||',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'if (tokens.supply !== request.manifest.contracts.spToken) {',
      'if (tokens.supply === request.manifest.contracts.spToken) {',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      "record.method !== 'eth_getCode' ||",
      "record.method !== 'eth_call' ||",
    ],
    [
      'providerPositionSparkLendEthereumSource',
      '(expectedHash !== undefined && record.resultSha256 !== expectedHash)',
      '(expectedHash !== undefined && record.resultSha256 === expectedHash)',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'record.callData !== IMPLEMENTATION_SELECTOR',
      'record.callData === IMPLEMENTATION_SELECTOR',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'implementationAddress !== request.manifest.contracts.spTokenImplementation',
      'implementationAddress === request.manifest.contracts.spTokenImplementation',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'plainCall(record.poolRead, tokenAddress, POOL_SELECTOR, request.manifest.contracts.pool, block);',
      'plainCall(record.poolRead, tokenAddress, POOL_SELECTOR, undefined, block);',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'return uintCall(record.balanceRead, tokenAddress, request.walletBalanceCallData, block);',
      "return '0';",
    ],
    [
      'providerPositionSparkLendEthereumSource',
      "...(tokens.stableDebt === ZERO_ADDRESS ? [] : (['STABLE_BORROW'] as const)),",
      "...(tokens.stableDebt !== ZERO_ADDRESS ? [] : (['STABLE_BORROW'] as const)),",
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'if (proofs.length !== roles.length) {',
      'if (proofs.length < roles.length) {',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      "const stableDebt = BigInt(balances[2] ?? '0');",
      'const stableDebt = 0n;',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'const borrow = variableDebt + stableDebt;',
      'const borrow = variableDebt;',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      "record.status !== 'COMPLETE' ||",
      "record.status !== 'PARTIAL' ||",
    ],
    [
      'providerPositionSparkLendEthereumSource',
      "'EXPLICIT_ZERO_BALANCE_FOR_SUPPLY_AND_EVERY_DISCOVERED_DEBT_TOKEN'",
      "'OMIT_ZERO_BALANCES'",
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'if (!sameBlock(before, after))',
      'if (sameBlock(before, after))',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'blockNumber === floorNumber && block.hash !== floor.blockHash',
      'blockNumber === floorNumber && block.hash === floor.blockHash',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'assertBoundedImmutableCapability(capability, MAX_TRANSCRIPT_BYTES);',
      'void capability;',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'verifyContext(this.#contextReader, contextCapability, issuedContextRequest);',
      'void contextCapability;',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'verifyTranscript(this.#transcriptReader, transcriptCapability, issuedTranscriptRequest);',
      'void transcriptCapability;',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'request.signal.aborted ||',
      'request.signal.aborted &&',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'const MAX_DEADLINE_MILLISECONDS = 30_000;',
      'const MAX_DEADLINE_MILLISECONDS = 300_000;',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'positions: positions(request, transcript),',
      'walletAddress: context.walletAddress,\n    positions: positions(request, transcript),',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      'use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,\n    mayAuthorizeFinancialAction: false,',
      'use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,\n    mayAuthorizeFinancialAction: true,',
    ],
    [
      'providerPositionSparkLendEthereumSource',
      "super('SparkLend Ethereum provider-position source is unavailable.');",
      'super(`SparkLend failed: ${code}`);',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'type DormantSparkLendEthereumProviderPositionSource = unknown;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
    [
      'providerPositionInfrastructureConfigSource',
      'export interface InfrastructureConfig {',
      'type SparkLendEthereumFinalizedPositionTranscriptPort = unknown;\nexport interface InfrastructureConfig {',
    ],
    [
      'mainnetLaunchNetworkPolicySource',
      'export const MAINNET_LAUNCH_NETWORK_IDS = Object.freeze([',
      'type DormantSparkLendEthereumProviderPositionSource = unknown;\nexport const MAINNET_LAUNCH_NETWORK_IDS = Object.freeze([',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, DormantSparkLendEthereumProviderPositionSource],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { DormantSparkLendEthereumProviderPositionSource } from './infrastructure/dormant-sparklend-ethereum-provider-position.source';",
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly source: DormantSparkLendEthereumProviderPositionSource) {}',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read inspection rejects dormant chain-anchor recorder V2 drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionChainAnchorEvidenceRecorderPortSource',
      'export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION = 2 as const;',
      'export const PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION = 3 as const;',
    ],
    [
      'providerPositionChainAnchorEvidenceRecorderPortSource',
      "'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_ONLY' as const;",
      "'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ONLY' as const;",
    ],
    [
      'providerPositionChainAnchorEvidenceRecorderPortSource',
      'export interface RecordProviderPositionChainAnchorEvidenceRequestV2 {',
      'export interface RecordProviderPositionChainAnchorEvidenceRequestV1 {',
    ],
    [
      'providerPositionChainAnchorEvidenceRecorderPortSource',
      'readonly producerCapability: unknown;',
      'readonly producerCapability: object;',
    ],
    [
      'providerPositionChainAnchorEvidenceRecorderPortSource',
      'readonly producerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1;',
      'readonly recordArguments: readonly unknown[];',
    ],
    [
      'providerPositionChainAnchorEvidenceRecorderPortSource',
      'recordEvidence(request: RecordProviderPositionChainAnchorEvidenceRequestV2): Promise<unknown>;',
      'recordEvidence(request: RecordProviderPositionChainAnchorEvidenceRequestV2): Promise<ProviderPositionChainAnchorEvidenceRecordResultV2>;',
    ],
    [
      'providerPositionChainAnchorEvidenceRecorderPortSource',
      'readonly evidenceRecordedAt: string;\n  readonly resolvedAt: string;',
      'readonly evidenceRecordedAt: string | null;\n  readonly resolvedAt: string;',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      "import { randomBytes } from 'node:crypto';",
      "import { request } from 'node:https';",
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      "this.#databaseQuery = captureMethod<QueryWithCancellation>(postgres, 'queryWithCancellation');",
      "this.#databaseQuery = captureMethod<QueryWithCancellation>(postgres, 'query');",
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'const arguments_ = exactDataArray(record.recordArguments, 23);',
      'const arguments_ = exactDataArray(record.recordArguments, 22);',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'FROM prepare_provider_position_chain_anchor_record_intent(',
      'FROM record_provider_position_chain_anchor_evidence(',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'Object.freeze([...candidate.values, request.producerRequest.deadlineAt.value]),',
      'Object.freeze(candidate.values),',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'identity = identityFrom(prepare);',
      'identity = null;',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      "if (prepare.state === 'RECORD_DISPATCHED' || prepare.state === 'UNKNOWN') {",
      "if (prepare.state === 'UNKNOWN') {",
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'secondReview !== firstReview ||\n        secondReview !== candidate.candidate ||',
      'secondReview !== firstReview &&\n        secondReview !== candidate.candidate ||',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'dispatchToken = randomBytes(32);',
      'dispatchToken = randomBytes(16);',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      '!Buffer.isBuffer(dispatchToken) ||',
      'false ||',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'dispatchToken.length !== 32 ||',
      'dispatchToken.length !== 16 ||',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'dispatchToken.every((value) => value === 0)',
      'false',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'const tokenValues = Object.freeze([identity.recordIntentFingerprintSha256, dispatchToken]);',
      'const tokenValues = Object.freeze([identity.recordIntentFingerprintSha256, Buffer.from(dispatchToken)]);',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      "'claim_provider_position_chain_anchor_record_dispatch',",
      "'execute_provider_position_chain_anchor_record_intent',",
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'if (claim === null && attemptClaimsTerminalState(claimAttempt)) return uncertain();',
      'void claimAttempt;',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      "phase = 'EXECUTE_RECORD';",
      "phase = 'CLAIM_DISPATCH';",
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'EXECUTE_RECORD_SQL,\n        tokenValues,',
      'CLAIM_DISPATCH_SQL,\n        tokenValues,',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'if (executed === null && attemptClaimsTerminalState(executeAttempt)) return uncertain();',
      'void executeAttempt;',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      "phase = 'MARK_UNKNOWN';",
      "phase = 'EXECUTE_RECORD';",
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'await queryAttempt(this.#databaseQuery, MARK_UNKNOWN_SQL, tokenValues, request.signal)',
      'await queryAttempt(this.#databaseQuery, EXECUTE_RECORD_SQL, tokenValues, request.signal)',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'dispatchToken?.fill(0);',
      'void dispatchToken;',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'recordedAt.milliseconds < candidate.assessedAtMilliseconds ||',
      'false ||',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'recordedAt.milliseconds >= candidate.sourcePairApprovalExpiresAtMilliseconds ||',
      'false ||',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'reviewEvidenceFreshness(candidate, producerRequest, recordedAt, true);',
      'reviewEvidenceFreshness(candidate, producerRequest, recordedAt, false);',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'reviewEvidenceFreshness(candidate, producerRequest, evidenceRecordedAt, false);',
      'void evidenceRecordedAt;',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'readonly #issued = new WeakMap<',
      'readonly #issued = new Map<',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      'return issued?.request === request && issued.result === capability ? issued.result : null;',
      'return issued?.request === request || issued?.result === capability ? issued.result : null;',
    ],
    [
      'providerPositionPostgresChainAnchorEvidenceRecorderSource',
      "super('Provider position chain-anchor evidence record failed');",
      "super('Database request failed');",
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'type PostgresProviderPositionChainAnchorEvidenceRecorder = unknown;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, PostgresProviderPositionChainAnchorEvidenceRecorder],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { PostgresProviderPositionChainAnchorEvidenceRecorder } from './infrastructure/postgres-provider-position-chain-anchor-evidence.recorder';",
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly recorder: PostgresProviderPositionChainAnchorEvidenceRecorder) {}',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      [key, approved].join(': '),
    );
  }
});

test('provider-position read inspection rejects dormant durable evidence and migration drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      "AND requested_source_observation_id = 'ethereum-block-'",
      'AND requested_source_observation_id = requested_source_id',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      "AND requested_source_observation_id = 'solana-slot-'",
      'AND requested_source_observation_id = requested_source_id',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      "OR requested_deadline_at > requested_evaluated_at + interval '30 seconds'",
      "OR requested_deadline_at > requested_evaluated_at + interval '300 seconds'",
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      'AND database_read_at < evidence.source_pair_approval_expires_at',
      'AND requested_evaluated_at < evidence.source_pair_approval_expires_at',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      'OR database_read_at >= selected_evidence.finalized_head_advanced_at + (CASE',
      'OR requested_evaluated_at >= selected_evidence.finalized_head_advanced_at + (CASE',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      "AND wallet.status = 'ACTIVE'",
      "AND wallet.status = 'PENDING'",
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      'GRANT EXECUTE ON FUNCTION ${READ_EVIDENCE} TO ${api};',
      'GRANT EXECUTE ON FUNCTION ${READ_EVIDENCE} TO ${worker};',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      'GRANT EXECUTE ON FUNCTION ${READ_EVIDENCE} TO ${api};',
      'GRANT EXECUTE ON FUNCTION ${READ_EVIDENCE} TO ${api};\n    GRANT EXECUTE ON FUNCTION ${RECORD_EVIDENCE} TO ${api};',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      '        ${EVIDENCE_ROW_VALID_CALL} IS TRUE\n',
      '        true\n',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      "AND trigger.tgattr = ''::pg_catalog.int2vector",
      'AND true',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      "IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'",
      'IF false',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      'evidence_use text NOT NULL,',
      'evidence_use text NOT NULL,\n      account_id uuid NOT NULL,',
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      "supersedesVerificationOf: ['0028'],",
      "supersedesVerificationOf: ['0027'],",
    ],
    [
      'providerPositionChainAnchorEvidenceMigrationSource',
      "if (!previous.verifySql) throw new Error('Migration 0028 must expose verification SQL');",
      'void previous.verifySql;',
    ],
    [
      'providerPositionMigrationIndexSource',
      '  suspendGenericWorkerBalanceAuthorityMigrationV0028,\n  createProviderPositionChainAnchorEvidenceMigrationV0029,\n  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentMigrationV0031,\n]);',
      '  suspendGenericWorkerBalanceAuthorityMigrationV0028,\n  createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029,\n  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentMigrationV0031,\n]);',
    ],
    [
      'providerPositionMigrationIndexSource',
      "} from './0029-create-provider-position-chain-anchor-evidence.migration';",
      "} from './0029-create-provider-position-chain-anchor-evidence.disabled';",
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }

  assert.deepEqual(
    inspectProviderPositionReadBoundaryArtifacts({
      ...PROVIDER_POSITION_READ_ARTIFACTS,
      providerPositionChainAnchorEvidenceMigrationSource: `${PROVIDER_POSITION_READ_ARTIFACTS.providerPositionChainAnchorEvidenceMigrationSource}\nvoid fetch('https://unreviewed.invalid');\n`,
    }),
    INVALID_PROVIDER_POSITION_READ_BOUNDARY,
  );
});

test('provider-position read inspection rejects deadline-bound evidence migration drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    ['providerPositionChainAnchorRecordDeadlineMigrationSource', "id: '0030',", "id: '0031',"],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      "supersedesVerificationOf: ['0029'],",
      "supersedesVerificationOf: ['0028'],",
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      "'crypto-lending:provider-position-chain-anchor-record-deadline-binding:v1';",
      "'crypto-lending:provider-position-chain-anchor-record-deadline-binding:v2';",
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'AND requested_evidence_recorded_at < requested_producer_deadline_at',
      'AND requested_evidence_recorded_at <= requested_producer_deadline_at',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'evidence_recorded_at timestamptz NOT NULL,',
      'evidence_recorded_at timestamptz NOT NULL,\n      account_id uuid NOT NULL,',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      '        ${DEADLINE_ROW_VALID_CALL} IS TRUE\n',
      '        true\n',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'LOCK TABLE ${EVIDENCE_TABLE} IN ACCESS EXCLUSIVE MODE;',
      'LOCK TABLE ${EVIDENCE_TABLE} IN SHARE MODE;',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'IF EXISTS (SELECT 1 FROM ${EVIDENCE_TABLE}) THEN',
      'IF false THEN',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'REFERENCES ${EVIDENCE_TABLE} (evidence_fingerprint_sha256)\n        ON UPDATE NO ACTION ON DELETE NO ACTION,',
      'REFERENCES ${EVIDENCE_TABLE} (evidence_fingerprint_sha256)\n        ON UPDATE NO ACTION ON DELETE CASCADE,',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'REFERENCES ${DEADLINE_TABLE} (evidence_fingerprint_sha256)\n      ON UPDATE NO ACTION ON DELETE NO ACTION\n      DEFERRABLE INITIALLY DEFERRED;',
      'REFERENCES ${DEADLINE_TABLE} (evidence_fingerprint_sha256)\n      ON UPDATE CASCADE ON DELETE NO ACTION\n      NOT DEFERRABLE;',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'BEFORE UPDATE OR DELETE ON ${DEADLINE_TABLE}',
      'BEFORE UPDATE ON ${DEADLINE_TABLE}',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'ALTER TABLE ${DEADLINE_TABLE} ENABLE ALWAYS TRIGGER\n      provider_position_chain_anchor_deadline_append_only_truncate;',
      'ALTER TABLE ${DEADLINE_TABLE} ENABLE TRIGGER\n      provider_position_chain_anchor_deadline_append_only_truncate;',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'requested_operation text',
      'requested_operation boolean',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      ') LANGUAGE plpgsql SECURITY DEFINER VOLATILE STRICT PARALLEL UNSAFE',
      ') LANGUAGE plpgsql SECURITY INVOKER VOLATILE STRICT PARALLEL UNSAFE',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      "IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'",
      'IF false',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      "OR requested_operation NOT IN ('RECORD', 'RECONCILE_ONLY')",
      "OR requested_operation NOT IN ('RECORD')",
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      "OR requested_producer_deadline_at > requested_assessed_at + interval '30 seconds'",
      "OR requested_producer_deadline_at > requested_assessed_at + interval '300 seconds'",
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'pg_catalog.hashtextextended(requested_read_binding_fingerprint, 56029)',
      'pg_catalog.hashtextextended(requested_fingerprint, 56029)',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'prior.lineage_proof_sha256 IS DISTINCT FROM requested_lineage_proof_sha256',
      'prior.lineage_proof_sha256 IS DISTINCT FROM requested_identity_proof_sha256',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'deadline_binding.producer_deadline_at\n            IS DISTINCT FROM requested_producer_deadline_at',
      'deadline_binding.producer_deadline_at\n            IS DISTINCT FROM prior.recorded_at',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      "IF requested_operation = 'RECONCILE_ONLY'",
      'IF false',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'FROM record_provider_position_chain_anchor_evidence(',
      'FROM record_provider_position_chain_anchor_evidence_guarded(',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'OR stored_recorded_at >= requested_producer_deadline_at',
      'OR stored_recorded_at > requested_producer_deadline_at',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      '          false,\n          false,\n          requested_producer_deadline_at,',
      '          true,\n          false,\n          requested_producer_deadline_at,',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'IF database_completed_at < database_started_at',
      'IF false',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'OR database_completed_at < stored_recorded_at',
      'OR false',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'OR database_completed_at >= requested_producer_deadline_at',
      'OR database_completed_at > requested_producer_deadline_at',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      "WHEN SQLSTATE 'P0030' THEN",
      'WHEN OTHERS THEN',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'REVOKE ALL ON FUNCTION ${GUARDED_RECORD_EVIDENCE} FROM ${guardedRoles};`;',
      'GRANT EXECUTE ON FUNCTION ${GUARDED_RECORD_EVIDENCE} TO ${api};`;',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      "priorConstraintCount.replace('count(*) = 6', 'count(*) = 7')",
      "priorConstraintCount.replace('count(*) = 6', 'count(*) = 6')",
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      'AND procedure.pronargs = 25',
      'AND procedure.pronargs = 24',
    ],
    [
      'providerPositionChainAnchorRecordDeadlineMigrationSource',
      "trigger.tgenabled = 'A'",
      "trigger.tgenabled = 'O'",
    ],
    [
      'providerPositionMigrationIndexSource',
      '  enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031,',
      '  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031,',
    ],
    [
      'providerPositionMigrationIndexSource',
      '  createProviderPositionChainAnchorEvidenceMigrationV0029,\n  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentMigrationV0031,',
      '  createProviderPositionChainAnchorEvidenceMigrationV0029,\n  enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentMigrationV0031,',
    ],
    [
      'providerPositionMigrationIndexSource',
      "import {\n  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030,\n} from './0030-enforce-provider-position-chain-anchor-record-deadline.migration';",
      "import {\n  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030,\n} from './0030-enforce-provider-position-chain-anchor-record-deadline.disabled';",
    ],
    [
      'providerPositionMigrationIndexSource',
      "export {\n  createProviderPositionChainAnchorRecordDeadlineMigration,\n  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030,\n} from './0030-enforce-provider-position-chain-anchor-record-deadline.migration';",
      "export {\n  createProviderPositionChainAnchorRecordDeadlineMigration,\n  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030,\n} from './0030-enforce-provider-position-chain-anchor-record-deadline.disabled';",
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'type ProviderPositionChainAnchorRecordDeadline = unknown;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, ProviderPositionChainAnchorRecordDeadline],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { ProviderPositionChainAnchorRecordDeadline } from './infrastructure/database/migrations/0030-enforce-provider-position-chain-anchor-record-deadline.migration';",
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly deadline: ProviderPositionChainAnchorRecordDeadline) {}',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read inspection rejects durable record-intent migration drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    ['providerPositionChainAnchorRecordIntentMigrationSource', "id: '0031',", "id: '0032',"],
    [
      'providerPositionChainAnchorRecordIntentMigrationSource',
      "supersedesVerificationOf: ['0030'],",
      "supersedesVerificationOf: ['0029'],",
    ],
    [
      'providerPositionChainAnchorRecordIntentMigrationSource',
      'LOCK TABLE ${EVIDENCE_TABLE}, ${DEADLINE_TABLE} IN ACCESS EXCLUSIVE MODE;',
      'LOCK TABLE ${EVIDENCE_TABLE}, ${DEADLINE_TABLE} IN SHARE MODE;',
    ],
    [
      'providerPositionChainAnchorRecordIntentMigrationSource',
      'record_dispatch_token_sha256 text,',
      'record_dispatch_token_sha256 text,\n      raw_dispatch_token bytea,',
    ],
    [
      'providerPositionChainAnchorRecordIntentMigrationSource',
      'OR NEW.record_dispatch_count > OLD.record_dispatch_count + 1',
      'OR NEW.record_dispatch_count > OLD.record_dispatch_count + 2',
    ],
    [
      'providerPositionChainAnchorRecordIntentMigrationSource',
      'FOR UPDATE SKIP LOCKED',
      'FOR UPDATE',
    ],
    [
      'providerPositionChainAnchorRecordIntentMigrationSource',
      "        'RECONCILE_ONLY'\n",
      "        'RECORD'\n",
    ],
    [
      'providerPositionChainAnchorRecordIntentMigrationSource',
      'CREATE CONSTRAINT TRIGGER provider_position_chain_anchor_deadline_intent_terminal_check',
      'CREATE TRIGGER provider_position_chain_anchor_deadline_intent_terminal_check',
    ],
    [
      'providerPositionChainAnchorRecordIntentMigrationSource',
      'REVOKE ALL PRIVILEGES ON TABLE ${INTENT_TABLE} FROM ${guardedRoles};',
      'GRANT SELECT ON TABLE ${INTENT_TABLE} TO ${worker};',
    ],
    [
      'providerPositionChainAnchorRecordIntentMigrationSource',
      'constraint_state.coninhcount = 0',
      'constraint_state.coninhcount >= 0',
    ],
    [
      'providerPositionMigrationIndexSource',
      '  enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031,',
      '  enforceProviderPositionChainAnchorRecordDeadlineTestSchemaMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentMigrationV0031,',
    ],
    [
      'providerPositionMigrationIndexSource',
      '  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentMigrationV0031,',
      '  enforceProviderPositionChainAnchorRecordDeadlineMigrationV0030,\n  createProviderPositionChainAnchorRecordIntentTestSchemaMigrationV0031,',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'type ProviderPositionChainAnchorRecordIntent = unknown;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read inspection rejects record-intent reconciliation drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionChainAnchorRecordIntentReconciliationPortSource',
      'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION = 1 as const;',
      'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION = 2 as const;',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationPortSource',
      'readonly use: typeof PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE;',
      'readonly use: string;',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationPortSource',
      'readonly signal: AbortSignal;',
      'readonly signal: AbortSignal;\n  readonly recordIntentFingerprintSha256: string;',
    ],
    [
      'providerPositionPostgresChainAnchorRecordIntentReconciliationProcessorSource',
      "FROM lease_provider_chain_anchor_record_intent_reconciliation($1::bytea, interval '30 seconds') AS intent",
      "FROM lease_provider_chain_anchor_record_intent_reconciliation($1::bytea, interval '60 seconds') AS intent",
    ],
    [
      'providerPositionPostgresChainAnchorRecordIntentReconciliationProcessorSource',
      'FROM reconcile_provider_position_chain_anchor_record_intent($1::text, $2::bytea) AS intent',
      'FROM execute_provider_position_chain_anchor_record_intent($1::text, $2::bytea) AS intent',
    ],
    [
      'providerPositionPostgresChainAnchorRecordIntentReconciliationProcessorSource',
      'const generated: unknown = randomBytes(32);',
      'const generated: unknown = randomBytes(16);',
    ],
    [
      'providerPositionPostgresChainAnchorRecordIntentReconciliationProcessorSource',
      'Object.freeze([lease.recordIntentFingerprintSha256, leaseToken]),',
      'Object.freeze([lease.recordIntentFingerprintSha256, Buffer.from(leaseToken)]),',
    ],
    [
      'providerPositionPostgresChainAnchorRecordIntentReconciliationProcessorSource',
      'leaseToken?.fill(0);',
      'void leaseToken;',
    ],
    [
      'providerPositionPostgresChainAnchorRecordIntentReconciliationProcessorSource',
      'readonly #issued = new WeakMap<',
      'readonly #issued = new Map<',
    ],
    [
      'providerPositionPostgresChainAnchorRecordIntentReconciliationProcessorSource',
      'const RECONCILE_RECORD_SQL = `SELECT',
      "const RELEASE_SQL = 'SELECT * FROM release_provider_chain_anchor_record_intent_reconciliation()';\nconst RECONCILE_RECORD_SQL = `SELECT",
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor } from './infrastructure/postgres-provider-position-chain-anchor-record-intent.reconciliation-processor';",
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read inspection rejects reconciliation lifecycle drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION =\n  1 as const;',
      'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_LIFECYCLE_VERSION =\n  2 as const;',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      'const MAX_WORK_ITEMS = 64;',
      'const MAX_WORK_ITEMS = 65;',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      'const MAX_RUN_MILLISECONDS = 30_000;',
      'const MAX_RUN_MILLISECONDS = 60_000;',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      'const MIN_RETRY_DELAY_MILLISECONDS = 10;',
      'const MIN_RETRY_DELAY_MILLISECONDS = 0;',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      "const DEPENDENCY_KEYS = Object.freeze(['reconciliation', 'clock', 'timer', 'policy'] as const);",
      "const DEPENDENCY_KEYS = Object.freeze(['reconciliation', 'clock', 'timer', 'policy', 'logger'] as const);",
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      'while (counts.attempts < this.#dependencies.maximumWorkItems) {',
      'while (counts.attempts <= this.#dependencies.maximumWorkItems) {',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      "if (reviewed !== capability) return fail('RESULT_AUTHENTICATION_FAILED');",
      'void capability;',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      'capability: await operation',
      'capability: operation',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      'const retryAt = Math.max(',
      'const retryAt = Math.min(',
    ],
    [
      'providerPositionChainAnchorRecordIntentReconciliationLifecycleSource',
      'export class DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle {',
      'setInterval(() => undefined, 1);\nexport class DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle {',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { DormantProviderPositionChainAnchorRecordIntentReconciliationLifecycle } from './application/provider-position-chain-anchor-record-intent-reconciliation.lifecycle';",
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read blockers participate in both readiness calculations', () => {
  const source = readFileSync(PREFLIGHT_SCRIPT_PATH, 'utf8');
  const readOnlyStart = source.indexOf('const publicReadOnly = readinessFor([');
  const mainnetStart = source.indexOf('const mainnetWrites = readinessFor([', readOnlyStart);
  const readinessEnd = source.indexOf('return Object.freeze({', mainnetStart);
  assert.ok(readOnlyStart >= 0 && mainnetStart > readOnlyStart && readinessEnd > mainnetStart);
  assert.equal(
    source.slice(readOnlyStart, mainnetStart).split("'PROVIDER_POSITION_READ_BOUNDARY'").length - 1,
    1,
  );
  assert.equal(
    source.slice(mainnetStart, readinessEnd).split("'PROVIDER_POSITION_READ_BOUNDARY'").length - 1,
    1,
  );
});

test('provider-position read inspection rejects trust, runtime bounds, coverage, and dormancy drift', () => {
  const mutations: readonly (readonly [
    keyof ProviderPositionReadBoundaryArtifactSources,
    string,
    string,
  ])[] = [
    [
      'providerPositionReaderPortSource',
      'export const MAINNET_PROVIDER_POSITION_READER_VERSION = 3 as const;',
      'export const MAINNET_PROVIDER_POSITION_READER_VERSION = 2 as const;',
    ],
    [
      'providerPositionReaderPortSource',
      'readonly correlationId: string;',
      'readonly correlationId: string;\n  readonly evaluatedAt: string;',
    ],
    [
      'providerPositionReaderPortSource',
      'readonly coveredSnapshot: CoveredMainnetProviderPositionSnapshotV1;',
      'readonly coveredSnapshot?: CoveredMainnetProviderPositionSnapshotV1;',
    ],
    [
      'providerPositionReaderPortSource',
      '): Promise<MainnetProviderPositionReadResultV3>;',
      '): Promise<CoveredMainnetProviderPositionSnapshotV1>;',
    ],
    [
      'providerPositionReaderPortSource',
      'readonly coverageVersion: typeof MAINNET_PROVIDER_POSITION_COVERAGE_VERSION;',
      'readonly coverageVersion?: typeof MAINNET_PROVIDER_POSITION_COVERAGE_VERSION;',
    ],
    [
      'providerPositionTrustedAssemblyPortSource',
      'readonly mayPersist: false;',
      'readonly mayPersist: true;',
    ],
    [
      'providerPositionTrustedAssemblyPortSource',
      'readonly mayAuthorizeFinancialAction: false;',
      'readonly mayAuthorizeFinancialAction: true;',
    ],
    [
      'providerPositionDurableChainAnchorReaderPortSource',
      'export const PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION = 1 as const;',
      'export const PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION = 2 as const;',
    ],
    [
      'providerPositionDurableChainAnchorReaderPortSource',
      'readonly capturedAt: string;',
      'readonly callerCapturedAt: string;',
    ],
    [
      'providerPositionDurableChainAnchorReaderPortSource',
      'readonly mayPersist: false;',
      'readonly mayPersist: true;',
    ],
    [
      'providerPositionDurableChainAnchorReaderPortSource',
      'readAnchor(request: ReadProviderPositionDurableChainAnchorRequestV1): Promise<unknown>;',
      'readAnchor(request: ReadProviderPositionDurableChainAnchorRequestV1): Promise<ProviderPositionDurableChainAnchorAssessmentV1>;',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      "Object.getOwnPropertyDescriptor(current, 'queryWithCancellation')",
      "Object.getOwnPropertyDescriptor(current, 'query')",
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      'const result = (await Reflect.apply(this.#queryWithCancellation, this.#receiver, [',
      'const result = (await (this.#receiver as PostgresService).query(',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      '        request.signal,\n      ])) as unknown;',
      '        new AbortController().signal,\n      ])) as unknown;',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      "rowDescriptors['length']?.value !== 1 ||",
      "rowDescriptors['length']?.value > 1 ||",
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      'readonly #issued = new WeakMap<object, ReadProviderPositionDurableChainAnchorRequestV1>();',
      'readonly #issued = new Map<object, ReadProviderPositionDurableChainAnchorRequestV1>();',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      'export class PostgresProviderPositionDurableChainAnchorReader implements ProviderPositionDurableChainAnchorReaderPort {',
      "export class PostgresProviderPositionDurableChainAnchorReader implements ProviderPositionDurableChainAnchorReaderPort {\n  readonly writerFunction = 'record_provider_position_chain_anchor_evidence';",
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      'FROM read_provider_position_chain_anchor_evidence(',
      'FROM record_provider_position_chain_anchor_evidence(',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      'assessment.continuity_floor::text AS continuity_floor_json,',
      'assessment.continuity_floor AS continuity_floor_json,',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      "assessment.assessed_at AT TIME ZONE 'UTC',",
      'assessment.assessed_at,',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      'if (isAborted(request.signal)) return fail();',
      'void request.signal;',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      "  'signal',\n] as const);",
      "  'substitutedSignal',\n] as const);",
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      'export const PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_ERROR = Object.freeze(',
      'export const PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_ERROR = (',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      "row.identity_status !== 'VERIFIED' ||",
      'false ||',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      '!sameAnchor(chainAnchor, request.chainAnchor) ||',
      'false ||',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      'assessedAt.milliseconds > request.capturedAtMilliseconds',
      'assessedAt.milliseconds > Date.parse(request.deadlineAt)',
    ],
    [
      'providerPositionPostgresDurableChainAnchorReaderSource',
      'this.#issued.get(capability) === request',
      'this.#issued.has(capability)',
    ],
    ['mainnetLaunchNetworkPolicySource', "'eip155:1',", "'eip155:8453',"],
    [
      'mainnetLaunchNetworkPolicySource',
      "'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',",
      "'eip155:56',",
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      "const readAnchor = stableDataMember(value, 'readAnchor');",
      'const readAnchor = value.readAnchor;',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'private readonly issued = new WeakMap<object, IssuedAssessmentSeal>();',
      'private readonly issued = new Map<object, IssuedAssessmentSeal>();',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'UNISSUED_ANCHOR_CAPABILITY,',
      'Object.freeze({ learned: true }),',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'const capability = await Reflect.apply(this.reader.readAnchor, this.reader.receiver, [',
      'const capability = await Promise.all([Reflect.apply(this.reader.readAnchor, this.reader.receiver, [',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'const assessment = reviewAnchorAssessment(capability, request, reviewed);',
      'const assessment = capability as ProviderPositionDurableChainAnchorAssessmentV1;',
    ],
    ['providerPositionTrustedChainAssessmentAssemblerSource', 'requestClone,', 'request,'],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'Reflect.apply(this.reader.verifyAnchor, this.reader.receiver, [assessment, request]) !==',
      'false &&',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'capturedAt: reviewed.capturedAt,',
      'capturedAt: reviewed.evaluatedAt,',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'assessedAt.milliseconds > reviewed.capturedAtMilliseconds ||',
      'assessedAt.milliseconds < reviewed.capturedAtMilliseconds ||',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'acceptedSource !== selection.source ||',
      'false ||',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      '!sameAnchor(observationAnchor, matchingSelection.source.chainAnchor) ||',
      'false ||',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'position.asset === observation.asset &&',
      'true &&',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'const fingerprint = mainnetProviderPositionObservationFingerprintV1({',
      'const fingerprint = String({',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'return this.issued.get(capability)?.request === request;',
      'return this.issued.has(capability);',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'return seal.contexts.some((expected) => sameVerificationContext(context, expected));',
      'return true;',
    ],
    [
      'providerPositionTrustedChainAssessmentAssemblerSource',
      'const TIMESTAMP = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/u;',
      'void process.env.DATABASE_URL;\nconst TIMESTAMP = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/u;',
    ],
    [
      'providerPositionObservationSource',
      'const observationFingerprint = mainnetProviderPositionObservationFingerprintV1({',
      'const observationFingerprint = String({',
    ],
    [
      'providerPositionObservationSource',
      'if (sourceObservationId !== expectedSourceObservationId) {',
      'if (false) {',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'assembly.verifyAssembly(chainAssessment, assemblyRequest) !== true',
      'false',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'if (record.sourceObservationId !== expectedSourceObservationId) {',
      'if (false) {',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      "const assemble = stableDataMember(value, 'assemble');",
      'const assemble = value.assemble;',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'const verified = canonicalClock(this.clock.now());',
      'const verified = completed;',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'const ISSUED_PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLIES = new WeakSet<object>();',
      'const ISSUED_PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLIES = new Set<object>();',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'ISSUED_PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLIES.has(value)',
      'Boolean(value)',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'ISSUED_PROVIDER_POSITION_ADMISSION_READ_ONLY_ASSEMBLIES.add(readOnlyAssembly);',
      'void readOnlyAssembly;',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'accountId: candidate.accountId,\n          evaluatedAt: evaluated.timestamp,\n          expectedWallets: prepared.wallets,',
      'accountId: candidate.accountId,\n          evaluatedAt: completed.timestamp,\n          expectedWallets: prepared.wallets,',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'mayPersist: false,\n        evaluatedAt: evaluated.timestamp,\n        admissionCandidate: candidate,',
      'mayPersist: false,\n        evaluatedAt: completed.timestamp,\n        admissionCandidate: candidate,',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'readonly signal: AbortSignal;',
      'readonly signal?: AbortSignal;',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'signal: activeController.signal,',
      'signal: new AbortController().signal,',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'evaluatedAt: started.timestamp,\n                correlationId: request.correlationId,\n                signal: activeController.signal,',
      'evaluatedAt: started.timestamp,\n                correlationId: request.correlationId,',
    ],
    ['providerPositionAdmissionCoordinatorSource', 'isProxy(sourceIdentity)', 'false'],
    [
      'providerPositionAdmissionCoordinatorSource',
      "const readTarget = stableDataMember(sourceReceiver, 'readTarget');",
      'const readTarget = (sourceReceiver as ProviderPositionAdmissionSourcePort).readTarget;',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      "if (typeof readTarget !== 'function' || isProxy(readTarget)) {",
      "if (typeof readTarget !== 'function') {",
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      "if (isProxy(current)) return fail('INVALID_CONFIGURATION');",
      'void current;',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'Reflect.apply(readTarget, sourceReceiver, [request]) as Promise<unknown>',
      '(sourceReceiver as ProviderPositionAdmissionSourcePort).readTarget(request)',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'this.admissionOpen = false;',
      'this.admissionOpen = true;',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'for (const controller of [...this.activeAdmissionControllers]) {',
      'for (const controller of [...this.activeAdmissionControllers].slice(0, 1)) {',
    ],
    ['providerPositionAdmissionCoordinatorSource', 'failed = true;', 'void controller;'],
    [
      'providerPositionAdmissionCoordinatorSource',
      'this.activeAdmissionControllers.add(activeController);',
      'void activeController;',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'this.activeAdmissionControllers.delete(activeController);',
      'void activeController;',
    ],
    [
      'portfolioWalletRegistrationReaderPortSource',
      'readonly signal: AbortSignal;',
      'readonly signalWasDropped?: never;',
    ],
    [
      'registeredPortfolioWalletReaderSource',
      'const roster = await this.wallets.listActiveWallets(',
      'const roster = await this.wallets.listActiveWalletsWithoutCancellation(',
    ],
    [
      'registeredPortfolioWalletReaderSource',
      'Object.freeze({ signal: request.signal }),',
      'Object.freeze({}),',
    ],
    [
      'walletRegistrationServiceSource',
      'options === undefined ? { accountId } : { accountId, signal: options.signal },',
      'options === undefined ? { accountId } : { accountId },',
    ],
    [
      'walletRegistrationRepositoryPortSource',
      'readonly signal?: AbortSignal;',
      'readonly signalWasDropped?: never;',
    ],
    [
      'postgresWalletRegistrationRepositorySource',
      'const signal = request.signal;',
      'const signal = new AbortController().signal;',
    ],
    [
      'postgresWalletRegistrationRepositorySource',
      ': await this.postgres.queryWithCancellation<ActiveWalletRow>(',
      ': await this.postgres.query<ActiveWalletRow>(',
    ],
    [
      'postgresWalletRegistrationRepositorySource',
      '? await this.postgres.query<ActiveWalletRow>(query, values)',
      '? await this.postgres.queryWithCancellation<ActiveWalletRow>(query, values, signal)',
    ],
    [
      'postgresWalletRegistrationRepositorySource',
      'const values = [accountId];',
      'const values = [request.accountId];',
    ],
    [
      'providerPositionPostgresServiceSource',
      'this.executeCancellableQuery<Row>(queryTextOrConfig, values, signal),',
      'this.executeCancellableQuery<Row>(queryTextOrConfig, values, new AbortController().signal),',
    ],
    [
      'providerPositionPostgresServiceSource',
      'const outcome = await querySettlement;',
      'const outcome = await Promise.race([querySettlement]);',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'prepared.abortAdmission();',
      'void prepared.abortAdmission;',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'abortAdmission: activeAbortAdmission,',
      'abortAdmission: () => undefined,',
    ],
    [
      'providerPositionAdmissionCoordinatorSource',
      'while (!failed && !controller.signal.aborted && next < inputs.length) {',
      'while (next < inputs.length) {',
    ],
    [
      'providerPositionDeadlineRunnerSource',
      'const MAX_DEADLINE_MILLISECONDS = 30_000;',
      'const MAX_DEADLINE_MILLISECONDS = 300_000;',
    ],
    [
      'providerPositionDeadlineRunnerSource',
      "from '../application/provider-position-admission.coordinator';",
      "from 'node:https';",
    ],
    [
      'providerPositionDeadlineRunnerSource',
      'const DATE_PARSE = Date.parse;',
      'const DATE_PARSE = process.env.PROVIDER_POSITION_DATE_PARSE;',
    ],
    [
      'providerPositionDeadlineRunnerSource',
      'export class NodeProviderPositionAdmissionDeadlineRunner',
      '@Injectable()\nexport class NodeProviderPositionAdmissionDeadlineRunner',
    ],
    [
      'providerPositionDeadlineRunnerSource',
      'const SYSTEM_SET_TIMEOUT = globalThis.setTimeout;',
      'const SYSTEM_SET_TIMEOUT = globalThis.setInterval;',
    ],
    [
      'providerPositionDeadlineRunnerSource',
      'const outcome: OperationOutcome<T> = await Promise.resolve()',
      'const outcome: OperationOutcome<T> = await Promise.race([Promise.resolve()])',
    ],
    [
      'providerPositionDeadlineRunnerSource',
      "if (!outcome.ok && cause === null) abortWith('OPERATION_FAILED');",
      'void outcome;',
    ],
    [
      'providerPositionDeadlineRunnerSource',
      'completedAt >= request.deadlineMilliseconds',
      'completedAt > request.deadlineMilliseconds',
    ],
    [
      'providerPositionDeadlineRunnerSource',
      'Reflect.apply(request.abortAdmission, undefined, []);',
      'void request.abortAdmission;',
    ],
    ['providerPositionDeadlineRunnerSource', 'this.cancelTimer(timer);', 'void timer;'],
    ['providerPositionDeadlineRunnerSource', 'request.signal.remove(onAbort);', 'void onAbort;'],
    [
      'providerPositionDeadlineRunnerSource',
      "if (!request.signal.aborted()) return fail('INVALID_ABORT_CAPABILITY');",
      'void request.signal;',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'export const PROVIDER_POSITION_ADMISSION_MAX_DEADLINE_MILLISECONDS = 30_000 as const;',
      'export const PROVIDER_POSITION_ADMISSION_MAX_DEADLINE_MILLISECONDS = 300_000 as const;',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'export const PROVIDER_POSITION_ADMISSION_MAX_CONCURRENCY = 8 as const;',
      'export const PROVIDER_POSITION_ADMISSION_MAX_CONCURRENCY = 16 as const;',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      "const API_DATABASE_SESSION_ROLE = 'crypto_api_runtime' as const;",
      "const API_DATABASE_SESSION_ROLE = 'crypto_worker_runtime' as const;",
    ],
    ['providerPositionRuntimeBoundsSource', "if (record.workload !== 'api') {", 'if (false) {'],
    ['providerPositionRuntimeBoundsSource', "value.includes('?') ||", 'false ||'],
    ['providerPositionRuntimeBoundsSource', "value.includes('#')", 'false'],
    [
      'providerPositionRuntimeBoundsSource',
      'if (!loopback && (snapshot.rejectUnauthorized !== true || snapshot.ca === undefined)) {',
      'if (false) {',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'database: databaseSnapshot(record.database),',
      'database: record.database as Readonly<DatabaseInfrastructureConfig>,',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'const admissionOptions = admissionOptionsSnapshot(admissionOptionsInput);',
      'const admissionOptions = admissionOptionsInput;',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'if (postgresPoolConfig.database.connectionTimeoutMs > admissionOptions.deadlineMilliseconds) {',
      'if (postgresPoolConfig.database.connectionTimeoutMs < admissionOptions.deadlineMilliseconds) {',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'pool = createPostgresPool(postgresPoolConfig);',
      'pool = createPostgresPool(postgresConfigInput);',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'pool = createPostgresPool(postgresPoolConfig);',
      'pool = factory(postgresPoolConfig);',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'pool = createPostgresPool(postgresPoolConfig);',
      "pool = createPostgresPool(postgresPoolConfig);\n    void pool.query('SELECT 1');",
    ],
    [
      'providerPositionRuntimeBoundsSource',
      "return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_CONSTRUCTION_FAILED');",
      'throw error;',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'Object.assign(Object.create(null) as ProviderPositionAdmissionOptions, {',
      'Object.assign({} as ProviderPositionAdmissionOptions, {',
    ],
    [
      'providerPositionRuntimeBoundsSource',
      "const POSTGRES_CONFIG_KEYS = Object.freeze(['workload', 'database'] as const);",
      "const POSTGRES_CONFIG_KEYS = Object.freeze(['workload', 'database'] as const);\nvoid process.env.DATABASE_URL;",
    ],
    [
      'providerPositionRuntimeBoundsSource',
      'export function createDormantProviderPositionAdmissionRuntimeResource(',
      '@Injectable()\nexport function createDormantProviderPositionAdmissionRuntimeResource(',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const pool: Pool = runtimeResource.pool;',
      'const pool: Pool = dependencies.pool;',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      "  'clock',\n] as const);",
      "  'clock',\n  'durableChainAnchorReader',\n] as const);",
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const durableChainAnchorReader = new PostgresProviderPositionDurableChainAnchorReader(postgres);',
      'const durableChainAnchorReader = dependencies.durableChainAnchorReader;',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'new DormantProviderPositionTrustedChainAssessmentAssembler(durableChainAnchorReader);',
      'new DormantProviderPositionTrustedChainAssessmentAssembler(dependencies.durableChainAnchorReader);',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'trustedChainAssessmentAssembly,',
      'dependencies.durableChainAnchorReader,',
    ],
    ['providerPositionRuntimeCompositionSource', 'trustedChainAssessmentAssembly,', 'undefined,'],
    [
      'providerPositionRuntimeCompositionSource',
      'coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,\n    readCurrentPositions: (',
      'coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,\n    trustedChainAssessmentAssembly: true,\n    readCurrentPositions: (',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'reader,\n    close,',
      'reader,\n    durableChainAnchorReader: true,\n    close,',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'runtimeResource.admissionOptions,',
      'dependencies.admissionOptions,',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'if (isProxy(current)) return undefined;',
      'void current;',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      "if (typeof method !== 'function' || isProxy(method)) {",
      "if (typeof method !== 'function') {",
    ],
    ['providerPositionRuntimeCompositionSource', 'isProxy(closeAdmission)', 'false'],
    [
      'providerPositionRuntimeCompositionSource',
      'if (!isIssuedProviderPositionAdmissionReadOnlyAssemblyV1(value)) {',
      'if (false) {',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'candidate.accountId !== request.accountId ||',
      'false ||',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'candidate.correlationId !== request.correlationId ||',
      'false ||',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'candidateCoverageManifest.fingerprintSha256 !== coverageManifest.fingerprintSha256 ||',
      'false ||',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'Date.parse(evaluatedAt) >= Date.parse(staleAfter)',
      'Date.parse(evaluatedAt) > Date.parse(staleAfter)',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const assembly = await (Reflect.apply(admitAndAssemble, coordinator, [',
      'const assembly = await (coordinator.admitAndAssemble(',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,',
      'coverageVersion: MAINNET_PROVIDER_POSITION_COVERAGE_VERSION,\n    close,',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'coveredSnapshot,',
      'coveredSnapshot: { ...coveredSnapshot },',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const walletRepository = new PostgresWalletRegistrationRepository(postgres);',
      'const walletRepository = dependencies.walletRepository;',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'Reflect.apply(closeAdmission, coordinator, []);',
      'void closeAdmission;',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'Promise.allSettled([postgresDrain, ...operationGates])',
      'Promise.allSettled([postgresDrain])',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'let postgresDrain: Promise<void>;',
      'void handles.endPool();\n    let postgresDrain: Promise<void>;',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'await closeOwnedRuntime({ closePostgres, endPool });',
      'void closeOwnedRuntime;',
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'void process.env.DATABASE_URL;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
    [
      'providerPositionInfrastructureConfigSource',
      'connectionTimeoutMs: 60_000,',
      'connectionTimeoutMs: 600_000,',
    ],
    [
      'providerPositionRuntimePostgresPoolSource',
      'connectionTimeoutMillis: config.database.connectionTimeoutMs,',
      'connectionTimeoutMillis: 60_000,',
    ],
    [
      'providerPositionRuntimePostgresPoolSource',
      "api: 'crypto_api_runtime',",
      "api: 'crypto_worker_runtime',",
    ],
    ['providerPositionAdmissionCoordinatorSource', 'selectedTargetSources.push(', 'void ('],
    ['providerPositionAdmissionCoordinatorSource', 'mayPersist: false,', 'mayPersist: true,'],
    ['providerPositionCoverageSource', 'if (observationsInput.length === 0) {', 'if (true) {'],
    [
      'providerPositionCoverageSource',
      'if (request.chainAssessment === undefined || request.chainAssessmentVerifier === undefined) {',
      'if (false) {',
    ],
    ['providerPositionCoverageSource', "if (target.status !== 'COMPLETE') {", 'if (false) {'],
    ['providerPositionObservationSource', 'chainAssessmentVerifier.verify(', 'Boolean('],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor, MAINNET_PROVIDER_POSITION_READER],',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor, NodeProviderPositionAdmissionDeadlineRunner],',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor, createDormantProviderPositionAdmissionRuntimeResource],',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor, createDormantProviderPositionAdmissionRuntimeComposition],',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor, DormantProviderPositionTrustedChainAssessmentAssembler],',
    ],
    [
      'mainnetPlatformsModuleSource',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor, PostgresProviderPositionDurableChainAnchorReader],',
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { DormantProviderPositionAdmissionCoordinator } from './application/provider-position-admission.coordinator';",
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { NodeProviderPositionAdmissionDeadlineRunner } from './infrastructure/node-provider-position-admission-deadline.runner';",
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { createDormantProviderPositionAdmissionRuntimeResource } from './infrastructure/provider-position-admission-runtime-bounds';",
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { createDormantProviderPositionAdmissionRuntimeComposition } from './infrastructure/provider-position-admission-runtime.composition';",
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { isIssuedProviderPositionAdmissionReadOnlyAssemblyV1 } from './application/provider-position-admission.coordinator';",
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export type { ProviderPositionDurableChainAnchorReaderPort } from './application/ports/provider-position-durable-chain-anchor-reader.port';",
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { DormantProviderPositionTrustedChainAssessmentAssembler } from './infrastructure/dormant-provider-position-trusted-chain-assessment.assembler';",
    ],
    [
      'mainnetPlatformsIndexSource',
      "export { MainnetPlatformDirectoryService } from './application/mainnet-platform-directory.service';",
      "export { PostgresProviderPositionDurableChainAnchorReader } from './infrastructure/postgres-provider-position-durable-chain-anchor.reader';",
    ],
    [
      'providerPositionRuntimeCompositionSource',
      'const DEPENDENCY_KEYS = Object.freeze([',
      'type DormantProviderPositionTrustedChainAssessmentAssembler = unknown;\nconst DEPENDENCY_KEYS = Object.freeze([',
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly reader: MainnetProviderPositionReader) {}',
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly deadlineRunner: NodeProviderPositionAdmissionDeadlineRunner) {}',
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly runtime: DormantProviderPositionAdmissionRuntimeResource) {}',
    ],
    [
      'mainnetPlatformsControllerSource',
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
      'constructor(private readonly assembler: DormantProviderPositionTrustedChainAssessmentAssembler) {}',
    ],
  ];

  for (const [key, approved, rejected] of mutations) {
    assert.deepEqual(
      inspectProviderPositionReadBoundaryArtifacts(
        mutateProviderPositionReadArtifact(key, approved, rejected),
      ),
      INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      `${key}: ${approved}`,
    );
  }
});

test('provider-position read artifact shape and private brand fail closed', () => {
  const malformed: unknown[] = [null, {}, { ...PROVIDER_POSITION_READ_ARTIFACTS, extra: '' }];
  for (const key of Object.keys(
    PROVIDER_POSITION_READ_ARTIFACTS,
  ) as readonly (keyof ProviderPositionReadBoundaryArtifactSources)[]) {
    const missing = { ...PROVIDER_POSITION_READ_ARTIFACTS } as Record<string, unknown>;
    delete missing[key];
    malformed.push(missing);
  }

  const accessor = { ...PROVIDER_POSITION_READ_ARTIFACTS } as Record<string, unknown>;
  Object.defineProperty(accessor, 'providerPositionReaderPortSource', {
    enumerable: true,
    get() {
      throw new Error('must not read accessor');
    },
  });
  const withSymbol = {
    ...PROVIDER_POSITION_READ_ARTIFACTS,
  } as Record<PropertyKey, unknown>;
  withSymbol[Symbol('unexpected')] = 'value';
  malformed.push(
    { ...PROVIDER_POSITION_READ_ARTIFACTS, providerPositionReaderPortSource: 1 },
    {
      ...PROVIDER_POSITION_READ_ARTIFACTS,
      providerPositionReaderPortSource: 'x'.repeat(128 * 1024 + 1),
    },
    Object.fromEntries(
      Object.keys(PROVIDER_POSITION_READ_ARTIFACTS).map((key) => [
        key,
        'x'.repeat(Math.floor((1088 * 1024) / 42) + 1),
      ]),
    ),
    accessor,
    withSymbol,
    new Proxy(PROVIDER_POSITION_READ_ARTIFACTS, {
      ownKeys() {
        throw new Error('untrusted proxy');
      },
    }),
  );

  for (const candidate of malformed) {
    assert.doesNotThrow(() => inspectProviderPositionReadBoundaryArtifacts(candidate));
    assert.deepEqual(inspectProviderPositionReadBoundaryArtifacts(candidate), {
      ...INVALID_PROVIDER_POSITION_READ_BOUNDARY,
      inspected: false,
    });
  }

  const complete = completeInput(platformDirectory('LIVE_READ_ONLY'));
  const omitted = { ...complete } as Record<string, unknown>;
  delete omitted.providerPositionReadBoundary;
  const hostile = { ...complete } as ProductionPreflightInput;
  Object.defineProperty(hostile, 'providerPositionReadBoundary', {
    enumerable: true,
    get() {
      throw new Error('untrusted input getter');
    },
  });
  const forgedInputs = [
    omitted as unknown as ProductionPreflightInput,
    hostile,
    {
      ...complete,
      providerPositionReadBoundary: Object.freeze({
        ...EXPECTED_DORMANT_PROVIDER_POSITION_READ_BOUNDARY,
      }),
    },
  ];
  for (const input of forgedInputs) {
    assert.deepEqual(
      evaluateProductionPreflight(input).checks.find(
        ({ id }) => id === 'PROVIDER_POSITION_READ_BOUNDARY',
      ),
      {
        id: 'PROVIDER_POSITION_READ_BOUNDARY',
        localValidation: 'FAIL',
        launchReadiness: 'BLOCKED',
        blockerIds: ['PROVIDER_POSITION_READ_BOUNDARY_INSPECTION_FAILED'],
      },
    );
  }
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
        '  suspendGenericWorkerBalanceAuthorityMigrationV0028,\n  createProviderPositionChainAnchorEvidenceMigrationV0029,',
        '  createProviderPositionChainAnchorEvidenceMigrationV0029,',
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
    [
      'balanceConsumerResourceSource',
      'const BALANCE_SYNC_CONSUMER_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;',
      'const BALANCE_SYNC_CONSUMER_SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;',
    ],
    ['balanceConsumerResourceSource', 'closePromise = publicClose;', 'void publicClose;'],
    [
      'balanceConsumerResourceSource',
      'rejectClose(new BalanceSyncConsumerResourceShutdownDrainTimeoutError());',
      'resolveClose();',
    ],
    ['balanceConsumerResourceSource', 'shutdownTimeout.unref?.();', 'void shutdownTimeout;'],
    ['balanceConsumerResourceSource', 'void cleanup.then(', 'void Promise.race([cleanup]).then('],
    ['balanceConsumerResourceSource', 'clearWatchdog();', 'void shutdownTimeout;'],
    ['balanceConsumerResourceSource', 'startCleanup();', 'void cleanup;'],
    ['balanceConsumerEnvelopeSource', 'StopTimeout: 30', 'StopTimeout: 20'],
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
      'if (closeOperation !== undefined) return closeOperation;',
      'if (closeOperation !== undefined) closeOperation = undefined;',
    ],
    [
      'balanceConsumerLifecycleSource',
      'closeOperation = closeResource(reviewed.closeResource);',
      'closeOperation = Promise.resolve(true);',
    ],
    [
      'balanceConsumerLifecycleSource',
      'void closeOperation.then(() => {',
      'void 0 && closeOperation.then(() => {',
    ],
    ['balanceConsumerLifecycleSource', 'if (stopRequested) return;', 'if (false) return;'],
    [
      'balanceConsumerLifecycleSource',
      'if (runHandoffComplete) void beginClose();',
      'void runHandoffComplete;',
    ],
    [
      'balanceConsumerLifecycleSource',
      'observedRun = runOperation.then(',
      'observedRun = Promise.resolve(); void runOperation.then(',
    ],
    ['balanceConsumerLifecycleSource', 'runHandoffComplete = true;', 'runHandoffComplete = false;'],
    [
      'balanceConsumerLifecycleSource',
      'if (stopRequested) void beginClose();',
      'void stopRequested;',
    ],
    ['balanceConsumerLifecycleSource', 'await progress;', 'await runOperation;'],
    [
      'balanceConsumerLifecycleSource',
      'if (observedRun !== undefined && !runSettled) await observedRun;',
      'void observedRun;',
    ],
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

test('balance-consumer inspection rejects mainnet router scope, snapshot, and capture drift', () => {
  const mutations: readonly (readonly [string, string])[] = [
    [
      "export const ETHEREUM_MAINNET_BALANCE_NETWORK_ID = 'eip155:1' as const;",
      "export const ETHEREUM_MAINNET_BALANCE_NETWORK_ID = 'eip155:8453' as const;",
    ],
    [
      "export const SOLANA_MAINNET_BALANCE_NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;",
      "export const SOLANA_MAINNET_BALANCE_NETWORK_ID = 'eip155:137' as const;",
    ],
    ['!UUID_V4.test(record.accountId) ||', 'record.accountId.length === 0 ||'],
    ['!UUID_V4.test(record.walletId) ||', 'record.walletId.length === 0 ||'],
    [
      'const validated = copyReadRequest(request, READ_REQUEST_KEYS);',
      'const validated = request;',
    ],
    [
      'return this.indexerFor(validated.networkId).rescanFromCheckpoint(validated, context);',
      'return this.indexerFor(validated.networkId).rescanFromCheckpoint(request, context);',
    ],
    [
      "if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {",
      'if (!descriptor || descriptor.enumerable !== true) {',
    ],
    ['return Object.freeze(Object.assign(Object.create(null) as T, members));', 'return members;'],
    [
      'if (ethereum === solana) return invalidConfiguration();',
      'if (false) return invalidConfiguration();',
    ],
    [
      "const readCurrent = capturedDataMethod(receiver, 'readCurrent');",
      'const readCurrent = (receiver as BalanceSyncIndexerPort).readCurrent;',
    ],
    [
      'const descriptor = Object.getOwnPropertyDescriptor(owner, name);',
      'const descriptor = Reflect.get(owner, name);',
    ],
    ['owner !== Object.prototype &&', 'owner !== null &&'],
    [
      '      default:\n        return unsupportedRequest();',
      '      default:\n        return this.ethereum;',
    ],
    [
      '      case ETHEREUM_MAINNET_BALANCE_NETWORK_ID:\n        return this.ethereum;',
      "      case ETHEREUM_MAINNET_BALANCE_NETWORK_ID:\n        return this.ethereum;\n      case 'eip155:8453':\n        return this.ethereum;",
    ],
  ];

  for (const [approved, rejected] of mutations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(
        mutateBalanceConsumerArtifact('mainnetBalanceIndexerRouterSource', approved, rejected),
      ),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      approved,
    );
  }

  assert.deepEqual(
    inspectBalanceConsumerDeploymentArtifacts(
      mutateBalanceConsumerArtifact(
        'compositionSource',
        'const indexer = new MainnetBalanceIndexerRouter(ethereumIndexer, solanaIndexer);',
        'const indexer = new MainnetBalanceIndexerRouter(ethereumIndexer, ethereumIndexer);',
      ),
    ),
    INVALID_BALANCE_CONSUMER_DEPLOYMENT,
  );
});

test('balance-consumer inspection rejects unauthenticated or mutable failure classification', () => {
  const mutations: readonly (readonly [keyof BalanceConsumerArtifactSources, string, string])[] = [
    [
      'balanceSyncDomainSource',
      'const VERIFIED_BALANCE_SYNC_INDEXER_FAILURES = new WeakSet<object>();',
      'const VERIFIED_BALANCE_SYNC_INDEXER_FAILURES = new Set<object>();',
    ],
    ['balanceSyncDomainSource', 'Object.freeze(this);', 'void this;'],
    ['balanceSyncDomainSource', 'isProxy(value) ||', 'false ||'],
    [
      'balanceSyncDomainSource',
      'descriptor.configurable !== false ||',
      'descriptor.configurable === false ||',
    ],
    ['balanceSyncDomainSource', '? Object.freeze({ code })', '? ({ code })'],
    [
      'balanceSyncDomainSource',
      'const descriptors = Object.getOwnPropertyDescriptors(options) as unknown as PropertyDescriptorMap;',
      'const descriptors = { retryAfterSeconds: { value: options.retryAfterSeconds } } as PropertyDescriptorMap;',
    ],
    [
      'ethereumBalanceIndexerSource',
      'const reviewed = reviewBalanceSyncIndexerFailure(error);',
      'const reviewed = error instanceof BalanceSyncIndexerFailure ? error : null;',
    ],
    [
      'solanaBalanceIndexerSource',
      'const reviewed = reviewBalanceSyncIndexerFailure(error);',
      'const reviewed = error instanceof BalanceSyncIndexerFailure ? error : null;',
    ],
    [
      'ethereumBalanceIndexerSource',
      "return parseEvmWalletAddress(value);\n    } catch {\n      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');",
      'return parseEvmWalletAddress(value);\n    } catch (error) {\n      throw error;',
    ],
    [
      'solanaBalanceIndexerSource',
      "    } catch {\n      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');\n    }\n  }\n\n  private async readBlock(",
      '    } catch (error) {\n      throw error;\n    }\n  }\n\n  private async readBlock(',
    ],
    [
      'ethereumBalanceIndexerSource',
      'const milliseconds = Date.prototype.getTime.call(value) as number;',
      'const milliseconds = value.getTime();',
    ],
    [
      'solanaBalanceIndexerSource',
      'return Date.prototype.toISOString.call(value) as string;',
      'return value.toISOString();',
    ],
    [
      'balanceSyncOrchestratorSource',
      'const reviewedFailure = reviewBalanceSyncIndexerFailure(error);',
      'const reviewedFailure = error instanceof BalanceSyncIndexerFailure ? error : null;',
    ],
    [
      'balanceSyncOrchestratorSource',
      'const VERIFIED_BALANCE_SYNC_ORCHESTRATOR_ERRORS = new WeakSet<object>();',
      'const VERIFIED_BALANCE_SYNC_ORCHESTRATOR_ERRORS = new Set<object>();',
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
});

test('balance-consumer inspection pins the six launch assets and their canonical parsers', () => {
  const registry = BALANCE_CONSUMER_ARTIFACTS.supportedAssetRegistrySource;
  assert.match(registry, /chain: 'BASE'/u);
  assert.match(registry, /chain: 'ARBITRUM'/u);
  assert.deepEqual(
    inspectBalanceConsumerDeploymentArtifacts(BALANCE_CONSUMER_ARTIFACTS),
    EXPECTED_DORMANT_BALANCE_CONSUMER_DEPLOYMENT,
  );

  const launchIdentities = [
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
    '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  ] as const;
  for (const identity of launchIdentities) {
    const index = registry.lastIndexOf(identity);
    assert.ok(index >= 0, `registry is missing launch identity ${identity}`);
    const replacement = `${identity.slice(0, -1)}${identity.endsWith('1') ? '2' : '1'}`;
    const candidate = `${registry.slice(0, index)}${replacement}${registry.slice(index + identity.length)}`;
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts({
        ...BALANCE_CONSUMER_ARTIFACTS,
        supportedAssetRegistrySource: candidate,
      }),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      identity,
    );
  }

  const mutations: readonly (readonly [keyof BalanceConsumerArtifactSources, string, string])[] = [
    [
      'walletIdentitySource',
      '!isAddress(value, { strict: true }) ||',
      '!isAddress(value, { strict: false }) ||',
    ],
    [
      'walletIdentitySource',
      'return value.toLowerCase() as EvmWalletAddress;',
      'return value as EvmWalletAddress;',
    ],
    [
      'walletIdentitySource',
      'decoded.length !== 32 || encodeBase58(decoded) !== value',
      'decoded.length > 32',
    ],
    [
      'walletIdentitySource',
      "if (typeof value !== 'string' || value === ZERO_SOLANA_ADDRESS) {",
      "if (typeof value !== 'string') {",
    ],
    [
      'solanaTokenAccountSource',
      'export const MAX_SOLANA_TOKEN_ACCOUNT_BYTES = 4_096;',
      'export const MAX_SOLANA_TOKEN_ACCOUNT_BYTES = 8_192;',
    ],
    [
      'solanaTokenAccountSource',
      'if (data.length !== SPL_TOKEN_ACCOUNT_BYTES) {',
      'if (data.length < SPL_TOKEN_ACCOUNT_BYTES) {',
    ],
    [
      'solanaTokenAccountSource',
      'const TOKEN_2022_ACCOUNT_TYPE = 2;',
      'const TOKEN_2022_ACCOUNT_TYPE = 1;',
    ],
    [
      'solanaTokenAccountSource',
      "TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',",
      "TOKEN_2022: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',",
    ],
    [
      'solanaTokenAccountSource',
      'const data = Uint8Array.from(input.data);',
      'const data = input.data;',
    ],
    ['solanaTokenAccountSource', 'validateCOption(data, 109, 8);', 'void data;'],
    [
      'solanaTokenAccountSource',
      'owner !== normalizeSolanaPublicKey(input.expectedOwner)',
      'owner !== input.expectedOwner',
    ],
    [
      'ethereumBalanceIndexerSource',
      'if (ETHEREUM_ASSETS.length !== 3)',
      'if (ETHEREUM_ASSETS.length !== 4)',
    ],
    [
      'ethereumBalanceIndexerSource',
      "asset.networkId === ETHEREUM_MAINNET_NETWORK_ID && asset.activationState === 'ACTIVE',",
      "(asset.networkId === ETHEREUM_MAINNET_NETWORK_ID || asset.networkId === 'eip155:8453') && asset.activationState === 'ACTIVE',",
    ],
    [
      'solanaBalanceIndexerSource',
      'SOLANA_ASSETS.length !== 3 ||',
      'SOLANA_ASSETS.length !== 4 ||',
    ],
    [
      'solanaBalanceIndexerSource',
      '[PYUSD_MINT]: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,',
      '[PYUSD_MINT]: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,',
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
});

test('balance-consumer inspection requires one stable Solana header around account reads', () => {
  const mutations: readonly (readonly [string, string])[] = [
    [
      'const selectedHeader = await this.readBlock(BigInt(slot), commitment, context);',
      'const selectedHeader = await Promise.resolve(null);',
    ],
    [
      "if (selectedHeader === null) {\n      throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');",
      "if (selectedHeader === null) {\n      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');",
    ],
    [
      'if (verifiedHeader === null || !sameBlockHeader(selectedHeader, verifiedHeader)) {',
      'if (verifiedHeader === null) {',
    ],
    ['left.parentHash === right.parentHash', 'true'],
    ['header: verifiedHeader,', 'header: selectedHeader,'],
    [
      "if (verifiedHeader === null || !sameBlockHeader(selectedHeader, verifiedHeader)) {\n      throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');",
      "if (verifiedHeader === null || !sameBlockHeader(selectedHeader, verifiedHeader)) {\n      throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');",
    ],
  ];
  for (const [approved, rejected] of mutations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(
        mutateBalanceConsumerArtifact('solanaBalanceIndexerSource', approved, rejected),
      ),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      approved,
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
      'response = await transport.exchange(request, execution.signal);',
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
    ['ethereumBalanceIndexerSource', 'accountId: request.accountId,', 'tier: request.tier,'],
    ['solanaBalanceIndexerSource', 'accountId: request.accountId,', 'selector: request.selector,'],
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
    {
      ...BALANCE_CONSUMER_ARTIFACTS,
      mainnetBalanceIndexerRouterSource: `${BALANCE_CONSUMER_ARTIFACTS.mainnetBalanceIndexerRouterSource}\nvoid fetch('https://unreviewed.invalid');\n`,
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
      runtimeSource: `${BALANCE_CONSUMER_ARTIFACTS.runtimeSource}\nvoid MainnetBalanceIndexerRouter;\n`,
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

test('balance-consumer inspection pins the dormant Node HTTPS transport without wiring it', () => {
  assert.deepEqual(
    inspectBalanceConsumerDeploymentArtifacts(BALANCE_CONSUMER_ARTIFACTS),
    EXPECTED_DORMANT_BALANCE_CONSUMER_DEPLOYMENT,
  );

  const semanticMutations: readonly (readonly [string, string])[] = [
    ["import * as https from 'node:https';", "import * as https from 'node:http';"],
    [
      'export class NodeHttpsBalanceJsonRpcTransport implements BalanceJsonRpcTransport {',
      'export class NodeHttpsBalanceJsonRpcTransport {',
    ],
    ['const CONNECT_TIMEOUT_MS = 2_000;', 'const CONNECT_TIMEOUT_MS = 20_000;'],
    ['const IO_CLOSE_TIMEOUT_MS = 250;', 'const IO_CLOSE_TIMEOUT_MS = 2_500;'],
    ['resolver.resolve6(hostname,', '// resolver.resolve6(hostname,'],
    ['resolver.cancel();', 'void resolver;'],
    ['checkServerIdentity,', 'checkServerIdentity: () => undefined,'],
    ["minVersion: 'TLSv1.2',", "minVersion: 'TLSv1.1',"],
    ['rejectUnauthorized: true,', 'rejectUnauthorized: false,'],
    [
      'normalizeRemoteFamily(candidate.remoteFamily) === expected.family &&',
      'normalizeRemoteFamily(candidate.remoteFamily) !== null &&',
    ],
    [
      "if (headers.has('content-encoding') || headers.has('trailer')) return null;",
      "if (headers.has('content-encoding')) return null;",
    ],
    ['(contentLengths === undefined) === (transferEncodings === undefined)', 'false'],
    ['httpVersionMajor !== 1 ||', 'false ||'],
    ['httpVersionMinor !== 1 ||', 'false ||'],
    ['transferEncodings.length !== 1 ||', 'false ||'],
    [
      "!/^chunked$/iu.test(transferEncodings[0] ?? '')",
      "!/chunked/iu.test(transferEncodings[0] ?? '')",
    ],
    [
      "if (contentLengths?.length !== 1 || !/^(?:[1-9][0-9]{0,6})$/u.test(rawContentLength ?? '')) {",
      'if (contentLengths?.length !== 1) {',
    ],
    [
      'if (!Number.isSafeInteger(contentLength) || contentLength > MAX_JSON_BYTES) return null;',
      'if (!Number.isSafeInteger(contentLength)) return null;',
    ],
    [
      "metadata.framing === 'CONTENT_LENGTH' ? metadata.contentLength : MAX_JSON_BYTES;",
      "metadata.framing === 'CONTENT_LENGTH' ? metadata.contentLength : Number.MAX_SAFE_INTEGER;",
    ],
    ['chunks.length >= MAX_RESPONSE_CHUNKS ||', 'false ||'],
    [
      "(metadata.framing === 'CONTENT_LENGTH' && receivedBytes !== metadata.contentLength)",
      'false',
    ],
    ['!response.complete ||', 'false ||'],
    ['if (!hasNoResponseTrailers(response.rawTrailers)) {', 'if (false) {'],
    ['return Array.isArray(rawTrailers) && rawTrailers.length === 0;', 'return true;'],
    [
      'const awaitResponseClose = state.response !== undefined && !state.responseClosed;',
      'const awaitResponseClose = false;',
    ],
  ];
  for (const [approved, rejected] of semanticMutations) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts(
        mutateBalanceConsumerArtifact('nodeHttpsBalanceJsonRpcTransportSource', approved, rejected),
      ),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      approved,
    );
  }

  const forbiddenTransportCapabilities = [
    "const endpoint = 'https://rpc.vendor.invalid';",
    "const apiKey = 'embedded-provider-secret';",
    "const providerOptions = { credential: 'embedded-provider-secret' };",
    'const rpcHost = process.env.ETHEREUM_RPC_HOST;',
    '@Injectable() class BoundTransportProvider {}',
    'void Promise.race([]);',
  ] as const;
  for (const capability of forbiddenTransportCapabilities) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts({
        ...BALANCE_CONSUMER_ARTIFACTS,
        nodeHttpsBalanceJsonRpcTransportSource: `${BALANCE_CONSUMER_ARTIFACTS.nodeHttpsBalanceJsonRpcTransportSource}\n${capability}\n`,
      }),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      capability,
    );
  }

  const dormantTransportIdentityRoots = [
    'blockchainSyncIndexSource',
    'compositionSource',
    'balanceConsumerResourceSource',
    'balanceConsumerLifecycleSource',
    'runtimeSource',
    'activationSource',
    'cliSource',
    'cliModeSource',
    'balanceConsumerConfigSource',
    'infrastructureConfigSource',
    'blockchainSyncModuleSource',
    'appModuleSource',
    'applicationRootSource',
    'localDevelopmentAppModuleSource',
    'mainSource',
    'outboxWorkerCliSource',
    'redisSessionRevocationCliSource',
    'migrationCliSource',
    'applicationTemplateSource',
    'applicationValidatorSource',
    'workloadTemplateSource',
    'workloadValidatorSource',
    'balanceConsumerEnvelopeSource',
    'releaseManifestSource',
    'apiPackageSource',
    'rootPackageSource',
    'productionContainerValidatorSource',
  ] as const satisfies readonly (keyof BalanceConsumerArtifactSources)[];
  assert.equal(dormantTransportIdentityRoots.length, 27);
  const forbiddenBinding = 'void NodeHttpsBalanceJsonRpcTransport;';
  for (const key of dormantTransportIdentityRoots) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts({
        ...BALANCE_CONSUMER_ARTIFACTS,
        [key]: `${BALANCE_CONSUMER_ARTIFACTS[key]}\n${forbiddenBinding}\n`,
      }),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
      key,
    );
  }
});

test('balance-consumer inspection pins the end-to-end execution cancellation chain', () => {
  const mutations: readonly (readonly [keyof BalanceConsumerArtifactSources, string, string])[] = [
    [
      'balanceSyncPortsSource',
      'const VERIFIED_BALANCE_SYNC_EXECUTION_CONTEXTS = new WeakMap<object, AbortSignal>();',
      'const VERIFIED_BALANCE_SYNC_EXECUTION_CONTEXTS = new Map<object, AbortSignal>();',
    ],
    [
      'balanceSyncPortsSource',
      'Reflect.apply(ABORT_CONTROLLER_ABORT, controller, []);',
      'Reflect.apply(ABORT_CONTROLLER_ABORT, controller, [kind]);',
    ],
    [
      'blockchainSyncIndexSource',
      'reviewBalanceSyncExecutionContext,',
      'reviewBalanceSyncExecutionContext,\n  INERT_BALANCE_SYNC_EXECUTION_CONTEXT,',
    ],
    [
      'balanceSyncConsumerServiceSource',
      '/** Propagates one deadline through resolution, RPC, and checkpoint persistence. */',
      '/** Propagates one deadline through RPC only. */',
    ],
    ['balanceSyncConsumerServiceSource', 'jobTimeoutMs: 10_800_000,', 'jobTimeoutMs: 3_600_000,'],
    [
      'balanceSyncConsumerServiceSource',
      "const minimum = key === 'jobTimeoutMs' ? 7_200_000 : 10;",
      "const minimum = key === 'jobTimeoutMs' ? 1 : 10;",
    ],
    [
      'balanceSyncConsumerServiceSource',
      "const maximum = key === 'jobTimeoutMs' ? 21_600_000 : 60_000;",
      "const maximum = key === 'jobTimeoutMs' ? 86_400_000 : 60_000;",
    ],
    [
      'balanceSyncConsumerServiceSource',
      "const deadline = setTimeout(() => owner.abort('DEADLINE'), this.policy.jobTimeoutMs);",
      "const deadline = setTimeout(() => owner.abort('SHUTDOWN'), this.policy.jobTimeoutMs);",
    ],
    ['balanceSyncConsumerServiceSource', 'deadline.unref?.();', 'void deadline;'],
    [
      'balanceSyncConsumerServiceSource',
      'await this.dispatcher.dispatch(job, owner.context);',
      'await this.dispatcher.dispatch(job, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);',
    ],
    [
      'balanceSyncConsumerServiceSource',
      'if (listening) runSignal.remove(relayShutdown);',
      'void listening;',
    ],
    [
      'compositionSource',
      'await orchestrator.process(job, context);',
      'await orchestrator.process(job, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);',
    ],
    [
      'reviewedJobDispatcherSource',
      "if (reviewBalanceSyncExecutionContext(context) === null) return fail('JOB_HANDLER_FAILED');",
      'void context;',
    ],
    [
      'reviewedJobDispatcherSource',
      'await this.handler(job, context);',
      'await this.handler(job, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);',
    ],
    [
      'reviewedJobDispatcherSource',
      'if (balanceSyncReceiptRetryMinimumDelaySeconds(error) !== undefined) throw error;',
      "return fail('JOB_HANDLER_FAILED');",
    ],
    [
      'balanceSyncOrchestratorSource',
      'const value = await this.indexer.readCurrent(request, context);',
      'const value = await this.indexer.readCurrent(request, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);',
    ],
    [
      'balanceSyncOrchestratorSource',
      'value = await this.indexer.rescanFromCheckpoint(request, context);',
      'value = await this.indexer.rescanFromCheckpoint(request, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);',
    ],
    [
      'balanceSyncOrchestratorSource',
      'value = await this.checkpoints.load(scope, context);',
      'value = await this.checkpoints.load(scope);',
    ],
    [
      'balanceSyncOrchestratorSource',
      '        context,\n      );\n      requireActiveExecution(context);',
      '      );\n      requireActiveExecution(context);',
    ],
    [
      'balanceSyncOrchestratorSource',
      "if (failure?.code === 'PROVIDER_TIMEOUT' || failure?.code === 'PROVIDER_UNAVAILABLE') {",
      'if (false) {',
    ],
    [
      'mainnetBalanceIndexerRouterSource',
      'return this.indexerFor(validated.networkId).readCurrent(validated, context);',
      'return this.indexerFor(validated.networkId).readCurrent(validated, INERT_BALANCE_SYNC_EXECUTION_CONTEXT);',
    ],
    [
      'mainnetBalanceIndexerRouterSource',
      'Reflect.apply(rescanFromCheckpoint, receiver, [request, context]) as Promise<unknown>,',
      'Reflect.apply(rescanFromCheckpoint, receiver, [request]) as Promise<unknown>,',
    ],
    [
      'mainnetBalanceTwoSourceAgreementCoordinatorSource',
      'const [primaryResult, corroboratingResult] = await Promise.allSettled([',
      'const [primaryResult, corroboratingResult] = await Promise.all([',
    ],
    [
      'mainnetBalanceTwoSourceAgreementCoordinatorSource',
      'corroboratingBinding.readCurrent(request, context),',
      'corroboratingBinding.readCurrent(request, INERT_BALANCE_SYNC_EXECUTION_CONTEXT),',
    ],
    [
      'mainnetBalanceTwoSourceAgreementCoordinatorSource',
      'const primaryValue = primaryResult.value;',
      'const primaryValue = primaryResult.reason;',
    ],
    [
      'balanceJsonRpcSource',
      'exchange(request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown>;',
      'exchange(request: BalanceJsonRpcRequest): Promise<unknown>;',
    ],
    [
      'balanceJsonRpcSource',
      'response = await transport.exchange(request, execution.signal);',
      'response = await Promise.race([transport.exchange(request, execution.signal)]);',
    ],
    ['balanceJsonRpcSource', 'throwIfExecutionAborted(execution);', 'void execution;'],
    [
      'balanceJsonRpcSource',
      'throwIfExecutionAborted(requireExecutionContext(context));',
      'void context;',
    ],
    [
      'balanceJsonRpcSource',
      "case 'DEADLINE':\n      throw new BalanceSyncIndexerFailure('PROVIDER_TIMEOUT');",
      "case 'DEADLINE':\n      throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');",
    ],
    [
      'ethereumBalanceIndexerSource',
      "const chainId = await exchangeBalanceRpc(this.transport, 'eth_chainId', [], context);",
      "const chainId = await exchangeBalanceRpc(this.transport, 'eth_chainId', []);",
    ],
    [
      'solanaBalanceIndexerSource',
      "const genesisHash = await exchangeBalanceRpc(this.transport, 'getGenesisHash', [], context);",
      "const genesisHash = await exchangeBalanceRpc(this.transport, 'getGenesisHash', []);",
    ],
    [
      'ethereumBalanceIndexerSource',
      "reviewed?.abortKind === 'DEADLINE' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',",
      "reviewed?.abortKind === 'DEADLINE' ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE',",
    ],
    [
      'solanaBalanceIndexerSource',
      "reviewed?.abortKind === 'DEADLINE' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',",
      "reviewed?.abortKind === 'DEADLINE' ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE',",
    ],
    [
      'balanceSyncPortsSource',
      'resolveActiveAddress(\n    scope: BalanceSyncScope,\n    context: BalanceSyncExecutionContext,\n  ): Promise<unknown>;',
      'resolveActiveAddress(scope: BalanceSyncScope): Promise<unknown>;',
    ],
    [
      'balanceSyncPortsSource',
      'load(\n    scope: BalanceSyncScope,\n    context: BalanceSyncExecutionContext,\n  ): Promise<BalanceSyncCheckpoint | null>;',
      'load(scope: BalanceSyncScope): Promise<BalanceSyncCheckpoint | null>;',
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

  const postTransportAbortCheck = 'throwIfExecutionAborted(requireExecutionContext(context));';
  const helper = BALANCE_CONSUMER_ARTIFACTS.balanceJsonRpcSource;
  const postTransportAbortIndex = helper.lastIndexOf(postTransportAbortCheck);
  assert.ok(postTransportAbortIndex >= 0);
  assert.deepEqual(
    inspectBalanceConsumerDeploymentArtifacts({
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceJsonRpcSource: `${helper.slice(0, postTransportAbortIndex)}void context;${helper.slice(
        postTransportAbortIndex + postTransportAbortCheck.length,
      )}`,
    }),
    INVALID_BALANCE_CONSUMER_DEPLOYMENT,
  );

  const agreementAbortCheck = 'requireActiveAgreementExecution(context);';
  const coordinator = BALANCE_CONSUMER_ARTIFACTS.mainnetBalanceTwoSourceAgreementCoordinatorSource;
  const postAgreementAbortIndex = coordinator.lastIndexOf(agreementAbortCheck);
  assert.ok(postAgreementAbortIndex >= 0);
  assert.deepEqual(
    inspectBalanceConsumerDeploymentArtifacts({
      ...BALANCE_CONSUMER_ARTIFACTS,
      mainnetBalanceTwoSourceAgreementCoordinatorSource: `${coordinator.slice(
        0,
        postAgreementAbortIndex,
      )}void context;${coordinator.slice(postAgreementAbortIndex + agreementAbortCheck.length)}`,
    }),
    INVALID_BALANCE_CONSUMER_DEPLOYMENT,
  );

  assert.deepEqual(
    inspectBalanceConsumerDeploymentArtifacts({
      ...BALANCE_CONSUMER_ARTIFACTS,
      balanceJsonRpcSource: `${BALANCE_CONSUMER_ARTIFACTS.balanceJsonRpcSource}\nclass UnreviewedTransport implements BalanceJsonRpcTransport {}\n`,
    }),
    INVALID_BALANCE_CONSUMER_DEPLOYMENT,
  );
});

test('balance-consumer inspection pins cancellable PostgreSQL ownership and shutdown drain', () => {
  const mutations: readonly (readonly [keyof BalanceConsumerArtifactSources, string, string])[] = [
    [
      'postgresServiceSource',
      'const CANCELLABLE_QUERY_TIMEOUT_MS = 16_000;',
      'const CANCELLABLE_QUERY_TIMEOUT_MS = 60_000;',
    ],
    [
      'postgresServiceSource',
      'if (reviewAbortSignal(signal) === null) {',
      'if (signal === null) {',
    ],
    ['postgresServiceSource', 'if (!this.cancellableQueryAdmissionOpen) {', 'if (false) {'],
    ['postgresServiceSource', 'this.cancellableQueryOperations.add(gate);', 'void gate;'],
    [
      'postgresServiceSource',
      'this.cancellableQueryAdmissionOpen = false;',
      'this.cancellableQueryAdmissionOpen = true;',
    ],
    [
      'postgresServiceSource',
      'this.cancellableQueryClosePromise = closePromise;',
      'void closePromise;',
    ],
    [
      'postgresServiceSource',
      'Reflect.apply(ABORT_CONTROLLER_ABORT, this.cancellableQueryController, []);',
      "Reflect.apply(ABORT_CONTROLLER_ABORT, this.cancellableQueryController, ['shutdown']);",
    ],
    ['postgresServiceSource', 'client.release(fixedError);', 'client.release();'],
    ['postgresServiceSource', '.then(() => acquiredClient.end())', '.then(() => undefined)'],
    [
      'postgresServiceSource',
      'if (removed !== client || !listening) return;',
      'if (!listening) return;',
    ],
    [
      'postgresServiceSource',
      'const teardownFailure = (await Promise.allSettled([querySettlement, teardown])).find(',
      'const teardownFailure = (await Promise.all([querySettlement, teardown])).find(',
    ],
    ['postgresServiceSource', 'timeout.unref?.();', 'void timeout;'],
    ['postgresServiceSource', 'clearTimeout(timeout);', 'void timeout;'],
    [
      'balanceSyncCheckpointRepositorySource',
      'this.postgres.queryWithCancellation<CheckpointRow>(',
      'this.postgres.query<CheckpointRow>(',
    ],
    [
      'balanceSyncCheckpointRepositorySource',
      '      activeExecutionSignal(context);\n      if (result.rows.length === 0)',
      '      if (result.rows.length === 0)',
    ],
    [
      'balanceSyncWalletAddressResolverSource',
      'this.postgres.queryWithCancellation<ResolvedAddressRow>(',
      'this.postgres.query<ResolvedAddressRow>(',
    ],
    ['balanceConsumerPersistenceResourceSource', 'operationGates.add(gate);', 'void gate;'],
    [
      'balanceConsumerPersistenceResourceSource',
      'postgresDrain = resourcePostgres.closeCancellableQueries();',
      'postgresDrain = Promise.resolve();',
    ],
    [
      'balanceConsumerPersistenceResourceSource',
      'void Promise.allSettled([postgresDrain, drainOperations()])',
      'void Promise.all([postgresDrain, drainOperations()])',
    ],
    ['infrastructureConfigSource', 'connectionTimeoutMs: 5_000,', 'connectionTimeoutMs: 60_000,'],
    ['infrastructureConfigSource', 'lockTimeoutMs: 5_000,', 'lockTimeoutMs: 60_000,'],
    ['infrastructureConfigSource', 'statementTimeoutMs: 15_000,', 'statementTimeoutMs: 300_000,'],
    ['apiPackageSource', '"pg": "8.23.0"', '"pg": "^8.23.0"'],
    [
      'rootPackageLockSource',
      '"node_modules/pg": {\n      "version": "8.23.0",',
      '"node_modules/pg": {\n      "version": "8.22.0",',
    ],
    [
      'rootPackageLockSource',
      '"node_modules/pg-pool": {\n      "version": "3.14.0",',
      '"node_modules/pg-pool": {\n      "version": "3.13.0",',
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

  for (const injected of ['void Promise.race([]);', 'void signal.reason;']) {
    assert.deepEqual(
      inspectBalanceConsumerDeploymentArtifacts({
        ...BALANCE_CONSUMER_ARTIFACTS,
        postgresServiceSource: `${BALANCE_CONSUMER_ARTIFACTS.postgresServiceSource}\n${injected}\n`,
      }),
      INVALID_BALANCE_CONSUMER_DEPLOYMENT,
    );
  }
});

test('balance-consumer inspection brands and freezes only the exact dormant local contract', () => {
  assert.equal(Object.keys(BALANCE_CONSUMER_ARTIFACTS).length, 65);
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
      'load: (scope, context) => whileOpen(() => checkpointRepository.load(scope, context)),',
      'query: (text) => postgres.query(text),',
    ],
    [
      'persistence close memoization',
      'balanceConsumerPersistenceResourceSource',
      'if (closePromise !== undefined) return closePromise;',
      'void closePromise;',
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
      'PostgreSQL pool lock',
      'rootPackageLockSource',
      '"node_modules/pg-pool": {\n      "version": "3.14.0",',
      '"node_modules/pg-pool": {\n      "version": "3.13.0",',
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
      '  suspendGenericWorkerBalanceAuthorityMigrationV0028,\n  createProviderPositionChainAnchorEvidenceMigrationV0029,',
      '  createProviderPositionChainAnchorEvidenceMigrationV0029,',
    ],
    [
      'worker authority test migration registration',
      'migrationIndexSource',
      '  suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028,\n  createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029,',
      '  createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029,',
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
      'provider-position anchor evidence canonical Ethereum observation identity',
      'providerPositionChainAnchorEvidenceMigrationSource',
      "AND requested_source_observation_id = 'ethereum-block-'",
      'AND requested_source_observation_id = requested_source_id',
    ],
    [
      'provider-position anchor evidence bounded read deadline',
      'providerPositionChainAnchorEvidenceMigrationSource',
      "OR requested_deadline_at > requested_evaluated_at + interval '30 seconds'",
      "OR requested_deadline_at > requested_evaluated_at + interval '300 seconds'",
    ],
    [
      'provider-position anchor evidence post-lock approval freshness',
      'providerPositionChainAnchorEvidenceMigrationSource',
      'AND database_read_at < evidence.source_pair_approval_expires_at',
      'AND requested_evaluated_at < evidence.source_pair_approval_expires_at',
    ],
    [
      'provider-position anchor evidence API-only read grant',
      'providerPositionChainAnchorEvidenceMigrationSource',
      'GRANT EXECUTE ON FUNCTION ${READ_EVIDENCE} TO ${api};',
      'GRANT EXECUTE ON FUNCTION ${READ_EVIDENCE} TO ${balance};',
    ],
    [
      'provider-position anchor evidence owner-only writer',
      'providerPositionChainAnchorEvidenceMigrationSource',
      'GRANT EXECUTE ON FUNCTION ${READ_EVIDENCE} TO ${api};',
      'GRANT EXECUTE ON FUNCTION ${READ_EVIDENCE} TO ${api};\n    GRANT EXECUTE ON FUNCTION ${RECORD_EVIDENCE} TO ${api};',
    ],
    [
      'provider-position anchor evidence trigger column inventory',
      'providerPositionChainAnchorEvidenceMigrationSource',
      "AND trigger.tgattr = ''::pg_catalog.int2vector",
      'AND true',
    ],
    [
      'provider-position anchor evidence preserves 0028 verifier',
      'providerPositionChainAnchorEvidenceMigrationSource',
      "supersedesVerificationOf: ['0028'],",
      "supersedesVerificationOf: ['0027'],",
    ],
    [
      'provider-position anchor production migration registration',
      'migrationIndexSource',
      '  suspendGenericWorkerBalanceAuthorityMigrationV0028,\n  createProviderPositionChainAnchorEvidenceMigrationV0029,',
      '  suspendGenericWorkerBalanceAuthorityMigrationV0028,\n  createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029,',
    ],
    [
      'provider-position anchor test migration registration',
      'migrationIndexSource',
      '  suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028,\n  createProviderPositionChainAnchorEvidenceTestSchemaMigrationV0029,',
      '  suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028,\n  createProviderPositionChainAnchorEvidenceMigrationV0029,',
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
  const missingConsumerService = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingConsumerService.balanceSyncConsumerServiceSource;
  const missingBalanceSyncPorts = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingBalanceSyncPorts.balanceSyncPortsSource;
  const missingMainnetRouter = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingMainnetRouter.mainnetBalanceIndexerRouterSource;
  const missingMainnetAgreementCoordinator = {
    ...BALANCE_CONSUMER_ARTIFACTS,
  } as Record<string, unknown>;
  delete missingMainnetAgreementCoordinator.mainnetBalanceTwoSourceAgreementCoordinatorSource;
  const missingBalanceJsonRpc = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingBalanceJsonRpc.balanceJsonRpcSource;
  const missingNodeHttpsBalanceJsonRpcTransport = {
    ...BALANCE_CONSUMER_ARTIFACTS,
  } as Record<string, unknown>;
  delete missingNodeHttpsBalanceJsonRpcTransport.nodeHttpsBalanceJsonRpcTransportSource;
  const missingEthereumIndexer = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingEthereumIndexer.ethereumBalanceIndexerSource;
  const missingSolanaIndexer = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingSolanaIndexer.solanaBalanceIndexerSource;
  const missingSupportedAssetRegistry = {
    ...BALANCE_CONSUMER_ARTIFACTS,
  } as Record<string, unknown>;
  delete missingSupportedAssetRegistry.supportedAssetRegistrySource;
  const missingWalletIdentity = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingWalletIdentity.walletIdentitySource;
  const missingSolanaTokenAccount = { ...BALANCE_CONSUMER_ARTIFACTS } as Record<string, unknown>;
  delete missingSolanaTokenAccount.solanaTokenAccountSource;
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
  const oversizedPackageLock = {
    ...BALANCE_CONSUMER_ARTIFACTS,
    rootPackageLockSource: 'x'.repeat(768 * 1024 + 1),
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
    missingConsumerService,
    missingBalanceSyncPorts,
    missingMainnetRouter,
    missingMainnetAgreementCoordinator,
    missingBalanceJsonRpc,
    missingNodeHttpsBalanceJsonRpcTransport,
    missingEthereumIndexer,
    missingSolanaIndexer,
    missingSupportedAssetRegistry,
    missingWalletIdentity,
    missingSolanaTokenAccount,
    { ...BALANCE_CONSUMER_ARTIFACTS, unexpected: 'value' },
    { ...BALANCE_CONSUMER_ARTIFACTS, runtimeSource: 1 },
    accessor,
    withSymbol,
    oversized,
    oversizedPackageLock,
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
          id !== 'PROVIDER_POSITION_READ_BOUNDARY' &&
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
      'database bind parameter statement logging enabled',
      mutate(
        "    log_parameter_max_length: '0'",
        "    log_parameter_max_length: '64'",
        'statement bind logging',
      ),
    ],
    [
      'database bind parameter error logging enabled',
      mutate(
        "    log_parameter_max_length_on_error: '0'",
        "    log_parameter_max_length_on_error: '64'",
        'error bind logging',
      ),
    ],
    [
      'database parameter logging boundary extended',
      mutate(
        "    rds.force_ssl: '1'",
        "    rds.force_ssl: '1'\n    log_statement: all",
        'unreviewed database parameter',
      ),
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
