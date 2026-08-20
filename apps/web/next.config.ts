import type { NextConfig } from 'next';

import { resolveBuildId } from './lib/build-id';
import { buildBrowserSecurityHeaders } from './lib/security/browser-egress';

const nextConfig = {
  generateBuildId: () => resolveBuildId(),
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
