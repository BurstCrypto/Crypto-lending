import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import {
  compoundIIIUSDCManifestFingerprintSha256,
  parseCompoundIIIUSDCFinalizedManifest,
  type CompoundIIIUSDCFinalizedManifest,
} from '../../smart-lending/infrastructure/compound/compound-iii-ethereum-usdc.manifest';
import { parseEvmWalletAddress } from '../../wallets/domain/wallet-identity';
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

export const COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION = 1 as const;
export const COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_USE =
  'DORMANT_COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_ONLY' as const;
export const COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION = 1 as const;
export const COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE =
  'DORMANT_COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_ONLY' as const;

const NETWORK_ID = 'eip155:1' as const;
const PROVIDER_ID = 'compound' as const;
const PROTOCOL_ID = 'compound-iii' as const;
const MARKET_ID = 'compound-iii-ethereum-usdc' as const;
const EXPECTED_CHAIN_ID = '0x1' as const;
const BLOCK_SELECTOR = 'finalized' as const;
const BLOCK_BINDING = 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const;
const IMPLEMENTATION_SELECTOR = '0x5c60da1b' as const;
const BASE_TOKEN_SELECTOR = '0xc55dae63' as const;
const BASE_SCALE_SELECTOR = '0x44c1e5eb' as const;
const DECIMALS_SELECTOR = '0x313ce567' as const;
const BALANCE_OF_SELECTOR = '0x70a08231' as const;
const BORROW_BALANCE_OF_SELECTOR = '0x374c49b4' as const;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const MAX_TRANSCRIPT_BYTES = 512 * 1024;
const MAX_CONTEXT_BYTES = 16 * 1024;
const MAX_DATA_NODES = 512;
const MAX_DATA_DEPTH = 12;
const MAX_STRING_BYTES = 132 * 1024;
const MAX_CODE_BYTES = 65_536;
const MAX_UINT256 = (1n << 256n) - 1n;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const SOURCE_FAMILY_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SOURCE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const ABI_WORD = /^0x[0-9a-f]{64}$/u;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO_BLOCK_HASH = `0x${'0'.repeat(64)}`;
const ZERO_SHA256 = '0'.repeat(64);

const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const DATE_GET_TIME = Date.prototype.getTime;
const DATE_TO_ISO_STRING = Date.prototype.toISOString;

const ADMISSION_REQUEST_KEYS = Object.freeze([
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
] as const);
const ASSET_KEYS = Object.freeze(['stablecoin', 'networkId', 'identity', 'decimals'] as const);
const CONTEXT_CAPABILITY_KEYS = Object.freeze([
  'contextVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'maySign',
  'mayAccessWalletPrivateKey',
  'accountId',
  'correlationId',
  'deadlineAt',
  'sourceFamilyId',
  'sourceId',
  'sourceKind',
  'walletId',
  'providerId',
  'protocolId',
  'marketId',
  'networkId',
  'contextSourceFamilyId',
  'contextSourceId',
  'walletAddress',
  'continuityFloor',
] as const);
const TRANSCRIPT_CAPABILITY_KEYS = Object.freeze([
  'transcriptVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'maySign',
  'mayAccessWalletPrivateKey',
  'accountId',
  'correlationId',
  'deadlineAt',
  'sourceFamilyId',
  'sourceId',
  'sourceKind',
  'walletId',
  'providerId',
  'protocolId',
  'marketId',
  'networkId',
  'walletAddress',
  'manifestFingerprintSha256',
  'chainIdBefore',
  'chainIdAfter',
  'selectedBlockBefore',
  'floorBlockBefore',
  'codeReads',
  'identityReads',
  'accountReads',
  'floorBlockAfter',
  'selectedBlockAfter',
  'status',
  'zeroPositionSemantics',
] as const);
const BLOCK_READ_KEYS = Object.freeze([
  'method',
  'selector',
  'includeTransactions',
  'result',
] as const);
const HEADER_KEYS = Object.freeze([
  'number',
  'hash',
  'parentHash',
  'stateRoot',
  'timestamp',
] as const);
const CODE_RESULT_KEYS = Object.freeze([
  'operationId',
  'method',
  'address',
  'blockParameter',
  'result',
] as const);
const CALL_RESULT_KEYS = Object.freeze([
  'operationId',
  'method',
  'to',
  'data',
  'from',
  'blockParameter',
  'result',
] as const);
const ACCOUNT_RESULT_KEYS = Object.freeze([
  'operationId',
  'positionKind',
  'method',
  'to',
  'data',
  'from',
  'blockParameter',
  'result',
] as const);

export interface ReadCompoundIIIEthereumDurableTargetContextRequestV1 {
  readonly contextVersion: typeof COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly maySign: false;
  readonly mayAccessWalletPrivateKey: false;
  readonly admissionRequest: ReadProviderPositionAdmissionTargetRequestV1;
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: 'RPC';
  readonly walletId: string;
  readonly providerId: typeof PROVIDER_ID;
  readonly protocolId: typeof PROTOCOL_ID;
  readonly marketId: typeof MARKET_ID;
  readonly networkId: typeof NETWORK_ID;
}

export interface CompoundIIIEthereumDurableTargetContextCapabilityV1 {
  readonly contextVersion: typeof COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly maySign: false;
  readonly mayAccessWalletPrivateKey: false;
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly deadlineAt: string;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: 'RPC';
  readonly walletId: string;
  readonly providerId: typeof PROVIDER_ID;
  readonly protocolId: typeof PROTOCOL_ID;
  readonly marketId: typeof MARKET_ID;
  readonly networkId: typeof NETWORK_ID;
  readonly contextSourceFamilyId: string;
  readonly contextSourceId: string;
  readonly walletAddress: string;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
}

/**
 * Authenticated durable lookup for an already-authorized public address and
 * independently retained chain floor. This port grants no decryption, private
 * key, signer, persistence, network, or financial authority.
 */
export interface CompoundIIIEthereumDurableTargetContextReaderPort {
  readonly contextVersion: typeof COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readContext(request: ReadCompoundIIIEthereumDurableTargetContextRequestV1): Promise<unknown>;
  reviewContext(
    capability: unknown,
    request: ReadCompoundIIIEthereumDurableTargetContextRequestV1,
  ): unknown | null;
}

export interface CompoundIIIEthereumCodeReadV1 {
  readonly operationId: 'comet-proxy-code' | 'comet-implementation-code' | 'base-usdc-code';
  readonly address: string;
  readonly expectedRuntimeCodeSha256: string;
}

export interface CompoundIIIEthereumIdentityReadV1 {
  readonly operationId:
    'proxy-implementation' | 'base-token' | 'base-scale' | 'comet-decimals' | 'base-usdc-decimals';
  readonly to: string;
  readonly data: string;
  readonly from: string | null;
}

export interface CompoundIIIEthereumAccountReadV1 {
  readonly operationId: 'usdc-supply' | 'usdc-borrow';
  readonly positionKind: 'SUPPLY' | 'BORROW';
  readonly to: string;
  readonly data: string;
  readonly from: null;
}

export interface ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1 {
  readonly transcriptVersion: typeof COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly use: typeof COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly maySign: false;
  readonly mayAccessWalletPrivateKey: false;
  readonly admissionRequest: ReadProviderPositionAdmissionTargetRequestV1;
  readonly contextRequest: ReadCompoundIIIEthereumDurableTargetContextRequestV1;
  readonly contextCapability: CompoundIIIEthereumDurableTargetContextCapabilityV1;
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: 'RPC';
  readonly walletId: string;
  readonly providerId: typeof PROVIDER_ID;
  readonly protocolId: typeof PROTOCOL_ID;
  readonly marketId: typeof MARKET_ID;
  readonly networkId: typeof NETWORK_ID;
  readonly walletAddress: string;
  readonly expectedChainId: typeof EXPECTED_CHAIN_ID;
  readonly blockSelector: typeof BLOCK_SELECTOR;
  readonly blockBinding: typeof BLOCK_BINDING;
  readonly floorBlockSelector: string;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
  readonly manifest: CompoundIIIUSDCFinalizedManifest;
  readonly manifestFingerprintSha256: string;
  readonly codeReads: readonly CompoundIIIEthereumCodeReadV1[];
  readonly identityReads: readonly CompoundIIIEthereumIdentityReadV1[];
  readonly accountReads: readonly CompoundIIIEthereumAccountReadV1[];
  readonly executionOrder: readonly string[];
  readonly maximumResponseBytes: typeof MAX_TRANSCRIPT_BYTES;
}

/**
 * Owns no endpoint, client, credential, DNS, TLS, retry, signer, or ambient
 * configuration. Implementations must perform the exact ordered read plan,
 * bind one issued immutable capability to the exact request object, and drain
 * started work before rejecting after cancellation.
 */
export interface CompoundIIIEthereumFinalizedPositionTranscriptPort {
  readonly transcriptVersion: typeof COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readTranscript(
    request: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
  ): Promise<unknown>;
  reviewTranscript(
    capability: unknown,
    request: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
  ): unknown | null;
}

export interface CompoundIIIEthereumProviderPositionSourceClock {
  now(): Date;
}

export type DormantCompoundIIIEthereumProviderPositionSourceFailureCode =
  | 'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION'
  | 'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST'
  | 'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE';

export class DormantCompoundIIIEthereumProviderPositionSourceError extends Error {
  constructor(readonly code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode) {
    super('Compound III Ethereum provider-position source is unavailable.');
    this.name = 'DormantCompoundIIIEthereumProviderPositionSourceError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

interface CapturedMethod {
  readonly receiver: object;
  readonly method: (...arguments_: readonly unknown[]) => unknown;
}

interface CapturedContextReader {
  readonly receiver: object;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly read: CapturedMethod;
  readonly review: CapturedMethod;
}

interface CapturedTranscriptReader {
  readonly receiver: object;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly read: CapturedMethod;
  readonly review: CapturedMethod;
}

interface CanonicalTime {
  readonly timestamp: string;
  readonly milliseconds: number;
}

interface ReviewedRequest {
  readonly request: ReadProviderPositionAdmissionTargetRequestV1;
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly deadlineAt: CanonicalTime;
  readonly signal: AbortSignal;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly walletId: string;
  readonly asset: ProviderPositionAdmissionAssetV1;
}

interface ReviewedContext {
  readonly capability: CompoundIIIEthereumDurableTargetContextCapabilityV1;
  readonly walletAddress: string;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
}

interface Header {
  readonly numberHex: string;
  readonly numberDecimal: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly timestampSeconds: bigint;
}

interface ParsedTranscript {
  readonly selectedBlock: Header;
  readonly supplyAtomic: string;
  readonly borrowAtomic: string;
}

function fail(code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode): never {
  throw new DormantCompoundIIIEthereumProviderPositionSourceError(code);
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode,
  requireFrozen: boolean,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      (requireFrozen && !Object.isFrozen(value))
    ) {
      return fail(code);
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
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
    if (error instanceof DormantCompoundIIIEthereumProviderPositionSourceError) throw error;
    return fail(code);
  }
}

function exactDataArray(
  value: unknown,
  maximumLength: number,
  code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode,
  requireFrozen: boolean,
): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      (requireFrozen && !Object.isFrozen(value))
    ) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const length = descriptors['length']?.value;
    if (
      !Number.isSafeInteger(length) ||
      (length as number) < 0 ||
      (length as number) > maximumLength
    ) {
      return fail(code);
    }
    const expectedKeys = [
      ...Array.from({ length: length as number }, (_, index) => String(index)),
      'length',
    ];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail(code);
    }
    return Object.freeze(
      expectedKeys.slice(0, -1).map((key) => {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
        return descriptor.value;
      }),
    );
  } catch (error) {
    if (error instanceof DormantCompoundIIIEthereumProviderPositionSourceError) throw error;
    return fail(code);
  }
}

function stableDataMember(value: object, key: PropertyKey): unknown {
  try {
    let current: object | null = value;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (isProxy(current)) {
        return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!('value' in descriptor)) {
          return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
        }
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  } catch (error) {
    if (error instanceof DormantCompoundIIIEthereumProviderPositionSourceError) throw error;
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
}

function objectReceiver(value: unknown): object {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value as object;
}

function capturedMethod(receiver: object, key: string): CapturedMethod {
  const method = stableDataMember(receiver, key);
  if (typeof method !== 'function' || isProxy(method)) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver,
    method: method as (...arguments_: readonly unknown[]) => unknown,
  });
}

function invoke(method: CapturedMethod, arguments_: readonly unknown[]): unknown {
  return Reflect.apply(method.method, method.receiver, arguments_);
}

function sourceFamilyId(value: unknown): string {
  if (typeof value !== 'string' || !SOURCE_FAMILY_ID.test(value)) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value;
}

function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !SOURCE_ID.test(value)) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value;
}

function capturedContextReader(value: unknown): CapturedContextReader {
  const receiver = objectReceiver(value);
  if (
    stableDataMember(receiver, 'contextVersion') !==
    COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver,
    sourceFamilyId: sourceFamilyId(stableDataMember(receiver, 'sourceFamilyId')),
    sourceId: sourceId(stableDataMember(receiver, 'sourceId')),
    read: capturedMethod(receiver, 'readContext'),
    review: capturedMethod(receiver, 'reviewContext'),
  });
}

function capturedTranscriptReader(value: unknown): CapturedTranscriptReader {
  const receiver = objectReceiver(value);
  if (
    stableDataMember(receiver, 'transcriptVersion') !==
    COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver,
    sourceFamilyId: sourceFamilyId(stableDataMember(receiver, 'sourceFamilyId')),
    sourceId: sourceId(stableDataMember(receiver, 'sourceId')),
    read: capturedMethod(receiver, 'readTranscript'),
    review: capturedMethod(receiver, 'reviewTranscript'),
  });
}

function capturedClock(value: unknown): CapturedMethod {
  return capturedMethod(objectReceiver(value), 'now');
}

function canonicalTime(
  value: unknown,
  code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode,
): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  try {
    if (
      !Number.isSafeInteger(milliseconds) ||
      Reflect.apply(DATE_TO_ISO_STRING, new Date(milliseconds), []) !== value
    ) {
      return fail(code);
    }
  } catch {
    return fail(code);
  }
  return Object.freeze({ timestamp: value, milliseconds });
}

function clockTime(now: CapturedMethod): CanonicalTime {
  const value = invoke(now, []);
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Date.prototype
    ) {
      return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
    }
    const milliseconds = Reflect.apply(DATE_GET_TIME, value, []) as number;
    if (!Number.isSafeInteger(milliseconds)) {
      return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
    }
    const timestamp = Reflect.apply(DATE_TO_ISO_STRING, value, []) as string;
    return Object.freeze({ timestamp, milliseconds });
  } catch (error) {
    if (error instanceof DormantCompoundIIIEthereumProviderPositionSourceError) throw error;
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
}

function genuineSignal(value: unknown): AbortSignal {
  try {
    if (
      ABORTED_GETTER === undefined ||
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype
    ) {
      return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch (error) {
    if (error instanceof DormantCompoundIIIEthereumProviderPositionSourceError) throw error;
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
}

function aborted(value: AbortSignal): boolean {
  try {
    if (ABORTED_GETTER === undefined) {
      return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
    }
    return Reflect.apply(ABORTED_GETTER, value, []) as boolean;
  } catch (error) {
    if (error instanceof DormantCompoundIIIEthereumProviderPositionSourceError) throw error;
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
}

function assertActive(request: ReviewedRequest, now: CanonicalTime, prior: CanonicalTime): void {
  if (
    aborted(request.signal) ||
    now.milliseconds < prior.milliseconds ||
    now.milliseconds >= request.deadlineAt.milliseconds
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function parseAsset(
  value: unknown,
  manifest: CompoundIIIUSDCFinalizedManifest,
): ProviderPositionAdmissionAssetV1 {
  const record = exactDataRecord(
    value,
    ASSET_KEYS,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    true,
  );
  if (
    record.stablecoin !== 'USDC' ||
    record.networkId !== NETWORK_ID ||
    record.identity !== manifest.baseAsset.address ||
    record.decimals !== manifest.baseAsset.decimals
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  return frozenNullPrototype({
    stablecoin: 'USDC' as const,
    networkId: NETWORK_ID,
    identity: manifest.baseAsset.address,
    decimals: manifest.baseAsset.decimals,
  });
}

function reviewedRequest(
  value: unknown,
  startedAt: CanonicalTime,
  manifest: CompoundIIIUSDCFinalizedManifest,
  reader: CapturedTranscriptReader,
): ReviewedRequest {
  const record = exactDataRecord(
    value,
    ADMISSION_REQUEST_KEYS,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    true,
  );
  let accountId: AccountId;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  const deadlineAt = canonicalTime(
    record.deadlineAt,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
  );
  const signal = genuineSignal(record.signal);
  const assets = exactDataArray(
    record.assets,
    1,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    true,
  );
  if (
    record.admissionVersion !== PROVIDER_POSITION_ADMISSION_VERSION ||
    typeof record.correlationId !== 'string' ||
    !CORRELATION_ID.test(record.correlationId) ||
    record.sourceFamilyId !== reader.sourceFamilyId ||
    record.sourceId !== reader.sourceId ||
    record.sourceKind !== 'RPC' ||
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    record.providerId !== PROVIDER_ID ||
    record.protocolId !== PROTOCOL_ID ||
    record.marketId !== MARKET_ID ||
    record.networkId !== NETWORK_ID ||
    assets.length !== 1 ||
    aborted(signal) ||
    deadlineAt.milliseconds <= startedAt.milliseconds ||
    deadlineAt.milliseconds - startedAt.milliseconds > MAX_DEADLINE_MILLISECONDS
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  return Object.freeze({
    request: value as ReadProviderPositionAdmissionTargetRequestV1,
    accountId,
    correlationId: record.correlationId,
    deadlineAt,
    signal,
    sourceFamilyId: reader.sourceFamilyId,
    sourceId: reader.sourceId,
    walletId: record.walletId,
    asset: parseAsset(assets[0], manifest),
  });
}

function contextRequest(
  request: ReviewedRequest,
): ReadCompoundIIIEthereumDurableTargetContextRequestV1 {
  return frozenNullPrototype({
    contextVersion: COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    maySign: false as const,
    mayAccessWalletPrivateKey: false as const,
    admissionRequest: request.request,
    accountId: request.accountId,
    correlationId: request.correlationId,
    deadlineAt: request.deadlineAt.timestamp,
    signal: request.signal,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: 'RPC' as const,
    walletId: request.walletId,
    providerId: PROVIDER_ID,
    protocolId: PROTOCOL_ID,
    marketId: MARKET_ID,
    networkId: NETWORK_ID,
  });
}

function decimalInteger(
  value: unknown,
  code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode,
): string {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) return fail(code);
  try {
    if (BigInt(value) > MAX_UINT256) return fail(code);
  } catch {
    return fail(code);
  }
  return value;
}

function blockHash(
  value: unknown,
  code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode,
): string {
  if (typeof value !== 'string' || !EVM_BLOCK_HASH.test(value) || value === ZERO_BLOCK_HASH) {
    return fail(code);
  }
  return value;
}

function evmAnchor(
  value: unknown,
  code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode,
): ProviderPositionAdmissionEvmAnchorV1 {
  const record = exactDataRecord(value, ['kind', 'blockNumber', 'blockHash'], code, true);
  const blockNumber = decimalInteger(record.blockNumber, code);
  if (record.kind !== 'EVM_BLOCK') return fail(code);
  return frozenNullPrototype({
    kind: 'EVM_BLOCK' as const,
    blockNumber,
    blockHash: blockHash(record.blockHash, code),
  });
}

function assertBoundIdentity(
  record: Record<string, unknown>,
  request: ReviewedRequest,
  code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode,
): void {
  if (
    record.accountId !== request.accountId ||
    record.correlationId !== request.correlationId ||
    record.deadlineAt !== request.deadlineAt.timestamp ||
    record.sourceFamilyId !== request.sourceFamilyId ||
    record.sourceId !== request.sourceId ||
    record.sourceKind !== 'RPC' ||
    record.walletId !== request.walletId ||
    record.providerId !== PROVIDER_ID ||
    record.protocolId !== PROTOCOL_ID ||
    record.marketId !== MARKET_ID ||
    record.networkId !== NETWORK_ID
  ) {
    return fail(code);
  }
}

function reviewedContext(
  capability: unknown,
  request: ReviewedRequest,
  reader: CapturedContextReader,
): ReviewedContext {
  assertBoundedPlainData(capability, MAX_CONTEXT_BYTES);
  const record = exactDataRecord(
    capability,
    CONTEXT_CAPABILITY_KEYS,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.contextVersion !== COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION ||
    record.use !== COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.maySign !== false ||
    record.mayAccessWalletPrivateKey !== false ||
    record.contextSourceFamilyId !== reader.sourceFamilyId ||
    record.contextSourceId !== reader.sourceId
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  assertBoundIdentity(record, request, 'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  let walletAddress: string;
  try {
    walletAddress = parseEvmWalletAddress(record.walletAddress);
  } catch {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    capability: capability as CompoundIIIEthereumDurableTargetContextCapabilityV1,
    walletAddress,
    continuityFloor: evmAnchor(
      record.continuityFloor,
      'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  });
}

function addressCallData(selector: string, address: string): string {
  return `${selector}${'0'.repeat(24)}${address.slice(2)}`;
}

function codeReads(
  manifest: CompoundIIIUSDCFinalizedManifest,
): readonly CompoundIIIEthereumCodeReadV1[] {
  return Object.freeze([
    Object.freeze({
      operationId: 'comet-proxy-code' as const,
      address: manifest.cometProxy,
      expectedRuntimeCodeSha256: manifest.runtimeCodeSha256.cometProxy,
    }),
    Object.freeze({
      operationId: 'comet-implementation-code' as const,
      address: manifest.implementation,
      expectedRuntimeCodeSha256: manifest.runtimeCodeSha256.implementation,
    }),
    Object.freeze({
      operationId: 'base-usdc-code' as const,
      address: manifest.baseAsset.address,
      expectedRuntimeCodeSha256: manifest.runtimeCodeSha256.baseAsset,
    }),
  ]);
}

function identityReads(
  manifest: CompoundIIIUSDCFinalizedManifest,
): readonly CompoundIIIEthereumIdentityReadV1[] {
  return Object.freeze([
    Object.freeze({
      operationId: 'proxy-implementation' as const,
      to: manifest.cometProxy,
      data: IMPLEMENTATION_SELECTOR,
      from: manifest.proxyAdmin,
    }),
    Object.freeze({
      operationId: 'base-token' as const,
      to: manifest.cometProxy,
      data: BASE_TOKEN_SELECTOR,
      from: null,
    }),
    Object.freeze({
      operationId: 'base-scale' as const,
      to: manifest.cometProxy,
      data: BASE_SCALE_SELECTOR,
      from: null,
    }),
    Object.freeze({
      operationId: 'comet-decimals' as const,
      to: manifest.cometProxy,
      data: DECIMALS_SELECTOR,
      from: null,
    }),
    Object.freeze({
      operationId: 'base-usdc-decimals' as const,
      to: manifest.baseAsset.address,
      data: DECIMALS_SELECTOR,
      from: null,
    }),
  ]);
}

function accountReads(
  manifest: CompoundIIIUSDCFinalizedManifest,
  walletAddress: string,
): readonly CompoundIIIEthereumAccountReadV1[] {
  return Object.freeze([
    Object.freeze({
      operationId: 'usdc-supply' as const,
      positionKind: 'SUPPLY' as const,
      to: manifest.cometProxy,
      data: addressCallData(BALANCE_OF_SELECTOR, walletAddress),
      from: null,
    }),
    Object.freeze({
      operationId: 'usdc-borrow' as const,
      positionKind: 'BORROW' as const,
      to: manifest.cometProxy,
      data: addressCallData(BORROW_BALANCE_OF_SELECTOR, walletAddress),
      from: null,
    }),
  ]);
}

function transcriptRequest(
  request: ReviewedRequest,
  contextRequestValue: ReadCompoundIIIEthereumDurableTargetContextRequestV1,
  context: ReviewedContext,
  manifest: CompoundIIIUSDCFinalizedManifest,
  manifestFingerprintSha256: string,
): ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1 {
  const requestedCodeReads = codeReads(manifest);
  const requestedIdentityReads = identityReads(manifest);
  const requestedAccountReads = accountReads(manifest, context.walletAddress);
  return frozenNullPrototype({
    transcriptVersion: COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    maySign: false as const,
    mayAccessWalletPrivateKey: false as const,
    admissionRequest: request.request,
    contextRequest: contextRequestValue,
    contextCapability: context.capability,
    accountId: request.accountId,
    correlationId: request.correlationId,
    deadlineAt: request.deadlineAt.timestamp,
    signal: request.signal,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: 'RPC' as const,
    walletId: request.walletId,
    providerId: PROVIDER_ID,
    protocolId: PROTOCOL_ID,
    marketId: MARKET_ID,
    networkId: NETWORK_ID,
    walletAddress: context.walletAddress,
    expectedChainId: EXPECTED_CHAIN_ID,
    blockSelector: BLOCK_SELECTOR,
    blockBinding: BLOCK_BINDING,
    floorBlockSelector: decimalToHex(context.continuityFloor.blockNumber),
    continuityFloor: context.continuityFloor,
    manifest,
    manifestFingerprintSha256,
    codeReads: requestedCodeReads,
    identityReads: requestedIdentityReads,
    accountReads: requestedAccountReads,
    executionOrder: Object.freeze([
      'chain-id-before',
      'selected-block-before',
      'floor-block-before',
      ...requestedCodeReads.map(({ operationId }) => operationId),
      ...requestedIdentityReads.map(({ operationId }) => operationId),
      ...requestedAccountReads.map(({ operationId }) => operationId),
      'floor-block-after',
      'selected-block-after',
      'chain-id-after',
    ]),
    maximumResponseBytes: MAX_TRANSCRIPT_BYTES,
  });
}

function assertBoundedPlainData(value: unknown, maximumBytes: number): void {
  try {
    const seen = new WeakSet<object>();
    let bytes = 0;
    let nodes = 0;
    const visit = (candidate: unknown, depth: number): void => {
      nodes += 1;
      if (nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) {
        return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      if (candidate === null || typeof candidate === 'boolean') bytes += 5;
      else if (typeof candidate === 'string') {
        const length = Buffer.byteLength(candidate, 'utf8');
        if (length > MAX_STRING_BYTES) {
          return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
        }
        bytes += length + 2;
      } else if (typeof candidate === 'number') {
        if (!Number.isSafeInteger(candidate)) {
          return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
        }
        bytes += 32;
      } else if (typeof candidate === 'object') {
        if (isProxy(candidate) || seen.has(candidate) || !Object.isFrozen(candidate)) {
          return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
        }
        seen.add(candidate);
        const array = Array.isArray(candidate);
        const prototype = Object.getPrototypeOf(candidate) as unknown;
        if (
          (array && prototype !== Array.prototype) ||
          (!array && prototype !== Object.prototype && prototype !== null)
        ) {
          return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
        }
        const descriptors = Object.getOwnPropertyDescriptors(
          candidate,
        ) as unknown as PropertyDescriptorMap;
        if (Object.getOwnPropertySymbols(candidate).length > 0) {
          return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
        }
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (array && key === 'length') continue;
          if (!descriptor.enumerable || !('value' in descriptor)) {
            return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
          }
          bytes += Buffer.byteLength(key, 'utf8') + 3;
          visit(descriptor.value, depth + 1);
        }
      } else return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      if (bytes > maximumBytes) {
        return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
    };
    visit(value, 0);
  } catch (error) {
    if (error instanceof DormantCompoundIIIEthereumProviderPositionSourceError) throw error;
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function hexQuantity(
  value: unknown,
  code: DormantCompoundIIIEthereumProviderPositionSourceFailureCode,
): Readonly<{ readonly hex: string; readonly decimal: string }> {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) return fail(code);
  try {
    const integer = BigInt(value);
    if (integer > MAX_UINT256) return fail(code);
    return Object.freeze({ hex: value, decimal: integer.toString(10) });
  } catch {
    return fail(code);
  }
}

function decimalToHex(value: string): string {
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function parsedHeader(value: unknown): Header {
  const record = exactDataRecord(
    value,
    HEADER_KEYS,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  const number = hexQuantity(record.number, 'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  const timestamp = hexQuantity(
    record.timestamp,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
  );
  const hash = blockHash(record.hash, 'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  const parentHash = blockHash(
    record.parentHash,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
  );
  const stateRoot = blockHash(
    record.stateRoot,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
  );
  if (number.decimal === '0' || timestamp.decimal === '0' || hash === parentHash) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    numberHex: number.hex,
    numberDecimal: number.decimal,
    hash,
    parentHash,
    stateRoot,
    timestampSeconds: BigInt(timestamp.decimal),
  });
}

function parsedBlockRead(value: unknown, expectedSelector: string): Header {
  const record = exactDataRecord(
    value,
    BLOCK_READ_KEYS,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.method !== 'eth_getBlockByNumber' ||
    record.selector !== expectedSelector ||
    record.includeTransactions !== false
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return parsedHeader(record.result);
}

function sameHeader(left: Header, right: Header): boolean {
  return (
    left.numberHex === right.numberHex &&
    left.hash === right.hash &&
    left.parentHash === right.parentHash &&
    left.stateRoot === right.stateRoot &&
    left.timestampSeconds === right.timestampSeconds
  );
}

function eip1898BlockParameter(value: unknown, selectedBlockHash: string): void {
  const record = exactDataRecord(
    value,
    ['blockHash', 'requireCanonical'],
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (record.blockHash !== selectedBlockHash || record.requireCanonical !== true) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function runtimeCode(value: unknown, expectedSha256: string): void {
  if (
    typeof value !== 'string' ||
    !HEX_DATA.test(value) ||
    value === '0x' ||
    (value.length - 2) / 2 > MAX_CODE_BYTES
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const actual = createHash('sha256')
    .update(Buffer.from(value.slice(2), 'hex'))
    .digest('hex');
  if (actual !== expectedSha256) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function matchCodeReads(
  value: unknown,
  request: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
  selectedBlockHash: string,
): void {
  const values = exactDataArray(
    value,
    request.codeReads.length,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (values.length !== request.codeReads.length) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  for (const [index, candidate] of values.entries()) {
    const record = exactDataRecord(
      candidate,
      CODE_RESULT_KEYS,
      'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
      true,
    );
    const expected = request.codeReads[index];
    if (
      expected === undefined ||
      record.operationId !== expected.operationId ||
      record.method !== 'eth_getCode' ||
      record.address !== expected.address
    ) {
      return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    eip1898BlockParameter(record.blockParameter, selectedBlockHash);
    runtimeCode(record.result, expected.expectedRuntimeCodeSha256);
  }
}

function abiUint(value: unknown): bigint {
  if (typeof value !== 'string' || !ABI_WORD.test(value)) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return BigInt(value);
}

function abiAddress(value: unknown): string {
  if (typeof value !== 'string' || !ABI_WORD.test(value) || !/^0x0{24}/u.test(value)) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const address = `0x${value.slice(-40)}`;
  if (!EVM_ADDRESS.test(address) || address === ZERO_ADDRESS) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return address;
}

function exactCallResult(
  candidate: unknown,
  expected: CompoundIIIEthereumIdentityReadV1,
  selectedBlockHash: string,
): unknown {
  const record = exactDataRecord(
    candidate,
    CALL_RESULT_KEYS,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.operationId !== expected.operationId ||
    record.method !== 'eth_call' ||
    record.to !== expected.to ||
    record.data !== expected.data ||
    record.from !== expected.from
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  eip1898BlockParameter(record.blockParameter, selectedBlockHash);
  return record.result;
}

function matchIdentityReads(
  value: unknown,
  request: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
  selectedBlockHash: string,
): void {
  const values = exactDataArray(
    value,
    request.identityReads.length,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (values.length !== request.identityReads.length) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const results = new Map<string, unknown>();
  for (const [index, candidate] of values.entries()) {
    const operation = exactDataRecord(
      candidate,
      CALL_RESULT_KEYS,
      'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
      true,
    ).operationId;
    const expected = request.identityReads[index];
    if (
      expected === undefined ||
      operation !== expected.operationId ||
      results.has(expected.operationId)
    ) {
      return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    results.set(expected.operationId, exactCallResult(candidate, expected, selectedBlockHash));
  }
  if (
    abiAddress(results.get('proxy-implementation')) !== request.manifest.implementation ||
    abiAddress(results.get('base-token')) !== request.manifest.baseAsset.address ||
    abiUint(results.get('base-scale')) !== BigInt(request.manifest.baseAsset.scale) ||
    abiUint(results.get('comet-decimals')) !== BigInt(request.manifest.baseAsset.decimals) ||
    abiUint(results.get('base-usdc-decimals')) !== BigInt(request.manifest.baseAsset.decimals)
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function matchAccountReads(
  value: unknown,
  request: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
  selectedBlockHash: string,
): Readonly<{ readonly supplyAtomic: string; readonly borrowAtomic: string }> {
  const values = exactDataArray(
    value,
    request.accountReads.length,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (values.length !== request.accountReads.length) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const results = new Map<string, string>();
  for (const [index, candidate] of values.entries()) {
    const record = exactDataRecord(
      candidate,
      ACCOUNT_RESULT_KEYS,
      'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
      true,
    );
    const expected = request.accountReads[index];
    if (
      expected === undefined ||
      record.operationId !== expected.operationId ||
      results.has(expected.operationId) ||
      record.positionKind !== expected.positionKind ||
      record.method !== 'eth_call' ||
      record.to !== expected.to ||
      record.data !== expected.data ||
      record.from !== expected.from
    ) {
      return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    eip1898BlockParameter(record.blockParameter, selectedBlockHash);
    results.set(expected.operationId, abiUint(record.result).toString(10));
  }
  const supplyAtomic = results.get('usdc-supply');
  const borrowAtomic = results.get('usdc-borrow');
  if (
    supplyAtomic === undefined ||
    borrowAtomic === undefined ||
    (supplyAtomic !== '0' && borrowAtomic !== '0')
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({ supplyAtomic, borrowAtomic });
}

function parseTranscript(
  capability: unknown,
  request: ReviewedRequest,
  context: ReviewedContext,
  issuedRequest: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
  manifestFingerprintSha256: string,
): ParsedTranscript {
  assertBoundedPlainData(capability, MAX_TRANSCRIPT_BYTES);
  const record = exactDataRecord(
    capability,
    TRANSCRIPT_CAPABILITY_KEYS,
    'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.transcriptVersion !== COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION ||
    record.use !== COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.maySign !== false ||
    record.mayAccessWalletPrivateKey !== false ||
    record.walletAddress !== context.walletAddress ||
    record.manifestFingerprintSha256 !== manifestFingerprintSha256 ||
    record.chainIdBefore !== EXPECTED_CHAIN_ID ||
    record.chainIdAfter !== EXPECTED_CHAIN_ID ||
    record.status !== 'COMPLETE' ||
    record.zeroPositionSemantics !== 'EXACT_ZERO_RESULT_FOR_BOTH_COMET_BASE_BALANCE_CALLS'
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  assertBoundIdentity(record, request, 'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  const selectedBefore = parsedBlockRead(record.selectedBlockBefore, BLOCK_SELECTOR);
  const floorSelector = decimalToHex(context.continuityFloor.blockNumber);
  const floorBefore = parsedBlockRead(record.floorBlockBefore, floorSelector);
  const floorAfter = parsedBlockRead(record.floorBlockAfter, floorSelector);
  const selectedAfter = parsedBlockRead(record.selectedBlockAfter, selectedBefore.numberHex);
  if (
    !sameHeader(selectedBefore, selectedAfter) ||
    !sameHeader(floorBefore, floorAfter) ||
    floorBefore.numberDecimal !== context.continuityFloor.blockNumber ||
    floorBefore.hash !== context.continuityFloor.blockHash ||
    BigInt(selectedBefore.numberDecimal) < BigInt(floorBefore.numberDecimal) ||
    (selectedBefore.numberDecimal === floorBefore.numberDecimal &&
      selectedBefore.hash !== floorBefore.hash)
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  matchCodeReads(record.codeReads, issuedRequest, selectedBefore.hash);
  matchIdentityReads(record.identityReads, issuedRequest, selectedBefore.hash);
  const balances = matchAccountReads(record.accountReads, issuedRequest, selectedBefore.hash);
  return Object.freeze({ selectedBlock: selectedBefore, ...balances });
}

function validateSelectedBlockAge(
  block: Header,
  observedAt: CanonicalTime,
  manifest: CompoundIIIUSDCFinalizedManifest,
): void {
  const policy = chainObservationPolicyForNetwork(NETWORK_ID);
  if (
    policy?.environment !== 'MAINNET' ||
    policy.identityProbe.expectedResult !== EXPECTED_CHAIN_ID ||
    policy.monotonicReadConstraint !== 'PIN_BLOCK_NUMBER_AND_HASH'
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const blockMillisecondsBigInt = block.timestampSeconds * 1_000n;
  if (blockMillisecondsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const blockMilliseconds = Number(blockMillisecondsBigInt);
  const maximumAge = Math.min(
    Number(BigInt(manifest.maximumBlockAgeSeconds) * 1_000n),
    policy.freshness.unavailableAfterMs,
  );
  if (
    blockMilliseconds > observedAt.milliseconds ||
    observedAt.milliseconds - blockMilliseconds >= maximumAge
  ) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function staleAfter(observedAt: CanonicalTime, deadlineAt: CanonicalTime): string {
  const policy = chainObservationPolicyForNetwork(NETWORK_ID);
  if (policy === undefined) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const milliseconds = Math.min(
    observedAt.milliseconds + policy.freshness.currentWithinMs,
    deadlineAt.milliseconds,
  );
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= observedAt.milliseconds) {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  try {
    return Reflect.apply(DATE_TO_ISO_STRING, new Date(milliseconds), []) as string;
  } catch {
    return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
}

function position(
  kind: 'SUPPLY' | 'BORROW',
  atomic: string,
  request: ReviewedRequest,
): ProviderPositionAdmissionPositionV1 {
  return frozenNullPrototype({
    positionId: `${PROTOCOL_ID}-${request.walletId}-usdc-${kind.toLowerCase()}`,
    positionKind: kind,
    asset: request.asset,
    balance: frozenNullPrototype({
      atomic,
      decimal: mainnetProviderPositionDecimalFromAtomic(atomic, request.asset.decimals),
    }),
  });
}

function evidence(
  transcript: ParsedTranscript,
  request: ReviewedRequest,
  context: ReviewedContext,
  observedAt: CanonicalTime,
): ProviderPositionAdmissionSourceEvidenceV1 {
  const positions: ProviderPositionAdmissionPositionV1[] = [];
  if (transcript.supplyAtomic !== '0') {
    positions.push(position('SUPPLY', transcript.supplyAtomic, request));
  }
  if (transcript.borrowAtomic !== '0') {
    positions.push(position('BORROW', transcript.borrowAtomic, request));
  }
  return frozenNullPrototype({
    evidenceVersion: PROVIDER_POSITION_ADMISSION_VERSION,
    use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
    mayAuthorizeFinancialAction: false as const,
    accountId: request.accountId,
    correlationId: request.correlationId,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: 'RPC' as const,
    sourceObservationId: `ethereum-block-${transcript.selectedBlock.numberDecimal}`,
    walletId: request.walletId,
    providerId: PROVIDER_ID,
    protocolId: PROTOCOL_ID,
    marketId: MARKET_ID,
    networkId: NETWORK_ID,
    assets: Object.freeze([request.asset]),
    status: 'COMPLETE' as const,
    observedAt: observedAt.timestamp,
    staleAfter: staleAfter(observedAt, request.deadlineAt),
    continuityFloor: context.continuityFloor,
    chainAnchor: frozenNullPrototype({
      kind: 'EVM_BLOCK' as const,
      blockNumber: transcript.selectedBlock.numberDecimal,
      blockHash: transcript.selectedBlock.hash,
    }),
    positions: Object.freeze(positions),
  });
}

/**
 * Dormant, provider-specific Compound III Ethereum USDC account source. It is
 * intentionally not registered or exported through a runtime module and owns
 * no endpoint, credential, database handle, timer, signer, persistence path,
 * collateral interpretation, yield calculation, or financial authority.
 */
export class DormantCompoundIIIEthereumProviderPositionSource implements ProviderPositionAdmissionSourcePort {
  readonly #manifest!: CompoundIIIUSDCFinalizedManifest;
  readonly #manifestFingerprintSha256!: string;
  readonly #contextReader!: CapturedContextReader;
  readonly #transcriptReader!: CapturedTranscriptReader;
  readonly #now!: CapturedMethod;

  constructor(
    manifestValue: unknown,
    requiredManifestFingerprintSha256: unknown,
    contextReaderValue: CompoundIIIEthereumDurableTargetContextReaderPort,
    transcriptReaderValue: CompoundIIIEthereumFinalizedPositionTranscriptPort,
    clockValue: CompoundIIIEthereumProviderPositionSourceClock,
  ) {
    try {
      if (typeof manifestValue !== 'object' || manifestValue === null || isProxy(manifestValue)) {
        return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
      this.#manifest = parseCompoundIIIUSDCFinalizedManifest(manifestValue);
      this.#manifestFingerprintSha256 = compoundIIIUSDCManifestFingerprintSha256(this.#manifest);
      if (
        typeof requiredManifestFingerprintSha256 !== 'string' ||
        !SHA256.test(requiredManifestFingerprintSha256) ||
        requiredManifestFingerprintSha256 === ZERO_SHA256 ||
        requiredManifestFingerprintSha256 !== this.#manifestFingerprintSha256
      ) {
        return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
      this.#contextReader = capturedContextReader(contextReaderValue);
      this.#transcriptReader = capturedTranscriptReader(transcriptReaderValue);
      this.#now = capturedClock(clockValue);
      if (
        this.#contextReader.receiver === this.#transcriptReader.receiver ||
        this.#contextReader.sourceFamilyId === this.#transcriptReader.sourceFamilyId ||
        this.#contextReader.sourceId === this.#transcriptReader.sourceId
      ) {
        return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
    } catch (error) {
      if (error instanceof DormantCompoundIIIEthereumProviderPositionSourceError) throw error;
      return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
    }
  }

  async readTarget(
    requestValue: ReadProviderPositionAdmissionTargetRequestV1,
  ): Promise<ProviderPositionAdmissionSourceEvidenceV1> {
    try {
      const startedAt = clockTime(this.#now);
      const request = reviewedRequest(
        requestValue,
        startedAt,
        this.#manifest,
        this.#transcriptReader,
      );
      const issuedContextRequest = contextRequest(request);
      const contextCapability = await invoke(this.#contextReader.read, [issuedContextRequest]);
      const contextSettledAt = clockTime(this.#now);
      assertActive(request, contextSettledAt, startedAt);
      if (
        invoke(this.#contextReader.review, [contextCapability, issuedContextRequest]) !==
        contextCapability
      ) {
        return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      const context = reviewedContext(contextCapability, request, this.#contextReader);
      const issuedTranscriptRequest = transcriptRequest(
        request,
        issuedContextRequest,
        context,
        this.#manifest,
        this.#manifestFingerprintSha256,
      );
      const transcriptCapability = await invoke(this.#transcriptReader.read, [
        issuedTranscriptRequest,
      ]);
      const transcriptSettledAt = clockTime(this.#now);
      assertActive(request, transcriptSettledAt, contextSettledAt);
      if (
        invoke(this.#transcriptReader.review, [transcriptCapability, issuedTranscriptRequest]) !==
          transcriptCapability ||
        invoke(this.#contextReader.review, [contextCapability, issuedContextRequest]) !==
          contextCapability
      ) {
        return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      const transcript = parseTranscript(
        transcriptCapability,
        request,
        context,
        issuedTranscriptRequest,
        this.#manifestFingerprintSha256,
      );
      const completedAt = clockTime(this.#now);
      assertActive(request, completedAt, transcriptSettledAt);
      validateSelectedBlockAge(transcript.selectedBlock, completedAt, this.#manifest);
      return evidence(transcript, request, context, completedAt);
    } catch (error) {
      if (error instanceof DormantCompoundIIIEthereumProviderPositionSourceError) throw error;
      return fail('COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
  }
}
