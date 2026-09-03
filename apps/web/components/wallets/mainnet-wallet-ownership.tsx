'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import {
  InjectedEvmConnectorRegistry,
  InjectedEvmWalletError,
  type InjectedEip1193WalletAdapter,
} from '@/lib/wallets/eip1193/adapter';
import {
  Eip6963ProviderDiscovery,
  type Eip6963EventTarget,
  type InjectedProviderDescriptor,
} from '@/lib/wallets/eip1193/discovery';
import {
  HttpEvmWalletOwnershipClient,
  WalletOwnershipHandoffError,
  completeEvmWalletOwnershipRegistration,
  type EvmWalletOwnershipClient,
} from '@/lib/wallets/eip1193/ownership';
import {
  MAINNET_EVM_WALLET_NETWORKS,
  MAINNET_WALLET_NETWORKS,
  mainnetWalletAddressHint,
  mainnetWalletNetworkFor,
  type MainnetWalletNetworkId,
} from '@/lib/wallets/mainnet-network-policy';
import {
  HttpMainnetWalletRosterClient,
  MainnetWalletRosterError,
  type MainnetRegisteredWalletSummary,
  type MainnetWalletRosterReader,
} from '@/lib/wallets/mainnet-wallet-roster-client';
import {
  PhantomSolanaAdapterError,
  createPhantomSolanaAdapter,
  discoverInjectedPhantomSolanaProvider,
} from '@/lib/wallets/phantom-solana-adapter';
import {
  HttpSolanaWalletOwnershipClient,
  completeSolanaWalletOwnershipRegistration,
  type SolanaWalletOwnershipClient,
} from '@/lib/wallets/solana/ownership';
import {
  SOLANA_CAIP_CHAIN_IDS,
  type WalletAdapter,
  type WalletConnection,
} from '@/lib/wallets/wallet-adapter';

export { MAINNET_WALLET_NETWORKS } from '@/lib/wallets/mainnet-network-policy';

type MainnetConnectorId = 'metamask' | 'coinbase' | 'phantom';

export interface MainnetWalletAccountChoice {
  readonly accountToken: string;
  readonly addressHint: string;
}

export interface MainnetWalletConnectionChoice {
  readonly connectionToken: string;
  readonly connectorId: MainnetConnectorId;
  readonly displayName: string;
  readonly chainId: MainnetWalletNetworkId;
  readonly accounts: readonly MainnetWalletAccountChoice[];
}

export interface MainnetWalletVerificationResult {
  readonly status: 'registered' | 'already_registered';
  readonly walletId: string;
  readonly chainId: MainnetWalletNetworkId;
  readonly addressHint: string;
}

export type MainnetWalletRuntimeErrorCode =
  | 'ACCOUNT_UNAVAILABLE'
  | 'CONNECTION_CHANGED'
  | 'CONNECTOR_UNAVAILABLE'
  | 'OPERATION_PENDING'
  | 'WRONG_NETWORK';

export class MainnetWalletRuntimeError extends Error {
  constructor(readonly code: MainnetWalletRuntimeErrorCode) {
    super(code);
    this.name = 'MainnetWalletRuntimeError';
  }
}

export interface MainnetWalletOwnershipRuntime {
  start(): void;
  listEvmWallets(): readonly InjectedProviderDescriptor[];
  subscribeEvmWallets(
    listener: (wallets: readonly InjectedProviderDescriptor[]) => void,
  ): () => void;
  hasPhantom(): boolean;
  connect(
    chainId: MainnetWalletNetworkId,
    connectorId: MainnetConnectorId,
    selectionId: string | null,
    signal: AbortSignal,
  ): Promise<MainnetWalletConnectionChoice>;
  verify(
    connectionToken: string,
    accountToken: string,
    signal: AbortSignal,
  ): Promise<MainnetWalletVerificationResult>;
  cancel(): void;
  dispose(): void;
}

interface PendingEvmConnection {
  readonly kind: 'EVM';
  readonly connectionToken: string;
  readonly selectionId: string;
  readonly adapter: InjectedEip1193WalletAdapter;
  readonly connection: WalletConnection;
  readonly accountsByToken: ReadonlyMap<string, string>;
}

interface PendingSolanaConnection {
  readonly kind: 'SOLANA';
  readonly connectionToken: string;
  readonly adapter: WalletAdapter;
  readonly connection: WalletConnection;
  readonly accountToken: string;
}

type PendingConnection = PendingEvmConnection | PendingSolanaConnection;

interface RuntimeOperation {
  readonly generation: number;
  readonly controller: AbortController;
  readonly removeExternalAbortListener: () => void;
}

export interface MainnetWalletOwnershipRuntimeOptions {
  readonly target?: Eip6963EventTarget | null;
  readonly windowValue?: unknown;
  readonly createSelectionId?: () => string;
  readonly createConnectionId?: () => string;
  readonly createOpaqueToken?: () => string;
  readonly evmClient?: EvmWalletOwnershipClient;
  readonly solanaClient?: SolanaWalletOwnershipClient;
}

function opaqueToken(): string {
  if (typeof crypto !== 'object' || typeof crypto.randomUUID !== 'function') {
    throw new MainnetWalletRuntimeError('CONNECTOR_UNAVAILABLE');
  }
  return crypto.randomUUID();
}

export function createMainnetWalletOwnershipRuntime(
  options: MainnetWalletOwnershipRuntimeOptions = {},
): MainnetWalletOwnershipRuntime {
  const discovery = new Eip6963ProviderDiscovery({
    supportedNetworks: MAINNET_EVM_WALLET_NETWORKS,
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.createSelectionId === undefined
      ? {}
      : { createSelectionId: options.createSelectionId }),
  });
  const registry = new InjectedEvmConnectorRegistry(discovery, options.createConnectionId);
  const evmClient = options.evmClient ?? new HttpEvmWalletOwnershipClient();
  const solanaClient = options.solanaClient ?? new HttpSolanaWalletOwnershipClient();
  const createToken = options.createOpaqueToken ?? opaqueToken;
  const windowValue = options.windowValue === undefined ? globalThis.window : options.windowValue;
  let pending: PendingConnection | null = null;
  let activeOperation: RuntimeOperation | null = null;
  let operationGeneration = 0;
  let disposed = false;

  function assertAvailable(): void {
    if (disposed) throw new MainnetWalletRuntimeError('CONNECTOR_UNAVAILABLE');
  }

  function clearPending(): void {
    const current = pending;
    pending = null;
    if (current?.kind === 'EVM') {
      registry.release(current.selectionId);
      return;
    }
    if (current?.kind === 'SOLANA') {
      void current.adapter.disconnect(current.connection.connectionId).catch(() => undefined);
    }
  }

  function beginOperation(signal: AbortSignal): RuntimeOperation {
    assertAvailable();
    if (activeOperation !== null) throw new MainnetWalletRuntimeError('OPERATION_PENDING');
    if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const operation = Object.freeze({
      generation: operationGeneration,
      controller,
      removeExternalAbortListener: () => signal.removeEventListener('abort', abort),
    });
    activeOperation = operation;
    return operation;
  }

  function assertCurrentOperation(operation: RuntimeOperation): void {
    if (
      operation.controller.signal.aborted ||
      disposed ||
      activeOperation !== operation ||
      operation.generation !== operationGeneration
    ) {
      throw new DOMException('Request aborted', 'AbortError');
    }
  }

  function finishOperation(operation: RuntimeOperation): void {
    operation.removeExternalAbortListener();
    if (activeOperation === operation) activeOperation = null;
  }

  function invalidateOperation(): void {
    operationGeneration += 1;
    activeOperation?.controller.abort();
  }

  return {
    start: () => {
      assertAvailable();
      discovery.start();
    },
    listEvmWallets: () => discovery.list(),
    subscribeEvmWallets: (listener) => discovery.subscribe(listener),
    hasPhantom: () => discoverInjectedPhantomSolanaProvider(windowValue) !== null,
    connect: async (chainId, connectorId, selectionId, signal) => {
      assertAvailable();
      if (pending !== null || activeOperation !== null) {
        throw new MainnetWalletRuntimeError('OPERATION_PENDING');
      }
      const network = mainnetWalletNetworkFor(chainId);
      const operation = beginOperation(signal);

      try {
        if (network.namespace === 'eip155') {
          if (connectorId === 'phantom' || selectionId === null) {
            throw new MainnetWalletRuntimeError('CONNECTOR_UNAVAILABLE');
          }
          const adapter = registry.select(selectionId);
          try {
            if (adapter.connectorId !== connectorId) {
              throw new MainnetWalletRuntimeError('CONNECTOR_UNAVAILABLE');
            }
            const connection = await adapter.connect({ signal: operation.controller.signal });
            assertCurrentOperation(operation);
            if (connection.selectedAccount.chainId !== chainId) {
              throw new MainnetWalletRuntimeError('WRONG_NETWORK');
            }
            const connectionToken = createToken();
            const accountsByToken = new Map<string, string>();
            const accounts = connection.accounts.map(({ address }) => {
              const accountToken = createToken();
              accountsByToken.set(accountToken, address);
              return Object.freeze({
                accountToken,
                addressHint: mainnetWalletAddressHint(chainId, address),
              });
            });
            pending = Object.freeze({
              kind: 'EVM',
              connectionToken,
              selectionId,
              adapter,
              connection,
              accountsByToken,
            });
            return Object.freeze({
              connectionToken,
              connectorId,
              displayName: connectorId === 'metamask' ? 'MetaMask' : 'Coinbase Wallet',
              chainId,
              accounts: Object.freeze(accounts),
            });
          } catch (error) {
            registry.release(selectionId);
            throw error;
          }
        }

        if (connectorId !== 'phantom' || selectionId !== null) {
          throw new MainnetWalletRuntimeError('CONNECTOR_UNAVAILABLE');
        }
        const provider = discoverInjectedPhantomSolanaProvider(windowValue);
        if (provider === null) throw new MainnetWalletRuntimeError('CONNECTOR_UNAVAILABLE');
        const adapter = createPhantomSolanaAdapter({
          chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
          getProvider: () => provider,
          ...(options.createConnectionId === undefined
            ? {}
            : { createConnectionId: options.createConnectionId }),
        });
        let connection: WalletConnection | null = null;
        try {
          connection = await adapter.connect({ signal: operation.controller.signal });
          assertCurrentOperation(operation);
          if (connection.selectedAccount.chainId !== chainId) {
            throw new MainnetWalletRuntimeError('WRONG_NETWORK');
          }
          const connectionToken = createToken();
          const accountToken = createToken();
          pending = Object.freeze({
            kind: 'SOLANA',
            connectionToken,
            adapter,
            connection,
            accountToken,
          });
          return Object.freeze({
            connectionToken,
            connectorId,
            displayName: 'Phantom',
            chainId,
            accounts: Object.freeze([
              Object.freeze({
                accountToken,
                addressHint: mainnetWalletAddressHint(chainId, connection.selectedAccount.address),
              }),
            ]),
          });
        } catch (error) {
          if (connection !== null) {
            await adapter.disconnect(connection.connectionId).catch(() => undefined);
          }
          throw error;
        }
      } finally {
        finishOperation(operation);
      }
    },
    verify: async (connectionToken, accountToken, signal) => {
      assertAvailable();
      if (activeOperation !== null) throw new MainnetWalletRuntimeError('OPERATION_PENDING');
      const current = pending;
      if (current === null || current.connectionToken !== connectionToken) {
        throw new MainnetWalletRuntimeError('CONNECTION_CHANGED');
      }
      const operation = beginOperation(signal);
      try {
        if (current.kind === 'EVM') {
          const address = current.accountsByToken.get(accountToken);
          if (address === undefined) throw new MainnetWalletRuntimeError('ACCOUNT_UNAVAILABLE');
          const connection = current.adapter.selectAccount(
            current.connection.connectionId,
            address,
          );
          const result = await completeEvmWalletOwnershipRegistration({
            adapter: current.adapter,
            connection,
            client: evmClient,
            signal: operation.controller.signal,
          });
          assertCurrentOperation(operation);
          return Object.freeze({
            status: result.status,
            walletId: result.walletId,
            chainId: result.chainId as MainnetWalletNetworkId,
            addressHint: mainnetWalletAddressHint(
              result.chainId as MainnetWalletNetworkId,
              result.address,
            ),
          });
        }
        if (current.accountToken !== accountToken) {
          throw new MainnetWalletRuntimeError('ACCOUNT_UNAVAILABLE');
        }
        const result = await completeSolanaWalletOwnershipRegistration({
          adapter: current.adapter,
          connection: current.connection,
          client: solanaClient,
          signal: operation.controller.signal,
        });
        assertCurrentOperation(operation);
        if (result.chainId !== SOLANA_CAIP_CHAIN_IDS.mainnet) {
          throw new MainnetWalletRuntimeError('CONNECTION_CHANGED');
        }
        return Object.freeze({
          status: result.status,
          walletId: result.walletId,
          chainId: SOLANA_CAIP_CHAIN_IDS.mainnet,
          addressHint: mainnetWalletAddressHint(SOLANA_CAIP_CHAIN_IDS.mainnet, result.address),
        });
      } finally {
        clearPending();
        finishOperation(operation);
      }
    },
    cancel: () => {
      invalidateOperation();
      clearPending();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      invalidateOperation();
      clearPending();
      registry.dispose();
    },
  };
}

export interface MainnetWalletOwnershipDependencies {
  readonly createRuntime: () => MainnetWalletOwnershipRuntime;
  readonly createRosterClient: () => MainnetWalletRosterReader;
}

export interface MainnetWalletOwnershipProps {
  readonly id?: string;
  readonly onAuthenticationRequired?: () => void;
  readonly onVerified?: (result: MainnetWalletVerificationResult) => void;
  readonly dependencies?: Partial<MainnetWalletOwnershipDependencies>;
}

const DEFAULT_DEPENDENCIES: MainnetWalletOwnershipDependencies = Object.freeze({
  createRuntime: () => createMainnetWalletOwnershipRuntime(),
  createRosterClient: () => new HttpMainnetWalletRosterClient(),
});

type MainnetWalletRosterState =
  | Readonly<{ status: 'LOADING' }>
  | Readonly<{ status: 'READY'; wallets: readonly MainnetRegisteredWalletSummary[] }>
  | Readonly<{ status: 'UNAVAILABLE' }>;

function publicFailureMessage(error: unknown, networkName: string): string {
  if (error instanceof MainnetWalletRuntimeError) {
    switch (error.code) {
      case 'WRONG_NETWORK':
        return `Set the selected wallet to ${networkName}, then try again. Crypto Lending will not switch or add a network.`;
      case 'ACCOUNT_UNAVAILABLE':
      case 'CONNECTION_CHANGED':
        return 'The selected wallet account changed. Connect it again and choose the account you want to verify.';
      case 'OPERATION_PENDING':
        return 'Finish the open wallet request before starting another one.';
      case 'CONNECTOR_UNAVAILABLE':
        return 'That wallet is not available in this browser.';
    }
  }
  if (error instanceof InjectedEvmWalletError) {
    if (error.code === 'INJECTED_EVM_UNSUPPORTED_NETWORK') {
      return `Set the selected wallet to ${networkName}, then try again. Crypto Lending will not switch or add a network.`;
    }
    if (error.code === 'INJECTED_EVM_USER_REJECTED') {
      return 'The wallet request was declined. Nothing was verified.';
    }
    return 'The EVM wallet connection changed or became unavailable. Connect it again to continue.';
  }
  if (error instanceof PhantomSolanaAdapterError) {
    if (error.code === 'USER_REJECTED')
      return 'The Phantom request was declined. Nothing was verified.';
    return 'Phantom changed or became unavailable. Connect it again to continue.';
  }
  if (error instanceof WalletOwnershipHandoffError) {
    switch (error.code) {
      case 'WALLET_OWNERSHIP_AUTHENTICATION_REQUIRED':
        return 'Your account session ended. Sign in again before verifying a wallet.';
      case 'WALLET_OWNERSHIP_CONFLICT':
        return 'This chain account is already registered to another Crypto Lending account.';
      case 'WALLET_OWNERSHIP_REJECTED':
        return 'The ownership proof was not accepted. Connect the wallet and request a fresh message.';
      case 'WALLET_OWNERSHIP_UNAVAILABLE':
        return 'Wallet verification is temporarily unavailable.';
    }
  }
  return 'Wallet verification could not finish safely. No transaction was created or submitted.';
}

function connectorMatches(
  wallets: readonly InjectedProviderDescriptor[],
  connectorId: 'metamask' | 'coinbase',
): readonly InjectedProviderDescriptor[] {
  return wallets.filter((wallet) => wallet.connectorId === connectorId);
}

export function MainnetWalletOwnership({
  id,
  onAuthenticationRequired,
  onVerified,
  dependencies,
}: MainnetWalletOwnershipProps) {
  const configured = useMemo(() => ({ ...DEFAULT_DEPENDENCIES, ...dependencies }), [dependencies]);
  const [chainId, setChainId] = useState<MainnetWalletNetworkId>('eip155:1');
  const [wallets, setWallets] = useState<readonly InjectedProviderDescriptor[]>([]);
  const [connection, setConnection] = useState<MainnetWalletConnectionChoice | null>(null);
  const [result, setResult] = useState<MainnetWalletVerificationResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phantomAvailable, setPhantomAvailable] = useState(false);
  const [roster, setRoster] = useState<MainnetWalletRosterState>({ status: 'LOADING' });
  const [rosterRevision, setRosterRevision] = useState(0);
  const runtimeReference = useRef<MainnetWalletOwnershipRuntime | null>(null);
  const operationReference = useRef<AbortController | null>(null);

  useEffect(() => {
    const runtime = configured.createRuntime();
    runtimeReference.current = runtime;
    let active = true;
    const updateDetectedWallets = (nextWallets: readonly InjectedProviderDescriptor[]) => {
      if (!active) return;
      setWallets(nextWallets);
      setPhantomAvailable(runtime.hasPhantom());
    };
    const unsubscribe = runtime.subscribeEvmWallets(updateDetectedWallets);
    runtime.start();
    queueMicrotask(() => updateDetectedWallets(runtime.listEvmWallets()));
    return () => {
      active = false;
      operationReference.current?.abort();
      operationReference.current = null;
      unsubscribe();
      runtime.dispose();
      if (runtimeReference.current === runtime) runtimeReference.current = null;
    };
  }, [configured]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadRoster(): Promise<void> {
      try {
        const next = await configured.createRosterClient().readWallets(controller.signal);
        if (!controller.signal.aborted) setRoster({ status: 'READY', wallets: next.wallets });
      } catch (error) {
        if (isAbortFailure(error, controller.signal)) return;
        if (
          error instanceof MainnetWalletRosterError &&
          error.code === 'UNAUTHENTICATED' &&
          onAuthenticationRequired !== undefined
        ) {
          try {
            onAuthenticationRequired();
          } catch {
            if (!controller.signal.aborted) setRoster({ status: 'UNAVAILABLE' });
          }
          return;
        }
        if (!controller.signal.aborted) setRoster({ status: 'UNAVAILABLE' });
      }
    }
    void loadRoster();
    return () => controller.abort();
  }, [configured, onAuthenticationRequired, rosterRevision]);

  const network = mainnetWalletNetworkFor(chainId);
  const metamaskMatches = connectorMatches(wallets, 'metamask');
  const coinbaseMatches = connectorMatches(wallets, 'coinbase');
  const metamask = metamaskMatches.length === 1 ? metamaskMatches[0] : undefined;
  const coinbase = coinbaseMatches.length === 1 ? coinbaseMatches[0] : undefined;
  const ambiguous = metamaskMatches.length > 1 || coinbaseMatches.length > 1;

  function retryRoster(): void {
    setRoster({ status: 'LOADING' });
    setRosterRevision((current) => current + 1);
  }

  function selectNetwork(nextChainId: MainnetWalletNetworkId): void {
    if (busy || nextChainId === chainId) return;
    runtimeReference.current?.cancel();
    setConnection(null);
    setResult(null);
    setFailure(null);
    setChainId(nextChainId);
  }

  async function connect(
    connectorId: MainnetConnectorId,
    selectionId: string | null,
  ): Promise<void> {
    const runtime = runtimeReference.current;
    if (runtime === null || busy) return;
    const controller = new AbortController();
    operationReference.current = controller;
    setBusy(true);
    setConnection(null);
    setResult(null);
    setFailure(null);
    try {
      const next = await runtime.connect(chainId, connectorId, selectionId, controller.signal);
      if (!controller.signal.aborted && runtimeReference.current === runtime) setConnection(next);
    } catch (error) {
      if (!isAbortFailure(error, controller.signal) && runtimeReference.current === runtime) {
        setFailure(publicFailureMessage(error, `${network.displayName} Mainnet`));
      }
    } finally {
      if (operationReference.current === controller) operationReference.current = null;
      if (!controller.signal.aborted && runtimeReference.current === runtime) setBusy(false);
    }
  }

  async function verify(account: MainnetWalletAccountChoice): Promise<void> {
    const runtime = runtimeReference.current;
    if (runtime === null || connection === null || busy) return;
    const controller = new AbortController();
    operationReference.current = controller;
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const next = await runtime.verify(
        connection.connectionToken,
        account.accountToken,
        controller.signal,
      );
      if (controller.signal.aborted || runtimeReference.current !== runtime) return;
      setConnection(null);
      setResult(next);
      setRoster({ status: 'LOADING' });
      setRosterRevision((current) => current + 1);
      try {
        onVerified?.(next);
      } catch {
        // Parent rendering failures cannot repeat an accepted proof.
      }
    } catch (error) {
      if (isAbortFailure(error, controller.signal) || runtimeReference.current !== runtime) return;
      setConnection(null);
      if (
        error instanceof WalletOwnershipHandoffError &&
        error.code === 'WALLET_OWNERSHIP_AUTHENTICATION_REQUIRED' &&
        onAuthenticationRequired !== undefined
      ) {
        try {
          onAuthenticationRequired();
        } catch {
          setFailure(publicFailureMessage(error, `${network.displayName} Mainnet`));
        }
        return;
      }
      setFailure(publicFailureMessage(error, `${network.displayName} Mainnet`));
    } finally {
      if (operationReference.current === controller) operationReference.current = null;
      if (!controller.signal.aborted && runtimeReference.current === runtime) setBusy(false);
    }
  }

  return (
    <section id={id} className="mainnet-wallet-ownership" aria-labelledby="wallet-title">
      <div className="public-testnet-proof-heading">
        <div>
          <p className="eyebrow">Wallet ownership</p>
          <h2 id="wallet-title">Add a wallet</h2>
        </div>
        <span>Ownership only</span>
      </div>

      <p>Choose the network, connect a wallet, then choose the exact account to verify.</p>

      <div className="public-testnet-disclosure" id="mainnet-wallet-disclosure">
        <strong>No transaction or network switching</strong>
        <p>
          Each network account receives its own server-authored ownership message. Crypto Lending
          does not switch networks, bridge funds, approve tokens, or request a transaction.
        </p>
      </div>

      <section className="mainnet-wallet-roster" aria-labelledby="verified-wallets-title">
        <div className="status-heading">
          <div>
            <p className="eyebrow">Your account</p>
            <h3 id="verified-wallets-title">Verified wallets</h3>
          </div>
          {roster.status === 'READY' ? <span>{roster.wallets.length}/32</span> : null}
        </div>
        {roster.status === 'LOADING' ? (
          <p role="status" aria-live="polite">
            Loading verified wallets…
          </p>
        ) : roster.status === 'UNAVAILABLE' ? (
          <div role="status">
            <p>The verified wallet list is unavailable, so adding another wallet is paused.</p>
            <button type="button" disabled={busy} onClick={retryRoster}>
              Retry wallet list
            </button>
          </div>
        ) : roster.wallets.length === 0 ? (
          <p>No wallets are verified for this account yet.</p>
        ) : (
          <ul className="mainnet-wallet-roster-list">
            {roster.wallets.map((wallet) => (
              <li key={wallet.walletId}>
                <strong>{mainnetWalletNetworkFor(wallet.chainId).displayName}</strong>
                <code>{wallet.addressHint}</code>
                <span>
                  Verified{' '}
                  <time dateTime={wallet.registeredAt}>
                    {new Date(wallet.registeredAt).toLocaleDateString('en-US', {
                      timeZone: 'UTC',
                    })}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="public-testnet-wallet-selection">
        <p>1. Choose a network</p>
        <div role="group" aria-label="Wallet network">
          {MAINNET_WALLET_NETWORKS.map((candidate) => (
            <button
              key={candidate.chainId}
              type="button"
              aria-pressed={chainId === candidate.chainId}
              disabled={busy || roster.status !== 'READY'}
              onClick={() => selectNetwork(candidate.chainId)}
            >
              {candidate.displayName}
            </button>
          ))}
        </div>

        <p>2. Connect a wallet on {network.displayName}</p>
        {network.namespace === 'eip155' ? (
          <div role="group" aria-label={`${network.displayName} wallet choices`}>
            <button
              type="button"
              disabled={
                busy || roster.status !== 'READY' || connection !== null || metamask === undefined
              }
              onClick={() => metamask && void connect('metamask', metamask.selectionId)}
            >
              MetaMask
            </button>
            <button
              type="button"
              disabled={
                busy || roster.status !== 'READY' || connection !== null || coinbase === undefined
              }
              onClick={() => coinbase && void connect('coinbase', coinbase.selectionId)}
            >
              Coinbase Wallet
            </button>
          </div>
        ) : (
          <div role="group" aria-label="Solana wallet choices">
            <button
              type="button"
              disabled={
                busy || roster.status !== 'READY' || connection !== null || !phantomAvailable
              }
              onClick={() => void connect('phantom', null)}
            >
              Phantom
            </button>
          </div>
        )}

        {connection !== null ? (
          <div className="mainnet-wallet-success">
            <strong>3. Choose the account to verify</strong>
            <div role="group" aria-label={`${connection.displayName} accounts`}>
              {connection.accounts.map((account) => (
                <button
                  key={account.accountToken}
                  type="button"
                  disabled={busy}
                  onClick={() => void verify(account)}
                >
                  Verify {account.addressHint}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {busy ? (
          <p role="status" aria-live="polite">
            Follow the wallet prompt. No request is retried automatically.
          </p>
        ) : failure !== null ? (
          <div className="local-demo-wallet-error" role="alert">
            <p>{failure}</p>
            <p>No request is retried automatically.</p>
          </div>
        ) : result !== null ? (
          <div className="mainnet-wallet-success" role="status" aria-live="polite">
            <strong>
              {mainnetWalletNetworkFor(result.chainId).displayName} account{' '}
              {result.status === 'registered' ? 'verified' : 'already verified'}
            </strong>
            <p>{result.addressHint} is registered to this Crypto Lending account.</p>
          </div>
        ) : ambiguous && network.namespace === 'eip155' ? (
          <p role="alert">
            Multiple extensions reported the same wallet name. Disable unfamiliar extensions and
            reload before continuing.
          </p>
        ) : network.namespace === 'eip155' && metamask === undefined && coinbase === undefined ? (
          <p role="status">No supported EVM wallet was detected.</p>
        ) : network.namespace === 'solana' && !phantomAvailable ? (
          <p role="status">Phantom was not detected. Its button is disabled.</p>
        ) : null}
      </div>
    </section>
  );
}
