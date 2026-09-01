import type { AuthenticationFetch } from '@/lib/authentication';
import { isAbortFailure, retryAfterSeconds } from '@/lib/authentication/http';

import {
  parseReportingPortfolioResponse,
  type ReportingPortfolioSnapshot,
} from './reporting-portfolio';

export const PORTFOLIO_PATH = '/api/v1/portfolio' as const;
const MAX_PORTFOLIO_RESPONSE_CHARACTERS = 2_000_000;

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

async function readBoundedPortfolioJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') return fail('INVALID_RESPONSE');

  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) ||
      Number(contentLength) > MAX_PORTFOLIO_RESPONSE_CHARACTERS)
  ) {
    return fail('INVALID_RESPONSE');
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    return fail('INVALID_RESPONSE');
  }
  if (body.length < 1 || body.length > MAX_PORTFOLIO_RESPONSE_CHARACTERS) {
    return fail('INVALID_RESPONSE');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return fail('INVALID_RESPONSE');
  }
}

export class PortfolioApiClient {
  readonly #fetch: AuthenticationFetch;

  constructor(options: PortfolioApiClientOptions = {}) {
    this.#fetch =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  }

  async readPortfolio(signal?: AbortSignal): Promise<ReportingPortfolioSnapshot> {
    let response: Response;
    try {
      response = await this.#fetch(PORTFOLIO_PATH, requestInit(signal));
    } catch (error) {
      if (isAbortFailure(error, signal)) throw error;
      return fail('UNAVAILABLE');
    }

    if (response.status === 401) return fail('UNAUTHENTICATED');
    if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));

    try {
      return parseReportingPortfolioResponse(await readBoundedPortfolioJson(response));
    } catch (error) {
      if (error instanceof PortfolioApiError) throw error;
      return fail('INVALID_RESPONSE');
    }
  }
}

export function isPortfolioUnauthenticated(error: unknown): boolean {
  return error instanceof PortfolioApiError && error.code === 'UNAUTHENTICATED';
}
