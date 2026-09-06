import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import type {
  ActivePortfolioWalletRegistration,
  PortfolioWalletRegistrationReader,
  ReadActivePortfolioWalletRegistrationsRequest,
} from '../../portfolio/application/ports/portfolio-wallet-registration-reader.port';
import {
  MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE,
  MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
  type MainnetProviderPositionChainAssessmentVerificationContextV1,
} from '../domain/mainnet-provider-position-chain-assessment';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
  mainnetProviderPositionObservationPolicyFingerprintV1,
} from '../domain/mainnet-provider-position-observation-policy';
import {
  PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION,
  type AssembleProviderPositionTrustedChainAssessmentRequestV1,
  type ProviderPositionTrustedChainAssessmentAssemblyPort,
} from './ports/provider-position-trusted-chain-assessment-assembly.port';
import {
  DormantProviderPositionAdmissionCoordinator,
  PROVIDER_POSITION_ADMISSION_SOURCE_USE,
  PROVIDER_POSITION_ADMISSION_VERSION,
  type ProviderPositionAdmissionClock,
  type ProviderPositionAdmissionDeadlineRunRequestV1,
  type ProviderPositionAdmissionDeadlineRunner,
  type ProviderPositionAdmissionSourceBinding,
  type ProviderPositionAdmissionSourcePort,
  ProviderPositionAdmissionUnavailableError,
  type ReadProviderPositionAdmissionTargetRequestV1,
} from './provider-position-admission.coordinator';

const REGISTRY = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
const ACCOUNT_ID = parseAccountId('99999999-9999-4999-8999-999999999999');
const OTHER_ACCOUNT_ID = parseAccountId('88888888-8888-4888-8888-888888888888');
const WALLET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_WALLET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NETWORK_ID = 'eip155:1';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const SOLANA_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BLOCK_HASH = `0x${'1'.repeat(64)}`;
const PRIOR_BLOCK_HASH = `0x${'2'.repeat(64)}`;
const NOW = new Date('2026-09-04T17:00:00.000Z');
const OBSERVED_AT = '2026-09-04T16:59:50.000Z';
const STALE_AFTER = '2026-09-04T17:00:40.000Z';
const CORRELATION_ID = 'position-read-20260904';

type MutableRecord = Record<string, unknown>;

interface Fixture {
  policy: Record<string, unknown>;
  bindings: ProviderPositionAdmissionSourceBinding[];
  sources: FakeSource[];
  walletReader: FakeWalletReader;
  clock: ProviderPositionAdmissionClock;
  runner: FakeDeadlineRunner;
}

class FakeWalletReader implements PortfolioWalletRegistrationReader {
  readonly calls: ReadActivePortfolioWalletRegistrationsRequest[] = [];
  response: unknown = [{ walletId: WALLET_ID, networkId: NETWORK_ID }];
  error: Error | undefined;

  async readActiveWalletRegistrations(
    request: ReadActivePortfolioWalletRegistrationsRequest,
  ): Promise<readonly ActivePortfolioWalletRegistration[]> {
    this.calls.push(request);
    if (this.error) throw this.error;
    return this.response as readonly ActivePortfolioWalletRegistration[];
  }
}

class FakeSource implements ProviderPositionAdmissionSourcePort {
  readonly calls: ReadProviderPositionAdmissionTargetRequestV1[] = [];
  readonly signalAbortedWhenCalled: boolean[] = [];
  error: Error | undefined;
  mutate: ((value: MutableRecord) => void) | undefined;
  readOverride:
    | ((request: ReadProviderPositionAdmissionTargetRequestV1) => Promise<unknown>)
    | undefined;
  positions: MutableRecord[] = [position()];

  constructor(
    readonly sourceFamilyId: string,
    readonly sourceId: string,
    readonly sourceKind: 'RPC' | 'INDEXER',
    readonly networkId = NETWORK_ID,
  ) {}

  async readTarget(request: ReadProviderPositionAdmissionTargetRequestV1): Promise<unknown> {
    this.calls.push(request);
    this.signalAbortedWhenCalled.push(request.signal.aborted);
    if (this.error) throw this.error;
    if (this.readOverride) return this.readOverride(request);
    const value = sourceEvidence(this, request, this.positions);
    this.mutate?.(value);
    return value;
  }
}

class FakeDeadlineRunner implements ProviderPositionAdmissionDeadlineRunner {
  readonly calls: ProviderPositionAdmissionDeadlineRunRequestV1[] = [];
  active = 0;
  maximumActive = 0;
  errorAtCall: number | undefined;

  async run<T>(
    request: ProviderPositionAdmissionDeadlineRunRequestV1,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.calls.push(request);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      if (this.calls.length === this.errorAtCall) throw new Error('private deadline detail');
      return await operation();
    } finally {
      this.active -= 1;
    }
  }
}

class FakeTrustedChainAssessmentAssembly implements ProviderPositionTrustedChainAssessmentAssemblyPort {
  readonly assemblyVersion = PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION;
  readonly calls: AssembleProviderPositionTrustedChainAssessmentRequestV1[] = [];
  readonly assemblyVerificationCalls: AssembleProviderPositionTrustedChainAssessmentRequestV1[] =
    [];
  readonly verificationCalls: MainnetProviderPositionChainAssessmentVerificationContextV1[] = [];
  readonly issued = new WeakMap<
    object,
    Readonly<{
      request: AssembleProviderPositionTrustedChainAssessmentRequestV1;
      assessmentId: string;
    }>
  >();
  error: Error | undefined;
  returnClone = false;
  verifyAssemblyResult = true;
  verifyResult = true;
  verifyAssemblyError: Error | undefined;
  verifyError: Error | undefined;
  mutate: ((assessment: MutableRecord) => void) | undefined;
  onRequest:
    ((request: AssembleProviderPositionTrustedChainAssessmentRequestV1) => void) | undefined;

  async assemble(
    request: AssembleProviderPositionTrustedChainAssessmentRequestV1,
  ): Promise<unknown> {
    this.calls.push(request);
    this.onRequest?.(request);
    if (this.error) throw this.error;
    if (
      request.selectedTargetSources.length !== request.admissionCandidate.targets.length ||
      request.selectedTargetSources.some((selection) => {
        const target = request.admissionCandidate.targets.find(
          ({ targetId }) => targetId === selection.targetId,
        );
        return (
          target === undefined ||
          selection.source !== target.acceptedSources[0] ||
          selection.walletId !== target.walletId ||
          selection.providerId !== target.providerId ||
          selection.protocolId !== target.protocolId ||
          selection.marketId !== target.marketId ||
          selection.networkId !== target.networkId
        );
      })
    ) {
      throw new Error('invalid target source selection');
    }
    const assessmentId = `trusted-assessment-${this.calls.length}`;
    const assessment: MutableRecord = {
      assessmentVersion: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION,
      use: MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_USE,
      mayAuthorizeFinancialAction: false,
      assessmentId,
      observationPolicyFingerprintSha256:
        request.positionSnapshot.observationPolicyFingerprintSha256,
      assetRegistryVersion: request.positionSnapshot.assetRegistryVersion,
      assetRegistryFingerprintSha256: request.positionSnapshot.assetRegistryFingerprintSha256,
      entries: request.positionSnapshot.observations.map((observation) => ({
        observationId: observation.observationId,
        sourceId: observation.source.sourceId,
        sourceKind: observation.source.sourceKind,
        sourceObservationId: observation.source.sourceObservationId,
        networkId: observation.asset.networkId,
        chainAnchor: observation.source.chainAnchor,
        assessedAt: request.positionSnapshot.capturedAt,
        identityStatus: 'VERIFIED',
        progressionStatus: 'CURRENT',
        finalityStatus: 'HEALTHY',
      })),
    };
    this.mutate?.(assessment);
    const entries = assessment.entries;
    if (Array.isArray(entries)) {
      assessment.entries = Object.freeze(
        entries.map((entry) =>
          typeof entry === 'object' && entry !== null ? Object.freeze(entry) : entry,
        ),
      );
    }
    const capability = Object.freeze(assessment);
    this.issued.set(capability, Object.freeze({ request, assessmentId }));
    return this.returnClone ? structuredClone(capability) : capability;
  }

  verifyAssembly(
    capability: unknown,
    request: AssembleProviderPositionTrustedChainAssessmentRequestV1,
  ): boolean {
    this.assemblyVerificationCalls.push(request);
    if (this.verifyAssemblyError) throw this.verifyAssemblyError;
    return (
      this.verifyAssemblyResult &&
      typeof capability === 'object' &&
      capability !== null &&
      this.issued.get(capability)?.request === request
    );
  }

  verify(
    capability: unknown,
    context: MainnetProviderPositionChainAssessmentVerificationContextV1,
  ): boolean {
    this.verificationCalls.push(context);
    if (this.verifyError) throw this.verifyError;
    if (!this.verifyResult || typeof capability !== 'object' || capability === null) return false;
    const issued = this.issued.get(capability);
    if (issued === undefined) return false;
    const snapshot = issued.request.positionSnapshot;
    const observation = snapshot.observations.find(
      (candidate) => candidate.observationId === context.observationId,
    );
    if (observation === undefined) return false;
    const expectedSelector = observation.asset.networkId.startsWith('solana:')
      ? 'confirmed'
      : 'latest';
    return (
      context.positionSchemaVersion === snapshot.schemaVersion &&
      context.snapshotId === snapshot.snapshotId &&
      context.assessmentVersion === MAINNET_PROVIDER_POSITION_CHAIN_ASSESSMENT_VERSION &&
      context.assessmentId === issued.assessmentId &&
      context.observationPolicyFingerprintSha256 === snapshot.observationPolicyFingerprintSha256 &&
      context.assetRegistryVersion === snapshot.assetRegistryVersion &&
      context.assetRegistryFingerprintSha256 === snapshot.assetRegistryFingerprintSha256 &&
      /^[0-9a-f]{64}$/u.test(context.observationFingerprintSha256) &&
      context.walletId === observation.walletId &&
      context.providerId === observation.providerId &&
      context.protocolId === observation.protocolId &&
      context.marketId === observation.marketId &&
      context.positionId === observation.positionId &&
      context.positionKind === observation.positionKind &&
      context.stablecoin === observation.asset.stablecoin &&
      context.assetIdentity === observation.asset.identity &&
      context.assetDecimals === observation.asset.decimals &&
      context.balanceAtomic === observation.balance.atomic &&
      context.balanceDecimal === observation.balance.decimal &&
      context.sourceId === observation.source.sourceId &&
      context.sourceKind === observation.source.sourceKind &&
      context.sourceObservationId === observation.source.sourceObservationId &&
      context.networkId === observation.asset.networkId &&
      context.observationTier === 'PROVISIONAL' &&
      context.selector === expectedSelector &&
      context.authority === 'DISPLAY_ONLY' &&
      JSON.stringify(context.chainAnchor) === JSON.stringify(observation.source.chainAnchor) &&
      context.observedAt === observation.observedAt &&
      context.staleAfter === observation.staleAfter &&
      context.freshnessClass === observation.freshnessClass &&
      context.assessedAt === snapshot.capturedAt &&
      context.capturedAt === snapshot.capturedAt &&
      context.evaluatedAt === issued.request.evaluatedAt &&
      context.identityStatus === 'VERIFIED' &&
      context.progressionStatus === 'CURRENT' &&
      context.finalityStatus === 'HEALTHY' &&
      context.mayAuthorizeFinancialAction === false
    );
  }
}

function policyContent(sources = defaultPolicySources()): Record<string, unknown> {
  return {
    policyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
    policyId: 'admission-policy-v1',
    assetRegistryVersion: REGISTRY.version,
    assetRegistryFingerprintSha256: REGISTRY.fingerprintSha256,
    providers: [
      {
        providerId: 'aave',
        protocols: [
          {
            protocolId: 'aave-v3',
            markets: [
              {
                networkId: NETWORK_ID,
                marketId: MARKET,
                assets: [{ stablecoin: 'USDC', identity: USDC }],
              },
            ],
          },
        ],
      },
    ],
    sources,
  };
}

function defaultPolicySources(): readonly Record<string, unknown>[] {
  return [
    { sourceId: 'rpc-alpha', sourceKind: 'RPC', networkId: NETWORK_ID },
    { sourceId: 'indexer-beta', sourceKind: 'INDEXER', networkId: NETWORK_ID },
  ];
}

function policy(sources = defaultPolicySources()): Record<string, unknown> {
  const content = policyContent(sources);
  return {
    ...content,
    fingerprintSha256: mainnetProviderPositionObservationPolicyFingerprintV1(content),
  };
}

function position(overrides: Record<string, unknown> = {}): MutableRecord {
  return {
    positionId: 'aave-usdc-supply',
    positionKind: 'SUPPLY',
    asset: {
      stablecoin: 'USDC',
      networkId: NETWORK_ID,
      identity: USDC,
      decimals: 6,
    },
    balance: { atomic: '1234567', decimal: '1.234567' },
    ...overrides,
  };
}

function sourceEvidence(
  source: FakeSource,
  request: ReadProviderPositionAdmissionTargetRequestV1,
  positions: readonly MutableRecord[],
): MutableRecord {
  const solana = request.networkId.startsWith('solana:');
  return {
    evidenceVersion: PROVIDER_POSITION_ADMISSION_VERSION,
    use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
    mayAuthorizeFinancialAction: false,
    accountId: request.accountId,
    correlationId: request.correlationId,
    sourceFamilyId: source.sourceFamilyId,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    sourceObservationId: `${source.sourceId}-observation-100`,
    walletId: request.walletId,
    providerId: request.providerId,
    protocolId: request.protocolId,
    marketId: request.marketId,
    networkId: request.networkId,
    assets: request.assets.map((asset) => ({ ...asset })),
    status: 'COMPLETE',
    observedAt: OBSERVED_AT,
    staleAfter: solana ? '2026-09-04T17:00:05.000Z' : STALE_AFTER,
    continuityFloor: solana
      ? { kind: 'SOLANA_SLOT', slot: '99', root: '98' }
      : { kind: 'EVM_BLOCK', blockNumber: '99', blockHash: PRIOR_BLOCK_HASH },
    chainAnchor: solana
      ? { kind: 'SOLANA_SLOT', slot: '100', root: '99' }
      : { kind: 'EVM_BLOCK', blockNumber: '100', blockHash: BLOCK_HASH },
    positions: positions.map((candidate) => ({
      ...candidate,
      asset: { ...(candidate.asset as MutableRecord) },
      balance: { ...(candidate.balance as MutableRecord) },
    })),
  };
}

function binding(source: FakeSource): ProviderPositionAdmissionSourceBinding {
  return {
    sourceFamilyId: source.sourceFamilyId,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    networkId: source.networkId,
    source,
  };
}

function fixture(): Fixture {
  const first = new FakeSource('family-alpha', 'rpc-alpha', 'RPC');
  const second = new FakeSource('family-beta', 'indexer-beta', 'INDEXER');
  return {
    policy: policy(),
    bindings: [binding(first), binding(second)],
    sources: [first, second],
    walletReader: new FakeWalletReader(),
    clock: { now: () => new Date(NOW) },
    runner: new FakeDeadlineRunner(),
  };
}

function solanaFixture(): Fixture {
  const content = {
    policyVersion: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
    use: MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
    policyId: 'solana-admission-policy-v1',
    assetRegistryVersion: REGISTRY.version,
    assetRegistryFingerprintSha256: REGISTRY.fingerprintSha256,
    providers: [
      {
        providerId: 'jupiter',
        protocols: [
          {
            protocolId: 'jupiter-lend',
            markets: [
              {
                networkId: SOLANA_NETWORK,
                marketId: 'JupiterUsdcEarnVault',
                assets: [{ stablecoin: 'USDC', identity: SOLANA_USDC }],
              },
            ],
          },
        ],
      },
    ],
    sources: [
      { sourceId: 'solana-rpc', sourceKind: 'RPC', networkId: SOLANA_NETWORK },
      { sourceId: 'solana-indexer', sourceKind: 'INDEXER', networkId: SOLANA_NETWORK },
    ],
  };
  const first = new FakeSource('solana-family-alpha', 'solana-rpc', 'RPC', SOLANA_NETWORK);
  const second = new FakeSource('solana-family-beta', 'solana-indexer', 'INDEXER', SOLANA_NETWORK);
  const solanaPosition = position({
    positionId: 'jupiter-usdc-supply',
    asset: {
      stablecoin: 'USDC',
      networkId: SOLANA_NETWORK,
      identity: SOLANA_USDC,
      decimals: 6,
    },
  });
  first.positions = [solanaPosition];
  second.positions = [solanaPosition];
  const walletReader = new FakeWalletReader();
  walletReader.response = [{ walletId: WALLET_ID, networkId: SOLANA_NETWORK }];
  return {
    policy: {
      ...content,
      fingerprintSha256: mainnetProviderPositionObservationPolicyFingerprintV1(content),
    },
    bindings: [binding(first), binding(second)],
    sources: [first, second],
    walletReader,
    clock: { now: () => new Date(NOW) },
    runner: new FakeDeadlineRunner(),
  };
}

function mixedPositionTargetFixture(): Fixture {
  const value = fixture();
  const content = policyContent();
  const providers = content.providers as MutableRecord[];
  providers.push({
    providerId: 'compound',
    protocols: [
      {
        protocolId: 'compound-iii',
        markets: [
          {
            networkId: NETWORK_ID,
            marketId: 'compound-iii-ethereum-usdc',
            assets: [{ stablecoin: 'USDC', identity: USDC }],
          },
        ],
      },
    ],
  });
  value.policy = {
    ...content,
    fingerprintSha256: mainnetProviderPositionObservationPolicyFingerprintV1(content),
  };
  value.sources.forEach((source) => {
    source.mutate = (response) => {
      if (response.providerId === 'compound') response.positions = [];
    };
  });
  return value;
}

function coordinator(
  value: Fixture,
  overrides: Partial<{ deadlineMilliseconds: number; maximumConcurrency: number }> = {},
  assembly?: ProviderPositionTrustedChainAssessmentAssemblyPort,
): DormantProviderPositionAdmissionCoordinator {
  return new DormantProviderPositionAdmissionCoordinator(
    value.policy,
    value.policy.fingerprintSha256 as string,
    value.bindings,
    value.walletReader,
    value.clock,
    value.runner,
    { deadlineMilliseconds: 5_000, maximumConcurrency: 2, ...overrides },
    assembly,
  );
}

async function expectUnavailable(
  value: Fixture,
  code: ProviderPositionAdmissionUnavailableError['code'],
): Promise<void> {
  await expect(
    coordinator(value).admit({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID }),
  ).rejects.toEqual(
    expect.objectContaining({
      name: 'ProviderPositionAdmissionUnavailableError',
      message: 'Provider-position admission is unavailable.',
      code,
    }),
  );
}

async function expectAssemblyUnavailable(
  value: Fixture,
  assembly?: ProviderPositionTrustedChainAssessmentAssemblyPort,
): Promise<void> {
  await expect(
    coordinator(value, {}, assembly).admitAndAssemble({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    }),
  ).rejects.toEqual(
    expect.objectContaining({
      name: 'ProviderPositionAdmissionUnavailableError',
      message: 'Provider-position admission is unavailable.',
      code: 'ASSEMBLY_UNAVAILABLE',
    }),
  );
}

function nested(record: MutableRecord, key: string): MutableRecord {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('fixture nested record');
  }
  return value as MutableRecord;
}

describe('DormantProviderPositionAdmissionCoordinator', () => {
  it('admits exact independently agreeing evidence into a valid coverage-bound candidate', async () => {
    const value = fixture();
    const result = await coordinator(value).admit({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });

    expect(result).toEqual(
      expect.objectContaining({
        admissionVersion: 1,
        use: 'DORMANT_PROVIDER_POSITION_ASSEMBLY_CANDIDATE_ONLY',
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        mayCreatePositionSnapshot: false,
        assemblyStatus: 'BLOCKED_PENDING_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY',
        accountId: ACCOUNT_ID,
        correlationId: CORRELATION_ID,
        observationPolicyFingerprintSha256: value.policy.fingerprintSha256,
        freshnessClass: 'CURRENT',
      }),
    );
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toEqual(
      expect.objectContaining({
        walletId: WALLET_ID,
        providerId: 'aave',
        protocolId: 'aave-v3',
        marketId: MARKET,
        networkId: NETWORK_ID,
        status: 'COMPLETE',
        divergenceStatus: 'AGREED',
        observedAt: OBSERVED_AT,
        staleAfter: STALE_AFTER,
      }),
    );
    expect(result.targets[0]?.acceptedSources.map(({ sourceFamilyId }) => sourceFamilyId)).toEqual([
      'family-alpha',
      'family-beta',
    ]);
    expect(result.targets[0]?.positions).toEqual([position()]);
    expect(result.coverageManifest).toEqual(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        positionSnapshotId: result.positionSnapshotId,
        fingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        targets: [
          expect.objectContaining({
            sourceIds: ['indexer-beta', 'rpc-alpha'],
            positionCount: 1,
            status: 'COMPLETE',
            divergenceStatus: 'AGREED',
          }),
        ],
      }),
    );
    expect(result.candidateFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.targets)).toBe(true);
    expect(Object.isFrozen(result.coverageManifest)).toBe(true);
  });

  it('assembles a read-only covered snapshot through one opaque issuer/verifier boundary', async () => {
    const value = fixture();
    const assembly = new FakeTrustedChainAssessmentAssembly();
    const result = await coordinator(value, {}, assembly).admitAndAssemble({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });

    expect(result).toEqual(
      expect.objectContaining({
        assemblyVersion: 1,
        use: 'DORMANT_PROVIDER_POSITION_READ_ONLY_ASSEMBLY_ONLY',
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
      }),
    );
    expect(result.admissionCandidate).toEqual(
      expect.objectContaining({
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        mayCreatePositionSnapshot: false,
        assemblyStatus: 'BLOCKED_PENDING_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY',
      }),
    );
    expect(result.coveredSnapshot).toEqual(
      expect.objectContaining({
        mayAuthorizeFinancialAction: false,
        snapshotId: result.admissionCandidate.positionSnapshotId,
        coverageManifest: result.admissionCandidate.coverageManifest,
      }),
    );
    expect(result.coveredSnapshot.observations).toEqual([
      expect.objectContaining({
        walletId: WALLET_ID,
        providerId: 'aave',
        protocolId: 'aave-v3',
        positionId: 'aave-usdc-supply',
        balance: { atomic: '1234567', decimal: '1.234567' },
        source: expect.objectContaining({
          sourceId: 'rpc-alpha',
          sourceKind: 'RPC',
          sourceObservationId: 'rpc-alpha-observation-100',
          chainAnchor: { kind: 'EVM_BLOCK', blockNumber: '100', blockHash: BLOCK_HASH },
        }),
      }),
    ]);
    expect(assembly.calls).toHaveLength(1);
    expect(assembly.assemblyVerificationCalls).toHaveLength(1);
    expect(assembly.verificationCalls).toHaveLength(1);
    expect(assembly.calls[0]).toEqual(
      expect.objectContaining({
        assemblyVersion: 1,
        use: 'DORMANT_PROVIDER_POSITION_CHAIN_ASSESSMENT_ASSEMBLY_ONLY',
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        accountId: ACCOUNT_ID,
        correlationId: CORRELATION_ID,
        evaluatedAt: NOW.toISOString(),
        deadlineAt: '2026-09-04T17:00:05.000Z',
        candidateFingerprintSha256: result.admissionCandidate.candidateFingerprintSha256,
        coverageManifestFingerprintSha256:
          result.admissionCandidate.coverageManifest.fingerprintSha256,
      }),
    );
    expect(assembly.calls[0]?.admissionCandidate).toBe(result.admissionCandidate);
    expect(assembly.calls[0]?.signal.aborted).toBe(true);
    expect(new Set(value.runner.calls.map(({ signal }) => signal)).size).toBe(1);
    expect(new Set(value.runner.calls.map(({ abortAdmission }) => abortAdmission)).size).toBe(1);
    expect(assembly.calls[0]?.signal).toBe(value.runner.calls[0]?.signal);
    expect(value.runner.calls.at(-1)).toEqual(
      expect.objectContaining({
        sourceFamilyId: 'trusted-chain-assessment-assembly',
        targetId: result.admissionCandidate.positionSnapshotId,
      }),
    );
    expect(Object.keys(result)).not.toEqual(
      expect.arrayContaining(['chainAssessment', 'chainAssessmentVerifier', 'capability']),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.coveredSnapshot)).toBe(true);
  });

  it('requires an injected trusted assembler before performing any admission reads', async () => {
    const value = fixture();
    await expectAssemblyUnavailable(value);
    expect(value.walletReader.calls).toEqual([]);
    expect(value.sources.every((source) => source.calls.length === 0)).toBe(true);
  });

  it('assembles Solana positions with the exact selected slot/root anchor', async () => {
    const value = solanaFixture();
    const assembly = new FakeTrustedChainAssessmentAssembly();
    const result = await coordinator(value, {}, assembly).admitAndAssemble({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });

    expect(result.coveredSnapshot.observations).toEqual([
      expect.objectContaining({
        providerId: 'jupiter',
        source: expect.objectContaining({
          sourceId: 'solana-rpc',
          sourceObservationId: 'solana-rpc-observation-100',
          chainAnchor: { kind: 'SOLANA_SLOT', slot: '100', root: '99' },
        }),
      }),
    ]);
    expect(assembly.verificationCalls[0]?.selector).toBe('confirmed');
  });

  it('requires whole-assembly anchor attestation for independently agreed empty coverage', async () => {
    const value = fixture();
    value.sources.forEach((source) => (source.positions = []));
    const assembly = new FakeTrustedChainAssessmentAssembly();
    const result = await coordinator(value, {}, assembly).admitAndAssemble({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });

    expect(result.coveredSnapshot.observations).toEqual([]);
    expect(result.coveredSnapshot.coverageManifest.targets[0]?.positionCount).toBe(0);
    expect(assembly.calls).toHaveLength(1);
    expect(assembly.calls[0]?.selectedTargetSources).toEqual([
      expect.objectContaining({
        targetId: result.admissionCandidate.targets[0]?.targetId,
        source: expect.objectContaining({
          sourceId: 'rpc-alpha',
          chainAnchor: { kind: 'EVM_BLOCK', blockNumber: '100', blockHash: BLOCK_HASH },
        }),
      }),
    ]);
    expect(assembly.assemblyVerificationCalls).toHaveLength(1);
    expect(assembly.verificationCalls).toEqual([]);
  });

  it('attests selected anchors for mixed zero- and nonzero-position targets', async () => {
    const value = mixedPositionTargetFixture();
    const assembly = new FakeTrustedChainAssessmentAssembly();
    const result = await coordinator(value, {}, assembly).admitAndAssemble({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });

    expect(
      result.admissionCandidate.coverageManifest.targets.map(({ positionCount }) => positionCount),
    ).toEqual([1, 0]);
    expect(result.coveredSnapshot.observations).toHaveLength(1);
    expect(assembly.calls[0]?.selectedTargetSources).toHaveLength(2);
    expect(assembly.assemblyVerificationCalls).toHaveLength(1);
    expect(assembly.verificationCalls).toHaveLength(1);
  });

  it('keeps final source selection and observation identity stable across binding order', async () => {
    const left = fixture();
    left.bindings.reverse();
    const right = fixture();
    const leftAssembly = new FakeTrustedChainAssessmentAssembly();
    const rightAssembly = new FakeTrustedChainAssessmentAssembly();

    const first = await coordinator(left, {}, leftAssembly).admitAndAssemble({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });
    const second = await coordinator(right, {}, rightAssembly).admitAndAssemble({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });

    expect(first.coveredSnapshot.observations[0]?.observationId).toBe(
      second.coveredSnapshot.observations[0]?.observationId,
    );
    expect(first.coveredSnapshot.observations[0]?.source).toEqual(
      second.coveredSnapshot.observations[0]?.source,
    );
    expect(leftAssembly.calls[0]?.selectedTargetSources[0]?.source.sourceFamilyId).toBe(
      'family-alpha',
    );
  });

  it('rejects cloned capabilities and missing, extra, or cross-snapshot assessment entries', async () => {
    const cloned = new FakeTrustedChainAssessmentAssembly();
    cloned.returnClone = true;
    await expectAssemblyUnavailable(fixture(), cloned);

    const missing = new FakeTrustedChainAssessmentAssembly();
    missing.mutate = (assessment) => (assessment.entries = []);
    await expectAssemblyUnavailable(fixture(), missing);

    const extra = new FakeTrustedChainAssessmentAssembly();
    extra.mutate = (assessment) => {
      const entries = assessment.entries as MutableRecord[];
      assessment.entries = [
        ...entries,
        {
          ...entries[0],
          observationId: '77777777-7777-4777-8777-777777777777',
        },
      ];
    };
    await expectAssemblyUnavailable(fixture(), extra);

    const crossSnapshot = new FakeTrustedChainAssessmentAssembly();
    crossSnapshot.mutate = (assessment) => {
      const entries = assessment.entries as MutableRecord[];
      entries[0]!.observationId = '77777777-7777-4777-8777-777777777777';
    };
    await expectAssemblyUnavailable(fixture(), crossSnapshot);
  });

  it('sanitizes trusted assembly and verification failures and aborts the shared operation', async () => {
    const failed = new FakeTrustedChainAssessmentAssembly();
    failed.error = new Error('durable chain store credential');
    await expectAssemblyUnavailable(fixture(), failed);
    expect(failed.calls[0]?.signal.aborted).toBe(true);

    const rejected = new FakeTrustedChainAssessmentAssembly();
    rejected.verifyResult = false;
    await expectAssemblyUnavailable(fixture(), rejected);
    expect(rejected.verificationCalls).toHaveLength(1);

    const wholeVerificationError = new FakeTrustedChainAssessmentAssembly();
    wholeVerificationError.verifyAssemblyError = new Error('private whole-verifier detail');
    await expectAssemblyUnavailable(fixture(), wholeVerificationError);
    expect(wholeVerificationError.assemblyVerificationCalls).toHaveLength(1);

    const observationVerificationError = new FakeTrustedChainAssessmentAssembly();
    observationVerificationError.verifyError = new Error('private observation-verifier detail');
    await expectAssemblyUnavailable(fixture(), observationVerificationError);
    expect(observationVerificationError.verificationCalls).toHaveLength(1);

    const mutation = new FakeTrustedChainAssessmentAssembly();
    mutation.onRequest = (request) => {
      const balance = request.positionSnapshot.observations[0]?.balance as {
        atomic: string;
      };
      balance.atomic = '999';
    };
    await expectAssemblyUnavailable(fixture(), mutation);
    expect(mutation.calls[0]?.signal.aborted).toBe(true);
  });

  it('captures issuer and verifier methods once so assembly-time replacement cannot grant trust', async () => {
    const observationDrift = new FakeTrustedChainAssessmentAssembly();
    observationDrift.verifyResult = false;
    observationDrift.onRequest = () => {
      Object.defineProperty(observationDrift, 'verify', {
        configurable: true,
        value: () => true,
      });
    };
    await expectAssemblyUnavailable(fixture(), observationDrift);
    expect(observationDrift.verificationCalls).toHaveLength(1);

    const wholeDrift = new FakeTrustedChainAssessmentAssembly();
    wholeDrift.verifyAssemblyResult = false;
    wholeDrift.onRequest = () => {
      Object.defineProperty(wholeDrift, 'verifyAssembly', {
        configurable: true,
        value: () => true,
      });
    };
    await expectAssemblyUnavailable(fixture(), wholeDrift);
    expect(wholeDrift.assemblyVerificationCalls).toHaveLength(1);
  });

  it('rejects assembly that completes at the exclusive deadline', async () => {
    const value = fixture();
    const times = [NOW, NOW, NOW, NOW, new Date(NOW.getTime() + 5_000)].map(
      (time) => new Date(time),
    );
    value.clock = { now: () => times.shift() ?? new Date(NOW.getTime() + 5_000) };
    const assembly = new FakeTrustedChainAssessmentAssembly();

    await expectAssemblyUnavailable(value, assembly);
    expect(assembly.calls[0]?.signal.aborted).toBe(true);
  });

  it('rejects assembly that reaches the exclusive deadline during observation verification', async () => {
    const value = fixture();
    const times = [NOW, NOW, NOW, NOW, NOW, new Date(NOW.getTime() + 5_000)].map(
      (time) => new Date(time),
    );
    value.clock = { now: () => times.shift() ?? new Date(NOW.getTime() + 5_000) };
    const assembly = new FakeTrustedChainAssessmentAssembly();

    await expectAssemblyUnavailable(value, assembly);
    expect(assembly.verificationCalls).toHaveLength(1);
    expect(assembly.calls[0]?.signal.aborted).toBe(true);
  });

  it('binds roster and source reads to the exact account, correlation, target, and deadline', async () => {
    const value = fixture();
    await coordinator(value).admit({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID });

    expect(value.walletReader.calls).toEqual([
      { accountId: ACCOUNT_ID, evaluatedAt: NOW.toISOString(), correlationId: CORRELATION_ID },
    ]);
    for (const source of value.sources) {
      expect(source.calls).toEqual([
        expect.objectContaining({
          admissionVersion: 1,
          accountId: ACCOUNT_ID,
          correlationId: CORRELATION_ID,
          deadlineAt: '2026-09-04T17:00:05.000Z',
          sourceFamilyId: source.sourceFamilyId,
          sourceId: source.sourceId,
          sourceKind: source.sourceKind,
          walletId: WALLET_ID,
          providerId: 'aave',
          protocolId: 'aave-v3',
          marketId: MARKET,
          networkId: NETWORK_ID,
        }),
      ]);
    }
    expect(value.runner.calls).toHaveLength(3);
    const sharedSignal = value.runner.calls[0]?.signal;
    const sharedAbortAdmission = value.runner.calls[0]?.abortAdmission;
    expect(new Set(value.runner.calls.map(({ signal }) => signal))).toEqual(
      new Set([sharedSignal]),
    );
    expect(new Set(value.runner.calls.map(({ abortAdmission }) => abortAdmission))).toEqual(
      new Set([sharedAbortAdmission]),
    );
    for (const source of value.sources) {
      expect(source.calls[0]?.signal).toBe(sharedSignal);
      expect(source.signalAbortedWhenCalled).toEqual([false]);
      expect(source.calls[0]?.signal.aborted).toBe(true);
    }
    expect(value.runner.maximumActive).toBeLessThanOrEqual(2);
  });

  it('uses deterministic canonical ordering and fingerprints', async () => {
    const left = fixture();
    left.bindings.reverse();
    left.sources.forEach((source) => {
      source.positions = [
        position({ positionId: 'second', balance: { atomic: '2', decimal: '0.000002' } }),
        position({ positionId: 'first', balance: { atomic: '1', decimal: '0.000001' } }),
      ];
    });
    const right = fixture();
    right.sources.forEach((source) => {
      source.positions = [
        position({ positionId: 'first', balance: { atomic: '1', decimal: '0.000001' } }),
        position({ positionId: 'second', balance: { atomic: '2', decimal: '0.000002' } }),
      ];
    });

    const first = await coordinator(left).admit({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });
    const second = await coordinator(right).admit({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });
    expect(first.targets[0]?.positions.map(({ positionId }) => positionId)).toEqual([
      'first',
      'second',
    ]);
    expect(first.candidateFingerprintSha256).toBe(second.candidateFingerprintSha256);
    expect(first.coverageManifest.fingerprintSha256).toBe(
      second.coverageManifest.fingerprintSha256,
    );
  });

  it('accepts an explicit independently agreed zero-position result without inferring zero', async () => {
    const value = fixture();
    value.sources.forEach((source) => (source.positions = []));

    const result = await coordinator(value).admit({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });
    expect(result.targets[0]?.positions).toEqual([]);
    expect(result.coverageManifest.targets[0]?.positionCount).toBe(0);

    const unavailable = fixture();
    unavailable.sources[1]!.positions = [];
    await expectUnavailable(unavailable, 'DIVERGENT_EVIDENCE');
  });

  it('supports an authoritative empty wallet roster without reading any provider source', async () => {
    const value = fixture();
    value.walletReader.response = [];
    const result = await coordinator(value).admit({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });
    expect(result.targets).toEqual([]);
    expect(result.coverageManifest.targets).toEqual([]);
    expect(value.sources.every((source) => source.calls.length === 0)).toBe(true);
  });

  it('admits Solana targets with monotonic slot/root evidence and rejects root regression', async () => {
    const value = solanaFixture();
    const result = await coordinator(value).admit({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });
    expect(result.targets[0]).toEqual(
      expect.objectContaining({
        providerId: 'jupiter',
        networkId: SOLANA_NETWORK,
        positions: [
          expect.objectContaining({
            asset: expect.objectContaining({ identity: SOLANA_USDC, decimals: 6 }),
          }),
        ],
      }),
    );

    const regressed = solanaFixture();
    regressed.sources[0]!.mutate = (response) => {
      nested(response, 'continuityFloor').slot = '100';
      nested(response, 'continuityFloor').root = '100';
      nested(response, 'chainAnchor').slot = '101';
      nested(response, 'chainAnchor').root = '99';
    };
    await expectUnavailable(regressed, 'REGRESSING_EVIDENCE');
  });

  it.each([
    ['accountId', OTHER_ACCOUNT_ID],
    ['correlationId', 'different-correlation'],
    ['sourceFamilyId', 'family-confused'],
    ['sourceId', 'rpc-confused'],
    ['sourceKind', 'PROVIDER_API'],
    ['walletId', OTHER_WALLET_ID],
    ['providerId', 'compound'],
    ['protocolId', 'compound-v3'],
    ['marketId', 'other-market'],
    ['networkId', 'eip155:8453'],
    ['status', 'PARTIAL'],
  ] as const)('rejects confused-deputy source response field %s', async (key, replacement) => {
    const value = fixture();
    value.sources[0]!.mutate = (response) => (response[key] = replacement);
    await expectUnavailable(value, 'SOURCE_MISMATCH');
  });

  it.each([
    [
      'asset stablecoin',
      (response: MutableRecord) => {
        const assets = response.assets as MutableRecord[];
        assets[0]!.stablecoin = 'USDT';
      },
    ],
    [
      'asset identity',
      (response: MutableRecord) => {
        const positions = response.positions as MutableRecord[];
        nested(positions[0]!, 'asset').identity = MARKET;
      },
    ],
    [
      'asset decimals',
      (response: MutableRecord) => {
        const positions = response.positions as MutableRecord[];
        nested(positions[0]!, 'asset').decimals = 18;
      },
    ],
    [
      'decimal mismatch',
      (response: MutableRecord) => {
        const positions = response.positions as MutableRecord[];
        nested(positions[0]!, 'balance').decimal = '1234567';
      },
    ],
    [
      'noncanonical atomic amount',
      (response: MutableRecord) => {
        const positions = response.positions as MutableRecord[];
        nested(positions[0]!, 'balance').atomic = '01';
      },
    ],
    [
      'unapproved position kind',
      (response: MutableRecord) => {
        const positions = response.positions as MutableRecord[];
        positions[0]!.positionKind = 'REWARD';
      },
    ],
  ])('rejects source attribution or amount confusion: %s', async (_name, mutate) => {
    const value = fixture();
    value.sources[0]!.mutate = mutate;
    await expectUnavailable(value, 'SOURCE_MISMATCH');
  });

  it('rejects missing, extra, and duplicate position coverage', async () => {
    const missing = fixture();
    missing.sources[0]!.mutate = (response) => delete response.positions;
    await expectUnavailable(missing, 'SOURCE_MISMATCH');

    const extra = fixture();
    extra.sources[0]!.mutate = (response) => (response.unreviewed = true);
    await expectUnavailable(extra, 'SOURCE_MISMATCH');

    const duplicate = fixture();
    duplicate.sources.forEach((source) => (source.positions = [position(), position()]));
    await expectUnavailable(duplicate, 'INCOMPLETE_COVERAGE');
  });

  it('rejects stale, future, and policy-excessive evidence deadlines', async () => {
    const stale = fixture();
    stale.sources[0]!.mutate = (response) => (response.staleAfter = NOW.toISOString());
    await expectUnavailable(stale, 'STALE_EVIDENCE');

    const future = fixture();
    future.sources[0]!.mutate = (response) => (response.observedAt = '2026-09-04T17:00:01.000Z');
    await expectUnavailable(future, 'STALE_EVIDENCE');

    const excessive = fixture();
    excessive.sources[0]!.mutate = (response) => (response.staleAfter = '2026-09-04T17:01:01.000Z');
    await expectUnavailable(excessive, 'STALE_EVIDENCE');
  });

  it('rejects regressing anchors and same-height hash substitution', async () => {
    const lower = fixture();
    lower.sources[0]!.mutate = (response) => {
      nested(response, 'continuityFloor').blockNumber = '101';
    };
    await expectUnavailable(lower, 'REGRESSING_EVIDENCE');

    const changed = fixture();
    changed.sources[0]!.mutate = (response) => {
      nested(response, 'continuityFloor').blockNumber = '100';
      nested(response, 'continuityFloor').blockHash = PRIOR_BLOCK_HASH;
    };
    await expectUnavailable(changed, 'REGRESSING_EVIDENCE');
  });

  it.each([
    [
      'balance',
      (source: FakeSource) =>
        (source.positions = [position({ balance: { atomic: '2', decimal: '0.000002' } })]),
    ],
    [
      'position id',
      (source: FakeSource) => (source.positions = [position({ positionId: 'different-position' })]),
    ],
    [
      'position kind',
      (source: FakeSource) => (source.positions = [position({ positionKind: 'BORROW' })]),
    ],
  ])('rejects independently divergent %s', async (_name, mutate) => {
    const value = fixture();
    mutate(value.sources[1]!);
    await expectUnavailable(value, 'DIVERGENT_EVIDENCE');
  });

  it('requires two distinct configured source families for every active target', async () => {
    const value = fixture();
    value.bindings[1] = { ...value.bindings[1]!, sourceFamilyId: 'family-alpha' };
    await expectUnavailable(value, 'INSUFFICIENT_INDEPENDENT_SOURCES');
  });

  it('rejects missing, extra, duplicate, and policy-unapproved source bindings', () => {
    const missing = fixture();
    missing.bindings.pop();
    expect(() => coordinator(missing)).toThrow(ProviderPositionAdmissionUnavailableError);

    const extra = fixture();
    extra.bindings.push(extra.bindings[0]!);
    expect(() => coordinator(extra)).toThrow(ProviderPositionAdmissionUnavailableError);

    const duplicate = fixture();
    duplicate.bindings[1] = { ...duplicate.bindings[0]! };
    expect(() => coordinator(duplicate)).toThrow(ProviderPositionAdmissionUnavailableError);

    const aliasedPort = fixture();
    aliasedPort.bindings[1] = { ...aliasedPort.bindings[1]!, source: aliasedPort.sources[0]! };
    expect(() => coordinator(aliasedPort)).toThrow(ProviderPositionAdmissionUnavailableError);

    const unapproved = fixture();
    unapproved.bindings[0] = { ...unapproved.bindings[0]!, sourceId: 'unknown-source' };
    expect(() => coordinator(unapproved)).toThrow(ProviderPositionAdmissionUnavailableError);
  });

  it('requires the exact approved policy fingerprint and bounded options', () => {
    const value = fixture();
    expect(
      () =>
        new DormantProviderPositionAdmissionCoordinator(
          value.policy,
          'a'.repeat(64),
          value.bindings,
          value.walletReader,
          value.clock,
          value.runner,
          { deadlineMilliseconds: 5_000, maximumConcurrency: 2 },
        ),
    ).toThrow(ProviderPositionAdmissionUnavailableError);
    expect(() => coordinator(value, { deadlineMilliseconds: 30_001 })).toThrow(
      ProviderPositionAdmissionUnavailableError,
    );
    expect(() => coordinator(value, { maximumConcurrency: 9 })).toThrow(
      ProviderPositionAdmissionUnavailableError,
    );

    const wrongAssemblyVersion = new FakeTrustedChainAssessmentAssembly();
    Object.defineProperty(wrongAssemblyVersion, 'assemblyVersion', { value: 2 });
    expect(() =>
      coordinator(
        value,
        {},
        wrongAssemblyVersion as unknown as ProviderPositionTrustedChainAssessmentAssemblyPort,
      ),
    ).toThrow(ProviderPositionAdmissionUnavailableError);

    let accessorInvoked = false;
    const accessorAssembly = Object.create(null) as MutableRecord;
    Object.defineProperties(accessorAssembly, {
      assemblyVersion: {
        enumerable: true,
        value: PROVIDER_POSITION_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY_VERSION,
      },
      assemble: {
        enumerable: true,
        get: () => {
          accessorInvoked = true;
          return async () => undefined;
        },
      },
      verifyAssembly: { enumerable: true, value: () => true },
      verify: { enumerable: true, value: () => true },
    });
    expect(() =>
      coordinator(
        value,
        {},
        accessorAssembly as unknown as ProviderPositionTrustedChainAssessmentAssemblyPort,
      ),
    ).toThrow(ProviderPositionAdmissionUnavailableError);
    expect(accessorInvoked).toBe(false);
  });

  it('rejects invalid and duplicate authoritative wallet rosters', async () => {
    const duplicate = fixture();
    duplicate.walletReader.response = [
      { walletId: WALLET_ID, networkId: NETWORK_ID },
      { walletId: WALLET_ID, networkId: NETWORK_ID },
    ];
    await expectUnavailable(duplicate, 'WALLET_ROSTER_UNAVAILABLE');

    const wrongNetwork = fixture();
    wrongNetwork.walletReader.response = [{ walletId: WALLET_ID, networkId: 'eip155:8453' }];
    await expectUnavailable(wrongNetwork, 'WALLET_ROSTER_UNAVAILABLE');
  });

  it('sanitizes wallet, source, and deadline-runner failures and never infers zero', async () => {
    const wallet = fixture();
    wallet.walletReader.error = new Error('database secret');
    await expectUnavailable(wallet, 'WALLET_ROSTER_UNAVAILABLE');

    const source = fixture();
    source.sources[0]!.error = new Error('provider credential');
    await expectUnavailable(source, 'SOURCE_UNAVAILABLE');

    const rosterRunner = fixture();
    rosterRunner.runner.errorAtCall = 1;
    await expectUnavailable(rosterRunner, 'WALLET_ROSTER_UNAVAILABLE');
    expect(rosterRunner.runner.calls[0]?.signal.aborted).toBe(true);

    const sourceRunner = fixture();
    sourceRunner.runner.errorAtCall = 2;
    await expectUnavailable(sourceRunner, 'SOURCE_UNAVAILABLE');
    expect(sourceRunner.runner.calls[0]?.signal.aborted).toBe(true);
  });

  it('aborts and drains started siblings without starting queued source jobs', async () => {
    const value = mixedPositionTargetFixture();
    value.sources[0]!.error = new Error('private provider failure');
    let siblingObservedAbort = false;
    value.sources[1]!.readOverride = (request) =>
      new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => {
          siblingObservedAbort = true;
          reject(new Error('private sibling cancellation'));
        };
        if (request.signal.aborted) {
          onAbort();
          return;
        }
        request.signal.addEventListener('abort', onAbort, { once: true });
      });

    await expectUnavailable(value, 'SOURCE_UNAVAILABLE');

    expect(siblingObservedAbort).toBe(true);
    expect(value.sources.flatMap(({ calls }) => calls)).toHaveLength(2);
    expect(value.runner.calls).toHaveLength(3);
    expect(new Set(value.runner.calls.map(({ signal }) => signal))).toHaveProperty('size', 1);
    expect(value.runner.calls[0]?.signal.aborted).toBe(true);
  });

  it('closes the shared signal after an empty authoritative roster candidate', async () => {
    const value = fixture();
    value.walletReader.response = [];

    const result = await coordinator(value).admit({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });

    expect(result.targets).toEqual([]);
    expect(value.sources.every(({ calls }) => calls.length === 0)).toBe(true);
    expect(value.runner.calls).toHaveLength(1);
    expect(value.runner.calls[0]?.signal.aborted).toBe(true);
  });

  it('enforces the configured concurrency bound through the injected deadline runner', async () => {
    const serial = fixture();
    await coordinator(serial, { maximumConcurrency: 1 }).admit({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });
    expect(serial.runner.maximumActive).toBe(1);

    const parallel = fixture();
    await coordinator(parallel, { maximumConcurrency: 2 }).admit({
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
    });
    expect(parallel.runner.maximumActive).toBeLessThanOrEqual(2);
  });

  it('fails closed when the server clock reaches the deadline', async () => {
    const value = fixture();
    const values = [new Date(NOW), new Date(NOW), new Date(NOW.getTime() + 5_000)];
    value.clock = { now: () => values.shift() ?? new Date(NOW.getTime() + 5_000) };
    await expectUnavailable(value, 'SOURCE_UNAVAILABLE');
  });

  it.each([
    ['invalid Date', () => new Date(Number.NaN)],
    [
      'Date subclass',
      () => {
        class HostileDate extends Date {}
        return new HostileDate(NOW);
      },
    ],
    ['Date proxy', () => new Proxy(new Date(NOW), {})],
  ] as const)('rejects hostile server clock output: %s', async (_name, now) => {
    const value = fixture();
    value.clock = { now };
    await expectUnavailable(value, 'INVALID_CONFIGURATION');
  });

  it('uses intrinsic Date methods and rejects request accessors without invoking them', async () => {
    const value = fixture();
    const date = new Date(NOW) as Date & { getTime: () => number; toISOString: () => string };
    date.getTime = () => {
      throw new Error('must not run');
    };
    date.toISOString = () => {
      throw new Error('must not run');
    };
    value.clock = { now: () => date };
    await expect(
      coordinator(value).admit({ accountId: ACCOUNT_ID, correlationId: CORRELATION_ID }),
    ).resolves.toEqual(expect.objectContaining({ capturedAt: NOW.toISOString() }));

    let invoked = false;
    const request: MutableRecord = { accountId: ACCOUNT_ID };
    Object.defineProperty(request, 'correlationId', {
      enumerable: true,
      get: () => {
        invoked = true;
        return CORRELATION_ID;
      },
    });
    await expect(coordinator(fixture()).admit(request as never)).rejects.toBeInstanceOf(
      ProviderPositionAdmissionUnavailableError,
    );
    expect(invoked).toBe(false);
  });

  it('rejects accessor, cyclic, custom-prototype, and oversized source evidence', async () => {
    const accessor = fixture();
    let invoked = false;
    accessor.sources[0]!.mutate = (response) => {
      Object.defineProperty(response, 'status', {
        enumerable: true,
        get: () => {
          invoked = true;
          return 'COMPLETE';
        },
      });
    };
    await expectUnavailable(accessor, 'SOURCE_MISMATCH');
    expect(invoked).toBe(false);

    const cyclic = fixture();
    cyclic.sources[0]!.mutate = (response) => (response.cycle = response);
    await expectUnavailable(cyclic, 'SOURCE_MISMATCH');

    const custom = fixture();
    custom.sources[0]!.mutate = (response) => {
      response.positions = [Object.assign(Object.create({ inherited: true }), position())];
    };
    await expectUnavailable(custom, 'SOURCE_MISMATCH');

    const oversized = fixture();
    oversized.sources[0]!.mutate = (response) =>
      (response.sourceObservationId = 'x'.repeat(1024 * 1024 + 1));
    await expectUnavailable(oversized, 'SOURCE_MISMATCH');
  });

  it('does not expose an endpoint, persistence port, or financial-action capability', () => {
    const value = fixture();
    expect(Object.keys(coordinator(value))).not.toEqual(
      expect.arrayContaining(['endpoint', 'repository', 'writer', 'client']),
    );
  });
});
