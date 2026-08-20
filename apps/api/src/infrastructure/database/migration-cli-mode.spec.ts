import { enforceMigrationCliMode } from './migration-cli-mode';

describe('enforceMigrationCliMode', () => {
  it('forces production mode and removes the production guard argument', () => {
    const env: NodeJS.ProcessEnv = {};

    expect(enforceMigrationCliMode(['--production', 'up'], env)).toEqual(['up']);
    expect(env.NODE_ENV).toBe('production');
  });

  it('rejects a conflicting environment for the production entrypoint', () => {
    expect(() =>
      enforceMigrationCliMode(['--production', 'status'], { NODE_ENV: 'development' }),
    ).toThrow('The production migration entrypoint cannot run with NODE_ENV=development');
  });

  it('does not alter the environment for local or compiled acceptance commands', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };

    expect(enforceMigrationCliMode(['status'], env)).toEqual(['status']);
    expect(env.NODE_ENV).toBe('test');
  });
});
