// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as getHealth } from '../app/api/health/route';
import { GET as getVersion } from '../app/api/version/route';

const PRODUCTION_VERSION = '0123456789abcdef0123456789abcdef01234567';
const PRODUCTION_ORIGIN = 'https://app.example';

describe('operational routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports web health only when production identity and authentication origin are valid', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_VERSION', PRODUCTION_VERSION);
    vi.stubEnv('AUTH_PUBLIC_ORIGIN', PRODUCTION_ORIGIN);
    const response = getHealth();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: 'web',
      status: 'ok',
      version: PRODUCTION_VERSION,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['trailing-slash', 'https://app.example/'],
    ['insecure-non-loopback', 'http://app.example'],
  ])('fails production health closed for a %s authentication origin', async (_label, origin) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_VERSION', PRODUCTION_VERSION);
    vi.stubEnv('AUTH_PUBLIC_ORIGIN', origin);

    const response = getHealth();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      service: 'web',
      status: 'unavailable',
    });
  });

  it.each(['development', 'test'])(
    'accepts an exact HTTP loopback authentication origin in %s',
    async (runtime) => {
      vi.stubEnv('NODE_ENV', runtime);
      vi.stubEnv('APP_VERSION', '0.1.0');
      vi.stubEnv('AUTH_PUBLIC_ORIGIN', 'http://127.0.0.1:3000');

      const response = getHealth();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        service: 'web',
        status: 'ok',
        version: '0.1.0',
      });
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it('reports the application version', async () => {
    vi.stubEnv('APP_VERSION', PRODUCTION_VERSION);
    const response = getVersion();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: 'web',
      version: PRODUCTION_VERSION,
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
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', PRODUCTION_VERSION);
    vi.stubEnv('AUTH_PUBLIC_ORIGIN', PRODUCTION_ORIGIN);

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
