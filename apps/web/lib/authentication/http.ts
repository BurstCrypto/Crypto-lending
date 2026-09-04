import { AuthenticationUnavailableError } from './errors';
import { BoundedResponseError, readBoundedJsonResponse } from '../http/bounded-response';

export type AuthenticationFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const MAX_AUTHENTICATION_RESPONSE_BYTES = 16_384;

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

export async function readBoundedJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  try {
    return await readBoundedJsonResponse(response, {
      maximumBytes: MAX_AUTHENTICATION_RESPONSE_BYTES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    if (!(error instanceof BoundedResponseError)) throw error;
    throw new AuthenticationUnavailableError();
  }
}
