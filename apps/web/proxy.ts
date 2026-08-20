import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { buildRestrictedWalletLabSecurityHeaders } from '@/lib/security/browser-egress';
import { decideWalletLabAccess, readWalletLabAccessConfiguration } from '@/lib/wallets/lab/access';

const SECURITY_HEADERS = buildRestrictedWalletLabSecurityHeaders(process.env.NODE_ENV);

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const { key, value } of SECURITY_HEADERS) response.headers.set(key, value);
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
