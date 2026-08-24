import {
  assertOwnershipChallengeTargetsConnection,
  assertOwnershipSignatureMatchesChallenge,
  assertWalletConnection,
  type OwnershipChallenge,
  type OwnershipSignature,
  type UnsubscribeWalletListener,
  type WalletAccount,
  type WalletAdapter,
  type WalletConnection,
  type WalletEvent,
} from './wallet-adapter';
import {
  MAX_WALLET_ROSTER_ENTRIES,
  walletAddressHint,
  type PersistedWalletRosterEntry,
  type WalletRosterSnapshot,
  type WalletRosterStore,
} from './wallet-roster-storage';

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_LABEL_LENGTH = 64;
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}]/u;

export type WalletLifecycleErrorCode =
  | 'connector-busy'
  | 'connector-unavailable'
  | 'duplicate-account'
  | 'duplicate-connection'
  | 'invalid-wallet-state'
  | 'manager-disposed'
  | 'operation-aborted'
  | 'persistence-unavailable'
  | 'provider-operation-failed'
  | 'roster-capacity-reached'
  | 'verification-stale'
  | 'wallet-unavailable';

const ERROR_MESSAGES: Readonly<Record<WalletLifecycleErrorCode, string>> = {
  'connector-busy': 'wallet connector already has an operation in progress',
  'connector-unavailable': 'wallet connector is unavailable',
  'duplicate-account': 'wallet account is already connected',
  'duplicate-connection': 'wallet connection is already active',
  'invalid-wallet-state': 'wallet state is invalid',
  'manager-disposed': 'wallet manager is unavailable',
  'operation-aborted': 'wallet operation was cancelled',
  'persistence-unavailable': 'wallet roster persistence is unavailable',
  'provider-operation-failed': 'wallet provider operation failed',
  'roster-capacity-reached': 'wallet roster capacity has been reached',
  'verification-stale': 'wallet ownership verification is stale',
  'wallet-unavailable': 'wallet connection is unavailable',
};

export class WalletLifecycleError extends Error {
  readonly code: WalletLifecycleErrorCode;

  constructor(code: WalletLifecycleErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'WalletLifecycleError';
    this.code = code;
  }
}

export interface WalletRosterEntry extends PersistedWalletRosterEntry {
  /** True only while live, freshly verified, and durably fail-closed. */
  readonly indexingEnabled: boolean;
  readonly live: boolean;
}

export interface MultiWalletState {
  readonly entries: readonly WalletRosterEntry[];
  readonly persistenceAvailable: boolean;
}

export interface WalletVerificationTarget {
  readonly connectionId: string;
  readonly connectorId: string;
  readonly lifecycleRevision: number;
  readonly account: WalletAccount;
}

export interface SignedWalletOwnershipProof {
  readonly lifecycleRevision: number;
  readonly signature: OwnershipSignature;
}

export interface ConnectWalletOptions {
  readonly label?: string;
  readonly signal?: AbortSignal;
}

export interface RestoreWalletOptions {
  readonly label?: string;
  readonly signal?: AbortSignal;
}

export interface MultiWalletManagerOptions {
  readonly adapters: readonly WalletAdapter[];
  readonly store: WalletRosterStore;
  readonly now?: () => Date;
}

type StateListener = (state: MultiWalletState) => void;

function assertSafeText(value: unknown, maximumLength: number): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    FORBIDDEN_TEXT.test(value)
  ) {
    throw new WalletLifecycleError('invalid-wallet-state');
  }
}

function assertLabel(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_LABEL_LENGTH ||
    value.trim() !== value ||
    FORBIDDEN_TEXT.test(value)
  ) {
    throw new WalletLifecycleError('invalid-wallet-state');
  }
}

function cloneConnection(connection: WalletConnection): WalletConnection {
  return {
    connectionId: connection.connectionId,
    connectorId: connection.connectorId,
    ...(connection.transportSessionId === undefined
      ? {}
      : { transportSessionId: connection.transportSessionId }),
    accounts: connection.accounts.map((account) => ({ ...account })),
    approvedScopes: connection.approvedScopes.map((scope) => ({
      chainId: scope.chainId,
      methods: [...scope.methods],
      events: [...scope.events],
    })),
    selectedAccount: { ...connection.selectedAccount },
    restored: connection.restored,
  };
}

function cloneSignature(signature: OwnershipSignature): OwnershipSignature {
  if (signature.format === 'siwe') return { ...signature };
  if (signature.format === 'siws-message') {
    return {
      ...signature,
      signedMessage: new Uint8Array(signature.signedMessage),
      signature: new Uint8Array(signature.signature),
    };
  }
  return {
    ...signature,
    account: {
      address: signature.account.address,
      publicKey: new Uint8Array(signature.account.publicKey),
    },
    signedMessage: new Uint8Array(signature.signedMessage),
    signature: new Uint8Array(signature.signature),
  };
}

function selectedAccountKey(connection: WalletConnection): string {
  const { chainId, address } = connection.selectedAccount;
  return `${chainId}\u0000${chainId.startsWith('eip155:') ? address.toLowerCase() : address}`;
}

function sameSelectedAccount(left: WalletConnection, right: WalletConnection): boolean {
  return selectedAccountKey(left) === selectedAccountKey(right);
}

function eventConnectionId(event: WalletEvent): string | null {
  if (event.type === 'chainChanged' || event.type === 'sessionUpdated') {
    return typeof event.connection?.connectionId === 'string'
      ? event.connection.connectionId
      : null;
  }
  return typeof event.connectionId === 'string' ? event.connectionId : null;
}

function lifecycleError(error: unknown, signal?: AbortSignal): WalletLifecycleError {
  if (error instanceof WalletLifecycleError) return error;
  return new WalletLifecycleError(
    signal?.aborted ? 'operation-aborted' : 'provider-operation-failed',
  );
}

/**
 * Owns simultaneous wallet lifecycle state without owning any vendor provider.
 * Construction subscribes to normalized adapter events but never connects or
 * restores a wallet; both operations require an explicit caller action.
 */
export class MultiWalletManager {
  private readonly adapters = new Map<string, WalletAdapter>();
  private readonly connectorUnsubscribers: UnsubscribeWalletListener[] = [];
  private readonly busyConnectors = new Set<string>();
  private readonly liveConnections = new Map<string, WalletConnection>();
  private readonly listeners = new Set<StateListener>();
  private readonly now: () => Date;
  private entries = new Map<string, PersistedWalletRosterEntry>();
  private persistenceAvailable = true;
  private disposed = false;

  constructor(private readonly options: MultiWalletManagerOptions) {
    this.now = options.now ?? (() => new Date());
    for (const adapter of options.adapters) {
      assertSafeText(adapter.connectorId, MAX_IDENTIFIER_LENGTH);
      if (adapter.namespace !== 'eip155' && adapter.namespace !== 'solana') {
        throw new WalletLifecycleError('invalid-wallet-state');
      }
      if (this.adapters.has(adapter.connectorId)) {
        throw new WalletLifecycleError('duplicate-connection');
      }
      this.adapters.set(adapter.connectorId, adapter);
    }

    let stored: WalletRosterSnapshot | null;
    try {
      stored = options.store.read();
    } catch {
      throw new WalletLifecycleError('persistence-unavailable');
    }
    this.entries = new Map((stored?.entries ?? []).map((entry) => [entry.connectionId, entry]));
    this.normalizeReloadedEntries();

    try {
      for (const adapter of this.adapters.values()) {
        this.connectorUnsubscribers.push(
          adapter.subscribe((event) => {
            this.handleAdapterEvent(adapter, event);
          }),
        );
      }
    } catch {
      this.disposeSubscriptions();
      throw new WalletLifecycleError('provider-operation-failed');
    }
  }

  getState(): MultiWalletState {
    const entries = [...this.entries.values()]
      .sort(
        (left, right) =>
          left.connectedAt.localeCompare(right.connectedAt) ||
          left.connectionId.localeCompare(right.connectionId),
      )
      .map((entry): WalletRosterEntry => {
        const live = this.liveConnections.has(entry.connectionId);
        return {
          ...entry,
          selectedAccount: { ...entry.selectedAccount },
          live,
          indexingEnabled:
            this.persistenceAvailable && live && entry.status === 'verified' && !this.disposed,
        };
      });
    return {
      entries,
      persistenceAvailable: this.persistenceAvailable,
    };
  }

  subscribe(listener: StateListener): () => void {
    this.requireAvailable();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(
    connectorId: string,
    options: ConnectWalletOptions = {},
  ): Promise<WalletRosterEntry> {
    this.requireAvailable();
    assertSafeText(connectorId, MAX_IDENTIFIER_LENGTH);
    if (options.label !== undefined) assertLabel(options.label);
    this.assertConnectorHasNoLiveConnection(connectorId);
    const adapter = this.beginConnectorOperation(connectorId);

    let connection: WalletConnection | undefined;
    try {
      const candidate = await adapter.connect(
        options.signal === undefined ? undefined : { signal: options.signal },
      );
      assertWalletConnection(candidate, adapter.namespace, adapter.connectorId);
      if (candidate.restored) throw new WalletLifecycleError('invalid-wallet-state');
      connection = cloneConnection(candidate);
      return this.activateConnection(adapter, connection, 'connected', options.label);
    } catch (error) {
      if (connection !== undefined) {
        await this.bestEffortProviderDisconnect(adapter, connection.connectionId);
        this.failClosedInMemory(connection.connectionId, adapter.connectorId);
      }
      throw lifecycleError(error, options.signal);
    } finally {
      this.busyConnectors.delete(connectorId);
    }
  }

  async restore(
    connectorId: string,
    options: RestoreWalletOptions = {},
  ): Promise<WalletRosterEntry | null> {
    this.requireAvailable();
    assertSafeText(connectorId, MAX_IDENTIFIER_LENGTH);
    if (options.label !== undefined) assertLabel(options.label);
    this.assertConnectorHasNoLiveConnection(connectorId);
    const adapter = this.beginConnectorOperation(connectorId);

    let connection: WalletConnection | undefined;
    try {
      const candidate = await adapter.restore(
        options.signal === undefined ? undefined : { signal: options.signal },
      );
      if (candidate === null) {
        this.disconnectUnrestoredEntries(connectorId);
        return null;
      }
      assertWalletConnection(candidate, adapter.namespace, adapter.connectorId);
      if (!candidate.restored) throw new WalletLifecycleError('invalid-wallet-state');
      connection = cloneConnection(candidate);
      return this.activateConnection(adapter, connection, 'restored', options.label);
    } catch (error) {
      if (connection !== undefined) {
        await this.bestEffortProviderDisconnect(adapter, connection.connectionId);
        this.failClosedInMemory(connection.connectionId, adapter.connectorId);
      }
      throw lifecycleError(error, options.signal);
    } finally {
      this.busyConnectors.delete(connectorId);
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    this.requireAvailable();
    assertSafeText(connectionId, MAX_IDENTIFIER_LENGTH);
    const entry = this.entries.get(connectionId);
    if (entry === undefined) throw new WalletLifecycleError('wallet-unavailable');
    if (entry.status === 'disconnected' || entry.status === 'session-expired') return;

    const adapter = this.adapters.get(entry.connectorId);
    const wasLive = this.liveConnections.delete(connectionId);
    let persistenceError: WalletLifecycleError | undefined;
    try {
      this.transitionToDisconnected(entry, 'disconnected', 'disconnected');
    } catch (error) {
      persistenceError = lifecycleError(error);
    }

    if (wasLive && adapter !== undefined) {
      try {
        await adapter.disconnect(connectionId);
      } catch {
        throw new WalletLifecycleError('provider-operation-failed');
      }
    }
    if (persistenceError !== undefined) throw persistenceError;
  }

  renameWallet(connectionId: string, label: string): WalletRosterEntry {
    this.requireAvailable();
    assertSafeText(connectionId, MAX_IDENTIFIER_LENGTH);
    assertLabel(label);
    const entry = this.entries.get(connectionId);
    if (entry === undefined) throw new WalletLifecycleError('wallet-unavailable');
    if (entry.label === label) return this.requireEntryView(connectionId);

    const candidate = new Map(this.entries);
    candidate.set(connectionId, {
      ...entry,
      label,
      updatedAt: this.timestampAfter(entry.updatedAt),
    });
    this.persistAndApply(candidate);
    return this.requireEntryView(connectionId);
  }

  getVerificationTarget(connectionId: string): WalletVerificationTarget {
    this.requireAvailable();
    if (!this.persistenceAvailable) {
      throw new WalletLifecycleError('persistence-unavailable');
    }
    const entry = this.entries.get(connectionId);
    const connection = this.liveConnections.get(connectionId);
    if (
      entry === undefined ||
      connection === undefined ||
      (entry.status !== 'reverification-required' && entry.status !== 'verified')
    ) {
      throw new WalletLifecycleError('wallet-unavailable');
    }
    return {
      connectionId,
      connectorId: entry.connectorId,
      lifecycleRevision: entry.lifecycleRevision,
      account: { ...connection.selectedAccount },
    };
  }

  async signOwnershipChallenge(
    connectionId: string,
    challenge: OwnershipChallenge,
  ): Promise<SignedWalletOwnershipProof> {
    const target = this.getVerificationTarget(connectionId);
    const connection = this.liveConnections.get(connectionId);
    const adapter = this.adapters.get(target.connectorId);
    if (connection === undefined || adapter === undefined) {
      throw new WalletLifecycleError('wallet-unavailable');
    }

    try {
      assertOwnershipChallengeTargetsConnection(challenge, connection);
    } catch {
      throw new WalletLifecycleError('invalid-wallet-state');
    }

    let signature: OwnershipSignature;
    try {
      signature = await adapter.signOwnershipChallenge(connectionId, challenge);
      assertOwnershipSignatureMatchesChallenge(signature, challenge);
    } catch {
      throw new WalletLifecycleError('provider-operation-failed');
    }

    const currentEntry = this.entries.get(connectionId);
    const currentConnection = this.liveConnections.get(connectionId);
    if (
      currentEntry === undefined ||
      currentConnection === undefined ||
      currentEntry.lifecycleRevision !== target.lifecycleRevision ||
      !sameSelectedAccount(connection, currentConnection)
    ) {
      throw new WalletLifecycleError('verification-stale');
    }

    return {
      lifecycleRevision: target.lifecycleRevision,
      signature: cloneSignature(signature),
    };
  }

  /** Call only after KAN-56 has accepted the matching server-issued proof. */
  acceptOwnershipVerification(connectionId: string, lifecycleRevision: number): WalletRosterEntry {
    this.requireAvailable();
    if (!this.persistenceAvailable) {
      throw new WalletLifecycleError('persistence-unavailable');
    }
    const entry = this.entries.get(connectionId);
    if (
      entry === undefined ||
      !this.liveConnections.has(connectionId) ||
      !Number.isSafeInteger(lifecycleRevision) ||
      lifecycleRevision !== entry.lifecycleRevision ||
      (entry.status !== 'reverification-required' && entry.status !== 'verified')
    ) {
      throw new WalletLifecycleError('verification-stale');
    }
    if (entry.status === 'verified') return this.requireEntryView(connectionId);

    const candidate = new Map(this.entries);
    candidate.set(connectionId, {
      ...entry,
      status: 'verified',
      updatedAt: this.timestampAfter(entry.updatedAt),
      lastTransition: 'ownership-verified',
    });
    this.persistAndApply(candidate);
    return this.requireEntryView(connectionId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.liveConnections.clear();
    this.busyConnectors.clear();
    this.disposeSubscriptions();
    this.listeners.clear();
  }

  private normalizeReloadedEntries(): void {
    let changed = false;
    const candidate = new Map<string, PersistedWalletRosterEntry>();
    for (const entry of this.entries.values()) {
      if (entry.status === 'verified' || entry.status === 'reverification-required') {
        changed = true;
        candidate.set(entry.connectionId, {
          ...entry,
          status: 'restore-required',
          lifecycleRevision: this.nextRevision(entry.lifecycleRevision),
          updatedAt: this.timestampAfter(entry.updatedAt),
          lastTransition: 'page-reloaded',
        });
      } else {
        candidate.set(entry.connectionId, entry);
      }
    }
    if (!changed) return;

    try {
      this.options.store.write(this.snapshot(candidate));
      this.entries = candidate;
    } catch {
      throw new WalletLifecycleError('persistence-unavailable');
    }
  }

  private activateConnection(
    adapter: WalletAdapter,
    connection: WalletConnection,
    transition: 'connected' | 'restored',
    requestedLabel?: string,
  ): WalletRosterEntry {
    if (this.liveConnections.has(connection.connectionId)) {
      throw new WalletLifecycleError('duplicate-connection');
    }
    const existing = this.entries.get(connection.connectionId);
    if (
      existing !== undefined &&
      (existing.connectorId !== adapter.connectorId || existing.namespace !== adapter.namespace)
    ) {
      throw new WalletLifecycleError('duplicate-connection');
    }
    this.assertAccountIsUnique(connection);
    if (existing === undefined && this.entries.size >= MAX_WALLET_ROSTER_ENTRIES) {
      throw new WalletLifecycleError('roster-capacity-reached');
    }

    const timestamp = this.timestampAfter(existing?.updatedAt);
    const candidate = new Map(this.entries);
    for (const entry of candidate.values()) {
      if (
        entry.connectorId === adapter.connectorId &&
        entry.connectionId !== connection.connectionId &&
        entry.status !== 'disconnected' &&
        entry.status !== 'session-expired'
      ) {
        candidate.set(
          entry.connectionId,
          this.disconnectedEntry(entry, timestamp, 'disconnected', 'disconnected'),
        );
      }
    }

    const label = requestedLabel ?? existing?.label ?? this.defaultLabel();
    candidate.set(connection.connectionId, {
      connectionId: connection.connectionId,
      connectorId: adapter.connectorId,
      namespace: adapter.namespace,
      label,
      selectedAccount: {
        chainId: connection.selectedAccount.chainId,
        address: walletAddressHint(connection.selectedAccount),
      },
      status: 'reverification-required',
      lifecycleRevision: existing === undefined ? 1 : this.nextRevision(existing.lifecycleRevision),
      connectedAt: existing?.connectedAt ?? timestamp,
      updatedAt: timestamp,
      lastTransition: transition,
    });

    try {
      this.options.store.write(this.snapshot(candidate));
      this.entries = candidate;
      this.liveConnections.set(connection.connectionId, connection);
      this.notify();
    } catch {
      this.entries = candidate;
      this.persistenceAvailable = false;
      this.notify();
      throw new WalletLifecycleError('persistence-unavailable');
    }
    return this.requireEntryView(connection.connectionId);
  }

  private disconnectUnrestoredEntries(connectorId: string): void {
    let changed = false;
    const candidate = new Map(this.entries);
    for (const entry of candidate.values()) {
      if (
        entry.connectorId === connectorId &&
        entry.status !== 'disconnected' &&
        entry.status !== 'session-expired'
      ) {
        changed = true;
        candidate.set(
          entry.connectionId,
          this.disconnectedEntry(
            entry,
            this.timestampAfter(entry.updatedAt),
            'disconnected',
            'disconnected',
          ),
        );
      }
    }
    if (changed) this.persistAndApply(candidate);
  }

  private transitionConnection(
    adapter: WalletAdapter,
    connection: WalletConnection,
    transition: 'account-changed' | 'chain-changed' | 'session-updated',
  ): void {
    assertWalletConnection(connection, adapter.namespace, adapter.connectorId);
    const current = this.entries.get(connection.connectionId);
    if (current === undefined || !this.liveConnections.has(connection.connectionId)) return;
    if (current.connectorId !== adapter.connectorId || current.namespace !== adapter.namespace) {
      throw new WalletLifecycleError('invalid-wallet-state');
    }
    this.assertAccountIsUnique(connection, connection.connectionId);

    const cloned = cloneConnection(connection);
    const candidate = new Map(this.entries);
    candidate.set(connection.connectionId, {
      connectionId: current.connectionId,
      connectorId: current.connectorId,
      namespace: current.namespace,
      label: current.label,
      selectedAccount: {
        chainId: cloned.selectedAccount.chainId,
        address: walletAddressHint(cloned.selectedAccount),
      },
      status: 'reverification-required',
      lifecycleRevision: this.nextRevision(current.lifecycleRevision),
      connectedAt: current.connectedAt,
      updatedAt: this.timestampAfter(current.updatedAt),
      lastTransition: transition,
    });
    try {
      this.options.store.write(this.snapshot(candidate));
      this.entries = candidate;
      this.liveConnections.set(connection.connectionId, cloned);
      this.notify();
    } catch {
      this.entries = candidate;
      this.persistenceAvailable = false;
      this.notify();
      throw new WalletLifecycleError('persistence-unavailable');
    }
  }

  private transitionToDisconnected(
    entry: PersistedWalletRosterEntry,
    status: 'disconnected' | 'session-expired',
    transition: 'disconnected' | 'session-expired' | 'provider-state-invalid',
  ): void {
    const candidate = new Map(this.entries);
    candidate.set(
      entry.connectionId,
      this.disconnectedEntry(entry, this.timestampAfter(entry.updatedAt), status, transition),
    );
    this.persistAndApply(candidate);
  }

  private disconnectedEntry(
    entry: PersistedWalletRosterEntry,
    timestamp: string,
    status: 'disconnected' | 'session-expired',
    transition: 'disconnected' | 'session-expired' | 'provider-state-invalid',
  ): PersistedWalletRosterEntry {
    return {
      ...entry,
      status,
      lifecycleRevision: this.nextRevision(entry.lifecycleRevision),
      updatedAt: timestamp,
      disconnectedAt: timestamp,
      lastTransition: transition,
    };
  }

  private handleAdapterEvent(adapter: WalletAdapter, event: WalletEvent): void {
    if (this.disposed) return;
    try {
      if (event.type === 'accountsChanged') {
        assertSafeText(event.connectionId, MAX_IDENTIFIER_LENGTH);
        if (event.connectorId !== adapter.connectorId) {
          throw new WalletLifecycleError('invalid-wallet-state');
        }
        if (event.connection === null) {
          this.handleRemoteDisconnect(adapter, event.connectionId, 'disconnected', 'disconnected');
          return;
        }
        if (event.connection.connectionId !== event.connectionId) {
          throw new WalletLifecycleError('invalid-wallet-state');
        }
        this.transitionConnection(adapter, event.connection, 'account-changed');
        return;
      }
      if (event.type === 'chainChanged' || event.type === 'sessionUpdated') {
        this.transitionConnection(
          adapter,
          event.connection,
          event.type === 'chainChanged' ? 'chain-changed' : 'session-updated',
        );
        return;
      }
      assertSafeText(event.connectionId, MAX_IDENTIFIER_LENGTH);
      if (event.connectorId !== adapter.connectorId) {
        throw new WalletLifecycleError('invalid-wallet-state');
      }
      this.handleRemoteDisconnect(
        adapter,
        event.connectionId,
        event.type === 'sessionExpired' ? 'session-expired' : 'disconnected',
        event.type === 'sessionExpired' ? 'session-expired' : 'disconnected',
      );
    } catch {
      const connectionId = eventConnectionId(event);
      if (connectionId !== null) this.invalidateProviderState(connectionId, adapter.connectorId);
    }
  }

  private handleRemoteDisconnect(
    adapter: WalletAdapter,
    connectionId: string,
    status: 'disconnected' | 'session-expired',
    transition: 'disconnected' | 'session-expired',
  ): void {
    const entry = this.entries.get(connectionId);
    if (entry === undefined || entry.connectorId !== adapter.connectorId) return;
    this.liveConnections.delete(connectionId);
    if (entry.status === 'disconnected' || entry.status === 'session-expired') {
      this.notify();
      return;
    }
    this.transitionToDisconnected(entry, status, transition);
  }

  private invalidateProviderState(connectionId: string, connectorId: string): void {
    const entry = this.entries.get(connectionId);
    if (entry === undefined || entry.connectorId !== connectorId) return;
    this.liveConnections.delete(connectionId);
    if (entry.status === 'disconnected' || entry.status === 'session-expired') return;
    try {
      this.transitionToDisconnected(entry, 'disconnected', 'provider-state-invalid');
    } catch {
      this.failClosedInMemory(connectionId, connectorId);
    }
  }

  private failClosedInMemory(connectionId: string, connectorId: string): void {
    const entry = this.entries.get(connectionId);
    if (entry === undefined || entry.connectorId !== connectorId) return;
    this.liveConnections.delete(connectionId);
    const timestamp = this.timestampAfter(entry.updatedAt);
    this.entries.set(
      connectionId,
      this.disconnectedEntry(entry, timestamp, 'disconnected', 'provider-state-invalid'),
    );
    this.persistenceAvailable = false;
    this.notify();
  }

  private assertAccountIsUnique(connection: WalletConnection, excludedConnectionId?: string): void {
    const key = selectedAccountKey(connection);
    for (const [connectionId, live] of this.liveConnections) {
      if (connectionId !== excludedConnectionId && selectedAccountKey(live) === key) {
        throw new WalletLifecycleError('duplicate-account');
      }
    }
  }

  private assertConnectorHasNoLiveConnection(connectorId: string): void {
    for (const connection of this.liveConnections.values()) {
      if (connection.connectorId === connectorId) {
        throw new WalletLifecycleError('duplicate-connection');
      }
    }
  }

  private beginConnectorOperation(connectorId: string): WalletAdapter {
    this.requireAvailable();
    assertSafeText(connectorId, MAX_IDENTIFIER_LENGTH);
    if (!this.persistenceAvailable) {
      throw new WalletLifecycleError('persistence-unavailable');
    }
    const adapter = this.adapters.get(connectorId);
    if (adapter === undefined) throw new WalletLifecycleError('connector-unavailable');
    if (this.busyConnectors.has(connectorId)) {
      throw new WalletLifecycleError('connector-busy');
    }
    this.busyConnectors.add(connectorId);
    return adapter;
  }

  private async bestEffortProviderDisconnect(
    adapter: WalletAdapter,
    connectionId: string,
  ): Promise<void> {
    try {
      await adapter.disconnect(connectionId);
    } catch {
      // Application state remains fail-closed; provider details stay redacted.
    }
  }

  private persistAndApply(entries: Map<string, PersistedWalletRosterEntry>): void {
    try {
      this.options.store.write(this.snapshot(entries));
      this.entries = entries;
      this.notify();
    } catch {
      this.entries = entries;
      this.persistenceAvailable = false;
      this.notify();
      throw new WalletLifecycleError('persistence-unavailable');
    }
  }

  private snapshot(entries = this.entries): WalletRosterSnapshot {
    return {
      version: 1,
      entries: [...entries.values()],
    };
  }

  private requireEntryView(connectionId: string): WalletRosterEntry {
    const entry = this.getState().entries.find(
      (candidate) => candidate.connectionId === connectionId,
    );
    if (entry === undefined) throw new WalletLifecycleError('wallet-unavailable');
    return entry;
  }

  private requireAvailable(): void {
    if (this.disposed) throw new WalletLifecycleError('manager-disposed');
  }

  private defaultLabel(): string {
    return `Wallet ${this.entries.size + 1}`;
  }

  private nextRevision(revision: number): number {
    if (!Number.isSafeInteger(revision) || revision < 1 || revision === Number.MAX_SAFE_INTEGER) {
      throw new WalletLifecycleError('invalid-wallet-state');
    }
    return revision + 1;
  }

  private timestampAfter(previous?: string): string {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new WalletLifecycleError('invalid-wallet-state');
    }
    const current = value.toISOString();
    return previous !== undefined && current < previous ? previous : current;
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // A view listener cannot break lifecycle safety or expose provider errors.
      }
    }
  }

  private disposeSubscriptions(): void {
    for (const unsubscribe of this.connectorUnsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // Cleanup remains best effort; disposed state cannot index or sign.
      }
    }
  }
}
