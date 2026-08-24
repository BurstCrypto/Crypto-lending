import { describe, expect, it } from 'vitest';

import {
  parseWalletRosterSnapshot,
  StorageBackedWalletRosterStore,
  walletAddressHint,
  WalletRosterStorageError,
  type WalletRosterKeyValueStorage,
  type WalletRosterSnapshot,
} from '../lib/wallets/wallet-roster-storage';
import { KAN61_SOLANA_CAIP_CHAIN_IDS } from '../lib/wallets/wallet-chain-identity';

const SOLANA_ADDRESS = '7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8';

class FakeStorage implements WalletRosterKeyValueStorage {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('raw storage read error with sensitive vendor detail');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('raw storage write error with sensitive vendor detail');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function snapshot(): WalletRosterSnapshot {
  return {
    version: 1,
    entries: [
      {
        connectionId: 'connection-evm-1',
        connectorId: 'metamask',
        namespace: 'eip155',
        label: 'Treasury wallet',
        selectedAccount: {
          chainId: 'eip155:11155111',
          address: '0xabcd\u2026abcd',
        },
        status: 'verified',
        lifecycleRevision: 3,
        connectedAt: '2026-08-24T12:00:00.000Z',
        updatedAt: '2026-08-24T12:05:00.000Z',
        lastTransition: 'ownership-verified',
      },
      {
        connectionId: 'connection-solana-1',
        connectorId: 'phantom',
        namespace: 'solana',
        label: 'Operations wallet',
        selectedAccount: {
          chainId: KAN61_SOLANA_CAIP_CHAIN_IDS.devnet,
          address: '7Ytt\u2026FrA8',
        },
        status: 'disconnected',
        lifecycleRevision: 4,
        connectedAt: '2026-08-24T12:01:00.000Z',
        updatedAt: '2026-08-24T12:06:00.000Z',
        disconnectedAt: '2026-08-24T12:06:00.000Z',
        lastTransition: 'disconnected',
      },
    ],
  };
}

describe('wallet roster storage', () => {
  it('round-trips two independently labeled wallets using only redacted metadata', () => {
    const storage = new FakeStorage();
    const roster = new StorageBackedWalletRosterStore(storage);

    roster.write(snapshot());

    expect(roster.read()).toEqual(snapshot());
    const persisted = [...storage.values.values()][0] ?? '';
    expect(persisted).toContain('Treasury wallet');
    expect(persisted).not.toContain('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    expect(persisted).not.toMatch(/transportSessionId|signature|provider|error/iu);
  });

  it('creates namespace-aware display hints without changing the source account', () => {
    const evmAccount = {
      chainId: 'eip155:11155111' as const,
      address: '0xABCDEFabcdefabcdefabcdefabcdefabcdefABCD',
    };
    const solanaAccount = {
      chainId: KAN61_SOLANA_CAIP_CHAIN_IDS.devnet,
      address: SOLANA_ADDRESS,
    };

    expect(walletAddressHint(evmAccount)).toBe('0xabcd\u2026abcd');
    expect(walletAddressHint(solanaAccount)).toBe('7Ytt\u2026FrA8');
    expect(evmAccount.address).toBe('0xABCDEFabcdefabcdefabcdefabcdefabcdefABCD');
  });

  it('accepts both KAN-61 Solana identities and rejects every legacy alias', () => {
    const valid = snapshot();
    for (const chainId of Object.values(KAN61_SOLANA_CAIP_CHAIN_IDS)) {
      expect(
        parseWalletRosterSnapshot({
          ...valid,
          entries: [
            {
              ...valid.entries[1],
              selectedAccount: { ...valid.entries[1]?.selectedAccount, chainId },
            },
          ],
        }).entries[0]?.selectedAccount.chainId,
      ).toBe(chainId);
    }

    for (const chainId of ['solana:mainnet', 'solana:devnet', 'solana:testnet'] as const) {
      expect(() =>
        parseWalletRosterSnapshot({
          ...valid,
          entries: [
            {
              ...valid.entries[1],
              selectedAccount: { ...valid.entries[1]?.selectedAccount, chainId },
            },
          ],
        }),
      ).toThrow('wallet roster chainId is unsupported');
      expect(() => walletAddressHint({ chainId, address: SOLANA_ADDRESS })).toThrow(TypeError);
    }
  });

  it('rejects unredacted addresses, unknown fields, duplicates, and inconsistent disconnects', () => {
    const valid = snapshot();
    expect(() =>
      parseWalletRosterSnapshot({
        ...valid,
        entries: [
          {
            ...valid.entries[0],
            selectedAccount: {
              chainId: 'eip155:11155111',
              address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
            },
          },
        ],
      }),
    ).toThrow('address must be redacted');
    expect(() =>
      parseWalletRosterSnapshot({
        ...valid,
        entries: [{ ...valid.entries[0], provider: { secret: true } }],
      }),
    ).toThrow('unexpected fields');
    expect(() =>
      parseWalletRosterSnapshot({
        ...valid,
        entries: [valid.entries[0], { ...valid.entries[0] }],
      }),
    ).toThrow('connection IDs must be unique');
    expect(() =>
      parseWalletRosterSnapshot({
        ...valid,
        entries: [{ ...valid.entries[0], status: 'disconnected' }],
      }),
    ).toThrow('must include its timestamp');
  });

  it('uses one generic error for malformed, oversized, and unavailable storage', () => {
    const storage = new FakeStorage();
    const roster = new StorageBackedWalletRosterStore(storage);
    storage.values.set('crypto-lending.wallet-roster.v1', '{not json');

    expect(() => roster.read()).toThrow(WalletRosterStorageError);
    expect(() => roster.read()).toThrow('wallet roster storage is unavailable');

    storage.values.set('crypto-lending.wallet-roster.v1', 'x'.repeat(32_769));
    expect(() => roster.read()).toThrow(WalletRosterStorageError);

    storage.failReads = true;
    expect(() => roster.read()).toThrow('wallet roster storage is unavailable');

    storage.failReads = false;
    storage.failWrites = true;
    expect(() => roster.write(snapshot())).toThrow('wallet roster storage is unavailable');
  });
});
