import { decodeFunctionData, keccak256, stringToHex, type Address, type Hex } from 'viem';

import { parseAccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import type { LocalDemoAllocationService } from '../local-demo/local-demo-allocation.service';
import {
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX,
  EVM_PUBLIC_TESTNET_RPC_ENDPOINT,
  EVM_PUBLIC_TESTNET_WETH_GATEWAY,
} from './evm-public-testnet.constants';
import type { EvmPublicTestnetExecutionConfig } from './evm-public-testnet.config';
import {
  EvmPublicTestnetTransactionReplacedError,
  EvmPublicTestnetTransactionRevertedError,
  type EvmPublicTestnetExecutionRpc,
  type EvmPublicTestnetPositionObservation,
  type EvmPublicTestnetPreflightObservation,
  type EvmPublicTestnetTransactionObservation,
} from './evm-public-testnet.rpc';
import {
  EvmPublicTestnetExecutionService,
  EvmPublicTestnetIntentConflictError,
  type EvmPublicTestnetIntentRequest,
} from './evm-public-testnet.service';

const DEPOSIT_ETH_ABI = [
  {
    type: 'function',
    name: 'depositETH',
    stateMutability: 'payable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
] as const;

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const OTHER_ACCOUNT_ID = parseAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;
const SNAPSHOT = 'local-demo-portfolio:0123456789abcdef0123456789abcdef';
const HASH = `0x${'ab'.repeat(32)}` as Hex;
const BLOCK_HASH = `0x${'12'.repeat(32)}` as Hex;
const FINALIZED_HASH = `0x${'34'.repeat(32)}` as Hex;
const CONFIG = Object.freeze({
  mode: 'enabled' as const,
  rpcEndpoint: EVM_PUBLIC_TESTNET_RPC_ENDPOINT,
  requestTimeoutMilliseconds: 7_000 as const,
  responseMaximumBytes: 262_144 as const,
}) satisfies EvmPublicTestnetExecutionConfig;
const CORRELATION: JobCorrelationContext = Object.freeze({
  correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  initiatorActorId: ACCOUNT_ID,
});

function request(): EvmPublicTestnetIntentRequest {
  return Object.freeze({
    portfolioSnapshotId: SNAPSHOT,
    selection: Object.freeze({
      kind: 'PRESET' as const,
      presetId: 'BALANCED' as const,
      liquidReserveBasisPoints: 0,
    }),
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: ACCOUNT,
  });
}

function preflight(nativeBalanceWei = 100_000_000_000_000n): EvmPublicTestnetPreflightObservation {
  return Object.freeze({
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    finalizedBlockNumber: 98n,
    finalizedBlockHash: FINALIZED_HASH,
    nativeBalanceWei,
    nonce: 7n,
    aTokenBalanceAtomic: 10n,
    liquidityRateRay: 20_000_000_000_000_000_000_000_000n,
    observedAt: '2026-08-31T12:00:00.000Z',
  });
}

function transactionObservation(
  status: 'PENDING' | 'CONFIRMED' | 'VERIFIED',
  transactionHash: Hex | null = HASH,
): EvmPublicTestnetTransactionObservation {
  const landed = status !== 'PENDING';
  return Object.freeze({
    status,
    transactionHash,
    blockNumber: landed ? 101n : null,
    blockHash: landed ? BLOCK_HASH : null,
    aTokenBalanceAfterAtomic: landed ? 50_000_000_000_010n : null,
    increaseAtomic: landed ? 50_000_000_000_000n : null,
  });
}

function fixture(nativeBalanceWei?: bigint): {
  readonly service: EvmPublicTestnetExecutionService;
  readonly allocations: { readonly preview: jest.Mock };
  readonly rpc: {
    readonly preflight: jest.Mock;
    readonly readPosition: jest.Mock;
    readonly observeTransaction: jest.Mock;
    readonly recoverTransaction: jest.Mock;
  };
} {
  const allocations = {
    preview: jest.fn(async () => ({
      portfolioSnapshotId: SNAPSHOT,
      selection: { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 0 },
    })),
  };
  const position: EvmPublicTestnetPositionObservation = Object.freeze({
    blockNumber: 110n,
    blockHash: BLOCK_HASH,
    finalizedBlockNumber: 108n,
    finalizedBlockHash: FINALIZED_HASH,
    aTokenBalanceAtomic: 500_000_000_000_000n,
    liquidityRateRay: 20_000_000_000_000_000_000_000_000n,
    observedAt: '2026-08-31T12:01:00.000Z',
  });
  const rpc = {
    preflight: jest.fn(async () => preflight(nativeBalanceWei)),
    readPosition: jest.fn(async () => position),
    observeTransaction: jest.fn(async () => transactionObservation('PENDING')),
    recoverTransaction: jest.fn(async () => transactionObservation('PENDING', null)),
  };
  return {
    allocations,
    rpc,
    service: new EvmPublicTestnetExecutionService(
      allocations as unknown as LocalDemoAllocationService,
      rpc as unknown as EvmPublicTestnetExecutionRpc,
      CONFIG,
    ),
  };
}

describe('EvmPublicTestnetExecutionService', () => {
  it('binds one exact marked depositETH request to the local BALANCED preview', async () => {
    const { service, allocations, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());

    expect(allocations.preview).toHaveBeenCalledWith(
      ACCOUNT_ID,
      CORRELATION,
      SNAPSHOT,
      request().selection,
    );
    expect(rpc.preflight).toHaveBeenCalledWith(ACCOUNT);
    expect(intent.transaction).toEqual(
      expect.objectContaining({
        from: ACCOUNT,
        to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
        value: EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX,
        nonce: '0x7',
        chainId: '0x14a34',
      }),
    );
    const bareCall = intent.transaction.input.slice(0, -64) as Hex;
    const marker = `0x${intent.transaction.input.slice(-64)}`;
    expect(decodeFunctionData({ abi: DEPOSIT_ETH_ABI, data: bareCall })).toEqual({
      functionName: 'depositETH',
      args: [EVM_PUBLIC_TESTNET_POOL, ACCOUNT, 0],
    });
    expect(marker).toBe(
      keccak256(stringToHex(`crypto-lending:base-sepolia-aave-v3-proof:v1:${intent.intentId}`)),
    );
  });

  it('reports fixed faucet readiness without creating or broadcasting a transaction', async () => {
    const { service, rpc } = fixture(99_999_999_999_999n);
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    expect(intent.fundingReadiness).toEqual({
      status: 'NEEDS_BASE_SEPOLIA_ETH',
      nativeBalanceWei: '99999999999999',
      requiredNativeBalanceWei: '100000000000000',
      faucetUrl: 'https://portal.cdp.coinbase.com/products/faucet',
    });
    expect(Object.keys(rpc).sort()).toEqual([
      'observeTransaction',
      'preflight',
      'readPosition',
      'recoverTransaction',
    ]);
  });

  it('supersedes untouched unfunded checks instead of exhausting per-account capacity', async () => {
    const { service } = fixture(99_999_999_999_999n);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await expect(service.createIntent(ACCOUNT_ID, CORRELATION, request())).resolves.toEqual(
        expect.objectContaining({
          fundingReadiness: expect.objectContaining({
            status: 'NEEDS_BASE_SEPOLIA_ETH',
          }) as unknown,
        }),
      );
    }
  });

  it('progresses from pending to confirmed to finalized and permits a later intent', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    rpc.observeTransaction
      .mockResolvedValueOnce(transactionObservation('PENDING'))
      .mockResolvedValueOnce(transactionObservation('CONFIRMED'))
      .mockResolvedValueOnce(transactionObservation('VERIFIED'));

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { transactionHash: HASH }),
    ).resolves.toEqual(expect.objectContaining({ status: 'PENDING', consumed: false }));
    await expect(service.verifySubmission(ACCOUNT_ID, intent.intentId, {})).resolves.toEqual(
      expect.objectContaining({ status: 'CONFIRMED', consumed: true }),
    );
    await expect(service.verifySubmission(ACCOUNT_ID, intent.intentId, {})).resolves.toEqual(
      expect.objectContaining({ status: 'VERIFIED', consumed: true }),
    );
    await expect(service.createIntent(ACCOUNT_ID, CORRELATION, request())).resolves.toEqual(
      expect.objectContaining({ account: ACCOUNT }),
    );
  });

  it('accepts an exact recovery hash after the browser authorization window has closed', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-31T12:00:00.000Z') });
    try {
      const { service, rpc } = fixture();
      const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      jest.advanceTimersByTime(6 * 60 * 1_000);

      await expect(
        service.verifySubmission(ACCOUNT_ID, intent.intentId, { transactionHash: HASH }),
      ).resolves.toEqual(expect.objectContaining({ status: 'PENDING', consumed: false }));
      expect(rpc.observeTransaction).toHaveBeenCalledWith(HASH, expect.any(Object));
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a conflicting hash even after the intent has a cached verified result', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    rpc.observeTransaction.mockResolvedValueOnce(transactionObservation('VERIFIED'));
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { transactionHash: HASH }),
    ).resolves.toEqual(expect.objectContaining({ status: 'VERIFIED' }));

    const conflictingHash = `0x${'cd'.repeat(32)}` as Hex;
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, {
        transactionHash: conflictingHash,
      }),
    ).rejects.toBeInstanceOf(EvmPublicTestnetIntentConflictError);
    expect(rpc.observeTransaction).toHaveBeenCalledTimes(1);
  });

  it('uses hashless read-only recovery and binds an exact discovered transaction', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    rpc.recoverTransaction.mockResolvedValueOnce(transactionObservation('CONFIRMED'));
    await expect(service.verifySubmission(ACCOUNT_ID, intent.intentId, {})).resolves.toEqual(
      expect.objectContaining({
        status: 'CONFIRMED',
        transaction: expect.objectContaining({ transactionHash: HASH }) as unknown,
      }),
    );
    expect(rpc.recoverTransaction).toHaveBeenCalledTimes(1);
    rpc.observeTransaction.mockResolvedValueOnce(transactionObservation('VERIFIED'));
    await expect(service.verifySubmission(ACCOUNT_ID, intent.intentId, {})).resolves.toEqual(
      expect.objectContaining({ status: 'VERIFIED' }),
    );
    expect(rpc.observeTransaction).toHaveBeenCalledWith(HASH, expect.any(Object));
  });

  it('rebinds a missing wallet hash only to an exact landed same-intent replacement', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const replacementHash = `0x${'cd'.repeat(32)}` as Hex;
    rpc.observeTransaction
      .mockResolvedValueOnce(transactionObservation('PENDING'))
      .mockResolvedValueOnce(transactionObservation('CONFIRMED', replacementHash))
      .mockResolvedValueOnce(transactionObservation('VERIFIED', replacementHash));

    await service.verifySubmission(ACCOUNT_ID, intent.intentId, { transactionHash: HASH });
    await expect(service.verifySubmission(ACCOUNT_ID, intent.intentId, {})).resolves.toEqual(
      expect.objectContaining({
        status: 'CONFIRMED',
        transaction: expect.objectContaining({ transactionHash: replacementHash }) as unknown,
      }),
    );
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { transactionHash: HASH }),
    ).resolves.toEqual(expect.objectContaining({ status: 'VERIFIED' }));
    expect(rpc.observeTransaction).toHaveBeenNthCalledWith(3, replacementHash, expect.any(Object));
  });

  it.each([
    new EvmPublicTestnetTransactionReplacedError(),
    new EvmPublicTestnetTransactionRevertedError(),
  ])('replays terminal safe-retry evidence after a lost %p response', async (failure) => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    if (failure instanceof EvmPublicTestnetTransactionReplacedError) {
      rpc.recoverTransaction.mockRejectedValueOnce(failure);
      await expect(service.verifySubmission(ACCOUNT_ID, intent.intentId, {})).rejects.toBe(failure);
    } else {
      rpc.observeTransaction.mockRejectedValueOnce(failure);
      await expect(
        service.verifySubmission(ACCOUNT_ID, intent.intentId, { transactionHash: HASH }),
      ).rejects.toBe(failure);
    }
    const FailureType =
      failure instanceof EvmPublicTestnetTransactionReplacedError
        ? EvmPublicTestnetTransactionReplacedError
        : EvmPublicTestnetTransactionRevertedError;
    await expect(service.verifySubmission(ACCOUNT_ID, intent.intentId, {})).rejects.toBeInstanceOf(
      FailureType,
    );
    expect(
      rpc.recoverTransaction.mock.calls.length + rpc.observeTransaction.mock.calls.length,
    ).toBe(1);
    await expect(service.createIntent(ACCOUNT_ID, CORRELATION, request())).resolves.toBeDefined();
  });

  it('prevents one hash from binding two principal-scoped intents', async () => {
    const { service } = fixture();
    const first = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const second = await service.createIntent(OTHER_ACCOUNT_ID, CORRELATION, request());
    await service.verifySubmission(ACCOUNT_ID, first.intentId, { transactionHash: HASH });
    await expect(
      service.verifySubmission(OTHER_ACCOUNT_ID, second.intentId, { transactionHash: HASH }),
    ).rejects.toBeInstanceOf(EvmPublicTestnetIntentConflictError);
  });

  it('never time-clears unresolved known-hash or hashless recovery evidence', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-31T12:00:00.000Z') });
    try {
      const { service, rpc } = fixture();
      const known = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      const hashless = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      rpc.observeTransaction.mockResolvedValue(transactionObservation('PENDING'));
      rpc.recoverTransaction.mockResolvedValue(transactionObservation('PENDING', null));
      await service.verifySubmission(ACCOUNT_ID, known.intentId, { transactionHash: HASH });
      await service.verifySubmission(ACCOUNT_ID, hashless.intentId, {});

      jest.advanceTimersByTime(61 * 60 * 1_000);

      await expect(service.verifySubmission(ACCOUNT_ID, known.intentId, {})).resolves.toEqual(
        expect.objectContaining({ status: 'PENDING', consumed: false }),
      );
      await expect(service.verifySubmission(ACCOUNT_ID, hashless.intentId, {})).resolves.toEqual(
        expect.objectContaining({ status: 'PENDING', consumed: false }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats a first late empty submission as recovery, never as time-based unlock', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-31T12:00:00.000Z') });
    try {
      const { service, rpc } = fixture();
      const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      rpc.recoverTransaction.mockResolvedValue(transactionObservation('PENDING', null));
      jest.advanceTimersByTime(61 * 60 * 1_000);

      await expect(service.verifySubmission(ACCOUNT_ID, intent.intentId, {})).resolves.toEqual(
        expect.objectContaining({ status: 'PENDING', consumed: false }),
      );
      expect(rpc.recoverTransaction).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats a first late exact hash as recovery evidence while its intent record exists', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-31T12:00:00.000Z') });
    try {
      const { service, rpc } = fixture();
      const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      jest.advanceTimersByTime(61 * 60 * 1_000);

      await expect(
        service.verifySubmission(ACCOUNT_ID, intent.intentId, { transactionHash: HASH }),
      ).resolves.toEqual(expect.objectContaining({ status: 'PENDING', consumed: false }));
      expect(rpc.observeTransaction).toHaveBeenCalledWith(HASH, expect.any(Object));
    } finally {
      jest.useRealTimers();
    }
  });

  it('prunes landed terminal evidence after one hour and recovers global capacity', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-31T12:00:00.000Z') });
    try {
      const { service, rpc } = fixture();
      rpc.observeTransaction.mockImplementation(async (transactionHash: Hex) =>
        transactionObservation('CONFIRMED', transactionHash),
      );
      for (let index = 0; index < 256; index += 1) {
        const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
        const transactionHash = `0x${index.toString(16).padStart(64, '0')}` as Hex;
        await service.verifySubmission(ACCOUNT_ID, intent.intentId, { transactionHash });
      }
      await expect(service.createIntent(ACCOUNT_ID, CORRELATION, request())).rejects.toBeDefined();

      jest.advanceTimersByTime(60 * 60 * 1_000 + 1);

      await expect(service.createIntent(ACCOUNT_ID, CORRELATION, request())).resolves.toEqual(
        expect.objectContaining({ account: ACCOUNT }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('measures terminal replay retention from the terminal observation', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-31T12:00:00.000Z') });
    try {
      const { service, rpc } = fixture();
      const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      rpc.observeTransaction.mockResolvedValue(transactionObservation('CONFIRMED'));
      jest.advanceTimersByTime(59 * 60 * 1_000);
      await service.verifySubmission(ACCOUNT_ID, intent.intentId, { transactionHash: HASH });

      jest.advanceTimersByTime(2 * 60 * 1_000);
      await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      await expect(service.verifySubmission(ACCOUNT_ID, intent.intentId, {})).resolves.toEqual(
        expect.objectContaining({ status: 'CONFIRMED' }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns the latest aWETH position and compounds the on-chain liquidity rate', async () => {
    const { service } = fixture();
    const response = await service.readPosition(ACCOUNT_ID, {
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: ACCOUNT,
    });
    expect(response).toEqual(
      expect.objectContaining({
        account: ACCOUNT,
        position: expect.objectContaining({
          status: 'OPEN',
          suppliedLiquidityAtomic: '500000000000000',
          aTokenBalanceAtomic: '500000000000000',
        }) as unknown,
        rate: expect.objectContaining({
          liquidityRateRay: '20000000000000000000000000',
          supplyApyBasisPoints: 202,
          historyAvailable: false,
        }) as unknown,
      }),
    );
  });
});
