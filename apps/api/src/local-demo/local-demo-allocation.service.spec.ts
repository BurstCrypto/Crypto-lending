import { parseAccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import { LocalDemoAllocationService } from './local-demo-allocation.service';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const CORRELATION: JobCorrelationContext = Object.freeze({
  correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  initiatorActorId: ACCOUNT_ID,
});
const AS_OF = '2026-08-24T18:30:00.000Z';

function fixture(grossCapitalUsdMinor = '1100000'): Readonly<{
  service: LocalDemoAllocationService;
  read: jest.Mock;
}> {
  const read = jest.fn(async () => ({
    asOf: AS_OF,
    portfolioValueUsdMinor: '1100000',
    buyingPower: { status: 'AVAILABLE', amountUsdMinor: grossCapitalUsdMinor },
  }));
  return {
    service: new LocalDemoAllocationService({ read } as never),
    read,
  };
}

describe('LocalDemoAllocationService', () => {
  it.each([
    [
      'MORE_LIQUID',
      'More liquid',
      'Keep most capital readily available while adding a smaller yield allocation.',
      [
        ['LIQUID_RESERVE', 'Liquid reserve', 6_000, '660000'],
        ['CONSERVATIVE_YIELD', 'Conservative yield', 3_000, '330000'],
        ['BALANCED_YIELD', 'Balanced yield', 1_000, '110000'],
      ],
      ['2200', '440', '440', '440', '880'],
      '4400',
      '1095600',
    ],
    [
      'BALANCED',
      'Balanced blend',
      'Split capital between ready access and diversified synthetic yield.',
      [
        ['LIQUID_RESERVE', 'Liquid reserve', 3_000, '330000'],
        ['CONSERVATIVE_YIELD', 'Conservative yield', 4_500, '495000'],
        ['BALANCED_YIELD', 'Balanced yield', 2_500, '275000'],
      ],
      ['3850', '770', '770', '770', '1540'],
      '7700',
      '1092300',
    ],
    [
      'MORE_YIELD',
      'More yield',
      'Put more capital toward synthetic yield while retaining a liquid reserve.',
      [
        ['LIQUID_RESERVE', 'Liquid reserve', 1_500, '165000'],
        ['CONSERVATIVE_YIELD', 'Conservative yield', 3_500, '385000'],
        ['BALANCED_YIELD', 'Balanced yield', 5_000, '550000'],
      ],
      ['4675', '935', '935', '935', '1870'],
      '9350',
      '1090650',
    ],
  ] as const)(
    'returns an exact deterministic %s preview without performing external I/O',
    async (
      presetId,
      presetLabel,
      presetDescription,
      expectedAllocations,
      expectedDeductions,
      totalFees,
      netCapital,
    ) => {
      const { service, read } = fixture();
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
        throw new Error('network access is forbidden in allocation previews');
      });

      try {
        const result = await service.preview(ACCOUNT_ID, CORRELATION, presetId);

        expect(read).toHaveBeenCalledWith(ACCOUNT_ID, CORRELATION);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result).toMatchObject({
          use: 'LOCAL_DEMO_ESTIMATE_ONLY',
          mayAuthorizeFinancialAction: false,
          preset: { id: presetId, label: presetLabel, description: presetDescription },
          grossCapitalUsdMinor: '1100000',
          totalFeesUsdMinor: totalFees,
          netPlannedCapitalUsdMinor: netCapital,
          asOf: AS_OF,
        });
        expect(
          result.allocations.map(({ bucket, label, percentageBasisPoints, amountUsdMinor }) => [
            bucket,
            label,
            percentageBasisPoints,
            amountUsdMinor,
          ]),
        ).toEqual(expectedAllocations);
        expect(result.deductions.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual(
          expectedDeductions,
        );
        expect(result.deductions.map(({ code }) => code)).toEqual([
          'LIQUIDITY',
          'CONVERSION',
          'SLIPPAGE',
          'NETWORK',
          'ROUTING',
        ]);
        expect(Object.keys(result)).toEqual([
          'use',
          'mayAuthorizeFinancialAction',
          'preset',
          'grossCapitalUsdMinor',
          'allocations',
          'deductions',
          'totalFeesUsdMinor',
          'netPlannedCapitalUsdMinor',
          'asOf',
        ]);
        expect(
          result.allocations.reduce(
            (total, allocation) => total + BigInt(allocation.amountUsdMinor),
            0n,
          ),
        ).toBe(BigInt(result.grossCapitalUsdMinor));
        expect(
          result.deductions.reduce(
            (total, deduction) => total + BigInt(deduction.amountUsdMinor),
            0n,
          ),
        ).toBe(BigInt(result.totalFeesUsdMinor));
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.allocations)).toBe(true);
      } finally {
        fetchSpy.mockRestore();
      }
    },
  );

  it('uses eligible current buying power rather than excluded portfolio value', async () => {
    const { service } = fixture('900000');

    const result = await service.preview(ACCOUNT_ID, CORRELATION, 'BALANCED');

    expect(result.grossCapitalUsdMinor).toBe('900000');
    expect(result.allocations.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual([
      '270000',
      '405000',
      '225000',
    ]);
    expect(result.totalFeesUsdMinor).toBe('6300');
    expect(result.netPlannedCapitalUsdMinor).toBe('893700');
  });

  it('uses stable largest-remainder allocation for indivisible cents', async () => {
    const { service } = fixture('10001');

    const result = await service.preview(ACCOUNT_ID, CORRELATION, 'BALANCED');

    expect(result.allocations.map(({ amountUsdMinor }) => amountUsdMinor)).toEqual([
      '3000',
      '4501',
      '2500',
    ]);
    expect(result.allocations.map(({ amountUsdMinor }) => BigInt(amountUsdMinor))).toEqual(
      expect.arrayContaining([3000n, 4501n, 2500n]),
    );
  });
});
