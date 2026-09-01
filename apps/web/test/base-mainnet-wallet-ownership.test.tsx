import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BASE_MAINNET_WALLET_OWNERSHIP_NETWORKS,
  BaseMainnetWalletOwnership,
  createBaseMainnetWalletOwnershipRuntime,
  type BaseMainnetWalletOwnershipRuntime,
} from '../components/wallets/base-mainnet-wallet-ownership';
import { InjectedEvmWalletError } from '../lib/wallets/eip1193/adapter';
import {
  EIP6963_ANNOUNCE_PROVIDER,
  EIP6963_REQUEST_PROVIDER,
  type InjectedProviderDescriptor,
} from '../lib/wallets/eip1193/discovery';
import type {
  EvmWalletOwnershipClient,
  IssuedEvmOwnershipChallenge,
  RegisteredEvmWalletResult,
} from '../lib/wallets/eip1193/ownership';
import { WalletOwnershipHandoffError } from '../lib/wallets/eip1193/ownership';
import type { Eip1193Provider, Eip1193RequestArguments } from '../lib/wallets/eip1193/provider';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const SIGNATURE = `0x${'ab'.repeat(65)}`;
const SERVER_MESSAGE = 'Server-authored Base Mainnet wallet ownership message';

const METAMASK: InjectedProviderDescriptor = Object.freeze({
  selectionId: 'metamask-selection',
  connectorId: 'metamask',
  displayName: 'MetaMask',
  supportedNetworks: BASE_MAINNET_WALLET_OWNERSHIP_NETWORKS,
});

const COINBASE: InjectedProviderDescriptor = Object.freeze({
  selectionId: 'coinbase-selection',
  connectorId: 'coinbase',
  displayName: 'Coinbase Wallet',
  supportedNetworks: BASE_MAINNET_WALLET_OWNERSHIP_NETWORKS,
});

const SECOND_REPORTED_METAMASK: InjectedProviderDescriptor = Object.freeze({
  ...METAMASK,
  selectionId: 'second-reported-metamask-selection',
});

function registrationResult(
  status: RegisteredEvmWalletResult['status'] = 'registered',
): RegisteredEvmWalletResult {
  return {
    status,
    walletId: '33333333-3333-4333-8333-333333333333',
    chainId: 'eip155:8453',
    address: ADDRESS,
    registeredAt: '2026-09-01T12:01:00.000Z',
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: 'ab'.repeat(32),
  };
}

function runtimeHarness(
  overrides: Partial<BaseMainnetWalletOwnershipRuntime> = {},
): BaseMainnetWalletOwnershipRuntime {
  let listener: ((wallets: readonly InjectedProviderDescriptor[]) => void) | undefined;
  const unsubscribe = vi.fn();
  const runtime: BaseMainnetWalletOwnershipRuntime = {
    start: vi.fn(() => listener?.([METAMASK, COINBASE])),
    list: vi.fn(() => [METAMASK, COINBASE]),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      return unsubscribe;
    }),
    verify: vi.fn(async () => registrationResult()),
    dispose: vi.fn(),
  };
  return { ...runtime, ...overrides };
}

function dependencies(runtime: BaseMainnetWalletOwnershipRuntime) {
  return { createRuntime: () => runtime };
}

function issuedChallenge(): IssuedEvmOwnershipChallenge {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    format: 'siwe',
    chainId: 'eip155:8453',
    address: ADDRESS,
    nonce: '0123456789abcdef',
    expiresAt: '2099-09-01T12:05:00.000Z',
    message: SERVER_MESSAGE,
    registryEnvironment: 'MAINNET',
    registryVersion: 1,
    registryFingerprintSha256: 'ab'.repeat(32),
  };
}

function announceMetaMask(target: EventTarget, provider: Eip1193Provider): void {
  target.dispatchEvent(
    new CustomEvent(EIP6963_ANNOUNCE_PROVIDER, {
      detail: {
        info: {
          uuid: '11111111-1111-4111-8111-111111111111',
          name: 'Untrusted provider label',
          icon: 'data:image/svg+xml,<svg/>',
          rdns: 'io.metamask',
        },
        provider,
      },
    }),
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('BaseMainnetWalletOwnership', () => {
  it('uses the exact Base Mainnet catalog and waits for an explicit wallet click', async () => {
    expect(BASE_MAINNET_WALLET_OWNERSHIP_NETWORKS).toEqual([
      {
        chainId: 'eip155:8453',
        providerChainId: '0x2105',
        displayName: 'Base Mainnet',
        environment: 'MAINNET',
      },
    ]);

    const runtime = runtimeHarness();
    const onVerified = vi.fn();
    render(
      <BaseMainnetWalletOwnership
        id="wallets"
        dependencies={dependencies(runtime)}
        onVerified={onVerified}
      />,
    );

    const metamask = await screen.findByRole('button', { name: 'MetaMask' });
    const coinbase = screen.getByRole('button', { name: 'Coinbase Wallet' });
    expect(metamask).toBeEnabled();
    expect(coinbase).toBeEnabled();
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(runtime.verify).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Verify a Base Mainnet wallet' })).toHaveAttribute(
      'id',
      'wallets',
    );
    expect(screen.getByText('Ownership proof only')).toBeVisible();
    expect(screen.getByText(/one server-authored message signature/iu)).toBeVisible();
    expect(screen.getByText(/never switches or adds a wallet network/iu)).toBeVisible();
    expect(screen.getByText(/Nothing happens until you select/iu)).toBeVisible();
    expect(screen.getByText(/Wallet names are self-reported/iu)).toBeVisible();

    fireEvent.click(metamask);

    expect(await screen.findByText('Base Mainnet wallet verified')).toBeVisible();
    expect(runtime.verify).toHaveBeenCalledTimes(1);
    expect(runtime.verify).toHaveBeenCalledWith(METAMASK.selectionId, expect.any(AbortSignal));
    expect(onVerified).toHaveBeenCalledWith(registrationResult());
  });

  it('disables an ambiguous self-reported vendor instead of selecting the first provider', async () => {
    const runtime = runtimeHarness({
      start: vi.fn(),
      list: vi.fn(() => [METAMASK, SECOND_REPORTED_METAMASK, COINBASE]),
      subscribe: vi.fn((listener) => {
        listener([METAMASK, SECOND_REPORTED_METAMASK, COINBASE]);
        return vi.fn();
      }),
    });
    render(<BaseMainnetWalletOwnership dependencies={dependencies(runtime)} />);

    expect(await screen.findByRole('button', { name: 'MetaMask' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Coinbase Wallet' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Multiple extensions reported the same wallet name',
    );
    expect(runtime.verify).not.toHaveBeenCalled();
  });

  it('aborts an in-flight proof when the selected vendor becomes ambiguous', async () => {
    let publish: (wallets: readonly InjectedProviderDescriptor[]) => void = () => undefined;
    let operationSignal: AbortSignal | undefined;
    const verify = vi.fn(
      (_selectionId: string, signal: AbortSignal) =>
        new Promise<RegisteredEvmWalletResult>((_resolve, reject) => {
          operationSignal = signal;
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Request aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const runtime = runtimeHarness({
      start: vi.fn(),
      subscribe: vi.fn((listener) => {
        publish = listener;
        listener([METAMASK, COINBASE]);
        return vi.fn();
      }),
      verify,
    });
    render(<BaseMainnetWalletOwnership dependencies={dependencies(runtime)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'MetaMask' }));
    await waitFor(() => expect(operationSignal).toBeDefined());
    act(() => publish([METAMASK, SECOND_REPORTED_METAMASK, COINBASE]));

    await waitFor(() => expect(operationSignal?.aborted).toBe(true));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The detected wallet list changed before verification finished',
    );
    expect(verify).toHaveBeenCalledOnce();
  });

  it('notifies the parent when challenge issuance proves the account session is gone', async () => {
    const onAuthenticationRequired = vi.fn();
    const runtime = runtimeHarness({
      verify: vi.fn(async () => {
        throw new WalletOwnershipHandoffError('WALLET_OWNERSHIP_AUTHENTICATION_REQUIRED');
      }),
    });
    render(
      <BaseMainnetWalletOwnership
        dependencies={dependencies(runtime)}
        onAuthenticationRequired={onAuthenticationRequired}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'MetaMask' }));

    await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce());
    expect(screen.queryByText(/account session is no longer available/iu)).toBeNull();
    expect(runtime.verify).toHaveBeenCalledTimes(1);
  });

  it('renders the already-verified result distinctly', async () => {
    const runtime = runtimeHarness({
      verify: vi.fn(async () => registrationResult('already_registered')),
    });
    render(<BaseMainnetWalletOwnership dependencies={dependencies(runtime)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Coinbase Wallet' }));

    expect(await screen.findByText('Base Mainnet wallet already verified')).toBeVisible();
    expect(screen.getByText('This wallet was already verified for this account.')).toBeVisible();
  });

  it('shows sanitized retry guidance and never retries automatically', async () => {
    const verify = vi
      .fn<BaseMainnetWalletOwnershipRuntime['verify']>()
      .mockRejectedValueOnce(new Error('raw provider response with secret detail'))
      .mockResolvedValueOnce(registrationResult());
    const runtime = runtimeHarness({ verify });
    render(<BaseMainnetWalletOwnership dependencies={dependencies(runtime)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'MetaMask' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Wallet verification could not finish safely');
    expect(alert).toHaveTextContent('No request is retried automatically');
    expect(alert).not.toHaveTextContent('raw provider response');
    expect(verify).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'MetaMask' }));
    expect(await screen.findByText('Base Mainnet wallet verified')).toBeVisible();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('does not switch an unsupported network and gives an explicit manual retry path', async () => {
    const runtime = runtimeHarness({
      verify: vi.fn(async () => {
        throw new InjectedEvmWalletError('INJECTED_EVM_UNSUPPORTED_NETWORK');
      }),
    });
    render(<BaseMainnetWalletOwnership dependencies={dependencies(runtime)} />);

    fireEvent.click(await screen.findByRole('button', { name: 'MetaMask' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Set the selected wallet to Base Mainnet');
    expect(alert).toHaveTextContent('will not switch or add a network');
    expect(runtime.verify).toHaveBeenCalledTimes(1);
  });

  it('aborts the active attempt, unsubscribes, and disposes provider capabilities on unmount', async () => {
    const unsubscribe = vi.fn();
    let operationSignal: AbortSignal | undefined;
    const verify = vi.fn<BaseMainnetWalletOwnershipRuntime['verify']>(
      (_selectionId, signal) =>
        new Promise((_resolve, reject) => {
          operationSignal = signal;
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Request aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const runtime = runtimeHarness({
      subscribe: vi.fn((listener) => {
        listener([METAMASK, COINBASE]);
        return unsubscribe;
      }),
      verify,
    });
    const view = render(<BaseMainnetWalletOwnership dependencies={dependencies(runtime)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'MetaMask' }));
    await waitFor(() => expect(verify).toHaveBeenCalledOnce());

    view.unmount();

    expect(operationSignal?.aborted).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});

describe('createBaseMainnetWalletOwnershipRuntime', () => {
  it('uses only injected connection checks and one server-authored ownership signature', async () => {
    const target = new EventTarget();
    const requests: Eip1193RequestArguments[] = [];
    const provider: Eip1193Provider = {
      request: vi.fn(async (request) => {
        requests.push(request);
        switch (request.method) {
          case 'eth_chainId':
            return '0x2105';
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [ADDRESS];
          case 'personal_sign':
            return SIGNATURE;
          default:
            throw new Error('Unexpected provider method');
        }
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    target.addEventListener(EIP6963_REQUEST_PROVIDER, () => announceMetaMask(target, provider));
    const challenge = issuedChallenge();
    const expectedResult = registrationResult();
    const client: EvmWalletOwnershipClient = {
      issueChallenge: vi.fn(async () => challenge),
      submitProof: vi.fn(async () => expectedResult),
    };
    const runtime = createBaseMainnetWalletOwnershipRuntime({
      target,
      client,
      createSelectionId: () => METAMASK.selectionId,
      createConnectionId: () => 'base-mainnet-connection',
    });

    runtime.start();
    expect(runtime.list()).toEqual([
      expect.objectContaining({
        selectionId: METAMASK.selectionId,
        connectorId: 'metamask',
        displayName: 'MetaMask',
        supportedNetworks: BASE_MAINNET_WALLET_OWNERSHIP_NETWORKS,
      }),
    ]);
    expect('provider' in runtime.list()[0]!).toBe(false);

    await expect(
      runtime.verify(METAMASK.selectionId, new AbortController().signal),
    ).resolves.toEqual(expectedResult);

    expect(client.issueChallenge).toHaveBeenCalledWith(
      {
        chainId: 'eip155:8453',
        address: ADDRESS,
        registryEnvironment: 'MAINNET',
      },
      expect.any(AbortSignal),
    );
    expect(client.submitProof).toHaveBeenCalledOnce();
    const methods = requests.map(({ method }) => method);
    expect(methods.filter((method) => method === 'eth_requestAccounts')).toEqual([
      'eth_requestAccounts',
    ]);
    expect(methods.filter((method) => method === 'personal_sign')).toEqual(['personal_sign']);
    expect(new Set(methods)).toEqual(
      new Set(['eth_chainId', 'eth_requestAccounts', 'eth_accounts', 'personal_sign']),
    );
    expect(
      methods.some((method) =>
        [
          'wallet_switchEthereumChain',
          'wallet_addEthereumChain',
          'eth_call',
          'eth_getBalance',
          'eth_signTransaction',
          'eth_sendTransaction',
          'eth_sendRawTransaction',
        ].includes(method),
      ),
    ).toBe(false);
    expect(requests.find(({ method }) => method === 'personal_sign')?.params).toEqual([
      SERVER_MESSAGE,
      ADDRESS,
    ]);
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(provider.removeListener).toHaveBeenCalledTimes(3);

    runtime.dispose();
    expect(runtime.list()).toEqual([]);
  });
});
