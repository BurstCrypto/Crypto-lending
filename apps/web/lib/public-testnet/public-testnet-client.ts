import {
  AuthenticationUnauthenticatedError,
  readAuthenticationCsrfToken,
  type AuthenticationFetch,
} from '@/lib/authentication';
import { isAbortFailure, readBoundedJson, retryAfterSeconds } from '@/lib/authentication/http';

import {
  parsePublicTestnetExecutionIntent,
  parsePublicTestnetPositionSnapshot,
  parsePublicTestnetSubmissionResult,
  parsePublicTestnetTransactionSignature,
  validatePublicTestnetExecutionRequest,
  validatePublicTestnetPositionRequest,
  type PublicTestnetExecutionIntent,
  type PublicTestnetExecutionRequest,
  type PublicTestnetPositionRequest,
  type PublicTestnetPositionSnapshot,
  type PublicTestnetSubmissionResult,
} from './public-testnet-execution';

export const PUBLIC_TESTNET_EXECUTION_INTENTS_PATH =
  '/api/v1/public-testnet/execution-intents' as const;
export const PUBLIC_TESTNET_POSITION_QUERY_PATH = '/api/v1/public-testnet/positions/query' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type PublicTestnetApiErrorCode =
  | 'BROADCAST_REJECTED'
  | 'CONFLICT'
  | 'EXPIRED'
  | 'INVALID_RESPONSE'
  | 'REJECTED'
  | 'UNAUTHENTICATED'
  | 'UNAVAILABLE';

export class PublicTestnetApiError extends Error {
  constructor(
    readonly code: PublicTestnetApiErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(
      code === 'UNAUTHENTICATED'
        ? 'Authentication is required.'
        : code === 'EXPIRED'
          ? 'The public-testnet execution intent expired.'
          : code === 'CONFLICT'
            ? 'The public-testnet execution intent is already consumed.'
            : code === 'BROADCAST_REJECTED'
              ? 'The fixed Devnet RPC rejected the signed transaction.'
              : code === 'REJECTED'
                ? 'The submitted public-testnet transaction did not match the intent.'
                : 'The public-testnet execution service is unavailable.',
    );
    this.name = 'PublicTestnetApiError';
  }
}

export interface PublicTestnetExecutionApi {
  createIntent(
    input: PublicTestnetExecutionRequest,
    signal?: AbortSignal,
  ): Promise<PublicTestnetExecutionIntent>;
  submitTransaction(
    intentId: string,
    signature: string,
    signal?: AbortSignal,
  ): Promise<PublicTestnetSubmissionResult>;
  submitSignedTransaction(
    intentId: string,
    signature: string,
    serializedTransaction: Uint8Array,
    signal?: AbortSignal,
  ): Promise<PublicTestnetSubmissionResult>;
  readPosition(
    input: PublicTestnetPositionRequest,
    signal?: AbortSignal,
  ): Promise<PublicTestnetPositionSnapshot>;
}

function signedTransactionBase64(value: unknown): string {
  if (
    !ArrayBuffer.isView(value) ||
    Object.prototype.toString.call(value) !== '[object Uint8Array]' ||
    Object.prototype.toString.call(value.buffer) === '[object SharedArrayBuffer]' ||
    value.byteLength === 0 ||
    value.byteLength > 1_232
  ) {
    return fail();
  }
  try {
    return globalThis.btoa(String.fromCharCode(...Uint8Array.from(value as Uint8Array)));
  } catch {
    return fail();
  }
}

export interface PublicTestnetApiClientOptions {
  readonly cookieHeader?: string | (() => string);
  readonly fetch?: AuthenticationFetch;
  readonly now?: () => Date;
}

function fail(code: PublicTestnetApiErrorCode = 'INVALID_RESPONSE', retry?: number): never {
  throw new PublicTestnetApiError(code, retry);
}

async function submissionRejectionCode(response: Response): Promise<PublicTestnetApiErrorCode> {
  try {
    const body = await readBoundedJson(response);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'REJECTED';
    return (body as Record<string, unknown>).code === 'PUBLIC_TESTNET_BROADCAST_REJECTED'
      ? 'BROADCAST_REJECTED'
      : 'REJECTED';
  } catch {
    return 'REJECTED';
  }
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

function serializeIntentRequest(input: PublicTestnetExecutionRequest): string {
  return JSON.stringify({
    portfolioSnapshotId: input.portfolioSnapshotId,
    selection: {
      kind: input.selection.kind,
      presetId: input.selection.presetId,
      liquidReserveBasisPoints: input.selection.liquidReserveBasisPoints,
    },
    chainId: input.chainId,
    account: input.account,
  });
}

export class PublicTestnetApiClient implements PublicTestnetExecutionApi {
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

  async createIntent(
    requested: PublicTestnetExecutionRequest,
    signal?: AbortSignal,
  ): Promise<PublicTestnetExecutionIntent> {
    let input: PublicTestnetExecutionRequest;
    try {
      input = validatePublicTestnetExecutionRequest(requested);
    } catch {
      return fail();
    }
    const response = await this.#unsafeRequest(
      PUBLIC_TESTNET_EXECUTION_INTENTS_PATH,
      serializeIntentRequest(input),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 201) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parsePublicTestnetExecutionIntent(await this.#json(response), input, this.#now());
    } catch {
      return fail();
    }
  }

  async submitTransaction(
    intentId: string,
    requestedSignature: string,
    signal?: AbortSignal,
  ): Promise<PublicTestnetSubmissionResult> {
    return this.#submitTransaction(intentId, requestedSignature, undefined, signal);
  }

  async submitSignedTransaction(
    intentId: string,
    requestedSignature: string,
    serializedTransaction: Uint8Array,
    signal?: AbortSignal,
  ): Promise<PublicTestnetSubmissionResult> {
    return this.#submitTransaction(
      intentId,
      requestedSignature,
      signedTransactionBase64(serializedTransaction),
      signal,
    );
  }

  async #submitTransaction(
    intentId: string,
    requestedSignature: string,
    serializedTransactionBase64: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<PublicTestnetSubmissionResult> {
    if (!UUID_V4.test(intentId)) return fail();
    let signature: string;
    try {
      signature = parsePublicTestnetTransactionSignature(requestedSignature);
    } catch {
      return fail();
    }
    const response = await this.#unsafeRequest(
      `${PUBLIC_TESTNET_EXECUTION_INTENTS_PATH}/${intentId}/submissions`,
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
    if (response.status === 422) return fail(await submissionRejectionCode(response));
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parsePublicTestnetSubmissionResult(await this.#json(response), {
        intentId,
        signature,
      });
    } catch {
      return fail();
    }
  }

  async readPosition(
    requested: PublicTestnetPositionRequest,
    signal?: AbortSignal,
  ): Promise<PublicTestnetPositionSnapshot> {
    let input: PublicTestnetPositionRequest;
    try {
      input = validatePublicTestnetPositionRequest(requested);
    } catch {
      return fail();
    }
    const response = await this.#unsafeRequest(
      PUBLIC_TESTNET_POSITION_QUERY_PATH,
      JSON.stringify({ chainId: input.chainId, account: input.account }),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parsePublicTestnetPositionSnapshot(await this.#json(response), input);
    } catch {
      return fail();
    }
  }

  async #unsafeRequest(
    path: string,
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
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
      return fail();
    }
  }
}

export function isPublicTestnetUnauthenticated(error: unknown): boolean {
  return (
    (error instanceof PublicTestnetApiError && error.code === 'UNAUTHENTICATED') ||
    error instanceof AuthenticationUnauthenticatedError
  );
}
