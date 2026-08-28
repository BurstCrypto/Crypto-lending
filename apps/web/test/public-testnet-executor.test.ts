import { PublicKey } from '@solana/web3.js';
import { SolanaSignAndSendTransaction } from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardEvents } from '@wallet-standard/features';
import type { StandardEventsChangeProperties } from '@wallet-standard/features';
import type { Wallets } from '@wallet-standard/app';
import { describe, expect, it, vi } from 'vitest';

import { publicTestnetWalletTransaction } from '../lib/public-testnet/public-testnet-execution';
import {
  PhantomSolanaWalletDiscovery,
  type SelectedSolanaWallet,
} from '../lib/wallets/solana/discovery';
import {
  createSolanaPublicTestnetWalletExecutor,
  SolanaPublicTestnetWalletError,
} from '../lib/wallets/solana/public-testnet-executor';
import {
  PUBLIC_TESTNET_ACCOUNT,
  PUBLIC_TESTNET_SIGNATURE,
  publicTestnetIntent,
} from './public-testnet.fixtures';

const ICON = 'data:image/svg+xml;base64,PHN2Zy8+' as const;
const SIGNATURE_BYTES = Uint8Array.from({ length: 64 }, (_, index) => index + 1);

interface FakeWalletControl {
  readonly wallet: Wallet;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
  emit(properties: StandardEventsChangeProperties): void;
}

function account(address = PUBLIC_TESTNET_ACCOUNT): WalletAccount {
  return {
    address,
    publicKey: new PublicKey(address).toBytes(),
    chains: ['solana:devnet'],
    features: ['solana:signAndSendTransaction'],
  };
}

function fakeWallet(
  options: Readonly<{
    name?: string;
    chains?: readonly `${string}:${string}`[];
    accounts?: readonly WalletAccount[];
    send?: (...inputs: readonly unknown[]) => Promise<readonly { signature: Uint8Array }[]>;
  }> = {},
): FakeWalletControl {
  const selectedAccounts = options.accounts ?? [account()];
  const connect = vi.fn(async () => ({ accounts: selectedAccounts }));
  const send = vi.fn(
    options.send ?? (async () => [{ signature: Uint8Array.from(SIGNATURE_BYTES) }] as const),
  );
  let listener: ((properties: StandardEventsChangeProperties) => void) | null = null;
  const wallet: Wallet = {
    version: '1.0.0',
    name: options.name ?? 'Phantom',
    icon: ICON,
    chains: options.chains ?? ['solana:devnet'],
    accounts: [],
    features: {
      [StandardConnect]: { version: '1.0.0', connect },
      [StandardEvents]: {
        version: '1.0.0',
        on: (_event: 'change', next: (properties: StandardEventsChangeProperties) => void) => {
          listener = next;
          return () => {
            listener = null;
          };
        },
      },
      [SolanaSignAndSendTransaction]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: send,
      },
    },
  };
  return {
    wallet,
    connect,
    send,
    emit: (properties) => listener?.(properties),
  };
}

function selection(wallet: Wallet): SelectedSolanaWallet {
  return {
    descriptor: {
      selectionId: 'phantom:1',
      displayName: 'Phantom',
      supportedTransactionVersions: ['legacy', 0],
    },
    wallet,
  };
}

function registry(wallets: readonly Wallet[]): Pick<Wallets, 'get' | 'on'> {
  return {
    get: () => wallets,
    on: () => () => undefined,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('PhantomSolanaWalletDiscovery', () => {
  it('discovers only a compatible Phantom Wallet Standard provider on Devnet', () => {
    const phantom = fakeWallet();
    const coinbase = fakeWallet({ name: 'Coinbase Wallet' });
    const mainnetOnly = fakeWallet({ chains: ['solana:mainnet'] });
    const discovery = new PhantomSolanaWalletDiscovery({
      wallets: registry([coinbase.wallet, mainnetOnly.wallet, phantom.wallet]),
      secureContext: () => true,
      topLevelContext: () => true,
    });

    discovery.start();

    expect(discovery.list()).toEqual([
      expect.objectContaining({
        displayName: 'Phantom',
        supportedTransactionVersions: ['legacy', 0],
      }),
    ]);
    expect(discovery.select(discovery.list()[0]!.selectionId)?.wallet).toBe(phantom.wallet);
    discovery.stop();
    expect(discovery.list()).toEqual([]);
  });

  it('does not expose wallets in an insecure or framed context', () => {
    const phantom = fakeWallet();
    const insecure = new PhantomSolanaWalletDiscovery({
      wallets: registry([phantom.wallet]),
      secureContext: () => false,
      topLevelContext: () => true,
    });
    insecure.start();
    expect(insecure.list()).toEqual([]);
  });
});

describe('Solana public-testnet wallet executor', () => {
  it('connects explicitly and sends exactly one legacy Devnet transaction', async () => {
    const fake = fakeWallet();
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));

    await expect(executor.connect()).resolves.toBe(PUBLIC_TESTNET_ACCOUNT);
    await expect(
      executor.sendTransaction(
        publicTestnetWalletTransaction(publicTestnetIntent()),
        PUBLIC_TESTNET_ACCOUNT,
      ),
    ).resolves.toBe(PUBLIC_TESTNET_SIGNATURE);

    expect(fake.connect).toHaveBeenCalledWith({ silent: false });
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(fake.send).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({ address: PUBLIC_TESTNET_ACCOUNT }),
        chain: 'solana:devnet',
        transaction: expect.any(Uint8Array),
        options: {
          preflightCommitment: 'confirmed',
          commitment: 'confirmed',
          minContextSlot: 400000000,
          skipPreflight: false,
          maxRetries: 0,
        },
      }),
    );
  });

  it('preserves a known signature when abort races the wallet response', async () => {
    const pending = deferred<readonly { signature: Uint8Array }[]>();
    const fake = fakeWallet({ send: async () => pending.promise });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();
    const controller = new AbortController();

    const submitted = executor.sendTransaction(
      publicTestnetWalletTransaction(publicTestnetIntent()),
      PUBLIC_TESTNET_ACCOUNT,
      controller.signal,
    );
    controller.abort();
    pending.resolve([{ signature: SIGNATURE_BYTES }]);

    await expect(submitted).resolves.toBe(PUBLIC_TESTNET_SIGNATURE);
    expect(fake.send).toHaveBeenCalledTimes(1);
  });

  it('preserves a known signature and emits invalidation when the account changes in flight', async () => {
    const pending = deferred<readonly { signature: Uint8Array }[]>();
    const fake = fakeWallet({ send: async () => pending.promise });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    const invalidated = vi.fn();
    await executor.connect();
    executor.subscribeInvalidation(invalidated);

    const submitted = executor.sendTransaction(
      publicTestnetWalletTransaction(publicTestnetIntent()),
      PUBLIC_TESTNET_ACCOUNT,
    );
    fake.emit({ accounts: [] });
    pending.resolve([{ signature: SIGNATURE_BYTES }]);

    await expect(submitted).resolves.toBe(PUBLIC_TESTNET_SIGNATURE);
    expect(invalidated).toHaveBeenCalledTimes(1);
    await expect(executor.readSnapshot()).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });

  it('classifies a thrown write as commit-ambiguous and never retries it', async () => {
    const fake = fakeWallet({
      send: async () => {
        throw new Error('transport disappeared');
      },
    });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    const error = await executor
      .sendTransaction(
        publicTestnetWalletTransaction(publicTestnetIntent()),
        PUBLIC_TESTNET_ACCOUNT,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SolanaPublicTestnetWalletError);
    expect(error).toMatchObject({ code: 'COMMIT_AMBIGUOUS' });
    expect(fake.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { output: [] as readonly { signature: Uint8Array }[] },
    { output: [{ signature: Uint8Array.of(1) }] },
    { output: [{ signature: SIGNATURE_BYTES }, { signature: SIGNATURE_BYTES }] },
  ])('classifies every malformed post-send output as commit-ambiguous', async ({ output }) => {
    const fake = fakeWallet({ send: async () => output });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    await expect(
      executor.sendTransaction(
        publicTestnetWalletTransaction(publicTestnetIntent()),
        PUBLIC_TESTNET_ACCOUNT,
      ),
    ).rejects.toMatchObject({ code: 'COMMIT_AMBIGUOUS' });
    expect(fake.send).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicit user rejection retryable because no signature was committed', async () => {
    const fake = fakeWallet({
      send: async () => {
        throw Object.assign(new Error('rejected'), { code: 4001 });
      },
    });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    await expect(
      executor.sendTransaction(
        publicTestnetWalletTransaction(publicTestnetIntent()),
        PUBLIC_TESTNET_ACCOUNT,
      ),
    ).rejects.toMatchObject({ code: 'USER_REJECTED' });
  });

  it('rejects multiple authorized accounts and never asks for a signature', async () => {
    const secondAddress = new PublicKey(Uint8Array.from({ length: 32 }, () => 44)).toBase58();
    const fake = fakeWallet({ accounts: [account(), account(secondAddress)] });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));

    await expect(executor.connect()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fake.send).not.toHaveBeenCalled();
  });
});
