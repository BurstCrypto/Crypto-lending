import { createHash } from 'node:crypto';

import {
  GearboxV3ManifestInvalidError,
  gearboxV3ManifestFingerprintSha256,
  parseGearboxV3EthereumUSDCManifest,
} from './gearbox-v3-ethereum-usdc.manifest';

const contracts = {
  addressProvider: '0x9ea7b04da02a5373317d745c1571c84aad03321d',
  contractsRegister: '0xa50d4e7d8946a7c90652339cdbd262c375d54d99',
  pool: '0xda00000035fef4082f78def6a8903bee419fbf8e',
  underlying: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
} as const;
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const manifest = {
  schemaVersion: 1,
  providerId: 'gearbox',
  protocolId: 'gearbox-v3',
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
  maximumBlockAgeSeconds: '3600',
  marketId: 'gearbox-v3-ethereum-usdc',
  deploymentModel: 'DIRECT_IMMUTABLE_POOL_V3_00',
  contracts,
  asset: { symbol: 'USDC', decimals: 6 },
  assetRegistry: {
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  },
  runtimeCodeSha256: Object.fromEntries(Object.keys(contracts).map((key) => [key, sha(key)])),
  officialSource: {
    securityRepository: 'Gearbox-protocol/security',
    securityCommit: '684522eae18dea73a8aecda25d8743bfa724446a',
    deploymentPath: 'bug-bounty/v3-scope.md',
    coreRepository: 'Gearbox-protocol/core-v3',
    coreCommit: 'e16559ae82f0f24c3dc29693c444f40d676ebff9',
    poolPath: 'contracts/pool/PoolV3.sol',
    interfacePath: 'contracts/interfaces/IPoolV3.sol',
  },
} as const;

describe('Gearbox V3 Ethereum USDC manifest', () => {
  it('canonicalizes and fingerprints the one exact direct-deployment market', () => {
    expect(parseGearboxV3EthereumUSDCManifest(manifest)).toEqual(manifest);
    expect(gearboxV3ManifestFingerprintSha256(manifest)).toMatch(/^[0-9a-f]{64}$/u);
    expect(gearboxV3ManifestFingerprintSha256(manifest)).toBe(
      gearboxV3ManifestFingerprintSha256({ ...manifest }),
    );
  });

  it.each([
    ['chain', { expectedChainId: '0x5' }],
    ['pool', { contracts: { ...contracts, pool: contracts.addressProvider } }],
    ['asset', { contracts: { ...contracts, underlying: contracts.pool } }],
    ['deployment', { deploymentModel: 'PROXY' }],
    ['source', { officialSource: { ...manifest.officialSource, coreCommit: '0'.repeat(40) } }],
    [
      'registry',
      { assetRegistry: { ...manifest.assetRegistry, fingerprintSha256: '0'.repeat(64) } },
    ],
    ['digest', { runtimeCodeSha256: { ...manifest.runtimeCodeSha256, pool: 'A'.repeat(64) } }],
    ['zero digest', { runtimeCodeSha256: { ...manifest.runtimeCodeSha256, pool: '0'.repeat(64) } }],
  ])('rejects a changed %s binding', (_name, change) => {
    expect(() => parseGearboxV3EthereumUSDCManifest({ ...manifest, ...change })).toThrow(
      GearboxV3ManifestInvalidError,
    );
  });

  it.each(['0', '03600', '3601', 3600])(
    'rejects invalid freshness %p',
    (maximumBlockAgeSeconds) => {
      expect(() =>
        parseGearboxV3EthereumUSDCManifest({ ...manifest, maximumBlockAgeSeconds }),
      ).toThrow(GearboxV3ManifestInvalidError);
    },
  );

  it('rejects extra fields and accessors without invocation', () => {
    expect(() => parseGearboxV3EthereumUSDCManifest({ ...manifest, extra: true })).toThrow(
      GearboxV3ManifestInvalidError,
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
    expect(() => parseGearboxV3EthereumUSDCManifest(candidate)).toThrow(
      GearboxV3ManifestInvalidError,
    );
    expect(invoked).toBe(false);
  });
});
