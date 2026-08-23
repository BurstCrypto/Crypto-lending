import { AuthenticationUnavailableError } from './errors';

export type AuthenticationFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const MAX_AUTHENTICATION_RESPONSE_CHARACTERS = 16_384;

export function isAbortFailure(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
  );
}

export function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (value === null || !/^[1-9][0-9]{0,2}$/u.test(value)) return undefined;
  const parsed = Number(value);
  return parsed <= 300 ? parsed : undefined;
}

export async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new AuthenticationUnavailableError();

  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) ||
      Number(contentLength) > MAX_AUTHENTICATION_RESPONSE_CHARACTERS)
  ) {
    throw new AuthenticationUnavailableError();
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new AuthenticationUnavailableError();
  }
  if (text.length < 1 || text.length > MAX_AUTHENTICATION_RESPONSE_CHARACTERS) {
    throw new AuthenticationUnavailableError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AuthenticationUnavailableError();
  }
}
