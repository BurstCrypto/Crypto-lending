import { createHash } from 'node:crypto';

import type { RecordAaveV3EthereumFinalizedCheckpointRequest } from '../application/ports/aave-v3-ethereum-finalized-checkpoint.port';
import type { AaveV3EthereumDeploymentEvidence } from '../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import type {
  AaveV3EthereumFinalizedBlockEvidence,
  AaveV3EthereumObservedRuntimeCodeHashes,
  AaveV3EthereumReserveTokenEvidence,
} from '../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import {
  AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT,
  fingerprintAaveV3EthereumDeploymentEvidence,
} from './aave-v3-ethereum-deployment-evidence-fingerprint';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const CONTENT_FINGERPRINT_DOMAIN =
  'crypto-lending:aave-v3-ethereum-finalized-checkpoint-content:v1';
const COMMAND_FINGERPRINT_DOMAIN =
  'crypto-lending:aave-v3-ethereum-finalized-checkpoint-command:v1';

export const AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING = Object.freeze({
  schemaVersion: 1,
  deploymentId: 'AAVE_V3_ETHEREUM',
  networkId: AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.networkId,
  deploymentManifestFingerprintSha256:
    AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.deploymentManifestFingerprintSha256,
  assetRegistryFingerprintSha256:
    AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.assetRegistryFingerprintSha256,
  readPlanFingerprintSha256:
    AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT.readPlanFingerprintSha256,
} as const);

export class AaveV3EthereumFinalizedCheckpointValidationError extends Error {
  readonly code = 'AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_INVALID' as const;

  constructor() {
    super('Aave V3 Ethereum finalized checkpoint input is invalid');
    this.name = 'AaveV3EthereumFinalizedCheckpointValidationError';
  }
}

function invalid(): never {
  throw new AaveV3EthereumFinalizedCheckpointValidationError();
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return invalid();
  }
  return value;
}

function blockHash(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !BLOCK_HASH.test(value) || /^0x0{64}$/u.test(value)) {
    return invalid();
  }
  return value as `0x${string}`;
}

function address(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !ADDRESS.test(value)) return invalid();
  return value as `0x${string}`;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return invalid();
  return value;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_REFERENCE.test(value)) return invalid();
  return value;
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

function assertEvidenceAuthority(evidence: AaveV3EthereumDeploymentEvidence): void {
  assertExactDataRecord(evidence, [
    'schemaVersion',
    'sourceId',
    'use',
    'mayEstablishRecommendationEligibility',
    'mayAuthorizeFinancialAction',
    'networkId',
    'chainId',
    'blockSelector',
    'blockBinding',
    'observedChainIdentityMatchesPolicy',
    'manifestBindingValidated',
    'observedDeploymentTopologyMatchesManifest',
    'blockBindingExecutionStatus',
    'runtimeCodeApprovalStatus',
    'sourceProviderApproved',
    'exactHostEgressApproved',
    'liveCapabilityProofValidated',
    'independentFinalizedSourcesAgree',
    'freshnessStatus',
    'finalityStatus',
    'sourceReferenceId',
    'sourceObservationId',
    'deploymentManifestFingerprintSha256',
    'assetRegistryFingerprintSha256',
    'readPlanFingerprintSha256',
    'evidenceFingerprintSha256',
    'evidenceId',
    'observedAt',
    'finalizedBlock',
    'runtimeCodeKeccak256',
    'reserves',
  ]);
  assertExactDataRecord(evidence.finalizedBlock, [
    'number',
    'hash',
    'parentHash',
    'stateRoot',
    'timestamp',
  ]);
  assertExactDataRecord(evidence.runtimeCodeKeccak256, [
    'poolAddressesProvider',
    'poolProxy',
    'poolImplementation',
    'protocolDataProvider',
    'usdcAToken',
    'usdcVariableDebtToken',
    'usdtAToken',
    'usdtVariableDebtToken',
  ]);
  assertExactDataRecord(evidence.reserves, ['USDC', 'USDT']);
  assertExactDataRecord(evidence.reserves.USDC, [
    'underlyingAsset',
    'aToken',
    'stableDebtToken',
    'variableDebtToken',
  ]);
  assertExactDataRecord(evidence.reserves.USDT, [
    'underlyingAsset',
    'aToken',
    'stableDebtToken',
    'variableDebtToken',
  ]);
  const binding = AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING;
  const contract = AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT;
  if (
    evidence.schemaVersion !== 1 ||
    evidence.sourceId !== 'AAVE_V3_ETHEREUM_FINALIZED_RPC' ||
    evidence.use !== 'DEPLOYMENT_CORROBORATION_ONLY' ||
    evidence.mayEstablishRecommendationEligibility !== false ||
    evidence.mayAuthorizeFinancialAction !== false ||
    evidence.networkId !== binding.networkId ||
    evidence.chainId !== '0x1' ||
    evidence.blockSelector !== 'finalized' ||
    evidence.blockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' ||
    evidence.observedChainIdentityMatchesPolicy !== true ||
    evidence.manifestBindingValidated !== true ||
    evidence.observedDeploymentTopologyMatchesManifest !== true ||
    evidence.blockBindingExecutionStatus !== 'SOURCE_ATTESTED_UNVERIFIED' ||
    evidence.runtimeCodeApprovalStatus !== 'UNVERIFIED' ||
    evidence.sourceProviderApproved !== false ||
    evidence.exactHostEgressApproved !== false ||
    evidence.liveCapabilityProofValidated !== false ||
    evidence.independentFinalizedSourcesAgree !== false ||
    evidence.freshnessStatus !== 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT' ||
    evidence.finalityStatus !== 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF' ||
    evidence.deploymentManifestFingerprintSha256 !== binding.deploymentManifestFingerprintSha256 ||
    evidence.assetRegistryFingerprintSha256 !== binding.assetRegistryFingerprintSha256 ||
    evidence.readPlanFingerprintSha256 !== binding.readPlanFingerprintSha256 ||
    evidence.reserves.USDC.underlyingAsset !== contract.reserves.USDC.underlyingAsset ||
    evidence.reserves.USDC.aToken !== contract.reserves.USDC.aToken ||
    evidence.reserves.USDC.stableDebtToken !== contract.reserves.USDC.stableDebtToken ||
    evidence.reserves.USDC.variableDebtToken !== contract.reserves.USDC.variableDebtToken ||
    evidence.reserves.USDT.underlyingAsset !== contract.reserves.USDT.underlyingAsset ||
    evidence.reserves.USDT.aToken !== contract.reserves.USDT.aToken ||
    evidence.reserves.USDT.stableDebtToken !== contract.reserves.USDT.stableDebtToken ||
    evidence.reserves.USDT.variableDebtToken !== contract.reserves.USDT.variableDebtToken
  ) {
    return invalid();
  }
}

export interface NormalizedAaveV3EthereumFinalizedCheckpointCommand {
  readonly expectedRevision: number | null;
  readonly correlationId: string;
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly evidenceFingerprintSha256: string;
  readonly contentFingerprintSha256: string;
  readonly commandFingerprintSha256: string;
  readonly observedAt: string;
  readonly finalizedBlock: Readonly<{
    number: bigint;
    hash: `0x${string}`;
    parentHash: `0x${string}`;
    stateRoot: `0x${string}`;
    timestamp: string;
  }>;
}

export interface AaveV3EthereumCheckpointDeploymentFact {
  readonly finalizedBlock: AaveV3EthereumFinalizedBlockEvidence;
  readonly runtimeCodeKeccak256: AaveV3EthereumObservedRuntimeCodeHashes;
  readonly reserves: Readonly<{
    USDC: AaveV3EthereumReserveTokenEvidence;
    USDT: AaveV3EthereumReserveTokenEvidence;
  }>;
}

export function aaveV3EthereumCheckpointContentFingerprintFromDeploymentFact(
  fact: AaveV3EthereumCheckpointDeploymentFact,
): string {
  assertExactDataRecord(fact, ['finalizedBlock', 'runtimeCodeKeccak256', 'reserves']);
  assertExactDataRecord(fact.finalizedBlock, [
    'number',
    'hash',
    'parentHash',
    'stateRoot',
    'timestamp',
  ]);
  assertExactDataRecord(fact.runtimeCodeKeccak256, [
    'poolAddressesProvider',
    'poolProxy',
    'poolImplementation',
    'protocolDataProvider',
    'usdcAToken',
    'usdcVariableDebtToken',
    'usdtAToken',
    'usdtVariableDebtToken',
  ]);
  assertExactDataRecord(fact.reserves, ['USDC', 'USDT']);
  assertExactDataRecord(fact.reserves.USDC, [
    'underlyingAsset',
    'aToken',
    'stableDebtToken',
    'variableDebtToken',
  ]);
  assertExactDataRecord(fact.reserves.USDT, [
    'underlyingAsset',
    'aToken',
    'stableDebtToken',
    'variableDebtToken',
  ]);
  const blockNumber = fact.finalizedBlock.number;
  const blockTimestamp = canonicalTimestamp(fact.finalizedBlock.timestamp);
  if (typeof blockNumber !== 'bigint' || blockNumber <= 0n || blockNumber > MAX_UINT64) {
    return invalid();
  }
  const block = [
    blockNumber.toString(),
    blockHash(fact.finalizedBlock.hash),
    blockHash(fact.finalizedBlock.parentHash),
    blockHash(fact.finalizedBlock.stateRoot),
    blockTimestamp,
  ] as const;
  if (block[1] === block[2]) return invalid();
  const code = fact.runtimeCodeKeccak256;
  const reserves = fact.reserves;
  const contract = AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT;
  if (
    reserves.USDC.underlyingAsset !== contract.reserves.USDC.underlyingAsset ||
    reserves.USDC.aToken !== contract.reserves.USDC.aToken ||
    reserves.USDC.stableDebtToken !== contract.reserves.USDC.stableDebtToken ||
    reserves.USDC.variableDebtToken !== contract.reserves.USDC.variableDebtToken ||
    reserves.USDT.underlyingAsset !== contract.reserves.USDT.underlyingAsset ||
    reserves.USDT.aToken !== contract.reserves.USDT.aToken ||
    reserves.USDT.stableDebtToken !== contract.reserves.USDT.stableDebtToken ||
    reserves.USDT.variableDebtToken !== contract.reserves.USDT.variableDebtToken
  ) {
    return invalid();
  }
  return createHash('sha256')
    .update(
      JSON.stringify([
        CONTENT_FINGERPRINT_DOMAIN,
        AAVE_V3_ETHEREUM_FINALIZED_CHECKPOINT_BINDING,
        block,
        [
          blockHash(code.poolAddressesProvider),
          blockHash(code.poolProxy),
          blockHash(code.poolImplementation),
          blockHash(code.protocolDataProvider),
          blockHash(code.usdcAToken),
          blockHash(code.usdcVariableDebtToken),
          blockHash(code.usdtAToken),
          blockHash(code.usdtVariableDebtToken),
        ],
        [
          [
            address(reserves.USDC.underlyingAsset),
            address(reserves.USDC.aToken),
            address(reserves.USDC.stableDebtToken),
            address(reserves.USDC.variableDebtToken),
          ],
          [
            address(reserves.USDT.underlyingAsset),
            address(reserves.USDT.aToken),
            address(reserves.USDT.stableDebtToken),
            address(reserves.USDT.variableDebtToken),
          ],
        ],
      ]),
      'utf8',
    )
    .digest('hex');
}

export function aaveV3EthereumCheckpointContentFingerprint(
  evidence: AaveV3EthereumDeploymentEvidence,
): string {
  assertEvidenceAuthority(evidence);
  const blockNumber = evidence.finalizedBlock.number;
  const blockTimestamp = canonicalTimestamp(evidence.finalizedBlock.timestamp);
  const observedAt = canonicalTimestamp(evidence.observedAt);
  if (
    typeof blockNumber !== 'bigint' ||
    blockNumber <= 0n ||
    blockNumber > MAX_UINT64 ||
    Date.parse(blockTimestamp) > Date.parse(observedAt)
  ) {
    return invalid();
  }
  return aaveV3EthereumCheckpointContentFingerprintFromDeploymentFact({
    finalizedBlock: evidence.finalizedBlock,
    runtimeCodeKeccak256: evidence.runtimeCodeKeccak256,
    reserves: evidence.reserves,
  });
}

export function normalizeAaveV3EthereumFinalizedCheckpointCommand(
  request: RecordAaveV3EthereumFinalizedCheckpointRequest,
): NormalizedAaveV3EthereumFinalizedCheckpointCommand {
  try {
    assertExactDataRecord(request, ['expectedRevision', 'correlationId', 'evidence']);
    if (
      !request ||
      typeof request !== 'object' ||
      !UUID_V4.test(request.correlationId) ||
      (request.expectedRevision !== null &&
        (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1))
    ) {
      return invalid();
    }
    const evidence = request.evidence;
    assertEvidenceAuthority(evidence);
    const sourceReferenceId = reference(evidence.sourceReferenceId);
    const sourceObservationId = reference(evidence.sourceObservationId);
    const evidenceFingerprintSha256 = digest(evidence.evidenceFingerprintSha256);
    if (
      evidenceFingerprintSha256 !==
        fingerprintAaveV3EthereumDeploymentEvidence(evidence, evidence.observedAt) ||
      evidence.evidenceId !== `aave-v3-ethereum-deployment:${evidenceFingerprintSha256}`
    ) {
      return invalid();
    }
    const observedAt = canonicalTimestamp(evidence.observedAt);
    const finalizedBlock = Object.freeze({
      number: evidence.finalizedBlock.number,
      hash: blockHash(evidence.finalizedBlock.hash),
      parentHash: blockHash(evidence.finalizedBlock.parentHash),
      stateRoot: blockHash(evidence.finalizedBlock.stateRoot),
      timestamp: canonicalTimestamp(evidence.finalizedBlock.timestamp),
    });
    if (
      typeof finalizedBlock.number !== 'bigint' ||
      finalizedBlock.number <= 0n ||
      finalizedBlock.number > MAX_UINT64 ||
      finalizedBlock.hash === finalizedBlock.parentHash ||
      Date.parse(finalizedBlock.timestamp) > Date.parse(observedAt)
    ) {
      return invalid();
    }
    const contentFingerprintSha256 = aaveV3EthereumCheckpointContentFingerprint(evidence);
    const commandFingerprintSha256 = createHash('sha256')
      .update(
        JSON.stringify([
          COMMAND_FINGERPRINT_DOMAIN,
          request.expectedRevision,
          request.correlationId,
          sourceReferenceId,
          sourceObservationId,
          evidenceFingerprintSha256,
          contentFingerprintSha256,
          observedAt,
        ]),
        'utf8',
      )
      .digest('hex');
    return Object.freeze({
      expectedRevision: request.expectedRevision,
      correlationId: request.correlationId,
      sourceReferenceId,
      sourceObservationId,
      evidenceFingerprintSha256,
      contentFingerprintSha256,
      commandFingerprintSha256,
      observedAt,
      finalizedBlock,
    });
  } catch (error) {
    if (error instanceof AaveV3EthereumFinalizedCheckpointValidationError) throw error;
    return invalid();
  }
}
