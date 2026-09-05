// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { preProcessFile } from 'typescript';

import {
  MAINNET_SOLANA_WALLET_NETWORK,
  MAINNET_SOLANA_WALLET_NETWORKS,
} from '../lib/wallets/solana/mainnet-network';

const WEB_ROOT = process.cwd();
const PRODUCTION_SOLANA_ENTRY = resolve(
  WEB_ROOT,
  'components',
  'wallets',
  'mainnet-wallet-ownership.tsx',
);
const MAINNET_NETWORK_POLICY = resolve(WEB_ROOT, 'lib', 'wallets', 'mainnet-network-policy.ts');
const MAINNET_SOLANA_NETWORK = resolve(WEB_ROOT, 'lib', 'wallets', 'solana', 'mainnet-network.ts');
const MAINNET_OWNERSHIP_CLIENT = resolve(WEB_ROOT, 'lib', 'wallets', 'solana', 'ownership.ts');
const COMPATIBILITY_CATALOG = resolve(
  WEB_ROOT,
  'lib',
  'wallets',
  'solana',
  'compatibility-network-catalog.ts',
);
const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.js', '.jsx']);

function resolveApplicationImport(specifier: string, importer: string): string | null {
  const base = specifier.startsWith('@/')
    ? resolve(WEB_ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(importer), specifier)
      : null;
  if (base === null) return null;

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => resolve(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function applicationDependencyGraph(entry: string): ReadonlyMap<string, string> {
  const pending = [entry];
  const sources = new Map<string, string>();

  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || sources.has(path)) continue;
    const source = readFileSync(path, 'utf8');
    sources.set(path, source);

    for (const imported of preProcessFile(source, true, true).importedFiles) {
      const dependency = resolveApplicationImport(imported.fileName, path);
      if (dependency !== null && !sources.has(dependency)) pending.push(dependency);
    }
  }

  return sources;
}

describe('production Solana wallet network boundary', () => {
  it('pins one deeply immutable Solana mainnet binding', () => {
    expect(MAINNET_SOLANA_WALLET_NETWORK).toEqual({
      chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      walletStandardChain: 'solana:mainnet',
    });
    expect(MAINNET_SOLANA_WALLET_NETWORKS).toEqual([MAINNET_SOLANA_WALLET_NETWORK]);
    expect(Object.isFrozen(MAINNET_SOLANA_WALLET_NETWORK)).toBe(true);
    expect(Object.isFrozen(MAINNET_SOLANA_WALLET_NETWORKS)).toBe(true);
    expect(Object.isFrozen(MAINNET_SOLANA_WALLET_NETWORKS[0])).toBe(true);
  });

  it('keeps devnet and compatibility maps outside the production dependency graph', () => {
    const graph = applicationDependencyGraph(PRODUCTION_SOLANA_ENTRY);

    expect(graph.has(MAINNET_NETWORK_POLICY)).toBe(true);
    expect(graph.has(MAINNET_SOLANA_NETWORK)).toBe(true);
    expect(graph.has(MAINNET_OWNERSHIP_CLIENT)).toBe(true);
    expect(graph.has(COMPATIBILITY_CATALOG)).toBe(false);

    const productionSource = [...graph.values()].join('\n');
    expect(productionSource).not.toMatch(/KAN61_SOLANA_COMPATIBILITY_NETWORKS/u);
    expect(productionSource).not.toMatch(/SOLANA_(?:CAIP_CHAIN_IDS|WALLET_STANDARD_CHAINS)/u);
    expect(productionSource).not.toContain('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    expect(productionSource).not.toContain('solana:devnet');
    expect(productionSource).not.toContain('solana:testnet');

    const ownershipSource = graph.get(MAINNET_OWNERSHIP_CLIENT);
    expect(ownershipSource).toBeDefined();
    expect(ownershipSource).not.toMatch(/['"]TESTNET['"]/u);
    expect(ownershipSource).toContain('selected.chainId !== MAINNET_SOLANA_WALLET_NETWORK.chainId');
  });
});
