import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { CHAIN_OBSERVATION_RESILIENCE_POLICY } from '../../../blockchain/domain/chain-observation-policy';
import type {
  AaveV3EthereumDeploymentReadOperation,
  AaveV3EthereumFinalizedRpcSource,
  ReadAaveV3EthereumFinalizedRpcObservationRequest,
} from './aave-v3-ethereum-finalized-rpc.source';
import {
  AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN,
  AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
} from './aave-v3-ethereum-finalized-rpc.plan';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPAQUE_REFERENCE = /^[a-z0-9][a-z0-9._:-]{2,127}$/u;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/u;
const MAXIMUM_OBSERVATION_MILLISECONDS = CHAIN_OBSERVATION_RESILIENCE_POLICY.reads.requestTimeoutMs;
const CONNECT_TIMEOUT_MILLISECONDS = CHAIN_OBSERVATION_RESILIENCE_POLICY.reads.connectTimeoutMs;
const OBSERVATION_ID_DOMAIN = 'crypto-lending:aave-v3-ethereum-rpc-observation:v1' as const;

export interface FixedAaveV3EthereumJsonRpcSourceConfig {
  readonly endpoint: string;
  readonly sourceReferenceId: string;
}

export class AaveV3EthereumJsonRpcSourceUnavailableError extends Error {
  readonly code = 'AAVE_V3_ETHEREUM_JSON_RPC_SOURCE_UNAVAILABLE' as const;

  constructor() {
    super('Aave V3 Ethereum JSON-RPC source is unavailable');
    this.name = 'AaveV3EthereumJsonRpcSourceUnavailableError';
  }
}

interface ParsedConfig {
  readonly endpointHref: string;
  readonly sourceReferenceId: string;
}

interface ParsedRequest {
  readonly deadlineAtMilliseconds: number;
  readonly signal: AbortSignal;
}

interface AggregateByteBudget {
  usedBytes: number;
  readonly maximumBytes: number;
}

interface ObservationContext {
  readonly deadlineAtMilliseconds: number;
  readonly signal: AbortSignal;
  readonly abort: () => void;
  readonly byteBudget: AggregateByteBudget;
}

interface FinalizedBlockHeader {
  readonly number: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly timestamp: string;
}

function unavailable(): never {
  throw new AaveV3EthereumJsonRpcSourceUnavailableError();
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') return unavailable();
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) return unavailable();
    record[key] = descriptor.value;
  }
  return record;
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  const record = dataRecord(value);
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    return unavailable();
  }
  return record;
}

function potentiallyPublicDnsHostname(value: string): boolean {
  const hostname = value.toLowerCase();
  const unbracketed =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (isIP(unbracketed) !== 0 || hostname.endsWith('.')) return false;
  const labels = hostname.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  ) {
    return false;
  }
  return ![
    'localhost',
    'local',
    'internal',
    'lan',
    'localdomain',
    'home.arpa',
    'invalid',
    'test',
    'example',
    'onion',
  ].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function parseConfig(value: unknown): ParsedConfig {
  const record = exactDataRecord(value, ['endpoint', 'sourceReferenceId']);
  if (
    typeof record.endpoint !== 'string' ||
    typeof record.sourceReferenceId !== 'string' ||
    !OPAQUE_REFERENCE.test(record.sourceReferenceId)
  ) {
    return unavailable();
  }
  let endpoint: URL;
  try {
    endpoint = new URL(record.endpoint);
  } catch {
    return unavailable();
  }
  if (
    endpoint.protocol !== 'https:' ||
    !potentiallyPublicDnsHostname(endpoint.hostname) ||
    endpoint.port !== '' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    return unavailable();
  }
  return Object.freeze({
    endpointHref: endpoint.href,
    sourceReferenceId: record.sourceReferenceId,
  });
}

function parseRequest(value: unknown): ParsedRequest {
  const record = exactDataRecord(value, ['correlationId', 'deadlineAt', 'signal', 'plan']);
  if (
    typeof record.correlationId !== 'string' ||
    !UUID_V4.test(record.correlationId) ||
    typeof record.deadlineAt !== 'string' ||
    !(record.signal instanceof AbortSignal) ||
    record.plan !== AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN
  ) {
    return unavailable();
  }
  const deadlineAtMilliseconds = Date.parse(record.deadlineAt);
  const now = Date.now();
  if (
    !Number.isFinite(deadlineAtMilliseconds) ||
    new Date(deadlineAtMilliseconds).toISOString() !== record.deadlineAt ||
    deadlineAtMilliseconds <= now ||
    deadlineAtMilliseconds - now > MAXIMUM_OBSERVATION_MILLISECONDS ||
    record.signal.aborted
  ) {
    return unavailable();
  }
  return Object.freeze({
    deadlineAtMilliseconds,
    signal: record.signal,
  });
}

function assertActive(context: ObservationContext): void {
  if (context.signal.aborted || Date.now() >= context.deadlineAtMilliseconds) return unavailable();
}

function beforeAbort<T>(operation: Promise<T>, context: ObservationContext): Promise<T> {
  assertActive(context);
  return new Promise<T>((resolve, reject) => {
    const rejectUnavailable = (): void => reject(new AaveV3EthereumJsonRpcSourceUnavailableError());
    const cleanup = (): void => context.signal.removeEventListener('abort', rejectUnavailable);
    context.signal.addEventListener('abort', rejectUnavailable, { once: true });
    if (context.signal.aborted) {
      cleanup();
      rejectUnavailable();
      return;
    }
    operation.then(
      (value) => {
        cleanup();
        if (context.signal.aborted || Date.now() >= context.deadlineAtMilliseconds) {
          rejectUnavailable();
          return;
        }
        resolve(value);
      },
      () => {
        cleanup();
        rejectUnavailable();
      },
    );
  });
}

function jsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}

function cancelBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation !== undefined) void cancellation.catch(() => undefined);
  } catch {
    // Cleanup failure never changes the sanitized source error contract.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cleanup failure never changes the sanitized source error contract.
  }
}

async function boundedJson(response: Response, context: ObservationContext): Promise<unknown> {
  if (!jsonContentType(response.headers.get('content-type'))) {
    cancelBody(response);
    return unavailable();
  }
  const declaredLength = response.headers.get('content-length');
  const remainingBytes = context.byteBudget.maximumBytes - context.byteBudget.usedBytes;
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > remainingBytes)
  ) {
    cancelBody(response);
    return unavailable();
  }
  if (response.body === null) return unavailable();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let responseBytes = 0;
  try {
    for (;;) {
      const next = await beforeAbort(reader.read(), context);
      if (next.done) break;
      if (next.value.byteLength === 0) continue;
      context.byteBudget.usedBytes += next.value.byteLength;
      responseBytes += next.value.byteLength;
      if (context.byteBudget.usedBytes > context.byteBudget.maximumBytes) {
        cancelReader(reader);
        return unavailable();
      }
      chunks.push(next.value);
    }
  } catch {
    cancelReader(reader);
    return unavailable();
  }

  const bytes = new Uint8Array(responseBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  assertActive(context);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return unavailable();
  }
}

function rpcResult(value: unknown, expectedId: number): unknown {
  const envelope = exactDataRecord(value, ['jsonrpc', 'id', 'result']);
  if (envelope.jsonrpc !== '2.0' || envelope.id !== expectedId) return unavailable();
  return envelope.result;
}

function blockHeader(value: unknown): FinalizedBlockHeader {
  const record = dataRecord(value);
  for (const key of ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp'] as const) {
    if (!Object.hasOwn(record, key)) return unavailable();
  }
  if (
    typeof record.number !== 'string' ||
    !HEX_QUANTITY.test(record.number) ||
    typeof record.hash !== 'string' ||
    !BLOCK_HASH.test(record.hash) ||
    typeof record.parentHash !== 'string' ||
    !BLOCK_HASH.test(record.parentHash) ||
    typeof record.stateRoot !== 'string' ||
    !BLOCK_HASH.test(record.stateRoot) ||
    typeof record.timestamp !== 'string' ||
    !HEX_QUANTITY.test(record.timestamp)
  ) {
    return unavailable();
  }
  return Object.freeze({
    number: record.number,
    hash: record.hash,
    parentHash: record.parentHash,
    stateRoot: record.stateRoot,
    timestamp: record.timestamp,
  });
}

function hexData(value: unknown): string {
  if (typeof value !== 'string' || !HEX_DATA.test(value)) return unavailable();
  return value;
}

function stateReadParameters(
  operation: AaveV3EthereumDeploymentReadOperation,
  blockHash: string,
): readonly unknown[] {
  const blockParameter = Object.freeze({ blockHash, requireCanonical: true as const });
  if (operation.method === 'eth_getCode') return [operation.target, blockParameter];
  const transaction = Object.freeze({
    to: operation.target,
    data: operation.calldata,
    ...(operation.from === undefined ? {} : { from: operation.from }),
  });
  return [transaction, blockParameter];
}

function operationValue(results: ReadonlyMap<string, string>, operationId: string): string {
  const value = results.get(operationId);
  if (value === undefined) return unavailable();
  return value;
}

function operationBlockBindings(blockHash: string): Readonly<Record<string, unknown>> {
  const bindings: Record<string, unknown> = {};
  for (const { operationId } of AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.operations) {
    bindings[operationId] = Object.freeze({ blockHash, requireCanonical: true });
  }
  return Object.freeze(bindings);
}

function sourceObservationId(
  sourceReferenceId: string,
  before: FinalizedBlockHeader,
  results: ReadonlyMap<string, string>,
  after: FinalizedBlockHeader,
): string {
  return `rpc-observation:${createHash('sha256')
    .update(
      JSON.stringify([
        OBSERVATION_ID_DOMAIN,
        sourceReferenceId,
        AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
        before,
        AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.operations.map(({ operationId }) => [
          operationId,
          operationValue(results, operationId),
        ]),
        after,
      ]),
      'utf8',
    )
    .digest('hex')}`;
}

/**
 * Dormant candidate transport for one explicitly approved Ethereum mainnet RPC
 * endpoint. This class is intentionally not registered in SmartLendingModule;
 * constructing and binding it is a separate provider/egress approval step.
 */
export class FixedAaveV3EthereumJsonRpcSource implements AaveV3EthereumFinalizedRpcSource {
  private readonly config: ParsedConfig;

  constructor(
    config: FixedAaveV3EthereumJsonRpcSourceConfig,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {
    this.config = (() => {
      try {
        return parseConfig(config);
      } catch {
        return unavailable();
      }
    })();
    if (typeof fetchImplementation !== 'function') return unavailable();
  }

  async readFinalizedDeployment(
    request: ReadAaveV3EthereumFinalizedRpcObservationRequest,
  ): Promise<unknown> {
    let controller: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let suppliedSignal: AbortSignal | undefined;
    let forwardAbort: (() => void) | undefined;
    try {
      const parsedRequest = parseRequest(request);
      controller = new AbortController();
      suppliedSignal = parsedRequest.signal;
      forwardAbort = (): void => controller?.abort();
      suppliedSignal.addEventListener('abort', forwardAbort, { once: true });
      if (suppliedSignal.aborted) return unavailable();
      timeout = setTimeout(
        () => controller?.abort(),
        parsedRequest.deadlineAtMilliseconds - Date.now(),
      );
      timeout.unref?.();
      const context: ObservationContext = {
        deadlineAtMilliseconds: parsedRequest.deadlineAtMilliseconds,
        signal: controller.signal,
        abort: () => controller?.abort(),
        byteBudget: {
          usedBytes: 0,
          maximumBytes: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.maximumAggregateResponseBytes,
        },
      };
      const result = await this.executeTranscript(context);
      assertActive(context);
      return result;
    } catch {
      controller?.abort();
      return unavailable();
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (suppliedSignal !== undefined && forwardAbort !== undefined) {
        suppliedSignal.removeEventListener('abort', forwardAbort);
      }
    }
  }

  private async executeTranscript(context: ObservationContext): Promise<unknown> {
    const chainId = await this.request(1, 'eth_chainId', [], context);
    if (chainId !== AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.expectedChainId) {
      return unavailable();
    }
    const before = blockHeader(
      await this.request(
        2,
        'eth_getBlockByNumber',
        [
          AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.blockAcquisition.initialSelector,
          AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.blockAcquisition.includeTransactions,
        ],
        context,
      ),
    );

    const results = new Map<string, string>();
    for (const [
      index,
      operation,
    ] of AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.operations.entries()) {
      const result = await this.request(
        index + 3,
        operation.method,
        stateReadParameters(operation, before.hash),
        context,
      );
      results.set(operation.operationId, hexData(result));
    }

    const after = blockHeader(
      await this.request(19, 'eth_getBlockByNumber', [before.number, false], context),
    );
    const code = Object.freeze({
      poolAddressesProvider: operationValue(results, 'code:pool-addresses-provider'),
      poolProxy: operationValue(results, 'code:pool-proxy'),
      poolImplementation: operationValue(results, 'code:pool-implementation'),
      protocolDataProvider: operationValue(results, 'code:protocol-data-provider'),
      usdcAToken: operationValue(results, 'code:usdc-atoken'),
      usdcVariableDebtToken: operationValue(results, 'code:usdc-variable-debt-token'),
      usdtAToken: operationValue(results, 'code:usdt-atoken'),
      usdtVariableDebtToken: operationValue(results, 'code:usdt-variable-debt-token'),
    });
    const calls = Object.freeze({
      providerGetPool: operationValue(results, 'call:provider-get-pool'),
      providerGetPoolDataProvider: operationValue(results, 'call:provider-get-data-provider'),
      poolAddressesProvider: operationValue(results, 'call:pool-addresses-provider'),
      dataProviderAddressesProvider: operationValue(
        results,
        'call:data-provider-addresses-provider',
      ),
      dataProviderPool: operationValue(results, 'call:data-provider-pool'),
      poolImplementationFromAdmin: operationValue(results, 'call:pool-implementation-from-admin'),
      usdcReserveTokens: operationValue(results, 'call:usdc-reserve-tokens'),
      usdtReserveTokens: operationValue(results, 'call:usdt-reserve-tokens'),
    });
    return Object.freeze({
      schemaVersion: 1,
      sourceReferenceId: this.config.sourceReferenceId,
      sourceObservationId: sourceObservationId(
        this.config.sourceReferenceId,
        before,
        results,
        after,
      ),
      networkId: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.networkId,
      chainId,
      blockSelector: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.blockSelector,
      blockBinding: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.blockBinding,
      manifestFingerprintSha256: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.manifestFingerprintSha256,
      assetRegistryFingerprintSha256:
        AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.assetRegistryFingerprintSha256,
      readPlanFingerprintSha256: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
      finalizedBlockBefore: before,
      finalizedBlockAfter: after,
      operationBlockBindings: operationBlockBindings(before.hash),
      code,
      calls,
    });
  }

  private async request(
    id: number,
    method: 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call',
    params: readonly unknown[],
    context: ObservationContext,
  ): Promise<unknown> {
    assertActive(context);
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const connectTimeout = setTimeout(
      context.abort,
      Math.min(CONNECT_TIMEOUT_MILLISECONDS, context.deadlineAtMilliseconds - Date.now()),
    );
    connectTimeout.unref?.();
    let response: Response;
    try {
      response = await beforeAbort(
        this.fetchImplementation(this.config.endpointHref, {
          method: 'POST',
          headers: Object.freeze({
            accept: 'application/json',
            'content-type': 'application/json',
          }),
          body,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal: context.signal,
        }),
        context,
      );
    } finally {
      clearTimeout(connectTimeout);
    }
    assertActive(context);
    if (
      response.status !== 200 ||
      response.redirected ||
      response.url !== this.config.endpointHref
    ) {
      cancelBody(response);
      return unavailable();
    }
    return rpcResult(await boundedJson(response, context), id);
  }
}
