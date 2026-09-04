import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const AUTHENTICATION_SOURCE_ROOTS = [
  'app/login',
  'app/register',
  'app/account',
  'components/authentication',
  'lib/authentication',
] as const;

function authenticationSources(): readonly { readonly path: string; readonly source: string }[] {
  function readDirectory(directory: string): readonly {
    readonly path: string;
    readonly source: string;
  }[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return readDirectory(path);
      return entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)
        ? [{ path, source: readFileSync(path, 'utf8') }]
        : [];
    });
  }

  return AUTHENTICATION_SOURCE_ROOTS.flatMap((root) => readDirectory(resolve(process.cwd(), root)));
}

describe('authentication browser-storage policy', () => {
  it('keeps bearer credentials and authentication state out of browser persistence', () => {
    for (const { path, source } of authenticationSources()) {
      expect(source, path).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/u);
      expect(source, path).not.toMatch(/\bBearer\b/u);
      expect(source, path).not.toMatch(/document\.cookie\s*=/u);
      expect(source, path).not.toMatch(/["']Authorization["']\s*:/u);
    }
  });

  it('keeps retired wallet implementations out of production authentication entry points', () => {
    for (const { path, source } of authenticationSources()) {
      expect(source, path).not.toMatch(
        /from\s+["']@\/lib\/(?:evm-public-testnet|local-demo|public-testnet)(?:\/|["'])/u,
      );
    }
  });
});
