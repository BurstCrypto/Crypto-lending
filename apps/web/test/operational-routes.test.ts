// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as getHealth } from '../app/api/health/route';
import { GET as getVersion } from '../app/api/version/route';

describe('operational routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports web health', async () => {
    vi.stubEnv('APP_VERSION', '0123456789abcdef0123456789abcdef01234567');
    const response = getHealth();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: 'web',
      status: 'ok',
      version: '0123456789abcdef0123456789abcdef01234567',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('reports the application version', async () => {
    vi.stubEnv('APP_VERSION', '0123456789abcdef0123456789abcdef01234567');
    const response = getVersion();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: 'web',
      version: '0123456789abcdef0123456789abcdef01234567',
    });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-padded', ' 0123456789abcdef0123456789abcdef01234567'],
    ['mixed-case', '0123456789ABCDEF0123456789abcdef01234567'],
    ['non-revision', '0.1.0'],
  ])('fails production health closed for a %s server version', async (_label, version) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_VERSION', version);
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0123456789abcdef0123456789abcdef01234567');

    const response = getHealth();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      service: 'web',
      status: 'unavailable',
    });
  });

  it('does not expose a cacheable version response when production identity is absent', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_VERSION', undefined);

    const response = getVersion();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      service: 'web',
      status: 'unavailable',
    });
  });
});
