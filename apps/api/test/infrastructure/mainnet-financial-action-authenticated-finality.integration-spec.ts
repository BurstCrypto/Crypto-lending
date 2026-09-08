import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResultRow } from 'pg';
import { Pool } from 'pg';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../src/blockchain/domain/supported-asset-registry';
import { MigrationRunner } from '../../src/infrastructure/database/migration-runner.service';
import {
  DATABASE_TEST_SCHEMA_MIGRATION_LIST,
  type DatabaseMigration,
} from '../../src/infrastructure/database/migrations';
import {
  createWalletRegistrationKey,
  digestWalletIdentity,
  type WalletRegistrationDigestReference,
} from '../../src/wallets/infrastructure/crypto/wallet-registration-crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const runInfrastructureIntegration = process.env.RUN_INFRASTRUCTURE_INTEGRATION === '1';
const describeWithPostgres =
  testDatabaseUrl && runInfrastructureIntegration ? describe : describe.skip;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const MIGRATIONS_THROUGH_0035 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id <= '0035',
);
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const PROVIDER_SOURCE_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const PREPARE_LIFECYCLE_SQL = `SELECT *
  FROM prepare_mainnet_financial_action_lifecycle_v2(
    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid,
    $8::text, $9::text, $10::uuid, $11::text, $12::text, $13::text, $14::text,
    $15::integer, $16::text, $17::text, $18::text, $19::smallint, $20::text,
    $21::text, $22::text, $23::text, $24::integer, $25::text, $26::text,
    $27::text, $28::timestamptz, $29::timestamptz, $30::uuid,
    $31::smallint[], $32::text[]
  )`;
const EVIDENCE_ARGUMENT_CASTS = Object.freeze([
  'text',
  'text',
  'text',
  'text',
  'text',
  'jsonb',
  'jsonb',
  'timestamptz',
  'timestamptz',
  'jsonb',
  'timestamptz',
  'jsonb',
  'timestamptz',
  'text',
  'text',
  'text',
  'text',
  'text',
  'text',
  'text',
  'text',
  'text',
  'timestamptz',
] as const);
const EVIDENCE_ARGUMENT_SQL = EVIDENCE_ARGUMENT_CASTS.map(
  (cast, index) => `$${index + 1}::${cast}`,
).join(', ');
const PREPARE_EVIDENCE_SQL = `SELECT *
  FROM prepare_provider_position_chain_anchor_record_intent(
    ${EVIDENCE_ARGUMENT_SQL}, $24::timestamptz
  )`;
const RECORD_ADMISSION_SQL = `SELECT *
  FROM record_authenticated_mainnet_financial_action_reconciliation_v1(
    $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid, $6::text, $7::text,
    $8::numeric, $9::text, $10::numeric, $11::text, $12::text, $13::uuid,
    $14::text, $15::uuid, $16::text, $17::text, $18::text, $19::text,
    $20::text, $21::text, $22::timestamptz, $23::timestamptz, $24::uuid
  )`;
const RECORD_REVIEW_SQL = `SELECT *
  FROM record_mainnet_financial_action_post_finality_review_v1(
    $1::uuid, $2::uuid, $3::bigint, $4::text, $5::bigint, $6::text,
    $7::uuid, $8::text, $9::text, $10::text, $11::numeric, $12::text,
    $13::numeric, $14::text, $15::text, $16::uuid, $17::text, $18::uuid,
    $19::text, $20::text, $21::text, $22::text, $23::timestamptz,
    $24::timestamptz, $25::uuid
  )`;

type Queryable = Pick<PoolClient, 'query'>;
type NetworkId = typeof ETHEREUM | typeof SOLANA;

interface NetworkFixture {
  readonly networkId: NetworkId;
  readonly namespace: 'eip155' | 'solana';
  readonly reference: string;
  readonly proofScheme: 'EVM_ERC4361_ERC191' | 'SOLANA_SIWS_SIGN_MESSAGE';
  readonly address: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly assetSymbol: 'USDT' | 'PYUSD';
  readonly assetIdentity: string;
  readonly transactionId: string;
}

interface YieldFixture {
  readonly accountId: string;
  readonly correlationId: string;
  readonly ledgerBookId: string;
  readonly ledgerTransactionId: string;
  readonly operationId: string;
  readonly planReferenceId: string;
  readonly quoteReferenceId: string;
  readonly submissionId: string;
  readonly walletId: string;
}

interface EvidenceFixture {
  readonly network: NetworkFixture;
  readonly values: readonly unknown[];
  readonly producerDeadlineAt: Date;
  readonly sourcePairApprovalId: string;
  readonly sourcePairApprovalExpiresAt: Date;
  readonly transactionPosition: string;
  readonly transactionBlockId: string;
  readonly finalizedPosition: string;
  readonly finalizedBlockId: string;
}

interface EvidenceRow extends QueryResultRow {
  prepared_record_intent_fingerprint_sha256: string;
  prepared_evidence_fingerprint_sha256: string;
}

interface PreparedLifecycleRow extends QueryResultRow {
  lifecycle_revision: string;
  current_snapshot_sha256: string;
}

interface BoundLifecycleRow extends PreparedLifecycleRow {
  lifecycle_stage: string;
}

interface AuthorityFixture {
  readonly sourceAuthorityId: string;
  readonly sourceAuthorityFingerprint: string;
  readonly deploymentAuthorityId: string;
  readonly deploymentAuthorityFingerprint: string;
}

interface LifecycleFixture extends YieldFixture {
  readonly intentId: string;
  readonly boundRevision: string;
  readonly boundSnapshot: string;
  readonly transactionId: string;
  readonly network: NetworkFixture;
}

interface AdmissionRow extends QueryResultRow {
  admission_outcome: 'RECORDED' | 'REPLAYED';
  admission_fingerprint_sha256: string;
  admitted_event_revision: string;
  admitted_transition_fingerprint_sha256: string;
  lifecycle_stage: string;
  current_snapshot_sha256: string;
}

interface ReviewRow extends QueryResultRow {
  record_outcome: 'RECORDED' | 'REPLAYED';
  review_fingerprint_sha256: string;
  review_revision: string;
  current_review_revision: string;
  current_review_fingerprint_sha256: string;
  current_review_disposition: string;
  effective_safety_state: string;
  requires_manual_review: boolean;
}

function base58(value: Uint8Array): string {
  const digits = [0];
  for (const byte of value) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeros = 0;
  while (value[zeros] === 0) zeros += 1;
  return (
    '1'.repeat(zeros) +
    (digits.length === 1 && digits[0] === 0 ? [] : digits)
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit] ?? '')
      .join('')
  );
}

const ETHEREUM_FIXTURE: NetworkFixture = Object.freeze({
  networkId: ETHEREUM,
  namespace: 'eip155',
  reference: '1',
  proofScheme: 'EVM_ERC4361_ERC191',
  address: '0x1111111111111111111111111111111111111111',
  providerId: 'aave',
  protocolId: 'aave-v3',
  marketId: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
  assetSymbol: 'USDT',
  assetIdentity: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  transactionId: `0x${'a1'.repeat(32)}`,
});

const SOLANA_FIXTURE: NetworkFixture = Object.freeze({
  networkId: SOLANA,
  namespace: 'solana',
  reference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  proofScheme: 'SOLANA_SIWS_SIGN_MESSAGE',
  address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  providerId: 'kamino',
  protocolId: 'kamino-lend',
  marketId: '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
  assetSymbol: 'PYUSD',
  assetIdentity: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  transactionId: base58(new Uint8Array(64).fill(7)),
});

function fingerprint(label: string = randomUUID()): string {
  return createHash('sha256').update(label, 'utf8').digest('hex');
}

async function requiredRow<Row extends QueryResultRow>(
  queryable: Queryable,
  sql: string,
  values: readonly unknown[] = [],
): Promise<Row> {
  const result = await queryable.query<Row>(sql, [...values]);
  if (result.rows.length !== 1 || !result.rows[0]) {
    throw new Error('Expected exactly one PostgreSQL row');
  }
  return result.rows[0];
}

async function databaseNow(queryable: Queryable): Promise<Date> {
  const row = await requiredRow<{ database_now: Date }>(
    queryable,
    `SELECT pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp())
       AS database_now`,
  );
  return row.database_now;
}

function walletDigest(network: NetworkFixture): WalletRegistrationDigestReference<'address'> {
  const key = createWalletRegistrationKey(
    'identity-hmac',
    1,
    randomBytes(32).toString('base64url'),
    `finality-integration-${network.namespace}-${randomBytes(4).toString('hex')}`,
  );
  return digestWalletIdentity(key, network.networkId, network.address);
}

async function registerWallet(
  queryable: Queryable,
  accountId: string,
  network: NetworkFixture,
  addressDigest: WalletRegistrationDigestReference<'address'>,
): Promise<string> {
  const challengeId = randomUUID();
  const walletId = randomUUID();
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const addressDigestBytes = Buffer.from(addressDigest.value, 'hex');
  await queryable.query(
    `INSERT INTO wallet_ownership_challenges (
       challenge_id, account_id, proof_scheme, chain_namespace, chain_reference,
       registry_environment, registry_version, registry_fingerprint_sha256,
       address_digest_version, address_digest, domain_digest_version, domain_digest,
       message_digest_version, message_digest, nonce_digest_version, nonce_digest,
       status, created_at, issued_at, expires_at, completed_at, payload_destroyed_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'MAINNET', $6, $7, $8, $9,
       1, $10, 1, $11, 1, $12, 'REGISTERED',
       statement_timestamp() - interval '2 minutes',
       statement_timestamp() - interval '2 minutes',
       statement_timestamp() + interval '5 minutes',
       statement_timestamp() - interval '1 minute',
       statement_timestamp() - interval '1 minute'
     )`,
    [
      challengeId,
      accountId,
      network.proofScheme,
      network.namespace,
      network.reference,
      registry.version,
      registry.fingerprintSha256,
      addressDigest.version,
      addressDigestBytes,
      randomBytes(32),
      randomBytes(32),
      randomBytes(32),
    ],
  );
  await queryable.query(
    `INSERT INTO wallet_ownership_challenge_identity_digests (
       challenge_id, account_id, chain_namespace, chain_reference,
       address_digest_version, address_digest
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      challengeId,
      accountId,
      network.namespace,
      network.reference,
      addressDigest.version,
      addressDigestBytes,
    ],
  );
  await queryable.query(
    `INSERT INTO registered_wallets (
       wallet_id, account_id, registered_by_challenge_id,
       chain_namespace, chain_reference,
       registry_environment, registry_version, registry_fingerprint_sha256,
       address_digest_version, address_digest,
       address_key_version, address_ciphertext, address_iv, address_auth_tag,
       metadata_key_version, metadata_ciphertext, metadata_iv, metadata_auth_tag
     ) VALUES (
       $1, $2, $3, $4, $5, 'MAINNET', $6, $7, $8, $9,
       1, $10, $11, $12, 1, $13, $14, $15
     )`,
    [
      walletId,
      accountId,
      challengeId,
      network.namespace,
      network.reference,
      registry.version,
      registry.fingerprintSha256,
      addressDigest.version,
      addressDigestBytes,
      Buffer.from('authenticated-finality-address'),
      randomBytes(12),
      randomBytes(16),
      Buffer.from('authenticated-finality-metadata'),
      randomBytes(12),
      randomBytes(16),
    ],
  );
  return walletId;
}

async function withForcedDeferredConstraints<Row>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<Row>,
): Promise<Row> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function transitionYieldOperation(
  queryable: Queryable,
  fixture: Omit<YieldFixture, 'submissionId'>,
  expectedState: string,
  nextState: string,
  reason: string,
  effectiveAt: Date,
): Promise<{ submission_id: string | null; transition_recorded_at: Date }> {
  return requiredRow(
    queryable,
    `SELECT transitioned.* FROM transition_yield_operation(
       $1::uuid, $2::uuid, $3::text, $4::text, $5::text,
       $6::timestamptz, NULL::uuid, $7::uuid, 1::smallint,
       $8::text, 1::smallint, $9::text
     ) AS transitioned`,
    [
      fixture.accountId,
      fixture.operationId,
      expectedState,
      nextState,
      reason,
      effectiveAt,
      fixture.correlationId,
      fingerprint(),
      fingerprint(),
    ],
  );
}

async function provisionSubmittedYieldFixture(
  pool: Pool,
  network: NetworkFixture,
): Promise<{ fixture: YieldFixture; addressDigest: WalletRegistrationDigestReference<'address'> }> {
  const accountId = randomUUID();
  const ledgerTransactionId = randomUUID();
  const ledgerBook = await requiredRow<{ book_id: string }>(
    pool,
    "SELECT book_id FROM ledger_books WHERE book_code = 'OPERATIONAL_MEMO'",
  );
  await pool.query("INSERT INTO accounts (account_id, eligibility_status) VALUES ($1, 'UNKNOWN')", [
    accountId,
  ]);
  await pool.query(
    `INSERT INTO ledger_transactions (
       transaction_id, tenant_account_id, book_id, intent_type,
       configuration_revision_reference_id
     ) VALUES ($1, $2, $3, 'DIRECT_SETTLEMENT', $4)`,
    [ledgerTransactionId, accountId, ledgerBook.book_id, randomUUID()],
  );
  const addressDigest = walletDigest(network);
  const walletId = await registerWallet(pool, accountId, network, addressDigest);
  const base = {
    accountId,
    correlationId: randomUUID(),
    ledgerBookId: ledgerBook.book_id,
    ledgerTransactionId,
    operationId: randomUUID(),
    planReferenceId: randomUUID(),
    quoteReferenceId: randomUUID(),
    walletId,
  };
  const now = await databaseNow(pool);
  const at = (offset: number): Date => new Date(now.getTime() - 60_000 + offset);
  await requiredRow(
    pool,
    `SELECT created.* FROM create_yield_operation(
       $1::uuid, $2::uuid, 'ALLOCATE', $3::uuid, $4::uuid, $5::uuid,
       $6::timestamptz, $7::uuid, 1::smallint, $8::text, 1::smallint, $9::text
     ) AS created`,
    [
      base.accountId,
      base.operationId,
      base.ledgerTransactionId,
      base.planReferenceId,
      base.quoteReferenceId,
      at(0),
      base.correlationId,
      fingerprint(),
      fingerprint(),
    ],
  );
  await transitionYieldOperation(pool, base, 'CREATED', 'QUOTED', 'QUOTE_CREATED', at(1_000));
  await transitionYieldOperation(
    pool,
    base,
    'QUOTED',
    'USER_APPROVED',
    'USER_APPROVAL_RECORDED',
    at(2_000),
  );
  const submitted = await withForcedDeferredConstraints(pool, async (client) => {
    const row = await transitionYieldOperation(
      client,
      base,
      'USER_APPROVED',
      'SUBMITTED',
      'SUBMISSION_RECORDED',
      at(3_000),
    );
    if (!row.submission_id) throw new Error('Yield submission was not created');
    await client.query(
      `SELECT enqueue_reviewed_job_v1(
         $1::text, 'jobs'::text, $2::jsonb, $3::jsonb, NULL::text, NULL::text
       )`,
      [
        row.submission_id,
        {
          id: row.submission_id,
          kind: 'yield.operation.submit',
          version: 1,
          occurredAt: row.transition_recorded_at.toISOString(),
          correlation: {
            correlationId: base.correlationId,
            initiatorActorId: base.accountId,
            quoteId: base.quoteReferenceId,
            transactionId: base.ledgerTransactionId,
          },
          payload: {
            submissionId: row.submission_id,
            operationId: base.operationId,
            operationType: 'ALLOCATE',
            ledgerTransactionId: base.ledgerTransactionId,
            planReferenceId: base.planReferenceId,
            quoteReferenceId: base.quoteReferenceId,
          },
        },
        { operationType: 'ALLOCATE' },
      ],
    );
    return row;
  });
  if (!submitted.submission_id) throw new Error('Yield submission was not created');
  return { fixture: { ...base, submissionId: submitted.submission_id }, addressDigest };
}

async function prepareAndBindLifecycle(
  pool: Pool,
  network: NetworkFixture,
): Promise<LifecycleFixture> {
  const { fixture, addressDigest } = await provisionSubmittedYieldFixture(pool, network);
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const intentId = randomUUID();
  const now = await databaseNow(pool);
  const prepared = await requiredRow<PreparedLifecycleRow>(pool, PREPARE_LIFECYCLE_SQL, [
    intentId,
    fixture.accountId,
    fixture.operationId,
    fixture.submissionId,
    fixture.ledgerTransactionId,
    fixture.ledgerBookId,
    fixture.walletId,
    fingerprint(),
    fingerprint(),
    randomUUID(),
    network.networkId,
    network.providerId,
    network.protocolId,
    network.marketId,
    registry.version,
    registry.fingerprintSha256,
    network.assetSymbol,
    network.assetIdentity,
    6,
    'SUPPLY',
    '1000000',
    '1000000',
    '1000000000000000',
    100,
    '10000000000000000',
    'EXACT',
    '1000000',
    new Date(now.getTime() - 1_000),
    new Date(now.getTime() + 240_000),
    randomUUID(),
    [addressDigest.version],
    [addressDigest.value],
  ]);
  const signedAt = await databaseNow(pool);
  const bound = await requiredRow<BoundLifecycleRow>(
    pool,
    `SELECT * FROM bind_mainnet_financial_action_submission(
       $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text,
       $6::text, $7::text, $8::timestamptz, $9::uuid
     )`,
    [
      fixture.accountId,
      intentId,
      prepared.lifecycle_revision,
      prepared.current_snapshot_sha256,
      network.transactionId,
      fingerprint(),
      fingerprint(),
      signedAt,
      randomUUID(),
    ],
  );
  if (bound.lifecycle_stage !== 'WALLET_SIGNED_SUBMISSION_BOUND') {
    throw new Error('Lifecycle did not reach the signed-submission boundary');
  }
  return {
    ...fixture,
    intentId,
    boundRevision: bound.lifecycle_revision,
    boundSnapshot: bound.current_snapshot_sha256,
    transactionId: network.transactionId,
    network,
  };
}

let evidenceSequence = 0;

async function recordChainEvidence(
  pool: Pool,
  network: NetworkFixture,
  overrides: Readonly<{
    transactionPosition?: string;
    transactionBlockId?: string;
    finalizedPosition?: string;
    finalizedBlockId?: string;
  }> = {},
): Promise<EvidenceFixture & { evidenceFingerprint: string }> {
  evidenceSequence += 1;
  const now = await databaseNow(pool);
  const defaultPosition =
    network.networkId === ETHEREUM
      ? 20_000_000n + BigInt(evidenceSequence * 100)
      : 440_000_000n + BigInt(evidenceSequence * 100);
  const transactionPosition = overrides.transactionPosition ?? defaultPosition.toString();
  const transactionBlockId =
    overrides.transactionBlockId ??
    (network.networkId === ETHEREUM
      ? `0x${fingerprint(`eth-anchor-${evidenceSequence}`)}`
      : base58(new Uint8Array(32).fill(10 + evidenceSequence)));
  const finalizedPosition =
    overrides.finalizedPosition ?? (BigInt(transactionPosition) + 5n).toString();
  const finalizedBlockId =
    overrides.finalizedBlockId ??
    (network.networkId === ETHEREUM
      ? `0x${fingerprint(`eth-finalized-${evidenceSequence}`)}`
      : base58(new Uint8Array(32).fill(30 + evidenceSequence)));
  const currentPosition = (BigInt(finalizedPosition) + 5n).toString();
  const sourcePairApprovalId = `approval-${evidenceSequence}`;
  const sourcePairApprovalExpiresAt = new Date(now.getTime() + 240_000);
  const producerDeadlineAt = new Date(now.getTime() + 20_000);
  const continuityFloor =
    network.networkId === ETHEREUM
      ? {
          kind: 'EVM_BLOCK',
          blockNumber: (BigInt(transactionPosition) - 1n).toString(),
          blockHash: `0x${fingerprint(`eth-floor-${evidenceSequence}`)}`,
        }
      : {
          kind: 'SOLANA_SLOT',
          slot: (BigInt(transactionPosition) - 1n).toString(),
          root: (BigInt(transactionPosition) - 5n).toString(),
        };
  const chainAnchor =
    network.networkId === ETHEREUM
      ? { kind: 'EVM_BLOCK', blockNumber: transactionPosition, blockHash: transactionBlockId }
      : {
          kind: 'SOLANA_SLOT',
          slot: transactionPosition,
          root: (BigInt(transactionPosition) - 3n).toString(),
        };
  const agreedCurrentHead =
    network.networkId === ETHEREUM
      ? {
          kind: 'EVM_BLOCK',
          blockNumber: currentPosition,
          blockHash: `0x${fingerprint(`eth-current-${evidenceSequence}`)}`,
        }
      : { kind: 'SOLANA_SLOT', slot: currentPosition, root: finalizedPosition };
  const agreedFinalizedHead =
    network.networkId === ETHEREUM
      ? {
          kind: 'EVM_BLOCK',
          blockNumber: finalizedPosition,
          blockHash: finalizedBlockId,
        }
      : { kind: 'SOLANA_SLOT', slot: finalizedPosition, root: finalizedPosition };
  const values = [
    network.networkId,
    'family-a',
    'source-a',
    'RPC',
    network.networkId === ETHEREUM
      ? `ethereum-block-${transactionPosition}`
      : `solana-slot-${transactionPosition}`,
    continuityFloor,
    chainAnchor,
    new Date(now.getTime() - 2_000),
    new Date(now.getTime() - 1_000),
    agreedCurrentHead,
    new Date(now.getTime() - 1_500),
    agreedFinalizedHead,
    new Date(now.getTime() - 1_500),
    fingerprint(`identity-proof-${evidenceSequence}`),
    fingerprint(`capability-proof-${evidenceSequence}`),
    fingerprint(`lineage-proof-${evidenceSequence}`),
    'family-a',
    'source-a',
    'family-b',
    'source-b',
    sourcePairApprovalId,
    PROVIDER_SOURCE_REGISTRY_FINGERPRINT,
    sourcePairApprovalExpiresAt,
  ] as const;
  const prepared = await requiredRow<EvidenceRow>(pool, PREPARE_EVIDENCE_SQL, [
    ...values,
    producerDeadlineAt,
  ]);
  const dispatchToken = randomBytes(32);
  await pool.query(
    `SELECT * FROM claim_provider_position_chain_anchor_record_dispatch(
       $1::text, $2::bytea
     )`,
    [prepared.prepared_record_intent_fingerprint_sha256, dispatchToken],
  );
  await pool.query(
    `SELECT * FROM execute_provider_position_chain_anchor_record_intent(
       $1::text, $2::bytea
     )`,
    [prepared.prepared_record_intent_fingerprint_sha256, dispatchToken],
  );
  return {
    network,
    values,
    producerDeadlineAt,
    sourcePairApprovalId,
    sourcePairApprovalExpiresAt,
    transactionPosition,
    transactionBlockId,
    finalizedPosition,
    finalizedBlockId,
    evidenceFingerprint: prepared.prepared_evidence_fingerprint_sha256,
  };
}

async function installAuthorities(
  pool: Pool,
  lifecycle: LifecycleFixture,
  evidence: EvidenceFixture,
): Promise<AuthorityFixture> {
  const sourceAuthorityId = randomUUID();
  const deploymentAuthorityId = randomUUID();
  const recordedAt = await databaseNow(pool);
  const sourceApprovedAt = new Date(recordedAt.getTime() - 5_000);
  const deploymentApprovedAt = new Date(recordedAt.getTime() - 4_000);
  const sourceExpiresAt = new Date(evidence.sourcePairApprovalExpiresAt.getTime() + 30_000);
  const deploymentExpiresAt = new Date(evidence.sourcePairApprovalExpiresAt.getTime() + 20_000);
  const sourceAuthorityFingerprint = (
    await requiredRow<{ value: string }>(
      pool,
      `SELECT mainnet_action_authenticated_finality_fingerprint_v1(
         'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_SOURCE_AUTHORITY:FRAMED:v1',
         ARRAY[
           'fingerprintEncodingVersion', 'sourceAuthorityId', 'authorityUse', 'networkId',
           'primarySourceFamilyId', 'primarySourceId', 'primarySourceKind',
           'corroboratingSourceFamilyId', 'corroboratingSourceId',
           'corroboratingSourceKind', 'sourcePairApprovalId',
           'sourcePairRegistryFingerprintSha256',
           'approvedAtEpochMilliseconds', 'expiresAtEpochMilliseconds'
         ]::text[],
         ARRAY[
           '1', $1::uuid::text,
           'MAINNET_FINANCIAL_ACTION_RECONCILIATION_SOURCE_ONLY', $2::text,
           'family-a', 'source-a', 'RPC', 'family-b', 'source-b', 'RPC',
           $3::text, $4::text,
           ((pg_catalog.date_part('epoch', $5::timestamptz) * 1000)::bigint)::text,
           ((pg_catalog.date_part('epoch', $6::timestamptz) * 1000)::bigint)::text
         ]::text[]
       ) AS value`,
      [
        sourceAuthorityId,
        lifecycle.network.networkId,
        evidence.sourcePairApprovalId,
        PROVIDER_SOURCE_REGISTRY_FINGERPRINT,
        sourceApprovedAt,
        sourceExpiresAt,
      ],
    )
  ).value;
  await pool.query(
    `INSERT INTO mainnet_financial_action_reconciliation_source_authorities (
       source_authority_id, authority_fingerprint_sha256, authority_version,
       authority_use, network_id, primary_source_family_id, primary_source_id,
       primary_source_kind, corroborating_source_family_id, corroborating_source_id,
       corroborating_source_kind, source_pair_approval_id,
       source_pair_registry_fingerprint_sha256, approved_at, expires_at, recorded_at,
       may_authorize_financial_action
     ) VALUES (
       $1, $2, 1, 'MAINNET_FINANCIAL_ACTION_RECONCILIATION_SOURCE_ONLY', $3,
       'family-a', 'source-a', 'RPC', 'family-b', 'source-b', 'RPC', $4, $5,
       $6, $7, $8, false
     )`,
    [
      sourceAuthorityId,
      sourceAuthorityFingerprint,
      lifecycle.network.networkId,
      evidence.sourcePairApprovalId,
      PROVIDER_SOURCE_REGISTRY_FINGERPRINT,
      sourceApprovedAt,
      sourceExpiresAt,
      recordedAt,
    ],
  );

  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const manifestDigests = [fingerprint(), fingerprint(), fingerprint(), fingerprint()] as const;
  const deploymentAuthorityFingerprint = (
    await requiredRow<{ value: string }>(
      pool,
      `SELECT mainnet_action_authenticated_finality_fingerprint_v1(
         'CRYPTO_LENDING:MAINNET_ACTION:RECONCILIATION_DEPLOYMENT_AUTHORITY:FRAMED:v1',
         ARRAY[
           'fingerprintEncodingVersion', 'deploymentAuthorityId', 'sourceAuthorityId',
           'sourceAuthorityFingerprintSha256', 'networkId', 'providerId', 'protocolId',
           'marketId', 'assetRegistryVersion', 'assetRegistryFingerprintSha256',
           'assetSymbol', 'assetIdentity', 'assetDecimals', 'actionType',
           'primaryDeploymentManifestFingerprintSha256',
           'primaryObservedIdentityFingerprintSha256',
           'corroboratingDeploymentManifestFingerprintSha256',
           'corroboratingObservedIdentityFingerprintSha256',
           'approvedAtEpochMilliseconds', 'expiresAtEpochMilliseconds'
         ]::text[],
         ARRAY[
           '1', $1::uuid::text, $2::uuid::text, $3::text, $4::text,
           $5::text, $6::text, $7::text, $8::integer::text, $9::text,
           $10::text, $11::text, '6', 'SUPPLY', $12::text, $13::text,
           $14::text, $15::text,
           ((pg_catalog.date_part('epoch', $16::timestamptz) * 1000)::bigint)::text,
           ((pg_catalog.date_part('epoch', $17::timestamptz) * 1000)::bigint)::text
         ]::text[]
       ) AS value`,
      [
        deploymentAuthorityId,
        sourceAuthorityId,
        sourceAuthorityFingerprint,
        lifecycle.network.networkId,
        lifecycle.network.providerId,
        lifecycle.network.protocolId,
        lifecycle.network.marketId,
        registry.version,
        registry.fingerprintSha256,
        lifecycle.network.assetSymbol,
        lifecycle.network.assetIdentity,
        ...manifestDigests,
        deploymentApprovedAt,
        deploymentExpiresAt,
      ],
    )
  ).value;
  await pool.query(
    `INSERT INTO mainnet_financial_action_reconciliation_deployment_authorities (
       deployment_authority_id, authority_fingerprint_sha256, authority_version,
       authority_use, source_authority_id, source_authority_fingerprint_sha256,
       network_id, provider_id, protocol_id, market_id, asset_registry_version,
       asset_registry_fingerprint_sha256, asset_symbol, asset_identity, asset_decimals,
       action_type, primary_deployment_manifest_fingerprint_sha256,
       primary_observed_identity_fingerprint_sha256,
       corroborating_deployment_manifest_fingerprint_sha256,
       corroborating_observed_identity_fingerprint_sha256,
       approved_at, expires_at, recorded_at, may_authorize_financial_action
     ) VALUES (
       $1, $2, 1, 'MAINNET_FINANCIAL_ACTION_RECONCILIATION_DEPLOYMENT_ONLY',
       $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 6, 'SUPPLY',
       $13, $14, $15, $16, $17, $18, $19, false
     )`,
    [
      deploymentAuthorityId,
      deploymentAuthorityFingerprint,
      sourceAuthorityId,
      sourceAuthorityFingerprint,
      lifecycle.network.networkId,
      lifecycle.network.providerId,
      lifecycle.network.protocolId,
      lifecycle.network.marketId,
      registry.version,
      registry.fingerprintSha256,
      lifecycle.network.assetSymbol,
      lifecycle.network.assetIdentity,
      ...manifestDigests,
      deploymentApprovedAt,
      deploymentExpiresAt,
      recordedAt,
    ],
  );
  return {
    sourceAuthorityId,
    sourceAuthorityFingerprint,
    deploymentAuthorityId,
    deploymentAuthorityFingerprint,
  };
}

async function admissionValues(
  pool: Pool,
  lifecycle: LifecycleFixture,
  evidence: EvidenceFixture & { evidenceFingerprint: string },
  authority: AuthorityFixture,
  observationId = randomUUID(),
): Promise<unknown[]> {
  const observedAt = await databaseNow(pool);
  return [
    lifecycle.accountId,
    lifecycle.intentId,
    lifecycle.boundRevision,
    lifecycle.boundSnapshot,
    observationId,
    lifecycle.transactionId,
    'FINALIZED_SUCCESS',
    evidence.transactionPosition,
    evidence.transactionBlockId,
    evidence.finalizedPosition,
    evidence.finalizedBlockId,
    evidence.evidenceFingerprint,
    authority.sourceAuthorityId,
    authority.sourceAuthorityFingerprint,
    authority.deploymentAuthorityId,
    authority.deploymentAuthorityFingerprint,
    fingerprint(),
    fingerprint(),
    fingerprint(),
    fingerprint(),
    null,
    observedAt,
    new Date(observedAt.getTime() + 20_000),
    randomUUID(),
  ];
}

async function reviewValues(
  pool: Pool,
  lifecycle: LifecycleFixture,
  admission: AdmissionRow,
  evidence: EvidenceFixture & { evidenceFingerprint: string },
  authority: AuthorityFixture,
  expectedReviewRevision: number,
  previousReviewFingerprint: string | null,
  disposition: 'FINALITY_REAFFIRMED' | 'REVIEW_INCONCLUSIVE' | 'DEEP_REORG_QUARANTINED',
  reviewId = randomUUID(),
): Promise<unknown[]> {
  const observedAt = await databaseNow(pool);
  const lineage =
    disposition === 'FINALITY_REAFFIRMED'
      ? 'CANONICAL'
      : disposition === 'REVIEW_INCONCLUSIVE'
        ? 'UNKNOWN'
        : 'CONFLICT';
  return [
    lifecycle.accountId,
    lifecycle.intentId,
    admission.admitted_event_revision,
    admission.current_snapshot_sha256,
    expectedReviewRevision,
    previousReviewFingerprint,
    reviewId,
    disposition,
    lineage,
    lifecycle.transactionId,
    evidence.transactionPosition,
    evidence.transactionBlockId,
    evidence.finalizedPosition,
    evidence.finalizedBlockId,
    evidence.evidenceFingerprint,
    authority.sourceAuthorityId,
    authority.sourceAuthorityFingerprint,
    authority.deploymentAuthorityId,
    authority.deploymentAuthorityFingerprint,
    fingerprint(),
    fingerprint(),
    fingerprint(),
    observedAt,
    new Date(observedAt.getTime() + 20_000),
    randomUUID(),
  ];
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Authenticated finality integration requires loopback PostgreSQL');
  }
}

function requirePostgres16(serverVersionNum: number | undefined): void {
  if (
    serverVersionNum === undefined ||
    !Number.isInteger(serverVersionNum) ||
    serverVersionNum < 160_000 ||
    serverVersionNum >= 170_000
  ) {
    throw new Error('Authenticated finality integration requires PostgreSQL 16');
  }
}

describeWithPostgres('migration 0035 authenticated mainnet action finality (PostgreSQL 16)', () => {
  jest.setTimeout(180_000);

  const schema = `test_action_finality_${randomUUID().replaceAll('-', '')}`;
  const expectedMigrationIds = MIGRATIONS_THROUGH_0035.map(({ id }) => id);
  let adminPool: Pool | undefined;
  let operationPool: Pool | undefined;
  let runner: MigrationRunner | undefined;
  let schemaCreated = false;

  function requireOperationPool(): Pool {
    if (!operationPool) throw new Error('Authenticated finality operation pool is unavailable');
    return operationPool;
  }

  function requireRunner(): MigrationRunner {
    if (!runner) throw new Error('Authenticated finality runner is unavailable');
    return runner;
  }

  function migration0035(): DatabaseMigration {
    const migration = DATABASE_TEST_SCHEMA_MIGRATION_LIST.find(({ id }) => id === '0035');
    if (!migration?.verifySql) throw new Error('Migration 0035 verifier is unavailable');
    return migration;
  }

  beforeAll(async () => {
    requireLoopback(testDatabaseUrl as string);
    adminPool = new Pool({ connectionString: testDatabaseUrl as string, max: 1 });
    const server = await adminPool.query<{ server_version_num: number }>(
      `SELECT pg_catalog.current_setting('server_version_num')::integer AS server_version_num`,
    );
    requirePostgres16(server.rows[0]?.server_version_num);
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    schemaCreated = true;
    operationPool = new Pool({
      connectionString: testDatabaseUrl as string,
      max: 4,
      options: `-c search_path=${schema}`,
    });
    runner = new MigrationRunner(operationPool, MIGRATIONS_THROUGH_0035);
  });

  afterAll(async () => {
    if (operationPool) await operationPool.end();
    if (adminPool) {
      try {
        if (schemaCreated) {
          await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
        }
      } finally {
        await adminPool.end();
      }
    }
  });

  it('applies, verifies, and leaves every 0035 capability owner-only', async () => {
    const applied = await requireRunner().up();
    expect(applied).toEqual(expectedMigrationIds);
    await expect(requireRunner().assertUpToDate()).resolves.toBeUndefined();
    await expect(
      requireOperationPool().query<{ valid: boolean }>(migration0035().verifySql ?? ''),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
    const identities = [
      'control_mainnet_financial_action_reconciliation_authority_v1(uuid,text,uuid,uuid,text,text,text)',
      'record_authenticated_mainnet_financial_action_reconciliation_v1(uuid,uuid,bigint,text,uuid,text,text,numeric,text,numeric,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid)',
      'record_mainnet_financial_action_post_finality_review_v1(uuid,uuid,bigint,text,bigint,text,uuid,text,text,text,numeric,text,numeric,text,text,uuid,text,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid)',
      'read_mainnet_financial_action_effective_safety_state_v1(uuid,uuid)',
    ];
    const privileges = await requireOperationPool().query<
      QueryResultRow & { any_execute: boolean }
    >(
      `SELECT pg_catalog.bool_or(
          pg_catalog.has_function_privilege(role_name, function_identity, 'EXECUTE')
        ) AS any_execute
       FROM pg_catalog.unnest($1::text[]) AS roles(role_name)
       CROSS JOIN pg_catalog.unnest($2::text[]) AS functions(function_identity)`,
      [
        [
          'public',
          'crypto_api_runtime',
          'crypto_worker_runtime',
          'crypto_runtime',
          'crypto_balance_consumer_runtime',
          'crypto_migration',
        ],
        identities,
      ],
    );
    expect(privileges.rows).toEqual([{ any_execute: false }]);
  });

  it('admits authenticated Ethereum and Solana finality and keeps recovery fail closed', async () => {
    const pool = requireOperationPool();
    for (const network of [ETHEREUM_FIXTURE, SOLANA_FIXTURE]) {
      const lifecycle = await prepareAndBindLifecycle(pool, network);
      const evidence = await recordChainEvidence(pool, network);
      const authority = await installAuthorities(pool, lifecycle, evidence);

      if (network.networkId === SOLANA) {
        const rawClient = await pool.connect();
        try {
          await rawClient.query('BEGIN');
          const observedAt = await databaseNow(rawClient);
          await rawClient.query(
            `SELECT * FROM record_mainnet_financial_action_reconciliation_observation(
               $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid,
               $6::text, 'FINALIZED_SUCCESS'::text, $7::numeric, $8::text,
               $9::numeric, $10::text, $11::text, NULL::text, $12::text,
               $13::timestamptz, $14::uuid
             )`,
            [
              lifecycle.accountId,
              lifecycle.intentId,
              lifecycle.boundRevision,
              lifecycle.boundSnapshot,
              randomUUID(),
              lifecycle.transactionId,
              evidence.transactionPosition,
              evidence.transactionBlockId,
              evidence.finalizedPosition,
              evidence.finalizedBlockId,
              fingerprint(),
              fingerprint(),
              observedAt,
              randomUUID(),
            ],
          );
          await expect(rawClient.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toMatchObject({
            code: '23514',
          });
        } finally {
          await rawClient.query('ROLLBACK').catch(() => undefined);
          rawClient.release();
        }
      }

      const observationId = randomUUID();
      const values = await admissionValues(pool, lifecycle, evidence, authority, observationId);
      if (network.networkId === ETHEREUM) {
        for (const outcome of ['UNKNOWN', 'PENDING'] as const) {
          const mismatched = [...values];
          mismatched[4] = randomUUID();
          mismatched[6] = outcome;
          mismatched[7] = null;
          mismatched[8] = null;
          mismatched[9] = (BigInt(evidence.finalizedPosition) + 1n).toString();
          mismatched[19] = null;
          mismatched[20] = null;
          mismatched[23] = randomUUID();
          await expect(pool.query(RECORD_ADMISSION_SQL, mismatched)).rejects.toMatchObject({
            code: '22023',
          });
        }
      }

      const concurrent = await Promise.all([
        pool.query<AdmissionRow>(RECORD_ADMISSION_SQL, values),
        pool.query<AdmissionRow>(RECORD_ADMISSION_SQL, values),
      ]);
      const outcomes = concurrent.map(({ rows }) => rows[0]?.admission_outcome).sort();
      expect(outcomes).toEqual(['RECORDED', 'REPLAYED']);
      const admission = concurrent
        .flatMap(({ rows }) => rows)
        .find(({ admission_outcome }) => admission_outcome === 'RECORDED');
      if (!admission) throw new Error('Authenticated admission did not record');
      expect(admission).toMatchObject({
        lifecycle_stage: 'FINALIZED_SUCCESS',
        admitted_event_revision: '3',
      });

      const conflictingReplay = [...values];
      conflictingReplay[6] = 'FINALIZED_FAILURE';
      conflictingReplay[19] = null;
      conflictingReplay[20] = fingerprint();
      await expect(pool.query(RECORD_ADMISSION_SQL, conflictingReplay)).rejects.toMatchObject({
        code: '23505',
      });

      if (network.networkId === ETHEREUM) {
        const reaffirmValues = await reviewValues(
          pool,
          lifecycle,
          admission,
          evidence,
          authority,
          0,
          null,
          'FINALITY_REAFFIRMED',
        );
        const concurrentReaffirm = await Promise.all([
          pool.query<ReviewRow>(RECORD_REVIEW_SQL, reaffirmValues),
          pool.query<ReviewRow>(RECORD_REVIEW_SQL, reaffirmValues),
        ]);
        expect(concurrentReaffirm.map(({ rows }) => rows[0]?.record_outcome).sort()).toEqual([
          'RECORDED',
          'REPLAYED',
        ]);
        const reaffirmed = concurrentReaffirm
          .flatMap(({ rows }) => rows)
          .find(({ record_outcome }) => record_outcome === 'RECORDED');
        if (!reaffirmed) throw new Error('Post-finality reaffirmation did not record');
        expect(reaffirmed).toMatchObject({
          record_outcome: 'RECORDED',
          review_revision: '1',
          current_review_revision: '1',
          current_review_disposition: 'FINALITY_REAFFIRMED',
          effective_safety_state: 'AUTHENTICATED_FINALITY_RECORDED',
        });

        const inconclusiveValues = await reviewValues(
          pool,
          lifecycle,
          admission,
          evidence,
          authority,
          1,
          reaffirmed.review_fingerprint_sha256,
          'REVIEW_INCONCLUSIVE',
        );
        const inconclusive = await requiredRow<ReviewRow>(
          pool,
          RECORD_REVIEW_SQL,
          inconclusiveValues,
        );
        expect(inconclusive).toMatchObject({
          review_revision: '2',
          current_review_disposition: 'REVIEW_INCONCLUSIVE',
          effective_safety_state: 'POST_FINALITY_REVIEW_INCONCLUSIVE',
          requires_manual_review: true,
        });
        const historicalReplay = await requiredRow<ReviewRow>(
          pool,
          RECORD_REVIEW_SQL,
          reaffirmValues,
        );
        expect(historicalReplay).toMatchObject({
          record_outcome: 'REPLAYED',
          review_revision: '1',
          current_review_revision: '2',
          current_review_fingerprint_sha256: inconclusive.review_fingerprint_sha256,
          current_review_disposition: 'REVIEW_INCONCLUSIVE',
        });

        const replacementBlock = `0x${fingerprint('authenticated-finality-replacement')}`;
        const replacementEvidence = await recordChainEvidence(pool, network, {
          transactionPosition: evidence.transactionPosition,
          transactionBlockId: replacementBlock,
          finalizedPosition: evidence.transactionPosition,
          finalizedBlockId: replacementBlock,
        });
        const replacementAuthority = await installAuthorities(pool, lifecycle, replacementEvidence);
        const deepValues = await reviewValues(
          pool,
          lifecycle,
          admission,
          replacementEvidence,
          replacementAuthority,
          2,
          inconclusive.review_fingerprint_sha256,
          'DEEP_REORG_QUARANTINED',
        );
        const deep = await requiredRow<ReviewRow>(pool, RECORD_REVIEW_SQL, deepValues);
        expect(deep).toMatchObject({
          review_revision: '3',
          current_review_disposition: 'DEEP_REORG_QUARANTINED',
          effective_safety_state: 'DEEP_REORG_QUARANTINED',
          requires_manual_review: true,
        });

        const forbiddenReaffirm = await reviewValues(
          pool,
          lifecycle,
          admission,
          evidence,
          authority,
          3,
          deep.review_fingerprint_sha256,
          'FINALITY_REAFFIRMED',
        );
        await expect(pool.query(RECORD_REVIEW_SQL, forbiddenReaffirm)).rejects.toMatchObject({
          code: '55000',
        });

        await pool.query(
          `SELECT * FROM control_mainnet_financial_action_reconciliation_authority_v1(
             $1::uuid, 'SOURCE', $2::uuid, NULL::uuid, $3::text,
             'SUSPENDED', 'SECURITY_REVIEW'
           )`,
          [randomUUID(), authority.sourceAuthorityId, authority.sourceAuthorityFingerprint],
        );
        const replayAfterControl = await requiredRow<ReviewRow>(
          pool,
          RECORD_REVIEW_SQL,
          reaffirmValues,
        );
        expect(replayAfterControl).toMatchObject({
          record_outcome: 'REPLAYED',
          review_revision: '1',
          current_review_revision: '3',
          current_review_fingerprint_sha256: deep.review_fingerprint_sha256,
          current_review_disposition: 'DEEP_REORG_QUARANTINED',
          effective_safety_state: 'DEEP_REORG_QUARANTINED',
        });
        await expect(pool.query(RECORD_ADMISSION_SQL, values)).resolves.toMatchObject({
          rows: [{ admission_outcome: 'REPLAYED' }],
        });
        await expect(
          pool.query(
            `SELECT * FROM read_mainnet_financial_action_effective_safety_state_v1(
               $1::uuid, $2::uuid
             )`,
            [lifecycle.accountId, lifecycle.intentId],
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              network_id: ETHEREUM,
              admission_fingerprint_sha256: admission.admission_fingerprint_sha256,
              current_transition_fingerprint_sha256:
                admission.admitted_transition_fingerprint_sha256,
              review_revision: '3',
              review_fingerprint_sha256: deep.review_fingerprint_sha256,
              effective_safety_state: 'DEEP_REORG_QUARANTINED',
              requires_manual_review: true,
              may_authorize_financial_action: false,
              may_resend_transaction: false,
              ledger_settlement_authority: false,
            },
          ],
        });
      } else {
        const controlValues = [
          randomUUID(),
          authority.sourceAuthorityId,
          authority.sourceAuthorityFingerprint,
        ];
        const concurrentControl = await Promise.all([
          pool.query(
            `SELECT * FROM control_mainnet_financial_action_reconciliation_authority_v1(
               $1::uuid, 'SOURCE', $2::uuid, NULL::uuid, $3::text,
               'REVOKED', 'SOURCE_REVOKED'
             )`,
            controlValues,
          ),
          pool.query(
            `SELECT * FROM control_mainnet_financial_action_reconciliation_authority_v1(
               $1::uuid, 'SOURCE', $2::uuid, NULL::uuid, $3::text,
               'REVOKED', 'SOURCE_REVOKED'
             )`,
            controlValues,
          ),
        ]);
        expect(concurrentControl.map(({ rows }) => rows[0]?.record_outcome).sort()).toEqual([
          'RECORDED',
          'REPLAYED',
        ]);
        await expect(pool.query(RECORD_ADMISSION_SQL, values)).resolves.toMatchObject({
          rows: [{ admission_outcome: 'REPLAYED' }],
        });
        await expect(
          pool.query(
            `SELECT * FROM read_mainnet_financial_action_effective_safety_state_v1(
               $1::uuid, $2::uuid
             )`,
            [lifecycle.accountId, lifecycle.intentId],
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              network_id: SOLANA,
              effective_safety_state: 'AUTHORITY_CONTROLLED_QUARANTINED',
              requires_manual_review: true,
            },
          ],
        });
      }
    }
  });

  it.each([
    [
      'column contract',
      `ALTER TABLE mainnet_financial_action_reconciliation_source_authorities
         ALTER COLUMN authority_version DROP NOT NULL`,
    ],
    [
      'check constraint',
      `ALTER TABLE mainnet_financial_action_reconciliation_source_authorities
         DROP CONSTRAINT mainnet_action_reconciliation_source_authority_shape_check`,
    ],
    [
      'append-only trigger',
      `DROP TRIGGER mainnet_action_source_authority_append_row
         ON mainnet_financial_action_reconciliation_source_authorities`,
    ],
    [
      'partial authority-control index',
      `DROP INDEX mainnet_action_authority_control_source_active_idx`,
    ],
  ])('rejects representative %s catalog tampering', async (_label, tamperSql) => {
    const client = await requireOperationPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(tamperSql);
      const verification = await client.query<{ valid: boolean }>(migration0035().verifySql ?? '');
      expect(verification.rows).toEqual([{ valid: false }]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
