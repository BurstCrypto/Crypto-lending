import type { NextConfig } from 'next';

import { buildWebApiProxyRewrites, loadWebApiProxyConfig } from './lib/runtime/api-proxy-config.js';
import { buildBrowserSecurityHeaders } from './lib/security/browser-egress.js';
import { SOLANA_BROWSER_RPC_URL } from './lib/mainnet/public-config';

const ACCOUNT_SHELL_HEADERS = [
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
];

const nextConfig = {
  agentRules: false,
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: [
    '@0dotxyz/p0-ts-sdk',
    '@jup-ag/lend',
    '@solendprotocol/solend-sdk',
    '@coral-xyz/anchor',
  ],
  outputFileTracingIncludes: {
    '/api/mainnet': ['../../onchain/build/*.json'],
    '/api/local-mainnet': ['../../onchain/build/*.json'],
  },
  async rewrites() {
    // The mainnet setup has its own local API. Do not forward account requests
    // to another project that may be using the ordinary development API port.
    if (process.env.NODE_ENV === 'development' && process.env.LOCAL_MAINNET_TEST_MODE === 'enabled')
      return [];
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
      ...['/mainnet-test', '/portfolio'].map((source) => ({
        source,
        headers: buildBrowserSecurityHeaders(process.env.NODE_ENV).map((header) =>
          header.key === 'Content-Security-Policy'
            ? {
                ...header,
                value: header.value.replace(
                  "connect-src 'self'",
                  `connect-src 'self' ${SOLANA_BROWSER_RPC_URL}`,
                ),
              }
            : header,
        ),
      })),
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
