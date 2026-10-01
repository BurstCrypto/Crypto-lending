/** Explicit mainnet USDC targets shared by comparison, review and wallet validation.
 * Provider names alone never authorize an arbitrary market supplied by an API.
 */
export const ETHEREUM = 'eip155:1' as const;
export const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
export const LENDING_PROVIDERS = [
  'aave',
  'morpho',
  'compound',
  'spark',
  'euler',
  'gearbox',
  'kamino',
  'save',
  'project-0',
  'jupiter',
] as const;
export type LendingProvider = (typeof LENDING_PROVIDERS)[number];
export const ETH_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const;
export const SOL_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const MARKETS = {
  aave: {
    name: 'Aave V3',
    network: ETHEREUM,
    target: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
    market: 'Ethereum Core USDC',
    source: 'https://app.aave.com/markets/',
  },
  morpho: {
    name: 'Morpho',
    network: ETHEREUM,
    target: '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb',
    market: 'Blue cbBTC / USDC · 86% LLTV',
    source:
      'https://app.morpho.org/ethereum/market/0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64',
  },
  compound: {
    name: 'Compound',
    network: ETHEREUM,
    target: '0xc3d688b66703497daa19211eedff47f25384cdc3',
    market: 'Compound III USDC',
    source: 'https://app.compound.finance/markets/usdc-mainnet',
  },
  spark: {
    name: 'Spark',
    network: ETHEREUM,
    target: '0xc13e21b648a5ee794902342038ff3adab66be987',
    market: 'SparkLend USDC',
    source: 'https://app.spark.fi/markets/',
  },
  euler: {
    name: 'Euler',
    network: ETHEREUM,
    target: '0x797dd80692c3b2dadabce8e30c07fde5307d48a9',
    market: 'K3 Capital Prime USDC',
    source:
      'https://app.euler.finance/vault/0x797DD80692c3b2dAdabCe8e30C07fDE5307D48a9?network=ethereum',
  },
  gearbox: {
    name: 'Gearbox',
    network: ETHEREUM,
    target: '0xda00000035fef4082f78def6a8903bee419fbf8e',
    market: 'Gearbox V3 USDC pool',
    source: 'https://app.gearbox.fi/pools',
  },
  kamino: {
    name: 'Kamino',
    network: SOLANA,
    target: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
    market: 'Main Market USDC',
    source: 'https://app.kamino.finance/lending',
  },
  save: {
    name: 'Save',
    network: SOLANA,
    target: 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw',
    market: 'Main Pool USDC',
    source: 'https://save.finance/dashboard',
  },
  'project-0': {
    name: 'Project 0',
    network: SOLANA,
    target: '2s37akK2eyBbp8DZgCm7RtsaEz8eJP3Nxd4urLHQv7yB',
    market: 'Production USDC bank',
    source: 'https://app.0.xyz/',
  },
  jupiter: {
    name: 'Jupiter',
    network: SOLANA,
    target: '2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ',
    market: 'Lend Earn Main USDC',
    source: 'https://jup.ag/lend/earn',
  },
} as const;

export const MORPHO = {
  id: '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64',
  loanToken: ETH_USDC,
  collateralToken: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
  oracle: '0xa6d6950c9f177f1de7f7757fb33539e3ec60182a',
  irm: '0x870ac11d48b15db9a138cf899d20f13f79ba00bc',
  lltv: 860_000_000_000_000_000n,
} as const;
export const SPARK = {
  dataProvider: '0xfc21d6d146e6086b8359705c8b28512a983db0cb',
  receipt: '0x377c3bd93f2a2984e1e7be6a5c22c525ed4a4815',
} as const;
export const SAVE = {
  program: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
  market: '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY',
  receipt: '993dVFL2uXWYeoXuEBFXR4BijeXdTv4s6BzsCjJZuwqk',
  vault: '8SheGtsopRUDzdiD6v6BR9a6bqZ9QwywYQY99Fp5meNf',
} as const;
export const PROJECT_ZERO = {
  program: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
  group: '4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8',
  accountIndex: 0,
} as const;
export const JUPITER = {
  program: 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9',
  receipt: '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D',
} as const;
export function isLendingProvider(value: unknown): value is LendingProvider {
  return typeof value === 'string' && LENDING_PROVIDERS.includes(value as LendingProvider);
}
