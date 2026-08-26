import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDemoAllocationPlanner } from '../components/portfolio/local-demo-allocation-planner';
import { LocalDemoApiError, type LocalDemoApiClient } from '../lib/local-demo/local-demo-client';
import type {
  LocalDemoAllocationPreview,
  LocalDemoAllocationSelectionInput,
  LocalDemoYieldCatalog,
} from '../lib/local-demo/local-demo-yield';
import {
  BALANCED_PREVIEW,
  LOCAL_DEMO_YIELD_CATALOG,
  MORE_LIQUID_PREVIEW,
  MORE_YIELD_PREVIEW,
} from './local-demo-yield.fixtures';

function clientWith(options: {
  readonly catalog?: LocalDemoYieldCatalog;
  readonly readYieldCatalog?: (signal?: AbortSignal) => Promise<LocalDemoYieldCatalog>;
  readonly previewAllocation?: (
    selection: LocalDemoAllocationSelectionInput,
    signal?: AbortSignal,
  ) => Promise<LocalDemoAllocationPreview>;
}) {
  const readYieldCatalog = vi.fn(
    options.readYieldCatalog ?? (async () => options.catalog ?? LOCAL_DEMO_YIELD_CATALOG),
  );
  const previewAllocation = vi.fn(options.previewAllocation ?? (async () => BALANCED_PREVIEW));
  return {
    client: { readYieldCatalog, previewAllocation } as unknown as LocalDemoApiClient,
    previewAllocation,
    readYieldCatalog,
  };
}

function expectProviderPrivate(container: HTMLElement): void {
  const visibleAndAccessibleText = container.textContent ?? '';
  expect(visibleAndAccessibleText).not.toMatch(
    /morpho|ethereum|\bbase\b|eip155:|api\.morpho|cbBTC|WETH|USD3|0x[0-9a-f]{40}/iu,
  );
}

afterEach(() => cleanup());

describe('LocalDemoAllocationPlanner', () => {
  it('shows only three product-owned plans and no fee amount before a selection', async () => {
    const harness = clientWith({});
    const rendered = render(<LocalDemoAllocationPlanner client={harness.client} />);

    expect(
      await screen.findByRole('heading', { name: 'Crypto Lending yield plans' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Rates current')).toBeInTheDocument();
    expect(screen.getByText(/make no live external request/u)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Allocation plans' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /More liquid/u })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Balanced blend/u })).toBeEnabled();
    expect(screen.getByRole('button', { name: /More yield/u })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: /Preview plan/u })).toHaveLength(3);
    expect(screen.queryByText(/Custom yield/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Estimated one-time fees' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/u)).not.toBeInTheDocument();
    expect(screen.queryByText('First positive day after estimated fees')).not.toBeInTheDocument();
    expectProviderPrivate(rendered.container);
    expect(harness.previewAllocation).not.toHaveBeenCalled();
  });

  it('shows aggregate variable fees and the exact first-positive day only after selection', async () => {
    const harness = clientWith({});
    const rendered = render(<LocalDemoAllocationPlanner client={harness.client} />);

    fireEvent.click(await screen.findByRole('button', { name: /Balanced blend/u }));

    expect(harness.previewAllocation).toHaveBeenCalledWith(
      { kind: 'PRESET', presetId: 'BALANCED' },
      expect.any(AbortSignal),
    );
    const feeHeading = await screen.findByRole('heading', { name: 'Estimated one-time fees' });
    const feeSection = feeHeading.closest('section');
    expect(feeSection).not.toBeNull();
    expect(within(feeSection!).getByText('Estimated network costs')).toBeInTheDocument();
    expect(within(feeSection!).getByLabelText('4 US dollars and 38 cents')).toHaveTextContent(
      '$4.38',
    );
    expect(within(feeSection!).getByText('Estimated conversion costs')).toBeInTheDocument();
    expect(within(feeSection!).getByLabelText('0 US dollars')).toHaveTextContent('$0.00');
    expect(within(feeSection!).getByText('Estimated market impact')).toBeInTheDocument();
    expect(within(feeSection!).getByLabelText('1 US dollar and 15 cents')).toHaveTextContent(
      '$1.15',
    );
    expect(within(feeSection!).getByText('Estimated routing fee')).toBeInTheDocument();
    expect(within(feeSection!).getByLabelText('0 US dollars and 60 cents')).toHaveTextContent(
      '$0.60',
    );
    expect(within(feeSection!).getByLabelText('6 US dollars and 13 cents')).toHaveTextContent(
      '$6.13',
    );
    expect(within(feeSection!).getByText(/Actual local operation: \$0/u)).toBeInTheDocument();
    expect(
      within(feeSection!).getByText(/Public execution costs:\s*unquoted/iu),
    ).toBeInTheDocument();

    const projection = screen
      .getByRole('heading', { name: 'Illustrative yield result' })
      .closest('section');
    expect(projection).not.toBeNull();
    expect(
      within(projection!).getByLabelText('3.28 percent estimated annual percentage yield'),
    ).toHaveTextContent('3.28%');
    expect(within(projection!).getByLabelText('229 US dollars and 73 cents')).toHaveTextContent(
      '$229.73',
    );
    expect(within(projection!).getByLabelText('223 US dollars and 60 cents')).toHaveTextContent(
      '$223.60',
    );
    expect(
      within(projection!).getByLabelText(
        'First positive whole-cent yield after estimated fees is day 10',
      ),
    ).toHaveTextContent('Day 10');
    expect(BALANCED_PREVIEW.yieldProjection.firstPositiveDayAfterFees.day).toBe(
      Math.ceil((614 * 365) / 22_973),
    );
    expect(screen.getByText('Liquid reserve', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Managed yield', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/preview ready.*\$6\.13/iu)).toBeInTheDocument();
    expectProviderPrivate(rendered.container);
  });

  it('changes the fee estimate with the selected product plan', async () => {
    const harness = clientWith({
      previewAllocation: async (selection) =>
        selection.presetId === 'MORE_LIQUID' ? MORE_LIQUID_PREVIEW : MORE_YIELD_PREVIEW,
    });
    render(<LocalDemoAllocationPlanner client={harness.client} />);

    fireEvent.click(await screen.findByRole('button', { name: /More liquid/u }));
    let feeSection = (
      await screen.findByRole('heading', { name: 'Estimated one-time fees' })
    ).closest('section');
    expect(within(feeSection!).getByLabelText('4 US dollars and 52 cents')).toHaveTextContent(
      '$4.52',
    );
    expect(screen.getByLabelText(/first positive whole-cent yield.*day 13/iu)).toHaveTextContent(
      'Day 13',
    );

    fireEvent.click(screen.getByRole('button', { name: /More yield/u }));
    await waitFor(() => expect(harness.previewAllocation).toHaveBeenCalledTimes(2));
    feeSection = (await screen.findByRole('heading', { name: 'Estimated one-time fees' })).closest(
      'section',
    );
    expect(within(feeSection!).getByLabelText('6 US dollars and 94 cents')).toHaveTextContent(
      '$6.94',
    );
    expect(screen.getByLabelText(/first positive whole-cent yield.*day 10/iu)).toHaveTextContent(
      'Day 10',
    );
  });

  it('renders explicit no-yield and beyond-horizon first-positive states', async () => {
    const noYield: LocalDemoAllocationPreview = Object.freeze({
      ...BALANCED_PREVIEW,
      yieldProjection: Object.freeze({
        ...BALANCED_PREVIEW.yieldProjection,
        effectiveApyBasisPoints: 0,
        projectedAnnualYieldUsdMinor: '0',
        projectedAnnualYieldAfterFeesUsdMinor: '-613',
        firstPositiveDayAfterFees: Object.freeze({
          ...BALANCED_PREVIEW.yieldProjection.firstPositiveDayAfterFees,
          status: 'NO_PROJECTED_YIELD',
          day: null,
        }),
      }),
    });
    const beyondHorizon: LocalDemoAllocationPreview = Object.freeze({
      ...MORE_LIQUID_PREVIEW,
      yieldProjection: Object.freeze({
        ...MORE_LIQUID_PREVIEW.yieldProjection,
        effectiveApyBasisPoints: 1,
        projectedAnnualYieldUsdMinor: '100',
        projectedAnnualYieldAfterFeesUsdMinor: '-352',
        firstPositiveDayAfterFees: Object.freeze({
          ...MORE_LIQUID_PREVIEW.yieldProjection.firstPositiveDayAfterFees,
          status: 'NOT_RECOVERED_WITHIN_HORIZON',
          day: null,
        }),
      }),
    });
    const previews = [noYield, beyondHorizon];
    const harness = clientWith({ previewAllocation: async () => previews.shift()! });
    render(<LocalDemoAllocationPlanner client={harness.client} />);

    fireEvent.click(await screen.findByRole('button', { name: /Balanced blend/u }));
    expect(await screen.findByText('No projected yield')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /More liquid/u }));
    expect(await screen.findByText('Not within 1 year')).toBeInTheDocument();
  });

  it('retries an unavailable managed rate set in place', async () => {
    const readYieldCatalog = vi
      .fn()
      .mockRejectedValueOnce(new LocalDemoApiError('UNAVAILABLE'))
      .mockResolvedValueOnce(LOCAL_DEMO_YIELD_CATALOG);
    const harness = clientWith({ readYieldCatalog });
    render(<LocalDemoAllocationPlanner client={harness.client} />);

    expect(await screen.findByText(/managed rate set could not be validated/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry rates' }));

    expect(
      await screen.findByRole('heading', { name: 'Crypto Lending yield plans' }),
    ).toBeInTheDocument();
    expect(harness.readYieldCatalog).toHaveBeenCalledTimes(2);
  });

  it('labels rates stale at their boundary and reconciles a stale preview', async () => {
    const now = Date.now();
    const catalog: LocalDemoYieldCatalog = Object.freeze({
      ...LOCAL_DEMO_YIELD_CATALOG,
      snapshot: Object.freeze({
        ...LOCAL_DEMO_YIELD_CATALOG.snapshot,
        capturedAt: new Date(now - 1_000).toISOString(),
        staleAfter: new Date(now + 100).toISOString(),
        freshness: 'CURRENT',
      }),
    });
    const preview: LocalDemoAllocationPreview = Object.freeze({
      ...BALANCED_PREVIEW,
      rateSnapshot: Object.freeze({
        ...BALANCED_PREVIEW.rateSnapshot,
        capturedAt: catalog.snapshot.capturedAt,
        staleAfter: catalog.snapshot.staleAfter,
        freshness: 'STALE',
      }),
    });
    const harness = clientWith({ catalog, previewAllocation: async () => preview });
    render(<LocalDemoAllocationPlanner client={harness.client} />);

    expect(await screen.findByText('Rates current')).toBeInTheDocument();
    expect(
      await screen.findByText(/Archived rates.*stale/u, {}, { timeout: 1_000 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Balanced blend/u }));
    expect(await screen.findByText(/managed rate set is stale/u)).toBeInTheDocument();
    expect(
      screen.getByText('No user-authorized financial transaction was created.'),
    ).toBeInTheDocument();
  });

  it('aborts catalog and preview requests when unmounted', async () => {
    let previewSignal: AbortSignal | undefined;
    const harness = clientWith({
      previewAllocation: async (_selection, signal) => {
        previewSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Request aborted', 'AbortError')),
            { once: true },
          );
        });
      },
    });
    const rendered = render(<LocalDemoAllocationPlanner client={harness.client} />);
    fireEvent.click(await screen.findByRole('button', { name: /More yield/u }));
    await waitFor(() => expect(harness.previewAllocation).toHaveBeenCalledTimes(1));

    rendered.unmount();

    expect(previewSignal?.aborted).toBe(true);
  });
});
