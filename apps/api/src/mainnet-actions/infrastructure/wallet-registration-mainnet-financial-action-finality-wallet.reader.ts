import { isProxy } from 'node:util/types';

import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import { MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT } from '../../wallets/application/ports/wallet-registration-repository.port';
import {
  ACTIVE_WALLET_ROSTER_VERSION,
  type ActiveRegisteredWallet,
  type WalletRegistrationService,
} from '../../wallets/application/wallet-registration.service';
import { parseWalletAddress, type WalletAddress } from '../../wallets/domain/wallet-identity';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
  type MainnetFinancialActionFinalityPrerequisiteIssuerClock,
  type MainnetFinancialActionFinalityWalletReaderPort,
  type MainnetFinancialActionFinalityWalletResultV1,
  type ReadMainnetFinancialActionFinalityWalletRequestV1,
} from '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const MAX_SMALLINT = 32_767;
const MAINNET_REGISTRY = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const DATE_GET_TIME = Object.getOwnPropertyDescriptor(Date.prototype, 'getTime')?.value as
  ((this: Date) => number) | undefined;
const DATE_TO_ISO_STRING = Object.getOwnPropertyDescriptor(Date.prototype, 'toISOString')?.value as
  ((this: Date) => string) | undefined;

const REQUEST_KEYS = Object.freeze([
  'readerVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'accountId',
  'walletRegistrationId',
  'networkId',
  'walletIdentityDigestVersion',
  'walletIdentityDigestHex',
  'deadlineAt',
  'signal',
] as const);
const ROSTER_KEYS = Object.freeze(['version', 'wallets'] as const);
const WALLET_KEYS = Object.freeze([
  'walletId',
  'chainId',
  'address',
  'registeredAt',
  'registryEnvironment',
  'registryVersion',
  'registryFingerprintSha256',
] as const);

export type MainnetFinancialActionFinalityWalletReaderFailureCode =
  'INVALID_CONFIGURATION' | 'INVALID_REQUEST' | 'STALE_REQUEST' | 'WALLET_UNAVAILABLE';

export class DormantMainnetFinancialActionFinalityWalletUnavailableError extends Error {
  constructor(readonly code: MainnetFinancialActionFinalityWalletReaderFailureCode) {
    super('The active mainnet wallet registration is unavailable.');
    this.name = 'DormantMainnetFinancialActionFinalityWalletUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

interface CapturedMethod<Method extends (...arguments_: never[]) => unknown> {
  readonly receiver: object;
  readonly method: Method;
}

interface CanonicalTime {
  readonly value: string;
  readonly milliseconds: number;
}

interface ReviewedRequest {
  readonly request: ReadMainnetFinancialActionFinalityWalletRequestV1 & object;
  readonly accountId: AccountId;
  readonly walletRegistrationId: string;
  readonly networkId: typeof ETHEREUM | typeof SOLANA;
  readonly walletIdentityDigestVersion: number;
  readonly walletIdentityDigestHex: string;
  readonly deadlineAt: CanonicalTime;
  readonly signal: AbortSignal;
}

interface IssuedWallet {
  readonly capability: object;
  readonly request: ReadMainnetFinancialActionFinalityWalletRequestV1 & object;
  readonly result: MainnetFinancialActionFinalityWalletResultV1;
  readonly signal: AbortSignal;
  readonly issuedAtMilliseconds: number;
  readonly deadlineAtMilliseconds: number;
}

function fail(code: MainnetFinancialActionFinalityWalletReaderFailureCode): never {
  throw new DormantMainnetFinancialActionFinalityWalletUnavailableError(code);
}

function nullRecord<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function stableMember(value: unknown, key: PropertyKey): unknown {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value)
    ) {
      return fail('INVALID_CONFIGURATION');
    }
    let current: object | null = value as object;
    for (let depth = 0; current !== null && depth < 12; depth += 1) {
      if (isProxy(current)) return fail('INVALID_CONFIGURATION');
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!('value' in descriptor)) return fail('INVALID_CONFIGURATION');
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
    return fail('INVALID_CONFIGURATION');
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityWalletUnavailableError) throw error;
    return fail('INVALID_CONFIGURATION');
  }
}

function captureMethod<Method extends (...arguments_: never[]) => unknown>(
  value: unknown,
  key: PropertyKey,
): CapturedMethod<Method> {
  const method = stableMember(value, key);
  if (typeof method !== 'function' || isProxy(method)) return fail('INVALID_CONFIGURATION');
  return Object.freeze({ receiver: value as object, method: method as Method });
}

function exactFrozenRecord(
  value: unknown,
  keys: readonly string[],
  prototype: object | null,
  code: MainnetFinancialActionFinalityWalletReaderFailureCode,
): Record<string, unknown> {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== prototype ||
      !Object.isFrozen(value)
    ) {
      return fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail(code);
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.configurable ||
        !('value' in descriptor) ||
        descriptor.writable
      ) {
        return fail(code);
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityWalletUnavailableError) throw error;
    return fail(code);
  }
}

function authenticSignal(
  value: unknown,
  code: MainnetFinancialActionFinalityWalletReaderFailureCode,
): AbortSignal {
  try {
    if (
      (typeof value !== 'object' && typeof value !== 'function') ||
      value === null ||
      isProxy(value) ||
      ABORTED_GETTER === undefined
    ) {
      return fail(code);
    }
    Reflect.apply(ABORTED_GETTER, value, []);
    return value as AbortSignal;
  } catch {
    return fail(code);
  }
}

function aborted(signal: AbortSignal): boolean {
  try {
    return ABORTED_GETTER === undefined || (Reflect.apply(ABORTED_GETTER, signal, []) as boolean);
  } catch {
    return true;
  }
}

function timestamp(
  value: unknown,
  code: MainnetFinancialActionFinalityWalletReaderFailureCode,
): CanonicalTime {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) return fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return fail(code);
  }
  return Object.freeze({ value, milliseconds });
}

function clockTime(
  captured: CapturedMethod<MainnetFinancialActionFinalityPrerequisiteIssuerClock['now']>,
): CanonicalTime {
  try {
    if (DATE_GET_TIME === undefined || DATE_TO_ISO_STRING === undefined) {
      return fail('INVALID_CONFIGURATION');
    }
    const value = Reflect.apply(captured.method, captured.receiver, []) as unknown;
    if (typeof value !== 'object' || value === null || isProxy(value)) {
      return fail('INVALID_CONFIGURATION');
    }
    const milliseconds = Reflect.apply(DATE_GET_TIME, value, []) as number;
    const canonical = Reflect.apply(DATE_TO_ISO_STRING, value, []) as string;
    if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== canonical) {
      return fail('INVALID_CONFIGURATION');
    }
    return Object.freeze({ value: canonical, milliseconds });
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityWalletUnavailableError) throw error;
    return fail('INVALID_CONFIGURATION');
  }
}

function reviewRequest(value: unknown): ReviewedRequest {
  const record = exactFrozenRecord(value, REQUEST_KEYS, null, 'INVALID_REQUEST');
  if (
    record.readerVersion !== MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION ||
    record.use !== MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false
  ) {
    return fail('INVALID_REQUEST');
  }
  let accountId: AccountId;
  try {
    accountId = parseAccountId(record.accountId);
  } catch {
    return fail('INVALID_REQUEST');
  }
  const walletRegistrationId = record.walletRegistrationId;
  const networkId = record.networkId;
  const digestVersion = record.walletIdentityDigestVersion;
  const digestHex = record.walletIdentityDigestHex;
  if (
    typeof walletRegistrationId !== 'string' ||
    !UUID_V4.test(walletRegistrationId) ||
    (networkId !== ETHEREUM && networkId !== SOLANA) ||
    !Number.isSafeInteger(digestVersion) ||
    (digestVersion as number) < 1 ||
    (digestVersion as number) > MAX_SMALLINT ||
    typeof digestHex !== 'string' ||
    !SHA256.test(digestHex) ||
    /^0{64}$/u.test(digestHex)
  ) {
    return fail('INVALID_REQUEST');
  }
  return Object.freeze({
    request: value as ReadMainnetFinancialActionFinalityWalletRequestV1 & object,
    accountId,
    walletRegistrationId,
    networkId,
    walletIdentityDigestVersion: digestVersion as number,
    walletIdentityDigestHex: digestHex,
    deadlineAt: timestamp(record.deadlineAt, 'INVALID_REQUEST'),
    signal: authenticSignal(record.signal, 'INVALID_REQUEST'),
  });
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4.test(value)) return fail('WALLET_UNAVAILABLE');
  return value;
}

function activeWallet(value: unknown): ActiveRegisteredWallet {
  const record = exactFrozenRecord(value, WALLET_KEYS, Object.prototype, 'WALLET_UNAVAILABLE');
  const chainId = record.chainId;
  if (
    (chainId !== ETHEREUM && chainId !== SOLANA) ||
    record.registryEnvironment !== 'MAINNET' ||
    record.registryVersion !== MAINNET_REGISTRY.version ||
    record.registryFingerprintSha256 !== MAINNET_REGISTRY.fingerprintSha256
  ) {
    return fail('WALLET_UNAVAILABLE');
  }
  timestamp(record.registeredAt, 'WALLET_UNAVAILABLE');
  const fingerprint = record.registryFingerprintSha256;
  if (
    typeof fingerprint !== 'string' ||
    !SHA256.test(fingerprint) ||
    /^0{64}$/u.test(fingerprint)
  ) {
    return fail('WALLET_UNAVAILABLE');
  }
  let address: WalletAddress;
  try {
    address = parseWalletAddress(chainId, record.address);
  } catch {
    return fail('WALLET_UNAVAILABLE');
  }
  return Object.freeze({
    walletId: uuid(record.walletId),
    chainId,
    address,
    registeredAt: record.registeredAt as string,
    registryEnvironment: 'MAINNET',
    registryVersion: MAINNET_REGISTRY.version,
    registryFingerprintSha256: fingerprint,
  });
}

function exactFrozenNativeArray(value: unknown): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isFrozen(value) ||
      value.length > MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT
    ) {
      return fail('WALLET_UNAVAILABLE');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const actualKeys = Reflect.ownKeys(descriptors);
    const expectedKeys = [
      ...Array.from({ length: value.length }, (_, index) => String(index)),
      'length',
    ];
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail('WALLET_UNAVAILABLE');
    }
    const length = descriptors.length;
    if (
      length === undefined ||
      !('value' in length) ||
      length.value !== value.length ||
      length.enumerable ||
      length.configurable ||
      length.writable
    ) {
      return fail('WALLET_UNAVAILABLE');
    }
    const elements: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.configurable ||
        !('value' in descriptor) ||
        descriptor.writable
      ) {
        return fail('WALLET_UNAVAILABLE');
      }
      elements.push(descriptor.value);
    }
    return Object.freeze(elements);
  } catch (error) {
    if (error instanceof DormantMainnetFinancialActionFinalityWalletUnavailableError) throw error;
    return fail('WALLET_UNAVAILABLE');
  }
}

function activeRoster(value: unknown): readonly ActiveRegisteredWallet[] {
  const record = exactFrozenRecord(value, ROSTER_KEYS, Object.prototype, 'WALLET_UNAVAILABLE');
  if (record.version !== ACTIVE_WALLET_ROSTER_VERSION) return fail('WALLET_UNAVAILABLE');
  return Object.freeze(
    exactFrozenNativeArray(record.wallets).map((wallet) => activeWallet(wallet)),
  );
}

function nativePromise(value: unknown): Promise<unknown> | null {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      isProxy(value) ||
      !(value instanceof Promise) ||
      Object.getPrototypeOf(value) !== Promise.prototype
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Dormant plaintext resolver for an already-authenticated migration-0036 row.
 * WalletRegistrationService remains the only owner of registration encryption
 * and HMAC key material. This wrapper proves current ACTIVE/nonrevoked account,
 * wallet, network, and address integrity; migration 0036 remains the sole proof
 * of the lifecycle-captured digest that is exact-bound through the request.
 *
 * The class is intentionally undecorated and unregistered. It owns no endpoint,
 * credential, provider transport, signer, broadcaster, writer, retry, or timer.
 */
export class WalletRegistrationMainnetFinancialActionFinalityWalletReader implements MainnetFinancialActionFinalityWalletReaderPort {
  readonly readerVersion = MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION;

  readonly #wallets: CapturedMethod<WalletRegistrationService['listActiveWallets']>;
  readonly #clock: CapturedMethod<MainnetFinancialActionFinalityPrerequisiteIssuerClock['now']>;
  readonly #startedRequests = new WeakSet<object>();
  readonly #issued = new WeakMap<object, IssuedWallet>();

  constructor(
    wallets: WalletRegistrationService,
    clock: MainnetFinancialActionFinalityPrerequisiteIssuerClock,
  ) {
    this.#wallets = captureMethod<WalletRegistrationService['listActiveWallets']>(
      wallets,
      'listActiveWallets',
    );
    this.#clock = captureMethod<MainnetFinancialActionFinalityPrerequisiteIssuerClock['now']>(
      clock,
      'now',
    );
  }

  async readWallet(
    requestInput: ReadMainnetFinancialActionFinalityWalletRequestV1,
  ): Promise<unknown> {
    const request = reviewRequest(requestInput);
    const startedAt = clockTime(this.#clock);
    if (request.deadlineAt.milliseconds - startedAt.milliseconds > MAX_DEADLINE_MILLISECONDS) {
      return fail('INVALID_REQUEST');
    }
    if (
      this.#startedRequests.has(request.request) ||
      aborted(request.signal) ||
      startedAt.milliseconds >= request.deadlineAt.milliseconds
    ) {
      return fail('STALE_REQUEST');
    }
    this.#startedRequests.add(request.request);

    let pending: unknown;
    try {
      pending = Reflect.apply(this.#wallets.method, this.#wallets.receiver, [
        request.accountId,
        Object.freeze({ signal: request.signal }),
      ]);
    } catch {
      return fail('WALLET_UNAVAILABLE');
    }
    const operation = nativePromise(pending);
    if (operation === null) return fail('WALLET_UNAVAILABLE');

    let rawRoster: unknown;
    try {
      rawRoster = await operation;
    } catch {
      if (aborted(request.signal)) return fail('STALE_REQUEST');
      const failedAt = clockTime(this.#clock);
      if (failedAt.milliseconds >= request.deadlineAt.milliseconds) {
        return fail('STALE_REQUEST');
      }
      return fail('WALLET_UNAVAILABLE');
    }
    const completedAt = clockTime(this.#clock);
    if (
      aborted(request.signal) ||
      completedAt.milliseconds < startedAt.milliseconds ||
      completedAt.milliseconds >= request.deadlineAt.milliseconds
    ) {
      return fail('STALE_REQUEST');
    }

    const matches = activeRoster(rawRoster).filter(
      (wallet) =>
        wallet.walletId === request.walletRegistrationId && wallet.chainId === request.networkId,
    );
    if (matches.length !== 1) return fail('WALLET_UNAVAILABLE');
    const matched = matches[0];
    if (matched === undefined) return fail('WALLET_UNAVAILABLE');

    const result = nullRecord<MainnetFinancialActionFinalityWalletResultV1>({
      readerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
      use: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      accountId: request.accountId,
      walletRegistrationId: request.walletRegistrationId,
      networkId: request.networkId,
      walletIdentityDigestVersion: request.walletIdentityDigestVersion,
      walletIdentityDigestHex: request.walletIdentityDigestHex,
      walletAddress: matched.address as WalletAddress,
    });
    const issuedAt = clockTime(this.#clock);
    if (
      aborted(request.signal) ||
      issuedAt.milliseconds < completedAt.milliseconds ||
      issuedAt.milliseconds >= request.deadlineAt.milliseconds
    ) {
      return fail('STALE_REQUEST');
    }
    const capability = Object.freeze(Object.create(null) as object);
    this.#issued.set(
      capability,
      Object.freeze({
        capability,
        request: request.request,
        result,
        signal: request.signal,
        issuedAtMilliseconds: issuedAt.milliseconds,
        deadlineAtMilliseconds: request.deadlineAt.milliseconds,
      }),
    );
    return capability;
  }

  verifyWallet(
    capabilityInput: unknown,
    requestInput: ReadMainnetFinancialActionFinalityWalletRequestV1,
  ): MainnetFinancialActionFinalityWalletResultV1 | null {
    try {
      if (
        typeof capabilityInput !== 'object' ||
        capabilityInput === null ||
        isProxy(capabilityInput)
      ) {
        return null;
      }
      const request = reviewRequest(requestInput);
      const issued = this.#issued.get(capabilityInput);
      if (
        issued === undefined ||
        issued.capability !== capabilityInput ||
        issued.request !== request.request ||
        issued.signal !== request.signal ||
        aborted(issued.signal)
      ) {
        return null;
      }
      const reviewedAt = clockTime(this.#clock);
      if (
        reviewedAt.milliseconds < issued.issuedAtMilliseconds ||
        reviewedAt.milliseconds >= issued.deadlineAtMilliseconds
      ) {
        return null;
      }
      return issued.result;
    } catch {
      return null;
    }
  }
}
