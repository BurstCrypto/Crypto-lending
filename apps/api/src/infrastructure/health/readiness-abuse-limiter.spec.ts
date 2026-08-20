import {
  READINESS_ABUSE_LIMITS,
  ReadinessAbuseLimiter,
  type ReadinessRequestLease,
} from './readiness-abuse-limiter';

describe('ReadinessAbuseLimiter', () => {
  it('caps concurrent readiness requests and releases capacity idempotently', () => {
    const limiter = new ReadinessAbuseLimiter(undefined, () => 1_000);
    const leases: ReadinessRequestLease[] = [];

    for (let index = 0; index < READINESS_ABUSE_LIMITS.maxConcurrentRequests; index += 1) {
      const admission = limiter.tryAcquire();
      expect(admission.admitted).toBe(true);
      if (admission.admitted) leases.push(admission.lease);
    }

    expect(limiter.tryAcquire()).toEqual({ admitted: false, retryAfterSeconds: 1 });
    leases[0]?.release();
    leases[0]?.release();
    expect(limiter.tryAcquire().admitted).toBe(true);
  });

  it('refills a bounded token bucket using a monotonic clock', () => {
    let now = 5_000;
    const limiter = new ReadinessAbuseLimiter(undefined, () => now);

    for (let index = 0; index < READINESS_ABUSE_LIMITS.burstRequests; index += 1) {
      const admission = limiter.tryAcquire();
      expect(admission.admitted).toBe(true);
      if (admission.admitted) admission.lease.release();
    }
    expect(limiter.tryAcquire()).toEqual({ admitted: false, retryAfterSeconds: 1 });

    now += Math.ceil(1_000 / READINESS_ABUSE_LIMITS.requestsPerSecond);
    expect(limiter.tryAcquire().admitted).toBe(true);
  });

  it('does not mint tokens when the supplied clock moves backwards', () => {
    let now = 10_000;
    const limiter = new ReadinessAbuseLimiter(undefined, () => now);

    for (let index = 0; index < READINESS_ABUSE_LIMITS.burstRequests; index += 1) {
      const admission = limiter.tryAcquire();
      if (admission.admitted) admission.lease.release();
    }

    now = 1_000;
    expect(limiter.tryAcquire().admitted).toBe(false);
  });
});
