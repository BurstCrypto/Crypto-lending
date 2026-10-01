'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BridgeWallets, bridgeApi, type BridgeWalletChoice } from '@/lib/mainnet/bridge-client';
import { BRIDGE_ETHEREUM, BRIDGE_SOLANA, completedStep, hasBothWallets, type LocalWalletConfig, type BridgeNetwork, type BridgeRecord, type BridgeStep, type BridgeUiState } from '@/lib/mainnet/bridge-types';
import { address } from '@/lib/mainnet/policy';
import { LocalLending } from './lending';
import styles from './mainnet-test.module.css';

const emptySetup = { ethereumWallet: '', solanaWallet: '', ethereumTreasury: '', solanaTreasury: '', ethereumSourceRouter: '', ethereumSupplyRouter: '', ethereumLendingRouter: '', solanaLookupTables: '' };
const money = (value: unknown, decimals = 6) => { try { const n = BigInt(String(value)); return `${n / 10n ** BigInt(decimals)}.${(n % 10n ** BigInt(decimals)).toString().padStart(decimals, '0')}`.replace(/\.?0+$/, '') || '0'; } catch { return '—'; } };
const names: Record<BridgeStep['kind'], string> = {
  SOURCE_APPROVAL: 'Approve the source USDC amount', SOURCE_REVOKE: 'Clear the previous source approval', SOURCE_BURN: 'Bridge USDC to the other chain',
  DESTINATION_APPROVAL: 'Approve destination USDC for lending', DESTINATION_REVOKE: 'Clear the previous destination approval',
  DESTINATION_MINT_SUPPLY: 'Receive USDC and lend', DESTINATION_MINT: 'Receive USDC in your wallet', DESTINATION_SUPPLY: 'Lend received USDC',
  DEPLOY_SOURCE: 'Deploy the Ethereum source router', DEPLOY_SUPPLY: 'Deploy the Ethereum lending router',
  DEPLOY_LENDING: 'Set up Ethereum lending',
  CREATE_LOOKUP_TABLE: 'Create a Solana address table', EXTEND_LOOKUP_TABLE: 'Extend the Solana address table',
  LENDING_APPROVAL: 'Approve USDC for lending', LENDING_REVOKE: 'Clear the lending approval', LENDING_SUPPLY: 'Lend USDC', LENDING_WITHDRAW: 'Withdraw USDC',
};
const explorer = (network: BridgeNetwork, id: string) => network === BRIDGE_ETHEREUM ? `https://etherscan.io/tx/${encodeURIComponent(id)}` : `https://solscan.io/tx/${encodeURIComponent(id)}`;
const errorMessage = (error: unknown) => typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : 'The request did not complete. Please try again.';

export function LocalMainnetTest({ setupToken, initialTreasuries, showProviderDetails = false }: { setupToken: string; initialTreasuries?: { ethereumTreasury: string; solanaTreasury: string }; showProviderDetails?: boolean }) {
  const [state, setState] = useState<BridgeUiState | null>(null), [setup, setSetup] = useState(() => ({ ...emptySetup, ...initialTreasuries })), [editing, setEditing] = useState(false);
  const [choices, setChoices] = useState<BridgeWalletChoice[]>([]), [ethereumChoice, setEthereumChoice] = useState(''), [solanaChoice, setSolanaChoice] = useState('');
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(false), [balanceLoading, setBalanceLoading] = useState(false), [walletError, setWalletError] = useState('');
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<Record<string, string>>({}), [preflight, setPreflight] = useState<Record<string, unknown> | null>(null);
  const wallets = useRef<BridgeWallets | null>(null), working = useRef(false);
  const api = useCallback(<T,>(operation?: string, fields: Record<string, unknown> = {}) => bridgeApi<T>(operation, fields, setupToken), [setupToken]);
  const refresh = useCallback(async () => {
    const next = await api<BridgeUiState>(undefined, {}); setState(next);
    setRecovery((previous) => {
      const saved = { ...previous };
      for (const step of next.steps) {
        try { const entry = JSON.parse(localStorage.getItem(`bonsai-mainnet:${step.id}`) ?? 'null'); if (entry?.fingerprint === step.fingerprint && entry.transactionId) saved[step.id] = entry.transactionId; } catch { /* The server journal remains authoritative. */ }
      }
      return saved;
    });
  }, [api]);
  useEffect(() => {
    const connector = new BridgeWallets(); wallets.current = connector;
    const stop = connector.start(setChoices);
    const initial = setTimeout(() => void refresh().catch((e: Error) => setError(e.message)), 0);
    return () => { clearTimeout(initial); stop(); wallets.current = null; };
  }, [refresh]);
  // Refresh only reads the journal; it never signs, sends, or retries a transaction.
  useEffect(() => { const timer = setInterval(() => { if (!working.current) void refresh().catch(() => undefined); }, 15_000); return () => clearInterval(timer); }, [refresh]);
  async function run(action: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The wallet request did not complete. Check pending transaction status before continuing.'); }
    finally { await refresh().catch((e: Error) => setError(e.message)); working.current = false; setBusy(false); }
  }
  const config = state?.config, bridge = state?.bridges.find((b) => !['LENT', 'SOURCE_FAILED', 'CANCELLED'].includes(b.status));
  const bridgeConfig = config && hasBothWallets(config) ? config : null;
  const activeSteps = [...(state?.steps ?? []), ...(state?.lendingSteps ?? [])].filter((s) => !completedStep(s.state));
  const canRead = Boolean(connected && config);
  const ready = Boolean((state?.authenticated || state?.localAccess) && canRead);
  function edit() {
    if (config) setSetup({ ...config, ethereumWallet: config.ethereumWallet ?? '', solanaWallet: config.solanaWallet ?? '', ethereumSourceRouter: config.ethereumSourceRouter ?? '', ethereumSupplyRouter: config.ethereumSupplyRouter ?? '', ethereumLendingRouter: config.ethereumLendingRouter ?? '', solanaLookupTables: config.solanaLookupTables.join(', ') });
    setEditing(true); setConnected(false); setPreflight(null); setWalletError('');
  }
  async function connectNewWallets() {
    setConnected(false); setPreflight(null); setWalletError(''); setConnecting(true);
    try {
      const accounts = await wallets.current!.connectWallets(ethereumChoice, solanaChoice, setupToken);
      const nextConfig: LocalWalletConfig = config && !editing ? { ...config, ...accounts } : {
        ...accounts, ethereumTreasury: address(setup.ethereumTreasury), solanaTreasury: setup.solanaTreasury,
        ethereumSourceRouter: setup.ethereumSourceRouter ? address(setup.ethereumSourceRouter) : null,
        ethereumSupplyRouter: setup.ethereumSupplyRouter ? address(setup.ethereumSupplyRouter) : null,
        ethereumLendingRouter: setup.ethereumLendingRouter ? address(setup.ethereumLendingRouter) : null,
        solanaLookupTables: setup.solanaLookupTables.split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (!config || editing || config.ethereumWallet !== nextConfig.ethereumWallet || config.solanaWallet !== nextConfig.solanaWallet) {
        await api('configure', { config: nextConfig });
      }
      await refresh();
      setSetup((previous) => ({ ...previous, ethereumWallet: accounts.ethereumWallet ?? '', solanaWallet: accounts.solanaWallet ?? '' })); setEditing(false);
      setConnected(true); setConnecting(false);
      await loadBalances(nextConfig);
    } catch (error) {
      setWalletError(errorMessage(error));
    } finally {
      setConnecting(false);
    }
  }
  async function loadBalances(current: LocalWalletConfig) {
    setWalletError(''); setPreflight(null);
    try { await wallets.current!.check(current); }
    catch (error) { setConnected(false); setWalletError(errorMessage(error)); return; }
    setBalanceLoading(true);
    try { setPreflight(await api('preflight', {})); }
    catch (error) { setWalletError(`Your wallet is connected, but the balance check failed: ${errorMessage(error)}`); }
    finally { setBalanceLoading(false); }
  }
  async function prepareSource(b: BridgeRecord) {
    const result = await api<BridgeStep | { quoteRequired: true; quote: Parameters<BridgeWallets['quote']>[0] }>('source', { id: b.id, quoteSignature: null });
    if ('quoteRequired' in result) {
      const quoteSignature = await wallets.current!.quote(result.quote, b);
      await api('source', { id: b.id, quoteSignature });
    }
    setReviewed(null);
  }
  const ethBalance = preflight?.ethereum as Record<string, unknown> | undefined, solBalance = preflight?.solana as Record<string, unknown> | undefined;
  const walletSelectors = <div className={styles.row}>{(['Ethereum', 'Solana'] as const).map((chain) => <label key={chain}>{chain} wallet extension
    <select disabled={busy} value={chain === 'Ethereum' ? ethereumChoice : solanaChoice} onChange={(e) => { (chain === 'Ethereum' ? setEthereumChoice : setSolanaChoice)(e.target.value); setConnected(false); setPreflight(null); setWalletError(''); }}>
      <option value="">{choices.some((c) => c.chain === chain) ? 'Not selected' : 'No wallet extension detected'}</option>{choices.filter((c) => c.chain === chain).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select></label>)}</div>;
  const connectButton = <button disabled={busy || connected || (!ethereumChoice && !solanaChoice) || ((!config || editing) && (!setup.ethereumTreasury || !setup.solanaTreasury))} onClick={() => void run(connectNewWallets)}>
    {connecting ? 'Connecting...' : connected ? ethereumChoice && solanaChoice ? 'Wallets connected' : 'Wallet connected' : ethereumChoice && solanaChoice ? 'Connect wallets' : 'Connect wallet'}
  </button>;
  const connectionFeedback = <>
    {connecting && <p role="status">Approve the connection request in {choices.filter((choice) => choice.id === ethereumChoice || choice.id === solanaChoice).map((choice) => choice.name).join(' and ') || 'your wallet'}.</p>}
    {connected && config && <div role="status" className={styles.notice}>
      <strong>{hasBothWallets(config) ? 'Both wallets connected' : config.ethereumWallet ? 'Ethereum wallet connected' : 'Solana wallet connected'}</strong>
      {config.ethereumWallet && <p className={styles.address}>Ethereum: {config.ethereumWallet}</p>}
      {config.solanaWallet && <p className={styles.address}>Solana: {config.solanaWallet}</p>}
      <p>{balanceLoading ? 'Loading live balances...' : preflight ? 'Live balances loaded below.' : 'Use Check live readiness to refresh your balances.'}</p>
    </div>}
    {walletError && <div role="alert" className={styles.error}>{walletError}</div>}
  </>;
  return <div className={styles.page}>
    <nav className="portfolio-jump-navigation portfolio-jump-nav" aria-label="Jump to portfolio sections">
      <a className="portfolio-jump-link navigation-button" href="#wallets">Wallets</a>
      <a className="portfolio-jump-link navigation-button" href="#balances">Balances</a>
      <a className="portfolio-jump-link navigation-button" href="#lending">Lend</a>
      <a className="portfolio-jump-link navigation-button" href="#bridge">Bridge</a>
    </nav>
    <div className="portfolio-preview-notice"><span className="portfolio-preview-badge">Mainnet · Real funds</span><p>Connect your wallet to get started. Your wallet approves each deposit and withdrawal.</p></div>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <div role="status" className={styles.notice}>{notice}</div>}
    {busy && !connecting && !balanceLoading && <p role="status">Checking mainnet or waiting for your wallet…</p>}
    {!state && !error && <p>Loading your workspace…</p>}
    {state && (!state.configured || editing) && <section id="wallets" className={styles.card}>
      <p className="eyebrow">Your wallets</p><h2>Connect your wallets</h2>
      <p>Choose your wallet and connect through its extension. Connecting shares your public address and does not approve spending.</p>
      {walletSelectors}
      {connectButton}{connectionFeedback}
      {choices.length === 0 ? <p className={styles.muted}>Open this page in your wallet-enabled browser. Use MetaMask or Coinbase Wallet for Ethereum, or Phantom or Solflare for Solana.</p> : null}
      {setup.ethereumTreasury && setup.solanaTreasury ? <p className={styles.muted}>Your saved Ethereum and Solana treasury recipients are ready. <a href="/account">View receiving addresses</a>.</p> : <p className={styles.muted}>Add your treasury receiving addresses in public address setup before connecting.</p>}
      <details><summary>Public address setup</summary>
      <p>Saved treasury recipients are used automatically. You can also enter wallet addresses manually or restore existing deployments here.</p>
      <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
        await api('configure', { config: { ...setup, ethereumSourceRouter: setup.ethereumSourceRouter || null, ethereumSupplyRouter: setup.ethereumSupplyRouter || null,
          solanaLookupTables: setup.solanaLookupTables.split(',').map((s) => s.trim()).filter(Boolean) } });
        setEditing(false); setConnected(false); setPreflight(null);
      }); }}>
        {(['ethereumWallet', 'solanaWallet', 'ethereumTreasury', 'solanaTreasury'] as const).map((key) => <label key={key}>{({ ethereumWallet: 'Ethereum transaction wallet (mainnet)', solanaWallet: 'Solana transaction wallet (mainnet)', ethereumTreasury: 'Ethereum treasury receiving wallet', solanaTreasury: 'Solana treasury receiving wallet' })[key]}
          <input value={setup[key]} onChange={(e) => setSetup({ ...setup, [key]: e.target.value.trim() })} required={key.endsWith('Treasury')} readOnly={key.endsWith('Treasury')} autoComplete="off" spellCheck={false} /></label>)}
        <details><summary>Existing deployments (optional)</summary>
          <label>Ethereum source router<input value={setup.ethereumSourceRouter} onChange={(e) => setSetup({ ...setup, ethereumSourceRouter: e.target.value.trim() })} /></label>
          <label>Ethereum lending router<input value={setup.ethereumSupplyRouter} onChange={(e) => setSetup({ ...setup, ethereumSupplyRouter: e.target.value.trim() })} /></label>
          <label>Solana address tables, separated by commas<input value={setup.solanaLookupTables} onChange={(e) => setSetup({ ...setup, solanaLookupTables: e.target.value })} /></label>
        </details><button disabled={busy}>Save public configuration</button>
      </form></details>
    </section>}
    {config && !editing &&
      <section id="wallets" className={styles.card}><p className="eyebrow">Your wallets</p><h2>Wallets and connections</h2>
        <details><summary>Wallet addresses, treasuries, and deployments</summary>
        <dl><dt>Ethereum wallet</dt><dd>{config.ethereumWallet ?? 'Not connected'}</dd><dt>Solana wallet</dt><dd>{config.solanaWallet ?? 'Not connected'}</dd>
          <dt>Ethereum treasury</dt><dd>{config.ethereumTreasury}</dd><dt>Solana treasury</dt><dd>{config.solanaTreasury}</dd>
          <dt>Source router</dt><dd>{config.ethereumSourceRouter ?? 'Not deployed'}</dd><dt>Lending router</dt><dd>{config.ethereumSupplyRouter ?? 'Not deployed'}</dd></dl></details>
        <button disabled={busy || Boolean(bridge) || activeSteps.length > 0} onClick={edit}>Edit public setup</button>
        {walletSelectors}
        {connectButton}{connectionFeedback}
        <p className={styles.muted}>Connect either wallet on its own to check balances, lend, and withdraw. Both wallets are needed to bridge between chains.</p>
        <button disabled={busy || !canRead} onClick={() => void run(() => loadBalances(config))}>Check live readiness</button>
        <details><summary>Bridge setup (optional)</summary>
        <div className={styles.row}>
          {bridgeConfig && !config.ethereumSourceRouter && <button disabled={busy || !ready || activeSteps.length > 0} onClick={() => void run(() => api('deploy', { kind: 'DEPLOY_SOURCE' }))}>Prepare source router deployment</button>}
          {bridgeConfig && !config.ethereumSupplyRouter && <button disabled={busy || !ready || activeSteps.length > 0} onClick={() => void run(() => api('deploy', { kind: 'DEPLOY_SUPPLY' }))}>Prepare lending router deployment</button>}
        </div>
        {preflight && bridgeConfig && <p>Routers: {preflight.routersVerified ? 'verified' : 'deployment still required'}.</p>}
        {bridgeConfig && <p className={styles.muted}>Before bridging, both wallets need gas: at least 0.003 ETH and 0.03 SOL, plus Ethereum router deployment costs. Deployments become available after Ethereum finality.</p>}
        </details>
      </section>}
    <section id="balances" aria-label="Wallet balances" className={styles.balances}>
      {(['Ethereum', 'Solana'] as const).map((chain) => {
        const balance = chain === 'Ethereum' ? ethBalance : solBalance;
        const selected = chain === 'Ethereum' ? config?.ethereumWallet : config?.solanaWallet;
        return <article key={chain} className="portfolio-total-card">
        <p className="portfolio-total-label">{chain} wallet · USDC</p>
        <p className="portfolio-total-amount">{balance ? money(balance.usdc) : '—'}</p>
        <p className="portfolio-total-help">{balance ? `${chain === 'Ethereum' ? money(balance.eth, 18) + ' ETH' : money(balance.lamports, 9) + ' SOL'} available for network costs.` : selected ? 'Check live readiness to load this wallet’s balance.' : `Connect ${chain === 'Ethereum' ? 'an Ethereum' : 'a Solana'} wallet to view this balance.`}</p>
      </article>; })}
    </section>
    <LocalLending key={`${config?.ethereumWallet ?? ''}:${config?.solanaWallet ?? ''}:${editing}`} config={editing ? null : config} connected={connected} busy={busy} paused={Boolean(state?.paused)} bridgePending={Boolean(bridge)}
      steps={state?.lendingSteps ?? []} balances={preflight} setupToken={setupToken} connector={() => wallets.current!} run={run}
      showProviderDetails={showProviderDetails} bridgeSteps={state?.steps ?? []} bridges={state?.bridges ?? []}
      refreshBalances={async () => { if (config && connected) await loadBalances(config); }} />
    <details id="bridge" className={styles.bridgeSection}><summary>Bridge between chains (optional)</summary>
    <section className={styles.overview}>
      <div><p className="eyebrow">Bridge &amp; lend</p><h2>Bridge USDC and lend.</h2>
        <p>Smart Lending includes a bridge when it improves your estimated return after costs. Review and approve each step in your wallet.</p></div>
      <p className={styles.muted}>The 0.20% platform fee is added to the amount. Circle fees reduce what arrives; gas and account rent are additional.</p>
    </section>
    {!bridgeConfig && <p className={styles.muted}>Connect both an Ethereum wallet and a Solana wallet when you want to bridge USDC between chains.</p>}
    {bridgeConfig && !editing && <>
      {!bridge && <p className={styles.muted}>Enable bridging in <a href="#lending">Smart Lending</a> to include it in your lending plan.</p>}
      {bridge && <section className={styles.card}><h2>Current bridge</h2><p><strong>{bridge.status.replaceAll('_', ' ')}</strong></p>
        <dl><dt>Source</dt><dd>{bridge.plan.sourceNetwork === BRIDGE_ETHEREUM ? 'Ethereum' : 'Solana'} · {String(bridge.plan.sourceWallet)}</dd>
          <dt>Destination network</dt><dd>{bridge.plan.destinationNetwork === BRIDGE_ETHEREUM ? 'Ethereum' : 'Solana'}</dd><dt>Receiving wallet</dt><dd>{String(bridge.plan.destinationWallet)}</dd><dt>Principal</dt><dd>{money(bridge.plan.principal)} USDC</dd>
          <dt>Platform fee</dt><dd>{money(bridge.plan.platformFee)} USDC to {String(bridge.plan.treasury)}</dd>
          <dt>Total source debit</dt><dd>{money(bridge.plan.totalSourceDebit)} USDC</dd><dt>Maximum Circle fee</dt><dd>{money(bridge.plan.maxBridgeFee)} USDC</dd>
          <dt>Minimum received</dt><dd>{money(bridge.plan.minimumDestinationAmount)} USDC</dd></dl>
        <p>After the source burn finalizes, the transfer cannot be cancelled. Keep this transaction journal to finish receiving USDC even if lending is unavailable.</p>
        {bridge.status === 'CREATED' && <><p>Source quote expires {new Date(Number(bridge.plan.deadline) * 1000).toLocaleTimeString()}. After an approval finalizes, cancel an expired quote and prepare a new one.</p>
          <button disabled={busy || !ready || activeSteps.length > 0} onClick={() => void run(() => prepareSource(bridge))}>Prepare source transaction / sign quote</button>
          <button disabled={busy || !ready || activeSteps.length > 0} onClick={() => void run(() => api('cancel-bridge', { id: bridge.id }))}>Cancel unsubmitted bridge</button></>}
        {bridge.status === 'AWAITING_ATTESTATION' && <button disabled={busy || !ready} onClick={() => void run(async () => { await api('attestation', { id: bridge.id }); setNotice('Attestation status refreshed. Circle standard transfers may take several minutes.'); })}>Check Circle attestation</button>}
        {bridge.status === 'READY_TO_MINT' && <div className={styles.row}>
          <button disabled={busy || !ready || activeSteps.length > 0} onClick={() => void run(() => api('destination', { id: bridge.id, mode: bridge.destinationProvider && !['aave', 'kamino'].includes(bridge.destinationProvider) ? 'mint-only' : 'mint-and-supply' }))}>{bridge.destinationProvider && !['aave', 'kamino'].includes(bridge.destinationProvider) ? 'Receive USDC before lending' : 'Prepare receive and lend'}</button>
          <button disabled={busy || !ready || activeSteps.length > 0} onClick={() => void run(() => api('destination', { id: bridge.id, mode: 'mint-only' }))}>Recover USDC to wallet</button>
          {bridge.plan.destinationNetwork === BRIDGE_SOLANA && <button disabled={busy || !ready || activeSteps.length > 0} onClick={() => void run(() => api('lookup', { id: bridge.id }))}>Prepare address table for Solana</button>}
        </div>}
        {bridge.status === 'MINTED' && <><p>Your USDC is in the destination wallet. You can keep it there or continue lending.</p><button disabled={busy || !ready || activeSteps.length > 0} onClick={() => void run(() => api('destination', { id: bridge.id, mode: 'supply-only' }))}>Prepare lending</button></>}
        {bridge.sourceTransactionId && <a href={explorer(bridge.plan.sourceNetwork as BridgeNetwork, bridge.sourceTransactionId)} target="_blank" rel="noreferrer">View source transaction</a>}
      </section>}
      {state?.steps.map((step) => <section key={step.id} className={styles.card}><h2>{names[step.kind]}</h2><p>{step.network === BRIDGE_ETHEREUM ? 'Ethereum' : 'Solana'} · <strong>{step.state}</strong></p>
        <dl><dt>Signing wallet</dt><dd>{step.wallet}</dd><dt>Maximum network cost</dt><dd>{money(step.maxNetworkCost, step.network === BRIDGE_ETHEREUM ? 18 : 9)} {step.network === BRIDGE_ETHEREUM ? 'ETH' : 'SOL (including rent)'}</dd>
          {step.ethereum && <><dt>Recipient / contract</dt><dd>{step.ethereum.to ?? 'New router contract'}</dd><dt>Native ETH sent</dt><dd>0</dd></>}
          {step.evidence.amount && <><dt>Approval</dt><dd>{money(step.evidence.amount)} USDC to {step.evidence.spender}</dd></>}
        </dl>
        {step.kind.startsWith('DEPLOY_') && <p>This deploys your wallet’s bridge router. The source router uses your Ethereum wallet as its quote signer and the configured Ethereum treasury for fees.</p>}
        {step.state === 'PREPARED' && <>
          <p>Review expires {new Date(step.expiresAt).toLocaleTimeString()}. Confirm the account, chain, amount and fee in your wallet.</p>
          <label className={styles.check}><input type="checkbox" checked={reviewed === step.id} onChange={(e) => setReviewed(e.target.checked ? step.id : null)} />I reviewed this mainnet transaction and its cost.</label>
          <button disabled={busy || !ready || reviewed !== step.id} onClick={() => void run(() => wallets.current!.send(step, bridgeConfig, state.bridges.find((b) => b.id === step.bridgeId), (hash) => { setRecovery((r) => ({ ...r, [step.id]: hash })); setNotice(`Save this transaction identifier: ${hash}`); }, setupToken))}>Confirm in wallet</button>
          <button disabled={busy || !ready} onClick={() => void run(() => api('cancel-step', { id: step.id }))}>Cancel review</button>
        </>}
        {!completedStep(step.state) && step.state !== 'PREPARED' && <>
          <p>Pending transactions stay reserved across reloads. Check their original hash or signature before taking another action.</p>
          {step.state === 'SIGNED' && <button disabled={busy || !ready} onClick={() => void run(() => wallets.current!.dispatch(step, bridgeConfig, setupToken))}>Send saved signed Solana transaction once</button>}
          {step.transactionId ? <button disabled={busy || !ready} onClick={() => void run(() => api('reconcile', { id: step.id }))}>Check finality</button> : <>
            <label>Original wallet transaction hash<input value={recovery[step.id] ?? ''} onChange={(e) => setRecovery((r) => ({ ...r, [step.id]: e.target.value.trim() }))} /></label>
            <button disabled={busy || !ready || !recovery[step.id]} onClick={() => void run(() => api('submitted', { id: step.id, transactionId: recovery[step.id] }))}>Recover transaction status</button>
          </>}
        </>}
        {(step.transactionId || recovery[step.id]) && <p className={styles.hash}><a href={explorer(step.network, step.transactionId ?? recovery[step.id]!)} target="_blank" rel="noreferrer">{step.transactionId ?? recovery[step.id]}</a></p>}
      </section>)}
      {state?.bridges.filter((b) => ['LENT', 'SOURCE_FAILED', 'CANCELLED'].includes(b.status)).map((b) => <p key={b.id}>{b.status === 'LENT' ? `Lending verified: ${money(b.received)} USDC supplied on ${b.plan.destinationNetwork === BRIDGE_ETHEREUM ? 'Ethereum' : 'Solana'}.` : b.status.replaceAll('_', ' ')} <small>{b.id}</small></p>)}
      <button disabled={busy || !ready} onClick={() => void run(() => api('pause', { paused: !state?.paused }))}>{state?.paused ? 'Resume new source transactions' : 'Pause new source transactions'}</button>
      <button disabled={busy} onClick={() => void run(refresh)}>Refresh journal</button>
      <p className={styles.muted}>Your workspace saves public setup and pending transaction records for recovery. Use the original transaction identifier to check status before trying again.</p>
    </>}
    </details>
  </div>;
}
