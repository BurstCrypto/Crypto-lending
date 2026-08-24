import {
  assertWalletAccount,
  type ChainId,
  type WalletAccount,
  type WalletNamespace,
} from './wallet-adapter';

export const WALLET_ROSTER_STORAGE_KEY = 'crypto-lending.wallet-roster.v1';

const WALLET_ROSTER_VERSION = 1 as const;
export const MAX_WALLET_ROSTER_ENTRIES = 32;
const MAX_ROSTER_JSON_LENGTH = 32_768;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_LABEL_LENGTH = 64;
const SAFE_CHAIN_ID = /^(?:eip155:(?:0|[1-9][0-9]*)|solana:(?:mainnet|devnet|testnet))$/u;
const CANONICAL_UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const EVM_ADDRESS_HINT = /^0x[0-9a-f]{4}\u2026[0-9a-f]{4}$/u;
const SOLANA_ADDRESS_HINT = /^[1-9A-HJ-NP-Za-km-z]{4}\u2026[1-9A-HJ-NP-Za-km-z]{4}$/u;

export const WALLET_LIFECYCLE_STATUSES = [
  'restore-required',
  'reverification-required',
  'verified',
  'disconnected',
  'session-expired',
] as const;

export type WalletLifecycleStatus = (typeof WALLET_LIFECYCLE_STATUSES)[number];

export const WALLET_LIFECYCLE_TRANSITIONS = [
  'connected',
  'restored',
  'account-changed',
  'chain-changed',
  'session-updated',
  'disconnected',
  'session-expired',
  'ownership-verified',
  'page-reloaded',
  'provider-state-invalid',
] as const;

export type WalletLifecycleTransition = (typeof WALLET_LIFECYCLE_TRANSITIONS)[number];

export interface WalletAccountHint {
  readonly chainId: ChainId;
  /** Redacted display value. It is never suitable for signing or identity decisions. */
  readonly address: string;
}

/**
 * Safe-to-persist wallet roster metadata. Live provider state and raw addresses
 * deliberately have no representation in this contract.
 */
export interface PersistedWalletRosterEntry {
  readonly connectionId: string;
  readonly connectorId: string;
  readonly namespace: WalletNamespace;
  readonly label: string;
  readonly selectedAccount: WalletAccountHint;
  readonly status: WalletLifecycleStatus;
  readonly lifecycleRevision: number;
  readonly connectedAt: string;
  readonly updatedAt: string;
  readonly disconnectedAt?: string;
  readonly lastTransition: WalletLifecycleTransition;
}

export interface WalletRosterSnapshot {
  readonly version: typeof WALLET_ROSTER_VERSION;
  readonly entries: readonly PersistedWalletRosterEntry[];
}

export interface WalletRosterStore {
  read(): WalletRosterSnapshot | null;
  write(snapshot: WalletRosterSnapshot): void;
  clear(): void;
}

export interface WalletRosterKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class WalletRosterStorageError extends Error {
  constructor() {
    super('wallet roster storage is unavailable');
    this.name = 'WalletRosterStorageError';
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): void {
  const allowedKeys = new Set([...expectedKeys, ...optionalKeys]);
  const actualKeys = Object.keys(value);
  if (
    expectedKeys.some((key) => !Object.hasOwn(value, key)) ||
    actualKeys.some((key) => !allowedKeys.has(key))
  ) {
    throw new TypeError('wallet roster contains unexpected fields');
  }
}

function assertSafeText(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    FORBIDDEN_TEXT.test(value)
  ) {
    throw new TypeError(`${label} must be bounded safe text`);
  }
}

function assertCanonicalTimestamp(value: unknown, label: string): asserts value is string {
  assertSafeText(value, label, 24);
  if (!CANONICAL_UTC_DATE_TIME.test(value)) {
    throw new TypeError(`${label} must be a canonical UTC date-time`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC date-time`);
  }
}

function assertOneOf<const Value extends string>(
  value: unknown,
  values: readonly Value[],
  label: string,
): asserts value is Value {
  if (typeof value !== 'string' || !values.includes(value as Value)) {
    throw new TypeError(`${label} is unsupported`);
  }
}

function parseAccountHint(value: unknown, namespace: WalletNamespace): WalletAccountHint {
  assertRecord(value, 'wallet roster selected account');
  assertExactKeys(value, ['chainId', 'address']);
  assertSafeText(value.chainId, 'wallet roster chainId', MAX_IDENTIFIER_LENGTH);
  assertSafeText(value.address, 'wallet roster address hint', MAX_IDENTIFIER_LENGTH);

  if (!SAFE_CHAIN_ID.test(value.chainId) || !value.chainId.startsWith(`${namespace}:`)) {
    throw new TypeError('wallet roster chainId is unsupported');
  }
  const validAddressHint =
    namespace === 'eip155'
      ? EVM_ADDRESS_HINT.test(value.address)
      : SOLANA_ADDRESS_HINT.test(value.address);
  if (!validAddressHint) {
    throw new TypeError('wallet roster address must be redacted');
  }

  return {
    chainId: value.chainId as ChainId,
    address: value.address,
  };
}

function parseEntry(value: unknown): PersistedWalletRosterEntry {
  assertRecord(value, 'wallet roster entry');
  assertExactKeys(
    value,
    [
      'connectionId',
      'connectorId',
      'namespace',
      'label',
      'selectedAccount',
      'status',
      'lifecycleRevision',
      'connectedAt',
      'updatedAt',
      'lastTransition',
    ],
    ['disconnectedAt'],
  );
  assertSafeText(value.connectionId, 'wallet roster connectionId', MAX_IDENTIFIER_LENGTH);
  assertSafeText(value.connectorId, 'wallet roster connectorId', MAX_IDENTIFIER_LENGTH);
  assertOneOf(value.namespace, ['eip155', 'solana'] as const, 'wallet roster namespace');
  assertSafeText(value.label, 'wallet roster label', MAX_LABEL_LENGTH);
  assertOneOf(value.status, WALLET_LIFECYCLE_STATUSES, 'wallet roster status');
  assertOneOf(value.lastTransition, WALLET_LIFECYCLE_TRANSITIONS, 'wallet roster transition');
  if (!Number.isSafeInteger(value.lifecycleRevision) || (value.lifecycleRevision as number) < 1) {
    throw new TypeError('wallet roster lifecycleRevision must be a positive safe integer');
  }
  assertCanonicalTimestamp(value.connectedAt, 'wallet roster connectedAt');
  assertCanonicalTimestamp(value.updatedAt, 'wallet roster updatedAt');
  if (Date.parse(value.updatedAt) < Date.parse(value.connectedAt)) {
    throw new TypeError('wallet roster updatedAt must not precede connectedAt');
  }

  let disconnectedAt: string | undefined;
  if (value.disconnectedAt !== undefined) {
    assertCanonicalTimestamp(value.disconnectedAt, 'wallet roster disconnectedAt');
    if (Date.parse(value.disconnectedAt) < Date.parse(value.connectedAt)) {
      throw new TypeError('wallet roster disconnectedAt must not precede connectedAt');
    }
    disconnectedAt = value.disconnectedAt;
  }
  const isDisconnected = value.status === 'disconnected' || value.status === 'session-expired';
  if (isDisconnected !== (disconnectedAt !== undefined)) {
    throw new TypeError('wallet roster disconnected state must include its timestamp');
  }
  if (disconnectedAt !== undefined && Date.parse(disconnectedAt) > Date.parse(value.updatedAt)) {
    throw new TypeError('wallet roster disconnect timestamp must not follow its update timestamp');
  }

  const validTransitionByStatus: Readonly<
    Record<WalletLifecycleStatus, readonly WalletLifecycleTransition[]>
  > = {
    'restore-required': ['page-reloaded'],
    'reverification-required': [
      'connected',
      'restored',
      'account-changed',
      'chain-changed',
      'session-updated',
    ],
    verified: ['ownership-verified'],
    disconnected: ['disconnected', 'provider-state-invalid'],
    'session-expired': ['session-expired'],
  };
  if (!validTransitionByStatus[value.status].includes(value.lastTransition)) {
    throw new TypeError('wallet roster status and transition are inconsistent');
  }

  return {
    connectionId: value.connectionId,
    connectorId: value.connectorId,
    namespace: value.namespace,
    label: value.label,
    selectedAccount: parseAccountHint(value.selectedAccount, value.namespace),
    status: value.status,
    lifecycleRevision: value.lifecycleRevision as number,
    connectedAt: value.connectedAt,
    updatedAt: value.updatedAt,
    ...(disconnectedAt === undefined ? {} : { disconnectedAt }),
    lastTransition: value.lastTransition,
  };
}

export function parseWalletRosterSnapshot(value: unknown): WalletRosterSnapshot {
  assertRecord(value, 'wallet roster');
  assertExactKeys(value, ['version', 'entries']);
  if (value.version !== WALLET_ROSTER_VERSION) {
    throw new TypeError('wallet roster version is unsupported');
  }
  if (!Array.isArray(value.entries) || value.entries.length > MAX_WALLET_ROSTER_ENTRIES) {
    throw new TypeError(`wallet roster must contain at most ${MAX_WALLET_ROSTER_ENTRIES} entries`);
  }

  const entries = value.entries.map(parseEntry);
  const connectionIds = new Set<string>();
  for (const entry of entries) {
    if (connectionIds.has(entry.connectionId)) {
      throw new TypeError('wallet roster connection IDs must be unique');
    }
    connectionIds.add(entry.connectionId);
  }

  return {
    version: WALLET_ROSTER_VERSION,
    entries,
  };
}

export function walletAddressHint(account: WalletAccount): string {
  assertWalletAccount(account);
  if (account.chainId.startsWith('eip155:')) {
    const normalized = account.address.toLowerCase();
    return `${normalized.slice(0, 6)}\u2026${normalized.slice(-4)}`;
  }
  return `${account.address.slice(0, 4)}\u2026${account.address.slice(-4)}`;
}

/**
 * Browser adapter intended for an explicitly supplied sessionStorage object.
 * It never reaches for ambient browser globals, making restoration an explicit
 * application action and keeping tests provider/network-free.
 */
export class StorageBackedWalletRosterStore implements WalletRosterStore {
  constructor(
    private readonly storage: WalletRosterKeyValueStorage,
    private readonly key = WALLET_ROSTER_STORAGE_KEY,
  ) {
    assertSafeText(key, 'wallet roster storage key', MAX_IDENTIFIER_LENGTH);
  }

  read(): WalletRosterSnapshot | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      throw new WalletRosterStorageError();
    }
    if (raw === null) return null;
    if (raw.length === 0 || raw.length > MAX_ROSTER_JSON_LENGTH) {
      throw new WalletRosterStorageError();
    }

    try {
      return parseWalletRosterSnapshot(JSON.parse(raw) as unknown);
    } catch {
      throw new WalletRosterStorageError();
    }
  }

  write(snapshot: WalletRosterSnapshot): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(parseWalletRosterSnapshot(snapshot));
    } catch {
      throw new WalletRosterStorageError();
    }
    if (serialized.length > MAX_ROSTER_JSON_LENGTH) {
      throw new WalletRosterStorageError();
    }

    try {
      this.storage.setItem(this.key, serialized);
    } catch {
      throw new WalletRosterStorageError();
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      throw new WalletRosterStorageError();
    }
  }
}
