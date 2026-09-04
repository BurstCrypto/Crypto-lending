import { describe, expect, it } from 'vitest';

import nextConfig from '../next.config';
import {
  buildBrowserEgressPolicy,
  buildBrowserSecurityHeaders,
  buildRestrictedWalletLabPolicy,
  buildRestrictedWalletLabSecurityHeaders,
} from '../lib/security/browser-egress';

describe('browser no-external-egress policy', () => {
  it('denies external browser resources and service calls in production', () => {
    for (const runtime of ['production', undefined, 'unexpected']) {
      const policy = buildBrowserEgressPolicy(runtime);
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("connect-src 'self'");
      expect(policy).toContain("script-src 'self' 'unsafe-inline'");
      expect(policy).toContain("style-src 'self' 'unsafe-inline'");
      expect(policy).toContain("img-src 'self' data: blob:");
      expect(policy).toContain("font-src 'self' data:");
      expect(policy).toContain("media-src 'self' blob:");
      expect(policy).toContain("frame-src 'none'");
      expect(policy).toContain("form-action 'self'");
      expect(policy).toContain("object-src 'none'");
      expect(policy).not.toMatch(/(?:https?|wss?):\/\//);
    }
    expect(buildRestrictedWalletLabPolicy('production')).toBe(
      buildBrowserEgressPolicy('production'),
    );
  });

  it('limits development network and script exceptions to local tooling', () => {
    const policy = buildBrowserEgressPolicy('development');
    expect(policy).toContain('ws://127.0.0.1:*');
    expect(policy).toContain('ws://localhost:*');
    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(policy).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);
    expect(policy).not.toContain('0.0.0.0');
  });

  it('adds shared browser hardening and limits HSTS to production', () => {
    const productionHeaders = Object.fromEntries(
      buildBrowserSecurityHeaders('production').map(({ key, value }) => [key, value]),
    );
    const developmentHeaders = Object.fromEntries(
      buildBrowserSecurityHeaders('development').map(({ key, value }) => [key, value]),
    );

    expect(productionHeaders).toMatchObject({
      'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
      'Referrer-Policy': 'no-referrer',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    expect(developmentHeaders).not.toHaveProperty('Strict-Transport-Security');
  });

  it('preserves restricted wallet-lab cache and indexing protections', () => {
    const headers = Object.fromEntries(
      buildRestrictedWalletLabSecurityHeaders('development').map(({ key, value }) => [key, value]),
    );

    expect(headers).toMatchObject({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Security-Policy': buildRestrictedWalletLabPolicy('development'),
      'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
  });

  it('installs the generated connect policy on every web route', async () => {
    const entries = await nextConfig.headers();
    expect(entries).toHaveLength(6);
    expect(entries[0]?.source).toBe('/:path*');
    expect(entries[0]?.headers).toEqual(buildBrowserSecurityHeaders(process.env.NODE_ENV));
    expect(entries[1]).toEqual({
      source: '/account/:path*',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ],
    });
    expect(entries[2]).toEqual({
      source: '/portfolio',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ],
    });
    expect(entries[3]).toEqual({
      source: '/platforms',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ],
    });
    expect(entries[4]).toEqual({
      source: '/login',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ],
    });
    expect(entries[5]).toEqual({
      source: '/register',
      headers: [
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ],
    });
  });
});
