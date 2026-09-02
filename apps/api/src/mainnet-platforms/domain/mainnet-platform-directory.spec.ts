import { MainnetPlatformDirectoryService } from '../application/mainnet-platform-directory.service';
import {
  MAINNET_PLATFORM_DIRECTORY,
  MAINNET_PLATFORM_MINIMUM_PROVIDER_TARGET,
} from './mainnet-platform-directory';

describe('mainnet platform directory', () => {
  it('publishes at least ten unique planned provider candidates across EVM and Solana', () => {
    const providers = MAINNET_PLATFORM_DIRECTORY.providers;

    expect(providers.length).toBeGreaterThanOrEqual(MAINNET_PLATFORM_MINIMUM_PROVIDER_TARGET);
    expect(new Set(providers.map(({ id }) => id)).size).toBe(providers.length);
    expect(providers.map(({ name }) => name)).toEqual([
      'Aave',
      'Morpho',
      'Compound',
      'Spark',
      'Euler',
      'Moonwell',
      'Venus',
      'Kamino',
      'Save',
      'Project 0',
      'Jupiter',
    ]);
    expect(new Set(providers.map(({ ecosystem }) => ecosystem))).toEqual(
      new Set(['EVM', 'SOLANA']),
    );
    expect(new Set(providers.flatMap(({ networks }) => networks.map(({ id }) => id)))).toEqual(
      new Set(['eip155:1', 'eip155:56', 'eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']),
    );
  });

  it('marks every candidate planned, disconnected, unavailable, and non-executable', () => {
    expect(MAINNET_PLATFORM_DIRECTORY).toMatchObject({
      schemaVersion: 1,
      use: 'MAINNET_PLATFORM_DIRECTORY',
      minimumProviderTarget: 10,
      mayAuthorizeFinancialAction: false,
    });
    for (const provider of MAINNET_PLATFORM_DIRECTORY.providers) {
      expect(provider).toMatchObject({
        integrationStatus: 'PLANNED',
        dataStatus: 'NOT_CONNECTED',
        accessStatus: 'UNAVAILABLE',
        riskStatus: 'NOT_ASSESSED',
        supportedActions: [],
      });
    }
    expect(MAINNET_PLATFORM_DIRECTORY.providers.find(({ id }) => id === 'jupiter')).toMatchObject({
      name: 'Jupiter',
      protocol: 'Jupiter Lend',
      ecosystem: 'SOLANA',
      networks: [
        {
          id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          name: 'Solana',
        },
      ],
      integrationStatus: 'PLANNED',
      dataStatus: 'NOT_CONNECTED',
      accessStatus: 'UNAVAILABLE',
      riskStatus: 'NOT_ASSESSED',
      supportedActions: [],
    });
  });

  it('is recursively immutable and reads without network, testnet, or demo dependencies', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network forbidden'));

    const result = new MainnetPlatformDirectoryService().read();

    expect(result).toBe(MAINNET_PLATFORM_DIRECTORY);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.providers)).toBe(true);
    for (const provider of result.providers) {
      expect(Object.isFrozen(provider)).toBe(true);
      expect(Object.isFrozen(provider.networks)).toBe(true);
      expect(Object.isFrozen(provider.supportedActions)).toBe(true);
      expect(provider.networks.every((network) => Object.isFrozen(network))).toBe(true);
    }
    expect(JSON.stringify(result)).not.toMatch(
      /local-demo|testnet|apy|yieldRate|marketId|contractAddress|transaction/iu,
    );

    fetchSpy.mockRestore();
  });
});
