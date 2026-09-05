import { isProxy } from 'node:util/types';

import type { VerifiedStablecoinPriceProjectionBatchV1 } from './stablecoin-price-ingestion-plan';
import { assertCanonicalStablecoinPriceIngestionBatch } from './stablecoin-price-ingestion.orchestrator';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_IDENTITY_KEYS = Object.freeze(['schemaVersion', 'correlationId'] as const);

export const STABLECOIN_PRICE_PERSISTENCE_ADMISSION_SCHEMA_VERSION = 1 as const;

export interface StablecoinPricePersistenceRunIdentityV1 {
  readonly schemaVersion: typeof STABLECOIN_PRICE_PERSISTENCE_ADMISSION_SCHEMA_VERSION;
  readonly correlationId: string;
}

/**
 * Pure, immutable hand-off contract for a future atomic writer. It retains the
 * canonical batch by identity so no projection or verified evidence field is
 * copied, narrowed, reordered, or dropped.
 */
export interface StablecoinPricePersistenceAdmissionV1 {
  readonly schemaVersion: typeof STABLECOIN_PRICE_PERSISTENCE_ADMISSION_SCHEMA_VERSION;
  readonly runIdentity: StablecoinPricePersistenceRunIdentityV1;
  readonly projectionBatch: VerifiedStablecoinPriceProjectionBatchV1;
  readonly projectionCount: 12;
  readonly atomicWriteRequired: true;
  readonly mayAuthorizeFinancialAction: false;
}

export type StablecoinPricePersistenceAdmissionErrorCode =
  'INVALID_PERSISTENCE_RUN_IDENTITY' | 'NON_CANONICAL_PROJECTION_BATCH';

export class StablecoinPricePersistenceAdmissionError extends Error {
  constructor(readonly code: StablecoinPricePersistenceAdmissionErrorCode) {
    super('Stablecoin price persistence admission is invalid.');
    this.name = 'StablecoinPricePersistenceAdmissionError';
  }
}

/**
 * Creates no write and performs no I/O. Only a projection batch created by the
 * verified in-process ingestion boundary can cross this admission boundary.
 */
export function createStablecoinPricePersistenceAdmission(
  runIdentityInput: unknown,
  projectionBatchInput: unknown,
): StablecoinPricePersistenceAdmissionV1 {
  const runIdentity = normalizeRunIdentity(runIdentityInput);
  try {
    assertCanonicalStablecoinPriceIngestionBatch(projectionBatchInput);
  } catch {
    return invalid('NON_CANONICAL_PROJECTION_BATCH');
  }

  return Object.freeze({
    schemaVersion: STABLECOIN_PRICE_PERSISTENCE_ADMISSION_SCHEMA_VERSION,
    runIdentity,
    projectionBatch: projectionBatchInput,
    projectionCount: 12 as const,
    atomicWriteRequired: true as const,
    mayAuthorizeFinancialAction: false as const,
  });
}

function normalizeRunIdentity(value: unknown): StablecoinPricePersistenceRunIdentityV1 {
  try {
    if (value === null || typeof value !== 'object' || isProxy(value) || Array.isArray(value)) {
      return invalid('INVALID_PERSISTENCE_RUN_IDENTITY');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid('INVALID_PERSISTENCE_RUN_IDENTITY');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== RUN_IDENTITY_KEYS.length ||
      keys.some(
        (key) => typeof key !== 'string' || !(RUN_IDENTITY_KEYS as readonly string[]).includes(key),
      )
    ) {
      return invalid('INVALID_PERSISTENCE_RUN_IDENTITY');
    }
    const schemaVersion = dataProperty(descriptors.schemaVersion);
    const correlationId = dataProperty(descriptors.correlationId);
    if (
      schemaVersion !== STABLECOIN_PRICE_PERSISTENCE_ADMISSION_SCHEMA_VERSION ||
      typeof correlationId !== 'string' ||
      !UUID_V4.test(correlationId)
    ) {
      return invalid('INVALID_PERSISTENCE_RUN_IDENTITY');
    }
    return Object.freeze({
      schemaVersion: STABLECOIN_PRICE_PERSISTENCE_ADMISSION_SCHEMA_VERSION,
      correlationId,
    });
  } catch (error) {
    if (error instanceof StablecoinPricePersistenceAdmissionError) throw error;
    return invalid('INVALID_PERSISTENCE_RUN_IDENTITY');
  }
}

function dataProperty(descriptor: PropertyDescriptor | undefined): unknown {
  if (!descriptor?.enumerable || !('value' in descriptor)) {
    return invalid('INVALID_PERSISTENCE_RUN_IDENTITY');
  }
  return descriptor.value;
}

function invalid(code: StablecoinPricePersistenceAdmissionErrorCode): never {
  throw new StablecoinPricePersistenceAdmissionError(code);
}
