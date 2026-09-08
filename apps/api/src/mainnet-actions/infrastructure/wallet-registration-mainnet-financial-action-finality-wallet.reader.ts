import { isProxy } from 'node:util/types';

import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import type { WalletRegistrationService } from '../../wallets/application/wallet-registration.service';
import { parseWalletAddress, type WalletAddress } from '../../wallets/domain/wallet-identity';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
  type MainnetFinancialActionFinalityPrerequisiteIssuerClock,
  type MainnetFinancialActionFinalityWalletReaderPort,
  type MainnetFinancialActionFinalityWalletResultV2,
  type ReadMainnetFinancialActionFinalityWalletRequestV2,
} from '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const POSITIVE_INT64 = /^[1-9][0-9]{0,18}$/u;
const MAX_DEADLINE_MILLISECONDS = 30_000;
const MAX_SMALLINT = 32_767;
const MAX_INT64 = (1n << 63n) - 1n;
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
  'intentId',
  'walletRegistrationId',
  'networkId',
  'walletIdentityDigestVersion',
  'walletIdentityDigestHex',
  'lifecycleRevision',
  'lifecycleSnapshotSha256',
  'lifecycleStage',
  'purpose',
  'deadlineAt',
  'signal',
] as const);
const RECOVERY_WALLET_KEYS = Object.freeze([
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'accountId',
  'intentId',
  'walletId',
  'chainId',
  'address',
  'lifecycleRevision',
  'lifecycleSnapshotSha256',
  'lifecycleStage',
  'walletStatus',
  'revokedAt',
  'verifiedAt',
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
  readonly request: ReadMainnetFinancialActionFinalityWalletRequestV2 & object;
  readonly accountId: AccountId;
  readonly intentId: string;
  readonly walletRegistrationId: string;
  readonly networkId: typeof ETHEREUM | typeof SOLANA;
  readonly walletIdentityDigestVersion: number;
  readonly walletIdentityDigestHex: string;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly lifecycleStage: ReadMainnetFinancialActionFinalityWalletRequestV2['lifecycleStage'];
  readonly purpose: ReadMainnetFinancialActionFinalityWalletRequestV2['purpose'];
  readonly deadlineAt: CanonicalTime;
  readonly signal: AbortSignal;
}

interface IssuedWallet {
  readonly capability: object;
  readonly request: ReadMainnetFinancialActionFinalityWalletRequestV2 & object;
  readonly result: MainnetFinancialActionFinalityWalletResultV2;
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
  const intentId = record.intentId;
  const walletRegistrationId = record.walletRegistrationId;
  const networkId = record.networkId;
  const digestVersion = record.walletIdentityDigestVersion;
  const digestHex = record.walletIdentityDigestHex;
  const lifecycleRevision = record.lifecycleRevision;
  const lifecycleSnapshotSha256 = record.lifecycleSnapshotSha256;
  const lifecycleStage = record.lifecycleStage;
  const purpose = record.purpose;
  if (
    typeof intentId !== 'string' ||
    !UUID_V4.test(intentId) ||
    typeof walletRegistrationId !== 'string' ||
    !UUID_V4.test(walletRegistrationId) ||
    (networkId !== ETHEREUM && networkId !== SOLANA) ||
    !Number.isSafeInteger(digestVersion) ||
    (digestVersion as number) < 1 ||
    (digestVersion as number) > MAX_SMALLINT ||
    typeof digestHex !== 'string' ||
    !SHA256.test(digestHex) ||
    /^0{64}$/u.test(digestHex) ||
    typeof lifecycleRevision !== 'string' ||
    !POSITIVE_INT64.test(lifecycleRevision) ||
    BigInt(lifecycleRevision) > MAX_INT64 ||
    typeof lifecycleSnapshotSha256 !== 'string' ||
    !SHA256.test(lifecycleSnapshotSha256) ||
    /^0{64}$/u.test(lifecycleSnapshotSha256) ||
    (purpose !== 'RECONCILIATION_ADMISSION' && purpose !== 'POST_FINALITY_REVIEW') ||
    (purpose === 'RECONCILIATION_ADMISSION'
      ? (lifecycleStage !== 'WALLET_SIGNED_SUBMISSION_BOUND' || lifecycleRevision !== '2') &&
        (lifecycleStage !== 'BROADCAST_OUTCOME_AMBIGUOUS' || lifecycleRevision !== '3') &&
        (lifecycleStage !== 'RECONCILIATION_AMBIGUOUS' || BigInt(lifecycleRevision) < 3n)
      : (lifecycleStage !== 'FINALIZED_SUCCESS' && lifecycleStage !== 'FINALIZED_FAILURE') ||
        BigInt(lifecycleRevision) < 3n)
  ) {
    return fail('INVALID_REQUEST');
  }
  return Object.freeze({
    request: value as ReadMainnetFinancialActionFinalityWalletRequestV2 & object,
    accountId,
    intentId,
    walletRegistrationId,
    networkId,
    walletIdentityDigestVersion: digestVersion as number,
    walletIdentityDigestHex: digestHex,
    lifecycleRevision,
    lifecycleSnapshotSha256,
    lifecycleStage:
      lifecycleStage as ReadMainnetFinancialActionFinalityWalletRequestV2['lifecycleStage'],
    purpose: purpose as ReadMainnetFinancialActionFinalityWalletRequestV2['purpose'],
    deadlineAt: timestamp(record.deadlineAt, 'INVALID_REQUEST'),
    signal: authenticSignal(record.signal, 'INVALID_REQUEST'),
  });
}

function recoveryWallet(
  value: unknown,
  request: ReviewedRequest,
  startedAt: CanonicalTime,
  completedAt: CanonicalTime,
): Readonly<{
  address: WalletAddress;
  walletStatus: 'ACTIVE' | 'REVOKED';
  revokedAt: string | null;
  verifiedAt: string;
}> {
  const record = exactFrozenRecord(
    value,
    RECOVERY_WALLET_KEYS,
    Object.prototype,
    'WALLET_UNAVAILABLE',
  );
  const walletStatus = record.walletStatus;
  const revokedAt =
    record.revokedAt === null ? null : timestamp(record.revokedAt, 'WALLET_UNAVAILABLE');
  const verifiedAt = timestamp(record.verifiedAt, 'WALLET_UNAVAILABLE');
  if (
    record.mayAuthorizeFinancialAction !== false ||
    record.mayPersist !== false ||
    record.accountId !== request.accountId ||
    record.intentId !== request.intentId ||
    record.walletId !== request.walletRegistrationId ||
    record.chainId !== request.networkId ||
    record.lifecycleRevision !== request.lifecycleRevision ||
    record.lifecycleSnapshotSha256 !== request.lifecycleSnapshotSha256 ||
    record.lifecycleStage !== request.lifecycleStage ||
    (walletStatus !== 'ACTIVE' && walletStatus !== 'REVOKED') ||
    (walletStatus === 'ACTIVE') !== (revokedAt === null) ||
    verifiedAt.milliseconds < startedAt.milliseconds ||
    verifiedAt.milliseconds > completedAt.milliseconds ||
    verifiedAt.milliseconds >= request.deadlineAt.milliseconds ||
    (revokedAt !== null && revokedAt.milliseconds > verifiedAt.milliseconds)
  ) {
    return fail('WALLET_UNAVAILABLE');
  }
  let address: WalletAddress;
  try {
    address = parseWalletAddress(request.networkId, record.address);
  } catch {
    return fail('WALLET_UNAVAILABLE');
  }
  return Object.freeze({
    address,
    walletStatus,
    revokedAt: revokedAt?.value ?? null,
    verifiedAt: verifiedAt.value,
  });
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
 * Dormant plaintext resolver for an already-authenticated migration-0038 row.
 * WalletRegistrationService remains the only owner of registration encryption
 * and HMAC key material. This wrapper proves the exact signed-bound recovery
 * account, intent, lifecycle, wallet, network, and address. Revoked wallets are
 * resolved only through the service's migration-0038 historical gate.
 *
 * The class is intentionally undecorated and unregistered. It owns no endpoint,
 * credential, provider transport, signer, broadcaster, writer, retry, or timer.
 */
export class WalletRegistrationMainnetFinancialActionFinalityWalletReader implements MainnetFinancialActionFinalityWalletReaderPort {
  readonly readerVersion = MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION;

  readonly #wallets: CapturedMethod<
    WalletRegistrationService['readMainnetFinancialActionRecoveryWallet']
  >;
  readonly #clock: CapturedMethod<MainnetFinancialActionFinalityPrerequisiteIssuerClock['now']>;
  readonly #startedRequests = new WeakSet<object>();
  readonly #issued = new WeakMap<object, IssuedWallet>();

  constructor(
    wallets: WalletRegistrationService,
    clock: MainnetFinancialActionFinalityPrerequisiteIssuerClock,
  ) {
    this.#wallets = captureMethod<
      WalletRegistrationService['readMainnetFinancialActionRecoveryWallet']
    >(wallets, 'readMainnetFinancialActionRecoveryWallet');
    this.#clock = captureMethod<MainnetFinancialActionFinalityPrerequisiteIssuerClock['now']>(
      clock,
      'now',
    );
  }

  async readWallet(
    requestInput: ReadMainnetFinancialActionFinalityWalletRequestV2,
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
        Object.freeze({
          accountId: request.accountId,
          intentId: request.intentId,
          lifecycleRevision: request.lifecycleRevision,
          lifecycleSnapshotSha256: request.lifecycleSnapshotSha256,
          purpose: request.purpose,
          deadlineAt: new Date(request.deadlineAt.milliseconds),
          signal: request.signal,
        }),
      ]);
    } catch {
      return fail('WALLET_UNAVAILABLE');
    }
    const operation = nativePromise(pending);
    if (operation === null) return fail('WALLET_UNAVAILABLE');

    let rawWallet: unknown;
    try {
      rawWallet = await operation;
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

    const matched = recoveryWallet(rawWallet, request, startedAt, completedAt);

    const result = nullRecord<MainnetFinancialActionFinalityWalletResultV2>({
      readerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
      use: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      accountId: request.accountId,
      intentId: request.intentId,
      walletRegistrationId: request.walletRegistrationId,
      networkId: request.networkId,
      walletIdentityDigestVersion: request.walletIdentityDigestVersion,
      walletIdentityDigestHex: request.walletIdentityDigestHex,
      lifecycleRevision: request.lifecycleRevision,
      lifecycleSnapshotSha256: request.lifecycleSnapshotSha256,
      lifecycleStage: request.lifecycleStage,
      purpose: request.purpose,
      walletStatus: matched.walletStatus,
      revokedAt: matched.revokedAt,
      verifiedAt: matched.verifiedAt,
      walletAddress: matched.address,
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
    requestInput: ReadMainnetFinancialActionFinalityWalletRequestV2,
  ): MainnetFinancialActionFinalityWalletResultV2 | null {
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
