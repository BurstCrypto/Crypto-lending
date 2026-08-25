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
      amountUsdMinor: '330000',
    }),
    Object.freeze({
      bucket: 'CONSERVATIVE_YIELD',
      label: 'Conservative yield',
      percentageBasisPoints: 4500,
      amountUsdMinor: '495000',
    }),
    Object.freeze({
      bucket: 'BALANCED_YIELD',
      label: 'Balanced yield',
      percentageBasisPoints: 2500,
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
  asOf: '2026-08-24T18:30:00.000Z',
});

function clientWith(previewAllocation: ReturnType<typeof vi.fn>): LocalDemoApiClient {
  return { previewAllocation } as unknown as LocalDemoApiClient;
}

afterEach(() => cleanup());

describe('LocalDemoAllocationPlanner', () => {
  it('offers three accessible blends without showing fee amounts while idle', () => {
    const previewAllocation = vi.fn();
    render(<LocalDemoAllocationPlanner client={clientWith(previewAllocation)} />);

    expect(
      screen.getByRole('heading', { name: 'Choose how to allocate your capital.' }),
    ).toBeInTheDocument();
    const moreLiquid = screen.getByRole('button', { name: /More liquid/u });
    const balanced = screen.getByRole('button', { name: /Balanced blend/u });
    const moreYield = screen.getByRole('button', { name: /More yield/u });
    expect(within(moreLiquid).getByText('60%')).toBeInTheDocument();
    expect(within(moreLiquid).getByText('30%')).toBeInTheDocument();
    expect(within(moreLiquid).getByText('10%')).toBeInTheDocument();
    expect(within(balanced).getByText('30%')).toBeInTheDocument();
    expect(within(balanced).getByText('45%')).toBeInTheDocument();
    expect(within(balanced).getByText('25%')).toBeInTheDocument();
    expect(within(moreYield).getByText('15%')).toBeInTheDocument();
    expect(within(moreYield).getByText('35%')).toBeInTheDocument();
    expect(within(moreYield).getByText('50%')).toBeInTheDocument();
    expect(screen.queryByText('Estimated fees for this blend')).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('3,300 US dollars')).toHaveTextContent('$3,300.00');
    expect(screen.getByLabelText('4,950 US dollars')).toHaveTextContent('$4,950.00');
    expect(screen.getByLabelText('2,750 US dollars')).toHaveTextContent('$2,750.00');
    expect(screen.getByLabelText('38 US dollars and 50 cents estimated fee')).toHaveTextContent(
      '-$38.50',
    );
    expect(screen.getByLabelText('77 US dollars estimated fee')).toHaveTextContent('-$77.00');
    expect(screen.getByLabelText('11,000 US dollars')).toHaveTextContent('$11,000.00');
    expect(screen.getByLabelText('10,923 US dollars')).toHaveTextContent('$10,923.00');
    expect(screen.getByText('Aug 24, 2026, 6:30 PM UTC')).toHaveAttribute(
      'datetime',
      BALANCED_PREVIEW.asOf,
    );
  });

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
