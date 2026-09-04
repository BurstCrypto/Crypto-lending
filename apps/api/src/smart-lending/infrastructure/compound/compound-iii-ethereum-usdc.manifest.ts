import { createHash } from 'node:crypto';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const OFFICIAL_COMET_PROXY = '0xc3d688b66703497daa19211eedff47f25384cdc3';
const OFFICIAL_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const OFFICIAL_SOURCE_COMMIT = 'f766f51583c23acc33b2a7824654ef2029a96804';
const ASSET_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';

export interface CompoundIIIUSDCFinalizedManifest {
  readonly schemaVersion: 1;
  readonly providerId: 'compound';
  readonly protocolId: 'compound-iii';
  readonly networkId: 'eip155:1';
  readonly expectedChainId: '0x1';
  readonly blockSelector: 'finalized';
  readonly blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL';
  readonly maximumBlockAgeSeconds: string;
  readonly assetRegistry: Readonly<{
    environment: 'MAINNET';
    version: 1;
    fingerprintSha256: typeof ASSET_REGISTRY_FINGERPRINT;
  }>;
  readonly marketId: 'compound-iii-ethereum-usdc';
  readonly cometProxy: typeof OFFICIAL_COMET_PROXY;
  readonly proxyAdmin: `0x${string}`;
  readonly implementation: `0x${string}`;
  readonly baseAsset: Readonly<{
    symbol: 'USDC';
    address: typeof OFFICIAL_USDC;
    decimals: 6;
    scale: '1000000';
  }>;
  readonly runtimeCodeSha256: Readonly<{
    cometProxy: string;
    implementation: string;
    baseAsset: string;
  }>;
  readonly officialSource: Readonly<{
    repository: 'compound-finance/comet';
    commit: typeof OFFICIAL_SOURCE_COMMIT;
    deploymentPath: 'deployments/mainnet/usdc';
  }>;
}

export class CompoundIIIUSDCManifestValidationError extends Error {
  readonly code = 'COMPOUND_III_USDC_MANIFEST_INVALID' as const;

  constructor() {
    super('Compound III USDC manifest is invalid');
    this.name = 'CompoundIIIUSDCManifestValidationError';
  }
}

function fail(): never {
  throw new CompoundIIIUSDCManifestValidationError();
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail();
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
    output[key] = descriptor.value;
  }
  return output;
}

function address(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !ADDRESS.test(value) || value === `0x${'0'.repeat(40)}`) {
    return fail();
  }
  return value as `0x${string}`;
}

export function parseCompoundIIIUSDCFinalizedManifest(
  value: unknown,
): CompoundIIIUSDCFinalizedManifest {
  const manifest = record(value, [
    'schemaVersion',
    'providerId',
    'protocolId',
    'networkId',
    'expectedChainId',
    'blockSelector',
    'blockBinding',
    'maximumBlockAgeSeconds',
    'assetRegistry',
    'marketId',
    'cometProxy',
    'proxyAdmin',
    'implementation',
    'baseAsset',
    'runtimeCodeSha256',
    'officialSource',
  ]);
  const assetRegistry = record(manifest.assetRegistry, [
    'environment',
    'version',
    'fingerprintSha256',
  ]);
  const baseAsset = record(manifest.baseAsset, ['symbol', 'address', 'decimals', 'scale']);
  const code = record(manifest.runtimeCodeSha256, ['cometProxy', 'implementation', 'baseAsset']);
  const source = record(manifest.officialSource, ['repository', 'commit', 'deploymentPath']);
  const proxyAdmin = address(manifest.proxyAdmin);
  const implementation = address(manifest.implementation);
  const registeredUSDC = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset('eip155:1', OFFICIAL_USDC);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.providerId !== 'compound' ||
    manifest.protocolId !== 'compound-iii' ||
    manifest.networkId !== 'eip155:1' ||
    manifest.expectedChainId !== '0x1' ||
    manifest.blockSelector !== 'finalized' ||
    manifest.blockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' ||
    typeof manifest.maximumBlockAgeSeconds !== 'string' ||
    !/^[1-9][0-9]{0,3}$/u.test(manifest.maximumBlockAgeSeconds) ||
    BigInt(manifest.maximumBlockAgeSeconds) > 3_600n ||
    assetRegistry.environment !== 'MAINNET' ||
    assetRegistry.version !== 1 ||
    assetRegistry.fingerprintSha256 !== ASSET_REGISTRY_FINGERPRINT ||
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version !== 1 ||
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256 !== ASSET_REGISTRY_FINGERPRINT ||
    registeredUSDC?.stablecoin !== 'USDC' ||
    registeredUSDC.chain !== 'ETHEREUM' ||
    registeredUSDC.networkId !== 'eip155:1' ||
    registeredUSDC.identity !== OFFICIAL_USDC ||
    registeredUSDC.decimals !== 6 ||
    registeredUSDC.activationState !== 'ACTIVE' ||
    registeredUSDC.registryVersion !== 1 ||
    manifest.marketId !== 'compound-iii-ethereum-usdc' ||
    manifest.cometProxy !== OFFICIAL_COMET_PROXY ||
    proxyAdmin === OFFICIAL_COMET_PROXY ||
    implementation === OFFICIAL_COMET_PROXY ||
    implementation === proxyAdmin ||
    baseAsset.symbol !== 'USDC' ||
    baseAsset.address !== OFFICIAL_USDC ||
    baseAsset.decimals !== 6 ||
    baseAsset.scale !== '1000000' ||
    source.repository !== 'compound-finance/comet' ||
    source.commit !== OFFICIAL_SOURCE_COMMIT ||
    source.deploymentPath !== 'deployments/mainnet/usdc' ||
    Object.values(code).some(
      (digest) => typeof digest !== 'string' || !SHA256.test(digest) || digest === '0'.repeat(64),
    )
  ) {
    return fail();
  }
  return Object.freeze({
    schemaVersion: 1,
    providerId: 'compound',
    protocolId: 'compound-iii',
    networkId: 'eip155:1',
    expectedChainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    maximumBlockAgeSeconds: manifest.maximumBlockAgeSeconds,
    assetRegistry: Object.freeze({
      environment: 'MAINNET',
      version: 1,
      fingerprintSha256: ASSET_REGISTRY_FINGERPRINT,
    }),
    marketId: 'compound-iii-ethereum-usdc',
    cometProxy: OFFICIAL_COMET_PROXY,
    proxyAdmin,
    implementation,
    baseAsset: Object.freeze({
      symbol: 'USDC',
      address: OFFICIAL_USDC,
      decimals: 6,
      scale: '1000000',
    }),
    runtimeCodeSha256: Object.freeze({
      cometProxy: code.cometProxy as string,
      implementation: code.implementation as string,
      baseAsset: code.baseAsset as string,
    }),
    officialSource: Object.freeze({
      repository: 'compound-finance/comet',
      commit: OFFICIAL_SOURCE_COMMIT,
      deploymentPath: 'deployments/mainnet/usdc',
    }),
  });
}

export function compoundIIIUSDCManifestFingerprintSha256(value: unknown): string {
  const manifest = parseCompoundIIIUSDCFinalizedManifest(value);
  return createHash('sha256')
    .update(
      JSON.stringify([
        'crypto-lending:compound-iii-ethereum-usdc-manifest:v1',
        manifest.schemaVersion,
        manifest.providerId,
        manifest.protocolId,
        manifest.networkId,
        manifest.expectedChainId,
        manifest.blockSelector,
        manifest.blockBinding,
        manifest.maximumBlockAgeSeconds,
        manifest.assetRegistry.environment,
        manifest.assetRegistry.version,
        manifest.assetRegistry.fingerprintSha256,
        manifest.marketId,
        manifest.cometProxy,
        manifest.proxyAdmin,
        manifest.implementation,
        manifest.baseAsset.symbol,
        manifest.baseAsset.address,
        manifest.baseAsset.decimals,
        manifest.baseAsset.scale,
        manifest.runtimeCodeSha256.cometProxy,
        manifest.runtimeCodeSha256.implementation,
        manifest.runtimeCodeSha256.baseAsset,
        manifest.officialSource.repository,
        manifest.officialSource.commit,
        manifest.officialSource.deploymentPath,
      ]),
      'utf8',
    )
    .digest('hex');
}
