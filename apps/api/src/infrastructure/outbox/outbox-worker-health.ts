import type { InfrastructureHealthService } from '../health/infrastructure-health.service';

export async function assertOutboxWorkerHealthy(
  healthService: Pick<InfrastructureHealthService, 'check'>,
): Promise<void> {
  const health = await healthService.check();
  if (health.status === 'ok') {
    return;
  }

  const failedDependencies = Object.entries(health.checks)
    .filter(([, check]) => check.status === 'down')
    .map(([name]) => name)
    .join(', ');
  throw new Error(`Outbox worker dependencies are not ready: ${failedDependencies || 'unknown'}`);
}
