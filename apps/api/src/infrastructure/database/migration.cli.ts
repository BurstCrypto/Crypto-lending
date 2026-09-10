import '../config/load-dotenv';

import { performance } from 'node:perf_hooks';

import { loadMigrationDatabaseConfig } from '../config/infrastructure.config';
import { installFatalProcessBoundary, LOG_EVENTS, StructuredLogger } from '../logging';
import { enforceMigrationCliMode } from './migration-cli-mode';
import { createMigrationPool } from './migration-pool';
import { MigrationRunner } from './migration-runner.service';
import { databaseMigrationsForDeployment } from './deployment-migrations';
import { DATABASE_MIGRATION_LIST } from './migrations';

const migrationLogger = new StructuredLogger({ workload: 'migration' });

function emitMigrationResults(
  command: 'up' | 'down',
  migrationIds: readonly string[],
  startedAt: number,
): void {
  const durationMs = performance.now() - startedAt;
  if (migrationIds.length === 0) {
    migrationLogger.emit(LOG_EVENTS.migrationCompleted, 'info', {
      migrationCommand: command,
      changed: 0,
      durationMs,
      outcome: 'success',
    });
    return;
  }
  for (const migrationId of migrationIds) {
    migrationLogger.emit(LOG_EVENTS.migrationCompleted, 'info', {
      migrationCommand: command,
      migrationId,
      migrationState: command === 'up' ? 'up' : 'down',
      changed: 1,
      durationMs,
      outcome: 'success',
    });
  }
}

async function main(): Promise<void> {
  installFatalProcessBoundary(migrationLogger);
  const cliArguments = enforceMigrationCliMode(process.argv.slice(2), process.env);
  const config = loadMigrationDatabaseConfig();
  const pool = createMigrationPool(config);
  const runner = new MigrationRunner(
    pool,
    databaseMigrationsForDeployment(process.env, DATABASE_MIGRATION_LIST),
  );
  const [command = 'up', rawSteps = '1'] = cliArguments;
  const startedAt = performance.now();
  let emitCompletion: (() => void) | undefined;

  try {
    if (command === 'up') {
      const applied = await runner.up();
      emitCompletion = () => emitMigrationResults('up', applied, startedAt);
    } else if (command === 'down') {
      const rolledBack = await runner.down(Number(rawSteps));
      emitCompletion = () => emitMigrationResults('down', rolledBack, startedAt);
    } else if (command === 'status') {
      const status = await runner.status();
      emitCompletion = () => {
        for (const migration of status) {
          migrationLogger.emit(LOG_EVENTS.migrationCompleted, 'info', {
            migrationCommand: 'status',
            migrationId: migration.id,
            migrationState: migration.applied ? 'up' : 'down',
            durationMs: performance.now() - startedAt,
            outcome: 'success',
          });
        }
        if (status.length === 0) {
          migrationLogger.emit(LOG_EVENTS.migrationCompleted, 'info', {
            migrationCommand: 'status',
            changed: 0,
            durationMs: performance.now() - startedAt,
            outcome: 'success',
          });
        }
      };
    } else {
      throw new Error(`Unknown migration command: ${command}`);
    }
  } finally {
    await pool.end();
  }
  emitCompletion?.();
}

void main().catch((error: unknown) => {
  migrationLogger.emitFatal(LOG_EVENTS.migrationFailed, error, { outcome: 'failure' });
  process.exitCode = 1;
});
