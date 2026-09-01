import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_ATOKEN,
  EVM_PUBLIC_TESTNET_EXPLORER_ORIGIN,
  EVM_PUBLIC_TESTNET_GATEWAY,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_RPC_URL,
  EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
} from '../lib/evm-public-testnet/constants';
import {
  evmPublicTestnetWithdrawalInput,
  type EvmPublicTestnetWithdrawalStep,
} from '../lib/evm-public-testnet/withdrawal';
import { EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY } from '../lib/evm-public-testnet/withdrawal-recovery-journal';
import type { SelectedEip1193Provider } from '../lib/wallets/eip1193/discovery';
import type {
  Eip1193Listener,
  Eip1193Provider,
  Eip1193RequestArguments,
} from '../lib/wallets/eip1193/provider';
import {
  createEvmPublicTestnetWalletExecutor,
  EvmPublicTestnetWalletError,
} from '../lib/wallets/eip1193/public-testnet-executor';
import {
  EVM_PUBLIC_TESTNET_ACCOUNT,
  EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
  evmPublicTestnetInput,
  evmPublicTestnetIntentResponse,
} from './evm-public-testnet.fixtures';

const SECOND_ACCOUNT = '0x2222222222222222222222222222222222222222';
const WITHDRAWAL_INTENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeProvider implements Eip1193Provider {
  chainId: string = EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID;
  accounts: string[] = [EVM_PUBLIC_TESTNET_ACCOUNT];
  sendResult: unknown = EVM_PUBLIC_TESTNET_TRANSACTION_HASH;
  sendFailure: unknown = undefined;
  sendHandler: (() => Promise<unknown>) | null = null;
  unknownChainOnce = false;
  readonly listeners = new Map<string, Set<Eip1193Listener>>();
  readonly request = vi.fn(async (arguments_: Eip1193RequestArguments): Promise<unknown> => {
    switch (arguments_.method) {
      case 'eth_chainId':
        return this.chainId;
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [...this.accounts];
      case 'wallet_switchEthereumChain':
        if (this.unknownChainOnce) {
          this.unknownChainOnce = false;
          throw Object.assign(new Error('unknown network detail'), { code: 4902 });
        }
        this.chainId = EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID;
        return null;
      case 'wallet_addEthereumChain':
        return null;
      case 'eth_sendTransaction':
        if (this.sendHandler !== null) return this.sendHandler();
        if (this.sendFailure !== undefined) throw this.sendFailure;
        return this.sendResult;
      default:
        throw new Error(`unexpected method ${arguments_.method}`);
    }
  });

  on(event: string, listener: Eip1193Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Eip1193Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeListener(event: string, listener: Eip1193Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

function selection(provider: Eip1193Provider): SelectedEip1193Provider {
  return {
    descriptor: {
      selectionId: 'metamask:base-sepolia-test',
      connectorId: 'metamask',
      displayName: 'MetaMask',
      supportedNetworks: [
        {
          chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
          providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
          displayName: 'Base Sepolia',
          environment: 'TESTNET',
        },
      ],
    },
    provider,
  };
}

function transactionRequest() {
  const intent = evmPublicTestnetIntentResponse();
  return {
    from: EVM_PUBLIC_TESTNET_ACCOUNT,
    to: EVM_PUBLIC_TESTNET_GATEWAY,
    value: intent.transaction.value,
    data: evmPublicTestnetInput(),
    nonce: '0x7' as const,
  };
}

function withdrawalRequest(step: EvmPublicTestnetWithdrawalStep = 'APPROVE_AWETH') {
  return {
    step,
    intentId: WITHDRAWAL_INTENT_ID,
    from: EVM_PUBLIC_TESTNET_ACCOUNT,
    to: step === 'APPROVE_AWETH' ? EVM_PUBLIC_TESTNET_ATOKEN : EVM_PUBLIC_TESTNET_GATEWAY,
    value: EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
    data: evmPublicTestnetWithdrawalInput(step, EVM_PUBLIC_TESTNET_ACCOUNT, WITHDRAWAL_INTENT_ID),
    nonce: '0x7' as const,
  };
}

function methods(provider: FakeProvider): string[] {
  return provider.request.mock.calls.map(([request]) => request.method);
}

async function connected(provider = new FakeProvider()) {
  const executor = createEvmPublicTestnetWalletExecutor(selection(provider));
  await executor.connect();
  provider.request.mockClear();
  return { executor, provider };
}

describe('EVM public-testnet wallet executor', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('connects the explicitly selected EIP-6963 provider and double-checks one stable account', async () => {
    const provider = new FakeProvider();
    const executor = createEvmPublicTestnetWalletExecutor(selection(provider));

    await expect(executor.connect()).resolves.toBe(EVM_PUBLIC_TESTNET_ACCOUNT);
    await expect(executor.readSnapshot()).resolves.toEqual({
      account: EVM_PUBLIC_TESTNET_ACCOUNT,
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
      correctNetwork: true,
    });
    expect(methods(provider).filter((method) => method === 'eth_requestAccounts')).toHaveLength(1);
  });

  it('switches to Base Sepolia and verifies the network before requesting accounts', async () => {
    const provider = new FakeProvider();
    provider.chainId = '0x1';
    const executor = createEvmPublicTestnetWalletExecutor(selection(provider));

    await expect(executor.connect()).resolves.toBe(EVM_PUBLIC_TESTNET_ACCOUNT);

    expect(methods(provider).slice(0, 4)).toEqual([
      'eth_chainId',
      'wallet_switchEthereumChain',
      'eth_chainId',
      'eth_requestAccounts',
    ]);
    const switchCall = provider.request.mock.calls.find(
      ([request]) => request.method === 'wallet_switchEthereumChain',
    )?.[0];
    expect(switchCall?.params).toEqual([{ chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID }]);
  });

  it('adds the pinned Base Sepolia definition only after an explicit 4902 response', async () => {
    const provider = new FakeProvider();
    provider.chainId = '0x1';
    provider.unknownChainOnce = true;
    const executor = createEvmPublicTestnetWalletExecutor(selection(provider));

    await executor.connect();

    expect(methods(provider).slice(0, 6)).toEqual([
      'eth_chainId',
      'wallet_switchEthereumChain',
      'wallet_addEthereumChain',
      'wallet_switchEthereumChain',
      'eth_chainId',
      'eth_requestAccounts',
    ]);
    const addCall = provider.request.mock.calls.find(
      ([request]) => request.method === 'wallet_addEthereumChain',
    )?.[0];
    expect(addCall?.params).toEqual([
      {
        chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
        chainName: 'Base Sepolia',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [EVM_PUBLIC_TESTNET_RPC_URL],
        blockExplorerUrls: [EVM_PUBLIC_TESTNET_EXPLORER_ORIGIN],
      },
    ]);
  });

  it('sends exactly one strict from/to/value/data/nonce transaction', async () => {
    const { executor, provider } = await connected();
    const request = transactionRequest();

    await expect(executor.sendTransaction(request, EVM_PUBLIC_TESTNET_ACCOUNT)).resolves.toEqual({
      transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
    });

    const sends = provider.request.mock.calls.filter(
      ([providerRequest]) => providerRequest.method === 'eth_sendTransaction',
    );
    expect(sends).toHaveLength(1);
    expect(sends[0]?.[0].params).toEqual([
      {
        from: EVM_PUBLIC_TESTNET_ACCOUNT,
        to: EVM_PUBLIC_TESTNET_GATEWAY.toLowerCase(),
        value: '0x2d79883d2000',
        data: evmPublicTestnetInput(),
        nonce: '0x7',
      },
    ]);
    expect(
      Object.keys((sends[0]?.[0].params as readonly Record<string, unknown>[])[0] ?? {}),
    ).toEqual(['from', 'to', 'value', 'data', 'nonce']);
  });

  it('rejects transaction mutations before invoking eth_sendTransaction', async () => {
    const mutations: ReadonlyArray<(input: ReturnType<typeof transactionRequest>) => unknown> = [
      (input) => ({ ...input, to: SECOND_ACCOUNT }),
      (input) => ({ ...input, value: '0x1' }),
      (input) => ({ ...input, data: '0x1234' }),
      (input) => ({ ...input, nonce: '0x07' }),
      (input) => ({ ...input, extra: true }),
    ];

    for (const mutate of mutations) {
      const { executor, provider } = await connected();
      await expect(
        executor.sendTransaction(
          mutate(transactionRequest()) as Parameters<typeof executor.sendTransaction>[0],
          EVM_PUBLIC_TESTNET_ACCOUNT,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(methods(provider)).not.toContain('eth_sendTransaction');
    }
  });

  it.each([
    [Object.assign(new Error('wallet detail'), { code: 4001 }), 'USER_REJECTED'],
    [Object.assign(new Error('wallet detail'), { code: -32002 }), 'REQUEST_PENDING'],
    [new Error('transport vanished after request'), 'COMMIT_AMBIGUOUS'],
  ] as const)(
    'classifies send failures without exposing provider messages',
    async (failure, code) => {
      const { executor, provider } = await connected();
      provider.sendFailure = failure;

      const caught = await executor
        .sendTransaction(transactionRequest(), EVM_PUBLIC_TESTNET_ACCOUNT)
        .catch((error: unknown) => error);

      expect(caught).toBeInstanceOf(EvmPublicTestnetWalletError);
      expect(caught).toMatchObject({ code });
      expect(String(caught)).not.toContain('wallet detail');
      expect(methods(provider).filter((method) => method === 'eth_sendTransaction')).toHaveLength(
        1,
      );
    },
  );

  it('treats every malformed post-send hash as commit-ambiguous', async () => {
    for (const result of [null, '0x1234', `0x${'GG'.repeat(32)}`, `0X${'22'.repeat(32)}`]) {
      const { executor, provider } = await connected();
      provider.sendResult = result;
      await expect(
        executor.sendTransaction(transactionRequest(), EVM_PUBLIC_TESTNET_ACCOUNT),
      ).rejects.toMatchObject({ code: 'COMMIT_AMBIGUOUS' });
    }
  });

  it('sends exact approval and full-withdrawal requests through the same hardened provider lane', async () => {
    for (const step of ['APPROVE_AWETH', 'WITHDRAW_FULL_ETH'] as const) {
      const { executor, provider } = await connected();

      await expect(
        executor.sendWithdrawalTransaction(withdrawalRequest(step), EVM_PUBLIC_TESTNET_ACCOUNT),
      ).resolves.toEqual({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH });

      const send = provider.request.mock.calls.find(
        ([request]) => request.method === 'eth_sendTransaction',
      )?.[0];
      expect(send?.params).toEqual([
        {
          from: EVM_PUBLIC_TESTNET_ACCOUNT,
          to: (step === 'APPROVE_AWETH'
            ? EVM_PUBLIC_TESTNET_ATOKEN
            : EVM_PUBLIC_TESTNET_GATEWAY
          ).toLowerCase(),
          value: EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX,
          data: evmPublicTestnetWithdrawalInput(
            step,
            EVM_PUBLIC_TESTNET_ACCOUNT,
            WITHDRAWAL_INTENT_ID,
          ),
          nonce: '0x7',
        },
      ]);
    }
  });

  it('keeps malformed or provider-spoofed post-send failures commit-ambiguous for withdrawal', async () => {
    const malformed = await connected();
    malformed.provider.sendResult = '0x1234';
    await expect(
      malformed.executor.sendWithdrawalTransaction(withdrawalRequest(), EVM_PUBLIC_TESTNET_ACCOUNT),
    ).rejects.toMatchObject({ code: 'COMMIT_AMBIGUOUS' });

    const spoofed = await connected();
    spoofed.provider.sendFailure = new EvmPublicTestnetWalletError('INVALID_RESPONSE');
    await expect(
      spoofed.executor.sendWithdrawalTransaction(withdrawalRequest(), EVM_PUBLIC_TESTNET_ACCOUNT),
    ).rejects.toMatchObject({ code: 'COMMIT_AMBIGUOUS' });
  });

  it('serializes deposit and withdrawal sends across executor instances for one provider', async () => {
    const pending = deferred<unknown>();
    const provider = new FakeProvider();
    const deposit = createEvmPublicTestnetWalletExecutor(selection(provider));
    const withdrawal = createEvmPublicTestnetWalletExecutor(selection(provider));
    await deposit.connect();
    await withdrawal.connect();
    provider.request.mockClear();
    provider.sendHandler = () => pending.promise;

    const first = deposit.sendTransaction(transactionRequest(), EVM_PUBLIC_TESTNET_ACCOUNT);
    await vi.waitFor(() => expect(methods(provider)).toContain('eth_sendTransaction'));
    await expect(
      withdrawal.sendWithdrawalTransaction(withdrawalRequest(), EVM_PUBLIC_TESTNET_ACCOUNT),
    ).rejects.toMatchObject({ code: 'REQUEST_PENDING' });
    pending.resolve(EVM_PUBLIC_TESTNET_TRANSACTION_HASH);
    await expect(first).resolves.toEqual({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH });
    expect(methods(provider).filter((method) => method === 'eth_sendTransaction')).toHaveLength(1);
  });

  it('blocks a deposit send while an unresolved withdrawal journal exists', async () => {
    const { executor, provider } = await connected();
    window.sessionStorage.setItem(
      EVM_PUBLIC_TESTNET_WITHDRAWAL_RECOVERY_JOURNAL_STORAGE_KEY,
      '{"unresolved":true}',
    );

    await expect(
      executor.sendTransaction(transactionRequest(), EVM_PUBLIC_TESTNET_ACCOUNT),
    ).rejects.toMatchObject({ code: 'REQUEST_PENDING' });
    expect(methods(provider)).not.toContain('eth_sendTransaction');
  });

  it('preserves a known hash when abort and account invalidation race the wallet response', async () => {
    const pending = deferred<unknown>();
    const { executor, provider } = await connected();
    provider.sendHandler = () => pending.promise;
    const invalidated = vi.fn();
    executor.subscribeInvalidation(invalidated);
    const controller = new AbortController();

    const sent = executor.sendTransaction(
      transactionRequest(),
      EVM_PUBLIC_TESTNET_ACCOUNT,
      controller.signal,
    );
    await vi.waitFor(() => {
      expect(methods(provider)).toContain('eth_sendTransaction');
    });
    controller.abort();
    provider.emit('accountsChanged', [SECOND_ACCOUNT]);
    pending.resolve(EVM_PUBLIC_TESTNET_TRANSACTION_HASH);

    await expect(sent).resolves.toEqual({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH });
    expect(invalidated).toHaveBeenCalledTimes(1);
    await expect(executor.readSnapshot()).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });

  it('rejects multiple accounts and account drift without sending', async () => {
    const multiple = new FakeProvider();
    multiple.accounts = [EVM_PUBLIC_TESTNET_ACCOUNT, SECOND_ACCOUNT];
    const first = createEvmPublicTestnetWalletExecutor(selection(multiple));
    await expect(first.connect()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(methods(multiple)).not.toContain('eth_sendTransaction');

    const { executor, provider } = await connected();
    await expect(
      executor.sendTransaction(transactionRequest(), SECOND_ACCOUNT),
    ).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    expect(methods(provider)).not.toContain('eth_sendTransaction');
  });

  it('does not impose a global lock across separate selected providers', async () => {
    const firstPending = deferred<unknown>();
    const secondPending = deferred<unknown>();
    const first = await connected();
    const second = await connected();
    first.provider.sendHandler = () => firstPending.promise;
    second.provider.sendHandler = () => secondPending.promise;

    const firstSend = first.executor.sendTransaction(
      transactionRequest(),
      EVM_PUBLIC_TESTNET_ACCOUNT,
    );
    const secondSend = second.executor.sendTransaction(
      transactionRequest(),
      EVM_PUBLIC_TESTNET_ACCOUNT,
    );
    await vi.waitFor(() => {
      expect(methods(first.provider)).toContain('eth_sendTransaction');
      expect(methods(second.provider)).toContain('eth_sendTransaction');
    });
    firstPending.resolve(EVM_PUBLIC_TESTNET_TRANSACTION_HASH);
    secondPending.resolve(`0x${'33'.repeat(32)}`);

    await expect(Promise.all([firstSend, secondSend])).resolves.toEqual([
      { transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH },
      { transactionHash: `0x${'33'.repeat(32)}` },
    ]);
  });

  it('claims the selected-provider send lock before asynchronous preflight reads', async () => {
    const provider = new FakeProvider();
    const executor = createEvmPublicTestnetWalletExecutor(selection(provider));
    await executor.connect();
    const preflight = deferred<unknown>();
    const originalRequest = provider.request.getMockImplementation();
    let held = false;
    provider.request.mockImplementation(async (request) => {
      if (!held && request.method === 'eth_chainId') {
        held = true;
        return preflight.promise;
      }
      if (originalRequest === undefined) throw new Error('missing fake provider implementation');
      return originalRequest(request);
    });

    const first = executor.sendTransaction(transactionRequest(), EVM_PUBLIC_TESTNET_ACCOUNT);
    await vi.waitFor(() => expect(held).toBe(true));
    await expect(
      executor.sendTransaction(transactionRequest(), EVM_PUBLIC_TESTNET_ACCOUNT),
    ).rejects.toMatchObject({ code: 'REQUEST_PENDING' });
    preflight.resolve(EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID);

    await expect(first).resolves.toEqual({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH });
    expect(methods(provider).filter((method) => method === 'eth_sendTransaction')).toHaveLength(1);
  });

  it('cleans up provider listeners and rejects unsupported selections', async () => {
    const provider = new FakeProvider();
    const executor = createEvmPublicTestnetWalletExecutor(selection(provider));
    await executor.connect();

    executor.dispose();

    expect([...provider.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    await expect(executor.readSnapshot()).rejects.toMatchObject({ code: 'DISCONNECTED' });

    const unsupported = selection(new FakeProvider());
    const descriptor = {
      ...unsupported.descriptor,
      supportedNetworks: [
        {
          chainId: 'eip155:11155111' as const,
          providerChainId: '0xaa36a7' as const,
          displayName: 'Ethereum Sepolia',
          environment: 'TESTNET' as const,
        },
      ],
    };
    expect(() => createEvmPublicTestnetWalletExecutor({ ...unsupported, descriptor })).toThrow(
      EvmPublicTestnetWalletError,
    );
  });
});
