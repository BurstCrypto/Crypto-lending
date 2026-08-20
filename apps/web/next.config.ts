import type { NextConfig } from 'next';

import { buildBrowserSecurityHeaders } from './lib/security/browser-egress';

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildBrowserSecurityHeaders(process.env.NODE_ENV),
      },
    ];
  },
} satisfies NextConfig;

export default nextConfig;
