import { bindExecutableWorkload } from './application-workload';

describe('bindExecutableWorkload', () => {
  it.each(['api', 'worker'] as const)('accepts the exact production %s binding', (workload) => {
    const env = { NODE_ENV: 'production', APPLICATION_WORKLOAD: workload };
    expect(() => bindExecutableWorkload(env, workload)).not.toThrow();
    expect(env.APPLICATION_WORKLOAD).toBe(workload);
  });

  it.each(['api', 'worker'] as const)('rejects a missing production %s binding', (workload) => {
    expect(() => bindExecutableWorkload({ NODE_ENV: 'production' }, workload)).toThrow(
      `Production ${workload} executable requires explicit APPLICATION_WORKLOAD=${workload}`,
    );
  });

  it('rejects a worker command cross-wired with the API identity before startup', () => {
    expect(() =>
      bindExecutableWorkload({ NODE_ENV: 'production', APPLICATION_WORKLOAD: 'api' }, 'worker'),
    ).toThrow('worker executable refuses APPLICATION_WORKLOAD=api; expected worker');
  });

  it('rejects an unknown Redis secret alias before production worker startup', () => {
    expect(() =>
      bindExecutableWorkload(
        {
          NODE_ENV: 'production',
          APPLICATION_WORKLOAD: 'worker',
          REDIS_OPERATOR_TOKEN: 'must-not-be-injected',
        },
        'worker',
      ),
    ).toThrow('Production worker executable must not receive any REDIS_* environment variable');
  });

  it('rejects whitespace and unknown values instead of normalizing them', () => {
    for (const configured of [' api ', 'WORKER', 'api-worker']) {
      expect(() =>
        bindExecutableWorkload({ NODE_ENV: 'test', APPLICATION_WORKLOAD: configured }, 'api'),
      ).toThrow('api executable refuses APPLICATION_WORKLOAD=');
    }
  });

  it('binds a missing non-production value to the executable identity', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    bindExecutableWorkload(env, 'worker');
    expect(env.APPLICATION_WORKLOAD).toBe('worker');
  });
});
