import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAuthenticationConfig } from '../../apps/api/src/authentication/infrastructure/config/authentication.config';
import {
  loadInfrastructureConfig,
  loadMigrationDatabaseConfig,
} from '../../apps/api/src/infrastructure/config/infrastructure.config';
import { loadWalletRegistrationConfig } from '../../apps/api/src/wallets/infrastructure/config/wallet-registration.config';

// This script is executed through tsx. The JavaScript module is deliberately
// dependency-free so the demo launcher can also use it before app processes run.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- tools/local-demo is outside the application TypeScript projects.
import { createLocalDemoEnvironments } from './environment.mjs';
// @ts-ignore -- tools/local-demo is outside the application TypeScript projects.
import { assertLocalDemoHasNoAmbientEnvironmentFiles } from './safety-preflight.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
assertLocalDemoHasNoAmbientEnvironmentFiles(root);
const environments = createLocalDemoEnvironments();

loadInfrastructureConfig(environments.api);
loadInfrastructureConfig(environments.worker);
loadMigrationDatabaseConfig(environments.migration);
loadAuthenticationConfig(environments.api);
loadWalletRegistrationConfig(environments.api);

process.stdout.write('Local demo application configuration preflight passed.\n');
