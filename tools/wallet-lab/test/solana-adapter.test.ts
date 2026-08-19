import { SolanaSignIn, SolanaSignMessage } from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardDisconnect, StandardEvents } from '@wallet-standard/features';
import { describe, expect, it, vi } from 'vitest';

import {
  createDevnetSignInMessage,
  createPhantomSolanaAdapter,
  PhantomSolanaAdapterError,
  SOLANA_DEVNET_CHAIN,
  type DevnetSignInInput,
  type WalletStandardRegistry,
} from '../src/solana';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

class TestWalletRegistry implements WalletStandardRegistry {
  readonly #listeners = {
    register: new Set<(...wallets: Wallet[]) => void>(),
    unregister: new Set<(...wallets: Wallet[]) => void>(),
  };
  readonly #wallets: Wallet[];

  constructor(wallets: readonly Wallet[]) {
    this.#wallets = [...wallets];
  }

  get(): readonly Wallet[] {
    return [...this.#wallets];
  }

  on(event: 'register' | 'unregister', listener: (...wallets: Wallet[]) => void): () => void {
    this.#listeners[event].add(listener);
    return () => this.#listeners[event].delete(listener);
  }
}

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.every((byte) => byte === 0)) return '1'.repeat(bytes.length);
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeroes = 0;
  while (bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return (
    '1'.repeat(leadingZeroes) +
    digits
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit])
      .join('')
  );
}

function account(
  fill = 0,
  features: readonly string[] = [SolanaSignIn, SolanaSignMessage],
  chains: readonly string[] = [SOLANA_DEVNET_CHAIN],
): WalletAccount {
  const publicKey = new Uint8Array(32).fill(fill);
  return {
    address: encodeBase58(publicKey),
    publicKey,
    chains,
    features,
  } as unknown as WalletAccount;
}

interface MockWallet {
  readonly wallet: Wallet;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
  readonly signIn: ReturnType<typeof vi.fn> | null;
  readonly signMessage: ReturnType<typeof vi.fn> | null;
  emitAccounts(accounts: readonly WalletAccount[]): void;
  readonly eventOff: ReturnType<typeof vi.fn>;
}

function mockWallet(
  options: {
    readonly accounts?: readonly WalletAccount[];
    readonly connectError?: unknown;
    readonly signIn?: boolean;
    readonly signMessage?: boolean;
  } = {},
): MockWallet {
  const accounts = options.accounts ?? [account()];
  let changeListener:
    ((properties: { readonly accounts?: readonly WalletAccount[] }) => void) | null = null;
  const eventOff = vi.fn();
  const connect = vi.fn(async () => {
    if (options.connectError !== undefined) throw options.connectError;
    return { accounts };
  });
  const disconnect = vi.fn(async () => undefined);
  const signIn =
    options.signIn === false
      ? null
      : vi.fn(async (...inputs: readonly DevnetSignInInput[]) =>
          inputs.map((input) => ({
            account: accounts[0],
            signedMessage: createDevnetSignInMessage(input),
            signature: new Uint8Array(64).fill(3),
            signatureType: 'ed25519' as const,
          })),
        );
  const signMessage =
    options.signMessage === false
      ? null
      : vi.fn(async (...inputs: readonly { readonly message: Uint8Array }[]) =>
          inputs.map((input) => ({
            signedMessage: Uint8Array.from(input.message),
            signature: new Uint8Array(64).fill(4),
            signatureType: 'ed25519' as const,
          })),
        );
  const features: Record<string, unknown> = {
    [StandardConnect]: { version: '1.0.0', connect },
    [StandardDisconnect]: { version: '1.0.0', disconnect },
    [StandardEvents]: {
      version: '1.0.0',
      on: vi.fn(
        (
          _event: 'change',
          listener: (properties: { readonly accounts?: readonly WalletAccount[] }) => void,
        ) => {
          changeListener = listener;
          return eventOff;
        },
      ),
    },
  };
  if (signIn !== null) features[SolanaSignIn] = { version: '1.0.0', signIn };
  if (signMessage !== null) {
    features[SolanaSignMessage] = { version: '1.0.0', signMessage };
  }
  const wallet = {
    version: '1.0.0',
    name: 'Phantom',
    icon: 'data:image/svg+xml;base64,',
    chains: [SOLANA_DEVNET_CHAIN],
    accounts: [],
    features,
  } as unknown as Wallet;

  return {
    wallet,
    connect,
    disconnect,
    signIn,
    signMessage,
    eventOff,
    emitAccounts(nextAccounts) {
      changeListener?.({ accounts: nextAccounts });
    },
  };
}

function signInInput(address: string): DevnetSignInInput {
  return {
    domain: '127.0.0.1:4173',
    address,
    statement: 'Prove control of this devnet account.',
    uri: 'https://127.0.0.1:4173/wallet-lab',
    version: '1',
    chainId: SOLANA_DEVNET_CHAIN,
    nonce: 'nonce12345678',
    issuedAt: '2026-08-18T22:00:00.000Z',
    expirationTime: '2026-08-18T22:05:00.000Z',
    requestId: 'request-solana-1',
  };
}

function adapterFor(mock: MockWallet) {
  return createPhantomSolanaAdapter({ wallets: new TestWalletRegistry([mock.wallet]) });
}

function deferredCompletion(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const staleAccountEvents = [
  { label: 'changes accounts', accounts: [account(7)] as readonly WalletAccount[] },
  { label: 'clears the account list', accounts: [] as readonly WalletAccount[] },
] as const;

describe('Phantom Solana Wallet Standard adapter', () => {
  it('blocks a stale signing completion when account clear and listener cleanup both race it', async () => {
    const mock = mockWallet();
    const signMessage = mock.signMessage;
    if (signMessage === null) throw new Error('The sign-message mock is required for this test.');
    const completion = deferredCompletion();
    signMessage.mockImplementationOnce(
      async (...inputs: readonly { readonly message: Uint8Array }[]) => {
        await completion.promise;
        return inputs.map((input) => ({
          signedMessage: Uint8Array.from(input.message),
          signature: new Uint8Array(64).fill(4),
          signatureType: 'ed25519' as const,
        }));
      },
    );
    const adapter = adapterFor(mock);
    const discovered = adapter.discover()[0];
    await adapter.connect(discovered?.id ?? 'missing');
    mock.eventOff.mockImplementation(() => {
      throw new Error('wallet cleanup failed');
    });

    const signing = adapter.signMessage(new Uint8Array([1]));
    expect(() => mock.emitAccounts([])).not.toThrow();
    completion.release();
    await expect(signing).rejects.toMatchObject({
      code: 'wallet_unavailable',
    });
    expect(adapter.getState()).toMatchObject({ connection: null });
  });

  it('disconnects and destroys without retaining state when wallet cleanup throws', async () => {
    const disconnectMock = mockWallet();
    const disconnectAdapter = adapterFor(disconnectMock);
    await disconnectAdapter.connect(disconnectAdapter.discover()[0]?.id ?? 'missing');
    disconnectMock.eventOff.mockImplementation(() => {
      throw new Error('wallet cleanup failed');
    });

    await expect(disconnectAdapter.disconnect()).resolves.toBeUndefined();
    expect(disconnectAdapter.getState()).toMatchObject({
      status: 'disconnected',
      connection: null,
    });

    const destroyMock = mockWallet();
    const destroyAdapter = adapterFor(destroyMock);
    await destroyAdapter.connect(destroyAdapter.discover()[0]?.id ?? 'missing');
    destroyMock.eventOff.mockImplementation(() => {
      throw new Error('wallet cleanup failed');
    });

    expect(() => destroyAdapter.destroy()).not.toThrow();
    expect(destroyAdapter.getState()).toMatchObject({
      status: 'disconnected',
      connection: null,
    });
  });

  it('connects only after explicit selection and uses wallet sign-in when supported', async () => {
    const mock = mockWallet();
    const adapter = adapterFor(mock);
    const discovered = adapter.discover()[0];
    expect(discovered).toBeDefined();
    expect(mock.connect).not.toHaveBeenCalled();

    const connection = await adapter.connect(discovered?.id ?? 'missing');
    expect(mock.connect).toHaveBeenCalledWith({ silent: false });
    expect(connection).toMatchObject({
      chain: SOLANA_DEVNET_CHAIN,
      address: account().address,
      capabilities: { ownership: SolanaSignIn },
    });
    expect(adapter.getOwnershipCapability()).toBe(SolanaSignIn);

    const input = signInInput(connection.address);
    const result = await adapter.signIn(input);
    expect(mock.signIn).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({
      method: SolanaSignIn,
      chain: SOLANA_DEVNET_CHAIN,
      address: connection.address,
      signatureType: 'ed25519',
    });
    expect(result.signature).toHaveLength(64);
    expect(adapter.getState()).toMatchObject({ status: 'connected', error: null });
    expect(adapter).not.toHaveProperty('sendTransaction');
    expect(JSON.stringify(adapter.getState())).not.toContain('signature');

    adapter.destroy();
  });

  it('detects and executes the exact sign-message fallback without automatic sign-in', async () => {
    const fallbackAccount = account(0, [SolanaSignMessage]);
    const mock = mockWallet({ accounts: [fallbackAccount], signIn: false });
    const adapter = adapterFor(mock);
    const walletId = adapter.discover()[0]?.id ?? 'missing';
    const connection = await adapter.connect(walletId);

    expect(adapter.getOwnershipCapability()).toBe(SolanaSignMessage);
    await expect(adapter.signIn(signInInput(connection.address))).rejects.toMatchObject({
      code: 'unsupported_capability',
    });

    const message = new TextEncoder().encode('exact server-issued SIWS fallback');
    const result = await adapter.signMessage(message);
    const signMessageCall = mock.signMessage?.mock.calls[0]?.[0];
    expect(signMessageCall?.account).toBe(fallbackAccount);
    expect(Array.from(signMessageCall?.message ?? [])).toEqual(Array.from(message));
    expect(result).toMatchObject({
      method: SolanaSignMessage,
      address: fallbackAccount.address,
      account: { address: fallbackAccount.address },
      signatureType: 'ed25519',
    });
    expect(Array.from(result.signedMessage)).toEqual(Array.from(message));

    adapter.destroy();
  });

  it.each(staleAccountEvents)(
    'rejects a stale sign-in completion when Phantom $label',
    async ({ accounts: nextAccounts }) => {
      const initialAccount = account();
      const mock = mockWallet({ accounts: [initialAccount] });
      const signIn = mock.signIn;
      if (signIn === null) throw new Error('The sign-in mock is required for this test.');
      const completion = deferredCompletion();
      signIn.mockImplementationOnce(async (...inputs: readonly DevnetSignInInput[]) => {
        await completion.promise;
        return inputs.map((input) => ({
          account: initialAccount,
          signedMessage: createDevnetSignInMessage(input),
          signature: new Uint8Array(64).fill(3),
          signatureType: 'ed25519' as const,
        }));
      });
      const adapter = adapterFor(mock);
      const connection = await adapter.connect(adapter.discover()[0]?.id ?? 'missing');

      const signing = adapter.signIn(signInInput(connection.address));
      expect(signIn).toHaveBeenCalledTimes(1);
      mock.emitAccounts(nextAccounts);
      completion.release();

      await expect(signing).rejects.toMatchObject({
        code: 'wallet_unavailable',
        message: 'The selected wallet account changed before signing completed.',
        recoverable: true,
      });
      expect(adapter.getState()).toMatchObject({
        status: 'error',
        connection: nextAccounts[0] === undefined ? null : { address: nextAccounts[0].address },
        error: { code: 'wallet_unavailable' },
      });
      expect(adapter.getState().connection?.address).not.toBe(initialAccount.address);

      adapter.destroy();
    },
  );

  it.each(staleAccountEvents)(
    'rejects a stale sign-message completion when Phantom $label',
    async ({ accounts: nextAccounts }) => {
      const initialAccount = account();
      const mock = mockWallet({ accounts: [initialAccount] });
      const signMessage = mock.signMessage;
      if (signMessage === null) throw new Error('The sign-message mock is required for this test.');
      const completion = deferredCompletion();
      signMessage.mockImplementationOnce(
        async (...inputs: readonly { readonly message: Uint8Array }[]) => {
          await completion.promise;
          return inputs.map((input) => ({
            signedMessage: Uint8Array.from(input.message),
            signature: new Uint8Array(64).fill(4),
            signatureType: 'ed25519' as const,
          }));
        },
      );
      const adapter = adapterFor(mock);
      await adapter.connect(adapter.discover()[0]?.id ?? 'missing');

      const signing = adapter.signMessage(new TextEncoder().encode('stale proof must fail'));
      expect(signMessage).toHaveBeenCalledTimes(1);
      mock.emitAccounts(nextAccounts);
      completion.release();

      await expect(signing).rejects.toMatchObject({
        code: 'wallet_unavailable',
        message: 'The selected wallet account changed before signing completed.',
        recoverable: true,
      });
      expect(adapter.getState()).toMatchObject({
        status: 'error',
        connection: nextAccounts[0] === undefined ? null : { address: nextAccounts[0].address },
        error: { code: 'wallet_unavailable' },
      });
      expect(adapter.getState().connection?.address).not.toBe(initialAccount.address);

      adapter.destroy();
    },
  );

  it('rejects sign-in bytes that do not bind the exact requested fields', async () => {
    const walletAccount = account();
    const mock = mockWallet({ accounts: [walletAccount] });
    mock.signIn?.mockResolvedValueOnce([
      {
        account: walletAccount,
        signedMessage: new TextEncoder().encode('different nonce and origin'),
        signature: new Uint8Array(64).fill(3),
        signatureType: 'ed25519',
      },
    ]);
    const adapter = adapterFor(mock);
    const connection = await adapter.connect(adapter.discover()[0]?.id ?? 'missing');

    await expect(adapter.signIn(signInInput(connection.address))).rejects.toMatchObject({
      code: 'invalid_wallet_response',
      message: 'The wallet did not sign the exact requested sign-in fields.',
    });

    adapter.destroy();
  });

  it('rejects localhost aliases outside the exact loopback origin before prompting', async () => {
    const mock = mockWallet();
    const adapter = adapterFor(mock);
    const connection = await adapter.connect(adapter.discover()[0]?.id ?? 'missing');
    const wrongOrigin = {
      ...signInInput(connection.address),
      domain: 'localhost:4173',
      uri: 'https://localhost:4173/wallet-lab',
    };

    await expect(adapter.signIn(wrongOrigin)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mock.signIn).not.toHaveBeenCalled();

    adapter.destroy();
  });

  it('requires explicit selection when Phantom authorizes multiple accounts', async () => {
    const first = account(0);
    const second = account(1);
    const mock = mockWallet({ accounts: [first, second] });
    const adapter = adapterFor(mock);
    const walletId = adapter.discover()[0]?.id ?? 'missing';

    await expect(adapter.connect(walletId)).rejects.toMatchObject({
      code: 'account_selection_required',
    });
    expect(adapter.getState().connection).toBeNull();

    const connection = await adapter.connect(walletId, { accountAddress: second.address });
    expect(connection.address).toBe(second.address);

    adapter.destroy();
  });

  it('rejects non-devnet accounts and never exposes a transaction method', async () => {
    const mainnetAccount = account(0, [SolanaSignIn], ['solana:mainnet']);
    const mock = mockWallet({ accounts: [mainnetAccount] });
    const adapter = adapterFor(mock);
    const walletId = adapter.discover()[0]?.id ?? 'missing';

    await expect(adapter.connect(walletId)).rejects.toMatchObject({
      code: 'invalid_wallet_response',
    });
    expect(adapter.getState().connection).toBeNull();
    expect('sendTransaction' in adapter).toBe(false);

    adapter.destroy();
  });

  it('sanitizes wallet errors without retaining raw messages or account-like data', async () => {
    const secret = 'wc:pairing-topic@2?symKey=do-not-leak';
    const mock = mockWallet({ connectError: new Error(secret) });
    const adapter = adapterFor(mock);
    const walletId = adapter.discover()[0]?.id ?? 'missing';

    let caught: unknown;
    try {
      await adapter.connect(walletId);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PhantomSolanaAdapterError);
    expect(caught).toMatchObject({
      code: 'wallet_request_failed',
      message: 'The wallet could not complete the request.',
      recoverable: true,
    });
    expect(JSON.stringify(caught)).not.toContain(secret);
    expect(JSON.stringify(adapter.getState())).not.toContain(secret);

    adapter.destroy();
  });

  it('handles account and disconnect events with exact listener cleanup', async () => {
    const first = account(0);
    const second = account(2);
    const mock = mockWallet({ accounts: [first] });
    const adapter = adapterFor(mock);
    await adapter.connect(adapter.discover()[0]?.id ?? 'missing');

    mock.emitAccounts([second]);
    expect(adapter.getState().connection?.address).toBe(second.address);

    await adapter.disconnect();
    expect(mock.disconnect).toHaveBeenCalledTimes(1);
    expect(mock.eventOff).toHaveBeenCalledTimes(1);
    expect(adapter.getState()).toMatchObject({ status: 'disconnected', connection: null });

    adapter.destroy();
  });
});
