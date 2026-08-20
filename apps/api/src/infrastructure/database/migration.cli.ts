import 'dotenv/config';

import { loadMigrationDatabaseConfig } from '../config/infrastructure.config';
import { enforceMigrationCliMode } from './migration-cli-mode';
import { createMigrationPool } from './migration-pool';
import { MigrationRunner } from './migration-runner.service';
import { DATABASE_MIGRATION_LIST } from './migrations';

async function main(): Promise<void> {
  const cliArguments = enforceMigrationCliMode(process.argv.slice(2), process.env);
  const config = loadMigrationDatabaseConfig();
  const pool = createMigrationPool(config);
  const runner = new MigrationRunner(pool, DATABASE_MIGRATION_LIST);
  const [command = 'up', rawSteps = '1'] = cliArguments;

  try {
    if (command === 'up') {
      const applied = await runner.up();
      process.stdout.write(`Applied migrations: ${applied.join(', ') || 'none'}\n`);
      return;
    }
    if (command === 'down') {
      const rolledBack = await runner.down(Number(rawSteps));
      process.stdout.write(`Rolled back migrations: ${rolledBack.join(', ') || 'none'}\n`);
      return;
    }
    if (command === 'status') {
      const status = await runner.status();
      for (const migration of status) {
        process.stdout.write(
          `${migration.applied ? 'up' : 'down'} ${migration.id} ${migration.description}\n`,
        );
      }
      return;
    }
    throw new Error(`Unknown migration command: ${command}`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Migration failed: ${message}\n`);
  process.exitCode = 1;
});
