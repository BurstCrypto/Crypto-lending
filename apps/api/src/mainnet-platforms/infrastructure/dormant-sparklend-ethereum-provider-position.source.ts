import { Buffer } from 'node:buffer';
import { isProxy } from 'node:util/types';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import {
  parseSparkLendEthereumUSDCManifest,
  sparkLendManifestFingerprintSha256,
  type SparkLendEthereumUSDCManifest,
} from '../../smart-lending/infrastructure/spark/sparklend-ethereum-usdc.manifest';
import {
  PROVIDER_POSITION_ADMISSION_SOURCE_USE,
  PROVIDER_POSITION_ADMISSION_VERSION,
  type ProviderPositionAdmissionAssetV1,
  type ProviderPositionAdmissionEvmAnchorV1,
  type ProviderPositionAdmissionPositionV1,
  type ProviderPositionAdmissionSourceEvidenceV1,
  type ProviderPositionAdmissionSourcePort,
  type ReadProviderPositionAdmissionTargetRequestV1,
} from '../application/provider-position-admission.coordinator';
import { mainnetProviderPositionDecimalFromAtomic } from '../domain/mainnet-provider-position-observation';

export const SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION = 1 as const;
export const SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE =
  'DORMANT_SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_ONLY' as const;
export const SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION = 1 as const;
export const SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE =
  'DORMANT_SPARKLEND_ETHEREUM_FINALIZED_POSITION_RPC_TRANSCRIPT_ONLY' as const;

const NETWORK_ID = 'eip155:1' as const;
const EXPECTED_CHAIN_ID = '0x1' as const;
const BLOCK_SELECTOR = 'finalized' as const;
const BLOCK_BINDING = 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const;
const GET_RESERVE_TOKENS_ADDRESSES_SELECTOR = '0xd2493b6c' as const;
const BALANCE_OF_SELECTOR = '0x70a08231' as const;
const IMPLEMENTATION_SELECTOR = '0x5c60da1b' as const;
const POOL_SELECTOR = '0x7535d246' as const;
const UNDERLYING_ASSET_SELECTOR = '0xb16a19de' as const;
const DECIMALS_SELECTOR = '0x313ce567' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const MAX_CONTEXT_BYTES = 8 * 1024;
const MAX_TRANSCRIPT_BYTES = 96 * 1024;
const MAX_DATA_NODES = 512;
const MAX_STRING_BYTES = 8 * 1024;
const MAX_TOKEN_PROOFS = 3 as const;
const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const SAFE_SOURCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const ABI_UINT256 = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const MAX_UINT256 = (1n << 256n) - 1n;

type FailureCode =
  | 'SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION'
  | 'SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST'
  | 'SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE';

type TokenRole = 'SUPPLY' | 'VARIABLE_BORROW' | 'STABLE_BORROW';

export interface ReadSparkLendEthereumDurableTargetContextRequestV1 {
  readonly contextVersion: typeof SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly accountId: ReadProviderPositionAdmissionTargetRequestV1['accountId'];
  readonly correlationId: string;
  readonly walletId: string;
  readonly networkId: typeof NETWORK_ID;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}

export interface SparkLendEthereumDurableTargetContextV1 {
  readonly contextVersion: typeof SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly accountId: ReadProviderPositionAdmissionTargetRequestV1['accountId'];
  readonly correlationId: string;
  readonly walletId: string;
  readonly networkId: typeof NETWORK_ID;
  readonly contextSourceFamilyId: string;
  readonly contextSourceId: string;
  readonly walletAddress: string;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
  readonly resolvedAt: string;
}

/**
 * Authenticated durable lookup for the exact active wallet address and the
 * independently retained chain-continuity floor. Implementations must issue
 * an immutable null-prototype capability bound to the exact request object.
 */
export interface SparkLendEthereumDurableTargetContextReaderPort {
  readonly contextVersion: typeof SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readContext(request: ReadSparkLendEthereumDurableTargetContextRequestV1): Promise<unknown>;
  verifyContext(
    capability: unknown,
    request: ReadSparkLendEthereumDurableTargetContextRequestV1,
  ): boolean;
}

export interface SparkLendEthereumReserveTokenReadV1 {
  readonly method: 'eth_call';
  readonly to: string;
  readonly callData: string;
}

export interface ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1 {
  readonly transcriptVersion: typeof SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly use: typeof SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly accountId: ReadProviderPositionAdmissionTargetRequestV1['accountId'];
  readonly correlationId: string;
  readonly walletId: string;
  readonly walletAddress: string;
  readonly providerId: 'spark';
  readonly protocolId: 'sparklend';
  readonly marketId: 'sparklend-ethereum-usdc';
  readonly networkId: typeof NETWORK_ID;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly expectedChainId: typeof EXPECTED_CHAIN_ID;
  readonly blockSelector: typeof BLOCK_SELECTOR;
  readonly blockBinding: typeof BLOCK_BINDING;
  readonly manifestFingerprintSha256: string;
  readonly manifest: SparkLendEthereumUSDCManifest;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
  readonly asset: ProviderPositionAdmissionAssetV1;
  readonly reserveTokenRead: SparkLendEthereumReserveTokenReadV1;
  readonly walletBalanceCallData: string;
  readonly maximumTokenProofs: typeof MAX_TOKEN_PROOFS;
  readonly maximumResponseBytes: typeof MAX_TRANSCRIPT_BYTES;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly durableContext: unknown;
}

/**
 * Endpoint-free boundary for one exact, read-only finalized Ethereum
 * transcript. A binding must discover the reserve-token tuple, code-check and
 * relationship-check every discovered token, read every wallet balance at the
 * same canonical EIP-1898 block hash, and drain before settling after abort.
 * Debt-token identities remain explicitly unapproved until separately pinned.
 */
export interface SparkLendEthereumFinalizedPositionTranscriptPort {
  readonly transcriptVersion: typeof SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readTranscript(
    request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  ): Promise<unknown>;
  verifyTranscript(
    capability: unknown,
    request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  ): boolean;
}

export interface SparkLendEthereumProviderPositionSourceClock {
  now(): Date;
}

export class DormantSparkLendEthereumProviderPositionSourceError extends Error {
  constructor(readonly code: FailureCode) {
    super('SparkLend Ethereum provider-position source is unavailable.');
    this.name = 'DormantSparkLendEthereumProviderPositionSourceError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

interface CapturedContextReader {
  readonly receiver: object;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly read: (request: ReadSparkLendEthereumDurableTargetContextRequestV1) => Promise<unknown>;
  readonly verify: (
    capability: unknown,
    request: ReadSparkLendEthereumDurableTargetContextRequestV1,
  ) => boolean;
}

interface CapturedTranscriptReader {
  readonly receiver: object;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly read: (
    request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  ) => Promise<unknown>;
  readonly verify: (
    capability: unknown,
    request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  ) => boolean;
}

interface ReviewedRequest {
  readonly accountId: ReadProviderPositionAdmissionTargetRequestV1['accountId'];
  readonly correlationId: string;
  readonly walletId: string;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly deadlineAt: string;
  readonly deadlineAtMilliseconds: number;
  readonly signal: AbortSignal;
  readonly asset: ProviderPositionAdmissionAssetV1;
}

interface ReviewedContext {
  readonly capability: unknown;
  readonly walletAddress: string;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
  readonly resolvedAtMilliseconds: number;
}

interface CanonicalTime {
  readonly timestamp: string;
  readonly milliseconds: number;
}

interface ReviewedBlock {
  readonly number: string;
  readonly hash: string;
  readonly timestampSeconds: string;
}

interface ReserveTokens {
  readonly supply: string;
  readonly stableDebt: string;
  readonly variableDebt: string;
}

interface ReviewedTranscript {
  readonly block: ReviewedBlock;
  readonly observedAt: CanonicalTime;
  readonly staleAfter: CanonicalTime;
  readonly supplyAtomic: string;
  readonly borrowAtomic: string;
}

function fail(code: FailureCode): never {
  throw new DormantSparkLendEthereumProviderPositionSourceError(code);
}

function stableDataMember(value: unknown, key: PropertyKey): unknown {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return undefined;
    }
    let current: object | null = value as object;
    while (current !== null) {
      if (isProxy(current)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) return 'value' in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: FailureCode = 'SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return fail(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof DormantSparkLendEthereumProviderPositionSourceError) throw error;
    return fail(code);
  }
}

function dataArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
  const length = descriptors['length'];
  if (
    !length ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    length.value > maximum ||
    length.enumerable !== false
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const indexes = Array.from({ length: length.value }, (_, index) => String(index));
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== indexes.length + 1 ||
    keys.some((key) => typeof key !== 'string' || (key !== 'length' && !indexes.includes(key)))
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return indexes.map((index) => {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    return descriptor.value;
  });
}

function assertBoundedImmutableCapability(value: unknown, maximumBytes: number): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== null ||
    !Object.isFrozen(value)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const active = new Set<object>();
  let nodes = 0;
  const visit = (candidate: unknown): void => {
    nodes += 1;
    if (nodes > MAX_DATA_NODES) return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    if (typeof candidate === 'string') {
      if (Buffer.byteLength(candidate, 'utf8') > MAX_STRING_BYTES) {
        return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      return;
    }
    if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'number') {
      return;
    }
    if (typeof candidate !== 'object' || isProxy(candidate) || active.has(candidate)) {
      return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (
      !Object.isFrozen(candidate) ||
      (Array.isArray(candidate)
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null)
    ) {
      return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    active.add(candidate);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) {
        return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      if (key !== 'length') visit(descriptor.value);
    }
    active.delete(candidate);
  };
  visit(value);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maximumBytes) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function canonicalTime(value: unknown): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({ timestamp: value, milliseconds });
}

function clockTime(now: () => Date): CanonicalTime {
  let value: Date;
  try {
    value = now();
  } catch {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return canonicalTime(value.toISOString());
}

function capturedClock(value: unknown): () => Date {
  const now = stableDataMember(value, 'now');
  if (typeof now !== 'function' || isProxy(now)) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return () => Reflect.apply(now, value, []) as Date;
}

function sourceIdentity(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_SOURCE_ID.test(value)) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value;
}

function capturedContextReader(value: unknown): CapturedContextReader {
  if (typeof value !== 'object' || value === null || isProxy(value)) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const contextVersion = stableDataMember(value, 'contextVersion');
  const sourceFamilyId = sourceIdentity(stableDataMember(value, 'sourceFamilyId'));
  const sourceId = sourceIdentity(stableDataMember(value, 'sourceId'));
  const read = stableDataMember(value, 'readContext');
  const verify = stableDataMember(value, 'verifyContext');
  if (
    contextVersion !== SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION ||
    typeof read !== 'function' ||
    isProxy(read) ||
    typeof verify !== 'function' ||
    isProxy(verify)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver: value,
    sourceFamilyId,
    sourceId,
    read: (request: ReadSparkLendEthereumDurableTargetContextRequestV1) =>
      Reflect.apply(read, value, [request]) as Promise<unknown>,
    verify: (capability: unknown, request: ReadSparkLendEthereumDurableTargetContextRequestV1) =>
      Reflect.apply(verify, value, [capability, request]) as boolean,
  });
}

function capturedTranscriptReader(value: unknown): CapturedTranscriptReader {
  if (typeof value !== 'object' || value === null || isProxy(value)) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const transcriptVersion = stableDataMember(value, 'transcriptVersion');
  const sourceFamilyId = sourceIdentity(stableDataMember(value, 'sourceFamilyId'));
  const sourceId = sourceIdentity(stableDataMember(value, 'sourceId'));
  const read = stableDataMember(value, 'readTranscript');
  const verify = stableDataMember(value, 'verifyTranscript');
  if (
    transcriptVersion !== SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION ||
    typeof read !== 'function' ||
    isProxy(read) ||
    typeof verify !== 'function' ||
    isProxy(verify)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver: value,
    sourceFamilyId,
    sourceId,
    read: (request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1) =>
      Reflect.apply(read, value, [request]) as Promise<unknown>,
    verify: (
      capability: unknown,
      request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
    ) => Reflect.apply(verify, value, [capability, request]) as boolean,
  });
}

function manifestConfiguration(
  input: unknown,
  requiredFingerprint: unknown,
): Readonly<{ manifest: SparkLendEthereumUSDCManifest; fingerprint: string }> {
  try {
    const manifest = parseSparkLendEthereumUSDCManifest(input);
    const fingerprint = sparkLendManifestFingerprintSha256(manifest);
    if (
      typeof requiredFingerprint !== 'string' ||
      !SHA256.test(requiredFingerprint) ||
      fingerprint !== requiredFingerprint
    ) {
      return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
    }
    return Object.freeze({ manifest, fingerprint });
  } catch (error) {
    if (error instanceof DormantSparkLendEthereumProviderPositionSourceError) throw error;
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
}

function canonicalAsset(
  value: unknown,
  manifest: SparkLendEthereumUSDCManifest,
): ProviderPositionAdmissionAssetV1 {
  const record = exactDataRecord(
    value,
    ['stablecoin', 'networkId', 'identity', 'decimals'],
    'SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
  );
  if (
    record.stablecoin !== 'USDC' ||
    record.networkId !== manifest.networkId ||
    record.identity !== manifest.contracts.usdc ||
    record.decimals !== manifest.asset.decimals
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  return Object.freeze({
    stablecoin: 'USDC',
    networkId: NETWORK_ID,
    identity: manifest.contracts.usdc,
    decimals: 6,
  });
}

function reviewedRequest(
  value: unknown,
  now: CanonicalTime,
  manifest: SparkLendEthereumUSDCManifest,
): ReviewedRequest {
  const record = exactDataRecord(
    value,
    [
      'admissionVersion',
      'accountId',
      'correlationId',
      'deadlineAt',
      'signal',
      'sourceFamilyId',
      'sourceId',
      'sourceKind',
      'walletId',
      'providerId',
      'protocolId',
      'marketId',
      'networkId',
      'assets',
    ],
    'SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
  );
  let accountId: ReadProviderPositionAdmissionTargetRequestV1['accountId'];
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  let deadline: CanonicalTime;
  try {
    deadline = canonicalTime(record.deadlineAt);
  } catch {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  if (
    record.admissionVersion !== PROVIDER_POSITION_ADMISSION_VERSION ||
    typeof record.correlationId !== 'string' ||
    !CORRELATION_ID.test(record.correlationId) ||
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    typeof record.sourceFamilyId !== 'string' ||
    !SAFE_SOURCE_ID.test(record.sourceFamilyId) ||
    typeof record.sourceId !== 'string' ||
    !SAFE_SOURCE_ID.test(record.sourceId) ||
    record.sourceKind !== 'RPC' ||
    record.providerId !== manifest.providerId ||
    record.protocolId !== manifest.protocolId ||
    record.marketId !== manifest.marketId ||
    record.networkId !== manifest.networkId ||
    !(record.signal instanceof AbortSignal) ||
    isProxy(record.signal) ||
    record.signal.aborted ||
    deadline.milliseconds <= now.milliseconds ||
    deadline.milliseconds - now.milliseconds > MAX_DEADLINE_MILLISECONDS
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  let assetValues: readonly unknown[];
  try {
    assetValues = dataArray(record.assets, 1);
  } catch {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  if (assetValues.length !== 1) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  const asset = canonicalAsset(assetValues[0], manifest);
  return Object.freeze({
    accountId,
    correlationId: record.correlationId,
    walletId: record.walletId,
    sourceFamilyId: record.sourceFamilyId,
    sourceId: record.sourceId,
    deadlineAt: deadline.timestamp,
    deadlineAtMilliseconds: deadline.milliseconds,
    signal: record.signal,
    asset,
  });
}

function contextRequest(
  request: ReviewedRequest,
): ReadSparkLendEthereumDurableTargetContextRequestV1 {
  return Object.freeze({
    contextVersion: SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    accountId: request.accountId,
    correlationId: request.correlationId,
    walletId: request.walletId,
    networkId: NETWORK_ID,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    deadlineAt: request.deadlineAt,
    signal: request.signal,
  });
}

function verifyContext(
  reader: CapturedContextReader,
  capability: unknown,
  request: ReadSparkLendEthereumDurableTargetContextRequestV1,
): void {
  try {
    if (reader.verify(capability, request) !== true) {
      return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
  } catch (error) {
    if (error instanceof DormantSparkLendEthereumProviderPositionSourceError) throw error;
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function evmAnchor(value: unknown): ProviderPositionAdmissionEvmAnchorV1 {
  const record = exactDataRecord(value, ['kind', 'blockNumber', 'blockHash']);
  if (
    record.kind !== 'EVM_BLOCK' ||
    typeof record.blockNumber !== 'string' ||
    !UNSIGNED_INTEGER.test(record.blockNumber) ||
    BigInt(record.blockNumber) > MAX_UINT256 ||
    typeof record.blockHash !== 'string' ||
    !EVM_BLOCK_HASH.test(record.blockHash) ||
    /^0x0{64}$/u.test(record.blockHash)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    kind: 'EVM_BLOCK',
    blockNumber: record.blockNumber,
    blockHash: record.blockHash,
  });
}

function reviewedContext(
  capability: unknown,
  request: ReviewedRequest,
  reader: CapturedContextReader,
  issuedRequest: ReadSparkLendEthereumDurableTargetContextRequestV1,
  settledAt: CanonicalTime,
  startedAt: CanonicalTime,
): ReviewedContext {
  verifyContext(reader, capability, issuedRequest);
  assertBoundedImmutableCapability(capability, MAX_CONTEXT_BYTES);
  const record = exactDataRecord(capability, [
    'contextVersion',
    'use',
    'mayAuthorizeFinancialAction',
    'mayPersist',
    'mayCreatePositionSnapshot',
    'accountId',
    'correlationId',
    'walletId',
    'networkId',
    'contextSourceFamilyId',
    'contextSourceId',
    'walletAddress',
    'continuityFloor',
    'resolvedAt',
  ]);
  const resolvedAt = canonicalTime(record.resolvedAt);
  if (
    record.contextVersion !== SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION ||
    record.use !== SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.mayCreatePositionSnapshot !== false ||
    record.accountId !== request.accountId ||
    record.correlationId !== request.correlationId ||
    record.walletId !== request.walletId ||
    record.networkId !== NETWORK_ID ||
    record.contextSourceFamilyId !== reader.sourceFamilyId ||
    record.contextSourceId !== reader.sourceId ||
    typeof record.walletAddress !== 'string' ||
    !EVM_ADDRESS.test(record.walletAddress) ||
    record.walletAddress === ZERO_ADDRESS ||
    resolvedAt.milliseconds < startedAt.milliseconds ||
    resolvedAt.milliseconds > settledAt.milliseconds
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    capability,
    walletAddress: record.walletAddress,
    continuityFloor: evmAnchor(record.continuityFloor),
    resolvedAtMilliseconds: resolvedAt.milliseconds,
  });
}

function addressArgument(address: string): string {
  return `${'0'.repeat(24)}${address.slice(2)}`;
}

function reserveTokenCallData(assetAddress: string): string {
  return `${GET_RESERVE_TOKENS_ADDRESSES_SELECTOR}${addressArgument(assetAddress)}`;
}

function balanceCallData(walletAddress: string): string {
  return `${BALANCE_OF_SELECTOR}${addressArgument(walletAddress)}`;
}

function transcriptRequest(
  request: ReviewedRequest,
  context: ReviewedContext,
  configuration: Readonly<{ manifest: SparkLendEthereumUSDCManifest; fingerprint: string }>,
): ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1 {
  return Object.freeze({
    transcriptVersion: SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    accountId: request.accountId,
    correlationId: request.correlationId,
    walletId: request.walletId,
    walletAddress: context.walletAddress,
    providerId: configuration.manifest.providerId,
    protocolId: configuration.manifest.protocolId,
    marketId: configuration.manifest.marketId,
    networkId: NETWORK_ID,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    expectedChainId: EXPECTED_CHAIN_ID,
    blockSelector: BLOCK_SELECTOR,
    blockBinding: BLOCK_BINDING,
    manifestFingerprintSha256: configuration.fingerprint,
    manifest: configuration.manifest,
    continuityFloor: context.continuityFloor,
    asset: request.asset,
    reserveTokenRead: Object.freeze({
      method: 'eth_call',
      to: configuration.manifest.contracts.dataProvider,
      callData: reserveTokenCallData(configuration.manifest.contracts.usdc),
    }),
    walletBalanceCallData: balanceCallData(context.walletAddress),
    maximumTokenProofs: MAX_TOKEN_PROOFS,
    maximumResponseBytes: MAX_TRANSCRIPT_BYTES,
    deadlineAt: request.deadlineAt,
    signal: request.signal,
    durableContext: context.capability,
  });
}

function hexQuantity(value: unknown): string {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  return parsed.toString(10);
}

function reviewedBlock(value: unknown): ReviewedBlock {
  const record = exactDataRecord(value, ['number', 'hash', 'timestamp']);
  if (
    typeof record.hash !== 'string' ||
    !EVM_BLOCK_HASH.test(record.hash) ||
    /^0x0{64}$/u.test(record.hash)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    number: hexQuantity(record.number),
    hash: record.hash,
    timestampSeconds: hexQuantity(record.timestamp),
  });
}

function sameBlock(left: ReviewedBlock, right: ReviewedBlock): boolean {
  return (
    left.number === right.number &&
    left.hash === right.hash &&
    left.timestampSeconds === right.timestampSeconds
  );
}

function assertNonRegressing(
  floor: ProviderPositionAdmissionEvmAnchorV1,
  block: ReviewedBlock,
): void {
  const floorNumber = BigInt(floor.blockNumber);
  const blockNumber = BigInt(block.number);
  if (
    blockNumber < floorNumber ||
    (blockNumber === floorNumber && block.hash !== floor.blockHash)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function blockParameter(value: unknown, block: ReviewedBlock): void {
  const record = exactDataRecord(value, ['blockHash', 'requireCanonical']);
  if (record.blockHash !== block.hash || record.requireCanonical !== true) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function abiAddressWord(value: unknown, allowZero: boolean): string {
  if (
    typeof value !== 'string' ||
    !ABI_UINT256.test(value) ||
    value.slice(2, 26) !== '0'.repeat(24)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const address = `0x${value.slice(26)}`;
  if (!allowZero && address === ZERO_ADDRESS) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return address;
}

function reserveTokens(value: unknown): ReserveTokens {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{192}$/u.test(value)) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const supply = abiAddressWord(`0x${value.slice(2, 66)}`, false);
  const stableDebt = abiAddressWord(`0x${value.slice(66, 130)}`, true);
  const variableDebt = abiAddressWord(`0x${value.slice(130, 194)}`, false);
  const nonzero = [supply, variableDebt, ...(stableDebt === ZERO_ADDRESS ? [] : [stableDebt])];
  if (new Set(nonzero).size !== nonzero.length) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({ supply, stableDebt, variableDebt });
}

function reviewedReserveTokens(
  value: unknown,
  request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  block: ReviewedBlock,
): ReserveTokens {
  const record = exactDataRecord(value, ['method', 'to', 'callData', 'blockParameter', 'result']);
  blockParameter(record.blockParameter, block);
  if (
    record.method !== request.reserveTokenRead.method ||
    record.to !== request.reserveTokenRead.to ||
    record.callData !== request.reserveTokenRead.callData
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const tokens = reserveTokens(record.result);
  if (tokens.supply !== request.manifest.contracts.spToken) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const forbiddenDebtAddresses = new Set<string>(Object.values(request.manifest.contracts));
  if (
    forbiddenDebtAddresses.has(tokens.variableDebt) ||
    (tokens.stableDebt !== ZERO_ADDRESS && forbiddenDebtAddresses.has(tokens.stableDebt))
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return tokens;
}

function codeRead(
  value: unknown,
  expectedAddress: string,
  expectedHash: string | undefined,
  block: ReviewedBlock,
): string {
  const record = exactDataRecord(value, ['method', 'address', 'blockParameter', 'resultSha256']);
  blockParameter(record.blockParameter, block);
  if (
    record.method !== 'eth_getCode' ||
    record.address !== expectedAddress ||
    typeof record.resultSha256 !== 'string' ||
    !SHA256.test(record.resultSha256) ||
    record.resultSha256 === '0'.repeat(64) ||
    (expectedHash !== undefined && record.resultSha256 !== expectedHash)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return record.resultSha256;
}

function plainCall(
  value: unknown,
  expectedTo: string,
  expectedCallData: string,
  expectedResultAddress: string | undefined,
  block: ReviewedBlock,
): string {
  const record = exactDataRecord(value, ['method', 'to', 'callData', 'blockParameter', 'result']);
  blockParameter(record.blockParameter, block);
  const result = abiAddressWord(record.result, expectedResultAddress === ZERO_ADDRESS);
  if (
    record.method !== 'eth_call' ||
    record.to !== expectedTo ||
    record.callData !== expectedCallData ||
    (expectedResultAddress !== undefined && result !== expectedResultAddress)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return result;
}

function implementationCall(
  value: unknown,
  tokenAddress: string,
  configuratorAddress: string,
  block: ReviewedBlock,
): string {
  const record = exactDataRecord(value, [
    'method',
    'to',
    'from',
    'callData',
    'blockParameter',
    'result',
  ]);
  blockParameter(record.blockParameter, block);
  if (
    record.method !== 'eth_call' ||
    record.to !== tokenAddress ||
    record.from !== configuratorAddress ||
    record.callData !== IMPLEMENTATION_SELECTOR
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return abiAddressWord(record.result, false);
}

function uintCall(
  value: unknown,
  tokenAddress: string,
  callData: string,
  block: ReviewedBlock,
): string {
  const record = exactDataRecord(value, ['method', 'to', 'callData', 'blockParameter', 'result']);
  blockParameter(record.blockParameter, block);
  if (
    record.method !== 'eth_call' ||
    record.to !== tokenAddress ||
    record.callData !== callData ||
    typeof record.result !== 'string' ||
    !ABI_UINT256.test(record.result)
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return BigInt(record.result).toString(10);
}

function expectedRoleAddress(role: TokenRole, tokens: ReserveTokens): string {
  if (role === 'SUPPLY') return tokens.supply;
  if (role === 'VARIABLE_BORROW') return tokens.variableDebt;
  return tokens.stableDebt;
}

function reviewedTokenProof(
  value: unknown,
  expectedRole: TokenRole,
  tokens: ReserveTokens,
  request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  block: ReviewedBlock,
): string {
  const record = exactDataRecord(value, [
    'role',
    'tokenAddress',
    'identityStatus',
    'runtimeCodeRead',
    'implementationRead',
    'implementationRuntimeCodeRead',
    'poolRead',
    'underlyingAssetRead',
    'decimalsRead',
    'balanceRead',
  ]);
  const tokenAddress = expectedRoleAddress(expectedRole, tokens);
  const manifestPinned = expectedRole === 'SUPPLY';
  if (
    record.role !== expectedRole ||
    record.tokenAddress !== tokenAddress ||
    record.identityStatus !==
      (manifestPinned ? 'MANIFEST_PINNED' : 'RELATIONSHIP_VERIFIED_REQUIRES_PRODUCTION_PIN')
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  codeRead(
    record.runtimeCodeRead,
    tokenAddress,
    manifestPinned ? request.manifest.runtimeCodeSha256.spToken : undefined,
    block,
  );
  const implementationAddress = implementationCall(
    record.implementationRead,
    tokenAddress,
    request.manifest.contracts.configurator,
    block,
  );
  if (
    implementationAddress === tokenAddress ||
    implementationAddress === request.manifest.contracts.usdc
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  codeRead(
    record.implementationRuntimeCodeRead,
    implementationAddress,
    manifestPinned ? request.manifest.runtimeCodeSha256.spTokenImplementation : undefined,
    block,
  );
  if (
    manifestPinned &&
    implementationAddress !== request.manifest.contracts.spTokenImplementation
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  plainCall(record.poolRead, tokenAddress, POOL_SELECTOR, request.manifest.contracts.pool, block);
  plainCall(
    record.underlyingAssetRead,
    tokenAddress,
    UNDERLYING_ASSET_SELECTOR,
    request.manifest.contracts.usdc,
    block,
  );
  const decimals = uintCall(record.decimalsRead, tokenAddress, DECIMALS_SELECTOR, block);
  if (decimals !== String(request.asset.decimals)) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return uintCall(record.balanceRead, tokenAddress, request.walletBalanceCallData, block);
}

function reviewedBalances(
  value: unknown,
  tokens: ReserveTokens,
  request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  block: ReviewedBlock,
): Readonly<{ supplyAtomic: string; borrowAtomic: string }> {
  const roles: readonly TokenRole[] = Object.freeze([
    'SUPPLY',
    'VARIABLE_BORROW',
    ...(tokens.stableDebt === ZERO_ADDRESS ? [] : (['STABLE_BORROW'] as const)),
  ]);
  const proofs = dataArray(value, MAX_TOKEN_PROOFS);
  if (proofs.length !== roles.length) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const balances = roles.map((role, index) =>
    reviewedTokenProof(proofs[index], role, tokens, request, block),
  );
  const supply = BigInt(balances[0] ?? '0');
  const variableDebt = BigInt(balances[1] ?? '0');
  const stableDebt = BigInt(balances[2] ?? '0');
  const borrow = variableDebt + stableDebt;
  if (supply > MAX_UINT256 || borrow > MAX_UINT256) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({ supplyAtomic: supply.toString(10), borrowAtomic: borrow.toString(10) });
}

function verifyTranscript(
  reader: CapturedTranscriptReader,
  capability: unknown,
  request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
): void {
  try {
    if (reader.verify(capability, request) !== true) {
      return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
  } catch (error) {
    if (error instanceof DormantSparkLendEthereumProviderPositionSourceError) throw error;
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function reviewedTranscript(
  capability: unknown,
  issuedRequest: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  request: ReviewedRequest,
  context: ReviewedContext,
  reader: CapturedTranscriptReader,
  settledAt: CanonicalTime,
): ReviewedTranscript {
  verifyTranscript(reader, capability, issuedRequest);
  assertBoundedImmutableCapability(capability, MAX_TRANSCRIPT_BYTES);
  const record = exactDataRecord(capability, [
    'transcriptVersion',
    'use',
    'mayAuthorizeFinancialAction',
    'mayPersist',
    'mayCreatePositionSnapshot',
    'accountId',
    'correlationId',
    'walletId',
    'walletAddress',
    'providerId',
    'protocolId',
    'marketId',
    'networkId',
    'sourceFamilyId',
    'sourceId',
    'manifestFingerprintSha256',
    'chainIdBefore',
    'chainIdAfter',
    'blockBefore',
    'blockAfter',
    'reserveTokenRead',
    'tokenProofs',
    'observedAt',
    'staleAfter',
    'status',
    'zeroPositionSemantics',
  ]);
  if (
    record.transcriptVersion !== SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION ||
    record.use !== SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.mayCreatePositionSnapshot !== false ||
    record.accountId !== request.accountId ||
    record.correlationId !== request.correlationId ||
    record.walletId !== request.walletId ||
    record.walletAddress !== context.walletAddress ||
    record.providerId !== issuedRequest.providerId ||
    record.protocolId !== issuedRequest.protocolId ||
    record.marketId !== issuedRequest.marketId ||
    record.networkId !== NETWORK_ID ||
    record.sourceFamilyId !== reader.sourceFamilyId ||
    record.sourceId !== reader.sourceId ||
    record.manifestFingerprintSha256 !== issuedRequest.manifestFingerprintSha256 ||
    record.chainIdBefore !== EXPECTED_CHAIN_ID ||
    record.chainIdAfter !== EXPECTED_CHAIN_ID ||
    record.status !== 'COMPLETE' ||
    record.zeroPositionSemantics !==
      'EXPLICIT_ZERO_BALANCE_FOR_SUPPLY_AND_EVERY_DISCOVERED_DEBT_TOKEN'
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const before = reviewedBlock(record.blockBefore);
  const after = reviewedBlock(record.blockAfter);
  if (!sameBlock(before, after)) return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  assertNonRegressing(context.continuityFloor, before);
  const tokens = reviewedReserveTokens(record.reserveTokenRead, issuedRequest, before);
  const balances = reviewedBalances(record.tokenProofs, tokens, issuedRequest, before);
  const observedAt = canonicalTime(record.observedAt);
  const staleAfter = canonicalTime(record.staleAfter);
  const policy = chainObservationPolicyForNetwork(NETWORK_ID);
  const maximumBlockAgeMilliseconds = BigInt(issuedRequest.manifest.maximumBlockAgeSeconds) * 1000n;
  const blockTimestampMilliseconds = BigInt(before.timestampSeconds) * 1000n;
  const observedAtMilliseconds = BigInt(observedAt.milliseconds);
  if (
    policy?.environment !== 'MAINNET' ||
    observedAt.milliseconds < context.resolvedAtMilliseconds ||
    observedAt.milliseconds > settledAt.milliseconds ||
    blockTimestampMilliseconds > observedAtMilliseconds ||
    observedAtMilliseconds - blockTimestampMilliseconds > maximumBlockAgeMilliseconds ||
    staleAfter.milliseconds <= settledAt.milliseconds ||
    staleAfter.milliseconds <= observedAt.milliseconds ||
    staleAfter.milliseconds > observedAt.milliseconds + policy.freshness.currentWithinMs
  ) {
    return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    block: before,
    observedAt,
    staleAfter,
    supplyAtomic: balances.supplyAtomic,
    borrowAtomic: balances.borrowAtomic,
  });
}

function positions(
  request: ReviewedRequest,
  transcript: ReviewedTranscript,
): readonly ProviderPositionAdmissionPositionV1[] {
  const output: ProviderPositionAdmissionPositionV1[] = [];
  for (const [positionKind, atomic] of [
    ['SUPPLY', transcript.supplyAtomic],
    ['BORROW', transcript.borrowAtomic],
  ] as const) {
    if (atomic === '0') continue;
    output.push(
      Object.freeze({
        positionId: `sparklend-${request.walletId}-usdc-${positionKind.toLowerCase()}`,
        positionKind,
        asset: request.asset,
        balance: Object.freeze({
          atomic,
          decimal: mainnetProviderPositionDecimalFromAtomic(atomic, request.asset.decimals),
        }),
      }),
    );
  }
  return Object.freeze(output);
}

function evidence(
  request: ReviewedRequest,
  context: ReviewedContext,
  transcript: ReviewedTranscript,
): ProviderPositionAdmissionSourceEvidenceV1 {
  return Object.freeze({
    evidenceVersion: PROVIDER_POSITION_ADMISSION_VERSION,
    use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
    mayAuthorizeFinancialAction: false,
    accountId: request.accountId,
    correlationId: request.correlationId,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: 'RPC',
    sourceObservationId: `ethereum-block-${transcript.block.number}`,
    walletId: request.walletId,
    providerId: 'spark',
    protocolId: 'sparklend',
    marketId: 'sparklend-ethereum-usdc',
    networkId: NETWORK_ID,
    assets: Object.freeze([request.asset]),
    status: 'COMPLETE',
    observedAt: transcript.observedAt.timestamp,
    staleAfter: transcript.staleAfter.timestamp,
    continuityFloor: context.continuityFloor,
    chainAnchor: Object.freeze({
      kind: 'EVM_BLOCK',
      blockNumber: transcript.block.number,
      blockHash: transcript.block.hash,
    }),
    positions: positions(request, transcript),
  });
}

/**
 * Dormant SparkLend Ethereum account-position source. It owns no endpoint,
 * credential, database handle, timer, environment access, persistence,
 * registration, snapshot authority, or financial authority. Production use
 * remains blocked until each discovered debt-token proxy, implementation, and
 * runtime-code hash is separately reviewed and pinned in an approved manifest.
 */
export class DormantSparkLendEthereumProviderPositionSource implements ProviderPositionAdmissionSourcePort {
  readonly #configuration: Readonly<{
    manifest: SparkLendEthereumUSDCManifest;
    fingerprint: string;
  }>;
  readonly #contextReader: CapturedContextReader;
  readonly #transcriptReader: CapturedTranscriptReader;
  readonly #now: () => Date;

  constructor(
    manifestInput: unknown,
    requiredManifestFingerprintSha256: unknown,
    contextReaderInput: SparkLendEthereumDurableTargetContextReaderPort,
    transcriptReaderInput: SparkLendEthereumFinalizedPositionTranscriptPort,
    clock: SparkLendEthereumProviderPositionSourceClock,
  ) {
    this.#configuration = manifestConfiguration(manifestInput, requiredManifestFingerprintSha256);
    this.#contextReader = capturedContextReader(contextReaderInput);
    this.#transcriptReader = capturedTranscriptReader(transcriptReaderInput);
    this.#now = capturedClock(clock);
    if (
      this.#contextReader.receiver === this.#transcriptReader.receiver ||
      this.#contextReader.sourceFamilyId === this.#transcriptReader.sourceFamilyId ||
      this.#contextReader.sourceId === this.#transcriptReader.sourceId
    ) {
      return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
    }
  }

  async readTarget(
    requestInput: ReadProviderPositionAdmissionTargetRequestV1,
  ): Promise<ProviderPositionAdmissionSourceEvidenceV1> {
    try {
      const startedAt = clockTime(this.#now);
      const request = reviewedRequest(requestInput, startedAt, this.#configuration.manifest);
      if (
        request.sourceFamilyId !== this.#transcriptReader.sourceFamilyId ||
        request.sourceId !== this.#transcriptReader.sourceId
      ) {
        return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
      }
      const issuedContextRequest = contextRequest(request);
      const contextCapability = await this.#contextReader.read(issuedContextRequest);
      const contextSettledAt = clockTime(this.#now);
      if (
        request.signal.aborted ||
        contextSettledAt.milliseconds < startedAt.milliseconds ||
        contextSettledAt.milliseconds >= request.deadlineAtMilliseconds
      ) {
        return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      const context = reviewedContext(
        contextCapability,
        request,
        this.#contextReader,
        issuedContextRequest,
        contextSettledAt,
        startedAt,
      );
      const issuedTranscriptRequest = transcriptRequest(request, context, this.#configuration);
      const transcriptCapability = await this.#transcriptReader.read(issuedTranscriptRequest);
      const transcriptSettledAt = clockTime(this.#now);
      if (
        request.signal.aborted ||
        transcriptSettledAt.milliseconds < contextSettledAt.milliseconds ||
        transcriptSettledAt.milliseconds >= request.deadlineAtMilliseconds
      ) {
        return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      const transcript = reviewedTranscript(
        transcriptCapability,
        issuedTranscriptRequest,
        request,
        context,
        this.#transcriptReader,
        transcriptSettledAt,
      );
      const result = evidence(request, context, transcript);
      const completedAt = clockTime(this.#now);
      if (
        request.signal.aborted ||
        completedAt.milliseconds < transcriptSettledAt.milliseconds ||
        completedAt.milliseconds >= request.deadlineAtMilliseconds ||
        completedAt.milliseconds >= transcript.staleAfter.milliseconds
      ) {
        return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      verifyContext(this.#contextReader, contextCapability, issuedContextRequest);
      verifyTranscript(this.#transcriptReader, transcriptCapability, issuedTranscriptRequest);
      return result;
    } catch (error) {
      if (error instanceof DormantSparkLendEthereumProviderPositionSourceError) throw error;
      return fail('SPARKLEND_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
  }
}
