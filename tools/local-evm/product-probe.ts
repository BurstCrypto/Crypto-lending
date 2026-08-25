import { parseAccountId, type AccountId } from '../../apps/api/src/accounts/domain/account-profile';
import { LOCAL_EVM_DEVELOPMENT_MANIFEST } from '../../apps/api/src/blockchain/domain/local-evm-development';
import { LocalDemoPortfolioService } from '../../apps/api/src/local-demo/local-demo-portfolio.service';
import { LoopbackLocalEvmChainRuntime } from '../../apps/api/src/local-demo/local-evm-chain.runtime';
import type {
  LocalDemoWalletConnection,
  LocalDemoWalletService,
} from '../../apps/api/src/local-demo/local-demo-wallet.service';

const accountId = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const controlLaunchId = requiredControlCredential('LOCAL_EVM_CONTROL_LAUNCH_ID', /^[0-9a-f]{32}$/u);
const controlCapability = requiredControlCredential(
  'LOCAL_EVM_CONTROL_CAPABILITY',
  /^[0-9a-f]{64}$/u,
);
const wallet: LocalDemoWalletConnection = Object.freeze({
  connectionId: '11111111-1111-4111-8111-111111111111',
  walletId: '11111111-1111-4111-8111-111111111111',
  label: 'Synthetic EVM wallet',
  namespace: 'EVM',
  chainId: 'eip155:11155111',
  address: '0x1111111111111111111111111111111111111111',
  registeredAt: '2026-08-24T18:00:00.000Z',
});
const wallets = {
  list: (requestedAccountId: AccountId) =>
    requestedAccountId === accountId ? Object.freeze([wallet]) : Object.freeze([]),
} as unknown as LocalDemoWalletService;
const runtime = new LoopbackLocalEvmChainRuntime(
  Object.freeze({
    mode: 'enabled',
    apiHost: '127.0.0.1',
    publicOrigin: 'http://127.0.0.1:3000',
    localEvmRpcUrl: LOCAL_EVM_DEVELOPMENT_MANIFEST.rpc.url,
    localEvmControl: Object.freeze({
      url: 'http://127.0.0.1:18546/control',
      launchId: controlLaunchId,
      capability: controlCapability,
    }),
  }),
);
const service = new LocalDemoPortfolioService(wallets, runtime);
const correlation = {
  correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const portfolio = await service.read(accountId, correlation);
const initialBlock = (await runtime.readSourceBlock({
  expectedNetworkId: LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId,
  selector: 'latest',
})) as { readonly number: string; readonly hash: string };
await runtime.seedWalletBalances(
  Object.freeze([Object.freeze({ walletAddress: wallet.address, balanceAtomic: '1234500000' })]),
);
const updatedPortfolio = await service.read(accountId, correlation);
const updatedBlock = (await runtime.readSourceBlock({
  expectedNetworkId: LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId,
  selector: 'latest',
})) as { readonly number: string; readonly hash: string };
const chain = portfolio.wallets[0]?.chains[0];
const asset = chain?.assets[0];
const updatedAsset = updatedPortfolio.wallets[0]?.chains[0]?.assets[0];
if (
  portfolio.portfolioValueUsdMinor !== '700000' ||
  chain?.networkId !== LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId ||
  asset?.assetIdentity !== LOCAL_EVM_DEVELOPMENT_MANIFEST.assets[0]?.contractAddress ||
  asset.amountAtomic !== '7000000000' ||
  portfolio.mayAuthorizeFinancialAction !== false ||
  updatedAsset?.amountAtomic !== '1234500000' ||
  updatedPortfolio.portfolioValueUsdMinor !== '123450' ||
  updatedPortfolio.snapshotId === portfolio.snapshotId ||
  BigInt(updatedBlock.number) <= BigInt(initialBlock.number) ||
  updatedBlock.hash === initialBlock.hash
) {
  throw new Error('Local EVM product probe failed');
}
process.stdout.write(
  `${JSON.stringify({
    runtimeIdentity: LOCAL_EVM_DEVELOPMENT_MANIFEST.runtimeIdentity,
    networkId: chain.networkId,
    stablecoin: asset.stablecoin,
    initialAmountAtomic: asset.amountAtomic,
    updatedAmountAtomic: updatedAsset.amountAtomic,
    updatedPortfolioValueUsdMinor: updatedPortfolio.portfolioValueUsdMinor,
    sourceBlockAdvanced: true,
    portfolioSnapshotChanged: true,
    mayAuthorizeFinancialAction: portfolio.mayAuthorizeFinancialAction,
  })}\n`,
);

function requiredControlCredential(name: string, pattern: RegExp): string {
  const value = process.env[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Missing valid ${name}`);
  }
  return value;
}
