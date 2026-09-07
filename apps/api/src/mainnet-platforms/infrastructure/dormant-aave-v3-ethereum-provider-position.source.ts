import { Buffer } from 'node:buffer';
import { isProxy } from 'node:util/types';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import {
  AAVE_V3_ETHEREUM_POOL,
  AAVE_V3_ETHEREUM_USDC,
  AAVE_V3_ETHEREUM_USDC_A_TOKEN,
  AAVE_V3_ETHEREUM_USDC_VARIABLE_DEBT_TOKEN,
  AAVE_V3_ETHEREUM_USDT,
  AAVE_V3_ETHEREUM_USDT_A_TOKEN,
  AAVE_V3_ETHEREUM_USDT_VARIABLE_DEBT_TOKEN,
} from '../../smart-lending/infrastructure/aave/aave-v3-ethereum-deployment.manifest';
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

export const AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION = 1 as const;
export const AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE =
  'DORMANT_AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_ONLY' as const;
export const AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION = 1 as const;
export const AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE =
  'DORMANT_AAVE_V3_ETHEREUM_FINALIZED_POSITION_RPC_TRANSCRIPT_ONLY' as const;

const NETWORK_ID = 'eip155:1' as const;
const PROVIDER_ID = 'aave' as const;
const PROTOCOL_ID = 'aave-v3' as const;
const MARKET_ID = AAVE_V3_ETHEREUM_POOL;
const EXPECTED_CHAIN_ID = '0x1' as const;
const BLOCK_SELECTOR = 'finalized' as const;
const BLOCK_BINDING = 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const;
const BALANCE_OF_SELECTOR = '0x70a08231' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const MAX_CONTEXT_BYTES = 8 * 1024;
const MAX_TRANSCRIPT_BYTES = 64 * 1024;
const MAX_DATA_NODES = 256;
const MAX_STRING_BYTES = 4 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const SAFE_SOURCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const ABI_UINT256 = /^0x[0-9a-f]{64}$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const MAX_UINT256 = (1n << 256n) - 1n;

type PositionKind = ProviderPositionAdmissionPositionV1['positionKind'];

interface AssetDefinition {
  readonly stablecoin: 'USDC' | 'USDT';
  readonly identity: string;
  readonly decimals: 6;
  readonly aTokenAddress: string;
  readonly stableDebtTokenAddress: typeof ZERO_ADDRESS;
  readonly variableDebtTokenAddress: string;
}

const ASSET_DEFINITIONS = Object.freeze([
  Object.freeze({
    stablecoin: 'USDC' as const,
    identity: AAVE_V3_ETHEREUM_USDC,
    decimals: 6 as const,
    aTokenAddress: AAVE_V3_ETHEREUM_USDC_A_TOKEN,
    stableDebtTokenAddress: ZERO_ADDRESS,
    variableDebtTokenAddress: AAVE_V3_ETHEREUM_USDC_VARIABLE_DEBT_TOKEN,
  }),
  Object.freeze({
    stablecoin: 'USDT' as const,
    identity: AAVE_V3_ETHEREUM_USDT,
    decimals: 6 as const,
    aTokenAddress: AAVE_V3_ETHEREUM_USDT_A_TOKEN,
    stableDebtTokenAddress: ZERO_ADDRESS,
    variableDebtTokenAddress: AAVE_V3_ETHEREUM_USDT_VARIABLE_DEBT_TOKEN,
  }),
] satisfies readonly AssetDefinition[]);

export interface ReadAaveV3EthereumDurableTargetContextRequestV1 {
  readonly contextVersion: typeof AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly accountId: ReadProviderPositionAdmissionTargetRequestV1['accountId'];
  readonly correlationId: string;
  readonly walletId: string;
  readonly networkId: typeof NETWORK_ID;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}

export interface AaveV3EthereumDurableTargetContextV1 {
  readonly contextVersion: typeof AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly use: typeof AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
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
 * independently retained anchor floor. Implementations must bind an issued
 * capability to the exact request object and must not obtain either value from
 * the RPC transcript source.
 */
export interface AaveV3EthereumDurableTargetContextReaderPort {
  readonly contextVersion: typeof AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readContext(request: ReadAaveV3EthereumDurableTargetContextRequestV1): Promise<unknown>;
  verifyContext(
    capability: unknown,
    request: ReadAaveV3EthereumDurableTargetContextRequestV1,
  ): boolean;
}

export interface AaveV3EthereumPositionBalanceReadV1 {
  readonly operationId: string;
  readonly stablecoin: 'USDC' | 'USDT';
  readonly positionKind: PositionKind;
  readonly tokenAddress: string;
  readonly callData: string;
}

export interface ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1 {
  readonly transcriptVersion: typeof AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly use: typeof AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly accountId: ReadProviderPositionAdmissionTargetRequestV1['accountId'];
  readonly correlationId: string;
  readonly walletId: string;
  readonly walletAddress: string;
  readonly providerId: typeof PROVIDER_ID;
  readonly protocolId: typeof PROTOCOL_ID;
  readonly marketId: typeof MARKET_ID;
  readonly networkId: typeof NETWORK_ID;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly expectedChainId: typeof EXPECTED_CHAIN_ID;
  readonly blockSelector: typeof BLOCK_SELECTOR;
  readonly blockBinding: typeof BLOCK_BINDING;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
  readonly assets: readonly ProviderPositionAdmissionAssetV1[];
  readonly balanceReads: readonly AaveV3EthereumPositionBalanceReadV1[];
  readonly maximumResponseBytes: typeof MAX_TRANSCRIPT_BYTES;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
  /** Exact authenticated durable context; a transport must not substitute it. */
  readonly durableContext: unknown;
}

/**
 * Endpoint-free boundary for an exact, read-only finalized Ethereum RPC
 * transcript. Implementations must execute the supplied balance reads at one
 * EIP-1898 block hash, read every requested reserve-token mapping from Aave's
 * protocol data provider at that same hash, reject redirects or endpoint
 * changes, enforce the byte and deadline bounds, cooperatively drain after
 * abort, and bind an issued capability to the exact request object. No
 * endpoint or credential crosses this interface.
 */
export interface AaveV3EthereumFinalizedPositionTranscriptPort {
  readonly transcriptVersion: typeof AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readTranscript(request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1): Promise<unknown>;
  verifyTranscript(
    capability: unknown,
    request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  ): boolean;
}

export interface AaveV3EthereumProviderPositionSourceClock {
  now(): Date;
}

export type DormantAaveV3EthereumProviderPositionSourceFailureCode =
  | 'AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION'
  | 'AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST'
  | 'AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE';

export class DormantAaveV3EthereumProviderPositionSourceError extends Error {
  constructor(readonly code: DormantAaveV3EthereumProviderPositionSourceFailureCode) {
    super('Aave V3 Ethereum provider-position source is unavailable.');
    this.name = 'DormantAaveV3EthereumProviderPositionSourceError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

interface CapturedContextReader {
  readonly receiver: object;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly read: (request: ReadAaveV3EthereumDurableTargetContextRequestV1) => Promise<unknown>;
  readonly verify: (
    capability: unknown,
    request: ReadAaveV3EthereumDurableTargetContextRequestV1,
  ) => boolean;
}

interface CapturedTranscriptReader {
  readonly receiver: object;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly read: (
    request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  ) => Promise<unknown>;
  readonly verify: (
    capability: unknown,
    request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  ) => boolean;
}

interface ReviewedRequest {
  readonly request: ReadProviderPositionAdmissionTargetRequestV1;
  readonly accountId: ReadProviderPositionAdmissionTargetRequestV1['accountId'];
  readonly correlationId: string;
  readonly walletId: string;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly deadlineAt: string;
  readonly deadlineAtMilliseconds: number;
  readonly signal: AbortSignal;
  readonly assets: readonly ProviderPositionAdmissionAssetV1[];
}

interface ReviewedContext {
  readonly capability: unknown;
  readonly walletAddress: string;
  readonly continuityFloor: ProviderPositionAdmissionEvmAnchorV1;
  readonly resolvedAt: string;
  readonly resolvedAtMilliseconds: number;
}

interface CanonicalTime {
  readonly timestamp: string;
  readonly milliseconds: number;
}

interface ReviewedBlock {
  readonly number: string;
  readonly hash: string;
}

function fail(code: DormantAaveV3EthereumProviderPositionSourceFailureCode): never {
  throw new DormantAaveV3EthereumProviderPositionSourceError(code);
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

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof DormantAaveV3EthereumProviderPositionSourceError) throw error;
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function dataArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
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
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const indexes = Array.from({ length: length.value }, (_, index) => String(index));
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== indexes.length + 1 ||
    keys.some((key) => typeof key !== 'string' || (key !== 'length' && !indexes.includes(key)))
  ) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return indexes.map((index) => {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    return descriptor.value;
  });
}

function assertBoundedPlainData(value: unknown, maximumBytes: number): void {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (candidate: unknown): void => {
    nodes += 1;
    if (nodes > MAX_DATA_NODES) return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    if (typeof candidate === 'string') {
      if (Buffer.byteLength(candidate, 'utf8') > MAX_STRING_BYTES) {
        return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      return;
    }
    if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'number') {
      return;
    }
    if (typeof candidate !== 'object' || isProxy(candidate) || seen.has(candidate)) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    seen.add(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if (
      (Array.isArray(candidate) && prototype !== Array.prototype) ||
      (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null)
    ) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) {
        return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      if (key !== 'length') visit(descriptor.value);
    }
  };
  visit(value);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  if (Buffer.byteLength(encoded, 'utf8') > maximumBytes) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function canonicalTime(value: unknown): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({ timestamp: value, milliseconds });
}

function clockTime(now: () => Date): CanonicalTime {
  let value: Date;
  try {
    value = now();
  } catch {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return canonicalTime(value.toISOString());
}

function capturedClock(value: unknown): () => Date {
  const now = stableDataMember(value, 'now');
  if (typeof now !== 'function' || isProxy(now)) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return () => Reflect.apply(now, value, []) as Date;
}

function sourceIdentity(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_SOURCE_ID.test(value)) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return value;
}

function capturedContextReader(value: unknown): CapturedContextReader {
  if (typeof value !== 'object' || value === null || isProxy(value)) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const contextVersion = stableDataMember(value, 'contextVersion');
  const sourceFamilyId = sourceIdentity(stableDataMember(value, 'sourceFamilyId'));
  const sourceId = sourceIdentity(stableDataMember(value, 'sourceId'));
  const read = stableDataMember(value, 'readContext');
  const verify = stableDataMember(value, 'verifyContext');
  if (
    contextVersion !== AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION ||
    typeof read !== 'function' ||
    isProxy(read) ||
    typeof verify !== 'function' ||
    isProxy(verify)
  ) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver: value,
    sourceFamilyId,
    sourceId,
    read: (request: ReadAaveV3EthereumDurableTargetContextRequestV1) =>
      Reflect.apply(read, value, [request]) as Promise<unknown>,
    verify: (capability: unknown, request: ReadAaveV3EthereumDurableTargetContextRequestV1) =>
      Reflect.apply(verify, value, [capability, request]) as boolean,
  });
}

function capturedTranscriptReader(value: unknown): CapturedTranscriptReader {
  if (typeof value !== 'object' || value === null || isProxy(value)) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  const transcriptVersion = stableDataMember(value, 'transcriptVersion');
  const sourceFamilyId = sourceIdentity(stableDataMember(value, 'sourceFamilyId'));
  const sourceId = sourceIdentity(stableDataMember(value, 'sourceId'));
  const read = stableDataMember(value, 'readTranscript');
  const verify = stableDataMember(value, 'verifyTranscript');
  if (
    transcriptVersion !== AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION ||
    typeof read !== 'function' ||
    isProxy(read) ||
    typeof verify !== 'function' ||
    isProxy(verify)
  ) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
  }
  return Object.freeze({
    receiver: value,
    sourceFamilyId,
    sourceId,
    read: (request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1) =>
      Reflect.apply(read, value, [request]) as Promise<unknown>,
    verify: (
      capability: unknown,
      request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
    ) => Reflect.apply(verify, value, [capability, request]) as boolean,
  });
}

function canonicalAsset(value: unknown): ProviderPositionAdmissionAssetV1 {
  const record = exactDataRecord(value, ['stablecoin', 'networkId', 'identity', 'decimals']);
  const definition = ASSET_DEFINITIONS.find((candidate) => candidate.identity === record.identity);
  if (
    definition === undefined ||
    record.stablecoin !== definition.stablecoin ||
    record.networkId !== NETWORK_ID ||
    record.decimals !== definition.decimals
  ) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  return Object.freeze({
    stablecoin: definition.stablecoin,
    networkId: NETWORK_ID,
    identity: definition.identity,
    decimals: definition.decimals,
  });
}

function reviewedRequest(value: unknown, now: CanonicalTime): ReviewedRequest {
  const record = exactDataRecord(value, [
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
  ]);
  let accountId: ReadProviderPositionAdmissionTargetRequestV1['accountId'];
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  const deadline = canonicalTime(record.deadlineAt);
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
    record.providerId !== PROVIDER_ID ||
    record.protocolId !== PROTOCOL_ID ||
    record.marketId !== MARKET_ID ||
    record.networkId !== NETWORK_ID ||
    !(record.signal instanceof AbortSignal) ||
    isProxy(record.signal) ||
    record.signal.aborted ||
    deadline.milliseconds <= now.milliseconds ||
    deadline.milliseconds - now.milliseconds > MAX_DEADLINE_MILLISECONDS
  ) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  const assets = dataArray(record.assets, ASSET_DEFINITIONS.length).map(canonicalAsset);
  if (assets.length < 1 || new Set(assets.map(({ identity }) => identity)).size !== assets.length) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  }
  return Object.freeze({
    request: value as ReadProviderPositionAdmissionTargetRequestV1,
    accountId,
    correlationId: record.correlationId,
    walletId: record.walletId,
    sourceFamilyId: record.sourceFamilyId,
    sourceId: record.sourceId,
    deadlineAt: deadline.timestamp,
    deadlineAtMilliseconds: deadline.milliseconds,
    signal: record.signal,
    assets: Object.freeze(assets),
  });
}

function contextRequest(request: ReviewedRequest): ReadAaveV3EthereumDurableTargetContextRequestV1 {
  return Object.freeze({
    contextVersion: AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
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
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
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
  issuedRequest: ReadAaveV3EthereumDurableTargetContextRequestV1,
  settledAt: CanonicalTime,
  startedAt: CanonicalTime,
): ReviewedContext {
  let verified: boolean;
  try {
    verified = reader.verify(capability, issuedRequest) === true;
  } catch {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  if (!verified) return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  assertBoundedPlainData(capability, MAX_CONTEXT_BYTES);
  const record = exactDataRecord(capability, [
    'contextVersion',
    'use',
    'mayAuthorizeFinancialAction',
    'mayPersist',
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
    record.contextVersion !== AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION ||
    record.use !== AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
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
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    capability,
    walletAddress: record.walletAddress,
    continuityFloor: evmAnchor(record.continuityFloor),
    resolvedAt: resolvedAt.timestamp,
    resolvedAtMilliseconds: resolvedAt.milliseconds,
  });
}

function definitionFor(asset: ProviderPositionAdmissionAssetV1): AssetDefinition {
  const definition = ASSET_DEFINITIONS.find((candidate) => candidate.identity === asset.identity);
  if (definition === undefined) return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
  return definition;
}

function balanceCallData(walletAddress: string): string {
  return `${BALANCE_OF_SELECTOR}${'0'.repeat(24)}${walletAddress.slice(2)}`;
}

function balanceReads(
  assets: readonly ProviderPositionAdmissionAssetV1[],
  walletAddress: string,
): readonly AaveV3EthereumPositionBalanceReadV1[] {
  return Object.freeze(
    assets.flatMap((asset) => {
      const definition = definitionFor(asset);
      const callData = balanceCallData(walletAddress);
      return [
        Object.freeze({
          operationId: `${definition.stablecoin.toLowerCase()}-supply`,
          stablecoin: definition.stablecoin,
          positionKind: 'SUPPLY' as const,
          tokenAddress: definition.aTokenAddress,
          callData,
        }),
        Object.freeze({
          operationId: `${definition.stablecoin.toLowerCase()}-borrow`,
          stablecoin: definition.stablecoin,
          positionKind: 'BORROW' as const,
          tokenAddress: definition.variableDebtTokenAddress,
          callData,
        }),
      ];
    }),
  );
}

function transcriptRequest(
  request: ReviewedRequest,
  context: ReviewedContext,
): ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1 {
  return Object.freeze({
    transcriptVersion: AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    accountId: request.accountId,
    correlationId: request.correlationId,
    walletId: request.walletId,
    walletAddress: context.walletAddress,
    providerId: PROVIDER_ID,
    protocolId: PROTOCOL_ID,
    marketId: MARKET_ID,
    networkId: NETWORK_ID,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    expectedChainId: EXPECTED_CHAIN_ID,
    blockSelector: BLOCK_SELECTOR,
    blockBinding: BLOCK_BINDING,
    continuityFloor: context.continuityFloor,
    assets: request.assets,
    balanceReads: balanceReads(request.assets, context.walletAddress),
    maximumResponseBytes: MAX_TRANSCRIPT_BYTES,
    deadlineAt: request.deadlineAt,
    signal: request.signal,
    durableContext: context.capability,
  });
}

function hexQuantity(value: unknown): string {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const decimal = BigInt(value).toString(10);
  if (BigInt(decimal) > MAX_UINT256) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return decimal;
}

function reviewedBlock(value: unknown): ReviewedBlock {
  const record = exactDataRecord(value, ['number', 'hash']);
  if (
    typeof record.hash !== 'string' ||
    !EVM_BLOCK_HASH.test(record.hash) ||
    /^0x0{64}$/u.test(record.hash)
  ) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({ number: hexQuantity(record.number), hash: record.hash });
}

function sameBlock(left: ReviewedBlock, right: ReviewedBlock): boolean {
  return left.number === right.number && left.hash === right.hash;
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
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function expectedRead(
  request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  operationId: unknown,
): AaveV3EthereumPositionBalanceReadV1 {
  if (typeof operationId !== 'string') {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const found = request.balanceReads.find((read) => read.operationId === operationId);
  if (found === undefined) return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  return found;
}

function atomicBalance(value: unknown): string {
  if (typeof value !== 'string' || !ABI_UINT256.test(value)) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return BigInt(value).toString(10);
}

function parsedBalances(
  value: unknown,
  request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  block: ReviewedBlock,
): ReadonlyMap<string, string> {
  const balances = new Map<string, string>();
  for (const candidate of dataArray(value, request.balanceReads.length)) {
    const record = exactDataRecord(candidate, [
      'operationId',
      'stablecoin',
      'positionKind',
      'method',
      'tokenAddress',
      'callData',
      'blockParameter',
      'result',
    ]);
    const expected = expectedRead(request, record.operationId);
    const blockParameter = exactDataRecord(record.blockParameter, [
      'blockHash',
      'requireCanonical',
    ]);
    if (
      record.stablecoin !== expected.stablecoin ||
      record.positionKind !== expected.positionKind ||
      record.method !== 'eth_call' ||
      record.tokenAddress !== expected.tokenAddress ||
      record.callData !== expected.callData ||
      blockParameter.blockHash !== block.hash ||
      blockParameter.requireCanonical !== true ||
      balances.has(expected.operationId)
    ) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    balances.set(expected.operationId, atomicBalance(record.result));
  }
  if (balances.size !== request.balanceReads.length) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return balances;
}

function assertReserveTokens(
  value: unknown,
  assets: readonly ProviderPositionAdmissionAssetV1[],
): void {
  const seen = new Set<string>();
  for (const candidate of dataArray(value, assets.length)) {
    const record = exactDataRecord(candidate, [
      'stablecoin',
      'underlyingAsset',
      'aTokenAddress',
      'stableDebtTokenAddress',
      'variableDebtTokenAddress',
    ]);
    if (typeof record.underlyingAsset !== 'string') {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const asset = assets.find(({ identity }) => identity === record.underlyingAsset);
    if (asset === undefined || seen.has(asset.identity)) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    const definition = definitionFor(asset);
    if (
      record.stablecoin !== definition.stablecoin ||
      record.aTokenAddress !== definition.aTokenAddress ||
      record.stableDebtTokenAddress !== definition.stableDebtTokenAddress ||
      record.variableDebtTokenAddress !== definition.variableDebtTokenAddress
    ) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
    seen.add(asset.identity);
  }
  if (seen.size !== assets.length) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
}

function positions(
  request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  balances: ReadonlyMap<string, string>,
): readonly ProviderPositionAdmissionPositionV1[] {
  const result: ProviderPositionAdmissionPositionV1[] = [];
  for (const asset of request.assets) {
    const definition = definitionFor(asset);
    for (const positionKind of ['SUPPLY', 'BORROW'] as const) {
      const operationId = `${definition.stablecoin.toLowerCase()}-${positionKind.toLowerCase()}`;
      const atomic = balances.get(operationId);
      if (atomic === undefined) return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      if (atomic === '0') continue;
      result.push(
        Object.freeze({
          positionId: `${PROTOCOL_ID}-${request.walletId}-${definition.stablecoin.toLowerCase()}-${positionKind.toLowerCase()}`,
          positionKind,
          asset,
          balance: Object.freeze({
            atomic,
            decimal: mainnetProviderPositionDecimalFromAtomic(atomic, asset.decimals),
          }),
        }),
      );
    }
  }
  return Object.freeze(result);
}

function evidence(
  capability: unknown,
  issuedRequest: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  request: ReviewedRequest,
  context: ReviewedContext,
  reader: CapturedTranscriptReader,
  settledAt: CanonicalTime,
): ProviderPositionAdmissionSourceEvidenceV1 {
  let verified: boolean;
  try {
    verified = reader.verify(capability, issuedRequest) === true;
  } catch {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  if (!verified) return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  assertBoundedPlainData(capability, MAX_TRANSCRIPT_BYTES);
  const record = exactDataRecord(capability, [
    'transcriptVersion',
    'use',
    'mayAuthorizeFinancialAction',
    'mayPersist',
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
    'chainIdBefore',
    'chainIdAfter',
    'blockBefore',
    'blockAfter',
    'reserveTokens',
    'balanceReads',
    'observedAt',
    'staleAfter',
    'status',
    'zeroPositionSemantics',
  ]);
  if (
    record.transcriptVersion !== AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION ||
    record.use !== AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.accountId !== request.accountId ||
    record.correlationId !== request.correlationId ||
    record.walletId !== request.walletId ||
    record.walletAddress !== context.walletAddress ||
    record.providerId !== PROVIDER_ID ||
    record.protocolId !== PROTOCOL_ID ||
    record.marketId !== MARKET_ID ||
    record.networkId !== NETWORK_ID ||
    record.sourceFamilyId !== reader.sourceFamilyId ||
    record.sourceId !== reader.sourceId ||
    record.chainIdBefore !== EXPECTED_CHAIN_ID ||
    record.chainIdAfter !== EXPECTED_CHAIN_ID ||
    record.status !== 'COMPLETE' ||
    record.zeroPositionSemantics !== 'EXPLICIT_ZERO_BALANCE_FOR_EVERY_REQUESTED_ASSET'
  ) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  const before = reviewedBlock(record.blockBefore);
  const after = reviewedBlock(record.blockAfter);
  if (!sameBlock(before, after)) return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  assertNonRegressing(context.continuityFloor, before);
  assertReserveTokens(record.reserveTokens, request.assets);
  const balances = parsedBalances(record.balanceReads, issuedRequest, before);
  const observedAt = canonicalTime(record.observedAt);
  const staleAfter = canonicalTime(record.staleAfter);
  const policy = chainObservationPolicyForNetwork(NETWORK_ID);
  if (
    policy?.environment !== 'MAINNET' ||
    observedAt.milliseconds < context.resolvedAtMilliseconds ||
    observedAt.milliseconds > settledAt.milliseconds ||
    staleAfter.milliseconds <= settledAt.milliseconds ||
    staleAfter.milliseconds <= observedAt.milliseconds ||
    staleAfter.milliseconds > observedAt.milliseconds + policy.freshness.currentWithinMs
  ) {
    return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
  }
  return Object.freeze({
    evidenceVersion: PROVIDER_POSITION_ADMISSION_VERSION,
    use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
    mayAuthorizeFinancialAction: false,
    accountId: request.accountId,
    correlationId: request.correlationId,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: 'RPC',
    sourceObservationId: `ethereum-block-${before.number}`,
    walletId: request.walletId,
    providerId: PROVIDER_ID,
    protocolId: PROTOCOL_ID,
    marketId: MARKET_ID,
    networkId: NETWORK_ID,
    assets: request.assets,
    status: 'COMPLETE',
    observedAt: observedAt.timestamp,
    staleAfter: staleAfter.timestamp,
    continuityFloor: context.continuityFloor,
    chainAnchor: Object.freeze({
      kind: 'EVM_BLOCK',
      blockNumber: before.number,
      blockHash: before.hash,
    }),
    positions: positions(issuedRequest, balances),
  });
}

/**
 * Dormant Aave V3 Ethereum account-position source. It owns no endpoint,
 * credential, database handle, timer, registration, persistence, or financial
 * authority. A production binding still requires two independent outer source
 * families, reviewed policy/configuration, egress, deployment, and live proof.
 */
export class DormantAaveV3EthereumProviderPositionSource implements ProviderPositionAdmissionSourcePort {
  readonly #contextReader: CapturedContextReader;
  readonly #transcriptReader: CapturedTranscriptReader;
  readonly #now: () => Date;

  constructor(
    contextReaderInput: AaveV3EthereumDurableTargetContextReaderPort,
    transcriptReaderInput: AaveV3EthereumFinalizedPositionTranscriptPort,
    clock: AaveV3EthereumProviderPositionSourceClock,
  ) {
    this.#contextReader = capturedContextReader(contextReaderInput);
    this.#transcriptReader = capturedTranscriptReader(transcriptReaderInput);
    this.#now = capturedClock(clock);
    if (
      this.#contextReader.receiver === this.#transcriptReader.receiver ||
      this.#contextReader.sourceFamilyId === this.#transcriptReader.sourceFamilyId ||
      this.#contextReader.sourceId === this.#transcriptReader.sourceId
    ) {
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION');
    }
  }

  async readTarget(
    requestInput: ReadProviderPositionAdmissionTargetRequestV1,
  ): Promise<ProviderPositionAdmissionSourceEvidenceV1> {
    try {
      const startedAt = clockTime(this.#now);
      const request = reviewedRequest(requestInput, startedAt);
      if (
        request.sourceFamilyId !== this.#transcriptReader.sourceFamilyId ||
        request.sourceId !== this.#transcriptReader.sourceId
      ) {
        return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST');
      }
      const issuedContextRequest = contextRequest(request);
      const contextCapability = await this.#contextReader.read(issuedContextRequest);
      const contextSettledAt = clockTime(this.#now);
      if (
        request.signal.aborted ||
        contextSettledAt.milliseconds < startedAt.milliseconds ||
        contextSettledAt.milliseconds >= request.deadlineAtMilliseconds
      ) {
        return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      const context = reviewedContext(
        contextCapability,
        request,
        this.#contextReader,
        issuedContextRequest,
        contextSettledAt,
        startedAt,
      );
      const issuedTranscriptRequest = transcriptRequest(request, context);
      const transcriptCapability = await this.#transcriptReader.read(issuedTranscriptRequest);
      const transcriptSettledAt = clockTime(this.#now);
      if (
        request.signal.aborted ||
        transcriptSettledAt.milliseconds < contextSettledAt.milliseconds ||
        transcriptSettledAt.milliseconds >= request.deadlineAtMilliseconds
      ) {
        return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      const result = evidence(
        transcriptCapability,
        issuedTranscriptRequest,
        request,
        context,
        this.#transcriptReader,
        transcriptSettledAt,
      );
      const completedAt = clockTime(this.#now);
      if (
        request.signal.aborted ||
        completedAt.milliseconds < transcriptSettledAt.milliseconds ||
        completedAt.milliseconds >= request.deadlineAtMilliseconds ||
        completedAt.milliseconds >= Date.parse(result.staleAfter)
      ) {
        return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
      }
      return result;
    } catch (error) {
      if (error instanceof DormantAaveV3EthereumProviderPositionSourceError) throw error;
      return fail('AAVE_V3_ETHEREUM_POSITION_SOURCE_UNAVAILABLE');
    }
  }
}
