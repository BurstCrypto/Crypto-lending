export interface DisabledWebApiProxyConfig {
  readonly enabled: false;
}

export interface EnabledWebApiProxyConfig {
  readonly enabled: true;
  readonly apiOrigin: 'http://127.0.0.1:3001';
}

export type WebApiProxyConfig = DisabledWebApiProxyConfig | EnabledWebApiProxyConfig;

export class WebApiProxyConfigurationError extends Error {
  readonly code: 'WEB_API_PROXY_CONFIGURATION_ERROR';
  readonly field: string;

  constructor(field: string);
}

export function loadWebApiProxyConfig(environment?: Readonly<NodeJS.ProcessEnv>): WebApiProxyConfig;

export function buildWebApiProxyRewrites(
  config: WebApiProxyConfig,
): Array<{ source: string; destination: string }>;
