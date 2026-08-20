import { applyHttpServerLimits, loadHttpServerOptions } from './server-options';

describe('HTTP server options', () => {
  it('binds non-production servers to loopback and applies bounded defaults', () => {
    expect(loadHttpServerOptions({ NODE_ENV: 'development' })).toEqual({
      headersTimeoutMs: 10_000,
      host: '127.0.0.1',
      keepAliveTimeoutMs: 5_000,
      maxHeadersCount: 100,
      maxRequestsPerSocket: 1_000,
      port: 3_001,
      requestTimeoutMs: 30_000,
    });
  });

  it('uses an explicit production bind address and rejects unsafe numeric values', () => {
    expect(loadHttpServerOptions({ NODE_ENV: 'production' })).toMatchObject({
      host: '0.0.0.0',
      keepAliveTimeoutMs: 65_000,
    });
    expect(loadHttpServerOptions({ NODE_ENV: ' Production ' })).toMatchObject({
      host: '0.0.0.0',
      keepAliveTimeoutMs: 65_000,
    });
    expect(() => loadHttpServerOptions({ PORT: '0' })).toThrow('PORT must be an integer');
    expect(() => loadHttpServerOptions({ PORT: '70000' })).toThrow('PORT must be an integer');
    expect(() =>
      loadHttpServerOptions({
        HTTP_HEADERS_TIMEOUT_MS: '31000',
        HTTP_REQUEST_TIMEOUT_MS: '30000',
      }),
    ).toThrow('HTTP_HEADERS_TIMEOUT_MS must be an integer');
    expect(loadHttpServerOptions({ HTTP_REQUEST_TIMEOUT_MS: '1000' })).toMatchObject({
      headersTimeoutMs: 1_000,
      requestTimeoutMs: 1_000,
    });
  });

  it('copies limits onto the Node HTTP server', () => {
    const server = {
      headersTimeout: 0,
      keepAliveTimeout: 0,
      maxHeadersCount: 0,
      maxRequestsPerSocket: 0,
      requestTimeout: 0,
    };
    const options = loadHttpServerOptions({ NODE_ENV: 'test' });

    applyHttpServerLimits(server, options);

    expect(server).toMatchObject({
      headersTimeout: options.headersTimeoutMs,
      keepAliveTimeout: options.keepAliveTimeoutMs,
      maxHeadersCount: options.maxHeadersCount,
      maxRequestsPerSocket: options.maxRequestsPerSocket,
      requestTimeout: options.requestTimeoutMs,
    });
  });
});
