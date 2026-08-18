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

@Injectable()
export class InfrastructureHealthService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly migrations: MigrationRunner,
    private readonly redis: RedisService,
    @Inject(SQS_HEALTH) private readonly sqs: SqsHealthPort,
  ) {}

  async check(timeoutMs = 3_000): Promise<InfrastructureHealth> {
    const [postgres, redis, sqs] = await Promise.all([
      this.checkDependency(async () => {
        await this.postgres.healthCheck();
        await this.migrations.assertUpToDate();
      }, timeoutMs),
      this.checkDependency(() => this.redis.healthCheck(), timeoutMs),
      this.checkDependency(() => this.sqs.healthCheck(), timeoutMs),
    ]);
    const checks = { postgres, redis, sqs };
    return {
      status: Object.values(checks).every((check) => check.status === 'up') ? 'ok' : 'degraded',
      checks,
    };
  }

  private async checkDependency(
    check: () => Promise<void>,
    timeoutMs: number,
  ): Promise<DependencyHealthCheck> {
    const startedAt = Date.now();
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Health check timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
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
}
