import { createHash } from 'node:crypto';

import manifestJson from './local-evm-development-manifest.json';
import type { SupportedStablecoinAsset } from './supported-asset-registry';

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EVM_BYTECODE = /^0x(?:[0-9a-f]{2})+$/u;

export type LocalEvmDevelopmentEnvironment = 'LOCAL';
export type LocalEvmDevelopmentNetworkId = 'eip155:31337';

export interface LocalEvmDevelopmentManifest {
  readonly schemaVersion: 1;
  readonly runtimeIdentity: 'LOCAL_EVM_HARDHAT';
  readonly engine: 'hardhat-edr-simulated';
  readonly networkId: LocalEvmDevelopmentNetworkId;
  readonly chainIdDecimal: 31337;
  readonly chainIdHex: '0x7a69';
  readonly initialDate: '2026-08-25T00:00:00.000Z';
  readonly rpc: Readonly<{
    url: 'http://127.0.0.1:18545';
    host: '127.0.0.1';
    port: 18545;
  }>;
  readonly accounts: 'NONE';
  readonly mockStablecoinRuntimeBytecode: `0x${string}`;
  readonly registryVersion: 1;
  readonly registryFingerprintSha256: string;
  readonly assets: readonly Readonly<{
    stablecoin: 'USDC';
    issuer: 'CIRCLE';
    chain: 'ETHEREUM';
    contractAddress: `0x${string}`;
    decimals: 6;
    activationState: 'ACTIVE';
  }>[];
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid local EVM development manifest');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new TypeError('Invalid local EVM development manifest');
  }
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError('Invalid local EVM development manifest');
    }
    record[key] = descriptor.value;
  }
  return record;
}

function fingerprint(manifest: LocalEvmDevelopmentManifest): string {
  const canonical = JSON.stringify([
    'crypto-lending:local-evm-registry:v1',
    manifest.schemaVersion,
    manifest.runtimeIdentity,
    manifest.engine,
    manifest.networkId,
    manifest.chainIdDecimal,
    manifest.chainIdHex,
    manifest.accounts,
    manifest.mockStablecoinRuntimeBytecode,
    manifest.registryVersion,
    manifest.assets.map((asset) => [
      asset.stablecoin,
      asset.issuer,
      asset.chain,
      asset.contractAddress,
      asset.decimals,
      asset.activationState,
    ]),
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function parseLocalEvmDevelopmentManifest(value: unknown): LocalEvmDevelopmentManifest {
  const record = exactRecord(value, [
    'schemaVersion',
    'runtimeIdentity',
    'engine',
    'networkId',
    'chainIdDecimal',
    'chainIdHex',
    'initialDate',
    'rpc',
    'accounts',
    'mockStablecoinRuntimeBytecode',
    'registryVersion',
    'registryFingerprintSha256',
    'assets',
  ]);
  const rpc = exactRecord(record.rpc, ['url', 'host', 'port']);
  if (
    record.schemaVersion !== 1 ||
    record.runtimeIdentity !== 'LOCAL_EVM_HARDHAT' ||
    record.engine !== 'hardhat-edr-simulated' ||
    record.networkId !== 'eip155:31337' ||
    record.chainIdDecimal !== 31337 ||
    record.chainIdHex !== '0x7a69' ||
    record.initialDate !== '2026-08-25T00:00:00.000Z' ||
    rpc.url !== 'http://127.0.0.1:18545' ||
    rpc.host !== '127.0.0.1' ||
    rpc.port !== 18545 ||
    record.accounts !== 'NONE' ||
    typeof record.mockStablecoinRuntimeBytecode !== 'string' ||
    !EVM_BYTECODE.test(record.mockStablecoinRuntimeBytecode) ||
    record.registryVersion !== 1 ||
    typeof record.registryFingerprintSha256 !== 'string' ||
    !SHA256.test(record.registryFingerprintSha256) ||
    !Array.isArray(record.assets) ||
    record.assets.length !== 1
  ) {
    throw new TypeError('Invalid local EVM development manifest');
  }
  const asset = exactRecord(record.assets[0], [
    'stablecoin',
    'issuer',
    'chain',
    'contractAddress',
    'decimals',
    'activationState',
  ]);
  if (
    asset.stablecoin !== 'USDC' ||
    asset.issuer !== 'CIRCLE' ||
    asset.chain !== 'ETHEREUM' ||
    typeof asset.contractAddress !== 'string' ||
    !EVM_ADDRESS.test(asset.contractAddress) ||
    asset.contractAddress === `0x${'0'.repeat(40)}` ||
    asset.decimals !== 6 ||
    asset.activationState !== 'ACTIVE'
  ) {
    throw new TypeError('Invalid local EVM development manifest');
  }
  const parsed = Object.freeze({
    schemaVersion: 1,
    runtimeIdentity: 'LOCAL_EVM_HARDHAT',
    engine: 'hardhat-edr-simulated',
    networkId: 'eip155:31337',
    chainIdDecimal: 31337,
    chainIdHex: '0x7a69',
    initialDate: '2026-08-25T00:00:00.000Z',
    rpc: Object.freeze({
      url: 'http://127.0.0.1:18545',
      host: '127.0.0.1',
      port: 18545,
    }),
    accounts: 'NONE',
    mockStablecoinRuntimeBytecode: record.mockStablecoinRuntimeBytecode as `0x${string}`,
    registryVersion: 1,
    registryFingerprintSha256: record.registryFingerprintSha256,
    assets: Object.freeze([
      Object.freeze({
        stablecoin: 'USDC',
        issuer: 'CIRCLE',
        chain: 'ETHEREUM',
        contractAddress: asset.contractAddress as `0x${string}`,
        decimals: 6,
        activationState: 'ACTIVE',
      }),
    ]),
  } satisfies LocalEvmDevelopmentManifest);
  if (fingerprint(parsed) !== parsed.registryFingerprintSha256) {
    throw new TypeError('Invalid local EVM development manifest fingerprint');
  }
  return parsed;
}

export const LOCAL_EVM_DEVELOPMENT_MANIFEST = parseLocalEvmDevelopmentManifest(manifestJson);
export const LOCAL_EVM_DEVELOPMENT_ASSETS: readonly SupportedStablecoinAsset[] = Object.freeze(
  LOCAL_EVM_DEVELOPMENT_MANIFEST.assets.map((asset) =>
    Object.freeze({
      registryVersion: LOCAL_EVM_DEVELOPMENT_MANIFEST.registryVersion,
      stablecoin: asset.stablecoin,
      issuer: asset.issuer,
      chain: asset.chain,
      networkId: LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId,
      identityKind: 'EVM_CONTRACT' as const,
      identity: asset.contractAddress,
      qualifiedIdentity: `${LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId}/evm_contract:${asset.contractAddress}`,
      decimals: asset.decimals,
      activationState: asset.activationState,
      verificationSource: 'urn:crypto-lending:kan-256:local-evm-fixture',
    }),
  ),
);

export function normalizeLocalEvmDevelopmentAsset(
  networkId: string,
  identity: string,
): SupportedStablecoinAsset | undefined {
  if (networkId !== LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId || !EVM_ADDRESS.test(identity)) {
    return undefined;
  }
  const canonical = identity.toLowerCase();
  return LOCAL_EVM_DEVELOPMENT_ASSETS.find((asset) => asset.identity === canonical);
}
