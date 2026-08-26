import { parseAccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import {
  LocalDemoAllocationService,
  LocalDemoPortfolioSnapshotChangedError,
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
const RATE_SNAPSHOT_TIME = new Date('2026-08-26T22:00:00.000Z');

interface WalletFixture {
  readonly namespace: 'EVM' | 'SOLANA';
  readonly amountUsdMinor: string;
  readonly stablecoin?: 'USDC' | 'USDT';
}

function preset(presetId: LocalDemoAllocationPresetId): LocalDemoAllocationSelection {
  return Object.freeze({ kind: 'PRESET', presetId });
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
          assets: [
            {
              stablecoin: wallet.stablecoin ?? 'USDC',
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
  portfolioSnapshotId = SNAPSHOT_ID,
): Promise<LocalDemoAllocationPreviewResponse> {
  return service.preview(ACCOUNT_ID, CORRELATION, portfolioSnapshotId, preset(presetId));
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
  const cost = BigInt(result.executionCost.modeledScenario.totalUsdMinor);
  const managed = result.allocations[1];
  if (managed === undefined) throw new TypeError('missing managed allocation');
  expect(allocated).toBe(BigInt(result.capitalIncludedInProjectionUsdMinor));
  expect(allocated + cost).toBe(BigInt(result.grossCapitalUsdMinor));
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
  ).toBe(cost);
  expect(BigInt(result.yieldProjection.projectedAnnualYieldUsdMinor) - cost).toBe(
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
      id: 'managed-rate-snapshot-v2',
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
      activeAllocationCount: 3,
    });
    expect(componentAmounts(result)).toMatchObject({
      CONVERSION: '0',
      CROSS_ECOSYSTEM_TRANSFER: '0',
    });
    expect(result.executionCost.modeledScenario).toMatchObject({
      modelId: 'LOCAL_DEMO_ALLOCATION_COST_V2',
      isQuote: false,
      costBasisCapitalUsdMinor: '1100000',
    });
    expect(result.executionCost.actualLocalOperation).toEqual({
      status: 'NO_EXECUTION',
      amountUsdMinor: '0',
    });
    expect(result.executionCost.publicExecution).toEqual({
      status: 'UNQUOTED',
      amountUsdMinor: null,
    });
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
      /morpho|kamino|provider|protocol|eip155:|solana:|0x[0-9a-f]{40,64}/iu,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceCapitalByEcosystem)).toBe(true);
    expect(Object.isFrozen(result.managedYieldComposition)).toBe(true);
  });

  it.each([
    { namespace: 'EVM' as const, expectedSources: ['700000', '0'], expectedRoutes: 2 },
    { namespace: 'SOLANA' as const, expectedSources: ['0', '400000'], expectedRoutes: 1 },
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
      activeAllocationCount: entry.expectedRoutes,
    });
    expect(componentAmounts(result).CROSS_ECOSYSTEM_TRANSFER).toBe('0');
    expectExactConservation(result);
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
      preview(service, 'BALANCED', 'local-demo-portfolio:ffffffffffffffffffffffffffffffff'),
    ).rejects.toBeInstanceOf(LocalDemoPortfolioSnapshotChangedError);
  });

  it('fails closed when modeled activation costs exhaust tiny capital', async () => {
    const { service } = fixture([{ namespace: 'EVM', amountUsdMinor: '1' }]);

    await expect(preview(service)).rejects.toThrow('local demo modeled cost exhausts capital');
  });

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
      id: 'managed-rate-snapshot-v2',
      freshness: 'STALE',
      staleBehavior: 'LABEL_STALE_KEEP_NON_EXECUTABLE',
    });
    expect(result.mayAuthorizeFinancialAction).toBe(false);
  });
});
