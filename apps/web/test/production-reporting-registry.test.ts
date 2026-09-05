// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_REPORTING_ASSET_IDENTITIES,
  PRODUCTION_REPORTING_NETWORK_IDS,
  PRODUCTION_REPORTING_NETWORKS,
  PRODUCTION_REPORTING_STABLECOINS,
} from '../lib/portfolio/production-reporting-registry';

const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

describe('production reporting registry', () => {
  it('pins the exact deeply frozen Ethereum and Solana reporting boundary', () => {
    expect(PRODUCTION_REPORTING_NETWORK_IDS).toEqual([ETHEREUM, SOLANA]);
    expect(PRODUCTION_REPORTING_STABLECOINS).toEqual(['USDC', 'USDT', 'PYUSD']);
    expect(PRODUCTION_REPORTING_NETWORKS).toEqual({
      [ETHEREUM]: { name: 'Ethereum' },
      [SOLANA]: { name: 'Solana' },
    });
    expect(PRODUCTION_REPORTING_ASSET_IDENTITIES).toEqual({
      [ETHEREUM]: {
        USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        PYUSD: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
      },
      [SOLANA]: {
        USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        PYUSD: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
      },
    });

    expect(Object.isFrozen(PRODUCTION_REPORTING_NETWORK_IDS)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_REPORTING_STABLECOINS)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_REPORTING_NETWORKS)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_REPORTING_ASSET_IDENTITIES)).toBe(true);
    for (const networkId of PRODUCTION_REPORTING_NETWORK_IDS) {
      expect(Object.isFrozen(PRODUCTION_REPORTING_NETWORKS[networkId])).toBe(true);
      expect(Object.isFrozen(PRODUCTION_REPORTING_ASSET_IDENTITIES[networkId])).toBe(true);
    }
  });

  it('contains no historical or public-testnet network data', () => {
    const serialized = JSON.stringify({
      networks: PRODUCTION_REPORTING_NETWORKS,
      assets: PRODUCTION_REPORTING_ASSET_IDENTITIES,
    });

    expect(serialized).not.toMatch(
      /(?:eip155:(?:56|8453|42161|11155111|84532|421614)|solana:EtWTRAB|Base|Arbitrum|Sepolia|Devnet)/u,
    );
  });

  it('keeps the production parser source isolated from the historical unified-balance module', () => {
    const reportingSource = readFileSync(
      resolve(__dirname, '../lib/portfolio/reporting-portfolio.ts'),
      'utf8',
    );

    expect(reportingSource).toContain("from './production-reporting-registry'");
    expect(reportingSource).not.toMatch(/from\s+['"]\.\/unified-balance['"]/u);
  });
});
