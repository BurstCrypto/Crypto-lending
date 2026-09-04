import type { Type } from '@nestjs/common';

import { AppModule } from './app.module';

export function isLocalHarnessEnvironment(environment: Readonly<NodeJS.ProcessEnv>): boolean {
  return environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test';
}

/**
 * Unknown or absent runtime labels fail closed to the production root. The
 * dynamic import keeps demo and public-testnet transitive dependencies out of
 * the production startup graph.
 */
export async function loadApplicationRootModule(
  environment: Readonly<NodeJS.ProcessEnv>,
): Promise<Type<unknown>> {
  if (!isLocalHarnessEnvironment(environment)) return AppModule;
  const { LocalDevelopmentAppModule } = await import('./local-development-app.module');
  return LocalDevelopmentAppModule;
}
