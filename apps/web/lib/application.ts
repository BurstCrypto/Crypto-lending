const DEFAULT_VERSION = '0.1.0';
const DEFAULT_ENVIRONMENT = 'local';

export function getApplicationVersion(): string {
  return (
    process.env.APP_VERSION?.trim() ||
    process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
    DEFAULT_VERSION
  );
}

export function getApplicationEnvironment(): string {
  return (
    process.env.APP_ENV?.trim() || process.env.NEXT_PUBLIC_APP_ENV?.trim() || DEFAULT_ENVIRONMENT
  );
}
