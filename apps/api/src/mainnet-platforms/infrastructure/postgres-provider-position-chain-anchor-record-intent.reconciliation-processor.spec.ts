import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import * as mainnetPlatformsFeature from '../index';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
  type ProviderPositionChainAnchorRecordIntentReconciliationResultV1,
  type ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
} from '../application/ports/provider-position-chain-anchor-record-intent-reconciliation.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR,
  PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor,
} from './postgres-provider-position-chain-anchor-record-intent.reconciliation-processor';

const INTENT_FINGERPRINT = 'a'.repeat(64);
const EVIDENCE_FINGERPRINT = 'b'.repeat(64);
const READ_BINDING_FINGERPRINT = 'c'.repeat(64);
const DEADLINE_BINDING_FINGERPRINT = 'd'.repeat(64);
const PRODUCER_DEADLINE_AT = '2026-09-05T17:00:00.000Z';
const EVIDENCE_RECORDED_AT = '2026-09-05T16:59:59.000Z';
const LATE_EVIDENCE_RECORDED_AT = '2026-09-05T17:00:01.500Z';
const LEASED_AT = '2026-09-05T17:00:01.000Z';
const LEASE_EXPIRES_AT = '2026-09-05T17:00:31.000Z';
const RESOLVED_AT = '2026-09-05T17:00:02.000Z';

const EXPECTED_LEASE_SQL = `SELECT
  intent.leased_record_intent_fingerprint_sha256 AS record_intent_fingerprint_sha256,
  intent.leased_evidence_fingerprint_sha256 AS evidence_fingerprint_sha256,
  intent.leased_intent_state AS intent_state,
  pg_catalog.to_char(
    intent.leased_producer_deadline_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS producer_deadline_at,
  intent.leased_reconciliation_attempt_count::text AS reconciliation_attempt_count,
  pg_catalog.to_char(
    intent.leased_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS leased_at,
  pg_catalog.to_char(
    intent.lease_expires_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS lease_expires_at
FROM lease_provider_chain_anchor_record_intent_reconciliation($1::bytea, interval '30 seconds') AS intent`;

const EXPECTED_RECONCILE_SQL = `SELECT
  intent.intent_state,
  intent.reconciled_record_intent_fingerprint_sha256 AS record_intent_fingerprint_sha256,
  intent.reconciled_evidence_fingerprint_sha256 AS evidence_fingerprint_sha256,
  intent.reconciled_read_binding_fingerprint_sha256 AS read_binding_fingerprint_sha256,
  intent.reconciled_deadline_binding_sha256 AS deadline_binding_sha256,
  pg_catalog.to_char(
    intent.reconciled_evidence_recorded_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS evidence_recorded_at,
  pg_catalog.to_char(
    intent.reconciled_resolved_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS resolved_at,
  pg_catalog.to_char(
    intent.reconciled_producer_deadline_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS producer_deadline_at
FROM reconcile_provider_position_chain_anchor_record_intent($1::text, $2::bytea) AS intent`;

type ActiveState = 'NEW' | 'RECORD_DISPATCHED' | 'UNKNOWN';
type TerminalState = 'RECORDED' | 'IDEMPOTENT_REPLAY' | 'NOT_RECORDED' | 'DEADLINE_VIOLATION';

function request(
  signal = new AbortController().signal,
): ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1 {
  return Object.freeze({
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
    mayAuthorizeFinancialAction: false,
    signal,
  });
}

function queryResult(rows: readonly unknown[]): Readonly<{ rows: readonly unknown[] }> {
  return Object.freeze({ rows });
}

function leaseRow(
  state: ActiveState = 'UNKNOWN',
  overrides: Readonly<Record<string, unknown>> = Object.freeze({}),
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    record_intent_fingerprint_sha256: INTENT_FINGERPRINT,
    evidence_fingerprint_sha256: EVIDENCE_FINGERPRINT,
    intent_state: state,
    producer_deadline_at: PRODUCER_DEADLINE_AT,
    reconciliation_attempt_count: '1',
    leased_at: LEASED_AT,
    lease_expires_at: LEASE_EXPIRES_AT,
    ...overrides,
  });
}

function reconcileRow(
  state: TerminalState,
  overrides: Readonly<Record<string, unknown>> = Object.freeze({}),
): Readonly<Record<string, unknown>> {
  const hasEvidence = state === 'IDEMPOTENT_REPLAY' || state === 'RECORDED';
  return Object.freeze({
    intent_state: state,
    record_intent_fingerprint_sha256: INTENT_FINGERPRINT,
    evidence_fingerprint_sha256: EVIDENCE_FINGERPRINT,
    read_binding_fingerprint_sha256: READ_BINDING_FINGERPRINT,
    deadline_binding_sha256: hasEvidence ? DEADLINE_BINDING_FINGERPRINT : null,
    evidence_recorded_at:
      state === 'DEADLINE_VIOLATION'
        ? LATE_EVIDENCE_RECORDED_AT
        : hasEvidence
          ? EVIDENCE_RECORDED_AT
          : null,
    resolved_at: RESOLVED_AT,
    producer_deadline_at: PRODUCER_DEADLINE_AT,
    ...overrides,
  });
}

function processorWith(query: jest.Mock): {
  readonly processor: PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor;
  readonly postgres: { queryWithCancellation: jest.Mock };
} {
  const postgres = { queryWithCancellation: query };
  return Object.freeze({
    processor: new PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor(
      postgres as unknown as PostgresService,
    ),
    postgres,
  });
}

function reviewed(
  processor: PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor,
  capability: unknown,
  reconcileRequest: ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
): ProviderPositionChainAnchorRecordIntentReconciliationResultV1 {
  return processor.reviewResult(capability, reconcileRequest) ?? failTest();
}

function failTest(): never {
  throw new Error('expected an authenticated result');
}

function expectFrozenNullPrototype(value: unknown): void {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.getPrototypeOf(value)).toBeNull();
}

function expectDeferred(
  result: ProviderPositionChainAnchorRecordIntentReconciliationResultV1,
  phase: 'LEASE_RECONCILIATION' | 'RECONCILE_RECORD',
  withLease: boolean,
): void {
  expect(result).toEqual({
    reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
    mayAuthorizeFinancialAction: false,
    outcome: 'DEFERRED',
    recordIntentFingerprintSha256: withLease ? INTENT_FINGERPRINT : null,
    evidenceFingerprintSha256: withLease ? EVIDENCE_FINGERPRINT : null,
    knownIntentState: withLease ? 'UNKNOWN' : null,
    uncertainPhase: phase,
    retryNotBefore: withLease ? LEASE_EXPIRES_AT : null,
  });
  expectFrozenNullPrototype(result);
}

describe('PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor', () => {
  it('is direct-import-only, dormant, and contains no alternate write, retry, release, or timer path', () => {
    const source = readFileSync(
      join(
        __dirname,
        'postgres-provider-position-chain-anchor-record-intent.reconciliation-processor.ts',
      ),
      'utf8',
    );

    expect(mainnetPlatformsFeature).not.toHaveProperty(
      'PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor',
    );
    expect(source).not.toMatch(/@Injectable|setInterval|setTimeout|process\.env|withTransaction/u);
    expect(source).not.toContain('release_provider_chain_anchor_record_intent_reconciliation(');
    expect(source).not.toMatch(
      /record_provider_position_chain_anchor_evidence(?:_guarded)?\(|execute_provider_position_chain_anchor_record_intent\(|mark_provider_position_chain_anchor_record_intent_unknown\(/u,
    );
    expect(source.match(/await queryAttempt\(/gu)).toHaveLength(2);
  });

  it('captures only the original cancellable-query method and performs no constructor I/O', async () => {
    const original = jest.fn().mockResolvedValue(queryResult([]));
    const replacement = jest.fn().mockResolvedValue(queryResult([leaseRow()]));
    const forbiddenQuery = jest.fn();
    const forbiddenTransaction = jest.fn();
    const postgres = { queryWithCancellation: original };
    Object.defineProperties(postgres, {
      query: { configurable: true, get: forbiddenQuery },
      withTransaction: { configurable: true, get: forbiddenTransaction },
    });

    const processor = new PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor(
      postgres as unknown as PostgresService,
    );
    expect(original).not.toHaveBeenCalled();
    expect(forbiddenQuery).not.toHaveBeenCalled();
    expect(forbiddenTransaction).not.toHaveBeenCalled();
    postgres.queryWithCancellation = replacement;

    const reconcileRequest = request();
    const result = reviewed(
      processor,
      await processor.reconcileNext(reconcileRequest),
      reconcileRequest,
    );
    expect(result.outcome).toBe('IDLE');
    expect(original).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
    expect(forbiddenQuery).not.toHaveBeenCalled();
    expect(forbiddenTransaction).not.toHaveBeenCalled();
  });

  it('rejects accessor, proxied receiver, and proxied method capabilities without invoking them', () => {
    const getter = jest.fn(() => jest.fn());
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'queryWithCancellation', {
      enumerable: true,
      get: getter,
    });
    const proxiedReceiver = new Proxy({ queryWithCancellation: jest.fn() }, {});
    const proxiedMethod = { queryWithCancellation: new Proxy(jest.fn(), {}) };

    expect(
      () =>
        new PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor(
          accessor as unknown as PostgresService,
        ),
    ).toThrow(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR);
    expect(getter).not.toHaveBeenCalled();
    expect(
      () =>
        new PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor(
          proxiedReceiver as unknown as PostgresService,
        ),
    ).toThrow(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR);
    expect(
      () =>
        new PostgresProviderPositionChainAnchorRecordIntentReconciliationProcessor(
          proxiedMethod as unknown as PostgresService,
        ),
    ).toThrow(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR);
  });

  it.each([
    ['unfrozen', { ...request() }],
    [
      'extra field',
      Object.freeze({ ...request(), recordIntentFingerprintSha256: INTENT_FINGERPRINT }),
    ],
    ['wrong version', Object.freeze({ ...request(), reconciliationVersion: 2 })],
    ['wrong use', Object.freeze({ ...request(), use: 'RECORD' })],
    ['financial authority', Object.freeze({ ...request(), mayAuthorizeFinancialAction: true })],
    ['fake signal', Object.freeze({ ...request(), signal: Object.freeze({ aborted: false }) })],
    [
      'proxied signal',
      Object.freeze({ ...request(), signal: new Proxy(new AbortController().signal, {}) }),
    ],
  ])('throws one frozen sanitized error for an invalid %s request', async (_name, invalid) => {
    const query = jest.fn();
    const { processor } = processorWith(query);

    await expect(
      processor.reconcileNext(
        invalid as ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
      ),
    ).rejects.toBe(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR);
    expect(query).not.toHaveBeenCalled();
    expect(Object.isFrozen(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR)).toBe(
      true,
    );
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR).toMatchObject({
      name: 'ProviderPositionChainAnchorRecordIntentReconciliationError',
      code: 'PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_FAILED',
      message: 'Provider position chain-anchor record-intent reconciliation failed',
    });
  });

  it('rejects a frozen request accessor without invoking it', async () => {
    const signalGetter = jest.fn(() => new AbortController().signal);
    const invalid = {
      reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_USE,
      mayAuthorizeFinancialAction: false,
    } as Record<string, unknown>;
    Object.defineProperty(invalid, 'signal', { enumerable: true, get: signalGetter });
    Object.freeze(invalid);
    const { processor, postgres } = processorWith(jest.fn());

    await expect(
      processor.reconcileNext(
        invalid as unknown as ReconcileNextProviderPositionChainAnchorRecordIntentRequestV1,
      ),
    ).rejects.toBe(PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR);
    expect(signalGetter).not.toHaveBeenCalled();
    expect(postgres.queryWithCancellation).not.toHaveBeenCalled();
  });

  it('uses the exact two autocommit statements, signal, and one private nonzero token, then zeroes it', async () => {
    let leasedToken: Buffer | undefined;
    let reconciledToken: Buffer | undefined;
    let leasedSnapshot: Buffer | undefined;
    let reconciledSnapshot: Buffer | undefined;
    let leasedSignal: AbortSignal | undefined;
    let reconciledSignal: AbortSignal | undefined;
    const query = jest.fn((sql: string, values: readonly unknown[], signal: AbortSignal) => {
      if (sql === EXPECTED_LEASE_SQL) {
        leasedToken = values[0] as Buffer;
        leasedSnapshot = Buffer.from(leasedToken);
        leasedSignal = signal;
        return Promise.resolve(queryResult([leaseRow()]));
      }
      reconciledToken = values[1] as Buffer;
      reconciledSnapshot = Buffer.from(reconciledToken);
      reconciledSignal = signal;
      return Promise.resolve(queryResult([reconcileRow('IDEMPOTENT_REPLAY')]));
    });
    const { processor } = processorWith(query);
    const reconcileRequest = request();

    const result = reviewed(
      processor,
      await processor.reconcileNext(reconcileRequest),
      reconcileRequest,
    );

    expect(result.outcome).toBe('RECORDED');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toBe(EXPECTED_LEASE_SQL);
    expect(query.mock.calls[1]?.[0]).toBe(EXPECTED_RECONCILE_SQL);
    expect(query.mock.calls[0]?.[1]).toHaveLength(1);
    expect(query.mock.calls[1]?.[1]?.[0]).toBe(INTENT_FINGERPRINT);
    expect(leasedSignal).toBe(reconcileRequest.signal);
    expect(reconciledSignal).toBe(reconcileRequest.signal);
    expect(leasedToken).toBe(reconciledToken);
    expect(leasedSnapshot).toHaveLength(32);
    expect(reconciledSnapshot).toEqual(leasedSnapshot);
    expect(leasedSnapshot?.some((byte) => byte !== 0)).toBe(true);
    expect(leasedToken).toEqual(Buffer.alloc(32));
    expect(reconciledToken).toEqual(Buffer.alloc(32));
    expect(Object.isFrozen(query.mock.calls[0]?.[1])).toBe(true);
    expect(Object.isFrozen(query.mock.calls[1]?.[1])).toBe(true);
  });

  it('returns an authenticated IDLE for one strict zero-row lease response', async () => {
    const query = jest.fn().mockResolvedValue(queryResult([]));
    const { processor } = processorWith(query);
    const reconcileRequest = request();
    const capability = await processor.reconcileNext(reconcileRequest);
    const result = reviewed(processor, capability, reconcileRequest);

    expect(result).toEqual({
      reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
      mayAuthorizeFinancialAction: false,
      outcome: 'IDLE',
    });
    expectFrozenNullPrototype(result);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toBe(EXPECTED_LEASE_SQL);
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(Buffer.alloc(32));
  });

  it('rejects oversized sparse row arrays before cardinality-dependent allocation', async () => {
    const oversizedRows: unknown[] = [];
    oversizedRows.length = 1_000_000_000;
    Object.freeze(oversizedRows);
    const query = jest.fn().mockResolvedValue(queryResult(oversizedRows));
    const { processor } = processorWith(query);
    const reconcileRequest = request();
    const result = reviewed(
      processor,
      await processor.reconcileNext(reconcileRequest),
      reconcileRequest,
    );

    expectDeferred(result, 'LEASE_RECONCILIATION', false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['multiple rows', queryResult([leaseRow(), leaseRow('RECORD_DISPATCHED')])],
    ['missing row field', queryResult([{ ...leaseRow(), lease_expires_at: undefined }])],
    ['extra row field', queryResult([{ ...leaseRow(), extra: 'forbidden' }])],
    ['invalid identity', queryResult([leaseRow('UNKNOWN', { evidence_fingerprint_sha256: 'x' })])],
    ['terminal state', queryResult([leaseRow('UNKNOWN', { intent_state: 'NOT_RECORDED' })])],
    [
      'zero attempt count',
      queryResult([leaseRow('UNKNOWN', { reconciliation_attempt_count: '0' })]),
    ],
    [
      'deadline after lease',
      queryResult([leaseRow('UNKNOWN', { leased_at: '2026-09-05T16:59:59.000Z' })]),
    ],
    [
      'wrong lease duration',
      queryResult([leaseRow('UNKNOWN', { lease_expires_at: '2026-09-05T17:00:30.999Z' })]),
    ],
    ['non-array rows', Object.freeze({ rows: Object.freeze({}) })],
  ])('defers without identity for a malformed lease response: %s', async (_name, response) => {
    const query = jest.fn().mockResolvedValue(response);
    const { processor } = processorWith(query);
    const reconcileRequest = request();
    const result = reviewed(
      processor,
      await processor.reconcileNext(reconcileRequest),
      reconcileRequest,
    );

    expectDeferred(result, 'LEASE_RECONCILIATION', false);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(Buffer.alloc(32));
  });

  it.each([
    ['rejected promise', () => Promise.reject(new Error('database secret'))],
    [
      'synchronous throw',
      () => {
        throw new Error('database secret');
      },
    ],
    ['non-promise', () => queryResult([])],
    ['thenable', () => ({ then: (resolve: (value: unknown) => void) => resolve(queryResult([])) })],
  ])('defers and sanitizes a lease %s', async (_name, behavior) => {
    const query = jest.fn((sql: unknown, values: unknown, signal: unknown) => {
      void sql;
      void values;
      void signal;
      return behavior();
    });
    const { processor } = processorWith(query);
    const reconcileRequest = request();
    const capability = await processor.reconcileNext(reconcileRequest);
    const result = reviewed(processor, capability, reconcileRequest);

    expectDeferred(result, 'LEASE_RECONCILIATION', false);
    expect(JSON.stringify(result)).not.toMatch(/database secret/u);
    expect(query).toHaveBeenCalledTimes(1);
    const leaseValues = query.mock.calls[0]?.[1] as readonly unknown[] | undefined;
    expect(leaseValues?.[0]).toEqual(Buffer.alloc(32));
  });

  it('rejects an already-aborted authentic request before database work', async () => {
    const controller = new AbortController();
    controller.abort();
    const query = jest.fn();
    const { processor } = processorWith(query);
    const reconcileRequest = request(controller.signal);
    await expect(processor.reconcileNext(reconcileRequest)).rejects.toBe(
      PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_ERROR,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('does not reconcile when abort wins after an acknowledged lease', async () => {
    const controller = new AbortController();
    const query = jest.fn((_sql: string, values: readonly unknown[]) => {
      controller.abort();
      expect(Buffer.from(values[0] as Buffer).some((byte) => byte !== 0)).toBe(true);
      return Promise.resolve(queryResult([leaseRow()]));
    });
    const { processor } = processorWith(query);
    const reconcileRequest = request(controller.signal);
    const result = reviewed(
      processor,
      await processor.reconcileNext(reconcileRequest),
      reconcileRequest,
    );

    expectDeferred(result, 'RECONCILE_RECORD', true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(Buffer.alloc(32));
  });

  it.each([
    [
      'IDEMPOTENT_REPLAY',
      'UNKNOWN',
      {
        reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
        mayAuthorizeFinancialAction: false,
        outcome: 'RECORDED',
        recordIntentFingerprintSha256: INTENT_FINGERPRINT,
        evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
        deadlineBindingSha256: DEADLINE_BINDING_FINGERPRINT,
        producerDeadlineAt: PRODUCER_DEADLINE_AT,
        evidenceRecordedAt: EVIDENCE_RECORDED_AT,
        resolvedAt: RESOLVED_AT,
      },
    ],
    [
      'NOT_RECORDED',
      'NEW',
      {
        reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
        mayAuthorizeFinancialAction: false,
        outcome: 'NOT_RECORDED',
        recordIntentFingerprintSha256: INTENT_FINGERPRINT,
        evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
        producerDeadlineAt: PRODUCER_DEADLINE_AT,
        resolvedAt: RESOLVED_AT,
      },
    ],
    [
      'DEADLINE_VIOLATION',
      'RECORD_DISPATCHED',
      {
        reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
        mayAuthorizeFinancialAction: false,
        outcome: 'DEADLINE_VIOLATION',
        recordIntentFingerprintSha256: INTENT_FINGERPRINT,
        evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
        producerDeadlineAt: PRODUCER_DEADLINE_AT,
        evidenceRecordedAt: LATE_EVIDENCE_RECORDED_AT,
        resolvedAt: RESOLVED_AT,
      },
    ],
  ] as const)(
    'maps the only possible terminal database state %s',
    async (terminalState, leaseState, expected) => {
      const query = jest
        .fn()
        .mockResolvedValueOnce(queryResult([leaseRow(leaseState)]))
        .mockResolvedValueOnce(queryResult([reconcileRow(terminalState)]));
      const { processor } = processorWith(query);
      const reconcileRequest = request();
      const result = reviewed(
        processor,
        await processor.reconcileNext(reconcileRequest),
        reconcileRequest,
      );

      expect(result).toEqual(expected);
      expectFrozenNullPrototype(result);
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[1]?.[0]).toBe(EXPECTED_RECONCILE_SQL);
      expect(query.mock.calls[1]?.[1]?.[0]).toBe(INTENT_FINGERPRINT);
      expect(query.mock.calls[1]?.[1]?.[1]).toBe(query.mock.calls[0]?.[1]?.[0]);
    },
  );

  it.each([
    ['impossible RECORDED outcome', 'UNKNOWN', reconcileRow('RECORDED')],
    [
      'record-intent identity change',
      'UNKNOWN',
      reconcileRow('IDEMPOTENT_REPLAY', { record_intent_fingerprint_sha256: 'e'.repeat(64) }),
    ],
    [
      'evidence identity change',
      'UNKNOWN',
      reconcileRow('IDEMPOTENT_REPLAY', { evidence_fingerprint_sha256: 'e'.repeat(64) }),
    ],
    [
      'deadline change',
      'UNKNOWN',
      reconcileRow('IDEMPOTENT_REPLAY', {
        producer_deadline_at: '2026-09-05T17:00:00.001Z',
      }),
    ],
    ['NEW becoming recorded', 'NEW', reconcileRow('IDEMPOTENT_REPLAY')],
    [
      'resolution before deadline',
      'UNKNOWN',
      reconcileRow('NOT_RECORDED', { resolved_at: '2026-09-05T16:59:59.999Z' }),
    ],
    [
      'recorded evidence at deadline',
      'UNKNOWN',
      reconcileRow('IDEMPOTENT_REPLAY', { evidence_recorded_at: PRODUCER_DEADLINE_AT }),
    ],
    [
      'recorded evidence without binding',
      'UNKNOWN',
      reconcileRow('IDEMPOTENT_REPLAY', { deadline_binding_sha256: null }),
    ],
    [
      'not-recorded evidence',
      'UNKNOWN',
      reconcileRow('NOT_RECORDED', { evidence_recorded_at: EVIDENCE_RECORDED_AT }),
    ],
    [
      'deadline violation without evidence',
      'UNKNOWN',
      reconcileRow('DEADLINE_VIOLATION', { evidence_recorded_at: null }),
    ],
    [
      'deadline violation binding',
      'UNKNOWN',
      reconcileRow('DEADLINE_VIOLATION', {
        deadline_binding_sha256: DEADLINE_BINDING_FINGERPRINT,
      }),
    ],
    ['active response state', 'UNKNOWN', reconcileRow('NOT_RECORDED', { intent_state: 'UNKNOWN' })],
    [
      'extra response field',
      'UNKNOWN',
      Object.freeze({ ...reconcileRow('NOT_RECORDED'), extra: 'forbidden' }),
    ],
  ] as const)(
    'defers the leased identity for a contradictory reconciliation response: %s',
    async (_name, leaseState, responseRow) => {
      const query = jest
        .fn()
        .mockResolvedValueOnce(queryResult([leaseRow(leaseState)]))
        .mockResolvedValueOnce(queryResult([responseRow]));
      const { processor } = processorWith(query);
      const reconcileRequest = request();
      const result = reviewed(
        processor,
        await processor.reconcileNext(reconcileRequest),
        reconcileRequest,
      );

      const expected = {
        reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
        mayAuthorizeFinancialAction: false,
        outcome: 'DEFERRED',
        recordIntentFingerprintSha256: INTENT_FINGERPRINT,
        evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
        knownIntentState: leaseState,
        uncertainPhase: 'RECONCILE_RECORD',
        retryNotBefore: LEASE_EXPIRES_AT,
      };
      expect(result).toEqual(expected);
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0]?.[1]?.[0]).toEqual(Buffer.alloc(32));
      expect(query.mock.calls[1]?.[1]?.[1]).toEqual(Buffer.alloc(32));
    },
  );

  it.each([
    ['rejected query', () => Promise.reject(new Error('private database failure'))],
    ['zero rows', () => Promise.resolve(queryResult([]))],
    [
      'multiple rows',
      () =>
        Promise.resolve(queryResult([reconcileRow('NOT_RECORDED'), reconcileRow('NOT_RECORDED')])),
    ],
    ['non-promise', () => queryResult([reconcileRow('NOT_RECORDED')])],
  ])('does not retry or release after a reconciliation %s', async (_name, secondBehavior) => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult([leaseRow()]))
      .mockImplementationOnce(secondBehavior);
    const { processor } = processorWith(query);
    const reconcileRequest = request();
    const result = reviewed(
      processor,
      await processor.reconcileNext(reconcileRequest),
      reconcileRequest,
    );

    expectDeferred(result, 'RECONCILE_RECORD', true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]?.[0]).toBe(query.mock.calls[1]?.[1]?.[1]);
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(Buffer.alloc(32));
  });

  it('treats a strict committed terminal response as authoritative when abort races after it', async () => {
    const controller = new AbortController();
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult([leaseRow()]))
      .mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve(queryResult([reconcileRow('IDEMPOTENT_REPLAY')]));
      });
    const { processor } = processorWith(query);
    const reconcileRequest = request(controller.signal);
    const result = reviewed(
      processor,
      await processor.reconcileNext(reconcileRequest),
      reconcileRequest,
    );

    expect(result.outcome).toBe('RECORDED');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]?.[0]).toEqual(Buffer.alloc(32));
  });

  it('authenticates issued results only for the exact request identity and processor instance', async () => {
    const query = jest.fn().mockResolvedValue(queryResult([]));
    const { processor } = processorWith(query);
    const { processor: otherProcessor } = processorWith(
      jest.fn().mockResolvedValue(queryResult([])),
    );
    const reconcileRequest = request();
    const equalRequest = request(reconcileRequest.signal);
    const capability = await processor.reconcileNext(reconcileRequest);
    const forged = Object.freeze({
      reconciliationVersion: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_RECORD_INTENT_RECONCILIATION_RESULT_USE,
      mayAuthorizeFinancialAction: false,
      outcome: 'IDLE',
    });

    expect(processor.reviewResult(capability, reconcileRequest)).toBe(capability);
    expect(processor.reviewResult(capability, equalRequest)).toBeNull();
    expect(processor.reviewResult(forged, reconcileRequest)).toBeNull();
    expect(otherProcessor.reviewResult(capability, reconcileRequest)).toBeNull();
    expect(processor.reviewResult(new Proxy(forged, {}), reconcileRequest)).toBeNull();
    expect(processor.reviewResult(null, reconcileRequest)).toBeNull();
  });
});
