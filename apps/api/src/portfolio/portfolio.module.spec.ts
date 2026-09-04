import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { BlockchainSyncModule } from '../blockchain-sync/blockchain-sync.module';
import { PostgresPortfolioBalanceReader } from '../blockchain-sync/infrastructure/postgres/postgres-portfolio-balance.reader';
import { PostgresPortfolioPriceEvidenceReader } from '../valuation/infrastructure/postgres/postgres-stablecoin-price-evidence.store';
import { ValuationModule } from '../valuation/valuation.module';
import { WalletsModule } from '../wallets/wallets.module';
import { PORTFOLIO_BALANCE_READER } from './application/ports/portfolio-balance-reader.port';
import { PORTFOLIO_PRICE_EVIDENCE_READER } from './application/ports/portfolio-price-evidence-reader.port';
import { PortfolioModule } from './portfolio.module';

describe('PortfolioModule production readers', () => {
  it('binds durable database projections without registering an external writer or indexer', () => {
    expect(Reflect.getMetadata('imports', PortfolioModule)).toEqual([
      AccountsModule,
      AuthenticationModule,
      BlockchainSyncModule,
      ValuationModule,
      WalletsModule,
    ]);

    const providers = Reflect.getMetadata('providers', PortfolioModule) as readonly unknown[];
    expect(providers).toContainEqual({
      provide: PORTFOLIO_BALANCE_READER,
      useExisting: PostgresPortfolioBalanceReader,
    });
    expect(providers).toContainEqual({
      provide: PORTFOLIO_PRICE_EVIDENCE_READER,
      useExisting: PostgresPortfolioPriceEvidenceReader,
    });
  });
});
