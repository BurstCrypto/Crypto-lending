import { Module } from '@nestjs/common';

import { PostgresModule } from '../infrastructure/database/postgres.module';
import { PostgresPortfolioPriceEvidenceReader } from './infrastructure/postgres/postgres-stablecoin-price-evidence.store';

/**
 * API-safe valuation read model. Evidence writers and external feed adapters
 * deliberately remain outside this module so importing it cannot ingest or
 * authorize provider data.
 */
@Module({
  imports: [PostgresModule],
  providers: [PostgresPortfolioPriceEvidenceReader],
  exports: [PostgresPortfolioPriceEvidenceReader],
})
export class ValuationModule {}
