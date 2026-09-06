import { Injectable } from '@nestjs/common';

import { WalletRegistrationService } from '../../wallets/application/wallet-registration.service';
import type {
  ActivePortfolioWalletRegistration,
  PortfolioWalletRegistrationReader,
  ReadActivePortfolioWalletRegistrationsRequest,
} from '../application/ports/portfolio-wallet-registration-reader.port';

/** Maps the authoritative durable wallet roster into the portfolio coverage boundary. */
@Injectable()
export class RegisteredPortfolioWalletReader implements PortfolioWalletRegistrationReader {
  constructor(private readonly wallets: WalletRegistrationService) {}

  async readActiveWalletRegistrations(
    request: ReadActivePortfolioWalletRegistrationsRequest,
  ): Promise<readonly ActivePortfolioWalletRegistration[]> {
    const signal = request.signal;
    const roster =
      signal === undefined
        ? await this.wallets.listActiveWallets(request.accountId)
        : await this.wallets.listActiveWallets(
            request.accountId,
            Object.freeze({ signal }),
          );
    return Object.freeze(
      roster.wallets.map(({ walletId, chainId }) =>
        Object.freeze({ walletId, networkId: chainId }),
      ),
    );
  }
}
