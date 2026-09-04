import type { ApplicationWorkload } from './infrastructure.config';
import { hasRedisEnvironmentVariables } from './redis-environment';

export function bindExecutableWorkload(
  env: NodeJS.ProcessEnv,
  expected: ApplicationWorkload,
): void {
  const configured = env.APPLICATION_WORKLOAD;
  const production = env.NODE_ENV?.trim().toLowerCase() === 'production';

  if (production && expected !== 'api' && hasRedisEnvironmentVariables(env)) {
    throw new Error(
      `Production ${expected} executable must not receive any REDIS_* environment variable`,
    );
  }

  if (configured === undefined || configured === '') {
    if (production) {
      throw new Error(
        `Production ${expected} executable requires explicit APPLICATION_WORKLOAD=${expected}`,
      );
    }
    env.APPLICATION_WORKLOAD = expected;
    return;
  }

  if (configured !== expected) {
    throw new Error(
      `${expected} executable refuses APPLICATION_WORKLOAD=${configured}; expected ${expected}`,
    );
  }
}
