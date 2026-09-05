import {
  BalanceSyncIndexerFailure,
  createBalanceSyncObservationId,
  createDeterministicBalanceSyncJobEnvelope,
  type BalanceSyncFailureCode,
  type BalanceSyncJobEnvelope,
  type BalanceSyncJobPayload,
  type BalanceSyncObservation,
  type BalanceSyncPosition,
  type BalanceSyncSourcePoint,
} from '../domain/balance-sync';
import {
  BalanceSyncOrchestrator,
  BalanceSyncOrchestratorError,
  type BalanceSyncProcessingResult,
} from './balance-sync-orchestrator';
import {
  FailClosedBalanceSyncJobPort,
  balanceSyncReceiptRetryMinimumDelaySeconds,
} from './fail-closed-balance-sync-job.port';
import type {
  BalanceIndexerCandidate,
  BalanceIndexerReadRequest,
  BalanceIndexerRescanRequest,
  BalanceIndexerRescanResult,
  BalanceSyncAlert,
  BalanceSyncCheckpoint,
  BalanceSyncCheckpointPort,
  BalanceSyncClockPort,
  BalanceSyncIndexerPort,
  BalanceSyncJobPort,
  BalanceSyncMetricEvent,
  BalanceSyncScope,
  BalanceSyncSuccessMode,
} from './ports/balance-sync.ports';

const NOW = '2026-08-24T12:00:30.000Z';
const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WALLET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CORRELATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NETWORK_ID = 'eip155:1' as const;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const POSITION_ID = 'a'.repeat(64);

const BLOCK_98 = hash('98');
const BLOCK_99 = hash('99');
const BLOCK_100_A = hash('a0');
const BLOCK_100_B = hash('b0');
const BLOCK_101_A = hash('a1');
const BLOCK_101_B = hash('b1');

function hash(byte: string): string {
  return `0x${byte.repeat(32)}`;
}

function scope(): BalanceSyncScope {
  return Object.freeze({ accountId: ACCOUNT_ID, walletId: WALLET_ID, networkId: NETWORK_ID });
}

function position(amountAtomic = '12000000'): BalanceSyncPosition {
  return Object.freeze({
    positionId: POSITION_ID,
    stablecoin: 'USDC',
    assetIdentity: USDC,
    amountAtomic,
  });
}

function source(
  blockPosition: string,
  blockHash: string,
  parentHash: string,
  retrievedAt = '2026-08-24T12:00:25.000Z',
): BalanceIndexerCandidate['source'] {
  return Object.freeze({
    position: blockPosition,
    hash: blockHash,
    parentHash,
    selector: 'latest',
    retrievedAt,
    identityValidated: true,
  });
}

function finalizedSource(): BalanceSyncSourcePoint {
  return Object.freeze({
    position: '99',
    hash: BLOCK_99,
    parentHash: BLOCK_98,
    selector: 'finalized',
    retrievedAt: '2026-08-24T12:00:00.000Z',
  });
}

function candidate(overrides: Partial<BalanceIndexerCandidate> = {}): BalanceIndexerCandidate {
  return Object.freeze({
    walletId: WALLET_ID,
    networkId: NETWORK_ID,
    tier: 'PROVISIONAL',
    source: source('100', BLOCK_100_A, BLOCK_99),
    positions: Object.freeze([position()]),
    ...overrides,
  });
}

function observation(
  value = candidate(),
  headAdvancedAt = '2026-08-24T12:00:20.000Z',
): BalanceSyncObservation {
  const persistedSource = Object.freeze({
    position: value.source.position,
    hash: value.source.hash,
    parentHash: value.source.parentHash,
    selector: value.source.selector,
    retrievedAt: value.source.retrievedAt,
  });
  const input = {
    ...scope(),
    tier: value.tier,
    source: persistedSource,
    positions: value.positions,
  };
  return Object.freeze({
    observationId: createBalanceSyncObservationId(input),
    ...input,
    headAdvancedAt,
  });
}

function checkpoint(
  currentObservation: BalanceSyncObservation | null = observation(),
): BalanceSyncCheckpoint {
  return Object.freeze({
    revision: 7,
    scope: scope(),
    currentObservation,
    lastFinalizedSource: finalizedSource(),
    freshness: 'CURRENT',
    staleSince: null,
    lastFailureCode: null,
  });
}

function payload(overrides: Partial<BalanceSyncJobPayload> = {}): BalanceSyncJobPayload {
  return Object.freeze({
    schemaVersion: 1,
    accountId: ACCOUNT_ID,
    walletId: WALLET_ID,
    networkId: NETWORK_ID,
    requiredTier: 'PROVISIONAL',
    cause: 'SCHEDULED',
    attempt: 1,
    rescanFromPosition: null,
    ...overrides,
  });
}

function job(
  overrides: Partial<BalanceSyncJobPayload> = {},
  id = 'balance-sync-job-1',
): BalanceSyncJobEnvelope {
  return createDeterministicBalanceSyncJobEnvelope(payload(overrides), {
    id,
    occurredAt: '2026-08-24T12:00:00.000Z',
    correlation: { correlationId: CORRELATION_ID },
  });
}

function recoveryCandidate(
  overrides: Partial<BalanceIndexerRescanResult> = {},
): BalanceIndexerRescanResult {
  return Object.freeze({
    ...candidate({
      source: source('101', BLOCK_101_B, BLOCK_100_B),
      positions: Object.freeze([position('13000000')]),
    }),
    replay: Object.freeze({
      fromPosition: '99',
      throughPosition: '101',
      readUnits: 3,
      complete: true,
    }),
    ...overrides,
  });
}

class MemoryCheckpointPort implements BalanceSyncCheckpointPort {
  state: BalanceSyncCheckpoint | null;
  readonly upserts: Array<
    Readonly<{ mode: BalanceSyncSuccessMode; observationId: string; succeededAt: string }>
  > = [];
  readonly replacements: Array<
    Readonly<{
      removedObservationId: string | null;
      replacementObservationId: string;
      recoveredAt: string;
    }>
  > = [];
  readonly staleWrites: Array<Readonly<{ failureCode: BalanceSyncFailureCode; failedAt: string }>> =
    [];

  constructor(initial: BalanceSyncCheckpoint | null) {
    this.state = initial;
  }

  async load(requestedScope: BalanceSyncScope): Promise<BalanceSyncCheckpoint | null> {
    if (this.state && !sameScope(this.state.scope, requestedScope))
      throw new Error('scope mismatch');
    return this.state;
  }

  async upsertCurrent(
    input: Parameters<BalanceSyncCheckpointPort['upsertCurrent']>[0],
  ): Promise<void> {
    this.assertRevision(input.expectedRevision);
    if (
      input.mode === 'UNCHANGED' &&
      this.state?.currentObservation?.observationId !== input.observation.observationId
    ) {
      throw new Error('unchanged observation mismatch');
    }
    this.upserts.push({
      mode: input.mode,
      observationId: input.observation.observationId,
      succeededAt: input.succeededAt,
    });
    this.state = Object.freeze({
      revision: (this.state?.revision ?? -1) + 1,
      scope: input.scope,
      currentObservation: input.observation,
      lastFinalizedSource: this.state?.lastFinalizedSource ?? null,
      freshness: 'CURRENT',
      staleSince: null,
      lastFailureCode: null,
    });
  }

  async replaceProvisionalAfterReorg(
    input: Parameters<BalanceSyncCheckpointPort['replaceProvisionalAfterReorg']>[0],
  ): Promise<void> {
    this.assertRevision(input.expectedRevision);
    if (this.state?.lastFinalizedSource?.hash !== input.lastFinalizedSource.hash) {
      throw new Error('finalized anchor mismatch');
    }
    this.replacements.push({
      removedObservationId: this.state.currentObservation?.observationId ?? null,
      replacementObservationId: input.replacement.observationId,
      recoveredAt: input.recoveredAt,
    });
    this.state = Object.freeze({
      revision: this.state.revision + 1,
      scope: input.scope,
      currentObservation: input.replacement,
      lastFinalizedSource: input.lastFinalizedSource,
      freshness: 'CURRENT',
      staleSince: null,
      lastFailureCode: null,
    });
  }

  async preserveLastGoodAndMarkStale(
    input: Parameters<BalanceSyncCheckpointPort['preserveLastGoodAndMarkStale']>[0],
  ): Promise<void> {
    this.assertRevision(input.expectedRevision);
    this.staleWrites.push({ failureCode: input.failureCode, failedAt: input.failedAt });
    this.state = Object.freeze({
      revision: (this.state?.revision ?? -1) + 1,
      scope: input.scope,
      currentObservation: this.state?.currentObservation ?? null,
      lastFinalizedSource: this.state?.lastFinalizedSource ?? null,
      freshness: this.state?.currentObservation ? 'STALE' : 'UNAVAILABLE',
      staleSince: input.failedAt,
      lastFailureCode: input.failureCode,
    });
  }

  private assertRevision(expectedRevision: number | null): void {
    if (expectedRevision !== (this.state?.revision ?? null)) throw new Error('revision conflict');
  }
}

class MemoryJobPort implements BalanceSyncJobPort {
  readonly retries: Array<Parameters<BalanceSyncJobPort['scheduleRetry']>[0]> = [];
  readonly deadLetters: Array<Parameters<BalanceSyncJobPort['deadLetter']>[0]> = [];

  async scheduleRetry(input: Parameters<BalanceSyncJobPort['scheduleRetry']>[0]): Promise<void> {
    this.retries.push(input);
  }

  async deadLetter(input: Parameters<BalanceSyncJobPort['deadLetter']>[0]): Promise<void> {
    this.deadLetters.push(input);
  }
}

class MemoryMetricsPort {
  readonly events: BalanceSyncMetricEvent[] = [];
  readonly alerts: BalanceSyncAlert[] = [];

  record(event: BalanceSyncMetricEvent): void {
    this.events.push(event);
  }

  alert(alert: BalanceSyncAlert): void {
    this.alerts.push(alert);
  }
}

function sequencedClock(...values: readonly (string | number)[]): BalanceSyncClockPort {
  let index = 0;
  return {
    now: () => {
      const value = values[Math.min(index, values.length - 1)];
      index += 1;
      return typeof value === 'string' ? new Date(value) : new Date(value ?? Number.NaN);
    },
  };
}

function harness(
  options: {
    initial?: BalanceSyncCheckpoint | null;
    read?: (request: BalanceIndexerReadRequest) => Promise<unknown>;
    rescan?: (request: BalanceIndexerRescanRequest) => Promise<unknown>;
    clock?: BalanceSyncClockPort;
  } = {},
): Readonly<{
  orchestrator: BalanceSyncOrchestrator;
  checkpoints: MemoryCheckpointPort;
  jobs: MemoryJobPort;
  metrics: MemoryMetricsPort;
  indexer: BalanceSyncIndexerPort;
}> {
  const checkpoints = new MemoryCheckpointPort(
    Object.prototype.hasOwnProperty.call(options, 'initial')
      ? (options.initial ?? null)
      : checkpoint(),
  );
  const jobs = new MemoryJobPort();
  const metrics = new MemoryMetricsPort();
  const indexer: BalanceSyncIndexerPort = {
    readCurrent: options.read ?? (async () => candidate()),
    rescanFromCheckpoint: options.rescan ?? (async () => recoveryCandidate()),
  };
  const clock = options.clock ?? { now: () => new Date(NOW) };
  return {
    orchestrator: new BalanceSyncOrchestrator(jobs, checkpoints, indexer, clock, metrics),
    checkpoints,
    jobs,
    metrics,
    indexer,
  };
}

describe('BalanceSyncOrchestrator', () => {
  it('creates one current observation and makes a repeated job idempotent', async () => {
    const test = harness({ initial: null });

    const first = await test.orchestrator.process(job());
    const repeated = await test.orchestrator.process(job());

    expect(first).toMatchObject({ status: 'COMPLETED', outcome: 'CREATED' });
    assertCompleted(first);
    assertCompleted(repeated);
    expect(repeated).toEqual({
      status: 'COMPLETED',
      outcome: 'UNCHANGED',
      jobId: 'balance-sync-job-1',
      observationId: first.observationId,
    });
    expect(test.checkpoints.upserts).toEqual([
      { mode: 'CREATED', observationId: first.observationId, succeededAt: NOW },
      { mode: 'UNCHANGED', observationId: first.observationId, succeededAt: NOW },
    ]);
    expect(test.checkpoints.state?.currentObservation?.observationId).toBe(first.observationId);
    expect(test.jobs.retries).toHaveLength(0);
    expect(test.jobs.deadLetters).toHaveLength(0);
  });

  it('accepts a source retrieved after processing began and stamps success at read completion', async () => {
    const readCompletedAt = '2026-08-24T12:00:32.000Z';
    const test = harness({
      initial: null,
      read: async () =>
        candidate({
          source: source('100', BLOCK_100_A, BLOCK_99, '2026-08-24T12:00:31.000Z'),
        }),
      clock: sequencedClock(NOW, '2026-08-24T12:00:30.500Z', readCompletedAt),
    });

    await expect(test.orchestrator.process(job())).resolves.toMatchObject({
      status: 'COMPLETED',
      outcome: 'CREATED',
    });
    expect(test.checkpoints.upserts).toHaveLength(1);
    expect(test.checkpoints.upserts[0]?.succeededAt).toBe(readCompletedAt);
  });

  it.each([
    ['regressing', '2026-08-24T12:00:29.999Z'],
    ['invalid', Number.NaN],
  ])('fails closed when the post-read clock is %s', async (_name, postReadTime) => {
    const test = harness({
      clock: sequencedClock(NOW, '2026-08-24T12:00:30.500Z', postReadTime),
    });

    await expect(test.orchestrator.process(job())).rejects.toEqual(
      new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_CLOCK'),
    );
    expect(test.checkpoints.upserts).toHaveLength(0);
    expect(test.checkpoints.replacements).toHaveLength(0);
    expect(test.checkpoints.staleWrites).toHaveLength(0);
    expect(test.jobs.retries).toHaveLength(0);
    expect(test.jobs.deadLetters).toHaveLength(0);
  });

  it('rejects a candidate timestamp later than the advancing post-read clock', async () => {
    const test = harness({
      read: async () =>
        candidate({
          source: source('100', BLOCK_100_A, BLOCK_99, '2026-08-24T12:00:33.000Z'),
        }),
      clock: sequencedClock(
        NOW,
        '2026-08-24T12:00:30.500Z',
        '2026-08-24T12:00:32.000Z',
        '2026-08-24T12:00:34.000Z',
      ),
    });

    await expect(test.orchestrator.process(job())).resolves.toMatchObject({
      status: 'DEAD_LETTERED',
      failureCode: 'PROVIDER_INVALID_DATA',
    });
    expect(test.checkpoints.upserts).toHaveLength(0);
  });

  it('updates the current observation when the validated chain head appends', async () => {
    const next = candidate({
      source: source('101', BLOCK_101_A, BLOCK_100_A, '2026-08-24T12:00:28.000Z'),
      positions: Object.freeze([position('12500000')]),
    });
    const test = harness({ read: async () => next });
    const previousId = test.checkpoints.state?.currentObservation?.observationId;

    const result = await test.orchestrator.process(job());

    expect(result).toMatchObject({ status: 'COMPLETED', outcome: 'UPDATED' });
    assertCompleted(result);
    expect(result.observationId).not.toBe(previousId);
    expect(test.checkpoints.state).toMatchObject({ freshness: 'CURRENT', staleSince: null });
    expect(test.checkpoints.state?.currentObservation?.positions).toEqual([position('12500000')]);
  });

  it('rejects a changed balance at identical source lineage instead of rewriting history', async () => {
    const original = checkpoint();
    const test = harness({
      initial: original,
      read: async () => candidate({ positions: Object.freeze([position('0')]) }),
    });

    const result = await test.orchestrator.process(job());

    expect(result).toMatchObject({
      status: 'DEAD_LETTERED',
      failureCode: 'PROVIDER_INVALID_DATA',
      reason: 'NON_RETRYABLE_FAILURE',
    });
    expect(test.checkpoints.state?.currentObservation).toBe(original.currentObservation);
    expect(test.checkpoints.state).toMatchObject({
      freshness: 'STALE',
      lastFailureCode: 'PROVIDER_INVALID_DATA',
    });
  });

  it('rescans from the finalized checkpoint and replaces the affected provisional observation', async () => {
    const original = checkpoint();
    const read = jest.fn(async () => candidate({ source: source('100', BLOCK_100_B, BLOCK_99) }));
    const rescan = jest.fn(async () => recoveryCandidate());
    const test = harness({ initial: original, read, rescan });

    const result = await test.orchestrator.process(job());

    expect(result).toMatchObject({ status: 'COMPLETED', outcome: 'REORG_RECOVERED' });
    assertCompleted(result);
    expect(rescan).toHaveBeenCalledWith({
      ...scope(),
      tier: 'PROVISIONAL',
      selector: 'latest',
      fromFinalizedSource: finalizedSource(),
      maximumReadUnits: 2_048,
    });
    expect(test.checkpoints.replacements).toEqual([
      {
        removedObservationId: original.currentObservation?.observationId,
        replacementObservationId: result.observationId,
        recoveredAt: NOW,
      },
    ]);
    expect(test.checkpoints.state?.currentObservation).toMatchObject({
      observationId: result.observationId,
      source: { position: '101', hash: BLOCK_101_B },
      positions: [position('13000000')],
    });
    expect(test.checkpoints.state?.lastFinalizedSource).toEqual(finalizedSource());
    expect(test.metrics.alerts).toContainEqual({
      code: 'REORG_DETECTED',
      networkId: NETWORK_ID,
      tier: 'PROVISIONAL',
      attempt: 1,
    });
  });

  it('stamps reorg recovery at rescan completion with an advancing clock', async () => {
    const readCompletedAt = '2026-08-24T12:00:32.000Z';
    const rescanCompletedAt = '2026-08-24T12:00:34.000Z';
    const test = harness({
      read: async () =>
        candidate({
          source: source('100', BLOCK_100_B, BLOCK_99, '2026-08-24T12:00:31.000Z'),
        }),
      rescan: async () =>
        recoveryCandidate({
          source: source('101', BLOCK_101_B, BLOCK_100_B, '2026-08-24T12:00:33.000Z'),
        }),
      clock: sequencedClock(NOW, '2026-08-24T12:00:30.500Z', readCompletedAt, rescanCompletedAt),
    });

    await expect(test.orchestrator.process(job())).resolves.toMatchObject({
      status: 'COMPLETED',
      outcome: 'REORG_RECOVERED',
    });
    expect(test.checkpoints.replacements).toHaveLength(1);
    expect(test.checkpoints.replacements[0]?.recoveredAt).toBe(rescanCompletedAt);
  });

  it.each([
    ['regressing', '2026-08-24T12:00:31.999Z'],
    ['invalid', Number.NaN],
  ])('fails closed when the post-rescan clock is %s', async (_name, postRescanTime) => {
    const test = harness({
      read: async () =>
        candidate({
          source: source('100', BLOCK_100_B, BLOCK_99, '2026-08-24T12:00:31.000Z'),
        }),
      clock: sequencedClock(
        NOW,
        '2026-08-24T12:00:30.500Z',
        '2026-08-24T12:00:32.000Z',
        postRescanTime,
      ),
    });

    await expect(test.orchestrator.process(job())).rejects.toEqual(
      new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_CLOCK'),
    );
    expect(test.checkpoints.upserts).toHaveLength(0);
    expect(test.checkpoints.replacements).toHaveLength(0);
    expect(test.checkpoints.staleWrites).toHaveLength(0);
    expect(test.jobs.retries).toHaveLength(0);
    expect(test.jobs.deadLetters).toHaveLength(0);
  });

  it.each([
    {
      name: 'incomplete replay',
      value: recoveryCandidate({ replay: { ...recoveryCandidate().replay, complete: false } }),
    },
    {
      name: 'read-unit overflow',
      value: recoveryCandidate({ replay: { ...recoveryCandidate().replay, readUnits: 2_049 } }),
    },
    {
      name: 'wrong finalized anchor',
      value: recoveryCandidate({ replay: { ...recoveryCandidate().replay, fromPosition: '98' } }),
    },
    {
      name: 'malformed recovery result',
      value: { unexpected: true },
    },
    {
      name: 'accessor-backed replay proof',
      value: (() => {
        const replay = { ...recoveryCandidate().replay } as Record<string, unknown>;
        Object.defineProperty(replay, 'complete', {
          enumerable: true,
          get: () => true,
        });
        return { ...recoveryCandidate(), replay };
      })(),
    },
  ])('retains last good data and retries a $name', async ({ value }) => {
    const original = checkpoint();
    const test = harness({
      initial: original,
      read: async () => candidate({ source: source('100', BLOCK_100_B, BLOCK_99) }),
      rescan: async () => value,
    });

    const result = await test.orchestrator.process(job());

    expect(result).toMatchObject({
      status: 'RETRY_SCHEDULED',
      failureCode: 'REORG_RECOVERY_FAILED',
      delaySeconds: 5,
    });
    expect(test.checkpoints.state?.currentObservation).toBe(original.currentObservation);
    expect(test.checkpoints.state?.freshness).toBe('STALE');
    expect(test.checkpoints.replacements).toHaveLength(0);
  });

  it('supports an explicit deterministic manual recovery only from the persisted anchor', async () => {
    const test = harness();
    const recoveryJob = job(
      { cause: 'MANUAL_RECOVERY', rescanFromPosition: '99' },
      'manual-recovery-job-1',
    );

    const result = await test.orchestrator.process(recoveryJob);

    expect(result).toMatchObject({ status: 'COMPLETED', outcome: 'REORG_RECOVERED' });
    expect(test.checkpoints.replacements).toHaveLength(1);
  });

  it('keeps the finalized anchor when a manual recovery is retried', async () => {
    let scans = 0;
    const test = harness({
      rescan: async () => {
        scans += 1;
        if (scans === 1) throw new Error('transient provider detail');
        return recoveryCandidate();
      },
    });

    const first = await test.orchestrator.process(
      job({ cause: 'MANUAL_RECOVERY', rescanFromPosition: '99' }, 'manual-recovery-job-2'),
    );
    assertRetryScheduled(first);
    const retry = test.jobs.retries[0]?.envelope;
    expect(retry?.payload).toMatchObject({
      cause: 'RETRY',
      attempt: 2,
      rescanFromPosition: '99',
    });

    const recovered = await test.orchestrator.process(retry);

    expect(recovered).toMatchObject({ status: 'COMPLETED', outcome: 'REORG_RECOVERED' });
    expect(scans).toBe(2);
    expect(test.checkpoints.replacements).toHaveLength(1);
  });

  it('marks a non-advancing observation stale using the network freshness threshold', async () => {
    const oldHead = observation(candidate(), '2026-08-24T11:58:00.000Z');
    const original = checkpoint(oldHead);
    const test = harness({ initial: original });

    const result = await test.orchestrator.process(job());

    expect(result).toMatchObject({
      status: 'RETRY_SCHEDULED',
      failureCode: 'PROVIDER_UNAVAILABLE',
    });
    expect(test.checkpoints.state?.currentObservation).toBe(original.currentObservation);
    expect(test.checkpoints.state?.freshness).toBe('STALE');
  });

  it('uses the Solana confirmed display threshold with deterministic local observations', async () => {
    const solanaNetwork = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
    const solana = candidate({
      networkId: solanaNetwork,
      source: {
        position: '250000000',
        hash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
        parentHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
        selector: 'confirmed',
        retrievedAt: '2026-08-24T12:00:25.000Z',
        identityValidated: true,
      },
      positions: [
        {
          positionId: POSITION_ID,
          stablecoin: 'USDC',
          assetIdentity: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amountAtomic: '12000000',
        },
      ],
    });
    const test = harness({ initial: null, read: async () => solana });

    const result = await test.orchestrator.process(job({ networkId: solanaNetwork }));

    expect(result).toMatchObject({ status: 'COMPLETED', outcome: 'CREATED' });
    expect(test.checkpoints.state?.currentObservation).toMatchObject({
      networkId: solanaNetwork,
      source: { selector: 'confirmed' },
    });
  });

  it('preserves the exact last good balance, marks stale, alerts, and schedules bounded retry', async () => {
    const original = checkpoint();
    const test = harness({
      initial: original,
      read: async () => {
        throw new BalanceSyncIndexerFailure('PROVIDER_TIMEOUT');
      },
    });

    const result = await test.orchestrator.process(job());

    expect(result).toMatchObject({
      status: 'RETRY_SCHEDULED',
      failureCode: 'PROVIDER_TIMEOUT',
      delaySeconds: 5,
    });
    assertRetryScheduled(result);
    expect(test.checkpoints.state?.currentObservation).toBe(original.currentObservation);
    expect(test.checkpoints.state?.currentObservation?.positions[0]?.amountAtomic).toBe('12000000');
    expect(test.checkpoints.state).toMatchObject({
      freshness: 'STALE',
      staleSince: NOW,
      lastFailureCode: 'PROVIDER_TIMEOUT',
    });
    expect(test.jobs.retries[0]?.envelope).toMatchObject({
      id: result.retryJobId,
      kind: 'blockchain.balance-sync',
      occurredAt: NOW,
      correlation: { correlationId: CORRELATION_ID },
      payload: { cause: 'RETRY', attempt: 2 },
    });
    expect(test.metrics.alerts.map(({ code }) => code)).toEqual(['PROVIDER_FAILURE', 'DATA_STALE']);
  });

  it('stamps stale state and its retry envelope at provider-failure completion', async () => {
    const failedAt = '2026-08-24T12:00:35.000Z';
    const test = harness({
      read: async () => {
        throw new BalanceSyncIndexerFailure('PROVIDER_TIMEOUT');
      },
      clock: sequencedClock(NOW, '2026-08-24T12:00:30.500Z', failedAt),
    });

    const result = await test.orchestrator.process(job());

    expect(result).toMatchObject({ status: 'RETRY_SCHEDULED' });
    expect(test.checkpoints.staleWrites).toEqual([{ failureCode: 'PROVIDER_TIMEOUT', failedAt }]);
    expect(test.jobs.retries[0]?.envelope.occurredAt).toBe(failedAt);
  });

  it('honors an in-bound rate-limit hint without allowing unbounded queue delay', async () => {
    const inBound = harness({
      read: async () => {
        throw new BalanceSyncIndexerFailure('RATE_LIMITED', { retryAfterSeconds: 30 });
      },
    });
    const excessive = harness({
      read: async () => {
        throw new BalanceSyncIndexerFailure('RATE_LIMITED', { retryAfterSeconds: 61 });
      },
    });

    await expect(inBound.orchestrator.process(job())).resolves.toMatchObject({
      status: 'RETRY_SCHEDULED',
      delaySeconds: 30,
    });
    await expect(excessive.orchestrator.process(job())).resolves.toMatchObject({
      status: 'DEAD_LETTERED',
      reason: 'RETRY_AFTER_EXCEEDS_BOUND',
    });
  });

  it('does not grant retry authority to counterfeit, proxied, or mutable-looking failures', async () => {
    const counterfeit = Object.freeze(
      Object.assign(Object.create(BalanceSyncIndexerFailure.prototype) as Record<string, unknown>, {
        name: 'BalanceSyncIndexerFailure',
        message: 'RATE_LIMITED',
        code: 'RATE_LIMITED',
        retryAfterSeconds: 60,
      }),
    );
    const authentic = new BalanceSyncIndexerFailure('RATE_LIMITED', { retryAfterSeconds: 60 });
    const traps: string[] = [];
    const proxy = new Proxy(authentic, {
      getPrototypeOf: () => {
        traps.push('getPrototypeOf');
        return BalanceSyncIndexerFailure.prototype;
      },
      getOwnPropertyDescriptor: () => {
        traps.push('getOwnPropertyDescriptor');
        return undefined;
      },
    });
    const revoked = Proxy.revocable(authentic, {});
    revoked.revoke();

    for (const rejected of [counterfeit, proxy, revoked.proxy]) {
      const test = harness({
        read: async () => {
          throw rejected;
        },
      });
      await expect(test.orchestrator.process(job())).resolves.toMatchObject({
        status: 'DEAD_LETTERED',
        failureCode: 'UNCLASSIFIED_FAILURE',
        reason: 'NON_RETRYABLE_FAILURE',
      });
      expect(test.jobs.retries).toHaveLength(0);
    }
    expect(traps).toEqual([]);
  });

  it('does not accept a collaborator-constructed orchestrator error as internal authority', async () => {
    const injected = new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_CLOCK');
    const test = harness({
      read: async () => {
        throw injected;
      },
    });

    await expect(test.orchestrator.process(job())).resolves.toMatchObject({
      status: 'DEAD_LETTERED',
      failureCode: 'UNCLASSIFIED_FAILURE',
      reason: 'NON_RETRYABLE_FAILURE',
    });
    expect(Object.isFrozen(injected)).toBe(true);
  });

  it('dead-letters a transient provider failure after the third bounded attempt', async () => {
    const test = harness({
      read: async () => {
        throw new BalanceSyncIndexerFailure('PROVIDER_UNAVAILABLE');
      },
    });

    const result = await test.orchestrator.process(
      job({ cause: 'RETRY', attempt: 3 }, 'balance-sync-job-attempt-3'),
    );

    expect(result).toMatchObject({
      status: 'DEAD_LETTERED',
      failureCode: 'PROVIDER_UNAVAILABLE',
      reason: 'ATTEMPTS_EXHAUSTED',
    });
    expect(test.jobs.retries).toHaveLength(0);
    expect(test.jobs.deadLetters).toHaveLength(1);
  });

  it('fails closed before indexer access when canonical live capability proof is absent', async () => {
    const read = jest.fn(async () => candidate());
    const checkpointLoadedAt = '2026-08-24T12:00:31.000Z';
    const test = harness({
      initial: null,
      read,
      clock: sequencedClock(NOW, checkpointLoadedAt),
    });

    const result = await test.orchestrator.process(job({ requiredTier: 'CANONICAL' }));

    expect(result).toMatchObject({
      status: 'DEAD_LETTERED',
      failureCode: 'PERMANENT_PROVIDER_FAILURE',
    });
    expect(read).not.toHaveBeenCalled();
    expect(test.checkpoints.state).toMatchObject({
      currentObservation: null,
      freshness: 'UNAVAILABLE',
    });
    expect(test.checkpoints.staleWrites).toEqual([
      { failureCode: 'PERMANENT_PROVIDER_FAILURE', failedAt: checkpointLoadedAt },
    ]);
  });

  it.each([
    {
      name: 'unvalidated chain identity',
      mutate: () => candidate({ source: { ...candidate().source, identityValidated: false } }),
    },
    {
      name: 'future retrieval timestamp',
      mutate: () =>
        candidate({
          source: source('100', BLOCK_100_A, BLOCK_99, '2026-08-24T12:00:31.000Z'),
        }),
    },
    {
      name: 'unsupported asset identity',
      mutate: () =>
        candidate({
          positions: [
            { ...position(), assetIdentity: '0x1111111111111111111111111111111111111111' },
          ],
        }),
    },
    {
      name: 'duplicate asset position',
      mutate: () =>
        candidate({ positions: [position(), { ...position(), positionId: 'b'.repeat(64) }] }),
    },
    {
      name: 'case-insensitive self-parent EVM hash',
      mutate: () =>
        candidate({
          source: source('100', BLOCK_100_A.toUpperCase().replace('0X', '0x'), BLOCK_100_A),
        }),
    },
    {
      name: 'accessor-backed source record',
      mutate: () => {
        const accessorSource = { ...candidate().source } as Record<string, unknown>;
        Object.defineProperty(accessorSource, 'hash', {
          enumerable: true,
          get: () => BLOCK_100_A,
        });
        return candidate({ source: accessorSource as never });
      },
    },
    {
      name: 'symbol-bearing position record',
      mutate: () =>
        candidate({ positions: [{ ...position(), [Symbol('hidden')]: 'must-not-pass' }] }),
    },
  ])('dead-letters $name as invalid provider data without zeroing', async ({ mutate }) => {
    const original = checkpoint();
    const test = harness({ initial: original, read: async () => mutate() });

    const result = await test.orchestrator.process(job());

    expect(result).toMatchObject({
      status: 'DEAD_LETTERED',
      failureCode: 'PROVIDER_INVALID_DATA',
    });
    expect(test.checkpoints.state?.currentObservation).toBe(original.currentObservation);
  });

  it('rejects malformed envelopes, future jobs, and invalid clocks without invoking adapters', async () => {
    const read = jest.fn(async () => candidate());
    const test = harness({ read });
    const invalidClock = harness({ clock: { now: () => new Date(Number.NaN) } });
    const future = createDeterministicBalanceSyncJobEnvelope(payload(), {
      id: 'future-job',
      occurredAt: '2026-08-24T12:00:31.000Z',
      correlation: { correlationId: CORRELATION_ID },
    });

    await expect(test.orchestrator.process({})).rejects.toEqual(
      new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_JOB'),
    );
    await expect(test.orchestrator.process(future)).rejects.toEqual(
      new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_JOB'),
    );
    await expect(invalidClock.orchestrator.process(job())).rejects.toEqual(
      new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_CLOCK'),
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects corrupt checkpoint state before reading the provider', async () => {
    const read = jest.fn(async () => candidate());
    const invalid = {
      ...checkpoint(),
      freshness: 'CURRENT' as const,
      staleSince: NOW,
      lastFailureCode: 'PROVIDER_TIMEOUT' as const,
    };
    const test = harness({ initial: invalid, read });

    await expect(test.orchestrator.process(job())).rejects.toEqual(
      new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_CHECKPOINT'),
    );
    expect(read).not.toHaveBeenCalled();

    const falseCurrentWithoutObservation = checkpoint(null);
    const missingObservationTest = harness({ initial: falseCurrentWithoutObservation, read });
    await expect(missingObservationTest.orchestrator.process(job())).rejects.toEqual(
      new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_CHECKPOINT'),
    );
    expect(read).not.toHaveBeenCalled();

    const accessorCheckpoint = { ...checkpoint() } as Record<string, unknown>;
    Object.defineProperty(accessorCheckpoint, 'currentObservation', {
      enumerable: true,
      get: () => checkpoint().currentObservation,
    });
    const accessorTest = harness({ initial: accessorCheckpoint as never, read });
    await expect(accessorTest.orchestrator.process(job())).rejects.toEqual(
      new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_CHECKPOINT'),
    );
    expect(read).not.toHaveBeenCalled();

    for (const lastFinalizedSource of [
      {
        ...finalizedSource(),
        hash: BLOCK_100_B,
      },
      {
        ...finalizedSource(),
        position: '100',
        hash: BLOCK_100_B,
        parentHash: BLOCK_99,
      },
    ]) {
      const divergentCheckpoint = {
        ...checkpoint(),
        lastFinalizedSource,
      };
      const divergentTest = harness({ initial: divergentCheckpoint, read });
      await expect(divergentTest.orchestrator.process(job())).rejects.toEqual(
        new BalanceSyncOrchestratorError('INVALID_BALANCE_SYNC_CHECKPOINT'),
      );
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('maps checkpoint and job-port failures to fixed local error codes', async () => {
    const checkpointFailure = harness();
    checkpointFailure.checkpoints.load = async () => {
      throw new Error('database detail must not escape');
    };
    const jobFailure = harness({
      read: async () => {
        throw new BalanceSyncIndexerFailure('PROVIDER_TIMEOUT');
      },
    });
    jobFailure.jobs.scheduleRetry = async () => {
      throw new Error('queue detail must not escape');
    };

    await expect(checkpointFailure.orchestrator.process(job())).rejects.toEqual(
      new BalanceSyncOrchestratorError('BALANCE_SYNC_CHECKPOINT_FAILED'),
    );
    await expect(jobFailure.orchestrator.process(job())).rejects.toEqual(
      new BalanceSyncOrchestratorError('BALANCE_SYNC_JOB_DISPOSITION_FAILED'),
    );
  });

  it('preserves only the trusted receipt retry minimum from the fail-closed port', async () => {
    const test = harness({
      read: async () => {
        throw new BalanceSyncIndexerFailure('RATE_LIMITED', { retryAfterSeconds: 30 });
      },
    });
    const receiptDisposition = new FailClosedBalanceSyncJobPort();
    test.jobs.scheduleRetry = (input) => receiptDisposition.scheduleRetry(input);

    let caught: unknown;
    try {
      await test.orchestrator.process(job());
    } catch (error) {
      caught = error;
    }

    expect(balanceSyncReceiptRetryMinimumDelaySeconds(caught)).toBe(30);
    expect(caught).toMatchObject({
      message: 'BALANCE_SYNC_JOB_DISPOSITION_NOT_APPROVED',
    });
  });

  it('sanitizes the fail-closed port unmarked dead-letter failure', async () => {
    const test = harness({
      read: async () => {
        throw new BalanceSyncIndexerFailure('PERMANENT_PROVIDER_FAILURE');
      },
    });
    const receiptDisposition = new FailClosedBalanceSyncJobPort();
    test.jobs.deadLetter = (input) => receiptDisposition.deadLetter(input);

    await expect(test.orchestrator.process(job())).rejects.toEqual(
      new BalanceSyncOrchestratorError('BALANCE_SYNC_JOB_DISPOSITION_FAILED'),
    );
  });

  it('keeps metrics observational and excludes sensitive dimensions', async () => {
    const test = harness({ initial: null });
    test.metrics.record = () => {
      throw new Error('metrics down');
    };
    test.metrics.alert = () => {
      throw new Error('alerts down');
    };

    await expect(test.orchestrator.process(job())).resolves.toMatchObject({
      status: 'COMPLETED',
      outcome: 'CREATED',
    });
    expect(JSON.stringify(test.metrics.events)).not.toContain(WALLET_ID);
    expect(JSON.stringify(test.metrics.events)).not.toContain(USDC);
  });
});

function sameScope(left: BalanceSyncScope, right: BalanceSyncScope): boolean {
  return (
    left.accountId === right.accountId &&
    left.walletId === right.walletId &&
    left.networkId === right.networkId
  );
}

function assertCompleted(
  result: BalanceSyncProcessingResult,
): asserts result is Extract<BalanceSyncProcessingResult, { status: 'COMPLETED' }> {
  if (result.status !== 'COMPLETED') throw new Error('expected completed sync');
}

function assertRetryScheduled(
  result: BalanceSyncProcessingResult,
): asserts result is Extract<BalanceSyncProcessingResult, { status: 'RETRY_SCHEDULED' }> {
  if (result.status !== 'RETRY_SCHEDULED') throw new Error('expected scheduled retry');
}
