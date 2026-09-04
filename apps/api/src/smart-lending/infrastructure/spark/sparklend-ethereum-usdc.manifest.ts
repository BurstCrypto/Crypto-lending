import { createHash } from 'node:crypto';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';

const SHA = /^[0-9a-f]{64}$/u;
const COMMIT = 'ecea29bd2a1546bbbf4999e486b3c04f0e10b748';
const ASSET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const ADDRESSES = Object.freeze({
  provider: '0x02c3ea4e34c0cbd694d2adfa2c690eecbc1793ee',
  pool: '0xc13e21b648a5ee794902342038ff3adab66be987',
  configurator: '0x542dba469bde58faee189ffb60c6b49ce60e0738',
  implementation: '0x5ae329203e00f76891094dcfedd5aca082a50e1b',
  dataProvider: '0xfc21d6d146e6086b8359705c8b28512a983db0cb',
  usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  spToken: '0x377c3bd93f2a2984e1e7be6a5c22c525ed4a4815',
  spTokenImplementation: '0x6175ddec3b9b38c88157c10a01ed4a3fa8639cc6',
});

export interface SparkLendEthereumUSDCManifest {
  readonly schemaVersion: 1;
  readonly providerId: 'spark';
  readonly protocolId: 'sparklend';
  readonly networkId: 'eip155:1';
  readonly expectedChainId: '0x1';
  readonly blockSelector: 'finalized';
  readonly maximumBlockAgeSeconds: string;
  readonly assetRegistry: Readonly<{
    environment: 'MAINNET';
    version: 1;
    fingerprintSha256: typeof ASSET_REGISTRY_FINGERPRINT;
  }>;
  readonly marketId: 'sparklend-ethereum-usdc';
  readonly contracts: Readonly<typeof ADDRESSES>;
  readonly asset: Readonly<{ symbol: 'USDC'; decimals: 6 }>;
  readonly runtimeCodeSha256: Readonly<Record<keyof typeof ADDRESSES, string>>;
  readonly source: Readonly<{
    repository: 'sparkdotfi/spark-address-registry';
    commit: typeof COMMIT;
    contractsPath: 'src/SparkLend.sol';
    assetPath: 'src/Ethereum.sol';
  }>;
}

export class SparkLendManifestInvalidError extends Error {
  readonly code = 'SPARKLEND_MANIFEST_INVALID' as const;
  constructor() {
    super('SparkLend manifest is invalid');
    this.name = 'SparkLendManifestInvalidError';
  }
}
function fail(): never {
  throw new SparkLendManifestInvalidError();
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

export function parseSparkLendEthereumUSDCManifest(value: unknown): SparkLendEthereumUSDCManifest {
  const row = exact(value, [
    'schemaVersion',
    'providerId',
    'protocolId',
    'networkId',
    'expectedChainId',
    'blockSelector',
    'maximumBlockAgeSeconds',
    'assetRegistry',
    'marketId',
    'contracts',
    'asset',
    'runtimeCodeSha256',
    'source',
  ]);
  const assetRegistry = exact(row.assetRegistry, ['environment', 'version', 'fingerprintSha256']);
  const contracts = exact(row.contracts, Object.keys(ADDRESSES));
  const asset = exact(row.asset, ['symbol', 'decimals']);
  const hashes = exact(row.runtimeCodeSha256, Object.keys(ADDRESSES));
  const source = exact(row.source, ['repository', 'commit', 'contractsPath', 'assetPath']);
  const registeredUSDC = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(
    'eip155:1',
    ADDRESSES.usdc,
  );
  if (
    row.schemaVersion !== 1 ||
    row.providerId !== 'spark' ||
    row.protocolId !== 'sparklend' ||
    row.networkId !== 'eip155:1' ||
    row.expectedChainId !== '0x1' ||
    row.blockSelector !== 'finalized' ||
    typeof row.maximumBlockAgeSeconds !== 'string' ||
    !/^[1-9][0-9]{0,3}$/u.test(row.maximumBlockAgeSeconds) ||
    BigInt(row.maximumBlockAgeSeconds) > 3_600n ||
    row.marketId !== 'sparklend-ethereum-usdc' ||
    assetRegistry.environment !== 'MAINNET' ||
    assetRegistry.version !== 1 ||
    assetRegistry.fingerprintSha256 !== ASSET_REGISTRY_FINGERPRINT ||
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version !== 1 ||
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256 !== ASSET_REGISTRY_FINGERPRINT ||
    registeredUSDC?.stablecoin !== 'USDC' ||
    registeredUSDC.chain !== 'ETHEREUM' ||
    registeredUSDC.networkId !== 'eip155:1' ||
    registeredUSDC.identity !== ADDRESSES.usdc ||
    registeredUSDC.decimals !== 6 ||
    registeredUSDC.activationState !== 'ACTIVE' ||
    registeredUSDC.registryVersion !== 1 ||
    Object.entries(ADDRESSES).some(([key, address]) => contracts[key] !== address) ||
    Object.values(hashes).some(
      (hash) => typeof hash !== 'string' || !SHA.test(hash) || hash === '0'.repeat(64),
    ) ||
    asset.symbol !== 'USDC' ||
    asset.decimals !== 6 ||
    source.repository !== 'sparkdotfi/spark-address-registry' ||
    source.commit !== COMMIT ||
    source.contractsPath !== 'src/SparkLend.sol' ||
    source.assetPath !== 'src/Ethereum.sol'
  )
    fail();
  return Object.freeze({
    schemaVersion: 1,
    providerId: 'spark',
    protocolId: 'sparklend',
    networkId: 'eip155:1',
    expectedChainId: '0x1',
    blockSelector: 'finalized',
    maximumBlockAgeSeconds: row.maximumBlockAgeSeconds,
    assetRegistry: Object.freeze({
      environment: 'MAINNET',
      version: 1,
      fingerprintSha256: ASSET_REGISTRY_FINGERPRINT,
    }),
    marketId: 'sparklend-ethereum-usdc',
    contracts: Object.freeze({ ...ADDRESSES }),
    asset: Object.freeze({ symbol: 'USDC', decimals: 6 }),
    runtimeCodeSha256: Object.freeze({
      provider: hashes.provider as string,
      pool: hashes.pool as string,
      configurator: hashes.configurator as string,
      implementation: hashes.implementation as string,
      dataProvider: hashes.dataProvider as string,
      usdc: hashes.usdc as string,
      spToken: hashes.spToken as string,
      spTokenImplementation: hashes.spTokenImplementation as string,
    }),
    source: Object.freeze({
      repository: 'sparkdotfi/spark-address-registry',
      commit: COMMIT,
      contractsPath: 'src/SparkLend.sol',
      assetPath: 'src/Ethereum.sol',
    }),
  });
}

export function sparkLendManifestFingerprintSha256(value: unknown): string {
  const manifest = parseSparkLendEthereumUSDCManifest(value);
  return createHash('sha256')
    .update(
      JSON.stringify(['crypto-lending:sparklend-ethereum-usdc-manifest:v1', manifest]),
      'utf8',
    )
    .digest('hex');
}
