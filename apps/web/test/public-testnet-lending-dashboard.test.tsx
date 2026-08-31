import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublicTestnetLendingDashboard } from '../components/portfolio/public-testnet-lending-dashboard';
import {
  PublicTestnetApiError,
  type PublicTestnetExecutionApi,
} from '../lib/public-testnet/public-testnet-client';
import {
  PUBLIC_TESTNET_ACCOUNT,
  publicTestnetIntent,
  publicTestnetPosition,
  publicTestnetSubmission,
} from './public-testnet.fixtures';

function api(readPosition: PublicTestnetExecutionApi['readPosition']): PublicTestnetExecutionApi {
  return {
    createIntent: vi.fn(async () => publicTestnetIntent()),
    submitTransaction: vi.fn(async () => publicTestnetSubmission()),
    submitSignedTransaction: vi.fn(async () => publicTestnetSubmission()),
    readPosition,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PublicTestnetLendingDashboard', () => {
  it('does not assume a position before a wallet has authorized the read-only account view', () => {
    const readPosition = vi.fn(async () => publicTestnetPosition());

    render(<PublicTestnetLendingDashboard account={null} createApi={() => api(readPosition)} />);

    expect(screen.getByText('Connect Phantom to view this wallet.')).toBeInTheDocument();
    expect(screen.queryByText(/0\.010000 SOL/u)).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
    expect(readPosition).not.toHaveBeenCalled();
  });

  it('shows the current supplied estimate and separates latest APY from a usual rate', async () => {
    const readPosition = vi.fn(async () => publicTestnetPosition());
    const positionApi = api(readPosition);

    render(
      <PublicTestnetLendingDashboard
        account={PUBLIC_TESTNET_ACCOUNT}
        createApi={() => positionApi}
      />,
    );

    expect(await screen.findByText('≈0.010000 SOL')).toBeInTheDocument();
    expect(screen.getByText('1.25%')).toBeInTheDocument();
    expect(screen.getByText('Not enough history')).toBeInTheDocument();
    expect(screen.getByText('0.009407374 cSOL')).toBeInTheDocument();
    expect(screen.getByText('32.28%')).toBeInTheDocument();
    expect(screen.getByText(/marked its latest reserve state stale/iu)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View wallet on Devnet Explorer/iu })).toHaveAttribute(
      'href',
      expect.stringContaining(`${PUBLIC_TESTNET_ACCOUNT}?cluster=devnet`),
    );
    expect(readPosition).toHaveBeenCalledWith(
      expect.objectContaining({ account: PUBLIC_TESTNET_ACCOUNT }),
      expect.any(AbortSignal),
    );
  });

  it('shows no fabricated amount or APY when the read fails and can retry safely', async () => {
    const readPosition = vi
      .fn<PublicTestnetExecutionApi['readPosition']>()
      .mockRejectedValueOnce(new PublicTestnetApiError('UNAVAILABLE'))
      .mockResolvedValueOnce(publicTestnetPosition('EMPTY'));
    const positionApi = api(readPosition);

    render(
      <PublicTestnetLendingDashboard
        account={PUBLIC_TESTNET_ACCOUNT}
        createApi={() => positionApi}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No amount or APY is assumed');
    expect(screen.queryByText('0%')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh position' }));
    await waitFor(() => expect(readPosition).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('0.000000 SOL')).toBeInTheDocument();
    expect(screen.getByText('No cSOL held')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Devnet Explorer/iu })).toBeNull();
    expect(screen.queryByRole('link', { name: /View reserve/iu })).toBeNull();
  });
});
