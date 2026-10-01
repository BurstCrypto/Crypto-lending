import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartLendingPanel } from '../components/lending/smart-lending-panel';
import type { SmartLendingQuote } from '../lib/lending/smart-lending';

const SOL = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const ETH = 'eip155:1' as const;
afterEach(cleanup);
function quote(): SmartLendingQuote {
  return {
    id: 'test-quote',
    input: { sourceNetwork: SOL, amount: '100', holdingDays: 30, includeCrossChain: false },
    createdAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    selectedId: 'kamino',
    routes: [
      {
        id: 'aave',
        name: 'Aave V3',
        network: 'eip155:1',
        routeKind: 'CROSS_CHAIN',
        apyBasisPoints: '500',
        observedAt: Date.now(),
        source: 'https://app.aave.com/markets/',
        entryCostUsd: null,
        exitCostUsd: null,
        projectedYieldUsd: null,
        netBenefitUsd: null,
        breakEvenDays: null,
        reasons: ['Cross-chain routing is off.'],
        fundingReasons: [],
      },
      {
        id: 'kamino',
        name: 'Kamino',
        network: SOL,
        routeKind: 'SAME_CHAIN',
        apyBasisPoints: '400',
        observedAt: Date.now(),
        source: 'https://app.kamino.finance/lending',
        entryCostUsd: '2000000000000000',
        exitCostUsd: '500000000000000',
        projectedYieldUsd: '328000000000000000',
        netBenefitUsd: '325500000000000000',
        breakEvenDays: '1',
        reasons: [],
        fundingReasons: [],
      },
    ],
  };
}
const defaults = () => ({
  wallets: [{ network: SOL, balance: '200000000' }],
  connected: true,
  busy: false,
  depositsDisabled: false,
  onCompare: vi.fn(),
  onReview: vi.fn(),
});

describe('smart lending presentation', () => {
  it('shows a fresh available APY before entering an amount and never requests a wallet transaction to load it', () => {
    const props = defaults();
    const market = {
      apyBasisPoints: '400',
      observedAt: Date.now(),
      supplied: '0',
      shares: '0',
      capacity: null,
      available: true,
      entryCostNative: '5000',
      error: null,
    };
    render(
      <SmartLendingPanel
        {...props}
        quote={null}
        markets={[
          { ...market, id: 'kamino' },
          { ...market, id: 'jupiter', apyBasisPoints: '900', available: false },
          { ...market, id: 'save', apyBasisPoints: '800', observedAt: Date.now() - 180_000 },
          { ...market, id: 'aave', apyBasisPoints: '1200' },
        ]}
      />,
    );
    expect(screen.getByLabelText('Live lending APY')).toHaveTextContent('4.00%');
    expect(screen.queryByRole('button', { name: 'Find my lending plan' })).not.toBeInTheDocument();
    expect(props.onReview).not.toHaveBeenCalled();
    expect(props.onCompare).not.toHaveBeenCalled();
  });
  it('updates the estimate automatically while typing without requesting a transaction', async () => {
    const props = defaults();
    render(<SmartLendingPanel {...props} quote={null} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '100' } });
    expect(screen.queryByRole('button', { name: 'Find my lending plan' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(props.onCompare).toHaveBeenCalledWith({
        sourceNetwork: SOL,
        amount: '100',
        holdingDays: 30,
        includeCrossChain: false,
      }),
    );
    expect(screen.getByRole('checkbox')).toBeEnabled();
    expect(props.onReview).not.toHaveBeenCalled();
  });
  it.each([
    { network: SOL, missing: 'an Ethereum wallet' },
    { network: ETH, missing: 'a Solana wallet' },
  ])(
    'lets $network toggle bridging and explains the missing destination wallet',
    async ({ network, missing }) => {
      const props = { ...defaults(), wallets: [{ network, balance: '200000000' }] };
      const { rerender } = render(<SmartLendingPanel {...props} quote={null} />);
      const checkbox = screen.getByRole('checkbox', {
        name: 'Consider bridging if it improves the net return',
      });
      fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '2' } });
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
      expect(checkbox).toHaveAccessibleDescription(
        `Connect ${missing} before Smart Lending can recommend a bridge. You can still lend on your connected network.`,
      );
      expect(screen.getByRole('link', { name: `Connect ${missing}` })).toHaveAttribute(
        'href',
        '#wallets',
      );
      await waitFor(() =>
        expect(props.onCompare).toHaveBeenLastCalledWith({
          sourceNetwork: network,
          amount: '2',
          holdingDays: 30,
          includeCrossChain: true,
        }),
      );
      rerender(<SmartLendingPanel {...props} busy quote={null} />);
      expect(checkbox).toBeDisabled();
      rerender(<SmartLendingPanel {...props} quote={null} />);
      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
      await waitFor(() =>
        expect(props.onCompare).toHaveBeenLastCalledWith({
          sourceNetwork: network,
          amount: '2',
          holdingDays: 30,
          includeCrossChain: false,
        }),
      );
      expect(props.onReview).not.toHaveBeenCalled();
    },
  );
  it('shows one automatic plan without provider names or choices and reviews only its quote id', () => {
    const props = defaults();
    render(<SmartLendingPanel {...props} quote={quote()} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '100' } });
    expect(screen.getByRole('heading', { name: 'Lend 100 USDC' })).toBeInTheDocument();
    expect(screen.getByText('4.00%')).toBeInTheDocument();
    expect(screen.getByText('$0.33')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/Aave|Kamino/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View market' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review deposit' }));
    expect(props.onReview).toHaveBeenCalledExactlyOnceWith('test-quote');
  });
  it('invalidates the recommendation when its amount or holding period changes', () => {
    const props = defaults();
    render(<SmartLendingPanel {...props} quote={quote()} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '101' } });
    expect(screen.queryByRole('button', { name: 'Review deposit' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Updating');
    expect(props.onReview).not.toHaveBeenCalled();
  });
  it('invalidates a plan when the bridging preference changes', () => {
    const props = defaults();
    render(<SmartLendingPanel {...props} quote={quote()} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '100' } });
    expect(screen.getByRole('button', { name: 'Review deposit' })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.queryByRole('button', { name: 'Review deposit' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Updating');
    expect(props.onReview).not.toHaveBeenCalled();
  });
  it('shows missing funding and blocks deposit reviews while retaining the estimated return', () => {
    const props = defaults(),
      comparison = quote();
    comparison.routes[1]!.fundingReasons = ['The source wallet needs more USDC for this amount.'];
    render(<SmartLendingPanel {...props} quote={comparison} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '100' } });
    expect(screen.getByRole('button', { name: 'Review deposit' })).toBeDisabled();
    expect(screen.getByText('4.00%')).toBeInTheDocument();
    expect(screen.getByText(/needs additional funding/)).toBeInTheDocument();
    fireEvent.submit(screen.getByLabelText('USDC amount').closest('form')!);
    expect(props.onReview).not.toHaveBeenCalled();
  });
  it('refreshes an expired estimate automatically without requesting a signature', async () => {
    const props = defaults(),
      comparison = quote();
    comparison.expiresAt = Date.now() - 1;
    render(<SmartLendingPanel {...props} quote={comparison} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '100' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Updating'));
    expect(screen.queryByRole('button', { name: 'Review deposit' })).not.toBeInTheDocument();
    await waitFor(() => expect(props.onCompare).toHaveBeenCalled());
    expect(props.onReview).not.toHaveBeenCalled();
  });
  it('discloses a negative estimate while allowing the selected deposit to be reviewed', () => {
    const props = defaults(),
      comparison = quote();
    comparison.routes[1]!.netBenefitUsd = '-166453771306805781';
    render(<SmartLendingPanel {...props} quote={comparison} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '100' } });
    expect(screen.getByText('-$0.17')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('costs exceed the interest');
    const review = screen.getByRole('button', { name: 'Review deposit' });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    expect(props.onReview).toHaveBeenCalledExactlyOnceWith(comparison.id);
    expect(screen.queryByText(/Kamino|Aave/)).not.toBeInTheDocument();
  });
  it('shows the actual funding blocker when no deposit is available', () => {
    const props = defaults(),
      comparison = quote();
    comparison.selectedId = null;
    comparison.unavailableReason =
      'Your Solana wallet needs more SOL for the transaction fee and any new account rent. Your USDC amount does not cover these costs.';
    render(<SmartLendingPanel {...props} quote={comparison} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '100' } });
    expect(screen.getByRole('status')).toHaveTextContent(comparison.unavailableReason);
    expect(screen.queryByText(/suitable plan/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review deposit' })).not.toBeInTheDocument();
  });
  it('shows an exact sub-cent routing fee and total wallet debit separately from the cost estimates', () => {
    const comparison = quote();
    comparison.routes[1]!.routingFee = {
      basisPoints: 20,
      depositUsdc: '2000',
      estimatedReturnUsdc: '0',
      totalSourceDebitUsdc: '1002000',
    };
    comparison.input.amount = '1';
    render(<SmartLendingPanel {...defaults()} quote={comparison} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '1' } });
    expect(screen.getByText('Our routing fee (0.20%)')).toBeInTheDocument();
    expect(screen.getByText('0.002 USDC')).toBeInTheDocument();
    expect(screen.getByText('1.002 USDC')).toBeInTheDocument();
    expect(screen.getByText(/Routing fees are included in the cost estimates/)).toBeInTheDocument();
    expect(screen.queryByText('Estimated return routing fee')).not.toBeInTheDocument();
  });
  it('shows the same-chain 0.10% fee and full wallet debit', () => {
    const comparison = quote();
    comparison.routes[1]!.routingFee = {
      basisPoints: 10,
      depositUsdc: '100000',
      estimatedReturnUsdc: '0',
      totalSourceDebitUsdc: '100100000',
    };
    render(<SmartLendingPanel {...defaults()} quote={comparison} />);
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '100' } });
    expect(screen.getByText('Our routing fee (0.10%)')).toBeInTheDocument();
    expect(screen.getByText('0.1 USDC')).toBeInTheDocument();
    expect(screen.getByText('100.1 USDC')).toBeInTheDocument();
  });
});
