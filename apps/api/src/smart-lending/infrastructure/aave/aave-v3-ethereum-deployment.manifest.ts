import { createHash } from 'node:crypto';

export const AAVE_V3_ETHEREUM_POOL_ADDRESSES_PROVIDER =
  '0x2f39d218133afab8f2b819b1066c7e434ad94e9e' as const;
export const AAVE_V3_ETHEREUM_POOL = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2' as const;
export const AAVE_V3_ETHEREUM_POOL_IMPLEMENTATION =
  '0x728a138a4823392c2efa55e028d434f526fe03cf' as const;
export const AAVE_V3_ETHEREUM_PROTOCOL_DATA_PROVIDER =
  '0x0a16f2fcc0d44fae41cc54e079281d84a363becd' as const;

export const AAVE_V3_ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const;
export const AAVE_V3_ETHEREUM_USDC_A_TOKEN = '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c' as const;
export const AAVE_V3_ETHEREUM_USDC_VARIABLE_DEBT_TOKEN =
  '0x72e95b8931767c79ba4eee721354d6e99a61d004' as const;
export const AAVE_V3_ETHEREUM_USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7' as const;
export const AAVE_V3_ETHEREUM_USDT_A_TOKEN = '0x23878914efe38d27c4d67ab83ed1b93a74d4086a' as const;
export const AAVE_V3_ETHEREUM_USDT_VARIABLE_DEBT_TOKEN =
  '0x6df1c1e379bc5a00a7b4c6e67a203333772f45a8' as const;

export const AAVE_V3_ETHEREUM_IMPLEMENTATION_SELECTOR = '0x5c60da1b' as const;
export const AAVE_V3_ETHEREUM_GET_POOL_SELECTOR = '0x026b1d5f' as const;
export const AAVE_V3_ETHEREUM_GET_POOL_DATA_PROVIDER_SELECTOR = '0xe860accb' as const;
export const AAVE_V3_ETHEREUM_ADDRESSES_PROVIDER_SELECTOR = '0x0542975c' as const;
export const AAVE_V3_ETHEREUM_POOL_SELECTOR = '0x7535d246' as const;
export const AAVE_V3_ETHEREUM_GET_RESERVE_TOKENS_ADDRESSES_SELECTOR = '0xd2493b6c' as const;

const source = Object.freeze({
  kind: 'OFFICIAL_AAVE_ADDRESS_BOOK_RELEASE' as const,
  authorityApprovedForProduction: false as const,
  approvalStatus: 'NOT_APPROVED' as const,
  package: '@aave-dao/aave-address-book' as const,
  version: '4.66.3' as const,
  releaseTag: 'v4.66.3' as const,
  repository: 'https://github.com/aave-dao/aave-address-book' as const,
  commit: '12963110f29699d214531b9ab4c7cfcec460c298' as const,
  module: 'AaveV3Ethereum' as const,
  releaseModuleUrl:
    'https://assets.aave.com/address-book/releases/v4.66.3/modules/AaveV3Ethereum.json' as const,
  releaseModuleLengthBytes: 49_217 as const,
  releaseModuleSha256: '371c9a43983d32fad37559d83724695f8458f2888552041ba8a05001b666522d' as const,
});

const contracts = Object.freeze({
  poolAddressesProvider: AAVE_V3_ETHEREUM_POOL_ADDRESSES_PROVIDER,
  poolProxy: AAVE_V3_ETHEREUM_POOL,
  poolImplementation: AAVE_V3_ETHEREUM_POOL_IMPLEMENTATION,
  protocolDataProvider: AAVE_V3_ETHEREUM_PROTOCOL_DATA_PROVIDER,
});

const assets = Object.freeze({
  USDC: Object.freeze({
    symbol: 'USDC' as const,
    underlyingAsset: AAVE_V3_ETHEREUM_USDC,
    aToken: AAVE_V3_ETHEREUM_USDC_A_TOKEN,
    variableDebtToken: AAVE_V3_ETHEREUM_USDC_VARIABLE_DEBT_TOKEN,
    decimals: 6 as const,
  }),
  USDT: Object.freeze({
    symbol: 'USDT' as const,
    underlyingAsset: AAVE_V3_ETHEREUM_USDT,
    aToken: AAVE_V3_ETHEREUM_USDT_A_TOKEN,
    variableDebtToken: AAVE_V3_ETHEREUM_USDT_VARIABLE_DEBT_TOKEN,
    decimals: 6 as const,
  }),
});

const selectors = Object.freeze({
  implementation: AAVE_V3_ETHEREUM_IMPLEMENTATION_SELECTOR,
  getPool: AAVE_V3_ETHEREUM_GET_POOL_SELECTOR,
  getPoolDataProvider: AAVE_V3_ETHEREUM_GET_POOL_DATA_PROVIDER_SELECTOR,
  addressesProvider: AAVE_V3_ETHEREUM_ADDRESSES_PROVIDER_SELECTOR,
  pool: AAVE_V3_ETHEREUM_POOL_SELECTOR,
  getReserveTokensAddresses: AAVE_V3_ETHEREUM_GET_RESERVE_TOKENS_ADDRESSES_SELECTOR,
});

const content = Object.freeze({
  schemaVersion: 1 as const,
  use: 'DEPLOYMENT_CORROBORATION_ONLY' as const,
  isAuthoritative: false as const,
  approvalStatus: 'NOT_APPROVED' as const,
  mayEstablishRecommendationEligibility: false as const,
  mayAuthorizeFinancialAction: false as const,
  networkId: 'eip155:1' as const,
  chainId: '0x1' as const,
  blockSelector: 'finalized' as const,
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const,
  source,
  contracts,
  assets,
  selectors,
});

function fingerprintManifest(): string {
  const canonical = JSON.stringify([
    'crypto-lending:aave-v3-ethereum-deployment-manifest:v1',
    content.schemaVersion,
    content.use,
    content.isAuthoritative,
    content.approvalStatus,
    content.mayEstablishRecommendationEligibility,
    content.mayAuthorizeFinancialAction,
    content.networkId,
    content.chainId,
    content.blockSelector,
    content.blockBinding,
    [
      content.source.kind,
      content.source.authorityApprovedForProduction,
      content.source.approvalStatus,
      content.source.package,
      content.source.version,
      content.source.releaseTag,
      content.source.repository,
      content.source.commit,
      content.source.module,
      content.source.releaseModuleUrl,
      content.source.releaseModuleLengthBytes,
      content.source.releaseModuleSha256,
    ],
    [
      content.contracts.poolAddressesProvider,
      content.contracts.poolProxy,
      content.contracts.poolImplementation,
      content.contracts.protocolDataProvider,
    ],
    [
      [
        content.assets.USDC.symbol,
        content.assets.USDC.underlyingAsset,
        content.assets.USDC.aToken,
        content.assets.USDC.variableDebtToken,
        content.assets.USDC.decimals,
      ],
      [
        content.assets.USDT.symbol,
        content.assets.USDT.underlyingAsset,
        content.assets.USDT.aToken,
        content.assets.USDT.variableDebtToken,
        content.assets.USDT.decimals,
      ],
    ],
    [
      content.selectors.implementation,
      content.selectors.getPool,
      content.selectors.getPoolDataProvider,
      content.selectors.addressesProvider,
      content.selectors.pool,
      content.selectors.getReserveTokensAddresses,
    ],
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export const AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST_FINGERPRINT_SHA256 = fingerprintManifest();

/**
 * Immutable point-in-time deployment reference. It is deliberately not an
 * approval, a live-chain observation, or authority to recommend or transact.
 */
export const AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST = Object.freeze({
  ...content,
  manifestFingerprintSha256: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST_FINGERPRINT_SHA256,
});
