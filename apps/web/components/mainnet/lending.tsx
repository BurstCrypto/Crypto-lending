'use client';

import { useEffect, useRef, useState } from 'react';
import { bridgeApi, type BridgeWallets } from '@/lib/mainnet/bridge-client';
import { BRIDGE_ETHEREUM, BRIDGE_SOLANA, completedStep, type BridgeRecord, type BridgeStep, type LocalWalletConfig } from '@/lib/mainnet/bridge-types';
import { SmartLendingPanel } from '@/components/lending/smart-lending-panel';
import type { SmartLendingQuote, LendingMarketView } from '@/lib/lending/smart-lending';
import { LENDING_PROVIDERS, MARKETS, type LendingProvider } from '@/lib/lending/markets';
import { ProviderDetails } from './provider-details';
import styles from './mainnet-test.module.css';

const units = (value: unknown, decimals = 6) => {
  try { const n = BigInt(String(value)); return `${n / 10n ** BigInt(decimals)}.${(n % 10n ** BigInt(decimals)).toString().padStart(decimals, '0')}`.replace(/\.?0+$/, '') || '0'; }
  catch { return '—'; }
};
const markets = LENDING_PROVIDERS.map((id) => ({ id, ...MARKETS[id], chain: MARKETS[id].network === BRIDGE_ETHEREUM ? 'Ethereum' : 'Solana', anchor: 'lend-' + id }));
const networks = [{ network: BRIDGE_ETHEREUM, chain: 'Ethereum' }, { network: BRIDGE_SOLANA, chain: 'Solana' }] as const;
const titles: Partial<Record<BridgeStep['kind'], string>> = {
  LENDING_APPROVAL: 'Review the USDC allowance', LENDING_REVOKE: 'Clear the previous allowance',
  LENDING_SUPPLY: 'Review your deposit', LENDING_WITHDRAW: 'Review your withdrawal',
  DEPLOY_LENDING: 'Set up Ethereum lending',
};
interface Props {
  config: LocalWalletConfig | null | undefined;
  connected: boolean;
  busy: boolean;
  paused: boolean;
  bridgePending: boolean;
  steps: BridgeStep[];
  balances: Record<string, unknown> | null;
  setupToken: string;
  showProviderDetails?: boolean;
  bridgeSteps?: BridgeStep[];
  bridges?: BridgeRecord[];
  connector: () => BridgeWallets;
  run: (action: () => Promise<unknown>) => Promise<void>;
  refreshBalances: () => Promise<void>;
}

export function LocalLending({ config, connected, busy, paused, bridgePending, steps, balances, setupToken, showProviderDetails = false, bridgeSteps = [], bridges = [], connector, run, refreshBalances }: Props) {
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<Record<string, string>>({});
  const [walletStatus, setWalletStatus] = useState<{ id: string; message: string; error: boolean } | null>(null);
  const [marketData, setMarketData] = useState<LendingMarketView[]>([]);
  const [marketError, setMarketError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false), [quoteError, setQuoteError] = useState('');
  const comparisonRequest = useRef(0);
  const finalizedPositions = steps.filter((step) => step.state === 'FINALIZED').map((step) => step.id).sort().join(':');
  useEffect(() => {
    let active = true;
    if (!config?.ethereumWallet && !config?.solanaWallet) return;
    const refreshRates = () => { void bridgeApi<LendingMarketView[]>('markets', {}, setupToken).then((rows) => {
      if (!Array.isArray(rows) || rows.length !== LENDING_PROVIDERS.length || new Set(rows.map((row) => row.id)).size !== rows.length ||
        rows.some((row) => !LENDING_PROVIDERS.includes(row.id) || [row.shares, row.supplied, row.apyBasisPoints, row.receiptExchangeRate ?? null].some((value) => value !== null && !/^\d+$/.test(value)))) throw new Error('Live market data is unavailable. Refresh the workspace.');
      if (active) { setMarketData(rows); setMarketError(''); }
    }).catch((error: Error) => { if (active) setMarketError(error.message); }); };
    const initial = setTimeout(refreshRates, 0);
    const timer = setInterval(refreshRates, 60_000);
    return () => { active = false; clearTimeout(initial); clearInterval(timer); };
  }, [setupToken, config?.ethereumWallet, config?.solanaWallet, finalizedPositions]);
  const walletKey = `${config?.ethereumWallet ?? ''}:${config?.solanaWallet ?? ''}`;
  const [quoted, setQuoted] = useState<{ quote: SmartLendingQuote; walletKey: string } | null>(null);
  const quote = quoted?.walletKey === walletKey ? quoted.quote : null;
  useEffect(() => { comparisonRequest.current++; }, [config?.ethereumWallet, config?.solanaWallet, connected]);
  const api = <T,>(operation: string, fields: Record<string, unknown>) => bridgeApi<T>(`lending-${operation}`, fields, setupToken);
  async function prepare(provider: LendingProvider, action: 'supply' | 'withdraw', amount = '') {
    if (!config) return;
    const network = MARKETS[provider].network;
    await connector().check({ ethereumWallet: network === BRIDGE_ETHEREUM ? config.ethereumWallet : null, solanaWallet: network === BRIDGE_SOLANA ? config.solanaWallet : null });
    setReviewed(null);
    await api('prepare', { provider, network, action, amount: action === 'withdraw' ? 'all' : amount });
  }
  async function reconcile(step: BridgeStep) {
    const result = await api<BridgeStep>('reconcile', { id: step.id });
    if (completedStep(result.state)) await refreshBalances();
  }
  function savedHash(step: BridgeStep) {
    if (recovery[step.id] !== undefined) return recovery[step.id];
    try { const saved = JSON.parse(localStorage.getItem(`bonsai-mainnet:${step.id}`) ?? 'null'); return saved?.fingerprint === step.fingerprint && typeof saved.transactionId === 'string' ? saved.transactionId : ''; }
    catch { return ''; }
  }

  const smartPrepared = (result: { quote: SmartLendingQuote; bridge?: unknown; step?: BridgeStep | null }) => {
    setQuoted({ quote: result.quote, walletKey }); setReviewed(null);
    if (result.bridge) {
      const section = document.getElementById('bridge');
      if (section instanceof HTMLDetailsElement) section.open = true;
      section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } else document.getElementById('lending-positions')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  const transactionsFor = (provider: LendingProvider) => steps.filter((step) => (step.evidence.provider ?? (step.network === BRIDGE_ETHEREUM ? 'aave' : 'kamino')) === provider);
  const positions = markets.filter((market) => {
    const position = marketData.find((row) => row.id === market.id);
    const wallet = market.network === BRIDGE_ETHEREUM ? config?.ethereumWallet : config?.solanaWallet;
    return transactionsFor(market.id).length > 0 || Boolean(wallet && position && (BigInt(position.shares ?? '0') > 0n || BigInt(position.supplied ?? '0') > 0n));
  });
  const incompleteBalances = marketData.some((position) => position.error && (MARKETS[position.id].network === BRIDGE_ETHEREUM ? config?.ethereumWallet : config?.solanaWallet));
  return <><SmartLendingPanel wallets={networks.filter((market) => market.network === BRIDGE_ETHEREUM ? config?.ethereumWallet : config?.solanaWallet).map((market) => ({ network: market.network,
      balance: String((balances?.[market.network === BRIDGE_ETHEREUM ? 'ethereum' : 'solana'] as Record<string, unknown> | undefined)?.usdc ?? '') || null }))}
    connected={connected && Boolean(config)} busy={busy} depositsDisabled={paused || bridgePending || steps.some((step) => !completedStep(step.state))}
    quote={quote} markets={marketData} quoteLoading={quoteLoading} quoteError={quoteError} onCompare={async (input) => {
      if (!config || !connected) return;
      const request = ++comparisonRequest.current;
      setQuoteLoading(true); setQuoteError('');
      try {
        await connector().check({ ethereumWallet: input.sourceNetwork === BRIDGE_ETHEREUM || input.includeCrossChain ? config.ethereumWallet : null,
          solanaWallet: input.sourceNetwork === BRIDGE_SOLANA || input.includeCrossChain ? config.solanaWallet : null });
        const result = await bridgeApi<SmartLendingQuote>('smart-lending-compare', { input }, setupToken);
        if (comparisonRequest.current === request) setQuoted({ quote: result, walletKey });
      } catch (error) { if (comparisonRequest.current === request) setQuoteError(error instanceof Error ? error.message : 'Live rates could not be loaded.'); }
      finally { if (comparisonRequest.current === request) setQuoteLoading(false); }
    }} onReview={(id) => void run(async () => {
      if (!config) return;
      await connector().check(config);
      smartPrepared(await bridgeApi('smart-lending-prepare', { id }, setupToken));
    })} />
  {showProviderDetails && <ProviderDetails config={config} markets={marketData} error={marketError} steps={[...steps, ...bridgeSteps]} bridges={bridges} />}
  <section id="lending-positions" aria-labelledby="lending-title">
    <div className={styles.overview}>
      <div><p className="eyebrow">Your lending</p><h2 id="lending-title">Deposits and withdrawals</h2>
        <p>Review your deposits and withdraw to your wallet. Smart Lending handles the destination.</p></div>
      <p className={styles.muted}>Same-network deposits have a 0.10% routing fee. Bridging has a 0.20% routing fee. Network fees apply separately.</p>
    </div>
    {marketError && <p role="alert">{marketError}</p>}
    {incompleteBalances && <p role="status">Some lending balances could not be refreshed. Check live readiness again before withdrawing.</p>}
    {paused && <p role="status">New deposits are paused. Withdrawals remain available.</p>}
    {bridgePending && <p role="status">Finish or recover your current bridge before starting another deposit or withdrawal.</p>}
    {positions.length === 0 && <p className={styles.muted}>{!connected ? 'Connect your wallet to view your lending positions.'
      : marketError || incompleteBalances ? 'Your lending balances are temporarily unavailable.'
        : marketData.length === 0 ? 'Loading your lending balances…' : 'No lending positions yet. Use Smart Lending above to plan your first deposit.'}</p>}
    <div className={styles.markets}>
      {positions.map((market, index) => {
        const ethereum = market.network === BRIDGE_ETHEREUM;
        const wallet = ethereum ? config?.ethereumWallet : config?.solanaWallet;
        const ready = Boolean(connected && wallet && config);
        const transactions = transactionsFor(market.id);
        const position = marketData.find((row) => row.id === market.id);
        const pending = transactions.some((step) => !completedStep(step.state));
        const latest = transactions[0];
        const visible = transactions.filter((step) => !completedStep(step.state) || step.id === latest?.id);
        const positionLabel = `${market.chain} lending position ${index + 1}`;
        return <article key={market.id} className="platform-card" aria-label={positionLabel}>
          <div className="platform-card__heading"><div><p className="platform-ecosystem">{market.chain}</p><h3>Lending position {index + 1}</h3></div><span className="platform-status">USDC</span></div>
          {showProviderDetails && <p className={styles.muted}>Provider: {market.name}</p>}
          {position?.error && <p role="status">This lending balance could not be refreshed. Check live readiness again.</p>}
          <dl><dt>Current supply APY</dt><dd>{position?.apyBasisPoints == null ? '—' : `${(Number(position.apyBasisPoints) / 100).toFixed(2)}%`}</dd>
            <dt>Current deposit value</dt><dd>{units(wallet && !marketError && !position?.error ? position?.supplied : undefined)} USDC</dd>
            <dt>Withdrawal routing fee</dt><dd>0 USDC</dd></dl>
          <p className={styles.muted}>{position && position.supplied === null && BigInt(position.shares ?? '0') > 0n
            ? 'Your deposit is recorded. Its current USDC value is temporarily unavailable.'
            : 'Includes accrued lending interest. The final withdrawal amount is checked when you review it.'}</p>
          <button type="button" aria-label={`Withdraw all from ${positionLabel}`} disabled={busy || !ready || pending || bridgePending || !position?.shares || BigInt(position.shares) === 0n} onClick={() => void run(() => prepare(market.id, 'withdraw'))}>Withdraw all</button>
          {!ready && <p className={styles.muted}><a href="#wallets">Connect {ethereum ? 'an Ethereum' : 'a Solana'} wallet</a> to manage this position.</p>}
          {ready && <p className={styles.muted}>Review first, then approve each transaction in your wallet or on your Ledger.</p>}
          {visible.map((step) => <div className={styles.lendingReview} key={step.id} aria-label={`${market.chain} transaction review`}>
            <h4>{titles[step.kind]}</h4><p role="status"><strong>{step.state === 'FINALIZED' ? step.kind === 'LENDING_SUPPLY' ? 'Deposit verified' : step.kind === 'LENDING_WITHDRAW' ? 'Withdrawal verified' : 'Approval verified' : step.state.replaceAll('_', ' ')}</strong></p>
            {step.evidence.smartQuoteId && <p>Your Smart Lending plan uses {(Number(step.evidence.smartApyBasisPoints) / 100).toFixed(2)}% supply APY for a {step.evidence.smartHoldingDays}-day estimate. The rate can change.</p>}
            <dl><dt>{step.outcome ? 'Verified USDC amount' : step.kind === 'LENDING_WITHDRAW' ? 'Estimated USDC returned' : !ethereum && step.kind === 'LENDING_SUPPLY' ? 'Maximum USDC deposited' : 'USDC amount'}</dt><dd>{units(step.outcome?.usdcAmount ?? step.evidence.amount)} USDC</dd>
              {!step.outcome && step.evidence.expectedDebit && <><dt>Estimated USDC deposited</dt><dd>{units(step.evidence.expectedDebit)} USDC</dd></>}
              <dt>Network</dt><dd>{market.chain} mainnet</dd><dt>Wallet</dt><dd>{step.wallet}</dd>
              <dt>Maximum network cost</dt><dd>{units(step.maxNetworkCost, ethereum ? 18 : 9)} {ethereum ? 'ETH' : 'SOL, including account rent'}</dd>
              <dt>{['LENDING_APPROVAL', 'LENDING_REVOKE', 'DEPLOY_LENDING'].includes(step.kind) ? 'Routing fee on deposit' : 'Routing fee'}</dt><dd>{units(step.evidence.platformFee)} USDC</dd>
              {step.evidence.totalSourceDebit && step.kind !== 'LENDING_WITHDRAW' && <><dt>Total USDC for deposit and routing fee</dt><dd>{units(step.evidence.totalSourceDebit)} USDC</dd></>}</dl>
            {step.kind === 'DEPLOY_LENDING' && <p>This one-time setup enables Ethereum deposits with a 0.10% routing fee. This transaction pays only the setup network cost. Review the USDC approval and deposit after it finishes.</p>}
            {step.kind === 'LENDING_APPROVAL' && <p>This approves exactly {units(step.evidence.amount)} USDC for your Smart Lending deposit. After it finalizes, review and confirm the deposit separately.</p>}
            {step.kind === 'LENDING_REVOKE' && <p>Clear the existing lending allowance before approving the exact deposit amount.</p>}
            {step.kind === 'LENDING_WITHDRAW' && <p>Redeem the full position to this same wallet. The received amount includes accrued interest and may change before execution.</p>}
            {walletStatus?.id === step.id ? <p role={walletStatus.error ? 'alert' : 'status'} aria-label="Wallet request" className={walletStatus.error ? styles.error : styles.muted}>{walletStatus.message}</p>
              : step.walletError && !completedStep(step.state) && <p role="alert" aria-label="Wallet request" className={styles.error}>{step.walletError}</p>}
            {step.state === 'PREPARED' && <>
              <p className={styles.muted}>Review expires at {new Date(step.expiresAt).toLocaleTimeString()}. Check the account, amount and network in your wallet.</p>
              <label className={styles.check}><input type="checkbox" checked={reviewed === step.id} onChange={(event) => setReviewed(event.target.checked ? step.id : null)} />I reviewed this transaction and its network cost.</label>
              <button disabled={busy || !ready || reviewed !== step.id} onClick={() => void run(async () => {
                setWalletStatus({ id: step.id, message: 'Checking balances and transaction readiness before opening your wallet…', error: false });
                try {
                  const result = await connector().send(step, config!, undefined, (hash) => setRecovery((previous) => ({ ...previous, [step.id]: hash })), setupToken,
                    (message) => setWalletStatus({ id: step.id, message, error: false })) as BridgeStep;
                  setWalletStatus(null);
                  if (result?.state === 'FINALIZED') await refreshBalances();
                } catch (error) {
                  setWalletStatus({ id: step.id, message: error instanceof Error ? error.message : 'The wallet request could not complete.', error: true });
                  throw error;
                }
              })}>Confirm {market.chain} transaction in wallet</button>
              <button disabled={busy} onClick={() => void run(() => api('cancel-step', { id: step.id }))}>Cancel {market.chain} review</button>
            </>}
            {!completedStep(step.state) && step.state !== 'PREPARED' && <>
              <p>Check the saved transaction before starting another. Pending transactions are kept when you reload.</p>
              {step.state === 'SIGNED' && <button disabled={busy || !ready} onClick={() => void run(() => connector().dispatch(step, config!, setupToken))}>Send saved Solana transaction once</button>}
              {step.transactionId ? <button disabled={busy} onClick={() => void run(() => reconcile(step))}>Check {market.chain} transaction status</button> : !ethereum && step.state === 'RESERVED' ? <>
                <p>If no wallet prompt appeared, check this request. An expired request is cleared only after confirming it never reached the network.</p>
                <button disabled={busy} onClick={() => void run(() => api('recover-wallet-request', { id: step.id }))}>Check wallet request</button>
              </> : <>
                <label>Original {market.chain} transaction hash<input value={savedHash(step)} onChange={(event) => setRecovery({ ...recovery, [step.id]: event.target.value.trim() })} /></label>
                <button disabled={busy || !savedHash(step)} onClick={() => void run(() => api('submitted', { id: step.id, transactionId: savedHash(step) }))}>Recover {market.chain} transaction</button>
              </>}
            </>}
            {step.state === 'FINALIZED' && ['DEPLOY_LENDING', 'LENDING_APPROVAL', 'LENDING_REVOKE'].includes(step.kind) && <button disabled={busy || !ready || pending || paused || (bridgePending && !step.evidence.fundingBridgeId)} onClick={() => void run(async () => {
              if (step.evidence.fundingBridgeId) await bridgeApi('destination', { id: step.evidence.fundingBridgeId, mode: 'supply-only' }, setupToken);
              else if (step.evidence.smartQuoteId) smartPrepared(await bridgeApi('smart-lending-continue', { id: step.id }, setupToken));
              else await prepare(market.id, 'supply', step.evidence.lendAmount);
            })}>Continue deposit</button>}
            {(step.transactionId || savedHash(step)) && <p><a target="_blank" rel="noreferrer" href={`${ethereum ? 'https://etherscan.io/tx/' : 'https://solscan.io/tx/'}${encodeURIComponent(step.transactionId || savedHash(step))}`}>View {market.chain} transaction</a></p>}
          </div>)}
          {transactions.length > visible.length && <details><summary>Earlier transactions</summary>{transactions.filter((step) => !visible.includes(step)).map((step) => <p key={step.id}>{titles[step.kind]} · {step.state} · {units(step.evidence.amount)} USDC</p>)}</details>}
        </article>;
      })}
    </div>
  </section></>;
}
