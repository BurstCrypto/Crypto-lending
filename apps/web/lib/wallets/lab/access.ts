import { timingSafeEqual } from 'node:crypto';

export type WalletLabEnvironment = 'local' | 'preview';

export interface WalletLabAccessConfiguration {
  enabled: boolean;
  environment: WalletLabEnvironment | null;
  developmentRuntime: boolean;
  username: string;
  password: string;
}

export type WalletLabAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'disabled'
        | 'environment-not-authorized'
        | 'invalid-configuration'
        | 'insecure-transport'
        | 'unauthorized';
      status: 401 | 404;
    };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MINIMUM_PASSWORD_LENGTH = 16;

export function readWalletLabAccessConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): WalletLabAccessConfiguration {
  const labEnvironment = environment.WALLET_LAB_ENVIRONMENT;

  return {
    enabled: environment.WALLET_LAB_ENABLED === 'true',
    environment: labEnvironment === 'local' || labEnvironment === 'preview' ? labEnvironment : null,
    developmentRuntime: environment.NODE_ENV === 'development',
    username: environment.WALLET_LAB_BASIC_AUTH_USERNAME ?? '',
    password: environment.WALLET_LAB_BASIC_AUTH_PASSWORD ?? '',
  };
}

function isValidConfiguration(configuration: WalletLabAccessConfiguration): boolean {
  return Boolean(
    configuration.environment &&
    configuration.username.trim() === configuration.username &&
    configuration.username.length > 0 &&
    !configuration.username.includes(':') &&
    configuration.password.length >= MINIMUM_PASSWORD_LENGTH,
  );
}

function isAuthorizedLocalRequest(
  requestUrl: URL,
  configuration: WalletLabAccessConfiguration,
): boolean {
  return Boolean(
    configuration.developmentRuntime &&
    LOCAL_HOSTS.has(requestUrl.hostname) &&
    (requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:'),
  );
}

function constantTimeMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  const comparisonLength = Math.max(actualBytes.length, expectedBytes.length, 1);
  const paddedActual = Buffer.alloc(comparisonLength);
  const paddedExpected = Buffer.alloc(comparisonLength);
  actualBytes.copy(paddedActual);
  expectedBytes.copy(paddedExpected);

  return (
    timingSafeEqual(paddedActual, paddedExpected) && actualBytes.length === expectedBytes.length
  );
}

function decodeBasicAuthorization(
  value: string | null,
): { username: string; password: string } | null {
  if (!value?.startsWith('Basic ')) return null;

  const encoded = value.slice('Basic '.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) return null;

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 1) return null;

  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export function decideWalletLabAccess(input: {
  authorization: string | null;
  configuration: WalletLabAccessConfiguration;
  forwardedProtocol: string | null;
  requestUrl: URL;
}): WalletLabAccessDecision {
  if (!input.configuration.enabled) return { allowed: false, reason: 'disabled', status: 404 };
  if (!isValidConfiguration(input.configuration)) {
    return { allowed: false, reason: 'invalid-configuration', status: 404 };
  }
  // A secured preview has not been authorized. Forwarded protocol headers are
  // deliberately ignored until an explicit trusted-proxy boundary exists.
  if (input.configuration.environment !== 'local') {
    return { allowed: false, reason: 'environment-not-authorized', status: 404 };
  }
  if (!isAuthorizedLocalRequest(input.requestUrl, input.configuration)) {
    return { allowed: false, reason: 'insecure-transport', status: 404 };
  }

  const credentials = decodeBasicAuthorization(input.authorization);
  if (
    !credentials ||
    !constantTimeMatches(credentials.username, input.configuration.username) ||
    !constantTimeMatches(credentials.password, input.configuration.password)
  ) {
    return { allowed: false, reason: 'unauthorized', status: 401 };
  }

  return { allowed: true };
}
