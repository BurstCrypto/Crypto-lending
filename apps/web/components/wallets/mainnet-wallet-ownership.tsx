'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import { useSensitiveViewRevalidation } from '@/lib/browser/use-sensitive-view-revalidation';
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
  type MainnetWalletRosterClient,
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
import { MAINNET_SOLANA_WALLET_NETWORK } from '@/lib/wallets/solana/mainnet-network';
import { type WalletAdapter, type WalletConnection } from '@/lib/wallets/wallet-adapter';

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

  function clearPending(expected?: PendingConnection): void {
    if (expected !== undefined && pending !== expected) return;
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
          network: MAINNET_SOLANA_WALLET_NETWORK,
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
            void adapter.disconnect(connection.connectionId).catch(() => undefined);
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
        if (result.chainId !== MAINNET_SOLANA_WALLET_NETWORK.chainId) {
          throw new MainnetWalletRuntimeError('CONNECTION_CHANGED');
        }
        return Object.freeze({
          status: result.status,
          walletId: result.walletId,
          chainId: MAINNET_SOLANA_WALLET_NETWORK.chainId,
          addressHint: mainnetWalletAddressHint(
            MAINNET_SOLANA_WALLET_NETWORK.chainId,
            result.address,
          ),
        });
      } finally {
        clearPending(current);
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
  readonly createRosterClient: () => MainnetWalletRosterClient;
}

export interface MainnetWalletOwnershipProps {
  readonly id?: string;
  readonly onAuthenticationRequired?: () => void;
  readonly onWalletsChanged?: () => void;
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

function publicRemovalFailureMessage(error: unknown): string {
  if (error instanceof MainnetWalletRosterError) {
    if (error.code === 'UNAUTHENTICATED') {
      return 'Your account session ended. Sign in again before removing a wallet.';
    }
  }
  return "We couldn't confirm the removal result. The wallet list is refreshing; check it before trying again.";
}

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
  onWalletsChanged,
  onVerified,
  dependencies,
}: MainnetWalletOwnershipProps) {
  const configured = useMemo(() => ({ ...DEFAULT_DEPENDENCIES, ...dependencies }), [dependencies]);
  const accountChoicesId = useId();
  const [chainId, setChainId] = useState<MainnetWalletNetworkId>('eip155:1');
  const [wallets, setWallets] = useState<readonly InjectedProviderDescriptor[]>([]);
  const [connection, setConnection] = useState<MainnetWalletConnectionChoice | null>(null);
  const [result, setResult] = useState<MainnetWalletVerificationResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [walletAnnouncement, setWalletAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);
  const [phantomAvailable, setPhantomAvailable] = useState(false);
  const [roster, setRoster] = useState<MainnetWalletRosterState>({ status: 'LOADING' });
  const [rosterRevision, setRosterRevision] = useState(0);
  const [removalTarget, setRemovalTarget] = useState<MainnetRegisteredWalletSummary | null>(null);
  const [removingWalletId, setRemovingWalletId] = useState<string | null>(null);
  const [removalFailure, setRemovalFailure] = useState<string | null>(null);
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const runtimeReference = useRef<MainnetWalletOwnershipRuntime | null>(null);
  const walletOperationReference = useRef<AbortController | null>(null);
  const walletOperationGenerationReference = useRef(0);
  const walletReturnFocusReference = useRef<HTMLButtonElement | null>(null);
  const pendingWalletFocusReference = useRef<HTMLElement | null>(null);
  const walletChoicesHeadingReference = useRef<HTMLParagraphElement | null>(null);
  const firstAccountButtonReference = useRef<HTMLButtonElement | null>(null);
  const verificationResultReference = useRef<HTMLDivElement | null>(null);
  const rosterRequestReference = useRef<AbortController | null>(null);
  const rosterRequestGenerationReference = useRef(0);
  const removalOperationReference = useRef<AbortController | null>(null);
  const removalOperationGenerationReference = useRef(0);
  const removalTargetReference = useRef<MainnetRegisteredWalletSummary | null>(null);
  const removalReturnFocusReference = useRef<HTMLButtonElement | null>(null);
  const keepWalletButtonReference = useRef<HTMLButtonElement | null>(null);
  const rosterHeadingReference = useRef<HTMLHeadingElement | null>(null);
  const rosterClient = useMemo(() => configured.createRosterClient(), [configured]);

  const invalidateWalletOperation = useCallback((): void => {
    walletOperationGenerationReference.current += 1;
    walletOperationReference.current?.abort();
    walletOperationReference.current = null;
    try {
      runtimeReference.current?.cancel();
    } catch {
      // Local state still fails closed if an injected wallet cleanup hook fails.
    }
  }, []);

  const invalidateRemovalOperation = useCallback((): void => {
    removalOperationGenerationReference.current += 1;
    removalOperationReference.current?.abort();
    removalOperationReference.current = null;
  }, []);

  const invalidateRoster = useCallback((): void => {
    rosterRequestGenerationReference.current += 1;
    rosterRequestReference.current?.abort();
    setRoster({ status: 'LOADING' });
  }, []);

  const revalidateRoster = useCallback((): void => {
    setRosterRevision((current) => current + 1);
  }, []);

  const invalidateSensitiveWalletData = useCallback((): void => {
    invalidateWalletOperation();
    invalidateRemovalOperation();
    invalidateRoster();
    walletReturnFocusReference.current = null;
    pendingWalletFocusReference.current = null;
    removalTargetReference.current = null;
    removalReturnFocusReference.current = null;
    setBusy(false);
    setConnection(null);
    setResult(null);
    setFailure(null);
    setWalletAnnouncement('');
    setRemovalTarget(null);
    setRemovingWalletId(null);
    setRemovalFailure(null);
    setRemovalNotice(null);
  }, [invalidateRemovalOperation, invalidateRoster, invalidateWalletOperation]);

  const isSensitiveViewActive = useSensitiveViewRevalidation({
    invalidate: invalidateSensitiveWalletData,
    revalidate: revalidateRoster,
  });

  useEffect(() => {
    removalTargetReference.current = removalTarget;
  }, [removalTarget]);

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
      walletOperationGenerationReference.current += 1;
      walletOperationReference.current?.abort();
      walletOperationReference.current = null;
      unsubscribe();
      runtime.dispose();
      if (runtimeReference.current === runtime) runtimeReference.current = null;
    };
  }, [configured]);

  useEffect(() => () => invalidateRemovalOperation(), [invalidateRemovalOperation]);

  useEffect(() => {
    if (removalTarget !== null && removingWalletId === null) {
      keepWalletButtonReference.current?.focus();
    }
  }, [removalTarget, removingWalletId]);

  useEffect(() => {
    if (connection !== null && !busy) firstAccountButtonReference.current?.focus();
  }, [busy, connection]);

  useEffect(() => {
    if (connection !== null || busy) return;
    const target = pendingWalletFocusReference.current;
    if (target === null) return;
    pendingWalletFocusReference.current = null;
    if (target.isConnected && (!(target instanceof HTMLButtonElement) || !target.disabled)) {
      target.focus();
      return;
    }
    walletChoicesHeadingReference.current?.focus();
  }, [busy, connection]);

  useEffect(() => {
    if (result !== null && !busy) verificationResultReference.current?.focus();
  }, [busy, result]);

  useEffect(() => {
    if (!isSensitiveViewActive()) return;
    const controller = new AbortController();
    const generation = rosterRequestGenerationReference.current;
    rosterRequestReference.current?.abort();
    rosterRequestReference.current = controller;

    const isCurrentRequest = (): boolean =>
      !controller.signal.aborted &&
      rosterRequestReference.current === controller &&
      rosterRequestGenerationReference.current === generation;

    async function loadRoster(): Promise<void> {
      try {
        const next = await rosterClient.readWallets(controller.signal);
        if (isCurrentRequest()) {
          setRoster({ status: 'READY', wallets: next.wallets });
          const target = removalTargetReference.current;
          if (
            target !== null &&
            !next.wallets.some((wallet) => wallet.walletId === target.walletId)
          ) {
            invalidateRemovalOperation();
            setRemovalTarget(null);
            setRemovingWalletId(null);
            setRemovalFailure(null);
            setRemovalNotice('The wallet is no longer active on this account.');
            try {
              onWalletsChanged?.();
            } catch {
              // The refreshed roster is already authoritative for this screen.
            }
            queueMicrotask(() => rosterHeadingReference.current?.focus());
          }
        }
      } catch (error) {
        if (!isCurrentRequest() || isAbortFailure(error, controller.signal)) return;
        if (
          error instanceof MainnetWalletRosterError &&
          error.code === 'UNAUTHENTICATED' &&
          onAuthenticationRequired !== undefined
        ) {
          try {
            onAuthenticationRequired();
          } catch {
            if (isCurrentRequest()) setRoster({ status: 'UNAVAILABLE' });
          }
          return;
        }
        if (isCurrentRequest()) setRoster({ status: 'UNAVAILABLE' });
      }
    }
    void loadRoster();
    return () => {
      controller.abort();
      if (rosterRequestReference.current === controller) rosterRequestReference.current = null;
    };
  }, [
    invalidateRemovalOperation,
    isSensitiveViewActive,
    onAuthenticationRequired,
    onWalletsChanged,
    rosterClient,
    rosterRevision,
  ]);

  const network = mainnetWalletNetworkFor(chainId);
  const metamaskMatches = connectorMatches(wallets, 'metamask');
  const coinbaseMatches = connectorMatches(wallets, 'coinbase');
  const metamask = metamaskMatches.length === 1 ? metamaskMatches[0] : undefined;
  const coinbase = coinbaseMatches.length === 1 ? coinbaseMatches[0] : undefined;
  const ambiguous = metamaskMatches.length > 1 || coinbaseMatches.length > 1;
  const removalPending = removingWalletId !== null;
  const walletInteractionBlocked = busy || removalTarget !== null || roster.status !== 'READY';

  function retryRoster(): void {
    invalidateRoster();
    revalidateRoster();
  }

  function beginWalletOperation(): {
    readonly controller: AbortController;
    readonly generation: number;
  } {
    const controller = new AbortController();
    const generation = walletOperationGenerationReference.current + 1;
    walletOperationGenerationReference.current = generation;
    walletOperationReference.current = controller;
    return { controller, generation };
  }

  function isCurrentWalletOperation(
    runtime: MainnetWalletOwnershipRuntime,
    controller: AbortController,
    generation: number,
  ): boolean {
    return (
      !controller.signal.aborted &&
      runtimeReference.current === runtime &&
      walletOperationReference.current === controller &&
      walletOperationGenerationReference.current === generation
    );
  }

  function resetWalletChoice(announcement: string): void {
    pendingWalletFocusReference.current =
      walletReturnFocusReference.current ?? walletChoicesHeadingReference.current;
    invalidateWalletOperation();
    setBusy(false);
    setConnection(null);
    setResult(null);
    setFailure(null);
    setWalletAnnouncement(announcement);
  }

  function selectNetwork(nextChainId: MainnetWalletNetworkId): void {
    if (walletInteractionBlocked || nextChainId === chainId) return;
    invalidateWalletOperation();
    walletReturnFocusReference.current = null;
    pendingWalletFocusReference.current = null;
    setConnection(null);
    setResult(null);
    setFailure(null);
    setWalletAnnouncement(
      `${mainnetWalletNetworkFor(nextChainId).displayName} selected. Choose a wallet.`,
    );
    setChainId(nextChainId);
  }

  function cancelWalletRequest(): void {
    if (!busy || removalTarget !== null) return;
    resetWalletChoice(`Wallet request cancelled. Choose a wallet on ${network.displayName}.`);
  }

  function chooseAnotherWallet(): void {
    if (connection === null || removalTarget !== null) return;
    resetWalletChoice(`Wallet choice cleared. Choose a wallet on ${network.displayName}.`);
  }

  async function connect(
    connectorId: MainnetConnectorId,
    selectionId: string | null,
    returnFocus: HTMLButtonElement,
  ): Promise<void> {
    const runtime = runtimeReference.current;
    if (runtime === null || walletInteractionBlocked || walletOperationReference.current !== null) {
      return;
    }
    walletReturnFocusReference.current = returnFocus;
    const { controller, generation } = beginWalletOperation();
    setBusy(true);
    setConnection(null);
    setResult(null);
    setFailure(null);
    setWalletAnnouncement('');
    try {
      const next = await runtime.connect(chainId, connectorId, selectionId, controller.signal);
      if (!isCurrentWalletOperation(runtime, controller, generation)) return;
      setConnection(next);
      setWalletAnnouncement(`${next.displayName} connected. Choose an account to verify.`);
    } catch (error) {
      if (
        isCurrentWalletOperation(runtime, controller, generation) &&
        !isAbortFailure(error, controller.signal)
      ) {
        setFailure(publicFailureMessage(error, `${network.displayName} Mainnet`));
      }
    } finally {
      if (isCurrentWalletOperation(runtime, controller, generation)) {
        walletOperationReference.current = null;
        setBusy(false);
      }
    }
  }

  async function verify(account: MainnetWalletAccountChoice): Promise<void> {
    const runtime = runtimeReference.current;
    if (
      runtime === null ||
      connection === null ||
      walletInteractionBlocked ||
      walletOperationReference.current !== null
    ) {
      return;
    }
    const { controller, generation } = beginWalletOperation();
    setBusy(true);
    setFailure(null);
    setResult(null);
    setWalletAnnouncement('');
    try {
      const next = await runtime.verify(
        connection.connectionToken,
        account.accountToken,
        controller.signal,
      );
      if (!isCurrentWalletOperation(runtime, controller, generation)) return;
      setConnection(null);
      setResult(next);
      invalidateRoster();
      revalidateRoster();
      try {
        onVerified?.(next);
      } catch {
        // Parent rendering failures cannot repeat an accepted proof.
      }
      try {
        onWalletsChanged?.();
      } catch {
        // Parent rendering failures cannot repeat an accepted proof.
      }
    } catch (error) {
      if (
        !isCurrentWalletOperation(runtime, controller, generation) ||
        isAbortFailure(error, controller.signal)
      ) {
        return;
      }
      setConnection(null);
      pendingWalletFocusReference.current =
        walletReturnFocusReference.current ?? walletChoicesHeadingReference.current;
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
      if (isCurrentWalletOperation(runtime, controller, generation)) {
        walletOperationReference.current = null;
        setBusy(false);
      }
    }
  }

  function requestWalletRemoval(
    wallet: MainnetRegisteredWalletSummary,
    returnFocus: HTMLButtonElement,
  ): void {
    if (busy || removalTarget !== null) return;
    removalReturnFocusReference.current = returnFocus;
    setResult(null);
    setFailure(null);
    setRemovalFailure(null);
    setRemovalNotice(null);
    setRemovalTarget(wallet);
  }

  function cancelWalletRemoval(): void {
    if (removalPending) return;
    const returnFocus = removalReturnFocusReference.current;
    setRemovalTarget(null);
    setRemovalFailure(null);
    queueMicrotask(() => returnFocus?.focus());
  }

  function refreshAfterUncertainRemoval(): void {
    setRemovalTarget(null);
    setRemovingWalletId(null);
    setRemovalFailure(publicRemovalFailureMessage(undefined));
    invalidateRoster();
    revalidateRoster();
    try {
      onWalletsChanged?.();
    } catch {
      // The local roster refresh still reconciles the uncertain request.
    }
    queueMicrotask(() => rosterHeadingReference.current?.focus());
  }

  function stopWaitingForRemoval(): void {
    if (removingWalletId === null) return;
    invalidateRemovalOperation();
    refreshAfterUncertainRemoval();
  }

  function isCurrentRemovalOperation(controller: AbortController, generation: number): boolean {
    return (
      !controller.signal.aborted &&
      removalOperationReference.current === controller &&
      removalOperationGenerationReference.current === generation
    );
  }

  async function confirmWalletRemoval(): Promise<void> {
    const target = removalTarget;
    if (target === null || busy || removalPending) return;
    const controller = new AbortController();
    const generation = removalOperationGenerationReference.current + 1;
    removalOperationGenerationReference.current = generation;
    removalOperationReference.current = controller;
    setRemovingWalletId(target.walletId);
    setRemovalFailure(null);
    setRemovalNotice(null);
    try {
      await rosterClient.removeWallet(target.walletId, controller.signal);
      if (!isCurrentRemovalOperation(controller, generation)) return;
      setRemovalTarget(null);
      setRemovalNotice(
        `${mainnetWalletNetworkFor(target.chainId).displayName} wallet removed. Portfolio monitoring for that address has stopped.`,
      );
      invalidateRoster();
      revalidateRoster();
      try {
        onWalletsChanged?.();
      } catch {
        // The local roster refresh still reflects the confirmed removal.
      }
      queueMicrotask(() => rosterHeadingReference.current?.focus());
    } catch (error) {
      if (
        !isCurrentRemovalOperation(controller, generation) ||
        isAbortFailure(error, controller.signal)
      ) {
        return;
      }
      if (
        error instanceof MainnetWalletRosterError &&
        error.code === 'UNAUTHENTICATED' &&
        onAuthenticationRequired !== undefined
      ) {
        setRemovalTarget(null);
        try {
          onAuthenticationRequired();
        } catch {
          setRemovalFailure(publicRemovalFailureMessage(error));
        }
        return;
      }
      refreshAfterUncertainRemoval();
    } finally {
      if (isCurrentRemovalOperation(controller, generation)) {
        removalOperationReference.current = null;
        setRemovingWalletId(null);
      }
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
            <h3 id="verified-wallets-title" ref={rosterHeadingReference} tabIndex={-1}>
              Verified wallets
            </h3>
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
            <button type="button" disabled={busy || removalPending} onClick={retryRoster}>
              Retry wallet list
            </button>
          </div>
        ) : roster.wallets.length === 0 ? (
          <p>No wallets are verified for this account yet.</p>
        ) : (
          <ul className="mainnet-wallet-roster-list">
            {roster.wallets.map((wallet) => {
              const confirming = removalTarget?.walletId === wallet.walletId;
              const removing = removingWalletId === wallet.walletId;
              const descriptionId = `remove-wallet-${wallet.walletId}`;
              const confirmationId = `${descriptionId}-confirmation`;
              return (
                <li key={wallet.walletId} aria-busy={removing}>
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
                  <button
                    type="button"
                    className="mainnet-wallet-remove-button"
                    aria-label={`Remove ${mainnetWalletNetworkFor(wallet.chainId).displayName} wallet ${wallet.addressHint}`}
                    aria-expanded={confirming}
                    aria-controls={confirming ? confirmationId : undefined}
                    disabled={busy || removalTarget !== null}
                    onClick={(event) => requestWalletRemoval(wallet, event.currentTarget)}
                  >
                    Remove wallet
                  </button>
                  {confirming ? (
                    <div
                      id={confirmationId}
                      className="mainnet-wallet-remove-confirmation"
                      role="group"
                      aria-labelledby={`${descriptionId}-title`}
                      aria-describedby={descriptionId}
                    >
                      <strong id={`${descriptionId}-title`}>Remove this wallet?</strong>
                      <p id={descriptionId}>
                        This stops Crypto Lending from showing or monitoring this address. It does
                        not disconnect your wallet extension, revoke onchain approvals, or move
                        funds. Adding it again requires a new ownership signature. An encrypted
                        security record is retained.
                      </p>
                      <div className="mainnet-wallet-remove-actions">
                        <button
                          ref={keepWalletButtonReference}
                          type="button"
                          onClick={removing ? stopWaitingForRemoval : cancelWalletRemoval}
                        >
                          {removing ? 'Stop waiting and refresh' : 'Keep wallet'}
                        </button>
                        <button
                          type="button"
                          className="mainnet-wallet-remove-confirm"
                          disabled={removing}
                          onClick={() => void confirmWalletRemoval()}
                        >
                          {removing ? 'Removing wallet...' : 'Yes, remove wallet'}
                        </button>
                      </div>
                      {removing ? (
                        <p role="status" aria-live="polite">
                          Removing wallet. Keep this page open.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {removalNotice !== null ? (
          <p className="mainnet-wallet-removal-status" role="status" aria-live="polite">
            {removalNotice}
          </p>
        ) : null}
        {removalFailure !== null ? <p role="alert">{removalFailure}</p> : null}
      </section>

      <div className="public-testnet-wallet-selection">
        <span className="visually-hidden" aria-live="polite" aria-atomic="true">
          {walletAnnouncement}
        </span>
        <p>1. Choose a network</p>
        <div role="group" aria-label="Wallet network">
          {MAINNET_WALLET_NETWORKS.map((candidate) => (
            <button
              key={candidate.chainId}
              type="button"
              aria-pressed={chainId === candidate.chainId}
              disabled={walletInteractionBlocked || roster.status !== 'READY'}
              onClick={() => selectNetwork(candidate.chainId)}
            >
              {candidate.displayName}
            </button>
          ))}
        </div>

        <p ref={walletChoicesHeadingReference} tabIndex={-1}>
          2. Connect a wallet on {network.displayName}
        </p>
        {network.namespace === 'eip155' ? (
          <div role="group" aria-label={`${network.displayName} wallet choices`}>
            <button
              type="button"
              disabled={
                walletInteractionBlocked ||
                roster.status !== 'READY' ||
                connection !== null ||
                metamask === undefined
              }
              onClick={(event) =>
                metamask && void connect('metamask', metamask.selectionId, event.currentTarget)
              }
            >
              MetaMask
            </button>
            <button
              type="button"
              disabled={
                walletInteractionBlocked ||
                roster.status !== 'READY' ||
                connection !== null ||
                coinbase === undefined
              }
              onClick={(event) =>
                coinbase && void connect('coinbase', coinbase.selectionId, event.currentTarget)
              }
            >
              Coinbase Wallet
            </button>
          </div>
        ) : (
          <div role="group" aria-label="Solana wallet choices">
            <button
              type="button"
              disabled={
                walletInteractionBlocked ||
                roster.status !== 'READY' ||
                connection !== null ||
                !phantomAvailable
              }
              onClick={(event) => void connect('phantom', null, event.currentTarget)}
            >
              Phantom
            </button>
          </div>
        )}

        {connection !== null ? (
          <div className="mainnet-wallet-success">
            <h3 id={accountChoicesId}>3. Choose a {connection.displayName} account to verify</h3>
            <div role="group" aria-labelledby={accountChoicesId}>
              {connection.accounts.map((account, index) => (
                <button
                  key={account.accountToken}
                  ref={index === 0 ? firstAccountButtonReference : undefined}
                  type="button"
                  disabled={walletInteractionBlocked}
                  onClick={() => void verify(account)}
                >
                  Verify {account.addressHint}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mainnet-wallet-change-button"
              disabled={removalTarget !== null}
              onClick={chooseAnotherWallet}
            >
              Choose another wallet
            </button>
          </div>
        ) : null}

        {busy ? (
          <div className="mainnet-wallet-request-status">
            <p role="status" aria-live="polite">
              Follow the wallet prompt. No request is retried automatically.
            </p>
            {connection === null ? (
              <button
                type="button"
                className="mainnet-wallet-change-button"
                onClick={cancelWalletRequest}
              >
                Cancel wallet request
              </button>
            ) : null}
          </div>
        ) : failure !== null ? (
          <div className="local-demo-wallet-error" role="alert">
            <p>{failure}</p>
            <p>No request is retried automatically.</p>
          </div>
        ) : result !== null ? (
          <div
            ref={verificationResultReference}
            className="mainnet-wallet-success"
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
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
