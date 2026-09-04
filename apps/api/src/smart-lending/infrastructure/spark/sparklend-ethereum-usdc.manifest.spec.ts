import { createHash } from 'node:crypto';

import {
  parseSparkLendEthereumUSDCManifest,
  SparkLendManifestInvalidError,
  sparkLendManifestFingerprintSha256,
} from './sparklend-ethereum-usdc.manifest';

const contracts = {
  provider: '0x02c3ea4e34c0cbd694d2adfa2c690eecbc1793ee',
  pool: '0xc13e21b648a5ee794902342038ff3adab66be987',
  configurator: '0x542dba469bde58faee189ffb60c6b49ce60e0738',
  implementation: '0x5ae329203e00f76891094dcfedd5aca082a50e1b',
  dataProvider: '0xfc21d6d146e6086b8359705c8b28512a983db0cb',
  usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  spToken: '0x377c3bd93f2a2984e1e7be6a5c22c525ed4a4815',
  spTokenImplementation: '0x6175ddec3b9b38c88157c10a01ed4a3fa8639cc6',
} as const;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const manifest = {
  schemaVersion: 1,
  providerId: 'spark',
  protocolId: 'sparklend',
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  maximumBlockAgeSeconds: '3600',
  assetRegistry: {
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  },
  marketId: 'sparklend-ethereum-usdc',
  contracts,
  asset: { symbol: 'USDC', decimals: 6 },
  runtimeCodeSha256: Object.fromEntries(Object.keys(contracts).map((key) => [key, hash(key)])),
  source: {
    repository: 'sparkdotfi/spark-address-registry',
    commit: 'ecea29bd2a1546bbbf4999e486b3c04f0e10b748',
    contractsPath: 'src/SparkLend.sol',
    assetPath: 'src/Ethereum.sol',
  },
} as const;

describe('SparkLend Ethereum USDC manifest', () => {
  it('parses and deterministically fingerprints the exact pinned market', () => {
    expect(parseSparkLendEthereumUSDCManifest(manifest)).toEqual(manifest);
    expect(sparkLendManifestFingerprintSha256(manifest)).toBe(
      sparkLendManifestFingerprintSha256({ ...manifest }),
    );
  });
  it.each([
    ['chain', { expectedChainId: '0x2' }],
    ['market', { marketId: 'other' }],
    ['contracts', { contracts: { ...contracts, pool: contracts.provider } }],
    ['commit', { source: { ...manifest.source, commit: '0'.repeat(40) } }],
  ])('rejects changed %s identity', (_name, change) => {
    expect(() => parseSparkLendEthereumUSDCManifest({ ...manifest, ...change })).toThrow(
      SparkLendManifestInvalidError,
    );
  });
  it.each(['0', '03600', '3601', 3600])(
    'rejects invalid freshness bound %p',
    (maximumBlockAgeSeconds) => {
      expect(() =>
        parseSparkLendEthereumUSDCManifest({ ...manifest, maximumBlockAgeSeconds }),
      ).toThrow(SparkLendManifestInvalidError);
    },
  );
  it('rejects a changed asset-registry binding', () => {
    expect(() =>
      parseSparkLendEthereumUSDCManifest({
        ...manifest,
        assetRegistry: { ...manifest.assetRegistry, fingerprintSha256: '0'.repeat(64) },
      }),
    ).toThrow(SparkLendManifestInvalidError);
  });
  it('rejects all-zero runtime-code hash placeholders', () => {
    expect(() =>
      parseSparkLendEthereumUSDCManifest({
        ...manifest,
        runtimeCodeSha256: { ...manifest.runtimeCodeSha256, pool: '0'.repeat(64) },
      }),
    ).toThrow(SparkLendManifestInvalidError);
  });
  it('rejects unexpected properties and accessors without invoking them', () => {
    expect(() => parseSparkLendEthereumUSDCManifest({ ...manifest, extra: true })).toThrow(
      SparkLendManifestInvalidError,
    );
    let invoked = false;
    const candidate = { ...manifest } as Record<string, unknown>;
    Object.defineProperty(candidate, 'marketId', {
      enumerable: true,
      get: () => {
        invoked = true;
        return manifest.marketId;
      },
    });
    expect(() => parseSparkLendEthereumUSDCManifest(candidate)).toThrow(
      SparkLendManifestInvalidError,
    );
    expect(invoked).toBe(false);
  });
});
