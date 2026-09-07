import { Buffer } from 'node:buffer';
import { isProxy } from 'node:util/types';

import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import {
  deriveEulerV2EvcAccountCandidates,
  EULER_V2_ACCOUNT_POSITION_ABI,
  EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
  projectEulerV2DebtExactToAssetsUp,
  type EulerV2EvcAccountCandidate,
} from '../../smart-lending/infrastructure/euler/euler-v2-account-position.semantics';
import {
  createEulerV2EthereumVaultManifest,
  type DormantEulerV2EthereumVaultTranscriptCandidate,
  type EulerV2EthereumVaultManifest,
  type ReadEulerV2EthereumVaultTranscriptRequest,
} from '../../smart-lending/infrastructure/euler/euler-v2-ethereum-finalized-transcript.adapter';
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

export const EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION = 1 as const;
export const EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_USE =
  'DORMANT_EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_ONLY' as const;
export const EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION = 1 as const;
export const EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE =
  'DORMANT_EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_ONLY' as const;

const NETWORK_ID = 'eip155:1' as const;
const PROVIDER_ID = 'euler' as const;
const PROTOCOL_ID = 'euler-v2' as const;
const EXPECTED_CHAIN_ID = '0x1' as const;
const BLOCK_BINDING = 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const MAX_CONTEXT_BYTES = 16 * 1024;
const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_DATA_NODES = 32_768;
const MAX_DATA_DEPTH = 16;
const MAX_STRING_BYTES = 256 * 1024;
const EXPECTED_EVC_ACCOUNTS = 256;
const VIRTUAL_DEPOSIT_ATOMIC = 1_000_000n;
const MAX_UINT16 = (1n << 16n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT112 = (1n << 112n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const ZERO_SHA256 = '0'.repeat(64);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const SOURCE_FAMILY_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SOURCE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ABI_WORD = /^0x[0-9a-f]{64}$/u;

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
const CONTEXT_KEYS = Object.freeze([
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
const TRANSCRIPT_KEYS = Object.freeze([
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
  'blockBinding',
  'vaultTranscript',
  'selectedBlockAfter',
  'floorBlockBefore',
  'floorBlockAfter',
  'walletOwnerGate',
  'accounts',
  'executionOrder',
  'status',
  'coverageScope',
  'operatorTraversal',
  'indirectExposureIncluded',
  'zeroPositionSemantics',
] as const);
const VAULT_TRANSCRIPT_KEYS = Object.freeze([
  'schemaVersion',
  'sourceId',
  'use',
  'providerId',
  'protocolId',
  'networkId',
  'marketId',
  'manifestFingerprintSha256',
  'transcriptFingerprintSha256',
  'observedAt',
  'staleAfter',
  'sourcePosition',
  'sourceFinality',
  'sourceProofStatus',
  'sourceAuthenticity',
  'freshnessStatus',
  'yieldEvidenceStatus',
  'liquidityEvidenceStatus',
  'persistenceEligibility',
  'mayPersist',
  'mayEstablishRecommendationEligibility',
  'mayAuthorizeFinancialAction',
  'block',
  'deployment',
  'vault',
  'rawState',
  'conversionEvidence',
] as const);
const HEADER_KEYS = Object.freeze([
  'number',
  'hash',
  'parentHash',
  'stateRoot',
  'timestamp',
] as const);
const ACCOUNT_ROW_KEYS = Object.freeze([
  'accountId',
  'accountAddress',
  'balanceOf',
  'convertToAssets',
  'debtOf',
  'debtOfExact',
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

export interface ReadEulerV2EthereumDurableTargetContextRequestV1 {
  readonly contextVersion: typeof EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_USE;
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

export interface EulerV2EthereumDurableTargetContextCapabilityV1 {
  readonly contextVersion: typeof EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_USE;
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

export interface EulerV2EthereumDurableTargetContextReaderPort {
  readonly contextVersion: typeof EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readContext(request: ReadEulerV2EthereumDurableTargetContextRequestV1): Promise<unknown>;
  reviewContext(
    capability: unknown,
    request: ReadEulerV2EthereumDurableTargetContextRequestV1,
  ): unknown | null;
}

export interface EulerV2EthereumCallPlanV1 {
  readonly operationId: string;
  readonly method: 'eth_call';
  readonly to: string;
  readonly data: string;
  readonly from: null;
}

export interface EulerV2EthereumDependentCallPlanV1 {
  readonly operationId: string;
  readonly method: 'eth_call';
  readonly to: string;
  readonly selector: string;
  readonly uint256InputFromOperationId: string;
  readonly from: null;
}

export interface EulerV2EthereumAccountReadPlanV1 {
  readonly accountId: string;
  readonly accountAddress: string;
  readonly balanceOf: EulerV2EthereumCallPlanV1;
  readonly convertToAssets: EulerV2EthereumDependentCallPlanV1;
  readonly debtOf: EulerV2EthereumCallPlanV1;
  readonly debtOfExact: EulerV2EthereumCallPlanV1;
}

export interface EulerV2EthereumBoundaryReadPlanV1 {
  readonly chainIdBefore: Readonly<{
    readonly operationId: 'chain-id-before';
    readonly method: 'eth_chainId';
  }>;
  readonly vaultTranscript: Readonly<{
    readonly operationId: 'vault-transcript';
    readonly adapterSourceId: 'EULER_V2_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT';
  }>;
  readonly floorBlockBefore: Readonly<{
    readonly operationId: 'floor-block-before';
    readonly method: 'eth_getBlockByNumber';
    readonly selector: string;
    readonly includeTransactions: false;
  }>;
  readonly floorBlockAfter: Readonly<{
    readonly operationId: 'floor-block-after';
    readonly method: 'eth_getBlockByNumber';
    readonly selector: string;
    readonly includeTransactions: false;
  }>;
  readonly selectedBlockAfter: Readonly<{
    readonly operationId: 'selected-block-after';
    readonly method: 'eth_getBlockByNumber';
    readonly selectorFrom: 'VAULT_TRANSCRIPT_BLOCK_NUMBER';
    readonly includeTransactions: false;
  }>;
  readonly chainIdAfter: Readonly<{
    readonly operationId: 'chain-id-after';
    readonly method: 'eth_chainId';
  }>;
}

export interface ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1 {
  readonly transcriptVersion: typeof EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly use: typeof EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly mayCreatePositionSnapshot: false;
  readonly maySign: false;
  readonly mayAccessWalletPrivateKey: false;
  readonly admissionRequest: ReadProviderPositionAdmissionTargetRequestV1;
  readonly contextRequest: ReadEulerV2EthereumDurableTargetContextRequestV1;
  readonly contextCapability: EulerV2EthereumDurableTargetContextCapabilityV1;
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
  readonly blockBinding: typeof BLOCK_BINDING;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
  readonly manifest: EulerV2EthereumVaultManifest;
  readonly manifestFingerprintSha256: string;
  readonly semanticsFingerprintSha256: string;
  readonly vaultTranscriptRequest: ReadEulerV2EthereumVaultTranscriptRequest;
  readonly boundaryReadPlan: EulerV2EthereumBoundaryReadPlanV1;
  readonly walletOwnerRead: EulerV2EthereumCallPlanV1;
  readonly accountReadPlans: readonly EulerV2EthereumAccountReadPlanV1[];
  readonly executionOrder: readonly string[];
  readonly maximumResponseBytes: typeof MAX_TRANSCRIPT_BYTES;
}

/**
 * Endpoint-free capability boundary. The implementation must obtain
 * `vaultTranscript` from the existing finalized Euler adapter, execute the
 * issued `boundaryReadPlan`, owner gate, and 1,024 account calls in the exact
 * issued `executionOrder`, then bind every account read and both closeout
 * headers to that candidate's exact EIP-1898 block hash. `reviewTranscript`
 * must brand the combined capability for the exact request object. Because the
 * existing adapter has no cancellation input or brand of its own, only a
 * deadline-aware wrapper that drains its transport may implement this port.
 */
export interface EulerV2EthereumFinalizedPositionTranscriptPort {
  readonly transcriptVersion: typeof EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readTranscript(
    request: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
  ): Promise<unknown>;
  reviewTranscript(
    capability: unknown,
    request: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
  ): unknown | null;
}

export interface EulerV2EthereumProviderPositionSourceClock {
  now(): Date;
}

export type DormantEulerV2EthereumProviderPositionSourceFailureCode =
  | 'EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION'
  | 'EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST'
  | 'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE';

export class DormantEulerV2EthereumProviderPositionSourceError extends Error {
  constructor(readonly code: DormantEulerV2EthereumProviderPositionSourceFailureCode) {
    super('Euler V2 Ethereum provider-position source is unavailable.');
    this.name = 'DormantEulerV2EthereumProviderPositionSourceError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

interface CapturedMethod {
  readonly receiver: object;
  readonly method: (...arguments_: readonly unknown[]) => unknown;
}

interface CapturedReader {
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

interface Header {
  readonly numberHex: string;
  readonly numberDecimal: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly timestampSeconds: bigint;
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
  readonly capability: EulerV2EthereumDurableTargetContextCapabilityV1;
  readonly walletAddress: string;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
}

interface ParsedTranscript {
  readonly block: Header;
  readonly candidateObservedAt: CanonicalTime;
  readonly candidateStaleAfter: CanonicalTime;
  readonly supplyAtomic: string;
  readonly borrowAtomic: string;
}

function fail(code: DormantEulerV2EthereumProviderPositionSourceFailureCode): never {
  throw new DormantEulerV2EthereumProviderPositionSourceError(code);
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: DormantEulerV2EthereumProviderPositionSourceFailureCode,
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
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof DormantEulerV2EthereumProviderPositionSourceError) throw error;
    return fail(code);
  }
}

function exactDataArray(
  value: unknown,
  expectedLength: number,
  code: DormantEulerV2EthereumProviderPositionSourceFailureCode,
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
    if (!length || !('value' in length) || length.value !== expectedLength) return fail(code);
    const indexes = Array.from({ length: expectedLength }, (_, index) => String(index));
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedLength + 1 ||
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
    if (error instanceof DormantEulerV2EthereumProviderPositionSourceError) throw error;
    return fail(code);
  }
}

function assertBoundedImmutableData(value: unknown, maximumBytes: number): void {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    if (typeof candidate === 'string') {
      if (Buffer.byteLength(candidate, 'utf8') > MAX_STRING_BYTES) {
        return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      return;
    }
    if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'number') {
      return;
    }
    if (
      typeof candidate !== 'object' ||
      isProxy(candidate) ||
      seen.has(candidate) ||
      !Object.isFrozen(candidate)
    ) {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    seen.add(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if (
      (Array.isArray(candidate) && prototype !== Array.prototype) ||
      (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null)
    ) {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) {
        return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      if (key !== 'length') visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maximumBytes) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
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

function objectReceiver(value: unknown): object {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value as object;
}

function capturedMethod(receiver: object, key: string): CapturedMethod {
  const method = stableDataMember(receiver, key);
  if (typeof method !== 'function' || isProxy(method)) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
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
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value;
}

function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !SOURCE_ID.test(value)) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value;
}

function capturedReader(
  value: unknown,
  versionKey: string,
  expectedVersion: number,
): CapturedReader {
  const receiver = objectReceiver(value);
  if (stableDataMember(receiver, versionKey) !== expectedVersion) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const isContext = versionKey === 'contextVersion';
  return Object.freeze({
    receiver,
    sourceFamilyId: sourceFamilyId(stableDataMember(receiver, 'sourceFamilyId')),
    sourceId: sourceId(stableDataMember(receiver, 'sourceId')),
    read: capturedMethod(receiver, isContext ? 'readContext' : 'readTranscript'),
    review: capturedMethod(receiver, isContext ? 'reviewContext' : 'reviewTranscript'),
  });
}

function canonicalTime(
  value: unknown,
  code: DormantEulerV2EthereumProviderPositionSourceFailureCode,
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

function clockTime(clock: CapturedMethod): CanonicalTime {
  let value: unknown;
  try {
    value = invoke(clock, []);
    if (
      !(value instanceof Date) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Date.prototype
    ) {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const milliseconds = Reflect.apply(DATE_GET_TIME, value, []) as number;
    if (!Number.isSafeInteger(milliseconds)) {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    return canonicalTime(
      Reflect.apply(DATE_TO_ISO_STRING, value, []) as string,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    );
  } catch (error) {
    if (error instanceof DormantEulerV2EthereumProviderPositionSourceError) throw error;
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
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
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  try {
    Reflect.apply(ABORTED_GETTER, value, []);
  } catch {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
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
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function canonicalInteger(
  value: unknown,
  maximum: bigint,
  code: DormantEulerV2EthereumProviderPositionSourceFailureCode,
): string {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) return fail(code);
  try {
    if (BigInt(value) > maximum) return fail(code);
  } catch {
    return fail(code);
  }
  return value;
}

function resolveFinitePositiveAmountCap(raw: bigint): bigint {
  if (raw <= 0n || raw > MAX_UINT16) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const exponent = raw & 63n;
  const mantissa = raw >> 6n;
  if (mantissa === 0n) return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  const resolved = (10n ** exponent * mantissa) / 100n;
  if (resolved === 0n || resolved > MAX_UINT112) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return resolved;
}

function convertSharesDown(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (shares * (totalAssets + VIRTUAL_DEPOSIT_ATOMIC)) / (totalShares + VIRTUAL_DEPOSIT_ATOMIC);
}

function convertAssetsDown(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (assets * (totalShares + VIRTUAL_DEPOSIT_ATOMIC)) / (totalAssets + VIRTUAL_DEPOSIT_ATOMIC);
}

function calculatePinnedMaxDeposit(
  supplyCap: bigint,
  totalAssets: bigint,
  totalShares: bigint,
  cash: bigint,
): bigint {
  if (totalAssets >= supplyCap) return 0n;
  const capSpace = supplyCap - totalAssets;
  const cashSpace = MAX_UINT112 - cash;
  const maximumAssets = capSpace < cashSpace ? capSpace : cashSpace;
  let maximumShares = convertAssetsDown(maximumAssets, totalAssets, totalShares);
  const shareSpace = MAX_UINT112 - totalShares;
  if (maximumShares > shareSpace) maximumShares = shareSpace;
  const returnedAssets = convertSharesDown(maximumShares, totalAssets, totalShares);
  return convertAssetsDown(returnedAssets, totalAssets, totalShares) === 0n ? 0n : returnedAssets;
}

function nonzeroSha256(
  value: unknown,
  code: DormantEulerV2EthereumProviderPositionSourceFailureCode,
): string {
  if (typeof value !== 'string' || !SHA256.test(value) || value === ZERO_SHA256) return fail(code);
  return value;
}

function blockHash(
  value: unknown,
  code: DormantEulerV2EthereumProviderPositionSourceFailureCode,
): string {
  if (typeof value !== 'string' || !EVM_BLOCK_HASH.test(value) || value === ZERO_HASH) {
    return fail(code);
  }
  return value;
}

function hexQuantity(
  value: unknown,
  maximum: bigint,
  positive: boolean,
): Readonly<{ hex: string; integer: bigint }> {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value) || value.length > 66) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const integer = BigInt(value);
  if (integer > maximum || (positive && integer === 0n)) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({ hex: value, integer });
}

function header(value: unknown): Header {
  const record = exactDataRecord(
    value,
    HEADER_KEYS,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  const number = hexQuantity(record.number, MAX_UINT64, true);
  const timestamp = hexQuantity(record.timestamp, MAX_UINT64, false);
  const hash = blockHash(record.hash, 'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  const parentHash = blockHash(record.parentHash, 'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  const stateRoot = blockHash(record.stateRoot, 'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  if (hash === parentHash) return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  return Object.freeze({
    numberHex: number.hex,
    numberDecimal: number.integer.toString(10),
    hash,
    parentHash,
    stateRoot,
    timestampSeconds: timestamp.integer,
  });
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

function evmAnchor(value: unknown): ProviderPositionAdmissionEvmAnchorV1 {
  const record = exactDataRecord(
    value,
    ['kind', 'blockNumber', 'blockHash'],
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (record.kind !== 'EVM_BLOCK') return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  return frozenNullPrototype({
    kind: 'EVM_BLOCK' as const,
    blockNumber: canonicalInteger(
      record.blockNumber,
      MAX_UINT64,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
    blockHash: blockHash(record.blockHash, 'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE'),
  });
}

function parseAsset(
  value: unknown,
  manifest: EulerV2EthereumVaultManifest,
): ProviderPositionAdmissionAssetV1 {
  const record = exactDataRecord(
    value,
    ASSET_KEYS,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    true,
  );
  if (
    record.stablecoin !== manifest.vault.stablecoin ||
    record.networkId !== NETWORK_ID ||
    record.identity !== manifest.vault.assetAddress ||
    record.decimals !== 6
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  return frozenNullPrototype({
    stablecoin: manifest.vault.stablecoin,
    networkId: NETWORK_ID,
    identity: manifest.vault.assetAddress,
    decimals: 6,
  });
}

function reviewedRequest(
  value: unknown,
  startedAt: CanonicalTime,
  manifest: EulerV2EthereumVaultManifest,
  reader: CapturedReader,
): ReviewedRequest {
  const record = exactDataRecord(
    value,
    ADMISSION_REQUEST_KEYS,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    true,
  );
  let accountId: AccountId;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  const deadlineAt = canonicalTime(
    record.deadlineAt,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
  );
  const signal = genuineSignal(record.signal);
  const assets = exactDataArray(
    record.assets,
    1,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
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
    record.marketId !== manifest.vault.marketId ||
    record.networkId !== NETWORK_ID ||
    aborted(signal) ||
    deadlineAt.milliseconds <= startedAt.milliseconds ||
    deadlineAt.milliseconds - startedAt.milliseconds > MAX_DEADLINE_MILLISECONDS
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
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
    marketId: manifest.vault.marketId,
    asset: parseAsset(assets[0], manifest),
  });
}

function assertBoundIdentity(record: Record<string, unknown>, request: ReviewedRequest): void {
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
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function contextRequest(
  request: ReviewedRequest,
): ReadEulerV2EthereumDurableTargetContextRequestV1 {
  return frozenNullPrototype({
    contextVersion: EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_USE,
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

function reviewedContext(
  capability: unknown,
  request: ReviewedRequest,
  reader: CapturedReader,
): ReviewedContext {
  assertBoundedImmutableData(capability, MAX_CONTEXT_BYTES);
  const record = exactDataRecord(
    capability,
    CONTEXT_KEYS,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.contextVersion !== EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION ||
    record.use !== EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.maySign !== false ||
    record.mayAccessWalletPrivateKey !== false ||
    record.contextSourceFamilyId !== reader.sourceFamilyId ||
    record.contextSourceId !== reader.sourceId
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  assertBoundIdentity(record, request);
  let walletAddress: string;
  try {
    walletAddress = parseEvmWalletAddress(record.walletAddress);
  } catch {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    capability: capability as EulerV2EthereumDurableTargetContextCapabilityV1,
    walletAddress,
    continuityFloor: evmAnchor(record.continuityFloor),
  });
}

function addressCalldata(selector: string, address: string): string {
  return `${selector}${'0'.repeat(24)}${address.slice(2)}`;
}

function decimalToHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function accountOperationId(accountId: string, operation: string): string {
  return `evc-${accountId.padStart(3, '0')}-${operation}`;
}

function directCallPlan(operationId: string, to: string, data: string): EulerV2EthereumCallPlanV1 {
  return frozenNullPrototype({
    operationId,
    method: 'eth_call' as const,
    to,
    data,
    from: null,
  });
}

function accountReadPlan(
  account: EulerV2EvcAccountCandidate,
  vaultAddress: string,
): EulerV2EthereumAccountReadPlanV1 {
  const balanceOperationId = accountOperationId(account.accountId, 'balance-of');
  return frozenNullPrototype({
    accountId: account.accountId,
    accountAddress: account.accountAddress,
    balanceOf: directCallPlan(
      balanceOperationId,
      vaultAddress,
      addressCalldata(
        EULER_V2_ACCOUNT_POSITION_ABI.evaultBalanceOf.selector,
        account.accountAddress,
      ),
    ),
    convertToAssets: frozenNullPrototype({
      operationId: accountOperationId(account.accountId, 'convert-to-assets'),
      method: 'eth_call' as const,
      to: vaultAddress,
      selector: EULER_V2_ACCOUNT_POSITION_ABI.evaultConvertToAssets.selector,
      uint256InputFromOperationId: balanceOperationId,
      from: null,
    }),
    debtOf: directCallPlan(
      accountOperationId(account.accountId, 'debt-of'),
      vaultAddress,
      addressCalldata(EULER_V2_ACCOUNT_POSITION_ABI.evaultDebtOf.selector, account.accountAddress),
    ),
    debtOfExact: directCallPlan(
      accountOperationId(account.accountId, 'debt-of-exact'),
      vaultAddress,
      addressCalldata(
        EULER_V2_ACCOUNT_POSITION_ABI.evaultDebtOfExact.selector,
        account.accountAddress,
      ),
    ),
  });
}

function transcriptRequest(
  request: ReviewedRequest,
  issuedContextRequest: ReadEulerV2EthereumDurableTargetContextRequestV1,
  context: ReviewedContext,
  manifest: EulerV2EthereumVaultManifest,
): ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1 {
  const accounts = deriveEulerV2EvcAccountCandidates(context.walletAddress);
  if (accounts.length !== EXPECTED_EVC_ACCOUNTS) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const walletOwnerRead = directCallPlan(
    'evc-wallet-owner',
    manifest.deployment.evc.address,
    addressCalldata(
      EULER_V2_ACCOUNT_POSITION_ABI.evcGetAccountOwner.selector,
      context.walletAddress,
    ),
  );
  const accountReadPlans = Object.freeze(
    accounts.map((account) => accountReadPlan(account, manifest.vault.vaultAddress)),
  );
  const boundaryReadPlan: EulerV2EthereumBoundaryReadPlanV1 = frozenNullPrototype({
    chainIdBefore: frozenNullPrototype({
      operationId: 'chain-id-before' as const,
      method: 'eth_chainId' as const,
    }),
    vaultTranscript: frozenNullPrototype({
      operationId: 'vault-transcript' as const,
      adapterSourceId: 'EULER_V2_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT' as const,
    }),
    floorBlockBefore: frozenNullPrototype({
      operationId: 'floor-block-before' as const,
      method: 'eth_getBlockByNumber' as const,
      selector: decimalToHex(context.continuityFloor.blockNumber),
      includeTransactions: false as const,
    }),
    floorBlockAfter: frozenNullPrototype({
      operationId: 'floor-block-after' as const,
      method: 'eth_getBlockByNumber' as const,
      selector: decimalToHex(context.continuityFloor.blockNumber),
      includeTransactions: false as const,
    }),
    selectedBlockAfter: frozenNullPrototype({
      operationId: 'selected-block-after' as const,
      method: 'eth_getBlockByNumber' as const,
      selectorFrom: 'VAULT_TRANSCRIPT_BLOCK_NUMBER' as const,
      includeTransactions: false as const,
    }),
    chainIdAfter: frozenNullPrototype({
      operationId: 'chain-id-after' as const,
      method: 'eth_chainId' as const,
    }),
  });
  const executionOrder = Object.freeze([
    boundaryReadPlan.chainIdBefore.operationId,
    boundaryReadPlan.vaultTranscript.operationId,
    boundaryReadPlan.floorBlockBefore.operationId,
    walletOwnerRead.operationId,
    ...accountReadPlans.flatMap((plan) => [
      plan.balanceOf.operationId,
      plan.convertToAssets.operationId,
      plan.debtOf.operationId,
      plan.debtOfExact.operationId,
    ]),
    boundaryReadPlan.floorBlockAfter.operationId,
    boundaryReadPlan.selectedBlockAfter.operationId,
    boundaryReadPlan.chainIdAfter.operationId,
  ]);
  return frozenNullPrototype({
    transcriptVersion: EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    mayCreatePositionSnapshot: false as const,
    maySign: false as const,
    mayAccessWalletPrivateKey: false as const,
    admissionRequest: request.request,
    contextRequest: issuedContextRequest,
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
    blockBinding: BLOCK_BINDING,
    continuityFloor: context.continuityFloor,
    manifest,
    manifestFingerprintSha256: manifest.manifestFingerprintSha256,
    semanticsFingerprintSha256: EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    vaultTranscriptRequest: frozenNullPrototype({
      marketId: manifest.vault.marketId,
      vaultAddress: manifest.vault.vaultAddress,
      stablecoin: manifest.vault.stablecoin,
    }),
    boundaryReadPlan,
    walletOwnerRead,
    accountReadPlans,
    executionOrder,
    maximumResponseBytes: MAX_TRANSCRIPT_BYTES,
  });
}

function parseVaultCandidate(
  value: unknown,
  request: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
): Readonly<{
  candidate: DormantEulerV2EthereumVaultTranscriptCandidate;
  block: Header;
  observedAt: CanonicalTime;
  staleAfter: CanonicalTime;
  totalAssets: bigint;
  totalSupplyShares: bigint;
}> {
  const record = exactDataRecord(
    value,
    VAULT_TRANSCRIPT_KEYS,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.schemaVersion !== 1 ||
    record.sourceId !== 'EULER_V2_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT' ||
    record.use !== 'DORMANT_EULER_V2_VAULT_CORROBORATION_ONLY' ||
    record.providerId !== PROVIDER_ID ||
    record.protocolId !== PROTOCOL_ID ||
    record.networkId !== NETWORK_ID ||
    record.marketId !== request.marketId ||
    record.manifestFingerprintSha256 !== request.manifestFingerprintSha256 ||
    record.sourceFinality !== 'ETHEREUM_FINALIZED_BLOCK' ||
    record.sourceProofStatus !== 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED' ||
    record.sourceAuthenticity !== 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT' ||
    record.freshnessStatus !== 'CURRENT_WITHIN_CALLER_MANIFEST_BOUND' ||
    record.yieldEvidenceStatus !== 'ABSENT_NOT_COMPUTED' ||
    record.liquidityEvidenceStatus !== 'NOT_ESTABLISHED_BY_CASH_CAP_OR_MAX_DEPOSIT' ||
    record.persistenceEligibility !== 'BLOCKED_PENDING_INDEPENDENT_SOURCE_AND_RISK_VERIFICATION' ||
    record.mayPersist !== false ||
    record.mayEstablishRecommendationEligibility !== false ||
    record.mayAuthorizeFinancialAction !== false
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  nonzeroSha256(
    record.transcriptFingerprintSha256,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
  );
  const block = header(record.block);
  if (record.sourcePosition !== block.numberDecimal) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const observedAt = canonicalTime(
    record.observedAt,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
  );
  const staleAfter = canonicalTime(
    record.staleAfter,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
  );
  const expectedStaleMilliseconds =
    (block.timestampSeconds + BigInt(request.manifest.maximumFinalizedBlockAgeSeconds)) * 1_000n;
  if (
    expectedStaleMilliseconds > BigInt(Number.MAX_SAFE_INTEGER) ||
    staleAfter.milliseconds !== Number(expectedStaleMilliseconds) ||
    observedAt.milliseconds < Number(block.timestampSeconds * 1_000n) ||
    observedAt.milliseconds >= staleAfter.milliseconds
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }

  const deployment = exactDataRecord(
    record.deployment,
    [
      'factory',
      'implementation',
      'proxyKind',
      'factoryRecognizedProxy',
      'upgradeable',
      'governorFinalized',
    ],
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    deployment.factory !== request.manifest.deployment.factory.address ||
    deployment.implementation !== request.manifest.deployment.implementation.address ||
    deployment.proxyKind !== 'IMMUTABLE_META_PROXY' ||
    deployment.factoryRecognizedProxy !== true ||
    deployment.upgradeable !== false ||
    deployment.governorFinalized !== true
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const vault = exactDataRecord(
    record.vault,
    [
      'address',
      'stablecoin',
      'assetAddress',
      'decimals',
      'oracleAddress',
      'unitOfAccountAddress',
      'interestRateModelAddress',
      'hookTarget',
      'hookedOperations',
      'configFlags',
    ],
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    vault.address !== request.manifest.vault.vaultAddress ||
    vault.stablecoin !== request.manifest.vault.stablecoin ||
    vault.assetAddress !== request.manifest.vault.assetAddress ||
    vault.decimals !== 6 ||
    vault.oracleAddress !== request.manifest.vault.oracleAddress ||
    vault.unitOfAccountAddress !== request.manifest.vault.unitOfAccountAddress ||
    vault.interestRateModelAddress !== request.manifest.vault.interestRateModelAddress ||
    vault.hookTarget !== '0x0000000000000000000000000000000000000000' ||
    vault.hookedOperations !== '0' ||
    vault.configFlags !== request.manifest.vault.expectedConfigFlags
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }

  const raw = exactDataRecord(
    record.rawState,
    [
      'totalAssetsAtomic',
      'totalSupplySharesAtomic',
      'cashAtomic',
      'totalBorrowsAtomic',
      'supplyCapRaw',
      'supplyCapResolvedAtomic',
      'borrowCapRaw',
      'borrowCapResolvedAtomic',
      'maxDepositProbeAtomic',
    ],
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  const totalAssets = BigInt(
    canonicalInteger(
      raw.totalAssetsAtomic,
      MAX_UINT112 * 2n,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  );
  const totalSupplyShares = BigInt(
    canonicalInteger(
      raw.totalSupplySharesAtomic,
      MAX_UINT112,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  );
  const cash = BigInt(
    canonicalInteger(raw.cashAtomic, MAX_UINT112, 'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE'),
  );
  const totalBorrows = BigInt(
    canonicalInteger(
      raw.totalBorrowsAtomic,
      MAX_UINT112,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  );
  const supplyCapRaw = BigInt(
    canonicalInteger(raw.supplyCapRaw, MAX_UINT16, 'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE'),
  );
  const borrowCapRaw = BigInt(
    canonicalInteger(raw.borrowCapRaw, MAX_UINT16, 'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE'),
  );
  const supplyCap = BigInt(
    canonicalInteger(
      raw.supplyCapResolvedAtomic,
      MAX_UINT112,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  );
  const borrowCap = BigInt(
    canonicalInteger(
      raw.borrowCapResolvedAtomic,
      MAX_UINT112,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  );
  const maxDeposit = BigInt(
    canonicalInteger(
      raw.maxDepositProbeAtomic,
      MAX_UINT112,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  );
  if (
    totalAssets === 0n ||
    totalSupplyShares === 0n ||
    totalAssets !== cash + totalBorrows ||
    totalAssets >= supplyCap ||
    totalBorrows > borrowCap ||
    supplyCap !== resolveFinitePositiveAmountCap(supplyCapRaw) ||
    borrowCap !== resolveFinitePositiveAmountCap(borrowCapRaw) ||
    maxDeposit === 0n ||
    maxDeposit !== calculatePinnedMaxDeposit(supplyCap, totalAssets, totalSupplyShares, cash) ||
    raw.supplyCapRaw !== request.manifest.vault.expectedSupplyCapRaw ||
    raw.borrowCapRaw !== request.manifest.vault.expectedBorrowCapRaw
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const conversion = exactDataRecord(
    record.conversionEvidence,
    [
      'sampleAtomic',
      'sharesToAssetsAtomic',
      'assetsToSharesAtomic',
      'previewDepositSharesAtomic',
      'semantics',
    ],
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  const sharesToAssets = BigInt(
    canonicalInteger(
      conversion.sharesToAssetsAtomic,
      MAX_UINT112,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  );
  const assetsToShares = BigInt(
    canonicalInteger(
      conversion.assetsToSharesAtomic,
      MAX_UINT112,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    ),
  );
  if (
    conversion.sampleAtomic !== '1000000' ||
    conversion.previewDepositSharesAtomic !== conversion.assetsToSharesAtomic ||
    conversion.semantics !== 'EVK_PINNED_VIRTUAL_DEPOSIT_INTEGER_ROUND_DOWN_MATCHED' ||
    sharesToAssets === 0n ||
    assetsToShares === 0n ||
    sharesToAssets !==
      (VIRTUAL_DEPOSIT_ATOMIC * (totalAssets + VIRTUAL_DEPOSIT_ATOMIC)) /
        (totalSupplyShares + VIRTUAL_DEPOSIT_ATOMIC) ||
    assetsToShares !==
      (VIRTUAL_DEPOSIT_ATOMIC * (totalSupplyShares + VIRTUAL_DEPOSIT_ATOMIC)) /
        (totalAssets + VIRTUAL_DEPOSIT_ATOMIC)
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    candidate: value as DormantEulerV2EthereumVaultTranscriptCandidate,
    block,
    observedAt,
    staleAfter,
    totalAssets,
    totalSupplyShares,
  });
}

function uint256Calldata(selector: string, input: bigint): string {
  if (input < 0n || input > MAX_UINT256) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return `${selector}${input.toString(16).padStart(64, '0')}`;
}

function abiUint(value: unknown, maximum: bigint): bigint {
  if (typeof value !== 'string' || !ABI_WORD.test(value)) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const parsed = BigInt(value);
  if (parsed > maximum) return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  return parsed;
}

function eip1898BlockParameter(value: unknown, selectedBlockHash: string): void {
  const record = exactDataRecord(
    value,
    ['blockHash', 'requireCanonical'],
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (record.blockHash !== selectedBlockHash || record.requireCanonical !== true) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function exactCallResult(
  value: unknown,
  expected: EulerV2EthereumCallPlanV1 | EulerV2EthereumDependentCallPlanV1,
  expectedData: string,
  selectedBlockHash: string,
  maximum: bigint,
): bigint {
  const record = exactDataRecord(
    value,
    CALL_RESULT_KEYS,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.operationId !== expected.operationId ||
    record.method !== 'eth_call' ||
    record.to !== expected.to ||
    record.data !== expectedData ||
    record.from !== null
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  eip1898BlockParameter(record.blockParameter, selectedBlockHash);
  return abiUint(record.result, maximum);
}

function assertExecutionOrder(value: unknown, expected: readonly string[]): void {
  const actual = exactDataArray(
    value,
    expected.length,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (actual.some((operationId, index) => operationId !== expected[index])) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function parseWalletOwnerGate(
  value: unknown,
  request: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
  selectedBlockHash: string,
): void {
  const record = exactDataRecord(
    value,
    CALL_RESULT_KEYS,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  const expected = request.walletOwnerRead;
  if (
    record.operationId !== expected.operationId ||
    record.method !== expected.method ||
    record.to !== request.manifest.deployment.evc.address ||
    record.to !== expected.to ||
    record.data !== expected.data ||
    record.from !== null ||
    typeof record.result !== 'string' ||
    !ABI_WORD.test(record.result) ||
    record.result !== `0x${'0'.repeat(24)}${request.walletAddress.slice(2)}`
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  eip1898BlockParameter(record.blockParameter, selectedBlockHash);
}

function parseAccountRows(
  value: unknown,
  request: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
  selectedBlockHash: string,
  totalAssets: bigint,
  totalSupplyShares: bigint,
): Readonly<{ supplyAtomic: string; borrowAtomic: string }> {
  const rows = exactDataArray(
    value,
    EXPECTED_EVC_ACCOUNTS,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  let supplyTotal = 0n;
  let borrowTotal = 0n;
  for (const [index, valueAtIndex] of rows.entries()) {
    const record = exactDataRecord(
      valueAtIndex,
      ACCOUNT_ROW_KEYS,
      'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
      true,
    );
    const expected = request.accountReadPlans[index];
    if (
      expected === undefined ||
      record.accountId !== expected.accountId ||
      record.accountAddress !== expected.accountAddress
    ) {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const shares = exactCallResult(
      record.balanceOf,
      expected.balanceOf,
      expected.balanceOf.data,
      selectedBlockHash,
      MAX_UINT112,
    );
    const supplyAssets = exactCallResult(
      record.convertToAssets,
      expected.convertToAssets,
      uint256Calldata(expected.convertToAssets.selector, shares),
      selectedBlockHash,
      MAX_UINT112,
    );
    const expectedSupplyNumerator = shares * (totalAssets + VIRTUAL_DEPOSIT_ATOMIC);
    if (
      expected.convertToAssets.uint256InputFromOperationId !== expected.balanceOf.operationId ||
      expectedSupplyNumerator > MAX_UINT256 ||
      supplyAssets !== expectedSupplyNumerator / (totalSupplyShares + VIRTUAL_DEPOSIT_ATOMIC)
    ) {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const debtAssets = exactCallResult(
      record.debtOf,
      expected.debtOf,
      expected.debtOf.data,
      selectedBlockHash,
      MAX_UINT112,
    );
    const debtExact = exactCallResult(
      record.debtOfExact,
      expected.debtOfExact,
      expected.debtOfExact.data,
      selectedBlockHash,
      MAX_UINT256,
    );
    let projectedDebt: string;
    try {
      projectedDebt = projectEulerV2DebtExactToAssetsUp(debtExact.toString(10)).assetsAtomic;
    } catch {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    if (debtAssets.toString(10) !== projectedDebt) {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    supplyTotal += supplyAssets;
    borrowTotal += debtAssets;
    if (supplyTotal > MAX_UINT256 || borrowTotal > MAX_UINT256) {
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
  }
  return Object.freeze({
    supplyAtomic: supplyTotal.toString(10),
    borrowAtomic: borrowTotal.toString(10),
  });
}

function parseTranscript(
  capability: unknown,
  request: ReviewedRequest,
  context: ReviewedContext,
  issuedRequest: ReadEulerV2EthereumFinalizedPositionTranscriptRequestV1,
): ParsedTranscript {
  assertBoundedImmutableData(capability, MAX_TRANSCRIPT_BYTES);
  const record = exactDataRecord(
    capability,
    TRANSCRIPT_KEYS,
    'EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
    true,
  );
  if (
    record.transcriptVersion !== EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION ||
    record.use !== EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.mayCreatePositionSnapshot !== false ||
    record.maySign !== false ||
    record.mayAccessWalletPrivateKey !== false ||
    record.walletAddress !== context.walletAddress ||
    record.manifestFingerprintSha256 !== issuedRequest.manifestFingerprintSha256 ||
    record.semanticsFingerprintSha256 !== EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256 ||
    record.chainIdBefore !== EXPECTED_CHAIN_ID ||
    record.chainIdAfter !== EXPECTED_CHAIN_ID ||
    record.blockBinding !== BLOCK_BINDING ||
    record.status !== 'COMPLETE' ||
    record.coverageScope !== 'EXACT_MANIFEST_VAULT_LOAN_ASSET_ALL_256_EVC_ACCOUNTS' ||
    record.operatorTraversal !== false ||
    record.indirectExposureIncluded !== false ||
    record.zeroPositionSemantics !== 'EXACT_ZERO_AGGREGATE_AFTER_ALL_256_EVC_ACCOUNT_ROWS'
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  assertBoundIdentity(record, request);
  const vault = parseVaultCandidate(record.vaultTranscript, issuedRequest);
  const selectedAfter = header(record.selectedBlockAfter);
  const floorBefore = header(record.floorBlockBefore);
  const floorAfter = header(record.floorBlockAfter);
  if (
    !sameHeader(vault.block, selectedAfter) ||
    !sameHeader(floorBefore, floorAfter) ||
    floorBefore.numberDecimal !== context.continuityFloor.blockNumber ||
    floorBefore.hash !== context.continuityFloor.blockHash ||
    BigInt(vault.block.numberDecimal) < BigInt(floorBefore.numberDecimal) ||
    (vault.block.numberDecimal === floorBefore.numberDecimal &&
      vault.block.hash !== floorBefore.hash)
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  assertExecutionOrder(record.executionOrder, issuedRequest.executionOrder);
  parseWalletOwnerGate(record.walletOwnerGate, issuedRequest, vault.block.hash);
  const balances = parseAccountRows(
    record.accounts,
    issuedRequest,
    vault.block.hash,
    vault.totalAssets,
    vault.totalSupplyShares,
  );
  return Object.freeze({
    block: vault.block,
    candidateObservedAt: vault.observedAt,
    candidateStaleAfter: vault.staleAfter,
    ...balances,
  });
}

function validateFreshness(
  transcript: ParsedTranscript,
  completedAt: CanonicalTime,
  contextSettledAt: CanonicalTime,
  manifest: EulerV2EthereumVaultManifest,
): void {
  const policy = chainObservationPolicyForNetwork(NETWORK_ID);
  const blockMilliseconds = transcript.block.timestampSeconds * 1_000n;
  if (
    policy?.environment !== 'MAINNET' ||
    policy.identityProbe.expectedResult !== EXPECTED_CHAIN_ID ||
    policy.monotonicReadConstraint !== 'PIN_BLOCK_NUMBER_AND_HASH' ||
    blockMilliseconds > BigInt(Number.MAX_SAFE_INTEGER) ||
    transcript.candidateObservedAt.milliseconds < contextSettledAt.milliseconds ||
    transcript.candidateObservedAt.milliseconds > completedAt.milliseconds ||
    completedAt.milliseconds >= transcript.candidateStaleAfter.milliseconds
  ) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const age = completedAt.milliseconds - Number(blockMilliseconds);
  const maximumAge = Math.min(
    Number(BigInt(manifest.maximumFinalizedBlockAgeSeconds) * 1_000n),
    policy.freshness.unavailableAfterMs,
  );
  if (age < 0 || age >= maximumAge) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function staleAfter(
  observedAt: CanonicalTime,
  deadlineAt: CanonicalTime,
  candidateStaleAfter: CanonicalTime,
): string {
  const policy = chainObservationPolicyForNetwork(NETWORK_ID);
  if (policy === undefined) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const milliseconds = Math.min(
    observedAt.milliseconds + policy.freshness.currentWithinMs,
    deadlineAt.milliseconds,
    candidateStaleAfter.milliseconds,
  );
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= observedAt.milliseconds) {
    return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Reflect.apply(DATE_TO_ISO_STRING, new Date(milliseconds), []) as string;
}

function position(
  kind: 'SUPPLY' | 'BORROW',
  atomic: string,
  request: ReviewedRequest,
): ProviderPositionAdmissionPositionV1 {
  return frozenNullPrototype({
    positionId: `${request.marketId}-${request.walletId}-${kind.toLowerCase()}`,
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
  completedAt: CanonicalTime,
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
    sourceObservationId: `ethereum-block-${transcript.block.numberDecimal}`,
    walletId: request.walletId,
    providerId: PROVIDER_ID,
    protocolId: PROTOCOL_ID,
    marketId: request.marketId,
    networkId: NETWORK_ID,
    assets: Object.freeze([request.asset]),
    status: 'COMPLETE' as const,
    observedAt: completedAt.timestamp,
    staleAfter: staleAfter(completedAt, request.deadlineAt, transcript.candidateStaleAfter),
    continuityFloor: context.continuityFloor,
    chainAnchor: frozenNullPrototype({
      kind: 'EVM_BLOCK' as const,
      blockNumber: transcript.block.numberDecimal,
      blockHash: transcript.block.hash,
    }),
    positions: Object.freeze(positions),
  });
}

/**
 * Dormant exact-EVault Euler V2 Ethereum position source. The target is one
 * manifest-bound vault and its loan asset; the 256 EVC addresses are derived
 * deterministically from the authenticated wallet, never discovered. It owns
 * no endpoint, credential, registry entry, timer, database handle, signer,
 * persistence path, yield/liquidity claim, or financial authority.
 */
export class DormantEulerV2EthereumProviderPositionSource implements ProviderPositionAdmissionSourcePort {
  readonly #manifest!: EulerV2EthereumVaultManifest;
  readonly #contextReader!: CapturedReader;
  readonly #transcriptReader!: CapturedReader;
  readonly #clock!: CapturedMethod;

  constructor(
    manifestValue: unknown,
    requiredManifestFingerprintSha256: unknown,
    requiredSemanticsFingerprintSha256: unknown,
    contextReaderValue: EulerV2EthereumDurableTargetContextReaderPort,
    transcriptReaderValue: EulerV2EthereumFinalizedPositionTranscriptPort,
    clockValue: EulerV2EthereumProviderPositionSourceClock,
  ) {
    try {
      if (typeof manifestValue !== 'object' || manifestValue === null || isProxy(manifestValue)) {
        return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
      this.#manifest = createEulerV2EthereumVaultManifest(manifestValue);
      if (
        requiredManifestFingerprintSha256 !== this.#manifest.manifestFingerprintSha256 ||
        nonzeroSha256(
          requiredManifestFingerprintSha256,
          'EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION',
        ) !== this.#manifest.manifestFingerprintSha256 ||
        requiredSemanticsFingerprintSha256 !==
          EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256
      ) {
        return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
      this.#contextReader = capturedReader(
        contextReaderValue,
        'contextVersion',
        EULER_V2_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
      );
      this.#transcriptReader = capturedReader(
        transcriptReaderValue,
        'transcriptVersion',
        EULER_V2_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
      );
      this.#clock = capturedMethod(objectReceiver(clockValue), 'now');
      if (
        this.#contextReader.receiver === this.#transcriptReader.receiver ||
        this.#contextReader.sourceFamilyId === this.#transcriptReader.sourceFamilyId ||
        this.#contextReader.sourceId === this.#transcriptReader.sourceId
      ) {
        return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
      }
    } catch (error) {
      if (error instanceof DormantEulerV2EthereumProviderPositionSourceError) throw error;
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
    }
  }

  async readTarget(
    requestValue: ReadProviderPositionAdmissionTargetRequestV1,
  ): Promise<ProviderPositionAdmissionSourceEvidenceV1> {
    try {
      const startedAt = clockTime(this.#clock);
      const request = reviewedRequest(
        requestValue,
        startedAt,
        this.#manifest,
        this.#transcriptReader,
      );
      const issuedContextRequest = contextRequest(request);
      const contextCapability = await invoke(this.#contextReader.read, [issuedContextRequest]);
      const contextSettledAt = clockTime(this.#clock);
      assertActive(request, contextSettledAt, startedAt);
      if (
        invoke(this.#contextReader.review, [contextCapability, issuedContextRequest]) !==
        contextCapability
      ) {
        return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
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
      const transcriptSettledAt = clockTime(this.#clock);
      assertActive(request, transcriptSettledAt, contextSettledAt);
      if (
        invoke(this.#transcriptReader.review, [transcriptCapability, issuedTranscriptRequest]) !==
          transcriptCapability ||
        invoke(this.#contextReader.review, [contextCapability, issuedContextRequest]) !==
          contextCapability
      ) {
        return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      const transcript = parseTranscript(
        transcriptCapability,
        request,
        context,
        issuedTranscriptRequest,
      );
      const completedAt = clockTime(this.#clock);
      assertActive(request, completedAt, transcriptSettledAt);
      validateFreshness(transcript, completedAt, contextSettledAt, this.#manifest);
      if (
        invoke(this.#transcriptReader.review, [transcriptCapability, issuedTranscriptRequest]) !==
          transcriptCapability ||
        invoke(this.#contextReader.review, [contextCapability, issuedContextRequest]) !==
          contextCapability
      ) {
        return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      return evidence(transcript, request, context, completedAt);
    } catch (error) {
      if (error instanceof DormantEulerV2EthereumProviderPositionSourceError) throw error;
      return fail('EULER_V2_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
  }
}
