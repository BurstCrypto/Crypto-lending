import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import {
  DormantProviderPositionChainAnchorEvidenceProducer,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
  fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
  type ProduceProviderPositionChainAnchorEvidenceRequestV1,
  type ProviderPositionChainAnchorEvidenceProducerClock,
  type ProviderPositionChainAnchorEvidenceRecordCandidateV1,
  type ProviderPositionChainAnchorEvidenceSourceBindingV1,
  type ProviderPositionChainAnchorEvidenceSourcePairV1,
  type ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1,
  type ProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
} from '../application/dormant-provider-position-chain-anchor-evidence.producer';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
  type ProviderPositionChainAnchorEvidenceSourceAttestationV1,
  type ProviderPositionChainAnchorEvidenceSourcePort,
  type ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
} from '../application/ports/provider-position-chain-anchor-evidence-source.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
  type ProviderPositionChainAnchorEvidenceRecordResultV2,
  type RecordProviderPositionChainAnchorEvidenceRequestV2,
} from '../application/ports/provider-position-chain-anchor-evidence-recorder.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ERROR,
  PostgresProviderPositionChainAnchorEvidenceRecorder,
} from './postgres-provider-position-chain-anchor-evidence.recorder';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const HASH_A = `0x${'1'.repeat(64)}`;
const HASH_B = `0x${'2'.repeat(64)}`;
const HASH_C = `0x${'3'.repeat(64)}`;
const HASH_D = `0x${'4'.repeat(64)}`;
const INTENT_FINGERPRINT = '9'.repeat(64);
const EVIDENCE_FINGERPRINT = '8'.repeat(64);
const READ_BINDING_FINGERPRINT = '7'.repeat(64);
const DEADLINE_BINDING_FINGERPRINT = '6'.repeat(64);
const OBSERVED_AT = '2026-09-05T16:59:50.000Z';
const DEADLINE_AT = '2026-09-05T17:00:10.000Z';
const ASSESSED_AT = '2026-09-05T17:00:02.000Z';
const RECORDED_AT = '2026-09-05T17:00:03.000Z';
const RESOLVED_AT = '2026-09-05T17:00:04.000Z';
const AFTER_DEADLINE_AT = '2026-09-05T17:00:11.000Z';

type NetworkId = typeof ETHEREUM | typeof SOLANA;

type IntentState =
  | 'NEW'
  | 'RECORD_DISPATCHED'
  | 'UNKNOWN'
  | 'RECORDED'
  | 'IDEMPOTENT_REPLAY'
  | 'NOT_RECORDED'
  | 'DEADLINE_VIOLATION';

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function frozenNull<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as object, value)) as Readonly<T>;
}

function pairFor(
  networkId: NetworkId,
  expiresAt = '2026-09-05T18:00:00.000Z',
): ProviderPositionChainAnchorEvidenceSourcePairV1 {
  return frozen({
    networkId,
    approvalId: `${networkId === ETHEREUM ? 'ethereum' : 'solana'}-approval-001`,
    approvedAt: '2026-09-05T16:00:00.000Z',
    expiresAt,
    primary: frozen({ sourceFamilyId: 'family-a', sourceId: 'source-a', sourceKind: 'RPC' }),
    corroborating: frozen({
      sourceFamilyId: 'family-b',
      sourceId: 'source-b',
      sourceKind: 'RPC',
    }),
  });
}

function approvedRegistry(
  expiresAt = '2026-09-05T18:00:00.000Z',
): ProviderPositionChainAnchorEvidenceSourcePairRegistryV1 {
  const content = frozen({
    schemaVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    environment: 'MAINNET' as const,
    approvalStatus: 'APPROVED' as const,
    pairs: frozen([pairFor(ETHEREUM, expiresAt), pairFor(SOLANA, expiresAt)]),
  }) satisfies ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1;
  return frozen({
    ...content,
    fingerprintSha256: fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1(content),
  });
}

function anchors(networkId: NetworkId): Readonly<{
  continuityFloor: ProviderPositionChainAnchorEvidenceSourceAttestationV1['continuityFloor'];
  chainAnchor: ProviderPositionChainAnchorEvidenceSourceAttestationV1['chainAnchor'];
  currentHead: ProviderPositionChainAnchorEvidenceSourceAttestationV1['currentHead'];
  finalizedHead: ProviderPositionChainAnchorEvidenceSourceAttestationV1['finalizedHead'];
}> {
  return networkId === ETHEREUM
    ? frozen({
        continuityFloor: frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '50000000',
          blockHash: HASH_A,
        }),
        chainAnchor: frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '50000001',
          blockHash: HASH_B,
        }),
        currentHead: frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '50000010',
          blockHash: HASH_C,
        }),
        finalizedHead: frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '49999990',
          blockHash: HASH_D,
        }),
      })
    : frozen({
        continuityFloor: frozen({
          kind: 'SOLANA_SLOT' as const,
          slot: '441990700',
          root: '441990699',
        }),
        chainAnchor: frozen({
          kind: 'SOLANA_SLOT' as const,
          slot: '441990796',
          root: '441990700',
        }),
        currentHead: frozen({
          kind: 'SOLANA_SLOT' as const,
          slot: '441990810',
          root: '441990800',
        }),
        finalizedHead: frozen({
          kind: 'SOLANA_SLOT' as const,
          slot: '441990800',
          root: '441990800',
        }),
      });
}

interface SourceTimes {
  readonly currentHeadAdvancedAt: string;
  readonly finalizedHeadAdvancedAt: string;
}

class IssuingSource implements ProviderPositionChainAnchorEvidenceSourcePort {
  readonly sourceVersion = PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION;
  readonly #issued = new WeakMap<object, ReadProviderPositionChainAnchorEvidenceSourceRequestV1>();

  constructor(
    private readonly proofSeed: string,
    private readonly times: SourceTimes,
  ) {}

  async readAttestation(
    request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): Promise<unknown> {
    const values = anchors(request.networkId);
    const capability = frozen({
      sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
      mayAuthorizeFinancialAction: false as const,
      mayPersist: false as const,
      networkId: request.networkId,
      sourceFamilyId: request.sourceFamilyId,
      sourceId: request.sourceId,
      sourceKind: request.sourceKind,
      sourceObservationId: request.sourceObservationId,
      continuityFloor: request.continuityFloor,
      chainAnchor: request.chainAnchor,
      observedAt: request.observedAt,
      assessedAt: '2026-09-05T17:00:01.000Z',
      currentHead: values.currentHead,
      currentHeadAdvancedAt: this.times.currentHeadAdvancedAt,
      finalizedHead: values.finalizedHead,
      finalizedHeadAdvancedAt: this.times.finalizedHeadAdvancedAt,
      identityProofSha256: this.proofSeed.repeat(64),
      liveCapabilityProofSha256: String.fromCharCode(this.proofSeed.charCodeAt(0) + 1).repeat(64),
      lineageProofSha256: String.fromCharCode(this.proofSeed.charCodeAt(0) + 2).repeat(64),
    });
    this.#issued.set(capability, request);
    return capability;
  }

  verifyAttestation(
    capability: unknown,
    request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): boolean {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      this.#issued.get(capability) === request
    );
  }
}

class ScriptedClock implements ProviderPositionChainAnchorEvidenceProducerClock {
  calls = 0;

  constructor(private readonly timestamps: readonly string[]) {}

  now(): Date {
    const timestamp = this.timestamps[Math.min(this.calls, this.timestamps.length - 1)];
    this.calls += 1;
    if (timestamp === undefined) throw new Error('unexpected test clock read');
    return new Date(timestamp);
  }
}

interface FixtureOptions {
  readonly observedAt?: string;
  readonly deadlineAt?: string;
  readonly currentHeadAdvancedAt?: string;
  readonly finalizedHeadAdvancedAt?: string;
  readonly approvalExpiresAt?: string;
  readonly clockTimes?: readonly string[];
  readonly signal?: AbortSignal;
  readonly nullProducerRequest?: boolean;
  readonly nullRecordRequest?: boolean;
}

interface RecorderFixture {
  readonly producer: DormantProviderPositionChainAnchorEvidenceProducer;
  readonly producerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly producerCapability: unknown;
  readonly candidate: ProviderPositionChainAnchorEvidenceRecordCandidateV1;
  readonly recordRequest: RecordProviderPositionChainAnchorEvidenceRequestV2;
  readonly recorder: PostgresProviderPositionChainAnchorEvidenceRecorder;
  readonly clock: ScriptedClock;
  readonly query: jest.Mock;
  readonly postgres: { queryWithCancellation: jest.Mock };
  readonly forbidden: readonly jest.Mock[];
}

function producerRequest(
  networkId: NetworkId,
  signal: AbortSignal,
  options: FixtureOptions,
): ProduceProviderPositionChainAnchorEvidenceRequestV1 {
  const values = anchors(networkId);
  const members = {
    producerVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    networkId,
    sourceFamilyId: 'family-a',
    sourceId: 'source-a',
    sourceKind: 'RPC' as const,
    sourceObservationId:
      networkId === ETHEREUM ? 'ethereum-block-50000001' : 'solana-slot-441990796',
    continuityFloor: values.continuityFloor,
    chainAnchor: values.chainAnchor,
    observedAt: options.observedAt ?? OBSERVED_AT,
    deadlineAt: options.deadlineAt ?? DEADLINE_AT,
    signal,
  };
  return (
    options.nullProducerRequest ? frozenNull(members) : frozen(members)
  ) as ProduceProviderPositionChainAnchorEvidenceRequestV1;
}

function bindings(
  selectedNetwork: NetworkId,
  times: SourceTimes,
): readonly ProviderPositionChainAnchorEvidenceSourceBindingV1[] {
  return frozen(
    [ETHEREUM, SOLANA].flatMap((networkId) => {
      const selected = networkId === selectedNetwork;
      const primary = new IssuingSource(selected ? 'a' : '1', times);
      const corroborating = new IssuingSource(selected ? 'd' : '4', times);
      return [
        frozen({
          networkId,
          role: 'PRIMARY' as const,
          sourceFamilyId: 'family-a',
          sourceId: 'source-a',
          sourceKind: 'RPC' as const,
          source: primary,
        }),
        frozen({
          networkId,
          role: 'CORROBORATING' as const,
          sourceFamilyId: 'family-b',
          sourceId: 'source-b',
          sourceKind: 'RPC' as const,
          source: corroborating,
        }),
      ];
    }),
  );
}

function row(state: IntentState, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const terminalRecorded = state === 'RECORDED' || state === 'IDEMPOTENT_REPLAY';
  const resolved = terminalRecorded
    ? RESOLVED_AT
    : state === 'NOT_RECORDED' || state === 'DEADLINE_VIOLATION'
      ? AFTER_DEADLINE_AT
      : null;
  return {
    intent_state: state,
    record_intent_fingerprint_sha256: INTENT_FINGERPRINT,
    evidence_fingerprint_sha256: EVIDENCE_FINGERPRINT,
    read_binding_fingerprint_sha256: READ_BINDING_FINGERPRINT,
    deadline_binding_sha256: terminalRecorded ? DEADLINE_BINDING_FINGERPRINT : null,
    evidence_recorded_at: terminalRecorded || state === 'DEADLINE_VIOLATION' ? RECORDED_AT : null,
    resolved_at: resolved,
    producer_deadline_at: DEADLINE_AT,
    ...overrides,
  };
}

async function fixture(
  networkId: NetworkId = ETHEREUM,
  options: FixtureOptions = {},
): Promise<RecorderFixture> {
  const signal = options.signal ?? new AbortController().signal;
  const times = frozen({
    currentHeadAdvancedAt: options.currentHeadAdvancedAt ?? '2026-09-05T16:59:59.000Z',
    finalizedHeadAdvancedAt: options.finalizedHeadAdvancedAt ?? '2026-09-05T16:59:50.000Z',
  });
  const clock = new ScriptedClock(
    options.clockTimes ??
      frozen([
        '2026-09-05T17:00:00.000Z',
        '2026-09-05T17:00:01.000Z',
        '2026-09-05T17:00:01.000Z',
        ASSESSED_AT,
        ASSESSED_AT,
        '2026-09-05T17:00:02.500Z',
        '2026-09-05T17:00:02.500Z',
      ]),
  );
  const producer = new DormantProviderPositionChainAnchorEvidenceProducer(
    approvedRegistry(options.approvalExpiresAt),
    bindings(networkId, times),
    clock,
  );
  const exactProducerRequest = producerRequest(networkId, signal, options);
  const producerCapability = await producer.produceCandidate(exactProducerRequest);
  const candidate = producerCapability as ProviderPositionChainAnchorEvidenceRecordCandidateV1;
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rows: [row('NEW')] })
    .mockResolvedValueOnce({ rows: [row('RECORD_DISPATCHED')] })
    .mockResolvedValueOnce({ rows: [row('RECORDED')] });
  const forbidden = frozen([jest.fn(), jest.fn(), jest.fn(), jest.fn()]);
  const postgres = {
    queryWithCancellation: query,
    query: forbidden[0],
    withTransaction: forbidden[1],
    recordProviderPositionChainAnchorEvidence: forbidden[2],
    invalidateProviderPositionChainAnchorEvidence: forbidden[3],
  };
  const recorder = new PostgresProviderPositionChainAnchorEvidenceRecorder(
    producer,
    postgres as unknown as PostgresService,
  );
  const members = {
    recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
    mayAuthorizeFinancialAction: false as const,
    producerCapability,
    producerRequest: exactProducerRequest,
    signal,
  };
  const recordRequest = (
    options.nullRecordRequest ? frozenNull(members) : frozen(members)
  ) as RecordProviderPositionChainAnchorEvidenceRequestV2;
  return {
    producer,
    producerRequest: exactProducerRequest,
    producerCapability,
    candidate,
    recordRequest,
    recorder,
    clock,
    query,
    postgres,
    forbidden,
  };
}

function expectedValues(
  candidate: ProviderPositionChainAnchorEvidenceRecordCandidateV1,
): readonly unknown[] {
  return candidate.recordArguments.map((value, index) =>
    index === 5 || index === 6 || index === 9 || index === 11 ? JSON.stringify(value) : value,
  );
}

function expectSanitized(operation: Promise<unknown>): Promise<void> {
  return operation.then(
    () => {
      throw new Error('expected record operation to reject');
    },
    (error: unknown) => {
      expect(error).toBe(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ERROR);
      expect(Object.isFrozen(error)).toBe(true);
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain('secret');
    },
  );
}

function expectSanitizedThrow(operation: () => unknown): void {
  let captured: unknown;
  try {
    operation();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBe(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_ERROR);
  expect(Object.isFrozen(captured)).toBe(true);
  expect(captured).not.toHaveProperty('cause');
}

function scriptRows(test: RecorderFixture, ...rows: Array<Record<string, unknown> | Error>): void {
  test.query.mockReset();
  for (const value of rows) {
    if (value instanceof Error) test.query.mockRejectedValueOnce(value);
    else test.query.mockResolvedValueOnce({ rows: [value] });
  }
}

function reviewedResult(
  test: RecorderFixture,
  capability: unknown,
): ProviderPositionChainAnchorEvidenceRecordResultV2 {
  const reviewed = test.recorder.reviewResult(capability, test.recordRequest);
  if (reviewed === null) throw new Error('expected an authenticated recorder result');
  return reviewed;
}

function expectReconciliation(
  test: RecorderFixture,
  capability: unknown,
  phase: 'PREPARE' | 'CLAIM_DISPATCH' | 'EXECUTE_RECORD' | 'MARK_UNKNOWN',
  state: 'NEW' | 'RECORD_DISPATCHED' | 'UNKNOWN' | null,
): void {
  expect(reviewedResult(test, capability)).toEqual(
    expect.objectContaining({
      recorderVersion: 2,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE,
      mayAuthorizeFinancialAction: false,
      producerDeadlineAt: DEADLINE_AT,
      outcome: 'RECONCILIATION_REQUIRED',
      uncertainPhase: phase,
      knownIntentState: state,
    }),
  );
}

describe('PostgresProviderPositionChainAnchorEvidenceRecorder', () => {
  it.each([ETHEREUM, SOLANA] as const)(
    'prepares 24 reviewed %s values, claims and executes in separate autocommit calls, then zeroizes one shared token',
    async (networkId) => {
      const test = await fixture(networkId, {
        nullProducerRequest: networkId === SOLANA,
        nullRecordRequest: networkId === SOLANA,
      });
      const tokenReferences: Buffer[] = [];
      const tokenSnapshots: Buffer[] = [];
      let queryNumber = 0;
      test.query
        .mockReset()
        .mockImplementation(
          async (_sql: string, values: readonly unknown[], signal: AbortSignal) => {
            queryNumber += 1;
            expect(signal).toBe(test.recordRequest.signal);
            if (queryNumber === 1) return { rows: [row('NEW')] };
            const token = values[1];
            expect(Buffer.isBuffer(token)).toBe(true);
            tokenReferences.push(token as Buffer);
            tokenSnapshots.push(Buffer.from(token as Buffer));
            return queryNumber === 2
              ? { rows: [row('RECORD_DISPATCHED')] }
              : { rows: [row('RECORDED')] };
          },
        );

      const result = await test.recorder.recordEvidence(test.recordRequest);

      expect(test.query).toHaveBeenCalledTimes(3);
      const [prepareSql, prepareValues, prepareSignal] = test.query.mock.calls[0] as [
        string,
        readonly unknown[],
        AbortSignal,
      ];
      expect(prepareSql).toContain('FROM prepare_provider_position_chain_anchor_record_intent(');
      expect(prepareSql).toContain('$24::timestamptz');
      expect(prepareValues).toEqual([...expectedValues(test.candidate), DEADLINE_AT]);
      expect(prepareValues).toHaveLength(24);
      expect(Object.isFrozen(prepareValues)).toBe(true);
      expect(prepareSignal).toBe(test.producerRequest.signal);
      expect(test.query.mock.calls[1]?.[0]).toContain(
        'FROM claim_provider_position_chain_anchor_record_dispatch($1::text, $2::bytea)',
      );
      expect(test.query.mock.calls[2]?.[0]).toContain(
        'FROM execute_provider_position_chain_anchor_record_intent($1::text, $2::bytea)',
      );
      expect(test.query.mock.calls[1]?.[1]).toEqual([INTENT_FINGERPRINT, expect.any(Buffer)]);
      expect(tokenReferences).toHaveLength(2);
      expect(tokenReferences[0]).toBe(tokenReferences[1]);
      expect(tokenSnapshots[0]).toHaveLength(32);
      expect(tokenSnapshots[0]?.equals(Buffer.alloc(32))).toBe(false);
      expect(tokenSnapshots[1]?.equals(tokenSnapshots[0] as Buffer)).toBe(true);
      expect(tokenReferences[0]?.equals(Buffer.alloc(32))).toBe(true);
      for (const forbidden of test.forbidden) expect(forbidden).not.toHaveBeenCalled();
      expect(result).toEqual({
        recorderVersion: 2,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE,
        mayAuthorizeFinancialAction: false,
        producerDeadlineAt: DEADLINE_AT,
        outcome: 'RECORDED',
        recordOutcome: 'RECORDED',
        recordIntentFingerprintSha256: INTENT_FINGERPRINT,
        evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
        deadlineBindingSha256: DEADLINE_BINDING_FINGERPRINT,
        evidenceRecordedAt: RECORDED_AT,
        resolvedAt: RESOLVED_AT,
      });
      expect(Object.getPrototypeOf(result as object)).toBeNull();
      expect(Object.isFrozen(result)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(tokenSnapshots[0]?.toString('hex'));
      expect(test.recorder.reviewResult(result, test.recordRequest)).toBe(result);
      expect(test.recorder.reviewResult(structuredClone(result), test.recordRequest)).toBeNull();
      expect(test.recorder.reviewResult(result, frozen({ ...test.recordRequest }))).toBeNull();
      const foreign = new PostgresProviderPositionChainAnchorEvidenceRecorder(
        test.producer,
        test.postgres as unknown as PostgresService,
      );
      expect(foreign.reviewResult(result, test.recordRequest)).toBeNull();
    },
  );

  it('rejects and zeroizes an all-zero 32-byte CSPRNG result before CLAIM', async () => {
    const test = await fixture();
    test.query.mockReset().mockResolvedValueOnce({ rows: [row('NEW')] });
    const zeroToken = Buffer.alloc(32);
    const fill = jest.spyOn(zeroToken, 'fill');
    const cryptoModule = jest.requireActual('node:crypto') as {
      randomBytes(size: number): Buffer;
    };
    const random = jest.spyOn(cryptoModule, 'randomBytes').mockReturnValueOnce(zeroToken);
    try {
      const result = await test.recorder.recordEvidence(test.recordRequest);

      expectReconciliation(test, result, 'CLAIM_DISPATCH', 'NEW');
      expect(test.query).toHaveBeenCalledTimes(1);
      expect(random).toHaveBeenCalledTimes(1);
      expect(random).toHaveBeenCalledWith(32);
      expect(fill).toHaveBeenCalledTimes(1);
      expect(fill).toHaveBeenCalledWith(0);
    } finally {
      random.mockRestore();
      fill.mockRestore();
    }
  });

  it.each([
    [
      'RECORDED',
      {
        outcome: 'RECORDED',
        recordOutcome: 'RECORDED',
        deadlineBindingSha256: DEADLINE_BINDING_FINGERPRINT,
        evidenceRecordedAt: RECORDED_AT,
      },
    ],
    [
      'IDEMPOTENT_REPLAY',
      {
        outcome: 'RECORDED',
        recordOutcome: 'IDEMPOTENT_REPLAY',
        deadlineBindingSha256: DEADLINE_BINDING_FINGERPRINT,
        evidenceRecordedAt: RECORDED_AT,
      },
    ],
    ['NOT_RECORDED', { outcome: 'NOT_RECORDED', resolvedAt: AFTER_DEADLINE_AT }],
    [
      'DEADLINE_VIOLATION',
      {
        outcome: 'DEADLINE_VIOLATION',
        evidenceRecordedAt: RECORDED_AT,
        resolvedAt: AFTER_DEADLINE_AT,
      },
    ],
  ] as const)('maps a PREPARE terminal %s without claiming', async (state, expected) => {
    const test = await fixture();
    scriptRows(test, row(state));

    const result = await test.recorder.recordEvidence(test.recordRequest);

    expect(test.query).toHaveBeenCalledTimes(1);
    expect(reviewedResult(test, result)).toEqual(
      expect.objectContaining({
        ...expected,
        recordIntentFingerprintSha256: INTENT_FINGERPRINT,
        evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
        producerDeadlineAt: DEADLINE_AT,
      }),
    );
  });

  it('accepts deadline-violation evidence after the producer deadline when source freshness remains valid', async () => {
    const test = await fixture();
    scriptRows(
      test,
      row('DEADLINE_VIOLATION', {
        evidence_recorded_at: '2026-09-05T17:00:10.500Z',
      }),
    );

    const result = await test.recorder.recordEvidence(test.recordRequest);

    expect(reviewedResult(test, result)).toEqual(
      expect.objectContaining({
        outcome: 'DEADLINE_VIOLATION',
        evidenceRecordedAt: '2026-09-05T17:00:10.500Z',
      }),
    );
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it.each(['RECORD_DISPATCHED', 'UNKNOWN'] as const)(
    'returns authenticated reconciliation for PREPARE %s without dispatching again',
    async (state) => {
      const test = await fixture();
      scriptRows(test, row(state));

      const result = await test.recorder.recordEvidence(test.recordRequest);

      expect(test.query).toHaveBeenCalledTimes(1);
      expectReconciliation(test, result, 'PREPARE', state);
      expect(reviewedResult(test, result)).toEqual(
        expect.objectContaining({
          recordIntentFingerprintSha256: INTENT_FINGERPRINT,
          evidenceFingerprintSha256: EVIDENCE_FINGERPRINT,
        }),
      );
    },
  );

  it.each([
    ['throw', new Error('secret synchronous failure')],
    ['reject', new Error('secret asynchronous failure')],
    ['no rows', []],
    ['multiple rows', [row('NEW'), row('NEW')]],
    ['extra column', [{ ...row('NEW'), authority: true }]],
    ['wrong state', [{ ...row('NEW'), intent_state: 'PARTIAL' }]],
    ['zero fingerprint', [{ ...row('NEW'), evidence_fingerprint_sha256: '0'.repeat(64) }]],
    ['bad deadline', [{ ...row('NEW'), producer_deadline_at: '2026-09-05T17:00:10Z' }]],
    ['bad nullability', [{ ...row('NEW'), resolved_at: RESOLVED_AT }]],
  ])(
    'turns a valid request with malformed PREPARE %s into an issued uncertain result',
    async (kind, value) => {
      const test = await fixture();
      test.query.mockReset();
      if (kind === 'throw') {
        test.query.mockImplementationOnce(() => {
          throw value;
        });
      } else if (kind === 'reject') {
        test.query.mockRejectedValueOnce(value);
      } else {
        test.query.mockResolvedValueOnce({ rows: value });
      }

      const result = await test.recorder.recordEvidence(test.recordRequest);

      expect(test.query).toHaveBeenCalledTimes(1);
      expectReconciliation(test, result, 'PREPARE', null);
      expect(reviewedResult(test, result)).toEqual(
        expect.objectContaining({
          recordIntentFingerprintSha256: null,
          evidenceFingerprintSha256: null,
        }),
      );
    },
  );

  it('does not invoke accessor or proxy PREPARE rows and reports uncertainty', async () => {
    const accessorTest = await fixture();
    const getter = jest.fn(() => 'NEW');
    const accessorRow = row('NEW');
    Object.defineProperty(accessorRow, 'intent_state', { enumerable: true, get: getter });
    accessorTest.query.mockReset().mockResolvedValueOnce({ rows: [accessorRow] });
    const accessorResult = await accessorTest.recorder.recordEvidence(accessorTest.recordRequest);
    expect(getter).not.toHaveBeenCalled();
    expectReconciliation(accessorTest, accessorResult, 'PREPARE', null);

    const proxyTest = await fixture();
    proxyTest.query.mockReset().mockResolvedValueOnce({ rows: [new Proxy(row('NEW'), {})] });
    const proxyResult = await proxyTest.recorder.recordEvidence(proxyTest.recordRequest);
    expectReconciliation(proxyTest, proxyResult, 'PREPARE', null);
  });

  it.each(['reject', 'malformed', 'cross-phase mismatch'] as const)(
    'attempts EXECUTE exactly once after ambiguous CLAIM %s and never reclaims',
    async (behavior) => {
      const test = await fixture();
      test.query.mockReset().mockResolvedValueOnce({ rows: [row('NEW')] });
      if (behavior === 'reject') test.query.mockRejectedValueOnce(new Error('secret claim'));
      if (behavior === 'malformed') test.query.mockResolvedValueOnce({ rows: [] });
      if (behavior === 'cross-phase mismatch') {
        test.query.mockResolvedValueOnce({
          rows: [row('RECORD_DISPATCHED', { record_intent_fingerprint_sha256: '5'.repeat(64) })],
        });
      }
      test.query.mockResolvedValueOnce({ rows: [row('RECORDED')] });

      const result = await test.recorder.recordEvidence(test.recordRequest);

      expect(reviewedResult(test, result).outcome).toBe('RECORDED');
      expect(test.query).toHaveBeenCalledTimes(3);
      expect(
        test.query.mock.calls.filter((call) =>
          String(call[0]).includes('claim_provider_position_chain_anchor_record_dispatch'),
        ),
      ).toHaveLength(1);
      expect(
        test.query.mock.calls.filter((call) =>
          String(call[0]).includes('execute_provider_position_chain_anchor_record_intent'),
        ),
      ).toHaveLength(1);
    },
  );

  it('maps a valid CLAIM terminal or UNKNOWN without calling EXECUTE', async () => {
    const terminal = await fixture();
    scriptRows(terminal, row('NEW'), row('NOT_RECORDED'));
    const terminalResult = await terminal.recorder.recordEvidence(terminal.recordRequest);
    expect(reviewedResult(terminal, terminalResult).outcome).toBe('NOT_RECORDED');
    expect(terminal.query).toHaveBeenCalledTimes(2);

    const uncertain = await fixture();
    scriptRows(uncertain, row('NEW'), row('UNKNOWN'));
    const uncertainResult = await uncertain.recorder.recordEvidence(uncertain.recordRequest);
    expectReconciliation(uncertain, uncertainResult, 'CLAIM_DISPATCH', 'UNKNOWN');
    expect(uncertain.query).toHaveBeenCalledTimes(2);
  });

  it('stops at a structurally impossible terminal instead of making another token-bearing call', async () => {
    const claimTest = await fixture();
    scriptRows(
      claimTest,
      row('NEW'),
      row('RECORDED', { deadline_binding_sha256: null }),
      row('RECORDED'),
    );
    const claimResult = await claimTest.recorder.recordEvidence(claimTest.recordRequest);
    expectReconciliation(claimTest, claimResult, 'CLAIM_DISPATCH', null);
    expect(claimTest.query).toHaveBeenCalledTimes(2);

    const executeTest = await fixture();
    scriptRows(
      executeTest,
      row('NEW'),
      row('RECORD_DISPATCHED'),
      row('DEADLINE_VIOLATION', { evidence_recorded_at: null }),
      row('UNKNOWN'),
    );
    const executeResult = await executeTest.recorder.recordEvidence(executeTest.recordRequest);
    expectReconciliation(executeTest, executeResult, 'EXECUTE_RECORD', null);
    expect(executeTest.query).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      'rejected execute and UNKNOWN mark',
      new Error('secret execute'),
      row('UNKNOWN'),
      'RECONCILIATION_REQUIRED',
    ],
    ['malformed execute and terminal mark', { rows: [] }, row('IDEMPOTENT_REPLAY'), 'RECORDED'],
    [
      'nonterminal execute and terminal mark',
      { rows: [row('RECORD_DISPATCHED')] },
      row('NOT_RECORDED'),
      'NOT_RECORDED',
    ],
    [
      'rejected execute and rejected mark',
      new Error('secret execute'),
      new Error('secret mark'),
      'RECONCILIATION_REQUIRED',
    ],
  ] as const)(
    'performs one best-effort MARK_UNKNOWN for %s',
    async (_name, executeBehavior, markBehavior, expectedOutcome) => {
      const test = await fixture();
      test.query.mockReset();
      test.query.mockResolvedValueOnce({ rows: [row('NEW')] });
      test.query.mockResolvedValueOnce({ rows: [row('RECORD_DISPATCHED')] });
      if (executeBehavior instanceof Error) test.query.mockRejectedValueOnce(executeBehavior);
      else test.query.mockResolvedValueOnce(executeBehavior);
      if (markBehavior instanceof Error) test.query.mockRejectedValueOnce(markBehavior);
      else test.query.mockResolvedValueOnce({ rows: [markBehavior] });

      const result = await test.recorder.recordEvidence(test.recordRequest);

      expect(reviewedResult(test, result).outcome).toBe(expectedOutcome);
      expect(test.query).toHaveBeenCalledTimes(4);
      expect(test.query.mock.calls[3]?.[0]).toContain(
        'FROM mark_provider_position_chain_anchor_record_intent_unknown($1::text, $2::bytea)',
      );
      if (expectedOutcome === 'RECONCILIATION_REQUIRED') {
        expectReconciliation(
          test,
          result,
          'MARK_UNKNOWN',
          markBehavior instanceof Error ? null : 'UNKNOWN',
        );
      }
    },
  );

  it('accepts a strictly reviewed EXECUTE terminal even when the signal aborts before its response', async () => {
    const controller = new AbortController();
    const test = await fixture(ETHEREUM, { signal: controller.signal });
    test.query.mockReset();
    test.query.mockResolvedValueOnce({ rows: [row('NEW')] });
    test.query.mockResolvedValueOnce({ rows: [row('RECORD_DISPATCHED')] });
    test.query.mockImplementationOnce(async () => {
      controller.abort();
      return { rows: [row('RECORDED')] };
    });

    const result = await test.recorder.recordEvidence(test.recordRequest);

    expect(reviewedResult(test, result).outcome).toBe('RECORDED');
    expect(test.query).toHaveBeenCalledTimes(3);
  });

  it('does not EXECUTE after an aborted ambiguous CLAIM and does not MARK after an aborted ambiguous EXECUTE', async () => {
    const claimController = new AbortController();
    const claimTest = await fixture(ETHEREUM, { signal: claimController.signal });
    claimTest.query.mockReset();
    claimTest.query.mockResolvedValueOnce({ rows: [row('NEW')] });
    claimTest.query.mockImplementationOnce(async () => {
      claimController.abort();
      throw new Error('secret claim ambiguity');
    });
    const claimResult = await claimTest.recorder.recordEvidence(claimTest.recordRequest);
    expectReconciliation(claimTest, claimResult, 'CLAIM_DISPATCH', null);
    expect(claimTest.query).toHaveBeenCalledTimes(2);

    const executeController = new AbortController();
    const executeTest = await fixture(ETHEREUM, { signal: executeController.signal });
    executeTest.query.mockReset();
    executeTest.query.mockResolvedValueOnce({ rows: [row('NEW')] });
    executeTest.query.mockResolvedValueOnce({ rows: [row('RECORD_DISPATCHED')] });
    executeTest.query.mockImplementationOnce(async () => {
      executeController.abort();
      throw new Error('secret execute ambiguity');
    });
    const executeResult = await executeTest.recorder.recordEvidence(executeTest.recordRequest);
    expectReconciliation(executeTest, executeResult, 'EXECUTE_RECORD', null);
    expect(executeTest.query).toHaveBeenCalledTimes(3);
  });

  it('stops after PREPARE when abort or capability expiry prevents the one producer re-review', async () => {
    const controller = new AbortController();
    const aborted = await fixture(ETHEREUM, { signal: controller.signal });
    aborted.query.mockReset().mockImplementationOnce(async () => {
      controller.abort();
      return { rows: [row('NEW')] };
    });
    const abortedResult = await aborted.recorder.recordEvidence(aborted.recordRequest);
    expectReconciliation(aborted, abortedResult, 'PREPARE', 'NEW');
    expect(aborted.query).toHaveBeenCalledTimes(1);

    const expired = await fixture(ETHEREUM, {
      clockTimes: frozen([
        '2026-09-05T17:00:00.000Z',
        '2026-09-05T17:00:01.000Z',
        '2026-09-05T17:00:01.000Z',
        ASSESSED_AT,
        ASSESSED_AT,
        '2026-09-05T17:00:03.000Z',
        DEADLINE_AT,
      ]),
    });
    expired.query.mockReset().mockResolvedValueOnce({ rows: [row('NEW')] });
    const expiredResult = await expired.recorder.recordEvidence(expired.recordRequest);
    expectReconciliation(expired, expiredResult, 'PREPARE', 'NEW');
    expect(expired.query).toHaveBeenCalledTimes(1);
    expect(expired.clock.calls).toBe(7);
  });

  it.each([
    ['a mutable outer request', (test: RecorderFixture) => ({ ...test.recordRequest })],
    [
      'an unexpected field',
      (test: RecorderFixture) => frozen({ ...test.recordRequest, grant: true }),
    ],
    ['version 1', (test: RecorderFixture) => frozen({ ...test.recordRequest, recorderVersion: 1 })],
    [
      'financial authority',
      (test: RecorderFixture) =>
        frozen({ ...test.recordRequest, mayAuthorizeFinancialAction: true }),
    ],
    [
      'a substituted signal',
      (test: RecorderFixture) =>
        frozen({ ...test.recordRequest, signal: new AbortController().signal }),
    ],
    [
      'a cloned producer request',
      (test: RecorderFixture) =>
        frozen({ ...test.recordRequest, producerRequest: frozen({ ...test.producerRequest }) }),
    ],
  ])('rejects %s with the one sanitized error before PREPARE', async (_name, mutate) => {
    const test = await fixture();
    await expectSanitized(
      test.recorder.recordEvidence(
        mutate(test) as unknown as RecordProviderPositionChainAnchorEvidenceRequestV2,
      ),
    );
    expect(test.query).not.toHaveBeenCalled();
  });

  it('rejects pre-abort, fake signals, hostile capabilities, and request accessors before SQL', async () => {
    const controller = new AbortController();
    const aborted = await fixture(ETHEREUM, { signal: controller.signal });
    controller.abort();
    await expectSanitized(aborted.recorder.recordEvidence(aborted.recordRequest));
    expect(aborted.query).not.toHaveBeenCalled();

    const fake = await fixture();
    await expectSanitized(
      fake.recorder.recordEvidence(
        frozen({
          ...fake.recordRequest,
          signal: frozen({ aborted: false }),
        }) as unknown as RecordProviderPositionChainAnchorEvidenceRequestV2,
      ),
    );
    expect(fake.query).not.toHaveBeenCalled();

    const hostile = await fixture();
    let inspected = 0;
    const capability = new Proxy(frozen({ opaque: true }), {
      get: () => {
        inspected += 1;
        throw new Error('secret');
      },
      ownKeys: () => {
        inspected += 1;
        throw new Error('secret');
      },
    });
    await expectSanitized(
      hostile.recorder.recordEvidence(
        frozen({ ...hostile.recordRequest, producerCapability: capability }),
      ),
    );
    expect(inspected).toBe(0);
    expect(hostile.query).not.toHaveBeenCalled();

    const accessor = await fixture();
    const mutable = { ...accessor.recordRequest } as Record<string, unknown>;
    const getter = jest.fn(() => accessor.producerCapability);
    Object.defineProperty(mutable, 'producerCapability', { enumerable: true, get: getter });
    Object.freeze(mutable);
    await expectSanitized(
      accessor.recorder.recordEvidence(
        mutable as unknown as RecordProviderPositionChainAnchorEvidenceRequestV2,
      ),
    );
    expect(getter).not.toHaveBeenCalled();
    expect(accessor.query).not.toHaveBeenCalled();
  });

  it('captures genuine methods without construction I/O and rejects accessor/proxy methods or producer shadows', async () => {
    const test = await fixture();
    const replacement = jest.fn().mockRejectedValue(new Error('secret replacement'));
    expect(test.query).not.toHaveBeenCalled();
    test.postgres.queryWithCancellation = replacement;
    await expect(test.recorder.recordEvidence(test.recordRequest)).resolves.toBeDefined();
    expect(test.query).toHaveBeenCalledTimes(3);
    expect(replacement).not.toHaveBeenCalled();

    const getter = jest.fn(() => jest.fn());
    const accessor = {};
    Object.defineProperty(accessor, 'queryWithCancellation', { enumerable: true, get: getter });
    expectSanitizedThrow(
      () =>
        new PostgresProviderPositionChainAnchorEvidenceRecorder(
          test.producer,
          accessor as PostgresService,
        ),
    );
    expect(getter).not.toHaveBeenCalled();
    expectSanitizedThrow(
      () =>
        new PostgresProviderPositionChainAnchorEvidenceRecorder(
          test.producer,
          new Proxy({ queryWithCancellation: jest.fn() }, {}) as unknown as PostgresService,
        ),
    );

    const shadow = jest.fn();
    Object.defineProperty(test.producer, 'reviewCandidate', { configurable: true, value: shadow });
    expectSanitizedThrow(
      () =>
        new PostgresProviderPositionChainAnchorEvidenceRecorder(
          test.producer,
          test.postgres as unknown as PostgresService,
        ),
    );
    expect(shadow).not.toHaveBeenCalled();
  });

  it('fails malformed terminal time/hash/null contracts closed as phase uncertainty', async () => {
    for (const malformed of [
      row('RECORDED', { deadline_binding_sha256: null }),
      row('RECORDED', { evidence_recorded_at: DEADLINE_AT }),
      row('RECORDED', { evidence_recorded_at: '2026-09-05T17:00:01.999Z' }),
      row('RECORDED', { resolved_at: '2026-09-05T17:00:02.999Z' }),
      row('NOT_RECORDED', { resolved_at: RESOLVED_AT }),
      row('DEADLINE_VIOLATION', { evidence_recorded_at: null }),
      row('DEADLINE_VIOLATION', {
        evidence_recorded_at: '2026-09-05T17:00:01.999Z',
      }),
      row('DEADLINE_VIOLATION', { deadline_binding_sha256: DEADLINE_BINDING_FINGERPRINT }),
      row('DEADLINE_VIOLATION', {
        evidence_recorded_at: AFTER_DEADLINE_AT,
        resolved_at: RESOLVED_AT,
      }),
    ]) {
      const test = await fixture();
      scriptRows(test, malformed);
      const result = await test.recorder.recordEvidence(test.recordRequest);
      expectReconciliation(test, result, 'PREPARE', null);
    }
  });

  it.each([
    [
      'source-pair approval',
      ETHEREUM,
      { approvalExpiresAt: '2026-09-05T17:00:08.000Z' },
      '2026-09-05T17:00:08.000Z',
    ],
    [
      'Ethereum current-head',
      ETHEREUM,
      { currentHeadAdvancedAt: '2026-09-05T16:59:06.000Z' },
      '2026-09-05T17:00:06.000Z',
    ],
    [
      'Ethereum finalized-head',
      ETHEREUM,
      { finalizedHeadAdvancedAt: '2026-09-05T16:30:06.000Z' },
      '2026-09-05T17:00:06.000Z',
    ],
    [
      'Solana current-head',
      SOLANA,
      { currentHeadAdvancedAt: '2026-09-05T16:59:48.000Z' },
      '2026-09-05T17:00:03.000Z',
    ],
    [
      'Solana finalized-head',
      SOLANA,
      { finalizedHeadAdvancedAt: '2026-09-05T16:58:33.000Z' },
      '2026-09-05T17:00:03.000Z',
    ],
  ] as const)(
    'rejects deadline-violation evidence at the strict %s freshness boundary',
    async (_name, networkId, options, evidenceRecordedAt) => {
      const test = await fixture(networkId, options);
      scriptRows(test, row('DEADLINE_VIOLATION', { evidence_recorded_at: evidenceRecordedAt }));

      const result = await test.recorder.recordEvidence(test.recordRequest);

      expectReconciliation(test, result, 'PREPARE', null);
      expect(test.query).toHaveBeenCalledTimes(1);
    },
  );

  it('remains dormant and uses only the 0031 guarded record-intent surface', () => {
    const source = readFileSync(
      join(__dirname, 'postgres-provider-position-chain-anchor-evidence.recorder.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/@Injectable|@Module|providers\s*:/u);
    expect(source).not.toMatch(/process\.env|fetch\(|https?:|from ['"]viem|@solana\/web3/u);
    expect(source).not.toContain('withTransaction');
    expect(source).not.toMatch(/\.query\s*\(/u);
    expect(source).not.toContain('FROM record_provider_position_chain_anchor_evidence(');
    expect(source).not.toContain('record_provider_position_chain_anchor_evidence_guarded(');
    expect(source.match(/execute_provider_position_chain_anchor_record_intent/g)).toHaveLength(1);
    expect(source).toContain('prepare_provider_position_chain_anchor_record_intent');
    expect(source).toContain('claim_provider_position_chain_anchor_record_dispatch');
    expect(source).toContain('mark_provider_position_chain_anchor_record_intent_unknown');
    expect(source).toContain('dispatchToken?.fill(0)');
  });
});
