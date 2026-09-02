import type { AuthenticationFetch } from '@/lib/authentication';
import { retryAfterSeconds } from '@/lib/authentication/http';

import {
  parseMainnetPlatformDirectory,
  type MainnetPlatformDirectory,
} from './mainnet-platform-directory';

export const MAINNET_PLATFORMS_PATH = '/api/v1/mainnet-platforms' as const;
const MAXIMUM_RESPONSE_BYTES = 131_072;
const MAXIMUM_RESPONSE_CHUNKS = 4_096;
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;

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

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason?: unknown): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best effort; the caller still fails closed.
  }
}

function boundedRequestSignal(callerSignal: AbortSignal | undefined): {
  readonly dispose: () => void;
  readonly signal: AbortSignal;
} {
  const controller = new AbortController();
  const forwardCallerAbort = () => controller.abort(abortReason(callerSignal));
  callerSignal?.addEventListener('abort', forwardCallerAbort, { once: true });
  if (callerSignal?.aborted === true) forwardCallerAbort();

  const timeout = globalThis.setTimeout(() => {
    controller.abort(new MainnetPlatformsApiError('UNAVAILABLE'));
  }, REQUEST_TIMEOUT_MILLISECONDS);

  return Object.freeze({
    signal: controller.signal,
    dispose: () => {
      globalThis.clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', forwardCallerAbort);
    },
  });
}

async function readBoundedJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') return fail('INVALID_RESPONSE');

  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) || Number(contentLength) > MAXIMUM_RESPONSE_BYTES)
  ) {
    return fail('INVALID_RESPONSE');
  }

  if (response.body === null) return fail('INVALID_RESPONSE');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks: string[] = [];
  let bytesRead = 0;
  let chunksRead = 0;
  let aborted = false;
  const handleAbort = () => {
    aborted = true;
    cancelReader(reader, abortReason(signal));
  };
  signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    if (signal?.aborted === true) {
      handleAbort();
      throw abortReason(signal);
    }

    while (true) {
      const { done, value } = await reader.read();
      if (aborted) throw abortReason(signal);
      if (done) break;

      chunksRead += 1;
      if (value.byteLength === 0 || chunksRead > MAXIMUM_RESPONSE_CHUNKS) {
        cancelReader(reader);
        return fail('INVALID_RESPONSE');
      }
      bytesRead += value.byteLength;
      if (bytesRead > MAXIMUM_RESPONSE_BYTES) {
        cancelReader(reader);
        return fail('INVALID_RESPONSE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());

    const body = chunks.join('');
    if (body.length < 1) return fail('INVALID_RESPONSE');

    return JSON.parse(body) as unknown;
  } catch (error) {
    if (signal?.aborted === true) throw error;
    if (error instanceof MainnetPlatformsApiError) throw error;
    return fail('INVALID_RESPONSE');
  } finally {
    signal?.removeEventListener('abort', handleAbort);
    try {
      reader.releaseLock();
    } catch {
      // A hostile stream cannot change the generic failure already selected above.
    }
  }
}

export class MainnetPlatformsApiClient {
  readonly #fetch: AuthenticationFetch;

  constructor(options: MainnetPlatformsApiClientOptions = {}) {
    this.#fetch =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  }

  async readDirectory(signal?: AbortSignal): Promise<MainnetPlatformDirectory> {
    const request = boundedRequestSignal(signal);
    try {
      let response: Response;
      try {
        response = await this.#fetch(MAINNET_PLATFORMS_PATH, requestInit(request.signal));
      } catch (error) {
        if (signal?.aborted === true) throw error;
        if (error instanceof MainnetPlatformsApiError) throw error;
        return fail('UNAVAILABLE');
      }

      if (response.status === 401) return fail('UNAUTHENTICATED');
      if (response.status !== 200) return fail('UNAVAILABLE', retryAfterSeconds(response));

      try {
        return parseMainnetPlatformDirectory(await readBoundedJson(response, request.signal));
      } catch (error) {
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
