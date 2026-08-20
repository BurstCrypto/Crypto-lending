import { HttpException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, NEVER, Observable, of } from 'rxjs';

import {
  READINESS_ABUSE_LIMITS,
  ReadinessAbuseLimiter,
  type ReadinessRequestLease,
} from './readiness-abuse-limiter';
import { ReadinessAbuseInterceptor } from './readiness-abuse.interceptor';

function httpContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      }),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('ReadinessAbuseInterceptor', () => {
  it('rejects excess in-flight work with a non-cacheable 429 and Retry-After', () => {
    const limiter = new ReadinessAbuseLimiter(undefined, () => 1_000);
    const leases: ReadinessRequestLease[] = [];
    for (let index = 0; index < READINESS_ABUSE_LIMITS.maxConcurrentRequests; index += 1) {
      const admission = limiter.tryAcquire();
      if (admission.admitted) leases.push(admission.lease);
    }
    const interceptor = new ReadinessAbuseInterceptor(limiter);
    const headers: Record<string, string> = {};
    const next = { handle: jest.fn(() => of('unused')) } as CallHandler;

    let captured: unknown;
    try {
      interceptor.intercept(httpContext(headers), next);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(HttpException);
    expect((captured as HttpException).getStatus()).toBe(429);
    expect(headers).toEqual({ 'Cache-Control': 'no-store', 'Retry-After': '1' });
    expect(next.handle).not.toHaveBeenCalled();
    leases.forEach((lease) => lease.release());
  });

  it('releases concurrency after success, failure, and unsubscribe', async () => {
    const limiter = new ReadinessAbuseLimiter(undefined, () => 1_000);
    const interceptor = new ReadinessAbuseInterceptor(limiter);

    await expect(
      firstValueFrom(
        interceptor.intercept(httpContext({}), {
          handle: () => of('ok'),
        }),
      ),
    ).resolves.toBe('ok');

    const synchronousFailure = new Error('handler construction failed');
    expect(() =>
      interceptor.intercept(httpContext({}), {
        handle: () => {
          throw synchronousFailure;
        },
      }),
    ).toThrow(synchronousFailure);

    const subscription = interceptor
      .intercept(httpContext({}), {
        handle: () => NEVER,
      })
      .subscribe();
    subscription.unsubscribe();

    const heldLeases: ReadinessRequestLease[] = [];
    for (let index = 0; index < READINESS_ABUSE_LIMITS.maxConcurrentRequests; index += 1) {
      const admission = limiter.tryAcquire();
      expect(admission.admitted).toBe(true);
      if (admission.admitted) heldLeases.push(admission.lease);
    }
    expect(limiter.tryAcquire().admitted).toBe(false);
    heldLeases.forEach((lease) => lease.release());
  });

  it('releases a lease when an observable errors', async () => {
    const limiter = new ReadinessAbuseLimiter(undefined, () => 1_000);
    const interceptor = new ReadinessAbuseInterceptor(limiter);
    const expected = new Error('health failed');
    const failingHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.error(expected);
        }),
    };

    await expect(
      firstValueFrom(interceptor.intercept(httpContext({}), failingHandler)),
    ).rejects.toBe(expected);

    const leases: ReadinessRequestLease[] = [];
    for (let index = 0; index < READINESS_ABUSE_LIMITS.maxConcurrentRequests; index += 1) {
      const admission = limiter.tryAcquire();
      expect(admission.admitted).toBe(true);
      if (admission.admitted) leases.push(admission.lease);
    }
    leases.forEach((lease) => lease.release());
  });
});
