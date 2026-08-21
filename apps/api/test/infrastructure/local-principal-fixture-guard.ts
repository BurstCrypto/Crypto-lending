export const LOCAL_PRINCIPAL_FIXTURE_MARKER = 'crypto-lending-compose-principals-v1';

export interface LocalPrincipalFixtureIdentity {
  database: string;
  bootstrapRole: string;
  marker: string | null;
}

export function assertLocalPrincipalFixture(identity: LocalPrincipalFixtureIdentity): void {
  if (
    identity.database !== 'crypto_lending' ||
    identity.bootstrapRole !== 'crypto_admin' ||
    identity.marker !== LOCAL_PRINCIPAL_FIXTURE_MARKER
  ) {
    throw new Error(
      'KAN-232 principal integration test requires the exact marked local Compose PostgreSQL fixture',
    );
  }
}
