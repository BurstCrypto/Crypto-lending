import {
  parseUnifiedBalanceResponse,
  type PortfolioNetworkId,
  type UnifiedBalanceApiResponse,
  type UnifiedBalanceAssetContribution,
  type UnifiedBalanceChainContribution,
  type UnifiedBalanceWalletContribution,
} from '@/lib/portfolio/unified-balance';

export const LOCAL_DEMO_EVM_NETWORK_ID = 'eip155:31337' as const;
export const LOCAL_DEMO_EVM_USDC_ASSET_IDENTITY =
  '0x0000000000000000000000000000000000000101' as const;

const VALIDATION_SURROGATE_NETWORK_ID = 'eip155:11155111' as const satisfies PortfolioNetworkId;
const VALIDATION_SURROGATE_USDC_ASSET_IDENTITY = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238';
const MAX_WALLETS = 32;
const MAX_CHAINS_PER_WALLET = 16;
const MAX_ASSETS_PER_CHAIN = 32;

export type LocalDemoPortfolioNetworkId = PortfolioNetworkId | typeof LOCAL_DEMO_EVM_NETWORK_ID;

export interface LocalDemoBalanceChainContribution extends Omit<
  UnifiedBalanceChainContribution,
  'networkId'
> {
  readonly networkId: LocalDemoPortfolioNetworkId;
}

export interface LocalDemoBalanceWalletContribution extends Omit<
  UnifiedBalanceWalletContribution,
  'chains'
> {
  readonly chains: readonly LocalDemoBalanceChainContribution[];
}

export interface LocalDemoBalanceApiResponse extends Omit<
  UnifiedBalanceApiResponse,
  'wallets' | 'use' | 'mayAuthorizeFinancialAction'
> {
  readonly wallets: readonly LocalDemoBalanceWalletContribution[];
  readonly use: 'LOCAL_DEMO_ESTIMATE_ONLY';
  readonly mayAuthorizeFinancialAction: false;
}

export class LocalDemoPortfolioResponseError extends Error {
  constructor() {
    super('Local demo portfolio data is unavailable.');
    this.name = 'LocalDemoPortfolioResponseError';
  }
}

function fail(): never {
  throw new LocalDemoPortfolioResponseError();
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key)) ||
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
  } catch (error) {
    if (error instanceof LocalDemoPortfolioResponseError) throw error;
    return fail();
  }
}

function exactDataArray(value: unknown, maximum: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || value.length > maximum) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const expectedKeys = [...new Array(value.length).keys()].map(String);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length + 1 ||
      keys.some(
        (key) => typeof key !== 'string' || (key !== 'length' && !expectedKeys.includes(key)),
      ) ||
      expectedKeys.some(
        (key) => !Object.hasOwn(descriptors, key) || !('value' in descriptors[key]!),
      ) ||
      !Object.hasOwn(descriptors, 'length') ||
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor)
    ) {
      return fail();
    }
    return expectedKeys.map((key) =>
      'value' in descriptors[key]! ? descriptors[key]!.value : undefined,
    );
  } catch (error) {
    if (error instanceof LocalDemoPortfolioResponseError) throw error;
    return fail();
  }
}

interface TranslationResult {
  readonly response: Record<string, unknown>;
  readonly localChainIndexes: ReadonlySet<string>;
}

function translateForProductionValidation(value: unknown): TranslationResult {
  const response = exactDataRecord(value, [
    'schemaVersion',
    'snapshotId',
    'asOf',
    'freshness',
    'portfolioValueUsdMinor',
    'buyingPower',
    'wallets',
    'use',
    'mayAuthorizeFinancialAction',
  ]);
  if (
    response.use !== 'LOCAL_DEMO_ESTIMATE_ONLY' ||
    response.mayAuthorizeFinancialAction !== false
  ) {
    return fail();
  }

  const localChainIndexes = new Set<string>();
  const wallets = exactDataArray(response.wallets, MAX_WALLETS).map((wallet, walletIndex) => {
    const walletRecord = exactDataRecord(wallet, [
      'walletId',
      'label',
      'namespace',
      'address',
      'portfolioValueUsdMinor',
      'buyingPowerUsdMinor',
      'chains',
    ]);
    const chains = exactDataArray(walletRecord.chains, MAX_CHAINS_PER_WALLET).map(
      (chain, chainIndex) => {
        const chainRecord = exactDataRecord(chain, [
          'networkId',
          'portfolioValueUsdMinor',
          'buyingPowerUsdMinor',
          'assets',
        ]);
        if (walletRecord.namespace !== 'EVM') {
          if (chainRecord.networkId === LOCAL_DEMO_EVM_NETWORK_ID) return fail();
          return chainRecord;
        }
        if (chainRecord.networkId !== LOCAL_DEMO_EVM_NETWORK_ID) return fail();

        const assets = exactDataArray(chainRecord.assets, MAX_ASSETS_PER_CHAIN).map((asset) => {
          const assetRecord = exactDataRecord(asset, [
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
          if (
            assetRecord.stablecoin !== 'USDC' ||
            assetRecord.assetIdentity !== LOCAL_DEMO_EVM_USDC_ASSET_IDENTITY
          ) {
            return fail();
          }
          return Object.freeze({
            ...assetRecord,
            assetIdentity: VALIDATION_SURROGATE_USDC_ASSET_IDENTITY,
          });
        });
        localChainIndexes.add(`${walletIndex}:${chainIndex}`);
        return Object.freeze({
          ...chainRecord,
          networkId: VALIDATION_SURROGATE_NETWORK_ID,
          assets: Object.freeze(assets),
        });
      },
    );
    return Object.freeze({ ...walletRecord, chains: Object.freeze(chains) });
  });

  return Object.freeze({
    response: Object.freeze({ ...response, wallets: Object.freeze(wallets) }),
    localChainIndexes,
  });
}

function restoreLocalIdentities(
  validated: UnifiedBalanceApiResponse,
  localChainIndexes: ReadonlySet<string>,
): LocalDemoBalanceApiResponse {
  const wallets = validated.wallets.map((wallet, walletIndex) => {
    const chains = wallet.chains.map((chain, chainIndex) => {
      if (!localChainIndexes.has(`${walletIndex}:${chainIndex}`)) return chain;
      const assets = chain.assets.map((asset): UnifiedBalanceAssetContribution =>
        Object.freeze({
          ...asset,
          assetIdentity: LOCAL_DEMO_EVM_USDC_ASSET_IDENTITY,
        }),
      );
      return Object.freeze({
        ...chain,
        networkId: LOCAL_DEMO_EVM_NETWORK_ID,
        assets: Object.freeze(assets),
      });
    });
    return Object.freeze({ ...wallet, chains: Object.freeze(chains) });
  });

  return Object.freeze({
    ...validated,
    wallets: Object.freeze(wallets),
    use: 'LOCAL_DEMO_ESTIMATE_ONLY',
    mayAuthorizeFinancialAction: false,
  });
}

/**
 * Local-demo-only compatibility boundary. The shared production contract remains
 * authoritative for shape, accounting, freshness, and registered production
 * assets; this parser adds exactly one non-authorizing LOCAL EVM identity.
 */
export function parseLocalDemoPortfolioResponse(value: unknown): LocalDemoBalanceApiResponse {
  try {
    const translated = translateForProductionValidation(value);
    const validated = parseUnifiedBalanceResponse(translated.response);
    if (
      validated.use !== 'LOCAL_DEMO_ESTIMATE_ONLY' ||
      validated.mayAuthorizeFinancialAction !== false
    ) {
      return fail();
    }
    return restoreLocalIdentities(validated, translated.localChainIndexes);
  } catch {
    throw new LocalDemoPortfolioResponseError();
  }
}
