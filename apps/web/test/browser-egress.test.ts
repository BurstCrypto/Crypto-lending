import { describe, expect, it } from 'vitest';

import nextConfig from '../next.config';
import {
  buildBrowserEgressPolicy,
  buildRestrictedWalletLabPolicy,
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

  it('installs the generated connect policy on every web route', async () => {
    const entries = await nextConfig.headers();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toBe('/:path*');
    expect(entries[0]?.headers).toContainEqual({
      key: 'Content-Security-Policy',
      value: buildBrowserEgressPolicy(process.env.NODE_ENV),
    });
  });
});
