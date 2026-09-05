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
  '9ffa126c63a1758db315eae58462f3d1a47cf3542136db39a65749c47dd08fb6';

export type ProductionPreflightTarget = 'read-only' | 'mainnet-write';
export type ProductionPreflightReadiness = 'BLOCKED' | 'LOCAL_GATES_CLEAR';
export type ProductionPreflightCheckId =
  | 'AUTHENTICATION'
  | 'EXTERNAL_EGRESS'
  | 'RPC_INDEXING'
  | 'PLATFORM_DIRECTORY'
  | 'PLATFORM_LIVE_READS'
  | 'READ_ONLY_ISOLATION'
  | 'PUBLIC_LAUNCH_AUTHORITIES'
  | 'MAINNET_WRITES';

export type ProductionPreflightBlockerId =
  | 'AUTH_DEPLOYED_EVIDENCE_MISSING'
  | 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'
  | 'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED'
  | 'AUTH_TEMPLATE_INSPECTION_FAILED'
  | 'AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED'
  | 'DATABASE_MASTER_SECRET_NOT_RDS_MANAGED'
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
  /** Optional for legacy programmatic callers; absence fails closed during evaluation. */
  readonly databaseMasterDeployment?: DatabaseMasterDeploymentInput;
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
const EVIDENCE_DERIVED_PUBLIC_LAUNCH_BINDINGS = new WeakMap<
  object,
  Readonly<{
    bundle: VerifiedProductionEvidenceBundle;
    applicationOptions: Readonly<ProductionEvidenceApplicationOptions>;
  }>
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
  const authenticationBlockers: ProductionPreflightBlockerId[] = [];
  const databaseMasterDeployment = input.databaseMasterDeployment;
  const databaseMasterDeploymentValid =
    databaseMasterDeployment?.inspected === true &&
    databaseMasterDeployment.syntaxValid === true &&
    VERIFIED_DATABASE_MASTER_DEPLOYMENTS.has(databaseMasterDeployment);
  if (!databaseMasterDeploymentValid) {
    authenticationBlockers.push('DATABASE_MASTER_SECRET_NOT_RDS_MANAGED');
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
    'AUTHENTICATION',
    'EXTERNAL_EGRESS',
    'RPC_INDEXING',
    'PLATFORM_DIRECTORY',
    'PLATFORM_LIVE_READS',
    'READ_ONLY_ISOLATION',
    'PUBLIC_LAUNCH_AUTHORITIES',
  ]);
  const mainnetWrites = readinessFor([
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
    redisOperatorDeployment = inspectRedisOperatorDeploymentTemplates(
      applicationTemplateSource,
      readFileSync(
        resolve(repositoryRoot, 'infra/aws/application-workload-boundaries.yaml'),
        'utf8',
      ),
      readFileSync(resolve(repositoryRoot, 'infra/aws/application-observability.yaml'), 'utf8'),
    );
  } catch {
    // The evaluator reports the failed local inspection without exposing paths or values.
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
    databaseMasterDeployment,
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
    EVIDENCE_DERIVED_PUBLIC_LAUNCH_BINDINGS.set(
      evidenceBinding,
      Object.freeze({ bundle, applicationOptions }),
    );

    return Object.freeze({
      ...input,
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
        // Evidence schema v1 is read-only and can never supplement write evidence.
        mainnetWriteEvidenceIndex: null,
      }),
      publicLaunchAuthorities: Object.freeze({
        decisionSet: null,
        evidenceBinding,
      }),
    });
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
    if (
      evidenceBinding === null ||
      evidenceBinding === undefined ||
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
    if (!isVerifiedProductionEvidenceBundle(evidenceContext.bundle)) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    revalidatePublicLaunchAuthorityDecisionForApplication(decisionSet, evidenceBinding);
    if (!isVerifiedPublicLaunchAuthorityDecisionSet(decisionSet)) {
      throw new PublicLaunchAuthorityDecisionInvalidError();
    }
    return Object.freeze({
      ...input,
      publicLaunchAuthorities: Object.freeze({ decisionSet, evidenceBinding }),
    });
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
