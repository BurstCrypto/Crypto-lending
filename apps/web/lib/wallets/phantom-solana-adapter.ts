import {
  assertOwnershipChallengeTargetsConnection,
  assertOwnershipSignatureMatchesChallenge,
  assertWalletAccount,
  assertWalletConnection,
  solanaPublicKeyBytesForAddress,
  solanaWalletStandardChainForCaip,
  type OwnershipChallenge,
  type OwnershipSignature,
  type SiwsSignInInput,
  type SupportedSolanaCaipChainId,
  type WalletAdapter,
  type WalletConnection,
  type WalletEvent,
  type WalletProviderError,
} from './wallet-adapter';

export const PHANTOM_SOLANA_CONNECTOR_ID = 'phantom';

export type PhantomSolanaAdapterErrorCode =
  | 'ABORTED'
  | 'ACCOUNT_INVALID'
  | 'CONNECTION_NOT_FOUND'
  | 'DISCONNECT_FAILED'
  | 'PROVIDER_DISCONNECTED'
  | 'PROVIDER_FAILURE'
  | 'PROVIDER_INVALID'
  | 'REQUEST_PENDING'
  | 'SIGNATURE_INVALID'
  | 'SIGNING_UNAVAILABLE'
  | 'USER_REJECTED'
  | 'WALLET_UNAVAILABLE'
  | 'WRONG_CLUSTER';

const ERROR_MESSAGES: Readonly<Record<PhantomSolanaAdapterErrorCode, string>> = Object.freeze({
  ABORTED: 'Wallet operation aborted',
  ACCOUNT_INVALID: 'Wallet account state is invalid',
  CONNECTION_NOT_FOUND: 'Wallet connection is unavailable',
  DISCONNECT_FAILED: 'Wallet disconnect failed',
  PROVIDER_DISCONNECTED: 'Wallet provider disconnected',
  PROVIDER_FAILURE: 'Wallet provider operation failed',
  PROVIDER_INVALID: 'Wallet provider does not satisfy the required contract',
  REQUEST_PENDING: 'A wallet request is already pending',
  SIGNATURE_INVALID: 'Wallet signing result is invalid',
  SIGNING_UNAVAILABLE: 'Required wallet signing capability is unavailable',
  USER_REJECTED: 'Wallet request was rejected',
  WALLET_UNAVAILABLE: 'Phantom wallet is unavailable',
  WRONG_CLUSTER: 'Wallet cluster does not match application policy',
});

const RECOVERABLE_CODES = new Set<PhantomSolanaAdapterErrorCode>([
  'ABORTED',
  'PROVIDER_DISCONNECTED',
  'PROVIDER_FAILURE',
  'REQUEST_PENDING',
  'USER_REJECTED',
  'WALLET_UNAVAILABLE',
]);

/**
 * Closed, redacted adapter failure. Raw provider errors, messages, stacks, and
 * causes are deliberately never retained on this object.
 */
export class PhantomSolanaAdapterError extends Error {
  readonly code: PhantomSolanaAdapterErrorCode;
  readonly recoverable: boolean;

  constructor(code: PhantomSolanaAdapterErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'PhantomSolanaAdapterError';
    this.code = code;
    this.recoverable = RECOVERABLE_CODES.has(code);
  }

  toProviderError(): WalletProviderError {
    return Object.freeze({
      code: this.code,
      message: ERROR_MESSAGES[this.code],
      recoverable: this.recoverable,
    });
  }
}

type ProviderListener = (value?: unknown) => void;

/** Minimal injected-provider surface, kept private from product modules. */
export interface PhantomSolanaProvider {
  readonly isPhantom?: unknown;
  readonly publicKey?: unknown;
  readonly connect?: unknown;
  readonly disconnect?: unknown;
  readonly signMessage?: unknown;
  readonly signIn?: unknown;
  readonly on?: unknown;
  readonly off?: unknown;
  readonly removeListener?: unknown;
}

export interface PhantomSolanaAdapterOptions {
  /** Exact KAN-61 CAIP-2 network ID; aliases such as `solana:devnet` are rejected. */
  readonly chainId: SupportedSolanaCaipChainId;
  /**
   * Provider source selected by the application. It may wrap Wallet Standard;
   * `discoverInjectedPhantomSolanaProvider` is the guarded direct fallback.
   */
  readonly getProvider: () => unknown;
  readonly createConnectionId?: () => string;
}

interface ProviderAccess {
  readonly raw: Record<PropertyKey, unknown>;
  readonly connect: (...arguments_: readonly unknown[]) => unknown;
  readonly disconnect: (...arguments_: readonly unknown[]) => unknown;
  readonly signMessage: (...arguments_: readonly unknown[]) => unknown;
  readonly signIn?: (...arguments_: readonly unknown[]) => unknown;
  readonly on: (...arguments_: readonly unknown[]) => unknown;
  readonly off: (...arguments_: readonly unknown[]) => unknown;
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function tryRead(value: unknown, key: PropertyKey): unknown {
  if (!isObject(value)) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function readProviderValue(value: unknown, key: PropertyKey): unknown {
  if (!isObject(value)) throw new PhantomSolanaAdapterError('PROVIDER_INVALID');
  try {
    return Reflect.get(value, key);
  } catch {
    throw new PhantomSolanaAdapterError('PROVIDER_INVALID');
  }
}

function providerFunction(
  value: Record<PropertyKey, unknown>,
  key: PropertyKey,
): (...arguments_: readonly unknown[]) => unknown {
  const candidate = readProviderValue(value, key);
  if (typeof candidate !== 'function') {
    throw new PhantomSolanaAdapterError('PROVIDER_INVALID');
  }
  return candidate as (...arguments_: readonly unknown[]) => unknown;
}

function normalizeProvider(value: unknown): ProviderAccess {
  if (!isObject(value) || readProviderValue(value, 'isPhantom') !== true) {
    throw new PhantomSolanaAdapterError('WALLET_UNAVAILABLE');
  }
  const offCandidate = readProviderValue(value, 'off');
  const removeListenerCandidate = readProviderValue(value, 'removeListener');
  const off =
    typeof offCandidate === 'function'
      ? offCandidate
      : typeof removeListenerCandidate === 'function'
        ? removeListenerCandidate
        : undefined;
  if (off === undefined) throw new PhantomSolanaAdapterError('PROVIDER_INVALID');

  const signInCandidate = readProviderValue(value, 'signIn');
  if (signInCandidate !== undefined && typeof signInCandidate !== 'function') {
    throw new PhantomSolanaAdapterError('PROVIDER_INVALID');
  }

  return Object.freeze({
    raw: value,
    connect: providerFunction(value, 'connect'),
    disconnect: providerFunction(value, 'disconnect'),
    signMessage: providerFunction(value, 'signMessage'),
    ...(typeof signInCandidate === 'function'
      ? { signIn: signInCandidate as (...arguments_: readonly unknown[]) => unknown }
      : {}),
    on: providerFunction(value, 'on'),
    off: off as (...arguments_: readonly unknown[]) => unknown,
  });
}

/**
 * Direct-injection fallback. It intentionally never reads collision-prone
 * `window.solana`, rejects iframes/insecure contexts, and returns no vendor
 * object unless the complete bounded adapter surface is present.
 */
export function discoverInjectedPhantomSolanaProvider(
  windowValue: unknown,
): PhantomSolanaProvider | null {
  if (!isObject(windowValue)) return null;
  const secure = tryRead(windowValue, 'isSecureContext');
  const self = tryRead(windowValue, 'self');
  const top = tryRead(windowValue, 'top');
  if (secure !== true || self === undefined || self !== top) return null;

  const phantom = tryRead(windowValue, 'phantom');
  const provider = tryRead(phantom, 'solana');
  try {
    normalizeProvider(provider);
    return provider as PhantomSolanaProvider;
  } catch {
    return null;
  }
}

function readProviderErrorCode(value: unknown): string | number | undefined {
  const code = tryRead(value, 'code');
  if (typeof code === 'number' && Number.isSafeInteger(code)) return code;
  if (typeof code === 'string' && /^[A-Z0-9_-]{1,64}$/iu.test(code)) return code;
  return undefined;
}

function providerFailure(
  value: unknown,
  fallback: PhantomSolanaAdapterErrorCode,
): PhantomSolanaAdapterError {
  if (value instanceof PhantomSolanaAdapterError) return value;
  const code = readProviderErrorCode(value);
  if (code === 4001 || code === '4001' || code === 'USER_REJECTED') {
    return new PhantomSolanaAdapterError('USER_REJECTED');
  }
  if (code === -32002 || code === '-32002' || code === 'REQUEST_PENDING') {
    return new PhantomSolanaAdapterError('REQUEST_PENDING');
  }
  if (code === 4900 || code === '4900' || code === 'DISCONNECTED') {
    return new PhantomSolanaAdapterError('PROVIDER_DISCONNECTED');
  }
  return new PhantomSolanaAdapterError(fallback);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new PhantomSolanaAdapterError('ABORTED');
}

function copyBytes(value: unknown, expectedLength?: number): Uint8Array {
  const candidate = value as Uint8Array | null | undefined;
  if (
    !ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) !== '[object Uint8Array]' ||
    candidate?.BYTES_PER_ELEMENT !== 1 ||
    Object.prototype.toString.call(candidate.buffer) === '[object SharedArrayBuffer]'
  ) {
    throw new PhantomSolanaAdapterError('SIGNATURE_INVALID');
  }
  if (
    candidate.byteLength === 0 ||
    candidate.byteLength > 16_384 ||
    (expectedLength !== undefined && candidate.byteLength !== expectedLength)
  ) {
    throw new PhantomSolanaAdapterError('SIGNATURE_INVALID');
  }
  return Uint8Array.from(candidate);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function validatedAddress(value: unknown, chainId: SupportedSolanaCaipChainId): string {
  if (typeof value !== 'string') throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
  try {
    const account = { chainId, address: value };
    assertWalletAccount(account, 'solana');
    return account.address;
  } catch {
    throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
  }
}

function addressFromPublicKey(value: unknown, chainId: SupportedSolanaCaipChainId): string {
  if (typeof value === 'string') return validatedAddress(value, chainId);
  if (!isObject(value)) throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
  const toBase58 = readProviderValue(value, 'toBase58');
  if (typeof toBase58 !== 'function') throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
  let address: unknown;
  try {
    address = Reflect.apply(toBase58, value, []);
  } catch {
    throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
  }
  return validatedAddress(address, chainId);
}

function validatePublicKeyBytes(address: string, value: unknown): void {
  const actual = copyBytes(value, 32);
  const expected = solanaPublicKeyBytesForAddress(address);
  if (!bytesEqual(actual, expected)) throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
}

function validateClusterClaim(value: unknown, expectedCaip: SupportedSolanaCaipChainId): void {
  if (value === undefined) return;
  const expectedWalletChain = solanaWalletStandardChainForCaip(expectedCaip);
  const values = Array.isArray(value) ? value : [value];
  if (
    values.length === 0 ||
    !values.some((candidate) => candidate === expectedWalletChain || candidate === expectedCaip)
  ) {
    throw new PhantomSolanaAdapterError('WRONG_CLUSTER');
  }
}

function addressFromAccountCandidate(value: unknown, chainId: SupportedSolanaCaipChainId): string {
  if (!isObject(value)) return addressFromPublicKey(value, chainId);
  validateClusterClaim(readProviderValue(value, 'chains'), chainId);
  validateClusterClaim(readProviderValue(value, 'chainId'), chainId);

  const addressValue = readProviderValue(value, 'address');
  const publicKeyValue = readProviderValue(value, 'publicKey');
  if (addressValue === undefined) return addressFromPublicKey(publicKeyValue ?? value, chainId);

  const address = validatedAddress(addressValue, chainId);
  if (publicKeyValue instanceof Uint8Array) {
    validatePublicKeyBytes(address, publicKeyValue);
  } else if (publicKeyValue !== undefined) {
    const publicKeyAddress = addressFromPublicKey(publicKeyValue, chainId);
    if (publicKeyAddress !== address) throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
  } else {
    throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
  }
  return address;
}

function addressFromConnectionResult(
  result: unknown,
  provider: ProviderAccess,
  chainId: SupportedSolanaCaipChainId,
): string {
  if (!isObject(result)) throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
  validateClusterClaim(readProviderValue(result, 'chains'), chainId);
  validateClusterClaim(readProviderValue(result, 'chainId'), chainId);

  const accounts = readProviderValue(result, 'accounts');
  if (accounts !== undefined) {
    if (!Array.isArray(accounts) || accounts.length !== 1) {
      throw new PhantomSolanaAdapterError('ACCOUNT_INVALID');
    }
    return addressFromAccountCandidate(accounts[0], chainId);
  }

  const publicKey =
    readProviderValue(result, 'publicKey') ?? readProviderValue(provider.raw, 'publicKey');
  return addressFromPublicKey(publicKey, chainId);
}

function freezeConnection(
  connectionId: string,
  chainId: SupportedSolanaCaipChainId,
  address: string,
  restored: boolean,
  supportsSignIn: boolean,
): WalletConnection {
  const account = Object.freeze({ chainId, address });
  const methods = Object.freeze([
    'solana:signMessage',
    ...(supportsSignIn ? (['solana:signIn'] as const) : []),
  ]);
  const scope = Object.freeze({
    chainId,
    methods,
    events: Object.freeze(['accountChanged', 'disconnect']),
  });
  const connection = Object.freeze({
    connectionId,
    connectorId: PHANTOM_SOLANA_CONNECTOR_ID,
    accounts: Object.freeze([account]),
    approvedScopes: Object.freeze([scope]),
    selectedAccount: account,
    restored,
  });
  assertWalletConnection(connection, 'solana', PHANTOM_SOLANA_CONNECTOR_ID);
  return connection;
}

function defaultConnectionId(): string {
  if (typeof crypto !== 'object' || typeof crypto.randomUUID !== 'function') {
    throw new PhantomSolanaAdapterError('PROVIDER_INVALID');
  }
  return `phantom:${crypto.randomUUID()}`;
}

function validateConnectionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(value)) {
    throw new PhantomSolanaAdapterError('PROVIDER_INVALID');
  }
  return value;
}

function cloneSignInInput(input: SiwsSignInInput): SiwsSignInInput {
  return Object.freeze({
    ...input,
    ...(input.resources === undefined ? {} : { resources: Object.freeze([...input.resources]) }),
  });
}

class DefaultPhantomSolanaAdapter implements WalletAdapter {
  readonly connectorId = PHANTOM_SOLANA_CONNECTOR_ID;
  readonly namespace = 'solana' as const;

  private readonly chainId: SupportedSolanaCaipChainId;
  private readonly getProvider: () => unknown;
  private readonly createConnectionId: () => string;
  private readonly listeners = new Set<(event: WalletEvent) => void>();
  private connection: WalletConnection | null = null;
  private provider: ProviderAccess | null = null;
  private detachProviderListeners: (() => void) | null = null;
  private openPending: Promise<WalletConnection | null> | null = null;

  constructor(options: PhantomSolanaAdapterOptions) {
    solanaWalletStandardChainForCaip(options.chainId);
    if (typeof options.getProvider !== 'function') {
      throw new PhantomSolanaAdapterError('PROVIDER_INVALID');
    }
    if (
      options.createConnectionId !== undefined &&
      typeof options.createConnectionId !== 'function'
    ) {
      throw new PhantomSolanaAdapterError('PROVIDER_INVALID');
    }
    this.chainId = options.chainId;
    this.getProvider = options.getProvider;
    this.createConnectionId = options.createConnectionId ?? defaultConnectionId;
  }

  async connect(options: { readonly signal?: AbortSignal } = {}): Promise<WalletConnection> {
    throwIfAborted(options.signal);
    if (this.connection !== null) return this.connection;
    const result = await this.open(false, options.signal);
    throwIfAborted(options.signal);
    if (result !== null) return result;
    return this.connect(options);
  }

  async restore(options: { readonly signal?: AbortSignal } = {}): Promise<WalletConnection | null> {
    throwIfAborted(options.signal);
    if (this.connection !== null) return this.connection;
    const result = await this.open(true, options.signal);
    throwIfAborted(options.signal);
    return result;
  }

  private open(
    restored: boolean,
    signal: AbortSignal | undefined,
  ): Promise<WalletConnection | null> {
    if (this.openPending !== null) return this.openPending;
    const operation = this.performOpen(restored, signal);
    this.openPending = operation;
    operation.then(
      () => {
        if (this.openPending === operation) this.openPending = null;
      },
      () => {
        if (this.openPending === operation) this.openPending = null;
      },
    );
    return operation;
  }

  private async performOpen(
    restored: boolean,
    signal: AbortSignal | undefined,
  ): Promise<WalletConnection | null> {
    throwIfAborted(signal);
    let access: ProviderAccess;
    try {
      access = normalizeProvider(this.getProvider());
    } catch (error) {
      throw providerFailure(error, 'WALLET_UNAVAILABLE');
    }

    let result: unknown;
    try {
      result = await Reflect.apply(access.connect, access.raw, [
        restored ? Object.freeze({ onlyIfTrusted: true }) : undefined,
      ]);
    } catch (error) {
      const failure = providerFailure(error, 'PROVIDER_FAILURE');
      if (
        restored &&
        (failure.code === 'USER_REJECTED' || failure.code === 'PROVIDER_DISCONNECTED')
      ) {
        return null;
      }
      throw failure;
    }

    try {
      throwIfAborted(signal);
      const address = addressFromConnectionResult(result, access, this.chainId);
      const connectionId = validateConnectionId(this.createConnectionId());
      const connection = freezeConnection(
        connectionId,
        this.chainId,
        address,
        restored,
        access.signIn !== undefined,
      );
      this.provider = access;
      this.connection = connection;
      const detach = this.bindProviderListeners(access);
      if (this.provider !== access || this.connection !== connection) {
        detach();
        throw new PhantomSolanaAdapterError('PROVIDER_DISCONNECTED');
      }
      this.detachProviderListeners = detach;
      return connection;
    } catch (error) {
      if (this.provider === access) this.clearLocalConnection();
      await this.bestEffortDisconnect(access);
      throw providerFailure(error, 'ACCOUNT_INVALID');
    }
  }

  private bindProviderListeners(access: ProviderAccess): () => void {
    const accountChanged: ProviderListener = (value) => this.handleAccountChanged(access, value);
    const disconnected: ProviderListener = (value) => this.handleProviderDisconnect(access, value);
    let accountAttached = false;
    try {
      Reflect.apply(access.on, access.raw, ['accountChanged', accountChanged]);
      accountAttached = true;
      Reflect.apply(access.on, access.raw, ['disconnect', disconnected]);
    } catch {
      if (accountAttached) {
        try {
          Reflect.apply(access.off, access.raw, ['accountChanged', accountChanged]);
        } catch {
          // Exact cleanup is best effort after an untrusted provider violates its event contract.
        }
      }
      throw new PhantomSolanaAdapterError('PROVIDER_INVALID');
    }

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      for (const [event, listener] of [
        ['accountChanged', accountChanged],
        ['disconnect', disconnected],
      ] as const) {
        try {
          Reflect.apply(access.off, access.raw, [event, listener]);
        } catch {
          // Local authorization is already cleared; never retain or expose the raw cleanup error.
        }
      }
    };
  }

  private handleAccountChanged(access: ProviderAccess, value: unknown): void {
    if (this.provider !== access || this.connection === null) return;
    const current = this.connection;
    if (value === null || value === undefined) {
      this.clearLocalConnection();
      this.emit(
        Object.freeze({
          type: 'accountsChanged',
          connectionId: current.connectionId,
          connectorId: this.connectorId,
          connection: null,
        }),
      );
      return;
    }

    try {
      const address = addressFromAccountCandidate(value, this.chainId);
      if (address === current.selectedAccount.address) return;
      const next = freezeConnection(
        current.connectionId,
        this.chainId,
        address,
        current.restored,
        access.signIn !== undefined,
      );
      this.connection = next;
      this.emit(
        Object.freeze({
          type: 'accountsChanged',
          connectionId: current.connectionId,
          connectorId: this.connectorId,
          connection: next,
        }),
      );
    } catch {
      this.clearLocalConnection();
      this.emit(
        Object.freeze({
          type: 'disconnect',
          connectionId: current.connectionId,
          connectorId: this.connectorId,
          error: new PhantomSolanaAdapterError('ACCOUNT_INVALID').toProviderError(),
        }),
      );
    }
  }

  private handleProviderDisconnect(access: ProviderAccess, value: unknown): void {
    if (this.provider !== access || this.connection === null) return;
    const connectionId = this.connection.connectionId;
    this.clearLocalConnection();
    const failure = providerFailure(value, 'PROVIDER_DISCONNECTED');
    this.emit(
      Object.freeze({
        type: 'disconnect',
        connectionId,
        connectorId: this.connectorId,
        error: failure.toProviderError(),
      }),
    );
  }

  private clearLocalConnection(): ProviderAccess | null {
    const access = this.provider;
    const detach = this.detachProviderListeners;
    this.connection = null;
    this.provider = null;
    this.detachProviderListeners = null;
    detach?.();
    return access;
  }

  async disconnect(connectionId: string): Promise<void> {
    const current = this.connection;
    if (current === null || current.connectionId !== connectionId) {
      throw new PhantomSolanaAdapterError('CONNECTION_NOT_FOUND');
    }
    const access = this.clearLocalConnection();
    if (access === null) throw new PhantomSolanaAdapterError('CONNECTION_NOT_FOUND');
    try {
      await Reflect.apply(access.disconnect, access.raw, []);
      this.emit(
        Object.freeze({
          type: 'disconnect',
          connectionId,
          connectorId: this.connectorId,
        }),
      );
    } catch (error) {
      const failure = providerFailure(error, 'DISCONNECT_FAILED');
      this.emit(
        Object.freeze({
          type: 'disconnect',
          connectionId,
          connectorId: this.connectorId,
          error: failure.toProviderError(),
        }),
      );
      throw failure;
    }
  }

  async signOwnershipChallenge(
    connectionId: string,
    challenge: OwnershipChallenge,
  ): Promise<OwnershipSignature> {
    const connection = this.connection;
    const access = this.provider;
    if (connection === null || access === null || connection.connectionId !== connectionId) {
      throw new PhantomSolanaAdapterError('CONNECTION_NOT_FOUND');
    }
    assertOwnershipChallengeTargetsConnection(challenge, connection);

    if (challenge.format === 'siws-message') {
      const signedMessage = new TextEncoder().encode(challenge.message);
      let result: unknown;
      try {
        result = await Reflect.apply(access.signMessage, access.raw, [signedMessage, 'utf8']);
      } catch (error) {
        throw providerFailure(error, 'PROVIDER_FAILURE');
      }
      this.assertConnectionRevision(connection, access);
      if (!isObject(result)) throw new PhantomSolanaAdapterError('SIGNATURE_INVALID');
      const signerAddress = addressFromPublicKey(
        readProviderValue(result, 'publicKey'),
        this.chainId,
      );
      if (signerAddress !== connection.selectedAccount.address) {
        throw new PhantomSolanaAdapterError('SIGNATURE_INVALID');
      }
      const signature = Object.freeze({
        format: 'siws-message' as const,
        challengeId: challenge.id,
        chainId: challenge.chainId,
        address: connection.selectedAccount.address,
        signedMessage,
        signature: copyBytes(readProviderValue(result, 'signature'), 64),
        signatureType: 'ed25519' as const,
      });
      assertOwnershipSignatureMatchesChallenge(signature, challenge);
      return signature;
    }

    if (challenge.format !== 'siws-sign-in' || access.signIn === undefined) {
      throw new PhantomSolanaAdapterError('SIGNING_UNAVAILABLE');
    }
    const input = cloneSignInInput(challenge.input);
    let result: unknown;
    try {
      result = await Reflect.apply(access.signIn, access.raw, [input]);
    } catch (error) {
      throw providerFailure(error, 'PROVIDER_FAILURE');
    }
    this.assertConnectionRevision(connection, access);
    const candidate = Array.isArray(result) && result.length === 1 ? result[0] : result;
    if (!isObject(candidate)) throw new PhantomSolanaAdapterError('SIGNATURE_INVALID');
    const account = readProviderValue(candidate, 'account');
    if (!isObject(account)) throw new PhantomSolanaAdapterError('SIGNATURE_INVALID');
    const address = validatedAddress(readProviderValue(account, 'address'), this.chainId);
    const publicKey = copyBytes(readProviderValue(account, 'publicKey'), 32);
    validatePublicKeyBytes(address, publicKey);
    const signatureType = readProviderValue(candidate, 'signatureType');
    if (signatureType !== undefined && signatureType !== 'ed25519') {
      throw new PhantomSolanaAdapterError('SIGNATURE_INVALID');
    }
    const signature = Object.freeze({
      format: 'siws-sign-in' as const,
      challengeId: challenge.id,
      chainId: challenge.chainId,
      address,
      account: Object.freeze({ address, publicKey }),
      signedMessage: copyBytes(readProviderValue(candidate, 'signedMessage')),
      signature: copyBytes(readProviderValue(candidate, 'signature'), 64),
      signatureType: 'ed25519' as const,
    });
    assertOwnershipSignatureMatchesChallenge(signature, challenge);
    return signature;
  }

  private assertConnectionRevision(connection: WalletConnection, access: ProviderAccess): void {
    if (this.connection !== connection || this.provider !== access) {
      throw new PhantomSolanaAdapterError('CONNECTION_NOT_FOUND');
    }
  }

  subscribe(listener: (event: WalletEvent) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('wallet listener must be a function');
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private emit(event: WalletEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A product listener cannot break provider cleanup or another listener.
      }
    }
  }

  private async bestEffortDisconnect(access: ProviderAccess): Promise<void> {
    try {
      await Reflect.apply(access.disconnect, access.raw, []);
    } catch {
      // Failure is intentionally discarded; no local authorization was created.
    }
  }
}

export function createPhantomSolanaAdapter(options: PhantomSolanaAdapterOptions): WalletAdapter {
  return new DefaultPhantomSolanaAdapter(options);
}
