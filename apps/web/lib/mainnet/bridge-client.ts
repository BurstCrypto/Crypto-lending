'use client';

import { getWallets } from '@wallet-standard/app';
import { StandardConnect, type StandardConnectFeature } from '@wallet-standard/features';
import { SolanaSignTransaction, type SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { decodeFunctionData, maxUint256, parseAbi } from 'viem';
import { Eip6963ProviderDiscovery } from '../wallets/eip1193/discovery';
import type { Eip1193Provider } from '../wallets/eip1193/provider';
import { BRIDGE_ETHEREUM, BRIDGE_SOLANA, CIRCLE_ETHEREUM_TRANSMITTER, hasBothWallets, isDirectLendingStep, type BridgeConfig, type LocalWalletConfig, type BridgeRecord, type BridgeStep } from './bridge-types';
import { address, MAINNET_TEST, POOL_ABI, TOKEN_ABI } from './policy';
import { readAuthenticationCsrfToken } from '../authentication/session-client';
import { ETH_USDC, MARKETS, isLendingProvider, SAVE, PROJECT_ZERO, JUPITER } from '../lending/markets';
import { marketCall } from '../lending/evm-markets';
import { replaceBrowserLocation } from '../../components/authentication/browser-navigation';
import { SOLANA_BROWSER_RPC_URL } from './public-config';

async function solanaBrowserRpc(method: 'getGenesisHash' | 'sendTransaction', params: unknown[] = []) {
  const sending = method === 'sendTransaction';
  const failure = (detail: string) => new Error(sending
    ? `Solana submission is unconfirmed (${detail}). Check the saved transaction status before starting another deposit.`
    : `The Solana connection check failed (${detail}). No transaction was sent. Try again shortly.`);
  let response: Response;
  try {
    response = await fetch(SOLANA_BROWSER_RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(sending ? 20_000 : 5_000) });
  } catch { throw failure('connection unavailable'); }
  if (!response.ok) throw failure(`HTTP ${response.status}`);
  const result = await response.json().catch(() => { throw failure('invalid RPC response'); });
  if (result.error || result.id !== 1 || typeof result.result !== 'string') throw failure(typeof result.error?.code === 'number' ? `RPC ${result.error.code}` : 'invalid RPC response');
  return result.result as string;
}
async function checkSolanaBrowserRpc() {
  if (await solanaBrowserRpc('getGenesisHash') !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('The Solana RPC returned the wrong chain. No transaction was sent.');
}

export async function bridgeApi<T>(operation?: string, fields: Record<string, unknown> = {}, setupToken?: string): Promise<T> {
  const csrf = operation && !setupToken ? readAuthenticationCsrfToken(document.cookie) : null;
  const response = await fetch('/api/mainnet', { method: operation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(!operation || operation === 'preflight' ? { signal: AbortSignal.timeout(operation ? 45_000 : 15_000) } : {}),
    headers: { ...(operation ? { 'Content-Type': 'application/json' } : {}), ...(setupToken ? { 'x-local-mainnet-setup': setupToken } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    ...(operation ? { body: JSON.stringify({ operation, ...fields }) } : {}) });
  if (response.status === 401 && !setupToken) { replaceBrowserLocation('/login?returnTo=%2Fportfolio'); throw new Error('Sign in to continue.'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The mainnet API is unavailable. Reload this page.');
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'The mainnet service is unavailable.');
  return body as T;
}
export const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const unbase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function stop(message: string): never { throw new Error(message); }
export function walletErrorMessage(error: unknown) {
  return (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message
    ? error.message : 'The wallet request could not complete. Open your wallet to check pending requests.').slice(0, 500);
}
function connectionRequest<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Wallet connection timed out. Open your wallet extension, approve or dismiss any pending connection request, and try again.')), 60_000);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}
const SOURCE_ABI = parseAbi([
  'struct BridgeIntent { bytes32 intentId; address user; bytes32 mintRecipient; uint256 principal; uint256 maxBridgeFee; uint256 minimumDestinationAmount; uint16 feeBps; uint256 deadline; }',
  'function bridge(BridgeIntent intent, bytes quoteSignature)',
]);
const INTENT_TYPES = { BridgeIntent: SOURCE_ABI[0].inputs[0].components.map(({ name, type }) => ({ name, type })) };
const DOMAIN_TYPES = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }];
const SUPPLY_ABI = parseAbi(['function supply(uint256 principal, uint256 minimumATokens)', 'function mintAndSupply(bytes message, bytes attestation, uint256 principal, uint256 minimumATokens)']);

export async function validateReviewedStep(step: BridgeStep, config: LocalWalletConfig, bridge?: BridgeRecord, allowReserved = false) {
  const direct = isDirectLendingStep(step);
  if (!direct && !hasBothWallets(config)) stop('Connect both wallets for bridge actions.');
  if (direct) { const { validateLendingFee } = await import('../lending/routing-fee'); validateLendingFee(step, config, true); }
  if (!(step.state === 'PREPARED' || allowReserved && step.state === 'RESERVED') || step.expiresAt <= Date.now()) stop('This transaction review expired.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ethereum: step.ethereum, solana: step.solana, evidence: step.evidence })));
  if (Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('') !== step.fingerprint) stop('The transaction changed after preparation.');
  if (step.bridgeId && (!bridge || step.bridgeId !== bridge.id)) stop('The bridge context is missing.');
  if (step.network === BRIDGE_ETHEREUM) {
    const tx = step.ethereum, deploy = step.kind.startsWith('DEPLOY_');
    if (!tx || step.solana || !same(step.wallet, config.ethereumWallet) || !same(tx.from, config.ethereumWallet) || tx.chainId !== '0x1' || tx.value !== '0x0' || tx.type !== '0x2' ||
      BigInt(tx.gas) <= 0n || BigInt(tx.gas) > (deploy ? 6_000_000n : 1_400_000n) || BigInt(tx.maxFeePerGas) > 20_000_000_000n ||
      BigInt(tx.maxPriorityFeePerGas) > BigInt(tx.maxFeePerGas) || BigInt(tx.gas) * BigInt(tx.maxFeePerGas) !== BigInt(step.maxNetworkCost) ||
      BigInt(step.maxNetworkCost) > (deploy ? 10_000_000_000_000_000n : 2_000_000_000_000_000n)) stop('The Ethereum transaction exceeds the local test policy.');
    if (deploy) {
      if (tx.to || !tx.data.startsWith('0x60') || tx.data.length < 1000) stop('Invalid router deployment.');
      if (step.kind === 'DEPLOY_LENDING') {
        const { encodeDeployData } = await import('viem');
        const artifact = (await import('../../../../onchain/build/BonsaiLendingRouter.json')).default;
        const { ROUTED_ETHEREUM_PROVIDERS } = await import('../lending/ethereum-router');
        const expected = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode as `0x${string}`, args: [ETH_USDC, config.ethereumTreasury, ROUTED_ETHEREUM_PROVIDERS.map((provider) => MARKETS[provider].target)] });
        if (config.ethereumLendingRouter || tx.data !== expected) stop('The lending setup does not match the reviewed treasury and destinations.');
      }
      return;
    }
    if (direct) {
      const amount = BigInt(step.evidence.amount!);
      const provider = step.evidence.provider ?? 'aave';
      if (!isLendingProvider(provider) || MARKETS[provider].network !== step.network) stop('Unexpected lending provider or network.');
      if (step.evidence.routingFeeBps === '10') {
        const principal = BigInt(step.evidence.lendAmount ?? step.evidence.amount!), total = BigInt(step.evidence.totalSourceDebit!);
        if (!config.ethereumLendingRouter || !same(step.evidence.lendingRouter, config.ethereumLendingRouter) || principal <= 0n || principal > MAINNET_TEST.maxAmount) stop('Unexpected lending router or principal.');
        if (step.kind === 'LENDING_APPROVAL' || step.kind === 'LENDING_REVOKE') {
          const decoded = decodeFunctionData({ abi: TOKEN_ABI, data: tx.data });
          if (!same(tx.to, ETH_USDC) || decoded.functionName !== 'approve' || !same(decoded.args[0], config.ethereumLendingRouter) || decoded.args[1] !== (step.kind === 'LENDING_REVOKE' ? 0n : total)) stop('Unexpected lending allowance including routing fee.');
        } else {
          const { routedLendingCall } = await import('../lending/ethereum-router');
          const expected = routedLendingCall(config.ethereumLendingRouter, provider, principal);
          if (step.kind !== 'LENDING_SUPPLY' || !same(tx.to, expected.to) || tx.data !== expected.data) stop('The lending transaction does not match the deposit and routing fee.');
        }
        return;
      }
      if (provider !== 'aave') {
        if (step.evidence.marketTarget !== MARKETS[provider].target) stop('Unexpected lending market.');
        if (step.kind === 'LENDING_APPROVAL' || step.kind === 'LENDING_REVOKE') {
          const decoded = decodeFunctionData({ abi: TOKEN_ABI, data: tx.data });
          if (!same(tx.to, ETH_USDC) || decoded.functionName !== 'approve' || !same(decoded.args[0], MARKETS[provider].target) || decoded.args[1] !== amount ||
            amount > MAINNET_TEST.maxAmount || (step.kind === 'LENDING_REVOKE' ? amount !== 0n : amount <= 0n)) stop('Unexpected provider allowance.');
        } else {
          if (!['LENDING_SUPPLY', 'LENDING_WITHDRAW'].includes(step.kind) || amount <= 0n || step.kind === 'LENDING_SUPPLY' && amount > MAINNET_TEST.maxAmount ||
            step.kind === 'LENDING_WITHDRAW' && step.evidence.withdrawAll !== 'true') stop('Unexpected lending amount.');
          const expected = marketCall(provider, tx.from, step.kind === 'LENDING_SUPPLY' ? 'supply' : 'withdraw', step.kind === 'LENDING_SUPPLY' ? amount : 0n, BigInt(step.evidence.shares!));
          if (!same(tx.to, expected.to) || tx.data !== expected.data) stop('The provider transaction does not match the reviewed amount and wallet.');
        }
        return;
      }
      if (step.kind === 'LENDING_APPROVAL' || step.kind === 'LENDING_REVOKE') {
        const decoded = decodeFunctionData({ abi: TOKEN_ABI, data: tx.data });
        if (!same(tx.to, MAINNET_TEST.usdc) || decoded.functionName !== 'approve' || !same(decoded.args[0], MAINNET_TEST.pool) ||
          decoded.args[1] !== amount || amount > MAINNET_TEST.maxAmount || (step.kind === 'LENDING_REVOKE' ? amount !== 0n : amount <= 0n)) stop('Unexpected Aave USDC approval.');
      } else {
        const decoded = decodeFunctionData({ abi: POOL_ABI, data: tx.data });
        if (!same(tx.to, MAINNET_TEST.pool) || !same(decoded.args?.[0], MAINNET_TEST.usdc)) stop('Unexpected Aave market or asset.');
        if (step.kind === 'LENDING_SUPPLY') {
          if (decoded.functionName !== 'supply' || decoded.args[1] !== amount || amount <= 0n || amount > MAINNET_TEST.maxAmount || !same(decoded.args[2], config.ethereumWallet) || decoded.args[3] !== 0) stop('Unexpected Aave deposit amount or recipient.');
        } else if (step.kind !== 'LENDING_WITHDRAW' || decoded.functionName !== 'withdraw' || decoded.args[1] !== maxUint256 || step.evidence.withdrawAll !== 'true' || amount <= 0n || !same(decoded.args[2], config.ethereumWallet)) stop('Unexpected Aave withdrawal recipient or amount.');
      }
      return;
    }
    if (step.kind.includes('APPROVAL') || step.kind.includes('REVOKE')) {
      const decoded = decodeFunctionData({ abi: TOKEN_ABI, data: tx.data });
      const spender = step.kind.startsWith('SOURCE_') ? config.ethereumSourceRouter : config.ethereumSupplyRouter;
      if (!same(tx.to, MAINNET_TEST.usdc) || decoded.functionName !== 'approve' || !same(decoded.args[0], spender) ||
        decoded.args[1] !== BigInt(step.evidence.amount!) || decoded.args[1] > MAINNET_TEST.maxAmount * 10020n / 10000n || (step.kind.includes('REVOKE') && decoded.args[1] !== 0n)) stop('Unexpected USDC approval.');
    } else if (step.kind === 'SOURCE_BURN') {
      const decoded = decodeFunctionData({ abi: SOURCE_ABI, data: tx.data });
      if (!same(tx.to, config.ethereumSourceRouter)) stop('Unexpected source router.');
      validateIntent(decoded.args[0], bridge!, config as BridgeConfig);
    } else if (step.kind === 'DESTINATION_MINT') {
      const decoded = decodeFunctionData({ abi: parseAbi(['function receiveMessage(bytes message, bytes attestation) returns (bool)']), data: tx.data });
      if (!same(tx.to, CIRCLE_ETHEREUM_TRANSMITTER) || decoded.args[0] !== bridge!.attestation?.message || decoded.args[1] !== bridge!.attestation?.signature) stop('Unexpected destination mint.');
    } else if (step.kind === 'DESTINATION_SUPPLY' || step.kind === 'DESTINATION_MINT_SUPPLY') {
      const decoded = decodeFunctionData({ abi: SUPPLY_ABI, data: tx.data });
      if (!same(tx.to, config.ethereumSupplyRouter)) stop('Unexpected supply router.');
      if (step.kind === 'DESTINATION_SUPPLY' ? decoded.functionName !== 'supply' || decoded.args[0] !== BigInt(bridge!.received!) || decoded.args[1] < BigInt(bridge!.received!) - 1n :
        decoded.functionName !== 'mintAndSupply' || decoded.args[0] !== bridge!.attestation?.message || decoded.args[1] !== bridge!.attestation?.signature || decoded.args[2] !== BigInt(bridge!.received!) || decoded.args[3] < BigInt(bridge!.received!) - 1n) stop('Unexpected lending amount or attestation.');
    } else stop('Unsupported Ethereum operation.');
  } else if (step.network === BRIDGE_SOLANA) {
    if (!step.solana || step.ethereum || step.wallet !== config.solanaWallet || BigInt(step.maxNetworkCost) > 20_000_000n || unbase64(step.solana.serialized).length > 1232) stop('Invalid Solana transaction review.');
    const provider = step.evidence.provider ?? 'kamino';
    if (direct && provider !== 'kamino') {
      if (!isLendingProvider(provider) || MARKETS[provider].network !== BRIDGE_SOLANA || step.evidence.marketTarget !== MARKETS[provider].target ||
        !['LENDING_SUPPLY', 'LENDING_WITHDRAW'].includes(step.kind) || BigInt(step.evidence.amount!) <= 0n ||
        (step.kind === 'LENDING_SUPPLY' ? BigInt(step.evidence.amount!) > MAINNET_TEST.maxAmount : step.evidence.withdrawAll !== 'true')) stop('Unexpected Solana lending market or amount.');
      const { VersionedTransaction } = await import('@solana/web3.js');
      const tx = VersionedTransaction.deserialize(unbase64(step.solana.serialized));
      if (tx.message.version !== 0 || tx.message.addressTableLookups.length || tx.message.header.numRequiredSignatures !== 1 ||
        tx.message.staticAccountKeys[0]?.toBase58() !== step.wallet || base64(tx.message.serialize()) !== step.solana.message) stop('Unexpected Solana signer or message.');
      const program = provider === 'save' ? SAVE.program : provider === 'project-0' ? PROJECT_ZERO.program : JUPITER.program;
      const keys = tx.message.staticAccountKeys.map((key) => key.toBase58());
      const programs = tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]);
      if (!keys.includes(MARKETS[provider].target) || !keys.includes(step.evidence.positionAddress!) || !programs.includes(program) || programs.some((key) =>
        ![program, 'ComputeBudget111111111111111111111111111111', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'].includes(key!))) stop('Unexpected Solana lending instructions.');
      const { validateSolanaLendingInstructions } = await import('../lending/solana-review');
      validateSolanaLendingInstructions(step, tx);
      return;
    }
    if (direct && (step.evidence.market !== 'Kamino' || !['LENDING_SUPPLY', 'LENDING_WITHDRAW'].includes(step.kind) || BigInt(step.evidence.amount!) <= 0n ||
      (step.kind === 'LENDING_SUPPLY' ? BigInt(step.evidence.amount!) > MAINNET_TEST.maxAmount : step.evidence.withdrawAll !== 'true' || BigInt(step.evidence.collateralAmount!) <= 0n))) stop('Unexpected Kamino lending review.');
    if (direct) {
      const { VersionedTransaction } = await import('@solana/web3.js');
      const tx = VersionedTransaction.deserialize(unbase64(step.solana.serialized));
      if (tx.message.version !== 0 || tx.message.addressTableLookups.length || tx.message.header.numRequiredSignatures !== 1 || tx.message.staticAccountKeys[0]?.toBase58() !== step.wallet || base64(tx.message.serialize()) !== step.solana.message) stop('Unexpected Solana signer or message.');
      const { validateSolanaLendingInstructions } = await import('../lending/solana-review');
      validateSolanaLendingInstructions(step, tx);
    }
  } else stop('Unsupported mainnet chain.');
}
function validateIntent(value: Record<string, unknown>, bridge: BridgeRecord, config: BridgeConfig) {
  const plan = bridge.plan;
  for (const key of ['intentId', 'mintRecipient', 'principal', 'maxBridgeFee', 'minimumDestinationAmount', 'feeBps', 'deadline']) {
    if (String(value[key]).toLowerCase() !== String(key === 'intentId' ? bridge.id : plan[key]).toLowerCase()) stop('The wallet quote does not match the reviewed bridge.');
  }
  if (!same(value.user, config.ethereumWallet) || BigInt(String(value.principal)) > MAINNET_TEST.maxAmount || BigInt(String(value.principal)) <= 0n ||
    Number(value.feeBps) !== 20 || Number(value.deadline) * 1000 <= Date.now() || Number(value.deadline) * 1000 > Date.now() + 300_000) stop('Invalid source quote limits.');
}
export interface BridgeWalletChoice { id: string; name: string; chain: 'Ethereum' | 'Solana' }
export class BridgeWallets {
  readonly discovery = new Eip6963ProviderDiscovery({ supportedNetworks: [{ chainId: BRIDGE_ETHEREUM, providerChainId: '0x1', displayName: 'Ethereum', environment: 'MAINNET' }] });
  private ethereum: Eip1193Provider | null = null;
  private solana: Wallet | null = null;
  private account: WalletAccount | null = null;
  private options = new Map<string, Wallet>();
  private readonly solanaIds = new WeakMap<Wallet, string>();
  private nextSolanaId = 0;
  private connectionAttempt = 0;
  start(update: (choices: BridgeWalletChoice[]) => void) {
    const registry = getWallets();
    const refresh = () => {
      const choices: BridgeWalletChoice[] = this.discovery.list().map((x) => ({ id: x.selectionId, name: x.displayName, chain: 'Ethereum' }));
      this.options.clear();
      registry.get().filter((w) => w.chains.includes('solana:mainnet') && w.features[StandardConnect] && w.features[SolanaSignTransaction]).forEach((w) => {
        let id = this.solanaIds.get(w);
        if (!id) { id = `solana-${this.nextSolanaId++}`; this.solanaIds.set(w, id); }
        this.options.set(id, w); choices.push({ id, name: w.name.slice(0, 60), chain: 'Solana' });
      });
      update(choices);
    };
    const unsubscribe = this.discovery.subscribe(refresh), offRegister = registry.on('register', refresh), offUnregister = registry.on('unregister', refresh);
    this.discovery.start(); refresh();
    return () => { unsubscribe(); offRegister(); offUnregister(); this.discovery.stop(); this.connectionAttempt++; this.ethereum = null; this.solana = null; this.account = null; };
  }
  async connectWallets(ethereumId: string, solanaId: string, setupToken?: string) {
    return this.selectAccounts(ethereumId, solanaId, undefined, { setupToken });
  }
  async selectAccounts(ethereumId: string, solanaId: string, expectedSolana?: string, diagnostics?: { setupToken: string | undefined }) {
    if (!ethereumId && !solanaId) stop('Select at least one Ethereum or Solana wallet.');
    const attempt = ++this.connectionAttempt;
    const ethereum = ethereumId ? this.discovery.select(ethereumId)?.provider ?? null : null;
    const solana = solanaId ? this.options.get(solanaId) ?? null : null;
    this.ethereum = null; this.solana = null; this.account = null;
    let requestContext: { network: typeof BRIDGE_ETHEREUM | typeof BRIDGE_SOLANA; stage: string; name: string; startedAt: number } | null = null;
    const stage = (network: typeof BRIDGE_ETHEREUM | typeof BRIDGE_SOLANA, value: string, name: string) => {
      requestContext = { network, stage: value, name, startedAt: Date.now() };
    };
    try {
      const result = await connectionRequest((async () => {
        const selected: Pick<LocalWalletConfig, 'ethereumWallet' | 'solanaWallet'> = { ethereumWallet: null, solanaWallet: null };
        let account: WalletAccount | null = null;
        if (ethereumId) {
          if (!ethereum) stop('Select an installed Ethereum wallet.');
          stage(BRIDGE_ETHEREUM, 'connect', 'Ethereum wallet');
          await ethereum.request({ method: 'eth_requestAccounts' });
          stage(BRIDGE_ETHEREUM, 'network', 'Ethereum wallet');
          await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
          const accounts = await ethereum.request({ method: 'eth_accounts' });
          selected.ethereumWallet = address(Array.isArray(accounts) ? accounts[0] : undefined);
        }
        if (solanaId) {
          if (!solana) stop('Select an installed Solana wallet.');
          // Connection shares a public account. Requiring SIWS/signMessage here
          // prevents Ledger accounts from connecting despite supporting transactions.
          stage(BRIDGE_SOLANA, 'connect', solana.name || 'Solana wallet');
          const connected = await (solana.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect]).connect({ silent: false });
          const offered = connected.accounts.find((a) => (!expectedSolana || a.address === expectedSolana) && a.chains.includes('solana:mainnet'));
          account = solana.accounts.find((a) => a.address === offered?.address && a.chains.includes('solana:mainnet')) ?? null;
          if (!account) stop('Select a Solana mainnet account in your wallet.');
          selected.solanaWallet = account.address;
        }
        if (ethereum) {
          const chain = await ethereum.request({ method: 'eth_chainId' }), accounts = await ethereum.request({ method: 'eth_accounts' });
          if (chain !== '0x1' || !Array.isArray(accounts) || !same(accounts[0], selected.ethereumWallet)) stop('Select the configured Ethereum wallet on Ethereum mainnet.');
        }
        return { selected, account };
      })());
      if (attempt !== this.connectionAttempt) stop('The wallet selection changed. Connect your selected wallet again.');
      // Commit only the winning request. A timed-out popup cannot replace a later connection.
      this.ethereum = ethereum; this.solana = solana; this.account = result.account;
      return result.selected;
    } catch (error) {
      const context = requestContext as { network: typeof BRIDGE_ETHEREUM | typeof BRIDGE_SOLANA; stage: string; name: string; startedAt: number } | null;
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number' && Number.isSafeInteger(error.code) ? error.code : null;
      if (diagnostics?.setupToken && context) {
        // Local diagnostics contain only the request stage, error code and timing.
        // Never include a wallet address, nonce, message or signature in this log.
        void bridgeApi('wallet-connection-error', { network: context.network, stage: context.stage, code,
          elapsedMs: Math.min(120_000, Math.max(0, Date.now() - context.startedAt)) }, diagnostics.setupToken).catch(() => undefined);
      }
      if (typeof error === 'object' && error !== null && 'code' in error) {
        if (error.code === 4001) {
          const action = context?.stage === 'network' ? 'network switch' : 'connection';
          stop(`${context?.name ?? 'Your wallet'} did not approve the ${action} request (4001). Wallet response: ${walletErrorMessage(error)} Open your wallet to check the request, then click Connect wallet again.`);
        }
        if (error.code === -32002) stop('A wallet request is already open. Open your wallet extension and approve or dismiss that request, then connect again.');
      }
      throw error;
    }
  }
  async connect(ethereumId: string, solanaId: string, config: LocalWalletConfig) {
    await this.selectAccounts(ethereumId, solanaId, config.solanaWallet ?? undefined);
    await this.check(config);
  }
  async check(config: Pick<LocalWalletConfig, 'ethereumWallet' | 'solanaWallet'>) {
    if (!config.ethereumWallet && !config.solanaWallet) stop('Connect at least one wallet.');
    if (config.ethereumWallet) {
      if (!this.ethereum) stop('Reconnect the selected Ethereum wallet in this tab.');
      const chain = await this.ethereum.request({ method: 'eth_chainId' }), accounts = await this.ethereum.request({ method: 'eth_accounts' });
      if (chain !== '0x1' || !Array.isArray(accounts) || !same(accounts[0], config.ethereumWallet)) stop('Select the configured Ethereum wallet on Ethereum mainnet.');
    }
    if (config.solanaWallet) {
      const account = this.solana?.accounts.find((a) => a.address === config.solanaWallet && a.chains.includes('solana:mainnet'));
      if (!this.account || this.account.address !== config.solanaWallet || !account) stop('Select the configured Solana mainnet wallet.');
      this.account = account;
    }
  }
  async quote(value: { domain: Record<string, unknown>; message: Record<string, unknown>; primaryType: string; types: unknown }, bridge: BridgeRecord) {
    await this.check(bridge.config);
    if (value.domain.name !== 'BonsaiCctpSourceRouter' || value.domain.version !== '1' || value.domain.chainId !== 1 || !same(value.domain.verifyingContract, bridge.config.ethereumSourceRouter) || value.primaryType !== 'BridgeIntent') stop('Unexpected signing domain.');
    validateIntent(value.message, bridge, bridge.config);
    if (JSON.stringify(value.types) !== JSON.stringify(INTENT_TYPES)) stop('The quote signing types changed.');
    // Raw EIP-1193 requests need the explicit domain type, just as viem's wallet action adds it.
    const payload = { domain: value.domain, primaryType: 'BridgeIntent', message: value.message, types: { EIP712Domain: DOMAIN_TYPES, ...INTENT_TYPES } };
    return this.ethereum!.request({ method: 'eth_signTypedData_v4', params: [bridge.config.ethereumWallet, JSON.stringify(payload)] });
  }
  async send(review: BridgeStep, config: LocalWalletConfig, bridge: BridgeRecord | undefined, remember: (hash: string) => void, setupToken?: string, onStatus?: (message: string) => void) {
    const direct = isDirectLendingStep(review);
    const api = <T,>(operation: string, fields: Record<string, unknown>) => bridgeApi<T>(direct ? `lending-${operation}` : operation, fields, setupToken);
    const selected = direct ? { ethereumWallet: review.network === BRIDGE_ETHEREUM ? config.ethereumWallet : null, solanaWallet: review.network === BRIDGE_SOLANA ? config.solanaWallet : null } : config;
    onStatus?.('Checking balances and transaction readiness before opening your wallet…');
    await validateReviewedStep(review, config, bridge); await this.check(selected);
    // Detect browser/CORS/provider failures before asking the wallet to sign.
    if (review.network === BRIDGE_SOLANA) await checkSolanaBrowserRpc();
    // Storage and the durable server reservation must succeed before a wallet sees a spending request.
    localStorage.setItem(`bonsai-mainnet:${review.id}`, JSON.stringify({ fingerprint: review.fingerprint, transactionId: null }));
    const step = await api<BridgeStep>('reserve', { id: review.id });
    try {
      if (direct && review.network === BRIDGE_SOLANA && review.solana && step.solana) {
        const terms = (value: BridgeStep) => ({ ...value, state: 'PREPARED', solana: null, fingerprint: '', expiresAt: 0, walletError: null });
        if (JSON.stringify(terms(step)) !== JSON.stringify(terms(review)) || step.state !== 'RESERVED' || step.expiresAt > Date.now() + 65_000) stop('The reserved transaction differs from the review.');
        const { assertRefreshedSolanaReview } = await import('../lending/solana-refresh');
        assertRefreshedSolanaReview(review.solana, step.solana);
      } else if (step.fingerprint !== review.fingerprint) stop('The reserved transaction differs from the review.');
      await validateReviewedStep(step, config, bridge, true); await this.check(selected);
      localStorage.setItem(`bonsai-mainnet:${review.id}`, JSON.stringify({ fingerprint: step.fingerprint, transactionId: null }));
      let output: unknown;
      try {
        onStatus?.('Waiting for approval in your wallet. Open the wallet extension if its window is not visible.');
        if (step.network === BRIDGE_ETHEREUM) output = await this.ethereum!.request({ method: 'eth_sendTransaction', params: [step.ethereum!] });
        else {
          const feature = this.solana!.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction];
          if (!feature.supportedTransactionVersions.includes(step.solana!.version)) stop('This wallet does not support the required Solana transaction version.');
          output = await feature.signTransaction({ account: this.account!, transaction: unbase64(step.solana!.serialized), chain: 'solana:mainnet', options: { preflightCommitment: 'confirmed', minContextSlot: step.solana!.contextSlot } });
        }
      } catch (error) {
        // Only the wallet call's explicit rejection closes the reservation. Ambiguous failures stay pending.
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001) await api('rejected', { id: step.id, code: 4001 });
        throw error;
      }
      if (step.network === BRIDGE_ETHEREUM) {
        if (typeof output !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(output)) stop('The wallet did not return a valid transaction hash. Recover the hash from the wallet; do not send again.');
        remember(output);
        onStatus?.('Transaction submitted. Checking confirmation…');
        localStorage.setItem(`bonsai-mainnet:${step.id}`, JSON.stringify({ fingerprint: step.fingerprint, transactionId: output }));
        return await api('submitted', { id: step.id, transactionId: output });
      }
      const signatures = output as readonly { signedTransaction: Uint8Array }[];
      if (!Array.isArray(signatures) || signatures.length !== 1 || !(signatures[0]!.signedTransaction instanceof Uint8Array)) stop('Invalid signed Solana transaction. The source remains reserved.');
      onStatus?.('Saving and verifying the signed transaction…');
      const signed = await api<BridgeStep>('signed', { id: step.id, serialized: base64(signatures[0]!.signedTransaction) });
      remember(signed.transactionId!);
      return await this.dispatch(signed, config, setupToken);
    } catch (error) {
      const message = walletErrorMessage(error);
      if (direct) await api('wallet-error', { id: step.id, message }).catch(() => undefined);
      throw new Error(message);
    }
  }
  async dispatch(step: BridgeStep, config: LocalWalletConfig, setupToken?: string) {
    const direct = isDirectLendingStep(step);
    await this.check(direct ? { ethereumWallet: null, solanaWallet: config.solanaWallet } : config);
    const api = <T,>(operation: string, fields: Record<string, unknown>) => bridgeApi<T>(direct ? `lending-${operation}` : operation, fields, setupToken);
    await checkSolanaBrowserRpc();
    const dispatch = await api<{ step: BridgeStep; serialized: string }>('dispatch-solana', { id: step.id });
    const result = await solanaBrowserRpc('sendTransaction', [dispatch.serialized, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0, minContextSlot: step.solana!.contextSlot }]);
    if (result !== dispatch.step.transactionId) stop('Solana returned an unexpected signature. Check the saved signature.');
    return api('reconcile', { id: step.id });
  }
}
