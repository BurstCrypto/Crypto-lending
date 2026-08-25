import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { decideProtectedAccountShell } from '@/lib/authentication/protected-route';
import { readCanonicalAuthenticationPublicOrigin } from '@/lib/authentication/public-origin.server';
import { buildRestrictedWalletLabSecurityHeaders } from '@/lib/security/browser-egress';
import { decideWalletLabAccess, readWalletLabAccessConfiguration } from '@/lib/wallets/lab/access';

const SECURITY_HEADERS = buildRestrictedWalletLabSecurityHeaders(process.env.NODE_ENV);
const ACCOUNT_SHELL_HEADERS = Object.freeze([
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
]);

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const { key, value } of SECURITY_HEADERS) response.headers.set(key, value);
  return response;
}

function applyAccountShellHeaders(response: NextResponse): NextResponse {
  for (const { key, value } of ACCOUNT_SHELL_HEADERS) response.headers.set(key, value);
  return response;
}

function isProtectedShellPath(pathname: string): boolean {
  return pathname === '/portfolio' || pathname === '/account' || pathname.startsWith('/account/');
}

function authenticationConfigurationUnavailable(): NextResponse {
  const response = new NextResponse('Authentication unavailable.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '1' },
  });
  response.headers.set('Vary', 'Cookie, Origin');
  return applyAccountShellHeaders(response);
}

export function proxy(request: NextRequest) {
  if (isProtectedShellPath(request.nextUrl.pathname)) {
    const decision = decideProtectedAccountShell({
      cookieHeader: request.headers.get('cookie'),
      requestUrl: request.nextUrl,
    });

    if (decision.kind === 'render-shell') {
      return applyAccountShellHeaders(NextResponse.next());
    }

    const publicOrigin = readCanonicalAuthenticationPublicOrigin(process.env);
    if (publicOrigin === null) return authenticationConfigurationUnavailable();

    const loginUrl = new URL('/login', publicOrigin);
    loginUrl.searchParams.set('returnTo', decision.returnPath);
    const response = NextResponse.redirect(loginUrl, 307);
    response.headers.set('Vary', 'Cookie, Origin');
    return applyAccountShellHeaders(response);
  }

  const decision = decideWalletLabAccess({
    authorization: request.headers.get('authorization'),
    configuration: readWalletLabAccessConfiguration(process.env),
    forwardedProtocol: request.headers.get('x-forwarded-proto'),
    requestUrl: request.nextUrl,
  });

  if (decision.allowed) return applySecurityHeaders(NextResponse.next());

  const response = new NextResponse(decision.status === 401 ? 'Authentication required.' : null, {
    status: decision.status,
  });
  if (decision.status === 401) {
    response.headers.set(
      'WWW-Authenticate',
      'Basic realm="Restricted wallet lab", charset="UTF-8"',
    );
  }
  return applySecurityHeaders(response);
}

export const config = {
  matcher: ['/internal/wallet-lab/:path*', '/account/:path*', '/portfolio'],
};
