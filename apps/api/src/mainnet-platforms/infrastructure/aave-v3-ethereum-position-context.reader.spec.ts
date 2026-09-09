import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  reviewBalanceSyncExecutionContext,
  type BalanceSyncCheckpoint,
  type BalanceSyncExecutionContext,
} from '../../blockchain-sync/application/ports/balance-sync.ports';
import { PostgresBalanceSyncCheckpointRepository } from '../../blockchain-sync/infrastructure/postgres/postgres-balance-sync-checkpoint.repository';
import { PostgresBalanceSyncWalletAddressResolver } from '../../blockchain-sync/infrastructure/postgres/postgres-balance-sync-wallet-address.resolver';
import { NodeHttpsBalanceJsonRpcTransport } from '../../blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport';
import type { PostgresService } from '../../infrastructure/database/postgres.service';
import type { WalletRegistrationKeyRing } from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import {
  AaveV3EthereumPositionContextReader,
  createPostgresAaveV3EthereumPositionSource,
} from './aave-v3-ethereum-position-context.reader';
import {
  AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
  type ReadAaveV3EthereumDurableTargetContextRequestV1 as Request,
} from './dormant-aave-v3-ethereum-provider-position.source';

const NOW = Date.parse('2026-09-08T18:00:00.000Z');
const ACCOUNT = parseAccountId('11111111-1111-4111-8111-111111111111');
const WALLET = '22222222-2222-4222-8222-222222222222';
const ADDRESS = `0x${'a'.repeat(40)}`;
const BLOCK_HASH = `0x${'1'.repeat(64)}`;
const SCOPE = { accountId: ACCOUNT, walletId: WALLET, networkId: 'eip155:1' as const };
const FAILURE = {
  code: 'AAVE_V3_ETHEREUM_POSITION_CONTEXT_UNAVAILABLE',
  message: 'Aave V3 Ethereum wallet context is unavailable.',
};

function request(overrides: Record<string, unknown> = {}): Request {
  return {
    contextVersion: 1,
    use: AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    ...SCOPE,
    correlationId: 'context-read',
    sourceFamilyId: 'rpc-operator-a',
    sourceId: 'rpc-a',
    deadlineAt: new Date(NOW + 25_000).toISOString(),
    signal: new AbortController().signal,
    ...overrides,
  } as Request;
}
function checkpoint(overrides: Partial<BalanceSyncCheckpoint> = {}): BalanceSyncCheckpoint {
  return {
    revision: 1,
    scope: { ...SCOPE },
    currentObservation: null,
    lastFinalizedSource: {
      position: '100',
      hash: BLOCK_HASH,
      parentHash: `0x${'2'.repeat(64)}`,
      selector: 'finalized',
      retrievedAt: new Date(NOW - 10_000).toISOString(),
    },
    freshness: 'CURRENT',
    staleSince: null,
    lastFailureCode: null,
    ...overrides,
  };
}
function fixture(): {
  reader: AaveV3EthereumPositionContextReader;
  resolve: jest.Mock<Promise<unknown>, [unknown, BalanceSyncExecutionContext]>;
  load: jest.Mock<Promise<BalanceSyncCheckpoint | null>, [unknown, BalanceSyncExecutionContext]>;
  order: string[];
} {
  const order: string[] = [];
  const resolve = jest.fn(
    async (_scope: unknown, execution: BalanceSyncExecutionContext): Promise<unknown> => {
      order.push('wallet');
      expect(reviewBalanceSyncExecutionContext(execution)?.abortKind).toBe(null);
      return ADDRESS;
    },
  );
  const load = jest.fn(
    async (
      _scope: unknown,
      execution: BalanceSyncExecutionContext,
    ): Promise<BalanceSyncCheckpoint | null> => {
      order.push('checkpoint');
      expect(reviewBalanceSyncExecutionContext(execution)?.abortKind).toBe(null);
      return checkpoint();
    },
  );
  const reader = new AaveV3EthereumPositionContextReader(
    { resolveActiveAddress: resolve },
    { load },
  );
  return { reader, resolve, load, order };
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Aave Ethereum durable wallet context', () => {
  it('resolves active ownership before and after reading a durable finalized checkpoint', async () => {
    const test = fixture();
    const input = request();
    const result = await test.reader.readContext(input);
    expect(test.order).toEqual(['wallet', 'checkpoint', 'wallet']);
    expect(result).toMatchObject({
      accountId: ACCOUNT,
      walletId: WALLET,
      walletAddress: ADDRESS,
      networkId: 'eip155:1',
      continuityFloor: { kind: 'EVM_BLOCK', blockNumber: '100', blockHash: BLOCK_HASH },
      contextSourceFamilyId: 'durable-postgres',
      contextSourceId: 'aave-wallet-checkpoint',
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
    });
    expect(Object.isFrozen(result.continuityFloor)).toBe(true);
    const execution = test.resolve.mock.calls[0]![1];
    expect(test.load).toHaveBeenCalledWith(SCOPE, execution);
    expect(test.resolve).toHaveBeenLastCalledWith(SCOPE, execution);
    expect(execution.signal.aborted).toBe(true);
    expect(test.reader.verifyContext(result, input)).toBe(true);
    expect(test.reader.verifyContext({ ...result }, input)).toBe(false);
    expect(test.reader.verifyContext(result, { ...input })).toBe(false);
    expect(fixture().reader.verifyContext(result, input)).toBe(false);
  });

  it.each([
    null,
    checkpoint({ lastFinalizedSource: null }),
    checkpoint({ freshness: 'STALE' }),
    checkpoint({ freshness: 'UNAVAILABLE' }),
    checkpoint({ freshness: 'QUARANTINED' }),
    checkpoint({ revision: 0 }),
    checkpoint({ scope: { ...SCOPE, walletId: '44444444-4444-4444-8444-444444444444' } }),
  ])('rejects missing, unavailable or misbound checkpoints %#', async (stored) => {
    const test = fixture();
    test.load.mockResolvedValue(stored);
    await expect(test.reader.readContext(request())).rejects.toMatchObject(FAILURE);
    expect(test.resolve).toHaveBeenCalledTimes(1);
  });

  it.each([
    { selector: 'latest' },
    { hash: `0x${'0'.repeat(64)}` },
    { hash: 'malformed' },
    { position: '0100' },
    { position: '18446744073709551616' },
    { retrievedAt: new Date(NOW + 1).toISOString() },
  ])('rejects an invalid finalized floor %#', async (changes) => {
    const test = fixture();
    test.load.mockResolvedValue(
      checkpoint({
        lastFinalizedSource: { ...checkpoint().lastFinalizedSource!, ...changes } as NonNullable<
          BalanceSyncCheckpoint['lastFinalizedSource']
        >,
      }),
    );
    await expect(test.reader.readContext(request())).rejects.toMatchObject(FAILURE);
  });

  it.each([
    { networkId: 'eip155:8453' },
    { mayPersist: true },
    { mayAuthorizeFinancialAction: true },
    { sourceFamilyId: 'durable-postgres' },
    { sourceId: 'aave-wallet-checkpoint' },
    { extra: true },
    { deadlineAt: new Date(NOW).toISOString() },
  ])('rejects invalid requests before database access %#', async (changes) => {
    const test = fixture();
    await expect(test.reader.readContext(request(changes))).rejects.toMatchObject(FAILURE);
    expect(test.resolve).not.toHaveBeenCalled();
    expect(test.load).not.toHaveBeenCalled();
  });

  it('rejects zero, wrong-chain and revoked wallets and checks ownership again after a checkpoint', async () => {
    for (const address of [null, `0x${'0'.repeat(40)}`, 'not-an-ethereum-address']) {
      const test = fixture();
      test.resolve.mockResolvedValue(address);
      await expect(test.reader.readContext(request())).rejects.toMatchObject(FAILURE);
      expect(test.load).not.toHaveBeenCalled();
    }
    const revoked = fixture();
    revoked.resolve.mockResolvedValueOnce(ADDRESS).mockRejectedValueOnce(new Error('revoked'));
    await expect(revoked.reader.readContext(request())).rejects.toMatchObject(FAILURE);
    expect(revoked.resolve).toHaveBeenCalledTimes(2);
    const changed = fixture();
    changed.resolve.mockResolvedValueOnce(ADDRESS).mockResolvedValueOnce(`0x${'b'.repeat(40)}`);
    await expect(changed.reader.readContext(request())).rejects.toMatchObject(FAILURE);
  });

  it('does not invoke accessor-backed request or checkpoint fields', async () => {
    const test = fixture();
    const getter = jest.fn();
    const input = request();
    Object.defineProperty(input, 'walletId', { enumerable: true, get: getter });
    await expect(test.reader.readContext(input)).rejects.toMatchObject(FAILURE);
    const stored = checkpoint();
    Object.defineProperty(stored, 'lastFinalizedSource', { enumerable: true, get: getter });
    test.load.mockResolvedValue(stored);
    await expect(test.reader.readContext(request())).rejects.toMatchObject(FAILURE);
    expect(getter).not.toHaveBeenCalled();
  });

  it('permanently invalidates expired or altered context proofs', async () => {
    const test = fixture();
    const input = request();
    const result = await test.reader.readContext(input);
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 25_000);
    expect(test.reader.verifyContext(result, input)).toBe(false);
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(test.reader.verifyContext(result, input)).toBe(false);
    const next = request();
    const nextResult = await test.reader.readContext(next);
    (next as unknown as Record<string, unknown>).correlationId = 'changed';
    expect(test.reader.verifyContext(nextResult, next)).toBe(false);
  });

  it.each(['caller', 'deadline'] as const)(
    'propagates %s cancellation to accepted database work and drains it',
    async (kind) => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
      const test = fixture();
      const controller = new AbortController();
      let drained = false;
      test.resolve.mockImplementation(
        (_scope, execution) =>
          new Promise((_resolve, reject) => {
            execution.signal.addEventListener(
              'abort',
              () =>
                setTimeout(() => {
                  drained = true;
                  reject(new Error('private database detail'));
                }, 10),
              { once: true },
            );
          }),
      );
      const pending = test.reader.readContext(request({ signal: controller.signal }));
      const checked = expect(pending).rejects.toMatchObject(FAILURE);
      if (kind === 'caller') controller.abort();
      else await jest.advanceTimersByTimeAsync(25_000);
      expect(drained).toBe(false);
      await jest.advanceTimersByTimeAsync(10);
      await checked;
      expect(drained).toBe(true);
      expect(test.load).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('builds the concrete database and HTTPS composition without starting any work', () => {
    const database = { queryWithCancellation: jest.fn() } as unknown as PostgresService;
    const resolve = jest.spyOn(
      PostgresBalanceSyncWalletAddressResolver.prototype,
      'resolveActiveAddress',
    );
    const load = jest.spyOn(PostgresBalanceSyncCheckpointRepository.prototype, 'load');
    const exchange = jest.spyOn(NodeHttpsBalanceJsonRpcTransport.prototype, 'exchangeBounded');
    const source = createPostgresAaveV3EthereumPositionSource(
      database,
      { mode: 'enabled', walletMetadataSealKeys: {} as WalletRegistrationKeyRing<'metadata-seal'> },
      { sourceFamilyId: 'rpc-operator-a', sourceId: 'rpc-a' },
      {
        networkId: 'eip155:1',
        hostname: 'rpc.vendor.dev',
        path: '/rpc',
        credential: { kind: 'NONE' },
      },
    );
    expect(typeof source.readTarget).toBe('function');
    expect(resolve).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
    expect(() =>
      createPostgresAaveV3EthereumPositionSource(
        database,
        { mode: 'disabled' },
        { sourceFamilyId: 'rpc-operator-a', sourceId: 'rpc-a' },
        {
          networkId: 'eip155:1',
          hostname: 'rpc.vendor.dev',
          path: '/rpc',
          credential: { kind: 'NONE' },
        },
      ),
    ).toThrow();
  });
});
