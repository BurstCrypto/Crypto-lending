import { executeMigrationCommand, type MigrationCommandRunner } from './migration-command';

function migrationRunner(
  overrides: Partial<MigrationCommandRunner> = {},
): jest.Mocked<MigrationCommandRunner> {
  return {
    up: jest.fn().mockResolvedValue([]),
    down: jest.fn().mockResolvedValue([]),
    status: jest.fn().mockResolvedValue([]),
    assertUpToDate: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<MigrationCommandRunner>;
}

describe('executeMigrationCommand', () => {
  it('preserves up as the default command', async () => {
    const runner = migrationRunner({ up: jest.fn().mockResolvedValue(['0001', '0002']) });
    const output: string[] = [];

    await executeMigrationCommand(runner, [], (message) => output.push(message));

    expect(runner.up).toHaveBeenCalledTimes(1);
    expect(output).toEqual(['Applied migrations: 0001, 0002\n']);
  });

  it('renders status without treating pending migrations as verification success', async () => {
    const runner = migrationRunner({
      status: jest.fn().mockResolvedValue([
        { id: '0001', description: 'first', applied: true },
        { id: '0002', description: 'second', applied: false },
      ]),
    });
    const output: string[] = [];

    await executeMigrationCommand(runner, ['status'], (message) => output.push(message));

    expect(runner.status).toHaveBeenCalledTimes(1);
    expect(runner.assertUpToDate).not.toHaveBeenCalled();
    expect(output).toEqual(['up 0001 first\n', 'down 0002 second\n']);
  });

  it('runs the fail-closed verification path and reports success only after it passes', async () => {
    const runner = migrationRunner();
    const output: string[] = [];

    await executeMigrationCommand(runner, ['verify'], (message) => output.push(message));

    expect(runner.assertUpToDate).toHaveBeenCalledTimes(1);
    expect(runner.up).not.toHaveBeenCalled();
    expect(runner.down).not.toHaveBeenCalled();
    expect(runner.status).not.toHaveBeenCalled();
    expect(output).toEqual([
      'Migration verification passed: all expected migrations are applied and valid.\n',
    ]);
  });

  it('propagates verification failure without emitting a success message', async () => {
    const runner = migrationRunner({
      assertUpToDate: jest.fn().mockRejectedValue(new Error('Database migration 0003 is pending')),
    });
    const output: string[] = [];

    await expect(
      executeMigrationCommand(runner, ['verify'], (message) => output.push(message)),
    ).rejects.toThrow('Database migration 0003 is pending');
    expect(output).toEqual([]);
  });

  it('preserves explicit rollback steps', async () => {
    const runner = migrationRunner({ down: jest.fn().mockResolvedValue(['0003', '0002']) });
    const output: string[] = [];

    await executeMigrationCommand(runner, ['down', '2'], (message) => output.push(message));

    expect(runner.down).toHaveBeenCalledWith(2);
    expect(output).toEqual(['Rolled back migrations: 0003, 0002\n']);
  });

  it.each([
    ['up', 'unexpected'],
    ['status', 'unexpected'],
    ['verify', 'unexpected'],
    ['down', '1', 'unexpected'],
  ])('rejects unexpected operands for %s', async (...arguments_: string[]) => {
    const runner = migrationRunner();

    await expect(executeMigrationCommand(runner, arguments_, () => undefined)).rejects.toThrow(
      'received unexpected arguments',
    );
    expect(runner.up).not.toHaveBeenCalled();
    expect(runner.down).not.toHaveBeenCalled();
    expect(runner.status).not.toHaveBeenCalled();
    expect(runner.assertUpToDate).not.toHaveBeenCalled();
  });

  it('rejects unknown commands before touching the database runner', async () => {
    const runner = migrationRunner();

    await expect(executeMigrationCommand(runner, ['deploy'], () => undefined)).rejects.toThrow(
      'Unknown migration command: deploy',
    );
    expect(runner.up).not.toHaveBeenCalled();
    expect(runner.down).not.toHaveBeenCalled();
    expect(runner.status).not.toHaveBeenCalled();
    expect(runner.assertUpToDate).not.toHaveBeenCalled();
  });
});
