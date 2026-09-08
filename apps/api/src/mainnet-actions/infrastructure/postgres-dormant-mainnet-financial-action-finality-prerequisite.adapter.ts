import { isProxy } from 'node:util/types';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
  type ProviderPositionChainAnchorEvidenceRecordResultV2,
  type ProviderPositionChainAnchorEvidenceRecorderPort,
  type RecordProviderPositionChainAnchorEvidenceRequestV2,
} from '../../mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-recorder.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
} from '../../mainnet-platforms/application/dormant-provider-position-chain-anchor-evidence.producer';
import type { MainnetProviderPositionAssessmentChainAnchorV1 } from '../../mainnet-platforms/domain/mainnet-provider-position-chain-assessment';
import type { MainnetProviderPositionSourceKind } from '../../mainnet-platforms/domain/mainnet-provider-position-observation-policy';
import type { PostgresService } from '../../infrastructure/database/postgres.service';
import { parseWalletAddress, type WalletAddress } from '../../wallets/domain/wallet-identity';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE,
  type MainnetFinancialActionFinalityEvidencePrerequisitePort,
  type MainnetFinancialActionPostFinalityEvidencePrerequisiteV1,
  type MainnetFinancialActionReconciliationEvidencePrerequisiteV1,
  type ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  type ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1,
} from '../application/dormant-mainnet-financial-action-finality-evidence.producer';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE,
  type DormantMainnetFinancialActionDatabaseConfirmedResultV1,
  type DormantMainnetFinancialActionLifecycleDurablePort,
  type ReadDormantMainnetFinancialActionDurableRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE,
  MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING,
  type DormantMainnetFinancialActionEffectiveSafetyReaderPort,
  type DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1,
  type ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUANCE_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_ISSUE_USE,
  type IssueMainnetFinancialActionFinalityPrerequisiteRequestV1,
  type IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  type IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1,
  type MainnetFinancialActionFinalityPrerequisiteIssuanceV1,
  type MainnetFinancialActionFinalityPrerequisiteIssuerClock,
  type MainnetFinancialActionFinalityPrerequisiteIssuerPort,
  type MainnetFinancialActionFinalityWalletReaderPort,
  type MainnetFinancialActionFinalityWalletResultV2,
  type ReadMainnetFinancialActionFinalityWalletRequestV2,
} from '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port';
import { MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES } from '../domain/dormant-mainnet-financial-action';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SOURCE_ID = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const APPROVAL_ID = /^[a-z0-9](?:[a-z0-9._:-]{1,126}[a-z0-9])$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const EVM_HASH = /^0x[0-9a-f]{64}$/u;
const EVM_MARKET = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_INT64 = (1n << 63n) - 1n;
const MAX_REVIEW_REVISION = MAX_INT64 - 1n;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const DATE_PARSE = Object.getOwnPropertyDescriptor(Date, 'parse')?.value;
const DATE_GET_TIME = Object.getOwnPropertyDescriptor(Date.prototype, 'getTime')?.value;
const DATE_TO_ISO_STRING = Object.getOwnPropertyDescriptor(Date.prototype, 'toISOString')?.value;

const LIFECYCLE_RESULT_KEYS = Object.freeze([
  'durableLifecycleVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'apiMaySign',
  'apiMayBroadcast',
  'mayResendTransaction',
  'automaticRetryAllowed',
  'ledgerSettlementAuthority',
  'outcome',
  'operation',
  'databaseRecordOutcome',
  'cursor',
  'volatileIntentCommitmentSha256',
  'stage',
  'chainTransactionId',
  'submissionFingerprintSha256',
  'observationId',
  'broadcastOutcome',
  'reconciliationOutcome',
  'transactionPosition',
  'transactionBlockId',
  'finalizedPosition',
  'finalizedBlockId',
  'lastObservedTransactionPosition',
  'lastObservedTransactionBlockId',
  'effectiveAt',
  'expiresAt',
  'recordedAt',
  'terminal',
  'requiresManualReconciliation',
  'databaseReplayProtectionEnforced',
  'recoveryMode',
] as const);

const LIFECYCLE_CURSOR_KEYS = Object.freeze([
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

const LIFECYCLE_BROADCAST_OUTCOMES = Object.freeze([
  'WALLET_REPORTED_SUBMITTED',
  'WALLET_REPORTED_AMBIGUOUS',
  'WALLET_REPORTED_REJECTED',
] as const);

const LIFECYCLE_RECONCILIATION_OUTCOMES = Object.freeze([
  'PENDING',
  'UNKNOWN',
  'FINALIZED_SUCCESS',
  'FINALIZED_FAILURE',
  'REORGED_OUT',
] as const);

const WALLET_RESULT_KEYS = Object.freeze([
  'readerVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'accountId',
  'intentId',
  'walletRegistrationId',
  'networkId',
  'walletIdentityDigestVersion',
  'walletIdentityDigestHex',
  'lifecycleRevision',
  'lifecycleSnapshotSha256',
  'lifecycleStage',
  'purpose',
  'walletStatus',
  'revokedAt',
  'verifiedAt',
  'walletAddress',
] as const);

/**
 * Migration 0038 contract (not installed by this dormant adapter): both
 * owner-only functions are read-only, use a fixed catalog-qualified
 * search_path, and return either exactly one row with the 53 columns below or
 * no row. They must reject stale lifecycle CAS inputs, a nonmatching recorded
 * migration-0029 fingerprint/network/anchor/source member, inactive or
 * controlled source/deployment authorities, expired evidence/authorities,
 * unsupported provider/asset/action bindings, or a reached deadline. The
 * reconciliation function returns typed NULL for all seven review-only
 * columns. The post-finality function is CALLED ON NULL INPUT so revision-zero
 * previous-review fingerprint can legitimately be NULL, but it must enforce
 * the exact migration-0035 cursor null shape and every non-null review scalar.
 * Neither function grants execution authority or treats migration 0029 as
 * proof of transaction inclusion, sender, payload, effect, or Solana blockhash.
 */
export const MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_DATABASE_FUNCTION =
  'read_mainnet_financial_action_reconciliation_prerequisite_v2(uuid,uuid,bigint,text,text,timestamp with time zone)' as const;
export const MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_DATABASE_FUNCTION =
  'read_mainnet_financial_action_post_finality_prerequisite_v2(uuid,uuid,bigint,text,text,text,text,bigint,text,text,timestamp with time zone)' as const;

/**
 * Exact migration-0038 result contract shared by both owner-only read
 * functions. Review-only fields are null for reconciliation and fully bound
 * for post-finality review.
 */
export const MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_DATABASE_ROW_COLUMNS = Object.freeze([
  'account_id',
  'intent_id',
  'intent_record_fingerprint_sha256',
  'wallet_registration_id',
  'wallet_identity_digest_version',
  'wallet_identity_digest_hex',
  'network_id',
  'lifecycle_revision',
  'lifecycle_snapshot_sha256',
  'lifecycle_stage',
  'transaction_id',
  'wallet_signed_payload_sha256',
  'wallet_signature_evidence_sha256',
  'chain_anchor_evidence_fingerprint_sha256',
  'chain_anchor_json',
  'agreed_finalized_head_json',
  'chain_anchor_evidence_expires_at',
  'source_authority_id',
  'source_authority_fingerprint_sha256',
  'source_authority_expires_at',
  'source_pair_approval_id',
  'source_pair_registry_fingerprint_sha256',
  'primary_source_family_id',
  'primary_source_id',
  'primary_source_kind',
  'corroborating_source_family_id',
  'corroborating_source_id',
  'corroborating_source_kind',
  'deployment_authority_id',
  'deployment_authority_fingerprint_sha256',
  'deployment_authority_expires_at',
  'primary_deployment_manifest_fingerprint_sha256',
  'primary_observed_identity_fingerprint_sha256',
  'corroborating_deployment_manifest_fingerprint_sha256',
  'corroborating_observed_identity_fingerprint_sha256',
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
  'terminal_transition_fingerprint_sha256',
  'original_admission_fingerprint_sha256',
  'terminal_transaction_position',
  'terminal_transaction_block_id',
  'expected_review_revision',
  'expected_previous_review_fingerprint_sha256',
  'effective_safety_state',
  'verified_at',
] as const);

const ROW_PROJECTION = `
  result.account_id::text AS account_id,
  result.intent_id::text AS intent_id,
  result.intent_record_fingerprint_sha256,
  result.wallet_registration_id::text AS wallet_registration_id,
  result.wallet_identity_digest_version,
  result.wallet_identity_digest_hex,
  result.network_id,
  result.lifecycle_revision::text AS lifecycle_revision,
  result.lifecycle_snapshot_sha256,
  result.lifecycle_stage,
  result.transaction_id,
  result.wallet_signed_payload_sha256,
  result.wallet_signature_evidence_sha256,
  result.chain_anchor_evidence_fingerprint_sha256,
  result.chain_anchor::text AS chain_anchor_json,
  result.agreed_finalized_head::text AS agreed_finalized_head_json,
  pg_catalog.to_char(result.chain_anchor_evidence_expires_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS chain_anchor_evidence_expires_at,
  result.source_authority_id::text AS source_authority_id,
  result.source_authority_fingerprint_sha256,
  pg_catalog.to_char(result.source_authority_expires_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS source_authority_expires_at,
  result.source_pair_approval_id,
  result.source_pair_registry_fingerprint_sha256,
  result.primary_source_family_id,
  result.primary_source_id,
  result.primary_source_kind,
  result.corroborating_source_family_id,
  result.corroborating_source_id,
  result.corroborating_source_kind,
  result.deployment_authority_id::text AS deployment_authority_id,
  result.deployment_authority_fingerprint_sha256,
  pg_catalog.to_char(result.deployment_authority_expires_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS deployment_authority_expires_at,
  result.primary_deployment_manifest_fingerprint_sha256,
  result.primary_observed_identity_fingerprint_sha256,
  result.corroborating_deployment_manifest_fingerprint_sha256,
  result.corroborating_observed_identity_fingerprint_sha256,
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
  result.terminal_transition_fingerprint_sha256,
  result.original_admission_fingerprint_sha256,
  result.terminal_transaction_position::text AS terminal_transaction_position,
  result.terminal_transaction_block_id,
  result.expected_review_revision::text AS expected_review_revision,
  result.expected_previous_review_fingerprint_sha256,
  result.effective_safety_state,
  pg_catalog.to_char(result.verified_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS verified_at`;

export const MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_READ_SQL = `SELECT${ROW_PROJECTION}
FROM read_mainnet_financial_action_reconciliation_prerequisite_v2(
  $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::timestamptz
) AS result`;

export const MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_READ_SQL = `SELECT${ROW_PROJECTION}
FROM read_mainnet_financial_action_post_finality_prerequisite_v2(
  $1::uuid, $2::uuid, $3::bigint, $4::text, $5::text, $6::text,
  $7::text, $8::bigint, $9::text, $10::text, $11::timestamptz
) AS result`;

type QueryWithCancellation = PostgresService['queryWithCancellation'];
type Purpose = 'RECONCILIATION_ADMISSION' | 'POST_FINALITY_REVIEW';
type Prerequisite =
  | MainnetFinancialActionReconciliationEvidencePrerequisiteV1
  | MainnetFinancialActionPostFinalityEvidencePrerequisiteV1;
type ReviewRequest =
  | ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1
  | ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1;

interface CapturedMethod<Method extends (...arguments_: never[]) => unknown> {
  readonly receiver: object;
  readonly method: Method;
}

interface CapturedLifecycle {
  readonly review: CapturedMethod<
    DormantMainnetFinancialActionLifecycleDurablePort['reviewResult']
  >;
}

interface CapturedChainEvidence {
  readonly review: CapturedMethod<ProviderPositionChainAnchorEvidenceRecorderPort['reviewResult']>;
}

interface CapturedEffectiveSafety {
  readonly review: CapturedMethod<
    DormantMainnetFinancialActionEffectiveSafetyReaderPort['reviewResult']
  >;
}

interface CapturedWallet {
  readonly read: CapturedMethod<MainnetFinancialActionFinalityWalletReaderPort['readWallet']>;
  readonly verify: CapturedMethod<MainnetFinancialActionFinalityWalletReaderPort['verifyWallet']>;
}

interface CanonicalTime {
  readonly value: string;
  readonly milliseconds: number;
}

interface ReviewedLifecycle {
  readonly result: DormantMainnetFinancialActionDatabaseConfirmedResultV1;
  readonly request: ReadDormantMainnetFinancialActionDurableRequestV1;
  readonly accountId: string;
  readonly intentId: string;
  readonly networkId: typeof ETHEREUM | typeof SOLANA;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly intentRecordFingerprintSha256: string;
  readonly lifecycleStage:
    | 'WALLET_SIGNED_SUBMISSION_BOUND'
    | 'BROADCAST_OUTCOME_AMBIGUOUS'
    | 'RECONCILIATION_AMBIGUOUS'
    | 'FINALIZED_SUCCESS'
    | 'FINALIZED_FAILURE';
  readonly transactionId: string;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
}

interface ReviewedChainEvidence {
  readonly result: ProviderPositionChainAnchorEvidenceRecordResultV2 & {
    readonly outcome: 'RECORDED';
  };
  readonly request: RecordProviderPositionChainAnchorEvidenceRequestV2;
  readonly recordIntentFingerprintSha256: string;
  readonly evidenceFingerprintSha256: string;
  readonly deadlineBindingSha256: string;
  readonly evidenceRecordedAt: CanonicalTime;
  readonly resolvedAt: CanonicalTime;
  readonly networkId: typeof ETHEREUM | typeof SOLANA;
  readonly chainAnchor: MainnetProviderPositionAssessmentChainAnchorV1;
}

interface ReviewedSafety {
  readonly result: DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1;
  readonly request: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;
  readonly terminalTransitionFingerprintSha256: string;
  readonly originalAdmissionFingerprintSha256: string;
  readonly terminalTransactionPosition: string;
  readonly terminalTransactionBlockId: string;
  readonly expectedReviewRevision: string;
  readonly expectedPreviousReviewFingerprintSha256: string | null;
  readonly effectiveSafetyState:
    | 'AUTHENTICATED_FINALITY_RECORDED'
    | 'POST_FINALITY_REVIEW_INCONCLUSIVE'
    | 'DEEP_REORG_QUARANTINED';
}

interface ReviewedIssueRequest {
  readonly request: IssueMainnetFinancialActionFinalityPrerequisiteRequestV1;
  readonly purpose: Purpose;
  readonly lifecycleCapability: object;
  readonly lifecycleRequest: ReadDormantMainnetFinancialActionDurableRequestV1;
  readonly chainEvidenceCapability: object;
  readonly chainEvidenceRequest: RecordProviderPositionChainAnchorEvidenceRequestV2;
  readonly operationId: string;
  readonly correlationId: string;
  readonly deadlineAt: CanonicalTime;
  readonly signal: AbortSignal;
  readonly effectiveSafetyCapability: object | null;
  readonly effectiveSafetyRequest: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1 | null;
}

interface DecodedRow {
  readonly prerequisite: Omit<
    MainnetFinancialActionReconciliationEvidencePrerequisiteV1,
    | 'use'
    | 'purpose'
    | 'lifecycleStage'
    | 'observationId'
    | 'walletAddress'
    | 'correlationId'
    | 'deadlineAt'
    | 'signal'
  > & {
    readonly lifecycleStage: ReviewedLifecycle['lifecycleStage'];
  };
  readonly walletRequest: ReadMainnetFinancialActionFinalityWalletRequestV2;
  readonly terminalTransitionFingerprintSha256: string | null;
  readonly originalAdmissionFingerprintSha256: string | null;
  readonly terminalTransactionPosition: string | null;
  readonly terminalTransactionBlockId: string | null;
  readonly expectedReviewRevision: string | null;
  readonly expectedPreviousReviewFingerprintSha256: string | null;
  readonly effectiveSafetyState: ReviewedSafety['effectiveSafetyState'] | null;
  readonly verifiedAt: CanonicalTime;
}

interface IssuedPrerequisite {
  readonly request: IssueMainnetFinancialActionFinalityPrerequisiteRequestV1;
  readonly issuance: MainnetFinancialActionFinalityPrerequisiteIssuanceV1;
  readonly prerequisiteCapability: object;
  readonly reviewRequest: ReviewRequest;
  readonly prerequisite: Prerequisite;
  readonly signal: AbortSignal;
  readonly issuedAtMilliseconds: number;
  readonly deadlineAtMilliseconds: number;
  readonly authorityExpiresAtMilliseconds: number;
}

const RECONCILIATION_REQUEST_KEYS = Object.freeze([
  'issuerVersion',
  'use',
  'purpose',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'lifecycleCapability',
  'lifecycleRequest',
  'chainEvidenceCapability',
  'chainEvidenceRequest',
  'correlationId',
  'deadlineAt',
  'signal',
  'observationId',
] as const);
const REVIEW_REQUEST_KEYS = Object.freeze([
  'issuerVersion',
  'use',
  'purpose',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'lifecycleCapability',
  'lifecycleRequest',
  'chainEvidenceCapability',
  'chainEvidenceRequest',
  'correlationId',
  'deadlineAt',
  'signal',
  'reviewId',
  'effectiveSafetyCapability',
  'effectiveSafetyRequest',
] as const);

export type MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'UPSTREAM_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'INVALID_DATABASE_RESULT'
  | 'WALLET_UNAVAILABLE'
  | 'STALE_PREREQUISITE';

export class DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError extends Error {
  constructor(readonly code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode) {
    super('Authenticated mainnet financial-action prerequisite is unavailable.');
    this.name = 'DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

function fail(code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode): never {
  throw new DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError(code);
}

function nullRecord<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function exactFrozenNullRecord(
  value: unknown,
  keys: readonly string[],
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== null ||
      !Object.isFrozen(value)
    ) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.configurable ||
        !('value' in descriptor) ||
        descriptor.writable
      ) {
        return fail(code);
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return fail(code);
  }
}

function exactFrozenDataRecord(
  value: unknown,
  keys: readonly string[],
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      !Object.isFrozen(value)
    ) {
      return fail(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.configurable ||
        !('value' in descriptor) ||
        descriptor.writable
      ) {
        return fail(code);
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError) {
      throw error;
    }
    return fail(code);
  }
}

function stableMember(value: unknown, key: PropertyKey): unknown {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return fail('UPSTREAM_UNAVAILABLE');
    }
    let current: object | null = value as object;
    for (let depth = 0; current !== null && depth < 12; depth += 1) {
      if (isProxy(current)) return fail('UPSTREAM_UNAVAILABLE');
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!('value' in descriptor)) return fail('UPSTREAM_UNAVAILABLE');
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail('UPSTREAM_UNAVAILABLE');
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError) {
      throw error;
    }
    return fail('UPSTREAM_UNAVAILABLE');
  }
}

function captureMethod<Method extends (...arguments_: never[]) => unknown>(
  value: unknown,
  key: PropertyKey,
  versionKey: PropertyKey,
  expectedVersion: number,
): CapturedMethod<Method> {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value) ||
    stableMember(value, versionKey) !== expectedVersion
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const method = stableMember(value, key);
  if (typeof method !== 'function' || isProxy(method)) return fail('INVALID_CONFIGURATION');
  return Object.freeze({ receiver: value as object, method: method as Method });
}

function capability(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): object {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return fail(code);
    }
    return value as object;
  } catch {
    return fail(code);
  }
}

function authenticSignal(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): AbortSignal {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== AbortSignal.prototype ||
      ABORTED_GETTER === undefined
    ) {
      return fail(code);
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch {
    return fail(code);
  }
}

function aborted(value: AbortSignal): boolean {
  try {
    return ABORTED_GETTER === undefined || (Reflect.apply(ABORTED_GETTER, value, []) as boolean);
  } catch {
    return true;
  }
}

function uuid(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail(code);
  return value;
}

function digest(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): string {
  if (typeof value !== 'string' || !SHA256.test(value) || /^0{64}$/u.test(value)) {
    return fail(code);
  }
  return value;
}

function nullableDigest(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): string | null {
  return value === null ? null : digest(value, code);
}

function timestamp(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value) || typeof DATE_PARSE !== 'function') {
    return fail(code);
  }
  const milliseconds = Reflect.apply(DATE_PARSE, Date, [value]) as number;
  if (
    !Number.isSafeInteger(milliseconds) ||
    typeof DATE_TO_ISO_STRING !== 'function' ||
    Reflect.apply(DATE_TO_ISO_STRING, new Date(milliseconds), []) !== value
  ) {
    return fail(code);
  }
  return Object.freeze({ value, milliseconds });
}

function network(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): typeof ETHEREUM | typeof SOLANA {
  if (value !== ETHEREUM && value !== SOLANA) return fail(code);
  return value;
}

function integer(
  value: unknown,
  minimum: bigint,
  maximum: bigint,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): string {
  if (typeof value !== 'string' || !UNSIGNED_INTEGER.test(value)) return fail(code);
  const parsed = BigInt(value);
  if (parsed < minimum || parsed > maximum) return fail(code);
  return value;
}

function numberInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return fail(code);
  }
  return value as number;
}

function sourceId(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): string {
  if (typeof value !== 'string' || !SOURCE_ID.test(value)) return fail(code);
  return value;
}

function sourceKind(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): MainnetProviderPositionSourceKind {
  if (value !== 'RPC' && value !== 'INDEXER' && value !== 'PROVIDER_API') return fail(code);
  return value;
}

function approvalId(
  value: unknown,
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): string {
  if (typeof value !== 'string' || !APPROVAL_ID.test(value)) return fail(code);
  return value;
}

function decodeBase58(value: string): Uint8Array | null {
  if (value.length < 32 || value.length > 88 || !BASE58.test(value)) return null;
  let decoded = 0n;
  for (const character of value) {
    const index = BASE58_ALPHABET.indexOf(character);
    if (index < 0) return null;
    decoded = decoded * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (decoded > 0n) {
    bytes.push(Number(decoded & 255n));
    decoded >>= 8n;
  }
  bytes.reverse();
  const leading = value.match(/^1*/u)?.[0].length ?? 0;
  return Uint8Array.from([...new Array<number>(leading).fill(0), ...bytes]);
}

function chainIdentity(
  networkId: typeof ETHEREUM | typeof SOLANA,
  value: unknown,
  kind: 'TRANSACTION' | 'BLOCK',
  code: MainnetFinancialActionFinalityPrerequisiteIssuerFailureCode,
): string {
  if (typeof value !== 'string') return fail(code);
  if (networkId === ETHEREUM) {
    if (!EVM_HASH.test(value) || /^0x0{64}$/u.test(value)) return fail(code);
    return value;
  }
  const bytes = decodeBase58(value);
  const length = kind === 'TRANSACTION' ? 64 : 32;
  if (bytes === null || bytes.length !== length || bytes.every((byte) => byte === 0)) {
    return fail(code);
  }
  return value;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.length > 1024) return fail('INVALID_DATABASE_RESULT');
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail('INVALID_DATABASE_RESULT');
  }
}

function anchor(
  value: unknown,
  networkId: typeof ETHEREUM | typeof SOLANA,
): MainnetProviderPositionAssessmentChainAnchorV1 {
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  try {
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || isProxy(parsed)) {
      return fail('INVALID_DATABASE_RESULT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(parsed);
    const keys = Reflect.ownKeys(descriptors);
    const read = (key: string): unknown => {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        return fail('INVALID_DATABASE_RESULT');
      }
      return descriptor.value;
    };
    if (networkId === ETHEREUM) {
      if (
        keys.length !== 3 ||
        keys.some((key) => !['kind', 'blockNumber', 'blockHash'].includes(String(key)))
      ) {
        return fail('INVALID_DATABASE_RESULT');
      }
      if (read('kind') !== 'EVM_BLOCK') return fail('INVALID_DATABASE_RESULT');
      return nullRecord({
        kind: 'EVM_BLOCK' as const,
        blockNumber: integer(read('blockNumber'), 0n, MAX_UINT64, 'INVALID_DATABASE_RESULT'),
        blockHash: chainIdentity(networkId, read('blockHash'), 'BLOCK', 'INVALID_DATABASE_RESULT'),
      });
    }
    if (keys.length !== 3 || keys.some((key) => !['kind', 'slot', 'root'].includes(String(key)))) {
      return fail('INVALID_DATABASE_RESULT');
    }
    if (read('kind') !== 'SOLANA_SLOT') return fail('INVALID_DATABASE_RESULT');
    const slot = integer(read('slot'), 0n, MAX_UINT64, 'INVALID_DATABASE_RESULT');
    const root = integer(read('root'), 0n, MAX_UINT64, 'INVALID_DATABASE_RESULT');
    if (BigInt(root) > BigInt(slot)) return fail('INVALID_DATABASE_RESULT');
    return nullRecord({ kind: 'SOLANA_SLOT' as const, slot, root });
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError) {
      throw error;
    }
    return fail('INVALID_DATABASE_RESULT');
  }
}

function sameAnchor(
  left: MainnetProviderPositionAssessmentChainAnchorV1,
  right: MainnetProviderPositionAssessmentChainAnchorV1,
): boolean {
  return left.kind === 'EVM_BLOCK' && right.kind === 'EVM_BLOCK'
    ? left.blockNumber === right.blockNumber && left.blockHash === right.blockHash
    : left.kind === 'SOLANA_SLOT' && right.kind === 'SOLANA_SLOT'
      ? left.slot === right.slot && left.root === right.root
      : false;
}

function transactionMarket(networkId: typeof ETHEREUM | typeof SOLANA, value: unknown): string {
  if (typeof value !== 'string') return fail('INVALID_DATABASE_RESULT');
  if (networkId === ETHEREUM) {
    if (!EVM_MARKET.test(value) || /^0x0+$/u.test(value)) return fail('INVALID_DATABASE_RESULT');
    return value;
  }
  const bytes = decodeBase58(value);
  if (bytes === null || bytes.length !== 32 || bytes.every((byte) => byte === 0)) {
    return fail('INVALID_DATABASE_RESULT');
  }
  return value;
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return fail('INVALID_DATABASE_RESULT');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail('INVALID_DATABASE_RESULT');
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        return fail('INVALID_DATABASE_RESULT');
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError) {
      throw error;
    }
    return fail('INVALID_DATABASE_RESULT');
  }
}

function rows(value: unknown): readonly [Record<string, unknown>] {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) {
      return fail('INVALID_DATABASE_RESULT');
    }
    const resultDescriptor = Object.getOwnPropertyDescriptor(value, 'rows');
    if (
      resultDescriptor === undefined ||
      !resultDescriptor.enumerable ||
      !('value' in resultDescriptor)
    ) {
      return fail('INVALID_DATABASE_RESULT');
    }
    const candidate = resultDescriptor.value;
    if (
      !Array.isArray(candidate) ||
      isProxy(candidate) ||
      Object.getPrototypeOf(candidate) !== Array.prototype
    ) {
      return fail('INVALID_DATABASE_RESULT');
    }
    const arrayDescriptors = Object.getOwnPropertyDescriptors(candidate);
    const arrayKeys = Reflect.ownKeys(arrayDescriptors);
    const elementDescriptor = arrayDescriptors['0'];
    if (
      candidate.length !== 1 ||
      arrayKeys.length !== 2 ||
      !arrayKeys.includes('0') ||
      !arrayKeys.includes('length') ||
      elementDescriptor === undefined ||
      !elementDescriptor.enumerable ||
      !('value' in elementDescriptor)
    ) {
      return fail('INVALID_DATABASE_RESULT');
    }
    return [
      exactDataRecord(
        elementDescriptor.value,
        MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_DATABASE_ROW_COLUMNS,
      ),
    ];
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError) {
      throw error;
    }
    return fail('INVALID_DATABASE_RESULT');
  }
}

function plainMethod<Method extends (...arguments_: never[]) => unknown>(
  value: unknown,
  key: PropertyKey,
): CapturedMethod<Method> {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    isProxy(value)
  ) {
    return fail('INVALID_CONFIGURATION');
  }
  const method = stableMember(value, key);
  if (typeof method !== 'function' || isProxy(method)) return fail('INVALID_CONFIGURATION');
  return Object.freeze({ receiver: value as object, method: method as Method });
}

function invokeReview<Method extends (...arguments_: never[]) => unknown>(
  captured: CapturedMethod<Method>,
  reviewedCapability: object,
  request: object,
): unknown {
  try {
    return Reflect.apply(captured.method, captured.receiver, [reviewedCapability, request]);
  } catch {
    return fail('UPSTREAM_UNAVAILABLE');
  }
}

function nativePromise(value: unknown): Promise<unknown> | null {
  try {
    return value instanceof Promise &&
      !isProxy(value) &&
      Object.getPrototypeOf(value) === Promise.prototype
      ? value
      : null;
  } catch {
    return null;
  }
}

function clockTimeFrom(captured: CapturedMethod<() => Date>): CanonicalTime {
  try {
    const value = Reflect.apply(captured.method, captured.receiver, []);
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value) ||
      typeof DATE_GET_TIME !== 'function' ||
      typeof DATE_TO_ISO_STRING !== 'function'
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    const milliseconds = Reflect.apply(DATE_GET_TIME, value, []) as number;
    const iso = Reflect.apply(DATE_TO_ISO_STRING, value, []) as string;
    if (!Number.isSafeInteger(milliseconds)) return fail('INVALID_CONFIGURATION');
    return timestamp(iso, 'INVALID_CONFIGURATION');
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError) {
      throw error;
    }
    return fail('INVALID_CONFIGURATION');
  }
}

function failWalletRead(
  clock: CapturedMethod<() => Date>,
  signal: AbortSignal,
  monotonicFloorMilliseconds: number,
  deadlineAtMilliseconds: number,
): never {
  const rejectedAt = clockTimeFrom(clock);
  if (
    aborted(signal) ||
    rejectedAt.milliseconds < monotonicFloorMilliseconds ||
    rejectedAt.milliseconds >= deadlineAtMilliseconds
  ) {
    return fail('STALE_PREREQUISITE');
  }
  return fail('WALLET_UNAVAILABLE');
}

function reviewedIssueRequest(
  input: unknown,
  now: CanonicalTime,
  expectedPurpose: Purpose,
): ReviewedIssueRequest {
  const keys =
    expectedPurpose === 'RECONCILIATION_ADMISSION'
      ? RECONCILIATION_REQUEST_KEYS
      : REVIEW_REQUEST_KEYS;
  const record = exactFrozenNullRecord(input, keys, 'INVALID_REQUEST');
  const expectedUse =
    expectedPurpose === 'RECONCILIATION_ADMISSION'
      ? MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_ISSUE_USE
      : MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_USE;
  if (
    record.issuerVersion !== MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION ||
    record.use !== expectedUse ||
    record.purpose !== expectedPurpose ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false
  ) {
    return fail('INVALID_REQUEST');
  }
  const signal = authenticSignal(record.signal, 'INVALID_REQUEST');
  const deadlineAt = timestamp(record.deadlineAt, 'INVALID_REQUEST');
  if (
    aborted(signal) ||
    now.milliseconds >= deadlineAt.milliseconds ||
    deadlineAt.milliseconds - now.milliseconds > MAX_DEADLINE_MILLISECONDS
  ) {
    return fail('STALE_PREREQUISITE');
  }
  const lifecycleCapability = capability(record.lifecycleCapability, 'INVALID_REQUEST');
  const lifecycleRequest = capability(
    record.lifecycleRequest,
    'INVALID_REQUEST',
  ) as ReadDormantMainnetFinancialActionDurableRequestV1;
  if (
    stableMember(lifecycleRequest, 'durableLifecycleVersion') !==
      DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION ||
    stableMember(lifecycleRequest, 'use') !==
      DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE ||
    stableMember(lifecycleRequest, 'mayAuthorizeFinancialAction') !== false ||
    stableMember(lifecycleRequest, 'signal') !== signal
  ) {
    return fail('INVALID_REQUEST');
  }
  uuid(stableMember(lifecycleRequest, 'accountId'), 'INVALID_REQUEST');
  uuid(stableMember(lifecycleRequest, 'intentId'), 'INVALID_REQUEST');

  const chainEvidenceCapability = capability(record.chainEvidenceCapability, 'INVALID_REQUEST');
  const chainEvidenceRequest = capability(
    record.chainEvidenceRequest,
    'INVALID_REQUEST',
  ) as RecordProviderPositionChainAnchorEvidenceRequestV2;
  if (
    stableMember(chainEvidenceRequest, 'recorderVersion') !==
      PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION ||
    stableMember(chainEvidenceRequest, 'use') !==
      PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE ||
    stableMember(chainEvidenceRequest, 'mayAuthorizeFinancialAction') !== false ||
    stableMember(chainEvidenceRequest, 'signal') !== signal
  ) {
    return fail('INVALID_REQUEST');
  }
  const producerRequest = capability(
    stableMember(chainEvidenceRequest, 'producerRequest'),
    'INVALID_REQUEST',
  );
  if (
    stableMember(producerRequest, 'producerVersion') !==
      PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION ||
    stableMember(producerRequest, 'use') !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE ||
    stableMember(producerRequest, 'mayAuthorizeFinancialAction') !== false ||
    stableMember(producerRequest, 'mayPersist') !== false ||
    stableMember(producerRequest, 'signal') !== signal ||
    stableMember(producerRequest, 'deadlineAt') !== deadlineAt.value
  ) {
    return fail('INVALID_REQUEST');
  }

  const correlationId = uuid(record.correlationId, 'INVALID_REQUEST');
  const operationId = uuid(
    expectedPurpose === 'RECONCILIATION_ADMISSION' ? record.observationId : record.reviewId,
    'INVALID_REQUEST',
  );
  let effectiveSafetyCapability: object | null = null;
  let effectiveSafetyRequest: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1 | null = null;
  if (expectedPurpose === 'POST_FINALITY_REVIEW') {
    effectiveSafetyCapability = capability(record.effectiveSafetyCapability, 'INVALID_REQUEST');
    effectiveSafetyRequest = capability(
      record.effectiveSafetyRequest,
      'INVALID_REQUEST',
    ) as ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;
    if (
      stableMember(effectiveSafetyRequest, 'signal') !== signal ||
      stableMember(effectiveSafetyRequest, 'accountId') !==
        stableMember(lifecycleRequest, 'accountId') ||
      stableMember(effectiveSafetyRequest, 'intentId') !==
        stableMember(lifecycleRequest, 'intentId')
    ) {
      return fail('INVALID_REQUEST');
    }
  }
  return Object.freeze({
    request: input as IssueMainnetFinancialActionFinalityPrerequisiteRequestV1,
    purpose: expectedPurpose,
    lifecycleCapability,
    lifecycleRequest,
    chainEvidenceCapability,
    chainEvidenceRequest,
    operationId,
    correlationId,
    deadlineAt,
    signal,
    effectiveSafetyCapability,
    effectiveSafetyRequest,
  });
}

function sameReviewedIssue(left: ReviewedIssueRequest, right: ReviewedIssueRequest): boolean {
  return (
    left.request === right.request &&
    left.purpose === right.purpose &&
    left.lifecycleCapability === right.lifecycleCapability &&
    left.lifecycleRequest === right.lifecycleRequest &&
    left.chainEvidenceCapability === right.chainEvidenceCapability &&
    left.chainEvidenceRequest === right.chainEvidenceRequest &&
    left.operationId === right.operationId &&
    left.correlationId === right.correlationId &&
    left.deadlineAt.value === right.deadlineAt.value &&
    left.signal === right.signal &&
    left.effectiveSafetyCapability === right.effectiveSafetyCapability &&
    left.effectiveSafetyRequest === right.effectiveSafetyRequest
  );
}

function reviewedLifecycle(
  captured: CapturedLifecycle,
  request: ReviewedIssueRequest,
): ReviewedLifecycle {
  const reviewed = invokeReview(
    captured.review,
    request.lifecycleCapability,
    request.lifecycleRequest,
  );
  if (reviewed !== request.lifecycleCapability) return fail('UPSTREAM_UNAVAILABLE');
  const record = exactFrozenDataRecord(reviewed, LIFECYCLE_RESULT_KEYS, 'UPSTREAM_UNAVAILABLE');
  const result = reviewed as DormantMainnetFinancialActionDatabaseConfirmedResultV1;
  if (
    record.durableLifecycleVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION ||
    record.use !== DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_RESULT_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.apiMaySign !== false ||
    record.apiMayBroadcast !== false ||
    record.mayResendTransaction !== false ||
    record.automaticRetryAllowed !== false ||
    record.ledgerSettlementAuthority !== false ||
    record.outcome !== 'DATABASE_STATE_CONFIRMED' ||
    record.operation !== 'READ' ||
    record.databaseRecordOutcome !== 'READ' ||
    record.databaseReplayProtectionEnforced !== true
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const cursor = exactFrozenDataRecord(
    record.cursor,
    LIFECYCLE_CURSOR_KEYS,
    'UPSTREAM_UNAVAILABLE',
  );
  const accountId = uuid(cursor.accountId, 'UPSTREAM_UNAVAILABLE');
  const intentId = uuid(cursor.intentId, 'UPSTREAM_UNAVAILABLE');
  const networkId = network(cursor.networkId, 'UPSTREAM_UNAVAILABLE');
  const lifecycleRevision = integer(
    cursor.lifecycleRevision,
    1n,
    MAX_INT64,
    'UPSTREAM_UNAVAILABLE',
  );
  const lifecycleSnapshotSha256 = digest(cursor.currentSnapshotSha256, 'UPSTREAM_UNAVAILABLE');
  const intentRecordFingerprintSha256 = digest(
    cursor.intentRecordFingerprintSha256,
    'UPSTREAM_UNAVAILABLE',
  );
  if (
    cursor.schemaVersion !== 1 ||
    cursor.source !== 'MIGRATION_0033_DATABASE' ||
    cursor.fingerprintEncoding !== 'CLMA-FP-1' ||
    accountId !== stableMember(request.lifecycleRequest, 'accountId') ||
    intentId !== stableMember(request.lifecycleRequest, 'intentId')
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const lifecycleStage = record.stage;
  const allowed =
    request.purpose === 'RECONCILIATION_ADMISSION'
      ? lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND' ||
        lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS' ||
        lifecycleStage === 'RECONCILIATION_AMBIGUOUS'
      : lifecycleStage === 'FINALIZED_SUCCESS' || lifecycleStage === 'FINALIZED_FAILURE';
  if (!allowed) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const revision = BigInt(lifecycleRevision);
  if (
    (lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND' && revision !== 2n) ||
    (lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS' && revision !== 3n) ||
    (lifecycleStage !== 'WALLET_SIGNED_SUBMISSION_BOUND' &&
      lifecycleStage !== 'BROADCAST_OUTCOME_AMBIGUOUS' &&
      revision < 3n)
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const volatileIntentCommitmentSha256 = digest(
    record.volatileIntentCommitmentSha256,
    'UPSTREAM_UNAVAILABLE',
  );
  digest(record.submissionFingerprintSha256, 'UPSTREAM_UNAVAILABLE');
  if (
    lifecycleSnapshotSha256 === volatileIntentCommitmentSha256 ||
    intentRecordFingerprintSha256 === volatileIntentCommitmentSha256 ||
    lifecycleSnapshotSha256 === intentRecordFingerprintSha256
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const transactionId = chainIdentity(
    networkId,
    record.chainTransactionId,
    'TRANSACTION',
    'UPSTREAM_UNAVAILABLE',
  );
  if (lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND') {
    if (record.observationId !== null) return fail('UPSTREAM_UNAVAILABLE');
  } else {
    uuid(record.observationId, 'UPSTREAM_UNAVAILABLE');
  }
  const broadcastOutcome = record.broadcastOutcome;
  const reconciliationOutcome = record.reconciliationOutcome;
  if (
    (broadcastOutcome !== null &&
      !(LIFECYCLE_BROADCAST_OUTCOMES as readonly unknown[]).includes(broadcastOutcome)) ||
    (reconciliationOutcome !== null &&
      !(LIFECYCLE_RECONCILIATION_OUTCOMES as readonly unknown[]).includes(reconciliationOutcome))
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const transactionPosition =
    record.transactionPosition === null
      ? null
      : integer(record.transactionPosition, 0n, MAX_UINT64, 'UPSTREAM_UNAVAILABLE');
  const transactionBlockId =
    record.transactionBlockId === null
      ? null
      : chainIdentity(networkId, record.transactionBlockId, 'BLOCK', 'UPSTREAM_UNAVAILABLE');
  const finalizedPosition =
    record.finalizedPosition === null
      ? null
      : integer(record.finalizedPosition, 0n, MAX_UINT64, 'UPSTREAM_UNAVAILABLE');
  const finalizedBlockId =
    record.finalizedBlockId === null
      ? null
      : chainIdentity(networkId, record.finalizedBlockId, 'BLOCK', 'UPSTREAM_UNAVAILABLE');
  const lastObservedTransactionPosition =
    record.lastObservedTransactionPosition === null
      ? null
      : integer(record.lastObservedTransactionPosition, 0n, MAX_UINT64, 'UPSTREAM_UNAVAILABLE');
  const lastObservedTransactionBlockId =
    record.lastObservedTransactionBlockId === null
      ? null
      : chainIdentity(
          networkId,
          record.lastObservedTransactionBlockId,
          'BLOCK',
          'UPSTREAM_UNAVAILABLE',
        );
  if (
    (transactionPosition === null) !== (transactionBlockId === null) ||
    (finalizedPosition === null) !== (finalizedBlockId === null) ||
    (lastObservedTransactionPosition === null) !== (lastObservedTransactionBlockId === null) ||
    (transactionPosition !== null &&
      (lastObservedTransactionPosition !== transactionPosition ||
        lastObservedTransactionBlockId !== transactionBlockId))
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const signedBoundShape =
    lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND' &&
    broadcastOutcome === null &&
    reconciliationOutcome === null &&
    transactionPosition === null &&
    finalizedPosition === null &&
    lastObservedTransactionPosition === null;
  const broadcastShape =
    lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS' &&
    broadcastOutcome !== null &&
    reconciliationOutcome === null &&
    transactionPosition === null &&
    finalizedPosition === null &&
    lastObservedTransactionPosition === null;
  const reconciliationShape =
    lifecycleStage === 'RECONCILIATION_AMBIGUOUS' &&
    broadcastOutcome === null &&
    finalizedPosition !== null &&
    (reconciliationOutcome === 'UNKNOWN'
      ? transactionPosition === null
      : reconciliationOutcome === 'PENDING' &&
        (transactionPosition === null || BigInt(finalizedPosition) < BigInt(transactionPosition)));
  const expectedTerminalOutcome =
    lifecycleStage === 'FINALIZED_SUCCESS'
      ? 'FINALIZED_SUCCESS'
      : lifecycleStage === 'FINALIZED_FAILURE'
        ? 'FINALIZED_FAILURE'
        : null;
  const terminalShape =
    expectedTerminalOutcome !== null &&
    broadcastOutcome === null &&
    reconciliationOutcome === expectedTerminalOutcome &&
    transactionPosition !== null &&
    finalizedPosition !== null &&
    BigInt(finalizedPosition) >= BigInt(transactionPosition);
  if (!signedBoundShape && !broadcastShape && !reconciliationShape && !terminalShape) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const terminal = request.purpose === 'POST_FINALITY_REVIEW';
  if (
    record.terminal !== terminal ||
    record.requiresManualReconciliation !== false ||
    record.recoveryMode !== (terminal ? 'NONE' : 'READ_THEN_RECONCILE_ONLY')
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const effectiveAt = timestamp(record.effectiveAt, 'UPSTREAM_UNAVAILABLE');
  // Intent expiry is not a finality-recovery expiry. A previously signed or
  // broadcast transaction must remain reconcilable after its intent TTL.
  timestamp(record.expiresAt, 'UPSTREAM_UNAVAILABLE');
  const recordedAt = timestamp(record.recordedAt, 'UPSTREAM_UNAVAILABLE');
  if (effectiveAt.milliseconds > recordedAt.milliseconds) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  return Object.freeze({
    result,
    request: request.lifecycleRequest,
    accountId,
    intentId,
    networkId,
    lifecycleRevision,
    lifecycleSnapshotSha256,
    intentRecordFingerprintSha256,
    lifecycleStage: lifecycleStage as ReviewedLifecycle['lifecycleStage'],
    transactionId,
    transactionPosition,
    transactionBlockId,
  });
}

function sameLifecycle(left: ReviewedLifecycle, right: ReviewedLifecycle): boolean {
  return (
    left.result === right.result &&
    left.request === right.request &&
    left.accountId === right.accountId &&
    left.intentId === right.intentId &&
    left.networkId === right.networkId &&
    left.lifecycleRevision === right.lifecycleRevision &&
    left.lifecycleSnapshotSha256 === right.lifecycleSnapshotSha256 &&
    left.intentRecordFingerprintSha256 === right.intentRecordFingerprintSha256 &&
    left.lifecycleStage === right.lifecycleStage &&
    left.transactionId === right.transactionId &&
    left.transactionPosition === right.transactionPosition &&
    left.transactionBlockId === right.transactionBlockId
  );
}

function reviewedChainEvidence(
  captured: CapturedChainEvidence,
  request: ReviewedIssueRequest,
  now: CanonicalTime,
): ReviewedChainEvidence {
  const reviewed = invokeReview(
    captured.review,
    request.chainEvidenceCapability,
    request.chainEvidenceRequest,
  );
  if (reviewed !== request.chainEvidenceCapability) return fail('UPSTREAM_UNAVAILABLE');
  const result = reviewed as ProviderPositionChainAnchorEvidenceRecordResultV2 & {
    readonly outcome: 'RECORDED';
  };
  if (
    stableMember(result, 'recorderVersion') !==
      PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION ||
    stableMember(result, 'use') !== PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_RESULT_USE ||
    stableMember(result, 'mayAuthorizeFinancialAction') !== false ||
    stableMember(result, 'outcome') !== 'RECORDED' ||
    (stableMember(result, 'recordOutcome') !== 'RECORDED' &&
      stableMember(result, 'recordOutcome') !== 'IDEMPOTENT_REPLAY') ||
    stableMember(result, 'producerDeadlineAt') !== request.deadlineAt.value
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const producerRequest = capability(
    stableMember(request.chainEvidenceRequest, 'producerRequest'),
    'UPSTREAM_UNAVAILABLE',
  );
  const networkId = network(stableMember(producerRequest, 'networkId'), 'UPSTREAM_UNAVAILABLE');
  const chainAnchor = anchor(stableMember(producerRequest, 'chainAnchor'), networkId);
  const recordIntentFingerprintSha256 = digest(
    stableMember(result, 'recordIntentFingerprintSha256'),
    'UPSTREAM_UNAVAILABLE',
  );
  const evidenceFingerprintSha256 = digest(
    stableMember(result, 'evidenceFingerprintSha256'),
    'UPSTREAM_UNAVAILABLE',
  );
  const deadlineBindingSha256 = digest(
    stableMember(result, 'deadlineBindingSha256'),
    'UPSTREAM_UNAVAILABLE',
  );
  const evidenceRecordedAt = timestamp(
    stableMember(result, 'evidenceRecordedAt'),
    'UPSTREAM_UNAVAILABLE',
  );
  const resolvedAt = timestamp(stableMember(result, 'resolvedAt'), 'UPSTREAM_UNAVAILABLE');
  const producerObservedAt = timestamp(
    stableMember(producerRequest, 'observedAt'),
    'UPSTREAM_UNAVAILABLE',
  );
  if (
    evidenceRecordedAt.milliseconds < producerObservedAt.milliseconds ||
    evidenceRecordedAt.milliseconds > resolvedAt.milliseconds ||
    resolvedAt.milliseconds > now.milliseconds ||
    resolvedAt.milliseconds >= request.deadlineAt.milliseconds
  ) {
    return fail('STALE_PREREQUISITE');
  }
  return Object.freeze({
    result,
    request: request.chainEvidenceRequest,
    recordIntentFingerprintSha256,
    evidenceFingerprintSha256,
    deadlineBindingSha256,
    evidenceRecordedAt,
    resolvedAt,
    networkId,
    chainAnchor,
  });
}

function sameChainEvidence(left: ReviewedChainEvidence, right: ReviewedChainEvidence): boolean {
  return (
    left.result === right.result &&
    left.request === right.request &&
    left.recordIntentFingerprintSha256 === right.recordIntentFingerprintSha256 &&
    left.evidenceFingerprintSha256 === right.evidenceFingerprintSha256 &&
    left.deadlineBindingSha256 === right.deadlineBindingSha256 &&
    left.evidenceRecordedAt.value === right.evidenceRecordedAt.value &&
    left.resolvedAt.value === right.resolvedAt.value &&
    left.networkId === right.networkId &&
    sameAnchor(left.chainAnchor, right.chainAnchor)
  );
}

function reviewedSafety(
  captured: CapturedEffectiveSafety,
  request: ReviewedIssueRequest,
  lifecycle: ReviewedLifecycle,
): ReviewedSafety {
  if (request.effectiveSafetyCapability === null || request.effectiveSafetyRequest === null) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const reviewed = invokeReview(
    captured.review,
    request.effectiveSafetyCapability,
    request.effectiveSafetyRequest,
  );
  if (reviewed !== request.effectiveSafetyCapability) return fail('UPSTREAM_UNAVAILABLE');
  const result = reviewed as DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1;
  if (
    stableMember(result, 'sidecarVersion') !==
      DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION ||
    stableMember(result, 'use') !== DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_RESULT_USE ||
    stableMember(result, 'mayAuthorizeFinancialAction') !== false ||
    stableMember(result, 'mayConstructTransaction') !== false ||
    stableMember(result, 'apiMaySign') !== false ||
    stableMember(result, 'apiMayBroadcast') !== false ||
    stableMember(result, 'mayResendTransaction') !== false ||
    stableMember(result, 'automaticRetryAllowed') !== false ||
    stableMember(result, 'ledgerSettlementAuthority') !== false ||
    stableMember(result, 'outcome') !== 'DATABASE_STATE_CONFIRMED' ||
    stableMember(result, 'operation') !== 'READ_EFFECTIVE_SAFETY_STATE' ||
    stableMember(result, 'databaseRecordOutcome') !== 'READ' ||
    stableMember(result, 'authenticatedReconciliation') !== true ||
    stableMember(result, 'recordedReviewRevision') !== null ||
    stableMember(result, 'recordedReviewFingerprintSha256') !== null ||
    stableMember(result, 'recordedReviewDisposition') !== null ||
    stableMember(result, 'lifecycleStage') !== lifecycle.lifecycleStage ||
    stableMember(result, 'recordedAt') !== null ||
    stableMember(result, 'recoveryMode') !== 'READ_ONLY'
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const effectiveSafetyState = stableMember(result, 'effectiveSafetyState');
  if (
    effectiveSafetyState !== 'AUTHENTICATED_FINALITY_RECORDED' &&
    effectiveSafetyState !== 'POST_FINALITY_REVIEW_INCONCLUSIVE'
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  const cursor = capability(stableMember(result, 'cursor'), 'UPSTREAM_UNAVAILABLE');
  const terminalTransitionFingerprintSha256 = digest(
    stableMember(cursor, 'terminalTransitionFingerprintSha256'),
    'UPSTREAM_UNAVAILABLE',
  );
  const originalAdmissionFingerprintSha256 = digest(
    stableMember(cursor, 'originalAdmissionFingerprintSha256'),
    'UPSTREAM_UNAVAILABLE',
  );
  const terminalTransactionPosition = integer(
    stableMember(cursor, 'transactionPosition'),
    0n,
    MAX_UINT64,
    'UPSTREAM_UNAVAILABLE',
  );
  const terminalTransactionBlockId = chainIdentity(
    lifecycle.networkId,
    stableMember(cursor, 'transactionBlockId'),
    'BLOCK',
    'UPSTREAM_UNAVAILABLE',
  );
  const expectedReviewRevision = integer(
    stableMember(cursor, 'reviewRevision'),
    0n,
    MAX_REVIEW_REVISION,
    'UPSTREAM_UNAVAILABLE',
  );
  const expectedPreviousReviewFingerprintSha256 = nullableDigest(
    stableMember(cursor, 'reviewFingerprintSha256'),
    'UPSTREAM_UNAVAILABLE',
  );
  const latestReviewDisposition = stableMember(result, 'latestReviewDisposition');
  const requiresManualReview = stableMember(result, 'requiresManualReview');
  if (
    stableMember(cursor, 'schemaVersion') !== 1 ||
    stableMember(cursor, 'source') !== 'MIGRATION_0035_DATABASE' ||
    stableMember(cursor, 'fingerprintEncoding') !==
      MAINNET_FINANCIAL_ACTION_EFFECTIVE_SAFETY_CURSOR_ENCODING ||
    stableMember(cursor, 'accountId') !== lifecycle.accountId ||
    stableMember(cursor, 'intentId') !== lifecycle.intentId ||
    stableMember(cursor, 'networkId') !== lifecycle.networkId ||
    stableMember(cursor, 'terminalRevision') !== lifecycle.lifecycleRevision ||
    stableMember(cursor, 'terminalSnapshotSha256') !== lifecycle.lifecycleSnapshotSha256 ||
    stableMember(cursor, 'chainTransactionId') !== lifecycle.transactionId ||
    terminalTransactionPosition !== lifecycle.transactionPosition ||
    terminalTransactionBlockId !== lifecycle.transactionBlockId ||
    (expectedReviewRevision === '0') !== (expectedPreviousReviewFingerprintSha256 === null) ||
    stableMember(result, 'reviewRevision') !== expectedReviewRevision ||
    stableMember(result, 'reviewFingerprintSha256') !== expectedPreviousReviewFingerprintSha256 ||
    (expectedReviewRevision === '0'
      ? latestReviewDisposition !== null ||
        effectiveSafetyState !== 'AUTHENTICATED_FINALITY_RECORDED' ||
        requiresManualReview !== false
      : latestReviewDisposition === 'FINALITY_REAFFIRMED'
        ? effectiveSafetyState !== 'AUTHENTICATED_FINALITY_RECORDED' ||
          requiresManualReview !== false
        : latestReviewDisposition === 'REVIEW_INCONCLUSIVE'
          ? effectiveSafetyState !== 'POST_FINALITY_REVIEW_INCONCLUSIVE' ||
            requiresManualReview !== true
          : true)
  ) {
    return fail('UPSTREAM_UNAVAILABLE');
  }
  return Object.freeze({
    result,
    request: request.effectiveSafetyRequest,
    terminalTransitionFingerprintSha256,
    originalAdmissionFingerprintSha256,
    terminalTransactionPosition,
    terminalTransactionBlockId,
    expectedReviewRevision,
    expectedPreviousReviewFingerprintSha256,
    effectiveSafetyState,
  });
}

function sameSafety(left: ReviewedSafety, right: ReviewedSafety): boolean {
  return (
    left.result === right.result &&
    left.request === right.request &&
    left.terminalTransitionFingerprintSha256 === right.terminalTransitionFingerprintSha256 &&
    left.originalAdmissionFingerprintSha256 === right.originalAdmissionFingerprintSha256 &&
    left.terminalTransactionPosition === right.terminalTransactionPosition &&
    left.terminalTransactionBlockId === right.terminalTransactionBlockId &&
    left.expectedReviewRevision === right.expectedReviewRevision &&
    left.expectedPreviousReviewFingerprintSha256 ===
      right.expectedPreviousReviewFingerprintSha256 &&
    left.effectiveSafetyState === right.effectiveSafetyState
  );
}

function requireSafety(value: ReviewedSafety | null): ReviewedSafety {
  return value ?? fail('UPSTREAM_UNAVAILABLE');
}

function decodedRow(
  value: unknown,
  request: ReviewedIssueRequest,
  lifecycle: ReviewedLifecycle,
  chainEvidence: ReviewedChainEvidence,
  safety: ReviewedSafety | null,
  now: CanonicalTime,
): DecodedRow {
  const row = rows(value)[0];
  const accountId = uuid(row.account_id, 'INVALID_DATABASE_RESULT');
  const intentId = uuid(row.intent_id, 'INVALID_DATABASE_RESULT');
  const intentRecordFingerprintSha256 = digest(
    row.intent_record_fingerprint_sha256,
    'INVALID_DATABASE_RESULT',
  );
  const walletRegistrationId = uuid(row.wallet_registration_id, 'INVALID_DATABASE_RESULT');
  const walletIdentityDigestVersion = numberInteger(
    row.wallet_identity_digest_version,
    1,
    32_767,
    'INVALID_DATABASE_RESULT',
  );
  const walletIdentityDigestHex = digest(row.wallet_identity_digest_hex, 'INVALID_DATABASE_RESULT');
  const networkId = network(row.network_id, 'INVALID_DATABASE_RESULT');
  const lifecycleRevision = integer(
    row.lifecycle_revision,
    request.purpose === 'RECONCILIATION_ADMISSION' ? 2n : 3n,
    MAX_INT64,
    'INVALID_DATABASE_RESULT',
  );
  const lifecycleSnapshotSha256 = digest(row.lifecycle_snapshot_sha256, 'INVALID_DATABASE_RESULT');
  const lifecycleStage = row.lifecycle_stage;
  const expectedStage =
    request.purpose === 'RECONCILIATION_ADMISSION'
      ? lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND' ||
        lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS' ||
        lifecycleStage === 'RECONCILIATION_AMBIGUOUS'
      : lifecycleStage === 'FINALIZED_SUCCESS' || lifecycleStage === 'FINALIZED_FAILURE';
  if (!expectedStage) return fail('INVALID_DATABASE_RESULT');
  const transactionId = chainIdentity(
    networkId,
    row.transaction_id,
    'TRANSACTION',
    'INVALID_DATABASE_RESULT',
  );
  const walletSignedPayloadSha256 = digest(
    row.wallet_signed_payload_sha256,
    'INVALID_DATABASE_RESULT',
  );
  const walletSignatureEvidenceSha256 = digest(
    row.wallet_signature_evidence_sha256,
    'INVALID_DATABASE_RESULT',
  );
  const chainAnchorEvidenceFingerprintSha256 = digest(
    row.chain_anchor_evidence_fingerprint_sha256,
    'INVALID_DATABASE_RESULT',
  );
  const chainAnchor = anchor(row.chain_anchor_json, networkId);
  const agreedFinalizedHead = anchor(row.agreed_finalized_head_json, networkId);
  const chainAnchorEvidenceExpiresAt = timestamp(
    row.chain_anchor_evidence_expires_at,
    'INVALID_DATABASE_RESULT',
  );
  const sourceAuthorityId = uuid(row.source_authority_id, 'INVALID_DATABASE_RESULT');
  const sourceAuthorityFingerprintSha256 = digest(
    row.source_authority_fingerprint_sha256,
    'INVALID_DATABASE_RESULT',
  );
  const sourceAuthorityExpiresAt = timestamp(
    row.source_authority_expires_at,
    'INVALID_DATABASE_RESULT',
  );
  const sourcePairApprovalId = approvalId(row.source_pair_approval_id, 'INVALID_DATABASE_RESULT');
  const sourcePairRegistryFingerprintSha256 = digest(
    row.source_pair_registry_fingerprint_sha256,
    'INVALID_DATABASE_RESULT',
  );
  const primarySourceFamilyId = sourceId(row.primary_source_family_id, 'INVALID_DATABASE_RESULT');
  const primarySourceId = sourceId(row.primary_source_id, 'INVALID_DATABASE_RESULT');
  const primarySourceKind = sourceKind(row.primary_source_kind, 'INVALID_DATABASE_RESULT');
  const corroboratingSourceFamilyId = sourceId(
    row.corroborating_source_family_id,
    'INVALID_DATABASE_RESULT',
  );
  const corroboratingSourceId = sourceId(row.corroborating_source_id, 'INVALID_DATABASE_RESULT');
  const corroboratingSourceKind = sourceKind(
    row.corroborating_source_kind,
    'INVALID_DATABASE_RESULT',
  );
  const deploymentAuthorityId = uuid(row.deployment_authority_id, 'INVALID_DATABASE_RESULT');
  const deploymentAuthorityFingerprintSha256 = digest(
    row.deployment_authority_fingerprint_sha256,
    'INVALID_DATABASE_RESULT',
  );
  const deploymentAuthorityExpiresAt = timestamp(
    row.deployment_authority_expires_at,
    'INVALID_DATABASE_RESULT',
  );
  const deploymentProofs = [
    digest(row.primary_deployment_manifest_fingerprint_sha256, 'INVALID_DATABASE_RESULT'),
    digest(row.primary_observed_identity_fingerprint_sha256, 'INVALID_DATABASE_RESULT'),
    digest(row.corroborating_deployment_manifest_fingerprint_sha256, 'INVALID_DATABASE_RESULT'),
    digest(row.corroborating_observed_identity_fingerprint_sha256, 'INVALID_DATABASE_RESULT'),
  ] as const;
  const provider = MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES.find(
    (candidate) =>
      candidate.networkId === networkId &&
      candidate.providerId === row.provider_id &&
      candidate.protocolId === row.protocol_id,
  );
  if (provider === undefined) return fail('INVALID_DATABASE_RESULT');
  const marketId = transactionMarket(networkId, row.market_id);
  const assetRegistryVersion = numberInteger(
    row.asset_registry_version,
    1,
    Number.MAX_SAFE_INTEGER,
    'INVALID_DATABASE_RESULT',
  );
  const assetRegistry = MAINNET_SUPPORTED_ASSET_REGISTRY.atVersion(assetRegistryVersion);
  if (
    assetRegistry === undefined ||
    assetRegistry.environment !== 'MAINNET' ||
    assetRegistry.fingerprintSha256 !== row.asset_registry_fingerprint_sha256 ||
    typeof row.asset_identity !== 'string'
  ) {
    return fail('INVALID_DATABASE_RESULT');
  }
  const asset = assetRegistry.identifyAsset(networkId, row.asset_identity);
  if (
    asset === undefined ||
    asset.activationState !== 'ACTIVE' ||
    asset.stablecoin !== row.asset_symbol ||
    asset.decimals !== row.asset_decimals
  ) {
    return fail('INVALID_DATABASE_RESULT');
  }
  const action = row.action_type;
  if (action !== 'SUPPLY' && action !== 'WITHDRAW') return fail('INVALID_DATABASE_RESULT');
  const amountAtomic = integer(row.amount_atomic, 1n, MAX_UINT256, 'INVALID_DATABASE_RESULT');
  const verifiedAt = timestamp(row.verified_at, 'INVALID_DATABASE_RESULT');

  const producerRequest = capability(
    stableMember(request.chainEvidenceRequest, 'producerRequest'),
    'UPSTREAM_UNAVAILABLE',
  );
  if (
    accountId !== lifecycle.accountId ||
    intentId !== lifecycle.intentId ||
    networkId !== lifecycle.networkId ||
    networkId !== chainEvidence.networkId ||
    lifecycleRevision !== lifecycle.lifecycleRevision ||
    lifecycleSnapshotSha256 !== lifecycle.lifecycleSnapshotSha256 ||
    intentRecordFingerprintSha256 !== lifecycle.intentRecordFingerprintSha256 ||
    lifecycleStage !== lifecycle.lifecycleStage ||
    transactionId !== lifecycle.transactionId ||
    chainAnchorEvidenceFingerprintSha256 !== chainEvidence.evidenceFingerprintSha256 ||
    !sameAnchor(chainAnchor, chainEvidence.chainAnchor) ||
    !(
      (stableMember(producerRequest, 'sourceFamilyId') === primarySourceFamilyId &&
        stableMember(producerRequest, 'sourceId') === primarySourceId &&
        stableMember(producerRequest, 'sourceKind') === primarySourceKind) ||
      (stableMember(producerRequest, 'sourceFamilyId') === corroboratingSourceFamilyId &&
        stableMember(producerRequest, 'sourceId') === corroboratingSourceId &&
        stableMember(producerRequest, 'sourceKind') === corroboratingSourceKind)
    ) ||
    primarySourceFamilyId === corroboratingSourceFamilyId ||
    primarySourceId === corroboratingSourceId ||
    new Set(deploymentProofs).size !== deploymentProofs.length ||
    walletSignedPayloadSha256 === walletSignatureEvidenceSha256 ||
    verifiedAt.milliseconds > now.milliseconds ||
    verifiedAt.milliseconds >= request.deadlineAt.milliseconds ||
    chainAnchorEvidenceExpiresAt.milliseconds <= now.milliseconds ||
    sourceAuthorityExpiresAt.milliseconds <= now.milliseconds ||
    deploymentAuthorityExpiresAt.milliseconds <= now.milliseconds
  ) {
    return fail('INVALID_DATABASE_RESULT');
  }
  const reviewValues = {
    terminalTransitionFingerprintSha256: nullableDigest(
      row.terminal_transition_fingerprint_sha256,
      'INVALID_DATABASE_RESULT',
    ),
    originalAdmissionFingerprintSha256: nullableDigest(
      row.original_admission_fingerprint_sha256,
      'INVALID_DATABASE_RESULT',
    ),
    terminalTransactionPosition:
      row.terminal_transaction_position === null
        ? null
        : integer(row.terminal_transaction_position, 0n, MAX_UINT64, 'INVALID_DATABASE_RESULT'),
    terminalTransactionBlockId:
      row.terminal_transaction_block_id === null
        ? null
        : chainIdentity(
            networkId,
            row.terminal_transaction_block_id,
            'BLOCK',
            'INVALID_DATABASE_RESULT',
          ),
    expectedReviewRevision:
      row.expected_review_revision === null
        ? null
        : integer(row.expected_review_revision, 0n, MAX_REVIEW_REVISION, 'INVALID_DATABASE_RESULT'),
    expectedPreviousReviewFingerprintSha256: nullableDigest(
      row.expected_previous_review_fingerprint_sha256,
      'INVALID_DATABASE_RESULT',
    ),
    effectiveSafetyState:
      row.effective_safety_state === null
        ? null
        : row.effective_safety_state === 'AUTHENTICATED_FINALITY_RECORDED' ||
            row.effective_safety_state === 'POST_FINALITY_REVIEW_INCONCLUSIVE'
          ? row.effective_safety_state
          : fail('INVALID_DATABASE_RESULT'),
  } as const;
  if (request.purpose === 'RECONCILIATION_ADMISSION') {
    if (Object.values(reviewValues).some((item) => item !== null) || safety !== null) {
      return fail('INVALID_DATABASE_RESULT');
    }
  } else if (
    safety === null ||
    reviewValues.terminalTransitionFingerprintSha256 !==
      safety.terminalTransitionFingerprintSha256 ||
    reviewValues.originalAdmissionFingerprintSha256 !== safety.originalAdmissionFingerprintSha256 ||
    reviewValues.terminalTransactionPosition !== safety.terminalTransactionPosition ||
    reviewValues.terminalTransactionBlockId !== safety.terminalTransactionBlockId ||
    reviewValues.expectedReviewRevision !== safety.expectedReviewRevision ||
    reviewValues.expectedPreviousReviewFingerprintSha256 !==
      safety.expectedPreviousReviewFingerprintSha256 ||
    reviewValues.effectiveSafetyState !== safety.effectiveSafetyState
  ) {
    return fail('INVALID_DATABASE_RESULT');
  }

  const walletRequest = nullRecord({
    readerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
    use: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    accountId,
    intentId,
    walletRegistrationId,
    networkId,
    walletIdentityDigestVersion,
    walletIdentityDigestHex,
    lifecycleRevision,
    lifecycleSnapshotSha256,
    lifecycleStage: lifecycle.lifecycleStage,
    purpose: request.purpose,
    deadlineAt: request.deadlineAt.value,
    signal: request.signal,
  });
  const prerequisite = nullRecord({
    prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    accountId,
    intentId,
    intentRecordFingerprintSha256,
    walletRegistrationId,
    networkId,
    lifecycleRevision,
    lifecycleSnapshotSha256,
    transactionId,
    walletSignedPayloadSha256,
    walletSignatureEvidenceSha256,
    chainAnchorEvidenceFingerprintSha256,
    chainAnchor,
    agreedFinalizedHead,
    chainAnchorEvidenceExpiresAt: chainAnchorEvidenceExpiresAt.value,
    sourceAuthorityId,
    sourceAuthorityFingerprintSha256,
    sourceAuthorityExpiresAt: sourceAuthorityExpiresAt.value,
    sourcePairApprovalId,
    sourcePairRegistryFingerprintSha256,
    primarySourceFamilyId,
    primarySourceId,
    primarySourceKind,
    corroboratingSourceFamilyId,
    corroboratingSourceId,
    corroboratingSourceKind,
    deploymentAuthorityId,
    deploymentAuthorityFingerprintSha256,
    deploymentAuthorityExpiresAt: deploymentAuthorityExpiresAt.value,
    primaryDeploymentManifestFingerprintSha256: deploymentProofs[0],
    primaryObservedIdentityFingerprintSha256: deploymentProofs[1],
    corroboratingDeploymentManifestFingerprintSha256: deploymentProofs[2],
    corroboratingObservedIdentityFingerprintSha256: deploymentProofs[3],
    providerId: provider.providerId,
    protocolId: provider.protocolId,
    marketId,
    assetRegistryVersion,
    assetRegistryFingerprintSha256: assetRegistry.fingerprintSha256,
    assetSymbol: asset.stablecoin,
    assetIdentity: asset.identity,
    assetDecimals: asset.decimals,
    action,
    amountAtomic,
    correlationId: request.correlationId,
    verifiedAt: verifiedAt.value,
    deadlineAt: request.deadlineAt.value,
    signal: request.signal,
    lifecycleStage: lifecycle.lifecycleStage,
  }) as DecodedRow['prerequisite'];
  return Object.freeze({ prerequisite, walletRequest, ...reviewValues, verifiedAt });
}

function walletResult(
  value: unknown,
  request: ReadMainnetFinancialActionFinalityWalletRequestV2,
): MainnetFinancialActionFinalityWalletResultV2 & { readonly walletAddress: WalletAddress } {
  try {
    const fields = exactFrozenDataRecord(value, WALLET_RESULT_KEYS, 'WALLET_UNAVAILABLE');
    const reviewed = value as MainnetFinancialActionFinalityWalletResultV2;
    if (
      fields.readerVersion !== MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION ||
      fields.use !== MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE ||
      fields.mayAuthorizeFinancialAction !== false ||
      fields.mayPersist !== false ||
      fields.accountId !== request.accountId ||
      fields.intentId !== request.intentId ||
      fields.walletRegistrationId !== request.walletRegistrationId ||
      fields.networkId !== request.networkId ||
      fields.walletIdentityDigestVersion !== request.walletIdentityDigestVersion ||
      fields.walletIdentityDigestHex !== request.walletIdentityDigestHex ||
      fields.lifecycleRevision !== request.lifecycleRevision ||
      fields.lifecycleSnapshotSha256 !== request.lifecycleSnapshotSha256 ||
      fields.lifecycleStage !== request.lifecycleStage ||
      fields.purpose !== request.purpose ||
      (fields.walletStatus !== 'ACTIVE' && fields.walletStatus !== 'REVOKED')
    ) {
      return fail('WALLET_UNAVAILABLE');
    }
    const revokedAt =
      fields.revokedAt === null ? null : timestamp(fields.revokedAt, 'WALLET_UNAVAILABLE');
    const verifiedAt = timestamp(fields.verifiedAt, 'WALLET_UNAVAILABLE');
    if (
      (fields.walletStatus === 'ACTIVE') !== (revokedAt === null) ||
      verifiedAt.milliseconds >= timestamp(request.deadlineAt, 'WALLET_UNAVAILABLE').milliseconds ||
      (revokedAt !== null && revokedAt.milliseconds > verifiedAt.milliseconds)
    ) {
      return fail('WALLET_UNAVAILABLE');
    }
    const walletAddress = parseWalletAddress(request.networkId, fields.walletAddress);
    if (walletAddress !== fields.walletAddress) return fail('WALLET_UNAVAILABLE');
    return reviewed as MainnetFinancialActionFinalityWalletResultV2 & {
      readonly walletAddress: WalletAddress;
    };
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityPrerequisiteUnavailableError) {
      throw error;
    }
    return fail('WALLET_UNAVAILABLE');
  }
}

function sameWallet(
  left: MainnetFinancialActionFinalityWalletResultV2,
  right: MainnetFinancialActionFinalityWalletResultV2,
): boolean {
  return (
    left === right &&
    left.accountId === right.accountId &&
    left.intentId === right.intentId &&
    left.walletRegistrationId === right.walletRegistrationId &&
    left.networkId === right.networkId &&
    left.walletIdentityDigestVersion === right.walletIdentityDigestVersion &&
    left.walletIdentityDigestHex === right.walletIdentityDigestHex &&
    left.lifecycleRevision === right.lifecycleRevision &&
    left.lifecycleSnapshotSha256 === right.lifecycleSnapshotSha256 &&
    left.lifecycleStage === right.lifecycleStage &&
    left.purpose === right.purpose &&
    left.walletStatus === right.walletStatus &&
    left.revokedAt === right.revokedAt &&
    left.verifiedAt === right.verifiedAt &&
    left.walletAddress === right.walletAddress
  );
}

/**
 * Direct-import-only reader for migration 0038's owner-only functions.
 * Construction captures every boundary without performing I/O. Each issue
 * method performs exactly one fixed prerequisite SQL query and one separately
 * authenticated signed-bound recovery-wallet read, with one caller-owned AbortSignal and no
 * retry. The two reads are deliberately not described as atomic. Wallet
 * absence or invalid historical revocation ordering fails issuance and the
 * resulting capability is short-lived; migration 0038 revalidates lifecycle,
 * evidence, authorities, and the signed-event/revocation ordering atomically.
 */
export class PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter
  implements
    MainnetFinancialActionFinalityPrerequisiteIssuerPort,
    MainnetFinancialActionFinalityEvidencePrerequisitePort
{
  readonly issuerVersion = MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION;
  readonly prerequisiteVersion = MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION;

  readonly #lifecycle: CapturedLifecycle;
  readonly #chainEvidence: CapturedChainEvidence;
  readonly #effectiveSafety: CapturedEffectiveSafety;
  readonly #wallet: CapturedWallet;
  readonly #databaseQuery: CapturedMethod<QueryWithCancellation>;
  readonly #clockNow: CapturedMethod<MainnetFinancialActionFinalityPrerequisiteIssuerClock['now']>;
  readonly #issuances = new WeakMap<object, IssuedPrerequisite>();
  readonly #prerequisites = new WeakMap<object, IssuedPrerequisite>();
  readonly #spentRequests = new WeakSet<object>();

  constructor(
    lifecycle: DormantMainnetFinancialActionLifecycleDurablePort,
    chainEvidence: ProviderPositionChainAnchorEvidenceRecorderPort,
    effectiveSafety: DormantMainnetFinancialActionEffectiveSafetyReaderPort,
    wallet: MainnetFinancialActionFinalityWalletReaderPort,
    postgres: PostgresService,
    clock: MainnetFinancialActionFinalityPrerequisiteIssuerClock,
  ) {
    this.#lifecycle = Object.freeze({
      review: captureMethod<DormantMainnetFinancialActionLifecycleDurablePort['reviewResult']>(
        lifecycle,
        'reviewResult',
        'durableLifecycleVersion',
        DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
      ),
    });
    this.#chainEvidence = Object.freeze({
      review: captureMethod<ProviderPositionChainAnchorEvidenceRecorderPort['reviewResult']>(
        chainEvidence,
        'reviewResult',
        'recorderVersion',
        PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
      ),
    });
    this.#effectiveSafety = Object.freeze({
      review: captureMethod<DormantMainnetFinancialActionEffectiveSafetyReaderPort['reviewResult']>(
        effectiveSafety,
        'reviewResult',
        'sidecarVersion',
        DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_VERSION,
      ),
    });
    this.#wallet = Object.freeze({
      read: captureMethod<MainnetFinancialActionFinalityWalletReaderPort['readWallet']>(
        wallet,
        'readWallet',
        'readerVersion',
        MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
      ),
      verify: captureMethod<MainnetFinancialActionFinalityWalletReaderPort['verifyWallet']>(
        wallet,
        'verifyWallet',
        'readerVersion',
        MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
      ),
    });
    this.#databaseQuery = plainMethod(postgres, 'queryWithCancellation');
    this.#clockNow = plainMethod(clock, 'now');
  }

  issueReconciliationPrerequisite(
    request: IssueMainnetFinancialActionReconciliationPrerequisiteRequestV1,
  ): Promise<unknown> {
    return this.#issue(request, 'RECONCILIATION_ADMISSION');
  }

  issuePostFinalityPrerequisite(
    request: IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  ): Promise<unknown> {
    return this.#issue(request, 'POST_FINALITY_REVIEW');
  }

  reviewIssuance(
    capabilityInput: unknown,
    request: IssueMainnetFinancialActionFinalityPrerequisiteRequestV1,
  ): MainnetFinancialActionFinalityPrerequisiteIssuanceV1 | null {
    try {
      const reviewedCapability = capability(capabilityInput, 'INVALID_REQUEST');
      const issued = this.#issuances.get(reviewedCapability);
      const now = clockTimeFrom(this.#clockNow);
      return issued?.request === request &&
        issued.issuance === reviewedCapability &&
        !aborted(issued.signal) &&
        now.milliseconds >= issued.issuedAtMilliseconds &&
        now.milliseconds < issued.deadlineAtMilliseconds &&
        now.milliseconds < issued.authorityExpiresAtMilliseconds
        ? issued.issuance
        : null;
    } catch {
      return null;
    }
  }

  reviewReconciliationPrerequisite(
    capabilityInput: unknown,
    request: ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1,
  ): MainnetFinancialActionReconciliationEvidencePrerequisiteV1 | null {
    return this.#reviewPrerequisite(
      capabilityInput,
      request,
      'RECONCILIATION_ADMISSION',
    ) as MainnetFinancialActionReconciliationEvidencePrerequisiteV1 | null;
  }

  reviewPostFinalityPrerequisite(
    capabilityInput: unknown,
    request: ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  ): MainnetFinancialActionPostFinalityEvidencePrerequisiteV1 | null {
    return this.#reviewPrerequisite(
      capabilityInput,
      request,
      'POST_FINALITY_REVIEW',
    ) as MainnetFinancialActionPostFinalityEvidencePrerequisiteV1 | null;
  }

  #reviewPrerequisite(
    capabilityInput: unknown,
    request: ReviewRequest,
    purpose: Purpose,
  ): Prerequisite | null {
    try {
      const reviewedCapability = capability(capabilityInput, 'INVALID_REQUEST');
      const issued = this.#prerequisites.get(reviewedCapability);
      const now = clockTimeFrom(this.#clockNow);
      return issued?.reviewRequest === request &&
        issued.prerequisiteCapability === reviewedCapability &&
        issued.prerequisite.purpose === purpose &&
        issued.signal === request.signal &&
        !aborted(issued.signal) &&
        now.milliseconds >= issued.issuedAtMilliseconds &&
        now.milliseconds < issued.deadlineAtMilliseconds &&
        now.milliseconds < issued.authorityExpiresAtMilliseconds
        ? issued.prerequisite
        : null;
    } catch {
      return null;
    }
  }

  async #issue(
    requestInput: IssueMainnetFinancialActionFinalityPrerequisiteRequestV1,
    purpose: Purpose,
  ): Promise<unknown> {
    const startedAt = clockTimeFrom(this.#clockNow);
    const request = reviewedIssueRequest(requestInput, startedAt, purpose);
    const firstLifecycle = reviewedLifecycle(this.#lifecycle, request);
    const firstChainEvidence = reviewedChainEvidence(this.#chainEvidence, request, startedAt);
    if (firstLifecycle.networkId !== firstChainEvidence.networkId) {
      return fail('UPSTREAM_UNAVAILABLE');
    }
    const firstSafety =
      purpose === 'POST_FINALITY_REVIEW'
        ? reviewedSafety(this.#effectiveSafety, request, firstLifecycle)
        : null;
    if (this.#spentRequests.has(request.request) || aborted(request.signal)) {
      return fail('STALE_PREREQUISITE');
    }
    // One-shot before dispatch prevents concurrent duplicate snapshot reads.
    // Database ambiguity also requires a new server-owned request identity.
    this.#spentRequests.add(request.request);

    const sql =
      purpose === 'RECONCILIATION_ADMISSION'
        ? MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_READ_SQL
        : MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_READ_SQL;
    const values =
      purpose === 'RECONCILIATION_ADMISSION'
        ? Object.freeze([
            firstLifecycle.accountId,
            firstLifecycle.intentId,
            firstLifecycle.lifecycleRevision,
            firstLifecycle.lifecycleSnapshotSha256,
            firstChainEvidence.evidenceFingerprintSha256,
            request.deadlineAt.value,
          ])
        : Object.freeze([
            firstLifecycle.accountId,
            firstLifecycle.intentId,
            firstLifecycle.lifecycleRevision,
            firstLifecycle.lifecycleSnapshotSha256,
            firstChainEvidence.evidenceFingerprintSha256,
            requireSafety(firstSafety).terminalTransitionFingerprintSha256,
            requireSafety(firstSafety).originalAdmissionFingerprintSha256,
            requireSafety(firstSafety).expectedReviewRevision,
            requireSafety(firstSafety).expectedPreviousReviewFingerprintSha256,
            requireSafety(firstSafety).effectiveSafetyState,
            request.deadlineAt.value,
          ]);
    let pending: unknown;
    try {
      pending = Reflect.apply(this.#databaseQuery.method, this.#databaseQuery.receiver, [
        sql,
        values,
        request.signal,
      ]);
    } catch {
      return fail('DATABASE_UNAVAILABLE');
    }
    const promise = nativePromise(pending);
    if (promise === null) return fail('DATABASE_UNAVAILABLE');
    let queryResult: unknown;
    try {
      queryResult = await promise;
    } catch {
      if (aborted(request.signal)) return fail('STALE_PREREQUISITE');
      return fail('DATABASE_UNAVAILABLE');
    }
    const afterDatabase = clockTimeFrom(this.#clockNow);
    if (
      aborted(request.signal) ||
      afterDatabase.milliseconds < startedAt.milliseconds ||
      afterDatabase.milliseconds >= request.deadlineAt.milliseconds
    ) {
      return fail('STALE_PREREQUISITE');
    }
    const decoded = decodedRow(
      queryResult,
      request,
      firstLifecycle,
      firstChainEvidence,
      firstSafety,
      afterDatabase,
    );

    let walletCapability: unknown;
    try {
      walletCapability = Reflect.apply(this.#wallet.read.method, this.#wallet.read.receiver, [
        decoded.walletRequest,
      ]);
    } catch {
      return failWalletRead(
        this.#clockNow,
        request.signal,
        afterDatabase.milliseconds,
        request.deadlineAt.milliseconds,
      );
    }
    const walletPromise = nativePromise(walletCapability);
    if (walletPromise === null) {
      return failWalletRead(
        this.#clockNow,
        request.signal,
        afterDatabase.milliseconds,
        request.deadlineAt.milliseconds,
      );
    }
    let opaqueWallet: unknown;
    try {
      opaqueWallet = await walletPromise;
    } catch {
      return failWalletRead(
        this.#clockNow,
        request.signal,
        afterDatabase.milliseconds,
        request.deadlineAt.milliseconds,
      );
    }
    let walletOpaqueObject: object;
    let firstWalletValue: unknown;
    let firstWallet: MainnetFinancialActionFinalityWalletResultV2 & {
      readonly walletAddress: WalletAddress;
    };
    try {
      walletOpaqueObject = capability(opaqueWallet, 'WALLET_UNAVAILABLE');
      firstWalletValue = Reflect.apply(this.#wallet.verify.method, this.#wallet.verify.receiver, [
        walletOpaqueObject,
        decoded.walletRequest,
      ]);
      firstWallet = walletResult(firstWalletValue, decoded.walletRequest);
    } catch {
      return failWalletRead(
        this.#clockNow,
        request.signal,
        afterDatabase.milliseconds,
        request.deadlineAt.milliseconds,
      );
    }

    const finalNow = clockTimeFrom(this.#clockNow);
    const repeatedRequest = reviewedIssueRequest(requestInput, finalNow, purpose);
    const secondLifecycle = reviewedLifecycle(this.#lifecycle, repeatedRequest);
    const secondChainEvidence = reviewedChainEvidence(
      this.#chainEvidence,
      repeatedRequest,
      finalNow,
    );
    const secondSafety =
      purpose === 'POST_FINALITY_REVIEW'
        ? reviewedSafety(this.#effectiveSafety, repeatedRequest, secondLifecycle)
        : null;
    let secondWallet: MainnetFinancialActionFinalityWalletResultV2 & {
      readonly walletAddress: WalletAddress;
    };
    try {
      const secondWalletValue = Reflect.apply(
        this.#wallet.verify.method,
        this.#wallet.verify.receiver,
        [walletOpaqueObject, decoded.walletRequest],
      );
      secondWallet = walletResult(secondWalletValue, decoded.walletRequest);
    } catch {
      return failWalletRead(
        this.#clockNow,
        request.signal,
        finalNow.milliseconds,
        request.deadlineAt.milliseconds,
      );
    }
    if (
      !sameReviewedIssue(request, repeatedRequest) ||
      !sameLifecycle(firstLifecycle, secondLifecycle) ||
      !sameChainEvidence(firstChainEvidence, secondChainEvidence) ||
      (firstSafety === null
        ? secondSafety !== null
        : secondSafety === null || !sameSafety(firstSafety, secondSafety)) ||
      !sameWallet(firstWallet, secondWallet) ||
      aborted(request.signal) ||
      finalNow.milliseconds < afterDatabase.milliseconds ||
      finalNow.milliseconds >= request.deadlineAt.milliseconds
    ) {
      return fail('STALE_PREREQUISITE');
    }

    const prerequisite =
      purpose === 'RECONCILIATION_ADMISSION'
        ? nullRecord({
            ...decoded.prerequisite,
            use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE,
            purpose: 'RECONCILIATION_ADMISSION' as const,
            lifecycleStage: firstLifecycle.lifecycleStage as
              'BROADCAST_OUTCOME_AMBIGUOUS' | 'RECONCILIATION_AMBIGUOUS',
            observationId: request.operationId,
            walletAddress: firstWallet.walletAddress,
          })
        : nullRecord({
            ...decoded.prerequisite,
            use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE,
            purpose: 'POST_FINALITY_REVIEW' as const,
            lifecycleStage: firstLifecycle.lifecycleStage as
              'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE',
            terminalTransitionFingerprintSha256:
              requireSafety(firstSafety).terminalTransitionFingerprintSha256,
            originalAdmissionFingerprintSha256:
              requireSafety(firstSafety).originalAdmissionFingerprintSha256,
            terminalTransactionPosition: requireSafety(firstSafety).terminalTransactionPosition,
            terminalTransactionBlockId: requireSafety(firstSafety).terminalTransactionBlockId,
            expectedReviewRevision: requireSafety(firstSafety).expectedReviewRevision,
            expectedPreviousReviewFingerprintSha256:
              requireSafety(firstSafety).expectedPreviousReviewFingerprintSha256,
            effectiveSafetyState: requireSafety(firstSafety).effectiveSafetyState,
            reviewId: request.operationId,
            walletAddress: firstWallet.walletAddress,
          });
    const reviewRequest =
      purpose === 'RECONCILIATION_ADMISSION'
        ? nullRecord({
            prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
            use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE,
            purpose: 'RECONCILIATION_ADMISSION' as const,
            mayAuthorizeFinancialAction: false as const,
            mayPersist: false as const,
            signal: request.signal,
          })
        : nullRecord({
            prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
            use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE,
            purpose: 'POST_FINALITY_REVIEW' as const,
            mayAuthorizeFinancialAction: false as const,
            mayPersist: false as const,
            signal: request.signal,
          });
    const prerequisiteCapability = nullRecord({});
    const issuance = nullRecord({
      issuerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION,
      use: MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUANCE_USE,
      purpose,
      mayAuthorizeFinancialAction: false as const,
      mayPersist: false as const,
      prerequisiteCapability,
      prerequisiteRequest: reviewRequest,
    }) as MainnetFinancialActionFinalityPrerequisiteIssuanceV1;
    const authorityExpiresAtMilliseconds = Math.min(
      timestamp(prerequisite.chainAnchorEvidenceExpiresAt, 'INVALID_DATABASE_RESULT').milliseconds,
      timestamp(prerequisite.sourceAuthorityExpiresAt, 'INVALID_DATABASE_RESULT').milliseconds,
      timestamp(prerequisite.deploymentAuthorityExpiresAt, 'INVALID_DATABASE_RESULT').milliseconds,
    );
    if (authorityExpiresAtMilliseconds <= finalNow.milliseconds) {
      return fail('STALE_PREREQUISITE');
    }
    const issued = Object.freeze({
      request: request.request,
      issuance,
      prerequisiteCapability,
      reviewRequest,
      prerequisite: prerequisite as Prerequisite,
      signal: request.signal,
      issuedAtMilliseconds: finalNow.milliseconds,
      deadlineAtMilliseconds: request.deadlineAt.milliseconds,
      authorityExpiresAtMilliseconds,
    });
    this.#issuances.set(issuance, issued);
    this.#prerequisites.set(prerequisiteCapability, issued);
    return issuance;
  }
}
