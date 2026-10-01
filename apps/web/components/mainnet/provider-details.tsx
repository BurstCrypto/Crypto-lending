'use client';

import { useEffect, useState } from 'react';
import { isLendingProvider, LENDING_PROVIDERS, MARKETS } from '@/lib/lending/markets';
import type { LendingMarketView } from '@/lib/lending/smart-lending';
import { BRIDGE_ETHEREUM, type BridgeRecord, type BridgeStep, type LocalWalletConfig } from '@/lib/mainnet/bridge-types';
import styles from './mainnet-test.module.css';

interface Props {
  config: LocalWalletConfig | null | undefined;
  markets: LendingMarketView[];
  error: string;
  steps: BridgeStep[];
  bridges: BridgeRecord[];
}

function units(value: string) {
  const amount = BigInt(value);
  return `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, '0')}`.replace(/\.?0+$/, '');
}

function currentBalance(market: LendingMarketView | undefined, wallet: string | null | undefined, unavailable: boolean) {
  if (!wallet) return 'No wallet selected';
  if (unavailable || market?.error) return 'Unavailable';
  if (!market) return 'Loading…';
  if (market.supplied !== null) return `${units(market.supplied)} USDC`;
  if (market.shares === '0') return '0 USDC';
  return market.shares !== null && BigInt(market.shares) > 0n ? 'USDC value unavailable' : 'Unavailable';
}

function depositProvider(step: BridgeStep, bridges: BridgeRecord[]) {
  const recorded = step.evidence.provider ?? bridges.find((bridge) => bridge.id === step.bridgeId)?.destinationProvider;
  if (recorded !== undefined) return isLendingProvider(recorded) && MARKETS[recorded].network === step.network ? MARKETS[recorded].name : 'Provider unavailable';
  // Older bridge transactions only supported these two destination markets.
  return MARKETS[step.network === BRIDGE_ETHEREUM ? 'aave' : 'kamino'].name;
}

/** Read-only information mounted only by the server-gated local workspace. */
export function ProviderDetails({ config, markets, error, steps, bridges }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const deposits = steps.filter((step) => {
    if (step.state !== 'FINALIZED' || !['LENDING_SUPPLY', 'DESTINATION_SUPPLY', 'DESTINATION_MINT_SUPPLY'].includes(step.kind)) return false;
    const wallet = step.network === BRIDGE_ETHEREUM ? config?.ethereumWallet : config?.solanaWallet;
    return Boolean(wallet && (step.network === BRIDGE_ETHEREUM ? step.wallet.toLowerCase() === wallet.toLowerCase() : step.wallet === wallet));
  }).sort((left, right) => right.createdAt - left.createdAt);

  return <aside className={styles.card} aria-labelledby="provider-details-title" data-local-provider-details>
    <p className="eyebrow">Local mainnet</p>
    <h2 id="provider-details-title">Lending providers</h2>
    <p>Live provider rates and the destinations of your deposits. Smart Lending selects the provider automatically.</p>
    {error && <p role="status">Provider rates and balances could not be refreshed.</p>}
    <div className={styles.tableScroll}>
      <table className={styles.providerTable} aria-label="Provider APYs and your positions">
        <thead><tr><th scope="col">Provider</th><th scope="col">Network</th><th scope="col">Supply APY</th><th scope="col">Your current position</th></tr></thead>
        <tbody>{LENDING_PROVIDERS.map((id) => {
          const provider = MARKETS[id], market = markets.find((row) => row.id === id);
          const ethereum = provider.network === BRIDGE_ETHEREUM;
          const fresh = !error && !market?.error && market?.observedAt != null && now - market.observedAt <= 120_000 && market.observedAt <= now + 15_000;
          const apy = fresh && market?.apyBasisPoints !== null && market?.apyBasisPoints !== undefined ? `${(Number(market.apyBasisPoints) / 100).toFixed(2)}%` : 'Unavailable';
          return <tr key={id}>
            <th scope="row">{provider.name}</th>
            <td>{ethereum ? 'Ethereum' : 'Solana'}</td>
            <td>{!market && !error ? config?.ethereumWallet || config?.solanaWallet ? 'Loading…' : 'Connect a wallet' : apy}{market && !market.available && <span className={styles.tableNote}>Deposits unavailable</span>}</td>
            <td>{currentBalance(market, ethereum ? config?.ethereumWallet : config?.solanaWallet, Boolean(error))}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className={styles.muted}>Positions show their current USDC value, including accrued lending interest, using the saved wallet addresses.</p>
    {markets.filter((market) => market.id === 'kamino' && market.shares !== null && BigInt(market.shares) > 0n && !market.error && !error).map((market) =>
      <details key={market.id}><summary>Receipt token details</summary>
        <p>{MARKETS[market.id].name}: {units(market.shares!)} receipt tokens.</p>
        <p>{market.receiptExchangeRate ? `Exchange rate: 1 receipt token ≈ ${units((BigInt(market.receiptExchangeRate) / 1_000_000_000_000n).toString())} USDC.` : 'Exchange rate unavailable.'}</p>
      </details>)}
    <h3>Verified deposit destinations</h3>
    {deposits.length === 0 ? <p className={styles.muted}>No verified deposits recorded for these wallets yet.</p> : <ul className={styles.depositList} aria-label="Verified deposit destinations">
      {deposits.map((step) => <li key={step.id}>
        <strong>{depositProvider(step, bridges)}</strong> · {step.network === BRIDGE_ETHEREUM ? 'Ethereum' : 'Solana'}
        {step.outcome && <> · {units(step.outcome.usdcAmount)} USDC deposited</>}
        {step.transactionId && <> · <a target="_blank" rel="noreferrer" href={`${step.network === BRIDGE_ETHEREUM ? 'https://etherscan.io/tx/' : 'https://solscan.io/tx/'}${encodeURIComponent(step.transactionId)}`}>View verified transaction</a></>}
      </li>)}
    </ul>}
  </aside>;
}
