import { randomBytes, randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { privateKeyToAccount } from 'viem/accounts';

import { parseAccountId } from '../../src/accounts/domain/account-profile';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { PostgresService } from '../../src/infrastructure/database/postgres.service';
import { WalletRegistrationRejectedError } from '../../src/wallets/application/wallet-registration.errors';
import { WalletRegistrationService } from '../../src/wallets/application/wallet-registration.service';
import { loadWalletRegistrationConfig } from '../../src/wallets/infrastructure/config/wallet-registration.config';
import { PostgresWalletRegistrationRepository } from '../../src/wallets/infrastructure/postgres/postgres-wallet-registration.repository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('KAN-56 wallet integration requires a loopback PostgreSQL fixture');
  }
}

function encodedKey(): string {
  return randomBytes(32).toString('base64url');
}

describeWithPostgres('wallet registration integration', () => {
  jest.setTimeout(30_000);

  const schema = `kan56_${randomUUID().replaceAll('-', '')}`;
  let adminPool: Pool;
  let schemaPool: Pool;
  let service: WalletRegistrationService;
  const accountId = parseAccountId(randomUUID());

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    schemaPool = new Pool({
      connectionString: testDatabaseUrl as string,
      options: `-c search_path=${schema}`,
    });
    await new MigrationRunner(schemaPool, DATABASE_TEST_SCHEMA_MIGRATION_LIST).up();
    await schemaPool.query(
      `INSERT INTO accounts (account_id, eligibility_status)
       VALUES ($1::uuid, 'UNKNOWN')`,
      [accountId],
    );
    const repository = new PostgresWalletRegistrationRepository(new PostgresService(schemaPool));
    const config = loadWalletRegistrationConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'oidc',
      AUTH_PUBLIC_ORIGIN: 'https://wallet.test',
      WALLET_REGISTRATION_MODE: 'enabled',
      WALLET_REGISTRATION_REGISTRY_ENVIRONMENT: 'TESTNET',
      WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS: '300',
      WALLET_IDENTITY_HMAC_KEY_VERSION: '1',
      WALLET_IDENTITY_HMAC_KEY: encodedKey(),
      WALLET_CHALLENGE_HMAC_KEY_VERSION: '1',
      WALLET_CHALLENGE_HMAC_KEY: encodedKey(),
      WALLET_METADATA_SEAL_KEY_VERSION: '1',
      WALLET_METADATA_SEAL_KEY: encodedKey(),
    });
    service = new WalletRegistrationService(repository, config, {
      now: () => new Date(),
    });
  });

  afterAll(async () => {
    if (schemaPool) await schemaPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  it('atomically registers one valid EVM proof and rejects its concurrent replay', async () => {
    const account = privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
    const correlationId = randomUUID();
    const challenge = await service.issueChallenge({
      accountId,
      chainId: 'eip155:11155111',
      address: account.address,
      correlationId,
    });
    const signature = await account.signMessage({ message: challenge.message });
    const submit = (): ReturnType<WalletRegistrationService['submitProof']> =>
      service.submitProof({
        accountId,
        correlationId,
        proof: {
          kind: 'EVM_EIP191_EOA',
          challengeId: challenge.challengeId,
          message: challenge.message,
          signature,
        },
      });

    const outcomes = await Promise.allSettled([submit(), submit()]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof submit>>> =>
        outcome.status === 'fulfilled',
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value).toMatchObject({
      status: 'registered',
      chainId: 'eip155:11155111',
      address: account.address.toLowerCase(),
    });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(WalletRegistrationRejectedError);

    const walletRows = await schemaPool.query<{
      address_ciphertext: Buffer;
      address_digest: Buffer;
      registry_fingerprint_sha256: string;
    }>(
      `SELECT address_ciphertext, address_digest, registry_fingerprint_sha256
       FROM registered_wallets`,
    );
    expect(walletRows.rows).toHaveLength(1);
    expect(walletRows.rows[0]?.address_digest).toHaveLength(32);
    expect(walletRows.rows[0]?.address_ciphertext.toString('utf8')).not.toContain(
      account.address.toLowerCase(),
    );
    expect(walletRows.rows[0]?.registry_fingerprint_sha256).toBe(
      challenge.registryFingerprintSha256,
    );

    const challengeRow = await schemaPool.query<{
      challenge_payload_ciphertext: Buffer | null;
      payload_destroyed_at: Date | null;
      status: string;
    }>(
      `SELECT status, challenge_payload_ciphertext, payload_destroyed_at
       FROM wallet_ownership_challenges
       WHERE challenge_id = $1::uuid`,
      [challenge.challengeId],
    );
    expect(challengeRow.rows).toEqual([
      expect.objectContaining({
        status: 'REGISTERED',
        challenge_payload_ciphertext: null,
        payload_destroyed_at: expect.any(Date),
      }),
    ]);

    const auditRows = await schemaPool.query<{ event_type: string }>(
      `SELECT event_type
       FROM wallet_registration_audit_events
       WHERE challenge_id = $1::uuid
       ORDER BY occurred_at, event_type`,
      [challenge.challengeId],
    );
    expect(auditRows.rows.map(({ event_type }) => event_type)).toEqual(
      expect.arrayContaining([
        'CHALLENGE_STARTED',
        'CHALLENGE_REPLAY_DETECTED',
        'WALLET_REGISTERED',
      ]),
    );
  });

  it('does not expose or consume another account challenge', async () => {
    const otherAccountId = parseAccountId(randomUUID());
    await schemaPool.query(
      `INSERT INTO accounts (account_id, eligibility_status)
       VALUES ($1::uuid, 'UNKNOWN')`,
      [otherAccountId],
    );
    const account = privateKeyToAccount(`0x${randomBytes(32).toString('hex')}`);
    const challenge = await service.issueChallenge({
      accountId,
      chainId: 'eip155:11155111',
      address: account.address,
      correlationId: randomUUID(),
    });
    const signature = await account.signMessage({ message: challenge.message });

    await expect(
      service.submitProof({
        accountId: otherAccountId,
        correlationId: randomUUID(),
        proof: {
          kind: 'EVM_EIP191_EOA',
          challengeId: challenge.challengeId,
          message: challenge.message,
          signature,
        },
      }),
    ).rejects.toBeInstanceOf(WalletRegistrationRejectedError);
    await expect(
      schemaPool.query<{ status: string }>(
        `SELECT status FROM wallet_ownership_challenges WHERE challenge_id = $1::uuid`,
        [challenge.challengeId],
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'PENDING' }] });
  });
});
