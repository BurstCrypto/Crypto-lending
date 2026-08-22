import { isIP } from 'node:net';

export const AUTHENTICATION_CLIENT_ADDRESS_CONFIG = Symbol('AUTHENTICATION_CLIENT_ADDRESS_CONFIG');

export type AuthenticationIpFamily = 'ipv4' | 'ipv6';

export interface AuthenticationTrustedProxyRange {
  readonly address: string;
  readonly prefixLength: number;
  readonly family: AuthenticationIpFamily;
}

export type AuthenticationClientAddressConfig =
  | Readonly<{ mode: 'direct' }>
  | Readonly<{
      mode: 'trusted-single-proxy';
      trustedProxyRanges: readonly AuthenticationTrustedProxyRange[];
    }>;

export class AuthenticationClientAddressConfigurationError extends Error {
  readonly code = 'AUTHENTICATION_CLIENT_ADDRESS_CONFIGURATION_ERROR' as const;

  constructor(readonly field: string) {
    super(`Invalid authentication client-address configuration: ${field}`);
    this.name = 'AuthenticationClientAddressConfigurationError';
  }
}

function fail(field: string): never {
  throw new AuthenticationClientAddressConfigurationError(field);
}

export function canonicalAuthenticationIpAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;

  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null;
    return hostname.slice(1, -1);
  } catch {
    return null;
  }
}

function parseTrustedProxyRange(value: string): AuthenticationTrustedProxyRange {
  const parts = value.split('/');
  if (parts.length > 2) return fail('AUTH_TRUSTED_PROXY_CIDRS');
  const addressText = parts[0];
  if (!addressText) return fail('AUTH_TRUSTED_PROXY_CIDRS');
  const address = canonicalAuthenticationIpAddress(addressText);
  if (address === null || address !== addressText) return fail('AUTH_TRUSTED_PROXY_CIDRS');

  const ipVersion = isIP(address);
  const maximumPrefixLength = ipVersion === 4 ? 32 : 128;
  const prefixText = parts[1];
  let prefixLength = maximumPrefixLength;
  if (prefixText !== undefined) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(prefixText)) {
      return fail('AUTH_TRUSTED_PROXY_CIDRS');
    }
    prefixLength = Number(prefixText);
    if (prefixLength > maximumPrefixLength) return fail('AUTH_TRUSTED_PROXY_CIDRS');
  }

  return Object.freeze({
    address,
    prefixLength,
    family: ipVersion === 4 ? 'ipv4' : 'ipv6',
  });
}

export function loadAuthenticationClientAddressConfig(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): AuthenticationClientAddressConfig {
  const rawMode = environment.AUTH_CLIENT_ADDRESS_MODE;
  const mode = rawMode ?? 'direct';
  const rawRanges = environment.AUTH_TRUSTED_PROXY_CIDRS;

  if (mode === 'direct') {
    if (rawRanges !== undefined) return fail('AUTH_TRUSTED_PROXY_CIDRS');
    return Object.freeze({ mode: 'direct' });
  }
  if (mode !== 'trusted-single-proxy') return fail('AUTH_CLIENT_ADDRESS_MODE');
  if (
    rawRanges === undefined ||
    rawRanges.length < 1 ||
    rawRanges.length > 2_048 ||
    rawRanges.trim() !== rawRanges
  ) {
    return fail('AUTH_TRUSTED_PROXY_CIDRS');
  }

  const rangeTexts = rawRanges.split(',');
  if (rangeTexts.length > 32 || rangeTexts.some((value) => value.length < 1)) {
    return fail('AUTH_TRUSTED_PROXY_CIDRS');
  }
  const trustedProxyRanges = rangeTexts.map(parseTrustedProxyRange);
  const uniqueRanges = new Set(
    trustedProxyRanges.map(
      ({ family, address, prefixLength }) => `${family}:${address}/${prefixLength}`,
    ),
  );
  if (uniqueRanges.size !== trustedProxyRanges.length) {
    return fail('AUTH_TRUSTED_PROXY_CIDRS');
  }

  return Object.freeze({
    mode: 'trusted-single-proxy',
    trustedProxyRanges: Object.freeze(trustedProxyRanges),
  });
}
