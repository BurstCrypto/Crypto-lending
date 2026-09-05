export const PRODUCTION_REPORTING_NETWORK_IDS = Object.freeze([
  'eip155:1',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
] as const);

export type ProductionReportingNetworkId = (typeof PRODUCTION_REPORTING_NETWORK_IDS)[number];

export const PRODUCTION_REPORTING_STABLECOINS = Object.freeze([
  'USDC',
  'USDT',
  'PYUSD',
] as const);

export type ProductionReportingStablecoin =
  (typeof PRODUCTION_REPORTING_STABLECOINS)[number];

export const PRODUCTION_REPORTING_NETWORKS = Object.freeze({
  'eip155:1': Object.freeze({ name: 'Ethereum' }),
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': Object.freeze({ name: 'Solana' }),
} as const satisfies Readonly<Record<ProductionReportingNetworkId, Readonly<{ name: string }>>>);

/** Exact identities accepted by the production reporting response boundary. */
export const PRODUCTION_REPORTING_ASSET_IDENTITIES = Object.freeze({
  'eip155:1': Object.freeze({
    USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    PYUSD: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
  }),
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': Object.freeze({
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    PYUSD: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  }),
} as const satisfies Readonly<
  Record<ProductionReportingNetworkId, Readonly<Record<ProductionReportingStablecoin, string>>>
>);
