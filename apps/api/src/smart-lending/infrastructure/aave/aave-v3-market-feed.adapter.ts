import { Inject, Injectable } from '@nestjs/common';

import type {
  ProviderNativeLendingMarketReader,
  ReadProviderNativeLendingMarketsRequest,
} from '../../application/ports/provider-native-lending-market-reader.port';
import {
  AAVE_V3_ETHEREUM_MARKET_EXTERNAL_FEED_CLIENT,
  type AaveV3EthereumMarketExternalFeedClient,
} from '../external-feeds/smart-lending-external-feed.client';
import {
  type AaveV3EthereumLendingMarketSnapshot,
  parseAaveV3EthereumMarketFeed,
} from './aave-v3-market-feed.parser';

export const AAVE_V3_ETHEREUM_PROVIDER_NATIVE_LENDING_MARKET_READER = Symbol(
  'AAVE_V3_ETHEREUM_PROVIDER_NATIVE_LENDING_MARKET_READER',
);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface AaveV3EthereumLendingMarketReader extends ProviderNativeLendingMarketReader {
  readCurrentMarkets(
    request: ReadProviderNativeLendingMarketsRequest,
  ): Promise<AaveV3EthereumLendingMarketSnapshot>;
}

export class AaveV3EthereumMarketUnavailableError extends Error {
  readonly code = 'AAVE_V3_ETHEREUM_MARKET_UNAVAILABLE' as const;

  constructor() {
    super('Aave V3 Ethereum market data is unavailable');
    this.name = 'AaveV3EthereumMarketUnavailableError';
  }
}

function unavailable(): never {
  throw new AaveV3EthereumMarketUnavailableError();
}

function requestData(value: unknown): Readonly<Record<'evaluatedAt' | 'correlationId', unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || keys.some((key) => key !== 'evaluatedAt' && key !== 'correlationId')) {
    return unavailable();
  }
  const evaluatedAt = descriptors['evaluatedAt'];
  const correlationId = descriptors['correlationId'];
  if (
    !evaluatedAt?.enumerable ||
    !('value' in evaluatedAt) ||
    !correlationId?.enumerable ||
    !('value' in correlationId)
  ) {
    return unavailable();
  }
  return Object.freeze({
    evaluatedAt: evaluatedAt.value,
    correlationId: correlationId.value,
  });
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') return unavailable();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return unavailable();
  }
  return value;
}

/**
 * Read-only provider corroboration. This adapter deliberately cannot promote
 * an Aave response to recommendation eligibility or authorize a transaction.
 */
@Injectable()
export class AaveV3EthereumMarketFeedAdapter implements AaveV3EthereumLendingMarketReader {
  constructor(
    @Inject(AAVE_V3_ETHEREUM_MARKET_EXTERNAL_FEED_CLIENT)
    private readonly externalFeed: AaveV3EthereumMarketExternalFeedClient,
  ) {}

  async readCurrentMarkets(
    request: ReadProviderNativeLendingMarketsRequest,
  ): Promise<AaveV3EthereumLendingMarketSnapshot> {
    try {
      const requestRecord = requestData(request);
      const evaluatedAt = canonicalTimestamp(requestRecord.evaluatedAt);
      if (
        typeof requestRecord.correlationId !== 'string' ||
        !UUID_V4.test(requestRecord.correlationId)
      ) {
        return unavailable();
      }

      const response = await this.externalFeed.readEthereumCoreMarket();
      const snapshot = parseAaveV3EthereumMarketFeed(response, evaluatedAt);
      if (
        snapshot.sourceId !== 'AAVE_V3_GRAPHQL' ||
        snapshot.use !== 'PROVIDER_NATIVE_CORROBORATION_ONLY' ||
        snapshot.mayEstablishRecommendationEligibility !== false ||
        snapshot.mayAuthorizeFinancialAction !== false ||
        snapshot.providerCoverage.length !== 1 ||
        snapshot.providerCoverage[0] !== 'aave'
      ) {
        return unavailable();
      }
      return snapshot;
    } catch {
      return unavailable();
    }
  }
}
