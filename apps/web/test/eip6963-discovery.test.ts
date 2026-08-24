import { describe, expect, it, vi } from 'vitest';

import {
  EIP6963_ANNOUNCE_PROVIDER,
  EIP6963_REQUEST_PROVIDER,
  Eip6963ProviderDiscovery,
} from '@/lib/wallets/eip1193/discovery';
import { KAN61_EVM_TESTNET_CATALOG } from '@/lib/wallets/eip1193/networks';
import type { Eip1193Provider } from '@/lib/wallets/eip1193/provider';

function provider(): Eip1193Provider {
  return {
    request: vi.fn(async () => []),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}

function announce(
  target: EventTarget,
  input: {
    uuid: string;
    rdns: string;
    name?: string;
    provider: Eip1193Provider;
  },
): void {
  target.dispatchEvent(
    new CustomEvent(EIP6963_ANNOUNCE_PROVIDER, {
      detail: {
        info: {
          uuid: input.uuid,
          name: input.name ?? 'untrusted announcement',
          icon: 'data:image/svg+xml,<svg/>',
          rdns: input.rdns,
        },
        provider: input.provider,
      },
    }),
  );
}

describe('Eip6963ProviderDiscovery', () => {
  it('discovers MetaMask and Coinbase independently and requires exact selection', () => {
    const target = new EventTarget();
    const metamask = provider();
    const coinbase = provider();
    target.addEventListener(EIP6963_REQUEST_PROVIDER, () => {
      announce(target, {
        uuid: '11111111-1111-4111-8111-111111111111',
        rdns: 'io.metamask',
        name: 'Coinbase (spoofed label)',
        provider: metamask,
      });
      announce(target, {
        uuid: '22222222-2222-4222-8222-222222222222',
        rdns: 'com.coinbase.wallet',
        provider: coinbase,
      });
    });
    const ids = ['selection-metamask', 'selection-coinbase'];
    const discovery = new Eip6963ProviderDiscovery({
      target,
      supportedNetworks: KAN61_EVM_TESTNET_CATALOG,
      createSelectionId: () => ids.shift()!,
    });

    discovery.start();

    expect(discovery.list()).toEqual([
      expect.objectContaining({
        selectionId: 'selection-metamask',
        connectorId: 'metamask',
        displayName: 'MetaMask',
      }),
      expect.objectContaining({
        selectionId: 'selection-coinbase',
        connectorId: 'coinbase',
        displayName: 'Coinbase Wallet',
      }),
    ]);
    expect(discovery.select('missing')).toBeNull();
    expect(discovery.select('selection-metamask')?.provider).toBe(metamask);
    expect(discovery.select('selection-coinbase')?.provider).toBe(coinbase);
    expect('provider' in discovery.list()[0]!).toBe(false);
  });

  it('ignores unknown, malformed, duplicate UUID, and duplicate provider announcements', () => {
    const target = new EventTarget();
    const selected = provider();
    const discovery = new Eip6963ProviderDiscovery({
      target,
      supportedNetworks: KAN61_EVM_TESTNET_CATALOG,
      createSelectionId: () => 'selection-1',
    });
    discovery.start();

    announce(target, {
      uuid: '11111111-1111-4111-8111-111111111111',
      rdns: 'io.metamask',
      provider: selected,
    });
    announce(target, {
      uuid: '11111111-1111-4111-8111-111111111111',
      rdns: 'com.coinbase.wallet',
      provider: provider(),
    });
    announce(target, {
      uuid: '22222222-2222-4222-8222-222222222222',
      rdns: 'com.coinbase.wallet',
      provider: selected,
    });
    announce(target, {
      uuid: '33333333-3333-4333-8333-333333333333',
      rdns: 'io.phantom',
      provider: provider(),
    });
    announce(target, {
      uuid: 'not-a-uuid',
      rdns: 'io.metamask',
      provider: provider(),
    });

    expect(discovery.list()).toHaveLength(1);
    expect(discovery.select('selection-1')?.provider).toBe(selected);
  });

  it('uses exact listener cleanup, clears capabilities, and contains listener exceptions', () => {
    const target = new EventTarget();
    const discovery = new Eip6963ProviderDiscovery({
      target,
      supportedNetworks: KAN61_EVM_TESTNET_CATALOG,
      createSelectionId: () => 'selection-1',
    });
    const throwingListener = vi.fn(() => {
      throw new Error('consumer detail must not escape');
    });
    const unsubscribe = discovery.subscribe(throwingListener);
    discovery.start();
    announce(target, {
      uuid: '11111111-1111-4111-8111-111111111111',
      rdns: 'io.metamask',
      provider: provider(),
    });

    expect(throwingListener).toHaveBeenCalledOnce();
    discovery.stop();
    expect(discovery.list()).toEqual([]);
    expect(throwingListener).toHaveBeenCalledTimes(2);

    announce(target, {
      uuid: '22222222-2222-4222-8222-222222222222',
      rdns: 'com.coinbase.wallet',
      provider: provider(),
    });
    expect(discovery.list()).toEqual([]);
    unsubscribe();
  });
});
