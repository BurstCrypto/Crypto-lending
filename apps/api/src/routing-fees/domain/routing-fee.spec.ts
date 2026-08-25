import {
  MAX_ROUTING_FEE_ATOMIC_AMOUNT,
  ROUTING_FEE_RULE_CATALOG_V1,
  ROUTING_FEE_RULE_V1,
  ROUTING_FEE_V1_BASIS_POINTS,
  RoutingFeeValidationError,
  calculateRoutingFeeAtomicAmount,
  calculateRoutingFeeSnapshotV1,
  classifyRoutingFeeRouteV1,
  normalizeRoutingFeeRouteV1,
  normalizeRoutingFeeRuleCatalogV1,
  normalizeRoutingFeeRuleVersionV1,
  resolveRoutingFeeRuleV1,
  type CalculateRoutingFeeSnapshotInput,
  type RoutingFeeRouteV1,
  type RoutingFeeRuleCatalogV1,
} from './routing-fee';

const QUOTE_ID = '76000000-0000-4000-8000-000000000010';
const ROUTE_ID = '76000000-0000-4000-8000-000000000011';
const USDC_REVISION_ID = '76000000-0000-4000-8000-000000000012';
const ETH_REVISION_ID = '76000000-0000-4000-8000-000000000013';
const NETWORK_FEE_REFERENCE_ID = '76000000-0000-4000-8000-000000000014';
const DEX_FEE_REFERENCE_ID = '76000000-0000-4000-8000-000000000015';
const BRIDGE_FEE_REFERENCE_ID = '76000000-0000-4000-8000-000000000016';
const PROVIDER_FEE_REFERENCE_ID = '76000000-0000-4000-8000-000000000017';
const RULE_V2_REFERENCE_ID = '76000000-0000-4000-8000-000000000002';
const QUOTED_AT = '2026-08-25T12:00:00.000Z';

const ETHEREUM_USDT = Object.freeze({ networkId: 'eip155:1', assetId: 'USDT_ETHEREUM' });
const ETHEREUM_USDC = Object.freeze({ networkId: 'eip155:1', assetId: 'USDC_ETHEREUM' });
const BASE_USDC = Object.freeze({ networkId: 'eip155:8453', assetId: 'USDC_BASE' });

function directRoute(): RoutingFeeRouteV1 {
  return {
    schemaVersion: 1,
    source: { ...BASE_USDC },
    destination: { ...BASE_USDC },
    legs: [
      {
        kind: 'DIRECT_SETTLEMENT',
        source: { ...BASE_USDC },
        destination: { ...BASE_USDC },
      },
    ],
  };
}

function swapRoute(): RoutingFeeRouteV1 {
  return {
    schemaVersion: 1,
    source: { ...ETHEREUM_USDT },
    destination: { ...ETHEREUM_USDC },
    legs: [
      {
        kind: 'SWAP',
        source: { ...ETHEREUM_USDT },
        destination: { ...ETHEREUM_USDC },
      },
    ],
  };
}

function bridgeRoute(): RoutingFeeRouteV1 {
  return {
    schemaVersion: 1,
    source: { ...ETHEREUM_USDC },
    destination: { ...BASE_USDC },
    legs: [
      {
        kind: 'BRIDGE',
        source: { ...ETHEREUM_USDC },
        destination: { ...BASE_USDC },
      },
    ],
  };
}

function multiLegRoute(): RoutingFeeRouteV1 {
  return {
    schemaVersion: 1,
    source: { ...ETHEREUM_USDT },
    destination: { ...BASE_USDC },
    legs: [
      {
        kind: 'SWAP',
        source: { ...ETHEREUM_USDT },
        destination: { ...ETHEREUM_USDC },
      },
      {
        kind: 'BRIDGE',
        source: { ...ETHEREUM_USDC },
        destination: { ...BASE_USDC },
      },
    ],
  };
}

function calculationInput(
  overrides: Partial<CalculateRoutingFeeSnapshotInput> = {},
): CalculateRoutingFeeSnapshotInput {
  return {
    schemaVersion: 1,
    quoteReferenceId: QUOTE_ID,
    routeReferenceId: ROUTE_ID,
    quotedAt: QUOTED_AT,
    tier: 'FREE',
    route: swapRoute(),
    feeBase: {
      assetRevisionId: USDC_REVISION_ID,
      amountAtomic: '5000000000',
    },
    passThroughComponents: [],
    ...overrides,
  };
}

function ruleInput(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    ruleReferenceId: '76000000-0000-4000-8000-000000000001',
    version: 1,
    effectiveFrom: '2026-08-25T00:00:00.000Z',
    effectiveUntil: null,
    routeClassificationVersion: 1,
    roundingMode: 'HALF_EVEN',
    platformRates: {
      directCompatible: { mantissa: '0', scale: 0 },
      materialOrchestration: {
        FREE: { mantissa: '20', scale: 4 },
        INDIVIDUAL: { mantissa: '12', scale: 4 },
        PRO: { mantissa: '8', scale: 4 },
      },
    },
    ...overrides,
  };
}

function twoVersionCatalog(roundingMode = 'HALF_EVEN'): RoutingFeeRuleCatalogV1 {
  return normalizeRoutingFeeRuleCatalogV1({
    schemaVersion: 1,
    rules: [
      ruleInput({ effectiveUntil: '2026-09-01T00:00:00.000Z', roundingMode }),
      ruleInput({
        ruleReferenceId: RULE_V2_REFERENCE_ID,
        version: 2,
        effectiveFrom: '2026-09-01T00:00:00.000Z',
        effectiveUntil: null,
        roundingMode,
        platformRates: {
          directCompatible: { mantissa: '0', scale: 0 },
          materialOrchestration: {
            FREE: { mantissa: '25', scale: 4 },
            INDIVIDUAL: { mantissa: '15', scale: 4 },
            PRO: { mantissa: '10', scale: 4 },
          },
        },
      }),
    ],
  });
}

function expectCode(work: () => unknown, code: RoutingFeeValidationError['code']): void {
  expect(work).toThrow(new RoutingFeeValidationError(code));
}

function expectDeepFrozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe('routing fee rule policy', () => {
  it('publishes the immutable v1 Free, Individual, and Pro rates as exact decimals', () => {
    expect(ROUTING_FEE_V1_BASIS_POINTS).toEqual({ FREE: 20, INDIVIDUAL: 12, PRO: 8 });
    expect(ROUTING_FEE_RULE_V1).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        version: 1,
        effectiveFrom: '2026-08-25T00:00:00.000Z',
        effectiveUntil: null,
        routeClassificationVersion: 1,
        roundingMode: 'HALF_EVEN',
      }),
    );
    expect(ROUTING_FEE_RULE_V1.platformRates).toEqual({
      directCompatible: { mantissa: '0', scale: 0 },
      materialOrchestration: {
        FREE: { mantissa: '20', scale: 4 },
        INDIVIDUAL: { mantissa: '12', scale: 4 },
        PRO: { mantissa: '8', scale: 4 },
      },
    });
    expectDeepFrozen(ROUTING_FEE_RULE_CATALOG_V1);
  });

  it('resolves effective versions with an inclusive start and exclusive end', () => {
    const catalog = twoVersionCatalog();
    expect(resolveRoutingFeeRuleV1(catalog, '2026-08-31T23:59:59.999Z').version).toBe(1);
    expect(resolveRoutingFeeRuleV1(catalog, '2026-09-01T00:00:00.000Z').version).toBe(2);
  });

  it('sorts a valid catalog while preserving non-overlapping gaps as fail-closed periods', () => {
    const catalog = normalizeRoutingFeeRuleCatalogV1({
      schemaVersion: 1,
      rules: [
        ruleInput({
          ruleReferenceId: RULE_V2_REFERENCE_ID,
          version: 2,
          effectiveFrom: '2026-09-02T00:00:00.000Z',
        }),
        ruleInput({ effectiveUntil: '2026-09-01T00:00:00.000Z' }),
      ],
    });
    expect(catalog.rules.map(({ version }) => version)).toEqual([1, 2]);
    expectCode(
      () => resolveRoutingFeeRuleV1(catalog, '2026-09-01T12:00:00.000Z'),
      'NO_EFFECTIVE_RULE',
    );
  });

  it.each([
    {
      label: 'overlap',
      rules: [
        ruleInput({ effectiveUntil: '2026-09-02T00:00:00.000Z' }),
        ruleInput({
          ruleReferenceId: RULE_V2_REFERENCE_ID,
          version: 2,
          effectiveFrom: '2026-09-01T00:00:00.000Z',
        }),
      ],
    },
    {
      label: 'open ended non-final version',
      rules: [
        ruleInput(),
        ruleInput({
          ruleReferenceId: RULE_V2_REFERENCE_ID,
          version: 2,
          effectiveFrom: '2026-09-01T00:00:00.000Z',
        }),
      ],
    },
    {
      label: 'duplicate version',
      rules: [
        ruleInput({ effectiveUntil: '2026-09-01T00:00:00.000Z' }),
        ruleInput({
          ruleReferenceId: RULE_V2_REFERENCE_ID,
          effectiveFrom: '2026-09-01T00:00:00.000Z',
        }),
      ],
    },
    {
      label: 'duplicate reference',
      rules: [
        ruleInput({ effectiveUntil: '2026-09-01T00:00:00.000Z' }),
        ruleInput({ version: 2, effectiveFrom: '2026-09-01T00:00:00.000Z' }),
      ],
    },
    {
      label: 'version regression',
      rules: [
        ruleInput({ version: 2, effectiveUntil: '2026-09-01T00:00:00.000Z' }),
        ruleInput({
          ruleReferenceId: RULE_V2_REFERENCE_ID,
          version: 1,
          effectiveFrom: '2026-09-01T00:00:00.000Z',
        }),
      ],
    },
  ])('rejects an invalid rule catalog: $label', ({ rules }) => {
    expectCode(
      () => normalizeRoutingFeeRuleCatalogV1({ schemaVersion: 1, rules }),
      'INVALID_RULE_CATALOG',
    );
  });

  it.each([
    ['non-zero direct rate', { directCompatible: { mantissa: '1', scale: 4 } }],
    ['rate above one', { materialOrchestration: { FREE: { mantissa: '10001', scale: 4 } } }],
  ])('rejects an invalid platform policy: %s', (_label, rateOverride) => {
    const baseline = ruleInput().platformRates as Record<string, unknown>;
    const material = baseline.materialOrchestration as Record<string, unknown>;
    const platformRates = {
      ...baseline,
      ...rateOverride,
      materialOrchestration: {
        ...material,
        ...((rateOverride as Record<string, unknown>).materialOrchestration as object | undefined),
      },
    };
    expectCode(
      () => normalizeRoutingFeeRuleVersionV1(ruleInput({ platformRates })),
      'INVALID_RULE',
    );
  });

  it.each([
    ['invalid interval', { effectiveUntil: '2026-08-24T00:00:00.000Z' }],
    ['non-canonical timestamp', { effectiveFrom: '2026-08-25T00:00:00Z' }],
    ['expanded-year timestamp', { effectiveFrom: '+010000-01-01T00:00:00.000Z' }],
    ['unknown rounding', { roundingMode: 'HALF_UP' }],
    ['wrong classification version', { routeClassificationVersion: 2 }],
    ['extra field', { unexpected: true }],
  ])('rejects malformed rule metadata: %s', (_label, override) => {
    expectCode(() => normalizeRoutingFeeRuleVersionV1(ruleInput(override)), 'INVALID_RULE');
  });

  it('copies untrusted rule input and never invokes accessors', () => {
    const getter = jest.fn(() => 20);
    const rates = {
      FREE: { mantissa: '20', scale: 4 },
      INDIVIDUAL: { mantissa: '12', scale: 4 },
      PRO: { mantissa: '8', scale: 4 },
    };
    Object.defineProperty(rates, 'FREE', { enumerable: true, get: getter });
    const platformRates = {
      directCompatible: { mantissa: '0', scale: 0 },
      materialOrchestration: rates,
    };
    expectCode(
      () => normalizeRoutingFeeRuleVersionV1(ruleInput({ platformRates })),
      'INVALID_RULE',
    );
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('routing fee route classification', () => {
  it('classifies only one identity-preserving direct settlement as direct-compatible', () => {
    expect(classifyRoutingFeeRouteV1(directRoute())).toEqual({
      version: 1,
      kind: 'DIRECT_COMPATIBLE',
      reasons: ['SINGLE_DIRECT_COMPATIBLE_LEG'],
    });
  });

  it.each([
    ['swap', swapRoute(), ['SWAP_REQUIRED']],
    ['bridge', bridgeRoute(), ['BRIDGE_REQUIRED']],
    [
      'multi-leg swap and bridge',
      multiLegRoute(),
      ['MULTI_LEG_ROUTE', 'SWAP_REQUIRED', 'BRIDGE_REQUIRED'],
    ],
  ])('classifies %s routes as material orchestration', (_label, route, reasons) => {
    expect(classifyRoutingFeeRouteV1(route)).toEqual({
      version: 1,
      kind: 'MATERIAL_ORCHESTRATION',
      reasons,
    });
  });

  it('treats multiple direct-compatible legs as material orchestration', () => {
    const direct = directRoute();
    const route = { ...direct, legs: [direct.legs[0]!, direct.legs[0]!] };
    expect(classifyRoutingFeeRouteV1(route)).toEqual({
      version: 1,
      kind: 'MATERIAL_ORCHESTRATION',
      reasons: ['MULTI_LEG_ROUTE'],
    });
  });

  it.each([
    [
      'direct identity change',
      {
        ...directRoute(),
        destination: { ...ETHEREUM_USDC },
        legs: [
          {
            kind: 'DIRECT_SETTLEMENT',
            source: { ...BASE_USDC },
            destination: { ...ETHEREUM_USDC },
          },
        ],
      },
    ],
    [
      'same-asset swap',
      {
        ...swapRoute(),
        destination: { ...ETHEREUM_USDT },
        legs: [
          {
            kind: 'SWAP',
            source: { ...ETHEREUM_USDT },
            destination: { ...ETHEREUM_USDT },
          },
        ],
      },
    ],
    [
      'same-network bridge',
      {
        ...bridgeRoute(),
        destination: { ...ETHEREUM_USDT },
        legs: [
          {
            kind: 'BRIDGE',
            source: { ...ETHEREUM_USDC },
            destination: { ...ETHEREUM_USDT },
          },
        ],
      },
    ],
    [
      'discontinuous route',
      {
        ...multiLegRoute(),
        destination: { networkId: 'eip155:42161', assetId: 'USDC_ARBITRUM' },
        legs: [
          multiLegRoute().legs[0]!,
          {
            kind: 'BRIDGE',
            source: { ...BASE_USDC },
            destination: { networkId: 'eip155:42161', assetId: 'USDC_ARBITRUM' },
          },
        ],
      },
    ],
    ['empty route', { ...directRoute(), legs: [] }],
    ['extra route field', { ...directRoute(), providerSecret: 'not-accepted' }],
  ])('rejects an invalid route: %s', (_label, route) => {
    expectCode(() => normalizeRoutingFeeRouteV1(route), 'INVALID_ROUTE');
  });

  it('rejects sparse or decorated leg arrays', () => {
    const sparse = new Array(2);
    sparse[0] = directRoute().legs[0];
    expectCode(
      () => normalizeRoutingFeeRouteV1({ ...directRoute(), legs: sparse }),
      'INVALID_ROUTE',
    );

    const decorated = [...directRoute().legs];
    Object.defineProperty(decorated, 'extra', { value: true, enumerable: true });
    expectCode(
      () => normalizeRoutingFeeRouteV1({ ...directRoute(), legs: decorated }),
      'INVALID_ROUTE',
    );
  });
});

describe('routing fee calculation', () => {
  it.each([
    ['FREE', '10000000'],
    ['INDIVIDUAL', '6000000'],
    ['PRO', '4000000'],
  ] as const)('calculates the exact %s platform rate', (tier, expectedAtomic) => {
    const snapshot = calculateRoutingFeeSnapshotV1(calculationInput({ tier }));
    expect(snapshot.components[0]).toEqual({
      lineNumber: 1,
      category: 'PLATFORM',
      assetRevisionId: USDC_REVISION_ID,
      amountAtomic: expectedAtomic,
      deductionMode: 'ADDED_ON_TOP',
      source: 'PLATFORM_RULE',
      sourceReferenceId: ROUTING_FEE_RULE_V1.ruleReferenceId,
    });
    expect(snapshot.totalsByAsset).toEqual([
      { assetRevisionId: USDC_REVISION_ID, amountAtomic: expectedAtomic },
    ]);
  });

  it.each([undefined, null] as const)('defaults an unavailable tier (%s) to Free', (tier) => {
    const withoutTier: Record<string, unknown> = { ...calculationInput() };
    delete withoutTier.tier;
    const input = tier === undefined ? withoutTier : { ...withoutTier, tier };
    const snapshot = calculateRoutingFeeSnapshotV1(input);
    expect(snapshot.effectiveTier).toBe('FREE');
    expect(snapshot.components[0]?.amountAtomic).toBe('10000000');
  });

  it.each(['FREE', 'INDIVIDUAL', 'PRO'] as const)(
    'retains a zero platform snapshot for a direct-compatible %s route',
    (tier) => {
      const snapshot = calculateRoutingFeeSnapshotV1(
        calculationInput({ tier, route: directRoute() }),
      );
      expect(snapshot.routeClassification.kind).toBe('DIRECT_COMPATIBLE');
      expect(snapshot.components[0]?.amountAtomic).toBe('0');
      expect(snapshot.totalsByAsset).toEqual([
        { assetRevisionId: USDC_REVISION_ID, amountAtomic: '0' },
      ]);
    },
  );

  it('keeps platform and every pass-through category separate without modifying quoted costs', () => {
    const passThroughComponents = [
      {
        category: 'NETWORK' as const,
        assetRevisionId: ETH_REVISION_ID,
        amountAtomic: '210000000000000',
        deductionMode: 'ADDED_ON_TOP' as const,
        sourceReferenceId: NETWORK_FEE_REFERENCE_ID,
      },
      {
        category: 'DEX' as const,
        assetRevisionId: USDC_REVISION_ID,
        amountAtomic: '1000000',
        deductionMode: 'DEDUCTED_FROM_INPUT' as const,
        sourceReferenceId: DEX_FEE_REFERENCE_ID,
      },
      {
        category: 'BRIDGE' as const,
        assetRevisionId: USDC_REVISION_ID,
        amountAtomic: '2000000',
        deductionMode: 'DEDUCTED_FROM_OUTPUT' as const,
        sourceReferenceId: BRIDGE_FEE_REFERENCE_ID,
      },
      {
        category: 'PROVIDER' as const,
        assetRevisionId: USDC_REVISION_ID,
        amountAtomic: '3000000',
        deductionMode: 'ADDED_ON_TOP' as const,
        sourceReferenceId: PROVIDER_FEE_REFERENCE_ID,
      },
    ];
    const snapshot = calculateRoutingFeeSnapshotV1(
      calculationInput({ route: multiLegRoute(), passThroughComponents }),
    );

    expect(snapshot.components.map(({ category }) => category)).toEqual([
      'PLATFORM',
      'NETWORK',
      'DEX',
      'BRIDGE',
      'PROVIDER',
    ]);
    expect(snapshot.components.slice(1).map(({ amountAtomic }) => amountAtomic)).toEqual(
      passThroughComponents.map(({ amountAtomic }) => amountAtomic),
    );
    expect(snapshot.totalsByAsset).toEqual([
      { assetRevisionId: USDC_REVISION_ID, amountAtomic: '16000000' },
      { assetRevisionId: ETH_REVISION_ID, amountAtomic: '210000000000000' },
    ]);
  });

  it('uses exact bigint half-even, down, and up rounding at atomic-unit boundaries', () => {
    const twentyBasisPoints = { mantissa: '20', scale: 4 };
    const twelveBasisPoints = { mantissa: '12', scale: 4 };
    expect(calculateRoutingFeeAtomicAmount('250', twentyBasisPoints, 'HALF_EVEN')).toBe('0');
    expect(calculateRoutingFeeAtomicAmount('750', twentyBasisPoints, 'HALF_EVEN')).toBe('2');
    expect(calculateRoutingFeeAtomicAmount('1250', twelveBasisPoints, 'HALF_EVEN')).toBe('2');
    expect(calculateRoutingFeeAtomicAmount('3750', twelveBasisPoints, 'HALF_EVEN')).toBe('4');
    expect(calculateRoutingFeeAtomicAmount('750', twentyBasisPoints, 'DOWN')).toBe('1');
    expect(calculateRoutingFeeAtomicAmount('250', twentyBasisPoints, 'UP')).toBe('1');
    expect(
      calculateRoutingFeeAtomicAmount(
        MAX_ROUTING_FEE_ATOMIC_AMOUNT,
        { mantissa: '1', scale: 0 },
        'HALF_EVEN',
      ),
    ).toBe(MAX_ROUTING_FEE_ATOMIC_AMOUNT);
  });

  it('binds the resolved rule, normalized route, components, totals, and tier into a stable digest', () => {
    const first = calculateRoutingFeeSnapshotV1(calculationInput());
    const second = calculateRoutingFeeSnapshotV1(calculationInput());
    const changedTier = calculateRoutingFeeSnapshotV1(calculationInput({ tier: 'PRO' }));
    const changedRouteReference = calculateRoutingFeeSnapshotV1(
      calculationInput({ routeReferenceId: '76000000-0000-4000-8000-000000000099' }),
    );

    expect(first.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(second.fingerprintSha256).toBe(first.fingerprintSha256);
    expect(changedTier.fingerprintSha256).not.toBe(first.fingerprintSha256);
    expect(changedRouteReference.fingerprintSha256).not.toBe(first.fingerprintSha256);
    expectDeepFrozen(first);
  });

  it('keeps an old quote bound to its copied rule after later catalog input changes', () => {
    const mutableV1 = ruleInput({ effectiveUntil: '2026-09-01T00:00:00.000Z' }) as Record<
      string,
      unknown
    >;
    const mutableV2 = ruleInput({
      ruleReferenceId: RULE_V2_REFERENCE_ID,
      version: 2,
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveUntil: null,
    }) as Record<string, unknown>;
    const mutableCatalog = { schemaVersion: 1, rules: [mutableV1, mutableV2] };
    const oldSnapshot = calculateRoutingFeeSnapshotV1(calculationInput(), mutableCatalog);

    const platformRates = mutableV1.platformRates as Record<string, unknown>;
    const rates = platformRates.materialOrchestration as Record<string, unknown>;
    rates.FREE = { mantissa: '99', scale: 4 };
    mutableV1.version = 99;

    expect(oldSnapshot.rule.version).toBe(1);
    expect(oldSnapshot.rule.platformRates.materialOrchestration.FREE).toEqual({
      mantissa: '20',
      scale: 4,
    });
    expect(oldSnapshot.components[0]?.amountAtomic).toBe('10000000');
  });

  it('selects a new effective rule without rewriting an earlier snapshot', () => {
    const catalog = twoVersionCatalog();
    const before = calculateRoutingFeeSnapshotV1(calculationInput(), catalog);
    const after = calculateRoutingFeeSnapshotV1(
      calculationInput({ quotedAt: '2026-09-01T00:00:00.000Z' }),
      catalog,
    );

    expect(before.rule.version).toBe(1);
    expect(before.components[0]?.amountAtomic).toBe('10000000');
    expect(after.rule.version).toBe(2);
    expect(after.components[0]?.amountAtomic).toBe('12500000');
    expect(before.fingerprintSha256).not.toBe(after.fingerprintSha256);
  });

  it.each([
    ['unknown tier', { tier: 'ENTERPRISE' }],
    ['invalid quote id', { quoteReferenceId: 'quote-1' }],
    ['non-canonical quoted time', { quotedAt: '2026-08-25T12:00:00Z' }],
    ['zero fee base', { feeBase: { assetRevisionId: USDC_REVISION_ID, amountAtomic: '0' } }],
    [
      'leading-zero fee base',
      { feeBase: { assetRevisionId: USDC_REVISION_ID, amountAtomic: '01' } },
    ],
    ['decimal fee base', { feeBase: { assetRevisionId: USDC_REVISION_ID, amountAtomic: '1.5' } }],
    [
      'fee base overflow',
      {
        feeBase: {
          assetRevisionId: USDC_REVISION_ID,
          amountAtomic: `${MAX_ROUTING_FEE_ATOMIC_AMOUNT}0`,
        },
      },
    ],
  ])('rejects invalid calculation input: %s', (_label, override) => {
    expectCode(
      () => calculateRoutingFeeSnapshotV1(calculationInput(override as never)),
      _label.includes('base') ? 'INVALID_ATOMIC_AMOUNT' : 'INVALID_CALCULATION_INPUT',
    );
  });

  it('rejects platform injection and malformed pass-through evidence', () => {
    expectCode(
      () =>
        calculateRoutingFeeSnapshotV1(
          calculationInput({
            passThroughComponents: [
              {
                category: 'PLATFORM' as never,
                assetRevisionId: USDC_REVISION_ID,
                amountAtomic: '1',
                deductionMode: 'ADDED_ON_TOP',
                sourceReferenceId: PROVIDER_FEE_REFERENCE_ID,
              },
            ],
          }),
        ),
      'INVALID_FEE_COMPONENT',
    );
    expectCode(
      () =>
        calculateRoutingFeeSnapshotV1(
          calculationInput({
            passThroughComponents: [
              {
                category: 'PROVIDER',
                assetRevisionId: USDC_REVISION_ID,
                amountAtomic: '1',
                deductionMode: 'ADDED_ON_TOP',
                sourceReferenceId: 'provider-opaque-id',
              },
            ],
          }),
        ),
      'INVALID_FEE_COMPONENT',
    );
  });

  it('rejects more components than the ledger-aligned 32-line snapshot bound', () => {
    const passThroughComponents = Array.from({ length: 32 }, (_, index) => ({
      category: 'NETWORK' as const,
      assetRevisionId: ETH_REVISION_ID,
      amountAtomic: String(index),
      deductionMode: 'ADDED_ON_TOP' as const,
      sourceReferenceId: NETWORK_FEE_REFERENCE_ID,
    }));
    expectCode(
      () => calculateRoutingFeeSnapshotV1(calculationInput({ passThroughComponents })),
      'INVALID_FEE_COMPONENT',
    );
  });

  it('rejects an aggregate per-asset total above the exact atomic limit', () => {
    const fullRateCatalog = normalizeRoutingFeeRuleCatalogV1({
      schemaVersion: 1,
      rules: [
        ruleInput({
          platformRates: {
            directCompatible: { mantissa: '0', scale: 0 },
            materialOrchestration: {
              FREE: { mantissa: '1', scale: 0 },
              INDIVIDUAL: { mantissa: '1', scale: 0 },
              PRO: { mantissa: '1', scale: 0 },
            },
          },
        }),
      ],
    });
    expectCode(
      () =>
        calculateRoutingFeeSnapshotV1(
          calculationInput({
            feeBase: {
              assetRevisionId: USDC_REVISION_ID,
              amountAtomic: MAX_ROUTING_FEE_ATOMIC_AMOUNT,
            },
            passThroughComponents: [
              {
                category: 'PROVIDER',
                assetRevisionId: USDC_REVISION_ID,
                amountAtomic: '1',
                deductionMode: 'ADDED_ON_TOP',
                sourceReferenceId: PROVIDER_FEE_REFERENCE_ID,
              },
            ],
          }),
          fullRateCatalog,
        ),
      'NUMERIC_LIMIT_EXCEEDED',
    );
  });

  it('fails closed when no rule is effective at quote time', () => {
    expectCode(
      () =>
        calculateRoutingFeeSnapshotV1(calculationInput({ quotedAt: '2026-08-24T23:59:59.999Z' })),
      'NO_EFFECTIVE_RULE',
    );
  });

  it('rejects accessors, symbols, foreign prototypes, and throwing proxies without reading values', () => {
    const getter = jest.fn(() => 'FREE');
    const accessorInput = calculationInput();
    Object.defineProperty(accessorInput, 'tier', { enumerable: true, get: getter });
    expectCode(() => calculateRoutingFeeSnapshotV1(accessorInput), 'INVALID_CALCULATION_INPUT');
    expect(getter).not.toHaveBeenCalled();

    const symbolInput = calculationInput() as CalculateRoutingFeeSnapshotInput & {
      [key: symbol]: boolean;
    };
    symbolInput[Symbol('hidden')] = true;
    expectCode(() => calculateRoutingFeeSnapshotV1(symbolInput), 'INVALID_CALCULATION_INPUT');

    const foreignPrototype = Object.assign(Object.create({ inherited: true }), calculationInput());
    expectCode(() => calculateRoutingFeeSnapshotV1(foreignPrototype), 'INVALID_CALCULATION_INPUT');

    const throwingProxy = new Proxy(calculationInput(), {
      ownKeys: () => {
        throw new Error('untrusted proxy trap');
      },
    });
    expectCode(() => calculateRoutingFeeSnapshotV1(throwingProxy), 'INVALID_CALCULATION_INPUT');
  });
});
