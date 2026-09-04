import { createHash } from 'node:crypto';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ASSET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const SECURITY_COMMIT = '684522eae18dea73a8aecda25d8743bfa724446a';
const CORE_COMMIT = 'e16559ae82f0f24c3dc29693c444f40d676ebff9';
const OFFICIAL = Object.freeze({
  addressProvider: '0x9ea7b04da02a5373317d745c1571c84aad03321d',
  contractsRegister: '0xa50d4e7d8946a7c90652339cdbd262c375d54d99',
  pool: '0xda00000035fef4082f78def6a8903bee419fbf8e',
  underlying: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
});

export interface GearboxV3EthereumUSDCManifest {
  readonly schemaVersion: 1;
  readonly providerId: 'gearbox';
  readonly protocolId: 'gearbox-v3';
  readonly networkId: 'eip155:1';
  readonly expectedChainId: '0x1';
  readonly blockSelector: 'finalized';
  readonly blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL';
  readonly maximumBlockAgeSeconds: string;
  readonly marketId: 'gearbox-v3-ethereum-usdc';
  readonly deploymentModel: 'DIRECT_IMMUTABLE_POOL_V3_00';
  readonly contracts: Readonly<typeof OFFICIAL>;
  readonly asset: Readonly<{ symbol: 'USDC'; decimals: 6 }>;
  readonly assetRegistry: Readonly<{
    environment: 'MAINNET';
    version: 1;
    fingerprintSha256: typeof ASSET_REGISTRY_FINGERPRINT;
  }>;
  readonly runtimeCodeSha256: Readonly<Record<keyof typeof OFFICIAL, string>>;
  readonly officialSource: Readonly<{
    securityRepository: 'Gearbox-protocol/security';
    securityCommit: typeof SECURITY_COMMIT;
    deploymentPath: 'bug-bounty/v3-scope.md';
    coreRepository: 'Gearbox-protocol/core-v3';
    coreCommit: typeof CORE_COMMIT;
    poolPath: 'contracts/pool/PoolV3.sol';
    interfacePath: 'contracts/interfaces/IPoolV3.sol';
  }>;
}

export class GearboxV3ManifestInvalidError extends Error {
  readonly code = 'GEARBOX_V3_MANIFEST_INVALID' as const;
  constructor() {
    super('Gearbox V3 manifest is invalid');
    this.name = 'GearboxV3ManifestInvalidError';
  }
}

function fail(): never {
  throw new GearboxV3ManifestInvalidError();
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    fail();
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) fail();
    output[key] = descriptor.value;
  }
  return output;
}

export function parseGearboxV3EthereumUSDCManifest(value: unknown): GearboxV3EthereumUSDCManifest {
  const row = exact(value, [
    'schemaVersion',
    'providerId',
    'protocolId',
    'networkId',
    'expectedChainId',
    'blockSelector',
    'blockBinding',
    'maximumBlockAgeSeconds',
    'marketId',
    'deploymentModel',
    'contracts',
    'asset',
    'assetRegistry',
    'runtimeCodeSha256',
    'officialSource',
  ]);
  const contracts = exact(row.contracts, Object.keys(OFFICIAL));
  const asset = exact(row.asset, ['symbol', 'decimals']);
  const registry = exact(row.assetRegistry, ['environment', 'version', 'fingerprintSha256']);
  const hashes = exact(row.runtimeCodeSha256, Object.keys(OFFICIAL));
  const source = exact(row.officialSource, [
    'securityRepository',
    'securityCommit',
    'deploymentPath',
    'coreRepository',
    'coreCommit',
    'poolPath',
    'interfacePath',
  ]);
  const registered = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(
    'eip155:1',
    OFFICIAL.underlying,
  );
  if (
    row.schemaVersion !== 1 ||
    row.providerId !== 'gearbox' ||
    row.protocolId !== 'gearbox-v3' ||
    row.networkId !== 'eip155:1' ||
    row.expectedChainId !== '0x1' ||
    row.blockSelector !== 'finalized' ||
    row.blockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' ||
    typeof row.maximumBlockAgeSeconds !== 'string' ||
    !/^[1-9][0-9]{0,3}$/u.test(row.maximumBlockAgeSeconds) ||
    BigInt(row.maximumBlockAgeSeconds) > 3_600n ||
    row.marketId !== 'gearbox-v3-ethereum-usdc' ||
    row.deploymentModel !== 'DIRECT_IMMUTABLE_POOL_V3_00' ||
    Object.entries(OFFICIAL).some(
      ([key, address]) => contracts[key] !== address || !ADDRESS.test(address),
    ) ||
    Object.values(hashes).some(
      (hash) => typeof hash !== 'string' || !SHA256.test(hash) || hash === '0'.repeat(64),
    ) ||
    asset.symbol !== 'USDC' ||
    asset.decimals !== 6 ||
    registry.environment !== 'MAINNET' ||
    registry.version !== 1 ||
    registry.fingerprintSha256 !== ASSET_REGISTRY_FINGERPRINT ||
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version !== 1 ||
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256 !== ASSET_REGISTRY_FINGERPRINT ||
    registered?.stablecoin !== 'USDC' ||
    registered.chain !== 'ETHEREUM' ||
    registered.identity !== OFFICIAL.underlying ||
    registered.decimals !== 6 ||
    registered.activationState !== 'ACTIVE' ||
    registered.registryVersion !== 1 ||
    source.securityRepository !== 'Gearbox-protocol/security' ||
    source.securityCommit !== SECURITY_COMMIT ||
    source.deploymentPath !== 'bug-bounty/v3-scope.md' ||
    source.coreRepository !== 'Gearbox-protocol/core-v3' ||
    source.coreCommit !== CORE_COMMIT ||
    source.poolPath !== 'contracts/pool/PoolV3.sol' ||
    source.interfacePath !== 'contracts/interfaces/IPoolV3.sol'
  )
    fail();
  return Object.freeze({
    schemaVersion: 1,
    providerId: 'gearbox',
    protocolId: 'gearbox-v3',
    networkId: 'eip155:1',
    expectedChainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    maximumBlockAgeSeconds: row.maximumBlockAgeSeconds,
    marketId: 'gearbox-v3-ethereum-usdc',
    deploymentModel: 'DIRECT_IMMUTABLE_POOL_V3_00',
    contracts: Object.freeze({ ...OFFICIAL }),
    asset: Object.freeze({ symbol: 'USDC', decimals: 6 }),
    assetRegistry: Object.freeze({
      environment: 'MAINNET',
      version: 1,
      fingerprintSha256: ASSET_REGISTRY_FINGERPRINT,
    }),
    runtimeCodeSha256: Object.freeze({
      addressProvider: hashes.addressProvider as string,
      contractsRegister: hashes.contractsRegister as string,
      pool: hashes.pool as string,
      underlying: hashes.underlying as string,
    }),
    officialSource: Object.freeze({
      securityRepository: 'Gearbox-protocol/security',
      securityCommit: SECURITY_COMMIT,
      deploymentPath: 'bug-bounty/v3-scope.md',
      coreRepository: 'Gearbox-protocol/core-v3',
      coreCommit: CORE_COMMIT,
      poolPath: 'contracts/pool/PoolV3.sol',
      interfacePath: 'contracts/interfaces/IPoolV3.sol',
    }),
  });
}

export function gearboxV3ManifestFingerprintSha256(value: unknown): string {
  const manifest = parseGearboxV3EthereumUSDCManifest(value);
  return createHash('sha256')
    .update(
      JSON.stringify(['crypto-lending:gearbox-v3-ethereum-usdc-manifest:v1', manifest]),
      'utf8',
    )
    .digest('hex');
}
