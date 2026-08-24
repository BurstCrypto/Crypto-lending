import { Injectable } from '@nestjs/common';

import { PortfolioUnavailableError } from '../application/portfolio.errors';
import type {
  IndexedPortfolioBalanceSnapshot,
  PortfolioBalanceReader,
  ReadPortfolioBalancesRequest,
} from '../application/ports/portfolio-balance-reader.port';
import type {
  PortfolioPriceEvidenceReader,
  PortfolioPriceEvidenceSnapshot,
  ReadPortfolioPriceEvidenceRequest,
} from '../application/ports/portfolio-price-evidence-reader.port';

@Injectable()
export class UnavailablePortfolioBalanceReader implements PortfolioBalanceReader {
  readCurrentBalances(
    request: ReadPortfolioBalancesRequest,
  ): Promise<IndexedPortfolioBalanceSnapshot> {
    void request;
    return Promise.reject(new PortfolioUnavailableError());
  }
}

@Injectable()
export class UnavailablePortfolioPriceEvidenceReader implements PortfolioPriceEvidenceReader {
  readPriceEvidence(
    request: ReadPortfolioPriceEvidenceRequest,
  ): Promise<PortfolioPriceEvidenceSnapshot> {
    void request;
    return Promise.reject(new PortfolioUnavailableError());
  }
}
