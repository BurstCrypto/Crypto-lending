import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import { parseWalletAddress } from '../../../wallets/domain/wallet-identity';
import {
  type LiveBridgeLegQuote,
  type LiveBridgeRouteEndpoint,
  type LiveBridgeRouteQuoteReader,
  type LiveRoundTripBridgeQuote,
  type ReadLiveRoundTripBridgeQuoteRequest,
} from '../../application/ports/live-bridge-route-quote-reader.port';
import {
  SMART_LENDING_EXTERNAL_FEED_CLIENT,
  SmartLendingExternalFeedDestination,
  type LifiQuoteQuery,
  type SmartLendingExternalFeedClient,
} from '../external-feeds';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const LIFI_SOLANA_CHAIN_ID = 1_151_111_081_099_710;
const MAX_UINT256 = (1n << 256n) - 1n;
const QUOTE_TTL_MILLISECONDS = 30_000;
const SAFE_REFERENCE = /^[\x21-\x7e]{1,192}$/u;
const BRIDGE_PROVIDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const RESERVED_BRIDGE_PROVIDER_IDS = new Set(['all', 'none', 'default']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_ATOMIC = /^[1-9][0-9]{0,77}$/u;
const CANONICAL_UNSIGNED_ATOMIC = /^(?:0|[1-9][0-9]{0,77})$/u;
const USD_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]{1,36}))?$/u;

interface ParsedLeg {
  readonly id: string;
  readonly tool: string;
  readonly fromAmount: bigint;
  readonly toAmountMin: bigint;
  readonly gasCostUsdMantissa: bigint;
  readonly nonIncludedFeeCostUsdMantissa: bigint;
}

export class LifiRoundTripQuoteUnavailableError extends Error {
  readonly code = 'LIFI_ROUND_TRIP_QUOTE_UNAVAILABLE' as const;

  constructor() {
    super('Cross-chain route quote is unavailable');
    this.name = 'LifiRoundTripQuoteUnavailableError';
  }
}

function unavailable(): never {
  throw new LifiRoundTripQuoteUnavailableError();
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') return unavailable();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return unavailable();
  }
  return value;
}

function ownDataValue(value: unknown, key: string): unknown {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable();
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return unavailable();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      return unavailable();
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof LifiRoundTripQuoteUnavailableError) throw error;
    return unavailable();
  }
}

function ownDataArray(value: unknown, maximum: number): readonly unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return unavailable();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors['length'] as PropertyDescriptor | undefined;
    if (!lengthDescriptor || !('value' in lengthDescriptor)) return unavailable();
    const length = lengthDescriptor.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length > maximum) {
      return unavailable();
    }
    const expectedKeys = new Set([
      'length',
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
      return unavailable();
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        return unavailable();
      }
      result.push(descriptor.value);
    }
    return result;
  } catch (error) {
    if (error instanceof LifiRoundTripQuoteUnavailableError) throw error;
    return unavailable();
  }
}

function positiveAtomic(value: unknown): bigint {
  if (typeof value !== 'string' || !CANONICAL_ATOMIC.test(value)) return unavailable();
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) return unavailable();
  return parsed;
}

function unsignedAtomic(value: unknown): bigint {
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED_ATOMIC.test(value)) {
    return unavailable();
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) return unavailable();
  return parsed;
}

function decimalUsdMantissaCeiling(value: unknown): bigint {
  if (typeof value !== 'string' || !USD_DECIMAL.test(value)) return unavailable();
  const [whole = '0', fraction = ''] = value.split('.');
  const retained = fraction.slice(0, 18).padEnd(18, '0');
  let result = BigInt(`${whole}${retained}`);
  if (/[1-9]/u.test(fraction.slice(18))) result += 1n;
  if (result > MAX_UINT256) return unavailable();
  return result;
}

function boundedSum(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) {
    total += value;
    if (total > MAX_UINT256) return unavailable();
  }
  return total;
}

function proportionalCeiling(value: bigint, numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n || numerator > denominator) return unavailable();
  const product = value * numerator;
  if (product > MAX_UINT256 * denominator) return unavailable();
  return (product + denominator - 1n) / denominator;
}

function chainId(networkId: MainnetLaunchNetworkId): 1 | typeof LIFI_SOLANA_CHAIN_ID {
  if (networkId === ETHEREUM) return 1;
  if (networkId === SOLANA) return LIFI_SOLANA_CHAIN_ID;
  return unavailable();
}

function queryChain(networkId: MainnetLaunchNetworkId): '1' | 'SOL' {
  return networkId === ETHEREUM ? '1' : networkId === SOLANA ? 'SOL' : unavailable();
}

function sameIdentity(
  networkId: MainnetLaunchNetworkId,
  actual: unknown,
  expected: string,
): boolean {
  if (typeof actual !== 'string') return false;
  return networkId === ETHEREUM
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected;
}

function sameWallet(networkId: MainnetLaunchNetworkId, actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') return false;
  return networkId === ETHEREUM
    ? actual.toLowerCase() === expected.toLowerCase()
    : actual === expected;
}

function validateEndpoint(endpoint: LiveBridgeRouteEndpoint): {
  readonly networkId: MainnetLaunchNetworkId;
  readonly assetId: string;
  readonly assetSymbol: 'USDC' | 'USDT' | 'PYUSD';
  readonly walletAddress: string;
} {
  const asset = MAINNET_SUPPORTED_ASSET_REGISTRY.normalizeAsset(
    endpoint.networkId,
    endpoint.assetId,
  );
  if (
    !asset ||
    asset.activationState !== 'ACTIVE' ||
    asset.decimals !== 6 ||
    endpoint.assetDecimals !== 6 ||
    (endpoint.networkId !== ETHEREUM && endpoint.networkId !== SOLANA)
  ) {
    return unavailable();
  }
  let walletAddress: string;
  try {
    walletAddress = parseWalletAddress(endpoint.networkId, endpoint.walletAddress);
  } catch {
    return unavailable();
  }
  return {
    networkId: endpoint.networkId,
    assetId: asset.identity,
    assetSymbol: asset.stablecoin,
    walletAddress,
  };
}

function gasCost(value: unknown): bigint {
  const entries = ownDataArray(value, 16);
  if (entries.length === 0) return unavailable();
  return boundedSum(
    entries.map((entry) => {
      positiveAtomic(ownDataValue(entry, 'amount'));
      const amountUsdMantissa = decimalUsdMantissaCeiling(ownDataValue(entry, 'amountUSD'));
      if (amountUsdMantissa === 0n) return unavailable();
      return amountUsdMantissa;
    }),
  );
}

function nonIncludedFeeCost(value: unknown): bigint {
  const entries = ownDataArray(value, 16);
  return boundedSum(
    entries.map((entry) => {
      const included = ownDataValue(entry, 'included');
      if (typeof included !== 'boolean') return unavailable();
      const atomicAmount = unsignedAtomic(ownDataValue(entry, 'amount'));
      const amount = decimalUsdMantissaCeiling(ownDataValue(entry, 'amountUSD'));
      if ((atomicAmount === 0n) !== (amount === 0n)) return unavailable();
      return included ? 0n : amount;
    }),
  );
}

function assertBoundCrossStep(
  value: unknown,
  expectedBridgeProviderId: string,
  allowedBridgeProviderIds: ReadonlySet<string>,
): void {
  const steps = ownDataArray(value, 32);
  let crossStepCount = 0;
  for (const step of steps) {
    const type = ownDataValue(step, 'type');
    if (type !== 'protocol' && type !== 'cross') return unavailable();
    if (type === 'cross') {
      const bridgeProviderId = ownDataValue(step, 'tool');
      if (
        typeof bridgeProviderId !== 'string' ||
        !BRIDGE_PROVIDER.test(bridgeProviderId) ||
        bridgeProviderId !== expectedBridgeProviderId ||
        !allowedBridgeProviderIds.has(bridgeProviderId)
      ) {
        return unavailable();
      }
      crossStepCount += 1;
    }
  }
  if (crossStepCount !== 1) return unavailable();
}

function parseLeg(
  value: unknown,
  source: ReturnType<typeof validateEndpoint>,
  destination: ReturnType<typeof validateEndpoint>,
  expectedFromAmount: bigint,
  allowedBridgeProviderIds: ReadonlySet<string>,
): ParsedLeg {
  const id = ownDataValue(value, 'id');
  const type = ownDataValue(value, 'type');
  const tool = ownDataValue(value, 'tool');
  if (
    typeof id !== 'string' ||
    !SAFE_REFERENCE.test(id) ||
    type !== 'lifi' ||
    typeof tool !== 'string' ||
    !BRIDGE_PROVIDER.test(tool) ||
    !allowedBridgeProviderIds.has(tool)
  ) {
    return unavailable();
  }

  const action = ownDataValue(value, 'action');
  const fromToken = ownDataValue(action, 'fromToken');
  const toToken = ownDataValue(action, 'toToken');
  if (
    ownDataValue(action, 'fromChainId') !== chainId(source.networkId) ||
    ownDataValue(action, 'toChainId') !== chainId(destination.networkId) ||
    !sameIdentity(source.networkId, ownDataValue(fromToken, 'address'), source.assetId) ||
    !sameIdentity(destination.networkId, ownDataValue(toToken, 'address'), destination.assetId) ||
    ownDataValue(fromToken, 'chainId') !== chainId(source.networkId) ||
    ownDataValue(toToken, 'chainId') !== chainId(destination.networkId) ||
    ownDataValue(fromToken, 'decimals') !== 6 ||
    ownDataValue(toToken, 'decimals') !== 6 ||
    ownDataValue(fromToken, 'coinKey') !== source.assetSymbol ||
    ownDataValue(toToken, 'coinKey') !== destination.assetSymbol ||
    !sameWallet(source.networkId, ownDataValue(action, 'fromAddress'), source.walletAddress) ||
    !sameWallet(destination.networkId, ownDataValue(action, 'toAddress'), destination.walletAddress)
  ) {
    return unavailable();
  }

  const actionFromAmount = positiveAtomic(ownDataValue(action, 'fromAmount'));
  const estimate = ownDataValue(value, 'estimate');
  if (ownDataValue(estimate, 'tool') !== tool) return unavailable();
  const estimateFromAmount = positiveAtomic(ownDataValue(estimate, 'fromAmount'));
  const toAmountMin = positiveAtomic(ownDataValue(estimate, 'toAmountMin'));
  if (
    actionFromAmount !== expectedFromAmount ||
    estimateFromAmount !== expectedFromAmount ||
    toAmountMin > expectedFromAmount
  ) {
    return unavailable();
  }
  assertBoundCrossStep(ownDataValue(value, 'includedSteps'), tool, allowedBridgeProviderIds);
  return {
    id,
    tool,
    fromAmount: expectedFromAmount,
    toAmountMin,
    gasCostUsdMantissa: gasCost(ownDataValue(estimate, 'gasCosts')),
    nonIncludedFeeCostUsdMantissa: nonIncludedFeeCost(ownDataValue(estimate, 'feeCosts')),
  };
}

function bridgeList(values: readonly string[]): {
  readonly values: readonly string[];
  readonly text: string;
} {
  if (values.length < 1 || values.length > 16) return unavailable();
  const normalized = values.map((value) => {
    if (!BRIDGE_PROVIDER.test(value) || RESERVED_BRIDGE_PROVIDER_IDS.has(value.toLowerCase())) {
      return unavailable();
    }
    return value;
  });
  if (new Set(normalized).size !== normalized.length) return unavailable();
  normalized.sort((left, right) => left.localeCompare(right));
  return { values: Object.freeze(normalized), text: normalized.join(',') };
}

function reference(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value)) return unavailable();
  return value;
}

function legQuote(
  leg: ParsedLeg,
  sourceValueUsdMantissa: bigint,
  sourceValueAtomic: bigint,
): LiveBridgeLegQuote {
  const transferValueLossUsdMantissa = boundedSum([
    proportionalCeiling(
      sourceValueUsdMantissa,
      leg.fromAmount - leg.toAmountMin,
      sourceValueAtomic,
    ),
    leg.nonIncludedFeeCostUsdMantissa,
  ]);
  return Object.freeze({
    quoteReferenceId: leg.id,
    bridgeProviderId: leg.tool,
    sourceAmountAtomic: leg.fromAmount,
    minimumDestinationAmountAtomic: leg.toAmountMin,
    networkGasCostUsdMantissa: leg.gasCostUsdMantissa,
    transferValueLossUsdMantissa,
  });
}

function quoteQuery(
  source: ReturnType<typeof validateEndpoint>,
  destination: ReturnType<typeof validateEndpoint>,
  fromAmount: bigint,
  allowedBridges: string,
): LifiQuoteQuery {
  return Object.freeze({
    fromChain: queryChain(source.networkId),
    toChain: queryChain(destination.networkId),
    fromToken: source.assetId,
    toToken: destination.assetId,
    fromAmount: fromAmount.toString(),
    fromAddress: source.walletAddress,
    toAddress: destination.walletAddress,
    slippage: '0.005',
    integrator: 'crypto-lending',
    allowBridges: allowedBridges,
    denyExchanges: 'all',
    allowDestinationCall: 'false',
    order: 'CHEAPEST',
  });
}

@Injectable()
export class LifiRoundTripQuoteAdapter implements LiveBridgeRouteQuoteReader {
  constructor(
    @Inject(SMART_LENDING_EXTERNAL_FEED_CLIENT)
    private readonly client: SmartLendingExternalFeedClient,
  ) {}

  async readRoundTripQuote(
    request: ReadLiveRoundTripBridgeQuoteRequest,
  ): Promise<LiveRoundTripBridgeQuote> {
    try {
      const quotedAt = canonicalTimestamp(request.evaluatedAt);
      if (
        !UUID_V4.test(request.correlationId) ||
        request.sourceAmountAtomic <= 0n ||
        request.sourceAmountAtomic > MAX_UINT256 ||
        request.sourceAmountUsdMantissa <= 0n ||
        request.sourceAmountUsdMantissa > MAX_UINT256
      ) {
        return unavailable();
      }
      const positionId = reference(request.positionId);
      const opportunityId = reference(request.opportunityId);
      const source = validateEndpoint(request.source);
      const destination = validateEndpoint(request.destination);
      if (
        source.networkId === destination.networkId ||
        source.assetSymbol !== destination.assetSymbol
      ) {
        return unavailable();
      }
      const allowed = bridgeList(request.allowedBridgeProviderIds);
      const allowedSet = new Set(allowed.values);
      const entryRaw = await this.client.get(
        SmartLendingExternalFeedDestination.LifiQuote,
        quoteQuery(source, destination, request.sourceAmountAtomic, allowed.text),
      );
      const entry = parseLeg(entryRaw, source, destination, request.sourceAmountAtomic, allowedSet);
      const exitRaw = await this.client.get(
        SmartLendingExternalFeedDestination.LifiQuote,
        quoteQuery(destination, source, entry.toAmountMin, allowed.text),
      );
      const exit = parseLeg(exitRaw, destination, source, entry.toAmountMin, allowedSet);
      const entryPublic = legQuote(
        entry,
        request.sourceAmountUsdMantissa,
        request.sourceAmountAtomic,
      );
      const exitPublic = legQuote(
        exit,
        request.sourceAmountUsdMantissa,
        request.sourceAmountAtomic,
      );
      const validUntil = new Date(Date.parse(quotedAt) + QUOTE_TTL_MILLISECONDS).toISOString();
      const digest = createHash('sha256')
        .update(
          JSON.stringify({
            schemaVersion: 1,
            adapterId: 'lifi-round-trip-quote-v1',
            positionId,
            opportunityId,
            source: {
              networkId: source.networkId,
              assetId: source.assetId,
              walletAddress: source.walletAddress,
              amountAtomic: request.sourceAmountAtomic.toString(),
              amountUsdMantissa: request.sourceAmountUsdMantissa.toString(),
            },
            destination: {
              networkId: destination.networkId,
              assetId: destination.assetId,
              walletAddress: destination.walletAddress,
            },
            quotedAt,
            validUntil,
            allowedBridgeProviderIds: allowed.values,
            entry: {
              quoteReferenceId: entryPublic.quoteReferenceId,
              bridgeProviderId: entryPublic.bridgeProviderId,
              sourceAmountAtomic: entryPublic.sourceAmountAtomic.toString(),
              minimumDestinationAmountAtomic: entryPublic.minimumDestinationAmountAtomic.toString(),
              networkGasCostUsdMantissa: entryPublic.networkGasCostUsdMantissa.toString(),
              transferValueLossUsdMantissa: entryPublic.transferValueLossUsdMantissa.toString(),
            },
            exit: {
              quoteReferenceId: exitPublic.quoteReferenceId,
              bridgeProviderId: exitPublic.bridgeProviderId,
              sourceAmountAtomic: exitPublic.sourceAmountAtomic.toString(),
              minimumDestinationAmountAtomic: exitPublic.minimumDestinationAmountAtomic.toString(),
              networkGasCostUsdMantissa: exitPublic.networkGasCostUsdMantissa.toString(),
              transferValueLossUsdMantissa: exitPublic.transferValueLossUsdMantissa.toString(),
            },
          }),
          'utf8',
        )
        .digest('hex');
      return Object.freeze({
        schemaVersion: 1 as const,
        adapterId: 'lifi-round-trip-quote-v1' as const,
        quoteReferenceId: `lifi-round-trip:${digest}`,
        routeReferenceId: `lifi-route:${digest}`,
        positionId,
        opportunityId,
        sourceNetworkId: source.networkId,
        destinationNetworkId: destination.networkId,
        sourceAssetId: source.assetId,
        destinationAssetId: destination.assetId,
        quotedAt,
        validUntil,
        entry: entryPublic,
        exit: exitPublic,
        use: 'QUOTE_EVIDENCE_ONLY' as const,
        includesTransactionPayload: false as const,
        mayAuthorizeTransaction: false as const,
        mayExecuteTransaction: false as const,
      });
    } catch (error) {
      if (error instanceof LifiRoundTripQuoteUnavailableError) throw error;
      return unavailable();
    }
  }
}
