import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticationFetch } from '../lib/authentication';
import {
  PortfolioApiClient,
  PortfolioApiError,
  PORTFOLIO_PATH,
} from '../lib/portfolio/portfolio-client';
import {
  REPORTING_PORTFOLIO_RESPONSE,
  REPORTING_PORTFOLIO_SNAPSHOT,
} from './fixtures/reporting-portfolio';
import { API_REQUEST_TIMEOUT_MILLISECONDS } from '../lib/http/bounded-response';

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

afterEach(() => vi.useRealTimers());

describe('production portfolio API client', () => {
  it('reads and validates the portfolio through one fixed same-origin no-store GET', async () => {
    const requestFetch = vi.fn<AuthenticationFetch>(async () =>
      jsonResponse(REPORTING_PORTFOLIO_RESPONSE),
    );

    await expect(new PortfolioApiClient({ fetch: requestFetch }).readPortfolio()).resolves.toEqual(
      REPORTING_PORTFOLIO_SNAPSHOT,
    );
    expect(requestFetch).toHaveBeenCalledWith(PORTFOLIO_PATH, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(JSON.stringify(requestFetch.mock.calls)).not.toContain('Authorization');
  });

  it('maps a missing managed session to a generic unauthenticated result', async () => {
    const error = new PortfolioApiClient({
      fetch: async () => jsonResponse({ private: 'ignored' }, 401),
    })
      .readPortfolio()
      .catch((caught: unknown) => caught);

    await expect(error).resolves.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
    });
  });

  it('maps 503 and bounded retry advice to a retryable unavailable result', async () => {
    const error = new PortfolioApiClient({
      fetch: async () =>
        jsonResponse({ detail: 'private provider failure' }, 503, { 'Retry-After': '3' }),
    })
      .readPortfolio()
      .catch((caught: unknown) => caught);

    await expect(error).resolves.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'Portfolio unavailable.',
      retryAfterSeconds: 3,
    });
    await expect(error).resolves.not.toHaveProperty('detail');
  });

  it('rejects malformed success data without retaining response details', async () => {
    const secret = 'private source detail';
    const error = new PortfolioApiClient({
      fetch: async () => jsonResponse({ ...REPORTING_PORTFOLIO_RESPONSE, secret }),
    })
      .readPortfolio()
      .catch((caught: unknown) => caught);

    await expect(error).resolves.toEqual(expect.any(PortfolioApiError));
    await expect(error).resolves.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(JSON.stringify(await error)).not.toContain(secret);
  });

  it('rejects oversized or non-JSON success bodies before contract parsing', async () => {
    await expect(
      new PortfolioApiClient({
        fetch: async () =>
          new Response('{}', {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': '2000001',
            },
          }),
      }).readPortfolio(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    await expect(
      new PortfolioApiClient({
        fetch: async () => new Response('not JSON', { status: 200 }),
      }).readPortfolio(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('bounds and cancels an oversized chunked portfolio body', async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(1_100_000).fill(0x20);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
        },
        cancel,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    await expect(
      new PortfolioApiClient({ fetch: async () => response }).readPortfolio(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(response.headers.has('content-length')).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('maps a stalled portfolio body deadline to unavailable and clears its timer', async () => {
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
    const read = new PortfolioApiClient({ fetch: async () => response }).readPortfolio();
    const failure = expect(read).rejects.toMatchObject({ code: 'UNAVAILABLE' });

    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MILLISECONDS);

    await failure;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves aborts while making other transport failures retryable', async () => {
    const controller = new AbortController();
    const aborted = new DOMException('aborted', 'AbortError');
    controller.abort(aborted);
    await expect(
      new PortfolioApiClient({ fetch: async () => Promise.reject(aborted) }).readPortfolio(
        controller.signal,
      ),
    ).rejects.toBe(aborted);

    await expect(
      new PortfolioApiClient({
        fetch: async () => Promise.reject(new Error('network secret')),
      }).readPortfolio(),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'Portfolio unavailable.' });
  });
});
