import { createHash } from 'node:crypto';

export const AAVE_V3_ETHEREUM_CORE_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2' as const;

export const AAVE_V3_ETHEREUM_MARKET_QUERY =
  `query SmartLendingAaveV3EthereumMarket($request: MarketRequest!) {
  market(request: $request) {
    address
    chain {
      chainId
      isTestnet
    }
    reserves {
      underlyingToken {
        address
        chainId
        symbol
        decimals
      }
      size {
        amount {
          raw
          decimals
          value
        }
      }
      supplyInfo {
        apy {
          raw
          decimals
          value
        }
        supplyCap {
          amount {
            raw
            decimals
            value
          }
        }
        supplyCapReached
        total {
          raw
          decimals
          value
        }
      }
      borrowInfo {
        availableLiquidity {
          amount {
            raw
            decimals
            value
          }
        }
        reserveFactor {
          raw
          decimals
          value
        }
      }
      isFrozen
      isPaused
    }
  }
}` as const;

/** Exact body an adapter may send; it contains no user or transaction field. */
export const AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST = Object.freeze({
  operationName: 'SmartLendingAaveV3EthereumMarket' as const,
  query: AAVE_V3_ETHEREUM_MARKET_QUERY,
  variables: Object.freeze({
    request: Object.freeze({
      address: AAVE_V3_ETHEREUM_CORE_MARKET,
      chainId: 1 as const,
    }),
  }),
});

/** Fingerprint of the complete frozen request body, including its fixed variables. */
export const AAVE_V3_ETHEREUM_MARKET_REQUEST_FINGERPRINT_SHA256 = createHash('sha256')
  .update(JSON.stringify(AAVE_V3_ETHEREUM_MARKET_GRAPHQL_REQUEST), 'utf8')
  .digest('hex');
