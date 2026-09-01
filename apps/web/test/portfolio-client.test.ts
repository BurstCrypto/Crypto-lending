import { describe, expect, it, vi } from 'vitest';

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

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

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

  it('preserves aborts while making other transport failures retryable', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new DOMException('aborted', 'AbortError');
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
