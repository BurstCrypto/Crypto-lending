import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import { BlockchainSyncModule } from '../blockchain-sync/blockchain-sync.module';
import { PostgresPortfolioBalanceReader } from '../blockchain-sync/infrastructure/postgres/postgres-portfolio-balance.reader';
import { PostgresPortfolioPriceEvidenceReader } from '../valuation/infrastructure/postgres/postgres-stablecoin-price-evidence.store';
import { ValuationModule } from '../valuation/valuation.module';
import { WalletsModule } from '../wallets/wallets.module';
import {
  PORTFOLIO_CLOCK,
  PORTFOLIO_TIMER_RUNTIME,
  PortfolioService,
  SYSTEM_PORTFOLIO_CLOCK,
  SYSTEM_PORTFOLIO_TIMER_RUNTIME,
} from './application/portfolio.service';
import { PORTFOLIO_BALANCE_READER } from './application/ports/portfolio-balance-reader.port';
import { PORTFOLIO_PRICE_EVIDENCE_READER } from './application/ports/portfolio-price-evidence-reader.port';
import { PORTFOLIO_WALLET_REGISTRATION_READER } from './application/ports/portfolio-wallet-registration-reader.port';
import { PortfolioController } from './http/portfolio.controller';
import { PortfolioPrivacyInterceptor } from './http/portfolio-privacy.interceptor';
import { RegisteredPortfolioWalletReader } from './infrastructure/registered-portfolio-wallet-reader';

@Module({
  imports: [
    AccountsModule,
    AuthenticationModule,
    BlockchainSyncModule,
    ValuationModule,
    WalletsModule,
  ],
  controllers: [PortfolioController],
  providers: [
    PortfolioService,
    PortfolioPrivacyInterceptor,
    { provide: PORTFOLIO_CLOCK, useValue: SYSTEM_PORTFOLIO_CLOCK },
    { provide: PORTFOLIO_TIMER_RUNTIME, useValue: SYSTEM_PORTFOLIO_TIMER_RUNTIME },
    RegisteredPortfolioWalletReader,
    {
      provide: PORTFOLIO_WALLET_REGISTRATION_READER,
      useExisting: RegisteredPortfolioWalletReader,
    },
    {
      provide: PORTFOLIO_BALANCE_READER,
      useExisting: PostgresPortfolioBalanceReader,
    },
    {
      provide: PORTFOLIO_PRICE_EVIDENCE_READER,
      useExisting: PostgresPortfolioPriceEvidenceReader,
    },
  ],
  exports: [
    PortfolioService,
    PORTFOLIO_WALLET_REGISTRATION_READER,
    PORTFOLIO_BALANCE_READER,
    PORTFOLIO_PRICE_EVIDENCE_READER,
  ],
})
export class PortfolioModule {}
