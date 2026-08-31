import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { SolanaSignTransaction } from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardEvents } from '@wallet-standard/features';
import type { StandardEventsChangeProperties } from '@wallet-standard/features';
import type { Wallets } from '@wallet-standard/app';
import { describe, expect, it, vi } from 'vitest';

import {
  PhantomSolanaWalletDiscovery,
  type SelectedSolanaWallet,
} from '../lib/wallets/solana/discovery';
import {
  createSolanaPublicTestnetWalletExecutor,
  SolanaPublicTestnetWalletError,
} from '../lib/wallets/solana/public-testnet-executor';
import { PUBLIC_TESTNET_BLOCKHASH } from './public-testnet.fixtures';

const ICON = 'data:image/svg+xml;base64,PHN2Zy8+' as const;
const TEST_KEYPAIR = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const TEST_ACCOUNT = TEST_KEYPAIR.publicKey.toBase58();

function transactionRequest() {
  const transaction = new Transaction({
    feePayer: TEST_KEYPAIR.publicKey,
    recentBlockhash: PUBLIC_TESTNET_BLOCKHASH,
  }).add(
    SystemProgram.transfer({
      fromPubkey: TEST_KEYPAIR.publicKey,
      toPubkey: TEST_KEYPAIR.publicKey,
      lamports: 1,
    }),
  );
  return Object.freeze({
    serializedTransaction: Uint8Array.from(
      transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ),
    transactionVersion: 'legacy' as const,
    minContextSlot: 400_000_000,
  });
}

function signedOutput(
  input: unknown,
  mutate?: ((transaction: Transaction) => void) | undefined,
): Readonly<{ signedTransaction: Uint8Array }> {
  const transactionBytes = (input as { transaction: Uint8Array }).transaction;
  const transaction = Transaction.from(transactionBytes);
  mutate?.(transaction);
  transaction.sign(TEST_KEYPAIR);
  return Object.freeze({ signedTransaction: Uint8Array.from(transaction.serialize()) });
}

function validSigner(...inputs: readonly unknown[]) {
  return Promise.resolve([signedOutput(inputs[0])] as const);
}

interface FakeWalletControl {
  readonly wallet: Wallet;
  readonly connect: ReturnType<typeof vi.fn>;
  readonly sign: ReturnType<typeof vi.fn>;
  emit(properties: StandardEventsChangeProperties): void;
}

function account(address = TEST_ACCOUNT): WalletAccount {
  return {
    address,
    publicKey: new PublicKey(address).toBytes(),
    chains: ['solana:devnet'],
    features: ['solana:signTransaction'],
  };
}

function fakeWallet(
  options: Readonly<{
    name?: string;
    chains?: readonly `${string}:${string}`[];
    accounts?: readonly WalletAccount[];
    includeSignFeature?: boolean;
    sign?: (...inputs: readonly unknown[]) => Promise<readonly { signedTransaction: Uint8Array }[]>;
  }> = {},
): FakeWalletControl {
  const selectedAccounts = options.accounts ?? [account()];
  const connect = vi.fn(async () => ({ accounts: selectedAccounts }));
  const sign = vi.fn(options.sign ?? validSigner);
  let listener: ((properties: StandardEventsChangeProperties) => void) | null = null;
  const features: Wallet['features'] = {
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
    ...(options.includeSignFeature === false
      ? {}
      : {
          [SolanaSignTransaction]: {
            version: '1.0.0',
            supportedTransactionVersions: ['legacy', 0],
            signTransaction: sign,
          },
        }),
  };
  const wallet: Wallet = {
    version: '1.0.0',
    name: options.name ?? 'Phantom',
    icon: ICON,
    chains: options.chains ?? ['solana:devnet'],
    accounts: [],
    features,
  };
  return {
    wallet,
    connect,
    sign,
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

  it('does not discover Phantom without the sign-only Wallet Standard feature', () => {
    const signAndSendOnly = fakeWallet({ includeSignFeature: false });
    const discovery = new PhantomSolanaWalletDiscovery({
      wallets: registry([signAndSendOnly.wallet]),
      secureContext: () => true,
      topLevelContext: () => true,
    });

    discovery.start();

    expect(discovery.list()).toEqual([]);
  });
});

describe('Solana public-testnet wallet executor', () => {
  it('connects explicitly and signs exactly one legacy Devnet transaction without broadcasting', async () => {
    const fake = fakeWallet();
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));

    await expect(executor.connect()).resolves.toBe(TEST_ACCOUNT);
    const signed = await executor.signTransaction(transactionRequest(), TEST_ACCOUNT);

    expect(fake.connect).toHaveBeenCalledWith({ silent: false });
    expect(fake.sign).toHaveBeenCalledTimes(1);
    expect(fake.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({ address: TEST_ACCOUNT }),
        chain: 'solana:devnet',
        transaction: expect.any(Uint8Array),
      }),
    );
    expect(fake.sign.mock.calls[0]?.[0]).not.toHaveProperty('options');
    expect(Object.isFrozen(signed)).toBe(true);
    const transaction = Transaction.from(signed.serializedTransaction);
    expect(transaction.verifySignatures()).toBe(true);
    expect(transaction.signature).not.toBeNull();
    expect(signed.serializedTransaction.byteLength).toBeLessThanOrEqual(1_232);
  });

  it('preserves a known signature when abort races the wallet response', async () => {
    const pending = deferred<readonly { signedTransaction: Uint8Array }[]>();
    const fake = fakeWallet({ sign: async () => pending.promise });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();
    const controller = new AbortController();
    const request = transactionRequest();

    const submitted = executor.signTransaction(request, TEST_ACCOUNT, controller.signal);
    controller.abort();
    pending.resolve([signedOutput({ transaction: request.serializedTransaction })]);

    await expect(submitted).resolves.toEqual(
      expect.objectContaining({ signature: expect.any(String) }),
    );
    expect(fake.sign).toHaveBeenCalledTimes(1);
  });

  it('preserves a known signature and emits invalidation when the account changes in flight', async () => {
    const pending = deferred<readonly { signedTransaction: Uint8Array }[]>();
    const fake = fakeWallet({ sign: async () => pending.promise });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    const invalidated = vi.fn();
    await executor.connect();
    executor.subscribeInvalidation(invalidated);
    const request = transactionRequest();

    const submitted = executor.signTransaction(request, TEST_ACCOUNT);
    fake.emit({ accounts: [] });
    pending.resolve([signedOutput({ transaction: request.serializedTransaction })]);

    await expect(submitted).resolves.toEqual(
      expect.objectContaining({ signature: expect.any(String) }),
    );
    expect(invalidated).toHaveBeenCalledTimes(1);
    await expect(executor.readSnapshot()).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });

  it('rejects a non-legacy request before opening the signing prompt', async () => {
    const fake = fakeWallet();
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();
    const request = transactionRequest();

    await expect(
      executor.signTransaction({ ...request, transactionVersion: 0 }, TEST_ACCOUNT),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(fake.sign).not.toHaveBeenCalled();
  });

  it('accepts only the bounded Phantom priority-price then compute-limit prefix', async () => {
    const fake = fakeWallet({
      sign: async (...inputs) => [
        signedOutput(inputs[0], (transaction) => {
          transaction.instructions.unshift(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000n }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          );
        }),
      ],
    });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    const signed = await executor.signTransaction(transactionRequest(), TEST_ACCOUNT);

    const transaction = Transaction.from(signed.serializedTransaction);
    expect(transaction.instructions[0]?.programId.equals(ComputeBudgetProgram.programId)).toBe(
      true,
    );
    expect(transaction.instructions[1]?.programId.equals(ComputeBudgetProgram.programId)).toBe(
      true,
    );
    expect(transaction.verifySignatures()).toBe(true);
  });

  it.each([
    {
      name: 'priority price above policy',
      mutate: (transaction: Transaction) => {
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_001n }),
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        );
      },
    },
    {
      name: 'wrong priority-instruction order',
      mutate: (transaction: Transaction) => {
        transaction.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1n }),
        );
      },
    },
    {
      name: 'changed core instruction',
      mutate: (transaction: Transaction) => {
        transaction.instructions.push(
          SystemProgram.transfer({
            fromPubkey: TEST_KEYPAIR.publicKey,
            toPubkey: TEST_KEYPAIR.publicKey,
            lamports: 2,
          }),
        );
      },
    },
  ])('rejects a signed transaction with $name', async ({ mutate }) => {
    const fake = fakeWallet({
      sign: async (...inputs) => [signedOutput(inputs[0], mutate)],
    });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    await expect(
      executor.signTransaction(transactionRequest(), TEST_ACCOUNT),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fake.sign).toHaveBeenCalledTimes(1);
  });

  it('rejects a signed transaction with an invalid cryptographic signature', async () => {
    const fake = fakeWallet({
      sign: async (...inputs) => {
        const signed = signedOutput(inputs[0]);
        const transaction = Transaction.from(signed.signedTransaction);
        const signature = transaction.signatures[0]?.signature;
        if (signature === null || signature === undefined)
          throw new Error('missing test signature');
        signature[0] = (signature[0] ?? 0) ^ 1;
        return [
          {
            signedTransaction: Uint8Array.from(
              transaction.serialize({ requireAllSignatures: true, verifySignatures: false }),
            ),
          },
        ];
      },
    });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    await expect(
      executor.signTransaction(transactionRequest(), TEST_ACCOUNT),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('classifies a thrown signing request as a pre-broadcast invalid response', async () => {
    const fake = fakeWallet({
      sign: async () => {
        throw new Error('transport disappeared');
      },
    });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    const error = await executor
      .signTransaction(transactionRequest(), TEST_ACCOUNT)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SolanaPublicTestnetWalletError);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fake.sign).toHaveBeenCalledTimes(1);
  });

  it.each([
    { output: [] as readonly { signedTransaction: Uint8Array }[] },
    { output: [{ signedTransaction: Uint8Array.of(1) }] },
    { output: [{ signedTransaction: new Uint8Array(1_233) }] },
    {
      output: [{ signedTransaction: Uint8Array.of(1) }, { signedTransaction: Uint8Array.of(2) }],
    },
  ])('classifies every malformed post-sign output as an invalid response', async ({ output }) => {
    const fake = fakeWallet({ sign: async () => output });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    await expect(
      executor.signTransaction(transactionRequest(), TEST_ACCOUNT),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fake.sign).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicit user rejection retryable because no signature was committed', async () => {
    const fake = fakeWallet({
      sign: async () => {
        throw Object.assign(new Error('rejected'), { code: 4001 });
      },
    });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    await expect(
      executor.signTransaction(transactionRequest(), TEST_ACCOUNT),
    ).rejects.toMatchObject({ code: 'USER_REJECTED' });
  });

  it('preserves Phantom request-pending as a pre-broadcast wallet failure', async () => {
    const fake = fakeWallet({
      sign: async () => {
        throw Object.assign(new Error('request already pending'), { code: -32002 });
      },
    });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));
    await executor.connect();

    await expect(
      executor.signTransaction(transactionRequest(), TEST_ACCOUNT),
    ).rejects.toMatchObject({ code: 'REQUEST_PENDING' });
    expect(fake.sign).toHaveBeenCalledTimes(1);
  });

  it('rejects multiple authorized accounts and never asks for a signature', async () => {
    const secondAddress = new PublicKey(Uint8Array.from({ length: 32 }, () => 44)).toBase58();
    const fake = fakeWallet({ accounts: [account(), account(secondAddress)] });
    const executor = createSolanaPublicTestnetWalletExecutor(selection(fake.wallet));

    await expect(executor.connect()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fake.sign).not.toHaveBeenCalled();
  });
});
