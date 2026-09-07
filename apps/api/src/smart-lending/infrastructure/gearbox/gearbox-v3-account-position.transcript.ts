import { Buffer } from 'node:buffer';
import { createHash, type Hash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  gearboxV3ManifestFingerprintSha256,
  parseGearboxV3EthereumUSDCManifest,
  type GearboxV3EthereumUSDCManifest,
} from './gearbox-v3-ethereum-usdc.manifest';
import {
  aggregateGearboxV3CreditAccountDebtAtomic,
  GEARBOX_V3_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS,
  GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES,
  GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
  projectGearboxV3CreditAccountDebt,
  projectGearboxV3DieselSharesToUnderlyingDown,
  type GearboxV3CreditAccountDebtProjection,
  type GearboxV3DieselSupplyProjection,
} from './gearbox-v3-account-position.semantics';

export const GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_VERSION = 1 as const;
export const GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_USE =
  'DORMANT_GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_VALIDATION_ONLY' as const;
export const GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_VERSION = 1 as const;
export const GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_USE =
  'CALLER_SUPPLIED_GEARBOX_V3_ACCOUNT_POSITION_TOPOLOGY_APPROVAL_ONLY' as const;

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT16 = (1n << 16n) - 1n;
const MAX_MANAGERS =
  GEARBOX_V3_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS.responseBounds.maximumManagers;
const MAX_ACCOUNTS =
  GEARBOX_V3_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS.responseBounds.maximumAccountsAcrossManagers;
const PAGE_SIZE = GEARBOX_V3_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS.responseBounds.maximumPageSize;
const MAX_QUOTED_TOKENS = 256;
const MAX_DATA_DEPTH = 18;
const MAX_DATA_NODES = 4_000_000;
const MAX_STRING_BYTES = 64 * 1024 * 1024;
const MAX_OBJECT_KEYS = 32;
const MAX_STRUCTURAL_ARRAY_LENGTH =
  MAX_ACCOUNTS + MAX_MANAGERS * 8 + Math.ceil(MAX_ACCOUNTS / PAGE_SIZE) + 32;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO_HASH = '0'.repeat(64);
const ZERO_EVM_HASH = `0x${'0'.repeat(64)}`;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const EVM_HASH = /^0x[0-9a-f]{64}$/u;
const UINT = /^(?:0|[1-9][0-9]{0,77})$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PINNED_STATIC_CONTRACT_ADDRESSES: ReadonlySet<string> = new Set([
  GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.addressProviderAddress,
  GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.contractsRegisterAddress,
  GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.poolAddress,
  GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.underlyingUsdcAddress,
]);

const MANIFEST_KEYS = Object.freeze([
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
] as const);

const APPROVAL_KEYS = Object.freeze([
  'approvalVersion',
  'use',
  'mayEstablishRecommendationEligibility',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'mayCreatePositionSnapshot',
  'maySign',
  'mayAccessWalletPrivateKey',
  'manifestFingerprintSha256',
  'semanticsFingerprintSha256',
  'root',
  'managers',
] as const);
const APPROVAL_ROOT_KEYS = Object.freeze([
  'accountFactoryAddress',
  'accountFactoryRuntimeCodeSha256',
  'poolQuotaKeeperAddress',
  'poolQuotaKeeperRuntimeCodeSha256',
] as const);
const APPROVAL_MANAGER_KEYS = Object.freeze([
  'managerAddress',
  'managerRuntimeCodeSha256',
  'facadeAddress',
  'facadeRuntimeCodeSha256',
  'creditAccounts',
] as const);
const APPROVAL_ACCOUNT_KEYS = Object.freeze(['accountAddress', 'runtimeCodeSha256'] as const);
const TRANSCRIPT_KEYS = Object.freeze([
  'transcriptVersion',
  'use',
  'mayEstablishRecommendationEligibility',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'mayCreatePositionSnapshot',
  'maySign',
  'mayAccessWalletPrivateKey',
  'manifestFingerprintSha256',
  'semanticsFingerprintSha256',
  'approvalFingerprintSha256',
  'walletAddress',
  'evaluatedAt',
  'chainIdBefore',
  'blockSelector',
  'selectedBlock',
  'blockBinding',
  'continuityFloor',
  'staticCodeReads',
  'root',
  'managerAddressesBefore',
  'supply',
  'managers',
  'managerAddressesAfter',
  'closeoutBlock',
  'chainIdAfter',
  'executionOrder',
] as const);
const BLOCK_KEYS = Object.freeze([
  'number',
  'hash',
  'parentHash',
  'stateRoot',
  'timestamp',
] as const);
const CONTINUITY_KEYS = Object.freeze(['kind', 'blockNumber', 'blockHash'] as const);
const CODE_READ_KEYS = Object.freeze([
  'role',
  'address',
  'blockHash',
  'requireCanonical',
  'observedRuntimeCodeSha256',
] as const);
const ROOT_KEYS = Object.freeze([
  'blockHash',
  'requireCanonical',
  'contractsRegisterFromAddressProvider',
  'accountFactoryFromAddressProvider',
  'poolRegistered',
  'poolAddressProvider',
  'poolUnderlying',
  'poolAsset',
  'poolVersion',
  'poolDecimals',
  'underlyingDecimals',
  'poolQuotaKeeper',
  'poolQuotaKeeperRuntimeCodeSha256',
  'poolQuotaKeeperPool',
  'poolQuotaKeeperUnderlying',
  'poolQuotaKeeperVersion',
  'accountFactoryRuntimeCodeSha256',
  'accountFactoryVersion',
] as const);
const SUPPLY_KEYS = Object.freeze([
  'blockHash',
  'requireCanonical',
  'walletAddress',
  'sharesAtomic',
  'totalAssetsAtomic',
  'totalSupplyAtomic',
] as const);
const MANAGER_KEYS = Object.freeze([
  'managerAddress',
  'blockHash',
  'requireCanonical',
  'managerRuntimeCodeSha256',
  'pool',
  'underlying',
  'addressProvider',
  'accountFactory',
  'creditFacade',
  'poolQuotaKeeper',
  'version',
  'facadeRuntimeCodeSha256',
  'facadeCreditManager',
  'facadeVersion',
  'creditAccountsLengthBefore',
  'pages',
  'accounts',
  'creditAccountsLengthAfter',
] as const);
const PAGE_KEYS = Object.freeze(['offset', 'limit', 'accountAddresses'] as const);
const ACCOUNT_KEYS = Object.freeze([
  'accountAddress',
  'runtimeCodeSha256',
  'creditManager',
  'factory',
  'version',
  'creditAccountInfo',
  'debtOnly',
] as const);
const ACCOUNT_INFO_KEYS = Object.freeze([
  'debtAtomic',
  'cumulativeIndexLastUpdate',
  'cumulativeQuotaInterest',
  'quotaFees',
  'enabledTokensMask',
  'flags',
  'lastDebtUpdate',
  'borrowerAddress',
] as const);
const DEBT_ONLY_KEYS = Object.freeze([
  'debtAtomic',
  'cumulativeIndexNow',
  'cumulativeIndexLastUpdate',
  'cumulativeQuotaInterest',
  'accruedInterestAtomic',
  'accruedFeesAtomic',
  'totalDebtUsd',
  'totalValue',
  'totalValueUsd',
  'twvUsd',
  'enabledTokensMask',
  'quotedTokensMask',
  'quotedTokenAddresses',
  'poolQuotaKeeper',
] as const);

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export class GearboxV3AccountPositionTranscriptUnavailableError extends Error {
  readonly code = 'GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_UNAVAILABLE' as const;

  constructor() {
    super('Gearbox V3 account-position transcript is unavailable.');
    this.name = 'GearboxV3AccountPositionTranscriptUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

function unavailable(): never {
  throw new GearboxV3AccountPositionTranscriptUnavailableError();
}

function consumeStringBudget(value: string, consumed: number): number {
  const remaining = MAX_STRING_BYTES - consumed;
  if (remaining < 0 || value.length > remaining) return unavailable();
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > remaining) return unavailable();
  return consumed + bytes;
}

function assertBoundedPlainData(value: unknown): void {
  const seen = new WeakSet<object>();
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  let stringBytes = 0;
  try {
    while (stack.length > 0) {
      const entry = stack.pop();
      if (!entry) return unavailable();
      nodes += 1;
      if (nodes > MAX_DATA_NODES || entry.depth > MAX_DATA_DEPTH) return unavailable();
      const candidate = entry.value;
      if (typeof candidate === 'string') {
        stringBytes = consumeStringBudget(candidate, stringBytes);
        continue;
      }
      if (
        candidate === null ||
        typeof candidate === 'boolean' ||
        (typeof candidate === 'number' && Number.isSafeInteger(candidate))
      ) {
        continue;
      }
      if (typeof candidate !== 'object' || isProxy(candidate) || seen.has(candidate)) {
        return unavailable();
      }
      seen.add(candidate);
      if (Array.isArray(candidate)) {
        if (Object.getPrototypeOf(candidate) !== Array.prototype) return unavailable();
        const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, 'length');
        if (
          !lengthDescriptor ||
          !('value' in lengthDescriptor) ||
          typeof lengthDescriptor.value !== 'number' ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0 ||
          lengthDescriptor.value > MAX_STRUCTURAL_ARRAY_LENGTH
        ) {
          return unavailable();
        }
        const keys = Reflect.ownKeys(candidate);
        if (
          keys.length !== lengthDescriptor.value + 1 ||
          keys[lengthDescriptor.value] !== 'length'
        ) {
          return unavailable();
        }
        for (let index = 0; index < lengthDescriptor.value; index += 1) {
          if (keys[index] !== String(index)) return unavailable();
        }
        for (let index = lengthDescriptor.value - 1; index >= 0; index -= 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (!descriptor?.enumerable || !('value' in descriptor)) return unavailable();
          stack.push({ value: descriptor.value, depth: entry.depth + 1 });
        }
        continue;
      }
      const prototype = Object.getPrototypeOf(candidate) as unknown;
      if (prototype !== Object.prototype && prototype !== null) return unavailable();
      const keys = Reflect.ownKeys(candidate);
      if (keys.length > MAX_OBJECT_KEYS) return unavailable();
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (typeof key !== 'string') return unavailable();
        stringBytes = consumeStringBudget(key, stringBytes);
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) return unavailable();
        stack.push({ value: descriptor.value, depth: entry.depth + 1 });
      }
    }
  } catch (error) {
    if (error instanceof GearboxV3AccountPositionTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return unavailable();
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return unavailable();
    const actual = Reflect.ownKeys(value);
    if (
      actual.length > MAX_OBJECT_KEYS ||
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return unavailable();
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return unavailable();
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof GearboxV3AccountPositionTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function exactArray(value: unknown, maximum: number): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return unavailable();
    }
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      !length ||
      !('value' in length) ||
      typeof length.value !== 'number' ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximum
    ) {
      return unavailable();
    }
    const actual = Reflect.ownKeys(value);
    if (actual.length !== length.value + 1 || actual[length.value] !== 'length') {
      return unavailable();
    }
    const result: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const key = String(index);
      if (actual[index] !== key) return unavailable();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) return unavailable();
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof GearboxV3AccountPositionTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function address(value: unknown): string {
  if (typeof value !== 'string' || !ADDRESS.test(value) || value === ZERO_ADDRESS) {
    return unavailable();
  }
  return value;
}

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value) || value === ZERO_HASH) return unavailable();
  return value;
}

function evmHash(value: unknown): string {
  if (typeof value !== 'string' || !EVM_HASH.test(value) || value === ZERO_EVM_HASH) {
    return unavailable();
  }
  return value;
}

function uint(value: unknown): string {
  if (typeof value !== 'string' || !UINT.test(value)) return unavailable();
  try {
    if (BigInt(value) > MAX_UINT256) return unavailable();
    return value;
  } catch {
    return unavailable();
  }
}

function boundedUint(value: unknown, maximum: bigint): string {
  const parsed = uint(value);
  if (BigInt(parsed) > maximum) return unavailable();
  return parsed;
}

function boundedCount(value: unknown, maximum: number): number {
  const parsed = uint(value);
  const count = BigInt(parsed);
  if (count > BigInt(maximum)) return unavailable();
  return Number(count);
}

function canonicalTimestamp(value: unknown): Readonly<{ value: string; milliseconds: bigint }> {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return unavailable();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return unavailable();
  }
  return frozen({ value, milliseconds: BigInt(milliseconds) });
}

function booleanFalse(value: unknown): false {
  if (value !== false) return unavailable();
  return false;
}

function hashCanonical(domain: string, value: unknown): string {
  const hash = createHash('sha256').update(domain, 'utf8');
  updateCanonicalJson(hash, value);
  return hash.digest('hex');
}

function jsonToken(value: string | number | boolean | null): string {
  const token = JSON.stringify(value);
  if (typeof token !== 'string') return unavailable();
  return token;
}

function updateCanonicalJson(hash: Hash, value: unknown): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    hash.update(jsonToken(value), 'utf8');
    return;
  }
  if (typeof value === 'string') {
    hash.update(jsonToken(value), 'utf8');
    return;
  }
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (!length || !('value' in length) || typeof length.value !== 'number') {
      return unavailable();
    }
    hash.update('[', 'utf8');
    for (let index = 0; index < length.value; index += 1) {
      if (index > 0) hash.update(',', 'utf8');
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) return unavailable();
      updateCanonicalJson(hash, descriptor.value);
    }
    hash.update(']', 'utf8');
    return;
  }
  if (typeof value !== 'object' || value === null) return unavailable();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return unavailable();
  const stringKeys = (keys as string[]).sort();
  hash.update('{', 'utf8');
  for (let index = 0; index < stringKeys.length; index += 1) {
    const key = stringKeys[index];
    if (key === undefined) return unavailable();
    if (index > 0) hash.update(',', 'utf8');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return unavailable();
    hash.update(jsonToken(key), 'utf8').update(':', 'utf8');
    updateCanonicalJson(hash, descriptor.value);
  }
  hash.update('}', 'utf8');
}

export interface GearboxV3AccountPositionTranscriptApprovalAccountV1 {
  readonly accountAddress: string;
  readonly runtimeCodeSha256: string;
}

export interface GearboxV3AccountPositionTranscriptApprovalManagerV1 {
  readonly managerAddress: string;
  readonly managerRuntimeCodeSha256: string;
  readonly facadeAddress: string;
  readonly facadeRuntimeCodeSha256: string;
  readonly creditAccounts: readonly GearboxV3AccountPositionTranscriptApprovalAccountV1[];
}

export interface GearboxV3AccountPositionTranscriptApprovalV1 {
  readonly approvalVersion: typeof GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_VERSION;
  readonly use: typeof GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_USE;
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly maySign: false;
  readonly mayAccessWalletPrivateKey: false;
  readonly manifestFingerprintSha256: string;
  readonly semanticsFingerprintSha256: string;
  readonly root: Readonly<{
    readonly accountFactoryAddress: string;
    readonly accountFactoryRuntimeCodeSha256: string;
    readonly poolQuotaKeeperAddress: string;
    readonly poolQuotaKeeperRuntimeCodeSha256: string;
  }>;
  readonly managers: readonly GearboxV3AccountPositionTranscriptApprovalManagerV1[];
}

function parseApproval(value: unknown): GearboxV3AccountPositionTranscriptApprovalV1 {
  const record = exactRecord(value, APPROVAL_KEYS);
  assertBoundedPlainData(record);
  if (
    record.approvalVersion !== GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_VERSION ||
    record.use !== GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_USE
  ) {
    return unavailable();
  }
  booleanFalse(record.mayEstablishRecommendationEligibility);
  booleanFalse(record.mayAuthorizeFinancialAction);
  booleanFalse(record.mayPersist);
  booleanFalse(record.mayCreatePositionSnapshot);
  booleanFalse(record.maySign);
  booleanFalse(record.mayAccessWalletPrivateKey);
  const rootRecord = exactRecord(record.root, APPROVAL_ROOT_KEYS);
  const root = frozen({
    accountFactoryAddress: address(rootRecord.accountFactoryAddress),
    accountFactoryRuntimeCodeSha256: sha256(rootRecord.accountFactoryRuntimeCodeSha256),
    poolQuotaKeeperAddress: address(rootRecord.poolQuotaKeeperAddress),
    poolQuotaKeeperRuntimeCodeSha256: sha256(rootRecord.poolQuotaKeeperRuntimeCodeSha256),
  });
  if (
    root.accountFactoryAddress !== GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.accountFactoryAddress ||
    root.accountFactoryAddress === root.poolQuotaKeeperAddress ||
    PINNED_STATIC_CONTRACT_ADDRESSES.has(root.accountFactoryAddress) ||
    PINNED_STATIC_CONTRACT_ADDRESSES.has(root.poolQuotaKeeperAddress)
  ) {
    return unavailable();
  }
  const managerValues = exactArray(record.managers, MAX_MANAGERS);
  let accountCount = 0;
  const identities = new Set<string>([
    ...PINNED_STATIC_CONTRACT_ADDRESSES,
    root.accountFactoryAddress,
    root.poolQuotaKeeperAddress,
  ]);
  const managers = managerValues.map((managerValue) => {
    const managerRecord = exactRecord(managerValue, APPROVAL_MANAGER_KEYS);
    const managerAddress = address(managerRecord.managerAddress);
    const facadeAddress = address(managerRecord.facadeAddress);
    if (
      managerAddress === facadeAddress ||
      identities.has(managerAddress) ||
      identities.has(facadeAddress)
    ) {
      return unavailable();
    }
    identities.add(managerAddress);
    identities.add(facadeAddress);
    const accountValues = exactArray(managerRecord.creditAccounts, MAX_ACCOUNTS - accountCount);
    const creditAccounts = accountValues.map((accountValue) => {
      const accountRecord = exactRecord(accountValue, APPROVAL_ACCOUNT_KEYS);
      const accountAddress = address(accountRecord.accountAddress);
      if (identities.has(accountAddress)) return unavailable();
      identities.add(accountAddress);
      accountCount += 1;
      if (accountCount > MAX_ACCOUNTS) return unavailable();
      return frozen({
        accountAddress,
        runtimeCodeSha256: sha256(accountRecord.runtimeCodeSha256),
      });
    });
    return frozen({
      managerAddress,
      managerRuntimeCodeSha256: sha256(managerRecord.managerRuntimeCodeSha256),
      facadeAddress,
      facadeRuntimeCodeSha256: sha256(managerRecord.facadeRuntimeCodeSha256),
      creditAccounts: Object.freeze(creditAccounts),
    });
  });
  return frozen({
    approvalVersion: GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_VERSION,
    use: GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_USE,
    mayEstablishRecommendationEligibility: false as const,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    mayCreatePositionSnapshot: false as const,
    maySign: false as const,
    mayAccessWalletPrivateKey: false as const,
    manifestFingerprintSha256: sha256(record.manifestFingerprintSha256),
    semanticsFingerprintSha256: sha256(record.semanticsFingerprintSha256),
    root,
    managers: Object.freeze(managers),
  });
}

export function gearboxV3AccountPositionTranscriptApprovalFingerprintSha256(
  value: unknown,
): string {
  try {
    const approval = parseApproval(value);
    return hashCanonical(
      'crypto-lending:gearbox-v3-account-position-transcript-approval:v1\0',
      approval,
    );
  } catch (error) {
    if (error instanceof GearboxV3AccountPositionTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function executionOrder(approval: GearboxV3AccountPositionTranscriptApprovalV1): readonly string[] {
  const operations: string[] = [
    'CHAIN_ID_BEFORE',
    'SELECT_FINALIZED_BLOCK',
    'STATIC_CODE:ADDRESS_PROVIDER',
    'STATIC_CODE:CONTRACTS_REGISTER',
    'STATIC_CODE:POOL',
    'STATIC_CODE:UNDERLYING',
    'ROOT_DYNAMIC_CODE_AND_TOPOLOGY',
    'POOL_CREDIT_MANAGERS_BEFORE',
    'POOL_WALLET_SUPPLY',
  ];
  for (const manager of approval.managers) {
    operations.push(`MANAGER:${manager.managerAddress}:CODE_AND_TOPOLOGY`);
    operations.push(`FACADE:${manager.facadeAddress}:CODE_AND_REVERSE_LINK`);
    operations.push(`MANAGER:${manager.managerAddress}:CREDIT_ACCOUNTS_LENGTH_BEFORE`);
    for (let offset = 0; offset < manager.creditAccounts.length; offset += PAGE_SIZE) {
      const limit = Math.min(PAGE_SIZE, manager.creditAccounts.length - offset);
      operations.push(`MANAGER:${manager.managerAddress}:CREDIT_ACCOUNTS_PAGE:${offset}:${limit}`);
    }
    for (const account of manager.creditAccounts) {
      operations.push(`ACCOUNT:${account.accountAddress}:CODE_TOPOLOGY_AND_DEBT`);
    }
    operations.push(`MANAGER:${manager.managerAddress}:CREDIT_ACCOUNTS_LENGTH_AFTER`);
  }
  operations.push('POOL_CREDIT_MANAGERS_AFTER', 'CLOSEOUT_BLOCK', 'CHAIN_ID_AFTER');
  return Object.freeze(operations);
}

export function gearboxV3AccountPositionTranscriptExecutionOrder(
  approvalValue: unknown,
): readonly string[] {
  try {
    return executionOrder(parseApproval(approvalValue));
  } catch (error) {
    if (error instanceof GearboxV3AccountPositionTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

interface ParsedBlock {
  readonly number: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly timestamp: string;
}

function parseBlock(value: unknown): ParsedBlock {
  const record = exactRecord(value, BLOCK_KEYS);
  return frozen({
    number: uint(record.number),
    hash: evmHash(record.hash),
    parentHash: evmHash(record.parentHash),
    stateRoot: evmHash(record.stateRoot),
    timestamp: uint(record.timestamp),
  });
}

function sameBlock(left: ParsedBlock, right: ParsedBlock): boolean {
  return BLOCK_KEYS.every((key) => left[key] === right[key]);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function stringArray(value: unknown, maximum: number): readonly string[] {
  return Object.freeze(
    exactArray(value, maximum).map((item) => {
      if (typeof item !== 'string') return unavailable();
      return item;
    }),
  );
}

function addressArray(value: unknown, maximum: number): readonly string[] {
  const values = exactArray(value, maximum).map(address);
  if (new Set(values).size !== values.length) return unavailable();
  return Object.freeze(values);
}

function parseCodeReads(
  value: unknown,
  manifest: GearboxV3EthereumUSDCManifest,
  selectedBlockHash: string,
): readonly Readonly<Record<string, unknown>>[] {
  const expected = Object.freeze([
    frozen({
      role: 'ADDRESS_PROVIDER',
      address: manifest.contracts.addressProvider,
      hash: manifest.runtimeCodeSha256.addressProvider,
    }),
    frozen({
      role: 'CONTRACTS_REGISTER',
      address: manifest.contracts.contractsRegister,
      hash: manifest.runtimeCodeSha256.contractsRegister,
    }),
    frozen({
      role: 'POOL',
      address: manifest.contracts.pool,
      hash: manifest.runtimeCodeSha256.pool,
    }),
    frozen({
      role: 'UNDERLYING',
      address: manifest.contracts.underlying,
      hash: manifest.runtimeCodeSha256.underlying,
    }),
  ]);
  return Object.freeze(
    exactArray(value, expected.length).map((item, index) => {
      const record = exactRecord(item, CODE_READ_KEYS);
      const definition = expected[index];
      if (!definition) return unavailable();
      if (
        record.role !== definition.role ||
        address(record.address) !== definition.address ||
        evmHash(record.blockHash) !== selectedBlockHash ||
        record.requireCanonical !== true ||
        sha256(record.observedRuntimeCodeSha256) !== definition.hash
      ) {
        return unavailable();
      }
      return frozen({
        role: definition.role,
        address: definition.address,
        blockHash: selectedBlockHash,
        requireCanonical: true as const,
        observedRuntimeCodeSha256: definition.hash,
      });
    }),
  );
}

function parseRoot(
  value: unknown,
  manifest: GearboxV3EthereumUSDCManifest,
  approval: GearboxV3AccountPositionTranscriptApprovalV1,
  selectedBlockHash: string,
): Readonly<Record<string, unknown>> {
  const record = exactRecord(value, ROOT_KEYS);
  if (
    evmHash(record.blockHash) !== selectedBlockHash ||
    record.requireCanonical !== true ||
    address(record.contractsRegisterFromAddressProvider) !== manifest.contracts.contractsRegister ||
    address(record.accountFactoryFromAddressProvider) !== approval.root.accountFactoryAddress ||
    record.poolRegistered !== true ||
    address(record.poolAddressProvider) !== manifest.contracts.addressProvider ||
    address(record.poolUnderlying) !== manifest.contracts.underlying ||
    address(record.poolAsset) !== manifest.contracts.underlying ||
    record.poolVersion !== GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.supportedContractVersion ||
    record.poolDecimals !== GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.poolAndUnderlyingDecimals ||
    record.underlyingDecimals !==
      GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.poolAndUnderlyingDecimals ||
    address(record.poolQuotaKeeper) !== approval.root.poolQuotaKeeperAddress ||
    sha256(record.poolQuotaKeeperRuntimeCodeSha256) !==
      approval.root.poolQuotaKeeperRuntimeCodeSha256 ||
    address(record.poolQuotaKeeperPool) !== manifest.contracts.pool ||
    address(record.poolQuotaKeeperUnderlying) !== manifest.contracts.underlying ||
    record.poolQuotaKeeperVersion !==
      GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.supportedContractVersion ||
    sha256(record.accountFactoryRuntimeCodeSha256) !==
      approval.root.accountFactoryRuntimeCodeSha256 ||
    record.accountFactoryVersion !== GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.supportedContractVersion
  ) {
    return unavailable();
  }
  return frozen({
    blockHash: selectedBlockHash,
    requireCanonical: true as const,
    contractsRegisterFromAddressProvider: manifest.contracts.contractsRegister,
    accountFactoryFromAddressProvider: approval.root.accountFactoryAddress,
    poolRegistered: true as const,
    poolAddressProvider: manifest.contracts.addressProvider,
    poolUnderlying: manifest.contracts.underlying,
    poolAsset: manifest.contracts.underlying,
    poolVersion: GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.supportedContractVersion,
    poolDecimals: GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.poolAndUnderlyingDecimals,
    underlyingDecimals: GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.poolAndUnderlyingDecimals,
    poolQuotaKeeper: approval.root.poolQuotaKeeperAddress,
    poolQuotaKeeperRuntimeCodeSha256: approval.root.poolQuotaKeeperRuntimeCodeSha256,
    poolQuotaKeeperPool: manifest.contracts.pool,
    poolQuotaKeeperUnderlying: manifest.contracts.underlying,
    poolQuotaKeeperVersion: GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.supportedContractVersion,
    accountFactoryRuntimeCodeSha256: approval.root.accountFactoryRuntimeCodeSha256,
    accountFactoryVersion: GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.supportedContractVersion,
  });
}

function parseSupply(
  value: unknown,
  walletAddress: string,
  selectedBlockHash: string,
): GearboxV3DieselSupplyProjection {
  const record = exactRecord(value, SUPPLY_KEYS);
  if (
    evmHash(record.blockHash) !== selectedBlockHash ||
    record.requireCanonical !== true ||
    address(record.walletAddress) !== walletAddress
  ) {
    return unavailable();
  }
  return projectGearboxV3DieselSharesToUnderlyingDown(
    uint(record.sharesAtomic),
    uint(record.totalAssetsAtomic),
    uint(record.totalSupplyAtomic),
  );
}

interface ParsedAccountDebt {
  readonly borrowerAddress: string;
  readonly debt: GearboxV3CreditAccountDebtProjection;
}

function parseAccount(
  value: unknown,
  approvedAccount: GearboxV3AccountPositionTranscriptApprovalAccountV1,
  manager: GearboxV3AccountPositionTranscriptApprovalManagerV1,
  approval: GearboxV3AccountPositionTranscriptApprovalV1,
): ParsedAccountDebt {
  const record = exactRecord(value, ACCOUNT_KEYS);
  if (
    address(record.accountAddress) !== approvedAccount.accountAddress ||
    sha256(record.runtimeCodeSha256) !== approvedAccount.runtimeCodeSha256 ||
    address(record.creditManager) !== manager.managerAddress ||
    address(record.factory) !== approval.root.accountFactoryAddress ||
    record.version !== GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.supportedContractVersion
  ) {
    return unavailable();
  }
  const info = exactRecord(record.creditAccountInfo, ACCOUNT_INFO_KEYS);
  const debtOnly = exactRecord(record.debtOnly, DEBT_ONLY_KEYS);
  const infoDebt = uint(info.debtAtomic);
  const infoIndex = uint(info.cumulativeIndexLastUpdate);
  boundedUint(info.cumulativeQuotaInterest, MAX_UINT128);
  boundedUint(info.quotaFees, MAX_UINT128);
  const infoMask = uint(info.enabledTokensMask);
  boundedUint(info.flags, MAX_UINT16);
  boundedUint(info.lastDebtUpdate, MAX_UINT64);
  const borrowerAddress = address(info.borrowerAddress);
  const debtPrincipal = uint(debtOnly.debtAtomic);
  uint(debtOnly.cumulativeIndexNow);
  const debtIndex = uint(debtOnly.cumulativeIndexLastUpdate);
  boundedUint(debtOnly.cumulativeQuotaInterest, MAX_UINT128);
  const accruedInterest = uint(debtOnly.accruedInterestAtomic);
  const accruedFees = uint(debtOnly.accruedFeesAtomic);
  uint(debtOnly.totalDebtUsd);
  uint(debtOnly.totalValue);
  uint(debtOnly.totalValueUsd);
  uint(debtOnly.twvUsd);
  const debtMask = uint(debtOnly.enabledTokensMask);
  uint(debtOnly.quotedTokensMask);
  addressArray(debtOnly.quotedTokenAddresses, MAX_QUOTED_TOKENS);
  if (
    infoDebt !== debtPrincipal ||
    infoIndex !== debtIndex ||
    infoMask !== debtMask ||
    address(debtOnly.poolQuotaKeeper) !== approval.root.poolQuotaKeeperAddress
  ) {
    return unavailable();
  }
  return frozen({
    borrowerAddress,
    debt: projectGearboxV3CreditAccountDebt(debtPrincipal, accruedInterest, accruedFees),
  });
}

interface ParsedManagers {
  readonly walletDebts: readonly string[];
  readonly walletOwnedAccountCount: number;
  readonly totalAccountCount: number;
}

function parseManagers(
  value: unknown,
  approval: GearboxV3AccountPositionTranscriptApprovalV1,
  manifest: GearboxV3EthereumUSDCManifest,
  selectedBlockHash: string,
  walletAddress: string,
): ParsedManagers {
  const values = exactArray(value, MAX_MANAGERS);
  if (values.length !== approval.managers.length) return unavailable();
  const walletDebts: string[] = [];
  let totalAccountCount = 0;
  for (let managerIndex = 0; managerIndex < approval.managers.length; managerIndex += 1) {
    const approvedManager = approval.managers[managerIndex];
    if (!approvedManager) return unavailable();
    const record = exactRecord(values[managerIndex], MANAGER_KEYS);
    if (
      address(record.managerAddress) !== approvedManager.managerAddress ||
      evmHash(record.blockHash) !== selectedBlockHash ||
      record.requireCanonical !== true ||
      sha256(record.managerRuntimeCodeSha256) !== approvedManager.managerRuntimeCodeSha256 ||
      address(record.pool) !== manifest.contracts.pool ||
      address(record.underlying) !== manifest.contracts.underlying ||
      address(record.addressProvider) !== manifest.contracts.addressProvider ||
      address(record.accountFactory) !== approval.root.accountFactoryAddress ||
      address(record.creditFacade) !== approvedManager.facadeAddress ||
      address(record.poolQuotaKeeper) !== approval.root.poolQuotaKeeperAddress ||
      record.version !== GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.supportedContractVersion ||
      sha256(record.facadeRuntimeCodeSha256) !== approvedManager.facadeRuntimeCodeSha256 ||
      address(record.facadeCreditManager) !== approvedManager.managerAddress ||
      record.facadeVersion !== GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES.supportedContractVersion
    ) {
      return unavailable();
    }
    const beforeLength = boundedCount(record.creditAccountsLengthBefore, MAX_ACCOUNTS);
    const afterLength = boundedCount(record.creditAccountsLengthAfter, MAX_ACCOUNTS);
    if (beforeLength !== approvedManager.creditAccounts.length || afterLength !== beforeLength) {
      return unavailable();
    }
    totalAccountCount += beforeLength;
    if (totalAccountCount > MAX_ACCOUNTS) return unavailable();
    const pageValues = exactArray(record.pages, Math.ceil(beforeLength / PAGE_SIZE));
    if (pageValues.length !== Math.ceil(beforeLength / PAGE_SIZE)) return unavailable();
    const pagedAddresses: string[] = [];
    for (let pageIndex = 0; pageIndex < pageValues.length; pageIndex += 1) {
      const page = exactRecord(pageValues[pageIndex], PAGE_KEYS);
      const expectedOffset = pageIndex * PAGE_SIZE;
      const expectedLimit = Math.min(PAGE_SIZE, beforeLength - expectedOffset);
      if (
        boundedCount(page.offset, MAX_ACCOUNTS) !== expectedOffset ||
        boundedCount(page.limit, PAGE_SIZE) !== expectedLimit
      ) {
        return unavailable();
      }
      const pageAddresses = addressArray(page.accountAddresses, expectedLimit);
      if (pageAddresses.length !== expectedLimit) return unavailable();
      pagedAddresses.push(...pageAddresses);
    }
    const expectedAddresses = approvedManager.creditAccounts.map(
      (account) => account.accountAddress,
    );
    if (!sameStrings(pagedAddresses, expectedAddresses)) return unavailable();
    const accountValues = exactArray(record.accounts, beforeLength);
    if (accountValues.length !== beforeLength) return unavailable();
    for (let accountIndex = 0; accountIndex < beforeLength; accountIndex += 1) {
      const approvedAccount = approvedManager.creditAccounts[accountIndex];
      if (!approvedAccount) return unavailable();
      const parsed = parseAccount(
        accountValues[accountIndex],
        approvedAccount,
        approvedManager,
        approval,
      );
      if (parsed.borrowerAddress === walletAddress) walletDebts.push(parsed.debt.debtAtomic);
    }
  }
  return frozen({
    walletDebts: Object.freeze(walletDebts),
    walletOwnedAccountCount: walletDebts.length,
    totalAccountCount,
  });
}

export interface DormantGearboxV3AccountPositionTranscriptResultV1 {
  readonly transcriptVersion: typeof GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_VERSION;
  readonly use: typeof GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_USE;
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly maySign: false;
  readonly mayAccessWalletPrivateKey: false;
  readonly mayEstablishCompletePosition: false;
  readonly transcriptCoverageStatus: 'COMPLETE_TRANSCRIPT_NOT_AUTHENTICATED';
  readonly completenessStatus: 'NOT_ESTABLISHED_PENDING_INDEPENDENT_AUTHENTICITY';
  readonly providerId: 'gearbox';
  readonly protocolId: 'gearbox-v3';
  readonly networkId: 'eip155:1';
  readonly marketId: 'gearbox-v3-ethereum-usdc';
  readonly walletAddress: string;
  readonly evaluatedAt: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly managerCount: string;
  readonly creditAccountCount: string;
  readonly walletOwnedCreditAccountCount: string;
  readonly suppliedUnderlyingAtomicFloor: string;
  readonly borrowedUnderlyingAtomic: string;
  readonly supplyProjection: GearboxV3DieselSupplyProjection;
  readonly manifestFingerprintSha256: string;
  readonly semanticsFingerprintSha256: string;
  readonly approvalFingerprintSha256: string;
  readonly transcriptFingerprintSha256: string;
}

/**
 * Pure evaluator for a caller-supplied, already decoded Gearbox position
 * transcript. It owns no endpoint, transport, timer, signer, database, or
 * runtime registration. Exact approval fingerprints detect substitution only;
 * they do not authenticate the caller, the chain, or an RPC response.
 */
export class DormantGearboxV3AccountPositionTranscriptEvaluator {
  readonly #manifest!: GearboxV3EthereumUSDCManifest;
  readonly #manifestFingerprintSha256!: string;
  readonly #approval!: GearboxV3AccountPositionTranscriptApprovalV1;
  readonly #approvalFingerprintSha256!: string;

  constructor(
    manifestValue: unknown,
    requiredManifestFingerprintSha256: unknown,
    requiredSemanticsFingerprintSha256: unknown,
    approvalValue: unknown,
    requiredApprovalFingerprintSha256: unknown,
  ) {
    try {
      const manifestRecord = exactRecord(manifestValue, MANIFEST_KEYS);
      assertBoundedPlainData(manifestRecord);
      this.#manifest = parseGearboxV3EthereumUSDCManifest(manifestRecord);
      this.#manifestFingerprintSha256 = gearboxV3ManifestFingerprintSha256(this.#manifest);
      this.#approval = parseApproval(approvalValue);
      this.#approvalFingerprintSha256 = gearboxV3AccountPositionTranscriptApprovalFingerprintSha256(
        this.#approval,
      );
      if (
        sha256(requiredManifestFingerprintSha256) !== this.#manifestFingerprintSha256 ||
        requiredSemanticsFingerprintSha256 !==
          GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256 ||
        sha256(requiredApprovalFingerprintSha256) !== this.#approvalFingerprintSha256 ||
        this.#approval.manifestFingerprintSha256 !== this.#manifestFingerprintSha256 ||
        this.#approval.semanticsFingerprintSha256 !==
          GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256
      ) {
        return unavailable();
      }
      Object.freeze(this);
    } catch (error) {
      if (error instanceof GearboxV3AccountPositionTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  evaluate(transcriptValue: unknown): DormantGearboxV3AccountPositionTranscriptResultV1 {
    try {
      const record = exactRecord(transcriptValue, TRANSCRIPT_KEYS);
      assertBoundedPlainData(record);
      if (
        record.transcriptVersion !== GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_VERSION ||
        record.use !== GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_USE
      ) {
        return unavailable();
      }
      booleanFalse(record.mayEstablishRecommendationEligibility);
      booleanFalse(record.mayAuthorizeFinancialAction);
      booleanFalse(record.mayPersist);
      booleanFalse(record.mayCreatePositionSnapshot);
      booleanFalse(record.maySign);
      booleanFalse(record.mayAccessWalletPrivateKey);
      if (
        sha256(record.manifestFingerprintSha256) !== this.#manifestFingerprintSha256 ||
        sha256(record.semanticsFingerprintSha256) !==
          GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256 ||
        sha256(record.approvalFingerprintSha256) !== this.#approvalFingerprintSha256 ||
        record.chainIdBefore !== this.#manifest.expectedChainId ||
        record.chainIdAfter !== this.#manifest.expectedChainId ||
        record.blockSelector !== this.#manifest.blockSelector ||
        record.blockBinding !== this.#manifest.blockBinding
      ) {
        return unavailable();
      }
      const walletAddress = address(record.walletAddress);
      const evaluatedAt = canonicalTimestamp(record.evaluatedAt);
      const selectedBlock = parseBlock(record.selectedBlock);
      const closeoutBlock = parseBlock(record.closeoutBlock);
      if (!sameBlock(selectedBlock, closeoutBlock)) return unavailable();
      const selectedNumber = BigInt(selectedBlock.number);
      const selectedTimeMilliseconds = BigInt(selectedBlock.timestamp) * 1_000n;
      const maximumAgeMilliseconds = BigInt(this.#manifest.maximumBlockAgeSeconds) * 1_000n;
      if (
        selectedNumber === 0n ||
        selectedTimeMilliseconds > evaluatedAt.milliseconds ||
        evaluatedAt.milliseconds - selectedTimeMilliseconds >= maximumAgeMilliseconds
      ) {
        return unavailable();
      }
      const floor = exactRecord(record.continuityFloor, CONTINUITY_KEYS);
      if (floor.kind !== 'EVM_BLOCK') return unavailable();
      const floorNumber = BigInt(uint(floor.blockNumber));
      const floorHash = evmHash(floor.blockHash);
      if (
        selectedNumber < floorNumber ||
        (selectedNumber === floorNumber && selectedBlock.hash !== floorHash)
      ) {
        return unavailable();
      }
      parseCodeReads(record.staticCodeReads, this.#manifest, selectedBlock.hash);
      parseRoot(record.root, this.#manifest, this.#approval, selectedBlock.hash);
      const approvedManagers = this.#approval.managers.map((manager) => manager.managerAddress);
      const managersBefore = addressArray(record.managerAddressesBefore, MAX_MANAGERS);
      const managersAfter = addressArray(record.managerAddressesAfter, MAX_MANAGERS);
      if (
        !sameStrings(managersBefore, approvedManagers) ||
        !sameStrings(managersAfter, approvedManagers)
      ) {
        return unavailable();
      }
      const supplyProjection = parseSupply(record.supply, walletAddress, selectedBlock.hash);
      const managers = parseManagers(
        record.managers,
        this.#approval,
        this.#manifest,
        selectedBlock.hash,
        walletAddress,
      );
      const expectedExecutionOrder = executionOrder(this.#approval);
      const suppliedExecutionOrder = stringArray(
        record.executionOrder,
        expectedExecutionOrder.length,
      );
      if (!sameStrings(suppliedExecutionOrder, expectedExecutionOrder)) return unavailable();
      const debt = aggregateGearboxV3CreditAccountDebtAtomic(managers.walletDebts);
      return frozen({
        transcriptVersion: GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_VERSION,
        use: GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_USE,
        mayEstablishRecommendationEligibility: false as const,
        mayAuthorizeFinancialAction: false as const,
        mayPersist: false as const,
        mayCreatePositionSnapshot: false as const,
        maySign: false as const,
        mayAccessWalletPrivateKey: false as const,
        mayEstablishCompletePosition: false as const,
        transcriptCoverageStatus: 'COMPLETE_TRANSCRIPT_NOT_AUTHENTICATED' as const,
        completenessStatus: 'NOT_ESTABLISHED_PENDING_INDEPENDENT_AUTHENTICITY' as const,
        providerId: this.#manifest.providerId,
        protocolId: this.#manifest.protocolId,
        networkId: this.#manifest.networkId,
        marketId: this.#manifest.marketId,
        walletAddress,
        evaluatedAt: evaluatedAt.value,
        blockNumber: selectedBlock.number,
        blockHash: selectedBlock.hash,
        managerCount: this.#approval.managers.length.toString(10),
        creditAccountCount: managers.totalAccountCount.toString(10),
        walletOwnedCreditAccountCount: managers.walletOwnedAccountCount.toString(10),
        suppliedUnderlyingAtomicFloor: supplyProjection.suppliedUnderlyingAtomic,
        borrowedUnderlyingAtomic: debt.debtAtomic,
        supplyProjection,
        manifestFingerprintSha256: this.#manifestFingerprintSha256,
        semanticsFingerprintSha256: GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
        approvalFingerprintSha256: this.#approvalFingerprintSha256,
        transcriptFingerprintSha256: hashCanonical(
          'crypto-lending:gearbox-v3-account-position-transcript:v1\0',
          record,
        ),
      });
    } catch (error) {
      if (error instanceof GearboxV3AccountPositionTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }
}
