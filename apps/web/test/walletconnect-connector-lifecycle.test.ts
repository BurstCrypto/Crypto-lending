import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SiweOwnershipChallenge,
  WalletConnection,
  WalletEvent,
} from '../lib/wallets/wallet-adapter';
import {
  createLocalWalletConnectConnector,
  WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY,
  type WalletConnectLocalConfiguration,
  type WalletConnectPairingAttempt,
  type WalletConnectPairingPresentation,
  type WalletConnectSessionCandidate,
  type WalletConnectSessionRequest,
  type WalletConnectTransport,
  type WalletConnectTransportEvent,
  type WalletConnectTransportFactory,
} from '../lib/wallets/walletconnect-connector';

const NOW = Date.UTC(2026, 7, 24, 18, 0);
const PAIRING_URI = `wc:local-pairing@2?symKey=${'a'.repeat(64)}&relay-protocol=irn`;
const ADDRESS_A = '0x0000000000000000000000000000000000000001';
const ADDRESS_B = '0x0000000000000000000000000000000000000002';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function configuration(
  overrides: Partial<WalletConnectLocalConfiguration> = {},
): WalletConnectLocalConfiguration {
  return {
    mode: 'deterministic-local',
    transportBoundary: WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY,
    connectorId: 'walletconnect',
    namespace: 'eip155',
    approvedChains: ['eip155:11155111', 'eip155:84532'],
    requiredMethods: ['personal_sign'],
    requiredEvents: ['accountsChanged', 'chainChanged'],
    pairingTimeoutMs: 60_000,
    deepLinks: [
      {
        walletId: 'example-wallet',
        baseUrl: 'https://wallet.example/connect',
        pairingUriParameter: 'uri',
      },
    ],
    ...overrides,
  };
}

function session(
  overrides: Partial<WalletConnectSessionCandidate> = {},
): WalletConnectSessionCandidate {
  return {
    topic: 'session-topic-1',
    expiresAtMs: NOW + 60_000,
    namespace: 'eip155',
    chains: ['eip155:11155111', 'eip155:84532'],
    accounts: [`eip155:11155111:${ADDRESS_A}`, `eip155:84532:${ADDRESS_B}`],
    selectedAccount: `eip155:84532:${ADDRESS_B}`,
    methods: ['personal_sign'],
    events: ['accountsChanged', 'chainChanged'],
    ...overrides,
  };
}

function challenge(connection: WalletConnection): SiweOwnershipChallenge {
  return {
    id: 'ownership-challenge-1',
    format: 'siwe',
    chainId: connection.selectedAccount.chainId,
    address: connection.selectedAccount.address,
    message: 'example.test wants you to sign in with your Ethereum account',
    nonce: 'nonce12345678',
    expiresAt: '2026-08-24T18:05:00.000Z',
  };
}

class FakeTransport implements WalletConnectTransport {
  readonly requests: WalletConnectSessionRequest[] = [];
  readonly disconnectTopics: string[] = [];
  readonly signed: Array<{ topic: string; challenge: SiweOwnershipChallenge }> = [];
  readonly listeners = new Set<(event: WalletConnectTransportEvent) => void>();
  pairing = deferred<WalletConnectSessionCandidate>();
  cancel = vi.fn(async () => undefined);
  restoreCandidate: WalletConnectSessionCandidate | null = null;
  connectFailure: unknown = null;
  restoreFailure: unknown = null;
  disconnectFailure: unknown = null;
  signature: unknown = null;

  async connect(request: WalletConnectSessionRequest): Promise<WalletConnectPairingAttempt> {
    this.requests.push(request);
    if (this.connectFailure !== null) throw this.connectFailure;
    return {
      pairingUri: PAIRING_URI,
      expiresAtMs: NOW + 30_000,
      approval: this.pairing.promise,
      cancel: this.cancel,
    };
  }

  async restore(
    request: WalletConnectSessionRequest,
  ): Promise<WalletConnectSessionCandidate | null> {
    this.requests.push(request);
    if (this.restoreFailure !== null) throw this.restoreFailure;
    return this.restoreCandidate;
  }

  async disconnect(topic: string): Promise<void> {
    this.disconnectTopics.push(topic);
    if (this.disconnectFailure !== null) throw this.disconnectFailure;
  }

  async signOwnershipChallenge(
    topic: string,
    issuedChallenge: SiweOwnershipChallenge,
  ): Promise<never> {
    this.signed.push({ topic, challenge: issuedChallenge });
    if (this.signature instanceof Error) throw this.signature;
    if (
      typeof this.signature === 'object' &&
      this.signature !== null &&
      'transportFailure' in this.signature
    ) {
      throw this.signature;
    }
    return this.signature as never;
  }

  subscribe(listener: (event: WalletConnectTransportEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: WalletConnectTransportEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakeFactory implements WalletConnectTransportFactory {
  readonly boundary = WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY;
  creates = 0;

  constructor(readonly transport: FakeTransport) {}

  async create(): Promise<WalletConnectTransport> {
    this.creates += 1;
    return this.transport;
  }
}

class EphemeralPresenter {
  readonly shown: WalletConnectPairingPresentation[] = [];
  active: WalletConnectPairingPresentation | null = null;
  clears = 0;
  showFailure: unknown = null;

  show(presentation: WalletConnectPairingPresentation): void {
    if (this.showFailure !== null) throw this.showFailure;
    this.shown.push(presentation);
    this.active = presentation;
  }

  clear(): void {
    this.clears += 1;
    this.active = null;
  }
}

function fixture(overrides: Partial<WalletConnectLocalConfiguration> = {}) {
  const transport = new FakeTransport();
  const factory = new FakeFactory(transport);
  const presenter = new EphemeralPresenter();
  let connectionSequence = 0;
  const connector = createLocalWalletConnectConnector(configuration(overrides), {
    factory,
    pairingPresenter: presenter,
    now: () => Date.now(),
    createConnectionId: () => `connection-${++connectionSequence}`,
  });
  return { connector, transport, factory, presenter };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function connectFixture(value = session()) {
  const testFixture = fixture();
  const connecting = testFixture.connector.connect();
  await flushMicrotasks();
  testFixture.transport.pairing.resolve(value);
  const connection = await connecting;
  return { ...testFixture, connection };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('local WalletConnect connector lifecycle', () => {
  it('requests only approved capabilities and keeps pairing material ephemeral', async () => {
    const { connector, transport, presenter, factory } = fixture();
    const connecting = connector.connect();
    await flushMicrotasks();

    expect(factory.creates).toBe(1);
    expect(transport.requests).toEqual([
      {
        namespace: 'eip155',
        chains: ['eip155:11155111', 'eip155:84532'],
        methods: ['personal_sign'],
        events: ['accountsChanged', 'chainChanged'],
      },
    ]);
    expect(presenter.active?.qrUri).toBe(PAIRING_URI);
    expect(presenter.active?.deepLinks[0]?.uri).toBe(
      `https://wallet.example/connect?uri=${encodeURIComponent(PAIRING_URI)}`,
    );
    const stateDuringPairing = connector.getState();
    expect(stateDuringPairing).toEqual({
      phase: 'pairing',
      expiresAt: '2026-08-24T18:00:30.000Z',
      deepLinkWalletIds: ['example-wallet'],
    });
    expect(JSON.stringify(stateDuringPairing)).not.toContain(PAIRING_URI);
    expect(JSON.stringify(stateDuringPairing)).not.toContain('symKey');

    transport.pairing.resolve(session());
    const connection = await connecting;

    expect(connection).toMatchObject({
      connectionId: 'connection-1',
      connectorId: 'walletconnect',
      transportSessionId: 'session-topic-1',
      selectedAccount: { chainId: 'eip155:84532', address: ADDRESS_B },
      restored: false,
    });
    expect(connection.selectedAccount).not.toEqual(connection.accounts[0]);
    expect(presenter.active).toBeNull();
    expect(presenter.clears).toBe(1);
    expect(Object.isFrozen(connection)).toBe(true);
    expect(connector.getState()).toEqual({ phase: 'connected', connection });
  });

  it('maps rejection to a fixed error and never propagates secret-bearing transport text', async () => {
    const { connector, transport, presenter } = fixture();
    const connecting = connector.connect();
    await flushMicrotasks();
    transport.pairing.reject({ code: 'USER_REJECTED', message: `rejected ${PAIRING_URI}` });

    let captured: unknown;
    try {
      await connecting;
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({ code: 'USER_REJECTED' });
    expect(String(captured)).toBe('WalletConnectConnectorError: Wallet request was rejected');
    expect(String(captured)).not.toContain(PAIRING_URI);
    expect(transport.cancel).toHaveBeenCalledOnce();
    expect(presenter.active).toBeNull();
    expect(connector.getState()).toEqual({ phase: 'idle' });
  });

  it('cancels and clears pairing on timeout or caller abort', async () => {
    const timed = fixture({ pairingTimeoutMs: 30_000 });
    const timedConnection = timed.connector.connect();
    const timedResult = timedConnection.then(
      () => null,
      (error: unknown) => error,
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(timedResult).resolves.toMatchObject({ code: 'PAIRING_EXPIRED' });
    expect(timed.transport.cancel).toHaveBeenCalledOnce();
    expect(timed.presenter.active).toBeNull();

    vi.setSystemTime(NOW);
    const aborted = fixture();
    const controller = new AbortController();
    const abortedConnection = aborted.connector.connect({ signal: controller.signal });
    const abortedResult = abortedConnection.then(
      () => null,
      (error: unknown) => error,
    );
    await flushMicrotasks();
    controller.abort();
    await expect(abortedResult).resolves.toMatchObject({ code: 'ABORTED' });
    expect(aborted.transport.cancel).toHaveBeenCalledOnce();
    expect(aborted.presenter.active).toBeNull();
  });

  it('blocks concurrent connect and restore before the factory resolves pairing', async () => {
    const { connector, transport } = fixture();
    const first = connector.connect();

    await expect(connector.connect()).rejects.toMatchObject({ code: 'CONNECTOR_BUSY' });
    await expect(connector.restore()).rejects.toMatchObject({ code: 'CONNECTOR_BUSY' });

    await flushMicrotasks();
    transport.pairing.resolve(session());
    await first;
  });

  it.each([
    ['wrong namespace', session({ namespace: 'solana' as never }), 'SESSION_INVALID'],
    ['unapproved chain', session({ chains: ['eip155:1'] }), 'SESSION_INVALID'],
    ['missing method', session({ methods: ['eth_signTypedData_v4'] }), 'SESSION_INVALID'],
    [
      'extra capability',
      session({ methods: ['personal_sign', 'eth_sendTransaction'] }),
      'SESSION_INVALID',
    ],
    [
      'unselected account',
      session({ selectedAccount: `eip155:84532:${ADDRESS_A}` }),
      'SESSION_INVALID',
    ],
    ['expired session', session({ expiresAtMs: NOW }), 'SESSION_EXPIRED'],
  ])('fails closed for %s approval', async (_label, candidate, expectedCode) => {
    const { connector, transport, presenter } = fixture();
    const connecting = connector.connect();
    await flushMicrotasks();
    transport.pairing.resolve(candidate as WalletConnectSessionCandidate);

    await expect(connecting).rejects.toMatchObject({ code: expectedCode });
    expect(transport.cancel).toHaveBeenCalledOnce();
    expect(presenter.active).toBeNull();
    expect(connector.getState()).toEqual({ phase: 'idle' });
  });

  it('restores a valid unexpired session without presenting a pairing URI', async () => {
    const { connector, transport, presenter, factory } = fixture();
    transport.restoreCandidate = session();

    const restored = await connector.restore();

    expect(restored).toMatchObject({ connectionId: 'connection-1', restored: true });
    expect(presenter.shown).toEqual([]);
    expect(factory.creates).toBe(1);
    expect(connector.getState()).toEqual({ phase: 'connected', connection: restored });
  });

  it('returns null for no restored session and rejects an expired restored session', async () => {
    const absent = fixture();
    await expect(absent.connector.restore()).resolves.toBeNull();
    expect(absent.connector.getState()).toEqual({ phase: 'idle' });

    const expired = fixture();
    expired.transport.restoreCandidate = session({ expiresAtMs: NOW });
    await expect(expired.connector.restore()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(expired.connector.getState()).toEqual({ phase: 'idle' });
  });

  it('normalizes session, account, and chain updates without changing application identity', async () => {
    const { connector, transport, connection } = await connectFixture();
    const events: WalletEvent[] = [];
    connector.subscribe((event) => events.push(event));

    const updatedSession = session({
      accounts: [`eip155:11155111:${ADDRESS_A}`],
      selectedAccount: `eip155:11155111:${ADDRESS_A}`,
      chains: ['eip155:11155111'],
      expiresAtMs: NOW + 120_000,
    });
    transport.emit({
      type: 'sessionUpdated',
      topic: 'session-topic-1',
      session: updatedSession,
    });
    transport.emit({
      type: 'chainChanged',
      topic: 'session-topic-1',
      session: updatedSession,
    });
    transport.emit({
      type: 'accountsChanged',
      topic: 'session-topic-1',
      session: updatedSession,
    });

    expect(events).toHaveLength(3);
    for (const event of events) {
      if ('connection' in event && event.connection !== null) {
        expect(event.connection.connectionId).toBe(connection.connectionId);
        expect(event.connection.selectedAccount).toEqual({
          chainId: 'eip155:11155111',
          address: ADDRESS_A,
        });
      }
    }
    expect(connector.getState()).toMatchObject({
      phase: 'connected',
      connection: { connectionId: connection.connectionId },
    });
  });

  it('handles empty accounts, disconnect, and expiry as terminal lifecycle events', async () => {
    const empty = await connectFixture();
    const emptyEvents: WalletEvent[] = [];
    empty.connector.subscribe((event) => emptyEvents.push(event));
    empty.transport.emit({
      type: 'accountsChanged',
      topic: 'session-topic-1',
      session: null,
    });
    expect(emptyEvents).toEqual([
      {
        type: 'accountsChanged',
        connectionId: empty.connection.connectionId,
        connectorId: 'walletconnect',
        connection: null,
      },
    ]);
    expect(empty.connector.getState()).toEqual({ phase: 'idle' });

    const disconnected = await connectFixture();
    const disconnectEvents: WalletEvent[] = [];
    disconnected.connector.subscribe((event) => disconnectEvents.push(event));
    disconnected.transport.emit({ type: 'disconnect', topic: 'session-topic-1' });
    expect(disconnectEvents[0]).toMatchObject({
      type: 'disconnect',
      connectionId: disconnected.connection.connectionId,
      error: { code: 'DISCONNECTED' },
    });

    const expired = await connectFixture(session({ expiresAtMs: NOW + 5_000 }));
    const expiryEvents: WalletEvent[] = [];
    expired.connector.subscribe((event) => expiryEvents.push(event));
    await vi.advanceTimersByTimeAsync(5_001);
    expect(expiryEvents).toEqual([
      expect.objectContaining({
        type: 'sessionExpired',
        connectionId: expired.connection.connectionId,
        error: expect.objectContaining({ code: 'SESSION_EXPIRED' }),
      }),
    ]);
    expect(expired.connector.getState()).toEqual({ phase: 'idle' });
  });

  it('invalidates an adversarial session update with no raw values in the event', async () => {
    const { connector, transport } = await connectFixture();
    const events: WalletEvent[] = [];
    connector.subscribe((event) => events.push(event));
    const secret = 'do-not-log-session-secret';

    transport.emit({
      type: 'sessionUpdated',
      topic: 'session-topic-1',
      session: { ...session(), methods: [secret] },
    });
    await flushMicrotasks();

    expect(events).toEqual([
      expect.objectContaining({
        type: 'disconnect',
        error: expect.objectContaining({ code: 'SESSION_INVALID' }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(transport.disconnectTopics).toContain('session-topic-1');
    expect(connector.getState()).toEqual({ phase: 'idle' });
  });

  it('disconnects locally once and keeps raw transport failure text contained', async () => {
    const { connector, transport, connection } = await connectFixture();
    const events: WalletEvent[] = [];
    connector.subscribe((event) => events.push(event));
    transport.disconnectFailure = new Error(`relay failure ${PAIRING_URI}`);

    let captured: unknown;
    try {
      await connector.disconnect(connection.connectionId);
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({ code: 'TRANSPORT_UNAVAILABLE' });
    expect(String(captured)).not.toContain(PAIRING_URI);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'disconnect',
        error: expect.objectContaining({ code: 'TRANSPORT_UNAVAILABLE' }),
      }),
    ]);
    expect(connector.getState()).toEqual({ phase: 'idle' });
    await expect(connector.disconnect(connection.connectionId)).rejects.toMatchObject({
      code: 'CONNECTION_NOT_FOUND',
    });
  });

  it('hands the exact server challenge to transport and validates the returned proof', async () => {
    const { connector, transport, connection } = await connectFixture();
    const issuedChallenge = challenge(connection);
    const validSignature = {
      format: 'siwe',
      challengeId: issuedChallenge.id,
      chainId: issuedChallenge.chainId,
      address: issuedChallenge.address,
      signature: '0xdeterministic-signature',
    };
    transport.signature = validSignature;

    await expect(
      connector.signOwnershipChallenge(connection.connectionId, issuedChallenge),
    ).resolves.toEqual(transport.signature);
    expect(transport.signed).toEqual([{ topic: 'session-topic-1', challenge: issuedChallenge }]);

    transport.signature = {
      ...validSignature,
      challengeId: 'wrong-challenge',
    };
    await expect(
      connector.signOwnershipChallenge(connection.connectionId, issuedChallenge),
    ).rejects.toMatchObject({ code: 'OWNERSHIP_INVALID' });
  });

  it('rejects a challenge for a non-selected account before invoking transport', async () => {
    const { connector, transport, connection } = await connectFixture();
    const wrongChallenge = {
      ...challenge(connection),
      chainId: 'eip155:11155111' as const,
      address: ADDRESS_A,
    };

    await expect(
      connector.signOwnershipChallenge(connection.connectionId, wrongChallenge),
    ).rejects.toThrow('selected wallet account');
    expect(transport.signed).toEqual([]);
  });

  it('isolates listener and presenter failures without retaining pairing material', async () => {
    const presenterFailure = fixture();
    presenterFailure.presenter.showFailure = new Error(`render failed ${PAIRING_URI}`);
    let captured: unknown;
    try {
      await presenterFailure.connector.connect();
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({ code: 'TRANSPORT_UNAVAILABLE' });
    expect(String(captured)).not.toContain(PAIRING_URI);
    expect(presenterFailure.transport.cancel).toHaveBeenCalledOnce();
    expect(presenterFailure.presenter.active).toBeNull();

    const connected = await connectFixture();
    const observed: WalletEvent[] = [];
    connected.connector.subscribe(() => {
      throw new Error('listener-private-value');
    });
    connected.connector.subscribe((event) => observed.push(event));
    connected.transport.emit({ type: 'sessionExpired', topic: 'session-topic-1' });
    expect(observed).toHaveLength(1);
  });
});
