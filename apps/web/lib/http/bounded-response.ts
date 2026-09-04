export const API_REQUEST_TIMEOUT_MILLISECONDS = 10_000;
const DEFAULT_MAXIMUM_RESPONSE_CHUNKS = 4_096;

export class BoundedResponseError extends Error {
  constructor() {
    super('Invalid bounded response');
    this.name = 'BoundedResponseError';
  }
}

export class RequestDeadlineError extends Error {
  constructor() {
    super('Request deadline exceeded');
    this.name = 'RequestDeadlineError';
  }
}

export interface RequestDeadline {
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
  readonly dispose: () => void;
  readonly waitFor: <T>(operation: PromiseLike<T>) => Promise<T>;
}

export interface BoundedJsonResponseOptions {
  readonly maximumBytes: number;
  readonly maximumChunks?: number;
  readonly signal?: AbortSignal;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortReason(signal);
}

function isAborted(signal: AbortSignal | undefined): signal is AbortSignal {
  return signal?.aborted === true;
}

function waitForSignal<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void Promise.resolve(operation).catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortReason(signal));
    };

    signal.addEventListener('abort', handleAbort, { once: true });
    void Promise.resolve(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

export function createRequestDeadline(
  callerSignal?: AbortSignal,
  timeoutMilliseconds = API_REQUEST_TIMEOUT_MILLISECONDS,
): RequestDeadline {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
    throw new TypeError('request timeout must be a positive safe integer');
  }

  const controller = new AbortController();
  let timedOut = false;
  let disposed = false;
  const forwardCallerAbort = () => {
    if (!controller.signal.aborted) controller.abort(abortReason(callerSignal!));
  };
  callerSignal?.addEventListener('abort', forwardCallerAbort, { once: true });
  if (callerSignal?.aborted === true) forwardCallerAbort();

  const timeout = globalThis.setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort(new RequestDeadlineError());
  }, timeoutMilliseconds);

  return Object.freeze({
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      globalThis.clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', forwardCallerAbort);
    },
    waitFor: <T>(operation: PromiseLike<T>) => waitForSignal(operation, controller.signal),
  });
}

function fail(): never {
  throw new BoundedResponseError();
}

function cancelStream(stream: ReadableStream<Uint8Array>, reason?: unknown): void {
  try {
    void stream.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best effort; the response still fails closed.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason?: unknown): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best effort; the response still fails closed.
  }
}

function boundedPositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

export async function readBoundedJsonResponse(
  response: Response,
  options: BoundedJsonResponseOptions,
): Promise<unknown> {
  const maximumBytes = boundedPositiveInteger(options.maximumBytes, 'maximum response bytes');
  const maximumChunks = boundedPositiveInteger(
    options.maximumChunks ?? DEFAULT_MAXIMUM_RESPONSE_CHUNKS,
    'maximum response chunks',
  );
  if (options.signal?.aborted === true) {
    if (response.body !== null) cancelStream(response.body, abortReason(options.signal));
    throw abortReason(options.signal);
  }

  let contentType: string | undefined;
  let contentLength: string | null;
  try {
    contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    contentLength = response.headers.get('content-length');
  } catch {
    return fail();
  }

  if (contentType !== 'application/json') {
    if (response.body !== null) cancelStream(response.body);
    return fail();
  }
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    if (response.body !== null) cancelStream(response.body);
    return fail();
  }
  if (response.body === null) return fail();

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    return fail();
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks: string[] = [];
  let bytesRead = 0;
  let chunksRead = 0;
  let aborted = false;
  const handleAbort = () => {
    aborted = true;
    cancelReader(reader, abortReason(options.signal!));
  };
  options.signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    throwIfAborted(options.signal);
    while (true) {
      const { done, value } = await reader.read();
      if (aborted) throw abortReason(options.signal!);
      if (done) break;

      chunksRead += 1;
      if (value.byteLength === 0 || chunksRead > maximumChunks) {
        cancelReader(reader);
        return fail();
      }
      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        cancelReader(reader);
        return fail();
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());

    const body = chunks.join('');
    if (body.length < 1) return fail();
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return fail();
    }
  } catch (error) {
    if (isAborted(options.signal)) throw abortReason(options.signal);
    if (error instanceof BoundedResponseError) throw error;
    return fail();
  } finally {
    options.signal?.removeEventListener('abort', handleAbort);
    try {
      reader.releaseLock();
    } catch {
      // A hostile stream cannot change the generic failure already selected above.
    }
  }
}
