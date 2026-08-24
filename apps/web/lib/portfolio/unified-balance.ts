const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const USD_MINOR = /^(?:0|[1-9][0-9]{0,17})$/u;
const ATOMIC_AMOUNT = /^(?:0|[1-9][0-9]{0,77})$/u;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const MAX_WALLETS = 32;
const MAX_CHAINS_PER_WALLET = 16;
const MAX_ASSETS_PER_CHAIN = 32;
const MAX_DEDUCTIONS = 16;
const MAX_REASONS = 16;

export const PORTFOLIO_NETWORKS = Object.freeze({
  'eip155:1': Object.freeze({ name: 'Ethereum', namespace: 'EVM' }),
  'eip155:8453': Object.freeze({ name: 'Base', namespace: 'EVM' }),
  'eip155:42161': Object.freeze({ name: 'Arbitrum', namespace: 'EVM' }),
  'eip155:11155111': Object.freeze({ name: 'Ethereum Sepolia', namespace: 'EVM' }),
  'eip155:84532': Object.freeze({ name: 'Base Sepolia', namespace: 'EVM' }),
  'eip155:421614': Object.freeze({ name: 'Arbitrum Sepolia', namespace: 'EVM' }),
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': Object.freeze({
    name: 'Solana',
    namespace: 'SOLANA',
  }),
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': Object.freeze({
    name: 'Solana Devnet',
    namespace: 'SOLANA',
  }),
} as const);

export const BUYING_POWER_DEDUCTION_CODES = Object.freeze([
  'STALE_OR_UNPRICED_BALANCE',
  'LIQUIDITY',
  'CONVERSION',
  'SLIPPAGE',
  'NETWORK',
  'ROUTING',
] as const);

export const BUYING_POWER_REASON_CODES = Object.freeze([
  'STALE_BALANCE_EXCLUDED',
  'UNSUPPORTED_ASSET_EXCLUDED',
  'PRICE_UNAVAILABLE',
  'ROUTE_COST_UNAVAILABLE',
  'LIQUIDITY_UNAVAILABLE',
  'BUYING_POWER_INPUT_STALE',
] as const);

export type PortfolioNetworkId = keyof typeof PORTFOLIO_NETWORKS;
export type WalletNamespace = (typeof PORTFOLIO_NETWORKS)[PortfolioNetworkId]['namespace'];
export type PortfolioFreshness = 'CURRENT' | 'STALE';
export type StablecoinSymbol = 'USDC' | 'USDT' | 'PYUSD';
export type BuyingPowerStatus = 'AVAILABLE' | 'UNAVAILABLE';
export type BuyingPowerDeductionCode = (typeof BUYING_POWER_DEDUCTION_CODES)[number];
export type BuyingPowerReasonCode = (typeof BUYING_POWER_REASON_CODES)[number];
export type AssetBuyingPowerAvailability = 'INCLUDED' | 'EXCLUDED' | 'UNAVAILABLE';

/**
 * Browser-side projection of the KAN-61 registry identities accepted by the
 * KAN-67 portfolio contract. A syntactically valid address must never acquire
 * a trusted stablecoin label merely because a response says that it does.
 */
export const PORTFOLIO_ASSET_IDENTITIES = Object.freeze({
  'eip155:1': Object.freeze({
    USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    PYUSD: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
  }),
  'eip155:8453': Object.freeze({
    USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  }),
  'eip155:42161': Object.freeze({
    USDC: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    PYUSD: '0x46850ad61c2b7d64d08c9c754f45254596696984',
  }),
  'eip155:11155111': Object.freeze({
    USDC: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
    PYUSD: '0xcac524bca292aaade2df8a05cc58f0a65b1b3bb9',
  }),
  'eip155:84532': Object.freeze({
    USDC: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  }),
  'eip155:421614': Object.freeze({
    USDC: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d',
    PYUSD: '0x637a1259c6afd7e3adf63993ca7e58bb438ab1b1',
  }),
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': Object.freeze({
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    PYUSD: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  }),
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': Object.freeze({
    USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    PYUSD: 'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM',
  }),
} as const satisfies Readonly<
  Record<PortfolioNetworkId, Partial<Record<StablecoinSymbol, string>>>
>);

export interface UnifiedBalanceAssetContribution {
  readonly stablecoin: StablecoinSymbol;
  readonly assetIdentity: string;
  readonly amountAtomic: string;
  readonly decimals: 6;
  readonly portfolioValueUsdMinor: string;
  readonly buyingPowerUsdMinor: string | null;
  readonly buyingPowerAvailability: AssetBuyingPowerAvailability;
  readonly buyingPowerReason: BuyingPowerReasonCode | null;
  readonly observedAt: string;
  readonly freshness: PortfolioFreshness;
}

export interface UnifiedBalanceChainContribution {
  readonly networkId: PortfolioNetworkId;
  readonly portfolioValueUsdMinor: string;
  readonly buyingPowerUsdMinor: string | null;
  readonly assets: readonly UnifiedBalanceAssetContribution[];
}

export interface UnifiedBalanceWalletContribution {
  readonly walletId: string;
  readonly label: string;
  readonly namespace: WalletNamespace;
  readonly address: string;
  readonly portfolioValueUsdMinor: string;
  readonly buyingPowerUsdMinor: string | null;
  readonly chains: readonly UnifiedBalanceChainContribution[];
}

export interface BuyingPowerDeduction {
  readonly code: BuyingPowerDeductionCode;
  readonly amountUsdMinor: string | null;
}

export interface UnifiedBuyingPower {
  readonly status: BuyingPowerStatus;
  readonly amountUsdMinor: string | null;
  readonly freshness: PortfolioFreshness;
  readonly deductions: readonly BuyingPowerDeduction[];
  readonly reasons: readonly BuyingPowerReasonCode[];
}

export interface UnifiedBalanceApiResponse {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly asOf: string;
  readonly freshness: PortfolioFreshness;
  readonly portfolioValueUsdMinor: string;
  readonly buyingPower: UnifiedBuyingPower;
  readonly wallets: readonly UnifiedBalanceWalletContribution[];
}

export class UnifiedBalanceResponseError extends Error {
  constructor() {
    super('Unified balance data is unavailable.');
    this.name = 'UnifiedBalanceResponseError';
  }
}

function fail(): never {
  throw new UnifiedBalanceResponseError();
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (
      descriptorKeys.length !== expectedKeys.length ||
      descriptorKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key)) ||
      expectedKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      return fail();
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        'value' in descriptor ? descriptor.value : undefined,
      ]),
    );
  } catch (error: unknown) {
    if (error instanceof UnifiedBalanceResponseError) throw error;
    return fail();
  }
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_TIMESTAMP.test(value)) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return fail();
  return value;
}

function canonicalUsdMinor(value: unknown): string {
  if (typeof value !== 'string' || !USD_MINOR.test(value)) return fail();
  return value;
}

function nullableUsdMinor(value: unknown): string | null {
  return value === null ? null : canonicalUsdMinor(value);
}

function boundedArray(value: unknown, maximum: number, minimum = 0): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return fail();
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expectedKeys = [
      ...new Array<string>(value.length).fill('').map((_, index) => String(index)),
      'length',
    ];
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !expectedKeys.includes(key),
      ) ||
      expectedKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
      expectedKeys.some((key) => !('value' in descriptors[key]!))
    ) {
      return fail();
    }
    return expectedKeys
      .slice(0, -1)
      .map((key) => ('value' in descriptors[key]! ? descriptors[key]!.value : undefined));
  } catch (error: unknown) {
    if (error instanceof UnifiedBalanceResponseError) throw error;
    return fail();
  }
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
): Values[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) return fail();
  return value as Values[number];
}

function walletLabel(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 48 ||
    value.trim() !== value ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
  ) {
    return fail();
  }
  return value;
}

function decodeBase58(value: string): Uint8Array | null {
  if (!SOLANA_ADDRESS.test(value)) return null;
  let numericValue = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) return null;
    numericValue = numericValue * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (numericValue > 0n) {
    bytes.push(Number(numericValue % 256n));
    numericValue /= 256n;
  }
  let leadingZeroBytes = 0;
  while (value[leadingZeroBytes] === '1') leadingZeroBytes += 1;
  return Uint8Array.from([...new Array<number>(leadingZeroBytes).fill(0), ...bytes.reverse()]);
}

function canonicalAddress(value: unknown, namespace: WalletNamespace): string {
  if (typeof value !== 'string') return fail();
  if (namespace === 'EVM') {
    if (!EVM_ADDRESS.test(value)) return fail();
    return value;
  }
  const decoded = decodeBase58(value);
  if (decoded?.byteLength !== 32 || decoded.every((byte) => byte === 0)) return fail();
  return value;
}

function canonicalAssetIdentity(
  value: unknown,
  networkId: PortfolioNetworkId,
  stablecoin: StablecoinSymbol,
): string {
  const namespace = PORTFOLIO_NETWORKS[networkId].namespace;
  const identity = canonicalAddress(value, namespace);
  const registeredIdentities: Partial<Record<StablecoinSymbol, string>> =
    PORTFOLIO_ASSET_IDENTITIES[networkId];
  if (registeredIdentities[stablecoin] !== identity) return fail();
  return identity;
}

function parseAsset(
  value: unknown,
  networkId: PortfolioNetworkId,
  buyingPowerStatus: BuyingPowerStatus,
  asOf: string,
): UnifiedBalanceAssetContribution {
  const record = exactDataRecord(value, [
    'stablecoin',
    'assetIdentity',
    'amountAtomic',
    'decimals',
    'portfolioValueUsdMinor',
    'buyingPowerUsdMinor',
    'buyingPowerAvailability',
    'buyingPowerReason',
    'observedAt',
    'freshness',
  ]);
  const stablecoin = oneOf(record.stablecoin, ['USDC', 'USDT', 'PYUSD'] as const);
  const assetIdentity = canonicalAssetIdentity(record.assetIdentity, networkId, stablecoin);
  if (typeof record.amountAtomic !== 'string' || !ATOMIC_AMOUNT.test(record.amountAtomic)) {
    return fail();
  }
  if (record.decimals !== 6) return fail();
  const portfolioValueUsdMinor = canonicalUsdMinor(record.portfolioValueUsdMinor);
  const buyingPowerUsdMinor = nullableUsdMinor(record.buyingPowerUsdMinor);
  const buyingPowerAvailability = oneOf(record.buyingPowerAvailability, [
    'INCLUDED',
    'EXCLUDED',
    'UNAVAILABLE',
  ] as const);
  const buyingPowerReason =
    record.buyingPowerReason === null
      ? null
      : oneOf(record.buyingPowerReason, BUYING_POWER_REASON_CODES);
  const observedAt = canonicalTimestamp(record.observedAt);
  if (observedAt > asOf) return fail();
  const freshness = oneOf(record.freshness, ['CURRENT', 'STALE'] as const);

  if (buyingPowerStatus === 'AVAILABLE') {
    if (
      buyingPowerUsdMinor === null ||
      buyingPowerAvailability === 'UNAVAILABLE' ||
      (buyingPowerAvailability === 'INCLUDED' && buyingPowerReason !== null) ||
      (buyingPowerAvailability === 'EXCLUDED' &&
        (buyingPowerUsdMinor !== '0' || buyingPowerReason === null))
    ) {
      return fail();
    }
  } else if (
    buyingPowerUsdMinor !== null ||
    buyingPowerAvailability === 'INCLUDED' ||
    buyingPowerReason === null
  ) {
    return fail();
  }
  if (
    freshness === 'STALE' &&
    (buyingPowerAvailability === 'INCLUDED' ||
      buyingPowerReason !== 'STALE_BALANCE_EXCLUDED' ||
      (buyingPowerStatus === 'AVAILABLE' &&
        (buyingPowerAvailability !== 'EXCLUDED' || buyingPowerUsdMinor !== '0')))
  ) {
    return fail();
  }
  if (freshness === 'CURRENT' && buyingPowerReason === 'STALE_BALANCE_EXCLUDED') return fail();

  return Object.freeze({
    stablecoin,
    assetIdentity,
    amountAtomic: record.amountAtomic,
    decimals: 6,
    portfolioValueUsdMinor,
    buyingPowerUsdMinor,
    buyingPowerAvailability,
    buyingPowerReason,
    observedAt,
    freshness,
  });
}

function sumUsdMinor(values: readonly string[]): bigint {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

function parseChain(
  value: unknown,
  namespace: WalletNamespace,
  buyingPowerStatus: BuyingPowerStatus,
  asOf: string,
): UnifiedBalanceChainContribution {
  const record = exactDataRecord(value, [
    'networkId',
    'portfolioValueUsdMinor',
    'buyingPowerUsdMinor',
    'assets',
  ]);
  if (
    typeof record.networkId !== 'string' ||
    !Object.hasOwn(PORTFOLIO_NETWORKS, record.networkId)
  ) {
    return fail();
  }
  const networkId = record.networkId as PortfolioNetworkId;
  if (PORTFOLIO_NETWORKS[networkId].namespace !== namespace) return fail();
  const portfolioValueUsdMinor = canonicalUsdMinor(record.portfolioValueUsdMinor);
  const buyingPowerUsdMinor = nullableUsdMinor(record.buyingPowerUsdMinor);
  const assets = Object.freeze(
    boundedArray(record.assets, MAX_ASSETS_PER_CHAIN, 1).map((asset) =>
      parseAsset(asset, networkId, buyingPowerStatus, asOf),
    ),
  );
  if (
    sumUsdMinor(assets.map((asset) => asset.portfolioValueUsdMinor)) !==
    BigInt(portfolioValueUsdMinor)
  ) {
    return fail();
  }
  if (
    new Set(assets.map(({ assetIdentity }) => assetIdentity)).size !== assets.length ||
    new Set(assets.map(({ stablecoin }) => stablecoin)).size !== assets.length
  ) {
    return fail();
  }
  if (buyingPowerStatus === 'AVAILABLE') {
    if (
      buyingPowerUsdMinor === null ||
      sumUsdMinor(
        assets.map((asset) => asset.buyingPowerUsdMinor).filter((amount) => amount !== null),
      ) !== BigInt(buyingPowerUsdMinor)
    ) {
      return fail();
    }
  } else if (buyingPowerUsdMinor !== null) return fail();

  return Object.freeze({ networkId, portfolioValueUsdMinor, buyingPowerUsdMinor, assets });
}

function parseWallet(
  value: unknown,
  buyingPowerStatus: BuyingPowerStatus,
  asOf: string,
): UnifiedBalanceWalletContribution {
  const record = exactDataRecord(value, [
    'walletId',
    'label',
    'namespace',
    'address',
    'portfolioValueUsdMinor',
    'buyingPowerUsdMinor',
    'chains',
  ]);
  if (typeof record.walletId !== 'string' || !UUID_V4.test(record.walletId)) return fail();
  const label = walletLabel(record.label);
  const namespace = oneOf(record.namespace, ['EVM', 'SOLANA'] as const);
  const address = canonicalAddress(record.address, namespace);
  const portfolioValueUsdMinor = canonicalUsdMinor(record.portfolioValueUsdMinor);
  const buyingPowerUsdMinor = nullableUsdMinor(record.buyingPowerUsdMinor);
  const chains = Object.freeze(
    boundedArray(record.chains, MAX_CHAINS_PER_WALLET, 1).map((chain) =>
      parseChain(chain, namespace, buyingPowerStatus, asOf),
    ),
  );
  if (
    new Set(chains.map(({ networkId }) => networkId)).size !== chains.length ||
    sumUsdMinor(chains.map((chain) => chain.portfolioValueUsdMinor)) !==
      BigInt(portfolioValueUsdMinor)
  ) {
    return fail();
  }
  if (buyingPowerStatus === 'AVAILABLE') {
    if (
      buyingPowerUsdMinor === null ||
      sumUsdMinor(
        chains.map((chain) => chain.buyingPowerUsdMinor).filter((amount) => amount !== null),
      ) !== BigInt(buyingPowerUsdMinor)
    ) {
      return fail();
    }
  } else if (buyingPowerUsdMinor !== null) return fail();

  return Object.freeze({
    walletId: record.walletId,
    label,
    namespace,
    address,
    portfolioValueUsdMinor,
    buyingPowerUsdMinor,
    chains,
  });
}

function parseBuyingPower(value: unknown): UnifiedBuyingPower {
  const record = exactDataRecord(value, [
    'status',
    'amountUsdMinor',
    'freshness',
    'deductions',
    'reasons',
  ]);
  const status = oneOf(record.status, ['AVAILABLE', 'UNAVAILABLE'] as const);
  const amountUsdMinor = nullableUsdMinor(record.amountUsdMinor);
  const freshness = oneOf(record.freshness, ['CURRENT', 'STALE'] as const);
  const deductions = Object.freeze(
    boundedArray(record.deductions, MAX_DEDUCTIONS).map((value) => {
      const deduction = exactDataRecord(value, ['code', 'amountUsdMinor']);
      return Object.freeze({
        code: oneOf(deduction.code, BUYING_POWER_DEDUCTION_CODES),
        amountUsdMinor: nullableUsdMinor(deduction.amountUsdMinor),
      });
    }),
  );
  const reasons = Object.freeze(
    boundedArray(record.reasons, MAX_REASONS).map((reason) =>
      oneOf(reason, BUYING_POWER_REASON_CODES),
    ),
  );
  if (
    new Set(deductions.map(({ code }) => code)).size !== deductions.length ||
    new Set(reasons).size !== reasons.length ||
    (status === 'AVAILABLE' &&
      (amountUsdMinor === null ||
        deductions.some(({ amountUsdMinor }) => amountUsdMinor === null))) ||
    (status === 'UNAVAILABLE' && (amountUsdMinor !== null || reasons.length === 0)) ||
    (freshness === 'STALE' && reasons.length === 0)
  ) {
    return fail();
  }
  return Object.freeze({ status, amountUsdMinor, freshness, deductions, reasons });
}

function parseResponse(value: unknown): UnifiedBalanceApiResponse {
  const record = exactDataRecord(value, [
    'schemaVersion',
    'snapshotId',
    'asOf',
    'freshness',
    'portfolioValueUsdMinor',
    'buyingPower',
    'wallets',
  ]);
  if (record.schemaVersion !== 1) return fail();
  if (typeof record.snapshotId !== 'string' || !SAFE_SNAPSHOT_ID.test(record.snapshotId)) {
    return fail();
  }
  const asOf = canonicalTimestamp(record.asOf);
  const freshness = oneOf(record.freshness, ['CURRENT', 'STALE'] as const);
  const portfolioValueUsdMinor = canonicalUsdMinor(record.portfolioValueUsdMinor);
  const buyingPower = parseBuyingPower(record.buyingPower);
  const wallets = Object.freeze(
    boundedArray(record.wallets, MAX_WALLETS).map((wallet) =>
      parseWallet(wallet, buyingPower.status, asOf),
    ),
  );
  if (
    new Set(wallets.map(({ walletId }) => walletId)).size !== wallets.length ||
    new Set(wallets.map(({ namespace, address }) => `${namespace}\0${address}`)).size !==
      wallets.length ||
    sumUsdMinor(wallets.map((wallet) => wallet.portfolioValueUsdMinor)) !==
      BigInt(portfolioValueUsdMinor)
  ) {
    return fail();
  }
  const containsStaleSource = wallets.some((wallet) =>
    wallet.chains.some((chain) => chain.assets.some((asset) => asset.freshness === 'STALE')),
  );
  if ((containsStaleSource ? 'STALE' : 'CURRENT') !== freshness) return fail();
  const reportsStaleBalance = buyingPower.reasons.includes('STALE_BALANCE_EXCLUDED');
  const reportsStaleInput = buyingPower.reasons.includes('BUYING_POWER_INPUT_STALE');
  if (
    reportsStaleBalance !== containsStaleSource ||
    (buyingPower.freshness === 'STALE'
      ? !reportsStaleBalance && !reportsStaleInput
      : reportsStaleBalance || reportsStaleInput)
  ) {
    return fail();
  }

  if (buyingPower.status === 'AVAILABLE') {
    const amount = buyingPower.amountUsdMinor;
    if (amount === null || BigInt(amount) > BigInt(portfolioValueUsdMinor)) return fail();
    if (
      sumUsdMinor(
        wallets.map((wallet) => wallet.buyingPowerUsdMinor).filter((value) => value !== null),
      ) !== BigInt(amount)
    ) {
      return fail();
    }
    const deductionAmounts = buyingPower.deductions.map(({ amountUsdMinor }) => amountUsdMinor);
    if (
      deductionAmounts.some((deduction) => deduction === null) ||
      sumUsdMinor(deductionAmounts.filter((deduction) => deduction !== null)) !==
        BigInt(portfolioValueUsdMinor) - BigInt(amount)
    ) {
      return fail();
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    snapshotId: record.snapshotId,
    asOf,
    freshness,
    portfolioValueUsdMinor,
    buyingPower,
    wallets,
  });
}

export function parseUnifiedBalanceResponse(value: unknown): UnifiedBalanceApiResponse {
  try {
    return parseResponse(value);
  } catch {
    throw new UnifiedBalanceResponseError();
  }
}

export interface FormattedUsdAmount {
  readonly visible: string;
  readonly accessible: string;
  readonly decimal: string;
}

export function formatUsdMinor(amountUsdMinor: string): FormattedUsdAmount {
  const amount = BigInt(canonicalUsdMinor(amountUsdMinor));
  const dollars = amount / 100n;
  const cents = (amount % 100n).toString().padStart(2, '0');
  const groupedDollars = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(dollars);
  const centsValue = BigInt(cents);
  return Object.freeze({
    visible: `$${groupedDollars}.${cents}`,
    accessible:
      cents === '00'
        ? `${groupedDollars} US ${dollars === 1n ? 'dollar' : 'dollars'}`
        : `${groupedDollars} US ${dollars === 1n ? 'dollar' : 'dollars'} and ${centsValue} ${centsValue === 1n ? 'cent' : 'cents'}`,
    decimal: `${dollars}.${cents}`,
  });
}

export function maskPortfolioAddress(address: string, namespace: WalletNamespace): string {
  const canonical = canonicalAddress(address, namespace);
  return namespace === 'EVM'
    ? `${canonical.slice(0, 6)}…${canonical.slice(-4)}`
    : `${canonical.slice(0, 4)}…${canonical.slice(-4)}`;
}

export function addressEnding(address: string, namespace: WalletNamespace): string {
  const canonical = canonicalAddress(address, namespace);
  return canonical.slice(-4);
}
