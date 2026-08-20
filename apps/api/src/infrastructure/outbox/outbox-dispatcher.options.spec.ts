import { loadOutboxDispatcherOptions } from './outbox-dispatcher.options';

const OUTBOX_ENVIRONMENT_NAMES = [
  'OUTBOX_BATCH_SIZE',
  'OUTBOX_CLEANUP_BATCH_SIZE',
  'OUTBOX_CLEANUP_INTERVAL_MS',
  'OUTBOX_CONCURRENCY',
  'OUTBOX_FAILED_RETENTION_MS',
  'OUTBOX_LEASE_MS',
  'OUTBOX_MAX_ATTEMPTS',
  'OUTBOX_PUBLISH_TIMEOUT_MS',
  'OUTBOX_PUBLISHED_RETENTION_MS',
  'OUTBOX_RETRY_BASE_DELAY_MS',
  'OUTBOX_RETRY_MAX_DELAY_MS',
] as const;

describe('outbox dispatcher options', () => {
  const originalEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of OUTBOX_ENVIRONMENT_NAMES) {
      originalEnvironment.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of OUTBOX_ENVIRONMENT_NAMES) {
      const original = originalEnvironment.get(name);
      if (original === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original;
      }
    }
    originalEnvironment.clear();
  });

  it('loads bounded cleanup and retention defaults', () => {
    expect(loadOutboxDispatcherOptions()).toMatchObject({
      cleanupBatchSize: 100,
      cleanupIntervalMs: 60_000,
      failedRetentionMs: 30 * 24 * 60 * 60 * 1_000,
      publishTimeoutMs: 10_000,
      publishedRetentionMs: 7 * 24 * 60 * 60 * 1_000,
    });
  });

  it('rejects cleanup values outside their operational bounds', () => {
    process.env.OUTBOX_CLEANUP_BATCH_SIZE = '1001';
    expect(() => loadOutboxDispatcherOptions()).toThrow('OUTBOX_CLEANUP_BATCH_SIZE');

    delete process.env.OUTBOX_CLEANUP_BATCH_SIZE;
    process.env.OUTBOX_PUBLISHED_RETENTION_MS = '59999';
    expect(() => loadOutboxDispatcherOptions()).toThrow('OUTBOX_PUBLISHED_RETENTION_MS');
  });

  it('requires the publish deadline to leave lease-settlement headroom', () => {
    process.env.OUTBOX_LEASE_MS = '1000';
    process.env.OUTBOX_PUBLISH_TIMEOUT_MS = '501';

    expect(() => loadOutboxDispatcherOptions()).toThrow(
      'OUTBOX_PUBLISH_TIMEOUT_MS must be an integer between 100 and 500',
    );
  });
});
