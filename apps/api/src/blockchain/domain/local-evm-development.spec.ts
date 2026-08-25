import {
  LOCAL_EVM_DEVELOPMENT_ASSETS,
  LOCAL_EVM_DEVELOPMENT_MANIFEST,
  normalizeLocalEvmDevelopmentAsset,
  parseLocalEvmDevelopmentManifest,
} from './local-evm-development';
import manifestJson from './local-evm-development-manifest.json';

describe('local EVM development manifest', () => {
  it('binds one explicit keyless loopback identity and a local-only mock USDC contract', () => {
    expect(LOCAL_EVM_DEVELOPMENT_MANIFEST).toMatchObject({
      runtimeIdentity: 'LOCAL_EVM_HARDHAT',
      engine: 'hardhat-edr-simulated',
      networkId: 'eip155:31337',
      chainIdHex: '0x7a69',
      rpc: { url: 'http://127.0.0.1:18545', host: '127.0.0.1', port: 18545 },
      accounts: 'NONE',
      registryFingerprintSha256: '3584658754837a75ca0bcb727035c38e382db89641e55311f57f862dee3278dc',
    });
    expect(LOCAL_EVM_DEVELOPMENT_ASSETS).toEqual([
      expect.objectContaining({
        networkId: 'eip155:31337',
        identity: '0x0000000000000000000000000000000000000101',
        stablecoin: 'USDC',
        decimals: 6,
        activationState: 'ACTIVE',
      }),
    ]);
    expect(Object.isFrozen(LOCAL_EVM_DEVELOPMENT_MANIFEST)).toBe(true);
    expect(Object.isFrozen(LOCAL_EVM_DEVELOPMENT_MANIFEST.assets)).toBe(true);
    expect(Object.isFrozen(LOCAL_EVM_DEVELOPMENT_ASSETS)).toBe(true);
  });

  it('normalizes only the LOCAL contract and never aliases a public chain identity', () => {
    expect(
      normalizeLocalEvmDevelopmentAsset(
        'eip155:31337',
        '0x0000000000000000000000000000000000000101',
      ),
    ).toMatchObject({ stablecoin: 'USDC' });
    expect(
      normalizeLocalEvmDevelopmentAsset('eip155:1', '0x0000000000000000000000000000000000000101'),
    ).toBeUndefined();
    expect(
      normalizeLocalEvmDevelopmentAsset(
        'eip155:31337',
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      ),
    ).toBeUndefined();
  });

  it.each([
    ['rpc host', { ...manifestJson, rpc: { ...manifestJson.rpc, host: '0.0.0.0' } }],
    ['chain ID', { ...manifestJson, chainIdDecimal: 1 }],
    ['accounts', { ...manifestJson, accounts: 'DEFAULT' }],
    ['fingerprint', { ...manifestJson, registryFingerprintSha256: '0'.repeat(64) }],
  ])('rejects %s drift', (_case, value) => {
    expect(() => parseLocalEvmDevelopmentManifest(value)).toThrow(
      'Invalid local EVM development manifest',
    );
  });
});
