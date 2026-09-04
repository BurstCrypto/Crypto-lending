import type { AuthenticationFetch } from '@/lib/authentication';
import { retryAfterSeconds } from '@/lib/authentication/http';
import { createRequestDeadline, readBoundedJsonResponse } from '@/lib/http/bounded-response';

import {
  parseMainnetPlatformDirectory,
  type MainnetPlatformDirectory,
} from './mainnet-platform-directory';

export const MAINNET_PLATFORMS_PATH = '/api/v1/mainnet-platforms' as const;
const MAXIMUM_RESPONSE_BYTES = 131_072;

export type MainnetPlatformsApiErrorCode = 'INVALID_RESPONSE' | 'UNAUTHENTICATED' | 'UNAVAILABLE';

export class MainnetPlatformsApiError extends Error {
  constructor(
    readonly code: MainnetPlatformsApiErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(
      code === 'UNAUTHENTICATED'
        ? 'Authentication is required.'
        : 'Platform directory unavailable.',
    );
    this.name = 'MainnetPlatformsApiError';
  }
}

export interface MainnetPlatformsApiClientOptions {
  readonly fetch?: AuthenticationFetch;
}

function fail(code: MainnetPlatformsApiErrorCode, retry?: number): never {
  throw new MainnetPlatformsApiError(code, retry);
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

export class MainnetPlatformsApiClient {
  readonly #fetch: AuthenticationFetch;

  constructor(options: MainnetPlatformsApiClientOptions = {}) {
    this.#fetch =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  }

  async readDirectory(signal?: AbortSignal): Promise<MainnetPlatformDirectory> {
    const request = createRequestDeadline(signal);
    try {
      let response: Response;
      try {
        response = await request.waitFor(
          this.#fetch(MAINNET_PLATFORMS_PATH, requestInit(request.signal)),
        );
      } catch (error) {
        if (request.didTimeout()) return fail('UNAVAILABLE');
        if (signal?.aborted === true) throw error;
        if (error instanceof MainnetPlatformsApiError) throw error;
        return fail('UNAVAILABLE');
      }

      if (response.status === 401) return fail('UNAUTHENTICATED');
      if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));

      try {
        return parseMainnetPlatformDirectory(
          await readBoundedJsonResponse(response, {
            maximumBytes: MAXIMUM_RESPONSE_BYTES,
            signal: request.signal,
          }),
        );
      } catch (error) {
        if (request.didTimeout()) return fail('UNAVAILABLE');
        if (signal?.aborted === true) throw error;
        if (error instanceof MainnetPlatformsApiError) throw error;
        return fail('INVALID_RESPONSE');
      }
    } finally {
      request.dispose();
    }
  }
}

export function isMainnetPlatformsUnauthenticated(error: unknown): boolean {
  return error instanceof MainnetPlatformsApiError && error.code === 'UNAUTHENTICATED';
}
