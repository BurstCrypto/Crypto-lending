'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  LendingMarketView,
  LendingNetwork,
  SmartLendingInput,
  SmartLendingQuote,
} from '@/lib/lending/smart-lending';
import { MARKETS } from '@/lib/lending/markets';
import styles from './smart-lending-panel.module.css';

const ETH: LendingNetwork = 'eip155:1';
const chain = (network: LendingNetwork) => (network === ETH ? 'Ethereum' : 'Solana');
export function lendingDollars(value: string | null) {
  if (value === null) return '—';
  const number = Number(value) / 1e18;
  if (number !== 0 && Math.abs(number) < 0.01) return `${number < 0 ? '−' : ''}<$0.01`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}
export function lendingUsdc(value: string) {
  const amount = BigInt(value),
    whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} USDC`;
}
export interface SmartLendingPanelProps {
  wallets: { network: LendingNetwork; balance: string | null }[];
  connected: boolean;
  busy: boolean;
  depositsDisabled: boolean;
  quote: SmartLendingQuote | null;
  markets?: LendingMarketView[];
  quoteLoading?: boolean;
  quoteError?: string;
  onCompare: (input: SmartLendingInput) => void;
  onReview: (id: string) => void;
}

/** Presentation uses the production design tokens and has no local/auth/RPC imports. */
export function SmartLendingPanel({
  wallets,
  connected,
  busy,
  depositsDisabled,
  quote,
  markets = [],
  quoteLoading = false,
  quoteError = '',
  onCompare,
  onReview,
}: SmartLendingPanelProps) {
  const [source, setSource] = useState<LendingNetwork>(wallets[0]?.network ?? ETH);
  const [amount, setAmount] = useState(''),
    [days, setDays] = useState(30),
    [crossChain, setCrossChain] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const selectedWallet = wallets.find((wallet) => wallet.network === source) ?? wallets[0];
  const input: SmartLendingInput = {
    sourceNetwork: selectedWallet?.network ?? ETH,
    amount,
    holdingDays: days,
    includeCrossChain: crossChain,
  };
  const missingWallet =
    wallets.length === 1
      ? wallets[0]!.network === ETH
        ? 'a Solana wallet'
        : 'an Ethereum wallet'
      : 'both wallets';
  const matches =
    quote &&
    quote.input.sourceNetwork === input.sourceNetwork &&
    quote.input.amount === amount &&
    quote.input.holdingDays === days &&
    quote.input.includeCrossChain === input.includeCrossChain;
  const current = matches && quote.expiresAt > now;
  const selected = quote?.routes.find((route) => route.id === quote.selectedId);
  const validAmount = /^\d+(?:\.\d{1,6})?$/.test(amount) && Number(amount) > 0;
  const compare = useRef(onCompare);
  useEffect(() => {
    compare.current = onCompare;
  }, [onCompare]);
  useEffect(() => {
    if (!connected || !validAmount || current || busy) return;
    const timer = setTimeout(
      () =>
        compare.current({
          sourceNetwork: input.sourceNetwork,
          amount,
          holdingDays: days,
          includeCrossChain: crossChain,
        }),
      650,
    );
    return () => clearTimeout(timer);
  }, [connected, validAmount, current, busy, input.sourceNetwork, amount, days, crossChain]);
  const available = markets
    .filter(
      (market) =>
        MARKETS[market.id].network === input.sourceNetwork &&
        market.available &&
        !market.error &&
        market.apyBasisPoints !== null &&
        (market.capacity === null || BigInt(market.capacity) > 0n) &&
        market.observedAt !== null &&
        market.observedAt <= now + 15_000 &&
        now - market.observedAt < 120_000,
    )
    .sort((a, b) => Number(b.apyBasisPoints) - Number(a.apyBasisPoints))[0];
  const apy =
    current && selected ? selected.apyBasisPoints : !validAmount ? available?.apyBasisPoints : null;
  return (
    <section id="lending" className={styles.panel} aria-labelledby="smart-lending-title">
      <header>
        <p className="eyebrow">Smart lending</p>
        <h2 id="smart-lending-title">Put your USDC to work.</h2>
        <p>
          Enter an amount. Smart Lending automatically selects where to lend and shows your rate and
          fees. Approve the deposit in your wallet.
        </p>
      </header>
      <div className={styles.rate} aria-live="polite" aria-label="Live lending APY">
        <span>{current && selected ? 'Your supply APY' : 'Available supply APY'}</span>
        <strong>
          {apy != null
            ? `${(Number(apy) / 100).toFixed(2)}%`
            : quoteError
              ? 'Unavailable'
              : markets.length === 0 || (validAmount && !current)
                ? 'Loading rate…'
                : 'Unavailable'}
        </strong>
        <small>
          {validAmount
            ? 'Selected automatically for your deposit. Rates can change.'
            : 'Live rate on your selected network. Enter an amount for your deposit estimate.'}
        </small>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (
            connected &&
            current &&
            selected &&
            !busy &&
            !depositsDisabled &&
            selected.fundingReasons.length === 0
          )
            onReview(quote.id);
        }}
      >
        <div className={styles.inputs}>
          <label>
            USDC source wallet
            <select
              value={input.sourceNetwork}
              disabled={busy || !wallets.length}
              onChange={(event) => setSource(event.target.value as LendingNetwork)}
            >
              {wallets.length ? (
                wallets.map((wallet) => (
                  <option key={wallet.network} value={wallet.network}>
                    {chain(wallet.network)}
                  </option>
                ))
              ) : (
                <option value={ETH}>Connect a wallet</option>
              )}
            </select>
          </label>
          <label>
            USDC amount
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="100"
              inputMode="decimal"
              required
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <label>
            Expected holding period
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              disabled={busy}
            >
              {[7, 30, 90, 365].map((value) => (
                <option key={value} value={value}>
                  {value} days
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedWallet?.balance !== null && selectedWallet?.balance !== undefined && (
          <p className={styles.help}>
            Available in this wallet: {Number(selectedWallet.balance) / 1e6} USDC. Network fees are
            paid with {input.sourceNetwork === ETH ? 'ETH' : 'SOL'}.
          </p>
        )}
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={input.includeCrossChain}
            disabled={busy}
            aria-describedby="smart-lending-bridge-help"
            onChange={(event) => setCrossChain(event.target.checked)}
          />
          Consider bridging if it improves the net return
        </label>
        <p id="smart-lending-bridge-help" className={styles.help} aria-live="polite">
          {crossChain && wallets.length !== 2 ? (
            <>
              <a href="#wallets">Connect {missingWallet}</a> before Smart Lending can recommend a
              bridge. You can still lend on your connected network.
            </>
          ) : crossChain ? (
            'Smart Lending will consider bridging only when the estimated return after costs is better.'
          ) : (
            'Smart Lending will use the network of your source wallet.'
          )}
        </p>
        {!connected && (
          <p className={styles.help}>
            <a href="#wallets">Connect your wallet</a> to make a deposit.
          </p>
        )}
      </form>
      {quoteLoading && (
        <p role="status" className={styles.help}>
          Updating your APY and deposit estimate…
        </p>
      )}
      {quoteError && (
        <p role="alert">
          {quoteError}{' '}
          <button
            type="button"
            disabled={busy || quoteLoading || !validAmount}
            onClick={() => onCompare(input)}
          >
            Retry live rates
          </button>
        </p>
      )}
      {quote && (
        <>
          {!current && validAmount && !quoteLoading && !quoteError && (
            <p role="status" className={styles.status}>
              Updating the estimate for your deposit…
            </p>
          )}
          {selected && current ? (
            <div className={styles.recommendation}>
              <p className="eyebrow">Your smart lending plan</p>
              <h3>
                {selected.routeKind === 'CROSS_CHAIN' ? 'Bridge and lend' : 'Lend'}{' '}
                {quote.input.amount} USDC
              </h3>
              <p>
                Estimated net earnings: <strong>{lendingDollars(selected.netBenefitUsd)}</strong>{' '}
                over {quote.input.holdingDays} days.
              </p>
              {selected.netBenefitUsd !== null && BigInt(selected.netBenefitUsd) < 0n && (
                <p role="status" className={styles.costNotice}>
                  Estimated deposit and withdrawal costs exceed the interest for this holding
                  period. You can still review and make this deposit.
                </p>
              )}
              <dl className={styles.estimate}>
                <dt>Network</dt>
                <dd>
                  {chain(selected.network)}
                  {selected.routeKind === 'CROSS_CHAIN' ? ' · Bridge required' : ''}
                </dd>
                {selected.routingFee && (
                  <>
                    <dt>Our routing fee ({(selected.routingFee.basisPoints / 100).toFixed(2)}%)</dt>
                    <dd>{lendingUsdc(selected.routingFee.depositUsdc)}</dd>
                    <dt>Total USDC from your wallet</dt>
                    <dd>{lendingUsdc(selected.routingFee.totalSourceDebitUsdc)}</dd>
                    {BigInt(selected.routingFee.estimatedReturnUsdc) > 0n && (
                      <>
                        <dt>Estimated return routing fee</dt>
                        <dd>{lendingUsdc(selected.routingFee.estimatedReturnUsdc)}</dd>
                      </>
                    )}
                  </>
                )}
                <dt>Estimated deposit costs</dt>
                <dd>{lendingDollars(selected.entryCostUsd)}</dd>
                <dt>Estimated withdrawal costs</dt>
                <dd>{lendingDollars(selected.exitCostUsd)}</dd>
                {selected.breakEvenDays !== null && (
                  <>
                    <dt>Estimated time to recover costs</dt>
                    <dd>{selected.breakEvenDays} days</dd>
                  </>
                )}
              </dl>
              {selected.routingFee && (
                <p className={styles.help}>
                  Routing fees are included in the cost estimates and net earnings above. Network
                  fees are paid separately in ETH or SOL.
                  {BigInt(selected.routingFee.estimatedReturnUsdc) > 0n
                    ? ' The return estimate includes a bridge back to your source network.'
                    : ''}
                </p>
              )}
              {selected.fundingReasons.length > 0 && (
                <p role="status">
                  Your wallet needs additional funding for this deposit and its network fees.
                </p>
              )}
              <button
                disabled={
                  busy || !connected || depositsDisabled || selected.fundingReasons.length > 0
                }
                onClick={() => onReview(quote.id)}
              >
                Review deposit
              </button>
            </div>
          ) : (
            current && (
              <p role="status">
                {quote.unavailableReason ??
                  'Live wallet or market checks could not be completed. Refresh your live wallet balances and try again.'}
              </p>
            )
          )}
        </>
      )}
      <details className={styles.method}>
        <summary>How Smart Lending works</summary>
        <p>
          Smart Lending automatically selects an available USDC lending destination using live
          rates, your wallet balance, and estimated earnings after costs. You choose the amount and
          holding period.
        </p>
        <p>
          A deposit does not need to cover its costs within your chosen holding period. Smart
          Lending chooses the best available funded plan and shows when the estimated net earnings
          are negative.
        </p>
        <p>
          APYs vary and exclude incentive rewards. The estimate uses the current rate over your
          chosen period, conservatively deducts entry costs before calculating earnings, then
          subtracts entry and exit costs. Gas is paid separately in ETH or SOL; USDC account rent is
          included where needed. Future costs and returns can change.
        </p>
        <p>
          Cross-chain estimates include a return to the source network and use conservative
          transaction budgets. A cross-chain route needs an eligible same-chain comparison and at
          least $0.01 more estimated net earnings. Same-network deposits have a 0.10% routing fee;
          bridging has a 0.20% routing fee.
        </p>
        <p>
          This chooses a route for each deposit. It does not automatically move existing deposits
          when rates change.
        </p>
      </details>
    </section>
  );
}
