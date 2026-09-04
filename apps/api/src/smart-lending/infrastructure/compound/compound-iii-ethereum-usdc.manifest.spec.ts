import { createHash } from 'node:crypto';

import {
  CompoundIIIUSDCManifestValidationError,
  compoundIIIUSDCManifestFingerprintSha256,
  parseCompoundIIIUSDCFinalizedManifest,
} from './compound-iii-ethereum-usdc.manifest';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const valid = {
  schemaVersion: 1,
  providerId: 'compound',
  protocolId: 'compound-iii',
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
  maximumBlockAgeSeconds: '3600',
  assetRegistry: {
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  },
  marketId: 'compound-iii-ethereum-usdc',
  cometProxy: '0xc3d688b66703497daa19211eedff47f25384cdc3',
  proxyAdmin: '0x1111111111111111111111111111111111111111',
  implementation: '0x2222222222222222222222222222222222222222',
  baseAsset: {
    symbol: 'USDC',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    scale: '1000000',
  },
  runtimeCodeSha256: {
    cometProxy: sha('proxy'),
    implementation: sha('implementation'),
    baseAsset: sha('asset'),
  },
  officialSource: {
    repository: 'compound-finance/comet',
    commit: 'f766f51583c23acc33b2a7824654ef2029a96804',
    deploymentPath: 'deployments/mainnet/usdc',
  },
} as const;

describe('Compound III USDC manifest', () => {
  it('canonicalizes and deterministically fingerprints the exact official market scope', () => {
    const parsed = parseCompoundIIIUSDCFinalizedManifest(valid);
    expect(parsed).toEqual(valid);
    expect(compoundIIIUSDCManifestFingerprintSha256(valid)).toMatch(/^[0-9a-f]{64}$/u);
    expect(compoundIIIUSDCManifestFingerprintSha256(valid)).toBe(
      compoundIIIUSDCManifestFingerprintSha256({ ...valid }),
    );
  });

  it.each([
    ['chain', { expectedChainId: '0x5' }],
    ['proxy', { cometProxy: '0x3333333333333333333333333333333333333333' }],
    ['market', { marketId: 'another-market' }],
    ['implementation', { implementation: valid.proxyAdmin }],
    [
      'code digest',
      { runtimeCodeSha256: { ...valid.runtimeCodeSha256, implementation: 'A'.repeat(64) } },
    ],
  ])('rejects a changed %s binding', (_name, change) => {
    expect(() => parseCompoundIIIUSDCFinalizedManifest({ ...valid, ...change })).toThrow(
      CompoundIIIUSDCManifestValidationError,
    );
  });

  it.each(['0', '03600', '3601', 3600])(
    'rejects invalid freshness bound %p',
    (maximumBlockAgeSeconds) => {
      expect(() =>
        parseCompoundIIIUSDCFinalizedManifest({ ...valid, maximumBlockAgeSeconds }),
      ).toThrow(CompoundIIIUSDCManifestValidationError);
    },
  );

  it('rejects a changed asset-registry binding', () => {
    expect(() =>
      parseCompoundIIIUSDCFinalizedManifest({
        ...valid,
        assetRegistry: { ...valid.assetRegistry, fingerprintSha256: '0'.repeat(64) },
      }),
    ).toThrow(CompoundIIIUSDCManifestValidationError);
  });

  it('rejects all-zero runtime-code hash placeholders', () => {
    expect(() =>
      parseCompoundIIIUSDCFinalizedManifest({
        ...valid,
        runtimeCodeSha256: { ...valid.runtimeCodeSha256, cometProxy: '0'.repeat(64) },
      }),
    ).toThrow(CompoundIIIUSDCManifestValidationError);
  });

  it('rejects unexpected keys and accessors without invoking them', () => {
    expect(() => parseCompoundIIIUSDCFinalizedManifest({ ...valid, extra: true })).toThrow(
      CompoundIIIUSDCManifestValidationError,
    );
    let invoked = false;
    const candidate = { ...valid } as Record<string, unknown>;
    Object.defineProperty(candidate, 'proxyAdmin', {
      enumerable: true,
      get: () => {
        invoked = true;
        return valid.proxyAdmin;
      },
    });
    expect(() => parseCompoundIIIUSDCFinalizedManifest(candidate)).toThrow(
      CompoundIIIUSDCManifestValidationError,
    );
    expect(invoked).toBe(false);
  });
});
