import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAINNET_WALLET_NETWORKS,
  MainnetWalletOwnership,
  MainnetWalletRuntimeError,
  createMainnetWalletOwnershipRuntime,
  type MainnetWalletConnectionChoice,
  type MainnetWalletOwnershipRuntime,
  type MainnetWalletVerificationResult,
} from '@/components/wallets/mainnet-wallet-ownership';
import { SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS } from '@/lib/browser/use-sensitive-view-revalidation';
import {
  EIP6963_ANNOUNCE_PROVIDER,
  EIP6963_REQUEST_PROVIDER,
  type InjectedProviderDescriptor,
} from '@/lib/wallets/eip1193/discovery';
import {
  WalletOwnershipHandoffError,
  type EvmWalletOwnershipClient,
} from '@/lib/wallets/eip1193/ownership';
import type { Eip1193Provider, Eip1193RequestArguments } from '@/lib/wallets/eip1193/provider';
import {
  MainnetWalletRosterError,
  type MainnetRegisteredWalletSummary,
  type MainnetWalletRosterClient,
} from '@/lib/wallets/mainnet-wallet-roster-client';

const METAMASK: InjectedProviderDescriptor = Object.freeze({
  selectionId: 'metamask-selection',
  connectorId: 'metamask',
  displayName: 'MetaMask',
  supportedNetworks: MAINNET_WALLET_NETWORKS.filter(
    (network) => network.namespace === 'eip155',
  ).map((network) => ({
    chainId: network.chainId,
    providerChainId: network.providerChainId,
    displayName: `${network.displayName} Mainnet`,
    environment: network.environment,
  })),
});

const EVM_CONNECTION: MainnetWalletConnectionChoice = Object.freeze({
  connectionToken: 'connection-token',
  connectorId: 'metamask',
  displayName: 'MetaMask',
  chainId: 'eip155:1',
  accounts: Object.freeze([
    Object.freeze({ accountToken: 'account-one', addressHint: '0x1111…1111' }),
    Object.freeze({ accountToken: 'account-two', addressHint: '0x2222…2222' }),
  ]),
});

const RESULT: MainnetWalletVerificationResult = Object.freeze({
  status: 'registered',
  walletId: '33333333-3333-4333-8333-333333333333',
  chainId: 'eip155:1',
  addressHint: '0x2222…2222',
});

const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const ETHEREUM_WALLET: MainnetRegisteredWalletSummary = Object.freeze({
  walletId: '11111111-1111-4111-8111-111111111111',
  chainId: 'eip155:1',
  addressHint: '0x111111…111111',
  registeredAt: '2026-09-02T12:00:00.000Z',
});
const SOLANA_WALLET: MainnetRegisteredWalletSummary = Object.freeze({
  walletId: '22222222-2222-4222-8222-222222222222',
  chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  addressHint: '111111…111112',
  registeredAt: '2026-09-01T12:00:00.000Z',
});

function announceMetaMask(target: EventTarget, provider: Eip1193Provider): void {
  target.dispatchEvent(
    new CustomEvent(EIP6963_ANNOUNCE_PROVIDER, {
      detail: {
        info: {
          uuid: '11111111-1111-4111-8111-111111111111',
          name: 'Untrusted wallet label',
          icon: 'data:image/svg+xml,<svg/>',
          rdns: 'io.metamask',
        },
        provider,
      },
    }),
  );
}

function runtimeHarness(
  overrides: Partial<MainnetWalletOwnershipRuntime> = {},
): MainnetWalletOwnershipRuntime {
  let listener: ((wallets: readonly InjectedProviderDescriptor[]) => void) | undefined;
  return {
    start: vi.fn(() => listener?.([METAMASK])),
    listEvmWallets: vi.fn(() => [METAMASK]),
    subscribeEvmWallets: vi.fn((next) => {
      listener = next;
      return vi.fn();
    }),
    hasPhantom: vi.fn(() => true),
    connect: vi.fn(async () => EVM_CONNECTION),
    verify: vi.fn(async () => RESULT),
    cancel: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

function dependencies(
  runtime: MainnetWalletOwnershipRuntime,
  roster: MainnetWalletRosterClient = {
    readWallets: vi.fn(async () => ({ version: 1 as const, wallets: [] })),
    removeWallet: vi.fn(async () => undefined),
  },
) {
  return {
    createRuntime: () => runtime,
    createRosterClient: () => roster,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('MainnetWalletOwnership', () => {
  it('uses simple network, wallet, and explicit account buttons before requesting a proof', async () => {
    const runtime = runtimeHarness();
    const onVerified = vi.fn();
    const onWalletsChanged = vi.fn();
    render(
      <MainnetWalletOwnership
        id="wallets"
        dependencies={dependencies(runtime)}
        onVerified={onVerified}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    expect(screen.getByRole('region', { name: 'Add a wallet' })).toHaveAttribute('id', 'wallets');
    expect(screen.getByRole('button', { name: 'Ethereum' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Base' })).toBeNull();
    expect(MAINNET_WALLET_NETWORKS.map(({ chainId }) => chainId)).toEqual([
      'eip155:1',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    ]);
    expect(screen.getByText('No transaction or network switching')).toBeVisible();
    expect(runtime.connect).not.toHaveBeenCalled();
    expect(runtime.verify).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'MetaMask' }));
    expect(await screen.findByRole('button', { name: 'Verify 0x2222…2222' })).toBeVisible();
    expect(runtime.connect).toHaveBeenCalledWith(
      'eip155:1',
      'metamask',
      METAMASK.selectionId,
      expect.any(AbortSignal),
    );
    expect(runtime.verify).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Verify 0x2222…2222' }));
    const verified = await screen.findByText('Ethereum account verified');
    expect(verified).toBeVisible();
    await waitFor(() => expect(verified.closest('[role="status"]')).toHaveFocus());
    expect(runtime.verify).toHaveBeenCalledWith(
      EVM_CONNECTION.connectionToken,
      'account-two',
      expect.any(AbortSignal),
    );
    expect(onVerified).toHaveBeenCalledWith(RESULT);
    expect(onWalletsChanged).toHaveBeenCalledOnce();

    act(() => window.dispatchEvent(new Event('focus')));
    expect(screen.queryByText('Ethereum account verified')).toBeNull();
    expect(screen.getByText(/Loading verified wallets/u)).toBeVisible();
  });

  it('keeps Ethereum and Solana as separate chain-bound connection choices', async () => {
    const solanaConnection: MainnetWalletConnectionChoice = {
      connectionToken: 'solana-connection',
      connectorId: 'phantom',
      displayName: 'Phantom',
      chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      accounts: [{ accountToken: 'solana-account', addressHint: '1111…1112' }],
    };
    const connect = vi
      .fn<MainnetWalletOwnershipRuntime['connect']>()
      .mockResolvedValueOnce(EVM_CONNECTION)
      .mockResolvedValueOnce(solanaConnection);
    const runtime = runtimeHarness({ connect });
    render(<MainnetWalletOwnership dependencies={dependencies(runtime)} />);

    await screen.findByText('No wallets are verified for this account yet.');
    expect(screen.getByRole('button', { name: 'Ethereum' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(runtime.cancel).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'MetaMask' }));
    await screen.findByRole('button', { name: 'Verify 0x1111…1111' });
    expect(connect).toHaveBeenNthCalledWith(
      1,
      'eip155:1',
      'metamask',
      METAMASK.selectionId,
      expect.any(AbortSignal),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Solana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Phantom' }));
    expect(await screen.findByRole('button', { name: 'Verify 1111…1112' })).toBeVisible();
    expect(connect).toHaveBeenNthCalledWith(
      2,
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      'phantom',
      null,
      expect.any(AbortSignal),
    );
  });

  it('announces account selection and restores focus when choosing another wallet', async () => {
    const runtime = runtimeHarness();
    render(<MainnetWalletOwnership dependencies={dependencies(runtime)} />);

    const metamask = await screen.findByRole('button', { name: 'MetaMask' });
    fireEvent.click(metamask);

    const firstAccount = await screen.findByRole('button', {
      name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
    });
    await waitFor(() => expect(firstAccount).toHaveFocus());
    expect(screen.getByText('MetaMask connected. Choose an account to verify.')).toHaveAttribute(
      'aria-live',
      'polite',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose another wallet' }));

    expect(runtime.cancel).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', {
        name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
      }),
    ).toBeNull();
    expect(screen.getByText('Wallet choice cleared. Choose a wallet on Ethereum.')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    await waitFor(() => expect(metamask).toHaveFocus());
    expect(metamask).toBeEnabled();
  });

  it('cancels a pending connection, restores focus, and ignores its late result', async () => {
    const pendingConnection = Promise.withResolvers<MainnetWalletConnectionChoice>();
    let operationSignal: AbortSignal | undefined;
    const runtime = runtimeHarness({
      connect: vi.fn((_chainId, _connectorId, _selectionId, signal) => {
        operationSignal = signal;
        return pendingConnection.promise;
      }),
    });
    render(<MainnetWalletOwnership dependencies={dependencies(runtime)} />);

    const metamask = await screen.findByRole('button', { name: 'MetaMask' });
    fireEvent.click(metamask);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel wallet request' }));

    expect(operationSignal?.aborted).toBe(true);
    expect(runtime.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Follow the wallet prompt/u)).toBeNull();
    expect(
      screen.getByText('Wallet request cancelled. Choose a wallet on Ethereum.'),
    ).toHaveAttribute('aria-live', 'polite');
    await waitFor(() => expect(metamask).toHaveFocus());

    await act(async () => {
      pendingConnection.resolve(EVM_CONNECTION);
      await Promise.resolve();
    });

    expect(
      screen.queryByRole('button', {
        name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
      }),
    ).toBeNull();
    expect(screen.queryByText('MetaMask connected. Choose an account to verify.')).toBeNull();
    expect(
      screen.getByText('Wallet request cancelled. Choose a wallet on Ethereum.'),
    ).toBeInTheDocument();
    expect(metamask).toHaveFocus();
  });

  it('cancels a pending proof when changing wallets and suppresses its late success', async () => {
    const pendingVerification = Promise.withResolvers<MainnetWalletVerificationResult>();
    let operationSignal: AbortSignal | undefined;
    const verify = vi.fn<MainnetWalletOwnershipRuntime['verify']>(
      (_connectionToken, _accountToken, signal) => {
        operationSignal = signal;
        return pendingVerification.promise;
      },
    );
    const runtime = runtimeHarness({ verify });
    const onVerified = vi.fn();
    const onWalletsChanged = vi.fn();
    render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtime)}
        onVerified={onVerified}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    const metamask = await screen.findByRole('button', { name: 'MetaMask' });
    fireEvent.click(metamask);
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose another wallet' }));

    expect(operationSignal?.aborted).toBe(true);
    expect(runtime.cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(metamask).toHaveFocus());

    await act(async () => {
      pendingVerification.resolve(RESULT);
      await Promise.resolve();
    });

    expect(screen.queryByText('Ethereum account verified')).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
      }),
    ).toBeNull();
    expect(onVerified).not.toHaveBeenCalled();
    expect(onWalletsChanged).not.toHaveBeenCalled();
    expect(
      screen.getByText('Wallet choice cleared. Choose a wallet on Ethereum.'),
    ).toBeInTheDocument();
    expect(metamask).toHaveFocus();
  });

  it('cancels a hidden pending connection and requires a new explicit connection after resume', async () => {
    const pendingConnection = Promise.withResolvers<MainnetWalletConnectionChoice>();
    let operationSignal: AbortSignal | undefined;
    const connect = vi
      .fn<MainnetWalletOwnershipRuntime['connect']>()
      .mockImplementationOnce((_chainId, _connectorId, _selectionId, signal) => {
        operationSignal = signal;
        return pendingConnection.promise;
      })
      .mockResolvedValueOnce(EVM_CONNECTION);
    const runtime = runtimeHarness({ connect });
    render(<MainnetWalletOwnership dependencies={dependencies(runtime)} />);

    await screen.findByText('No wallets are verified for this account yet.');
    fireEvent.click(screen.getByRole('button', { name: 'MetaMask' }));
    expect(await screen.findByText(/Follow the wallet prompt/u)).toBeVisible();
    expect(operationSignal).toBeDefined();
    vi.useFakeTimers();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(operationSignal?.aborted).toBe(true);
    expect(runtime.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Follow the wallet prompt/u)).toBeNull();
    expect(screen.queryByText('MetaMask connected. Choose an account to verify.')).toBeNull();

    await act(async () => {
      pendingConnection.resolve(EVM_CONNECTION);
      await Promise.resolve();
    });

    expect(connect).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', {
        name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
      }),
    ).toBeNull();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });

    expect(connect).toHaveBeenCalledOnce();
    const metamask = screen.getByRole('button', { name: 'MetaMask' });
    expect(metamask).toBeEnabled();
    await act(async () => {
      fireEvent.click(metamask);
      await Promise.resolve();
    });
    expect(
      screen.getByRole('button', {
        name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
      }),
    ).toBeVisible();
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending proof on pagehide and never restores its late success after resume', async () => {
    const pendingVerification = Promise.withResolvers<MainnetWalletVerificationResult>();
    let operationSignal: AbortSignal | undefined;
    const verify = vi
      .fn<MainnetWalletOwnershipRuntime['verify']>()
      .mockImplementationOnce((_connectionToken, _accountToken, signal) => {
        operationSignal = signal;
        return pendingVerification.promise;
      })
      .mockResolvedValueOnce(RESULT);
    const runtime = runtimeHarness({ verify });
    const onVerified = vi.fn();
    const onWalletsChanged = vi.fn();
    render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtime)}
        onVerified={onVerified}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    await screen.findByText('No wallets are verified for this account yet.');
    fireEvent.click(screen.getByRole('button', { name: 'MetaMask' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
      }),
    );
    expect(operationSignal).toBeDefined();
    vi.useFakeTimers();

    act(() => window.dispatchEvent(new Event('pagehide')));

    expect(operationSignal?.aborted).toBe(true);
    expect(runtime.cancel).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', {
        name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
      }),
    ).toBeNull();

    await act(async () => {
      pendingVerification.resolve(RESULT);
      await Promise.resolve();
    });

    expect(screen.queryByText('Ethereum account verified')).toBeNull();
    expect(onVerified).not.toHaveBeenCalled();
    expect(onWalletsChanged).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });

    expect(verify).toHaveBeenCalledOnce();
    expect(screen.queryByText('Ethereum account verified')).toBeNull();
    const metamask = screen.getByRole('button', { name: 'MetaMask' });
    expect(metamask).toBeEnabled();
    await act(async () => {
      fireEvent.click(metamask);
      await Promise.resolve();
    });
    const verifyAgain = screen.getByRole('button', {
      name: `Verify ${EVM_CONNECTION.accounts[0]!.addressHint}`,
    });
    await act(async () => {
      fireEvent.click(verifyAgain);
      await Promise.resolve();
    });

    expect(screen.getByText('Ethereum account verified')).toBeVisible();
    expect(verify).toHaveBeenCalledTimes(2);
    expect(onVerified).toHaveBeenCalledOnce();
    expect(onWalletsChanged).toHaveBeenCalledOnce();
  });

  it('does not switch the wallet and gives manual network guidance', async () => {
    const runtime = runtimeHarness({
      connect: vi.fn(async () => {
        throw new MainnetWalletRuntimeError('WRONG_NETWORK');
      }),
    });
    render(<MainnetWalletOwnership dependencies={dependencies(runtime)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'MetaMask' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Set the selected wallet to Ethereum Mainnet',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('will not switch or add a network');
  });

  it('hands an expired account session back to the portfolio without exposing an error', async () => {
    const onAuthenticationRequired = vi.fn();
    const runtime = runtimeHarness({
      verify: vi.fn(async () => {
        throw new WalletOwnershipHandoffError('WALLET_OWNERSHIP_AUTHENTICATION_REQUIRED');
      }),
    });
    render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtime)}
        onAuthenticationRequired={onAuthenticationRequired}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'MetaMask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Verify 0x1111…1111' }));

    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not request the wallet roster when the ownership screen mounts hidden', async () => {
    const readWallets = vi.fn(async () => ({ version: 1 as const, wallets: [] }));
    const roster: MainnetWalletRosterClient = {
      readWallets,
      removeWallet: vi.fn(async () => undefined),
    };
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    vi.useFakeTimers();

    render(<MainnetWalletOwnership dependencies={dependencies(runtimeHarness(), roster)} />);

    expect(readWallets).not.toHaveBeenCalled();
    expect(screen.getByText(/Loading verified wallets/u)).toBeVisible();
    act(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('pageshow'));
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
    });
    expect(readWallets).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });

    expect(readWallets).toHaveBeenCalledOnce();
    expect(screen.getByText('No wallets are verified for this account yet.')).toBeVisible();
  });

  it('hides and revalidates the wallet roster while suppressing a superseded late read', async () => {
    const superseded = Promise.withResolvers<{
      readonly version: 1;
      readonly wallets: readonly MainnetRegisteredWalletSummary[];
    }>();
    const current = Promise.withResolvers<{
      readonly version: 1;
      readonly wallets: readonly MainnetRegisteredWalletSummary[];
    }>();
    const signals: AbortSignal[] = [];
    const readWallets = vi.fn<MainnetWalletRosterClient['readWallets']>((signal) => {
      if (signal !== undefined) signals.push(signal);
      if (signals.length === 1) {
        return Promise.resolve({ version: 1, wallets: [ETHEREUM_WALLET] });
      }
      if (signals.length === 2) return superseded.promise;
      return current.promise;
    });
    const roster: MainnetWalletRosterClient = {
      readWallets,
      removeWallet: vi.fn(async () => undefined),
    };
    render(<MainnetWalletOwnership dependencies={dependencies(runtimeHarness(), roster)} />);
    expect(await screen.findByText(ETHEREUM_WALLET.addressHint)).toBeVisible();
    vi.useFakeTimers();

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(readWallets).toHaveBeenCalledOnce();
    expect(screen.queryByText(ETHEREUM_WALLET.addressHint)).toBeNull();
    expect(screen.getByText(/Loading verified wallets/u)).toBeVisible();
    expect(screen.getByRole('button', { name: 'MetaMask' })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });
    expect(readWallets).toHaveBeenCalledTimes(2);

    act(() => window.dispatchEvent(new Event('focus')));
    expect(signals[1]?.aborted).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });
    expect(readWallets).toHaveBeenCalledTimes(3);

    await act(async () => {
      superseded.resolve({ version: 1, wallets: [SOLANA_WALLET] });
      await Promise.resolve();
    });
    expect(screen.queryByText(SOLANA_WALLET.addressHint)).toBeNull();
    expect(screen.getByText(/Loading verified wallets/u)).toBeVisible();

    await act(async () => {
      current.resolve({ version: 1, wallets: [ETHEREUM_WALLET] });
      await Promise.resolve();
    });
    expect(screen.getByText(ETHEREUM_WALLET.addressHint)).toBeVisible();
  });

  it('requires explicit confirmation and explains the narrow effect of removing a wallet', async () => {
    const removeWallet = vi.fn<MainnetWalletRosterClient['removeWallet']>();
    const roster: MainnetWalletRosterClient = {
      readWallets: vi.fn(async () => ({
        version: 1 as const,
        wallets: [ETHEREUM_WALLET, SOLANA_WALLET],
      })),
      removeWallet,
    };
    render(<MainnetWalletOwnership dependencies={dependencies(runtimeHarness(), roster)} />);

    const removeEthereum = await screen.findByRole('button', {
      name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
    });
    fireEvent.click(removeEthereum);

    const confirmation = screen.getByRole('group', { name: 'Remove this wallet?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep wallet' })).toHaveFocus());
    expect(confirmation).toHaveTextContent('stops Crypto Lending from showing or monitoring');
    expect(confirmation).toHaveTextContent('does not disconnect your wallet extension');
    expect(confirmation).toHaveTextContent('revoke onchain approvals');
    expect(confirmation).toHaveTextContent('move funds');
    expect(confirmation).toHaveTextContent('requires a new ownership signature');
    expect(confirmation).toHaveTextContent('An encrypted security record is retained');
    expect(removeWallet).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Solana' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Keep wallet' }));
    expect(screen.queryByRole('group', { name: 'Remove this wallet?' })).toBeNull();
    expect(removeWallet).not.toHaveBeenCalled();
    await waitFor(() => expect(removeEthereum).toHaveFocus());
  });

  it('prevents duplicate removal, confirms only after 204, and refreshes the roster', async () => {
    let finishRemoval: () => void = () => undefined;
    const removal = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    const removeWallet = vi.fn<MainnetWalletRosterClient['removeWallet']>(() => removal);
    const readWallets = vi
      .fn<MainnetWalletRosterClient['readWallets']>()
      .mockResolvedValueOnce({ version: 1, wallets: [ETHEREUM_WALLET] })
      .mockResolvedValueOnce({ version: 1, wallets: [] });
    const roster: MainnetWalletRosterClient = { readWallets, removeWallet };
    const onWalletsChanged = vi.fn();
    render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtimeHarness(), roster)}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
      }),
    );
    const confirm = screen.getByRole('button', { name: 'Yes, remove wallet' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    const removing = await screen.findByRole('button', { name: /Removing wallet/u });
    expect(removing).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Remove this wallet?' })).toHaveAttribute(
      'aria-describedby',
      `remove-wallet-${ETHEREUM_WALLET.walletId}`,
    );
    expect(removeWallet).toHaveBeenCalledOnce();
    expect(removeWallet).toHaveBeenCalledWith(ETHEREUM_WALLET.walletId, expect.any(AbortSignal));
    expect(readWallets).toHaveBeenCalledOnce();

    finishRemoval();
    expect(await screen.findByText('No wallets are verified for this account yet.')).toBeVisible();
    expect(readWallets).toHaveBeenCalledTimes(2);
    expect(onWalletsChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ethereum wallet removed. Portfolio monitoring for that address has stopped.',
    );
    expect(screen.getByRole('heading', { name: 'Verified wallets' })).toHaveFocus();
  });

  it('preserves the roster and offers a safe retry after a removal failure', async () => {
    const removeWallet = vi
      .fn<MainnetWalletRosterClient['removeWallet']>()
      .mockRejectedValueOnce(new MainnetWalletRosterError('UNAVAILABLE', 2))
      .mockResolvedValueOnce(undefined);
    const readWallets = vi
      .fn<MainnetWalletRosterClient['readWallets']>()
      .mockResolvedValueOnce({ version: 1, wallets: [ETHEREUM_WALLET] })
      .mockResolvedValueOnce({ version: 1, wallets: [ETHEREUM_WALLET] })
      .mockResolvedValueOnce({ version: 1, wallets: [] });
    const roster: MainnetWalletRosterClient = { readWallets, removeWallet };
    const onWalletsChanged = vi.fn();
    render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtimeHarness(), roster)}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove wallet' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "We couldn't confirm the removal result. The wallet list is refreshing; check it before trying again.",
    );
    expect(alert).not.toHaveTextContent(ETHEREUM_WALLET.walletId);
    expect(alert).not.toHaveTextContent(ETHEREUM_WALLET.addressHint);
    expect(screen.queryByRole('group', { name: 'Remove this wallet?' })).toBeNull();
    await waitFor(() => expect(readWallets).toHaveBeenCalledTimes(2));
    expect(onWalletsChanged).toHaveBeenCalledOnce();
    expect(screen.getByText(ETHEREUM_WALLET.addressHint)).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', {
        name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove wallet' }));
    expect(await screen.findByText('No wallets are verified for this account yet.')).toBeVisible();
    expect(removeWallet).toHaveBeenCalledTimes(2);
    expect(readWallets).toHaveBeenCalledTimes(3);
    expect(onWalletsChanged).toHaveBeenCalledTimes(2);
  });

  it('lets the user stop waiting on a stalled removal and reconciles both views', async () => {
    let operationSignal: AbortSignal | undefined;
    const readWallets = vi
      .fn<MainnetWalletRosterClient['readWallets']>()
      .mockResolvedValue({ version: 1, wallets: [ETHEREUM_WALLET] });
    const roster: MainnetWalletRosterClient = {
      readWallets,
      removeWallet: vi.fn((_walletId, signal) => {
        operationSignal = signal;
        return new Promise<void>(() => undefined);
      }),
    };
    const onWalletsChanged = vi.fn();
    render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtimeHarness(), roster)}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove wallet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop waiting and refresh' }));

    expect(operationSignal?.aborted).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't confirm the removal result.",
    );
    await waitFor(() => expect(readWallets).toHaveBeenCalledTimes(2));
    expect(onWalletsChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Verified wallets' })).toHaveFocus();
  });

  it('suppresses a late removal success after pagehide and reconciles from the visible roster', async () => {
    const pendingRemoval = Promise.withResolvers<void>();
    let operationSignal: AbortSignal | undefined;
    const removeWallet = vi.fn<MainnetWalletRosterClient['removeWallet']>((_walletId, signal) => {
      operationSignal = signal;
      return pendingRemoval.promise;
    });
    const readWallets = vi
      .fn<MainnetWalletRosterClient['readWallets']>()
      .mockResolvedValueOnce({ version: 1, wallets: [ETHEREUM_WALLET] })
      .mockResolvedValueOnce({ version: 1, wallets: [] });
    const onWalletsChanged = vi.fn();
    render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtimeHarness(), { readWallets, removeWallet })}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove wallet' }));
    await waitFor(() => expect(operationSignal).toBeDefined());
    vi.useFakeTimers();

    act(() => window.dispatchEvent(new Event('pagehide')));

    expect(operationSignal?.aborted).toBe(true);
    expect(screen.queryByRole('group', { name: 'Remove this wallet?' })).toBeNull();
    expect(screen.getByText(/Loading verified wallets/u)).toBeVisible();

    await act(async () => {
      pendingRemoval.resolve();
      await Promise.resolve();
    });

    expect(onWalletsChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(/wallet removed/u)).toBeNull();
    expect(readWallets).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });

    expect(screen.getByText('No wallets are verified for this account yet.')).toBeVisible();
    expect(readWallets).toHaveBeenCalledTimes(2);
    expect(removeWallet).toHaveBeenCalledOnce();
    expect(onWalletsChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(/wallet removed/u)).toBeNull();
  });

  it('suppresses a late removal failure while hidden and restores the authoritative wallet roster', async () => {
    const pendingRemoval = Promise.withResolvers<void>();
    let operationSignal: AbortSignal | undefined;
    const removeWallet = vi.fn<MainnetWalletRosterClient['removeWallet']>((_walletId, signal) => {
      operationSignal = signal;
      return pendingRemoval.promise;
    });
    const readWallets = vi
      .fn<MainnetWalletRosterClient['readWallets']>()
      .mockResolvedValueOnce({ version: 1, wallets: [ETHEREUM_WALLET] })
      .mockResolvedValueOnce({ version: 1, wallets: [ETHEREUM_WALLET] });
    const onWalletsChanged = vi.fn();
    render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtimeHarness(), { readWallets, removeWallet })}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove wallet' }));
    await waitFor(() => expect(operationSignal).toBeDefined());
    vi.useFakeTimers();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(operationSignal?.aborted).toBe(true);
    expect(screen.queryByRole('group', { name: 'Remove this wallet?' })).toBeNull();

    await act(async () => {
      pendingRemoval.reject(new MainnetWalletRosterError('UNAVAILABLE'));
      await Promise.resolve();
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(onWalletsChanged).not.toHaveBeenCalled();
    expect(readWallets).toHaveBeenCalledOnce();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });

    expect(screen.getByText(ETHEREUM_WALLET.addressHint)).toBeVisible();
    expect(readWallets).toHaveBeenCalledTimes(2);
    expect(removeWallet).toHaveBeenCalledOnce();
    expect(onWalletsChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('recovers if a refreshed roster no longer contains the confirmation target', async () => {
    const initialRoster: MainnetWalletRosterClient = {
      readWallets: vi.fn(async () => ({ version: 1 as const, wallets: [ETHEREUM_WALLET] })),
      removeWallet: vi.fn(async () => undefined),
    };
    const refreshedRoster: MainnetWalletRosterClient = {
      readWallets: vi.fn(async () => ({ version: 1 as const, wallets: [] })),
      removeWallet: vi.fn(async () => undefined),
    };
    const onWalletsChanged = vi.fn();
    const view = render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtimeHarness(), initialRoster)}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
      }),
    );
    expect(screen.getByRole('group', { name: 'Remove this wallet?' })).toBeVisible();

    view.rerender(
      <MainnetWalletOwnership
        dependencies={dependencies(runtimeHarness(), refreshedRoster)}
        onWalletsChanged={onWalletsChanged}
      />,
    );

    expect(await screen.findByText('No wallets are verified for this account yet.')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Remove this wallet?' })).toBeNull();
    expect(
      await screen.findByText('The wallet is no longer active on this account.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ethereum' })).toBeEnabled();
    expect(onWalletsChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Verified wallets' })).toHaveFocus();
  });

  it('hands an expired removal session back without exposing an error', async () => {
    const onAuthenticationRequired = vi.fn();
    const roster: MainnetWalletRosterClient = {
      readWallets: vi.fn(async () => ({ version: 1 as const, wallets: [ETHEREUM_WALLET] })),
      removeWallet: vi.fn(async () => {
        throw new MainnetWalletRosterError('UNAUTHENTICATED');
      }),
    };
    render(
      <MainnetWalletOwnership
        dependencies={dependencies(runtimeHarness(), roster)}
        onAuthenticationRequired={onAuthenticationRequired}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove wallet' }));

    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aborts an in-flight removal when the wallet screen unmounts', async () => {
    let operationSignal: AbortSignal | undefined;
    const roster: MainnetWalletRosterClient = {
      readWallets: vi.fn(async () => ({ version: 1 as const, wallets: [ETHEREUM_WALLET] })),
      removeWallet: vi.fn((_walletId, signal) => {
        operationSignal = signal;
        return new Promise<void>(() => undefined);
      }),
    };
    const view = render(
      <MainnetWalletOwnership dependencies={dependencies(runtimeHarness(), roster)} />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Remove Ethereum wallet ${ETHEREUM_WALLET.addressHint}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove wallet' }));
    await waitFor(() => expect(operationSignal).toBeDefined());

    view.unmount();
    expect(operationSignal?.aborted).toBe(true);
  });
});

describe('createMainnetWalletOwnershipRuntime', () => {
  it('serializes connect and verify operations and invalidates an aborted generation', async () => {
    const target = new EventTarget();
    let releaseInitialChainRead: () => void = () => undefined;
    const initialChainRead = new Promise<void>((resolve) => {
      releaseInitialChainRead = resolve;
    });
    let gateInitialChainRead = true;
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: Eip1193RequestArguments) => {
        if (method === 'eth_chainId') {
          if (gateInitialChainRead) {
            gateInitialChainRead = false;
            await initialChainRead;
          }
          return '0x1';
        }
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [EVM_ADDRESS];
        throw new Error('Unexpected provider method');
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    target.addEventListener(EIP6963_REQUEST_PROVIDER, () => announceMetaMask(target, provider));
    const issueChallenge = vi.fn<EvmWalletOwnershipClient['issueChallenge']>(
      (_input, signal) =>
        new Promise<never>((_resolve, reject) => {
          if (signal === undefined) {
            reject(new Error('Expected an operation signal'));
            return;
          }
          if (signal.aborted) {
            reject(new DOMException('Request aborted', 'AbortError'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Request aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const client: EvmWalletOwnershipClient = {
      issueChallenge,
      submitProof: vi.fn(async () => {
        throw new Error('Proof submission should not run');
      }),
    };
    let opaqueTokenIndex = 0;
    const runtime = createMainnetWalletOwnershipRuntime({
      target,
      evmClient: client,
      createSelectionId: () => METAMASK.selectionId,
      createConnectionId: () => 'mainnet-connection',
      createOpaqueToken: () => `opaque-${++opaqueTokenIndex}`,
    });
    runtime.start();

    const firstConnect = runtime.connect(
      'eip155:1',
      'metamask',
      METAMASK.selectionId,
      new AbortController().signal,
    );
    await expect(
      runtime.connect('eip155:1', 'metamask', METAMASK.selectionId, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'OPERATION_PENDING' });

    releaseInitialChainRead();
    const connection = await firstConnect;
    const account = connection.accounts[0]!;
    const firstVerify = runtime.verify(
      connection.connectionToken,
      account.accountToken,
      new AbortController().signal,
    );
    expect(issueChallenge).toHaveBeenCalledOnce();
    await expect(
      runtime.verify(
        connection.connectionToken,
        account.accountToken,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_PENDING' });

    runtime.cancel();
    await expect(firstVerify).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      runtime.verify(
        connection.connectionToken,
        account.accountToken,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONNECTION_CHANGED' });
    expect(provider.removeListener).toHaveBeenCalledTimes(3);
    runtime.dispose();
  });
});
