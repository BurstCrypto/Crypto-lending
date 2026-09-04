import { AppModule } from '../../app.module';
import { ValuationModule } from '../valuation.module';
import {
  FailClosedChainlinkStablecoinPriceSource,
  FailClosedPythStablecoinPriceSource,
} from './fail-closed-stablecoin-price-source';

function metadata(target: object, key: 'imports' | 'providers' | 'exports'): readonly unknown[] {
  return (Reflect.getMetadata(key, target) as readonly unknown[] | undefined) ?? [];
}

describe('verified stablecoin price ingestion runtime absence', () => {
  it('does not register either dormant source in ValuationModule', () => {
    const providers = metadata(ValuationModule, 'providers');
    const exports = metadata(ValuationModule, 'exports');

    expect(providers).not.toContain(FailClosedPythStablecoinPriceSource);
    expect(providers).not.toContain(FailClosedChainlinkStablecoinPriceSource);
    expect(exports).not.toContain(FailClosedPythStablecoinPriceSource);
    expect(exports).not.toContain(FailClosedChainlinkStablecoinPriceSource);
  });

  it('adds no source or ingestion module to production startup', () => {
    const productionImports = metadata(AppModule, 'imports');
    const valuationImports = metadata(ValuationModule, 'imports');
    const registeredNames = [...productionImports, ...valuationImports].map(
      (entry) => (entry as { readonly name?: unknown }).name,
    );

    expect(registeredNames).not.toEqual(
      expect.arrayContaining([
        'StablecoinPriceIngestionModule',
        'FailClosedPythStablecoinPriceSource',
        'FailClosedChainlinkStablecoinPriceSource',
      ]),
    );
  });
});
