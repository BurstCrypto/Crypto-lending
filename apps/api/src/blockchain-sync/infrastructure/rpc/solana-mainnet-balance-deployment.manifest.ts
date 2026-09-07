import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  decodeSolanaPublicKey,
  SOLANA_TOKEN_PROGRAM_IDS,
} from '../../../blockchain/domain/solana-token-account';
import { supportedAssetRegistryForEnvironment } from '../../../blockchain/domain/supported-asset-registry';

const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]{0,19})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_UINT64 = (1n << 64n) - 1n;

export const SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_VERSION = 1 as const;
export const SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID =
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
export const SOLANA_BPF_UPGRADEABLE_LOADER_V3 =
  'BPFLoaderUpgradeab1e11111111111111111111111' as const;

export interface SolanaMainnetBalanceDeploymentAssetV1 {
  readonly stablecoin: 'PYUSD' | 'USDC' | 'USDT';
  readonly mintAddress: string;
  readonly tokenProgramAddress: string;
  readonly decimals: 6;
  readonly mintAuthorityAddress: string | null;
  readonly freezeAuthorityAddress: string | null;
  /** SHA-256 of the exact mint bytes with only the mutable supply field zeroed. */
  readonly mintConfigurationSha256: string;
}

export interface SolanaMainnetBalanceDeploymentProgramV1 {
  readonly route: 'BPF_UPGRADEABLE_LOADER_V3';
  readonly programAddress: string;
  readonly loaderAddress: typeof SOLANA_BPF_UPGRADEABLE_LOADER_V3;
  readonly programDataAddress: string;
  readonly deployedAtSlot: string;
  readonly upgradeAuthorityAddress: string | null;
  readonly programBinarySha256: string;
}

export interface SolanaMainnetBalanceDeploymentManifestContentV1 {
  readonly schemaVersion: typeof SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_VERSION;
  readonly environment: 'MAINNET';
  readonly networkId: typeof SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID;
  readonly approvalStatus: 'NOT_APPROVED' | 'APPROVED';
  readonly approvedAt: string | null;
  readonly expiresAt: string | null;
  readonly validFromSlot: string | null;
  readonly validThroughSlot: string | null;
  readonly assets: readonly SolanaMainnetBalanceDeploymentAssetV1[];
  readonly programs: readonly SolanaMainnetBalanceDeploymentProgramV1[];
}

export interface SolanaMainnetBalanceDeploymentManifestV1 extends SolanaMainnetBalanceDeploymentManifestContentV1 {
  readonly fingerprintSha256: string;
}

const EXPECTED_ASSETS = Object.freeze(
  supportedAssetRegistryForEnvironment('MAINNET')
    .latest.assets.filter(
      ({ networkId, activationState }) =>
        networkId === SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID && activationState === 'ACTIVE',
    )
    .map(({ stablecoin, identity, decimals }) => ({ stablecoin, identity, decimals }))
    .sort((left, right) => compare(left.identity, right.identity)),
);

const EXPECTED_TOKEN_PROGRAM_BY_MINT = Object.freeze({
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
} as const);

const MANIFEST_KEYS = Object.freeze([
  'schemaVersion',
  'environment',
  'networkId',
  'approvalStatus',
  'approvedAt',
  'expiresAt',
  'validFromSlot',
  'validThroughSlot',
  'assets',
  'programs',
] as const);

const UNAPPROVED_CONTENT: SolanaMainnetBalanceDeploymentManifestContentV1 = deepFreeze({
  schemaVersion: SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_VERSION,
  environment: 'MAINNET',
  networkId: SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID,
  approvalStatus: 'NOT_APPROVED',
  approvedAt: null,
  expiresAt: null,
  validFromSlot: null,
  validThroughSlot: null,
  assets: Object.freeze([]),
  programs: Object.freeze([]),
});

/**
 * Checked-in posture only. Live mint and loader observations must be captured,
 * independently reviewed, and supplied as a separate approved manifest.
 */
export const SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_V1: SolanaMainnetBalanceDeploymentManifestV1 =
  deepFreeze({
    ...UNAPPROVED_CONTENT,
    fingerprintSha256: fingerprintContent(UNAPPROVED_CONTENT),
  });

/** Produces the fingerprint an independent approval record must bind. */
export function fingerprintSolanaMainnetBalanceDeploymentManifestV1(input: unknown): string {
  const content = parseManifestContent(input);
  if (content === null) throw new TypeError('invalid Solana deployment manifest content');
  return fingerprintContent(content);
}

/** Returns an owned, canonical manifest and never trusts caller-owned objects. */
export function reviewSolanaMainnetBalanceDeploymentManifestV1(
  input: unknown,
): Readonly<SolanaMainnetBalanceDeploymentManifestV1> | null {
  const record = exactDataRecord(input, [...MANIFEST_KEYS, 'fingerprintSha256']);
  if (record === null) return null;
  const content = parseManifestContent({
    schemaVersion: record.schemaVersion,
    environment: record.environment,
    networkId: record.networkId,
    approvalStatus: record.approvalStatus,
    approvedAt: record.approvedAt,
    expiresAt: record.expiresAt,
    validFromSlot: record.validFromSlot,
    validThroughSlot: record.validThroughSlot,
    assets: record.assets,
    programs: record.programs,
  });
  if (
    content === null ||
    typeof record.fingerprintSha256 !== 'string' ||
    !SHA256.test(record.fingerprintSha256) ||
    record.fingerprintSha256 !== fingerprintContent(content)
  ) {
    return null;
  }
  return deepFreeze({ ...content, fingerprintSha256: record.fingerprintSha256 });
}

function parseManifestContent(
  input: unknown,
): Readonly<SolanaMainnetBalanceDeploymentManifestContentV1> | null {
  const record = exactDataRecord(input, MANIFEST_KEYS);
  if (
    record === null ||
    record.schemaVersion !== SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_VERSION ||
    record.environment !== 'MAINNET' ||
    record.networkId !== SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID ||
    (record.approvalStatus !== 'NOT_APPROVED' && record.approvalStatus !== 'APPROVED')
  ) {
    return null;
  }
  const assetsInput = dataArray(record.assets, 3);
  const programsInput = dataArray(record.programs, 2);
  if (assetsInput === null || programsInput === null) return null;

  if (record.approvalStatus === 'NOT_APPROVED') {
    if (
      record.approvedAt !== null ||
      record.expiresAt !== null ||
      record.validFromSlot !== null ||
      record.validThroughSlot !== null ||
      assetsInput.length !== 0 ||
      programsInput.length !== 0
    ) {
      return null;
    }
    return UNAPPROVED_CONTENT;
  }

  const approvedAt = canonicalTimestamp(record.approvedAt);
  const expiresAt = canonicalTimestamp(record.expiresAt);
  const validFromSlot = canonicalUint64(record.validFromSlot);
  const validThroughSlot = canonicalUint64(record.validThroughSlot);
  const assets = assetsInput.map(parseAsset);
  const programs = programsInput.map(parseProgram);
  if (
    approvedAt === null ||
    expiresAt === null ||
    approvedAt.milliseconds >= expiresAt.milliseconds ||
    validFromSlot === null ||
    validThroughSlot === null ||
    BigInt(validFromSlot) > BigInt(validThroughSlot) ||
    assets.some((asset) => asset === null) ||
    programs.some((program) => program === null)
  ) {
    return null;
  }
  const reviewedAssets = assets as SolanaMainnetBalanceDeploymentAssetV1[];
  const reviewedPrograms = programs as SolanaMainnetBalanceDeploymentProgramV1[];
  reviewedAssets.sort((left, right) => compare(left.mintAddress, right.mintAddress));
  reviewedPrograms.sort((left, right) => compare(left.programAddress, right.programAddress));
  const expectedPrograms = [
    ...new Set(reviewedAssets.map(({ tokenProgramAddress }) => tokenProgramAddress)),
  ].sort(compare);
  if (
    EXPECTED_ASSETS.length !== 3 ||
    reviewedAssets.length !== EXPECTED_ASSETS.length ||
    reviewedAssets.some((asset, index) => {
      const expected = EXPECTED_ASSETS[index];
      return (
        expected === undefined ||
        asset.mintAddress !== expected.identity ||
        asset.stablecoin !== expected.stablecoin ||
        asset.decimals !== expected.decimals ||
        asset.tokenProgramAddress !== tokenProgramForMint(expected.identity)
      );
    }) ||
    reviewedPrograms.length !== expectedPrograms.length ||
    reviewedPrograms.some(
      (program, index) =>
        program.programAddress !== expectedPrograms[index] ||
        BigInt(program.deployedAtSlot) > BigInt(validFromSlot),
    ) ||
    new Set(reviewedPrograms.map(({ programDataAddress }) => programDataAddress)).size !==
      reviewedPrograms.length ||
    reviewedPrograms.some(({ programDataAddress }) =>
      [
        ...reviewedAssets.map(({ mintAddress }) => mintAddress),
        ...reviewedPrograms.map(({ programAddress }) => programAddress),
      ].includes(programDataAddress),
    )
  ) {
    return null;
  }
  return deepFreeze({
    schemaVersion: SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_VERSION,
    environment: 'MAINNET',
    networkId: SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID,
    approvalStatus: 'APPROVED',
    approvedAt: approvedAt.timestamp,
    expiresAt: expiresAt.timestamp,
    validFromSlot,
    validThroughSlot,
    assets: Object.freeze(reviewedAssets),
    programs: Object.freeze(reviewedPrograms),
  });
}

function parseAsset(value: unknown): SolanaMainnetBalanceDeploymentAssetV1 | null {
  const record = exactDataRecord(value, [
    'stablecoin',
    'mintAddress',
    'tokenProgramAddress',
    'decimals',
    'mintAuthorityAddress',
    'freezeAuthorityAddress',
    'mintConfigurationSha256',
  ]);
  if (
    record === null ||
    (record.stablecoin !== 'PYUSD' &&
      record.stablecoin !== 'USDC' &&
      record.stablecoin !== 'USDT') ||
    !canonicalPublicKey(record.mintAddress) ||
    !canonicalPublicKey(record.tokenProgramAddress) ||
    record.decimals !== 6 ||
    !nullablePublicKey(record.mintAuthorityAddress) ||
    !nullablePublicKey(record.freezeAuthorityAddress) ||
    typeof record.mintConfigurationSha256 !== 'string' ||
    !nonzeroSha256(record.mintConfigurationSha256)
  ) {
    return null;
  }
  return deepFreeze({
    stablecoin: record.stablecoin,
    mintAddress: record.mintAddress,
    tokenProgramAddress: record.tokenProgramAddress,
    decimals: 6,
    mintAuthorityAddress: record.mintAuthorityAddress,
    freezeAuthorityAddress: record.freezeAuthorityAddress,
    mintConfigurationSha256: record.mintConfigurationSha256,
  });
}

function parseProgram(value: unknown): SolanaMainnetBalanceDeploymentProgramV1 | null {
  const record = exactDataRecord(value, [
    'route',
    'programAddress',
    'loaderAddress',
    'programDataAddress',
    'deployedAtSlot',
    'upgradeAuthorityAddress',
    'programBinarySha256',
  ]);
  const deployedAtSlot = canonicalUint64(record?.deployedAtSlot);
  if (
    record === null ||
    record.route !== 'BPF_UPGRADEABLE_LOADER_V3' ||
    !canonicalPublicKey(record.programAddress) ||
    record.loaderAddress !== SOLANA_BPF_UPGRADEABLE_LOADER_V3 ||
    !canonicalPublicKey(record.programDataAddress) ||
    deployedAtSlot === null ||
    !nullablePublicKey(record.upgradeAuthorityAddress) ||
    typeof record.programBinarySha256 !== 'string' ||
    !nonzeroSha256(record.programBinarySha256)
  ) {
    return null;
  }
  return deepFreeze({
    route: 'BPF_UPGRADEABLE_LOADER_V3',
    programAddress: record.programAddress,
    loaderAddress: SOLANA_BPF_UPGRADEABLE_LOADER_V3,
    programDataAddress: record.programDataAddress,
    deployedAtSlot,
    upgradeAuthorityAddress: record.upgradeAuthorityAddress,
    programBinarySha256: record.programBinarySha256,
  });
}

function tokenProgramForMint(mint: string): string | undefined {
  return EXPECTED_TOKEN_PROGRAM_BY_MINT[mint as keyof typeof EXPECTED_TOKEN_PROGRAM_BY_MINT];
}

function canonicalTimestamp(
  value: unknown,
): { readonly timestamp: string; readonly milliseconds: number } | null {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) return null;
  return Object.freeze({ timestamp: value, milliseconds });
}

function canonicalUint64(value: unknown): string | null {
  if (typeof value !== 'string' || !CANONICAL_UINT.test(value)) return null;
  try {
    return BigInt(value) <= MAX_UINT64 ? value : null;
  } catch {
    return null;
  }
}

function nullablePublicKey(value: unknown): value is string | null {
  return value === null || canonicalPublicKey(value);
}

function canonicalPublicKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    decodeSolanaPublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function nonzeroSha256(value: string): boolean {
  return SHA256.test(value) && value !== '0'.repeat(64);
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value))
      return null;
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return null;
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function dataArray(value: unknown, maximumLength: number): unknown[] | null {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximumLength ||
      lengthDescriptor.enumerable
    ) {
      return null;
    }
    const length = lengthDescriptor.value;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== length + 1 ||
      actualKeys.some(
        (key) =>
          typeof key !== 'string' ||
          (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)),
      )
    ) {
      return null;
    }
    return Array.from({ length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('invalid array');
      return descriptor.value;
    });
  } catch {
    return null;
  }
}

function fingerprintContent(content: SolanaMainnetBalanceDeploymentManifestContentV1): string {
  return createHash('sha256')
    .update('crypto-lending:solana-mainnet-balance-deployment-manifest:v1\0', 'utf8')
    .update(canonicalJson(content), 'utf8')
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<const Value>(value: Value): Readonly<Value> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
