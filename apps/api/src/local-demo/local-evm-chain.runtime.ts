import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { encodeFunctionData, isAddress, numberToHex } from 'viem';

import {
  EvmBalanceReadFailure,
  type EvmStablecoinBalanceReaderPort,
  type EvmTokenBalanceBatchReadRequest,
} from '../blockchain/application/ports/evm-stablecoin-balance-indexer.ports';
import { normalizeEvmAddress } from '../blockchain/domain/evm-stablecoin-position';
import {
  LOCAL_EVM_DEVELOPMENT_MANIFEST,
  normalizeLocalEvmDevelopmentAsset,
} from '../blockchain/domain/local-evm-development';
import type { LocalDemoRuntimeConfig } from './local-demo-runtime.config';

export const LOCAL_EVM_CHAIN_RUNTIME = Symbol('LOCAL_EVM_CHAIN_RUNTIME');

const MAX_RESPONSE_BYTES = 131_072;
const MAX_CONTROL_RESPONSE_BYTES = 4_096;
const REQUEST_TIMEOUT_MS = 2_000;
const LOCAL_EVM_CONTROL_URL = 'http://127.0.0.1:18546/control' as const;
const LOCAL_EVM_CONTROL_DOMAIN = 'crypto-lending:local-evm-control:v2' as const;
const CONTROL_SCHEMA_VERSION = 2 as const;
const CONTROL_STATUS_ACTION = 'STATUS' as const;
const CONTROL_SET_BALANCES_ACTION = 'SET_BALANCES' as const;
const LOWERCASE_HEX_128 = /^[0-9a-f]{32}$/u;
const LOWERCASE_HEX_256 = /^[0-9a-f]{64}$/u;
const UINT256 = /^(?:0|[1-9][0-9]{0,77})$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const HEX_WORD = /^0x[0-9a-f]{64}$/u;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const;
const MAX_UINT256 = (1n << 256n) - 1n;

type LocalEvmRpcMethod = 'eth_call' | 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode';

export interface LocalEvmWalletSeed {
  readonly walletAddress: string;
  readonly balanceAtomic: string;
}

export interface LocalEvmChainRuntimePort extends EvmStablecoinBalanceReaderPort {
  readNodeInstanceId(): Promise<string>;
  seedWalletBalances(seeds: readonly LocalEvmWalletSeed[]): Promise<void>;
}

export class LocalEvmDevelopmentRuntimeError extends Error {
  readonly code = 'LOCAL_EVM_DEVELOPMENT_RUNTIME_UNAVAILABLE' as const;

  constructor() {
    super('Local EVM development runtime is unavailable');
    this.name = 'LocalEvmDevelopmentRuntimeError';
  }
}

export class LoopbackLocalEvmChainRuntime implements LocalEvmChainRuntimePort {
  private nextRequestId = 1;

  constructor(
    private readonly config: LocalDemoRuntimeConfig,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {
    if (typeof fetchImplementation !== 'function') {
      throw new LocalEvmDevelopmentRuntimeError();
    }
  }

  async seedWalletBalances(seeds: readonly LocalEvmWalletSeed[]): Promise<void> {
    try {
      if (!Array.isArray(seeds) || seeds.length > 32) throw new TypeError('invalid seeds');
      const seen = new Set<string>();
      const normalized: Readonly<{ walletAddress: `0x${string}`; balanceAtomic: string }>[] =
        seeds.map((seed) => {
          const record = exactDataRecord(seed, ['walletAddress', 'balanceAtomic']);
          const walletAddress = normalizeEvmAddress(record.walletAddress);
          const balanceAtomic = canonicalBalance(record.balanceAtomic);
          if (seen.has(walletAddress)) throw new TypeError('duplicate wallet seed');
          seen.add(walletAddress);
          return Object.freeze({
            walletAddress: walletAddress as `0x${string}`,
            balanceAtomic,
          });
        });
      if (normalized.length === 0) return;
      const before = await this.control(CONTROL_STATUS_ACTION, null);
      const mutation = await this.control(CONTROL_SET_BALANCES_ACTION, Object.freeze(normalized));
      const after = await this.control(CONTROL_STATUS_ACTION, null);
      if (mutation !== before || after !== before) {
        throw new TypeError('local EVM instance changed while seeding');
      }
    } catch {
      throw new LocalEvmDevelopmentRuntimeError();
    }
  }

  async readNodeInstanceId(): Promise<string> {
    try {
      return await this.control(CONTROL_STATUS_ACTION, null);
    } catch {
      throw new LocalEvmDevelopmentRuntimeError();
    }
  }

  async readChainIdentity(
    request: Parameters<EvmStablecoinBalanceReaderPort['readChainIdentity']>[0],
  ): Promise<unknown> {
    return this.read(async () => {
      if (request.expectedNetworkId !== LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId) {
        throw new TypeError('unexpected local network');
      }
      return await this.assertIdentity();
    });
  }

  async readSourceBlock(
    request: Parameters<EvmStablecoinBalanceReaderPort['readSourceBlock']>[0],
  ): Promise<unknown> {
    return this.read(async () => {
      if (
        request.expectedNetworkId !== LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId ||
        request.selector !== 'latest'
      ) {
        throw new TypeError('unexpected local source block request');
      }
      return parseBlock(await this.rpc('eth_getBlockByNumber', ['latest', false]));
    });
  }

  async readTokenBalances(request: EvmTokenBalanceBatchReadRequest): Promise<unknown> {
    return this.read(async () => {
      if (
        request.expectedNetworkId !== LOCAL_EVM_DEVELOPMENT_MANIFEST.networkId ||
        !isAddress(request.walletAddress, { strict: true }) ||
        request.contractAddresses.length < 1 ||
        request.contractAddresses.length > LOCAL_EVM_DEVELOPMENT_MANIFEST.assets.length
      ) {
        throw new TypeError('unexpected local balance request');
      }
      const blockTag = quantityFromDecimal(request.sourceBlock.number);
      const pinnedBlock = parseBlock(await this.rpc('eth_getBlockByNumber', [blockTag, false]));
      if (
        pinnedBlock.number !== request.sourceBlock.number ||
        pinnedBlock.hash !== request.sourceBlock.hash ||
        pinnedBlock.parentHash !== request.sourceBlock.parentHash
      ) {
        throw new TypeError('local block pin changed');
      }
      const balances = [];
      const seen = new Set<string>();
      for (const contractAddress of request.contractAddresses) {
        const canonicalContract = normalizeEvmAddress(contractAddress);
        if (
          seen.has(canonicalContract) ||
          normalizeLocalEvmDevelopmentAsset(request.expectedNetworkId, canonicalContract) ===
            undefined
        ) {
          throw new TypeError('unexpected local stablecoin contract');
        }
        seen.add(canonicalContract);
        await this.assertContractCodeAtBlock(canonicalContract, blockTag);
        const result = await this.rpc('eth_call', [
          {
            to: canonicalContract,
            data: encodeFunctionData({
              abi: BALANCE_OF_ABI,
              functionName: 'balanceOf',
              args: [request.walletAddress],
            }),
          },
          blockTag,
        ]);
        await this.assertContractCodeAtBlock(canonicalContract, blockTag);
        if (typeof result !== 'string' || !HEX_WORD.test(result)) {
          throw new TypeError('invalid local balance result');
        }
        balances.push(
          Object.freeze({
            contractAddress: canonicalContract,
            balanceAtomic: BigInt(result).toString(),
          }),
        );
      }
      const postReadBlock = parseBlock(await this.rpc('eth_getBlockByNumber', [blockTag, false]));
      if (!sameBlock(postReadBlock, pinnedBlock)) {
        throw new TypeError('local block pin changed during read');
      }
      return Object.freeze({
        sourceBlockNumber: pinnedBlock.number,
        sourceBlockHash: pinnedBlock.hash,
        balances: Object.freeze(balances),
      });
    });
  }

  private async assertIdentity(): Promise<string> {
    const chainId = await this.rpc('eth_chainId', []);
    if (chainId !== LOCAL_EVM_DEVELOPMENT_MANIFEST.chainIdHex) {
      throw new TypeError('local EVM identity mismatch');
    }
    return chainId;
  }

  private async assertContractCodeAtBlock(
    contractAddress: string,
    blockTag: `0x${string}`,
  ): Promise<void> {
    const code = await this.rpc('eth_getCode', [contractAddress, blockTag]);
    if (code !== LOCAL_EVM_DEVELOPMENT_MANIFEST.mockStablecoinRuntimeBytecode) {
      throw new TypeError('local fixture code mismatch at pinned block');
    }
  }

  private async control(
    action: typeof CONTROL_STATUS_ACTION | typeof CONTROL_SET_BALANCES_ACTION,
    payload: null | readonly Readonly<{ walletAddress: `0x${string}`; balanceAtomic: string }>[],
  ): Promise<string> {
    if (
      this.config.mode !== 'enabled' ||
      this.config.apiHost !== '127.0.0.1' ||
      this.config.localEvmControl.url !== LOCAL_EVM_CONTROL_URL ||
      !LOWERCASE_HEX_128.test(this.config.localEvmControl.launchId) ||
      !LOWERCASE_HEX_256.test(this.config.localEvmControl.capability)
    ) {
      throw new TypeError('invalid local EVM control configuration');
    }
    const launchId = this.config.localEvmControl.launchId;
    const capability = this.config.localEvmControl.capability;
    const nonce = randomBytes(16).toString('hex');
    const proof = controlProof(capability, [
      LOCAL_EVM_CONTROL_DOMAIN,
      'request',
      launchId,
      nonce,
      action,
      payload,
    ]);
    const request = Object.freeze({
      schemaVersion: CONTROL_SCHEMA_VERSION,
      runtimeIdentity: LOCAL_EVM_DEVELOPMENT_MANIFEST.runtimeIdentity,
      launchId,
      nonce,
      action,
      payload,
      proof,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref();
    try {
      const response = await this.fetchImplementation(LOCAL_EVM_CONTROL_URL, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: Object.freeze({ accept: 'application/json', 'content-type': 'application/json' }),
        body: JSON.stringify(request),
      });
      if (
        response.status !== 200 ||
        response.redirected ||
        response.url !== LOCAL_EVM_CONTROL_URL ||
        !String(response.headers.get('content-type') ?? '').startsWith('application/json')
      ) {
        throw new TypeError('invalid local EVM control response');
      }
      const value = exactDataRecord(
        await readBoundedResponse(response, MAX_CONTROL_RESPONSE_BYTES),
        [
          'schemaVersion',
          'runtimeIdentity',
          'launchId',
          'nonce',
          'action',
          'status',
          'result',
          'proof',
        ],
      );
      const result = exactDataRecord(value.result, ['nodeInstanceId']);
      if (
        value.schemaVersion !== CONTROL_SCHEMA_VERSION ||
        value.runtimeIdentity !== LOCAL_EVM_DEVELOPMENT_MANIFEST.runtimeIdentity ||
        value.launchId !== launchId ||
        value.nonce !== nonce ||
        value.action !== action ||
        value.status !== 'RUNNING' ||
        typeof result.nodeInstanceId !== 'string' ||
        !LOWERCASE_HEX_128.test(result.nodeInstanceId) ||
        typeof value.proof !== 'string' ||
        !LOWERCASE_HEX_256.test(value.proof)
      ) {
        throw new TypeError('invalid local EVM control response');
      }
      const expectedProof = controlProof(capability, [
        LOCAL_EVM_CONTROL_DOMAIN,
        'response',
        launchId,
        nonce,
        action,
        'RUNNING',
        value.result,
      ]);
      if (!secureHexEquals(value.proof, expectedProof)) {
        throw new TypeError('unauthenticated local EVM control response');
      }
      return result.nodeInstanceId;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async read(operation: () => Promise<unknown>): Promise<unknown> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof EvmBalanceReadFailure) throw error;
      throw new EvmBalanceReadFailure('PERMANENT_FAILURE');
    }
  }

  private async rpc(method: LocalEvmRpcMethod, params: readonly unknown[]): Promise<unknown> {
    if (
      this.config.mode !== 'enabled' ||
      this.config.apiHost !== '127.0.0.1' ||
      this.config.localEvmRpcUrl !== LOCAL_EVM_DEVELOPMENT_MANIFEST.rpc.url
    ) {
      throw new EvmBalanceReadFailure('PERMANENT_FAILURE');
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref();
    try {
      const response = await this.fetchImplementation(LOCAL_EVM_DEVELOPMENT_MANIFEST.rpc.url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: Object.freeze({ accept: 'application/json', 'content-type': 'application/json' }),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      if (
        response.status !== 200 ||
        response.redirected ||
        response.url !== LOCAL_EVM_DEVELOPMENT_MANIFEST.rpc.url + '/' ||
        !String(response.headers.get('content-type') ?? '').startsWith('application/json')
      ) {
        throw new EvmBalanceReadFailure('TEMPORARY_UNAVAILABLE');
      }
      const value = parseRpcResponse(await readBoundedResponse(response, MAX_RESPONSE_BYTES), id);
      return value;
    } catch (error) {
      if (error instanceof EvmBalanceReadFailure) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new EvmBalanceReadFailure('TIMEOUT');
      }
      throw new EvmBalanceReadFailure('TEMPORARY_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new TypeError('invalid local RPC response length');
  }
  if (response.body === null) throw new TypeError('missing local RPC body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new TypeError('oversized local RPC response');
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

function parseRpcResponse(value: unknown, expectedId: number): unknown {
  const record = exactDataRecord(value, ['jsonrpc', 'id', 'result']);
  if (record.jsonrpc !== '2.0' || record.id !== expectedId) {
    throw new TypeError('invalid local RPC envelope');
  }
  return record.result;
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('expected data record');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new TypeError('unexpected data record');
  }
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError('invalid data record property');
    }
    record[key] = descriptor.value;
  }
  return record;
}

function parseBlock(
  value: unknown,
): Readonly<{ number: string; hash: string; parentHash: string }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('invalid local EVM block');
  }
  const record = value as Record<string, unknown>;
  const number = record.number;
  const hash = record.hash;
  const parentHash = record.parentHash;
  if (
    typeof number !== 'string' ||
    !HEX_QUANTITY.test(number) ||
    typeof hash !== 'string' ||
    !BLOCK_HASH.test(hash) ||
    typeof parentHash !== 'string' ||
    !BLOCK_HASH.test(parentHash)
  ) {
    throw new TypeError('invalid local EVM block');
  }
  return Object.freeze({ number: BigInt(number).toString(), hash, parentHash });
}

function canonicalBalance(value: unknown): string {
  if (typeof value !== 'string' || !UINT256.test(value)) {
    throw new TypeError('invalid local balance');
  }
  const numeric = BigInt(value);
  if (numeric > MAX_UINT256) throw new TypeError('invalid local balance');
  return numeric.toString();
}

function quantityFromDecimal(value: string): `0x${string}` {
  const canonical = canonicalBalance(value);
  return numberToHex(BigInt(canonical));
}

function sameBlock(
  left: Readonly<{ number: string; hash: string; parentHash: string }>,
  right: Readonly<{ number: string; hash: string; parentHash: string }>,
): boolean {
  return (
    left.number === right.number && left.hash === right.hash && left.parentHash === right.parentHash
  );
}

function controlProof(capability: string, message: readonly unknown[]): string {
  return createHmac('sha256', Buffer.from(capability, 'hex'))
    .update(JSON.stringify(message), 'utf8')
    .digest('hex');
}

function secureHexEquals(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
