import {
  assertLocalPrincipalFixture,
  LOCAL_PRINCIPAL_FIXTURE_MARKER,
} from './local-principal-fixture-guard';

describe('KAN-232 local principal fixture guard', () => {
  it('accepts only the exact marked Compose fixture', () => {
    expect(() =>
      assertLocalPrincipalFixture({
        database: 'crypto_lending',
        bootstrapRole: 'crypto_admin',
        marker: LOCAL_PRINCIPAL_FIXTURE_MARKER,
      }),
    ).not.toThrow();
  });

  it.each([
    { database: 'crypto_lending', bootstrapRole: 'crypto_admin', marker: null },
    { database: 'crypto_lending', bootstrapRole: 'crypto_admin', marker: 'wrong' },
    {
      database: 'crypto_lending',
      bootstrapRole: 'crypto_admin',
      marker: 'crypto-lending-compose-principals-v1',
    },
    {
      database: 'managed_tunnel',
      bootstrapRole: 'crypto_admin',
      marker: LOCAL_PRINCIPAL_FIXTURE_MARKER,
    },
    {
      database: 'crypto_lending',
      bootstrapRole: 'other_admin',
      marker: LOCAL_PRINCIPAL_FIXTURE_MARKER,
    },
  ])('rejects an unmarked or mismatched loopback target: %j', (identity) => {
    expect(() => assertLocalPrincipalFixture(identity)).toThrow(
      'exact marked local Compose PostgreSQL fixture',
    );
  });
});
