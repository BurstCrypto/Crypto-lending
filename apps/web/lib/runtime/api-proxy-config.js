const STANDALONE_API_ORIGIN = 'http://127.0.0.1:3001';

export class WebApiProxyConfigurationError extends Error {
  code = 'WEB_API_PROXY_CONFIGURATION_ERROR';

  constructor(field) {
    super(`Invalid web API proxy configuration: ${field}`);
    this.name = 'WebApiProxyConfigurationError';
    this.field = field;
  }
}

function fail(field) {
  throw new WebApiProxyConfigurationError(field);
}

/**
 * Opt-in proxy for running the Next.js and API development processes
 * separately. The destination is deliberately fixed so this server-only
 * setting cannot become an arbitrary request proxy.
 */
export function loadWebApiProxyConfig(environment = process.env) {
  const mode = environment.WEB_API_PROXY_MODE;
  if (mode === undefined || mode === 'disabled') {
    if (environment.WEB_API_PROXY_ORIGIN !== undefined) {
      return fail('WEB_API_PROXY_ORIGIN');
    }
    return Object.freeze({ enabled: false });
  }
  if (mode !== 'enabled') return fail('WEB_API_PROXY_MODE');
  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    return fail('NODE_ENV');
  }
  if (environment.WEB_API_PROXY_ORIGIN !== STANDALONE_API_ORIGIN) {
    return fail('WEB_API_PROXY_ORIGIN');
  }

  return Object.freeze({
    enabled: true,
    apiOrigin: STANDALONE_API_ORIGIN,
  });
}

export function buildWebApiProxyRewrites(config) {
  if (!config.enabled) return [];
  return [
    {
      source: '/api/v1/:path*',
      destination: `${config.apiOrigin}/api/v1/:path*`,
    },
  ];
}
