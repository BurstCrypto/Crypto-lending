import { createHash } from 'node:crypto';

import type {
  AaveV3EthereumCheckpointRecoveryAuthorization,
  AaveV3EthereumFinalizedCheckpointQuarantineReason,
  AaveV3EthereumHistoricalDeploymentObservation,
  RecoverAaveV3EthereumFinalizedCheckpointRequest,
} from '../application/ports/aave-v3-ethereum-finalized-checkpoint.port';
import type {
  AaveV3EthereumFinalizedBlockEvidence,
  AaveV3EthereumObservedRuntimeCodeHashes,
  AaveV3EthereumReserveTokenEvidence,
} from '../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import {
  AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING,
  aaveV3EthereumCheckpointContentFingerprintFromDeploymentFact,
} from './aave-v3-ethereum-finalized-checkpoint';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT } from './aave-v3-ethereum-deployment-evidence-fingerprint';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const ZERO_BLOCK_HASH = `0x${'0'.repeat(64)}`;
const HISTORICAL_EVIDENCE_FINGERPRINT_DOMAIN =
  'crypto-lending:aave-v3-ethereum-historical-lineage-evidence:v1';
const RECOVERY_AUTHORIZATION_FINGERPRINT_DOMAIN =
  'crypto-lending:aave-v3-ethereum-checkpoint-recovery-authorization:v1';
const RECOVERY_COMMAND_FINGERPRINT_DOMAIN =
  'crypto-lending:aave-v3-ethereum-checkpoint-recovery-command:v1';

export const AAVE_V3_ETHEREUM_MAXIMUM_RECOVERY_LINEAGE_BLOCKS = 64;
export const AAVE_V3_ETHEREUM_RECOVERY_AUTHORIZATION_MAXIMUM_AGE_MILLISECONDS = 15 * 60 * 1_000;
export const AAVE_V3_ETHEREUM_HISTORICAL_RECOVERY_READ_PLAN_FINGERPRINT_SHA256 = createHash(
  'sha256',
)
  .update(
    JSON.stringify([
      'crypto-lending:aave-v3-ethereum-historical-recovery-read-plan:v1',
      1,
      'eip155:1',
      '0x1',
      'finalized',
      'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
      AAVE_V3_ETHEREUM_MAXIMUM_RECOVERY_LINEAGE_BLOCKS,
      ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp'],
      [
        'poolAddressesProvider',
        'poolProxy',
        'poolImplementation',
        'protocolDataProvider',
        'usdcAToken',
        'usdcVariableDebtToken',
        'usdtAToken',
        'usdtVariableDebtToken',
      ],
      ['USDC', 'USDT'],
    ]),
    'utf8',
  )
  .digest('hex');

const OBSERVATION_KEYS = Object.freeze([
  'schemaVersion',
  'sourceId',
  'use',
  'mayEstablishRecommendationEligibility',
  'mayAuthorizeFinancialAction',
  'deploymentId',
  'networkId',
  'chainId',
  'finalizedAnchorSelector',
  'historicalBlockBinding',
  'sourceReferenceId',
  'sourceObservationId',
  'deploymentManifestFingerprintSha256',
  'assetRegistryFingerprintSha256',
  'historicalReadPlanFingerprintSha256',
  'observedAt',
  'finalizedAnchor',
  'historicalBlock',
  'runtimeCodeKeccak256',
  'reserves',
  'evidenceFingerprintSha256',
  'evidenceId',
] as const);

const AUTHORIZATION_KEYS = Object.freeze([
  'schemaVersion',
  'authorizationType',
  'scope',
  'mayAuthorizeFinancialAction',
  'operation',
  'deploymentId',
  'networkId',
  'sourceReferenceId',
  'corroboratingSourceReferenceId',
  'authorizedByReferenceId',
  'sourcePairIndependenceApprovalId',
  'expectedRevision',
  'expectedStatus',
  'expectedQuarantineReason',
  'expectedQuarantinedAt',
  'expectedLastValidatedAt',
  'expectedLastGoodBlock',
  'expectedLastGoodContentFingerprintSha256',
  'recoverThroughBlock',
  'reasonCode',
  'issuedAt',
  'expiresAt',
  'nonce',
  'authorizationFingerprintSha256',
  'authorizationId',
] as const);

const RUNTIME_CODE_KEYS = Object.freeze([
  'poolAddressesProvider',
  'poolProxy',
  'poolImplementation',
  'protocolDataProvider',
  'usdcAToken',
  'usdcVariableDebtToken',
  'usdtAToken',
  'usdtVariableDebtToken',
] as const);

export type AaveV3EthereumHistoricalObservationFingerprintMaterial = Omit<
  AaveV3EthereumHistoricalDeploymentObservation,
  'evidenceFingerprintSha256' | 'evidenceId'
>;
export type AaveV3EthereumRecoveryAuthorizationFingerprintMaterial = Omit<
  AaveV3EthereumCheckpointRecoveryAuthorization,
  'authorizationFingerprintSha256' | 'authorizationId'
>;

interface NormalizedHistoricalObservation {
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly observedAt: string;
  readonly finalizedAnchor: AaveV3EthereumFinalizedBlockEvidence;
  readonly historicalBlock: AaveV3EthereumFinalizedBlockEvidence;
  readonly evidenceFingerprintSha256: string;
  readonly contentFingerprintSha256: string;
}

export interface NormalizedAaveV3EthereumRecoveryLineageEntry {
  readonly sequence: number;
  readonly block: AaveV3EthereumFinalizedBlockEvidence;
  readonly contentFingerprintSha256: string;
  readonly primary: Readonly<{
    sourceReferenceId: string;
    sourceObservationId: string;
    evidenceFingerprintSha256: string;
    observedAt: string;
  }>;
  readonly corroborating: Readonly<{
    sourceReferenceId: string;
    sourceObservationId: string;
    evidenceFingerprintSha256: string;
    observedAt: string;
  }>;
}

export interface NormalizedAaveV3EthereumFinalizedCheckpointRecoveryCommand {
  readonly evaluatedAt: string;
  readonly recoveryId: string;
  readonly authorizationFingerprintSha256: string;
  readonly commandFingerprintSha256: string;
  readonly nonce: string;
  readonly sourceReferenceId: string;
  readonly corroboratingSourceReferenceId: string;
  readonly authorizedByReferenceId: string;
  readonly sourcePairIndependenceApprovalId: string;
  readonly operation: 'CONTINUITY_BACKFILL' | 'QUARANTINE_RECOVERY';
  readonly expectedRevision: number;
  readonly expectedStatus: 'ACTIVE' | 'QUARANTINED';
  readonly expectedQuarantineReason: AaveV3EthereumFinalizedCheckpointQuarantineReason | null;
  readonly expectedQuarantinedAt: string | null;
  readonly expectedLastValidatedAt: string;
  readonly expectedLastGoodBlock: AaveV3EthereumFinalizedBlockEvidence;
  readonly expectedLastGoodContentFingerprintSha256: string;
  readonly recoverThroughBlock: AaveV3EthereumFinalizedBlockEvidence;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lineage: readonly NormalizedAaveV3EthereumRecoveryLineageEntry[];
  readonly serializedLineage: string;
}

export class AaveV3EthereumFinalizedCheckpointRecoveryValidationError extends Error {
  readonly code = 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_RECOVERY_INVALID' as const;

  constructor() {
    super('Aave V3 Ethereum finalized checkpoint recovery input is invalid');
    this.name = 'AaveV3EthereumFinalizedCheckpointRecoveryValidationError';
  }
}

function invalid(): never {
  throw new AaveV3EthereumFinalizedCheckpointRecoveryValidationError();
}

function assertExactDataRecord(value: unknown, keys: readonly string[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return invalid();
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) return invalid();
  }
}

function deepFreeze<const Value>(value: Value): Readonly<Value> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return invalid();
  }
  return value;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_REFERENCE.test(value)) return invalid();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return invalid();
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return invalid();
  return value;
}

function block(value: unknown): AaveV3EthereumFinalizedBlockEvidence {
  assertExactDataRecord(value, ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp']);
  const candidate = value as AaveV3EthereumFinalizedBlockEvidence;
  if (
    typeof candidate.number !== 'bigint' ||
    candidate.number <= 0n ||
    candidate.number > MAX_UINT64 ||
    typeof candidate.hash !== 'string' ||
    !BLOCK_HASH.test(candidate.hash) ||
    candidate.hash === ZERO_BLOCK_HASH ||
    typeof candidate.parentHash !== 'string' ||
    !BLOCK_HASH.test(candidate.parentHash) ||
    candidate.parentHash === ZERO_BLOCK_HASH ||
    candidate.parentHash === candidate.hash ||
    typeof candidate.stateRoot !== 'string' ||
    !BLOCK_HASH.test(candidate.stateRoot) ||
    candidate.stateRoot === ZERO_BLOCK_HASH
  ) {
    return invalid();
  }
  return Object.freeze({
    number: candidate.number,
    hash: candidate.hash,
    parentHash: candidate.parentHash,
    stateRoot: candidate.stateRoot,
    timestamp: canonicalTimestamp(candidate.timestamp),
  });
}

function sameBlock(
  left: AaveV3EthereumFinalizedBlockEvidence,
  right: AaveV3EthereumFinalizedBlockEvidence,
): boolean {
  return (
    left.number === right.number &&
    left.hash === right.hash &&
    left.parentHash === right.parentHash &&
    left.stateRoot === right.stateRoot &&
    left.timestamp === right.timestamp
  );
}

function runtimeCode(value: unknown): AaveV3EthereumObservedRuntimeCodeHashes {
  assertExactDataRecord(value, RUNTIME_CODE_KEYS);
  const record = value as unknown as Record<string, unknown>;
  const normalized = Object.create(null) as Record<string, `0x${string}`>;
  for (const key of RUNTIME_CODE_KEYS) {
    const hash = record[key];
    if (typeof hash !== 'string' || !BLOCK_HASH.test(hash) || hash === ZERO_BLOCK_HASH) {
      return invalid();
    }
    normalized[key] = hash as `0x${string}`;
  }
  return Object.freeze(normalized) as unknown as AaveV3EthereumObservedRuntimeCodeHashes;
}

function reserve(
  value: unknown,
  expected: AaveV3EthereumReserveTokenEvidence,
): AaveV3EthereumReserveTokenEvidence {
  assertExactDataRecord(value, [
    'underlyingAsset',
    'aToken',
    'stableDebtToken',
    'variableDebtToken',
  ]);
  const candidate = value as AaveV3EthereumReserveTokenEvidence;
  if (
    candidate.underlyingAsset !== expected.underlyingAsset ||
    candidate.aToken !== expected.aToken ||
    candidate.stableDebtToken !== expected.stableDebtToken ||
    candidate.variableDebtToken !== expected.variableDebtToken
  ) {
    return invalid();
  }
  return Object.freeze({ ...candidate });
}

function reserves(value: unknown): Readonly<{
  USDC: AaveV3EthereumReserveTokenEvidence;
  USDT: AaveV3EthereumReserveTokenEvidence;
}> {
  assertExactDataRecord(value, ['USDC', 'USDT']);
  const candidate = value as AaveV3EthereumHistoricalDeploymentObservation['reserves'];
  return Object.freeze({
    USDC: reserve(candidate.USDC, AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.reserves.USDC),
    USDT: reserve(candidate.USDT, AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.reserves.USDT),
  });
}

function observationFingerprintMaterial(
  observation: AaveV3EthereumHistoricalObservationFingerprintMaterial,
): readonly unknown[] {
  return [
    HISTORICAL_EVIDENCE_FINGERPRINT_DOMAIN,
    observation.schemaVersion,
    observation.sourceId,
    observation.use,
    observation.mayEstablishRecommendationEligibility,
    observation.mayAuthorizeFinancialAction,
    observation.deploymentId,
    observation.networkId,
    observation.chainId,
    observation.finalizedAnchorSelector,
    observation.historicalBlockBinding,
    observation.sourceReferenceId,
    observation.sourceObservationId,
    observation.deploymentManifestFingerprintSha256,
    observation.assetRegistryFingerprintSha256,
    observation.historicalReadPlanFingerprintSha256,
    observation.observedAt,
    blockFingerprintMaterial(observation.finalizedAnchor),
    blockFingerprintMaterial(observation.historicalBlock),
    RUNTIME_CODE_KEYS.map((key) => observation.runtimeCodeKeccak256[key]),
    reserveFingerprintMaterial(observation.reserves.USDC),
    reserveFingerprintMaterial(observation.reserves.USDT),
  ];
}

function blockFingerprintMaterial(value: AaveV3EthereumFinalizedBlockEvidence): readonly string[] {
  return [value.number.toString(), value.hash, value.parentHash, value.stateRoot, value.timestamp];
}

function reserveFingerprintMaterial(value: AaveV3EthereumReserveTokenEvidence): readonly string[] {
  return [value.underlyingAsset, value.aToken, value.stableDebtToken, value.variableDebtToken];
}

export function fingerprintAaveV3EthereumHistoricalDeploymentObservation(
  observation: AaveV3EthereumHistoricalObservationFingerprintMaterial,
): string {
  return createHash('sha256')
    .update(JSON.stringify(observationFingerprintMaterial(observation)), 'utf8')
    .digest('hex');
}

function normalizeObservation(value: unknown): NormalizedHistoricalObservation {
  assertExactDataRecord(value, OBSERVATION_KEYS);
  const observation = value as AaveV3EthereumHistoricalDeploymentObservation;
  const binding = AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING;
  if (
    observation.schemaVersion !== 1 ||
    observation.sourceId !== 'AAVE_V3_ETHEREUM_HISTORICAL_FINALIZED_LINEAGE_RPC' ||
    observation.use !== 'CHECKPOINT_LINEAGE_REPAIR_ONLY' ||
    observation.mayEstablishRecommendationEligibility !== false ||
    observation.mayAuthorizeFinancialAction !== false ||
    observation.deploymentId !== binding.deploymentId ||
    observation.networkId !== binding.networkId ||
    observation.chainId !== '0x1' ||
    observation.finalizedAnchorSelector !== 'finalized' ||
    observation.historicalBlockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' ||
    observation.deploymentManifestFingerprintSha256 !==
      binding.deploymentManifestFingerprintSha256 ||
    observation.assetRegistryFingerprintSha256 !== binding.assetRegistryFingerprintSha256 ||
    observation.historicalReadPlanFingerprintSha256 !==
      AAVE_V3_ETHEREUM_HISTORICAL_RECOVERY_READ_PLAN_FINGERPRINT_SHA256
  ) {
    return invalid();
  }
  const sourceReferenceId = reference(observation.sourceReferenceId);
  const sourceObservationId = reference(observation.sourceObservationId);
  const observedAt = canonicalTimestamp(observation.observedAt);
  const finalizedAnchor = block(observation.finalizedAnchor);
  const historicalBlock = block(observation.historicalBlock);
  if (
    historicalBlock.number > finalizedAnchor.number ||
    Date.parse(historicalBlock.timestamp) > Date.parse(observedAt) ||
    Date.parse(finalizedAnchor.timestamp) > Date.parse(observedAt)
  ) {
    return invalid();
  }
  const code = runtimeCode(observation.runtimeCodeKeccak256);
  const topology = reserves(observation.reserves);
  const material: AaveV3EthereumHistoricalObservationFingerprintMaterial = {
    schemaVersion: 1,
    sourceId: 'AAVE_V3_ETHEREUM_HISTORICAL_FINALIZED_LINEAGE_RPC',
    use: 'CHECKPOINT_LINEAGE_REPAIR_ONLY',
    mayEstablishRecommendationEligibility: false,
    mayAuthorizeFinancialAction: false,
    deploymentId: binding.deploymentId,
    networkId: binding.networkId,
    chainId: '0x1',
    finalizedAnchorSelector: 'finalized',
    historicalBlockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    sourceReferenceId,
    sourceObservationId,
    deploymentManifestFingerprintSha256: binding.deploymentManifestFingerprintSha256,
    assetRegistryFingerprintSha256: binding.assetRegistryFingerprintSha256,
    historicalReadPlanFingerprintSha256:
      AAVE_V3_ETHEREUM_HISTORICAL_RECOVERY_READ_PLAN_FINGERPRINT_SHA256,
    observedAt,
    finalizedAnchor,
    historicalBlock,
    runtimeCodeKeccak256: code,
    reserves: topology,
  };
  const evidenceFingerprintSha256 = digest(observation.evidenceFingerprintSha256);
  if (
    evidenceFingerprintSha256 !==
      fingerprintAaveV3EthereumHistoricalDeploymentObservation(material) ||
    observation.evidenceId !== `aave-v3-ethereum-historical-lineage:${evidenceFingerprintSha256}`
  ) {
    return invalid();
  }
  return Object.freeze({
    sourceReferenceId,
    sourceObservationId,
    observedAt,
    finalizedAnchor,
    historicalBlock,
    evidenceFingerprintSha256,
    contentFingerprintSha256: aaveV3EthereumCheckpointContentFingerprintFromDeploymentFact({
      finalizedBlock: historicalBlock,
      runtimeCodeKeccak256: code,
      reserves: topology,
    }),
  });
}

function authorizationFingerprintMaterial(
  authorization: AaveV3EthereumRecoveryAuthorizationFingerprintMaterial,
): readonly unknown[] {
  return [
    RECOVERY_AUTHORIZATION_FINGERPRINT_DOMAIN,
    authorization.schemaVersion,
    authorization.authorizationType,
    authorization.scope,
    authorization.mayAuthorizeFinancialAction,
    authorization.operation,
    authorization.deploymentId,
    authorization.networkId,
    authorization.sourceReferenceId,
    authorization.corroboratingSourceReferenceId,
    authorization.authorizedByReferenceId,
    authorization.sourcePairIndependenceApprovalId,
    authorization.expectedRevision,
    authorization.expectedStatus,
    authorization.expectedQuarantineReason,
    authorization.expectedQuarantinedAt,
    authorization.expectedLastValidatedAt,
    blockFingerprintMaterial(authorization.expectedLastGoodBlock),
    authorization.expectedLastGoodContentFingerprintSha256,
    [authorization.recoverThroughBlock.number.toString(), authorization.recoverThroughBlock.hash],
    authorization.reasonCode,
    authorization.issuedAt,
    authorization.expiresAt,
    authorization.nonce,
  ];
}

export function fingerprintAaveV3EthereumCheckpointRecoveryAuthorization(
  authorization: AaveV3EthereumRecoveryAuthorizationFingerprintMaterial,
): string {
  return createHash('sha256')
    .update(JSON.stringify(authorizationFingerprintMaterial(authorization)), 'utf8')
    .digest('hex');
}

function quarantineReason(value: unknown): AaveV3EthereumFinalizedCheckpointQuarantineReason {
  if (
    value !== 'FINALIZED_HEIGHT_REGRESSION' &&
    value !== 'FINALIZED_BLOCK_DIVERGENCE' &&
    value !== 'FINALIZED_PARENT_MISMATCH' &&
    value !== 'FINALIZED_TIMESTAMP_REGRESSION' &&
    value !== 'SAME_BLOCK_EVIDENCE_DIVERGENCE'
  ) {
    return invalid();
  }
  return value;
}

function normalizeAuthorization(
  value: unknown,
  evaluatedAt: string,
): AaveV3EthereumRecoveryAuthorizationFingerprintMaterial & {
  readonly authorizationFingerprintSha256: string;
} {
  assertExactDataRecord(value, AUTHORIZATION_KEYS);
  const authorization = value as AaveV3EthereumCheckpointRecoveryAuthorization;
  const binding = AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING;
  if (
    authorization.schemaVersion !== 1 ||
    authorization.authorizationType !== 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_LINEAGE_REPAIR' ||
    authorization.scope !== 'CHECKPOINT_LINEAGE_REPAIR_ONLY' ||
    authorization.mayAuthorizeFinancialAction !== false ||
    authorization.deploymentId !== binding.deploymentId ||
    authorization.networkId !== binding.networkId ||
    !Number.isSafeInteger(authorization.expectedRevision) ||
    authorization.expectedRevision < 1 ||
    !(
      (authorization.operation === 'CONTINUITY_BACKFILL' &&
        authorization.expectedStatus === 'ACTIVE' &&
        authorization.expectedQuarantineReason === null &&
        authorization.expectedQuarantinedAt === null &&
        authorization.reasonCode === 'BACKFILL_CONTIGUOUS_INDEPENDENT_FINALIZED_LINEAGE') ||
      (authorization.operation === 'QUARANTINE_RECOVERY' &&
        authorization.expectedStatus === 'QUARANTINED' &&
        authorization.expectedRevision >= 2 &&
        authorization.expectedQuarantineReason !== null &&
        authorization.expectedQuarantinedAt !== null &&
        authorization.reasonCode === 'RESTORE_CONTIGUOUS_INDEPENDENT_FINALIZED_LINEAGE')
    )
  ) {
    return invalid();
  }
  const sourceReferenceId = reference(authorization.sourceReferenceId);
  const corroboratingSourceReferenceId = reference(authorization.corroboratingSourceReferenceId);
  if (sourceReferenceId === corroboratingSourceReferenceId) return invalid();
  const authorizedByReferenceId = reference(authorization.authorizedByReferenceId);
  const sourcePairIndependenceApprovalId = reference(
    authorization.sourcePairIndependenceApprovalId,
  );
  const expectedQuarantinedAt =
    authorization.expectedQuarantinedAt === null
      ? null
      : canonicalTimestamp(authorization.expectedQuarantinedAt);
  const expectedLastValidatedAt = canonicalTimestamp(authorization.expectedLastValidatedAt);
  const expectedLastGoodBlock = block(authorization.expectedLastGoodBlock);
  assertExactDataRecord(authorization.recoverThroughBlock, ['number', 'hash']);
  const recoverThroughBlock = authorization.recoverThroughBlock;
  if (
    typeof recoverThroughBlock.number !== 'bigint' ||
    recoverThroughBlock.number <= expectedLastGoodBlock.number ||
    recoverThroughBlock.number > MAX_UINT64 ||
    recoverThroughBlock.number - expectedLastGoodBlock.number >
      BigInt(AAVE_V3_ETHEREUM_MAXIMUM_RECOVERY_LINEAGE_BLOCKS) ||
    typeof recoverThroughBlock.hash !== 'string' ||
    !BLOCK_HASH.test(recoverThroughBlock.hash) ||
    recoverThroughBlock.hash === ZERO_BLOCK_HASH
  ) {
    return invalid();
  }
  const issuedAt = canonicalTimestamp(authorization.issuedAt);
  const expiresAt = canonicalTimestamp(authorization.expiresAt);
  const issuedAtMilliseconds = Date.parse(issuedAt);
  const expiresAtMilliseconds = Date.parse(expiresAt);
  const evaluatedAtMilliseconds = Date.parse(evaluatedAt);
  if (
    issuedAtMilliseconds < Date.parse(expectedLastValidatedAt) ||
    (expectedQuarantinedAt !== null && issuedAtMilliseconds < Date.parse(expectedQuarantinedAt)) ||
    expiresAtMilliseconds <= issuedAtMilliseconds ||
    expiresAtMilliseconds - issuedAtMilliseconds >
      AAVE_V3_ETHEREUM_RECOVERY_AUTHORIZATION_MAXIMUM_AGE_MILLISECONDS ||
    evaluatedAtMilliseconds < issuedAtMilliseconds ||
    evaluatedAtMilliseconds >= expiresAtMilliseconds
  ) {
    return invalid();
  }
  const material: AaveV3EthereumRecoveryAuthorizationFingerprintMaterial = {
    schemaVersion: 1,
    authorizationType: 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_LINEAGE_REPAIR',
    scope: 'CHECKPOINT_LINEAGE_REPAIR_ONLY',
    mayAuthorizeFinancialAction: false,
    operation: authorization.operation,
    deploymentId: binding.deploymentId,
    networkId: binding.networkId,
    sourceReferenceId,
    corroboratingSourceReferenceId,
    authorizedByReferenceId,
    sourcePairIndependenceApprovalId,
    expectedRevision: authorization.expectedRevision,
    expectedStatus: authorization.expectedStatus,
    expectedQuarantineReason:
      authorization.expectedQuarantineReason === null
        ? null
        : quarantineReason(authorization.expectedQuarantineReason),
    expectedQuarantinedAt,
    expectedLastValidatedAt,
    expectedLastGoodBlock,
    expectedLastGoodContentFingerprintSha256: digest(
      authorization.expectedLastGoodContentFingerprintSha256,
    ),
    recoverThroughBlock: Object.freeze({
      number: recoverThroughBlock.number,
      hash: recoverThroughBlock.hash,
    }),
    reasonCode: authorization.reasonCode,
    issuedAt,
    expiresAt,
    nonce: uuid(authorization.nonce),
  };
  const authorizationFingerprintSha256 = digest(authorization.authorizationFingerprintSha256);
  if (
    authorizationFingerprintSha256 !==
      fingerprintAaveV3EthereumCheckpointRecoveryAuthorization(material) ||
    authorization.authorizationId !==
      `aave-v3-ethereum-checkpoint-lineage-repair:${authorizationFingerprintSha256}`
  ) {
    return invalid();
  }
  return Object.freeze({ ...material, authorizationFingerprintSha256 });
}

function serializedLineage(
  lineage: readonly NormalizedAaveV3EthereumRecoveryLineageEntry[],
): string {
  return JSON.stringify(
    lineage.map((entry) => ({
      sequence: entry.sequence,
      blockNumber: entry.block.number.toString(),
      blockHash: entry.block.hash,
      parentHash: entry.block.parentHash,
      stateRoot: entry.block.stateRoot,
      blockTimestamp: entry.block.timestamp,
      contentFingerprintSha256: entry.contentFingerprintSha256,
      primarySourceObservationId: entry.primary.sourceObservationId,
      primaryEvidenceFingerprintSha256: entry.primary.evidenceFingerprintSha256,
      primaryObservedAt: entry.primary.observedAt,
      corroboratingSourceObservationId: entry.corroborating.sourceObservationId,
      corroboratingEvidenceFingerprintSha256: entry.corroborating.evidenceFingerprintSha256,
      corroboratingObservedAt: entry.corroborating.observedAt,
    })),
  );
}

export function normalizeAaveV3EthereumFinalizedCheckpointRecoveryCommand(
  requestValue: RecoverAaveV3EthereumFinalizedCheckpointRequest,
): NormalizedAaveV3EthereumFinalizedCheckpointRecoveryCommand {
  try {
    assertExactDataRecord(requestValue, ['evaluatedAt', 'recoveryId', 'authorization', 'lineage']);
    const evaluatedAt = canonicalTimestamp(requestValue.evaluatedAt);
    const recoveryId = uuid(requestValue.recoveryId);
    if (!Array.isArray(requestValue.lineage)) return invalid();
    const authorization = normalizeAuthorization(requestValue.authorization, evaluatedAt);
    const expectedLength =
      authorization.recoverThroughBlock.number - authorization.expectedLastGoodBlock.number;
    if (
      requestValue.lineage.length < 1 ||
      requestValue.lineage.length > AAVE_V3_ETHEREUM_MAXIMUM_RECOVERY_LINEAGE_BLOCKS ||
      BigInt(requestValue.lineage.length) !== expectedLength
    ) {
      return invalid();
    }

    const observationIdentities = new Set<string>();
    const evidenceFingerprints = new Set<string>();
    const lineage: NormalizedAaveV3EthereumRecoveryLineageEntry[] = [];
    let previousBlock = authorization.expectedLastGoodBlock;
    let finalizedAnchor: AaveV3EthereumFinalizedBlockEvidence | undefined;
    for (const [index, value] of requestValue.lineage.entries()) {
      assertExactDataRecord(value, ['primary', 'corroborating']);
      const primary = normalizeObservation(value.primary);
      const corroborating = normalizeObservation(value.corroborating);
      if (
        primary.sourceReferenceId !== authorization.sourceReferenceId ||
        corroborating.sourceReferenceId !== authorization.corroboratingSourceReferenceId ||
        primary.sourceObservationId === corroborating.sourceObservationId ||
        primary.evidenceFingerprintSha256 === corroborating.evidenceFingerprintSha256 ||
        primary.contentFingerprintSha256 !== corroborating.contentFingerprintSha256 ||
        !sameBlock(primary.historicalBlock, corroborating.historicalBlock) ||
        !sameBlock(primary.finalizedAnchor, corroborating.finalizedAnchor) ||
        primary.historicalBlock.number !== previousBlock.number + 1n ||
        primary.historicalBlock.parentHash !== previousBlock.hash ||
        Date.parse(primary.historicalBlock.timestamp) <= Date.parse(previousBlock.timestamp) ||
        Date.parse(primary.observedAt) < Date.parse(authorization.issuedAt) ||
        Date.parse(corroborating.observedAt) < Date.parse(authorization.issuedAt) ||
        Date.parse(primary.observedAt) > Date.parse(evaluatedAt) ||
        Date.parse(corroborating.observedAt) > Date.parse(evaluatedAt)
      ) {
        return invalid();
      }
      if (finalizedAnchor === undefined) finalizedAnchor = primary.finalizedAnchor;
      else if (!sameBlock(finalizedAnchor, primary.finalizedAnchor)) return invalid();
      for (const identity of [
        `${primary.sourceReferenceId}\u0000${primary.sourceObservationId}`,
        `${corroborating.sourceReferenceId}\u0000${corroborating.sourceObservationId}`,
      ]) {
        if (observationIdentities.has(identity)) return invalid();
        observationIdentities.add(identity);
      }
      for (const fingerprint of [
        primary.evidenceFingerprintSha256,
        corroborating.evidenceFingerprintSha256,
      ]) {
        if (evidenceFingerprints.has(fingerprint)) return invalid();
        evidenceFingerprints.add(fingerprint);
      }
      lineage.push(
        deepFreeze({
          sequence: index + 1,
          block: primary.historicalBlock,
          contentFingerprintSha256: primary.contentFingerprintSha256,
          primary: {
            sourceReferenceId: primary.sourceReferenceId,
            sourceObservationId: primary.sourceObservationId,
            evidenceFingerprintSha256: primary.evidenceFingerprintSha256,
            observedAt: primary.observedAt,
          },
          corroborating: {
            sourceReferenceId: corroborating.sourceReferenceId,
            sourceObservationId: corroborating.sourceObservationId,
            evidenceFingerprintSha256: corroborating.evidenceFingerprintSha256,
            observedAt: corroborating.observedAt,
          },
        }),
      );
      previousBlock = primary.historicalBlock;
    }
    if (
      finalizedAnchor === undefined ||
      !sameBlock(previousBlock, finalizedAnchor) ||
      finalizedAnchor.number !== authorization.recoverThroughBlock.number ||
      finalizedAnchor.hash !== authorization.recoverThroughBlock.hash
    ) {
      return invalid();
    }
    const frozenLineage = Object.freeze(lineage);
    const encodedLineage = serializedLineage(frozenLineage);
    const commandFingerprintSha256 = createHash('sha256')
      .update(
        JSON.stringify([
          RECOVERY_COMMAND_FINGERPRINT_DOMAIN,
          recoveryId,
          evaluatedAt,
          authorization.authorizationFingerprintSha256,
          encodedLineage,
        ]),
        'utf8',
      )
      .digest('hex');
    return deepFreeze({
      evaluatedAt,
      recoveryId,
      authorizationFingerprintSha256: authorization.authorizationFingerprintSha256,
      commandFingerprintSha256,
      nonce: authorization.nonce,
      sourceReferenceId: authorization.sourceReferenceId,
      corroboratingSourceReferenceId: authorization.corroboratingSourceReferenceId,
      authorizedByReferenceId: authorization.authorizedByReferenceId,
      sourcePairIndependenceApprovalId: authorization.sourcePairIndependenceApprovalId,
      operation: authorization.operation,
      expectedRevision: authorization.expectedRevision,
      expectedStatus: authorization.expectedStatus,
      expectedQuarantineReason: authorization.expectedQuarantineReason,
      expectedQuarantinedAt: authorization.expectedQuarantinedAt,
      expectedLastValidatedAt: authorization.expectedLastValidatedAt,
      expectedLastGoodBlock: authorization.expectedLastGoodBlock,
      expectedLastGoodContentFingerprintSha256:
        authorization.expectedLastGoodContentFingerprintSha256,
      recoverThroughBlock: finalizedAnchor,
      issuedAt: authorization.issuedAt,
      expiresAt: authorization.expiresAt,
      lineage: frozenLineage,
      serializedLineage: encodedLineage,
    });
  } catch (error) {
    if (error instanceof AaveV3EthereumFinalizedCheckpointRecoveryValidationError) throw error;
    return invalid();
  }
}
