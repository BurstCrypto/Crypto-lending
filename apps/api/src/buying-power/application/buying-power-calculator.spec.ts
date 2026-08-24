import { BuyingPowerCalculationError, BuyingPowerCalculator } from './buying-power-calculator';
import type {
  BuyingPowerAdjustmentPort,
  BuyingPowerAdjustmentRequest,
  BuyingPowerClockPort,
} from './ports/buying-power-adjustment.ports';
import type { BuyingPowerCalculationRequest } from '../domain/buying-power';

const NOW = '2026-08-24T20:00:00.000Z';
const AS_OF = '2026-08-24T19:59:45.000Z';
const USD_SCALE_FACTOR = 10n ** 18n;

function usd(wholeDollars: number): string {
  return (BigInt(wholeDollars) * USD_SCALE_FACTOR).toString();
}

function contribution(
  contributionId: string,
  wholeDollars: number | null,
  overrides: Partial<BuyingPowerCalculationRequest['contributions'][number]> = {},
): BuyingPowerCalculationRequest['contributions'][number] {
  return {
    contributionId,
    walletId: `wallet-${contributionId}`,
    networkId: 'eip155:1',
    assetId: `asset-${contributionId}`,
    supported: true,
    freshness: 'CURRENT',
    valuationUse: 'CONSERVATIVE_REPORTING_ONLY',
    usdValueMantissa: wholeDollars === null ? null : usd(wholeDollars),
    asOf: AS_OF,
    ...overrides,
  };
}

function request(
  contributions: BuyingPowerCalculationRequest['contributions'],
): BuyingPowerCalculationRequest {
  return { portfolioSnapshotId: 'portfolio-snapshot-1', contributions };
}

function deductions(values: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    liquidity: '0',
    conversion: '0',
    slippage: '0',
    network: '0',
    routing: '0',
    ...values,
  };
}

interface AvailableAdjustmentFixture {
  readonly status: 'AVAILABLE';
  readonly quoteId: string;
  readonly contributionId: string;
  readonly quotedAt: string;
  readonly validUntil: string;
  readonly deductions: Record<string, string>;
}

function availableAdjustment(
  contributionId: string,
  values: Partial<Record<string, string>> = {},
): AvailableAdjustmentFixture {
  return {
    status: 'AVAILABLE',
    quoteId: `quote-${contributionId}`,
    contributionId,
    quotedAt: '2026-08-24T19:59:50.000Z',
    validUntil: '2026-08-24T20:00:30.000Z',
    deductions: deductions(values),
  };
}

class FakeAdjustmentPort implements BuyingPowerAdjustmentPort {
  readonly requests: BuyingPowerAdjustmentRequest[] = [];

  constructor(
    private readonly implementation: (request: BuyingPowerAdjustmentRequest) => unknown = (
      current,
    ) => availableAdjustment(current.contributionId),
  ) {}

  async evaluate(current: BuyingPowerAdjustmentRequest): Promise<unknown> {
    this.requests.push(current);
    return this.implementation(current);
  }
}

function calculator(
  adjustments: BuyingPowerAdjustmentPort,
  clock: BuyingPowerClockPort = { now: () => NOW },
): BuyingPowerCalculator {
  return new BuyingPowerCalculator(adjustments, clock);
}

describe('BuyingPowerCalculator', () => {
  it('calculates the exact $11,000 eligible breakdown and returns every deduction', async () => {
    const adjustments = new FakeAdjustmentPort((current) =>
      current.contributionId === 'treasury'
        ? availableAdjustment('treasury', {
            liquidity: usd(10),
            conversion: usd(5),
            slippage: usd(20),
            network: usd(15),
            routing: usd(10),
          })
        : availableAdjustment(current.contributionId),
    );
    const service = calculator(adjustments);

    const result = await service.calculate(
      request([
        contribution('treasury', 7_000),
        contribution('operations', 4_000, { networkId: 'solana:mainnet' }),
        contribution('stale-reserve', 500, { freshness: 'STALE' }),
        contribution('unsupported', 200, { supported: false }),
      ]),
    );

    expect(result).toMatchObject({
      supportedPortfolioValueMantissa: usd(11_500),
      eligibleGrossValueMantissa: usd(11_000),
      totalDeductionUsdMantissa: usd(60),
      availableBuyingPowerUsdMantissa: usd(10_940),
      availability: 'PARTIAL',
      unavailableReasons: ['STALE_DATA', 'UNSUPPORTED_ASSET'],
      usdScale: 18,
      use: 'LOCAL_DEMO_ESTIMATE_ONLY',
      mayAuthorizeFinancialAction: false,
    });
    expect(result.totalDeductions).toEqual({
      liquidity: usd(10),
      conversion: usd(5),
      slippage: usd(20),
      network: usd(15),
      routing: usd(10),
    });
    expect(adjustments.requests.map(({ contributionId }) => contributionId)).toEqual([
      'treasury',
      'operations',
    ]);
    expect(adjustments.requests.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.contributions)).toBe(true);
    expect(BigInt(result.availableBuyingPowerUsdMantissa)).toBeLessThanOrEqual(
      BigInt(result.supportedPortfolioValueMantissa),
    );
  });

  it('requires every explicit cost field instead of treating missing cost data as zero', async () => {
    const adjustments = new FakeAdjustmentPort((current) => {
      const response = availableAdjustment(current.contributionId) as {
        deductions: Record<string, string>;
      };
      delete response.deductions.network;
      return response;
    });

    const result = await calculator(adjustments).calculate(request([contribution('one', 100)]));

    expect(result).toMatchObject({
      availability: 'UNAVAILABLE',
      availableBuyingPowerUsdMantissa: '0',
      totalDeductionUsdMantissa: '0',
      unavailableReasons: ['INVALID_ADJUSTMENT_RESPONSE'],
    });
    expect(result.contributions[0]).toMatchObject({
      deductions: null,
      totalDeductionUsdMantissa: null,
      unavailableReasons: ['INVALID_ADJUSTMENT_RESPONSE'],
    });
  });

  it.each([
    {
      label: 'explicit missing network cost',
      implementation: (current: BuyingPowerAdjustmentRequest): unknown => ({
        status: 'UNAVAILABLE',
        contributionId: current.contributionId,
        reasons: ['NETWORK_COST_UNAVAILABLE'],
      }),
      reason: 'NETWORK_COST_UNAVAILABLE',
    },
    {
      label: 'adapter failure',
      implementation: (): never => {
        throw new Error('private route service failure');
      },
      reason: 'ADJUSTMENT_SOURCE_FAILED',
    },
    {
      label: 'deductions above gross value',
      implementation: (current: BuyingPowerAdjustmentRequest): unknown =>
        availableAdjustment(current.contributionId, { liquidity: usd(101) }),
      reason: 'ADJUSTMENTS_EXCEED_VALUE',
    },
  ])('fails one contribution closed for $label', async ({ implementation, reason }) => {
    const result = await calculator(new FakeAdjustmentPort(implementation)).calculate(
      request([contribution('one', 100)]),
    );

    expect(result.availability).toBe('UNAVAILABLE');
    expect(result.availableBuyingPowerUsdMantissa).toBe('0');
    expect(result.unavailableReasons).toEqual([reason]);
    expect(result.contributions[0]?.unavailableReasons).toEqual([reason]);
  });

  it('accepts an exact zero-cost result only when all five categories are present', async () => {
    const result = await calculator(new FakeAdjustmentPort()).calculate(
      request([contribution('one', 100)]),
    );

    expect(result).toMatchObject({
      availability: 'AVAILABLE',
      supportedPortfolioValueMantissa: usd(100),
      eligibleGrossValueMantissa: usd(100),
      totalDeductionUsdMantissa: '0',
      availableBuyingPowerUsdMantissa: usd(100),
      unavailableReasons: [],
    });
  });

  it('excludes stale, unpriced, unsupported, unavailable, and blocked values before adjustment', async () => {
    const adjustments = new FakeAdjustmentPort();
    const result = await calculator(adjustments).calculate(
      request([
        contribution('stale', 10, { freshness: 'STALE' }),
        contribution('unpriced', null),
        contribution('unsupported', 20, { supported: false }),
        contribution('unavailable', 30, { freshness: 'UNAVAILABLE' }),
        contribution('blocked', 40, { valuationUse: 'BLOCKED' }),
      ]),
    );

    expect(adjustments.requests).toEqual([]);
    expect(result).toMatchObject({
      supportedPortfolioValueMantissa: usd(80),
      eligibleGrossValueMantissa: '0',
      availableBuyingPowerUsdMantissa: '0',
      availability: 'UNAVAILABLE',
      unavailableReasons: [
        'STALE_DATA',
        'UNPRICED_ASSET',
        'UNSUPPORTED_ASSET',
        'SOURCE_UNAVAILABLE',
        'VALUATION_USE_BLOCKED',
      ],
    });
  });

  it.each([
    (current: BuyingPowerAdjustmentRequest): unknown => ({
      ...availableAdjustment(current.contributionId),
      contributionId: 'different',
    }),
    (current: BuyingPowerAdjustmentRequest): unknown => ({
      ...availableAdjustment(current.contributionId),
      validUntil: '2026-08-24T19:59:59.999Z',
    }),
    (current: BuyingPowerAdjustmentRequest): unknown => ({
      ...availableAdjustment(current.contributionId),
      unknown: true,
    }),
    (current: BuyingPowerAdjustmentRequest): unknown => ({
      status: 'UNAVAILABLE',
      contributionId: current.contributionId,
      reasons: ['ROUTE_UNAVAILABLE', 'ROUTE_UNAVAILABLE'],
    }),
  ])('rejects malformed, mismatched, expired, or ambiguous adjustment data %#', async (value) => {
    const result = await calculator(new FakeAdjustmentPort(value)).calculate(
      request([contribution('one', 100)]),
    );

    expect(result.unavailableReasons).toEqual(['INVALID_ADJUSTMENT_RESPONSE']);
    expect(result.availableBuyingPowerUsdMantissa).toBe('0');
  });

  it('returns a deterministic unavailable empty result without calling the adjustment port', async () => {
    const adjustments = new FakeAdjustmentPort();

    const result = await calculator(adjustments).calculate(request([]));

    expect(result).toMatchObject({
      supportedPortfolioValueMantissa: '0',
      eligibleGrossValueMantissa: '0',
      availableBuyingPowerUsdMantissa: '0',
      availability: 'UNAVAILABLE',
      unavailableReasons: ['NO_ELIGIBLE_CONTRIBUTIONS'],
      contributions: [],
    });
    expect(adjustments.requests).toEqual([]);
  });

  it.each([
    {
      portfolioSnapshotId: 'snapshot',
      contributions: [contribution('duplicate', 1), contribution('duplicate', 2)],
    },
    request([contribution('bad-value', 1, { usdValueMantissa: '01' })]),
    request([contribution('future', 1, { asOf: '2026-08-24T20:00:00.001Z' })]),
    { ...request([]), unknown: true },
  ])('rejects malformed portfolio input before any adjustment call %#', async (invalid) => {
    const adjustments = new FakeAdjustmentPort();

    await expect(calculator(adjustments).calculate(invalid)).rejects.toEqual(
      new BuyingPowerCalculationError('INVALID_REQUEST'),
    );
    expect(adjustments.requests).toEqual([]);
  });

  it('rejects accessors without invoking them', async () => {
    let invoked = false;
    const invalid: Record<string, unknown> = { portfolioSnapshotId: 'snapshot' };
    Object.defineProperty(invalid, 'contributions', {
      enumerable: true,
      get: () => {
        invoked = true;
        return [];
      },
    });

    await expect(calculator(new FakeAdjustmentPort()).calculate(invalid)).rejects.toEqual(
      new BuyingPowerCalculationError('INVALID_REQUEST'),
    );
    expect(invoked).toBe(false);
  });

  it('rejects aggregate overflow before invoking an adjustment source', async () => {
    const adjustments = new FakeAdjustmentPort();
    const maximum = '9'.repeat(96);

    await expect(
      calculator(adjustments).calculate(
        request([
          contribution('one', 1, { usdValueMantissa: maximum }),
          contribution('two', 1, { usdValueMantissa: maximum }),
        ]),
      ),
    ).rejects.toEqual(new BuyingPowerCalculationError('NUMERIC_LIMIT_EXCEEDED'));
    expect(adjustments.requests).toEqual([]);
  });

  it('fails closed when the trusted clock is malformed or unavailable', async () => {
    for (const now of [
      () => 'not-a-time',
      () => 123,
      () => {
        throw new Error('clock failed');
      },
    ]) {
      await expect(
        calculator(new FakeAdjustmentPort(), { now }).calculate(request([])),
      ).rejects.toEqual(new BuyingPowerCalculationError('CLOCK_FAILED'));
    }
  });
});
