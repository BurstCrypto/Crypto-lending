import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { AuthenticationModule } from '../authentication/authentication.module';
import {
  PORTFOLIO_CLOCK,
  PortfolioService,
  SYSTEM_PORTFOLIO_CLOCK,
} from './application/portfolio.service';
import { PORTFOLIO_BALANCE_READER } from './application/ports/portfolio-balance-reader.port';
import { PORTFOLIO_PRICE_EVIDENCE_READER } from './application/ports/portfolio-price-evidence-reader.port';
import { PortfolioController } from './http/portfolio.controller';
import { PortfolioPrivacyInterceptor } from './http/portfolio-privacy.interceptor';
import {
  UnavailablePortfolioBalanceReader,
  UnavailablePortfolioPriceEvidenceReader,
} from './infrastructure/unavailable-portfolio-readers';

@Module({
  imports: [AccountsModule, AuthenticationModule],
  controllers: [PortfolioController],
  providers: [
    PortfolioService,
    PortfolioPrivacyInterceptor,
    { provide: PORTFOLIO_CLOCK, useValue: SYSTEM_PORTFOLIO_CLOCK },
    UnavailablePortfolioBalanceReader,
    UnavailablePortfolioPriceEvidenceReader,
    {
      provide: PORTFOLIO_BALANCE_READER,
      useExisting: UnavailablePortfolioBalanceReader,
    },
    {
      provide: PORTFOLIO_PRICE_EVIDENCE_READER,
      useExisting: UnavailablePortfolioPriceEvidenceReader,
    },
  ],
  exports: [PortfolioService, PORTFOLIO_BALANCE_READER, PORTFOLIO_PRICE_EVIDENCE_READER],
})
export class PortfolioModule {}
