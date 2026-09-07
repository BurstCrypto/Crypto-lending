import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { BalanceSyncIndexerFailure } from '../../domain/balance-sync';
import {
  createEthereumMainnetBalanceDeploymentIdentityVerifier,
  reviewBalanceSyncExecutionContext,
  type BalanceSyncExecutionContext,
  type EthereumMainnetBalanceDeploymentIdentityVerificationRequest,
  type EthereumMainnetBalanceDeploymentIdentityVerifierPort,
} from '../../application/ports/balance-sync.ports';
import {
  ETHEREUM_MAINNET_BALANCE_ASSETS,
  ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS,
  ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES,
  ethereumMainnetBalanceDeploymentManifestFingerprintSha256,
  parseApprovedEthereumMainnetBalanceDeploymentManifest,
  type ApprovedEthereumMainnetBalanceDeploymentManifest,
  type EthereumMainnetBalanceAddress,
  type EthereumMainnetBalanceDeploymentEpoch,
  type EthereumMainnetBalanceDeploymentRoute,
  type EthereumMainnetBalanceRuntimeCodeIdentity,
} from './ethereum-mainnet-balance-deployment.manifest';
import {
  allowedRecord,
  exchangeBalanceRpc,
  type BalanceJsonRpcRequest,
  type BalanceJsonRpcTransport,
} from './balance-json-rpc';

export const EIP1967_IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;
export const EIP1967_BEACON_SLOT =
  '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50' as const;
export const EIP1967_ADMIN_SLOT =
  '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103' as const;
export const LEGACY_ZEPPELIN_IMPLEMENTATION_SLOT =
  '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3' as const;
export const LEGACY_ZEPPELIN_ADMIN_SLOT =
  '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390' as const;

const IMPLEMENTATION_SELECTOR = '0x5c60da1b';
const DECIMALS_SELECTOR = '0x313ce567';
const TETHER_DEPRECATED_SELECTOR = '0x0e136b19';
const TETHER_UPGRADED_ADDRESS_SELECTOR = '0x26976e3f';
const WORD = /^0x[0-9a-f]{64}$/u;
const CODE = /^0x(?:[0-9a-f]{2})+$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_WORD = `0x${'0'.repeat(64)}`;

const ETHEREUM_BLOCK_KEYS = Object.freeze([
  'baseFeePerGas',
  'blobGasUsed',
  'difficulty',
  'excessBlobGas',
  'extraData',
  'gasLimit',
  'gasUsed',
  'hash',
  'logsBloom',
  'miner',
  'mixHash',
  'nonce',
  'number',
  'parentBeaconBlockRoot',
  'parentHash',
  'receiptsRoot',
  'requestsHash',
  'sha3Uncles',
  'size',
  'stateRoot',
  'timestamp',
  'totalDifficulty',
  'transactions',
  'transactionsRoot',
  'uncles',
  'withdrawals',
  'withdrawalsRoot',
] as const);

export interface DormantEthereumMainnetBalanceDeploymentIdentityVerifierConfig {
  readonly transport: BalanceJsonRpcTransport;
  readonly approvedManifest: unknown;
  readonly requiredApprovedManifestFingerprintSha256: string;
}

interface RpcReader {
  readonly read: (method: string, params: readonly unknown[]) => Promise<unknown>;
  readonly count: () => number;
}

interface ProxySlots {
  readonly eip1967ImplementationWord: string;
  readonly eip1967Implementation: EthereumMainnetBalanceAddress | null;
  readonly eip1967BeaconWord: string;
  readonly eip1967Beacon: EthereumMainnetBalanceAddress | null;
  readonly legacyZeppelinImplementationWord: string;
  readonly legacyZeppelinImplementation: EthereumMainnetBalanceAddress | null;
}

interface AssetProxySlots extends ProxySlots {
  readonly eip1967AdminWord: string;
  readonly eip1967Admin: EthereumMainnetBalanceAddress | null;
  readonly legacyZeppelinAdminWord: string;
  readonly legacyZeppelinAdmin: EthereumMainnetBalanceAddress | null;
}

interface RuntimeObservation {
  readonly byteLength: number;
  readonly sha256: string;
}

/**
 * Builds a real verifier capability but performs no I/O until the opaque port is
 * invoked. No checked-in manifest is approved, and this factory is not composed
 * or barrel-exported by the application.
 */
export function createDormantEthereumMainnetBalanceDeploymentIdentityVerifier(
  config: DormantEthereumMainnetBalanceDeploymentIdentityVerifierConfig,
): EthereumMainnetBalanceDeploymentIdentityVerifierPort {
  let manifest: ApprovedEthereumMainnetBalanceDeploymentManifest;
  let approvedManifestFingerprintSha256: string;
  let transport: BalanceJsonRpcTransport;
  try {
    const snapshot = exactConfig(config);
    manifest = parseApprovedEthereumMainnetBalanceDeploymentManifest(snapshot.approvedManifest);
    approvedManifestFingerprintSha256 =
      ethereumMainnetBalanceDeploymentManifestFingerprintSha256(manifest);
    if (
      typeof snapshot.requiredApprovedManifestFingerprintSha256 !== 'string' ||
      !SHA256.test(snapshot.requiredApprovedManifestFingerprintSha256) ||
      snapshot.requiredApprovedManifestFingerprintSha256 === '0'.repeat(64) ||
      snapshot.requiredApprovedManifestFingerprintSha256 !== approvedManifestFingerprintSha256
    ) {
      throw new TypeError('manifest approval fingerprint mismatch');
    }
    transport = reviewedTransport(snapshot.transport);
  } catch {
    throw new TypeError('Ethereum mainnet balance deployment identity verifier unavailable');
  }

  return createEthereumMainnetBalanceDeploymentIdentityVerifier(async (request, execution) =>
    verifyDeploymentIdentity(
      transport,
      manifest,
      approvedManifestFingerprintSha256,
      request,
      execution,
    ),
  );
}

async function verifyDeploymentIdentity(
  transport: BalanceJsonRpcTransport,
  manifest: ApprovedEthereumMainnetBalanceDeploymentManifest,
  approvedManifestFingerprintSha256: string,
  request: Readonly<EthereumMainnetBalanceDeploymentIdentityVerificationRequest>,
  execution: BalanceSyncExecutionContext,
): Promise<unknown> {
  requireActiveExecution(execution);
  if (
    request.networkId !== manifest.networkId ||
    request.assetIdentities.length !== ETHEREUM_MAINNET_BALANCE_ASSETS.length ||
    request.assetIdentities.some(
      (identity, index) => identity !== ETHEREUM_MAINNET_BALANCE_ASSETS[index]?.address,
    )
  ) {
    return fail();
  }
  const position = BigInt(request.sourcePosition);
  const selected = manifest.assets.map((asset) => {
    const matching = asset.epochs.filter(
      (epoch) =>
        position >= BigInt(epoch.validFromBlock) &&
        (epoch.validThroughBlock === null || position <= BigInt(epoch.validThroughBlock)),
    );
    if (matching.length !== 1) return fail();
    return matching[0] as EthereumMainnetBalanceDeploymentEpoch;
  });
  const rpc = createRpcReader(transport, execution, manifest.maximumRpcReads);
  const blockNumber = `0x${position.toString(16)}`;
  const exactBlock = Object.freeze({
    blockHash: request.sourceHash,
    requireCanonical: true as const,
  });

  await assertChainAndBlock(rpc, blockNumber, request.sourceHash);
  const observations: unknown[] = [];
  for (let index = 0; index < manifest.assets.length; index += 1) {
    const asset = manifest.assets[index];
    const epoch = selected[index];
    if (asset === undefined || epoch === undefined) return fail();
    observations.push(await observeAsset(rpc, asset, epoch, exactBlock));
  }
  await assertChainAndBlock(rpc, blockNumber, request.sourceHash);
  requireActiveExecution(execution);
  if (rpc.count() > ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS) return fail();

  const observedIdentityFingerprintSha256 = createHash('sha256')
    .update(
      JSON.stringify([
        'crypto-lending:ethereum-mainnet-balance-deployment-observation:v1',
        approvedManifestFingerprintSha256,
        request.networkId,
        request.sourcePosition,
        request.sourceHash,
        request.assetIdentities,
        observations,
      ]),
      'utf8',
    )
    .digest('hex');
  return Object.freeze({
    deploymentIdentityValidated: true as const,
    approvedManifestFingerprintSha256,
    observedIdentityFingerprintSha256,
  });
}

async function assertChainAndBlock(
  rpc: RpcReader,
  expectedNumber: string,
  expectedHash: string,
): Promise<void> {
  if ((await rpc.read('eth_chainId', [])) !== '0x1') return fail();
  const block = allowedRecord(
    await rpc.read('eth_getBlockByNumber', [expectedNumber, false]),
    ['number', 'hash'],
    ETHEREUM_BLOCK_KEYS,
  );
  if (block.number !== expectedNumber || block.hash !== expectedHash) return fail();
}

async function observeAsset(
  rpc: RpcReader,
  asset: ApprovedEthereumMainnetBalanceDeploymentManifest['assets'][number],
  epoch: EthereumMainnetBalanceDeploymentEpoch,
  exactBlock: Readonly<{ readonly blockHash: string; readonly requireCanonical: true }>,
): Promise<readonly unknown[]> {
  const slots = await readAssetProxySlots(rpc, asset.address, exactBlock);
  const expectedProxyCode =
    epoch.deployment.kind === 'DIRECT'
      ? epoch.deployment.runtimeCode
      : epoch.deployment.proxyRuntimeCode;
  const assetCode = await checkedRuntimeCode(rpc, asset.address, expectedProxyCode, exactBlock);
  const decimalsWord = await checkedCallWord(rpc, asset.address, DECIMALS_SELECTOR, exactBlock);
  if (BigInt(decimalsWord) !== BigInt(asset.decimals)) return fail();
  const routeObservation = await observeRoute(
    rpc,
    asset.stablecoin,
    asset.address,
    epoch.deployment,
    slots,
    exactBlock,
  );
  return Object.freeze([
    asset.stablecoin,
    asset.address,
    asset.decimals,
    epoch.validFromBlock,
    epoch.validThroughBlock,
    epoch.evidence.captureBlockNumber,
    epoch.evidence.captureBlockHash,
    epoch.evidence.sha256,
    canonicalRuntimeObservation(assetCode),
    canonicalAssetSlots(slots),
    decimalsWord,
    routeObservation,
  ]);
}

async function observeRoute(
  rpc: RpcReader,
  stablecoin: string,
  assetAddress: EthereumMainnetBalanceAddress,
  route: EthereumMainnetBalanceDeploymentRoute,
  slots: AssetProxySlots,
  exactBlock: Readonly<{ readonly blockHash: string; readonly requireCanonical: true }>,
): Promise<readonly unknown[]> {
  switch (route.kind) {
    case 'DIRECT': {
      assertAssetSlots(slots, null, null, null, null, null);
      if (route.semantics === 'TETHER_DEPRECATION_GUARD') {
        if (stablecoin !== 'USDT') return fail();
        const deprecated = await checkedCallWord(
          rpc,
          assetAddress,
          TETHER_DEPRECATED_SELECTOR,
          exactBlock,
        );
        const upgradedAddress = await checkedCallWord(
          rpc,
          assetAddress,
          TETHER_UPGRADED_ADDRESS_SELECTOR,
          exactBlock,
        );
        if (deprecated !== ZERO_WORD || wordAddress(upgradedAddress) !== null) return fail();
        return Object.freeze([route.kind, route.semantics, deprecated, upgradedAddress]);
      }
      if (stablecoin === 'USDT') return fail();
      return Object.freeze([route.kind, route.semantics]);
    }
    case 'EIP1967_IMPLEMENTATION': {
      assertAssetSlots(slots, route.implementation, null, null, route.admin, null);
      const implementation = await checkedNonProxyRuntime(
        rpc,
        route.implementation,
        route.implementationRuntimeCode,
        exactBlock,
      );
      return Object.freeze([
        route.kind,
        route.implementation,
        canonicalRuntimeObservation(implementation.runtime),
        canonicalProxySlots(implementation.slots),
        route.admin,
      ]);
    }
    case 'LEGACY_ZEPPELIN_IMPLEMENTATION': {
      assertAssetSlots(slots, null, null, route.implementation, null, route.admin);
      const implementation = await checkedNonProxyRuntime(
        rpc,
        route.implementation,
        route.implementationRuntimeCode,
        exactBlock,
      );
      return Object.freeze([
        route.kind,
        route.implementation,
        canonicalRuntimeObservation(implementation.runtime),
        canonicalProxySlots(implementation.slots),
        route.admin,
      ]);
    }
    case 'EIP1967_BEACON': {
      assertAssetSlots(slots, null, route.beacon, null, route.admin, null);
      const beacon = await checkedNonProxyRuntime(
        rpc,
        route.beacon,
        route.beaconRuntimeCode,
        exactBlock,
      );
      const returnedImplementationWord = await checkedCallWord(
        rpc,
        route.beacon,
        IMPLEMENTATION_SELECTOR,
        exactBlock,
      );
      if (wordAddress(returnedImplementationWord) !== route.implementation) return fail();
      const implementation = await checkedNonProxyRuntime(
        rpc,
        route.implementation,
        route.implementationRuntimeCode,
        exactBlock,
      );
      return Object.freeze([
        route.kind,
        route.beacon,
        canonicalRuntimeObservation(beacon.runtime),
        canonicalProxySlots(beacon.slots),
        returnedImplementationWord,
        route.implementation,
        canonicalRuntimeObservation(implementation.runtime),
        canonicalProxySlots(implementation.slots),
        route.admin,
      ]);
    }
  }
}

async function checkedNonProxyRuntime(
  rpc: RpcReader,
  address: EthereumMainnetBalanceAddress,
  expected: EthereumMainnetBalanceRuntimeCodeIdentity,
  exactBlock: Readonly<{ readonly blockHash: string; readonly requireCanonical: true }>,
): Promise<Readonly<{ readonly runtime: RuntimeObservation; readonly slots: ProxySlots }>> {
  const runtime = await checkedRuntimeCode(rpc, address, expected, exactBlock);
  const slots = await readProxySlots(rpc, address, exactBlock);
  if (
    slots.eip1967Implementation !== null ||
    slots.eip1967Beacon !== null ||
    slots.legacyZeppelinImplementation !== null
  ) {
    return fail();
  }
  return Object.freeze({ runtime, slots });
}

async function checkedRuntimeCode(
  rpc: RpcReader,
  address: EthereumMainnetBalanceAddress,
  expected: EthereumMainnetBalanceRuntimeCodeIdentity,
  exactBlock: Readonly<{ readonly blockHash: string; readonly requireCanonical: true }>,
): Promise<RuntimeObservation> {
  const value = await rpc.read('eth_getCode', [address, exactBlock]);
  if (typeof value !== 'string' || !CODE.test(value)) return fail();
  const bytes = Buffer.from(value.slice(2), 'hex');
  if (bytes.length < 1 || bytes.length > ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES) {
    return fail();
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== expected.byteLength || sha256 !== expected.sha256) return fail();
  return Object.freeze({ byteLength: bytes.length, sha256 });
}

async function readAssetProxySlots(
  rpc: RpcReader,
  address: EthereumMainnetBalanceAddress,
  exactBlock: Readonly<{ readonly blockHash: string; readonly requireCanonical: true }>,
): Promise<AssetProxySlots> {
  const base = await readProxySlots(rpc, address, exactBlock);
  const eip1967AdminWord = await readStorageWord(rpc, address, EIP1967_ADMIN_SLOT, exactBlock);
  const legacyZeppelinAdminWord = await readStorageWord(
    rpc,
    address,
    LEGACY_ZEPPELIN_ADMIN_SLOT,
    exactBlock,
  );
  return Object.freeze({
    ...base,
    eip1967AdminWord,
    eip1967Admin: wordAddress(eip1967AdminWord),
    legacyZeppelinAdminWord,
    legacyZeppelinAdmin: wordAddress(legacyZeppelinAdminWord),
  });
}

async function readProxySlots(
  rpc: RpcReader,
  address: EthereumMainnetBalanceAddress,
  exactBlock: Readonly<{ readonly blockHash: string; readonly requireCanonical: true }>,
): Promise<ProxySlots> {
  const eip1967ImplementationWord = await readStorageWord(
    rpc,
    address,
    EIP1967_IMPLEMENTATION_SLOT,
    exactBlock,
  );
  const eip1967BeaconWord = await readStorageWord(rpc, address, EIP1967_BEACON_SLOT, exactBlock);
  const legacyZeppelinImplementationWord = await readStorageWord(
    rpc,
    address,
    LEGACY_ZEPPELIN_IMPLEMENTATION_SLOT,
    exactBlock,
  );
  return Object.freeze({
    eip1967ImplementationWord,
    eip1967Implementation: wordAddress(eip1967ImplementationWord),
    eip1967BeaconWord,
    eip1967Beacon: wordAddress(eip1967BeaconWord),
    legacyZeppelinImplementationWord,
    legacyZeppelinImplementation: wordAddress(legacyZeppelinImplementationWord),
  });
}

async function readStorageWord(
  rpc: RpcReader,
  address: EthereumMainnetBalanceAddress,
  slot: string,
  exactBlock: Readonly<{ readonly blockHash: string; readonly requireCanonical: true }>,
): Promise<string> {
  const value = await rpc.read('eth_getStorageAt', [address, slot, exactBlock]);
  if (typeof value !== 'string' || !WORD.test(value)) return fail();
  return value;
}

async function checkedCallWord(
  rpc: RpcReader,
  address: EthereumMainnetBalanceAddress,
  data: string,
  exactBlock: Readonly<{ readonly blockHash: string; readonly requireCanonical: true }>,
): Promise<string> {
  const value = await rpc.read('eth_call', [Object.freeze({ data, to: address }), exactBlock]);
  if (typeof value !== 'string' || !WORD.test(value)) return fail();
  return value;
}

function assertAssetSlots(
  actual: AssetProxySlots,
  eip1967Implementation: EthereumMainnetBalanceAddress | null,
  eip1967Beacon: EthereumMainnetBalanceAddress | null,
  legacyZeppelinImplementation: EthereumMainnetBalanceAddress | null,
  eip1967Admin: EthereumMainnetBalanceAddress | null,
  legacyZeppelinAdmin: EthereumMainnetBalanceAddress | null,
): void {
  if (
    actual.eip1967Implementation !== eip1967Implementation ||
    actual.eip1967Beacon !== eip1967Beacon ||
    actual.legacyZeppelinImplementation !== legacyZeppelinImplementation ||
    actual.eip1967Admin !== eip1967Admin ||
    actual.legacyZeppelinAdmin !== legacyZeppelinAdmin
  ) {
    return fail();
  }
}

function wordAddress(word: string): EthereumMainnetBalanceAddress | null {
  if (!WORD.test(word) || word.slice(2, 26) !== '0'.repeat(24)) return fail();
  const address = `0x${word.slice(26)}` as EthereumMainnetBalanceAddress;
  return address === `0x${'0'.repeat(40)}` ? null : address;
}

function canonicalAssetSlots(value: AssetProxySlots): readonly string[] {
  return Object.freeze([
    value.eip1967ImplementationWord,
    value.eip1967BeaconWord,
    value.legacyZeppelinImplementationWord,
    value.eip1967AdminWord,
    value.legacyZeppelinAdminWord,
  ]);
}

function canonicalProxySlots(value: ProxySlots): readonly string[] {
  return Object.freeze([
    value.eip1967ImplementationWord,
    value.eip1967BeaconWord,
    value.legacyZeppelinImplementationWord,
  ]);
}

function canonicalRuntimeObservation(value: RuntimeObservation): readonly unknown[] {
  return Object.freeze([value.byteLength, value.sha256]);
}

function createRpcReader(
  transport: BalanceJsonRpcTransport,
  execution: BalanceSyncExecutionContext,
  maximumReads: number,
): RpcReader {
  let reads = 0;
  return Object.freeze({
    read: async (method: string, params: readonly unknown[]): Promise<unknown> => {
      requireActiveExecution(execution);
      reads += 1;
      if (reads > maximumReads || reads > ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS) return fail();
      const result = await exchangeBalanceRpc(transport, method, params, execution);
      requireActiveExecution(execution);
      return result;
    },
    count: (): number => reads,
  });
}

function requireActiveExecution(execution: BalanceSyncExecutionContext): void {
  if (reviewBalanceSyncExecutionContext(execution)?.abortKind !== null) {
    throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
  }
}

function reviewedTransport(value: unknown): BalanceJsonRpcTransport {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) {
      throw new TypeError('invalid balance JSON-RPC transport');
    }
    const receiver = value;
    let owner: object | null = receiver;
    for (let depth = 0; owner !== null && owner !== Object.prototype && depth < 8; depth += 1) {
      if (isProxy(owner)) throw new TypeError('invalid balance JSON-RPC transport');
      const descriptor = Object.getOwnPropertyDescriptor(owner, 'exchange');
      if (descriptor !== undefined) {
        if (
          !('value' in descriptor) ||
          typeof descriptor.value !== 'function' ||
          isProxy(descriptor.value)
        ) {
          throw new TypeError('invalid balance JSON-RPC transport');
        }
        const exchange = descriptor.value as BalanceJsonRpcTransport['exchange'];
        return Object.freeze({
          exchange: (request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown> =>
            Reflect.apply(exchange, receiver, [request, signal]) as Promise<unknown>,
        });
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
  } catch {
    throw new TypeError('invalid balance JSON-RPC transport');
  }
  throw new TypeError('invalid balance JSON-RPC transport');
}

function exactConfig(value: unknown): Readonly<{
  readonly transport: unknown;
  readonly approvedManifest: unknown;
  readonly requiredApprovedManifestFingerprintSha256: unknown;
}> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    throw new TypeError('invalid verifier configuration');
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('invalid verifier configuration');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = ['transport', 'approvedManifest', 'requiredApprovedManifestFingerprintSha256'];
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new TypeError('invalid verifier configuration');
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError('invalid verifier configuration');
    }
    result[key] = descriptor.value;
  }
  return result as never;
}

function fail(): never {
  throw new BalanceSyncIndexerFailure('PROVIDER_INVALID_DATA');
}
