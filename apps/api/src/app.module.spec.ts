import { AccountsModule } from './accounts/accounts.module';
import { AppModule } from './app.module';
import { isLocalHarnessEnvironment, loadApplicationRootModule } from './application-root';
import { BlockchainModule } from './blockchain/blockchain.module';
import { MAINNET_LAUNCH_NETWORK_IDS } from './blockchain/domain/mainnet-launch-network-policy';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { MainnetPlatformsModule } from './mainnet-platforms/mainnet-platforms.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { SmartLendingModule } from './smart-lending/smart-lending.module';
import { SystemModule } from './system/system.module';
import { WalletsModule } from './wallets/wallets.module';
import productionOpenApi from '../openapi.json';

const PRODUCTION_MODULES = [
  InfrastructureModule,
  AccountsModule,
  BlockchainModule,
  WalletsModule,
  PortfolioModule,
  MainnetPlatformsModule,
  SmartLendingModule,
  SystemModule,
];

const FORBIDDEN_PRODUCTION_NETWORK_IDS = Object.freeze([
  'eip155:56',
  'eip155:8453',
  'eip155:42161',
  'eip155:11155111',
  'eip155:84532',
  'eip155:421614',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  'solana:devnet',
  'solana:testnet',
]);

function collectContractStrings(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectContractStrings);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...collectContractStrings(nested)]);
}

function collectNamedPropertySchemas(
  value: unknown,
  propertyName: string,
): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectNamedPropertySchemas(item, propertyName));
  }
  if (value === null || typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  const properties = record.properties;
  const ownSchema =
    properties !== null && typeof properties === 'object' && !Array.isArray(properties)
      ? (properties as Record<string, unknown>)[propertyName]
      : undefined;
  return [
    ...(ownSchema !== null && typeof ownSchema === 'object' && !Array.isArray(ownSchema)
      ? [ownSchema as Record<string, unknown>]
      : []),
    ...Object.values(record).flatMap((nested) => collectNamedPropertySchemas(nested, propertyName)),
  ];
}

describe('application module runtime surface', () => {
  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['unset', {}],
    ['empty', { NODE_ENV: '' }],
    ['case variant', { NODE_ENV: 'Production' }],
    ['whitespace variant', { NODE_ENV: ' production ' }],
    ['unexpected', { NODE_ENV: 'staging' }],
  ] as const)('uses the production-safe root for %s NODE_ENV', async (_label, environment) => {
    expect(isLocalHarnessEnvironment(environment)).toBe(false);
    await expect(loadApplicationRootModule(environment)).resolves.toBe(AppModule);
  });

  it.each(['development', 'test'] as const)(
    'loads the isolated local harness root only for exact %s NODE_ENV',
    async (nodeEnvironment) => {
      expect(isLocalHarnessEnvironment({ NODE_ENV: nodeEnvironment })).toBe(true);
      const rootModule = await loadApplicationRootModule({ NODE_ENV: nodeEnvironment });
      expect(rootModule.name).toBe('LocalDevelopmentAppModule');
      expect(rootModule).not.toBe(AppModule);
    },
  );

  it('declares only production modules on the production root', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown;
    expect(imports).toEqual(PRODUCTION_MODULES);
    expect((imports as { readonly name?: string }[]).map((item) => item.name)).not.toEqual(
      expect.arrayContaining(['LocalDemoModule', 'PublicTestnetModule', 'EvmPublicTestnetModule']),
    );
  });

  it('keeps local-demo and public-testnet paths out of the checked-in production contract', () => {
    const paths = Object.keys(productionOpenApi.paths);
    const solanaPublicTestnetPaths = paths.filter(
      (path) =>
        path.startsWith('/api/v1/public-testnet') && !path.startsWith('/api/v1/public-testnet/evm'),
    );
    const evmPublicTestnetPaths = paths.filter((path) =>
      path.startsWith('/api/v1/public-testnet/evm'),
    );

    expect(paths).not.toContainEqual(expect.stringMatching(/^\/api\/v1\/local-demo(?:\/|$)/u));
    expect(solanaPublicTestnetPaths).toEqual([]);
    expect(evmPublicTestnetPaths).toEqual([]);
  });

  it('recursively limits the checked-in production contract to Ethereum and Solana mainnet', () => {
    const contractStrings = collectContractStrings(productionOpenApi);
    const forbiddenLabels = contractStrings.filter((value) =>
      /\b(?:TESTNET|Base|Arbitrum|BNB)\b/u.test(value),
    );
    const forbiddenNetworkIds = contractStrings.filter((value) =>
      FORBIDDEN_PRODUCTION_NETWORK_IDS.includes(value),
    );

    expect(forbiddenLabels).toEqual([]);
    expect(forbiddenNetworkIds).toEqual([]);

    const expectedNetworkIds = [...MAINNET_LAUNCH_NETWORK_IDS];
    const chainIdSchemas = collectNamedPropertySchemas(productionOpenApi, 'chainId');
    const networkIdSchemas = collectNamedPropertySchemas(productionOpenApi, 'networkId');
    const registryEnvironmentSchemas = collectNamedPropertySchemas(
      productionOpenApi,
      'registryEnvironment',
    );

    expect(chainIdSchemas).toHaveLength(2);
    expect(networkIdSchemas).toHaveLength(5);
    expect(registryEnvironmentSchemas).toHaveLength(2);
    for (const schema of [...chainIdSchemas, ...networkIdSchemas]) {
      expect(schema.enum).toEqual(expectedNetworkIds);
    }
    for (const schema of registryEnvironmentSchemas) {
      expect(schema.enum).toEqual(['MAINNET']);
    }
  });
});
