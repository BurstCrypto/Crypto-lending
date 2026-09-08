import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
  type ProduceProviderPositionChainAnchorEvidenceRequestV1,
} from '../../mainnet-platforms/application/dormant-provider-position-chain-anchor-evidence.producer';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
  type ProviderPositionChainAnchorEvidenceRecorderPort,
  type RecordProviderPositionChainAnchorEvidenceRequestV2,
} from '../../mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-recorder.port';
import type { PostgresService } from '../../infrastructure/database/postgres.service';
import { parseWalletAddress } from '../../wallets/domain/wallet-identity';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE,
  type DormantMainnetFinancialActionLifecycleDurablePort,
  type ReadDormantMainnetFinancialActionDurableRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE,
  type DormantMainnetFinancialActionEffectiveSafetyReaderPort,
} from '../application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_ISSUE_USE,
  type IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  type IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1,
  type MainnetFinancialActionFinalityPrerequisiteIssuanceV1,
  type MainnetFinancialActionFinalityPrerequisiteIssuerClock,
  type MainnetFinancialActionFinalityWalletReaderPort,
} from '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port';
import {
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_READ_SQL,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_READ_SQL,
  PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter,
} from './postgres-dormant-mainnet-financial-action-finality-prerequisite.adapter';
import type { MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_DATABASE_ROW_COLUMNS } from './postgres-dormant-mainnet-financial-action-finality-prerequisite.adapter';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const INTENT_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ID = '33333333-3333-4333-8333-333333333333';
const OBSERVATION_ID = '44444444-4444-4444-8444-444444444444';
const CORRELATION_ID = '55555555-5555-4555-8555-555555555555';
const SOURCE_AUTHORITY_ID = '66666666-6666-4666-8666-666666666666';
const DEPLOYMENT_AUTHORITY_ID = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-09-07T12:00:00.000Z';
const DEADLINE = '2026-09-07T12:00:20.000Z';
const AUTHORITY_EXPIRY = '2026-09-07T12:00:15.000Z';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function frozen<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function frozenAccessorRecord(
  value: object,
  key: string,
  accessorValue: unknown,
): Readonly<object> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  descriptors[key] = {
    configurable: false,
    enumerable: true,
    get: () => accessorValue,
  };
  return Object.freeze(Object.defineProperties(Object.create(null) as object, descriptors));
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (resolvePromise === undefined || rejectPromise === undefined) {
    throw new Error('deferred promise was not initialized');
  }
  return Object.freeze({ promise, resolve: resolvePromise, reject: rejectPromise });
}

function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let output = '';
  while (value > 0n) {
    output = BASE58_ALPHABET[Number(value % 58n)] + output;
    value /= 58n;
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading += 1;
  return '1'.repeat(leading) + output;
}

type Network = 'eip155:1' | 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

interface TestContext {
  readonly adapter: PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter;
  readonly queryWithCancellation: jest.Mock;
  readonly request: IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1;
  readonly abortController: AbortController;
  readonly signal: AbortSignal;
  readonly lifecycle: DormantMainnetFinancialActionLifecycleDurablePort;
  readonly lifecycleCapability: object;
  readonly wallet: MainnetFinancialActionFinalityWalletReaderPort;
  readonly walletAddress: ReturnType<typeof parseWalletAddress>;
  readonly chainEvidence: ProviderPositionChainAnchorEvidenceRecorderPort;
  readonly chainEvidenceCapability: object;
  readonly clock: MainnetFinancialActionFinalityPrerequisiteIssuerClock;
  readonly row: Record<
    (typeof MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_DATABASE_ROW_COLUMNS)[number],
    unknown
  >;
}

function setup(
  networkId: Network,
  clockTimes: readonly string[] = [NOW],
  lifecycleStage:
    | 'WALLET_SIGNED_SUBMISSION_BOUND'
    | 'BROADCAST_OUTCOME_AMBIGUOUS'
    | 'RECONCILIATION_AMBIGUOUS' = 'BROADCAST_OUTCOME_AMBIGUOUS',
  walletStatus: 'ACTIVE' | 'REVOKED' = 'ACTIVE',
): TestContext {
  const abortController = new AbortController();
  const signal = abortController.signal;
  const isEthereum = networkId === 'eip155:1';
  const transactionId = isEthereum
    ? `0x${'e'.repeat(64)}`
    : encodeBase58(new Uint8Array(64).fill(7));
  const blockId = isEthereum ? `0x${'a'.repeat(64)}` : encodeBase58(new Uint8Array(32).fill(8));
  const finalizedBlockId = isEthereum
    ? `0x${'b'.repeat(64)}`
    : encodeBase58(new Uint8Array(32).fill(9));
  const chainAnchor = isEthereum
    ? frozen({ kind: 'EVM_BLOCK' as const, blockNumber: '100', blockHash: blockId })
    : frozen({ kind: 'SOLANA_SLOT' as const, slot: '100', root: '90' });
  const finalizedHead = isEthereum
    ? frozen({ kind: 'EVM_BLOCK' as const, blockNumber: '110', blockHash: finalizedBlockId })
    : frozen({ kind: 'SOLANA_SLOT' as const, slot: '120', root: '110' });
  const signedBound = lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND';
  const reconciliation = lifecycleStage === 'RECONCILIATION_AMBIGUOUS';
  const lifecycleRevision = signedBound ? '2' : reconciliation ? '4' : '3';
  const lifecycleSnapshotSha256 = signedBound
    ? '7'.repeat(64)
    : reconciliation
      ? '8'.repeat(64)
      : '3'.repeat(64);
  const lifecycleRequest = frozen({
    durableLifecycleVersion: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
    mayAuthorizeFinancialAction: false as const,
    accountId: ACCOUNT_ID,
    intentId: INTENT_ID,
    signal,
  }) satisfies ReadDormantMainnetFinancialActionDurableRequestV1;
  const lifecycleCapability = frozen({
    durableLifecycleVersion: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    apiMaySign: false as const,
    apiMayBroadcast: false as const,
    mayResendTransaction: false as const,
    automaticRetryAllowed: false as const,
    ledgerSettlementAuthority: false as const,
    outcome: 'DATABASE_STATE_CONFIRMED' as const,
    operation: 'READ' as const,
    databaseRecordOutcome: 'READ' as const,
    cursor: frozen({
      schemaVersion: 1 as const,
      source: 'MIGRATION_0033_DATABASE' as const,
      fingerprintEncoding: 'CLMA-FP-1' as const,
      accountId: ACCOUNT_ID,
      intentId: INTENT_ID,
      networkId,
      lifecycleRevision,
      currentSnapshotSha256: lifecycleSnapshotSha256,
      intentRecordFingerprintSha256: '2'.repeat(64),
    }),
    volatileIntentCommitmentSha256: '1'.repeat(64),
    stage: lifecycleStage,
    chainTransactionId: transactionId,
    submissionFingerprintSha256: '4'.repeat(64),
    observationId: signedBound ? null : OBSERVATION_ID,
    broadcastOutcome: signedBound || reconciliation ? null : ('WALLET_REPORTED_AMBIGUOUS' as const),
    reconciliationOutcome: reconciliation ? ('PENDING' as const) : null,
    transactionPosition: reconciliation ? '100' : null,
    transactionBlockId: reconciliation ? blockId : null,
    finalizedPosition: reconciliation ? '90' : null,
    finalizedBlockId: reconciliation ? finalizedBlockId : null,
    lastObservedTransactionPosition: reconciliation ? '100' : null,
    lastObservedTransactionBlockId: reconciliation ? blockId : null,
    effectiveAt: '2026-09-07T11:50:00.000Z',
    expiresAt: '2026-09-07T11:55:00.000Z',
    recordedAt: '2026-09-07T11:50:00.000Z',
    terminal: false,
    requiresManualReconciliation: false,
    databaseReplayProtectionEnforced: true as const,
    recoveryMode: 'READ_THEN_RECONCILE_ONLY' as const,
  });
  const producerRequest = frozen({
    producerVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    networkId,
    sourceFamilyId: 'primary-family',
    sourceId: 'primary-source',
    sourceKind: 'RPC' as const,
    sourceObservationId:
      chainAnchor.kind === 'EVM_BLOCK'
        ? `ethereum-block-${chainAnchor.blockNumber}`
        : `solana-slot-${chainAnchor.slot}`,
    continuityFloor: chainAnchor,
    chainAnchor,
    observedAt: NOW,
    deadlineAt: DEADLINE,
    signal,
  }) satisfies ProduceProviderPositionChainAnchorEvidenceRequestV1;
  const chainEvidenceRequest = frozen({
    recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
    mayAuthorizeFinancialAction: false as const,
    producerCapability: frozen({}),
    producerRequest,
    signal,
  }) satisfies RecordProviderPositionChainAnchorEvidenceRequestV2;
  const chainEvidenceCapability = frozen({
    recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    producerDeadlineAt: DEADLINE,
    outcome: 'RECORDED' as const,
    recordOutcome: 'RECORDED' as const,
    recordIntentFingerprintSha256: '3'.repeat(64),
    evidenceFingerprintSha256: '4'.repeat(64),
    deadlineBindingSha256: '5'.repeat(64),
    evidenceRecordedAt: NOW,
    resolvedAt: NOW,
  });
  const lifecycle = {
    durableLifecycleVersion: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
    reviewResult: jest.fn((capability, request) =>
      capability === lifecycleCapability && request === lifecycleRequest
        ? lifecycleCapability
        : null,
    ),
  } as unknown as DormantMainnetFinancialActionLifecycleDurablePort;
  const chainEvidence = {
    recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
    reviewResult: jest.fn((capability, request) =>
      capability === chainEvidenceCapability && request === chainEvidenceRequest
        ? chainEvidenceCapability
        : null,
    ),
  } as unknown as ProviderPositionChainAnchorEvidenceRecorderPort;
  const effectiveSafety = {
    sidecarVersion: DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION,
    reviewResult: jest.fn(() => null),
  } as unknown as DormantMainnetFinancialActionEffectiveSafetyReaderPort;
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const asset = registry.assets.find(
    (item) => item.networkId === networkId && item.stablecoin === 'USDC',
  );
  if (asset === undefined) throw new Error('missing fixture asset');
  const walletAddress = parseWalletAddress(
    networkId,
    isEthereum ? `0x${'1'.repeat(40)}` : encodeBase58(new Uint8Array(32).fill(10)),
  );
  const walletCapability = frozen({});
  let walletRequest: unknown;
  let walletResult: object | undefined;
  const wallet = {
    readerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
    readWallet: jest.fn((request) => {
      walletRequest = request;
      const exact = request as unknown as Record<string, unknown>;
      walletResult = frozen({
        readerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
        use: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
        mayAuthorizeFinancialAction: false as const,
        mayPersist: false as const,
        accountId: exact.accountId,
        intentId: exact.intentId,
        walletRegistrationId: exact.walletRegistrationId,
        networkId: exact.networkId,
        walletIdentityDigestVersion: exact.walletIdentityDigestVersion,
        walletIdentityDigestHex: exact.walletIdentityDigestHex,
        lifecycleRevision: exact.lifecycleRevision,
        lifecycleSnapshotSha256: exact.lifecycleSnapshotSha256,
        lifecycleStage: exact.lifecycleStage,
        purpose: exact.purpose,
        walletStatus,
        revokedAt: walletStatus === 'REVOKED' ? '2026-09-07T11:59:00.000Z' : null,
        verifiedAt: NOW,
        walletAddress,
      });
      return Promise.resolve(walletCapability);
    }),
    verifyWallet: jest.fn((capability, request) =>
      capability === walletCapability && request === walletRequest ? walletResult : null,
    ),
  } as MainnetFinancialActionFinalityWalletReaderPort;
  const row: Record<
    (typeof MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_DATABASE_ROW_COLUMNS)[number],
    unknown
  > = {
    account_id: ACCOUNT_ID,
    intent_id: INTENT_ID,
    intent_record_fingerprint_sha256: '2'.repeat(64),
    wallet_registration_id: WALLET_ID,
    wallet_identity_digest_version: 1,
    wallet_identity_digest_hex: '1'.repeat(64),
    network_id: networkId,
    lifecycle_revision: lifecycleRevision,
    lifecycle_snapshot_sha256: lifecycleSnapshotSha256,
    lifecycle_stage: lifecycleStage,
    transaction_id: transactionId,
    wallet_signed_payload_sha256: '5'.repeat(64),
    wallet_signature_evidence_sha256: '6'.repeat(64),
    chain_anchor_evidence_fingerprint_sha256: '4'.repeat(64),
    chain_anchor_json: JSON.stringify(chainAnchor),
    agreed_finalized_head_json: JSON.stringify(finalizedHead),
    chain_anchor_evidence_expires_at: AUTHORITY_EXPIRY,
    source_authority_id: SOURCE_AUTHORITY_ID,
    source_authority_fingerprint_sha256: '7'.repeat(64),
    source_authority_expires_at: AUTHORITY_EXPIRY,
    source_pair_approval_id: 'pair-1',
    source_pair_registry_fingerprint_sha256: '8'.repeat(64),
    primary_source_family_id: 'primary-family',
    primary_source_id: 'primary-source',
    primary_source_kind: 'RPC',
    corroborating_source_family_id: 'corroborating-family',
    corroborating_source_id: 'corroborating-source',
    corroborating_source_kind: 'INDEXER',
    deployment_authority_id: DEPLOYMENT_AUTHORITY_ID,
    deployment_authority_fingerprint_sha256: '9'.repeat(64),
    deployment_authority_expires_at: AUTHORITY_EXPIRY,
    primary_deployment_manifest_fingerprint_sha256: 'a'.repeat(64),
    primary_observed_identity_fingerprint_sha256: 'b'.repeat(64),
    corroborating_deployment_manifest_fingerprint_sha256: 'c'.repeat(64),
    corroborating_observed_identity_fingerprint_sha256: 'd'.repeat(64),
    provider_id: isEthereum ? 'aave' : 'kamino',
    protocol_id: isEthereum ? 'aave-v3' : 'kamino-lend',
    market_id: isEthereum ? `0x${'2'.repeat(40)}` : encodeBase58(new Uint8Array(32).fill(11)),
    asset_registry_version: registry.version,
    asset_registry_fingerprint_sha256: registry.fingerprintSha256,
    asset_symbol: asset.stablecoin,
    asset_identity: asset.identity,
    asset_decimals: asset.decimals,
    action_type: 'SUPPLY',
    amount_atomic: '1000000',
    terminal_transition_fingerprint_sha256: null,
    original_admission_fingerprint_sha256: null,
    terminal_transaction_position: null,
    terminal_transaction_block_id: null,
    expected_review_revision: null,
    expected_previous_review_fingerprint_sha256: null,
    effective_safety_state: null,
    verified_at: NOW,
  };
  const queryWithCancellation = jest.fn(() => Promise.resolve({ rows: [row] }));
  const postgres = { queryWithCancellation } as unknown as PostgresService;
  let clockIndex = 0;
  const clock: MainnetFinancialActionFinalityPrerequisiteIssuerClock = {
    now: () => {
      const value = clockTimes[Math.min(clockIndex, clockTimes.length - 1)];
      clockIndex += 1;
      if (value === undefined) throw new Error('missing clock fixture');
      return new Date(value);
    },
  };
  const adapter = new PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter(
    lifecycle,
    chainEvidence,
    effectiveSafety,
    wallet,
    postgres,
    clock,
  );
  const request = frozen({
    issuerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION,
    use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_ISSUE_USE,
    purpose: 'RECONCILIATION_ADMISSION' as const,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    lifecycleCapability,
    lifecycleRequest,
    chainEvidenceCapability,
    chainEvidenceRequest,
    correlationId: CORRELATION_ID,
    deadlineAt: DEADLINE,
    signal,
    observationId: OBSERVATION_ID,
  }) satisfies IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1;
  return {
    adapter,
    queryWithCancellation,
    request,
    abortController,
    signal,
    lifecycle,
    lifecycleCapability,
    wallet,
    walletAddress,
    chainEvidence,
    chainEvidenceCapability,
    clock,
    row,
  };
}

interface PostTestContext {
  readonly adapter: PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter;
  readonly queryWithCancellation: jest.Mock;
  readonly request: IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1;
  readonly signal: AbortSignal;
  readonly wallet: MainnetFinancialActionFinalityWalletReaderPort;
  readonly walletAddress: ReturnType<typeof parseWalletAddress>;
  readonly lifecycle: DormantMainnetFinancialActionLifecycleDurablePort;
  readonly effectiveSafety: DormantMainnetFinancialActionEffectiveSafetyReaderPort;
  readonly row: TestContext['row'];
}

function requestWithLifecycleCapability(
  test: TestContext,
  lifecycleCapability: object,
): IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1 {
  const request = frozen({ ...test.request, lifecycleCapability });
  (test.lifecycle.reviewResult as jest.Mock).mockImplementation((capability, reviewedRequest) =>
    capability === lifecycleCapability && reviewedRequest === test.request.lifecycleRequest
      ? lifecycleCapability
      : null,
  );
  return request;
}

async function expectLifecycleRejectedBeforeIo(
  test: TestContext,
  lifecycleCapability: object,
  expectedCode: 'INVALID_REQUEST' | 'UPSTREAM_UNAVAILABLE' = 'UPSTREAM_UNAVAILABLE',
): Promise<void> {
  const request = requestWithLifecycleCapability(test, lifecycleCapability);
  await expect(test.adapter.issueReconciliationPrerequisite(request)).rejects.toMatchObject({
    code: expectedCode,
  });
  expect(test.queryWithCancellation).not.toHaveBeenCalled();
  expect(test.wallet.readWallet).not.toHaveBeenCalled();
}

function postRequestWithLifecycleCapability(
  test: PostTestContext,
  lifecycleCapability: object,
): IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1 {
  const request = frozen({ ...test.request, lifecycleCapability });
  (test.lifecycle.reviewResult as jest.Mock).mockImplementation((capability, reviewedRequest) =>
    capability === lifecycleCapability && reviewedRequest === test.request.lifecycleRequest
      ? lifecycleCapability
      : null,
  );
  return request;
}

async function expectPostLifecycleRejectedBeforeIo(
  test: PostTestContext,
  lifecycleCapability: object,
): Promise<void> {
  const request = postRequestWithLifecycleCapability(test, lifecycleCapability);
  await expect(test.adapter.issuePostFinalityPrerequisite(request)).rejects.toMatchObject({
    code: 'UPSTREAM_UNAVAILABLE',
  });
  expect(test.queryWithCancellation).not.toHaveBeenCalled();
  expect(test.wallet.readWallet).not.toHaveBeenCalled();
}

function setupPost(
  networkId: Network,
  reviewRevision = '0',
  terminalTransactionPosition = '100',
  clockTimes: readonly string[] = [NOW],
  effectiveSafetyState:
    | 'AUTHENTICATED_FINALITY_RECORDED'
    | 'POST_FINALITY_REVIEW_INCONCLUSIVE' = 'AUTHENTICATED_FINALITY_RECORDED',
  lifecycleStage: 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE' = 'FINALIZED_SUCCESS',
): PostTestContext {
  const common = setup(networkId, clockTimes);
  const lifecycleRequest = common.request.lifecycleRequest;
  const transactionId = common.row.transaction_id as string;
  const terminalBlockId =
    networkId === 'eip155:1' ? `0x${'a'.repeat(64)}` : encodeBase58(new Uint8Array(32).fill(8));
  const previousReviewFingerprintSha256 = reviewRevision === '0' ? null : 'f'.repeat(64);
  const baseLifecycle = common.request.lifecycleCapability as Record<string, unknown>;
  const baseCursor = baseLifecycle.cursor as Record<string, unknown>;
  const lifecycleCapability = frozen({
    ...baseLifecycle,
    cursor: frozen({
      ...baseCursor,
      lifecycleRevision: '4',
      currentSnapshotSha256: '8'.repeat(64),
    }),
    stage: lifecycleStage,
    chainTransactionId: transactionId,
    observationId: OBSERVATION_ID,
    broadcastOutcome: null,
    reconciliationOutcome: lifecycleStage,
    transactionPosition: terminalTransactionPosition,
    transactionBlockId: terminalBlockId,
    finalizedPosition: terminalTransactionPosition,
    finalizedBlockId: terminalBlockId,
    lastObservedTransactionPosition: terminalTransactionPosition,
    lastObservedTransactionBlockId: terminalBlockId,
    terminal: true,
    requiresManualReconciliation: false,
    recoveryMode: 'NONE' as const,
  });
  const lifecycle = {
    durableLifecycleVersion: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
    reviewResult: jest.fn((capability, request) =>
      capability === lifecycleCapability && request === lifecycleRequest
        ? lifecycleCapability
        : null,
    ),
  } as unknown as DormantMainnetFinancialActionLifecycleDurablePort;
  const effectiveSafetyRequest = frozen({
    accountId: ACCOUNT_ID,
    intentId: INTENT_ID,
    signal: common.signal,
  });
  const effectiveSafetyCapability = frozen({
    sidecarVersion: DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    mayConstructTransaction: false as const,
    apiMaySign: false as const,
    apiMayBroadcast: false as const,
    mayResendTransaction: false as const,
    automaticRetryAllowed: false as const,
    ledgerSettlementAuthority: false as const,
    outcome: 'DATABASE_STATE_CONFIRMED' as const,
    operation: 'READ_EFFECTIVE_SAFETY_STATE' as const,
    databaseRecordOutcome: 'READ' as const,
    authenticatedReconciliation: true,
    recordedReviewRevision: null,
    recordedReviewFingerprintSha256: null,
    recordedReviewDisposition: null,
    lifecycleStage,
    effectiveSafetyState,
    reviewRevision,
    reviewFingerprintSha256: previousReviewFingerprintSha256,
    latestReviewDisposition:
      reviewRevision === '0'
        ? null
        : effectiveSafetyState === 'POST_FINALITY_REVIEW_INCONCLUSIVE'
          ? ('REVIEW_INCONCLUSIVE' as const)
          : ('FINALITY_REAFFIRMED' as const),
    requiresManualReview: effectiveSafetyState === 'POST_FINALITY_REVIEW_INCONCLUSIVE',
    recordedAt: null,
    recoveryMode: 'READ_ONLY' as const,
    cursor: frozen({
      schemaVersion: 1 as const,
      source: 'MIGRATION_0035_DATABASE' as const,
      fingerprintEncoding: 'CLMA-FP-1' as const,
      accountId: ACCOUNT_ID,
      intentId: INTENT_ID,
      networkId,
      terminalRevision: '4',
      terminalSnapshotSha256: '8'.repeat(64),
      terminalTransitionFingerprintSha256: '1'.repeat(64),
      originalAdmissionFingerprintSha256: '2'.repeat(64),
      chainTransactionId: transactionId,
      transactionPosition: terminalTransactionPosition,
      transactionBlockId: terminalBlockId,
      reviewRevision,
      reviewFingerprintSha256: previousReviewFingerprintSha256,
    }),
  });
  const effectiveSafety = {
    sidecarVersion: DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION,
    reviewResult: jest.fn((capability, request) =>
      capability === effectiveSafetyCapability && request === effectiveSafetyRequest
        ? effectiveSafetyCapability
        : null,
    ),
  } as unknown as DormantMainnetFinancialActionEffectiveSafetyReaderPort;
  const row = {
    ...common.row,
    lifecycle_revision: '4',
    lifecycle_snapshot_sha256: '8'.repeat(64),
    lifecycle_stage: lifecycleStage,
    terminal_transition_fingerprint_sha256: '1'.repeat(64),
    original_admission_fingerprint_sha256: '2'.repeat(64),
    terminal_transaction_position: terminalTransactionPosition,
    terminal_transaction_block_id: terminalBlockId,
    expected_review_revision: reviewRevision,
    expected_previous_review_fingerprint_sha256: previousReviewFingerprintSha256,
    effective_safety_state: effectiveSafetyState,
  } satisfies TestContext['row'];
  const queryWithCancellation = jest.fn(() => Promise.resolve({ rows: [row] }));
  const adapter = new PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter(
    lifecycle,
    common.chainEvidence,
    effectiveSafety,
    common.wallet,
    { queryWithCancellation } as unknown as PostgresService,
    common.clock,
  );
  const request = frozen({
    issuerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION,
    use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_USE,
    purpose: 'POST_FINALITY_REVIEW' as const,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    lifecycleCapability,
    lifecycleRequest,
    chainEvidenceCapability: common.request.chainEvidenceCapability,
    chainEvidenceRequest: common.request.chainEvidenceRequest,
    correlationId: CORRELATION_ID,
    deadlineAt: DEADLINE,
    signal: common.signal,
    reviewId: OBSERVATION_ID,
    effectiveSafetyCapability,
    effectiveSafetyRequest,
  }) satisfies IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1;
  return {
    adapter,
    queryWithCancellation,
    request,
    signal: common.signal,
    wallet: common.wallet,
    walletAddress: common.walletAddress,
    lifecycle,
    effectiveSafety,
    row,
  };
}

describe('PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter', () => {
  it('pins both prerequisite reads to migration-0038 v2 functions', () => {
    expect(MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_READ_SQL).toContain(
      'read_mainnet_financial_action_reconciliation_prerequisite_v2',
    );
    expect(MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_READ_SQL).not.toContain(
      'read_mainnet_financial_action_reconciliation_prerequisite_v1',
    );
    expect(MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_READ_SQL).toContain(
      'read_mainnet_financial_action_post_finality_prerequisite_v2',
    );
    expect(MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_READ_SQL).not.toContain(
      'read_mainnet_financial_action_post_finality_prerequisite_v1',
    );
  });

  it.each([
    ['eip155:1', 'WALLET_SIGNED_SUBMISSION_BOUND'],
    ['eip155:1', 'BROADCAST_OUTCOME_AMBIGUOUS'],
    ['eip155:1', 'RECONCILIATION_AMBIGUOUS'],
    ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'WALLET_SIGNED_SUBMISSION_BOUND'],
    ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'BROADCAST_OUTCOME_AMBIGUOUS'],
    ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'RECONCILIATION_AMBIGUOUS'],
  ] as const)(
    'issues one sealed reconciliation prerequisite for %s from %s',
    async (networkId, lifecycleStage) => {
      const test = setup(networkId, [NOW], lifecycleStage);
      const capability = await test.adapter.issueReconciliationPrerequisite(test.request);
      const issuance = test.adapter.reviewIssuance(capability, test.request);
      const expectedRevision =
        lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND'
          ? '2'
          : lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS'
            ? '3'
            : '4';
      const expectedSnapshot =
        lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND'
          ? '7'.repeat(64)
          : lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS'
            ? '3'.repeat(64)
            : '8'.repeat(64);

      expect(issuance).not.toBeNull();
      expect(Object.getPrototypeOf(issuance)).toBeNull();
      expect(Object.isFrozen(issuance)).toBe(true);
      expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
      expect(test.queryWithCancellation).toHaveBeenCalledWith(
        MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_READ_SQL,
        [ACCOUNT_ID, INTENT_ID, expectedRevision, expectedSnapshot, '4'.repeat(64), DEADLINE],
        test.signal,
      );
      expect(test.wallet.readWallet).toHaveBeenCalledTimes(1);
      expect(test.wallet.verifyWallet).toHaveBeenCalledTimes(2);

      const prerequisite = test.adapter.reviewReconciliationPrerequisite(
        issuance?.prerequisiteCapability,
        issuance?.prerequisiteRequest as never,
      );
      expect(prerequisite).toMatchObject({
        accountId: ACCOUNT_ID,
        intentId: INTENT_ID,
        networkId,
        lifecycleStage,
        observationId: OBSERVATION_ID,
        walletAddress: test.walletAddress,
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
      });
      expect(Object.getPrototypeOf(prerequisite)).toBeNull();
      expect(Object.isFrozen(prerequisite)).toBe(true);
    },
  );

  it('accepts an exact recovery-reader result for a wallet revoked after signing', async () => {
    const test = setup('eip155:1', [NOW], 'WALLET_SIGNED_SUBMISSION_BOUND', 'REVOKED');

    await expect(test.adapter.issueReconciliationPrerequisite(test.request)).resolves.toBeDefined();
    expect(test.wallet.readWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: INTENT_ID,
        lifecycleRevision: '2',
        lifecycleSnapshotSha256: '7'.repeat(64),
        lifecycleStage: 'WALLET_SIGNED_SUBMISSION_BOUND',
        purpose: 'RECONCILIATION_ADMISSION',
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
      }),
    );
  });

  it('accepts the exact frozen standard-prototype shape emitted by the durable adapter', async () => {
    const test = setup('eip155:1');
    const original = test.lifecycleCapability as Record<string, unknown>;
    const cursor = Object.freeze({ ...(original.cursor as Record<string, unknown>) });
    const lifecycleCapability = Object.freeze({ ...original, cursor });
    const request = requestWithLifecycleCapability(test, lifecycleCapability);

    await expect(test.adapter.issueReconciliationPrerequisite(request)).resolves.toBeDefined();
    expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
    expect(test.wallet.readWallet).toHaveBeenCalledTimes(1);
  });

  it.each(['WALLET_REPORTED_SUBMITTED', 'WALLET_REPORTED_REJECTED'] as const)(
    'accepts migration-0033 broadcast ambiguity carrying %s',
    async (broadcastOutcome) => {
      const test = setup('eip155:1');
      const original = test.lifecycleCapability as Record<string, unknown>;
      const lifecycleCapability = frozen({ ...original, broadcastOutcome });
      const request = requestWithLifecycleCapability(test, lifecycleCapability);

      await expect(test.adapter.issueReconciliationPrerequisite(request)).resolves.toBeDefined();
      expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts an UNKNOWN reconciliation that retains an earlier transaction observation', async () => {
    const test = setup('eip155:1', [NOW], 'RECONCILIATION_AMBIGUOUS');
    const original = test.lifecycleCapability as Record<string, unknown>;
    const lifecycleCapability = frozen({
      ...original,
      reconciliationOutcome: 'UNKNOWN',
      transactionPosition: null,
      transactionBlockId: null,
      finalizedPosition: '100',
    });
    const request = requestWithLifecycleCapability(test, lifecycleCapability);

    await expect(test.adapter.issueReconciliationPrerequisite(request)).resolves.toBeDefined();
    expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
  });

  it('rejects extra, missing, unfrozen, accessor, and proxied lifecycle result shapes', async () => {
    const cases: readonly (readonly [
      string,
      (test: TestContext) => Readonly<object>,
      ('INVALID_REQUEST' | 'UPSTREAM_UNAVAILABLE')?,
    ])[] = [
      [
        'extra result member',
        (test) => frozen({ ...(test.lifecycleCapability as object), unexpected: true }),
      ],
      [
        'missing result member',
        (test) => {
          const value = { ...(test.lifecycleCapability as Record<string, unknown>) };
          delete value.recordedAt;
          return frozen(value);
        },
      ],
      [
        'unfrozen result',
        (test) =>
          Object.assign(
            Object.create(null) as object,
            test.lifecycleCapability as Record<string, unknown>,
          ),
      ],
      [
        'result accessor',
        (test) =>
          frozenAccessorRecord(test.lifecycleCapability, 'stage', 'BROADCAST_OUTCOME_AMBIGUOUS'),
      ],
      [
        'extra cursor member',
        (test) => {
          const original = test.lifecycleCapability as Record<string, unknown>;
          return frozen({
            ...original,
            cursor: frozen({ ...(original.cursor as object), unexpected: true }),
          });
        },
      ],
      [
        'cursor accessor',
        (test) => {
          const original = test.lifecycleCapability as Record<string, unknown>;
          return frozen({
            ...original,
            cursor: frozenAccessorRecord(
              original.cursor as object,
              'source',
              'MIGRATION_0033_DATABASE',
            ),
          });
        },
      ],
      [
        'proxied cursor',
        (test) => {
          const original = test.lifecycleCapability as Record<string, unknown>;
          return frozen({ ...original, cursor: new Proxy(original.cursor as object, {}) });
        },
      ],
      ['proxied result', (test) => new Proxy(test.lifecycleCapability, {}), 'INVALID_REQUEST'],
    ];

    for (const [, createCapability, expectedCode] of cases) {
      const test = setup('eip155:1');
      await expectLifecycleRejectedBeforeIo(
        test,
        createCapability(test),
        expectedCode ?? 'UPSTREAM_UNAVAILABLE',
      );
    }
  });

  it.each([
    ['schemaVersion', 2],
    ['source', 'CALLER_AUTHORED'],
    ['fingerprintEncoding', 'OTHER-FP-1'],
    ['accountId', INTENT_ID],
    ['intentId', ACCOUNT_ID],
    ['networkId', 'eip155:8453'],
    ['lifecycleRevision', '0'],
    ['currentSnapshotSha256', '0'.repeat(64)],
    ['intentRecordFingerprintSha256', '0'.repeat(64)],
  ] as const)(
    'rejects malformed lifecycle cursor field %s before database I/O',
    async (field, value) => {
      const test = setup('eip155:1');
      const original = test.lifecycleCapability as Record<string, unknown>;
      const malformed = frozen({
        ...original,
        cursor: frozen({ ...(original.cursor as object), [field]: value }),
      });

      await expectLifecycleRejectedBeforeIo(test, malformed);
    },
  );

  it.each([
    ['revision below three', {}, { lifecycleRevision: '2' }],
    ['revision above three', {}, { lifecycleRevision: '4' }],
    ['missing transaction', { chainTransactionId: null }, {}],
    ['missing observation', { observationId: null }, {}],
    ['malformed observation', { observationId: 'not-a-uuid' }, {}],
    ['missing broadcast outcome', { broadcastOutcome: null }, {}],
    ['unexpected reconciliation', { reconciliationOutcome: 'PENDING' }, {}],
    ['unexpected transaction position', { transactionPosition: '100' }, {}],
    ['unexpected finalized position', { finalizedPosition: '90' }, {}],
    ['unexpected last observation', { lastObservedTransactionPosition: '100' }, {}],
    ['terminal flag', { terminal: true }, {}],
    ['manual reconciliation flag', { requiresManualReconciliation: true }, {}],
    ['terminal recovery mode', { recoveryMode: 'NONE' }, {}],
    ['noncanonical effective time', { effectiveAt: '2026-09-07T11:50:00Z' }, {}],
    ['noncanonical expiry', { expiresAt: '2026-09-07T11:55:00Z' }, {}],
    ['noncanonical recorded time', { recordedAt: '2026-09-07T11:50:00Z' }, {}],
    ['effective time after recording', { effectiveAt: '2026-09-07T11:50:00.001Z' }, {}],
  ] as const)(
    'rejects malformed broadcast lifecycle shape: %s',
    async (_description, resultOverrides, cursorOverrides) => {
      const test = setup('eip155:1');
      const original = test.lifecycleCapability as Record<string, unknown>;
      const cursor = original.cursor as Record<string, unknown>;
      const malformed = frozen({
        ...original,
        ...resultOverrides,
        cursor: frozen({ ...cursor, ...cursorOverrides }),
      });

      await expectLifecycleRejectedBeforeIo(test, malformed);
    },
  );

  it.each([
    ['revision below three', {}, { lifecycleRevision: '2' }],
    ['missing observation', { observationId: null }, {}],
    ['unexpected broadcast outcome', { broadcastOutcome: 'WALLET_REPORTED_AMBIGUOUS' }, {}],
    ['unknown with a current transaction', { reconciliationOutcome: 'UNKNOWN' }, {}],
    ['terminal outcome on ambiguous stage', { reconciliationOutcome: 'FINALIZED_SUCCESS' }, {}],
    ['finalized head reaching a pending transaction', { finalizedPosition: '100' }, {}],
    ['transaction pair mismatch', { transactionBlockId: null }, {}],
    ['missing finalized head', { finalizedPosition: null, finalizedBlockId: null }, {}],
    ['last-observed pair mismatch', { lastObservedTransactionBlockId: null }, {}],
    ['last-observed transaction mismatch', { lastObservedTransactionPosition: '101' }, {}],
    ['terminal flag', { terminal: true }, {}],
    ['manual reconciliation flag', { requiresManualReconciliation: true }, {}],
    ['terminal recovery mode', { recoveryMode: 'NONE' }, {}],
  ] as const)(
    'rejects malformed reconciliation lifecycle shape: %s',
    async (_description, resultOverrides, cursorOverrides) => {
      const test = setup('eip155:1', [NOW], 'RECONCILIATION_AMBIGUOUS');
      const original = test.lifecycleCapability as Record<string, unknown>;
      const cursor = original.cursor as Record<string, unknown>;
      const malformed = frozen({
        ...original,
        ...resultOverrides,
        cursor: frozen({ ...cursor, ...cursorOverrides }),
      });

      await expectLifecycleRejectedBeforeIo(test, malformed);
    },
  );

  it.each([
    ['revision below three', 'FINALIZED_SUCCESS', {}, { lifecycleRevision: '2' }],
    ['missing observation', 'FINALIZED_SUCCESS', { observationId: null }, {}],
    [
      'unexpected broadcast outcome',
      'FINALIZED_SUCCESS',
      { broadcastOutcome: 'WALLET_REPORTED_AMBIGUOUS' },
      {},
    ],
    [
      'outcome disagreeing with success stage',
      'FINALIZED_SUCCESS',
      { reconciliationOutcome: 'FINALIZED_FAILURE' },
      {},
    ],
    [
      'outcome disagreeing with failure stage',
      'FINALIZED_FAILURE',
      { reconciliationOutcome: 'FINALIZED_SUCCESS' },
      {},
    ],
    [
      'missing transaction position',
      'FINALIZED_SUCCESS',
      { transactionPosition: null, transactionBlockId: null },
      {},
    ],
    ['finalized head below transaction', 'FINALIZED_SUCCESS', { finalizedPosition: '99' }, {}],
    [
      'last-observed transaction mismatch',
      'FINALIZED_SUCCESS',
      { lastObservedTransactionPosition: '101' },
      {},
    ],
    ['nonterminal flag', 'FINALIZED_SUCCESS', { terminal: false }, {}],
    ['manual reconciliation flag', 'FINALIZED_SUCCESS', { requiresManualReconciliation: true }, {}],
    [
      'nonterminal recovery mode',
      'FINALIZED_SUCCESS',
      { recoveryMode: 'READ_THEN_RECONCILE_ONLY' },
      {},
    ],
  ] as const)(
    'rejects malformed terminal lifecycle shape: %s',
    async (_description, lifecycleStage, resultOverrides, cursorOverrides) => {
      const test = setupPost(
        'eip155:1',
        '0',
        '100',
        [NOW],
        'AUTHENTICATED_FINALITY_RECORDED',
        lifecycleStage,
      );
      const original = test.request.lifecycleCapability as Record<string, unknown>;
      const cursor = original.cursor as Record<string, unknown>;
      const malformed = frozen({
        ...original,
        ...resultOverrides,
        cursor: frozen({ ...cursor, ...cursorOverrides }),
      });

      await expectPostLifecycleRejectedBeforeIo(test, malformed);
    },
  );

  it.each([
    ['zero volatile commitment', { volatileIntentCommitmentSha256: '0'.repeat(64) }],
    ['missing submission fingerprint', { submissionFingerprintSha256: null }],
    ['zero submission fingerprint', { submissionFingerprintSha256: '0'.repeat(64) }],
    ['volatile commitment reused as snapshot', { volatileIntentCommitmentSha256: '3'.repeat(64) }],
    [
      'volatile commitment reused as intent fingerprint',
      { volatileIntentCommitmentSha256: '2'.repeat(64) },
    ],
  ] as const)('rejects lifecycle digest incoherence: %s', async (_description, overrides) => {
    const test = setup('eip155:1');
    const original = test.lifecycleCapability as Record<string, unknown>;
    const malformed = frozen({ ...original, ...overrides });

    await expectLifecycleRejectedBeforeIo(test, malformed);
  });

  it('rejects a snapshot reused as the intent fingerprint', async () => {
    const test = setup('eip155:1');
    const original = test.lifecycleCapability as Record<string, unknown>;
    const cursor = original.cursor as Record<string, unknown>;
    const malformed = frozen({
      ...original,
      cursor: frozen({ ...cursor, currentSnapshotSha256: cursor.intentRecordFingerprintSha256 }),
    });

    await expectLifecycleRejectedBeforeIo(test, malformed);
  });

  it.each([
    ['eip155:1', '0', 'AUTHENTICATED_FINALITY_RECORDED', 'FINALIZED_SUCCESS'],
    ['eip155:1', '1', 'AUTHENTICATED_FINALITY_RECORDED', 'FINALIZED_SUCCESS'],
    ['eip155:1', '2', 'POST_FINALITY_REVIEW_INCONCLUSIVE', 'FINALIZED_SUCCESS'],
    [
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      '0',
      'AUTHENTICATED_FINALITY_RECORDED',
      'FINALIZED_SUCCESS',
    ],
    [
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      '2',
      'AUTHENTICATED_FINALITY_RECORDED',
      'FINALIZED_FAILURE',
    ],
  ] as const)(
    'issues one sealed post-finality prerequisite for %s at review revision %s in %s from %s',
    async (networkId, reviewRevision, effectiveSafetyState, lifecycleStage) => {
      const test = setupPost(
        networkId,
        reviewRevision,
        '100',
        [NOW],
        effectiveSafetyState,
        lifecycleStage,
      );
      const capability = await test.adapter.issuePostFinalityPrerequisite(test.request);
      const issuance = test.adapter.reviewIssuance(capability, test.request);
      const expectedPrevious = reviewRevision === '0' ? null : 'f'.repeat(64);

      expect(issuance).not.toBeNull();
      expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
      expect(test.queryWithCancellation).toHaveBeenCalledWith(
        MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_READ_SQL,
        [
          ACCOUNT_ID,
          INTENT_ID,
          '4',
          '8'.repeat(64),
          '4'.repeat(64),
          '1'.repeat(64),
          '2'.repeat(64),
          reviewRevision,
          expectedPrevious,
          effectiveSafetyState,
          DEADLINE,
        ],
        test.signal,
      );
      expect(test.queryWithCancellation.mock.calls[0]?.[1]).toHaveLength(11);
      expect([
        test.row.terminal_transition_fingerprint_sha256,
        test.row.original_admission_fingerprint_sha256,
        test.row.terminal_transaction_position,
        test.row.terminal_transaction_block_id,
        test.row.expected_review_revision,
        test.row.expected_previous_review_fingerprint_sha256,
        test.row.effective_safety_state,
      ]).toEqual([
        '1'.repeat(64),
        '2'.repeat(64),
        '100',
        test.row.terminal_transaction_block_id,
        reviewRevision,
        expectedPrevious,
        effectiveSafetyState,
      ]);
      expect(test.wallet.readWallet).toHaveBeenCalledTimes(1);
      expect(test.wallet.verifyWallet).toHaveBeenCalledTimes(2);

      if (issuance?.purpose !== 'POST_FINALITY_REVIEW') {
        throw new Error('expected post-finality issuance');
      }
      const prerequisite = test.adapter.reviewPostFinalityPrerequisite(
        issuance.prerequisiteCapability,
        issuance.prerequisiteRequest,
      );
      expect(prerequisite).toMatchObject({
        accountId: ACCOUNT_ID,
        intentId: INTENT_ID,
        networkId,
        lifecycleStage,
        reviewId: OBSERVATION_ID,
        expectedReviewRevision: reviewRevision,
        expectedPreviousReviewFingerprintSha256: expectedPrevious,
        walletAddress: test.walletAddress,
        effectiveSafetyState,
      });
      expect(Object.getPrototypeOf(prerequisite)).toBeNull();
      expect(Object.isFrozen(prerequisite)).toBe(true);
    },
  );

  it.each([
    ['durableLifecycleVersion', 2],
    ['use', 'wrong-result-use'],
    ['mayAuthorizeFinancialAction', true],
    ['apiMaySign', true],
    ['apiMayBroadcast', true],
    ['mayResendTransaction', true],
    ['automaticRetryAllowed', true],
    ['ledgerSettlementAuthority', true],
    ['outcome', 'DATABASE_OUTCOME_UNKNOWN'],
    ['operation', 'RECORD_BROADCAST'],
    ['databaseRecordOutcome', 'REPLAYED'],
    ['databaseReplayProtectionEnforced', false],
  ] as const)(
    'rejects malformed lifecycle result field %s before database I/O',
    async (field, value) => {
      const test = setup('eip155:1');
      const malformed = frozen({
        ...(test.lifecycleCapability as Record<string, unknown>),
        [field]: value,
      });
      await expectLifecycleRejectedBeforeIo(test, malformed);
    },
  );

  it.each([
    ['use', 'wrong-result-use', 'UPSTREAM_UNAVAILABLE'],
    ['recordIntentFingerprintSha256', '0'.repeat(64), 'UPSTREAM_UNAVAILABLE'],
    ['deadlineBindingSha256', '0'.repeat(64), 'UPSTREAM_UNAVAILABLE'],
    ['evidenceRecordedAt', '2026-09-07T11:59:59.999Z', 'STALE_PREREQUISITE'],
    ['evidenceRecordedAt', '2026-09-07T12:00:00.001Z', 'STALE_PREREQUISITE'],
  ] as const)(
    'rejects malformed recorded chain-evidence field %s before database I/O',
    async (field, value, expectedCode) => {
      const test = setup('eip155:1');
      const malformed = frozen({
        ...(test.chainEvidenceCapability as Record<string, unknown>),
        [field]: value,
      });
      const request = frozen({ ...test.request, chainEvidenceCapability: malformed });
      (test.chainEvidence.reviewResult as jest.Mock).mockImplementation(
        (capability, reviewedRequest) =>
          capability === malformed && reviewedRequest === test.request.chainEvidenceRequest
            ? malformed
            : null,
      );

      await expect(
        test.adapter.issueReconciliationPrerequisite(request as never),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(test.queryWithCancellation).not.toHaveBeenCalled();
      expect(test.wallet.readWallet).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['use', 'wrong-result-use'],
    ['mayConstructTransaction', true],
    ['apiMaySign', true],
    ['apiMayBroadcast', true],
    ['mayResendTransaction', true],
    ['automaticRetryAllowed', true],
    ['ledgerSettlementAuthority', true],
    ['recordedAt', NOW],
    ['recoveryMode', 'NONE'],
  ] as const)(
    'rejects malformed effective-safety result field %s before database I/O',
    async (field, value) => {
      const test = setupPost('eip155:1');
      const original = test.request.effectiveSafetyCapability as Record<string, unknown>;
      const malformed = frozen({ ...original, [field]: value });
      const request = frozen({ ...test.request, effectiveSafetyCapability: malformed });
      (test.effectiveSafety.reviewResult as jest.Mock).mockImplementation(
        (capability, reviewedRequest) =>
          capability === malformed && reviewedRequest === test.request.effectiveSafetyRequest
            ? malformed
            : null,
      );

      await expect(
        test.adapter.issuePostFinalityPrerequisite(request as never),
      ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
      expect(test.queryWithCancellation).not.toHaveBeenCalled();
      expect(test.wallet.readWallet).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['revision zero with a disposition', '0', { latestReviewDisposition: 'FINALITY_REAFFIRMED' }],
    ['revision zero requiring review', '0', { requiresManualReview: true }],
    [
      'revision zero in an inconclusive state',
      '0',
      { effectiveSafetyState: 'POST_FINALITY_REVIEW_INCONCLUSIVE' },
    ],
    [
      'reaffirmed review in an inconclusive state',
      '1',
      { effectiveSafetyState: 'POST_FINALITY_REVIEW_INCONCLUSIVE', requiresManualReview: true },
    ],
    ['reaffirmed review requiring review', '1', { requiresManualReview: true }],
    [
      'inconclusive review in an authenticated-finality state',
      '1',
      { latestReviewDisposition: 'REVIEW_INCONCLUSIVE', requiresManualReview: true },
    ],
    [
      'inconclusive review without manual review',
      '1',
      {
        latestReviewDisposition: 'REVIEW_INCONCLUSIVE',
        effectiveSafetyState: 'POST_FINALITY_REVIEW_INCONCLUSIVE',
        requiresManualReview: false,
      },
    ],
    [
      'deep-reorg quarantine',
      '1',
      {
        latestReviewDisposition: 'DEEP_REORG_QUARANTINED',
        effectiveSafetyState: 'DEEP_REORG_QUARANTINED',
        requiresManualReview: true,
      },
    ],
  ] as const)(
    'rejects an incoherent effective-safety read for %s before database I/O',
    async (_description, reviewRevision, overrides) => {
      const test = setupPost('eip155:1', reviewRevision);
      const original = test.request.effectiveSafetyCapability as Record<string, unknown>;
      const malformed = frozen({ ...original, ...overrides });
      const request = frozen({ ...test.request, effectiveSafetyCapability: malformed });
      (test.effectiveSafety.reviewResult as jest.Mock).mockImplementation(
        (capability, reviewedRequest) =>
          capability === malformed && reviewedRequest === test.request.effectiveSafetyRequest
            ? malformed
            : null,
      );

      await expect(
        test.adapter.issuePostFinalityPrerequisite(request as never),
      ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
      expect(test.queryWithCancellation).not.toHaveBeenCalled();
      expect(test.wallet.readWallet).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['schemaVersion', 2],
    ['source', 'MIGRATION_0033_DATABASE'],
    ['fingerprintEncoding', 'OTHER-FP-1'],
  ] as const)(
    'rejects malformed effective-safety cursor field %s before database I/O',
    async (field, value) => {
      const test = setupPost('eip155:1');
      const original = test.request.effectiveSafetyCapability as Record<string, unknown>;
      const cursor = original.cursor as Record<string, unknown>;
      const malformed = frozen({ ...original, cursor: frozen({ ...cursor, [field]: value }) });
      const request = frozen({ ...test.request, effectiveSafetyCapability: malformed });
      (test.effectiveSafety.reviewResult as jest.Mock).mockImplementation(
        (capability, reviewedRequest) =>
          capability === malformed && reviewedRequest === test.request.effectiveSafetyRequest
            ? malformed
            : null,
      );

      await expect(
        test.adapter.issuePostFinalityPrerequisite(request as never),
      ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
      expect(test.queryWithCancellation).not.toHaveBeenCalled();
      expect(test.wallet.readWallet).not.toHaveBeenCalled();
    },
  );

  it('rejects a lookalike outer request before database or wallet I/O', async () => {
    const test = setup('eip155:1');

    await expect(
      test.adapter.issueReconciliationPrerequisite({ ...test.request }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(test.queryWithCancellation).not.toHaveBeenCalled();
    expect(test.wallet.readWallet).not.toHaveBeenCalled();
  });

  it('spends an exact issue-request identity before dispatch can be replayed', async () => {
    const test = setup('eip155:1');
    await test.adapter.issueReconciliationPrerequisite(test.request);

    await expect(test.adapter.issueReconciliationPrerequisite(test.request)).rejects.toMatchObject({
      code: 'STALE_PREREQUISITE',
    });
    expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
    expect(test.wallet.readWallet).toHaveBeenCalledTimes(1);
  });

  it('rejects a post-finality cursor position above uint64 before database I/O', async () => {
    const test = setupPost('eip155:1', '0', '18446744073709551616');

    await expect(test.adapter.issuePostFinalityPrerequisite(test.request)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect(test.queryWithCancellation).not.toHaveBeenCalled();
  });

  it('reserves the final int64 review revision required by migration 0038', async () => {
    const accepted = setupPost('eip155:1', '9223372036854775806');
    await expect(
      accepted.adapter.issuePostFinalityPrerequisite(accepted.request),
    ).resolves.toBeDefined();
    expect(accepted.queryWithCancellation).toHaveBeenCalledTimes(1);

    const exhausted = setupPost('eip155:1', '9223372036854775807');
    await expect(
      exhausted.adapter.issuePostFinalityPrerequisite(exhausted.request),
    ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(exhausted.queryWithCancellation).not.toHaveBeenCalled();
    expect(exhausted.wallet.readWallet).not.toHaveBeenCalled();
  });

  it('fails closed when the injected clock regresses after database I/O', async () => {
    const test = setup('eip155:1', [NOW, '2026-09-07T11:59:59.999Z']);

    await expect(test.adapter.issueReconciliationPrerequisite(test.request)).rejects.toMatchObject({
      code: 'STALE_PREREQUISITE',
    });
    expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
    expect(test.wallet.readWallet).not.toHaveBeenCalled();
  });

  it('accepts the uint64 EVM block boundary and rejects overflow before wallet I/O', async () => {
    const boundary = setup('eip155:1');
    const originalRequest = boundary.request.chainEvidenceRequest;
    const originalProducer = originalRequest.producerRequest;
    const boundaryAnchor = frozen({
      kind: 'EVM_BLOCK' as const,
      blockNumber: '18446744073709551615',
      blockHash: `0x${'a'.repeat(64)}`,
    });
    const boundaryProducer = frozen({
      ...originalProducer,
      continuityFloor: boundaryAnchor,
      chainAnchor: boundaryAnchor,
    });
    const boundaryChainRequest = frozen({
      ...originalRequest,
      producerRequest: boundaryProducer,
    });
    const boundaryRequest = frozen({
      ...boundary.request,
      chainEvidenceRequest: boundaryChainRequest,
    });
    boundary.row.chain_anchor_json = JSON.stringify(boundaryAnchor);
    boundary.row.agreed_finalized_head_json = JSON.stringify(boundaryAnchor);
    (boundary.chainEvidence.reviewResult as jest.Mock).mockImplementation((capability, request) =>
      capability === boundary.chainEvidenceCapability && request === boundaryChainRequest
        ? boundary.chainEvidenceCapability
        : null,
    );

    await expect(
      boundary.adapter.issueReconciliationPrerequisite(boundaryRequest as never),
    ).resolves.toBeDefined();
    expect(boundary.wallet.readWallet).toHaveBeenCalledTimes(1);

    const overflow = setup('eip155:1');
    const overflowChainRequest = overflow.request.chainEvidenceRequest;
    const overflowProducer = overflowChainRequest.producerRequest;
    const overflowAnchor = frozen({
      kind: 'EVM_BLOCK' as const,
      blockNumber: '18446744073709551616',
      blockHash: `0x${'a'.repeat(64)}`,
    });
    const malformedProducer = frozen({
      ...overflowProducer,
      continuityFloor: overflowAnchor,
      chainAnchor: overflowAnchor,
    });
    const malformedChainRequest = frozen({
      ...overflowChainRequest,
      producerRequest: malformedProducer,
    });
    const malformedRequest = frozen({
      ...overflow.request,
      chainEvidenceRequest: malformedChainRequest,
    });
    (overflow.chainEvidence.reviewResult as jest.Mock).mockImplementation((capability, request) =>
      capability === overflow.chainEvidenceCapability && request === malformedChainRequest
        ? overflow.chainEvidenceCapability
        : null,
    );

    await expect(
      overflow.adapter.issueReconciliationPrerequisite(malformedRequest as never),
    ).rejects.toMatchObject({ code: 'INVALID_DATABASE_RESULT' });
    expect(overflow.queryWithCancellation).not.toHaveBeenCalled();
    expect(overflow.wallet.readWallet).not.toHaveBeenCalled();
  });

  it('rejects cloned, proxied, and cross-instance issuance and prerequisite capabilities', async () => {
    const issuer = setup('eip155:1');
    const other = setup('eip155:1');
    const opaqueIssuance = await issuer.adapter.issueReconciliationPrerequisite(issuer.request);
    const issuance = issuer.adapter.reviewIssuance(opaqueIssuance, issuer.request);
    if (issuance?.purpose !== 'RECONCILIATION_ADMISSION') {
      throw new Error('expected reconciliation issuance');
    }
    const clonedIssuance = frozen({ ...issuance });
    const proxiedIssuance = new Proxy(issuance, Object.create(null) as ProxyHandler<object>);

    expect(issuer.adapter.reviewIssuance(clonedIssuance, issuer.request)).toBeNull();
    expect(issuer.adapter.reviewIssuance(proxiedIssuance, issuer.request)).toBeNull();
    expect(other.adapter.reviewIssuance(opaqueIssuance, issuer.request)).toBeNull();

    const clonedPrerequisite = frozen({});
    const proxiedPrerequisite = new Proxy(
      issuance.prerequisiteCapability,
      Object.create(null) as ProxyHandler<object>,
    );
    expect(
      issuer.adapter.reviewReconciliationPrerequisite(
        clonedPrerequisite,
        issuance.prerequisiteRequest,
      ),
    ).toBeNull();
    expect(
      issuer.adapter.reviewReconciliationPrerequisite(
        proxiedPrerequisite,
        issuance.prerequisiteRequest,
      ),
    ).toBeNull();
    expect(
      other.adapter.reviewReconciliationPrerequisite(
        issuance.prerequisiteCapability,
        issuance.prerequisiteRequest,
      ),
    ).toBeNull();
  });

  it('rejects issuance and prerequisite review when the clock rolls behind issuedAt', async () => {
    const test = setup('eip155:1', [
      NOW,
      '2026-09-07T12:00:01.000Z',
      '2026-09-07T12:00:02.000Z',
      '2026-09-07T12:00:01.999Z',
    ]);
    const opaque = await test.adapter.issueReconciliationPrerequisite(test.request);
    const issuance = opaque as MainnetFinancialActionFinalityPrerequisiteIssuanceV1;

    expect(test.adapter.reviewIssuance(opaque, test.request)).toBeNull();
    expect(
      test.adapter.reviewReconciliationPrerequisite(
        issuance.prerequisiteCapability,
        issuance.prerequisiteRequest as never,
      ),
    ).toBeNull();
  });

  it('maps an abort while PostgreSQL is pending to stale without retrying', async () => {
    const test = setup('eip155:1');
    const pendingDatabase = deferred<unknown>();
    test.queryWithCancellation.mockReturnValueOnce(pendingDatabase.promise);

    const pending = test.adapter.issueReconciliationPrerequisite(test.request);
    expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
    test.abortController.abort();
    pendingDatabase.reject(new Error('cancelled'));

    await expect(pending).rejects.toMatchObject({ code: 'STALE_PREREQUISITE' });
    expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
    expect(test.wallet.readWallet).not.toHaveBeenCalled();
  });

  it('maps an abort while the wallet read is pending to stale', async () => {
    const test = setup('eip155:1');
    const pendingWallet = deferred<unknown>();
    (test.wallet.readWallet as jest.Mock).mockReturnValueOnce(pendingWallet.promise);

    const pending = test.adapter.issueReconciliationPrerequisite(test.request);
    await Promise.resolve();
    await Promise.resolve();
    expect(test.wallet.readWallet).toHaveBeenCalledTimes(1);
    test.abortController.abort();
    pendingWallet.reject(new Error('cancelled'));

    await expect(pending).rejects.toMatchObject({ code: 'STALE_PREREQUISITE' });
    expect(test.wallet.readWallet).toHaveBeenCalledTimes(1);
  });

  it('maps wallet rejection at the deadline to stale and an earlier rejection to unavailable', async () => {
    const stale = setup('eip155:1', [NOW, NOW, DEADLINE]);
    (stale.wallet.readWallet as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));

    await expect(
      stale.adapter.issueReconciliationPrerequisite(stale.request),
    ).rejects.toMatchObject({ code: 'STALE_PREREQUISITE' });

    const unavailable = setup('eip155:1');
    (unavailable.wallet.readWallet as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
    await expect(
      unavailable.adapter.issueReconciliationPrerequisite(unavailable.request),
    ).rejects.toMatchObject({ code: 'WALLET_UNAVAILABLE' });
  });

  it('rejects a Promise subclass returned by the database boundary', async () => {
    class PromiseSubclass<T> extends Promise<T> {}
    const test = setup('eip155:1');
    test.queryWithCancellation.mockImplementationOnce(
      () => new PromiseSubclass((resolve) => resolve({ rows: [] })),
    );

    await expect(test.adapter.issueReconciliationPrerequisite(test.request)).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(test.queryWithCancellation).toHaveBeenCalledTimes(1);
    expect(test.wallet.readWallet).not.toHaveBeenCalled();
  });
});
