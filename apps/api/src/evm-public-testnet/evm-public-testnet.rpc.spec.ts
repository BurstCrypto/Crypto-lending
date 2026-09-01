import { encodeAbiParameters, encodeFunctionResult, type Address, type Hex } from 'viem';

import {
  EVM_PUBLIC_TESTNET_AWETH,
  EVM_PUBLIC_TESTNET_APPROVAL_EVENT_TOPIC,
  EVM_PUBLIC_TESTNET_DATA_PROVIDER,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_MAX_UINT256,
  EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI,
  EVM_PUBLIC_TESTNET_RPC_ENDPOINT,
  EVM_PUBLIC_TESTNET_SUPPLY_EVENT_TOPIC,
  EVM_PUBLIC_TESTNET_TRANSFER_EVENT_TOPIC,
  EVM_PUBLIC_TESTNET_WETH,
  EVM_PUBLIC_TESTNET_WETH_GATEWAY,
  EVM_PUBLIC_TESTNET_WETH_WITHDRAWAL_EVENT_TOPIC,
  EVM_PUBLIC_TESTNET_WITHDRAW_EVENT_TOPIC,
  evmPublicTestnetAddressTopic,
  evmPublicTestnetUintTopic,
} from './evm-public-testnet.constants';
import type { EvmPublicTestnetExecutionConfig } from './evm-public-testnet.config';
import {
  EvmPublicTestnetEvidenceMismatchError,
  EvmPublicTestnetRpcUnavailableError,
  EvmPublicTestnetTransactionReplacedError,
  FixedBaseSepoliaExecutionRpc,
  type EvmPublicTestnetTransactionExpectation,
  type EvmPublicTestnetWithdrawalExpectation,
} from './evm-public-testnet.rpc';

const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;
const HASH = `0x${'ab'.repeat(32)}` as Hex;
const REPLACEMENT_HASH = `0x${'cd'.repeat(32)}` as Hex;
const BLOCK_HASH = `0x${'12'.repeat(32)}` as Hex;
const FINALIZED_HASH = `0x${'34'.repeat(32)}` as Hex;
const INPUT = `0x${'de'.repeat(132)}` as Hex;
const CONFIG = Object.freeze({
  mode: 'enabled' as const,
  rpcEndpoint: EVM_PUBLIC_TESTNET_RPC_ENDPOINT,
  requestTimeoutMilliseconds: 7_000 as const,
  responseMaximumBytes: 262_144 as const,
}) satisfies EvmPublicTestnetExecutionConfig;

const GET_POOL_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getPool',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;
const GET_WETH_ADDRESS_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getWETHAddress',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;
const GET_RESERVE_TOKENS_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getReserveTokensAddresses',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'aTokenAddress', type: 'address' },
      { name: 'stableDebtTokenAddress', type: 'address' },
      { name: 'variableDebtTokenAddress', type: 'address' },
    ],
  },
] as const;
const GET_RESERVE_DATA_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getReserveData',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'unbacked', type: 'uint256' },
      { name: 'accruedToTreasuryScaled', type: 'uint256' },
      { name: 'totalAToken', type: 'uint256' },
      { name: 'totalStableDebt', type: 'uint256' },
      { name: 'totalVariableDebt', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'variableBorrowRate', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'averageStableBorrowRate', type: 'uint256' },
      { name: 'liquidityIndex', type: 'uint256' },
      { name: 'variableBorrowIndex', type: 'uint256' },
      { name: 'lastUpdateTimestamp', type: 'uint40' },
    ],
  },
] as const;
const BALANCE_OF_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

type Handler = (method: string, params: readonly unknown[]) => unknown;

function rpc(handler: Handler, requests: RequestInit[] = []): FixedBaseSepoliaExecutionRpc {
  const fetchImplementation = jest.fn(
    async (_input: string | URL | Request, init?: RequestInit) => {
      if (init === undefined || typeof init.body !== 'string') throw new Error('missing request');
      requests.push(init);
      const body = JSON.parse(init.body) as {
        id: number;
        method: string;
        params: readonly unknown[];
      };
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: handler(body.method, body.params) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  );
  return new FixedBaseSepoliaExecutionRpc(CONFIG, fetchImplementation as typeof fetch);
}

function preflightHandler(method: string, params: readonly unknown[]): unknown {
  if (method === 'eth_chainId') return '0x14a34';
  if (method === 'eth_getBlockByNumber') {
    return params[0] === 'finalized'
      ? { number: '0x62', hash: FINALIZED_HASH }
      : { number: '0x64', hash: BLOCK_HASH };
  }
  if (method === 'eth_getBalance') return '0x5af3107a4000';
  if (method === 'eth_getTransactionCount') return '0x7';
  if (method === 'eth_getCode') return '0x6000';
  if (method === 'eth_call') {
    const call = params[0] as { to: string; data: string };
    if (call.to.toLowerCase() === EVM_PUBLIC_TESTNET_AWETH.toLowerCase()) {
      return encodeFunctionResult({ abi: BALANCE_OF_ABI, functionName: 'balanceOf', result: 10n });
    }
    if (call.data.startsWith('0x026b1d5f')) {
      return encodeFunctionResult({
        abi: GET_POOL_ABI,
        functionName: 'getPool',
        result: EVM_PUBLIC_TESTNET_POOL,
      });
    }
    if (call.data.startsWith('0xaffa8817')) {
      return encodeFunctionResult({
        abi: GET_WETH_ADDRESS_ABI,
        functionName: 'getWETHAddress',
        result: EVM_PUBLIC_TESTNET_WETH,
      });
    }
    if (call.data.startsWith('0xd2493b6c')) {
      return encodeFunctionResult({
        abi: GET_RESERVE_TOKENS_ABI,
        functionName: 'getReserveTokensAddresses',
        result: [EVM_PUBLIC_TESTNET_AWETH, `0x${'0'.repeat(40)}`, `0x${'22'.repeat(20)}`],
      });
    }
    if (call.to.toLowerCase() === EVM_PUBLIC_TESTNET_DATA_PROVIDER.toLowerCase()) {
      return encodeFunctionResult({
        abi: GET_RESERVE_DATA_ABI,
        functionName: 'getReserveData',
        result: [
          0n,
          0n,
          100n,
          0n,
          10n,
          20_000_000_000_000_000_000_000_000n,
          30n,
          0n,
          0n,
          10n ** 27n,
          10n ** 27n,
          1_788_192_000,
        ],
      });
    }
  }
  throw new Error(`Unexpected RPC method ${method}`);
}

function expectation(): EvmPublicTestnetTransactionExpectation {
  return Object.freeze({
    account: ACCOUNT,
    to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
    value: EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI,
    input: INPUT,
    nonce: 7n,
    baselineBlockNumber: 100n,
    baselineBlockHash: BLOCK_HASH,
    aTokenBalanceBeforeAtomic: 10n,
  });
}

function withdrawalExpectation(
  step: 'APPROVE_AWETH' | 'WITHDRAW_FULL_ETH',
): EvmPublicTestnetWithdrawalExpectation {
  return Object.freeze({
    step,
    account: ACCOUNT,
    to: step === 'APPROVE_AWETH' ? EVM_PUBLIC_TESTNET_AWETH : EVM_PUBLIC_TESTNET_WETH_GATEWAY,
    value: 0n,
    input: INPUT,
    nonce: 7n,
    baselineBlockNumber: 100n,
    baselineBlockHash: BLOCK_HASH,
    aTokenBalanceBeforeAtomic: 100n,
    allowanceBeforeAtomic: step === 'APPROVE_AWETH' ? 0n : EVM_PUBLIC_TESTNET_MAX_UINT256,
  });
}

function approvalLog(): object {
  return {
    address: EVM_PUBLIC_TESTNET_AWETH,
    topics: [
      EVM_PUBLIC_TESTNET_APPROVAL_EVENT_TOPIC,
      evmPublicTestnetAddressTopic(ACCOUNT),
      evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
    ],
    data: encodeAbiParameters([{ type: 'uint256' }], [EVM_PUBLIC_TESTNET_MAX_UINT256]),
    transactionHash: HASH,
  };
}

function withdrawalLogs(poolAmount = 100n): readonly object[] {
  return [
    {
      address: EVM_PUBLIC_TESTNET_AWETH,
      topics: [
        EVM_PUBLIC_TESTNET_TRANSFER_EVENT_TOPIC,
        evmPublicTestnetAddressTopic(ACCOUNT),
        evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
      ],
      data: encodeAbiParameters([{ type: 'uint256' }], [100n]),
      transactionHash: HASH,
    },
    {
      address: EVM_PUBLIC_TESTNET_POOL,
      topics: [
        EVM_PUBLIC_TESTNET_WITHDRAW_EVENT_TOPIC,
        evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH),
        evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
        evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
      ],
      data: encodeAbiParameters([{ type: 'uint256' }], [poolAmount]),
      transactionHash: HASH,
    },
    {
      address: EVM_PUBLIC_TESTNET_WETH,
      topics: [
        EVM_PUBLIC_TESTNET_WETH_WITHDRAWAL_EVENT_TOPIC,
        evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH_GATEWAY),
      ],
      data: encodeAbiParameters([{ type: 'uint256' }], [100n]),
      transactionHash: HASH,
    },
  ];
}

function expectedSupplyLog(transactionHash: Hex = HASH): object {
  return {
    address: EVM_PUBLIC_TESTNET_POOL,
    topics: [
      EVM_PUBLIC_TESTNET_SUPPLY_EVENT_TOPIC,
      evmPublicTestnetAddressTopic(EVM_PUBLIC_TESTNET_WETH),
      evmPublicTestnetAddressTopic(ACCOUNT),
      evmPublicTestnetUintTopic(0n),
    ],
    data: encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [EVM_PUBLIC_TESTNET_WETH_GATEWAY, EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI],
    ),
    transactionHash,
  };
}

describe('FixedBaseSepoliaExecutionRpc', () => {
  it('performs a fixed latest preflight, validates every deployment, and never writes', async () => {
    const requests: RequestInit[] = [];
    const client = rpc(preflightHandler, requests);
    await expect(client.preflight(ACCOUNT)).resolves.toEqual(
      expect.objectContaining({
        blockNumber: 100n,
        finalizedBlockNumber: 98n,
        nativeBalanceWei: 100_000_000_000_000n,
        nonce: 7n,
        aTokenBalanceAtomic: 10n,
        liquidityRateRay: 20_000_000_000_000_000_000_000_000n,
      }),
    );
    const methods = requests.map(
      (request) => JSON.parse(request.body as string) as { method: string },
    );
    expect(methods.some(({ method }) => method.startsWith('eth_send'))).toBe(false);
    expect(requests.every((request) => request.redirect === 'error')).toBe(true);
  });

  it('requires exact canonical receipt, Supply log, positive aWETH delta, and finality', async () => {
    let supplyLogHash = HASH;
    const client = rpc((method, params) => {
      if (method === 'eth_chainId') return '0x14a34';
      if (method === 'eth_getTransactionByHash') {
        return {
          hash: HASH,
          from: ACCOUNT,
          to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
          input: INPUT,
          value: '0x2d79883d2000',
          nonce: '0x7',
          chainId: '0x14a34',
          blockNumber: '0x65',
          blockHash: BLOCK_HASH,
        };
      }
      if (method === 'eth_getTransactionReceipt') {
        return {
          transactionHash: HASH,
          from: ACCOUNT,
          to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
          status: '0x1',
          blockNumber: '0x65',
          blockHash: BLOCK_HASH,
          logs: [expectedSupplyLog(supplyLogHash)],
        };
      }
      if (method === 'eth_getBlockByNumber') {
        if (params[0] === 'finalized') return { number: '0x65', hash: FINALIZED_HASH };
        if (params[0] === '0x64') return { number: '0x64', hash: BLOCK_HASH };
        return { number: '0x65', hash: BLOCK_HASH };
      }
      if (method === 'eth_call') {
        return encodeFunctionResult({
          abi: BALANCE_OF_ABI,
          functionName: 'balanceOf',
          result: 50_000_000_000_010n,
        });
      }
      throw new Error(`Unexpected RPC method ${method}`);
    });
    await expect(client.observeTransaction(HASH, expectation())).resolves.toEqual({
      status: 'VERIFIED',
      transactionHash: HASH,
      blockNumber: 101n,
      blockHash: BLOCK_HASH,
      aTokenBalanceAfterAtomic: 50_000_000_000_010n,
      increaseAtomic: 50_000_000_000_000n,
    });
    supplyLogHash = REPLACEMENT_HASH;
    await expect(client.observeTransaction(HASH, expectation())).rejects.toBeInstanceOf(
      EvmPublicTestnetEvidenceMismatchError,
    );
  });

  it('verifies one exact maximum approval event and post-receipt allowance', async () => {
    let allowanceAfter = EVM_PUBLIC_TESTNET_MAX_UINT256;
    const client = rpc((method, params) => {
      if (method === 'eth_chainId') return '0x14a34';
      if (method === 'eth_getTransactionByHash') {
        return {
          hash: HASH,
          from: ACCOUNT,
          to: EVM_PUBLIC_TESTNET_AWETH,
          input: INPUT,
          value: '0x0',
          nonce: '0x7',
          chainId: '0x14a34',
          blockNumber: '0x65',
          blockHash: BLOCK_HASH,
        };
      }
      if (method === 'eth_getTransactionReceipt') {
        return {
          transactionHash: HASH,
          from: ACCOUNT,
          to: EVM_PUBLIC_TESTNET_AWETH,
          status: '0x1',
          blockNumber: '0x65',
          blockHash: BLOCK_HASH,
          logs: [approvalLog()],
        };
      }
      if (method === 'eth_getBlockByNumber') {
        if (params[0] === '0x64') return { number: '0x64', hash: BLOCK_HASH };
        if (params[0] === 'finalized') return { number: '0x65', hash: FINALIZED_HASH };
        return { number: '0x65', hash: BLOCK_HASH };
      }
      if (method === 'eth_call') {
        const call = params[0] as { data: string };
        return encodeAbiParameters(
          [{ type: 'uint256' }],
          [call.data.startsWith('0xdd62ed3e') ? allowanceAfter : 101n],
        );
      }
      throw new Error(`Unexpected RPC method ${method}`);
    });

    await expect(
      client.observeWithdrawalTransaction(HASH, withdrawalExpectation('APPROVE_AWETH')),
    ).resolves.toEqual({
      status: 'VERIFIED',
      step: 'APPROVE_AWETH',
      transactionHash: HASH,
      blockNumber: 101n,
      blockHash: BLOCK_HASH,
      amountAtomic: EVM_PUBLIC_TESTNET_MAX_UINT256,
      aTokenBalanceAfterAtomic: 101n,
      allowanceAfterAtomic: EVM_PUBLIC_TESTNET_MAX_UINT256,
    });
    allowanceAfter = 1n;
    await expect(
      client.observeWithdrawalTransaction(HASH, withdrawalExpectation('APPROVE_AWETH')),
    ).rejects.toBeInstanceOf(EvmPublicTestnetEvidenceMismatchError);
  });

  it('requires the exact aWETH, Pool Withdraw, and WETH Withdrawal event triad', async () => {
    let poolAmount = 100n;
    const client = rpc((method, params) => {
      if (method === 'eth_chainId') return '0x14a34';
      if (method === 'eth_getTransactionByHash') {
        return {
          hash: HASH,
          from: ACCOUNT,
          to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
          input: INPUT,
          value: '0x0',
          nonce: '0x7',
          chainId: '0x14a34',
          blockNumber: '0x65',
          blockHash: BLOCK_HASH,
        };
      }
      if (method === 'eth_getTransactionReceipt') {
        return {
          transactionHash: HASH,
          from: ACCOUNT,
          to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
          status: '0x1',
          blockNumber: '0x65',
          blockHash: BLOCK_HASH,
          logs: withdrawalLogs(poolAmount),
        };
      }
      if (method === 'eth_getBlockByNumber') {
        if (params[0] === '0x64') return { number: '0x64', hash: BLOCK_HASH };
        if (params[0] === 'finalized') return { number: '0x65', hash: FINALIZED_HASH };
        return { number: '0x65', hash: BLOCK_HASH };
      }
      if (method === 'eth_call') {
        const call = params[0] as { data: string };
        return encodeAbiParameters(
          [{ type: 'uint256' }],
          [call.data.startsWith('0xdd62ed3e') ? EVM_PUBLIC_TESTNET_MAX_UINT256 : 0n],
        );
      }
      throw new Error(`Unexpected RPC method ${method}`);
    });

    await expect(
      client.observeWithdrawalTransaction(HASH, withdrawalExpectation('WITHDRAW_FULL_ETH')),
    ).resolves.toMatchObject({
      status: 'VERIFIED',
      step: 'WITHDRAW_FULL_ETH',
      amountAtomic: 100n,
      aTokenBalanceAfterAtomic: 0n,
    });
    poolAmount = 99n;
    await expect(
      client.observeWithdrawalTransaction(HASH, withdrawalExpectation('WITHDRAW_FULL_ETH')),
    ).rejects.toBeInstanceOf(EvmPublicTestnetEvidenceMismatchError);
  });

  it('keeps hashless absence pending until finalized nonce proves replacement', async () => {
    let finalizedNonce = '0x7';
    const client = rpc((method, params) => {
      if (method === 'eth_chainId') return '0x14a34';
      if (method === 'eth_getBlockByNumber') {
        return params[0] === '0x64'
          ? { number: '0x64', hash: BLOCK_HASH }
          : { number: '0x66', hash: BLOCK_HASH };
      }
      if (method === 'eth_getTransactionCount') return finalizedNonce;
      if (method === 'eth_getLogs') return [];
      throw new Error(`Unexpected RPC method ${method}`);
    });
    await expect(client.recoverTransaction(expectation())).resolves.toEqual({
      status: 'PENDING',
      transactionHash: null,
      blockNumber: null,
      blockHash: null,
      aTokenBalanceAfterAtomic: null,
      increaseAtomic: null,
    });
    finalizedNonce = '0x8';
    await expect(client.recoverTransaction(expectation())).rejects.toBeInstanceOf(
      EvmPublicTestnetTransactionReplacedError,
    );
  });

  it('checks bounded recovery before treating a missing known hash as pending', async () => {
    let finalizedNonce = '0x7';
    const client = rpc((method, params) => {
      if (method === 'eth_chainId') return '0x14a34';
      if (method === 'eth_getTransactionByHash') return null;
      if (method === 'eth_getBlockByNumber') {
        return params[0] === '0x64'
          ? { number: '0x64', hash: BLOCK_HASH }
          : { number: '0x66', hash: BLOCK_HASH };
      }
      if (method === 'eth_getTransactionCount') return finalizedNonce;
      if (method === 'eth_getLogs') return [];
      throw new Error(`Unexpected RPC method ${method}`);
    });

    await expect(client.observeTransaction(HASH, expectation())).resolves.toEqual({
      status: 'PENDING',
      transactionHash: HASH,
      blockNumber: null,
      blockHash: null,
      aTokenBalanceAfterAtomic: null,
      increaseAtomic: null,
    });
    finalizedNonce = '0x8';
    await expect(client.observeTransaction(HASH, expectation())).rejects.toBeInstanceOf(
      EvmPublicTestnetTransactionReplacedError,
    );
  });

  it('recovers an exact same-intent speed-up transaction when the original hash disappears', async () => {
    const client = rpc((method, params) => {
      if (method === 'eth_chainId') return '0x14a34';
      if (method === 'eth_getTransactionByHash') {
        if (params[0] === HASH) return null;
        return {
          hash: REPLACEMENT_HASH,
          from: ACCOUNT,
          to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
          input: INPUT,
          value: '0x2d79883d2000',
          nonce: '0x7',
          chainId: '0x14a34',
          blockNumber: '0x65',
          blockHash: BLOCK_HASH,
        };
      }
      if (method === 'eth_getTransactionReceipt') {
        return {
          transactionHash: REPLACEMENT_HASH,
          from: ACCOUNT,
          to: EVM_PUBLIC_TESTNET_WETH_GATEWAY,
          status: '0x1',
          blockNumber: '0x65',
          blockHash: BLOCK_HASH,
          logs: [expectedSupplyLog(REPLACEMENT_HASH)],
        };
      }
      if (method === 'eth_getBlockByNumber') {
        if (params[0] === '0x64') return { number: '0x64', hash: BLOCK_HASH };
        if (params[0] === 'finalized') return { number: '0x65', hash: FINALIZED_HASH };
        return { number: '0x65', hash: BLOCK_HASH };
      }
      if (method === 'eth_getTransactionCount') return '0x8';
      if (method === 'eth_getLogs') return [expectedSupplyLog(REPLACEMENT_HASH)];
      if (method === 'eth_call') {
        return encodeFunctionResult({
          abi: BALANCE_OF_ABI,
          functionName: 'balanceOf',
          result: 50_000_000_000_010n,
        });
      }
      throw new Error(`Unexpected RPC method ${method}`);
    });

    await expect(client.observeTransaction(HASH, expectation())).resolves.toEqual({
      status: 'VERIFIED',
      transactionHash: REPLACEMENT_HASH,
      blockNumber: 101n,
      blockHash: BLOCK_HASH,
      aTokenBalanceAfterAtomic: 50_000_000_000_010n,
      increaseAtomic: 50_000_000_000_000n,
    });
  });

  it('fails closed on oversized or redirected JSON-RPC responses', async () => {
    const oversizedFetch = jest.fn(
      async () => new Response('{}', { status: 200, headers: { 'content-length': '262145' } }),
    );
    const client = new FixedBaseSepoliaExecutionRpc(CONFIG, oversizedFetch as typeof fetch);
    await expect(client.preflight(ACCOUNT)).rejects.toBeInstanceOf(
      EvmPublicTestnetRpcUnavailableError,
    );
  });
});
