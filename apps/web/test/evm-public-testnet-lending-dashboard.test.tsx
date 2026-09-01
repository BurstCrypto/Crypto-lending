import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EvmPublicTestnetLendingDashboard } from '../components/portfolio/evm-public-testnet-lending-dashboard';
import type { EvmPublicTestnetExecutionApi } from '../lib/evm-public-testnet/client';
import { EVM_PUBLIC_TESTNET_CHAIN_ID } from '../lib/evm-public-testnet/constants';
import { parseEvmPublicTestnetPositionSnapshot } from '../lib/evm-public-testnet/execution';
import {
  EVM_PUBLIC_TESTNET_ACCOUNT,
  evmPublicTestnetPositionResponse,
} from './evm-public-testnet.fixtures';

function apiWithPosition() {
  const snapshot = parseEvmPublicTestnetPositionSnapshot(evmPublicTestnetPositionResponse(), {
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: EVM_PUBLIC_TESTNET_ACCOUNT,
  });
  const queryPosition = vi.fn(async () => snapshot);
  const api = {
    prepare: vi.fn(),
    submit: vi.fn(),
    query: vi.fn(),
    queryPosition,
  } as unknown as EvmPublicTestnetExecutionApi;
  return { api, queryPosition };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EvmPublicTestnetLendingDashboard', () => {
  it('shows an empty read-only dashboard before an EVM wallet is known', () => {
    const createApi = vi.fn(() => {
      throw new Error('The dashboard must not query without an account');
    });

    render(<EvmPublicTestnetLendingDashboard account={null} createApi={createApi} />);

    const dashboard = screen.getByRole('region', { name: 'Your EVM testnet position' });
    expect(
      within(dashboard).getByText('Connect MetaMask or Coinbase Wallet to view this wallet.'),
    ).toBeInTheDocument();
    expect(within(dashboard).getByText(/refreshes are read-only/iu)).toBeInTheDocument();
    expect(within(dashboard).queryByText('Current Base Sepolia supply APY')).toBeNull();
    expect(createApi).not.toHaveBeenCalled();
  });

  it('labels the latest current APY without inventing a usual or historical rate', async () => {
    const harness = apiWithPosition();
    const snapshotChanged = vi.fn();

    render(
      <EvmPublicTestnetLendingDashboard
        account={EVM_PUBLIC_TESTNET_ACCOUNT}
        createApi={() => harness.api}
        onSnapshotChange={snapshotChanged}
      />,
    );

    const dashboard = screen.getByRole('region', { name: 'Your Base Sepolia position' });
    expect(await within(dashboard).findByText(/0\.00005000 ETH/u)).toBeInTheDocument();
    expect(within(dashboard).getByText('Current Base Sepolia supply APY')).toBeInTheDocument();
    expect(within(dashboard).getByText('1.57%')).toBeInTheDocument();
    expect(within(dashboard).getByText('Usual APY')).toBeInTheDocument();
    expect(within(dashboard).getByText('Not enough history')).toBeInTheDocument();
    expect(
      within(dashboard).getByText(
        /current variable rate, not a yield guarantee or historical average/iu,
      ),
    ).toBeInTheDocument();
    expect(
      within(dashboard).getByRole('link', { name: /View wallet on Base Sepolia Explorer/u }),
    ).toHaveAttribute(
      'href',
      `https://sepolia-explorer.base.org/address/${EVM_PUBLIC_TESTNET_ACCOUNT}`,
    );
    expect(harness.queryPosition).toHaveBeenCalledWith(
      { chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: EVM_PUBLIC_TESTNET_ACCOUNT },
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(snapshotChanged).toHaveBeenLastCalledWith(
        expect.objectContaining({ account: EVM_PUBLIC_TESTNET_ACCOUNT }),
      ),
    );
  });
});
