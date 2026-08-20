import type { MigrationStatus } from './migration-runner.service';

export interface MigrationCommandRunner {
  up(): Promise<string[]>;
  down(steps?: number): Promise<string[]>;
  status(): Promise<MigrationStatus[]>;
  assertUpToDate(): Promise<void>;
}

export type MigrationCommandWriter = (message: string) => void;

function assertOperandCount(command: string, operands: readonly string[], maximum: number): void {
  if (operands.length > maximum) {
    throw new Error(`Migration command ${command} received unexpected arguments`);
  }
}

export async function executeMigrationCommand(
  runner: MigrationCommandRunner,
  arguments_: readonly string[],
  write: MigrationCommandWriter,
): Promise<void> {
  const [command = 'up', ...operands] = arguments_;

  if (command === 'up') {
    assertOperandCount(command, operands, 0);
    const applied = await runner.up();
    write(`Applied migrations: ${applied.join(', ') || 'none'}\n`);
    return;
  }

  if (command === 'down') {
    assertOperandCount(command, operands, 1);
    const rolledBack = await runner.down(Number(operands[0] ?? '1'));
    write(`Rolled back migrations: ${rolledBack.join(', ') || 'none'}\n`);
    return;
  }

  if (command === 'status') {
    assertOperandCount(command, operands, 0);
    const status = await runner.status();
    for (const migration of status) {
      write(`${migration.applied ? 'up' : 'down'} ${migration.id} ${migration.description}\n`);
    }
    return;
  }

  if (command === 'verify') {
    assertOperandCount(command, operands, 0);
    await runner.assertUpToDate();
    write('Migration verification passed: all expected migrations are applied and valid.\n');
    return;
  }

  throw new Error(`Unknown migration command: ${command}`);
}
