import {
  ActivePortfolioWalletRegistrationsValidationError,
  parseActivePortfolioWalletRegistrations,
} from './active-portfolio-wallet-registrations';

const ETHEREUM_WALLET = Object.freeze({
  walletId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  networkId: 'eip155:1',
});
const SOLANA_WALLET = Object.freeze({
  walletId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

describe('active portfolio wallet registration coverage input', () => {
  it('accepts, copies, sorts, and freezes active mainnet chain-qualified registrations', () => {
    const input: Array<{ walletId: string; networkId: string }> = [
      { ...SOLANA_WALLET },
      { ...ETHEREUM_WALLET },
    ];
    const parsed = parseActivePortfolioWalletRegistrations(input);

    expect(parsed).toEqual([ETHEREUM_WALLET, SOLANA_WALLET]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed[0])).toBe(true);
    input[0]!.networkId = 'eip155:8453';
    expect(parsed[1]?.networkId).toBe(SOLANA_WALLET.networkId);
  });

  it('accepts an empty authoritative active-registration set', () => {
    expect(parseActivePortfolioWalletRegistrations([])).toEqual([]);
  });

  it('rejects non-launch mainnets, testnet, unknown, duplicate, malformed, sparse, and accessor inputs', () => {
    const accessor = { ...ETHEREUM_WALLET } as Record<string, unknown>;
    Object.defineProperty(accessor, 'networkId', {
      enumerable: true,
      get: () => 'eip155:1',
    });
    const sparse = new Array(1);
    const overCapacity = Array.from({ length: 33 }, (_, index) => ({
      walletId: `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
      networkId: 'eip155:1',
    }));
    for (const value of [
      [{ ...ETHEREUM_WALLET, networkId: 'eip155:8453' }],
      [{ ...ETHEREUM_WALLET, networkId: 'eip155:56' }],
      [{ ...ETHEREUM_WALLET, networkId: 'eip155:42161' }],
      [{ ...ETHEREUM_WALLET, networkId: 'eip155:11155111' }],
      [{ ...ETHEREUM_WALLET, networkId: 'eip155:42161' }],
      [{ ...ETHEREUM_WALLET, networkId: 'eip155:999999' }],
      [ETHEREUM_WALLET, ETHEREUM_WALLET],
      [{ ...ETHEREUM_WALLET, extra: true }],
      [accessor],
      sparse,
      overCapacity,
    ]) {
      expect(() => parseActivePortfolioWalletRegistrations(value)).toThrow(
        ActivePortfolioWalletRegistrationsValidationError,
      );
    }
  });
});
