import { SUPPORTED_STABLECOINS } from '../../blockchain/domain/supported-asset-registry';
import {
  DEFAULT_VERIFIED_STABLECOIN_PRICE_SOURCES,
  FailClosedChainlinkStablecoinPriceSource,
  FailClosedPythStablecoinPriceSource,
  VerifiedStablecoinPriceSourceUnavailableError,
} from './fail-closed-stablecoin-price-source';

describe('fail-closed stablecoin price sources', () => {
  it.each([
    ['PYTH_CORE', new FailClosedPythStablecoinPriceSource()],
    ['CHAINLINK_DATA_FEEDS', new FailClosedChainlinkStablecoinPriceSource()],
  ] as const)(
    'rejects every %s read without a dependency or external call',
    async (sourceId, source) => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');

      for (const stablecoin of SUPPORTED_STABLECOINS) {
        await expect(source.read(stablecoin, new AbortController().signal)).rejects.toMatchObject({
          name: 'VerifiedStablecoinPriceSourceUnavailableError',
          code: 'SOURCE_NOT_CONFIGURED',
          sourceId,
          message: 'Verified stablecoin price source is unavailable.',
        });
      }

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(Reflect.ownKeys(source)).toEqual(['sourceId']);
      fetchSpy.mockRestore();
    },
  );

  it.each(Object.values(DEFAULT_VERIFIED_STABLECOIN_PRICE_SOURCES))(
    'propagates the caller abort reason by identity',
    async (source) => {
      const controller = new AbortController();
      const reason = new Error('caller requested shutdown');
      controller.abort(reason);

      await expect(source.read('USDC', controller.signal)).rejects.toBe(reason);
    },
  );

  it.each(Object.values(DEFAULT_VERIFIED_STABLECOIN_PRICE_SOURCES))(
    'rejects invalid stablecoins and missing real AbortSignals',
    async (source) => {
      await expect(
        source.read('DAI' as 'USDC', new AbortController().signal),
      ).rejects.toBeInstanceOf(VerifiedStablecoinPriceSourceUnavailableError);
      await expect(source.read('USDC', {} as AbortSignal)).rejects.toMatchObject({
        code: 'INVALID_SOURCE_REQUEST',
      });
    },
  );

  it('ships immutable default sources that remain disabled', () => {
    expect(Object.isFrozen(DEFAULT_VERIFIED_STABLECOIN_PRICE_SOURCES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_VERIFIED_STABLECOIN_PRICE_SOURCES.PYTH_CORE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_VERIFIED_STABLECOIN_PRICE_SOURCES.CHAINLINK_DATA_FEEDS)).toBe(
      true,
    );
  });
});
