import { decodeFunctionData, keccak256, stringToHex, type Address, type Hex } from 'viem';

import { parseAccountId } from '../accounts/domain/account-profile';
import {
  EVM_PUBLIC_TESTNET_AWETH,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_MAX_UINT256,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_RPC_ENDPOINT,
  EVM_PUBLIC_TESTNET_WETH_GATEWAY,
} from './evm-public-testnet.constants';
import type { EvmPublicTestnetExecutionConfig } from './evm-public-testnet.config';
import type {
  EvmPublicTestnetWithdrawalPreflightObservation,
  EvmPublicTestnetWithdrawalRpc,
  EvmPublicTestnetWithdrawalTransactionObservation,
} from './evm-public-testnet.rpc';
import {
  EvmPublicTestnetWithdrawalEmptyPositionError,
  EvmPublicTestnetWithdrawalService,
} from './evm-public-testnet-withdrawal.service';

const APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
const WITHDRAW_ETH_ABI = [
  {
    type: 'function',
    name: 'withdrawETH',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
  },
] as const;

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;
const HASH = `0x${'ab'.repeat(32)}` as Hex;
const BLOCK_HASH = `0x${'12'.repeat(32)}` as Hex;
const FINALIZED_HASH = `0x${'34'.repeat(32)}` as Hex;
const CONFIG = Object.freeze({
  mode: 'enabled' as const,
  rpcEndpoint: EVM_PUBLIC_TESTNET_RPC_ENDPOINT,
  requestTimeoutMilliseconds: 7_000 as const,
  responseMaximumBytes: 262_144 as const,
}) satisfies EvmPublicTestnetExecutionConfig;

function preflight(
  allowanceAtomic: bigint,
  aTokenBalanceAtomic = 100n,
): EvmPublicTestnetWithdrawalPreflightObservation {
  return Object.freeze({
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    finalizedBlockNumber: 98n,
    finalizedBlockHash: FINALIZED_HASH,
    nativeBalanceWei: 1_000_000_000_000_000n,
    nonce: 7n,
    aTokenBalanceAtomic,
    allowanceAtomic,
    observedAt: '2026-09-01T15:00:00.000Z',
  });
}

function observation(
  step: 'APPROVE_AWETH' | 'WITHDRAW_FULL_ETH',
  status: 'PENDING' | 'CONFIRMED' | 'VERIFIED' = 'VERIFIED',
): EvmPublicTestnetWithdrawalTransactionObservation {
  const landed = status !== 'PENDING';
  return Object.freeze({
    status,
    step,
    transactionHash: HASH,
    blockNumber: landed ? 101n : null,
    blockHash: landed ? BLOCK_HASH : null,
    amountAtomic: landed
      ? step === 'APPROVE_AWETH'
        ? EVM_PUBLIC_TESTNET_MAX_UINT256
        : 100n
      : null,
    aTokenBalanceAfterAtomic: landed ? (step === 'APPROVE_AWETH' ? 100n : 0n) : null,
    allowanceAfterAtomic: landed ? EVM_PUBLIC_TESTNET_MAX_UINT256 : null,
  });
}

function fixture(
  allowanceAtomic = 0n,
  balanceAtomic = 100n,
): {
  readonly rpc: {
    readonly preflightWithdrawal: jest.Mock;
    readonly assertWithdrawalExecutable: jest.Mock;
    readonly observeWithdrawalTransaction: jest.Mock;
    readonly recoverWithdrawalTransaction: jest.Mock;
  };
  readonly service: EvmPublicTestnetWithdrawalService;
} {
  const rpc = {
    preflightWithdrawal: jest.fn(async () => preflight(allowanceAtomic, balanceAtomic)),
    assertWithdrawalExecutable: jest.fn(async () => undefined),
    observeWithdrawalTransaction: jest.fn(async () => observation('APPROVE_AWETH')),
    recoverWithdrawalTransaction: jest.fn(async () => observation('APPROVE_AWETH', 'PENDING')),
  };
  return {
    rpc,
    service: new EvmPublicTestnetWithdrawalService(
      rpc as unknown as EvmPublicTestnetWithdrawalRpc,
      CONFIG,
    ),
  };
}

describe('EvmPublicTestnetWithdrawalService', () => {
  it('reviews an exact marked maximum aWETH approval when allowance is not already maximum', async () => {
    const { service, rpc } = fixture(1n);

    const intent = await service.createIntent(ACCOUNT_ID, {
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: ACCOUNT,
    });

    expect(intent).toMatchObject({
      step: 'APPROVE_AWETH',
      transaction: { to: EVM_PUBLIC_TESTNET_AWETH, value: '0x0', nonce: '0x7' },
      allowance: {
        beforeAtomic: '1',
        requiredAtomic: EVM_PUBLIC_TESTNET_MAX_UINT256.toString(),
      },
    });
    const bareCall = intent.transaction.input.slice(0, -64) as Hex;
    expect(decodeFunctionData({ abi: APPROVE_ABI, data: bareCall })).toEqual({
      functionName: 'approve',
      args: [EVM_PUBLIC_TESTNET_WETH_GATEWAY, EVM_PUBLIC_TESTNET_MAX_UINT256],
    });
    expect(`0x${intent.transaction.input.slice(-64)}`).toBe(
      keccak256(
        stringToHex(
          `crypto-lending:base-sepolia-aave-v3-full-withdrawal:v1:APPROVE_AWETH:${intent.intentId}`,
        ),
      ),
    );
    expect(rpc.assertWithdrawalExecutable).not.toHaveBeenCalled();
  });

  it('skips approval only at exact maximum allowance and simulates full withdrawETH', async () => {
    const { service, rpc } = fixture(EVM_PUBLIC_TESTNET_MAX_UINT256);

    const intent = await service.createIntent(ACCOUNT_ID, {
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: ACCOUNT,
    });

    expect(intent).toMatchObject({
      step: 'WITHDRAW_FULL_ETH',
      transaction: { to: EVM_PUBLIC_TESTNET_WETH_GATEWAY, value: '0x0' },
    });
    const bareCall = intent.transaction.input.slice(0, -64) as Hex;
    expect(decodeFunctionData({ abi: WITHDRAW_ETH_ABI, data: bareCall })).toEqual({
      functionName: 'withdrawETH',
      args: [EVM_PUBLIC_TESTNET_POOL, EVM_PUBLIC_TESTNET_MAX_UINT256, ACCOUNT],
    });
    expect(rpc.assertWithdrawalExecutable).toHaveBeenCalledWith(ACCOUNT, intent.transaction.input);
  });

  it('rejects an empty aWETH position without simulating or creating a wallet transaction', async () => {
    const { service, rpc } = fixture(EVM_PUBLIC_TESTNET_MAX_UINT256, 0n);

    await expect(
      service.createIntent(ACCOUNT_ID, { chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT }),
    ).rejects.toBeInstanceOf(EvmPublicTestnetWithdrawalEmptyPositionError);
    expect(rpc.assertWithdrawalExecutable).not.toHaveBeenCalled();
  });

  it('retains pending evidence and permits a fresh withdrawal intent after approval confirmation', async () => {
    const { service, rpc } = fixture(0n);
    const approval = await service.createIntent(ACCOUNT_ID, {
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: ACCOUNT,
    });
    rpc.observeWithdrawalTransaction.mockResolvedValueOnce(
      observation('APPROVE_AWETH', 'CONFIRMED'),
    );

    await expect(
      service.verifySubmission(ACCOUNT_ID, approval.intentId, { transactionHash: HASH }),
    ).resolves.toMatchObject({
      status: 'CONFIRMED',
      step: 'APPROVE_AWETH',
      consumed: true,
      effect: { allowanceAfterAtomic: EVM_PUBLIC_TESTNET_MAX_UINT256.toString() },
    });

    rpc.preflightWithdrawal.mockResolvedValueOnce(preflight(EVM_PUBLIC_TESTNET_MAX_UINT256));
    await expect(
      service.createIntent(ACCOUNT_ID, { chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT }),
    ).resolves.toMatchObject({ step: 'WITHDRAW_FULL_ETH' });
  });
});
