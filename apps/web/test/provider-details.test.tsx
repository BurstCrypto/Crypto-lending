import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderDetails } from '../components/mainnet/provider-details';
import { LENDING_PROVIDERS, MARKETS } from '../lib/lending/markets';
import type { LendingMarketView } from '../lib/lending/smart-lending';
import { BRIDGE_ETHEREUM, BRIDGE_SOLANA, type BridgeRecord, type BridgeStep, type LocalWalletConfig } from '../lib/mainnet/bridge-types';

const config: LocalWalletConfig = {
  ethereumWallet: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', solanaWallet: 'saved-solana-wallet',
  ethereumTreasury: '0x2222222222222222222222222222222222222222', solanaTreasury: 'saved-solana-treasury',
  ethereumSourceRouter: null, ethereumSupplyRouter: null, solanaLookupTables: [],
};
const markets = (): LendingMarketView[] => LENDING_PROVIDERS.map((id) => ({
  id, apyBasisPoints: '475', observedAt: Date.now(), supplied: '0', shares: '0',
  capacity: null, available: true, entryCostNative: '5000', error: null,
}));
function deposit(changes: Partial<BridgeStep> = {}): BridgeStep {
  return {
    id: 'direct-deposit', bridgeId: null, kind: 'LENDING_SUPPLY', network: BRIDGE_SOLANA, wallet: config.solanaWallet!,
    state: 'FINALIZED', createdAt: Date.now(), expiresAt: Date.now() + 120_000, fingerprint: 'fingerprint',
    transactionId: 'verified-deposit-signature', ethereum: null, solana: null, maxNetworkCost: '5000', sourcePrincipal: '1000000',
    evidence: { provider: 'jupiter', amount: '1000000' }, outcome: { usdcAmount: '999999' }, ...changes,
  };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('shows all provider rates and wallet positions without adding lending controls', () => {
  const rows = markets().map((market) => market.id === 'kamino' ? { ...market, supplied: '15000000', shares: '12500000', receiptExchangeRate: '1200000000000000000' }
    : market.id === 'euler' ? { ...market, supplied: '2500000', shares: '2400000', apyBasisPoints: '0' } : market);
  render(<ProviderDetails config={config} markets={rows} error="" steps={[]} bridges={[]} />);
  const table = screen.getByRole('table', { name: 'Provider APYs and your positions' });
  expect(within(table).getAllByRole('row')).toHaveLength(11);
  for (const id of LENDING_PROVIDERS) expect(within(table).getByRole('rowheader', { name: MARKETS[id].name })).toBeInTheDocument();
  const kamino = within(screen.getByRole('row', { name: /Kamino/ }));
  expect(kamino.getByText('15 USDC')).toBeInTheDocument();
  expect(kamino.queryByText('12.5 USDC')).toBeNull();
  expect(kamino.queryByText(/receipt tokens/)).toBeNull();
  const details = screen.getByText('Receipt token details').closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(details).toHaveTextContent('Kamino: 12.5 receipt tokens.');
  expect(details).toHaveTextContent('Exchange rate: 1 receipt token ≈ 1.2 USDC.');
  const euler = within(screen.getByRole('row', { name: /Euler/ }));
  expect(euler.getByText('0.00%')).toBeInTheDocument();
  expect(euler.getByText('2.5 USDC')).toBeInTheDocument();
  expect(screen.getByText('No verified deposits recorded for these wallets yet.')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('does not substitute receipt quantities for a missing USDC valuation', () => {
  const rows = markets().map((market) => market.id === 'kamino' ? { ...market, supplied: null, shares: '8321724', receiptExchangeRate: null } : market);
  render(<ProviderDetails config={config} markets={rows} error="" steps={[]} bridges={[]} />);
  const row = within(screen.getByRole('row', { name: /Kamino/ }));
  expect(row.getByText('USDC value unavailable')).toBeInTheDocument();
  expect(row.queryByText(/8\.321724/)).toBeNull();
  expect(screen.queryByText('8.321724 USDC')).toBeNull();
});

it('does not present unavailable or expired rates as live APYs', () => {
  vi.useFakeTimers();
  const rows = markets().map((market) => market.id === 'aave' ? { ...market, error: 'RPC unavailable' }
    : market.id === 'morpho' ? { ...market, observedAt: Date.now() - 121_000 }
      : market.id === 'compound' ? { ...market, observedAt: Date.now() + 60_000 } : market);
  render(<ProviderDetails config={config} markets={rows} error="" steps={[]} bridges={[]} />);
  for (const name of ['Aave V3', 'Morpho', 'Compound']) {
    expect(within(screen.getByRole('row', { name: new RegExp(name) })).queryByText('4.75%')).toBeNull();
  }
  expect(screen.getAllByText('4.75%')).toHaveLength(7);
  act(() => vi.advanceTimersByTime(195_000));
  expect(screen.queryByText('4.75%')).toBeNull();
});

it('labels only finalized deposits for the saved wallets and uses the verified amount', () => {
  const bridgeId = `0x${'1'.repeat(64)}` as const;
  const bridge = { id: bridgeId, destinationProvider: 'kamino' } as BridgeRecord;
  const bridgeDeposit = deposit({ id: 'bridge-deposit', bridgeId, kind: 'DESTINATION_MINT_SUPPLY', evidence: {}, transactionId: 'verified-bridge-signature' });
  delete bridgeDeposit.outcome;
  const steps = [deposit(), bridgeDeposit,
    deposit({ id: 'eth-deposit', network: BRIDGE_ETHEREUM, wallet: config.ethereumWallet!.toUpperCase(), evidence: { provider: 'euler' }, transactionId: 'verified-ethereum-hash' }),
    deposit({ id: 'other-wallet', wallet: 'another-solana-wallet', transactionId: 'other-wallet-signature' }),
    ...(['PREPARED', 'RESERVED', 'SIGNED', 'SUBMITTED', 'CONFIRMED', 'CANCELLED', 'REJECTED', 'FAILED'] as const).map((state) => deposit({ id: state, state })),
    ...(['LENDING_APPROVAL', 'LENDING_WITHDRAW', 'DESTINATION_MINT', 'SOURCE_BURN'] as const).map((kind) => deposit({ id: kind, kind }))];
  render(<ProviderDetails config={config} markets={markets()} error="" steps={steps} bridges={[bridge]} />);
  const history = within(screen.getByRole('list', { name: 'Verified deposit destinations' }));
  expect(history.getAllByRole('listitem')).toHaveLength(3);
  expect(history.getByText('Jupiter')).toBeInTheDocument();
  expect(history.getByText('Kamino')).toBeInTheDocument();
  expect(history.getByText('Euler')).toBeInTheDocument();
  expect(history.getAllByText(/0\.999999 USDC deposited/)).toHaveLength(2);
  expect(history.queryByText(/1 USDC deposited/)).toBeNull();
  expect(history.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(expect.arrayContaining([
    'https://solscan.io/tx/verified-deposit-signature', 'https://solscan.io/tx/verified-bridge-signature', 'https://etherscan.io/tx/verified-ethereum-hash',
  ]));
});

it('keeps known onchain positions visible without inventing deposit history', () => {
  render(<ProviderDetails config={{ ...config, ethereumWallet: null }} markets={markets().map((market) => market.id === 'jupiter' ? { ...market, supplied: '5000000', shares: '4800000' } : market)} error="" steps={[deposit({ state: 'CANCELLED' })]} bridges={[]} />);
  expect(within(screen.getByRole('row', { name: /Jupiter/ })).getByText('5 USDC')).toBeInTheDocument();
  expect(within(screen.getByRole('row', { name: /Aave V3/ })).getByText('No wallet selected')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Verified deposit destinations' })).toBeNull();
});
