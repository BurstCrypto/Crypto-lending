import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MAINNET_PLATFORM_DIRECTORY } from '../apps/api/src/mainnet-platforms/domain/mainnet-platform-directory';
// @ts-expect-error The audited local validator is an ESM JavaScript module without declarations.
import { validateEgressPolicy } from '../infra/egress/validate-egress-policy.mjs';
// @ts-expect-error The audited local validator is an ESM JavaScript module without declarations.
import { validateProviderDecisionFiles } from '../infra/providers/validate-kan-62-provider-decision.mjs';

export const PRODUCTION_PREFLIGHT_SCHEMA_VERSION = 1 as const;
export const PRODUCTION_PROVIDER_TARGET = 10 as const;

export type ProductionPreflightTarget = 'read-only' | 'mainnet-write';
export type ProductionPreflightReadiness = 'BLOCKED' | 'LOCAL_GATES_CLEAR';
export type ProductionPreflightCheckId =
  | 'AUTHENTICATION'
  | 'EXTERNAL_EGRESS'
  | 'RPC_INDEXING'
  | 'PLATFORM_DIRECTORY'
  | 'PLATFORM_LIVE_READS'
  | 'READ_ONLY_ISOLATION'
  | 'MAINNET_WRITES';

export type ProductionPreflightBlockerId =
  | 'AUTH_DEPLOYED_EVIDENCE_MISSING'
  | 'AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED'
  | 'AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED'
  | 'AUTH_TEMPLATE_INSPECTION_FAILED'
  | 'AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED'
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

export interface ProductionPreflightInput {
  readonly authentication: AuthenticationDeploymentInput;
  readonly egress: EgressInput;
  readonly rpcProviders: RpcProviderInput;
  readonly platforms: PlatformInput;
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
    environmentValuesRead: 0;
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

const REQUIRED_API_AUTH_ENVIRONMENT_NAMES = Object.freeze([
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
]);

const REQUIRED_API_AUTH_SECRET_NAMES = Object.freeze([
  'AUTH_PREAUTH_SEAL_KEY',
  'AUTH_IDENTITY_HMAC_KEY',
  'AUTH_SESSION_HMAC_KEY',
  'AUTH_CSRF_HMAC_KEY',
]);

const REQUIRED_WALLET_ENVIRONMENT_NAMES = Object.freeze([
  'WALLET_REGISTRATION_MODE',
  'WALLET_REGISTRATION_REGISTRY_ENVIRONMENT',
  'WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS',
  'WALLET_IDENTITY_HMAC_KEY_VERSION',
  'WALLET_CHALLENGE_HMAC_KEY_VERSION',
  'WALLET_METADATA_SEAL_KEY_VERSION',
]);

const REQUIRED_WALLET_SECRET_NAMES = Object.freeze([
  'WALLET_IDENTITY_HMAC_KEY',
  'WALLET_CHALLENGE_HMAC_KEY',
  'WALLET_METADATA_SEAL_KEY',
]);

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
  ['eip155:56', 'EVM'],
  ['eip155:8453', 'EVM'],
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
  environmentValuesRead: 0 as const,
  writesMade: 0 as const,
});

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

function hasEvery(values: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.every((name) => values.has(name));
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

export function evaluateProductionPreflight(
  input: ProductionPreflightInput,
  selectedTarget: ProductionPreflightTarget = 'read-only',
): ProductionPreflightReport {
  const authenticationBlockers: ProductionPreflightBlockerId[] = [];
  if (!input.authentication.inspected || !input.authentication.syntaxValid) {
    authenticationBlockers.push('AUTH_TEMPLATE_INSPECTION_FAILED');
  }
  if (
    !input.authentication.inspected ||
    !input.authentication.syntaxValid ||
    !hasEvery(input.authentication.apiEnvironmentNames, REQUIRED_API_AUTH_ENVIRONMENT_NAMES)
  ) {
    authenticationBlockers.push('AUTH_PRODUCTION_CONFIGURATION_NOT_WIRED');
  }
  if (
    !input.authentication.inspected ||
    !input.authentication.syntaxValid ||
    !hasEvery(input.authentication.apiSecretNames, REQUIRED_API_AUTH_SECRET_NAMES)
  ) {
    authenticationBlockers.push('AUTH_PRODUCTION_SECRET_REFERENCES_NOT_WIRED');
  }
  if (
    !input.authentication.inspected ||
    !input.authentication.syntaxValid ||
    !input.authentication.webEnvironmentNames.has('AUTH_PUBLIC_ORIGIN')
  ) {
    authenticationBlockers.push('AUTH_WEB_PUBLIC_ORIGIN_NOT_WIRED');
  }
  if (
    !input.authentication.inspected ||
    !input.authentication.syntaxValid ||
    !hasEvery(input.authentication.apiEnvironmentNames, REQUIRED_WALLET_ENVIRONMENT_NAMES) ||
    !hasEvery(input.authentication.apiSecretNames, REQUIRED_WALLET_SECRET_NAMES)
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

  const checks = Object.freeze([
    check(
      'AUTHENTICATION',
      input.authentication.inspected && input.authentication.syntaxValid ? 'PASS' : 'FAIL',
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
  ]);
  const mainnetWrites = readinessFor([
    'AUTHENTICATION',
    'EXTERNAL_EGRESS',
    'RPC_INDEXING',
    'PLATFORM_DIRECTORY',
    'PLATFORM_LIVE_READS',
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

interface YamlNameInspection {
  readonly names: ReadonlySet<string>;
  readonly valid: boolean;
}

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

function inspectYamlNameEntries(
  source: string | null,
  valueKey: 'Value' | 'ValueFrom',
): YamlNameInspection {
  if (source === null) return { names: new Set(), valid: false };
  const names = new Set<string>();
  const lines = source.replace(/\r\n/gu, '\n').split('\n');
  let valid = true;
  for (let index = 1; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const inline = trimmed.match(
      /^-\s*\{\s*Name:\s*([A-Z][A-Z0-9_]*),\s*(Value|ValueFrom):\s*([^}]+)\s*\}\s*$/u,
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
      } else if (names.has(name)) {
        valid = false;
      } else {
        names.add(name);
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
      names.has(name)
    ) {
      valid = false;
    } else {
      names.add(name);
      index += 1;
    }
  }
  return { names, valid };
}

export function inspectAuthenticationDeploymentTemplate(
  source: string,
): AuthenticationDeploymentInput {
  const apiTask = yamlBlock(source, 'ApiTaskDefinition', 2);
  const webTask = yamlBlock(source, 'WebTaskDefinition', 2);
  const apiContainers = apiTask === null ? null : yamlBlock(apiTask, 'ContainerDefinitions', 6);
  const webContainers = webTask === null ? null : yamlBlock(webTask, 'ContainerDefinitions', 6);
  const apiContainer =
    apiContainers === null ? null : yamlNamedSequenceEntryBlock(apiContainers, 'api', 8);
  const webContainer =
    webContainers === null ? null : yamlNamedSequenceEntryBlock(webContainers, 'web', 8);
  const apiEnvironment = apiContainer === null ? null : yamlBlock(apiContainer, 'Environment', 10);
  const apiSecrets = apiContainer === null ? null : yamlBlock(apiContainer, 'Secrets', 10);
  const webEnvironment = webContainer === null ? null : yamlBlock(webContainer, 'Environment', 10);
  const apiEnvironmentInspection = inspectYamlNameEntries(apiEnvironment, 'Value');
  const apiSecretInspection = inspectYamlNameEntries(apiSecrets, 'ValueFrom');
  const webEnvironmentInspection = inspectYamlNameEntries(webEnvironment, 'Value');
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
      webEnvironment !== null,
    syntaxValid:
      apiEnvironmentInspection.valid && apiSecretInspection.valid && webEnvironmentInspection.valid,
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

function parseJsonFile(path: string): Record<string, unknown> {
  return objectRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown);
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
  try {
    authentication = inspectAuthenticationDeploymentTemplate(
      readFileSync(resolve(repositoryRoot, 'infra/aws/application-baseline.yaml'), 'utf8'),
    );
  } catch {
    // The evaluator reports the failed local inspection with non-secret blocker IDs.
  }

  let egressRecord: Record<string, unknown> = {};
  let egressLocalValidationPassed = false;
  try {
    egressRecord = parseJsonFile(
      resolve(repositoryRoot, 'infra/egress/egress-policy.example.json'),
    );
    const validation = validateEgressPolicy(egressRecord, { mode: 'example' });
    egressLocalValidationPassed = validation.ok === true;
  } catch {
    // The evaluator emits a closed local-validation blocker.
  }

  let providerRecord: Record<string, unknown> = {};
  let providerLocalValidationPassed = false;
  try {
    const validation = validateProviderDecisionFiles({ repositoryRoot });
    providerLocalValidationPassed = validation.errors.length === 0;
    providerRecord = parseJsonFile(
      resolve(repositoryRoot, 'docs/rpc-indexing/kan-62-provider-decision.json'),
    );
  } catch {
    // The evaluator emits a closed local-validation blocker.
  }
  const providerSelection = objectRecord(providerRecord.selection);
  const providerApproval = objectRecord(providerRecord.approvalBoundary);
  const zeroCostEvidence = objectRecord(providerRecord.zeroCostEvidence);

  return Object.freeze({
    authentication,
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
  });
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
    'Safety: 0 network, DNS, cloud, provider, secret-value, environment-value, and write operations.',
    'Assurance: LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL',
  );
  return `${lines.join('\n')}\n`;
}

interface CliOptions {
  readonly json: boolean;
  readonly target: ProductionPreflightTarget;
}

export function parseProductionPreflightArguments(arguments_: readonly string[]): CliOptions {
  let json = false;
  let target: ProductionPreflightTarget = 'read-only';
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--target') {
      const value = arguments_[index + 1];
      if (value !== 'read-only' && value !== 'mainnet-write') {
        throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
      }
      target = value;
      index += 1;
      continue;
    }
    throw new TypeError('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID');
  }
  return Object.freeze({ json, target });
}

export function productionPreflightExitCode(report: ProductionPreflightReport): 0 | 1 {
  return report.selectedTargetReadiness === 'LOCAL_GATES_CLEAR' ? 0 : 1;
}

function main(): void {
  try {
    const options = parseProductionPreflightArguments(process.argv.slice(2));
    const repositoryRoot = resolve(__dirname, '..');
    const report = evaluateProductionPreflight(
      loadRepositoryProductionPreflightInput(repositoryRoot),
      options.target,
    );
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatProductionPreflightReport(report),
    );
    process.exitCode = productionPreflightExitCode(report);
  } catch {
    process.stderr.write('PRODUCTION_PREFLIGHT_ARGUMENT_INVALID\n');
    process.exitCode = 2;
  }
}

if (require.main === module) main();
