import type {
  ChainId,
  OwnershipChallenge,
  OwnershipSignature,
  WalletAdapter,
  WalletConnection,
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

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new WalletConnectConnectorError('CONFIGURATION_INVALID');
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
  const links = deepLinks.map((configuration) => {
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
