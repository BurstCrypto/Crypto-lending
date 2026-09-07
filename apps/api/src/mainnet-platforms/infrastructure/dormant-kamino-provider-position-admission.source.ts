import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import { parseSolanaWalletAddress } from '../../wallets/domain/wallet-identity';
import {
  mainnetProviderPositionDecimalFromAtomic,
  type MainnetProviderPositionSourceKind,
} from '../domain/mainnet-provider-position-observation';
import {
  PROVIDER_POSITION_ADMISSION_SOURCE_USE,
  PROVIDER_POSITION_ADMISSION_VERSION,
  type ProviderPositionAdmissionAssetV1,
  type ProviderPositionAdmissionChainAnchorV1,
  type ProviderPositionAdmissionPositionV1,
  type ProviderPositionAdmissionSourceEvidenceV1,
  type ProviderPositionAdmissionSourcePort,
  type ReadProviderPositionAdmissionTargetRequestV1,
} from '../application/provider-position-admission.coordinator';
import {
  KAMINO_LEND_SOLANA_MAINNET_IDENTITIES,
  KAMINO_LEND_SOLANA_SOURCE_PINS,
} from '../../smart-lending/infrastructure/kamino/kamino-lend-solana-finalized-transcript.adapter';

const NETWORK_ID = KAMINO_LEND_SOLANA_MAINNET_IDENTITIES.networkId;
const GENESIS_HASH = KAMINO_LEND_SOLANA_MAINNET_IDENTITIES.genesisHash;
const PROGRAM_ADDRESS = KAMINO_LEND_SOLANA_MAINNET_IDENTITIES.programAddress;
const MARKET_ADDRESS = KAMINO_LEND_SOLANA_MAINNET_IDENTITIES.lendingMarketAddress;
const RESERVE_ADDRESS = KAMINO_LEND_SOLANA_MAINNET_IDENTITIES.usdcReserveAddress;
const USDC_MINT_ADDRESS = KAMINO_LEND_SOLANA_MAINNET_IDENTITIES.usdcMintAddress;
const KLEND_SDK_COMMIT_SHA = KAMINO_LEND_SOLANA_SOURCE_PINS.klendSdkCommitSha;
const PROVIDER_ID = 'kamino' as const;
const PROTOCOL_ID = 'kamino-lend' as const;
const MARKET_ID = 'kamino-lend-solana-mainnet-main-usdc' as const;

export const DORMANT_KAMINO_POSITION_TARGET_CONTEXT_VERSION = 1 as const;
export const DORMANT_KAMINO_POSITION_TARGET_CONTEXT_USE =
  'DORMANT_KAMINO_POSITION_TARGET_CONTEXT_ONLY' as const;
export const DORMANT_KAMINO_POSITION_TRANSCRIPT_VERSION = 1 as const;
export const DORMANT_KAMINO_POSITION_TRANSCRIPT_USE =
  'DORMANT_KAMINO_FINALIZED_ACCOUNT_TRANSCRIPT_ONLY' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const SOURCE_FAMILY_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const SOURCE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,19})$/u;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ZERO_SHA256 = '0'.repeat(64);
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const MAX_TRANSCRIPT_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_NODES = 2_048;
const MAX_TRANSCRIPT_DEPTH = 12;
const MAX_LINEAGE_BLOCKS = 128;
const MAX_OBLIGATION_ACCOUNTS = 16;
const MAX_ACCOUNT_DATA_BYTES = 32 * 1024;

const CANONICAL_DATE_GET_TIME = Date.prototype.getTime;
const CANONICAL_DATE_TO_ISO_STRING = Date.prototype.toISOString;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

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
  'canonicalWalletAddress',
  'continuityFloor',
  'continuityFloorBlockhash',
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
  'canonicalWalletAddress',
  'commitment',
  'genesisHash',
  'programAddress',
  'lendingMarketAddress',
  'reserveAddress',
  'assetMintAddress',
  'decoderCommitSha',
  'finalizedRootSlot',
  'finalizedRootBlockhash',
  'lineage',
  'coverage',
] as const);
const LINEAGE_KEYS = Object.freeze([
  'slot',
  'blockhash',
  'parentSlot',
  'previousBlockhash',
] as const);
const COVERAGE_KEYS = Object.freeze([
  'status',
  'contextSlot',
  'nextPageToken',
  'matchedAccountCount',
  'accounts',
] as const);
const ACCOUNT_KEYS = Object.freeze([
  'accountAddress',
  'ownerProgramAddress',
  'executable',
  'lamports',
  'rentEpoch',
  'space',
  'accountDataBase64',
  'accountDataSha256',
  'decodeStatus',
  'decodedOwnerAddress',
  'lendingMarketAddress',
  'positions',
] as const);
const POSITION_KEYS = Object.freeze([
  'positionKind',
  'reserveAddress',
  'assetMintAddress',
  'amountAtomic',
] as const);

export interface DormantKaminoProviderPositionAdmissionSourceConfig {
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: 'RPC';
}

/**
 * Exact authority-free request for a durable wallet target and continuity
 * floor. Implementations may read already-authorized durable state, but this
 * boundary grants no decryption, private-key access, signing, or persistence.
 */
export interface ReadDormantKaminoPositionTargetContextRequestV1 {
  readonly contextVersion: typeof DORMANT_KAMINO_POSITION_TARGET_CONTEXT_VERSION;
  readonly use: typeof DORMANT_KAMINO_POSITION_TARGET_CONTEXT_USE;
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

export interface DormantKaminoPositionTargetContextCapabilityV1 {
  readonly contextVersion: typeof DORMANT_KAMINO_POSITION_TARGET_CONTEXT_VERSION;
  readonly use: typeof DORMANT_KAMINO_POSITION_TARGET_CONTEXT_USE;
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
  readonly canonicalWalletAddress: string;
  readonly continuityFloor: Readonly<{
    readonly kind: 'SOLANA_SLOT';
    readonly slot: string;
    readonly root: string;
  }>;
  /** Required internally because the public admission anchor cannot carry it. */
  readonly continuityFloorBlockhash: string;
}

export interface DormantKaminoPositionTargetContextReader {
  readContext(request: ReadDormantKaminoPositionTargetContextRequestV1): Promise<unknown>;
  reviewContext(
    capability: unknown,
    request: ReadDormantKaminoPositionTargetContextRequestV1,
  ): unknown | null;
}

export interface ReadDormantKaminoFinalizedAccountTranscriptRequestV1 {
  readonly transcriptVersion: typeof DORMANT_KAMINO_POSITION_TRANSCRIPT_VERSION;
  readonly use: typeof DORMANT_KAMINO_POSITION_TRANSCRIPT_USE;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly maySign: false;
  readonly mayAccessWalletPrivateKey: false;
  readonly admissionRequest: ReadProviderPositionAdmissionTargetRequestV1;
  readonly contextRequest: ReadDormantKaminoPositionTargetContextRequestV1;
  readonly contextCapability: DormantKaminoPositionTargetContextCapabilityV1;
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
  readonly canonicalWalletAddress: string;
  readonly continuityFloor: DormantKaminoPositionTargetContextCapabilityV1['continuityFloor'];
  readonly continuityFloorBlockhash: string;
  readonly commitment: 'finalized';
  readonly genesisHash: typeof GENESIS_HASH;
  readonly programAddress: typeof PROGRAM_ADDRESS;
  readonly lendingMarketAddress: typeof MARKET_ADDRESS;
  readonly reserveAddress: typeof RESERVE_ADDRESS;
  readonly assetMintAddress: typeof USDC_MINT_ADDRESS;
  readonly decoderCommitSha: typeof KLEND_SDK_COMMIT_SHA;
}

/**
 * Owns no endpoint, client, credentials, DNS, TLS, retry, signer, or ambient
 * configuration. A future runtime must supply and separately review a closed,
 * read-only transcript capability for the exact request identity.
 */
export interface DormantKaminoFinalizedAccountTranscriptTransport {
  readTranscript(request: ReadDormantKaminoFinalizedAccountTranscriptRequestV1): Promise<unknown>;
  reviewTranscript(
    capability: unknown,
    request: ReadDormantKaminoFinalizedAccountTranscriptRequestV1,
  ): unknown | null;
}

export interface DormantKaminoProviderPositionAdmissionClock {
  now(): Date;
}

export type DormantKaminoProviderPositionAdmissionSourceErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'CONTEXT_UNAVAILABLE'
  | 'TRANSCRIPT_UNAVAILABLE'
  | 'ABORTED'
  | 'DEADLINE_EXCEEDED'
  | 'CLOCK_REGRESSION';

export class DormantKaminoProviderPositionAdmissionSourceUnavailableError extends Error {
  constructor(readonly code: DormantKaminoProviderPositionAdmissionSourceErrorCode) {
    super('Kamino provider-position source is unavailable.');
    this.name = 'DormantKaminoProviderPositionAdmissionSourceUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface CanonicalTime {
  readonly value: string;
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
  readonly sourceKind: 'RPC';
  readonly walletId: string;
  readonly asset: ProviderPositionAdmissionAssetV1;
}

interface ReviewedContext {
  readonly capability: DormantKaminoPositionTargetContextCapabilityV1;
  readonly canonicalWalletAddress: string;
  readonly continuityFloor: Readonly<{
    readonly kind: 'SOLANA_SLOT';
    readonly slot: string;
    readonly root: string;
  }>;
  readonly continuityFloorBlockhash: string;
}

interface ParsedTranscript {
  readonly finalizedRootSlot: string;
  readonly positions: readonly ProviderPositionAdmissionPositionV1[];
}

interface CapturedMethod {
  readonly receiver: object;
  readonly method: (...arguments_: readonly unknown[]) => unknown;
}

function fail(code: DormantKaminoProviderPositionAdmissionSourceErrorCode): never {
  throw new DormantKaminoProviderPositionAdmissionSourceUnavailableError(code);
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  code: DormantKaminoProviderPositionAdmissionSourceErrorCode,
  requireFrozen: boolean,
  requireNullPrototype = false,
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
    if (
      (requireNullPrototype && prototype !== null) ||
      (!requireNullPrototype && prototype !== Object.prototype && prototype !== null)
    ) {
      return fail(code);
    }
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
    if (error instanceof DormantKaminoProviderPositionAdmissionSourceUnavailableError) throw error;
    return fail(code);
  }
}

function exactDataArray(
  value: unknown,
  maximumLength: number,
  code: DormantKaminoProviderPositionAdmissionSourceErrorCode,
): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isFrozen(value)
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
    if (error instanceof DormantKaminoProviderPositionAdmissionSourceUnavailableError) throw error;
    return fail(code);
  }
}

function stableDataMember(value: object, key: PropertyKey): unknown {
  try {
    let current: object | null = value;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (isProxy(current)) return fail('INVALID_CONFIGURATION');
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!('value' in descriptor)) return fail('INVALID_CONFIGURATION');
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail('INVALID_CONFIGURATION');
  } catch (error) {
    if (error instanceof DormantKaminoProviderPositionAdmissionSourceUnavailableError) throw error;
    return fail('INVALID_CONFIGURATION');
  }
}

function captureMethod(value: unknown, key: string): CapturedMethod {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const receiver = value as object;
  const method = stableDataMember(receiver, key);
  if (typeof method !== 'function' || isProxy(method)) return fail('INVALID_CONFIGURATION');
  return Object.freeze({
    receiver,
    method: method as (...arguments_: readonly unknown[]) => unknown,
  });
}

function invoke(method: CapturedMethod, arguments_: readonly unknown[]): unknown {
  return Reflect.apply(method.method, method.receiver, arguments_);
}

function canonicalTimestamp(
  value: unknown,
  code: DormantKaminoProviderPositionAdmissionSourceErrorCode,
): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  try {
    if (
      !Number.isSafeInteger(milliseconds) ||
      Reflect.apply(CANONICAL_DATE_TO_ISO_STRING, new Date(milliseconds), []) !== value
    ) {
      return fail(code);
    }
  } catch {
    return fail(code);
  }
  return Object.freeze({ value, milliseconds });
}

function canonicalClock(value: unknown): CanonicalTime {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Date.prototype
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    const milliseconds = Reflect.apply(CANONICAL_DATE_GET_TIME, value, []) as number;
    if (!Number.isSafeInteger(milliseconds)) return fail('INVALID_CONFIGURATION');
    const timestamp = Reflect.apply(CANONICAL_DATE_TO_ISO_STRING, value, []) as string;
    return Object.freeze({ value: timestamp, milliseconds });
  } catch (error) {
    if (error instanceof DormantKaminoProviderPositionAdmissionSourceUnavailableError) throw error;
    return fail('INVALID_CONFIGURATION');
  }
}

function signal(value: unknown): AbortSignal {
  try {
    if (
      ABORTED_GETTER === undefined ||
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype
    ) {
      return fail('INVALID_REQUEST');
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch (error) {
    if (error instanceof DormantKaminoProviderPositionAdmissionSourceUnavailableError) throw error;
    return fail('INVALID_REQUEST');
  }
}

function isAborted(value: AbortSignal): boolean {
  try {
    if (ABORTED_GETTER === undefined) return fail('INVALID_REQUEST');
    return Reflect.apply(ABORTED_GETTER, value, []) as boolean;
  } catch (error) {
    if (error instanceof DormantKaminoProviderPositionAdmissionSourceUnavailableError) throw error;
    return fail('INVALID_REQUEST');
  }
}

function assertActive(
  signalValue: AbortSignal,
  now: CanonicalTime,
  deadlineAt: CanonicalTime,
): void {
  if (isAborted(signalValue)) return fail('ABORTED');
  if (now.milliseconds >= deadlineAt.milliseconds) return fail('DEADLINE_EXCEEDED');
}

function canonicalUnsignedInteger(
  value: unknown,
  code: DormantKaminoProviderPositionAdmissionSourceErrorCode,
): string {
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED_INTEGER.test(value)) return fail(code);
  try {
    if (BigInt(value) > MAX_UINT64) return fail(code);
  } catch {
    return fail(code);
  }
  return value;
}

function positiveUnsignedInteger(
  value: unknown,
  code: DormantKaminoProviderPositionAdmissionSourceErrorCode,
): string {
  const canonical = canonicalUnsignedInteger(value, code);
  if (canonical === '0') return fail(code);
  return canonical;
}

function canonicalPublicKey(
  value: unknown,
  code: DormantKaminoProviderPositionAdmissionSourceErrorCode,
): string {
  try {
    return parseSolanaWalletAddress(value);
  } catch {
    return fail(code);
  }
}

function assertIdentityFields(
  record: Record<string, unknown>,
  request: ReviewedRequest,
  code: DormantKaminoProviderPositionAdmissionSourceErrorCode,
): void {
  if (
    record.accountId !== request.accountId ||
    record.correlationId !== request.correlationId ||
    record.deadlineAt !== request.deadlineAt.value ||
    record.sourceFamilyId !== request.sourceFamilyId ||
    record.sourceId !== request.sourceId ||
    record.sourceKind !== request.sourceKind ||
    record.walletId !== request.walletId ||
    record.providerId !== PROVIDER_ID ||
    record.protocolId !== PROTOCOL_ID ||
    record.marketId !== MARKET_ID ||
    record.networkId !== NETWORK_ID
  ) {
    return fail(code);
  }
}

function parseSourceConfig(value: unknown): DormantKaminoProviderPositionAdmissionSourceConfig {
  const record = exactDataRecord(
    value,
    ['sourceFamilyId', 'sourceId', 'sourceKind'],
    'INVALID_CONFIGURATION',
    false,
  );
  if (
    typeof record.sourceFamilyId !== 'string' ||
    !SOURCE_FAMILY_ID.test(record.sourceFamilyId) ||
    typeof record.sourceId !== 'string' ||
    !SOURCE_ID.test(record.sourceId) ||
    record.sourceKind !== 'RPC'
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  return Object.freeze({
    sourceFamilyId: record.sourceFamilyId,
    sourceId: record.sourceId,
    sourceKind: 'RPC' as const,
  });
}

function parseAsset(value: unknown): ProviderPositionAdmissionAssetV1 {
  const record = exactDataRecord(value, ASSET_KEYS, 'INVALID_REQUEST', true);
  if (
    record.stablecoin !== 'USDC' ||
    record.networkId !== NETWORK_ID ||
    record.identity !== USDC_MINT_ADDRESS ||
    record.decimals !== 6
  ) {
    return fail('INVALID_REQUEST');
  }
  return frozenNullPrototype({
    stablecoin: 'USDC' as const,
    networkId: NETWORK_ID,
    identity: USDC_MINT_ADDRESS,
    decimals: 6,
  });
}

function parseAdmissionRequest(
  value: unknown,
  config: DormantKaminoProviderPositionAdmissionSourceConfig,
): ReviewedRequest {
  const record = exactDataRecord(value, ADMISSION_REQUEST_KEYS, 'INVALID_REQUEST', true);
  let accountId: AccountId;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('INVALID_REQUEST');
  }
  const deadlineAt = canonicalTimestamp(record.deadlineAt, 'INVALID_REQUEST');
  const requestSignal = signal(record.signal);
  const assets = exactDataArray(record.assets, 1, 'INVALID_REQUEST');
  if (
    record.admissionVersion !== PROVIDER_POSITION_ADMISSION_VERSION ||
    typeof record.correlationId !== 'string' ||
    !CORRELATION_ID.test(record.correlationId) ||
    record.sourceFamilyId !== config.sourceFamilyId ||
    record.sourceId !== config.sourceId ||
    record.sourceKind !== config.sourceKind ||
    typeof record.walletId !== 'string' ||
    !UUID_V4.test(record.walletId) ||
    record.providerId !== PROVIDER_ID ||
    record.protocolId !== PROTOCOL_ID ||
    record.marketId !== MARKET_ID ||
    record.networkId !== NETWORK_ID ||
    assets.length !== 1
  ) {
    return fail('INVALID_REQUEST');
  }
  return Object.freeze({
    request: value as ReadProviderPositionAdmissionTargetRequestV1,
    accountId,
    correlationId: record.correlationId,
    deadlineAt,
    signal: requestSignal,
    sourceFamilyId: config.sourceFamilyId,
    sourceId: config.sourceId,
    sourceKind: config.sourceKind,
    walletId: record.walletId,
    asset: parseAsset(assets[0]),
  });
}

function createContextRequest(
  request: ReviewedRequest,
): ReadDormantKaminoPositionTargetContextRequestV1 {
  return frozenNullPrototype({
    contextVersion: DORMANT_KAMINO_POSITION_TARGET_CONTEXT_VERSION,
    use: DORMANT_KAMINO_POSITION_TARGET_CONTEXT_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    maySign: false as const,
    mayAccessWalletPrivateKey: false as const,
    admissionRequest: request.request,
    accountId: request.accountId,
    correlationId: request.correlationId,
    deadlineAt: request.deadlineAt.value,
    signal: request.signal,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: request.sourceKind,
    walletId: request.walletId,
    providerId: PROVIDER_ID,
    protocolId: PROTOCOL_ID,
    marketId: MARKET_ID,
    networkId: NETWORK_ID,
  });
}

function parseContinuityFloor(
  value: unknown,
  code: DormantKaminoProviderPositionAdmissionSourceErrorCode,
): Readonly<{ readonly kind: 'SOLANA_SLOT'; readonly slot: string; readonly root: string }> {
  const record = exactDataRecord(value, ['kind', 'slot', 'root'], code, true, true);
  const slot = positiveUnsignedInteger(record.slot, code);
  const root = positiveUnsignedInteger(record.root, code);
  if (record.kind !== 'SOLANA_SLOT' || BigInt(root) > BigInt(slot)) return fail(code);
  return frozenNullPrototype({ kind: 'SOLANA_SLOT' as const, slot, root });
}

function parseContextCapability(value: unknown, request: ReviewedRequest): ReviewedContext {
  const record = exactDataRecord(value, CONTEXT_CAPABILITY_KEYS, 'CONTEXT_UNAVAILABLE', true, true);
  if (
    record.contextVersion !== DORMANT_KAMINO_POSITION_TARGET_CONTEXT_VERSION ||
    record.use !== DORMANT_KAMINO_POSITION_TARGET_CONTEXT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.maySign !== false ||
    record.mayAccessWalletPrivateKey !== false
  ) {
    return fail('CONTEXT_UNAVAILABLE');
  }
  assertIdentityFields(record, request, 'CONTEXT_UNAVAILABLE');
  const canonicalWalletAddress = canonicalPublicKey(
    record.canonicalWalletAddress,
    'CONTEXT_UNAVAILABLE',
  );
  const continuityFloor = parseContinuityFloor(record.continuityFloor, 'CONTEXT_UNAVAILABLE');
  const continuityFloorBlockhash = canonicalPublicKey(
    record.continuityFloorBlockhash,
    'CONTEXT_UNAVAILABLE',
  );
  return Object.freeze({
    capability: value as DormantKaminoPositionTargetContextCapabilityV1,
    canonicalWalletAddress,
    continuityFloor,
    continuityFloorBlockhash,
  });
}

function createTranscriptRequest(
  request: ReviewedRequest,
  contextRequest: ReadDormantKaminoPositionTargetContextRequestV1,
  context: ReviewedContext,
): ReadDormantKaminoFinalizedAccountTranscriptRequestV1 {
  return frozenNullPrototype({
    transcriptVersion: DORMANT_KAMINO_POSITION_TRANSCRIPT_VERSION,
    use: DORMANT_KAMINO_POSITION_TRANSCRIPT_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    maySign: false as const,
    mayAccessWalletPrivateKey: false as const,
    admissionRequest: request.request,
    contextRequest,
    contextCapability: context.capability,
    accountId: request.accountId,
    correlationId: request.correlationId,
    deadlineAt: request.deadlineAt.value,
    signal: request.signal,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: request.sourceKind,
    walletId: request.walletId,
    providerId: PROVIDER_ID,
    protocolId: PROTOCOL_ID,
    marketId: MARKET_ID,
    networkId: NETWORK_ID,
    canonicalWalletAddress: context.canonicalWalletAddress,
    continuityFloor: context.continuityFloor,
    continuityFloorBlockhash: context.continuityFloorBlockhash,
    commitment: 'finalized' as const,
    genesisHash: GENESIS_HASH,
    programAddress: PROGRAM_ADDRESS,
    lendingMarketAddress: MARKET_ADDRESS,
    reserveAddress: RESERVE_ADDRESS,
    assetMintAddress: USDC_MINT_ADDRESS,
    decoderCommitSha: KLEND_SDK_COMMIT_SHA,
  });
}

function assertBoundedTranscript(value: unknown): void {
  try {
    const seen = new WeakSet<object>();
    let bytes = 0;
    let nodes = 0;
    const visit = (candidate: unknown, depth: number): void => {
      nodes += 1;
      if (nodes > MAX_TRANSCRIPT_NODES || depth > MAX_TRANSCRIPT_DEPTH) {
        return fail('TRANSCRIPT_UNAVAILABLE');
      }
      if (candidate === null || typeof candidate === 'boolean') bytes += 5;
      else if (typeof candidate === 'string') bytes += Buffer.byteLength(candidate, 'utf8') + 2;
      else if (typeof candidate === 'number') {
        if (!Number.isSafeInteger(candidate)) return fail('TRANSCRIPT_UNAVAILABLE');
        bytes += 32;
      } else if (typeof candidate === 'object') {
        if (isProxy(candidate) || seen.has(candidate)) return fail('TRANSCRIPT_UNAVAILABLE');
        seen.add(candidate);
        if (!Object.isFrozen(candidate)) return fail('TRANSCRIPT_UNAVAILABLE');
        const array = Array.isArray(candidate);
        const prototype = Object.getPrototypeOf(candidate) as unknown;
        if (
          (array && prototype !== Array.prototype) ||
          (!array && prototype !== Object.prototype && prototype !== null)
        ) {
          return fail('TRANSCRIPT_UNAVAILABLE');
        }
        const descriptors = Object.getOwnPropertyDescriptors(
          candidate,
        ) as unknown as PropertyDescriptorMap;
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (array && key === 'length') continue;
          if (!descriptor.enumerable || !('value' in descriptor)) {
            return fail('TRANSCRIPT_UNAVAILABLE');
          }
          bytes += Buffer.byteLength(key, 'utf8') + 3;
          visit(descriptor.value, depth + 1);
        }
        if (Object.getOwnPropertySymbols(candidate).length > 0) {
          return fail('TRANSCRIPT_UNAVAILABLE');
        }
      } else return fail('TRANSCRIPT_UNAVAILABLE');
      if (bytes > MAX_TRANSCRIPT_BYTES) return fail('TRANSCRIPT_UNAVAILABLE');
    };
    visit(value, 0);
  } catch (error) {
    if (error instanceof DormantKaminoProviderPositionAdmissionSourceUnavailableError) throw error;
    return fail('TRANSCRIPT_UNAVAILABLE');
  }
}

function parseLineage(
  value: unknown,
  context: ReviewedContext,
  finalizedRootSlot: string,
  finalizedRootBlockhash: string,
): void {
  const entries = exactDataArray(value, MAX_LINEAGE_BLOCKS, 'TRANSCRIPT_UNAVAILABLE');
  if (entries.length === 0) return fail('TRANSCRIPT_UNAVAILABLE');
  let previousSlot: string | undefined;
  let previousBlockhash: string | undefined;
  entries.forEach((entry, index) => {
    const record = exactDataRecord(entry, LINEAGE_KEYS, 'TRANSCRIPT_UNAVAILABLE', true, true);
    const slot = positiveUnsignedInteger(record.slot, 'TRANSCRIPT_UNAVAILABLE');
    const blockhash = canonicalPublicKey(record.blockhash, 'TRANSCRIPT_UNAVAILABLE');
    const parentSlot = canonicalUnsignedInteger(record.parentSlot, 'TRANSCRIPT_UNAVAILABLE');
    const parentBlockhash = canonicalPublicKey(record.previousBlockhash, 'TRANSCRIPT_UNAVAILABLE');
    if (
      BigInt(parentSlot) >= BigInt(slot) ||
      blockhash === parentBlockhash ||
      (index === 0 &&
        (slot !== context.continuityFloor.slot ||
          blockhash !== context.continuityFloorBlockhash)) ||
      (index > 0 &&
        (parentSlot !== previousSlot ||
          parentBlockhash !== previousBlockhash ||
          previousSlot === undefined ||
          BigInt(slot) <= BigInt(previousSlot)))
    ) {
      return fail('TRANSCRIPT_UNAVAILABLE');
    }
    previousSlot = slot;
    previousBlockhash = blockhash;
  });
  if (previousSlot !== finalizedRootSlot || previousBlockhash !== finalizedRootBlockhash) {
    return fail('TRANSCRIPT_UNAVAILABLE');
  }
}

function accountDataBytes(base64Value: unknown, expectedSpace: string): Buffer {
  if (
    typeof base64Value !== 'string' ||
    base64Value.length === 0 ||
    !CANONICAL_BASE64.test(base64Value)
  ) {
    return fail('TRANSCRIPT_UNAVAILABLE');
  }
  const bytes = Buffer.from(base64Value, 'base64');
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_ACCOUNT_DATA_BYTES ||
    bytes.toString('base64') !== base64Value ||
    BigInt(expectedSpace) !== BigInt(bytes.byteLength)
  ) {
    return fail('TRANSCRIPT_UNAVAILABLE');
  }
  return bytes;
}

function parseAccountPositions(value: unknown): Readonly<{ supply: bigint; borrow: bigint }> {
  const values = exactDataArray(value, 2, 'TRANSCRIPT_UNAVAILABLE');
  const seen = new Set<string>();
  let supply = 0n;
  let borrow = 0n;
  for (const candidate of values) {
    const record = exactDataRecord(candidate, POSITION_KEYS, 'TRANSCRIPT_UNAVAILABLE', true, true);
    if (
      (record.positionKind !== 'SUPPLY' && record.positionKind !== 'BORROW') ||
      seen.has(record.positionKind) ||
      record.reserveAddress !== RESERVE_ADDRESS ||
      record.assetMintAddress !== USDC_MINT_ADDRESS
    ) {
      return fail('TRANSCRIPT_UNAVAILABLE');
    }
    seen.add(record.positionKind);
    const amount = BigInt(positiveUnsignedInteger(record.amountAtomic, 'TRANSCRIPT_UNAVAILABLE'));
    if (record.positionKind === 'SUPPLY') supply = amount;
    else borrow = amount;
  }
  return Object.freeze({ supply, borrow });
}

function addUint64(left: bigint, right: bigint): bigint {
  const sum = left + right;
  if (sum > MAX_UINT64) return fail('TRANSCRIPT_UNAVAILABLE');
  return sum;
}

function position(
  positionKind: 'SUPPLY' | 'BORROW',
  amount: bigint,
  asset: ProviderPositionAdmissionAssetV1,
): ProviderPositionAdmissionPositionV1 {
  const atomic = amount.toString(10);
  return frozenNullPrototype({
    positionId: positionKind === 'SUPPLY' ? 'kamino-usdc-supply' : 'kamino-usdc-borrow',
    positionKind,
    asset: frozenNullPrototype({
      stablecoin: asset.stablecoin,
      networkId: asset.networkId,
      identity: asset.identity,
      decimals: asset.decimals,
    }),
    balance: frozenNullPrototype({
      atomic,
      decimal: mainnetProviderPositionDecimalFromAtomic(atomic, asset.decimals),
    }),
  });
}

function parseCoverage(
  value: unknown,
  context: ReviewedContext,
  finalizedRootSlot: string,
  asset: ProviderPositionAdmissionAssetV1,
): readonly ProviderPositionAdmissionPositionV1[] {
  const record = exactDataRecord(value, COVERAGE_KEYS, 'TRANSCRIPT_UNAVAILABLE', true, true);
  const contextSlot = positiveUnsignedInteger(record.contextSlot, 'TRANSCRIPT_UNAVAILABLE');
  const accounts = exactDataArray(
    record.accounts,
    MAX_OBLIGATION_ACCOUNTS,
    'TRANSCRIPT_UNAVAILABLE',
  );
  const matchedAccountCount = canonicalUnsignedInteger(
    record.matchedAccountCount,
    'TRANSCRIPT_UNAVAILABLE',
  );
  if (
    record.status !== 'COMPLETE' ||
    record.nextPageToken !== null ||
    contextSlot !== finalizedRootSlot ||
    BigInt(matchedAccountCount) !== BigInt(accounts.length)
  ) {
    return fail('TRANSCRIPT_UNAVAILABLE');
  }

  const seenAccounts = new Set<string>();
  let supply = 0n;
  let borrow = 0n;
  for (const candidate of accounts) {
    const account = exactDataRecord(candidate, ACCOUNT_KEYS, 'TRANSCRIPT_UNAVAILABLE', true, true);
    const accountAddress = canonicalPublicKey(account.accountAddress, 'TRANSCRIPT_UNAVAILABLE');
    if (
      seenAccounts.has(accountAddress) ||
      account.ownerProgramAddress !== PROGRAM_ADDRESS ||
      account.executable !== false ||
      account.decodeStatus !== 'COMPLETE' ||
      account.decodedOwnerAddress !== context.canonicalWalletAddress ||
      account.lendingMarketAddress !== MARKET_ADDRESS
    ) {
      return fail('TRANSCRIPT_UNAVAILABLE');
    }
    seenAccounts.add(accountAddress);
    positiveUnsignedInteger(account.lamports, 'TRANSCRIPT_UNAVAILABLE');
    canonicalUnsignedInteger(account.rentEpoch, 'TRANSCRIPT_UNAVAILABLE');
    const space = positiveUnsignedInteger(account.space, 'TRANSCRIPT_UNAVAILABLE');
    const bytes = accountDataBytes(account.accountDataBase64, space);
    if (
      typeof account.accountDataSha256 !== 'string' ||
      !SHA256.test(account.accountDataSha256) ||
      account.accountDataSha256 === ZERO_SHA256 ||
      createHash('sha256').update(bytes).digest('hex') !== account.accountDataSha256
    ) {
      return fail('TRANSCRIPT_UNAVAILABLE');
    }
    const amounts = parseAccountPositions(account.positions);
    supply = addUint64(supply, amounts.supply);
    borrow = addUint64(borrow, amounts.borrow);
  }

  const positions: ProviderPositionAdmissionPositionV1[] = [];
  if (supply > 0n) positions.push(position('SUPPLY', supply, asset));
  if (borrow > 0n) positions.push(position('BORROW', borrow, asset));
  return Object.freeze(positions);
}

function parseTranscriptCapability(
  value: unknown,
  request: ReviewedRequest,
  context: ReviewedContext,
): ParsedTranscript {
  assertBoundedTranscript(value);
  const record = exactDataRecord(
    value,
    TRANSCRIPT_CAPABILITY_KEYS,
    'TRANSCRIPT_UNAVAILABLE',
    true,
    true,
  );
  if (
    record.transcriptVersion !== DORMANT_KAMINO_POSITION_TRANSCRIPT_VERSION ||
    record.use !== DORMANT_KAMINO_POSITION_TRANSCRIPT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.maySign !== false ||
    record.mayAccessWalletPrivateKey !== false
  ) {
    return fail('TRANSCRIPT_UNAVAILABLE');
  }
  assertIdentityFields(record, request, 'TRANSCRIPT_UNAVAILABLE');
  if (
    record.canonicalWalletAddress !== context.canonicalWalletAddress ||
    record.commitment !== 'finalized' ||
    record.genesisHash !== GENESIS_HASH ||
    record.programAddress !== PROGRAM_ADDRESS ||
    record.lendingMarketAddress !== MARKET_ADDRESS ||
    record.reserveAddress !== RESERVE_ADDRESS ||
    record.assetMintAddress !== USDC_MINT_ADDRESS ||
    record.decoderCommitSha !== KLEND_SDK_COMMIT_SHA
  ) {
    return fail('TRANSCRIPT_UNAVAILABLE');
  }
  const finalizedRootSlot = positiveUnsignedInteger(
    record.finalizedRootSlot,
    'TRANSCRIPT_UNAVAILABLE',
  );
  const finalizedRootBlockhash = canonicalPublicKey(
    record.finalizedRootBlockhash,
    'TRANSCRIPT_UNAVAILABLE',
  );
  if (
    BigInt(finalizedRootSlot) < BigInt(context.continuityFloor.slot) ||
    BigInt(finalizedRootSlot) < BigInt(context.continuityFloor.root)
  ) {
    return fail('TRANSCRIPT_UNAVAILABLE');
  }
  parseLineage(record.lineage, context, finalizedRootSlot, finalizedRootBlockhash);
  return Object.freeze({
    finalizedRootSlot,
    positions: parseCoverage(record.coverage, context, finalizedRootSlot, request.asset),
  });
}

function staleAfter(observedAt: CanonicalTime, deadlineAt: CanonicalTime): string {
  const policy = chainObservationPolicyForNetwork(NETWORK_ID);
  if (policy === undefined) return fail('INVALID_CONFIGURATION');
  const freshnessBoundary = observedAt.milliseconds + policy.freshness.currentWithinMs;
  const milliseconds = Math.min(freshnessBoundary, deadlineAt.milliseconds);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= observedAt.milliseconds) {
    return fail('DEADLINE_EXCEEDED');
  }
  try {
    return Reflect.apply(CANONICAL_DATE_TO_ISO_STRING, new Date(milliseconds), []) as string;
  } catch {
    return fail('INVALID_CONFIGURATION');
  }
}

/**
 * Dormant direct-import-only Kamino account source. It performs no I/O unless
 * explicitly invoked with injected ports, registers no provider or runtime,
 * and cannot persist, sign, decrypt, or authorize a financial action.
 *
 * Solana blockhash continuity is authenticated and checked internally. The
 * current public admission anchor carries only slot/root, so the returned
 * evidence remains provisional and deliberately makes no same-slot fork-proof
 * claim outside this source boundary.
 */
export class DormantKaminoProviderPositionAdmissionSource implements ProviderPositionAdmissionSourcePort {
  private readonly config: DormantKaminoProviderPositionAdmissionSourceConfig;
  private readonly readContextMethod: CapturedMethod;
  private readonly reviewContextMethod: CapturedMethod;
  private readonly readTranscriptMethod: CapturedMethod;
  private readonly reviewTranscriptMethod: CapturedMethod;
  private readonly nowMethod: CapturedMethod;

  constructor(
    config: DormantKaminoProviderPositionAdmissionSourceConfig,
    contextReader: DormantKaminoPositionTargetContextReader,
    transcriptTransport: DormantKaminoFinalizedAccountTranscriptTransport,
    clock: DormantKaminoProviderPositionAdmissionClock,
  ) {
    this.config = parseSourceConfig(config);
    this.readContextMethod = captureMethod(contextReader, 'readContext');
    this.reviewContextMethod = captureMethod(contextReader, 'reviewContext');
    this.readTranscriptMethod = captureMethod(transcriptTransport, 'readTranscript');
    this.reviewTranscriptMethod = captureMethod(transcriptTransport, 'reviewTranscript');
    this.nowMethod = captureMethod(clock, 'now');
  }

  async readTarget(
    requestValue: ReadProviderPositionAdmissionTargetRequestV1,
  ): Promise<ProviderPositionAdmissionSourceEvidenceV1> {
    try {
      const request = parseAdmissionRequest(requestValue, this.config);
      const started = canonicalClock(invoke(this.nowMethod, []));
      assertActive(request.signal, started, request.deadlineAt);
      if (request.deadlineAt.milliseconds - started.milliseconds > MAX_DEADLINE_MILLISECONDS) {
        return fail('INVALID_REQUEST');
      }

      const contextRequest = createContextRequest(request);
      const contextCapability = await invoke(this.readContextMethod, [contextRequest]);
      const afterContext = canonicalClock(invoke(this.nowMethod, []));
      if (afterContext.milliseconds < started.milliseconds) return fail('CLOCK_REGRESSION');
      assertActive(request.signal, afterContext, request.deadlineAt);
      if (
        invoke(this.reviewContextMethod, [contextCapability, contextRequest]) !== contextCapability
      ) {
        return fail('CONTEXT_UNAVAILABLE');
      }
      const context = parseContextCapability(contextCapability, request);

      const transcriptRequest = createTranscriptRequest(request, contextRequest, context);
      const transcriptCapability = await invoke(this.readTranscriptMethod, [transcriptRequest]);
      const observedAt = canonicalClock(invoke(this.nowMethod, []));
      if (observedAt.milliseconds < afterContext.milliseconds) return fail('CLOCK_REGRESSION');
      assertActive(request.signal, observedAt, request.deadlineAt);
      if (
        invoke(this.reviewTranscriptMethod, [transcriptCapability, transcriptRequest]) !==
          transcriptCapability ||
        invoke(this.reviewContextMethod, [contextCapability, contextRequest]) !== contextCapability
      ) {
        return fail('TRANSCRIPT_UNAVAILABLE');
      }
      const transcript = parseTranscriptCapability(transcriptCapability, request, context);
      const continuityFloor: ProviderPositionAdmissionChainAnchorV1 = frozenNullPrototype({
        kind: 'SOLANA_SLOT' as const,
        slot: context.continuityFloor.slot,
        root: context.continuityFloor.root,
      });
      const chainAnchor: ProviderPositionAdmissionChainAnchorV1 = frozenNullPrototype({
        kind: 'SOLANA_SLOT' as const,
        slot: transcript.finalizedRootSlot,
        root: transcript.finalizedRootSlot,
      });

      return frozenNullPrototype({
        evidenceVersion: PROVIDER_POSITION_ADMISSION_VERSION,
        use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
        mayAuthorizeFinancialAction: false as const,
        accountId: request.accountId,
        correlationId: request.correlationId,
        sourceFamilyId: request.sourceFamilyId,
        sourceId: request.sourceId,
        sourceKind: request.sourceKind as MainnetProviderPositionSourceKind,
        sourceObservationId: `solana-slot-${transcript.finalizedRootSlot}`,
        walletId: request.walletId,
        providerId: PROVIDER_ID,
        protocolId: PROTOCOL_ID,
        marketId: MARKET_ID,
        networkId: NETWORK_ID,
        assets: Object.freeze([request.asset]),
        status: 'COMPLETE' as const,
        observedAt: observedAt.value,
        staleAfter: staleAfter(observedAt, request.deadlineAt),
        continuityFloor,
        chainAnchor,
        positions: transcript.positions,
      });
    } catch (error) {
      if (error instanceof DormantKaminoProviderPositionAdmissionSourceUnavailableError)
        throw error;
      return fail('TRANSCRIPT_UNAVAILABLE');
    }
  }
}
