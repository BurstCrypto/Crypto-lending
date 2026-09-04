import { PostgresModule } from '../infrastructure/database/postgres.module';
import { PostgresPortfolioPriceEvidenceReader } from './infrastructure/postgres/postgres-stablecoin-price-evidence.store';
import { PostgresStablecoinPriceEvidenceWriter } from './infrastructure/postgres/postgres-stablecoin-price-evidence.store';
import { ValuationModule } from './valuation.module';

describe('ValuationModule', () => {
  it('exports only the durable API price reader', () => {
    expect(Reflect.getMetadata('imports', ValuationModule)).toEqual([PostgresModule]);
    expect(Reflect.getMetadata('providers', ValuationModule)).toEqual([
      PostgresPortfolioPriceEvidenceReader,
    ]);
    expect(Reflect.getMetadata('exports', ValuationModule)).toEqual([
      PostgresPortfolioPriceEvidenceReader,
    ]);
    expect(Reflect.getMetadata('providers', ValuationModule)).not.toContain(
      PostgresStablecoinPriceEvidenceWriter,
    );
  });
});
