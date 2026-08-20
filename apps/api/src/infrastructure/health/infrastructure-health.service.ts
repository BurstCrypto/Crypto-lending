import { Inject, Injectable } from '@nestjs/common';

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

  constructor(
    private readonly postgres: PostgresService,
    private readonly migrations: MigrationRunner,
    private readonly redis: RedisService,
    @Inject(SQS_HEALTH) private readonly sqs: SqsHealthPort,
  ) {}

  async check(timeoutMs = 3_000): Promise<InfrastructureHealth> {
    const cached = this.cachedHealth;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const existingCheck = this.checkInFlight;
    if (existingCheck) {
      return existingCheck;
    }

    const pendingCheck = this.performCheck(timeoutMs)
      .then((health) => {
        this.cachedHealth = {
          expiresAt: Date.now() + READINESS_CACHE_TTL_MS,
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
        async () => {
          await this.postgres.healthCheck();
          await this.migrations.assertUpToDate();
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
    const startedAt = Date.now();
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
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
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
}
