import {
  WALLET_OWNERSHIP_CHAIN_IDS,
  WalletIdentityValidationError,
  formatWalletAccountId,
  parseEvmWalletAddress,
  parseSolanaWalletAddress,
  parseWalletAccountId,
  parseWalletAddress,
  parseWalletChainId,
  solanaWalletAddressBytes,
  walletNamespaceOf,
} from './wallet-identity';

const SOLANA_ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('wallet identity', () => {
  it('accepts only the eight exact KAN-61 CAIP-2 network identifiers', () => {
    for (const chainId of WALLET_OWNERSHIP_CHAIN_IDS) {
      expect(parseWalletChainId(chainId)).toBe(chainId);
      expect(walletNamespaceOf(chainId)).toBe(chainId.startsWith('eip155:') ? 'eip155' : 'solana');
    }

    for (const invalid of [
      'eip155:01',
      'eip155:5',
      'EIP155:1',
      'solana:devnet',
      'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdq',
      'eip155:1:extra',
      '',
      null,
      1,
    ]) {
      expect(() => parseWalletChainId(invalid)).toThrow(WalletIdentityValidationError);
    }
  });

  it('normalizes valid EVM addresses and rejects zero or bad mixed-case checksums', () => {
    expect(parseEvmWalletAddress('0x52908400098527886E0F7030069857D2E4169EE7')).toBe(
      '0x52908400098527886e0f7030069857d2e4169ee7',
    );
    expect(parseEvmWalletAddress('0xde709f2102306220921060314715629080e2fb77')).toBe(
      '0xde709f2102306220921060314715629080e2fb77',
    );

    for (const invalid of [
      '0x0000000000000000000000000000000000000000',
      '0x52908400098527886e0F7030069857D2E4169EE7',
      '52908400098527886E0F7030069857D2E4169EE7',
      '0x1234',
      null,
    ]) {
      expect(() => parseEvmWalletAddress(invalid)).toThrow(WalletIdentityValidationError);
    }
  });

  it('accepts only canonical, nonzero 32-byte base58 Solana addresses', () => {
    expect(parseSolanaWalletAddress(SOLANA_ADDRESS)).toBe(SOLANA_ADDRESS);
    expect(solanaWalletAddressBytes(SOLANA_ADDRESS)).toHaveLength(32);

    for (const invalid of [
      '11111111111111111111111111111111',
      `${SOLANA_ADDRESS}0`,
      '1'.repeat(31),
      '1'.repeat(33),
      `1${SOLANA_ADDRESS}`,
      '',
      null,
    ]) {
      expect(() => parseSolanaWalletAddress(invalid)).toThrow(WalletIdentityValidationError);
    }
  });

  it('creates and parses exact canonical CAIP-10 wallet account IDs', () => {
    const evmAccount = formatWalletAccountId(
      'eip155:11155111',
      '0xde709f2102306220921060314715629080e2fb77',
    );
    const solanaAccount = formatWalletAccountId(
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      SOLANA_ADDRESS,
    );

    expect(parseWalletAccountId(evmAccount)).toBe(evmAccount);
    expect(parseWalletAccountId(solanaAccount)).toBe(solanaAccount);
    expect(parseWalletAddress('eip155:11155111', evmAccount.split(':').at(-1))).toBe(
      '0xde709f2102306220921060314715629080e2fb77',
    );
    expect(() =>
      parseWalletAccountId('eip155:11155111:0x52908400098527886E0F7030069857D2E4169EE7'),
    ).toThrow(WalletIdentityValidationError);
    expect(() => parseWalletAccountId(`${evmAccount}:extra`)).toThrow(
      WalletIdentityValidationError,
    );
  });
});
