import { describe, expect, it } from 'vitest';

import { MultiWalletManager, WalletLifecycleError } from '../lib/wallets/multi-wallet-manager';
import type {
  OwnershipChallenge,
  OwnershipSignature,
  WalletAdapter,
  WalletConnectOptions,
  WalletConnection,
  WalletEvent,
  WalletNamespace,
  WalletRestoreOptions,
} from '../lib/wallets/wallet-adapter';
import {
  parseWalletRosterSnapshot,
  type WalletRosterSnapshot,
  type WalletRosterStore,
} from '../lib/wallets/wallet-roster-storage';

const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_B = '0x2222222222222222222222222222222222222222';
const ADDRESS_C = '0x3333333333333333333333333333333333333333';

function evmConnection(
  connectorId: string,
  connectionId: string,
  address = ADDRESS_A,
  options: { readonly chainId?: `eip155:${string}`; readonly restored?: boolean } = {},
): WalletConnection {
  const chainId = options.chainId ?? 'eip155:11155111';
  return {
    connectionId,
    connectorId,
    transportSessionId: `sensitive-transport-${connectionId}`,
    accounts: [{ chainId, address }],
    approvedScopes: [
      {
        chainId,
        methods: ['personal_sign'],
        events: ['accountsChanged', 'chainChanged', 'disconnect'],
      },
    ],
    selectedAccount: { chainId, address },
    restored: options.restored ?? false,
  };
}

function solanaConnection(
  connectorId: string,
  connectionId: string,
  restored = false,
): WalletConnection {
  const account = {
    chainId: 'solana:devnet' as const,
    address: '11111111111111111111111111111111',
  };
  return {
    connectionId,
    connectorId,
    accounts: [account],
    approvedScopes: [
      {
        chainId: account.chainId,
        methods: ['solana:signIn', 'solana:signMessage'],
        events: ['accountChanged', 'disconnect'],
      },
    ],
    selectedAccount: account,
    restored,
  };
}

function siweChallenge(address = ADDRESS_A): OwnershipChallenge {
  return {
    id: 'challenge-123',
    format: 'siwe',
    chainId: 'eip155:11155111',
    address,
    message: 'example.test wants you to sign in with your Ethereum account',
    nonce: 'nonce12345678',
    expiresAt: '2026-08-24T18:05:00.000Z',
  };
}

function siweSignature(address = ADDRESS_A): OwnershipSignature {
  return {
    challengeId: 'challenge-123',
    format: 'siwe',
    chainId: 'eip155:11155111',
    address,
    signature: '0xlocal-test-signature',
  };
}

class MemoryRosterStore implements WalletRosterStore {
  snapshot: WalletRosterSnapshot | null = null;
  failWrites = false;

  read(): WalletRosterSnapshot | null {
    return this.snapshot === null ? null : parseWalletRosterSnapshot(this.snapshot);
  }

  write(snapshot: WalletRosterSnapshot): void {
    if (this.failWrites) throw new Error('sensitive persistence implementation detail');
    this.snapshot = parseWalletRosterSnapshot(snapshot);
  }

  clear(): void {
    this.snapshot = null;
  }
}

class FakeWalletAdapter implements WalletAdapter {
  readonly listeners = new Set<(event: WalletEvent) => void>();
  readonly connectCalls: (WalletConnectOptions | undefined)[] = [];
  readonly restoreCalls: (WalletRestoreOptions | undefined)[] = [];
  readonly disconnectCalls: string[] = [];
  readonly signCalls: { readonly connectionId: string; readonly challenge: OwnershipChallenge }[] =
    [];
  connectResult: WalletConnection;
  restoreResult: WalletConnection | null = null;
  disconnectFailure: Error | null = null;
  signResult: OwnershipSignature = siweSignature();
  connectImplementation: ((options?: WalletConnectOptions) => Promise<WalletConnection>) | null =
    null;
  signImplementation:
    ((connectionId: string, challenge: OwnershipChallenge) => Promise<OwnershipSignature>) | null =
    null;

  constructor(
    readonly connectorId: string,
    readonly namespace: WalletNamespace,
    connectionId = `connection-${connectorId}`,
    address = ADDRESS_A,
  ) {
    this.connectResult = evmConnection(connectorId, connectionId, address);
  }

  async connect(options?: WalletConnectOptions): Promise<WalletConnection> {
    this.connectCalls.push(options);
    return this.connectImplementation?.(options) ?? this.connectResult;
  }

  async restore(options?: WalletRestoreOptions): Promise<WalletConnection | null> {
    this.restoreCalls.push(options);
    return this.restoreResult;
  }

  async disconnect(connectionId: string): Promise<void> {
    this.disconnectCalls.push(connectionId);
    if (this.disconnectFailure !== null) throw this.disconnectFailure;
  }

  async signOwnershipChallenge(
    connectionId: string,
    challenge: OwnershipChallenge,
  ): Promise<OwnershipSignature> {
    this.signCalls.push({ connectionId, challenge });
    return this.signImplementation?.(connectionId, challenge) ?? this.signResult;
  }

  subscribe(listener: (event: WalletEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: WalletEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function clock(): () => Date {
  let time = Date.parse('2026-08-24T18:00:00.000Z');
  return () => new Date(time++);
}

function manager(
  adapters: readonly WalletAdapter[],
  store = new MemoryRosterStore(),
  now = clock(),
): MultiWalletManager {
  return new MultiWalletManager({ adapters, store, now });
}

describe('multi-wallet manager', () => {
  it('keeps two different wallets independently visible and indexable only after proof', async () => {
    const store = new MemoryRosterStore();
    const metamask = new FakeWalletAdapter('metamask', 'eip155', 'connection-metamask', ADDRESS_A);
    const coinbase = new FakeWalletAdapter('coinbase', 'eip155', 'connection-coinbase', ADDRESS_B);
    const wallets = manager([metamask, coinbase], store);

    const treasury = await wallets.connect('metamask', { label: 'Treasury wallet' });
    const operations = await wallets.connect('coinbase', { label: 'Operations wallet' });

    expect(wallets.getState()).toMatchObject({
      persistenceAvailable: true,
      entries: [
        {
          connectionId: 'connection-metamask',
          label: 'Treasury wallet',
          status: 'reverification-required',
          live: true,
          indexingEnabled: false,
        },
        {
          connectionId: 'connection-coinbase',
          label: 'Operations wallet',
          status: 'reverification-required',
          live: true,
          indexingEnabled: false,
        },
      ],
    });

    wallets.acceptOwnershipVerification(treasury.connectionId, treasury.lifecycleRevision);
    wallets.acceptOwnershipVerification(operations.connectionId, operations.lifecycleRevision);
    expect(wallets.getState().entries.every((entry) => entry.indexingEnabled)).toBe(true);

    const persisted = JSON.stringify(store.snapshot);
    expect(persisted).not.toContain(ADDRESS_A);
    expect(persisted).not.toContain(ADDRESS_B);
    expect(persisted).not.toContain('sensitive-transport');
  });

  it('preserves the two-wallet roster after refresh without reconnecting automatically', async () => {
    const store = new MemoryRosterStore();
    const now = clock();
    const metamask = new FakeWalletAdapter('metamask', 'eip155', 'connection-metamask', ADDRESS_A);
    const coinbase = new FakeWalletAdapter('coinbase', 'eip155', 'connection-coinbase', ADDRESS_B);
    const first = manager([metamask, coinbase], store, now);
    const metamaskEntry = await first.connect('metamask', { label: 'Treasury wallet' });
    await first.connect('coinbase', { label: 'Operations wallet' });
    first.acceptOwnershipVerification(metamaskEntry.connectionId, metamaskEntry.lifecycleRevision);
    first.dispose();

    metamask.restoreResult = evmConnection('metamask', 'connection-metamask', ADDRESS_A, {
      restored: true,
    });
    coinbase.restoreResult = evmConnection('coinbase', 'connection-coinbase', ADDRESS_B, {
      restored: true,
    });
    const refreshed = manager([metamask, coinbase], store, now);

    expect(metamask.connectCalls).toHaveLength(1);
    expect(coinbase.connectCalls).toHaveLength(1);
    expect(metamask.restoreCalls).toHaveLength(0);
    expect(coinbase.restoreCalls).toHaveLength(0);
    expect(refreshed.getState().entries).toHaveLength(2);
    expect(
      refreshed
        .getState()
        .entries.every(
          (entry) => entry.status === 'restore-required' && !entry.live && !entry.indexingEnabled,
        ),
    ).toBe(true);

    const restoredMetaMask = await refreshed.restore('metamask');
    const restoredCoinbase = await refreshed.restore('coinbase');
    expect(restoredMetaMask).toMatchObject({
      connectionId: 'connection-metamask',
      label: 'Treasury wallet',
      status: 'reverification-required',
      indexingEnabled: false,
    });
    expect(restoredCoinbase).toMatchObject({
      connectionId: 'connection-coinbase',
      label: 'Operations wallet',
      status: 'reverification-required',
      indexingEnabled: false,
    });
  });

  it('uses the same lifecycle boundary for a normalized Solana connection', async () => {
    const phantom = new FakeWalletAdapter('phantom', 'solana');
    phantom.connectResult = solanaConnection('phantom', 'connection-phantom');
    const wallets = manager([phantom]);

    const connected = await wallets.connect('phantom', { label: 'Solana wallet' });
    expect(connected).toMatchObject({
      namespace: 'solana',
      selectedAccount: {
        chainId: 'solana:devnet',
        address: '1111\u20261111',
      },
      status: 'reverification-required',
      indexingEnabled: false,
    });
    const target = wallets.getVerificationTarget(connected.connectionId);
    expect(target.account).toEqual({
      chainId: 'solana:devnet',
      address: '11111111111111111111111111111111',
    });
    wallets.acceptOwnershipVerification(connected.connectionId, target.lifecycleRevision);
    expect(wallets.getState().entries[0]?.indexingEnabled).toBe(true);
  });

  it('invalidates verification revisions on account, chain, and session changes', async () => {
    const metamask = new FakeWalletAdapter('metamask', 'eip155');
    const wallets = manager([metamask]);
    const connected = await wallets.connect('metamask');
    wallets.acceptOwnershipVerification(connected.connectionId, connected.lifecycleRevision);
    const originalRevision = connected.lifecycleRevision;

    const accountChanged = evmConnection('metamask', connected.connectionId, ADDRESS_B);
    metamask.emit({
      type: 'accountsChanged',
      connectionId: connected.connectionId,
      connectorId: 'metamask',
      connection: accountChanged,
    });
    let current = wallets.getState().entries[0];
    expect(current).toMatchObject({
      status: 'reverification-required',
      indexingEnabled: false,
      lastTransition: 'account-changed',
      selectedAccount: { address: '0x2222\u20262222' },
    });
    expect(() =>
      wallets.acceptOwnershipVerification(connected.connectionId, originalRevision),
    ).toThrow('wallet ownership verification is stale');

    const chainChanged = evmConnection('metamask', connected.connectionId, ADDRESS_B, {
      chainId: 'eip155:84532',
    });
    metamask.emit({ type: 'chainChanged', connection: chainChanged });
    current = wallets.getState().entries[0];
    expect(current?.lastTransition).toBe('chain-changed');
    const chainRevision = current?.lifecycleRevision ?? 0;

    metamask.emit({ type: 'sessionUpdated', connection: chainChanged });
    current = wallets.getState().entries[0];
    expect(current?.lastTransition).toBe('session-updated');
    expect(current?.lifecycleRevision).toBe(chainRevision + 1);
    expect(current?.indexingEnabled).toBe(false);
  });

  it('stops indexing immediately on disconnect failure while preserving history', async () => {
    const metamask = new FakeWalletAdapter('metamask', 'eip155');
    const wallets = manager([metamask]);
    const connected = await wallets.connect('metamask', { label: 'Historical wallet' });
    wallets.acceptOwnershipVerification(connected.connectionId, connected.lifecycleRevision);
    metamask.disconnectFailure = new Error('secret provider rejection details');

    const disconnecting = wallets.disconnect(connected.connectionId);
    expect(wallets.getState().entries[0]).toMatchObject({
      connectionId: connected.connectionId,
      label: 'Historical wallet',
      status: 'disconnected',
      live: false,
      indexingEnabled: false,
      lastTransition: 'disconnected',
    });
    await expect(disconnecting).rejects.toEqual(
      new WalletLifecycleError('provider-operation-failed'),
    );
    await expect(disconnecting).rejects.not.toThrow('secret provider rejection details');
    expect(wallets.getState().entries).toHaveLength(1);
  });

  it('allows a retained disconnected wallet to be relabeled without reactivating it', async () => {
    const store = new MemoryRosterStore();
    const metamask = new FakeWalletAdapter('metamask', 'eip155');
    const wallets = manager([metamask], store);
    const connected = await wallets.connect('metamask', { label: 'Old label' });
    await wallets.disconnect(connected.connectionId);
    const disconnectedAt = wallets.getState().entries[0]?.disconnectedAt;

    const renamed = wallets.renameWallet(connected.connectionId, 'Archived treasury');

    expect(renamed).toMatchObject({
      label: 'Archived treasury',
      status: 'disconnected',
      live: false,
      indexingEnabled: false,
      disconnectedAt,
    });
    expect(store.read()?.entries[0]).toMatchObject({
      label: 'Archived treasury',
      status: 'disconnected',
      disconnectedAt,
    });
  });

  it('preserves an expired session as history and never stores provider errors', async () => {
    const store = new MemoryRosterStore();
    const metamask = new FakeWalletAdapter('metamask', 'eip155');
    const wallets = manager([metamask], store);
    const connected = await wallets.connect('metamask');
    wallets.acceptOwnershipVerification(connected.connectionId, connected.lifecycleRevision);

    metamask.emit({
      type: 'sessionExpired',
      connectionId: connected.connectionId,
      connectorId: 'metamask',
      error: {
        code: 'SECRET_PROVIDER_CODE',
        message: 'sensitive relay topic and account',
        recoverable: false,
      },
    });

    expect(wallets.getState().entries[0]).toMatchObject({
      status: 'session-expired',
      live: false,
      indexingEnabled: false,
      lastTransition: 'session-expired',
    });
    expect(JSON.stringify(store.snapshot)).not.toMatch(/SECRET_PROVIDER_CODE|sensitive relay/iu);
  });

  it('prevents active connector, account, and stable-ID duplicates', async () => {
    const metamask = new FakeWalletAdapter('metamask', 'eip155', 'connection-shared', ADDRESS_A);
    const coinbase = new FakeWalletAdapter('coinbase', 'eip155', 'connection-coinbase', ADDRESS_A);
    const wallets = manager([metamask, coinbase]);
    await wallets.connect('metamask');

    await expect(wallets.connect('metamask')).rejects.toMatchObject({
      code: 'duplicate-connection',
    });
    expect(metamask.connectCalls).toHaveLength(1);
    await expect(wallets.connect('coinbase')).rejects.toMatchObject({ code: 'duplicate-account' });
    expect(coinbase.disconnectCalls).toEqual(['connection-coinbase']);
    expect(wallets.getState().entries).toHaveLength(1);

    await wallets.disconnect('connection-shared');
    coinbase.connectResult = evmConnection('coinbase', 'connection-shared', ADDRESS_C);
    await expect(wallets.connect('coinbase')).rejects.toMatchObject({
      code: 'duplicate-connection',
    });
    expect(wallets.getState().entries).toHaveLength(1);
  });

  it('isolates malformed events to their adapter-owned connection', async () => {
    const metamask = new FakeWalletAdapter('metamask', 'eip155', 'connection-metamask', ADDRESS_A);
    const coinbase = new FakeWalletAdapter('coinbase', 'eip155', 'connection-coinbase', ADDRESS_B);
    const wallets = manager([metamask, coinbase]);
    const first = await wallets.connect('metamask');
    const second = await wallets.connect('coinbase');
    wallets.acceptOwnershipVerification(first.connectionId, first.lifecycleRevision);
    wallets.acceptOwnershipVerification(second.connectionId, second.lifecycleRevision);

    metamask.emit({
      type: 'accountsChanged',
      connectionId: first.connectionId,
      connectorId: 'coinbase',
      connection: evmConnection('metamask', first.connectionId, ADDRESS_C),
    });

    const byId = new Map(wallets.getState().entries.map((entry) => [entry.connectionId, entry]));
    expect(byId.get(first.connectionId)).toMatchObject({
      status: 'disconnected',
      indexingEnabled: false,
      lastTransition: 'provider-state-invalid',
    });
    expect(byId.get(second.connectionId)).toMatchObject({
      status: 'verified',
      indexingEnabled: true,
    });
  });

  it('binds signatures to the current lifecycle revision and rejects an in-flight stale proof', async () => {
    const store = new MemoryRosterStore();
    const metamask = new FakeWalletAdapter('metamask', 'eip155');
    const wallets = manager([metamask], store);
    const connected = await wallets.connect('metamask');
    let completeSigning: ((signature: OwnershipSignature) => void) | undefined;
    metamask.signImplementation = () =>
      new Promise((resolve) => {
        completeSigning = resolve;
      });

    const signing = wallets.signOwnershipChallenge(connected.connectionId, siweChallenge());
    metamask.emit({
      type: 'sessionUpdated',
      connection: evmConnection('metamask', connected.connectionId),
    });
    completeSigning?.(siweSignature());

    await expect(signing).rejects.toMatchObject({ code: 'verification-stale' });
    expect(wallets.getState().entries[0]?.indexingEnabled).toBe(false);
    expect(JSON.stringify(store.snapshot)).not.toContain('0xlocal-test-signature');
  });

  it('forwards a correlated proof without persisting its challenge or signature', async () => {
    const store = new MemoryRosterStore();
    const metamask = new FakeWalletAdapter('metamask', 'eip155');
    const wallets = manager([metamask], store);
    const connected = await wallets.connect('metamask');

    const signed = await wallets.signOwnershipChallenge(connected.connectionId, siweChallenge());
    expect(signed).toEqual({
      lifecycleRevision: connected.lifecycleRevision,
      signature: siweSignature(),
    });
    wallets.acceptOwnershipVerification(connected.connectionId, signed.lifecycleRevision);
    expect(wallets.getState().entries[0]?.indexingEnabled).toBe(true);
    expect(JSON.stringify(store.snapshot)).not.toMatch(/challenge-123|0xlocal-test-signature/iu);
  });

  it('fails all indexing closed when lifecycle persistence becomes unavailable', async () => {
    const store = new MemoryRosterStore();
    const metamask = new FakeWalletAdapter('metamask', 'eip155', 'connection-metamask', ADDRESS_A);
    const coinbase = new FakeWalletAdapter('coinbase', 'eip155', 'connection-coinbase', ADDRESS_B);
    const wallets = manager([metamask, coinbase], store);
    const first = await wallets.connect('metamask');
    const second = await wallets.connect('coinbase');
    wallets.acceptOwnershipVerification(first.connectionId, first.lifecycleRevision);
    wallets.acceptOwnershipVerification(second.connectionId, second.lifecycleRevision);
    store.failWrites = true;

    metamask.emit({
      type: 'accountsChanged',
      connectionId: first.connectionId,
      connectorId: 'metamask',
      connection: evmConnection('metamask', first.connectionId, ADDRESS_C),
    });

    expect(wallets.getState().persistenceAvailable).toBe(false);
    expect(wallets.getState().entries.every((entry) => !entry.indexingEnabled)).toBe(true);
  });

  it('uses exact listener cleanup and marks a missing restored session disconnected', async () => {
    const store = new MemoryRosterStore();
    const now = clock();
    const metamask = new FakeWalletAdapter('metamask', 'eip155');
    const first = manager([metamask], store, now);
    await first.connect('metamask');
    expect(metamask.listeners.size).toBe(1);
    first.dispose();
    expect(metamask.listeners.size).toBe(0);

    const refreshed = manager([metamask], store, now);
    expect(metamask.listeners.size).toBe(1);
    expect(await refreshed.restore('metamask')).toBeNull();
    expect(refreshed.getState().entries[0]).toMatchObject({
      status: 'disconnected',
      live: false,
      indexingEnabled: false,
    });
  });

  it.each([
    {
      expectedCode: 'manager-disposed',
      endOperation: (wallets: MultiWalletManager): void => {
        wallets.dispose();
      },
    },
    {
      expectedCode: 'operation-aborted',
      endOperation: (_wallets: MultiWalletManager, controller: AbortController): void => {
        controller.abort();
      },
    },
  ] as const)(
    'cleans up a connector that resolves after $expectedCode',
    async ({ expectedCode, endOperation }) => {
      const store = new MemoryRosterStore();
      const metamask = new FakeWalletAdapter('metamask', 'eip155');
      let completeConnect: ((connection: WalletConnection) => void) | undefined;
      metamask.connectImplementation = () =>
        new Promise((resolve) => {
          completeConnect = resolve;
        });
      const wallets = manager([metamask], store);
      const controller = new AbortController();

      const connecting = wallets.connect('metamask', { signal: controller.signal });
      endOperation(wallets, controller);
      completeConnect?.(metamask.connectResult);

      await expect(connecting).rejects.toMatchObject({ code: expectedCode });
      expect(metamask.disconnectCalls).toEqual(['connection-metamask']);
      expect(store.snapshot).toBeNull();
      expect(wallets.getState().entries).toEqual([]);
    },
  );

  it('does not invoke a connector for an operation that is already aborted', async () => {
    const metamask = new FakeWalletAdapter('metamask', 'eip155');
    const wallets = manager([metamask]);
    const controller = new AbortController();
    controller.abort();

    await expect(wallets.connect('metamask', { signal: controller.signal })).rejects.toMatchObject({
      code: 'operation-aborted',
    });
    expect(metamask.connectCalls).toEqual([]);
    expect(metamask.disconnectCalls).toEqual([]);
    expect(wallets.getState().entries).toEqual([]);
  });
});
