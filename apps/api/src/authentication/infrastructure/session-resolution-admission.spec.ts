import { SessionResolutionAdmission } from './session-resolution-admission';

function admission(
  overrides: Partial<ConstructorParameters<typeof SessionResolutionAdmission>[0]> = {},
  clock: () => number = () => 0,
): SessionResolutionAdmission {
  return new SessionResolutionAdmission(
    {
      maxConcurrentResolutions: 2,
      maxTrackedSources: 4,
      sourceRequestLimit: 3,
      sourceWindowMilliseconds: 60_000,
      ...overrides,
    },
    clock,
  );
}

function requireLease(
  decision: ReturnType<SessionResolutionAdmission['tryAcquire']>,
): Extract<typeof decision, { admitted: true }>['lease'] {
  if (!decision.admitted) throw new Error('Expected an admitted session-resolution lease');
  return decision.lease;
}

describe('SessionResolutionAdmission', () => {
  it('keeps the global zero-queue cap below the configured database pool capacity', () => {
    const boundary = SessionResolutionAdmission.forDatabasePool(3, () => 0);
    const first = boundary.tryAcquire('198.51.100.1');
    const second = boundary.tryAcquire('198.51.100.2');

    expect(first.admitted).toBe(true);
    expect(second.admitted).toBe(true);
    expect(boundary.tryAcquire('198.51.100.3')).toEqual({
      admitted: false,
      retryAfterSeconds: 1,
    });

    const firstLease = requireLease(first);
    firstLease.release();
    firstLease.release();
    requireLease(boundary.tryAcquire('198.51.100.3')).release();
    requireLease(second).release();
    expect(() => SessionResolutionAdmission.forDatabasePool(1)).toThrow(
      'Database pool capacity must be an integer between 2 and 100',
    );
  });

  it('enforces the production eight-resolution and 300-attempt policy ceilings', () => {
    const boundary = SessionResolutionAdmission.forDatabasePool(10, () => 0);
    const leases = Array.from({ length: 8 }, (_unused, index) =>
      requireLease(boundary.tryAcquire(`198.51.100.${index + 1}`)),
    );
    expect(boundary.tryAcquire('198.51.100.20')).toEqual({
      admitted: false,
      retryAfterSeconds: 1,
    });
    for (const lease of leases) lease.release();

    for (let attempt = 0; attempt < 300; attempt += 1) {
      requireLease(boundary.tryAcquire('198.51.100.30')).release();
    }
    expect(boundary.tryAcquire('198.51.100.30')).toEqual({
      admitted: false,
      retryAfterSeconds: 60,
    });
  });

  it('limits one trusted source without consuming another source budget and recovers by window', () => {
    let now = 1_000;
    const boundary = admission({ maxConcurrentResolutions: 1, sourceRequestLimit: 2 }, () => now);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      requireLease(boundary.tryAcquire('198.51.100.10')).release();
    }
    expect(boundary.tryAcquire('198.51.100.10')).toEqual({
      admitted: false,
      retryAfterSeconds: 60,
    });

    const otherSource = boundary.tryAcquire('198.51.100.11');
    expect(otherSource.admitted).toBe(true);
    requireLease(otherSource).release();

    now += 60_000;
    expect(boundary.tryAcquire('198.51.100.10').admitted).toBe(true);
  });

  it('bounds source cardinality without turning source churn into a shared permanent denial', () => {
    const boundary = admission({ maxConcurrentResolutions: 1, maxTrackedSources: 2 });

    requireLease(boundary.tryAcquire('198.51.100.20')).release();
    requireLease(boundary.tryAcquire('198.51.100.21')).release();
    requireLease(boundary.tryAcquire('198.51.100.22')).release();

    requireLease(boundary.tryAcquire('198.51.100.23')).release();
  });
});
