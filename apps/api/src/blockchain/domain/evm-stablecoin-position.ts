import { createHash } from 'node:crypto';

import type { AssetRegistryEnvironment, SupportedStablecoin } from './supported-asset-registry';
import type { LocalEvmDevelopmentEnvironment } from './local-evm-development';

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const EVM_BLOCK_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]{0,77})$/u;
const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

declare const evmAddressBrand: unique symbol;
declare const evmAtomicBalanceBrand: unique symbol;
declare const evmBlockNumberBrand: unique symbol;
declare const evmBlockHashBrand: unique symbol;
declare const evmStablecoinPositionIdBrand: unique symbol;
declare const evmBalanceObservationIdBrand: unique symbol;
declare const evmBalanceSnapshotIdBrand: unique symbol;

export type EvmAddress = string & { readonly [evmAddressBrand]: 'EvmAddress' };
export type EvmAtomicBalance = string & {
  readonly [evmAtomicBalanceBrand]: 'EvmAtomicBalance';
};
export type EvmBlockNumber = string & { readonly [evmBlockNumberBrand]: 'EvmBlockNumber' };
export type EvmBlockHash = string & { readonly [evmBlockHashBrand]: 'EvmBlockHash' };
export type EvmStablecoinPositionId = string & {
  readonly [evmStablecoinPositionIdBrand]: 'EvmStablecoinPositionId';
};
export type EvmBalanceObservationId = string & {
  readonly [evmBalanceObservationIdBrand]: 'EvmBalanceObservationId';
};
export type EvmBalanceSnapshotId = string & {
  readonly [evmBalanceSnapshotIdBrand]: 'EvmBalanceSnapshotId';
};

export type EvmChain = 'ETHEREUM' | 'BASE' | 'ARBITRUM';
export type EvmNetworkId = `eip155:${string}`;
export type EvmStablecoinEnvironment = AssetRegistryEnvironment | LocalEvmDevelopmentEnvironment;

export type EvmStablecoinPositionValidationCode =
  | 'INVALID_EVM_ADDRESS'
  | 'INVALID_EVM_ATOMIC_BALANCE'
  | 'INVALID_EVM_BLOCK_NUMBER'
  | 'INVALID_EVM_BLOCK_HASH';

export class EvmStablecoinPositionValidationError extends Error {
  constructor(readonly code: EvmStablecoinPositionValidationCode) {
    super(code);
    this.name = 'EvmStablecoinPositionValidationError';
  }
}

export interface EvmSourceBlock {
  readonly number: EvmBlockNumber;
  readonly hash: EvmBlockHash;
  readonly parentHash: EvmBlockHash;
  readonly selector: 'latest';
}

export interface EvmStablecoinPosition {
  readonly positionId: EvmStablecoinPositionId;
  readonly observationId: EvmBalanceObservationId;
  readonly environment: EvmStablecoinEnvironment;
  readonly chain: EvmChain;
  readonly networkId: EvmNetworkId;
  readonly walletAddress: EvmAddress;
  readonly stablecoin: SupportedStablecoin;
  readonly contractAddress: EvmAddress;
  readonly decimals: number;
  readonly balanceAtomic: EvmAtomicBalance;
  readonly sourceBlock: EvmSourceBlock;
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
  readonly observationTier: 'PROVISIONAL';
  readonly authority: 'DISPLAY_ONLY';
}

export interface EvmStablecoinBalanceSnapshot {
  readonly snapshotId: EvmBalanceSnapshotId;
  readonly environment: EvmStablecoinEnvironment;
  readonly networkId: EvmNetworkId;
  readonly walletAddress: EvmAddress;
  readonly sourceBlock: EvmSourceBlock;
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
  readonly positions: readonly EvmStablecoinPosition[];
}

export interface EvmStablecoinPositionIdentityInput {
  readonly environment: EvmStablecoinEnvironment;
  readonly networkId: EvmNetworkId;
  readonly walletAddress: EvmAddress;
  readonly contractAddress: EvmAddress;
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
}

export function normalizeEvmAddress(value: unknown): EvmAddress {
  if (typeof value !== 'string' || !EVM_ADDRESS_PATTERN.test(value) || /^0x0{40}$/iu.test(value)) {
    throw new EvmStablecoinPositionValidationError('INVALID_EVM_ADDRESS');
  }
  return value.toLowerCase() as EvmAddress;
}

export function normalizeEvmAtomicBalance(value: unknown): EvmAtomicBalance {
  if (
    typeof value !== 'string' ||
    !UNSIGNED_INTEGER_PATTERN.test(value) ||
    (value.length === MAX_UINT256.length && value > MAX_UINT256)
  ) {
    throw new EvmStablecoinPositionValidationError('INVALID_EVM_ATOMIC_BALANCE');
  }
  return value as EvmAtomicBalance;
}

export function normalizeEvmBlockNumber(value: unknown): EvmBlockNumber {
  if (
    typeof value !== 'string' ||
    !UNSIGNED_INTEGER_PATTERN.test(value) ||
    (value.length === MAX_UINT256.length && value > MAX_UINT256)
  ) {
    throw new EvmStablecoinPositionValidationError('INVALID_EVM_BLOCK_NUMBER');
  }
  return value as EvmBlockNumber;
}

export function normalizeEvmBlockHash(value: unknown): EvmBlockHash {
  if (typeof value !== 'string' || !EVM_BLOCK_HASH_PATTERN.test(value)) {
    throw new EvmStablecoinPositionValidationError('INVALID_EVM_BLOCK_HASH');
  }
  return value.toLowerCase() as EvmBlockHash;
}

export function createEvmStablecoinPositionId(
  input: EvmStablecoinPositionIdentityInput,
): EvmStablecoinPositionId {
  return digest(
    'crypto-lending:evm-stablecoin-position:v1',
    input.environment,
    input.networkId,
    input.walletAddress,
    input.contractAddress,
    String(input.registryVersion),
    input.registryFingerprintSha256,
  ) as EvmStablecoinPositionId;
}

export function createEvmBalanceObservationId(
  positionId: EvmStablecoinPositionId,
  sourceBlock: EvmSourceBlock,
): EvmBalanceObservationId {
  return digest(
    'crypto-lending:evm-stablecoin-balance-observation:v1',
    positionId,
    sourceBlock.number,
    sourceBlock.hash,
  ) as EvmBalanceObservationId;
}

export function createEvmBalanceSnapshotId(
  environment: EvmStablecoinEnvironment,
  networkId: EvmNetworkId,
  walletAddress: EvmAddress,
  sourceBlock: EvmSourceBlock,
  registryVersion: number,
  registryFingerprintSha256: string,
): EvmBalanceSnapshotId {
  return digest(
    'crypto-lending:evm-stablecoin-balance-snapshot:v1',
    environment,
    networkId,
    walletAddress,
    sourceBlock.number,
    sourceBlock.hash,
    String(registryVersion),
    registryFingerprintSha256,
  ) as EvmBalanceSnapshotId;
}

function digest(domain: string, ...parts: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([domain, ...parts]), 'utf8')
    .digest('hex');
}
