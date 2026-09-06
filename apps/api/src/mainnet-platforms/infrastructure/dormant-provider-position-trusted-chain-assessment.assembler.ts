import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  chainObservationPolicyForNetwork,
  observationTierRule,
} from '../../blockchain/domain/chain-observation-policy';
import { isMainnetLaunchNetwork } from '../../blockchain/domain/mainnet-launch-network-policy';
import {
  MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE,
  MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
  type MainnetProviderPositionAssessmentChainAnchorV1,
  type MainnetProviderPositionChainAssessmentV1,
  type MainnetProviderPositionChainAssessmentVerificationContextV1,
} from '../domain/mainnet-provider-position-chain-assessment';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_USE,
  MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
  mainnetProviderPositionObservationFingerprintV1,
  type MainnetProviderPositionObservationV1,
} from '../domain/mainnet-provider-position-observation';
import {
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE,
  type ProviderPositionDurableChainAnchorAssessmentV1,
  type ProviderPositionDurableChainAnchorNetworkId,
  type ProviderPositionDurableChainAnchorReaderPort,
  type ReadProviderPositionDurableChainAnchorRequestV1,
} from '../application/ports/provider-position-durable-chain-anchor-reader.port';
import {
  PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE,
  PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION,
  type AssembleProviderPositionTrustedChainAssessmentRequestV1,
  type ProviderPositionTrustedChainAssessmentAssemblyPort,
  type ProviderPositionTrustedChainAssessmentTargetSourceV1,
} from '../application/ports/provider-position-trusted-chain-assessment-assembly.port';

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_TARGETS = 512;
const MAX_OBSERVATIONS = 512;
const MAX_UINT256 = (1n << 256n) - 1n;
const UNISSUED_ANCHOR_CAPABILITY = Object.freeze(Object.create(null) as object);
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

const ASSEMBLY_REQUEST_KEYS = Object.freeze([
  'assemblyVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'accountId',
  'correlationId',
  'candidateFingerprintSha256',
  'coverageManifestFingerprintSha256',
  'evaluatedAt',
  'deadlineAt',
  'signal',
  'admissionCandidate',
  'positionSnapshot',
  'selectedTargetSources',
] as const);
const CANDIDATE_KEYS = Object.freeze([
  'admissionVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'mayCreatePositionSnapshot',
  'assemblyStatus',
  'accountId',
  'correlationId',
  'positionSnapshotId',
  'observationPolicyVersion',
  'observationPolicyId',
  'observationPolicyFingerprintSha256',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'capturedAt',
  'staleAfter',
  'freshnessClass',
  'targets',
  'coverageManifest',
  'candidateFingerprintSha256',
] as const);
const COVERAGE_MANIFEST_KEYS = Object.freeze([
  'coverageVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'manifestId',
  'accountId',
  'positionSnapshotId',
  'observationPolicyVersion',
  'observationPolicyId',
  'observationPolicyFingerprintSha256',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'capturedAt',
  'staleAfter',
  'freshnessClass',
  'targets',
  'fingerprintSha256',
] as const);
const COVERAGE_TARGET_KEYS = Object.freeze([
  'walletId',
  'providerId',
  'protocolId',
  'marketId',
  'networkId',
  'assets',
  'sourceIds',
  'status',
  'divergenceStatus',
  'positionCount',
  'observedAt',
  'staleAfter',
] as const);
const SNAPSHOT_KEYS = Object.freeze([
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
] as const);
const TARGET_KEYS = Object.freeze([
  'targetId',
  'walletId',
  'providerId',
  'protocolId',
  'marketId',
  'networkId',
  'assets',
  'status',
  'divergenceStatus',
  'observedAt',
  'staleAfter',
  'positions',
  'acceptedSources',
] as const);
const SELECTED_TARGET_KEYS = Object.freeze([
  'targetId',
  'walletId',
  'providerId',
  'protocolId',
  'marketId',
  'networkId',
  'source',
] as const);
const ACCEPTED_SOURCE_KEYS = Object.freeze([
  'sourceFamilyId',
  'sourceId',
  'sourceKind',
  'sourceObservationId',
  'observedAt',
  'staleAfter',
  'continuityFloor',
  'chainAnchor',
  'positionSetFingerprintSha256',
] as const);
const OBSERVATION_KEYS = Object.freeze([
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
] as const);
const OBSERVATION_ASSET_KEYS = Object.freeze([
  'stablecoin',
  'networkId',
  'identity',
  'decimals',
] as const);
const OBSERVATION_BALANCE_KEYS = Object.freeze(['atomic', 'decimal'] as const);
const OBSERVATION_SOURCE_KEYS = Object.freeze([
  'sourceId',
  'sourceKind',
  'sourceObservationId',
  'chainAnchor',
] as const);
const POSITION_KEYS = Object.freeze(['positionId', 'positionKind', 'asset', 'balance'] as const);
const ANCHOR_ASSESSMENT_KEYS = Object.freeze([
  'readerVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'networkId',
  'continuityFloor',
  'chainAnchor',
  'assessedAt',
  'identityStatus',
  'progressionStatus',
  'finalityStatus',
] as const);
const VERIFICATION_CONTEXT_KEYS = Object.freeze([
  'positionSchemaVersion',
  'snapshotId',
  'assessmentVersion',
  'assessmentId',
  'observationPolicyFingerprintSha256',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'observationId',
  'observationFingerprintSha256',
  'walletId',
  'providerId',
  'protocolId',
  'marketId',
  'positionId',
  'positionKind',
  'stablecoin',
  'assetIdentity',
  'assetDecimals',
  'balanceAtomic',
  'balanceDecimal',
  'sourceId',
  'sourceKind',
  'sourceObservationId',
  'networkId',
  'observationTier',
  'selector',
  'authority',
  'chainAnchor',
  'observedAt',
  'staleAfter',
  'freshnessClass',
  'assessedAt',
  'capturedAt',
  'evaluatedAt',
  'identityStatus',
  'progressionStatus',
  'finalityStatus',
  'mayAuthorizeFinancialAction',
] as const);

export const DORMANT_PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLER_VERSION = 1 as const;

export class DormantProviderPositionTrustedChainAssessmentUnavailableError extends Error {
  readonly code = 'DORMANT_PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_UNAVAILABLE' as const;

  constructor() {
    super('Provider-position trusted chain assessment is unavailable.');
    this.name = 'DormantProviderPositionTrustedChainAssessmentUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

interface CapturedAnchorReader {
  readonly receiver: ProviderPositionDurableChainAnchorReaderPort;
  readonly readAnchor: ProviderPositionDurableChainAnchorReaderPort['readAnchor'];
  readonly verifyAnchor: ProviderPositionDurableChainAnchorReaderPort['verifyAnchor'];
}

interface ReviewedAssemblyRequest {
  readonly request: AssembleProviderPositionTrustedChainAssessmentRequestV1;
  readonly evaluatedAt: string;
  readonly evaluatedAtMilliseconds: number;
  readonly deadlineAt: string;
  readonly deadlineAtMilliseconds: number;
  readonly capturedAt: string;
  readonly capturedAtMilliseconds: number;
  readonly selections: readonly ProviderPositionTrustedChainAssessmentTargetSourceV1[];
  readonly observations: readonly MainnetProviderPositionObservationV1[];
}

interface TargetAssessment {
  readonly selection: ProviderPositionTrustedChainAssessmentTargetSourceV1;
  readonly anchorRequest: ReadProviderPositionDurableChainAnchorRequestV1;
  readonly assessment: ProviderPositionDurableChainAnchorAssessmentV1;
}

interface IssuedAssessmentSeal {
  readonly request: AssembleProviderPositionTrustedChainAssessmentRequestV1;
  readonly contexts: readonly MainnetProviderPositionChainAssessmentVerificationContextV1[];
}

function fail(): never {
  throw new DormantProviderPositionTrustedChainAssessmentUnavailableError();
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function exactFrozenRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      !Object.isFrozen(value)
    ) {
      return fail();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail();
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof DormantProviderPositionTrustedChainAssessmentUnavailableError) throw error;
    return fail();
  }
}

function exactFrozenArray(value: unknown, maximum: number): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isFrozen(value)
    ) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const length = descriptors['length']?.value;
    if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > maximum) {
      return fail();
    }
    const indices = Array.from({ length: length as number }, (_, index) => String(index));
    const expected = [...indices, 'length'];
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== expected.length ||
      actual.some((key) => typeof key !== 'string' || !expected.includes(key))
    ) {
      return fail();
    }
    return Object.freeze(
      indices.map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
        return descriptor.value;
      }),
    );
  } catch (error) {
    if (error instanceof DormantProviderPositionTrustedChainAssessmentUnavailableError) throw error;
    return fail();
  }
}

function canonicalTimestamp(value: unknown): Readonly<{ value: string; milliseconds: number }> {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail();
  }
  return Object.freeze({ value, milliseconds });
}

function abortSignal(value: unknown): AbortSignal {
  try {
    if (
      ABORTED_GETTER === undefined ||
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype
    ) {
      return fail();
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch (error) {
    if (error instanceof DormantProviderPositionTrustedChainAssessmentUnavailableError) throw error;
    return fail();
  }
}

function isAborted(signal: AbortSignal): boolean {
  try {
    if (ABORTED_GETTER === undefined) return fail();
    return Reflect.apply(ABORTED_GETTER, signal, []) as boolean;
  } catch (error) {
    if (error instanceof DormantProviderPositionTrustedChainAssessmentUnavailableError) throw error;
    return fail();
  }
}

function stableDataMember(value: object, key: PropertyKey): unknown {
  let current: object | null = value;
  for (let depth = 0; current !== null && depth < 8; depth += 1) {
    if (isProxy(current)) return fail();
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      if (!('value' in descriptor)) return fail();
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return fail();
}

function captureAnchorReader(
  value: ProviderPositionDurableChainAnchorReaderPort,
): CapturedAnchorReader {
  try {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return fail();
    const readerVersion = stableDataMember(value, 'readerVersion');
    const readAnchor = stableDataMember(value, 'readAnchor');
    const verifyAnchor = stableDataMember(value, 'verifyAnchor');
    if (
      readerVersion !== PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION ||
      typeof readAnchor !== 'function' ||
      isProxy(readAnchor) ||
      typeof verifyAnchor !== 'function' ||
      isProxy(verifyAnchor)
    ) {
      return fail();
    }
    return Object.freeze({
      receiver: value,
      readAnchor: readAnchor as ProviderPositionDurableChainAnchorReaderPort['readAnchor'],
      verifyAnchor: verifyAnchor as ProviderPositionDurableChainAnchorReaderPort['verifyAnchor'],
    });
  } catch (error) {
    if (error instanceof DormantProviderPositionTrustedChainAssessmentUnavailableError) throw error;
    return fail();
  }
}

function normalizeAnchor(
  value: unknown,
  networkId: string,
): MainnetProviderPositionAssessmentChainAnchorV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return fail();
  }
  const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
  if (kind === 'EVM_BLOCK' && networkId === 'eip155:1') {
    const record = exactFrozenRecord(value, ['kind', 'blockNumber', 'blockHash']);
    if (
      typeof record.blockNumber !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,77})$/u.test(record.blockNumber) ||
      BigInt(record.blockNumber) > MAX_UINT256 ||
      typeof record.blockHash !== 'string' ||
      !/^0x[0-9a-f]{64}$/u.test(record.blockHash) ||
      /^0x0{64}$/u.test(record.blockHash)
    ) {
      return fail();
    }
    return Object.freeze({
      kind: 'EVM_BLOCK',
      blockNumber: record.blockNumber,
      blockHash: record.blockHash,
    });
  }
  if (kind === 'SOLANA_SLOT' && networkId === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') {
    const record = exactFrozenRecord(value, ['kind', 'slot', 'root']);
    if (
      typeof record.slot !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,19})$/u.test(record.slot) ||
      typeof record.root !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,19})$/u.test(record.root) ||
      BigInt(record.slot) > (1n << 64n) - 1n ||
      BigInt(record.root) > BigInt(record.slot)
    ) {
      return fail();
    }
    return Object.freeze({ kind: 'SOLANA_SLOT', slot: record.slot, root: record.root });
  }
  return fail();
}

function sameAnchor(
  left: MainnetProviderPositionAssessmentChainAnchorV1,
  right: MainnetProviderPositionAssessmentChainAnchorV1,
): boolean {
  return left.kind === 'EVM_BLOCK' && right.kind === 'EVM_BLOCK'
    ? left.blockNumber === right.blockNumber && left.blockHash === right.blockHash
    : left.kind === 'SOLANA_SLOT' && right.kind === 'SOLANA_SLOT'
      ? left.slot === right.slot && left.root === right.root
      : false;
}

function nonRegressing(
  floor: MainnetProviderPositionAssessmentChainAnchorV1,
  anchor: MainnetProviderPositionAssessmentChainAnchorV1,
): boolean {
  if (floor.kind === 'EVM_BLOCK' && anchor.kind === 'EVM_BLOCK') {
    return (
      BigInt(anchor.blockNumber) > BigInt(floor.blockNumber) ||
      (anchor.blockNumber === floor.blockNumber && anchor.blockHash === floor.blockHash)
    );
  }
  return (
    floor.kind === 'SOLANA_SLOT' &&
    anchor.kind === 'SOLANA_SLOT' &&
    BigInt(anchor.slot) >= BigInt(floor.slot) &&
    BigInt(anchor.root) >= BigInt(floor.root)
  );
}

function reviewAssemblyRequest(
  requestInput: AssembleProviderPositionTrustedChainAssessmentRequestV1,
): ReviewedAssemblyRequest {
  const record = exactFrozenRecord(requestInput, ASSEMBLY_REQUEST_KEYS);
  const candidate = exactFrozenRecord(record.admissionCandidate, CANDIDATE_KEYS);
  const coverageManifest = exactFrozenRecord(candidate.coverageManifest, COVERAGE_MANIFEST_KEYS);
  const snapshot = exactFrozenRecord(record.positionSnapshot, SNAPSHOT_KEYS);
  const selectionsInput = exactFrozenArray(record.selectedTargetSources, MAX_TARGETS);
  const targetsInput = exactFrozenArray(candidate.targets, MAX_TARGETS);
  const coverageTargetsInput = exactFrozenArray(coverageManifest.targets, MAX_TARGETS);
  const observationsInput = exactFrozenArray(snapshot.observations, MAX_OBSERVATIONS);
  let accountId: ReturnType<typeof parseAccountId>;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail();
  }
  const evaluatedAt = canonicalTimestamp(record.evaluatedAt);
  const deadlineAt = canonicalTimestamp(record.deadlineAt);
  const capturedAt = canonicalTimestamp(snapshot.capturedAt);
  const signal = abortSignal(record.signal);
  if (
    record.assemblyVersion !== PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION ||
    record.use !== PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    candidate.admissionVersion !== 1 ||
    candidate.use !== 'DORMANT_PROVIDER_POSITION_ASSEMBLY_CANDIDATE_ONLY' ||
    candidate.mayAuthorizeFinancialAction !== false ||
    candidate.mayPersist !== false ||
    candidate.mayCreatePositionSnapshot !== false ||
    candidate.assemblyStatus !== 'BLOCKED_PENDING_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY' ||
    candidate.accountId !== accountId ||
    candidate.correlationId !== record.correlationId ||
    candidate.candidateFingerprintSha256 !== record.candidateFingerprintSha256 ||
    typeof record.candidateFingerprintSha256 !== 'string' ||
    !SHA256.test(record.candidateFingerprintSha256) ||
    typeof record.coverageManifestFingerprintSha256 !== 'string' ||
    !SHA256.test(record.coverageManifestFingerprintSha256) ||
    coverageManifest.fingerprintSha256 !== record.coverageManifestFingerprintSha256 ||
    typeof record.correlationId !== 'string' ||
    !CORRELATION_ID.test(record.correlationId) ||
    snapshot.schemaVersion !== MAINNET_PROVIDER_POSITION_SCHEMA_VERSION ||
    snapshot.use !== MAINNET_PROVIDER_POSITION_OBSERVATION_USE ||
    snapshot.mayAuthorizeFinancialAction !== false ||
    snapshot.snapshotId !== candidate.positionSnapshotId ||
    snapshot.observationPolicyVersion !== candidate.observationPolicyVersion ||
    snapshot.observationPolicyId !== candidate.observationPolicyId ||
    snapshot.observationPolicyFingerprintSha256 !== candidate.observationPolicyFingerprintSha256 ||
    snapshot.assetRegistryVersion !== candidate.assetRegistryVersion ||
    snapshot.assetRegistryFingerprintSha256 !== candidate.assetRegistryFingerprintSha256 ||
    snapshot.capturedAt !== candidate.capturedAt ||
    snapshot.staleAfter !== candidate.staleAfter ||
    snapshot.freshnessClass !== 'CURRENT' ||
    candidate.freshnessClass !== 'CURRENT' ||
    coverageManifest.coverageVersion !== 1 ||
    coverageManifest.use !== 'MAINNET_PROVIDER_POSITION_COVERAGE_ONLY' ||
    coverageManifest.mayAuthorizeFinancialAction !== false ||
    coverageManifest.accountId !== accountId ||
    coverageManifest.positionSnapshotId !== snapshot.snapshotId ||
    coverageManifest.observationPolicyVersion !== snapshot.observationPolicyVersion ||
    coverageManifest.observationPolicyId !== snapshot.observationPolicyId ||
    coverageManifest.observationPolicyFingerprintSha256 !==
      snapshot.observationPolicyFingerprintSha256 ||
    coverageManifest.assetRegistryVersion !== snapshot.assetRegistryVersion ||
    coverageManifest.assetRegistryFingerprintSha256 !== snapshot.assetRegistryFingerprintSha256 ||
    coverageManifest.capturedAt !== snapshot.capturedAt ||
    coverageManifest.staleAfter !== snapshot.staleAfter ||
    coverageManifest.freshnessClass !== 'CURRENT' ||
    capturedAt.milliseconds > evaluatedAt.milliseconds ||
    evaluatedAt.milliseconds >= deadlineAt.milliseconds ||
    isAborted(signal) ||
    selectionsInput.length !== targetsInput.length ||
    coverageTargetsInput.length !== targetsInput.length
  ) {
    return fail();
  }

  const targetsById = new Map<string, Record<string, unknown>>();
  for (const targetInput of targetsInput) {
    const target = exactFrozenRecord(targetInput, TARGET_KEYS);
    const targetPositions = exactFrozenArray(target.positions, MAX_OBSERVATIONS);
    const targetSources = exactFrozenArray(target.acceptedSources, MAX_TARGETS);
    exactFrozenArray(target.assets, 64);
    if (
      typeof target.targetId !== 'string' ||
      targetsById.has(target.targetId) ||
      typeof target.walletId !== 'string' ||
      typeof target.providerId !== 'string' ||
      typeof target.protocolId !== 'string' ||
      typeof target.marketId !== 'string' ||
      target.status !== 'COMPLETE' ||
      target.divergenceStatus !== 'AGREED' ||
      targetSources.length < 1 ||
      targetPositions.length > MAX_OBSERVATIONS ||
      !isMainnetLaunchNetwork(target.networkId as string)
    ) {
      return fail();
    }
    targetsById.set(target.targetId, target);
    canonicalTimestamp(target.observedAt);
    canonicalTimestamp(target.staleAfter);
  }

  const coveredTargetIds = new Set<string>();
  for (const coverageTargetInput of coverageTargetsInput) {
    const coverageTarget = exactFrozenRecord(coverageTargetInput, COVERAGE_TARGET_KEYS);
    exactFrozenArray(coverageTarget.assets, 64);
    exactFrozenArray(coverageTarget.sourceIds, MAX_TARGETS);
    const target = [...targetsById.values()].find(
      (candidateTarget) =>
        candidateTarget.walletId === coverageTarget.walletId &&
        candidateTarget.providerId === coverageTarget.providerId &&
        candidateTarget.protocolId === coverageTarget.protocolId &&
        candidateTarget.marketId === coverageTarget.marketId &&
        candidateTarget.networkId === coverageTarget.networkId,
    );
    if (
      target === undefined ||
      coveredTargetIds.has(target.targetId as string) ||
      coverageTarget.status !== target.status ||
      coverageTarget.divergenceStatus !== target.divergenceStatus ||
      coverageTarget.observedAt !== target.observedAt ||
      coverageTarget.staleAfter !== target.staleAfter ||
      coverageTarget.positionCount !== exactFrozenArray(target.positions, MAX_OBSERVATIONS).length
    ) {
      return fail();
    }
    coveredTargetIds.add(target.targetId as string);
  }
  if (coveredTargetIds.size !== targetsById.size) return fail();

  const selections: ProviderPositionTrustedChainAssessmentTargetSourceV1[] = [];
  const selectionIds = new Set<string>();
  for (const selectionInput of selectionsInput) {
    const selection = exactFrozenRecord(selectionInput, SELECTED_TARGET_KEYS);
    const target = targetsById.get(selection.targetId as string);
    if (
      target === undefined ||
      selectionIds.has(selection.targetId as string) ||
      selection.walletId !== target.walletId ||
      selection.providerId !== target.providerId ||
      selection.protocolId !== target.protocolId ||
      selection.marketId !== target.marketId ||
      selection.networkId !== target.networkId
    ) {
      return fail();
    }
    const acceptedSources = exactFrozenArray(target.acceptedSources, MAX_TARGETS);
    const acceptedSource = acceptedSources[0];
    const source = exactFrozenRecord(selection.source, ACCEPTED_SOURCE_KEYS);
    if (
      acceptedSource !== selection.source ||
      source.observedAt !== target.observedAt ||
      source.staleAfter !== target.staleAfter ||
      typeof source.sourceFamilyId !== 'string' ||
      typeof source.sourceId !== 'string' ||
      (source.sourceKind !== 'RPC' &&
        source.sourceKind !== 'INDEXER' &&
        source.sourceKind !== 'PROVIDER_API') ||
      typeof source.sourceObservationId !== 'string'
    ) {
      return fail();
    }
    normalizeAnchor(source.continuityFloor, selection.networkId as string);
    normalizeAnchor(source.chainAnchor, selection.networkId as string);
    canonicalTimestamp(source.observedAt);
    canonicalTimestamp(source.staleAfter);
    selectionIds.add(selection.targetId as string);
    selections.push(selectionInput as ProviderPositionTrustedChainAssessmentTargetSourceV1);
  }
  if (selectionIds.size !== targetsById.size) return fail();

  const observations: MainnetProviderPositionObservationV1[] = [];
  const observationIds = new Set<string>();
  for (const observationInput of observationsInput) {
    const observation = exactFrozenRecord(observationInput, OBSERVATION_KEYS);
    const asset = exactFrozenRecord(observation.asset, OBSERVATION_ASSET_KEYS);
    const balance = exactFrozenRecord(observation.balance, OBSERVATION_BALANCE_KEYS);
    const source = exactFrozenRecord(observation.source, OBSERVATION_SOURCE_KEYS);
    if (typeof asset.networkId !== 'string' || !isMainnetLaunchNetwork(asset.networkId)) {
      return fail();
    }
    const observationAnchor = normalizeAnchor(source.chainAnchor, asset.networkId);
    if (
      typeof observation.observationId !== 'string' ||
      observationIds.has(observation.observationId) ||
      typeof observation.walletId !== 'string' ||
      typeof observation.providerId !== 'string' ||
      typeof observation.protocolId !== 'string' ||
      typeof observation.marketId !== 'string' ||
      typeof observation.positionId !== 'string' ||
      (observation.positionKind !== 'SUPPLY' && observation.positionKind !== 'BORROW') ||
      observation.freshnessClass !== 'CURRENT' ||
      typeof asset.stablecoin !== 'string' ||
      typeof asset.identity !== 'string' ||
      !Number.isSafeInteger(asset.decimals) ||
      typeof balance.atomic !== 'string' ||
      typeof balance.decimal !== 'string' ||
      typeof source.sourceId !== 'string' ||
      (source.sourceKind !== 'RPC' &&
        source.sourceKind !== 'INDEXER' &&
        source.sourceKind !== 'PROVIDER_API') ||
      typeof source.sourceObservationId !== 'string' ||
      typeof observation.observedAt !== 'string' ||
      typeof observation.staleAfter !== 'string'
    ) {
      return fail();
    }
    canonicalTimestamp(observation.observedAt);
    canonicalTimestamp(observation.staleAfter);
    const matchingSelection = selections.find(
      (selection) =>
        selection.walletId === observation.walletId &&
        selection.providerId === observation.providerId &&
        selection.protocolId === observation.protocolId &&
        selection.marketId === observation.marketId &&
        selection.networkId === asset.networkId &&
        selection.source.sourceId === source.sourceId &&
        selection.source.sourceKind === source.sourceKind &&
        selection.source.sourceObservationId === source.sourceObservationId,
    );
    if (
      matchingSelection === undefined ||
      !sameAnchor(observationAnchor, matchingSelection.source.chainAnchor) ||
      observation.observedAt !== matchingSelection.source.observedAt
    ) {
      return fail();
    }
    const target = targetsById.get(matchingSelection.targetId);
    const positions = exactFrozenArray(target?.positions, MAX_OBSERVATIONS);
    const matchingPosition = positions.some((positionInput) => {
      const position = exactFrozenRecord(positionInput, POSITION_KEYS);
      return (
        position.positionId === observation.positionId &&
        position.positionKind === observation.positionKind &&
        position.asset === observation.asset &&
        position.balance === observation.balance
      );
    });
    if (!matchingPosition) return fail();
    observationIds.add(observation.observationId);
    observations.push(observationInput as MainnetProviderPositionObservationV1);
  }

  return Object.freeze({
    request: requestInput,
    evaluatedAt: evaluatedAt.value,
    evaluatedAtMilliseconds: evaluatedAt.milliseconds,
    deadlineAt: deadlineAt.value,
    deadlineAtMilliseconds: deadlineAt.milliseconds,
    capturedAt: capturedAt.value,
    capturedAtMilliseconds: capturedAt.milliseconds,
    selections: Object.freeze(selections),
    observations: Object.freeze(observations),
  });
}

function anchorRequest(
  reviewed: ReviewedAssemblyRequest,
  selection: ProviderPositionTrustedChainAssessmentTargetSourceV1,
): ReadProviderPositionDurableChainAnchorRequestV1 {
  return frozenNullPrototype({
    readerVersion: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
    use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    accountId: reviewed.request.accountId,
    correlationId: reviewed.request.correlationId,
    candidateFingerprintSha256: reviewed.request.candidateFingerprintSha256,
    targetId: selection.targetId,
    walletId: selection.walletId,
    providerId: selection.providerId,
    protocolId: selection.protocolId,
    marketId: selection.marketId,
    networkId: selection.networkId as ProviderPositionDurableChainAnchorNetworkId,
    sourceFamilyId: selection.source.sourceFamilyId,
    sourceId: selection.source.sourceId,
    sourceKind: selection.source.sourceKind,
    sourceObservationId: selection.source.sourceObservationId,
    continuityFloor: selection.source.continuityFloor,
    chainAnchor: selection.source.chainAnchor,
    observedAt: selection.source.observedAt,
    capturedAt: reviewed.capturedAt,
    evaluatedAt: reviewed.evaluatedAt,
    deadlineAt: reviewed.deadlineAt,
    signal: reviewed.request.signal,
  });
}

function reviewAnchorAssessment(
  value: unknown,
  request: ReadProviderPositionDurableChainAnchorRequestV1,
  reviewed: ReviewedAssemblyRequest,
): ProviderPositionDurableChainAnchorAssessmentV1 {
  const record = exactFrozenRecord(value, ANCHOR_ASSESSMENT_KEYS);
  const networkId = record.networkId;
  if (typeof networkId !== 'string' || !isMainnetLaunchNetwork(networkId)) return fail();
  const continuityFloor = normalizeAnchor(record.continuityFloor, networkId);
  const chainAnchor = normalizeAnchor(record.chainAnchor, networkId);
  const assessedAt = canonicalTimestamp(record.assessedAt);
  const expectedFloor = normalizeAnchor(request.continuityFloor, request.networkId);
  const expectedAnchor = normalizeAnchor(request.chainAnchor, request.networkId);
  const policy = chainObservationPolicyForNetwork(request.networkId);
  if (
    record.readerVersion !== PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION ||
    record.use !== PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    networkId !== request.networkId ||
    !sameAnchor(continuityFloor, expectedFloor) ||
    !sameAnchor(chainAnchor, expectedAnchor) ||
    !nonRegressing(continuityFloor, chainAnchor) ||
    record.identityStatus !== 'VERIFIED' ||
    record.progressionStatus !== 'CURRENT' ||
    record.finalityStatus !== 'HEALTHY' ||
    policy?.environment !== 'MAINNET' ||
    assessedAt.milliseconds < Date.parse(request.observedAt) ||
    assessedAt.milliseconds > reviewed.capturedAtMilliseconds ||
    reviewed.evaluatedAtMilliseconds >=
      assessedAt.milliseconds + policy.freshness.currentWithinMs ||
    assessedAt.milliseconds >= reviewed.deadlineAtMilliseconds
  ) {
    return fail();
  }
  return Object.freeze({
    readerVersion: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
    use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId: request.networkId,
    continuityFloor,
    chainAnchor,
    assessedAt: assessedAt.value,
    identityStatus: 'VERIFIED',
    progressionStatus: 'CURRENT',
    finalityStatus: 'HEALTHY',
  });
}

function assessmentId(
  request: AssembleProviderPositionTrustedChainAssessmentRequestV1,
  assessments: readonly TargetAssessment[],
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        'crypto-lending:dormant-provider-position-trusted-chain-assessment:v1',
        request.accountId,
        request.correlationId,
        request.candidateFingerprintSha256,
        request.coverageManifestFingerprintSha256,
        request.evaluatedAt,
        assessments.map(({ anchorRequest: item, assessment }) => [
          item.targetId,
          item.sourceFamilyId,
          item.sourceId,
          item.sourceKind,
          item.sourceObservationId,
          item.networkId,
          assessment.assessedAt,
        ]),
      ]),
      'utf8',
    )
    .digest('hex');
  return `trusted-chain-assessment:${digest}`;
}

function effectiveStaleAfter(
  observation: MainnetProviderPositionObservationV1,
  assessedAt: string,
): string {
  const policy = chainObservationPolicyForNetwork(observation.asset.networkId);
  if (policy?.environment !== 'MAINNET') return fail();
  const milliseconds = Math.min(
    Date.parse(observation.staleAfter),
    Date.parse(observation.observedAt) + policy.freshness.currentWithinMs,
    Date.parse(assessedAt) + policy.freshness.currentWithinMs,
  );
  return new Date(milliseconds).toISOString();
}

function verificationContext(
  reviewed: ReviewedAssemblyRequest,
  assessment: MainnetProviderPositionChainAssessmentV1,
  observation: MainnetProviderPositionObservationV1,
  targetAssessment: TargetAssessment,
): MainnetProviderPositionChainAssessmentVerificationContextV1 {
  const rule = observationTierRule(observation.asset.networkId, 'PROVISIONAL');
  if (
    rule?.state !== 'ALLOWED' ||
    rule.authority !== 'DISPLAY_ONLY' ||
    (rule.selector !== 'latest' && rule.selector !== 'confirmed')
  ) {
    return fail();
  }
  const staleAfter = effectiveStaleAfter(observation, targetAssessment.assessment.assessedAt);
  if (reviewed.evaluatedAt >= staleAfter) return fail();
  const fingerprint = mainnetProviderPositionObservationFingerprintV1({
    snapshotId: reviewed.request.positionSnapshot.snapshotId,
    observationPolicyFingerprintSha256:
      reviewed.request.positionSnapshot.observationPolicyFingerprintSha256,
    assetRegistryVersion: reviewed.request.positionSnapshot.assetRegistryVersion,
    assetRegistryFingerprintSha256:
      reviewed.request.positionSnapshot.assetRegistryFingerprintSha256,
    observationId: observation.observationId,
    walletId: observation.walletId,
    providerId: observation.providerId,
    protocolId: observation.protocolId,
    marketId: observation.marketId,
    positionId: observation.positionId,
    positionKind: observation.positionKind,
    asset: observation.asset,
    balance: observation.balance,
    source: observation.source,
    observedAt: observation.observedAt,
    staleAfter,
    freshnessClass: 'CURRENT',
    capturedAt: reviewed.capturedAt,
  });
  return Object.freeze({
    positionSchemaVersion: MAINNET_PROVIDER_POSITION_SCHEMA_VERSION,
    snapshotId: reviewed.request.positionSnapshot.snapshotId,
    assessmentVersion: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
    assessmentId: assessment.assessmentId,
    observationPolicyFingerprintSha256: assessment.observationPolicyFingerprintSha256,
    assetRegistryVersion: assessment.assetRegistryVersion,
    assetRegistryFingerprintSha256: assessment.assetRegistryFingerprintSha256,
    observationId: observation.observationId,
    observationFingerprintSha256: fingerprint,
    walletId: observation.walletId,
    providerId: observation.providerId,
    protocolId: observation.protocolId,
    marketId: observation.marketId,
    positionId: observation.positionId,
    positionKind: observation.positionKind,
    stablecoin: observation.asset.stablecoin,
    assetIdentity: observation.asset.identity,
    assetDecimals: observation.asset.decimals,
    balanceAtomic: observation.balance.atomic,
    balanceDecimal: observation.balance.decimal,
    sourceId: observation.source.sourceId,
    sourceKind: observation.source.sourceKind,
    sourceObservationId: observation.source.sourceObservationId,
    networkId: observation.asset.networkId,
    observationTier: 'PROVISIONAL',
    selector: rule.selector,
    authority: 'DISPLAY_ONLY',
    chainAnchor: observation.source.chainAnchor,
    observedAt: observation.observedAt,
    staleAfter,
    freshnessClass: 'CURRENT',
    assessedAt: targetAssessment.assessment.assessedAt,
    capturedAt: reviewed.capturedAt,
    evaluatedAt: reviewed.evaluatedAt,
    identityStatus: 'VERIFIED',
    progressionStatus: 'CURRENT',
    finalityStatus: 'HEALTHY',
    mayAuthorizeFinancialAction: false,
  });
}

function sameVerificationContext(
  value: unknown,
  expected: MainnetProviderPositionChainAssessmentVerificationContextV1,
): boolean {
  try {
    const record = exactFrozenRecord(value, VERIFICATION_CONTEXT_KEYS);
    const anchor = normalizeAnchor(record.chainAnchor, expected.networkId);
    return VERIFICATION_CONTEXT_KEYS.every((key) =>
      key === 'chainAnchor'
        ? sameAnchor(anchor, expected.chainAnchor)
        : Object.is(record[key], expected[key]),
    );
  } catch {
    return false;
  }
}

/**
 * Dormant in-process assembler. It performs no registration or I/O of its own;
 * all reads are sequential calls through the injected durable-anchor port.
 */
export class DormantProviderPositionTrustedChainAssessmentAssembler implements ProviderPositionTrustedChainAssessmentAssemblyPort {
  readonly assemblyVersion = PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION;
  private readonly reader: CapturedAnchorReader;
  private readonly issued = new WeakMap<object, IssuedAssessmentSeal>();

  constructor(reader: ProviderPositionDurableChainAnchorReaderPort) {
    this.reader = captureAnchorReader(reader);
  }

  async assemble(
    requestInput: AssembleProviderPositionTrustedChainAssessmentRequestV1,
  ): Promise<unknown> {
    try {
      const reviewed = reviewAssemblyRequest(requestInput);
      const targetAssessments: TargetAssessment[] = [];
      for (const selection of reviewed.selections) {
        if (isAborted(reviewed.request.signal)) return fail();
        const request = anchorRequest(reviewed, selection);
        if (
          Reflect.apply(this.reader.verifyAnchor, this.reader.receiver, [
            UNISSUED_ANCHOR_CAPABILITY,
            request,
          ]) !== false
        ) {
          return fail();
        }
        const capability = await Reflect.apply(this.reader.readAnchor, this.reader.receiver, [
          request,
        ]);
        if (isAborted(reviewed.request.signal)) return fail();
        const requestClone = Object.freeze({ ...request });
        if (
          Reflect.apply(this.reader.verifyAnchor, this.reader.receiver, [capability, request]) !==
            true ||
          Reflect.apply(this.reader.verifyAnchor, this.reader.receiver, [
            capability,
            requestClone,
          ]) !== false
        ) {
          return fail();
        }
        const assessment = reviewAnchorAssessment(capability, request, reviewed);
        if (
          Reflect.apply(this.reader.verifyAnchor, this.reader.receiver, [assessment, request]) !==
          false
        ) {
          return fail();
        }
        targetAssessments.push(Object.freeze({ selection, anchorRequest: request, assessment }));
      }
      if (isAborted(reviewed.request.signal)) return fail();

      const id = assessmentId(reviewed.request, targetAssessments);
      const entries = reviewed.observations.map((observation) => {
        const targetAssessment = targetAssessments.find(
          ({ selection }) =>
            selection.walletId === observation.walletId &&
            selection.providerId === observation.providerId &&
            selection.protocolId === observation.protocolId &&
            selection.marketId === observation.marketId &&
            selection.networkId === observation.asset.networkId &&
            selection.source.sourceId === observation.source.sourceId &&
            selection.source.sourceKind === observation.source.sourceKind &&
            selection.source.sourceObservationId === observation.source.sourceObservationId,
        );
        if (targetAssessment === undefined) return fail();
        return Object.freeze({
          observationId: observation.observationId,
          sourceId: observation.source.sourceId,
          sourceKind: observation.source.sourceKind,
          sourceObservationId: observation.source.sourceObservationId,
          networkId: observation.asset.networkId,
          chainAnchor: observation.source.chainAnchor,
          assessedAt: targetAssessment.assessment.assessedAt,
          identityStatus: 'VERIFIED' as const,
          progressionStatus: 'CURRENT' as const,
          finalityStatus: 'HEALTHY' as const,
        });
      });
      const assessment = Object.freeze({
        assessmentVersion: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
        use: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE,
        mayAuthorizeFinancialAction: false as const,
        assessmentId: id,
        observationPolicyFingerprintSha256:
          reviewed.request.positionSnapshot.observationPolicyFingerprintSha256,
        assetRegistryVersion: reviewed.request.positionSnapshot.assetRegistryVersion,
        assetRegistryFingerprintSha256:
          reviewed.request.positionSnapshot.assetRegistryFingerprintSha256,
        entries: Object.freeze(entries),
      });
      const contexts = reviewed.observations.map((observation) => {
        const targetAssessment = targetAssessments.find(
          ({ selection }) =>
            selection.walletId === observation.walletId &&
            selection.providerId === observation.providerId &&
            selection.protocolId === observation.protocolId &&
            selection.marketId === observation.marketId &&
            selection.networkId === observation.asset.networkId,
        );
        if (targetAssessment === undefined) return fail();
        return verificationContext(reviewed, assessment, observation, targetAssessment);
      });
      this.issued.set(
        assessment,
        Object.freeze({ request: reviewed.request, contexts: Object.freeze(contexts) }),
      );
      return assessment;
    } catch {
      return fail();
    }
  }

  verifyAssembly(
    capability: unknown,
    request: AssembleProviderPositionTrustedChainAssessmentRequestV1,
  ): boolean {
    if (typeof capability !== 'object' || capability === null) return false;
    return this.issued.get(capability)?.request === request;
  }

  verify(
    capability: unknown,
    context: MainnetProviderPositionChainAssessmentVerificationContextV1,
  ): boolean {
    if (typeof capability !== 'object' || capability === null) return false;
    const seal = this.issued.get(capability);
    if (seal === undefined) return false;
    return seal.contexts.some((expected) => sameVerificationContext(context, expected));
  }
}
