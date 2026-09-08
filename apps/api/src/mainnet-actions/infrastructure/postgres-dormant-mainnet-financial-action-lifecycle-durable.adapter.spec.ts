import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import type { PostgresService } from '../../infrastructure/database/postgres.service';
import {
  activeWalletRegistrationKey,
  createWalletRegistrationKey,
  createWalletRegistrationKeyRing,
  digestWalletIdentity,
  walletRegistrationKeyForVersion,
  type WalletRegistrationDigestReference,
  type WalletRegistrationKey,
  type WalletRegistrationKeyRing,
} from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import type { DormantMainnetFinancialActionIntentInputV1 } from '../domain/dormant-mainnet-financial-action';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
  type BindDormantMainnetFinancialActionSubmissionRequestV1,
  type DormantMainnetFinancialActionClmaDatabaseCursorV1,
  type DormantMainnetFinancialActionDatabaseConfirmedResultV1,
  type DormantMainnetFinancialActionDatabaseOutcomeUnknownV1,
  type DormantMainnetFinancialActionDurableRequestV1,
  type PrepareDormantMainnetFinancialActionDurableRequestV1,
  type ReadDormantMainnetFinancialActionDurableRequestV1,
  type RecordDormantMainnetFinancialActionBroadcastRequestV1,
  type RecordDormantMainnetFinancialActionReconciliationRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port';
import {
  type DormantMainnetFinancialActionLifecycleClock,
  PostgresDormantMainnetFinancialActionLifecycleDurableAdapter,
} from './postgres-dormant-mainnet-financial-action-lifecycle-durable.adapter';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const INTENT_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ID = '33333333-3333-4333-8333-333333333333';
const REPLAY_ID = '44444444-4444-4444-8444-444444444444';
const YIELD_OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const YIELD_SUBMISSION_ID = '66666666-6666-4666-8666-666666666666';
const LEDGER_TRANSACTION_ID = '77777777-7777-4777-8777-777777777777';
const LEDGER_BOOK_ID = '88888888-8888-4888-8888-888888888888';
const CORRELATION_ID = '99999999-9999-4999-8999-999999999999';
const OBSERVATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECOND_OBSERVATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = '2026-09-07T12:00:30.000Z';
const ISSUED_AT = '2026-09-07T12:00:00.000Z';
const PREPARED_EFFECTIVE_AT = '2026-09-07T12:00:30.000Z';
const PREPARED_RECORDED_AT = '2026-09-07T12:00:31.000Z';
const SIGNED_AT = '2026-09-07T12:01:00.000Z';
const BROADCAST_AT = '2026-09-07T12:02:00.000Z';
const EXPIRES_AT = '2026-09-07T12:04:00.000Z';
const POST_EXPIRY_AT = '2026-09-07T12:05:00.000Z';
const ETHEREUM_TRANSACTION = `0x${'1'.repeat(64)}`;
const ETHEREUM_BLOCK = `0x${'2'.repeat(64)}`;
const ETHEREUM_FINALIZED_BLOCK = `0x${'3'.repeat(64)}`;
const SOLANA_WALLET = base58Filled(7, 32);
const SOLANA_MARKET = base58Filled(8, 32);
const SOLANA_TRANSACTION = base58Filled(9, 64);
const SOLANA_BLOCK = base58Filled(10, 32);
const SOLANA_FINALIZED_BLOCK = base58Filled(11, 32);
const ETHEREUM_WALLET = '0x1111111111111111111111111111111111111111';
const INTENT_FINGERPRINT = digest('1');
const VOLATILE_COMMITMENT = digest('2');
const PREPARED_SNAPSHOT = digest('3');
const IDEMPOTENCY_DIGEST = digest('4');
const SUBMISSION_FINGERPRINT = digest('6');
const BOUND_SNAPSHOT = digest('7');
const BROADCAST_SNAPSHOT = digest('8');
const RECONCILIATION_SNAPSHOT = digest('9');
const TERMINAL_SNAPSHOT = digest('a');
const PAYLOAD_DIGEST = digest('b');
const SIGNATURE_DIGEST = digest('c');
const EVIDENCE_DIGEST = digest('d');
const SOURCE_DIGEST = digest('e');
const BLOCK_IDENTITY_DIGEST = 'bc'.repeat(32);
const FINALIZED_BLOCK_IDENTITY_DIGEST = 'cd'.repeat(32);
const IDENTITY_KEY_V1 = createWalletRegistrationKey(
  'identity-hmac',
  1,
  Buffer.alloc(32, 0x11).toString('base64url'),
  'dormant-lifecycle-identity-v1',
);
const IDENTITY_KEY_RING = createWalletRegistrationKeyRing('identity-hmac', 1, [IDENTITY_KEY_V1]);

function digest(character: string): string {
  return character.repeat(64);
}

function base58Filled(byte: number, byteLength: number): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = new Uint8Array(byteLength).fill(byte);
  const digits = [0];
  for (const value of bytes) {
    let carry = value;
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
  return digits
    .reverse()
    .map((digitValue) => alphabet[digitValue] ?? '')
    .join('');
}

function frozenNull<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as object, value)) as Readonly<T>;
}

function commonRequest(): Readonly<{
  durableLifecycleVersion: 1;
  use: typeof DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE;
  mayAuthorizeFinancialAction: false;
  signal: AbortSignal;
}> {
  return {
    durableLifecycleVersion: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
    mayAuthorizeFinancialAction: false as const,
    signal: new AbortController().signal,
  };
}

function prepareRequest(
  networkId: typeof ETHEREUM | typeof SOLANA = ETHEREUM,
  assetSymbol: SupportedStablecoin = 'USDC',
): PrepareDormantMainnetFinancialActionDurableRequestV1 {
  const ethereum = networkId === ETHEREUM;
  const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets.find(
    (entry) => entry.networkId === networkId && entry.stablecoin === assetSymbol,
  );
  if (asset === undefined) throw new Error('missing test asset');
  const intentInput: DormantMainnetFinancialActionIntentInputV1 = frozenNull({
    schemaVersion: 1 as const,
    intentId: INTENT_ID,
    accountId: ACCOUNT_ID,
    walletRegistrationId: WALLET_ID,
    replayProtectionId: REPLAY_ID,
    idempotencyKeyDigestSha256: IDEMPOTENCY_DIGEST,
    networkId,
    walletAddress: ethereum ? ETHEREUM_WALLET : SOLANA_WALLET,
    providerId: ethereum ? 'aave' : 'kamino',
    protocolId: ethereum ? 'aave-v3' : 'kamino-lend',
    marketId: ethereum ? '0x2222222222222222222222222222222222222222' : SOLANA_MARKET,
    assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
    assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    assetSymbol,
    assetIdentity: asset.identity,
    action: 'SUPPLY',
    amountAtomic: '1000000',
    requestedValueUsdMicros: '1000000',
    maximumNetworkFeeAtomic: '10000',
    maximumNetworkFeeBasisPoints: 50,
    minimumPostActionNativeBalanceAtomic: '1',
    allowanceMode: 'EXACT',
    allowanceAmountAtomic: '1000000',
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  });
  return frozenNull({
    ...commonRequest(),
    intentInput,
    authoritativeLinks: frozenNull({
      yieldOperationId: YIELD_OPERATION_ID,
      yieldSubmissionId: YIELD_SUBMISSION_ID,
      ledgerTransactionId: LEDGER_TRANSACTION_ID,
      ledgerBookId: LEDGER_BOOK_ID,
    }),
    volatileIntentCommitment: frozenNull({
      source: 'VOLATILE_IN_PROCESS_LIFECYCLE' as const,
      encoding: 'VOLATILE_JSON_DOMAIN_V1' as const,
      sha256: VOLATILE_COMMITMENT,
      mayServeAsDatabaseCursor: false as const,
    }),
    correlationId: CORRELATION_ID,
  });
}

function bindRequest(
  cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1,
  transactionId = ETHEREUM_TRANSACTION,
): BindDormantMainnetFinancialActionSubmissionRequestV1 {
  return frozenNull({
    ...commonRequest(),
    cursor,
    correlationId: CORRELATION_ID,
    transactionId,
    walletSignedPayloadSha256: PAYLOAD_DIGEST,
    walletSignatureEvidenceSha256: SIGNATURE_DIGEST,
    signedAt: SIGNED_AT,
  });
}

function broadcastRequest(
  cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1,
  transactionId = ETHEREUM_TRANSACTION,
  signal = new AbortController().signal,
): RecordDormantMainnetFinancialActionBroadcastRequestV1 {
  return frozenNull({
    ...commonRequest(),
    signal,
    cursor,
    correlationId: CORRELATION_ID,
    observationId: OBSERVATION_ID,
    transactionId,
    outcome: 'WALLET_REPORTED_AMBIGUOUS' as const,
    evidenceSha256: EVIDENCE_DIGEST,
    observedAt: BROADCAST_AT,
  });
}

function reconciliationRequest(
  cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1,
  outcome: 'PENDING' | 'UNKNOWN',
  networkId: typeof ETHEREUM | typeof SOLANA = ETHEREUM,
  observedAt = BROADCAST_AT,
): RecordDormantMainnetFinancialActionReconciliationRequestV1 {
  const transactionId = networkId === ETHEREUM ? ETHEREUM_TRANSACTION : SOLANA_TRANSACTION;
  const transactionBlockId = networkId === ETHEREUM ? ETHEREUM_BLOCK : SOLANA_BLOCK;
  const finalizedBlockId =
    networkId === ETHEREUM ? ETHEREUM_FINALIZED_BLOCK : SOLANA_FINALIZED_BLOCK;
  const unknown = outcome === 'UNKNOWN';
  return frozenNull({
    ...commonRequest(),
    cursor,
    correlationId: CORRELATION_ID,
    observationId: SECOND_OBSERVATION_ID,
    transactionId,
    outcome,
    transactionPosition: unknown ? null : '100',
    transactionBlockId: unknown ? null : transactionBlockId,
    finalizedPosition: outcome === 'PENDING' ? '99' : '100',
    finalizedBlockId,
    sourceEvidenceSha256: SOURCE_DIGEST,
    observedAt,
  });
}

function readRequest(): ReadDormantMainnetFinancialActionDurableRequestV1 {
  return frozenNull({ ...commonRequest(), accountId: ACCOUNT_ID, intentId: INTENT_ID });
}

function preparedRow(
  request: PrepareDormantMainnetFinancialActionDurableRequestV1,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const intent = request.intentInput;
  const ethereum = intent.networkId === ETHEREUM;
  const walletIdentityDigest = digestWalletIdentity(
    activeWalletRegistrationKey(IDENTITY_KEY_RING),
    intent.networkId,
    intent.walletAddress,
  );
  return {
    record_outcome: 'RECORDED',
    result_intent_id: intent.intentId,
    lifecycle_stage: 'PREPARED',
    lifecycle_revision: '1',
    current_snapshot_sha256: PREPARED_SNAPSHOT,
    intent_record_fingerprint_sha256: INTENT_FINGERPRINT,
    volatile_intent_commitment_sha256: VOLATILE_COMMITMENT,
    fingerprint_encoding_version: 1,
    account_id: intent.accountId,
    yield_operation_id: request.authoritativeLinks.yieldOperationId,
    yield_submission_id: request.authoritativeLinks.yieldSubmissionId,
    ledger_transaction_id: request.authoritativeLinks.ledgerTransactionId,
    ledger_book_id: request.authoritativeLinks.ledgerBookId,
    wallet_id: intent.walletRegistrationId,
    wallet_chain_namespace: ethereum ? 'eip155' : 'solana',
    wallet_chain_reference: ethereum ? '1' : '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    wallet_identity_digest_version: walletIdentityDigest.version,
    wallet_identity_digest_hex: walletIdentityDigest.value,
    network_id: intent.networkId,
    provider_id: intent.providerId,
    protocol_id: intent.protocolId,
    market_id: intent.marketId,
    asset_registry_version: intent.assetRegistryVersion,
    asset_registry_fingerprint_sha256: intent.assetRegistryFingerprintSha256,
    asset_symbol: intent.assetSymbol,
    asset_identity: intent.assetIdentity,
    asset_decimals: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.identifyAsset(
      intent.networkId,
      intent.assetIdentity,
    )?.decimals,
    action_type: intent.action,
    amount_atomic: intent.amountAtomic,
    requested_value_usd_micros: intent.requestedValueUsdMicros,
    maximum_network_fee_atomic: intent.maximumNetworkFeeAtomic,
    maximum_network_fee_basis_points: intent.maximumNetworkFeeBasisPoints,
    minimum_post_action_native_balance_atomic: intent.minimumPostActionNativeBalanceAtomic,
    allowance_mode: intent.allowanceMode,
    allowance_amount_atomic: intent.allowanceAmountAtomic,
    idempotency_key_digest_sha256: intent.idempotencyKeyDigestSha256,
    replay_protection_id: intent.replayProtectionId,
    chain_transaction_id: null,
    submission_fingerprint_sha256: null,
    observation_id: null,
    broadcast_outcome: null,
    reconciliation_outcome: null,
    transaction_position: null,
    transaction_block_id: null,
    transaction_block_identity_sha256: null,
    finalized_position: null,
    finalized_block_id: null,
    finalized_block_identity_sha256: null,
    last_observed_transaction_position: null,
    last_observed_transaction_block_id: null,
    last_observed_transaction_block_identity_sha256: null,
    effective_at: PREPARED_EFFECTIVE_AT,
    expires_at: intent.expiresAt,
    terminal: false,
    requires_manual_reconciliation: false,
    database_replay_protection_enforced: true,
    ledger_settlement_authority: false,
    recorded_at: PREPARED_RECORDED_AT,
    ...overrides,
  };
}

function boundRow(
  request: PrepareDormantMainnetFinancialActionDurableRequestV1,
  transactionId = ETHEREUM_TRANSACTION,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return preparedRow(request, {
    lifecycle_stage: 'WALLET_SIGNED_SUBMISSION_BOUND',
    lifecycle_revision: '2',
    current_snapshot_sha256: BOUND_SNAPSHOT,
    chain_transaction_id: transactionId,
    submission_fingerprint_sha256: SUBMISSION_FINGERPRINT,
    effective_at: SIGNED_AT,
    recorded_at: '2026-09-07T12:01:01.000Z',
    ...overrides,
  });
}

function broadcastRow(
  request: PrepareDormantMainnetFinancialActionDurableRequestV1,
  transactionId = ETHEREUM_TRANSACTION,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return boundRow(request, transactionId, {
    lifecycle_stage: 'BROADCAST_OUTCOME_AMBIGUOUS',
    lifecycle_revision: '3',
    current_snapshot_sha256: BROADCAST_SNAPSHOT,
    observation_id: OBSERVATION_ID,
    broadcast_outcome: 'WALLET_REPORTED_AMBIGUOUS',
    effective_at: BROADCAST_AT,
    recorded_at: '2026-09-07T12:02:01.000Z',
    ...overrides,
  });
}

function reconciliationRow(
  request: PrepareDormantMainnetFinancialActionDurableRequestV1,
  outcome: 'PENDING' | 'UNKNOWN' | 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE' | 'REORGED_OUT',
  networkId: typeof ETHEREUM | typeof SOLANA = ETHEREUM,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const transactionId = networkId === ETHEREUM ? ETHEREUM_TRANSACTION : SOLANA_TRANSACTION;
  const transactionBlockId = networkId === ETHEREUM ? ETHEREUM_BLOCK : SOLANA_BLOCK;
  const finalizedBlockId =
    networkId === ETHEREUM ? ETHEREUM_FINALIZED_BLOCK : SOLANA_FINALIZED_BLOCK;
  const stage =
    outcome === 'PENDING' || outcome === 'UNKNOWN'
      ? 'RECONCILIATION_AMBIGUOUS'
      : outcome === 'FINALIZED_SUCCESS'
        ? 'FINALIZED_SUCCESS'
        : outcome === 'FINALIZED_FAILURE'
          ? 'FINALIZED_FAILURE'
          : 'REORG_QUARANTINED';
  const unknown = outcome === 'UNKNOWN';
  const terminal =
    outcome === 'FINALIZED_SUCCESS' || outcome === 'FINALIZED_FAILURE' || outcome === 'REORGED_OUT';
  return boundRow(request, transactionId, {
    lifecycle_stage: stage,
    lifecycle_revision: '3',
    current_snapshot_sha256: terminal ? TERMINAL_SNAPSHOT : RECONCILIATION_SNAPSHOT,
    observation_id: SECOND_OBSERVATION_ID,
    reconciliation_outcome: outcome,
    transaction_position: unknown ? null : '100',
    transaction_block_id: unknown ? null : transactionBlockId,
    transaction_block_identity_sha256: unknown ? null : BLOCK_IDENTITY_DIGEST,
    finalized_position: outcome === 'PENDING' ? '99' : '100',
    finalized_block_id: finalizedBlockId,
    finalized_block_identity_sha256: FINALIZED_BLOCK_IDENTITY_DIGEST,
    last_observed_transaction_position: unknown ? null : '100',
    last_observed_transaction_block_id: unknown ? null : transactionBlockId,
    last_observed_transaction_block_identity_sha256: unknown ? null : BLOCK_IDENTITY_DIGEST,
    effective_at: BROADCAST_AT,
    recorded_at: '2026-09-07T12:02:01.000Z',
    terminal,
    requires_manual_reconciliation: outcome === 'REORGED_OUT',
    ...overrides,
  });
}

interface Fixture {
  readonly adapter: PostgresDormantMainnetFinancialActionLifecycleDurableAdapter;
  readonly query: ReturnType<typeof jest.fn>;
  readonly clock: ReturnType<typeof jest.fn>;
}

function fixture(
  walletIdentityKeyRing: WalletRegistrationKeyRing<'identity-hmac'> = IDENTITY_KEY_RING,
): Fixture {
  const query: jest.Mock<Promise<unknown>, [string, readonly unknown[], AbortSignal]> = jest.fn();
  const clock = jest.fn(() => new Date(NOW));
  const postgres = { queryWithCancellation: query } as unknown as PostgresService;
  const adapter = new PostgresDormantMainnetFinancialActionLifecycleDurableAdapter(
    postgres,
    {
      now: clock,
    } as DormantMainnetFinancialActionLifecycleClock,
    walletIdentityKeyRing,
  );
  return { adapter, query, clock };
}

function walletIdentityCandidates(
  request: PrepareDormantMainnetFinancialActionDurableRequestV1,
  ring: WalletRegistrationKeyRing<'identity-hmac'> = IDENTITY_KEY_RING,
): readonly WalletRegistrationDigestReference<'address'>[] {
  return ring.keys.map((candidate) =>
    digestWalletIdentity(
      walletRegistrationKeyForVersion(ring, candidate.version),
      request.intentInput.networkId,
      request.intentInput.walletAddress,
    ),
  );
}

function queryResult(row: Record<string, unknown>): Readonly<{ rows: readonly unknown[] }> {
  return { rows: [row] };
}

function resolveOnce(query: Fixture['query'], value: unknown): void {
  query.mockImplementationOnce(() => Promise.resolve(value));
}

function rejectOnce(query: Fixture['query'], error: Error): void {
  query.mockImplementationOnce(() => Promise.reject(error));
}

function confirmed(
  adapter: PostgresDormantMainnetFinancialActionLifecycleDurableAdapter,
  capability: unknown,
  request: DormantMainnetFinancialActionDurableRequestV1,
): DormantMainnetFinancialActionDatabaseConfirmedResultV1 {
  const result = adapter.reviewResult(capability, request);
  if (result?.outcome !== 'DATABASE_STATE_CONFIRMED') throw new Error('expected confirmed result');
  return result;
}

function unknownOutcome(
  adapter: PostgresDormantMainnetFinancialActionLifecycleDurableAdapter,
  capability: unknown,
  request: DormantMainnetFinancialActionDurableRequestV1,
): DormantMainnetFinancialActionDatabaseOutcomeUnknownV1 {
  const result = adapter.reviewResult(capability, request);
  if (result?.outcome !== 'DATABASE_OUTCOME_UNKNOWN') throw new Error('expected unknown result');
  return result;
}

async function prepareConfirmed(
  test: Fixture,
  networkId: typeof ETHEREUM | typeof SOLANA = ETHEREUM,
): Promise<
  Readonly<{
    request: PrepareDormantMainnetFinancialActionDurableRequestV1;
    result: DormantMainnetFinancialActionDatabaseConfirmedResultV1;
  }>
> {
  const request = prepareRequest(networkId);
  resolveOnce(test.query, queryResult(preparedRow(request)));
  const capability = await test.adapter.prepare(request);
  return { request, result: confirmed(test.adapter, capability, request) };
}

async function bindConfirmed(
  test: Fixture,
  prepared: Awaited<ReturnType<typeof prepareConfirmed>>,
  networkId: typeof ETHEREUM | typeof SOLANA = ETHEREUM,
): Promise<
  Readonly<{
    request: BindDormantMainnetFinancialActionSubmissionRequestV1;
    result: DormantMainnetFinancialActionDatabaseConfirmedResultV1;
  }>
> {
  const transactionId = networkId === ETHEREUM ? ETHEREUM_TRANSACTION : SOLANA_TRANSACTION;
  const request = bindRequest(prepared.result.cursor, transactionId);
  resolveOnce(test.query, queryResult(boundRow(prepared.request, transactionId)));
  const capability = await test.adapter.bindSubmission(request);
  return { request, result: confirmed(test.adapter, capability, request) };
}

describe('PostgresDormantMainnetFinancialActionLifecycleDurableAdapter', () => {
  it('rejects forged identity key rings before any database operation', () => {
    const query = jest.fn();
    const postgres = { queryWithCancellation: query } as unknown as PostgresService;
    const clock = Object.freeze({ now: () => new Date(NOW) });
    const forgedRing = Object.freeze({
      purpose: 'identity-hmac' as const,
      activeWriteVersion: 1,
      keys: Object.freeze([IDENTITY_KEY_V1]),
    }) as WalletRegistrationKeyRing<'identity-hmac'>;
    const forgedKey = Object.freeze({
      keyId: 'forged-identity-v1',
      purpose: 'identity-hmac' as const,
      version: 1,
    }) as WalletRegistrationKey<'identity-hmac'>;

    expect(
      () =>
        new PostgresDormantMainnetFinancialActionLifecycleDurableAdapter(
          postgres,
          clock,
          forgedRing,
        ),
    ).toThrow(new TypeError('Invalid dormant lifecycle wallet identity key ring.'));
    expect(() => createWalletRegistrationKeyRing('identity-hmac', 1, [forgedKey])).toThrow(
      'Wallet registration cryptographic operation failed',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('uses fixed one-call SQL, limits direct reconciliation to uncertainty, and reads terminal state', async () => {
    const test = fixture();
    const prepared = await prepareConfirmed(test);
    expect(Reflect.ownKeys(prepared.result.cursor)).toHaveLength(9);
    expect(Object.getOwnPropertySymbols(prepared.result.cursor)).toEqual([]);
    expect(prepared.result.cursor.currentSnapshotSha256).not.toBe(INTENT_FINGERPRINT);

    const bound = await bindConfirmed(test, prepared);
    const reconciliation = reconciliationRequest(bound.result.cursor, 'PENDING');
    resolveOnce(test.query, queryResult(reconciliationRow(prepared.request, 'PENDING')));
    const reconciliationCapability = await test.adapter.recordReconciliation(reconciliation);
    const reconciled = confirmed(test.adapter, reconciliationCapability, reconciliation);

    const read = readRequest();
    resolveOnce(
      test.query,
      queryResult(
        reconciliationRow(prepared.request, 'FINALIZED_SUCCESS', ETHEREUM, {
          record_outcome: 'READ',
          lifecycle_revision: '4',
          current_snapshot_sha256: 'de'.repeat(32),
          effective_at: POST_EXPIRY_AT,
          recorded_at: '2026-09-07T12:05:01.000Z',
        }),
      ),
    );
    const readCapability = await test.adapter.read(read);
    const finalized = confirmed(test.adapter, readCapability, read);

    expect([prepared.result.stage, bound.result.stage, reconciled.stage, finalized.stage]).toEqual([
      'PREPARED',
      'WALLET_SIGNED_SUBMISSION_BOUND',
      'RECONCILIATION_AMBIGUOUS',
      'FINALIZED_SUCCESS',
    ]);
    expect(finalized.databaseRecordOutcome).toBe('READ');
    expect(finalized).toMatchObject({
      terminal: true,
      recoveryMode: 'NONE',
      mayAuthorizeFinancialAction: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      mayResendTransaction: false,
      automaticRetryAllowed: false,
      ledgerSettlementAuthority: false,
    });
    expect(test.query).toHaveBeenCalledTimes(4);
    const calls = test.query.mock.calls as [string, readonly unknown[], AbortSignal][];
    expect(calls.map(([sql]) => sql.match(/FROM ([a-z0-9_]+)/u)?.[1])).toEqual([
      'prepare_mainnet_financial_action_lifecycle_v2',
      'bind_mainnet_financial_action_submission',
      'record_mainnet_financial_action_reconciliation_observation',
      'read_mainnet_financial_action_lifecycle',
    ]);
    expect(calls.map(([, values]) => values.length)).toEqual([32, 9, 16, 2]);
    const ethereumCandidates = walletIdentityCandidates(prepared.request);
    expect(calls[0]?.[1][30]).toEqual(ethereumCandidates.map(({ version }) => version));
    expect(calls[0]?.[1][31]).toEqual(ethereumCandidates.map(({ value }) => value));
    expect(calls[0]?.[0]).toContain('$31::smallint[], $32::text[]');
    expect(JSON.stringify(calls[0]?.[1])).not.toContain(
      Buffer.alloc(32, 0x11).toString('base64url'),
    );
    expect(calls.every(([, , signal]) => signal instanceof AbortSignal)).toBe(true);
    expect(test.adapter.reviewResult(readCapability, read)).toBe(finalized);
    expect(test.adapter.reviewResult(readCapability, { ...read })).toBeNull();
    expect(test.adapter.reviewResult({ ...finalized }, read)).toBeNull();
    expect(test.adapter.reviewResult(readCapability, reconciliation)).toBeNull();
  });

  it('accepts canonical Solana identities and records a wallet broadcast without authority', async () => {
    const test = fixture();
    const prepared = await prepareConfirmed(test, SOLANA);
    const bound = await bindConfirmed(test, prepared, SOLANA);
    const request = broadcastRequest(bound.result.cursor, SOLANA_TRANSACTION);
    resolveOnce(test.query, queryResult(broadcastRow(prepared.request, SOLANA_TRANSACTION)));

    const capability = await test.adapter.recordBroadcast(request);
    const result = confirmed(test.adapter, capability, request);

    expect(result).toMatchObject({
      stage: 'BROADCAST_OUTCOME_AMBIGUOUS',
      chainTransactionId: SOLANA_TRANSACTION,
      apiMayBroadcast: false,
      mayResendTransaction: false,
      recoveryMode: 'READ_THEN_RECONCILE_ONLY',
    });
    expect(test.query).toHaveBeenCalledTimes(3);
    const solanaCandidates = walletIdentityCandidates(prepared.request);
    expect(test.query.mock.calls[0]?.[1][30]).toEqual(
      solanaCandidates.map(({ version }) => version),
    );
    expect(test.query.mock.calls[0]?.[1][31]).toEqual(solanaCandidates.map(({ value }) => value));
    expect(
      (test.query.mock.calls[2]?.[0] as string).includes(
        'record_mainnet_financial_action_broadcast_observation',
      ),
    ).toBe(true);
  });

  it('sorts rotated address candidates while accepting the immutable parent digest anchor', async () => {
    const keyV2 = createWalletRegistrationKey(
      'identity-hmac',
      2,
      Buffer.alloc(32, 0x22).toString('base64url'),
      'dormant-lifecycle-identity-v2',
    );
    const keyV3 = createWalletRegistrationKey(
      'identity-hmac',
      3,
      Buffer.alloc(32, 0x33).toString('base64url'),
      'dormant-lifecycle-identity-v3',
    );
    const rotatedRing = createWalletRegistrationKeyRing('identity-hmac', 3, [keyV3, keyV2]);
    const test = fixture(rotatedRing);
    const request = prepareRequest();
    resolveOnce(test.query, queryResult(preparedRow(request)));

    const capability = await test.adapter.prepare(request);
    expect(confirmed(test.adapter, capability, request).stage).toBe('PREPARED');

    const expected = walletIdentityCandidates(request, rotatedRing);
    expect(test.query.mock.calls[0]?.[1][30]).toEqual([2, 3]);
    expect(test.query.mock.calls[0]?.[1][31]).toEqual(expected.map(({ value }) => value));
    expect(test.query.mock.calls[0]?.[1][30]).not.toContain(1);
    expect(preparedRow(request).wallet_identity_digest_version).toBe(1);
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('derives different candidates for a different valid address and treats a database mismatch as unknown', async () => {
    const baseline = prepareRequest();
    const altered = frozenNull({
      ...baseline,
      intentInput: frozenNull({
        ...baseline.intentInput,
        walletAddress: '0x3333333333333333333333333333333333333333',
      }),
    });
    const test = fixture();
    rejectOnce(test.query, Object.assign(new Error('candidate mismatch'), { code: '22023' }));

    const capability = await test.adapter.prepare(altered);
    expect(unknownOutcome(test.adapter, capability, altered)).toMatchObject({
      operation: 'PREPARE',
      lastConfirmedCursor: null,
      automaticRetryAllowed: false,
      ledgerSettlementAuthority: false,
    });
    const baselineCandidates = walletIdentityCandidates(baseline).map(({ value }) => value);
    expect(test.query.mock.calls[0]?.[1][31]).not.toEqual(baselineCandidates);
    expect(test.query.mock.calls[0]?.[1][31]).toEqual(
      walletIdentityCandidates(altered).map(({ value }) => value),
    );
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('retains address digest candidates when the caller mutates plaintext after dispatch', async () => {
    const original = prepareRequest();
    const mutableIntent = { ...original.intentInput };
    const mutable = {
      ...original,
      intentInput: mutableIntent,
    } as PrepareDormantMainnetFinancialActionDurableRequestV1;
    const test = fixture();
    let resolveQuery: ((value: unknown) => void) | undefined;
    test.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );

    const pending = test.adapter.prepare(mutable);
    mutableIntent.walletAddress = '0x3333333333333333333333333333333333333333';
    resolveQuery?.(queryResult(preparedRow(original)));
    const capability = await pending;

    expect(confirmed(test.adapter, capability, mutable).stage).toBe('PREPARED');
    expect(test.query.mock.calls[0]?.[1][31]).toEqual(
      walletIdentityCandidates(original).map(({ value }) => value),
    );
    expect(test.query.mock.calls[0]?.[1][31]).not.toEqual(
      walletIdentityCandidates(mutable).map(({ value }) => value),
    );
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    [ETHEREUM, 'USDT'],
    [SOLANA, 'PYUSD'],
  ] as const)('binds the active %s %s registry asset', async (networkId, assetSymbol) => {
    const test = fixture();
    const request = prepareRequest(networkId, assetSymbol);
    resolveOnce(test.query, queryResult(preparedRow(request)));

    const capability = await test.adapter.prepare(request);
    const result = confirmed(test.adapter, capability, request);

    expect(result.stage).toBe('PREPARED');
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('binds UNKNOWN reconciliation to nonterminal ambiguous state', async () => {
    const test = fixture();
    const prepared = await prepareConfirmed(test);
    const bound = await bindConfirmed(test, prepared);
    const request = reconciliationRequest(bound.result.cursor, 'UNKNOWN');
    resolveOnce(test.query, queryResult(reconciliationRow(prepared.request, 'UNKNOWN')));

    const capability = await test.adapter.recordReconciliation(request);
    const result = confirmed(test.adapter, capability, request);

    expect(result.stage).toBe('RECONCILIATION_AMBIGUOUS');
    expect(result.terminal).toBe(false);
    expect(result.requiresManualReconciliation).toBe(false);
  });

  it.each(['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORGED_OUT'] as const)(
    'rejects caller-authored terminal reconciliation %s before database I/O',
    async (outcome) => {
      const test = fixture();
      const prepared = await prepareConfirmed(test);
      const bound = await bindConfirmed(test, prepared);
      const baseline = test.query.mock.calls.length;
      const request = frozenNull({
        ...reconciliationRequest(bound.result.cursor, 'PENDING'),
        outcome,
      });

      await expect(test.adapter.recordReconciliation(request as never)).rejects.toMatchObject({
        code: 'INVALID_RECONCILIATION_REQUEST',
      });
      expect(test.query).toHaveBeenCalledTimes(baseline);
    },
  );

  it('accepts a bound current replay and a legitimate later-state broadcast replay', async () => {
    const current = fixture();
    const currentPrepare = prepareRequest();
    resolveOnce(
      current.query,
      queryResult(preparedRow(currentPrepare, { record_outcome: 'REPLAYED' })),
    );
    const prepareCapability = await current.adapter.prepare(currentPrepare);
    const prepared = confirmed(current.adapter, prepareCapability, currentPrepare);
    const bind = bindRequest(prepared.cursor);
    resolveOnce(
      current.query,
      queryResult(boundRow(currentPrepare, ETHEREUM_TRANSACTION, { record_outcome: 'REPLAYED' })),
    );
    const bindCapability = await current.adapter.bindSubmission(bind);
    expect(confirmed(current.adapter, bindCapability, bind)).toMatchObject({
      databaseRecordOutcome: 'REPLAYED',
      stage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      effectiveAt: SIGNED_AT,
    });

    const later = fixture();
    const laterPrepared = await prepareConfirmed(later);
    const laterBound = await bindConfirmed(later, laterPrepared);
    const broadcast = broadcastRequest(laterBound.result.cursor);
    resolveOnce(
      later.query,
      queryResult(
        reconciliationRow(laterPrepared.request, 'PENDING', ETHEREUM, {
          record_outcome: 'REPLAYED',
          lifecycle_revision: '4',
          current_snapshot_sha256: 'ac'.repeat(32),
          effective_at: POST_EXPIRY_AT,
          recorded_at: '2026-09-07T12:05:01.000Z',
        }),
      ),
    );
    const laterCapability = await later.adapter.recordBroadcast(broadcast);
    expect(confirmed(later.adapter, laterCapability, broadcast)).toMatchObject({
      databaseRecordOutcome: 'REPLAYED',
      stage: 'RECONCILIATION_AMBIGUOUS',
      effectiveAt: POST_EXPIRY_AT,
    });
  });

  it('rejects extra, accessor, proxy, Symbol-branded, copied, and wrong-stage inputs pre-I/O', async () => {
    const test = fixture();
    const prepared = await prepareConfirmed(test);
    const bound = await bindConfirmed(test, prepared);
    const baseline = test.query.mock.calls.length;

    await expect(
      test.adapter.prepare({ ...prepareRequest(), extra: true } as never),
    ).rejects.toMatchObject({ code: 'INVALID_PREPARE_REQUEST' });
    await expect(
      test.adapter.prepare({
        ...prepareRequest(),
        walletIdentityDigestVersions: [1],
        walletIdentityDigestsHex: [digest('f')],
      } as never),
    ).rejects.toMatchObject({ code: 'INVALID_PREPARE_REQUEST' });

    const copiedCursor = { ...prepared.result.cursor };
    Object.defineProperty(copiedCursor, Symbol.for('forged-clma-brand'), {
      value: true,
      enumerable: false,
    });
    await expect(
      test.adapter.bindSubmission(bindRequest(copiedCursor as never)),
    ).rejects.toMatchObject({ code: 'INVALID_CLMA_DATABASE_CURSOR' });

    const plainCopy = { ...prepared.result.cursor };
    const descriptorCopy = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(prepared.result.cursor),
    );
    const structuredCopy = structuredClone(prepared.result.cursor);
    const proxiedGenuineCursor = new Proxy(prepared.result.cursor, {});
    for (const candidate of [plainCopy, descriptorCopy, structuredCopy, proxiedGenuineCursor]) {
      await expect(
        test.adapter.bindSubmission(bindRequest(candidate as never)),
      ).rejects.toMatchObject({ code: 'INVALID_CLMA_DATABASE_CURSOR' });
    }

    await expect(
      test.adapter.recordBroadcast(
        new Proxy(
          broadcastRequest(bound.result.cursor),
          {},
        ) as RecordDormantMainnetFinancialActionBroadcastRequestV1,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_BROADCAST_REQUEST' });

    const reconciliation = { ...reconciliationRequest(bound.result.cursor, 'PENDING') };
    Object.defineProperty(reconciliation, Symbol('extra'), { value: true, enumerable: false });
    await expect(test.adapter.recordReconciliation(reconciliation as never)).rejects.toMatchObject({
      code: 'INVALID_RECONCILIATION_REQUEST',
    });

    const read = { ...readRequest() } as Record<string, unknown>;
    const accountId = read.accountId;
    Object.defineProperty(read, 'accountId', { enumerable: true, get: () => accountId });
    await expect(test.adapter.read(read as never)).rejects.toMatchObject({
      code: 'INVALID_READ_REQUEST',
    });

    await expect(
      test.adapter.recordBroadcast(broadcastRequest(prepared.result.cursor)),
    ).rejects.toMatchObject({ code: 'INVALID_BROADCAST_REQUEST' });

    await expect(
      test.adapter.bindSubmission(
        frozenNull({ ...bindRequest(prepared.result.cursor), signedAt: ISSUED_AT }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_BIND_SUBMISSION_REQUEST' });
    await expect(
      test.adapter.recordBroadcast(
        frozenNull({ ...broadcastRequest(bound.result.cursor), observedAt: ISSUED_AT }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_BROADCAST_REQUEST' });
    await expect(
      test.adapter.recordBroadcast(
        frozenNull({
          ...broadcastRequest(bound.result.cursor),
          observationId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_BROADCAST_REQUEST' });
    await expect(
      test.adapter.recordReconciliation(
        frozenNull({
          ...reconciliationRequest(bound.result.cursor, 'PENDING'),
          observedAt: ISSUED_AT,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RECONCILIATION_REQUEST' });
    expect(test.query).toHaveBeenCalledTimes(baseline);
  });

  it('rejects cursor lookalikes across adapter instances and immutable row drift after dispatch', async () => {
    const first = fixture();
    const prepared = await prepareConfirmed(first);
    const second = fixture();

    await expect(
      second.adapter.bindSubmission(bindRequest(prepared.result.cursor)),
    ).rejects.toMatchObject({ code: 'INVALID_CLMA_DATABASE_CURSOR' });
    expect(second.query).not.toHaveBeenCalled();
    expect(
      second.adapter.reviewResult(await first.adapter.read(readRequest()), readRequest()),
    ).toBeNull();

    const request = bindRequest(prepared.result.cursor);
    resolveOnce(
      first.query,
      queryResult(
        boundRow(prepared.request, ETHEREUM_TRANSACTION, {
          provider_id: 'morpho',
          protocol_id: 'morpho-blue',
        }),
      ),
    );
    const capability = await first.adapter.bindSubmission(request);
    const result = unknownOutcome(first.adapter, capability, request);
    expect(result).toMatchObject({
      operation: 'BIND_SUBMISSION',
      recoveryMode: 'READ_THEN_RECONCILE_ONLY',
      reconciliationOnly: true,
      mayResendTransaction: false,
    });
    expect(first.query).toHaveBeenCalledTimes(3);
  });

  it('rejects impossible revisions, changed submission identity, and dropped retained anchors', async () => {
    const revision = fixture();
    const revisionPrepare = prepareRequest();
    const revisionRead = readRequest();
    resolveOnce(
      revision.query,
      queryResult(boundRow(revisionPrepare, ETHEREUM_TRANSACTION, { lifecycle_revision: '3' })),
    );
    expect(
      unknownOutcome(revision.adapter, await revision.adapter.read(revisionRead), revisionRead)
        .operation,
    ).toBe('READ');

    const submission = fixture();
    const submissionPrepared = await prepareConfirmed(submission);
    const submissionBound = await bindConfirmed(submission, submissionPrepared);
    const broadcast = broadcastRequest(submissionBound.result.cursor);
    resolveOnce(
      submission.query,
      queryResult(
        broadcastRow(submissionPrepared.request, ETHEREUM_TRANSACTION, {
          submission_fingerprint_sha256: 'ce'.repeat(32),
        }),
      ),
    );
    expect(
      unknownOutcome(
        submission.adapter,
        await submission.adapter.recordBroadcast(broadcast),
        broadcast,
      ).operation,
    ).toBe('RECORD_BROADCAST');

    const retained = fixture();
    const retainedPrepared = await prepareConfirmed(retained);
    const retainedBound = await bindConfirmed(retained, retainedPrepared);
    const pending = reconciliationRequest(retainedBound.result.cursor, 'PENDING');
    resolveOnce(
      retained.query,
      queryResult(reconciliationRow(retainedPrepared.request, 'PENDING')),
    );
    const pendingResult = confirmed(
      retained.adapter,
      await retained.adapter.recordReconciliation(pending),
      pending,
    );
    const sameEventReplay = frozenNull({ ...pending, cursor: pendingResult.cursor });
    resolveOnce(
      retained.query,
      queryResult(
        reconciliationRow(retainedPrepared.request, 'PENDING', ETHEREUM, {
          record_outcome: 'REPLAYED',
        }),
      ),
    );
    expect(
      confirmed(
        retained.adapter,
        await retained.adapter.recordReconciliation(sameEventReplay),
        sameEventReplay,
      ).databaseRecordOutcome,
    ).toBe('REPLAYED');
    const beforeInvalidContinuations = retained.query.mock.calls.length;
    await expect(
      retained.adapter.recordReconciliation(
        frozenNull({
          ...reconciliationRequest(pendingResult.cursor, 'PENDING'),
          finalizedPosition: '98',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RECONCILIATION_REQUEST' });
    await expect(
      retained.adapter.recordReconciliation(
        frozenNull({
          ...reconciliationRequest(pendingResult.cursor, 'PENDING'),
          transactionBlockId: ETHEREUM_FINALIZED_BLOCK,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RECONCILIATION_REQUEST' });
    await expect(
      retained.adapter.recordReconciliation(
        frozenNull({
          ...reconciliationRequest(pendingResult.cursor, 'PENDING'),
          finalizedBlockId: ETHEREUM_BLOCK,
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RECONCILIATION_REQUEST' });
    expect(retained.query).toHaveBeenCalledTimes(beforeInvalidContinuations);
    const unknown = reconciliationRequest(pendingResult.cursor, 'UNKNOWN');
    resolveOnce(
      retained.query,
      queryResult(
        reconciliationRow(retainedPrepared.request, 'UNKNOWN', ETHEREUM, {
          lifecycle_revision: '4',
          current_snapshot_sha256: 'ad'.repeat(32),
        }),
      ),
    );
    expect(
      unknownOutcome(
        retained.adapter,
        await retained.adapter.recordReconciliation(unknown),
        unknown,
      ).operation,
    ).toBe('RECORD_RECONCILIATION');
  });

  it('rejects same-revision replay drift in retained anchors and database time', async () => {
    const test = fixture();
    const prepared = await prepareConfirmed(test);
    const bound = await bindConfirmed(test, prepared);
    const unknown = reconciliationRequest(bound.result.cursor, 'UNKNOWN');
    resolveOnce(test.query, queryResult(reconciliationRow(prepared.request, 'UNKNOWN')));
    const unknownResult = confirmed(
      test.adapter,
      await test.adapter.recordReconciliation(unknown),
      unknown,
    );
    const replay = frozenNull({ ...unknown, cursor: unknownResult.cursor });
    resolveOnce(
      test.query,
      queryResult(
        reconciliationRow(prepared.request, 'UNKNOWN', ETHEREUM, {
          record_outcome: 'REPLAYED',
          last_observed_transaction_position: '100',
          last_observed_transaction_block_id: ETHEREUM_BLOCK,
          last_observed_transaction_block_identity_sha256: BLOCK_IDENTITY_DIGEST,
        }),
      ),
    );

    const result = unknownOutcome(
      test.adapter,
      await test.adapter.recordReconciliation(replay),
      replay,
    );
    expect(result).toMatchObject({
      operation: 'RECORD_RECONCILIATION',
      recoveryMode: 'READ_THEN_RECONCILE_ONLY',
      mayResendTransaction: false,
    });
    resolveOnce(
      test.query,
      queryResult(
        reconciliationRow(prepared.request, 'UNKNOWN', ETHEREUM, {
          record_outcome: 'REPLAYED',
          recorded_at: '2026-09-07T12:02:02.000Z',
        }),
      ),
    );
    expect(
      unknownOutcome(test.adapter, await test.adapter.recordReconciliation(replay), replay)
        .operation,
    ).toBe('RECORD_RECONCILIATION');
    expect(test.query).toHaveBeenCalledTimes(5);
  });

  it('rejects volatile cursor reuse and structurally valid authoritative-row tampering', async () => {
    const test = fixture();
    const prepare = prepareRequest();
    const read = readRequest();
    const uint256Overflow = (1n << 256n).toString();
    const rows = [
      preparedRow(prepare, {
        record_outcome: 'READ',
        current_snapshot_sha256: VOLATILE_COMMITMENT,
      }),
      preparedRow(prepare, {
        record_outcome: 'READ',
        intent_record_fingerprint_sha256: VOLATILE_COMMITMENT,
      }),
      preparedRow(prepare, {
        record_outcome: 'READ',
        current_snapshot_sha256: INTENT_FINGERPRINT,
      }),
      preparedRow(prepare, {
        record_outcome: 'READ',
        asset_registry_fingerprint_sha256: 'aa'.repeat(32),
      }),
      preparedRow(prepare, {
        record_outcome: 'READ',
        asset_symbol: 'USDT',
      }),
      preparedRow(prepare, {
        record_outcome: 'READ',
        yield_operation_id: WALLET_ID,
      }),
      preparedRow(prepare, {
        record_outcome: 'READ',
        amount_atomic: uint256Overflow,
        allowance_amount_atomic: uint256Overflow,
      }),
    ];

    for (const row of rows) {
      resolveOnce(test.query, queryResult(row));
      const capability = await test.adapter.read(read);
      expect(unknownOutcome(test.adapter, capability, read).operation).toBe('READ');
    }
    expect(test.query).toHaveBeenCalledTimes(rows.length);
  });

  it('issues DATABASE_OUTCOME_UNKNOWN exactly once for every operation and never retries', async () => {
    const prepareFailure = fixture();
    const prepare = prepareRequest();
    rejectOnce(prepareFailure.query, new Error('postgres://secret'));
    const prepareUnknown = unknownOutcome(
      prepareFailure.adapter,
      await prepareFailure.adapter.prepare(prepare),
      prepare,
    );
    expect(prepareUnknown).toMatchObject({ operation: 'PREPARE', recoveryMode: 'READ_ONLY' });
    expect(prepareFailure.query).toHaveBeenCalledTimes(1);

    const readFailure = fixture();
    const read = readRequest();
    readFailure.query.mockImplementationOnce(() => {
      throw new Error('sync database failure');
    });
    const readUnknown = unknownOutcome(
      readFailure.adapter,
      await readFailure.adapter.read(read),
      read,
    );
    expect(readUnknown).toMatchObject({ operation: 'READ', lastConfirmedCursor: null });
    expect(readFailure.query).toHaveBeenCalledTimes(1);

    for (const nonPromise of [
      queryResult(preparedRow(prepareRequest(), { record_outcome: 'READ' })),
      { then: () => Promise.resolve(queryResult(preparedRow(prepareRequest()))) },
    ]) {
      const invalidPending = fixture();
      const invalidPendingRead = readRequest();
      invalidPending.query.mockImplementationOnce(() => nonPromise as unknown as Promise<unknown>);
      expect(
        unknownOutcome(
          invalidPending.adapter,
          await invalidPending.adapter.read(invalidPendingRead),
          invalidPendingRead,
        ).operation,
      ).toBe('READ');
      expect(invalidPending.query).toHaveBeenCalledTimes(1);
    }

    const bindFailure = fixture();
    const bindPrepared = await prepareConfirmed(bindFailure);
    const bind = bindRequest(bindPrepared.result.cursor);
    resolveOnce(bindFailure.query, {
      rows: [
        boundRow(bindPrepared.request, ETHEREUM_TRANSACTION),
        boundRow(bindPrepared.request, ETHEREUM_TRANSACTION),
      ],
    });
    const bindUnknown = unknownOutcome(
      bindFailure.adapter,
      await bindFailure.adapter.bindSubmission(bind),
      bind,
    );
    expect(bindUnknown.lastConfirmedCursor).toBe(bindPrepared.result.cursor);
    expect(bindFailure.query).toHaveBeenCalledTimes(2);

    const broadcastFailure = fixture();
    const broadcastPrepared = await prepareConfirmed(broadcastFailure);
    const broadcastBound = await bindConfirmed(broadcastFailure, broadcastPrepared);
    const controller = new AbortController();
    const broadcast = broadcastRequest(
      broadcastBound.result.cursor,
      ETHEREUM_TRANSACTION,
      controller.signal,
    );
    broadcastFailure.query.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(queryResult(broadcastRow(broadcastPrepared.request)));
    });
    const broadcastUnknown = unknownOutcome(
      broadcastFailure.adapter,
      await broadcastFailure.adapter.recordBroadcast(broadcast),
      broadcast,
    );
    expect(broadcastUnknown.lastConfirmedCursor).toBe(broadcastBound.result.cursor);
    expect(broadcastFailure.query).toHaveBeenCalledTimes(3);

    const reconciliationFailure = fixture();
    const reconciliationPrepared = await prepareConfirmed(reconciliationFailure);
    const reconciliationBound = await bindConfirmed(reconciliationFailure, reconciliationPrepared);
    const reconciliation = reconciliationRequest(reconciliationBound.result.cursor, 'PENDING');
    resolveOnce(
      reconciliationFailure.query,
      queryResult({ ...reconciliationRow(reconciliationPrepared.request, 'PENDING'), extra: true }),
    );
    const reconciliationUnknown = unknownOutcome(
      reconciliationFailure.adapter,
      await reconciliationFailure.adapter.recordReconciliation(reconciliation),
      reconciliation,
    );
    expect(reconciliationUnknown.lastConfirmedCursor).toBe(reconciliationBound.result.cursor);
    expect(reconciliationFailure.query).toHaveBeenCalledTimes(3);

    for (const outcome of [
      prepareUnknown,
      readUnknown,
      bindUnknown,
      broadcastUnknown,
      reconciliationUnknown,
    ]) {
      expect(outcome).toMatchObject({
        outcome: 'DATABASE_OUTCOME_UNKNOWN',
        apiMaySign: false,
        apiMayBroadcast: false,
        mayResendTransaction: false,
        automaticRetryAllowed: false,
        ledgerSettlementAuthority: false,
      });
    }
  });

  it('does not rebind an issued result when the same request replaces its signal', async () => {
    const test = fixture();
    const mutable = {
      ...readRequest(),
    } as ReadDormantMainnetFinancialActionDurableRequestV1 & { signal: AbortSignal };
    test.query.mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });

    const capability = await test.adapter.read(mutable);
    expect(test.adapter.reviewResult(capability, mutable)).not.toBeNull();

    mutable.signal = new AbortController().signal;
    expect(test.adapter.reviewResult(capability, mutable)).toBeNull();
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('retains the exact issued cursor when the caller mutates a request during dispatch', async () => {
    const test = fixture();
    const prepared = await prepareConfirmed(test);
    const mutable = {
      ...bindRequest(prepared.result.cursor),
    } as unknown as BindDormantMainnetFinancialActionSubmissionRequestV1 & Record<string, unknown>;
    const mutableRecord = mutable as unknown as Record<string, unknown>;
    let rejectQuery: ((reason: Error) => void) | undefined;
    test.query.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectQuery = reject;
        }),
    );

    const pending = test.adapter.bindSubmission(mutable);
    mutableRecord.cursor = {
      ...prepared.result.cursor,
    } as DormantMainnetFinancialActionClmaDatabaseCursorV1;
    mutableRecord.transactionId = `0x${'f'.repeat(64)}`;
    rejectQuery?.(new Error('lost result'));
    const capability = await pending;
    const result = unknownOutcome(test.adapter, capability, mutable);

    expect(result.lastConfirmedCursor).toBe(prepared.result.cursor);
    expect(result.reconciliationOnly).toBe(true);
    expect(test.query).toHaveBeenCalledTimes(2);
  });
});
