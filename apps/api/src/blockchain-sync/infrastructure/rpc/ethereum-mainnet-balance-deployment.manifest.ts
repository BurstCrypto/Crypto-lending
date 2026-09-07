import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const UINT64_DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/u;
const MAX_UINT64 = (1n << 64n) - 1n;

export const ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS = 64 as const;
export const ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES = 24_576 as const;
export const ETHEREUM_MAINNET_BALANCE_MAXIMUM_EPOCHS_PER_ASSET = 16 as const;
export const ETHEREUM_MAINNET_BALANCE_ASSET_REGISTRY_FINGERPRINT_SHA256 =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d' as const;

export const ETHEREUM_MAINNET_BALANCE_ASSETS = Object.freeze([
  Object.freeze({
    stablecoin: 'PYUSD' as const,
    address: '0x6c3ea9036406852006290770bedfcaba0e23a0e8' as const,
    decimals: 6 as const,
  }),
  Object.freeze({
    stablecoin: 'USDC' as const,
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const,
    decimals: 6 as const,
  }),
  Object.freeze({
    stablecoin: 'USDT' as const,
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7' as const,
    decimals: 6 as const,
  }),
]);

export type EthereumMainnetBalanceStablecoin =
  (typeof ETHEREUM_MAINNET_BALANCE_ASSETS)[number]['stablecoin'];
export type EthereumMainnetBalanceAddress = `0x${string}`;

export interface EthereumMainnetBalanceRuntimeCodeIdentity {
  readonly byteLength: number;
  readonly sha256: string;
}

export interface EthereumMainnetBalanceDirectDeployment {
  readonly kind: 'DIRECT';
  readonly runtimeCode: EthereumMainnetBalanceRuntimeCodeIdentity;
  readonly semantics: 'LOCAL_ERC20' | 'TETHER_DEPRECATION_GUARD';
}

export interface EthereumMainnetBalanceEip1967ImplementationDeployment {
  readonly kind: 'EIP1967_IMPLEMENTATION';
  readonly proxyRuntimeCode: EthereumMainnetBalanceRuntimeCodeIdentity;
  readonly implementation: EthereumMainnetBalanceAddress;
  readonly implementationRuntimeCode: EthereumMainnetBalanceRuntimeCodeIdentity;
  readonly admin: EthereumMainnetBalanceAddress | null;
}

export interface EthereumMainnetBalanceEip1967BeaconDeployment {
  readonly kind: 'EIP1967_BEACON';
  readonly proxyRuntimeCode: EthereumMainnetBalanceRuntimeCodeIdentity;
  readonly beacon: EthereumMainnetBalanceAddress;
  readonly beaconRuntimeCode: EthereumMainnetBalanceRuntimeCodeIdentity;
  readonly implementation: EthereumMainnetBalanceAddress;
  readonly implementationRuntimeCode: EthereumMainnetBalanceRuntimeCodeIdentity;
  readonly admin: EthereumMainnetBalanceAddress | null;
}

export interface EthereumMainnetBalanceLegacyZeppelinDeployment {
  readonly kind: 'LEGACY_ZEPPELIN_IMPLEMENTATION';
  readonly proxyRuntimeCode: EthereumMainnetBalanceRuntimeCodeIdentity;
  readonly implementation: EthereumMainnetBalanceAddress;
  readonly implementationRuntimeCode: EthereumMainnetBalanceRuntimeCodeIdentity;
  readonly admin: EthereumMainnetBalanceAddress | null;
}

export type EthereumMainnetBalanceDeploymentRoute =
  | EthereumMainnetBalanceDirectDeployment
  | EthereumMainnetBalanceEip1967ImplementationDeployment
  | EthereumMainnetBalanceEip1967BeaconDeployment
  | EthereumMainnetBalanceLegacyZeppelinDeployment;

export interface EthereumMainnetBalanceDeploymentEpoch {
  readonly validFromBlock: string;
  readonly validThroughBlock: string | null;
  readonly evidence: Readonly<{
    readonly captureBlockNumber: string;
    readonly captureBlockHash: string;
    readonly sha256: string;
  }>;
  readonly deployment: EthereumMainnetBalanceDeploymentRoute;
}

export interface ApprovedEthereumMainnetBalanceDeploymentManifest {
  readonly schemaVersion: 1;
  readonly use: 'DORMANT_ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_ONLY';
  readonly approvalStatus: 'APPROVED';
  readonly authorityApprovedForProduction: true;
  readonly networkId: 'eip155:1';
  readonly chainId: '0x1';
  readonly blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL';
  readonly maximumRpcReads: typeof ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS;
  readonly maximumRuntimeCodeBytes: typeof ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES;
  readonly maximumEpochsPerAsset: typeof ETHEREUM_MAINNET_BALANCE_MAXIMUM_EPOCHS_PER_ASSET;
  readonly assetRegistry: Readonly<{
    readonly environment: 'MAINNET';
    readonly version: 1;
    readonly fingerprintSha256: typeof ETHEREUM_MAINNET_BALANCE_ASSET_REGISTRY_FINGERPRINT_SHA256;
  }>;
  readonly assets: readonly Readonly<{
    readonly stablecoin: EthereumMainnetBalanceStablecoin;
    readonly address: EthereumMainnetBalanceAddress;
    readonly decimals: 6;
    readonly epochs: readonly EthereumMainnetBalanceDeploymentEpoch[];
  }>[];
}

/**
 * Checked-in state deliberately contains no deployment assertion. An authority-reviewed
 * manifest and its independently distributed fingerprint must be injected explicitly.
 */
export const DORMANT_ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_MANIFEST = Object.freeze({
  schemaVersion: 1 as const,
  use: 'DORMANT_ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_ONLY' as const,
  approvalStatus: 'NOT_APPROVED' as const,
  authorityApprovedForProduction: false as const,
  networkId: 'eip155:1' as const,
  chainId: '0x1' as const,
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const,
  maximumRpcReads: ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS,
  maximumRuntimeCodeBytes: ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES,
  maximumEpochsPerAsset: ETHEREUM_MAINNET_BALANCE_MAXIMUM_EPOCHS_PER_ASSET,
  assetRegistry: Object.freeze({
    environment: 'MAINNET' as const,
    version: 1 as const,
    fingerprintSha256: ETHEREUM_MAINNET_BALANCE_ASSET_REGISTRY_FINGERPRINT_SHA256,
  }),
  assets: Object.freeze([]),
});

export class EthereumMainnetBalanceDeploymentManifestValidationError extends Error {
  readonly code = 'ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_INVALID' as const;

  constructor() {
    super('Ethereum mainnet balance deployment manifest is invalid');
    this.name = 'EthereumMainnetBalanceDeploymentManifestValidationError';
  }
}

function fail(): never {
  throw new EthereumMainnetBalanceDeploymentManifestValidationError();
}

export function parseApprovedEthereumMainnetBalanceDeploymentManifest(
  value: unknown,
): ApprovedEthereumMainnetBalanceDeploymentManifest {
  const manifest = exactRecord(value, [
    'schemaVersion',
    'use',
    'approvalStatus',
    'authorityApprovedForProduction',
    'networkId',
    'chainId',
    'blockBinding',
    'maximumRpcReads',
    'maximumRuntimeCodeBytes',
    'maximumEpochsPerAsset',
    'assetRegistry',
    'assets',
  ]);
  const registry = exactRecord(manifest.assetRegistry, [
    'environment',
    'version',
    'fingerprintSha256',
  ]);
  const assets = exactArray(manifest.assets, ETHEREUM_MAINNET_BALANCE_ASSETS.length);
  const registrySnapshot = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.use !== 'DORMANT_ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_ONLY' ||
    manifest.approvalStatus !== 'APPROVED' ||
    manifest.authorityApprovedForProduction !== true ||
    manifest.networkId !== 'eip155:1' ||
    manifest.chainId !== '0x1' ||
    manifest.blockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' ||
    manifest.maximumRpcReads !== ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS ||
    manifest.maximumRuntimeCodeBytes !== ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES ||
    manifest.maximumEpochsPerAsset !== ETHEREUM_MAINNET_BALANCE_MAXIMUM_EPOCHS_PER_ASSET ||
    registry.environment !== 'MAINNET' ||
    registry.version !== 1 ||
    registry.fingerprintSha256 !== ETHEREUM_MAINNET_BALANCE_ASSET_REGISTRY_FINGERPRINT_SHA256 ||
    registrySnapshot.version !== 1 ||
    registrySnapshot.environment !== 'MAINNET' ||
    registrySnapshot.fingerprintSha256 !==
      ETHEREUM_MAINNET_BALANCE_ASSET_REGISTRY_FINGERPRINT_SHA256
  ) {
    return fail();
  }

  const parsedAssets = assets.map((asset, index) => parseAsset(asset, index));
  const assetAddresses = new Set(parsedAssets.map(({ address }) => address));
  if (
    parsedAssets.some((asset) =>
      asset.epochs.some((epoch) =>
        deploymentTargetAddresses(epoch.deployment).some((target) => assetAddresses.has(target)),
      ),
    )
  ) {
    return fail();
  }
  return Object.freeze({
    schemaVersion: 1,
    use: 'DORMANT_ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_ONLY',
    approvalStatus: 'APPROVED',
    authorityApprovedForProduction: true,
    networkId: 'eip155:1',
    chainId: '0x1',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    maximumRpcReads: ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS,
    maximumRuntimeCodeBytes: ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES,
    maximumEpochsPerAsset: ETHEREUM_MAINNET_BALANCE_MAXIMUM_EPOCHS_PER_ASSET,
    assetRegistry: Object.freeze({
      environment: 'MAINNET',
      version: 1,
      fingerprintSha256: ETHEREUM_MAINNET_BALANCE_ASSET_REGISTRY_FINGERPRINT_SHA256,
    }),
    assets: Object.freeze(parsedAssets),
  });
}

export function ethereumMainnetBalanceDeploymentManifestFingerprintSha256(value: unknown): string {
  const manifest = parseApprovedEthereumMainnetBalanceDeploymentManifest(value);
  return sha256([
    'crypto-lending:ethereum-mainnet-balance-deployment-manifest:v1',
    manifest.schemaVersion,
    manifest.use,
    manifest.approvalStatus,
    manifest.authorityApprovedForProduction,
    manifest.networkId,
    manifest.chainId,
    manifest.blockBinding,
    manifest.maximumRpcReads,
    manifest.maximumRuntimeCodeBytes,
    manifest.maximumEpochsPerAsset,
    [
      manifest.assetRegistry.environment,
      manifest.assetRegistry.version,
      manifest.assetRegistry.fingerprintSha256,
    ],
    manifest.assets.map((asset) => [
      asset.stablecoin,
      asset.address,
      asset.decimals,
      asset.epochs.map((epoch) => [
        epoch.validFromBlock,
        epoch.validThroughBlock,
        [epoch.evidence.captureBlockNumber, epoch.evidence.captureBlockHash, epoch.evidence.sha256],
        canonicalDeployment(epoch.deployment),
      ]),
    ]),
  ]);
}

function parseAsset(
  value: unknown,
  index: number,
): ApprovedEthereumMainnetBalanceDeploymentManifest['assets'][number] {
  const expected = ETHEREUM_MAINNET_BALANCE_ASSETS[index];
  if (expected === undefined) return fail();
  const asset = exactRecord(value, ['stablecoin', 'address', 'decimals', 'epochs']);
  const registered = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.identifyAsset(
    'eip155:1',
    expected.address,
  );
  if (
    asset.stablecoin !== expected.stablecoin ||
    asset.address !== expected.address ||
    asset.decimals !== expected.decimals ||
    registered?.stablecoin !== expected.stablecoin ||
    registered.identity !== expected.address ||
    registered.decimals !== 6 ||
    registered.chain !== 'ETHEREUM' ||
    registered.activationState !== 'ACTIVE'
  ) {
    return fail();
  }
  const epochs = exactArrayInRange(
    asset.epochs,
    1,
    ETHEREUM_MAINNET_BALANCE_MAXIMUM_EPOCHS_PER_ASSET,
  ).map((epoch) => parseEpoch(epoch, expected.stablecoin, expected.address));
  for (let index = 1; index < epochs.length; index += 1) {
    const previous = epochs[index - 1];
    const current = epochs[index];
    if (
      previous === undefined ||
      current === undefined ||
      previous.validThroughBlock === null ||
      BigInt(current.validFromBlock) <= BigInt(previous.validThroughBlock)
    ) {
      return fail();
    }
  }
  return Object.freeze({
    stablecoin: expected.stablecoin,
    address: expected.address,
    decimals: 6,
    epochs: Object.freeze(epochs),
  });
}

function parseEpoch(
  value: unknown,
  stablecoin: EthereumMainnetBalanceStablecoin,
  assetAddress: EthereumMainnetBalanceAddress,
): EthereumMainnetBalanceDeploymentEpoch {
  const epoch = exactRecord(value, [
    'validFromBlock',
    'validThroughBlock',
    'evidence',
    'deployment',
  ]);
  const validFromBlock = uint64Decimal(epoch.validFromBlock, false);
  const validThroughBlock =
    epoch.validThroughBlock === null ? null : uint64Decimal(epoch.validThroughBlock, false);
  if (validThroughBlock !== null && BigInt(validThroughBlock) < BigInt(validFromBlock)) {
    return fail();
  }
  const evidence = exactRecord(epoch.evidence, [
    'captureBlockNumber',
    'captureBlockHash',
    'sha256',
  ]);
  const captureBlockNumber = uint64Decimal(evidence.captureBlockNumber, false);
  if (
    BigInt(captureBlockNumber) < BigInt(validFromBlock) ||
    (validThroughBlock !== null && BigInt(captureBlockNumber) > BigInt(validThroughBlock)) ||
    typeof evidence.captureBlockHash !== 'string' ||
    !BLOCK_HASH.test(evidence.captureBlockHash) ||
    evidence.captureBlockHash === `0x${'0'.repeat(64)}` ||
    !nonzeroSha256(evidence.sha256)
  ) {
    return fail();
  }
  return Object.freeze({
    validFromBlock,
    validThroughBlock,
    evidence: Object.freeze({
      captureBlockNumber,
      captureBlockHash: evidence.captureBlockHash,
      sha256: evidence.sha256,
    }) as EthereumMainnetBalanceDeploymentEpoch['evidence'],
    deployment: parseDeployment(epoch.deployment, stablecoin, assetAddress),
  });
}

function parseDeployment(
  value: unknown,
  stablecoin: EthereumMainnetBalanceStablecoin,
  assetAddress: EthereumMainnetBalanceAddress,
): EthereumMainnetBalanceDeploymentRoute {
  const kind = recordTag(value);
  switch (kind) {
    case 'DIRECT': {
      const route = exactRecord(value, ['kind', 'runtimeCode', 'semantics']);
      const expectedSemantics = stablecoin === 'USDT' ? 'TETHER_DEPRECATION_GUARD' : 'LOCAL_ERC20';
      if (route.semantics !== expectedSemantics) return fail();
      return Object.freeze({
        kind,
        runtimeCode: parseRuntimeCode(route.runtimeCode),
        semantics: expectedSemantics,
      });
    }
    case 'EIP1967_IMPLEMENTATION': {
      const route = exactRecord(value, [
        'kind',
        'proxyRuntimeCode',
        'implementation',
        'implementationRuntimeCode',
        'admin',
      ]);
      const implementation = address(route.implementation);
      const admin = nullableAddress(route.admin);
      rejectDuplicateAddresses([assetAddress, implementation, admin]);
      return Object.freeze({
        kind,
        proxyRuntimeCode: parseRuntimeCode(route.proxyRuntimeCode),
        implementation,
        implementationRuntimeCode: parseRuntimeCode(route.implementationRuntimeCode),
        admin,
      });
    }
    case 'EIP1967_BEACON': {
      const route = exactRecord(value, [
        'kind',
        'proxyRuntimeCode',
        'beacon',
        'beaconRuntimeCode',
        'implementation',
        'implementationRuntimeCode',
        'admin',
      ]);
      const beacon = address(route.beacon);
      const implementation = address(route.implementation);
      const admin = nullableAddress(route.admin);
      rejectDuplicateAddresses([assetAddress, beacon, implementation, admin]);
      return Object.freeze({
        kind,
        proxyRuntimeCode: parseRuntimeCode(route.proxyRuntimeCode),
        beacon,
        beaconRuntimeCode: parseRuntimeCode(route.beaconRuntimeCode),
        implementation,
        implementationRuntimeCode: parseRuntimeCode(route.implementationRuntimeCode),
        admin,
      });
    }
    case 'LEGACY_ZEPPELIN_IMPLEMENTATION': {
      const route = exactRecord(value, [
        'kind',
        'proxyRuntimeCode',
        'implementation',
        'implementationRuntimeCode',
        'admin',
      ]);
      const implementation = address(route.implementation);
      const admin = nullableAddress(route.admin);
      rejectDuplicateAddresses([assetAddress, implementation, admin]);
      return Object.freeze({
        kind,
        proxyRuntimeCode: parseRuntimeCode(route.proxyRuntimeCode),
        implementation,
        implementationRuntimeCode: parseRuntimeCode(route.implementationRuntimeCode),
        admin,
      });
    }
    default:
      return fail();
  }
}

function parseRuntimeCode(value: unknown): EthereumMainnetBalanceRuntimeCodeIdentity {
  const code = exactRecord(value, ['byteLength', 'sha256']);
  if (
    typeof code.byteLength !== 'number' ||
    !Number.isSafeInteger(code.byteLength) ||
    code.byteLength < 1 ||
    code.byteLength > ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES ||
    !nonzeroSha256(code.sha256)
  ) {
    return fail();
  }
  return Object.freeze({ byteLength: code.byteLength, sha256: code.sha256 });
}

function canonicalDeployment(route: EthereumMainnetBalanceDeploymentRoute): readonly unknown[] {
  switch (route.kind) {
    case 'DIRECT':
      return [route.kind, canonicalRuntimeCode(route.runtimeCode), route.semantics];
    case 'EIP1967_IMPLEMENTATION':
    case 'LEGACY_ZEPPELIN_IMPLEMENTATION':
      return [
        route.kind,
        canonicalRuntimeCode(route.proxyRuntimeCode),
        route.implementation,
        canonicalRuntimeCode(route.implementationRuntimeCode),
        route.admin,
      ];
    case 'EIP1967_BEACON':
      return [
        route.kind,
        canonicalRuntimeCode(route.proxyRuntimeCode),
        route.beacon,
        canonicalRuntimeCode(route.beaconRuntimeCode),
        route.implementation,
        canonicalRuntimeCode(route.implementationRuntimeCode),
        route.admin,
      ];
  }
}

function deploymentTargetAddresses(
  route: EthereumMainnetBalanceDeploymentRoute,
): readonly EthereumMainnetBalanceAddress[] {
  switch (route.kind) {
    case 'DIRECT':
      return [];
    case 'EIP1967_IMPLEMENTATION':
    case 'LEGACY_ZEPPELIN_IMPLEMENTATION':
      return [route.implementation];
    case 'EIP1967_BEACON':
      return [route.beacon, route.implementation];
  }
}

function canonicalRuntimeCode(
  value: EthereumMainnetBalanceRuntimeCodeIdentity,
): readonly unknown[] {
  return [value.byteLength, value.sha256];
}

function rejectDuplicateAddresses(values: readonly (EthereumMainnetBalanceAddress | null)[]): void {
  const addresses = values.filter(
    (value): value is EthereumMainnetBalanceAddress => value !== null,
  );
  if (new Set(addresses).size !== addresses.length) return fail();
}

function recordTag(value: unknown): unknown {
  const record = dataRecord(value);
  return record.kind;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = dataRecord(value);
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) return fail();
  return record;
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return fail();
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) return fail();
  const output = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) return fail();
    output[key] = descriptor.value;
  }
  return output;
}

function exactArray(value: unknown, length: number): readonly unknown[] {
  const values = arrayValues(value);
  if (values.length !== length) return fail();
  return values;
}

function exactArrayInRange(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  const values = arrayValues(value);
  if (values.length < minimum || values.length > maximum) return fail();
  return values;
}

function arrayValues(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return fail();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const length = descriptors.length?.value;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(descriptors).length !== length + 1
  ) {
    return fail();
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
    output.push(descriptor.value);
  }
  return output;
}

function address(value: unknown): EthereumMainnetBalanceAddress {
  if (typeof value !== 'string' || !ADDRESS.test(value) || value === `0x${'0'.repeat(40)}`) {
    return fail();
  }
  return value as EthereumMainnetBalanceAddress;
}

function nullableAddress(value: unknown): EthereumMainnetBalanceAddress | null {
  return value === null ? null : address(value);
}

function uint64Decimal(value: unknown, allowZero: boolean): string {
  if (
    typeof value !== 'string' ||
    !UINT64_DECIMAL.test(value) ||
    BigInt(value) > MAX_UINT64 ||
    (!allowZero && value === '0')
  ) {
    return fail();
  }
  return value;
}

function nonzeroSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value) && value !== '0'.repeat(64);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
