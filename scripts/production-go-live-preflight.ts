import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MAINNET_PLATFORM_DIRECTORY } from '../apps/api/src/mainnet-platforms/domain/mainnet-platform-directory';
// @ts-expect-error The audited local validator is an ESM JavaScript module without declarations.
import * as egressPolicy from '../infra/egress/validate-egress-policy.mjs';
// @ts-expect-error The audited local validator is an ESM JavaScript module without declarations.
import * as activeScopeProviderResearchCapture from '../infra/providers/validate-active-provider-research-captures.mjs';
// @ts-expect-error The audited local validator is an ESM JavaScript module without declarations.
import { loadValidatedProviderDecisionSnapshot } from '../infra/providers/validate-kan-62-provider-decision.mjs';
// @ts-expect-error The audited local validator is an ESM JavaScript module without declarations.
import { validateDormantProviderInventoryFiles } from '../infra/providers/validate-dormant-provider-inventory.mjs';
// @ts-expect-error The operations-owned audited manifest boundary is an ESM JavaScript module.
import * as releaseCandidateManifest from './release-candidate-manifest.mjs';
import {
  isVerifiedProductionEvidenceBundle,
  loadAndVerifyProductionEvidenceBundle,
  ProductionEvidenceBundleInvalidError,
  revalidateProductionEvidenceBundleForApplication,
} from './production-evidence-bundle';
import type {
  ProductionEvidenceApplicationOptions,
  VerifiedProductionEvidenceBundle,
} from './production-evidence-bundle';
import {
  isVerifiedPublicLaunchAuthorityDecisionSet,
  loadAndVerifyPublicLaunchAuthorityDecision,
  PublicLaunchAuthorityDecisionInvalidError,
  revalidatePublicLaunchAuthorityDecisionForApplication,
} from './public-launch-authority-decision';
import type {
  PublicLaunchTargetBinding,
  VerifiedPublicLaunchAuthorityDecisionSet,
} from './public-launch-authority-decision';

export const PRODUCTION_PREFLIGHT_SCHEMA_VERSION = 1 as const;
export const PRODUCTION_PROVIDER_TARGET = 10 as const;
const REVIEWED_DATABASE_MASTER_TEMPLATE_SHA256 =
  '7fa270567d03d78a833e40cc0524c968c61f00fd43df877e5e0dfdd9ea1a07be';
const REVIEWED_ACTIVE_SCOPE_PROVIDER_RESEARCH_CAPTURE_SHA256 =
  'db13db3ff78d6dd0641f8f61067e48d8eb45d0eab309491e2bff9a60112a97d2';

export type ProductionPreflightTarget = 'read-only' | 'mainnet-write';
export type ProductionPreflightReadiness = 'BLOCKED' | 'LOCAL_GATES_CLEAR';
export type ProductionPreflightCheckId =
  | 'PRODUCTION_INFRASTRUCTURE'
  | 'BALANCE_CONSUMER'
  | 'PROVIDER_POSITION_READ_BOUNDARY'
  | 'AUTHENTICATION'
  | 'EXTERNAL_EGRESS'
  | 'RPC_INDEXING'
  | 'PLATFORM_DIRECTORY'
  | 'PLATFORM_LIVE_READS'
  | 'READ_ONLY_ISOLATION'
  | 'PUBLIC_LAUNCH_AUTHORITIES'
  | 'MAINNET_WRITES';

export type ProductionPreflightBlockerId =
  | 'PRODUCTION_INFRASTRUCTURE_INSPECTION_FAILED'
  | 'PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_PATH_NOT_ENABLED'
  | 'BALANCE_CONSUMER_INSPECTION_FAILED'
  | 'BALANCE_CONSUMER_SOURCE_ACTIVATION_DISABLED'
  | 'BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED'
  | 'BALANCE_CONSUMER_TASK_NOT_PROVISIONED'
  | 'BALANCE_CONSUMER_IAM_NOT_PROVISIONED'
  | 'BALANCE_CONSUMER_DATABASE_CAPABILITY_NOT_ENABLED'
  | 'BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING'
  | 'PROVIDER_POSITION_READ_BOUNDARY_INSPECTION_FAILED'
  | 'PROVIDER_POSITION_READER_FEATURE_REGISTRATION_MISSING'
  | 'PROVIDER_POSITION_TRUSTED_ASSESSMENT_FEATURE_REGISTRATION_MISSING'
  | 'PROVIDER_POSITION_DEADLINE_RUNNER_FEATURE_REGISTRATION_MISSING'
  | 'AUTH_DEPLOYED_EVIDENCE_MISSING'
  | 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'
  | 'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED'
  | 'AUTH_TEMPLATE_INSPECTION_FAILED'
  | 'AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED'
  | 'DATABASE_MASTER_SECRET_NOT_RDS_MANAGED'
  | 'RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING'
  | 'REDIS_OPERATOR_SECRET_VERSION_NOT_WIRED'
  | 'WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED'
  | 'EGRESS_LIVE_EVIDENCE_INCOMPLETE'
  | 'EGRESS_POLICY_LOCAL_VALIDATION_FAILED'
  | 'EGRESS_POLICY_NOT_ACCEPTED'
  | 'EXTERNAL_EGRESS_DISABLED'
  | 'RPC_PROVIDER_DECISION_LOCAL_VALIDATION_FAILED'
  | 'RPC_PROVIDER_DORMANT_INVENTORY_LOCAL_VALIDATION_FAILED'
  | 'RPC_PROVIDER_ACTIVE_SCOPE_RESEARCH_CAPTURE_LOCAL_VALIDATION_FAILED'
  | 'RPC_PROVIDER_EXTERNAL_APPROVAL_PENDING'
  | 'RPC_PROVIDER_LIVE_EVIDENCE_INCOMPLETE'
  | 'RPC_PROVIDER_RUNTIME_NOT_APPROVED'
  | 'PLATFORM_DIRECTORY_LOCAL_VALIDATION_FAILED'
  | 'PLATFORM_DIRECTORY_PROVIDER_TARGET_NOT_MET'
  | 'PLATFORM_LIVE_CAPABILITY_NOT_EXPOSED'
  | 'LIVE_PROVIDER_TARGET_NOT_MET'
  | 'LIVE_READ_ADAPTER_BINDING_EVIDENCE_MISSING'
  | 'LIVE_READ_COMPOSITION_EVIDENCE_MISSING'
  | 'LIVE_READ_EVIDENCE_DIRECTORY_BINDING_MISMATCH'
  | 'LIVE_READ_EVIDENCE_INDEX_INVALID'
  | 'LIVE_READ_EVIDENCE_INDEX_MISSING'
  | 'LIVE_READ_EVIDENCE_REVISION_MISMATCH'
  | 'READ_ONLY_ISOLATION_LOCAL_VALIDATION_FAILED'
  | 'READ_ONLY_TRANSACTION_CAPABILITY_EXPOSED'
  | 'PUBLIC_LAUNCH_AUTHORITY_DECISION_MISSING'
  | 'PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED'
  | 'MAINNET_FINANCIAL_ACTIONS_DISABLED'
  | 'MAINNET_TRANSACTION_CAPABILITY_NOT_EXPOSED'
  | 'MAINNET_TRANSACTION_PROVIDER_TARGET_NOT_MET'
  | 'MAINNET_WRITE_PROVIDER_SET_NOT_COVERED_BY_LIVE_READ_EVIDENCE'
  | 'MAINNET_WRITE_ACTION_BINDING_EVIDENCE_MISSING'
  | 'MAINNET_WRITE_EVIDENCE_DIRECTORY_BINDING_MISMATCH'
  | 'MAINNET_WRITE_EVIDENCE_INDEX_INVALID'
  | 'MAINNET_WRITE_EVIDENCE_INDEX_MISSING'
  | 'MAINNET_WRITE_EVIDENCE_REVISION_MISMATCH';

export interface ProductionPreflightCheck {
  readonly id: ProductionPreflightCheckId;
  readonly localValidation: 'PASS' | 'FAIL';
  readonly launchReadiness: ProductionPreflightReadiness;
  readonly blockerIds: readonly ProductionPreflightBlockerId[];
}

interface AuthenticationDeploymentInput {
  readonly inspected: boolean;
  readonly syntaxValid: boolean;
  readonly apiEnvironmentNames: ReadonlySet<string>;
  readonly apiSecretNames: ReadonlySet<string>;
  readonly webEnvironmentNames: ReadonlySet<string>;
  readonly deployedEvidenceAccepted: boolean;
}

export interface RedisOperatorDeploymentInput {
  readonly inspected: boolean;
  readonly syntaxValid: boolean;
}

export interface DatabaseMasterDeploymentInput {
  readonly inspected: boolean;
  readonly syntaxValid: boolean;
}

const VERIFIED_DATABASE_MASTER_DEPLOYMENTS = new WeakSet<DatabaseMasterDeploymentInput>();

export interface ProductionInfrastructureArtifactSources {
  readonly applicationTemplateSource: string;
  readonly workloadTemplateSource: string;
  readonly observabilityTemplateSource: string;
  readonly migrationTemplateSource: string;
  readonly accountGuardrailsTemplateSource: string;
  readonly applicationInvokerSource: string;
  readonly accountGuardrailsInvokerSource: string;
  readonly applicationValidatorSource: string;
  readonly fixedSlotTransitionValidatorSource: string;
  readonly billingControlValidatorSource: string;
  readonly egressPolicyValidatorSource: string;
  readonly authWalletTransitionValidatorSource: string;
  readonly redisOperatorTransitionValidatorSource: string;
}

export interface ProductionInfrastructureDeploymentInput {
  readonly inspected: boolean;
  readonly syntaxValid: boolean;
  readonly environmentContract: 'INVALID' | 'NON_PRODUCTION_ONLY' | 'PRODUCTION_ENABLED';
}

const VERIFIED_PRODUCTION_INFRASTRUCTURE_DEPLOYMENTS =
  new WeakSet<ProductionInfrastructureDeploymentInput>();

export interface BalanceConsumerArtifactSources {
  readonly activationSource: string;
  readonly cliSource: string;
  readonly cliModeSource: string;
  readonly runtimeSource: string;
  readonly compositionSource: string;
  readonly balanceSyncConsumerServiceSource: string;
  readonly balanceSyncPortsSource: string;
  readonly balanceConsumerResourceSource: string;
  readonly balanceConsumerLifecycleSource: string;
  readonly mainnetBalanceIndexerRouterSource: string;
  readonly mainnetBalanceTwoSourceAgreementCoordinatorSource: string;
  readonly balanceJsonRpcSource: string;
  readonly nodeHttpsBalanceJsonRpcTransportSource: string;
  readonly ethereumBalanceIndexerSource: string;
  readonly solanaBalanceIndexerSource: string;
  readonly supportedAssetRegistrySource: string;
  readonly walletIdentitySource: string;
  readonly solanaTokenAccountSource: string;
  readonly balanceConsumerPersistenceResourceSource: string;
  readonly balanceConsumerSqsReceiptResourceSource: string;
  readonly runtimePostgresPoolSource: string;
  readonly postgresServiceSource: string;
  readonly balanceSyncCheckpointRepositorySource: string;
  readonly balanceSyncWalletAddressResolverSource: string;
  readonly balanceConsumerConfigSource: string;
  readonly blockchainSyncIndexSource: string;
  readonly jobEnvelopeSource: string;
  readonly blockchainSyncModuleSource: string;
  readonly appModuleSource: string;
  readonly applicationRootSource: string;
  readonly localDevelopmentAppModuleSource: string;
  readonly mainSource: string;
  readonly outboxWorkerCliSource: string;
  readonly redisSessionRevocationCliSource: string;
  readonly migrationCliSource: string;
  readonly balanceSyncOrchestratorSource: string;
  readonly balanceSyncDomainSource: string;
  readonly chainObservationPolicySource: string;
  readonly failClosedJobDispositionSource: string;
  readonly reviewedJobDispatcherSource: string;
  readonly infrastructureConfigSource: string;
  readonly pinnedQueueReceiptSource: string;
  readonly sqsJobWorkerSource: string;
  readonly observabilitySource: string;
  readonly sqsServiceSource: string;
  readonly sqsModuleSource: string;
  readonly sqsTokensSource: string;
  readonly apiPackageSource: string;
  readonly rootPackageSource: string;
  readonly rootPackageLockSource: string;
  readonly applicationTemplateSource: string;
  readonly applicationValidatorSource: string;
  readonly workloadTemplateSource: string;
  readonly workloadValidatorSource: string;
  readonly balanceConsumerEnvelopeSource: string;
  readonly balanceConsumerEnvelopeValidatorSource: string;
  readonly balanceConsumerMetadataTransitionValidatorSource: string;
  readonly bootstrapPrincipalsSource: string;
  readonly bootstrapPrincipalsValidatorSource: string;
  readonly walletAddressMigrationSource: string;
  readonly workerAuthoritySuspensionMigrationSource: string;
  readonly migrationIndexSource: string;
  readonly releaseManifestSource: string;
  readonly productionContainerValidatorSource: string;
}

export interface BalanceConsumerDeploymentInput {
  readonly inspected: boolean;
  readonly contractValid: boolean;
  readonly sourceActivation: 'INVALID' | 'DISABLED';
  readonly runtimeComposition: 'INVALID' | 'NOT_COMPOSED';
  readonly taskDeployment: 'INVALID' | 'NOT_PROVISIONED';
  readonly iamCapability: 'INVALID' | 'NOT_PROVISIONED';
  readonly databaseCapability: 'INVALID' | 'DORMANT_SOURCE_ONLY';
  readonly deploymentEvidence: 'INVALID' | 'MISSING';
}

const VERIFIED_BALANCE_CONSUMER_DEPLOYMENTS = new WeakSet<BalanceConsumerDeploymentInput>();

export interface ProviderPositionReadBoundaryArtifactSources {
  readonly providerPositionReaderPortSource: string;
  readonly providerPositionTrustedAssemblyPortSource: string;
  readonly providerPositionAdmissionCoordinatorSource: string;
  readonly providerPositionDeadlineRunnerSource: string;
  readonly providerPositionRuntimeBoundsSource: string;
  readonly providerPositionRuntimeCompositionSource: string;
  readonly providerPositionInfrastructureConfigSource: string;
  readonly providerPositionRuntimePostgresPoolSource: string;
  readonly portfolioWalletRegistrationReaderPortSource: string;
  readonly registeredPortfolioWalletReaderSource: string;
  readonly walletRegistrationServiceSource: string;
  readonly walletRegistrationRepositoryPortSource: string;
  readonly postgresWalletRegistrationRepositorySource: string;
  readonly providerPositionPostgresServiceSource: string;
  readonly providerPositionCoverageSource: string;
  readonly providerPositionObservationSource: string;
  readonly providerPositionChainAssessmentSource: string;
  readonly providerPositionObservationPolicySource: string;
  readonly mainnetPlatformsModuleSource: string;
  readonly mainnetPlatformsIndexSource: string;
  readonly mainnetPlatformsControllerSource: string;
}

export interface ProviderPositionReadBoundaryInput {
  readonly inspected: boolean;
  readonly contractValid: boolean;
  readonly readerFeatureRegistration: 'INVALID' | 'MISSING';
  readonly trustedAssessmentFeatureRegistration: 'INVALID' | 'MISSING';
  readonly deadlineRunnerFeatureRegistration: 'INVALID' | 'MISSING';
}

const VERIFIED_PROVIDER_POSITION_READ_BOUNDARIES = new WeakSet<ProviderPositionReadBoundaryInput>();

interface EgressInput {
  readonly localValidationPassed: boolean;
  readonly status: unknown;
  readonly currentMode: unknown;
  readonly liveEvidenceComplete: boolean;
}

interface RpcProviderInput {
  readonly localValidationPassed: boolean;
  readonly dormantInventoryValidationPassed: boolean;
  readonly activeScopeResearchCaptureValidationPassed: boolean;
  readonly externalStatus: unknown;
  readonly runtimeStatus: unknown;
  readonly approvalBoundaryApproved: boolean;
  readonly liveEvidenceAccepted: boolean;
}

interface PlatformInput {
  readonly directory: unknown;
  readonly sourceRevision: string | null;
  liveReadEvidenceIndex: unknown | null;
  mainnetWriteEvidenceIndex: unknown | null;
}

interface PublicLaunchAuthoritiesInput {
  readonly decisionSet: VerifiedPublicLaunchAuthorityDecisionSet | null;
  readonly evidenceBinding: PublicLaunchTargetBinding | null;
}

export interface ProductionPreflightInput {
  readonly authentication: AuthenticationDeploymentInput;
  /** Optional for legacy callers; absence or an unbranded value fails closed. */
  readonly productionInfrastructureDeployment?: ProductionInfrastructureDeploymentInput;
  /** Optional for legacy callers; only the private local-artifact inspector can brand it. */
  readonly balanceConsumerDeployment?: BalanceConsumerDeploymentInput;
  /** Optional for legacy callers; only the private local-artifact inspector can brand it. */
  readonly providerPositionReadBoundary?: ProviderPositionReadBoundaryInput;
  /** Optional for legacy programmatic callers; absence fails closed during evaluation. */
  readonly databaseMasterDeployment?: DatabaseMasterDeploymentInput;
  /** Optional for legacy programmatic callers; only a verified evidence bundle sets it in CLI use. */
  readonly rdsMasterLifecycleEvidenceAccepted?: boolean;
  /** Optional for legacy programmatic callers; absence fails closed during evaluation. */
  readonly redisOperatorDeployment?: RedisOperatorDeploymentInput;
  readonly egress: EgressInput;
  readonly rpcProviders: RpcProviderInput;
  readonly platforms: PlatformInput;
  /** Optional only for backwards-compatible callers; absence remains a hard missing blocker. */
  readonly publicLaunchAuthorities?: PublicLaunchAuthoritiesInput;
}

export interface ProductionPreflightReport {
  readonly schemaVersion: typeof PRODUCTION_PREFLIGHT_SCHEMA_VERSION;
  readonly auditMode: 'BOOTSTRAP_BLOCKER_AUDIT';
  readonly scope: 'LOCAL_STATIC_ONLY';
  readonly selectedTarget: ProductionPreflightTarget;
  readonly selectedTargetReadiness: ProductionPreflightReadiness;
  readonly readiness: Readonly<{
    publicReadOnly: ProductionPreflightReadiness;
    mainnetWrites: ProductionPreflightReadiness;
  }>;
  readonly providerCounts: Readonly<{
    minimumTarget: typeof PRODUCTION_PROVIDER_TARGET;
    directory: number;
    planned: number;
    liveReadEvidenceBound: number;
    transactionEvidenceBound: number;
  }>;
  readonly checks: readonly ProductionPreflightCheck[];
  readonly safety: Readonly<{
    networkCallsMade: 0;
    dnsQueriesMade: 0;
    cloudCallsMade: 0;
    providerCallsMade: 0;
    secretValuesRead: 0;
    applicationConfigurationEnvironmentValuesRead: 0;
    /** Names whose existing values may be copied into the scrubbed Git child-process environment. */
    operatingSystemEnvironmentVariableNamesMayBeReadForGit: readonly string[];
    writesMade: 0;
  }>;
  readonly assurance: 'LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL';
}

interface ValidatedPlatformEntry {
  readonly id: string;
  readonly integrationStatus: 'PLANNED' | 'LIVE_READ_ONLY' | 'TRANSACTION_ENABLED';
  readonly supportedActions: readonly ('SUPPLY' | 'WITHDRAW')[];
}

interface PlatformDirectoryValidation {
  readonly valid: boolean;
  readonly providerTargetMet: boolean;
  readonly mayAuthorizeFinancialAction: boolean;
  readonly entries: readonly ValidatedPlatformEntry[];
  readonly configurationSha256: string | null;
}

interface EvidenceIndexValidation {
  readonly valid: boolean;
  readonly providerIds: readonly string[];
  readonly adapterBindingsComplete: boolean;
  readonly compositionEvidencePassed: boolean;
  readonly actionBindingsComplete: boolean;
  readonly revisionMatches: boolean;
  readonly directoryBindingMatches: boolean;
}

const REQUIRED_API_AUTH_ENVIRONMENT_BINDINGS = Object.freeze([
  ['AUTH_MODE', 'oidc'],
  ['OIDC_PROVIDER_KEY', 'cognito'],
  [
    'OIDC_ISSUER_URL',
    "!Sub 'https://cognito-idp.${AWS::Region}.${AWS::URLSuffix}/${CognitoPoolId}'",
  ],
  ['OIDC_AUTHORIZATION_ENDPOINT', "!Sub 'https://${CognitoLoginHostname}/oauth2/authorize'"],
  ['OIDC_TOKEN_ENDPOINT', "!Sub 'https://${CognitoLoginHostname}/oauth2/token'"],
  [
    'OIDC_JWKS_URI',
    "!Sub 'https://cognito-idp.${AWS::Region}.${AWS::URLSuffix}/${CognitoPoolId}/.well-known/jwks.json'",
  ],
  ['OIDC_CLIENT_ID', '!Ref CognitoClientId'],
  ['OIDC_AUDIENCE', '!Ref CognitoClientId'],
  ['OIDC_REQUIRED_TOKEN_USE', 'id'],
  ['OIDC_END_SESSION_ENDPOINT', "!Sub 'https://${CognitoLoginHostname}/logout'"],
  ['OIDC_POST_LOGOUT_REDIRECT_URI', "!Sub 'https://${ApplicationHostname}/login'"],
  ['OIDC_SIGNING_ALGORITHM', 'RS256'],
  ['OIDC_TOKEN_AUTH_METHOD', 'none'],
  ['AUTH_PUBLIC_ORIGIN', "!Sub 'https://${ApplicationHostname}'"],
  ['OIDC_REDIRECT_URI', "!Sub 'https://${ApplicationHostname}/api/v1/auth/callback'"],
  ['OIDC_HTTP_TIMEOUT_MS', "'5000'"],
  ['OIDC_TOKEN_RESPONSE_MAX_BYTES', "'16384'"],
  ['OIDC_JWKS_RESPONSE_MAX_BYTES', "'65536'"],
  ['OIDC_JWKS_CACHE_TTL_SECONDS', "'300'"],
  ['OIDC_CLOCK_TOLERANCE_SECONDS', "'30'"],
  ['OIDC_MAX_ID_TOKEN_AGE_SECONDS', "'600'"],
  ['AUTH_PREAUTH_TTL_SECONDS', "'600'"],
  ['AUTH_SESSION_IDLE_TTL_SECONDS', "'3600'"],
  ['AUTH_SESSION_ABSOLUTE_TTL_SECONDS', "'86400'"],
  ['AUTH_PREAUTH_SEAL_KEY_ID', 'preauth-v1'],
  ['AUTH_CLIENT_ADDRESS_MODE', 'trusted-single-proxy'],
  ['AUTH_TRUSTED_PROXY_CIDRS', "!Sub '${PublicSubnetACidr},${PublicSubnetBCidr}'"],
] as const);

const REQUIRED_API_PRODUCTION_ENVIRONMENT_BINDINGS = Object.freeze([
  ['NODE_ENV', 'production'],
] as const);

const REQUIRED_API_AUTH_SECRET_BINDINGS = Object.freeze([
  [
    'AUTH_PREAUTH_SEAL_KEY',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_PREAUTH_SEAL_KEY::${AuthWalletKeysSecretVersionId}'",
  ],
  [
    'AUTH_IDENTITY_HMAC_KEY_RING_JSON',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_IDENTITY_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
  ],
  [
    'AUTH_SESSION_HMAC_KEY_RING_JSON',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_SESSION_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
  ],
  [
    'AUTH_CSRF_HMAC_KEY_RING_JSON',
    "!Sub '${AuthWalletKeysSecretArn}:AUTH_CSRF_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
  ],
] as const);

const REQUIRED_WALLET_ENVIRONMENT_BINDINGS = Object.freeze([
  ['WALLET_REGISTRATION_MODE', 'enabled'],
  ['WALLET_REGISTRATION_REGISTRY_ENVIRONMENT', 'MAINNET'],
  ['WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS', "'180'"],
] as const);

const REQUIRED_WALLET_SECRET_BINDINGS = Object.freeze([
  [
    'WALLET_IDENTITY_HMAC_KEY_RING_JSON',
    "!Sub '${AuthWalletKeysSecretArn}:WALLET_IDENTITY_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
  ],
  [
    'WALLET_CHALLENGE_HMAC_KEY_RING_JSON',
    "!Sub '${AuthWalletKeysSecretArn}:WALLET_CHALLENGE_HMAC_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
  ],
  [
    'WALLET_METADATA_SEAL_KEY_RING_JSON',
    "!Sub '${AuthWalletKeysSecretArn}:WALLET_METADATA_SEAL_KEY_RING_JSON::${AuthWalletKeysSecretVersionId}'",
  ],
] as const);

const WALLET_BINDING_NAME = /^WALLET_[A-Z0-9_]+$/u;
const API_AUTH_RUNTIME_BINDING_NAME = /^(?:(?:AUTH|OIDC)_[A-Z0-9_]+|NODE_ENV|LOCAL_DEMO_MODE)$/u;
const PRODUCTION_AUTH_WALLET_BINDING_NAME =
  /^(?:(?:AUTH|OIDC|WALLET)_[A-Z0-9_]+|NODE_ENV|LOCAL_DEMO_MODE)$/u;
const FORBIDDEN_LEGACY_AUTH_WALLET_BINDINGS = new Set([
  'AUTH_IDENTITY_HMAC_KEY_ID',
  'AUTH_IDENTITY_HMAC_KEY',
  'AUTH_SESSION_HMAC_KEY_ID',
  'AUTH_SESSION_HMAC_KEY',
  'AUTH_CSRF_HMAC_KEY_ID',
  'AUTH_CSRF_HMAC_KEY',
  'WALLET_IDENTITY_HMAC_KEY_VERSION',
  'WALLET_IDENTITY_HMAC_KEY',
  'WALLET_CHALLENGE_HMAC_KEY_VERSION',
  'WALLET_CHALLENGE_HMAC_KEY',
  'WALLET_METADATA_SEAL_KEY_VERSION',
  'WALLET_METADATA_SEAL_KEY',
  'LOCAL_DEMO_MODE',
]);

const REQUIRED_WEB_AUTH_ENVIRONMENT_BINDINGS = Object.freeze([
  ['AUTH_PUBLIC_ORIGIN', "!Sub 'https://${ApplicationHostname}'"],
] as const);
const REQUIRED_WEB_PRODUCTION_ENVIRONMENT_BINDINGS = Object.freeze([
  ['NODE_ENV', 'production'],
] as const);

function bindingNames(bindings: readonly (readonly [string, string])[]): readonly string[] {
  return Object.freeze(bindings.map(([name]) => name));
}

const REQUIRED_API_AUTH_ENVIRONMENT_NAMES = bindingNames(REQUIRED_API_AUTH_ENVIRONMENT_BINDINGS);
const REQUIRED_API_PRODUCTION_ENVIRONMENT_NAMES = bindingNames(
  REQUIRED_API_PRODUCTION_ENVIRONMENT_BINDINGS,
);
const REQUIRED_API_AUTH_SECRET_NAMES = bindingNames(REQUIRED_API_AUTH_SECRET_BINDINGS);
const REQUIRED_WALLET_ENVIRONMENT_NAMES = bindingNames(REQUIRED_WALLET_ENVIRONMENT_BINDINGS);
const REQUIRED_WALLET_SECRET_NAMES = bindingNames(REQUIRED_WALLET_SECRET_BINDINGS);
const REQUIRED_WEB_AUTH_ENVIRONMENT_NAMES = bindingNames(REQUIRED_WEB_AUTH_ENVIRONMENT_BINDINGS);
const REQUIRED_WEB_PRODUCTION_ENVIRONMENT_NAMES = bindingNames(
  REQUIRED_WEB_PRODUCTION_ENVIRONMENT_BINDINGS,
);

const DIRECTORY_KEYS = Object.freeze([
  'schemaVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'minimumProviderTarget',
  'providers',
]);
const PROVIDER_KEYS = Object.freeze([
  'id',
  'name',
  'protocol',
  'ecosystem',
  'networks',
  'integrationStatus',
  'dataStatus',
  'accessStatus',
  'riskStatus',
  'supportedActions',
]);
const NETWORK_KEYS = Object.freeze(['id', 'name']);
const NETWORKS = new Map([
  ['eip155:1', 'EVM'],
  ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'SOLANA'],
]);
const READ_EVIDENCE_KEYS = Object.freeze([
  'schemaVersion',
  'artifactType',
  'status',
  'sourceRevision',
  'directoryConfigurationSha256',
  'providerIds',
  'adapterBindings',
  'compositionEvidence',
]);
const WRITE_EVIDENCE_KEYS = Object.freeze([
  'schemaVersion',
  'artifactType',
  'status',
  'sourceRevision',
  'directoryConfigurationSha256',
  'providerIds',
  'actionBindings',
  'simulationEvidence',
  'reconciliationEvidence',
  'independentSecurityReview',
]);
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PRODUCTION_INFRASTRUCTURE_ARTIFACT_KEYS = Object.freeze([
  'applicationTemplateSource',
  'workloadTemplateSource',
  'observabilityTemplateSource',
  'migrationTemplateSource',
  'accountGuardrailsTemplateSource',
  'applicationInvokerSource',
  'accountGuardrailsInvokerSource',
  'applicationValidatorSource',
  'fixedSlotTransitionValidatorSource',
  'billingControlValidatorSource',
  'egressPolicyValidatorSource',
  'authWalletTransitionValidatorSource',
  'redisOperatorTransitionValidatorSource',
] as const satisfies readonly (keyof ProductionInfrastructureArtifactSources)[]);
const MAX_PRODUCTION_INFRASTRUCTURE_ARTIFACT_BYTES = 512 * 1024;
const MAX_PRODUCTION_INFRASTRUCTURE_TOTAL_BYTES = 2 * 1024 * 1024;
const PROVIDER_POSITION_READ_ARTIFACT_KEYS = Object.freeze([
  'providerPositionReaderPortSource',
  'providerPositionTrustedAssemblyPortSource',
  'providerPositionAdmissionCoordinatorSource',
  'providerPositionDeadlineRunnerSource',
  'providerPositionRuntimeBoundsSource',
  'providerPositionRuntimeCompositionSource',
  'providerPositionInfrastructureConfigSource',
  'providerPositionRuntimePostgresPoolSource',
  'portfolioWalletRegistrationReaderPortSource',
  'registeredPortfolioWalletReaderSource',
  'walletRegistrationServiceSource',
  'walletRegistrationRepositoryPortSource',
  'postgresWalletRegistrationRepositorySource',
  'providerPositionPostgresServiceSource',
  'providerPositionCoverageSource',
  'providerPositionObservationSource',
  'providerPositionChainAssessmentSource',
  'providerPositionObservationPolicySource',
  'mainnetPlatformsModuleSource',
  'mainnetPlatformsIndexSource',
  'mainnetPlatformsControllerSource',
] as const satisfies readonly (keyof ProviderPositionReadBoundaryArtifactSources)[]);
const REVIEWED_PROVIDER_POSITION_READ_ARTIFACT_SHA256 = Object.freeze({
  providerPositionReaderPortSource:
    '9b71cc320e063b83e98526e598316b74c3a943e8c16f21da0f5635c6fceb468d',
  providerPositionTrustedAssemblyPortSource:
    '9120c664640be1f855b1ea77cc9ca403506cae306b3f14679172f634c4e8a37b',
  providerPositionAdmissionCoordinatorSource:
    '313b424bdc91621858642faac8592b716fb4a9dafb30966cc8c3f624cf9c5916',
  providerPositionDeadlineRunnerSource:
    '6910ff27ce6b29d06d7f3fc20743779196259bda5518b1b4ada7f82b9c2c3f97',
  providerPositionRuntimeBoundsSource:
    '342895e5e4bafca127c67db519e8ca252b0b75377a1e9311e00639e74a32d812',
  providerPositionRuntimeCompositionSource:
    '9dfb3d0b03955918cafdc769df8f20fe75a6b0836b2419c3b14a52c66a419bf8',
  providerPositionInfrastructureConfigSource:
    'fb1f6639a330d6a07db1d82434559356a4707a6550848d75397a1ff5e6a3fd10',
  providerPositionRuntimePostgresPoolSource:
    'd15b4a0604cda0bcc9d8df7f597863e42c4ef573ba8ed4362386cd2beaa1f823',
  portfolioWalletRegistrationReaderPortSource:
    '51261b1f960a7a3918dbeb72a789cf0ff75d299727f93c844e525477bf51806c',
  registeredPortfolioWalletReaderSource:
    'da78b8e539a83e94c13ad2ce718559bceb0efbacdb5cb3931d284591f5c06af2',
  walletRegistrationServiceSource:
    '1961a2bf8b3bbfd56d849f831753bc5944a4f2f32f636acc4aed28fe28899c3f',
  walletRegistrationRepositoryPortSource:
    'e137f3df48f13c95ef8f01c3290c1a11247cc69c022b04f8ceb368a91d978d8a',
  postgresWalletRegistrationRepositorySource:
    '00b46e4ab87be7e65559ca7ddc925d3226a1302ca742a5ddfb797034fd795707',
  providerPositionPostgresServiceSource:
    '2e7e6fba4651e80f865a52ba5484f1c0ceb5c35268ad53a95eba89b216e85d94',
  providerPositionCoverageSource:
    'a26d468abb2c46bd28267c6d36d1a7d3e62c30a700159e3c4cf263d15a8a9611',
  providerPositionObservationSource:
    '1e110974ee2c3dc17ae5aad00c419899291ad369106efe9aac171a160b2a483a',
  providerPositionChainAssessmentSource:
    '860582975318e5f10cbdd3082eaf3121df01aeb68279b2b56abeb9d945c27045',
  providerPositionObservationPolicySource:
    '10896fb907d937aa88ee0da570331faccce77f46642732e6676385676c6a7ea3',
  mainnetPlatformsModuleSource: '52a2817a03db43b6842fa42e0c8264f760250f8364511607d0329677f535e045',
  mainnetPlatformsIndexSource: 'b14bf3218ee63ce480b2ecd755f29e115c699ba00465802e2e4cc90210ef7a44',
  mainnetPlatformsControllerSource:
    'a713200b67f0cf67c50b56c94f707f94f7383c52e3d59f4368868710b099b55d',
} satisfies Readonly<Record<keyof ProviderPositionReadBoundaryArtifactSources, string>>);
const MAX_PROVIDER_POSITION_READ_ARTIFACT_BYTES = 128 * 1024;
const MAX_PROVIDER_POSITION_READ_TOTAL_BYTES = 384 * 1024;
const BALANCE_CONSUMER_ARTIFACT_KEYS = Object.freeze([
  'activationSource',
  'cliSource',
  'cliModeSource',
  'runtimeSource',
  'compositionSource',
  'balanceSyncConsumerServiceSource',
  'balanceSyncPortsSource',
  'balanceConsumerResourceSource',
  'balanceConsumerLifecycleSource',
  'mainnetBalanceIndexerRouterSource',
  'mainnetBalanceTwoSourceAgreementCoordinatorSource',
  'balanceJsonRpcSource',
  'nodeHttpsBalanceJsonRpcTransportSource',
  'ethereumBalanceIndexerSource',
  'solanaBalanceIndexerSource',
  'supportedAssetRegistrySource',
  'walletIdentitySource',
  'solanaTokenAccountSource',
  'balanceConsumerPersistenceResourceSource',
  'balanceConsumerSqsReceiptResourceSource',
  'runtimePostgresPoolSource',
  'postgresServiceSource',
  'balanceSyncCheckpointRepositorySource',
  'balanceSyncWalletAddressResolverSource',
  'balanceConsumerConfigSource',
  'blockchainSyncIndexSource',
  'jobEnvelopeSource',
  'blockchainSyncModuleSource',
  'appModuleSource',
  'applicationRootSource',
  'localDevelopmentAppModuleSource',
  'mainSource',
  'outboxWorkerCliSource',
  'redisSessionRevocationCliSource',
  'migrationCliSource',
  'balanceSyncOrchestratorSource',
  'balanceSyncDomainSource',
  'chainObservationPolicySource',
  'failClosedJobDispositionSource',
  'reviewedJobDispatcherSource',
  'infrastructureConfigSource',
  'pinnedQueueReceiptSource',
  'sqsJobWorkerSource',
  'observabilitySource',
  'sqsServiceSource',
  'sqsModuleSource',
  'sqsTokensSource',
  'apiPackageSource',
  'rootPackageSource',
  'rootPackageLockSource',
  'applicationTemplateSource',
  'applicationValidatorSource',
  'workloadTemplateSource',
  'workloadValidatorSource',
  'balanceConsumerEnvelopeSource',
  'balanceConsumerEnvelopeValidatorSource',
  'balanceConsumerMetadataTransitionValidatorSource',
  'bootstrapPrincipalsSource',
  'bootstrapPrincipalsValidatorSource',
  'walletAddressMigrationSource',
  'workerAuthoritySuspensionMigrationSource',
  'migrationIndexSource',
  'releaseManifestSource',
  'productionContainerValidatorSource',
] as const satisfies readonly (keyof BalanceConsumerArtifactSources)[]);
const REVIEWED_SQS_TOKENS_SOURCE_SHA256 =
  '9727c85465fd2bec762ea6c0445b698a1011234396778a156f7f161cac29ac14';
const REVIEWED_BALANCE_CONSUMER_ARTIFACT_SHA256 = Object.freeze({
  activationSource: '75ae4b590e2ad9d70542ea9c38809f4ed24d61ec354838e7318afdccc07dd091',
  cliSource: '7fec5d0cc345b82ed4fb5f26e1fa7099f0cb38c246224ada7a9fe51a65d4c455',
  cliModeSource: '2b03494cb126e80f4f7af1176cb08cf13aef2d14d4bf3cb371faa6f06a7294a8',
  runtimeSource: '9eb119d5c4ed60708931bdc25b810d0f61e064d8521c3465ae4c85046480fd5b',
  compositionSource: 'ab1893fef3304c0bffdba77aa95fb5f0ddf14ea8475e5a0fa4dd7abd215170e8',
  balanceSyncConsumerServiceSource:
    'f3d43d2dc66b501c2354a6bce58f899049dac399e72bafd4ea1405bbe0eb507e',
  balanceSyncPortsSource: '1d671d46ec39d0d8317d486924e0b9da07ae54f769f789492ad7e6d36e2f6c13',
  balanceConsumerResourceSource: '909a6296eec09501f2147c69da02c68e8b534440b0fc14314ed82a4630d7c8c5',
  balanceConsumerLifecycleSource:
    'd2d5d946456e89bf7698f874aacc2f5e79558f3a76d82aea2f74e3b2e29bcd52',
  mainnetBalanceIndexerRouterSource:
    'edb322685a88c4f01dc33bbbd4f5f000d30d756ffbfa461c645ec3acbba300d1',
  mainnetBalanceTwoSourceAgreementCoordinatorSource:
    'e077fdd52f8046d299d62faa2d73a576ffa082e6560d0c6409b2cea48efbfabc',
  balanceJsonRpcSource: 'f8fdf7f1e292824a8041e37455022103b6e54720dde125bcf6e055285d1bec75',
  nodeHttpsBalanceJsonRpcTransportSource:
    '78973ab23f864efb045ae5d8b43cc93e0e43a336dedac8e463bd62666e3e6cb0',
  ethereumBalanceIndexerSource: 'cdd60744549c6808cecc3a1bd1ab3668221ac86d4ba34177213fd15824938012',
  solanaBalanceIndexerSource: '34543ab41660c02beb8810fecae806eb06ab5684d4df7d90ed685b83609d389b',
  supportedAssetRegistrySource: '025ef9ebffc0a2e676394bca110ee203274e00d0d95b5fb4fe239953d235fc54',
  walletIdentitySource: 'a22e1c8e8ce5ddcd8c2e43007c37faf82868929afe6b2806e978611d19e788dd',
  solanaTokenAccountSource: '3e853238987144873c3193b8bdf2f41dcf4baf1ff62e84941a7f7a335e316d5a',
  balanceConsumerPersistenceResourceSource:
    '4b512084bae840afa187a898b914ff33923976056dda8537f411b583d72f84d3',
  balanceConsumerSqsReceiptResourceSource:
    '470dc9f137b0231d96996379a04dffa96de99176270edefd0fbf98a5250f3a60',
  runtimePostgresPoolSource: 'd15b4a0604cda0bcc9d8df7f597863e42c4ef573ba8ed4362386cd2beaa1f823',
  postgresServiceSource: '2e7e6fba4651e80f865a52ba5484f1c0ceb5c35268ad53a95eba89b216e85d94',
  balanceSyncCheckpointRepositorySource:
    '177a87c54235a007b4724e98e33700bf768091c432d4eb2ace24412bea23560c',
  balanceSyncWalletAddressResolverSource:
    '2ddf22caa5d84a0d6d0147c68482b04f809555ca5f772e103fc9758c7083927a',
  balanceConsumerConfigSource: 'bbcce014594c79f7ea76fee4dc211c8e5436947549fef54e848df5afaeb0ab14',
  blockchainSyncIndexSource: '55cd192f09e5c507d94fd0d0647d487b561d2e1e5852351e390b9251188fdf65',
  jobEnvelopeSource: '40b070d9676fe4243c91cb49e2819c0e7cfb664ec9298e827e5d6e40b5944281',
  blockchainSyncModuleSource: 'e78aeb6ee670cd9930c66db37dd03a0cb1e2190eb6542d1470c99afff5f5c6f4',
  appModuleSource: 'fd7cecd6d535a8f854f30a1f82811f6a9a32e7c7f9f0a38bfbee6471eb30504f',
  applicationRootSource: 'fcad49388bdfddcc55b0865a4ac4220e3d27ba77a20a19537121b68bf4b5c9dd',
  localDevelopmentAppModuleSource:
    'c607a60bd2a388dce1605752ca4d858ee137e670fccee0052ec157bc02605fc2',
  mainSource: 'b902f7f4f71fc4e6237c3baa75206a42244e93a902684a8387a167a6a180a0e9',
  outboxWorkerCliSource: 'd416d7a635479e2c45dc03049ac70748c087ab061c7378f41470aaa4e4b88677',
  redisSessionRevocationCliSource:
    'fabc12502a15b2b8771c0f4e133bcec7a9ec3c92da389b8f677c9c10f6fa769b',
  migrationCliSource: '9155e1b10fce756188c8b9d8de201b2f82c36680fb76ee28c15923b5c7101b51',
  balanceSyncOrchestratorSource: '9e47a337a511ba6d3306de440b1f491983559fac16addc2bbdeb270b4c229be9',
  balanceSyncDomainSource: 'c6992ec597647013b09d2898e196825747f135d72c34bbcf61bc67a393df36b2',
  chainObservationPolicySource: 'ef887514b86230d1516e5a8139c94dc2b2dde06c979440bc6eb3f4df90511533',
  failClosedJobDispositionSource:
    'd49d752db7ca17513a67219af26261add92bf73433224dfd847a098f73baf833',
  reviewedJobDispatcherSource: 'd5c922588ecc2c7eb930d2e2acc55b64167b033e9b5523fabd952cb9e50e43af',
  infrastructureConfigSource: 'fb1f6639a330d6a07db1d82434559356a4707a6550848d75397a1ff5e6a3fd10',
  pinnedQueueReceiptSource: '76543f1e4b4c446eb98b85ad52ea934d7e84f8f7fedcd82f6e516a7eb45a8c56',
  sqsJobWorkerSource: '833ec8c536421751efd722c503144fc160432ffee71043f97d8711ca9fd70fc1',
  observabilitySource: 'cc451c75a65c8651161ae6c2bd10b25fc290c4ca81818ceeb16bbbec64fff18b',
  sqsServiceSource: '2abb5d6592858be750263200fdd8b17a3ad15e0ee3ad5ca8fe14e36b5ac46d13',
  sqsModuleSource: 'dc958100bd372500a9428c28cc6219a4cb00db61314a63478368d0b0cf95221b',
  sqsTokensSource: REVIEWED_SQS_TOKENS_SOURCE_SHA256,
  apiPackageSource: 'c911e7171be6ff64908d1c15fc1d240f51ace8e8b90d6bcad4c605c994439774',
  rootPackageSource: '1a2c762fe9278975a123073be69b7dc332b547e348ecbb71303233da7ebac8fd',
  rootPackageLockSource: 'ac745baf70f2e70b3ba779612f0a3cc2b10692860a47c54c927a1e4805b2e6a6',
  applicationTemplateSource: '7fa270567d03d78a833e40cc0524c968c61f00fd43df877e5e0dfdd9ea1a07be',
  applicationValidatorSource: '0b80e3896627857740b18c78a609162e13ebbfd940b483428b654e780b62f112',
  workloadTemplateSource: '4c74c98e73635df30570dfe1e726b41cb6f62832f0bfc2e43dcd087d384b78de',
  workloadValidatorSource: '694f28c926fb08f6648d2d399fd31161681247eadacf43042077c4759dcbafba',
  balanceConsumerEnvelopeSource: '3b621023e516cd553c34fbe09e4b0047d1395fab45e105eef7692570d6429045',
  balanceConsumerEnvelopeValidatorSource:
    'ecceab597ba2c2930c59f443606249252c4931279ad99e9d29590c4324ab55ce',
  balanceConsumerMetadataTransitionValidatorSource:
    '79abdc329df3fe3275cf1c4d14a4256a2a334ec78efece9fefb92b9e461755e0',
  bootstrapPrincipalsSource: 'da3793b00efbfe12baa64446912376a85d2c6d7095f84dfb14c6e173dbefb9ac',
  bootstrapPrincipalsValidatorSource:
    '6731fee433acae8f7c240995c6ffe64247c7f4ef730be2b7367c3fa10ad40681',
  walletAddressMigrationSource: '74e32999fe3ac3b5791365c5a55129296cf68cb5b3d5697f2ffe462012029a84',
  workerAuthoritySuspensionMigrationSource:
    'f61ff9f4ad74e6067203ee1078502955c82af0acde164ff783970e5bc27949b0',
  migrationIndexSource: '2565fe9b9ed14d4b32a92cef583343de4d18832995426da8d75542701d70696d',
  releaseManifestSource: '234f2e397055af0884b45a599b7767fe9e24952b7978b769af4a46c73c1653ea',
  productionContainerValidatorSource:
    '56e219a54c8deeb08b287098915b78ec777303fa2df8bb076e046e26bbf4ce8c',
} satisfies Readonly<Record<keyof BalanceConsumerArtifactSources, string>>);
const MAX_BALANCE_CONSUMER_ARTIFACT_BYTES = 256 * 1024;
const MAX_BALANCE_CONSUMER_PACKAGE_LOCK_BYTES = 768 * 1024;
const MAX_BALANCE_CONSUMER_TOTAL_BYTES = 2 * 1024 * 1024;
const NON_PRODUCTION_ENVIRONMENT_ALLOWED_PATTERN = "'^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'";
const PRODUCTION_AWARE_ENVIRONMENT_PATTERN_SOURCE =
  '/^(?:dev|test|qa|sandbox|staging|production)(?:-[a-z0-9]+)*$/u';
const NON_PRODUCTION_ENVIRONMENT_PATTERN_SOURCE =
  '/^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/u';
const NON_PRODUCTION_ENVIRONMENT_PATTERN_SOURCE_NO_UNICODE =
  '/^(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*$/';

const SAFETY_MARKERS = Object.freeze({
  networkCallsMade: 0 as const,
  dnsQueriesMade: 0 as const,
  cloudCallsMade: 0 as const,
  providerCallsMade: 0 as const,
  secretValuesRead: 0 as const,
  applicationConfigurationEnvironmentValuesRead: 0 as const,
  operatingSystemEnvironmentVariableNamesMayBeReadForGit: Object.freeze([
    'COMSPEC',
    'PATHEXT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'WINDIR',
  ]),
  writesMade: 0 as const,
});
interface VerifiedEvidenceApplicationContext {
  readonly bundle: VerifiedProductionEvidenceBundle;
  readonly applicationOptions: Readonly<ProductionEvidenceApplicationOptions>;
}

const EVIDENCE_DERIVED_PUBLIC_LAUNCH_BINDINGS = new WeakMap<
  object,
  VerifiedEvidenceApplicationContext
>();
const VERIFIED_RDS_MASTER_LIFECYCLE_PREFLIGHT_INPUTS = new WeakMap<
  ProductionPreflightInput,
  VerifiedEvidenceApplicationContext
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function exactString(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value === expected;
}

function validText(value: unknown, maximumLength = 128): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    /^[\x20-\x7e]+$/u.test(value) &&
    value.trim() === value
  );
}

function stableJson(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('NON_FINITE_NUMBER');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('UNSUPPORTED_VALUE');
  if (seen.has(value)) throw new TypeError('CYCLIC_VALUE');
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => stableJson(item, seen)).join(',')}]`;
  } else {
    const record = value as Record<string, unknown>;
    result = `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key], seen)}`)
      .join(',')}}`;
  }
  seen.delete(value);
  return result;
}

export function productionDirectoryConfigurationSha256(directory: unknown): string {
  return createHash('sha256').update(stableJson(directory)).digest('hex');
}

function validNetworks(value: unknown, ecosystem: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  const ids = new Set<string>();
  return value.every((candidate) => {
    if (!isRecord(candidate) || !exactKeys(candidate, NETWORK_KEYS)) return false;
    if (!validText(candidate.id, 64) || !validText(candidate.name, 64)) return false;
    const expectedEcosystem = NETWORKS.get(candidate.id);
    if (
      expectedEcosystem === undefined ||
      expectedEcosystem !== ecosystem ||
      ids.has(candidate.id)
    ) {
      return false;
    }
    ids.add(candidate.id);
    return true;
  });
}

function validActions(value: unknown): value is readonly ('SUPPLY' | 'WITHDRAW')[] {
  return (
    Array.isArray(value) &&
    value.length <= 2 &&
    new Set(value).size === value.length &&
    value.every((action) => action === 'SUPPLY' || action === 'WITHDRAW')
  );
}

function validatePlatformEntry(value: unknown): ValidatedPlatformEntry | null {
  if (!isRecord(value) || !exactKeys(value, PROVIDER_KEYS)) return null;
  if (
    !validText(value.id, 64) ||
    !PROVIDER_ID_PATTERN.test(value.id) ||
    !validText(value.name) ||
    !validText(value.protocol) ||
    (value.ecosystem !== 'EVM' && value.ecosystem !== 'SOLANA') ||
    !validNetworks(value.networks, value.ecosystem) ||
    !validActions(value.supportedActions)
  ) {
    return null;
  }
  const integrationStatus = value.integrationStatus;
  if (
    integrationStatus !== 'PLANNED' &&
    integrationStatus !== 'LIVE_READ_ONLY' &&
    integrationStatus !== 'TRANSACTION_ENABLED'
  ) {
    return null;
  }
  const planned =
    integrationStatus === 'PLANNED' &&
    value.dataStatus === 'NOT_CONNECTED' &&
    value.accessStatus === 'UNAVAILABLE' &&
    value.riskStatus === 'NOT_ASSESSED' &&
    value.supportedActions.length === 0;
  const liveReadOnly =
    integrationStatus === 'LIVE_READ_ONLY' &&
    value.dataStatus === 'LIVE' &&
    value.accessStatus === 'AVAILABLE' &&
    value.riskStatus === 'ASSESSED' &&
    value.supportedActions.length === 0;
  const transactionEnabled =
    integrationStatus === 'TRANSACTION_ENABLED' &&
    value.dataStatus === 'LIVE' &&
    value.accessStatus === 'AVAILABLE' &&
    value.riskStatus === 'ASSESSED' &&
    value.supportedActions.length === 2 &&
    value.supportedActions[0] === 'SUPPLY' &&
    value.supportedActions[1] === 'WITHDRAW';
  if (!planned && !liveReadOnly && !transactionEnabled) return null;
  return Object.freeze({
    id: value.id,
    integrationStatus,
    supportedActions: Object.freeze([...value.supportedActions]),
  });
}

function validatePlatformDirectory(value: unknown): PlatformDirectoryValidation {
  if (!isRecord(value) || !exactKeys(value, DIRECTORY_KEYS)) {
    return {
      valid: false,
      providerTargetMet: false,
      mayAuthorizeFinancialAction: false,
      entries: [],
      configurationSha256: null,
    };
  }
  const rootValid =
    value.schemaVersion === 1 &&
    value.use === 'MAINNET_PLATFORM_DIRECTORY' &&
    typeof value.mayAuthorizeFinancialAction === 'boolean' &&
    value.minimumProviderTarget === PRODUCTION_PROVIDER_TARGET &&
    Array.isArray(value.providers) &&
    value.providers.length <= 100;
  const entries = Array.isArray(value.providers) ? value.providers.map(validatePlatformEntry) : [];
  const completeEntries = entries.filter(
    (entry): entry is ValidatedPlatformEntry => entry !== null,
  );
  const ids = new Set(completeEntries.map(({ id }) => id));
  const valid =
    rootValid && completeEntries.length === entries.length && ids.size === completeEntries.length;
  let configurationSha256: string | null = null;
  if (valid) {
    try {
      configurationSha256 = productionDirectoryConfigurationSha256(value);
    } catch {
      configurationSha256 = null;
    }
  }
  return {
    valid: valid && configurationSha256 !== null,
    providerTargetMet: valid && completeEntries.length >= PRODUCTION_PROVIDER_TARGET,
    mayAuthorizeFinancialAction: value.mayAuthorizeFinancialAction === true,
    entries: valid ? completeEntries : [],
    configurationSha256,
  };
}

function validEvidenceProviderIds(
  value: unknown,
  directoryIds: ReadonlySet<string>,
): string[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const providerIds: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (
      typeof id !== 'string' ||
      !PROVIDER_ID_PATTERN.test(id) ||
      id.length > 64 ||
      seen.has(id) ||
      !directoryIds.has(id)
    ) {
      return null;
    }
    seen.add(id);
    providerIds.push(id);
  }
  return providerIds;
}

function invalidEvidenceIndex(): EvidenceIndexValidation {
  return {
    valid: false,
    providerIds: [],
    adapterBindingsComplete: false,
    compositionEvidencePassed: false,
    actionBindingsComplete: false,
    revisionMatches: false,
    directoryBindingMatches: false,
  };
}

function validateEvidenceIndex(
  value: unknown,
  kind: 'READ' | 'WRITE',
  sourceRevision: string | null,
  directory: PlatformDirectoryValidation,
): EvidenceIndexValidation {
  if (!isRecord(value) || !directory.valid || directory.configurationSha256 === null) {
    return invalidEvidenceIndex();
  }
  const expectedKeys = kind === 'READ' ? READ_EVIDENCE_KEYS : WRITE_EVIDENCE_KEYS;
  if (!exactKeys(value, expectedKeys)) return invalidEvidenceIndex();
  const eligibleIds = new Set(
    directory.entries
      .filter(({ integrationStatus }) =>
        kind === 'READ'
          ? integrationStatus !== 'PLANNED'
          : integrationStatus === 'TRANSACTION_ENABLED',
      )
      .map(({ id }) => id),
  );
  const providerIds = validEvidenceProviderIds(value.providerIds, eligibleIds);
  const revisionMatches =
    sourceRevision !== null &&
    SOURCE_REVISION_PATTERN.test(sourceRevision) &&
    value.sourceRevision === sourceRevision;
  const directoryBindingMatches =
    typeof value.directoryConfigurationSha256 === 'string' &&
    SHA256_PATTERN.test(value.directoryConfigurationSha256) &&
    value.directoryConfigurationSha256 === directory.configurationSha256;
  const commonValid =
    value.schemaVersion === 1 &&
    value.status === 'ACCEPTED' &&
    providerIds !== null &&
    providerIds.length >= PRODUCTION_PROVIDER_TARGET &&
    revisionMatches &&
    directoryBindingMatches;
  if (kind === 'READ') {
    const adapterBindingsComplete = value.adapterBindings === 'COMPLETE';
    const compositionEvidencePassed = value.compositionEvidence === 'PASS';
    return {
      valid:
        commonValid &&
        value.artifactType === 'PRODUCTION_LIVE_READ_EVIDENCE_INDEX' &&
        adapterBindingsComplete &&
        compositionEvidencePassed,
      providerIds: providerIds ?? [],
      adapterBindingsComplete,
      compositionEvidencePassed,
      actionBindingsComplete: false,
      revisionMatches,
      directoryBindingMatches,
    };
  }
  const actionBindingsComplete = value.actionBindings === 'COMPLETE';
  return {
    valid:
      commonValid &&
      value.artifactType === 'PRODUCTION_MAINNET_WRITE_EVIDENCE_INDEX' &&
      actionBindingsComplete &&
      value.simulationEvidence === 'PASS' &&
      value.reconciliationEvidence === 'PASS' &&
      value.independentSecurityReview === 'ACCEPTED',
    providerIds: providerIds ?? [],
    adapterBindingsComplete: false,
    compositionEvidencePassed: false,
    actionBindingsComplete,
    revisionMatches,
    directoryBindingMatches,
  };
}

function hasExactScopedBindings(
  values: ReadonlySet<string>,
  required: readonly string[],
  inScope: (name: string) => boolean,
): boolean {
  const scoped = [...values].filter(inScope);
  return scoped.length === required.length && required.every((name) => values.has(name));
}

function check(
  id: ProductionPreflightCheckId,
  localValidation: 'PASS' | 'FAIL',
  blockerIds: readonly ProductionPreflightBlockerId[],
): ProductionPreflightCheck {
  return Object.freeze({
    id,
    localValidation,
    launchReadiness: blockerIds.length === 0 ? 'LOCAL_GATES_CLEAR' : 'BLOCKED',
    blockerIds: Object.freeze([...blockerIds]),
  });
}

function evidenceBlockers(
  kind: 'READ' | 'WRITE',
  supplied: boolean,
  validation: EvidenceIndexValidation,
): ProductionPreflightBlockerId[] {
  if (!supplied) {
    return [
      kind === 'READ' ? 'LIVE_READ_EVIDENCE_INDEX_MISSING' : 'MAINNET_WRITE_EVIDENCE_INDEX_MISSING',
    ];
  }
  const blockers: ProductionPreflightBlockerId[] = [];
  if (!validation.valid) {
    blockers.push(
      kind === 'READ' ? 'LIVE_READ_EVIDENCE_INDEX_INVALID' : 'MAINNET_WRITE_EVIDENCE_INDEX_INVALID',
    );
  }
  if (!validation.revisionMatches) {
    blockers.push(
      kind === 'READ'
        ? 'LIVE_READ_EVIDENCE_REVISION_MISMATCH'
        : 'MAINNET_WRITE_EVIDENCE_REVISION_MISMATCH',
    );
  }
  if (!validation.directoryBindingMatches) {
    blockers.push(
      kind === 'READ'
        ? 'LIVE_READ_EVIDENCE_DIRECTORY_BINDING_MISMATCH'
        : 'MAINNET_WRITE_EVIDENCE_DIRECTORY_BINDING_MISMATCH',
    );
  }
  if (kind === 'READ') {
    if (!validation.adapterBindingsComplete) {
      blockers.push('LIVE_READ_ADAPTER_BINDING_EVIDENCE_MISSING');
    }
    if (!validation.compositionEvidencePassed) {
      blockers.push('LIVE_READ_COMPOSITION_EVIDENCE_MISSING');
    }
  } else if (!validation.actionBindingsComplete) {
    blockers.push('MAINNET_WRITE_ACTION_BINDING_EVIDENCE_MISSING');
  }
  return blockers;
}

function directoryExposesTransactionCapability(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.mayAuthorizeFinancialAction === true) return true;
  if (!Array.isArray(value.providers)) return false;
  return value.providers.some(
    (provider) =>
      isRecord(provider) &&
      (provider.integrationStatus === 'TRANSACTION_ENABLED' ||
        (Array.isArray(provider.supportedActions) && provider.supportedActions.length > 0)),
  );
}

function publicLaunchAuthorityValidation(value: unknown): Readonly<{
  localValidation: 'PASS' | 'FAIL';
  blockers: readonly ProductionPreflightBlockerId[];
}> {
  try {
    if (value === undefined || value === null) {
      return Object.freeze({
        localValidation: 'PASS' as const,
        blockers: Object.freeze(['PUBLIC_LAUNCH_AUTHORITY_DECISION_MISSING'] as const),
      });
    }
    if (!isRecord(value) || !exactKeys(value, ['decisionSet', 'evidenceBinding'])) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    const decisionSet = value.decisionSet;
    const evidenceBinding = value.evidenceBinding;
    if (decisionSet === null) {
      return Object.freeze({
        localValidation: 'PASS' as const,
        blockers: Object.freeze(['PUBLIC_LAUNCH_AUTHORITY_DECISION_MISSING'] as const),
      });
    }
    if (!isRecord(evidenceBinding)) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    const evidenceContext = EVIDENCE_DERIVED_PUBLIC_LAUNCH_BINDINGS.get(evidenceBinding);
    if (
      evidenceContext === undefined ||
      !isVerifiedProductionEvidenceBundle(evidenceContext.bundle) ||
      !isVerifiedPublicLaunchAuthorityDecisionSet(decisionSet)
    ) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    revalidateProductionEvidenceBundleForApplication(
      evidenceContext.bundle,
      evidenceContext.applicationOptions,
    );
    if (
      !isVerifiedProductionEvidenceBundle(evidenceContext.bundle) ||
      evidenceBinding.releaseCandidateManifestSha256 !==
        evidenceContext.bundle.content.releaseCandidateManifestSha256 ||
      evidenceBinding.deploymentTargetId !== evidenceContext.bundle.content.deploymentTargetId ||
      evidenceBinding.deploymentTargetConfigurationSha256 !==
        evidenceContext.bundle.content.deploymentTargetSha256
    ) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    revalidatePublicLaunchAuthorityDecisionForApplication(
      decisionSet,
      evidenceBinding as unknown as PublicLaunchTargetBinding,
    );
    if (!isVerifiedPublicLaunchAuthorityDecisionSet(decisionSet)) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    return Object.freeze({
      localValidation: 'PASS' as const,
      blockers: Object.freeze([]),
    });
  } catch {
    return Object.freeze({
      localValidation: 'FAIL' as const,
      blockers: Object.freeze(['PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED'] as const),
    });
  }
}

export function evaluateProductionPreflight(
  input: ProductionPreflightInput,
  selectedTarget: ProductionPreflightTarget = 'read-only',
): ProductionPreflightReport {
  const productionInfrastructureBlockers: ProductionPreflightBlockerId[] = [];
  let productionInfrastructureInspected = false;
  let productionInfrastructureEnabled = false;
  try {
    const deployment = input.productionInfrastructureDeployment;
    productionInfrastructureInspected =
      deployment?.inspected === true &&
      deployment.syntaxValid === true &&
      VERIFIED_PRODUCTION_INFRASTRUCTURE_DEPLOYMENTS.has(deployment);
    productionInfrastructureEnabled =
      productionInfrastructureInspected &&
      deployment !== undefined &&
      deployment.environmentContract === 'PRODUCTION_ENABLED';
  } catch {
    // Initialized fail-closed values are preserved for malformed or hostile inputs.
  }
  if (!productionInfrastructureInspected) {
    productionInfrastructureBlockers.push('PRODUCTION_INFRASTRUCTURE_INSPECTION_FAILED');
  } else if (!productionInfrastructureEnabled) {
    productionInfrastructureBlockers.push('PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_PATH_NOT_ENABLED');
  }

  const balanceConsumerBlockers: ProductionPreflightBlockerId[] = [];
  let balanceConsumerInspected = false;
  let balanceConsumerDeployment: BalanceConsumerDeploymentInput | undefined;
  try {
    balanceConsumerDeployment = input.balanceConsumerDeployment;
    balanceConsumerInspected =
      balanceConsumerDeployment?.inspected === true &&
      balanceConsumerDeployment.contractValid === true &&
      balanceConsumerDeployment.sourceActivation === 'DISABLED' &&
      balanceConsumerDeployment.runtimeComposition === 'NOT_COMPOSED' &&
      balanceConsumerDeployment.taskDeployment === 'NOT_PROVISIONED' &&
      balanceConsumerDeployment.iamCapability === 'NOT_PROVISIONED' &&
      balanceConsumerDeployment.databaseCapability === 'DORMANT_SOURCE_ONLY' &&
      balanceConsumerDeployment.deploymentEvidence === 'MISSING' &&
      VERIFIED_BALANCE_CONSUMER_DEPLOYMENTS.has(balanceConsumerDeployment);
  } catch {
    // Initialized fail-closed values are preserved for malformed or hostile inputs.
  }
  if (!balanceConsumerInspected || balanceConsumerDeployment === undefined) {
    balanceConsumerBlockers.push('BALANCE_CONSUMER_INSPECTION_FAILED');
  } else {
    balanceConsumerBlockers.push(
      'BALANCE_CONSUMER_SOURCE_ACTIVATION_DISABLED',
      'BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED',
      'BALANCE_CONSUMER_TASK_NOT_PROVISIONED',
      'BALANCE_CONSUMER_IAM_NOT_PROVISIONED',
      'BALANCE_CONSUMER_DATABASE_CAPABILITY_NOT_ENABLED',
      'BALANCE_CONSUMER_DEPLOYED_EVIDENCE_MISSING',
    );
  }

  const providerPositionReadBoundaryBlockers: ProductionPreflightBlockerId[] = [];
  let providerPositionReadBoundaryInspected = false;
  let providerPositionReadBoundary: ProviderPositionReadBoundaryInput | undefined;
  try {
    providerPositionReadBoundary = input.providerPositionReadBoundary;
    providerPositionReadBoundaryInspected =
      providerPositionReadBoundary?.inspected === true &&
      providerPositionReadBoundary.contractValid === true &&
      providerPositionReadBoundary.readerFeatureRegistration === 'MISSING' &&
      providerPositionReadBoundary.trustedAssessmentFeatureRegistration === 'MISSING' &&
      providerPositionReadBoundary.deadlineRunnerFeatureRegistration === 'MISSING' &&
      VERIFIED_PROVIDER_POSITION_READ_BOUNDARIES.has(providerPositionReadBoundary);
  } catch {
    // Initialized fail-closed values are preserved for malformed or hostile inputs.
  }
  if (!providerPositionReadBoundaryInspected || providerPositionReadBoundary === undefined) {
    providerPositionReadBoundaryBlockers.push('PROVIDER_POSITION_READ_BOUNDARY_INSPECTION_FAILED');
  } else {
    providerPositionReadBoundaryBlockers.push(
      'PROVIDER_POSITION_READER_FEATURE_REGISTRATION_MISSING',
      'PROVIDER_POSITION_TRUSTED_ASSESSMENT_FEATURE_REGISTRATION_MISSING',
      'PROVIDER_POSITION_DEADLINE_RUNNER_FEATURE_REGISTRATION_MISSING',
    );
  }

  const authenticationBlockers: ProductionPreflightBlockerId[] = [];
  const databaseMasterDeployment = input.databaseMasterDeployment;
  const databaseMasterDeploymentValid =
    databaseMasterDeployment?.inspected === true &&
    databaseMasterDeployment.syntaxValid === true &&
    VERIFIED_DATABASE_MASTER_DEPLOYMENTS.has(databaseMasterDeployment);
  if (!databaseMasterDeploymentValid) {
    authenticationBlockers.push('DATABASE_MASTER_SECRET_NOT_RDS_MANAGED');
  }
  let rdsMasterLifecycleEvidenceAccepted = false;
  try {
    const evidenceContext = VERIFIED_RDS_MASTER_LIFECYCLE_PREFLIGHT_INPUTS.get(input);
    if (input.rdsMasterLifecycleEvidenceAccepted === true && evidenceContext !== undefined) {
      revalidateProductionEvidenceBundleForApplication(
        evidenceContext.bundle,
        evidenceContext.applicationOptions,
      );
      rdsMasterLifecycleEvidenceAccepted =
        isVerifiedProductionEvidenceBundle(evidenceContext.bundle) &&
        evidenceContext.bundle.content.rdsMasterLifecycleEvidence.artifactType ===
          'RDS_MASTER_LIFECYCLE_EVIDENCE' &&
        evidenceContext.bundle.content.rdsMasterLifecycleEvidence.status === 'ACCEPTED';
    }
  } catch {
    rdsMasterLifecycleEvidenceAccepted = false;
  }
  if (!rdsMasterLifecycleEvidenceAccepted) {
    authenticationBlockers.push('RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING');
  }
  const redisOperatorDeploymentValid =
    input.redisOperatorDeployment?.inspected === true &&
    input.redisOperatorDeployment.syntaxValid === true;
  if (!redisOperatorDeploymentValid) {
    authenticationBlockers.push('REDIS_OPERATOR_SECRET_VERSION_NOT_WIRED');
  }
  if (!input.authentication.inspected || !input.authentication.syntaxValid) {
    authenticationBlockers.push('AUTH_TEMPLATE_INSPECTION_FAILED');
  }
  if (
    !input.authentication.inspected ||
    !input.authentication.syntaxValid ||
    !hasExactScopedBindings(
      input.authentication.apiEnvironmentNames,
      [...REQUIRED_API_PRODUCTION_ENVIRONMENT_NAMES, ...REQUIRED_API_AUTH_ENVIRONMENT_NAMES],
      (name) => API_AUTH_RUNTIME_BINDING_NAME.test(name),
    )
  ) {
    authenticationBlockers.push('AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED');
  }
  if (
    !input.authentication.inspected ||
    !input.authentication.syntaxValid ||
    !hasExactScopedBindings(
      input.authentication.apiSecretNames,
      REQUIRED_API_AUTH_SECRET_NAMES,
      (name) => API_AUTH_RUNTIME_BINDING_NAME.test(name),
    )
  ) {
    authenticationBlockers.push('AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED');
  }
  if (
    !input.authentication.inspected ||
    !input.authentication.syntaxValid ||
    !hasExactScopedBindings(
      input.authentication.webEnvironmentNames,
      [...REQUIRED_WEB_PRODUCTION_ENVIRONMENT_NAMES, ...REQUIRED_WEB_AUTH_ENVIRONMENT_NAMES],
      (name) => PRODUCTION_AUTH_WALLET_BINDING_NAME.test(name),
    )
  ) {
    authenticationBlockers.push('AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED');
  }
  if (
    !input.authentication.inspected ||
    !input.authentication.syntaxValid ||
    !hasExactScopedBindings(
      input.authentication.apiEnvironmentNames,
      REQUIRED_WALLET_ENVIRONMENT_NAMES,
      (name) => WALLET_BINDING_NAME.test(name),
    ) ||
    !hasExactScopedBindings(
      input.authentication.apiSecretNames,
      REQUIRED_WALLET_SECRET_NAMES,
      (name) => WALLET_BINDING_NAME.test(name),
    )
  ) {
    authenticationBlockers.push('WALLET_REGISTRATION_MAINNET_CONFIGURATION_NOT_WIRED');
  }
  if (!input.authentication.deployedEvidenceAccepted) {
    authenticationBlockers.push('AUTH_DEPLOYED_EVIDENCE_MISSING');
  }

  const egressBlockers: ProductionPreflightBlockerId[] = [];
  if (!input.egress.localValidationPassed) {
    egressBlockers.push('EGRESS_POLICY_LOCAL_VALIDATION_FAILED');
  }
  if (!exactString(input.egress.status, 'ACCEPTED')) {
    egressBlockers.push('EGRESS_POLICY_NOT_ACCEPTED');
  }
  if (!exactString(input.egress.currentMode, 'APPROVED_DESTINATIONS_ONLY')) {
    egressBlockers.push('EXTERNAL_EGRESS_DISABLED');
  }
  if (!input.egress.liveEvidenceComplete) {
    egressBlockers.push('EGRESS_LIVE_EVIDENCE_INCOMPLETE');
  }

  const rpcProviderBlockers: ProductionPreflightBlockerId[] = [];
  const rpcProviderDecisionLocalValidationPassed =
    input.rpcProviders.localValidationPassed === true;
  const dormantProviderInventoryLocalValidationPassed =
    input.rpcProviders.dormantInventoryValidationPassed === true;
  const providerResearchCaptureLocalValidationPassed =
    input.rpcProviders.activeScopeResearchCaptureValidationPassed === true;
  if (!rpcProviderDecisionLocalValidationPassed) {
    rpcProviderBlockers.push('RPC_PROVIDER_DECISION_LOCAL_VALIDATION_FAILED');
  }
  if (!dormantProviderInventoryLocalValidationPassed) {
    rpcProviderBlockers.push('RPC_PROVIDER_DORMANT_INVENTORY_LOCAL_VALIDATION_FAILED');
  }
  if (!providerResearchCaptureLocalValidationPassed) {
    rpcProviderBlockers.push('RPC_PROVIDER_ACTIVE_SCOPE_RESEARCH_CAPTURE_LOCAL_VALIDATION_FAILED');
  }
  if (
    !exactString(input.rpcProviders.externalStatus, 'APPROVED') ||
    !input.rpcProviders.approvalBoundaryApproved
  ) {
    rpcProviderBlockers.push('RPC_PROVIDER_EXTERNAL_APPROVAL_PENDING');
  }
  if (!exactString(input.rpcProviders.runtimeStatus, 'APPROVED')) {
    rpcProviderBlockers.push('RPC_PROVIDER_RUNTIME_NOT_APPROVED');
  }
  if (!input.rpcProviders.liveEvidenceAccepted) {
    rpcProviderBlockers.push('RPC_PROVIDER_LIVE_EVIDENCE_INCOMPLETE');
  }

  const directory = validatePlatformDirectory(input.platforms.directory);
  const directoryBlockers: ProductionPreflightBlockerId[] = [];
  if (!directory.valid) directoryBlockers.push('PLATFORM_DIRECTORY_LOCAL_VALIDATION_FAILED');
  if (!directory.providerTargetMet) {
    directoryBlockers.push('PLATFORM_DIRECTORY_PROVIDER_TARGET_NOT_MET');
  }

  const readEvidence = validateEvidenceIndex(
    input.platforms.liveReadEvidenceIndex,
    'READ',
    input.platforms.sourceRevision,
    directory,
  );
  const readBlockers = evidenceBlockers(
    'READ',
    input.platforms.liveReadEvidenceIndex !== null,
    readEvidence,
  );
  const liveCapabilityIds = new Set(
    directory.entries
      .filter(({ integrationStatus }) => integrationStatus !== 'PLANNED')
      .map(({ id }) => id),
  );
  if (liveCapabilityIds.size < PRODUCTION_PROVIDER_TARGET) {
    readBlockers.push('PLATFORM_LIVE_CAPABILITY_NOT_EXPOSED');
  }
  const liveReadEvidenceBound = readEvidence.valid ? readEvidence.providerIds.length : 0;
  if (liveReadEvidenceBound < PRODUCTION_PROVIDER_TARGET) {
    readBlockers.push('LIVE_PROVIDER_TARGET_NOT_MET');
  }

  const isolationBlockers: ProductionPreflightBlockerId[] = [];
  if (!directory.valid) {
    isolationBlockers.push('READ_ONLY_ISOLATION_LOCAL_VALIDATION_FAILED');
  }
  if (directoryExposesTransactionCapability(input.platforms.directory)) {
    isolationBlockers.push('READ_ONLY_TRANSACTION_CAPABILITY_EXPOSED');
  }

  const writeEvidence = validateEvidenceIndex(
    input.platforms.mainnetWriteEvidenceIndex,
    'WRITE',
    input.platforms.sourceRevision,
    directory,
  );
  const writeBlockers = evidenceBlockers(
    'WRITE',
    input.platforms.mainnetWriteEvidenceIndex !== null,
    writeEvidence,
  );
  if (!directory.mayAuthorizeFinancialAction) {
    writeBlockers.push('MAINNET_FINANCIAL_ACTIONS_DISABLED');
  }
  const transactionCapabilityIds = new Set(
    directory.entries
      .filter(({ integrationStatus }) => integrationStatus === 'TRANSACTION_ENABLED')
      .map(({ id }) => id),
  );
  if (transactionCapabilityIds.size < PRODUCTION_PROVIDER_TARGET) {
    writeBlockers.push('MAINNET_TRANSACTION_CAPABILITY_NOT_EXPOSED');
  }
  const acceptedLiveReadProviderIds = new Set(readEvidence.valid ? readEvidence.providerIds : []);
  const writeProviderSetCoveredByLiveReadEvidence =
    writeEvidence.valid &&
    readEvidence.valid &&
    writeEvidence.providerIds.every((id) => acceptedLiveReadProviderIds.has(id));
  if (writeEvidence.valid && !writeProviderSetCoveredByLiveReadEvidence) {
    writeBlockers.push('MAINNET_WRITE_PROVIDER_SET_NOT_COVERED_BY_LIVE_READ_EVIDENCE');
  }
  const transactionEvidenceBound = writeProviderSetCoveredByLiveReadEvidence
    ? writeEvidence.providerIds.length
    : 0;
  if (transactionEvidenceBound < PRODUCTION_PROVIDER_TARGET) {
    writeBlockers.push('MAINNET_TRANSACTION_PROVIDER_TARGET_NOT_MET');
  }

  // Revalidate the private decision brand, trusted-clock freshness, signatures,
  // and exact evidence-derived binding immediately before readiness is computed.
  const publicLaunchAuthorities = publicLaunchAuthorityValidation(input.publicLaunchAuthorities);

  const checks = Object.freeze([
    check(
      'PRODUCTION_INFRASTRUCTURE',
      productionInfrastructureInspected ? 'PASS' : 'FAIL',
      productionInfrastructureBlockers,
    ),
    check('BALANCE_CONSUMER', balanceConsumerInspected ? 'PASS' : 'FAIL', balanceConsumerBlockers),
    check(
      'PROVIDER_POSITION_READ_BOUNDARY',
      providerPositionReadBoundaryInspected ? 'PASS' : 'FAIL',
      providerPositionReadBoundaryBlockers,
    ),
    check(
      'AUTHENTICATION',
      input.authentication.inspected &&
        input.authentication.syntaxValid &&
        databaseMasterDeploymentValid &&
        redisOperatorDeploymentValid
        ? 'PASS'
        : 'FAIL',
      authenticationBlockers,
    ),
    check('EXTERNAL_EGRESS', input.egress.localValidationPassed ? 'PASS' : 'FAIL', egressBlockers),
    check(
      'RPC_INDEXING',
      rpcProviderDecisionLocalValidationPassed &&
        dormantProviderInventoryLocalValidationPassed &&
        providerResearchCaptureLocalValidationPassed
        ? 'PASS'
        : 'FAIL',
      rpcProviderBlockers,
    ),
    check('PLATFORM_DIRECTORY', directory.valid ? 'PASS' : 'FAIL', directoryBlockers),
    check('PLATFORM_LIVE_READS', readEvidence.valid ? 'PASS' : 'FAIL', readBlockers),
    check('READ_ONLY_ISOLATION', directory.valid ? 'PASS' : 'FAIL', isolationBlockers),
    check(
      'PUBLIC_LAUNCH_AUTHORITIES',
      publicLaunchAuthorities.localValidation,
      publicLaunchAuthorities.blockers,
    ),
    check('MAINNET_WRITES', writeEvidence.valid ? 'PASS' : 'FAIL', writeBlockers),
  ]);

  const readinessFor = (
    ids: readonly ProductionPreflightCheckId[],
  ): ProductionPreflightReadiness =>
    checks
      .filter(({ id }) => ids.includes(id))
      .every(({ launchReadiness }) => launchReadiness === 'LOCAL_GATES_CLEAR')
      ? 'LOCAL_GATES_CLEAR'
      : 'BLOCKED';
  const publicReadOnly = readinessFor([
    'PRODUCTION_INFRASTRUCTURE',
    'BALANCE_CONSUMER',
    'PROVIDER_POSITION_READ_BOUNDARY',
    'AUTHENTICATION',
    'EXTERNAL_EGRESS',
    'RPC_INDEXING',
    'PLATFORM_DIRECTORY',
    'PLATFORM_LIVE_READS',
    'READ_ONLY_ISOLATION',
    'PUBLIC_LAUNCH_AUTHORITIES',
  ]);
  const mainnetWrites = readinessFor([
    'PRODUCTION_INFRASTRUCTURE',
    'BALANCE_CONSUMER',
    'PROVIDER_POSITION_READ_BOUNDARY',
    'AUTHENTICATION',
    'EXTERNAL_EGRESS',
    'RPC_INDEXING',
    'PLATFORM_DIRECTORY',
    'PLATFORM_LIVE_READS',
    'PUBLIC_LAUNCH_AUTHORITIES',
    'MAINNET_WRITES',
  ]);

  return Object.freeze({
    schemaVersion: PRODUCTION_PREFLIGHT_SCHEMA_VERSION,
    auditMode: 'BOOTSTRAP_BLOCKER_AUDIT',
    scope: 'LOCAL_STATIC_ONLY',
    selectedTarget,
    selectedTargetReadiness: selectedTarget === 'read-only' ? publicReadOnly : mainnetWrites,
    readiness: Object.freeze({ publicReadOnly, mainnetWrites }),
    providerCounts: Object.freeze({
      minimumTarget: PRODUCTION_PROVIDER_TARGET,
      directory: directory.entries.length,
      planned: directory.entries.filter(({ integrationStatus }) => integrationStatus === 'PLANNED')
        .length,
      liveReadEvidenceBound,
      transactionEvidenceBound,
    }),
    checks,
    safety: SAFETY_MARKERS,
    assurance: 'LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL',
  });
}

function leadingSpaces(value: string): number {
  return value.length - value.trimStart().length;
}

function yamlBlock(source: string, name: string, parentIndent: number): string | null {
  const lines = source.replace(/\r\n/gu, '\n').split('\n');
  const marker = `${' '.repeat(parentIndent)}${name}:`;
  const matches = lines.flatMap((line, index) => (line === marker ? [index] : []));
  if (matches.length !== 1) return null;
  const start = matches[0];
  if (start === undefined) return null;
  const collected = [lines[start] ?? marker];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length > 0 && leadingSpaces(line) <= parentIndent) break;
    collected.push(line);
  }
  return collected.join('\n');
}

function yamlNamedSequenceEntryBlock(
  source: string,
  name: string,
  itemIndent: number,
): string | null {
  const lines = source.replace(/\r\n/gu, '\n').split('\n');
  const marker = `${' '.repeat(itemIndent)}- Name: ${name}`;
  const matches = lines.flatMap((line, index) => (line === marker ? [index] : []));
  if (matches.length !== 1) return null;
  const start = matches[0];
  if (start === undefined) return null;
  const collected = [lines[start] ?? marker];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('#') && leadingSpaces(line) <= itemIndent) {
      break;
    }
    collected.push(line);
  }
  return collected.join('\n');
}

function hasExactYamlScalarProperty(source: string | null, name: string, value: string): boolean {
  if (source === null) return false;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matches = source
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => new RegExp(`^${escapedName}:`).test(line));
  return matches.length === 1 && matches[0] === `${name}: ${value}`;
}

function hasExactImmutableImageParameter(
  source: string,
  name: 'ApiImageUri' | 'WebImageUri',
  repository: 'crypto-lending-api' | 'crypto-lending-web',
): boolean {
  const parameter = yamlBlock(source, name, 1) ?? yamlBlock(source, name, 2);
  const allowedPattern =
    `'^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.` +
    `(amazonaws\\.com|amazonaws\\.com\\.cn)/${repository}@sha256:[a-f0-9]{64}$'`;
  return (
    hasExactYamlScalarProperty(parameter, 'Type', 'String') &&
    hasExactYamlScalarProperty(parameter, 'AllowedPattern', allowedPattern) &&
    !/(?:^|\n)\s+Default:/u.test(parameter ?? '')
  );
}

function hasExactTopLevelParameter(
  source: string,
  name: string,
  expectedProperties: readonly string[],
): boolean {
  const normalizedSource = source.replace(/\r\n/gu, '\n');
  const parameters = yamlBlock(normalizedSource, 'Parameters', 0);
  if (parameters === null) return false;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const declarationPattern = new RegExp(`^\\s+${escapedName}:\\s*$`, 'u');
  const declarations = normalizedSource.split('\n').filter((line) => declarationPattern.test(line));
  const parameterDeclarations = parameters
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .filter((line) => declarationPattern.test(line));
  if (declarations.length !== 1 || parameterDeclarations.length !== 1) return false;
  const indent = leadingSpaces(parameterDeclarations[0] ?? '');
  const directChildIndent = Math.min(
    ...parameters
      .split('\n')
      .filter((line) => /^\s+[A-Za-z][A-Za-z0-9]*:\s*$/u.test(line))
      .map(leadingSpaces),
  );
  if (!Number.isFinite(directChildIndent) || indent !== directChildIndent) return false;
  const parameter = yamlBlock(parameters, name, indent);
  if (parameter === null) return false;
  const semanticLines = parameter
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return semanticLines.join('\n') === [`${name}:`, ...expectedProperties].join('\n');
}

function trimmedExecutableLines(source: string): readonly string[] {
  return source
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));
}

function exactExecutableLineCount(source: string, expected: string): number {
  return trimmedExecutableLines(source).filter((line) => line === expected).length;
}

function sortedTypeScriptImportTargets(source: string): readonly string[] {
  const targets: string[] = [];
  for (const match of source.matchAll(
    /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)(['"])([^'"]+)\1\s*\)?/gu,
  )) {
    const target = match[2];
    if (target === undefined) return [];
    targets.push(target);
  }
  return targets.sort();
}

function snapshotProductionInfrastructureArtifactSources(
  value: unknown,
): ProductionInfrastructureArtifactSources | null {
  if (!isRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== PRODUCTION_INFRASTRUCTURE_ARTIFACT_KEYS.length ||
    !PRODUCTION_INFRASTRUCTURE_ARTIFACT_KEYS.every((key) => ownKeys.includes(key))
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  let totalBytes = 0;
  const snapshot: Partial<Record<keyof ProductionInfrastructureArtifactSources, string>> = {};
  for (const key of PRODUCTION_INFRASTRUCTURE_ARTIFACT_KEYS) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.length === 0
    ) {
      return null;
    }
    const bytes = Buffer.byteLength(descriptor.value, 'utf8');
    if (bytes > MAX_PRODUCTION_INFRASTRUCTURE_ARTIFACT_BYTES) return null;
    totalBytes += bytes;
    if (totalBytes > MAX_PRODUCTION_INFRASTRUCTURE_TOTAL_BYTES) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot as ProductionInfrastructureArtifactSources;
}

/**
 * Recognizes the exact, deliberately non-production environment matrix. This
 * checkpoint intentionally has no path that can brand production enablement;
 * that requires a separately reviewed production authority and cost contract.
 */
export function inspectProductionInfrastructureDeploymentArtifacts(
  value: unknown,
): ProductionInfrastructureDeploymentInput {
  const invalid = (inspected: boolean): ProductionInfrastructureDeploymentInput =>
    Object.freeze({ inspected, syntaxValid: false, environmentContract: 'INVALID' });
  try {
    const sources = snapshotProductionInfrastructureArtifactSources(value);
    if (sources === null) return invalid(false);
    const applicationEnvironment = hasExactTopLevelParameter(
      sources.applicationTemplateSource,
      'EnvironmentName',
      [
        'Type: String',
        'Default: dev',
        'MaxLength: 31',
        `AllowedPattern: ${NON_PRODUCTION_ENVIRONMENT_ALLOWED_PATTERN}`,
      ],
    );
    const workloadEnvironment = hasExactTopLevelParameter(
      sources.workloadTemplateSource,
      'EnvironmentName',
      [
        'Type: String',
        'MaxLength: 31',
        `AllowedPattern: ${NON_PRODUCTION_ENVIRONMENT_ALLOWED_PATTERN}`,
      ],
    );
    const observabilityEnvironment = hasExactTopLevelParameter(
      sources.observabilityTemplateSource,
      'EnvironmentName',
      [
        'Type: String',
        'MaxLength: 31',
        `AllowedPattern: ${NON_PRODUCTION_ENVIRONMENT_ALLOWED_PATTERN}`,
      ],
    );
    const migrationEnvironment = hasExactTopLevelParameter(
      sources.migrationTemplateSource,
      'EnvironmentName',
      [
        'Type: String',
        `AllowedPattern: ${NON_PRODUCTION_ENVIRONMENT_ALLOWED_PATTERN}`,
        'MaxLength: 31',
      ],
    );
    const guardrailParameters = yamlBlock(sources.accountGuardrailsTemplateSource, 'Parameters', 0);
    const guardrailEnvironment =
      guardrailParameters !== null &&
      hasExactTopLevelParameter(guardrailParameters, 'EnvironmentName', [
        'Type: String',
        'MaxLength: 31',
        `AllowedPattern: ${NON_PRODUCTION_ENVIRONMENT_ALLOWED_PATTERN}`,
      ]);
    const observabilityLogGroups =
      hasExactTopLevelParameter(sources.observabilityTemplateSource, 'ApiLogGroupName', [
        'Type: String',
        "AllowedPattern: '^/crypto-lending/(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*/api$'",
      ]) &&
      hasExactTopLevelParameter(sources.observabilityTemplateSource, 'WorkerLogGroupName', [
        'Type: String',
        "AllowedPattern: '^/crypto-lending/(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*/outbox-worker$'",
      ]);
    const applicationInvokerGuard =
      exactExecutableLineCount(
        sources.applicationInvokerSource,
        "if ($EnvironmentName.Length -gt 31 -or $EnvironmentName -notmatch '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$') {",
      ) === 2 &&
      exactExecutableLineCount(
        sources.applicationInvokerSource,
        "throw 'EnvironmentName must be at most 31 characters and use the template non-production pattern: dev|test|qa|sandbox|staging with optional lowercase suffix segments.'",
      ) === 2;
    const accountGuardrailsInvokerGuard =
      exactExecutableLineCount(
        sources.accountGuardrailsInvokerSource,
        "if ($EnvironmentName.Length -gt 31 -or $EnvironmentName -notmatch '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$') {",
      ) === 1 &&
      exactExecutableLineCount(
        sources.accountGuardrailsInvokerSource,
        "throw 'EnvironmentName must use dev|test|qa|sandbox|staging with optional lowercase suffix segments and be at most 31 characters.'",
      ) === 1;
    const applicationValidatorGuard =
      exactExecutableLineCount(
        sources.applicationValidatorSource,
        `"${NON_PRODUCTION_ENVIRONMENT_ALLOWED_PATTERN}",`,
      ) === 1;
    const fixedSlotGuard =
      exactExecutableLineCount(
        sources.fixedSlotTransitionValidatorSource,
        `const ENVIRONMENT_PATTERN = ${NON_PRODUCTION_ENVIRONMENT_PATTERN_SOURCE};`,
      ) === 1 &&
      exactExecutableLineCount(
        sources.fixedSlotTransitionValidatorSource,
        "errors.push('record.deployment.environmentName must be an exact non-production environment.');",
      ) === 1;
    const billingGuard =
      exactExecutableLineCount(
        sources.billingControlValidatorSource,
        `const NON_PRODUCTION_ENVIRONMENT_PATTERN = ${NON_PRODUCTION_ENVIRONMENT_PATTERN_SOURCE_NO_UNICODE};`,
      ) === 1 &&
      exactExecutableLineCount(
        sources.billingControlValidatorSource,
        "errors.push('record.environment.name must use the approved non-production pattern.');",
      ) === 1;
    const egressGuard =
      exactExecutableLineCount(
        sources.egressPolicyValidatorSource,
        `const ENVIRONMENT_PATTERN = ${NON_PRODUCTION_ENVIRONMENT_PATTERN_SOURCE_NO_UNICODE};`,
      ) === 1 &&
      exactExecutableLineCount(
        sources.egressPolicyValidatorSource,
        "'policy.environment.name must identify an explicit non-production environment.',",
      ) === 1;
    const futureTransitionValidatorsRemainProductionAware =
      exactExecutableLineCount(
        sources.authWalletTransitionValidatorSource,
        `const ENVIRONMENT_PATTERN = ${PRODUCTION_AWARE_ENVIRONMENT_PATTERN_SOURCE};`,
      ) === 1 &&
      exactExecutableLineCount(
        sources.redisOperatorTransitionValidatorSource,
        `const ENVIRONMENT_PATTERN = ${PRODUCTION_AWARE_ENVIRONMENT_PATTERN_SOURCE};`,
      ) === 1;
    const syntaxValid =
      applicationEnvironment &&
      workloadEnvironment &&
      observabilityEnvironment &&
      migrationEnvironment &&
      guardrailEnvironment &&
      observabilityLogGroups &&
      applicationInvokerGuard &&
      accountGuardrailsInvokerGuard &&
      applicationValidatorGuard &&
      fixedSlotGuard &&
      billingGuard &&
      egressGuard &&
      futureTransitionValidatorsRemainProductionAware;
    if (!syntaxValid) return invalid(true);
    const result: ProductionInfrastructureDeploymentInput = Object.freeze({
      inspected: true,
      syntaxValid: true,
      environmentContract: 'NON_PRODUCTION_ONLY',
    });
    VERIFIED_PRODUCTION_INFRASTRUCTURE_DEPLOYMENTS.add(result);
    return result;
  } catch {
    return invalid(false);
  }
}

function snapshotProviderPositionReadBoundaryArtifactSources(
  value: unknown,
): ProviderPositionReadBoundaryArtifactSources | null {
  if (!isRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== PROVIDER_POSITION_READ_ARTIFACT_KEYS.length ||
    !PROVIDER_POSITION_READ_ARTIFACT_KEYS.every((key) => ownKeys.includes(key))
  ) {
    return null;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  let totalBytes = 0;
  const snapshot: Partial<Record<keyof ProviderPositionReadBoundaryArtifactSources, string>> = {};
  for (const key of PROVIDER_POSITION_READ_ARTIFACT_KEYS) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.length === 0
    ) {
      return null;
    }
    const bytes = Buffer.byteLength(descriptor.value, 'utf8');
    if (bytes > MAX_PROVIDER_POSITION_READ_ARTIFACT_BYTES) return null;
    totalBytes += bytes;
    if (totalBytes > MAX_PROVIDER_POSITION_READ_TOTAL_BYTES) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot as ProviderPositionReadBoundaryArtifactSources;
}

function hasExactReviewedProviderPositionReadArtifactBytes(
  sources: ProviderPositionReadBoundaryArtifactSources,
): boolean {
  return PROVIDER_POSITION_READ_ARTIFACT_KEYS.every(
    (key) =>
      createHash('sha256').update(sources[key], 'utf8').digest('hex') ===
      REVIEWED_PROVIDER_POSITION_READ_ARTIFACT_SHA256[key],
  );
}

function hasDormantProviderPositionReadBoundaryContract(
  sources: ProviderPositionReadBoundaryArtifactSources,
): boolean {
  const reader = sources.providerPositionReaderPortSource.replace(/\r\n/gu, '\n');
  const assemblyPort = sources.providerPositionTrustedAssemblyPortSource.replace(/\r\n/gu, '\n');
  const coordinator = sources.providerPositionAdmissionCoordinatorSource.replace(/\r\n/gu, '\n');
  const deadlineRunner = sources.providerPositionDeadlineRunnerSource.replace(/\r\n/gu, '\n');
  const runtimeBounds = sources.providerPositionRuntimeBoundsSource.replace(/\r\n/gu, '\n');
  const runtimeComposition = sources.providerPositionRuntimeCompositionSource.replace(
    /\r\n/gu,
    '\n',
  );
  const infrastructureConfig = sources.providerPositionInfrastructureConfigSource.replace(
    /\r\n/gu,
    '\n',
  );
  const runtimePostgresPool = sources.providerPositionRuntimePostgresPoolSource.replace(
    /\r\n/gu,
    '\n',
  );
  const portfolioWalletReaderPort =
    sources.portfolioWalletRegistrationReaderPortSource.replace(/\r\n/gu, '\n');
  const registeredWalletReader = sources.registeredPortfolioWalletReaderSource.replace(
    /\r\n/gu,
    '\n',
  );
  const walletRegistrationService = sources.walletRegistrationServiceSource.replace(
    /\r\n/gu,
    '\n',
  );
  const walletRegistrationRepositoryPort =
    sources.walletRegistrationRepositoryPortSource.replace(/\r\n/gu, '\n');
  const postgresWalletRegistrationRepository =
    sources.postgresWalletRegistrationRepositorySource.replace(/\r\n/gu, '\n');
  const providerPositionPostgresService = sources.providerPositionPostgresServiceSource.replace(
    /\r\n/gu,
    '\n',
  );
  const coverage = sources.providerPositionCoverageSource.replace(/\r\n/gu, '\n');
  const observation = sources.providerPositionObservationSource.replace(/\r\n/gu, '\n');
  const chainAssessment = sources.providerPositionChainAssessmentSource.replace(/\r\n/gu, '\n');
  const policy = sources.providerPositionObservationPolicySource.replace(/\r\n/gu, '\n');
  const moduleSource = sources.mainnetPlatformsModuleSource.replace(/\r\n/gu, '\n');
  const indexSource = sources.mainnetPlatformsIndexSource.replace(/\r\n/gu, '\n');
  const controller = sources.mainnetPlatformsControllerSource.replace(/\r\n/gu, '\n');
  const capabilityFreeSources = [
    reader,
    assemblyPort,
    coordinator,
    coverage,
    observation,
    chainAssessment,
    policy,
  ] as const;
  const walletRosterCancellationBridgeSources = [
    portfolioWalletReaderPort,
    registeredWalletReader,
    walletRegistrationService,
    walletRegistrationRepositoryPort,
    postgresWalletRegistrationRepository,
  ] as const;
  const forbiddenCapability =
    /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"](?:node:)?(?:dns|http|http2|https|net|tls)(?:\/[^'"]*)?['"]|(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"](?:axios|ethers|got|superagent|undici|web3|@solana\/web3\.js)['"]|\b(?:fetch|setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(|\b(?:process|Deno|Bun)\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|\bnew\s+(?:URL|URLSearchParams|WebSocket|EventSource|Connection|[A-Za-z0-9_]*Client|[A-Za-z0-9_]*Agent)\s*\(|['"]https?:\/\//iu;
  const deadlineRunnerImportSources = Array.from(
    deadlineRunner.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu),
    (match) => match[1],
  );
  const deadlineRunnerImportDeclarationCount =
    deadlineRunner.match(/^[\t ]*import\b/gmu)?.length ?? 0;
  const deadlineRunnerGlobalMembers = Array.from(
    deadlineRunner.matchAll(/\bglobalThis\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/gu),
    (match) => match[1],
  );
  const forbiddenDeadlineRunnerCapability =
    /(?:\bimport\s*\(|\brequire\s*\(|\b(?:fetch|setInterval|setImmediate|queueMicrotask|WebSocket|EventSource|XMLHttpRequest)\s*\(|\b(?:process|Deno|Bun)\b|\bimport\s*\.\s*meta\s*\.\s*env\b|['"]https?:\/\/|(?:^|\n)[\t ]*@[A-Za-z_$])/iu;
  const runtimeBoundsImportSources = Array.from(
    runtimeBounds.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu),
    (match) => match[1],
  );
  const runtimeBoundsImportDeclarationCount =
    runtimeBounds.match(/^[\t ]*import\b/gmu)?.length ?? 0;
  const forbiddenRuntimeBoundsCapability =
    /(?:\bimport\s*\(|\brequire\s*\(|\b(?:fetch|setTimeout|setInterval|setImmediate|queueMicrotask|WebSocket|EventSource|XMLHttpRequest|readFileSync|writeFileSync)\s*\(|\.\s*(?:query|connect|end)\s*\(|\bconsole\s*\.|\b(?:process|Deno|Bun)\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|['"]https?:\/\/|(?:^|\n)[\t ]*@[A-Za-z_$]|\b(?:callback|factory)\s*\(|\bReflect\s*\.\s*apply\s*\()/iu;
  const runtimeCompositionImportSources = Array.from(
    runtimeComposition.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu),
    (match) => match[1],
  );
  const runtimeCompositionImportDeclarationCount =
    runtimeComposition.match(/^[\t ]*import\b/gmu)?.length ?? 0;
  const forbiddenRuntimeCompositionCapability =
    /(?:\bimport\s*\(|\brequire\s*\(|(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"](?:node:)?(?:child_process|cluster|dgram|dns|fs|http|http2|https|net|tls|worker_threads)(?:\/[^'"]*)?['"]|(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"](?:axios|ethers|got|superagent|undici|web3|@solana\/web3\.js)['"]|\b(?:fetch|setTimeout|setInterval|setImmediate|queueMicrotask|WebSocket|EventSource|XMLHttpRequest|readFileSync|writeFileSync)\s*\(|\.\s*(?:query|connect|healthCheck)\s*\(|\b(?:process|Deno|Bun)\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|['"]https?:\/\/|(?:^|\n)[\t ]*@[A-Za-z_$]|\b(?:NestFactory|loadInfrastructureConfig|createPostgresPool|POSTGRES_POOL)\b)/iu;
  const runtimeBoundsPostgresSnapshot = runtimeBounds.indexOf(
    'const postgresPoolConfig = postgresConfigSnapshot(postgresConfigInput);',
  );
  const runtimeBoundsAdmissionSnapshot = runtimeBounds.indexOf(
    'const admissionOptions = admissionOptionsSnapshot(admissionOptionsInput);',
    runtimeBoundsPostgresSnapshot,
  );
  const runtimeBoundsRelation = runtimeBounds.indexOf(
    'if (postgresPoolConfig.database.connectionTimeoutMs > admissionOptions.deadlineMilliseconds) {',
    runtimeBoundsAdmissionSnapshot,
  );
  const runtimeBoundsPoolDeclaration = runtimeBounds.indexOf('let pool: Pool;', runtimeBoundsRelation);
  const runtimeBoundsPoolConstruction = runtimeBounds.indexOf(
    'pool = createPostgresPool(postgresPoolConfig);',
    runtimeBoundsPoolDeclaration,
  );
  const runtimeBoundsConstructionFailure = runtimeBounds.indexOf(
    "return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_CONSTRUCTION_FAILED');",
    runtimeBoundsPoolConstruction,
  );
  const runtimeBoundsResourceReturn = runtimeBounds.indexOf(
    'Object.assign(Object.create(null) as DormantProviderPositionAdmissionRuntimeResource, {',
    runtimeBoundsConstructionFailure,
  );
  const compositionResourceConstruction = runtimeComposition.indexOf(
    'runtimeResource = createDormantProviderPositionAdmissionRuntimeResource(',
  );
  const compositionResourcePostgresConfig = runtimeComposition.indexOf(
    'dependencies.postgresConfig,',
    compositionResourceConstruction,
  );
  const compositionResourceAdmissionInput = runtimeComposition.indexOf(
    'dependencies.admissionOptions,',
    compositionResourcePostgresConfig,
  );
  const compositionPoolCapture = runtimeComposition.indexOf(
    'const pool: Pool = runtimeResource.pool;',
    compositionResourceAdmissionInput,
  );
  const compositionPoolEndCapture = runtimeComposition.indexOf(
    "endPool = capturePromiseMethod(pool, 'end');",
    compositionPoolCapture,
  );
  const compositionPostgresConstruction = runtimeComposition.indexOf(
    'const postgres = new PostgresService(pool);',
    compositionPoolEndCapture,
  );
  const compositionPostgresCloseCapture = runtimeComposition.indexOf(
    "closePostgres = capturePromiseMethod(postgres, 'closeCancellableQueries');",
    compositionPostgresConstruction,
  );
  const compositionWalletRepositoryConstruction = runtimeComposition.indexOf(
    'const walletRepository = new PostgresWalletRegistrationRepository(postgres);',
    compositionPostgresCloseCapture,
  );
  const compositionWalletServiceConstruction = runtimeComposition.indexOf(
    'const walletService = new WalletRegistrationService(',
    compositionWalletRepositoryConstruction,
  );
  const compositionWalletServiceRepository = runtimeComposition.indexOf(
    'walletRepository,',
    compositionWalletServiceConstruction,
  );
  const compositionWalletServiceConfig = runtimeComposition.indexOf(
    'dependencies.walletRegistrationConfig,',
    compositionWalletServiceRepository,
  );
  const compositionWalletServiceClock = runtimeComposition.indexOf(
    'dependencies.clock,',
    compositionWalletServiceConfig,
  );
  const compositionWalletReaderConstruction = runtimeComposition.indexOf(
    'const walletReader = new RegisteredPortfolioWalletReader(walletService);',
    compositionWalletServiceClock,
  );
  const compositionDeadlineRunnerConstruction = runtimeComposition.indexOf(
    'const deadlineRunner = new NodeProviderPositionAdmissionDeadlineRunner(dependencies.clock);',
    compositionWalletReaderConstruction,
  );
  const compositionCoordinatorConstruction = runtimeComposition.indexOf(
    'const coordinator = new DormantProviderPositionAdmissionCoordinator(',
    compositionDeadlineRunnerConstruction,
  );
  const compositionCoordinatorPolicy = runtimeComposition.indexOf(
    'dependencies.policyInput,',
    compositionCoordinatorConstruction,
  );
  const compositionCoordinatorFingerprint = runtimeComposition.indexOf(
    'dependencies.requiredPolicyFingerprintSha256,',
    compositionCoordinatorPolicy,
  );
  const compositionCoordinatorSources = runtimeComposition.indexOf(
    'dependencies.sourceBindings,',
    compositionCoordinatorFingerprint,
  );
  const compositionCoordinatorWalletReader = runtimeComposition.indexOf(
    'walletReader,',
    compositionCoordinatorSources,
  );
  const compositionCoordinatorClock = runtimeComposition.indexOf(
    'dependencies.clock,',
    compositionCoordinatorWalletReader,
  );
  const compositionCoordinatorDeadlineRunner = runtimeComposition.indexOf(
    'deadlineRunner,',
    compositionCoordinatorClock,
  );
  const compositionCoordinatorReviewedOptions = runtimeComposition.indexOf(
    'runtimeResource.admissionOptions,',
    compositionCoordinatorDeadlineRunner,
  );
  const compositionCoordinatorAssembly = runtimeComposition.indexOf(
    'dependencies.trustedChainAssessmentAssembly,',
    compositionCoordinatorReviewedOptions,
  );
  const compositionFacadeReturn = runtimeComposition.indexOf(
    'return admissionFacade(coordinator, { closePostgres, endPool });',
    compositionCoordinatorAssembly,
  );
  const compositionRollbackHelper = runtimeComposition.indexOf(
    'async function closeOwnedRuntime(',
  );
  const compositionRollbackPostgres = runtimeComposition.indexOf(
    'await Promise.allSettled([handles.closePostgres()]);',
    compositionRollbackHelper,
  );
  const compositionRollbackPool = runtimeComposition.indexOf(
    'await Promise.allSettled([handles.endPool()]);',
    compositionRollbackPostgres,
  );
  const compositionConstructionRollback = runtimeComposition.indexOf(
    'await closeOwnedRuntime({ closePostgres, endPool });',
    compositionFacadeReturn,
  );
  const compositionConstructionFailure = runtimeComposition.indexOf(
    "return fail('PROVIDER_POSITION_ADMISSION_COMPOSITION_CONSTRUCTION_FAILED');",
    compositionConstructionRollback,
  );
  const compositionFacadeClose = runtimeComposition.indexOf('const close = (): Promise<void> => {');
  const compositionCloseMemo = runtimeComposition.indexOf(
    'if (closePromise !== undefined) return closePromise;',
    compositionFacadeClose,
  );
  const compositionCloseAdmissionSeal = runtimeComposition.indexOf(
    'closed = true;',
    compositionCloseMemo,
  );
  const compositionCloseOperationSnapshot = runtimeComposition.indexOf(
    'const operationGates = [...operations];',
    compositionCloseAdmissionSeal,
  );
  const compositionCloseCoordinatorAbort = runtimeComposition.indexOf(
    'Reflect.apply(closeAdmission, coordinator, []);',
    compositionCloseOperationSnapshot,
  );
  const compositionClosePostgresDrain = runtimeComposition.indexOf(
    'postgresDrain = handles.closePostgres();',
    compositionCloseCoordinatorAbort,
  );
  const compositionCloseAdmittedDrain = runtimeComposition.indexOf(
    'Promise.allSettled([postgresDrain, ...operationGates])',
    compositionClosePostgresDrain,
  );
  const compositionClosePoolEnd = runtimeComposition.indexOf(
    'await Promise.allSettled([handles.endPool()]);',
    compositionCloseAdmittedDrain,
  );
  const compositionCloseFailureGate = runtimeComposition.indexOf(
    'admissionCloseFailed ||',
    compositionClosePoolEnd,
  );
  const coordinatorActiveControllerSet = coordinator.indexOf(
    'private readonly activeAdmissionControllers = new Set<AbortController>();',
  );
  const coordinatorAdmissionOpen = coordinator.indexOf(
    'private admissionOpen = true;',
    coordinatorActiveControllerSet,
  );
  const coordinatorCloseAdmission = coordinator.indexOf(
    'closeAdmission(): void {',
    coordinatorAdmissionOpen,
  );
  const coordinatorCloseAdmissionSeal = coordinator.indexOf(
    'this.admissionOpen = false;',
    coordinatorCloseAdmission,
  );
  const coordinatorCloseAbortFailureState = coordinator.indexOf(
    'let failed = false;',
    coordinatorCloseAdmissionSeal,
  );
  const coordinatorCloseControllerSnapshot = coordinator.indexOf(
    'for (const controller of [...this.activeAdmissionControllers]) {',
    coordinatorCloseAbortFailureState,
  );
  const coordinatorCloseControllerAbort = coordinator.indexOf(
    'if (!controller.signal.aborted) controller.abort();',
    coordinatorCloseControllerSnapshot,
  );
  const coordinatorCloseAbortCatch = coordinator.indexOf('} catch {', coordinatorCloseControllerAbort);
  const coordinatorCloseAbortFailure = coordinator.indexOf(
    'failed = true;',
    coordinatorCloseAbortCatch,
  );
  const coordinatorCloseFailClosed = coordinator.indexOf(
    "if (failed) return fail('SOURCE_UNAVAILABLE');",
    coordinatorCloseAbortFailure,
  );
  const coordinatorAdmissionOpenCheck = coordinator.indexOf(
    "if (!this.admissionOpen) return fail('SOURCE_UNAVAILABLE');",
    coordinatorCloseFailClosed,
  );
  const coordinatorControllerConstruction = coordinator.indexOf(
    'controller = new AbortController();',
    coordinatorAdmissionOpenCheck,
  );
  const coordinatorControllerAdd = coordinator.indexOf(
    'this.activeAdmissionControllers.add(activeController);',
    coordinatorControllerConstruction,
  );
  const coordinatorControllerAbort = coordinator.indexOf(
    'if (activeController.signal.aborted === false) activeController.abort();',
    coordinatorControllerAdd,
  );
  const coordinatorControllerDelete = coordinator.indexOf(
    'this.activeAdmissionControllers.delete(activeController);',
    coordinatorControllerAbort,
  );
  const coordinatorCapturedSources = coordinator.indexOf(
    'const capturedSources = new Map<object, ProviderPositionAdmissionSourcePort>();',
  );
  const coordinatorSourceIdentity = coordinator.indexOf(
    'const sourceIdentity = record.source;',
    coordinatorCapturedSources,
  );
  const coordinatorSourceProxyRejection = coordinator.indexOf(
    'isProxy(sourceIdentity)',
    coordinatorSourceIdentity,
  );
  const coordinatorSourceReceiver = coordinator.indexOf(
    'const sourceReceiver = sourceIdentity as object;',
    coordinatorSourceProxyRejection,
  );
  const coordinatorSourceReuse = coordinator.indexOf(
    'let source = capturedSources.get(sourceReceiver);',
    coordinatorSourceReceiver,
  );
  const coordinatorSourceMethodCapture = coordinator.indexOf(
    "const readTarget = stableDataMember(sourceReceiver, 'readTarget');",
    coordinatorSourceReuse,
  );
  const coordinatorSourceWrapper = coordinator.indexOf(
    'Reflect.apply(readTarget, sourceReceiver, [request]) as Promise<unknown>',
    coordinatorSourceMethodCapture,
  );
  const coordinatorSourceStore = coordinator.indexOf(
    'capturedSources.set(sourceReceiver, source);',
    coordinatorSourceWrapper,
  );
  const runnerOperationAwait = deadlineRunner.indexOf(
    'const outcome: OperationOutcome<T> = await Promise.resolve()',
  );
  const runnerFailureAbort = deadlineRunner.indexOf(
    "if (!outcome.ok && cause === null) abortWith('OPERATION_FAILED');",
    runnerOperationAwait,
  );
  const runnerCompletionClock = deadlineRunner.indexOf(
    'const completedAt = this.tryClockMilliseconds();',
    runnerFailureAbort,
  );
  const runnerFinally = deadlineRunner.indexOf('} finally {', runnerCompletionClock);
  const runnerTimerCleanup = deadlineRunner.indexOf('this.cancelTimer(timer);', runnerFinally);
  const runnerListenerCleanup = deadlineRunner.indexOf(
    'request.signal.remove(onAbort);',
    runnerTimerCleanup,
  );
  const runnerCleanupFailure = deadlineRunner.indexOf(
    'if (cleanupFailed) {',
    runnerListenerCleanup,
  );
  const runnerCleanupFailureResult = deadlineRunner.indexOf(
    "fail('RUNTIME_UNAVAILABLE');",
    runnerCleanupFailure,
  );
  const coordinatorRosterRead = coordinator.indexOf(
    'const roster = await this.walletReader.readActiveWalletRegistrations({',
  );
  const coordinatorRosterAccount = coordinator.indexOf(
    'accountId: request.accountId,',
    coordinatorRosterRead,
  );
  const coordinatorRosterEvaluation = coordinator.indexOf(
    'evaluatedAt: started.timestamp,',
    coordinatorRosterAccount,
  );
  const coordinatorRosterCorrelation = coordinator.indexOf(
    'correlationId: request.correlationId,',
    coordinatorRosterEvaluation,
  );
  const coordinatorRosterSignal = coordinator.indexOf(
    'signal: activeController.signal,',
    coordinatorRosterCorrelation,
  );
  const registeredSignalCapture = registeredWalletReader.indexOf(
    'const signal = request.signal;',
  );
  const registeredLegacyBranch = registeredWalletReader.indexOf(
    'signal === undefined',
    registeredSignalCapture,
  );
  const registeredLegacyRead = registeredWalletReader.indexOf(
    '? await this.wallets.listActiveWallets(request.accountId)',
    registeredLegacyBranch,
  );
  const registeredSignaledRead = registeredWalletReader.indexOf(
    ': await this.wallets.listActiveWallets(',
    registeredLegacyRead,
  );
  const registeredSignaledAccount = registeredWalletReader.indexOf(
    'request.accountId,',
    registeredSignaledRead,
  );
  const registeredSignaledSignal = registeredWalletReader.indexOf(
    'Object.freeze({ signal }),',
    registeredSignaledAccount,
  );
  const walletServiceList = walletRegistrationService.indexOf('async listActiveWallets(');
  const walletServiceAccountParse = walletRegistrationService.indexOf(
    'accountId = parseAccountId(accountIdInput);',
    walletServiceList,
  );
  const walletServiceRepositoryRead = walletRegistrationService.indexOf(
    'records = await this.repository.listActiveWallets(',
    walletServiceAccountParse,
  );
  const walletServiceForwarding = walletRegistrationService.indexOf(
    'options === undefined ? { accountId } : { accountId, signal: options.signal },',
    walletServiceRepositoryRead,
  );
  const postgresWalletRead = postgresWalletRegistrationRepository.indexOf(
    'async listActiveWallets(',
  );
  const postgresWalletAccountParse = postgresWalletRegistrationRepository.indexOf(
    'const accountId = parseAccountId(request.accountId);',
    postgresWalletRead,
  );
  const postgresWalletSignalCapture = postgresWalletRegistrationRepository.indexOf(
    'const signal = request.signal;',
    postgresWalletAccountParse,
  );
  const postgresWalletValues = postgresWalletRegistrationRepository.indexOf(
    'const values = [accountId];',
    postgresWalletSignalCapture,
  );
  const postgresWalletLegacyQuery = postgresWalletRegistrationRepository.indexOf(
    '? await this.postgres.query<ActiveWalletRow>(query, values)',
    postgresWalletValues,
  );
  const postgresWalletCancellableQuery = postgresWalletRegistrationRepository.indexOf(
    ': await this.postgres.queryWithCancellation<ActiveWalletRow>(',
    postgresWalletLegacyQuery,
  );
  const postgresWalletCancellableSignal = postgresWalletRegistrationRepository.indexOf(
    'signal,',
    postgresWalletCancellableQuery,
  );
  const postgresWalletReturnedIdentity = postgresWalletRegistrationRepository.indexOf(
    'if (returnedAccountId !== accountId) throw new WalletRegistrationPersistenceError();',
    postgresWalletCancellableSignal,
  );
  const postgresCancellationEntry = providerPositionPostgresService.indexOf(
    'queryWithCancellation<Row extends QueryResultRow = QueryResultRow>(',
  );
  const postgresSignalReview = providerPositionPostgresService.indexOf(
    'if (reviewAbortSignal(signal) === null) {',
    postgresCancellationEntry,
  );
  const postgresCancellationExecution = providerPositionPostgresService.indexOf(
    'this.executeCancellableQuery<Row>(queryTextOrConfig, values, signal),',
    postgresSignalReview,
  );
  const postgresClientAcquisition = providerPositionPostgresService.indexOf(
    'client = await this.pool.connect();',
    postgresCancellationExecution,
  );
  const postgresPostAcquisitionCancellation = providerPositionPostgresService.indexOf(
    'if (cancellation !== null || supplied.aborted() || lifecycle.aborted()) {',
    postgresClientAcquisition,
  );
  const postgresQuerySettlement = providerPositionPostgresService.indexOf(
    'const querySettlement = Promise.resolve()',
    postgresPostAcquisitionCancellation,
  );
  const postgresQueryDrain = providerPositionPostgresService.indexOf(
    'const outcome = await querySettlement;',
    postgresQuerySettlement,
  );
  const postgresTeardownDrain = providerPositionPostgresService.indexOf(
    'const teardownFailure = (await Promise.allSettled([querySettlement, teardown])).find(',
    postgresQueryDrain,
  );
  const postgresCancellationFinally = providerPositionPostgresService.indexOf(
    '} finally {',
    postgresTeardownDrain,
  );
  const postgresCancellationTimerCleanup = providerPositionPostgresService.indexOf(
    'clearTimeout(timeout);',
    postgresCancellationFinally,
  );
  const postgresCancellationListenerCleanup = providerPositionPostgresService.indexOf(
    'supplied.remove(cancelFromSignal);',
    postgresCancellationTimerCleanup,
  );
  const selectedTargetLoop = coordinator.indexOf('for (const target of candidate.targets) {');
  const selectedSource = coordinator.indexOf(
    'const selectedSource = target.acceptedSources[0];',
    selectedTargetLoop,
  );
  const selectedTargetPush = coordinator.indexOf('selectedTargetSources.push(', selectedSource);
  const positionLoop = coordinator.indexOf(
    'for (const position of target.positions) {',
    selectedTargetPush,
  );
  const forbiddenRuntimeIdentity =
    /\b(?:MAINNET_PROVIDER_POSITION_READER|DormantProviderPositionAdmissionCoordinator|ProviderPositionTrustedChainAssessmentAssemblyPort|NodeProviderPositionAdmissionDeadlineRunner|createDormantProviderPositionAdmissionRuntimeResource|DormantProviderPositionAdmissionRuntimeResource|ProviderPositionAdmissionRuntimeBoundsError|createDormantProviderPositionAdmissionRuntimeComposition|DormantProviderPositionAdmissionRuntimeComposition|ProviderPositionAdmissionRuntimeCompositionError|PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE)\b/u;
  const forbiddenBarrelImplementation =
    /(?:DormantProviderPositionAdmissionCoordinator|ProviderPositionTrustedChainAssessmentAssemblyPort|NodeProviderPositionAdmissionDeadlineRunner|createDormantProviderPositionAdmissionRuntimeResource|createDormantProviderPositionAdmissionRuntimeComposition|provider-position-admission\.coordinator|provider-position-trusted-chain-assessment-assembly\.port|node-provider-position-admission-deadline\.runner|provider-position-admission-runtime-bounds|provider-position-admission-runtime\.composition)/u;
  const forbiddenCoordinatorRuntimeBoundsConsumption =
    /(?:createDormantProviderPositionAdmissionRuntimeResource|provider-position-admission-runtime-bounds)/u;

  return (
    capabilityFreeSources.every((source) => !forbiddenCapability.test(source)) &&
    runtimeCompositionImportDeclarationCount === 13 &&
    runtimeCompositionImportSources.length === 13 &&
    runtimeCompositionImportSources[0] === 'node:util/types' &&
    runtimeCompositionImportSources[1] === 'pg' &&
    runtimeCompositionImportSources[2] ===
      '../../portfolio/infrastructure/registered-portfolio-wallet-reader' &&
    runtimeCompositionImportSources[3] ===
      '../../wallets/application/wallet-registration.service' &&
    runtimeCompositionImportSources[4] ===
      '../../wallets/infrastructure/crypto/wallet-registration-crypto' &&
    runtimeCompositionImportSources[5] ===
      '../../wallets/infrastructure/config/wallet-registration.config' &&
    runtimeCompositionImportSources[6] ===
      '../../wallets/infrastructure/postgres/postgres-wallet-registration.repository' &&
    runtimeCompositionImportSources[7] === '../../infrastructure/database/postgres.service' &&
    runtimeCompositionImportSources[8] ===
      '../../infrastructure/database/runtime-postgres-pool' &&
    runtimeCompositionImportSources[9] ===
      '../application/provider-position-admission.coordinator' &&
    runtimeCompositionImportSources[10] ===
      '../application/ports/provider-position-trusted-chain-assessment-assembly.port' &&
    runtimeCompositionImportSources[11] ===
      './node-provider-position-admission-deadline.runner' &&
    runtimeCompositionImportSources[12] === './provider-position-admission-runtime-bounds' &&
    !forbiddenRuntimeCompositionCapability.test(runtimeComposition) &&
    !runtimeComposition.includes('Promise.race') &&
    runtimeBoundsImportDeclarationCount === 5 &&
    runtimeBoundsImportSources.length === 5 &&
    runtimeBoundsImportSources[0] === 'pg' &&
    runtimeBoundsImportSources[1] === 'node:util/types' &&
    runtimeBoundsImportSources[2] === '../../infrastructure/config/infrastructure.config' &&
    runtimeBoundsImportSources[3] === '../../infrastructure/database/runtime-postgres-pool' &&
    runtimeBoundsImportSources[4] ===
      '../application/provider-position-admission.coordinator' &&
    !forbiddenRuntimeBoundsCapability.test(runtimeBounds) &&
    exactExecutableLineCount(
      runtimeBounds,
      'export const PROVIDER_POSITION_ADMISSION_MAX_DEADLINE_MILLISECONDS = 30_000 as const;',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'export const PROVIDER_POSITION_ADMISSION_MAX_CONCURRENCY = 8 as const;',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'PROVIDER_POSITION_ADMISSION_MAX_DEADLINE_MILLISECONDS,',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'PROVIDER_POSITION_ADMISSION_MAX_CONCURRENCY,',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      "const API_DATABASE_SESSION_ROLE = 'crypto_api_runtime' as const;",
    ) === 1 &&
    exactExecutableLineCount(runtimeBounds, "if (record.workload !== 'api') {") === 1 &&
    exactExecutableLineCount(runtimeBounds, 'connectionTimeoutMs: 60_000,') === 1 &&
    exactExecutableLineCount(runtimeBounds, 'idleTimeoutMs: 600_000,') === 1 &&
    exactExecutableLineCount(runtimeBounds, 'lockTimeoutMs: 60_000,') === 1 &&
    exactExecutableLineCount(runtimeBounds, 'maxLifetimeSeconds: 86_400,') === 1 &&
    exactExecutableLineCount(runtimeBounds, 'poolMax: 100,') === 1 &&
    exactExecutableLineCount(runtimeBounds, 'statementTimeoutMs: 300_000,') === 1 &&
    exactExecutableLineCount(runtimeBounds, "value.includes('?') ||") === 1 &&
    exactExecutableLineCount(runtimeBounds, "value.includes('#')") === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'if (!loopback && (snapshot.rejectUnauthorized !== true || snapshot.ca === undefined)) {',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'if (typeof value !== \'object\' || value === null || Array.isArray(value) || isProxy(value)) {',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'if (record.sessionRole !== API_DATABASE_SESSION_ROLE) {',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'Object.assign(Object.create(null) as { rejectUnauthorized: boolean; ca?: string }, {',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'Object.assign(Object.create(null) as DatabaseInfrastructureConfig, {',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'Object.assign(Object.create(null) as RuntimePostgresPoolConfig, {',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'Object.assign(Object.create(null) as ProviderPositionAdmissionOptions, {',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'Object.assign(Object.create(null) as DormantProviderPositionAdmissionRuntimeResource, {',
    ) === 1 &&
    exactExecutableLineCount(runtimeBounds, 'return Object.freeze(') === 4 &&
    exactExecutableLineCount(runtimeBounds, 'const snapshot = Object.freeze(') === 1 &&
    exactExecutableLineCount(runtimeBounds, 'database: databaseSnapshot(record.database),') === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'if (postgresPoolConfig.database.connectionTimeoutMs > admissionOptions.deadlineMilliseconds) {',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      'pool = createPostgresPool(postgresPoolConfig);',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeBounds,
      "return fail('PROVIDER_POSITION_ADMISSION_RUNTIME_CONSTRUCTION_FAILED');",
    ) === 1 &&
    exactExecutableLineCount(runtimeBounds, 'pool,') === 1 &&
    exactExecutableLineCount(runtimeBounds, 'admissionOptions,') === 1 &&
    !runtimeBounds.includes('createPostgresPool(postgresConfigInput)') &&
    !runtimeBounds.includes('database: record.database') &&
    !runtimeBounds.includes('admissionOptions: admissionOptionsInput') &&
    runtimeBoundsPostgresSnapshot >= 0 &&
    runtimeBoundsAdmissionSnapshot > runtimeBoundsPostgresSnapshot &&
    runtimeBoundsRelation > runtimeBoundsAdmissionSnapshot &&
    runtimeBoundsPoolDeclaration > runtimeBoundsRelation &&
    runtimeBoundsPoolConstruction > runtimeBoundsPoolDeclaration &&
    runtimeBoundsConstructionFailure > runtimeBoundsPoolConstruction &&
    runtimeBoundsResourceReturn > runtimeBoundsConstructionFailure &&
    compositionResourceConstruction >= 0 &&
    compositionResourcePostgresConfig > compositionResourceConstruction &&
    compositionResourceAdmissionInput > compositionResourcePostgresConfig &&
    compositionPoolCapture > compositionResourceAdmissionInput &&
    compositionPoolEndCapture > compositionPoolCapture &&
    compositionPostgresConstruction > compositionPoolEndCapture &&
    compositionPostgresCloseCapture > compositionPostgresConstruction &&
    compositionWalletRepositoryConstruction > compositionPostgresCloseCapture &&
    compositionWalletServiceConstruction > compositionWalletRepositoryConstruction &&
    compositionWalletServiceRepository > compositionWalletServiceConstruction &&
    compositionWalletServiceConfig > compositionWalletServiceRepository &&
    compositionWalletServiceClock > compositionWalletServiceConfig &&
    compositionWalletReaderConstruction > compositionWalletServiceClock &&
    compositionDeadlineRunnerConstruction > compositionWalletReaderConstruction &&
    compositionCoordinatorConstruction > compositionDeadlineRunnerConstruction &&
    compositionCoordinatorPolicy > compositionCoordinatorConstruction &&
    compositionCoordinatorFingerprint > compositionCoordinatorPolicy &&
    compositionCoordinatorSources > compositionCoordinatorFingerprint &&
    compositionCoordinatorWalletReader > compositionCoordinatorSources &&
    compositionCoordinatorClock > compositionCoordinatorWalletReader &&
    compositionCoordinatorDeadlineRunner > compositionCoordinatorClock &&
    compositionCoordinatorReviewedOptions > compositionCoordinatorDeadlineRunner &&
    compositionCoordinatorAssembly > compositionCoordinatorReviewedOptions &&
    compositionFacadeReturn > compositionCoordinatorAssembly &&
    exactExecutableLineCount(
      runtimeComposition,
      'const pool: Pool = runtimeResource.pool;',
    ) === 1 &&
    exactExecutableLineCount(runtimeComposition, 'const postgres = new PostgresService(pool);') ===
      1 &&
    exactExecutableLineCount(
      runtimeComposition,
      'const walletRepository = new PostgresWalletRegistrationRepository(postgres);',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeComposition,
      'const walletReader = new RegisteredPortfolioWalletReader(walletService);',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeComposition,
      'const deadlineRunner = new NodeProviderPositionAdmissionDeadlineRunner(dependencies.clock);',
    ) === 1 &&
    exactExecutableLineCount(runtimeComposition, 'runtimeResource.admissionOptions,') === 1 &&
    exactExecutableLineCount(runtimeComposition, 'if (isProxy(current)) return undefined;') === 1 &&
    exactExecutableLineCount(
      runtimeComposition,
      "if (typeof now !== 'function' || isProxy(now)) {",
    ) === 1 &&
    exactExecutableLineCount(
      runtimeComposition,
      "if (typeof method !== 'function' || isProxy(method)) {",
    ) === 1 &&
    exactExecutableLineCount(runtimeComposition, 'isProxy(admit) ||') === 1 &&
    exactExecutableLineCount(runtimeComposition, 'isProxy(admitAndAssemble) ||') === 1 &&
    exactExecutableLineCount(runtimeComposition, 'isProxy(closeAdmission)') === 1 &&
    !runtimeComposition.includes('return runtimeResource') &&
    !runtimeComposition.includes('return pool') &&
    compositionRollbackHelper >= 0 &&
    compositionRollbackPostgres > compositionRollbackHelper &&
    compositionRollbackPool > compositionRollbackPostgres &&
    compositionConstructionRollback > compositionFacadeReturn &&
    compositionConstructionFailure > compositionConstructionRollback &&
    compositionFacadeClose >= 0 &&
    compositionCloseMemo > compositionFacadeClose &&
    compositionCloseAdmissionSeal > compositionCloseMemo &&
    compositionCloseOperationSnapshot > compositionCloseAdmissionSeal &&
    compositionCloseCoordinatorAbort > compositionCloseOperationSnapshot &&
    compositionClosePostgresDrain > compositionCloseCoordinatorAbort &&
    compositionCloseAdmittedDrain > compositionClosePostgresDrain &&
    compositionClosePoolEnd > compositionCloseAdmittedDrain &&
    compositionCloseFailureGate > compositionClosePoolEnd &&
    runtimeComposition.split('handles.closePostgres()').length - 1 === 2 &&
    runtimeComposition.split('handles.endPool()').length - 1 === 2 &&
    exactExecutableLineCount(
      runtimeComposition,
      "const closeAdmission = stableDataMember(coordinator, 'closeAdmission');",
    ) === 1 &&
    exactExecutableLineCount(
      runtimeComposition,
      'Reflect.apply(closeAdmission, coordinator, []);',
    ) === 1 &&
    exactExecutableLineCount(
      runtimeComposition,
      'void Promise.allSettled([postgresDrain, ...operationGates]).then(async (drainResults) => {',
    ) === 1 &&
    coordinatorActiveControllerSet >= 0 &&
    coordinatorAdmissionOpen > coordinatorActiveControllerSet &&
    coordinatorCloseAdmission > coordinatorAdmissionOpen &&
    coordinatorCloseAdmissionSeal > coordinatorCloseAdmission &&
    coordinatorCloseAbortFailureState > coordinatorCloseAdmissionSeal &&
    coordinatorCloseControllerSnapshot > coordinatorCloseAbortFailureState &&
    coordinatorCloseControllerAbort > coordinatorCloseControllerSnapshot &&
    coordinatorCloseAbortCatch > coordinatorCloseControllerAbort &&
    coordinatorCloseAbortFailure > coordinatorCloseAbortCatch &&
    coordinatorCloseFailClosed > coordinatorCloseAbortFailure &&
    coordinatorAdmissionOpenCheck > coordinatorCloseFailClosed &&
    coordinatorControllerConstruction > coordinatorAdmissionOpenCheck &&
    coordinatorControllerAdd > coordinatorControllerConstruction &&
    coordinatorControllerAbort > coordinatorControllerAdd &&
    coordinatorControllerDelete > coordinatorControllerAbort &&
    exactExecutableLineCount(
      coordinator,
      'this.activeAdmissionControllers.add(activeController);',
    ) === 1 &&
    exactExecutableLineCount(
      coordinator,
      'this.activeAdmissionControllers.delete(activeController);',
    ) === 1 &&
    coordinatorCapturedSources >= 0 &&
    coordinatorSourceIdentity > coordinatorCapturedSources &&
    coordinatorSourceProxyRejection > coordinatorSourceIdentity &&
    coordinatorSourceReceiver > coordinatorSourceProxyRejection &&
    coordinatorSourceReuse > coordinatorSourceReceiver &&
    coordinatorSourceMethodCapture > coordinatorSourceReuse &&
    coordinatorSourceWrapper > coordinatorSourceMethodCapture &&
    coordinatorSourceStore > coordinatorSourceWrapper &&
    exactExecutableLineCount(
      coordinator,
      "const readTarget = stableDataMember(sourceReceiver, 'readTarget');",
    ) === 1 &&
    exactExecutableLineCount(
      coordinator,
      "if (typeof readTarget !== 'function' || isProxy(readTarget)) {",
    ) === 1 &&
    exactExecutableLineCount(
      coordinator,
      'Reflect.apply(readTarget, sourceReceiver, [request]) as Promise<unknown>,',
    ) === 1 &&
    exactExecutableLineCount(
      coordinator,
      "if (isProxy(current)) return fail('INVALID_CONFIGURATION');",
    ) === 1 &&
    exactExecutableLineCount(coordinator, 'isProxy(assemble) ||') === 1 &&
    exactExecutableLineCount(coordinator, 'isProxy(verifyAssembly) ||') === 1 &&
    exactExecutableLineCount(coordinator, 'isProxy(verify)') === 1 &&
    !coordinator.includes('source: record.source as ProviderPositionAdmissionSourcePort') &&
    exactExecutableLineCount(
      infrastructureConfig,
      "if (workload === 'api') return 'crypto_api_runtime';",
    ) === 1 &&
    exactExecutableLineCount(infrastructureConfig, 'connectionTimeoutMs: 60_000,') === 1 &&
    exactExecutableLineCount(infrastructureConfig, 'lockTimeoutMs: 60_000,') === 1 &&
    exactExecutableLineCount(infrastructureConfig, 'statementTimeoutMs: 300_000,') === 1 &&
    exactExecutableLineCount(
      infrastructureConfig,
      'migration ? 60_000 : runtimeTimeoutLimits.connectionTimeoutMs,',
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureConfig,
      'migration ? 300_000 : runtimeTimeoutLimits.lockTimeoutMs,',
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureConfig,
      'migration ? 43_200_000 : runtimeTimeoutLimits.statementTimeoutMs,',
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureConfig,
      'idleTimeoutMs: positiveInteger(env, `${tuningPrefix}_IDLE_TIMEOUT_MS`, 30_000, 600_000),',
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureConfig,
      'maxLifetimeSeconds: positiveInteger(env, `${tuningPrefix}_MAX_LIFETIME_SECONDS`, 1_800, 86_400),',
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureConfig,
      "poolMax: migration ? 1 : positiveInteger(env, 'DATABASE_POOL_MAX', 10, 100),",
    ) === 1 &&
    exactExecutableLineCount(
      runtimePostgresPool,
      "api: 'crypto_api_runtime',",
    ) === 1 &&
    exactExecutableLineCount(runtimePostgresPool, 'return new Pool({') === 1 &&
    exactExecutableLineCount(
      runtimePostgresPool,
      'connectionTimeoutMillis: config.database.connectionTimeoutMs,',
    ) === 1 &&
    !forbiddenCoordinatorRuntimeBoundsConsumption.test(coordinator) &&
    exactExecutableLineCount(
      reader,
      'export const MAINNET_PROVIDER_POSITION_READER_VERSION = 2 as const;',
    ) === 1 &&
    exactExecutableLineCount(reader, 'export interface MainnetProviderPositionReaderV2 {') === 1 &&
    exactExecutableLineCount(
      reader,
      'readonly coverageVersion: typeof MAINNET_PROVIDER_POSITION_COVERAGE_VERSION;',
    ) === 1 &&
    exactExecutableLineCount(reader, '): Promise<CoveredMainnetProviderPositionSnapshotV1>;') ===
      1 &&
    !reader.includes('Promise<MainnetProviderPositionSnapshotV1>') &&
    !/(?:@Injectable|@Module|@Controller)\s*\(|\bclass\s+/u.test(reader) &&
    exactExecutableLineCount(assemblyPort, 'readonly mayAuthorizeFinancialAction: false;') === 2 &&
    exactExecutableLineCount(assemblyPort, 'readonly mayPersist: false;') === 1 &&
    exactExecutableLineCount(
      assemblyPort,
      'export interface ProviderPositionTrustedChainAssessmentAssemblyPort extends MainnetProviderPositionChainAssessmentVerifierPort {',
    ) === 1 &&
    exactExecutableLineCount(
      assemblyPort,
      'assemble(request: AssembleProviderPositionTrustedChainAssessmentRequestV1): Promise<unknown>;',
    ) === 1 &&
    exactExecutableLineCount(assemblyPort, '): boolean;') === 1 &&
    !/(?:@Injectable|@Module|@Controller)\s*\(|\bclass\s+/u.test(assemblyPort) &&
    exactExecutableLineCount(
      coordinator,
      "const assemble = stableDataMember(value, 'assemble');",
    ) === 1 &&
    exactExecutableLineCount(
      coordinator,
      "const verifyAssembly = stableDataMember(value, 'verifyAssembly');",
    ) === 1 &&
    exactExecutableLineCount(coordinator, "const verify = stableDataMember(value, 'verify');") ===
      1 &&
    exactExecutableLineCount(
      coordinator,
      'trustedChainAssessmentAssembly?: ProviderPositionTrustedChainAssessmentAssemblyPort,',
    ) === 1 &&
    exactExecutableLineCount(
      coordinator,
      "if (assembly === undefined) return fail('ASSEMBLY_UNAVAILABLE');",
    ) === 1 &&
    exactExecutableLineCount(coordinator, 'readonly signal: AbortSignal;') === 2 &&
    exactExecutableLineCount(coordinator, 'signal: activeController.signal,') === 4 &&
    exactExecutableLineCount(
      coordinator,
      'prepared.abortAdmission();',
    ) === 1 &&
    exactExecutableLineCount(
      coordinator,
      'abortAdmission?.();',
    ) === 1 &&
    exactExecutableLineCount(coordinator, 'readonly abortAdmission: () => void;') === 2 &&
    exactExecutableLineCount(coordinator, 'abortAdmission: activeAbortAdmission,') === 3 &&
    exactExecutableLineCount(
      coordinator,
      'while (!failed && !controller.signal.aborted && next < inputs.length) {',
    ) === 1 &&
    exactExecutableLineCount(coordinator, 'if (failed) throw firstFailure;') === 1 &&
    coordinatorRosterRead >= 0 &&
    coordinatorRosterAccount > coordinatorRosterRead &&
    coordinatorRosterEvaluation > coordinatorRosterAccount &&
    coordinatorRosterCorrelation > coordinatorRosterEvaluation &&
    coordinatorRosterSignal > coordinatorRosterCorrelation &&
    exactExecutableLineCount(portfolioWalletReaderPort, 'readonly signal?: AbortSignal;') === 1 &&
    exactExecutableLineCount(
      portfolioWalletReaderPort,
      'request: ReadActivePortfolioWalletRegistrationsRequest,',
    ) === 1 &&
    registeredSignalCapture >= 0 &&
    registeredLegacyBranch > registeredSignalCapture &&
    registeredLegacyRead > registeredLegacyBranch &&
    registeredSignaledRead > registeredLegacyRead &&
    registeredSignaledAccount > registeredSignaledRead &&
    registeredSignaledSignal > registeredSignaledAccount &&
    exactExecutableLineCount(registeredWalletReader, 'const signal = request.signal;') === 1 &&
    exactExecutableLineCount(
      registeredWalletReader,
      '? await this.wallets.listActiveWallets(request.accountId)',
    ) === 1 &&
    exactExecutableLineCount(registeredWalletReader, 'Object.freeze({ signal }),') === 1 &&
    walletServiceList >= 0 &&
    walletServiceAccountParse > walletServiceList &&
    walletServiceRepositoryRead > walletServiceAccountParse &&
    walletServiceForwarding > walletServiceRepositoryRead &&
    exactExecutableLineCount(
      walletRegistrationService,
      'readonly signal: AbortSignal;',
    ) === 1 &&
    exactExecutableLineCount(
      walletRegistrationService,
      'options?: ListActiveWalletsOptions,',
    ) === 1 &&
    exactExecutableLineCount(
      walletRegistrationService,
      'options === undefined ? { accountId } : { accountId, signal: options.signal },',
    ) === 1 &&
    exactExecutableLineCount(
      walletRegistrationRepositoryPort,
      'readonly signal?: AbortSignal;',
    ) === 1 &&
    exactExecutableLineCount(
      walletRegistrationRepositoryPort,
      'request: ListActiveWalletRegistrationsRequest,',
    ) === 1 &&
    postgresWalletRead >= 0 &&
    postgresWalletAccountParse > postgresWalletRead &&
    postgresWalletSignalCapture > postgresWalletAccountParse &&
    postgresWalletValues > postgresWalletSignalCapture &&
    postgresWalletLegacyQuery > postgresWalletValues &&
    postgresWalletCancellableQuery > postgresWalletLegacyQuery &&
    postgresWalletCancellableSignal > postgresWalletCancellableQuery &&
    postgresWalletReturnedIdentity > postgresWalletCancellableSignal &&
    exactExecutableLineCount(
      postgresWalletRegistrationRepository,
      'const signal = request.signal;',
    ) === 1 &&
    exactExecutableLineCount(
      postgresWalletRegistrationRepository,
      '? await this.postgres.query<ActiveWalletRow>(query, values)',
    ) === 1 &&
    exactExecutableLineCount(
      postgresWalletRegistrationRepository,
      ': await this.postgres.queryWithCancellation<ActiveWalletRow>(',
    ) === 1 &&
    walletRosterCancellationBridgeSources.every(
      (source) =>
        !source.includes('Promise.race(') &&
        !/\bnew\s+AbortController\s*\(|\bAbortSignal\s*\.\s*(?:abort|any|timeout)\s*\(/u.test(
          source,
        ),
    ) &&
    postgresCancellationEntry >= 0 &&
    postgresSignalReview > postgresCancellationEntry &&
    postgresCancellationExecution > postgresSignalReview &&
    postgresClientAcquisition > postgresCancellationExecution &&
    postgresPostAcquisitionCancellation > postgresClientAcquisition &&
    postgresQuerySettlement > postgresPostAcquisitionCancellation &&
    postgresQueryDrain > postgresQuerySettlement &&
    postgresTeardownDrain > postgresQueryDrain &&
    postgresCancellationFinally > postgresTeardownDrain &&
    postgresCancellationTimerCleanup > postgresCancellationFinally &&
    postgresCancellationListenerCleanup > postgresCancellationTimerCleanup &&
    exactExecutableLineCount(
      providerPositionPostgresService,
      'this.executeCancellableQuery<Row>(queryTextOrConfig, values, signal),',
    ) === 1 &&
    exactExecutableLineCount(
      providerPositionPostgresService,
      'if (cancellation !== null || supplied.aborted() || lifecycle.aborted()) {',
    ) === 2 &&
    exactExecutableLineCount(
      providerPositionPostgresService,
      'const teardownFailure = (await Promise.allSettled([querySettlement, teardown])).find(',
    ) === 1 &&
    exactExecutableLineCount(
      providerPositionPostgresService,
      'supplied.remove(cancelFromSignal);',
    ) === 1 &&
    !providerPositionPostgresService.includes('Promise.race(') &&
    deadlineRunnerImportDeclarationCount === 2 &&
    deadlineRunnerImportSources.length === 2 &&
    deadlineRunnerImportSources[0] === 'node:util/types' &&
    deadlineRunnerImportSources[1] === '../application/provider-position-admission.coordinator' &&
    deadlineRunnerGlobalMembers.length === 2 &&
    deadlineRunnerGlobalMembers.includes('setTimeout') &&
    deadlineRunnerGlobalMembers.includes('clearTimeout') &&
    !forbiddenDeadlineRunnerCapability.test(deadlineRunner) &&
    !deadlineRunner.includes('Promise.race') &&
    exactExecutableLineCount(
      deadlineRunner,
      'const MAX_DEADLINE_MILLISECONDS = 30_000;',
    ) === 1 &&
    exactExecutableLineCount(
      deadlineRunner,
      'const SYSTEM_SET_TIMEOUT = globalThis.setTimeout;',
    ) === 1 &&
    exactExecutableLineCount(
      deadlineRunner,
      'const SYSTEM_CLEAR_TIMEOUT = globalThis.clearTimeout;',
    ) === 1 &&
    exactExecutableLineCount(deadlineRunner, 'handle.unref?.();') === 1 &&
    exactExecutableLineCount(
      deadlineRunner,
      "super('Provider-position admission deadline execution is unavailable.');",
    ) === 1 &&
    exactExecutableLineCount(
      deadlineRunner,
      'if (request.signal.aborted()) return fail(\'ADMISSION_ABORTED\');',
    ) === 1 &&
    exactExecutableLineCount(deadlineRunner, 'if (remaining <= 0) {') === 1 &&
    exactExecutableLineCount(deadlineRunner, 'if (remaining > MAX_DEADLINE_MILLISECONDS) {') === 1 &&
    exactExecutableLineCount(deadlineRunner, 'request.signal.add(onAbort);') === 1 &&
    exactExecutableLineCount(deadlineRunner, 'timer = this.scheduleTimer(() => {') === 1 &&
    exactExecutableLineCount(
      deadlineRunner,
      'completedAt >= request.deadlineMilliseconds',
    ) === 1 &&
    exactExecutableLineCount(
      deadlineRunner,
      'Reflect.apply(request.abortAdmission, undefined, []);',
    ) === 1 &&
    exactExecutableLineCount(
      deadlineRunner,
      "if (!request.signal.aborted()) return fail('INVALID_ABORT_CAPABILITY');",
    ) === 1 &&
    runnerOperationAwait >= 0 &&
    runnerFailureAbort > runnerOperationAwait &&
    runnerCompletionClock > runnerFailureAbort &&
    runnerFinally > runnerCompletionClock &&
    runnerTimerCleanup > runnerFinally &&
    runnerListenerCleanup > runnerTimerCleanup &&
    runnerCleanupFailure > runnerListenerCleanup &&
    runnerCleanupFailureResult > runnerCleanupFailure &&
    exactExecutableLineCount(
      coordinator,
      'assembly.verifyAssembly(chainAssessment, assemblyRequest) !== true',
    ) === 1 &&
    exactExecutableLineCount(
      coordinator,
      'coveredSnapshot = parseCoveredMainnetProviderPositionSnapshotV1({',
    ) === 1 &&
    exactExecutableLineCount(coordinator, 'chainAssessmentVerifier: assembly,') === 1 &&
    exactExecutableLineCount(coordinator, 'const completed = canonicalClock(this.clock.now());') ===
      1 &&
    exactExecutableLineCount(coordinator, 'const verified = canonicalClock(this.clock.now());') ===
      1 &&
    exactExecutableLineCount(
      coordinator,
      'assertAssemblyWindow(verified.milliseconds, candidate, prepared, completed.timestamp);',
    ) === 1 &&
    exactExecutableLineCount(coordinator, 'mayAuthorizeFinancialAction: false,') >= 2 &&
    exactExecutableLineCount(coordinator, 'mayPersist: false,') >= 1 &&
    selectedTargetLoop >= 0 &&
    selectedSource > selectedTargetLoop &&
    selectedTargetPush > selectedSource &&
    positionLoop > selectedTargetPush &&
    exactExecutableLineCount(coverage, "if (target.status !== 'COMPLETE') {") === 1 &&
    exactExecutableLineCount(coverage, "if (target.divergenceStatus !== 'AGREED') {") === 1 &&
    exactExecutableLineCount(coverage, 'if (parsedTargets.length < expected.length) {') === 1 &&
    exactExecutableLineCount(coverage, 'if (observationsInput.length === 0) {') === 1 &&
    exactExecutableLineCount(
      coverage,
      'if (request.chainAssessment === undefined || request.chainAssessmentVerifier === undefined) {',
    ) === 1 &&
    exactExecutableLineCount(
      coverage,
      'if (totalDeclaredPositions !== snapshot.observations.length) {',
    ) === 1 &&
    exactExecutableLineCount(
      coverage,
      'if ((actualCountByTarget.get(targetKey(target)) ?? 0) !== target.positionCount) {',
    ) === 1 &&
    exactExecutableLineCount(coverage, 'coverageManifest: manifest,') === 1 &&
    exactExecutableLineCount(observation, 'chainAssessmentVerifier.verify(') === 1 &&
    exactExecutableLineCount(observation, 'mayAuthorizeFinancialAction: false,') >= 2 &&
    exactExecutableLineCount(
      chainAssessment,
      'export interface MainnetProviderPositionChainAssessmentVerifierPort {',
    ) === 1 &&
    exactExecutableLineCount(chainAssessment, 'readonly mayAuthorizeFinancialAction: false;') ===
      2 &&
    exactExecutableLineCount(
      policy,
      'export const MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION = 1 as const;',
    ) === 1 &&
    exactExecutableLineCount(
      moduleSource,
      'providers: [MainnetPlatformDirectoryService, MainnetPlatformsPrivacyInterceptor],',
    ) === 1 &&
    exactExecutableLineCount(moduleSource, 'exports: [MainnetPlatformDirectoryService],') === 1 &&
    !forbiddenRuntimeIdentity.test(moduleSource) &&
    !forbiddenRuntimeIdentity.test(controller) &&
    !forbiddenBarrelImplementation.test(indexSource) &&
    exactExecutableLineCount(
      controller,
      'constructor(private readonly directory: MainnetPlatformDirectoryService) {}',
    ) === 1
  );
}

function snapshotBalanceConsumerArtifactSources(
  value: unknown,
): BalanceConsumerArtifactSources | null {
  if (!isRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== BALANCE_CONSUMER_ARTIFACT_KEYS.length ||
    !BALANCE_CONSUMER_ARTIFACT_KEYS.every((key) => ownKeys.includes(key))
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  let totalBytes = 0;
  const snapshot: Partial<Record<keyof BalanceConsumerArtifactSources, string>> = {};
  for (const key of BALANCE_CONSUMER_ARTIFACT_KEYS) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.length === 0
    ) {
      return null;
    }
    const bytes = Buffer.byteLength(descriptor.value, 'utf8');
    const maximumBytes =
      key === 'rootPackageLockSource'
        ? MAX_BALANCE_CONSUMER_PACKAGE_LOCK_BYTES
        : MAX_BALANCE_CONSUMER_ARTIFACT_BYTES;
    if (bytes > maximumBytes) return null;
    totalBytes += bytes;
    if (totalBytes > MAX_BALANCE_CONSUMER_TOTAL_BYTES) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot as BalanceConsumerArtifactSources;
}

function parsedPackageScripts(source: string): Record<string, unknown> | null {
  try {
    const manifest = JSON.parse(source) as unknown;
    if (!isRecord(manifest) || !isRecord(manifest.scripts)) return null;
    return manifest.scripts;
  } catch {
    return null;
  }
}

function hasExactPostgresCancellationDependencyLock(
  apiPackageSource: string,
  rootPackageLockSource: string,
): boolean {
  try {
    const apiPackage = JSON.parse(apiPackageSource) as unknown;
    const packageLock = JSON.parse(rootPackageLockSource) as unknown;
    if (!isRecord(apiPackage) || !isRecord(apiPackage.dependencies) || !isRecord(packageLock)) {
      return false;
    }
    if (apiPackage.dependencies.pg !== '8.23.0' || packageLock.lockfileVersion !== 3) {
      return false;
    }
    const packages = packageLock.packages;
    if (!isRecord(packages)) return false;
    const workspace = packages['apps/api'];
    const pg = packages['node_modules/pg'];
    const pool = packages['node_modules/pg-pool'];
    if (
      !isRecord(workspace) ||
      !isRecord(workspace.dependencies) ||
      workspace.dependencies.pg !== '8.23.0' ||
      !isRecord(pg) ||
      pg.version !== '8.23.0' ||
      pg.resolved !== 'https://registry.npmjs.org/pg/-/pg-8.23.0.tgz' ||
      typeof pg.integrity !== 'string' ||
      !isRecord(pg.dependencies) ||
      pg.dependencies['pg-pool'] !== '^3.14.0' ||
      !isRecord(pool) ||
      pool.version !== '3.14.0' ||
      pool.resolved !== 'https://registry.npmjs.org/pg-pool/-/pg-pool-3.14.0.tgz' ||
      typeof pool.integrity !== 'string'
    ) {
      return false;
    }
    const packageKeys = Object.keys(packages);
    return (
      packageKeys.filter((key) => /(?:^|\/)node_modules\/pg$/u.test(key)).join('|') ===
        'node_modules/pg' &&
      packageKeys.filter((key) => /(?:^|\/)node_modules\/pg-pool$/u.test(key)).join('|') ===
        'node_modules/pg-pool'
    );
  } catch {
    return false;
  }
}

function hasExactReviewedBalanceConsumerArtifactBytes(
  sources: BalanceConsumerArtifactSources,
): boolean {
  return BALANCE_CONSUMER_ARTIFACT_KEYS.every(
    (key) =>
      createHash('sha256').update(sources[key], 'utf8').digest('hex') ===
      REVIEWED_BALANCE_CONSUMER_ARTIFACT_SHA256[key],
  );
}

function hasDormantBalanceConsumerSourceContract(sources: BalanceConsumerArtifactSources): boolean {
  const activationLines = trimmedExecutableLines(sources.activationSource);
  const activationAssignments = activationLines.filter((line) => /^enabled\s*:/u.test(line));
  if (
    activationAssignments.length !== 1 ||
    activationAssignments[0] !== 'enabled: false as boolean,'
  ) {
    return false;
  }

  if (
    exactExecutableLineCount(
      sources.cliSource,
      "import { runBalanceSyncConsumerCli } from './balance-sync-consumer.cli-mode';",
    ) !== 1 ||
    exactExecutableLineCount(
      sources.cliSource,
      'void runBalanceSyncConsumerCli(process.argv.slice(2), process.env)',
    ) !== 1 ||
    /balance-sync-consumer\.runtime|\bNestFactory\b|createApplicationContext\s*\(|\.listen\s*\(/u.test(
      sources.cliSource,
    )
  ) {
    return false;
  }

  const cliLines = trimmedExecutableLines(sources.cliModeSource);
  const cliGate = cliLines.indexOf('if (!BALANCE_CONSUMER_SOURCE_ACTIVATION.enabled) {');
  const cliBlocker = cliLines.indexOf("blockers.push('SOURCE_ACTIVATION_DISABLED');");
  const cliRefusal = cliLines.indexOf('if (blockers.length > 0 || !balance || !infrastructure) {');
  const cliLaunchGuard = cliLines.indexOf(
    'if (!evaluation.launchContext) return evaluation.publicResult;',
  );
  const cliRuntimeLoad = cliLines.indexOf('const runtime = await runtimeLoader();');
  if (
    exactExecutableLineCount(sources.cliModeSource, 'loadBalanceConsumerInfrastructureConfig,') !==
      1 ||
    exactExecutableLineCount(
      sources.cliModeSource,
      'infrastructure = loadBalanceConsumerInfrastructureConfig(environment);',
    ) !== 1 ||
    cliGate < 0 ||
    cliBlocker !== cliGate + 1 ||
    cliRefusal <= cliBlocker ||
    cliLaunchGuard <= cliRefusal ||
    cliRuntimeLoad <= cliLaunchGuard ||
    exactExecutableLineCount(
      sources.cliModeSource,
      "return import('./balance-sync-consumer.runtime');",
    ) !== 1
  ) {
    return false;
  }

  if (
    exactExecutableLineCount(sources.runtimeSource, '@Module({})') !== 1 ||
    exactExecutableLineCount(
      sources.runtimeSource,
      'export class DormantBalanceSyncConsumerRuntimeModule {}',
    ) !== 1 ||
    exactExecutableLineCount(
      sources.runtimeSource,
      "() => Promise.reject(new Error('BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED'));",
    ) !== 1 ||
    /\b(?:InfrastructureConfigModule|MigrationRunner|OUTBOX_TRANSPORT|PostgresModule|PostgresService|SQS(?:_[A-Z0-9]+)+|Sqs[A-Za-z0-9_]*)\b/u.test(
      sources.runtimeSource,
    ) ||
    /\bNestFactory\b|createApplicationContext\s*\(|\.listen\s*\(/u.test(sources.runtimeSource)
  ) {
    return false;
  }

  return (
    exactExecutableLineCount(
      sources.compositionSource,
      'const jobDisposition = new FailClosedBalanceSyncJobPort();',
    ) === 1 &&
    exactExecutableLineCount(sources.compositionSource, "'balance',") === 1 &&
    exactExecutableLineCount(
      sources.compositionSource,
      "import type { PinnedSqsQueueReceiptPort } from '../../infrastructure/sqs/sqs-queue-receipt.port';",
    ) === 1 &&
    exactExecutableLineCount(
      sources.compositionSource,
      'readonly sqs: Readonly<PinnedSqsQueueReceiptPort>;',
    ) === 1 &&
    exactExecutableLineCount(
      sources.compositionSource,
      'readonly visibilityTimeoutSeconds: number;',
    ) === 1 &&
    exactExecutableLineCount(
      sources.compositionSource,
      'const receiptPolicy = snapshotReceiptPolicy(dependencies.receiptPolicy);',
    ) === 1 &&
    exactExecutableLineCount(
      sources.compositionSource,
      'const descriptors = Object.getOwnPropertyDescriptors(value);',
    ) === 1 &&
    exactExecutableLineCount(
      sources.compositionSource,
      "keys[0] !== 'visibilityTimeoutSeconds' ||",
    ) === 1 &&
    exactExecutableLineCount(
      sources.compositionSource,
      'return Object.freeze({ visibilityTimeoutSeconds: visibilityTimeoutSeconds as number });',
    ) === 1 &&
    exactExecutableLineCount(sources.compositionSource, 'dependencies.sqs,') === 1 &&
    exactExecutableLineCount(
      sources.compositionSource,
      'visibilityTimeoutSeconds: receiptPolicy.visibilityTimeoutSeconds,',
    ) === 1 &&
    sources.compositionSource.includes('Balance sync consumer receipt policy is invalid') &&
    !/\b(?:BalanceConsumerInfrastructureConfig|PinnedSqsQueueReceiptAdapter|SqsQueueReceiptTransport|infrastructureConfig|balanceQueueUrl|queueUrl|QueueUrl)\b/u.test(
      sources.compositionSource,
    ) &&
    !/\bNestFactory\b|@Module\s*\(|createApplicationContext\s*\(|\.listen\s*\(/u.test(
      sources.compositionSource,
    )
  );
}

function hasExactMainnetBalanceIndexerRouterContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const router = sources.mainnetBalanceIndexerRouterSource.replace(/\r\n/gu, '\n');
  const composition = sources.compositionSource.replace(/\r\n/gu, '\n');
  const executable = trimmedExecutableLines(router).join('\n');
  const expectedImports = ['../domain/balance-sync', './ports/balance-sync.ports'].sort();
  const forbiddenCapability =
    /\b(?:fetch|setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(|\b(?:process|Deno|Bun)\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|\bnew\s+(?:URL|URLSearchParams|WebSocket|EventSource|Connection|[A-Za-z0-9_]*Client|[A-Za-z0-9_]*Agent)\s*\(|\b(?:http|https|dns|net|tls)\s*\.\s*[A-Za-z][A-Za-z0-9_]*\s*\(|\b(?:axios|got|request|retry|backoff)\s*\(|@(?:Injectable|Module)\s*\(|\b(?:NestFactory|createApplicationContext)\b|\.(?:listen|connect)\s*\(|['"]https?:\/\//iu;
  const forbiddenImport =
    /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"](?:node:)?(?:dns|http|http2|https|net|tls)(?:\/[^'"]*)?['"]|(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"](?:axios|ethers|got|superagent|undici|web3|@solana\/web3\.js)['"]/iu;
  const readRequestKeys = [
    'const READ_REQUEST_KEYS = Object.freeze([',
    "'accountId',",
    "'walletId',",
    "'networkId',",
    "'tier',",
    "'selector',",
    '] as const);',
  ].join('\n');
  const rescanRequestKeys = [
    'const RESCAN_REQUEST_KEYS = Object.freeze([',
    '...READ_REQUEST_KEYS,',
    "'fromFinalizedSource',",
    "'maximumReadUnits',",
    '] as const);',
  ].join('\n');
  const sourcePointKeys = [
    'const SOURCE_POINT_KEYS = Object.freeze([',
    "'position',",
    "'hash',",
    "'parentHash',",
    "'selector',",
    "'retrievedAt',",
    '] as const);',
  ].join('\n');
  const networkRouter = [
    'switch (networkId) {',
    'case ETHEREUM_MAINNET_BALANCE_NETWORK_ID:',
    'return this.ethereum;',
    'case SOLANA_MAINNET_BALANCE_NETWORK_ID:',
    'return this.solana;',
    'default:',
    'return unsupportedRequest();',
    '}',
  ].join('\n');
  const exactNetworkGuard = [
    'record.networkId !== ETHEREUM_MAINNET_BALANCE_NETWORK_ID &&',
    'record.networkId !== SOLANA_MAINNET_BALANCE_NETWORK_ID',
  ].join('\n');
  const routerNetworkDeclarations =
    router.match(/\bexport const [A-Z0-9_]+_BALANCE_NETWORK_ID\s*=/gu) ?? [];
  const routerCases = router.match(/^\s*case\s+[^:]+:\s*$/gmu) ?? [];
  const routerReferences = composition.split('MainnetBalanceIndexerRouter').length - 1;
  const routerConstruction = composition.indexOf(
    'const indexer = new MainnetBalanceIndexerRouter(ethereumIndexer, solanaIndexer);',
  );
  const orchestratorConstruction = composition.indexOf(
    'const orchestrator = new BalanceSyncOrchestrator(',
    routerConstruction,
  );
  const orchestratorIndexerArgument = composition.indexOf('    indexer,', orchestratorConstruction);

  return (
    sortedTypeScriptImportTargets(router).join('\0') === expectedImports.join('\0') &&
    !forbiddenCapability.test(router) &&
    !forbiddenImport.test(router) &&
    routerNetworkDeclarations.length === 2 &&
    routerCases.length === 2 &&
    exactExecutableLineCount(
      router,
      "export const ETHEREUM_MAINNET_BALANCE_NETWORK_ID = 'eip155:1' as const;",
    ) === 1 &&
    exactExecutableLineCount(
      router,
      "export const SOLANA_MAINNET_BALANCE_NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;",
    ) === 1 &&
    executable.includes(readRequestKeys) &&
    executable.includes(rescanRequestKeys) &&
    executable.includes(sourcePointKeys) &&
    executable.includes(networkRouter) &&
    executable.includes(exactNetworkGuard) &&
    exactExecutableLineCount(
      router,
      'const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;',
    ) === 1 &&
    exactExecutableLineCount(router, '!UUID_V4.test(record.accountId) ||') === 1 &&
    exactExecutableLineCount(router, '!UUID_V4.test(record.walletId) ||') === 1 &&
    exactExecutableLineCount(
      router,
      'const validated = copyReadRequest(request, READ_REQUEST_KEYS);',
    ) === 1 &&
    exactExecutableLineCount(
      router,
      'return this.indexerFor(validated.networkId).readCurrent(validated, context);',
    ) === 1 &&
    exactExecutableLineCount(
      router,
      'const record = exactDataRecord(request, RESCAN_REQUEST_KEYS);',
    ) === 1 &&
    exactExecutableLineCount(router, 'const validated = frozenNullPrototype({') === 1 &&
    exactExecutableLineCount(
      router,
      'return this.indexerFor(validated.networkId).rescanFromCheckpoint(validated, context);',
    ) === 1 &&
    !/\.readCurrent\s*\(\s*request\s*\)|\.rescanFromCheckpoint\s*\(\s*request\s*\)/u.test(router) &&
    exactExecutableLineCount(
      router,
      'const descriptors = Object.getOwnPropertyDescriptors(value);',
    ) === 1 &&
    exactExecutableLineCount(router, 'keys.length !== expectedKeys.length ||') === 1 &&
    exactExecutableLineCount(
      router,
      "if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {",
    ) === 1 &&
    exactExecutableLineCount(
      router,
      'const copy = Object.create(null) as Record<string, unknown>;',
    ) === 1 &&
    exactExecutableLineCount(router, 'copy[key] = descriptor.value;') === 1 &&
    exactExecutableLineCount(
      router,
      'return Object.freeze(Object.assign(Object.create(null) as T, members));',
    ) === 1 &&
    exactExecutableLineCount(router, 'if (ethereum === solana) return invalidConfiguration();') ===
      1 &&
    exactExecutableLineCount(router, 'ethereum: reviewedIndexer(ethereum),') === 1 &&
    exactExecutableLineCount(router, 'solana: reviewedIndexer(solana),') === 1 &&
    exactExecutableLineCount(
      router,
      "const readCurrent = capturedDataMethod(receiver, 'readCurrent');",
    ) === 1 &&
    exactExecutableLineCount(
      router,
      "const rescanFromCheckpoint = capturedDataMethod(receiver, 'rescanFromCheckpoint');",
    ) === 1 &&
    exactExecutableLineCount(
      router,
      'Reflect.apply(readCurrent, receiver, [request, context]) as Promise<unknown>,',
    ) === 1 &&
    exactExecutableLineCount(
      router,
      'Reflect.apply(rescanFromCheckpoint, receiver, [request, context]) as Promise<unknown>,',
    ) === 1 &&
    exactExecutableLineCount(
      router,
      'const descriptor = Object.getOwnPropertyDescriptor(owner, name);',
    ) === 1 &&
    exactExecutableLineCount(
      router,
      "if (!('value' in descriptor) || typeof descriptor.value !== 'function') {",
    ) === 1 &&
    exactExecutableLineCount(router, 'owner !== Object.prototype &&') === 1 &&
    exactExecutableLineCount(router, 'owner !== Function.prototype &&') === 1 &&
    !/receiver\s*\[\s*name\s*\]/u.test(router) &&
    exactExecutableLineCount(router, 'Object.freeze(this);') === 1 &&
    exactExecutableLineCount(
      composition,
      "import { MainnetBalanceIndexerRouter } from './mainnet-balance-indexer.router';",
    ) === 1 &&
    routerReferences === 3 &&
    routerConstruction >= 0 &&
    orchestratorConstruction > routerConstruction &&
    orchestratorIndexerArgument > orchestratorConstruction
  );
}

function hasAuthenticatedBalanceSyncFailureContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const domain = sources.balanceSyncDomainSource.replace(/\r\n/gu, '\n');
  const orchestrator = sources.balanceSyncOrchestratorSource.replace(/\r\n/gu, '\n');
  const ethereum = sources.ethereumBalanceIndexerSource.replace(/\r\n/gu, '\n');
  const solana = sources.solanaBalanceIndexerSource.replace(/\r\n/gu, '\n');
  const router = sources.mainnetBalanceIndexerRouterSource.replace(/\r\n/gu, '\n');
  const classifiedSources = [domain, orchestrator, ethereum, solana, router] as const;
  const unsafeFailureTrust =
    /instanceof\s+(?:BalanceSyncIndexerFailure|BalanceSyncOrchestratorError)\b/u;

  const adapterContract = (source: string): boolean => {
    const resolverStart = source.indexOf('private async resolveAddress(\n');
    const resolverEnd = source.indexOf('private async readBlock(', resolverStart);
    const resolver = source.slice(resolverStart, resolverEnd);
    return (
      resolverStart >= 0 &&
      resolverEnd > resolverStart &&
      exactExecutableLineCount(source, 'reviewBalanceSyncIndexerFailure,') === 1 &&
      exactExecutableLineCount(
        source,
        'const reviewed = reviewBalanceSyncIndexerFailure(error);',
      ) === 1 &&
      exactExecutableLineCount(source, 'reviewed.code,') === 1 &&
      exactExecutableLineCount(source, ': { retryAfterSeconds: reviewed.retryAfterSeconds },') ===
        1 &&
      exactExecutableLineCount(resolver, '} catch {') === 2 &&
      exactExecutableLineCount(resolver, 'requireActiveExecution(context);') === 3 &&
      exactExecutableLineCount(
        resolver,
        "throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');",
      ) === 1 &&
      exactExecutableLineCount(
        resolver,
        "throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');",
      ) === 1 &&
      !/catch\s*\(\s*error\s*\)/u.test(resolver) &&
      !/\bthrow\s+error\b/u.test(source) &&
      exactExecutableLineCount(
        source,
        'const milliseconds = Date.prototype.getTime.call(value) as number;',
      ) === 1 &&
      exactExecutableLineCount(
        source,
        'return Date.prototype.toISOString.call(value) as string;',
      ) === 1 &&
      !/value\s+instanceof\s+Date|value\.getTime\s*\(|value\.toISOString\s*\(/u.test(source)
    );
  };

  return (
    classifiedSources.every((source) => !unsafeFailureTrust.test(source)) &&
    exactExecutableLineCount(domain, "import { isProxy } from 'node:util/types';") === 1 &&
    exactExecutableLineCount(
      domain,
      'const VERIFIED_BALANCE_SYNC_INDEXER_FAILURES = new WeakSet<object>();',
    ) === 1 &&
    exactExecutableLineCount(domain, 'materializeErrorStack(this);') === 1 &&
    exactExecutableLineCount(domain, 'VERIFIED_BALANCE_SYNC_INDEXER_FAILURES.add(this);') === 1 &&
    exactExecutableLineCount(domain, 'Object.freeze(this);') === 1 &&
    exactExecutableLineCount(domain, 'export function reviewBalanceSyncIndexerFailure(') === 1 &&
    exactExecutableLineCount(domain, 'isProxy(value) ||') === 1 &&
    exactExecutableLineCount(domain, '!VERIFIED_BALANCE_SYNC_INDEXER_FAILURES.has(value) ||') ===
      1 &&
    exactExecutableLineCount(domain, '!Object.isFrozen(value)') === 1 &&
    exactExecutableLineCount(
      domain,
      'const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;',
    ) >= 1 &&
    exactExecutableLineCount(domain, "!('value' in descriptor) ||") >= 1 &&
    exactExecutableLineCount(domain, 'descriptor.configurable !== false ||') === 1 &&
    exactExecutableLineCount(domain, 'descriptor.writable !== false') === 1 &&
    exactExecutableLineCount(domain, 'const name = descriptors.name?.value as unknown;') === 1 &&
    exactExecutableLineCount(domain, 'const message = descriptors.message?.value as unknown;') ===
      1 &&
    exactExecutableLineCount(domain, 'const code = descriptors.code?.value as unknown;') === 1 &&
    exactExecutableLineCount(
      domain,
      'const retryAfterSeconds = descriptors.retryAfterSeconds?.value as unknown;',
    ) === 1 &&
    exactExecutableLineCount(domain, '? Object.freeze({ code })') === 1 &&
    exactExecutableLineCount(
      domain,
      ': Object.freeze({ code, retryAfterSeconds: retryAfterSeconds as number });',
    ) === 1 &&
    exactExecutableLineCount(domain, 'isProxy(options)') === 1 &&
    exactExecutableLineCount(
      domain,
      'const descriptors = Object.getOwnPropertyDescriptors(options) as unknown as PropertyDescriptorMap;',
    ) === 1 &&
    exactExecutableLineCount(
      domain,
      "keys.some((key) => typeof key !== 'string' || key !== 'retryAfterSeconds')",
    ) === 1 &&
    exactExecutableLineCount(
      domain,
      "if (!descriptor?.enumerable || !('value' in descriptor)) {",
    ) === 1 &&
    adapterContract(ethereum) &&
    adapterContract(solana) &&
    exactExecutableLineCount(
      orchestrator,
      'const VERIFIED_BALANCE_SYNC_ORCHESTRATOR_ERRORS = new WeakSet<object>();',
    ) === 1 &&
    exactExecutableLineCount(
      orchestrator,
      'const reviewed = reviewBalanceSyncIndexerFailure(error);',
    ) === 1 &&
    exactExecutableLineCount(
      orchestrator,
      'const reviewedFailure = reviewBalanceSyncIndexerFailure(error);',
    ) === 1 &&
    exactExecutableLineCount(orchestrator, 'if (reviewedFailure) return reviewedFailure;') === 1 &&
    exactExecutableLineCount(
      orchestrator,
      'const orchestratorCode = reviewBalanceSyncOrchestratorError(error);',
    ) === 1 &&
    exactExecutableLineCount(
      orchestrator,
      "return Object.freeze({ code: 'UNCLASSIFIED_FAILURE' });",
    ) === 1 &&
    exactExecutableLineCount(orchestrator, 'isProxy(value) ||') === 1 &&
    exactExecutableLineCount(
      orchestrator,
      '!VERIFIED_BALANCE_SYNC_ORCHESTRATOR_ERRORS.has(value) ||',
    ) === 1 &&
    exactExecutableLineCount(
      orchestrator,
      'VERIFIED_BALANCE_SYNC_ORCHESTRATOR_ERRORS.add(error);',
    ) === 1
  );
}

function hasExactBalanceAdapterDependencyContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const registry = sources.supportedAssetRegistrySource.replace(/\r\n/gu, '\n');
  const wallet = sources.walletIdentitySource.replace(/\r\n/gu, '\n');
  const tokenAccount = sources.solanaTokenAccountSource.replace(/\r\n/gu, '\n');
  const ethereum = sources.ethereumBalanceIndexerSource.replace(/\r\n/gu, '\n');
  const solana = sources.solanaBalanceIndexerSource.replace(/\r\n/gu, '\n');
  const router = sources.mainnetBalanceIndexerRouterSource.replace(/\r\n/gu, '\n');
  const composition = sources.compositionSource.replace(/\r\n/gu, '\n');
  const registryManifestStart = registry.indexOf(
    'const MAINNET_V1_ASSET_MANIFEST: readonly RegistryAssetManifestEntry[] = Object.freeze([',
  );
  const registryManifestEnd = registry.indexOf(
    'const TESTNET_V1_ASSET_MANIFEST:',
    registryManifestStart,
  );
  if (registryManifestStart < 0 || registryManifestEnd <= registryManifestStart) return false;
  const registryManifest = registry.slice(registryManifestStart, registryManifestEnd);
  const manifestEntryPattern =
    /Object\.freeze\(\{\s*stablecoin: '([^']+)',\s*issuer: '([^']+)',\s*chain: '([^']+)',\s*networkId: '([^']+)',\s*identity: '([^']+)',\s*decimals: ([0-9]+),\s*activationState: '([^']+)',\s*verificationSource: ([A-Z0-9_]+),\s*\}\),/gu;
  const launchManifestEntries: string[] = [];
  for (const match of registryManifest.matchAll(manifestEntryPattern)) {
    const values = match.slice(1, 9);
    if (values.some((value) => value === undefined)) return false;
    const networkId = values[3];
    if (networkId === 'eip155:1' || networkId === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') {
      launchManifestEntries.push(values.join('\0'));
    }
  }
  const expectedLaunchManifestEntries = [
    [
      'USDC',
      'CIRCLE',
      'ETHEREUM',
      'eip155:1',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '6',
      'ACTIVE',
      'V1_CIRCLE_USDC_SOURCE',
    ],
    [
      'USDT',
      'TETHER',
      'ETHEREUM',
      'eip155:1',
      '0xdac17f958d2ee523a2206206994597c13d831ec7',
      '6',
      'ACTIVE',
      'V1_TETHER_SOURCE',
    ],
    [
      'PYUSD',
      'PAXOS',
      'ETHEREUM',
      'eip155:1',
      '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
      '6',
      'ACTIVE',
      'V1_PAXOS_PYUSD_MAINNET_SOURCE',
    ],
    [
      'USDC',
      'CIRCLE',
      'SOLANA',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      '6',
      'ACTIVE',
      'V1_CIRCLE_USDC_SOURCE',
    ],
    [
      'USDT',
      'TETHER',
      'SOLANA',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      '6',
      'ACTIVE',
      'V1_TETHER_SOURCE',
    ],
    [
      'PYUSD',
      'PAXOS',
      'SOLANA',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
      '6',
      'ACTIVE',
      'V1_PAXOS_PYUSD_MAINNET_SOURCE',
    ],
  ]
    .map((entry) => entry.join('\0'))
    .sort();
  const ethereumFilter = [
    "supportedAssetRegistryForEnvironment('MAINNET')",
    '.latest.assets.filter(',
    '(asset) =>',
    "asset.networkId === ETHEREUM_MAINNET_NETWORK_ID && asset.activationState === 'ACTIVE',",
    ')',
    '.sort((left, right) => left.identity.localeCompare(right.identity)),',
  ].join('\n');
  const solanaFilter = [
    "supportedAssetRegistryForEnvironment('MAINNET')",
    '.latest.assets.filter(',
    '(asset) =>',
    "asset.networkId === SOLANA_MAINNET_NETWORK_ID && asset.activationState === 'ACTIVE',",
    ')',
    '.sort((left, right) => left.identity.localeCompare(right.identity)),',
  ].join('\n');
  const ethereumExecutable = trimmedExecutableLines(ethereum).join('\n');
  const solanaExecutable = trimmedExecutableLines(solana).join('\n');
  const launchSources = [ethereum, solana, router, composition] as const;
  const futureChainLaunchBinding = /['"]eip155:(?:8453|42161)['"]|['"](?:BASE|ARBITRUM)['"]/u;
  const forbiddenDependencyCapability =
    /\b(?:fetch|setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(|\b(?:process|Deno|Bun)\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|\b(?:http|https|dns|net|tls)\s*\.\s*[A-Za-z][A-Za-z0-9_]*\s*\(|@(?:Injectable|Module)\s*\(|\b(?:NestFactory|createApplicationContext)\b|\.(?:listen|connect)\s*\(/iu;

  return (
    sortedTypeScriptImportTargets(registry).join('\0') === 'node:crypto' &&
    sortedTypeScriptImportTargets(wallet).join('\0') === 'viem' &&
    sortedTypeScriptImportTargets(tokenAccount).length === 0 &&
    !forbiddenDependencyCapability.test(registry) &&
    !forbiddenDependencyCapability.test(wallet) &&
    !forbiddenDependencyCapability.test(tokenAccount) &&
    launchManifestEntries.sort().join('\n') === expectedLaunchManifestEntries.join('\n') &&
    launchManifestEntries.length === 6 &&
    exactExecutableLineCount(
      registry,
      "assets: assetDefinitionsFromManifest('MAINNET', MAINNET_V1_ASSET_MANIFEST),",
    ) === 1 &&
    exactExecutableLineCount(registry, 'const matches = VERIFIED_STABLECOIN_IDENTITIES.filter(') ===
      1 &&
    exactExecutableLineCount(registry, 'if (matches.length === 0) {') === 1 &&
    exactExecutableLineCount(registry, 'if (matches.length !== 1) {') === 1 &&
    exactExecutableLineCount(wallet, 'const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;') === 1 &&
    exactExecutableLineCount(wallet, '!EVM_ADDRESS_PATTERN.test(value) ||') === 1 &&
    exactExecutableLineCount(wallet, '!isAddress(value, { strict: true }) ||') === 1 &&
    exactExecutableLineCount(wallet, 'value.toLowerCase() === ZERO_EVM_ADDRESS') === 1 &&
    exactExecutableLineCount(wallet, 'return value.toLowerCase() as EvmWalletAddress;') === 1 &&
    exactExecutableLineCount(
      wallet,
      'const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;',
    ) === 1 &&
    exactExecutableLineCount(wallet, 'if (!SOLANA_ADDRESS_PATTERN.test(value)) return null;') ===
      1 &&
    exactExecutableLineCount(
      wallet,
      "if (typeof value !== 'string' || value === ZERO_SOLANA_ADDRESS) {",
    ) === 1 &&
    exactExecutableLineCount(
      wallet,
      'if (decoded === null || decoded.length !== 32 || encodeBase58(decoded) !== value) {',
    ) === 1 &&
    exactExecutableLineCount(wallet, 'return value as SolanaWalletAddress;') === 1 &&
    exactExecutableLineCount(wallet, 'return Uint8Array.from(decoded);') === 1 &&
    exactExecutableLineCount(tokenAccount, 'const SOLANA_PUBLIC_KEY_BYTES = 32;') === 1 &&
    exactExecutableLineCount(tokenAccount, 'const SPL_TOKEN_ACCOUNT_BYTES = 165;') === 1 &&
    exactExecutableLineCount(
      tokenAccount,
      'const TOKEN_2022_ACCOUNT_TYPE_OFFSET = SPL_TOKEN_ACCOUNT_BYTES;',
    ) === 1 &&
    exactExecutableLineCount(tokenAccount, 'const TOKEN_2022_ACCOUNT_TYPE = 2;') === 1 &&
    exactExecutableLineCount(
      tokenAccount,
      'export const MAX_SOLANA_TOKEN_ACCOUNT_BYTES = 4_096;',
    ) === 1 &&
    exactExecutableLineCount(
      tokenAccount,
      "LEGACY: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',",
    ) === 1 &&
    exactExecutableLineCount(
      tokenAccount,
      "TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',",
    ) === 1 &&
    exactExecutableLineCount(tokenAccount, 'if (data.length !== SPL_TOKEN_ACCOUNT_BYTES) {') ===
      1 &&
    exactExecutableLineCount(
      tokenAccount,
      'if (data.length < SPL_TOKEN_ACCOUNT_BYTES || data.length > MAX_SOLANA_TOKEN_ACCOUNT_BYTES) {',
    ) === 1 &&
    exactExecutableLineCount(
      tokenAccount,
      'if (data[TOKEN_2022_ACCOUNT_TYPE_OFFSET] !== TOKEN_2022_ACCOUNT_TYPE) {',
    ) === 1 &&
    exactExecutableLineCount(
      tokenAccount,
      'if (tokenProgramId === SOLANA_TOKEN_PROGRAM_IDS.LEGACY) return tokenProgramId;',
    ) === 1 &&
    exactExecutableLineCount(
      tokenAccount,
      'if (tokenProgramId === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022) return tokenProgramId;',
    ) === 1 &&
    exactExecutableLineCount(tokenAccount, 'const data = Uint8Array.from(input.data);') === 1 &&
    exactExecutableLineCount(tokenAccount, 'validateLayout(data, tokenProgramId);') === 1 &&
    exactExecutableLineCount(tokenAccount, 'validateCOption(data, 72, 32);') === 1 &&
    exactExecutableLineCount(tokenAccount, 'validateCOption(data, 109, 8);') === 1 &&
    exactExecutableLineCount(tokenAccount, 'validateCOption(data, 129, 32);') === 1 &&
    exactExecutableLineCount(
      tokenAccount,
      'owner !== normalizeSolanaPublicKey(input.expectedOwner)',
    ) === 1 &&
    exactExecutableLineCount(tokenAccount, 'return Object.freeze({') === 1 &&
    ethereumExecutable.includes(ethereumFilter) &&
    solanaExecutable.includes(solanaFilter) &&
    exactExecutableLineCount(ethereum, 'if (ETHEREUM_ASSETS.length !== 3)') === 1 &&
    exactExecutableLineCount(solana, 'SOLANA_ASSETS.length !== 3 ||') === 1 &&
    exactExecutableLineCount(
      solana,
      '(asset) => tokenProgramBinding(asset.identity) === undefined || asset.decimals !== 6,',
    ) === 1 &&
    exactExecutableLineCount(
      solana,
      "const PYUSD_MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';",
    ) === 1 &&
    exactExecutableLineCount(
      solana,
      "const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';",
    ) === 1 &&
    exactExecutableLineCount(
      solana,
      "const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';",
    ) === 1 &&
    exactExecutableLineCount(solana, '[PYUSD_MINT]: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,') === 1 &&
    exactExecutableLineCount(solana, '[USDC_MINT]: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,') === 1 &&
    exactExecutableLineCount(solana, '[USDT_MINT]: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,') === 1 &&
    exactExecutableLineCount(
      solana,
      'const MAX_BASE64_TOKEN_ACCOUNT_LENGTH = Math.ceil(MAX_SOLANA_TOKEN_ACCOUNT_BYTES / 3) * 4;',
    ) === 1 &&
    exactExecutableLineCount(solana, 'decoded.byteLength > MAX_SOLANA_TOKEN_ACCOUNT_BYTES ||') ===
      1 &&
    exactExecutableLineCount(solana, "decoded.toString('base64') !== encoded") === 1 &&
    exactExecutableLineCount(solana, 'parsed = parseSolanaTokenAccount({') === 1 &&
    exactExecutableLineCount(
      solana,
      'const selectedHeader = await this.readBlock(BigInt(slot), commitment, context);',
    ) === 1 &&
    exactExecutableLineCount(solana, 'if (selectedHeader === null) {') === 1 &&
    exactExecutableLineCount(
      solana,
      'const verifiedHeader = await this.readBlock(BigInt(slot), commitment, context);',
    ) === 1 &&
    exactExecutableLineCount(
      solana,
      'if (verifiedHeader === null || !sameBlockHeader(selectedHeader, verifiedHeader)) {',
    ) === 1 &&
    exactExecutableLineCount(
      solana,
      "throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');",
    ) === 3 &&
    exactExecutableLineCount(
      solana,
      'function sameBlockHeader(left: SolanaBlockHeader, right: SolanaBlockHeader): boolean {',
    ) === 1 &&
    exactExecutableLineCount(solana, 'left.position === right.position &&') === 1 &&
    exactExecutableLineCount(solana, 'left.hash === right.hash &&') === 1 &&
    exactExecutableLineCount(solana, 'left.parentPosition === right.parentPosition &&') === 1 &&
    exactExecutableLineCount(solana, 'left.parentHash === right.parentHash') === 1 &&
    exactExecutableLineCount(solana, 'header: verifiedHeader,') === 1 &&
    exactExecutableLineCount(ethereum, 'return parseEvmWalletAddress(value);') === 1 &&
    exactExecutableLineCount(solana, 'return parseSolanaWalletAddress(value);') === 2 &&
    launchSources.every((source) => !futureChainLaunchBinding.test(source))
  );
}

function hasDormantProviderNeutralBalanceRpcContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const helper = sources.balanceJsonRpcSource.replace(/\r\n/gu, '\n');
  const router = sources.mainnetBalanceIndexerRouterSource.replace(/\r\n/gu, '\n');
  const ethereum = sources.ethereumBalanceIndexerSource.replace(/\r\n/gu, '\n');
  const solana = sources.solanaBalanceIndexerSource.replace(/\r\n/gu, '\n');
  const providerSources = [helper, router, ethereum, solana] as const;
  const forbiddenCapability =
    /\b(?:fetch|setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(|\b(?:process|Deno|Bun)\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|\bnew\s+(?:URL|URLSearchParams|WebSocket|EventSource|Connection|[A-Za-z0-9_]*Client|[A-Za-z0-9_]*Agent)\s*\(|\b(?:http|https|dns|net|tls)\s*\.\s*[A-Za-z][A-Za-z0-9_]*\s*\(|\b(?:axios|got|request|retry|backoff)\s*\(|\b(?:client|endpoint|hostname|credential|apiKey|password|secret|rpcUrl|baseUrl|retry|backoff)\s*(?::|=)|@(?:Injectable|Module)\s*\(|\b(?:NestFactory|createApplicationContext)\b|\.(?:listen|connect)\s*\(|['"]https?:\/\//iu;
  const forbiddenImport =
    /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"](?:node:)?(?:dns|http|http2|https|net|tls)(?:\/[^'"]*)?['"]|(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"](?:axios|ethers|got|superagent|undici|web3|@solana\/web3\.js)['"]/iu;
  const expectedHelperImports = [
    '../../application/ports/balance-sync.ports',
    '../../domain/balance-sync',
    'node:crypto',
  ].sort();
  const expectedEthereumImports = [
    '../../../blockchain/domain/supported-asset-registry',
    '../../../wallets/domain/wallet-identity',
    '../../application/ports/balance-sync.ports',
    '../../domain/balance-sync',
    './balance-json-rpc',
  ].sort();
  const expectedSolanaImports = [
    '../../../blockchain/domain/solana-token-account',
    '../../../blockchain/domain/supported-asset-registry',
    '../../../wallets/domain/wallet-identity',
    '../../application/ports/balance-sync.ports',
    '../../domain/balance-sync',
    './balance-json-rpc',
  ].sort();
  const exactImports = (source: string, expected: readonly string[]): boolean =>
    sortedTypeScriptImportTargets(source).join('\0') === expected.join('\0');
  const helperExchangeCount =
    helper.split('transport.exchange(request, execution.signal)').length - 1;
  const ethereumExchangeCount = ethereum.split('exchangeBalanceRpc(').length - 1;
  const solanaExchangeCount = solana.split('exchangeBalanceRpc(').length - 1;
  const ethereumResolverStart = ethereum.indexOf('private async resolveAddress(\n');
  const ethereumResolverEnd = ethereum.indexOf('private async readBlock(', ethereumResolverStart);
  const solanaResolverStart = solana.indexOf('private async resolveAddress(\n');
  const solanaResolverEnd = solana.indexOf('private async readBlock(', solanaResolverStart);
  const ethereumResolver = ethereum.slice(ethereumResolverStart, ethereumResolverEnd);
  const solanaResolver = solana.slice(solanaResolverStart, solanaResolverEnd);

  if (
    providerSources.some(
      (source) =>
        forbiddenCapability.test(source) ||
        forbiddenImport.test(source) ||
        /implements\s+BalanceJsonRpcTransport\b/u.test(source),
    ) ||
    !exactImports(helper, expectedHelperImports) ||
    !exactImports(ethereum, expectedEthereumImports) ||
    !exactImports(solana, expectedSolanaImports) ||
    exactExecutableLineCount(helper, 'export interface BalanceJsonRpcTransport {') !== 1 ||
    exactExecutableLineCount(
      helper,
      'exchange(request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown>;',
    ) !== 1 ||
    exactExecutableLineCount(helper, 'export async function exchangeBalanceRpc(') !== 1 ||
    exactExecutableLineCount(
      helper,
      'response = await transport.exchange(request, execution.signal);',
    ) !== 1 ||
    exactExecutableLineCount(helper, 'return parseBalanceRpcResult(response, request.id);') !== 1 ||
    helperExchangeCount !== 1 ||
    exactExecutableLineCount(
      ethereum,
      'export class EthereumMainnetBalanceIndexerAdapter implements BalanceSyncIndexerPort {',
    ) !== 1 ||
    exactExecutableLineCount(
      solana,
      'export class SolanaMainnetBalanceIndexerAdapter implements BalanceSyncIndexerPort {',
    ) !== 1 ||
    exactExecutableLineCount(ethereum, 'private readonly transport: BalanceJsonRpcTransport,') !==
      1 ||
    exactExecutableLineCount(solana, 'private readonly transport: BalanceJsonRpcTransport,') !==
      1 ||
    exactExecutableLineCount(ethereum, 'exchangeBalanceRpc,') !== 1 ||
    exactExecutableLineCount(solana, 'exchangeBalanceRpc,') !== 1 ||
    ethereumExchangeCount !== 4 ||
    solanaExchangeCount !== 4 ||
    ethereumResolverStart < 0 ||
    ethereumResolverEnd <= ethereumResolverStart ||
    solanaResolverStart < 0 ||
    solanaResolverEnd <= solanaResolverStart ||
    exactExecutableLineCount(ethereumResolver, 'Object.freeze({') !== 1 ||
    exactExecutableLineCount(ethereumResolver, 'accountId: request.accountId,') !== 1 ||
    exactExecutableLineCount(ethereumResolver, 'walletId: request.walletId,') !== 1 ||
    exactExecutableLineCount(ethereumResolver, 'networkId: ETHEREUM_MAINNET_NETWORK_ID,') !== 1 ||
    exactExecutableLineCount(ethereumResolver, 'context: BalanceSyncExecutionContext,') !== 1 ||
    exactExecutableLineCount(ethereumResolver, 'context,') !== 1 ||
    exactExecutableLineCount(solanaResolver, 'Object.freeze({') !== 1 ||
    exactExecutableLineCount(solanaResolver, 'accountId: request.accountId,') !== 1 ||
    exactExecutableLineCount(solanaResolver, 'walletId: request.walletId,') !== 1 ||
    exactExecutableLineCount(solanaResolver, 'networkId: SOLANA_MAINNET_NETWORK_ID,') !== 1 ||
    exactExecutableLineCount(solanaResolver, 'context: BalanceSyncExecutionContext,') !== 1 ||
    exactExecutableLineCount(solanaResolver, 'context,') !== 1 ||
    /resolveActiveAddress\s*\(\s*request\s*\)/u.test(ethereumResolver) ||
    /resolveActiveAddress\s*\(\s*request\s*\)/u.test(solanaResolver) ||
    /\.exchange\s*\(/u.test(ethereum) ||
    /\.exchange\s*\(/u.test(solana)
  ) {
    return false;
  }

  const directRpcCapability =
    /\b(?:fetch|setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(|\b(?:process|Deno|Bun)\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|\bnew\s+(?:URL|URLSearchParams|WebSocket|EventSource|Connection|[A-Za-z0-9_]*Client|[A-Za-z0-9_]*Agent)\s*\(|\b(?:http|https|dns|net|tls)\s*\.\s*[A-Za-z][A-Za-z0-9_]*\s*\(|\b(?:axios|got|request)\s*\(|@(?:Injectable|Module)\s*\(|\b(?:NestFactory|createApplicationContext)\b|\.(?:exchange|listen|connect)\s*\(|['"]https?:\/\//iu;
  const composition = sources.compositionSource;
  const resource = sources.balanceConsumerResourceSource;
  const ethereumAdapterReferences =
    composition.split('EthereumMainnetBalanceIndexerAdapter').length - 1;
  const solanaAdapterReferences =
    composition.split('SolanaMainnetBalanceIndexerAdapter').length - 1;
  const routerReferences = composition.split('MainnetBalanceIndexerRouter').length - 1;
  const compositionTransportReferences = composition.split('BalanceJsonRpcTransport').length - 1;
  const resourceTransportReferences = resource.split('BalanceJsonRpcTransport').length - 1;
  const forbiddenDirectHelperUse =
    /\b(?:BalanceJsonRpcTransportFailure|balanceRpcRequest|parseBalanceRpcResult|exchangeBalanceRpc)\b/u;
  const forbiddenProviderClassUse =
    /\b(?:EthereumMainnetBalanceIndexerAdapter|SolanaMainnetBalanceIndexerAdapter|MainnetBalanceIndexerRouter)\b/u;
  if (
    [composition, resource].some(
      (source) => directRpcCapability.test(source) || forbiddenImport.test(source),
    ) ||
    forbiddenDirectHelperUse.test(composition) ||
    forbiddenDirectHelperUse.test(resource) ||
    forbiddenProviderClassUse.test(resource) ||
    ethereumAdapterReferences !== 3 ||
    solanaAdapterReferences !== 3 ||
    routerReferences !== 3 ||
    compositionTransportReferences !== 3 ||
    resourceTransportReferences !== 7 ||
    composition.split('../infrastructure/rpc/ethereum-mainnet-balance-indexer.adapter').length -
      1 !==
      1 ||
    composition.split('../infrastructure/rpc/solana-mainnet-balance-indexer.adapter').length - 1 !==
      1 ||
    composition.split('../infrastructure/rpc/balance-json-rpc').length - 1 !== 1 ||
    resource.split('../infrastructure/rpc/balance-json-rpc').length - 1 !== 1
  ) {
    return false;
  }

  const launchAndRegistrationSources = [
    sources.activationSource,
    sources.cliSource,
    sources.cliModeSource,
    sources.runtimeSource,
    sources.blockchainSyncModuleSource,
    sources.appModuleSource,
    sources.applicationRootSource,
    sources.localDevelopmentAppModuleSource,
    sources.mainSource,
    sources.outboxWorkerCliSource,
    sources.redisSessionRevocationCliSource,
    sources.migrationCliSource,
    sources.apiPackageSource,
    sources.rootPackageSource,
    sources.applicationTemplateSource,
    sources.workloadTemplateSource,
    sources.balanceConsumerEnvelopeSource,
    sources.releaseManifestSource,
    sources.balanceConsumerLifecycleSource,
    sources.balanceSyncOrchestratorSource,
    sources.reviewedJobDispatcherSource,
  ];
  const forbiddenLaunchRegistration =
    /\b(?:EthereumMainnetBalanceIndexerAdapter|SolanaMainnetBalanceIndexerAdapter|MainnetBalanceIndexerRouter|BalanceJsonRpc[A-Za-z0-9_]*|balanceRpcRequest|parseBalanceRpcResult|exchangeBalanceRpc)\b|(?:balance-json-rpc|ethereum-mainnet-balance-indexer\.adapter|solana-mainnet-balance-indexer\.adapter|mainnet-balance-indexer\.router)/u;
  const noLaunchRegistration = launchAndRegistrationSources.every(
    (source) => !forbiddenLaunchRegistration.test(source),
  );
  return noLaunchRegistration;
}

function hasDormantNodeHttpsBalanceRpcTransportContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const transport = sources.nodeHttpsBalanceJsonRpcTransportSource.replace(/\r\n/gu, '\n');
  const expectedImports = [
    './balance-json-rpc',
    'node:dns',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:util',
  ].sort();
  const requiredSecurityLines = [
    "const ETHEREUM_MAINNET = 'eip155:1';",
    "const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';",
    'const CONNECT_TIMEOUT_MS = 2_000;',
    'const TOTAL_TIMEOUT_MS = 5_000;',
    'const IO_CLOSE_TIMEOUT_MS = 250;',
    'const MAX_JSON_BYTES = 4 * 1024 * 1024;',
    'const MAX_JSON_DEPTH = 32;',
    'const MAX_JSON_NODES = 200_000;',
    'const MAX_RESPONSE_CHUNKS = 4_096;',
    "[ETHEREUM_MAINNET]: new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']),",
    "[SOLANA_MAINNET]: new Set(['getGenesisHash', 'getSlot', 'getBlock', 'getTokenAccountsByOwner']),",
    'export type NodeHttpsBalanceRpcNetworkId = typeof ETHEREUM_MAINNET | typeof SOLANA_MAINNET;',
    'export type NodeHttpsBalanceRpcCredential =',
    'export interface NodeHttpsBalanceJsonRpcTransportConfig {',
    'export class NodeHttpsBalanceJsonRpcTransport implements BalanceJsonRpcTransport {',
    'exchange(request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown> {',
    "AbortSignal.prototype.addEventListener.call(signal, 'abort', onAbort, { once: true });",
    "AbortSignal.prototype.removeEventListener.call(signal, 'abort', state.abortListener);",
    'resolver = new dns.Resolver({',
    'maxTimeout: CONNECT_TIMEOUT_MS,',
    'timeout: CONNECT_TIMEOUT_MS,',
    'tries: 1,',
    'resolver.resolve4(hostname, (error, addresses) => finishFamily(4, error, addresses));',
    'resolver.resolve6(hostname, (error, addresses) => finishFamily(6, error, addresses));',
    'resolver.cancel();',
    'const clientRequest = https.request(',
    'agent: false,',
    'checkServerIdentity,',
    'family: address.family,',
    'lookup: (_hostname, options, callback) => {',
    'callback(null, [address]);',
    'callback(null, address.address, address.family);',
    "method: 'POST',",
    "minVersion: 'TLSv1.2',",
    'port: 443,',
    'rejectUnauthorized: true,',
    'servername: config.hostname,',
    'candidate.remoteAddress === expected.address &&',
    'normalizeRemoteFamily(candidate.remoteFamily) === expected.family &&',
    "if (headers.has('content-encoding') || headers.has('trailer')) return null;",
    "const transferEncodings = headers.get('transfer-encoding');",
    '(contentLengths === undefined) === (transferEncodings === undefined)',
    'response.httpVersionMajor,',
    'response.httpVersionMinor,',
    'httpVersionMajor !== 1 ||',
    'httpVersionMinor !== 1 ||',
    'transferEncodings.length !== 1 ||',
    "!/^chunked$/iu.test(transferEncodings[0] ?? '')",
    "return Object.freeze({ framing: 'CHUNKED' as const });",
    "if (contentLengths?.length !== 1 || !/^(?:[1-9][0-9]{0,6})$/u.test(rawContentLength ?? '')) {",
    'if (!Number.isSafeInteger(contentLength) || contentLength > MAX_JSON_BYTES) return null;',
    "return Object.freeze({ framing: 'CONTENT_LENGTH' as const, contentLength });",
    "metadata.framing === 'CONTENT_LENGTH' ? metadata.contentLength : MAX_JSON_BYTES;",
    'chunks.length >= MAX_RESPONSE_CHUNKS ||',
    'receivedBytes > maximumResponseBytes - buffer.length',
    '!response.complete ||',
    "(metadata.framing === 'CONTENT_LENGTH' && receivedBytes !== metadata.contentLength)",
    'if (!hasNoResponseTrailers(response.rawTrailers)) {',
    'return Array.isArray(rawTrailers) && rawTrailers.length === 0;',
    'const awaitRequestClose = state.request !== undefined && !state.requestClosed;',
    'const awaitResponseClose = state.response !== undefined && !state.responseClosed;',
    'state.closeTimer = scheduleTimer(finishFailure, IO_CLOSE_TIMEOUT_MS);',
    'timer.unref();',
  ] as const;
  const forbiddenEmbeddedEndpoint =
    /['"](?:https?|wss?):\/\/|\b(?:endpoint|rpcUrl|baseUrl|providerUrl|hostname|path)\b\s*(?:=|:)\s*['"]/iu;
  const forbiddenAssignedSecret =
    /\b(?:apiKey|token|password|secret|authorization|credential)\b\s*(?:=|:)\s*['"][^'"]+['"]/iu;
  const forbiddenEnvironment =
    /\b(?:process|Deno|Bun)\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|\bConfigService\b/u;
  const forbiddenProviderBinding =
    /@(?:Injectable|Module)\s*\(|\bproviders\s*:|\bprovide\s*:|\bnew\s+NodeHttpsBalanceJsonRpcTransport\s*\(/u;
  if (
    sortedTypeScriptImportTargets(transport).join('\0') !== expectedImports.join('\0') ||
    requiredSecurityLines.some((line) => exactExecutableLineCount(transport, line) !== 1) ||
    forbiddenEmbeddedEndpoint.test(transport) ||
    forbiddenAssignedSecret.test(transport) ||
    forbiddenEnvironment.test(transport) ||
    forbiddenProviderBinding.test(transport) ||
    /\bPromise\s*\.\s*race\s*\(|\b(?:retry|backoff)\s*\(/iu.test(transport)
  ) {
    return false;
  }

  const dormantIdentity =
    /\b(?:NodeHttpsBalanceJsonRpcTransport|NodeHttpsBalanceJsonRpcTransportConfig|NodeHttpsBalanceRpcNetworkId|NodeHttpsBalanceRpcCredential)\b|node-https-balance-json-rpc\.transport/u;
  const barrelCompositionRuntimeConfigTemplateAndReleaseSources = [
    sources.blockchainSyncIndexSource,
    sources.compositionSource,
    sources.balanceConsumerResourceSource,
    sources.balanceConsumerLifecycleSource,
    sources.runtimeSource,
    sources.activationSource,
    sources.cliSource,
    sources.cliModeSource,
    sources.balanceConsumerConfigSource,
    sources.infrastructureConfigSource,
    sources.blockchainSyncModuleSource,
    sources.appModuleSource,
    sources.applicationRootSource,
    sources.localDevelopmentAppModuleSource,
    sources.mainSource,
    sources.outboxWorkerCliSource,
    sources.redisSessionRevocationCliSource,
    sources.migrationCliSource,
    sources.applicationTemplateSource,
    sources.applicationValidatorSource,
    sources.workloadTemplateSource,
    sources.workloadValidatorSource,
    sources.balanceConsumerEnvelopeSource,
    sources.releaseManifestSource,
    sources.apiPackageSource,
    sources.rootPackageSource,
    sources.productionContainerValidatorSource,
  ] as const;
  return barrelCompositionRuntimeConfigTemplateAndReleaseSources.every(
    (source) => !dormantIdentity.test(source),
  );
}

function hasExactBalanceSyncExecutionCancellationContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const service = sources.balanceSyncConsumerServiceSource.replace(/\r\n/gu, '\n');
  const ports = sources.balanceSyncPortsSource.replace(/\r\n/gu, '\n');
  const composition = sources.compositionSource.replace(/\r\n/gu, '\n');
  const dispatcher = sources.reviewedJobDispatcherSource.replace(/\r\n/gu, '\n');
  const orchestrator = sources.balanceSyncOrchestratorSource.replace(/\r\n/gu, '\n');
  const router = sources.mainnetBalanceIndexerRouterSource.replace(/\r\n/gu, '\n');
  const coordinator = sources.mainnetBalanceTwoSourceAgreementCoordinatorSource.replace(
    /\r\n/gu,
    '\n',
  );
  const helper = sources.balanceJsonRpcSource.replace(/\r\n/gu, '\n');
  const ethereum = sources.ethereumBalanceIndexerSource.replace(/\r\n/gu, '\n');
  const solana = sources.solanaBalanceIndexerSource.replace(/\r\n/gu, '\n');
  const postgresService = sources.postgresServiceSource.replace(/\r\n/gu, '\n');
  const checkpointRepository = sources.balanceSyncCheckpointRepositorySource.replace(
    /\r\n/gu,
    '\n',
  );
  const walletAddressResolver = sources.balanceSyncWalletAddressResolverSource.replace(
    /\r\n/gu,
    '\n',
  );
  const persistenceResource = sources.balanceConsumerPersistenceResourceSource.replace(
    /\r\n/gu,
    '\n',
  );
  const index = sources.blockchainSyncIndexSource.replace(/\r\n/gu, '\n');
  const executionPathSources = [
    service,
    composition,
    dispatcher,
    orchestrator,
    router,
    coordinator,
    helper,
    ethereum,
    solana,
    index,
    postgresService,
    checkpointRepository,
    walletAddressResolver,
    persistenceResource,
  ] as const;
  const checkpointPortStart = ports.indexOf('export interface BalanceSyncCheckpointPort {');
  const checkpointPortEnd = ports.indexOf(
    'export interface BalanceSyncJobPort {',
    checkpointPortStart,
  );
  const resolverPortStart = ports.indexOf(
    'export interface BalanceSyncWalletAddressResolverPort {',
  );
  const resolverPortEnd = ports.indexOf(
    'export interface BalanceIndexerSourceCandidate {',
    resolverPortStart,
  );
  if (
    checkpointPortStart < 0 ||
    checkpointPortEnd <= checkpointPortStart ||
    resolverPortStart < 0 ||
    resolverPortEnd <= resolverPortStart
  ) {
    return false;
  }
  const checkpointPort = ports.slice(checkpointPortStart, checkpointPortEnd);
  const resolverPort = ports.slice(resolverPortStart, resolverPortEnd);

  const coordinatorSettle = coordinator.indexOf(
    'const [primaryResult, corroboratingResult] = await Promise.allSettled([',
  );
  const coordinatorPostAbort = coordinator.indexOf(
    'requireActiveAgreementExecution(context);',
    coordinatorSettle + 1,
  );
  const coordinatorStatus = coordinator.indexOf(
    "if (primaryResult.status !== 'fulfilled' || corroboratingResult.status !== 'fulfilled') {",
    coordinatorPostAbort,
  );
  const coordinatorValues = coordinator.indexOf(
    'const primaryValue = primaryResult.value;',
    coordinatorStatus,
  );

  const helperInitialReview = helper.indexOf('const execution = requireExecutionContext(context);');
  const helperInitialAbort = helper.indexOf(
    'throwIfExecutionAborted(execution);',
    helperInitialReview,
  );
  const helperRequest = helper.indexOf('const request = balanceRpcRequest(method, params);');
  const helperExchange = helper.indexOf(
    'response = await transport.exchange(request, execution.signal);',
  );
  const helperCatchAbort = helper.indexOf(
    'throwIfExecutionAborted(requireExecutionContext(context));',
    helperExchange,
  );
  const helperMappedFailure = helper.indexOf(
    'throwMappedTransportFailure(error);',
    helperCatchAbort,
  );
  const helperPostAbort = helper.indexOf(
    'throwIfExecutionAborted(requireExecutionContext(context));',
    helperCatchAbort + 1,
  );
  const helperParse = helper.indexOf('return parseBalanceRpcResult(response, request.id);');

  const everyAdapterRpcReceivesContext = (source: string, expectedCalls: number): boolean => {
    let cursor = 0;
    let calls = 0;
    while (true) {
      const start = source.indexOf('exchangeBalanceRpc(', cursor);
      if (start < 0) break;
      let depth = 0;
      let end = -1;
      for (let index = start + 'exchangeBalanceRpc'.length; index < source.length; index += 1) {
        const character = source[index];
        if (character === '(') depth += 1;
        if (character === ')') {
          depth -= 1;
          if (depth === 0) {
            end = index;
            break;
          }
        }
      }
      if (end < 0 || !/,\s*context,?\s*\)$/u.test(source.slice(start, end + 1))) return false;
      calls += 1;
      cursor = end + 1;
    }
    return calls === expectedCalls;
  };

  return (
    exactExecutableLineCount(
      ports,
      "export type BalanceSyncExecutionAbortKind = 'SHUTDOWN' | 'DEADLINE';",
    ) === 1 &&
    exactExecutableLineCount(ports, 'export interface BalanceSyncExecutionContext {') === 1 &&
    exactExecutableLineCount(ports, 'readonly signal: AbortSignal;') === 2 &&
    exactExecutableLineCount(
      ports,
      'const VERIFIED_BALANCE_SYNC_EXECUTION_CONTEXTS = new WeakMap<object, AbortSignal>();',
    ) === 1 &&
    exactExecutableLineCount(
      ports,
      'const VERIFIED_BALANCE_SYNC_ABORT_KINDS = new WeakMap<object, BalanceSyncExecutionAbortKind>();',
    ) === 1 &&
    exactExecutableLineCount(
      ports,
      'const context = frozenNullPrototype<BalanceSyncExecutionContext>({ signal });',
    ) === 1 &&
    exactExecutableLineCount(
      ports,
      'VERIFIED_BALANCE_SYNC_EXECUTION_CONTEXTS.set(context, signal);',
    ) === 1 &&
    exactExecutableLineCount(ports, 'Reflect.apply(ABORT_CONTROLLER_ABORT, controller, []);') ===
      1 &&
    exactExecutableLineCount(
      ports,
      'const signal = VERIFIED_BALANCE_SYNC_EXECUTION_CONTEXTS.get(value as object);',
    ) === 1 &&
    exactExecutableLineCount(
      ports,
      "abortKind: aborted ? (VERIFIED_BALANCE_SYNC_ABORT_KINDS.get(signal) ?? 'SHUTDOWN') : null,",
    ) === 1 &&
    exactExecutableLineCount(
      ports,
      'export const INERT_BALANCE_SYNC_EXECUTION_CONTEXT = INERT_BALANCE_SYNC_EXECUTION_OWNER.context;',
    ) === 1 &&
    exactExecutableLineCount(ports, 'context: BalanceSyncExecutionContext,') === 7 &&
    !/context\s*:\s*BalanceSyncExecutionContext\s*=/u.test(ports) &&
    exactExecutableLineCount(index, 'createBalanceSyncExecutionContext,') === 1 &&
    exactExecutableLineCount(index, 'reviewBalanceSyncExecutionContext,') === 1 &&
    exactExecutableLineCount(index, 'type BalanceSyncExecutionContext,') === 1 &&
    executionPathSources.every((source) => {
      const executable = trimmedExecutableLines(source).join('\n');
      return (
        !source.includes('INERT_BALANCE_SYNC_EXECUTION_CONTEXT') &&
        !/\b(?:await|return)\s+Promise\s*\.\s*race\s*\(/u.test(executable) &&
        !/\b(?:signal|parentSignal|runSignal|ownedExecution)\s*\.\s*reason\b/u.test(executable)
      );
    }) &&
    exactExecutableLineCount(
      service,
      'dispatch(value: unknown, context: BalanceSyncExecutionContext): Promise<void>;',
    ) === 1 &&
    service.includes(
      '/** Propagates one deadline through resolution, RPC, and checkpoint persistence. */',
    ) &&
    exactExecutableLineCount(service, 'jobTimeoutMs: 10_800_000,') === 1 &&
    exactExecutableLineCount(
      service,
      "const minimum = key === 'jobTimeoutMs' ? 7_200_000 : 10;",
    ) === 1 &&
    exactExecutableLineCount(
      service,
      "const maximum = key === 'jobTimeoutMs' ? 21_600_000 : 60_000;",
    ) === 1 &&
    !service.includes('maximumRpcWindowMs') &&
    exactExecutableLineCount(service, 'const owner = createBalanceSyncExecutionContext();') === 1 &&
    exactExecutableLineCount(
      service,
      "const relayShutdown = (): void => owner.abort('SHUTDOWN');",
    ) === 1 &&
    exactExecutableLineCount(
      service,
      "const deadline = setTimeout(() => owner.abort('DEADLINE'), this.policy.jobTimeoutMs);",
    ) === 1 &&
    exactExecutableLineCount(service, 'deadline.unref?.();') === 1 &&
    exactExecutableLineCount(service, 'await this.dispatcher.dispatch(job, owner.context);') ===
      1 &&
    exactExecutableLineCount(service, 'clearTimeout(deadline);') === 1 &&
    exactExecutableLineCount(service, 'if (listening) runSignal.remove(relayShutdown);') === 1 &&
    exactExecutableLineCount(
      composition,
      'const dispatcher = new BalanceSyncJobDispatcher(async (job, context) => {',
    ) === 1 &&
    exactExecutableLineCount(composition, 'await orchestrator.process(job, context);') === 1 &&
    exactExecutableLineCount(
      dispatcher,
      'async dispatch(value: unknown, context: BalanceSyncExecutionContext): Promise<void> {',
    ) === 1 &&
    exactExecutableLineCount(
      dispatcher,
      "if (reviewBalanceSyncExecutionContext(context) === null) return fail('JOB_HANDLER_FAILED');",
    ) === 1 &&
    exactExecutableLineCount(dispatcher, 'await this.handler(job, context);') === 1 &&
    !/dispatch\s*\(\s*value\s*:\s*unknown\s*,\s*context[^)]*=/u.test(dispatcher) &&
    exactExecutableLineCount(orchestrator, 'context: BalanceSyncExecutionContext,') === 6 &&
    exactExecutableLineCount(
      orchestrator,
      'const reviewed = reviewBalanceSyncExecutionContext(context);',
    ) === 1 &&
    exactExecutableLineCount(
      orchestrator,
      "if (reviewed === null) throw orchestratorError('INVALID_BALANCE_SYNC_JOB');",
    ) === 1 &&
    exactExecutableLineCount(orchestrator, 'requireActiveExecution(context);') === 28 &&
    exactExecutableLineCount(
      orchestrator,
      'const value = await this.indexer.readCurrent(request, context);',
    ) === 1 &&
    exactExecutableLineCount(
      orchestrator,
      'value = await this.indexer.rescanFromCheckpoint(request, context);',
    ) === 1 &&
    exactExecutableLineCount(
      orchestrator,
      'value = await this.checkpoints.load(scope, context);',
    ) === 1 &&
    /this\.checkpoints\.upsertCurrent\([\s\S]{0,420}\n\s*context,\n\s*\);/u.test(orchestrator) &&
    /this\.checkpoints\.replaceProvisionalAfterReorg\([\s\S]{0,420}\n\s*context,\n\s*\);/u.test(
      orchestrator,
    ) &&
    /this\.checkpoints\.preserveLastGoodAndMarkStale\([\s\S]{0,420}\n\s*context,\n\s*\);/u.test(
      orchestrator,
    ) &&
    exactExecutableLineCount(
      orchestrator,
      "if (failure?.code === 'PROVIDER_TIMEOUT' || failure?.code === 'PROVIDER_UNAVAILABLE') {",
    ) === 1 &&
    orchestrator.includes(
      "if (failure?.code === 'PROVIDER_TIMEOUT' || failure?.code === 'PROVIDER_UNAVAILABLE') {\n        throw new BalanceSyncIndexerFailure(failure.code);\n      }\n      throw new BalanceSyncIndexerFailure('REORG_RECOVERY_FAILED');",
    ) &&
    exactExecutableLineCount(router, 'requireExecutionContext(context);') === 2 &&
    exactExecutableLineCount(
      router,
      'return this.indexerFor(validated.networkId).readCurrent(validated, context);',
    ) === 1 &&
    exactExecutableLineCount(
      router,
      'return this.indexerFor(validated.networkId).rescanFromCheckpoint(validated, context);',
    ) === 1 &&
    exactExecutableLineCount(
      router,
      'Reflect.apply(readCurrent, receiver, [request, context]) as Promise<unknown>,',
    ) === 1 &&
    exactExecutableLineCount(
      router,
      'Reflect.apply(rescanFromCheckpoint, receiver, [request, context]) as Promise<unknown>,',
    ) === 1 &&
    coordinatorSettle >= 0 &&
    coordinatorPostAbort > coordinatorSettle &&
    coordinatorStatus > coordinatorPostAbort &&
    coordinatorValues > coordinatorStatus &&
    exactExecutableLineCount(coordinator, 'requireActiveAgreementExecution(context);') === 2 &&
    exactExecutableLineCount(coordinator, 'primaryBinding.readCurrent(request, context),') === 1 &&
    exactExecutableLineCount(coordinator, 'corroboratingBinding.readCurrent(request, context),') ===
      1 &&
    exactExecutableLineCount(
      coordinator,
      'Reflect.apply(capturedReader.method, capturedReader.receiver, [request, context]),',
    ) === 1 &&
    !/Promise\s*\.\s*all\s*\(/u.test(coordinator) &&
    !/\.(?:reason)\b/u.test(coordinator) &&
    exactExecutableLineCount(
      helper,
      'exchange(request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown>;',
    ) === 1 &&
    helper.includes(
      'A transport must cooperatively stop and reject promptly when `signal` aborts;',
    ) &&
    helperInitialReview >= 0 &&
    helperInitialAbort > helperInitialReview &&
    helperRequest > helperInitialAbort &&
    helperExchange > helperRequest &&
    helperCatchAbort > helperExchange &&
    helperMappedFailure > helperCatchAbort &&
    helperPostAbort > helperMappedFailure &&
    helperParse > helperPostAbort &&
    exactExecutableLineCount(
      helper,
      'throwIfExecutionAborted(requireExecutionContext(context));',
    ) === 2 &&
    exactExecutableLineCount(helper, "case 'DEADLINE':") === 1 &&
    exactExecutableLineCount(helper, "throw new BalanceSyncIndexerFailure('PROVIDER_TIMEOUT');") ===
      2 &&
    exactExecutableLineCount(helper, "case 'SHUTDOWN':") === 1 &&
    !/implements\s+BalanceJsonRpcTransport\b/u.test(helper) &&
    everyAdapterRpcReceivesContext(ethereum, 4) &&
    everyAdapterRpcReceivesContext(solana, 4) &&
    exactExecutableLineCount(ethereum, 'requireActiveExecution(context);') === 8 &&
    exactExecutableLineCount(solana, 'requireActiveExecution(context);') === 8 &&
    exactExecutableLineCount(
      ethereum,
      'const reviewed = reviewBalanceSyncExecutionContext(context);',
    ) === 1 &&
    exactExecutableLineCount(
      solana,
      'const reviewed = reviewBalanceSyncExecutionContext(context);',
    ) === 1 &&
    exactExecutableLineCount(
      ethereum,
      "reviewed?.abortKind === 'DEADLINE' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',",
    ) === 1 &&
    exactExecutableLineCount(
      solana,
      "reviewed?.abortKind === 'DEADLINE' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',",
    ) === 1 &&
    exactExecutableLineCount(resolverPort, 'context: BalanceSyncExecutionContext,') === 1 &&
    exactExecutableLineCount(checkpointPort, 'context: BalanceSyncExecutionContext,') === 4 &&
    !/\bAbortSignal\b/u.test(resolverPort) &&
    !/\bAbortSignal\b/u.test(checkpointPort) &&
    /this\.addresses\.resolveActiveAddress\([\s\S]{0,300}ETHEREUM_MAINNET_NETWORK_ID,[\s\S]{0,80}\n\s*context,\n\s*\);/u.test(
      ethereum,
    ) &&
    /this\.addresses\.resolveActiveAddress\([\s\S]{0,300}SOLANA_MAINNET_NETWORK_ID,[\s\S]{0,80}\n\s*context,\n\s*\);/u.test(
      solana,
    )
  );
}

function hasDormantBalanceConsumerAggregateResourceContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const resource = sources.balanceConsumerResourceSource.replace(/\r\n/gu, '\n');
  const dependencyInterfaceStart = resource.indexOf(
    'export interface DormantBalanceSyncConsumerResourceDependencies {',
  );
  const resourceInterfaceStart = resource.indexOf(
    'export interface DormantBalanceSyncConsumerResource {',
    dependencyInterfaceStart,
  );
  const configurationErrorStart = resource.indexOf(
    'class BalanceSyncConsumerResourceConfigurationError extends Error {',
    resourceInterfaceStart,
  );
  const infrastructureSnapshotStart = resource.indexOf(
    'function snapshotInfrastructure(value: unknown): Readonly<BalanceConsumerInfrastructureConfig> {',
    configurationErrorStart,
  );
  const reviewedDependenciesStart = resource.indexOf(
    'function reviewedDependencies(value: unknown): ReviewedDependencies {',
    infrastructureSnapshotStart,
  );
  const childFacadeReviewStart = resource.indexOf(
    'function ownedFrozenNullPrototypeRecord(',
    reviewedDependenciesStart,
  );
  const factoryStart = resource.indexOf(
    'export async function createDormantBalanceSyncConsumerResource(',
    childFacadeReviewStart,
  );
  if (
    dependencyInterfaceStart < 0 ||
    resourceInterfaceStart <= dependencyInterfaceStart ||
    configurationErrorStart <= resourceInterfaceStart ||
    infrastructureSnapshotStart <= configurationErrorStart ||
    reviewedDependenciesStart <= infrastructureSnapshotStart ||
    childFacadeReviewStart <= reviewedDependenciesStart ||
    factoryStart <= childFacadeReviewStart
  ) {
    return false;
  }

  const dependencyInterface = resource.slice(dependencyInterfaceStart, resourceInterfaceStart);
  const resourceInterface = resource.slice(resourceInterfaceStart, configurationErrorStart);
  const infrastructureSnapshot = resource.slice(
    infrastructureSnapshotStart,
    reviewedDependenciesStart,
  );
  const reviewedDependencies = resource.slice(reviewedDependenciesStart, childFacadeReviewStart);
  const childFacadeReview = resource.slice(childFacadeReviewStart, factoryStart);
  const factory = resource.slice(factoryStart);

  const persistenceReviewStart = childFacadeReview.indexOf('function reviewedPersistenceResource(');
  const persistenceCloseRetention = childFacadeReview.indexOf(
    'retainClose(close);',
    persistenceReviewStart,
  );
  const persistencePortReview = childFacadeReview.indexOf(
    'const checkpoints = ownedFrozenNullPrototypeRecord(resource.checkpoints, [',
    persistenceCloseRetention,
  );
  const sqsReviewStart = childFacadeReview.indexOf(
    'function reviewedSqsReceiptResource(',
    persistencePortReview,
  );
  const sqsCloseRetention = childFacadeReview.indexOf('retainClose(close);', sqsReviewStart);
  const receiptPortReview = childFacadeReview.indexOf(
    'const receipt = ownedFrozenNullPrototypeRecord(resource.receipt, [',
    sqsCloseRetention,
  );

  const reviewedSnapshot = factory.indexOf('const reviewed = reviewedDependencies(dependencies);');
  const persistenceConstruction = factory.indexOf(
    'await createDormantBalanceConsumerPersistenceResource(',
    reviewedSnapshot,
  );
  const persistenceCloseCapture = factory.indexOf(
    'persistenceClose = close;',
    persistenceConstruction,
  );
  const sqsConstruction = factory.indexOf(
    'await createDormantBalanceConsumerSqsReceiptResource(reviewed.infrastructure),',
    persistenceCloseCapture,
  );
  const sqsCloseCapture = factory.indexOf('sqsClose = close;', sqsConstruction);
  const compositionConstruction = factory.indexOf(
    'const composition = createBalanceSyncConsumerComposition({',
    sqsCloseCapture,
  );

  const runStart = factory.indexOf(
    'const run = (signal: AbortSignal): Promise<void> => {',
    compositionConstruction,
  );
  const runClosedGuard = factory.indexOf(
    'if (closed) return Promise.reject(new BalanceSyncConsumerResourceClosedError());',
    runStart,
  );
  const runStartedGuard = factory.indexOf('if (started) {', runClosedGuard);
  const signalReview = factory.indexOf('supplied = reviewedAbortSignal(signal);', runStartedGuard);
  const privateController = factory.indexOf(
    'const controller = new AbortController();',
    signalReview,
  );
  const callerListener = factory.indexOf(
    'supplied.addAbortListener(relayAbort);',
    privateController,
  );
  const callerAbortRecheck = factory.indexOf(
    'if (supplied.aborted()) relayAbort();',
    callerListener,
  );
  const startedTransition = factory.indexOf('started = true;', callerAbortRecheck);
  const runGate = factory.indexOf(
    'const startGate = new Promise<void>((resolve) => {',
    startedTransition,
  );
  const consumerRun = factory.indexOf(
    '.then(() => composition.consumer.run(controller.signal))',
    runGate,
  );
  const runFailureSanitization = factory.indexOf(
    'throw new BalanceSyncConsumerResourceRunError();',
    consumerRun,
  );
  const runFinalizer = factory.indexOf('.finally(() => {', runFailureSanitization);
  const callerListenerRemoval = factory.indexOf(
    'supplied.removeAbortListener(relayAbort);',
    runFinalizer,
  );
  const activeControllerPublication = factory.indexOf(
    'activeRunController = controller;',
    callerListenerRemoval,
  );
  const activeRunPublication = factory.indexOf(
    'activeRun = operation;',
    activeControllerPublication,
  );
  const runRelease = factory.indexOf('startRun();', activeRunPublication);

  const closeStart = factory.indexOf('const close = (): Promise<void> => {', runRelease);
  const closeTransition = factory.indexOf('closed = true;', closeStart);
  const closeMemoizationGuard = factory.indexOf(
    'if (closePromise !== undefined) return closePromise;',
    closeTransition,
  );
  const acceptedRunSnapshot = factory.indexOf(
    'const acceptedRun = activeRun;',
    closeMemoizationGuard,
  );
  const acceptedRunControllerSnapshot = factory.indexOf(
    'const acceptedRunController = activeRunController;',
    acceptedRunSnapshot,
  );
  const publicCloseConstruction = factory.indexOf(
    'const publicClose = new Promise<void>((resolve, reject) => {',
    acceptedRunControllerSnapshot,
  );
  const closePromisePublication = factory.indexOf(
    'closePromise = publicClose;',
    publicCloseConstruction,
  );
  const cleanupConstruction = factory.indexOf(
    'const cleanup = new Promise<void>((resolve) => {',
    closePromisePublication,
  );
  const acceptedRunDrain = factory.indexOf(
    'if (acceptedRun !== undefined) await Promise.allSettled([acceptedRun]);',
    cleanupConstruction,
  );
  const sqsClose = factory.indexOf(
    'const sqsClosed = await attemptClose(resourceSqsClose);',
    acceptedRunDrain,
  );
  const persistenceClose = factory.indexOf(
    'const persistenceClosed = await attemptClose(resourcePersistenceClose);',
    sqsClose,
  );
  const closeFailureSanitization = factory.indexOf(
    'throw new BalanceSyncConsumerResourceCloseError();',
    persistenceClose,
  );
  const shutdownWatchdog = factory.indexOf(
    'shutdownTimeout = scheduleShutdownTimeout(() => {',
    closeFailureSanitization,
  );
  const shutdownTimeoutRejection = factory.indexOf(
    'rejectClose(new BalanceSyncConsumerResourceShutdownDrainTimeoutError());',
    shutdownWatchdog,
  );
  const shutdownWatchdogUnref = factory.indexOf(
    'shutdownTimeout.unref?.();',
    shutdownTimeoutRejection,
  );
  const observedCleanup = factory.indexOf('void cleanup.then(', shutdownWatchdogUnref);
  const clearShutdownWatchdog = factory.indexOf('clearWatchdog();', observedCleanup);
  const privateCloseAbort = factory.indexOf(
    "acceptedRunController?.abort(new Error('Balance sync consumer resource closed'));",
    observedCleanup,
  );
  const closeRelease = factory.indexOf('startCleanup();', privateCloseAbort);
  const closePromiseReturn = factory.indexOf('return publicClose;', closeRelease);
  const facadeReturn = factory.indexOf(
    'return frozenNullPrototype<DormantBalanceSyncConsumerResource>({ run, close });',
    closePromiseReturn,
  );
  const constructionSqsCleanup = factory.indexOf('await attemptClose(sqsClose);', facadeReturn);
  const constructionPersistenceCleanup = factory.indexOf(
    'await attemptClose(persistenceClose);',
    constructionSqsCleanup,
  );

  if (
    persistenceReviewStart < 0 ||
    persistenceCloseRetention <= persistenceReviewStart ||
    persistencePortReview <= persistenceCloseRetention ||
    sqsReviewStart <= persistencePortReview ||
    sqsCloseRetention <= sqsReviewStart ||
    receiptPortReview <= sqsCloseRetention ||
    reviewedSnapshot < 0 ||
    persistenceConstruction <= reviewedSnapshot ||
    persistenceCloseCapture <= persistenceConstruction ||
    sqsConstruction <= persistenceCloseCapture ||
    sqsCloseCapture <= sqsConstruction ||
    compositionConstruction <= sqsCloseCapture ||
    runStart <= compositionConstruction ||
    runClosedGuard <= runStart ||
    runStartedGuard <= runClosedGuard ||
    signalReview <= runStartedGuard ||
    privateController <= signalReview ||
    callerListener <= privateController ||
    callerAbortRecheck <= callerListener ||
    startedTransition <= callerAbortRecheck ||
    runGate <= startedTransition ||
    consumerRun <= runGate ||
    runFailureSanitization <= consumerRun ||
    runFinalizer <= runFailureSanitization ||
    callerListenerRemoval <= runFinalizer ||
    activeControllerPublication <= callerListenerRemoval ||
    activeRunPublication <= activeControllerPublication ||
    runRelease <= activeRunPublication ||
    closeStart <= runRelease ||
    closeTransition <= closeStart ||
    closeMemoizationGuard <= closeTransition ||
    acceptedRunSnapshot <= closeMemoizationGuard ||
    acceptedRunControllerSnapshot <= acceptedRunSnapshot ||
    publicCloseConstruction <= acceptedRunControllerSnapshot ||
    closePromisePublication <= publicCloseConstruction ||
    cleanupConstruction <= closePromisePublication ||
    acceptedRunDrain <= cleanupConstruction ||
    sqsClose <= acceptedRunDrain ||
    persistenceClose <= sqsClose ||
    closeFailureSanitization <= persistenceClose ||
    shutdownWatchdog <= closeFailureSanitization ||
    shutdownTimeoutRejection <= shutdownWatchdog ||
    shutdownWatchdogUnref <= shutdownTimeoutRejection ||
    observedCleanup <= shutdownWatchdogUnref ||
    clearShutdownWatchdog <= observedCleanup ||
    privateCloseAbort <= observedCleanup ||
    closeRelease <= privateCloseAbort ||
    closePromiseReturn <= closeRelease ||
    facadeReturn <= closePromiseReturn ||
    constructionSqsCleanup <= facadeReturn ||
    constructionPersistenceCleanup <= constructionSqsCleanup
  ) {
    return false;
  }

  const fixedErrors = [
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_CONFIGURATION_INVALID' as const;",
      "super('Balance sync consumer resource configuration is invalid');",
      "this.name = 'BalanceSyncConsumerResourceConfigurationError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_CONSTRUCTION_FAILED' as const;",
      "super('Balance sync consumer resource construction failed');",
      "this.name = 'BalanceSyncConsumerResourceConstructionError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_RUN_FAILED' as const;",
      "super('Balance sync consumer resource run failed');",
      "this.name = 'BalanceSyncConsumerResourceRunError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_ALREADY_STARTED' as const;",
      "super('Balance sync consumer resource is already started');",
      "this.name = 'BalanceSyncConsumerResourceAlreadyStartedError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_SIGNAL_INVALID' as const;",
      "super('Balance sync consumer resource signal is invalid');",
      "this.name = 'BalanceSyncConsumerResourceSignalError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_CLOSED' as const;",
      "super('Balance sync consumer resource is closed');",
      "this.name = 'BalanceSyncConsumerResourceClosedError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_CLOSE_FAILED' as const;",
      "super('Balance sync consumer resource close failed');",
      "this.name = 'BalanceSyncConsumerResourceCloseError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_RESOURCE_SHUTDOWN_DRAIN_TIMEOUT' as const;",
      "super('Balance sync consumer resource shutdown drain timed out');",
      "this.name = 'BalanceSyncConsumerResourceShutdownDrainTimeoutError';",
    ],
  ] as const;
  const launchAndBarrelSources = [
    sources.runtimeSource,
    sources.cliSource,
    sources.cliModeSource,
    sources.activationSource,
    sources.compositionSource,
    sources.blockchainSyncIndexSource,
    sources.blockchainSyncModuleSource,
    sources.sqsModuleSource,
    sources.appModuleSource,
    sources.applicationRootSource,
    sources.localDevelopmentAppModuleSource,
    sources.mainSource,
    sources.outboxWorkerCliSource,
    sources.redisSessionRevocationCliSource,
    sources.migrationCliSource,
    sources.apiPackageSource,
    sources.rootPackageSource,
    sources.applicationTemplateSource,
    sources.workloadTemplateSource,
    sources.balanceConsumerEnvelopeSource,
    sources.releaseManifestSource,
    sources.productionContainerValidatorSource,
  ];

  return (
    trimmedExecutableLines(resource).filter((line) => line.startsWith('export ')).length === 3 &&
    trimmedExecutableLines(dependencyInterface).filter((line) => line.startsWith('readonly '))
      .length === 7 &&
    exactExecutableLineCount(
      dependencyInterface,
      'readonly infrastructureConfig: BalanceConsumerInfrastructureConfig;',
    ) === 1 &&
    exactExecutableLineCount(
      dependencyInterface,
      'readonly balanceConsumerConfig: EnabledBalanceConsumerConfig;',
    ) === 1 &&
    exactExecutableLineCount(dependencyInterface, 'readonly observability: ObservabilityPort;') ===
      1 &&
    exactExecutableLineCount(
      dependencyInterface,
      'readonly ethereumTransport: BalanceJsonRpcTransport;',
    ) === 1 &&
    exactExecutableLineCount(
      dependencyInterface,
      'readonly solanaTransport: BalanceJsonRpcTransport;',
    ) === 1 &&
    exactExecutableLineCount(dependencyInterface, 'readonly clock: BalanceSyncClockPort;') === 1 &&
    exactExecutableLineCount(dependencyInterface, 'readonly metrics: BalanceSyncMetricsPort;') ===
      1 &&
    trimmedExecutableLines(resourceInterface).filter((line) => line.startsWith('readonly '))
      .length === 2 &&
    exactExecutableLineCount(
      resourceInterface,
      'readonly run: (signal: AbortSignal) => Promise<void>;',
    ) === 1 &&
    exactExecutableLineCount(resourceInterface, 'readonly close: () => Promise<void>;') === 1 &&
    exactExecutableLineCount(
      resource,
      "} from '../infrastructure/postgres/balance-consumer-persistence.resource';",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "} from '../infrastructure/sqs/balance-consumer-sqs-receipt.resource';",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "import { createBalanceSyncConsumerComposition } from './balance-sync-consumer.composition';",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;',
    ) === 2 &&
    exactExecutableLineCount(
      infrastructureSnapshot,
      "if (infrastructure.workload !== 'balance-consumer') return invalidConfiguration();",
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureSnapshot,
      "'endpoint' in sqs === 'credentialRelativeUri' in sqs ||",
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureSnapshot,
      'sqs.maxReceiveCount !== BALANCE_SYNC_POLICY.maxAttempts ||',
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureSnapshot,
      'sqs.retryBaseDelaySeconds !== BALANCE_SYNC_POLICY.retryBaseDelaySeconds ||',
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureSnapshot,
      'sqs.retryMaxDelaySeconds !== BALANCE_SYNC_POLICY.retryMaximumDelaySeconds',
    ) === 1 &&
    exactExecutableLineCount(
      infrastructureSnapshot,
      'database: snapshotDatabase(infrastructure.database),',
    ) === 1 &&
    exactExecutableLineCount(infrastructureSnapshot, 'return Object.freeze({') === 1 &&
    exactExecutableLineCount(infrastructureSnapshot, 'sqs: Object.freeze({') === 1 &&
    exactExecutableLineCount(
      resource,
      "if (record.sessionRole !== 'crypto_balance_consumer_runtime') return invalidConfiguration();",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "activeWalletRegistrationKey(walletMetadataSealKeys).purpose !== 'metadata-seal'",
    ) === 1 &&
    exactExecutableLineCount(
      reviewedDependencies,
      'const dependencies = exactDataRecord(value, DEPENDENCY_KEYS);',
    ) === 1 &&
    exactExecutableLineCount(
      reviewedDependencies,
      'infrastructure: snapshotInfrastructure(dependencies.infrastructureConfig),',
    ) === 1 &&
    exactExecutableLineCount(
      reviewedDependencies,
      'balanceConsumer: snapshotBalanceConsumerConfig(dependencies.balanceConsumerConfig),',
    ) === 1 &&
    exactExecutableLineCount(reviewedDependencies, 'return Object.freeze({') === 1 &&
    exactExecutableLineCount(
      childFacadeReview,
      'if (Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) {',
    ) === 1 &&
    exactExecutableLineCount(childFacadeReview, 'descriptor.configurable !== false ||') === 1 &&
    exactExecutableLineCount(childFacadeReview, 'descriptor.writable !== false') === 1 &&
    exactExecutableLineCount(childFacadeReview, 'retainClose(close);') === 2 &&
    exactExecutableLineCount(factory, 'reviewed.infrastructure,') === 1 &&
    exactExecutableLineCount(
      factory,
      'await createDormantBalanceConsumerSqsReceiptResource(reviewed.infrastructure),',
    ) === 1 &&
    exactExecutableLineCount(
      factory,
      'visibilityTimeoutSeconds: reviewed.infrastructure.sqs.visibilityTimeoutSeconds,',
    ) === 1 &&
    exactExecutableLineCount(factory, 'sqs: sqs.receipt,') === 1 &&
    exactExecutableLineCount(
      factory,
      'walletAddressResolver: persistence.walletAddressResolver,',
    ) === 1 &&
    exactExecutableLineCount(factory, 'checkpoints: persistence.checkpoints,') === 1 &&
    exactExecutableLineCount(factory, 'let started = false;') === 1 &&
    exactExecutableLineCount(factory, 'started = true;') === 1 &&
    !/^\s*started\s*=\s*false;/mu.test(factory) &&
    exactExecutableLineCount(
      resource,
      "const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "EventTarget.prototype.addEventListener.call(value, 'abort', listener, { once: true });",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "EventTarget.prototype.removeEventListener.call(value, 'abort', listener);",
    ) === 1 &&
    exactExecutableLineCount(
      factory,
      "controller.abort(new Error('Balance sync consumer run aborted'));",
    ) === 1 &&
    exactExecutableLineCount(factory, 'supplied.removeAbortListener(relayAbort);') === 2 &&
    exactExecutableLineCount(
      factory,
      'if (acceptedRun !== undefined) await Promise.allSettled([acceptedRun]);',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'const BALANCE_SYNC_CONSUMER_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000;',
    ) === 1 &&
    exactExecutableLineCount(
      factory,
      'const scheduleShutdownTimeout = globalThis.setTimeout.bind(globalThis);',
    ) === 1 &&
    exactExecutableLineCount(
      factory,
      'const clearShutdownTimeout = globalThis.clearTimeout.bind(globalThis);',
    ) === 1 &&
    exactExecutableLineCount(factory, 'closePromise = publicClose;') === 1 &&
    exactExecutableLineCount(
      factory,
      'let shutdownTimeout: ReturnType<typeof setTimeout> | undefined;',
    ) === 1 &&
    exactExecutableLineCount(factory, 'const clearWatchdog = (): void => {') === 1 &&
    exactExecutableLineCount(factory, 'clearShutdownTimeout(shutdownTimeout);') === 1 &&
    exactExecutableLineCount(factory, 'shutdownTimeout.unref?.();') === 1 &&
    exactExecutableLineCount(factory, 'clearWatchdog();') === 2 &&
    exactExecutableLineCount(factory, 'if (publicCloseSettled) return;') === 3 &&
    exactExecutableLineCount(factory, 'void cleanup.then(') === 1 &&
    exactExecutableLineCount(factory, 'return publicClose;') === 1 &&
    exactExecutableLineCount(
      resource,
      'return Object.freeze(Object.assign(Object.create(null) as T, members));',
    ) === 1 &&
    exactExecutableLineCount(
      factory,
      'return frozenNullPrototype<DormantBalanceSyncConsumerResource>({ run, close });',
    ) === 1 &&
    fixedErrors.every((binding) =>
      binding.every((line) => exactExecutableLineCount(resource, line) === 1),
    ) &&
    !/\b(?:AbortSignal\.any|loadBalanceConsumerConfig|loadBalanceConsumerInfrastructureConfig|loadInfrastructureConfig|InfrastructureConfigModule|NestFactory|PostgresService|SQSClient|SqsModule|SqsService|SqsQueueReceiptTransport|PinnedSqsQueueReceiptAdapter|createPostgresPool|createRawSqsClient|ReceiveMessageCommand|DeleteMessageCommand|ChangeMessageVisibilityCommand|XMLHttpRequest|WebSocket|axios|undici)\b/u.test(
      resource,
    ) &&
    !/(?:@aws-sdk\/|from ['"]pg['"]|node:(?:http|https|net|tls)|process\.env|\bfetch\s*\(|\bset(?:Interval|Timeout)\s*\(|\bcreateApplicationContext\s*\(|@Module\s*\(|\.listen\s*\(|\.reason\b)/u.test(
      resource,
    ) &&
    !factory.includes('dependencies.infrastructureConfig') &&
    !factory.includes('dependencies.balanceConsumerConfig') &&
    !factory.includes('snapshotInfrastructure(') &&
    !factory.includes('Promise.all([') &&
    !factory.includes('Promise.race(') &&
    !/\bcause\s*[:=]/u.test(resource) &&
    launchAndBarrelSources.every(
      (source) =>
        !source.includes('createDormantBalanceSyncConsumerResource') &&
        !source.includes('DormantBalanceSyncConsumerResource') &&
        !source.includes('balance-sync-consumer.resource'),
    )
  );
}

function hasDormantBalanceConsumerLifecycleCoordinatorContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const lifecycle = sources.balanceConsumerLifecycleSource.replace(/\r\n/gu, '\n');
  const eventTypeStart = lifecycle.indexOf('export type BalanceSyncConsumerLifecycleEvent =');
  const operatorInterfaceStart = lifecycle.indexOf(
    'export interface BalanceSyncConsumerLifecycleOperatorPort {',
    eventTypeStart,
  );
  const dependenciesInterfaceStart = lifecycle.indexOf(
    'export interface DormantBalanceSyncConsumerLifecycleDependencies {',
    operatorInterfaceStart,
  );
  const coordinatorInterfaceStart = lifecycle.indexOf(
    'export interface DormantBalanceSyncConsumerLifecycleCoordinator {',
    dependenciesInterfaceStart,
  );
  const configurationErrorStart = lifecycle.indexOf(
    'class BalanceSyncConsumerLifecycleConfigurationError extends Error {',
    coordinatorInterfaceStart,
  );
  const exactDataRecordStart = lifecycle.indexOf(
    'function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {',
    configurationErrorStart,
  );
  const reviewedResourceStart = lifecycle.indexOf(
    'function reviewedResource(value: unknown): Readonly<{',
    exactDataRecordStart,
  );
  const reviewedSignalStart = lifecycle.indexOf(
    'function reviewedSignal(value: unknown): ReviewedSignal {',
    reviewedResourceStart,
  );
  const reviewedOperatorStart = lifecycle.indexOf(
    'function reviewedOperatorPort(',
    reviewedSignalStart,
  );
  const reviewedDependenciesStart = lifecycle.indexOf(
    'function reviewedDependencies(value: unknown): ReviewedDependencies {',
    reviewedOperatorStart,
  );
  const frozenNullPrototypeStart = lifecycle.indexOf(
    'function frozenNullPrototype<T extends object>(members: T): Readonly<T> {',
    reviewedDependenciesStart,
  );
  const lifecycleEventStart = lifecycle.indexOf(
    'function lifecycleEvent(',
    frozenNullPrototypeStart,
  );
  const recordEventStart = lifecycle.indexOf('function recordEvent(', lifecycleEventStart);
  const closeResourceStart = lifecycle.indexOf(
    'async function closeResource(close: () => Promise<void>): Promise<boolean> {',
    recordEventStart,
  );
  const executeLifecycleStart = lifecycle.indexOf(
    'async function executeLifecycle(reviewed: ReviewedDependencies): Promise<void> {',
    closeResourceStart,
  );
  const factoryStart = lifecycle.indexOf(
    'export function createDormantBalanceSyncConsumerLifecycleCoordinator(',
    executeLifecycleStart,
  );
  if (
    eventTypeStart < 0 ||
    operatorInterfaceStart <= eventTypeStart ||
    dependenciesInterfaceStart <= operatorInterfaceStart ||
    coordinatorInterfaceStart <= dependenciesInterfaceStart ||
    configurationErrorStart <= coordinatorInterfaceStart ||
    exactDataRecordStart <= configurationErrorStart ||
    reviewedResourceStart <= exactDataRecordStart ||
    reviewedSignalStart <= reviewedResourceStart ||
    reviewedOperatorStart <= reviewedSignalStart ||
    reviewedDependenciesStart <= reviewedOperatorStart ||
    frozenNullPrototypeStart <= reviewedDependenciesStart ||
    lifecycleEventStart <= frozenNullPrototypeStart ||
    recordEventStart <= lifecycleEventStart ||
    closeResourceStart <= recordEventStart ||
    executeLifecycleStart <= closeResourceStart ||
    factoryStart <= executeLifecycleStart
  ) {
    return false;
  }

  const eventType = lifecycle.slice(eventTypeStart, operatorInterfaceStart);
  const operatorInterface = lifecycle.slice(operatorInterfaceStart, dependenciesInterfaceStart);
  const dependenciesInterface = lifecycle.slice(
    dependenciesInterfaceStart,
    coordinatorInterfaceStart,
  );
  const coordinatorInterface = lifecycle.slice(coordinatorInterfaceStart, configurationErrorStart);
  const exactDataRecord = lifecycle.slice(exactDataRecordStart, reviewedResourceStart);
  const reviewedResource = lifecycle.slice(reviewedResourceStart, reviewedSignalStart);
  const reviewedSignal = lifecycle.slice(reviewedSignalStart, reviewedOperatorStart);
  const reviewedOperator = lifecycle.slice(reviewedOperatorStart, reviewedDependenciesStart);
  const reviewedDependencies = lifecycle.slice(reviewedDependenciesStart, frozenNullPrototypeStart);
  const lifecycleEventFactory = lifecycle.slice(lifecycleEventStart, recordEventStart);
  const recordEvent = lifecycle.slice(recordEventStart, closeResourceStart);
  const closeResource = lifecycle.slice(closeResourceStart, executeLifecycleStart);
  const executeLifecycle = lifecycle.slice(executeLifecycleStart, factoryStart);
  const factory = lifecycle.slice(factoryStart);

  const privateController = executeLifecycle.indexOf('const controller = new AbortController();');
  const stopState = executeLifecycle.indexOf('let stopRequested = false;', privateController);
  const listeningState = executeLifecycle.indexOf('let listening = false;', stopState);
  const runHandoffState = executeLifecycle.indexOf(
    'let runHandoffComplete = false;',
    listeningState,
  );
  const closeOperationState = executeLifecycle.indexOf(
    'let closeOperation: Promise<boolean> | undefined;',
    runHandoffState,
  );
  const progressConstruction = executeLifecycle.indexOf(
    'const progress = new Promise<void>((resolve) => {',
    closeOperationState,
  );
  const beginClose = executeLifecycle.indexOf(
    'const beginClose = (): Promise<boolean> => {',
    progressConstruction,
  );
  const closeMemoization = executeLifecycle.indexOf(
    'if (closeOperation !== undefined) return closeOperation;',
    beginClose,
  );
  const closeStart = executeLifecycle.indexOf(
    'closeOperation = closeResource(reviewed.closeResource);',
    closeMemoization,
  );
  const closeObservation = executeLifecycle.indexOf('void closeOperation.then(() => {', closeStart);
  const requestStop = executeLifecycle.indexOf(
    'const requestStop = (): void => {',
    closeObservation,
  );
  const duplicateStopGuard = executeLifecycle.indexOf('if (stopRequested) return;', requestStop);
  const stopTransition = executeLifecycle.indexOf('stopRequested = true;', duplicateStopGuard);
  const privateAbort = executeLifecycle.indexOf(
    "controller.abort(new Error('Balance sync consumer lifecycle stop requested'));",
    stopTransition,
  );
  const closeOnStop = executeLifecycle.indexOf(
    'if (runHandoffComplete) void beginClose();',
    privateAbort,
  );
  const initialSignalRead = executeLifecycle.indexOf(
    'if (reviewed.signal.aborted()) {',
    closeOnStop,
  );
  const initialStopRequest = executeLifecycle.indexOf('requestStop();', initialSignalRead);
  const listenerAttach = executeLifecycle.indexOf(
    'reviewed.signal.addAbortListener(requestStop);',
    initialStopRequest,
  );
  const listeningTransition = executeLifecycle.indexOf('listening = true;', listenerAttach);
  const signalRecheck = executeLifecycle.indexOf(
    'if (reviewed.signal.aborted()) requestStop();',
    listeningTransition,
  );
  const setupFailureCleanup = executeLifecycle.indexOf(
    'reviewed.signal.removeAbortListener(requestStop);',
    signalRecheck,
  );
  const setupFailureClose = executeLifecycle.indexOf(
    'const closed = await closeResource(reviewed.closeResource);',
    setupFailureCleanup,
  );
  const setupCloseEvent = executeLifecycle.indexOf(
    "recordEvent(reviewed.recordEvent, 'CLOSE_FAILED');",
    setupFailureClose,
  );
  const setupCloseError = executeLifecycle.indexOf(
    'throw new BalanceSyncConsumerLifecycleCloseError();',
    setupCloseEvent,
  );
  const signalError = executeLifecycle.indexOf(
    'throw new BalanceSyncConsumerLifecycleSignalError();',
    setupCloseError,
  );
  const runFailureState = executeLifecycle.indexOf('let runFailed = false;', signalError);
  const runSettledState = executeLifecycle.indexOf('let runSettled = false;', runFailureState);
  const runFailureReportedState = executeLifecycle.indexOf(
    'let runFailureReported = false;',
    runSettledState,
  );
  const runOperationState = executeLifecycle.indexOf(
    'let runOperation: Promise<void> | undefined;',
    runFailureReportedState,
  );
  const runHandoff = executeLifecycle.indexOf(
    'runOperation = Promise.resolve(reviewed.runResource(controller.signal));',
    runOperationState,
  );
  const synchronousRunFailure = executeLifecycle.indexOf('runFailed = true;', runHandoff);
  const synchronousRunSettlement = executeLifecycle.indexOf(
    'runSettled = true;',
    synchronousRunFailure,
  );
  const observedRunState = executeLifecycle.indexOf(
    'let observedRun: Promise<void> | undefined;',
    synchronousRunSettlement,
  );
  const observedRun = executeLifecycle.indexOf(
    'observedRun = runOperation.then(',
    observedRunState,
  );
  const runHandoffPublication = executeLifecycle.indexOf('runHandoffComplete = true;', observedRun);
  const acceptedRunGuard = executeLifecycle.indexOf(
    'if (runOperation !== undefined) {',
    runHandoffPublication,
  );
  const startedEvent = executeLifecycle.indexOf(
    "if (!stopRequested) recordEvent(reviewed.recordEvent, 'STARTED');",
    acceptedRunGuard,
  );
  const closeAfterHandoff = executeLifecycle.indexOf(
    'if (stopRequested) void beginClose();',
    startedEvent,
  );
  const runProgress = executeLifecycle.indexOf('await progress;', closeAfterHandoff);
  const closeWithoutRun = executeLifecycle.indexOf('} else if (stopRequested) {', runProgress);
  const prematureExitCapture = executeLifecycle.indexOf(
    'const prematureExit = runSettled && !runFailed && !stopRequested;',
    closeWithoutRun,
  );
  const postRunListenerCleanup = executeLifecycle.indexOf(
    'reviewed.signal.removeAbortListener(requestStop);',
    prematureExitCapture,
  );
  const runFailureEvent = executeLifecycle.indexOf(
    "recordEvent(reviewed.recordEvent, 'RUN_FAILED');",
    postRunListenerCleanup,
  );
  const prematureExitEvent = executeLifecycle.indexOf(
    "else if (prematureExit) recordEvent(reviewed.recordEvent, 'PREMATURE_RUN_EXIT');",
    runFailureEvent,
  );
  const terminalClose = executeLifecycle.indexOf(
    'const closed = await beginClose();',
    prematureExitEvent,
  );
  const terminalCloseEvent = executeLifecycle.indexOf(
    "recordEvent(reviewed.recordEvent, 'CLOSE_FAILED');",
    terminalClose,
  );
  const terminalCloseError = executeLifecycle.indexOf(
    'throw new BalanceSyncConsumerLifecycleCloseError();',
    terminalCloseEvent,
  );
  const lateRunDrain = executeLifecycle.indexOf(
    'if (observedRun !== undefined && !runSettled) await observedRun;',
    terminalCloseError,
  );
  const terminalListenerCleanup = executeLifecycle.indexOf(
    'reviewed.signal.removeAbortListener(requestStop);',
    lateRunDrain,
  );
  const lateRunFailureEvent = executeLifecycle.indexOf(
    "if (runFailed && !runFailureReported) recordEvent(reviewed.recordEvent, 'RUN_FAILED');",
    terminalListenerCleanup,
  );
  const fixedRunError = executeLifecycle.indexOf(
    'if (runFailed) throw new BalanceSyncConsumerLifecycleRunError();',
    lateRunFailureEvent,
  );
  const fixedPrematureExitError = executeLifecycle.indexOf(
    'if (prematureExit) throw new BalanceSyncConsumerLifecyclePrematureExitError();',
    fixedRunError,
  );
  const stoppedEvent = executeLifecycle.indexOf(
    "recordEvent(reviewed.recordEvent, 'STOPPED');",
    fixedPrematureExitError,
  );

  if (
    privateController < 0 ||
    stopState <= privateController ||
    listeningState <= stopState ||
    runHandoffState <= listeningState ||
    closeOperationState <= runHandoffState ||
    progressConstruction <= closeOperationState ||
    beginClose <= progressConstruction ||
    closeMemoization <= beginClose ||
    closeStart <= closeMemoization ||
    closeObservation <= closeStart ||
    requestStop <= closeObservation ||
    duplicateStopGuard <= requestStop ||
    stopTransition <= duplicateStopGuard ||
    privateAbort <= stopTransition ||
    closeOnStop <= privateAbort ||
    initialSignalRead <= closeOnStop ||
    initialStopRequest <= initialSignalRead ||
    listenerAttach <= initialStopRequest ||
    listeningTransition <= listenerAttach ||
    signalRecheck <= listeningTransition ||
    setupFailureCleanup <= signalRecheck ||
    setupFailureClose <= setupFailureCleanup ||
    setupCloseEvent <= setupFailureClose ||
    setupCloseError <= setupCloseEvent ||
    signalError <= setupCloseError ||
    runFailureState <= signalError ||
    runSettledState <= runFailureState ||
    runFailureReportedState <= runSettledState ||
    runOperationState <= runFailureReportedState ||
    runHandoff <= runOperationState ||
    synchronousRunFailure <= runHandoff ||
    synchronousRunSettlement <= synchronousRunFailure ||
    observedRunState <= synchronousRunSettlement ||
    observedRun <= observedRunState ||
    runHandoffPublication <= observedRun ||
    acceptedRunGuard <= runHandoffPublication ||
    startedEvent <= acceptedRunGuard ||
    closeAfterHandoff <= startedEvent ||
    runProgress <= closeAfterHandoff ||
    closeWithoutRun <= runProgress ||
    prematureExitCapture <= closeWithoutRun ||
    postRunListenerCleanup <= prematureExitCapture ||
    runFailureEvent <= postRunListenerCleanup ||
    prematureExitEvent <= runFailureEvent ||
    terminalClose <= prematureExitEvent ||
    terminalCloseEvent <= terminalClose ||
    terminalCloseError <= terminalCloseEvent ||
    lateRunDrain <= terminalCloseError ||
    terminalListenerCleanup <= lateRunDrain ||
    lateRunFailureEvent <= terminalListenerCleanup ||
    fixedRunError <= lateRunFailureEvent ||
    fixedPrematureExitError <= fixedRunError ||
    stoppedEvent <= fixedPrematureExitError
  ) {
    return false;
  }

  const reviewedSnapshot = factory.indexOf('const reviewed = reviewedDependencies(dependencies);');
  const startedState = factory.indexOf('let started = false;', reviewedSnapshot);
  const operationState = factory.indexOf('let operation: Promise<void> | undefined;', startedState);
  const runStart = factory.indexOf('const run = (): Promise<void> => {', operationState);
  const oneShotGuard = factory.indexOf('if (started) {', runStart);
  const alreadyStartedError = factory.indexOf(
    'return Promise.reject(new BalanceSyncConsumerLifecycleAlreadyStartedError());',
    oneShotGuard,
  );
  const startedPublication = factory.indexOf('started = true;', alreadyStartedError);
  const operationPublication = factory.indexOf(
    'operation = Promise.resolve().then(() => executeLifecycle(reviewed));',
    startedPublication,
  );
  const operationReturn = factory.indexOf('return operation;', operationPublication);
  const facadeReturn = factory.indexOf(
    'return frozenNullPrototype<DormantBalanceSyncConsumerLifecycleCoordinator>({ run });',
    operationReturn,
  );
  if (
    reviewedSnapshot < 0 ||
    startedState <= reviewedSnapshot ||
    operationState <= startedState ||
    runStart <= operationState ||
    oneShotGuard <= runStart ||
    alreadyStartedError <= oneShotGuard ||
    startedPublication <= alreadyStartedError ||
    operationPublication <= startedPublication ||
    operationReturn <= operationPublication ||
    facadeReturn <= operationReturn
  ) {
    return false;
  }

  const fixedErrors = [
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_CONFIGURATION_INVALID' as const;",
      "super('Balance sync consumer lifecycle configuration is invalid');",
      "this.name = 'BalanceSyncConsumerLifecycleConfigurationError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_ALREADY_STARTED' as const;",
      "super('Balance sync consumer lifecycle is already started');",
      "this.name = 'BalanceSyncConsumerLifecycleAlreadyStartedError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_SIGNAL_INVALID' as const;",
      "super('Balance sync consumer lifecycle signal is invalid');",
      "this.name = 'BalanceSyncConsumerLifecycleSignalError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_PREMATURE_RUN_EXIT' as const;",
      "super('Balance sync consumer lifecycle run exited before shutdown');",
      "this.name = 'BalanceSyncConsumerLifecyclePrematureExitError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_RUN_FAILED' as const;",
      "super('Balance sync consumer lifecycle run failed');",
      "this.name = 'BalanceSyncConsumerLifecycleRunError';",
    ],
    [
      "readonly code = 'BALANCE_SYNC_CONSUMER_LIFECYCLE_CLOSE_FAILED' as const;",
      "super('Balance sync consumer lifecycle close failed');",
      "this.name = 'BalanceSyncConsumerLifecycleCloseError';",
    ],
  ] as const;
  const launchAndCompositionSources = [
    sources.runtimeSource,
    sources.cliSource,
    sources.cliModeSource,
    sources.activationSource,
    sources.compositionSource,
    sources.balanceConsumerResourceSource,
    sources.blockchainSyncIndexSource,
    sources.blockchainSyncModuleSource,
    sources.sqsModuleSource,
    sources.appModuleSource,
    sources.applicationRootSource,
    sources.localDevelopmentAppModuleSource,
    sources.mainSource,
    sources.outboxWorkerCliSource,
    sources.redisSessionRevocationCliSource,
    sources.migrationCliSource,
    sources.apiPackageSource,
    sources.rootPackageSource,
    sources.applicationTemplateSource,
    sources.workloadTemplateSource,
    sources.balanceConsumerEnvelopeSource,
    sources.releaseManifestSource,
    sources.productionContainerValidatorSource,
  ];
  const importLines = trimmedExecutableLines(lifecycle).filter((line) =>
    line.startsWith('import '),
  );

  return (
    importLines.length === 1 &&
    importLines[0] ===
      "import type { DormantBalanceSyncConsumerResource } from './balance-sync-consumer.resource';" &&
    trimmedExecutableLines(lifecycle).filter((line) => line.startsWith('export ')).length === 5 &&
    exactExecutableLineCount(
      lifecycle,
      "const DEPENDENCY_KEYS = Object.freeze(['resource', 'signal', 'operatorEvents'] as const);",
    ) === 1 &&
    exactExecutableLineCount(
      lifecycle,
      "const RESOURCE_KEYS = Object.freeze(['run', 'close'] as const);",
    ) === 1 &&
    exactExecutableLineCount(
      lifecycle,
      "const OPERATOR_PORT_KEYS = Object.freeze(['record'] as const);",
    ) === 1 &&
    trimmedExecutableLines(eventType).filter((line) => line.startsWith('event:')).length === 1 &&
    exactExecutableLineCount(
      eventType,
      "event: 'STARTED' | 'STOPPED' | 'PREMATURE_RUN_EXIT' | 'RUN_FAILED' | 'CLOSE_FAILED';",
    ) === 1 &&
    trimmedExecutableLines(operatorInterface).filter((line) => line.startsWith('readonly '))
      .length === 1 &&
    exactExecutableLineCount(
      operatorInterface,
      'readonly record: (event: BalanceSyncConsumerLifecycleEvent) => void | Promise<void>;',
    ) === 1 &&
    trimmedExecutableLines(dependenciesInterface).filter((line) => line.startsWith('readonly '))
      .length === 3 &&
    exactExecutableLineCount(
      dependenciesInterface,
      'readonly resource: Readonly<DormantBalanceSyncConsumerResource>;',
    ) === 1 &&
    exactExecutableLineCount(dependenciesInterface, 'readonly signal: AbortSignal;') === 1 &&
    exactExecutableLineCount(
      dependenciesInterface,
      'readonly operatorEvents: BalanceSyncConsumerLifecycleOperatorPort;',
    ) === 1 &&
    trimmedExecutableLines(coordinatorInterface).filter((line) => line.startsWith('readonly '))
      .length === 1 &&
    exactExecutableLineCount(coordinatorInterface, 'readonly run: () => Promise<void>;') === 1 &&
    exactExecutableLineCount(
      exactDataRecord,
      'const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;',
    ) === 1 &&
    exactExecutableLineCount(exactDataRecord, 'const keys = Reflect.ownKeys(descriptors);') === 1 &&
    exactExecutableLineCount(
      exactDataRecord,
      "if (!descriptor?.enumerable || !('value' in descriptor)) return invalidConfiguration();",
    ) === 1 &&
    exactExecutableLineCount(
      reviewedResource,
      'if (Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) {',
    ) === 1 &&
    exactExecutableLineCount(
      reviewedResource,
      'const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;',
    ) === 1 &&
    exactExecutableLineCount(reviewedResource, 'descriptor.configurable !== false ||') === 1 &&
    exactExecutableLineCount(reviewedResource, 'descriptor.writable !== false ||') === 1 &&
    exactExecutableLineCount(reviewedResource, "typeof descriptor.value !== 'function'") === 1 &&
    exactExecutableLineCount(
      reviewedResource,
      'runResource: descriptors.run?.value as (signal: AbortSignal) => Promise<void>,',
    ) === 1 &&
    exactExecutableLineCount(
      reviewedResource,
      'closeResource: descriptors.close?.value as () => Promise<void>,',
    ) === 1 &&
    exactExecutableLineCount(
      reviewedSignal,
      "const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;",
    ) === 1 &&
    exactExecutableLineCount(
      reviewedSignal,
      'const aborted = (): boolean => abortedGetter.call(value) as boolean;',
    ) === 1 &&
    exactExecutableLineCount(reviewedSignal, 'aborted();') === 1 &&
    exactExecutableLineCount(
      reviewedSignal,
      "EventTarget.prototype.addEventListener.call(value, 'abort', listener, { once: true });",
    ) === 1 &&
    exactExecutableLineCount(
      reviewedSignal,
      "EventTarget.prototype.removeEventListener.call(value, 'abort', listener);",
    ) === 1 &&
    exactExecutableLineCount(
      reviewedOperator,
      'const record = exactDataRecord(value, OPERATOR_PORT_KEYS).record;',
    ) === 1 &&
    exactExecutableLineCount(
      reviewedOperator,
      "if (typeof record !== 'function') return invalidConfiguration();",
    ) === 1 &&
    exactExecutableLineCount(
      reviewedDependencies,
      'const dependencies = exactDataRecord(value, DEPENDENCY_KEYS);',
    ) === 1 &&
    exactExecutableLineCount(
      reviewedDependencies,
      'const resource = reviewedResource(dependencies.resource);',
    ) === 1 &&
    exactExecutableLineCount(
      reviewedDependencies,
      'signal: reviewedSignal(dependencies.signal),',
    ) === 1 &&
    exactExecutableLineCount(
      reviewedDependencies,
      'recordEvent: reviewedOperatorPort(dependencies.operatorEvents),',
    ) === 1 &&
    exactExecutableLineCount(
      lifecycle,
      'return Object.freeze(Object.assign(Object.create(null) as T, members));',
    ) === 1 &&
    exactExecutableLineCount(lifecycleEventFactory, 'return frozenNullPrototype({ event });') ===
      1 &&
    exactExecutableLineCount(
      recordEvent,
      'void Promise.resolve(recorder(lifecycleEvent(event))).catch(() => undefined);',
    ) === 1 &&
    exactExecutableLineCount(closeResource, 'await Promise.resolve().then(close);') === 1 &&
    exactExecutableLineCount(executeLifecycle, 'runFailed = true;') === 2 &&
    exactExecutableLineCount(
      executeLifecycle,
      'reviewed.signal.removeAbortListener(requestStop);',
    ) === 4 &&
    exactExecutableLineCount(
      executeLifecycle,
      'const closed = await closeResource(reviewed.closeResource);',
    ) === 1 &&
    exactExecutableLineCount(executeLifecycle, 'const closed = await beginClose();') === 1 &&
    exactExecutableLineCount(
      executeLifecycle,
      'if (closeOperation !== undefined) return closeOperation;',
    ) === 1 &&
    exactExecutableLineCount(
      executeLifecycle,
      'closeOperation = closeResource(reviewed.closeResource);',
    ) === 1 &&
    exactExecutableLineCount(executeLifecycle, 'void closeOperation.then(() => {') === 1 &&
    exactExecutableLineCount(executeLifecycle, 'wakeProgress();') === 3 &&
    exactExecutableLineCount(executeLifecycle, 'if (stopRequested) return;') === 1 &&
    exactExecutableLineCount(executeLifecycle, 'if (runHandoffComplete) void beginClose();') ===
      1 &&
    exactExecutableLineCount(executeLifecycle, 'runHandoffComplete = true;') === 1 &&
    exactExecutableLineCount(executeLifecycle, 'observedRun = runOperation.then(') === 1 &&
    exactExecutableLineCount(executeLifecycle, 'if (stopRequested) void beginClose();') === 1 &&
    exactExecutableLineCount(executeLifecycle, 'await progress;') === 1 &&
    exactExecutableLineCount(
      executeLifecycle,
      'if (observedRun !== undefined && !runSettled) await observedRun;',
    ) === 1 &&
    exactExecutableLineCount(
      executeLifecycle,
      "recordEvent(reviewed.recordEvent, 'CLOSE_FAILED');",
    ) === 2 &&
    exactExecutableLineCount(
      executeLifecycle,
      'throw new BalanceSyncConsumerLifecycleCloseError();',
    ) === 2 &&
    exactExecutableLineCount(factory, 'let started = false;') === 1 &&
    exactExecutableLineCount(factory, 'started = true;') === 1 &&
    !/^\s*started\s*=\s*false;/mu.test(factory) &&
    exactExecutableLineCount(factory, 'return operation;') === 1 &&
    fixedErrors.every((binding) =>
      binding.every((line) => exactExecutableLineCount(lifecycle, line) === 1),
    ) &&
    !/\b(?:AbortSignal\.any|loadBalanceConsumerConfig|loadBalanceConsumerInfrastructureConfig|loadInfrastructureConfig|InfrastructureConfigModule|NestFactory|PostgresService|SQSClient|SqsModule|SqsService|SqsQueueReceiptTransport|PinnedSqsQueueReceiptAdapter|createPostgresPool|createRawSqsClient|ReceiveMessageCommand|DeleteMessageCommand|ChangeMessageVisibilityCommand|XMLHttpRequest|WebSocket|axios|undici)\b/u.test(
      lifecycle,
    ) &&
    !/(?:@aws-sdk\/|from ['"]pg['"]|node:(?:http|https|net|tls)|process\.env|\bfetch\s*\(|\bset(?:Interval|Timeout)\s*\(|\bcreateApplicationContext\s*\(|@Module\s*\(|\.listen\s*\(|\.reason\b)/u.test(
      lifecycle,
    ) &&
    !lifecycle.includes('createDormantBalanceSyncConsumerResource') &&
    !lifecycle.includes('Promise.race(') &&
    !lifecycle.includes('Promise.resolve().then(() => reviewed.runResource') &&
    !/\bcause\s*[:=]/u.test(lifecycle) &&
    launchAndCompositionSources.every(
      (source) =>
        !source.includes('createDormantBalanceSyncConsumerLifecycleCoordinator') &&
        !source.includes('DormantBalanceSyncConsumerLifecycleCoordinator') &&
        !source.includes('balance-sync-consumer.lifecycle'),
    )
  );
}

function hasDormantBalanceConsumerPersistenceResourceContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const resource = sources.balanceConsumerPersistenceResourceSource.replace(/\r\n/gu, '\n');
  const resourceInterfaceStart = resource.indexOf(
    'export interface BalanceConsumerPersistenceResource {',
  );
  const reviewedConfigurationStart = resource.indexOf(
    'interface ReviewedPersistenceConfiguration {',
    resourceInterfaceStart,
  );
  const factoryStart = resource.indexOf(
    'export async function createDormantBalanceConsumerPersistenceResource(',
    reviewedConfigurationStart,
  );
  if (
    resourceInterfaceStart < 0 ||
    reviewedConfigurationStart <= resourceInterfaceStart ||
    factoryStart <= reviewedConfigurationStart
  ) {
    return false;
  }

  const resourceInterface = resource.slice(resourceInterfaceStart, reviewedConfigurationStart);
  const factory = resource.slice(factoryStart);
  const poolCreation = factory.indexOf('pool = createPostgresPool(reviewed.infrastructure);');
  const serviceCreation = factory.indexOf('postgres = new PostgresService(pool);');
  const serviceOwnership = factory.indexOf('const resourcePostgres = postgres;', serviceCreation);
  const checkpointCreation = factory.indexOf(
    'const checkpointRepository = new PostgresBalanceSyncCheckpointRepository(resourcePostgres);',
    serviceOwnership,
  );
  const resolverCreation = factory.indexOf(
    'const walletAddressResolverRepository = new PostgresBalanceSyncWalletAddressResolver(',
  );
  const operationGateRegistration = factory.indexOf('operationGates.add(gate);', resolverCreation);
  const operationInvocation = factory.indexOf(
    'const result = Promise.resolve().then(operation);',
    operationGateRegistration,
  );
  const closedGuard = factory.indexOf(
    'if (closed) return Promise.reject(new BalanceConsumerPersistenceClosedError());',
  );
  const closeStart = factory.indexOf('const close = (): Promise<void> => {', operationInvocation);
  const closeMemoizationGuard = factory.indexOf(
    'if (closePromise !== undefined) return closePromise;',
    closeStart,
  );
  const closedTransition = factory.indexOf('closed = true;', closeMemoizationGuard);
  const closePromisePublication = factory.indexOf(
    'closePromise = new Promise<void>((resolve, reject) => {',
    closedTransition,
  );
  const postgresDrainStart = factory.indexOf(
    'postgresDrain = resourcePostgres.closeCancellableQueries();',
    closePromisePublication,
  );
  const facadeDrain = factory.indexOf(
    'void Promise.allSettled([postgresDrain, drainOperations()])',
    postgresDrainStart,
  );
  const bestEffortPoolClose = factory.indexOf(
    'closePool(resourcePool, () => new BalanceConsumerPersistenceCloseError()),',
    facadeDrain,
  );
  if (
    poolCreation < 0 ||
    serviceCreation <= poolCreation ||
    serviceOwnership <= serviceCreation ||
    checkpointCreation <= serviceOwnership ||
    resolverCreation <= checkpointCreation ||
    closedGuard <= resolverCreation ||
    operationGateRegistration <= closedGuard ||
    operationInvocation <= operationGateRegistration ||
    closeStart <= operationInvocation ||
    closeMemoizationGuard <= closeStart ||
    closedTransition <= closeMemoizationGuard ||
    closePromisePublication <= closedTransition ||
    postgresDrainStart <= closePromisePublication ||
    facadeDrain <= postgresDrainStart ||
    bestEffortPoolClose <= facadeDrain
  ) {
    return false;
  }

  const runtimePool = sources.runtimePostgresPoolSource.replace(/\r\n/gu, '\n');
  const postgresService = sources.postgresServiceSource.replace(/\r\n/gu, '\n');
  const checkpointRepository = sources.balanceSyncCheckpointRepositorySource.replace(
    /\r\n/gu,
    '\n',
  );
  const walletAddressResolver = sources.balanceSyncWalletAddressResolverSource.replace(
    /\r\n/gu,
    '\n',
  );
  const balanceConsumerConfig = sources.balanceConsumerConfigSource.replace(/\r\n/gu, '\n');
  const infrastructureConfig = sources.infrastructureConfigSource.replace(/\r\n/gu, '\n');
  const launchAndBarrelSources = [
    sources.runtimeSource,
    sources.cliSource,
    sources.cliModeSource,
    sources.compositionSource,
    sources.blockchainSyncIndexSource,
    sources.blockchainSyncModuleSource,
    sources.appModuleSource,
    sources.applicationRootSource,
    sources.localDevelopmentAppModuleSource,
    sources.mainSource,
    sources.outboxWorkerCliSource,
    sources.redisSessionRevocationCliSource,
    sources.migrationCliSource,
  ];

  const cancellableQueryStart = postgresService.indexOf(
    'queryWithCancellation<Row extends QueryResultRow = QueryResultRow>(',
  );
  const activeTransactionGuard = postgresService.indexOf(
    'if (this.transactionContext.getStore() !== undefined) {',
    cancellableQueryStart,
  );
  const signalGuard = postgresService.indexOf(
    'if (reviewAbortSignal(signal) === null) {',
    activeTransactionGuard,
  );
  const admissionGuard = postgresService.indexOf(
    'if (!this.cancellableQueryAdmissionOpen) {',
    signalGuard,
  );
  const serviceGateRegistration = postgresService.indexOf(
    'this.cancellableQueryOperations.add(gate);',
    admissionGuard,
  );
  const serviceOperationStart = postgresService.indexOf(
    'this.executeCancellableQuery<Row>(queryTextOrConfig, values, signal),',
    serviceGateRegistration,
  );
  const closeCancellableStart = postgresService.indexOf(
    'closeCancellableQueries(): Promise<void> {',
    serviceOperationStart,
  );
  const closeAdmission = postgresService.indexOf(
    'this.cancellableQueryAdmissionOpen = false;',
    closeCancellableStart,
  );
  const serviceClosePublication = postgresService.indexOf(
    'this.cancellableQueryClosePromise = closePromise;',
    closeAdmission,
  );
  const lifecycleAbort = postgresService.indexOf(
    'Reflect.apply(ABORT_CONTROLLER_ABORT, this.cancellableQueryController, []);',
    serviceClosePublication,
  );
  const serviceDrain = postgresService.indexOf(
    'void this.drainCancellableQueries().then(',
    lifecycleAbort,
  );
  const executeStart = postgresService.indexOf(
    'private async executeCancellableQuery<Row extends QueryResultRow>(',
    serviceDrain,
  );
  const discardRelease = postgresService.indexOf('client.release(fixedError);', executeStart);
  const removeDrain = postgresService.indexOf('void removal.completed.then(', discardRelease);
  const operationTimer = postgresService.indexOf('const timeout = setTimeout(() => {', removeDrain);
  const signalListener = postgresService.indexOf('supplied.add(cancelFromSignal);', operationTimer);
  const preConnectCancellation = postgresService.indexOf(
    'if (cancellation !== null) {',
    signalListener,
  );
  const dedicatedClientAcquisition = postgresService.indexOf(
    'client = await this.pool.connect();',
    preConnectCancellation,
  );
  const clientRemovalObservation = postgresService.indexOf(
    'removal = this.observeClientRemoval(client);',
    dedicatedClientAcquisition,
  );
  const clientQuery = postgresService.indexOf(
    '.then(() => client?.query<Row>(queryTextOrConfig, values))',
    clientRemovalObservation,
  );
  const querySettlement = postgresService.indexOf(
    'const outcome = await querySettlement;',
    clientQuery,
  );
  const settlementAndTeardownDrain = postgresService.indexOf(
    'const teardownFailure = (await Promise.allSettled([querySettlement, teardown])).find(',
    querySettlement,
  );
  const exactRemoveMatch = postgresService.indexOf(
    'if (removed !== client || !listening) return;',
    settlementAndTeardownDrain,
  );

  if (
    cancellableQueryStart < 0 ||
    activeTransactionGuard <= cancellableQueryStart ||
    signalGuard <= activeTransactionGuard ||
    admissionGuard <= signalGuard ||
    serviceGateRegistration <= admissionGuard ||
    serviceOperationStart <= serviceGateRegistration ||
    closeCancellableStart <= serviceOperationStart ||
    closeAdmission <= closeCancellableStart ||
    serviceClosePublication <= closeAdmission ||
    lifecycleAbort <= serviceClosePublication ||
    serviceDrain <= lifecycleAbort ||
    executeStart <= serviceDrain ||
    discardRelease <= executeStart ||
    removeDrain <= discardRelease ||
    operationTimer <= removeDrain ||
    signalListener <= operationTimer ||
    preConnectCancellation <= signalListener ||
    dedicatedClientAcquisition <= preConnectCancellation ||
    clientRemovalObservation <= dedicatedClientAcquisition ||
    clientQuery <= clientRemovalObservation ||
    querySettlement <= clientQuery ||
    settlementAndTeardownDrain <= querySettlement ||
    exactRemoveMatch <= settlementAndTeardownDrain
  ) {
    return false;
  }

  return (
    trimmedExecutableLines(resourceInterface).filter((line) => line.startsWith('readonly '))
      .length === 3 &&
    exactExecutableLineCount(
      resourceInterface,
      'readonly checkpoints: Readonly<BalanceSyncCheckpointPort>;',
    ) === 1 &&
    exactExecutableLineCount(
      resourceInterface,
      'readonly walletAddressResolver: Readonly<BalanceSyncWalletAddressResolverPort>;',
    ) === 1 &&
    exactExecutableLineCount(resourceInterface, 'readonly close: () => Promise<void>;') === 1 &&
    trimmedExecutableLines(resource).filter((line) => line.startsWith('export ')).length === 2 &&
    exactExecutableLineCount(
      resource,
      "const BALANCE_CONSUMER_SESSION_ROLE = 'crypto_balance_consumer_runtime' as const;",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "const infrastructureRecord = selectedDataRecord(infrastructure, ['workload', 'database']);",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "if (infrastructureRecord.workload !== 'balance-consumer') return invalidConfiguration();",
    ) === 1 &&
    exactExecutableLineCount(resource, 'const record = exactDataRecord(value, DATABASE_KEYS);') ===
      1 &&
    exactExecutableLineCount(
      resource,
      'if (record.sessionRole !== BALANCE_CONSUMER_SESSION_ROLE) return invalidConfiguration();',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "if (record.mode !== 'enabled') return invalidConfiguration();",
    ) === 1 &&
    exactExecutableLineCount(resource, "value.includes('?') ||") === 1 &&
    exactExecutableLineCount(resource, '!/^[1-9][0-9]{0,4}$/u.test(parsed.port) ||') === 1 &&
    exactExecutableLineCount(resource, 'Number(parsed.port) > 65_535 ||') === 1 &&
    exactExecutableLineCount(
      resource,
      '!/^crypto_balance_consumer_login_[a-z0-9]{1,32}$/u.test(',
    ) === 1 &&
    exactExecutableLineCount(resource, 'if (!loopback) return invalidConfiguration();') === 1 &&
    exactExecutableLineCount(
      resource,
      'if (record.rejectUnauthorized !== true) return invalidConfiguration();',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "if (activeWalletRegistrationKey(ring).purpose !== 'metadata-seal') {",
    ) === 1 &&
    exactExecutableLineCount(resource, "workload: 'balance-consumer',") === 1 &&
    exactExecutableLineCount(
      resource,
      'database: databaseSnapshot(infrastructureRecord.database),',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'return Object.freeze(Object.assign(Object.create(null) as T, members));',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'load: (scope, context) => whileOpen(() => checkpointRepository.load(scope, context)),',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'whileOpen(() => checkpointRepository.upsertCurrent(input, context)),',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'whileOpen(() => checkpointRepository.replaceProvisionalAfterReorg(input, context)),',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'whileOpen(() => checkpointRepository.preserveLastGoodAndMarkStale(input, context)),',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'whileOpen(() => walletAddressResolverRepository.resolveActiveAddress(scope, context)),',
    ) === 1 &&
    exactExecutableLineCount(resource, 'if (closePromise !== undefined) return closePromise;') ===
      1 &&
    exactExecutableLineCount(resource, 'operationGates.add(gate);') === 1 &&
    exactExecutableLineCount(resource, 'const result = Promise.resolve().then(operation);') === 1 &&
    exactExecutableLineCount(resource, 'await Promise.allSettled([...operationGates]);') === 1 &&
    exactExecutableLineCount(
      resource,
      'closePromise = new Promise<void>((resolve, reject) => {',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'postgresDrain = resourcePostgres.closeCancellableQueries();',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'void Promise.allSettled([postgresDrain, drainOperations()])',
    ) === 1 &&
    exactExecutableLineCount(resource, '.then(() => pool.end())') === 1 &&
    exactExecutableLineCount(
      resource,
      'await closePool(pool, () => new BalanceConsumerPersistenceConstructionError()).catch(',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'throw new BalanceConsumerPersistenceConstructionError();',
    ) === 1 &&
    !/@nestjs|PostgresModule|InfrastructureConfigModule|MigrationRunner|process\.env|\.connect\s*\(|\.query\s*\(|healthCheck\s*\(|withTransaction\s*\(/u.test(
      resource,
    ) &&
    exactExecutableLineCount(runtimePool, 'export interface RuntimePostgresPoolConfig {') === 1 &&
    exactExecutableLineCount(
      runtimePool,
      "readonly workload: RuntimeInfrastructureConfig['workload'];",
    ) === 1 &&
    exactExecutableLineCount(
      runtimePool,
      'readonly database: Readonly<DatabaseInfrastructureConfig>;',
    ) === 1 &&
    !/readonly\s+sqs\s*:/u.test(runtimePool) &&
    exactExecutableLineCount(runtimePool, "balanceConsumer: 'crypto_balance_consumer_runtime',") ===
      1 &&
    exactExecutableLineCount(runtimePool, 'return capabilityRoles.balanceConsumer;') === 1 &&
    exactExecutableLineCount(runtimePool, 'return new Pool({') === 1 &&
    exactExecutableLineCount(
      postgresService,
      'constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}',
    ) === 1 &&
    exactExecutableLineCount(postgresService, 'const CANCELLABLE_QUERY_TIMEOUT_MS = 16_000;') ===
      1 &&
    exactExecutableLineCount(postgresService, "| 'POSTGRES_CANCELLABLE_QUERY_TEARDOWN_FAILED';") ===
      1 &&
    exactExecutableLineCount(
      postgresService,
      "return Promise.reject(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_ACTIVE_TRANSACTION'));",
    ) === 1 &&
    exactExecutableLineCount(
      postgresService,
      "return Promise.reject(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_INVALID_SIGNAL'));",
    ) === 1 &&
    exactExecutableLineCount(
      postgresService,
      "return Promise.reject(cancellableQueryError('POSTGRES_CANCELLABLE_QUERY_CLOSED'));",
    ) === 1 &&
    exactExecutableLineCount(postgresService, 'this.cancellableQueryOperations.add(gate);') === 1 &&
    exactExecutableLineCount(postgresService, 'this.cancellableQueryAdmissionOpen = false;') ===
      1 &&
    exactExecutableLineCount(
      postgresService,
      'this.cancellableQueryClosePromise = closePromise;',
    ) === 1 &&
    exactExecutableLineCount(
      postgresService,
      'Reflect.apply(ABORT_CONTROLLER_ABORT, this.cancellableQueryController, []);',
    ) === 1 &&
    exactExecutableLineCount(postgresService, 'client.release(fixedError);') === 1 &&
    exactExecutableLineCount(postgresService, '.then(() => acquiredClient.end())') === 2 &&
    exactExecutableLineCount(postgresService, 'void removal.completed.then(') === 1 &&
    exactExecutableLineCount(postgresService, 'timeout.unref?.();') === 1 &&
    exactExecutableLineCount(postgresService, 'clearTimeout(timeout);') === 1 &&
    exactExecutableLineCount(
      postgresService,
      'const teardownFailure = (await Promise.allSettled([querySettlement, teardown])).find(',
    ) === 1 &&
    exactExecutableLineCount(postgresService, 'if (removed !== client || !listening) return;') ===
      1 &&
    exactExecutableLineCount(postgresService, "this.pool.on('remove', onRemove);") === 1 &&
    exactExecutableLineCount(postgresService, "this.pool.removeListener('remove', onRemove);") ===
      2 &&
    !postgresService.includes('Promise.race(') &&
    !/\.(?:reason)\b/u.test(postgresService) &&
    exactExecutableLineCount(
      checkpointRepository,
      'constructor(private readonly postgres: PostgresService) {}',
    ) === 1 &&
    exactExecutableLineCount(
      checkpointRepository,
      'const reviewed = reviewBalanceSyncExecutionContext(context);',
    ) === 1 &&
    exactExecutableLineCount(
      checkpointRepository,
      'const signal = activeExecutionSignal(context);',
    ) === 4 &&
    exactExecutableLineCount(
      checkpointRepository,
      'const result = await this.postgres.queryWithCancellation<WriteRow>(',
    ) === 3 &&
    exactExecutableLineCount(
      checkpointRepository,
      'const result = await this.postgres.queryWithCancellation<CheckpointRow>(',
    ) === 1 &&
    exactExecutableLineCount(checkpointRepository, 'activeExecutionSignal(context);') === 4 &&
    !/this\.postgres\.query(?:<|\()/u.test(checkpointRepository) &&
    exactExecutableLineCount(
      walletAddressResolver,
      'private readonly postgres: PostgresService,',
    ) === 1 &&
    exactExecutableLineCount(
      walletAddressResolver,
      '@Inject(BALANCE_CONSUMER_CONFIG) private readonly config: BalanceConsumerConfig,',
    ) === 1 &&
    exactExecutableLineCount(
      walletAddressResolver,
      'const result = await this.postgres.queryWithCancellation<ResolvedAddressRow>(',
    ) === 1 &&
    exactExecutableLineCount(
      walletAddressResolver,
      'const signal = activeExecutionSignal(context);',
    ) === 1 &&
    exactExecutableLineCount(walletAddressResolver, 'activeExecutionSignal(context);') === 1 &&
    !/this\.postgres\.query(?:<|\()/u.test(walletAddressResolver) &&
    exactExecutableLineCount(
      infrastructureConfig,
      'export const BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS: Readonly<RuntimeDatabaseTimeoutLimits> =',
    ) === 1 &&
    exactExecutableLineCount(infrastructureConfig, 'connectionTimeoutMs: 5_000,') === 1 &&
    exactExecutableLineCount(infrastructureConfig, 'lockTimeoutMs: 5_000,') === 1 &&
    exactExecutableLineCount(infrastructureConfig, 'statementTimeoutMs: 15_000,') === 1 &&
    exactExecutableLineCount(infrastructureConfig, "workload === 'balance-consumer'") === 1 &&
    exactExecutableLineCount(infrastructureConfig, '? BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS') ===
      1 &&
    exactExecutableLineCount(
      resource,
      'BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS.connectionTimeoutMs,',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS.lockTimeoutMs,',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'BALANCE_CONSUMER_DATABASE_TIMEOUT_LIMITS.statementTimeoutMs,',
    ) === 1 &&
    hasExactPostgresCancellationDependencyLock(
      sources.apiPackageSource,
      sources.rootPackageLockSource,
    ) &&
    exactExecutableLineCount(balanceConsumerConfig, "readonly mode: 'enabled';") === 1 &&
    exactExecutableLineCount(
      balanceConsumerConfig,
      "readonly walletMetadataSealKeys: WalletRegistrationKeyRing<'metadata-seal'>;",
    ) === 1 &&
    launchAndBarrelSources.every(
      (source) =>
        !source.includes('createDormantBalanceConsumerPersistenceResource') &&
        !source.includes('balance-consumer-persistence.resource'),
    )
  );
}

function hasDormantBalanceConsumerSqsReceiptResourceContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const resource = sources.balanceConsumerSqsReceiptResourceSource.replace(/\r\n/gu, '\n');
  const resourceInterfaceStart = resource.indexOf(
    'export interface BalanceConsumerSqsReceiptResource {',
  );
  const reviewedConfigurationStart = resource.indexOf(
    'interface ReviewedBalanceConsumerSqsReceiptConfiguration {',
  );
  const transportStart = resource.indexOf(
    'class BalanceConsumerSqsReceiptTransport implements PinnedSqsQueueReceiptPort {',
    reviewedConfigurationStart,
  );
  const configurationErrorStart = resource.indexOf(
    'class BalanceConsumerSqsReceiptConfigurationError extends Error {',
    resourceInterfaceStart,
  );
  const factoryStart = resource.indexOf(
    'export async function createDormantBalanceConsumerSqsReceiptResource(',
    transportStart,
  );
  if (
    reviewedConfigurationStart < 0 ||
    resourceInterfaceStart <= reviewedConfigurationStart ||
    configurationErrorStart <= resourceInterfaceStart ||
    transportStart <= configurationErrorStart ||
    factoryStart <= transportStart
  ) {
    return false;
  }

  const resourceInterface = resource.slice(resourceInterfaceStart, configurationErrorStart);
  const factory = resource.slice(factoryStart);
  const operationGateRegistration = factory.indexOf('inFlight.add(gate);');
  const operationInvocation = factory.indexOf('result = operation();', operationGateRegistration);
  const closeTransition = factory.indexOf('closed = true;', operationInvocation);
  const closeMemoizationGuard = factory.indexOf(
    'if (closePromise !== undefined) return closePromise;',
    closeTransition,
  );
  const acceptedOperationSnapshot = factory.indexOf(
    'const acceptedOperationGates = [...inFlight];',
    closeMemoizationGuard,
  );
  const closePromiseAssignment = factory.indexOf(
    'closePromise = new Promise<void>((resolve) => {',
    acceptedOperationSnapshot,
  );
  const acceptedOperationDrain = factory.indexOf(
    'await Promise.allSettled(acceptedOperationGates);',
    closePromiseAssignment,
  );
  const clientDestroy = factory.indexOf(
    'await destroyClient(resourceClient, () => new BalanceConsumerSqsReceiptCloseError());',
    acceptedOperationDrain,
  );
  const lifecycleAbort = factory.indexOf(
    'resourceLifecycle.abort(new BalanceConsumerSqsReceiptClosedError());',
    closePromiseAssignment,
  );
  const closeStart = factory.indexOf('startClose();', lifecycleAbort);
  if (
    operationGateRegistration < 0 ||
    operationInvocation <= operationGateRegistration ||
    closeTransition <= operationInvocation ||
    closeMemoizationGuard <= closeTransition ||
    acceptedOperationSnapshot <= closeMemoizationGuard ||
    closePromiseAssignment <= acceptedOperationSnapshot ||
    acceptedOperationDrain <= closePromiseAssignment ||
    clientDestroy <= acceptedOperationDrain ||
    lifecycleAbort <= closePromiseAssignment ||
    closeStart <= lifecycleAbort
  ) {
    return false;
  }

  const jobEnvelope = sources.jobEnvelopeSource.replace(/\r\n/gu, '\n');
  const jobEnvelopeParserStart = jobEnvelope.indexOf(
    'export function parseJobEnvelope<Payload = unknown>(value: unknown): JobEnvelope<Payload> {',
  );
  if (jobEnvelopeParserStart < 0) return false;
  const jobEnvelopeParser = jobEnvelope.slice(jobEnvelopeParserStart);
  const launchAndBarrelSources = [
    sources.runtimeSource,
    sources.cliSource,
    sources.cliModeSource,
    sources.compositionSource,
    sources.blockchainSyncIndexSource,
    sources.blockchainSyncModuleSource,
    sources.appModuleSource,
    sources.applicationRootSource,
    sources.localDevelopmentAppModuleSource,
    sources.mainSource,
    sources.outboxWorkerCliSource,
    sources.redisSessionRevocationCliSource,
    sources.migrationCliSource,
  ];

  return (
    trimmedExecutableLines(resourceInterface).filter((line) => line.startsWith('readonly '))
      .length === 2 &&
    exactExecutableLineCount(
      resourceInterface,
      'readonly receipt: Readonly<PinnedSqsQueueReceiptPort>;',
    ) === 1 &&
    exactExecutableLineCount(resourceInterface, 'readonly close: () => Promise<void>;') === 1 &&
    trimmedExecutableLines(resource).filter((line) => line.startsWith('export ')).length === 2 &&
    exactExecutableLineCount(resource, 'ReceiveMessageCommand,') === 1 &&
    exactExecutableLineCount(resource, 'DeleteMessageCommand,') === 1 &&
    exactExecutableLineCount(resource, 'ChangeMessageVisibilityCommand,') === 1 &&
    exactExecutableLineCount(resource, "} from '@aws-sdk/client-sqs';") === 1 &&
    exactExecutableLineCount(
      resource,
      "import { fromHttp } from '@aws-sdk/credential-provider-http';",
    ) === 1 &&
    !/\b(?:SendMessageCommand|SendMessageBatchCommand|GetQueueAttributesCommand|GetQueueUrlCommand|CreateQueueCommand|DeleteQueueCommand|PurgeQueueCommand|ListQueuesCommand|SqsService|SqsModule|SQS_(?:CLIENT|HEALTH|PINNED_QUEUE_RECEIPT|WORKER_QUEUE)|NestFactory|InfrastructureConfigModule|OUTBOX_TRANSPORT)\b/u.test(
      resource,
    ) &&
    !/balanceDeadLetterQueueUrl|process\.env|\bfetch\s*\(|\.healthCheck\s*\(|\.sendJob\s*\(|\.publish(?:Batch)?\s*\(/u.test(
      resource,
    ) &&
    exactExecutableLineCount(
      resource,
      "const infrastructure = selectedDataRecord(infrastructureConfig, ['workload', 'sqs']);",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "if (infrastructure.workload !== 'balance-consumer') return invalidConfiguration();",
    ) === 1 &&
    exactExecutableLineCount(resource, 'assertBalanceConsumerSqsReceiptRedrivePolicy({') === 1 &&
    exactExecutableLineCount(
      resource,
      'if ((endpoint === undefined) === (credentialRelativeUri === undefined)) {',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      '/^\\/\\d{12}\\/crypto-lending-(?:dev|test|qa|sandbox|staging)(?:-[a-z0-9]+)*-balance-sync$/u;',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "if (parsed.protocol !== 'http:' || parsed.origin !== endpoint) {",
    ) === 1 &&
    exactExecutableLineCount(resource, '!COMMERCIAL_AWS_REGION.test(value)') === 1 &&
    exactExecutableLineCount(resource, "parsed.protocol !== 'https:' ||") === 1 &&
    exactExecutableLineCount(resource, "parsed.port !== '' ||") === 1 &&
    exactExecutableLineCount(resource, 'parsed.hostname !== `sqs.${region}.amazonaws.com`') === 1 &&
    exactExecutableLineCount(
      resource,
      'awsContainerCredentialsRelativeUri: credentialRelativeUri,',
    ) === 1 &&
    exactExecutableLineCount(resource, "awsContainerCredentialsFullUri: '',") === 1 &&
    exactExecutableLineCount(resource, "awsContainerAuthorizationToken: '',") === 1 &&
    exactExecutableLineCount(resource, "awsContainerAuthorizationTokenFile: '',") === 1 &&
    exactExecutableLineCount(resource, 'maxRetries: 2,') === 1 &&
    exactExecutableLineCount(resource, 'timeout: 1_000,') === 1 &&
    exactExecutableLineCount(resource, "defaultsMode: 'standard',") === 1 &&
    exactExecutableLineCount(resource, "retryMode: 'standard',") === 1 &&
    exactExecutableLineCount(resource, 'useFipsEndpoint: false,') === 1 &&
    exactExecutableLineCount(resource, 'useDualstackEndpoint: false,') === 1 &&
    exactExecutableLineCount(resource, 'useQueueUrlAsEndpoint: false,') === 1 &&
    exactExecutableLineCount(resource, 'ignoreConfiguredEndpointUrls: true,') === 1 &&
    exactExecutableLineCount(resource, 'new ReceiveMessageCommand({') === 1 &&
    exactExecutableLineCount(resource, 'new DeleteMessageCommand({') === 1 &&
    exactExecutableLineCount(resource, 'new ChangeMessageVisibilityCommand({') === 1 &&
    exactExecutableLineCount(
      resource,
      "MessageSystemAttributeNames: ['ApproximateReceiveCount'],",
    ) === 1 &&
    !resource.includes('MessageAttributeNames') &&
    exactExecutableLineCount(resource, 'const receivedAtMonotonicMs = performance.now();') === 1 &&
    exactExecutableLineCount(
      resource,
      "const descriptor = Object.getOwnPropertyDescriptor(message, 'receiptHandle');",
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      "const rawMessages = dataProperty(response, 'Messages', false);",
    ) === 1 &&
    exactExecutableLineCount(resource, '(length as number) > maximumMessages ||') === 1 &&
    exactExecutableLineCount(resource, '(length as number) > 10') === 1 &&
    exactExecutableLineCount(
      resource,
      'return Object.freeze(parsed) as unknown as ReceivedQueueMessage[];',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'return Object.freeze(Object.assign(Object.create(null) as T, members));',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'if (closed) return Promise.reject(new BalanceConsumerSqsReceiptClosedError());',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'if (closed) throw new BalanceConsumerSqsReceiptClosedError();',
    ) === 1 &&
    exactExecutableLineCount(resource, 'const inFlight = new Set<Promise<void>>();') === 1 &&
    exactExecutableLineCount(resource, 'const TRUSTED_INPUT_ERRORS = new WeakSet<object>();') ===
      1 &&
    exactExecutableLineCount(resource, 'TRUSTED_INPUT_ERRORS.add(this);') === 1 &&
    exactExecutableLineCount(resource, 'inFlight.add(gate);') === 1 &&
    exactExecutableLineCount(resource, 'inFlight.delete(gate);') === 1 &&
    exactExecutableLineCount(resource, 'settleGate();') === 1 &&
    exactExecutableLineCount(
      resource,
      "if (typeof error === 'object' && error !== null && TRUSTED_INPUT_ERRORS.has(error)) {",
    ) === 1 &&
    exactExecutableLineCount(resource, 'throw new BalanceConsumerSqsReceiptOperationError();') ===
      1 &&
    exactExecutableLineCount(
      resource,
      'whileOpen(() => transport.receive(maxMessages, waitTimeSeconds, abortSignal)),',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'delete: (message, abortSignal) => whileOpen(() => transport.delete(message, abortSignal)),',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'whileOpen(() => transport.changeVisibility(message, visibilityTimeoutSeconds, abortSignal)),',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'return parseJobEnvelope<Payload>(JSON.parse(body) as unknown);',
    ) === 1 &&
    exactExecutableLineCount(
      resource,
      'const lifecycle = reviewedAbortSignal(lifecycleSignal);',
    ) === 1 &&
    exactExecutableLineCount(resource, "controller.abort(new Error('SQS request aborted'));") ===
      1 &&
    !/\breasonGetter\b|\.reason\s*\(/u.test(resource) &&
    exactExecutableLineCount(resource, 'const acceptedOperationGates = [...inFlight];') === 1 &&
    exactExecutableLineCount(
      resource,
      'resourceLifecycle.abort(new BalanceConsumerSqsReceiptClosedError());',
    ) === 1 &&
    exactExecutableLineCount(resource, 'await Promise.allSettled(acceptedOperationGates);') === 1 &&
    exactExecutableLineCount(
      resource,
      'await destroyClient(resourceClient, () => new BalanceConsumerSqsReceiptCloseError());',
    ) === 1 &&
    exactExecutableLineCount(resource, 'return closePromise;') === 1 &&
    exactExecutableLineCount(
      jobEnvelopeParser,
      'export function parseJobEnvelope<Payload = unknown>(value: unknown): JobEnvelope<Payload> {',
    ) === 1 &&
    exactExecutableLineCount(
      jobEnvelopeParser,
      'const descriptors = Object.getOwnPropertyDescriptors(value);',
    ) === 1 &&
    exactExecutableLineCount(jobEnvelopeParser, "throw new Error('Invalid job envelope');") >= 2 &&
    launchAndBarrelSources.every(
      (source) =>
        !source.includes('createDormantBalanceConsumerSqsReceiptResource') &&
        !source.includes('balance-consumer-sqs-receipt.resource'),
    )
  );
}

function hasPinnedBalanceConsumerQueueBoundaryContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const infrastructure = sources.infrastructureConfigSource.replace(/\r\n/gu, '\n');
  const balanceSqsInterfaceStart = infrastructure.indexOf(
    'export interface BalanceConsumerSqsInfrastructureConfig',
  );
  const infrastructureInterfaceStart = infrastructure.indexOf(
    'export interface InfrastructureConfig',
    balanceSqsInterfaceStart,
  );
  const genericLoaderStart = infrastructure.indexOf('export function loadInfrastructureConfig(');
  const balanceLoaderStart = infrastructure.indexOf(
    'export function loadBalanceConsumerInfrastructureConfig(',
    genericLoaderStart,
  );
  if (
    balanceSqsInterfaceStart < 0 ||
    infrastructureInterfaceStart <= balanceSqsInterfaceStart ||
    genericLoaderStart < 0 ||
    balanceLoaderStart <= genericLoaderStart
  ) {
    return false;
  }
  const balanceSqsInterface = infrastructure.slice(
    balanceSqsInterfaceStart,
    infrastructureInterfaceStart,
  );
  const genericLoader = infrastructure.slice(genericLoaderStart, balanceLoaderStart);
  const balanceLoader = infrastructure.slice(balanceLoaderStart);
  if (
    exactExecutableLineCount(balanceSqsInterface, 'balanceQueueUrl: string;') !== 1 ||
    exactExecutableLineCount(balanceSqsInterface, 'balanceDeadLetterQueueUrl: string;') !== 1 ||
    /^\s*(?:queueUrl|deadLetterQueueUrl):/mu.test(balanceSqsInterface) ||
    exactExecutableLineCount(genericLoader, "if (workload === 'balance-consumer') {") !== 1 ||
    exactExecutableLineCount(balanceLoader, 'assertBalanceConsumerSqsEnvironment(env);') !== 1 ||
    exactExecutableLineCount(
      balanceLoader,
      "const rawBalanceQueueUrl = required(env, 'SQS_BALANCE_QUEUE_URL');",
    ) !== 1 ||
    exactExecutableLineCount(
      balanceLoader,
      "const rawBalanceDeadLetterQueueUrl = required(env, 'SQS_BALANCE_DEAD_LETTER_QUEUE_URL');",
    ) !== 1 ||
    /['"]SQS_(?:QUEUE_URL|DEAD_LETTER_QUEUE_URL)['"]/u.test(balanceLoader) ||
    exactExecutableLineCount(
      balanceLoader,
      'if (balanceQueueUrl === balanceDeadLetterQueueUrl) {',
    ) !== 1 ||
    exactExecutableLineCount(balanceLoader, 'sourceAccount !== deadLetterAccount ||') !== 1 ||
    exactExecutableLineCount(
      balanceLoader,
      'sourceName !== `crypto-lending-${environment}-balance-sync` ||',
    ) !== 1 ||
    exactExecutableLineCount(
      balanceLoader,
      'deadLetterName !== `crypto-lending-${environment}-balance-sync-dlq`',
    ) !== 1
  ) {
    return false;
  }

  const receipt = sources.pinnedQueueReceiptSource.replace(/\r\n/gu, '\n');
  const pinnedInterfaceStart = receipt.indexOf('export interface PinnedSqsQueueReceiptPort');
  const pinnedAdapterStart = receipt.indexOf(
    'export class PinnedSqsQueueReceiptAdapter',
    pinnedInterfaceStart,
  );
  if (pinnedInterfaceStart < 0 || pinnedAdapterStart <= pinnedInterfaceStart) return false;
  const pinnedInterface = receipt.slice(pinnedInterfaceStart, pinnedAdapterStart);
  const pinnedAdapter = receipt.slice(pinnedAdapterStart);
  if (
    /\b(?:queueUrl|sendJob|publish|publishBatch|healthCheck)\s*[(:]/u.test(pinnedInterface) ||
    exactExecutableLineCount(pinnedAdapter, 'readonly #queueUrl: string;') !== 1 ||
    exactExecutableLineCount(pinnedAdapter, 'this.#queueUrl = queueUrl;') !== 1 ||
    exactExecutableLineCount(pinnedAdapter, 'Object.freeze(this);') !== 1 ||
    exactExecutableLineCount(
      pinnedAdapter,
      'return this.#transport.delete(message, this.#queueUrl, abortSignal);',
    ) !== 1 ||
    exactExecutableLineCount(pinnedAdapter, 'this.#queueUrl,') !== 2 ||
    /\b(?:sendJob|publish|publishBatch|healthCheck)\s*\(/u.test(pinnedAdapter) ||
    /\bget\s+queueUrl\b/u.test(pinnedAdapter)
  ) {
    return false;
  }

  const worker = sources.sqsJobWorkerSource.replace(/\r\n/gu, '\n');
  const policyStart = worker.indexOf('export interface SqsJobWorkerPolicy');
  const policyFactoryStart = worker.indexOf(
    'export function createSqsJobWorkerPolicy(',
    policyStart,
  );
  const policyFactoryEnd = worker.indexOf('const MAX_RECEIPT_LIFETIME_MS', policyFactoryStart);
  if (
    policyStart < 0 ||
    policyFactoryStart <= policyStart ||
    policyFactoryEnd <= policyFactoryStart
  ) {
    return false;
  }
  const policyInterface = trimmedExecutableLines(worker.slice(policyStart, policyFactoryStart));
  const policyFactory = trimmedExecutableLines(worker.slice(policyFactoryStart, policyFactoryEnd));
  const exactPolicyFields = [
    'readonly maxReceiveCount: number;',
    'readonly visibilityTimeoutSeconds: number;',
    'readonly retryBaseDelaySeconds: number;',
    'readonly retryMaxDelaySeconds: number;',
  ] as const;
  const exactPolicyCopies = [
    'maxReceiveCount: policy.maxReceiveCount,',
    'visibilityTimeoutSeconds: policy.visibilityTimeoutSeconds,',
    'retryBaseDelaySeconds: policy.retryBaseDelaySeconds,',
    'retryMaxDelaySeconds: policy.retryMaxDelaySeconds,',
  ] as const;
  if (
    policyInterface.filter((line) => line.startsWith('readonly ')).length !== 4 ||
    !exactPolicyFields.every((field) => policyInterface.includes(field)) ||
    !exactPolicyCopies.every((copy) => policyFactory.includes(copy)) ||
    exactExecutableLineCount(
      worker,
      "import type { PinnedSqsQueueReceiptPort } from './sqs-queue-receipt.port';",
    ) !== 1 ||
    exactExecutableLineCount(worker, 'private readonly sqs: PinnedSqsQueueReceiptPort,') !== 1 ||
    exactExecutableLineCount(worker, "export type SqsWorkerQueue = 'jobs' | 'balance';") !== 1 ||
    exactExecutableLineCount(worker, "if (queue !== 'jobs' && queue !== 'balance')") !== 1 ||
    /\b(?:queueUrl|deadLetterQueueUrl|balanceQueueUrl|sendJob|publish|publishBatch|healthCheck)\b/u.test(
      worker,
    )
  ) {
    return false;
  }

  const service = sources.sqsServiceSource;
  if (
    exactExecutableLineCount(service, 'this.publisherSqsConfig();') !== 3 ||
    exactExecutableLineCount(service, 'const sqs = this.publisherSqsConfig();') !== 3 ||
    exactExecutableLineCount(service, 'return this.publisherSqsConfig().queueUrl;') !== 1 ||
    exactExecutableLineCount(service, "if (this.config.workload === 'balance-consumer') {") !== 1 ||
    exactExecutableLineCount(
      service,
      "'Balance-consumer SQS receipt transport cannot publish or inspect job queues',",
    ) !== 1
  ) {
    return false;
  }

  const moduleSource = sources.sqsModuleSource;
  if (
    exactExecutableLineCount(moduleSource, "{ provide: SQS_WORKER_QUEUE, useValue: 'jobs' },") !==
      1 ||
    exactExecutableLineCount(
      moduleSource,
      'new PinnedSqsQueueReceiptAdapter(sqs, config.sqs.queueUrl),',
    ) !== 1 ||
    exactExecutableLineCount(
      moduleSource,
      'inject: [SQS_PINNED_QUEUE_RECEIPT, INFRASTRUCTURE_CONFIG, SQS_WORKER_QUEUE],',
    ) !== 1 ||
    exactExecutableLineCount(
      moduleSource,
      '): SqsJobWorker => new SqsJobWorker(receipt, config.sqs, undefined, queue),',
    ) !== 1 ||
    exactExecutableLineCount(
      moduleSource,
      'exports: [OUTBOX_TRANSPORT, SQS_HEALTH, SqsJobWorker],',
    ) !== 1
  ) {
    return false;
  }

  return (
    trimmedExecutableLines(sources.sqsTokensSource).join('\n') ===
    [
      "export const SQS_CLIENT = Symbol('SQS_CLIENT');",
      "export const SQS_PINNED_QUEUE_RECEIPT = Symbol('SQS_PINNED_QUEUE_RECEIPT');",
      "export const SQS_WORKER_QUEUE = Symbol('SQS_WORKER_QUEUE');",
    ].join('\n')
  );
}

function hasExactBalanceConsumerNativeReceiptRedriveContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const applicationBalanceQueue = yamlBlock(sources.applicationTemplateSource, 'BalanceQueue', 1);
  const applicationJobQueue = yamlBlock(sources.applicationTemplateSource, 'JobQueue', 1);
  if (applicationBalanceQueue === null || applicationJobQueue === null) return false;

  const infrastructure = sources.infrastructureConfigSource.replace(/\r\n/gu, '\n');
  const policyStart = infrastructure.indexOf(
    'export const BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY = Object.freeze({',
  );
  const policyEnd = infrastructure.indexOf('function required(', policyStart);
  const balanceLoaderStart = infrastructure.indexOf(
    'export function loadBalanceConsumerInfrastructureConfig(',
  );
  if (policyStart < 0 || policyEnd <= policyStart || balanceLoaderStart < 0) return false;
  const policy = infrastructure.slice(policyStart, policyEnd);
  const balanceLoader = infrastructure.slice(balanceLoaderStart);

  const balanceDomain = sources.balanceSyncDomainSource.replace(/\r\n/gu, '\n');
  const balancePolicyStart = balanceDomain.indexOf(
    'export const BALANCE_SYNC_POLICY = Object.freeze({',
  );
  const balancePolicyEnd = balanceDomain.indexOf('} as const);', balancePolicyStart);
  const observationPolicy = sources.chainObservationPolicySource.replace(/\r\n/gu, '\n');
  const observationPolicyStart = observationPolicy.indexOf(
    'export const CHAIN_OBSERVATION_RESILIENCE_POLICY = deepFreeze({',
  );
  const observationPolicyEnd = observationPolicy.indexOf(
    'export const CHAIN_OBSERVATION_NETWORK_POLICIES',
    observationPolicyStart,
  );
  if (
    balancePolicyStart < 0 ||
    balancePolicyEnd <= balancePolicyStart ||
    observationPolicyStart < 0 ||
    observationPolicyEnd <= observationPolicyStart
  ) {
    return false;
  }
  const balancePolicy = balanceDomain.slice(balancePolicyStart, balancePolicyEnd);
  const resiliencePolicy = observationPolicy.slice(observationPolicyStart, observationPolicyEnd);

  const composition = sources.compositionSource.replace(/\r\n/gu, '\n');
  const orchestrator = sources.balanceSyncOrchestratorSource.replace(/\r\n/gu, '\n');
  const disposition = sources.failClosedJobDispositionSource.replace(/\r\n/gu, '\n');
  const dispatcher = sources.reviewedJobDispatcherSource.replace(/\r\n/gu, '\n');
  const applicationValidator = sources.applicationValidatorSource.replace(/\r\n/gu, '\n');
  const ingressStart = dispatcher.indexOf('export function parseBalanceSyncConsumerJobEnvelope(');
  const ingressEnd = dispatcher.indexOf('function parseHandlers(', ingressStart);
  if (ingressStart < 0 || ingressEnd <= ingressStart) return false;
  const ingress = dispatcher.slice(ingressStart, ingressEnd);
  const genericDispatcherStart = dispatcher.indexOf('export class ReviewedJobDispatcher {');
  const balanceDispatcherStart = dispatcher.indexOf('export class BalanceSyncJobDispatcher {');
  if (genericDispatcherStart < 0 || balanceDispatcherStart <= genericDispatcherStart) {
    return false;
  }
  const genericDispatcher = dispatcher.slice(genericDispatcherStart, balanceDispatcherStart);
  const balanceDispatcher = dispatcher.slice(balanceDispatcherStart);
  const worker = sources.sqsJobWorkerSource.replace(/\r\n/gu, '\n');
  const observability = sources.observabilitySource.replace(/\r\n/gu, '\n');
  const receiptVisibilityDispositionStart = worker.lastIndexOf(
    'await changeVisibilityWithDeadline(',
  );
  const balanceReceiptObservationStart = worker.indexOf(
    'this.observability.recordBalanceReceiptDisposition({',
    receiptVisibilityDispositionStart,
  );
  const balanceReceiptObservationEnd = worker.indexOf(
    'this.observability.recordJobFailure({',
    balanceReceiptObservationStart,
  );
  if (
    receiptVisibilityDispositionStart < 0 ||
    balanceReceiptObservationStart <= receiptVisibilityDispositionStart ||
    balanceReceiptObservationEnd <= balanceReceiptObservationStart
  ) {
    return false;
  }
  const balanceReceiptObservation = worker.slice(
    balanceReceiptObservationStart,
    balanceReceiptObservationEnd,
  );

  return (
    exactExecutableLineCount(applicationBalanceQueue, 'maxReceiveCount: 3') === 1 &&
    !applicationBalanceQueue.includes('maxReceiveCount: !Ref SqsMaxReceiveCount') &&
    exactExecutableLineCount(applicationJobQueue, 'maxReceiveCount: !Ref SqsMaxReceiveCount') ===
      1 &&
    exactExecutableLineCount(applicationJobQueue, 'maxReceiveCount: 3') === 0 &&
    applicationValidator.includes(
      'the exact encrypted, domain-pinned redrive balance-sync source queue topology',
    ) &&
    applicationValidator.includes(
      'the exact dead-letter target and domain-pinned maxReceiveCount of 3',
    ) &&
    exactExecutableLineCount(applicationValidator, "'  maxReceiveCount: 3',") === 1 &&
    exactExecutableLineCount(resiliencePolicy, 'maxAttempts: 3,') === 1 &&
    exactExecutableLineCount(
      balancePolicy,
      'maxAttempts: CHAIN_OBSERVATION_RESILIENCE_POLICY.reads.maxAttempts,',
    ) === 1 &&
    exactExecutableLineCount(balancePolicy, 'retryBaseDelaySeconds: 5,') === 1 &&
    exactExecutableLineCount(balancePolicy, 'retryMaximumDelaySeconds: 60,') === 1 &&
    exactExecutableLineCount(policy, 'maxReceiveCount: BALANCE_SYNC_POLICY.maxAttempts,') === 1 &&
    exactExecutableLineCount(
      policy,
      'retryBaseDelaySeconds: BALANCE_SYNC_POLICY.retryBaseDelaySeconds,',
    ) === 1 &&
    exactExecutableLineCount(
      policy,
      'retryMaxDelaySeconds: BALANCE_SYNC_POLICY.retryMaximumDelaySeconds,',
    ) === 1 &&
    exactExecutableLineCount(
      policy,
      'export function assertBalanceConsumerSqsReceiptRedrivePolicy(',
    ) === 1 &&
    policy.includes(
      'Balance-consumer SQS receipt redrive policy must exactly match BALANCE_SYNC_POLICY',
    ) &&
    exactExecutableLineCount(balanceLoader, 'BALANCE_CONSUMER_SQS_RECEIPT_REDRIVE_POLICY,') === 1 &&
    exactExecutableLineCount(
      balanceLoader,
      'assertBalanceConsumerSqsReceiptRedrivePolicy(sqsClient);',
    ) === 1 &&
    exactExecutableLineCount(
      composition,
      'const receiptPolicy = snapshotReceiptPolicy(dependencies.receiptPolicy);',
    ) === 1 &&
    exactExecutableLineCount(
      composition,
      'visibilityTimeoutSeconds: receiptPolicy.visibilityTimeoutSeconds,',
    ) === 1 &&
    exactExecutableLineCount(composition, 'maxReceiveCount: BALANCE_SYNC_POLICY.maxAttempts,') ===
      1 &&
    exactExecutableLineCount(
      composition,
      'retryBaseDelaySeconds: BALANCE_SYNC_POLICY.retryBaseDelaySeconds,',
    ) === 1 &&
    exactExecutableLineCount(
      composition,
      'retryMaxDelaySeconds: BALANCE_SYNC_POLICY.retryMaximumDelaySeconds,',
    ) === 1 &&
    !/(?:dependencies|receiptPolicy)\.(?:maxReceiveCount|retryBaseDelaySeconds|retryMaxDelaySeconds)\b/u.test(
      composition,
    ) &&
    exactExecutableLineCount(ingress, "job.kind !== 'blockchain.balance-sync' ||") === 1 &&
    exactExecutableLineCount(ingress, 'job.payload.attempt !== 1 ||') === 1 &&
    exactExecutableLineCount(
      ingress,
      "(job.payload.cause !== 'SCHEDULED' && job.payload.cause !== 'MANUAL_RECOVERY')",
    ) === 1 &&
    exactExecutableLineCount(
      disposition,
      'export class FailClosedBalanceSyncJobPort implements BalanceSyncJobPort {',
    ) === 1 &&
    exactExecutableLineCount(
      disposition,
      'const receiptRetryMinimumDelaySecondsByError = new WeakMap<object, number>();',
    ) === 1 &&
    exactExecutableLineCount(
      disposition,
      "const descriptor = Object.getOwnPropertyDescriptor(input, 'delaySeconds');",
    ) === 1 &&
    exactExecutableLineCount(
      disposition,
      'delaySeconds < BALANCE_SYNC_POLICY.retryBaseDelaySeconds ||',
    ) === 1 &&
    exactExecutableLineCount(
      disposition,
      'delaySeconds > BALANCE_SYNC_POLICY.retryMaximumDelaySeconds',
    ) === 1 &&
    exactExecutableLineCount(
      disposition,
      'return receiptRetryMinimumDelaySecondsByError.get(error as object);',
    ) === 1 &&
    exactExecutableLineCount(
      disposition,
      'receiptRetryMinimumDelaySecondsByError.set(error, minimumDelaySeconds);',
    ) === 1 &&
    exactExecutableLineCount(disposition, 'throw error;') === 1 &&
    exactExecutableLineCount(
      disposition,
      'throw new BalanceSyncJobDispositionNotApprovedError();',
    ) === 1 &&
    !disposition.includes('export const receiptRetryMinimumDelaySecondsByError') &&
    !disposition.includes('input.delaySeconds') &&
    !/(?:node:|@aws-sdk|\bfetch\s*\(|\bsendMessage\s*\(|\bdirectDeadLetter\s*\(|\bsendJob\s*\(|\bpublish(?:Batch)?\s*\()/u.test(
      disposition,
    ) &&
    exactExecutableLineCount(
      orchestrator,
      'if (balanceSyncReceiptRetryMinimumDelaySeconds(error) !== undefined) throw error;',
    ) === 1 &&
    exactExecutableLineCount(
      balanceDispatcher,
      'if (balanceSyncReceiptRetryMinimumDelaySeconds(error) !== undefined) throw error;',
    ) === 1 &&
    !genericDispatcher.includes('balanceSyncReceiptRetryMinimumDelaySeconds') &&
    exactExecutableLineCount(
      worker,
      'const exhausted = message.receiveCount >= this.policy.maxReceiveCount;',
    ) === 1 &&
    exactExecutableLineCount(
      worker,
      'this.policy.retryBaseDelaySeconds * 2 ** (message.receiveCount - 1),',
    ) === 1 &&
    exactExecutableLineCount(worker, "this.queue === 'balance'") === 1 &&
    exactExecutableLineCount(worker, '? balanceSyncReceiptRetryMinimumDelaySeconds(error)') === 1 &&
    exactExecutableLineCount(
      worker,
      'Math.max(nativeRetryDelaySeconds, trustedMinimumDelaySeconds ?? 0),',
    ) === 1 &&
    exactExecutableLineCount(worker, "if (this.queue === 'balance') {") === 1 &&
    exactExecutableLineCount(worker, 'this.observability.recordBalanceReceiptDisposition({') ===
      1 &&
    exactExecutableLineCount(balanceReceiptObservation, 'receiveCount: message.receiveCount,') ===
      1 &&
    exactExecutableLineCount(balanceReceiptObservation, 'retryDelaySeconds,') === 1 &&
    exactExecutableLineCount(balanceReceiptObservation, 'trustedProviderDelayFloorApplied,') ===
      1 &&
    exactExecutableLineCount(
      observability,
      'const BALANCE_RECEIPT_RETRY_BASE_DELAY_SECONDS = 5;',
    ) === 1 &&
    exactExecutableLineCount(observability, 'const MAX_BALANCE_RECEIPT_RECEIVE_COUNT = 3;') === 1 &&
    exactExecutableLineCount(
      observability,
      'const MAX_BALANCE_RECEIPT_RETRY_DELAY_SECONDS = 60;',
    ) === 1 &&
    exactExecutableLineCount(
      observability,
      'recordBalanceReceiptDisposition(input: BalanceReceiptDispositionObservation): boolean {',
    ) === 1 &&
    exactExecutableLineCount(observability, "record.queue !== 'balance' ||") === 1 &&
    exactExecutableLineCount(
      observability,
      'const exhausted = record.receiveCount === MAX_BALANCE_RECEIPT_RECEIVE_COUNT;',
    ) === 1 &&
    exactExecutableLineCount(
      observability,
      '? record.retryDelaySeconds !== 0 || record.trustedProviderDelayFloorApplied',
    ) === 1 &&
    exactExecutableLineCount(
      observability,
      '? record.retryDelaySeconds <= nativeRetryDelaySeconds',
    ) === 1 &&
    exactExecutableLineCount(
      observability,
      ': record.retryDelaySeconds !== nativeRetryDelaySeconds',
    ) === 1 &&
    exactExecutableLineCount(observability, "'balance_receipt_dispositions_total',") === 1 &&
    exactExecutableLineCount(observability, "['receive_count', String(record.receiveCount)],") ===
      1 &&
    exactExecutableLineCount(
      observability,
      "['retry_delay_seconds', String(record.retryDelaySeconds)],",
    ) === 1 &&
    exactExecutableLineCount(
      observability,
      "['trusted_provider_delay_floor_applied', String(record.trustedProviderDelayFloorApplied)],",
    ) === 1 &&
    exactExecutableLineCount(worker, 'await changeVisibilityWithDeadline(') === 1 &&
    !/\.(?:scheduleRetry|deadLetter|sendMessage|directDeadLetter)\s*\(/u.test(worker)
  );
}

function hasDormantBalanceConsumerPackagingContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const apiScripts = parsedPackageScripts(sources.apiPackageSource);
  const rootScripts = parsedPackageScripts(sources.rootPackageSource);
  const metadataValidatorPath =
    'infra/aws/validate-balance-consumer-metadata-secret-version-transition.mjs';
  const metadataValidatorTestPath =
    'infra/aws/validate-balance-consumer-metadata-secret-version-transition.test.mjs';
  if (
    apiScripts?.['worker:balance:prod'] !==
      'node dist/blockchain-sync/application/balance-sync-consumer.cli.js' ||
    rootScripts?.['infra:validate:migrations'] !==
      'node infra/aws/validate-database-migration-task.mjs && node infra/postgres/validate-bootstrap-principals.mjs' ||
    rootScripts?.['infra:test:migrations'] !==
      'node --test infra/aws/validate-database-migration-task.test.mjs infra/postgres/validate-bootstrap-principals.test.mjs' ||
    rootScripts?.['infra:validate:balance-consumer-metadata-transition'] !==
      `node ${metadataValidatorPath}` ||
    rootScripts?.['infra:test:balance-consumer-metadata-transition'] !==
      `node --test ${metadataValidatorTestPath}` ||
    typeof rootScripts?.['infra:validate'] !== 'string' ||
    rootScripts['infra:validate'].split(
      'npm run infra:validate:balance-consumer-metadata-transition',
    ).length -
      1 !==
      1 ||
    typeof rootScripts?.['lint:production:artifacts'] !== 'string' ||
    rootScripts['lint:production:artifacts'].split(metadataValidatorPath).length - 1 !== 1 ||
    rootScripts['lint:production:artifacts'].split(metadataValidatorTestPath).length - 1 !== 1
  ) {
    return false;
  }

  const apiRuntimeStart = sources.releaseManifestSource.indexOf("name: 'api-runtime'");
  const nextComponent = sources.releaseManifestSource.indexOf(
    "name: 'web-standalone-runtime'",
    apiRuntimeStart + 1,
  );
  if (apiRuntimeStart < 0 || nextComponent <= apiRuntimeStart) return false;
  const apiRuntime = sources.releaseManifestSource.slice(apiRuntimeStart, nextComponent);
  const containerValidator = sources.productionContainerValidatorSource;
  return (
    exactExecutableLineCount(
      apiRuntime,
      "'blockchain-sync/application/balance-sync-consumer.cli.js',",
    ) === 1 &&
    containerValidator.includes(
      "path: 'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli.ts',",
    ) &&
    containerValidator.includes(
      "path: 'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli-mode.ts',",
    ) &&
    containerValidator.includes('const expectedDormantRuntime = [') &&
    containerValidator.includes('const forbiddenRuntimeDependency =') &&
    containerValidator.includes('runtimeWithoutComments === expectedDormantRuntime &&') &&
    containerValidator.includes(
      'Balance consumer dormant runtime must remain dependency-empty and reject with its fixed not-composed error',
    ) &&
    !containerValidator.includes(
      'Balance consumer runtime dependencies must remain isolated in the dormant runtime module',
    ) &&
    containerValidator.includes('...validateBalanceConsumerExecutable(sources),') &&
    containerValidator.includes(
      'sources.balanceConsumerCli.includes("from \'./balance-sync-consumer.cli-mode\'")',
    )
  );
}

function hasUncomposedBalanceConsumerParentContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const requiredLogicalIds = [
    'ApiTaskDefinition',
    'WebTaskDefinition',
    'WorkerTaskDefinition',
    'ApiService',
    'WebService',
    'WorkerService',
  ] as const;
  if (
    requiredLogicalIds.some(
      (logicalId) => yamlBlock(sources.applicationTemplateSource, logicalId, 1) === null,
    ) ||
    exactExecutableLineCount(
      sources.applicationTemplateSource,
      'Type: AWS::ECS::TaskDefinition',
    ) !== 3 ||
    exactExecutableLineCount(sources.applicationTemplateSource, 'Type: AWS::ECS::Service') !== 3 ||
    /balance-consumer-deployment-envelope|balance-sync-consumer\.cli\.js|APPLICATION_WORKLOAD[^\n]*balance-consumer|BalanceConsumer(?:TaskDefinition|Service)/iu.test(
      sources.applicationTemplateSource,
    )
  ) {
    return false;
  }

  return (
    exactExecutableLineCount(
      sources.applicationValidatorSource,
      "['AWS::ECS::TaskDefinition', 3],",
    ) === 1 &&
    exactExecutableLineCount(sources.applicationValidatorSource, "['AWS::ECS::Service', 3],") ===
      1 &&
    exactExecutableLineCount(
      sources.applicationValidatorSource,
      'errors.push(`Reviewed resource graph contains unapproved resource ${logicalId}.`);',
    ) === 1 &&
    !/balance-consumer-deployment-envelope|BalanceConsumer(?:TaskDefinition|Service)/iu.test(
      sources.applicationValidatorSource,
    )
  );
}

function hasIsolatedBalanceConsumerWorkloadContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const workloadLines = trimmedExecutableLines(sources.workloadTemplateSource);
  const workloadValidatorLines = trimmedExecutableLines(sources.workloadValidatorSource);
  const forbiddenQueueCapability =
    /sqs:(?:ReceiveMessage|DeleteMessage|ChangeMessageVisibility|\*)/iu;
  const expectedRoles = [
    'ApiTaskExecutionRole',
    'WebTaskExecutionRole',
    'WebTaskRole',
    'ApiTaskRole',
    'WorkerTaskRole',
    'WorkerTaskExecutionRole',
    'RedisOperatorTaskExecutionRole',
  ] as const;
  return (
    workloadLines.filter((line) => line === 'Type: AWS::IAM::Role').length === 7 &&
    !forbiddenQueueCapability.test(workloadLines.join('\n')) &&
    !/balance-consumer-deployment-envelope|BalanceConsumer(?:TaskRole|TaskExecutionRole)/iu.test(
      sources.workloadTemplateSource,
    ) &&
    expectedRoles.every(
      (logicalId) => yamlBlock(sources.workloadTemplateSource, logicalId, 2) !== null,
    ) &&
    expectedRoles.every(
      (logicalId) =>
        exactExecutableLineCount(
          sources.workloadValidatorSource,
          `['${logicalId}', 'AWS::IAM::Role'],`,
        ) === 1,
    ) &&
    workloadValidatorLines.filter((line) => line.endsWith("'AWS::IAM::Role'],")).length === 7 &&
    exactExecutableLineCount(
      sources.workloadValidatorSource,
      "requireExactIds(resources, resourceTypes, 'Resource allowlist', errors);",
    ) === 1 &&
    !forbiddenQueueCapability.test(workloadValidatorLines.join('\n')) &&
    !/balance-consumer-deployment-envelope|BalanceConsumer(?:TaskRole|TaskExecutionRole)/iu.test(
      sources.workloadValidatorSource,
    )
  );
}

function hasExactAwsPolicyActions(source: string, expected: readonly string[]): boolean {
  const actual = [
    ...source.matchAll(/\b((?:ecr|kms|logs|secretsmanager|sqs|sts):[A-Za-z][A-Za-z0-9*]*)\b/gu),
  ]
    .map((match) => match[1])
    .filter((action): action is string => action !== undefined && action !== 'kms:ViaService')
    .sort();
  return actual.join('|') === [...expected].sort().join('|');
}

function hasExactBalanceConsumerEnvelopeResourceGraph(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const envelope = sources.balanceConsumerEnvelopeSource.replace(/\r\n/gu, '\n');
  const resources = yamlBlock(envelope, 'Resources', 0);
  if (resources === null) return false;
  const expectedResources = [
    ['BalanceConsumerLogGroup', 'AWS::Logs::LogGroup'],
    ['BalanceConsumerTaskSecurityGroup', 'AWS::EC2::SecurityGroup'],
    ['BalanceConsumerTaskExecutionRole', 'AWS::IAM::Role'],
    ['BalanceConsumerTaskRole', 'AWS::IAM::Role'],
    ['BalanceConsumerTaskDefinition', 'AWS::ECS::TaskDefinition'],
    ['BalanceConsumerService', 'AWS::ECS::Service'],
  ] as const;
  const resourceNames = resources.split('\n').flatMap((line) => {
    const match = /^ {2}([A-Za-z][A-Za-z0-9]*):\s*$/u.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
  return (
    resourceNames.join('|') === expectedResources.map(([logicalId]) => logicalId).join('|') &&
    expectedResources.every(([logicalId, type]) => {
      const block = yamlBlock(resources, logicalId, 2);
      return hasExactYamlScalarProperty(block, 'Type', type);
    })
  );
}

function hasExactStandaloneBalanceConsumerEnvelopeContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const envelope = sources.balanceConsumerEnvelopeSource.replace(/\r\n/gu, '\n');
  const executionRole = yamlBlock(envelope, 'BalanceConsumerTaskExecutionRole', 2);
  const taskRole = yamlBlock(envelope, 'BalanceConsumerTaskRole', 2);
  const taskDefinition = yamlBlock(envelope, 'BalanceConsumerTaskDefinition', 2);
  const service = yamlBlock(envelope, 'BalanceConsumerService', 2);
  const securityGroup = yamlBlock(envelope, 'BalanceConsumerTaskSecurityGroup', 2);
  const billingRule = yamlBlock(envelope, 'ExplicitBillingAcknowledgementRequired', 2);
  if (
    executionRole === null ||
    taskRole === null ||
    taskDefinition === null ||
    service === null ||
    securityGroup === null ||
    billingRule === null
  ) {
    return false;
  }

  const executionActions = [
    'sts:AssumeRole',
    'ecr:GetAuthorizationToken',
    'ecr:BatchCheckLayerAvailability',
    'ecr:BatchGetImage',
    'ecr:GetDownloadUrlForLayer',
    'logs:CreateLogStream',
    'logs:PutLogEvents',
  ] as const;
  const receiptActions = [
    'sts:AssumeRole',
    'sqs:ReceiveMessage',
    'sqs:DeleteMessage',
    'sqs:ChangeMessageVisibility',
    'kms:Decrypt',
  ] as const;
  const expectedEnvironmentNames = [
    'NODE_ENV',
    'APP_ENV',
    'APPLICATION_WORKLOAD',
    'BALANCE_CONSUMER_MODE',
    'BALANCE_CONSUMER_NETWORK',
    'BALANCE_CONSUMER_SOURCE_APPROVAL',
    'AWS_REGION',
    'SQS_BALANCE_QUEUE_URL',
    'SQS_BALANCE_DEAD_LETTER_QUEUE_URL',
    'SQS_MAX_RECEIVE_COUNT',
    'SQS_VISIBILITY_TIMEOUT_SECONDS',
    'SQS_RETRY_BASE_DELAY_SECONDS',
    'SQS_RETRY_MAX_DELAY_SECONDS',
  ] as const;
  const environment =
    taskDefinition.match(/\n\s+Environment:\n([\s\S]*?)\n\s+LinuxParameters:/u)?.[1] ?? '';
  const actualEnvironmentNames = [
    ...environment.matchAll(/\bName:\s*([A-Z][A-Z0-9_]*)\b/gu),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
  const exactEnvironment =
    actualEnvironmentNames.length === expectedEnvironmentNames.length &&
    expectedEnvironmentNames.every(
      (name) => actualEnvironmentNames.filter((actual) => actual === name).length === 1,
    );

  const nonProductionAndBillingGated =
    hasExactTopLevelParameter(envelope, 'BillingAcknowledgement', [
      'Type: String',
      'Default: NOT_AUTHORIZED',
      'AllowedValues: [NOT_AUTHORIZED, I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES]',
    ]) &&
    hasExactTopLevelParameter(envelope, 'EnvironmentName', [
      'Type: String',
      'MaxLength: 31',
      "AllowedPattern: '^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'",
    ]) &&
    exactExecutableLineCount(billingRule, '- !Ref BillingAcknowledgement') === 1 &&
    exactExecutableLineCount(billingRule, '- I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES') ===
      1 &&
    !/(?:^|\n)(?:Transform|Conditions):/u.test(envelope);

  const networkIsolated =
    hasExactYamlScalarProperty(
      securityGroup,
      'SecurityGroupEgress',
      "[{ CidrIp: 127.0.0.1/32, IpProtocol: '-1' }]",
    ) &&
    !/SecurityGroupIngress:|AWS::EC2::SecurityGroup(?:Ingress|Egress)|0\.0\.0\.0\/0|::\/0/u.test(
      envelope,
    );

  const executionRoleIsImageAndLogOnly =
    hasExactAwsPolicyActions(executionRole, executionActions) &&
    exactExecutableLineCount(executionRole, "Resource: '*'") === 1 &&
    exactExecutableLineCount(
      executionRole,
      'Resource: !Sub arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/crypto-lending-api',
    ) === 1 &&
    exactExecutableLineCount(
      executionRole,
      'Resource: !Sub arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/crypto-lending/${EnvironmentName}/balance-consumer:*',
    ) === 1 &&
    !/(?:secretsmanager|sqs|kms):/iu.test(executionRole);

  const taskRoleIsReceiptOnly =
    hasExactAwsPolicyActions(taskRole, receiptActions) &&
    exactExecutableLineCount(
      taskRole,
      'Resource: !Sub arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:crypto-lending-${EnvironmentName}-balance-sync',
    ) === 1 &&
    exactExecutableLineCount(
      taskRole,
      'Resource: !Sub arn:${AWS::Partition}:kms:${AWS::Region}:${AWS::AccountId}:key/${ApplicationDataKeyId}',
    ) === 1 &&
    exactExecutableLineCount(
      taskRole,
      'kms:ViaService: !Sub sqs.${AWS::Region}.${AWS::URLSuffix}',
    ) === 1 &&
    !/(?:SendMessage|GetQueueAttributes|DeadLetter|jobs|balance-sync-dlq|secretsmanager:|ecr:|logs:)/iu.test(
      taskRole,
    ) &&
    !/Action:\s*(?:\[[^\]]*\*|['"]?[^\s'"]*\*)|Resource:\s*(?:\[[^\]]*\*|['"]?\*)/u.test(taskRole);

  const taskIsDisabledAndHardened =
    exactEnvironment &&
    hasExactYamlScalarProperty(
      taskDefinition,
      'Image',
      '!Sub ${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/crypto-lending-api@sha256:${ApiImageDigest}',
    ) &&
    exactExecutableLineCount(
      taskDefinition,
      'Command: [node, dist/blockchain-sync/application/balance-sync-consumer.cli.js]',
    ) === 1 &&
    exactExecutableLineCount(
      taskDefinition,
      '- { Name: APPLICATION_WORKLOAD, Value: balance-consumer }',
    ) === 1 &&
    exactExecutableLineCount(
      taskDefinition,
      '- { Name: BALANCE_CONSUMER_MODE, Value: disabled }',
    ) === 1 &&
    exactExecutableLineCount(
      taskDefinition,
      '- { Name: BALANCE_CONSUMER_NETWORK, Value: ethereum-solana-mainnet }',
    ) === 1 &&
    exactExecutableLineCount(
      taskDefinition,
      '- { Name: BALANCE_CONSUMER_SOURCE_APPROVAL, Value: ethereum-solana-mainnet-reviewed }',
    ) === 1 &&
    exactExecutableLineCount(taskDefinition, "- { Name: SQS_MAX_RECEIVE_COUNT, Value: '3' }") ===
      1 &&
    exactExecutableLineCount(
      taskDefinition,
      '- { Name: SQS_VISIBILITY_TIMEOUT_SECONDS, Value: !Ref SqsVisibilityTimeoutSeconds }',
    ) === 1 &&
    exactExecutableLineCount(
      taskDefinition,
      "- { Name: SQS_RETRY_BASE_DELAY_SECONDS, Value: '5' }",
    ) === 1 &&
    exactExecutableLineCount(
      taskDefinition,
      "- { Name: SQS_RETRY_MAX_DELAY_SECONDS, Value: '60' }",
    ) === 1 &&
    !/(?:^|\n) {2}SqsMaxReceiveCount:\s*$/u.test(envelope) &&
    exactExecutableLineCount(taskDefinition, 'Capabilities: { Drop: [ALL] }') === 1 &&
    hasExactYamlScalarProperty(taskDefinition, 'ReadonlyRootFilesystem', 'true') &&
    hasExactYamlScalarProperty(taskDefinition, 'StopTimeout', '30') &&
    hasExactYamlScalarProperty(taskDefinition, 'User', "'10001:10001'") &&
    hasExactYamlScalarProperty(taskDefinition, 'NetworkMode', 'awsvpc') &&
    exactExecutableLineCount(taskDefinition, 'RequiresCompatibilities: [FARGATE]') === 1 &&
    !/^\s+Secrets:/mu.test(taskDefinition) &&
    !/\bName:\s*(?:SQS_QUEUE_URL|SQS_DEAD_LETTER_QUEUE_URL)\b/u.test(taskDefinition) &&
    !/\b(?:DATABASE|REDIS|AUTH|OIDC|WALLET|RPC|ETHEREUM|SOLANA|PROVIDER)_[A-Z0-9_]+\b/iu.test(
      taskDefinition,
    );

  const serviceIsHardZero =
    hasExactYamlScalarProperty(service, 'DesiredCount', '0') &&
    hasExactYamlScalarProperty(service, 'EnableExecuteCommand', 'false') &&
    hasExactYamlScalarProperty(service, 'AssignPublicIp', 'DISABLED') &&
    hasExactYamlScalarProperty(service, 'LaunchType', 'FARGATE') &&
    hasExactYamlScalarProperty(service, 'PlatformVersion', '1.4.0') &&
    hasExactYamlScalarProperty(
      service,
      'SecurityGroups',
      '[!Ref BalanceConsumerTaskSecurityGroup]',
    ) &&
    hasExactYamlScalarProperty(service, 'TaskDefinition', '!Ref BalanceConsumerTaskDefinition') &&
    !/DesiredCount:\s*!|DesiredCount:\s*[1-9]|AssignPublicIp:\s*ENABLED/iu.test(service);

  const noRuntimeAuthority =
    !/AWS::SecretsManager|secretsmanager:|\b(?:DATABASE|REDIS|AUTH|OIDC|WALLET|RPC|PROVIDER)_[A-Z0-9_]+\b/iu.test(
      envelope,
    );

  return (
    hasExactBalanceConsumerEnvelopeResourceGraph(sources) &&
    nonProductionAndBillingGated &&
    networkIsolated &&
    executionRoleIsImageAndLogOnly &&
    taskRoleIsReceiptOnly &&
    taskIsDisabledAndHardened &&
    serviceIsHardZero &&
    noRuntimeAuthority
  );
}

function hasExactBalanceConsumerEnvelopeValidatorContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const validator = sources.balanceConsumerEnvelopeValidatorSource.replace(/\r\n/gu, '\n');
  const requiredResourceEntries = [
    "['BalanceConsumerLogGroup', 'AWS::Logs::LogGroup'],",
    "['BalanceConsumerTaskSecurityGroup', 'AWS::EC2::SecurityGroup'],",
    "['BalanceConsumerTaskExecutionRole', 'AWS::IAM::Role'],",
    "['BalanceConsumerTaskRole', 'AWS::IAM::Role'],",
    "['BalanceConsumerTaskDefinition', 'AWS::ECS::TaskDefinition'],",
    "['BalanceConsumerService', 'AWS::ECS::Service'],",
  ] as const;
  const requiredValidationCalls = [
    'validateParameters(source, errors);',
    'validateRules(source, errors);',
    'const resources = validateResourceInventory(source, errors);',
    'validateNetwork(resources, source, errors);',
    'validateIam(resources, errors);',
    'validateTaskDefinition(resources, errors);',
    'validateService(resources, errors);',
    'validateLogGroup(resources, errors);',
    'validateOutputs(source, errors);',
  ] as const;
  const requiredEnforcementMarkers = [
    "const reviewedTemplateSha256 = '3b621023e516cd553c34fbe09e4b0047d1395fab45e105eef7692570d6429045';",
    "'UNCOMPOSED_SOURCE_ONLY: release and preflight controls only bind and inspect this source; no application parent template or deployment target composes or provisions it.',",
    "'HARD_ZERO_AND_NO_EGRESS: the ECS service has a literal desired count of zero and its dedicated security group has no external egress path, so this source cannot run the consumer.',",
    "'NON_PRODUCTION_ONLY: EnvironmentName accepts only dev, test, qa, sandbox, or staging families, and deployment still requires explicit billing acknowledgement.',",
    "'SOURCE_QUEUE_REDRIVE_UNBOUND: this standalone envelope pins only consumer-process settings; it neither defines nor proves the source queue RedrivePolicy, whose deployed maxReceiveCount remains separately blocked.',",
    "'ACTIVATION_GATES_UNRESOLVED: source activation, runtime composition, database grants and credentials, metadata-only secret custody, mainnet RPC egress, operational ownership, and deployed evidence remain absent.',",
    "requireExactIds(resources, expectedResources, 'Resource allowlist', errors);",
    `"[{ CidrIp: 127.0.0.1/32, IpProtocol: '-1' }]"`,
    "'BalanceConsumerTaskExecutionRole must be image-pull/log-only with only the ECR authorization wildcard.',",
    "'BalanceConsumerTaskRole must have only exact source receive/delete/change-visibility and SQS-scoped decrypt authority.',",
    "'BalanceConsumerTaskDefinition must receive only the thirteen reviewed nonsecret settings.',",
    "'BalanceConsumerTaskDefinition must not receive generic queues, databases, Redis, auth/wallet, RPC/provider endpoints or credentials, or secret configuration.',",
    "'BalanceConsumerService must remain hard-zero with no public IP activation path.'",
    'if (templateSha256 !== reviewedTemplateSha256) {',
  ] as const;
  const checks = [
    requiredResourceEntries.every((line) => exactExecutableLineCount(validator, line) === 1),
    trimmedExecutableLines(validator).filter(
      (line) =>
        line.endsWith("'AWS::ECS::TaskDefinition'],") ||
        line.endsWith("'AWS::ECS::Service'],") ||
        line.endsWith("'AWS::IAM::Role'],") ||
        line.endsWith("'AWS::EC2::SecurityGroup'],") ||
        line.endsWith("'AWS::Logs::LogGroup'],"),
    ).length === 6,
    requiredValidationCalls.every((line) => exactExecutableLineCount(validator, line) === 1),
    requiredEnforcementMarkers.every((fragment) => validator.includes(fragment)),
    validator.includes("'^(dev|test|qa|sandbox|staging)(-[a-z0-9]+)*$'"),
    validator.includes('I_ACKNOWLEDGE_THIS_CREATES_BILLABLE_AWS_RESOURCES'),
    validator.includes("'sqs:ReceiveMessage'"),
    validator.includes("'sqs:DeleteMessage'"),
    validator.includes("'sqs:ChangeMessageVisibility'"),
    validator.includes("'kms:Decrypt'"),
    validator.includes('kms:ViaService: !Sub sqs.${AWS::Region}.${AWS::URLSuffix}'),
    validator.includes(
      '(?:SendMessage|GetQueueAttributes|DeadLetter|jobs|balance-sync-dlq|secretsmanager:|ecr:|logs:)',
    ),
    validator.includes('crypto-lending-api@sha256:${ApiImageDigest}'),
    validator.includes('balance-sync-consumer.cli.js'),
    validator.includes('BALANCE_CONSUMER_MODE, Value: disabled'),
    validator.includes('BALANCE_CONSUMER_NETWORK, Value: ethereum-solana-mainnet'),
    validator.includes('BALANCE_CONSUMER_SOURCE_APPROVAL, Value: ethereum-solana-mainnet-reviewed'),
    validator.includes("SQS_MAX_RECEIVE_COUNT, Value: '3'"),
    validator.includes("SQS_RETRY_BASE_DELAY_SECONDS, Value: '5'"),
    validator.includes("SQS_RETRY_MAX_DELAY_SECONDS, Value: '60'"),
    !validator.includes("['SqsMaxReceiveCount', 'Number']"),
    validator.includes("['DesiredCount', '0']"),
    validator.includes("['EnableExecuteCommand', 'false']"),
    validator.includes("['AssignPublicIp', 'DISABLED']"),
    validator.includes("['PlatformVersion', '1.4.0']"),
    !/node:(?:child_process|dns|http|https|net|tls)|\bfetch\s*\(/u.test(validator),
  ];
  return checks.every(Boolean);
}

function hasExactBalanceConsumerMetadataTransitionValidatorContract(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const validator = sources.balanceConsumerMetadataTransitionValidatorSource.replace(
    /\r\n/gu,
    '\n',
  );
  const registryStart = validator.indexOf(
    'export const BALANCE_CONSUMER_METADATA_TRANSITION_AUTHORITY_KEY_REGISTRY = deepFreeze({',
  );
  const registryEnd = validator.indexOf('});', registryStart);
  const zeroCallsStart = validator.indexOf('const ZERO_CALLS = Object.freeze({');
  const zeroCallsEnd = validator.indexOf('});', zeroCallsStart);
  const localRootStart = validator.indexOf(
    'export const LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT = join(',
  );
  const localRootEnd = validator.indexOf(');', localRootStart);
  if (
    registryStart < 0 ||
    registryEnd <= registryStart ||
    zeroCallsStart < 0 ||
    zeroCallsEnd <= zeroCallsStart ||
    localRootStart < 0 ||
    localRootEnd <= localRootStart
  ) {
    return false;
  }

  const registry = trimmedExecutableLines(validator.slice(registryStart, registryEnd + 3));
  const zeroCalls = trimmedExecutableLines(validator.slice(zeroCallsStart, zeroCallsEnd + 3));
  const localRoot = trimmedExecutableLines(validator.slice(localRootStart, localRootEnd + 2));
  const forbiddenCapability =
    /(?:from\s+['"]node:(?:child_process|cluster|dgram|dns|fs|http|https|net|tls|worker_threads)['"]|from\s+['"](?:@aws-sdk\/|aws-sdk|axios|ioredis|pg|redis|undici)['"]|\b(?:fetch|XMLHttpRequest|WebSocket|spawn|execFile|fork|createConnection|writeFile|appendFile|mkdir|mkdtemp|rm|unlink|rename|copyFile)(?:Sync)?\s*\(|\bprocess\.env\b)/u;
  const exactZeroCalls = [
    'const ZERO_CALLS = Object.freeze({',
    'externalCallsMade: 0,',
    'awsCallsMade: 0,',
    'databaseConnectionsMade: 0,',
    'redisConnectionsMade: 0,',
    'dnsQueriesMade: 0,',
    'httpRequestsMade: 0,',
    'secretValuesRead: 0,',
    'resourcesCreated: 0,',
    'credentialBytesRead: 0,',
    'filesWritten: 0,',
    '});',
  ] as const;

  return (
    exactExecutableLineCount(
      validator,
      `const ENVIRONMENT_PATTERN = ${PRODUCTION_AWARE_ENVIRONMENT_PATTERN_SOURCE};`,
    ) === 1 &&
    exactExecutableLineCount(validator, "'BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON';") ===
      1 &&
    registry.join('\n') ===
      [
        'export const BALANCE_CONSUMER_METADATA_TRANSITION_AUTHORITY_KEY_REGISTRY = deepFreeze({',
        'schemaVersion: 1,',
        'artifactType: AUTHORITY_ARTIFACT_TYPE,',
        'keys: [],',
        '});',
      ].join('\n') &&
    zeroCalls.join('\n') === exactZeroCalls.join('\n') &&
    localRoot.join('\n') ===
      [
        'export const LOCAL_BALANCE_CONSUMER_METADATA_TRANSITION_ROOT = join(',
        'REPOSITORY_ROOT,',
        "'.local-validation',",
        ');',
      ].join('\n') &&
    exactExecutableLineCount(
      validator,
      "!resolvedPath.toLowerCase().endsWith('.balance-consumer-metadata-transition.local.json')",
    ) === 1 &&
    exactExecutableLineCount(
      validator,
      '? readSecureLocalFile(resolvedPath, MAX_BALANCE_CONSUMER_METADATA_TRANSITION_RECORD_BYTES)',
    ) === 1 &&
    exactExecutableLineCount(validator, 'const record = parseStrictJsonBytes(bytes);') === 1 &&
    exactExecutableLineCount(
      validator,
      'if (canonicalizeBalanceConsumerMetadataTransitionValue(record) !== text) {',
    ) === 1 &&
    exactExecutableLineCount(validator, "if ((options.mode ?? 'example') !== 'example') {") === 1 &&
    exactExecutableLineCount(
      validator,
      "'Operational records require verification through the production authority path.',",
    ) === 1 &&
    exactExecutableLineCount(
      validator,
      'BALANCE_CONSUMER_METADATA_TRANSITION_AUTHORITY_KEY_REGISTRY,',
    ) === 1 &&
    exactExecutableLineCount(validator, 'if (ok && signatureValidated && production) {') === 1 &&
    exactExecutableLineCount(validator, 'executionAllowed: false,') === 1 &&
    exactExecutableLineCount(validator, "'NO_SECRET_OR_KEY_MATERIAL',") === 1 &&
    exactExecutableLineCount(validator, "'NO_SECRET_VALUE_HASHES',") === 1 &&
    exactExecutableLineCount(validator, "'NO_AWS_CALLS',") === 1 &&
    exactExecutableLineCount(validator, "'NO_DATABASE_OR_REDIS_CONNECTIONS',") === 1 &&
    exactExecutableLineCount(validator, "'NO_NETWORK_OR_DNS',") === 1 &&
    exactExecutableLineCount(validator, "'NO_RESOURCE_MUTATION',") === 1 &&
    exactExecutableLineCount(validator, "'NO_FILE_WRITES',") === 1 &&
    exactExecutableLineCount(validator, "'NO_RUNTIME_ACTIVATION',") === 1 &&
    !forbiddenCapability.test(validator)
  );
}

function hasDormantBalanceConsumerDatabaseCapability(
  sources: BalanceConsumerArtifactSources,
): boolean {
  const bootstrap = sources.bootstrapPrincipalsSource.replace(/\r\n/gu, '\n');
  const bootstrapLines = trimmedExecutableLines(bootstrap);
  const executableBootstrap = bootstrapLines.join('\n');
  const grantConnectStart = executableBootstrap.indexOf(
    "'GRANT CONNECT ON DATABASE %I TO %I, %I, %I'",
  );
  const grantConnectEnd = executableBootstrap.indexOf('\\gexec', grantConnectStart);
  const grantConnect =
    grantConnectStart >= 0 && grantConnectEnd > grantConnectStart
      ? executableBootstrap.slice(grantConnectStart, grantConnectEnd)
      : '';
  const requiredBootstrapInputs = [
    'balance_consumer_runtime_role',
    'balance_consumer_login_prefix',
    'balance_consumer_login',
  ] as const;
  if (
    requiredBootstrapInputs.some(
      (name) => bootstrapLines.filter((line) => line === `\\if :{?${name}}`).length !== 1,
    ) ||
    !executableBootstrap.includes(
      "'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',\n:'balance_consumer_runtime_role', :'balance_consumer_login'",
    ) ||
    grantConnect.length === 0 ||
    grantConnect.includes('balance_consumer') ||
    /balance_consumer_(?:login_)?password/iu.test(executableBootstrap) ||
    /GRANT\s+(?:USAGE|CREATE|SELECT|INSERT|UPDATE|DELETE|EXECUTE|ALL)[\s\S]{0,160}(?:SCHEMA|TABLE|SEQUENCE|FUNCTION|TYPE)[\s\S]{0,160}balance_consumer/iu.test(
      executableBootstrap,
    )
  ) {
    return false;
  }

  const validator = sources.bootstrapPrincipalsValidatorSource;
  if (
    exactExecutableLineCount(
      validator,
      'export function validateBootstrapPrincipalsSource(source) {',
    ) !== 1 ||
    exactExecutableLineCount(
      validator,
      "errors.push('Bootstrap must never accept, embed, print, or mutate credential material');",
    ) !== 1 ||
    exactExecutableLineCount(
      validator,
      "errors.push('Bootstrap must keep balance-consumer database, schema, and object ACLs denied');",
    ) !== 1 ||
    /node:(?:child_process|dns|http|https|net|tls)|\bfetch\s*\(/u.test(validator)
  ) {
    return false;
  }

  return (
    sources.walletAddressMigrationSource.includes(
      'GRANT EXECUTE ON FUNCTION ${RESOLVE_ACTIVE_ADDRESS} TO ${worker};',
    ) &&
    !/balance_consumer_(?:runtime_role|login)/iu.test(sources.walletAddressMigrationSource) &&
    hasGenericWorkerBalanceAuthoritySuspensionContract(
      sources.workerAuthoritySuspensionMigrationSource,
      sources.migrationIndexSource,
    )
  );
}

function hasGenericWorkerBalanceAuthoritySuspensionContract(
  migrationSource: string,
  migrationIndexSource: string,
): boolean {
  const migration = migrationSource.replace(/\r\n/gu, '\n');
  const migrationIndex = migrationIndexSource.replace(/\r\n/gu, '\n');
  const suspendedFunctionListStart = migration.indexOf(
    'const SUSPENDED_WORKER_FUNCTIONS = Object.freeze([',
  );
  const suspendedFunctionListEnd = migration.indexOf('] as const);', suspendedFunctionListStart);
  if (suspendedFunctionListStart < 0 || suspendedFunctionListEnd < suspendedFunctionListStart) {
    return false;
  }
  const suspendedFunctionList = trimmedExecutableLines(
    migration.slice(suspendedFunctionListStart, suspendedFunctionListEnd + '] as const);'.length),
  );
  if (
    suspendedFunctionList.join('\n') !==
    [
      'const SUSPENDED_WORKER_FUNCTIONS = Object.freeze([',
      'READ_CHECKPOINT,',
      'RECORD_CURRENT,',
      'MARK_STALE,',
      'REPLACE_AFTER_REORG,',
      'RESOLVE_ACTIVE_ADDRESS,',
      '] as const);',
    ].join('\n')
  ) {
    return false;
  }
  const exactSuspendedFunctionIdentities = [
    'read_balance_sync_checkpoint(uuid,uuid,text)',
    'record_balance_sync_current(uuid,uuid,text,bigint,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
    'mark_balance_sync_checkpoint_stale(uuid,uuid,text,bigint,timestamp with time zone,text)',
    'replace_balance_sync_after_reorg(uuid,uuid,text,bigint,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
    'resolve_active_wallet_address_ciphertext(uuid,uuid,text)',
  ] as const;
  if (
    exactSuspendedFunctionIdentities.some(
      (identity) => migration.split(`'${identity}'`).length - 1 !== 1,
    )
  ) {
    return false;
  }

  const upStart = migration.indexOf('function createUpSql(');
  const downStart = migration.indexOf('function createDownSql()', upStart);
  const verifierStart = migration.indexOf('function createWorkerAuthorityVerifier(', downStart);
  if (upStart < 0 || downStart <= upStart || verifierStart <= downStart) return false;
  const upSql = migration.slice(upStart, downStart);
  const downSql = migration.slice(downStart, verifierStart);
  if (
    exactExecutableLineCount(
      upSql,
      "const worker = identifier(names.workerRuntimeRole, 'workerRuntimeRole');",
    ) !== 1 ||
    exactExecutableLineCount(
      upSql,
      '(functionIdentity) => `REVOKE EXECUTE ON FUNCTION ${functionIdentity} FROM ${worker};`,',
    ) !== 1 ||
    /\bGRANT\s+(?:ALL|CONNECT|CREATE|DELETE|EXECUTE|INSERT|SELECT|TEMP|UPDATE|USAGE)\b/iu.test(
      upSql,
    ) ||
    /\b(?:activate|enabled)\b/iu.test(upSql) ||
    exactExecutableLineCount(downSql, 'RAISE EXCEPTION') !== 1 ||
    exactExecutableLineCount(downSql, "USING ERRCODE = '55000';") !== 1 ||
    /\bGRANT\s+(?:ALL|CONNECT|CREATE|DELETE|EXECUTE|INSERT|SELECT|TEMP|UPDATE|USAGE)\b/iu.test(
      downSql,
    )
  ) {
    return false;
  }

  if (
    exactExecutableLineCount(migration, "id: '0028',") !== 1 ||
    exactExecutableLineCount(migration, "supersedesVerificationOf: ['0027'],") !== 1
  ) {
    return false;
  }

  const importRegistration = `import {
  suspendGenericWorkerBalanceAuthorityMigrationV0028,
  suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028,
} from './0028-suspend-generic-worker-balance-authority.migration';`;
  const exportRegistration = `export {
  createGenericWorkerBalanceAuthoritySuspensionMigration,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
  suspendGenericWorkerBalanceAuthorityMigrationV0028,
  suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028,
} from './0028-suspend-generic-worker-balance-authority.migration';
export type { BalanceConsumerPrincipalNames } from './0028-suspend-generic-worker-balance-authority.migration';`;
  const testListStart = migrationIndex.indexOf('export const DATABASE_TEST_SCHEMA_MIGRATION_LIST:');
  const productionListStart = migrationIndex.indexOf(
    'export const DATABASE_MIGRATION_LIST:',
    testListStart,
  );
  const exportStart = migrationIndex.indexOf(
    "export type { DatabaseMigration } from './migration';",
  );
  if (
    testListStart < 0 ||
    productionListStart <= testListStart ||
    exportStart <= productionListStart ||
    migrationIndex.split(importRegistration).length - 1 !== 1 ||
    migrationIndex.split(exportRegistration).length - 1 !== 1
  ) {
    return false;
  }
  const testList = migrationIndex.slice(testListStart, productionListStart);
  const productionList = migrationIndex.slice(productionListStart, exportStart);
  return (
    exactExecutableLineCount(
      testList,
      'suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028,',
    ) === 1 &&
    !testList.includes('suspendGenericWorkerBalanceAuthorityMigrationV0028,') &&
    exactExecutableLineCount(
      productionList,
      'suspendGenericWorkerBalanceAuthorityMigrationV0028,',
    ) === 1 &&
    !productionList.includes('suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028,')
  );
}

/**
 * Recognizes only the exact source-authored dormant balance-consumer boundary.
 * A successful inspection deliberately cannot represent deployed readiness or
 * authorize activation; those require target-bound signed evidence in a future schema.
 */
export function inspectBalanceConsumerDeploymentArtifacts(
  value: unknown,
): BalanceConsumerDeploymentInput {
  const invalid = (inspected: boolean): BalanceConsumerDeploymentInput =>
    Object.freeze({
      inspected,
      contractValid: false,
      sourceActivation: 'INVALID',
      runtimeComposition: 'INVALID',
      taskDeployment: 'INVALID',
      iamCapability: 'INVALID',
      databaseCapability: 'INVALID',
      deploymentEvidence: 'INVALID',
    });
  try {
    const sources = snapshotBalanceConsumerArtifactSources(value);
    if (sources === null) return invalid(false);
    const contractValid =
      hasExactReviewedBalanceConsumerArtifactBytes(sources) &&
      hasDormantBalanceConsumerSourceContract(sources) &&
      hasExactMainnetBalanceIndexerRouterContract(sources) &&
      hasAuthenticatedBalanceSyncFailureContract(sources) &&
      hasExactBalanceAdapterDependencyContract(sources) &&
      hasDormantProviderNeutralBalanceRpcContract(sources) &&
      hasDormantNodeHttpsBalanceRpcTransportContract(sources) &&
      hasExactBalanceSyncExecutionCancellationContract(sources) &&
      hasDormantBalanceConsumerAggregateResourceContract(sources) &&
      hasDormantBalanceConsumerLifecycleCoordinatorContract(sources) &&
      hasDormantBalanceConsumerPersistenceResourceContract(sources) &&
      hasDormantBalanceConsumerSqsReceiptResourceContract(sources) &&
      hasPinnedBalanceConsumerQueueBoundaryContract(sources) &&
      hasExactBalanceConsumerNativeReceiptRedriveContract(sources) &&
      hasDormantBalanceConsumerPackagingContract(sources) &&
      hasUncomposedBalanceConsumerParentContract(sources) &&
      hasIsolatedBalanceConsumerWorkloadContract(sources) &&
      hasExactStandaloneBalanceConsumerEnvelopeContract(sources) &&
      hasExactBalanceConsumerEnvelopeValidatorContract(sources) &&
      hasExactBalanceConsumerMetadataTransitionValidatorContract(sources) &&
      hasDormantBalanceConsumerDatabaseCapability(sources);
    if (!contractValid) return invalid(true);
    const result: BalanceConsumerDeploymentInput = Object.freeze({
      inspected: true,
      contractValid: true,
      sourceActivation: 'DISABLED',
      runtimeComposition: 'NOT_COMPOSED',
      taskDeployment: 'NOT_PROVISIONED',
      iamCapability: 'NOT_PROVISIONED',
      databaseCapability: 'DORMANT_SOURCE_ONLY',
      deploymentEvidence: 'MISSING',
    });
    VERIFIED_BALANCE_CONSUMER_DEPLOYMENTS.add(result);
    return result;
  } catch {
    return invalid(false);
  }
}

/**
 * Recognizes only the exact source-authored, dormant provider-position read
 * boundary and private composition. Passing this inspection neither
 * instantiates nor registers that graph and does not authorize provider,
 * network, persistence, or financial capabilities.
 */
export function inspectProviderPositionReadBoundaryArtifacts(
  value: unknown,
): ProviderPositionReadBoundaryInput {
  const invalid = (inspected: boolean): ProviderPositionReadBoundaryInput =>
    Object.freeze({
      inspected,
      contractValid: false,
      readerFeatureRegistration: 'INVALID',
      trustedAssessmentFeatureRegistration: 'INVALID',
      deadlineRunnerFeatureRegistration: 'INVALID',
    });
  try {
    const sources = snapshotProviderPositionReadBoundaryArtifactSources(value);
    if (sources === null) return invalid(false);
    const contractValid =
      hasExactReviewedProviderPositionReadArtifactBytes(sources) &&
      hasDormantProviderPositionReadBoundaryContract(sources);
    if (!contractValid) return invalid(true);
    const result: ProviderPositionReadBoundaryInput = Object.freeze({
      inspected: true,
      contractValid: true,
      readerFeatureRegistration: 'MISSING',
      trustedAssessmentFeatureRegistration: 'MISSING',
      deadlineRunnerFeatureRegistration: 'MISSING',
    });
    VERIFIED_PROVIDER_POSITION_READ_BOUNDARIES.add(result);
    return result;
  } catch {
    return invalid(false);
  }
}

function hasExactAuthWalletSecretVersionParameter(source: string): boolean {
  return hasExactTopLevelParameter(source, 'AuthWalletKeysSecretVersionId', [
    'Type: String',
    'MinLength: 32',
    'MaxLength: 64',
    "AllowedPattern: '^[A-Za-z0-9_-]{32,64}$'",
  ]);
}

function hasExactRedisOperatorSecretVersionParameter(source: string): boolean {
  return hasExactTopLevelParameter(source, 'RedisOperatorSecretVersionId', [
    'Type: String',
    "AllowedPattern: '^(UNPINNED|[A-Za-z0-9_-]{32,64})$'",
  ]);
}

function semanticYamlLines(source: string | null): readonly string[] {
  if (source === null) return [];
  return source
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#'));
}

function hasExactlyOneSemanticLineContaining(source: string, fragment: string): boolean {
  return semanticYamlLines(source).filter((line) => line.includes(fragment)).length === 1;
}

function hasExactNestedParameterPropagation(
  source: string,
  stackName: 'WorkloadBoundaries' | 'Observability',
): boolean {
  const stack = yamlBlock(source, stackName, 1);
  const parameters = stack === null ? null : yamlBlock(stack, 'Parameters', 3);
  return hasExactYamlScalarProperty(
    parameters,
    'RedisOperatorSecretVersionId',
    '!Ref RedisOperatorSecretVersionId',
  );
}

export function inspectDatabaseMasterDeploymentTemplate(
  source: string,
): DatabaseMasterDeploymentInput {
  const resources = yamlBlock(source, 'Resources', 0);
  const applicationDataKey =
    resources === null ? null : yamlBlock(resources, 'ApplicationDataKey', 1);
  const database = resources === null ? null : yamlBlock(resources, 'Database', 1);
  const databaseProperties = database === null ? null : yamlBlock(database, 'Properties', 2);
  const masterUserSecret =
    databaseProperties === null ? null : yamlBlock(databaseProperties, 'MasterUserSecret', 3);
  const outputs = yamlBlock(source, 'Outputs', 0);
  const compatibilityOutput =
    outputs === null ? null : yamlBlock(outputs, 'DatabaseCredentialsSecretArn', 1);
  const inspected =
    resources !== null &&
    applicationDataKey !== null &&
    database !== null &&
    databaseProperties !== null &&
    outputs !== null &&
    compatibilityOutput !== null;
  const exactMasterUserSecret =
    semanticYamlLines(masterUserSecret)
      .map((line) => line.trim())
      .join('\n') === ['MasterUserSecret:', 'KmsKeyId: !GetAtt ApplicationDataKey.Arn'].join('\n');
  const exactCompatibilityOutput =
    semanticYamlLines(compatibilityOutput)
      .map((line) => line.trim())
      .join('\n') ===
    ['DatabaseCredentialsSecretArn:', 'Value: !GetAtt Database.MasterUserSecret.SecretArn'].join(
      '\n',
    );
  const customDatabaseSecretAbsent =
    resources !== null && !/^\s*["']?DatabaseCredentialsSecret["']?\s*:/mu.test(resources);
  const masterPasswordAbsent =
    database !== null && !/^\s*["']?MasterUserPassword["']?\s*:/mu.test(database);
  const reviewedSource =
    createHash('sha256').update(source, 'utf8').digest('hex') ===
    REVIEWED_DATABASE_MASTER_TEMPLATE_SHA256;

  const result: DatabaseMasterDeploymentInput = Object.freeze({
    inspected,
    syntaxValid:
      inspected &&
      reviewedSource &&
      hasExactYamlScalarProperty(applicationDataKey, 'Type', 'AWS::KMS::Key') &&
      hasExactYamlScalarProperty(database, 'Type', 'AWS::RDS::DBInstance') &&
      hasExactYamlScalarProperty(databaseProperties, 'MasterUsername', 'crypto_admin') &&
      hasExactYamlScalarProperty(databaseProperties, 'ManageMasterUserPassword', 'true') &&
      exactMasterUserSecret &&
      masterPasswordAbsent &&
      customDatabaseSecretAbsent &&
      exactCompatibilityOutput,
  });
  if (result.inspected && result.syntaxValid) {
    VERIFIED_DATABASE_MASTER_DEPLOYMENTS.add(result);
  }
  return result;
}

export function inspectRedisOperatorDeploymentTemplates(
  parentSource: string,
  workloadSource: string,
  observabilitySource: string,
): RedisOperatorDeploymentInput {
  const versionParameters = [
    'ApiDatabaseSlotAVersionId',
    'ApiDatabaseSlotBVersionId',
    'WorkerDatabaseSlotAVersionId',
    'WorkerDatabaseSlotBVersionId',
    'RedisApiSlotAVersionId',
    'RedisApiSlotBVersionId',
    'RedisOperatorSecretVersionId',
  ] as const;
  const parentRule = yamlBlock(parentSource, 'FixedSlotVersionsRequireSafeState', 1);
  const parentRuleLines = semanticYamlLines(parentRule);
  const parentUnpinnedVersions = `!And [${versionParameters
    .map((name) => `!Equals [!Ref ${name}, UNPINNED]`)
    .join(', ')}]`;
  const parentPinnedVersions = `!And [${versionParameters
    .map((name) => `!Not [!Equals [!Ref ${name}, UNPINNED]]`)
    .join(', ')}]`;
  const exactParentRule = [
    ' FixedSlotVersionsRequireSafeState:',
    '  Assertions:',
    '   - Assert: !Or',
    `      - !And [${parentUnpinnedVersions}, !And [!Equals [!Ref ApiDesiredCount, 0], !Equals [!Ref WebDesiredCount, 0], !Equals [!Ref WorkerDesiredCount, 0]], !And [!Equals [!Ref ApiDatabaseCredentialPhase, A_ONLY], !Equals [!Ref WorkerDatabaseCredentialPhase, A_ONLY], !Equals [!Ref RedisCredentialPhase, A_ONLY], !Equals [!Ref RedisOperatorMode, DISABLED]]]`,
    `      - ${parentPinnedVersions}`,
    '     AssertDescription: Credential versions must be all pinned or an inert A_ONLY adoption sentinel.',
  ];
  const parentUnpinnedGate = parentRuleLines.join('\n') === exactParentRule.join('\n');

  const workloadRule = yamlBlock(workloadSource, 'FixedSlotVersionsRequireSafeState', 2);
  const exactWorkloadRule = [
    '  FixedSlotVersionsRequireSafeState:',
    '    Assertions:',
    '      - Assert: !Or',
    '          - !And [',
    '              !And [',
    ...versionParameters.map((name) => `                !Equals [!Ref ${name}, UNPINNED],`),
    '              ],',
    '              !And [',
    '                !Equals [!Ref ApiDatabaseCredentialPhase, A_ONLY],',
    '                !Equals [!Ref WorkerDatabaseCredentialPhase, A_ONLY],',
    '                !Equals [!Ref RedisCredentialPhase, A_ONLY],',
    '                !Equals [!Ref RedisOperatorMode, DISABLED],',
    '              ],',
    '            ]',
    '          - !And [',
    ...versionParameters.map((name) => `              !Not [!Equals [!Ref ${name}, UNPINNED]],`),
    '            ]',
    '        AssertDescription: Fixed-slot and operator versions must be all pinned or an inert A_ONLY adoption sentinel.',
  ];
  const workloadUnpinnedGate =
    semanticYamlLines(workloadRule).join('\n') === exactWorkloadRule.join('\n');
  const workloadUser = yamlBlock(workloadSource, 'RedisOperatorUser', 2);
  const exactWorkloadAccess = [
    '      AccessString: !If',
    '        - RedisOperatorEnabled',
    "        - 'on sanitize-payload resetkeys resetchannels -@all +client|kill'",
    "        - 'off sanitize-payload resetkeys resetchannels -@all +client|kill'",
  ];
  const exactWorkloadAuthentication = [
    '      AuthenticationMode: !If',
    '        - CredentialVersionsPinned',
    '        - {',
    '            Passwords:',
    '              [',
    "                !Sub '{{resolve:secretsmanager:${RedisOperatorSecret}:SecretString:password::${RedisOperatorSecretVersionId}}',",
    '              ],',
    '            Type: password,',
    '          }',
    '        - { Type: no-password-required }',
  ];
  const workloadSelectorValid =
    semanticYamlLines(workloadUser).join('\n').includes(exactWorkloadAccess.join('\n')) &&
    semanticYamlLines(workloadUser).join('\n').includes(exactWorkloadAuthentication.join('\n')) &&
    hasExactlyOneSemanticLineContaining(
      workloadSource,
      '${RedisOperatorSecret}:SecretString:password',
    ) &&
    hasExactYamlScalarProperty(
      workloadSource,
      'CredentialVersionsPinned',
      '!Not [!Equals [!Ref ApiDatabaseSlotAVersionId, UNPINNED]]',
    ) &&
    hasExactYamlScalarProperty(
      workloadSource,
      'RedisOperatorEnabled',
      '!Equals [!Ref RedisOperatorMode, ENABLED]',
    ) &&
    !workloadSource.includes('${RedisOperatorSecret}:SecretString:password:AWSCURRENT:') &&
    !workloadSource.includes('${RedisOperatorSecret}:SecretString:password:AWSPREVIOUS:');

  const observabilityRule = yamlBlock(observabilitySource, 'RedisOperatorRequiresBoundIdentity', 2);
  const observabilityRuleLines = semanticYamlLines(observabilityRule);
  const exactObservabilityEnabledRule = [
    '  RedisOperatorRequiresBoundIdentity:',
    '    Assertions:',
    '      - Assert: !Or',
    '          - !Equals [!Ref RedisOperatorMode, DISABLED]',
    '          - !And',
    '            - !Not [!Equals [!Ref RedisOperatorTaskExecutionRoleArn, NONE]]',
    '            - !Not [!Equals [!Ref RedisOperatorSecretArn, NONE]]',
    '            - !Not [!Equals [!Ref RedisOperatorSecretVersionId, UNPINNED]]',
    '        AssertDescription: Redis operator mode requires its exact execution role, secret, and secret version.',
  ];
  const observabilityEnabledGate =
    observabilityRuleLines.join('\n') === exactObservabilityEnabledRule.join('\n');
  const observabilityTask = yamlBlock(
    observabilitySource,
    'RedisSessionRevocationTaskDefinition',
    2,
  );
  const observabilitySelectorValid =
    observabilityTask !== null &&
    hasExactYamlScalarProperty(observabilityTask, 'Condition', 'RedisOperatorEnabled') &&
    hasExactYamlScalarProperty(
      observabilityTask,
      'ValueFrom',
      "!Sub '${RedisOperatorSecretArn}:password::${RedisOperatorSecretVersionId}'",
    ) &&
    hasExactlyOneSemanticLineContaining(
      observabilitySource,
      '${RedisOperatorSecretArn}:password',
    ) &&
    !observabilitySource.includes('${RedisOperatorSecretArn}:password:AWSCURRENT:') &&
    !observabilitySource.includes('${RedisOperatorSecretArn}:password:AWSPREVIOUS:');

  const inspected =
    yamlBlock(parentSource, 'Parameters', 0) !== null &&
    yamlBlock(workloadSource, 'Parameters', 0) !== null &&
    yamlBlock(observabilitySource, 'Parameters', 0) !== null &&
    workloadUser !== null &&
    observabilityTask !== null;
  const syntaxValid =
    inspected &&
    hasExactRedisOperatorSecretVersionParameter(parentSource) &&
    hasExactRedisOperatorSecretVersionParameter(workloadSource) &&
    hasExactRedisOperatorSecretVersionParameter(observabilitySource) &&
    hasExactNestedParameterPropagation(parentSource, 'WorkloadBoundaries') &&
    hasExactNestedParameterPropagation(parentSource, 'Observability') &&
    parentUnpinnedGate &&
    workloadUnpinnedGate &&
    workloadSelectorValid &&
    observabilityEnabledGate &&
    observabilitySelectorValid;

  return Object.freeze({ inspected, syntaxValid });
}

interface YamlBindingInspection {
  readonly names: ReadonlySet<string>;
  readonly valid: boolean;
}

const EXPECTED_API_ENVIRONMENT_BINDINGS: ReadonlyMap<string, string> = new Map([
  ...REQUIRED_API_PRODUCTION_ENVIRONMENT_BINDINGS,
  ...REQUIRED_API_AUTH_ENVIRONMENT_BINDINGS,
  ...REQUIRED_WALLET_ENVIRONMENT_BINDINGS,
]);
const EXPECTED_API_SECRET_BINDINGS: ReadonlyMap<string, string> = new Map([
  ...REQUIRED_API_AUTH_SECRET_BINDINGS,
  ...REQUIRED_WALLET_SECRET_BINDINGS,
]);
const EXPECTED_WEB_ENVIRONMENT_BINDINGS: ReadonlyMap<string, string> = new Map([
  ...REQUIRED_WEB_PRODUCTION_ENVIRONMENT_BINDINGS,
  ...REQUIRED_WEB_AUTH_ENVIRONMENT_BINDINGS,
]);

function validYamlBindingValue(value: string): boolean {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes('#') ||
    /^(?:null|~|!!null(?:\s.*)?)$/iu.test(trimmed) ||
    /(?:^|\s)!If(?:\s|$)|\bFn::If\b|\bAWS::NoValue\b/u.test(trimmed) ||
    /^[|>{[*&]/u.test(trimmed)
  ) {
    return false;
  }
  const singleQuoted = trimmed.match(/^'([^']*)'$/u);
  if (singleQuoted) return (singleQuoted[1] ?? '').trim().length > 0;
  const doubleQuoted = trimmed.match(/^"([^"]*)"$/u);
  if (doubleQuoted) return (doubleQuoted[1] ?? '').trim().length > 0;
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) return false;
  return /^[\x20-\x7e]+$/u.test(trimmed);
}

function inspectYamlBindings(
  source: string | null,
  valueKey: 'Value' | 'ValueFrom',
  expectedBindings: ReadonlyMap<string, string>,
  managedName: (name: string) => boolean,
): YamlBindingInspection {
  if (source === null) return { names: new Set(), valid: false };
  const names = new Set<string>();
  const seenNames = new Set<string>();
  const lines = source.replace(/\r\n/gu, '\n').split('\n');
  let valid = true;
  for (let index = 1; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const inline = trimmed.match(
      /^-\s*\{\s*Name:\s*([A-Z][A-Z0-9_]*),\s*(Value|ValueFrom):\s*(.+)\s*\}\s*$/u,
    );
    if (inline) {
      const [, name, observedKey, rawValue] = inline;
      if (
        name === undefined ||
        observedKey !== valueKey ||
        rawValue === undefined ||
        !validYamlBindingValue(rawValue)
      ) {
        valid = false;
      } else if (seenNames.has(name)) {
        valid = false;
      } else if (
        FORBIDDEN_LEGACY_AUTH_WALLET_BINDINGS.has(name) ||
        (managedName(name) && !expectedBindings.has(name))
      ) {
        seenNames.add(name);
        valid = false;
      } else {
        seenNames.add(name);
        if (!expectedBindings.has(name) || rawValue.trim() === expectedBindings.get(name)) {
          names.add(name);
        }
      }
      continue;
    }
    const nameMatch = trimmed.match(/^-\s+Name:\s*([A-Z][A-Z0-9_]*)\s*$/u);
    if (!nameMatch) {
      // This intentionally supports only the two closed entry forms above.
      valid = false;
      continue;
    }
    const name = nameMatch[1];
    const nextLine = lines[index + 1] ?? '';
    const nextTrimmed = nextLine.trim();
    const valueMatch = nextTrimmed.match(/^(Value|ValueFrom):\s*(.*)$/u);
    if (
      name === undefined ||
      valueMatch?.[1] !== valueKey ||
      valueMatch[2] === undefined ||
      !validYamlBindingValue(valueMatch[2]) ||
      leadingSpaces(nextLine) <= leadingSpaces(rawLine) ||
      seenNames.has(name)
    ) {
      valid = false;
    } else if (
      FORBIDDEN_LEGACY_AUTH_WALLET_BINDINGS.has(name) ||
      (managedName(name) && !expectedBindings.has(name))
    ) {
      seenNames.add(name);
      valid = false;
      index += 1;
    } else {
      seenNames.add(name);
      if (!expectedBindings.has(name) || valueMatch[2].trim() === expectedBindings.get(name)) {
        names.add(name);
      }
      index += 1;
    }
  }
  return { names, valid };
}

export function inspectAuthenticationDeploymentTemplate(
  source: string,
): AuthenticationDeploymentInput {
  const compactResources = yamlBlock(source, 'ApiTaskDefinition', 1) !== null;
  const resourceIndent = compactResources ? 1 : 2;
  const propertiesIndent = compactResources ? 3 : 6;
  const itemIndent = compactResources ? 4 : 8;
  const containerPropertyIndent = compactResources ? 6 : 10;
  const apiTask = yamlBlock(source, 'ApiTaskDefinition', resourceIndent);
  const webTask = yamlBlock(source, 'WebTaskDefinition', resourceIndent);
  const workerTask = yamlBlock(source, 'WorkerTaskDefinition', resourceIndent);
  const apiContainers =
    apiTask === null ? null : yamlBlock(apiTask, 'ContainerDefinitions', propertiesIndent);
  const webContainers =
    webTask === null ? null : yamlBlock(webTask, 'ContainerDefinitions', propertiesIndent);
  const workerContainers =
    workerTask === null ? null : yamlBlock(workerTask, 'ContainerDefinitions', propertiesIndent);
  const apiContainer =
    apiContainers === null ? null : yamlNamedSequenceEntryBlock(apiContainers, 'api', itemIndent);
  const webContainer =
    webContainers === null ? null : yamlNamedSequenceEntryBlock(webContainers, 'web', itemIndent);
  const workerContainer =
    workerContainers === null
      ? null
      : yamlNamedSequenceEntryBlock(workerContainers, 'outbox-worker', itemIndent);
  const apiEnvironment =
    apiContainer === null ? null : yamlBlock(apiContainer, 'Environment', containerPropertyIndent);
  const apiSecrets =
    apiContainer === null ? null : yamlBlock(apiContainer, 'Secrets', containerPropertyIndent);
  const webEnvironment =
    webContainer === null ? null : yamlBlock(webContainer, 'Environment', containerPropertyIndent);
  const webSecrets =
    webContainer === null ? null : yamlBlock(webContainer, 'Secrets', containerPropertyIndent);
  const apiEnvironmentInspection = inspectYamlBindings(
    apiEnvironment,
    'Value',
    EXPECTED_API_ENVIRONMENT_BINDINGS,
    (name) => PRODUCTION_AUTH_WALLET_BINDING_NAME.test(name),
  );
  const apiSecretInspection = inspectYamlBindings(
    apiSecrets,
    'ValueFrom',
    EXPECTED_API_SECRET_BINDINGS,
    (name) => PRODUCTION_AUTH_WALLET_BINDING_NAME.test(name),
  );
  const webEnvironmentInspection = inspectYamlBindings(
    webEnvironment,
    'Value',
    EXPECTED_WEB_ENVIRONMENT_BINDINGS,
    (name) => PRODUCTION_AUTH_WALLET_BINDING_NAME.test(name),
  );
  const productionArtifactContractRequired =
    workerTask !== null ||
    /(?:^|\n)\s+ApiImageUri:\s*(?:\n|$)/u.test(source) ||
    /(?:^|\n)\s+ApplicationVersion:\s*(?:\n|$)/u.test(source);
  const artifactBindingsValid =
    !productionArtifactContractRequired ||
    (workerTask !== null &&
      workerContainers !== null &&
      workerContainer !== null &&
      hasExactImmutableImageParameter(source, 'ApiImageUri', 'crypto-lending-api') &&
      hasExactImmutableImageParameter(source, 'WebImageUri', 'crypto-lending-web') &&
      hasExactYamlScalarProperty(apiContainer, 'Image', '!Ref ApiImageUri') &&
      hasExactYamlScalarProperty(webContainer, 'Image', '!Ref WebImageUri') &&
      hasExactYamlScalarProperty(workerContainer, 'Image', '!Ref ApiImageUri') &&
      !/(?:^|\n)\s+WorkerImageUri:\s*(?:\n|$)/u.test(source) &&
      !source.includes('crypto-lending-worker'));
  return Object.freeze({
    inspected:
      apiTask !== null &&
      webTask !== null &&
      apiContainers !== null &&
      webContainers !== null &&
      apiContainer !== null &&
      webContainer !== null &&
      apiEnvironment !== null &&
      apiSecrets !== null &&
      webEnvironment !== null &&
      (!productionArtifactContractRequired ||
        (workerTask !== null && workerContainers !== null && workerContainer !== null)),
    syntaxValid:
      hasExactAuthWalletSecretVersionParameter(source) &&
      apiEnvironmentInspection.valid &&
      apiSecretInspection.valid &&
      webEnvironmentInspection.valid &&
      webSecrets === null &&
      artifactBindingsValid,
    apiEnvironmentNames: apiEnvironmentInspection.names,
    apiSecretNames: apiSecretInspection.names,
    webEnvironmentNames: webEnvironmentInspection.names,
    // Static wiring is informational. Deployed Cognito behavior requires a separate evidence index.
    deployedEvidenceAccepted: false,
  });
}

function objectRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function allEgressEvidencePassed(record: Record<string, unknown>): boolean {
  const evidence = objectRecord(record.evidence);
  const required = [
    'localPolicyValidation',
    'unlistedDestinationDenied',
    'allowedDestinationReached',
    'providerOutage',
    'dnsFailure',
    'tlsFailure',
    'logsRedacted',
    'killSwitch',
  ];
  return required.every((name) => evidence[name] === 'PASS');
}

export function loadRepositoryProductionPreflightInput(
  repositoryRoot: string,
): ProductionPreflightInput {
  let authentication = inspectAuthenticationDeploymentTemplate('');
  let applicationTemplateSource = '';
  let workloadTemplateSource = '';
  let observabilityTemplateSource = '';
  try {
    applicationTemplateSource = readFileSync(
      resolve(repositoryRoot, 'infra/aws/application-baseline.yaml'),
      'utf8',
    );
    authentication = inspectAuthenticationDeploymentTemplate(applicationTemplateSource);
  } catch {
    // The evaluator reports the failed local inspection with non-secret blocker IDs.
  }
  const databaseMasterDeployment =
    inspectDatabaseMasterDeploymentTemplate(applicationTemplateSource);

  let redisOperatorDeployment = inspectRedisOperatorDeploymentTemplates('', '', '');
  try {
    workloadTemplateSource = readFileSync(
      resolve(repositoryRoot, 'infra/aws/application-workload-boundaries.yaml'),
      'utf8',
    );
    observabilityTemplateSource = readFileSync(
      resolve(repositoryRoot, 'infra/aws/application-observability.yaml'),
      'utf8',
    );
    redisOperatorDeployment = inspectRedisOperatorDeploymentTemplates(
      applicationTemplateSource,
      workloadTemplateSource,
      observabilityTemplateSource,
    );
  } catch {
    // The evaluator reports the failed local inspection without exposing paths or values.
  }

  let productionInfrastructureDeployment = inspectProductionInfrastructureDeploymentArtifacts(null);
  try {
    productionInfrastructureDeployment = inspectProductionInfrastructureDeploymentArtifacts({
      applicationTemplateSource,
      workloadTemplateSource,
      observabilityTemplateSource,
      migrationTemplateSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/database-migration-task.yaml'),
        'utf8',
      ),
      accountGuardrailsTemplateSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/account-guardrails.yaml'),
        'utf8',
      ),
      applicationInvokerSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/invoke-application-baseline.ps1'),
        'utf8',
      ),
      accountGuardrailsInvokerSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/invoke-account-guardrails.ps1'),
        'utf8',
      ),
      applicationValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/validate-application-baseline.mjs'),
        'utf8',
      ),
      fixedSlotTransitionValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/validate-fixed-slot-credential-transition.mjs'),
        'utf8',
      ),
      billingControlValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/validate-billing-control-record.mjs'),
        'utf8',
      ),
      egressPolicyValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/egress/validate-egress-policy.mjs'),
        'utf8',
      ),
      authWalletTransitionValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/validate-auth-wallet-secret-version-transition.mjs'),
        'utf8',
      ),
      redisOperatorTransitionValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/validate-redis-operator-secret-version-transition.mjs'),
        'utf8',
      ),
    });
  } catch {
    // The evaluator reports an inspection failure without exposing local paths or source bytes.
  }

  let balanceConsumerDeployment = inspectBalanceConsumerDeploymentArtifacts(null);
  try {
    balanceConsumerDeployment = inspectBalanceConsumerDeploymentArtifacts({
      activationSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/balance-sync-consumer.activation.ts',
        ),
        'utf8',
      ),
      cliSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli.ts',
        ),
        'utf8',
      ),
      cliModeSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli-mode.ts',
        ),
        'utf8',
      ),
      runtimeSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/balance-sync-consumer.runtime.ts',
        ),
        'utf8',
      ),
      compositionSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/balance-sync-consumer.composition.ts',
        ),
        'utf8',
      ),
      balanceSyncConsumerServiceSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/balance-sync-consumer.service.ts',
        ),
        'utf8',
      ),
      balanceSyncPortsSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/ports/balance-sync.ports.ts',
        ),
        'utf8',
      ),
      balanceConsumerResourceSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/balance-sync-consumer.resource.ts',
        ),
        'utf8',
      ),
      balanceConsumerLifecycleSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/balance-sync-consumer.lifecycle.ts',
        ),
        'utf8',
      ),
      mainnetBalanceIndexerRouterSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/mainnet-balance-indexer.router.ts',
        ),
        'utf8',
      ),
      mainnetBalanceTwoSourceAgreementCoordinatorSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/mainnet-balance-two-source-agreement.coordinator.ts',
        ),
        'utf8',
      ),
      balanceJsonRpcSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/infrastructure/rpc/balance-json-rpc.ts',
        ),
        'utf8',
      ),
      nodeHttpsBalanceJsonRpcTransportSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport.ts',
        ),
        'utf8',
      ),
      ethereumBalanceIndexerSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/infrastructure/rpc/ethereum-mainnet-balance-indexer.adapter.ts',
        ),
        'utf8',
      ),
      solanaBalanceIndexerSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/infrastructure/rpc/solana-mainnet-balance-indexer.adapter.ts',
        ),
        'utf8',
      ),
      supportedAssetRegistrySource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/blockchain/domain/supported-asset-registry.ts'),
        'utf8',
      ),
      walletIdentitySource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/wallets/domain/wallet-identity.ts'),
        'utf8',
      ),
      solanaTokenAccountSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/blockchain/domain/solana-token-account.ts'),
        'utf8',
      ),
      balanceConsumerPersistenceResourceSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/infrastructure/postgres/balance-consumer-persistence.resource.ts',
        ),
        'utf8',
      ),
      balanceConsumerSqsReceiptResourceSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/infrastructure/sqs/balance-consumer-sqs-receipt.resource.ts',
        ),
        'utf8',
      ),
      runtimePostgresPoolSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/database/runtime-postgres-pool.ts'),
        'utf8',
      ),
      postgresServiceSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/database/postgres.service.ts'),
        'utf8',
      ),
      balanceSyncCheckpointRepositorySource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/infrastructure/postgres/postgres-balance-sync-checkpoint.repository.ts',
        ),
        'utf8',
      ),
      balanceSyncWalletAddressResolverSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/infrastructure/postgres/postgres-balance-sync-wallet-address.resolver.ts',
        ),
        'utf8',
      ),
      balanceConsumerConfigSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/infrastructure/config/balance-consumer.config.ts',
        ),
        'utf8',
      ),
      blockchainSyncIndexSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/blockchain-sync/index.ts'),
        'utf8',
      ),
      jobEnvelopeSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/outbox/job-envelope.ts'),
        'utf8',
      ),
      blockchainSyncModuleSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/blockchain-sync/blockchain-sync.module.ts'),
        'utf8',
      ),
      appModuleSource: readFileSync(resolve(repositoryRoot, 'apps/api/src/app.module.ts'), 'utf8'),
      applicationRootSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/application-root.ts'),
        'utf8',
      ),
      localDevelopmentAppModuleSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/local-development-app.module.ts'),
        'utf8',
      ),
      mainSource: readFileSync(resolve(repositoryRoot, 'apps/api/src/main.ts'), 'utf8'),
      outboxWorkerCliSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/outbox/outbox-worker.cli.ts'),
        'utf8',
      ),
      redisSessionRevocationCliSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/infrastructure/redis/redis-session-revocation.cli.ts',
        ),
        'utf8',
      ),
      migrationCliSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/database/migration.cli.ts'),
        'utf8',
      ),
      balanceSyncOrchestratorSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/balance-sync-orchestrator.ts',
        ),
        'utf8',
      ),
      balanceSyncDomainSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/blockchain-sync/domain/balance-sync.ts'),
        'utf8',
      ),
      chainObservationPolicySource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/blockchain/domain/chain-observation-policy.ts'),
        'utf8',
      ),
      failClosedJobDispositionSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/blockchain-sync/application/fail-closed-balance-sync-job.port.ts',
        ),
        'utf8',
      ),
      reviewedJobDispatcherSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/sqs/reviewed-job-dispatcher.ts'),
        'utf8',
      ),
      infrastructureConfigSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/config/infrastructure.config.ts'),
        'utf8',
      ),
      pinnedQueueReceiptSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/sqs/sqs-queue-receipt.port.ts'),
        'utf8',
      ),
      sqsJobWorkerSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/sqs/sqs-job.worker.ts'),
        'utf8',
      ),
      observabilitySource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/observability/observability.ts'),
        'utf8',
      ),
      sqsServiceSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/sqs/sqs.service.ts'),
        'utf8',
      ),
      sqsModuleSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/sqs/sqs.module.ts'),
        'utf8',
      ),
      sqsTokensSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/sqs/sqs.tokens.ts'),
        'utf8',
      ),
      apiPackageSource: readFileSync(resolve(repositoryRoot, 'apps/api/package.json'), 'utf8'),
      rootPackageSource: readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
      rootPackageLockSource: readFileSync(resolve(repositoryRoot, 'package-lock.json'), 'utf8'),
      applicationTemplateSource,
      applicationValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/validate-application-baseline.mjs'),
        'utf8',
      ),
      workloadTemplateSource,
      workloadValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/validate-application-workload-boundaries.mjs'),
        'utf8',
      ),
      balanceConsumerEnvelopeSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/balance-consumer-deployment-envelope.yaml'),
        'utf8',
      ),
      balanceConsumerEnvelopeValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/aws/validate-balance-consumer-deployment-envelope.mjs'),
        'utf8',
      ),
      balanceConsumerMetadataTransitionValidatorSource: readFileSync(
        resolve(
          repositoryRoot,
          'infra/aws/validate-balance-consumer-metadata-secret-version-transition.mjs',
        ),
        'utf8',
      ),
      bootstrapPrincipalsSource: readFileSync(
        resolve(repositoryRoot, 'infra/postgres/bootstrap-principals.sql'),
        'utf8',
      ),
      bootstrapPrincipalsValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/postgres/validate-bootstrap-principals.mjs'),
        'utf8',
      ),
      walletAddressMigrationSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/infrastructure/database/migrations/0023-create-balance-consumer-wallet-address-boundary.migration.ts',
        ),
        'utf8',
      ),
      workerAuthoritySuspensionMigrationSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/infrastructure/database/migrations/0028-suspend-generic-worker-balance-authority.migration.ts',
        ),
        'utf8',
      ),
      migrationIndexSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/database/migrations/index.ts'),
        'utf8',
      ),
      releaseManifestSource: readFileSync(
        resolve(repositoryRoot, 'scripts/release-candidate-manifest.mjs'),
        'utf8',
      ),
      productionContainerValidatorSource: readFileSync(
        resolve(repositoryRoot, 'infra/containers/validate-production-containers.mjs'),
        'utf8',
      ),
    });
  } catch {
    // The evaluator reports an inspection failure without exposing local paths or source bytes.
  }

  let providerPositionReadBoundary = inspectProviderPositionReadBoundaryArtifacts(null);
  try {
    providerPositionReadBoundary = inspectProviderPositionReadBoundaryArtifacts({
      providerPositionReaderPortSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/application/ports/mainnet-provider-position-reader.port.ts',
        ),
        'utf8',
      ),
      providerPositionTrustedAssemblyPortSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/application/ports/provider-position-trusted-chain-assessment-assembly.port.ts',
        ),
        'utf8',
      ),
      providerPositionAdmissionCoordinatorSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/application/provider-position-admission.coordinator.ts',
        ),
        'utf8',
      ),
      providerPositionDeadlineRunnerSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/infrastructure/node-provider-position-admission-deadline.runner.ts',
        ),
        'utf8',
      ),
      providerPositionRuntimeBoundsSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/infrastructure/provider-position-admission-runtime-bounds.ts',
        ),
        'utf8',
      ),
      providerPositionRuntimeCompositionSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/infrastructure/provider-position-admission-runtime.composition.ts',
        ),
        'utf8',
      ),
      providerPositionInfrastructureConfigSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/config/infrastructure.config.ts'),
        'utf8',
      ),
      providerPositionRuntimePostgresPoolSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/database/runtime-postgres-pool.ts'),
        'utf8',
      ),
      portfolioWalletRegistrationReaderPortSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/portfolio/application/ports/portfolio-wallet-registration-reader.port.ts',
        ),
        'utf8',
      ),
      registeredPortfolioWalletReaderSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/portfolio/infrastructure/registered-portfolio-wallet-reader.ts',
        ),
        'utf8',
      ),
      walletRegistrationServiceSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/wallets/application/wallet-registration.service.ts',
        ),
        'utf8',
      ),
      walletRegistrationRepositoryPortSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/wallets/application/ports/wallet-registration-repository.port.ts',
        ),
        'utf8',
      ),
      postgresWalletRegistrationRepositorySource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/wallets/infrastructure/postgres/postgres-wallet-registration.repository.ts',
        ),
        'utf8',
      ),
      providerPositionPostgresServiceSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/infrastructure/database/postgres.service.ts'),
        'utf8',
      ),
      providerPositionCoverageSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/domain/mainnet-provider-position-coverage.ts',
        ),
        'utf8',
      ),
      providerPositionObservationSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/domain/mainnet-provider-position-observation.ts',
        ),
        'utf8',
      ),
      providerPositionChainAssessmentSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/domain/mainnet-provider-position-chain-assessment.ts',
        ),
        'utf8',
      ),
      providerPositionObservationPolicySource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/domain/mainnet-provider-position-observation-policy.ts',
        ),
        'utf8',
      ),
      mainnetPlatformsModuleSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/mainnet-platforms/mainnet-platforms.module.ts'),
        'utf8',
      ),
      mainnetPlatformsIndexSource: readFileSync(
        resolve(repositoryRoot, 'apps/api/src/mainnet-platforms/index.ts'),
        'utf8',
      ),
      mainnetPlatformsControllerSource: readFileSync(
        resolve(
          repositoryRoot,
          'apps/api/src/mainnet-platforms/http/mainnet-platforms.controller.ts',
        ),
        'utf8',
      ),
    });
  } catch {
    // The evaluator reports an inspection failure without exposing local paths or source bytes.
  }

  let egressRecord: Record<string, unknown> = {};
  let egressLocalValidationPassed = false;
  try {
    egressRecord = objectRecord(
      egressPolicy.loadEgressPolicyFile(
        resolve(repositoryRoot, 'infra/egress/egress-policy.example.json'),
      ) as unknown,
    );
    const validation = egressPolicy.validateEgressPolicy(egressRecord, { mode: 'example' });
    egressLocalValidationPassed = validation.ok === true;
  } catch {
    // The evaluator emits a closed local-validation blocker.
  }

  let providerRecord: Record<string, unknown> = {};
  let providerLocalValidationPassed = false;
  try {
    const validation = loadValidatedProviderDecisionSnapshot({ repositoryRoot });
    providerLocalValidationPassed = validation.errors.length === 0;
    providerRecord = objectRecord(validation.record);
  } catch {
    // The evaluator emits a closed local-validation blocker.
  }
  let dormantProviderInventoryValidationPassed = false;
  try {
    const errors = validateDormantProviderInventoryFiles(repositoryRoot) as unknown;
    dormantProviderInventoryValidationPassed = Array.isArray(errors) && errors.length === 0;
  } catch {
    // The evaluator emits a distinct closed inventory-validation blocker.
  }
  let activeScopeProviderResearchCaptureValidationPassed = false;
  try {
    const validation = activeScopeProviderResearchCapture.validateProviderResearchCaptureFiles(
      repositoryRoot,
    ) as unknown;
    const validationRecord = objectRecord(validation);
    const errors = validationRecord.errors;
    activeScopeProviderResearchCaptureValidationPassed =
      Array.isArray(errors) &&
      errors.length === 0 &&
      validationRecord.fingerprint === REVIEWED_ACTIVE_SCOPE_PROVIDER_RESEARCH_CAPTURE_SHA256;
  } catch {
    // The evaluator emits a distinct closed research-capture-validation blocker.
  }
  const providerSelection = objectRecord(providerRecord.selection);
  const providerApproval = objectRecord(providerRecord.approvalBoundary);
  const zeroCostEvidence = objectRecord(providerRecord.zeroCostEvidence);

  return Object.freeze({
    authentication,
    productionInfrastructureDeployment,
    balanceConsumerDeployment,
    providerPositionReadBoundary,
    databaseMasterDeployment,
    rdsMasterLifecycleEvidenceAccepted: false,
    redisOperatorDeployment,
    egress: Object.freeze({
      localValidationPassed: egressLocalValidationPassed,
      status: egressRecord.status,
      currentMode: egressRecord.currentMode,
      liveEvidenceComplete: allEgressEvidencePassed(egressRecord),
    }),
    rpcProviders: Object.freeze({
      localValidationPassed: providerLocalValidationPassed,
      dormantInventoryValidationPassed: dormantProviderInventoryValidationPassed,
      activeScopeResearchCaptureValidationPassed:
        activeScopeProviderResearchCaptureValidationPassed,
      externalStatus: providerRecord.externalStatus,
      runtimeStatus: providerSelection.runtimeStatus,
      approvalBoundaryApproved: providerApproval.approved === true,
      liveEvidenceAccepted: zeroCostEvidence.liveEvidenceStatus === 'ACCEPTED',
    }),
    platforms: {
      directory: MAINNET_PLATFORM_DIRECTORY,
      // Bootstrap mode cannot prove a clean worktree without a trusted build manifest.
      sourceRevision: null,
      // Bootstrap mode deliberately does not ingest controlled external evidence.
      liveReadEvidenceIndex: null,
      mainnetWriteEvidenceIndex: null,
    },
    publicLaunchAuthorities: Object.freeze({
      decisionSet: null,
      evidenceBinding: null,
    }),
  });
}

export function applyVerifiedProductionEvidenceBundle(
  input: ProductionPreflightInput,
  bundle: VerifiedProductionEvidenceBundle,
  options: ProductionEvidenceApplicationOptions,
): ProductionPreflightInput {
  try {
    const applicationOptions = Object.freeze({
      releaseManifest: options.releaseManifest,
      repositoryRoot: options.repositoryRoot,
      sourceRevision: options.sourceRevision,
    });
    revalidateProductionEvidenceBundleForApplication(bundle, applicationOptions);
    if (
      !isVerifiedProductionEvidenceBundle(bundle) ||
      bundle.content.directoryConfigurationSha256 !==
        productionDirectoryConfigurationSha256(input.platforms.directory)
    ) {
      throw new ProductionEvidenceBundleInvalidError();
    }
    const evidenceBinding = Object.freeze({
      releaseCandidateManifestSha256: bundle.content.releaseCandidateManifestSha256,
      deploymentTargetId: bundle.content.deploymentTargetId,
      deploymentTargetConfigurationSha256: bundle.content.deploymentTargetSha256,
    });
    const evidenceContext = Object.freeze({ bundle, applicationOptions });
    EVIDENCE_DERIVED_PUBLIC_LAUNCH_BINDINGS.set(evidenceBinding, evidenceContext);

    const appliedInput = Object.freeze({
      ...input,
      rdsMasterLifecycleEvidenceAccepted: true,
      authentication: Object.freeze({
        ...input.authentication,
        deployedEvidenceAccepted: true,
      }),
      egress: Object.freeze({
        ...input.egress,
        liveEvidenceComplete: true,
      }),
      rpcProviders: Object.freeze({
        ...input.rpcProviders,
        liveEvidenceAccepted: true,
      }),
      platforms: Object.freeze({
        directory: input.platforms.directory,
        sourceRevision: bundle.content.sourceRevision,
        liveReadEvidenceIndex: bundle.content.liveReadEvidenceIndex,
        // Evidence schema v2 is read-only and can never supplement write evidence.
        mainnetWriteEvidenceIndex: null,
      }),
      publicLaunchAuthorities: Object.freeze({
        decisionSet: null,
        evidenceBinding,
      }),
    });
    VERIFIED_RDS_MASTER_LIFECYCLE_PREFLIGHT_INPUTS.set(appliedInput, evidenceContext);
    return appliedInput;
  } catch {
    throw new ProductionEvidenceBundleInvalidError();
  }
}

export function applyVerifiedPublicLaunchAuthorityDecision(
  input: ProductionPreflightInput,
  decisionSet: VerifiedPublicLaunchAuthorityDecisionSet,
): ProductionPreflightInput {
  try {
    const evidenceBinding = input.publicLaunchAuthorities?.evidenceBinding;
    const evidenceContext =
      evidenceBinding === null || evidenceBinding === undefined
        ? undefined
        : EVIDENCE_DERIVED_PUBLIC_LAUNCH_BINDINGS.get(evidenceBinding);
    const inputEvidenceContext = VERIFIED_RDS_MASTER_LIFECYCLE_PREFLIGHT_INPUTS.get(input);
    if (
      evidenceBinding === null ||
      evidenceBinding === undefined ||
      evidenceContext === undefined ||
      inputEvidenceContext !== evidenceContext ||
      !isVerifiedProductionEvidenceBundle(evidenceContext.bundle) ||
      !isVerifiedPublicLaunchAuthorityDecisionSet(decisionSet)
    ) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    revalidateProductionEvidenceBundleForApplication(
      evidenceContext.bundle,
      evidenceContext.applicationOptions,
    );
    if (!isVerifiedProductionEvidenceBundle(evidenceContext.bundle)) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    revalidatePublicLaunchAuthorityDecisionForApplication(decisionSet, evidenceBinding);
    if (!isVerifiedPublicLaunchAuthorityDecisionSet(decisionSet)) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    const appliedInput = Object.freeze({
      ...input,
      publicLaunchAuthorities: Object.freeze({ decisionSet, evidenceBinding }),
    });
    VERIFIED_RDS_MASTER_LIFECYCLE_PREFLIGHT_INPUTS.set(appliedInput, evidenceContext);
    return appliedInput;
  } catch {
    throw new PublicLaunchAuthorityDecisionInvalidError();
  }
}

export function formatProductionPreflightReport(report: ProductionPreflightReport): string {
  const lines = [
    `Production preflight target: ${report.selectedTarget}`,
    `Audit mode: ${report.auditMode}`,
    `Selected target readiness: ${report.selectedTargetReadiness}`,
    `Public read-only readiness: ${report.readiness.publicReadOnly}`,
    `Mainnet-write readiness: ${report.readiness.mainnetWrites}`,
    `Providers: ${report.providerCounts.directory} directory entries; ${report.providerCounts.planned} planned; ${report.providerCounts.liveReadEvidenceBound}/${report.providerCounts.minimumTarget} revision-bound live-read evidence; ${report.providerCounts.transactionEvidenceBound}/${report.providerCounts.minimumTarget} revision-bound transaction evidence.`,
  ];
  for (const item of report.checks) {
    lines.push(
      `${item.id}: local validation ${item.localValidation}; launch readiness ${item.launchReadiness}.`,
    );
    for (const blockerId of item.blockerIds) lines.push(`- ${blockerId}`);
  }
  lines.push(
    'Safety: 0 network, DNS, cloud, provider, secret-value, application-configuration environment-value, and write operations. Release-manifest Git checks may copy only the named OS process-launch variables reported in safety metadata.',
    'Assurance: LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL',
  );
  return `${lines.join('\n')}\n`;
}

export interface ProductionPreflightCliOptions {
  readonly json: boolean;
  readonly target: ProductionPreflightTarget;
  readonly evidenceBundlePath: string | null;
  readonly releaseManifestPath: string | null;
  readonly sourceRevision: string | null;
  readonly publicLaunchAuthorityDecisionPath: string | null;
}

export function parseProductionPreflightArguments(
  arguments_: readonly string[],
): ProductionPreflightCliOptions {
  let json = false;
  let target: ProductionPreflightTarget = 'read-only';
  let evidenceBundlePath: string | null = null;
  let releaseManifestPath: string | null = null;
  let sourceRevision: string | null = null;
  let publicLaunchAuthorityDecisionPath: string | null = null;
  let jsonSeen = false;
  let targetSeen = false;
  let evidenceBundleSeen = false;
  let releaseManifestSeen = false;
  let sourceRevisionSeen = false;
  let publicLaunchAuthorityDecisionSeen = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--json') {
      if (jsonSeen) throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
      json = true;
      jsonSeen = true;
      continue;
    }
    if (argument === '--target') {
      const value = arguments_[index + 1];
      if (targetSeen || (value !== 'read-only' && value !== 'mainnet-write')) {
        throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
      }
      target = value;
      targetSeen = true;
      index += 1;
      continue;
    }
    if (argument === '--evidence-bundle') {
      const value = arguments_[index + 1];
      if (
        evidenceBundleSeen ||
        value === undefined ||
        value.length === 0 ||
        value.length > 4_096 ||
        value.trim().length === 0 ||
        value.includes('\u0000') ||
        value.startsWith('--')
      ) {
        throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
      }
      evidenceBundlePath = value;
      evidenceBundleSeen = true;
      index += 1;
      continue;
    }
    if (argument === '--release-manifest') {
      const value = arguments_[index + 1];
      if (
        releaseManifestSeen ||
        value === undefined ||
        value.length === 0 ||
        value.length > 4_096 ||
        value.trim().length === 0 ||
        value.includes('\u0000') ||
        value.startsWith('--')
      ) {
        throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
      }
      releaseManifestPath = value;
      releaseManifestSeen = true;
      index += 1;
      continue;
    }
    if (argument === '--source-revision') {
      const value = arguments_[index + 1];
      if (sourceRevisionSeen || value === undefined || !/^[a-f0-9]{40}$/u.test(value)) {
        throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
      }
      sourceRevision = value;
      sourceRevisionSeen = true;
      index += 1;
      continue;
    }
    if (argument === '--public-launch-authority-decision') {
      const value = arguments_[index + 1];
      if (
        publicLaunchAuthorityDecisionSeen ||
        value === undefined ||
        value.length === 0 ||
        value.length > 4_096 ||
        value.trim().length === 0 ||
        value.includes('\u0000') ||
        value.startsWith('--')
      ) {
        throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
      }
      publicLaunchAuthorityDecisionPath = value;
      publicLaunchAuthorityDecisionSeen = true;
      index += 1;
      continue;
    }
    throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
  }
  const hasCompleteEvidenceInput =
    evidenceBundlePath !== null && releaseManifestPath !== null && sourceRevision !== null;
  const hasAnyEvidenceInput =
    evidenceBundlePath !== null || releaseManifestPath !== null || sourceRevision !== null;
  if (
    hasAnyEvidenceInput !== hasCompleteEvidenceInput ||
    (hasAnyEvidenceInput && target !== 'read-only') ||
    (publicLaunchAuthorityDecisionPath !== null && !hasCompleteEvidenceInput)
  ) {
    throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
  }
  return Object.freeze({
    json,
    target,
    evidenceBundlePath,
    releaseManifestPath,
    sourceRevision,
    publicLaunchAuthorityDecisionPath,
  });
}

export function productionPreflightCliErrorCode(error: unknown): string {
  if (error instanceof ProductionEvidenceBundleInvalidError) return error.code;
  if (error instanceof PublicLaunchAuthorityDecisionInvalidError) return error.code;
  return 'PRODUCTION_PREFLIGHT_ARGUMENT_INVALID';
}

export function productionPreflightExitCode(report: ProductionPreflightReport): 0 | 1 {
  return report.selectedTargetReadiness === 'LOCAL_GATES_CLEAR' ? 0 : 1;
}

function main(): void {
  try {
    const options = parseProductionPreflightArguments(process.argv.slice(2));
    const repositoryRoot = resolve(__dirname, '..');
    let input = loadRepositoryProductionPreflightInput(repositoryRoot);
    if (
      options.evidenceBundlePath !== null &&
      options.releaseManifestPath !== null &&
      options.sourceRevision !== null
    ) {
      let releaseManifest: unknown;
      try {
        releaseManifest = releaseCandidateManifest.loadAndVerifyReleaseManifest(
          repositoryRoot,
          options.releaseManifestPath,
          options.sourceRevision,
        ) as unknown;
      } catch {
        throw new ProductionEvidenceBundleInvalidError();
      }
      const bundle = loadAndVerifyProductionEvidenceBundle(options.evidenceBundlePath, {
        releaseManifest,
      });
      input = applyVerifiedProductionEvidenceBundle(input, bundle, {
        releaseManifest,
        repositoryRoot,
        sourceRevision: options.sourceRevision,
      });
      if (options.publicLaunchAuthorityDecisionPath !== null) {
        const evidenceBinding = input.publicLaunchAuthorities?.evidenceBinding;
        if (evidenceBinding === null || evidenceBinding === undefined) {
          throw new PublicLaunchAuthorityDecisionInvalidError();
        }
        const decisionSet = loadAndVerifyPublicLaunchAuthorityDecision(
          options.publicLaunchAuthorityDecisionPath,
          evidenceBinding,
        );
        input = applyVerifiedPublicLaunchAuthorityDecision(input, decisionSet);
      }
    }
    const report = evaluateProductionPreflight(input, options.target);
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatProductionPreflightReport(report),
    );
    process.exitCode = productionPreflightExitCode(report);
  } catch (error) {
    process.stderr.write(`${productionPreflightCliErrorCode(error)}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
