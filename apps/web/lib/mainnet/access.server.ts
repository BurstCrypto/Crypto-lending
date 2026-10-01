import { timingSafeEqual } from 'node:crypto';
import { hasUniqueValidSessionCookieHint } from '../authentication/protected-route';
import { readCanonicalAuthenticationPublicOrigin } from '../authentication/public-origin.server';
import { restoreAuthenticationSession, readAuthenticationCsrfToken } from '../authentication/session-client';
import { AuthenticationUnauthenticatedError } from '../authentication/errors';
import { isLocalMainnetRequest, localMainnetConfig } from '../local-mainnet/config.server';

export class MainnetAccessError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** This is the only difference between the two execution environments. The local
 * capability never authorizes a deployed host; production validates the API session. */
export async function mainnetAccess(request: Request, mutation: boolean) {
  if (localMainnetConfig()) {
    if (!isLocalMainnetRequest(request, mutation)) throw new MainnetAccessError('Not found.', 404);
    const { setupTokenMatches } = await import('../local-mainnet/bridge-config.server');
    if (!setupTokenMatches(request.headers.get('x-local-mainnet-setup'))) throw new MainnetAccessError('Open Portfolio on this computer to continue.', 401);
    return { kind: 'local' as const };
  }
  const cookie = request.headers.get('cookie');
  if (!hasUniqueValidSessionCookieHint(cookie)) throw new MainnetAccessError('Sign in to continue.', 401);
  const origin = readCanonicalAuthenticationPublicOrigin(process.env);
  if (!origin) throw new MainnetAccessError('Account authentication is unavailable.', 503);
  if (mutation) {
    if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new MainnetAccessError('Use the signed-in workspace to continue.', 403);
    let expected: string;
    try { expected = readAuthenticationCsrfToken(cookie); } catch { throw new MainnetAccessError('Refresh your account session.', 403); }
    const supplied = request.headers.get('x-csrf-token') ?? '';
    if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new MainnetAccessError('Refresh your account session.', 403);
  }
  try {
    const profile = await restoreAuthenticationSession({ fetch: (path, init) => fetch(new URL(String(path), origin), {
      ...init, headers: { ...init?.headers, Cookie: cookie! }, redirect: 'error', cache: 'no-store',
    }) });
    return { kind: 'account' as const, accountId: profile.accountId };
  } catch (error) {
    if (error instanceof AuthenticationUnauthenticatedError) throw new MainnetAccessError('Sign in to continue.', 401);
    throw new MainnetAccessError('Account authentication is unavailable.', 503);
  }
}
