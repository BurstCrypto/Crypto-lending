import {
  AuthenticationUnauthenticatedError,
  readAuthenticationCsrfToken,
  type AuthenticationFetch,
} from '@/lib/authentication';
import { isAbortFailure, readBoundedJson, retryAfterSeconds } from '@/lib/authentication/http';

import {
  parseEvmPublicTestnetExecutionIntent,
  parseEvmPublicTestnetPositionSnapshot,
  parseEvmPublicTestnetSubmissionResult,
  parseEvmPublicTestnetTransactionHash,
  validateEvmPublicTestnetExecutionRequest,
  validateEvmPublicTestnetPositionRequest,
  type EvmPublicTestnetExecutionIntent,
  type EvmPublicTestnetExecutionRequest,
  type EvmPublicTestnetPositionRequest,
  type EvmPublicTestnetPositionSnapshot,
  type EvmPublicTestnetSubmissionResult,
} from './execution';

export const EVM_PUBLIC_TESTNET_EXECUTION_INTENTS_PATH =
  '/api/v1/public-testnet/evm/execution-intents' as const;
export const EVM_PUBLIC_TESTNET_POSITION_QUERY_PATH =
  '/api/v1/public-testnet/evm/positions/query' as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type EvmPublicTestnetApiErrorCode =
  | 'CONFLICT'
  | 'EVIDENCE_MISMATCH'
  | 'EXPIRED'
  | 'INVALID_RESPONSE'
  | 'REPLACED'
  | 'REVERTED'
  | 'UNAUTHENTICATED'
  | 'UNAVAILABLE';

const ERROR_MESSAGES: Readonly<Record<EvmPublicTestnetApiErrorCode, string>> = Object.freeze({
  CONFLICT: 'The EVM public-testnet execution intent conflicts with another transaction.',
  EVIDENCE_MISMATCH: 'The submitted transaction did not match the reviewed intent.',
  EXPIRED: 'The EVM public-testnet execution intent expired.',
  INVALID_RESPONSE: 'The EVM public-testnet service returned an invalid response.',
  REPLACED: 'The reviewed transaction nonce was replaced by another transaction.',
  REVERTED: 'The reviewed Base Sepolia transaction reverted.',
  UNAUTHENTICATED: 'Authentication is required.',
  UNAVAILABLE: 'The EVM public-testnet execution service is unavailable.',
});

export class EvmPublicTestnetApiError extends Error {
  readonly safeToRetry: boolean;

  constructor(
    readonly code: EvmPublicTestnetApiErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(ERROR_MESSAGES[code]);
    this.name = 'EvmPublicTestnetApiError';
    this.safeToRetry = code === 'REPLACED' || code === 'REVERTED';
  }
}

export interface EvmPublicTestnetExecutionApi {
  prepare(
    input: EvmPublicTestnetExecutionRequest,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetExecutionIntent>;
  submit(
    intentId: string,
    transactionHash: string,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetSubmissionResult>;
  /** Read-only recovery query. Sends an empty body and can never authorize a wallet write. */
  query(intentId: string, signal?: AbortSignal): Promise<EvmPublicTestnetSubmissionResult>;
  queryPosition(
    input: EvmPublicTestnetPositionRequest,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetPositionSnapshot>;
}

export interface EvmPublicTestnetApiClientOptions {
  readonly cookieHeader?: string | (() => string);
  readonly fetch?: AuthenticationFetch;
  readonly now?: () => Date;
}

function fail(code: EvmPublicTestnetApiErrorCode = 'INVALID_RESPONSE', retry?: number): never {
  throw new EvmPublicTestnetApiError(code, retry);
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

function serializeExecutionRequest(input: EvmPublicTestnetExecutionRequest): string {
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

export class EvmPublicTestnetApiClient implements EvmPublicTestnetExecutionApi {
  readonly #cookieHeader: string | (() => string);
  readonly #fetch: AuthenticationFetch;
  readonly #now: () => Date;

  constructor(options: EvmPublicTestnetApiClientOptions = {}) {
    this.#cookieHeader = options.cookieHeader ?? browserCookieHeader;
    this.#fetch =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    this.#now = options.now ?? (() => new Date());
  }

  async prepare(
    requested: EvmPublicTestnetExecutionRequest,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetExecutionIntent> {
    let input: EvmPublicTestnetExecutionRequest;
    try {
      input = validateEvmPublicTestnetExecutionRequest(requested);
    } catch {
      return fail();
    }
    const response = await this.#request(
      EVM_PUBLIC_TESTNET_EXECUTION_INTENTS_PATH,
      serializeExecutionRequest(input),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 201) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parseEvmPublicTestnetExecutionIntent(await this.#json(response), input, this.#now());
    } catch {
      return fail();
    }
  }

  async submit(
    intentId: string,
    transactionHashValue: string,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetSubmissionResult> {
    if (!UUID_V4.test(intentId)) return fail();
    let transactionHash: string;
    try {
      transactionHash = parseEvmPublicTestnetTransactionHash(transactionHashValue);
    } catch {
      return fail();
    }
    return this.#submission(intentId, transactionHash, signal);
  }

  async query(intentId: string, signal?: AbortSignal): Promise<EvmPublicTestnetSubmissionResult> {
    if (!UUID_V4.test(intentId)) return fail();
    return this.#submission(intentId, null, signal);
  }

  async queryPosition(
    requested: EvmPublicTestnetPositionRequest,
    signal?: AbortSignal,
  ): Promise<EvmPublicTestnetPositionSnapshot> {
    let input: EvmPublicTestnetPositionRequest;
    try {
      input = validateEvmPublicTestnetPositionRequest(requested);
    } catch {
      return fail();
    }
    const response = await this.#request(
      EVM_PUBLIC_TESTNET_POSITION_QUERY_PATH,
      JSON.stringify({ chainId: input.chainId, account: input.account }),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parseEvmPublicTestnetPositionSnapshot(await this.#json(response), input);
    } catch {
      return fail();
    }
  }

  async #submission(
    intentId: string,
    transactionHash: string | null,
    signal: AbortSignal | undefined,
  ): Promise<EvmPublicTestnetSubmissionResult> {
    const response = await this.#request(
      `${EVM_PUBLIC_TESTNET_EXECUTION_INTENTS_PATH}/${intentId}/submissions`,
      JSON.stringify(transactionHash === null ? {} : { transactionHash }),
      signal,
    );
    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status === 410) return fail('EXPIRED');
    if (response.status === 409) {
      const code = await boundedErrorCode(response);
      return fail(code === 'EVM_PUBLIC_TESTNET_TRANSACTION_REPLACED' ? 'REPLACED' : 'CONFLICT');
    }
    if (response.status === 422) {
      const code = await boundedErrorCode(response);
      if (code === 'EVM_PUBLIC_TESTNET_TRANSACTION_REVERTED') return fail('REVERTED');
      return fail('EVIDENCE_MISMATCH');
    }
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));
    try {
      return parseEvmPublicTestnetSubmissionResult(await this.#json(response), {
        intentId,
        transactionHash,
      });
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

export function isEvmPublicTestnetUnauthenticated(errorValue: unknown): boolean {
  return (
    (errorValue instanceof EvmPublicTestnetApiError && errorValue.code === 'UNAUTHENTICATED') ||
    errorValue instanceof AuthenticationUnauthenticatedError
  );
}
