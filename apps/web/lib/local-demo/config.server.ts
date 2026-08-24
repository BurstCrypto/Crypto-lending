const LOCAL_DEMO_API_ORIGIN = 'http://127.0.0.1:3001';
const LOCAL_DEMO_PUBLIC_ORIGIN = 'http://127.0.0.1:3000';

export interface DisabledLocalDemoWebConfig {
  readonly enabled: false;
}

export interface EnabledLocalDemoWebConfig {
  readonly enabled: true;
  readonly apiOrigin: typeof LOCAL_DEMO_API_ORIGIN;
  readonly publicOrigin: typeof LOCAL_DEMO_PUBLIC_ORIGIN;
}

export type LocalDemoWebConfig = DisabledLocalDemoWebConfig | EnabledLocalDemoWebConfig;

export class LocalDemoWebConfigurationError extends Error {
  readonly code = 'LOCAL_DEMO_WEB_CONFIGURATION_ERROR' as const;

  constructor(readonly field: string) {
    super(`Invalid local demo web configuration: ${field}`);
    this.name = 'LocalDemoWebConfigurationError';
  }
}

function fail(field: string): never {
  throw new LocalDemoWebConfigurationError(field);
}

/**
 * The local demo proxy is deliberately not configurable beyond two pinned
 * loopback origins. That keeps an opt-in developer flag from becoming a
 * general-purpose server-side request proxy.
 */
export function loadLocalDemoWebConfig(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): LocalDemoWebConfig {
  const mode = environment.LOCAL_DEMO_MODE;
  if (mode === undefined || mode === 'disabled') {
    if (environment.LOCAL_DEMO_API_ORIGIN !== undefined) {
      return fail('LOCAL_DEMO_API_ORIGIN');
    }
    return Object.freeze({ enabled: false });
  }
  if (mode !== 'enabled') return fail('LOCAL_DEMO_MODE');
  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    return fail('NODE_ENV');
  }
  if (environment.AUTH_PUBLIC_ORIGIN !== LOCAL_DEMO_PUBLIC_ORIGIN) {
    return fail('AUTH_PUBLIC_ORIGIN');
  }
  if (environment.LOCAL_DEMO_API_ORIGIN !== LOCAL_DEMO_API_ORIGIN) {
    return fail('LOCAL_DEMO_API_ORIGIN');
  }

  return Object.freeze({
    enabled: true,
    apiOrigin: LOCAL_DEMO_API_ORIGIN,
    publicOrigin: LOCAL_DEMO_PUBLIC_ORIGIN,
  });
}

export function buildLocalDemoRewrites(config: LocalDemoWebConfig) {
  if (!config.enabled) return [];
  return [
    {
      source: '/api/v1/:path*',
      destination: `${config.apiOrigin}/api/v1/:path*`,
    },
  ];
}
