import { isProxy } from 'node:util/types';

import type { StablecoinValuationSourceId } from '../domain/stablecoin-valuation-policy';
import {
  assertCanonicalVerifiedStablecoinPriceProjectionBatch,
  assertCanonicalStablecoinPriceIngestionPlan,
  createVerifiedStablecoinPriceProjectionBatch,
  normalizeVerifiedStablecoinPriceEvidence,
  type StablecoinPriceIngestionPlanV1,
  type VerifiedStablecoinPriceProjectionBatchV1,
} from './stablecoin-price-ingestion-plan';
import type {
  MainnetStablecoin,
  VerifiedStablecoinPriceEvidenceV1,
  VerifiedStablecoinPriceSourcePort,
} from './ports/verified-stablecoin-price-source.port';

const SOURCE_IDS = Object.freeze([
  'PYTH_CORE',
  'CHAINLINK_DATA_FEEDS',
] as const satisfies readonly StablecoinValuationSourceId[]);
const THROW_IF_ABORTED = AbortSignal.prototype.throwIfAborted;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const COMPLETED_INGESTION_BATCHES = new WeakSet<object>();

export const STABLECOIN_PRICE_INGESTION_EXECUTION_POLICY = Object.freeze({
  order: 'CANONICAL_PLAN_SEQUENTIAL' as const,
  maximumConcurrentReads: 1 as const,
  logicalReadsPerSuccessfulRun: 6 as const,
  projectionsPerSuccessfulRun: 12 as const,
  partialProjectionAllowed: false as const,
});

export interface VerifiedStablecoinPriceSourceMap {
  readonly PYTH_CORE: VerifiedStablecoinPriceSourcePort;
  readonly CHAINLINK_DATA_FEEDS: VerifiedStablecoinPriceSourcePort;
}

export type StablecoinPriceIngestionOrchestratorErrorCode =
  | 'INVALID_ORCHESTRATOR_CONFIGURATION'
  | 'INVALID_ABORT_SIGNAL'
  | 'VERIFIED_PRICE_SOURCE_UNAVAILABLE'
  | 'VERIFIED_PRICE_EVIDENCE_REJECTED'
  | 'NON_CANONICAL_PROJECTION_BATCH';

export class StablecoinPriceIngestionOrchestratorError extends Error {
  constructor(readonly code: StablecoinPriceIngestionOrchestratorErrorCode) {
    super('Stablecoin price ingestion is unavailable.');
    this.name = 'StablecoinPriceIngestionOrchestratorError';
  }
}

interface BoundVerifiedStablecoinPriceSource {
  readonly sourceId: StablecoinValuationSourceId;
  read(stablecoin: MainnetStablecoin, signal: AbortSignal): Promise<unknown>;
}

type SourceReadMethod = (stablecoin: MainnetStablecoin, signal: AbortSignal) => unknown;

/**
 * Dormant orchestration boundary. Construction requires a canonical in-process
 * plan and both exact source implementations; there are no ambient defaults.
 * Successful runs are sequential in canonical plan order, bounding upstream
 * concurrency to one and avoiding later reads after the first failure.
 */
export class DormantStablecoinPriceIngestionOrchestrator {
  private readonly plan: StablecoinPriceIngestionPlanV1;
  private readonly sources: Readonly<
    Record<StablecoinValuationSourceId, BoundVerifiedStablecoinPriceSource>
  >;

  constructor(plan: StablecoinPriceIngestionPlanV1, sourceMap: VerifiedStablecoinPriceSourceMap);
  constructor(planInput: unknown, sourceMapInput: unknown) {
    try {
      assertCanonicalStablecoinPriceIngestionPlan(planInput);
      this.plan = planInput;
      this.sources = normalizeSourceMap(sourceMapInput);
      Object.freeze(this);
    } catch {
      throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
    }
  }

  ingest(signal: AbortSignal): Promise<VerifiedStablecoinPriceProjectionBatchV1>;
  async ingest(signalInput: unknown): Promise<VerifiedStablecoinPriceProjectionBatchV1> {
    const signal = normalizeSignal(signalInput);
    throwIfCallerAborted(signal);
    const evidence: VerifiedStablecoinPriceEvidenceV1[] = [];

    for (const logicalRead of this.plan.logicalReads) {
      throwIfCallerAborted(signal);
      const source = this.sources[logicalRead.sourceId];
      let candidate: unknown;
      try {
        candidate = await readBeforeCallerAbort(source, logicalRead.stablecoin, signal);
      } catch {
        throwIfCallerAborted(signal);
        throw unavailable('VERIFIED_PRICE_SOURCE_UNAVAILABLE');
      }
      throwIfCallerAborted(signal);
      try {
        evidence.push(normalizeVerifiedStablecoinPriceEvidence(this.plan, logicalRead, candidate));
      } catch {
        throwIfCallerAborted(signal);
        throw unavailable('VERIFIED_PRICE_EVIDENCE_REJECTED');
      }
    }

    throwIfCallerAborted(signal);
    try {
      const batch = createVerifiedStablecoinPriceProjectionBatch(this.plan, evidence);
      COMPLETED_INGESTION_BATCHES.add(batch);
      return batch;
    } catch {
      throwIfCallerAborted(signal);
      throw unavailable('VERIFIED_PRICE_EVIDENCE_REJECTED');
    }
  }
}

/** Accepts only a complete in-process batch emitted by the Slice C orchestrator. */
export function assertCanonicalStablecoinPriceIngestionBatch(
  value: unknown,
): asserts value is VerifiedStablecoinPriceProjectionBatchV1 {
  try {
    assertCanonicalVerifiedStablecoinPriceProjectionBatch(value);
  } catch {
    throw unavailable('NON_CANONICAL_PROJECTION_BATCH');
  }
  if (!COMPLETED_INGESTION_BATCHES.has(value)) {
    throw unavailable('NON_CANONICAL_PROJECTION_BATCH');
  }
}

function normalizeSourceMap(
  value: unknown,
): Readonly<Record<StablecoinValuationSourceId, BoundVerifiedStablecoinPriceSource>> {
  try {
    if (value === null || typeof value !== 'object' || isProxy(value) || Array.isArray(value)) {
      throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== SOURCE_IDS.length ||
      keys.some((key) => typeof key !== 'string' || !isSourceId(key))
    ) {
      throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
    }
    const sources = Object.create(null) as Record<
      StablecoinValuationSourceId,
      BoundVerifiedStablecoinPriceSource
    >;
    for (const sourceId of SOURCE_IDS) {
      const descriptor = descriptors[sourceId];
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
      }
      sources[sourceId] = normalizeSource(descriptor.value, sourceId);
    }
    return Object.freeze(sources);
  } catch {
    throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
  }
}

function isSourceId(value: string): value is StablecoinValuationSourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

function normalizeSource(
  value: unknown,
  expectedSourceId: StablecoinValuationSourceId,
): BoundVerifiedStablecoinPriceSource {
  if (value === null || typeof value !== 'object' || isProxy(value)) {
    throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
  }
  const sourceId = ownDataProperty(value, 'sourceId');
  if (sourceId !== expectedSourceId) {
    throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
  }
  const method = inheritedDataMethod(value, 'read');
  return Object.freeze({
    sourceId: expectedSourceId,
    read: (stablecoin: MainnetStablecoin, signal: AbortSignal): Promise<unknown> =>
      Promise.resolve(Reflect.apply(method, value, [stablecoin, signal])),
  });
}

function ownDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !('value' in descriptor)) {
    throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
  }
  return descriptor.value;
}

function inheritedDataMethod(value: object, key: string): SourceReadMethod {
  let candidate: object | null = value;
  let depth = 0;
  while (candidate !== null && candidate !== Object.prototype && depth < 8) {
    if (isProxy(candidate)) throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
    if (descriptor !== undefined) {
      if (
        !('value' in descriptor) ||
        typeof descriptor.value !== 'function' ||
        isProxy(descriptor.value)
      ) {
        throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
      }
      return descriptor.value as SourceReadMethod;
    }
    candidate = Object.getPrototypeOf(candidate);
    depth += 1;
  }
  throw unavailable('INVALID_ORCHESTRATOR_CONFIGURATION');
}

function normalizeSignal(value: unknown): AbortSignal {
  if (
    typeof value !== 'object' ||
    value === null ||
    isProxy(value) ||
    !(value instanceof AbortSignal)
  ) {
    throw unavailable('INVALID_ABORT_SIGNAL');
  }
  return value;
}

function throwIfCallerAborted(signal: AbortSignal): void {
  Reflect.apply(THROW_IF_ABORTED, signal, []);
}

async function readBeforeCallerAbort(
  source: BoundVerifiedStablecoinPriceSource,
  stablecoin: MainnetStablecoin,
  signal: AbortSignal,
): Promise<unknown> {
  let abortListener: EventListener | undefined;
  const callerAbort = new Promise<never>((_resolve, reject) => {
    abortListener = () => {
      try {
        throwIfCallerAborted(signal);
      } catch (reason) {
        reject(reason);
      }
    };
    Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', abortListener, { once: true }]);
  });
  try {
    throwIfCallerAborted(signal);
    return await Promise.race([source.read(stablecoin, signal), callerAbort]);
  } finally {
    if (abortListener !== undefined) {
      Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', abortListener]);
    }
  }
}

function unavailable(
  code: StablecoinPriceIngestionOrchestratorErrorCode,
): StablecoinPriceIngestionOrchestratorError {
  return new StablecoinPriceIngestionOrchestratorError(code);
}
