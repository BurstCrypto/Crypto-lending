import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MAINNET_PLATFORM_DIRECTORY } from '../apps/api/src/mainnet-platforms/domain/mainnet-platform-directory';
// @ts-expect-error The audited local validator is an ESM JavaScript module without declarations.
import * as egressPolicy from '../infra/egress/validate-egress-policy.mjs';
// @ts-expect-error The audited local validator is an ESM JavaScript module without declarations.
import { loadValidatedProviderDecisionSnapshot } from '../infra/providers/validate-kan-62-provider-decision.mjs';
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

export type ProductionPreflightTarget = 'read-only' | 'mainnet-write';
export type ProductionPreflightReadiness = 'BLOCKED' | 'LOCAL_GATES_CLEAR';
export type ProductionPreflightCheckId =
  | 'PRODUCTION_INFRASTRUCTURE'
  | 'BALANCE_CONSUMER'
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
  readonly balanceSyncDomainSource: string;
  readonly chainObservationPolicySource: string;
  readonly failClosedJobDispositionSource: string;
  readonly reviewedJobDispatcherSource: string;
  readonly infrastructureConfigSource: string;
  readonly pinnedQueueReceiptSource: string;
  readonly sqsJobWorkerSource: string;
  readonly sqsServiceSource: string;
  readonly sqsModuleSource: string;
  readonly sqsTokensSource: string;
  readonly apiPackageSource: string;
  readonly rootPackageSource: string;
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

interface EgressInput {
  readonly localValidationPassed: boolean;
  readonly status: unknown;
  readonly currentMode: unknown;
  readonly liveEvidenceComplete: boolean;
}

interface RpcProviderInput {
  readonly localValidationPassed: boolean;
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
const BALANCE_CONSUMER_ARTIFACT_KEYS = Object.freeze([
  'activationSource',
  'cliSource',
  'cliModeSource',
  'runtimeSource',
  'compositionSource',
  'balanceSyncDomainSource',
  'chainObservationPolicySource',
  'failClosedJobDispositionSource',
  'reviewedJobDispatcherSource',
  'infrastructureConfigSource',
  'pinnedQueueReceiptSource',
  'sqsJobWorkerSource',
  'sqsServiceSource',
  'sqsModuleSource',
  'sqsTokensSource',
  'apiPackageSource',
  'rootPackageSource',
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
  runtimeSource: '311d5ed733abc1bc6f3428bcba2acd2f0858dab31f8eaf3259fc99560e6e1d7d',
  compositionSource: 'a898bcebc7ea56cae7b51e71e27107cb76330a98c4659b5bf761fa4a2e988971',
  balanceSyncDomainSource: '67b1cf8449da0e7c60a95a43cc29425ddc7e33b176933901923538e804171921',
  chainObservationPolicySource: 'ef887514b86230d1516e5a8139c94dc2b2dde06c979440bc6eb3f4df90511533',
  failClosedJobDispositionSource:
    '9e85fc07c1c26c9a42138e7aaf9e45f9cf660fc86660bce446e7f401d53ce9ea',
  reviewedJobDispatcherSource: '91a9fcb2b5f8b2ec02bc19d3fbc592d80118731eedb0c0cd544de94f65c8a8e7',
  infrastructureConfigSource: 'ca472922050bb95bd1b7bd94e0810674e7998d90287edc2be0fce1017b9b8898',
  pinnedQueueReceiptSource: '76543f1e4b4c446eb98b85ad52ea934d7e84f8f7fedcd82f6e516a7eb45a8c56',
  sqsJobWorkerSource: 'da2de20e4313bd9e1057b330d61f571ecbcee679e1a7f3ab9d67ca32a70880da',
  sqsServiceSource: '2abb5d6592858be750263200fdd8b17a3ad15e0ee3ad5ca8fe14e36b5ac46d13',
  sqsModuleSource: 'dc958100bd372500a9428c28cc6219a4cb00db61314a63478368d0b0cf95221b',
  sqsTokensSource: REVIEWED_SQS_TOKENS_SOURCE_SHA256,
  apiPackageSource: '28b9f69d1cf3cf1d16ee76ba6a4afd4881df9afb205c010e6512b0c3633c0c9c',
  rootPackageSource: '1a2c762fe9278975a123073be69b7dc332b547e348ecbb71303233da7ebac8fd',
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
    '730b7c27949b4236d2b2c7343d60a30e04a204f753a920af085bd8009457eeb2',
} satisfies Readonly<Record<keyof BalanceConsumerArtifactSources, string>>);
const MAX_BALANCE_CONSUMER_ARTIFACT_BYTES = 256 * 1024;
const MAX_BALANCE_CONSUMER_TOTAL_BYTES = 1024 * 1024;
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
  if (!input.rpcProviders.localValidationPassed) {
    rpcProviderBlockers.push('RPC_PROVIDER_DECISION_LOCAL_VALIDATION_FAILED');
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
      input.rpcProviders.localValidationPassed ? 'PASS' : 'FAIL',
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
    if (bytes > MAX_BALANCE_CONSUMER_ARTIFACT_BYTES) return null;
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
    exactExecutableLineCount(
      sources.runtimeSource,
      'export class DormantBalanceSyncConsumerRuntimeModule {}',
    ) !== 1 ||
    exactExecutableLineCount(
      sources.runtimeSource,
      "() => Promise.reject(new Error('BALANCE_CONSUMER_RUNTIME_NOT_COMPOSED'));",
    ) !== 1 ||
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
      'const balanceQueueReceipt = new PinnedSqsQueueReceiptAdapter(',
    ) === 1 &&
    exactExecutableLineCount(
      sources.compositionSource,
      'dependencies.infrastructureConfig.sqs.balanceQueueUrl,',
    ) === 1 &&
    exactExecutableLineCount(sources.compositionSource, 'balanceQueueReceipt,') === 1 &&
    !/(?:^|\.)sqs\.queueUrl\b/u.test(sources.compositionSource) &&
    !/\bNestFactory\b|@Module\s*\(|createApplicationContext\s*\(|\.listen\s*\(/u.test(
      sources.compositionSource,
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
  const disposition = sources.failClosedJobDispositionSource.replace(/\r\n/gu, '\n');
  const dispatcher = sources.reviewedJobDispatcherSource.replace(/\r\n/gu, '\n');
  const applicationValidator = sources.applicationValidatorSource.replace(/\r\n/gu, '\n');
  const ingressStart = dispatcher.indexOf('export function parseBalanceSyncConsumerJobEnvelope(');
  const ingressEnd = dispatcher.indexOf('function parseHandlers(', ingressStart);
  if (ingressStart < 0 || ingressEnd <= ingressStart) return false;
  const ingress = dispatcher.slice(ingressStart, ingressEnd);
  const worker = sources.sqsJobWorkerSource.replace(/\r\n/gu, '\n');

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
      'assertBalanceConsumerSqsReceiptRedrivePolicy(dependencies.infrastructureConfig.sqs);',
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
    !/infrastructureConfig\.sqs\.(?:maxReceiveCount|retryBaseDelaySeconds|retryMaxDelaySeconds)/u.test(
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
      'throw new BalanceSyncJobDispositionNotApprovedError();',
    ) === 2 &&
    !/(?:node:|@aws-sdk|\bfetch\s*\(|\bsendMessage\s*\(|\bdirectDeadLetter\s*\(|\bsendJob\s*\(|\bpublish(?:Batch)?\s*\()/u.test(
      disposition,
    ) &&
    exactExecutableLineCount(
      worker,
      'const exhausted = message.receiveCount >= this.policy.maxReceiveCount;',
    ) === 1 &&
    exactExecutableLineCount(
      worker,
      'this.policy.retryBaseDelaySeconds * 2 ** (message.receiveCount - 1),',
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
  const providerSelection = objectRecord(providerRecord.selection);
  const providerApproval = objectRecord(providerRecord.approvalBoundary);
  const zeroCostEvidence = objectRecord(providerRecord.zeroCostEvidence);

  return Object.freeze({
    authentication,
    productionInfrastructureDeployment,
    balanceConsumerDeployment,
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
