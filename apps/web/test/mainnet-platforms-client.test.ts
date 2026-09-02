import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '../lib/authentication';
import {
  MAINNET_PLATFORMS_PATH,
  MainnetPlatformsApiClient,
  MainnetPlatformsApiError,
} from '../lib/platforms/mainnet-platforms-client';
import { MAINNET_PLATFORM_DIRECTORY_RESPONSE } from './fixtures/mainnet-platforms';

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

afterEach(() => vi.useRealTimers());

describe('mainnet platforms API client', () => {
  it('reads the directory through one fixed same-origin no-store GET', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () =>
      jsonResponse(MAINNET_PLATFORM_DIRECTORY_RESPONSE),
    );

    await expect(
      new MainnetPlatformsApiClient({ fetch: requestFetch }).readDirectory(),
    ).resolves.toMatchObject({
      minimumProviderTarget: 10,
      mayAuthorizeFinancialAction: false,
    });
    expect(requestFetch).toHaveBeenCalledTimes(1);
    const request = requestFetch.mock.calls[0];
    expect(request?.[0]).toBe(MAINNET_PLATFORMS_PATH);
    expect(request?.[1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
    expect(request?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(requestFetch.mock.calls)).not.toContain('Authorization');
  });

  it('maps authentication and service failures to generic client errors', async () => {
    await expect(
      new MainnetPlatformsApiClient({
        fetch: async () => jsonResponse({ ignored: true }, 401),
      }).readDirectory(),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
    });

    await expect(
      new MainnetPlatformsApiClient({
        fetch: async () =>
          jsonResponse({ private: 'provider failure' }, 503, { 'Retry-After': '4' }),
      }).readDirectory(),
    ).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'Platform directory unavailable.',
      retryAfterSeconds: 4,
    });
  });

  it('rejects malformed, executable, oversized, and non-JSON success responses', async () => {
    const executable = JSON.parse(JSON.stringify(MAINNET_PLATFORM_DIRECTORY_RESPONSE)) as Record<
      string,
      unknown
    >;
    executable.mayAuthorizeFinancialAction = true;
    await expect(
      new MainnetPlatformsApiClient({
        fetch: async () => jsonResponse(executable),
      }).readDirectory(),
    ).rejects.toEqual(expect.any(MainnetPlatformsApiError));

    await expect(
      new MainnetPlatformsApiClient({
        fetch: async () =>
          new Response('{}', {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': '131073',
            },
          }),
      }).readDirectory(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    await expect(
      new MainnetPlatformsApiClient({
        fetch: async () => new Response('not json', { status: 200 }),
      }).readDirectory(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('bounds and cancels an oversized chunked response without Content-Length', async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(70_000).fill(0x20);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel,
    });
    const response = new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.headers.has('content-length')).toBe(false);
    await expect(
      new MainnetPlatformsApiClient({ fetch: async () => response }).readDirectory(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects and cancels a zero-byte chunk instead of accepting an unbounded stream', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array());
        },
        cancel,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    await expect(
      new MainnetPlatformsApiClient({ fetch: async () => response }).readDirectory(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Error('private stream failure detail'),
    new DOMException('provider stream aborted', 'AbortError'),
  ])('fails closed when a chunked response body errors', async (streamError) => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(streamError);
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    await expect(
      new MainnetPlatformsApiClient({ fetch: async () => response }).readDirectory(),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Platform directory unavailable.',
    });
  });

  it('cancels a pending response body and preserves its caller abort', async () => {
    const bodyRead = Promise.withResolvers<void>();
    const pendingPull = Promise.withResolvers<void>();
    const cancel = vi.fn(() => pendingPull.resolve());
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          bodyRead.resolve();
          return pendingPull.promise;
        },
        cancel,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const controller = new AbortController();
    const failure = new DOMException('aborted while reading', 'AbortError');
    const read = new MainnetPlatformsApiClient({ fetch: async () => response }).readDirectory(
      controller.signal,
    );

    await bodyRead.promise;
    controller.abort(failure);

    await expect(read).rejects.toBe(failure);
    expect(cancel).toHaveBeenCalledWith(failure);
  });

  it('times out and cancels a stalled response body without leaking its deadline timer', async () => {
    vi.useFakeTimers();
    const pendingPull = Promise.withResolvers<void>();
    const cancel = vi.fn(() => pendingPull.resolve());
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          return pendingPull.promise;
        },
        cancel,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    const read = new MainnetPlatformsApiClient({ fetch: async () => response }).readDirectory();
    const timeoutFailure = expect(read).rejects.toMatchObject({ code: 'UNAVAILABLE' });

    await vi.advanceTimersByTimeAsync(10_000);

    await timeoutFailure;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the internal deadline after a successful response', async () => {
    vi.useFakeTimers();

    await expect(
      new MainnetPlatformsApiClient({
        fetch: async () => jsonResponse(MAINNET_PLATFORM_DIRECTORY_RESPONSE),
      }).readDirectory(),
    ).resolves.toMatchObject({ mayAuthorizeFinancialAction: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves aborts while making other transport failures retryable', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new DOMException('aborted', 'AbortError');
    await expect(
      new MainnetPlatformsApiClient({ fetch: async () => Promise.reject(aborted) }).readDirectory(
        controller.signal,
      ),
    ).rejects.toBe(aborted);

    await expect(
      new MainnetPlatformsApiClient({
        fetch: async () => Promise.reject(new Error('private transport detail')),
      }).readDirectory(),
    ).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'Platform directory unavailable.',
    });
  });
});
