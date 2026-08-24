export class PortfolioUnavailableError extends Error {
  constructor() {
    super('portfolio is unavailable');
    this.name = 'PortfolioUnavailableError';
  }
}
