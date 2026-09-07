import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as mainnetPlatformsFeature from '../index';
import {
  DormantProviderPositionChainAnchorEvidenceProducer,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
  fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
  type ProduceProviderPositionChainAnchorEvidenceRequestV1,
  type ProviderPositionChainAnchorEvidenceProducerClock,
  type ProviderPositionChainAnchorEvidenceSourceBindingV1,
  type ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1,
  type ProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
} from './dormant-provider-position-chain-anchor-evidence.producer';
import {
  DormantProviderPositionChainAnchorCandidateFinalityFinalizer,
  ProviderPositionChainAnchorCandidateFinalityUnavailableError,
  type ProviderPositionChainAnchorCandidateFinalityClock,
  type ProviderPositionChainAnchorCandidateFinalityErrorCode,
} from './dormant-provider-position-chain-anchor-candidate-finality.finalizer';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
  type ProviderPositionChainAnchorEvidenceSourceAttestationV1,
  type ProviderPositionChainAnchorEvidenceSourcePort,
  type ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
} from './ports/provider-position-chain-anchor-evidence-source.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION,
  type AssessProviderPositionChainAnchorCandidateFinalityRequestV1,
  type ProviderPositionChainAnchorCandidateFinalityResultV1,
} from './ports/provider-position-chain-anchor-candidate-finality.port';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const ASSESSED_AT = '2026-09-05T17:00:03.000Z';
const DEFAULT_DEADLINE = '2026-09-05T17:00:10.000Z';
const DEFAULT_APPROVAL_EXPIRY = '2026-09-05T18:00:00.000Z';

type NetworkId = typeof ETHEREUM | typeof SOLANA;
type Anchor = ProviderPositionChainAnchorEvidenceSourceAttestationV1['chainAnchor'];

interface AnchorSet {
  readonly continuityFloor: Anchor;
  readonly chainAnchor: Anchor;
  readonly currentHead: Anchor;
  readonly finalizedHead: Anchor;
}

interface FixtureOptions {
  readonly networkId?: NetworkId;
  readonly finalizedEthereumHeight?: string;
  readonly finalizedEthereumHash?: string;
  readonly finalizedSolanaSlot?: string;
  readonly finalizedSolanaRoot?: string;
  readonly deadlineAt?: string;
  readonly approvalExpiresAt?: string;
  readonly finalityClock?: ControlledClock;
  readonly signalController?: AbortController;
}

interface Fixture {
  readonly producer: DormantProviderPositionChainAnchorEvidenceProducer;
  readonly producerClock: SequenceClock;
  readonly finalizer: DormantProviderPositionChainAnchorCandidateFinalityFinalizer;
  readonly finalityClock: ControlledClock;
  readonly producerRequest: ProduceProviderPositionChainAnchorEvidenceRequestV1;
  readonly producerCapability: unknown;
  readonly request: AssessProviderPositionChainAnchorCandidateFinalityRequestV1;
  readonly signalController: AbortController;
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function frozenNullPrototype<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function ethereumAnchors(
  finalizedHeight = '110',
  finalizedHash = `0x${'4'.repeat(64)}`,
): AnchorSet {
  return frozen({
    continuityFloor: frozen({
      kind: 'EVM_BLOCK' as const,
      blockNumber: '90',
      blockHash: `0x${'1'.repeat(64)}`,
    }),
    chainAnchor: frozen({
      kind: 'EVM_BLOCK' as const,
      blockNumber: '100',
      blockHash: `0x${'2'.repeat(64)}`,
    }),
    currentHead: frozen({
      kind: 'EVM_BLOCK' as const,
      blockNumber: '120',
      blockHash: `0x${'3'.repeat(64)}`,
    }),
    finalizedHead: frozen({
      kind: 'EVM_BLOCK' as const,
      blockNumber: finalizedHeight,
      blockHash: finalizedHash,
    }),
  });
}

function solanaAnchors(finalizedSlot = '110', finalizedRoot = '100'): AnchorSet {
  return frozen({
    continuityFloor: frozen({ kind: 'SOLANA_SLOT' as const, slot: '90', root: '80' }),
    chainAnchor: frozen({ kind: 'SOLANA_SLOT' as const, slot: '100', root: '90' }),
    currentHead: frozen({ kind: 'SOLANA_SLOT' as const, slot: '120', root: '110' }),
    finalizedHead: frozen({
      kind: 'SOLANA_SLOT' as const,
      slot: finalizedSlot,
      root: finalizedRoot,
    }),
  });
}

function anchorSets(options: FixtureOptions): Readonly<Record<NetworkId, AnchorSet>> {
  return frozen({
    [ETHEREUM]: ethereumAnchors(options.finalizedEthereumHeight, options.finalizedEthereumHash),
    [SOLANA]: solanaAnchors(options.finalizedSolanaSlot, options.finalizedSolanaRoot),
  });
}

function sourcePair(networkId: NetworkId, expiresAt: string) {
  return frozen({
    networkId,
    approvalId: `${networkId === ETHEREUM ? 'ethereum' : 'solana'}-approval-001`,
    approvedAt: '2026-09-05T16:00:00.000Z',
    expiresAt,
    primary: frozen({
      sourceFamilyId: 'family-a',
      sourceId: 'source-a',
      sourceKind: 'RPC' as const,
    }),
    corroborating: frozen({
      sourceFamilyId: 'family-b',
      sourceId: 'source-b',
      sourceKind: 'RPC' as const,
    }),
  });
}

function approvedRegistry(
  expiresAt: string,
): ProviderPositionChainAnchorEvidenceSourcePairRegistryV1 {
  const content: ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1 = frozen({
    schemaVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    environment: 'MAINNET',
    approvalStatus: 'APPROVED',
    pairs: frozen([sourcePair(ETHEREUM, expiresAt), sourcePair(SOLANA, expiresAt)]),
  });
  return frozen({
    ...content,
    fingerprintSha256: fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1(content),
  });
}

function sourceAttestation(
  request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  values: AnchorSet,
  proofSeed: string,
): ProviderPositionChainAnchorEvidenceSourceAttestationV1 {
  return frozen({
    sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId: request.networkId,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: request.sourceKind,
    sourceObservationId: request.sourceObservationId,
    continuityFloor: request.continuityFloor,
    chainAnchor: request.chainAnchor,
    observedAt: request.observedAt,
    assessedAt: '2026-09-05T17:00:01.000Z',
    currentHead: values.currentHead,
    currentHeadAdvancedAt: '2026-09-05T16:59:59.000Z',
    finalizedHead: values.finalizedHead,
    finalizedHeadAdvancedAt: '2026-09-05T16:59:50.000Z',
    identityProofSha256: proofSeed.repeat(64),
    liveCapabilityProofSha256: String.fromCharCode(proofSeed.charCodeAt(0) + 1).repeat(64),
    lineageProofSha256: String.fromCharCode(proofSeed.charCodeAt(0) + 2).repeat(64),
  });
}

class IssuingSource implements ProviderPositionChainAnchorEvidenceSourcePort {
  readonly sourceVersion = PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION;
  readonly #issued = new WeakMap<object, ReadProviderPositionChainAnchorEvidenceSourceRequestV1>();

  constructor(
    private readonly values: Readonly<Record<NetworkId, AnchorSet>>,
    private readonly proofSeed: string,
  ) {}

  async readAttestation(
    request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): Promise<unknown> {
    const capability = sourceAttestation(request, this.values[request.networkId], this.proofSeed);
    this.#issued.set(capability, request);
    return capability;
  }

  verifyAttestation(
    capability: unknown,
    request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): boolean {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      this.#issued.get(capability) === request
    );
  }
}

class SequenceClock implements ProviderPositionChainAnchorEvidenceProducerClock {
  reads = 0;

  constructor(private readonly values: readonly string[]) {}

  now(): Date {
    const value = this.values[Math.min(this.reads, this.values.length - 1)];
    this.reads += 1;
    if (value === undefined) throw new Error('unexpected producer clock read');
    return new Date(value);
  }
}

class ControlledClock implements ProviderPositionChainAnchorCandidateFinalityClock {
  reads = 0;
  milliseconds: number;
  values: readonly number[];
  onRead: ((read: number) => void) | null = null;

  constructor(milliseconds = Date.parse(ASSESSED_AT), values: readonly number[] = frozen([])) {
    this.milliseconds = milliseconds;
    this.values = values;
  }

  now(): Date {
    const index = this.reads;
    this.reads += 1;
    this.onRead?.(this.reads);
    return new Date(this.values[index] ?? this.milliseconds);
  }
}

function bindings(
  values: Readonly<Record<NetworkId, AnchorSet>>,
): readonly ProviderPositionChainAnchorEvidenceSourceBindingV1[] {
  const definitions = [
    [ETHEREUM, 'PRIMARY', 'family-a', 'source-a', '1'],
    [ETHEREUM, 'CORROBORATING', 'family-b', 'source-b', '4'],
    [SOLANA, 'PRIMARY', 'family-a', 'source-a', '7'],
    [SOLANA, 'CORROBORATING', 'family-b', 'source-b', 'a'],
  ] as const;
  return frozen(
    definitions.map(([networkId, role, sourceFamilyId, sourceId, proofSeed]) =>
      frozen({
        networkId,
        role,
        sourceFamilyId,
        sourceId,
        sourceKind: 'RPC' as const,
        source: new IssuingSource(values, proofSeed),
      }),
    ),
  );
}

function configuredProducer(options: FixtureOptions = {}): Readonly<{
  producer: DormantProviderPositionChainAnchorEvidenceProducer;
  producerClock: SequenceClock;
  values: Readonly<Record<NetworkId, AnchorSet>>;
}> {
  const values = anchorSets(options);
  const producerClock = new SequenceClock(
    frozen([
      '2026-09-05T17:00:00.000Z',
      '2026-09-05T17:00:01.000Z',
      '2026-09-05T17:00:01.000Z',
      '2026-09-05T17:00:02.000Z',
      '2026-09-05T17:00:02.000Z',
      '2026-09-05T17:00:03.000Z',
    ]),
  );
  return frozen({
    producer: new DormantProviderPositionChainAnchorEvidenceProducer(
      approvedRegistry(options.approvalExpiresAt ?? DEFAULT_APPROVAL_EXPIRY),
      bindings(values),
      producerClock,
    ),
    producerClock,
    values,
  });
}

function producerRequest(
  networkId: NetworkId,
  values: AnchorSet,
  signal: AbortSignal,
  deadlineAt = DEFAULT_DEADLINE,
): ProduceProviderPositionChainAnchorEvidenceRequestV1 {
  return frozen({
    producerVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId,
    sourceFamilyId: 'family-a',
    sourceId: 'source-a',
    sourceKind: 'RPC',
    sourceObservationId:
      networkId === ETHEREUM
        ? `ethereum-block-${values.chainAnchor.kind === 'EVM_BLOCK' ? values.chainAnchor.blockNumber : ''}`
        : `solana-slot-${values.chainAnchor.kind === 'SOLANA_SLOT' ? values.chainAnchor.slot : ''}`,
    continuityFloor: values.continuityFloor,
    chainAnchor: values.chainAnchor,
    observedAt: '2026-09-05T16:59:50.000Z',
    deadlineAt,
    signal,
  });
}

function finalityRequest(
  capability: unknown,
  request: ProduceProviderPositionChainAnchorEvidenceRequestV1,
): AssessProviderPositionChainAnchorCandidateFinalityRequestV1 {
  return frozen({
    finalityVersion: PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_CANDIDATE_FINALITY_ASSESS_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    producerCapability: capability,
    producerRequest: request,
    signal: request.signal,
  });
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const networkId = options.networkId ?? ETHEREUM;
  const signalController = options.signalController ?? new AbortController();
  const configured = configuredProducer(options);
  const finalityClock = options.finalityClock ?? new ControlledClock();
  const finalizer = new DormantProviderPositionChainAnchorCandidateFinalityFinalizer(
    configured.producer,
    finalityClock,
  );
  const exactProducerRequest = producerRequest(
    networkId,
    configured.values[networkId],
    signalController.signal,
    options.deadlineAt,
  );
  const producerCapability = await configured.producer.produceCandidate(exactProducerRequest);
  const request = finalityRequest(producerCapability, exactProducerRequest);
  return {
    producer: configured.producer,
    producerClock: configured.producerClock,
    finalizer,
    finalityClock,
    producerRequest: exactProducerRequest,
    producerCapability,
    request,
    signalController,
  };
}

function expectFailure(
  operation: () => unknown,
  code: ProviderPositionChainAnchorCandidateFinalityErrorCode,
): void {
  expect(operation).toThrow(
    expect.objectContaining({
      name: 'ProviderPositionChainAnchorCandidateFinalityUnavailableError',
      code,
      message: 'Provider-position chain-anchor candidate finality is unavailable.',
    }),
  );
}

function expectFrozenNullPrototype(value: unknown): void {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.getPrototypeOf(value)).toBeNull();
}

function reviewedResult(value: Fixture): ProviderPositionChainAnchorCandidateFinalityResultV1 {
  const capability = value.finalizer.assessCandidate(value.request);
  const reviewed = value.finalizer.reviewAssessment(capability, value.request);
  if (reviewed === null) throw new Error('expected an authenticated finality result');
  return reviewed;
}

describe('DormantProviderPositionChainAnchorCandidateFinalityFinalizer', () => {
  it('remains inert, source-only, unregistered, and free of runtime authority', () => {
    const configured = configuredProducer();
    const clock = new ControlledClock();

    const finalizer = new DormantProviderPositionChainAnchorCandidateFinalityFinalizer(
      configured.producer,
      clock,
    );

    expect(finalizer.finalityVersion).toBe(1);
    expect(configured.producerClock.reads).toBe(0);
    expect(clock.reads).toBe(0);

    const source = readFileSync(
      join(__dirname, 'dormant-provider-position-chain-anchor-candidate-finality.finalizer.ts'),
      'utf8',
    );
    const moduleSource = readFileSync(join(__dirname, '../mainnet-platforms.module.ts'), 'utf8');
    expect(mainnetPlatformsFeature).not.toHaveProperty(
      'DormantProviderPositionChainAnchorCandidateFinalityFinalizer',
    );
    expect(moduleSource).not.toContain(
      'dormant-provider-position-chain-anchor-candidate-finality.finalizer',
    );
    expect(source).not.toMatch(
      /@(?:Injectable|Module)|NestFactory|createApplicationContext|process\.env|fetch\s*\(|setTimeout|setInterval|WebSocket|\.query\s*\(|console\s*\.|logger\s*\.|https?:\/\//u,
    );
    expect(source).not.toMatch(/(?:privateKey|secret|bearer|rawToken|dispatchToken|leaseToken)/iu);
  });

  it('descriptor-captures a safe server clock and does not accept caller assessment time', async () => {
    const value = await fixture();
    const forbiddenClock = jest.fn(() => new Date(0));
    Object.defineProperty(value.finalityClock, 'now', {
      configurable: true,
      enumerable: true,
      value: forbiddenClock,
      writable: true,
    });

    const result = reviewedResult(value);

    expect(result.assessedAt).toBe(ASSESSED_AT);
    expect(forbiddenClock).not.toHaveBeenCalled();
    expect(value.request).not.toHaveProperty('assessedAt');
    expect(value.request).not.toHaveProperty('now');
    expect(value.request).not.toHaveProperty('clock');
  });

  it('rejects an injected clock accessor without invoking it', () => {
    const configured = configuredProducer();
    const getter = jest.fn(() => () => new Date(ASSESSED_AT));
    const clock = Object.defineProperty({}, 'now', {
      enumerable: true,
      get: getter,
    }) as ProviderPositionChainAnchorCandidateFinalityClock;

    expectFailure(
      () =>
        new DormantProviderPositionChainAnchorCandidateFinalityFinalizer(
          configured.producer,
          clock,
        ),
      'INVALID_CONFIGURATION',
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it('authenticates the exact producer capability/request twice before issuing', async () => {
    const value = await fixture();
    expect(value.producerClock.reads).toBe(5);

    const capability = value.finalizer.assessCandidate(value.request);

    expect(value.producerClock.reads).toBe(7);
    expectFrozenNullPrototype(capability);
    const reviewed = value.finalizer.reviewAssessment(capability, value.request);
    expect(reviewed).toBe(capability);
    expect(value.producerClock.reads).toBe(8);
  });

  it('rejects cloned producer capabilities and producer-request identities before classification', async () => {
    const value = await fixture();
    const clonedCapability = frozenNullPrototype({
      ...(value.producerCapability as Record<string, unknown>),
    });
    const capabilityCloneRequest = frozen({
      ...value.request,
      producerCapability: clonedCapability,
    });
    expectFailure(
      () => value.finalizer.assessCandidate(capabilityCloneRequest),
      'CANDIDATE_UNAVAILABLE',
    );

    const clonedProducerRequest = frozen({ ...value.producerRequest });
    const producerRequestCloneRequest = frozen({
      ...value.request,
      producerRequest: clonedProducerRequest,
      signal: clonedProducerRequest.signal,
    });
    expectFailure(
      () => value.finalizer.assessCandidate(producerRequestCloneRequest),
      'CANDIDATE_UNAVAILABLE',
    );
  });

  it('binds immutable null-prototype results to the exact assessment request identity', async () => {
    const value = await fixture();
    const capability = value.finalizer.assessCandidate(value.request);
    const reviewed = value.finalizer.reviewAssessment(capability, value.request);
    if (reviewed === null) throw new Error('expected authenticated result');

    expectFrozenNullPrototype(reviewed);
    expectFrozenNullPrototype(reviewed.candidateAnchor);
    expectFrozenNullPrototype(reviewed.agreedFinalizedHead);
    expect(reviewed.mayAuthorizeFinancialAction).toBe(false);
    expect(reviewed.mayPersist).toBe(false);
    expect(reviewed.mayCreatePositionSnapshot).toBe(false);
    expect(
      value.finalizer.reviewAssessment(frozenNullPrototype({ ...reviewed }), value.request),
    ).toBe(null);
    expect(value.finalizer.reviewAssessment(capability, frozen({ ...value.request }))).toBe(null);
  });

  it.each([
    {
      name: 'above-candidate finalized height with authenticated lineage',
      height: '110',
      hash: `0x${'4'.repeat(64)}`,
      status: 'FINALIZED',
      reason: 'ETHEREUM_FINALIZED_LINEAGE_COVERS_CANDIDATE',
    },
    {
      name: 'same-height finalized hash match',
      height: '100',
      hash: `0x${'2'.repeat(64)}`,
      status: 'FINALIZED',
      reason: 'ETHEREUM_FINALIZED_HASH_MATCH',
    },
    {
      name: 'below-candidate finalized height',
      height: '99',
      hash: `0x${'4'.repeat(64)}`,
      status: 'PENDING',
      reason: 'ETHEREUM_FINALIZED_HEIGHT_BELOW_CANDIDATE',
    },
    {
      name: 'same-height finalized hash conflict',
      height: '100',
      hash: `0x${'5'.repeat(64)}`,
      status: 'QUARANTINED',
      reason: 'ETHEREUM_FINALIZED_HASH_CONFLICT',
    },
  ] as const)('classifies Ethereum $name', async ({ height, hash, status, reason }) => {
    const value = await fixture({
      networkId: ETHEREUM,
      finalizedEthereumHeight: height,
      finalizedEthereumHash: hash,
    });

    const result = reviewedResult(value);

    expect(result).toEqual(
      expect.objectContaining({
        networkId: ETHEREUM,
        status,
        reason,
        authenticatedLineageProof: true,
        comparedSolanaFinalizedRoot: false,
        claimsSameSlotForkDetection: false,
      }),
    );
  });

  it('uses only Solana finalized root, never the larger finalized slot', async () => {
    const value = await fixture({
      networkId: SOLANA,
      finalizedSolanaSlot: '120',
      finalizedSolanaRoot: '99',
    });

    const result = reviewedResult(value);

    expect(result.status).toBe('PENDING');
    expect(result.reason).toBe('SOLANA_FINALIZED_ROOT_BELOW_CANDIDATE_SLOT');
    expect(result.comparedSolanaFinalizedRoot).toBe(true);
    expect(result.claimsSameSlotForkDetection).toBe(false);
  });

  it('finalizes a Solana candidate only when the finalized root covers its slot', async () => {
    const value = await fixture({
      networkId: SOLANA,
      finalizedSolanaSlot: '100',
      finalizedSolanaRoot: '100',
    });

    const result = reviewedResult(value);

    expect(result.status).toBe('FINALIZED');
    expect(result.reason).toBe('SOLANA_FINALIZED_ROOT_COVERS_CANDIDATE_SLOT');
    expect(result.claimsSameSlotForkDetection).toBe(false);
  });

  it('quarantines a Solana finalized-root regression from the candidate-observed root', async () => {
    const value = await fixture({
      networkId: SOLANA,
      finalizedSolanaSlot: '110',
      finalizedSolanaRoot: '89',
    });

    const result = reviewedResult(value);

    expect(result.status).toBe('QUARANTINED');
    expect(result.reason).toBe('SOLANA_FINALIZED_ROOT_REGRESSION');
    expect(result.claimsSameSlotForkDetection).toBe(false);
  });

  it('never upgrades an issued pending result in place', async () => {
    const value = await fixture({
      networkId: SOLANA,
      finalizedSolanaSlot: '120',
      finalizedSolanaRoot: '99',
    });
    const capability = value.finalizer.assessCandidate(value.request);
    const first = value.finalizer.reviewAssessment(capability, value.request);
    if (first === null) throw new Error('expected authenticated pending result');
    value.finalityClock.milliseconds = Date.parse('2026-09-05T17:00:04.000Z');

    const later = value.finalizer.reviewAssessment(capability, value.request);

    expect(first.status).toBe('PENDING');
    expect(later).toBe(first);
    expect(later?.status).toBe('PENDING');
    expect(Reflect.set(first, 'status', 'FINALIZED')).toBe(false);
  });

  it.each([
    {
      name: 'producer deadline',
      options: { deadlineAt: DEFAULT_DEADLINE },
      boundary: DEFAULT_DEADLINE,
    },
    {
      name: 'source-pair approval expiry',
      options: { approvalExpiresAt: '2026-09-05T17:00:04.000Z' },
      boundary: '2026-09-05T17:00:04.000Z',
    },
    {
      name: 'Solana current-head freshness expiry',
      options: { networkId: SOLANA, deadlineAt: '2026-09-05T17:00:25.000Z' },
      boundary: '2026-09-05T17:00:14.000Z',
    },
  ] as const)('treats $name as an exclusive boundary', async ({ options, boundary }) => {
    const value = await fixture(options);
    const capability = value.finalizer.assessCandidate(value.request);
    const issued = value.finalizer.reviewAssessment(capability, value.request);
    expect(issued?.expiresAtExclusive).toBe(boundary);
    value.finalityClock.milliseconds = Date.parse(boundary);

    expectFailure(
      () => value.finalizer.reviewAssessment(capability, value.request),
      'STALE_ASSESSMENT',
    );
  });

  it('fails closed when the exact signal aborts before the second producer review', async () => {
    const clock = new ControlledClock();
    const controller = new AbortController();
    const value = await fixture({ finalityClock: clock, signalController: controller });
    clock.onRead = (read) => {
      if (read === 3) controller.abort();
    };

    expectFailure(() => value.finalizer.assessCandidate(value.request), 'STALE_ASSESSMENT');
  });

  it('fails closed on intra-assessment and later-review clock regression', async () => {
    const regressingClock = new ControlledClock(Date.parse(ASSESSED_AT), [
      Date.parse(ASSESSED_AT),
      Date.parse('2026-09-05T17:00:02.999Z'),
    ]);
    const regressing = await fixture({ finalityClock: regressingClock });
    expectFailure(
      () => regressing.finalizer.assessCandidate(regressing.request),
      'CLOCK_REGRESSION',
    );

    const value = await fixture();
    const capability = value.finalizer.assessCandidate(value.request);
    value.finalityClock.milliseconds = Date.parse('2026-09-05T17:00:02.999Z');
    expectFailure(
      () => value.finalizer.reviewAssessment(capability, value.request),
      'CLOCK_REGRESSION',
    );
  });

  it('collapses producer failures to one sanitized candidate-unavailable error', async () => {
    const value = await fixture();
    value.signalController.abort('sensitive-upstream-reason');

    try {
      value.finalizer.assessCandidate(value.request);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderPositionChainAnchorCandidateFinalityUnavailableError);
      expect(error).toEqual(expect.objectContaining({ code: 'STALE_ASSESSMENT' }));
      expect(String(error)).not.toContain('sensitive-upstream-reason');
      expect(error).not.toHaveProperty('cause');
    }
  });
});
