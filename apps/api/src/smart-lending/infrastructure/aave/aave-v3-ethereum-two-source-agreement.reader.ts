import { createHash } from 'node:crypto';

import { CHAIN_OBSERVATION_REGISTRY_BINDINGS } from '../../../blockchain/domain/chain-observation-policy';
import type {
  AaveV3EthereumComparedSourceEvidence,
  AaveV3EthereumDeploymentAgreementDecision,
  AaveV3EthereumDeploymentAgreementReader,
  AaveV3EthereumDeploymentPayloadComparisonStatus,
} from '../../application/ports/aave-v3-ethereum-deployment-agreement-reader.port';
import type {
  AaveV3EthereumDeploymentEvidence,
  AaveV3EthereumDeploymentEvidenceReader,
  AaveV3EthereumFinalizedBlockEvidence,
  AaveV3EthereumObservedRuntimeCodeHashes,
  AaveV3EthereumReserveTokenEvidence,
  ReadAaveV3EthereumDeploymentEvidenceRequest,
} from '../../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import { fingerprintAaveV3EthereumDeploymentEvidence } from '../../domain/aave-v3-ethereum-deployment-evidence-fingerprint';
import { AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256 } from './aave-v3-ethereum-finalized-rpc.plan';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST } from './aave-v3-ethereum-deployment.manifest';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const KECCAK256 = /^0x[0-9a-f]{64}$/u;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const OPAQUE_REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const ZERO_BLOCK_HASH = `0x${'0'.repeat(64)}` as const;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as const;
const MAX_UINT64 = (1n << 64n) - 1n;
const READ_DEADLINE_MILLISECONDS = 5_000;
const DEPLOYMENT_STATE_FINGERPRINT_DOMAIN =
  'crypto-lending:aave-v3-ethereum-deployment-state:v1' as const;
const COMPARISON_FINGERPRINT_DOMAIN =
  'crypto-lending:aave-v3-ethereum-two-source-comparison:v1' as const;

const EVIDENCE_KEYS = Object.freeze([
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

type ComparedRole = AaveV3EthereumComparedSourceEvidence['role'];

interface ParsedEvidence {
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly evidenceFingerprintSha256: string;
  readonly evidenceId: string;
  readonly observedAt: string;
  readonly finalizedBlock: AaveV3EthereumFinalizedBlockEvidence;
  readonly runtimeCodeKeccak256: AaveV3EthereumObservedRuntimeCodeHashes;
  readonly reserves: AaveV3EthereumDeploymentEvidence['reserves'];
  readonly deploymentStateFingerprintSha256: string;
}

export class AaveV3EthereumDeploymentAgreementUnavailableError extends Error {
  readonly code = 'AAVE_V3_ETHEREUM_DEPLOYMENT_AGREEMENT_UNAVAILABLE' as const;

  constructor() {
    super('Aave V3 Ethereum deployment agreement is unavailable');
    this.name = 'AaveV3EthereumDeploymentAgreementUnavailableError';
  }
}

function unavailable(): never {
  throw new AaveV3EthereumDeploymentAgreementUnavailableError();
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return unavailable();
  }
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return unavailable();
    record[key] = descriptor.value;
  }
  return record;
}

function deepFreeze<const Value>(value: Value): Readonly<Value> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') return unavailable();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return unavailable();
  }
  return value;
}

function opaqueReference(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_REFERENCE.test(value)) return unavailable();
  return value;
}

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) return unavailable();
  return value;
}

function requestData(value: unknown): ReadAaveV3EthereumDeploymentEvidenceRequest {
  const record = exactDataRecord(value, ['evaluatedAt', 'correlationId']);
  if (typeof record.correlationId !== 'string' || !UUID_V4.test(record.correlationId)) {
    return unavailable();
  }
  return Object.freeze({
    evaluatedAt: canonicalTimestamp(record.evaluatedAt),
    correlationId: record.correlationId,
  });
}

function finalizedBlock(value: unknown, evaluatedAt: string): AaveV3EthereumFinalizedBlockEvidence {
  const record = exactDataRecord(value, ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp']);
  if (
    typeof record.number !== 'bigint' ||
    record.number <= 0n ||
    record.number > MAX_UINT64 ||
    typeof record.hash !== 'string' ||
    !BLOCK_HASH.test(record.hash) ||
    record.hash === ZERO_BLOCK_HASH ||
    typeof record.parentHash !== 'string' ||
    !BLOCK_HASH.test(record.parentHash) ||
    record.parentHash === ZERO_BLOCK_HASH ||
    record.parentHash === record.hash ||
    typeof record.stateRoot !== 'string' ||
    !BLOCK_HASH.test(record.stateRoot) ||
    record.stateRoot === ZERO_BLOCK_HASH
  ) {
    return unavailable();
  }
  const timestamp = canonicalTimestamp(record.timestamp);
  if (Date.parse(timestamp) > Date.parse(evaluatedAt)) return unavailable();
  return Object.freeze({
    number: record.number,
    hash: record.hash as `0x${string}`,
    parentHash: record.parentHash as `0x${string}`,
    stateRoot: record.stateRoot as `0x${string}`,
    timestamp,
  });
}

function runtimeCodeHashes(value: unknown): AaveV3EthereumObservedRuntimeCodeHashes {
  const record = exactDataRecord(value, RUNTIME_CODE_KEYS);
  const result = Object.create(null) as Record<string, `0x${string}`>;
  for (const key of RUNTIME_CODE_KEYS) {
    const hash = record[key];
    if (typeof hash !== 'string' || !KECCAK256.test(hash) || hash === ZERO_BLOCK_HASH) {
      return unavailable();
    }
    result[key] = hash as `0x${string}`;
  }
  return Object.freeze(result) as unknown as AaveV3EthereumObservedRuntimeCodeHashes;
}

function reserveTokens(
  value: unknown,
  expected: Readonly<{
    underlyingAsset: string;
    aToken: string;
    variableDebtToken: string;
  }>,
): AaveV3EthereumReserveTokenEvidence {
  const record = exactDataRecord(value, [
    'underlyingAsset',
    'aToken',
    'stableDebtToken',
    'variableDebtToken',
  ]);
  for (const field of ['underlyingAsset', 'aToken', 'stableDebtToken', 'variableDebtToken']) {
    if (typeof record[field] !== 'string' || !ADDRESS.test(record[field])) return unavailable();
  }
  if (
    record.underlyingAsset !== expected.underlyingAsset ||
    record.aToken !== expected.aToken ||
    record.stableDebtToken !== ZERO_ADDRESS ||
    record.variableDebtToken !== expected.variableDebtToken
  ) {
    return unavailable();
  }
  return Object.freeze({
    underlyingAsset: record.underlyingAsset as `0x${string}`,
    aToken: record.aToken as `0x${string}`,
    stableDebtToken: record.stableDebtToken as `0x${string}`,
    variableDebtToken: record.variableDebtToken as `0x${string}`,
  });
}

function reserves(value: unknown): AaveV3EthereumDeploymentEvidence['reserves'] {
  const record = exactDataRecord(value, ['USDC', 'USDT']);
  return Object.freeze({
    USDC: reserveTokens(record.USDC, AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC),
    USDT: reserveTokens(record.USDT, AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDT),
  });
}

function stateFingerprint(
  block: AaveV3EthereumFinalizedBlockEvidence,
  code: AaveV3EthereumObservedRuntimeCodeHashes,
  observedReserves: AaveV3EthereumDeploymentEvidence['reserves'],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        DEPLOYMENT_STATE_FINGERPRINT_DOMAIN,
        1,
        'eip155:1',
        '0x1',
        AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.manifestFingerprintSha256,
        CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256,
        AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
        [block.number.toString(), block.hash, block.parentHash, block.stateRoot, block.timestamp],
        RUNTIME_CODE_KEYS.map((key) => code[key]),
        [
          [
            observedReserves.USDC.underlyingAsset,
            observedReserves.USDC.aToken,
            observedReserves.USDC.stableDebtToken,
            observedReserves.USDC.variableDebtToken,
          ],
          [
            observedReserves.USDT.underlyingAsset,
            observedReserves.USDT.aToken,
            observedReserves.USDT.stableDebtToken,
            observedReserves.USDT.variableDebtToken,
          ],
        ],
      ]),
      'utf8',
    )
    .digest('hex');
}

function parseEvidence(value: unknown, evaluatedAt: string): ParsedEvidence {
  const record = exactDataRecord(value, EVIDENCE_KEYS);
  if (
    record.schemaVersion !== 1 ||
    record.sourceId !== 'AAVE_V3_ETHEREUM_FINALIZED_RPC' ||
    record.use !== 'DEPLOYMENT_CORROBORATION_ONLY' ||
    record.mayEstablishRecommendationEligibility !== false ||
    record.mayAuthorizeFinancialAction !== false ||
    record.networkId !== 'eip155:1' ||
    record.chainId !== '0x1' ||
    record.blockSelector !== 'finalized' ||
    record.blockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' ||
    record.observedChainIdentityMatchesPolicy !== true ||
    record.manifestBindingValidated !== true ||
    record.observedDeploymentTopologyMatchesManifest !== true ||
    record.blockBindingExecutionStatus !== 'SOURCE_ATTESTED_UNVERIFIED' ||
    record.runtimeCodeApprovalStatus !== 'UNVERIFIED' ||
    record.sourceProviderApproved !== false ||
    record.exactHostEgressApproved !== false ||
    record.liveCapabilityProofValidated !== false ||
    record.independentFinalizedSourcesAgree !== false ||
    record.freshnessStatus !== 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT' ||
    record.finalityStatus !== 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF' ||
    record.deploymentManifestFingerprintSha256 !==
      AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.manifestFingerprintSha256 ||
    record.assetRegistryFingerprintSha256 !==
      CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256 ||
    record.readPlanFingerprintSha256 !==
      AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256 ||
    record.observedAt !== evaluatedAt
  ) {
    return unavailable();
  }
  const sourceReferenceId = opaqueReference(record.sourceReferenceId);
  const sourceObservationId = opaqueReference(record.sourceObservationId);
  const evidenceFingerprintSha256 = sha256(record.evidenceFingerprintSha256);
  const evidenceId = `aave-v3-ethereum-deployment:${evidenceFingerprintSha256}`;
  if (record.evidenceId !== evidenceId) return unavailable();
  const block = finalizedBlock(record.finalizedBlock, evaluatedAt);
  const code = runtimeCodeHashes(record.runtimeCodeKeccak256);
  const parsedReserves = reserves(record.reserves);
  if (
    evidenceFingerprintSha256 !==
    fingerprintAaveV3EthereumDeploymentEvidence(
      {
        sourceReferenceId,
        sourceObservationId,
        finalizedBlock: block,
        runtimeCodeKeccak256: code,
        reserves: parsedReserves,
      },
      evaluatedAt,
    )
  ) {
    return unavailable();
  }
  return Object.freeze({
    sourceReferenceId,
    sourceObservationId,
    evidenceFingerprintSha256,
    evidenceId,
    observedAt: evaluatedAt,
    finalizedBlock: block,
    runtimeCodeKeccak256: code,
    reserves: parsedReserves,
    deploymentStateFingerprintSha256: stateFingerprint(block, code, parsedReserves),
  });
}

function sameFinalizedHeader(
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

function comparisonStatus(
  primary: ParsedEvidence,
  corroborating: ParsedEvidence,
): AaveV3EthereumDeploymentPayloadComparisonStatus {
  if (
    primary.sourceReferenceId === corroborating.sourceReferenceId ||
    primary.sourceObservationId === corroborating.sourceObservationId ||
    primary.evidenceFingerprintSha256 === corroborating.evidenceFingerprintSha256
  ) {
    return 'BLOCKED_SOURCE_ALIAS_REUSE';
  }
  if (primary.finalizedBlock.number !== corroborating.finalizedBlock.number) {
    return 'BLOCKED_NOT_ALIGNED';
  }
  if (!sameFinalizedHeader(primary.finalizedBlock, corroborating.finalizedBlock)) {
    return 'QUARANTINED_FINALIZED_HEADER_DIVERGENCE';
  }
  if (primary.deploymentStateFingerprintSha256 !== corroborating.deploymentStateFingerprintSha256) {
    return 'QUARANTINED_DEPLOYMENT_STATE_DIVERGENCE';
  }
  return 'EXACT_PAYLOAD_MATCH';
}

function comparedSource(
  role: ComparedRole,
  value: ParsedEvidence,
): AaveV3EthereumComparedSourceEvidence {
  return Object.freeze({
    role,
    sourceReferenceId: value.sourceReferenceId,
    sourceObservationId: value.sourceObservationId,
    evidenceFingerprintSha256: value.evidenceFingerprintSha256,
    evidenceId: value.evidenceId,
    deploymentStateFingerprintSha256: value.deploymentStateFingerprintSha256,
    finalizedBlock: value.finalizedBlock,
  });
}

function sourceFingerprintMaterial(
  source: AaveV3EthereumComparedSourceEvidence,
): readonly unknown[] {
  const block = source.finalizedBlock;
  return [
    source.role,
    source.sourceReferenceId,
    source.sourceObservationId,
    source.evidenceFingerprintSha256,
    source.evidenceId,
    source.deploymentStateFingerprintSha256,
    [block.number.toString(), block.hash, block.parentHash, block.stateRoot, block.timestamp],
  ];
}

function comparisonFingerprint(
  status: AaveV3EthereumDeploymentPayloadComparisonStatus,
  request: ReadAaveV3EthereumDeploymentEvidenceRequest,
  primary: AaveV3EthereumComparedSourceEvidence,
  corroborating: AaveV3EthereumComparedSourceEvidence,
  matchedStateFingerprint: string | null,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        COMPARISON_FINGERPRINT_DOMAIN,
        1,
        'AAVE_V3_ETHEREUM_TWO_SOURCE_COMPARISON',
        'DEPLOYMENT_CORROBORATION_ONLY',
        status,
        status.startsWith('QUARANTINED_'),
        'UNVERIFIED',
        'UNVERIFIED',
        'UNVERIFIED',
        'UNVERIFIED_WITHOUT_APPROVED_PAIR_BINDING',
        'SOURCE_ATTESTED_UNVERIFIED',
        'UNVERIFIED',
        'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
        'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
        false,
        false,
        false,
        'eip155:1',
        '0x1',
        request.correlationId,
        request.evaluatedAt,
        AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.manifestFingerprintSha256,
        CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256,
        AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
        sourceFingerprintMaterial(primary),
        sourceFingerprintMaterial(corroborating),
        matchedStateFingerprint,
      ]),
      'utf8',
    )
    .digest('hex');
}

/**
 * Dormant coordinator for two separately constructed single-source readers.
 * It intentionally has no Nest decorator or module binding. Different reader
 * instances and source aliases prevent obvious accidental reuse, but only a
 * future approved pair binding can establish real provider independence.
 */
export class AaveV3EthereumTwoSourceAgreementReader implements AaveV3EthereumDeploymentAgreementReader {
  constructor(
    private readonly primary: AaveV3EthereumDeploymentEvidenceReader,
    private readonly corroborating: AaveV3EthereumDeploymentEvidenceReader,
  ) {
    if (
      typeof primary?.readCurrentDeploymentEvidence !== 'function' ||
      typeof corroborating?.readCurrentDeploymentEvidence !== 'function' ||
      primary === corroborating
    ) {
      return unavailable();
    }
  }

  async readDeploymentAgreement(
    requestValue: ReadAaveV3EthereumDeploymentEvidenceRequest,
  ): Promise<AaveV3EthereumDeploymentAgreementDecision> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = requestData(requestValue);
      const deadlineAtMilliseconds = Date.now() + READ_DEADLINE_MILLISECONDS;
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new AaveV3EthereumDeploymentAgreementUnavailableError()),
          READ_DEADLINE_MILLISECONDS,
        );
        timeout.unref?.();
      });
      const [primaryValue, corroboratingValue] = await Promise.race([
        Promise.all([
          this.primary.readCurrentDeploymentEvidence(request),
          this.corroborating.readCurrentDeploymentEvidence(request),
        ]),
        deadline,
      ]);
      if (Date.now() >= deadlineAtMilliseconds) return unavailable();
      const primaryEvidence = parseEvidence(primaryValue, request.evaluatedAt);
      const corroboratingEvidence = parseEvidence(corroboratingValue, request.evaluatedAt);
      const status = comparisonStatus(primaryEvidence, corroboratingEvidence);
      const primary = comparedSource('PRIMARY_CANDIDATE', primaryEvidence);
      const corroborating = comparedSource('CORROBORATING_CANDIDATE', corroboratingEvidence);
      const matchedDeploymentStateFingerprintSha256 =
        status === 'EXACT_PAYLOAD_MATCH' ? primaryEvidence.deploymentStateFingerprintSha256 : null;
      const fingerprint = comparisonFingerprint(
        status,
        request,
        primary,
        corroborating,
        matchedDeploymentStateFingerprintSha256,
      );
      if (Date.now() >= deadlineAtMilliseconds) return unavailable();
      return deepFreeze({
        schemaVersion: 1,
        sourceId: 'AAVE_V3_ETHEREUM_TWO_SOURCE_COMPARISON',
        use: 'DEPLOYMENT_CORROBORATION_ONLY',
        comparisonStatus: status,
        quarantineRequired: status.startsWith('QUARANTINED_'),
        sourcePairProviderApprovalStatus: 'UNVERIFIED',
        sourcePairEgressApprovalStatus: 'UNVERIFIED',
        sourcePairLiveCapabilityProofStatus: 'UNVERIFIED',
        sourcePairIndependenceStatus: 'UNVERIFIED_WITHOUT_APPROVED_PAIR_BINDING',
        blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED',
        runtimeCodeApprovalStatus: 'UNVERIFIED',
        freshnessStatus: 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
        finalityStatus: 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
        independentFinalizedSourcesAgree: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
        networkId: 'eip155:1',
        chainId: '0x1',
        correlationId: request.correlationId,
        evaluatedAt: request.evaluatedAt,
        deploymentManifestFingerprintSha256:
          AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.manifestFingerprintSha256,
        assetRegistryFingerprintSha256:
          CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256,
        readPlanFingerprintSha256: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
        primary,
        corroborating,
        matchedDeploymentStateFingerprintSha256,
        comparisonFingerprintSha256: fingerprint,
        comparisonId: `aave-v3-ethereum-two-source-comparison:${fingerprint}`,
      } as const satisfies AaveV3EthereumDeploymentAgreementDecision);
    } catch {
      return unavailable();
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
