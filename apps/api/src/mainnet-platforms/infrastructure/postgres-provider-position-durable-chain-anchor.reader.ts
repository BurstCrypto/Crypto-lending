import { isProxy } from 'node:util/types';

import type { QueryResultRow } from 'pg';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../domain/mainnet-provider-position-chain-assessment';
import {
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE,
  type ProviderPositionDurableChainAnchorAssessmentV1,
  type ProviderPositionDurableChainAnchorReaderPort,
  type ReadProviderPositionDurableChainAnchorRequestV1,
} from '../application/ports/provider-position-durable-chain-anchor-reader.port';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CORRELATION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const LOWER_REFERENCE = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const POLICY_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const OPAQUE_REFERENCE = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,190}[A-Za-z0-9])?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const EVM_BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

const REQUEST_KEYS = Object.freeze([
  'readerVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'accountId',
  'correlationId',
  'candidateFingerprintSha256',
  'targetId',
  'walletId',
  'providerId',
  'protocolId',
  'marketId',
  'networkId',
  'sourceFamilyId',
  'sourceId',
  'sourceKind',
  'sourceObservationId',
  'continuityFloor',
  'chainAnchor',
  'observedAt',
  'capturedAt',
  'evaluatedAt',
  'deadlineAt',
  'signal',
] as const);

const ROW_COLUMNS = Object.freeze([
  'reader_version',
  'assessment_use',
  'may_authorize_financial_action',
  'may_persist',
  'network_id',
  'continuity_floor_json',
  'chain_anchor_json',
  'assessed_at',
  'identity_status',
  'progression_status',
  'finality_status',
] as const);

const READ_SQL = `SELECT
  assessment.reader_version,
  assessment.assessment_use,
  assessment.may_authorize_financial_action,
  assessment.may_persist,
  assessment.network_id,
  assessment.continuity_floor::text AS continuity_floor_json,
  assessment.chain_anchor::text AS chain_anchor_json,
  pg_catalog.to_char(
    assessment.assessed_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS assessed_at,
  assessment.identity_status,
  assessment.progression_status,
  assessment.finality_status
FROM read_provider_position_chain_anchor_evidence(
  $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text,
  $8::jsonb, $9::jsonb, $10::timestamptz, $11::timestamptz,
  $12::timestamptz, $13::timestamptz
) AS assessment`;

interface AnchorRow extends QueryResultRow {
  reader_version: number;
  assessment_use: string;
  may_authorize_financial_action: boolean;
  may_persist: boolean;
  network_id: string;
  continuity_floor_json: string;
  chain_anchor_json: string;
  assessed_at: string;
  identity_status: string;
  progression_status: string;
  finality_status: string;
}

interface ReviewedRequest {
  readonly request: ReadProviderPositionDurableChainAnchorRequestV1;
  readonly accountId: string;
  readonly walletId: string;
  readonly networkId: typeof ETHEREUM | typeof SOLANA;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly sourceKind: 'RPC' | 'INDEXER' | 'PROVIDER_API';
  readonly sourceObservationId: string;
  readonly continuityFloor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
  readonly observedAt: string;
  readonly observedAtMilliseconds: number;
  readonly capturedAt: string;
  readonly capturedAtMilliseconds: number;
  readonly evaluatedAt: string;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}

type QueryWithCancellation = PostgresService['queryWithCancellation'];

interface CapturedQuery {
  readonly receiver: object;
  readonly method: QueryWithCancellation;
}

class ProviderPositionDurableChainAnchorReadError extends Error {
  readonly code = 'PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_FAILED' as const;

  constructor() {
    super('Provider position durable chain anchor read failed');
    this.name = 'ProviderPositionDurableChainAnchorReadError';
  }
}

export const PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_ERROR = Object.freeze(
  new ProviderPositionDurableChainAnchorReadError(),
);

function fail(): never {
  throw PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_ERROR;
}

function frozenNullPrototype<T extends object>(fields: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as object, fields)) as Readonly<T>;
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
  requireFrozen: boolean,
  requireNullPrototype: boolean,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      (requireFrozen && !Object.isFrozen(value))
    ) {
      return fail();
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (
      (requireNullPrototype && prototype !== null) ||
      (!requireNullPrototype && prototype !== null && prototype !== Object.prototype)
    ) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail();
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return fail();
  }
}

function canonicalTimestamp(value: unknown): Readonly<{ value: string; milliseconds: number }> {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail();
  }
  return Object.freeze({ value, milliseconds });
}

function jsonAnchor(
  value: unknown,
  networkId: typeof ETHEREUM | typeof SOLANA,
): MainnetProviderPositionAssessmentChainAnchorV1 {
  try {
    if (typeof value !== 'string' || value.length < 2 || value.length > 512) return fail();
    return parseAnchor(JSON.parse(value) as unknown, networkId, false);
  } catch {
    return fail();
  }
}

function unsignedInteger(value: unknown, maximum: bigint): string {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) return fail();
  const parsed = BigInt(value);
  if (parsed > maximum) return fail();
  return value;
}

function parseAnchor(
  value: unknown,
  networkId: typeof ETHEREUM | typeof SOLANA,
  requireFrozen: boolean,
): MainnetProviderPositionAssessmentChainAnchorV1 {
  const initial = exactDataRecord(
    value,
    networkId === ETHEREUM ? ['kind', 'blockNumber', 'blockHash'] : ['kind', 'slot', 'root'],
    requireFrozen,
    false,
  );
  if (networkId === ETHEREUM) {
    const blockNumber = unsignedInteger(initial.blockNumber, MAX_UINT256);
    if (
      initial.kind !== 'EVM_BLOCK' ||
      typeof initial.blockHash !== 'string' ||
      !EVM_BLOCK_HASH.test(initial.blockHash) ||
      /^0x0{64}$/u.test(initial.blockHash)
    ) {
      return fail();
    }
    return frozenNullPrototype({
      kind: 'EVM_BLOCK' as const,
      blockNumber,
      blockHash: initial.blockHash,
    });
  }
  const slot = unsignedInteger(initial.slot, MAX_UINT64);
  const root = unsignedInteger(initial.root, MAX_UINT64);
  if (initial.kind !== 'SOLANA_SLOT' || BigInt(root) > BigInt(slot)) return fail();
  return frozenNullPrototype({ kind: 'SOLANA_SLOT' as const, slot, root });
}

function sameAnchor(
  left: MainnetProviderPositionAssessmentChainAnchorV1,
  right: MainnetProviderPositionAssessmentChainAnchorV1,
): boolean {
  return left.kind === 'EVM_BLOCK' && right.kind === 'EVM_BLOCK'
    ? left.blockNumber === right.blockNumber && left.blockHash === right.blockHash
    : left.kind === 'SOLANA_SLOT' && right.kind === 'SOLANA_SLOT'
      ? left.slot === right.slot && left.root === right.root
      : false;
}

function nonRegressing(
  floor: MainnetProviderPositionAssessmentChainAnchorV1,
  anchor: MainnetProviderPositionAssessmentChainAnchorV1,
): boolean {
  if (floor.kind === 'EVM_BLOCK' && anchor.kind === 'EVM_BLOCK') {
    return (
      BigInt(anchor.blockNumber) > BigInt(floor.blockNumber) ||
      (anchor.blockNumber === floor.blockNumber && anchor.blockHash === floor.blockHash)
    );
  }
  return (
    floor.kind === 'SOLANA_SLOT' &&
    anchor.kind === 'SOLANA_SLOT' &&
    BigInt(anchor.slot) >= BigInt(floor.slot) &&
    BigInt(anchor.root) >= BigInt(floor.root)
  );
}

function authenticSignal(value: unknown): AbortSignal {
  try {
    if (
      ABORTED_GETTER === undefined ||
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype
    ) {
      return fail();
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch {
    return fail();
  }
}

function isAborted(signal: AbortSignal): boolean {
  try {
    if (ABORTED_GETTER === undefined) return fail();
    return Reflect.apply(ABORTED_GETTER, signal, []) as boolean;
  } catch {
    return fail();
  }
}

function reviewedRequest(
  requestInput: ReadProviderPositionDurableChainAnchorRequestV1,
): ReviewedRequest {
  const record = exactDataRecord(requestInput, REQUEST_KEYS, true, true);
  const accountId = record.accountId;
  const walletId = record.walletId;
  const networkId = record.networkId;
  const sourceFamilyId = record.sourceFamilyId;
  const sourceId = record.sourceId;
  const sourceKind = record.sourceKind;
  const sourceObservationId = record.sourceObservationId;
  if (
    record.readerVersion !== PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION ||
    record.use !== PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    typeof accountId !== 'string' ||
    !UUID_V4.test(accountId) ||
    typeof walletId !== 'string' ||
    !UUID_V4.test(walletId) ||
    typeof record.correlationId !== 'string' ||
    !CORRELATION_ID.test(record.correlationId) ||
    typeof record.candidateFingerprintSha256 !== 'string' ||
    !SHA256.test(record.candidateFingerprintSha256) ||
    typeof record.targetId !== 'string' ||
    !OPAQUE_REFERENCE.test(record.targetId) ||
    typeof record.providerId !== 'string' ||
    !POLICY_ID.test(record.providerId) ||
    typeof record.protocolId !== 'string' ||
    !POLICY_ID.test(record.protocolId) ||
    typeof record.marketId !== 'string' ||
    !OPAQUE_REFERENCE.test(record.marketId) ||
    (networkId !== ETHEREUM && networkId !== SOLANA) ||
    typeof sourceFamilyId !== 'string' ||
    !LOWER_REFERENCE.test(sourceFamilyId) ||
    typeof sourceId !== 'string' ||
    !LOWER_REFERENCE.test(sourceId) ||
    (sourceKind !== 'RPC' && sourceKind !== 'INDEXER' && sourceKind !== 'PROVIDER_API') ||
    typeof sourceObservationId !== 'string' ||
    !OPAQUE_REFERENCE.test(sourceObservationId)
  ) {
    return fail();
  }
  const continuityFloor = parseAnchor(record.continuityFloor, networkId, true);
  const chainAnchor = parseAnchor(record.chainAnchor, networkId, true);
  const observedAt = canonicalTimestamp(record.observedAt);
  const capturedAt = canonicalTimestamp(record.capturedAt);
  const evaluatedAt = canonicalTimestamp(record.evaluatedAt);
  const deadlineAt = canonicalTimestamp(record.deadlineAt);
  const signal = authenticSignal(record.signal);
  const expectedObservationId =
    chainAnchor.kind === 'EVM_BLOCK'
      ? `ethereum-block-${chainAnchor.blockNumber}`
      : `solana-slot-${chainAnchor.slot}`;
  if (
    sourceObservationId !== expectedObservationId ||
    !nonRegressing(continuityFloor, chainAnchor) ||
    observedAt.milliseconds > capturedAt.milliseconds ||
    capturedAt.milliseconds > evaluatedAt.milliseconds ||
    evaluatedAt.milliseconds >= deadlineAt.milliseconds ||
    deadlineAt.milliseconds - evaluatedAt.milliseconds > MAX_DEADLINE_MILLISECONDS ||
    isAborted(signal)
  ) {
    return fail();
  }
  return frozenNullPrototype({
    request: requestInput,
    accountId,
    walletId,
    networkId,
    sourceFamilyId,
    sourceId,
    sourceKind,
    sourceObservationId,
    continuityFloor,
    chainAnchor,
    observedAt: observedAt.value,
    observedAtMilliseconds: observedAt.milliseconds,
    capturedAt: capturedAt.value,
    capturedAtMilliseconds: capturedAt.milliseconds,
    evaluatedAt: evaluatedAt.value,
    deadlineAt: deadlineAt.value,
    signal,
  });
}

function captureQueryWithCancellation(value: PostgresService): CapturedQuery {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return fail();
    }
    let current: object | null = value;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (isProxy(current)) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(current, 'queryWithCancellation');
      if (descriptor !== undefined) {
        if (!('value' in descriptor) || typeof descriptor.value !== 'function') return fail();
        if (isProxy(descriptor.value)) return fail();
        return Object.freeze({
          receiver: value,
          method: descriptor.value as QueryWithCancellation,
        });
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail();
  } catch {
    return fail();
  }
}

function singleRow(value: unknown): AnchorRow {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return fail();
    const rowsDescriptor = Object.getOwnPropertyDescriptor(value, 'rows');
    if (!rowsDescriptor?.enumerable || !('value' in rowsDescriptor)) return fail();
    const rows = rowsDescriptor.value as unknown;
    if (!Array.isArray(rows) || isProxy(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
      return fail();
    }
    const rowDescriptors = Object.getOwnPropertyDescriptors(
      rows,
    ) as unknown as PropertyDescriptorMap;
    const rowKeys = Reflect.ownKeys(rowDescriptors);
    if (
      rowKeys.length !== 2 ||
      rowKeys.some((key) => key !== '0' && key !== 'length') ||
      rowDescriptors['length']?.value !== 1 ||
      !rowDescriptors['0']?.enumerable ||
      !('value' in rowDescriptors['0'])
    ) {
      return fail();
    }
    return exactDataRecord(rowDescriptors['0'].value, ROW_COLUMNS, false, false) as AnchorRow;
  } catch {
    return fail();
  }
}

function assessmentFromRow(
  row: AnchorRow,
  request: ReviewedRequest,
): ProviderPositionDurableChainAnchorAssessmentV1 {
  const networkId = row.network_id;
  if (
    row.reader_version !== PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION ||
    row.assessment_use !== PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE ||
    row.may_authorize_financial_action !== false ||
    row.may_persist !== false ||
    networkId !== request.networkId ||
    row.identity_status !== 'VERIFIED' ||
    row.progression_status !== 'CURRENT' ||
    row.finality_status !== 'HEALTHY'
  ) {
    return fail();
  }
  const continuityFloor = jsonAnchor(row.continuity_floor_json, request.networkId);
  const chainAnchor = jsonAnchor(row.chain_anchor_json, request.networkId);
  const assessedAt = canonicalTimestamp(row.assessed_at);
  if (
    !sameAnchor(continuityFloor, request.continuityFloor) ||
    !sameAnchor(chainAnchor, request.chainAnchor) ||
    !nonRegressing(continuityFloor, chainAnchor) ||
    assessedAt.milliseconds < request.observedAtMilliseconds ||
    assessedAt.milliseconds > request.capturedAtMilliseconds
  ) {
    return fail();
  }
  return frozenNullPrototype({
    readerVersion: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
    use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    networkId: request.networkId,
    continuityFloor,
    chainAnchor,
    assessedAt: assessedAt.value,
    identityStatus: 'VERIFIED' as const,
    progressionStatus: 'CURRENT' as const,
    finalityStatus: 'HEALTHY' as const,
  });
}

/**
 * Dormant API adapter for migration 0029's active-wallet-gated read function.
 * It owns no evidence writer, network transport, registration, or financial authority.
 */
export class PostgresProviderPositionDurableChainAnchorReader implements ProviderPositionDurableChainAnchorReaderPort {
  readonly readerVersion = PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION;

  readonly #receiver: object;
  readonly #queryWithCancellation: QueryWithCancellation;
  readonly #issued = new WeakMap<object, ReadProviderPositionDurableChainAnchorRequestV1>();

  constructor(postgres: PostgresService) {
    const captured = captureQueryWithCancellation(postgres);
    this.#receiver = captured.receiver;
    this.#queryWithCancellation = captured.method;
  }

  async readAnchor(
    requestInput: ReadProviderPositionDurableChainAnchorRequestV1,
  ): Promise<unknown> {
    try {
      const request = reviewedRequest(requestInput);
      const result = (await Reflect.apply(this.#queryWithCancellation, this.#receiver, [
        READ_SQL,
        [
          request.accountId,
          request.walletId,
          request.networkId,
          request.sourceFamilyId,
          request.sourceId,
          request.sourceKind,
          request.sourceObservationId,
          JSON.stringify(request.continuityFloor),
          JSON.stringify(request.chainAnchor),
          request.observedAt,
          request.capturedAt,
          request.evaluatedAt,
          request.deadlineAt,
        ],
        request.signal,
      ])) as unknown;
      if (isAborted(request.signal)) return fail();
      const capability = assessmentFromRow(singleRow(result), request);
      this.#issued.set(capability, request.request);
      return capability;
    } catch {
      return fail();
    }
  }

  verifyAnchor(
    capability: unknown,
    request: ReadProviderPositionDurableChainAnchorRequestV1,
  ): boolean {
    return (
      (typeof capability === 'object' || typeof capability === 'function') &&
      capability !== null &&
      this.#issued.get(capability) === request
    );
  }
}
