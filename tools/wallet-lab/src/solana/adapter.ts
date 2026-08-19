import {
  SolanaSignIn,
  type SolanaSignInFeature,
  type SolanaSignInOutput,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
  type SolanaSignMessageOutput,
} from '@solana/wallet-standard-features';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardDisconnect,
  type StandardDisconnectFeature,
  StandardEvents,
  type StandardEventsChangeProperties,
  type StandardEventsFeature,
} from '@wallet-standard/features';

import {
  PhantomSolanaAdapterError,
  SOLANA_DEVNET_CHAIN,
  SOLANA_WALLET_LAB_DOMAIN,
  SOLANA_WALLET_LAB_ORIGIN,
  type ConnectedSolanaAccount,
  type DevnetSignInInput,
  type DiscoveredSolanaWallet,
  type PhantomConnectOptions,
  type PhantomSolanaAdapter,
  type PhantomSolanaAdapterOptions,
  type PhantomSolanaAdapterState,
  type SanitizedSolanaError,
  type SelectedWalletAccount,
  type SolanaSignInResult,
  type SolanaSignMessageResult,
  type SolanaWalletCapabilities,
  type WalletStandardRegistry,
} from './types';
import { createDevnetSignInMessage } from './verification';

const PHANTOM_WALLET_NAME = 'phantom';
const MAX_NAME_LENGTH = 80;
const MAX_ADDRESS_LENGTH = 64;
const MAX_MESSAGE_LENGTH = 16_384;
const MAX_INPUT_STRING_LENGTH = 2_048;
const MAX_RESOURCES = 32;
const NONCE_PATTERN = /^[a-zA-Z0-9]{8,64}$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

type ConnectFeature = StandardConnectFeature[typeof StandardConnect];
type DisconnectFeature = StandardDisconnectFeature[typeof StandardDisconnect];
type EventsFeature = StandardEventsFeature[typeof StandardEvents];
type SignInFeature = SolanaSignInFeature[typeof SolanaSignIn];
type SignMessageFeature = SolanaSignMessageFeature[typeof SolanaSignMessage];
type WalletFeatureName = `${string}:${string}`;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBytes(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    'BYTES_PER_ELEMENT' in value &&
    value.BYTES_PER_ELEMENT === 1 &&
    Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function cloneBytes(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function featureRecord(
  wallet: Wallet,
  featureName: WalletFeatureName,
): Record<PropertyKey, unknown> | null {
  try {
    const feature: unknown = wallet.features[featureName];
    return isRecord(feature) ? feature : null;
  } catch {
    return null;
  }
}

function connectFeature(wallet: Wallet): ConnectFeature | null {
  const feature = featureRecord(wallet, StandardConnect);
  return feature !== null && typeof feature.connect === 'function'
    ? (feature as unknown as ConnectFeature)
    : null;
}

function disconnectFeature(wallet: Wallet): DisconnectFeature | null {
  const feature = featureRecord(wallet, StandardDisconnect);
  return feature !== null && typeof feature.disconnect === 'function'
    ? (feature as unknown as DisconnectFeature)
    : null;
}

function eventsFeature(wallet: Wallet): EventsFeature | null {
  const feature = featureRecord(wallet, StandardEvents);
  return feature !== null && typeof feature.on === 'function'
    ? (feature as unknown as EventsFeature)
    : null;
}

function signInFeature(wallet: Wallet): SignInFeature | null {
  const feature = featureRecord(wallet, SolanaSignIn);
  return feature !== null && typeof feature.signIn === 'function'
    ? (feature as unknown as SignInFeature)
    : null;
}

function signMessageFeature(wallet: Wallet): SignMessageFeature | null {
  const feature = featureRecord(wallet, SolanaSignMessage);
  return feature !== null && typeof feature.signMessage === 'function'
    ? (feature as unknown as SignMessageFeature)
    : null;
}

function walletSupportsDevnet(wallet: Wallet): boolean {
  try {
    return wallet.chains.some((chain) => chain === SOLANA_DEVNET_CHAIN);
  } catch {
    return false;
  }
}

function accountSupports(account: WalletAccount, featureName: WalletFeatureName): boolean {
  try {
    return account.features.some((feature) => feature === featureName);
  } catch {
    return false;
  }
}

function accountSupportsDevnet(account: WalletAccount): boolean {
  try {
    return account.chains.some((chain) => chain === SOLANA_DEVNET_CHAIN);
  } catch {
    return false;
  }
}

function sanitizeWalletName(wallet: Wallet): string | null {
  try {
    if (typeof wallet.name !== 'string') return null;
    const name = [...wallet.name]
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127 ? ' ' : character;
      })
      .join('')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, MAX_NAME_LENGTH);
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function isPhantomDevnetWallet(wallet: Wallet): boolean {
  const name = sanitizeWalletName(wallet);
  return (
    name?.toLocaleLowerCase('en-US') === PHANTOM_WALLET_NAME &&
    walletSupportsDevnet(wallet) &&
    connectFeature(wallet) !== null
  );
}

function decodeBase58(value: string): Uint8Array | null {
  if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) return null;

  const bytes = [0];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    if (carry < 0) return null;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += (bytes[index] ?? 0) * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroes = 0;
  while (value[leadingZeroes] === '1') leadingZeroes += 1;
  const significantLength = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  const decoded = new Uint8Array(leadingZeroes + significantLength);
  for (let index = 0; index < significantLength; index += 1) {
    decoded[decoded.length - index - 1] = bytes[index] ?? 0;
  }
  return decoded;
}

function assertValidDevnetAccount(account: WalletAccount): void {
  if (!accountSupportsDevnet(account)) {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet did not return a Solana devnet account.',
      false,
    );
  }
  if (typeof account.address !== 'string') {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet returned an invalid account.',
      false,
    );
  }
  const decodedAddress = decodeBase58(account.address);
  if (
    decodedAddress?.length !== 32 ||
    !isBytes(account.publicKey) ||
    account.publicKey.length !== 32 ||
    !bytesEqual(decodedAddress, account.publicKey)
  ) {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet returned an invalid account.',
      false,
    );
  }
}

function walletCapabilities(wallet: Wallet, account?: WalletAccount): SolanaWalletCapabilities {
  const signIn =
    signInFeature(wallet) !== null &&
    (account === undefined || accountSupports(account, SolanaSignIn));
  const signMessage =
    signMessageFeature(wallet) !== null &&
    (account === undefined || accountSupports(account, SolanaSignMessage));
  return {
    connect: connectFeature(wallet) !== null,
    disconnect: disconnectFeature(wallet) !== null,
    events: eventsFeature(wallet) !== null,
    signIn,
    signMessage,
    ownership: signIn ? SolanaSignIn : signMessage ? SolanaSignMessage : null,
  };
}

function cloneCapabilities(value: SolanaWalletCapabilities): SolanaWalletCapabilities {
  return { ...value };
}

function cloneDiscovered(value: DiscoveredSolanaWallet): DiscoveredSolanaWallet {
  return { ...value, capabilities: cloneCapabilities(value.capabilities) };
}

function cloneConnection(value: ConnectedSolanaAccount): ConnectedSolanaAccount {
  return { ...value, capabilities: cloneCapabilities(value.capabilities) };
}

function cloneError(value: SanitizedSolanaError): SanitizedSolanaError {
  return { ...value };
}

function publicConnection(selected: SelectedWalletAccount): ConnectedSolanaAccount {
  return {
    walletId: selected.walletId,
    walletName: sanitizeWalletName(selected.wallet) ?? 'Phantom',
    chain: SOLANA_DEVNET_CHAIN,
    address: selected.account.address,
    capabilities: walletCapabilities(selected.wallet, selected.account),
  };
}

function sanitizedError(error: unknown): PhantomSolanaAdapterError {
  if (error instanceof PhantomSolanaAdapterError) return error;

  let code: unknown;
  let name: unknown;
  try {
    if (isRecord(error)) {
      code = error.code;
      name = error.name;
    }
  } catch {
    // Never expose or retain untrusted wallet error fields.
  }

  if (code === 4001 || code === '4001') {
    return new PhantomSolanaAdapterError('user_rejected', 'The wallet request was rejected.', true);
  }
  if (name === 'AbortError') {
    return new PhantomSolanaAdapterError(
      'request_cancelled',
      'The wallet request was cancelled.',
      true,
    );
  }
  return new PhantomSolanaAdapterError(
    'wallet_request_failed',
    'The wallet could not complete the request.',
    true,
  );
}

function assertBoundedString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_INPUT_STRING_LENGTH) {
    throw new PhantomSolanaAdapterError('invalid_request', `${label} is invalid.`, false);
  }
}

function validateSignInInput(input: DevnetSignInInput, selected: SelectedWalletAccount): void {
  if (!isRecord(input)) {
    throw new PhantomSolanaAdapterError('invalid_request', 'The sign-in input is invalid.', false);
  }
  assertBoundedString(input.domain, 'The sign-in domain');
  assertBoundedString(input.address, 'The sign-in address');
  assertBoundedString(input.uri, 'The sign-in URI');
  assertBoundedString(input.nonce, 'The sign-in nonce');
  assertBoundedString(input.issuedAt, 'The sign-in issued-at value');
  assertBoundedString(input.expirationTime, 'The sign-in expiration');
  assertBoundedString(input.requestId, 'The sign-in request ID');

  if (
    input.chainId !== SOLANA_DEVNET_CHAIN ||
    input.version !== '1' ||
    input.address !== selected.account.address ||
    !NONCE_PATTERN.test(input.nonce)
  ) {
    throw new PhantomSolanaAdapterError(
      'invalid_request',
      'The sign-in request does not target the selected devnet account.',
      false,
    );
  }
  if (input.statement !== undefined) {
    assertBoundedString(input.statement, 'The sign-in statement');
    if (/[\r\n]/u.test(input.statement)) {
      throw new PhantomSolanaAdapterError(
        'invalid_request',
        'The sign-in statement is invalid.',
        false,
      );
    }
  }
  if (input.notBefore !== undefined) assertBoundedString(input.notBefore, 'The not-before value');
  if (
    input.resources !== undefined &&
    (!Array.isArray(input.resources) ||
      input.resources.length > MAX_RESOURCES ||
      input.resources.some(
        (resource) =>
          typeof resource !== 'string' ||
          resource.length === 0 ||
          resource.length > MAX_INPUT_STRING_LENGTH,
      ))
  ) {
    throw new PhantomSolanaAdapterError(
      'invalid_request',
      'The sign-in resources are invalid.',
      false,
    );
  }

  let uri: URL;
  try {
    uri = new URL(input.uri);
  } catch {
    throw new PhantomSolanaAdapterError('invalid_request', 'The sign-in URI is invalid.', false);
  }
  if (
    uri.origin !== SOLANA_WALLET_LAB_ORIGIN ||
    uri.host !== SOLANA_WALLET_LAB_DOMAIN ||
    input.domain !== SOLANA_WALLET_LAB_DOMAIN ||
    uri.username !== '' ||
    uri.password !== ''
  ) {
    throw new PhantomSolanaAdapterError(
      'invalid_request',
      'The sign-in request must target this localhost origin.',
      false,
    );
  }
}

function cloneSignInInput(input: DevnetSignInInput): DevnetSignInInput {
  return {
    ...input,
    ...(input.resources === undefined ? {} : { resources: [...input.resources] }),
  };
}

function validateSignatureBytes(value: unknown): Uint8Array {
  if (!isBytes(value) || value.length !== 64) {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet returned an invalid signature.',
      false,
    );
  }
  return cloneBytes(value);
}

function validateSignedMessage(value: unknown): Uint8Array {
  if (!isBytes(value) || value.length === 0 || value.length > MAX_MESSAGE_LENGTH) {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet returned invalid signed-message bytes.',
      false,
    );
  }
  return cloneBytes(value);
}

function validateSignInOutput(
  output: SolanaSignInOutput,
  selected: SelectedWalletAccount,
  input: DevnetSignInInput,
): SolanaSignInResult {
  assertValidDevnetAccount(output.account);
  if (output.account.address !== selected.account.address) {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet signed in with a different account.',
      false,
    );
  }
  if (output.signatureType !== undefined && output.signatureType !== 'ed25519') {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet returned an unsupported signature type.',
      false,
    );
  }
  const signedMessage = validateSignedMessage(output.signedMessage);
  if (!bytesEqual(signedMessage, createDevnetSignInMessage(input))) {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet did not sign the exact requested sign-in fields.',
      false,
    );
  }
  return {
    method: SolanaSignIn,
    chain: SOLANA_DEVNET_CHAIN,
    address: selected.account.address,
    account: {
      address: output.account.address,
      publicKey: cloneBytes(output.account.publicKey as Uint8Array),
    },
    signedMessage,
    signature: validateSignatureBytes(output.signature),
    signatureType: 'ed25519',
  };
}

function validateSignMessageOutput(
  output: SolanaSignMessageOutput,
  message: Uint8Array,
  selected: SelectedWalletAccount,
): SolanaSignMessageResult {
  if (output.signatureType !== undefined && output.signatureType !== 'ed25519') {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet returned an unsupported signature type.',
      false,
    );
  }
  const signedMessage = validateSignedMessage(output.signedMessage);
  if (!bytesEqual(signedMessage, message)) {
    throw new PhantomSolanaAdapterError(
      'invalid_wallet_response',
      'The wallet did not sign the exact requested message.',
      false,
    );
  }
  return {
    method: SolanaSignMessage,
    chain: SOLANA_DEVNET_CHAIN,
    address: selected.account.address,
    account: {
      address: selected.account.address,
      publicKey: cloneBytes(selected.account.publicKey as Uint8Array),
    },
    signedMessage,
    signature: validateSignatureBytes(output.signature),
    signatureType: 'ed25519',
  };
}

export function createPhantomSolanaAdapter(
  options: PhantomSolanaAdapterOptions = {},
): PhantomSolanaAdapter {
  if (options.expectedChain !== undefined && options.expectedChain !== SOLANA_DEVNET_CHAIN) {
    throw new PhantomSolanaAdapterError(
      'invalid_request',
      'The Phantom lab adapter supports Solana devnet only.',
      false,
    );
  }

  const registry: WalletStandardRegistry = options.wallets ?? getWallets();
  const listeners = new Set<(state: PhantomSolanaAdapterState) => void>();
  const walletIds = new WeakMap<Wallet, string>();
  let nextWalletId = 1;
  let knownWallets = new Map<string, Wallet>();
  let selected: SelectedWalletAccount | null = null;
  let selectionGeneration = 0;
  let walletEventsOff: (() => void) | null = null;
  let pending = false;
  let destroyed = false;
  let state: PhantomSolanaAdapterState = {
    status: 'disconnected',
    chain: SOLANA_DEVNET_CHAIN,
    wallets: [],
    connection: null,
    error: null,
  };

  function snapshot(): PhantomSolanaAdapterState {
    return {
      status: state.status,
      chain: state.chain,
      wallets: state.wallets.map(cloneDiscovered),
      connection: state.connection === null ? null : cloneConnection(state.connection),
      error: state.error === null ? null : cloneError(state.error),
    };
  }

  function publish(next: PhantomSolanaAdapterState): void {
    state = next;
    const nextSnapshot = snapshot();
    for (const listener of listeners) {
      try {
        listener(nextSnapshot);
      } catch {
        // A presentation listener must not break wallet lifecycle handling.
      }
    }
  }

  function update(
    updates: Partial<
      Pick<PhantomSolanaAdapterState, 'status' | 'wallets' | 'connection' | 'error'>
    >,
  ): void {
    publish({ ...state, ...updates });
  }

  function assertLive(): void {
    if (destroyed) {
      throw new PhantomSolanaAdapterError(
        'adapter_destroyed',
        'The wallet adapter has been destroyed.',
        false,
      );
    }
  }

  function assertIdle(): void {
    if (pending) {
      throw new PhantomSolanaAdapterError(
        'request_in_progress',
        'Another wallet request is already in progress.',
        true,
      );
    }
  }

  function setSelected(next: SelectedWalletAccount): void {
    selected = next;
    selectionGeneration += 1;
  }

  function bindSelected(current: SelectedWalletAccount): {
    readonly generation: number;
    readonly wallet: Wallet;
    readonly walletId: string;
    readonly address: string;
    readonly publicKey: Uint8Array;
  } {
    return {
      generation: selectionGeneration,
      wallet: current.wallet,
      walletId: current.walletId,
      address: current.account.address,
      publicKey: cloneBytes(current.account.publicKey as Uint8Array),
    };
  }

  function assertSelectedRemainsBound(
    binding: ReturnType<typeof bindSelected>,
  ): SelectedWalletAccount {
    if (
      selectionGeneration !== binding.generation ||
      selected === null ||
      selected.wallet !== binding.wallet ||
      selected.walletId !== binding.walletId ||
      selected.account.address !== binding.address ||
      !isBytes(selected.account.publicKey) ||
      !bytesEqual(selected.account.publicKey, binding.publicKey)
    ) {
      throw new PhantomSolanaAdapterError(
        'wallet_unavailable',
        'The selected wallet account changed before signing completed.',
        true,
      );
    }
    return selected;
  }

  function walletId(wallet: Wallet): string {
    let id = walletIds.get(wallet);
    if (id === undefined) {
      id = `phantom-wallet-${nextWalletId}`;
      nextWalletId += 1;
      walletIds.set(wallet, id);
    }
    return id;
  }

  function readRegistry(): readonly Wallet[] {
    try {
      return registry.get();
    } catch {
      return [];
    }
  }

  function refreshWallets(emit = true): readonly DiscoveredSolanaWallet[] {
    const nextKnown = new Map<string, Wallet>();
    const discovered: DiscoveredSolanaWallet[] = [];
    for (const wallet of readRegistry()) {
      if (!isPhantomDevnetWallet(wallet)) continue;
      const id = walletId(wallet);
      const name = sanitizeWalletName(wallet);
      if (name === null) continue;
      nextKnown.set(id, wallet);
      discovered.push({
        id,
        name,
        chain: SOLANA_DEVNET_CHAIN,
        capabilities: walletCapabilities(wallet),
      });
    }
    knownWallets = nextKnown;

    if (selected !== null && !knownWallets.has(selected.walletId)) {
      clearSelected();
      if (emit) {
        update({
          status: 'error',
          wallets: discovered,
          connection: null,
          error: {
            code: 'wallet_unavailable',
            message: 'The selected wallet is no longer available.',
            recoverable: true,
          },
        });
      }
      return discovered;
    }

    if (emit) update({ wallets: discovered });
    return discovered;
  }

  function clearSelected(): void {
    const off = walletEventsOff;
    walletEventsOff = null;
    if (selected !== null) {
      selected = null;
      selectionGeneration += 1;
    }
    try {
      off?.();
    } catch {
      // The account is already invalidated. A wallet cleanup error must not
      // preserve or resurrect a connection that the wallet cleared.
    }
  }

  function fail(error: unknown, keepConnection: boolean): PhantomSolanaAdapterError {
    const safe = sanitizedError(error);
    update({
      status: 'error',
      connection: keepConnection && selected !== null ? publicConnection(selected) : null,
      error: { code: safe.code, message: safe.message, recoverable: safe.recoverable },
    });
    return safe;
  }

  function selectAccount(
    accounts: readonly WalletAccount[],
    requestedAddress?: string,
  ): WalletAccount {
    const devnetAccounts: WalletAccount[] = [];
    const addresses = new Set<string>();
    for (const account of accounts) {
      assertValidDevnetAccount(account);
      if (addresses.has(account.address)) {
        throw new PhantomSolanaAdapterError(
          'invalid_wallet_response',
          'The wallet returned duplicate accounts.',
          false,
        );
      }
      addresses.add(account.address);
      devnetAccounts.push(account);
    }
    if (devnetAccounts.length === 0) {
      throw new PhantomSolanaAdapterError(
        'invalid_wallet_response',
        'The wallet did not authorize a Solana devnet account.',
        true,
      );
    }
    if (requestedAddress !== undefined) {
      const requested = devnetAccounts.find((account) => account.address === requestedAddress);
      if (requested === undefined) {
        throw new PhantomSolanaAdapterError(
          'invalid_request',
          'The requested account was not authorized by the wallet.',
          true,
        );
      }
      return requested;
    }
    if (devnetAccounts.length !== 1) {
      throw new PhantomSolanaAdapterError(
        'account_selection_required',
        'Select an exact authorized account before continuing.',
        true,
      );
    }
    const account = devnetAccounts[0];
    if (account === undefined) {
      throw new PhantomSolanaAdapterError(
        'invalid_wallet_response',
        'The wallet did not authorize a Solana devnet account.',
        true,
      );
    }
    return account;
  }

  function handleWalletChange(properties: StandardEventsChangeProperties): void {
    if (selected === null || properties.accounts === undefined) return;
    try {
      const current = selected;
      const accounts = properties.accounts;
      if (accounts.length === 0) {
        clearSelected();
        update({ status: 'disconnected', connection: null, error: null });
        return;
      }
      const stillSelected = accounts.find((account) => account.address === current.account.address);
      const account = stillSelected ?? selectAccount(accounts);
      assertValidDevnetAccount(account);
      setSelected({ ...current, account });
      update({ status: 'connected', connection: publicConnection(selected), error: null });
    } catch (error) {
      clearSelected();
      fail(error, false);
    }
  }

  function subscribeToWallet(wallet: Wallet): void {
    const feature = eventsFeature(wallet);
    if (feature === null) return;
    try {
      const off = feature.on('change', handleWalletChange);
      if (typeof off === 'function') walletEventsOff = off;
    } catch {
      walletEventsOff = null;
    }
  }

  const offRegister = registry.on('register', () => refreshWallets());
  const offUnregister = registry.on('unregister', () => refreshWallets());
  refreshWallets(false);
  state = { ...state, wallets: refreshWallets(false) };

  return {
    chain: SOLANA_DEVNET_CHAIN,

    discover(): readonly DiscoveredSolanaWallet[] {
      assertLive();
      return refreshWallets().map(cloneDiscovered);
    },

    async connect(
      id: string,
      connectOptions: PhantomConnectOptions = {},
    ): Promise<ConnectedSolanaAccount> {
      assertLive();
      assertIdle();
      if (selected !== null) {
        throw new PhantomSolanaAdapterError(
          'already_connected',
          'Disconnect the current wallet before connecting another.',
          true,
        );
      }
      const wallet = knownWallets.get(id);
      const feature = wallet === undefined ? null : connectFeature(wallet);
      if (wallet === undefined || feature === null) {
        throw fail(
          new PhantomSolanaAdapterError(
            'wallet_not_found',
            'The selected Phantom wallet is unavailable.',
            true,
          ),
          false,
        );
      }

      pending = true;
      update({ status: 'connecting', connection: null, error: null });
      try {
        const output = await feature.connect({ silent: false });
        if (!isRecord(output) || !Array.isArray(output.accounts)) {
          throw new PhantomSolanaAdapterError(
            'invalid_wallet_response',
            'The wallet returned an invalid connection response.',
            false,
          );
        }
        const account = selectAccount(output.accounts, connectOptions.accountAddress);
        if (!knownWallets.has(id)) {
          throw new PhantomSolanaAdapterError(
            'wallet_unavailable',
            'The selected wallet is no longer available.',
            true,
          );
        }
        const nextSelected = { wallet, walletId: id, account };
        setSelected(nextSelected);
        subscribeToWallet(wallet);
        const connection = publicConnection(nextSelected);
        update({ status: 'connected', connection, error: null });
        return cloneConnection(connection);
      } catch (error) {
        clearSelected();
        throw fail(error, false);
      } finally {
        pending = false;
      }
    },

    async disconnect(): Promise<void> {
      assertLive();
      assertIdle();
      if (selected === null) {
        update({ status: 'disconnected', connection: null, error: null });
        return;
      }

      const wallet = selected.wallet;
      pending = true;
      update({ status: 'disconnecting', error: null });
      try {
        const feature = disconnectFeature(wallet);
        if (feature !== null) await feature.disconnect();
        clearSelected();
        update({ status: 'disconnected', connection: null, error: null });
      } catch (error) {
        clearSelected();
        throw fail(error, false);
      } finally {
        pending = false;
      }
    },

    getOwnershipCapability() {
      assertLive();
      return selected === null
        ? null
        : walletCapabilities(selected.wallet, selected.account).ownership;
    },

    async signIn(input: DevnetSignInInput): Promise<SolanaSignInResult> {
      assertLive();
      assertIdle();
      if (selected === null) {
        throw new PhantomSolanaAdapterError(
          'wallet_not_connected',
          'Connect a wallet before signing in.',
          true,
        );
      }
      const current = selected;
      const feature = signInFeature(current.wallet);
      if (feature === null || !accountSupports(current.account, SolanaSignIn)) {
        throw new PhantomSolanaAdapterError(
          'unsupported_capability',
          'The selected wallet account does not support Solana sign-in.',
          true,
        );
      }
      validateSignInInput(input, current);
      const binding = bindSelected(current);

      pending = true;
      update({ status: 'signing', error: null });
      try {
        const outputs = await feature.signIn(cloneSignInInput(input));
        if (outputs.length !== 1 || outputs[0] === undefined) {
          throw new PhantomSolanaAdapterError(
            'invalid_wallet_response',
            'The wallet returned an invalid sign-in response.',
            false,
          );
        }
        const result = validateSignInOutput(outputs[0], current, input);
        const stillSelected = assertSelectedRemainsBound(binding);
        update({ status: 'connected', connection: publicConnection(stillSelected), error: null });
        return result;
      } catch (error) {
        throw fail(error, true);
      } finally {
        pending = false;
      }
    },

    async signMessage(message: Uint8Array): Promise<SolanaSignMessageResult> {
      assertLive();
      assertIdle();
      if (selected === null) {
        throw new PhantomSolanaAdapterError(
          'wallet_not_connected',
          'Connect a wallet before signing a message.',
          true,
        );
      }
      if (!isBytes(message) || message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
        throw new PhantomSolanaAdapterError(
          'invalid_request',
          'The message must contain 1-16384 bytes.',
          false,
        );
      }
      const current = selected;
      const feature = signMessageFeature(current.wallet);
      if (feature === null || !accountSupports(current.account, SolanaSignMessage)) {
        throw new PhantomSolanaAdapterError(
          'unsupported_capability',
          'The selected wallet account does not support Solana message signing.',
          true,
        );
      }
      const exactMessage = cloneBytes(message);
      const binding = bindSelected(current);

      pending = true;
      update({ status: 'signing', error: null });
      try {
        const outputs = await feature.signMessage({
          account: current.account,
          message: exactMessage,
        });
        if (outputs.length !== 1 || outputs[0] === undefined) {
          throw new PhantomSolanaAdapterError(
            'invalid_wallet_response',
            'The wallet returned an invalid message-signing response.',
            false,
          );
        }
        const result = validateSignMessageOutput(outputs[0], exactMessage, current);
        const stillSelected = assertSelectedRemainsBound(binding);
        update({ status: 'connected', connection: publicConnection(stillSelected), error: null });
        return result;
      } catch (error) {
        throw fail(error, true);
      } finally {
        pending = false;
      }
    },

    getState(): PhantomSolanaAdapterState {
      return snapshot();
    },

    subscribe(listener: (next: PhantomSolanaAdapterState) => void): () => void {
      assertLive();
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      offRegister();
      offUnregister();
      clearSelected();
      knownWallets.clear();
      state = { ...state, status: 'disconnected', wallets: [], connection: null, error: null };
      listeners.clear();
    },
  };
}
