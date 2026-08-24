import type { NextConfig } from 'next';

import { buildLocalDemoRewrites, loadLocalDemoWebConfig } from './lib/local-demo/config.server';
import { buildBrowserSecurityHeaders } from './lib/security/browser-egress';

const ACCOUNT_SHELL_HEADERS = [
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
];

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return buildLocalDemoRewrites(loadLocalDemoWebConfig());
  },
  async headers() {
    const localDemo = loadLocalDemoWebConfig();
    return [
      {
        source: '/:path*',
        headers: buildBrowserSecurityHeaders(process.env.NODE_ENV),
      },
      {
        source: '/account/:path*',
        headers: ACCOUNT_SHELL_HEADERS,
      },
      ...(localDemo.enabled
        ? [
            {
              source: '/:path*',
              headers: [
                { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
                { key: 'X-Crypto-Lending-Demo-Mode', value: 'synthetic-local' },
                { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
              ],
            },
          ]
        : []),
    ];
  },
} satisfies NextConfig;

export default nextConfig;
