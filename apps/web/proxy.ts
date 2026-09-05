import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { decideProtectedAccountShell } from '@/lib/authentication/protected-route';
import { readCanonicalAuthenticationPublicOrigin } from '@/lib/authentication/public-origin.server';

const ACCOUNT_SHELL_HEADERS = Object.freeze([
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
]);

function applyAccountShellHeaders(response: NextResponse): NextResponse {
  for (const { key, value } of ACCOUNT_SHELL_HEADERS) response.headers.set(key, value);
  return response;
}

function isProtectedShellPath(pathname: string): boolean {
  return (
    pathname === '/platforms' ||
    pathname === '/portfolio' ||
    pathname === '/account' ||
    pathname.startsWith('/account/')
  );
}

function isAuthenticationPagePath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/register';
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

  if (isAuthenticationPagePath(request.nextUrl.pathname)) {
    return applyAccountShellHeaders(NextResponse.next());
  }

  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ['/account/:path*', '/platforms', '/portfolio', '/login', '/register'],
};
