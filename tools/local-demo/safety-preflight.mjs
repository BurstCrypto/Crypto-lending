import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const LOCAL_DEMO_FORBIDDEN_ENVIRONMENT_FILES = Object.freeze([
  '.env',
  'apps/api/.env',
  'apps/web/.env',
  'apps/web/.env.local',
  'apps/web/.env.development',
  'apps/web/.env.development.local',
  'apps/web/.env.test',
  'apps/web/.env.test.local',
  'apps/web/.env.production',
  'apps/web/.env.production.local',
]);

export function findLocalDemoForbiddenEnvironmentFiles(root, fileExists = existsSync) {
  return LOCAL_DEMO_FORBIDDEN_ENVIRONMENT_FILES.filter((relativePath) =>
    fileExists(resolve(root, relativePath)),
  );
}

export function assertLocalDemoHasNoAmbientEnvironmentFiles(root, fileExists = existsSync) {
  const present = findLocalDemoForbiddenEnvironmentFiles(root, fileExists);
  if (present.length > 0) {
    throw new Error(
      `Local demo refuses ambient environment files; move these files aside before launch: ${present.join(', ')}`,
    );
  }
}
