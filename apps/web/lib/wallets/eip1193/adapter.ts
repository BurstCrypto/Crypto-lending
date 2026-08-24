import {
  assertOwnershipChallengeTargetsConnection,
  type OwnershipChallenge,
  type OwnershipSignature,
  type UnsubscribeWalletListener,
  type WalletAdapter,
  type WalletConnectOptions,
  type WalletConnection,
  type WalletEvent,
  type WalletProviderError,
  type WalletRestoreOptions,
} from '../wallet-adapter';
import type {
  InjectedEvmConnectorId,
  InjectedProviderDescriptor,
  SelectedEip1193Provider,
} from './discovery';
import { Eip6963ProviderDiscovery } from './discovery';
import {
  findSupportedEvmNetwork,
  parseEip1193ChainId,
  type EvmNetworkDefinition,
} from './networks';
import type { Eip1193Listener, Eip1193Provider } from './provider';

export const INJECTED_EVM_ERROR_CODES = Object.freeze({
  aborted: 'INJECTED_EVM_ABORTED',
  challengeInvalid: 'INJECTED_EVM_CHALLENGE_INVALID',
  challengeReused: 'INJECTED_EVM_CHALLENGE_REUSED',
  connectionChanged: 'INJECTED_EVM_CONNECTION_CHANGED',
  connectionMismatch: 'INJECTED_EVM_CONNECTION_MISMATCH',
  disposed: 'INJECTED_EVM_DISPOSED',
  malformedResponse: 'INJECTED_EVM_MALFORMED_RESPONSE',
  notConnected: 'INJECTED_EVM_NOT_CONNECTED',
  operationPending: 'INJECTED_EVM_OPERATION_PENDING',
  providerDisconnected: 'INJECTED_EVM_PROVIDER_DISCONNECTED',
  providerFailure: 'INJECTED_EVM_PROVIDER_FAILURE',
  providerNotFound: 'INJECTED_EVM_PROVIDER_NOT_FOUND',
  unauthorized: 'INJECTED_EVM_UNAUTHORIZED',
  unsupportedNetwork: 'INJECTED_EVM_UNSUPPORTED_NETWORK',
  userRejected: 'INJECTED_EVM_USER_REJECTED',
} as const);

export type InjectedEvmErrorCode =
  (typeof INJECTED_EVM_ERROR_CODES)[keyof typeof INJECTED_EVM_ERROR_CODES];

const ERROR_MESSAGES: Readonly<Record<InjectedEvmErrorCode, string>> = Object.freeze({
  INJECTED_EVM_ABORTED: 'Injected wallet request cancelled',
  INJECTED_EVM_CHALLENGE_INVALID: 'Wallet ownership challenge is invalid',
  INJECTED_EVM_CHALLENGE_REUSED: 'Wallet ownership challenge requires replacement',
  INJECTED_EVM_CONNECTION_CHANGED: 'Injected wallet connection changed',
  INJECTED_EVM_CONNECTION_MISMATCH: 'Injected wallet connection does not match',
  INJECTED_EVM_DISPOSED: 'Injected wallet connector is unavailable',
  INJECTED_EVM_MALFORMED_RESPONSE: 'Injected wallet returned an invalid response',
  INJECTED_EVM_NOT_CONNECTED: 'Injected wallet is not connected',
  INJECTED_EVM_OPERATION_PENDING: 'Injected wallet request is already pending',
  INJECTED_EVM_PROVIDER_DISCONNECTED: 'Injected wallet provider disconnected',
  INJECTED_EVM_PROVIDER_FAILURE: 'Injected wallet provider request failed',
  INJECTED_EVM_PROVIDER_NOT_FOUND: 'Selected injected wallet is unavailable',
  INJECTED_EVM_UNAUTHORIZED: 'Injected wallet request is unauthorized',
  INJECTED_EVM_UNSUPPORTED_NETWORK: 'Injected wallet network is unsupported',
  INJECTED_EVM_USER_REJECTED: 'Injected wallet request was rejected',
});

const RECOVERABLE_CODES = new Set<InjectedEvmErrorCode>([
  INJECTED_EVM_ERROR_CODES.aborted,
  INJECTED_EVM_ERROR_CODES.challengeReused,
  INJECTED_EVM_ERROR_CODES.connectionChanged,
  INJECTED_EVM_ERROR_CODES.notConnected,
  INJECTED_EVM_ERROR_CODES.operationPending,
  INJECTED_EVM_ERROR_CODES.providerDisconnected,
  INJECTED_EVM_ERROR_CODES.providerFailure,
  INJECTED_EVM_ERROR_CODES.providerNotFound,
  INJECTED_EVM_ERROR_CODES.unauthorized,
  INJECTED_EVM_ERROR_CODES.unsupportedNetwork,
  INJECTED_EVM_ERROR_CODES.userRejected,
]);
const INVALIDATING_OPERATION_ERRORS = new Set<InjectedEvmErrorCode>([
  INJECTED_EVM_ERROR_CODES.connectionChanged,
  INJECTED_EVM_ERROR_CODES.malformedResponse,
  INJECTED_EVM_ERROR_CODES.providerDisconnected,
  INJECTED_EVM_ERROR_CODES.unauthorized,
  INJECTED_EVM_ERROR_CODES.unsupportedNetwork,
]);

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const EVM_SIGNATURE = /^0x[0-9a-fA-F]{130}$/u;
const CONNECTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u;
const MAX_ACCOUNTS = 64;
const MAX_RECORDED_CHALLENGES = 128;
const STABLE_SNAPSHOT_ATTEMPTS = 2;

export class InjectedEvmWalletError extends Error implements WalletProviderError {
  readonly recoverable: boolean;

  constructor(readonly code: InjectedEvmErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'InjectedEvmWalletError';
    this.recoverable = RECOVERABLE_CODES.has(code);
  }
}

function fail(code: InjectedEvmErrorCode): never {
  throw new InjectedEvmWalletError(code);
}

function providerErrorCode(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'code');
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeProviderError(value: unknown): InjectedEvmWalletError {
  if (value instanceof InjectedEvmWalletError) return value;
  switch (providerErrorCode(value)) {
    case 4001:
      return new InjectedEvmWalletError(INJECTED_EVM_ERROR_CODES.userRejected);
    case 4100:
      return new InjectedEvmWalletError(INJECTED_EVM_ERROR_CODES.unauthorized);
    case -32_002:
      return new InjectedEvmWalletError(INJECTED_EVM_ERROR_CODES.operationPending);
    case 4900:
    case 4901:
      return new InjectedEvmWalletError(INJECTED_EVM_ERROR_CODES.providerDisconnected);
    default:
      return new InjectedEvmWalletError(INJECTED_EVM_ERROR_CODES.providerFailure);
  }
}

function publicProviderError(code: InjectedEvmErrorCode): WalletProviderError {
  return Object.freeze({
    code,
    message: ERROR_MESSAGES[code],
    recoverable: RECOVERABLE_CODES.has(code),
  });
}

function parseAccounts(value: unknown, allowEmpty: boolean): readonly string[] {
  try {
    if (
      !Array.isArray(value) ||
      value.length > MAX_ACCOUNTS ||
      (!allowEmpty && value.length === 0)
    ) {
      fail(INJECTED_EVM_ERROR_CODES.malformedResponse);
    }

    const accounts: string[] = [];
    const seen = new Set<string>();
    for (const address of value) {
      if (typeof address !== 'string' || !EVM_ADDRESS.test(address)) {
        fail(INJECTED_EVM_ERROR_CODES.malformedResponse);
      }
      const canonical = address.toLowerCase();
      if (seen.has(canonical)) fail(INJECTED_EVM_ERROR_CODES.malformedResponse);
      seen.add(canonical);
      accounts.push(canonical);
    }
    return Object.freeze(accounts);
  } catch (error) {
    if (error instanceof InjectedEvmWalletError) throw error;
    fail(INJECTED_EVM_ERROR_CODES.malformedResponse);
  }
}

function parseSignature(value: unknown): string {
  if (typeof value !== 'string' || !EVM_SIGNATURE.test(value)) {
    fail(INJECTED_EVM_ERROR_CODES.malformedResponse);
  }
  return value.toLowerCase();
}

function defaultConnectionId(): string {
  return globalThis.crypto.randomUUID();
}

interface ProviderSnapshot {
  readonly network: EvmNetworkDefinition;
  readonly addresses: readonly string[];
}

export interface InjectedEip1193WalletAdapterOptions {
  readonly selection: SelectedEip1193Provider;
  readonly createConnectionId?: () => string;
  readonly now?: () => Date;
}

/**
 * Thin MetaMask/Coinbase injected adapter. It never logs provider values,
 * persists provider capabilities, performs RPC reads, or authorizes funding.
 */
export class InjectedEip1193WalletAdapter implements WalletAdapter {
  readonly connectorId: InjectedEvmConnectorId;
  readonly namespace = 'eip155' as const;
  readonly descriptor: InjectedProviderDescriptor;

  readonly #provider: Eip1193Provider;
  readonly #createConnectionId: () => string;
  readonly #now: () => Date;
  readonly #listeners = new Set<(event: WalletEvent) => void>();
  readonly #consumedChallengeIds: string[] = [];
  #connection: WalletConnection | null = null;
  #lastConnectionId: string | null = null;
  #connectPromise: Promise<WalletConnection> | undefined;
  #restorePromise: Promise<WalletConnection | null> | undefined;
  #signing = false;
  #revision = 0;
  #disposed = false;

  readonly #accountsChanged: Eip1193Listener = () => {
    this.#revision += 1;
    const connection = this.#connection;
    this.#connection = null;
    if (connection !== null) {
      this.#emit(
        Object.freeze({
          type: 'accountsChanged',
          connectionId: connection.connectionId,
          connectorId: this.connectorId,
          connection: null,
        }),
      );
    }
  };

  readonly #chainChanged: Eip1193Listener = (providerChainId) => {
    this.#revision += 1;
    const connection = this.#connection;
    if (connection === null) return;

    const network = findSupportedEvmNetwork(providerChainId, this.descriptor.supportedNetworks);
    if (network === null) {
      this.#connection = null;
      this.#emitDisconnect(connection.connectionId, INJECTED_EVM_ERROR_CODES.unsupportedNetwork);
      return;
    }

    const updated = this.#connectionFor(
      connection.connectionId,
      network,
      connection.accounts.map(({ address }) => address),
      connection.restored,
    );
    this.#connection = updated;
    this.#emit(Object.freeze({ type: 'chainChanged', connection: updated }));
  };

  readonly #providerDisconnected: Eip1193Listener = (providerError) => {
    this.#revision += 1;
    const connection = this.#connection;
    this.#connection = null;
    if (connection !== null) {
      const code =
        providerError === undefined
          ? INJECTED_EVM_ERROR_CODES.providerDisconnected
          : sanitizeProviderError(providerError).code;
      this.#emitDisconnect(connection.connectionId, code);
    }
  };

  constructor(options: InjectedEip1193WalletAdapterOptions) {
    this.connectorId = options.selection.descriptor.connectorId;
    this.descriptor = options.selection.descriptor;
    this.#provider = options.selection.provider;
    this.#createConnectionId = options.createConnectionId ?? defaultConnectionId;
    this.#now = options.now ?? (() => new Date());
    this.#attachProviderListeners();
  }

  currentConnection(): WalletConnection | null {
    return this.#connection;
  }

  async connect(options: WalletConnectOptions = {}): Promise<WalletConnection> {
    this.#assertAvailable();
    if (this.#connection !== null) return this.#connection;
    if (this.#connectPromise !== undefined || this.#restorePromise !== undefined) {
      fail(INJECTED_EVM_ERROR_CODES.operationPending);
    }

    this.#connectPromise = this.#connect(options.signal);
    try {
      return await this.#connectPromise;
    } finally {
      this.#connectPromise = undefined;
    }
  }

  async restore(options: WalletRestoreOptions = {}): Promise<WalletConnection | null> {
    this.#assertAvailable();
    if (this.#connection !== null) return this.#connection;
    if (this.#connectPromise !== undefined || this.#restorePromise !== undefined) {
      fail(INJECTED_EVM_ERROR_CODES.operationPending);
    }

    this.#restorePromise = this.#restore(options.signal);
    try {
      return await this.#restorePromise;
    } finally {
      this.#restorePromise = undefined;
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    this.#assertAvailable();
    const connection = this.#connection;
    if (connection === null) {
      if (connectionId === this.#lastConnectionId) return;
      fail(INJECTED_EVM_ERROR_CODES.notConnected);
    }
    if (connection.connectionId !== connectionId) {
      fail(INJECTED_EVM_ERROR_CODES.connectionMismatch);
    }

    this.#revision += 1;
    this.#connection = null;
    this.#lastConnectionId = connectionId;
    this.#emit(Object.freeze({ type: 'disconnect', connectionId, connectorId: this.connectorId }));
  }

  async signOwnershipChallenge(
    connectionId: string,
    challenge: OwnershipChallenge,
  ): Promise<OwnershipSignature> {
    this.#assertAvailable();
    if (this.#signing) fail(INJECTED_EVM_ERROR_CODES.operationPending);

    const connection = this.#connection;
    if (connection === null) fail(INJECTED_EVM_ERROR_CODES.notConnected);
    if (connection.connectionId !== connectionId) {
      fail(INJECTED_EVM_ERROR_CODES.connectionMismatch);
    }
    try {
      assertOwnershipChallengeTargetsConnection(challenge, connection);
    } catch {
      fail(INJECTED_EVM_ERROR_CODES.challengeInvalid);
    }
    if (challenge.format !== 'siwe' || Date.parse(challenge.expiresAt) <= this.#now().getTime()) {
      fail(INJECTED_EVM_ERROR_CODES.challengeInvalid);
    }
    if (this.#consumedChallengeIds.includes(challenge.id)) {
      fail(INJECTED_EVM_ERROR_CODES.challengeReused);
    }

    this.#signing = true;
    try {
      const before = await this.#readStableSnapshot(false);
      if (before === null || !this.#snapshotMatchesConnection(before, connection)) {
        fail(INJECTED_EVM_ERROR_CODES.connectionChanged);
      }
      const revision = this.#revision;
      const response = await this.#request({
        method: 'personal_sign',
        params: [challenge.message, challenge.address],
      });
      this.#rememberChallenge(challenge.id);
      const signature = parseSignature(response);
      const after = await this.#readStableSnapshot(false);
      if (
        after === null ||
        revision !== this.#revision ||
        this.#connection?.connectionId !== connectionId ||
        !this.#snapshotMatchesConnection(after, connection)
      ) {
        fail(INJECTED_EVM_ERROR_CODES.connectionChanged);
      }
      return Object.freeze({
        format: 'siwe',
        challengeId: challenge.id,
        chainId: challenge.chainId,
        address: challenge.address.toLowerCase(),
        signature,
      });
    } catch (error) {
      this.#invalidateForOperationError(connection, error);
      throw error;
    } finally {
      this.#signing = false;
    }
  }

  subscribe(listener: (event: WalletEvent) => void): UnsubscribeWalletListener {
    this.#assertAvailable();
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  /** Exact provider-listener cleanup for product unmount/logout. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#revision += 1;
    this.#connection = null;
    this.#listeners.clear();
    for (const [event, listener] of this.#providerListeners()) {
      try {
        this.#provider.removeListener(event, listener);
      } catch {
        // Cleanup is best effort; raw provider failures are never surfaced or logged.
      }
    }
  }

  async #connect(signal: AbortSignal | undefined): Promise<WalletConnection> {
    this.#checkAbort(signal);
    await this.#requireSupportedCurrentNetwork(signal);
    const requestedAccounts = await this.#request({ method: 'eth_requestAccounts' }, signal);
    const requestedAddresses = parseAccounts(requestedAccounts, false);
    const snapshot = await this.#readStableSnapshot(false, signal);
    if (
      snapshot === null ||
      snapshot.addresses.length !== requestedAddresses.length ||
      snapshot.addresses.some((address, index) => address !== requestedAddresses[index])
    ) {
      fail(INJECTED_EVM_ERROR_CODES.connectionChanged);
    }
    this.#checkAbort(signal);
    return this.#activate(snapshot, false);
  }

  async #restore(signal: AbortSignal | undefined): Promise<WalletConnection | null> {
    this.#checkAbort(signal);
    const snapshot = await this.#readStableSnapshot(true, signal);
    this.#checkAbort(signal);
    return snapshot === null ? null : this.#activate(snapshot, true);
  }

  #activate(snapshot: ProviderSnapshot, restored: boolean): WalletConnection {
    if (this.#connection !== null) return this.#connection;
    let connectionId: string;
    try {
      connectionId = this.#createConnectionId();
    } catch {
      fail(INJECTED_EVM_ERROR_CODES.providerFailure);
    }
    if (!CONNECTION_ID.test(connectionId) || connectionId === this.#lastConnectionId) {
      fail(INJECTED_EVM_ERROR_CODES.providerFailure);
    }
    const connection = this.#connectionFor(
      connectionId,
      snapshot.network,
      snapshot.addresses,
      restored,
    );
    this.#connection = connection;
    this.#lastConnectionId = connectionId;
    return connection;
  }

  #connectionFor(
    connectionId: string,
    network: EvmNetworkDefinition,
    addresses: readonly string[],
    restored: boolean,
  ): WalletConnection {
    const accounts = Object.freeze(
      addresses.map((address) => Object.freeze({ chainId: network.chainId, address })),
    );
    const selectedAccount = accounts[0];
    if (selectedAccount === undefined) fail(INJECTED_EVM_ERROR_CODES.malformedResponse);
    return Object.freeze({
      connectionId,
      connectorId: this.connectorId,
      accounts,
      approvedScopes: Object.freeze([
        Object.freeze({
          chainId: network.chainId,
          methods: Object.freeze(['personal_sign']),
          events: Object.freeze(['accountsChanged', 'chainChanged', 'disconnect']),
        }),
      ]),
      // EIP-1193 defines the first authorized account as the provider's active account.
      selectedAccount,
      restored,
    });
  }

  async #readStableSnapshot(
    allowEmpty: boolean,
    signal?: AbortSignal,
  ): Promise<ProviderSnapshot | null> {
    for (let attempt = 0; attempt < STABLE_SNAPSHOT_ATTEMPTS; attempt += 1) {
      this.#checkAbort(signal);
      const revision = this.#revision;
      const chainBefore = await this.#request({ method: 'eth_chainId' }, signal);
      const accounts = await this.#request({ method: 'eth_accounts' }, signal);
      const chainAfter = await this.#request({ method: 'eth_chainId' }, signal);
      this.#checkAbort(signal);
      if (revision !== this.#revision || chainBefore !== chainAfter) continue;

      const parsedChainId = parseEip1193ChainId(chainBefore);
      if (parsedChainId === null) fail(INJECTED_EVM_ERROR_CODES.malformedResponse);
      const network = findSupportedEvmNetwork(chainBefore, this.descriptor.supportedNetworks);
      if (network === null) fail(INJECTED_EVM_ERROR_CODES.unsupportedNetwork);
      const addresses = parseAccounts(accounts, allowEmpty);
      if (addresses.length === 0) return null;
      return Object.freeze({ network, addresses });
    }
    fail(INJECTED_EVM_ERROR_CODES.connectionChanged);
  }

  async #request(
    arguments_: { readonly method: string; readonly params?: readonly unknown[] },
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.#checkAbort(signal);
    try {
      const result = await this.#provider.request(arguments_);
      this.#checkAbort(signal);
      return result;
    } catch (error) {
      if (signal?.aborted === true) fail(INJECTED_EVM_ERROR_CODES.aborted);
      throw sanitizeProviderError(error);
    }
  }

  async #requireSupportedCurrentNetwork(signal: AbortSignal | undefined): Promise<void> {
    const providerChainId = await this.#request({ method: 'eth_chainId' }, signal);
    if (parseEip1193ChainId(providerChainId) === null) {
      fail(INJECTED_EVM_ERROR_CODES.malformedResponse);
    }
    if (findSupportedEvmNetwork(providerChainId, this.descriptor.supportedNetworks) === null) {
      fail(INJECTED_EVM_ERROR_CODES.unsupportedNetwork);
    }
  }

  #snapshotMatchesConnection(snapshot: ProviderSnapshot, connection: WalletConnection): boolean {
    return (
      snapshot.network.chainId === connection.selectedAccount.chainId &&
      snapshot.addresses.length === connection.accounts.length &&
      snapshot.addresses.every(
        (address, index) => address === connection.accounts[index]?.address.toLowerCase(),
      )
    );
  }

  #rememberChallenge(challengeId: string): void {
    this.#consumedChallengeIds.push(challengeId);
    if (this.#consumedChallengeIds.length > MAX_RECORDED_CHALLENGES) {
      this.#consumedChallengeIds.shift();
    }
  }

  #invalidateForOperationError(connection: WalletConnection, error: unknown): void {
    if (
      !(error instanceof InjectedEvmWalletError) ||
      !INVALIDATING_OPERATION_ERRORS.has(error.code) ||
      this.#connection?.connectionId !== connection.connectionId
    ) {
      return;
    }
    this.#revision += 1;
    this.#connection = null;
    this.#emitDisconnect(connection.connectionId, error.code);
  }

  #checkAbort(signal: AbortSignal | undefined): void {
    if (signal?.aborted === true) fail(INJECTED_EVM_ERROR_CODES.aborted);
  }

  #assertAvailable(): void {
    if (this.#disposed) fail(INJECTED_EVM_ERROR_CODES.disposed);
  }

  #emitDisconnect(connectionId: string, errorCode: InjectedEvmErrorCode): void {
    this.#emit(
      Object.freeze({
        type: 'disconnect',
        connectionId,
        connectorId: this.connectorId,
        error: publicProviderError(errorCode),
      }),
    );
  }

  #emit(event: WalletEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Consumer failures must not alter wallet lifecycle or reveal provider data.
      }
    }
  }

  #providerListeners(): readonly (readonly [string, Eip1193Listener])[] {
    return [
      ['accountsChanged', this.#accountsChanged],
      ['chainChanged', this.#chainChanged],
      ['disconnect', this.#providerDisconnected],
    ];
  }

  #attachProviderListeners(): void {
    const attached: (readonly [string, Eip1193Listener])[] = [];
    try {
      for (const binding of this.#providerListeners()) {
        this.#provider.on(...binding);
        attached.push(binding);
      }
    } catch {
      for (const binding of attached) {
        try {
          this.#provider.removeListener(...binding);
        } catch {
          // The constructor reports one sanitized failure after attempting cleanup.
        }
      }
      fail(INJECTED_EVM_ERROR_CODES.providerFailure);
    }
  }
}

/**
 * Owns adapter instances so repeating a selection cannot create a second
 * normalized connection to the same announced provider.
 */
export class InjectedEvmConnectorRegistry {
  readonly #adapters = new Map<string, InjectedEip1193WalletAdapter>();

  constructor(
    readonly discovery: Eip6963ProviderDiscovery,
    readonly createConnectionId: () => string = defaultConnectionId,
  ) {}

  select(selectionId: string): InjectedEip1193WalletAdapter {
    const existing = this.#adapters.get(selectionId);
    if (existing !== undefined) return existing;
    const selection = this.discovery.select(selectionId);
    if (selection === null) fail(INJECTED_EVM_ERROR_CODES.providerNotFound);
    const adapter = new InjectedEip1193WalletAdapter({
      selection,
      createConnectionId: this.createConnectionId,
    });
    this.#adapters.set(selectionId, adapter);
    return adapter;
  }

  release(selectionId: string): void {
    const adapter = this.#adapters.get(selectionId);
    if (adapter === undefined) return;
    adapter.dispose();
    this.#adapters.delete(selectionId);
  }

  dispose(): void {
    for (const adapter of this.#adapters.values()) adapter.dispose();
    this.#adapters.clear();
    this.discovery.stop();
  }
}
