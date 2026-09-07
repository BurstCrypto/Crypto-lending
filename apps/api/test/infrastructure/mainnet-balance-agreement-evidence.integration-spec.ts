import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { QueryResult, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoinAsset,
} from '../../src/blockchain/domain/supported-asset-registry';
import {
  DormantMainnetBalanceTwoSourceAgreementCoordinator,
  ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
  fingerprintMainnetBalanceSourcePairRegistryV2,
  SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
  type MainnetBalanceAgreementNetworkId,
  type MainnetBalanceAgreementSourceBinding,
  type MainnetBalanceSourcePairRegistryContentV2,
  type MainnetBalanceTwoSourceAgreementCandidateV2,
} from '../../src/blockchain-sync/application/mainnet-balance-two-source-agreement.coordinator';
import {
  INERT_BALANCE_SYNC_EXECUTION_CONTEXT,
  type BalanceIndexerCandidate,
  type BalanceIndexerReadRequest,
  type BalanceIndexerSourceCandidate,
  type MainnetBalanceIndexerCandidate,
  type MainnetBalanceIndexerSourceCandidate,
} from '../../src/blockchain-sync/application/ports/balance-sync.ports';
import { canonicalPositionId } from '../../src/blockchain-sync/infrastructure/rpc/balance-json-rpc';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import { PRODUCTION_DATABASE_PRINCIPALS } from '../../src/infrastructure/database/migrations/0005-enforce-database-principal-boundaries.migration';
import { createMainnetBalanceAgreementEvidenceTestSchemaMigrationV0027 } from '../../src/infrastructure/database/migrations/0027-create-mainnet-balance-agreement-evidence.migration';
import { DATABASE_TEST_SCHEMA_MIGRATION_LIST } from '../../src/infrastructure/database/migrations';
import { assertLocalPrincipalFixture } from './local-principal-fixture-guard';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const ETHEREUM = ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID;
const SOLANA = SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID;
const SOLANA_BLOCK_IDENTITY = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_PARENT_BLOCK_IDENTITY = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const APPROVED_MANIFEST_FINGERPRINT = 'a'.repeat(64);
const OBSERVED_IDENTITY_FINGERPRINT = 'b'.repeat(64);

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Mainnet balance agreement integration requires loopback PostgreSQL');
  }
}

function at(base: string, offsetMilliseconds: number): string {
  return new Date(Date.parse(base) + offsetMilliseconds).toISOString();
}

function sourceFor(
  networkId: MainnetBalanceAgreementNetworkId,
  retrievedAt: string,
): MainnetBalanceIndexerSourceCandidate {
  return networkId === ETHEREUM
    ? {
        position: '21000000',
        hash: `0x${'a'.repeat(64)}`,
        parentHash: `0x${'b'.repeat(64)}`,
        selector: 'finalized',
        retrievedAt,
        identityValidated: true,
        deploymentIdentityValidated: true,
        approvedManifestFingerprintSha256: APPROVED_MANIFEST_FINGERPRINT,
        observedIdentityFingerprintSha256: OBSERVED_IDENTITY_FINGERPRINT,
      }
    : {
        position: '280000000',
        hash: SOLANA_BLOCK_IDENTITY,
        parentHash: SOLANA_PARENT_BLOCK_IDENTITY,
        selector: 'finalized',
        retrievedAt,
        identityValidated: true,
        deploymentIdentityValidated: true,
        approvedManifestFingerprintSha256: APPROVED_MANIFEST_FINGERPRINT,
        observedIdentityFingerprintSha256: OBSERVED_IDENTITY_FINGERPRINT,
      };
}

function candidate(
  request: BalanceIndexerReadRequest,
  retrievedAt: string,
): MainnetBalanceIndexerCandidate {
  const positions = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets
    .filter(
      (asset): asset is SupportedStablecoinAsset =>
        asset.activationState === 'ACTIVE' && asset.networkId === request.networkId,
    )
    .map((asset, index) => ({
      positionId: canonicalPositionId([
        request.accountId,
        request.walletId,
        request.networkId,
        asset.identity,
      ]),
      stablecoin: asset.stablecoin,
      assetIdentity: asset.identity,
      amountAtomic: String((index + 1) * 1_000_000),
    }));
  return {
    walletId: request.walletId,
    networkId: request.networkId,
    tier: 'FINANCIAL',
    source: sourceFor(request.networkId as MainnetBalanceAgreementNetworkId, retrievedAt),
    positions,
  };
}

function agreementCoordinator(now: string): DormantMainnetBalanceTwoSourceAgreementCoordinator {
  const registryContent: MainnetBalanceSourcePairRegistryContentV2 = {
    schemaVersion: 2,
    environment: 'MAINNET',
    approvalStatus: 'APPROVED',
    pairs: [
      {
        networkId: ETHEREUM,
        approvedAt: at(now, -60_000),
        expiresAt: at(now, 600_000),
        approvedManifestFingerprintSha256: APPROVED_MANIFEST_FINGERPRINT,
        primary: { sourceFamilyId: 'ethereum-family-primary', sourceId: 'ethereum-primary' },
        corroborating: {
          sourceFamilyId: 'ethereum-family-corroborating',
          sourceId: 'ethereum-corroborating',
        },
      },
      {
        networkId: SOLANA,
        approvedAt: at(now, -60_000),
        expiresAt: at(now, 600_000),
        approvedManifestFingerprintSha256: APPROVED_MANIFEST_FINGERPRINT,
        primary: { sourceFamilyId: 'solana-family-primary', sourceId: 'solana-primary' },
        corroborating: {
          sourceFamilyId: 'solana-family-corroborating',
          sourceId: 'solana-corroborating',
        },
      },
    ],
  };
  const bindings: MainnetBalanceAgreementSourceBinding[] = registryContent.pairs.flatMap((pair) => [
    {
      networkId: pair.networkId,
      role: 'PRIMARY' as const,
      ...pair.primary,
      reader: {
        readCurrent: async (request: BalanceIndexerReadRequest) =>
          candidate(request, at(now, -2_000)),
      },
    },
    {
      networkId: pair.networkId,
      role: 'CORROBORATING' as const,
      ...pair.corroborating,
      reader: {
        readCurrent: async (request: BalanceIndexerReadRequest) =>
          candidate(request, at(now, -1_000)),
      },
    },
  ]);
  return new DormantMainnetBalanceTwoSourceAgreementCoordinator(
    {
      ...registryContent,
      fingerprintSha256: fingerprintMainnetBalanceSourcePairRegistryV2(registryContent),
    },
    bindings,
    { now: () => new Date(now) },
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function legacySource(source: MainnetBalanceIndexerSourceCandidate): BalanceIndexerSourceCandidate {
  return {
    position: source.position,
    hash: source.hash,
    parentHash: source.parentHash,
    selector: source.selector,
    retrievedAt: source.retrievedAt,
    identityValidated: true,
  };
}

function legacyCheckpoint(
  networkId: MainnetBalanceAgreementNetworkId,
  source: BalanceIndexerSourceCandidate,
): Readonly<Record<string, string>> {
  return networkId === ETHEREUM
    ? {
        kind: 'ETHEREUM_BLOCK',
        blockNumber: source.position,
        blockHash: source.hash,
        parentBlockHash: source.parentHash,
      }
    : {
        kind: 'SOLANA_ROOTED_BLOCK',
        finalizedSlot: source.position,
        blockIdentity: source.hash,
        parentBlockIdentity: source.parentHash,
        rootSlot: source.position,
        rootDerivation: 'FINALIZED_SLOT_IS_ROOTED',
      };
}

function legacySourceIdentity(
  networkId: MainnetBalanceAgreementNetworkId,
  role: 'PRIMARY' | 'CORROBORATING',
): Readonly<{ sourceFamilyId: string; sourceId: string }> {
  const chain = networkId === ETHEREUM ? 'ethereum' : 'solana';
  const suffix = role === 'PRIMARY' ? 'primary' : 'corroborating';
  return { sourceFamilyId: `${chain}-family-${suffix}`, sourceId: `${chain}-${suffix}` };
}

function legacyRegistryFingerprint(now: string): string {
  const pairs = [ETHEREUM, SOLANA].map((networkId) => {
    const primary = legacySourceIdentity(networkId, 'PRIMARY');
    const corroborating = legacySourceIdentity(networkId, 'CORROBORATING');
    return [
      networkId,
      at(now, -60_000),
      at(now, 600_000),
      [primary.sourceFamilyId, primary.sourceId],
      [corroborating.sourceFamilyId, corroborating.sourceId],
    ];
  });
  return fingerprint([
    'crypto-lending:mainnet-balance-source-pair-registry:v1',
    1,
    'MAINNET',
    'APPROVED',
    pairs,
  ]);
}

function legacyAgreementEnvelopeV1(
  request: BalanceIndexerReadRequest & { networkId: MainnetBalanceAgreementNetworkId },
  now: string,
) {
  const primaryCandidate = candidate(request, at(now, -2_000));
  const corroboratingCandidate = candidate(request, at(now, -1_000));
  const positions = [...primaryCandidate.positions].sort((left, right) => {
    return left.assetIdentity < right.assetIdentity
      ? -1
      : left.assetIdentity > right.assetIdentity
        ? 1
        : 0;
  });
  const primarySource = legacySource(primaryCandidate.source);
  const corroboratingSource = legacySource(corroboratingCandidate.source);
  const checkpoint = legacyCheckpoint(request.networkId, primarySource);
  const positionSetFingerprintSha256 = fingerprint([
    'crypto-lending:mainnet-balance-position-set:v1',
    request.networkId,
    positions.map(({ positionId, stablecoin, assetIdentity, amountAtomic }) => [
      positionId,
      stablecoin,
      assetIdentity,
      amountAtomic,
    ]),
  ]);
  const sourcePairRegistryFingerprintSha256 = legacyRegistryFingerprint(now);
  const sourceAttestation = (
    role: 'PRIMARY' | 'CORROBORATING',
    source: BalanceIndexerSourceCandidate,
  ) => {
    const identity = legacySourceIdentity(request.networkId, role);
    return {
      role,
      ...identity,
      networkId: request.networkId,
      retrievedAt: source.retrievedAt,
      chainIdentityValidated: true as const,
      checkpoint,
      positionSetFingerprintSha256,
      candidateFingerprintSha256: fingerprint([
        'crypto-lending:mainnet-balance-source-attestation:v1',
        sourcePairRegistryFingerprintSha256,
        request.accountId,
        request.walletId,
        request.networkId,
        'FINANCIAL',
        'finalized',
        role,
        identity.sourceFamilyId,
        identity.sourceId,
        source,
        checkpoint,
        positionSetFingerprintSha256,
      ]),
    };
  };
  const observationCandidate: BalanceIndexerCandidate = {
    walletId: request.walletId,
    networkId: request.networkId,
    tier: 'FINANCIAL',
    source: { ...primarySource, retrievedAt: corroboratingSource.retrievedAt },
    positions,
  };
  const agreementWithoutFingerprint = {
    status: 'EXACT_CHECKPOINT_AND_BALANCE_MATCH' as const,
    checkpoint,
    sourcePairRegistryFingerprintSha256,
    sourcePairApprovalExpiresAt: at(now, 600_000),
    positionSetFingerprintSha256,
    sourceAttestations: [
      sourceAttestation('PRIMARY', primarySource),
      sourceAttestation('CORROBORATING', corroboratingSource),
    ] as const,
  };
  return {
    agreementVersion: 1 as const,
    use: 'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY' as const,
    mayPersist: false as const,
    mayAuthorizeFinancialAction: false as const,
    accountId: request.accountId,
    observationCandidate,
    agreement: {
      ...agreementWithoutFingerprint,
      agreementFingerprintSha256: fingerprint([
        'crypto-lending:mainnet-balance-two-source-agreement:v1',
        1,
        'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY',
        request.accountId,
        observationCandidate,
        agreementWithoutFingerprint,
      ]),
    },
  };
}

type LegacyMainnetBalanceAgreementEnvelopeV1 = ReturnType<typeof legacyAgreementEnvelopeV1>;

async function queryAsRole<Row extends QueryResultRow>(
  pool: Pool,
  role: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${quoteIdentifier(role)}`);
    const result = await client.query<Row>(text, values as unknown[]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describeWithPostgres('mainnet balance two-source agreement evidence boundary', () => {
  jest.setTimeout(120_000);

  const schema = `balance_agreement_${randomBytes(8).toString('hex')}`;
  const expectedMigrationIds = DATABASE_TEST_SCHEMA_MIGRATION_LIST.map(({ id }) => id);
  let adminPool: Pool;
  let operationPool: Pool;
  let runner: MigrationRunner;
  let accountId: string;
  let ethereumWalletId: string;
  let solanaWalletId: string;
  let evidence: readonly LegacyMainnetBalanceAgreementEnvelopeV1[];
  let deploymentAwareEvidence: readonly MainnetBalanceTwoSourceAgreementCandidateV2[];

  async function registerWallet(
    ownerAccountId: string,
    networkId: MainnetBalanceAgreementNetworkId,
  ): Promise<string> {
    const walletId = randomUUID();
    const challengeId = randomUUID();
    const ethereum = networkId === ETHEREUM;
    const namespace = ethereum ? 'eip155' : 'solana';
    const reference = ethereum ? '1' : '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
    const proofScheme = ethereum ? 'EVM_ERC4361_ERC191' : 'SOLANA_SIWS_SIGN_MESSAGE';
    const addressDigest = randomBytes(32);
    await operationPool.query(
      `INSERT INTO wallet_ownership_challenges (
         challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
         registry_environment, registry_version, registry_fingerprint_sha256,
         address_digest_version, address_digest, domain_digest_version, domain_digest,
         message_digest_version, message_digest, nonce_digest_version, nonce_digest,
         status, created_at, issued_at, expires_at, completed_at, payload_destroyed_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'MAINNET', 1, $6,
         1, $7, 1, $8, 1, $9, 1, $10, 'REGISTERED',
         statement_timestamp() - interval '2 minutes',
         statement_timestamp() - interval '2 minutes',
         statement_timestamp() + interval '5 minutes',
         statement_timestamp() - interval '1 minute',
         statement_timestamp() - interval '1 minute'
       )`,
      [
        challengeId,
        ownerAccountId,
        proofScheme,
        namespace,
        reference,
        REGISTRY_FINGERPRINT,
        addressDigest,
        randomBytes(32),
        randomBytes(32),
        randomBytes(32),
      ],
    );
    await operationPool.query(
      `INSERT INTO registered_wallets (
         wallet_id, account_id, registered_by_challenge_id,
         chain_namespace, chain_reference,
         registry_environment, registry_version, registry_fingerprint_sha256,
         address_digest_version, address_digest,
         address_key_version, address_ciphertext, address_iv, address_auth_tag,
         metadata_key_version, metadata_ciphertext, metadata_iv, metadata_auth_tag
       ) VALUES (
         $1, $2, $3, $4, $5, 'MAINNET', 1, $6,
         1, $7, 1, $8, $9, $10, 1, $11, $12, $13
       )`,
      [
        walletId,
        ownerAccountId,
        challengeId,
        namespace,
        reference,
        REGISTRY_FINGERPRINT,
        addressDigest,
        Buffer.from('agreement-encrypted-address'),
        randomBytes(12),
        randomBytes(16),
        Buffer.from('agreement-encrypted-metadata'),
        randomBytes(12),
        randomBytes(16),
      ],
    );
    return walletId;
  }

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    const fixtureIdentity = await adminPool.query<{
      database: string;
      bootstrap_role: string;
      marker: string | null;
    }>(
      `SELECT pg_catalog.current_database() AS database, session_user AS bootstrap_role,
              pg_catalog.current_setting(
                'crypto_lending.local_principal_fixture', true
              ) AS marker`,
    );
    assertLocalPrincipalFixture({
      database: fixtureIdentity.rows[0]?.database ?? '',
      bootstrapRole: fixtureIdentity.rows[0]?.bootstrap_role ?? '',
      marker: fixtureIdentity.rows[0]?.marker ?? null,
    });
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await adminPool.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.legacyRuntimeRole)},
       ${quoteIdentifier(PRODUCTION_DATABASE_PRINCIPALS.migrationRole)}`,
    );
    operationPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 6,
      options: `-c search_path=${schema}`,
    });
    runner = new MigrationRunner(operationPool, DATABASE_TEST_SCHEMA_MIGRATION_LIST);
    await expect(runner.up()).resolves.toEqual(expectedMigrationIds);
    const clock = await operationPool.query<{ now: Date }>(
      "SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp()) AS now",
    );
    const now = clock.rows[0]?.now.toISOString() ?? '';
    accountId = randomUUID();
    await operationPool.query('INSERT INTO accounts (account_id) VALUES ($1)', [accountId]);
    ethereumWalletId = await registerWallet(accountId, ETHEREUM);
    solanaWalletId = await registerWallet(accountId, SOLANA);
    const coordinator = agreementCoordinator(now);
    const ethereumRequest = {
      accountId,
      walletId: ethereumWalletId,
      networkId: ETHEREUM,
      tier: 'FINANCIAL' as const,
      selector: 'finalized' as const,
    };
    const solanaRequest = {
      accountId,
      walletId: solanaWalletId,
      networkId: SOLANA,
      tier: 'FINANCIAL' as const,
      selector: 'finalized' as const,
    };
    deploymentAwareEvidence = Object.freeze([
      await coordinator.readCurrentAgreement(ethereumRequest, INERT_BALANCE_SYNC_EXECUTION_CONTEXT),
      await coordinator.readCurrentAgreement(solanaRequest, INERT_BALANCE_SYNC_EXECUTION_CONTEXT),
    ]);
    evidence = Object.freeze([
      legacyAgreementEnvelopeV1(ethereumRequest, now),
      legacyAgreementEnvelopeV1(solanaRequest, now),
    ]);
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await adminPool.end();
    }
  });

  it('accepts genuine V1 Ethereum and Solana migration fixtures and preserves them intact', async () => {
    for (const envelope of evidence) {
      await expect(
        operationPool.query(
          'SELECT * FROM record_balance_sync_financial_agreement_evidence($1::jsonb)',
          [envelope],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            record_outcome: 'RECORDED',
            recorded_agreement_fingerprint_sha256: envelope.agreement.agreementFingerprintSha256,
          },
        ],
      });
    }
    const stored = await operationPool.query<{
      agreement_fingerprint_sha256: string;
      network_id: string;
      tier: string;
      selector: string;
      may_persist: boolean;
      may_authorize_financial_action: boolean;
      agreement_envelope: LegacyMainnetBalanceAgreementEnvelopeV1;
    }>(
      `SELECT agreement_fingerprint_sha256, network_id, tier, selector,
              may_persist, may_authorize_financial_action, agreement_envelope
       FROM balance_sync_financial_agreement_evidence ORDER BY network_id`,
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.map(({ network_id }) => network_id).sort()).toEqual(
      [ETHEREUM, SOLANA].sort(),
    );
    for (const row of stored.rows) {
      const expected = evidence.find(
        ({ agreement }) =>
          agreement.agreementFingerprintSha256 === row.agreement_fingerprint_sha256,
      );
      expect(row).toMatchObject({
        tier: 'FINANCIAL',
        selector: 'finalized',
        may_persist: false,
        may_authorize_financial_action: false,
        agreement_envelope: expected,
      });
    }
  });

  it('rejects coordinator-produced deployment-aware V2 envelopes at the untouched V1 boundary', async () => {
    for (const envelope of deploymentAwareEvidence) {
      await expect(
        operationPool.query<{ valid: boolean }>(
          `SELECT mainnet_balance_financial_agreement_envelope_valid(
             $1::jsonb,
             pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
           ) AS valid`,
          [envelope],
        ),
      ).resolves.toMatchObject({ rows: [{ valid: false }] });
      await expect(
        operationPool.query(
          'SELECT * FROM record_balance_sync_financial_agreement_evidence($1::jsonb)',
          [envelope],
        ),
      ).rejects.toMatchObject({ code: '22023' });
    }
  });

  it('returns an exact replay and rejects same-key conflict or recomputed-hash tampering', async () => {
    const envelope = evidence[0];
    if (!envelope) throw new Error('Ethereum agreement fixture is missing');
    await expect(
      operationPool.query(
        'SELECT * FROM record_balance_sync_financial_agreement_evidence($1::jsonb)',
        [envelope],
      ),
    ).resolves.toMatchObject({ rows: [{ record_outcome: 'IDEMPOTENT_REPLAY' }] });

    const sameKeyConflict = structuredClone(envelope) as unknown as Record<string, unknown>;
    sameKeyConflict.use = 'CONFLICT';
    await expect(
      operationPool.query(
        'SELECT * FROM record_balance_sync_financial_agreement_evidence($1::jsonb)',
        [sameKeyConflict],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const invalidHash = structuredClone(envelope) as unknown as {
      agreement: { agreementFingerprintSha256: string };
    };
    invalidHash.agreement.agreementFingerprintSha256 = randomBytes(32).toString('hex');
    await expect(
      operationPool.query(
        'SELECT * FROM record_balance_sync_financial_agreement_evidence($1::jsonb)',
        [invalidHash],
      ),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('rejects timestamp normalization tricks and all-zero fingerprints', async () => {
    const envelope = evidence[0];
    if (!envelope) throw new Error('Ethereum agreement fixture is missing');
    const invalidTimestamp = structuredClone(envelope) as unknown as {
      observationCandidate: { source: { retrievedAt: string } };
    };
    invalidTimestamp.observationCandidate.source.retrievedAt = `${invalidTimestamp.observationCandidate.source.retrievedAt.slice(0, 10)}T24:00:00.000Z`;
    const zeroFingerprint = structuredClone(envelope) as unknown as {
      agreement: { sourcePairRegistryFingerprintSha256: string };
    };
    zeroFingerprint.agreement.sourcePairRegistryFingerprintSha256 = '0'.repeat(64);
    for (const invalidEnvelope of [invalidTimestamp, zeroFingerprint]) {
      await expect(
        operationPool.query<{ valid: boolean }>(
          `SELECT mainnet_balance_financial_agreement_envelope_valid(
             $1::jsonb,
             pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
           ) AS valid`,
          [invalidEnvelope],
        ),
      ).resolves.toMatchObject({ rows: [{ valid: false }] });
    }
  });

  it('rejects JSON nulls at every scalar envelope depth', async () => {
    const envelope = evidence[0];
    if (!envelope) throw new Error('Ethereum agreement fixture is missing');
    const nullEnvelopes = [
      (() => {
        const value = structuredClone(envelope) as unknown as { use: unknown };
        value.use = null;
        return value;
      })(),
      (() => {
        const value = structuredClone(envelope) as unknown as {
          observationCandidate: { tier: unknown };
        };
        value.observationCandidate.tier = null;
        return value;
      })(),
      (() => {
        const value = structuredClone(envelope) as unknown as {
          observationCandidate: { source: { selector: unknown } };
        };
        value.observationCandidate.source.selector = null;
        return value;
      })(),
      ...(['positionId', 'stablecoin', 'assetIdentity', 'amountAtomic'] as const).map((field) => {
        const value = structuredClone(envelope) as unknown as {
          observationCandidate: {
            positions: Array<Record<typeof field, unknown>>;
          };
        };
        const position = value.observationCandidate.positions[0];
        if (!position) throw new Error('Ethereum position fixture is missing');
        position[field] = null;
        return value;
      }),
      (() => {
        const value = structuredClone(envelope) as unknown as {
          agreement: { sourceAttestations: Array<{ checkpoint: { kind: unknown } }> };
        };
        const attestation = value.agreement.sourceAttestations[0];
        if (!attestation) throw new Error('Primary attestation fixture is missing');
        attestation.checkpoint.kind = null;
        return value;
      })(),
    ];

    for (const invalidEnvelope of nullEnvelopes) {
      await expect(
        operationPool.query<{ valid: boolean }>(
          `SELECT mainnet_balance_financial_agreement_envelope_valid(
             $1::jsonb,
             pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
           ) AS valid`,
          [invalidEnvelope],
        ),
      ).resolves.toMatchObject({ rows: [{ valid: false }] });
    }
  });

  it('denies runtime access and all mutation paths and refuses used rollback', async () => {
    for (const role of [
      PRODUCTION_DATABASE_PRINCIPALS.apiRuntimeRole,
      PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole,
      PRODUCTION_DATABASE_PRINCIPALS.legacyRuntimeRole,
      PRODUCTION_DATABASE_PRINCIPALS.migrationRole,
    ]) {
      await expect(
        queryAsRole(operationPool, role, 'SELECT * FROM balance_sync_financial_agreement_evidence'),
      ).rejects.toBeDefined();
      await expect(
        queryAsRole(
          operationPool,
          role,
          'SELECT * FROM record_balance_sync_financial_agreement_evidence($1::jsonb)',
          [evidence[0]],
        ),
      ).rejects.toBeDefined();
    }
    await expect(
      operationPool.query(
        'UPDATE balance_sync_financial_agreement_evidence SET recorded_at = recorded_at',
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      operationPool.query('TRUNCATE balance_sync_financial_agreement_evidence'),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(runner.down(1)).rejects.toThrow(
      'cannot roll back mainnet balance financial agreement evidence after use',
    );
  });

  it('keeps the cumulative verifier valid with stablecoin ingestion still suspended', async () => {
    await expect(
      operationPool.query<{ valid: boolean }>(
        createMainnetBalanceAgreementEvidenceTestSchemaMigrationV0027.verifySql ??
          'SELECT false AS valid',
      ),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
    expect(
      await operationPool.query<{ worker_can_record_price: boolean }>(
        `SELECT pg_catalog.has_function_privilege(
          $1, 'record_stablecoin_price_evidence(uuid,text,text,timestamp with time zone,text,text,text,smallint,text,text,text,text,smallint,text,text,numeric,text,timestamp with time zone,timestamp with time zone,numeric,smallint,text,numeric,smallint,text,text,text)',
          'EXECUTE'
        ) AS worker_can_record_price`,
        [PRODUCTION_DATABASE_PRINCIPALS.workerRuntimeRole],
      ),
    ).toMatchObject({ rows: [{ worker_can_record_price: false }] });
  });
});
