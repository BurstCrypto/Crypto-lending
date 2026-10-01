import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BRIDGE_ETHEREUM,
  BRIDGE_SOLANA,
  type BridgeStep,
  type BridgeUiState,
} from '../lib/mainnet/bridge-types';
import type { SmartLendingQuote } from '../lib/lending/smart-lending';

const api = vi.hoisted(() => ({
  call: vi.fn(),
  send: vi.fn(),
  selectAccounts: vi.fn(),
  verify: vi.fn(),
  check: vi.fn(),
}));
vi.mock('@/lib/mainnet/bridge-client', () => ({
  bridgeApi: api.call,
  BridgeWallets: class {
    start(update: (choices: unknown[]) => void) {
      update([
        { id: 'ethereum-wallet', name: 'MetaMask', chain: 'Ethereum' },
        { id: 'solana-wallet', name: 'Phantom', chain: 'Solana' },
      ]);
      return () => undefined;
    }
    send = api.send;
    connectWallets = api.selectAccounts;
    verify = api.verify;
    check = api.check;
  },
}));
import { LENDING_PROVIDERS } from '../lib/lending/markets';
const marketViews = () =>
  LENDING_PROVIDERS.map((id) => ({
    id,
    apyBasisPoints: '400',
    observedAt: Date.now(),
    supplied: '0',
    shares: '0',
    capacity: null,
    available: true,
    entryCostNative: '5000',
    error: null,
  }));
import { LocalMainnetTest } from '../components/mainnet/mainnet-test';
const blank: BridgeUiState = {
  configured: false,
  config: null,
  authenticated: false,
  paused: false,
  bridges: [],
  steps: [],
  setupError: 'Complete setup',
};
beforeEach(() => {
  vi.resetAllMocks();
  api.call.mockResolvedValue(blank);
});
afterEach(cleanup);

it('allows either wallet address while requiring saved treasury recipients and leaving routers empty', async () => {
  render(<LocalMainnetTest setupToken={'a'.repeat(64)} />);
  expect(await screen.findByRole('heading', { name: 'Connect your wallets' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Public address setup'));
  for (const label of [
    'Ethereum transaction wallet (mainnet)',
    'Solana transaction wallet (mainnet)',
    'Ethereum treasury receiving wallet',
    'Solana treasury receiving wallet',
  ]) {
    if (label.includes('treasury')) expect(screen.getByLabelText(label)).toBeRequired();
    else expect(screen.getByLabelText(label)).not.toBeRequired();
    expect(screen.getByLabelText(label)).toHaveValue('');
  }
  expect(screen.getByLabelText('Ethereum source router')).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Confirm in wallet' })).not.toBeInTheDocument();
  expect(api.send).not.toHaveBeenCalled();
});

it.each(['Ethereum', 'Solana'])(
  'connects only %s, checks its balance, and keeps cross-chain actions unavailable',
  async (chain) => {
    const accounts = {
      ethereumWallet: chain === 'Ethereum' ? '0x1111111111111111111111111111111111111111' : null,
      solanaWallet: chain === 'Solana' ? 'selected-solana-wallet' : null,
    };
    const treasuries = {
      ethereumTreasury: '0x2222222222222222222222222222222222222222',
      solanaTreasury: 'saved-solana-treasury',
    };
    const config = {
      ...accounts,
      ...treasuries,
      ethereumSourceRouter: null,
      ethereumSupplyRouter: null,
      ethereumLendingRouter: null,
      solanaLookupTables: [],
    };
    let configured = false;
    api.selectAccounts.mockResolvedValue(accounts);
    api.call.mockImplementation(async (operation?: string) => {
      if (operation === 'markets') return marketViews();
      if (operation === 'configure') {
        configured = true;
        return { configured };
      }
      if (operation === 'preflight')
        return {
          ethereum: chain === 'Ethereum' ? { usdc: '5000000', eth: '10000000000000000' } : null,
          solana: chain === 'Solana' ? { usdc: '5000000', lamports: '100000000' } : null,
          routersVerified: false,
        };
      return configured ? { ...blank, config, configured } : blank;
    });
    render(<LocalMainnetTest setupToken={'a'.repeat(64)} initialTreasuries={treasuries} />);
    await screen.findByRole('heading', { name: 'Connect your wallets' });
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(`${chain} wallet extension`), {
      target: { value: `${chain.toLowerCase()}-wallet` },
    });
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    await screen.findByText(`${chain} wallet connected`);
    await screen.findByText('Live balances loaded below.');
    expect(screen.getByRole('button', { name: 'Wallet connected' })).toBeDisabled();
    expect(api.verify).not.toHaveBeenCalled();
    expect(api.selectAccounts).toHaveBeenCalledWith(
      chain === 'Ethereum' ? 'ethereum-wallet' : '',
      chain === 'Solana' ? 'solana-wallet' : '',
      'a'.repeat(64),
    );
    expect(api.call).toHaveBeenCalledWith('configure', { config }, 'a'.repeat(64));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check live readiness' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check live readiness' }));
    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(api.check).toHaveBeenCalledWith(config);
    expect(api.call).toHaveBeenCalledWith('preflight', {}, 'a'.repeat(64));
    await waitFor(() =>
      expect(api.call.mock.calls.filter(([operation]) => operation === 'markets')).toHaveLength(1),
    );
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'Prepare bridge quote' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prepare source router deployment' })).toBeNull();
    expect(api.send).not.toHaveBeenCalled();
  },
);
it('shows saved fee recipients while leaving mainnet transaction wallets for the user', async () => {
  render(
    <LocalMainnetTest
      setupToken={'a'.repeat(64)}
      initialTreasuries={{
        ethereumTreasury: '0x2222222222222222222222222222222222222222',
        solanaTreasury: 'saved-solana-treasury',
      }}
    />,
  );
  await screen.findByRole('heading', { name: 'Connect your wallets' });
  fireEvent.click(screen.getByText('Public address setup'));
  expect(screen.getByLabelText('Ethereum treasury receiving wallet')).toHaveValue(
    '0x2222222222222222222222222222222222222222',
  );
  expect(screen.getByLabelText('Solana treasury receiving wallet')).toHaveValue(
    'saved-solana-treasury',
  );
  expect(screen.getByLabelText('Ethereum transaction wallet (mainnet)')).toHaveValue('');
  expect(screen.getByLabelText('Solana transaction wallet (mainnet)')).toHaveValue('');
});

it.each([false, true])(
  'connects both wallets after sign-in and uses the local capability for bridge actions (available: %s)',
  async (available) => {
    const accounts = {
      ethereumWallet: '0x1111111111111111111111111111111111111111',
      solanaWallet: 'selected-solana-wallet',
    };
    const treasuries = {
      ethereumTreasury: '0x2222222222222222222222222222222222222222',
      solanaTreasury: 'saved-solana-treasury',
    };
    const config = {
      ...accounts,
      ...treasuries,
      ethereumSourceRouter: null,
      ethereumSupplyRouter: null,
      ethereumLendingRouter: null,
      solanaLookupTables: [],
    };
    let configured = false;
    api.selectAccounts.mockResolvedValue(accounts);
    api.call.mockImplementation(async (operation?: string) => {
      if (operation === 'markets') return marketViews();
      if (operation === 'configure') {
        configured = true;
        return { configured };
      }
      if (operation === 'preflight')
        return {
          ethereum: { usdc: '3000000', eth: '10000000000000000' },
          solana: { usdc: '5000000', lamports: '100000000' },
          routersVerified: false,
        };
      return configured
        ? { ...blank, config, configured, authenticated: false, localAccess: available }
        : blank;
    });
    render(<LocalMainnetTest setupToken={'a'.repeat(64)} initialTreasuries={treasuries} />);
    await screen.findByRole('heading', { name: 'Connect your wallets' });
    fireEvent.change(screen.getByLabelText('Ethereum wallet extension'), {
      target: { value: 'ethereum-wallet' },
    });
    fireEvent.change(screen.getByLabelText('Solana wallet extension'), {
      target: { value: 'solana-wallet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallets' }));
    await screen.findByText('Both wallets connected');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check live readiness' })).toBeEnabled(),
    );
    expect(api.verify).not.toHaveBeenCalled();
    expect(api.call).toHaveBeenCalledWith('configure', { config }, 'a'.repeat(64));
    expect(screen.getByRole('button', { name: 'Check live readiness' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Verify wallets for bridge actions' }),
    ).not.toBeInTheDocument();
    if (available)
      expect(
        screen.getByRole('button', { name: 'Prepare source router deployment' }),
      ).toBeEnabled();
    else
      expect(
        screen.getByRole('button', { name: 'Prepare source router deployment' }),
      ).toBeDisabled();
    expect(
      api.call.mock.calls.filter((args) => args[0] && args[0] !== 'markets').map((args) => args[0]),
    ).toEqual(['configure', 'preflight']);
    fireEvent.click(screen.getByRole('button', { name: 'Check live readiness' }));
    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(api.verify).not.toHaveBeenCalled();
    expect(api.send).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  'makes a saved Phantom reconnection visible and automatically checks its balance (RPC failure: %s)',
  async (rpcFailure) => {
    const accounts = { ethereumWallet: null, solanaWallet: 'selected-solana-wallet' };
    const config = {
      ...accounts,
      ethereumTreasury: '0x2222222222222222222222222222222222222222',
      solanaTreasury: 'saved-solana-treasury',
      ethereumSourceRouter: null,
      ethereumSupplyRouter: null,
      ethereumLendingRouter: null,
      solanaLookupTables: [],
    };
    let approve: (value: typeof accounts) => void;
    api.selectAccounts.mockReturnValue(
      new Promise((resolve) => {
        approve = resolve;
      }),
    );
    api.call.mockImplementation(async (operation?: string) => {
      if (operation === 'markets') return marketViews();
      if (operation === 'preflight') {
        if (rpcFailure) throw new Error('Solana RPC is unavailable.');
        return {
          ethereum: null,
          solana: { usdc: '5000000', lamports: '100000000' },
          routersVerified: false,
        };
      }
      if (operation) throw new Error(`Unexpected mutation: ${operation}`);
      return { ...blank, config, configured: true };
    });
    render(<LocalMainnetTest setupToken={'a'.repeat(64)} />);
    await screen.findByRole('heading', { name: 'Wallets and connections' });
    fireEvent.change(screen.getByLabelText('Solana wallet extension'), {
      target: { value: 'solana-wallet' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    expect(screen.getByRole('button', { name: 'Connecting...' })).toBeDisabled();
    expect(screen.getByText('Approve the connection request in Phantom.')).toBeInTheDocument();
    approve!(accounts);
    await screen.findByText('Solana wallet connected');
    expect(screen.getByText('Solana: selected-solana-wallet')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check live readiness' })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: 'Wallet connected' })).toBeDisabled();
    if (rpcFailure)
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Your wallet is connected, but the balance check failed: Solana RPC is unavailable.',
      );
    else expect(await screen.findByText('5')).toBeInTheDocument();
    expect(
      api.call.mock.calls.filter((args) => args[0] && args[0] !== 'markets').map((args) => args[0]),
    ).toEqual(['preflight']);
    expect(api.selectAccounts).toHaveBeenCalledTimes(1);
    expect(api.verify).not.toHaveBeenCalled();
    expect(api.send).not.toHaveBeenCalled();
  },
);

it('shows a connection failure beside the button and permits another attempt', async () => {
  api.selectAccounts.mockRejectedValue(
    new Error(
      'A wallet request is already open. Open your wallet extension and approve or dismiss that request, then connect again.',
    ),
  );
  render(
    <LocalMainnetTest
      setupToken={'a'.repeat(64)}
      initialTreasuries={{
        ethereumTreasury: '0x2222222222222222222222222222222222222222',
        solanaTreasury: 'saved-solana-treasury',
      }}
    />,
  );
  await screen.findByRole('heading', { name: 'Connect your wallets' });
  fireEvent.change(screen.getByLabelText('Solana wallet extension'), {
    target: { value: 'solana-wallet' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('A wallet request is already open.');
  expect(error.closest('#wallets')).not.toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeEnabled());
  expect(
    api.call.mock.calls.every(
      (args) => [undefined, 'markets'].includes(args[0]) && args[2] === 'a'.repeat(64),
    ),
  ).toBe(true);
  expect(api.verify).not.toHaveBeenCalled();
  expect(api.send).not.toHaveBeenCalled();
});

it('stops connection if saving the setup is rejected, preserving the pending-transfer boundary', async () => {
  api.selectAccounts.mockResolvedValue({
    ethereumWallet: '0x1111111111111111111111111111111111111111',
    solanaWallet: 'selected-solana-wallet',
  });
  api.call.mockImplementation((operation?: string) =>
    operation === 'configure'
      ? Promise.reject(new Error('Recover pending transactions first.'))
      : Promise.resolve(blank),
  );
  render(
    <LocalMainnetTest
      setupToken={'a'.repeat(64)}
      initialTreasuries={{
        ethereumTreasury: '0x2222222222222222222222222222222222222222',
        solanaTreasury: 'saved-solana-treasury',
      }}
    />,
  );
  await screen.findByRole('heading', { name: 'Connect your wallets' });
  fireEvent.change(screen.getByLabelText('Ethereum wallet extension'), {
    target: { value: 'ethereum-wallet' },
  });
  fireEvent.change(screen.getByLabelText('Solana wallet extension'), {
    target: { value: 'solana-wallet' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect wallets' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Recover pending transactions first.');
  expect(api.verify).not.toHaveBeenCalled();
  expect(api.send).not.toHaveBeenCalled();
});
it('a restored reservation exposes recovery and cannot trigger a second wallet submission', async () => {
  api.call.mockResolvedValue({
    ...blank,
    configured: true,
    authenticated: true,
    config: {
      ethereumWallet: '0x1111111111111111111111111111111111111111',
      solanaWallet: 'public-solana-wallet',
      ethereumTreasury: '0x2222222222222222222222222222222222222222',
      solanaTreasury: 'public-solana-treasury',
      ethereumSourceRouter: null,
      ethereumSupplyRouter: null,
      ethereumLendingRouter: null,
      solanaLookupTables: [],
    },
    steps: [
      {
        id: 'pending-id',
        kind: 'DEPLOY_SOURCE',
        state: 'RESERVED',
        network: BRIDGE_ETHEREUM,
        wallet: '0x1111111111111111111111111111111111111111',
        maxNetworkCost: '1000000000000000',
        evidence: {},
        transactionId: null,
        ethereum: null,
        solana: null,
      },
    ],
  });
  render(<LocalMainnetTest setupToken={'a'.repeat(64)} />);
  expect(await screen.findByLabelText('Original wallet transaction hash')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm in wallet' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Recover transaction status' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh journal' }));
  await waitFor(() =>
    expect(api.call.mock.calls.filter(([operation]) => operation === undefined)).toHaveLength(3),
  );
  expect(
    api.call.mock.calls.every(
      (args) => [undefined, 'markets'].includes(args[0]) && args[2] === 'a'.repeat(64),
    ),
  ).toBe(true);
  expect(api.send).not.toHaveBeenCalled();
});

it.each([
  ['Ethereum', false],
  ['Solana', false],
  ['Ethereum', true],
  ['Solana', true],
] as const)(
  'uses the same automatic %s plan and wallet review with local provider details: %s',
  async (chain, showProviderDetails) => {
    const setupToken = showProviderDetails ? 'a'.repeat(64) : '';
    const config = {
      ethereumWallet:
        chain === 'Ethereum' ? ('0x1111111111111111111111111111111111111111' as const) : null,
      solanaWallet: chain === 'Solana' ? 'selected-solana-wallet' : null,
      ethereumTreasury: '0x2222222222222222222222222222222222222222' as const,
      solanaTreasury: 'saved-solana-treasury',
      ethereumSourceRouter: null,
      ethereumSupplyRouter: null,
      ethereumLendingRouter: null,
      solanaLookupTables: [],
    };
    const network = chain === 'Ethereum' ? BRIDGE_ETHEREUM : BRIDGE_SOLANA;
    const provider = chain === 'Ethereum' ? 'euler' : 'jupiter';
    const comparison: SmartLendingQuote = {
      id: 'smart-quote',
      input: { sourceNetwork: network, amount: '1', holdingDays: 30, includeCrossChain: true },
      createdAt: Date.now(),
      expiresAt: Date.now() + 120_000,
      selectedId: provider,
      routes: [
        {
          id: provider,
          name: chain === 'Ethereum' ? 'Euler' : 'Jupiter',
          network,
          routeKind: 'SAME_CHAIN',
          apyBasisPoints: '400',
          observedAt: Date.now(),
          source: '',
          entryCostUsd: '1000',
          exitCostUsd: '1000',
          projectedYieldUsd: '3000000000000000',
          netBenefitUsd: '2999999999998000',
          breakEvenDays: '1',
          reasons: [],
          fundingReasons: [],
        },
      ],
    };
    const step: BridgeStep = {
      id: 'review-id',
      bridgeId: null,
      kind: 'LENDING_SUPPLY',
      network,
      wallet: config.ethereumWallet ?? config.solanaWallet!,
      state: 'PREPARED',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      fingerprint: 'review-fingerprint',
      transactionId: null,
      ethereum: null,
      solana: null,
      sourcePrincipal: '1000000',
      maxNetworkCost: '1000000',
      evidence: {
        asset: 'USDC',
        amount: '1000000',
        platformFee: '0',
        provider,
        smartQuoteId: comparison.id,
        smartApyBasisPoints: '400',
        smartHoldingDays: '30',
        market: chain === 'Ethereum' ? 'Euler' : 'Jupiter',
      },
    };
    let steps: BridgeStep[] = [];
    api.selectAccounts.mockResolvedValue({
      ethereumWallet: config.ethereumWallet,
      solanaWallet: config.solanaWallet,
    });
    api.call.mockImplementation(async (operation?: string) => {
      if (operation === 'markets') return marketViews();
      if (operation === 'preflight')
        return {
          ethereum:
            chain === 'Ethereum'
              ? { usdc: '5000000', eth: '10000000000000000', supplied: '0' }
              : null,
          solana:
            chain === 'Solana' ? { usdc: '5000000', lamports: '100000000', collateral: '0' } : null,
        };
      if (operation === 'smart-lending-compare') return comparison;
      if (operation === 'smart-lending-prepare') {
        steps = [step];
        return { quote: comparison, step, bridge: null };
      }
      if (operation) throw new Error(`Unexpected operation ${operation}`);
      return { ...blank, config, configured: true, lendingSteps: steps };
    });
    let rejectRequest!: (error: Error) => void;
    api.send
      .mockImplementationOnce((...args: unknown[]) => {
        (args[5] as (message: string) => void)('Waiting for approval in your wallet.');
        return new Promise((_resolve, reject) => {
          rejectRequest = reject;
        });
      })
      .mockResolvedValue({ ...step, state: 'SUBMITTED' });
    render(<LocalMainnetTest setupToken={setupToken} showProviderDetails={showProviderDetails} />);
    await screen.findByRole('heading', { name: 'Wallets and connections' });
    expect(api.selectAccounts).not.toHaveBeenCalled();
    if (showProviderDetails)
      expect(
        screen.getByRole('table', { name: 'Provider APYs and your positions' }),
      ).toBeInTheDocument();
    else expect(screen.queryByText(/Aave|Kamino|Euler|Jupiter/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Deposit directly/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(`${chain} wallet extension`), {
      target: { value: `${chain.toLowerCase()}-wallet` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    await screen.findByText(`${chain} wallet connected`);
    await waitFor(() => expect(screen.getByLabelText('USDC amount')).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Find my lending plan' })).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Live lending APY')).getByText('4.00%'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('USDC amount'), { target: { value: '1' } });
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Consider bridging if it improves the net return' }),
    );
    const review = await screen.findByRole('button', { name: 'Review deposit' });
    expect(api.call).toHaveBeenCalledWith(
      'smart-lending-compare',
      { input: comparison.input },
      setupToken,
    );
    expect(api.send).not.toHaveBeenCalled();
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);
    const confirm = await screen.findByRole('button', {
      name: `Confirm ${chain} transaction in wallet`,
    });
    expect(confirm).toBeDisabled();
    expect(api.send).not.toHaveBeenCalled();
    expect(api.verify).not.toHaveBeenCalled();
    expect(api.call).toHaveBeenCalledWith(
      'smart-lending-prepare',
      { id: comparison.id },
      setupToken,
    );
    if (showProviderDetails)
      expect(
        screen.getByText(`Provider: ${chain === 'Ethereum' ? 'Euler' : 'Jupiter'}`),
      ).toBeInTheDocument();
    else expect(screen.queryByText(/Aave|Kamino|Euler|Jupiter/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Put your USDC to work.' })).queryByText(
        /Aave|Kamino|Euler|Jupiter/,
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('I reviewed this transaction and its network cost.'));
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.send).toHaveBeenCalledWith(
        step,
        config,
        undefined,
        expect.any(Function),
        setupToken,
        expect.any(Function),
      ),
    );
    const position = within(confirm.closest('article')!);
    expect(position.getByRole('status', { name: 'Wallet request' })).toHaveTextContent(
      'Waiting for approval in your wallet.',
    );
    expect(confirm).toBeDisabled();
    await act(async () =>
      rejectRequest(new Error('The transaction review expired. Prepare a fresh review.')),
    );
    expect(await position.findByRole('alert')).toHaveTextContent(
      'The transaction review expired. Prepare a fresh review.',
    );
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
    expect(api.verify).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  'shows the converted USDC deposit value in the shared position UI (local details: %s)',
  async (showProviderDetails) => {
    const config = {
      ethereumWallet: null,
      solanaWallet: 'selected-solana-wallet',
      ethereumTreasury: '0x2222222222222222222222222222222222222222',
      solanaTreasury: 'saved-solana-treasury',
      ethereumSourceRouter: null,
      ethereumSupplyRouter: null,
      solanaLookupTables: [],
    };
    api.call.mockImplementation(async (operation?: string) =>
      operation === 'markets'
        ? marketViews().map((market) =>
            market.id === 'kamino'
              ? {
                  ...market,
                  shares: '8321724',
                  supplied: '10000037',
                  receiptExchangeRate: '1201680000000000000',
                }
              : market,
          )
        : { ...blank, config, configured: true },
    );
    render(
      <LocalMainnetTest setupToken={'a'.repeat(64)} showProviderDetails={showProviderDetails} />,
    );
    const position = within(
      await screen.findByRole('article', { name: 'Solana lending position 1' }),
    );
    expect(position.getByText('Current deposit value')).toBeInTheDocument();
    expect(position.getByText('10.000037 USDC')).toBeInTheDocument();
    expect(position.queryByText(/8\.321724|receipt tokens|Lending receipt balance/)).toBeNull();
    expect(position.getByText(/Includes accrued lending interest/)).toBeInTheDocument();
    if (!showProviderDetails) expect(screen.queryByText(/receipt token|Kamino/)).toBeNull();
    expect(api.send).not.toHaveBeenCalled();
  },
);

it('keeps a deposit visible when conversion is unavailable without displaying its token count as money', async () => {
  const config = {
    ethereumWallet: null,
    solanaWallet: 'selected-solana-wallet',
    ethereumTreasury: '0x2222222222222222222222222222222222222222',
    solanaTreasury: 'saved-solana-treasury',
    ethereumSourceRouter: null,
    ethereumSupplyRouter: null,
    solanaLookupTables: [],
  };
  api.call.mockImplementation(async (operation?: string) =>
    operation === 'markets'
      ? marketViews().map((market) =>
          market.id === 'kamino' ? { ...market, shares: '8321724', supplied: null } : market,
        )
      : { ...blank, config, configured: true },
  );
  render(<LocalMainnetTest setupToken={'a'.repeat(64)} />);
  const position = within(
    await screen.findByRole('article', { name: 'Solana lending position 1' }),
  );
  expect(
    position.getByText(
      'Your deposit is recorded. Its current USDC value is temporarily unavailable.',
    ),
  ).toBeInTheDocument();
  expect(position.queryByText(/8\.321724/)).toBeNull();
  expect(position.getByText('— USDC')).toBeInTheDocument();
});

it('withdraws an automatically selected position using its original provider without exposing a provider picker', async () => {
  const config = {
    ethereumWallet: null,
    solanaWallet: 'selected-solana-wallet',
    ethereumTreasury: '0x2222222222222222222222222222222222222222',
    solanaTreasury: 'saved-solana-treasury',
    ethereumSourceRouter: null,
    ethereumSupplyRouter: null,
    ethereumLendingRouter: null,
    solanaLookupTables: [],
  };
  api.selectAccounts.mockResolvedValue({ ethereumWallet: null, solanaWallet: config.solanaWallet });
  api.call.mockImplementation(async (operation?: string) => {
    if (operation === 'markets')
      return marketViews().map((market) =>
        market.id === 'jupiter' ? { ...market, shares: '5000000', supplied: '5000000' } : market,
      );
    if (operation === 'preflight')
      return {
        ethereum: null,
        solana: { usdc: '1000000', lamports: '100000000', collateral: '0' },
      };
    if (operation === 'lending-prepare') return {};
    return { ...blank, config, configured: true };
  });
  render(<LocalMainnetTest setupToken={'a'.repeat(64)} />);
  await screen.findByRole('heading', { name: 'Wallets and connections' });
  fireEvent.change(screen.getByLabelText('Solana wallet extension'), {
    target: { value: 'solana-wallet' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
  const withdraw = await screen.findByRole('button', {
    name: 'Withdraw all from Solana lending position 1',
  });
  await waitFor(() => expect(withdraw).toBeEnabled());
  expect(screen.queryByText(/Jupiter|Aave|Kamino/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('article', { name: /lending position/ })).toHaveLength(1);
  fireEvent.click(withdraw);
  await waitFor(() =>
    expect(api.call).toHaveBeenCalledWith(
      'lending-prepare',
      { provider: 'jupiter', network: BRIDGE_SOLANA, action: 'withdraw', amount: 'all' },
      'a'.repeat(64),
    ),
  );
  expect(api.send).not.toHaveBeenCalled();
});

it('restores a direct lending reservation without logging in or resending it', async () => {
  api.call.mockResolvedValue({
    ...blank,
    configured: true,
    authenticated: false,
    config: {
      ethereumWallet: '0x1111111111111111111111111111111111111111',
      solanaWallet: null,
      ethereumTreasury: '0x2222222222222222222222222222222222222222',
      solanaTreasury: 'public-solana-treasury',
      ethereumSourceRouter: null,
      ethereumSupplyRouter: null,
      ethereumLendingRouter: null,
      solanaLookupTables: [],
    },
    lendingSteps: [
      {
        id: 'direct-pending-id',
        kind: 'LENDING_SUPPLY',
        state: 'RESERVED',
        network: BRIDGE_ETHEREUM,
        wallet: '0x1111111111111111111111111111111111111111',
        maxNetworkCost: '1000000000000000',
        evidence: { amount: '1000000' },
        transactionId: null,
        ethereum: null,
        solana: null,
      },
    ],
  });
  render(<LocalMainnetTest setupToken={'a'.repeat(64)} />);
  expect(await screen.findByLabelText('Original Ethereum transaction hash')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Confirm Ethereum transaction in wallet' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Recover Ethereum transaction' })).toBeDisabled();
  expect(api.send).not.toHaveBeenCalled();
  expect(api.verify).not.toHaveBeenCalled();
});
