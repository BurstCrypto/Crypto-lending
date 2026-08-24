import {
  assertOwnershipChallengeTargetsConnection,
  assertOwnershipSignatureMatchesChallenge,
  assertWalletConnection,
} from './wallet-adapter';
import type {
  ChainId,
  OwnershipChallenge,
  OwnershipSignature,
  WalletAdapter,
  WalletConnection,
  WalletEvent,
  WalletNamespace,
} from './wallet-adapter';

/**
 * This literal is an intentional authorization boundary. KAN-58 currently
 * permits injected deterministic fakes only; a future SDK transport needs a
 * separately reviewed implementation and a different literal.
 */
export const WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY = 'INJECTED_DETERMINISTIC_LOCAL_ONLY' as const;

const CONNECTOR_ID = 'walletconnect';
const MAX_CHAINS = 16;
const MAX_CAPABILITIES = 32;
const MAX_DEEP_LINKS = 8;
const MAX_PAIRING_URI_LENGTH = 2_048;
const MAX_SESSION_TOPIC_LENGTH = 256;
const MIN_PAIRING_TIMEOUT_MS = 1_000;
const MAX_PAIRING_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const EVM_CHAIN_PATTERN = /^eip155:(?:0|[1-9][0-9]*)$/u;
const SOLANA_CHAIN_PATTERN = /^solana:(?:mainnet|devnet|testnet)$/u;
const PAIRING_URI_PATTERN = /^wc:[A-Za-z0-9._~-]{1,256}@2\?[^\s#]+$/u;

export interface WalletConnectDeepLinkConfiguration {
  readonly walletId: string;
  /** HTTPS universal/app-link endpoint. It must contain no query or fragment. */
  readonly baseUrl: string;
  readonly pairingUriParameter: string;
}

export interface WalletConnectLocalConfiguration {
  readonly mode: 'deterministic-local';
  readonly transportBoundary: typeof WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY;
  readonly connectorId: typeof CONNECTOR_ID;
  readonly namespace: WalletNamespace;
  readonly approvedChains: readonly ChainId[];
  readonly requiredMethods: readonly string[];
  readonly requiredEvents: readonly string[];
  readonly pairingTimeoutMs: number;
  readonly deepLinks: readonly WalletConnectDeepLinkConfiguration[];
}

export interface WalletConnectSessionCandidate {
  /** Opaque relay/session topic. It is not an application identity. */
  readonly topic: string;
  readonly expiresAtMs: number;
  readonly namespace: WalletNamespace;
  readonly chains: readonly ChainId[];
  /** CAIP-10 account identifiers: namespace:reference:account. */
  readonly accounts: readonly string[];
  /** Explicit CAIP-10 selection; accounts[0] is never selected implicitly. */
  readonly selectedAccount: string;
  readonly methods: readonly string[];
  readonly events: readonly string[];
}

export interface WalletConnectSessionRequest {
  readonly namespace: WalletNamespace;
  readonly chains: readonly ChainId[];
  readonly methods: readonly string[];
  readonly events: readonly string[];
}

export interface WalletConnectPairingAttempt {
  /** Ephemeral secret-bearing URI. The connector only forwards it to the presenter. */
  readonly pairingUri: string;
  readonly expiresAtMs: number;
  readonly approval: Promise<WalletConnectSessionCandidate>;
  cancel(): Promise<void>;
}

export type WalletConnectTransportFailureCode =
  | 'USER_REJECTED'
  | 'PAIRING_EXPIRED'
  | 'SESSION_EXPIRED'
  | 'DISCONNECTED'
  | 'TRANSPORT_UNAVAILABLE';

export type WalletConnectTransportEvent =
  | {
      readonly type: 'sessionUpdated' | 'accountsChanged' | 'chainChanged';
      readonly topic: string;
      readonly session: WalletConnectSessionCandidate | null;
    }
  | {
      readonly type: 'disconnect' | 'sessionExpired';
      readonly topic: string;
      readonly code?: WalletConnectTransportFailureCode;
    };

export type UnsubscribeWalletConnectTransport = () => void;

/**
 * Provider-neutral boundary implemented by deterministic tests today. No
 * vendor provider/client object crosses into product state.
 */
export interface WalletConnectTransport {
  connect(request: WalletConnectSessionRequest): Promise<WalletConnectPairingAttempt>;
  restore(request: WalletConnectSessionRequest): Promise<WalletConnectSessionCandidate | null>;
  disconnect(topic: string): Promise<void>;
  signOwnershipChallenge(topic: string, challenge: OwnershipChallenge): Promise<OwnershipSignature>;
  subscribe(
    listener: (event: WalletConnectTransportEvent) => void,
  ): UnsubscribeWalletConnectTransport;
}

export interface WalletConnectTransportFactory {
  readonly boundary: typeof WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY;
  create(): Promise<WalletConnectTransport>;
}

export interface WalletConnectPairingDeepLink {
  readonly walletId: string;
  /** Ephemeral URL containing the percent-encoded pairing URI. */
  readonly uri: string;
}

export interface WalletConnectPairingPresentation {
  /** Render as a QR value without copying it into telemetry or persistence. */
  readonly qrUri: string;
  readonly deepLinks: readonly WalletConnectPairingDeepLink[];
  readonly expiresAt: string;
}

export interface WalletConnectPairingPresenter {
  show(presentation: WalletConnectPairingPresentation): void | Promise<void>;
  /** Removes QR/deep-link material after every terminal pairing outcome. */
  clear(): void | Promise<void>;
}

export type WalletConnectConnectorErrorCode =
  | 'ABORTED'
  | 'CONFIGURATION_INVALID'
  | 'CONNECTOR_BUSY'
  | 'CONNECTION_NOT_FOUND'
  | 'DISCONNECTED'
  | 'OWNERSHIP_INVALID'
  | 'PAIRING_INVALID'
  | 'PAIRING_EXPIRED'
  | 'SESSION_EXPIRED'
  | 'SESSION_INVALID'
  | 'TRANSPORT_UNAVAILABLE'
  | 'USER_REJECTED';

const ERROR_MESSAGES: Readonly<Record<WalletConnectConnectorErrorCode, string>> = Object.freeze({
  ABORTED: 'Wallet connection was cancelled',
  CONFIGURATION_INVALID: 'Wallet connector configuration is invalid',
  CONNECTOR_BUSY: 'Wallet connector is already active',
  CONNECTION_NOT_FOUND: 'Wallet connection is unavailable',
  DISCONNECTED: 'Wallet session was disconnected',
  OWNERSHIP_INVALID: 'Wallet ownership response is invalid',
  PAIRING_INVALID: 'Wallet pairing response is invalid',
  PAIRING_EXPIRED: 'Wallet pairing has expired',
  SESSION_EXPIRED: 'Wallet session has expired',
  SESSION_INVALID: 'Wallet session is invalid',
  TRANSPORT_UNAVAILABLE: 'Wallet transport is unavailable',
  USER_REJECTED: 'Wallet request was rejected',
});

export class WalletConnectConnectorError extends Error {
  readonly code: WalletConnectConnectorErrorCode;

  constructor(code: WalletConnectConnectorErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'WalletConnectConnectorError';
    this.code = code;
  }
}

export type WalletConnectStateSnapshot =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'pairing';
      readonly expiresAt: string;
      readonly deepLinkWalletIds: readonly string[];
    }
  | { readonly phase: 'connected'; readonly connection: WalletConnection };

export interface WalletConnectConnectorDependencies {
  readonly factory: WalletConnectTransportFactory;
  readonly pairingPresenter: WalletConnectPairingPresenter;
  readonly now?: () => number;
  readonly createConnectionId?: () => string;
}

// The concrete class is defined below the validation helpers so every external
// value crosses the same fail-closed parsing boundary.
export type WalletConnectAdapter = WalletAdapter & {
  getState(): WalletConnectStateSnapshot;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownDataValue(
  record: Record<string, unknown>,
  key: string,
  errorCode: WalletConnectConnectorErrorCode = 'CONFIGURATION_INVALID',
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new WalletConnectConnectorError(errorCode);
  }
  return descriptor.value;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }
}

function assertIdentifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }
}

function isChainForNamespace(value: string, namespace: WalletNamespace): value is ChainId {
  return namespace === 'eip155' ? EVM_CHAIN_PATTERN.test(value) : SOLANA_CHAIN_PATTERN.test(value);
}

function parseUniqueStringList(
  value: unknown,
  maximum: number,
  predicate: (item: string) => boolean,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !predicate(item) || seen.has(item)) {
      throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
    }
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

function parseDeepLink(value: unknown): WalletConnectDeepLinkConfiguration {
  if (!isRecord(value)) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }
  assertExactKeys(value, ['walletId', 'baseUrl', 'pairingUriParameter']);
  const walletId = ownDataValue(value, 'walletId');
  const baseUrl = ownDataValue(value, 'baseUrl');
  const pairingUriParameter = ownDataValue(value, 'pairingUriParameter');
  assertIdentifier(walletId);
  assertIdentifier(pairingUriParameter);
  if (typeof baseUrl !== 'string' || baseUrl.length > 2_048) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }

  return Object.freeze({ walletId, baseUrl: parsed.toString(), pairingUriParameter });
}

export function parseWalletConnectLocalConfiguration(
  value: unknown,
): WalletConnectLocalConfiguration {
  if (!isRecord(value)) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }
  assertExactKeys(value, [
    'mode',
    'transportBoundary',
    'connectorId',
    'namespace',
    'approvedChains',
    'requiredMethods',
    'requiredEvents',
    'pairingTimeoutMs',
    'deepLinks',
  ]);

  const mode = ownDataValue(value, 'mode');
  const transportBoundary = ownDataValue(value, 'transportBoundary');
  const connectorId = ownDataValue(value, 'connectorId');
  const namespace = ownDataValue(value, 'namespace');
  const pairingTimeoutMs = ownDataValue(value, 'pairingTimeoutMs');
  if (
    mode !== 'deterministic-local' ||
    transportBoundary !== WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY ||
    connectorId !== CONNECTOR_ID ||
    (namespace !== 'eip155' && namespace !== 'solana') ||
    typeof pairingTimeoutMs !== 'number' ||
    !Number.isSafeInteger(pairingTimeoutMs) ||
    pairingTimeoutMs < MIN_PAIRING_TIMEOUT_MS ||
    pairingTimeoutMs > MAX_PAIRING_TIMEOUT_MS
  ) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }

  const approvedChains = parseUniqueStringList(
    ownDataValue(value, 'approvedChains'),
    MAX_CHAINS,
    (item) => isChainForNamespace(item, namespace),
  ) as readonly ChainId[];
  const requiredMethods = parseUniqueStringList(
    ownDataValue(value, 'requiredMethods'),
    MAX_CAPABILITIES,
    (item) => IDENTIFIER_PATTERN.test(item),
  );
  const requiredEvents = parseUniqueStringList(
    ownDataValue(value, 'requiredEvents'),
    MAX_CAPABILITIES,
    (item) => IDENTIFIER_PATTERN.test(item),
  );
  const deepLinkInput = ownDataValue(value, 'deepLinks');
  if (!Array.isArray(deepLinkInput) || deepLinkInput.length > MAX_DEEP_LINKS) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }
  const deepLinks = deepLinkInput.map(parseDeepLink);
  if (new Set(deepLinks.map((item) => item.walletId)).size !== deepLinks.length) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }

  return Object.freeze({
    mode,
    transportBoundary,
    connectorId,
    namespace,
    approvedChains,
    requiredMethods,
    requiredEvents,
    pairingTimeoutMs,
    deepLinks: Object.freeze(deepLinks),
  });
}

function assertPairingUri(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PAIRING_URI_LENGTH ||
    !PAIRING_URI_PATTERN.test(value)
  ) {
    throw new WalletConnectConnectorError('PAIRING_INVALID');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WalletConnectConnectorError('PAIRING_INVALID');
  }
  const symKey = parsed.searchParams.get('symKey');
  const relayProtocol = parsed.searchParams.get('relay-protocol');
  if (
    parsed.protocol !== 'wc:' ||
    !/^[0-9a-f]{64}$/u.test(symKey ?? '') ||
    relayProtocol !== 'irn' ||
    parsed.searchParams.getAll('symKey').length !== 1 ||
    parsed.searchParams.getAll('relay-protocol').length !== 1
  ) {
    throw new WalletConnectConnectorError('PAIRING_INVALID');
  }
}

export function createWalletConnectPairingPresentation(
  pairingUri: unknown,
  expiresAtMs: number,
  deepLinks: readonly WalletConnectDeepLinkConfiguration[],
): WalletConnectPairingPresentation {
  assertPairingUri(pairingUri);
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= 0 ||
    !Number.isFinite(new Date(expiresAtMs).getTime())
  ) {
    throw new WalletConnectConnectorError('PAIRING_INVALID');
  }
  const links = deepLinks.map((candidate) => {
    const configuration = parseDeepLink(candidate);
    const url = new URL(configuration.baseUrl);
    url.searchParams.set(configuration.pairingUriParameter, pairingUri);
    return Object.freeze({ walletId: configuration.walletId, uri: url.toString() });
  });
  return Object.freeze({
    qrUri: pairingUri,
    deepLinks: Object.freeze(links),
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
}

export function assertLocalWalletConnectFactory(factory: WalletConnectTransportFactory): void {
  if (
    !isRecord(factory) ||
    ownDataValue(factory, 'boundary') !== WALLETCONNECT_LOCAL_TRANSPORT_BOUNDARY ||
    typeof factory.create !== 'function'
  ) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
  }
}

export function assertSessionTopic(topic: unknown): asserts topic is string {
  if (
    typeof topic !== 'string' ||
    topic.length === 0 ||
    topic.length > MAX_SESSION_TOPIC_LENGTH ||
    !/^[A-Za-z0-9._~-]+$/u.test(topic)
  ) {
    throw new WalletConnectConnectorError('SESSION_INVALID');
  }
}

function readSessionValue(record: Record<string, unknown>, key: string): unknown {
  return ownDataValue(record, key, 'SESSION_INVALID');
}

function assertSessionExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(record).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new WalletConnectConnectorError('SESSION_INVALID');
  }
}

function parseSessionStringList(
  value: unknown,
  maximum: number,
  predicate: (item: string) => boolean,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new WalletConnectConnectorError('SESSION_INVALID');
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !predicate(item) || seen.has(item)) {
      throw new WalletConnectConnectorError('SESSION_INVALID');
    }
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

function parseCaip10Account(
  value: string,
  namespace: WalletNamespace,
): {
  readonly chainId: ChainId;
  readonly address: string;
} {
  const parts = value.split(':');
  if (parts.length !== 3 || parts[0] !== namespace || parts[2]?.length === 0) {
    throw new WalletConnectConnectorError('SESSION_INVALID');
  }
  const chainId = `${parts[0]}:${parts[1]}`;
  if (!isChainForNamespace(chainId, namespace)) {
    throw new WalletConnectConnectorError('SESSION_INVALID');
  }
  return Object.freeze({ chainId, address: parts[2] ?? '' });
}

interface ActiveWalletConnectSession {
  readonly connection: WalletConnection;
  readonly topic: string;
  readonly expiresAtMs: number;
}

type InternalWalletConnectPhase =
  | { readonly phase: 'idle' }
  | { readonly phase: 'starting' }
  | {
      readonly phase: 'pairing';
      readonly expiresAtMs: number;
      readonly deepLinkWalletIds: readonly string[];
    }
  | { readonly phase: 'connected' };

function fixedProviderError(
  code: WalletConnectConnectorErrorCode,
  recoverable: boolean,
): { readonly code: string; readonly message: string; readonly recoverable: boolean } {
  return Object.freeze({ code, message: ERROR_MESSAGES[code], recoverable });
}

function validateTransport(transport: unknown): asserts transport is WalletConnectTransport {
  if (
    !isRecord(transport) ||
    typeof transport.connect !== 'function' ||
    typeof transport.restore !== 'function' ||
    typeof transport.disconnect !== 'function' ||
    typeof transport.signOwnershipChallenge !== 'function' ||
    typeof transport.subscribe !== 'function'
  ) {
    throw new WalletConnectConnectorError('TRANSPORT_UNAVAILABLE');
  }
}

function transportFailureCode(error: unknown): WalletConnectTransportFailureCode | null {
  if (!isRecord(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  if (descriptor === undefined || !('value' in descriptor)) return null;
  switch (descriptor.value) {
    case 'USER_REJECTED':
    case 'PAIRING_EXPIRED':
    case 'SESSION_EXPIRED':
    case 'DISCONNECTED':
    case 'TRANSPORT_UNAVAILABLE':
      return descriptor.value;
    default:
      return null;
  }
}

function normalizeFailure(error: unknown): WalletConnectConnectorError {
  if (error instanceof WalletConnectConnectorError) return error;
  switch (transportFailureCode(error)) {
    case 'USER_REJECTED':
      return new WalletConnectConnectorError('USER_REJECTED');
    case 'PAIRING_EXPIRED':
      return new WalletConnectConnectorError('PAIRING_EXPIRED');
    case 'SESSION_EXPIRED':
      return new WalletConnectConnectorError('SESSION_EXPIRED');
    default:
      return new WalletConnectConnectorError('TRANSPORT_UNAVAILABLE');
  }
}

function validateAttempt(value: unknown): asserts value is WalletConnectPairingAttempt {
  if (!isRecord(value)) throw new WalletConnectConnectorError('PAIRING_INVALID');
  const pairingUri = ownDataValue(value, 'pairingUri', 'PAIRING_INVALID');
  const expiresAtMs = ownDataValue(value, 'expiresAtMs', 'PAIRING_INVALID');
  const approval = ownDataValue(value, 'approval', 'PAIRING_INVALID');
  assertPairingUri(pairingUri);
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    typeof expiresAtMs !== 'number' ||
    typeof (approval as { then?: unknown } | null)?.then !== 'function' ||
    typeof value.cancel !== 'function'
  ) {
    throw new WalletConnectConnectorError('PAIRING_INVALID');
  }
}

export class LocalWalletConnectConnector implements WalletConnectAdapter {
  readonly connectorId = CONNECTOR_ID;
  readonly namespace: WalletNamespace;

  private readonly configuration: WalletConnectLocalConfiguration;
  private readonly factory: WalletConnectTransportFactory;
  private readonly pairingPresenter: WalletConnectPairingPresenter;
  private readonly now: () => number;
  private readonly createConnectionId: () => string;
  private readonly listeners = new Set<(event: WalletEvent) => void>();
  private phase: InternalWalletConnectPhase = Object.freeze({ phase: 'idle' });
  private active: ActiveWalletConnectSession | null = null;
  private transport: WalletConnectTransport | null = null;
  private unsubscribeTransport: UnsubscribeWalletConnectTransport | null = null;
  private sessionExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(configuration: unknown, dependencies: WalletConnectConnectorDependencies) {
    this.configuration = parseWalletConnectLocalConfiguration(configuration);
    assertLocalWalletConnectFactory(dependencies.factory);
    if (
      !isRecord(dependencies.pairingPresenter) ||
      typeof dependencies.pairingPresenter.show !== 'function' ||
      typeof dependencies.pairingPresenter.clear !== 'function' ||
      (dependencies.now !== undefined && typeof dependencies.now !== 'function') ||
      (dependencies.createConnectionId !== undefined &&
        typeof dependencies.createConnectionId !== 'function')
    ) {
      throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
    }
    this.factory = dependencies.factory;
    this.pairingPresenter = dependencies.pairingPresenter;
    this.now = dependencies.now ?? Date.now;
    this.createConnectionId =
      dependencies.createConnectionId ?? (() => globalThis.crypto.randomUUID());
    this.namespace = this.configuration.namespace;
  }

  getState(): WalletConnectStateSnapshot {
    if (this.phase.phase === 'pairing') {
      return Object.freeze({
        phase: 'pairing',
        expiresAt: new Date(this.phase.expiresAtMs).toISOString(),
        deepLinkWalletIds: this.phase.deepLinkWalletIds,
      });
    }
    if (this.active !== null) {
      return Object.freeze({ phase: 'connected', connection: this.active.connection });
    }
    return Object.freeze({ phase: 'idle' });
  }

  async connect(options: { readonly signal?: AbortSignal } = {}): Promise<WalletConnection> {
    this.assertIdle();
    this.assertNotAborted(options.signal);
    this.phase = Object.freeze({ phase: 'starting' });
    let transport: WalletConnectTransport;
    try {
      transport = await this.getTransport();
    } catch (error) {
      this.phase = Object.freeze({ phase: 'idle' });
      throw normalizeFailure(error);
    }
    let attempt: WalletConnectPairingAttempt;
    try {
      const candidate = await transport.connect(this.sessionRequest());
      validateAttempt(candidate);
      attempt = candidate;
    } catch (error) {
      this.phase = Object.freeze({ phase: 'idle' });
      throw normalizeFailure(error);
    }

    const startedAt = this.currentTime();
    if (
      attempt.expiresAtMs <= startedAt ||
      attempt.expiresAtMs > startedAt + this.configuration.pairingTimeoutMs
    ) {
      this.phase = Object.freeze({ phase: 'idle' });
      await this.cancelPairingQuietly(attempt);
      throw new WalletConnectConnectorError('PAIRING_INVALID');
    }

    let presentation: WalletConnectPairingPresentation;
    try {
      presentation = createWalletConnectPairingPresentation(
        attempt.pairingUri,
        attempt.expiresAtMs,
        this.configuration.deepLinks,
      );
    } catch (error) {
      this.phase = Object.freeze({ phase: 'idle' });
      await this.cancelPairingQuietly(attempt);
      throw normalizeFailure(error);
    }

    this.phase = Object.freeze({
      phase: 'pairing',
      expiresAtMs: attempt.expiresAtMs,
      deepLinkWalletIds: Object.freeze(presentation.deepLinks.map((deepLink) => deepLink.walletId)),
    });

    try {
      await this.pairingPresenter.show(presentation);
      const session = await this.waitForPairingApproval(
        attempt.approval,
        attempt.expiresAtMs,
        options.signal,
      );
      const active = this.normalizeSession(session, false);
      this.activate(active);
      return active.connection;
    } catch (error) {
      this.phase = Object.freeze({ phase: 'idle' });
      await this.cancelPairingQuietly(attempt);
      throw normalizeFailure(error);
    } finally {
      await this.clearPairingQuietly();
    }
  }

  async restore(options: { readonly signal?: AbortSignal } = {}): Promise<WalletConnection | null> {
    this.assertIdle();
    this.assertNotAborted(options.signal);
    this.phase = Object.freeze({ phase: 'starting' });
    let transport: WalletConnectTransport;
    try {
      transport = await this.getTransport();
    } catch (error) {
      this.phase = Object.freeze({ phase: 'idle' });
      throw normalizeFailure(error);
    }
    let session: WalletConnectSessionCandidate | null;
    try {
      session = await transport.restore(this.sessionRequest());
    } catch (error) {
      this.phase = Object.freeze({ phase: 'idle' });
      throw normalizeFailure(error);
    }
    try {
      this.assertNotAborted(options.signal);
      if (session === null) {
        this.phase = Object.freeze({ phase: 'idle' });
        return null;
      }
      const active = this.normalizeSession(session, true);
      this.activate(active);
      return active.connection;
    } catch (error) {
      this.phase = Object.freeze({ phase: 'idle' });
      throw normalizeFailure(error);
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    const active = this.requireActive(connectionId);
    const transport = await this.getTransport();
    this.deactivate(active.topic);
    try {
      await transport.disconnect(active.topic);
      this.emit(
        Object.freeze({
          type: 'disconnect',
          connectionId: active.connection.connectionId,
          connectorId: this.connectorId,
        }),
      );
    } catch (error) {
      this.emit(
        Object.freeze({
          type: 'disconnect',
          connectionId: active.connection.connectionId,
          connectorId: this.connectorId,
          error: fixedProviderError('TRANSPORT_UNAVAILABLE', true),
        }),
      );
      throw normalizeFailure(error);
    }
  }

  async signOwnershipChallenge(
    connectionId: string,
    challenge: OwnershipChallenge,
  ): Promise<OwnershipSignature> {
    const active = this.requireActive(connectionId);
    if (active.expiresAtMs <= this.currentTime()) {
      this.expireActive(active.topic);
      throw new WalletConnectConnectorError('SESSION_EXPIRED');
    }
    assertOwnershipChallengeTargetsConnection(challenge, active.connection);
    const transport = await this.getTransport();
    let signature: OwnershipSignature;
    try {
      signature = await transport.signOwnershipChallenge(active.topic, challenge);
    } catch (error) {
      throw normalizeFailure(error);
    }
    try {
      assertOwnershipSignatureMatchesChallenge(signature, challenge);
    } catch {
      throw new WalletConnectConnectorError('OWNERSHIP_INVALID');
    }
    return signature;
  }

  subscribe(listener: (event: WalletEvent) => void): () => void {
    if (typeof listener !== 'function') {
      throw new TypeError('Wallet listener must be a function');
    }
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private sessionRequest(): WalletConnectSessionRequest {
    return Object.freeze({
      namespace: this.configuration.namespace,
      chains: this.configuration.approvedChains,
      methods: this.configuration.requiredMethods,
      events: this.configuration.requiredEvents,
    });
  }

  private assertIdle(): void {
    if (this.phase.phase !== 'idle' || this.active !== null) {
      throw new WalletConnectConnectorError('CONNECTOR_BUSY');
    }
  }

  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted === true) throw new WalletConnectConnectorError('ABORTED');
  }

  private currentTime(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
      throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
    }
    return value;
  }

  private async getTransport(): Promise<WalletConnectTransport> {
    if (this.transport !== null) return this.transport;
    let transport: unknown;
    try {
      transport = await this.factory.create();
      validateTransport(transport);
    } catch (error) {
      throw normalizeFailure(error);
    }
    this.transport = transport;
    try {
      this.unsubscribeTransport = transport.subscribe((event) => this.handleTransportEvent(event));
    } catch {
      this.transport = null;
      throw new WalletConnectConnectorError('TRANSPORT_UNAVAILABLE');
    }
    if (typeof this.unsubscribeTransport !== 'function') {
      this.transport = null;
      this.unsubscribeTransport = null;
      throw new WalletConnectConnectorError('TRANSPORT_UNAVAILABLE');
    }
    return transport;
  }

  private normalizeSession(
    value: unknown,
    restored: boolean,
    existingConnectionId?: string,
  ): ActiveWalletConnectSession {
    if (!isRecord(value)) throw new WalletConnectConnectorError('SESSION_INVALID');
    assertSessionExactKeys(value, [
      'topic',
      'expiresAtMs',
      'namespace',
      'chains',
      'accounts',
      'selectedAccount',
      'methods',
      'events',
    ]);
    const topic = readSessionValue(value, 'topic');
    const expiresAtMs = readSessionValue(value, 'expiresAtMs');
    const namespace = readSessionValue(value, 'namespace');
    const selectedAccount = readSessionValue(value, 'selectedAccount');
    assertSessionTopic(topic);
    const currentTime = this.currentTime();
    if (
      typeof expiresAtMs !== 'number' ||
      !Number.isSafeInteger(expiresAtMs) ||
      expiresAtMs <= currentTime ||
      expiresAtMs > currentTime + MAX_SESSION_LIFETIME_MS ||
      namespace !== this.namespace ||
      typeof selectedAccount !== 'string'
    ) {
      throw new WalletConnectConnectorError(
        typeof expiresAtMs === 'number' && expiresAtMs <= currentTime
          ? 'SESSION_EXPIRED'
          : 'SESSION_INVALID',
      );
    }

    const approvedSet = new Set(this.configuration.approvedChains);
    const chains = parseSessionStringList(
      readSessionValue(value, 'chains'),
      MAX_CHAINS,
      (item) => isChainForNamespace(item, this.namespace) && approvedSet.has(item as ChainId),
    ) as readonly ChainId[];
    const chainSet = new Set(chains);
    const methods = parseSessionStringList(
      readSessionValue(value, 'methods'),
      MAX_CAPABILITIES,
      (item) => IDENTIFIER_PATTERN.test(item),
    );
    const events = parseSessionStringList(
      readSessionValue(value, 'events'),
      MAX_CAPABILITIES,
      (item) => IDENTIFIER_PATTERN.test(item),
    );
    if (
      methods.length !== this.configuration.requiredMethods.length ||
      events.length !== this.configuration.requiredEvents.length ||
      methods.some((method) => !this.configuration.requiredMethods.includes(method)) ||
      events.some((event) => !this.configuration.requiredEvents.includes(event))
    ) {
      throw new WalletConnectConnectorError('SESSION_INVALID');
    }

    const caip10Accounts = parseSessionStringList(
      readSessionValue(value, 'accounts'),
      64,
      (item) => item.length <= 512,
    );
    const accounts = caip10Accounts.map((item) => parseCaip10Account(item, this.namespace));
    if (accounts.some((account) => !chainSet.has(account.chainId))) {
      throw new WalletConnectConnectorError('SESSION_INVALID');
    }
    const selected = parseCaip10Account(selectedAccount, this.namespace);
    const scopes = chains.map((chainId) =>
      Object.freeze({
        chainId,
        methods: Object.freeze([...methods]),
        events: Object.freeze([...events]),
      }),
    );
    const connectionId = existingConnectionId ?? this.createConnectionId();
    if (
      typeof connectionId !== 'string' ||
      connectionId.length === 0 ||
      connectionId.length > 256 ||
      !/^[A-Za-z0-9._~-]+$/u.test(connectionId)
    ) {
      throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
    }
    const connection: WalletConnection = Object.freeze({
      connectionId,
      connectorId: this.connectorId,
      transportSessionId: topic,
      accounts: Object.freeze(accounts),
      approvedScopes: Object.freeze(scopes),
      selectedAccount: selected,
      restored,
    });
    try {
      assertWalletConnection(connection, this.namespace, this.connectorId);
    } catch {
      throw new WalletConnectConnectorError('SESSION_INVALID');
    }
    return Object.freeze({ connection, topic, expiresAtMs });
  }

  private activate(active: ActiveWalletConnectSession): void {
    this.clearSessionTimer();
    this.active = active;
    this.phase = Object.freeze({ phase: 'connected' });
    const delay = Math.max(0, active.expiresAtMs - this.currentTime());
    this.sessionExpiryTimer = setTimeout(() => this.expireActive(active.topic), delay);
  }

  private deactivate(topic: string): ActiveWalletConnectSession | null {
    if (this.active?.topic !== topic) return null;
    const previous = this.active;
    this.active = null;
    this.phase = Object.freeze({ phase: 'idle' });
    this.clearSessionTimer();
    return previous;
  }

  private clearSessionTimer(): void {
    if (this.sessionExpiryTimer === null) return;
    clearTimeout(this.sessionExpiryTimer);
    this.sessionExpiryTimer = null;
  }

  private requireActive(connectionId: string): ActiveWalletConnectSession {
    if (this.active === null || this.active.connection.connectionId !== connectionId) {
      throw new WalletConnectConnectorError('CONNECTION_NOT_FOUND');
    }
    return this.active;
  }

  private expireActive(topic: string): void {
    const previous = this.deactivate(topic);
    if (previous === null) return;
    this.emit(
      Object.freeze({
        type: 'sessionExpired',
        connectionId: previous.connection.connectionId,
        connectorId: this.connectorId,
        error: fixedProviderError('SESSION_EXPIRED', false),
      }),
    );
  }

  private invalidateActive(topic: string): void {
    const previous = this.deactivate(topic);
    if (previous === null) return;
    this.emit(
      Object.freeze({
        type: 'disconnect',
        connectionId: previous.connection.connectionId,
        connectorId: this.connectorId,
        error: fixedProviderError('SESSION_INVALID', false),
      }),
    );
    void this.disconnectTransportQuietly(topic);
  }

  private handleTransportEvent(event: WalletConnectTransportEvent): void {
    if (!isRecord(event)) return;
    const typeDescriptor = Object.getOwnPropertyDescriptor(event, 'type');
    const topicDescriptor = Object.getOwnPropertyDescriptor(event, 'topic');
    if (
      typeDescriptor === undefined ||
      !('value' in typeDescriptor) ||
      topicDescriptor === undefined ||
      !('value' in topicDescriptor)
    ) {
      return;
    }
    const type = typeDescriptor.value;
    const topic = topicDescriptor.value;
    if (typeof topic !== 'string' || this.active?.topic !== topic) return;

    if (type === 'disconnect' || type === 'sessionExpired') {
      const previous = this.deactivate(topic);
      if (previous === null) return;
      this.emit(
        Object.freeze({
          type,
          connectionId: previous.connection.connectionId,
          connectorId: this.connectorId,
          error:
            type === 'sessionExpired'
              ? fixedProviderError('SESSION_EXPIRED', false)
              : fixedProviderError('DISCONNECTED', true),
        }),
      );
      return;
    }
    if (type !== 'sessionUpdated' && type !== 'accountsChanged' && type !== 'chainChanged') {
      return;
    }
    const sessionDescriptor = Object.getOwnPropertyDescriptor(event, 'session');
    if (sessionDescriptor === undefined || !('value' in sessionDescriptor)) {
      this.invalidateActive(topic);
      return;
    }
    if (type === 'accountsChanged' && sessionDescriptor.value === null) {
      const previous = this.deactivate(topic);
      if (previous !== null) {
        this.emit(
          Object.freeze({
            type: 'accountsChanged',
            connectionId: previous.connection.connectionId,
            connectorId: this.connectorId,
            connection: null,
          }),
        );
      }
      return;
    }
    try {
      const updated = this.normalizeSession(
        sessionDescriptor.value,
        this.active.connection.restored,
        this.active.connection.connectionId,
      );
      if (updated.topic !== topic) throw new WalletConnectConnectorError('SESSION_INVALID');
      this.activate(updated);
      if (type === 'accountsChanged') {
        this.emit(
          Object.freeze({
            type,
            connectionId: updated.connection.connectionId,
            connectorId: this.connectorId,
            connection: updated.connection,
          }),
        );
      } else {
        this.emit(Object.freeze({ type, connection: updated.connection }));
      }
    } catch {
      this.invalidateActive(topic);
    }
  }

  private emit(event: WalletEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Application listeners cannot break connector cleanup or other listeners.
      }
    }
  }

  private waitForPairingApproval(
    approval: Promise<WalletConnectSessionCandidate>,
    expiresAtMs: number,
    signal?: AbortSignal,
  ): Promise<WalletConnectSessionCandidate> {
    const delay = Math.max(0, expiresAtMs - this.currentTime());
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      };
      const finishResolve = (value: WalletConnectSessionCandidate) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const finishReject = (error: WalletConnectConnectorError) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abort = () => finishReject(new WalletConnectConnectorError('ABORTED'));
      const timeout = setTimeout(
        () => finishReject(new WalletConnectConnectorError('PAIRING_EXPIRED')),
        delay,
      );
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted === true) abort();
      Promise.resolve(approval).then(
        (session) => finishResolve(session),
        (error: unknown) => finishReject(normalizeFailure(error)),
      );
    });
  }

  private async cancelPairingQuietly(attempt: WalletConnectPairingAttempt): Promise<void> {
    try {
      await attempt.cancel();
    } catch {
      // Pairing cleanup never exposes a transport error or secret-bearing URI.
    }
  }

  private async clearPairingQuietly(): Promise<void> {
    try {
      await this.pairingPresenter.clear();
    } catch {
      // UI cleanup failure is deliberately non-diagnostic at this boundary.
    }
  }

  private async disconnectTransportQuietly(topic: string): Promise<void> {
    try {
      await this.transport?.disconnect(topic);
    } catch {
      // Invalid remote state is already removed locally; no raw failure escapes.
    }
  }
}

export function createLocalWalletConnectConnector(
  configuration: unknown,
  dependencies: WalletConnectConnectorDependencies,
): WalletConnectAdapter {
  return new LocalWalletConnectConnector(configuration, dependencies);
}
