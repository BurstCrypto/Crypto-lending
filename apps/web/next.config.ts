import type { NextConfig } from 'next';

import { buildBrowserEgressPolicy } from './lib/security/browser-egress';

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: buildBrowserEgressPolicy(process.env.NODE_ENV),
          },
        ],
      },
    ];
  },
} satisfies NextConfig;

export default nextConfig;
