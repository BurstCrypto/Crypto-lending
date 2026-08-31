import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LOCAL_DEMO_BANNER_TEXT, LocalDemoBanner } from '../components/local-demo-banner';
import {
  buildLocalDemoRedirects,
  buildLocalDemoRewrites,
  loadLocalDemoWebConfig,
  LocalDemoWebConfigurationError,
} from '../lib/local-demo/config-server';

function enabledEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    LOCAL_DEMO_MODE: 'enabled',
    LOCAL_DEMO_API_ORIGIN: 'http://127.0.0.1:3001',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
  };
}

describe('local demo web configuration', () => {
  it('is disabled by default and rejects dormant proxy configuration', () => {
    expect(loadLocalDemoWebConfig({ NODE_ENV: 'production' })).toEqual({ enabled: false });
    expect(() =>
      loadLocalDemoWebConfig({
        NODE_ENV: 'development',
        LOCAL_DEMO_API_ORIGIN: 'http://127.0.0.1:3001',
      }),
    ).toThrow(LocalDemoWebConfigurationError);
  });

  it('pins the only enabled composition to the two reviewed loopback origins', () => {
    const config = loadLocalDemoWebConfig(enabledEnvironment());
    expect(config).toEqual({
      enabled: true,
      apiOrigin: 'http://127.0.0.1:3001',
      publicOrigin: 'http://127.0.0.1:3000',
    });
    expect(buildLocalDemoRewrites(config)).toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://127.0.0.1:3001/api/v1/:path*',
      },
    ]);
    expect(buildLocalDemoRedirects(config)).toEqual([
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'localhost' }],
        destination: 'http://127.0.0.1:3000/:path*',
        permanent: false,
      },
    ]);
  });

  it('does not install a host redirect outside the explicit local demo', () => {
    expect(buildLocalDemoRedirects(loadLocalDemoWebConfig({ NODE_ENV: 'production' }))).toEqual([]);
  });

  it.each([
    ['NODE_ENV', 'production'],
    ['NODE_ENV', undefined],
    ['LOCAL_DEMO_MODE', 'true'],
    ['LOCAL_DEMO_API_ORIGIN', 'http://localhost:3001'],
    ['LOCAL_DEMO_API_ORIGIN', 'https://127.0.0.1:3001'],
    ['LOCAL_DEMO_API_ORIGIN', 'http://127.0.0.1:3001/path'],
    ['AUTH_PUBLIC_ORIGIN', 'http://localhost:3000'],
    ['AUTH_PUBLIC_ORIGIN', 'https://127.0.0.1:3000'],
  ])('rejects an enabled demo with invalid %s', (field, value) => {
    const environment = enabledEnvironment();
    if (value === undefined) delete environment[field];
    else environment[field] = value;
    expect(() => loadLocalDemoWebConfig(environment)).toThrow(LocalDemoWebConfigurationError);
  });
});

describe('local demo banner', () => {
  it('is persistent and unambiguous only when the guarded mode is enabled', () => {
    const { rerender } = render(<LocalDemoBanner enabled={false} />);
    expect(screen.queryByText(LOCAL_DEMO_BANNER_TEXT)).not.toBeInTheDocument();

    rerender(<LocalDemoBanner enabled />);
    expect(screen.getByRole('status', { name: 'Local demo mode' })).toHaveTextContent(
      LOCAL_DEMO_BANNER_TEXT,
    );
    expect(LOCAL_DEMO_BANNER_TEXT).toBe(
      'Synthetic local portfolio data — no real-value assets; only the labeled Devnet proof and dashboard make live public-chain requests',
    );
    expect(LOCAL_DEMO_BANNER_TEXT).not.toContain('no real providers');
  });
});
