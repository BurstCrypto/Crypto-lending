import { createHash } from 'node:crypto';

import {
  parseSparkLendEthereumUSDCManifest,
  sparkLendManifestFingerprintSha256,
  type SparkLendEthereumUSDCManifest,
} from './sparklend-ethereum-usdc.manifest';

const HASH = /^0x[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const DATE_GET_TIME = Date.prototype.getTime;
const DATE_TO_ISO_STRING = Date.prototype.toISOString;
const WORD = /^0x[0-9a-f]{64}$/u;
const DATA = /^0x(?:[0-9a-f]{2})*$/u;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const UINT64 = (1n << 64n) - 1n;
const UINT256 = (1n << 256n) - 1n;
const RAY = 10n ** 27n;
const MAX_RATE_RAY = 10n * RAY;
const MAX_TOTAL_ATOMIC = 10n ** 21n;
const CODE_LIMIT = 65_536;
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
const SELECTORS = Object.freeze({
  getPool: '0x026b1d5f',
  getPoolConfigurator: '0x631adfca',
  addressesProvider: '0x0542975c',
  implementation: '0x5c60da1b',
  pool: '0x7535d246',
  underlying: '0xb16a19de',
  decimals: '0x313ce567',
  configuration: '0x3e150141',
  paused: '0xb55d9904',
  reserveData: '0x35ea6a75',
  totalSupply: '0x18160ddd',
  caps: '0x46fbe558',
});

export interface SparkLendJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call';
  readonly params: readonly unknown[];
}
export interface SparkLendJsonRpcTransport {
  exchange(request: SparkLendJsonRpcRequest): Promise<unknown>;
}
export interface SparkLendClock {
  now(): Date;
}

export interface SparkLendUSDCFinalizedCandidate {
  readonly schemaVersion: 1;
  readonly use: 'NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE';
  readonly providerId: 'spark';
  readonly protocolId: 'sparklend';
  readonly networkId: 'eip155:1';
  readonly marketId: 'sparklend-ethereum-usdc';
  readonly sourceTrust: 'SINGLE_UNTRUSTED_RPC';
  readonly block: Header;
  readonly observation: Readonly<{
    assetSymbol: 'USDC';
    assetDecimals: 6;
    totalSuppliedAtomic: bigint;
    liquidityRateRay: bigint;
    annualizedSupplyAprBasisPoints: bigint;
    supplyCapAtomic: bigint | null;
    supplyCapRemainingAtomic: bigint | null;
    supplyStatus: 'OPEN';
  }>;
  readonly observedAt: string;
  readonly manifestFingerprintSha256: string;
  readonly staleAfter: string;
  readonly transcriptFingerprintSha256: string;
  readonly mayPersist: false;
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
}

export class SparkLendTranscriptUnavailableError extends Error {
  readonly code = 'SPARKLEND_TRANSCRIPT_UNAVAILABLE' as const;
  constructor() {
    super('SparkLend finalized transcript is unavailable');
    this.name = 'SparkLendTranscriptUnavailableError';
  }
}
interface Header {
  readonly number: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly timestamp: string;
}
function unavailable(): never {
  throw new SparkLendTranscriptUnavailableError();
}

export class SparkLendEthereumFinalizedTranscriptAdapter {
  private readonly manifest: SparkLendEthereumUSDCManifest;
  private readonly fingerprint: string;
  constructor(
    manifest: unknown,
    requiredFingerprint: unknown,
    private readonly transport: SparkLendJsonRpcTransport,
    private readonly clock: SparkLendClock,
  ) {
    try {
      this.manifest = parseSparkLendEthereumUSDCManifest(manifest);
      this.fingerprint = sparkLendManifestFingerprintSha256(this.manifest);
      if (
        typeof requiredFingerprint !== 'string' ||
        !SHA.test(requiredFingerprint) ||
        requiredFingerprint !== this.fingerprint ||
        typeof transport?.exchange !== 'function' ||
        typeof clock?.now !== 'function'
      )
        unavailable();
    } catch (error) {
      if (error instanceof SparkLendTranscriptUnavailableError) throw error;
      unavailable();
    }
  }

  async readFinalizedUSDC(request: unknown): Promise<SparkLendUSDCFinalizedCandidate> {
    try {
      const input = exact(request, ['selector']);
      if (input.selector !== 'finalized') unavailable();
      if ((await this.rpc(1, 'eth_chainId', [])) !== '0x1') unavailable();
      const before = parseHeader(await this.rpc(2, 'eth_getBlockByNumber', ['finalized', false]));
      const binding = Object.freeze({ blockHash: before.hash, requireCanonical: true as const });
      const c = this.manifest.contracts;
      const code = [
        await this.checkedCode(3, c.provider, binding, this.manifest.runtimeCodeSha256.provider),
        await this.checkedCode(4, c.pool, binding, this.manifest.runtimeCodeSha256.pool),
        await this.checkedCode(
          5,
          c.implementation,
          binding,
          this.manifest.runtimeCodeSha256.implementation,
        ),
        await this.checkedCode(
          6,
          c.dataProvider,
          binding,
          this.manifest.runtimeCodeSha256.dataProvider,
        ),
        await this.checkedCode(7, c.usdc, binding, this.manifest.runtimeCodeSha256.usdc),
        await this.checkedCode(8, c.spToken, binding, this.manifest.runtimeCodeSha256.spToken),
        await this.checkedCode(
          9,
          c.spTokenImplementation,
          binding,
          this.manifest.runtimeCodeSha256.spTokenImplementation,
        ),
        await this.checkedCode(
          10,
          c.configurator,
          binding,
          this.manifest.runtimeCodeSha256.configurator,
        ),
      ];
      if (
        decodeAddress(await this.call(11, c.provider, SELECTORS.getPoolConfigurator, binding)) !==
          c.configurator ||
        decodeAddress(await this.call(12, c.provider, SELECTORS.getPool, binding)) !== c.pool ||
        decodeAddress(await this.call(13, c.pool, SELECTORS.addressesProvider, binding)) !==
          c.provider ||
        decodeAddress(await this.call(14, c.dataProvider, SELECTORS.addressesProvider, binding)) !==
          c.provider ||
        decodeAddress(
          await this.call(15, c.pool, SELECTORS.implementation, binding, c.provider),
        ) !== c.implementation ||
        decodeAddress(
          await this.call(16, c.spToken, SELECTORS.implementation, binding, c.configurator),
        ) !== c.spTokenImplementation ||
        decodeAddress(await this.call(17, c.spToken, SELECTORS.pool, binding)) !== c.pool ||
        decodeAddress(await this.call(18, c.spToken, SELECTORS.underlying, binding)) !== c.usdc ||
        decodeUint(await this.call(19, c.usdc, SELECTORS.decimals, binding)) !== 6n ||
        decodeUint(await this.call(20, c.spToken, SELECTORS.decimals, binding)) !== 6n
      )
        unavailable();
      const argument = addressArgument(c.usdc);
      const configuration = decodeWords(
        await this.call(21, c.dataProvider, `${SELECTORS.configuration}${argument}`, binding),
        10,
      );
      configuration.forEach((value, index) => {
        if (index >= 5 && value > 1n) unavailable();
      });
      const [decimals, , , , , , , , active, frozen] = configuration;
      if (decimals !== 6n || active !== 1n || frozen !== 0n) unavailable();
      if (
        decodeBool(await this.call(22, c.dataProvider, `${SELECTORS.paused}${argument}`, binding))
      )
        unavailable();
      const reserve = decodeWords(
        await this.call(23, c.dataProvider, `${SELECTORS.reserveData}${argument}`, binding),
        12,
      );
      const total = reserve[2];
      const liquidityRate = reserve[5];
      const lastUpdate = reserve[11];
      if (
        total === undefined ||
        liquidityRate === undefined ||
        lastUpdate === undefined ||
        total > MAX_TOTAL_ATOMIC ||
        liquidityRate > MAX_RATE_RAY ||
        lastUpdate === 0n ||
        lastUpdate > BigInt(before.timestamp)
      )
        unavailable();
      const tokenTotal = decodeUint(await this.call(24, c.spToken, SELECTORS.totalSupply, binding));
      if (tokenTotal !== total) unavailable();
      const caps = decodeWords(
        await this.call(25, c.dataProvider, `${SELECTORS.caps}${argument}`, binding),
        2,
      );
      const supplyCapTokens = caps[1];
      if (supplyCapTokens === undefined || supplyCapTokens > UINT256 / 1_000_000n) unavailable();
      const supplyCapAtomic = supplyCapTokens === 0n ? null : supplyCapTokens * 1_000_000n;
      if (supplyCapAtomic !== null && total >= supplyCapAtomic) unavailable();
      const after = parseHeader(await this.rpc(26, 'eth_getBlockByNumber', [before.number, false]));
      if (!same(before, after) || (await this.rpc(27, 'eth_chainId', [])) !== '0x1') unavailable();
      const observedAt = now(this.clock.now());
      const observedSeconds = BigInt(Math.floor(Date.parse(observedAt) / 1000));
      const blockSeconds = BigInt(before.timestamp);
      if (blockSeconds > observedSeconds) unavailable();
      const staleAfterSeconds = blockSeconds + BigInt(this.manifest.maximumBlockAgeSeconds);
      if (observedSeconds >= staleAfterSeconds) unavailable();
      const staleAfter = new Date(Number(staleAfterSeconds) * 1_000).toISOString();
      const aprBps = (liquidityRate * 10_000n) / RAY;
      const transcriptFingerprintSha256 = sha(
        JSON.stringify([
          'crypto-lending:sparklend-ethereum-finalized-transcript:v1',
          this.fingerprint,
          before,
          code,
          configuration.map(String),
          reserve.map(String),
          caps.map(String),
          observedAt,
        ]),
      );
      return Object.freeze({
        schemaVersion: 1,
        use: 'NON_PERSISTABLE_PROVIDER_NATIVE_CANDIDATE',
        providerId: 'spark',
        protocolId: 'sparklend',
        networkId: 'eip155:1',
        marketId: 'sparklend-ethereum-usdc',
        sourceTrust: 'SINGLE_UNTRUSTED_RPC',
        block: before,
        observation: Object.freeze({
          assetSymbol: 'USDC',
          assetDecimals: 6,
          totalSuppliedAtomic: total,
          liquidityRateRay: liquidityRate,
          annualizedSupplyAprBasisPoints: aprBps,
          supplyCapAtomic,
          supplyCapRemainingAtomic: supplyCapAtomic === null ? null : supplyCapAtomic - total,
          supplyStatus: 'OPEN',
        }),
        observedAt,
        staleAfter,
        manifestFingerprintSha256: this.fingerprint,
        transcriptFingerprintSha256,
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
      });
    } catch (error) {
      if (error instanceof SparkLendTranscriptUnavailableError) throw error;
      unavailable();
    }
  }

  private async checkedCode(
    id: number,
    address: string,
    binding: Binding,
    expected: string,
  ): Promise<string> {
    const value = await this.rpc(id, 'eth_getCode', [address, binding]);
    if (
      typeof value !== 'string' ||
      !DATA.test(value) ||
      value === '0x' ||
      (value.length - 2) / 2 > CODE_LIMIT ||
      byteSha(value) !== expected
    )
      unavailable();
    return value;
  }
  private call(
    id: number,
    to: string,
    data: string,
    binding: Binding,
    from?: string,
  ): Promise<unknown> {
    return this.rpc(id, 'eth_call', [
      Object.freeze(from === undefined ? { to, data } : { to, data, from }),
      binding,
    ]);
  }
  private async rpc(
    id: number,
    method: SparkLendJsonRpcRequest['method'],
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
    const envelope = exact(response, ['jsonrpc', 'id', 'result']);
    if (envelope.jsonrpc !== '2.0' || envelope.id !== id) unavailable();
    return envelope.result;
  }
}

type Binding = Readonly<{ blockHash: string; requireCanonical: true }>;
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
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
        for (let i = 0; i < value.length; i += 1) {
          const d = descriptors[String(i)];
          if (!d?.enumerable || !('value' in d)) unavailable();
          visit(d.value, depth + 1);
        }
      } else {
        const prototype = Object.getPrototypeOf(value) as unknown;
        if (prototype !== Object.prototype && prototype !== null) unavailable();
        for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
          bytes += Buffer.byteLength(key);
          if (!d.enumerable || !('value' in d)) unavailable();
          visit(d.value, depth + 1);
        }
      }
    } else unavailable();
    if (bytes > 1_048_576) unavailable();
  };
  visit(root, 0);
}
function parseHeader(value: unknown): Header {
  const row = allowedHeader(value);
  if (
    typeof row.number !== 'string' ||
    !QUANTITY.test(row.number) ||
    row.number.length > 18 ||
    BigInt(row.number) === 0n ||
    BigInt(row.number) > UINT64 ||
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
    BigInt(row.timestamp) > UINT64
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
  for (const key of ['transactions', 'uncles']) {
    const list = row[key];
    if (
      key in row &&
      (!Array.isArray(list) ||
        list.length > (key === 'transactions' ? 20_000 : 128) ||
        list.some((item) => typeof item !== 'string' || !HASH.test(item)))
    )
      unavailable();
  }
  if ('withdrawals' in row) {
    if (!Array.isArray(row.withdrawals) || row.withdrawals.length > 128) unavailable();
    for (const value of row.withdrawals) {
      const item = exact(value, ['index', 'validatorIndex', 'address', 'amount']);
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
function allowedHeader(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) unavailable();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors))
    if (typeof key !== 'string' || !BLOCK_KEYS.includes(key as (typeof BLOCK_KEYS)[number]))
      unavailable();
  for (const key of ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp'])
    if (!Object.hasOwn(descriptors, key)) unavailable();
  const output = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !('value' in descriptor)) unavailable();
    output[key] = descriptor.value;
  }
  return output;
}
function decodeWords(value: unknown, count: number): readonly bigint[] {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-f]{${count * 64}}$`, 'u').test(value))
    unavailable();
  return Object.freeze(
    Array.from({ length: count }, (_unused, index) =>
      BigInt(`0x${value.slice(2 + index * 64, 2 + (index + 1) * 64)}`),
    ),
  );
}
function decodeUint(value: unknown): bigint {
  if (typeof value !== 'string' || !WORD.test(value)) unavailable();
  return BigInt(value);
}
function decodeBool(value: unknown): boolean {
  const result = decodeUint(value);
  if (result > 1n) unavailable();
  return result === 1n;
}
function decodeAddress(value: unknown): string {
  if (typeof value !== 'string' || !WORD.test(value) || !/^0x0{24}/u.test(value)) unavailable();
  const result = `0x${value.slice(-40)}`;
  if (/^0x0{40}$/u.test(result)) unavailable();
  return result;
}
function addressArgument(address: string): string {
  return `${'0'.repeat(24)}${address.slice(2)}`;
}
function same(a: Header, b: Header): boolean {
  return (
    a.number === b.number &&
    a.hash === b.hash &&
    a.parentHash === b.parentHash &&
    a.stateRoot === b.stateRoot &&
    a.timestamp === b.timestamp
  );
}
function now(value: Date): string {
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
function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function byteSha(value: string): string {
  return createHash('sha256')
    .update(Buffer.from(value.slice(2), 'hex'))
    .digest('hex');
}
