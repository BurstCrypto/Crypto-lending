import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { chainObservationPolicyForNetwork } from '../../blockchain/domain/chain-observation-policy';
import {
  balanceRpcRequest,
  parseBalanceRpcResult,
} from '../../blockchain-sync/infrastructure/rpc/balance-json-rpc';
import {
  NodeHttpsBalanceJsonRpcTransport,
  type BoundedBalanceJsonRpcTransport,
  type NodeHttpsBalanceJsonRpcTransportConfig,
} from '../../blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport';
import {
  AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST,
  AAVE_V3_ETHEREUM_GET_RESERVE_TOKENS_ADDRESSES_SELECTOR,
  AAVE_V3_ETHEREUM_POOL,
  AAVE_V3_ETHEREUM_PROTOCOL_DATA_PROVIDER,
} from '../../smart-lending/infrastructure/aave/aave-v3-ethereum-deployment.manifest';
import type { ProviderPositionAdmissionEvmAnchorV1 } from '../application/provider-position-admission.coordinator';
import {
  AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
  AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
  type AaveV3EthereumFinalizedPositionTranscriptPort,
  type ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
} from './dormant-aave-v3-ethereum-provider-position.source';

const NETWORK = 'eip155:1';
const MAX_BYTES = 64 * 1024;
// Block RPC replies include transaction hashes even when full transactions are
// disabled. Bound their aggregate wire size independently of the compact result.
const MAX_RPC_BODY_BYTES = 1024 * 1024;
const MAX_DURATION_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const REQUEST_KEYS = [
  'transcriptVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'accountId',
  'correlationId',
  'walletId',
  'walletAddress',
  'providerId',
  'protocolId',
  'marketId',
  'networkId',
  'sourceFamilyId',
  'sourceId',
  'expectedChainId',
  'blockSelector',
  'blockBinding',
  'continuityFloor',
  'assets',
  'balanceReads',
  'maximumResponseBytes',
  'deadlineAt',
  'signal',
  'durableContext',
] as const;
const CONTEXT_KEYS = [
  'contextVersion',
  'use',
  'mayAuthorizeFinancialAction',
  'mayPersist',
  'accountId',
  'correlationId',
  'walletId',
  'networkId',
  'contextSourceFamilyId',
  'contextSourceId',
  'walletAddress',
  'continuityFloor',
  'resolvedAt',
] as const;

export interface AaveV3EthereumPositionRpcSourceBinding {
  readonly sourceFamilyId: string;
  readonly sourceId: string;
}

export class AaveV3EthereumPositionRpcTranscriptUnavailableError extends Error {
  readonly code = 'AAVE_V3_ETHEREUM_POSITION_RPC_TRANSCRIPT_UNAVAILABLE' as const;

  constructor() {
    super('Aave V3 Ethereum position data is unavailable.');
    this.name = 'AaveV3EthereumPositionRpcTranscriptUnavailableError';
  }
}

function unavailable(): never {
  throw new AaveV3EthereumPositionRpcTranscriptUnavailableError();
}

function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value))
    return unavailable();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (
    names.length > 64 ||
    names.some((name) => typeof name !== 'string') ||
    (keys !== undefined &&
      (names.length !== keys.length || keys.some((key) => !names.includes(key))))
  )
    return unavailable();
  const result: Record<string, unknown> = Object.create(null);
  for (const name of names as string[]) {
    const descriptor = descriptors[name];
    if (!descriptor?.enumerable || !('value' in descriptor)) return unavailable();
    result[name] = descriptor.value;
  }
  return result;
}

/** Bounded, canonical data snapshot; never invokes getters or toJSON. */
function snapshot(input: unknown): unknown {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 512 || depth > 8) return unavailable();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string' && value.length <= 4096) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (typeof value !== 'object' || value === null || isProxy(value) || seen.has(value))
      return unavailable();
    seen.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return unavailable();
      const descriptors = Object.getOwnPropertyDescriptors(
        value,
      ) as unknown as PropertyDescriptorMap;
      const length = descriptors.length?.value as unknown;
      if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > 32 ||
        Reflect.ownKeys(descriptors).length !== length + 1
      )
        return unavailable();
      const result = Object.freeze(
        Array.from({ length }, (_, index) => {
          const item = descriptors[String(index)];
          if (!item?.enumerable || !('value' in item)) return unavailable();
          return visit(item.value, depth + 1);
        }),
      );
      seen.delete(value);
      return result;
    }
    const fields = record(value);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(fields).sort()) result[key] = visit(fields[key], depth + 1);
    seen.delete(value);
    return Object.freeze(result);
  };
  const result = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 16 * 1024) return unavailable();
  return result;
}

function sameData(left: unknown, right: unknown): boolean {
  return JSON.stringify(snapshot(left)) === JSON.stringify(snapshot(right));
}

function time(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    return unavailable();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return unavailable();
  return parsed;
}

function aborted(signal: unknown): boolean {
  const getter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
  if (getter === undefined) return unavailable();
  return getter.call(signal) as boolean;
}

function floor(value: unknown): ProviderPositionAdmissionEvmAnchorV1 {
  const fields = record(value, ['kind', 'blockNumber', 'blockHash']);
  if (
    fields.kind !== 'EVM_BLOCK' ||
    typeof fields.blockNumber !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,77})$/u.test(fields.blockNumber) ||
    BigInt(fields.blockNumber) >= 1n << 256n ||
    typeof fields.blockHash !== 'string' ||
    !HASH.test(fields.blockHash) ||
    /^0x0{64}$/u.test(fields.blockHash)
  )
    return unavailable();
  return Object.freeze({
    kind: 'EVM_BLOCK',
    blockNumber: fields.blockNumber,
    blockHash: fields.blockHash,
  });
}

interface ReviewedRequest {
  readonly data: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1;
  readonly fingerprint: string;
  readonly signal: AbortSignal;
  readonly deadline: number;
}

function reviewRequest(
  input: unknown,
  binding: AaveV3EthereumPositionRpcSourceBinding,
  now: number,
): ReviewedRequest {
  const fields = record(input, REQUEST_KEYS);
  if (aborted(fields.signal)) return unavailable();
  const signal = fields.signal as AbortSignal;
  const data = snapshot({
    ...fields,
    signal: null,
  }) as ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1;
  const deadline = time(data.deadlineAt);
  if (
    !Number.isFinite(now) ||
    deadline <= now ||
    deadline - now > MAX_DURATION_MS ||
    data.transcriptVersion !== 1 ||
    data.use !== AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE ||
    data.mayAuthorizeFinancialAction !== false ||
    data.mayPersist !== false ||
    data.providerId !== 'aave' ||
    data.protocolId !== 'aave-v3' ||
    data.marketId !== AAVE_V3_ETHEREUM_POOL ||
    data.networkId !== NETWORK ||
    data.expectedChainId !== '0x1' ||
    data.blockSelector !== 'finalized' ||
    data.blockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' ||
    data.maximumResponseBytes !== MAX_BYTES ||
    data.sourceFamilyId !== binding.sourceFamilyId ||
    data.sourceId !== binding.sourceId ||
    typeof data.walletId !== 'string' ||
    !UUID.test(data.walletId) ||
    typeof data.correlationId !== 'string' ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u.test(data.correlationId) ||
    typeof data.walletAddress !== 'string' ||
    !ADDRESS.test(data.walletAddress) ||
    data.walletAddress === ZERO_ADDRESS
  )
    return unavailable();
  parseAccountId(data.accountId);
  const continuityFloor = floor(data.continuityFloor);
  const context = record(data.durableContext, CONTEXT_KEYS);
  if (
    context.contextVersion !== 1 ||
    context.use !== AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE ||
    context.mayAuthorizeFinancialAction !== false ||
    context.mayPersist !== false ||
    context.accountId !== data.accountId ||
    context.correlationId !== data.correlationId ||
    context.walletId !== data.walletId ||
    context.walletAddress !== data.walletAddress ||
    context.networkId !== NETWORK ||
    typeof context.contextSourceFamilyId !== 'string' ||
    !SOURCE_ID.test(context.contextSourceFamilyId) ||
    typeof context.contextSourceId !== 'string' ||
    !SOURCE_ID.test(context.contextSourceId) ||
    context.contextSourceFamilyId === binding.sourceFamilyId ||
    context.contextSourceId === binding.sourceId ||
    time(context.resolvedAt) > now ||
    now - time(context.resolvedAt) > MAX_DURATION_MS ||
    !sameData(context.continuityFloor, continuityFloor)
  )
    return unavailable();
  if (!Array.isArray(data.assets) || data.assets.length < 1 || data.assets.length > 2)
    return unavailable();
  const seen = new Set<string>();
  const expectedReads = [];
  for (const asset of data.assets) {
    if ((asset.stablecoin !== 'USDC' && asset.stablecoin !== 'USDT') || seen.has(asset.stablecoin))
      return unavailable();
    seen.add(asset.stablecoin);
    const definition =
      AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets[asset.stablecoin as 'USDC' | 'USDT'];
    if (
      !sameData(asset, {
        stablecoin: asset.stablecoin,
        identity: definition.underlyingAsset,
        networkId: NETWORK,
        decimals: 6,
      })
    )
      return unavailable();
    for (const positionKind of ['SUPPLY', 'BORROW'] as const) {
      expectedReads.push({
        operationId: `${asset.stablecoin.toLowerCase()}-${positionKind.toLowerCase()}`,
        stablecoin: asset.stablecoin,
        positionKind,
        tokenAddress: positionKind === 'SUPPLY' ? definition.aToken : definition.variableDebtToken,
        callData: `0x70a08231${data.walletAddress.slice(2).padStart(64, '0')}`,
      });
    }
  }
  if (!sameData(data.balanceReads, expectedReads)) return unavailable();
  return {
    data,
    signal,
    deadline,
    fingerprint: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  };
}

interface Block {
  readonly number: string;
  readonly hash: string;
  readonly timestamp: string;
}

function block(value: unknown): Block {
  const fields = record(value);
  if (
    typeof fields.number !== 'string' ||
    !QUANTITY.test(fields.number) ||
    typeof fields.hash !== 'string' ||
    !HASH.test(fields.hash) ||
    /^0x0{64}$/u.test(fields.hash) ||
    typeof fields.timestamp !== 'string' ||
    !QUANTITY.test(fields.timestamp)
  )
    return unavailable();
  return Object.freeze({ number: fields.number, hash: fields.hash, timestamp: fields.timestamp });
}

function reserveAddresses(value: unknown): readonly string[] {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{192}$/u.test(value)) return unavailable();
  return [0, 1, 2].map((index) => {
    const word = value.slice(2 + index * 64, 2 + (index + 1) * 64);
    if (!/^0{24}/u.test(word)) return unavailable();
    return `0x${word.slice(24)}`;
  });
}

function capturedExchange(
  transport: BoundedBalanceJsonRpcTransport,
): BoundedBalanceJsonRpcTransport['exchangeBounded'] {
  if (typeof transport !== 'object' || transport === null || isProxy(transport))
    return unavailable();
  let owner: object | null = transport;
  for (let depth = 0; owner !== null && depth < 4; depth++) {
    if (isProxy(owner)) return unavailable();
    const descriptor = Object.getOwnPropertyDescriptor(owner, 'exchangeBounded');
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') return unavailable();
      const method = descriptor.value as BoundedBalanceJsonRpcTransport['exchangeBounded'];
      return (request, signal, maximumResponseBytes) =>
        method.call(transport, request, signal, maximumResponseBytes);
    }
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return unavailable();
}

/**
 * Executes the missing position transcript over bounded HTTPS JSON-RPC. Only
 * the source-owned read plan is accepted. Import/construction do no I/O, and
 * this class is not registered in the application. Durable wallet ownership,
 * deployment approval and independent-source agreement remain outer boundaries.
 */
export class AaveV3EthereumPositionRpcTranscriptSource implements AaveV3EthereumFinalizedPositionTranscriptPort {
  readonly transcriptVersion = 1 as const;
  readonly sourceFamilyId: string;
  readonly sourceId: string;
  readonly #exchange: BoundedBalanceJsonRpcTransport['exchangeBounded'];
  readonly #issued = new WeakMap<
    object,
    {
      request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1;
      reviewed: ReviewedRequest;
      lastCheckedAt: number;
      staleAfter: number;
    }
  >();

  constructor(
    binding: AaveV3EthereumPositionRpcSourceBinding,
    transport: BoundedBalanceJsonRpcTransport,
  ) {
    const fields = record(binding, ['sourceFamilyId', 'sourceId']);
    if (
      typeof fields.sourceFamilyId !== 'string' ||
      !SOURCE_ID.test(fields.sourceFamilyId) ||
      typeof fields.sourceId !== 'string' ||
      !SOURCE_ID.test(fields.sourceId)
    )
      unavailable();
    this.sourceFamilyId = fields.sourceFamilyId;
    this.sourceId = fields.sourceId;
    this.#exchange = capturedExchange(transport);
    Object.freeze(this);
  }

  async readTranscript(
    input: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detach: (() => void) | undefined;
    const controller = new AbortController();
    try {
      let lastTime = Date.now();
      const reviewed = reviewRequest(input, this, lastTime);
      const { data, signal, deadline } = reviewed;
      const abort = (): void => controller.abort();
      AbortSignal.prototype.addEventListener.call(signal, 'abort', abort, { once: true });
      detach = () => AbortSignal.prototype.removeEventListener.call(signal, 'abort', abort);
      timer = setTimeout(abort, deadline - lastTime);
      const check = (): number => {
        const now = Date.now();
        if (aborted(signal) || controller.signal.aborted || now < lastTime || now >= deadline)
          return unavailable();
        lastTime = now;
        return now;
      };
      let remainingBytes = MAX_RPC_BODY_BYTES;
      const read = async (method: string, params: readonly unknown[]): Promise<unknown> => {
        check();
        if (remainingBytes < 1) return unavailable();
        const request = balanceRpcRequest(method, params);
        const reply = record(await this.#exchange(request, controller.signal, remainingBytes), [
          'value',
          'bodyBytes',
        ]);
        check();
        if (
          typeof reply.bodyBytes !== 'number' ||
          !Number.isSafeInteger(reply.bodyBytes) ||
          reply.bodyBytes < 1 ||
          reply.bodyBytes > remainingBytes
        )
          return unavailable();
        remainingBytes -= reply.bodyBytes;
        return parseBalanceRpcResult(reply.value, request.id);
      };

      const chainIdBefore = await read('eth_chainId', []);
      if (chainIdBefore !== '0x1') return unavailable();
      const before = block(await read('eth_getBlockByNumber', ['finalized', false]));
      const policy = chainObservationPolicyForNetwork(NETWORK);
      const blockTime = BigInt(before.timestamp) * 1000n;
      if (
        policy === null ||
        policy === undefined ||
        blockTime > BigInt(check()) ||
        BigInt(lastTime) - blockTime >= BigInt(policy.finality.stallAfterMs)
      )
        return unavailable();
      const continuity = data.continuityFloor;
      if (BigInt(before.number) < BigInt(continuity.blockNumber)) return unavailable();
      const floorBlock = block(
        await read('eth_getBlockByNumber', [
          `0x${BigInt(continuity.blockNumber).toString(16)}`,
          false,
        ]),
      );
      if (
        BigInt(floorBlock.number).toString() !== continuity.blockNumber ||
        floorBlock.hash !== continuity.blockHash ||
        (floorBlock.number === before.number && floorBlock.hash !== before.hash)
      )
        return unavailable();
      const blockParameter = Object.freeze({ blockHash: before.hash, requireCanonical: true });
      const reserveTokens = [];
      for (const asset of data.assets) {
        const addresses = reserveAddresses(
          await read('eth_call', [
            {
              to: AAVE_V3_ETHEREUM_PROTOCOL_DATA_PROVIDER,
              data: `${AAVE_V3_ETHEREUM_GET_RESERVE_TOKENS_ADDRESSES_SELECTOR}${asset.identity.slice(2).padStart(64, '0')}`,
            },
            blockParameter,
          ]),
        );
        const expected =
          AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets[asset.stablecoin as 'USDC' | 'USDT'];
        if (!sameData(addresses, [expected.aToken, ZERO_ADDRESS, expected.variableDebtToken]))
          return unavailable();
        reserveTokens.push({
          stablecoin: asset.stablecoin,
          underlyingAsset: asset.identity,
          aTokenAddress: addresses[0],
          stableDebtTokenAddress: addresses[1],
          variableDebtTokenAddress: addresses[2],
        });
      }
      const balanceReads = [];
      for (const operation of data.balanceReads) {
        const result = await read('eth_call', [
          { to: operation.tokenAddress, data: operation.callData },
          blockParameter,
        ]);
        if (typeof result !== 'string' || !/^0x[0-9a-f]{64}$/u.test(result)) return unavailable();
        balanceReads.push({ ...operation, method: 'eth_call', blockParameter, result });
      }
      const after = block(await read('eth_getBlockByNumber', [before.number, false]));
      if (!sameData(before, after)) return unavailable();
      const chainIdAfter = await read('eth_chainId', []);
      if (chainIdAfter !== '0x1') return unavailable();
      const observed = check();
      if (reviewRequest(input, this, observed).fingerprint !== reviewed.fingerprint)
        return unavailable();
      const staleAfter = observed + policy.freshness.currentWithinMs;
      const result = snapshot({
        transcriptVersion: 1,
        use: AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        accountId: data.accountId,
        correlationId: data.correlationId,
        walletId: data.walletId,
        walletAddress: data.walletAddress,
        providerId: data.providerId,
        protocolId: data.protocolId,
        marketId: data.marketId,
        networkId: data.networkId,
        sourceFamilyId: data.sourceFamilyId,
        sourceId: data.sourceId,
        chainIdBefore,
        chainIdAfter,
        blockBefore: { number: before.number, hash: before.hash },
        blockAfter: { number: after.number, hash: after.hash },
        reserveTokens,
        balanceReads,
        observedAt: new Date(observed).toISOString(),
        staleAfter: new Date(staleAfter).toISOString(),
        status: 'COMPLETE',
        zeroPositionSemantics: 'EXPLICIT_ZERO_BALANCE_FOR_EVERY_REQUESTED_ASSET',
      }) as object;
      this.#issued.set(result, { request: input, reviewed, lastCheckedAt: observed, staleAfter });
      return result;
    } catch {
      return unavailable();
    } finally {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      detach?.();
    }
  }

  verifyTranscript(
    capability: unknown,
    request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  ): boolean {
    if (typeof capability !== 'object' || capability === null) return false;
    const issued = this.#issued.get(capability);
    if (issued === undefined) return false;
    if (request !== issued.request) return false;
    try {
      const now = Date.now();
      if (
        now < issued.lastCheckedAt ||
        now >= issued.staleAfter ||
        request.signal !== issued.reviewed.signal ||
        reviewRequest(request, this, now).fingerprint !== issued.reviewed.fingerprint
      ) {
        this.#issued.delete(capability);
        return false;
      }
      issued.lastCheckedAt = now;
      return true;
    } catch {
      this.#issued.delete(capability);
      return false;
    }
  }
}

/** Private composition entry for a configured endpoint; does not activate a route. */
export function createAaveV3EthereumPositionRpcTranscriptSource(
  binding: AaveV3EthereumPositionRpcSourceBinding,
  config: NodeHttpsBalanceJsonRpcTransportConfig,
): AaveV3EthereumPositionRpcTranscriptSource {
  if (record(config, ['networkId', 'hostname', 'path', 'credential']).networkId !== NETWORK)
    return unavailable();
  return new AaveV3EthereumPositionRpcTranscriptSource(
    binding,
    new NodeHttpsBalanceJsonRpcTransport(config),
  );
}
