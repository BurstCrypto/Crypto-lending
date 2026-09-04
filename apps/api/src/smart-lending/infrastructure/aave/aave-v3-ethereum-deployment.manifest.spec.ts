import { toFunctionSelector } from 'viem';

import {
  AAVE_V3_ETHEREUM_ADDRESSES_PROVIDER_SELECTOR,
  AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST,
  AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST_FINGERPRINT_SHA256,
  AAVE_V3_ETHEREUM_GET_POOL_DATA_PROVIDER_SELECTOR,
  AAVE_V3_ETHEREUM_GET_POOL_SELECTOR,
  AAVE_V3_ETHEREUM_GET_RESERVE_TOKENS_ADDRESSES_SELECTOR,
  AAVE_V3_ETHEREUM_IMPLEMENTATION_SELECTOR,
  AAVE_V3_ETHEREUM_POOL_SELECTOR,
} from './aave-v3-ethereum-deployment.manifest';
import { AAVE_V3_ETHEREUM_CORE_MARKET } from './aave-v3-market-feed.query';

describe('AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST', () => {
  it('pins the exact official v4.66.3 source revision and Ethereum deployment', () => {
    expect(AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST).toMatchObject({
      schemaVersion: 1,
      use: 'DEPLOYMENT_CORROBORATION_ONLY',
      isAuthoritative: false,
      approvalStatus: 'NOT_APPROVED',
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      networkId: 'eip155:1',
      chainId: '0x1',
      blockSelector: 'finalized',
      blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
      source: {
        kind: 'OFFICIAL_AAVE_ADDRESS_BOOK_RELEASE',
        authorityApprovedForProduction: false,
        approvalStatus: 'NOT_APPROVED',
        package: '@aave-dao/aave-address-book',
        version: '4.66.3',
        releaseTag: 'v4.66.3',
        repository: 'https://github.com/aave-dao/aave-address-book',
        commit: '12963110f29699d214531b9ab4c7cfcec460c298',
        module: 'AaveV3Ethereum',
        releaseModuleUrl:
          'https://assets.aave.com/address-book/releases/v4.66.3/modules/AaveV3Ethereum.json',
        releaseModuleLengthBytes: 49_217,
        releaseModuleSha256: '371c9a43983d32fad37559d83724695f8458f2888552041ba8a05001b666522d',
      },
      contracts: {
        poolAddressesProvider: '0x2f39d218133afab8f2b819b1066c7e434ad94e9e',
        poolProxy: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
        poolImplementation: '0x728a138a4823392c2efa55e028d434f526fe03cf',
        protocolDataProvider: '0x0a16f2fcc0d44fae41cc54e079281d84a363becd',
      },
      assets: {
        USDC: {
          symbol: 'USDC',
          underlyingAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          aToken: '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c',
          variableDebtToken: '0x72e95b8931767c79ba4eee721354d6e99a61d004',
          decimals: 6,
        },
        USDT: {
          symbol: 'USDT',
          underlyingAsset: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          aToken: '0x23878914efe38d27c4d67ab83ed1b93a74d4086a',
          variableDebtToken: '0x6df1c1e379bc5a00a7b4c6e67a203333772f45a8',
          decimals: 6,
        },
      },
    });
  });

  it('pins independently reproducible ABI selectors', () => {
    expect(AAVE_V3_ETHEREUM_IMPLEMENTATION_SELECTOR).toBe(toFunctionSelector('implementation()'));
    expect(AAVE_V3_ETHEREUM_GET_POOL_SELECTOR).toBe(toFunctionSelector('getPool()'));
    expect(AAVE_V3_ETHEREUM_GET_POOL_DATA_PROVIDER_SELECTOR).toBe(
      toFunctionSelector('getPoolDataProvider()'),
    );
    expect(AAVE_V3_ETHEREUM_ADDRESSES_PROVIDER_SELECTOR).toBe(
      toFunctionSelector('ADDRESSES_PROVIDER()'),
    );
    expect(AAVE_V3_ETHEREUM_POOL_SELECTOR).toBe(toFunctionSelector('POOL()'));
    expect(AAVE_V3_ETHEREUM_GET_RESERVE_TOKENS_ADDRESSES_SELECTOR).toBe(
      toFunctionSelector('getReserveTokensAddresses(address)'),
    );
  });

  it('has a fixed content fingerprint and stays aligned with the market query', () => {
    expect(AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST_FINGERPRINT_SHA256).toBe(
      '5a322f54a2209b0bb79ccd7cb415fd501c10c5ce9be8e6caa15e9d7badf548a7',
    );
    expect(AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.manifestFingerprintSha256).toBe(
      AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST_FINGERPRINT_SHA256,
    );
    expect(AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.contracts.poolProxy).toBe(
      AAVE_V3_ETHEREUM_CORE_MARKET,
    );
  });

  it('is deeply frozen and contains only canonical nonzero addresses', () => {
    const manifest = AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST;
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.source)).toBe(true);
    expect(Object.isFrozen(manifest.contracts)).toBe(true);
    expect(Object.isFrozen(manifest.assets)).toBe(true);
    expect(Object.isFrozen(manifest.assets.USDC)).toBe(true);
    expect(Object.isFrozen(manifest.assets.USDT)).toBe(true);
    expect(Object.isFrozen(manifest.selectors)).toBe(true);

    const addresses = [
      ...Object.values(manifest.contracts),
      manifest.assets.USDC.underlyingAsset,
      manifest.assets.USDC.aToken,
      manifest.assets.USDC.variableDebtToken,
      manifest.assets.USDT.underlyingAsset,
      manifest.assets.USDT.aToken,
      manifest.assets.USDT.variableDebtToken,
    ];
    expect(addresses).toHaveLength(10);
    expect(new Set(addresses).size).toBe(10);
    expect(addresses.every((address) => /^0x[0-9a-f]{40}$/u.test(address))).toBe(true);
    expect(addresses).not.toContain(`0x${'0'.repeat(40)}`);
  });
});
