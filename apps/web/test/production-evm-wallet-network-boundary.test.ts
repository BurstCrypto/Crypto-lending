// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { preProcessFile } from 'typescript';

import { MAINNET_EVM_WALLET_NETWORKS } from '../lib/wallets/mainnet-network-policy';

const WEB_ROOT = process.cwd();
const PRODUCTION_EVM_ENTRY = resolve(
  WEB_ROOT,
  'components',
  'wallets',
  'mainnet-wallet-ownership.tsx',
);
const MAINNET_NETWORK_POLICY = resolve(WEB_ROOT, 'lib', 'wallets', 'mainnet-network-policy.ts');
const MAINNET_OWNERSHIP_CLIENT = resolve(WEB_ROOT, 'lib', 'wallets', 'eip1193', 'ownership.ts');
const COMPATIBILITY_CATALOG = resolve(WEB_ROOT, 'test', 'eip1193-network-catalog.fixture.ts');
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

describe('production EVM wallet network boundary', () => {
  it('pins one deeply immutable Ethereum mainnet definition', () => {
    expect(MAINNET_EVM_WALLET_NETWORKS).toEqual([
      {
        chainId: 'eip155:1',
        providerChainId: '0x1',
        displayName: 'Ethereum Mainnet',
        environment: 'MAINNET',
      },
    ]);
    expect(Object.isFrozen(MAINNET_EVM_WALLET_NETWORKS)).toBe(true);
    expect(Object.isFrozen(MAINNET_EVM_WALLET_NETWORKS[0])).toBe(true);
  });

  it('keeps historical, removed-chain, and testnet catalogs outside the production graph', () => {
    const graph = applicationDependencyGraph(PRODUCTION_EVM_ENTRY);

    expect(graph.has(MAINNET_NETWORK_POLICY)).toBe(true);
    expect(graph.has(MAINNET_OWNERSHIP_CLIENT)).toBe(true);
    expect(graph.has(COMPATIBILITY_CATALOG)).toBe(false);

    const productionSource = [...graph.values()].join('\n');
    expect(productionSource).not.toMatch(/KAN61_EVM_(?:NETWORK|TESTNET)_CATALOG/u);
    expect(productionSource).not.toMatch(
      /(?:Base Mainnet|Arbitrum One|Ethereum Sepolia|Base Sepolia|Arbitrum Sepolia)/u,
    );
    expect(productionSource).not.toMatch(/['"]eip155:(?:8453|42161|11155111|84532|421614)['"]/u);

    const ownershipSource = graph.get(MAINNET_OWNERSHIP_CLIENT);
    expect(ownershipSource).toBeDefined();
    expect(ownershipSource).not.toMatch(/['"]TESTNET['"]/u);
    expect(ownershipSource).toContain("const MAINNET_EVM_CHAIN_ID: MainnetEvmChainId = 'eip155:1'");
    expect(ownershipSource).toContain('selected.chainId !== MAINNET_EVM_CHAIN_ID');
  });
});
