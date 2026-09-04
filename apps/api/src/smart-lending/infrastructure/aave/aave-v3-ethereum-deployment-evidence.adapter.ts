import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { keccak256, type Hex } from 'viem';

import { CHAIN_OBSERVATION_REGISTRY_BINDINGS } from '../../../blockchain/domain/chain-observation-policy';
import type {
  AaveV3EthereumDeploymentEvidence,
  AaveV3EthereumDeploymentEvidenceReader,
  AaveV3EthereumReserveTokenEvidence,
  ReadAaveV3EthereumDeploymentEvidenceRequest,
} from '../../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import {
  AAVE_V3_ETHEREUM_FINALIZED_RPC_SOURCE,
  type AaveV3EthereumFinalizedRpcReadPlan,
  type AaveV3EthereumFinalizedRpcSource,
} from './aave-v3-ethereum-finalized-rpc.source';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST } from './aave-v3-ethereum-deployment.manifest';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const OPAQUE_REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const MAX_RUNTIME_CODE_BYTES = 24_576;
const READ_DEADLINE_MILLISECONDS = 5_000;
const EVIDENCE_FINGERPRINT_DOMAIN =
  'crypto-lending:aave-v3-ethereum-deployment-evidence:v1' as const;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as const;
const ZERO_BLOCK_HASH = `0x${'0'.repeat(64)}` as const;
const MAX_UINT64 = (1n << 64n) - 1n;
const ETHEREUM_GENESIS_TIMESTAMP_SECONDS = 1_438_269_973n;

export class AaveV3EthereumDeploymentEvidenceUnavailableError extends Error {
  readonly code = 'AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_UNAVAILABLE' as const;

  constructor() {
    super('Aave V3 Ethereum deployment evidence is unavailable');
    this.name = 'AaveV3EthereumDeploymentEvidenceUnavailableError';
  }
}

function unavailable(): never {
  throw new AaveV3EthereumDeploymentEvidenceUnavailableError();
}

function abiAddressArgument(address: string): `0x${string}` {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function calldata(selector: string, address?: string): `0x${string}` {
  return address === undefined
    ? (selector as `0x${string}`)
    : (`${selector}${abiAddressArgument(address).slice(2)}` as `0x${string}`);
}

function deepFreeze<const Value>(value: Value): Readonly<Value> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const manifest = AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST;

export const AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN = deepFreeze({
  schemaVersion: 1,
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
  blockAcquisition: {
    initialMethod: 'eth_getBlockByNumber',
    initialSelector: 'finalized',
    includeTransactions: false,
    stateReadParameter: 'CAPTURED_BLOCK_HASH_REQUIRE_CANONICAL',
    consistencyRecheckMethod: 'eth_getBlockByNumber',
    consistencyRecheckSelector: 'CAPTURED_BLOCK_NUMBER',
  },
  manifestFingerprintSha256: manifest.manifestFingerprintSha256,
  assetRegistryFingerprintSha256: CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256,
  maximumAggregateResponseBytes: 1_048_576,
  expectedRpcCallCount: 19,
  requiredMethods: ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'],
  operations: [
    operation(
      'code:pool-addresses-provider',
      'eth_getCode',
      manifest.contracts.poolAddressesProvider,
    ),
    operation('code:pool-proxy', 'eth_getCode', manifest.contracts.poolProxy),
    operation('code:pool-implementation', 'eth_getCode', manifest.contracts.poolImplementation),
    operation(
      'code:protocol-data-provider',
      'eth_getCode',
      manifest.contracts.protocolDataProvider,
    ),
    operation('code:usdc-atoken', 'eth_getCode', manifest.assets.USDC.aToken),
    operation(
      'code:usdc-variable-debt-token',
      'eth_getCode',
      manifest.assets.USDC.variableDebtToken,
    ),
    operation('code:usdt-atoken', 'eth_getCode', manifest.assets.USDT.aToken),
    operation(
      'code:usdt-variable-debt-token',
      'eth_getCode',
      manifest.assets.USDT.variableDebtToken,
    ),
    operation(
      'call:provider-get-pool',
      'eth_call',
      manifest.contracts.poolAddressesProvider,
      calldata(manifest.selectors.getPool),
    ),
    operation(
      'call:provider-get-data-provider',
      'eth_call',
      manifest.contracts.poolAddressesProvider,
      calldata(manifest.selectors.getPoolDataProvider),
    ),
    operation(
      'call:pool-addresses-provider',
      'eth_call',
      manifest.contracts.poolProxy,
      calldata(manifest.selectors.addressesProvider),
    ),
    operation(
      'call:data-provider-addresses-provider',
      'eth_call',
      manifest.contracts.protocolDataProvider,
      calldata(manifest.selectors.addressesProvider),
    ),
    operation(
      'call:data-provider-pool',
      'eth_call',
      manifest.contracts.protocolDataProvider,
      calldata(manifest.selectors.pool),
    ),
    operation(
      'call:pool-implementation-from-admin',
      'eth_call',
      manifest.contracts.poolProxy,
      calldata(manifest.selectors.implementation),
      manifest.contracts.poolAddressesProvider,
    ),
    operation(
      'call:usdc-reserve-tokens',
      'eth_call',
      manifest.contracts.protocolDataProvider,
      calldata(manifest.selectors.getReserveTokensAddresses, manifest.assets.USDC.underlyingAsset),
    ),
    operation(
      'call:usdt-reserve-tokens',
      'eth_call',
      manifest.contracts.protocolDataProvider,
      calldata(manifest.selectors.getReserveTokensAddresses, manifest.assets.USDT.underlyingAsset),
    ),
  ],
} as const satisfies AaveV3EthereumFinalizedRpcReadPlan);

export const AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256 = createHash('sha256')
  .update(JSON.stringify(AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN), 'utf8')
  .digest('hex');

function operation(
  operationId: string,
  method: 'eth_call' | 'eth_getCode',
  target: string,
  operationCalldata?: `0x${string}`,
  from?: string,
): Readonly<{
  operationId: string;
  method: 'eth_call' | 'eth_getCode';
  target: `0x${string}`;
  blockParameter: Readonly<{
    blockHash: 'CAPTURED_FINALIZED_BLOCK_HASH';
    requireCanonical: true;
  }>;
  calldata?: `0x${string}`;
  from?: `0x${string}`;
}> {
  const base = {
    operationId,
    method,
    target: target.toLowerCase() as `0x${string}`,
    blockParameter: Object.freeze({
      blockHash: 'CAPTURED_FINALIZED_BLOCK_HASH' as const,
      requireCanonical: true as const,
    }),
  };
  if (operationCalldata !== undefined && from !== undefined) {
    return Object.freeze({
      ...base,
      calldata: operationCalldata,
      from: from.toLowerCase() as `0x${string}`,
    });
  }
  if (operationCalldata !== undefined)
    return Object.freeze({ ...base, calldata: operationCalldata });
  return Object.freeze(base);
}

interface ParsedBlock {
  readonly number: bigint;
  readonly hash: `0x${string}`;
  readonly parentHash: `0x${string}`;
  readonly stateRoot: `0x${string}`;
  readonly timestamp: string;
}

interface ParsedObservation {
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly finalizedBlock: ParsedBlock;
  readonly runtimeCodeKeccak256: AaveV3EthereumDeploymentEvidence['runtimeCodeKeccak256'];
  readonly reserves: AaveV3EthereumDeploymentEvidence['reserves'];
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

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') return unavailable();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return unavailable();
  }
  return value;
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_REFERENCE.test(value)) return unavailable();
  return value;
}

function block(value: unknown, evaluatedAt: string): ParsedBlock {
  const record = exactDataRecord(value, ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp']);
  if (
    typeof record.number !== 'string' ||
    !HEX_QUANTITY.test(record.number) ||
    record.number.length > 18 ||
    typeof record.hash !== 'string' ||
    !BLOCK_HASH.test(record.hash) ||
    typeof record.parentHash !== 'string' ||
    !BLOCK_HASH.test(record.parentHash) ||
    typeof record.stateRoot !== 'string' ||
    !BLOCK_HASH.test(record.stateRoot) ||
    typeof record.timestamp !== 'string' ||
    !HEX_QUANTITY.test(record.timestamp) ||
    record.timestamp.length > 18
  ) {
    return unavailable();
  }
  const number = BigInt(record.number);
  const timestampSeconds = BigInt(record.timestamp);
  const maximumTimestampSeconds = BigInt(Math.floor(Date.parse(evaluatedAt) / 1_000));
  if (
    number <= 0n ||
    number > MAX_UINT64 ||
    record.hash === ZERO_BLOCK_HASH ||
    record.parentHash === ZERO_BLOCK_HASH ||
    record.stateRoot === ZERO_BLOCK_HASH ||
    record.hash === record.parentHash ||
    timestampSeconds < ETHEREUM_GENESIS_TIMESTAMP_SECONDS ||
    timestampSeconds > maximumTimestampSeconds
  ) {
    return unavailable();
  }
  const timestampMilliseconds = timestampSeconds * 1_000n;
  if (timestampMilliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return unavailable();
  return Object.freeze({
    number,
    hash: record.hash as `0x${string}`,
    parentHash: record.parentHash as `0x${string}`,
    stateRoot: record.stateRoot as `0x${string}`,
    timestamp: new Date(Number(timestampMilliseconds)).toISOString(),
  });
}

function sameBlock(left: ParsedBlock, right: ParsedBlock): boolean {
  return (
    left.number === right.number &&
    left.hash === right.hash &&
    left.parentHash === right.parentHash &&
    left.stateRoot === right.stateRoot &&
    left.timestamp === right.timestamp
  );
}

function runtimeCode(value: unknown): Hex {
  if (
    typeof value !== 'string' ||
    !/^0x(?:[0-9a-fA-F]{2})+$/u.test(value) ||
    value.length > 2 + MAX_RUNTIME_CODE_BYTES * 2 ||
    /^0x(?:00)+$/iu.test(value)
  ) {
    return unavailable();
  }
  return value.toLowerCase() as Hex;
}

function runtimeCodeHashes(
  value: unknown,
): AaveV3EthereumDeploymentEvidence['runtimeCodeKeccak256'] {
  const record = exactDataRecord(value, [
    'poolAddressesProvider',
    'poolProxy',
    'poolImplementation',
    'protocolDataProvider',
    'usdcAToken',
    'usdcVariableDebtToken',
    'usdtAToken',
    'usdtVariableDebtToken',
  ]);
  return Object.freeze({
    poolAddressesProvider: keccak256(runtimeCode(record.poolAddressesProvider)),
    poolProxy: keccak256(runtimeCode(record.poolProxy)),
    poolImplementation: keccak256(runtimeCode(record.poolImplementation)),
    protocolDataProvider: keccak256(runtimeCode(record.protocolDataProvider)),
    usdcAToken: keccak256(runtimeCode(record.usdcAToken)),
    usdcVariableDebtToken: keccak256(runtimeCode(record.usdcVariableDebtToken)),
    usdtAToken: keccak256(runtimeCode(record.usdtAToken)),
    usdtVariableDebtToken: keccak256(runtimeCode(record.usdtVariableDebtToken)),
  });
}

function abiAddressWord(value: string): `0x${string}` {
  if (!/^0x0{24}[0-9a-fA-F]{40}$/u.test(value)) return unavailable();
  return `0x${value.slice(-40).toLowerCase()}`;
}

function decodedAddress(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || value.length !== 66) return unavailable();
  return abiAddressWord(value);
}

function decodedReserveTokens(
  value: unknown,
  expected: Readonly<{ underlyingAsset: string; aToken: string; variableDebtToken: string }>,
): AaveV3EthereumReserveTokenEvidence {
  if (typeof value !== 'string' || value.length !== 194 || !/^0x[0-9a-fA-F]{192}$/u.test(value)) {
    return unavailable();
  }
  const aToken = abiAddressWord(`0x${value.slice(2, 66)}`);
  const stableDebtToken = abiAddressWord(`0x${value.slice(66, 130)}`);
  const variableDebtToken = abiAddressWord(`0x${value.slice(130, 194)}`);
  if (
    aToken === ZERO_ADDRESS ||
    stableDebtToken !== ZERO_ADDRESS ||
    variableDebtToken === ZERO_ADDRESS ||
    aToken !== expected.aToken.toLowerCase() ||
    variableDebtToken !== expected.variableDebtToken.toLowerCase()
  ) {
    return unavailable();
  }
  return Object.freeze({
    underlyingAsset: expected.underlyingAsset.toLowerCase() as `0x${string}`,
    aToken,
    stableDebtToken,
    variableDebtToken,
  });
}

function exactAddress(value: unknown, expected: string): void {
  const observed = decodedAddress(value);
  if (observed === ZERO_ADDRESS || observed !== expected.toLowerCase()) return unavailable();
}

function operationBlockBindings(value: unknown, expectedBlockHash: string): void {
  const operationIds = AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.operations.map(
    ({ operationId }) => operationId,
  );
  const bindings = exactDataRecord(value, operationIds);
  for (const operationId of operationIds) {
    const binding = exactDataRecord(bindings[operationId], ['blockHash', 'requireCanonical']);
    if (binding.blockHash !== expectedBlockHash || binding.requireCanonical !== true) {
      return unavailable();
    }
  }
}

function parseObservation(value: unknown, evaluatedAt: string): ParsedObservation {
  const record = exactDataRecord(value, [
    'schemaVersion',
    'sourceReferenceId',
    'sourceObservationId',
    'networkId',
    'chainId',
    'blockSelector',
    'blockBinding',
    'manifestFingerprintSha256',
    'assetRegistryFingerprintSha256',
    'readPlanFingerprintSha256',
    'finalizedBlockBefore',
    'finalizedBlockAfter',
    'operationBlockBindings',
    'code',
    'calls',
  ]);
  if (
    record.schemaVersion !== 1 ||
    record.networkId !== 'eip155:1' ||
    record.chainId !== '0x1' ||
    record.blockSelector !== 'finalized' ||
    record.blockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' ||
    record.manifestFingerprintSha256 !== manifest.manifestFingerprintSha256 ||
    record.assetRegistryFingerprintSha256 !==
      CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256 ||
    record.readPlanFingerprintSha256 !== AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256
  ) {
    return unavailable();
  }
  const finalizedBlock = block(record.finalizedBlockBefore, evaluatedAt);
  const finalizedBlockAfter = block(record.finalizedBlockAfter, evaluatedAt);
  if (!sameBlock(finalizedBlock, finalizedBlockAfter)) return unavailable();
  operationBlockBindings(record.operationBlockBindings, finalizedBlock.hash);

  const calls = exactDataRecord(record.calls, [
    'providerGetPool',
    'providerGetPoolDataProvider',
    'poolAddressesProvider',
    'dataProviderAddressesProvider',
    'dataProviderPool',
    'poolImplementationFromAdmin',
    'usdcReserveTokens',
    'usdtReserveTokens',
  ]);
  exactAddress(calls.providerGetPool, manifest.contracts.poolProxy);
  exactAddress(calls.providerGetPoolDataProvider, manifest.contracts.protocolDataProvider);
  exactAddress(calls.poolAddressesProvider, manifest.contracts.poolAddressesProvider);
  exactAddress(calls.dataProviderAddressesProvider, manifest.contracts.poolAddressesProvider);
  exactAddress(calls.dataProviderPool, manifest.contracts.poolProxy);
  exactAddress(calls.poolImplementationFromAdmin, manifest.contracts.poolImplementation);

  const reserves = Object.freeze({
    USDC: decodedReserveTokens(calls.usdcReserveTokens, manifest.assets.USDC),
    USDT: decodedReserveTokens(calls.usdtReserveTokens, manifest.assets.USDT),
  });
  return Object.freeze({
    sourceReferenceId: reference(record.sourceReferenceId),
    sourceObservationId: reference(record.sourceObservationId),
    finalizedBlock,
    runtimeCodeKeccak256: runtimeCodeHashes(record.code),
    reserves,
  });
}

function requestData(value: unknown): Readonly<Record<'evaluatedAt' | 'correlationId', unknown>> {
  const record = exactDataRecord(value, ['evaluatedAt', 'correlationId']);
  return Object.freeze({
    evaluatedAt: record.evaluatedAt,
    correlationId: record.correlationId,
  });
}

function evidenceFingerprint(observation: ParsedObservation, observedAt: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        EVIDENCE_FINGERPRINT_DOMAIN,
        1,
        'AAVE_V3_ETHEREUM_FINALIZED_RPC',
        'DEPLOYMENT_CORROBORATION_ONLY',
        false,
        false,
        'eip155:1',
        '0x1',
        'finalized',
        'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
        true,
        true,
        true,
        'SOURCE_ATTESTED_UNVERIFIED',
        'UNVERIFIED',
        false,
        false,
        false,
        false,
        'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
        'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
        observation.sourceReferenceId,
        observation.sourceObservationId,
        manifest.manifestFingerprintSha256,
        CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256,
        AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
        observedAt,
        [
          observation.finalizedBlock.number.toString(),
          observation.finalizedBlock.hash,
          observation.finalizedBlock.parentHash,
          observation.finalizedBlock.stateRoot,
          observation.finalizedBlock.timestamp,
        ],
        [
          observation.runtimeCodeKeccak256.poolAddressesProvider,
          observation.runtimeCodeKeccak256.poolProxy,
          observation.runtimeCodeKeccak256.poolImplementation,
          observation.runtimeCodeKeccak256.protocolDataProvider,
          observation.runtimeCodeKeccak256.usdcAToken,
          observation.runtimeCodeKeccak256.usdcVariableDebtToken,
          observation.runtimeCodeKeccak256.usdtAToken,
          observation.runtimeCodeKeccak256.usdtVariableDebtToken,
        ],
        [
          [
            observation.reserves.USDC.underlyingAsset,
            observation.reserves.USDC.aToken,
            observation.reserves.USDC.stableDebtToken,
            observation.reserves.USDC.variableDebtToken,
          ],
          [
            observation.reserves.USDT.underlyingAsset,
            observation.reserves.USDT.aToken,
            observation.reserves.USDT.stableDebtToken,
            observation.reserves.USDT.variableDebtToken,
          ],
        ],
      ]),
      'utf8',
    )
    .digest('hex');
}

@Injectable()
export class AaveV3EthereumDeploymentEvidenceAdapter implements AaveV3EthereumDeploymentEvidenceReader {
  constructor(
    @Inject(AAVE_V3_ETHEREUM_FINALIZED_RPC_SOURCE)
    private readonly source: AaveV3EthereumFinalizedRpcSource,
  ) {}

  async readCurrentDeploymentEvidence(
    request: ReadAaveV3EthereumDeploymentEvidenceRequest,
  ): Promise<AaveV3EthereumDeploymentEvidence> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const input = requestData(request);
      const observedAt = canonicalTimestamp(input.evaluatedAt);
      if (typeof input.correlationId !== 'string' || !UUID_V4.test(input.correlationId)) {
        return unavailable();
      }
      if (
        !SHA256.test(manifest.manifestFingerprintSha256) ||
        !SHA256.test(AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256)
      ) {
        return unavailable();
      }

      const deadlineAtMilliseconds = Date.now() + READ_DEADLINE_MILLISECONDS;
      const deadlineAt = new Date(deadlineAtMilliseconds).toISOString();
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new AaveV3EthereumDeploymentEvidenceUnavailableError());
        }, READ_DEADLINE_MILLISECONDS);
        timeout.unref();
      });
      const raw = await Promise.race([
        this.source.readFinalizedDeployment(
          Object.freeze({
            correlationId: input.correlationId,
            deadlineAt,
            signal: controller.signal,
            plan: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN,
          }),
        ),
        deadline,
      ]);
      if (Date.now() >= deadlineAtMilliseconds) return unavailable();
      const observation = parseObservation(raw, observedAt);
      if (Date.now() >= deadlineAtMilliseconds) return unavailable();
      const fingerprint = evidenceFingerprint(observation, observedAt);
      if (Date.now() >= deadlineAtMilliseconds) return unavailable();
      return deepFreeze({
        schemaVersion: 1,
        sourceId: 'AAVE_V3_ETHEREUM_FINALIZED_RPC',
        use: 'DEPLOYMENT_CORROBORATION_ONLY',
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
        networkId: 'eip155:1',
        chainId: '0x1',
        blockSelector: 'finalized',
        blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
        observedChainIdentityMatchesPolicy: true,
        manifestBindingValidated: true,
        observedDeploymentTopologyMatchesManifest: true,
        blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED',
        runtimeCodeApprovalStatus: 'UNVERIFIED',
        sourceProviderApproved: false,
        exactHostEgressApproved: false,
        liveCapabilityProofValidated: false,
        independentFinalizedSourcesAgree: false,
        freshnessStatus: 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
        finalityStatus: 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
        sourceReferenceId: observation.sourceReferenceId,
        sourceObservationId: observation.sourceObservationId,
        deploymentManifestFingerprintSha256: manifest.manifestFingerprintSha256,
        assetRegistryFingerprintSha256:
          CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256,
        readPlanFingerprintSha256: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
        evidenceFingerprintSha256: fingerprint,
        evidenceId: `aave-v3-ethereum-deployment:${fingerprint}`,
        observedAt,
        finalizedBlock: observation.finalizedBlock,
        runtimeCodeKeccak256: observation.runtimeCodeKeccak256,
        reserves: observation.reserves,
      } as const satisfies AaveV3EthereumDeploymentEvidence);
    } catch {
      return unavailable();
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      controller.abort();
    }
  }
}
