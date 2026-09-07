import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { formatWalletAccountId } from '../../wallets/domain/wallet-identity';
import {
  parseDormantMainnetFinancialActionIntent,
  type DormantMainnetFinancialActionIntentInputV1,
  type DormantMainnetFinancialActionIntentV1,
} from './dormant-mainnet-financial-action';

export const DORMANT_MAINNET_FINANCIAL_ACTION_LIFECYCLE_SCHEMA_VERSION = 1 as const;

const ETHEREUM_MAINNET = 'eip155:1' as const;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const EVM_HASH_PATTERN = /^0x[0-9a-f]{64}$/u;
const CANONICAL_UINT_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const CANONICAL_TIMESTAMP_PATTERN =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const UINT64_MAX = (1n << 64n) - 1n;

const ZERO_AUTHORITY = Object.freeze({
  operationalMode: 'DORMANT' as const,
  mayAuthorizeFinancialAction: false as const,
  mayBuildTransaction: false as const,
  maySignTransaction: false as const,
  mayBroadcastTransaction: false as const,
  mayAutomaticallyResubmit: false as const,
  mayEscalateNetworkFee: false as const,
  signingResponsibility: 'USER_WALLET_ONLY' as const,
  broadcastResponsibility: 'USER_WALLET_ONLY' as const,
});

const VOLATILE_DURABILITY = Object.freeze({
  kind: 'VOLATILE_IN_PROCESS_ONLY' as const,
  durable: false as const,
  mayClaimReplayProtectionAfterRestart: false as const,
  persistenceAuthority: false as const,
});

export type DormantMainnetFinancialActionLifecycleStage =
  | 'PREPARED'
  | 'WALLET_SIGNED_SUBMISSION_BOUND'
  | 'BROADCAST_OUTCOME_AMBIGUOUS'
  | 'RECONCILIATION_AMBIGUOUS'
  | 'FINALIZED_SUCCESS'
  | 'FINALIZED_FAILURE'
  | 'REORG_QUARANTINED';

export type DormantMainnetFinancialActionLifecycleErrorCode =
  | 'INVALID_SUBMISSION_INPUT'
  | 'INVALID_BROADCAST_OBSERVATION_INPUT'
  | 'INVALID_RECONCILIATION_OBSERVATION_INPUT'
  | 'INVALID_SERVER_TIME'
  | 'INTENT_NOT_FOUND'
  | 'INTENT_CONFLICT'
  | 'IDEMPOTENCY_REPLAY_CONFLICT'
  | 'REPLAY_PROTECTION_CONFLICT'
  | 'EVIDENCE_DIGEST_CONFLICT'
  | 'INTENT_EXPIRED'
  | 'INVALID_LIFECYCLE_TRANSITION'
  | 'TRANSACTION_IDENTITY_CONFLICT'
  | 'ONE_SHOT_BROADCAST_ALREADY_RECORDED'
  | 'OBSERVATION_REPLAY_CONFLICT'
  | 'NON_MONOTONIC_RECONCILIATION'
  | 'TERMINAL_RECONCILIATION';

export class DormantMainnetFinancialActionLifecycleError extends Error {
  constructor(readonly code: DormantMainnetFinancialActionLifecycleErrorCode) {
    super(code);
    this.name = 'DormantMainnetFinancialActionLifecycleError';
  }
}

export interface DormantMainnetWalletSignedSubmissionInputV1 {
  readonly schemaVersion: 1;
  readonly intentId: string;
  readonly intentFingerprintSha256: string;
  readonly networkId: string;
  readonly signerWalletAccountId: string;
  readonly transactionId: string;
  readonly walletSignedPayloadSha256: string;
  readonly walletSignatureEvidenceSha256: string;
  readonly signedAt: string;
}

export type DormantMainnetWalletBroadcastOutcome =
  'WALLET_REPORTED_SUBMITTED' | 'WALLET_REPORTED_AMBIGUOUS' | 'WALLET_REPORTED_REJECTED';

export interface DormantMainnetWalletBroadcastObservationInputV1 {
  readonly schemaVersion: 1;
  readonly observationId: string;
  readonly intentId: string;
  readonly submissionFingerprintSha256: string;
  readonly networkId: string;
  readonly transactionId: string;
  readonly outcome: DormantMainnetWalletBroadcastOutcome | string;
  readonly evidenceSha256: string;
  readonly observedAt: string;
}

export type DormantMainnetReconciliationOutcome =
  'PENDING' | 'UNKNOWN' | 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE' | 'REORGED_OUT';

export interface DormantMainnetReconciliationObservationInputV1 {
  readonly schemaVersion: 1;
  readonly observationId: string;
  readonly intentId: string;
  readonly submissionFingerprintSha256: string;
  readonly networkId: string;
  readonly transactionId: string;
  readonly outcome: DormantMainnetReconciliationOutcome | string;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
  readonly finalizedPosition: string;
  readonly finalizedBlockId: string;
  readonly effectEvidenceSha256: string | null;
  readonly failureEvidenceSha256: string | null;
  readonly sourceEvidenceSha256: string;
  readonly observedAt: string;
}

export interface DormantMainnetFinancialActionSubmissionBindingV1 {
  readonly schemaVersion: 1;
  readonly source: 'USER_WALLET_REPORT_ONLY';
  readonly intentId: string;
  readonly intentFingerprintSha256: string;
  readonly networkId: DormantMainnetFinancialActionIntentV1['networkId'];
  readonly signerWalletAccountId: string;
  readonly transactionId: string;
  readonly chainQualifiedTransactionId: string;
  readonly walletSignedPayloadSha256: string;
  readonly walletSignatureEvidenceSha256: string;
  readonly signedAt: string;
  readonly submissionFingerprintSha256: string;
  readonly cryptographicSignatureVerifiedByThisProtocol: false;
  readonly signedPayloadMatchesIntentVerifiedByThisProtocol: false;
}

export interface DormantMainnetWalletBroadcastObservationV1 {
  readonly schemaVersion: 1;
  readonly source: 'USER_WALLET_REPORT_ONLY';
  readonly observationId: string;
  readonly intentId: string;
  readonly submissionFingerprintSha256: string;
  readonly networkId: DormantMainnetFinancialActionIntentV1['networkId'];
  readonly transactionId: string;
  readonly chainQualifiedTransactionId: string;
  readonly outcome: DormantMainnetWalletBroadcastOutcome;
  readonly evidenceSha256: string;
  readonly observedAt: string;
  readonly broadcastAttemptConsumed: true;
  readonly onchainAcceptanceVerifiedByThisProtocol: false;
}

export interface DormantMainnetReconciliationObservationV1 {
  readonly schemaVersion: 1;
  readonly source: 'CALLER_SUPPLIED_READ_ONLY_CHAIN_EVIDENCE';
  readonly observationId: string;
  readonly intentId: string;
  readonly submissionFingerprintSha256: string;
  readonly networkId: DormantMainnetFinancialActionIntentV1['networkId'];
  readonly transactionId: string;
  readonly chainQualifiedTransactionId: string;
  readonly outcome: DormantMainnetReconciliationOutcome;
  readonly transactionPosition: string | null;
  readonly transactionBlockId: string | null;
  readonly finalizedPosition: string;
  readonly finalizedBlockId: string;
  readonly effectEvidenceSha256: string | null;
  readonly failureEvidenceSha256: string | null;
  readonly sourceEvidenceSha256: string;
  readonly observedAt: string;
  readonly independentlyReadByThisProtocol: false;
}

export interface DormantMainnetFinancialActionLifecycleSnapshotV1 {
  readonly schemaVersion: 1;
  readonly use: 'DORMANT_MAINNET_FINANCIAL_ACTION_LIFECYCLE_PROTOCOL_ONLY';
  readonly stage: DormantMainnetFinancialActionLifecycleStage;
  readonly revision: number;
  readonly previousSnapshotSha256: string | null;
  readonly transitionFingerprintSha256: string;
  readonly snapshotSha256: string;
  readonly intentFingerprintSha256: string;
  readonly intent: DormantMainnetFinancialActionIntentV1;
  readonly identities: Readonly<{
    readonly walletAccountId: string;
    readonly providerMarketId: string;
    readonly assetId: string;
  }>;
  readonly submission: DormantMainnetFinancialActionSubmissionBindingV1 | null;
  readonly broadcastObservation: DormantMainnetWalletBroadcastObservationV1 | null;
  readonly reconciliation: DormantMainnetReconciliationObservationV1 | null;
  readonly terminal: boolean;
  readonly requiresManualReconciliation: boolean;
  readonly authority: typeof ZERO_AUTHORITY;
  readonly durability: typeof VOLATILE_DURABILITY;
}

export interface DormantMainnetFinancialActionLifecycleProtocolV1 {
  readonly schemaVersion: 1;
  readonly operationalMode: 'DORMANT';
  readonly executionAuthority: false;
  readonly persistenceAuthority: false;
  prepareIntent(
    input: DormantMainnetFinancialActionIntentInputV1,
    serverNow: unknown,
  ): DormantMainnetFinancialActionLifecycleSnapshotV1;
  bindWalletSignedSubmission(
    input: unknown,
    serverNow: unknown,
  ): DormantMainnetFinancialActionLifecycleSnapshotV1;
  recordWalletBroadcastObservation(
    input: unknown,
    serverNow: unknown,
  ): DormantMainnetFinancialActionLifecycleSnapshotV1;
  recordReconciliationObservation(
    input: unknown,
    serverNow: unknown,
  ): DormantMainnetFinancialActionLifecycleSnapshotV1;
  readSnapshot(intentId: string): DormantMainnetFinancialActionLifecycleSnapshotV1;
}

interface LifecycleRecord {
  readonly prepared: DormantMainnetFinancialActionLifecycleSnapshotV1;
  current: DormantMainnetFinancialActionLifecycleSnapshotV1;
  submissionReplay?: Readonly<{
    fingerprint: string;
    snapshot: DormantMainnetFinancialActionLifecycleSnapshotV1;
  }>;
  broadcastReplay?: Readonly<{
    observationId: string;
    fingerprint: string;
    snapshot: DormantMainnetFinancialActionLifecycleSnapshotV1;
  }>;
  readonly reconciliationReplays: Map<
    string,
    Readonly<{
      fingerprint: string;
      snapshot: DormantMainnetFinancialActionLifecycleSnapshotV1;
    }>
  >;
  lastTransactionPosition?: string;
  lastTransactionBlockId?: string;
  lastFinalizedPosition?: string;
  lastFinalizedBlockId?: string;
  lastReconciliationObservedAt?: string;
}

type EvidenceDigestRole =
  | 'WALLET_SIGNED_PAYLOAD'
  | 'WALLET_SIGNATURE_EVIDENCE'
  | 'WALLET_BROADCAST_EVIDENCE'
  | 'RECONCILIATION_SOURCE_EVIDENCE'
  | 'RECONCILIATION_EFFECT_EVIDENCE'
  | 'RECONCILIATION_FAILURE_EVIDENCE';

interface EvidenceDigestClaim {
  readonly digest: string;
  readonly role: EvidenceDigestRole;
  readonly fingerprint: string;
}

const SUBMISSION_KEYS = Object.freeze([
  'schemaVersion',
  'intentId',
  'intentFingerprintSha256',
  'networkId',
  'signerWalletAccountId',
  'transactionId',
  'walletSignedPayloadSha256',
  'walletSignatureEvidenceSha256',
  'signedAt',
] as const);

const BROADCAST_KEYS = Object.freeze([
  'schemaVersion',
  'observationId',
  'intentId',
  'submissionFingerprintSha256',
  'networkId',
  'transactionId',
  'outcome',
  'evidenceSha256',
  'observedAt',
] as const);

const RECONCILIATION_KEYS = Object.freeze([
  'schemaVersion',
  'observationId',
  'intentId',
  'submissionFingerprintSha256',
  'networkId',
  'transactionId',
  'outcome',
  'transactionPosition',
  'transactionBlockId',
  'finalizedPosition',
  'finalizedBlockId',
  'effectEvidenceSha256',
  'failureEvidenceSha256',
  'sourceEvidenceSha256',
  'observedAt',
] as const);

function fail(code: DormantMainnetFinancialActionLifecycleErrorCode): never {
  throw new DormantMainnetFinancialActionLifecycleError(code);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: DormantMainnetFinancialActionLifecycleErrorCode,
): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value)) {
      return fail(code);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail(code);
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return fail(code);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fingerprint(domain: string, values: readonly unknown[]): string {
  return sha256(`${domain}\u0000${JSON.stringify(values)}`);
}

function digest(value: unknown, code: DormantMainnetFinancialActionLifecycleErrorCode): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value) || /^0{64}$/u.test(value)) {
    return fail(code);
  }
  return value;
}

function uuid(value: unknown, code: DormantMainnetFinancialActionLifecycleErrorCode): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return fail(code);
  return value;
}

function timestamp(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleErrorCode,
): Readonly<{ text: string; milliseconds: number }> {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP_PATTERN.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail(code);
  }
  return Object.freeze({ text: value, milliseconds });
}

function serverTime(value: unknown): number {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      !(value instanceof Date) ||
      Object.getPrototypeOf(value) !== Date.prototype
    ) {
      return fail('INVALID_SERVER_TIME');
    }
    const milliseconds = Date.prototype.getTime.call(value) as number;
    if (!Number.isFinite(milliseconds)) return fail('INVALID_SERVER_TIME');
    return milliseconds;
  } catch {
    return fail('INVALID_SERVER_TIME');
  }
}

function canonicalUint64(
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleErrorCode,
): string {
  if (typeof value !== 'string' || value.length > 20 || !CANONICAL_UINT_PATTERN.test(value)) {
    return fail(code);
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX) return fail(code);
  return value;
}

function decodeBase58(value: string): Uint8Array | null {
  if (!BASE58_PATTERN.test(value)) return null;
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
  return decoded;
}

function encodeBase58(value: Uint8Array): string {
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
  const significant = digits.length === 1 && digits[0] === 0 ? [] : digits;
  return (
    '1'.repeat(zeros) +
    significant
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit] ?? '')
      .join('')
  );
}

function canonicalBase58(
  value: unknown,
  decodedLength: number,
  code: DormantMainnetFinancialActionLifecycleErrorCode,
): string {
  if (typeof value !== 'string' || value.length > 90) return fail(code);
  const decoded = decodeBase58(value);
  if (
    decoded === null ||
    decoded.length !== decodedLength ||
    encodeBase58(decoded) !== value ||
    decoded.every((byte) => byte === 0)
  ) {
    return fail(code);
  }
  return value;
}

function evmHash(value: unknown, code: DormantMainnetFinancialActionLifecycleErrorCode): string {
  if (typeof value !== 'string' || !EVM_HASH_PATTERN.test(value) || /^0x0{64}$/u.test(value)) {
    return fail(code);
  }
  return value;
}

function transactionId(
  networkId: DormantMainnetFinancialActionIntentV1['networkId'],
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleErrorCode,
): string {
  return networkId === ETHEREUM_MAINNET ? evmHash(value, code) : canonicalBase58(value, 64, code);
}

function blockId(
  networkId: DormantMainnetFinancialActionIntentV1['networkId'],
  value: unknown,
  code: DormantMainnetFinancialActionLifecycleErrorCode,
): string {
  return networkId === ETHEREUM_MAINNET ? evmHash(value, code) : canonicalBase58(value, 32, code);
}

function intentFingerprint(intent: DormantMainnetFinancialActionIntentV1): string {
  return fingerprint('CRYPTO_LENDING:DORMANT_MAINNET_ACTION_INTENT:v1', [
    intent.schemaVersion,
    intent.intentId,
    intent.accountId,
    intent.walletRegistrationId,
    intent.replayProtectionId,
    intent.idempotencyKeyDigestSha256,
    intent.networkId,
    intent.walletAddress,
    intent.providerId,
    intent.protocolId,
    intent.marketId,
    intent.assetRegistryVersion,
    intent.assetRegistryFingerprintSha256,
    intent.assetSymbol,
    intent.assetIdentity,
    intent.assetDecimals,
    intent.action,
    intent.amountAtomic,
    intent.requestedValueUsdMicros,
    intent.maximumNetworkFeeAtomic,
    intent.maximumNetworkFeeBasisPoints,
    intent.minimumPostActionNativeBalanceAtomic,
    intent.allowanceMode,
    intent.allowanceAmountAtomic,
    intent.issuedAt,
    intent.expiresAt,
  ]);
}

function makeSnapshot(
  record: LifecycleRecord | undefined,
  intent: DormantMainnetFinancialActionIntentV1,
  intentDigest: string,
  stage: DormantMainnetFinancialActionLifecycleStage,
  transitionDigest: string,
  submission: DormantMainnetFinancialActionSubmissionBindingV1 | null,
  broadcastObservation: DormantMainnetWalletBroadcastObservationV1 | null,
  reconciliation: DormantMainnetReconciliationObservationV1 | null,
): DormantMainnetFinancialActionLifecycleSnapshotV1 {
  const previous = record?.current ?? null;
  const revision = (previous?.revision ?? 0) + 1;
  const previousSnapshotSha256 = previous?.snapshotSha256 ?? null;
  const snapshotSha256 = fingerprint('CRYPTO_LENDING:DORMANT_MAINNET_ACTION_SNAPSHOT:v1', [
    intent.intentId,
    revision,
    stage,
    previousSnapshotSha256,
    transitionDigest,
  ]);
  return Object.freeze({
    schemaVersion: DORMANT_MAINNET_FINANCIAL_ACTION_LIFECYCLE_SCHEMA_VERSION,
    use: 'DORMANT_MAINNET_FINANCIAL_ACTION_LIFECYCLE_PROTOCOL_ONLY' as const,
    stage,
    revision,
    previousSnapshotSha256,
    transitionFingerprintSha256: transitionDigest,
    snapshotSha256,
    intentFingerprintSha256: intentDigest,
    intent,
    identities: Object.freeze({
      walletAccountId: formatWalletAccountId(intent.networkId, intent.walletAddress),
      providerMarketId: `${intent.networkId}:${intent.providerId}:${intent.protocolId}:${intent.marketId}`,
      assetId: `${intent.networkId}:${intent.assetIdentity}`,
    }),
    submission,
    broadcastObservation,
    reconciliation,
    terminal:
      stage === 'FINALIZED_SUCCESS' ||
      stage === 'FINALIZED_FAILURE' ||
      stage === 'REORG_QUARANTINED',
    requiresManualReconciliation: stage === 'REORG_QUARANTINED',
    authority: ZERO_AUTHORITY,
    durability: VOLATILE_DURABILITY,
  });
}

function assertContext(
  record: LifecycleRecord,
  input: Record<string, unknown>,
  code: DormantMainnetFinancialActionLifecycleErrorCode,
): Readonly<{
  networkId: DormantMainnetFinancialActionIntentV1['networkId'];
  transactionId: string;
}> {
  const intent = record.current.intent;
  const submission = record.current.submission;
  if (
    input.intentId !== intent.intentId ||
    submission === null ||
    input.submissionFingerprintSha256 !== submission.submissionFingerprintSha256 ||
    input.networkId !== intent.networkId
  ) {
    return fail(code);
  }
  const parsedTransactionId = transactionId(intent.networkId, input.transactionId, code);
  if (parsedTransactionId !== submission.transactionId) return fail(code);
  return Object.freeze({ networkId: intent.networkId, transactionId: parsedTransactionId });
}

/**
 * Creates a deterministic, in-memory protocol recorder only. It has no adapters,
 * endpoints, transaction bytes, signing key, broadcaster, or persistence claim.
 */
export function createDormantMainnetFinancialActionLifecycleProtocol(): DormantMainnetFinancialActionLifecycleProtocolV1 {
  const records = new Map<string, LifecycleRecord>();
  const idempotencyOwners = new Map<string, string>();
  const replayProtectionOwners = new Map<string, string>();
  const transactionOwners = new Map<string, string>();
  const observationOwners = new Map<string, string>();
  const evidenceDigestOwners = new Map<
    string,
    Readonly<{ role: EvidenceDigestRole; fingerprint: string }>
  >();

  function assertEvidenceDigestsAvailable(claims: readonly EvidenceDigestClaim[]): void {
    for (const claim of claims) {
      const owner = evidenceDigestOwners.get(claim.digest);
      if (
        owner !== undefined &&
        (owner.role !== claim.role || owner.fingerprint !== claim.fingerprint)
      ) {
        return fail('EVIDENCE_DIGEST_CONFLICT');
      }
    }
  }

  function commitEvidenceDigests(claims: readonly EvidenceDigestClaim[]): void {
    for (const claim of claims) {
      evidenceDigestOwners.set(
        claim.digest,
        Object.freeze({ role: claim.role, fingerprint: claim.fingerprint }),
      );
    }
  }

  function recordFor(intentIdValue: unknown): LifecycleRecord {
    if (typeof intentIdValue !== 'string') return fail('INTENT_NOT_FOUND');
    const record = records.get(intentIdValue);
    if (record === undefined) return fail('INTENT_NOT_FOUND');
    return record;
  }

  function prepareIntent(
    input: DormantMainnetFinancialActionIntentInputV1,
    now: unknown,
  ): DormantMainnetFinancialActionLifecycleSnapshotV1 {
    const intent = parseDormantMainnetFinancialActionIntent(input, now);
    const intentDigest = intentFingerprint(intent);
    const existing = records.get(intent.intentId);
    if (existing !== undefined) {
      if (existing.prepared.intentFingerprintSha256 !== intentDigest)
        return fail('INTENT_CONFLICT');
      return existing.current;
    }
    const idempotencyScope = `${intent.accountId}:MAINNET_FINANCIAL_ACTION:v1:${intent.idempotencyKeyDigestSha256}`;
    const idempotencyOwner = idempotencyOwners.get(idempotencyScope);
    if (idempotencyOwner !== undefined && idempotencyOwner !== intentDigest) {
      return fail('IDEMPOTENCY_REPLAY_CONFLICT');
    }
    const replayProtectionScope = `${intent.accountId}:MAINNET_FINANCIAL_ACTION_REPLAY_PROTECTION:v1:${intent.replayProtectionId}`;
    const replayProtectionOwner = replayProtectionOwners.get(replayProtectionScope);
    if (replayProtectionOwner !== undefined && replayProtectionOwner !== intentDigest) {
      return fail('REPLAY_PROTECTION_CONFLICT');
    }
    const transitionDigest = fingerprint('CRYPTO_LENDING:DORMANT_MAINNET_ACTION_PREPARED:v1', [
      intentDigest,
      idempotencyScope,
    ]);
    const prepared = makeSnapshot(
      undefined,
      intent,
      intentDigest,
      'PREPARED',
      transitionDigest,
      null,
      null,
      null,
    );
    records.set(intent.intentId, {
      prepared,
      current: prepared,
      reconciliationReplays: new Map(),
    });
    idempotencyOwners.set(idempotencyScope, intentDigest);
    replayProtectionOwners.set(replayProtectionScope, intentDigest);
    return prepared;
  }

  function bindWalletSignedSubmission(
    value: unknown,
    now: unknown,
  ): DormantMainnetFinancialActionLifecycleSnapshotV1 {
    const input = exactRecord(value, SUBMISSION_KEYS, 'INVALID_SUBMISSION_INPUT');
    if (input.schemaVersion !== 1) return fail('INVALID_SUBMISSION_INPUT');
    const intentIdValue = uuid(input.intentId, 'INVALID_SUBMISSION_INPUT');
    const record = recordFor(intentIdValue);
    const intent = record.current.intent;
    const expectedIntentDigest = digest(input.intentFingerprintSha256, 'INVALID_SUBMISSION_INPUT');
    if (
      expectedIntentDigest !== record.current.intentFingerprintSha256 ||
      input.networkId !== intent.networkId ||
      input.signerWalletAccountId !== formatWalletAccountId(intent.networkId, intent.walletAddress)
    ) {
      return fail('INVALID_SUBMISSION_INPUT');
    }
    const parsedTransactionId = transactionId(
      intent.networkId,
      input.transactionId,
      'INVALID_SUBMISSION_INPUT',
    );
    const walletSignedPayloadSha256 = digest(
      input.walletSignedPayloadSha256,
      'INVALID_SUBMISSION_INPUT',
    );
    const walletSignatureEvidenceSha256 = digest(
      input.walletSignatureEvidenceSha256,
      'INVALID_SUBMISSION_INPUT',
    );
    if (walletSignedPayloadSha256 === walletSignatureEvidenceSha256) {
      return fail('INVALID_SUBMISSION_INPUT');
    }
    const signedAt = timestamp(input.signedAt, 'INVALID_SUBMISSION_INPUT');
    const nowMilliseconds = serverTime(now);
    const submissionFingerprintSha256 = fingerprint(
      'CRYPTO_LENDING:DORMANT_MAINNET_ACTION_WALLET_SUBMISSION:v1',
      [
        intentIdValue,
        expectedIntentDigest,
        intent.networkId,
        input.signerWalletAccountId,
        parsedTransactionId,
        walletSignedPayloadSha256,
        walletSignatureEvidenceSha256,
        signedAt.text,
      ],
    );
    if (record.submissionReplay !== undefined) {
      if (record.submissionReplay.fingerprint !== submissionFingerprintSha256) {
        return fail('IDEMPOTENCY_REPLAY_CONFLICT');
      }
      return record.current;
    }
    if (
      signedAt.milliseconds < Date.parse(intent.issuedAt) ||
      signedAt.milliseconds > nowMilliseconds ||
      signedAt.milliseconds >= Date.parse(intent.expiresAt) ||
      nowMilliseconds >= Date.parse(intent.expiresAt)
    ) {
      return fail('INTENT_EXPIRED');
    }
    if (record.current.stage !== 'PREPARED') return fail('INVALID_LIFECYCLE_TRANSITION');
    const chainQualifiedTransactionId = `${intent.networkId}:${parsedTransactionId}`;
    const transactionOwner = transactionOwners.get(chainQualifiedTransactionId);
    if (transactionOwner !== undefined && transactionOwner !== intentIdValue) {
      return fail('TRANSACTION_IDENTITY_CONFLICT');
    }
    const evidenceClaims = Object.freeze([
      Object.freeze({
        digest: walletSignedPayloadSha256,
        role: 'WALLET_SIGNED_PAYLOAD' as const,
        fingerprint: submissionFingerprintSha256,
      }),
      Object.freeze({
        digest: walletSignatureEvidenceSha256,
        role: 'WALLET_SIGNATURE_EVIDENCE' as const,
        fingerprint: submissionFingerprintSha256,
      }),
    ]);
    assertEvidenceDigestsAvailable(evidenceClaims);
    const submission: DormantMainnetFinancialActionSubmissionBindingV1 = Object.freeze({
      schemaVersion: 1 as const,
      source: 'USER_WALLET_REPORT_ONLY' as const,
      intentId: intentIdValue,
      intentFingerprintSha256: expectedIntentDigest,
      networkId: intent.networkId,
      signerWalletAccountId: input.signerWalletAccountId as string,
      transactionId: parsedTransactionId,
      chainQualifiedTransactionId,
      walletSignedPayloadSha256,
      walletSignatureEvidenceSha256,
      signedAt: signedAt.text,
      submissionFingerprintSha256,
      cryptographicSignatureVerifiedByThisProtocol: false as const,
      signedPayloadMatchesIntentVerifiedByThisProtocol: false as const,
    });
    const snapshot = makeSnapshot(
      record,
      intent,
      expectedIntentDigest,
      'WALLET_SIGNED_SUBMISSION_BOUND',
      submissionFingerprintSha256,
      submission,
      null,
      null,
    );
    commitEvidenceDigests(evidenceClaims);
    record.current = snapshot;
    record.submissionReplay = Object.freeze({
      fingerprint: submissionFingerprintSha256,
      snapshot,
    });
    transactionOwners.set(chainQualifiedTransactionId, intentIdValue);
    return snapshot;
  }

  function recordWalletBroadcastObservation(
    value: unknown,
    now: unknown,
  ): DormantMainnetFinancialActionLifecycleSnapshotV1 {
    const input = exactRecord(value, BROADCAST_KEYS, 'INVALID_BROADCAST_OBSERVATION_INPUT');
    if (input.schemaVersion !== 1) return fail('INVALID_BROADCAST_OBSERVATION_INPUT');
    const intentIdValue = uuid(input.intentId, 'INVALID_BROADCAST_OBSERVATION_INPUT');
    const observationId = uuid(input.observationId, 'INVALID_BROADCAST_OBSERVATION_INPUT');
    const record = recordFor(intentIdValue);
    const context = assertContext(record, input, 'INVALID_BROADCAST_OBSERVATION_INPUT');
    if (
      typeof input.outcome !== 'string' ||
      !(
        [
          'WALLET_REPORTED_SUBMITTED',
          'WALLET_REPORTED_AMBIGUOUS',
          'WALLET_REPORTED_REJECTED',
        ] as readonly string[]
      ).includes(input.outcome)
    ) {
      return fail('INVALID_BROADCAST_OBSERVATION_INPUT');
    }
    const evidenceSha256 = digest(input.evidenceSha256, 'INVALID_BROADCAST_OBSERVATION_INPUT');
    const observedAt = timestamp(input.observedAt, 'INVALID_BROADCAST_OBSERVATION_INPUT');
    const nowMilliseconds = serverTime(now);
    const submission = record.current.submission;
    if (submission === null) return fail('INVALID_LIFECYCLE_TRANSITION');
    if (
      evidenceSha256 === submission.walletSignedPayloadSha256 ||
      evidenceSha256 === submission.walletSignatureEvidenceSha256
    ) {
      return fail('INVALID_BROADCAST_OBSERVATION_INPUT');
    }
    const observationFingerprint = fingerprint(
      'CRYPTO_LENDING:DORMANT_MAINNET_ACTION_WALLET_BROADCAST_OBSERVATION:v1',
      [
        observationId,
        intentIdValue,
        submission.submissionFingerprintSha256,
        context.networkId,
        context.transactionId,
        input.outcome,
        evidenceSha256,
        observedAt.text,
      ],
    );
    if (record.broadcastReplay !== undefined) {
      if (
        record.broadcastReplay.observationId !== observationId ||
        record.broadcastReplay.fingerprint !== observationFingerprint
      ) {
        return fail('ONE_SHOT_BROADCAST_ALREADY_RECORDED');
      }
      return record.current;
    }
    if (
      observedAt.milliseconds < Date.parse(submission.signedAt) ||
      observedAt.milliseconds > nowMilliseconds ||
      observedAt.milliseconds >= Date.parse(record.current.intent.expiresAt) ||
      nowMilliseconds >= Date.parse(record.current.intent.expiresAt)
    ) {
      return fail('INVALID_BROADCAST_OBSERVATION_INPUT');
    }
    if (record.current.stage !== 'WALLET_SIGNED_SUBMISSION_BOUND') {
      return fail('INVALID_LIFECYCLE_TRANSITION');
    }
    const observationOwner = observationOwners.get(observationId);
    if (observationOwner !== undefined && observationOwner !== intentIdValue) {
      return fail('OBSERVATION_REPLAY_CONFLICT');
    }
    const evidenceClaims = Object.freeze([
      Object.freeze({
        digest: evidenceSha256,
        role: 'WALLET_BROADCAST_EVIDENCE' as const,
        fingerprint: observationFingerprint,
      }),
    ]);
    assertEvidenceDigestsAvailable(evidenceClaims);
    const observation: DormantMainnetWalletBroadcastObservationV1 = Object.freeze({
      schemaVersion: 1 as const,
      source: 'USER_WALLET_REPORT_ONLY' as const,
      observationId,
      intentId: intentIdValue,
      submissionFingerprintSha256: submission.submissionFingerprintSha256,
      networkId: context.networkId,
      transactionId: context.transactionId,
      chainQualifiedTransactionId: submission.chainQualifiedTransactionId,
      outcome: input.outcome as DormantMainnetWalletBroadcastOutcome,
      evidenceSha256,
      observedAt: observedAt.text,
      broadcastAttemptConsumed: true as const,
      onchainAcceptanceVerifiedByThisProtocol: false as const,
    });
    const snapshot = makeSnapshot(
      record,
      record.current.intent,
      record.current.intentFingerprintSha256,
      'BROADCAST_OUTCOME_AMBIGUOUS',
      observationFingerprint,
      submission,
      observation,
      null,
    );
    commitEvidenceDigests(evidenceClaims);
    record.current = snapshot;
    record.broadcastReplay = Object.freeze({
      observationId,
      fingerprint: observationFingerprint,
      snapshot,
    });
    observationOwners.set(observationId, intentIdValue);
    return snapshot;
  }

  function recordReconciliationObservation(
    value: unknown,
    now: unknown,
  ): DormantMainnetFinancialActionLifecycleSnapshotV1 {
    const input = exactRecord(
      value,
      RECONCILIATION_KEYS,
      'INVALID_RECONCILIATION_OBSERVATION_INPUT',
    );
    if (input.schemaVersion !== 1) return fail('INVALID_RECONCILIATION_OBSERVATION_INPUT');
    const intentIdValue = uuid(input.intentId, 'INVALID_RECONCILIATION_OBSERVATION_INPUT');
    const observationId = uuid(input.observationId, 'INVALID_RECONCILIATION_OBSERVATION_INPUT');
    const record = recordFor(intentIdValue);
    const context = assertContext(record, input, 'INVALID_RECONCILIATION_OBSERVATION_INPUT');
    if (
      typeof input.outcome !== 'string' ||
      !(
        ['PENDING', 'UNKNOWN', 'FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'REORGED_OUT'] as const
      ).includes(input.outcome as DormantMainnetReconciliationOutcome)
    ) {
      return fail('INVALID_RECONCILIATION_OBSERVATION_INPUT');
    }
    const outcome = input.outcome as DormantMainnetReconciliationOutcome;
    const transactionPosition =
      input.transactionPosition === null
        ? null
        : canonicalUint64(input.transactionPosition, 'INVALID_RECONCILIATION_OBSERVATION_INPUT');
    const transactionBlockId =
      input.transactionBlockId === null
        ? null
        : blockId(
            context.networkId,
            input.transactionBlockId,
            'INVALID_RECONCILIATION_OBSERVATION_INPUT',
          );
    if ((transactionPosition === null) !== (transactionBlockId === null)) {
      return fail('INVALID_RECONCILIATION_OBSERVATION_INPUT');
    }
    const finalizedPosition = canonicalUint64(
      input.finalizedPosition,
      'INVALID_RECONCILIATION_OBSERVATION_INPUT',
    );
    const finalizedBlockId = blockId(
      context.networkId,
      input.finalizedBlockId,
      'INVALID_RECONCILIATION_OBSERVATION_INPUT',
    );
    const effectEvidenceSha256 =
      input.effectEvidenceSha256 === null
        ? null
        : digest(input.effectEvidenceSha256, 'INVALID_RECONCILIATION_OBSERVATION_INPUT');
    const failureEvidenceSha256 =
      input.failureEvidenceSha256 === null
        ? null
        : digest(input.failureEvidenceSha256, 'INVALID_RECONCILIATION_OBSERVATION_INPUT');
    const sourceEvidenceSha256 = digest(
      input.sourceEvidenceSha256,
      'INVALID_RECONCILIATION_OBSERVATION_INPUT',
    );
    const observedAt = timestamp(input.observedAt, 'INVALID_RECONCILIATION_OBSERVATION_INPUT');
    if (
      record.current.broadcastObservation === null ||
      observedAt.milliseconds < Date.parse(record.current.broadcastObservation.observedAt) ||
      observedAt.milliseconds > serverTime(now)
    ) {
      return fail('INVALID_RECONCILIATION_OBSERVATION_INPUT');
    }
    const finalized = BigInt(finalizedPosition);
    const transaction = transactionPosition === null ? null : BigInt(transactionPosition);
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
      return fail('INVALID_RECONCILIATION_OBSERVATION_INPUT');
    }
    const observationFingerprint = fingerprint(
      'CRYPTO_LENDING:DORMANT_MAINNET_ACTION_RECONCILIATION_OBSERVATION:v1',
      [
        observationId,
        intentIdValue,
        record.current.submission?.submissionFingerprintSha256,
        context.networkId,
        context.transactionId,
        outcome,
        transactionPosition,
        transactionBlockId,
        finalizedPosition,
        finalizedBlockId,
        effectEvidenceSha256,
        failureEvidenceSha256,
        sourceEvidenceSha256,
        observedAt.text,
      ],
    );
    const replay = record.reconciliationReplays.get(observationId);
    if (replay !== undefined) {
      if (replay.fingerprint !== observationFingerprint) {
        return fail('OBSERVATION_REPLAY_CONFLICT');
      }
      return record.current;
    }
    const observationOwner = observationOwners.get(observationId);
    if (observationOwner !== undefined) return fail('OBSERVATION_REPLAY_CONFLICT');
    if (
      record.current.terminal ||
      (record.current.stage !== 'BROADCAST_OUTCOME_AMBIGUOUS' &&
        record.current.stage !== 'RECONCILIATION_AMBIGUOUS')
    ) {
      return fail('TERMINAL_RECONCILIATION');
    }
    if (
      record.lastReconciliationObservedAt !== undefined &&
      observedAt.milliseconds < Date.parse(record.lastReconciliationObservedAt)
    ) {
      return fail('NON_MONOTONIC_RECONCILIATION');
    }
    if (
      record.lastFinalizedPosition !== undefined &&
      (BigInt(finalizedPosition) < BigInt(record.lastFinalizedPosition) ||
        (finalizedPosition === record.lastFinalizedPosition &&
          finalizedBlockId !== record.lastFinalizedBlockId &&
          outcome !== 'REORGED_OUT') ||
        (transactionPosition !== null &&
          record.lastTransactionPosition !== undefined &&
          (transactionPosition !== record.lastTransactionPosition ||
            transactionBlockId !== record.lastTransactionBlockId) &&
          outcome !== 'REORGED_OUT'))
    ) {
      return fail('NON_MONOTONIC_RECONCILIATION');
    }
    if (
      outcome === 'REORGED_OUT' &&
      record.lastTransactionPosition !== undefined &&
      (transactionPosition !== record.lastTransactionPosition ||
        transactionBlockId !== record.lastTransactionBlockId)
    ) {
      return fail('NON_MONOTONIC_RECONCILIATION');
    }
    const evidenceClaims: EvidenceDigestClaim[] = [
      {
        digest: sourceEvidenceSha256,
        role: 'RECONCILIATION_SOURCE_EVIDENCE',
        fingerprint: observationFingerprint,
      },
    ];
    if (effectEvidenceSha256 !== null) {
      evidenceClaims.push({
        digest: effectEvidenceSha256,
        role: 'RECONCILIATION_EFFECT_EVIDENCE',
        fingerprint: observationFingerprint,
      });
    }
    if (failureEvidenceSha256 !== null) {
      evidenceClaims.push({
        digest: failureEvidenceSha256,
        role: 'RECONCILIATION_FAILURE_EVIDENCE',
        fingerprint: observationFingerprint,
      });
    }
    assertEvidenceDigestsAvailable(evidenceClaims);
    const observation: DormantMainnetReconciliationObservationV1 = Object.freeze({
      schemaVersion: 1 as const,
      source: 'CALLER_SUPPLIED_READ_ONLY_CHAIN_EVIDENCE' as const,
      observationId,
      intentId: intentIdValue,
      submissionFingerprintSha256: record.current.submission!.submissionFingerprintSha256,
      networkId: context.networkId,
      transactionId: context.transactionId,
      chainQualifiedTransactionId: record.current.submission!.chainQualifiedTransactionId,
      outcome,
      transactionPosition,
      transactionBlockId,
      finalizedPosition,
      finalizedBlockId,
      effectEvidenceSha256,
      failureEvidenceSha256,
      sourceEvidenceSha256,
      observedAt: observedAt.text,
      independentlyReadByThisProtocol: false as const,
    });
    const stage: DormantMainnetFinancialActionLifecycleStage =
      outcome === 'FINALIZED_SUCCESS'
        ? 'FINALIZED_SUCCESS'
        : outcome === 'FINALIZED_FAILURE'
          ? 'FINALIZED_FAILURE'
          : outcome === 'REORGED_OUT'
            ? 'REORG_QUARANTINED'
            : 'RECONCILIATION_AMBIGUOUS';
    const snapshot = makeSnapshot(
      record,
      record.current.intent,
      record.current.intentFingerprintSha256,
      stage,
      observationFingerprint,
      record.current.submission,
      record.current.broadcastObservation,
      observation,
    );
    commitEvidenceDigests(evidenceClaims);
    record.current = snapshot;
    record.reconciliationReplays.set(
      observationId,
      Object.freeze({ fingerprint: observationFingerprint, snapshot }),
    );
    if (transactionPosition !== null && outcome !== 'REORGED_OUT') {
      record.lastTransactionPosition = transactionPosition;
      record.lastTransactionBlockId = transactionBlockId!;
    }
    record.lastFinalizedPosition = finalizedPosition;
    record.lastFinalizedBlockId = finalizedBlockId;
    record.lastReconciliationObservedAt = observedAt.text;
    observationOwners.set(observationId, intentIdValue);
    return snapshot;
  }

  function readSnapshot(intentId: string): DormantMainnetFinancialActionLifecycleSnapshotV1 {
    return recordFor(intentId).current;
  }

  return Object.freeze({
    schemaVersion: DORMANT_MAINNET_FINANCIAL_ACTION_LIFECYCLE_SCHEMA_VERSION,
    operationalMode: 'DORMANT' as const,
    executionAuthority: false as const,
    persistenceAuthority: false as const,
    prepareIntent,
    bindWalletSignedSubmission,
    recordWalletBroadcastObservation,
    recordReconciliationObservation,
    readSnapshot,
  });
}
