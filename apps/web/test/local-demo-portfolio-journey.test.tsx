import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDemoPortfolio } from '../components/portfolio/local-demo-portfolio';
import type { AccountProfile } from '../lib/authentication';
import {
  LocalDemoApiClient,
  LocalDemoApiError,
  type LocalDemoAllocationPreview,
  type LocalDemoWalletNamespace,
  type LocalDemoWalletProjection,
} from '../lib/local-demo/local-demo-client';
import { localDemoWalletRosterKey } from '../lib/local-demo/wallet-roster';
import { LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD } from './local-demo-portfolio.fixtures';

const PROFILE: AccountProfile = Object.freeze({
  accountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  contactEmail: 'demo@example.invalid',
  contactPhone: null,
  declaredResidencyCountryCode: 'US',
  eligibilityStatus: 'UNKNOWN',
  version: 1,
  createdAt: '2026-08-24T18:00:00.000Z',
  updatedAt: '2026-08-24T18:00:00.000Z',
});

const SECOND_PROFILE: AccountProfile = Object.freeze({
  ...PROFILE,
  accountId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  contactEmail: 'second@example.invalid',
});

const PROJECTIONS: Readonly<Record<LocalDemoWalletNamespace, LocalDemoWalletProjection>> =
  Object.freeze({
    EVM: Object.freeze({
      connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'Synthetic EVM wallet',
      namespace: 'EVM',
      chainId: 'eip155:11155111',
      address: '0x1111111111111111111111111111111111111111',
      registeredAt: '2026-08-24T18:00:00.000Z',
    }),
    SOLANA: Object.freeze({
      connectionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      label: 'Synthetic Solana wallet',
      namespace: 'SOLANA',
      chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      address: '7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8',
      registeredAt: '2026-08-24T18:00:00.000Z',
    }),
  });

const PORTFOLIO = LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD;

const MORE_LIQUID_PREVIEW: LocalDemoAllocationPreview = Object.freeze({
  use: 'LOCAL_DEMO_ESTIMATE_ONLY',
  mayAuthorizeFinancialAction: false,
  preset: Object.freeze({
    id: 'MORE_LIQUID',
    label: 'More liquid',
    description: 'Keep most capital readily available while adding a smaller yield allocation.',
  }),
  grossCapitalUsdMinor: '1100000',
  allocations: Object.freeze([
    Object.freeze({
      bucket: 'LIQUID_RESERVE',
      label: 'Liquid reserve',
      percentageBasisPoints: 6000,
      amountUsdMinor: '660000',
    }),
    Object.freeze({
      bucket: 'CONSERVATIVE_YIELD',
      label: 'Conservative yield',
      percentageBasisPoints: 3000,
      amountUsdMinor: '330000',
    }),
    Object.freeze({
      bucket: 'BALANCED_YIELD',
      label: 'Balanced yield',
      percentageBasisPoints: 1000,
      amountUsdMinor: '110000',
    }),
  ]),
  deductions: Object.freeze([
    Object.freeze({ code: 'LIQUIDITY', amountUsdMinor: '2200' }),
    Object.freeze({ code: 'CONVERSION', amountUsdMinor: '440' }),
    Object.freeze({ code: 'SLIPPAGE', amountUsdMinor: '440' }),
    Object.freeze({ code: 'NETWORK', amountUsdMinor: '440' }),
    Object.freeze({ code: 'ROUTING', amountUsdMinor: '880' }),
  ]),
  totalFeesUsdMinor: '4400',
  netPlannedCapitalUsdMinor: '1095600',
  asOf: '2026-08-24T18:30:00.000Z',
});

interface FakeClientHarness {
  readonly client: LocalDemoApiClient;
  readonly disconnectWallet: ReturnType<typeof vi.fn>;
  readonly listWallets: ReturnType<typeof vi.fn>;
  readonly previewAllocation: ReturnType<typeof vi.fn>;
  readonly readPortfolio: ReturnType<typeof vi.fn>;
  readonly registerWallet: ReturnType<typeof vi.fn>;
  readonly registered: LocalDemoWalletProjection[];
}

function fakeClient(initial: readonly LocalDemoWalletProjection[] = []): FakeClientHarness {
  const registered = [...initial];
  const listWallets = vi.fn(async () => Object.freeze([...registered]));
  const registerWallet = vi.fn(async (namespace: LocalDemoWalletNamespace) => {
    const projection = PROJECTIONS[namespace];
    if (!registered.some(({ namespace: current }) => current === namespace)) {
      registered.push(projection);
    }
    return projection;
  });
  const disconnectWallet = vi.fn(async (connectionId: string, signal?: AbortSignal) => {
    void signal;
    const index = registered.findIndex((wallet) => wallet.connectionId === connectionId);
    if (index >= 0) registered.splice(index, 1);
  });
  const readPortfolio = vi.fn(async () => PORTFOLIO);
  const previewAllocation = vi.fn(async () => MORE_LIQUID_PREVIEW);
  return {
    client: {
      listWallets,
      registerWallet,
      disconnectWallet,
      readPortfolio,
      previewAllocation,
    } as unknown as LocalDemoApiClient,
    disconnectWallet,
    listWallets,
    previewAllocation,
    readPortfolio,
    registerWallet,
    registered,
  };
}

function experience(
  harness: FakeClientHarness,
  options: {
    readonly navigate?: (path: string) => void;
    readonly restoreSession?: () => Promise<AccountProfile>;
  } = {},
) {
  const dependencies = {
    createClient: () => harness.client,
    navigate: options.navigate ?? vi.fn(),
    restoreSession: options.restoreSession ?? (async () => PROFILE),
    storage: () => window.sessionStorage,
  };
  return render(<LocalDemoPortfolio enabled dependencies={dependencies} />);
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('authenticated local demo portfolio journey', () => {
  it('connects independently proven EVM and Solana wallets and renders only redacted verified rows', async () => {
    const harness = fakeClient();
    experience(harness);

    expect(await screen.findByText('No synthetic wallets are connected yet.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Portfolio value is unavailable' }),
    ).toBeInTheDocument();
    expect(harness.readPortfolio).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /EVM test wallet/u }));
    const evmLabel = await screen.findByText('Synthetic EVM wallet', { selector: 'strong' });
    const evmRow = evmLabel.closest('li');
    expect(evmRow).not.toBeNull();
    expect(within(evmRow!).getByText(/0x1111/u)).toBeInTheDocument();
    expect(within(evmRow!).getByText('Proof accepted - indexing enabled')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PROJECTIONS.EVM.address);
    expect(
      window.sessionStorage.getItem(localDemoWalletRosterKey(PROFILE.accountId)),
    ).not.toContain(PROJECTIONS.EVM.address);

    fireEvent.click(screen.getByRole('button', { name: /Solana test wallet/u }));
    expect(
      await screen.findByText('Synthetic Solana wallet', { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(harness.registerWallet).toHaveBeenNthCalledWith(1, 'EVM', expect.any(AbortSignal));
    expect(harness.registerWallet).toHaveBeenNthCalledWith(2, 'SOLANA', expect.any(AbortSignal));
    expect(harness.readPortfolio).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('heading', { name: 'Your capital, clearly attributed.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/EVM balances are observations from the loopback-only LOCAL/u),
    ).toBeInTheDocument();
    const sources = screen.getByRole('heading', { name: 'Balance sources' }).closest('section');
    expect(sources).not.toBeNull();
    expect(within(sources!).getByText('LOCAL EVM (chain 31337)')).toBeInTheDocument();
    expect(within(sources!).getByText('Address ending in 0101')).toBeInTheDocument();
    expect(document.body.textContent).toContain(
      'Solana balances and all price and valuation inputs',
    );
    expect(document.body.textContent).toContain(
      'none of this is public-chain or validator evidence',
    );
  });

  it('restores registered server projections after a same-tab refresh without another proof POST', async () => {
    const firstHarness = fakeClient();
    const first = experience(firstHarness);
    await screen.findByText('No synthetic wallets are connected yet.');
    fireEvent.click(screen.getByRole('button', { name: /EVM test wallet/u }));
    await screen.findByText('Synthetic EVM wallet', { selector: 'strong' });
    first.unmount();

    const restoredHarness = fakeClient([PROJECTIONS.EVM]);
    experience(restoredHarness);
    expect(
      await screen.findByText('Synthetic EVM wallet', { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(restoredHarness.listWallets).toHaveBeenCalledTimes(1);
    expect(restoredHarness.registerWallet).not.toHaveBeenCalled();
    expect(restoredHarness.readPortfolio).toHaveBeenCalledTimes(1);
  });

  it('offers allocation blends only after the portfolio is ready and previews fees on selection', async () => {
    const harness = fakeClient();
    experience(harness);

    await screen.findByText('No synthetic wallets are connected yet.');
    expect(
      screen.queryByRole('heading', { name: 'Choose how to allocate your capital.' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /EVM test wallet/u }));
    expect(
      await screen.findByRole('heading', { name: 'Choose how to allocate your capital.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Estimated fees for this blend')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /More liquid/u }));
    expect(
      await screen.findByRole('heading', { name: 'Estimated fees for this blend' }),
    ).toBeInTheDocument();
    expect(harness.previewAllocation).toHaveBeenCalledWith('MORE_LIQUID', expect.any(AbortSignal));
    expect(screen.getByText('No transaction was created.')).toBeInTheDocument();
    const reconciliation = screen.getByText('Full available capital').closest('dl');
    expect(within(reconciliation!).getByLabelText('11,000 US dollars')).toHaveTextContent(
      '$11,000.00',
    );
    expect(screen.getByLabelText('44 US dollars estimated fee')).toHaveTextContent('-$44.00');
    expect(screen.getByLabelText('10,956 US dollars')).toHaveTextContent('$10,956.00');
  });

  it('isolates persisted roster metadata and capacity across authenticated account changes', async () => {
    const firstHarness = fakeClient();
    const first = experience(firstHarness);
    await screen.findByText('No synthetic wallets are connected yet.');
    fireEvent.click(screen.getByRole('button', { name: /EVM test wallet/u }));
    await screen.findByText('Synthetic EVM wallet', { selector: 'strong' });
    const firstRosterKey = localDemoWalletRosterKey(PROFILE.accountId);
    const firstRoster = window.sessionStorage.getItem(firstRosterKey);
    expect(firstRoster).not.toBeNull();
    first.unmount();

    const secondHarness = fakeClient();
    experience(secondHarness, { restoreSession: async () => SECOND_PROFILE });
    expect(await screen.findByText('No synthetic wallets are connected yet.')).toBeInTheDocument();
    expect(
      screen.queryByText('Synthetic EVM wallet', { selector: 'strong' }),
    ).not.toBeInTheDocument();
    expect(secondHarness.readPortfolio).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Solana test wallet/u }));
    expect(
      await screen.findByText('Synthetic Solana wallet', { selector: 'strong' }),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem(firstRosterKey)).toBe(firstRoster);
    expect(
      window.sessionStorage.getItem(localDemoWalletRosterKey(SECOND_PROFILE.accountId)),
    ).not.toBeNull();
  });

  it('disconnects through the server and returns to explicit unavailable state after the last wallet', async () => {
    const harness = fakeClient([PROJECTIONS.EVM]);
    experience(harness);
    const label = await screen.findByText('Synthetic EVM wallet', { selector: 'strong' });
    const row = label.closest('li');
    fireEvent.click(within(row!).getByRole('button', { name: 'Disconnect' }));

    await waitFor(() =>
      expect(
        screen.queryByText('Synthetic EVM wallet', { selector: 'strong' }),
      ).not.toBeInTheDocument(),
    );
    expect(harness.disconnectWallet).toHaveBeenCalledWith(
      PROJECTIONS.EVM.connectionId,
      expect.any(AbortSignal),
    );
    expect(screen.getByText('No synthetic wallets are connected yet.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Portfolio value is unavailable' }),
    ).toBeInTheDocument();
    expect(harness.readPortfolio).toHaveBeenCalledTimes(1);
  });

  it('aborts a pending disconnect request when the protected experience unmounts', async () => {
    const harness = fakeClient([PROJECTIONS.EVM]);
    const restoreSession = vi.fn(async () => PROFILE);
    harness.disconnectWallet.mockImplementationOnce(
      async (_connectionId: string, signal?: AbortSignal): Promise<void> =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted === true) {
            reject(new DOMException('Request aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Request aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const rendered = experience(harness, { restoreSession });
    const label = await screen.findByText('Synthetic EVM wallet', { selector: 'strong' });
    fireEvent.click(within(label.closest('li')!).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(harness.disconnectWallet).toHaveBeenCalledTimes(1));
    const signal = harness.disconnectWallet.mock.calls[0]?.[1] as AbortSignal;

    rendered.unmount();

    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(restoreSession).toHaveBeenCalledTimes(1);
  });

  it('clears the current account roster and redirects when the wallet API reports session loss', async () => {
    const rosterKey = localDemoWalletRosterKey(PROFILE.accountId);
    window.sessionStorage.setItem(rosterKey, JSON.stringify({ version: 1, entries: [] }));
    const navigate = vi.fn();
    const harness = fakeClient();
    harness.listWallets.mockRejectedValueOnce(new LocalDemoApiError('UNAUTHENTICATED'));
    experience(harness, { navigate });

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login?returnTo=%2Fportfolio'));
    expect(harness.listWallets).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(rosterKey)).toBeNull();
    expect(
      screen.queryByText('Synthetic EVM wallet', { selector: 'strong' }),
    ).not.toBeInTheDocument();
  });

  it('shows request failure instead of a false zero while retaining a retry control', async () => {
    const harness = fakeClient([PROJECTIONS.EVM]);
    harness.readPortfolio.mockRejectedValueOnce(new LocalDemoApiError('UNAVAILABLE'));
    experience(harness);

    expect(
      await screen.findByRole('heading', { name: 'Your portfolio could not be loaded' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh portfolio' }));
    expect(
      await screen.findByRole('heading', { name: 'Your capital, clearly attributed.' }),
    ).toBeInTheDocument();
  });
});
