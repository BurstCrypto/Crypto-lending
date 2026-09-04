import type { AuthenticationFetch } from '@/lib/authentication';
import { isAbortFailure, retryAfterSeconds } from '@/lib/authentication/http';
import { createRequestDeadline, readBoundedJsonResponse } from '@/lib/http/bounded-response';

import {
  parseReportingPortfolioResponse,
  type ReportingPortfolioSnapshot,
} from './reporting-portfolio';

export const PORTFOLIO_PATH = '/api/v1/portfolio' as const;
const MAX_PORTFOLIO_RESPONSE_BYTES = 2_000_000;

export type PortfolioApiErrorCode = 'INVALID_RESPONSE' | 'UNAUTHENTICATED' | 'UNAVAILABLE';

export class PortfolioApiError extends Error {
  constructor(
    readonly code: PortfolioApiErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(code === 'UNAUTHENTICATED' ? 'Authentication is required.' : 'Portfolio unavailable.');
    this.name = 'PortfolioApiError';
  }
}

export interface PortfolioApiClientOptions {
  readonly fetch?: AuthenticationFetch;
}

function fail(code: PortfolioApiErrorCode, retry?: number): never {
  throw new PortfolioApiError(code, retry);
}

function requestInit(signal: AbortSignal | undefined): RequestInit {
  return {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  };
}

export class PortfolioApiClient {
  readonly #fetch: AuthenticationFetch;

  constructor(options: PortfolioApiClientOptions = {}) {
    this.#fetch =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  }

  async readPortfolio(signal?: AbortSignal): Promise<ReportingPortfolioSnapshot> {
    const request = createRequestDeadline(signal);
    try {
      let response: Response;
      try {
        response = await request.waitFor(this.#fetch(PORTFOLIO_PATH, requestInit(request.signal)));
      } catch (error) {
        if (request.didTimeout()) return fail('UNAVAILABLE');
        if (isAbortFailure(error, signal)) throw error;
        return fail('UNAVAILABLE');
      }

      if (response.status === 401) return fail('UNAUTHENTICATED');
      if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));

      try {
        return parseReportingPortfolioResponse(
          await readBoundedJsonResponse(response, {
            maximumBytes: MAX_PORTFOLIO_RESPONSE_BYTES,
            signal: request.signal,
          }),
        );
      } catch (error) {
        if (request.didTimeout()) return fail('UNAVAILABLE');
        if (signal?.aborted === true) throw error;
        if (error instanceof PortfolioApiError) throw error;
        return fail('INVALID_RESPONSE');
      }
    } finally {
      request.dispose();
    }
  }
}

export function isPortfolioUnauthenticated(error: unknown): boolean {
  return error instanceof PortfolioApiError && error.code === 'UNAUTHENTICATED';
}
