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
});
