'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { isAbortFailure } from '@/lib/authentication/http';
import {
  InjectedEvmConnectorRegistry,
  InjectedEvmWalletError,
} from '@/lib/wallets/eip1193/adapter';
import {
  Eip6963ProviderDiscovery,
  type Eip6963EventTarget,
  type InjectedProviderDescriptor,
} from '@/lib/wallets/eip1193/discovery';
import { createSupportedEvmNetworks } from '@/lib/wallets/eip1193/networks';
import {
  HttpEvmWalletOwnershipClient,
  WalletOwnershipHandoffError,
  completeEvmWalletOwnershipRegistration,
  type EvmWalletOwnershipClient,
  type RegisteredEvmWalletResult,
} from '@/lib/wallets/eip1193/ownership';

export const BASE_MAINNET_WALLET_OWNERSHIP_NETWORKS = createSupportedEvmNetworks([
  {
    chainId: 'eip155:8453',
    providerChainId: '0x2105',
    displayName: 'Base Mainnet',
    environment: 'MAINNET',
  },
]);

export interface BaseMainnetWalletOwnershipRuntime {
  start(): void;
  list(): readonly InjectedProviderDescriptor[];
  subscribe(listener: (wallets: readonly InjectedProviderDescriptor[]) => void): () => void;
  verify(selectionId: string, signal: AbortSignal): Promise<RegisteredEvmWalletResult>;
  dispose(): void;
}

export interface BaseMainnetWalletOwnershipRuntimeOptions {
  readonly target?: Eip6963EventTarget | null;
  readonly createSelectionId?: () => string;
  readonly createConnectionId?: () => string;
  readonly client?: EvmWalletOwnershipClient;
}

/**
 * Owns every provider capability outside React state and releases the selected
 * adapter after one explicit ownership attempt.
 */
export function createBaseMainnetWalletOwnershipRuntime(
  options: BaseMainnetWalletOwnershipRuntimeOptions = {},
): BaseMainnetWalletOwnershipRuntime {
  const discovery = new Eip6963ProviderDiscovery({
    supportedNetworks: BASE_MAINNET_WALLET_OWNERSHIP_NETWORKS,
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.createSelectionId === undefined
      ? {}
      : { createSelectionId: options.createSelectionId }),
  });
  const registry = new InjectedEvmConnectorRegistry(discovery, options.createConnectionId);
  const client = options.client ?? new HttpEvmWalletOwnershipClient();
  let disposed = false;

  return {
    start: () => {
      if (!disposed) discovery.start();
    },
    list: () => discovery.list(),
    subscribe: (listener) => discovery.subscribe(listener),
    verify: async (selectionId, signal) => {
      if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
      const adapter = registry.select(selectionId);
      try {
        const connection = await adapter.connect({ signal });
        return await completeEvmWalletOwnershipRegistration({
          adapter,
          connection,
          client,
          signal,
        });
      } finally {
        registry.release(selectionId);
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      registry.dispose();
    },
  };
}

export interface BaseMainnetWalletOwnershipDependencies {
  readonly createRuntime: () => BaseMainnetWalletOwnershipRuntime;
}

export interface BaseMainnetWalletOwnershipProps {
  /** Optional integration anchor; the portfolio should pass `wallets`. */
  readonly id?: string;
  /** Clears private account UI when challenge issuance proves the session is gone. */
  readonly onAuthenticationRequired?: () => void;
  /** Lets the parent invalidate balances after an accepted ownership proof. */
  readonly onVerified?: (result: RegisteredEvmWalletResult) => void;
  /** Deterministic injection boundary for focused browser tests. */
  readonly dependencies?: Partial<BaseMainnetWalletOwnershipDependencies>;
}

const DEFAULT_DEPENDENCIES: BaseMainnetWalletOwnershipDependencies = Object.freeze({
  createRuntime: () => createBaseMainnetWalletOwnershipRuntime(),
});

function publicFailureMessage(error: unknown): string {
  if (error instanceof InjectedEvmWalletError) {
    switch (error.code) {
      case 'INJECTED_EVM_UNSUPPORTED_NETWORK':
        return 'Set the selected wallet to Base Mainnet, then select it again. Crypto Lending will not switch or add a network.';
      case 'INJECTED_EVM_USER_REJECTED':
        return 'The wallet request was declined. Nothing was verified. Select a wallet when you are ready to try again.';
      case 'INJECTED_EVM_OPERATION_PENDING':
        return 'The wallet already has a request open. Finish or reject it, then select the wallet again.';
      case 'INJECTED_EVM_PROVIDER_NOT_FOUND':
      case 'INJECTED_EVM_PROVIDER_DISCONNECTED':
      case 'INJECTED_EVM_NOT_CONNECTED':
      case 'INJECTED_EVM_CONNECTION_CHANGED':
        return 'The selected wallet connection changed or became unavailable. Check Base Mainnet in the wallet, then select it again.';
      default:
        return 'The wallet could not be verified safely. Select a wallet to try again. No transaction was created or submitted.';
    }
  }

  if (error instanceof WalletOwnershipHandoffError) {
    switch (error.code) {
      case 'WALLET_OWNERSHIP_AUTHENTICATION_REQUIRED':
        return 'Your account session is no longer available. Sign in again before verifying a wallet.';
      case 'WALLET_OWNERSHIP_CONFLICT':
        return 'This wallet cannot be verified for this account.';
      case 'WALLET_OWNERSHIP_REJECTED':
        return 'The ownership proof was not accepted. Select a wallet to request a fresh message.';
      case 'WALLET_OWNERSHIP_UNAVAILABLE':
        return 'Wallet verification is temporarily unavailable. Select a wallet to try again.';
    }
  }

  return 'Wallet verification could not finish safely. Select a wallet to try again. No transaction was created or submitted.';
}

function walletsFor(
  wallets: readonly InjectedProviderDescriptor[],
  connectorId: 'metamask' | 'coinbase',
): readonly InjectedProviderDescriptor[] {
  return wallets.filter((wallet) => wallet.connectorId === connectorId);
}

export function BaseMainnetWalletOwnership({
  id,
  onAuthenticationRequired,
  onVerified,
  dependencies,
}: BaseMainnetWalletOwnershipProps) {
  const configured = useMemo(() => ({ ...DEFAULT_DEPENDENCIES, ...dependencies }), [dependencies]);
  const [wallets, setWallets] = useState<readonly InjectedProviderDescriptor[]>([]);
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(null);
  const [result, setResult] = useState<RegisteredEvmWalletResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const runtimeReference = useRef<BaseMainnetWalletOwnershipRuntime | null>(null);
  const operationReference = useRef<AbortController | null>(null);
  const pendingSelectionReference = useRef<string | null>(null);

  useEffect(() => {
    const runtime = configured.createRuntime();
    runtimeReference.current = runtime;
    const unsubscribe = runtime.subscribe((nextWallets) => {
      setWallets(nextWallets);
      const pendingSelectionId = pendingSelectionReference.current;
      if (pendingSelectionId === null) return;
      const pendingWallet = nextWallets.find(
        ({ selectionId }) => selectionId === pendingSelectionId,
      );
      if (
        pendingWallet !== undefined &&
        walletsFor(nextWallets, pendingWallet.connectorId).length === 1
      ) {
        return;
      }

      operationReference.current?.abort();
      operationReference.current = null;
      pendingSelectionReference.current = null;
      setPendingSelectionId(null);
      setResult(null);
      setFailure(
        'The detected wallet list changed before verification finished. Its outcome is not shown. Reload your account, then continue only when one expected provider remains.',
      );
    });
    runtime.start();

    return () => {
      operationReference.current?.abort();
      operationReference.current = null;
      pendingSelectionReference.current = null;
      unsubscribe();
      runtime.dispose();
      if (runtimeReference.current === runtime) runtimeReference.current = null;
    };
  }, [configured]);

  async function verify(wallet: InjectedProviderDescriptor): Promise<void> {
    const runtime = runtimeReference.current;
    if (runtime === null || operationReference.current !== null) return;

    const controller = new AbortController();
    operationReference.current = controller;
    pendingSelectionReference.current = wallet.selectionId;
    setPendingSelectionId(wallet.selectionId);
    setResult(null);
    setFailure(null);

    try {
      const nextResult = await runtime.verify(wallet.selectionId, controller.signal);
      if (controller.signal.aborted || runtimeReference.current !== runtime) return;
      setResult(nextResult);
      try {
        onVerified?.(nextResult);
      } catch {
        // Parent rendering failures must not repeat or alter an accepted proof.
      }
    } catch (error) {
      if (isAbortFailure(error, controller.signal) || runtimeReference.current !== runtime) return;
      if (
        error instanceof WalletOwnershipHandoffError &&
        error.code === 'WALLET_OWNERSHIP_AUTHENTICATION_REQUIRED' &&
        onAuthenticationRequired !== undefined
      ) {
        setResult(null);
        try {
          onAuthenticationRequired();
        } catch {
          setFailure(publicFailureMessage(error));
        }
        return;
      }
      setFailure(publicFailureMessage(error));
    } finally {
      if (operationReference.current === controller) operationReference.current = null;
      if (!controller.signal.aborted && runtimeReference.current === runtime) {
        pendingSelectionReference.current = null;
        setPendingSelectionId(null);
      }
    }
  }

  const metamaskMatches = walletsFor(wallets, 'metamask');
  const coinbaseMatches = walletsFor(wallets, 'coinbase');
  const metamask = metamaskMatches.length === 1 ? metamaskMatches[0] : undefined;
  const coinbase = coinbaseMatches.length === 1 ? coinbaseMatches[0] : undefined;
  const ambiguousProviders = metamaskMatches.length > 1 || coinbaseMatches.length > 1;
  const busy = pendingSelectionId !== null;
  const pendingWallet = wallets.find(({ selectionId }) => selectionId === pendingSelectionId);

  return (
    <section
      id={id}
      className="base-mainnet-wallet-ownership public-testnet-proof"
      aria-labelledby="base-wallet-ownership-title"
    >
      <div className="public-testnet-proof-heading">
        <div>
          <p className="eyebrow">Wallet ownership</p>
          <h2 id="base-wallet-ownership-title">Verify a Base Mainnet wallet</h2>
        </div>
        <span>Base only</span>
      </div>

      <p>Choose a detected wallet. Nothing happens until you select one of the buttons below.</p>

      <p className="base-mainnet-wallet-provider-note" id="base-wallet-provider-note">
        Wallet names are self-reported by browser extensions, not authenticated by this site. If a
        choice looks unfamiliar or duplicated, do not continue.
      </p>

      <div className="public-testnet-disclosure" id="base-wallet-ownership-disclosure">
        <strong>Ownership proof only</strong>
        <p>
          Crypto Lending requests account access on Base Mainnet and one server-authored message
          signature. This does not sign you in, move funds, approve tokens, create a loan, read
          blockchain balances, or create, sign, or broadcast a transaction. The site never switches
          or adds a wallet network.
        </p>
      </div>

      <div className="public-testnet-wallet-selection">
        <p>Select the wallet you want to verify.</p>
        <div
          role="group"
          aria-label="Base Mainnet wallet choices"
          aria-describedby="base-wallet-ownership-disclosure base-wallet-provider-note"
        >
          <button
            type="button"
            disabled={busy || metamask === undefined}
            onClick={() => metamask && void verify(metamask)}
          >
            MetaMask
          </button>
          <button
            type="button"
            disabled={busy || coinbase === undefined}
            onClick={() => coinbase && void verify(coinbase)}
          >
            Coinbase Wallet
          </button>
        </div>

        {busy ? (
          <p role="status" aria-live="polite">
            Follow the {pendingWallet?.displayName ?? 'wallet'} prompts to connect on Base Mainnet
            and sign the ownership-only message.
          </p>
        ) : failure !== null ? (
          <div className="local-demo-wallet-error" role="alert">
            <p>{failure}</p>
            <p>No request is retried automatically.</p>
          </div>
        ) : result !== null ? (
          <div className="base-mainnet-wallet-success" role="status" aria-live="polite">
            <strong>
              {result.status === 'registered'
                ? 'Base Mainnet wallet verified'
                : 'Base Mainnet wallet already verified'}
            </strong>
            <p>
              {result.status === 'registered'
                ? 'The ownership proof was accepted for this account.'
                : 'This wallet was already verified for this account.'}
            </p>
          </div>
        ) : ambiguousProviders ? (
          <p role="alert">
            Multiple extensions reported the same wallet name, so those choices are disabled.
            Disable unfamiliar extensions, reload this page, and continue only when one expected
            provider remains.
          </p>
        ) : metamask === undefined && coinbase === undefined ? (
          <p role="status">
            No supported wallet was detected. Open the MetaMask or Coinbase Wallet browser
            extension, then reload this page.
          </p>
        ) : metamask === undefined ? (
          <p role="status">MetaMask was not detected. Its button is disabled.</p>
        ) : coinbase === undefined ? (
          <p role="status">Coinbase Wallet was not detected. Its button is disabled.</p>
        ) : null}
      </div>
    </section>
  );
}
