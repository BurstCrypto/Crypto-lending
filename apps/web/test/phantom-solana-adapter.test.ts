import { describe, expect, it, vi } from 'vitest';

import {
  createPhantomSolanaAdapter,
  discoverInjectedPhantomSolanaProvider,
  PhantomSolanaAdapterError,
} from '../lib/wallets/phantom-solana-adapter';
import {
  toSolanaEd25519OwnershipProofWire,
  type SiwsMessageOwnershipChallenge,
  type SiwsSignInOwnershipChallenge,
  type WalletEvent,
} from '../lib/wallets/wallet-adapter';
import {
  KAN61_SOLANA_COMPATIBILITY_NETWORKS,
  SOLANA_CAIP_CHAIN_IDS,
  SOLANA_WALLET_STANDARD_CHAINS,
} from '../lib/wallets/solana/compatibility-network-catalog';

const ADDRESS_A = '11111111111111111111111111111112';
const ADDRESS_B = '11111111111111111111111111111113';
const PUBLIC_KEY_A = new Uint8Array([...new Uint8Array(31), 1]);
const PUBLIC_KEY_B = new Uint8Array([...new Uint8Array(31), 2]);

function publicKey(address: string) {
  return Object.freeze({ toBase58: () => address });
}

interface FakeProviderOptions {
  readonly address?: string;
  readonly connectResult?: unknown;
  readonly structuredSignIn?: boolean;
}

function fakeProvider(options: FakeProviderOptions = {}) {
  const listeners = new Map<string, Set<(value?: unknown) => void>>();
  const address = options.address ?? ADDRESS_A;
  const provider = {
    isPhantom: true,
    publicKey: publicKey(address),
    connect: vi.fn(async (connectOptions?: unknown) => {
      void connectOptions;
      return options.connectResult === undefined
        ? { publicKey: publicKey(address) }
        : options.connectResult;
    }),
    disconnect: vi.fn(async () => undefined),
    signMessage: vi.fn(async (message: Uint8Array, display: string) => {
      void message;
      void display;
      return {
        publicKey: publicKey(address),
        signature: new Uint8Array(64).fill(7),
      };
    }),
    on: vi.fn((event: string, listener: (value?: unknown) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    off: vi.fn((event: string, listener: (value?: unknown) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emit(event: string, value?: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(value);
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
    ...(options.structuredSignIn === false
      ? {}
      : {
          signIn: vi.fn(async (input: unknown) => {
            void input;
            return {
              account: { address, publicKey: new Uint8Array(PUBLIC_KEY_A) },
              signedMessage: new TextEncoder().encode('wallet-constructed SIWS'),
              signature: new Uint8Array(64).fill(9),
              signatureType: 'ed25519',
            };
          }),
        }),
  };
  return provider;
}

function adapter(provider: ReturnType<typeof fakeProvider>, id = 'phantom:test-connection') {
  return createPhantomSolanaAdapter({
    network: KAN61_SOLANA_COMPATIBILITY_NETWORKS[1],
    getProvider: () => provider,
    createConnectionId: () => id,
  });
}

function messageChallenge(
  overrides: Partial<SiwsMessageOwnershipChallenge> = {},
): SiwsMessageOwnershipChallenge {
  return {
    id: '00000000-0000-4000-8000-000000000059',
    format: 'siws-message',
    chainId: SOLANA_CAIP_CHAIN_IDS.devnet,
    address: ADDRESS_A,
    nonce: 'phantom123456',
    expiresAt: '2026-08-24T21:05:00.000Z',
    message: 'exact canonical server-issued SIWS message',
    ...overrides,
  };
}

function signInChallenge(
  overrides: Partial<SiwsSignInOwnershipChallenge> = {},
): SiwsSignInOwnershipChallenge {
  return {
    id: '00000000-0000-4000-8000-000000000060',
    format: 'siws-sign-in',
    chainId: SOLANA_CAIP_CHAIN_IDS.devnet,
    address: ADDRESS_A,
    nonce: 'phantom654321',
    expiresAt: '2026-08-24T21:05:00.000Z',
    input: {
      domain: 'example.test',
      address: ADDRESS_A,
      statement: 'Register this wallet only',
      uri: 'https://example.test/wallets',
      version: '1',
      chainId: SOLANA_WALLET_STANDARD_CHAINS.devnet,
      nonce: 'phantom654321',
      issuedAt: '2026-08-24T21:00:00.000Z',
      expirationTime: '2026-08-24T21:05:00.000Z',
      notBefore: '2026-08-24T21:00:00.000Z',
      requestId: '00000000-0000-4000-8000-000000000060',
      resources: ['https://example.test/policies/wallet-registration'],
    },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('Phantom Solana adapter', () => {
  it('discovers only explicit Phantom injection in a secure top-level context', () => {
    const provider = fakeProvider();
    const context: Record<string, unknown> = { isSecureContext: true };
    context.self = context;
    context.top = context;
    context.phantom = { solana: provider };
    const legacyGetter = vi.fn(() => provider);
    Object.defineProperty(context, 'solana', { get: legacyGetter });

    expect(discoverInjectedPhantomSolanaProvider(context)).toBe(provider);
    expect(legacyGetter).not.toHaveBeenCalled();
    expect(
      discoverInjectedPhantomSolanaProvider({ ...context, isSecureContext: false }),
    ).toBeNull();
    expect(discoverInjectedPhantomSolanaProvider({ ...context, top: {} })).toBeNull();
    expect(
      discoverInjectedPhantomSolanaProvider({
        ...context,
        phantom: { solana: { ...provider, isPhantom: false } },
      }),
    ).toBeNull();
  });

  it('fails closed on hostile injection accessors and incomplete providers', () => {
    const context: Record<string, unknown> = { isSecureContext: true };
    context.self = context;
    context.top = context;
    Object.defineProperty(context, 'phantom', {
      get() {
        throw new Error('private provider detail');
      },
    });

    expect(discoverInjectedPhantomSolanaProvider(context)).toBeNull();
    expect(
      discoverInjectedPhantomSolanaProvider({
        isSecureContext: true,
        self: context,
        top: context,
        phantom: { solana: { isPhantom: true } },
      }),
    ).toBeNull();
  });

  it('normalizes one canonical connection and prevents duplicate connects', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);

    const first = await wallet.connect();
    const duplicate = await wallet.connect();

    expect(duplicate).toBe(first);
    expect(provider.connect).toHaveBeenCalledTimes(1);
    expect(provider.connect).toHaveBeenCalledWith(undefined);
    expect(first).toEqual({
      connectionId: 'phantom:test-connection',
      connectorId: 'phantom',
      accounts: [{ chainId: SOLANA_CAIP_CHAIN_IDS.devnet, address: ADDRESS_A }],
      approvedScopes: [
        {
          chainId: SOLANA_CAIP_CHAIN_IDS.devnet,
          methods: ['solana:signMessage', 'solana:signIn'],
          events: ['accountChanged', 'disconnect'],
        },
      ],
      selectedAccount: { chainId: SOLANA_CAIP_CHAIN_IDS.devnet, address: ADDRESS_A },
      restored: false,
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.accounts)).toBe(true);
  });

  it('coalesces concurrent connect attempts into one provider prompt and identity', async () => {
    const provider = fakeProvider();
    const pending = deferred<{ publicKey: ReturnType<typeof publicKey> }>();
    provider.connect.mockImplementation(async () => pending.promise);
    const wallet = adapter(provider);

    const first = wallet.connect();
    const second = wallet.connect();
    pending.resolve({ publicKey: publicKey(ADDRESS_A) });

    await expect(first).resolves.toBe(await second);
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a connection if the provider disconnects while listeners bind', async () => {
    const provider = fakeProvider();
    const originalOn = provider.on.getMockImplementation();
    if (originalOn === undefined) throw new Error('expected provider event fake');
    provider.on.mockImplementation((event, listener) => {
      originalOn(event, listener);
      if (event === 'disconnect') listener({ code: 4900 });
    });
    const wallet = adapter(provider);

    await expect(wallet.connect()).rejects.toMatchObject({ code: 'PROVIDER_DISCONNECTED' });
    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(provider.listenerCount('accountChanged')).toBe(0);
    expect(provider.listenerCount('disconnect')).toBe(0);
  });

  it('attempts exact cleanup when an event registration throws after attaching', async () => {
    const provider = fakeProvider();
    const originalOn = provider.on.getMockImplementation();
    if (originalOn === undefined) throw new Error('expected provider event fake');
    provider.on.mockImplementation((event, listener) => {
      originalOn(event, listener);
      if (event === 'disconnect') throw new Error('provider event registration failed');
    });

    await expect(adapter(provider).connect()).rejects.toMatchObject({ code: 'PROVIDER_INVALID' });
    expect(provider.off).toHaveBeenCalledTimes(2);
    expect(provider.listenerCount('accountChanged')).toBe(0);
    expect(provider.listenerCount('disconnect')).toBe(0);
    expect(provider.disconnect).toHaveBeenCalledTimes(1);
  });

  it('restores only through a trusted non-interactive provider attempt', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);

    const restored = await wallet.restore();

    expect(restored?.restored).toBe(true);
    expect(provider.connect).toHaveBeenCalledWith({ onlyIfTrusted: true });

    const rejectedProvider = fakeProvider();
    rejectedProvider.connect.mockRejectedValue({ code: 4001, message: 'sensitive rejection' });
    await expect(adapter(rejectedProvider).restore()).resolves.toBeNull();
  });

  it('rejects aliases and mismatched explicit provider cluster claims', async () => {
    expect(() =>
      createPhantomSolanaAdapter({
        network: {
          chainId: 'solana:devnet' as never,
          walletStandardChain: SOLANA_WALLET_STANDARD_CHAINS.devnet,
        },
        getProvider: () => fakeProvider(),
      }),
    ).toThrow('canonical CAIP identifier');

    const provider = fakeProvider({
      connectResult: {
        chainId: SOLANA_WALLET_STANDARD_CHAINS.mainnet,
        publicKey: publicKey(ADDRESS_A),
      },
    });
    const pendingDisconnect = deferred<undefined>();
    provider.disconnect.mockImplementationOnce(async () => pendingDisconnect.promise);
    await expect(adapter(provider).connect()).rejects.toMatchObject({ code: 'WRONG_CLUSTER' });
    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(provider.on).not.toHaveBeenCalled();
    pendingDisconnect.resolve(undefined);
  });

  it('accepts a matching Wallet Standard account claim and rejects ambiguous accounts', async () => {
    const provider = fakeProvider({
      connectResult: {
        accounts: [
          {
            address: ADDRESS_A,
            publicKey: PUBLIC_KEY_A,
            chains: [SOLANA_WALLET_STANDARD_CHAINS.devnet],
          },
        ],
      },
    });
    await expect(adapter(provider).connect()).resolves.toMatchObject({
      selectedAccount: { address: ADDRESS_A },
    });

    const ambiguous = fakeProvider({
      connectResult: {
        accounts: [
          { address: ADDRESS_A, publicKey: PUBLIC_KEY_A },
          { address: ADDRESS_B, publicKey: PUBLIC_KEY_B },
        ],
      },
    });
    await expect(adapter(ambiguous).connect()).rejects.toMatchObject({ code: 'ACCOUNT_INVALID' });
  });

  it('normalizes account changes under the same connection and invalidates empty state', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const events: WalletEvent[] = [];
    wallet.subscribe((event) => events.push(event));

    provider.emit('accountChanged', publicKey(ADDRESS_B));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'accountsChanged',
      connectionId: connection.connectionId,
      connectorId: 'phantom',
      connection: { selectedAccount: { address: ADDRESS_B } },
    });

    provider.emit('accountChanged', null);
    expect(events[1]).toEqual({
      type: 'accountsChanged',
      connectionId: connection.connectionId,
      connectorId: 'phantom',
      connection: null,
    });
    expect(provider.listenerCount('accountChanged')).toBe(0);
    expect(provider.listenerCount('disconnect')).toBe(0);
    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, messageChallenge()),
    ).rejects.toMatchObject({ code: 'CONNECTION_NOT_FOUND' });
  });

  it('fails closed and emits a redacted disconnect for an invalid account event', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const events: WalletEvent[] = [];
    wallet.subscribe((event) => events.push(event));

    provider.emit('accountChanged', publicKey('not-a-public-key'));

    expect(events).toEqual([
      {
        type: 'disconnect',
        connectionId: connection.connectionId,
        connectorId: 'phantom',
        error: {
          code: 'ACCOUNT_INVALID',
          message: 'Wallet account state is invalid',
          recoverable: false,
        },
      },
    ]);
  });

  it('cleans up exact listeners and local authorization on explicit disconnect', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const events: WalletEvent[] = [];
    const unsubscribe = wallet.subscribe((event) => events.push(event));

    await expect(wallet.disconnect('another-connection')).rejects.toMatchObject({
      code: 'CONNECTION_NOT_FOUND',
    });
    await wallet.disconnect(connection.connectionId);
    unsubscribe();
    unsubscribe();

    expect(provider.disconnect).toHaveBeenCalledTimes(1);
    expect(provider.off).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      {
        type: 'disconnect',
        connectionId: connection.connectionId,
        connectorId: 'phantom',
      },
    ]);
  });

  it('never reuses an application connection ID after disconnect', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider, 'phantom:reused-id');
    const connection = await wallet.connect();
    await wallet.disconnect(connection.connectionId);

    await expect(wallet.connect()).rejects.toMatchObject({ code: 'PROVIDER_INVALID' });
    expect(provider.connect).toHaveBeenCalledTimes(2);
    expect(provider.disconnect).toHaveBeenCalledTimes(2);
  });

  it('handles provider disconnect without exposing provider-controlled details', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const events: WalletEvent[] = [];
    wallet.subscribe((event) => events.push(event));

    provider.emit('disconnect', {
      code: 4900,
      message: 'token=provider-secret should never escape',
      response: { raw: 'provider-secret' },
    });

    expect(events).toEqual([
      {
        type: 'disconnect',
        connectionId: connection.connectionId,
        connectorId: 'phantom',
        error: {
          code: 'PROVIDER_DISCONNECTED',
          message: 'Wallet provider disconnected',
          recoverable: true,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('provider-secret');
  });

  it('signs the exact canonical SIWS bytes and translates them to KAN-56', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const challenge = messageChallenge();

    const signed = await wallet.signOwnershipChallenge(connection.connectionId, challenge);

    expect(provider.signMessage).toHaveBeenCalledTimes(1);
    const [providerMessage, display] = provider.signMessage.mock.calls[0] ?? [];
    expect(providerMessage).toEqual(new TextEncoder().encode(challenge.message));
    expect(display).toBe('utf8');
    expect(signed).toMatchObject({
      format: 'siws-message',
      challengeId: challenge.id,
      chainId: SOLANA_CAIP_CHAIN_IDS.devnet,
      address: ADDRESS_A,
      signatureType: 'ed25519',
    });
    expect(toSolanaEd25519OwnershipProofWire(signed, challenge)).toEqual({
      kind: 'SOLANA_ED25519',
      challengeId: challenge.id,
      address: ADDRESS_A,
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE',
      signedMessage: 'ZXhhY3QgY2Fub25pY2FsIHNlcnZlci1pc3N1ZWQgU0lXUyBtZXNzYWdl',
      signature:
        'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw',
    });
  });

  it('rejects wrong-cluster and wrong-account challenges before prompting', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();

    await expect(
      wallet.signOwnershipChallenge(
        connection.connectionId,
        messageChallenge({ chainId: SOLANA_CAIP_CHAIN_IDS.mainnet }),
      ),
    ).rejects.toThrow('selected wallet account');
    await expect(
      wallet.signOwnershipChallenge(
        connection.connectionId,
        messageChallenge({ address: ADDRESS_B }),
      ),
    ).rejects.toThrow('selected wallet account');
    expect(provider.signMessage).not.toHaveBeenCalled();
  });

  it('translates a strict structured sign-in result when that capability is approved', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const challenge = signInChallenge();

    const signature = await wallet.signOwnershipChallenge(connection.connectionId, challenge);

    const signIn = provider.signIn;
    if (signIn === undefined) throw new Error('expected structured sign-in fake');
    expect(signIn).toHaveBeenCalledTimes(1);
    const input = signIn.mock.calls[0]?.[0];
    expect(input).toEqual(challenge.input);
    expect(input).not.toBe(challenge.input);
    expect(Object.isFrozen(input)).toBe(true);
    expect(signature).toMatchObject({
      format: 'siws-sign-in',
      challengeId: challenge.id,
      chainId: SOLANA_CAIP_CHAIN_IDS.devnet,
      address: ADDRESS_A,
      account: { address: ADDRESS_A, publicKey: PUBLIC_KEY_A },
      signatureType: 'ed25519',
    });
  });

  it('releases a structured sign-in whose provider never settles and ignores its late result', async () => {
    const provider = fakeProvider();
    const signIn = provider.signIn;
    if (signIn === undefined) throw new Error('expected structured sign-in fake');
    const staleResult = {
      account: { address: ADDRESS_A, publicKey: new Uint8Array(PUBLIC_KEY_A) },
      signedMessage: new TextEncoder().encode('stale wallet-constructed SIWS'),
      signature: new Uint8Array(64).fill(5),
      signatureType: 'ed25519',
    };
    const staleSignature = deferred<typeof staleResult>();
    signIn.mockImplementationOnce(async () => staleSignature.promise);
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const controller = new AbortController();

    const signing = wallet.signOwnershipChallenge(connection.connectionId, signInChallenge(), {
      signal: controller.signal,
    });
    controller.abort();

    await expect(signing).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, signInChallenge()),
    ).resolves.toMatchObject({ format: 'siws-sign-in' });
    staleSignature.resolve(staleResult);
    await Promise.resolve();

    expect(await wallet.connect()).toBe(connection);
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it('rejects a structured sign-in cluster outside its injected network binding', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const challenge = signInChallenge();

    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, {
        ...challenge,
        input: {
          ...challenge.input,
          chainId: SOLANA_WALLET_STANDARD_CHAINS.mainnet,
        },
      }),
    ).rejects.toMatchObject({ code: 'WRONG_CLUSTER' });
    expect(provider.signIn).not.toHaveBeenCalled();
  });

  it('does not advertise or invoke structured sign-in when the provider lacks it', async () => {
    const provider = fakeProvider({ structuredSignIn: false });
    const wallet = adapter(provider);
    const connection = await wallet.connect();

    expect(connection.approvedScopes[0]?.methods).toEqual(['solana:signMessage']);
    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, signInChallenge()),
    ).rejects.toThrow('has not approved solana:signIn');
    expect(provider.signMessage).not.toHaveBeenCalled();
  });

  it('rejects mismatched signing keys and malformed signatures', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    provider.signMessage.mockResolvedValue({
      publicKey: publicKey(ADDRESS_B),
      signature: new Uint8Array(63),
    });

    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, messageChallenge()),
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('discards an in-flight signature after the selected account changes', async () => {
    const provider = fakeProvider();
    const pending = deferred<{
      publicKey: ReturnType<typeof publicKey>;
      signature: Uint8Array<ArrayBuffer>;
    }>();
    provider.signMessage.mockImplementation(async () => pending.promise);
    const wallet = adapter(provider);
    const connection = await wallet.connect();

    const signing = wallet.signOwnershipChallenge(connection.connectionId, messageChallenge());
    provider.emit('accountChanged', publicKey(ADDRESS_B));
    pending.resolve({
      publicKey: publicKey(ADDRESS_A),
      signature: new Uint8Array(64).fill(1),
    });

    await expect(signing).rejects.toMatchObject({ code: 'CONNECTION_NOT_FOUND' });
  });

  it('releases a signature whose provider never settles and ignores its late result', async () => {
    const provider = fakeProvider();
    const staleSignature = deferred<{
      publicKey: ReturnType<typeof publicKey>;
      signature: Uint8Array<ArrayBuffer>;
    }>();
    provider.signMessage.mockImplementationOnce(async () => staleSignature.promise);
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const controller = new AbortController();

    const signing = wallet.signOwnershipChallenge(connection.connectionId, messageChallenge(), {
      signal: controller.signal,
    });
    controller.abort();

    await expect(signing).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(
      wallet.signOwnershipChallenge(connection.connectionId, messageChallenge()),
    ).resolves.toMatchObject({ format: 'siws-message' });
    staleSignature.resolve({
      publicKey: publicKey(ADDRESS_A),
      signature: new Uint8Array(64).fill(1),
    });
    await Promise.resolve();

    expect(await wallet.connect()).toBe(connection);
    expect(provider.signMessage).toHaveBeenCalledTimes(2);
  });

  it('never reads or retains provider error messages, causes, or payloads', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    const connection = await wallet.connect();
    const messageGetter = vi.fn(() => 'private-key=provider-controlled-secret');
    const providerError: Record<string, unknown> = { code: 'UNKNOWN_PROVIDER_ERROR' };
    Object.defineProperty(providerError, 'message', { get: messageGetter });
    providerError.cause = { response: 'provider-controlled-secret' };
    provider.signMessage.mockRejectedValue(providerError);

    let failure: unknown;
    try {
      await wallet.signOwnershipChallenge(connection.connectionId, messageChallenge());
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(PhantomSolanaAdapterError);
    expect(failure).toMatchObject({
      code: 'PROVIDER_FAILURE',
      message: 'Wallet provider operation failed',
      recoverable: true,
    });
    expect(messageGetter).not.toHaveBeenCalled();
    expect(JSON.stringify(failure)).not.toContain('provider-controlled-secret');
  });

  it('releases a connect whose provider never settles and ignores its late result', async () => {
    const provider = fakeProvider();
    const pending = deferred<{ publicKey: ReturnType<typeof publicKey> }>();
    provider.connect.mockImplementationOnce(async () => pending.promise);
    const wallet = adapter(provider);
    const controller = new AbortController();

    const connection = wallet.connect({ signal: controller.signal });
    controller.abort();

    await expect(connection).rejects.toMatchObject({ code: 'ABORTED' });
    const current = await wallet.connect();
    pending.resolve({ publicKey: publicKey(ADDRESS_A) });
    await Promise.resolve();

    expect(await wallet.connect()).toBe(current);
    expect(provider.disconnect).not.toHaveBeenCalled();
    expect(provider.on).toHaveBeenCalledTimes(2);
  });

  it('isolates listener failures from cleanup and remaining subscribers', async () => {
    const provider = fakeProvider();
    const wallet = adapter(provider);
    await wallet.connect();
    const observed: WalletEvent[] = [];
    wallet.subscribe(() => {
      throw new Error('listener failure');
    });
    wallet.subscribe((event) => observed.push(event));

    provider.emit('accountChanged', publicKey(ADDRESS_B));

    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ type: 'accountsChanged' });
  });
});
