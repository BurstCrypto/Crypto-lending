import { createHash } from 'node:crypto';

import {
  gearboxV3ManifestFingerprintSha256,
  parseGearboxV3EthereumUSDCManifest,
  type GearboxV3EthereumUSDCManifest,
} from './gearbox-v3-ethereum-usdc.manifest';

const SHA256 = /^[0-9a-f]{64}$/u;
const DATE_GET_TIME = Date.prototype.getTime;
const DATE_TO_ISO_STRING = Date.prototype.toISOString;
const HASH = /^0x[0-9a-f]{64}$/u;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const DATA = /^0x(?:[0-9a-f]{2})*$/u;
const WORD = /^0x[0-9a-f]{64}$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_MARKET_ATOMIC = 1_000_000_000_000_000_000_000_000n;
const MAX_RAW_SUPPLY_RATE_RAY = 1_000n * 10n ** 27n;
const MAX_CODE_BYTES = 65_536;
const SELECTOR = Object.freeze({
  addressProvider: '0x2954018c',
  underlyingToken: '0x2495a599',
  asset: '0x38d52e0f',
  version: '0x54fd4d50',
  decimals: '0x313ce567',
  availableLiquidity: '0x74375359',
  expectedLiquidity: '0xfe14112d',
  totalSupply: '0x18160ddd',
  supplyRate: '0xad2961a3',
  paused: '0x5c975abb',
  totalDebtLimit: '0x183ace90',
  getAddressOrRevert: '0x57b5a1c6',
  isPool: '0x5b16ebb7',
});
const CONTRACTS_REGISTER_KEY = Buffer.from('CONTRACTS_REGISTER', 'ascii')
  .toString('hex')
  .padEnd(64, '0');
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

export interface GearboxV3JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call';
  readonly params: readonly unknown[];
}

/** Owns no endpoint, client, credentials, retries, DNS, TLS, or egress policy. */
export interface GearboxV3JsonRpcTransport {
  exchange(request: GearboxV3JsonRpcRequest): Promise<unknown>;
}
export interface GearboxV3TranscriptClock {
  now(): Date;
}

export interface GearboxV3EthereumUSDCFinalizedCandidate {
  readonly schemaVersion: 1;
  readonly use: 'NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE';
  readonly providerId: 'gearbox';
  readonly protocolId: 'gearbox-v3';
  readonly networkId: 'eip155:1';
  readonly marketId: 'gearbox-v3-ethereum-usdc';
  readonly asset: Readonly<{ symbol: 'USDC'; address: string; decimals: 6 }>;
  readonly finalizedBlock: Readonly<{
    number: string;
    hash: string;
    parentHash: string;
    stateRoot: string;
    timestamp: string;
  }>;
  readonly observation: Readonly<{
    availableLiquidityAtomic: bigint;
    expectedLiquidityAtomic: bigint;
    shareSupplyAtomic: bigint;
    rawSupplyRateRay: bigint;
    paused: boolean;
    totalDebtLimitAtomic: bigint;
  }>;
  readonly registryStatus: 'REGISTERED_POOL_AT_SELECTED_BLOCK';
  readonly manifestFingerprintSha256: string;
  readonly transcriptFingerprintSha256: string;
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly authenticity: 'SINGLE_UNTRUSTED_RPC';
  readonly mayPersist: false;
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
}

export class GearboxV3TranscriptUnavailableError extends Error {
  readonly code = 'GEARBOX_V3_TRANSCRIPT_UNAVAILABLE' as const;
  constructor() {
    super('Gearbox V3 finalized transcript is unavailable');
    this.name = 'GearboxV3TranscriptUnavailableError';
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
  throw new GearboxV3TranscriptUnavailableError();
}

export class GearboxV3EthereumFinalizedTranscriptAdapter {
  private readonly manifest: GearboxV3EthereumUSDCManifest;
  private readonly fingerprint: string;

  constructor(
    manifest: unknown,
    requiredManifestFingerprintSha256: unknown,
    private readonly transport: GearboxV3JsonRpcTransport,
    private readonly clock: GearboxV3TranscriptClock,
  ) {
    try {
      this.manifest = parseGearboxV3EthereumUSDCManifest(manifest);
      this.fingerprint = gearboxV3ManifestFingerprintSha256(this.manifest);
      if (
        typeof requiredManifestFingerprintSha256 !== 'string' ||
        !SHA256.test(requiredManifestFingerprintSha256) ||
        requiredManifestFingerprintSha256 !== this.fingerprint ||
        typeof transport?.exchange !== 'function' ||
        typeof clock?.now !== 'function'
      )
        unavailable();
    } catch (error) {
      if (error instanceof GearboxV3TranscriptUnavailableError) throw error;
      unavailable();
    }
  }

  async readFinalizedUSDCMarket(
    request: unknown,
  ): Promise<GearboxV3EthereumUSDCFinalizedCandidate> {
    try {
      const input = exactRecord(request, ['selector']);
      if (input.selector !== 'finalized' || (await this.rpc(1, 'eth_chainId', [])) !== '0x1')
        unavailable();
      const before = header(await this.rpc(2, 'eth_getBlockByNumber', ['finalized', false]));
      const binding = Object.freeze({ blockHash: before.hash, requireCanonical: true as const });
      const code = Object.freeze({
        addressProvider: await this.checkedCode(
          3,
          this.manifest.contracts.addressProvider,
          binding,
          this.manifest.runtimeCodeSha256.addressProvider,
        ),
        contractsRegister: await this.checkedCode(
          4,
          this.manifest.contracts.contractsRegister,
          binding,
          this.manifest.runtimeCodeSha256.contractsRegister,
        ),
        pool: await this.checkedCode(
          5,
          this.manifest.contracts.pool,
          binding,
          this.manifest.runtimeCodeSha256.pool,
        ),
        underlying: await this.checkedCode(
          6,
          this.manifest.contracts.underlying,
          binding,
          this.manifest.runtimeCodeSha256.underlying,
        ),
      });
      const registerData = `${SELECTOR.getAddressOrRevert}${CONTRACTS_REGISTER_KEY}${word(0n)}`;
      if (
        decodeAddress(
          await this.call(7, this.manifest.contracts.addressProvider, registerData, binding),
        ) !== this.manifest.contracts.contractsRegister
      )
        unavailable();
      if (
        !decodeBool(
          await this.call(
            8,
            this.manifest.contracts.contractsRegister,
            `${SELECTOR.isPool}${addressWord(this.manifest.contracts.pool)}`,
            binding,
          ),
        )
      )
        unavailable();
      if (
        decodeAddress(
          await this.call(9, this.manifest.contracts.pool, SELECTOR.addressProvider, binding),
        ) !== this.manifest.contracts.addressProvider
      )
        unavailable();
      if (
        decodeAddress(
          await this.call(10, this.manifest.contracts.pool, SELECTOR.underlyingToken, binding),
        ) !== this.manifest.contracts.underlying
      )
        unavailable();
      if (
        decodeAddress(
          await this.call(11, this.manifest.contracts.pool, SELECTOR.asset, binding),
        ) !== this.manifest.contracts.underlying
      )
        unavailable();
      if (
        decodeUint(await this.call(12, this.manifest.contracts.pool, SELECTOR.version, binding)) !==
        300n
      )
        unavailable();
      if (
        decodeUint(
          await this.call(13, this.manifest.contracts.pool, SELECTOR.decimals, binding),
        ) !== 6n ||
        decodeUint(
          await this.call(14, this.manifest.contracts.underlying, SELECTOR.decimals, binding),
        ) !== 6n
      )
        unavailable();
      const available = boundedMarketAmount(
        await this.call(15, this.manifest.contracts.pool, SELECTOR.availableLiquidity, binding),
      );
      const expected = boundedMarketAmount(
        await this.call(16, this.manifest.contracts.pool, SELECTOR.expectedLiquidity, binding),
      );
      const shares = boundedMarketAmount(
        await this.call(17, this.manifest.contracts.pool, SELECTOR.totalSupply, binding),
      );
      const rate = decodeUint(
        await this.call(18, this.manifest.contracts.pool, SELECTOR.supplyRate, binding),
      );
      if (rate > MAX_RAW_SUPPLY_RATE_RAY) unavailable();
      const paused = decodeBool(
        await this.call(19, this.manifest.contracts.pool, SELECTOR.paused, binding),
      );
      const debtLimit = decodeUint(
        await this.call(20, this.manifest.contracts.pool, SELECTOR.totalDebtLimit, binding),
      );
      if (debtLimit > MAX_UINT256) unavailable();
      const after = header(await this.rpc(21, 'eth_getBlockByNumber', [before.number, false]));
      if (!sameHeader(before, after) || (await this.rpc(22, 'eth_chainId', [])) !== '0x1')
        unavailable();
      const observedAt = canonicalNow(this.clock.now());
      const observedSeconds = BigInt(Math.floor(Date.parse(observedAt) / 1_000));
      const blockSeconds = BigInt(before.timestamp);
      const staleAfterSeconds = blockSeconds + BigInt(this.manifest.maximumBlockAgeSeconds);
      if (blockSeconds > observedSeconds || observedSeconds >= staleAfterSeconds) unavailable();
      const staleAfter = new Date(Number(staleAfterSeconds) * 1_000).toISOString();
      const transcriptFingerprintSha256 = digest(
        JSON.stringify([
          'crypto-lending:gearbox-v3-ethereum-finalized-transcript:v1',
          this.fingerprint,
          before,
          code,
          available.toString(),
          expected.toString(),
          shares.toString(),
          rate.toString(),
          paused,
          debtLimit.toString(),
          after,
          observedAt,
          staleAfter,
        ]),
      );
      return Object.freeze({
        schemaVersion: 1,
        use: 'NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE',
        providerId: 'gearbox',
        protocolId: 'gearbox-v3',
        networkId: 'eip155:1',
        marketId: 'gearbox-v3-ethereum-usdc',
        asset: Object.freeze({
          symbol: 'USDC',
          address: this.manifest.contracts.underlying,
          decimals: 6,
        }),
        finalizedBlock: before,
        observation: Object.freeze({
          availableLiquidityAtomic: available,
          expectedLiquidityAtomic: expected,
          shareSupplyAtomic: shares,
          rawSupplyRateRay: rate,
          paused,
          totalDebtLimitAtomic: debtLimit,
        }),
        registryStatus: 'REGISTERED_POOL_AT_SELECTED_BLOCK',
        manifestFingerprintSha256: this.fingerprint,
        transcriptFingerprintSha256,
        observedAt,
        staleAfter,
        authenticity: 'SINGLE_UNTRUSTED_RPC',
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
      });
    } catch (error) {
      if (error instanceof GearboxV3TranscriptUnavailableError) throw error;
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
  ): Promise<unknown> {
    return this.rpc(id, 'eth_call', [Object.freeze({ to, data }), block]);
  }

  private async rpc(
    id: number,
    method: GearboxV3JsonRpcRequest['method'],
    params: readonly unknown[],
  ): Promise<unknown> {
    const raw = await this.transport.exchange(
      Object.freeze({ jsonrpc: '2.0', id, method, params: Object.freeze(params) }),
    );
    bounded(raw);
    const response = exactRecord(raw, ['jsonrpc', 'id', 'result']);
    if (response.jsonrpc !== '2.0' || response.id !== id) unavailable();
    return response.result;
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
    BigInt(row.timestamp) === 0n
  )
    unavailable();
  for (const key of [
    'baseFeePerGas',
    'blobGasUsed',
    'difficulty',
    'excessBlobGas',
    'gasLimit',
    'gasUsed',
    'size',
    'totalDifficulty',
  ])
    if (
      key in row &&
      (typeof row[key] !== 'string' || row[key].length > 66 || !QUANTITY.test(row[key]))
    )
      unavailable();
  for (const key of ['extraData', 'logsBloom', 'mixHash', 'nonce'])
    if (key in row && (typeof row[key] !== 'string' || !DATA.test(row[key]))) unavailable();
  for (const key of [
    'parentBeaconBlockRoot',
    'receiptsRoot',
    'requestsHash',
    'sha3Uncles',
    'transactionsRoot',
    'withdrawalsRoot',
  ])
    if (key in row && row[key] !== null && (typeof row[key] !== 'string' || !HASH.test(row[key])))
      unavailable();
  if ('miner' in row && (typeof row.miner !== 'string' || !/^0x[0-9a-f]{40}$/u.test(row.miner)))
    unavailable();
  for (const key of ['transactions', 'uncles'])
    if (
      key in row &&
      (!Array.isArray(row[key]) ||
        (row[key] as unknown[]).some((item) => typeof item !== 'string' || !HASH.test(item)))
    )
      unavailable();
  if ('withdrawals' in row) {
    if (!Array.isArray(row.withdrawals) || row.withdrawals.length > 128) unavailable();
    for (const withdrawal of row.withdrawals) {
      const item = exactRecord(withdrawal, ['index', 'validatorIndex', 'address', 'amount']);
      if (typeof item.address !== 'string' || !/^0x[0-9a-f]{40}$/u.test(item.address))
        unavailable();
      for (const key of ['index', 'validatorIndex', 'amount'])
        if (typeof item[key] !== 'string' || item[key].length > 66 || !QUANTITY.test(item[key]))
          unavailable();
    }
  }
  return Object.freeze({
    number: row.number,
    hash: row.hash,
    parentHash: row.parentHash,
    stateRoot: row.stateRoot,
    timestamp: row.timestamp,
  });
}

function decodeUint(value: unknown): bigint {
  if (typeof value !== 'string' || !WORD.test(value)) unavailable();
  return BigInt(value);
}
function boundedMarketAmount(value: unknown): bigint {
  const amount = decodeUint(value);
  if (amount > MAX_MARKET_ATOMIC) unavailable();
  return amount;
}
function decodeAddress(value: unknown): string {
  if (typeof value !== 'string' || !WORD.test(value) || !/^0x0{24}/u.test(value)) unavailable();
  const address = `0x${value.slice(-40)}`;
  if (/^0x0{40}$/u.test(address)) unavailable();
  return address;
}
function decodeBool(value: unknown): boolean {
  const bool = decodeUint(value);
  if (bool > 1n) unavailable();
  return bool === 1n;
}
function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}
function addressWord(value: string): string {
  return `${'0'.repeat(24)}${value.slice(2)}`;
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
