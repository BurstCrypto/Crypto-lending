import type {
  OwnershipChallenge,
  OwnershipSignature,
  UnsubscribeWalletListener,
  WalletAdapter,
  WalletConnectOptions,
  WalletConnection,
  WalletEvent,
  WalletNamespace,
  WalletRestoreOptions,
} from './wallet-adapter';
import type {
  LocalDemoApiClient,
  LocalDemoWalletNamespace,
  LocalDemoWalletProjection,
} from '../local-demo/local-demo-client';

export const LOCAL_DEMO_CONNECTOR_IDS = Object.freeze({
  EVM: 'local-demo-evm',
  SOLANA: 'local-demo-solana',
} as const);

export class LocalDemoWalletAdapterError extends Error {
  constructor() {
    super('Local demo wallet operation failed.');
    this.name = 'LocalDemoWalletAdapterError';
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException('Request aborted', 'AbortError');
}

function walletConnection(
  projection: LocalDemoWalletProjection,
  connectorId: string,
  restored: boolean,
): WalletConnection {
  const account = Object.freeze({ chainId: projection.chainId, address: projection.address });
  return Object.freeze({
    connectionId: projection.connectionId,
    connectorId,
    accounts: Object.freeze([account]),
    approvedScopes: Object.freeze([
      Object.freeze({ chainId: projection.chainId, methods: Object.freeze([]), events: Object.freeze([]) }),
    ]),
    selectedAccount: account,
    restored,
  });
}

/**
 * Local-demo-only adapter. The API completes and verifies the synthetic proof
 * during POST; this adapter never holds a provider, key, challenge, or signature.
 */
export class LocalDemoWalletAdapter implements WalletAdapter {
  readonly connectorId: string;
  readonly namespace: WalletNamespace;
  readonly #listeners = new Set<(event: WalletEvent) => void>();
  #projection: LocalDemoWalletProjection | null;

  constructor(
    readonly demoNamespace: LocalDemoWalletNamespace,
    private readonly client: LocalDemoApiClient,
    initialProjection: LocalDemoWalletProjection | null = null,
  ) {
    this.connectorId = LOCAL_DEMO_CONNECTOR_IDS[demoNamespace];
    this.namespace = demoNamespace === 'EVM' ? 'eip155' : 'solana';
    if (initialProjection !== null && initialProjection.namespace !== demoNamespace) {
      throw new LocalDemoWalletAdapterError();
    }
    this.#projection = initialProjection;
  }

  async connect(options?: WalletConnectOptions): Promise<WalletConnection> {
    throwIfAborted(options?.signal);
    if (this.#projection !== null) return walletConnection(this.#projection, this.connectorId, false);
    const projection = await this.client.registerWallet(this.demoNamespace, options?.signal);
    throwIfAborted(options?.signal);
    this.#projection = projection;
    return walletConnection(projection, this.connectorId, false);
  }

  async restore(options?: WalletRestoreOptions): Promise<WalletConnection | null> {
    throwIfAborted(options?.signal);
    return this.#projection === null
      ? null
      : walletConnection(this.#projection, this.connectorId, true);
  }

  async disconnect(connectionId: string): Promise<void> {
    if (this.#projection === null || this.#projection.connectionId !== connectionId) {
      throw new LocalDemoWalletAdapterError();
    }
    await this.client.disconnectWallet(connectionId);
    this.#projection = null;
  }

  signOwnershipChallenge(
    connectionId: string,
    challenge: OwnershipChallenge,
  ): Promise<OwnershipSignature> {
    void connectionId;
    void challenge;
    return Promise.reject(new LocalDemoWalletAdapterError());
  }

  subscribe(listener: (event: WalletEvent) => void): UnsubscribeWalletListener {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  projectionFor(connectionId: string): LocalDemoWalletProjection | null {
    return this.#projection?.connectionId === connectionId ? this.#projection : null;
  }
}
