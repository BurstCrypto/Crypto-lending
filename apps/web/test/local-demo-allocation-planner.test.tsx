import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDemoAllocationPlanner } from '../components/portfolio/local-demo-allocation-planner';
import type {
  LocalDemoAllocationPreview,
  LocalDemoApiClient,
} from '../lib/local-demo/local-demo-client';

const BALANCED_PREVIEW: LocalDemoAllocationPreview = Object.freeze({
  use: 'LOCAL_DEMO_ESTIMATE_ONLY',
  mayAuthorizeFinancialAction: false,
  preset: Object.freeze({
    id: 'BALANCED',
    label: 'Balanced blend',
    description: 'Split capital between ready access and diversified synthetic yield.',
  }),
  grossCapitalUsdMinor: '1100000',
  allocations: Object.freeze([
    Object.freeze({
      bucket: 'LIQUID_RESERVE',
      label: 'Liquid reserve',
      percentageBasisPoints: 3000,
      apyBasisPoints: 0,
      amountUsdMinor: '330000',
    }),
    Object.freeze({
      bucket: 'CONSERVATIVE_YIELD',
      label: 'Conservative yield',
      percentageBasisPoints: 4500,
      apyBasisPoints: 400,
      amountUsdMinor: '495000',
    }),
    Object.freeze({
      bucket: 'BALANCED_YIELD',
      label: 'Balanced yield',
      percentageBasisPoints: 2500,
      apyBasisPoints: 600,
      amountUsdMinor: '275000',
    }),
  ]),
  deductions: Object.freeze([
    Object.freeze({ code: 'LIQUIDITY', amountUsdMinor: '3850' }),
    Object.freeze({ code: 'CONVERSION', amountUsdMinor: '770' }),
    Object.freeze({ code: 'SLIPPAGE', amountUsdMinor: '770' }),
    Object.freeze({ code: 'NETWORK', amountUsdMinor: '770' }),
    Object.freeze({ code: 'ROUTING', amountUsdMinor: '1540' }),
  ]),
  totalFeesUsdMinor: '7700',
  netPlannedCapitalUsdMinor: '1092300',
  yieldProjection: Object.freeze({
    source: 'SYNTHETIC_FIXED_DEMO_RATES',
    calculationMethod: 'SIMPLE_DAILY_APY_PRORATION_ON_NET_CAPITAL',
    effectiveApyBasisPoints: 330,
    projectedAnnualYieldUsdMinor: '36045',
    projectedAnnualNetGrowthUsdMinor: '28345',
    breakEven: Object.freeze({ status: 'AVAILABLE', firstNetPositiveDay: 78 }),
  }),
  asOf: '2026-08-24T18:30:00.000Z',
});

function previewVariant(
  preset: Readonly<{
    id: 'MORE_LIQUID' | 'MORE_YIELD';
    label: string;
    description: string;
    percentages: readonly [number, number, number];
  }>,
  values: Readonly<{
    allocations: readonly [string, string, string];
    deductions: readonly [string, string, string, string, string];
    totalFees: string;
    netCapital: string;
    effectiveApy: number;
    annualYield: string;
    annualNetGrowth: string;
    firstDay: number;
  }>,
): LocalDemoAllocationPreview {
  return Object.freeze({
    ...BALANCED_PREVIEW,
    preset: Object.freeze({
      id: preset.id,
      label: preset.label,
      description: preset.description,
    }),
    allocations: Object.freeze(
      BALANCED_PREVIEW.allocations.map((allocation, index) =>
        Object.freeze({
          ...allocation,
          percentageBasisPoints: preset.percentages[index]!,
          amountUsdMinor: values.allocations[index]!,
        }),
      ),
    ),
    deductions: Object.freeze(
      BALANCED_PREVIEW.deductions.map((deduction, index) =>
        Object.freeze({ ...deduction, amountUsdMinor: values.deductions[index]! }),
      ),
    ),
    totalFeesUsdMinor: values.totalFees,
    netPlannedCapitalUsdMinor: values.netCapital,
    yieldProjection: Object.freeze({
      ...BALANCED_PREVIEW.yieldProjection,
      effectiveApyBasisPoints: values.effectiveApy,
      projectedAnnualYieldUsdMinor: values.annualYield,
      projectedAnnualNetGrowthUsdMinor: values.annualNetGrowth,
      breakEven: Object.freeze({ status: 'AVAILABLE', firstNetPositiveDay: values.firstDay }),
    }),
  });
}

const MORE_LIQUID_PREVIEW = previewVariant(
  {
    id: 'MORE_LIQUID',
    label: 'More liquid',
    description: 'Keep most capital readily available while adding a smaller yield allocation.',
    percentages: [6000, 3000, 1000],
  },
  {
    allocations: ['660000', '330000', '110000'],
    deductions: ['2200', '440', '440', '440', '880'],
    totalFees: '4400',
    netCapital: '1095600',
    effectiveApy: 180,
    annualYield: '19720',
    annualNetGrowth: '15320',
    firstDay: 82,
  },
);

const MORE_YIELD_PREVIEW = previewVariant(
  {
    id: 'MORE_YIELD',
    label: 'More yield',
    description: 'Put more capital toward synthetic yield while retaining a liquid reserve.',
    percentages: [1500, 3500, 5000],
  },
  {
    allocations: ['165000', '385000', '550000'],
    deductions: ['4675', '935', '935', '935', '1870'],
    totalFees: '9350',
    netCapital: '1090650',
    effectiveApy: 440,
    annualYield: '47988',
    annualNetGrowth: '38638',
    firstDay: 72,
  },
);

function clientWith(previewAllocation: ReturnType<typeof vi.fn>): LocalDemoApiClient {
  return { previewAllocation } as unknown as LocalDemoApiClient;
}

afterEach(() => cleanup());

describe('LocalDemoAllocationPlanner', () => {
  it('offers allocation and APY comparisons without showing fee amounts or timing while idle', () => {
    const previewAllocation = vi.fn();
    render(<LocalDemoAllocationPlanner client={clientWith(previewAllocation)} />);

    expect(
      screen.getByRole('heading', { name: 'Choose how to allocate your capital.' }),
    ).toBeInTheDocument();
    const moreLiquid = screen.getByRole('button', { name: /More liquid/u });
    const balanced = screen.getByRole('button', { name: /Balanced blend/u });
    const moreYield = screen.getByRole('button', { name: /More yield/u });
    expect(within(moreLiquid).getByText('60% allocated')).toBeInTheDocument();
    expect(within(moreLiquid).getByText('30% allocated')).toBeInTheDocument();
    expect(within(moreLiquid).getByText('10% allocated')).toBeInTheDocument();
    expect(within(balanced).getByText('30% allocated')).toBeInTheDocument();
    expect(within(balanced).getByText('45% allocated')).toBeInTheDocument();
    expect(within(balanced).getByText('25% allocated')).toBeInTheDocument();
    expect(within(moreYield).getByText('15% allocated')).toBeInTheDocument();
    expect(within(moreYield).getByText('35% allocated')).toBeInTheDocument();
    expect(within(moreYield).getByText('50% allocated')).toBeInTheDocument();
    expect(
      within(moreLiquid).getByLabelText('1.80 percent estimated annual percentage yield'),
    ).toHaveTextContent('1.80% APY');
    expect(
      within(balanced).getByLabelText('3.30 percent estimated annual percentage yield'),
    ).toHaveTextContent('3.30% APY');
    expect(
      within(moreYield).getByLabelText('4.40 percent estimated annual percentage yield'),
    ).toHaveTextContent('4.40% APY');
    for (const card of [moreLiquid, balanced, moreYield]) {
      expect(
        within(card).getByLabelText('0.00 percent estimated annual percentage yield'),
      ).toHaveTextContent('0.00% APY');
      expect(
        within(card).getByLabelText('4.00 percent estimated annual percentage yield'),
      ).toHaveTextContent('4.00% APY');
      expect(
        within(card).getByLabelText('6.00 percent estimated annual percentage yield'),
      ).toHaveTextContent('6.00% APY');
    }
    expect(screen.queryByText('Estimated fees for this blend')).not.toBeInTheDocument();
    expect(screen.queryByText('First net-positive day')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('$');
    expect(previewAllocation).not.toHaveBeenCalled();
  });

  it('highlights a selection and reveals exact allocations, fees, and reconciliation', async () => {
    const previewAllocation = vi.fn(async () => BALANCED_PREVIEW);
    render(<LocalDemoAllocationPlanner client={clientWith(previewAllocation)} />);
    const balanced = screen.getByRole('button', { name: /Balanced blend/u });

    fireEvent.click(balanced);

    expect(balanced).toHaveAttribute('aria-pressed', 'true');
    expect(previewAllocation).toHaveBeenCalledWith('BALANCED', expect.any(AbortSignal));
    expect(
      await screen.findByRole('heading', { name: 'Estimated fees for this blend' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No transaction was created.')).toBeInTheDocument();
    expect(screen.getByText(/cannot authorize a transfer, investment, loan/u)).toBeInTheDocument();
    expect(
      screen.getByText(/fixed synthetic demo rates and are not guaranteed/u),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('3,300 US dollars')).toHaveTextContent('$3,300.00');
    expect(screen.getByLabelText('4,950 US dollars')).toHaveTextContent('$4,950.00');
    expect(screen.getByLabelText('2,750 US dollars')).toHaveTextContent('$2,750.00');
    const allocationSection = screen
      .getByRole('heading', { name: 'Allocation amounts' })
      .closest('section');
    expect(allocationSection).not.toBeNull();
    for (const [label, apy] of [
      ['Liquid reserve', '0.00'],
      ['Conservative yield', '4.00'],
      ['Balanced yield', '6.00'],
    ] as const) {
      const row = within(allocationSection!).getByText(label).closest('li');
      expect(
        within(row!).getByLabelText(`${apy} percent estimated annual percentage yield`),
      ).toHaveTextContent(`${apy}% APY`);
    }
    expect(screen.getByLabelText('38 US dollars and 50 cents estimated fee')).toHaveTextContent(
      '-$38.50',
    );
    expect(screen.getByLabelText('77 US dollars estimated fee')).toHaveTextContent('-$77.00');
    expect(screen.getByLabelText('11,000 US dollars')).toHaveTextContent('$11,000.00');
    expect(screen.getByLabelText('10,923 US dollars')).toHaveTextContent('$10,923.00');
    const yieldProjection = screen
      .getByRole('heading', { name: 'Synthetic yield projection' })
      .closest('section');
    expect(yieldProjection).not.toBeNull();
    expect(
      within(yieldProjection!).getByLabelText('3.30 percent estimated annual percentage yield'),
    ).toHaveTextContent('3.30% APY');
    expect(
      within(yieldProjection!).getByLabelText('360 US dollars and 45 cents'),
    ).toHaveTextContent('$360.45');
    expect(
      within(yieldProjection!).getByLabelText('78 days until estimated net-positive'),
    ).toHaveTextContent('Day 78');
    expect(
      within(yieldProjection!).getByLabelText('283 US dollars and 45 cents'),
    ).toHaveTextContent('$283.45');
    expect(
      screen.getByText(/simple daily APY proration on net planned capital over 365 days/u),
    ).toBeInTheDocument();
    expect(screen.getByText('Aug 24, 2026, 6:30 PM UTC')).toHaveAttribute(
      'datetime',
      BALANCED_PREVIEW.asOf,
    );
  });

  it.each([
    {
      preview: MORE_LIQUID_PREVIEW,
      buttonName: /More liquid/u,
      apy: '1.80',
      annualYield: '197 US dollars and 20 cents',
      annualGrowth: '153 US dollars and 20 cents',
      day: 82,
    },
    {
      preview: MORE_YIELD_PREVIEW,
      buttonName: /More yield/u,
      apy: '4.40',
      annualYield: '479 US dollars and 88 cents',
      annualGrowth: '386 US dollars and 38 cents',
      day: 72,
    },
  ])(
    'renders the $preview.preset.label $11,000 yield projection exactly',
    async ({ preview, buttonName, apy, annualYield, annualGrowth, day }) => {
      render(<LocalDemoAllocationPlanner client={clientWith(vi.fn(async () => preview))} />);
      fireEvent.click(screen.getByRole('button', { name: buttonName }));
      const projection = (
        await screen.findByRole('heading', { name: 'Synthetic yield projection' })
      ).closest('section');

      expect(
        within(projection!).getByLabelText(`${apy} percent estimated annual percentage yield`),
      ).toHaveTextContent(`${apy}% APY`);
      expect(within(projection!).getByLabelText(annualYield)).toBeInTheDocument();
      expect(within(projection!).getByLabelText(annualGrowth)).toBeInTheDocument();
      expect(
        within(projection!).getByLabelText(`${day} days until estimated net-positive`),
      ).toHaveTextContent(`Day ${day}`);
    },
  );

  it('fails visibly without presenting unconfirmed financial values', async () => {
    const previewAllocation = vi.fn(async () => {
      throw new TypeError('private response detail');
    });
    render(<LocalDemoAllocationPlanner client={clientWith(previewAllocation)} />);
    fireEvent.click(screen.getByRole('button', { name: /More yield/u }));

    expect(
      await screen.findByText(/This allocation estimate could not be confirmed/u),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByText(/No transaction was created/u)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('$');
    expect(document.body.textContent).not.toContain('private response detail');
  });

  it('aborts an unfinished preview when it unmounts', async () => {
    let requestSignal: AbortSignal | undefined;
    const previewAllocation = vi.fn(
      async (_preset: string, signal?: AbortSignal): Promise<LocalDemoAllocationPreview> => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Request aborted', 'AbortError')),
            { once: true },
          );
        });
      },
    );
    const rendered = render(<LocalDemoAllocationPlanner client={clientWith(previewAllocation)} />);
    fireEvent.click(screen.getByRole('button', { name: /More yield/u }));
    await waitFor(() => expect(previewAllocation).toHaveBeenCalledTimes(1));

    rendered.unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
