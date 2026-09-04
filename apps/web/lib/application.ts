const DEFAULT_VERSION = '0.1.0';
const DEFAULT_ENVIRONMENT = 'local';
const PRODUCTION_VERSION_PATTERN = /^[a-f0-9]{40}$/u;

export class ApplicationIdentityConfigurationError extends Error {
  readonly code = 'APPLICATION_IDENTITY_CONFIGURATION_ERROR' as const;

  constructor() {
    super('Application identity is not configured');
    this.name = 'ApplicationIdentityConfigurationError';
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV?.trim().toLowerCase() === 'production';
}

export function getApplicationVersion(): string {
  const configured = process.env.APP_VERSION;
  if (isProduction()) {
    if (
      configured === undefined ||
      configured.trim() !== configured ||
      !PRODUCTION_VERSION_PATTERN.test(configured)
    ) {
      throw new ApplicationIdentityConfigurationError();
    }
    return configured;
  }
  return configured?.trim() || process.env.NEXT_PUBLIC_APP_VERSION?.trim() || DEFAULT_VERSION;
}

export function getApplicationEnvironment(): string {
  return (
    process.env.APP_ENV?.trim() || process.env.NEXT_PUBLIC_APP_ENV?.trim() || DEFAULT_ENVIRONMENT
  );
}
