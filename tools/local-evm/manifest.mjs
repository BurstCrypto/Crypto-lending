import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { MOCK_STABLECOIN_RUNTIME_BYTECODE } from './evm-bytecode.mjs';

const manifestUrl = new URL(
  '../../apps/api/src/blockchain/domain/local-evm-development-manifest.json',
  import.meta.url,
);
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function exactRecord(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid local EVM manifest');
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError('Invalid local EVM manifest');
  }
  return value;
}

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
}

function fingerprint(value) {
  const canonical = JSON.stringify([
    'crypto-lending:local-evm-registry:v1',
    value.schemaVersion,
    value.runtimeIdentity,
    value.engine,
    value.networkId,
    value.chainIdDecimal,
    value.chainIdHex,
    value.accounts,
    value.mockStablecoinRuntimeBytecode,
    value.registryVersion,
    value.assets.map((asset) => [
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

export function parseLocalEvmManifest(value) {
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
    record.mockStablecoinRuntimeBytecode !== MOCK_STABLECOIN_RUNTIME_BYTECODE ||
    record.registryVersion !== 1 ||
    typeof record.registryFingerprintSha256 !== 'string' ||
    !SHA256.test(record.registryFingerprintSha256) ||
    !Array.isArray(record.assets) ||
    record.assets.length !== 1
  ) {
    throw new TypeError('Invalid local EVM manifest');
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
    !ADDRESS.test(asset.contractAddress) ||
    asset.contractAddress === `0x${'0'.repeat(40)}` ||
    asset.decimals !== 6 ||
    asset.activationState !== 'ACTIVE' ||
    fingerprint(record) !== record.registryFingerprintSha256
  ) {
    throw new TypeError('Invalid local EVM manifest');
  }
  return deepFreeze(record);
}

export const LOCAL_EVM_MANIFEST = parseLocalEvmManifest(
  JSON.parse(readFileSync(manifestUrl, 'utf8')),
);
