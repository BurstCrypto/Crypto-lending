import { parseAccountId } from '../../accounts/domain/account-profile';
import type { ActiveWalletRoster } from '../../wallets/application/wallet-registration.service';
import { RegisteredPortfolioWalletReader } from './registered-portfolio-wallet-reader';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

describe('RegisteredPortfolioWalletReader', () => {
  it('maps only chain-qualified registration identity and discards private roster fields', async () => {
    const roster: ActiveWalletRoster = {
      version: 1,
      wallets: [
        {
          walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          chainId: 'eip155:1',
          address: '0x1111111111111111111111111111111111111111',
          registeredAt: '2026-09-02T18:00:00.000Z',
          registryEnvironment: 'MAINNET',
          registryVersion: 1,
          registryFingerprintSha256: '1'.repeat(64),
        },
      ],
    };
    const wallets = { listActiveWallets: jest.fn(async () => roster) };
    const reader = new RegisteredPortfolioWalletReader(wallets as never);

    const result = await reader.readActiveWalletRegistrations({
      accountId: ACCOUNT_ID,
      evaluatedAt: '2026-09-02T18:00:00.000Z',
      correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });

    expect(wallets.listActiveWallets).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(wallets.listActiveWallets.mock.calls[0]).toHaveLength(1);
    expect(result).toEqual([
      {
        walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        networkId: 'eip155:1',
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('0x1111111111111111111111111111111111111111');
  });

  it('forwards the exact optional cancellation signal to the durable roster read', async () => {
    const roster: ActiveWalletRoster = { version: 1, wallets: [] };
    const listActiveWallets = jest.fn(
      async (
        accountId: typeof ACCOUNT_ID,
        options?: Readonly<{ signal: AbortSignal }>,
      ): Promise<ActiveWalletRoster> => {
        void accountId;
        void options;
        return roster;
      },
    );
    const wallets = { listActiveWallets };
    const reader = new RegisteredPortfolioWalletReader(wallets as never);
    const controller = new AbortController();

    await expect(
      reader.readActiveWalletRegistrations({
        accountId: ACCOUNT_ID,
        evaluatedAt: '2026-09-02T18:00:00.000Z',
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        signal: controller.signal,
      }),
    ).resolves.toEqual([]);

    expect(wallets.listActiveWallets).toHaveBeenCalledTimes(1);
    expect(wallets.listActiveWallets).toHaveBeenCalledWith(ACCOUNT_ID, {
      signal: controller.signal,
    });
    expect(listActiveWallets.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('propagates disabled or unavailable durable registration reads', async () => {
    const failure = new Error('wallet registration unavailable');
    const wallets = { listActiveWallets: jest.fn(async () => Promise.reject(failure)) };
    const reader = new RegisteredPortfolioWalletReader(wallets as never);

    await expect(
      reader.readActiveWalletRegistrations({
        accountId: ACCOUNT_ID,
        evaluatedAt: '2026-09-02T18:00:00.000Z',
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }),
    ).rejects.toBe(failure);
    expect(wallets.listActiveWallets.mock.calls[0]).toHaveLength(1);
  });
});
