export const OUTBOX_DISPATCHER_OPTIONS = Symbol('OUTBOX_DISPATCHER_OPTIONS');

export interface OutboxDispatcherOptions {
  batchSize: number;
  cleanupBatchSize: number;
  cleanupIntervalMs: number;
  concurrency: number;
  failedRetentionMs: number;
  leaseMs: number;
  maxAttempts: number;
  publishTimeoutMs: number;
  publishedRetentionMs: number;
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
  const leaseMs = integerFromEnvironment('OUTBOX_LEASE_MS', 30_000, 1_000, 900_000);
  const retryBaseDelayMs = integerFromEnvironment('OUTBOX_RETRY_BASE_DELAY_MS', 1_000, 1, 900_000);
  const retryMaxDelayMs = integerFromEnvironment(
    'OUTBOX_RETRY_MAX_DELAY_MS',
    60_000,
    retryBaseDelayMs,
    900_000,
  );

  return {
    batchSize,
    cleanupBatchSize: integerFromEnvironment('OUTBOX_CLEANUP_BATCH_SIZE', 100, 1, 1_000),
    cleanupIntervalMs: integerFromEnvironment(
      'OUTBOX_CLEANUP_INTERVAL_MS',
      60_000,
      10_000,
      86_400_000,
    ),
    concurrency: integerFromEnvironment('OUTBOX_CONCURRENCY', Math.min(5, batchSize), 1, batchSize),
    failedRetentionMs: integerFromEnvironment(
      'OUTBOX_FAILED_RETENTION_MS',
      30 * 24 * 60 * 60 * 1_000,
      60_000,
      10 * 365 * 24 * 60 * 60 * 1_000,
    ),
    leaseMs,
    maxAttempts: integerFromEnvironment('OUTBOX_MAX_ATTEMPTS', 5, 1, 100),
    publishTimeoutMs: integerFromEnvironment(
      'OUTBOX_PUBLISH_TIMEOUT_MS',
      Math.min(10_000, Math.floor(leaseMs / 2)),
      100,
      Math.max(100, leaseMs - 500),
    ),
    publishedRetentionMs: integerFromEnvironment(
      'OUTBOX_PUBLISHED_RETENTION_MS',
      7 * 24 * 60 * 60 * 1_000,
      60_000,
      10 * 365 * 24 * 60 * 60 * 1_000,
    ),
    retryBaseDelayMs,
    retryMaxDelayMs,
  };
}
