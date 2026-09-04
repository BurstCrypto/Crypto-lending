import { AccountsModule } from './accounts/accounts.module';
import { AppModule } from './app.module';
import { isLocalHarnessEnvironment, loadApplicationRootModule } from './application-root';
import { BlockchainModule } from './blockchain/blockchain.module';
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
});
