/** Minimal provider surface used by the injected EVM connector. */
export interface Eip1193RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | Record<string, unknown>;
}

export type Eip1193Listener = (...arguments_: unknown[]) => void;

/**
 * This object is an untrusted extension capability. It must remain inside the
 * connector infrastructure and must never be retained in application state.
 */
export interface Eip1193Provider {
  request(arguments_: Eip1193RequestArguments): Promise<unknown>;
  on(event: string, listener: Eip1193Listener): unknown;
  removeListener(event: string, listener: Eip1193Listener): unknown;
}

export function isEip1193Provider(value: unknown): value is Eip1193Provider {
  if (typeof value !== 'object' || value === null) return false;

  try {
    const candidate = value as Partial<Eip1193Provider>;
    return (
      typeof candidate.request === 'function' &&
      typeof candidate.on === 'function' &&
      typeof candidate.removeListener === 'function'
    );
  } catch {
    return false;
  }
}
