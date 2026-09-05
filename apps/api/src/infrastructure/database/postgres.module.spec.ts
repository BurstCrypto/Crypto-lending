import { INFRASTRUCTURE_CONFIG } from '../config/infrastructure-config.module';
import { PostgresModule } from './postgres.module';
import { POSTGRES_POOL } from './postgres.tokens';
import { createPostgresPool } from './runtime-postgres-pool';

describe('PostgresModule', () => {
  it('wires the extracted runtime pool factory by identity', () => {
    const providers = Reflect.getMetadata('providers', PostgresModule) as unknown[];
    const postgresPoolProviders = providers.filter(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        (provider as { provide?: unknown }).provide === POSTGRES_POOL,
    );

    expect(postgresPoolProviders).toHaveLength(1);
    expect(postgresPoolProviders[0]).toEqual({
      provide: POSTGRES_POOL,
      inject: [INFRASTRUCTURE_CONFIG],
      useFactory: createPostgresPool,
    });
  });
});
