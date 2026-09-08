import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
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
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const PROVIDER_SOURCE_REGISTRY_FINGERPRINT =
  '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MIGRATIONS_THROUGH_0037 = DATABASE_TEST_SCHEMA_MIGRATION_LIST.filter(
  ({ id }) => id <= '0037',
);
const FUNCTIONS = Object.freeze([
  'record_authenticated_mainnet_financial_action_reconciliation_v2(uuid,uuid,bigint,text,uuid,text,text,numeric,text,numeric,text,text,uuid,text,uuid,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid)',
  'record_mainnet_financial_action_post_finality_review_v2(uuid,uuid,bigint,text,bigint,text,uuid,text,text,text,numeric,text,numeric,text,text,uuid,text,uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,uuid)',
]);
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
  FROM record_authenticated_mainnet_financial_action_reconciliation_v2(
    $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid, $6::text, $7::text,
    $8::numeric, $9::text, $10::numeric, $11::text, $12::text, $13::uuid,
    $14::text, $15::uuid, $16::text, $17::text, $18::text, $19::text,
    $20::text, $21::text, $22::timestamptz, $23::timestamptz, $24::uuid
  )`;
const RECORD_REVIEW_SQL = `SELECT *
  FROM record_mainnet_financial_action_post_finality_review_v2(
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
  readonly sourcePairApprovalId: string;
  readonly sourcePairApprovalExpiresAt: Date;
  readonly transactionPosition: string;
  readonly transactionBlockId: string;
  readonly finalizedPosition: string;
  readonly finalizedBlockId: string;
  readonly evidenceFingerprint: string;
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

interface LifecycleCursorRow extends QueryResultRow {
  lifecycle_revision: string;
  current_snapshot_sha256: string;
  lifecycle_stage: string;
}

interface AdmissionRow extends QueryResultRow {
  admission_fingerprint_sha256: string;
  admitted_event_revision: string;
  admitted_transition_fingerprint_sha256: string;
  current_snapshot_sha256: string;
}

interface ReviewRow extends QueryResultRow {
  review_fingerprint_sha256: string;
  review_revision: string;
  effective_safety_state: string;
}

interface AtomicAdmissionFixture {
  readonly lifecycle: LifecycleFixture;
  readonly evidence: EvidenceFixture;
  readonly authority: AuthorityFixture;
  readonly ambiguous: LifecycleCursorRow;
  readonly values: unknown[];
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
    `prerequisite-integration-${network.namespace}-${randomBytes(4).toString('hex')}`,
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
      Buffer.from('finality-prerequisite-address'),
      randomBytes(12),
      randomBytes(16),
      Buffer.from('finality-prerequisite-metadata'),
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
  const uniqueNetwork: NetworkFixture = {
    ...network,
    transactionId:
      network.networkId === ETHEREUM
        ? `0x${fingerprint()}`
        : base58(new Uint8Array(randomBytes(64))),
  };
  const { fixture, addressDigest } = await provisionSubmittedYieldFixture(pool, uniqueNetwork);
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
    uniqueNetwork.networkId,
    uniqueNetwork.providerId,
    uniqueNetwork.protocolId,
    uniqueNetwork.marketId,
    registry.version,
    registry.fingerprintSha256,
    uniqueNetwork.assetSymbol,
    uniqueNetwork.assetIdentity,
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
      uniqueNetwork.transactionId,
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
    transactionId: uniqueNetwork.transactionId,
    network: uniqueNetwork,
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
): Promise<EvidenceFixture> {
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
  const sourcePairApprovalId = `prerequisite-approval-${evidenceSequence}`;
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
  pool: Queryable,
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
  evidence: EvidenceFixture,
  authority: AuthorityFixture,
): Promise<unknown[]> {
  const observedAt = await databaseNow(pool);
  return [
    lifecycle.accountId,
    lifecycle.intentId,
    lifecycle.boundRevision,
    lifecycle.boundSnapshot,
    randomUUID(),
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
  evidence: EvidenceFixture,
  authority: AuthorityFixture,
  expectedReviewRevision: number,
  previousReviewFingerprint: string | null,
): Promise<unknown[]> {
  const observedAt = await databaseNow(pool);
  return [
    lifecycle.accountId,
    lifecycle.intentId,
    admission.admitted_event_revision,
    admission.current_snapshot_sha256,
    expectedReviewRevision,
    previousReviewFingerprint,
    randomUUID(),
    'FINALITY_REAFFIRMED',
    'CANONICAL',
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

async function recordAmbiguousBroadcast(
  pool: Pool,
  lifecycle: LifecycleFixture,
): Promise<LifecycleCursorRow> {
  const observedAt = await databaseNow(pool);
  return requiredRow<LifecycleCursorRow>(
    pool,
    `SELECT * FROM record_mainnet_financial_action_broadcast_observation(
       $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid, $6::text,
       'WALLET_REPORTED_AMBIGUOUS'::text, $7::text, $8::timestamptz, $9::uuid
     )`,
    [
      lifecycle.accountId,
      lifecycle.intentId,
      lifecycle.boundRevision,
      lifecycle.boundSnapshot,
      randomUUID(),
      lifecycle.transactionId,
      fingerprint(),
      observedAt,
      randomUUID(),
    ],
  );
}

async function prepareAtomicAdmissionFixture(
  pool: Pool,
  network: NetworkFixture,
): Promise<AtomicAdmissionFixture> {
  const lifecycle = await prepareAndBindLifecycle(pool, network);
  const evidence = await recordChainEvidence(pool, lifecycle.network);
  const authority = await installAuthorities(pool, lifecycle, evidence);
  const ambiguous = await recordAmbiguousBroadcast(pool, lifecycle);
  const values = await admissionValues(pool, lifecycle, evidence, authority);
  values[2] = ambiguous.lifecycle_revision;
  values[3] = ambiguous.current_snapshot_sha256;
  return { lifecycle, evidence, authority, ambiguous, values };
}

function deadlineFrom(now: Date): Date {
  return new Date(now.getTime() + 20_000);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function expectStillPending(promise: Promise<unknown>): Promise<void> {
  let state: 'PENDING' | 'FULFILLED' | 'REJECTED' = 'PENDING';
  void promise.then(
    () => {
      state = 'FULFILLED';
    },
    () => {
      state = 'REJECTED';
    },
  );
  await delay(100);
  expect(state).toBe('PENDING');
}

async function waitForBackendLock(pool: Pool, processId: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await requiredRow<{ wait_event_type: string | null }>(
      pool,
      `SELECT wait_event_type
       FROM pg_catalog.pg_stat_activity
       WHERE pid = $1::integer`,
      [processId],
    );
    if (state.wait_event_type === 'Lock') return;
    await delay(25);
  }
  throw new Error('PostgreSQL backend did not reach the expected lock wait');
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function requireLoopback(rawUrl: string): void {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) {
    throw new Error('Finality prerequisite integration requires loopback PostgreSQL');
  }
}

function requirePostgres16(serverVersionNum: number | undefined): void {
  if (
    serverVersionNum === undefined ||
    !Number.isInteger(serverVersionNum) ||
    serverVersionNum < 160_000 ||
    serverVersionNum >= 170_000
  ) {
    throw new Error('Finality prerequisite integration requires PostgreSQL 16');
  }
}

describeWithPostgres('migration 0037 atomic finality persistence (guarded PostgreSQL 16)', () => {
  jest.setTimeout(180_000);

  const schema = `test_action_atomic_finality_${randomUUID().replaceAll('-', '')}`;
  const expectedMigrationIds = MIGRATIONS_THROUGH_0037.map(({ id }) => id);
  let adminPool: Pool | undefined;
  let operationPool: Pool | undefined;
  let runner: MigrationRunner | undefined;
  let schemaCreated = false;

  function requireOperationPool(): Pool {
    if (!operationPool) throw new Error('atomic finality operation pool is unavailable');
    return operationPool;
  }

  function requireRunner(): MigrationRunner {
    if (!runner) throw new Error('atomic finality migration runner is unavailable');
    return runner;
  }

  function migration(id: string): DatabaseMigration {
    const found = DATABASE_TEST_SCHEMA_MIGRATION_LIST.find((entry) => entry.id === id);
    if (!found?.verifySql) throw new Error(`Migration ${id} verifier is unavailable`);
    return found;
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
      max: 8,
      options: `-c search_path=${schema} -c statement_timeout=5000 -c lock_timeout=4000`,
    });
    runner = new MigrationRunner(operationPool, MIGRATIONS_THROUGH_0037);
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

  it('applies and verifies the exact owner-only v2 catalog', async () => {
    await expect(requireRunner().up()).resolves.toEqual(expectedMigrationIds);
    await expect(requireRunner().assertUpToDate()).resolves.toBeUndefined();
    await expect(
      requireOperationPool().query<{ valid: boolean }>(migration('0037').verifySql ?? ''),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });

    const catalog = await requireOperationPool().query<{
      function_count: string;
      input_count: string;
      output_count: string;
      nonowner_acl_count: string;
    }>(
      `SELECT pg_catalog.count(*)::text AS function_count,
          pg_catalog.sum(procedure.pronargs)::text AS input_count,
          pg_catalog.sum((
            SELECT pg_catalog.count(*)
            FROM pg_catalog.unnest(procedure.proargmodes) AS mode
            WHERE mode = 't'::"char"
          ))::text AS output_count,
          pg_catalog.sum((
            SELECT pg_catalog.count(*)
            FROM pg_catalog.aclexplode(COALESCE(
              procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
            )) AS acl
            WHERE acl.grantee <> procedure.proowner
          ))::text AS nonowner_acl_count
        FROM pg_catalog.unnest($1::text[]) AS expected(function_identity)
        INNER JOIN pg_catalog.pg_proc AS procedure
          ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)`,
      [FUNCTIONS],
    );
    expect(catalog.rows).toEqual([
      {
        function_count: '2',
        input_count: '49',
        output_count: '24',
        nonowner_acl_count: '0',
      },
    ]);
  });

  it.each([
    ['Ethereum', ETHEREUM_FIXTURE],
    ['Solana', SOLANA_FIXTURE],
  ] as const)(
    'records new %s admission and post-finality paths through v2',
    async (_name, network) => {
      const pool = requireOperationPool();
      const { lifecycle, evidence, authority, ambiguous, values } =
        await prepareAtomicAdmissionFixture(pool, network);
      const admission = await requiredRow<AdmissionRow>(pool, RECORD_ADMISSION_SQL, values);
      expect(admission).toMatchObject({
        admission_outcome: 'RECORDED',
        lifecycle_stage: 'FINALIZED_SUCCESS',
        admitted_event_revision: (BigInt(ambiguous.lifecycle_revision) + 1n).toString(),
      });

      const review = await requiredRow<ReviewRow>(
        pool,
        RECORD_REVIEW_SQL,
        await reviewValues(pool, lifecycle, admission, evidence, authority, 0, null),
      );
      expect(review).toMatchObject({
        record_outcome: 'RECORDED',
        review_revision: '1',
        effective_safety_state: 'AUTHENTICATED_FINALITY_RECORDED',
      });
    },
  );

  it('refuses REPEATABLE READ without persistence and fails closed on a revoked wallet', async () => {
    const pool = requireOperationPool();
    const isolated = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await expect(client.query(RECORD_ADMISSION_SQL, isolated.values)).rejects.toMatchObject({
        code: '22023',
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    await expect(
      pool.query(
        `SELECT pg_catalog.count(*)::text AS count
         FROM mainnet_financial_action_reconciliation_admissions
         WHERE observation_id = $1::uuid`,
        [isolated.values[4]],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '0' }] });

    const revoked = await prepareAtomicAdmissionFixture(pool, SOLANA_FIXTURE);
    await pool.query('SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)', [
      revoked.lifecycle.accountId,
      revoked.lifecycle.walletId,
      randomUUID(),
    ]);
    await expect(pool.query(RECORD_ADMISSION_SQL, revoked.values)).rejects.toMatchObject({
      code: '55000',
    });
    await expect(
      pool.query(
        `SELECT pg_catalog.count(*)::text AS count
         FROM mainnet_financial_action_reconciliation_admissions
         WHERE observation_id = $1::uuid`,
        [revoked.values[4]],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '0' }] });
  });

  it('preserves lost-ACK admission replay after revocation, control, and expiry', async () => {
    const pool = requireOperationPool();
    const fixture = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const observedAt = fixture.values[21] as Date;
    fixture.values[22] = new Date(observedAt.getTime() + 2_000);
    const recorded = await requiredRow<AdmissionRow>(pool, RECORD_ADMISSION_SQL, fixture.values);
    expect(recorded).toMatchObject({
      admission_outcome: 'RECORDED',
      ledger_settlement_authority: false,
    });

    await pool.query('SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)', [
      fixture.lifecycle.accountId,
      fixture.lifecycle.walletId,
      randomUUID(),
    ]);
    await pool.query(
      `SELECT * FROM invalidate_provider_position_chain_anchor_evidence(
         $1::uuid, $2::text, 'INVALIDATED'::text, 'LOST_ACK_REPLAY'::text
       )`,
      [randomUUID(), fixture.evidence.evidenceFingerprint],
    );
    await pool.query('SELECT pg_catalog.pg_sleep(2.1)');

    const replay = await requiredRow<AdmissionRow>(pool, RECORD_ADMISSION_SQL, fixture.values);
    expect(replay).toMatchObject({
      admission_outcome: 'REPLAYED',
      admission_fingerprint_sha256: recorded.admission_fingerprint_sha256,
      ledger_settlement_authority: false,
    });
    const conflict = [...fixture.values];
    conflict[23] = randomUUID();
    await expect(pool.query(RECORD_ADMISSION_SQL, conflict)).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      pool.query(
        `SELECT pg_catalog.count(*)::text AS count
         FROM mainnet_financial_action_reconciliation_admissions
         WHERE observation_id = $1::uuid`,
        [fixture.values[4]],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
  });

  it('rejects a new post-finality write after its immutable wallet is revoked', async () => {
    const pool = requireOperationPool();
    const initial = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const admission = await requiredRow<AdmissionRow>(pool, RECORD_ADMISSION_SQL, initial.values);
    const values = await reviewValues(
      pool,
      initial.lifecycle,
      admission,
      initial.evidence,
      initial.authority,
      0,
      null,
    );
    await pool.query('SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)', [
      initial.lifecycle.accountId,
      initial.lifecycle.walletId,
      randomUUID(),
    ]);
    await expect(pool.query(RECORD_REVIEW_SQL, values)).rejects.toMatchObject({
      code: '55000',
    });
    await expect(
      pool.query(
        `SELECT pg_catalog.count(*)::text AS count
         FROM mainnet_financial_action_post_finality_reviews
         WHERE review_id = $1::uuid`,
        [values[6]],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '0' }] });
  });

  it('blocks controls on requested, original, latest, and prior-reaffirmation dependencies', async () => {
    const pool = requireOperationPool();
    const initial = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const admission = await requiredRow<AdmissionRow>(pool, RECORD_ADMISSION_SQL, initial.values);
    const matchingAnchor = {
      transactionPosition: initial.evidence.transactionPosition,
      transactionBlockId: initial.evidence.transactionBlockId,
    } as const;

    const reaffirmedEvidence = await recordChainEvidence(pool, initial.lifecycle.network, {
      ...matchingAnchor,
      finalizedPosition: (BigInt(initial.evidence.finalizedPosition) + 5n).toString(),
    });
    const reaffirmedAuthority = await installAuthorities(
      pool,
      initial.lifecycle,
      reaffirmedEvidence,
    );
    const reaffirmed = await requiredRow<ReviewRow>(
      pool,
      RECORD_REVIEW_SQL,
      await reviewValues(
        pool,
        initial.lifecycle,
        admission,
        reaffirmedEvidence,
        reaffirmedAuthority,
        0,
        null,
      ),
    );

    const latestEvidence = await recordChainEvidence(pool, initial.lifecycle.network, {
      ...matchingAnchor,
      finalizedPosition: (BigInt(reaffirmedEvidence.finalizedPosition) + 5n).toString(),
    });
    const latestAuthority = await installAuthorities(pool, initial.lifecycle, latestEvidence);
    const latestValues = await reviewValues(
      pool,
      initial.lifecycle,
      admission,
      latestEvidence,
      latestAuthority,
      1,
      reaffirmed.review_fingerprint_sha256,
    );
    latestValues[7] = 'REVIEW_INCONCLUSIVE';
    latestValues[8] = 'UNKNOWN';
    const latest = await requiredRow<ReviewRow>(pool, RECORD_REVIEW_SQL, latestValues);
    expect(latest).toMatchObject({
      review_revision: '2',
      effective_safety_state: 'POST_FINALITY_REVIEW_INCONCLUSIVE',
    });

    const requestedEvidence = await recordChainEvidence(pool, initial.lifecycle.network, {
      ...matchingAnchor,
      finalizedPosition: (BigInt(latestEvidence.finalizedPosition) + 5n).toString(),
    });
    const requestedAuthority = await installAuthorities(pool, initial.lifecycle, requestedEvidence);
    const candidate = await reviewValues(
      pool,
      initial.lifecycle,
      admission,
      requestedEvidence,
      requestedAuthority,
      2,
      latest.review_fingerprint_sha256,
    );

    const proofClient = await pool.connect();
    try {
      await proofClient.query('BEGIN');
      await expect(proofClient.query(RECORD_REVIEW_SQL, candidate)).resolves.toMatchObject({
        rows: [{ record_outcome: 'RECORDED', review_revision: '3' }],
      });
      await proofClient.query('ROLLBACK');
    } finally {
      proofClient.release();
    }

    const evidenceTargets = [
      initial.evidence,
      reaffirmedEvidence,
      latestEvidence,
      requestedEvidence,
    ];
    for (const [index, target] of evidenceTargets.entries()) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT * FROM invalidate_provider_position_chain_anchor_evidence(
             $1::uuid, $2::text, 'QUARANTINED'::text, $3::text
           )`,
          [randomUUID(), target.evidenceFingerprint, `ATOMIC_EVIDENCE_${index}`],
        );
        await expect(client.query(RECORD_REVIEW_SQL, candidate)).rejects.toMatchObject({
          code: '55000',
        });
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    const authorityTargets = [
      initial.authority,
      reaffirmedAuthority,
      latestAuthority,
      requestedAuthority,
    ];
    for (const [index, target] of authorityTargets.entries()) {
      for (const kind of ['SOURCE', 'DEPLOYMENT'] as const) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `SELECT * FROM control_mainnet_financial_action_reconciliation_authority_v1(
               $1::uuid, $2::text, $3::uuid, $4::uuid, $5::text,
               'SUSPENDED'::text, $6::text
             )`,
            [
              randomUUID(),
              kind,
              kind === 'SOURCE' ? target.sourceAuthorityId : null,
              kind === 'DEPLOYMENT' ? target.deploymentAuthorityId : null,
              kind === 'SOURCE'
                ? target.sourceAuthorityFingerprint
                : target.deploymentAuthorityFingerprint,
              `ATOMIC_${kind}_${index}`,
            ],
          );
          await expect(client.query(RECORD_REVIEW_SQL, candidate)).rejects.toMatchObject({
            code: '55000',
          });
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          client.release();
        }
      }
    }
  });

  it('preserves lost-ACK post-finality replay after revocation, controls, and expiry', async () => {
    const pool = requireOperationPool();
    const initial = await prepareAtomicAdmissionFixture(pool, SOLANA_FIXTURE);
    const admission = await requiredRow<AdmissionRow>(pool, RECORD_ADMISSION_SQL, initial.values);
    const values = await reviewValues(
      pool,
      initial.lifecycle,
      admission,
      initial.evidence,
      initial.authority,
      0,
      null,
    );
    const observedAt = values[22] as Date;
    values[23] = new Date(observedAt.getTime() + 2_000);
    const recorded = await requiredRow<ReviewRow>(pool, RECORD_REVIEW_SQL, values);
    expect(recorded).toMatchObject({
      record_outcome: 'RECORDED',
      review_revision: '1',
      ledger_settlement_authority: false,
    });
    const advanced = await requiredRow<ReviewRow>(
      pool,
      RECORD_REVIEW_SQL,
      await reviewValues(
        pool,
        initial.lifecycle,
        admission,
        initial.evidence,
        initial.authority,
        1,
        recorded.review_fingerprint_sha256,
      ),
    );
    expect(advanced).toMatchObject({ record_outcome: 'RECORDED', review_revision: '2' });

    await pool.query('SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)', [
      initial.lifecycle.accountId,
      initial.lifecycle.walletId,
      randomUUID(),
    ]);
    await pool.query(
      `SELECT * FROM invalidate_provider_position_chain_anchor_evidence(
         $1::uuid, $2::text, 'INVALIDATED'::text, 'POST_FINALITY_LOST_ACK'::text
       )`,
      [randomUUID(), initial.evidence.evidenceFingerprint],
    );
    await pool.query(
      `SELECT * FROM control_mainnet_financial_action_reconciliation_authority_v1(
         $1::uuid, 'SOURCE'::text, $2::uuid, NULL::uuid, $3::text,
         'SUSPENDED'::text, 'POST_FINALITY_LOST_ACK'::text
       )`,
      [
        randomUUID(),
        initial.authority.sourceAuthorityId,
        initial.authority.sourceAuthorityFingerprint,
      ],
    );
    await pool.query('SELECT pg_catalog.pg_sleep(2.1)');

    const replay = await requiredRow<ReviewRow>(pool, RECORD_REVIEW_SQL, values);
    expect(replay).toMatchObject({
      record_outcome: 'REPLAYED',
      review_fingerprint_sha256: recorded.review_fingerprint_sha256,
      review_revision: '1',
      current_review_revision: '2',
      current_review_fingerprint_sha256: advanced.review_fingerprint_sha256,
      effective_safety_state: 'AUTHORITY_CONTROLLED_QUARANTINED',
      requires_manual_review: true,
      ledger_settlement_authority: false,
    });
    const conflict = [...values];
    conflict[3] = fingerprint('post-finality-replay-conflict');
    await expect(pool.query(RECORD_REVIEW_SQL, conflict)).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      pool.query(
        `SELECT pg_catalog.count(*)::text AS count
         FROM mainnet_financial_action_post_finality_reviews
         WHERE review_id = $1::uuid`,
        [values[6]],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
  });

  it('serializes an advancing review cursor so exactly one concurrent CAS records', async () => {
    const pool = requireOperationPool();
    const initial = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const admission = await requiredRow<AdmissionRow>(pool, RECORD_ADMISSION_SQL, initial.values);
    const first = await reviewValues(
      pool,
      initial.lifecycle,
      admission,
      initial.evidence,
      initial.authority,
      0,
      null,
    );
    const second = await reviewValues(
      pool,
      initial.lifecycle,
      admission,
      initial.evidence,
      initial.authority,
      0,
      null,
    );

    const settled = await Promise.allSettled([
      pool.query<ReviewRow>(RECORD_REVIEW_SQL, first),
      pool.query<ReviewRow>(RECORD_REVIEW_SQL, second),
    ]);
    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<QueryResult<ReviewRow>> =>
        result.status === 'fulfilled',
    );
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value.rows).toEqual([
      expect.objectContaining({ record_outcome: 'RECORDED', review_revision: '1' }),
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: '40001' });
    await expect(
      pool.query(
        `SELECT pg_catalog.count(*)::text AS count
         FROM mainnet_financial_action_post_finality_reviews
         WHERE intent_id = $1::uuid`,
        [initial.lifecycle.intentId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
  });

  it('locks reverse-order post-finality dependency sets without deadlock', async () => {
    const pool = requireOperationPool();
    const first = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const secondLifecycle = await prepareAndBindLifecycle(pool, ETHEREUM_FIXTURE);
    const secondEvidence = await recordChainEvidence(pool, secondLifecycle.network, {
      transactionPosition: first.evidence.transactionPosition,
      transactionBlockId: first.evidence.transactionBlockId,
      finalizedPosition: first.evidence.finalizedPosition,
      finalizedBlockId: first.evidence.finalizedBlockId,
    });
    const secondAuthority = await installAuthorities(pool, secondLifecycle, secondEvidence);
    const secondAmbiguous = await recordAmbiguousBroadcast(pool, secondLifecycle);
    const secondAdmissionValues = await admissionValues(
      pool,
      secondLifecycle,
      secondEvidence,
      secondAuthority,
    );
    secondAdmissionValues[2] = secondAmbiguous.lifecycle_revision;
    secondAdmissionValues[3] = secondAmbiguous.current_snapshot_sha256;

    const firstAdmission = await requiredRow<AdmissionRow>(
      pool,
      RECORD_ADMISSION_SQL,
      first.values,
    );
    const secondAdmission = await requiredRow<AdmissionRow>(
      pool,
      RECORD_ADMISSION_SQL,
      secondAdmissionValues,
    );
    const firstUsesSecond = await reviewValues(
      pool,
      first.lifecycle,
      firstAdmission,
      secondEvidence,
      secondAuthority,
      0,
      null,
    );
    const secondUsesFirst = await reviewValues(
      pool,
      secondLifecycle,
      secondAdmission,
      first.evidence,
      first.authority,
      0,
      null,
    );

    const [firstResult, secondResult] = await Promise.all([
      pool.query<ReviewRow>(RECORD_REVIEW_SQL, firstUsesSecond),
      pool.query<ReviewRow>(RECORD_REVIEW_SQL, secondUsesFirst),
    ]);
    expect(firstResult.rows).toEqual([
      expect.objectContaining({ record_outcome: 'RECORDED', review_revision: '1' }),
    ]);
    expect(secondResult.rows).toEqual([
      expect.objectContaining({ record_outcome: 'RECORDED', review_revision: '1' }),
    ]);
  });

  it('deterministically honors control-wins, v2-wins, and revoke-wins races', async () => {
    const pool = requireOperationPool();

    const controlWins = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const controlClient = await pool.connect();
    try {
      await controlClient.query('BEGIN');
      await controlClient.query(
        `SELECT * FROM invalidate_provider_position_chain_anchor_evidence(
           $1::uuid, $2::text, 'INVALIDATED'::text, 'CONTROL_WINS'::text
         )`,
        [randomUUID(), controlWins.evidence.evidenceFingerprint],
      );
      const blockedWrite = pool.query(RECORD_ADMISSION_SQL, controlWins.values);
      await expectStillPending(blockedWrite);
      await controlClient.query('COMMIT');
      await expect(blockedWrite).rejects.toMatchObject({ code: '55000' });
    } finally {
      await controlClient.query('ROLLBACK').catch(() => undefined);
      controlClient.release();
    }

    const v2Wins = await prepareAtomicAdmissionFixture(pool, SOLANA_FIXTURE);
    const writeClient = await pool.connect();
    try {
      await writeClient.query('BEGIN');
      await expect(writeClient.query(RECORD_ADMISSION_SQL, v2Wins.values)).resolves.toMatchObject({
        rows: [{ admission_outcome: 'RECORDED' }],
      });
      const blockedControl = pool.query(
        `SELECT * FROM invalidate_provider_position_chain_anchor_evidence(
           $1::uuid, $2::text, 'QUARANTINED'::text, 'V2_WINS'::text
         )`,
        [randomUUID(), v2Wins.evidence.evidenceFingerprint],
      );
      await expectStillPending(blockedControl);
      await writeClient.query('COMMIT');
      await expect(blockedControl).resolves.toMatchObject({
        rows: [{ control_outcome: 'RECORDED' }],
      });
    } finally {
      await writeClient.query('ROLLBACK').catch(() => undefined);
      writeClient.release();
    }

    const revokeWins = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const revokeClient = await pool.connect();
    try {
      await revokeClient.query('BEGIN');
      await revokeClient.query(
        'SELECT * FROM revoke_wallet_registration($1::uuid, $2::uuid, $3::uuid)',
        [revokeWins.lifecycle.accountId, revokeWins.lifecycle.walletId, randomUUID()],
      );
      const blockedWrite = pool.query(RECORD_ADMISSION_SQL, revokeWins.values);
      await expectStillPending(blockedWrite);
      await revokeClient.query('COMMIT');
      await expect(blockedWrite).rejects.toMatchObject({ code: '55000' });
    } finally {
      await revokeClient.query('ROLLBACK').catch(() => undefined);
      revokeClient.release();
    }
  });

  it('freezes authority candidates and fails closed when a candidate insert wins', async () => {
    const pool = requireOperationPool();

    const v2Wins = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const writeClient = await pool.connect();
    try {
      await writeClient.query('BEGIN');
      await expect(writeClient.query(RECORD_ADMISSION_SQL, v2Wins.values)).resolves.toMatchObject({
        rows: [{ admission_outcome: 'RECORDED' }],
      });
      const blockedCandidate = installAuthorities(pool, v2Wins.lifecycle, v2Wins.evidence);
      await expectStillPending(blockedCandidate);
      await writeClient.query('COMMIT');
      await expect(blockedCandidate).resolves.toMatchObject({
        sourceAuthorityId: expect.any(String),
        deploymentAuthorityId: expect.any(String),
      });
    } finally {
      await writeClient.query('ROLLBACK').catch(() => undefined);
      writeClient.release();
    }

    const insertWins = await prepareAtomicAdmissionFixture(pool, SOLANA_FIXTURE);
    const insertClient = await pool.connect();
    try {
      await insertClient.query('BEGIN');
      await installAuthorities(insertClient, insertWins.lifecycle, insertWins.evidence);
      const blockedWrite = pool.query(RECORD_ADMISSION_SQL, insertWins.values);
      await expectStillPending(blockedWrite);
      await insertClient.query('COMMIT');
      await expect(blockedWrite).rejects.toMatchObject({ code: '55000' });
    } finally {
      await insertClient.query('ROLLBACK').catch(() => undefined);
      insertClient.release();
    }
  });

  it('orders bare 0036, v2, and queued control locks without deadlock', async () => {
    const pool = requireOperationPool();
    const fixture = await prepareAtomicAdmissionFixture(pool, ETHEREUM_FIXTURE);
    const readClient = await pool.connect();
    const writeClient = await pool.connect();
    try {
      await readClient.query('BEGIN');
      const deadline = deadlineFrom(await databaseNow(readClient));
      await expect(
        readClient.query(
          `SELECT * FROM read_mainnet_financial_action_reconciliation_prerequisite_v1(
             $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::timestamptz
           )`,
          [
            fixture.lifecycle.accountId,
            fixture.lifecycle.intentId,
            fixture.ambiguous.lifecycle_revision,
            fixture.ambiguous.current_snapshot_sha256,
            fixture.evidence.evidenceFingerprint,
            deadline,
          ],
        ),
      ).resolves.toMatchObject({
        rows: [expect.objectContaining({ account_id: fixture.lifecycle.accountId })],
      });

      await writeClient.query('BEGIN');
      const backend = await requiredRow<{ pid: number }>(
        writeClient,
        'SELECT pg_catalog.pg_backend_pid() AS pid',
      );
      const write = writeClient.query<AdmissionRow>(RECORD_ADMISSION_SQL, fixture.values);
      await waitForBackendLock(pool, backend.pid);

      const control = pool.query(
        `SELECT * FROM invalidate_provider_position_chain_anchor_evidence(
           $1::uuid, $2::text, 'QUARANTINED'::text, 'QUEUED_AFTER_V2'::text
         )`,
        [randomUUID(), fixture.evidence.evidenceFingerprint],
      );
      await expectStillPending(control);
      await readClient.query('COMMIT');
      await expect(write).resolves.toMatchObject({
        rows: [{ admission_outcome: 'RECORDED' }],
      });
      await expectStillPending(control);
      await writeClient.query('COMMIT');
      await expect(control).resolves.toMatchObject({
        rows: [{ control_outcome: 'RECORDED' }],
      });
    } finally {
      await readClient.query('ROLLBACK').catch(() => undefined);
      await writeClient.query('ROLLBACK').catch(() => undefined);
      readClient.release();
      writeClient.release();
    }
  });

  it('rolls back a newly recorded result that crosses its effective expiry', async () => {
    const pool = requireOperationPool();
    const fixture = await prepareAtomicAdmissionFixture(pool, SOLANA_FIXTURE);
    const observedAt = fixture.values[21] as Date;
    fixture.values[22] = new Date(observedAt.getTime() + 1_500);
    await pool.query(
      `CREATE FUNCTION test_atomic_finality_delay()
       RETURNS trigger LANGUAGE plpgsql AS $function$
       BEGIN
         PERFORM pg_catalog.pg_sleep(2);
         RETURN NEW;
       END;
       $function$`,
    );
    await pool.query(
      `CREATE TRIGGER test_atomic_finality_delay_row
       BEFORE INSERT ON mainnet_financial_action_reconciliation_admissions
       FOR EACH ROW EXECUTE FUNCTION test_atomic_finality_delay()`,
    );
    try {
      await expect(pool.query(RECORD_ADMISSION_SQL, fixture.values)).rejects.toMatchObject({
        code: '57014',
      });
      await expect(
        pool.query(
          `SELECT pg_catalog.count(*)::text AS admission_count,
              (SELECT pg_catalog.count(*)::text
               FROM mainnet_financial_action_events
               WHERE observation_id = $1::uuid) AS event_count
           FROM mainnet_financial_action_reconciliation_admissions
           WHERE observation_id = $1::uuid`,
          [fixture.values[4]],
        ),
      ).resolves.toMatchObject({
        rows: [{ admission_count: '0', event_count: '0' }],
      });
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS test_atomic_finality_delay_row
         ON mainnet_financial_action_reconciliation_admissions`,
      );
      await pool.query('DROP FUNCTION IF EXISTS test_atomic_finality_delay()');
    }
  });

  it('rolls back only 0037 and restores the exact 0036 verifier', async () => {
    await expect(requireRunner().down()).resolves.toEqual(['0037']);
    for (const identity of FUNCTIONS) {
      await expect(
        requireOperationPool().query<{ function_oid: string | null }>(
          'SELECT pg_catalog.to_regprocedure($1)::text AS function_oid',
          [identity],
        ),
      ).resolves.toMatchObject({ rows: [{ function_oid: null }] });
    }
    await expect(
      requireOperationPool().query<{ valid: boolean }>(migration('0036').verifySql ?? ''),
    ).resolves.toMatchObject({ rows: [{ valid: true }] });
  });
});
