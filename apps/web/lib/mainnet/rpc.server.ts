import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from 'viem';

import {
  BINDING_ABI,
  MAINNET_TEST as P,
  POOL_ABI,
  TOKEN_ABI,
  fail,
  type MainnetTestSnapshot,
} from './policy';

// PublicNode's alternate mainnet hostname remains available when its -rpc host
// rejects TLS connections. The second provider is still independently operated.
export const RPC_URLS = ['https://ethereum.publicnode.com', 'https://eth.drpc.org'] as const;
export type RpcCall = readonly [method: string, params: readonly unknown[]];
export type RpcBatch = (source: 0 | 1, calls: readonly RpcCall[]) => Promise<unknown[]>;
const READ_METHODS = new Set([
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_call',
  'eth_getBalance',
  'eth_getTransactionCount',
  'eth_estimateGas',
  'eth_maxPriorityFeePerGas',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
]);
const EIP1967 = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const USDC_SLOT = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';
const USDC_IMPLEMENTATION = '0x43506849d7c04f9138d1a2050bbf3a0c054402dd';
const ATOKEN_IMPLEMENTATION = '0xadc45df3cf1584624c97338bef33363bf5b97ada';
// Runtime hashes observed on 2026-09-14; every inspection checks both endpoints.
// A proxy upgrade or code drift stops new preparation until this pin is reviewed.
export const CODE_PINS = [
  [P.pool, '0x96107dc4006b4c7fecd1827cfb275ffeef31e6194cd50466f85f8eb24ccf2679'],
  [P.usdc, '0xd80d4b7c890cb9d6a4893e6b52bc34b56b25335cb13716e0d1d31383e6b41505'],
  [P.aToken, '0x82c6d153799b3226525e3b7ec27b843ef44c5f6bca21fcf8b3c80db61ba64881'],
  [P.implementation, '0x530cdbba5eb9487cd5d041bb74b7a1936ad3230bf9e361893ecd025373c7fbe5'],
  [USDC_IMPLEMENTATION, '0xcdfb7d322961af3acae7a8f7ee8b69c205b36f576cc5b077f170c7eb8ecbe3ea'],
  [ATOKEN_IMPLEMENTATION, '0x3bd38f9cd664b4169375c69f362dc585ed97adf6da6f8b6d5569ecb8690d9eb5'],
] as const;

export const httpRpcBatch: RpcBatch = async (source, calls) => {
  if (
    calls.length === 0 ||
    calls.length > 32 ||
    calls.some(([method]) => !READ_METHODS.has(method))
  ) {
    return fail('Only bounded mainnet reads and simulations are allowed on the server.');
  }
  if (calls.length > 3) {
    const result: unknown[] = [];
    for (let start = 0; start < calls.length; start += 3)
      result.push(...(await httpRpcBatch(source, calls.slice(start, start + 3))));
    return result;
  }
  const response = await fetch(RPC_URLS[source], {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify(
      calls.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params })),
    ),
  }).catch(() =>
    fail('An Ethereum RPC endpoint could not be reached. Refresh the live market check.'),
  );
  if (!response.ok || !response.body) return fail('An Ethereum RPC endpoint is unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) return fail('The Ethereum RPC response exceeded the size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(payload) || payload.length !== calls.length)
    return fail('Invalid Ethereum RPC batch response.');
  const seen = new Set<number>();
  const result = new Array<unknown>(calls.length);
  for (const item of payload) {
    const row = record(item);
    if (
      row.jsonrpc !== '2.0' ||
      !Number.isInteger(row.id) ||
      Number(row.id) < 0 ||
      Number(row.id) >= calls.length ||
      seen.has(Number(row.id)) ||
      Object.hasOwn(row, 'error') ||
      !Object.hasOwn(row, 'result')
    ) {
      return fail('An Ethereum read or transaction simulation was rejected.');
    }
    seen.add(Number(row.id));
    result[Number(row.id)] = row.result;
  }
  return result;
};

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return fail('Invalid Ethereum response.');
  return value as Record<string, unknown>;
}
export function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value))
    return fail('Invalid Ethereum quantity.');
  return BigInt(value);
}
export function hashValue(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value))
    return fail('Invalid Ethereum transaction or block hash.');
  return value as Hex;
}
function words(value: unknown, count: number): bigint[] {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-f]{${count * 64}}$`).test(value))
    return fail('Invalid contract response.');
  return Array.from({ length: count }, (_, index) =>
    BigInt(`0x${value.slice(2 + index * 64, 66 + index * 64)}`),
  );
}
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    return fail('The Ethereum endpoints disagree. Refresh before proceeding.');
}
interface Head {
  number: Hex;
  hash: Hex;
  baseFee: bigint;
}
export interface Inspection {
  snapshot: MainnetTestSnapshot;
  nonce: Hex;
  head: Head;
  active: boolean;
  frozen: boolean;
  paused: boolean;
}

export class MainnetTestRpc {
  constructor(
    readonly batch: RpcBatch = httpRpcBatch,
    readonly now: () => number = Date.now,
  ) {}

  async pair(calls: readonly RpcCall[]): Promise<unknown[]> {
    const results = await Promise.all([this.batch(0, calls), this.batch(1, calls)]);
    equal(results[0], results[1]);
    return results[0];
  }

  async anchor(tag: 'latest' | 'finalized' = 'latest'): Promise<Head> {
    const heads = await Promise.all(
      [0, 1].map(async (source) => {
        const [chain, value] = await this.batch(source as 0 | 1, [
          ['eth_chainId', []],
          ['eth_getBlockByNumber', [tag, false]],
        ]);
        if (chain !== '0x1') return fail('Both RPC endpoints must report Ethereum mainnet.');
        return record(value);
      }),
    );
    const heights = heads.map((head) => quantity(head.number));
    const height = heights[0]! < heights[1]! ? heights[0]! : heights[1]!;
    const canonical = await Promise.all(
      [0, 1].map(async (source) =>
        record(
          (
            await this.batch(source as 0 | 1, [['eth_getBlockByNumber', [toHex(height), false]]])
          )[0],
        ),
      ),
    );
    equal(canonical[0]!.hash, canonical[1]!.hash);
    for (const head of canonical) {
      if (quantity(head.number) !== height)
        return fail('The Ethereum block height did not match the request.');
      const age = this.now() - Number(quantity(head.timestamp)) * 1000;
      if (age < -15_000 || age > (tag === 'finalized' ? 30 * 60_000 : 120_000))
        return fail('Ethereum block data is stale.');
    }
    equal(canonical[0]!.baseFeePerGas, canonical[1]!.baseFeePerGas);
    return {
      number: toHex(height),
      hash: hashValue(canonical[0]!.hash),
      baseFee: quantity(canonical[0]!.baseFeePerGas),
    };
  }

  async inspect(wallet: Address): Promise<Inspection> {
    const head = await this.anchor();
    const block = { blockHash: head.hash, requireCanonical: true };
    const call = (to: Address, data: Hex): RpcCall => ['eth_call', [{ to, data }, block]];
    const calls: RpcCall[] = [
      ...CODE_PINS.map(([contract]) => ['eth_getCode', [contract, block]] as RpcCall),
      ['eth_getStorageAt', [P.pool, EIP1967, block]],
      ['eth_getStorageAt', [P.usdc, USDC_SLOT, block]],
      ['eth_getStorageAt', [P.aToken, EIP1967, block]],
      call(P.provider, encodeFunctionData({ abi: BINDING_ABI, functionName: 'getPool' })),
      call(P.pool, encodeFunctionData({ abi: POOL_ABI, functionName: 'ADDRESSES_PROVIDER' })),
      call(
        P.dataProvider,
        encodeFunctionData({
          abi: BINDING_ABI,
          functionName: 'getReserveTokensAddresses',
          args: [P.usdc],
        }),
      ),
      call(
        P.aToken,
        encodeFunctionData({ abi: TOKEN_ABI, functionName: 'UNDERLYING_ASSET_ADDRESS' }),
      ),
      call(P.aToken, encodeFunctionData({ abi: TOKEN_ABI, functionName: 'POOL' })),
      call(P.usdc, encodeFunctionData({ abi: TOKEN_ABI, functionName: 'decimals' })),
      call(
        P.usdc,
        encodeFunctionData({ abi: TOKEN_ABI, functionName: 'balanceOf', args: [wallet] }),
      ),
      call(
        P.aToken,
        encodeFunctionData({ abi: TOKEN_ABI, functionName: 'balanceOf', args: [wallet] }),
      ),
      call(
        P.usdc,
        encodeFunctionData({ abi: TOKEN_ABI, functionName: 'allowance', args: [wallet, P.pool] }),
      ),
      ['eth_getBalance', [wallet, block]],
      call(
        P.pool,
        encodeFunctionData({ abi: POOL_ABI, functionName: 'getUserAccountData', args: [wallet] }),
      ),
      call(
        P.dataProvider,
        encodeFunctionData({
          abi: BINDING_ABI,
          functionName: 'getReserveConfigurationData',
          args: [P.usdc],
        }),
      ),
      call(
        P.dataProvider,
        encodeFunctionData({ abi: BINDING_ABI, functionName: 'getPaused', args: [P.usdc] }),
      ),
      ['eth_getTransactionCount', [wallet, 'latest']],
      ['eth_getTransactionCount', [wallet, 'pending']],
      ['eth_getCode', [wallet, block]],
    ];
    const results = await this.pair(calls);
    for (const [index, [, codeHash]] of CODE_PINS.entries()) {
      const code = results[index];
      if (
        typeof code !== 'string' ||
        !/^0x(?:[0-9a-f]{2})+$/.test(code) ||
        keccak256(code as Hex) !== codeHash
      ) {
        return fail('A pinned contract changed. Review the deployment before testing.');
      }
    }
    const r = results.slice(CODE_PINS.length);
    const binding = (value: unknown, expected: string, count = 1) => {
      if (words(value, count)[0] !== BigInt(expected))
        return fail('An Aave or USDC deployment binding changed.');
    };
    binding(r[0], P.implementation);
    binding(r[1], USDC_IMPLEMENTATION);
    binding(r[2], ATOKEN_IMPLEMENTATION);
    binding(r[3], P.pool);
    binding(r[4], P.provider);
    binding(r[5], P.aToken, 3);
    binding(r[6], P.usdc);
    binding(r[7], P.pool);
    if (words(r[8], 1)[0] !== 6n) return fail('Unexpected USDC decimals.');
    const account = words(r[13], 6);
    const configuration = words(r[14], 10);
    const paused = words(r[15], 1)[0] === 1n;
    if (r[18] !== '0x')
      return fail('Use a dedicated externally owned wallet without delegated account code.');
    const nonce = toHex(quantity(r[16]));
    if (quantity(r[17]) !== quantity(r[16]))
      return fail('This wallet has another pending transaction. Resolve it first.');
    await this.recheck(head);
    return {
      snapshot: {
        wallet,
        blockNumber: quantity(head.number).toString(),
        blockHash: head.hash,
        observedAt: this.now(),
        usdc: words(r[9], 1)[0]!.toString(),
        supplied: words(r[10], 1)[0]!.toString(),
        allowance: words(r[11], 1)[0]!.toString(),
        eth: quantity(r[12]).toString(),
        totalDebt: account[1]!.toString(),
      },
      nonce,
      head,
      active: configuration[8] === 1n,
      frozen: configuration[9] === 1n,
      paused,
    };
  }

  async recheck(head: Head) {
    for (const source of [0, 1] as const) {
      const [chain, block] = await this.batch(source, [
        ['eth_chainId', []],
        ['eth_getBlockByNumber', [head.number, false]],
      ]);
      if (chain !== '0x1' || record(block).hash !== head.hash)
        return fail('Ethereum chain identity or the reviewed block changed.');
    }
  }
}
