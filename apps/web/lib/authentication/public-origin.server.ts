type AuthenticationPublicOriginEnvironment = Readonly<{
  AUTH_PUBLIC_ORIGIN?: string | undefined;
  NODE_ENV?: string | undefined;
}>;

const MAX_ORIGIN_LENGTH = 2_048;
const EXACT_VISIBLE_ASCII = /^[\x21-\x7e]+$/u;

function isExactLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Reads the server-only public origin used to build browser authentication redirects.
 * Invalid or non-canonical configuration returns null so middleware can fail closed.
 */
export function readCanonicalAuthenticationPublicOrigin(
  environment: AuthenticationPublicOriginEnvironment,
): string | null {
  const value = environment.AUTH_PUBLIC_ORIGIN;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ORIGIN_LENGTH ||
    !EXACT_VISIBLE_ASCII.test(value)
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const localRuntime = environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test';
  const permittedProtocol =
    parsed.protocol === 'https:' ||
    (localRuntime && parsed.protocol === 'http:' && isExactLoopbackHostname(parsed.hostname));

  if (
    !permittedProtocol ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.origin !== value
  ) {
    return null;
  }

  return parsed.origin;
}
