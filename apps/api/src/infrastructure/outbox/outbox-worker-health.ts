import { Inject, Injectable } from '@nestjs/common';

import { MigrationRunner } from '../database/migration-runner.service';
import { PostgresService } from '../database/postgres.service';
import { SQS_HEALTH, type SqsHealthPort } from '../health/sqs-health.port';

type WorkerDependencyName = 'postgres' | 'sqs';

export interface OutboxWorkerHealth {
  status: 'ok' | 'degraded';
  checks: Record<WorkerDependencyName, { status: 'up' | 'down' }>;
}

@Injectable()
export class OutboxWorkerHealthService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly migrations: MigrationRunner,
    @Inject(SQS_HEALTH) private readonly sqs: SqsHealthPort,
  ) {}

  async check(timeoutMs = 3_000): Promise<OutboxWorkerHealth> {
    const [postgres, sqs] = await Promise.all([
      this.checkDependency(async (signal) => {
        await this.postgres.healthCheck(signal);
        await this.migrations.assertMigrationRecordsUpToDate(signal);
      }, timeoutMs),
      this.checkDependency((signal) => this.sqs.healthCheck(signal), timeoutMs),
    ]);
    return {
      status: postgres.status === 'up' && sqs.status === 'up' ? 'ok' : 'degraded',
      checks: { postgres, sqs },
    };
  }

  private async checkDependency(
    check: (signal: AbortSignal) => Promise<void>,
    timeoutMs: number,
  ): Promise<{ status: 'up' | 'down' }> {
    const abortController = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(abortController.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            abortController.abort();
            reject(new Error('Worker dependency timed out'));
          }, timeoutMs);
        }),
      ]);
      return { status: 'up' };
    } catch {
      return { status: 'down' };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

export async function assertOutboxWorkerHealthy(
  healthService: Pick<OutboxWorkerHealthService, 'check'>,
): Promise<void> {
  const health = await healthService.check();
  if (health.status === 'ok') return;

  const failedDependencies = Object.entries(health.checks)
    .filter(([, check]) => check.status === 'down')
    .map(([name]) => name)
    .join(', ');
  throw new Error(`Outbox worker dependencies are not ready: ${failedDependencies || 'unknown'}`);
}
