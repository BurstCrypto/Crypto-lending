import { createHash } from 'node:crypto';
import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedAssetRegistrySnapshot,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import {
  chainObservationPolicyForNetwork,
  observationTierRule,
} from '../../blockchain/domain/chain-observation-policy';
import {
  mainnetProviderPositionPolicyAllowsMarket,
  mainnetProviderPositionPolicyAllowsSource,
  parseMainnetProviderPositionObservationPolicyV1,
  type MainnetProviderPositionObservationPolicyV1,
  type MainnetProviderPositionSourceKind,
} from './mainnet-provider-position-observation-policy';
import {
  mainnetProviderPositionChainAssessmentForSource,
  parseMainnetProviderPositionChainAssessmentV1,
  type MainnetProviderPositionChainAssessmentV1,
  type MainnetProviderPositionChainAssessmentVerifierPort,
} from './mainnet-provider-position-chain-assessment';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const CANONICAL_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SAFE_OPAQUE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/u;
const EVM_HEX_ID = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u;
const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const MAX_UINT64 = '18446744073709551615';
const MAX_OBSERVATIONS = 512;
const MAX_ASSET_DECIMALS = 36;

export const MAINNET_PROVIDER_POSITION_SCHEMA_VERSION = 1 as const;
export const MAINNET_PROVIDER_POSITION_OBSERVATION_USE =
  'MAINNET_PROVIDER_POSITION_OBSERVATION_ONLY' as const;

export type MainnetProviderPositionFreshness = 'CURRENT' | 'STALE';
export type MainnetProviderPositionKind = 'SUPPLY' | 'BORROW';
export type { MainnetProviderPositionSourceKind } from './mainnet-provider-position-observation-policy';

export interface MainnetProviderPositionAssetV1 {
  readonly stablecoin: SupportedStablecoin;
  readonly networkId: string;
  readonly identity: string;
  readonly decimals: number;
}

export interface MainnetProviderPositionBalanceV1 {
  readonly atomic: string;
  readonly decimal: string;
}

export interface MainnetProviderPositionEvmAnchorV1 {
  readonly kind: 'EVM_BLOCK';
  readonly blockNumber: string;
  readonly blockHash: string;
}

export interface MainnetProviderPositionSolanaAnchorV1 {
  readonly kind: 'SOLANA_SLOT';
  readonly slot: string;
  readonly root: string;
}

export type MainnetProviderPositionChainAnchorV1 =
  MainnetProviderPositionEvmAnchorV1 | MainnetProviderPositionSolanaAnchorV1;

export interface MainnetProviderPositionSourceV1 {
  /** Product-owned approved source identity; never an endpoint or credential. */
  readonly sourceId: string;
  readonly sourceKind: MainnetProviderPositionSourceKind;
  readonly sourceObservationId: string;
  readonly chainAnchor: MainnetProviderPositionChainAnchorV1;
}

export interface MainnetProviderPositionObservationV1 {
  readonly observationId: string;
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly positionId: string;
  readonly positionKind: MainnetProviderPositionKind;
  readonly asset: MainnetProviderPositionAssetV1;
  readonly balance: MainnetProviderPositionBalanceV1;
  readonly source: MainnetProviderPositionSourceV1;
  readonly observedAt: string;
  /** Exclusive effective freshness deadline; equality is conservatively STALE. */
  readonly staleAfter: string;
  readonly freshnessClass: MainnetProviderPositionFreshness;
}

export interface MainnetProviderPositionSnapshotV1 {
  readonly schemaVersion: typeof MAINNET_PROVIDER_POSITION_SCHEMA_VERSION;
  readonly use: typeof MAINNET_PROVIDER_POSITION_OBSERVATION_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly snapshotId: string;
  readonly observationPolicyVersion: 1;
  readonly observationPolicyId: string;
  readonly observationPolicyFingerprintSha256: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly capturedAt: string;
  /** Exclusive earliest observation deadline; equality is conservatively STALE. */
  readonly staleAfter: string;
  readonly freshnessClass: MainnetProviderPositionFreshness;
  readonly observations: readonly [
    MainnetProviderPositionObservationV1,
    ...MainnetProviderPositionObservationV1[],
  ];
}

export type MainnetProviderPositionValidationCode =
  | 'INVALID_SCHEMA_VERSION'
  | 'INVALID_SNAPSHOT'
  | 'INVALID_POLICY'
  | 'INVALID_CHAIN_ASSESSMENT'
  | 'UNAPPROVED_ATTRIBUTION'
  | 'INVALID_OBSERVATION'
  | 'INVALID_ASSET'
  | 'INVALID_BALANCE'
  | 'INVALID_SOURCE'
  | 'INVALID_FRESHNESS'
  | 'DUPLICATE_OBSERVATION'
  | 'DUPLICATE_POSITION';

export class MainnetProviderPositionValidationError extends Error {
  constructor(readonly code: MainnetProviderPositionValidationCode) {
    super('mainnet provider position snapshot is invalid');
    this.name = 'MainnetProviderPositionValidationError';
  }
}

function fail(code: MainnetProviderPositionValidationCode): never {
  throw new MainnetProviderPositionValidationError(code);
}

function dataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: MainnetProviderPositionValidationCode,
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail(code);
    }

    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return fail(code);
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return fail(code);
  }
}

function dataProperty(
  value: unknown,
  key: string,
  code: MainnetProviderPositionValidationCode,
): unknown {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      return fail(code);
    }
    return descriptor.value;
  } catch {
    return fail(code);
  }
}

function dataArray(
  value: unknown,
  maximumLength: number,
  code: MainnetProviderPositionValidationCode,
): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors['length'];
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return fail(code);
    const length = lengthDescriptor.value;
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumLength
    ) {
      return fail(code);
    }
    const indexKeys = Array.from({ length }, (_, index) => String(index));
    const expectedKeys = [...indexKeys, 'length'];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key)) ||
      lengthDescriptor.enumerable !== false
    ) {
      return fail(code);
    }

    return indexKeys.map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return fail(code);
      }
      return descriptor.value;
    });
  } catch {
    return fail(code);
  }
}

function timestamp(value: unknown, code: MainnetProviderPositionValidationCode): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return fail(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail(code);
  return value;
}

function slug(value: unknown, code: MainnetProviderPositionValidationCode): string {
  if (typeof value !== 'string' || !CANONICAL_SLUG.test(value)) return fail(code);
  return value;
}

function opaqueId(value: unknown, code: MainnetProviderPositionValidationCode): string {
  if (typeof value !== 'string' || !SAFE_OPAQUE_ID.test(value)) return fail(code);
  if (value.toLowerCase().startsWith('0x')) {
    if (!EVM_HEX_ID.test(value) || /^0x0+$/iu.test(value)) return fail(code);
    return value.toLowerCase();
  }
  return value;
}

function unsignedInteger(
  value: unknown,
  maximum: string,
  code: MainnetProviderPositionValidationCode,
): string {
  if (
    typeof value !== 'string' ||
    !CANONICAL_UNSIGNED_INTEGER.test(value) ||
    value.length > maximum.length ||
    (value.length === maximum.length && value > maximum)
  ) {
    return fail(code);
  }
  return value;
}

function freshness(
  value: unknown,
  staleAfter: string,
  evaluatedAt: string,
): MainnetProviderPositionFreshness {
  // staleAfter is an exclusive product deadline. This intentionally becomes
  // STALE at equality even where a chain-policy age ceiling is inclusive.
  const expected = evaluatedAt < staleAfter ? 'CURRENT' : 'STALE';
  if (value !== expected) return fail('INVALID_FRESHNESS');
  return expected;
}

export interface MainnetProviderPositionObservationFingerprintInputV1 {
  readonly snapshotId: string;
  readonly observationPolicyFingerprintSha256: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly observationId: string;
  readonly walletId: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly positionId: string;
  readonly positionKind: MainnetProviderPositionKind;
  readonly asset: MainnetProviderPositionAssetV1;
  readonly balance: MainnetProviderPositionBalanceV1;
  readonly source: MainnetProviderPositionSourceV1;
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly freshnessClass: MainnetProviderPositionFreshness;
  readonly capturedAt: string;
}

/** Canonical domain-separated digest used by chain-assessment verification. */
export function mainnetProviderPositionObservationFingerprintV1(
  input: MainnetProviderPositionObservationFingerprintInputV1,
): string {
  const anchor =
    input.source.chainAnchor.kind === 'EVM_BLOCK'
      ? [
          input.source.chainAnchor.kind,
          input.source.chainAnchor.blockNumber,
          input.source.chainAnchor.blockHash,
        ]
      : [
          input.source.chainAnchor.kind,
          input.source.chainAnchor.slot,
          input.source.chainAnchor.root,
        ];
  const canonical = [
    'crypto-lending:mainnet-provider-position-observation:v1',
    MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    input.snapshotId,
    input.observationPolicyFingerprintSha256,
    input.assetRegistryVersion,
    input.assetRegistryFingerprintSha256,
    input.observationId,
    input.walletId,
    input.providerId,
    input.protocolId,
    input.marketId,
    input.positionId,
    input.positionKind,
    input.asset.stablecoin,
    input.asset.networkId,
    input.asset.identity,
    input.asset.decimals,
    input.balance.atomic,
    input.balance.decimal,
    input.source.sourceId,
    input.source.sourceKind,
    input.source.sourceObservationId,
    anchor,
    input.observedAt,
    input.staleAfter,
    input.freshnessClass,
    input.capturedAt,
  ] as const;
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function registrySnapshot(
  versionValue: unknown,
  fingerprintValue: unknown,
): SupportedAssetRegistrySnapshot {
  if (
    typeof versionValue !== 'number' ||
    !Number.isSafeInteger(versionValue) ||
    versionValue < 1 ||
    typeof fingerprintValue !== 'string' ||
    !SHA256.test(fingerprintValue)
  ) {
    return fail('INVALID_SNAPSHOT');
  }
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.atVersion(versionValue);
  if (!registry || registry.fingerprintSha256 !== fingerprintValue) {
    return fail('INVALID_SNAPSHOT');
  }
  return registry;
}

function parseAsset(
  value: unknown,
  registry: SupportedAssetRegistrySnapshot,
): MainnetProviderPositionAssetV1 {
  const record = dataRecord(
    value,
    ['stablecoin', 'networkId', 'identity', 'decimals'],
    'INVALID_ASSET',
  );
  if (
    typeof record.networkId !== 'string' ||
    typeof record.identity !== 'string' ||
    typeof record.decimals !== 'number' ||
    !Number.isSafeInteger(record.decimals) ||
    record.decimals < 0 ||
    record.decimals > MAX_ASSET_DECIMALS
  ) {
    return fail('INVALID_ASSET');
  }
  const asset = registry.identifyAsset(record.networkId, record.identity);
  const network = registry.networks.find(({ networkId }) => networkId === record.networkId);
  if (
    !asset ||
    !network ||
    asset.activationState !== 'ACTIVE' ||
    network.activationState !== 'ACTIVE' ||
    record.stablecoin !== asset.stablecoin ||
    record.decimals !== asset.decimals
  ) {
    return fail('INVALID_ASSET');
  }
  return Object.freeze({
    stablecoin: asset.stablecoin,
    networkId: asset.networkId,
    identity: asset.identity,
    decimals: asset.decimals,
  });
}

/** Renders an atomic position balance without passing the amount through a JavaScript number. */
export function mainnetProviderPositionDecimalFromAtomic(
  atomicValue: unknown,
  decimalsValue: unknown,
): string {
  const atomic = unsignedInteger(atomicValue, MAX_UINT256, 'INVALID_BALANCE');
  if (
    typeof decimalsValue !== 'number' ||
    !Number.isSafeInteger(decimalsValue) ||
    decimalsValue < 0 ||
    decimalsValue > MAX_ASSET_DECIMALS
  ) {
    return fail('INVALID_BALANCE');
  }
  if (decimalsValue === 0) return atomic;
  const padded = atomic.padStart(decimalsValue + 1, '0');
  const splitAt = padded.length - decimalsValue;
  return `${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`;
}

function parseBalance(
  value: unknown,
  asset: MainnetProviderPositionAssetV1,
): MainnetProviderPositionBalanceV1 {
  const record = dataRecord(value, ['atomic', 'decimal'], 'INVALID_BALANCE');
  const maximum = asset.networkId.startsWith('solana:') ? MAX_UINT64 : MAX_UINT256;
  const atomic = unsignedInteger(record.atomic, maximum, 'INVALID_BALANCE');
  const decimal = mainnetProviderPositionDecimalFromAtomic(atomic, asset.decimals);
  if (record.decimal !== decimal) return fail('INVALID_BALANCE');
  return Object.freeze({ atomic, decimal });
}

function parseChainAnchor(value: unknown, networkId: string): MainnetProviderPositionChainAnchorV1 {
  const kind = dataProperty(value, 'kind', 'INVALID_SOURCE');
  if (kind === 'EVM_BLOCK') {
    const record = dataRecord(value, ['kind', 'blockNumber', 'blockHash'], 'INVALID_SOURCE');
    if (!networkId.startsWith('eip155:')) return fail('INVALID_SOURCE');
    const blockNumber = unsignedInteger(record.blockNumber, MAX_UINT256, 'INVALID_SOURCE');
    if (
      typeof record.blockHash !== 'string' ||
      !EVM_BLOCK_HASH.test(record.blockHash) ||
      /^0x0{64}$/iu.test(record.blockHash)
    ) {
      return fail('INVALID_SOURCE');
    }
    return Object.freeze({
      kind: 'EVM_BLOCK',
      blockNumber,
      blockHash: record.blockHash.toLowerCase(),
    });
  }
  if (kind === 'SOLANA_SLOT') {
    const record = dataRecord(value, ['kind', 'slot', 'root'], 'INVALID_SOURCE');
    if (!networkId.startsWith('solana:')) return fail('INVALID_SOURCE');
    const slot = unsignedInteger(record.slot, MAX_UINT64, 'INVALID_SOURCE');
    const root = unsignedInteger(record.root, MAX_UINT64, 'INVALID_SOURCE');
    if (BigInt(root) > BigInt(slot)) return fail('INVALID_SOURCE');
    return Object.freeze({ kind: 'SOLANA_SLOT', slot, root });
  }
  return fail('INVALID_SOURCE');
}

function parseSource(
  value: unknown,
  networkId: string,
  observationPolicy: MainnetProviderPositionObservationPolicyV1,
): MainnetProviderPositionSourceV1 {
  const record = dataRecord(
    value,
    ['sourceId', 'sourceKind', 'sourceObservationId', 'chainAnchor'],
    'INVALID_SOURCE',
  );
  if (
    record.sourceKind !== 'RPC' &&
    record.sourceKind !== 'INDEXER' &&
    record.sourceKind !== 'PROVIDER_API'
  ) {
    return fail('INVALID_SOURCE');
  }
  const sourceId = slug(record.sourceId, 'INVALID_SOURCE');
  if (
    !mainnetProviderPositionPolicyAllowsSource(
      observationPolicy,
      sourceId,
      record.sourceKind,
      networkId,
    )
  ) {
    return fail('UNAPPROVED_ATTRIBUTION');
  }
  return Object.freeze({
    sourceId,
    sourceKind: record.sourceKind,
    sourceObservationId: opaqueId(record.sourceObservationId, 'INVALID_SOURCE'),
    chainAnchor: parseChainAnchor(record.chainAnchor, networkId),
  });
}

function parseObservation(
  value: unknown,
  snapshotId: string,
  registry: SupportedAssetRegistrySnapshot,
  observationPolicy: MainnetProviderPositionObservationPolicyV1,
  chainAssessment: MainnetProviderPositionChainAssessmentV1,
  chainAssessmentCapability: unknown,
  chainAssessmentVerifier: MainnetProviderPositionChainAssessmentVerifierPort,
  capturedAt: string,
  evaluatedAt: string,
): MainnetProviderPositionObservationV1 {
  const record = dataRecord(
    value,
    [
      'observationId',
      'walletId',
      'providerId',
      'protocolId',
      'marketId',
      'positionId',
      'positionKind',
      'asset',
      'balance',
      'source',
      'observedAt',
      'staleAfter',
      'freshnessClass',
    ],
    'INVALID_OBSERVATION',
  );
  if (
    typeof record.observationId !== 'string' ||
    !UUID_V4.test(record.observationId) ||
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    (record.positionKind !== 'SUPPLY' && record.positionKind !== 'BORROW')
  ) {
    return fail('INVALID_OBSERVATION');
  }

  const providerId = slug(record.providerId, 'INVALID_OBSERVATION');
  const protocolId = slug(record.protocolId, 'INVALID_OBSERVATION');
  const marketId = opaqueId(record.marketId, 'INVALID_OBSERVATION');
  const positionId = opaqueId(record.positionId, 'INVALID_OBSERVATION');
  const observedAt = timestamp(record.observedAt, 'INVALID_OBSERVATION');
  const staleAfter = timestamp(record.staleAfter, 'INVALID_FRESHNESS');
  const observedAtMs = Date.parse(observedAt);
  const capturedAtMs = Date.parse(capturedAt);
  const evaluatedAtMs = Date.parse(evaluatedAt);
  if (observedAtMs > capturedAtMs || staleAfter <= observedAt) {
    return fail('INVALID_FRESHNESS');
  }
  const asset = parseAsset(record.asset, registry);
  const balance = parseBalance(record.balance, asset);
  if (
    !mainnetProviderPositionPolicyAllowsMarket(
      observationPolicy,
      providerId,
      protocolId,
      asset.networkId,
      marketId,
      asset.stablecoin,
      asset.identity,
    )
  ) {
    return fail('UNAPPROVED_ATTRIBUTION');
  }
  const chainPolicy = chainObservationPolicyForNetwork(asset.networkId);
  if (!chainPolicy || chainPolicy.environment !== 'MAINNET') return fail('INVALID_FRESHNESS');
  const provisionalRule = observationTierRule(asset.networkId, 'PROVISIONAL');
  if (
    !provisionalRule ||
    provisionalRule.state !== 'ALLOWED' ||
    provisionalRule.authority !== 'DISPLAY_ONLY' ||
    (provisionalRule.selector !== 'latest' && provisionalRule.selector !== 'confirmed')
  ) {
    return fail('INVALID_CHAIN_ASSESSMENT');
  }
  const policyCurrentDeadlineMs = observedAtMs + chainPolicy.freshness.currentWithinMs;
  const policyUnavailableDeadlineMs = observedAtMs + chainPolicy.freshness.unavailableAfterMs;
  if (
    capturedAtMs - observedAtMs > chainPolicy.freshness.unavailableAfterMs ||
    evaluatedAtMs > policyUnavailableDeadlineMs
  ) {
    return fail('INVALID_FRESHNESS');
  }
  const source = parseSource(record.source, asset.networkId, observationPolicy);
  const assessmentEntry = mainnetProviderPositionChainAssessmentForSource(chainAssessment, {
    observationId: record.observationId,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    sourceObservationId: source.sourceObservationId,
    networkId: asset.networkId,
    chainAnchor: source.chainAnchor,
  });
  if (
    !assessmentEntry ||
    assessmentEntry.identityStatus !== 'VERIFIED' ||
    (assessmentEntry.progressionStatus !== 'CURRENT' &&
      assessmentEntry.progressionStatus !== 'STALE') ||
    (assessmentEntry.finalityStatus !== 'HEALTHY' && assessmentEntry.finalityStatus !== 'STALLED')
  ) {
    return fail('INVALID_CHAIN_ASSESSMENT');
  }
  const assessedAtMs = Date.parse(assessmentEntry.assessedAt);
  if (
    assessedAtMs < observedAtMs ||
    assessedAtMs > capturedAtMs ||
    capturedAtMs - assessedAtMs > chainPolicy.freshness.unavailableAfterMs ||
    evaluatedAtMs - assessedAtMs > chainPolicy.freshness.unavailableAfterMs
  ) {
    return fail('INVALID_CHAIN_ASSESSMENT');
  }
  const assessmentCurrentDeadlineMs = assessedAtMs + chainPolicy.freshness.currentWithinMs;
  let effectiveDeadlineMs = Math.min(
    Date.parse(staleAfter),
    policyCurrentDeadlineMs,
    assessmentCurrentDeadlineMs,
  );
  if (
    assessmentEntry.progressionStatus === 'STALE' ||
    assessmentEntry.finalityStatus === 'STALLED'
  ) {
    effectiveDeadlineMs = Math.min(effectiveDeadlineMs, assessedAtMs);
  }
  const effectiveStaleAfter = new Date(effectiveDeadlineMs).toISOString();
  const freshnessClass = freshness(record.freshnessClass, effectiveStaleAfter, evaluatedAt);
  const observationFingerprint = mainnetProviderPositionObservationFingerprintV1({
    snapshotId,
    observationPolicyFingerprintSha256: observationPolicy.fingerprintSha256,
    assetRegistryVersion: registry.version,
    assetRegistryFingerprintSha256: registry.fingerprintSha256,
    observationId: record.observationId,
    walletId: record.walletId,
    providerId,
    protocolId,
    marketId,
    positionId,
    positionKind: record.positionKind,
    asset,
    balance,
    source,
    observedAt,
    staleAfter: effectiveStaleAfter,
    freshnessClass,
    capturedAt,
  });
  try {
    if (
      chainAssessmentVerifier.verify(
        chainAssessmentCapability,
        Object.freeze({
          positionSchemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
          snapshotId,
          assessmentVersion: chainAssessment.assessmentVersion,
          assessmentId: chainAssessment.assessmentId,
          observationPolicyFingerprintSha256: chainAssessment.observationPolicyFingerprintSha256,
          assetRegistryVersion: chainAssessment.assetRegistryVersion,
          assetRegistryFingerprintSha256: chainAssessment.assetRegistryFingerprintSha256,
          observationId: record.observationId,
          observationFingerprintSha256: observationFingerprint,
          walletId: record.walletId,
          providerId,
          protocolId,
          marketId,
          positionId,
          positionKind: record.positionKind,
          stablecoin: asset.stablecoin,
          assetIdentity: asset.identity,
          assetDecimals: asset.decimals,
          balanceAtomic: balance.atomic,
          balanceDecimal: balance.decimal,
          sourceId: source.sourceId,
          sourceKind: source.sourceKind,
          sourceObservationId: source.sourceObservationId,
          networkId: asset.networkId,
          observationTier: 'PROVISIONAL',
          selector: provisionalRule.selector,
          authority: 'DISPLAY_ONLY',
          chainAnchor: source.chainAnchor,
          observedAt,
          staleAfter: effectiveStaleAfter,
          freshnessClass,
          assessedAt: assessmentEntry.assessedAt,
          capturedAt,
          evaluatedAt,
          identityStatus: assessmentEntry.identityStatus,
          progressionStatus: assessmentEntry.progressionStatus,
          finalityStatus: assessmentEntry.finalityStatus,
          mayAuthorizeFinancialAction: false,
        }),
      ) !== true
    ) {
      return fail('INVALID_CHAIN_ASSESSMENT');
    }
  } catch {
    return fail('INVALID_CHAIN_ASSESSMENT');
  }

  return Object.freeze({
    observationId: record.observationId,
    walletId: record.walletId,
    providerId,
    protocolId,
    marketId,
    positionId,
    positionKind: record.positionKind,
    asset,
    balance,
    source,
    observedAt,
    staleAfter: effectiveStaleAfter,
    freshnessClass,
  });
}

function positionKey(observation: MainnetProviderPositionObservationV1): string {
  return [
    observation.walletId,
    observation.asset.networkId,
    observation.asset.identity,
    observation.providerId,
    observation.protocolId,
    observation.marketId,
    observation.positionId,
    observation.positionKind,
  ].join('\0');
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Validates, canonicalizes, copies, and deeply freezes a read-only provider
 * position snapshot. It neither reads a provider nor authorizes an action.
 *
 * The exact `chainAssessmentInput` object reference is deliberately forwarded
 * to the verifier as an opaque capability. A composition root must create and
 * register that object server-side (for example in a WeakSet/WeakMap); the
 * verifier must reject a structurally identical deserialized or cloned object.
 */
export function parseMainnetProviderPositionSnapshotV1(
  value: unknown,
  evaluatedAtInput: unknown,
  observationPolicyInput: unknown,
  chainAssessmentInput: unknown,
  chainAssessmentVerifier: MainnetProviderPositionChainAssessmentVerifierPort,
): MainnetProviderPositionSnapshotV1 {
  const evaluatedAt = timestamp(evaluatedAtInput, 'INVALID_FRESHNESS');
  let observationPolicy: MainnetProviderPositionObservationPolicyV1;
  try {
    observationPolicy = parseMainnetProviderPositionObservationPolicyV1(observationPolicyInput);
  } catch {
    return fail('INVALID_POLICY');
  }
  let chainAssessment: MainnetProviderPositionChainAssessmentV1;
  try {
    chainAssessment = parseMainnetProviderPositionChainAssessmentV1(chainAssessmentInput);
  } catch {
    return fail('INVALID_CHAIN_ASSESSMENT');
  }
  const record = dataRecord(
    value,
    [
      'schemaVersion',
      'use',
      'mayAuthorizeFinancialAction',
      'snapshotId',
      'observationPolicyVersion',
      'observationPolicyId',
      'observationPolicyFingerprintSha256',
      'assetRegistryVersion',
      'assetRegistryFingerprintSha256',
      'capturedAt',
      'staleAfter',
      'freshnessClass',
      'observations',
    ],
    'INVALID_SNAPSHOT',
  );
  if (record.schemaVersion !== MAINNET_PROVIDER_POSITION_SCHEMA_VERSION) {
    return fail('INVALID_SCHEMA_VERSION');
  }
  if (
    record.use !== MAINNET_PROVIDER_POSITION_OBSERVATION_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    typeof record.snapshotId !== 'string' ||
    !SAFE_SNAPSHOT_ID.test(record.snapshotId) ||
    record.observationPolicyVersion !== observationPolicy.policyVersion ||
    record.observationPolicyId !== observationPolicy.policyId ||
    record.observationPolicyFingerprintSha256 !== observationPolicy.fingerprintSha256
  ) {
    return fail('INVALID_SNAPSHOT');
  }
  const snapshotId = record.snapshotId;
  const registry = registrySnapshot(
    record.assetRegistryVersion,
    record.assetRegistryFingerprintSha256,
  );
  if (
    observationPolicy.assetRegistryVersion !== registry.version ||
    observationPolicy.assetRegistryFingerprintSha256 !== registry.fingerprintSha256 ||
    chainAssessment.observationPolicyFingerprintSha256 !== observationPolicy.fingerprintSha256 ||
    chainAssessment.assetRegistryVersion !== registry.version ||
    chainAssessment.assetRegistryFingerprintSha256 !== registry.fingerprintSha256
  ) {
    return fail('INVALID_CHAIN_ASSESSMENT');
  }
  const capturedAt = timestamp(record.capturedAt, 'INVALID_SNAPSHOT');
  const staleAfter = timestamp(record.staleAfter, 'INVALID_FRESHNESS');
  if (capturedAt > evaluatedAt) return fail('INVALID_FRESHNESS');
  const values = dataArray(record.observations, MAX_OBSERVATIONS, 'INVALID_SNAPSHOT');
  if (values.length === 0) {
    // Until a coverage/completeness proof exists, [] cannot distinguish zero
    // positions from a failed or partial provider read.
    return fail('INVALID_SNAPSHOT');
  }
  if (staleAfter <= capturedAt) return fail('INVALID_FRESHNESS');
  const observations = values.map((observation) =>
    parseObservation(
      observation,
      snapshotId,
      registry,
      observationPolicy,
      chainAssessment,
      chainAssessmentInput,
      chainAssessmentVerifier,
      capturedAt,
      evaluatedAt,
    ),
  );

  const maximumSnapshotTtlMs = Math.min(
    ...observations.map((observation) => {
      const policy = chainObservationPolicyForNetwork(observation.asset.networkId);
      if (!policy || policy.environment !== 'MAINNET') return fail('INVALID_FRESHNESS');
      return policy.freshness.currentWithinMs;
    }),
  );
  if (Date.parse(staleAfter) - Date.parse(capturedAt) > maximumSnapshotTtlMs) {
    return fail('INVALID_FRESHNESS');
  }
  const effectiveStaleAfter = observations.reduce(
    (deadline, observation) =>
      observation.staleAfter < deadline ? observation.staleAfter : deadline,
    staleAfter,
  );

  const observationIds = new Set<string>();
  const positionKeys = new Set<string>();
  for (const observation of observations) {
    if (observationIds.has(observation.observationId)) return fail('DUPLICATE_OBSERVATION');
    observationIds.add(observation.observationId);
    const key = positionKey(observation);
    if (positionKeys.has(key)) return fail('DUPLICATE_POSITION');
    positionKeys.add(key);
  }
  if (
    chainAssessment.entries.length !== observations.length ||
    chainAssessment.entries.some((entry) => !observationIds.has(entry.observationId))
  ) {
    return fail('INVALID_CHAIN_ASSESSMENT');
  }
  observations.sort((left, right) => compareCanonical(positionKey(left), positionKey(right)));

  return Object.freeze({
    schemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
    mayAuthorizeFinancialAction: false,
    snapshotId,
    observationPolicyVersion: observationPolicy.policyVersion,
    observationPolicyId: observationPolicy.policyId,
    observationPolicyFingerprintSha256: observationPolicy.fingerprintSha256,
    assetRegistryVersion: registry.version,
    assetRegistryFingerprintSha256: registry.fingerprintSha256,
    capturedAt,
    staleAfter: effectiveStaleAfter,
    freshnessClass: freshness(record.freshnessClass, effectiveStaleAfter, evaluatedAt),
    observations: Object.freeze(observations) as readonly [
      MainnetProviderPositionObservationV1,
      ...MainnetProviderPositionObservationV1[],
    ],
  });
}
