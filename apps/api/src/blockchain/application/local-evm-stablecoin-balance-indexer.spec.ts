import { EvmStablecoinBalanceIndexer } from './evm-stablecoin-balance-indexer';
import type { EvmStablecoinBalanceIndexerError } from './evm-stablecoin-balance-indexer';
import type {
  EvmBalanceRetrySchedulerPort,
  EvmStablecoinBalanceReaderPort,
  EvmStablecoinPositionStorePort,
  EvmTokenBalanceBatchReadRequest,
} from './ports/evm-stablecoin-balance-indexer.ports';
import { LOCAL_EVM_DEVELOPMENT_MANIFEST } from '../domain/local-evm-development';

const wallet = '0x1111111111111111111111111111111111111111';
const block = Object.freeze({
  number: '0',
  hash: `0x${'ab'.repeat(32)}`,
  parentHash: `0x${'00'.repeat(32)}`,
});

class LocalReader implements EvmStablecoinBalanceReaderPort {
  async readChainIdentity(): Promise<unknown> {
    return LOCAL_EVM_DEVELOPMENT_MANIFEST.chainIdHex;
  }

  async readSourceBlock(): Promise<unknown> {
    return block;
  }

  async readTokenBalances(request: EvmTokenBalanceBatchReadRequest): Promise<unknown> {
    return {
      sourceBlockNumber: request.sourceBlock.number,
      sourceBlockHash: request.sourceBlock.hash,
      balances: request.contractAddresses.map((contractAddress) => ({
        contractAddress,
        balanceAtomic: '7654321',
      })),
    };
  }
}

const store: EvmStablecoinPositionStorePort = {
  upsertWalletSnapshot: jest.fn(async () => 'CREATED'),
};
const scheduler: EvmBalanceRetrySchedulerPort = {
  nextJitterMs: () => 0,
  wait: async () => undefined,
};

describe('local EVM stablecoin indexing', () => {
  it('indexes the separate LOCAL registry without aliasing a public network', async () => {
    const indexer = new EvmStablecoinBalanceIndexer(
      { environment: 'LOCAL', networkId: 'eip155:31337', maxAttempts: 1 },
      new LocalReader(),
      store,
      scheduler,
    );
    const snapshot = await indexer.indexWallet({ walletAddress: wallet });
    expect(snapshot).toMatchObject({
      environment: 'LOCAL',
      networkId: 'eip155:31337',
      registryFingerprintSha256: '3584658754837a75ca0bcb727035c38e382db89641e55311f57f862dee3278dc',
      positions: [
        {
          environment: 'LOCAL',
          stablecoin: 'USDC',
          contractAddress: '0x0000000000000000000000000000000000000101',
          balanceAtomic: '7654321',
          authority: 'DISPLAY_ONLY',
        },
      ],
    });
  });

  it('rejects attempts to treat the LOCAL chain as TESTNET', () => {
    expect(
      () =>
        new EvmStablecoinBalanceIndexer(
          { environment: 'TESTNET', networkId: 'eip155:31337' },
          new LocalReader(),
          store,
          scheduler,
        ),
    ).toThrow(
      expect.objectContaining({
        code: 'UNSUPPORTED_EVM_NETWORK',
      }) as EvmStablecoinBalanceIndexerError,
    );
  });
});
