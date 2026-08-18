export const OUTBOX_DISPATCHER_OPTIONS = Symbol('OUTBOX_DISPATCHER_OPTIONS');

export interface OutboxDispatcherOptions {
  batchSize: number;
  concurrency: number;
  leaseMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

function integerFromEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function loadOutboxDispatcherOptions(): OutboxDispatcherOptions {
  const batchSize = integerFromEnvironment('OUTBOX_BATCH_SIZE', 25, 1, 100);
  const retryBaseDelayMs = integerFromEnvironment('OUTBOX_RETRY_BASE_DELAY_MS', 1_000, 1, 900_000);
  const retryMaxDelayMs = integerFromEnvironment(
    'OUTBOX_RETRY_MAX_DELAY_MS',
    60_000,
    retryBaseDelayMs,
    900_000,
  );

  return {
    batchSize,
    concurrency: integerFromEnvironment('OUTBOX_CONCURRENCY', Math.min(5, batchSize), 1, batchSize),
    leaseMs: integerFromEnvironment('OUTBOX_LEASE_MS', 30_000, 1_000, 900_000),
    maxAttempts: integerFromEnvironment('OUTBOX_MAX_ATTEMPTS', 5, 1, 100),
    retryBaseDelayMs,
    retryMaxDelayMs,
  };
}
