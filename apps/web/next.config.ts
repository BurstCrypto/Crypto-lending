import type { NextConfig } from 'next';

import { buildWebApiProxyRewrites, loadWebApiProxyConfig } from './lib/runtime/api-proxy-config.js';
import { buildBrowserSecurityHeaders } from './lib/security/browser-egress.js';

const ACCOUNT_SHELL_HEADERS = [
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
];

const nextConfig = {
  agentRules: false,
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return buildWebApiProxyRewrites(loadWebApiProxyConfig());
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildBrowserSecurityHeaders(process.env.NODE_ENV),
      },
      {
        source: '/account/:path*',
        headers: ACCOUNT_SHELL_HEADERS,
      },
      {
        source: '/portfolio',
        headers: ACCOUNT_SHELL_HEADERS,
      },
      {
        source: '/platforms',
        headers: ACCOUNT_SHELL_HEADERS,
      },
    ];
  },
} satisfies NextConfig;

export default nextConfig;
