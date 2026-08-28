import { parseAccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import {
  LocalDemoAllocationService,
  LocalDemoPortfolioSnapshotChangedError,
  distributeLocalDemoCapitalWithinCapacities,
  type LocalDemoAllocationPresetId,
  type LocalDemoAllocationPreviewResponse,
  type LocalDemoAllocationSelection,
} from './local-demo-allocation.service';
import {
  LocalDemoNoMatchingYieldOpportunitiesError,
  LocalDemoYieldCatalogService,
} from './local-demo-yield-catalog.service';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CORRELATION: JobCorrelationContext = Object.freeze({
  correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  initiatorActorId: ACCOUNT_ID,
});
const AS_OF = '2026-08-24T18:30:00.000Z';
const SNAPSHOT_ID = 'local-demo-portfolio:0123456789abcdef0123456789abcdef';
const RATE_SNAPSHOT_TIME = new Date('2026-08-27T01:05:00.000Z');

interface WalletFixture {
  readonly namespace: 'EVM' | 'SOLANA';
  readonly amountUsdMinor: string;
  readonly stablecoin?: 'USDC' | 'USDT';
  readonly networkId?: string;
  readonly assetIdentity?: string;
}

function preset(
  presetId: LocalDemoAllocationPresetId,
  liquidReserveBasisPoints = 3_000,
): LocalDemoAllocationSelection {
  return Object.freeze({ kind: 'PRESET', presetId, liquidReserveBasisPoints });
}

function fixture(
  wallets: readonly WalletFixture[] = Object.freeze([
    Object.freeze({ namespace: 'EVM' as const, amountUsdMinor: '700000' }),
  ]),
): Readonly<{ service: LocalDemoAllocationService; read: jest.Mock }> {
  const grossCapitalUsdMinor = wallets
    .reduce((sum, wallet) => sum + BigInt(wallet.amountUsdMinor), 0n)
    .toString();
  const read = jest.fn(async () => ({
    snapshotId: SNAPSHOT_ID,
    asOf: AS_OF,
    portfolioValueUsdMinor: grossCapitalUsdMinor,
    buyingPower: { status: 'AVAILABLE', amountUsdMinor: grossCapitalUsdMinor },
    wallets: wallets.map((wallet, index) => ({
      walletId: `wallet-${index}`,
      namespace: wallet.namespace,
      buyingPowerUsdMinor: wallet.amountUsdMinor,
      chains: [
        {
          networkId:
            wallet.networkId ??
            (wallet.namespace === 'EVM'
              ? 'eip155:31337'
              : 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
          assets: [
            {
              stablecoin: wallet.stablecoin ?? 'USDC',
              assetIdentity: wallet.assetIdentity ?? wallet.stablecoin ?? 'USDC',
              buyingPowerUsdMinor: wallet.amountUsdMinor,
            },
          ],
        },
      ],
    })),
  }));
  return {
    service: new LocalDemoAllocationService({ read } as never, new LocalDemoYieldCatalogService()),
    read,
  };
}

function preview(
  service: LocalDemoAllocationService,
  presetId: LocalDemoAllocationPresetId = 'BALANCED',
  liquidReserveBasisPoints = 3_000,
  portfolioSnapshotId = SNAPSHOT_ID,
): Promise<LocalDemoAllocationPreviewResponse> {
  return service.preview(
    ACCOUNT_ID,
    CORRELATION,
    portfolioSnapshotId,
    preset(presetId, liquidReserveBasisPoints),
  );
}

function componentAmounts(
  result: LocalDemoAllocationPreviewResponse,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      result.executionCost.modeledScenario.components.map(({ code, amountUsdMinor }) => [
        code,
        amountUsdMinor,
      ]),
    ),
  );
}

function halfEvenFreeTierPlatformFee(amountUsdMinor: bigint): bigint {
  const numerator = amountUsdMinor * 20n;
  const quotient = numerator / 10_000n;
  const remainder = numerator % 10_000n;
  if (remainder * 2n < 10_000n) return quotient;
  if (remainder * 2n > 10_000n) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

function collectKeys(value: unknown, keys = new Set<string>()): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (typeof value !== 'object' || value === null) return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

function expectExactConservation(result: LocalDemoAllocationPreviewResponse): void {
  const allocated = result.allocations.reduce(
    (sum, allocation) => sum + BigInt(allocation.amountUsdMinor),
    0n,
  );
  const totalFees = BigInt(result.executionCost.modeledScenario.totalUsdMinor);
  const deductedCost = BigInt(result.executionCost.modeledScenario.deductedFromGrossUsdMinor);
  const addedOnTop = BigInt(result.executionCost.modeledScenario.addedOnTopUsdMinor);
  const retainedResidual = BigInt(
    result.executionCost.modeledScenario.retainedRoundingResidualUsdMinor,
  );
  const managed = result.allocations[1];
  if (managed === undefined) throw new TypeError('missing managed allocation');
  expect(allocated).toBe(BigInt(result.capitalIncludedInProjectionUsdMinor));
  expect(allocated + deductedCost + retainedResidual).toBe(BigInt(result.grossCapitalUsdMinor));
  expect(deductedCost + addedOnTop).toBe(totalFees);
  expect(
    BigInt(result.executionCost.modeledScenario.requiredCapitalIncludingAddedOnTopUsdMinor),
  ).toBe(BigInt(result.grossCapitalUsdMinor) + addedOnTop);
  expect(
    result.sourceCapitalByEcosystem.reduce(
      (sum, source) => sum + BigInt(source.amountUsdMinor),
      0n,
    ),
  ).toBe(BigInt(result.grossCapitalUsdMinor));
  expect(
    result.managedYieldComposition.reduce((sum, source) => sum + BigInt(source.amountUsdMinor), 0n),
  ).toBe(BigInt(managed.amountUsdMinor));
  expect(
    result.managedYieldComposition.reduce(
      (sum, source) => sum + source.percentageBasisPointsOfManagedYield,
      0,
    ),
  ).toBe(10_000);
  expect(
    result.executionCost.modeledScenario.components.reduce(
      (sum, component) => sum + BigInt(component.amountUsdMinor),
      0n,
    ),
  ).toBe(totalFees);
  expect(BigInt(result.yieldProjection.projectedAnnualYieldUsdMinor) - totalFees).toBe(
    BigInt(result.yieldProjection.projectedAnnualYieldAfterFeesUsdMinor),
  );
}

describe('LocalDemoAllocationService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(RATE_SNAPSHOT_TIME);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rebalances within observed opportunity capacity and fails closed above it', () => {
    const bestRouteCapped = distributeLocalDemoCapitalWithinCapacities(
      100n,
      [6_000, 4_000],
      [50n, 100n],
    );
    const secondRouteCapped = distributeLocalDemoCapitalWithinCapacities(
      100n,
      [6_000, 4_000],
      [100n, 30n],
    );

    expect(bestRouteCapped).toEqual([50n, 50n]);
    expect(secondRouteCapped).toEqual([70n, 30n]);
    expect(Object.isFrozen(bestRouteCapped)).toBe(true);
    expect(() =>
      distributeLocalDemoCapitalWithinCapacities(100n, [6_000, 4_000], [49n, 50n]),
    ).toThrow(LocalDemoNoMatchingYieldOpportunitiesError);
  });

  it('builds one exact native EVM + SVM portfolio blend without a bridge or provider disclosure', async () => {
    const { service, read } = fixture([
      { namespace: 'EVM', amountUsdMinor: '700000' },
      { namespace: 'SOLANA', amountUsdMinor: '400000' },
    ]);
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network forbidden'));

    const result = await preview(service);

    expect(read).toHaveBeenCalledWith(ACCOUNT_ID, CORRELATION);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.portfolioSnapshotId).toBe(SNAPSHOT_ID);
    expect(result.rateSnapshot).toMatchObject({
      id: 'managed-rate-snapshot-v3',
      freshness: 'CURRENT',
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
      riskClassification: 'NOT_ASSESSED',
    });
    expect(result.sourceCapitalByEcosystem).toEqual([
      { ecosystem: 'EVM', amountUsdMinor: '700000' },
      { ecosystem: 'SOLANA', amountUsdMinor: '400000' },
    ]);
    expect(result.managedYieldComposition.map(({ ecosystem }) => ecosystem)).toEqual([
      'EVM',
      'SOLANA',
    ]);
    expect(
      result.managedYieldComposition.every(({ amountUsdMinor }) => amountUsdMinor !== '0'),
    ).toBe(true);
    expect(result.compositionSummary).toEqual({
      mode: 'EVM_SOLANA_PORTFOLIO_BLEND',
      crossEcosystemTransferRequired: false,
      crossEcosystemTransferUsdMinor: '0',
      activeEcosystemCount: 2,
    });
    expect(componentAmounts(result)).toMatchObject({
      CONVERSION: '0',
      CROSS_ECOSYSTEM_TRANSFER: '0',
    });
    expect(result.executionCost.modeledScenario).toMatchObject({
      modelId: 'LOCAL_DEMO_ALLOCATION_COST_V2',
      isQuote: false,
      costBasisCapitalUsdMinor: '1100000',
      rounding: 'CEIL_VARIABLE_COMPONENTS_PLATFORM_FEE_HALF_EVEN',
      routingFeePolicy: {
        tier: 'FREE',
        classification: 'MATERIAL_ORCHESTRATION',
        ruleVersion: 1,
      },
    });
    expect(result.executionCost.actualLocalOperation).toEqual({
      status: 'NO_EXECUTION',
      amountUsdMinor: '0',
    });
    expect(result.executionCost.publicExecution).toEqual({
      status: 'UNQUOTED',
      amountUsdMinor: null,
    });
    expect(result.yieldProjection.calculationMethod).toBe(
      'INTERNAL_POSITION_WEIGHTED_25_BPS_CONSERVATIVE_BUCKET',
    );
    expect(result.yieldProjection.effectiveApyBasisPoints % 25).toBe(0);
    expect(BigInt(result.yieldProjection.projectedAnnualYieldUsdMinor)).toBe(
      (BigInt(result.capitalIncludedInProjectionUsdMinor) *
        BigInt(result.yieldProjection.effectiveApyBasisPoints)) /
        10_000n,
    );
    const managedCapital = result.managedYieldComposition.reduce(
      (total, { amountUsdMinor }) => total + BigInt(amountUsdMinor),
      0n,
    );
    expect(BigInt(componentAmounts(result).PLATFORM_ROUTING ?? '-1')).toBe(
      halfEvenFreeTierPlatformFee(managedCapital),
    );
    expect(
      result.executionCost.modeledScenario.components.map(
        ({ calculationBasis }) => calculationBasis,
      ),
    ).toEqual([
      'NETWORK_ACTIVATION_AND_POSITION_VOLUME',
      'TWELVE_BPS_OF_REQUIRED_CONVERSION',
      'NO_CROSS_ECOSYSTEM_TRANSFER',
      'POSITION_SIZE_AND_UTILIZATION',
      'CANONICAL_PLATFORM_ROUTING_RULE_V1',
    ]);
    expect(
      result.executionCost.modeledScenario.components.map(
        ({ fundingTreatment }) => fundingTreatment,
      ),
    ).toEqual([
      'DEDUCTED_FROM_GROSS',
      'DEDUCTED_FROM_GROSS',
      'DEDUCTED_FROM_GROSS',
      'DEDUCTED_FROM_GROSS',
      'ADDED_ON_TOP',
    ]);
    expect(result.yieldProjection.firstPositiveDayAfterFees).toMatchObject({
      status: 'RECOVERED_WITHIN_HORIZON',
      day: expect.any(Number),
      modelHorizonDays: 365,
    });
    expectExactConservation(result);

    const responseKeys = collectKeys(result);
    for (const forbidden of [
      'provider',
      'protocol',
      'marketId',
      'opportunity',
      'sourceReference',
      'payloadSha256',
      'normalizerId',
      'attributes',
    ]) {
      expect(responseKeys).not.toContain(forbidden);
    }
    expect(JSON.stringify(result)).not.toMatch(
      /morpho|kamino|aave|save|solend|provider|protocol|eip155:|solana:|0x[0-9a-f]{40,64}/iu,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceCapitalByEcosystem)).toBe(true);
    expect(Object.isFrozen(result.managedYieldComposition)).toBe(true);
  });

  it.each([
    {
      liquidReserveBasisPoints: 0,
      description:
        'Keep 0% readily available and allocate the remainder to the managed yield strategy.',
      expectedPercentages: [0, 10_000],
    },
    {
      liquidReserveBasisPoints: 1_550,
      description:
        'Keep 15.50% readily available and allocate the remainder to the managed yield strategy.',
      expectedPercentages: [1_550, 8_450],
    },
    {
      liquidReserveBasisPoints: 9_500,
      description:
        'Keep 95% readily available and allocate the remainder to the managed yield strategy.',
      expectedPercentages: [9_500, 500],
    },
  ])(
    'uses a caller-selected $liquidReserveBasisPoints bps reserve with server-owned text',
    async ({ liquidReserveBasisPoints, description, expectedPercentages }) => {
      const result = await preview(
        fixture([
          { namespace: 'EVM', amountUsdMinor: '700000' },
          { namespace: 'SOLANA', amountUsdMinor: '400000' },
        ]).service,
        'BALANCED',
        liquidReserveBasisPoints,
      );

      expect(result.selection).toMatchObject({
        kind: 'PRESET',
        presetId: 'BALANCED',
        label: 'Managed blend',
        description,
        liquidReserveBasisPoints,
      });
      expect(result.allocations.map(({ percentageBasisPoints }) => percentageBasisPoints)).toEqual(
        expectedPercentages,
      );
      if (liquidReserveBasisPoints === 0) {
        expect(componentAmounts(result)).toEqual({
          NETWORK: '664',
          CONVERSION: '0',
          CROSS_ECOSYSTEM_TRANSFER: '0',
          MARKET_IMPACT: '340',
          PLATFORM_ROUTING: '2198',
        });
        expect(result.executionCost.modeledScenario.deductedFromGrossUsdMinor).toBe('1004');
        expect(result.executionCost.modeledScenario.addedOnTopUsdMinor).toBe('2198');
        expect(result.executionCost.modeledScenario.retainedRoundingResidualUsdMinor).toBe('0');
        expect(result.executionCost.modeledScenario.totalUsdMinor).toBe('3202');
        expect(result.capitalIncludedInProjectionUsdMinor).toBe('1098996');
        expect(result.allocations.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual([
          '0',
          '1098996',
        ]);
      }
      expectExactConservation(result);
    },
  );

  it('charges zero only for one exact identity-preserving direct route', async () => {
    const catalog = new LocalDemoYieldCatalogService();
    const catalogSelection = catalog.select(null);
    const directOpportunity = catalogSelection.selectedOpportunities.find(
      ({ ecosystem }) => ecosystem === 'EVM',
    );
    if (directOpportunity === undefined) throw new TypeError('missing direct test opportunity');
    const setup = fixture([
      {
        namespace: 'EVM',
        amountUsdMinor: '700000',
        stablecoin: directOpportunity.asset.symbol,
        networkId: directOpportunity.network.id,
        assetIdentity: directOpportunity.asset.contract,
      },
    ]);
    const service = new LocalDemoAllocationService(
      { read: setup.read } as never,
      {
        select: () =>
          Object.freeze({
            ...catalogSelection,
            selectedOpportunities: Object.freeze([directOpportunity]),
          }),
      } as never,
    );

    const result = await preview(service);

    expect(result.executionCost.modeledScenario.routingFeePolicy).toEqual({
      tier: 'FREE',
      classification: 'DIRECT_COMPATIBLE',
      ruleVersion: 1,
    });
    expect(componentAmounts(result).PLATFORM_ROUTING).toBe('0');
  });

  it('treats the same network and symbol with a different contract as material', async () => {
    const catalog = new LocalDemoYieldCatalogService();
    const catalogSelection = catalog.select(null);
    const opportunity = catalogSelection.selectedOpportunities.find(
      ({ ecosystem }) => ecosystem === 'EVM',
    );
    if (opportunity === undefined) throw new TypeError('missing identity regression opportunity');
    const setup = fixture([
      {
        namespace: 'EVM',
        amountUsdMinor: '700000',
        stablecoin: opportunity.asset.symbol,
        networkId: opportunity.network.id,
        assetIdentity: '0x000000000000000000000000000000000000dead',
      },
    ]);
    const service = new LocalDemoAllocationService(
      { read: setup.read } as never,
      {
        select: () =>
          Object.freeze({
            ...catalogSelection,
            selectedOpportunities: Object.freeze([opportunity]),
          }),
      } as never,
    );

    const result = await preview(service);
    const managedCapital = BigInt(result.allocations[1]?.amountUsdMinor ?? '-1');

    expect(result.executionCost.modeledScenario.routingFeePolicy).toEqual({
      tier: 'FREE',
      classification: 'MATERIAL_ORCHESTRATION',
      ruleVersion: 1,
    });
    expect(BigInt(componentAmounts(result).PLATFORM_ROUTING ?? '-1')).toBe(
      halfEvenFreeTierPlatformFee(managedCapital),
    );
    expect(BigInt(componentAmounts(result).PLATFORM_ROUTING ?? '0')).toBeGreaterThan(0n);
  });

  it('uses post-fee ecosystem capacity so a zero reserve remains solvent for a skewed blend', async () => {
    const result = await preview(
      fixture([
        { namespace: 'EVM', amountUsdMinor: '1000000' },
        { namespace: 'SOLANA', amountUsdMinor: '500' },
      ]).service,
      'MORE_YIELD',
      0,
    );
    const managedByEcosystem = new Map(
      result.managedYieldComposition.map(({ ecosystem, amountUsdMinor }) => [
        ecosystem,
        BigInt(amountUsdMinor),
      ]),
    );
    const perEcosystemRemainders = result.sourceCapitalByEcosystem.map(
      ({ ecosystem, amountUsdMinor }) =>
        BigInt(amountUsdMinor) - (managedByEcosystem.get(ecosystem) ?? 0n),
    );

    expect(perEcosystemRemainders.every((remainder) => remainder >= 0n)).toBe(true);
    expect(perEcosystemRemainders.reduce((sum, remainder) => sum + remainder, 0n)).toBe(
      BigInt(result.executionCost.modeledScenario.deductedFromGrossUsdMinor),
    );
    expect(result.allocations[0]?.amountUsdMinor).toBe('0');
    expectExactConservation(result);
  });

  it('rejects invalid reserve selections before reading portfolio state or accessors', async () => {
    const invalidSelections: unknown[] = [
      { kind: 'PRESET', presetId: 'BALANCED' },
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: -1 },
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 9_501 },
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 1.5 },
      {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
        providerId: 'caller-supplied',
      },
      Object.assign(Object.create({ polluted: true }), {
        kind: 'PRESET',
        presetId: 'BALANCED',
        liquidReserveBasisPoints: 3_000,
      }),
    ];
    let accessorInvoked = false;
    const accessorSelection = Object.create(null) as Record<string, unknown>;
    accessorSelection.kind = 'PRESET';
    accessorSelection.presetId = 'BALANCED';
    Object.defineProperty(accessorSelection, 'liquidReserveBasisPoints', {
      enumerable: true,
      get: () => {
        accessorInvoked = true;
        return 3_000;
      },
    });
    invalidSelections.push(accessorSelection);

    for (const selection of invalidSelections) {
      const { service, read } = fixture();
      await expect(
        service.preview(
          ACCOUNT_ID,
          CORRELATION,
          SNAPSHOT_ID,
          selection as LocalDemoAllocationSelection,
        ),
      ).rejects.toBeInstanceOf(TypeError);
      expect(read).not.toHaveBeenCalled();
    }
    expect(accessorInvoked).toBe(false);
  });

  it.each([
    { namespace: 'EVM' as const, expectedSources: ['700000', '0'] },
    { namespace: 'SOLANA' as const, expectedSources: ['0', '400000'] },
  ])('keeps a $namespace-only portfolio inside its native ecosystem', async (entry) => {
    const amountUsdMinor = entry.namespace === 'EVM' ? '700000' : '400000';
    const result = await preview(fixture([{ namespace: entry.namespace, amountUsdMinor }]).service);

    expect(result.sourceCapitalByEcosystem.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual(
      entry.expectedSources,
    );
    expect(result.compositionSummary).toMatchObject({
      mode: 'SINGLE_ECOSYSTEM',
      crossEcosystemTransferRequired: false,
      crossEcosystemTransferUsdMinor: '0',
      activeEcosystemCount: 1,
    });
    expect(componentAmounts(result).CROSS_ECOSYSTEM_TRANSFER).toBe('0');
    if (entry.namespace === 'EVM') {
      expect(componentAmounts(result)).toEqual({
        NETWORK: '489',
        CONVERSION: '0',
        CROSS_ECOSYSTEM_TRANSFER: '0',
        MARKET_IMPACT: '177',
        PLATFORM_ROUTING: '979',
      });
      expect(result.executionCost.modeledScenario.deductedFromGrossUsdMinor).toBe('666');
      expect(result.executionCost.modeledScenario.addedOnTopUsdMinor).toBe('979');
      expect(result.executionCost.modeledScenario.retainedRoundingResidualUsdMinor).toBe('0');
      expect(result.executionCost.modeledScenario.totalUsdMinor).toBe('1645');
      expect(result.executionCost.modeledScenario.requiredCapitalIncludingAddedOnTopUsdMinor).toBe(
        '700979',
      );
      expect(result.capitalIncludedInProjectionUsdMinor).toBe('699334');
      expect(result.allocations.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual([
        '209800',
        '489534',
      ]);
      expect(result.yieldProjection).toMatchObject({
        effectiveApyBasisPoints: 650,
        projectedAnnualYieldUsdMinor: '45456',
        projectedAnnualYieldAfterFeesUsdMinor: '43811',
        firstPositiveDayAfterFees: { day: 14 },
      });
    }
    expectExactConservation(result);
  });

  it('pins the standard zero-reserve single-EVM economics', async () => {
    const result = await preview(
      fixture([{ namespace: 'EVM', amountUsdMinor: '700000' }]).service,
      'BALANCED',
      0,
    );

    expect(componentAmounts(result)).toEqual({
      NETWORK: '623',
      CONVERSION: '0',
      CROSS_ECOSYSTEM_TRANSFER: '0',
      MARKET_IMPACT: '252',
      PLATFORM_ROUTING: '1398',
    });
    expect(result.executionCost.modeledScenario.deductedFromGrossUsdMinor).toBe('875');
    expect(result.executionCost.modeledScenario.addedOnTopUsdMinor).toBe('1398');
    expect(result.executionCost.modeledScenario.retainedRoundingResidualUsdMinor).toBe('0');
    expect(result.executionCost.modeledScenario.totalUsdMinor).toBe('2273');
    expect(result.executionCost.modeledScenario.requiredCapitalIncludingAddedOnTopUsdMinor).toBe(
      '701398',
    );
    expect(result.capitalIncludedInProjectionUsdMinor).toBe('699125');
    expect(result.allocations.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual(['0', '699125']);
    expect(result.yieldProjection).toMatchObject({
      effectiveApyBasisPoints: 950,
      projectedAnnualYieldUsdMinor: '66416',
      projectedAnnualYieldAfterFeesUsdMinor: '64143',
      firstPositiveDayAfterFees: { day: 13 },
    });
    expectExactConservation(result);
  });

  it.each([
    { grossCapitalUsdMinor: '430', expectedResidualUsdMinor: '0' },
    { grossCapitalUsdMinor: '930', expectedResidualUsdMinor: '0' },
    { grossCapitalUsdMinor: '2264', expectedResidualUsdMinor: '1' },
    { grossCapitalUsdMinor: '4348', expectedResidualUsdMinor: '2' },
    { grossCapitalUsdMinor: '4349', expectedResidualUsdMinor: '2' },
    { grossCapitalUsdMinor: '6433', expectedResidualUsdMinor: '1' },
    { grossCapitalUsdMinor: '6435', expectedResidualUsdMinor: '1' },
    { grossCapitalUsdMinor: '8518', expectedResidualUsdMinor: '1' },
    { grossCapitalUsdMinor: '8521', expectedResidualUsdMinor: '2' },
  ])(
    'resolves the $grossCapitalUsdMinor cent rounding boundary without false unavailability',
    async ({ grossCapitalUsdMinor, expectedResidualUsdMinor }) => {
      const result = await preview(
        fixture([{ namespace: 'EVM', amountUsdMinor: grossCapitalUsdMinor }]).service,
        'BALANCED',
        0,
      );
      const managedCapital = BigInt(result.allocations[1]?.amountUsdMinor ?? '-1');
      const residual = BigInt(
        result.executionCost.modeledScenario.retainedRoundingResidualUsdMinor,
      );

      expect(residual.toString()).toBe(expectedResidualUsdMinor);
      expect(BigInt(componentAmounts(result).PLATFORM_ROUTING ?? '-1')).toBe(
        halfEvenFreeTierPlatformFee(managedCapital),
      );
      expectExactConservation(result);
    },
  );

  it('has no false unavailability across the 181..10000 cent threshold scan', async () => {
    const unavailable: number[] = [];
    let maximumResidual = 0n;
    for (let grossCapital = 181; grossCapital <= 10_000; grossCapital += 1) {
      try {
        const result = await preview(
          fixture([{ namespace: 'EVM', amountUsdMinor: grossCapital.toString() }]).service,
          'BALANCED',
          0,
        );
        const managedCapital = BigInt(result.allocations[1]?.amountUsdMinor ?? '-1');
        const platformFee = BigInt(componentAmounts(result).PLATFORM_ROUTING ?? '-1');
        const modeled = result.executionCost.modeledScenario;
        const retainedResidual = BigInt(modeled.retainedRoundingResidualUsdMinor);
        if (retainedResidual > maximumResidual) maximumResidual = retainedResidual;
        if (
          platformFee !== halfEvenFreeTierPlatformFee(managedCapital) ||
          BigInt(result.capitalIncludedInProjectionUsdMinor) +
            BigInt(modeled.deductedFromGrossUsdMinor) +
            BigInt(modeled.retainedRoundingResidualUsdMinor) !==
            BigInt(result.grossCapitalUsdMinor)
        ) {
          unavailable.push(grossCapital);
        }
      } catch {
        unavailable.push(grossCapital);
      }
    }

    expect(unavailable).toEqual([]);
    expect(maximumResidual).toBe(3n);
  });

  it('fails closed across a route-activation gap instead of mislabeling it as rounding', async () => {
    await expect(
      preview(fixture([{ namespace: 'EVM', amountUsdMinor: '180' }]).service, 'BALANCED', 0),
    ).rejects.toBeInstanceOf(LocalDemoNoMatchingYieldOpportunitiesError);

    const firstFeasible = await preview(
      fixture([{ namespace: 'EVM', amountUsdMinor: '181' }]).service,
      'BALANCED',
      0,
    );
    expect(firstFeasible.executionCost.modeledScenario.retainedRoundingResidualUsdMinor).toBe('0');
    expectExactConservation(firstFeasible);
  });

  it('calculates conversion only within the source ecosystem instead of pooling by ticker', async () => {
    const direct = await preview(
      fixture([{ namespace: 'EVM', amountUsdMinor: '700000', stablecoin: 'USDC' }]).service,
    );
    const conversion = await preview(
      fixture([{ namespace: 'EVM', amountUsdMinor: '700000', stablecoin: 'USDT' }]).service,
    );

    expect(componentAmounts(direct).CONVERSION).toBe('0');
    expect(BigInt(componentAmounts(conversion).CONVERSION ?? '0')).toBeGreaterThan(0n);
    expect(componentAmounts(conversion).CROSS_ECOSYSTEM_TRANSFER).toBe('0');
  });

  it('binds a preview to the exact displayed portfolio snapshot', async () => {
    const { service } = fixture();

    await expect(
      preview(service, 'BALANCED', 3_000, 'local-demo-portfolio:ffffffffffffffffffffffffffffffff'),
    ).rejects.toBeInstanceOf(LocalDemoPortfolioSnapshotChangedError);
  });

  it.each([0, 9_500])(
    'returns the typed unavailable result for unusable dust at %s reserve bps',
    async (liquidReserveBasisPoints) => {
      const { service } = fixture([{ namespace: 'EVM', amountUsdMinor: '1' }]);

      await expect(preview(service, 'BALANCED', liquidReserveBasisPoints)).rejects.toBeInstanceOf(
        LocalDemoNoMatchingYieldOpportunitiesError,
      );
    },
  );

  it('never funds one ecosystem fees or principal from the other ecosystem', async () => {
    const { service } = fixture([
      { namespace: 'EVM', amountUsdMinor: '1' },
      { namespace: 'SOLANA', amountUsdMinor: '1000000' },
    ]);

    await expect(preview(service)).rejects.toBeInstanceOf(
      LocalDemoNoMatchingYieldOpportunitiesError,
    );
  });

  it('keeps a stale server-owned cross-chain rate set explicitly non-executable', async () => {
    jest.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    const result = await preview(fixture().service);

    expect(result.rateSnapshot).toMatchObject({
      id: 'managed-rate-snapshot-v3',
      freshness: 'STALE',
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
    });
    expect(result.mayAuthorizeFinancialAction).toBe(false);
  });
});
