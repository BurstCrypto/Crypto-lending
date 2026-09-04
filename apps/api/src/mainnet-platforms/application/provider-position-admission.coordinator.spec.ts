import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import type {
  ActivePortfolioWalletRegistration,
  PortfolioWalletRegistrationReader,
  ReadActivePortfolioWalletRegistrationsRequest,
} from '../../portfolio/application/ports/portfolio-wallet-registration-reader.port';
import {
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_USE,
  MAINNET_PROVIDER_POSITION_OBSERVATION_POLICY_VERSION,
  mainnetProviderPositionObservationPolicyFingerprintV1,
} from '../domain/mainnet-provider-position-observation-policy';
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
  error: Error | undefined;
  mutate: ((value: MutableRecord) => void) | undefined;
  positions: MutableRecord[] = [position()];

  constructor(
    readonly sourceFamilyId: string,
    readonly sourceId: string,
    readonly sourceKind: 'RPC' | 'INDEXER',
    readonly networkId = NETWORK_ID,
  ) {}

  async readTarget(request: ReadProviderPositionAdmissionTargetRequestV1): Promise<unknown> {
    this.calls.push(request);
    if (this.error) throw this.error;
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

function coordinator(
  value: Fixture,
  overrides: Partial<{ deadlineMilliseconds: number; maximumConcurrency: number }> = {},
): DormantProviderPositionAdmissionCoordinator {
  return new DormantProviderPositionAdmissionCoordinator(
    value.policy,
    value.policy.fingerprintSha256 as string,
    value.bindings,
    value.walletReader,
    value.clock,
    value.runner,
    { deadlineMilliseconds: 5_000, maximumConcurrency: 2, ...overrides },
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
    expect(value.runner.calls).toHaveLength(2);
    expect(new Set(value.runner.calls.map(({ signal }) => signal)).size).toBe(1);
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

    const runner = fixture();
    runner.runner.errorAtCall = 1;
    await expectUnavailable(runner, 'SOURCE_UNAVAILABLE');
    expect(runner.runner.calls[0]?.signal.aborted).toBe(true);
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
