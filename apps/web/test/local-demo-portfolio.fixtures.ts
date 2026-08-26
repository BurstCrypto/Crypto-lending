import {
  LOCAL_DEMO_EVM_NETWORK_ID,
  LOCAL_DEMO_EVM_USDC_ASSET_IDENTITY,
  type LocalDemoBalanceApiResponse,
} from '../lib/local-demo/local-demo-portfolio-response';

export const LOCAL_DEMO_CHAIN_PORTFOLIO_PAYLOAD = {
  schemaVersion: 1,
  snapshotId: 'local-demo-portfolio-chain-backed',
  asOf: '2026-08-24T18:30:00.000Z',
  freshness: 'CURRENT',
  portfolioValueUsdMinor: '1100000',
  buyingPower: {
    status: 'AVAILABLE',
    amountUsdMinor: '1100000',
    freshness: 'CURRENT',
    deductions: [],
    reasons: [],
  },
  wallets: [
    {
      walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'Synthetic EVM wallet',
      namespace: 'EVM',
      address: '0x1111111111111111111111111111111111111111',
      portfolioValueUsdMinor: '700000',
      buyingPowerUsdMinor: '700000',
      chains: [
        {
          networkId: LOCAL_DEMO_EVM_NETWORK_ID,
          portfolioValueUsdMinor: '700000',
          buyingPowerUsdMinor: '700000',
          assets: [
            {
              stablecoin: 'USDC',
              assetIdentity: LOCAL_DEMO_EVM_USDC_ASSET_IDENTITY,
              amountAtomic: '7000000000',
              decimals: 6,
              portfolioValueUsdMinor: '700000',
              buyingPowerUsdMinor: '700000',
              buyingPowerAvailability: 'INCLUDED',
              buyingPowerReason: null,
              observedAt: '2026-08-24T18:30:00.000Z',
              freshness: 'CURRENT',
            },
          ],
        },
      ],
    },
    {
      walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      label: 'Synthetic Solana wallet',
      namespace: 'SOLANA',
      address: '7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8',
      portfolioValueUsdMinor: '400000',
      buyingPowerUsdMinor: '400000',
      chains: [
        {
          networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          portfolioValueUsdMinor: '400000',
          buyingPowerUsdMinor: '400000',
          assets: [
            {
              stablecoin: 'USDC',
              assetIdentity: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              amountAtomic: '4000000000',
              decimals: 6,
              portfolioValueUsdMinor: '400000',
              buyingPowerUsdMinor: '400000',
              buyingPowerAvailability: 'INCLUDED',
              buyingPowerReason: null,
              observedAt: '2026-08-24T18:30:00.000Z',
              freshness: 'CURRENT',
            },
          ],
        },
      ],
    },
  ],
  use: 'LOCAL_DEMO_ESTIMATE_ONLY',
  mayAuthorizeFinancialAction: false,
} as const satisfies LocalDemoBalanceApiResponse;
