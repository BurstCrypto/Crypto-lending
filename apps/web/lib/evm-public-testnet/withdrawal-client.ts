import { readAuthenticationCsrfToken, type AuthenticationFetch } from '@/lib/authentication';
import { isAbortFailure, readBoundedJson, retryAfterSeconds } from '@/lib/authentication/http';

import {
  parseEvmPublicTestnetWithdrawalIntent,
  parseEvmPublicTestnetWithdrawalResult,
  validateEvmPublicTestnetWithdrawalRequest,
  type EvmPublicTestnetWithdrawalIntent,
  type EvmPublicTestnetWithdrawalRequest,
  type EvmPublicTestnetWithdrawalResult,
  type EvmPublicTestnetWithdrawalResultExpectation,
} from './withdrawal';

export const EVM_PUBLIC_TESTNET_WITHDRAWAL_INTENTS_PATH =
  '/api/v1/public-testnet/evm/withdrawal-intents' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;

export type EvmPublicTestnetWithdrawalApiErrorCode =
  | 'CONFLICT'
  | 'EMPTY_POSITION'
  | 'EVIDENCE_MISMATCH'
  | 'INVALID_RESPONSE'
  | 'NOT_FOUND'
  | 'REPLACED'
  | 'REVERTED'
  | 'UNAUTHENTICATED'
  | 'UNAVAILABLE';

const ERROR_MESSAGES: Readonly<Record<EvmPublicTestnetWithdrawalApiErrorCode, string>> =
  Object.freeze({
    CONFLICT: 'The withdrawal intent conflicts with other transaction evidence.',
    EMPTY_POSITION: 'There is no Base Sepolia aWETH position to withdraw.',
    EVIDENCE_MISMATCH: 'The transaction did not match the reviewed withdrawal step.',
    INVALID_RESPONSE: 'The withdrawal service returned an invalid response.',
    NOT_FOUND: 'The withdrawal recovery record is no longer available on the server.',
    REPLACED: 'The reviewed transaction nonce was replaced by another transaction.',
    REVERTED: 'The reviewed Base Sepolia withdrawal transaction reverted.',
    UNAUTHENTICATED: 'Authentication is required.',
    UNAVAILABLE: 'The Base Sepolia withdrawal service is unavailable.',
  });

export class EvmPublicTestnetWithdrawalApiError extends Error {
  readonly safeToStartFresh: boolean;

  constructor(
    readonly code: EvmPublicTestnetWithdrawalApiErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'EvmPublicTestnetWithdrawalApiError';
    this.safeToStartFresh = code === 'EMPTY_POSITION' || code === 'REPLACED' || code === 'REVERTED';
  }
}

export interface EvmPublicTestnetWithdrawalSubmission {
  readonly transactionHash: string;
}

export interface EvmPublicTestnetWithdrawalApi {
  prepare(
    request: EvmPublicTestnetWithdrawalRequest,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetWithdrawalIntent>;
  submit(
    expected: EvmPublicTestnetWithdrawalResultExpectation,
    submission: EvmPublicTestnetWithdrawalSubmission,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetWithdrawalResult>;
  /** Read-only recovery. This call can never authorize or broadcast a wallet transaction. */
  query(
    expected: EvmPublicTestnetWithdrawalResultExpectation,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetWithdrawalResult>;
}

export interface EvmPublicTestnetWithdrawalApiClientOptions {
  readonly cookieHeader?: string | (() => string);
  readonly fetch?: AuthenticationFetch;
  readonly now?: () => Date;
}

function fail(
  code: EvmPublicTestnetWithdrawalApiErrorCode = 'INVALID_RESPONSE',
  retry?: number,
): never {
  throw new EvmPublicTestnetWithdrawalApiError(code, retry);
}

function browserCookieHeader(): string {
  return typeof document === 'undefined' ? '' : document.cookie;
}

function requestInit(
  body: string,
  csrfToken: string,
  signal: AbortSignal | undefined,
): RequestInit {
  return {
    method: 'POST',
    body,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    ...(signal === undefined ? {} : { signal }),
  };
}

async function boundedErrorCode(response: Response): Promise<string | null> {
  try {
    const value = await readBoundedJson(response);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'code');
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function validExpectation(
  value: EvmPublicTestnetWithdrawalResultExpectation,
): EvmPublicTestnetWithdrawalResultExpectation {
  if (
    typeof value !== 'object' ||
    value === null ||
    !UUID_V4.test(value.intentId) ||
    (value.step !== 'APPROVE_AWETH' && value.step !== 'WITHDRAW_FULL_ETH') ||
    typeof value.aTokenBalanceBeforeAtomic !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,77})$/u.test(value.aTokenBalanceBeforeAtomic) ||
    BigInt(value.aTokenBalanceBeforeAtomic) <= 0n ||
    typeof value.allowanceBeforeAtomic !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,77})$/u.test(value.allowanceBeforeAtomic)
  ) {
    return fail();
  }
  return value;
}

export class EvmPublicTestnetWithdrawalApiClient implements EvmPublicTestnetWithdrawalApi {
  readonly #cookieHeader: string | (() => string);
  readonly #fetch: AuthenticationFetch;
  readonly #now: () => Date;

  constructor(options: EvmPublicTestnetWithdrawalApiClientOptions = {}) {
    this.#cookieHeader = options.cookieHeader ?? browserCookieHeader;
    this.#fetch =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    this.#now = options.now ?? (() => new Date());
  }

  async prepare(
    requestValue: EvmPublicTestnetWithdrawalRequest,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetWithdrawalIntent> {
    let request: EvmPublicTestnetWithdrawalRequest;
    try {
      request = validateEvmPublicTestnetWithdrawalRequest(requestValue);
    } catch {
      return fail();
    }
    const response = await this.#request(
      EVM_PUBLIC_TESTNET_WITHDRAWAL_INTENTS_PATH,
      JSON.stringify({ chainId: request.chainId, account: request.account }),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status === 404) return fail('NOT_FOUND');
    if (response.status === 409) {
      const code = await boundedErrorCode(response);
      return fail(
        code === 'EVM_PUBLIC_TESTNET_WITHDRAWAL_EMPTY_POSITION' ? 'EMPTY_POSITION' : 'CONFLICT',
      );
    }
    if (response.status === 422) return fail('EVIDENCE_MISMATCH');
    if (response.status !== 201) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parseEvmPublicTestnetWithdrawalIntent(
        await this.#json(response),
        request,
        this.#now(),
      );
    } catch {
      return fail();
    }
  }

  async submit(
    expectedValue: EvmPublicTestnetWithdrawalResultExpectation,
    submission: EvmPublicTestnetWithdrawalSubmission,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetWithdrawalResult> {
    const expected = validExpectation(expectedValue);
    if (
      typeof submission !== 'object' ||
      submission === null ||
      Object.keys(submission).length !== 1 ||
      typeof submission.transactionHash !== 'string' ||
      !HASH.test(submission.transactionHash)
    ) {
      return fail();
    }
    return this.#submission(expected, submission.transactionHash, signal);
  }

  async query(
    expectedValue: EvmPublicTestnetWithdrawalResultExpectation,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetWithdrawalResult> {
    return this.#submission(validExpectation(expectedValue), null, signal);
  }

  async #submission(
    expected: EvmPublicTestnetWithdrawalResultExpectation,
    transactionHash: string | null,
    signal: AbortSignal | undefined,
  ): Promise<EvmPublicTestnetWithdrawalResult> {
    const response = await this.#request(
      `${EVM_PUBLIC_TESTNET_WITHDRAWAL_INTENTS_PATH}/${expected.intentId}/submissions`,
      JSON.stringify(transactionHash === null ? {} : { transactionHash }),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status === 404 || response.status === 410) return fail('NOT_FOUND');
    if (response.status === 409) {
      const code = await boundedErrorCode(response);
      return fail(code === 'EVM_PUBLIC_TESTNET_TRANSACTION_REPLACED' ? 'REPLACED' : 'CONFLICT');
    }
    if (response.status === 422) {
      const code = await boundedErrorCode(response);
      return fail(
        code === 'EVM_PUBLIC_TESTNET_TRANSACTION_REVERTED' ? 'REVERTED' : 'EVIDENCE_MISMATCH',
      );
    }
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parseEvmPublicTestnetWithdrawalResult(
        await this.#json(response),
        expected,
        transactionHash ?? undefined,
      );
    } catch {
      return fail();
    }
  }

  async #request(path: string, body: string, signal: AbortSignal | undefined): Promise<Response> {
    let csrfToken: string;
    try {
      const cookieHeader =
        typeof this.#cookieHeader === 'function' ? this.#cookieHeader() : this.#cookieHeader;
      csrfToken = readAuthenticationCsrfToken(cookieHeader);
    } catch {
      return fail('UNAUTHENTICATED');
    }
    try {
      return await this.#fetch(path, requestInit(body, csrfToken, signal));
    } catch (caught) {
      if (isAbortFailure(caught, signal)) throw caught;
      return fail('UNAVAILABLE');
    }
  }

  async #json(response: Response): Promise<unknown> {
    try {
      return await readBoundedJson(response);
    } catch {
      return fail();
    }
  }
}
