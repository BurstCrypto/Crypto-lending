import type { AccountId } from '../../../accounts/domain/account-profile';

export const PORTFOLIO_WALLET_REGISTRATION_READER = Symbol('PORTFOLIO_WALLET_REGISTRATION_READER');

/**
 * Authoritative, active, chain-qualified wallet registration used to define
 * portfolio read coverage. Implementations must source this set from durable
 * wallet registrations for the requested account, never from a balance/indexer
 * response.
 */
export interface ActivePortfolioWalletRegistration {
  readonly walletId: string;
  readonly networkId: string;
}

export interface ReadActivePortfolioWalletRegistrationsRequest {
  readonly accountId: AccountId;
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

export interface PortfolioWalletRegistrationReader {
  readActiveWalletRegistrations(
    request: ReadActivePortfolioWalletRegistrationsRequest,
  ): Promise<readonly ActivePortfolioWalletRegistration[]>;
}
