export interface DisabledLocalDemoWebConfig {
  readonly enabled: false;
}

export interface EnabledLocalDemoWebConfig {
  readonly enabled: true;
  readonly apiOrigin: 'http://127.0.0.1:3001';
  readonly publicOrigin: 'http://127.0.0.1:3000';
}

export type LocalDemoWebConfig = DisabledLocalDemoWebConfig | EnabledLocalDemoWebConfig;

export class LocalDemoWebConfigurationError extends Error {
  readonly code: 'LOCAL_DEMO_WEB_CONFIGURATION_ERROR';
  readonly field: string;

  constructor(field: string);
}

export function loadLocalDemoWebConfig(
  environment?: Readonly<NodeJS.ProcessEnv>,
): LocalDemoWebConfig;

export function buildLocalDemoRewrites(
  config: LocalDemoWebConfig,
): Array<{ source: string; destination: string }>;

export function buildLocalDemoRedirects(config: LocalDemoWebConfig): Array<{
  source: string;
  has: Array<{ type: 'host'; value: string }>;
  destination: string;
  permanent: false;
}>;
