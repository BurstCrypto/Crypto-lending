import { afterEach, describe, expect, it, vi } from 'vitest';

import nextConfig from '../next.config';
import {
  buildWebApiProxyRewrites,
  loadWebApiProxyConfig,
  WebApiProxyConfigurationError,
} from '../lib/runtime/api-proxy-config';

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    WEB_API_PROXY_MODE: 'enabled',
    WEB_API_PROXY_ORIGIN: 'http://127.0.0.1:3001',
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('standalone web API proxy configuration', () => {
  it('is disabled by default and rejects a dormant destination', () => {
    const config = loadWebApiProxyConfig({ NODE_ENV: 'production' });
    expect(config).toEqual({ enabled: false });
    expect(Object.isFrozen(config)).toBe(true);
    expect(buildWebApiProxyRewrites(config)).toEqual([]);

    expect(() =>
      loadWebApiProxyConfig({
        NODE_ENV: 'development',
        WEB_API_PROXY_ORIGIN: 'http://127.0.0.1:3001',
      }),
    ).toThrow(WebApiProxyConfigurationError);
  });

  it('installs the exact loopback rewrite for separate local development processes', () => {
    const config = loadWebApiProxyConfig(enabledEnvironment());

    expect(config).toEqual({
      enabled: true,
      apiOrigin: 'http://127.0.0.1:3001',
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(buildWebApiProxyRewrites(config)).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://127.0.0.1:3001/api/v1/:path*',
      },
    ]);
  });

  it('accepts the exact configuration in tests without enabling production use', () => {
    const testEnvironment: NodeJS.ProcessEnv = {
      ...enabledEnvironment(),
      NODE_ENV: 'test',
    };
    expect(loadWebApiProxyConfig(testEnvironment)).toMatchObject({ enabled: true });

    const productionEnvironment: NodeJS.ProcessEnv = {
      ...enabledEnvironment(),
      NODE_ENV: 'production',
    };
    expect(() => loadWebApiProxyConfig(productionEnvironment)).toThrow(
      WebApiProxyConfigurationError,
    );
  });

  it.each([
    ['NODE_ENV', undefined],
    ['WEB_API_PROXY_MODE', 'true'],
    ['WEB_API_PROXY_MODE', 'ENABLED'],
    ['WEB_API_PROXY_ORIGIN', 'http://localhost:3001'],
    ['WEB_API_PROXY_ORIGIN', 'https://127.0.0.1:3001'],
    ['WEB_API_PROXY_ORIGIN', 'http://127.0.0.1:3001/'],
    ['WEB_API_PROXY_ORIGIN', 'http://127.0.0.1:3001/api'],
    ['WEB_API_PROXY_ORIGIN', 'http://127.0.0.2:3001'],
  ])('rejects an enabled proxy with invalid %s', (field, value) => {
    const environment = enabledEnvironment();
    if (value === undefined) delete environment[field];
    else environment[field] = value;

    expect(() => loadWebApiProxyConfig(environment)).toThrow(WebApiProxyConfigurationError);
  });

  it('rejects a destination left behind when explicitly disabled', () => {
    expect(() =>
      loadWebApiProxyConfig({
        NODE_ENV: 'development',
        WEB_API_PROXY_MODE: 'disabled',
        WEB_API_PROXY_ORIGIN: 'http://127.0.0.1:3001',
      }),
    ).toThrow(WebApiProxyConfigurationError);
  });
});

describe('Next.js API routing composition', () => {
  it('uses the standalone loopback proxy when explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WEB_API_PROXY_MODE', 'enabled');
    vi.stubEnv('WEB_API_PROXY_ORIGIN', 'http://127.0.0.1:3001');

    await expect(nextConfig.rewrites()).resolves.toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://127.0.0.1:3001/api/v1/:path*',
      },
    ]);
  });

  it('does not let obsolete local-demo settings create an application rewrite', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOCAL_DEMO_MODE', 'enabled');
    vi.stubEnv('LOCAL_DEMO_API_ORIGIN', 'http://127.0.0.1:3001');
    vi.stubEnv('WEB_API_PROXY_MODE', 'disabled');
    vi.stubEnv('WEB_API_PROXY_ORIGIN', undefined);

    await expect(nextConfig.rewrites()).resolves.toEqual([]);
  });

  it('installs no API rewrite when the standalone proxy is disabled', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WEB_API_PROXY_MODE', 'disabled');
    vi.stubEnv('WEB_API_PROXY_ORIGIN', undefined);

    await expect(nextConfig.rewrites()).resolves.toEqual([]);
  });
});
