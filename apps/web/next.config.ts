import type { NextConfig } from 'next';

import {
  buildLocalDemoRedirects,
  buildLocalDemoRewrites,
  loadLocalDemoWebConfig,
} from './lib/local-demo/config-server.js';
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
  async redirects() {
    return buildLocalDemoRedirects(loadLocalDemoWebConfig());
  },
  async rewrites() {
    const apiProxyRewrites = buildWebApiProxyRewrites(loadWebApiProxyConfig());
    return apiProxyRewrites.length > 0
      ? apiProxyRewrites
      : buildLocalDemoRewrites(loadLocalDemoWebConfig());
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
      {
        source: '/portfolio',
        headers: ACCOUNT_SHELL_HEADERS,
      },
      {
        source: '/platforms',
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
