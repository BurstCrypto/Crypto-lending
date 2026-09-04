import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BoundedResponseError,
  RequestDeadlineError,
  createRequestDeadline,
  readBoundedJsonResponse,
} from '@/lib/http/bounded-response';

afterEach(() => vi.useRealTimers());

function jsonStream(
  stream: ReadableStream<Uint8Array> | null,
  headers: HeadersInit = {},
): Response {
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('bounded JSON response reader', () => {
  it('parses a valid response from bounded byte chunks', async () => {
    const encoder = new TextEncoder();
    const response = jsonStream(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"safe":'));
          controller.enqueue(encoder.encode('true}'));
          controller.close();
        },
      }),
    );

    await expect(readBoundedJsonResponse(response, { maximumBytes: 32 })).resolves.toEqual({
      safe: true,
    });
  });

  it('cancels an oversized chunked response without trusting Content-Length', async () => {
    const cancel = vi.fn();
    const response = jsonStream(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(9).fill(0x20));
        },
        cancel,
      }),
    );

    expect(response.headers.has('content-length')).toBe(false);
    await expect(readBoundedJsonResponse(response, { maximumBytes: 16 })).rejects.toEqual(
      expect.any(BoundedResponseError),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects and cancels a zero-byte stream chunk', async () => {
    const cancel = vi.fn();
    const response = jsonStream(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array());
        },
        cancel,
      }),
    );

    await expect(readBoundedJsonResponse(response, { maximumBytes: 16 })).rejects.toEqual(
      expect.any(BoundedResponseError),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects an absent response stream', async () => {
    await expect(readBoundedJsonResponse(jsonStream(null), { maximumBytes: 16 })).rejects.toEqual(
      expect.any(BoundedResponseError),
    );
  });

  it('cancels a stalled body at the request deadline', async () => {
    vi.useFakeTimers();
    const pendingPull = Promise.withResolvers<void>();
    const cancel = vi.fn(() => pendingPull.resolve());
    const request = createRequestDeadline(undefined, 100);
    const response = jsonStream(
      new ReadableStream<Uint8Array>({
        pull() {
          return pendingPull.promise;
        },
        cancel,
      }),
    );
    const read = readBoundedJsonResponse(response, {
      maximumBytes: 16,
      signal: request.signal,
    });
    const failure = expect(read).rejects.toEqual(expect.any(RequestDeadlineError));

    await vi.advanceTimersByTimeAsync(100);

    await failure;
    expect(request.didTimeout()).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    request.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending body with the exact caller abort reason', async () => {
    const pendingPull = Promise.withResolvers<void>();
    const cancel = vi.fn(() => pendingPull.resolve());
    const caller = new AbortController();
    const request = createRequestDeadline(caller.signal);
    const response = jsonStream(
      new ReadableStream<Uint8Array>({
        pull() {
          return pendingPull.promise;
        },
        cancel,
      }),
    );
    const read = readBoundedJsonResponse(response, {
      maximumBytes: 16,
      signal: request.signal,
    });
    const reason = new DOMException('caller stopped reading', 'AbortError');

    caller.abort(reason);

    await expect(read).rejects.toBe(reason);
    expect(request.didTimeout()).toBe(false);
    expect(cancel).toHaveBeenCalledWith(reason);
    request.dispose();
  });
});

describe('request deadline', () => {
  it('rejects a pre-aborted caller immediately when the operation never settles', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new DOMException('already cancelled', 'AbortError');
    caller.abort(reason);
    const request = createRequestDeadline(caller.signal, 100);
    const neverSettles = new Promise<never>(() => undefined);

    await expect(request.waitFor(neverSettles)).rejects.toBe(reason);

    expect(request.didTimeout()).toBe(false);
    request.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects on schedule even when an operation ignores abort and ignores its late result', async () => {
    vi.useFakeTimers();
    const operation = Promise.withResolvers<string>();
    const request = createRequestDeadline(undefined, 100);
    const waiting = request.waitFor(operation.promise);
    const failure = expect(waiting).rejects.toEqual(expect.any(RequestDeadlineError));

    await vi.advanceTimersByTimeAsync(100);
    await failure;
    operation.resolve('late success must not be accepted');
    await Promise.resolve();

    expect(request.didTimeout()).toBe(true);
    request.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves caller cancellation and clears the deadline after success', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const pending = Promise.withResolvers<void>();
    const request = createRequestDeadline(caller.signal, 100);
    const reason = new DOMException('caller cancelled', 'AbortError');
    const waiting = request.waitFor(pending.promise);

    caller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    pending.resolve();
    await Promise.resolve();
    expect(request.didTimeout()).toBe(false);
    request.dispose();
    expect(vi.getTimerCount()).toBe(0);

    const successful = createRequestDeadline(undefined, 100);
    await expect(successful.waitFor(Promise.resolve('ok'))).resolves.toBe('ok');
    successful.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
