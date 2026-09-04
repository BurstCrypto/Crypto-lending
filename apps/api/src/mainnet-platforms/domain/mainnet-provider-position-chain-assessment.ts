import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import { isMainnetLaunchNetwork } from '../../blockchain/domain/mainnet-launch-network-policy';
import type { SupportedStablecoin } from '../../blockchain/domain/supported-asset-registry';
import type { MainnetProviderPositionSourceKind } from './mainnet-provider-position-observation-policy';

export const MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION = 1 as const;
export const MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE =
  'MAINNET_PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT' as const;

export type MainnetProviderPositionChainIdentityStatus = 'VERIFIED' | 'FAILED';
export type MainnetProviderPositionChainProgressionStatus =
  'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'QUARANTINED';
export type MainnetProviderPositionChainFinalityStatus =
  'HEALTHY' | 'STALLED' | 'UNAVAILABLE' | 'QUARANTINED' | 'BLOCKED_PENDING_LIVE_PROOF';

export interface MainnetProviderPositionAssessmentEvmAnchorV1 {
  readonly kind: 'EVM_BLOCK';
  readonly blockNumber: string;
  readonly blockHash: string;
}

export interface MainnetProviderPositionAssessmentSolanaAnchorV1 {
  readonly kind: 'SOLANA_SLOT';
  readonly slot: string;
  readonly root: string;
}

export type MainnetProviderPositionAssessmentChainAnchorV1 =
  MainnetProviderPositionAssessmentEvmAnchorV1 | MainnetProviderPositionAssessmentSolanaAnchorV1;

export interface MainnetProviderPositionChainAssessmentEntryV1 {
  readonly observationId: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly networkId: string;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly assessedAt: string;
  readonly identityStatus: MainnetProviderPositionChainIdentityStatus;
  readonly progressionStatus: MainnetProviderPositionChainProgressionStatus;
  readonly finalityStatus: MainnetProviderPositionChainFinalityStatus;
}

/**
 * Evidence produced outside provider-controlled snapshot data by a trusted
 * chain-observation implementation. No production verifier is bound here.
 */
export interface MainnetProviderPositionChainAssessmentV1 {
  readonly assessmentVersion: typeof MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION;
  readonly use: typeof MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly assessmentId: string;
  readonly observationPolicyFingerprintSha256: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly entries: readonly MainnetProviderPositionChainAssessmentEntryV1[];
}

export interface MainnetProviderPositionChainAssessmentVerificationContextV1 {
  readonly positionSchemaVersion: 1;
  readonly snapshotId: string;
  readonly assessmentVersion: 1;
  readonly assessmentId: string;
  readonly observationPolicyFingerprintSha256: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly observationId: string;
  /** Domain-separated digest of every normalized output observation field. */
  readonly observationFingerprintSha256: string;
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly positionId: string;
  readonly positionKind: 'SUPPLY' | 'BORROW';
  readonly stablecoin: SupportedStablecoin;
  readonly assetIdentity: string;
  readonly assetDecimals: number;
  readonly balanceAtomic: string;
  readonly balanceDecimal: string;
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly networkId: string;
  readonly observationTier: 'PROVISIONAL';
  readonly selector: 'latest' | 'confirmed';
  readonly authority: 'DISPLAY_ONLY';
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly freshnessClass: 'CURRENT' | 'STALE';
  readonly assessedAt: string;
  readonly capturedAt: string;
  readonly evaluatedAt: string;
  readonly identityStatus: MainnetProviderPositionChainIdentityStatus;
  readonly progressionStatus: MainnetProviderPositionChainProgressionStatus;
  readonly finalityStatus: MainnetProviderPositionChainFinalityStatus;
  readonly mayAuthorizeFinancialAction: false;
}

/**
 * Opaque composition-root trust boundary. Structural assessment parsing does
 * not authenticate evidence. A verifier must authenticate the capability and
 * bind it to the complete observation digest/context; callers cannot replace
 * this verifier with JSON fields or a boolean from an HTTP request.
 */
export interface MainnetProviderPositionChainAssessmentVerifierPort {
  verify(
    capability: unknown,
    context: MainnetProviderPositionChainAssessmentVerificationContextV1,
  ): boolean;
}

export class MainnetProviderPositionChainAssessmentValidationError extends Error {
  constructor() {
    super('mainnet provider position chain assessment is invalid');
    this.name = 'MainnetProviderPositionChainAssessmentValidationError';
  }
}

const ASSESSMENT_KEYS = [
  'assessmentVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'assessmentId',
  'observationPolicyFingerprintSha256',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'entries',
] as const;
const ENTRY_KEYS = [
  'observationId',
  'sourceId',
  'sourceKind',
  'sourceObservationId',
  'networkId',
  'chainAnchor',
  'assessedAt',
  'identityStatus',
  'progressionStatus',
  'finalityStatus',
] as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SAFE_OPAQUE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$/u;
const SAFE_ASSESSMENT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/u;
const EVM_HEX_ID = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u;
const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const MAX_UINT64 = '18446744073709551615';
const MAX_ENTRIES = 512;
const SOURCE_KINDS = new Set<MainnetProviderPositionSourceKind>(['RPC', 'INDEXER', 'PROVIDER_API']);
const IDENTITY_STATUSES = new Set<MainnetProviderPositionChainIdentityStatus>([
  'VERIFIED',
  'FAILED',
]);
const PROGRESSION_STATUSES = new Set<MainnetProviderPositionChainProgressionStatus>([
  'CURRENT',
  'STALE',
  'UNAVAILABLE',
  'QUARANTINED',
]);
const FINALITY_STATUSES = new Set<MainnetProviderPositionChainFinalityStatus>([
  'HEALTHY',
  'STALLED',
  'UNAVAILABLE',
  'QUARANTINED',
  'BLOCKED_PENDING_LIVE_PROOF',
]);

function fail(): never {
  throw new MainnetProviderPositionChainAssessmentValidationError();
}

function dataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return fail();
  }
}

function dataProperty(value: unknown, key: string): unknown {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
    return descriptor.value;
  } catch {
    return fail();
  }
}

function dataArray(value: unknown): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_ENTRIES ||
      lengthDescriptor.enumerable !== false
    ) {
      return fail();
    }
    const length = lengthDescriptor.value;
    const indexKeys = Array.from({ length }, (_, index) => String(index));
    const expectedKeys = [...indexKeys, 'length'];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }
    return indexKeys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      return descriptor.value;
    });
  } catch {
    return fail();
  }
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function opaqueId(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_OPAQUE_ID.test(value)) return fail();
  if (value.toLowerCase().startsWith('0x')) {
    if (!EVM_HEX_ID.test(value) || /^0x0+$/iu.test(value)) return fail();
    return value.toLowerCase();
  }
  return value;
}

function unsignedInteger(value: unknown, maximum: string): string {
  if (
    typeof value !== 'string' ||
    !CANONICAL_UNSIGNED_INTEGER.test(value) ||
    value.length > maximum.length ||
    (value.length === maximum.length && value > maximum)
  ) {
    return fail();
  }
  return value;
}

function parseAnchor(
  value: unknown,
  networkId: string,
): MainnetProviderPositionAssessmentChainAnchorV1 {
  const kind = dataProperty(value, 'kind');
  if (kind === 'EVM_BLOCK') {
    const record = dataRecord(value, ['kind', 'blockNumber', 'blockHash']);
    if (!networkId.startsWith('eip155:')) return fail();
    const blockNumber = unsignedInteger(record.blockNumber, MAX_UINT256);
    if (
      typeof record.blockHash !== 'string' ||
      !EVM_BLOCK_HASH.test(record.blockHash) ||
      /^0x0{64}$/iu.test(record.blockHash)
    ) {
      return fail();
    }
    return Object.freeze({
      kind: 'EVM_BLOCK',
      blockNumber,
      blockHash: record.blockHash.toLowerCase(),
    });
  }
  if (kind === 'SOLANA_SLOT') {
    const record = dataRecord(value, ['kind', 'slot', 'root']);
    if (!networkId.startsWith('solana:')) return fail();
    const slot = unsignedInteger(record.slot, MAX_UINT64);
    const root = unsignedInteger(record.root, MAX_UINT64);
    if (BigInt(root) > BigInt(slot)) return fail();
    return Object.freeze({ kind: 'SOLANA_SLOT', slot, root });
  }
  return fail();
}

function parseEntry(value: unknown): MainnetProviderPositionChainAssessmentEntryV1 {
  const record = dataRecord(value, ENTRY_KEYS);
  if (typeof record.observationId !== 'string' || !UUID_V4.test(record.observationId)) {
    return fail();
  }
  if (typeof record.sourceId !== 'string' || !SAFE_ID.test(record.sourceId)) return fail();
  if (!SOURCE_KINDS.has(record.sourceKind as MainnetProviderPositionSourceKind)) return fail();
  if (typeof record.networkId !== 'string') return fail();
  if (!isMainnetLaunchNetwork(record.networkId)) return fail();
  const chainPolicy = chainObservationPolicyForNetwork(record.networkId);
  if (!chainPolicy || chainPolicy.environment !== 'MAINNET') return fail();
  if (!IDENTITY_STATUSES.has(record.identityStatus as MainnetProviderPositionChainIdentityStatus)) {
    return fail();
  }
  if (
    !PROGRESSION_STATUSES.has(
      record.progressionStatus as MainnetProviderPositionChainProgressionStatus,
    )
  ) {
    return fail();
  }
  if (!FINALITY_STATUSES.has(record.finalityStatus as MainnetProviderPositionChainFinalityStatus)) {
    return fail();
  }
  return Object.freeze({
    observationId: record.observationId,
    sourceId: record.sourceId,
    sourceKind: record.sourceKind as MainnetProviderPositionSourceKind,
    sourceObservationId: opaqueId(record.sourceObservationId),
    networkId: record.networkId,
    chainAnchor: parseAnchor(record.chainAnchor, record.networkId),
    assessedAt: timestamp(record.assessedAt),
    identityStatus: record.identityStatus as MainnetProviderPositionChainIdentityStatus,
    progressionStatus: record.progressionStatus as MainnetProviderPositionChainProgressionStatus,
    finalityStatus: record.finalityStatus as MainnetProviderPositionChainFinalityStatus,
  });
}

function anchorKey(anchor: MainnetProviderPositionAssessmentChainAnchorV1): string {
  return anchor.kind === 'EVM_BLOCK'
    ? `${anchor.kind}\u0000${anchor.blockNumber}\u0000${anchor.blockHash}`
    : `${anchor.kind}\u0000${anchor.slot}\u0000${anchor.root}`;
}

/**
 * Structural normalization only. Authenticity, replay resistance, durable
 * head progression, and finality must be established by the separately
 * supplied verifier; this function never grants financial authority.
 */
export function parseMainnetProviderPositionChainAssessmentV1(
  value: unknown,
): MainnetProviderPositionChainAssessmentV1 {
  const record = dataRecord(value, ASSESSMENT_KEYS);
  if (
    record.assessmentVersion !== MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION ||
    record.use !== MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    typeof record.assessmentId !== 'string' ||
    !SAFE_ASSESSMENT_ID.test(record.assessmentId) ||
    typeof record.observationPolicyFingerprintSha256 !== 'string' ||
    !SHA256.test(record.observationPolicyFingerprintSha256) ||
    typeof record.assetRegistryVersion !== 'number' ||
    !Number.isSafeInteger(record.assetRegistryVersion) ||
    record.assetRegistryVersion < 1 ||
    typeof record.assetRegistryFingerprintSha256 !== 'string' ||
    !SHA256.test(record.assetRegistryFingerprintSha256)
  ) {
    return fail();
  }
  const entries = dataArray(record.entries).map(parseEntry);
  const observationIds = new Set<string>();
  for (const entry of entries) {
    if (observationIds.has(entry.observationId)) return fail();
    observationIds.add(entry.observationId);
  }
  entries.sort((left, right) =>
    left.observationId < right.observationId
      ? -1
      : left.observationId > right.observationId
        ? 1
        : 0,
  );
  return Object.freeze({
    assessmentVersion: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
    use: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE,
    mayAuthorizeFinancialAction: false,
    assessmentId: record.assessmentId,
    observationPolicyFingerprintSha256: record.observationPolicyFingerprintSha256,
    assetRegistryVersion: record.assetRegistryVersion,
    assetRegistryFingerprintSha256: record.assetRegistryFingerprintSha256,
    entries: Object.freeze(entries),
  });
}

export function mainnetProviderPositionChainAssessmentForSource(
  assessment: MainnetProviderPositionChainAssessmentV1,
  input: Readonly<{
    observationId: string;
    sourceId: string;
    sourceKind: MainnetProviderPositionSourceKind;
    sourceObservationId: string;
    networkId: string;
    chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  }>,
): MainnetProviderPositionChainAssessmentEntryV1 | undefined {
  const expectedAnchorKey = anchorKey(input.chainAnchor);
  return assessment.entries.find(
    (entry) =>
      entry.observationId === input.observationId &&
      entry.sourceId === input.sourceId &&
      entry.sourceKind === input.sourceKind &&
      entry.sourceObservationId === input.sourceObservationId &&
      entry.networkId === input.networkId &&
      anchorKey(entry.chainAnchor) === expectedAnchorKey,
  );
}
