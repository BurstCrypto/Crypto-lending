import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import type { MainnetWalletRosterReader } from '@/lib/wallets/mainnet-wallet-roster-client';

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
  roster: MainnetWalletRosterReader = {
    readWallets: vi.fn(async () => ({ version: 1 as const, wallets: [] })),
  },
) {
  return {
    createRuntime: () => runtime,
    createRosterClient: () => roster,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MainnetWalletOwnership', () => {
  it('uses simple network, wallet, and explicit account buttons before requesting a proof', async () => {
    const runtime = runtimeHarness();
    const onVerified = vi.fn();
    render(
      <MainnetWalletOwnership
        id="wallets"
        dependencies={dependencies(runtime)}
        onVerified={onVerified}
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
    expect(await screen.findByText('Ethereum account verified')).toBeVisible();
    expect(runtime.verify).toHaveBeenCalledWith(
      EVM_CONNECTION.connectionToken,
      'account-two',
      expect.any(AbortSignal),
    );
    expect(onVerified).toHaveBeenCalledWith(RESULT);
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
