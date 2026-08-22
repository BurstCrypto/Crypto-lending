import type * as Jose from 'jose';

let cached: Promise<typeof Jose> | undefined;

/**
 * jose 6 is ESM-only. Node 22's native require can load it synchronously. Going
 * through process.getBuiltinModule keeps Jest's CommonJS runtime from trying to
 * parse the ESM dependency itself.
 */
export function loadJoseRuntime(): Promise<typeof Jose> {
  if (cached) return cached;
  const nativeRequire = process.getBuiltinModule('module').createRequire(__filename);
  cached = Promise.resolve(nativeRequire('jose') as typeof Jose);
  return cached;
}
