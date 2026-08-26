import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  CROSS_CHAIN_BALANCED_PREVIEW,
  LOCAL_DEMO_YIELD_CATALOG,
  MORE_LIQUID_PREVIEW,
  MORE_YIELD_PREVIEW,
} from './local-demo-yield.fixtures';

const PORTFOLIO_SNAPSHOT_ID = BALANCED_PREVIEW.portfolioSnapshotId;

function clientWith(options: {
  readonly catalog?: LocalDemoYieldCatalog;
  readonly readYieldCatalog?: (signal?: AbortSignal) => Promise<LocalDemoYieldCatalog>;
  readonly previewAllocation?: (
    portfolioSnapshotId: string,
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

function adjustedLiquidityPreview(
  preview: LocalDemoAllocationPreview,
  liquidReserveBasisPoints: number,
): LocalDemoAllocationPreview {
  const capital = BigInt(preview.capitalIncludedInProjectionUsdMinor);
  const managedBasisPoints = 10_000 - liquidReserveBasisPoints;
  const liquidProduct = capital * BigInt(liquidReserveBasisPoints);
  const managedProduct = capital * BigInt(managedBasisPoints);
  let liquidAmount = liquidProduct / 10_000n;
  let managedAmount = managedProduct / 10_000n;
  if (liquidAmount + managedAmount < capital) {
    if (liquidProduct % 10_000n >= managedProduct % 10_000n) liquidAmount += 1n;
    else managedAmount += 1n;
  }
  const percentage =
    liquidReserveBasisPoints % 100 === 0
      ? `${Math.floor(liquidReserveBasisPoints / 100)}%`
      : `${Math.floor(liquidReserveBasisPoints / 100)}.${String(liquidReserveBasisPoints % 100).padStart(2, '0')}%`;

  return Object.freeze({
    ...preview,
    selection: Object.freeze({
      ...preview.selection,
      description: `Keep ${percentage} readily available and allocate the remainder to the managed yield strategy.`,
      liquidReserveBasisPoints,
    }),
    allocations: Object.freeze([
      Object.freeze({
        ...preview.allocations[0]!,
        percentageBasisPoints: liquidReserveBasisPoints,
        amountUsdMinor: String(liquidAmount),
      }),
      Object.freeze({
        ...preview.allocations[1]!,
        percentageBasisPoints: managedBasisPoints,
        amountUsdMinor: String(managedAmount),
      }),
    ]),
    managedYieldComposition: Object.freeze([
      Object.freeze({
        ...preview.managedYieldComposition[0]!,
        percentageBasisPointsOfManagedYield: 10_000,
        amountUsdMinor: String(managedAmount),
      }),
      preview.managedYieldComposition[1]!,
    ]),
  });
}

afterEach(() => cleanup());

describe('LocalDemoAllocationPlanner', () => {
  it('shows only three product-owned plans and no fee amount before a selection', async () => {
    const harness = clientWith({});
    const rendered = render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

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
    expect(screen.getByText(/Starts at 60% readily available/u)).toBeInTheDocument();
    expect(screen.getByText(/Starts at 30% readily available/u)).toBeInTheDocument();
    expect(screen.getByText(/Starts at 15% readily available/u)).toBeInTheDocument();
    expect(screen.queryByText(/Custom yield/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('slider', {
        name: 'Share kept liquid after estimated one-time fees',
      }),
    ).not.toBeInTheDocument();
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
    const rendered = render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Balanced blend/u }));

    expect(harness.previewAllocation).toHaveBeenCalledWith(
      PORTFOLIO_SNAPSHOT_ID,
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 3_000 },
      expect.any(AbortSignal),
    );
    const feeHeading = await screen.findByRole('heading', { name: 'Estimated one-time fees' });
    const feeSection = feeHeading.closest('section');
    expect(feeSection).not.toBeNull();
    expect(within(feeSection!).getByText('Estimated network costs')).toBeInTheDocument();
    expect(within(feeSection!).getByLabelText('4 US dollars and 38 cents')).toHaveTextContent(
      '$4.38',
    );
    const conversionRow = within(feeSection!).getByText('Estimated conversion costs').closest('li');
    expect(conversionRow).not.toBeNull();
    expect(within(conversionRow!).getByLabelText('0 US dollars')).toHaveTextContent('$0.00');
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
    const slider = screen.getByRole('slider', {
      name: 'Share kept liquid after estimated one-time fees',
    });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '9500');
    expect(slider).toHaveAttribute('step', '500');
    expect(slider).toHaveValue('3000');
    expect(slider).toHaveAttribute('aria-valuetext', '30% kept liquid in the draft');
    expect(screen.getByText(/Current applied preview:/u)).toHaveTextContent(
      'Current applied preview: 30% liquid. Draft: 30% liquid · matches current preview.',
    );
    expect(screen.getByRole('button', { name: 'Update preview' })).toBeDisabled();
    expectProviderPrivate(rendered.container);
  });

  it('shows a provider-private native EVM and Solana blend only after selection', async () => {
    const harness = clientWith({
      previewAllocation: async () => CROSS_CHAIN_BALANCED_PREVIEW,
    });
    const rendered = render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={CROSS_CHAIN_BALANCED_PREVIEW.portfolioSnapshotId}
      />,
    );

    expect(
      screen.queryByRole('heading', { name: 'Managed allocation by ecosystem' }),
    ).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Balanced blend/u }));

    const composition = (
      await screen.findByRole('heading', { name: 'Managed allocation by ecosystem' })
    ).closest('section');
    expect(composition).not.toBeNull();
    expect(within(composition!).getByText('EVM managed yield')).toBeInTheDocument();
    expect(within(composition!).getByText('SVM managed yield')).toBeInTheDocument();
    expect(within(composition!).getByLabelText('63.64% of managed yield')).toHaveTextContent(
      '63.64%',
    );
    expect(within(composition!).getByLabelText('36.36% of managed yield')).toHaveTextContent(
      '36.36%',
    );
    const evmCard = within(composition!).getByText('EVM managed yield').closest('li');
    const svmCard = within(composition!).getByText('SVM managed yield').closest('li');
    expect(evmCard).not.toBeNull();
    expect(svmCard).not.toBeNull();
    expect(within(evmCard!).getByText('Managed amount')).toBeInTheDocument();
    expect(within(evmCard!).getByText('Source capital')).toBeInTheDocument();
    expect(within(evmCard!).getByLabelText('4,895 US dollars and 94 cents')).toHaveTextContent(
      '$4,895.94',
    );
    expect(within(evmCard!).getByLabelText('7,000 US dollars')).toHaveTextContent('$7,000.00');
    expect(within(svmCard!).getByLabelText('2,797 US dollars and 68 cents')).toHaveTextContent(
      '$2,797.68',
    );
    expect(within(svmCard!).getByLabelText('4,000 US dollars')).toHaveTextContent('$4,000.00');
    expect(
      within(composition!).getByText('No EVM-to-Solana transfer is modeled.'),
    ).toBeInTheDocument();
    expect(within(composition!).getByText(/Modeled EVM-to-Solana transfer/u)).toBeInTheDocument();
    expect(within(composition!).getByLabelText('0 US dollars')).toHaveTextContent('$0.00');
    const fees = screen
      .getByRole('heading', { name: 'Estimated one-time fees' })
      .closest('section');
    expect(within(fees!).getByText('Estimated EVM-Solana transfer costs')).toBeInTheDocument();
    expect(within(fees!).getByText(/No EVM-to-Solana principal transfer/u)).toBeInTheDocument();
    expect(
      screen.getByText(/EVM and Solana managed allocations are included/u),
    ).toBeInTheDocument();
    expectProviderPrivate(rendered.container);
  });

  it('changes the fee estimate with the selected product plan', async () => {
    const harness = clientWith({
      previewAllocation: async (_portfolioSnapshotId, selection) =>
        selection.presetId === 'MORE_LIQUID' ? MORE_LIQUID_PREVIEW : MORE_YIELD_PREVIEW,
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

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

  it('keeps a keyboard-adjusted liquidity draft separate until its preview is applied', async () => {
    const adjustedPreview = adjustedLiquidityPreview(MORE_LIQUID_PREVIEW, 3_500);
    let resolveUpdate: ((preview: LocalDemoAllocationPreview) => void) | undefined;
    const pendingUpdate = new Promise<LocalDemoAllocationPreview>((resolve) => {
      resolveUpdate = resolve;
    });
    let requestCount = 0;
    const harness = clientWith({
      previewAllocation: async () => {
        requestCount += 1;
        return requestCount === 1 ? MORE_LIQUID_PREVIEW : pendingUpdate;
      },
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /More liquid/u }));
    const slider = await screen.findByRole('slider', {
      name: 'Share kept liquid after estimated one-time fees',
    });
    expect(harness.previewAllocation).toHaveBeenNthCalledWith(
      1,
      PORTFOLIO_SNAPSHOT_ID,
      { kind: 'PRESET', presetId: 'MORE_LIQUID', liquidReserveBasisPoints: 6_000 },
      expect.any(AbortSignal),
    );
    expect(slider).toHaveValue('6000');
    expect(slider).toHaveAttribute('aria-valuetext', '60% kept liquid in the draft');
    slider.focus();
    expect(slider).toHaveFocus();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.change(slider, { target: { value: '3500' } });

    expect(slider).toHaveValue('3500');
    expect(slider).toHaveAttribute('aria-valuetext', '35% kept liquid in the draft');
    expect(screen.getByText('Draft 35%')).toBeInTheDocument();
    expect(screen.getByText(/Current applied preview:/u)).toHaveTextContent(
      /Current applied preview: 60% liquid.*Draft: 35% liquid.*not applied yet/u,
    );
    expect(screen.getByText(/^Keep 60% readily available/u)).toBeInTheDocument();
    expect(harness.previewAllocation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));
    await waitFor(() => expect(harness.previewAllocation).toHaveBeenCalledTimes(2));
    expect(harness.previewAllocation).toHaveBeenNthCalledWith(
      2,
      PORTFOLIO_SNAPSHOT_ID,
      { kind: 'PRESET', presetId: 'MORE_LIQUID', liquidReserveBasisPoints: 3_500 },
      expect.any(AbortSignal),
    );
    const adjustment = screen
      .getByRole('heading', { name: 'Fine-tune this preview' })
      .closest('section');
    expect(adjustment).toHaveAttribute('aria-busy', 'true');
    expect(slider).toBeDisabled();
    expect(screen.getByText(/^Keep 60% readily available/u)).toBeInTheDocument();
    expect(screen.getByText(/current applied preview remains visible/iu)).toBeInTheDocument();

    await act(async () => {
      resolveUpdate?.(adjustedPreview);
      await pendingUpdate;
    });

    expect(await screen.findByText(/^Keep 35% readily available/u)).toBeInTheDocument();
    expect(slider).toBeEnabled();
    expect(slider).toHaveValue('3500');
    expect(screen.getByText(/Current applied preview:/u)).toHaveTextContent(
      /Current applied preview: 35% liquid.*Draft: 35% liquid.*matches current preview/u,
    );
    expect(screen.getByRole('button', { name: 'Update preview' })).toBeDisabled();
    expect(screen.getByText(/recalculates this preview only/iu)).toBeInTheDocument();
    expect(screen.getByText(/moves no funds/iu)).toBeInTheDocument();
    expect(screen.getByText(/applied after modeled one-time fees/iu)).toBeInTheDocument();
  });

  it('retains the applied preview and changed draft when a liquidity update fails', async () => {
    let requestCount = 0;
    const harness = clientWith({
      previewAllocation: async () => {
        requestCount += 1;
        if (requestCount === 1) return MORE_LIQUID_PREVIEW;
        throw new LocalDemoApiError('UNAVAILABLE');
      },
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /More liquid/u }));
    const slider = await screen.findByRole('slider', {
      name: 'Share kept liquid after estimated one-time fees',
    });
    fireEvent.change(slider, { target: { value: '3500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/current applied preview has not changed/u);
    expect(alert).toHaveTextContent(/no funds were moved/u);
    expect(screen.getByText(/^Keep 60% readily available/u)).toBeInTheDocument();
    expect(screen.getByText(/Current applied preview:/u)).toHaveTextContent(
      /Current applied preview: 60% liquid.*Draft: 35% liquid.*not applied yet/u,
    );
    expect(slider).toHaveValue('3500');
    expect(screen.getByRole('button', { name: 'Update preview' })).toBeEnabled();
  });

  it('clears an applied preview and refreshes the portfolio when a liquidity update conflicts', async () => {
    const onPortfolioSnapshotChanged = vi.fn();
    let requestCount = 0;
    const harness = clientWith({
      previewAllocation: async () => {
        requestCount += 1;
        if (requestCount === 1) return MORE_LIQUID_PREVIEW;
        throw new LocalDemoApiError('PORTFOLIO_SNAPSHOT_CHANGED');
      },
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
        onPortfolioSnapshotChanged={onPortfolioSnapshotChanged}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /More liquid/u }));
    const slider = await screen.findByRole('slider', {
      name: 'Share kept liquid after estimated one-time fees',
    });
    fireEvent.change(slider, { target: { value: '3500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));

    expect(
      await screen.findByText(/connected-wallet portfolio changed before this preview completed/iu),
    ).toBeInTheDocument();
    expect(onPortfolioSnapshotChanged).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('slider', {
        name: 'Share kept liquid after estimated one-time fees',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Illustrative yield result' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /More liquid/u })).toHaveAttribute(
      'aria-pressed',
      'false',
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
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

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
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    expect(await screen.findByText(/managed rate set could not be validated/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry rates' }));

    expect(
      await screen.findByRole('heading', { name: 'Crypto Lending yield plans' }),
    ).toBeInTheDocument();
    expect(harness.readYieldCatalog).toHaveBeenCalledTimes(2);
  });

  it('clears selection and requests a portfolio refresh on a snapshot conflict', async () => {
    const onPortfolioSnapshotChanged = vi.fn();
    const harness = clientWith({
      previewAllocation: async () => {
        throw new LocalDemoApiError('PORTFOLIO_SNAPSHOT_CHANGED');
      },
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
        onPortfolioSnapshotChanged={onPortfolioSnapshotChanged}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Balanced blend/u }));

    expect(
      await screen.findByText(/connected-wallet portfolio changed before this preview completed/iu),
    ).toHaveAttribute('role', 'alert');
    expect(onPortfolioSnapshotChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Balanced blend/u })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.queryByRole('heading', { name: 'Managed allocation by ecosystem' }),
    ).not.toBeInTheDocument();
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
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

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

  it('aborts an applied-liquidity request and ignores a late response after unmount', async () => {
    const adjustedPreview = adjustedLiquidityPreview(MORE_LIQUID_PREVIEW, 3_500);
    let previewSignal: AbortSignal | undefined;
    let resolveLatePreview: ((preview: LocalDemoAllocationPreview) => void) | undefined;
    const latePreview = new Promise<LocalDemoAllocationPreview>((resolve) => {
      resolveLatePreview = resolve;
    });
    let requestCount = 0;
    const harness = clientWith({
      previewAllocation: async (_portfolioSnapshotId, _selection, signal) => {
        requestCount += 1;
        if (requestCount === 1) return MORE_LIQUID_PREVIEW;
        previewSignal = signal;
        return latePreview;
      },
    });
    const rendered = render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /More liquid/u }));
    const slider = await screen.findByRole('slider', {
      name: 'Share kept liquid after estimated one-time fees',
    });
    fireEvent.change(slider, { target: { value: '3500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));
    await waitFor(() => expect(harness.previewAllocation).toHaveBeenCalledTimes(2));

    rendered.unmount();

    expect(previewSignal?.aborted).toBe(true);
    await act(async () => {
      resolveLatePreview?.(adjustedPreview);
      await latePreview;
    });
    expect(harness.previewAllocation).toHaveBeenCalledTimes(2);
  });
});
