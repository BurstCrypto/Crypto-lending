import * as producerModule from './dormant-mainnet-financial-action-finality-evidence.producer';
import {
  DormantMainnetFinancialActionFinalityEvidenceProducer,
  DormantMainnetFinancialActionFinalityEvidenceUnavailableError,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE,
  MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE,
  type MainnetFinancialActionFinalityEvidencePrerequisitePort,
  type MainnetFinancialActionFinalityEvidenceProducerClock,
  type MainnetFinancialActionFinalityEvidenceSourceBindingV1,
  type MainnetFinancialActionPostFinalityEvidencePrerequisiteV1,
  type MainnetFinancialActionReconciliationEvidencePrerequisiteV1,
  type ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
  type ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
  type ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  type ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1,
} from './dormant-mainnet-financial-action-finality-evidence.producer';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION,
  type MainnetFinancialActionFinalityEvidenceSourceAttestationV1,
  type MainnetFinancialActionPostFinalityEvidenceSourceAttestationV1,
  type MainnetFinancialActionReconciliationEvidenceSourceAttestationV1,
  type MainnetFinancialActionFinalityEvidenceSourcePort,
  type ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
} from './ports/mainnet-financial-action-finality-evidence-source.port';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const ACCOUNT_ID = '31b44706-c302-4779-9c9c-392918b26733';
const INTENT_ID = 'e688b11a-9447-449e-a5ed-8a2b186d0cf8';
const WALLET_ID = '900363c6-d27a-4211-838b-465bbde47a37';
const SOURCE_AUTHORITY_ID = '251d25bf-e176-4cb6-b86e-cc69f43c11ae';
const DEPLOYMENT_AUTHORITY_ID = '3e6409c6-b007-44bc-90bd-c4f83fb35297';
const OBSERVATION_ID = 'c14ec277-e729-498e-ab05-b966d478a126';
const REVIEW_ID = 'cb477a03-d07f-49cd-b37d-b409ccbd2930';
const CORRELATION_ID = '57861eb3-5276-4584-a93f-d201aa38cab8';
const SOURCE_AUTHORITY_FINGERPRINT = '1'.repeat(64);
const DEPLOYMENT_AUTHORITY_FINGERPRINT = '2'.repeat(64);
const SOURCE_PAIR_APPROVAL_ID = 'ethereum-solana-mainnet-pair-v1';
const SOURCE_PAIR_REGISTRY_FINGERPRINT = '3'.repeat(64);
const PRIMARY_DEPLOYMENT_MANIFEST = 'a'.repeat(64);
const PRIMARY_OBSERVED_IDENTITY = 'b'.repeat(64);
const CORROBORATING_DEPLOYMENT_MANIFEST = 'c'.repeat(64);
const CORROBORATING_OBSERVED_IDENTITY = 'd'.repeat(64);
const INTENT_FINGERPRINT = '4'.repeat(64);
const SNAPSHOT = '5'.repeat(64);
const CHAIN_EVIDENCE = '6'.repeat(64);
const PAYLOAD_EVIDENCE = '7'.repeat(64);
const SIGNATURE_EVIDENCE = '8'.repeat(64);
const TERMINAL_TRANSITION = '9'.repeat(64);
const ORIGINAL_ADMISSION = 'a'.repeat(64);
const EVM_TRANSACTION = `0x${'1'.repeat(64)}`;
const EVM_BLOCK = `0x${'2'.repeat(64)}`;
const EVM_REPLACEMENT_BLOCK = `0x${'3'.repeat(64)}`;
const EVM_FINALIZED_BLOCK = `0x${'4'.repeat(64)}`;
const EVM_WALLET = '0x1111111111111111111111111111111111111111' as const;
const EVM_MARKET = '0x2222222222222222222222222222222222222222';
const ASSETS = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

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

const SOLANA_TRANSACTION = base58(new Uint8Array(64).fill(11));
const SOLANA_BLOCK = base58(new Uint8Array(32).fill(12));
const SOLANA_FINALIZED_BLOCK = base58(new Uint8Array(32).fill(13));
const SOLANA_WALLET = base58(new Uint8Array(32).fill(14));
const SOLANA_MARKET = base58(new Uint8Array(32).fill(15));
const SOLANA_REPLACEMENT_BLOCK = base58(new Uint8Array(32).fill(16));

type Purpose = 'RECONCILIATION_ADMISSION' | 'POST_FINALITY_REVIEW';
type Prerequisite =
  | MainnetFinancialActionReconciliationEvidencePrerequisiteV1
  | MainnetFinancialActionPostFinalityEvidencePrerequisiteV1;
type PrerequisiteRequest =
  | ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1
  | ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1;

class IssuingPrerequisitePort implements MainnetFinancialActionFinalityEvidencePrerequisitePort {
  readonly prerequisiteVersion = MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION;
  readonly #issuedAdmission = new WeakMap<
    object,
    Readonly<{ request: PrerequisiteRequest; claims: Prerequisite }>
  >();
  readonly #issuedReview = new WeakMap<
    object,
    Readonly<{ request: PrerequisiteRequest; claims: Prerequisite }>
  >();

  issue(claims: Prerequisite, request: PrerequisiteRequest): object {
    const capability = frozen({ opaquePrerequisite: true });
    const entry = frozen({ request, claims });
    if (claims.purpose === 'RECONCILIATION_ADMISSION') {
      this.#issuedAdmission.set(capability, entry);
    } else {
      this.#issuedReview.set(capability, entry);
    }
    return capability;
  }

  reviewReconciliationPrerequisite(
    capability: unknown,
    request: ReviewMainnetFinancialActionReconciliationPrerequisiteRequestV1,
  ): MainnetFinancialActionReconciliationEvidencePrerequisiteV1 | null {
    if (typeof capability !== 'object' || capability === null) return null;
    const entry = this.#issuedAdmission.get(capability);
    return entry?.request === request && entry.claims.purpose === 'RECONCILIATION_ADMISSION'
      ? entry.claims
      : null;
  }

  reviewPostFinalityPrerequisite(
    capability: unknown,
    request: ReviewMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
  ): MainnetFinancialActionPostFinalityEvidencePrerequisiteV1 | null {
    if (typeof capability !== 'object' || capability === null) return null;
    const entry = this.#issuedReview.get(capability);
    return entry?.request === request && entry.claims.purpose === 'POST_FINALITY_REVIEW'
      ? entry.claims
      : null;
  }
}

interface SourceFacts {
  readonly outcome?:
    'PENDING' | 'UNKNOWN' | 'FINALIZED_SUCCESS' | 'FINALIZED_FAILURE' | 'REORGED_OUT';
  readonly disposition?: 'FINALITY_REAFFIRMED' | 'REVIEW_INCONCLUSIVE' | 'DEEP_REORG_QUARANTINED';
  readonly lineageStatus?: 'CANONICAL' | 'UNKNOWN' | 'CONFLICT';
  readonly mutate?: (
    value: MainnetFinancialActionFinalityEvidenceSourceAttestationV1,
  ) => MainnetFinancialActionFinalityEvidenceSourceAttestationV1;
  readonly authentic?: boolean;
  readonly pending?: boolean;
}

class IssuingSource implements MainnetFinancialActionFinalityEvidenceSourcePort {
  readonly sourceVersion = MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION;
  readonly requests: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1[] = [];
  readonly #issued = new WeakMap<
    object,
    ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1
  >();

  constructor(
    readonly seed: string,
    readonly facts: SourceFacts = {},
  ) {}

  async readAttestation(
    request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  ): Promise<unknown> {
    this.requests.push(request);
    if (this.facts.pending === true) return new Promise<never>(() => undefined);
    const { evaluatedAt, deadlineAt: _deadlineAt, signal: _signal, ...requestFacts } = request;
    void _deadlineAt;
    void _signal;
    const transactionPosition =
      request.chainAnchor.kind === 'EVM_BLOCK'
        ? request.chainAnchor.blockNumber
        : request.chainAnchor.slot;
    const transactionBlockId =
      request.chainAnchor.kind === 'EVM_BLOCK' ? request.chainAnchor.blockHash : SOLANA_BLOCK;
    const finalizedPosition =
      request.agreedFinalizedHead.kind === 'EVM_BLOCK'
        ? request.agreedFinalizedHead.blockNumber
        : request.agreedFinalizedHead.root;
    const finalizedBlockId =
      request.agreedFinalizedHead.kind === 'EVM_BLOCK'
        ? request.agreedFinalizedHead.blockHash
        : SOLANA_FINALIZED_BLOCK;
    let value: MainnetFinancialActionFinalityEvidenceSourceAttestationV1;
    if (request.purpose === 'RECONCILIATION_ADMISSION') {
      const outcome = this.facts.outcome ?? 'FINALIZED_SUCCESS';
      value = frozen({
        ...requestFacts,
        use: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE,
        outcome,
        transactionPosition: outcome === 'UNKNOWN' ? null : transactionPosition,
        transactionBlockId: outcome === 'UNKNOWN' ? null : transactionBlockId,
        finalizedPosition,
        finalizedBlockId,
        transactionEvidenceSha256: this.seed.repeat(64),
        effectEvidenceSha256: outcome === 'FINALIZED_SUCCESS' ? 'd'.repeat(64) : null,
        failureEvidenceSha256: outcome === 'FINALIZED_FAILURE' ? 'e'.repeat(64) : null,
        observedAt: evaluatedAt,
        assessedAt: evaluatedAt,
        attestationSha256: this.seed === 'b' ? 'f'.repeat(64) : 'e'.repeat(64),
      }) as MainnetFinancialActionReconciliationEvidenceSourceAttestationV1;
    } else {
      const disposition = this.facts.disposition ?? 'FINALITY_REAFFIRMED';
      value = frozen({
        ...requestFacts,
        use: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE,
        disposition,
        lineageStatus:
          this.facts.lineageStatus ??
          (disposition === 'FINALITY_REAFFIRMED'
            ? 'CANONICAL'
            : disposition === 'REVIEW_INCONCLUSIVE'
              ? 'UNKNOWN'
              : 'CONFLICT'),
        transactionPosition,
        transactionBlockId,
        finalizedPosition,
        finalizedBlockId,
        transactionEvidenceSha256: this.seed.repeat(64),
        observedAt: evaluatedAt,
        assessedAt: evaluatedAt,
        attestationSha256: this.seed === 'b' ? 'f'.repeat(64) : 'e'.repeat(64),
      }) as MainnetFinancialActionPostFinalityEvidenceSourceAttestationV1;
    }
    value = this.facts.mutate?.(value) ?? value;
    this.#issued.set(value, request);
    return value;
  }

  verifyAttestation(
    capability: unknown,
    request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  ): boolean {
    return (
      this.facts.authentic !== false &&
      typeof capability === 'object' &&
      capability !== null &&
      this.#issued.get(capability) === request
    );
  }
}

function clock(...timestamps: string[]): MainnetFinancialActionFinalityEvidenceProducerClock {
  let index = 0;
  return frozen({
    now(): Date {
      const value = timestamps[Math.min(index, timestamps.length - 1)]!;
      index += 1;
      return new Date(value);
    },
  });
}

function prerequisiteRequest(purpose: Purpose, signal: AbortSignal): PrerequisiteRequest {
  return purpose === 'RECONCILIATION_ADMISSION'
    ? frozen({
        prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
        use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_REVIEW_USE,
        purpose,
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        signal,
      })
    : frozen({
        prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
        use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_REVIEW_USE,
        purpose,
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        signal,
      });
}

function prerequisite(
  purpose: Purpose,
  signal: AbortSignal,
  networkId: typeof ETHEREUM | typeof SOLANA = ETHEREUM,
  overrides: Partial<Prerequisite> = {},
): Prerequisite {
  const solana = networkId === SOLANA;
  const asset = ASSETS.assets.find(
    (candidate) => candidate.networkId === networkId && candidate.stablecoin === 'USDC',
  )!;
  const originalBlock = solana ? SOLANA_BLOCK : EVM_BLOCK;
  const common = {
    prerequisiteVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PREREQUISITE_VERSION,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    accountId: ACCOUNT_ID,
    intentId: INTENT_ID,
    intentRecordFingerprintSha256: INTENT_FINGERPRINT,
    walletRegistrationId: WALLET_ID,
    walletAddress: (solana ? SOLANA_WALLET : EVM_WALLET) as never,
    networkId,
    lifecycleRevision: purpose === 'RECONCILIATION_ADMISSION' ? '2' : '3',
    lifecycleSnapshotSha256: SNAPSHOT,
    transactionId: solana ? SOLANA_TRANSACTION : EVM_TRANSACTION,
    walletSignedPayloadSha256: PAYLOAD_EVIDENCE,
    walletSignatureEvidenceSha256: SIGNATURE_EVIDENCE,
    chainAnchorEvidenceFingerprintSha256: CHAIN_EVIDENCE,
    chainAnchor: solana
      ? frozen({ kind: 'SOLANA_SLOT' as const, slot: '100', root: '90' })
      : frozen({ kind: 'EVM_BLOCK' as const, blockNumber: '100', blockHash: EVM_BLOCK }),
    agreedFinalizedHead: solana
      ? frozen({ kind: 'SOLANA_SLOT' as const, slot: '110', root: '105' })
      : frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '110',
          blockHash: EVM_FINALIZED_BLOCK,
        }),
    chainAnchorEvidenceExpiresAt: '2026-09-07T17:02:00.000Z',
    sourceAuthorityId: SOURCE_AUTHORITY_ID,
    sourceAuthorityFingerprintSha256: SOURCE_AUTHORITY_FINGERPRINT,
    sourceAuthorityExpiresAt: '2026-09-07T17:03:00.000Z',
    sourcePairApprovalId: SOURCE_PAIR_APPROVAL_ID,
    sourcePairRegistryFingerprintSha256: SOURCE_PAIR_REGISTRY_FINGERPRINT,
    primarySourceFamilyId: 'alpha-family',
    primarySourceId: 'alpha-source',
    primarySourceKind: 'RPC' as const,
    corroboratingSourceFamilyId: 'beta-family',
    corroboratingSourceId: 'beta-source',
    corroboratingSourceKind: 'INDEXER' as const,
    deploymentAuthorityId: DEPLOYMENT_AUTHORITY_ID,
    deploymentAuthorityFingerprintSha256: DEPLOYMENT_AUTHORITY_FINGERPRINT,
    deploymentAuthorityExpiresAt: '2026-09-07T17:03:00.000Z',
    primaryDeploymentManifestFingerprintSha256: PRIMARY_DEPLOYMENT_MANIFEST,
    primaryObservedIdentityFingerprintSha256: PRIMARY_OBSERVED_IDENTITY,
    corroboratingDeploymentManifestFingerprintSha256: CORROBORATING_DEPLOYMENT_MANIFEST,
    corroboratingObservedIdentityFingerprintSha256: CORROBORATING_OBSERVED_IDENTITY,
    providerId: solana ? ('kamino' as const) : ('aave' as const),
    protocolId: solana ? ('kamino-lend' as const) : ('aave-v3' as const),
    marketId: solana ? SOLANA_MARKET : EVM_MARKET,
    assetRegistryVersion: ASSETS.version,
    assetRegistryFingerprintSha256: ASSETS.fingerprintSha256,
    assetSymbol: asset.stablecoin,
    assetIdentity: asset.identity,
    assetDecimals: asset.decimals,
    action: 'SUPPLY' as const,
    amountAtomic: '1000000',
    correlationId: CORRELATION_ID,
    verifiedAt: '2026-09-07T16:59:59.000Z',
    deadlineAt: '2026-09-07T17:00:20.000Z',
    signal,
  };
  return purpose === 'RECONCILIATION_ADMISSION'
    ? (frozen({
        ...common,
        use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_PREREQUISITE_USE,
        purpose,
        lifecycleStage: 'WALLET_SIGNED_SUBMISSION_BOUND' as const,
        observationId: OBSERVATION_ID,
        ...overrides,
      }) as MainnetFinancialActionReconciliationEvidencePrerequisiteV1)
    : (frozen({
        ...common,
        use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_USE,
        purpose,
        lifecycleStage: 'FINALIZED_SUCCESS' as const,
        terminalTransitionFingerprintSha256: TERMINAL_TRANSITION,
        originalAdmissionFingerprintSha256: ORIGINAL_ADMISSION,
        terminalTransactionPosition: '100',
        terminalTransactionBlockId: originalBlock,
        expectedReviewRevision: '0',
        expectedPreviousReviewFingerprintSha256: null,
        effectiveSafetyState: 'AUTHENTICATED_FINALITY_RECORDED' as const,
        reviewId: REVIEW_ID,
        ...overrides,
      }) as MainnetFinancialActionPostFinalityEvidencePrerequisiteV1);
}

function bindings(
  networkId: typeof ETHEREUM | typeof SOLANA,
  primary: MainnetFinancialActionFinalityEvidenceSourcePort,
  corroborating: MainnetFinancialActionFinalityEvidenceSourcePort,
): readonly MainnetFinancialActionFinalityEvidenceSourceBindingV1[] {
  return frozen([
    frozen({
      networkId,
      sourceAuthorityId: SOURCE_AUTHORITY_ID,
      sourceAuthorityFingerprintSha256: SOURCE_AUTHORITY_FINGERPRINT,
      role: 'PRIMARY' as const,
      sourceFamilyId: 'alpha-family',
      sourceId: 'alpha-source',
      sourceKind: 'RPC' as const,
      source: primary,
    }),
    frozen({
      networkId,
      sourceAuthorityId: SOURCE_AUTHORITY_ID,
      sourceAuthorityFingerprintSha256: SOURCE_AUTHORITY_FINGERPRINT,
      role: 'CORROBORATING' as const,
      sourceFamilyId: 'beta-family',
      sourceId: 'beta-source',
      sourceKind: 'INDEXER' as const,
      source: corroborating,
    }),
  ]);
}

function fixture(
  purpose: Purpose,
  options: Readonly<{
    networkId?: typeof ETHEREUM | typeof SOLANA;
    prerequisiteOverrides?: Partial<Prerequisite>;
    primaryFacts?: SourceFacts;
    corroboratingFacts?: SourceFacts;
    times?: readonly string[];
  }> = {},
): Readonly<{
  producer: DormantMainnetFinancialActionFinalityEvidenceProducer;
  request:
    | ProduceMainnetFinancialActionReconciliationEvidenceRequestV1
    | ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
  prerequisiteCapability: object;
  prerequisiteRequest: PrerequisiteRequest;
  primary: IssuingSource;
  corroborating: IssuingSource;
  controller: AbortController;
}> {
  const networkId = options.networkId ?? ETHEREUM;
  const controller = new AbortController();
  const reviewRequest = prerequisiteRequest(purpose, controller.signal);
  const claims = prerequisite(purpose, controller.signal, networkId, options.prerequisiteOverrides);
  const prerequisites = new IssuingPrerequisitePort();
  const prerequisiteCapability = prerequisites.issue(claims, reviewRequest);
  const primary = new IssuingSource('b', options.primaryFacts);
  const corroborating = new IssuingSource('c', options.corroboratingFacts);
  const producer = new DormantMainnetFinancialActionFinalityEvidenceProducer(
    prerequisites,
    bindings(networkId, primary, corroborating),
    clock(
      ...(options.times ?? [
        '2026-09-07T17:00:00.000Z',
        '2026-09-07T17:00:01.000Z',
        '2026-09-07T17:00:02.000Z',
        '2026-09-07T17:00:03.000Z',
      ]),
    ),
  );
  const request =
    purpose === 'RECONCILIATION_ADMISSION'
      ? frozen({
          producerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
          use: MAINNET_FINANCIAL_ACTION_RECONCILIATION_EVIDENCE_PRODUCE_USE,
          purpose,
          mayAuthorizeFinancialAction: false as const,
          mayPersist: false as const,
          prerequisiteCapability,
          prerequisiteRequest: reviewRequest,
          signal: controller.signal,
        })
      : frozen({
          producerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
          use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE,
          purpose,
          mayAuthorizeFinancialAction: false as const,
          mayPersist: false as const,
          prerequisiteCapability,
          prerequisiteRequest: reviewRequest,
          signal: controller.signal,
        });
  return frozen({
    producer,
    request,
    prerequisiteCapability,
    prerequisiteRequest: reviewRequest,
    primary,
    corroborating,
    controller,
  });
}

function expectCode(
  action: (() => unknown) | Promise<unknown>,
  code: DormantMainnetFinancialActionFinalityEvidenceUnavailableError['code'],
): Promise<void> | void {
  if (action instanceof Promise) {
    return expect(action).rejects.toMatchObject({
      name: 'DormantMainnetFinancialActionFinalityEvidenceUnavailableError',
      code,
    });
  }
  try {
    action();
    throw new Error('expected action to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(DormantMainnetFinancialActionFinalityEvidenceUnavailableError);
    expect(error).toMatchObject({ code });
  }
}

describe('dormant mainnet financial-action finality evidence producer', () => {
  it('rejects shadowed, accessor-backed, sparse, and custom-prototype binding arrays', () => {
    const primary = new IssuingSource('b');
    const corroborating = new IssuingSource('c');
    const valid = bindings(ETHEREUM, primary, corroborating);
    const construct = (candidate: unknown): DormantMainnetFinancialActionFinalityEvidenceProducer =>
      new DormantMainnetFinancialActionFinalityEvidenceProducer(
        new IssuingPrerequisitePort(),
        candidate as readonly MainnetFinancialActionFinalityEvidenceSourceBindingV1[],
        clock('2026-09-07T17:00:00.000Z'),
      );

    const shadowedMap = [...valid];
    Object.defineProperty(shadowedMap, 'map', {
      value: (): readonly unknown[] => [],
      enumerable: true,
    });

    const accessorBacked = [...valid];
    Object.defineProperty(accessorBacked, '0', {
      get: (): MainnetFinancialActionFinalityEvidenceSourceBindingV1 => valid[0]!,
      enumerable: true,
      configurable: true,
    });

    const sparse = new Array<MainnetFinancialActionFinalityEvidenceSourceBindingV1>(2);
    sparse[0] = valid[0]!;

    const customPrototype = [...valid];
    Object.setPrototypeOf(customPrototype, Object.create(Array.prototype) as object);

    for (const candidate of [shadowedMap, accessorBacked, sparse, customPrototype]) {
      expectCode(() => construct(candidate), 'INVALID_CONFIGURATION');
    }
  });

  it('does not consult a polluted Array.prototype.map while capturing bindings', () => {
    const originalMap = Object.getOwnPropertyDescriptor(Array.prototype, 'map');
    expect(originalMap).toBeDefined();
    let constructed: DormantMainnetFinancialActionFinalityEvidenceProducer | undefined;
    let constructionError: unknown;
    try {
      Object.defineProperty(Array.prototype, 'map', {
        ...originalMap,
        value: (): never => {
          throw new Error('polluted map must not run');
        },
      });
      constructed = new DormantMainnetFinancialActionFinalityEvidenceProducer(
        new IssuingPrerequisitePort(),
        bindings(ETHEREUM, new IssuingSource('b'), new IssuingSource('c')),
        clock('2026-09-07T17:00:00.000Z'),
      );
    } catch (error) {
      constructionError = error;
    } finally {
      if (originalMap !== undefined) Object.defineProperty(Array.prototype, 'map', originalMap);
    }

    expect(constructionError).toBeUndefined();
    expect(constructed).toBeInstanceOf(DormantMainnetFinancialActionFinalityEvidenceProducer);
  });

  it.each([
    ['RECONCILIATION_ADMISSION' as const, '1'],
    ['POST_FINALITY_REVIEW' as const, '1'],
    ['POST_FINALITY_REVIEW' as const, '2'],
  ])('rejects %s lifecycle revision %s before source I/O', async (purpose, lifecycleRevision) => {
    const value = fixture(purpose, { prerequisiteOverrides: { lifecycleRevision } });
    const operation =
      purpose === 'RECONCILIATION_ADMISSION'
        ? value.producer.produceReconciliationAdmissionCandidate(
            value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
          )
        : value.producer.producePostFinalityReviewCandidate(
            value.request as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
          );
    await expectCode(operation, 'PREREQUISITE_UNAVAILABLE');
    expect(value.primary.requests).toHaveLength(0);
    expect(value.corroborating.requests).toHaveLength(0);
  });

  it('stops waiting for unresolved source reads when the request is aborted', async () => {
    const value = fixture('RECONCILIATION_ADMISSION', {
      primaryFacts: { pending: true },
      corroboratingFacts: { pending: true },
    });
    const operation = value.producer.produceReconciliationAdmissionCandidate(
      value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
    );
    await Promise.resolve();
    value.controller.abort();
    await expectCode(operation, 'STALE_EVIDENCE');
    expect(value.primary.requests).toHaveLength(1);
    expect(value.corroborating.requests).toHaveLength(1);
  });

  it('stops waiting for unresolved source reads at the exclusive deadline', async () => {
    const value = fixture('RECONCILIATION_ADMISSION', {
      prerequisiteOverrides: { deadlineAt: '2026-09-07T17:00:00.001Z' },
      primaryFacts: { pending: true },
      corroboratingFacts: { pending: true },
      times: ['2026-09-07T17:00:00.000Z', '2026-09-07T17:00:00.001Z'],
    });
    await expectCode(
      value.producer.produceReconciliationAdmissionCandidate(
        value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
      ),
      'STALE_EVIDENCE',
    );
  });

  it('stops unresolved reads at the earliest evidence or authority expiry', async () => {
    const value = fixture('RECONCILIATION_ADMISSION', {
      prerequisiteOverrides: { sourceAuthorityExpiresAt: '2026-09-07T17:00:00.001Z' },
      primaryFacts: { pending: true },
      corroboratingFacts: { pending: true },
      times: ['2026-09-07T17:00:00.000Z', '2026-09-07T17:00:00.001Z'],
    });
    await expectCode(
      value.producer.produceReconciliationAdmissionCandidate(
        value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
      ),
      'STALE_EVIDENCE',
    );
  });

  it.each([ETHEREUM, SOLANA])(
    'issues an exact signed-bound revision-2 reconciliation tuple for %s',
    async (networkId) => {
      const value = fixture('RECONCILIATION_ADMISSION', { networkId });
      const request = value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1;
      const capability = await value.producer.produceReconciliationAdmissionCandidate(request);
      const candidate = value.producer.reviewReconciliationAdmissionCandidate(capability, request);

      expect(candidate).toMatchObject({
        purpose: 'RECONCILIATION_ADMISSION',
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
      });
      expect(candidate.admissionArguments).toHaveLength(24);
      expect(candidate.admissionArguments.slice(0, 7)).toEqual([
        ACCOUNT_ID,
        INTENT_ID,
        '2',
        SNAPSHOT,
        OBSERVATION_ID,
        networkId === ETHEREUM ? EVM_TRANSACTION : SOLANA_TRANSACTION,
        'FINALIZED_SUCCESS',
      ]);
      expect(candidate.admissionArguments[12]).toBe(SOURCE_AUTHORITY_ID);
      expect(candidate.admissionArguments[14]).toBe(DEPLOYMENT_AUTHORITY_ID);
      expect(candidate.admissionArguments[18]).toMatch(/^[0-9a-f]{64}$/u);
      expect(new Set(candidate.admissionArguments.slice(16, 19))).toHaveProperty('size', 3);
      expect(value.primary.requests[0]).toMatchObject({
        intentRecordFingerprintSha256: INTENT_FINGERPRINT,
        walletSignedPayloadSha256: PAYLOAD_EVIDENCE,
        walletSignatureEvidenceSha256: SIGNATURE_EVIDENCE,
        deploymentAuthorityId: DEPLOYMENT_AUTHORITY_ID,
        deploymentManifestFingerprintSha256: PRIMARY_DEPLOYMENT_MANIFEST,
        observedDeploymentIdentityFingerprintSha256: PRIMARY_OBSERVED_IDENTITY,
        sourcePairApprovalId: SOURCE_PAIR_APPROVAL_ID,
        sourcePairRegistryFingerprintSha256: SOURCE_PAIR_REGISTRY_FINGERPRINT,
        providerId: networkId === ETHEREUM ? 'aave' : 'kamino',
        action: 'SUPPLY',
        amountAtomic: '1000000',
      });
    },
  );

  it.each([
    ['WALLET_SIGNED_SUBMISSION_BOUND' as const, '3'],
    ['BROADCAST_OUTCOME_AMBIGUOUS' as const, '2'],
  ])(
    'rejects lifecycle stage %s at incoherent revision %s',
    async (lifecycleStage, lifecycleRevision) => {
      const value = fixture('RECONCILIATION_ADMISSION', {
        prerequisiteOverrides: { lifecycleStage, lifecycleRevision },
      });

      await expectCode(
        value.producer.produceReconciliationAdmissionCandidate(
          value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
        ),
        'PREREQUISITE_UNAVAILABLE',
      );
      expect(value.primary.requests).toHaveLength(0);
      expect(value.corroborating.requests).toHaveLength(0);
    },
  );

  it('produces the remaining authenticated reconciliation outcomes', async () => {
    const cases = [
      {
        outcome: 'PENDING' as const,
        prerequisiteOverrides: {
          agreedFinalizedHead: frozen({
            kind: 'EVM_BLOCK' as const,
            blockNumber: '99',
            blockHash: EVM_FINALIZED_BLOCK,
          }),
        },
      },
      { outcome: 'UNKNOWN' as const, prerequisiteOverrides: {} },
      { outcome: 'FINALIZED_FAILURE' as const, prerequisiteOverrides: {} },
      { outcome: 'REORGED_OUT' as const, prerequisiteOverrides: {} },
    ];
    for (const testCase of cases) {
      const value = fixture('RECONCILIATION_ADMISSION', {
        prerequisiteOverrides: testCase.prerequisiteOverrides,
        primaryFacts: { outcome: testCase.outcome },
        corroboratingFacts: { outcome: testCase.outcome },
      });
      const request = value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1;
      const capability = await value.producer.produceReconciliationAdmissionCandidate(request);
      expect(
        value.producer.reviewReconciliationAdmissionCandidate(capability, request)
          .admissionArguments[6],
      ).toBe(testCase.outcome);
    }
  });

  it('produces inconclusive and Solana post-finality evidence without weakening fork rules', async () => {
    const inconclusive = fixture('POST_FINALITY_REVIEW', {
      primaryFacts: { disposition: 'REVIEW_INCONCLUSIVE' },
      corroboratingFacts: { disposition: 'REVIEW_INCONCLUSIVE' },
    });
    const inconclusiveRequest =
      inconclusive.request as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
    const inconclusiveCapability =
      await inconclusive.producer.producePostFinalityReviewCandidate(inconclusiveRequest);
    expect(
      inconclusive.producer.reviewPostFinalityReviewCandidate(
        inconclusiveCapability,
        inconclusiveRequest,
      ).reviewArguments[7],
    ).toBe('REVIEW_INCONCLUSIVE');

    const reaffirmed = fixture('POST_FINALITY_REVIEW', { networkId: SOLANA });
    const reaffirmedRequest =
      reaffirmed.request as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
    const reaffirmedCapability =
      await reaffirmed.producer.producePostFinalityReviewCandidate(reaffirmedRequest);
    expect(
      reaffirmed.producer.reviewPostFinalityReviewCandidate(reaffirmedCapability, reaffirmedRequest)
        .reviewArguments[7],
    ).toBe('FINALITY_REAFFIRMED');

    const replaceSolanaBlock = (
      attestation: MainnetFinancialActionFinalityEvidenceSourceAttestationV1,
    ): MainnetFinancialActionFinalityEvidenceSourceAttestationV1 =>
      frozen({
        ...attestation,
        transactionBlockId: SOLANA_REPLACEMENT_BLOCK,
      }) as MainnetFinancialActionFinalityEvidenceSourceAttestationV1;
    const deepReorg = fixture('POST_FINALITY_REVIEW', {
      networkId: SOLANA,
      primaryFacts: { disposition: 'DEEP_REORG_QUARANTINED', mutate: replaceSolanaBlock },
      corroboratingFacts: { disposition: 'DEEP_REORG_QUARANTINED', mutate: replaceSolanaBlock },
    });
    const deepReorgRequest =
      deepReorg.request as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
    const deepReorgCapability =
      await deepReorg.producer.producePostFinalityReviewCandidate(deepReorgRequest);
    expect(
      deepReorg.producer.reviewPostFinalityReviewCandidate(deepReorgCapability, deepReorgRequest)
        .reviewArguments[11],
    ).toBe(SOLANA_REPLACEMENT_BLOCK);
  });

  it('invalidates issued candidates on later abort or exclusive deadline', async () => {
    const abortedValue = fixture('RECONCILIATION_ADMISSION');
    const abortedRequest =
      abortedValue.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1;
    const abortedCapability =
      await abortedValue.producer.produceReconciliationAdmissionCandidate(abortedRequest);
    abortedValue.controller.abort();
    expectCode(
      () =>
        abortedValue.producer.reviewReconciliationAdmissionCandidate(
          abortedCapability,
          abortedRequest,
        ),
      'STALE_EVIDENCE',
    );

    const expiredValue = fixture('RECONCILIATION_ADMISSION', {
      times: [
        '2026-09-07T17:00:00.000Z',
        '2026-09-07T17:00:01.000Z',
        '2026-09-07T17:00:02.000Z',
        '2026-09-07T17:00:20.000Z',
      ],
    });
    const expiredRequest =
      expiredValue.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1;
    const expiredCapability =
      await expiredValue.producer.produceReconciliationAdmissionCandidate(expiredRequest);
    expectCode(
      () =>
        expiredValue.producer.reviewReconciliationAdmissionCandidate(
          expiredCapability,
          expiredRequest,
        ),
      'STALE_EVIDENCE',
    );
  });

  it('issues a separate post-finality tuple bound to terminal admission and review cursor', async () => {
    const value = fixture('POST_FINALITY_REVIEW');
    const request = value.request as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
    const capability = await value.producer.producePostFinalityReviewCandidate(request);
    const candidate = value.producer.reviewPostFinalityReviewCandidate(capability, request);

    expect(candidate.reviewArguments).toHaveLength(25);
    expect(candidate.reviewArguments.slice(0, 10)).toEqual([
      ACCOUNT_ID,
      INTENT_ID,
      '3',
      SNAPSHOT,
      '0',
      null,
      REVIEW_ID,
      'FINALITY_REAFFIRMED',
      'CANONICAL',
      EVM_TRANSACTION,
    ]);
    expect(candidate.effectiveSafetyBinding).toEqual({
      terminalTransitionFingerprintSha256: TERMINAL_TRANSITION,
      originalAdmissionFingerprintSha256: ORIGINAL_ADMISSION,
      expectedReviewRevision: '0',
      expectedPreviousReviewFingerprintSha256: null,
      effectiveSafetyState: 'AUTHENTICATED_FINALITY_RECORDED',
    });
    expect(value.primary.requests[0]).toMatchObject({
      terminalTransactionPosition: '100',
      terminalTransactionBlockId: EVM_BLOCK,
      terminalTransitionFingerprintSha256: TERMINAL_TRANSITION,
      originalAdmissionFingerprintSha256: ORIGINAL_ADMISSION,
    });
    expectCode(
      () =>
        value.producer.reviewReconciliationAdmissionCandidate(
          capability,
          request as unknown as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
        ),
      'INVALID_REQUEST',
    );
  });

  it('admits a two-source deep-reorg replacement only when it differs from the terminal block', async () => {
    const value = fixture('POST_FINALITY_REVIEW', {
      prerequisiteOverrides: {
        chainAnchor: frozen({
          kind: 'EVM_BLOCK',
          blockNumber: '100',
          blockHash: EVM_REPLACEMENT_BLOCK,
        }),
      },
      primaryFacts: { disposition: 'DEEP_REORG_QUARANTINED' },
      corroboratingFacts: { disposition: 'DEEP_REORG_QUARANTINED' },
    });
    const request = value.request as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
    const capability = await value.producer.producePostFinalityReviewCandidate(request);
    const candidate = value.producer.reviewPostFinalityReviewCandidate(capability, request);
    expect(candidate.reviewArguments[7]).toBe('DEEP_REORG_QUARANTINED');
    expect(candidate.reviewArguments[8]).toBe('CONFLICT');
    expect(candidate.reviewArguments[11]).toBe(EVM_REPLACEMENT_BLOCK);

    const invalid = fixture('POST_FINALITY_REVIEW', {
      primaryFacts: { disposition: 'DEEP_REORG_QUARANTINED' },
      corroboratingFacts: { disposition: 'DEEP_REORG_QUARANTINED' },
    });
    await expectCode(
      invalid.producer.producePostFinalityReviewCandidate(
        invalid.request as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
      ),
      'SOURCE_ATTESTATION_INVALID',
    );
  });

  it('rejects source disagreement and an unauthenticated source capability', async () => {
    const disagreement = fixture('RECONCILIATION_ADMISSION', {
      corroboratingFacts: { outcome: 'FINALIZED_FAILURE' },
    });
    await expectCode(
      disagreement.producer.produceReconciliationAdmissionCandidate(
        disagreement.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
      ),
      'SOURCE_DISAGREEMENT',
    );

    const forged = fixture('RECONCILIATION_ADMISSION', {
      corroboratingFacts: { authentic: false },
    });
    await expectCode(
      forged.producer.produceReconciliationAdmissionCandidate(
        forged.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
      ),
      'SOURCE_ATTESTATION_INVALID',
    );
  });

  it('rejects deployment, effect-context, and terminal-binding drift', async () => {
    for (const mutate of [
      (value: MainnetFinancialActionFinalityEvidenceSourceAttestationV1) =>
        frozen({ ...value, deploymentAuthorityFingerprintSha256: 'f'.repeat(64) }),
      (value: MainnetFinancialActionFinalityEvidenceSourceAttestationV1) =>
        frozen({
          ...value,
          deploymentManifestFingerprintSha256: PRIMARY_DEPLOYMENT_MANIFEST,
        }),
      (value: MainnetFinancialActionFinalityEvidenceSourceAttestationV1) =>
        frozen({ ...value, amountAtomic: '2000000' }),
      (value: MainnetFinancialActionFinalityEvidenceSourceAttestationV1) =>
        frozen({ ...value, walletSignedPayloadSha256: 'f'.repeat(64) }),
    ]) {
      const value = fixture('RECONCILIATION_ADMISSION', {
        corroboratingFacts: { mutate },
      });
      await expectCode(
        value.producer.produceReconciliationAdmissionCandidate(
          value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
        ),
        'SOURCE_ATTESTATION_INVALID',
      );
    }
  });

  it('binds both source roles to the exact authenticated authority pair', async () => {
    for (const prerequisiteOverrides of [
      {
        primarySourceFamilyId: 'beta-family',
        primarySourceId: 'beta-source',
        primarySourceKind: 'INDEXER' as const,
        corroboratingSourceFamilyId: 'alpha-family',
        corroboratingSourceId: 'alpha-source',
        corroboratingSourceKind: 'RPC' as const,
      },
      { sourceAuthorityFingerprintSha256: 'f'.repeat(64) },
    ]) {
      const value = fixture('RECONCILIATION_ADMISSION', { prerequisiteOverrides });
      await expectCode(
        value.producer.produceReconciliationAdmissionCandidate(
          value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
        ),
        'PREREQUISITE_UNAVAILABLE',
      );
      expect(value.primary.requests).toHaveLength(0);
      expect(value.corroborating.requests).toHaveLength(0);
    }
  });

  it.each(['BORROW', 'REPAY'] as const)(
    'rejects the not-yet-durable %s action before source I/O',
    async (action) => {
      const value = fixture('RECONCILIATION_ADMISSION', {
        prerequisiteOverrides: { action },
      });
      await expectCode(
        value.producer.produceReconciliationAdmissionCandidate(
          value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
        ),
        'PREREQUISITE_UNAVAILABLE',
      );
      expect(value.primary.requests).toHaveLength(0);
      expect(value.corroborating.requests).toHaveLength(0);
    },
  );

  it('requires deep-reorg replacement evidence to be finalized at or above its height', async () => {
    for (const agreedFinalizedHead of [
      frozen({
        kind: 'EVM_BLOCK' as const,
        blockNumber: '99',
        blockHash: EVM_FINALIZED_BLOCK,
      }),
      frozen({
        kind: 'EVM_BLOCK' as const,
        blockNumber: '100',
        blockHash: EVM_FINALIZED_BLOCK,
      }),
    ]) {
      const value = fixture('POST_FINALITY_REVIEW', {
        prerequisiteOverrides: {
          chainAnchor: frozen({
            kind: 'EVM_BLOCK',
            blockNumber: '100',
            blockHash: EVM_REPLACEMENT_BLOCK,
          }),
          agreedFinalizedHead,
        },
        primaryFacts: { disposition: 'DEEP_REORG_QUARANTINED' },
        corroboratingFacts: { disposition: 'DEEP_REORG_QUARANTINED' },
      });
      await expectCode(
        value.producer.producePostFinalityReviewCandidate(
          value.request as ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
        ),
        'SOURCE_ATTESTATION_INVALID',
      );
    }
  });

  it('rejects an Ethereum terminal reconciliation whose same-height finalized hash differs', async () => {
    const value = fixture('RECONCILIATION_ADMISSION', {
      prerequisiteOverrides: {
        agreedFinalizedHead: frozen({
          kind: 'EVM_BLOCK',
          blockNumber: '100',
          blockHash: EVM_FINALIZED_BLOCK,
        }),
      },
    });
    await expectCode(
      value.producer.produceReconciliationAdmissionCandidate(
        value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
      ),
      'SOURCE_ATTESTATION_INVALID',
    );
  });

  it('rejects request/capability clones and any naked chain or authority field', async () => {
    const value = fixture('RECONCILIATION_ADMISSION');
    const request = value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1;
    expect(Object.keys(request).sort()).toEqual([
      'mayAuthorizeFinancialAction',
      'mayPersist',
      'prerequisiteCapability',
      'prerequisiteRequest',
      'producerVersion',
      'purpose',
      'signal',
      'use',
    ]);
    expect(Object.keys(request)).not.toEqual(
      expect.arrayContaining([
        'outcome',
        'observationId',
        'reviewId',
        'transactionPosition',
        'transactionBlockId',
        'evidenceSha256',
        'sourceAuthorityId',
        'deploymentAuthorityId',
        'deadlineAt',
        'correlationId',
      ]),
    );
    const capability = await value.producer.produceReconciliationAdmissionCandidate(request);
    expectCode(
      () => value.producer.reviewReconciliationAdmissionCandidate(capability, { ...request }),
      'INVALID_REQUEST',
    );
    expectCode(
      () =>
        value.producer.reviewReconciliationAdmissionCandidate(structuredClone(capability), request),
      'INVALID_REQUEST',
    );
    await expectCode(
      value.producer.produceReconciliationAdmissionCandidate(
        frozen({ ...request, outcome: 'FINALIZED_SUCCESS' }) as never,
      ),
      'INVALID_REQUEST',
    );
  });

  it('fails closed on abort, deadline expiry, and stale Solana evidence', async () => {
    const aborted = fixture('RECONCILIATION_ADMISSION');
    const controller = new AbortController();
    controller.abort();
    const abortedRequest = frozen({
      ...aborted.request,
      signal: controller.signal,
    }) as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1;
    await expectCode(
      aborted.producer.produceReconciliationAdmissionCandidate(abortedRequest),
      'INVALID_REQUEST',
    );

    const expired = fixture('RECONCILIATION_ADMISSION', {
      times: ['2026-09-07T17:00:20.000Z'],
    });
    await expectCode(
      expired.producer.produceReconciliationAdmissionCandidate(
        expired.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
      ),
      'STALE_EVIDENCE',
    );

    const stale = fixture('RECONCILIATION_ADMISSION', {
      networkId: SOLANA,
      times: ['2026-09-07T17:00:00.000Z', '2026-09-07T17:00:16.000Z', '2026-09-07T17:00:16.000Z'],
    });
    await expectCode(
      stale.producer.produceReconciliationAdmissionCandidate(
        stale.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
      ),
      'STALE_EVIDENCE',
    );
  });

  it('uses the older source observation as the two-source freshness floor', async () => {
    const newerCorroborationAt = '2026-09-07T17:00:14.000Z';
    const value = fixture('RECONCILIATION_ADMISSION', {
      networkId: SOLANA,
      corroboratingFacts: {
        mutate: (attestation) =>
          frozen({
            ...attestation,
            observedAt: newerCorroborationAt,
            assessedAt: newerCorroborationAt,
          }),
      },
      times: ['2026-09-07T17:00:00.000Z', '2026-09-07T17:00:16.000Z', '2026-09-07T17:00:16.000Z'],
    });
    await expectCode(
      value.producer.produceReconciliationAdmissionCandidate(
        value.request as ProduceMainnetFinancialActionReconciliationEvidenceRequestV1,
      ),
      'STALE_EVIDENCE',
    );
  });

  it('exports no runtime source, transport, writer, timer, or provider SDK', () => {
    expect(Object.keys(producerModule)).not.toEqual(
      expect.arrayContaining([
        'client',
        'endpoint',
        'fetch',
        'module',
        'provider',
        'repository',
        'timer',
        'writer',
      ]),
    );
    expect(MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION).toBe(1);
  });
});
