const PRODUCTION_CONNECT_POLICY = "connect-src 'self'";
const LOCAL_DEVELOPMENT_CONNECT_POLICY = "connect-src 'self' ws://127.0.0.1:* ws://localhost:*";
const PRODUCTION_SCRIPT_POLICY = "script-src 'self' 'unsafe-inline'";
const LOCAL_DEVELOPMENT_SCRIPT_POLICY = "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
const BASE_RESOURCE_POLICY =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; frame-src 'none'; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";
const PERMISSIONS_POLICY = 'camera=(), geolocation=(), microphone=(), payment=(), usb=()';
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains';

export interface BrowserSecurityHeader {
  key: string;
  value: string;
}

export function buildBrowserEgressPolicy(runtime: string | undefined): string {
  const localRuntime = runtime === 'development' || runtime === 'test';
  const connectPolicy = localRuntime ? LOCAL_DEVELOPMENT_CONNECT_POLICY : PRODUCTION_CONNECT_POLICY;
  const scriptPolicy = localRuntime ? LOCAL_DEVELOPMENT_SCRIPT_POLICY : PRODUCTION_SCRIPT_POLICY;

  return `${connectPolicy}; ${scriptPolicy}; ${BASE_RESOURCE_POLICY}`;
}

export function buildRestrictedWalletLabPolicy(runtime: string | undefined): string {
  return buildBrowserEgressPolicy(runtime);
}

export function buildBrowserSecurityHeaders(runtime: string | undefined): BrowserSecurityHeader[] {
  const headers: BrowserSecurityHeader[] = [
    {
      key: 'Content-Security-Policy',
      value: buildBrowserEgressPolicy(runtime),
    },
    {
      key: 'Permissions-Policy',
      value: PERMISSIONS_POLICY,
    },
    {
      key: 'Referrer-Policy',
      value: 'no-referrer',
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
  ];

  if (runtime === 'production') {
    headers.push({
      key: 'Strict-Transport-Security',
      value: STRICT_TRANSPORT_SECURITY,
    });
  }

  return headers;
}

export function buildRestrictedWalletLabSecurityHeaders(
  runtime: string | undefined,
): BrowserSecurityHeader[] {
  return [
    { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
    ...buildBrowserSecurityHeaders(runtime),
    { key: 'Pragma', value: 'no-cache' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  ];
}
