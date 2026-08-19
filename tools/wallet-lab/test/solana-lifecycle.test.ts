import type { Wallet } from '@wallet-standard/base';
import { describe, expect, it, vi } from 'vitest';

import { createPhantomSolanaAdapterLifecycle, type WalletStandardRegistry } from '../src/solana';

class EmptyWalletRegistry implements WalletStandardRegistry {
  readonly offRegister = vi.fn();
  readonly offUnregister = vi.fn();

  get(): readonly Wallet[] {
    return [];
  }

  on(event: 'register' | 'unregister'): () => void {
    return event === 'register' ? this.offRegister : this.offUnregister;
  }
}

describe('Phantom adapter effect lifecycle', () => {
  it('survives StrictMode cleanup/setup replay without duplicate registry ownership', async () => {
    const registry = new EmptyWalletRegistry();
    const lifecycle = createPhantomSolanaAdapterLifecycle({ wallets: registry });
    const firstSetup = lifecycle.acquire();

    firstSetup.release();
    firstSetup.release();
    const replayedSetup = lifecycle.acquire();
    expect(replayedSetup.adapter).toBe(firstSetup.adapter);

    await Promise.resolve();
    expect(replayedSetup.adapter.discover()).toEqual([]);
    expect(registry.offRegister).not.toHaveBeenCalled();
    expect(registry.offUnregister).not.toHaveBeenCalled();

    replayedSetup.release();
    await Promise.resolve();
    expect(() => replayedSetup.adapter.discover()).toThrowError(
      expect.objectContaining({ code: 'adapter_destroyed' }),
    );
    expect(registry.offRegister).toHaveBeenCalledTimes(1);
    expect(registry.offUnregister).toHaveBeenCalledTimes(1);

    const laterSetup = lifecycle.acquire();
    expect(laterSetup.adapter).not.toBe(replayedSetup.adapter);
    laterSetup.release();
    await Promise.resolve();
  });

  it('supports immediate terminal owner disposal with idempotent lease cleanup', () => {
    const registry = new EmptyWalletRegistry();
    const lifecycle = createPhantomSolanaAdapterLifecycle({ wallets: registry });
    const lease = lifecycle.acquire();

    lifecycle.dispose();
    lifecycle.dispose();
    lease.release();

    expect(registry.offRegister).toHaveBeenCalledTimes(1);
    expect(registry.offUnregister).toHaveBeenCalledTimes(1);
    expect(() => lifecycle.acquire()).toThrowError(
      expect.objectContaining({ code: 'adapter_destroyed' }),
    );
  });
});
