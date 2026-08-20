import 'dotenv/config';

import { loadMigrationDatabaseConfig } from '../config/infrastructure.config';
import { enforceMigrationCliMode } from './migration-cli-mode';
import { executeMigrationCommand } from './migration-command';
import { createMigrationPool } from './migration-pool';
import { MigrationRunner } from './migration-runner.service';
import { DATABASE_MIGRATION_LIST } from './migrations';

async function main(): Promise<void> {
  const cliArguments = enforceMigrationCliMode(process.argv.slice(2), process.env);
  const config = loadMigrationDatabaseConfig();
  const pool = createMigrationPool(config);
  const runner = new MigrationRunner(pool, DATABASE_MIGRATION_LIST);

  try {
    await executeMigrationCommand(runner, cliArguments, (message) => process.stdout.write(message));
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Migration failed: ${message}\n`);
  process.exitCode = 1;
});
