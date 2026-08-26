import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDemoAllocationPlanner } from '../components/portfolio/local-demo-allocation-planner';
import { LocalDemoApiError, type LocalDemoApiClient } from '../lib/local-demo/local-demo-client';
import type {
  LocalDemoAllocationPreview,
  LocalDemoAllocationSelectionInput,
  LocalDemoYieldCatalog,
} from '../lib/local-demo/local-demo-yield';
import { BALANCED_PREVIEW, LOCAL_DEMO_YIELD_CATALOG } from './local-demo-yield.fixtures';

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

afterEach(() => cleanup());

describe('LocalDemoAllocationPlanner', () => {
  it('shows timestamped provider opportunities but no fee values before a selection', async () => {
    const harness = clientWith({});
    render(<LocalDemoAllocationPlanner client={harness.client} />);

    expect(
      await screen.findByRole('heading', { name: 'Observed Morpho markets' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Morpho Blue/u)).toHaveLength(3);
    expect(screen.getByText(/app makes no live provider request/u)).toBeInTheDocument();
    expect(screen.getByText(/risk has not been assessed/u)).toBeInTheDocument();
    expect(screen.getByText('Snapshot current')).toBeInTheDocument();
    expect(
      screen
        .getAllByText('Aug 26, 2026, 2:14 PM UTC')
        .find(
          (element) =>
            element.getAttribute('datetime') === LOCAL_DEMO_YIELD_CATALOG.snapshot.capturedAt,
        ),
    ).toBeDefined();
    expect(
      screen.getAllByLabelText('5.210504022183349 percent observed base annual percentage yield')
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByLabelText('1.7398639912427037 percent observed reward annual percentage rate'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/deposit and withdrawal status not verified/u).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('Available-to-borrow proxy')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /More liquid/u })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Balanced blend/u })).toBeEnabled();
    expect(screen.getByRole('button', { name: /More yield/u })).toBeEnabled();
    expect(screen.queryByText('Custom yield')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Local action-cost assumptions' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('[aria-label$="estimated fee"]')).toBeNull();
    expect(screen.queryByText('First net-positive day')).not.toBeInTheDocument();
    expect(harness.previewAllocation).not.toHaveBeenCalled();
  });

  it('sends a closed preset selection and reveals provider-derived yield plus local fee assumptions', async () => {
    const harness = clientWith({});
    render(<LocalDemoAllocationPlanner client={harness.client} />);
    const balanced = await screen.findByRole('button', { name: /Balanced blend/u });

    fireEvent.click(balanced);

    expect(harness.previewAllocation).toHaveBeenCalledWith(
      { kind: 'PRESET', presetId: 'BALANCED' },
      expect.any(AbortSignal),
    );
    const feeHeading = await screen.findByRole('heading', {
      name: 'Local action-cost assumptions',
    });
    expect(feeHeading).toBeInTheDocument();
    expect(
      screen.getByText('No user-authorized financial transaction was created.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/historical snapshot observations/u)).toBeInTheDocument();
    expect(screen.getByText(/testing assumptions, not Morpho charges/u)).toBeInTheDocument();
    const projection = screen
      .getByRole('heading', { name: 'Snapshot yield projection' })
      .closest('section');
    expect(projection).not.toBeNull();
    expect(
      within(projection!).getByLabelText('3.28 percent base annual percentage yield'),
    ).toBeInTheDocument();
    expect(within(projection!).getByLabelText('358 US dollars and 27 cents')).toHaveTextContent(
      '$358.27',
    );
    expect(
      within(projection!).getByLabelText('79 days until estimated net-positive'),
    ).toHaveTextContent('Day 79');
    expect(screen.getByLabelText('77 US dollars estimated fee')).toHaveTextContent('-$77.00');
    expect(screen.getByText(/1.73% reward APR excluded/u)).toBeInTheDocument();
  });

  it('retries an unavailable local snapshot in place', async () => {
    const readYieldCatalog = vi
      .fn()
      .mockRejectedValueOnce(new LocalDemoApiError('UNAVAILABLE'))
      .mockResolvedValueOnce(LOCAL_DEMO_YIELD_CATALOG);
    const harness = clientWith({ readYieldCatalog });
    render(<LocalDemoAllocationPlanner client={harness.client} />);

    expect(
      await screen.findByText(/local provider snapshot could not be validated/u),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry snapshot' }));

    expect(
      await screen.findByRole('heading', { name: 'Observed Morpho markets' }),
    ).toBeInTheDocument();
    expect(harness.readYieldCatalog).toHaveBeenCalledTimes(2);
  });

  it('automatically labels an open current snapshot stale at its boundary', async () => {
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
    const harness = clientWith({ catalog });
    render(<LocalDemoAllocationPlanner client={harness.client} />);

    expect(await screen.findByText('Snapshot current')).toBeInTheDocument();
    expect(
      await screen.findByText(/Archived snapshot.*stale/u, {}, { timeout: 1_000 }),
    ).toBeInTheDocument();
  });

  it('reconciles a current catalog to a stale preview while keeping it non-executable', async () => {
    const stalePreview: LocalDemoAllocationPreview = Object.freeze({
      ...BALANCED_PREVIEW,
      catalog: Object.freeze({ ...BALANCED_PREVIEW.catalog, freshness: 'STALE' }),
    });
    const harness = clientWith({
      previewAllocation: async () => stalePreview,
    });
    render(<LocalDemoAllocationPlanner client={harness.client} />);

    expect(await screen.findByText('Snapshot current')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Balanced blend/u }));
    expect(await screen.findByText('Archived snapshot · stale')).toBeInTheDocument();
    expect(await screen.findByText(/archived snapshot is stale/u)).toBeInTheDocument();
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
