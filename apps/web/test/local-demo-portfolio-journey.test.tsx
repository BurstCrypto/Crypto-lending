import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDemoPortfolio } from '../components/portfolio/local-demo-portfolio';
import type { AccountProfile } from '../lib/authentication';
import {
  LocalDemoApiClient,
  LocalDemoApiError,
  type LocalDemoWalletNamespace,
  type LocalDemoWalletProjection,
} from '../lib/local-demo/local-demo-client';
import { localDemoWalletRosterKey } from '../lib/local-demo/wallet-roster';
import { LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD } from './local-demo-portfolio.fixtures';
import {
  CROSS_CHAIN_BALANCED_PREVIEW,
  LOCAL_DEMO_YIELD_CATALOG,
  MORE_LIQUID_PREVIEW,
} from './local-demo-yield.fixtures';

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

function portfolioFor(wallets: readonly LocalDemoWalletProjection[]) {
  const registeredNamespaces = new Set(wallets.map(({ namespace }) => namespace));
  const includedWallets = PORTFOLIO.wallets.filter(({ namespace }) =>
    registeredNamespaces.has(namespace),
  );
  const total = includedWallets.reduce(
    (sum, wallet) => sum + BigInt(wallet.portfolioValueUsdMinor),
    0n,
  );
  return {
    ...PORTFOLIO,
    portfolioValueUsdMinor: total.toString(),
    buyingPower: {
      ...PORTFOLIO.buyingPower,
      amountUsdMinor: total.toString(),
    },
    wallets: includedWallets,
  };
}

interface FakeClientHarness {
  readonly client: LocalDemoApiClient;
  readonly disconnectWallet: ReturnType<typeof vi.fn>;
  readonly listWallets: ReturnType<typeof vi.fn>;
  readonly previewAllocation: ReturnType<typeof vi.fn>;
  readonly readYieldCatalog: ReturnType<typeof vi.fn>;
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
  const readPortfolio = vi.fn(async () => portfolioFor(registered));
  const readYieldCatalog = vi.fn(async () => LOCAL_DEMO_YIELD_CATALOG);
  const previewAllocation = vi.fn(async () =>
    registered.length === 2 ? CROSS_CHAIN_BALANCED_PREVIEW : MORE_LIQUID_PREVIEW,
  );
  return {
    client: {
      listWallets,
      registerWallet,
      disconnectWallet,
      readPortfolio,
      readYieldCatalog,
      previewAllocation,
    } as unknown as LocalDemoApiClient,
    disconnectWallet,
    listWallets,
    previewAllocation,
    readYieldCatalog,
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

  it('blends connected EVM and Solana capital without exposing a lending venue', async () => {
    const harness = fakeClient();
    experience(harness);

    await screen.findByText('No synthetic wallets are connected yet.');
    fireEvent.click(screen.getByRole('button', { name: /EVM test wallet/u }));
    await screen.findByText('Synthetic EVM wallet', { selector: 'strong' });
    fireEvent.click(screen.getByRole('button', { name: /Solana test wallet/u }));
    await screen.findByText('Synthetic Solana wallet', { selector: 'strong' });

    const buyingPower = screen.getByText('Available buying power').closest('article');
    expect(within(buyingPower!).getByLabelText('11,000 US dollars')).toHaveTextContent(
      '$11,000.00',
    );
    fireEvent.click(await screen.findByRole('button', { name: /Balanced blend/u }));

    const composition = (
      await screen.findByRole('heading', { name: 'Managed allocation by ecosystem' })
    ).closest('section');
    expect(within(composition!).getByText('EVM managed yield')).toBeInTheDocument();
    expect(within(composition!).getByText('SVM managed yield')).toBeInTheDocument();
    expect(
      within(composition!).getByText('No EVM-to-Solana transfer is modeled.'),
    ).toBeInTheDocument();
    expect(harness.previewAllocation).toHaveBeenCalledWith(
      PORTFOLIO.snapshotId,
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 3_000 },
      expect.any(AbortSignal),
    );
    expect(composition!.textContent).not.toMatch(
      /morpho|api\.morpho|eip155:|0x[0-9a-f]{40}|marketId|protocol/iu,
    );
  });

  it('offers private product plans only when ready and defers every fee amount until selection', async () => {
    const harness = fakeClient();
    experience(harness);

    await screen.findByText('No synthetic wallets are connected yet.');
    expect(
      screen.queryByRole('heading', { name: 'Choose how to allocate your capital.' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /EVM test wallet/u }));
    const allocationHeading = await screen.findByRole('heading', {
      name: 'Choose how to allocate your capital.',
    });
    const allocationPlanner = allocationHeading.closest('section');
    expect(allocationPlanner).not.toBeNull();
    expect(
      await within(allocationPlanner!).findByRole('heading', {
        name: 'Crypto Lending yield plans',
      }),
    ).toBeInTheDocument();
    expect(
      within(allocationPlanner!).getAllByRole('button', { name: /Preview plan/u }),
    ).toHaveLength(3);
    expect(within(allocationPlanner!).queryByText(/\$\d/u)).not.toBeInTheDocument();
    expect(
      within(allocationPlanner!).queryByText('Estimated one-time fees'),
    ).not.toBeInTheDocument();
    expect(
      within(allocationPlanner!).queryByText('First positive day after estimated fees'),
    ).not.toBeInTheDocument();
    expect(allocationPlanner!.textContent).not.toMatch(
      /morpho|ethereum|\bbase\b|eip155:|api\.morpho|cbBTC|WETH|USD3|0x[0-9a-f]{40}/iu,
    );
    expect(screen.queryByText('Why buying power is lower')).not.toBeInTheDocument();
    const buyingPowerCard = screen.getByText('Available buying power').closest('article');
    expect(within(buyingPowerCard!).getByLabelText('7,000 US dollars')).toHaveTextContent(
      '$7,000.00',
    );

    fireEvent.click(screen.getByRole('button', { name: /More liquid/u }));
    const costHeading = await screen.findByRole('heading', { name: 'Estimated one-time fees' });
    expect(costHeading).toBeInTheDocument();
    expect(harness.previewAllocation).toHaveBeenCalledWith(
      PORTFOLIO.snapshotId,
      { kind: 'PRESET', presetId: 'MORE_LIQUID', liquidReserveBasisPoints: 6_000 },
      expect.any(AbortSignal),
    );
    expect(
      screen.getByText('No user-authorized financial transaction was created.'),
    ).toBeInTheDocument();
    const reconciliation = screen.getByText('Full available capital').closest('dl');
    expect(within(reconciliation!).getByLabelText('7,000 US dollars')).toHaveTextContent(
      '$7,000.00',
    );
    expect(
      within(reconciliation!).getByLabelText('6,995 US dollars and 48 cents'),
    ).toHaveTextContent('$6,995.48');
    const costSection = costHeading.closest('section');
    expect(within(costSection!).getByLabelText('4 US dollars and 52 cents')).toHaveTextContent(
      '$4.52',
    );
    expect(within(costSection!).getByText(/Actual local operation: \$0/u)).toBeInTheDocument();
    expect(
      within(costSection!).getByText(/Public execution costs:\s*unquoted/iu),
    ).toBeInTheDocument();
    expect(screen.getByText('Capital included in projection')).toBeInTheDocument();
    const yieldProjection = screen
      .getByRole('heading', { name: 'Illustrative yield result' })
      .closest('section');
    expect(
      within(yieldProjection!).getByLabelText('1.87 percent estimated annual percentage yield'),
    ).toHaveTextContent('1.87%');
    expect(
      within(yieldProjection!).getByLabelText('131 US dollars and 30 cents'),
    ).toHaveTextContent('$131.30');
    expect(
      within(yieldProjection!).getByLabelText('126 US dollars and 78 cents'),
    ).toHaveTextContent('$126.78');
    expect(
      within(yieldProjection!).getByLabelText(
        'First positive whole-cent yield after estimated fees is day 13',
      ),
    ).toHaveTextContent('Day 13');
    expect(allocationPlanner!.textContent).not.toMatch(/morpho|api\.morpho|eip155:/iu);
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
