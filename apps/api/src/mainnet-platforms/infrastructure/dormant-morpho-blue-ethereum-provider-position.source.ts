import { Buffer } from 'node:buffer';
import { isProxy } from 'node:util/types';

import { keccak256, type Hex } from 'viem';

import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import {
  createMorphoBlueEthereumMarketManifest,
  MORPHO_BLUE_ETHEREUM_ADDRESS,
  MORPHO_BLUE_ID_TO_MARKET_PARAMS_SELECTOR,
  MORPHO_BLUE_IS_IRM_ENABLED_SELECTOR,
  MORPHO_BLUE_IS_LLTV_ENABLED_SELECTOR,
  MORPHO_BLUE_MARKET_SELECTOR,
  type MorphoBlueEthereumMarketManifest,
} from '../../smart-lending/infrastructure/morpho/morpho-blue-ethereum-finalized-transcript.adapter';
import {
  evaluateMorphoBlueAccountPositionSnapshot,
  MORPHO_BLUE_ACCOUNT_POSITION_ABI,
  MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
  MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE,
  MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION,
  type DormantMorphoBlueAccountPositionProjectionV1,
} from '../../smart-lending/infrastructure/morpho/morpho-blue-account-position.semantics';
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

export const MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION = 1 as const;
export const MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_USE =
  'DORMANT_MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_ONLY' as const;
export const MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION = 1 as const;
export const MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE =
  'DORMANT_MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_ONLY' as const;

const NETWORK_ID = 'eip155:1' as const;
const PROVIDER_ID = 'morpho' as const;
const PROTOCOL_ID = 'morpho-blue' as const;
const EXPECTED_CHAIN_ID = '0x1' as const;
const BLOCK_SELECTOR = 'finalized' as const;
const BLOCK_BINDING = 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const;
const FEE_RECIPIENT_SELECTOR = MORPHO_BLUE_ACCOUNT_POSITION_ABI.feeRecipient.selector;
const POSITION_SELECTOR = MORPHO_BLUE_ACCOUNT_POSITION_ABI.position.selector;
const BORROW_RATE_VIEW_SELECTOR = MORPHO_BLUE_ACCOUNT_POSITION_ABI.borrowRateView.selector;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const MAX_CONTEXT_BYTES = 16 * 1024;
const MAX_TRANSCRIPT_BYTES = 512 * 1024;
const MAX_DATA_NODES = 1_024;
const MAX_DATA_DEPTH = 16;
const MAX_STRING_BYTES = 196 * 1024;
const MAX_CODE_BYTES = 65_536;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_FEE_WAD = 250_000_000_000_000_000n;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO_BLOCK_HASH = `0x${'0'.repeat(64)}`;
const ZERO_SHA256 = '0'.repeat(64);

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
  'mayCreatePositionSnapshot',
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
  'semanticsFingerprintSha256',
  'chainIdBefore',
  'chainIdAfter',
  'selectedBlockBefore',
  'floorBlockBefore',
  'codeReads',
  'stateReads',
  'borrowRateRead',
  'floorBlockAfter',
  'selectedBlockAfter',
  'status',
  'coverageScope',
  'authorizationTraversal',
  'indirectExposureIncluded',
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

export interface ReadMorphoBlueEthereumDurableTargetContextRequestV1 {
  readonly contextVersion: typeof MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_USE;
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
  readonly marketId: string;
  readonly networkId: typeof NETWORK_ID;
}

export interface MorphoBlueEthereumDurableTargetContextCapabilityV1 {
  readonly contextVersion: typeof MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_USE;
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
  readonly marketId: string;
  readonly networkId: typeof NETWORK_ID;
  readonly contextSourceFamilyId: string;
  readonly contextSourceId: string;
  readonly walletAddress: string;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
}

/**
 * Authenticated durable lookup for the exact already-authorized public wallet
 * and independently retained chain floor. It grants no signer, key, network,
 * persistence, or financial authority.
 */
export interface MorphoBlueEthereumDurableTargetContextReaderPort {
  readonly contextVersion: typeof MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readContext(request: ReadMorphoBlueEthereumDurableTargetContextRequestV1): Promise<unknown>;
  reviewContext(
    capability: unknown,
    request: ReadMorphoBlueEthereumDurableTargetContextRequestV1,
  ): unknown | null;
}

export type MorphoBlueEthereumCodeOperationId =
  'morpho-code' | 'loan-token-code' | 'collateral-token-code' | 'oracle-code' | 'irm-code';

export interface MorphoBlueEthereumCodeReadV1 {
  readonly operationId: MorphoBlueEthereumCodeOperationId;
  readonly address: string;
  readonly expectedRuntimeCodeKeccak256: string;
}

export type MorphoBlueEthereumStateOperationId =
  | 'market-params'
  | 'market-state'
  | 'fee-recipient'
  | 'irm-enabled'
  | 'lltv-enabled'
  | 'wallet-position';

export interface MorphoBlueEthereumStateReadV1 {
  readonly operationId: MorphoBlueEthereumStateOperationId;
  readonly to: string;
  readonly data: string;
  readonly from: null;
}

export interface MorphoBlueEthereumBorrowRateReadPolicyV1 {
  readonly operationId: 'borrow-rate-view';
  readonly to: string;
  readonly selector: typeof BORROW_RATE_VIEW_SELECTOR;
  readonly from: null;
  readonly condition: 'ELAPSED_NONZERO_AND_TOTAL_BORROW_ASSETS_NONZERO_AND_MANIFEST_IRM_NONZERO';
  readonly arguments: 'EXACT_MANIFEST_MARKET_PARAMS_AND_SAME_BLOCK_RAW_MARKET_TUPLE';
}

export interface ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1 {
  readonly transcriptVersion: typeof MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly use: typeof MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly maySign: false;
  readonly mayAccessWalletPrivateKey: false;
  readonly admissionRequest: ReadProviderPositionAdmissionTargetRequestV1;
  readonly contextRequest: ReadMorphoBlueEthereumDurableTargetContextRequestV1;
  readonly contextCapability: MorphoBlueEthereumDurableTargetContextCapabilityV1;
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
  readonly marketId: string;
  readonly networkId: typeof NETWORK_ID;
  readonly walletAddress: string;
  readonly expectedChainId: typeof EXPECTED_CHAIN_ID;
  readonly blockSelector: typeof BLOCK_SELECTOR;
  readonly blockBinding: typeof BLOCK_BINDING;
  readonly floorBlockSelector: string;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
  readonly manifest: MorphoBlueEthereumMarketManifest;
  readonly manifestFingerprintSha256: string;
  readonly semanticsFingerprintSha256: string;
  readonly codeReads: readonly MorphoBlueEthereumCodeReadV1[];
  readonly stateReads: readonly MorphoBlueEthereumStateReadV1[];
  readonly borrowRateReadPolicy: MorphoBlueEthereumBorrowRateReadPolicyV1;
  readonly executionOrder: readonly string[];
  readonly maximumResponseBytes: typeof MAX_TRANSCRIPT_BYTES;
}

/**
 * Endpoint-free authenticated transcript boundary. An implementation must run
 * the exact ordered plan, bind its immutable capability to this exact request
 * object, use the selected EIP-1898 block for every code/state/rate read, and
 * drain all started work before rejecting on cancellation. No endpoint or
 * credential crosses this interface.
 */
export interface MorphoBlueEthereumFinalizedPositionTranscriptPort {
  readonly transcriptVersion: typeof MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readTranscript(
    request: ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1,
  ): Promise<unknown>;
  reviewTranscript(
    capability: unknown,
    request: ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1,
  ): unknown | null;
}

export interface MorphoBlueEthereumProviderPositionSourceClock {
  now(): Date;
}

export type DormantMorphoBlueEthereumProviderPositionSourceFailureCode =
  | 'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION'
  | 'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST'
  | 'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE';

export class DormantMorphoBlueEthereumProviderPositionSourceError extends Error {
  constructor(readonly code: DormantMorphoBlueEthereumProviderPositionSourceFailureCode) {
    super('Morpho Blue Ethereum provider-position source is unavailable.');
    this.name = 'DormantMorphoBlueEthereumProviderPositionSourceError';
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
  readonly marketId: string;
  readonly asset: ProviderPositionAdmissionAssetV1;
}

interface ReviewedContext {
  readonly capability: MorphoBlueEthereumDurableTargetContextCapabilityV1;
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

interface RawMarketState {
  readonly totalSupplyAssets: string;
  readonly totalSupplyShares: string;
  readonly totalBorrowAssets: string;
  readonly totalBorrowShares: string;
  readonly lastUpdate: string;
  readonly feeWad: string;
}

interface ParsedTranscript {
  readonly selectedBlock: Header;
  readonly projection: DormantMorphoBlueAccountPositionProjectionV1;
}

function fail(code: DormantMorphoBlueEthereumProviderPositionSourceFailureCode): never {
  throw new DormantMorphoBlueEthereumProviderPositionSourceError(code);
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function targetMarketId(manifest: MorphoBlueEthereumMarketManifest): string {
  return `morpho-blue-ethereum-${manifest.market.marketId.slice(2)}`;
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: DormantMorphoBlueEthereumProviderPositionSourceFailureCode,
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
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      output[key] = descriptor.value;
    }
    return output;
  } catch (error) {
    if (error instanceof DormantMorphoBlueEthereumProviderPositionSourceError) throw error;
    return fail(code);
  }
}

function exactDataArray(
  value: unknown,
  maximumLength: number,
  code: DormantMorphoBlueEthereumProviderPositionSourceFailureCode,
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
    const length = descriptors['length'];
    if (
      !length ||
      !('value' in length) ||
      typeof length.value !== 'number' ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximumLength ||
      length.enumerable !== false
    ) {
      return fail(code);
    }
    const indexes = Array.from({ length: length.value }, (_, index) => String(index));
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== indexes.length + 1 ||
      keys.some((key) => typeof key !== 'string' || (key !== 'length' && !indexes.includes(key)))
    ) {
      return fail(code);
    }
    return indexes.map((index) => {
      const descriptor = descriptors[index];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      return descriptor.value;
    });
  } catch (error) {
    if (error instanceof DormantMorphoBlueEthereumProviderPositionSourceError) throw error;
    return fail(code);
  }
}

function assertBoundedImmutableData(value: unknown, maximumBytes: number): void {
  const seen = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) {
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    if (candidate === null || typeof candidate === 'boolean') {
      bytes += 5;
      return;
    }
    if (typeof candidate === 'number') {
      if (!Number.isSafeInteger(candidate)) {
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      bytes += 32;
      return;
    }
    if (typeof candidate === 'string') {
      const length = Buffer.byteLength(candidate, 'utf8');
      if (length > MAX_STRING_BYTES) {
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      bytes += length + 2;
      return;
    }
    if (
      typeof candidate !== 'object' ||
      isProxy(candidate) ||
      seen.has(candidate) ||
      !Object.isFrozen(candidate)
    ) {
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    seen.add(candidate);
    const isArray = Array.isArray(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if (
      (isArray && prototype !== Array.prototype) ||
      (!isArray && prototype !== Object.prototype && prototype !== null)
    ) {
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const keys: string[] = [];
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') {
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      if (isArray && key === 'length') continue;
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      keys.push(key);
      bytes += Buffer.byteLength(key, 'utf8') + 3;
      visit(descriptor.value, depth + 1);
    }
    if (
      isArray &&
      (keys.length !== candidate.length || keys.some((key, index) => key !== String(index)))
    ) {
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    if (bytes > maximumBytes) {
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
  };
  visit(value, 0);
}

function stableDataMember(value: object, key: PropertyKey): unknown {
  try {
    let current: object | null = value;
    while (current !== null) {
      if (isProxy(current)) {
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!('value' in descriptor)) {
          return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
        }
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  } catch (error) {
    if (error instanceof DormantMorphoBlueEthereumProviderPositionSourceError) throw error;
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
}

function objectReceiver(value: unknown): object {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value as object;
}

function capturedMethod(receiver: object, key: string): CapturedMethod {
  const method = stableDataMember(receiver, key);
  if (typeof method !== 'function' || isProxy(method)) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
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
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value;
}

function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !SOURCE_ID.test(value)) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value;
}

function capturedContextReader(value: unknown): CapturedContextReader {
  const receiver = objectReceiver(value);
  if (
    stableDataMember(receiver, 'contextVersion') !==
    MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
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
    MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
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
  code: DormantMorphoBlueEthereumProviderPositionSourceFailureCode,
): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) return fail(code);
  let canonical: string;
  try {
    canonical = Reflect.apply(DATE_TO_ISO_STRING, new Date(milliseconds), []) as string;
  } catch {
    return fail(code);
  }
  if (canonical !== value) return fail(code);
  return Object.freeze({ timestamp: value, milliseconds });
}

function clockTime(now: CapturedMethod): CanonicalTime {
  let value: unknown;
  try {
    value = invoke(now, []);
  } catch {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  try {
    if (
      !(value instanceof Date) ||
      Object.getPrototypeOf(value) !== Date.prototype ||
      isProxy(value)
    ) {
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const milliseconds = Reflect.apply(DATE_GET_TIME, value, []) as number;
    if (!Number.isSafeInteger(milliseconds)) {
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    return canonicalTime(
      Reflect.apply(DATE_TO_ISO_STRING, value, []) as string,
      'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    );
  } catch (error) {
    if (error instanceof DormantMorphoBlueEthereumProviderPositionSourceError) throw error;
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function genuineSignal(value: unknown): AbortSignal {
  if (
    typeof value !== 'object' ||
    value === null ||
    isProxy(value) ||
    typeof ABORTED_GETTER !== 'function' ||
    !Object.prototype.isPrototypeOf.call(AbortSignal.prototype, value)
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  try {
    Reflect.apply(ABORTED_GETTER, value, []);
  } catch {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  return value as AbortSignal;
}

function aborted(value: AbortSignal): boolean {
  try {
    return Reflect.apply(ABORTED_GETTER as () => boolean, value, []) as boolean;
  } catch {
    return true;
  }
}

function assertActive(request: ReviewedRequest, now: CanonicalTime, prior: CanonicalTime): void {
  if (
    aborted(request.signal) ||
    now.milliseconds < prior.milliseconds ||
    now.milliseconds >= request.deadlineAt.milliseconds
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function parseAsset(
  value: unknown,
  manifest: MorphoBlueEthereumMarketManifest,
): ProviderPositionAdmissionAssetV1 {
  const record = exactDataRecord(
    value,
    ASSET_KEYS,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    true,
  );
  if (
    record.stablecoin !== manifest.market.loanStablecoin ||
    record.networkId !== NETWORK_ID ||
    record.identity !== manifest.market.loanToken ||
    record.decimals !== 6
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  return frozenNullPrototype({
    stablecoin: manifest.market.loanStablecoin,
    networkId: NETWORK_ID,
    identity: manifest.market.loanToken,
    decimals: 6,
  });
}

function reviewedRequest(
  value: unknown,
  startedAt: CanonicalTime,
  manifest: MorphoBlueEthereumMarketManifest,
  reader: CapturedTranscriptReader,
): ReviewedRequest {
  const record = exactDataRecord(
    value,
    ADMISSION_REQUEST_KEYS,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    true,
  );
  let accountId: AccountId;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  const deadlineAt = canonicalTime(
    record.deadlineAt,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
  );
  const signal = genuineSignal(record.signal);
  const assets = exactDataArray(
    record.assets,
    1,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    true,
  );
  const marketId = targetMarketId(manifest);
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
    record.marketId !== marketId ||
    record.networkId !== NETWORK_ID ||
    assets.length !== 1 ||
    aborted(signal) ||
    deadlineAt.milliseconds <= startedAt.milliseconds ||
    deadlineAt.milliseconds - startedAt.milliseconds > MAX_DEADLINE_MILLISECONDS
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
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
    marketId,
    asset: parseAsset(assets[0], manifest),
  });
}

function contextRequest(
  request: ReviewedRequest,
): ReadMorphoBlueEthereumDurableTargetContextRequestV1 {
  return frozenNullPrototype({
    contextVersion: MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_USE,
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
    marketId: request.marketId,
    networkId: NETWORK_ID,
  });
}

function canonicalInteger(
  value: unknown,
  maximum: bigint,
  code: DormantMorphoBlueEthereumProviderPositionSourceFailureCode,
): string {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) return fail(code);
  try {
    if (BigInt(value) > maximum) return fail(code);
  } catch {
    return fail(code);
  }
  return value;
}

function blockHash(
  value: unknown,
  code: DormantMorphoBlueEthereumProviderPositionSourceFailureCode,
): string {
  if (typeof value !== 'string' || !EVM_BLOCK_HASH.test(value) || value === ZERO_BLOCK_HASH) {
    return fail(code);
  }
  return value;
}

function evmAnchor(
  value: unknown,
  code: DormantMorphoBlueEthereumProviderPositionSourceFailureCode,
): ProviderPositionAdmissionEvmAnchorV1 {
  const record = exactDataRecord(value, ['kind', 'blockNumber', 'blockHash'], code, true);
  if (record.kind !== 'EVM_BLOCK') return fail(code);
  return frozenNullPrototype({
    kind: 'EVM_BLOCK' as const,
    blockNumber: canonicalInteger(record.blockNumber, MAX_UINT256, code),
    blockHash: blockHash(record.blockHash, code),
  });
}

function assertBoundIdentity(
  record: Record<string, unknown>,
  request: ReviewedRequest,
  code: DormantMorphoBlueEthereumProviderPositionSourceFailureCode,
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
    record.marketId !== request.marketId ||
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
  assertBoundedImmutableData(capability, MAX_CONTEXT_BYTES);
  const record = exactDataRecord(
    capability,
    CONTEXT_CAPABILITY_KEYS,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.contextVersion !== MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION ||
    record.use !== MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.maySign !== false ||
    record.mayAccessWalletPrivateKey !== false ||
    record.contextSourceFamilyId !== reader.sourceFamilyId ||
    record.contextSourceId !== reader.sourceId
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  assertBoundIdentity(record, request, 'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  let walletAddress: string;
  try {
    walletAddress = parseEvmWalletAddress(record.walletAddress);
  } catch {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    capability: capability as MorphoBlueEthereumDurableTargetContextCapabilityV1,
    walletAddress,
    continuityFloor: evmAnchor(
      record.continuityFloor,
      'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  });
}

function addressWord(value: string): string {
  return `${'0'.repeat(24)}${value.slice(2)}`;
}

function uintWord(value: bigint): string {
  if (value < 0n || value > MAX_UINT256) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value.toString(16).padStart(64, '0');
}

function staticStateReads(
  manifest: MorphoBlueEthereumMarketManifest,
  walletAddress: string,
): readonly MorphoBlueEthereumStateReadV1[] {
  const market = manifest.market;
  return Object.freeze(
    [
      {
        operationId: 'market-params' as const,
        to: MORPHO_BLUE_ETHEREUM_ADDRESS,
        data: `${MORPHO_BLUE_ID_TO_MARKET_PARAMS_SELECTOR}${market.marketId.slice(2)}`,
        from: null,
      },
      {
        operationId: 'market-state' as const,
        to: MORPHO_BLUE_ETHEREUM_ADDRESS,
        data: `${MORPHO_BLUE_MARKET_SELECTOR}${market.marketId.slice(2)}`,
        from: null,
      },
      {
        operationId: 'fee-recipient' as const,
        to: MORPHO_BLUE_ETHEREUM_ADDRESS,
        data: FEE_RECIPIENT_SELECTOR,
        from: null,
      },
      {
        operationId: 'irm-enabled' as const,
        to: MORPHO_BLUE_ETHEREUM_ADDRESS,
        data: `${MORPHO_BLUE_IS_IRM_ENABLED_SELECTOR}${addressWord(market.irm)}`,
        from: null,
      },
      {
        operationId: 'lltv-enabled' as const,
        to: MORPHO_BLUE_ETHEREUM_ADDRESS,
        data: `${MORPHO_BLUE_IS_LLTV_ENABLED_SELECTOR}${uintWord(BigInt(market.lltv))}`,
        from: null,
      },
      {
        operationId: 'wallet-position' as const,
        to: MORPHO_BLUE_ETHEREUM_ADDRESS,
        data: `${POSITION_SELECTOR}${market.marketId.slice(2)}${addressWord(walletAddress)}`,
        from: null,
      },
    ].map((value) => frozenNullPrototype(value)),
  );
}

function codeReads(
  manifest: MorphoBlueEthereumMarketManifest,
): readonly MorphoBlueEthereumCodeReadV1[] {
  return Object.freeze(
    [
      {
        operationId: 'morpho-code' as const,
        address: manifest.deployment.morphoAddress,
        expectedRuntimeCodeKeccak256: manifest.deployment.morphoRuntimeCodeKeccak256,
      },
      {
        operationId: 'loan-token-code' as const,
        address: manifest.market.loanToken,
        expectedRuntimeCodeKeccak256: manifest.market.loanTokenRuntimeCodeKeccak256,
      },
      {
        operationId: 'collateral-token-code' as const,
        address: manifest.market.collateralToken,
        expectedRuntimeCodeKeccak256: manifest.market.collateralTokenRuntimeCodeKeccak256,
      },
      {
        operationId: 'oracle-code' as const,
        address: manifest.market.oracle,
        expectedRuntimeCodeKeccak256: manifest.market.oracleRuntimeCodeKeccak256,
      },
      {
        operationId: 'irm-code' as const,
        address: manifest.market.irm,
        expectedRuntimeCodeKeccak256: manifest.market.irmRuntimeCodeKeccak256,
      },
    ].map((value) => frozenNullPrototype(value)),
  );
}

function transcriptRequest(
  request: ReviewedRequest,
  contextRequestValue: ReadMorphoBlueEthereumDurableTargetContextRequestV1,
  context: ReviewedContext,
  manifest: MorphoBlueEthereumMarketManifest,
): ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1 {
  const reads = staticStateReads(manifest, context.walletAddress);
  return frozenNullPrototype({
    transcriptVersion: MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    mayCreatePositionSnapshot: false as const,
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
    marketId: request.marketId,
    networkId: NETWORK_ID,
    walletAddress: context.walletAddress,
    expectedChainId: EXPECTED_CHAIN_ID,
    blockSelector: BLOCK_SELECTOR,
    blockBinding: BLOCK_BINDING,
    floorBlockSelector: `0x${BigInt(context.continuityFloor.blockNumber).toString(16)}`,
    continuityFloor: context.continuityFloor,
    manifest,
    manifestFingerprintSha256: manifest.manifestFingerprintSha256,
    semanticsFingerprintSha256: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    codeReads: codeReads(manifest),
    stateReads: reads,
    borrowRateReadPolicy: frozenNullPrototype({
      operationId: 'borrow-rate-view' as const,
      to: manifest.market.irm,
      selector: BORROW_RATE_VIEW_SELECTOR,
      from: null,
      condition:
        'ELAPSED_NONZERO_AND_TOTAL_BORROW_ASSETS_NONZERO_AND_MANIFEST_IRM_NONZERO' as const,
      arguments: 'EXACT_MANIFEST_MARKET_PARAMS_AND_SAME_BLOCK_RAW_MARKET_TUPLE' as const,
    }),
    executionOrder: Object.freeze([
      'chain-id-before',
      'selected-block-before',
      'floor-block-before',
      ...codeReads(manifest).map((read) => read.operationId),
      ...reads.map((read) => read.operationId),
      'borrow-rate-view-if-required',
      'floor-block-after',
      'selected-block-after',
      'chain-id-after',
    ]),
    maximumResponseBytes: MAX_TRANSCRIPT_BYTES,
  });
}

function hexQuantity(value: unknown): Readonly<{ hex: string; decimal: string }> {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value) || value.length > 66) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({ hex: value, decimal: parsed.toString(10) });
}

function parsedHeader(value: unknown): Header {
  const record = exactDataRecord(
    value,
    HEADER_KEYS,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  const number = hexQuantity(record.number);
  const timestamp = hexQuantity(record.timestamp);
  const hash = blockHash(record.hash, 'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  const parentHash = blockHash(
    record.parentHash,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
  );
  const stateRoot = blockHash(record.stateRoot, 'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  if (number.decimal === '0' || timestamp.decimal === '0' || hash === parentHash) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
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
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.method !== 'eth_getBlockByNumber' ||
    record.selector !== expectedSelector ||
    record.includeTransactions !== false
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
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
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (record.blockHash !== selectedBlockHash || record.requireCanonical !== true) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function runtimeCode(value: unknown, expectedKeccak256: string): void {
  if (
    typeof value !== 'string' ||
    !HEX_DATA.test(value) ||
    value === '0x' ||
    (value.length - 2) / 2 > MAX_CODE_BYTES
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  let actual: string;
  try {
    actual = keccak256(value as Hex);
  } catch {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  if (actual !== expectedKeccak256) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function matchCodeReads(
  value: unknown,
  request: ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1,
  selectedBlockHash: string,
): void {
  const values = exactDataArray(
    value,
    request.codeReads.length,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (values.length !== request.codeReads.length) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  for (const [index, candidate] of values.entries()) {
    const record = exactDataRecord(
      candidate,
      CODE_RESULT_KEYS,
      'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
      true,
    );
    const expected = request.codeReads[index];
    if (
      expected === undefined ||
      record.operationId !== expected.operationId ||
      record.method !== 'eth_getCode' ||
      record.address !== expected.address
    ) {
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    eip1898BlockParameter(record.blockParameter, selectedBlockHash);
    runtimeCode(record.result, expected.expectedRuntimeCodeKeccak256);
  }
}

function abiWords(value: unknown, count: number): readonly bigint[] {
  if (
    typeof value !== 'string' ||
    value.length !== 2 + count * 64 ||
    !/^0x[0-9a-f]+$/u.test(value)
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const output: bigint[] = [];
  for (let index = 0; index < count; index += 1) {
    output.push(BigInt(`0x${value.slice(2 + index * 64, 2 + (index + 1) * 64)}`));
  }
  return Object.freeze(output);
}

function abiAddress(value: unknown, allowZero: boolean): string {
  if (typeof value !== 'string' || !ABI_WORD.test(value) || !/^0x0{24}/u.test(value)) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const address = `0x${value.slice(-40)}`;
  if (!EVM_ADDRESS.test(address) || (!allowZero && address === ZERO_ADDRESS)) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return address;
}

function abiBoolean(value: unknown): boolean {
  if (value === `0x${'0'.repeat(64)}`) return false;
  if (value === `0x${'0'.repeat(63)}1`) return true;
  return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
}

function exactCallResult(
  candidate: unknown,
  expected: MorphoBlueEthereumStateReadV1,
  selectedBlockHash: string,
): unknown {
  const record = exactDataRecord(
    candidate,
    CALL_RESULT_KEYS,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.operationId !== expected.operationId ||
    record.method !== 'eth_call' ||
    record.to !== expected.to ||
    record.data !== expected.data ||
    record.from !== expected.from
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  eip1898BlockParameter(record.blockParameter, selectedBlockHash);
  return record.result;
}

function decodeMarketParams(value: unknown, manifest: MorphoBlueEthereumMarketManifest): void {
  if (typeof value !== 'string' || value.length !== 2 + 5 * 64) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const words = Array.from(
    { length: 5 },
    (_, index) => `0x${value.slice(2 + index * 64, 2 + (index + 1) * 64)}`,
  );
  if (
    abiAddress(words[0], false) !== manifest.market.loanToken ||
    abiAddress(words[1], false) !== manifest.market.collateralToken ||
    abiAddress(words[2], false) !== manifest.market.oracle ||
    abiAddress(words[3], false) !== manifest.market.irm ||
    abiWords(words[4], 1)[0] !== BigInt(manifest.market.lltv)
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function decodeMarketState(value: unknown): RawMarketState {
  const words = abiWords(value, 6);
  if (words.some((word) => word > MAX_UINT128)) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const fee = words[5];
  if (fee === undefined || fee > MAX_FEE_WAD) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    totalSupplyAssets: (words[0] as bigint).toString(10),
    totalSupplyShares: (words[1] as bigint).toString(10),
    totalBorrowAssets: (words[2] as bigint).toString(10),
    totalBorrowShares: (words[3] as bigint).toString(10),
    lastUpdate: (words[4] as bigint).toString(10),
    feeWad: fee.toString(10),
  });
}

function decodePosition(
  value: unknown,
): Readonly<{ supplyShares: string; borrowShares: string; collateralAtomic: string }> {
  const words = abiWords(value, 3);
  if ((words[1] as bigint) > MAX_UINT128 || (words[2] as bigint) > MAX_UINT128) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    supplyShares: (words[0] as bigint).toString(10),
    borrowShares: (words[1] as bigint).toString(10),
    collateralAtomic: (words[2] as bigint).toString(10),
  });
}

interface ParsedStateReads {
  readonly market: RawMarketState;
  readonly feeRecipientAddress: string;
  readonly position: Readonly<{
    readonly supplyShares: string;
    readonly borrowShares: string;
    readonly collateralAtomic: string;
  }>;
}

function matchStateReads(
  value: unknown,
  request: ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1,
  selectedBlockHash: string,
): ParsedStateReads {
  const values = exactDataArray(
    value,
    request.stateReads.length,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (values.length !== request.stateReads.length) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const results = new Map<MorphoBlueEthereumStateOperationId, unknown>();
  for (const [index, candidate] of values.entries()) {
    const expected = request.stateReads[index];
    if (expected === undefined || results.has(expected.operationId)) {
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    results.set(expected.operationId, exactCallResult(candidate, expected, selectedBlockHash));
  }
  decodeMarketParams(results.get('market-params'), request.manifest);
  if (!abiBoolean(results.get('irm-enabled')) || !abiBoolean(results.get('lltv-enabled'))) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    market: decodeMarketState(results.get('market-state')),
    feeRecipientAddress: abiAddress(results.get('fee-recipient'), true),
    position: decodePosition(results.get('wallet-position')),
  });
}

function rateCallData(manifest: MorphoBlueEthereumMarketManifest, market: RawMarketState): string {
  return `${BORROW_RATE_VIEW_SELECTOR}${[
    addressWord(manifest.market.loanToken),
    addressWord(manifest.market.collateralToken),
    addressWord(manifest.market.oracle),
    addressWord(manifest.market.irm),
    uintWord(BigInt(manifest.market.lltv)),
    uintWord(BigInt(market.totalSupplyAssets)),
    uintWord(BigInt(market.totalSupplyShares)),
    uintWord(BigInt(market.totalBorrowAssets)),
    uintWord(BigInt(market.totalBorrowShares)),
    uintWord(BigInt(market.lastUpdate)),
    uintWord(BigInt(market.feeWad)),
  ].join('')}`;
}

function matchBorrowRateRead(
  value: unknown,
  request: ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1,
  selectedBlock: Header,
  market: RawMarketState,
): string | null {
  const shouldRead =
    selectedBlock.timestampSeconds > BigInt(market.lastUpdate) &&
    BigInt(market.totalBorrowAssets) !== 0n &&
    request.manifest.market.irm !== ZERO_ADDRESS;
  if (!shouldRead) {
    if (value !== null) return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    return null;
  }
  const record = exactDataRecord(
    value,
    CALL_RESULT_KEYS,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.operationId !== request.borrowRateReadPolicy.operationId ||
    record.method !== 'eth_call' ||
    record.to !== request.borrowRateReadPolicy.to ||
    record.data !== rateCallData(request.manifest, market) ||
    record.from !== null
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  eip1898BlockParameter(record.blockParameter, selectedBlock.hash);
  const words = abiWords(record.result, 1);
  return (words[0] as bigint).toString(10);
}

function parseTranscript(
  capability: unknown,
  request: ReviewedRequest,
  context: ReviewedContext,
  issuedRequest: ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1,
): ParsedTranscript {
  assertBoundedImmutableData(capability, MAX_TRANSCRIPT_BYTES);
  const record = exactDataRecord(
    capability,
    TRANSCRIPT_CAPABILITY_KEYS,
    'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.transcriptVersion !== MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION ||
    record.use !== MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.mayCreatePositionSnapshot !== false ||
    record.maySign !== false ||
    record.mayAccessWalletPrivateKey !== false ||
    record.walletAddress !== context.walletAddress ||
    record.manifestFingerprintSha256 !== issuedRequest.manifestFingerprintSha256 ||
    record.semanticsFingerprintSha256 !==
      MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256 ||
    record.chainIdBefore !== EXPECTED_CHAIN_ID ||
    record.chainIdAfter !== EXPECTED_CHAIN_ID ||
    record.status !== 'COMPLETE' ||
    record.coverageScope !== 'EXACT_APPROVED_MARKET_DIRECT_LOAN_ASSET_POSITION_ONLY' ||
    record.authorizationTraversal !== false ||
    record.indirectExposureIncluded !== false ||
    record.zeroPositionSemantics !==
      'EXACT_ZERO_PROJECTED_LOAN_ASSET_SUPPLY_AND_BORROW_FOR_BOUND_WALLET_AND_MARKET'
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  assertBoundIdentity(record, request, 'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  const selectedBefore = parsedBlockRead(record.selectedBlockBefore, BLOCK_SELECTOR);
  const floorSelector = `0x${BigInt(context.continuityFloor.blockNumber).toString(16)}`;
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
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  matchCodeReads(record.codeReads, issuedRequest, selectedBefore.hash);
  const state = matchStateReads(record.stateReads, issuedRequest, selectedBefore.hash);
  const rate = matchBorrowRateRead(
    record.borrowRateRead,
    issuedRequest,
    selectedBefore,
    state.market,
  );
  let projection: DormantMorphoBlueAccountPositionProjectionV1;
  try {
    projection = evaluateMorphoBlueAccountPositionSnapshot(
      Object.freeze({
        semanticsVersion: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION,
        use: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE,
        mayPersist: false as const,
        mayAuthorizeFinancialAction: false as const,
        mayEstablishCompletePosition: false as const,
        walletAddress: context.walletAddress,
        feeRecipientAddress: state.feeRecipientAddress,
        irmAddress: issuedRequest.manifest.market.irm,
        blockTimestamp: selectedBefore.timestampSeconds.toString(10),
        borrowRatePerSecondWad: rate,
        market: Object.freeze({ ...state.market }),
        position: Object.freeze({ ...state.position }),
      }),
    );
  } catch {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({ selectedBlock: selectedBefore, projection });
}

function validateSelectedBlockAge(
  block: Header,
  observedAt: CanonicalTime,
  manifest: MorphoBlueEthereumMarketManifest,
): void {
  const policy = chainObservationPolicyForNetwork(NETWORK_ID);
  if (
    policy?.environment !== 'MAINNET' ||
    policy.identityProbe.expectedResult !== EXPECTED_CHAIN_ID ||
    policy.monotonicReadConstraint !== 'PIN_BLOCK_NUMBER_AND_HASH'
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const blockMillisecondsBigInt = block.timestampSeconds * 1_000n;
  if (blockMillisecondsBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const blockMilliseconds = Number(blockMillisecondsBigInt);
  const maximumAge = Math.min(
    Number(BigInt(manifest.maximumFinalizedBlockAgeSeconds) * 1_000n),
    policy.freshness.unavailableAfterMs,
  );
  if (
    blockMilliseconds > observedAt.milliseconds ||
    observedAt.milliseconds - blockMilliseconds >= maximumAge
  ) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function staleAfter(observedAt: CanonicalTime, deadlineAt: CanonicalTime): string {
  const policy = chainObservationPolicyForNetwork(NETWORK_ID);
  if (policy === undefined) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const milliseconds = Math.min(
    observedAt.milliseconds + policy.freshness.currentWithinMs,
    deadlineAt.milliseconds,
  );
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= observedAt.milliseconds) {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  try {
    return Reflect.apply(DATE_TO_ISO_STRING, new Date(milliseconds), []) as string;
  } catch {
    return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
}

function position(
  kind: 'SUPPLY' | 'BORROW',
  atomic: string,
  request: ReviewedRequest,
): ProviderPositionAdmissionPositionV1 {
  return frozenNullPrototype({
    positionId: `${request.marketId}-${kind.toLowerCase()}`,
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
  const supplyAtomic = transcript.projection.position.supply.assetsAtomic;
  const borrowAtomic = transcript.projection.position.borrow.assetsAtomic;
  if (supplyAtomic !== '0') positions.push(position('SUPPLY', supplyAtomic, request));
  if (borrowAtomic !== '0') positions.push(position('BORROW', borrowAtomic, request));
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
    marketId: request.marketId,
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
 * Dormant exact-market Morpho Blue Ethereum direct-position source. It owns no
 * endpoint, credential, database handle, timer, signer, persistence path,
 * market-discovery claim, MetaMorpho exposure, oracle interpretation, or
 * financial authority. The target covers only the manifest loan asset in one
 * exact approved market; whole-product completeness remains the coordinator's
 * all-target/two-independent-source responsibility. The coordinator's trusted
 * deadline runner owns cancellation timing; each injected port must honor that
 * signal and drain its already-started work before settling.
 */
export class DormantMorphoBlueEthereumProviderPositionSource implements ProviderPositionAdmissionSourcePort {
  readonly #manifest!: MorphoBlueEthereumMarketManifest;
  readonly #contextReader!: CapturedContextReader;
  readonly #transcriptReader!: CapturedTranscriptReader;
  readonly #now!: CapturedMethod;

  constructor(
    manifestValue: unknown,
    requiredManifestFingerprintSha256: unknown,
    requiredSemanticsFingerprintSha256: unknown,
    contextReaderValue: MorphoBlueEthereumDurableTargetContextReaderPort,
    transcriptReaderValue: MorphoBlueEthereumFinalizedPositionTranscriptPort,
    clockValue: MorphoBlueEthereumProviderPositionSourceClock,
  ) {
    try {
      if (typeof manifestValue !== 'object' || manifestValue === null || isProxy(manifestValue)) {
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
      this.#manifest = createMorphoBlueEthereumMarketManifest(manifestValue);
      if (
        typeof requiredManifestFingerprintSha256 !== 'string' ||
        !SHA256.test(requiredManifestFingerprintSha256) ||
        requiredManifestFingerprintSha256 === ZERO_SHA256 ||
        requiredManifestFingerprintSha256 !== this.#manifest.manifestFingerprintSha256 ||
        requiredSemanticsFingerprintSha256 !==
          MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256
      ) {
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
      this.#contextReader = capturedContextReader(contextReaderValue);
      this.#transcriptReader = capturedTranscriptReader(transcriptReaderValue);
      this.#now = capturedClock(clockValue);
      if (
        this.#contextReader.receiver === this.#transcriptReader.receiver ||
        this.#contextReader.sourceFamilyId === this.#transcriptReader.sourceFamilyId ||
        this.#contextReader.sourceId === this.#transcriptReader.sourceId
      ) {
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
    } catch (error) {
      if (error instanceof DormantMorphoBlueEthereumProviderPositionSourceError) throw error;
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
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
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      const context = reviewedContext(contextCapability, request, this.#contextReader);
      const issuedTranscriptRequest = transcriptRequest(
        request,
        issuedContextRequest,
        context,
        this.#manifest,
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
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      const transcript = parseTranscript(
        transcriptCapability,
        request,
        context,
        issuedTranscriptRequest,
      );
      const completedAt = clockTime(this.#now);
      assertActive(request, completedAt, transcriptSettledAt);
      validateSelectedBlockAge(transcript.selectedBlock, completedAt, this.#manifest);
      if (
        invoke(this.#transcriptReader.review, [transcriptCapability, issuedTranscriptRequest]) !==
          transcriptCapability ||
        invoke(this.#contextReader.review, [contextCapability, issuedContextRequest]) !==
          contextCapability
      ) {
        return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      return evidence(transcript, request, context, completedAt);
    } catch (error) {
      if (error instanceof DormantMorphoBlueEthereumProviderPositionSourceError) throw error;
      return fail('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
  }
}
