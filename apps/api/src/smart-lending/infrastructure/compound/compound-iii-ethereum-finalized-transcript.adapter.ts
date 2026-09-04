import { createHash } from 'node:crypto';

import {
  compoundIIIUSDCManifestFingerprintSha256,
  parseCompoundIIIUSDCFinalizedManifest,
  type CompoundIIIUSDCFinalizedManifest,
} from './compound-iii-ethereum-usdc.manifest';

const SHA256 = /^[0-9a-f]{64}$/u;
const DATE_GET_TIME = Date.prototype.getTime;
const DATE_TO_ISO_STRING = Date.prototype.toISOString;
const HASH = /^0x[0-9a-f]{64}$/u;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const DATA = /^0x(?:[0-9a-f]{2})*$/u;
const WORD = /^0x[0-9a-f]{64}$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_CODE_BYTES = 65_536;
const RATE_SCALE = 1_000_000_000_000_000_000n;
const SECONDS_PER_YEAR = 31_536_000n;
const MAX_APR_BPS = 1_000_000n;
const IMPLEMENTATION = '0x5c60da1b';
const BASE_TOKEN = '0xc55dae63';
const BASE_SCALE = '0x44c1e5eb';
const DECIMALS = '0x313ce567';
const TOTAL_SUPPLY = '0x18160ddd';
const GET_UTILIZATION = '0x7eb71131';
const GET_SUPPLY_RATE = '0xd955759d';
const IS_SUPPLY_PAUSED = '0x0bc47ad1';
const BLOCK_KEYS = [
  'baseFeePerGas',
  'blobGasUsed',
  'difficulty',
  'excessBlobGas',
  'extraData',
  'gasLimit',
  'gasUsed',
  'hash',
  'logsBloom',
  'miner',
  'mixHash',
  'nonce',
  'number',
  'parentBeaconBlockRoot',
  'parentHash',
  'receiptsRoot',
  'requestsHash',
  'sha3Uncles',
  'size',
  'stateRoot',
  'timestamp',
  'totalDifficulty',
  'transactions',
  'transactionsRoot',
  'uncles',
  'withdrawals',
  'withdrawalsRoot',
] as const;

export interface CompoundIIIJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call';
  readonly params: readonly unknown[];
}

/** Owns no endpoint, client, retry, credentials, DNS, TLS, or egress policy. */
export interface CompoundIIIJsonRpcTransport {
  exchange(request: CompoundIIIJsonRpcRequest): Promise<unknown>;
}

export interface CompoundIIITranscriptClock {
  now(): Date;
}

export interface CompoundIIIUSDCFinalizedCandidate {
  readonly schemaVersion: 1;
  readonly use: 'NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE';
  readonly providerId: 'compound';
  readonly protocolId: 'compound-iii';
  readonly networkId: 'eip155:1';
  readonly marketId: 'compound-iii-ethereum-usdc';
  readonly asset: Readonly<{ symbol: 'USDC'; address: string; decimals: 6 }>;
  readonly finalizedBlock: Readonly<{
    number: string;
    hash: string;
    parentHash: string;
    stateRoot: string;
    timestamp: string;
  }>;
  readonly observation: Readonly<{
    totalSuppliedAtomic: bigint;
    utilizationFactor: bigint;
    supplyRatePerSecondFactor: bigint;
    annualizedSupplyAprBasisPoints: bigint;
    providerSupplyStatus: 'OPEN' | 'CLOSED';
  }>;
  readonly manifestFingerprintSha256: string;
  readonly transcriptFingerprintSha256: string;
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly authenticity: 'SINGLE_UNTRUSTED_RPC_TRANSCRIPT';
  readonly mayPersist: false;
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
}

export class CompoundIIITranscriptUnavailableError extends Error {
  readonly code = 'COMPOUND_III_TRANSCRIPT_UNAVAILABLE' as const;
  constructor() {
    super('Compound III finalized transcript is unavailable');
    this.name = 'CompoundIIITranscriptUnavailableError';
  }
}

interface Header {
  number: string;
  hash: string;
  parentHash: string;
  stateRoot: string;
  timestamp: string;
}

function unavailable(): never {
  throw new CompoundIIITranscriptUnavailableError();
}

export class CompoundIIIEthereumFinalizedTranscriptAdapter {
  private readonly manifest: CompoundIIIUSDCFinalizedManifest;
  private readonly manifestFingerprint: string;

  constructor(
    manifest: unknown,
    requiredManifestFingerprintSha256: unknown,
    private readonly transport: CompoundIIIJsonRpcTransport,
    private readonly clock: CompoundIIITranscriptClock,
  ) {
    try {
      this.manifest = parseCompoundIIIUSDCFinalizedManifest(manifest);
      this.manifestFingerprint = compoundIIIUSDCManifestFingerprintSha256(this.manifest);
      if (
        typeof requiredManifestFingerprintSha256 !== 'string' ||
        !SHA256.test(requiredManifestFingerprintSha256) ||
        requiredManifestFingerprintSha256 !== this.manifestFingerprint ||
        typeof transport?.exchange !== 'function' ||
        typeof clock?.now !== 'function'
      )
        unavailable();
    } catch (error) {
      if (error instanceof CompoundIIITranscriptUnavailableError) throw error;
      unavailable();
    }
  }

  async readFinalizedMarket(request: unknown): Promise<CompoundIIIUSDCFinalizedCandidate> {
    try {
      const input = exactRecord(request, ['selector']);
      if (input.selector !== 'finalized') unavailable();
      if ((await this.rpc(1, 'eth_chainId', [])) !== '0x1') unavailable();
      const before = header(await this.rpc(2, 'eth_getBlockByNumber', ['finalized', false]));
      const block = Object.freeze({ blockHash: before.hash, requireCanonical: true as const });
      const proxyCode = await this.checkedCode(
        3,
        this.manifest.cometProxy,
        block,
        this.manifest.runtimeCodeSha256.cometProxy,
      );
      const implementationCode = await this.checkedCode(
        4,
        this.manifest.implementation,
        block,
        this.manifest.runtimeCodeSha256.implementation,
      );
      const assetCode = await this.checkedCode(
        5,
        this.manifest.baseAsset.address,
        block,
        this.manifest.runtimeCodeSha256.baseAsset,
      );
      const implementation = decodeAddress(
        await this.call(
          6,
          this.manifest.cometProxy,
          IMPLEMENTATION,
          block,
          this.manifest.proxyAdmin,
        ),
      );
      if (implementation !== this.manifest.implementation) unavailable();
      if (
        decodeAddress(await this.call(7, this.manifest.cometProxy, BASE_TOKEN, block)) !==
        this.manifest.baseAsset.address
      )
        unavailable();
      if (
        decodeUint(await this.call(8, this.manifest.cometProxy, BASE_SCALE, block)) !== 1_000_000n
      )
        unavailable();
      if (decodeUint(await this.call(9, this.manifest.cometProxy, DECIMALS, block)) !== 6n)
        unavailable();
      if (decodeUint(await this.call(10, this.manifest.baseAsset.address, DECIMALS, block)) !== 6n)
        unavailable();
      const totalSupply = decodeUint(
        await this.call(11, this.manifest.cometProxy, TOTAL_SUPPLY, block),
      );
      const utilization = decodeUint(
        await this.call(12, this.manifest.cometProxy, GET_UTILIZATION, block),
      );
      const rate = decodeUint(
        await this.call(
          13,
          this.manifest.cometProxy,
          `${GET_SUPPLY_RATE}${word(utilization)}`,
          block,
        ),
      );
      if (rate > MAX_UINT64) unavailable();
      const paused = decodeBool(
        await this.call(14, this.manifest.cometProxy, IS_SUPPLY_PAUSED, block),
      );
      const after = header(await this.rpc(15, 'eth_getBlockByNumber', [before.number, false]));
      if (!sameHeader(before, after) || (await this.rpc(16, 'eth_chainId', [])) !== '0x1')
        unavailable();
      const observedAt = canonicalNow(this.clock.now());
      const observedSeconds = BigInt(Math.floor(Date.parse(observedAt) / 1000));
      const blockSeconds = BigInt(before.timestamp);
      if (blockSeconds > observedSeconds) unavailable();
      const staleAfterSeconds = blockSeconds + BigInt(this.manifest.maximumBlockAgeSeconds);
      if (observedSeconds >= staleAfterSeconds) unavailable();
      const staleAfter = new Date(Number(staleAfterSeconds) * 1_000).toISOString();
      const aprBps = (rate * SECONDS_PER_YEAR * 10_000n) / RATE_SCALE;
      if (aprBps > MAX_APR_BPS) unavailable();
      const transcriptFingerprintSha256 = digest(
        JSON.stringify([
          'crypto-lending:compound-iii-ethereum-finalized-transcript:v1',
          this.manifestFingerprint,
          before,
          proxyCode,
          implementationCode,
          assetCode,
          implementation,
          totalSupply.toString(),
          utilization.toString(),
          rate.toString(),
          paused,
          after,
          observedAt,
        ]),
      );
      return Object.freeze({
        schemaVersion: 1,
        use: 'NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE',
        providerId: 'compound',
        protocolId: 'compound-iii',
        networkId: 'eip155:1',
        marketId: 'compound-iii-ethereum-usdc',
        asset: Object.freeze({
          symbol: 'USDC',
          address: this.manifest.baseAsset.address,
          decimals: 6,
        }),
        finalizedBlock: before,
        observation: Object.freeze({
          totalSuppliedAtomic: totalSupply,
          utilizationFactor: utilization,
          supplyRatePerSecondFactor: rate,
          annualizedSupplyAprBasisPoints: aprBps,
          providerSupplyStatus: paused ? 'CLOSED' : 'OPEN',
        }),
        manifestFingerprintSha256: this.manifestFingerprint,
        transcriptFingerprintSha256,
        observedAt,
        staleAfter,
        authenticity: 'SINGLE_UNTRUSTED_RPC_TRANSCRIPT',
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
      });
    } catch (error) {
      if (error instanceof CompoundIIITranscriptUnavailableError) throw error;
      unavailable();
    }
  }

  private async checkedCode(
    id: number,
    address: string,
    block: Readonly<{ blockHash: string; requireCanonical: true }>,
    expected: string,
  ): Promise<string> {
    const value = await this.rpc(id, 'eth_getCode', [address, block]);
    if (
      typeof value !== 'string' ||
      !DATA.test(value) ||
      value === '0x' ||
      (value.length - 2) / 2 > MAX_CODE_BYTES ||
      digestBytes(value) !== expected
    )
      unavailable();
    return value;
  }

  private call(
    id: number,
    to: string,
    data: string,
    block: Readonly<{ blockHash: string; requireCanonical: true }>,
    from?: string,
  ): Promise<unknown> {
    const transaction = from === undefined ? { to, data } : { to, data, from };
    return this.rpc(id, 'eth_call', [Object.freeze(transaction), block]);
  }

  private async rpc(
    id: number,
    method: CompoundIIIJsonRpcRequest['method'],
    params: readonly unknown[],
  ): Promise<unknown> {
    let response: unknown;
    try {
      response = await this.transport.exchange(
        Object.freeze({ jsonrpc: '2.0', id, method, params: Object.freeze(params) }),
      );
    } catch {
      unavailable();
    }
    bounded(response);
    const envelope = exactRecord(response, ['jsonrpc', 'id', 'result']);
    if (envelope.jsonrpc !== '2.0' || envelope.id !== id) unavailable();
    return envelope.result;
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) unavailable();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    unavailable();
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) unavailable();
    output[key] = descriptor.value;
  }
  return output;
}

function allowedRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) unavailable();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors))
    if (typeof key !== 'string' || !BLOCK_KEYS.includes(key as (typeof BLOCK_KEYS)[number]))
      unavailable();
  for (const key of required) if (!Object.hasOwn(descriptors, key)) unavailable();
  const output = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) unavailable();
    output[key] = descriptor.value;
  }
  return output;
}

function bounded(root: unknown): void {
  let bytes = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 50_000 || depth > 24) unavailable();
    if (typeof value === 'string') bytes += Buffer.byteLength(value);
    else if (typeof value === 'number') bytes += 8;
    else if (typeof value === 'boolean' || value === null) bytes += 4;
    else if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) unavailable();
      seen.add(value);
      if (Array.isArray(value)) {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (
          Object.getPrototypeOf(value) !== Array.prototype ||
          value.length > 20_000 ||
          Reflect.ownKeys(descriptors).length !== value.length + 1
        )
          unavailable();
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !('value' in descriptor)) unavailable();
          visit(descriptor.value, depth + 1);
        }
      } else {
        const prototype = Object.getPrototypeOf(value) as unknown;
        if (prototype !== Object.prototype && prototype !== null) unavailable();
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) unavailable();
        for (const [key, descriptor] of Object.entries(descriptors)) {
          bytes += Buffer.byteLength(key);
          if (!descriptor.enumerable || !('value' in descriptor)) unavailable();
          visit(descriptor.value, depth + 1);
        }
      }
    } else unavailable();
    if (bytes > 1_048_576) unavailable();
  };
  visit(root, 0);
}

function header(value: unknown): Header {
  const row = allowedRecord(value, ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp']);
  if (
    typeof row.number !== 'string' ||
    !QUANTITY.test(row.number) ||
    row.number.length > 18 ||
    BigInt(row.number) === 0n ||
    BigInt(row.number) > MAX_UINT64 ||
    typeof row.hash !== 'string' ||
    !HASH.test(row.hash) ||
    typeof row.parentHash !== 'string' ||
    !HASH.test(row.parentHash) ||
    row.hash === row.parentHash ||
    typeof row.stateRoot !== 'string' ||
    !HASH.test(row.stateRoot) ||
    typeof row.timestamp !== 'string' ||
    !QUANTITY.test(row.timestamp) ||
    row.timestamp.length > 18 ||
    BigInt(row.timestamp) === 0n ||
    BigInt(row.timestamp) > MAX_UINT64
  )
    unavailable();
  validateOptionalHeaderFields(row);
  return Object.freeze({
    number: row.number,
    hash: row.hash,
    parentHash: row.parentHash,
    stateRoot: row.stateRoot,
    timestamp: row.timestamp,
  });
}

function validateOptionalHeaderFields(row: Readonly<Record<string, unknown>>): void {
  for (const key of [
    'baseFeePerGas',
    'blobGasUsed',
    'difficulty',
    'excessBlobGas',
    'gasLimit',
    'gasUsed',
    'size',
    'totalDifficulty',
  ]) {
    if (
      key in row &&
      (typeof row[key] !== 'string' || row[key].length > 66 || !QUANTITY.test(row[key]))
    )
      unavailable();
  }
  for (const key of ['extraData', 'logsBloom', 'mixHash', 'nonce']) {
    if (key in row && (typeof row[key] !== 'string' || !DATA.test(row[key]))) unavailable();
  }
  for (const key of [
    'parentBeaconBlockRoot',
    'receiptsRoot',
    'requestsHash',
    'sha3Uncles',
    'transactionsRoot',
    'withdrawalsRoot',
  ]) {
    if (key in row && row[key] !== null && (typeof row[key] !== 'string' || !HASH.test(row[key])))
      unavailable();
  }
  if ('miner' in row && (typeof row.miner !== 'string' || !/^0x[0-9a-f]{40}$/u.test(row.miner)))
    unavailable();
  for (const key of ['transactions', 'uncles']) {
    const value = row[key];
    if (
      key in row &&
      (!Array.isArray(value) ||
        value.length > (key === 'transactions' ? 20_000 : 128) ||
        value.some((entry) => typeof entry !== 'string' || !HASH.test(entry)))
    )
      unavailable();
  }
  if ('withdrawals' in row) {
    if (!Array.isArray(row.withdrawals) || row.withdrawals.length > 128) unavailable();
    for (const withdrawal of row.withdrawals) {
      const item = exactRecord(withdrawal, ['index', 'validatorIndex', 'address', 'amount']);
      if (typeof item.address !== 'string' || !/^0x[0-9a-f]{40}$/u.test(item.address))
        unavailable();
      for (const key of ['index', 'validatorIndex', 'amount']) {
        if (typeof item[key] !== 'string' || item[key].length > 66 || !QUANTITY.test(item[key]))
          unavailable();
      }
    }
  }
}

function decodeUint(value: unknown): bigint {
  if (typeof value !== 'string' || !WORD.test(value)) unavailable();
  return BigInt(value);
}
function decodeAddress(value: unknown): string {
  if (typeof value !== 'string' || !WORD.test(value) || !/^0x0{24}/u.test(value)) unavailable();
  const result = `0x${value.slice(-40)}`;
  if (/^0x0{40}$/u.test(result)) unavailable();
  return result;
}
function decodeBool(value: unknown): boolean {
  const result = decodeUint(value);
  if (result > 1n) unavailable();
  return result === 1n;
}
function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}
function sameHeader(a: Header, b: Header): boolean {
  return (
    a.number === b.number &&
    a.hash === b.hash &&
    a.parentHash === b.parentHash &&
    a.stateRoot === b.stateRoot &&
    a.timestamp === b.timestamp
  );
}
function canonicalNow(value: Date): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.getPrototypeOf(value) !== Date.prototype ||
    Reflect.ownKeys(value).length !== 0
  )
    unavailable();
  const timestamp = DATE_GET_TIME.call(value);
  if (!Number.isFinite(timestamp)) unavailable();
  return DATE_TO_ISO_STRING.call(value);
}
function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function digestBytes(value: string): string {
  return createHash('sha256')
    .update(Buffer.from(value.slice(2), 'hex'))
    .digest('hex');
}
