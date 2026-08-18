import type { NextConfig } from 'next';

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
} satisfies NextConfig;

export default nextConfig;
