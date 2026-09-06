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
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
  type RecordProviderPositionChainAnchorEvidenceRequestV1,
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
const RECORDED_FINGERPRINT = 'f'.repeat(64);
const OBSERVED_AT = '2026-09-05T16:59:50.000Z';
const DEADLINE_AT = '2026-09-05T17:00:10.000Z';
const ASSESSED_AT = '2026-09-05T17:00:02.000Z';
const RECORDED_AT = '2026-09-05T17:00:03.000Z';

type NetworkId = typeof ETHEREUM | typeof SOLANA;

const RECORD_SQL = `SELECT
  evidence.record_outcome,
  evidence.recorded_evidence_fingerprint_sha256,
  pg_catalog.to_char(
    evidence.evidence_recorded_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS evidence_recorded_at
FROM record_provider_position_chain_anchor_evidence(
  $1::text, $2::text, $3::text, $4::text, $5::text,
  $6::jsonb, $7::jsonb, $8::timestamptz, $9::timestamptz,
  $10::jsonb, $11::timestamptz, $12::jsonb, $13::timestamptz,
  $14::text, $15::text, $16::text, $17::text, $18::text,
  $19::text, $20::text, $21::text, $22::text, $23::timestamptz
) AS evidence`;

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
  readonly outcome?: 'RECORDED' | 'IDEMPOTENT_REPLAY';
  readonly recordedAt?: string;
}

interface RecorderFixture {
  readonly producer: DormantProviderPositionChainAnchorEvidenceProducer;
  readonly producerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly producerCapability: unknown;
  readonly candidate: ProviderPositionChainAnchorEvidenceRecordCandidateV1;
  readonly recordRequest: RecordProviderPositionChainAnchorEvidenceRequestV1;
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

function row(
  outcome: 'RECORDED' | 'IDEMPOTENT_REPLAY' = 'RECORDED',
  recordedAt = RECORDED_AT,
): Record<string, unknown> {
  return {
    record_outcome: outcome,
    recorded_evidence_fingerprint_sha256: RECORDED_FINGERPRINT,
    evidence_recorded_at: recordedAt,
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
  const query = jest.fn().mockResolvedValue({
    rows: [row(options.outcome, options.recordedAt)],
  });
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
  ) as RecordProviderPositionChainAnchorEvidenceRequestV1;
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

describe('PostgresProviderPositionChainAnchorEvidenceRecorder', () => {
  it.each([ETHEREUM, SOLANA] as const)(
    'records one exact authenticated %s candidate and issues only an exact-request-bound receipt',
    async (networkId) => {
      const test = await fixture(networkId, {
        nullProducerRequest: networkId === SOLANA,
        nullRecordRequest: networkId === SOLANA,
      });
      expect(test.query).not.toHaveBeenCalled();

      const receipt = await test.recorder.recordEvidence(test.recordRequest);

      expect(test.query).toHaveBeenCalledTimes(1);
      const [sql, values, signal] = test.query.mock.calls[0] as [
        string,
        readonly unknown[],
        AbortSignal,
      ];
      expect(sql).toBe(RECORD_SQL);
      expect(values).toEqual(expectedValues(test.candidate));
      expect(values).toHaveLength(23);
      expect(Object.isFrozen(values)).toBe(true);
      expect(signal).toBe(test.producerRequest.signal);
      expect(signal).toBe(test.recordRequest.signal);
      for (const forbidden of test.forbidden) expect(forbidden).not.toHaveBeenCalled();
      expect(test.clock.calls).toBe(7);
      expect(receipt).toEqual({
        recorderVersion: 1,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RECEIPT_USE,
        mayAuthorizeFinancialAction: false,
        recordOutcome: 'RECORDED',
        recordedEvidenceFingerprintSha256: RECORDED_FINGERPRINT,
        evidenceRecordedAt: RECORDED_AT,
      });
      expect(Object.getPrototypeOf(receipt as object)).toBeNull();
      expect(Object.isFrozen(receipt)).toBe(true);
      expect(test.recorder.verifyReceipt(receipt, test.recordRequest)).toBe(true);
      expect(test.recorder.verifyReceipt(structuredClone(receipt), test.recordRequest)).toBe(false);
      expect(test.recorder.verifyReceipt(receipt, frozen({ ...test.recordRequest }))).toBe(false);
      const foreign = new PostgresProviderPositionChainAnchorEvidenceRecorder(
        test.producer,
        test.postgres as unknown as PostgresService,
      );
      expect(foreign.verifyReceipt(receipt, test.recordRequest)).toBe(false);
    },
  );

  it('accepts migration-0029 idempotent replay as a completed, non-authorizing record', async () => {
    const test = await fixture(ETHEREUM, { outcome: 'IDEMPOTENT_REPLAY' });

    await expect(test.recorder.recordEvidence(test.recordRequest)).resolves.toEqual(
      expect.objectContaining({
        mayAuthorizeFinancialAction: false,
        recordOutcome: 'IDEMPOTENT_REPLAY',
      }),
    );
  });

  it('accepts an older observation freshly corroborated inside the producer-owned deadline', async () => {
    const test = await fixture(ETHEREUM, { observedAt: '2026-09-05T16:00:00.000Z' });

    await expect(test.recorder.recordEvidence(test.recordRequest)).resolves.toBeDefined();
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('captures the query method without I/O and ignores later member replacement', async () => {
    const test = await fixture();
    const replacement = jest.fn().mockRejectedValue(new Error('secret replacement'));
    expect(test.query).not.toHaveBeenCalled();
    test.postgres.queryWithCancellation = replacement;

    await expect(test.recorder.recordEvidence(test.recordRequest)).resolves.toBeDefined();
    expect(test.query).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
  });

  it('uses the module-captured canonical producer reviewer after hostile prototype replacement', async () => {
    const test = await fixture();
    const prototype = DormantProviderPositionChainAnchorEvidenceProducer.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, 'reviewCandidate');
    const hostile = jest.fn(() => {
      throw new Error('secret prototype replacement');
    });
    if (original === undefined) throw new Error('missing reviewCandidate descriptor');
    Object.defineProperty(prototype, 'reviewCandidate', { ...original, value: hostile });
    try {
      const recorder = new PostgresProviderPositionChainAnchorEvidenceRecorder(
        test.producer,
        test.postgres as unknown as PostgresService,
      );
      await expect(recorder.recordEvidence(test.recordRequest)).resolves.toBeDefined();
      expect(hostile).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(prototype, 'reviewCandidate', original);
    }
  });

  it('rejects producer method shadows and forged receivers without issuing SQL', async () => {
    const shadowed = await fixture();
    const shadow = jest.fn();
    Object.defineProperty(shadowed.producer, 'reviewCandidate', {
      configurable: true,
      value: shadow,
    });
    expectSanitizedThrow(
      () =>
        new PostgresProviderPositionChainAnchorEvidenceRecorder(
          shadowed.producer,
          shadowed.postgres as unknown as PostgresService,
        ),
    );
    expect(shadow).not.toHaveBeenCalled();
    expect(shadowed.query).not.toHaveBeenCalled();

    const genuine = await fixture();
    const forged = Object.create(
      DormantProviderPositionChainAnchorEvidenceProducer.prototype,
    ) as DormantProviderPositionChainAnchorEvidenceProducer;
    const recorder = new PostgresProviderPositionChainAnchorEvidenceRecorder(
      forged,
      genuine.postgres as unknown as PostgresService,
    );
    await expectSanitized(recorder.recordEvidence(genuine.recordRequest));
    expect(genuine.query).not.toHaveBeenCalled();
  });

  it('rejects accessor, proxy, missing, and base-prototype database methods at construction', async () => {
    const test = await fixture();
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
    expectSanitizedThrow(
      () =>
        new PostgresProviderPositionChainAnchorEvidenceRecorder(test.producer, {
          queryWithCancellation: new Proxy(jest.fn(), {}),
        } as unknown as PostgresService),
    );
    const polluted = jest.fn();
    Object.defineProperty(Object.prototype, 'queryWithCancellation', {
      configurable: true,
      value: polluted,
    });
    try {
      expectSanitizedThrow(
        () =>
          new PostgresProviderPositionChainAnchorEvidenceRecorder(
            test.producer,
            {} as PostgresService,
          ),
      );
      expect(polluted).not.toHaveBeenCalled();
    } finally {
      delete (Object.prototype as { queryWithCancellation?: unknown }).queryWithCancellation;
    }
  });

  it.each([
    ['a mutable outer request', (test: RecorderFixture) => ({ ...test.recordRequest })],
    [
      'an unexpected outer field',
      (test: RecorderFixture) => frozen({ ...test.recordRequest, persistenceAuthority: true }),
    ],
    [
      'an unsupported recorder version',
      (test: RecorderFixture) => frozen({ ...test.recordRequest, recorderVersion: 2 }),
    ],
    [
      'financial authority',
      (test: RecorderFixture) =>
        frozen({ ...test.recordRequest, mayAuthorizeFinancialAction: true }),
    ],
    [
      'a substituted outer signal',
      (test: RecorderFixture) =>
        frozen({ ...test.recordRequest, signal: new AbortController().signal }),
    ],
    [
      'a cloned producer request',
      (test: RecorderFixture) =>
        frozen({ ...test.recordRequest, producerRequest: frozen({ ...test.producerRequest }) }),
    ],
  ])('rejects %s before SQL', async (_name, mutate) => {
    const test = await fixture();
    await expectSanitized(
      test.recorder.recordEvidence(
        mutate(test) as unknown as RecordProviderPositionChainAnchorEvidenceRequestV1,
      ),
    );
    expect(test.query).not.toHaveBeenCalled();
  });

  it('rejects an accessor outer field without invoking it', async () => {
    const test = await fixture();
    const mutable = { ...test.recordRequest } as Record<string, unknown>;
    const getter = jest.fn(() => test.producerCapability);
    Object.defineProperty(mutable, 'producerCapability', { enumerable: true, get: getter });
    Object.freeze(mutable);

    await expectSanitized(
      test.recorder.recordEvidence(
        mutable as unknown as RecordProviderPositionChainAnchorEvidenceRequestV1,
      ),
    );
    expect(getter).not.toHaveBeenCalled();
    expect(test.query).not.toHaveBeenCalled();
  });

  it('checks the exact genuine signal before producer review and rejects pre-abort', async () => {
    const controller = new AbortController();
    const test = await fixture(ETHEREUM, { signal: controller.signal });
    controller.abort();

    await expectSanitized(test.recorder.recordEvidence(test.recordRequest));
    expect(test.clock.calls).toBe(5);
    expect(test.query).not.toHaveBeenCalled();

    const fakeSignal = frozen({ aborted: false });
    const fakeRequest = frozen({
      ...test.recordRequest,
      signal: fakeSignal,
    }) as unknown as RecordProviderPositionChainAnchorEvidenceRequestV1;
    await expectSanitized(test.recorder.recordEvidence(fakeRequest));
    expect(test.query).not.toHaveBeenCalled();
  });

  it('authenticates a foreign opaque capability before inspecting it', async () => {
    const test = await fixture();
    let inspected = 0;
    const hostile = new Proxy(frozen({ opaque: true }), {
      get: () => {
        inspected += 1;
        throw new Error('secret capability field');
      },
      ownKeys: () => {
        inspected += 1;
        throw new Error('secret capability keys');
      },
    });
    const request = frozen({ ...test.recordRequest, producerCapability: hostile });

    await expectSanitized(test.recorder.recordEvidence(request));
    expect(inspected).toBe(0);
    expect(test.query).not.toHaveBeenCalled();
  });

  it('rejects abort while the exact cancellable SQL operation settles', async () => {
    const controller = new AbortController();
    const test = await fixture(ETHEREUM, { signal: controller.signal });
    test.query.mockImplementation(async () => {
      controller.abort();
      return { rows: [row()] };
    });

    await expectSanitized(test.recorder.recordEvidence(test.recordRequest));
    expect(test.query).toHaveBeenCalledTimes(1);
    expect(test.query.mock.calls[0]?.[2]).toBe(controller.signal);
    expect(test.clock.calls).toBe(6);
  });

  it('re-reviews the exact producer capability after SQL and rejects newly stale authority', async () => {
    const test = await fixture(ETHEREUM, {
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

    await expectSanitized(test.recorder.recordEvidence(test.recordRequest));
    expect(test.query).toHaveBeenCalledTimes(1);
    expect(test.clock.calls).toBe(7);
  });

  it.each([
    ['no rows', []],
    ['multiple rows', [row(), row()]],
    ['an extra column', [{ ...row(), unexpected_authority: true }]],
    ['an unsupported outcome', [{ ...row(), record_outcome: 'PARTIALLY_RECORDED' }]],
    [
      'an uppercase fingerprint',
      [{ ...row(), recorded_evidence_fingerprint_sha256: 'A'.repeat(64) }],
    ],
    ['a zero fingerprint', [{ ...row(), recorded_evidence_fingerprint_sha256: '0'.repeat(64) }]],
    ['a noncanonical timestamp', [{ ...row(), evidence_recorded_at: '2026-09-05T17:00:03Z' }]],
    ['a timestamp before assessment', [row('RECORDED', '2026-09-05T17:00:01.999Z')]],
    ['a timestamp at the producer deadline', [row('RECORDED', DEADLINE_AT)]],
  ])('fails closed on %s returned by SQL', async (_name, rows) => {
    const test = await fixture();
    test.query.mockResolvedValue({ rows });

    await expectSanitized(test.recorder.recordEvidence(test.recordRequest));
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('rejects accessor and custom-prototype result rows without reading hostile data', async () => {
    const accessorTest = await fixture();
    const getter = jest.fn(() => 'RECORDED');
    const accessorRow = row();
    Object.defineProperty(accessorRow, 'record_outcome', { enumerable: true, get: getter });
    accessorTest.query.mockResolvedValue({ rows: [accessorRow] });
    await expectSanitized(accessorTest.recorder.recordEvidence(accessorTest.recordRequest));
    expect(getter).not.toHaveBeenCalled();

    const prototypeTest = await fixture();
    prototypeTest.query.mockResolvedValue({
      rows: [Object.assign(Object.create({ poisoned: true }) as object, row())],
    });
    await expectSanitized(prototypeTest.recorder.recordEvidence(prototypeTest.recordRequest));
  });

  it.each([
    [ETHEREUM, '2026-09-05T16:59:06.000Z', '2026-09-05T16:59:50.000Z', '2026-09-05T17:00:06.000Z'],
    [ETHEREUM, '2026-09-05T16:59:59.000Z', '2026-09-05T16:30:06.000Z', '2026-09-05T17:00:06.000Z'],
    [SOLANA, '2026-09-05T16:59:48.000Z', '2026-09-05T16:59:50.000Z', '2026-09-05T17:00:03.000Z'],
    [SOLANA, '2026-09-05T16:59:59.000Z', '2026-09-05T16:58:33.000Z', '2026-09-05T17:00:03.000Z'],
  ] as const)(
    'rejects %s record time at the strict current/finality freshness boundary',
    async (networkId, currentHeadAdvancedAt, finalizedHeadAdvancedAt, recordedAt) => {
      const test = await fixture(networkId, {
        currentHeadAdvancedAt,
        finalizedHeadAdvancedAt,
        recordedAt,
      });

      await expectSanitized(test.recorder.recordEvidence(test.recordRequest));
      expect(test.query).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a database timestamp at the approved-pair expiry boundary', async () => {
    const expiresAt = '2026-09-05T17:00:08.000Z';
    const test = await fixture(ETHEREUM, {
      approvalExpiresAt: expiresAt,
      recordedAt: expiresAt,
    });

    await expectSanitized(test.recorder.recordEvidence(test.recordRequest));
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('maps synchronous, asynchronous, and non-Promise database failures to one fixed error', async () => {
    for (const behavior of ['throw', 'reject', 'thenable'] as const) {
      const test = await fixture();
      const secret = Object.assign(new Error('secret database address and SQL details'), {
        cause: new Error('secret cause'),
      });
      const then = jest.fn();
      if (behavior === 'throw')
        test.query.mockImplementation(() => {
          throw secret;
        });
      if (behavior === 'reject') test.query.mockRejectedValue(secret);
      if (behavior === 'thenable') test.query.mockReturnValue(frozen({ then }));

      await expectSanitized(test.recorder.recordEvidence(test.recordRequest));
      expect(test.query).toHaveBeenCalledTimes(1);
      expect(then).not.toHaveBeenCalled();
    }
  });

  it('pins migration fingerprint binding without requiring a second function grant', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '../../infrastructure/database/migrations/0029-create-provider-position-chain-anchor-evidence.migration.ts',
      ),
      'utf8',
    );
    expect(migration).toContain(
      "RETURN QUERY SELECT 'RECORDED'::text, requested_fingerprint, database_recorded_at;",
    );
    expect(migration).toContain(
      "RETURN QUERY SELECT 'IDEMPOTENT_REPLAY'::text,\n          prior.evidence_fingerprint_sha256, prior.recorded_at;",
    );
    expect(migration).toContain(
      'prior.evidence_fingerprint_sha256 IS DISTINCT FROM requested_fingerprint',
    );
    expect(RECORD_SQL).not.toContain('provider_position_chain_anchor_evidence_fingerprint(');
  });

  it('remains dormant, unregistered, authority-free, and explicit about the late-write blocker', () => {
    const source = readFileSync(
      join(__dirname, 'postgres-provider-position-chain-anchor-evidence.recorder.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/@Injectable|@Module|providers\s*:/u);
    expect(source).not.toMatch(/process\.env|fetch\(|https?:|from ['"]viem|@solana\/web3/u);
    expect(source).not.toContain('withTransaction');
    expect(source).not.toMatch(/\.query\s*\(/u);
    expect(source).not.toMatch(/\bretry\b/iu);
    expect(source).toContain('cannot roll back a write');
    expect(source).toContain(
      'future database-contract change before this dormant adapter may be activated',
    );
  });
});
