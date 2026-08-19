import { SolanaSignIn, SolanaSignMessage } from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, StandardDisconnect, StandardEvents } from '@wallet-standard/features';
import { describe, expect, it, vi } from 'vitest';

import {
  createPhantomSolanaAdapter,
  SOLANA_DEVNET_CHAIN,
  type WalletStandardRegistry,
} from '../src/solana';

const ADDRESS = '11111111111111111111111111111111';

class TestWalletRegistry implements WalletStandardRegistry {
  readonly #listeners = {
    register: new Set<(...wallets: Wallet[]) => void>(),
    unregister: new Set<(...wallets: Wallet[]) => void>(),
  };
  readonly #wallets = new Set<Wallet>();

  constructor(wallets: readonly Wallet[] = []) {
    wallets.forEach((wallet) => this.#wallets.add(wallet));
  }

  get(): readonly Wallet[] {
    return [...this.#wallets];
  }

  on(event: 'register' | 'unregister', listener: (...wallets: Wallet[]) => void): () => void {
    this.#listeners[event].add(listener);
    return () => this.#listeners[event].delete(listener);
  }

  register(wallet: Wallet): () => void {
    this.#wallets.add(wallet);
    this.#listeners.register.forEach((listener) => listener(wallet));
    return () => {
      this.#wallets.delete(wallet);
      this.#listeners.unregister.forEach((listener) => listener(wallet));
    };
  }
}

function account(features: readonly string[] = [SolanaSignIn, SolanaSignMessage]): WalletAccount {
  return {
    address: ADDRESS,
    publicKey: new Uint8Array(32),
    chains: [SOLANA_DEVNET_CHAIN],
    features,
  } as unknown as WalletAccount;
}

function wallet(
  options: {
    readonly name?: string;
    readonly chains?: readonly string[];
    readonly includeSignIn?: boolean;
    readonly includeSignMessage?: boolean;
    readonly connect?: ReturnType<typeof vi.fn>;
  } = {},
): Wallet {
  const walletAccount = account();
  const connect = options.connect ?? vi.fn(async () => ({ accounts: [walletAccount] }));
  const features: Record<string, unknown> = {
    [StandardConnect]: { version: '1.0.0', connect },
    [StandardDisconnect]: { version: '1.0.0', disconnect: vi.fn(async () => undefined) },
    [StandardEvents]: { version: '1.0.0', on: vi.fn(() => () => undefined) },
  };
  if (options.includeSignIn ?? true) {
    features[SolanaSignIn] = { version: '1.0.0', signIn: vi.fn() };
  }
  if (options.includeSignMessage ?? true) {
    features[SolanaSignMessage] = { version: '1.0.0', signMessage: vi.fn() };
  }
  return {
    version: '1.0.0',
    name: options.name ?? 'Phantom',
    icon: 'data:image/svg+xml;base64,',
    chains: options.chains ?? [SOLANA_DEVNET_CHAIN],
    accounts: [],
    features,
  } as unknown as Wallet;
}

describe('Phantom Wallet Standard discovery', () => {
  it('discovers only Phantom wallets advertising devnet and never connects implicitly', () => {
    const connect = vi.fn(async () => ({ accounts: [account()] }));
    const phantom = wallet({ connect });
    const registry = new TestWalletRegistry([
      wallet({ name: 'Another Wallet' }),
      wallet({ chains: ['solana:mainnet'] }),
      phantom,
    ]);

    const adapter = createPhantomSolanaAdapter({ wallets: registry });
    const discovered = adapter.discover();

    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({
      name: 'Phantom',
      chain: SOLANA_DEVNET_CHAIN,
      capabilities: {
        connect: true,
        disconnect: true,
        events: true,
        signIn: true,
        signMessage: true,
        ownership: SolanaSignIn,
      },
    });
    expect(connect).not.toHaveBeenCalled();
    expect(JSON.stringify(discovered)).not.toContain('data:image');
    expect(JSON.stringify(discovered)).not.toContain(ADDRESS);

    adapter.destroy();
  });

  it('tracks late Wallet Standard registration and unregisters exact listeners on destroy', () => {
    const registry = new TestWalletRegistry();
    const adapter = createPhantomSolanaAdapter({ wallets: registry });
    const observed = vi.fn();
    const unsubscribe = adapter.subscribe(observed);
    const unregister = registry.register(wallet());

    expect(adapter.discover()).toHaveLength(1);
    expect(observed).toHaveBeenCalled();

    unregister();
    expect(adapter.discover()).toEqual([]);

    const callsBeforeCleanup = observed.mock.calls.length;
    unsubscribe();
    adapter.destroy();
    registry.register(wallet());
    expect(observed).toHaveBeenCalledTimes(callsBeforeCleanup);
  });

  it('reports sign-message as the ownership fallback when sign-in is absent', () => {
    const registry = new TestWalletRegistry([
      wallet({ includeSignIn: false, includeSignMessage: true }),
    ]);
    const adapter = createPhantomSolanaAdapter({ wallets: registry });

    expect(adapter.discover()[0]?.capabilities).toMatchObject({
      signIn: false,
      signMessage: true,
      ownership: SolanaSignMessage,
    });

    adapter.destroy();
  });
});
