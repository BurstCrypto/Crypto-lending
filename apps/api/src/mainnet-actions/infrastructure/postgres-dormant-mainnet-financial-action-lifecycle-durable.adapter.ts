import { isProxy } from 'node:util/types';

import type { PostgresService } from '../../infrastructure/database/postgres.service';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  type SupportedStablecoin,
} from '../../blockchain/domain/supported-asset-registry';
import {
  activeWalletRegistrationKey,
  digestWalletIdentity,
  MAX_WALLET_REGISTRATION_KEYS_PER_PURPOSE,
  walletRegistrationDigestEquals,
  walletRegistrationKeyForVersion,
  type WalletRegistrationDigestReference,
  type WalletRegistrationKeyRing,
} from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import {
  parseDormantMainnetFinancialActionIntent,
  type DormantMainnetFinancialActionIntentV1,
} from '../domain/dormant-mainnet-financial-action';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE,
  MAINNET_FINANCIAL_ACTION_DATABASE_FINGERPRINT_ENCODING,
  type BindDormantMainnetFinancialActionSubmissionRequestV1,
  type DormantMainnetFinancialActionDurableRequestV1,
  type DormantMainnetFinancialActionDurableResultV1,
  type DormantMainnetFinancialActionLifecycleDurablePort,
  type DormantMainnetFinancialActionClmaDatabaseCursorV1,
  type DormantMainnetFinancialActionDatabaseConfirmedResultV1,
  type DormantMainnetFinancialActionDatabaseOutcomeUnknownV1,
  type DormantMainnetFinancialActionDurableOperation,
  type DormantMainnetNonterminalReconciliationDatabaseOutcome,
  type DormantMainnetReconciliationDatabaseOutcome,
  type DormantMainnetWalletBroadcastDatabaseOutcome,
  type MainnetFinancialActionDatabaseNetworkId,
  type PrepareDormantMainnetFinancialActionDurableRequestV1,
  type ReadDormantMainnetFinancialActionDurableRequestV1,
  type RecordDormantMainnetFinancialActionBroadcastRequestV1,
  type RecordDormantMainnetFinancialActionReconciliationRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port';
import {
  DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_RESULT_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE,
  DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
  type DormantMainnetFinancialActionSignedSubmissionVerifierPort,
  type DormantMainnetSignedSubmissionVerificationResultV1,
  type VerifyDormantMainnetSignedSubmissionRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-signed-submission-verifier.port';
import {
  DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION,
  DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_CAPABILITY_USE,
  DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_REQUEST_USE,
  type BindDormantMainnetVerifiedSubmissionRequestV1,
  type DormantMainnetFinancialActionVerifiedSubmissionBinderPort,
  type DormantMainnetVerifiedSubmissionBindCapabilityV1,
} from '../application/ports/dormant-mainnet-financial-action-verified-submission-binder.port';
import {
  sha256ClmaFp1,
  sha256Framed,
} from '../domain/mainnet-financial-action-signed-verification-digest';
import { fingerprintDormantMainnetSignedVerificationIntent } from './mainnet-financial-action-write-manifest';

const ETHEREUM_MAINNET = 'eip155:1' as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EVM_HASH = /^0x[0-9a-f]{64}$/u;
const EVM_MARKET = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const UINT64 = /^(?:0|[1-9][0-9]{0,19})$/u;
const TIMESTAMP =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_INT64 = (1n << 63n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

const REQUEST_COMMON_KEYS = Object.freeze([
  'durableLifecycleVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'signal',
] as const);
const PREPARE_KEYS = Object.freeze([
  ...REQUEST_COMMON_KEYS,
  'intentInput',
  'authoritativeLinks',
  'volatileIntentCommitment',
  'correlationId',
] as const);
const LINK_KEYS = Object.freeze([
  'yieldOperationId',
  'yieldSubmissionId',
  'ledgerTransactionId',
  'ledgerBookId',
] as const);
const VOLATILE_COMMITMENT_KEYS = Object.freeze([
  'source',
  'encoding',
  'sha256',
  'mayServeAsDatabaseCursor',
] as const);
const CURSOR_KEYS = Object.freeze([
  'schemaVersion',
  'source',
  'fingerprintEncoding',
  'accountId',
  'intentId',
  'networkId',
  'lifecycleRevision',
  'currentSnapshotSha256',
  'intentRecordFingerprintSha256',
] as const);
const BIND_KEYS = Object.freeze([
  ...REQUEST_COMMON_KEYS,
  'cursor',
  'correlationId',
  'transactionId',
  'walletSignedPayloadSha256',
  'walletSignatureEvidenceSha256',
  'signedAt',
] as const);
const VERIFIED_BIND_KEYS = Object.freeze([
  'verifiedSubmissionBinderVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'cursor',
  'verificationRequest',
  'verificationCapability',
  'correlationId',
  'signal',
] as const);
const VERIFIED_BIND_CAPABILITY_KEYS = Object.freeze([
  'verifiedSubmissionBinderVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'apiMaySign',
  'apiMayBroadcast',
  'mayResendTransaction',
  'automaticRetryAllowed',
] as const);
const SIGNED_VERIFICATION_CAPABILITY_KEYS = Object.freeze([
  'verifierVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'apiMaySign',
  'apiMayBroadcast',
] as const);
const SIGNED_VERIFICATION_REQUEST_KEYS = Object.freeze([
  'verifierVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'intentRecordFingerprintSha256',
  'intent',
  'wire',
  'signal',
] as const);
const SIGNED_VERIFICATION_WIRE_KEYS = Object.freeze([
  'networkId',
  'encoding',
  'signedTransaction',
] as const);
const SIGNED_VERIFICATION_INTENT_KEYS = Object.freeze([
  'schemaVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'intentId',
  'accountId',
  'walletRegistrationId',
  'replayProtectionId',
  'idempotencyKeyDigestSha256',
  'networkId',
  'walletAddress',
  'providerId',
  'protocolId',
  'marketId',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'assetSymbol',
  'assetIdentity',
  'assetDecimals',
  'action',
  'amountAtomic',
  'requestedValueUsdMicros',
  'maximumNetworkFeeAtomic',
  'maximumNetworkFeeBasisPoints',
  'minimumPostActionNativeBalanceAtomic',
  'allowanceMode',
  'allowanceAmountAtomic',
  'issuedAt',
  'expiresAt',
  'signingResponsibility',
  'broadcastResponsibility',
  'apiMaySign',
  'apiMayBroadcast',
  'crossChainExecutionAllowed',
  'automaticResendAllowed',
  'automaticFeeEscalationAllowed',
  'durableReplayProtectionVerified',
] as const);
const SIGNED_VERIFICATION_RESULT_KEYS = Object.freeze([
  'verifierVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'apiMaySign',
  'apiMayBroadcast',
  'mayResendTransaction',
  'automaticRetryAllowed',
  'dynamicChainStateVerified',
  'providerDeploymentVerified',
  'currentNonceOrBlockhashVerified',
  'walletBalanceVerified',
  'intentId',
  'intentRecordFingerprintSha256',
  'verificationIntentFingerprintSha256',
  'networkId',
  'transactionId',
  'signerWalletAddress',
  'signatureScheme',
  'signedEnvelopeSha256',
  'signingPayloadSha256',
  'signatureEvidenceSha256',
  'chainReplayIdentitySha256',
  'providerWriteManifestFingerprintSha256',
  'providerActionBindingSha256',
  'ethereumNonce',
  'solanaRecentBlockhash',
  'staticCommandVerification',
] as const);
const PERSISTED_INTENT_FINGERPRINT_FIELD_NAMES = Object.freeze([
  'fingerprintEncodingVersion',
  'intentId',
  'accountId',
  'yieldOperationId',
  'yieldSubmissionId',
  'ledgerTransactionId',
  'ledgerBookId',
  'walletId',
  'walletChainNamespace',
  'walletChainReference',
  'walletIdentityDigestVersion',
  'walletIdentityDigestHex',
  'networkId',
  'providerId',
  'protocolId',
  'marketId',
  'assetRegistryVersion',
  'assetRegistryFingerprintSha256',
  'assetSymbol',
  'assetIdentity',
  'assetDecimals',
  'actionType',
  'amountAtomic',
  'requestedValueUsdMicros',
  'maximumNetworkFeeAtomic',
  'maximumNetworkFeeBasisPoints',
  'minimumPostActionNativeBalanceAtomic',
  'allowanceMode',
  'allowanceAmountAtomic',
  'idempotencyKeyDigestSha256',
  'replayProtectionId',
  'issuedAtEpochMilliseconds',
  'expiresAtEpochMilliseconds',
  'signingResponsibility',
  'broadcastResponsibility',
  'mayAuthorizeFinancialAction',
  'apiMaySign',
  'apiMayBroadcast',
  'crossChainExecutionAllowed',
  'automaticResendAllowed',
  'automaticFeeEscalationAllowed',
  'volatileIntentDurableReplayProtectionVerified',
  'databaseReplayProtectionEnforced',
  'ledgerSettlementAuthority',
  'volatileIntentCommitmentSha256',
] as const);
const BROADCAST_KEYS = Object.freeze([
  ...REQUEST_COMMON_KEYS,
  'cursor',
  'correlationId',
  'observationId',
  'transactionId',
  'outcome',
  'evidenceSha256',
  'observedAt',
] as const);
const RECONCILIATION_KEYS = Object.freeze([
  ...REQUEST_COMMON_KEYS,
  'cursor',
  'correlationId',
  'observationId',
  'transactionId',
  'outcome',
  'transactionPosition',
  'transactionBlockId',
  'finalizedPosition',
  'finalizedBlockId',
  'sourceEvidenceSha256',
  'observedAt',
] as const);
const READ_KEYS = Object.freeze([...REQUEST_COMMON_KEYS, 'accountId', 'intentId'] as const);
const RESULT_ROW_KEYS = Object.freeze([
  'record_outcome',
  'result_intent_id',
  'lifecycle_stage',
  'lifecycle_revision',
  'current_snapshot_sha256',
  'intent_record_fingerprint_sha256',
  'volatile_intent_commitment_sha256',
  'fingerprint_encoding_version',
  'account_id',
  'yield_operation_id',
  'yield_submission_id',
  'ledger_transaction_id',
  'ledger_book_id',
  'wallet_id',
  'wallet_chain_namespace',
  'wallet_chain_reference',
  'wallet_identity_digest_version',
  'wallet_identity_digest_hex',
  'network_id',
  'provider_id',
  'protocol_id',
  'market_id',
  'asset_registry_version',
  'asset_registry_fingerprint_sha256',
  'asset_symbol',
  'asset_identity',
  'asset_decimals',
  'action_type',
  'amount_atomic',
  'requested_value_usd_micros',
  'maximum_network_fee_atomic',
  'maximum_network_fee_basis_points',
  'minimum_post_action_native_balance_atomic',
  'allowance_mode',
  'allowance_amount_atomic',
  'idempotency_key_digest_sha256',
  'replay_protection_id',
  'chain_transaction_id',
  'submission_fingerprint_sha256',
  'observation_id',
  'broadcast_outcome',
  'reconciliation_outcome',
  'transaction_position',
  'transaction_block_id',
  'transaction_block_identity_sha256',
  'finalized_position',
  'finalized_block_id',
  'finalized_block_identity_sha256',
  'last_observed_transaction_position',
  'last_observed_transaction_block_id',
  'last_observed_transaction_block_identity_sha256',
  'effective_at',
  'expires_at',
  'terminal',
  'requires_manual_reconciliation',
  'database_replay_protection_enforced',
  'ledger_settlement_authority',
  'recorded_at',
] as const);

const OPERATIONS: readonly DormantMainnetFinancialActionDurableOperation[] = Object.freeze([
  'PREPARE',
  'BIND_SUBMISSION',
  'RECORD_BROADCAST',
  'RECORD_RECONCILIATION',
  'READ',
]);
const STAGES = Object.freeze([
  'PREPARED',
  'WALLET_SIGNED_SUBMISSION_BOUND',
  'BROADCAST_OUTCOME_AMBIGUOUS',
  'RECONCILIATION_AMBIGUOUS',
  'FINALIZED_SUCCESS',
  'FINALIZED_FAILURE',
  'REORG_QUARANTINED',
] as const);
const BROADCAST_OUTCOMES: readonly DormantMainnetWalletBroadcastDatabaseOutcome[] = Object.freeze([
  'WALLET_REPORTED_SUBMITTED',
  'WALLET_REPORTED_AMBIGUOUS',
  'WALLET_REPORTED_REJECTED',
]);
const RECONCILIATION_OUTCOMES: readonly DormantMainnetReconciliationDatabaseOutcome[] =
  Object.freeze(['PENDING', 'UNKNOWN', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORGED_OUT']);
const NONTERMINAL_RECONCILIATION_OUTCOMES: readonly DormantMainnetNonterminalReconciliationDatabaseOutcome[] =
  Object.freeze(['PENDING', 'UNKNOWN']);
const PROVIDER_BINDINGS = new Set([
  'eip155:1:aave:aave-v3',
  'eip155:1:morpho:morpho-blue',
  'eip155:1:compound:compound-iii',
  'eip155:1:spark:sparklend',
  'eip155:1:euler:euler-v2',
  'eip155:1:gearbox:gearbox-v3',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:kamino:kamino-lend',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:save:save-lend',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:project-0:marginfi-v2',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:jupiter:jupiter-lend',
]);

type DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode =
  | 'INVALID_PREPARE_REQUEST'
  | 'INVALID_BIND_SUBMISSION_REQUEST'
  | 'INVALID_VERIFIED_BIND_SUBMISSION_REQUEST'
  | 'INVALID_BROADCAST_REQUEST'
  | 'INVALID_RECONCILIATION_REQUEST'
  | 'INVALID_READ_REQUEST'
  | 'INVALID_CLMA_DATABASE_CURSOR'
  | 'INVALID_DATABASE_RESULT'
  | 'VOLATILE_COMMITMENT_REUSED_AS_DATABASE_CURSOR';

class DormantMainnetFinancialActionLifecycleDatabaseCodecError extends Error {
  constructor(readonly code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode) {
    super('Dormant mainnet financial action database value is invalid.');
    this.name = 'DormantMainnetFinancialActionLifecycleDatabaseCodecError';
  }
}

interface PrepareDatabaseArgumentsV1 {
  readonly intentId: string;
  readonly accountId: string;
  readonly yieldOperationId: string;
  readonly yieldSubmissionId: string;
  readonly ledgerTransactionId: string;
  readonly ledgerBookId: string;
  readonly walletId: string;
  readonly volatileIntentCommitmentSha256: string;
  readonly idempotencyKeyDigestSha256: string;
  readonly replayProtectionId: string;
  readonly networkId: MainnetFinancialActionDatabaseNetworkId;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly assetSymbol: string;
  readonly assetIdentity: string;
  readonly assetDecimals: number;
  readonly actionType: 'SUPPLY' | 'WITHDRAW';
  readonly amountAtomic: string;
  readonly requestedValueUsdMicros: string;
  readonly maximumNetworkFeeAtomic: string;
  readonly maximumNetworkFeeBasisPoints: number;
  readonly minimumPostActionNativeBalanceAtomic: string;
  readonly allowanceMode: 'EXACT';
  readonly allowanceAmountAtomic: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
  readonly walletIdentityDigestCandidates: readonly WalletRegistrationDigestReference<'address'>[];
}

interface CursorDatabaseArgumentsV1 {
  readonly accountId: string;
  readonly intentId: string;
  readonly expectedRevision: string;
  readonly expectedSnapshotSha256: string;
}

interface VerifiedBindDatabaseArgumentsV1 extends CursorDatabaseArgumentsV1 {
  readonly transactionId: string;
  readonly signingPayloadSha256: string;
  readonly signatureEvidenceSha256: string;
  readonly correlationId: string;
  readonly verifierVersion: number;
  readonly verificationIntentFingerprintSha256: string;
  readonly signedEnvelopeSha256: string;
  readonly providerWriteManifestFingerprintSha256: string;
  readonly providerActionBindingSha256: string;
  readonly chainReplayIdentitySha256: string;
  readonly signatureScheme: 'ECDSA_SECP256K1_EIP1559' | 'ED25519_SOLANA_TRANSACTION';
  readonly ethereumNonce: string | null;
  readonly solanaRecentBlockhash: string | null;
}

interface CursorMetadata {
  readonly stage: DormantMainnetFinancialActionDatabaseConfirmedResultV1['stage'];
  readonly terminal: boolean;
  readonly chainTransactionId: string | null;
  readonly submissionFingerprintSha256: string | null;
  readonly volatileIntentCommitmentSha256: string;
  readonly authoritativeIntentAnchor: AuthoritativeIntentAnchor;
  readonly lastObservedTransactionPosition: string | null;
  readonly lastObservedTransactionBlockId: string | null;
  readonly lastObservedTransactionBlockIdentitySha256: string | null;
  readonly effectiveAt: string;
  readonly recordedAt: string;
  readonly finalizedPosition: string | null;
  readonly finalizedBlockId: string | null;
  readonly finalizedBlockIdentitySha256: string | null;
  readonly observationId: string | null;
  readonly broadcastOutcome: DormantMainnetWalletBroadcastDatabaseOutcome | null;
  readonly reconciliationOutcome: DormantMainnetReconciliationDatabaseOutcome | null;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
  readonly transactionBlockIdentitySha256: string | null;
}

interface AuthoritativeIntentAnchor {
  readonly yieldOperationId: string;
  readonly yieldSubmissionId: string;
  readonly ledgerTransactionId: string;
  readonly ledgerBookId: string;
  readonly walletId: string;
  readonly walletChainNamespace: 'eip155' | 'solana';
  readonly walletChainReference: '1' | '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  readonly walletIdentityDigestVersion: number;
  readonly walletIdentityDigestHex: string;
  readonly providerId: string;
  readonly protocolId: string;
  readonly marketId: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly assetSymbol: SupportedStablecoin;
  readonly assetIdentity: string;
  readonly assetDecimals: number;
  readonly actionType: 'SUPPLY' | 'WITHDRAW';
  readonly amountAtomic: string;
  readonly requestedValueUsdMicros: string;
  readonly maximumNetworkFeeAtomic: string;
  readonly maximumNetworkFeeBasisPoints: number;
  readonly minimumPostActionNativeBalanceAtomic: string;
  readonly allowanceMode: 'EXACT';
  readonly allowanceAmountAtomic: string;
  readonly idempotencyKeyDigestSha256: string;
  readonly replayProtectionId: string;
  readonly expiresAt: string;
}

interface ReviewedCursor {
  readonly cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1;
  readonly metadata: CursorMetadata;
}

interface ReviewedDatabaseRowBinding {
  readonly recordOutcome: 'RECORDED' | 'REPLAYED' | 'READ';
  readonly accountId: string;
  readonly intentId: string;
  readonly networkId: MainnetFinancialActionDatabaseNetworkId;
  readonly lifecycleRevision: string;
  readonly currentSnapshotSha256: string;
  readonly intentRecordFingerprintSha256: string;
  readonly volatileIntentCommitmentSha256: string;
  readonly stage: DormantMainnetFinancialActionDatabaseConfirmedResultV1['stage'];
  readonly chainTransactionId: string | null;
  readonly submissionFingerprintSha256: string | null;
  readonly observationId: string | null;
  readonly broadcastOutcome: DormantMainnetWalletBroadcastDatabaseOutcome | null;
  readonly reconciliationOutcome: DormantMainnetReconciliationDatabaseOutcome | null;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
  readonly finalizedPosition: string | null;
  readonly finalizedBlockId: string | null;
  readonly effectiveAt: string;
  readonly expiresAt: string;
  readonly recordedAt: string;
  readonly terminal: boolean;
}

type DormantMainnetFinancialActionLifecycleDatabaseCommandV1 =
  | Readonly<{
      operation: 'PREPARE';
      request: PrepareDormantMainnetFinancialActionDurableRequestV1;
      signal: AbortSignal;
      arguments: Readonly<PrepareDatabaseArgumentsV1>;
    }>
  | Readonly<{
      operation: 'BIND_SUBMISSION';
      request: BindDormantMainnetFinancialActionSubmissionRequestV1;
      cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1;
      signal: AbortSignal;
      arguments: Readonly<
        CursorDatabaseArgumentsV1 & {
          transactionId: string;
          walletSignedPayloadSha256: string;
          walletSignatureEvidenceSha256: string;
          signedAt: string;
          correlationId: string;
        }
      >;
    }>
  | Readonly<{
      operation: 'BIND_VERIFIED_SUBMISSION';
      cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1;
      signal: AbortSignal;
      requestBindingSha256: string;
      arguments: Readonly<VerifiedBindDatabaseArgumentsV1>;
    }>
  | Readonly<{
      operation: 'RECORD_BROADCAST';
      request: RecordDormantMainnetFinancialActionBroadcastRequestV1;
      cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1;
      signal: AbortSignal;
      arguments: Readonly<
        CursorDatabaseArgumentsV1 & {
          observationId: string;
          transactionId: string;
          outcome: DormantMainnetWalletBroadcastDatabaseOutcome;
          evidenceSha256: string;
          observedAt: string;
          correlationId: string;
        }
      >;
    }>
  | Readonly<{
      operation: 'RECORD_RECONCILIATION';
      request: RecordDormantMainnetFinancialActionReconciliationRequestV1;
      cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1;
      signal: AbortSignal;
      arguments: Readonly<
        CursorDatabaseArgumentsV1 & {
          observationId: string;
          transactionId: string;
          outcome: DormantMainnetNonterminalReconciliationDatabaseOutcome;
          transactionPosition: string | null;
          transactionBlockId: string | null;
          finalizedPosition: string;
          finalizedBlockId: string;
          effectEvidenceSha256: string | null;
          failureEvidenceSha256: string | null;
          sourceEvidenceSha256: string;
          observedAt: string;
          correlationId: string;
        }
      >;
    }>
  | Readonly<{
      operation: 'READ';
      request: ReadDormantMainnetFinancialActionDurableRequestV1;
      signal: AbortSignal;
      arguments: Readonly<{ accountId: string; intentId: string }>;
    }>;

/**
 * One adapter-scoped codec instance. Cursor provenance and transition metadata
 * live only in this instance's WeakMap; no property, Symbol, or global registry
 * is attached to a public cursor.
 */
class DormantMainnetFinancialActionLifecycleDatabaseCodec {
  readonly #cursorMetadata = new WeakMap<object, CursorMetadata>();
  readonly #walletIdentityKeyRing: WalletRegistrationKeyRing<'identity-hmac'>;

  constructor(walletIdentityKeyRing: WalletRegistrationKeyRing<'identity-hmac'>) {
    this.#walletIdentityKeyRing = walletIdentityKeyRing;
  }

  encodePrepare(
    value: unknown,
    serverNow: unknown,
  ): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & { readonly operation: 'PREPARE' } {
    return encodePrepare(value, serverNow, this.#walletIdentityKeyRing);
  }

  encodeBindSubmission(value: unknown): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
    readonly operation: 'BIND_SUBMISSION';
  } {
    return encodeBindSubmission(this.#cursorMetadata, value);
  }

  encodeVerifiedBindSubmission(
    value: unknown,
    serverNow: () => unknown,
    reviewVerifierResult: (
      capability: unknown,
      request: VerifyDormantMainnetSignedSubmissionRequestV1,
    ) => DormantMainnetSignedSubmissionVerificationResultV1 | null,
  ): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
    readonly operation: 'BIND_VERIFIED_SUBMISSION';
  } {
    return encodeVerifiedBindSubmission(
      this.#cursorMetadata,
      value,
      serverNow,
      this.#walletIdentityKeyRing,
      reviewVerifierResult,
    );
  }

  encodeBroadcast(value: unknown): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
    readonly operation: 'RECORD_BROADCAST';
  } {
    return encodeBroadcast(this.#cursorMetadata, value);
  }

  encodeReconciliation(value: unknown): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
    readonly operation: 'RECORD_RECONCILIATION';
  } {
    return encodeReconciliation(this.#cursorMetadata, value);
  }

  encodeRead(
    value: unknown,
  ): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & { readonly operation: 'READ' } {
    return encodeRead(value);
  }

  decode(
    command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1,
    value: unknown,
  ): DormantMainnetFinancialActionDatabaseConfirmedResultV1 {
    return decodeDatabaseResult(this.#cursorMetadata, command, value);
  }

  databaseOutcomeUnknown(
    command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1,
  ): DormantMainnetFinancialActionDatabaseOutcomeUnknownV1 {
    return databaseOutcomeUnknown(this.#cursorMetadata, command);
  }
}

function captureWalletIdentityKeyRing(value: unknown): WalletRegistrationKeyRing<'identity-hmac'> {
  const failure = (): never => {
    throw new TypeError('Invalid dormant lifecycle wallet identity key ring.');
  };
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      !Object.isFrozen(value)
    ) {
      return failure();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 3 ||
      !keys.includes('purpose') ||
      !keys.includes('activeWriteVersion') ||
      !keys.includes('keys')
    ) {
      return failure();
    }
    const purposeDescriptor = descriptors.purpose;
    const activeVersionDescriptor = descriptors.activeWriteVersion;
    const candidatesDescriptor = descriptors.keys;
    for (const descriptor of [purposeDescriptor, activeVersionDescriptor, candidatesDescriptor]) {
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.configurable ||
        descriptor.writable !== false ||
        !('value' in descriptor)
      ) {
        return failure();
      }
    }
    const candidates = candidatesDescriptor?.value as unknown;
    if (
      purposeDescriptor?.value !== 'identity-hmac' ||
      !Number.isSafeInteger(activeVersionDescriptor?.value) ||
      (activeVersionDescriptor?.value as number) < 1 ||
      (activeVersionDescriptor?.value as number) > 32_767 ||
      !Array.isArray(candidates) ||
      isProxy(candidates) ||
      Object.getPrototypeOf(candidates) !== Array.prototype ||
      !Object.isFrozen(candidates) ||
      candidates.length < 1 ||
      candidates.length > MAX_WALLET_REGISTRATION_KEYS_PER_PURPOSE
    ) {
      return failure();
    }

    const ring = value as WalletRegistrationKeyRing<'identity-hmac'>;
    const active = activeWalletRegistrationKey(ring);
    let previousVersion = 0;
    for (const candidate of candidates) {
      const version = (candidate as { readonly version?: unknown }).version;
      if (
        !Number.isSafeInteger(version) ||
        (version as number) <= previousVersion ||
        walletRegistrationKeyForVersion(ring, version) !== candidate
      ) {
        return failure();
      }
      previousVersion = version as number;
    }
    if (active.version !== activeVersionDescriptor?.value) return failure();
    return ring;
  } catch {
    return failure();
  }
}

function deriveWalletIdentityDigestCandidates(
  ring: WalletRegistrationKeyRing<'identity-hmac'>,
  networkId: MainnetFinancialActionDatabaseNetworkId,
  canonicalAddress: string,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): readonly WalletRegistrationDigestReference<'address'>[] {
  try {
    const candidates = ring.keys.map((candidate) => {
      const key = walletRegistrationKeyForVersion(ring, candidate.version);
      const reference = digestWalletIdentity(key, networkId, canonicalAddress);
      return Object.freeze({ version: reference.version, value: reference.value });
    });
    if (
      candidates.length < 1 ||
      candidates.length > MAX_WALLET_REGISTRATION_KEYS_PER_PURPOSE ||
      candidates.some(
        (candidate, index) => index > 0 && candidate.version <= candidates[index - 1]!.version,
      )
    ) {
      return invalid(code);
    }
    return Object.freeze(candidates);
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionLifecycleDatabaseCodecError) throw error;
    return invalid(code);
  }
}

/** Pure pre-I/O encoder for migration 0034's address-bound prepare argument set. */
function encodePrepare(
  value: unknown,
  serverNow: unknown,
  walletIdentityKeyRing: WalletRegistrationKeyRing<'identity-hmac'>,
): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & { readonly operation: 'PREPARE' } {
  const code = 'INVALID_PREPARE_REQUEST' as const;
  const record = exactRecord(value, PREPARE_KEYS, code);
  reviewCommonRequest(record, code);
  const signal = activeAbortSignal(record.signal, code);
  const links = exactRecord(record.authoritativeLinks, LINK_KEYS, code);
  const commitment = exactRecord(record.volatileIntentCommitment, VOLATILE_COMMITMENT_KEYS, code);
  if (
    commitment.source !== 'VOLATILE_IN_PROCESS_LIFECYCLE' ||
    commitment.encoding !== 'VOLATILE_JSON_DOMAIN_V1' ||
    commitment.mayServeAsDatabaseCursor !== false
  ) {
    return invalid(code);
  }
  const volatileIntentCommitmentSha256 = digest(commitment.sha256, code);
  let intent: DormantMainnetFinancialActionIntentV1;
  try {
    intent = parseDormantMainnetFinancialActionIntent(record.intentInput, serverNow);
  } catch {
    return invalid(code);
  }
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const registeredAsset = registry.identifyAsset(intent.networkId, intent.assetIdentity);
  const registeredNetwork = registry.networks.find((entry) => entry.networkId === intent.networkId);
  if (
    (intent.action !== 'SUPPLY' && intent.action !== 'WITHDRAW') ||
    intent.assetRegistryVersion !== registry.version ||
    intent.assetRegistryFingerprintSha256 !== registry.fingerprintSha256 ||
    registeredAsset === undefined ||
    registeredNetwork === undefined ||
    registeredAsset.activationState !== 'ACTIVE' ||
    registeredNetwork.activationState !== 'ACTIVE' ||
    registeredAsset.stablecoin !== intent.assetSymbol ||
    registeredAsset.identity !== intent.assetIdentity ||
    registeredAsset.decimals !== intent.assetDecimals
  ) {
    return invalid(code);
  }
  const yieldOperationId = uuid(links.yieldOperationId, code);
  const yieldSubmissionId = uuid(links.yieldSubmissionId, code);
  const ledgerTransactionId = uuid(links.ledgerTransactionId, code);
  const ledgerBookId = uuid(links.ledgerBookId, code);
  if (
    new Set([
      intent.intentId,
      intent.accountId,
      intent.walletRegistrationId,
      intent.replayProtectionId,
      yieldOperationId,
      yieldSubmissionId,
      ledgerTransactionId,
      ledgerBookId,
    ]).size !== 8
  ) {
    return invalid(code);
  }
  const argumentsValue: PrepareDatabaseArgumentsV1 = Object.freeze({
    intentId: intent.intentId,
    accountId: intent.accountId,
    yieldOperationId,
    yieldSubmissionId,
    ledgerTransactionId,
    ledgerBookId,
    walletId: intent.walletRegistrationId,
    volatileIntentCommitmentSha256,
    idempotencyKeyDigestSha256: intent.idempotencyKeyDigestSha256,
    replayProtectionId: intent.replayProtectionId,
    networkId: intent.networkId,
    providerId: intent.providerId,
    protocolId: intent.protocolId,
    marketId: intent.marketId,
    assetRegistryVersion: intent.assetRegistryVersion,
    assetRegistryFingerprintSha256: intent.assetRegistryFingerprintSha256,
    assetSymbol: intent.assetSymbol,
    assetIdentity: intent.assetIdentity,
    assetDecimals: intent.assetDecimals,
    actionType: intent.action,
    amountAtomic: intent.amountAtomic,
    requestedValueUsdMicros: intent.requestedValueUsdMicros,
    maximumNetworkFeeAtomic: intent.maximumNetworkFeeAtomic,
    maximumNetworkFeeBasisPoints: intent.maximumNetworkFeeBasisPoints,
    minimumPostActionNativeBalanceAtomic: intent.minimumPostActionNativeBalanceAtomic,
    allowanceMode: intent.allowanceMode,
    allowanceAmountAtomic: intent.allowanceAmountAtomic,
    issuedAt: intent.issuedAt,
    expiresAt: intent.expiresAt,
    correlationId: uuid(record.correlationId, code),
    walletIdentityDigestCandidates: deriveWalletIdentityDigestCandidates(
      walletIdentityKeyRing,
      intent.networkId,
      intent.walletAddress,
      code,
    ),
  });
  return Object.freeze({
    operation: 'PREPARE' as const,
    request: value as PrepareDormantMainnetFinancialActionDurableRequestV1,
    signal,
    arguments: argumentsValue,
  });
}

/** Pure pre-I/O encoder; only a codec-issued CLMA cursor is accepted. */
function encodeBindSubmission(
  cursorMetadata: WeakMap<object, CursorMetadata>,
  value: unknown,
): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
  readonly operation: 'BIND_SUBMISSION';
} {
  const code = 'INVALID_BIND_SUBMISSION_REQUEST' as const;
  const record = exactRecord(value, BIND_KEYS, code);
  reviewCommonRequest(record, code);
  const signal = activeAbortSignal(record.signal, code);
  const reviewedCursor = reviewCursor(cursorMetadata, record.cursor);
  if (
    reviewedCursor.metadata.stage !== 'PREPARED' ||
    reviewedCursor.metadata.terminal ||
    reviewedCursor.metadata.chainTransactionId !== null ||
    reviewedCursor.metadata.submissionFingerprintSha256 !== null
  ) {
    return invalid(code);
  }
  const cursor = reviewedCursor.cursor;
  const walletSignedPayloadSha256 = digest(record.walletSignedPayloadSha256, code);
  const walletSignatureEvidenceSha256 = digest(record.walletSignatureEvidenceSha256, code);
  if (walletSignedPayloadSha256 === walletSignatureEvidenceSha256) return invalid(code);
  const signedAt = timestamp(record.signedAt, code);
  if (
    Date.parse(signedAt) < Date.parse(reviewedCursor.metadata.effectiveAt) ||
    Date.parse(signedAt) >= Date.parse(reviewedCursor.metadata.authoritativeIntentAnchor.expiresAt)
  ) {
    return invalid(code);
  }
  return Object.freeze({
    operation: 'BIND_SUBMISSION' as const,
    request: value as BindDormantMainnetFinancialActionSubmissionRequestV1,
    cursor,
    signal,
    arguments: Object.freeze({
      ...cursorArguments(cursor),
      transactionId: chainIdentity(cursor.networkId, record.transactionId, 'TRANSACTION', code),
      walletSignedPayloadSha256,
      walletSignatureEvidenceSha256,
      signedAt,
      correlationId: uuid(record.correlationId, code),
    }),
  });
}

/**
 * Reviews and consumes one verifier-issued capability before producing the
 * digest-only migration-0039 argument set. No signed wire crosses this codec.
 */
function encodeVerifiedBindSubmission(
  cursorMetadata: WeakMap<object, CursorMetadata>,
  value: unknown,
  serverNow: () => unknown,
  walletIdentityKeyRing: WalletRegistrationKeyRing<'identity-hmac'>,
  reviewVerifierResult: (
    capability: unknown,
    request: VerifyDormantMainnetSignedSubmissionRequestV1,
  ) => DormantMainnetSignedSubmissionVerificationResultV1 | null,
): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
  readonly operation: 'BIND_VERIFIED_SUBMISSION';
} {
  const code = 'INVALID_VERIFIED_BIND_SUBMISSION_REQUEST' as const;
  const record = exactFrozenRecord(value, VERIFIED_BIND_KEYS, code);
  if (
    record.verifiedSubmissionBinderVersion !== DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION ||
    record.use !== DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_REQUEST_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false
  ) {
    return invalid(code);
  }
  const signal = activeNativeAbortSignal(record.signal, code);
  const reviewedCursor = reviewCursor(cursorMetadata, record.cursor);
  if (
    reviewedCursor.metadata.stage !== 'PREPARED' ||
    reviewedCursor.metadata.terminal ||
    reviewedCursor.metadata.chainTransactionId !== null ||
    reviewedCursor.metadata.submissionFingerprintSha256 !== null ||
    reviewedCursor.cursor.lifecycleRevision !== '1'
  ) {
    return invalid(code);
  }

  const verificationRequestRecord = exactFrozenRecord(
    record.verificationRequest,
    SIGNED_VERIFICATION_REQUEST_KEYS,
    code,
  );
  const verificationIntentRecord = exactFrozenRecord(
    verificationRequestRecord.intent,
    SIGNED_VERIFICATION_INTENT_KEYS,
    code,
  );
  const verificationWireRecord = exactFrozenRecord(
    verificationRequestRecord.wire,
    SIGNED_VERIFICATION_WIRE_KEYS,
    code,
  );
  const verificationRequest =
    record.verificationRequest as VerifyDormantMainnetSignedSubmissionRequestV1;
  if (
    verificationRequestRecord.verifierVersion !==
      DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION ||
    verificationRequestRecord.use !== DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFICATION_USE ||
    verificationRequestRecord.mayAuthorizeFinancialAction !== false ||
    verificationRequestRecord.mayPersist !== false ||
    digest(verificationRequestRecord.intentRecordFingerprintSha256, code) !==
      reviewedCursor.cursor.intentRecordFingerprintSha256 ||
    verificationRequestRecord.signal !== signal ||
    verificationWireRecord.networkId !== reviewedCursor.cursor.networkId ||
    (reviewedCursor.cursor.networkId === ETHEREUM_MAINNET
      ? verificationWireRecord.encoding !== 'LOWERCASE_0X_HEX'
      : verificationWireRecord.encoding !== 'CANONICAL_BASE64') ||
    typeof verificationWireRecord.signedTransaction !== 'string' ||
    verificationWireRecord.signedTransaction.length < 1
  ) {
    return invalid(code);
  }
  const intent = verificationRequestRecord.intent as DormantMainnetFinancialActionIntentV1;
  reviewVerifiedIntentBinding(reviewedCursor, verificationIntentRecord, intent, code);

  const startedAt = timestamp(serverNow(), code);
  const expiresAtMilliseconds = Date.parse(
    reviewedCursor.metadata.authoritativeIntentAnchor.expiresAt,
  );
  if (
    Date.parse(startedAt) < Date.parse(reviewedCursor.metadata.recordedAt) ||
    Date.parse(startedAt) >= expiresAtMilliseconds
  ) {
    return invalid(code);
  }
  const correlationId = uuid(record.correlationId, code);
  reviewOpaqueVerifierCapability(record.verificationCapability, code);

  let reviewedResult: DormantMainnetSignedSubmissionVerificationResultV1 | null;
  try {
    reviewedResult = reviewVerifierResult(record.verificationCapability, verificationRequest);
  } catch {
    return invalid(code);
  }
  if (reviewedResult === null || isAborted(signal)) return invalid(code);
  const completedAt = timestamp(serverNow(), code);
  if (
    Date.parse(completedAt) < Date.parse(startedAt) ||
    Date.parse(completedAt) >= expiresAtMilliseconds
  ) {
    return invalid(code);
  }
  const argumentsValue = reviewSignedVerificationResult(
    reviewedResult,
    verificationRequest,
    reviewedCursor,
    walletIdentityKeyRing,
    correlationId,
    code,
  );
  if (isAborted(signal)) return invalid(code);
  const request = value as BindDormantMainnetVerifiedSubmissionRequestV1;
  return Object.freeze({
    operation: 'BIND_VERIFIED_SUBMISSION' as const,
    cursor: reviewedCursor.cursor,
    signal,
    requestBindingSha256: verifiedBindRequestSha256(request),
    arguments: argumentsValue,
  });
}

function reviewVerifiedIntentBinding(
  reviewedCursor: ReviewedCursor,
  record: Record<string, unknown>,
  intent: DormantMainnetFinancialActionIntentV1,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): void {
  const anchor = reviewedCursor.metadata.authoritativeIntentAnchor;
  if (
    record.schemaVersion !== 1 ||
    record.use !== 'DORMANT_MAINNET_FINANCIAL_ACTION_INTENT_VALIDATION_ONLY' ||
    record.mayAuthorizeFinancialAction !== false ||
    record.signingResponsibility !== 'USER_WALLET_ONLY' ||
    record.broadcastResponsibility !== 'USER_WALLET_ONLY' ||
    record.apiMaySign !== false ||
    record.apiMayBroadcast !== false ||
    record.crossChainExecutionAllowed !== false ||
    record.automaticResendAllowed !== false ||
    record.automaticFeeEscalationAllowed !== false ||
    record.durableReplayProtectionVerified !== false ||
    record.intentId !== reviewedCursor.cursor.intentId ||
    record.accountId !== reviewedCursor.cursor.accountId ||
    record.networkId !== reviewedCursor.cursor.networkId ||
    record.walletRegistrationId !== anchor.walletId ||
    record.providerId !== anchor.providerId ||
    record.protocolId !== anchor.protocolId ||
    record.marketId !== anchor.marketId ||
    record.assetRegistryVersion !== anchor.assetRegistryVersion ||
    record.assetRegistryFingerprintSha256 !== anchor.assetRegistryFingerprintSha256 ||
    record.assetSymbol !== anchor.assetSymbol ||
    record.assetIdentity !== anchor.assetIdentity ||
    record.assetDecimals !== anchor.assetDecimals ||
    record.action !== anchor.actionType ||
    record.amountAtomic !== anchor.amountAtomic ||
    record.requestedValueUsdMicros !== anchor.requestedValueUsdMicros ||
    record.maximumNetworkFeeAtomic !== anchor.maximumNetworkFeeAtomic ||
    record.maximumNetworkFeeBasisPoints !== anchor.maximumNetworkFeeBasisPoints ||
    record.minimumPostActionNativeBalanceAtomic !== anchor.minimumPostActionNativeBalanceAtomic ||
    record.allowanceMode !== anchor.allowanceMode ||
    record.allowanceAmountAtomic !== anchor.allowanceAmountAtomic ||
    record.idempotencyKeyDigestSha256 !== anchor.idempotencyKeyDigestSha256 ||
    record.replayProtectionId !== anchor.replayProtectionId ||
    record.expiresAt !== anchor.expiresAt ||
    typeof record.issuedAt !== 'string' ||
    typeof record.walletAddress !== 'string'
  ) {
    return invalid(code);
  }
  try {
    if (
      fingerprintDormantMainnetSignedVerificationIntent(
        reviewedCursor.cursor.intentRecordFingerprintSha256,
        intent,
      ).length !== 64 ||
      persistedIntentFingerprint(reviewedCursor, intent, code) !==
        reviewedCursor.cursor.intentRecordFingerprintSha256
    ) {
      return invalid(code);
    }
  } catch {
    return invalid(code);
  }
}

/** Recomputes migration 0033's authoritative row fingerprint, including issued_at. */
function persistedIntentFingerprint(
  reviewedCursor: ReviewedCursor,
  intent: DormantMainnetFinancialActionIntentV1,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string {
  const anchor = reviewedCursor.metadata.authoritativeIntentAnchor;
  const issuedAt = timestamp(intent.issuedAt, code);
  const expiresAt = timestamp(anchor.expiresAt, code);
  return sha256ClmaFp1(
    'CRYPTO_LENDING:MAINNET_ACTION:PERSISTED_INTENT:FRAMED:v1',
    PERSISTED_INTENT_FINGERPRINT_FIELD_NAMES,
    [
      '1',
      reviewedCursor.cursor.intentId,
      reviewedCursor.cursor.accountId,
      anchor.yieldOperationId,
      anchor.yieldSubmissionId,
      anchor.ledgerTransactionId,
      anchor.ledgerBookId,
      anchor.walletId,
      anchor.walletChainNamespace,
      anchor.walletChainReference,
      String(anchor.walletIdentityDigestVersion),
      anchor.walletIdentityDigestHex,
      reviewedCursor.cursor.networkId,
      anchor.providerId,
      anchor.protocolId,
      anchor.marketId,
      String(anchor.assetRegistryVersion),
      anchor.assetRegistryFingerprintSha256,
      anchor.assetSymbol,
      anchor.assetIdentity,
      String(anchor.assetDecimals),
      anchor.actionType,
      anchor.amountAtomic,
      anchor.requestedValueUsdMicros,
      anchor.maximumNetworkFeeAtomic,
      String(anchor.maximumNetworkFeeBasisPoints),
      anchor.minimumPostActionNativeBalanceAtomic,
      anchor.allowanceMode,
      anchor.allowanceAmountAtomic,
      anchor.idempotencyKeyDigestSha256,
      anchor.replayProtectionId,
      String(Date.parse(issuedAt)),
      String(Date.parse(expiresAt)),
      'USER_WALLET_ONLY',
      'USER_WALLET_ONLY',
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
      'false',
      'true',
      'false',
      reviewedCursor.metadata.volatileIntentCommitmentSha256,
    ],
  );
}

function reviewOpaqueVerifierCapability(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): void {
  const record = exactFrozenRecord(value, SIGNED_VERIFICATION_CAPABILITY_KEYS, code);
  if (
    record.verifierVersion !== DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION ||
    record.use !== DORMANT_MAINNET_SIGNED_SUBMISSION_CAPABILITY_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.apiMaySign !== false ||
    record.apiMayBroadcast !== false
  ) {
    return invalid(code);
  }
}

function reviewSignedVerificationResult(
  value: unknown,
  verificationRequest: VerifyDormantMainnetSignedSubmissionRequestV1,
  reviewedCursor: ReviewedCursor,
  walletIdentityKeyRing: WalletRegistrationKeyRing<'identity-hmac'>,
  correlationId: string,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): Readonly<VerifiedBindDatabaseArgumentsV1> {
  const record = exactFrozenRecord(value, SIGNED_VERIFICATION_RESULT_KEYS, code);
  const intent = verificationRequest.intent;
  const expectedVerificationIntentFingerprint = fingerprintDormantMainnetSignedVerificationIntent(
    reviewedCursor.cursor.intentRecordFingerprintSha256,
    intent,
  );
  if (
    record.verifierVersion !== DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION ||
    record.use !== DORMANT_MAINNET_SIGNED_SUBMISSION_RESULT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.apiMaySign !== false ||
    record.apiMayBroadcast !== false ||
    record.mayResendTransaction !== false ||
    record.automaticRetryAllowed !== false ||
    record.dynamicChainStateVerified !== false ||
    record.providerDeploymentVerified !== false ||
    record.currentNonceOrBlockhashVerified !== false ||
    record.walletBalanceVerified !== false ||
    record.intentId !== reviewedCursor.cursor.intentId ||
    record.intentRecordFingerprintSha256 !== reviewedCursor.cursor.intentRecordFingerprintSha256 ||
    record.verificationIntentFingerprintSha256 !== expectedVerificationIntentFingerprint ||
    record.networkId !== reviewedCursor.cursor.networkId ||
    record.signerWalletAddress !== intent.walletAddress ||
    record.staticCommandVerification !== 'CRYPTOGRAPHIC_SIGNATURE_AND_EXACT_MANIFEST_MATCH'
  ) {
    return invalid(code);
  }

  const transactionId = chainIdentity(
    reviewedCursor.cursor.networkId,
    record.transactionId,
    'TRANSACTION',
    code,
  );
  const signedEnvelopeSha256 = digest(record.signedEnvelopeSha256, code);
  const signingPayloadSha256 = digest(record.signingPayloadSha256, code);
  const signatureEvidenceSha256 = digest(record.signatureEvidenceSha256, code);
  const chainReplayIdentitySha256 = digest(record.chainReplayIdentitySha256, code);
  const providerWriteManifestFingerprintSha256 = digest(
    record.providerWriteManifestFingerprintSha256,
    code,
  );
  const providerActionBindingSha256 = digest(record.providerActionBindingSha256, code);
  if (
    signingPayloadSha256 === signatureEvidenceSha256 ||
    new Set([
      signedEnvelopeSha256,
      signingPayloadSha256,
      signatureEvidenceSha256,
      chainReplayIdentitySha256,
      providerWriteManifestFingerprintSha256,
      providerActionBindingSha256,
    ]).size !== 6
  ) {
    return invalid(code);
  }

  let signatureScheme: VerifiedBindDatabaseArgumentsV1['signatureScheme'];
  let ethereumNonce: string | null;
  let solanaRecentBlockhash: string | null;
  if (reviewedCursor.cursor.networkId === ETHEREUM_MAINNET) {
    if (
      record.signatureScheme !== 'ECDSA_SECP256K1_EIP1559' ||
      record.solanaRecentBlockhash !== null
    ) {
      return invalid(code);
    }
    signatureScheme = 'ECDSA_SECP256K1_EIP1559';
    ethereumNonce = uint64(record.ethereumNonce, code);
    solanaRecentBlockhash = null;
  } else {
    if (record.signatureScheme !== 'ED25519_SOLANA_TRANSACTION' || record.ethereumNonce !== null) {
      return invalid(code);
    }
    signatureScheme = 'ED25519_SOLANA_TRANSACTION';
    ethereumNonce = null;
    solanaRecentBlockhash = chainIdentity(
      reviewedCursor.cursor.networkId,
      record.solanaRecentBlockhash,
      'BLOCK',
      code,
    );
  }

  const anchor = reviewedCursor.metadata.authoritativeIntentAnchor;
  let walletDigest: WalletRegistrationDigestReference<'address'>;
  try {
    walletDigest = digestWalletIdentity(
      walletRegistrationKeyForVersion(walletIdentityKeyRing, anchor.walletIdentityDigestVersion),
      reviewedCursor.cursor.networkId,
      intent.walletAddress,
    );
  } catch {
    return invalid(code);
  }
  if (
    !walletRegistrationDigestEquals(walletDigest, {
      version: anchor.walletIdentityDigestVersion,
      value:
        anchor.walletIdentityDigestHex as WalletRegistrationDigestReference<'address'>['value'],
    })
  ) {
    return invalid(code);
  }

  return Object.freeze({
    ...cursorArguments(reviewedCursor.cursor),
    transactionId,
    signingPayloadSha256,
    signatureEvidenceSha256,
    correlationId,
    verifierVersion: DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
    verificationIntentFingerprintSha256: expectedVerificationIntentFingerprint,
    signedEnvelopeSha256,
    providerWriteManifestFingerprintSha256,
    providerActionBindingSha256,
    chainReplayIdentitySha256,
    signatureScheme,
    ethereumNonce,
    solanaRecentBlockhash,
  });
}

function verifiedBindRequestSha256(request: BindDormantMainnetVerifiedSubmissionRequestV1): string {
  const verification = request.verificationRequest;
  return sha256Framed('CLMA-VERIFIED-SUBMISSION-BINDER-REQUEST-1', [
    request.cursor.accountId,
    request.cursor.intentId,
    request.cursor.networkId,
    request.cursor.lifecycleRevision,
    request.cursor.currentSnapshotSha256,
    request.cursor.intentRecordFingerprintSha256,
    request.correlationId,
    fingerprintDormantMainnetSignedVerificationIntent(
      verification.intentRecordFingerprintSha256,
      verification.intent,
    ),
    verification.wire.networkId,
    verification.wire.encoding,
    sha256Framed('CLMA-TRANSIENT-SIGNED-WIRE-1', [verification.wire.signedTransaction]),
  ]);
}

/** Pure pre-I/O encoder; it records wallet evidence but grants no broadcast authority. */
function encodeBroadcast(
  cursorMetadata: WeakMap<object, CursorMetadata>,
  value: unknown,
): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
  readonly operation: 'RECORD_BROADCAST';
} {
  const code = 'INVALID_BROADCAST_REQUEST' as const;
  const record = exactRecord(value, BROADCAST_KEYS, code);
  reviewCommonRequest(record, code);
  const signal = activeAbortSignal(record.signal, code);
  const reviewedCursor = reviewCursor(cursorMetadata, record.cursor);
  if (
    reviewedCursor.metadata.stage !== 'WALLET_SIGNED_SUBMISSION_BOUND' ||
    reviewedCursor.metadata.terminal ||
    reviewedCursor.metadata.chainTransactionId === null ||
    reviewedCursor.metadata.submissionFingerprintSha256 === null
  ) {
    return invalid(code);
  }
  const cursor = reviewedCursor.cursor;
  if (
    !BROADCAST_OUTCOMES.includes(record.outcome as DormantMainnetWalletBroadcastDatabaseOutcome)
  ) {
    return invalid(code);
  }
  const transactionId = chainIdentity(cursor.networkId, record.transactionId, 'TRANSACTION', code);
  if (transactionId !== reviewedCursor.metadata.chainTransactionId) return invalid(code);
  const observedAt = timestamp(record.observedAt, code);
  if (Date.parse(observedAt) < Date.parse(reviewedCursor.metadata.effectiveAt)) {
    return invalid(code);
  }
  return Object.freeze({
    operation: 'RECORD_BROADCAST' as const,
    request: value as RecordDormantMainnetFinancialActionBroadcastRequestV1,
    cursor,
    signal,
    arguments: Object.freeze({
      ...cursorArguments(cursor),
      observationId: uuid(record.observationId, code),
      transactionId,
      outcome: record.outcome as DormantMainnetWalletBroadcastDatabaseOutcome,
      evidenceSha256: digest(record.evidenceSha256, code),
      observedAt,
      correlationId: uuid(record.correlationId, code),
    }),
  });
}

/** Pure pre-I/O encoder for direct or post-broadcast reconciliation evidence. */
function encodeReconciliation(
  cursorMetadata: WeakMap<object, CursorMetadata>,
  value: unknown,
): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
  readonly operation: 'RECORD_RECONCILIATION';
} {
  const code = 'INVALID_RECONCILIATION_REQUEST' as const;
  const record = exactRecord(value, RECONCILIATION_KEYS, code);
  reviewCommonRequest(record, code);
  const signal = activeAbortSignal(record.signal, code);
  const reviewedCursor = reviewCursor(cursorMetadata, record.cursor);
  if (
    reviewedCursor.metadata.terminal ||
    !(
      reviewedCursor.metadata.stage === 'WALLET_SIGNED_SUBMISSION_BOUND' ||
      reviewedCursor.metadata.stage === 'BROADCAST_OUTCOME_AMBIGUOUS' ||
      reviewedCursor.metadata.stage === 'RECONCILIATION_AMBIGUOUS'
    ) ||
    reviewedCursor.metadata.chainTransactionId === null ||
    reviewedCursor.metadata.submissionFingerprintSha256 === null
  ) {
    return invalid(code);
  }
  const cursor = reviewedCursor.cursor;
  if (
    !NONTERMINAL_RECONCILIATION_OUTCOMES.includes(
      record.outcome as DormantMainnetNonterminalReconciliationDatabaseOutcome,
    )
  ) {
    return invalid(code);
  }
  const outcome = record.outcome as DormantMainnetNonterminalReconciliationDatabaseOutcome;
  const transactionPosition = nullableUint64(record.transactionPosition, code);
  const transactionBlockId = nullableChainIdentity(
    cursor.networkId,
    record.transactionBlockId,
    'BLOCK',
    code,
  );
  if ((transactionPosition === null) !== (transactionBlockId === null)) return invalid(code);
  const finalizedPosition = uint64(record.finalizedPosition, code);
  const finalizedBlockId = chainIdentity(cursor.networkId, record.finalizedBlockId, 'BLOCK', code);
  const effectEvidenceSha256 = null;
  const failureEvidenceSha256 = null;
  const sourceEvidenceSha256 = digest(record.sourceEvidenceSha256, code);
  assertReconciliationShape(
    outcome,
    transactionPosition,
    finalizedPosition,
    effectEvidenceSha256,
    failureEvidenceSha256,
    sourceEvidenceSha256,
    code,
  );
  if (reviewedCursor.metadata.finalizedPosition !== null) {
    const comparison =
      BigInt(finalizedPosition) - BigInt(reviewedCursor.metadata.finalizedPosition);
    if (
      comparison < 0n ||
      (comparison === 0n && finalizedBlockId !== reviewedCursor.metadata.finalizedBlockId)
    ) {
      return invalid(code);
    }
  }
  if (
    reviewedCursor.metadata.lastObservedTransactionPosition !== null &&
    transactionPosition !== null &&
    (transactionPosition !== reviewedCursor.metadata.lastObservedTransactionPosition ||
      transactionBlockId !== reviewedCursor.metadata.lastObservedTransactionBlockId)
  ) {
    return invalid(code);
  }
  const transactionId = chainIdentity(cursor.networkId, record.transactionId, 'TRANSACTION', code);
  if (transactionId !== reviewedCursor.metadata.chainTransactionId) return invalid(code);
  const observedAt = timestamp(record.observedAt, code);
  if (Date.parse(observedAt) < Date.parse(reviewedCursor.metadata.effectiveAt)) {
    return invalid(code);
  }
  return Object.freeze({
    operation: 'RECORD_RECONCILIATION' as const,
    request: value as RecordDormantMainnetFinancialActionReconciliationRequestV1,
    cursor,
    signal,
    arguments: Object.freeze({
      ...cursorArguments(cursor),
      observationId: uuid(record.observationId, code),
      transactionId,
      outcome,
      transactionPosition,
      transactionBlockId,
      finalizedPosition,
      finalizedBlockId,
      effectEvidenceSha256,
      failureEvidenceSha256,
      sourceEvidenceSha256,
      observedAt,
      correlationId: uuid(record.correlationId, code),
    }),
  });
}

/** Pure pre-I/O encoder for the account-scoped read function. */
function encodeRead(
  value: unknown,
): DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & { readonly operation: 'READ' } {
  const code = 'INVALID_READ_REQUEST' as const;
  const record = exactRecord(value, READ_KEYS, code);
  reviewCommonRequest(record, code);
  const signal = activeAbortSignal(record.signal, code);
  return Object.freeze({
    operation: 'READ' as const,
    request: value as ReadDormantMainnetFinancialActionDurableRequestV1,
    signal,
    arguments: Object.freeze({
      accountId: uuid(record.accountId, code),
      intentId: uuid(record.intentId, code),
    }),
  });
}

/**
 * Reviews one exact migration-0033 result row and issues the only runtime-valid
 * CLMA cursor. The volatile commitment remains separate audit data. A row that
 * reuses it for either durable cursor digest is rejected fail closed.
 */
function decodeDatabaseResult(
  cursorMetadata: WeakMap<object, CursorMetadata>,
  command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1,
  value: unknown,
): DormantMainnetFinancialActionDatabaseConfirmedResultV1 {
  const code = 'INVALID_DATABASE_RESULT' as const;
  const operation =
    command.operation === 'BIND_VERIFIED_SUBMISSION'
      ? ('BIND_SUBMISSION' as const)
      : command.operation;
  const row = exactRecord(value, RESULT_ROW_KEYS, code);
  if (
    !(['RECORDED', 'REPLAYED', 'READ'] as readonly unknown[]).includes(row.record_outcome) ||
    (operation === 'READ') !== (row.record_outcome === 'READ') ||
    !STAGES.includes(row.lifecycle_stage as (typeof STAGES)[number]) ||
    row.fingerprint_encoding_version !== 1 ||
    row.database_replay_protection_enforced !== true ||
    row.ledger_settlement_authority !== false
  ) {
    return invalid(code);
  }

  const accountId = uuid(row.account_id, code);
  const intentId = uuid(row.result_intent_id, code);
  const networkId = network(row.network_id, code);
  const lifecycleRevision = positiveInt64(row.lifecycle_revision, code);
  const currentSnapshotSha256 = digest(row.current_snapshot_sha256, code);
  const intentRecordFingerprintSha256 = digest(row.intent_record_fingerprint_sha256, code);
  const volatileIntentCommitmentSha256 = digest(row.volatile_intent_commitment_sha256, code);
  const stage = row.lifecycle_stage as (typeof STAGES)[number];
  const revision = BigInt(lifecycleRevision);
  if (
    (stage === 'PREPARED' && revision !== 1n) ||
    (stage === 'WALLET_SIGNED_SUBMISSION_BOUND' && revision !== 2n) ||
    (stage === 'BROADCAST_OUTCOME_AMBIGUOUS' && revision !== 3n) ||
    ((stage === 'RECONCILIATION_AMBIGUOUS' ||
      stage === 'FINALIZED_SUCCESS' ||
      stage === 'FINALIZED_FAILURE' ||
      stage === 'REORG_QUARANTINED') &&
      revision < 3n)
  ) {
    return invalid(code);
  }
  if (
    currentSnapshotSha256 === volatileIntentCommitmentSha256 ||
    intentRecordFingerprintSha256 === volatileIntentCommitmentSha256
  ) {
    return invalid('VOLATILE_COMMITMENT_REUSED_AS_DATABASE_CURSOR');
  }
  if (currentSnapshotSha256 === intentRecordFingerprintSha256) {
    return invalid(code);
  }

  const authoritativeIntentAnchor = reviewAuthoritativeRowIdentity(row, networkId, code);
  const chainTransactionId = nullableChainIdentity(
    networkId,
    row.chain_transaction_id,
    'TRANSACTION',
    code,
  );
  const submissionFingerprintSha256 = nullableDigest(row.submission_fingerprint_sha256, code);
  const observationId = nullableUuid(row.observation_id, code);
  const broadcastOutcome = nullableMember(row.broadcast_outcome, BROADCAST_OUTCOMES, code);
  const reconciliationOutcome = nullableMember(
    row.reconciliation_outcome,
    RECONCILIATION_OUTCOMES,
    code,
  );
  const transactionPosition = nullableUint64(row.transaction_position, code);
  const transactionBlockId = nullableChainIdentity(
    networkId,
    row.transaction_block_id,
    'BLOCK',
    code,
  );
  const transactionBlockIdentitySha256 = nullableDigest(
    row.transaction_block_identity_sha256,
    code,
  );
  if ((transactionBlockIdentitySha256 === null) !== (transactionBlockId === null)) {
    return invalid(code);
  }
  const finalizedPosition = nullableUint64(row.finalized_position, code);
  const finalizedBlockId = nullableChainIdentity(networkId, row.finalized_block_id, 'BLOCK', code);
  const finalizedBlockIdentitySha256 = nullableDigest(row.finalized_block_identity_sha256, code);
  if ((finalizedBlockIdentitySha256 === null) !== (finalizedBlockId === null)) {
    return invalid(code);
  }
  const lastObservedTransactionPosition = nullableUint64(
    row.last_observed_transaction_position,
    code,
  );
  const lastObservedTransactionBlockId = nullableChainIdentity(
    networkId,
    row.last_observed_transaction_block_id,
    'BLOCK',
    code,
  );
  if ((lastObservedTransactionPosition === null) !== (lastObservedTransactionBlockId === null)) {
    return invalid(code);
  }
  const lastObservedTransactionBlockIdentitySha256 = nullableDigest(
    row.last_observed_transaction_block_identity_sha256,
    code,
  );
  if (
    (lastObservedTransactionBlockIdentitySha256 === null) !==
    (lastObservedTransactionBlockId === null)
  ) {
    return invalid(code);
  }
  if (
    ((stage === 'PREPARED' ||
      stage === 'WALLET_SIGNED_SUBMISSION_BOUND' ||
      stage === 'BROADCAST_OUTCOME_AMBIGUOUS') &&
      lastObservedTransactionPosition !== null) ||
    (transactionPosition !== null &&
      (lastObservedTransactionPosition !== transactionPosition ||
        lastObservedTransactionBlockId !== transactionBlockId ||
        row.last_observed_transaction_block_identity_sha256 !==
          row.transaction_block_identity_sha256))
  ) {
    return invalid(code);
  }
  reviewStageShape(
    stage,
    chainTransactionId,
    submissionFingerprintSha256,
    observationId,
    broadcastOutcome,
    reconciliationOutcome,
    transactionPosition,
    transactionBlockId,
    finalizedPosition,
    finalizedBlockId,
    code,
  );
  const terminal = boolean(row.terminal, code);
  const requiresManualReconciliation = boolean(row.requires_manual_reconciliation, code);
  const expectedTerminal =
    stage === 'FINALIZED_SUCCESS' || stage === 'FINALIZED_FAILURE' || stage === 'REORG_QUARANTINED';
  if (
    terminal !== expectedTerminal ||
    requiresManualReconciliation !== (stage === 'REORG_QUARANTINED')
  ) {
    return invalid(code);
  }
  const effectiveAt = timestamp(row.effective_at, code);
  const expiresAt = timestamp(row.expires_at, code);
  const recordedAt = timestamp(row.recorded_at, code);
  if (
    Date.parse(effectiveAt) > Date.parse(recordedAt) ||
    ((stage === 'PREPARED' || stage === 'WALLET_SIGNED_SUBMISSION_BOUND') &&
      Date.parse(effectiveAt) >= Date.parse(expiresAt)) ||
    (stage === 'PREPARED' && lifecycleRevision !== '1')
  ) {
    return invalid(code);
  }

  const binding: ReviewedDatabaseRowBinding = Object.freeze({
    recordOutcome: row.record_outcome as 'RECORDED' | 'REPLAYED' | 'READ',
    accountId,
    intentId,
    networkId,
    lifecycleRevision,
    currentSnapshotSha256,
    intentRecordFingerprintSha256,
    volatileIntentCommitmentSha256,
    stage,
    chainTransactionId,
    submissionFingerprintSha256,
    observationId,
    broadcastOutcome,
    reconciliationOutcome,
    transactionPosition,
    transactionBlockId,
    finalizedPosition,
    finalizedBlockId,
    effectiveAt,
    expiresAt,
    recordedAt,
    terminal,
  });
  reviewCommandResultBinding(
    cursorMetadata,
    command,
    row,
    binding,
    authoritativeIntentAnchor,
    code,
  );

  const cursor = issueCursor(
    cursorMetadata,
    {
      accountId,
      intentId,
      networkId,
      lifecycleRevision,
      currentSnapshotSha256,
      intentRecordFingerprintSha256,
    },
    {
      stage,
      terminal,
      chainTransactionId,
      submissionFingerprintSha256,
      volatileIntentCommitmentSha256,
      authoritativeIntentAnchor,
      lastObservedTransactionPosition,
      lastObservedTransactionBlockId,
      lastObservedTransactionBlockIdentitySha256,
      effectiveAt,
      recordedAt,
      finalizedPosition,
      finalizedBlockId,
      finalizedBlockIdentitySha256,
      observationId,
      broadcastOutcome,
      reconciliationOutcome,
      transactionPosition,
      transactionBlockId,
      transactionBlockIdentitySha256,
    },
  );
  return Object.freeze({
    durableLifecycleVersion: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    apiMaySign: false as const,
    apiMayBroadcast: false as const,
    mayResendTransaction: false as const,
    automaticRetryAllowed: false as const,
    ledgerSettlementAuthority: false as const,
    outcome: 'DATABASE_STATE_CONFIRMED' as const,
    operation,
    databaseRecordOutcome: binding.recordOutcome,
    cursor,
    volatileIntentCommitmentSha256,
    stage,
    chainTransactionId,
    submissionFingerprintSha256,
    observationId,
    broadcastOutcome,
    reconciliationOutcome,
    transactionPosition,
    transactionBlockId,
    finalizedPosition,
    finalizedBlockId,
    lastObservedTransactionPosition,
    lastObservedTransactionBlockId,
    effectiveAt,
    expiresAt,
    recordedAt,
    terminal,
    requiresManualReconciliation,
    databaseReplayProtectionEnforced: true as const,
    recoveryMode: terminal
      ? ('NONE' as const)
      : stage === 'PREPARED'
        ? ('READ_ONLY' as const)
        : ('READ_THEN_RECONCILE_ONLY' as const),
  });
}

/** Models a lost database response without retry, signing, broadcast, or settlement authority. */
function databaseOutcomeUnknown(
  cursorMetadata: WeakMap<object, CursorMetadata>,
  command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1,
): DormantMainnetFinancialActionDatabaseOutcomeUnknownV1 {
  const operation =
    command.operation === 'BIND_VERIFIED_SUBMISSION'
      ? ('BIND_SUBMISSION' as const)
      : command.operation;
  if (!OPERATIONS.includes(operation)) return invalid('INVALID_DATABASE_RESULT');
  const postWallet =
    operation === 'BIND_SUBMISSION' ||
    operation === 'RECORD_BROADCAST' ||
    operation === 'RECORD_RECONCILIATION';
  const lastConfirmedCursor =
    command.operation === 'BIND_SUBMISSION' ||
    command.operation === 'BIND_VERIFIED_SUBMISSION' ||
    command.operation === 'RECORD_BROADCAST' ||
    command.operation === 'RECORD_RECONCILIATION'
      ? reviewCursor(cursorMetadata, command.cursor).cursor
      : null;
  const common = {
    durableLifecycleVersion: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
    use: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE,
    mayAuthorizeFinancialAction: false as const,
    apiMaySign: false as const,
    apiMayBroadcast: false as const,
    mayResendTransaction: false as const,
    automaticRetryAllowed: false as const,
    ledgerSettlementAuthority: false as const,
    outcome: 'DATABASE_OUTCOME_UNKNOWN' as const,
  };
  if (postWallet) {
    return Object.freeze({
      ...common,
      operation,
      lastConfirmedCursor: lastConfirmedCursor!,
      recoveryMode: 'READ_THEN_RECONCILE_ONLY' as const,
      reconciliationOnly: true as const,
    });
  }
  return Object.freeze({
    ...common,
    operation: operation as 'PREPARE' | 'READ',
    lastConfirmedCursor,
    recoveryMode: 'READ_ONLY' as const,
    reconciliationOnly: false as const,
  });
}

function reviewCommandResultBinding(
  cursorMetadata: WeakMap<object, CursorMetadata>,
  command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1,
  row: Record<string, unknown>,
  binding: ReviewedDatabaseRowBinding,
  authoritativeIntentAnchor: AuthoritativeIntentAnchor,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): void {
  if (
    binding.accountId !== command.arguments.accountId ||
    binding.intentId !== command.arguments.intentId
  ) {
    return invalid(code);
  }
  if (command.operation === 'READ') return;

  if (command.operation === 'PREPARE') {
    const args = command.arguments;
    if (
      binding.networkId !== args.networkId ||
      binding.volatileIntentCommitmentSha256 !== args.volatileIntentCommitmentSha256 ||
      row.yield_operation_id !== args.yieldOperationId ||
      row.yield_submission_id !== args.yieldSubmissionId ||
      row.ledger_transaction_id !== args.ledgerTransactionId ||
      row.ledger_book_id !== args.ledgerBookId ||
      row.wallet_id !== args.walletId ||
      row.provider_id !== args.providerId ||
      row.protocol_id !== args.protocolId ||
      row.market_id !== args.marketId ||
      row.asset_registry_version !== args.assetRegistryVersion ||
      row.asset_registry_fingerprint_sha256 !== args.assetRegistryFingerprintSha256 ||
      row.asset_symbol !== args.assetSymbol ||
      row.asset_identity !== args.assetIdentity ||
      row.asset_decimals !== args.assetDecimals ||
      row.action_type !== args.actionType ||
      row.amount_atomic !== args.amountAtomic ||
      row.requested_value_usd_micros !== args.requestedValueUsdMicros ||
      row.maximum_network_fee_atomic !== args.maximumNetworkFeeAtomic ||
      row.maximum_network_fee_basis_points !== args.maximumNetworkFeeBasisPoints ||
      row.minimum_post_action_native_balance_atomic !== args.minimumPostActionNativeBalanceAtomic ||
      row.allowance_mode !== args.allowanceMode ||
      row.allowance_amount_atomic !== args.allowanceAmountAtomic ||
      row.idempotency_key_digest_sha256 !== args.idempotencyKeyDigestSha256 ||
      row.replay_protection_id !== args.replayProtectionId ||
      binding.expiresAt !== args.expiresAt ||
      (binding.recordOutcome === 'RECORDED' && binding.stage !== 'PREPARED') ||
      (binding.stage === 'PREPARED' && Date.parse(binding.effectiveAt) < Date.parse(args.issuedAt))
    ) {
      return invalid(code);
    }
    return;
  }

  const prior = reviewCursor(cursorMetadata, command.cursor);
  const currentReconciliationReplay = isCurrentReconciliationReplay(command, binding, prior);
  if (
    binding.networkId !== prior.cursor.networkId ||
    binding.intentRecordFingerprintSha256 !== prior.cursor.intentRecordFingerprintSha256 ||
    binding.volatileIntentCommitmentSha256 !== prior.metadata.volatileIntentCommitmentSha256 ||
    !sameAuthoritativeIntentAnchor(
      authoritativeIntentAnchor,
      prior.metadata.authoritativeIntentAnchor,
    ) ||
    (!currentReconciliationReplay &&
      BigInt(binding.lifecycleRevision) < BigInt(prior.cursor.lifecycleRevision) + 1n) ||
    (!currentReconciliationReplay &&
      binding.currentSnapshotSha256 === prior.cursor.currentSnapshotSha256)
  ) {
    return invalid(code);
  }
  const revisionDelta = BigInt(binding.lifecycleRevision) - BigInt(prior.cursor.lifecycleRevision);
  if (
    prior.metadata.lastObservedTransactionPosition !== null &&
    (row.last_observed_transaction_position !== prior.metadata.lastObservedTransactionPosition ||
      row.last_observed_transaction_block_id !== prior.metadata.lastObservedTransactionBlockId ||
      row.last_observed_transaction_block_identity_sha256 !==
        prior.metadata.lastObservedTransactionBlockIdentitySha256)
  ) {
    return invalid(code);
  }
  if (prior.metadata.lastObservedTransactionPosition === null) {
    if (
      revisionDelta === 0n &&
      (row.last_observed_transaction_position !== null ||
        row.last_observed_transaction_block_id !== null ||
        row.last_observed_transaction_block_identity_sha256 !== null)
    ) {
      return invalid(code);
    }
    if (
      revisionDelta === 1n &&
      (row.last_observed_transaction_position !== binding.transactionPosition ||
        row.last_observed_transaction_block_id !== binding.transactionBlockId ||
        row.last_observed_transaction_block_identity_sha256 !==
          row.transaction_block_identity_sha256)
    ) {
      return invalid(code);
    }
  }
  if (Date.parse(binding.effectiveAt) < Date.parse(prior.metadata.effectiveAt)) {
    return invalid(code);
  }
  if (prior.metadata.finalizedPosition !== null) {
    if (binding.finalizedPosition === null) return invalid(code);
    const finalizedComparison =
      BigInt(binding.finalizedPosition) - BigInt(prior.metadata.finalizedPosition);
    if (
      finalizedComparison < 0n ||
      (finalizedComparison === 0n &&
        binding.reconciliationOutcome !== 'REORGED_OUT' &&
        (binding.finalizedBlockId !== prior.metadata.finalizedBlockId ||
          row.finalized_block_identity_sha256 !== prior.metadata.finalizedBlockIdentitySha256))
    ) {
      return invalid(code);
    }
  }

  if (command.operation === 'BIND_SUBMISSION') {
    const args = command.arguments;
    if (
      binding.stage === 'PREPARED' ||
      binding.chainTransactionId !== args.transactionId ||
      binding.submissionFingerprintSha256 === null ||
      (binding.recordOutcome === 'RECORDED' &&
        binding.stage !== 'WALLET_SIGNED_SUBMISSION_BOUND') ||
      (binding.stage === 'WALLET_SIGNED_SUBMISSION_BOUND' &&
        (BigInt(binding.lifecycleRevision) !== BigInt(args.expectedRevision) + 1n ||
          binding.effectiveAt !== args.signedAt))
    ) {
      return invalid(code);
    }
    return;
  }

  if (command.operation === 'BIND_VERIFIED_SUBMISSION') {
    const args = command.arguments;
    if (
      binding.stage === 'PREPARED' ||
      binding.chainTransactionId !== args.transactionId ||
      binding.submissionFingerprintSha256 === null ||
      BigInt(binding.lifecycleRevision) < BigInt(args.expectedRevision) + 1n ||
      (binding.recordOutcome === 'RECORDED' &&
        binding.stage !== 'WALLET_SIGNED_SUBMISSION_BOUND') ||
      (binding.stage === 'WALLET_SIGNED_SUBMISSION_BOUND' &&
        BigInt(binding.lifecycleRevision) !== BigInt(args.expectedRevision) + 1n)
    ) {
      return invalid(code);
    }
    return;
  }

  if (command.operation === 'RECORD_BROADCAST') {
    const args = command.arguments;
    if (
      binding.stage === 'PREPARED' ||
      binding.stage === 'WALLET_SIGNED_SUBMISSION_BOUND' ||
      binding.chainTransactionId !== args.transactionId ||
      binding.submissionFingerprintSha256 !== prior.metadata.submissionFingerprintSha256 ||
      (binding.recordOutcome === 'RECORDED' && binding.stage !== 'BROADCAST_OUTCOME_AMBIGUOUS') ||
      (binding.stage === 'BROADCAST_OUTCOME_AMBIGUOUS' &&
        (BigInt(binding.lifecycleRevision) !== BigInt(args.expectedRevision) + 1n ||
          binding.observationId !== args.observationId ||
          binding.broadcastOutcome !== args.outcome ||
          binding.effectiveAt !== args.observedAt))
    ) {
      return invalid(code);
    }
    return;
  }

  const args = command.arguments;
  const requestedStage = reconciliationStage(args.outcome);
  if (
    binding.stage === 'PREPARED' ||
    binding.stage === 'WALLET_SIGNED_SUBMISSION_BOUND' ||
    binding.stage === 'BROADCAST_OUTCOME_AMBIGUOUS' ||
    binding.chainTransactionId !== args.transactionId ||
    binding.submissionFingerprintSha256 !== prior.metadata.submissionFingerprintSha256 ||
    ((binding.recordOutcome === 'RECORDED' || binding.observationId === args.observationId) &&
      (binding.stage !== requestedStage ||
        (binding.recordOutcome === 'RECORDED' &&
          BigInt(binding.lifecycleRevision) !== BigInt(args.expectedRevision) + 1n) ||
        binding.observationId !== args.observationId ||
        binding.reconciliationOutcome !== args.outcome ||
        binding.transactionPosition !== args.transactionPosition ||
        binding.transactionBlockId !== args.transactionBlockId ||
        binding.finalizedPosition !== args.finalizedPosition ||
        binding.finalizedBlockId !== args.finalizedBlockId ||
        binding.effectiveAt !== args.observedAt))
  ) {
    return invalid(code);
  }
}

function reconciliationStage(
  outcome: DormantMainnetReconciliationDatabaseOutcome,
): ReviewedDatabaseRowBinding['stage'] {
  switch (outcome) {
    case 'PENDING':
    case 'UNKNOWN':
      return 'RECONCILIATION_AMBIGUOUS';
    case 'FINALIZED_SUCCESS':
      return 'FINALIZED_SUCCESS';
    case 'FINALIZED_FAILURE':
      return 'FINALIZED_FAILURE';
    case 'REORGED_OUT':
      return 'REORG_QUARANTINED';
  }
}

function isCurrentReconciliationReplay(
  command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1,
  binding: ReviewedDatabaseRowBinding,
  prior: ReviewedCursor,
): boolean {
  if (command.operation !== 'RECORD_RECONCILIATION') return false;
  const args = command.arguments;
  return (
    binding.recordOutcome === 'REPLAYED' &&
    binding.lifecycleRevision === prior.cursor.lifecycleRevision &&
    binding.currentSnapshotSha256 === prior.cursor.currentSnapshotSha256 &&
    binding.stage === prior.metadata.stage &&
    binding.stage === reconciliationStage(args.outcome) &&
    binding.observationId === args.observationId &&
    binding.observationId === prior.metadata.observationId &&
    binding.reconciliationOutcome === args.outcome &&
    binding.reconciliationOutcome === prior.metadata.reconciliationOutcome &&
    binding.transactionPosition === args.transactionPosition &&
    binding.transactionPosition === prior.metadata.transactionPosition &&
    binding.transactionBlockId === args.transactionBlockId &&
    binding.transactionBlockId === prior.metadata.transactionBlockId &&
    binding.finalizedPosition === args.finalizedPosition &&
    binding.finalizedPosition === prior.metadata.finalizedPosition &&
    binding.finalizedBlockId === args.finalizedBlockId &&
    binding.finalizedBlockId === prior.metadata.finalizedBlockId &&
    binding.effectiveAt === args.observedAt &&
    binding.effectiveAt === prior.metadata.effectiveAt &&
    binding.recordedAt === prior.metadata.recordedAt
  );
}

function reviewCommonRequest(
  record: Record<string, unknown>,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): void {
  if (
    record.durableLifecycleVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION ||
    record.use !== DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE ||
    record.mayAuthorizeFinancialAction !== false
  ) {
    return invalid(code);
  }
}

function cursorArguments(
  cursor: DormantMainnetFinancialActionClmaDatabaseCursorV1,
): Readonly<CursorDatabaseArgumentsV1> {
  return Object.freeze({
    accountId: cursor.accountId,
    intentId: cursor.intentId,
    expectedRevision: cursor.lifecycleRevision,
    expectedSnapshotSha256: cursor.currentSnapshotSha256,
  });
}

function issueCursor(
  cursorMetadata: WeakMap<object, CursorMetadata>,
  value: Omit<
    DormantMainnetFinancialActionClmaDatabaseCursorV1,
    'schemaVersion' | 'source' | 'fingerprintEncoding'
  >,
  metadata: CursorMetadata,
): DormantMainnetFinancialActionClmaDatabaseCursorV1 {
  const cursor = Object.freeze({
    schemaVersion: 1 as const,
    source: 'MIGRATION_0033_DATABASE' as const,
    fingerprintEncoding: MAINNET_FINANCIAL_ACTION_DATABASE_FINGERPRINT_ENCODING,
    ...value,
  });
  cursorMetadata.set(cursor, Object.freeze({ ...metadata }));
  return cursor;
}

function reviewCursor(
  cursorMetadata: WeakMap<object, CursorMetadata>,
  value: unknown,
): ReviewedCursor {
  const code = 'INVALID_CLMA_DATABASE_CURSOR' as const;
  try {
    if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
      return invalid(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid(code);
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== CURSOR_KEYS.length ||
      keys.some(
        (key) => typeof key !== 'string' || !(CURSOR_KEYS as readonly string[]).includes(key),
      )
    ) {
      return invalid(code);
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of CURSOR_KEYS) record[key] = dataProperty(descriptors[key], code, true);
    if (
      record.schemaVersion !== 1 ||
      record.source !== 'MIGRATION_0033_DATABASE' ||
      record.fingerprintEncoding !== MAINNET_FINANCIAL_ACTION_DATABASE_FINGERPRINT_ENCODING
    ) {
      return invalid(code);
    }
    uuid(record.accountId, code);
    uuid(record.intentId, code);
    network(record.networkId, code);
    positiveInt64(record.lifecycleRevision, code);
    digest(record.currentSnapshotSha256, code);
    digest(record.intentRecordFingerprintSha256, code);
    const metadata = cursorMetadata.get(value);
    if (metadata === undefined) return invalid(code);
    return Object.freeze({
      cursor: value as DormantMainnetFinancialActionClmaDatabaseCursorV1,
      metadata,
    });
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionLifecycleDatabaseCodecError) throw error;
    return invalid(code);
  }
}

function reviewAuthoritativeRowIdentity(
  row: Record<string, unknown>,
  networkId: MainnetFinancialActionDatabaseNetworkId,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): AuthoritativeIntentAnchor {
  const identities = [
    row.result_intent_id,
    row.account_id,
    row.yield_operation_id,
    row.yield_submission_id,
    row.ledger_transaction_id,
    row.ledger_book_id,
    row.wallet_id,
    row.replay_protection_id,
  ].map((value) => uuid(value, code));
  if (new Set(identities).size !== identities.length) return invalid(code);
  const providerId = boundedText(row.provider_id, 64, code);
  const protocolId = boundedText(row.protocol_id, 64, code);
  if (!PROVIDER_BINDINGS.has(`${networkId}:${providerId}:${protocolId}`)) return invalid(code);
  const marketId = boundedText(row.market_id, 128, code);
  const assetIdentity = boundedText(row.asset_identity, 128, code);
  const assetSymbol = boundedText(row.asset_symbol, 16, code);
  const registeredAsset = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.identifyAsset(
    networkId,
    assetIdentity,
  );
  const registeredNetwork = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.networks.find(
    (entry) => entry.networkId === networkId,
  );
  if (
    (networkId === ETHEREUM_MAINNET && (!EVM_MARKET.test(marketId) || /^0x0+$/u.test(marketId))) ||
    (networkId !== ETHEREUM_MAINNET && canonicalBase58(marketId, 32) === null) ||
    row.asset_registry_version !== MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version ||
    row.asset_registry_fingerprint_sha256 !==
      MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256 ||
    registeredAsset === undefined ||
    registeredNetwork === undefined ||
    registeredAsset.activationState !== 'ACTIVE' ||
    registeredNetwork.activationState !== 'ACTIVE' ||
    registeredAsset.stablecoin !== assetSymbol ||
    registeredAsset.identity !== assetIdentity ||
    registeredAsset.decimals !== row.asset_decimals ||
    (row.action_type !== 'SUPPLY' && row.action_type !== 'WITHDRAW') ||
    row.allowance_mode !== 'EXACT' ||
    !Number.isSafeInteger(row.maximum_network_fee_basis_points) ||
    (row.maximum_network_fee_basis_points as number) < 0 ||
    (row.maximum_network_fee_basis_points as number) > 10_000 ||
    typeof row.wallet_identity_digest_version !== 'number' ||
    !Number.isSafeInteger(row.wallet_identity_digest_version) ||
    row.wallet_identity_digest_version < 1
  ) {
    return invalid(code);
  }
  const walletIdentityDigestHex = digest(row.wallet_identity_digest_hex, code);
  const idempotencyKeyDigestSha256 = digest(row.idempotency_key_digest_sha256, code);
  const amountAtomic = unsignedInteger(row.amount_atomic, code);
  const requestedValueUsdMicros = unsignedInteger(row.requested_value_usd_micros, code);
  const maximumNetworkFeeAtomic = unsignedInteger(row.maximum_network_fee_atomic, code);
  const minimumReserve = unsignedInteger(row.minimum_post_action_native_balance_atomic, code);
  const allowanceAmount = unsignedInteger(row.allowance_amount_atomic, code);
  if (
    amountAtomic === '0' ||
    requestedValueUsdMicros === '0' ||
    minimumReserve === '0' ||
    (row.action_type === 'SUPPLY' && allowanceAmount !== amountAtomic) ||
    (row.action_type === 'WITHDRAW' && allowanceAmount !== '0')
  ) {
    return invalid(code);
  }
  const expectedWalletNamespace = networkId === ETHEREUM_MAINNET ? 'eip155' : 'solana';
  const expectedWalletReference =
    networkId === ETHEREUM_MAINNET ? '1' : '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  if (
    row.wallet_chain_namespace !== expectedWalletNamespace ||
    row.wallet_chain_reference !== expectedWalletReference
  ) {
    return invalid(code);
  }
  return Object.freeze({
    yieldOperationId: identities[2]!,
    yieldSubmissionId: identities[3]!,
    ledgerTransactionId: identities[4]!,
    ledgerBookId: identities[5]!,
    walletId: identities[6]!,
    walletChainNamespace: expectedWalletNamespace,
    walletChainReference: expectedWalletReference,
    walletIdentityDigestVersion: row.wallet_identity_digest_version as number,
    walletIdentityDigestHex,
    providerId,
    protocolId,
    marketId,
    assetRegistryVersion: row.asset_registry_version as number,
    assetRegistryFingerprintSha256: row.asset_registry_fingerprint_sha256 as string,
    assetSymbol: assetSymbol as SupportedStablecoin,
    assetIdentity,
    assetDecimals: row.asset_decimals as number,
    actionType: row.action_type as 'SUPPLY' | 'WITHDRAW',
    amountAtomic,
    requestedValueUsdMicros,
    maximumNetworkFeeAtomic,
    maximumNetworkFeeBasisPoints: row.maximum_network_fee_basis_points as number,
    minimumPostActionNativeBalanceAtomic: minimumReserve,
    allowanceMode: 'EXACT' as const,
    allowanceAmountAtomic: allowanceAmount,
    idempotencyKeyDigestSha256,
    replayProtectionId: identities[7]!,
    expiresAt: timestamp(row.expires_at, code),
  });
}

function sameAuthoritativeIntentAnchor(
  left: AuthoritativeIntentAnchor,
  right: AuthoritativeIntentAnchor,
): boolean {
  const keys = Object.freeze([
    'yieldOperationId',
    'yieldSubmissionId',
    'ledgerTransactionId',
    'ledgerBookId',
    'walletId',
    'walletChainNamespace',
    'walletChainReference',
    'walletIdentityDigestVersion',
    'walletIdentityDigestHex',
    'providerId',
    'protocolId',
    'marketId',
    'assetRegistryVersion',
    'assetRegistryFingerprintSha256',
    'assetSymbol',
    'assetIdentity',
    'assetDecimals',
    'actionType',
    'amountAtomic',
    'requestedValueUsdMicros',
    'maximumNetworkFeeAtomic',
    'maximumNetworkFeeBasisPoints',
    'minimumPostActionNativeBalanceAtomic',
    'allowanceMode',
    'allowanceAmountAtomic',
    'idempotencyKeyDigestSha256',
    'replayProtectionId',
    'expiresAt',
  ] as const satisfies readonly (keyof AuthoritativeIntentAnchor)[]);
  return keys.every((key) => left[key] === right[key]);
}

function reviewStageShape(
  stage: (typeof STAGES)[number],
  transactionId: string | null,
  submissionFingerprint: string | null,
  observationId: string | null,
  broadcastOutcome: DormantMainnetWalletBroadcastDatabaseOutcome | null,
  reconciliationOutcome: DormantMainnetReconciliationDatabaseOutcome | null,
  transactionPosition: string | null,
  transactionBlockId: string | null,
  finalizedPosition: string | null,
  finalizedBlockId: string | null,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): void {
  const hasSubmission = transactionId !== null && submissionFingerprint !== null;
  if (stage === 'PREPARED') {
    if (
      transactionId !== null ||
      submissionFingerprint !== null ||
      observationId !== null ||
      broadcastOutcome !== null ||
      reconciliationOutcome !== null ||
      transactionPosition !== null ||
      transactionBlockId !== null ||
      finalizedPosition !== null ||
      finalizedBlockId !== null
    ) {
      return invalid(code);
    }
    return;
  }
  if (!hasSubmission) return invalid(code);
  if (stage === 'WALLET_SIGNED_SUBMISSION_BOUND') {
    if (
      observationId !== null ||
      broadcastOutcome !== null ||
      reconciliationOutcome !== null ||
      transactionPosition !== null ||
      transactionBlockId !== null ||
      finalizedPosition !== null ||
      finalizedBlockId !== null
    ) {
      return invalid(code);
    }
    return;
  }
  if (stage === 'BROADCAST_OUTCOME_AMBIGUOUS') {
    if (
      observationId === null ||
      broadcastOutcome === null ||
      reconciliationOutcome !== null ||
      transactionPosition !== null ||
      transactionBlockId !== null ||
      finalizedPosition !== null ||
      finalizedBlockId !== null
    ) {
      return invalid(code);
    }
    return;
  }
  if (
    observationId === null ||
    broadcastOutcome !== null ||
    reconciliationOutcome === null ||
    finalizedPosition === null ||
    finalizedBlockId === null ||
    (transactionPosition === null) !== (transactionBlockId === null)
  ) {
    return invalid(code);
  }
  if (
    (stage === 'RECONCILIATION_AMBIGUOUS' &&
      reconciliationOutcome !== 'PENDING' &&
      reconciliationOutcome !== 'UNKNOWN') ||
    (stage === 'FINALIZED_SUCCESS' && reconciliationOutcome !== 'FINALIZED_SUCCESS') ||
    (stage === 'FINALIZED_FAILURE' && reconciliationOutcome !== 'FINALIZED_FAILURE') ||
    (stage === 'REORG_QUARANTINED' && reconciliationOutcome !== 'REORGED_OUT') ||
    (reconciliationOutcome === 'UNKNOWN' && transactionPosition !== null) ||
    (reconciliationOutcome !== 'UNKNOWN' &&
      reconciliationOutcome !== 'PENDING' &&
      transactionPosition === null) ||
    (reconciliationOutcome === 'PENDING' &&
      transactionPosition !== null &&
      BigInt(finalizedPosition) >= BigInt(transactionPosition)) ||
    ((reconciliationOutcome === 'FINALIZED_SUCCESS' ||
      reconciliationOutcome === 'FINALIZED_FAILURE' ||
      reconciliationOutcome === 'REORGED_OUT') &&
      transactionPosition !== null &&
      BigInt(finalizedPosition) < BigInt(transactionPosition))
  ) {
    return invalid(code);
  }
}

function assertReconciliationShape(
  outcome: DormantMainnetReconciliationDatabaseOutcome,
  transactionPosition: string | null,
  finalizedPosition: string,
  effectEvidenceSha256: string | null,
  failureEvidenceSha256: string | null,
  sourceEvidenceSha256: string,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): void {
  const transaction = transactionPosition === null ? null : BigInt(transactionPosition);
  const finalized = BigInt(finalizedPosition);
  if (
    (outcome === 'UNKNOWN' && transaction !== null) ||
    (outcome !== 'UNKNOWN' && outcome !== 'PENDING' && transaction === null) ||
    (outcome === 'PENDING' && transaction !== null && finalized >= transaction) ||
    ((outcome === 'FINALIZED_SUCCESS' ||
      outcome === 'FINALIZED_FAILURE' ||
      outcome === 'REORGED_OUT') &&
      transaction !== null &&
      finalized < transaction) ||
    (outcome === 'FINALIZED_SUCCESS' &&
      (effectEvidenceSha256 === null || failureEvidenceSha256 !== null)) ||
    (outcome === 'FINALIZED_FAILURE' &&
      (failureEvidenceSha256 === null || effectEvidenceSha256 !== null)) ||
    ((outcome === 'PENDING' || outcome === 'UNKNOWN' || outcome === 'REORGED_OUT') &&
      (effectEvidenceSha256 !== null || failureEvidenceSha256 !== null)) ||
    sourceEvidenceSha256 === effectEvidenceSha256 ||
    sourceEvidenceSha256 === failureEvidenceSha256
  ) {
    return invalid(code);
  }
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
      return invalid(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return invalid(code);
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) record[key] = dataProperty(descriptors[key], code, true);
    return record;
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionLifecycleDatabaseCodecError) throw error;
    return invalid(code);
  }
}

function exactFrozenRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      Array.isArray(value) ||
      !Object.isFrozen(value)
    ) {
      return invalid(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid(code);
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return invalid(code);
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.configurable ||
        !('value' in descriptor) ||
        descriptor.writable
      ) {
        return invalid(code);
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionLifecycleDatabaseCodecError) throw error;
    return invalid(code);
  }
}

function dataProperty(
  descriptor: PropertyDescriptor | undefined,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
  enumerable: boolean,
): unknown {
  if (!descriptor || descriptor.enumerable !== enumerable || !('value' in descriptor)) {
    return invalid(code);
  }
  return descriptor.value;
}

function activeAbortSignal(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): AbortSignal {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      !(value instanceof AbortSignal) ||
      ABORTED_GETTER === undefined ||
      ABORTED_GETTER.call(value) !== false
    ) {
      return invalid(code);
    }
    return value;
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionLifecycleDatabaseCodecError) throw error;
    return invalid(code);
  }
}

function activeNativeAbortSignal(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): AbortSignal {
  const signal = activeAbortSignal(value, code);
  try {
    if (Object.getPrototypeOf(signal) !== AbortSignal.prototype) return invalid(code);
    return signal;
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionLifecycleDatabaseCodecError) throw error;
    return invalid(code);
  }
}

function uuid(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string {
  if (typeof value !== 'string' || !UUID.test(value)) return invalid(code);
  return value;
}

function nullableUuid(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string | null {
  return value === null ? null : uuid(value, code);
}

function digest(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string {
  if (typeof value !== 'string' || !SHA256.test(value) || /^0{64}$/u.test(value)) {
    return invalid(code);
  }
  return value;
}

function nullableDigest(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string | null {
  return value === null ? null : digest(value, code);
}

function network(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): MainnetFinancialActionDatabaseNetworkId {
  if (value !== ETHEREUM_MAINNET && value !== 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') {
    return invalid(code);
  }
  return value;
}

function positiveInt64(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string {
  if (typeof value !== 'string' || !UINT64.test(value)) return invalid(code);
  const parsed = BigInt(value);
  if (parsed < 1n || parsed > MAX_INT64) return invalid(code);
  return value;
}

function uint64(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string {
  if (typeof value !== 'string' || !UINT64.test(value) || BigInt(value) > MAX_UINT64) {
    return invalid(code);
  }
  return value;
}

function nullableUint64(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string | null {
  return value === null ? null : uint64(value, code);
}

function unsignedInteger(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value) || BigInt(value) > MAX_UINT256) {
    return invalid(code);
  }
  return value;
}

function boundedText(
  value: unknown,
  maximumLength: number,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    value.trim() !== value
  ) {
    return invalid(code);
  }
  return value;
}

function timestamp(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string {
  let text: string;
  try {
    if (typeof value === 'string') {
      text = value;
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !isProxy(value) &&
      value instanceof Date &&
      Object.getPrototypeOf(value) === Date.prototype
    ) {
      text = Date.prototype.toISOString.call(value) as string;
    } else {
      return invalid(code);
    }
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionLifecycleDatabaseCodecError) throw error;
    return invalid(code);
  }
  const milliseconds = Date.parse(text);
  if (
    !TIMESTAMP.test(text) ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== text
  ) {
    return invalid(code);
  }
  return text;
}

function boolean(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): boolean {
  if (typeof value !== 'boolean') return invalid(code);
  return value;
}

function nullableMember<const Value extends string>(
  value: unknown,
  members: readonly Value[],
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): Value | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !members.includes(value as Value)) return invalid(code);
  return value as Value;
}

function chainIdentity(
  networkId: MainnetFinancialActionDatabaseNetworkId,
  value: unknown,
  kind: 'TRANSACTION' | 'BLOCK',
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string {
  if (networkId === ETHEREUM_MAINNET) {
    if (typeof value !== 'string' || !EVM_HASH.test(value) || /^0x0{64}$/u.test(value)) {
      return invalid(code);
    }
    return value;
  }
  if (typeof value !== 'string') return invalid(code);
  const expectedBytes = kind === 'TRANSACTION' ? 64 : 32;
  if (canonicalBase58(value, expectedBytes) === null) return invalid(code);
  return value;
}

function nullableChainIdentity(
  networkId: MainnetFinancialActionDatabaseNetworkId,
  value: unknown,
  kind: 'TRANSACTION' | 'BLOCK',
  code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode,
): string | null {
  return value === null ? null : chainIdentity(networkId, value, kind, code);
}

function canonicalBase58(value: string, expectedBytes: number): string | null {
  if (!BASE58.test(value) || value.length > 90) return null;
  const bytes = [0];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    if (carry < 0) return null;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += (bytes[index] ?? 0) * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  while (value[zeros] === '1') zeros += 1;
  const significant = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  const decoded = new Uint8Array(zeros + significant);
  for (let index = 0; index < significant; index += 1) {
    decoded[decoded.length - index - 1] = bytes[index] ?? 0;
  }
  if (decoded.length !== expectedBytes || decoded.every((byte) => byte === 0)) return null;
  const digits = [0];
  for (const byte of decoded) {
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
  let leadingZeros = 0;
  while (decoded[leadingZeros] === 0) leadingZeros += 1;
  const significantDigits = digits.length === 1 && digits[0] === 0 ? [] : digits;
  const encoded =
    '1'.repeat(leadingZeros) +
    significantDigits
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit] ?? '')
      .join('');
  return encoded === value ? value : null;
}

function invalid(code: DormantMainnetFinancialActionLifecycleDatabaseCodecErrorCode): never {
  throw new DormantMainnetFinancialActionLifecycleDatabaseCodecError(code);
}

type QueryWithCancellation = PostgresService['queryWithCancellation'];
type DatabaseMethod =
  | 'prepare'
  | 'bindSubmission'
  | 'bindVerifiedSubmission'
  | 'recordBroadcast'
  | 'recordReconciliation'
  | 'read';

export interface DormantMainnetFinancialActionLifecycleClock {
  now(): unknown;
}

interface CapturedMethod<Method extends (...arguments_: never[]) => unknown> {
  readonly receiver: object;
  readonly method: Method;
}

interface IssuedResult {
  readonly method: DatabaseMethod;
  readonly request: DormantMainnetFinancialActionDurableRequestV1;
  readonly signal: AbortSignal;
  readonly result: DormantMainnetFinancialActionDurableResultV1;
}

interface CapturedSignedSubmissionVerifier {
  readonly receiver: object;
  readonly verifierVersion: typeof DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION;
  readonly verify: DormantMainnetFinancialActionSignedSubmissionVerifierPort['verifySubmission'];
  readonly review: DormantMainnetFinancialActionSignedSubmissionVerifierPort['reviewResult'];
}

interface IssuedVerifiedBindResult {
  readonly capability: DormantMainnetVerifiedSubmissionBindCapabilityV1;
  readonly request: WeakRef<BindDormantMainnetVerifiedSubmissionRequestV1>;
  readonly requestBindingSha256: string;
  readonly signal: AbortSignal;
  readonly result: DormantMainnetFinancialActionDurableResultV1;
}

const RESULT_PROJECTION = `
  result.record_outcome,
  result.result_intent_id,
  result.lifecycle_stage,
  result.lifecycle_revision::text AS lifecycle_revision,
  result.current_snapshot_sha256,
  result.intent_record_fingerprint_sha256,
  result.volatile_intent_commitment_sha256,
  result.fingerprint_encoding_version,
  result.account_id,
  result.yield_operation_id,
  result.yield_submission_id,
  result.ledger_transaction_id,
  result.ledger_book_id,
  result.wallet_id,
  result.wallet_chain_namespace,
  result.wallet_chain_reference,
  result.wallet_identity_digest_version,
  result.wallet_identity_digest_hex,
  result.network_id,
  result.provider_id,
  result.protocol_id,
  result.market_id,
  result.asset_registry_version,
  result.asset_registry_fingerprint_sha256,
  result.asset_symbol,
  result.asset_identity,
  result.asset_decimals,
  result.action_type,
  result.amount_atomic::text AS amount_atomic,
  result.requested_value_usd_micros::text AS requested_value_usd_micros,
  result.maximum_network_fee_atomic::text AS maximum_network_fee_atomic,
  result.maximum_network_fee_basis_points,
  result.minimum_post_action_native_balance_atomic::text AS minimum_post_action_native_balance_atomic,
  result.allowance_mode,
  result.allowance_amount_atomic::text AS allowance_amount_atomic,
  result.idempotency_key_digest_sha256,
  result.replay_protection_id,
  result.chain_transaction_id,
  result.submission_fingerprint_sha256,
  result.observation_id,
  result.broadcast_outcome,
  result.reconciliation_outcome,
  result.transaction_position::text AS transaction_position,
  result.transaction_block_id,
  result.transaction_block_identity_sha256,
  result.finalized_position::text AS finalized_position,
  result.finalized_block_id,
  result.finalized_block_identity_sha256,
  result.last_observed_transaction_position::text AS last_observed_transaction_position,
  result.last_observed_transaction_block_id,
  result.last_observed_transaction_block_identity_sha256,
  to_char(result.effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_at,
  to_char(result.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
  result.terminal,
  result.requires_manual_reconciliation,
  result.database_replay_protection_enforced,
  result.ledger_settlement_authority,
  to_char(result.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at
`;

const PREPARE_SQL = `SELECT ${RESULT_PROJECTION}
FROM prepare_mainnet_financial_action_lifecycle_v2(
  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid,
  $8::text, $9::text, $10::uuid, $11::text, $12::text, $13::text, $14::text,
  $15::integer, $16::text, $17::text, $18::text, $19::smallint, $20::text,
  $21::text, $22::text, $23::text, $24::integer, $25::text, $26::text, $27::text,
  $28::timestamptz, $29::timestamptz, $30::uuid,
  $31::smallint[], $32::text[]
) AS result`;

const BIND_SUBMISSION_SQL = `SELECT ${RESULT_PROJECTION}
FROM bind_mainnet_financial_action_submission(
  $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text, $7::text,
  $8::timestamptz, $9::uuid
) AS result`;

const BIND_VERIFIED_SUBMISSION_SQL = `SELECT ${RESULT_PROJECTION}
FROM bind_verified_mainnet_financial_action_submission_v2(
  $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text, $7::text,
  $8::uuid, $9::smallint, $10::text, $11::text, $12::text, $13::text,
  $14::text, $15::text, $16::numeric, $17::text
) AS result`;

const RECORD_BROADCAST_SQL = `SELECT ${RESULT_PROJECTION}
FROM record_mainnet_financial_action_broadcast_observation(
  $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid, $6::text, $7::text,
  $8::text, $9::timestamptz, $10::uuid
) AS result`;

const RECORD_RECONCILIATION_SQL = `SELECT ${RESULT_PROJECTION}
FROM record_mainnet_financial_action_reconciliation_observation(
  $1::uuid, $2::uuid, $3::bigint, $4::text, $5::uuid, $6::text, $7::text,
  $8::numeric, $9::text, $10::numeric, $11::text, $12::text, $13::text,
  $14::text, $15::timestamptz, $16::uuid
) AS result`;

const READ_SQL = `SELECT ${RESULT_PROJECTION}
FROM read_mainnet_financial_action_lifecycle($1::uuid, $2::uuid) AS result`;

/**
 * Direct-import-only migration-0034 adapter. It is intentionally undecorated
 * and unregistered, owns no signer/broadcaster, and performs one database call
 * per invocation with no loop or automatic retry.
 */
export class PostgresDormantMainnetFinancialActionLifecycleDurableAdapter
  implements
    DormantMainnetFinancialActionLifecycleDurablePort,
    DormantMainnetFinancialActionVerifiedSubmissionBinderPort
{
  readonly durableLifecycleVersion = DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION;
  readonly verifiedSubmissionBinderVersion = DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION;

  readonly #databaseReceiver: object;
  readonly #databaseQuery: QueryWithCancellation;
  readonly #clockReceiver: object;
  readonly #clockNow: DormantMainnetFinancialActionLifecycleClock['now'];
  readonly #codec: DormantMainnetFinancialActionLifecycleDatabaseCodec;
  readonly #issuedResults = new WeakMap<object, IssuedResult>();
  readonly #requestMethods = new WeakMap<object, DatabaseMethod>();
  readonly #signedSubmissionVerifier: CapturedSignedSubmissionVerifier | null;
  readonly #startedVerifiedBindRequests = new WeakSet<object>();
  readonly #issuedVerifiedBindResults = new WeakMap<object, IssuedVerifiedBindResult>();

  constructor(
    postgres: PostgresService,
    clock: DormantMainnetFinancialActionLifecycleClock,
    walletIdentityKeyRing: WalletRegistrationKeyRing<'identity-hmac'>,
    signedSubmissionVerifier?: DormantMainnetFinancialActionSignedSubmissionVerifierPort,
  ) {
    const database = captureMethod<QueryWithCancellation>(postgres, 'queryWithCancellation');
    const capturedClock = captureMethod<DormantMainnetFinancialActionLifecycleClock['now']>(
      clock,
      'now',
    );
    this.#databaseReceiver = database.receiver;
    this.#databaseQuery = database.method;
    this.#clockReceiver = capturedClock.receiver;
    this.#clockNow = capturedClock.method;
    this.#codec = new DormantMainnetFinancialActionLifecycleDatabaseCodec(
      captureWalletIdentityKeyRing(walletIdentityKeyRing),
    );
    this.#signedSubmissionVerifier =
      signedSubmissionVerifier === undefined
        ? null
        : captureSignedSubmissionVerifier(signedSubmissionVerifier);
  }

  async prepare(request: PrepareDormantMainnetFinancialActionDurableRequestV1): Promise<unknown> {
    const now = Reflect.apply(this.#clockNow, this.#clockReceiver, []) as unknown;
    return this.#execute('prepare', request, this.#codec.encodePrepare(request, now));
  }

  async bindSubmission(
    request: BindDormantMainnetFinancialActionSubmissionRequestV1,
  ): Promise<unknown> {
    return this.#execute('bindSubmission', request, this.#codec.encodeBindSubmission(request));
  }

  bindVerifiedSubmission(request: BindDormantMainnetVerifiedSubmissionRequestV1): Promise<unknown> {
    try {
      const verifier = this.#signedSubmissionVerifier;
      if (
        verifier === null ||
        typeof request !== 'object' ||
        request === null ||
        isProxy(request) ||
        this.#startedVerifiedBindRequests.has(request)
      ) {
        return invalid('INVALID_VERIFIED_BIND_SUBMISSION_REQUEST');
      }
      this.#startedVerifiedBindRequests.add(request);
      const command = this.#codec.encodeVerifiedBindSubmission(
        request,
        () => Reflect.apply(this.#clockNow, this.#clockReceiver, []) as unknown,
        (capability, verificationRequest) =>
          Reflect.apply(verifier.review, verifier.receiver, [
            capability,
            verificationRequest,
          ]) as DormantMainnetSignedSubmissionVerificationResultV1 | null,
      );
      return this.#executeVerifiedBind(new WeakRef(request), command);
    } catch (error) {
      return Promise.reject(
        error instanceof DormantMainnetFinancialActionLifecycleDatabaseCodecError
          ? error
          : new DormantMainnetFinancialActionLifecycleDatabaseCodecError(
              'INVALID_VERIFIED_BIND_SUBMISSION_REQUEST',
            ),
      );
    }
  }

  async recordBroadcast(
    request: RecordDormantMainnetFinancialActionBroadcastRequestV1,
  ): Promise<unknown> {
    return this.#execute('recordBroadcast', request, this.#codec.encodeBroadcast(request));
  }

  async recordReconciliation(
    request: RecordDormantMainnetFinancialActionReconciliationRequestV1,
  ): Promise<unknown> {
    return this.#execute(
      'recordReconciliation',
      request,
      this.#codec.encodeReconciliation(request),
    );
  }

  async read(request: ReadDormantMainnetFinancialActionDurableRequestV1): Promise<unknown> {
    return this.#execute('read', request, this.#codec.encodeRead(request));
  }

  reviewResult(
    capability: unknown,
    request: DormantMainnetFinancialActionDurableRequestV1,
  ): DormantMainnetFinancialActionDurableResultV1 | null {
    try {
      if (
        typeof capability !== 'object' ||
        capability === null ||
        isProxy(capability) ||
        typeof request !== 'object' ||
        request === null ||
        isProxy(request)
      ) {
        return null;
      }
      const issued = this.#issuedResults.get(capability);
      const requestSignal = Object.getOwnPropertyDescriptor(request, 'signal');
      if (
        issued === undefined ||
        issued.result !== capability ||
        issued.request !== request ||
        requestSignal === undefined ||
        !requestSignal.enumerable ||
        !('value' in requestSignal) ||
        requestSignal.value !== issued.signal ||
        this.#requestMethods.get(request) !== issued.method
      ) {
        return null;
      }
      return issued.result;
    } catch {
      return null;
    }
  }

  reviewVerifiedSubmissionBindResult(
    capability: unknown,
    request: BindDormantMainnetVerifiedSubmissionRequestV1,
  ): DormantMainnetFinancialActionDurableResultV1 | null {
    try {
      if (
        typeof capability !== 'object' ||
        capability === null ||
        isProxy(capability) ||
        typeof request !== 'object' ||
        request === null ||
        isProxy(request)
      ) {
        return null;
      }
      const capabilityRecord = exactFrozenRecord(
        capability,
        VERIFIED_BIND_CAPABILITY_KEYS,
        'INVALID_VERIFIED_BIND_SUBMISSION_REQUEST',
      );
      if (
        capabilityRecord.verifiedSubmissionBinderVersion !==
          DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION ||
        capabilityRecord.use !== DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_CAPABILITY_USE ||
        capabilityRecord.mayAuthorizeFinancialAction !== false ||
        capabilityRecord.mayPersist !== false ||
        capabilityRecord.apiMaySign !== false ||
        capabilityRecord.apiMayBroadcast !== false ||
        capabilityRecord.mayResendTransaction !== false ||
        capabilityRecord.automaticRetryAllowed !== false
      ) {
        return null;
      }
      const issued = this.#issuedVerifiedBindResults.get(capability);
      if (issued === undefined) return null;
      this.#issuedVerifiedBindResults.delete(capability);
      const requestRecord = exactFrozenRecord(
        request,
        VERIFIED_BIND_KEYS,
        'INVALID_VERIFIED_BIND_SUBMISSION_REQUEST',
      );
      if (
        issued.capability !== capability ||
        issued.request.deref() !== request ||
        requestRecord.signal !== issued.signal ||
        verifiedBindRequestSha256(request) !== issued.requestBindingSha256
      ) {
        return null;
      }
      return issued.result;
    } catch {
      return null;
    }
  }

  async #executeVerifiedBind(
    request: WeakRef<BindDormantMainnetVerifiedSubmissionRequestV1>,
    command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
      readonly operation: 'BIND_VERIFIED_SUBMISSION';
    },
  ): Promise<unknown> {
    const invocation = databaseInvocation(command);
    let pending: unknown;
    try {
      pending = Reflect.apply(this.#databaseQuery, this.#databaseReceiver, [
        invocation.sql,
        invocation.values,
        command.signal,
      ]);
    } catch {
      return this.#issueVerifiedBind(request, command, this.#codec.databaseOutcomeUnknown(command));
    }

    let result: DormantMainnetFinancialActionDurableResultV1;
    try {
      const reviewedPending = nativePromise(pending);
      if (reviewedPending === null) throw new Error('DATABASE_OUTCOME_UNKNOWN');
      const queryResult = (await reviewedPending) as unknown;
      if (isAborted(command.signal)) throw new Error('DATABASE_OUTCOME_UNKNOWN');
      result = this.#codec.decode(command, singleRow(queryResult));
    } catch {
      result = this.#codec.databaseOutcomeUnknown(command);
    }
    return this.#issueVerifiedBind(request, command, result);
  }

  #issueVerifiedBind(
    request: WeakRef<BindDormantMainnetVerifiedSubmissionRequestV1>,
    command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1 & {
      readonly operation: 'BIND_VERIFIED_SUBMISSION';
    },
    result: DormantMainnetFinancialActionDurableResultV1,
  ): DormantMainnetVerifiedSubmissionBindCapabilityV1 {
    const capability = Object.freeze(
      Object.assign(Object.create(null) as object, {
        verifiedSubmissionBinderVersion: DORMANT_MAINNET_VERIFIED_SUBMISSION_BINDER_VERSION,
        use: DORMANT_MAINNET_VERIFIED_SUBMISSION_BIND_CAPABILITY_USE,
        mayAuthorizeFinancialAction: false as const,
        mayPersist: false as const,
        apiMaySign: false as const,
        apiMayBroadcast: false as const,
        mayResendTransaction: false as const,
        automaticRetryAllowed: false as const,
      }),
    ) as DormantMainnetVerifiedSubmissionBindCapabilityV1;
    this.#issuedVerifiedBindResults.set(
      capability,
      Object.freeze({
        capability,
        request,
        requestBindingSha256: command.requestBindingSha256,
        signal: command.signal,
        result,
      }),
    );
    return capability;
  }

  async #execute(
    method: DatabaseMethod,
    request: DormantMainnetFinancialActionDurableRequestV1,
    command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1,
  ): Promise<unknown> {
    const invocation = databaseInvocation(command);
    this.#requestMethods.set(request, method);

    let pending: unknown;
    try {
      pending = Reflect.apply(this.#databaseQuery, this.#databaseReceiver, [
        invocation.sql,
        invocation.values,
        command.signal,
      ]);
    } catch {
      return this.#issue(
        method,
        request,
        command.signal,
        this.#codec.databaseOutcomeUnknown(command),
      );
    }

    try {
      const reviewedPending = nativePromise(pending);
      if (reviewedPending === null) throw new Error('DATABASE_OUTCOME_UNKNOWN');
      const queryResult = (await reviewedPending) as unknown;
      if (isAborted(command.signal)) throw new Error('DATABASE_OUTCOME_UNKNOWN');
      const result = this.#codec.decode(command, singleRow(queryResult));
      return this.#issue(method, request, command.signal, result);
    } catch {
      return this.#issue(
        method,
        request,
        command.signal,
        this.#codec.databaseOutcomeUnknown(command),
      );
    }
  }

  #issue(
    method: DatabaseMethod,
    request: DormantMainnetFinancialActionDurableRequestV1,
    signal: AbortSignal,
    result: DormantMainnetFinancialActionDurableResultV1,
  ): DormantMainnetFinancialActionDurableResultV1 {
    this.#issuedResults.set(result, Object.freeze({ method, request, signal, result }));
    return result;
  }
}

function nativePromise(value: unknown): Promise<unknown> | null {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      !(value instanceof Promise) ||
      Object.getPrototypeOf(value) !== Promise.prototype
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function databaseInvocation(
  command: DormantMainnetFinancialActionLifecycleDatabaseCommandV1,
): Readonly<{ readonly sql: string; readonly values: readonly unknown[] }> {
  switch (command.operation) {
    case 'PREPARE': {
      const args = command.arguments;
      return Object.freeze({
        sql: PREPARE_SQL,
        values: Object.freeze([
          args.intentId,
          args.accountId,
          args.yieldOperationId,
          args.yieldSubmissionId,
          args.ledgerTransactionId,
          args.ledgerBookId,
          args.walletId,
          args.volatileIntentCommitmentSha256,
          args.idempotencyKeyDigestSha256,
          args.replayProtectionId,
          args.networkId,
          args.providerId,
          args.protocolId,
          args.marketId,
          args.assetRegistryVersion,
          args.assetRegistryFingerprintSha256,
          args.assetSymbol,
          args.assetIdentity,
          args.assetDecimals,
          args.actionType,
          args.amountAtomic,
          args.requestedValueUsdMicros,
          args.maximumNetworkFeeAtomic,
          args.maximumNetworkFeeBasisPoints,
          args.minimumPostActionNativeBalanceAtomic,
          args.allowanceMode,
          args.allowanceAmountAtomic,
          args.issuedAt,
          args.expiresAt,
          args.correlationId,
          Object.freeze(args.walletIdentityDigestCandidates.map((candidate) => candidate.version)),
          Object.freeze(args.walletIdentityDigestCandidates.map((candidate) => candidate.value)),
        ]),
      });
    }
    case 'BIND_SUBMISSION': {
      const args = command.arguments;
      return Object.freeze({
        sql: BIND_SUBMISSION_SQL,
        values: Object.freeze([
          args.accountId,
          args.intentId,
          args.expectedRevision,
          args.expectedSnapshotSha256,
          args.transactionId,
          args.walletSignedPayloadSha256,
          args.walletSignatureEvidenceSha256,
          args.signedAt,
          args.correlationId,
        ]),
      });
    }
    case 'BIND_VERIFIED_SUBMISSION': {
      const args = command.arguments;
      return Object.freeze({
        sql: BIND_VERIFIED_SUBMISSION_SQL,
        values: Object.freeze([
          args.accountId,
          args.intentId,
          args.expectedRevision,
          args.expectedSnapshotSha256,
          args.transactionId,
          args.signingPayloadSha256,
          args.signatureEvidenceSha256,
          args.correlationId,
          args.verifierVersion,
          args.verificationIntentFingerprintSha256,
          args.signedEnvelopeSha256,
          args.providerWriteManifestFingerprintSha256,
          args.providerActionBindingSha256,
          args.chainReplayIdentitySha256,
          args.signatureScheme,
          args.ethereumNonce,
          args.solanaRecentBlockhash,
        ]),
      });
    }
    case 'RECORD_BROADCAST': {
      const args = command.arguments;
      return Object.freeze({
        sql: RECORD_BROADCAST_SQL,
        values: Object.freeze([
          args.accountId,
          args.intentId,
          args.expectedRevision,
          args.expectedSnapshotSha256,
          args.observationId,
          args.transactionId,
          args.outcome,
          args.evidenceSha256,
          args.observedAt,
          args.correlationId,
        ]),
      });
    }
    case 'RECORD_RECONCILIATION': {
      const args = command.arguments;
      return Object.freeze({
        sql: RECORD_RECONCILIATION_SQL,
        values: Object.freeze([
          args.accountId,
          args.intentId,
          args.expectedRevision,
          args.expectedSnapshotSha256,
          args.observationId,
          args.transactionId,
          args.outcome,
          args.transactionPosition,
          args.transactionBlockId,
          args.finalizedPosition,
          args.finalizedBlockId,
          args.effectEvidenceSha256,
          args.failureEvidenceSha256,
          args.sourceEvidenceSha256,
          args.observedAt,
          args.correlationId,
        ]),
      });
    }
    case 'READ': {
      const args = command.arguments;
      return Object.freeze({
        sql: READ_SQL,
        values: Object.freeze([args.accountId, args.intentId]),
      });
    }
  }
}

function captureMethod<Method extends (...arguments_: never[]) => unknown>(
  value: unknown,
  methodName: string,
): CapturedMethod<Method> {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      throw new TypeError('Invalid dormant lifecycle dependency.');
    }
    let current: object | null = value;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (isProxy(current)) throw new TypeError('Invalid dormant lifecycle dependency.');
      const descriptor = Object.getOwnPropertyDescriptor(current, methodName);
      if (descriptor !== undefined) {
        if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
          throw new TypeError('Invalid dormant lifecycle dependency.');
        }
        if (isProxy(descriptor.value)) {
          throw new TypeError('Invalid dormant lifecycle dependency.');
        }
        return Object.freeze({ receiver: value, method: descriptor.value as Method });
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Invalid dormant lifecycle dependency.') {
      throw error;
    }
  }
  throw new TypeError('Invalid dormant lifecycle dependency.');
}

function captureSignedSubmissionVerifier(
  value: DormantMainnetFinancialActionSignedSubmissionVerifierPort,
): CapturedSignedSubmissionVerifier {
  const failure = (): never => {
    throw new TypeError('Invalid dormant signed-submission verifier dependency.');
  };
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return failure();
    const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'verifierVersion');
    if (
      versionDescriptor === undefined ||
      !('value' in versionDescriptor) ||
      versionDescriptor.value !== DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION
    ) {
      return failure();
    }
    const verify = captureMethod<
      DormantMainnetFinancialActionSignedSubmissionVerifierPort['verifySubmission']
    >(value, 'verifySubmission');
    const review = captureMethod<
      DormantMainnetFinancialActionSignedSubmissionVerifierPort['reviewResult']
    >(value, 'reviewResult');
    return Object.freeze({
      receiver: value,
      verifierVersion: DORMANT_MAINNET_SIGNED_SUBMISSION_VERIFIER_VERSION,
      verify: verify.method,
      review: review.method,
    });
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === 'Invalid dormant signed-submission verifier dependency.'
    ) {
      throw error;
    }
    return failure();
  }
}

function singleRow(value: unknown): unknown {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) {
      throw new Error('INVALID_DATABASE_RESULT');
    }
    const rowsDescriptor = Object.getOwnPropertyDescriptor(value, 'rows');
    if (!rowsDescriptor?.enumerable || !('value' in rowsDescriptor)) {
      throw new Error('INVALID_DATABASE_RESULT');
    }
    const rows = rowsDescriptor.value as unknown;
    if (!Array.isArray(rows) || isProxy(rows) || Object.getPrototypeOf(rows) !== Array.prototype) {
      throw new Error('INVALID_DATABASE_RESULT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(rows) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 2 ||
      !keys.includes('0') ||
      !keys.includes('length') ||
      descriptors.length?.value !== 1 ||
      !descriptors['0']?.enumerable ||
      !('value' in descriptors['0'])
    ) {
      throw new Error('INVALID_DATABASE_RESULT');
    }
    return descriptors['0'].value;
  } catch {
    throw new Error('INVALID_DATABASE_RESULT');
  }
}

function isAborted(signal: AbortSignal): boolean {
  try {
    const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
    return getter === undefined || Reflect.apply(getter, signal, []) !== false;
  } catch {
    return true;
  }
}
