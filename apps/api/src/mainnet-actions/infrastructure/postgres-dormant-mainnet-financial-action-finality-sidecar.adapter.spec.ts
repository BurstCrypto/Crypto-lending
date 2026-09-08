import type { PostgresService } from '../../infrastructure/database/postgres.service';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE,
  DormantMainnetFinancialActionFinalityEvidenceProducer,
  type MainnetFinancialActionFinalityEvidencePrerequisitePort,
  type MainnetFinancialActionFinalityEvidenceSourceBindingV1,
  type MainnetFinancialActionPostFinalityEvidencePrerequisiteV1,
  type MainnetFinancialActionReconciliationEvidencePrerequisiteV1,
  type ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
  type ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
} from '../application/dormant-mainnet-financial-action-finality-evidence.producer';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION,
  type MainnetFinancialActionFinalityEvidenceSourceAttestationV1,
  type MainnetFinancialActionFinalityEvidenceSourcePort,
  type ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
} from '../application/ports/mainnet-financial-action-finality-evidence-source.port';
import type {
  DormantMainnetFinancialActionAdmissionDatabaseConfirmedResultV1,
  DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1,
  DormantMainnetFinancialActionEffectiveSafetyReaderPort,
  DormantMainnetFinancialActionFinalityDatabaseOutcomeUnknownV1,
  DormantMainnetFinancialActionFinalityPersistencePort,
  DormantMainnetFinancialActionFinalitySidecarRequestV1,
  DormantMainnetFinancialActionFinalitySidecarResultV1,
  ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
  RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
  RecordMainnetFinancialActionPostFinalityReviewRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
  PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter,
} from './postgres-dormant-mainnet-financial-action-finality-sidecar.adapter';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const INTENT_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_AUTHORITY_ID = '44444444-4444-4444-8444-444444444444';
const DEPLOYMENT_AUTHORITY_ID = '55555555-5555-4555-8555-555555555555';
const OBSERVATION_ID = '66666666-6666-4666-8666-666666666666';
const CORRELATION_ID = '77777777-7777-4777-8777-777777777777';
const REVIEW_ID = '88888888-8888-4888-8888-888888888888';
const TRANSACTION_ID = `0x${'4'.repeat(64)}`;
const TRANSACTION_BLOCK_ID = `0x${'5'.repeat(64)}`;
const REPLACEMENT_BLOCK_ID = `0x${'6'.repeat(64)}`;
const FINALIZED_BLOCK_ID = `0x${'7'.repeat(64)}`;
const SOLANA_TRANSACTION_ID = base58(new Uint8Array(64).fill(11));
const SOLANA_BLOCK_ID = base58(new Uint8Array(32).fill(12));
const NOW = '2026-09-07T18:00:00.000Z';
const DEADLINE = '2026-09-07T18:00:10.000Z';
const EXPIRES = '2026-09-07T18:00:20.000Z';
const SOURCE_AUTHORITY_FINGERPRINT = '8'.repeat(64);
const DEPLOYMENT_AUTHORITY_FINGERPRINT = '9'.repeat(64);
const SOURCE_PAIR_APPROVAL_ID = 'ethereum-mainnet-independent-pair-v1';
const SOURCE_PAIR_REGISTRY_FINGERPRINT = '7'.repeat(64);
const PRIMARY_DEPLOYMENT_MANIFEST_FINGERPRINT = 'a'.repeat(64);
const PRIMARY_OBSERVED_IDENTITY_FINGERPRINT = 'b'.repeat(64);
const CORROBORATING_DEPLOYMENT_MANIFEST_FINGERPRINT = 'c'.repeat(64);
const CORROBORATING_OBSERVED_IDENTITY_FINGERPRINT = 'd'.repeat(64);
const TERMINAL_TRANSITION_FINGERPRINT = '2'.repeat(64);
const ORIGINAL_ADMISSION_FINGERPRINT = '3'.repeat(64);

type ReviewDisposition = 'FINALITY_REAFFIRMED' | 'REVIEW_INCONCLUSIVE' | 'DEEP_REORG_QUARANTINED';

function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let encoded = '';
  while (number > 0n) {
    encoded = alphabet[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

function nullRecord<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

class FixtureFinalitySource implements MainnetFinancialActionFinalityEvidenceSourcePort {
  readonly sourceVersion = MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION;
  readonly #issued = new WeakMap<
    object,
    ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1
  >();

  constructor(
    private readonly sequence: 'PRIMARY' | 'CORROBORATING',
    private readonly reviewDisposition: ReviewDisposition = 'FINALITY_REAFFIRMED',
  ) {}

  async readAttestation(
    request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  ): Promise<unknown> {
    const { evaluatedAt, deadlineAt: _deadlineAt, signal: _signal, ...requestEvidence } = request;
    void _deadlineAt;
    void _signal;
    if (
      request.chainAnchor.kind !== 'EVM_BLOCK' ||
      request.agreedFinalizedHead.kind !== 'EVM_BLOCK'
    ) {
      throw new Error('fixture supports Ethereum only');
    }
    const common = {
      ...requestEvidence,
      use: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE,
      deploymentAuthorityId: DEPLOYMENT_AUTHORITY_ID,
      deploymentAuthorityFingerprintSha256: DEPLOYMENT_AUTHORITY_FINGERPRINT,
      transactionPosition: request.chainAnchor.blockNumber,
      transactionBlockId: request.chainAnchor.blockHash,
      finalizedPosition: request.agreedFinalizedHead.blockNumber,
      finalizedBlockId: request.agreedFinalizedHead.blockHash,
      transactionEvidenceSha256: this.sequence === 'PRIMARY' ? 'a'.repeat(64) : 'b'.repeat(64),
      observedAt: evaluatedAt,
      assessedAt: evaluatedAt,
      attestationSha256: this.sequence === 'PRIMARY' ? 'c'.repeat(64) : 'd'.repeat(64),
    };
    const attestation =
      request.purpose === 'RECONCILIATION_ADMISSION'
        ? nullRecord({
            ...common,
            purpose: 'RECONCILIATION_ADMISSION' as const,
            outcome: 'FINALIZED_SUCCESS' as const,
            effectEvidenceSha256: this.sequence === 'PRIMARY' ? 'e'.repeat(64) : 'f'.repeat(64),
            failureEvidenceSha256: null,
          })
        : nullRecord({
            ...common,
            purpose: 'POST_FINALITY_REVIEW' as const,
            disposition: this.reviewDisposition,
            lineageStatus:
              this.reviewDisposition === 'DEEP_REORG_QUARANTINED'
                ? ('CONFLICT' as const)
                : this.reviewDisposition === 'REVIEW_INCONCLUSIVE'
                  ? ('UNKNOWN' as const)
                  : ('CANONICAL' as const),
          });
    this.#issued.set(attestation, request);
    return attestation as unknown as MainnetFinancialActionFinalityEvidenceSourceAttestationV1;
  }

  verifyAttestation(
    capability: unknown,
    request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  ): boolean {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      this.#issued.get(capability) === request
    );
  }
}

interface GenuineEvidence<
  Request extends
    | ProduceMainnetFinancialActionReconciliationEvidenceRequestV1
    | ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
> {
  readonly producer: DormantMainnetFinancialActionFinalityEvidenceProducer;
  readonly request: Request;
  readonly capability: unknown;
  readonly clock: jest.Mock<Date, []>;
}

async function genuineReconciliationEvidence(
  signal: AbortSignal,
): Promise<GenuineEvidence<ProduceMainnetFinancialActionReconciliationEvidenceRequestV1>> {
  const prerequisiteCapability = Object.freeze(Object.create(null) as object);
  const prerequisiteRequest = nullRecord({
    prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
    use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE,
    purpose: 'RECONCILIATION_ADMISSION' as const,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    signal,
  });
  const prerequisite = reconciliationPrerequisite(signal);
  const port: MainnetFinancialActionFinalityEvidencePrerequisitePort = {
    prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
    reviewReconciliationPrerequisite: (capability, request) =>
      capability === prerequisiteCapability && request === prerequisiteRequest
        ? prerequisite
        : null,
    reviewPostFinalityPrerequisite: () => null,
  };
  const producerFixture = evidenceProducer(port, 'FINALITY_REAFFIRMED');
  const request = nullRecord({
    producerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
    use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_USE,
    purpose: 'RECONCILIATION_ADMISSION' as const,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    prerequisiteCapability,
    prerequisiteRequest,
    signal,
  });
  const capability =
    await producerFixture.producer.produceReconciliationAdmissionCandidate(request);
  return { ...producerFixture, request, capability };
}

async function genuinePostFinalityEvidence(
  signal: AbortSignal,
  reviewDisposition: ReviewDisposition,
  blocks: Readonly<{
    current: typeof TRANSACTION_BLOCK_ID | typeof REPLACEMENT_BLOCK_ID;
    terminal: typeof TRANSACTION_BLOCK_ID | typeof REPLACEMENT_BLOCK_ID;
  }> = {
    current:
      reviewDisposition === 'DEEP_REORG_QUARANTINED' ? REPLACEMENT_BLOCK_ID : TRANSACTION_BLOCK_ID,
    terminal: TRANSACTION_BLOCK_ID,
  },
): Promise<GenuineEvidence<ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1>> {
  const prerequisiteCapability = Object.freeze(Object.create(null) as object);
  const prerequisiteRequest = nullRecord({
    prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
    use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE,
    purpose: 'POST_FINALITY_REVIEW' as const,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    signal,
  });
  const prerequisite = postFinalityPrerequisite(signal, blocks.current, blocks.terminal);
  const port: MainnetFinancialActionFinalityEvidencePrerequisitePort = {
    prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
    reviewReconciliationPrerequisite: () => null,
    reviewPostFinalityPrerequisite: (capability, request) =>
      capability === prerequisiteCapability && request === prerequisiteRequest
        ? prerequisite
        : null,
  };
  const producerFixture = evidenceProducer(port, reviewDisposition);
  const request = nullRecord({
    producerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
    use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE,
    purpose: 'POST_FINALITY_REVIEW' as const,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    prerequisiteCapability,
    prerequisiteRequest,
    signal,
  });
  const capability = await producerFixture.producer.producePostFinalityReviewCandidate(request);
  return { ...producerFixture, request, capability };
}

function evidenceProducer(
  prerequisitePort: MainnetFinancialActionFinalityEvidencePrerequisitePort,
  reviewDisposition: ReviewDisposition,
): Readonly<{
  producer: DormantMainnetFinancialActionFinalityEvidenceProducer;
  clock: jest.Mock<Date, []>;
}> {
  const primary = new FixtureFinalitySource('PRIMARY', reviewDisposition);
  const corroborating = new FixtureFinalitySource('CORROBORATING', reviewDisposition);
  const bindings: readonly MainnetFinancialActionFinalityEvidenceSourceBindingV1[] = Object.freeze([
    Object.freeze({
      networkId: 'eip155:1' as const,
      sourceAuthorityId: SOURCE_AUTHORITY_ID,
      sourceAuthorityFingerprintSha256: SOURCE_AUTHORITY_FINGERPRINT,
      role: 'PRIMARY' as const,
      sourceFamilyId: 'primary-rpc',
      sourceId: 'primary-rpc-mainnet',
      sourceKind: 'RPC' as const,
      source: primary,
    }),
    Object.freeze({
      networkId: 'eip155:1' as const,
      sourceAuthorityId: SOURCE_AUTHORITY_ID,
      sourceAuthorityFingerprintSha256: SOURCE_AUTHORITY_FINGERPRINT,
      role: 'CORROBORATING' as const,
      sourceFamilyId: 'corroborating-rpc',
      sourceId: 'corroborating-rpc-mainnet',
      sourceKind: 'RPC' as const,
      source: corroborating,
    }),
  ]);
  const clock = jest.fn<Date, []>(() => new Date(NOW));
  return {
    producer: new DormantMainnetFinancialActionFinalityEvidenceProducer(
      prerequisitePort,
      bindings,
      { now: clock },
    ),
    clock,
  };
}

function prerequisiteCommon(
  signal: AbortSignal,
  transactionBlockId: typeof TRANSACTION_BLOCK_ID | typeof REPLACEMENT_BLOCK_ID,
): Record<string, unknown> {
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  return {
    prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    accountId: ACCOUNT_ID,
    intentId: INTENT_ID,
    intentRecordFingerprintSha256: 'a'.repeat(64),
    walletRegistrationId: WALLET_ID,
    walletAddress: '0x1111111111111111111111111111111111111111',
    networkId: 'eip155:1',
    lifecycleSnapshotSha256: '1'.repeat(64),
    transactionId: TRANSACTION_ID,
    walletSignedPayloadSha256: 'b'.repeat(64),
    walletSignatureEvidenceSha256: 'c'.repeat(64),
    chainAnchorEvidenceFingerprintSha256: 'd'.repeat(64),
    chainAnchor: nullRecord({
      kind: 'EVM_BLOCK' as const,
      blockNumber: '100',
      blockHash: transactionBlockId,
    }),
    agreedFinalizedHead: nullRecord({
      kind: 'EVM_BLOCK' as const,
      blockNumber: '120',
      blockHash: FINALIZED_BLOCK_ID,
    }),
    chainAnchorEvidenceExpiresAt: EXPIRES,
    sourceAuthorityId: SOURCE_AUTHORITY_ID,
    sourceAuthorityFingerprintSha256: SOURCE_AUTHORITY_FINGERPRINT,
    sourceAuthorityExpiresAt: EXPIRES,
    sourcePairApprovalId: SOURCE_PAIR_APPROVAL_ID,
    sourcePairRegistryFingerprintSha256: SOURCE_PAIR_REGISTRY_FINGERPRINT,
    primarySourceFamilyId: 'primary-rpc',
    primarySourceId: 'primary-rpc-mainnet',
    primarySourceKind: 'RPC',
    corroboratingSourceFamilyId: 'corroborating-rpc',
    corroboratingSourceId: 'corroborating-rpc-mainnet',
    corroboratingSourceKind: 'RPC',
    deploymentAuthorityId: DEPLOYMENT_AUTHORITY_ID,
    deploymentAuthorityFingerprintSha256: DEPLOYMENT_AUTHORITY_FINGERPRINT,
    deploymentAuthorityExpiresAt: EXPIRES,
    primaryDeploymentManifestFingerprintSha256: PRIMARY_DEPLOYMENT_MANIFEST_FINGERPRINT,
    primaryObservedIdentityFingerprintSha256: PRIMARY_OBSERVED_IDENTITY_FINGERPRINT,
    corroboratingDeploymentManifestFingerprintSha256: CORROBORATING_DEPLOYMENT_MANIFEST_FINGERPRINT,
    corroboratingObservedIdentityFingerprintSha256: CORROBORATING_OBSERVED_IDENTITY_FINGERPRINT,
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: '0x2222222222222222222222222222222222222222',
    assetRegistryVersion: registry.version,
    assetRegistryFingerprintSha256: registry.fingerprintSha256,
    assetSymbol: 'USDC',
    assetIdentity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    assetDecimals: 6,
    action: 'SUPPLY',
    amountAtomic: '1000000',
    correlationId: CORRELATION_ID,
    verifiedAt: NOW,
    deadlineAt: DEADLINE,
    signal,
  };
}

function reconciliationPrerequisite(
  signal: AbortSignal,
): MainnetFinancialActionReconciliationEvidencePrerequisiteV1 {
  return nullRecord({
    ...prerequisiteCommon(signal, TRANSACTION_BLOCK_ID),
    use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE,
    purpose: 'RECONCILIATION_ADMISSION' as const,
    lifecycleRevision: '2',
    lifecycleStage: 'BROADCAST_OUTCOME_AMBIGUOUS' as const,
    observationId: OBSERVATION_ID,
  }) as unknown as MainnetFinancialActionReconciliationEvidencePrerequisiteV1;
}

function postFinalityPrerequisite(
  signal: AbortSignal,
  currentTransactionBlockId: typeof TRANSACTION_BLOCK_ID | typeof REPLACEMENT_BLOCK_ID,
  terminalTransactionBlockId: typeof TRANSACTION_BLOCK_ID | typeof REPLACEMENT_BLOCK_ID,
): MainnetFinancialActionPostFinalityEvidencePrerequisiteV1 {
  return nullRecord({
    ...prerequisiteCommon(signal, currentTransactionBlockId),
    use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE,
    purpose: 'POST_FINALITY_REVIEW' as const,
    lifecycleRevision: '3',
    lifecycleStage: 'FINALIZED_SUCCESS' as const,
    terminalTransitionFingerprintSha256: TERMINAL_TRANSITION_FINGERPRINT,
    originalAdmissionFingerprintSha256: ORIGINAL_ADMISSION_FINGERPRINT,
    terminalTransactionPosition: '100',
    terminalTransactionBlockId,
    expectedReviewRevision: '0',
    expectedPreviousReviewFingerprintSha256: null,
    effectiveSafetyState: 'AUTHENTICATED_FINALITY_RECORDED' as const,
    reviewId: REVIEW_ID,
  }) as unknown as MainnetFinancialActionPostFinalityEvidencePrerequisiteV1;
}

function inertProducer(): DormantMainnetFinancialActionFinalityEvidenceProducer {
  const prerequisitePort: MainnetFinancialActionFinalityEvidencePrerequisitePort = {
    prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
    reviewReconciliationPrerequisite: () => null,
    reviewPostFinalityPrerequisite: () => null,
  };
  return new DormantMainnetFinancialActionFinalityEvidenceProducer(
    prerequisitePort,
    Object.freeze([]),
    { now: () => new Date('2026-09-07T18:00:00.000Z') },
  );
}

function queryResult(row: Record<string, unknown>): unknown {
  return { rows: [row] };
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
}> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) throw new Error('deferred promise was not initialized');
  return Object.freeze({ promise, resolve: resolvePromise });
}

function readRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    lifecycle_stage: 'FINALIZED_SUCCESS',
    network_id: 'eip155:1',
    lifecycle_revision: '3',
    current_snapshot_sha256: '1'.repeat(64),
    current_transition_fingerprint_sha256: '2'.repeat(64),
    admission_fingerprint_sha256: '3'.repeat(64),
    chain_transaction_id: TRANSACTION_ID,
    transaction_position: '100',
    transaction_block_id: TRANSACTION_BLOCK_ID,
    authenticated_reconciliation: true,
    review_revision: '0',
    review_fingerprint_sha256: null,
    latest_review_disposition: null,
    effective_safety_state: 'AUTHENTICATED_FINALITY_RECORDED',
    requires_manual_review: false,
    may_authorize_financial_action: false,
    may_resend_transaction: false,
    ledger_settlement_authority: false,
    ...overrides,
  };
}

function admissionRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    admission_outcome: 'RECORDED',
    admission_fingerprint_sha256: ORIGINAL_ADMISSION_FINGERPRINT,
    admitted_event_revision: '3',
    admitted_transition_fingerprint_sha256: TERMINAL_TRANSITION_FINGERPRINT,
    lifecycle_stage: 'FINALIZED_SUCCESS',
    lifecycle_revision: '3',
    current_snapshot_sha256: '1'.repeat(64),
    source_evidence_sha256: '4'.repeat(64),
    effect_evidence_sha256: '5'.repeat(64),
    failure_evidence_sha256: null,
    terminal: true,
    requires_manual_reconciliation: false,
    ledger_settlement_authority: false,
    recorded_at: NOW,
    ...overrides,
  };
}

function reviewRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    record_outcome: 'RECORDED',
    review_fingerprint_sha256: '6'.repeat(64),
    review_revision: '1',
    current_review_revision: '1',
    current_review_fingerprint_sha256: '6'.repeat(64),
    current_review_disposition: 'FINALITY_REAFFIRMED',
    effective_safety_state: 'AUTHENTICATED_FINALITY_RECORDED',
    requires_manual_review: false,
    ledger_settlement_authority: false,
    recorded_at: NOW,
    ...overrides,
  };
}

interface TestSidecar {
  readonly sidecarVersion: 1;
  recordAuthenticatedAdmission(
    request: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
  ): Promise<unknown>;
  recordPostFinalityReview(
    request: RecordMainnetFinancialActionPostFinalityReviewRequestV1,
  ): Promise<unknown>;
  readEffectiveSafetyState(
    request: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
  ): Promise<unknown>;
  reviewResult(
    capability: unknown,
    request: DormantMainnetFinancialActionFinalitySidecarRequestV1,
  ): DormantMainnetFinancialActionFinalitySidecarResultV1 | null;
}

function testSidecar(
  reader: DormantMainnetFinancialActionEffectiveSafetyReaderPort,
  persistence: DormantMainnetFinancialActionFinalityPersistencePort,
): TestSidecar {
  return Object.freeze({
    sidecarVersion: reader.sidecarVersion,
    recordAuthenticatedAdmission: (
      request: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
    ) => persistence.recordAuthenticatedAdmission(request),
    recordPostFinalityReview: (request: RecordMainnetFinancialActionPostFinalityReviewRequestV1) =>
      persistence.recordPostFinalityReview(request),
    readEffectiveSafetyState: (request: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1) =>
      reader.readEffectiveSafetyState(request),
    reviewResult: (
      capability: unknown,
      request: DormantMainnetFinancialActionFinalitySidecarRequestV1,
    ) =>
      reader.reviewResult(
        capability,
        request as ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
      ) ??
      persistence.reviewResult(
        capability,
        request as
          | RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1
          | RecordMainnetFinancialActionPostFinalityReviewRequestV1,
      ),
  });
}

function fixture(
  implementation: (...arguments_: unknown[]) => Promise<unknown> = async () =>
    queryResult(readRow()),
): {
  readonly adapter: TestSidecar;
  readonly reader: PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter;
  readonly persistence: DormantMainnetFinancialActionFinalityPersistencePort;
  readonly query: jest.Mock<Promise<unknown>, unknown[]>;
} {
  return adapterFixture(inertProducer(), implementation);
}

function adapterFixture(
  producer: DormantMainnetFinancialActionFinalityEvidenceProducer,
  implementation: (...arguments_: unknown[]) => Promise<unknown>,
): {
  readonly adapter: TestSidecar;
  readonly reader: PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter;
  readonly persistence: DormantMainnetFinancialActionFinalityPersistencePort;
  readonly query: jest.Mock<Promise<unknown>, unknown[]>;
} {
  const query = jest.fn<Promise<unknown>, unknown[]>(implementation);
  const postgres = { queryWithCancellation: query } as unknown as PostgresService;
  const reader = new PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter(postgres);
  const persistence = reader.bindPersistence(producer);
  return {
    adapter: testSidecar(reader, persistence),
    reader,
    persistence,
    query,
  };
}

function readRequest(
  signal: AbortSignal = new AbortController().signal,
): ReadMainnetFinancialActionEffectiveSafetyStateRequestV1 {
  return nullRecord({ accountId: ACCOUNT_ID, intentId: INTENT_ID, signal });
}

function reviewedRead(
  adapter: TestSidecar,
  capability: unknown,
  request: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
): DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1 {
  const result = adapter.reviewResult(capability, request);
  if (result?.outcome !== 'DATABASE_STATE_CONFIRMED') {
    throw new Error('expected confirmed result');
  }
  return result as DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1;
}

function reviewedAdmission(
  adapter: TestSidecar,
  capability: unknown,
  request: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1,
): DormantMainnetFinancialActionAdmissionDatabaseConfirmedResultV1 {
  const result = adapter.reviewResult(capability, request);
  if (result?.outcome !== 'DATABASE_STATE_CONFIRMED') {
    throw new Error('expected confirmed admission');
  }
  return result as DormantMainnetFinancialActionAdmissionDatabaseConfirmedResultV1;
}

function reviewedPostFinality(
  adapter: TestSidecar,
  capability: unknown,
  request: RecordMainnetFinancialActionPostFinalityReviewRequestV1,
): DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1 {
  const result = adapter.reviewResult(capability, request);
  if (
    result?.outcome !== 'DATABASE_STATE_CONFIRMED' ||
    result.operation !== 'RECORD_POST_FINALITY_REVIEW'
  ) {
    throw new Error('expected confirmed post-finality review');
  }
  return result as DormantMainnetFinancialActionEffectiveSafetyDatabaseConfirmedResultV1;
}

describe('PostgresDormantMainnetFinancialActionFinalitySidecarAdapter', () => {
  it('reads before producer construction and binds exactly one frozen persistence facet', async () => {
    const query = jest.fn(() => Promise.resolve(queryResult(readRow())));
    const reader = new PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter({
      queryWithCancellation: query,
    } as unknown as PostgresService);
    const request = readRequest();

    const capability = await reader.readEffectiveSafetyState(request);
    expect(reader.reviewResult(capability, request)).toBe(capability);
    expect(reader).not.toHaveProperty('recordAuthenticatedAdmission');
    expect(reader).not.toHaveProperty('recordPostFinalityReview');

    const persistence = reader.bindPersistence(inertProducer());
    expect(Object.isFrozen(persistence)).toBe(true);
    expect(persistence).not.toHaveProperty('readEffectiveSafetyState');
    expect(() => reader.bindPersistence(inertProducer())).toThrow(
      DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('double-reviews genuine admission evidence and dispatches one exact 24-value call', async () => {
    const signal = new AbortController().signal;
    const evidence = await genuineReconciliationEvidence(signal);
    const candidate = evidence.producer.reviewReconciliationAdmissionCandidate(
      evidence.capability,
      evidence.request,
    );
    evidence.clock.mockClear();
    const test = adapterFixture(evidence.producer, async () => queryResult(admissionRow()));
    const request: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1 = nullRecord({
      evidenceCapability: evidence.capability,
      evidenceRequest: evidence.request,
      signal,
    });

    const capability = await test.adapter.recordAuthenticatedAdmission(request);
    const result = reviewedAdmission(test.adapter, capability, request);

    expect(evidence.clock).toHaveBeenCalledTimes(2);
    expect(test.query).toHaveBeenCalledTimes(1);
    const [sql, values, dispatchedSignal] = test.query.mock.calls[0] ?? [];
    expect(sql).toContain('record_authenticated_mainnet_financial_action_reconciliation_v2');
    expect(sql).not.toContain('record_authenticated_mainnet_financial_action_reconciliation_v1');
    expect(sql).not.toContain('INSERT');
    expect(values).toEqual(candidate.admissionArguments);
    expect(values).toHaveLength(24);
    expect(dispatchedSignal).toBe(signal);
    expect(result).toMatchObject({
      outcome: 'DATABASE_STATE_CONFIRMED',
      operation: 'RECORD_AUTHENTICATED_ADMISSION',
      databaseRecordOutcome: 'RECORDED',
      admissionFingerprintSha256: ORIGINAL_ADMISSION_FINGERPRINT,
      admittedEventRevision: '3',
      admittedTransitionFingerprintSha256: TERMINAL_TRANSITION_FINGERPRINT,
      lifecycleStage: 'FINALIZED_SUCCESS',
      lifecycleRevision: '3',
      terminal: true,
      mayAuthorizeFinancialAction: false,
      mayConstructTransaction: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      mayResendTransaction: false,
      automaticRetryAllowed: false,
      ledgerSettlementAuthority: false,
      recoveryMode: 'READ_ONLY',
    });
  });

  it('reads one effective state and seals a restart-safe terminal cursor', async () => {
    const test = fixture();
    const request = readRequest();
    const capability = await test.adapter.readEffectiveSafetyState(request);
    const result = reviewedRead(test.adapter, capability, request);

    expect(test.query).toHaveBeenCalledTimes(1);
    const [sql, values, signal] = test.query.mock.calls[0] ?? [];
    expect(sql).toContain('read_mainnet_financial_action_effective_safety_state_v1');
    expect(sql).not.toContain('INSERT');
    expect(values).toEqual([ACCOUNT_ID, INTENT_ID]);
    expect(signal).toBe(request.signal);
    expect(result).toMatchObject({
      outcome: 'DATABASE_STATE_CONFIRMED',
      operation: 'READ_EFFECTIVE_SAFETY_STATE',
      databaseRecordOutcome: 'READ',
      lifecycleStage: 'FINALIZED_SUCCESS',
      authenticatedReconciliation: true,
      reviewRevision: '0',
      reviewFingerprintSha256: null,
      effectiveSafetyState: 'AUTHENTICATED_FINALITY_RECORDED',
      requiresManualReview: false,
      mayAuthorizeFinancialAction: false,
      mayConstructTransaction: false,
      apiMaySign: false,
      apiMayBroadcast: false,
      mayResendTransaction: false,
      automaticRetryAllowed: false,
      ledgerSettlementAuthority: false,
    });
    expect(result.cursor).toEqual({
      schemaVersion: 1,
      source: 'MIGRATION_0035_DATABASE',
      fingerprintEncoding: 'CLMA-FP-1',
      accountId: ACCOUNT_ID,
      intentId: INTENT_ID,
      networkId: 'eip155:1',
      terminalRevision: '3',
      terminalSnapshotSha256: '1'.repeat(64),
      terminalTransitionFingerprintSha256: '2'.repeat(64),
      originalAdmissionFingerprintSha256: '3'.repeat(64),
      chainTransactionId: TRANSACTION_ID,
      transactionPosition: '100',
      transactionBlockId: TRANSACTION_BLOCK_ID,
      reviewRevision: '0',
      reviewFingerprintSha256: null,
    });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.getPrototypeOf(result.cursor as object)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.cursor)).toBe(true);
  });

  it('uses the database-authored Solana network when validating cursor identities', async () => {
    const test = fixture(async () =>
      queryResult(
        readRow({
          network_id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          chain_transaction_id: SOLANA_TRANSACTION_ID,
          transaction_block_id: SOLANA_BLOCK_ID,
        }),
      ),
    );
    const request = readRequest();
    const result = reviewedRead(
      test.adapter,
      await test.adapter.readEffectiveSafetyState(request),
      request,
    );

    expect(result.cursor).toMatchObject({
      networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      chainTransactionId: SOLANA_TRANSACTION_ID,
      transactionBlockId: SOLANA_BLOCK_ID,
    });
  });

  it.each([
    ['FINALITY_REAFFIRMED', 'AUTHENTICATED_FINALITY_RECORDED', false],
    ['REVIEW_INCONCLUSIVE', 'POST_FINALITY_REVIEW_INCONCLUSIVE', true],
  ] as const)(
    'double-reviews %s evidence and dispatches one exact 25-value review call',
    async (disposition, effectiveSafetyState, requiresManualReview) => {
      const signal = new AbortController().signal;
      const evidence = await genuinePostFinalityEvidence(signal, disposition);
      const candidate = evidence.producer.reviewPostFinalityReviewCandidate(
        evidence.capability,
        evidence.request,
      );
      evidence.clock.mockClear();
      let call = 0;
      const test = adapterFixture(evidence.producer, async () => {
        call += 1;
        return queryResult(
          call === 1
            ? readRow()
            : reviewRow({
                current_review_disposition: disposition,
                effective_safety_state: effectiveSafetyState,
                requires_manual_review: requiresManualReview,
              }),
        );
      });
      const read = readRequest(signal);
      const readResult = reviewedRead(
        test.adapter,
        await test.adapter.readEffectiveSafetyState(read),
        read,
      );
      if (readResult.cursor === null) throw new Error('expected eligible cursor');
      const request: RecordMainnetFinancialActionPostFinalityReviewRequestV1 = nullRecord({
        evidenceCapability: evidence.capability,
        evidenceRequest: evidence.request,
        effectiveSafetyCursor: readResult.cursor,
        effectiveSafetyReadRequest: read,
        signal,
      });

      const capability = await test.adapter.recordPostFinalityReview(request);
      const result = reviewedPostFinality(test.adapter, capability, request);

      expect(evidence.clock).toHaveBeenCalledTimes(2);
      expect(test.query).toHaveBeenCalledTimes(2);
      const [sql, values, dispatchedSignal] = test.query.mock.calls[1] ?? [];
      expect(sql).toContain('record_mainnet_financial_action_post_finality_review_v2');
      expect(sql).not.toContain('record_mainnet_financial_action_post_finality_review_v1');
      expect(sql).not.toContain('INSERT');
      expect(values).toEqual(candidate.reviewArguments);
      expect(values).toHaveLength(25);
      expect(dispatchedSignal).toBe(signal);
      expect(result).toMatchObject({
        outcome: 'DATABASE_STATE_CONFIRMED',
        operation: 'RECORD_POST_FINALITY_REVIEW',
        databaseRecordOutcome: 'RECORDED',
        cursor: null,
        lifecycleStage: 'FINALIZED_SUCCESS',
        authenticatedReconciliation: true,
        reviewRevision: '1',
        latestReviewDisposition: disposition,
        effectiveSafetyState,
        requiresManualReview,
        mayAuthorizeFinancialAction: false,
        mayConstructTransaction: false,
        apiMaySign: false,
        apiMayBroadcast: false,
        mayResendTransaction: false,
        automaticRetryAllowed: false,
        ledgerSettlementAuthority: false,
        recoveryMode: 'READ_ONLY',
      });

      await expect(test.adapter.recordPostFinalityReview(request)).rejects.toBe(
        DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
      );
      expect(evidence.clock).toHaveBeenCalledTimes(2);
      expect(test.query).toHaveBeenCalledTimes(2);
    },
  );

  it('accepts a deep-reorg replacement block while retaining the original block in the cursor', async () => {
    const signal = new AbortController().signal;
    const evidence = await genuinePostFinalityEvidence(signal, 'DEEP_REORG_QUARANTINED');
    const candidate = evidence.producer.reviewPostFinalityReviewCandidate(
      evidence.capability,
      evidence.request,
    );
    evidence.clock.mockClear();
    let call = 0;
    const test = adapterFixture(evidence.producer, async () => {
      call += 1;
      return queryResult(
        call === 1
          ? readRow()
          : reviewRow({
              current_review_disposition: 'DEEP_REORG_QUARANTINED',
              effective_safety_state: 'DEEP_REORG_QUARANTINED',
              requires_manual_review: true,
            }),
      );
    });
    const read = readRequest(signal);
    const readResult = reviewedRead(
      test.adapter,
      await test.adapter.readEffectiveSafetyState(read),
      read,
    );
    if (readResult.cursor === null) throw new Error('expected eligible cursor');
    const cursor = readResult.cursor;
    const request: RecordMainnetFinancialActionPostFinalityReviewRequestV1 = nullRecord({
      evidenceCapability: evidence.capability,
      evidenceRequest: evidence.request,
      effectiveSafetyCursor: cursor,
      effectiveSafetyReadRequest: read,
      signal,
    });

    const result = reviewedPostFinality(
      test.adapter,
      await test.adapter.recordPostFinalityReview(request),
      request,
    );

    expect(evidence.clock).toHaveBeenCalledTimes(2);
    expect(test.query).toHaveBeenCalledTimes(2);
    const values = test.query.mock.calls[1]?.[1] as readonly unknown[];
    expect(values).toEqual(candidate.reviewArguments);
    expect(values[11]).toBe(REPLACEMENT_BLOCK_ID);
    expect(values[11]).not.toBe(cursor.transactionBlockId);
    expect(cursor.transactionBlockId).toBe(TRANSACTION_BLOCK_ID);
    expect(result).toMatchObject({
      cursor: null,
      latestReviewDisposition: 'DEEP_REORG_QUARANTINED',
      effectiveSafetyState: 'DEEP_REORG_QUARANTINED',
      requiresManualReview: true,
    });
  });

  it.each([
    {
      label: 'authority-controlled exact replay',
      row: reviewRow({
        record_outcome: 'REPLAYED',
        effective_safety_state: 'AUTHORITY_CONTROLLED_QUARANTINED',
        requires_manual_review: true,
      }),
      expected: {
        recordedReviewRevision: '1',
        recordedReviewFingerprintSha256: '6'.repeat(64),
        recordedReviewDisposition: 'FINALITY_REAFFIRMED',
        reviewRevision: '1',
        reviewFingerprintSha256: '6'.repeat(64),
        latestReviewDisposition: 'FINALITY_REAFFIRMED',
        effectiveSafetyState: 'AUTHORITY_CONTROLLED_QUARANTINED',
      },
    },
    {
      label: 'older exact replay after a later deep-reorg review',
      row: reviewRow({
        record_outcome: 'REPLAYED',
        current_review_revision: '2',
        current_review_fingerprint_sha256: '7'.repeat(64),
        current_review_disposition: 'DEEP_REORG_QUARANTINED',
        effective_safety_state: 'DEEP_REORG_QUARANTINED',
        requires_manual_review: true,
      }),
      expected: {
        recordedReviewRevision: '1',
        recordedReviewFingerprintSha256: '6'.repeat(64),
        recordedReviewDisposition: 'FINALITY_REAFFIRMED',
        reviewRevision: '2',
        reviewFingerprintSha256: '7'.repeat(64),
        latestReviewDisposition: 'DEEP_REORG_QUARANTINED',
        effectiveSafetyState: 'DEEP_REORG_QUARANTINED',
      },
    },
  ])('returns one coherent current snapshot for $label', async ({ row, expected }) => {
    const signal = new AbortController().signal;
    const evidence = await genuinePostFinalityEvidence(signal, 'FINALITY_REAFFIRMED');
    evidence.clock.mockClear();
    let call = 0;
    const test = adapterFixture(evidence.producer, async () => {
      call += 1;
      return queryResult(call === 1 ? readRow() : row);
    });
    const read = readRequest(signal);
    const readResult = reviewedRead(
      test.adapter,
      await test.adapter.readEffectiveSafetyState(read),
      read,
    );
    if (readResult.cursor === null) throw new Error('expected eligible cursor');
    const request: RecordMainnetFinancialActionPostFinalityReviewRequestV1 = nullRecord({
      evidenceCapability: evidence.capability,
      evidenceRequest: evidence.request,
      effectiveSafetyCursor: readResult.cursor,
      effectiveSafetyReadRequest: read,
      signal,
    });

    const result = reviewedPostFinality(
      test.adapter,
      await test.adapter.recordPostFinalityReview(request),
      request,
    );
    expect(result).toMatchObject(expected);
    expect(result.requiresManualReview).toBe(true);
    expect(result.cursor).toBeNull();
  });

  it.each([DEADLINE, '2026-09-07T18:00:11.000Z'])(
    'rejects admission and review rows recorded outside the candidate deadline at %s',
    async (recordedAt) => {
      const admissionSignal = new AbortController().signal;
      const admissionEvidence = await genuineReconciliationEvidence(admissionSignal);
      admissionEvidence.clock.mockClear();
      const admissionTest = adapterFixture(admissionEvidence.producer, async () =>
        queryResult(admissionRow({ recorded_at: recordedAt })),
      );
      const admissionRequest: RecordAuthenticatedMainnetFinancialActionAdmissionRequestV1 =
        nullRecord({
          evidenceCapability: admissionEvidence.capability,
          evidenceRequest: admissionEvidence.request,
          signal: admissionSignal,
        });
      const admissionCapability =
        await admissionTest.adapter.recordAuthenticatedAdmission(admissionRequest);
      expect(
        admissionTest.adapter.reviewResult(admissionCapability, admissionRequest),
      ).toMatchObject({
        outcome: 'DATABASE_OUTCOME_UNKNOWN',
        operation: 'RECORD_AUTHENTICATED_ADMISSION',
      });

      const reviewSignal = new AbortController().signal;
      const reviewEvidence = await genuinePostFinalityEvidence(reviewSignal, 'FINALITY_REAFFIRMED');
      reviewEvidence.clock.mockClear();
      let call = 0;
      const reviewTest = adapterFixture(reviewEvidence.producer, async () => {
        call += 1;
        return queryResult(call === 1 ? readRow() : reviewRow({ recorded_at: recordedAt }));
      });
      const read = readRequest(reviewSignal);
      const readResult = reviewedRead(
        reviewTest.adapter,
        await reviewTest.adapter.readEffectiveSafetyState(read),
        read,
      );
      if (readResult.cursor === null) throw new Error('expected eligible cursor');
      const reviewRequest: RecordMainnetFinancialActionPostFinalityReviewRequestV1 = nullRecord({
        evidenceCapability: reviewEvidence.capability,
        evidenceRequest: reviewEvidence.request,
        effectiveSafetyCursor: readResult.cursor,
        effectiveSafetyReadRequest: read,
        signal: reviewSignal,
      });
      const reviewCapability = await reviewTest.adapter.recordPostFinalityReview(reviewRequest);
      expect(reviewTest.adapter.reviewResult(reviewCapability, reviewRequest)).toMatchObject({
        outcome: 'DATABASE_OUTCOME_UNKNOWN',
        operation: 'RECORD_POST_FINALITY_REVIEW',
      });
    },
  );

  it.each([
    [
      'ordinary review with a changed block',
      'FINALITY_REAFFIRMED',
      REPLACEMENT_BLOCK_ID,
      REPLACEMENT_BLOCK_ID,
    ],
    [
      'deep-reorg review with the cursor original block',
      'DEEP_REORG_QUARANTINED',
      TRANSACTION_BLOCK_ID,
      REPLACEMENT_BLOCK_ID,
    ],
  ] as const)(
    'rejects %s before mutation SQL',
    async (_label, disposition, currentBlock, terminalBlock) => {
      const signal = new AbortController().signal;
      const evidence = await genuinePostFinalityEvidence(signal, disposition, {
        current: currentBlock,
        terminal: terminalBlock,
      });
      evidence.clock.mockClear();
      const test = adapterFixture(evidence.producer, async () => queryResult(readRow()));
      const read = readRequest(signal);
      const readResult = reviewedRead(
        test.adapter,
        await test.adapter.readEffectiveSafetyState(read),
        read,
      );
      if (readResult.cursor === null) throw new Error('expected eligible cursor');
      const request: RecordMainnetFinancialActionPostFinalityReviewRequestV1 = nullRecord({
        evidenceCapability: evidence.capability,
        evidenceRequest: evidence.request,
        effectiveSafetyCursor: readResult.cursor,
        effectiveSafetyReadRequest: read,
        signal,
      });

      await expect(test.adapter.recordPostFinalityReview(request)).rejects.toBe(
        DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
      );
      expect(evidence.clock).toHaveBeenCalledTimes(1);
      expect(test.query).toHaveBeenCalledTimes(1);
    },
  );

  it('never emits a review-authorizing cursor for sticky deep-reorg quarantine', async () => {
    const test = fixture(async () =>
      queryResult(
        readRow({
          review_revision: '2',
          review_fingerprint_sha256: '6'.repeat(64),
          latest_review_disposition: 'DEEP_REORG_QUARANTINED',
          effective_safety_state: 'DEEP_REORG_QUARANTINED',
          requires_manual_review: true,
        }),
      ),
    );
    const request = readRequest();
    const result = reviewedRead(
      test.adapter,
      await test.adapter.readEffectiveSafetyState(request),
      request,
    );

    expect(result.cursor).toBeNull();
    expect(result.effectiveSafetyState).toBe('DEEP_REORG_QUARANTINED');
    expect(result.requiresManualReview).toBe(true);
  });

  it('fails closed without a cursor for an authority-controlled quarantine', async () => {
    const test = fixture(async () =>
      queryResult(
        readRow({
          effective_safety_state: 'AUTHORITY_CONTROLLED_QUARANTINED',
          requires_manual_review: true,
        }),
      ),
    );
    const request = readRequest();
    const result = reviewedRead(
      test.adapter,
      await test.adapter.readEffectiveSafetyState(request),
      request,
    );

    expect(result.cursor).toBeNull();
    expect(result.effectiveSafetyState).toBe('AUTHORITY_CONTROLLED_QUARANTINED');
    expect(result.requiresManualReview).toBe(true);
    expect(result.mayAuthorizeFinancialAction).toBe(false);
    expect(result.mayResendTransaction).toBe(false);
    expect(result.ledgerSettlementAuthority).toBe(false);
  });

  it('accepts authenticated nonterminal admission state without issuing a cursor', async () => {
    const test = fixture(async () =>
      queryResult(
        readRow({
          lifecycle_stage: 'RECONCILIATION_AMBIGUOUS',
          effective_safety_state: 'RECONCILIATION_PENDING',
        }),
      ),
    );
    const request = readRequest();
    const result = reviewedRead(
      test.adapter,
      await test.adapter.readEffectiveSafetyState(request),
      request,
    );

    expect(result.cursor).toBeNull();
    expect(result.authenticatedReconciliation).toBe(true);
    expect(result.effectiveSafetyState).toBe('RECONCILIATION_PENDING');
  });

  it('rejects request extensions, accessors, proxies, and aborted signals before I/O', async () => {
    const test = fixture();
    await expect(
      test.adapter.readEffectiveSafetyState({
        accountId: ACCOUNT_ID,
        intentId: INTENT_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE);
    const extra = { ...readRequest(), accountIdOverride: ACCOUNT_ID };
    await expect(test.adapter.readEffectiveSafetyState(extra as never)).rejects.toBe(
      DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
    );

    const accessor = Object.defineProperty(
      { intentId: INTENT_ID, signal: new AbortController().signal },
      'accountId',
      { enumerable: true, get: () => ACCOUNT_ID },
    );
    await expect(test.adapter.readEffectiveSafetyState(accessor as never)).rejects.toBe(
      DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
    );
    await expect(
      test.adapter.readEffectiveSafetyState(new Proxy(readRequest(), {}) as never),
    ).rejects.toBe(DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE);

    const controller = new AbortController();
    controller.abort();
    await expect(
      test.adapter.readEffectiveSafetyState(readRequest(controller.signal)),
    ).rejects.toBe(DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE);
    expect(test.query).not.toHaveBeenCalled();
  });

  it('rejects mutable admission and post-finality envelopes before mutation dispatch', async () => {
    const admissionSignal = new AbortController().signal;
    const admissionEvidence = await genuineReconciliationEvidence(admissionSignal);
    admissionEvidence.clock.mockClear();
    const admissionTest = adapterFixture(admissionEvidence.producer, async () =>
      queryResult(admissionRow()),
    );
    await expect(
      admissionTest.adapter.recordAuthenticatedAdmission({
        evidenceCapability: admissionEvidence.capability,
        evidenceRequest: admissionEvidence.request,
        signal: admissionSignal,
      }),
    ).rejects.toBe(DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE);
    expect(admissionTest.query).not.toHaveBeenCalled();

    const reviewSignal = new AbortController().signal;
    const reviewEvidence = await genuinePostFinalityEvidence(reviewSignal, 'FINALITY_REAFFIRMED');
    reviewEvidence.clock.mockClear();
    const reviewTest = adapterFixture(reviewEvidence.producer, async () => queryResult(readRow()));
    const read = readRequest(reviewSignal);
    const readResult = reviewedRead(
      reviewTest.adapter,
      await reviewTest.adapter.readEffectiveSafetyState(read),
      read,
    );
    if (readResult.cursor === null) throw new Error('expected eligible cursor');
    await expect(
      reviewTest.adapter.recordPostFinalityReview({
        evidenceCapability: reviewEvidence.capability,
        evidenceRequest: reviewEvidence.request,
        effectiveSafetyCursor: readResult.cursor,
        effectiveSafetyReadRequest: read,
        signal: reviewSignal,
      }),
    ).rejects.toBe(DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE);
    expect(reviewTest.query).toHaveBeenCalledTimes(1);
  });

  it('treats reject, non-native Promise, abort, and malformed rows as unknown without retry', async () => {
    const controller = new AbortController();
    const cases: readonly {
      readonly implementation: (...arguments_: unknown[]) => unknown;
      readonly request: ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;
    }[] = [
      {
        implementation: () => Promise.reject(new Error('secret database detail')),
        request: readRequest(),
      },
      {
        implementation: () => ({ then: () => undefined }),
        request: readRequest(),
      },
      {
        implementation: () => {
          controller.abort();
          return Promise.resolve(queryResult(readRow()));
        },
        request: readRequest(controller.signal),
      },
      {
        implementation: () => Promise.resolve({ rows: [readRow(), readRow()] }),
        request: readRequest(),
      },
      {
        implementation: () =>
          Promise.resolve(queryResult(readRow({ may_resend_transaction: true }))),
        request: readRequest(),
      },
      {
        implementation: () =>
          Promise.resolve(
            queryResult(readRow({ network_id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' })),
          ),
        request: readRequest(),
      },
    ];

    for (const item of cases) {
      const query = jest.fn(item.implementation);
      const adapter = new PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter({
        queryWithCancellation: query,
      } as unknown as PostgresService);
      const capability = await adapter.readEffectiveSafetyState(item.request);
      const result = adapter.reviewResult(capability, item.request);
      expect(result).toMatchObject({
        outcome: 'DATABASE_OUTCOME_UNKNOWN',
        operation: 'READ_EFFECTIVE_SAFETY_STATE',
        lastConfirmedEffectiveSafetyCursor: null,
        recoveryMode: 'READ_ONLY',
        automaticRetryAllowed: false,
        mayResendTransaction: false,
      } satisfies Partial<DormantMainnetFinancialActionFinalityDatabaseOutcomeUnknownV1>);
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it('preserves the last cursor on ambiguous review dispatch and requires read recovery', async () => {
    const signal = new AbortController().signal;
    const evidence = await genuinePostFinalityEvidence(signal, 'FINALITY_REAFFIRMED');
    evidence.producer.reviewPostFinalityReviewCandidate(evidence.capability, evidence.request);
    evidence.clock.mockClear();
    let call = 0;
    const test = adapterFixture(evidence.producer, async () => {
      call += 1;
      if (call === 2) throw new Error('secret database detail');
      return queryResult(readRow());
    });
    const read = readRequest(signal);
    const firstRead = reviewedRead(
      test.adapter,
      await test.adapter.readEffectiveSafetyState(read),
      read,
    );
    if (firstRead.cursor === null) throw new Error('expected eligible cursor');
    const request: RecordMainnetFinancialActionPostFinalityReviewRequestV1 = nullRecord({
      evidenceCapability: evidence.capability,
      evidenceRequest: evidence.request,
      effectiveSafetyCursor: firstRead.cursor,
      effectiveSafetyReadRequest: read,
      signal,
    });

    const capability = await test.adapter.recordPostFinalityReview(request);
    const result = test.adapter.reviewResult(capability, request);

    expect(result).toMatchObject({
      outcome: 'DATABASE_OUTCOME_UNKNOWN',
      operation: 'RECORD_POST_FINALITY_REVIEW',
      lastConfirmedEffectiveSafetyCursor: firstRead.cursor,
      recoveryMode: 'READ_ONLY',
      automaticRetryAllowed: false,
      mayResendTransaction: false,
    } satisfies Partial<DormantMainnetFinancialActionFinalityDatabaseOutcomeUnknownV1>);
    if (result?.outcome !== 'DATABASE_OUTCOME_UNKNOWN') {
      throw new Error('expected unknown review outcome');
    }
    expect(result.lastConfirmedEffectiveSafetyCursor).toBe(firstRead.cursor);
    expect(evidence.clock).toHaveBeenCalledTimes(2);
    expect(test.query).toHaveBeenCalledTimes(2);

    await expect(test.adapter.recordPostFinalityReview(request)).rejects.toBe(
      DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
    );
    expect(test.query).toHaveBeenCalledTimes(2);

    const recoveredRead = readRequest(signal);
    const recovered = reviewedRead(
      test.adapter,
      await test.adapter.readEffectiveSafetyState(recoveredRead),
      recoveredRead,
    );
    expect(test.query).toHaveBeenCalledTimes(3);
    expect(recovered.cursor).not.toBeNull();
    expect(recovered.cursor).not.toBe(firstRead.cursor);
  });

  it('allows only one concurrent dispatch for the same reader-issued cursor', async () => {
    const signal = new AbortController().signal;
    const evidence = await genuinePostFinalityEvidence(signal, 'FINALITY_REAFFIRMED');
    const pendingWrite = deferred<unknown>();
    let call = 0;
    const test = adapterFixture(evidence.producer, () => {
      call += 1;
      return call === 1 ? Promise.resolve(queryResult(readRow())) : pendingWrite.promise;
    });
    const read = readRequest(signal);
    const readResult = reviewedRead(
      test.adapter,
      await test.reader.readEffectiveSafetyState(read),
      read,
    );
    if (readResult.cursor === null) throw new Error('expected eligible cursor');
    const request = nullRecord({
      evidenceCapability: evidence.capability,
      evidenceRequest: evidence.request,
      effectiveSafetyCursor: readResult.cursor,
      effectiveSafetyReadRequest: read,
      signal,
    }) satisfies RecordMainnetFinancialActionPostFinalityReviewRequestV1;

    const first = test.persistence.recordPostFinalityReview(request);
    await expect(test.persistence.recordPostFinalityReview(request)).rejects.toBe(
      DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
    );
    expect(test.query).toHaveBeenCalledTimes(2);

    pendingWrite.resolve(queryResult(reviewRow()));
    const capability = await first;
    expect(test.persistence.reviewResult(capability, request)).toMatchObject({
      outcome: 'DATABASE_STATE_CONFIRMED',
      operation: 'RECORD_POST_FINALITY_REVIEW',
      databaseRecordOutcome: 'RECORDED',
    });
    expect(test.query).toHaveBeenCalledTimes(2);
  });

  it('binds result capabilities to the exact request and adapter instance', async () => {
    const first = fixture();
    const second = fixture();
    const request = readRequest();
    const capability = await first.adapter.readEffectiveSafetyState(request);

    expect(first.adapter.reviewResult(capability, request)).not.toBeNull();
    expect(first.adapter.reviewResult(capability, { ...request })).toBeNull();
    expect(first.adapter.reviewResult(structuredClone(capability), request)).toBeNull();
    expect(second.adapter.reviewResult(capability, request)).toBeNull();
  });

  it('rejects copied and cross-instance cursors before reviewing evidence or touching SQL', async () => {
    const first = fixture();
    const second = fixture();
    const read = readRequest();
    const result = reviewedRead(
      first.adapter,
      await first.adapter.readEffectiveSafetyState(read),
      read,
    );
    const cursor = result.cursor;
    if (cursor === null) throw new Error('expected cursor');
    const evidenceRequest = Object.freeze(
      Object.assign(Object.create(null) as object, { signal: read.signal }),
    );
    const base = {
      evidenceCapability: Object.freeze(Object.create(null) as object),
      evidenceRequest,
      effectiveSafetyReadRequest: read,
      signal: read.signal,
    };

    await expect(
      first.adapter.recordPostFinalityReview({
        ...base,
        effectiveSafetyCursor: Object.freeze(
          Object.assign(Object.create(null) as object, { ...cursor }),
        ),
      } as RecordMainnetFinancialActionPostFinalityReviewRequestV1),
    ).rejects.toBe(DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE);
    await expect(
      second.adapter.recordPostFinalityReview({
        ...base,
        effectiveSafetyCursor: cursor,
      } as RecordMainnetFinancialActionPostFinalityReviewRequestV1),
    ).rejects.toBe(DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE);
    expect(first.query).toHaveBeenCalledTimes(1);
    expect(second.query).not.toHaveBeenCalled();
  });
});
