import { readAuthenticationCsrfToken, type AuthenticationFetch } from '@/lib/authentication';
import { isAbortFailure, readBoundedJson, retryAfterSeconds } from '@/lib/authentication/http';

import { PublicTestnetApiError, type PublicTestnetApiClientOptions } from './public-testnet-client';
import {
  parsePublicTestnetWithdrawalIntent,
  parsePublicTestnetWithdrawalResult,
  validatePublicTestnetWithdrawalRequest,
  type PublicTestnetWithdrawalApi,
  type PublicTestnetWithdrawalIntent,
  type PublicTestnetWithdrawalRequest,
  type PublicTestnetWithdrawalResult,
} from './public-testnet-withdrawal';
import { parsePublicTestnetTransactionSignature } from './public-testnet-execution';

export const PUBLIC_TESTNET_WITHDRAWAL_INTENTS_PATH =
  '/api/v1/public-testnet/withdrawal-intents' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function browserCookieHeader(): string {
  return typeof document === 'undefined' ? '' : document.cookie;
}

function fail(code: ConstructorParameters<typeof PublicTestnetApiError>[0], retry?: number): never {
  throw new PublicTestnetApiError(code, retry);
}

function signedTransactionBase64(value: unknown): string {
  if (
    !ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) !== '[object Uint8Array]' ||
    Object.prototype.toString.call(value.buffer) === '[object SharedArrayBuffer]' ||
    value.byteLength === 0 ||
    value.byteLength > 1_232
  ) {
    return fail('INVALID_RESPONSE');
  }
  try {
    return globalThis.btoa(String.fromCharCode(...Uint8Array.from(value as Uint8Array)));
  } catch {
    return fail('INVALID_RESPONSE');
  }
}

function requestInit(body: string, csrfToken: string, signal?: AbortSignal): RequestInit {
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

export class DefaultPublicTestnetWithdrawalClient implements PublicTestnetWithdrawalApi {
  readonly #cookieHeader: string | (() => string);
  readonly #fetch: AuthenticationFetch;
  readonly #now: () => Date;

  constructor(options: PublicTestnetApiClientOptions = {}) {
    this.#cookieHeader = options.cookieHeader ?? browserCookieHeader;
    this.#fetch =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    this.#now = options.now ?? (() => new Date());
  }

  async createWithdrawalIntent(
    requested: PublicTestnetWithdrawalRequest,
    signal?: AbortSignal,
  ): Promise<PublicTestnetWithdrawalIntent> {
    let input: PublicTestnetWithdrawalRequest;
    try {
      input = validatePublicTestnetWithdrawalRequest(requested);
    } catch {
      return fail('INVALID_RESPONSE');
    }
    const response = await this.#request(
      PUBLIC_TESTNET_WITHDRAWAL_INTENTS_PATH,
      JSON.stringify({ chainId: input.chainId, account: input.account }),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status === 422) return fail('REJECTED');
    if (response.status !== 201) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parsePublicTestnetWithdrawalIntent(await this.#json(response), input, this.#now());
    } catch {
      return fail('INVALID_RESPONSE');
    }
  }

  submitSignedWithdrawal(
    intentId: string,
    signature: string,
    serializedTransaction: Uint8Array,
    signal?: AbortSignal,
  ): Promise<PublicTestnetWithdrawalResult> {
    return this.#submit(
      intentId,
      signature,
      signedTransactionBase64(serializedTransaction),
      signal,
    );
  }

  verifyWithdrawal(
    intentId: string,
    signature: string,
    signal?: AbortSignal,
  ): Promise<PublicTestnetWithdrawalResult> {
    return this.#submit(intentId, signature, undefined, signal);
  }

  async #submit(
    intentId: string,
    requestedSignature: string,
    serializedTransactionBase64: string | undefined,
    signal?: AbortSignal,
  ): Promise<PublicTestnetWithdrawalResult> {
    if (!UUID_V4.test(intentId)) return fail('INVALID_RESPONSE');
    let signature: string;
    try {
      signature = parsePublicTestnetTransactionSignature(requestedSignature);
    } catch {
      return fail('INVALID_RESPONSE');
    }
    const response = await this.#request(
      `${PUBLIC_TESTNET_WITHDRAWAL_INTENTS_PATH}/${intentId}/submissions`,
      JSON.stringify(
        serializedTransactionBase64 === undefined
          ? { signature }
          : { signature, signedTransactionBase64: serializedTransactionBase64 },
      ),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status === 410) return fail('EXPIRED');
    if (response.status === 409) return fail('CONFLICT');
    if (response.status === 422) return fail('REJECTED');
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parsePublicTestnetWithdrawalResult(await this.#json(response), {
        intentId,
        signature,
      });
    } catch {
      return fail('INVALID_RESPONSE');
    }
  }

  async #request(path: string, body: string, signal?: AbortSignal): Promise<Response> {
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
    } catch (error) {
      if (isAbortFailure(error, signal)) throw error;
      return fail('UNAVAILABLE');
    }
  }

  async #json(response: Response): Promise<unknown> {
    try {
      return await readBoundedJson(response);
    } catch {
      return fail('INVALID_RESPONSE');
    }
  }
}
