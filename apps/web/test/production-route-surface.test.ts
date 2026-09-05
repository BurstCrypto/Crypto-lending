// @vitest-environment node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB_ROOT = process.cwd();
const APP_ROOT = resolve(WEB_ROOT, 'app');
const COMPONENTS_ROOT = resolve(WEB_ROOT, 'components');
const LIBRARY_ROOT = resolve(WEB_ROOT, 'lib');
const PROXY_PATH = resolve(WEB_ROOT, 'proxy.ts');
const RETIRED_ROUTE_ROOT = resolve(APP_ROOT, 'internal', 'wallet-lab');
const RETIRED_LIBRARY_ROOT = resolve(LIBRARY_ROOT, 'wallets', 'lab');

function sourceFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}

function isWithin(directory: string, path: string): boolean {
  const candidate = relative(directory, path);
  return (
    candidate !== '' &&
    candidate !== '..' &&
    !candidate.startsWith(`..${sep}`) &&
    !isAbsolute(candidate)
  );
}

describe('production route surface', () => {
  it('does not ship a wallet-lab page, route handler, or client entry', () => {
    expect(sourceFiles(RETIRED_ROUTE_ROOT)).toEqual([]);
  });

  it('keeps production entries detached from wallet-lab implementation modules', () => {
    const productionSources = [APP_ROOT, COMPONENTS_ROOT, LIBRARY_ROOT]
      .flatMap(sourceFiles)
      .filter((path) => !isWithin(RETIRED_LIBRARY_ROOT, path));

    for (const path of productionSources) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/wallet-lab-client/u);
      expect(source, path).not.toMatch(/wallets\/lab(?:\/|["'])/u);
    }
  });

  it('keeps the proxy detached from the retired route and its access policy', () => {
    const source = readFileSync(PROXY_PATH, 'utf8');

    expect(source).not.toContain('/internal/wallet-lab');
    expect(source).not.toContain('WalletLab');
    expect(source).not.toContain('@/lib/wallets/lab');
    expect(source).not.toContain('RestrictedWalletLab');
  });
});
