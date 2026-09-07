import { performance } from 'node:perf_hooks';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { MigrationRunner } from '../database/migration-runner.service';
import { PostgresService } from '../database/postgres.service';
import { RedisService } from '../redis/redis.service';
import { SQS_HEALTH, type SqsHealthPort } from './sqs-health.port';

export type DependencyHealthStatus = 'up' | 'down';

export interface DependencyHealthCheck {
  status: DependencyHealthStatus;
  latencyMs: number;
  error?: string;
}

export interface InfrastructureHealth {
  status: 'ok' | 'degraded';
  checks: {
    postgres: DependencyHealthCheck;
    redis: DependencyHealthCheck;
    sqs: DependencyHealthCheck;
  };
}

// Bound expensive readiness work per replica during probe bursts or an outage.
// Five seconds is short enough for orchestrator readiness while preventing a
// public caller from turning every request into database and SQS operations.
const READINESS_CACHE_TTL_MS = 5_000;
const READINESS_CLOCK_UNAVAILABLE = 'Readiness monotonic clock unavailable';
const CAPTURED_SYSTEM_MONOTONIC_NOW = performance.now.bind(performance);

export const INFRASTRUCTURE_HEALTH_MONOTONIC_CLOCK = Symbol(
  'INFRASTRUCTURE_HEALTH_MONOTONIC_CLOCK',
);

export interface InfrastructureHealthMonotonicClock {
  nowMilliseconds(): number;
}

const SYSTEM_INFRASTRUCTURE_HEALTH_MONOTONIC_CLOCK: InfrastructureHealthMonotonicClock =
  Object.freeze({
    nowMilliseconds: CAPTURED_SYSTEM_MONOTONIC_NOW,
  });

interface CachedInfrastructureHealth {
  expiresAt: number;
  value: InfrastructureHealth;
}

type DependencyName = keyof InfrastructureHealth['checks'];

@Injectable()
export class InfrastructureHealthService {
  private cachedHealth: CachedInfrastructureHealth | undefined;
  private checkInFlight: Promise<InfrastructureHealth> | undefined;
  private readonly dependencyChecks = new Map<DependencyName, Promise<void>>();
  private lastObservedMonotonicMs: number | undefined;
  // Once time ordering is untrustworthy, only a replica restart can safely
  // establish a new cache/latency epoch.
  private monotonicClockHealthy = true;

  constructor(
    private readonly postgres: PostgresService,
    private readonly migrations: MigrationRunner,
    private readonly redis: RedisService,
    @Inject(SQS_HEALTH) private readonly sqs: SqsHealthPort,
    @Optional()
    @Inject(INFRASTRUCTURE_HEALTH_MONOTONIC_CLOCK)
    private readonly monotonicClock: InfrastructureHealthMonotonicClock = SYSTEM_INFRASTRUCTURE_HEALTH_MONOTONIC_CLOCK,
  ) {}

  async check(timeoutMs = 3_000): Promise<InfrastructureHealth> {
    const observedAt = this.observeMonotonicClock();
    if (observedAt === null) return this.clockUnavailableHealth();

    const cached = this.cachedHealth;
    if (cached && cached.expiresAt > observedAt) {
      return cached.value;
    }

    const existingCheck = this.checkInFlight;
    if (existingCheck) {
      return existingCheck;
    }

    const pendingCheck = this.performCheck(timeoutMs)
      .then((health) => {
        const completedAt = this.observeMonotonicClock();
        if (completedAt === null) return this.clockUnavailableHealth();
        this.cachedHealth = {
          expiresAt: completedAt + READINESS_CACHE_TTL_MS,
          value: health,
        };
        return health;
      })
      .finally(() => {
        if (this.checkInFlight === pendingCheck) {
          this.checkInFlight = undefined;
        }
      });
    this.checkInFlight = pendingCheck;
    return pendingCheck;
  }

  private async performCheck(timeoutMs: number): Promise<InfrastructureHealth> {
    const [postgres, redis, sqs] = await Promise.all([
      this.checkDependency(
        'postgres',
        async (signal) => {
          await this.postgres.healthCheck(signal);
          await this.migrations.assertUpToDate(signal);
        },
        timeoutMs,
      ),
      this.checkDependency('redis', () => this.redis.healthCheck(), timeoutMs),
      this.checkDependency('sqs', (signal) => this.sqs.healthCheck(signal), timeoutMs),
    ]);
    const checks = { postgres, redis, sqs };
    return {
      status: Object.values(checks).every((check) => check.status === 'up') ? 'ok' : 'degraded',
      checks,
    };
  }

  private async checkDependency(
    name: DependencyName,
    check: (signal: AbortSignal) => Promise<void>,
    timeoutMs: number,
  ): Promise<DependencyHealthCheck> {
    const startedAt = this.observeMonotonicClock();
    if (startedAt === null) return this.clockUnavailableDependency();

    const abortController = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    try {
      const dependencyCheck = this.coalesceDependencyCheck(name, check, abortController.signal);
      await Promise.race([
        dependencyCheck,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            abortController.abort();
            reject(new Error(`Health check timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
      const completedAt = this.observeMonotonicClock();
      if (completedAt === null) return this.clockUnavailableDependency();
      return { status: 'up', latencyMs: completedAt - startedAt };
    } catch (error) {
      const completedAt = this.observeMonotonicClock();
      if (completedAt === null) return this.clockUnavailableDependency();
      return {
        status: 'down',
        latencyMs: completedAt - startedAt,
        error: error instanceof Error ? error.message : 'Dependency unavailable',
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private coalesceDependencyCheck(
    name: DependencyName,
    check: (signal: AbortSignal) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const existing = this.dependencyChecks.get(name);
    if (existing) {
      return existing;
    }

    let started: Promise<void>;
    try {
      started = check(signal);
    } catch (error) {
      started = Promise.reject(error);
    }
    const pending = started.finally(() => {
      if (this.dependencyChecks.get(name) === pending) {
        this.dependencyChecks.delete(name);
      }
    });
    this.dependencyChecks.set(name, pending);
    return pending;
  }

  private observeMonotonicClock(): number | null {
    if (!this.monotonicClockHealthy) {
      this.cachedHealth = undefined;
      return null;
    }

    let observedAt: number;
    try {
      observedAt = this.monotonicClock.nowMilliseconds();
    } catch {
      return this.failMonotonicClock();
    }
    if (
      !Number.isFinite(observedAt) ||
      observedAt < 0 ||
      observedAt > Number.MAX_SAFE_INTEGER - READINESS_CACHE_TTL_MS ||
      (this.lastObservedMonotonicMs !== undefined && observedAt < this.lastObservedMonotonicMs)
    ) {
      return this.failMonotonicClock();
    }
    this.lastObservedMonotonicMs = observedAt;
    return observedAt;
  }

  private failMonotonicClock(): null {
    this.monotonicClockHealthy = false;
    this.cachedHealth = undefined;
    return null;
  }

  private clockUnavailableDependency(): DependencyHealthCheck {
    return {
      status: 'down',
      latencyMs: 0,
      error: READINESS_CLOCK_UNAVAILABLE,
    };
  }

  private clockUnavailableHealth(): InfrastructureHealth {
    return {
      status: 'degraded',
      checks: {
        postgres: this.clockUnavailableDependency(),
        redis: this.clockUnavailableDependency(),
        sqs: this.clockUnavailableDependency(),
      },
    };
  }
}
