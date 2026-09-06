import { parseAccountId } from '../../accounts/domain/account-profile';
import type { MainnetProviderPositionChainAssessmentVerificationContextV1 } from '../domain/mainnet-provider-position-chain-assessment';
import {
  mainnetProviderPositionObservationFingerprintV1,
  type MainnetProviderPositionObservationV1,
} from '../domain/mainnet-provider-position-observation';
import {
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
  type ProviderPositionDurableChainAnchorReaderPort,
  type ReadProviderPositionDurableChainAnchorRequestV1,
} from '../application/ports/provider-position-durable-chain-anchor-reader.port';
import type { AssembleProviderPositionTrustedChainAssessmentRequestV1 } from '../application/ports/provider-position-trusted-chain-assessment-assembly.port';
import type {
  ProviderPositionAdmissionAssemblyCandidateV1,
  ProviderPositionAdmissionTargetCandidateV1,
} from '../application/provider-position-admission.coordinator';
import {
  DormantProviderPositionTrustedChainAssessmentAssembler,
  DormantProviderPositionTrustedChainAssessmentUnavailableError,
} from './dormant-provider-position-trusted-chain-assessment.assembler';

const ACCOUNT_ID = parseAccountId('99999999-9999-4999-8999-999999999999');
const CORRELATION_ID = 'durable-anchor-assembly-test';
const CANDIDATE_FINGERPRINT = 'a'.repeat(64);
const COVERAGE_FINGERPRINT = 'b'.repeat(64);
const REGISTRY_FINGERPRINT = 'c'.repeat(64);
const POLICY_FINGERPRINT = 'd'.repeat(64);
const OBSERVED_AT = '2026-09-05T16:59:50.000Z';
const CAPTURED_AT = '2026-09-05T17:00:00.000Z';
const EVALUATED_AT = CAPTURED_AT;
const DEADLINE_AT = '2026-09-05T17:00:05.000Z';
const STALE_AFTER = '2026-09-05T17:00:20.000Z';
const EVM_ANCHOR = Object.freeze({
  kind: 'EVM_BLOCK' as const,
  blockNumber: '100',
  blockHash: `0x${'1'.repeat(64)}`,
});
const EVM_FLOOR = Object.freeze({
  kind: 'EVM_BLOCK' as const,
  blockNumber: '99',
  blockHash: `0x${'2'.repeat(64)}`,
});
const SOLANA_ANCHOR = Object.freeze({ kind: 'SOLANA_SLOT' as const, slot: '200', root: '199' });
const SOLANA_FLOOR = Object.freeze({ kind: 'SOLANA_SLOT' as const, slot: '199', root: '198' });

interface Fixture {
  readonly request: AssembleProviderPositionTrustedChainAssessmentRequestV1;
  readonly observation: MainnetProviderPositionObservationV1;
  readonly targets: readonly ProviderPositionAdmissionTargetCandidateV1[];
  readonly selections: AssembleProviderPositionTrustedChainAssessmentRequestV1['selectedTargetSources'];
}

function fixture(): Fixture {
  const asset = Object.freeze({
    stablecoin: 'USDC' as const,
    networkId: 'eip155:1',
    identity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
  });
  const balance = Object.freeze({ atomic: '1000000', decimal: '1.000000' });
  const position = Object.freeze({
    positionId: 'aave-usdc-supply',
    positionKind: 'SUPPLY' as const,
    asset,
    balance,
  });
  const evmSource = Object.freeze({
    sourceFamilyId: 'ethereum-durable-operator',
    sourceId: 'ethereum-rpc',
    sourceKind: 'RPC' as const,
    sourceObservationId: 'ethereum-block-100',
    observedAt: OBSERVED_AT,
    staleAfter: STALE_AFTER,
    continuityFloor: EVM_FLOOR,
    chainAnchor: EVM_ANCHOR,
    positionSetFingerprintSha256: 'e'.repeat(64),
  });
  const solanaSource = Object.freeze({
    sourceFamilyId: 'solana-durable-operator',
    sourceId: 'solana-rpc',
    sourceKind: 'RPC' as const,
    sourceObservationId: 'solana-slot-200',
    observedAt: OBSERVED_AT,
    staleAfter: STALE_AFTER,
    continuityFloor: SOLANA_FLOOR,
    chainAnchor: SOLANA_ANCHOR,
    positionSetFingerprintSha256: 'f'.repeat(64),
  });
  const evmTarget = Object.freeze({
    targetId: 'ethereum-aave-target',
    walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
    networkId: 'eip155:1',
    assets: Object.freeze([asset]),
    status: 'COMPLETE' as const,
    divergenceStatus: 'AGREED' as const,
    observedAt: OBSERVED_AT,
    staleAfter: STALE_AFTER,
    positions: Object.freeze([position]),
    acceptedSources: Object.freeze([evmSource]),
  });
  const solanaTarget = Object.freeze({
    targetId: 'solana-kamino-zero-target',
    walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    providerId: 'kamino',
    protocolId: 'kamino-lend',
    marketId: 'kamino-main-market',
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    assets: Object.freeze([]),
    status: 'COMPLETE' as const,
    divergenceStatus: 'AGREED' as const,
    observedAt: OBSERVED_AT,
    staleAfter: STALE_AFTER,
    positions: Object.freeze([]),
    acceptedSources: Object.freeze([solanaSource]),
  });
  const targets = Object.freeze([evmTarget, solanaTarget]);
  const coverageManifest = Object.freeze({
    coverageVersion: 1,
    use: 'MAINNET_PROVIDER_POSITION_COVERAGE_ONLY',
    mayAuthorizeFinancialAction: false,
    manifestId: '11111111-1111-4111-8111-111111111111',
    accountId: ACCOUNT_ID,
    positionSnapshotId: 'provider-position-durable-test',
    observationPolicyVersion: 1,
    observationPolicyId: 'durable-test-policy-v1',
    observationPolicyFingerprintSha256: POLICY_FINGERPRINT,
    assetRegistryVersion: 1,
    assetRegistryFingerprintSha256: REGISTRY_FINGERPRINT,
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    targets: Object.freeze([
      Object.freeze({
        walletId: evmTarget.walletId,
        providerId: evmTarget.providerId,
        protocolId: evmTarget.protocolId,
        marketId: evmTarget.marketId,
        networkId: evmTarget.networkId,
        assets: Object.freeze([
          Object.freeze({ stablecoin: asset.stablecoin, identity: asset.identity }),
        ]),
        sourceIds: Object.freeze([evmSource.sourceId]),
        status: evmTarget.status,
        divergenceStatus: evmTarget.divergenceStatus,
        positionCount: 1,
        observedAt: OBSERVED_AT,
        staleAfter: STALE_AFTER,
      }),
      Object.freeze({
        walletId: solanaTarget.walletId,
        providerId: solanaTarget.providerId,
        protocolId: solanaTarget.protocolId,
        marketId: solanaTarget.marketId,
        networkId: solanaTarget.networkId,
        assets: Object.freeze([]),
        sourceIds: Object.freeze([solanaSource.sourceId]),
        status: solanaTarget.status,
        divergenceStatus: solanaTarget.divergenceStatus,
        positionCount: 0,
        observedAt: OBSERVED_AT,
        staleAfter: STALE_AFTER,
      }),
    ]),
    fingerprintSha256: COVERAGE_FINGERPRINT,
  });
  const candidate = Object.freeze({
    admissionVersion: 1,
    use: 'DORMANT_PROVIDER_POSITION_ASSEMBLY_CANDIDATE_ONLY',
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    assemblyStatus: 'BLOCKED_PENDING_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY',
    accountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
    positionSnapshotId: 'provider-position-durable-test',
    observationPolicyVersion: 1,
    observationPolicyId: 'durable-test-policy-v1',
    observationPolicyFingerprintSha256: POLICY_FINGERPRINT,
    assetRegistryVersion: 1,
    assetRegistryFingerprintSha256: REGISTRY_FINGERPRINT,
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    targets,
    coverageManifest,
    candidateFingerprintSha256: CANDIDATE_FINGERPRINT,
  }) as ProviderPositionAdmissionAssemblyCandidateV1;
  const observation = Object.freeze({
    observationId: '22222222-2222-4222-8222-222222222222',
    walletId: evmTarget.walletId,
    providerId: evmTarget.providerId,
    protocolId: evmTarget.protocolId,
    marketId: evmTarget.marketId,
    positionId: position.positionId,
    positionKind: position.positionKind,
    asset,
    balance,
    source: Object.freeze({
      sourceId: evmSource.sourceId,
      sourceKind: evmSource.sourceKind,
      sourceObservationId: evmSource.sourceObservationId,
      chainAnchor: evmSource.chainAnchor,
    }),
    observedAt: OBSERVED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT' as const,
  });
  const positionSnapshot = Object.freeze({
    schemaVersion: 1 as const,
    use: 'MAINNET_PROVIDER_POSITION_OBSERVATION_ONLY' as const,
    mayAuthorizeFinancialAction: false as const,
    snapshotId: candidate.positionSnapshotId,
    observationPolicyVersion: 1 as const,
    observationPolicyId: candidate.observationPolicyId,
    observationPolicyFingerprintSha256: candidate.observationPolicyFingerprintSha256,
    assetRegistryVersion: candidate.assetRegistryVersion,
    assetRegistryFingerprintSha256: candidate.assetRegistryFingerprintSha256,
    capturedAt: CAPTURED_AT,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT' as const,
    observations: Object.freeze([observation]),
  });
  const selections = Object.freeze([
    Object.freeze({
      targetId: evmTarget.targetId,
      walletId: evmTarget.walletId,
      providerId: evmTarget.providerId,
      protocolId: evmTarget.protocolId,
      marketId: evmTarget.marketId,
      networkId: evmTarget.networkId,
      source: evmSource,
    }),
    Object.freeze({
      targetId: solanaTarget.targetId,
      walletId: solanaTarget.walletId,
      providerId: solanaTarget.providerId,
      protocolId: solanaTarget.protocolId,
      marketId: solanaTarget.marketId,
      networkId: solanaTarget.networkId,
      source: solanaSource,
    }),
  ]);
  const request = Object.freeze({
    assemblyVersion: 1 as const,
    use: 'DORMANT_PROVIDER_POSITION_CHAIN_ASSESSMENT_ASSEMBLY_ONLY' as const,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    accountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
    candidateFingerprintSha256: CANDIDATE_FINGERPRINT,
    coverageManifestFingerprintSha256: COVERAGE_FINGERPRINT,
    evaluatedAt: EVALUATED_AT,
    deadlineAt: DEADLINE_AT,
    signal: new AbortController().signal,
    admissionCandidate: candidate,
    positionSnapshot,
    selectedTargetSources: selections,
  });
  return Object.freeze({ request, observation, targets, selections });
}

class FakeDurableAnchorReader implements ProviderPositionDurableChainAnchorReaderPort {
  readonly readerVersion = PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION;
  readonly calls: ReadProviderPositionDurableChainAnchorRequestV1[] = [];
  readonly verificationCalls: Readonly<{ capability: unknown; request: unknown }>[] = [];
  readonly issued = new WeakMap<object, ReadProviderPositionDurableChainAnchorRequestV1>();
  active = 0;
  maximumActive = 0;
  resultMutation: ((result: Record<string, unknown>) => void) | undefined;
  resultOverride: unknown;

  async readAnchor(request: ReadProviderPositionDurableChainAnchorRequestV1): Promise<unknown> {
    this.calls.push(request);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      await Promise.resolve();
      if (this.resultOverride !== undefined) {
        if (typeof this.resultOverride === 'object' && this.resultOverride !== null) {
          this.issued.set(this.resultOverride, request);
        }
        return this.resultOverride;
      }
      const result: Record<string, unknown> = {
        readerVersion: 1,
        use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        networkId: request.networkId,
        continuityFloor: request.continuityFloor,
        chainAnchor: request.chainAnchor,
        assessedAt: request.capturedAt,
        identityStatus: 'VERIFIED',
        progressionStatus: 'CURRENT',
        finalityStatus: 'HEALTHY',
      };
      this.resultMutation?.(result);
      const capability = Object.freeze(result);
      this.issued.set(capability, request);
      return capability;
    } finally {
      this.active -= 1;
    }
  }

  verifyAnchor(
    capability: unknown,
    request: ReadProviderPositionDurableChainAnchorRequestV1,
  ): boolean {
    this.verificationCalls.push(Object.freeze({ capability, request }));
    return (
      typeof capability === 'object' &&
      capability !== null &&
      this.issued.get(capability) === request
    );
  }
}

function expectedContext(
  fixtureValue: Fixture,
  capability: Readonly<Record<string, unknown>>,
): MainnetProviderPositionChainAssessmentVerificationContextV1 {
  const observation = fixtureValue.observation;
  const assessmentId = capability.assessmentId as string;
  const observationFingerprintSha256 = mainnetProviderPositionObservationFingerprintV1({
    snapshotId: fixtureValue.request.positionSnapshot.snapshotId,
    observationPolicyFingerprintSha256: POLICY_FINGERPRINT,
    assetRegistryVersion: 1,
    assetRegistryFingerprintSha256: REGISTRY_FINGERPRINT,
    observationId: observation.observationId,
    walletId: observation.walletId,
    providerId: observation.providerId,
    protocolId: observation.protocolId,
    marketId: observation.marketId,
    positionId: observation.positionId,
    positionKind: observation.positionKind,
    asset: observation.asset,
    balance: observation.balance,
    source: observation.source,
    observedAt: observation.observedAt,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    capturedAt: CAPTURED_AT,
  });
  return Object.freeze({
    positionSchemaVersion: 1,
    snapshotId: fixtureValue.request.positionSnapshot.snapshotId,
    assessmentVersion: 1,
    assessmentId,
    observationPolicyFingerprintSha256: POLICY_FINGERPRINT,
    assetRegistryVersion: 1,
    assetRegistryFingerprintSha256: REGISTRY_FINGERPRINT,
    observationId: observation.observationId,
    observationFingerprintSha256,
    walletId: observation.walletId,
    providerId: observation.providerId,
    protocolId: observation.protocolId,
    marketId: observation.marketId,
    positionId: observation.positionId,
    positionKind: observation.positionKind,
    stablecoin: observation.asset.stablecoin,
    assetIdentity: observation.asset.identity,
    assetDecimals: observation.asset.decimals,
    balanceAtomic: observation.balance.atomic,
    balanceDecimal: observation.balance.decimal,
    sourceId: observation.source.sourceId,
    sourceKind: observation.source.sourceKind,
    sourceObservationId: observation.source.sourceObservationId,
    networkId: observation.asset.networkId,
    observationTier: 'PROVISIONAL',
    selector: 'latest',
    authority: 'DISPLAY_ONLY',
    chainAnchor: observation.source.chainAnchor,
    observedAt: observation.observedAt,
    staleAfter: STALE_AFTER,
    freshnessClass: 'CURRENT',
    assessedAt: CAPTURED_AT,
    capturedAt: CAPTURED_AT,
    evaluatedAt: EVALUATED_AT,
    identityStatus: 'VERIFIED',
    progressionStatus: 'CURRENT',
    finalityStatus: 'HEALTHY',
    mayAuthorizeFinancialAction: false,
  });
}

async function expectUnavailable(
  assembler: DormantProviderPositionTrustedChainAssessmentAssembler,
  request: AssembleProviderPositionTrustedChainAssessmentRequestV1,
): Promise<void> {
  await expect(assembler.assemble(request)).rejects.toEqual(
    expect.objectContaining({
      name: 'DormantProviderPositionTrustedChainAssessmentUnavailableError',
      code: 'DORMANT_PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_UNAVAILABLE',
      message: 'Provider-position trusted chain assessment is unavailable.',
    }),
  );
}

describe('DormantProviderPositionTrustedChainAssessmentAssembler', () => {
  it('sequentially verifies Ethereum and zero-position Solana anchors and seals exact contexts', async () => {
    const value = fixture();
    const reader = new FakeDurableAnchorReader();
    const assembler = new DormantProviderPositionTrustedChainAssessmentAssembler(reader);

    const capability = (await assembler.assemble(value.request)) as Readonly<
      Record<string, unknown>
    >;

    expect(reader.calls.map(({ networkId }) => networkId)).toEqual([
      'eip155:1',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    ]);
    expect(reader.maximumActive).toBe(1);
    expect(reader.calls[1]?.targetId).toBe('solana-kamino-zero-target');
    expect(reader.calls.every((request) => Object.isFrozen(request))).toBe(true);
    expect(reader.calls.every((request) => Object.getPrototypeOf(request) === null)).toBe(true);
    expect(reader.calls.every((request) => request.signal === value.request.signal)).toBe(true);
    expect(reader.calls.every((request) => request.capturedAt === CAPTURED_AT)).toBe(true);
    expect(capability).toMatchObject({
      assessmentVersion: 1,
      use: 'MAINNET_PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT',
      mayAuthorizeFinancialAction: false,
      entries: [
        expect.objectContaining({
          observationId: value.observation.observationId,
          identityStatus: 'VERIFIED',
          progressionStatus: 'CURRENT',
          finalityStatus: 'HEALTHY',
        }),
      ],
    });
    expect(Object.isFrozen(capability)).toBe(true);
    expect(assembler.verifyAssembly(capability, value.request)).toBe(true);
    expect(assembler.verifyAssembly(structuredClone(capability), value.request)).toBe(false);
    expect(assembler.verifyAssembly(capability, { ...value.request })).toBe(false);
    const context = expectedContext(value, capability);
    expect(assembler.verify(capability, context)).toBe(true);
    expect(assembler.verify(capability, Object.freeze({ ...context, balanceAtomic: '2' }))).toBe(
      false,
    );
    expect(assembler.verify(structuredClone(capability), context)).toBe(false);
    expect(reader.verificationCalls).toHaveLength(8);
  });

  it('captures reader methods once and rejects first-call-learning verification', async () => {
    const value = fixture();
    const reader = new FakeDurableAnchorReader();
    const assembler = new DormantProviderPositionTrustedChainAssessmentAssembler(reader);
    const replacement = jest.fn().mockRejectedValue(new Error('replacement invoked'));
    const verifyReplacement = jest.fn(() => false);
    Object.defineProperty(reader, 'readAnchor', { configurable: true, value: replacement });
    Object.defineProperty(reader, 'verifyAnchor', {
      configurable: true,
      value: verifyReplacement,
    });
    await expect(assembler.assemble(value.request)).resolves.toBeDefined();
    expect(replacement).not.toHaveBeenCalled();
    expect(verifyReplacement).not.toHaveBeenCalled();
    expect(reader.calls).toHaveLength(2);

    const learningReader = Object.freeze({
      readerVersion: 1 as const,
      readAnchor: jest.fn(),
      verifyAnchor: jest.fn(() => true),
    });
    await expectUnavailable(
      new DormantProviderPositionTrustedChainAssessmentAssembler(learningReader),
      value.request,
    );
    expect(learningReader.readAnchor).not.toHaveBeenCalled();
  });

  it('authenticates a result before inspecting it and never invokes proxy traps', async () => {
    const value = fixture();
    let traps = 0;
    const target = Object.freeze({});
    const hostile = new Proxy(target, {
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error('descriptor trap');
      },
      getPrototypeOf: () => {
        traps += 1;
        throw new Error('prototype trap');
      },
      ownKeys: () => {
        traps += 1;
        throw new Error('keys trap');
      },
    });
    const reader = new FakeDurableAnchorReader();
    reader.resultOverride = hostile;
    reader.verifyAnchor = jest.fn(() => false);

    await expectUnavailable(
      new DormantProviderPositionTrustedChainAssessmentAssembler(reader),
      value.request,
    );

    expect(reader.calls).toHaveLength(1);
    expect(
      jest
        .mocked(reader.verifyAnchor)
        .mock.calls.some(
          ([capability, request]) => capability === hostile && request === reader.calls[0],
        ),
    ).toBe(true);
    expect(traps).toBe(0);
  });

  it('fails closed for aborts, expired work, target-set drift, and invalid durable claims', async () => {
    const aborted = fixture();
    const controller = new AbortController();
    controller.abort();
    const abortedRequest = Object.freeze({ ...aborted.request, signal: controller.signal });
    const abortedReader = new FakeDurableAnchorReader();
    await expectUnavailable(
      new DormantProviderPositionTrustedChainAssessmentAssembler(abortedReader),
      abortedRequest,
    );
    expect(abortedReader.calls).toHaveLength(0);

    const expired = fixture();
    const expiredRequest = Object.freeze({ ...expired.request, deadlineAt: EVALUATED_AT });
    await expectUnavailable(
      new DormantProviderPositionTrustedChainAssessmentAssembler(new FakeDurableAnchorReader()),
      expiredRequest,
    );

    const missing = fixture();
    const missingRequest = Object.freeze({
      ...missing.request,
      selectedTargetSources: Object.freeze([missing.selections[0]!]),
    });
    await expectUnavailable(
      new DormantProviderPositionTrustedChainAssessmentAssembler(new FakeDurableAnchorReader()),
      missingRequest,
    );
    const duplicateRequest = Object.freeze({
      ...missing.request,
      selectedTargetSources: Object.freeze([missing.selections[0]!, missing.selections[0]!]),
    });
    await expectUnavailable(
      new DormantProviderPositionTrustedChainAssessmentAssembler(new FakeDurableAnchorReader()),
      duplicateRequest,
    );

    for (const mutate of [
      (result: Record<string, unknown>) => (result.chainAnchor = EVM_FLOOR),
      (result: Record<string, unknown>) => (result.identityStatus = 'FAILED'),
      (result: Record<string, unknown>) => (result.assessedAt = DEADLINE_AT),
    ]) {
      const invalid = fixture();
      const reader = new FakeDurableAnchorReader();
      reader.resultMutation = mutate;
      await expectUnavailable(
        new DormantProviderPositionTrustedChainAssessmentAssembler(reader),
        invalid.request,
      );
    }
  });

  it('rejects reader accessors and proxy prototypes without invoking traps', () => {
    let traps = 0;
    const accessor = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperty(accessor, 'readerVersion', { enumerable: true, value: 1 });
    Object.defineProperty(accessor, 'readAnchor', {
      enumerable: true,
      get: () => {
        traps += 1;
        return jest.fn();
      },
    });
    Object.defineProperty(accessor, 'verifyAnchor', { enumerable: true, value: jest.fn() });
    expect(
      () =>
        new DormantProviderPositionTrustedChainAssessmentAssembler(
          accessor as unknown as ProviderPositionDurableChainAnchorReaderPort,
        ),
    ).toThrow(DormantProviderPositionTrustedChainAssessmentUnavailableError);

    const prototype = new Proxy(Object.create(null) as object, {
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error('prototype descriptor trap');
      },
      getPrototypeOf: () => {
        traps += 1;
        throw new Error('prototype trap');
      },
    });
    expect(
      () =>
        new DormantProviderPositionTrustedChainAssessmentAssembler(
          Object.create(prototype) as ProviderPositionDurableChainAnchorReaderPort,
        ),
    ).toThrow(DormantProviderPositionTrustedChainAssessmentUnavailableError);
    expect(traps).toBe(0);
  });
});
