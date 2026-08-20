import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { buildRestrictedWalletLabPolicy } from '@/lib/security/browser-egress';
import { decideWalletLabAccess, readWalletLabAccessConfiguration } from '@/lib/wallets/lab/access';

const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': buildRestrictedWalletLabPolicy(process.env.NODE_ENV),
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
} as const;

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

export function proxy(request: NextRequest) {
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
  matcher: '/internal/wallet-lab/:path*',
};
