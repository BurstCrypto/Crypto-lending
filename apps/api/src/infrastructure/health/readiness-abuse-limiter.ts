import { performance } from 'node:perf_hooks';

export const READINESS_ABUSE_LIMITS = Object.freeze({
  burstRequests: 16,
  maxConcurrentRequests: 8,
  requestsPerSecond: 5,
});

export interface ReadinessRequestLease {
  release(): void;
}

export type ReadinessAdmission =
  { admitted: true; lease: ReadinessRequestLease } | { admitted: false; retryAfterSeconds: number };

interface ReadinessAbuseLimits {
  readonly burstRequests: number;
  readonly maxConcurrentRequests: number;
  readonly requestsPerSecond: number;
}

/**
 * Bounds readiness traffic per replica without trusting proxy or client IPs.
 * JavaScript's run-to-completion execution makes admission updates atomic
 * within a process, while the lease keeps slow checks from collecting an
 * unbounded number of awaiting HTTP requests.
 */
export class ReadinessAbuseLimiter {
  private activeRequests = 0;
  private availableTokens: number;
  private lastRefillAtMs: number | undefined;

  constructor(
    private readonly limits: Readonly<ReadinessAbuseLimits> = READINESS_ABUSE_LIMITS,
    private readonly clock: () => number = () => performance.now(),
  ) {
    this.availableTokens = limits.burstRequests;
  }

  tryAcquire(): ReadinessAdmission {
    const now = this.clock();
    this.refill(now);

    if (this.activeRequests >= this.limits.maxConcurrentRequests) {
      return { admitted: false, retryAfterSeconds: 1 };
    }

    if (this.availableTokens < 1) {
      const waitMilliseconds = ((1 - this.availableTokens) / this.limits.requestsPerSecond) * 1_000;
      return {
        admitted: false,
        retryAfterSeconds: Math.max(1, Math.ceil(waitMilliseconds / 1_000)),
      };
    }

    this.availableTokens -= 1;
    this.activeRequests += 1;
    let released = false;

    return {
      admitted: true,
      lease: {
        release: () => {
          if (released) return;
          released = true;
          this.activeRequests = Math.max(0, this.activeRequests - 1);
        },
      },
    };
  }

  private refill(now: number): void {
    const previous = this.lastRefillAtMs;
    if (previous === undefined) {
      this.lastRefillAtMs = now;
      return;
    }

    const elapsedMilliseconds = Math.max(0, now - previous);
    this.lastRefillAtMs = Math.max(previous, now);
    this.availableTokens = Math.min(
      this.limits.burstRequests,
      this.availableTokens + (elapsedMilliseconds / 1_000) * this.limits.requestsPerSecond,
    );
  }
}
