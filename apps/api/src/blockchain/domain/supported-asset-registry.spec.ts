import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  TESTNET_SUPPORTED_ASSET_REGISTRY,
  SupportedAssetRegistryValidationError,
  createSupportedAssetRegistrySnapshot,
  createVersionedSupportedAssetRegistry,
  supportedAssetRegistryForEnvironment,
  type StablecoinAssetDefinition,
  type SupportedAssetRegistrySnapshot,
  type SupportedAssetRegistrySnapshotDefinition,
  type SupportedNetworkDefinition,
} from './supported-asset-registry';

function snapshotDefinition(
  snapshot: SupportedAssetRegistrySnapshot,
): SupportedAssetRegistrySnapshotDefinition {
  return {
    version: snapshot.version,
    environment: snapshot.environment,
    networks: snapshot.networks.map(({ chain, networkId, activationState }) => ({
      chain,
      networkId,
      activationState,
    })),
    assets: snapshot.assets.map(
      ({ stablecoin, chain, networkId, identity, decimals, activationState }) => ({
        stablecoin,
        chain,
        networkId,
        identity,
        decimals,
        activationState,
      }),
    ),
  };
}

function expectValidationCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error('expected registry validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(SupportedAssetRegistryValidationError);
    expect((error as SupportedAssetRegistryValidationError).code).toBe(code);
  }
}

describe('supported stablecoin registry', () => {
  const mainnet = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const testnet = TESTNET_SUPPORTED_ASSET_REGISTRY.latest;

  it('publishes immutable version 1 snapshots for all four environment-qualified networks', () => {
    expect(MAINNET_SUPPORTED_ASSET_REGISTRY.versions).toEqual([1]);
    expect(TESTNET_SUPPORTED_ASSET_REGISTRY.versions).toEqual([1]);
    expect(mainnet.networks.map(({ chain, networkId }) => [chain, networkId])).toEqual([
      ['ETHEREUM', 'eip155:1'],
      ['BASE', 'eip155:8453'],
      ['ARBITRUM', 'eip155:42161'],
      ['SOLANA', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
    ]);
    expect(testnet.networks.map(({ chain, networkId }) => [chain, networkId])).toEqual([
      ['ETHEREUM', 'eip155:11155111'],
      ['BASE', 'eip155:84532'],
      ['ARBITRUM', 'eip155:421614'],
      ['SOLANA', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
    ]);
    expect(Object.isFrozen(mainnet)).toBe(true);
    expect(Object.isFrozen(mainnet.networks)).toBe(true);
    expect(Object.isFrozen(mainnet.assets)).toBe(true);
    expect(mainnet.assets.every(Object.isFrozen)).toBe(true);
  });

  it('contains only issuer-verified mainnet identities with exact decimals', () => {
    expect(
      mainnet.assets.map(({ stablecoin, networkId, identity, decimals, activationState }) => ({
        stablecoin,
        networkId,
        identity,
        decimals,
        activationState,
      })),
    ).toEqual([
      {
        stablecoin: 'USDC',
        networkId: 'eip155:1',
        identity: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        decimals: 6,
        activationState: 'ACTIVE',
      },
      {
        stablecoin: 'USDC',
        networkId: 'eip155:8453',
        identity: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        decimals: 6,
        activationState: 'ACTIVE',
      },
      {
        stablecoin: 'USDC',
        networkId: 'eip155:42161',
        identity: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
        decimals: 6,
        activationState: 'ACTIVE',
      },
      {
        stablecoin: 'USDC',
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        identity: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        activationState: 'ACTIVE',
      },
      {
        stablecoin: 'USDT',
        networkId: 'eip155:1',
        identity: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        decimals: 6,
        activationState: 'ACTIVE',
      },
      {
        stablecoin: 'USDT',
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        identity: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        decimals: 6,
        activationState: 'ACTIVE',
      },
      {
        stablecoin: 'PYUSD',
        networkId: 'eip155:1',
        identity: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
        decimals: 6,
        activationState: 'ACTIVE',
      },
      {
        stablecoin: 'PYUSD',
        networkId: 'eip155:42161',
        identity: '0x46850ad61c2b7d64d08c9c754f45254596696984',
        decimals: 6,
        activationState: 'ACTIVE',
      },
      {
        stablecoin: 'PYUSD',
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        identity: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
        decimals: 6,
        activationState: 'ACTIVE',
      },
    ]);
  });

  it('uses only verified USDC and PYUSD test identities and never aliases mainnet', () => {
    expect(
      testnet.assets.map(({ stablecoin, networkId, identity }) => [
        stablecoin,
        networkId,
        identity,
      ]),
    ).toEqual([
      ['USDC', 'eip155:11155111', '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'],
      ['USDC', 'eip155:84532', '0x036cbd53842c5426634e7929541ec2318f3dcf7e'],
      ['USDC', 'eip155:421614', '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d'],
      [
        'USDC',
        'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      ],
      ['PYUSD', 'eip155:11155111', '0xcac524bca292aaade2df8a05cc58f0a65b1b3bb9'],
      ['PYUSD', 'eip155:421614', '0x637a1259c6afd7e3adf63993ca7e58bb438ab1b1'],
      [
        'PYUSD',
        'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM',
      ],
    ]);
    expect(testnet.assets.every(({ decimals }) => decimals === 6)).toBe(true);
    expect(testnet.assets.filter(({ stablecoin }) => stablecoin === 'USDT')).toHaveLength(0);
    expect(
      testnet.normalizeAsset('eip155:11155111', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')
        ?.stablecoin,
    ).toBe('USDC');
    expect(
      testnet.normalizeAsset(
        'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        'CXk2AMBfi3TwaEL2468s6zP8xq9NxTXjp9gjMgzeUynM',
      )?.stablecoin,
    ).toBe('PYUSD');
    expect(
      testnet.normalizeAsset('eip155:11155111', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
    ).toBeUndefined();
  });

  it('normalizes only a configured active network-qualified identity', () => {
    expect(
      mainnet.normalizeAsset('eip155:1', '0xA0b86991c6218b36c1D19D4A2E9eB0cE3606eB48'),
    ).toMatchObject({
      stablecoin: 'USDC',
      issuer: 'CIRCLE',
      chain: 'ETHEREUM',
      networkId: 'eip155:1',
      decimals: 6,
      registryVersion: 1,
    });
    expect(
      mainnet.normalizeAsset('eip155:8453', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
    ).toBeUndefined();
    expect(
      mainnet.normalizeAsset('eip155:1', '0x0000000000000000000000000000000000000001'),
    ).toBeUndefined();
    expect(mainnet.normalizeAsset('eip155:1', 'USDC')).toBeUndefined();
    expect(mainnet.normalizeAsset('eip155:999', mainnet.assets[0]!.identity)).toBeUndefined();
  });

  it('retains configured inactive identity metadata without normalizing it as supported', () => {
    const definition = snapshotDefinition(mainnet);
    const firstAsset = definition.assets[0]!;
    const inactive = createSupportedAssetRegistrySnapshot({
      ...definition,
      assets: [{ ...firstAsset, activationState: 'INACTIVE' }, ...definition.assets.slice(1)],
    });

    expect(inactive.identifyAsset(firstAsset.networkId, firstAsset.identity)).toMatchObject({
      stablecoin: 'USDC',
      activationState: 'INACTIVE',
    });
    expect(inactive.normalizeAsset(firstAsset.networkId, firstAsset.identity)).toBeUndefined();
  });

  it('rejects duplicate networks and duplicate asset identities', () => {
    const definition = snapshotDefinition(mainnet);
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          networks: [...definition.networks, definition.networks[0]!],
        }),
      'DUPLICATE_NETWORK',
    );
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          assets: [...definition.assets, definition.assets[0]!],
        }),
      'DUPLICATE_ASSET',
    );
  });

  it('rejects invalid, unverified, mislabeled, and wrong-network identities', () => {
    const definition = snapshotDefinition(mainnet);
    const ethereumUsdc = definition.assets[0]!;
    const replaceFirst = (
      asset: StablecoinAssetDefinition,
    ): readonly StablecoinAssetDefinition[] => [asset, ...definition.assets.slice(1)];

    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          assets: replaceFirst({ ...ethereumUsdc, identity: 'USDC' }),
        }),
      'INVALID_IDENTITY',
    );
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          assets: replaceFirst({
            ...ethereumUsdc,
            identity: '0x0000000000000000000000000000000000000001',
          }),
        }),
      'UNVERIFIED_IDENTITY',
    );
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          assets: replaceFirst({ ...ethereumUsdc, stablecoin: 'USDT' }),
        }),
      'IDENTITY_STABLECOIN_MISMATCH',
    );
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          assets: replaceFirst({
            ...ethereumUsdc,
            chain: 'BASE',
            networkId: 'eip155:8453',
          }),
        }),
      'WRONG_NETWORK',
    );
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          assets: replaceFirst({
            ...ethereumUsdc,
            identity: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
          }),
        }),
      'WRONG_NETWORK',
    );
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          assets: replaceFirst({ ...ethereumUsdc, decimals: 18 }),
        }),
      'INVALID_DECIMALS',
    );
  });

  it('rejects malformed Solana mint identities before issuer lookup', () => {
    const definition = snapshotDefinition(mainnet);
    const solanaUsdcIndex = definition.assets.findIndex(
      ({ stablecoin, chain }) => stablecoin === 'USDC' && chain === 'SOLANA',
    );
    const solanaUsdc = definition.assets[solanaUsdcIndex]!;
    const malformedIdentities = [
      '11111111111111111111111111111111',
      '0PjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'short',
    ];

    for (const identity of malformedIdentities) {
      const assets = [...definition.assets];
      assets[solanaUsdcIndex] = { ...solanaUsdc, identity };
      expectValidationCode(
        () => createSupportedAssetRegistrySnapshot({ ...definition, assets }),
        'INVALID_IDENTITY',
      );
    }
  });

  it('rejects missing targets, wrong environment networks, and active assets on inactive networks', () => {
    const definition = snapshotDefinition(mainnet);
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          networks: definition.networks.slice(1),
        }),
      'MISSING_TARGET_NETWORK',
    );
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          networks: [
            { ...definition.networks[0]!, networkId: 'eip155:11155111' },
            ...definition.networks.slice(1),
          ],
        }),
      'WRONG_NETWORK',
    );

    const ethereumNetwork: SupportedNetworkDefinition = {
      ...definition.networks[0]!,
      activationState: 'INACTIVE',
    };
    expectValidationCode(
      () =>
        createSupportedAssetRegistrySnapshot({
          ...definition,
          networks: [ethereumNetwork, ...definition.networks.slice(1)],
        }),
      'ACTIVE_ASSET_ON_INACTIVE_NETWORK',
    );
  });

  it('requires an explicit contiguous immutable version history per environment', () => {
    const mainnetDefinition = snapshotDefinition(mainnet);
    const testnetDefinition = snapshotDefinition(testnet);
    expectValidationCode(() => createVersionedSupportedAssetRegistry([]), 'EMPTY_REGISTRY_HISTORY');
    expectValidationCode(
      () =>
        createVersionedSupportedAssetRegistry([
          mainnetDefinition,
          { ...mainnetDefinition, version: 3 },
        ]),
      'NON_SEQUENTIAL_REGISTRY_VERSION',
    );
    expectValidationCode(
      () => createVersionedSupportedAssetRegistry([mainnetDefinition, testnetDefinition]),
      'MIXED_REGISTRY_ENVIRONMENTS',
    );
    const versionTwo = {
      ...mainnetDefinition,
      version: 2,
      assets: [
        { ...mainnetDefinition.assets[0]!, activationState: 'INACTIVE' as const },
        ...mainnetDefinition.assets.slice(1),
      ],
    };
    const history = createVersionedSupportedAssetRegistry([mainnetDefinition, versionTwo]);
    expect(history.versions).toEqual([1, 2]);
    expect(history.atVersion(1)?.assets[0]?.activationState).toBe('ACTIVE');
    expect(history.latest.assets[0]?.activationState).toBe('INACTIVE');
    expect(supportedAssetRegistryForEnvironment('MAINNET')).toBe(mainnet);
    expect(supportedAssetRegistryForEnvironment('TESTNET', 1)).toBe(testnet);
    expectValidationCode(
      () => supportedAssetRegistryForEnvironment('MAINNET', 2),
      'UNKNOWN_REGISTRY_VERSION',
    );
  });
});
