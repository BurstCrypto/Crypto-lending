import * as producerModule from './dormant-provider-position-chain-anchor-evidence.producer';
import {
  DormantProviderPositionChainAnchorEvidenceProducer,
  DormantProviderPositionChainAnchorEvidenceUnavailableError,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_PAIR_REGISTRY_V1,
  fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
  type ProduceProviderPositionChainAnchorEvidenceRequestV1,
  type ProviderPositionChainAnchorEvidenceProducerClock,
  type ProviderPositionChainAnchorEvidenceSourceBindingV1,
  type ProviderPositionChainAnchorEvidenceSourcePairV1,
  type ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1,
  type ProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
} from './dormant-provider-position-chain-anchor-evidence.producer';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
  type ProviderPositionChainAnchorEvidenceSourceAttestationV1,
  type ProviderPositionChainAnchorEvidenceSourcePort,
  type ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
} from './ports/provider-position-chain-anchor-evidence-source.port';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const ZERO_SHA256 = '0'.repeat(64);

type NetworkId = typeof ETHEREUM | typeof SOLANA;

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function pairFor(networkId: NetworkId): ProviderPositionChainAnchorEvidenceSourcePairV1 {
  return frozen({
    networkId,
    approvalId: `${networkId === ETHEREUM ? 'ethereum' : 'solana'}-approval-001`,
    approvedAt: '2026-09-05T16:00:00.000Z',
    expiresAt: '2026-09-05T18:00:00.000Z',
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

function pairContent(): ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1 {
  return frozen({
    schemaVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    environment: 'MAINNET',
    approvalStatus: 'APPROVED',
    pairs: frozen([pairFor(ETHEREUM), pairFor(SOLANA)]),
  });
}

function approvedRegistry(
  networkId: NetworkId,
): ProviderPositionChainAnchorEvidenceSourcePairRegistryV1 {
  void networkId;
  const content = pairContent();
  return frozen({
    ...content,
    fingerprintSha256: fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1(content),
  });
}

function anchors(networkId: NetworkId): Readonly<{
  continuityFloor: ProviderPositionChainAnchorEvidenceSourceAttestationV1['continuityFloor'];
  chainAnchor: ProviderPositionChainAnchorEvidenceSourceAttestationV1['chainAnchor'];
  currentHead: ProviderPositionChainAnchorEvidenceSourceAttestationV1['currentHead'];
  finalizedHead: ProviderPositionChainAnchorEvidenceSourceAttestationV1['finalizedHead'];
}> {
  return networkId === ETHEREUM
    ? frozen({
        continuityFloor: frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '50000000',
          blockHash: `0x${'1'.repeat(64)}`,
        }),
        chainAnchor: frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '50000001',
          blockHash: `0x${'2'.repeat(64)}`,
        }),
        currentHead: frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '50000010',
          blockHash: `0x${'3'.repeat(64)}`,
        }),
        finalizedHead: frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '49999990',
          blockHash: `0x${'4'.repeat(64)}`,
        }),
      })
    : frozen({
        continuityFloor: frozen({
          kind: 'SOLANA_SLOT' as const,
          slot: '441990700',
          root: '441990699',
        }),
        chainAnchor: frozen({ kind: 'SOLANA_SLOT' as const, slot: '441990796', root: '441990700' }),
        currentHead: frozen({ kind: 'SOLANA_SLOT' as const, slot: '441990810', root: '441990800' }),
        finalizedHead: frozen({
          kind: 'SOLANA_SLOT' as const,
          slot: '441990800',
          root: '441990800',
        }),
      });
}

function request(
  networkId: NetworkId,
  signal: AbortSignal = new AbortController().signal,
): ProduceProviderPositionChainAnchorEvidenceRequestV1 {
  const values = anchors(networkId);
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
      networkId === ETHEREUM ? 'ethereum-block-50000001' : 'solana-slot-441990796',
    continuityFloor: values.continuityFloor,
    chainAnchor: values.chainAnchor,
    observedAt: '2026-09-05T16:59:50.000Z',
    deadlineAt: '2026-09-05T17:00:10.000Z',
    signal,
  });
}

function attestation(
  readRequest: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  proofSeed: string,
): ProviderPositionChainAnchorEvidenceSourceAttestationV1 {
  const values = anchors(readRequest.networkId);
  return frozen({
    sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
    use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    networkId: readRequest.networkId,
    sourceFamilyId: readRequest.sourceFamilyId,
    sourceId: readRequest.sourceId,
    sourceKind: readRequest.sourceKind,
    sourceObservationId: readRequest.sourceObservationId,
    continuityFloor: readRequest.continuityFloor,
    chainAnchor: readRequest.chainAnchor,
    observedAt: readRequest.observedAt,
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
  readonly requests: ReadProviderPositionChainAnchorEvidenceSourceRequestV1[] = [];
  readonly capabilities: object[] = [];
  readonly #issued = new WeakMap<object, ReadProviderPositionChainAnchorEvidenceSourceRequestV1>();

  constructor(private readonly proofSeed: string) {}

  async readAttestation(
    readRequest: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): Promise<unknown> {
    this.requests.push(readRequest);
    const capability = attestation(readRequest, this.proofSeed);
    this.capabilities.push(capability);
    this.#issued.set(capability, readRequest);
    return capability;
  }

  verifyAttestation(
    capability: unknown,
    readRequest: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): boolean {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      this.#issued.get(capability) === readRequest
    );
  }
}

function clock(...timestamps: string[]): ProviderPositionChainAnchorEvidenceProducerClock {
  let index = 0;
  return frozen({
    now(): Date {
      const value = timestamps[Math.min(index, timestamps.length - 1)];
      index += 1;
      if (value === undefined) throw new Error('unexpected clock read');
      return new Date(value);
    },
  });
}

function bindings(
  networkId: NetworkId,
  primary: ProviderPositionChainAnchorEvidenceSourcePort,
  corroborating: ProviderPositionChainAnchorEvidenceSourcePort,
): readonly ProviderPositionChainAnchorEvidenceSourceBindingV1[] {
  const otherNetwork = networkId === ETHEREUM ? SOLANA : ETHEREUM;
  return frozen([
    frozen({
      networkId,
      role: 'PRIMARY' as const,
      sourceFamilyId: 'family-a',
      sourceId: 'source-a',
      sourceKind: 'RPC' as const,
      source: primary,
    }),
    frozen({
      networkId,
      role: 'CORROBORATING' as const,
      sourceFamilyId: 'family-b',
      sourceId: 'source-b',
      sourceKind: 'RPC' as const,
      source: corroborating,
    }),
    frozen({
      networkId: otherNetwork,
      role: 'PRIMARY' as const,
      sourceFamilyId: 'family-a',
      sourceId: 'source-a',
      sourceKind: 'RPC' as const,
      source: new IssuingSource('7'),
    }),
    frozen({
      networkId: otherNetwork,
      role: 'CORROBORATING' as const,
      sourceFamilyId: 'family-b',
      sourceId: 'source-b',
      sourceKind: 'RPC' as const,
      source: new IssuingSource('4'),
    }),
  ]);
}

function producer(
  networkId: NetworkId,
  primary: ProviderPositionChainAnchorEvidenceSourcePort = new IssuingSource('a'),
  corroborating: ProviderPositionChainAnchorEvidenceSourcePort = new IssuingSource('d'),
): DormantProviderPositionChainAnchorEvidenceProducer {
  return new DormantProviderPositionChainAnchorEvidenceProducer(
    approvedRegistry(networkId),
    bindings(networkId, primary, corroborating),
    clock(
      '2026-09-05T17:00:00.000Z',
      '2026-09-05T17:00:01.000Z',
      '2026-09-05T17:00:01.000Z',
      '2026-09-05T17:00:02.000Z',
      '2026-09-05T17:00:02.000Z',
      '2026-09-05T17:00:03.000Z',
    ),
  );
}

function expectFailure(
  value: Promise<unknown> | (() => unknown),
  code: DormantProviderPositionChainAnchorEvidenceUnavailableError['code'],
): void | Promise<void> {
  const expected = expect.objectContaining({ code });
  return typeof value === 'function'
    ? expect(value).toThrow(expected)
    : expect(value).rejects.toEqual(expected);
}

describe('DormantProviderPositionChainAnchorEvidenceProducer', () => {
  it('keeps the checked-in production registry empty, unapproved, immutable and inert', async () => {
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_PAIR_REGISTRY_V1).toEqual({
      schemaVersion: 1,
      environment: 'MAINNET',
      approvalStatus: 'NOT_APPROVED',
      pairs: [],
      fingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(
      PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_PAIR_REGISTRY_V1.fingerprintSha256,
    ).not.toBe(ZERO_SHA256);
    expect(Object.isFrozen(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_PAIR_REGISTRY_V1)).toBe(
      true,
    );
    expect(
      Object.isFrozen(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_PAIR_REGISTRY_V1.pairs),
    ).toBe(true);
    expect(
      Object.getPrototypeOf(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_PAIR_REGISTRY_V1),
    ).toBeNull();

    const dormant = new DormantProviderPositionChainAnchorEvidenceProducer(
      PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_PAIR_REGISTRY_V1,
      frozen([]),
      clock('2026-09-05T17:00:00.000Z'),
    );
    await expectFailure(dormant.produceCandidate(request(ETHEREUM)), 'UNAPPROVED_SOURCE_PAIR');
  });

  it.each([ETHEREUM, SOLANA] as const)(
    'authenticates two independent %s attestations and issues only an exact-request-bound 23-argument candidate',
    async (networkId) => {
      const primary = new IssuingSource('a');
      const corroborating = new IssuingSource('d');
      const service = producer(networkId, primary, corroborating);
      const exactRequest = request(networkId);

      const capability = await service.produceCandidate(exactRequest);

      expect(primary.requests).toHaveLength(1);
      expect(corroborating.requests).toHaveLength(1);
      expect(primary.requests[0]?.signal).toBe(exactRequest.signal);
      expect(corroborating.requests[0]?.signal).toBe(exactRequest.signal);
      expect(primary.requests[0]?.evaluatedAt).toBe('2026-09-05T17:00:00.000Z');
      expect(corroborating.requests[0]?.evaluatedAt).toBe('2026-09-05T17:00:00.000Z');
      expect(primary.requests[0]?.deadlineAt).toBe(exactRequest.deadlineAt);
      expect(corroborating.requests[0]?.deadlineAt).toBe(exactRequest.deadlineAt);
      expect(primary.requests[0]?.sourceId).toBe('source-a');
      expect(corroborating.requests[0]?.sourceId).toBe('source-b');
      expect(primary.requests[0]?.sourceKind).toBe('RPC');
      expect(corroborating.requests[0]?.sourceKind).toBe('RPC');
      expect(primary.requests[0]).not.toBe(corroborating.requests[0]);
      expect(primary.capabilities[0]).not.toBe(corroborating.capabilities[0]);

      const reviewed = service.reviewCandidate(capability, exactRequest);
      expect(reviewed).toEqual({
        producerVersion: 1,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE,
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        recordArguments: expect.any(Array),
      });
      expect(Object.isFrozen(reviewed)).toBe(true);
      expect(Object.getPrototypeOf(reviewed)).toBeNull();
      expect(Object.isFrozen(reviewed.recordArguments)).toBe(true);
      expect(reviewed.recordArguments).toHaveLength(23);
      expect(reviewed).not.toHaveProperty('recordPlans');
      expect(reviewed).not.toHaveProperty('corroboratingRecordArguments');
      expect(reviewed.recordArguments.slice(0, 9)).toEqual([
        networkId,
        'family-a',
        'source-a',
        'RPC',
        exactRequest.sourceObservationId,
        expect.any(Object),
        expect.any(Object),
        exactRequest.observedAt,
        '2026-09-05T17:00:02.000Z',
      ]);
      expect(reviewed.recordArguments.slice(13, 16)).toEqual([
        expect.stringMatching(/^[0-9a-f]{64}$/u),
        expect.stringMatching(/^[0-9a-f]{64}$/u),
        expect.stringMatching(/^[0-9a-f]{64}$/u),
      ]);
      expect(new Set(reviewed.recordArguments.slice(13, 16))).toHaveProperty('size', 3);
      expect(reviewed.recordArguments.slice(16)).toEqual([
        'family-a',
        'source-a',
        'family-b',
        'source-b',
        `${networkId === ETHEREUM ? 'ethereum' : 'solana'}-approval-001`,
        approvedRegistry(networkId).fingerprintSha256,
        '2026-09-05T18:00:00.000Z',
      ]);
      await expectFailure(
        () => service.reviewCandidate(capability, frozen({ ...exactRequest })),
        'INVALID_REQUEST',
      );
      await expectFailure(
        () => service.reviewCandidate(frozen({ ...reviewed }), exactRequest),
        'INVALID_REQUEST',
      );
    },
  );

  it('starts and drains both reads when one synchronously throws or returns a non-Promise', async () => {
    for (const behavior of ['throw', 'thenable'] as const) {
      const calls: string[] = [];
      let release!: (value: unknown) => void;
      const pending = new Promise<unknown>((resolve) => {
        release = resolve;
      });
      const primary = {
        sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
        readAttestation(): Promise<unknown> {
          calls.push('primary');
          if (behavior === 'throw') throw new Error('sync failure');
          return { then: () => undefined } as unknown as Promise<unknown>;
        },
        verifyAttestation: () => false,
      } satisfies ProviderPositionChainAnchorEvidenceSourcePort;
      const corroborating = {
        sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
        readAttestation(): Promise<unknown> {
          calls.push('corroborating');
          return pending;
        },
        verifyAttestation: () => false,
      } satisfies ProviderPositionChainAnchorEvidenceSourcePort;
      const operation = producer(ETHEREUM, primary, corroborating).produceCandidate(
        request(ETHEREUM),
      );
      let settled = false;
      void operation.catch(() => {
        settled = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(calls.sort()).toEqual(['corroborating', 'primary']);
      expect(settled).toBe(false);
      release(frozen({}));
      await expectFailure(operation, 'SOURCE_UNAVAILABLE');
    }
  });

  it('authenticates capabilities before inspecting them and rejects aliased sources', async () => {
    let inspected = false;
    const hostileCapability = Object.freeze(
      Object.defineProperty({}, 'sourceVersion', {
        enumerable: true,
        get: () => {
          inspected = true;
          throw new Error('must not inspect');
        },
      }),
    );
    const untrusted = {
      sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
      async readAttestation(): Promise<unknown> {
        return hostileCapability;
      },
      verifyAttestation: () => false,
    } satisfies ProviderPositionChainAnchorEvidenceSourcePort;
    await expectFailure(
      producer(ETHEREUM, untrusted).produceCandidate(request(ETHEREUM)),
      'SOURCE_ATTESTATION_INVALID',
    );
    expect(inspected).toBe(false);

    const aliased = new IssuingSource('a');
    expectFailure(
      () =>
        new DormantProviderPositionChainAnchorEvidenceProducer(
          approvedRegistry(ETHEREUM),
          bindings(ETHEREUM, aliased, aliased),
          clock('2026-09-05T17:00:00.000Z'),
        ),
      'INVALID_CONFIGURATION',
    );
  });

  it('rechecks abort and time after both hostile verifiers before inspecting either capability', async () => {
    const controller = new AbortController();
    let inspected = false;
    let verifierCalls = 0;
    const source = (abort: boolean): ProviderPositionChainAnchorEvidenceSourcePort => ({
      sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
      async readAttestation(): Promise<unknown> {
        return Object.freeze(
          Object.defineProperty({}, 'sourceVersion', {
            enumerable: true,
            get: () => {
              inspected = true;
              throw new Error('capability must remain opaque');
            },
          }),
        );
      },
      verifyAttestation(): boolean {
        verifierCalls += 1;
        if (abort) controller.abort();
        return true;
      },
    });
    await expectFailure(
      producer(ETHEREUM, source(true), source(false)).produceCandidate(
        request(ETHEREUM, controller.signal),
      ),
      'STALE_EVIDENCE',
    );
    expect(verifierCalls).toBe(2);
    expect(inspected).toBe(false);
  });

  it('makes candidate review fail closed after abort or the exact deadline', async () => {
    const controller = new AbortController();
    const deadlineService = new DormantProviderPositionChainAnchorEvidenceProducer(
      approvedRegistry(ETHEREUM),
      bindings(ETHEREUM, new IssuingSource('a'), new IssuingSource('d')),
      clock(
        '2026-09-05T17:00:00.000Z',
        '2026-09-05T17:00:01.000Z',
        '2026-09-05T17:00:01.000Z',
        '2026-09-05T17:00:02.000Z',
        '2026-09-05T17:00:02.000Z',
        '2026-09-05T17:00:10.000Z',
      ),
    );
    const deadlineRequest = request(ETHEREUM, controller.signal);
    const deadlineCapability = await deadlineService.produceCandidate(deadlineRequest);
    expectFailure(
      () => deadlineService.reviewCandidate(deadlineCapability, deadlineRequest),
      'STALE_EVIDENCE',
    );

    const abortedService = producer(ETHEREUM);
    const abortedRequest = request(ETHEREUM, controller.signal);
    const abortedCapability = await abortedService.produceCandidate(abortedRequest);
    controller.abort();
    expectFailure(
      () => abortedService.reviewCandidate(abortedCapability, abortedRequest),
      'STALE_EVIDENCE',
    );

    const headExpiryService = new DormantProviderPositionChainAnchorEvidenceProducer(
      approvedRegistry(SOLANA),
      bindings(SOLANA, new IssuingSource('a'), new IssuingSource('d')),
      clock(
        '2026-09-05T17:00:00.000Z',
        '2026-09-05T17:00:01.000Z',
        '2026-09-05T17:00:01.000Z',
        '2026-09-05T17:00:02.000Z',
        '2026-09-05T17:00:02.000Z',
        '2026-09-05T17:00:16.000Z',
      ),
    );
    const headExpiryRequest = frozen({
      ...request(SOLANA),
      deadlineAt: '2026-09-05T17:00:25.000Z',
    });
    const headExpiryCapability = await headExpiryService.produceCandidate(headExpiryRequest);
    expectFailure(
      () => headExpiryService.reviewCandidate(headExpiryCapability, headExpiryRequest),
      'STALE_EVIDENCE',
    );
  });

  it('rejects head disagreement, stale evidence, expired approval, and malformed canonical input', async () => {
    class MutatingSource extends IssuingSource {
      constructor(
        proofSeed: string,
        private readonly mutate: (
          value: ProviderPositionChainAnchorEvidenceSourceAttestationV1,
        ) => ProviderPositionChainAnchorEvidenceSourceAttestationV1,
      ) {
        super(proofSeed);
      }

      override async readAttestation(
        readRequest: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
      ): Promise<unknown> {
        this.requests.push(readRequest);
        return this.mutate(attestation(readRequest, 'd'));
      }

      override verifyAttestation(): boolean {
        return true;
      }
    }

    const mismatch = new MutatingSource('d', (value) =>
      frozen({
        ...value,
        currentHead: frozen({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '50000011',
          blockHash: `0x${'5'.repeat(64)}`,
        }),
      }),
    );
    await expectFailure(
      producer(ETHEREUM, new IssuingSource('a'), mismatch).produceCandidate(request(ETHEREUM)),
      'SOURCE_DISAGREEMENT',
    );

    const stale = new MutatingSource('d', (value) =>
      frozen({ ...value, currentHeadAdvancedAt: '2026-09-05T16:58:00.000Z' }),
    );
    await expectFailure(
      producer(ETHEREUM, new IssuingSource('a'), stale).produceCandidate(request(ETHEREUM)),
      'STALE_EVIDENCE',
    );

    const replayed = new MutatingSource('d', (value) =>
      frozen({ ...value, assessedAt: '2026-09-05T16:59:59.999Z' }),
    );
    await expectFailure(
      producer(ETHEREUM, new IssuingSource('a'), replayed).produceCandidate(request(ETHEREUM)),
      'SOURCE_ATTESTATION_INVALID',
    );

    const expired = new DormantProviderPositionChainAnchorEvidenceProducer(
      approvedRegistry(ETHEREUM),
      bindings(ETHEREUM, new IssuingSource('a'), new IssuingSource('d')),
      clock('2026-09-05T18:00:00.000Z'),
    );
    await expectFailure(expired.produceCandidate(request(ETHEREUM)), 'INVALID_REQUEST');

    const malformed = frozen({ ...request(ETHEREUM), sourceObservationId: 'request-owned-id' });
    await expectFailure(
      producer(ETHEREUM).produceCandidate(
        malformed as ProduceProviderPositionChainAnchorEvidenceRequestV1,
      ),
      'INVALID_REQUEST',
    );
  });

  it('binds every pair-derived proof to both authenticated source proof sets', async () => {
    const exactRequest = request(ETHEREUM);
    const first = producer(ETHEREUM, new IssuingSource('a'), new IssuingSource('d'));
    const firstCapability = await first.produceCandidate(exactRequest);
    const firstProofs = first
      .reviewCandidate(firstCapability, exactRequest)
      .recordArguments.slice(13, 16);

    const secondRequest = request(ETHEREUM);
    const second = producer(ETHEREUM, new IssuingSource('a'), new IssuingSource('7'));
    const secondCapability = await second.produceCandidate(secondRequest);
    const secondProofs = second
      .reviewCandidate(secondCapability, secondRequest)
      .recordArguments.slice(13, 16);

    expect(firstProofs).not.toEqual(secondProofs);
    expect(firstProofs.every((proof, index) => proof !== secondProofs[index])).toBe(true);
  });

  it('sanitizes source-thrown exported errors at read and verification boundaries', async () => {
    const readSpoof = {
      sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
      readAttestation(): Promise<unknown> {
        throw new DormantProviderPositionChainAnchorEvidenceUnavailableError('INVALID_REQUEST');
      },
      verifyAttestation: () => true,
    } satisfies ProviderPositionChainAnchorEvidenceSourcePort;
    await expectFailure(
      producer(ETHEREUM, readSpoof).produceCandidate(request(ETHEREUM)),
      'SOURCE_UNAVAILABLE',
    );

    const verifySpoof = {
      sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
      async readAttestation(
        readRequest: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
      ): Promise<unknown> {
        return attestation(readRequest, 'a');
      },
      verifyAttestation(): boolean {
        throw new DormantProviderPositionChainAnchorEvidenceUnavailableError(
          'UNAPPROVED_SOURCE_PAIR',
        );
      },
    } satisfies ProviderPositionChainAnchorEvidenceSourcePort;
    await expectFailure(
      producer(ETHEREUM, verifySpoof).produceCandidate(request(ETHEREUM)),
      'SOURCE_ATTESTATION_INVALID',
    );
  });

  it('rejects Object/Function prototype pollution as a source method provider', () => {
    const names = ['readAttestation', 'verifyAttestation'] as const;
    const objectDescriptors = names.map((name) =>
      Object.getOwnPropertyDescriptor(Object.prototype, name),
    );
    const functionDescriptors = names.map((name) =>
      Object.getOwnPropertyDescriptor(Function.prototype, name),
    );
    try {
      for (const prototype of [Object.prototype, Function.prototype]) {
        Object.defineProperty(prototype, 'readAttestation', {
          configurable: true,
          value: async (): Promise<unknown> => frozen({}),
        });
        Object.defineProperty(prototype, 'verifyAttestation', {
          configurable: true,
          value: (): boolean => true,
        });
      }
      const pollutedObject = {
        sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
      } as unknown as ProviderPositionChainAnchorEvidenceSourcePort;
      const pollutedFunction = Object.assign(() => undefined, {
        sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
      }) as unknown as ProviderPositionChainAnchorEvidenceSourcePort;
      for (const polluted of [pollutedObject, pollutedFunction]) {
        expectFailure(
          () =>
            new DormantProviderPositionChainAnchorEvidenceProducer(
              approvedRegistry(ETHEREUM),
              bindings(ETHEREUM, polluted, new IssuingSource('d')),
              clock('2026-09-05T17:00:00.000Z'),
            ),
          'INVALID_CONFIGURATION',
        );
      }
    } finally {
      for (const [prototype, descriptors] of [
        [Object.prototype, objectDescriptors],
        [Function.prototype, functionDescriptors],
      ] as const) {
        names.forEach((name, index) => {
          const descriptor = descriptors[index];
          if (descriptor === undefined) Reflect.deleteProperty(prototype, name);
          else Object.defineProperty(prototype, name, descriptor);
        });
      }
    }
  });

  it('rejects partial approved registries and fingerprint drift', () => {
    const partial = frozen({
      ...pairContent(),
      pairs: frozen([pairFor(ETHEREUM)]),
    });
    expectFailure(
      () => fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1(partial),
      'INVALID_CONFIGURATION',
    );
    const valid = approvedRegistry(ETHEREUM);
    expectFailure(
      () =>
        new DormantProviderPositionChainAnchorEvidenceProducer(
          frozen({ ...valid, fingerprintSha256: 'f'.repeat(64) }),
          frozen([]),
          clock('2026-09-05T17:00:00.000Z'),
        ),
      'INVALID_CONFIGURATION',
    );
  });

  it('exports no runtime instance, writer, transport, endpoint, timer, or provider SDK', () => {
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION).toBe(1);
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE).toBe(
      'DORMANT_PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_ONLY',
    );
    expect(Object.keys(producerModule).sort()).toEqual([
      'DormantProviderPositionChainAnchorEvidenceProducer',
      'DormantProviderPositionChainAnchorEvidenceUnavailableError',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_CANDIDATE_USE',
      'PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_PAIR_REGISTRY_V1',
      'fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1',
    ]);
    expect(Object.keys(producerModule)).not.toEqual(
      expect.arrayContaining([
        'client',
        'database',
        'endpoint',
        'module',
        'provider',
        'repository',
        'timer',
        'writer',
      ]),
    );
    expect(PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_READ_USE).toContain('READ_ONLY');
  });
});
