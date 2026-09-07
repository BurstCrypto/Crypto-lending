import { AuthenticationRateLimitedError } from '../application/authentication.errors';
import type { AuthenticationService } from '../application/authentication.service';
import { AuthenticationClientAddressResolver } from '../http/authentication-client-address';
import { SessionCurrentPrincipalResolver } from './session-current-principal.resolver';
import { SessionResolutionAdmission } from './session-resolution-admission';

function boundary(
  overrides: Partial<ConstructorParameters<typeof SessionResolutionAdmission>[0]> = {},
): SessionResolutionAdmission {
  return new SessionResolutionAdmission(
    {
      maxConcurrentResolutions: 1,
      maxTrackedSources: 8,
      sourceRequestLimit: 10,
      sourceWindowMilliseconds: 60_000,
      ...overrides,
    },
    () => 0,
  );
}

function directRequest(sourceAddress: string): object {
  return {
    method: 'GET',
    headers: {},
    rawHeaders: [],
    socket: { remoteAddress: sourceAddress },
  };
}

describe('SessionCurrentPrincipalResolver', () => {
  it('starts no work above the concurrency cap and recovers after success and failure settle', async () => {
    let finish: ((value: null) => void) | undefined;
    const operation = new Promise<null>((resolve) => {
      finish = resolve;
    });
    const resolve = jest.fn(() => operation);
    const resolver = new SessionCurrentPrincipalResolver(
      { resolve } as unknown as AuthenticationService,
      new AuthenticationClientAddressResolver({ mode: 'direct' }),
      boundary(),
    );

    const first = resolver.resolve(directRequest('198.51.100.30'));
    await expect(resolver.resolve(directRequest('198.51.100.31'))).rejects.toEqual(
      new AuthenticationRateLimitedError(1),
    );
    expect(resolve).toHaveBeenCalledTimes(1);

    finish?.(null);
    await expect(first).resolves.toBeNull();
    await expect(resolver.resolve(directRequest('198.51.100.31'))).resolves.toBeNull();

    const repositoryFailure = new Error('private repository failure');
    resolve.mockRejectedValueOnce(repositoryFailure);
    await expect(resolver.resolve(directRequest('198.51.100.32'))).rejects.toBe(repositoryFailure);
    resolve.mockResolvedValueOnce(null);
    await expect(resolver.resolve(directRequest('198.51.100.32'))).resolves.toBeNull();
  });

  it('keeps fixed-window source budgets isolated', async () => {
    const resolve = jest.fn().mockResolvedValue(null);
    const resolver = new SessionCurrentPrincipalResolver(
      { resolve } as unknown as AuthenticationService,
      new AuthenticationClientAddressResolver({ mode: 'direct' }),
      boundary({ sourceRequestLimit: 1 }),
    );

    await expect(resolver.resolve(directRequest('198.51.100.40'))).resolves.toBeNull();
    await expect(resolver.resolve(directRequest('198.51.100.40'))).rejects.toBeInstanceOf(
      AuthenticationRateLimitedError,
    );
    await expect(resolver.resolve(directRequest('198.51.100.41'))).resolves.toBeNull();
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'untrusted proxy peer',
      request: {
        socket: { remoteAddress: '192.0.2.1' },
        headers: { 'x-forwarded-for': '198.51.100.50' },
        rawHeaders: ['X-Forwarded-For', '198.51.100.50'],
      },
    },
    {
      name: 'list-valued forwarded address',
      request: {
        socket: { remoteAddress: '10.0.0.1' },
        headers: { 'x-forwarded-for': '198.51.100.50, 203.0.113.1' },
        rawHeaders: ['X-Forwarded-For', '198.51.100.50, 203.0.113.1'],
      },
    },
    {
      name: 'duplicate forwarded header',
      request: {
        socket: { remoteAddress: '10.0.0.1' },
        headers: { 'x-forwarded-for': '198.51.100.50, 203.0.113.1' },
        rawHeaders: ['X-Forwarded-For', '198.51.100.50', 'X-Forwarded-For', '203.0.113.1'],
      },
    },
  ])('rejects $name before authentication persistence', async ({ request }) => {
    const resolve = jest.fn().mockResolvedValue(null);
    const resolver = new SessionCurrentPrincipalResolver(
      { resolve } as unknown as AuthenticationService,
      new AuthenticationClientAddressResolver({
        mode: 'trusted-single-proxy',
        trustedProxyRanges: [{ address: '10.0.0.0', prefixLength: 8, family: 'ipv4' }],
      }),
      boundary(),
    );

    await expect(resolver.resolve(request)).rejects.toBeDefined();
    expect(resolve).not.toHaveBeenCalled();
  });
});
