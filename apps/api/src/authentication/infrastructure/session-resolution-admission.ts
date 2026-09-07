import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

export const SESSION_RESOLUTION_ADMISSION_POLICY = Object.freeze({
  maximumConcurrentResolutions: 8,
  maximumTrackedSources: 4_096,
  sourceRequestLimit: 300,
  sourceWindowMilliseconds: 60_000,
});

export interface SessionResolutionAdmissionLimits {
  readonly maxConcurrentResolutions: number;
  readonly maxTrackedSources: number;
  readonly sourceRequestLimit: number;
  readonly sourceWindowMilliseconds: number;
}

export interface SessionResolutionAdmissionLease {
  release(): void;
}

export type SessionResolutionAdmissionDecision =
  | Readonly<{ admitted: true; lease: SessionResolutionAdmissionLease }>
  | Readonly<{ admitted: false; retryAfterSeconds: number }>;

interface SourceWindow {
  requestCount: number;
  windowStartedAt: number;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function defaultLimits(databasePoolCapacity: number): SessionResolutionAdmissionLimits {
  const poolCapacity = boundedInteger(databasePoolCapacity, 'Database pool capacity', 2, 100);
  return Object.freeze({
    maxConcurrentResolutions: Math.min(
      SESSION_RESOLUTION_ADMISSION_POLICY.maximumConcurrentResolutions,
      poolCapacity - 1,
    ),
    maxTrackedSources: SESSION_RESOLUTION_ADMISSION_POLICY.maximumTrackedSources,
    sourceRequestLimit: SESSION_RESOLUTION_ADMISSION_POLICY.sourceRequestLimit,
    sourceWindowMilliseconds: SESSION_RESOLUTION_ADMISSION_POLICY.sourceWindowMilliseconds,
  });
}

/**
 * A zero-queue, per-replica boundary in front of repository-backed session
 * resolution. The global lease always leaves at least one configured database
 * connection outside this workload, while the bounded source map prevents one
 * trusted client address from continuously reacquiring every released lease.
 */
export class SessionResolutionAdmission {
  private activeResolutions = 0;
  private readonly sourceWindows = new Map<string, SourceWindow>();

  constructor(
    private readonly limits: Readonly<SessionResolutionAdmissionLimits>,
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {
    boundedInteger(limits.maxConcurrentResolutions, 'Session resolution concurrency', 1, 99);
    boundedInteger(limits.maxTrackedSources, 'Session resolution tracked sources', 1, 65_536);
    boundedInteger(limits.sourceRequestLimit, 'Session resolution source limit', 1, 100_000);
    boundedInteger(
      limits.sourceWindowMilliseconds,
      'Session resolution source window',
      1_000,
      3_600_000,
    );
  }

  static forDatabasePool(
    databasePoolCapacity: number,
    monotonicNow?: () => number,
  ): SessionResolutionAdmission {
    return new SessionResolutionAdmission(defaultLimits(databasePoolCapacity), monotonicNow);
  }

  tryAcquire(sourceAddress: string): SessionResolutionAdmissionDecision {
    if (
      typeof sourceAddress !== 'string' ||
      sourceAddress.length > 64 ||
      isIP(sourceAddress) === 0
    ) {
      throw new TypeError('Session resolution source address must be a canonical IP address');
    }

    const now = this.readClock();
    const sourceDecision = this.chargeSource(sourceAddress, now);
    if (sourceDecision !== null) return sourceDecision;
    if (this.activeResolutions >= this.limits.maxConcurrentResolutions) {
      return Object.freeze({ admitted: false, retryAfterSeconds: 1 });
    }

    this.activeResolutions += 1;
    let released = false;
    return Object.freeze({
      admitted: true,
      lease: Object.freeze({
        release: (): void => {
          if (released) return;
          released = true;
          this.activeResolutions = Math.max(0, this.activeResolutions - 1);
        },
      }),
    });
  }

  private chargeSource(
    sourceAddress: string,
    now: number,
  ): Readonly<{ admitted: false; retryAfterSeconds: number }> | null {
    let window = this.sourceWindows.get(sourceAddress);
    if (window === undefined) {
      this.evictOldestSourceIfFull();
      window = { requestCount: 0, windowStartedAt: now };
    } else {
      this.sourceWindows.delete(sourceAddress);
      if (now < window.windowStartedAt) {
        this.sourceWindows.set(sourceAddress, window);
        return Object.freeze({ admitted: false, retryAfterSeconds: 1 });
      }
      if (now - window.windowStartedAt >= this.limits.sourceWindowMilliseconds) {
        window = { requestCount: 0, windowStartedAt: now };
      }
    }

    this.sourceWindows.set(sourceAddress, window);
    if (window.requestCount >= this.limits.sourceRequestLimit) {
      const remainingMilliseconds = Math.max(
        1,
        this.limits.sourceWindowMilliseconds - (now - window.windowStartedAt),
      );
      return Object.freeze({
        admitted: false,
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMilliseconds / 1_000)),
      });
    }
    window.requestCount += 1;
    return null;
  }

  private evictOldestSourceIfFull(): void {
    if (this.sourceWindows.size < this.limits.maxTrackedSources) return;
    const oldestSource = this.sourceWindows.keys().next().value as string | undefined;
    if (oldestSource !== undefined) this.sourceWindows.delete(oldestSource);
  }

  private readClock(): number {
    let now: number;
    try {
      now = this.monotonicNow();
    } catch {
      throw new TypeError('Session resolution admission clock is unavailable');
    }
    if (!Number.isFinite(now) || now < 0) {
      throw new TypeError('Session resolution admission clock is unavailable');
    }
    return now;
  }
}
