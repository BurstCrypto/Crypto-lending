import { createHash } from 'node:crypto';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  SUPPORTED_STABLECOINS,
  type SupportedStablecoin,
} from '../../../blockchain/domain/supported-asset-registry';
import type {
  DormantStablecoinPriceTranscriptCandidate,
  StablecoinPriceTranscriptAdapter,
  StablecoinPriceTranscriptClock,
  StablecoinPriceTranscriptReadRequest,
} from '../../application/ports/stablecoin-price-transcript.port';
import {
  normalizeStablecoinPriceEvidenceAsset,
  normalizeStablecoinPriceObservation,
} from '../../domain/stablecoin-price-evidence';
import { STABLECOIN_VALUATION_FEED_REFERENCES } from '../../domain/stablecoin-valuation-policy';
import {
  allowedDataRecord,
  assertBoundedData,
  assertCurrentSourceTime,
  canonicalObservedAt,
  dataRecord,
  exactDataRecord,
  fingerprintTranscript,
  normalizeUnsignedFixedDecimal,
  transcriptUnavailable,
  unixSecondsToTimestamp,
  StablecoinPriceTranscriptUnavailableError,
} from './stablecoin-price-transcript';

const ETHEREUM_MAINNET_NETWORK_ID = 'eip155:1' as const;
const ETHEREUM_MAINNET_CHAIN_ID = '0x1' as const;
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const SHA256 = /^[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/u;
const UINT256_WORD = /^0x[0-9a-f]{64}$/u;
const DESCRIPTION = /^[\x20-\x7e]{3,128}$/u;
const MAXIMUM_RUNTIME_CODE_BYTES = 49_152;
const MAXIMUM_UINT80 = (1n << 80n) - 1n;
const MAXIMUM_UINT64 = (1n << 64n) - 1n;
const MAXIMUM_UINT256 = (1n << 256n) - 1n;
const MAXIMUM_INT256 = (1n << 255n) - 1n;
const DECIMALS_CALL = '0x313ce567';
const DESCRIPTION_CALL = '0x7284e416';
const LATEST_ROUND_DATA_CALL = '0xfeaf968c';
const AGGREGATOR_CALL = '0x245a7bfc';
const ETHEREUM_RESPONSE_BOUNDS = Object.freeze({
  maximumBytes: 2 * 1024 * 1024,
  maximumNodes: 120_000,
  maximumDepth: 16,
  maximumArrayLength: 100_000,
});
const MANIFEST_BOUNDS = Object.freeze({
  maximumBytes: 16 * 1024,
  maximumNodes: 128,
  maximumDepth: 6,
  maximumArrayLength: 3,
});

const BLOCK_KEYS = Object.freeze([
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
] as const);

export interface ChainlinkEthereumJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method:
    'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getBlockByHash' | 'eth_getCode' | 'eth_call';
  readonly params: readonly unknown[];
}

/** Owns no endpoint, client, retry, credential, DNS, TLS, or egress policy. */
export interface ChainlinkEthereumJsonRpcTranscriptTransport {
  exchange(request: ChainlinkEthereumJsonRpcRequest): Promise<unknown>;
}

export interface ChainlinkEthereumFeedManifestEntryDefinition {
  readonly stablecoin: SupportedStablecoin;
  readonly sourceReference: string;
  readonly proxyAddress: string;
  readonly aggregatorAddress: string;
  readonly proxyRuntimeCodeSha256: string;
  readonly aggregatorRuntimeCodeSha256: string;
  readonly decimals: number;
  readonly description: string;
}

export interface ChainlinkEthereumFeedManifestDefinition {
  readonly schemaVersion: 1;
  readonly registryEnvironment: 'MAINNET';
  readonly registryVersion: 1;
  readonly registryFingerprintSha256: string;
  readonly sourceNetworkId: 'eip155:1';
  readonly chainId: '0x1';
  readonly blockSelector: 'finalized';
  readonly feeds: readonly ChainlinkEthereumFeedManifestEntryDefinition[];
}

export interface ChainlinkEthereumFeedManifest extends ChainlinkEthereumFeedManifestDefinition {
  readonly manifestFingerprintSha256: string;
}

type ParsedFeedManifestEntry = ChainlinkEthereumFeedManifestEntryDefinition;

interface EthereumBlockHeader {
  readonly number: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly timestamp: string;
}

interface ChainlinkRound {
  readonly roundId: bigint;
  readonly answer: bigint;
  readonly startedAt: bigint;
  readonly updatedAt: bigint;
  readonly answeredInRound: bigint;
}

export function createChainlinkEthereumFeedManifest(value: unknown): ChainlinkEthereumFeedManifest {
  assertBoundedData(value, MANIFEST_BOUNDS);
  const raw = dataRecord(value);
  const includesFingerprint = Object.hasOwn(raw, 'manifestFingerprintSha256');
  const record = exactDataRecord(value, [
    'schemaVersion',
    'registryEnvironment',
    'registryVersion',
    'registryFingerprintSha256',
    'sourceNetworkId',
    'chainId',
    'blockSelector',
    'feeds',
    ...(includesFingerprint ? ['manifestFingerprintSha256'] : []),
  ]);
  if (
    record.schemaVersion !== 1 ||
    record.registryEnvironment !== 'MAINNET' ||
    record.registryVersion !== 1 ||
    record.registryFingerprintSha256 !== REGISTRY_FINGERPRINT ||
    MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256 !== REGISTRY_FINGERPRINT ||
    record.sourceNetworkId !== ETHEREUM_MAINNET_NETWORK_ID ||
    record.chainId !== ETHEREUM_MAINNET_CHAIN_ID ||
    record.blockSelector !== 'finalized' ||
    !Array.isArray(record.feeds) ||
    record.feeds.length !== SUPPORTED_STABLECOINS.length
  ) {
    return transcriptUnavailable();
  }
  const feeds = record.feeds
    .map(parseManifestEntry)
    .sort((left, right) => left.stablecoin.localeCompare(right.stablecoin));
  if (
    new Set(feeds.map(({ stablecoin }) => stablecoin)).size !== SUPPORTED_STABLECOINS.length ||
    new Set(feeds.map(({ proxyAddress }) => proxyAddress)).size !== feeds.length ||
    new Set(feeds.map(({ aggregatorAddress }) => aggregatorAddress)).size !== feeds.length
  ) {
    return transcriptUnavailable();
  }
  const canonical = Object.freeze({
    schemaVersion: 1 as const,
    registryEnvironment: 'MAINNET' as const,
    registryVersion: 1 as const,
    registryFingerprintSha256: REGISTRY_FINGERPRINT,
    sourceNetworkId: ETHEREUM_MAINNET_NETWORK_ID,
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    blockSelector: 'finalized' as const,
    feeds: Object.freeze(feeds),
  });
  const manifestFingerprintSha256 = fingerprintTranscript(
    'crypto-lending:chainlink-ethereum-feed-manifest:v1',
    [canonical],
  );
  if (
    includesFingerprint &&
    (typeof record.manifestFingerprintSha256 !== 'string' ||
      record.manifestFingerprintSha256 !== manifestFingerprintSha256)
  ) {
    return transcriptUnavailable();
  }
  return Object.freeze({
    ...canonical,
    manifestFingerprintSha256,
  });
}

/**
 * Dormant finalized-block Chainlink parser. The caller must supply a separately
 * approved exact manifest fingerprint; this repository intentionally supplies
 * no production proxy or aggregator identities and registers no transport.
 */
export class ChainlinkEthereumPriceTranscriptAdapter implements StablecoinPriceTranscriptAdapter {
  private readonly manifest!: ChainlinkEthereumFeedManifest;

  constructor(
    manifest: unknown,
    requiredManifestFingerprintSha256: string,
    private readonly transport: ChainlinkEthereumJsonRpcTranscriptTransport,
    private readonly clock: StablecoinPriceTranscriptClock,
  ) {
    try {
      this.manifest = createChainlinkEthereumFeedManifest(manifest);
      if (
        !SHA256.test(requiredManifestFingerprintSha256) ||
        requiredManifestFingerprintSha256 !== this.manifest.manifestFingerprintSha256 ||
        typeof transport?.exchange !== 'function' ||
        typeof clock?.now !== 'function'
      ) {
        return transcriptUnavailable();
      }
    } catch (error) {
      if (error instanceof StablecoinPriceTranscriptUnavailableError) throw error;
      return transcriptUnavailable();
    }
  }

  async read(
    request: StablecoinPriceTranscriptReadRequest,
  ): Promise<DormantStablecoinPriceTranscriptCandidate> {
    try {
      const requestRecord = exactDataRecord(request, ['asset']);
      const asset = normalizeStablecoinPriceEvidenceAsset(requestRecord.asset);
      const feed = this.feed(asset.stablecoin);
      if ((await this.rpc(1, 'eth_chainId', [])) !== ETHEREUM_MAINNET_CHAIN_ID) {
        return transcriptUnavailable();
      }
      const before = parseBlock(
        await this.rpc(2, 'eth_getBlockByNumber', [this.manifest.blockSelector, false]),
      );
      const blockParameter = Object.freeze({ blockHash: before.hash, requireCanonical: true });
      const proxyCode = parseRuntimeCode(
        await this.rpc(3, 'eth_getCode', [feed.proxyAddress, blockParameter]),
      );
      if (runtimeCodeSha256(proxyCode) !== feed.proxyRuntimeCodeSha256) {
        return transcriptUnavailable();
      }
      const aggregatorAddress = decodeAddress(
        await this.call(4, feed.proxyAddress, AGGREGATOR_CALL, blockParameter),
      );
      if (aggregatorAddress !== feed.aggregatorAddress) return transcriptUnavailable();
      const aggregatorCode = parseRuntimeCode(
        await this.rpc(5, 'eth_getCode', [aggregatorAddress, blockParameter]),
      );
      if (runtimeCodeSha256(aggregatorCode) !== feed.aggregatorRuntimeCodeSha256) {
        return transcriptUnavailable();
      }
      const decimals = Number(
        decodeUnsignedWord(await this.call(6, feed.proxyAddress, DECIMALS_CALL, blockParameter)),
      );
      if (decimals !== feed.decimals) return transcriptUnavailable();
      const description = decodeAbiString(
        await this.call(7, feed.proxyAddress, DESCRIPTION_CALL, blockParameter),
      );
      if (description !== feed.description) return transcriptUnavailable();
      const roundData = await this.call(
        8,
        feed.proxyAddress,
        LATEST_ROUND_DATA_CALL,
        blockParameter,
      );
      const round = decodeLatestRoundData(roundData);
      const after = parseBlock(await this.rpc(9, 'eth_getBlockByHash', [before.hash, false]));
      if (!sameBlock(before, after) || (await this.rpc(10, 'eth_chainId', [])) !== '0x1') {
        return transcriptUnavailable();
      }
      const observedAt = canonicalObservedAt(this.clock.now());
      const pricedAt = unixSecondsToTimestamp(round.updatedAt);
      const blockTimestamp = unixSecondsToTimestamp(BigInt(before.timestamp));
      if (
        round.startedAt > round.updatedAt ||
        round.updatedAt > BigInt(before.timestamp) ||
        Date.parse(blockTimestamp) > Date.parse(observedAt)
      ) {
        return transcriptUnavailable();
      }
      assertCurrentSourceTime(pricedAt, observedAt);
      const normalizedPrice = normalizeUnsignedFixedDecimal(
        round.answer,
        feed.decimals,
        'HALF_EVEN',
      );
      if (normalizedPrice === '0') return transcriptUnavailable();
      const observation = normalizeStablecoinPriceObservation({
        asset,
        sourceId: 'CHAINLINK_DATA_FEEDS',
        sourceReference: feed.sourceReference,
        sourceSequence: round.roundId.toString(10),
        sourceUpdateId: round.roundId.toString(10),
        pricedAt,
        observedAt,
        usdRateMantissa: normalizedPrice,
        usdRateScale: 8,
        confidence: { kind: 'NOT_PUBLISHED' },
      });
      return Object.freeze({
        schemaVersion: 1,
        observation,
        transcriptFingerprintSha256: fingerprintTranscript(
          'crypto-lending:chainlink-ethereum-price-transcript:v1',
          [
            this.manifest.manifestFingerprintSha256,
            asset,
            before,
            proxyCode,
            aggregatorAddress,
            aggregatorCode,
            decimals,
            description,
            roundData,
            after,
            observedAt,
          ],
        ),
        sourceNetworkId: ETHEREUM_MAINNET_NETWORK_ID,
        sourcePosition: BigInt(before.number).toString(10),
        sourceFinality: 'ETHEREUM_FINALIZED_BLOCK',
        sourceProofStatus: 'FINALIZED_ETHEREUM_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_VERIFICATION',
        mayRecordAsVerifiedEvidence: false,
      });
    } catch (error) {
      if (error instanceof StablecoinPriceTranscriptUnavailableError) throw error;
      return transcriptUnavailable();
    }
  }

  private feed(stablecoin: SupportedStablecoin): ParsedFeedManifestEntry {
    const feed = this.manifest.feeds.find((candidate) => candidate.stablecoin === stablecoin);
    if (!feed) return transcriptUnavailable();
    return feed;
  }

  private call(
    id: number,
    to: string,
    data: string,
    blockParameter: Readonly<{ blockHash: string; requireCanonical: true }>,
  ): Promise<unknown> {
    return this.rpc(id, 'eth_call', [Object.freeze({ to, data }), blockParameter]);
  }

  private async rpc(
    id: number,
    method: ChainlinkEthereumJsonRpcRequest['method'],
    params: readonly unknown[],
  ): Promise<unknown> {
    const request = Object.freeze({
      jsonrpc: '2.0' as const,
      id,
      method,
      params: Object.freeze(params),
    });
    let response: unknown;
    try {
      response = await this.transport.exchange(request);
    } catch {
      return transcriptUnavailable();
    }
    assertBoundedData(response, ETHEREUM_RESPONSE_BOUNDS);
    const envelope = exactDataRecord(response, ['jsonrpc', 'id', 'result']);
    if (envelope.jsonrpc !== '2.0' || envelope.id !== id) return transcriptUnavailable();
    return envelope.result;
  }
}

function parseManifestEntry(value: unknown): ParsedFeedManifestEntry {
  const record = exactDataRecord(value, [
    'stablecoin',
    'sourceReference',
    'proxyAddress',
    'aggregatorAddress',
    'proxyRuntimeCodeSha256',
    'aggregatorRuntimeCodeSha256',
    'decimals',
    'description',
  ]);
  if (
    typeof record.stablecoin !== 'string' ||
    !SUPPORTED_STABLECOINS.includes(record.stablecoin as SupportedStablecoin)
  ) {
    return transcriptUnavailable();
  }
  const stablecoin = record.stablecoin as SupportedStablecoin;
  if (
    typeof record.sourceReference !== 'string' ||
    record.sourceReference !==
      STABLECOIN_VALUATION_FEED_REFERENCES[stablecoin].CHAINLINK_DATA_FEEDS ||
    typeof record.proxyAddress !== 'string' ||
    !ADDRESS.test(record.proxyAddress) ||
    typeof record.aggregatorAddress !== 'string' ||
    !ADDRESS.test(record.aggregatorAddress) ||
    record.proxyAddress === record.aggregatorAddress ||
    typeof record.proxyRuntimeCodeSha256 !== 'string' ||
    !SHA256.test(record.proxyRuntimeCodeSha256) ||
    typeof record.aggregatorRuntimeCodeSha256 !== 'string' ||
    !SHA256.test(record.aggregatorRuntimeCodeSha256) ||
    typeof record.decimals !== 'number' ||
    !Number.isSafeInteger(record.decimals) ||
    record.decimals < 1 ||
    record.decimals > 36 ||
    typeof record.description !== 'string' ||
    !DESCRIPTION.test(record.description)
  ) {
    return transcriptUnavailable();
  }
  return Object.freeze({
    stablecoin,
    sourceReference: record.sourceReference,
    proxyAddress: record.proxyAddress,
    aggregatorAddress: record.aggregatorAddress,
    proxyRuntimeCodeSha256: record.proxyRuntimeCodeSha256,
    aggregatorRuntimeCodeSha256: record.aggregatorRuntimeCodeSha256,
    decimals: record.decimals,
    description: record.description,
  });
}

function parseBlock(value: unknown): EthereumBlockHeader {
  const record = allowedDataRecord(
    value,
    ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp'],
    BLOCK_KEYS,
  );
  if (
    typeof record.number !== 'string' ||
    record.number.length > 18 ||
    !HEX_QUANTITY.test(record.number) ||
    BigInt(record.number) === 0n ||
    BigInt(record.number) > MAXIMUM_UINT64 ||
    typeof record.hash !== 'string' ||
    !BLOCK_HASH.test(record.hash) ||
    typeof record.parentHash !== 'string' ||
    !BLOCK_HASH.test(record.parentHash) ||
    record.hash === record.parentHash ||
    typeof record.stateRoot !== 'string' ||
    !BLOCK_HASH.test(record.stateRoot) ||
    typeof record.timestamp !== 'string' ||
    record.timestamp.length > 18 ||
    !HEX_QUANTITY.test(record.timestamp) ||
    BigInt(record.timestamp) === 0n ||
    BigInt(record.timestamp) > MAXIMUM_UINT64
  ) {
    return transcriptUnavailable();
  }
  validateOptionalBlockFields(record);
  return Object.freeze({
    number: record.number,
    hash: record.hash,
    parentHash: record.parentHash,
    stateRoot: record.stateRoot,
    timestamp: record.timestamp,
  });
}

function validateOptionalBlockFields(record: Readonly<Record<string, unknown>>): void {
  const quantities = [
    'baseFeePerGas',
    'blobGasUsed',
    'difficulty',
    'excessBlobGas',
    'gasLimit',
    'gasUsed',
    'size',
    'totalDifficulty',
  ];
  const data = ['extraData', 'logsBloom', 'mixHash', 'nonce'];
  const hashes = [
    'parentBeaconBlockRoot',
    'receiptsRoot',
    'requestsHash',
    'sha3Uncles',
    'transactionsRoot',
    'withdrawalsRoot',
  ];
  for (const key of quantities) {
    if (
      key in record &&
      (typeof record[key] !== 'string' ||
        record[key].length > 66 ||
        !HEX_QUANTITY.test(record[key]))
    ) {
      return transcriptUnavailable();
    }
  }
  for (const key of data) {
    if (key in record && (typeof record[key] !== 'string' || !HEX_DATA.test(record[key]))) {
      return transcriptUnavailable();
    }
  }
  for (const key of hashes) {
    if (
      key in record &&
      record[key] !== null &&
      (typeof record[key] !== 'string' || !BLOCK_HASH.test(record[key]))
    ) {
      return transcriptUnavailable();
    }
  }
  if (
    ('miner' in record && (typeof record.miner !== 'string' || !ADDRESS.test(record.miner))) ||
    ('transactions' in record && !validHashArray(record.transactions, 100_000)) ||
    ('uncles' in record && !validHashArray(record.uncles, 128)) ||
    ('withdrawals' in record && !validWithdrawals(record.withdrawals))
  ) {
    return transcriptUnavailable();
  }
}

function validHashArray(value: unknown, maximum: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((candidate) => typeof candidate === 'string' && BLOCK_HASH.test(candidate))
  );
}

function validWithdrawals(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 128) return false;
  try {
    return value.every((candidate) => {
      const row = exactDataRecord(candidate, ['address', 'amount', 'index', 'validatorIndex']);
      return (
        typeof row.address === 'string' &&
        ADDRESS.test(row.address) &&
        typeof row.amount === 'string' &&
        row.amount.length <= 66 &&
        HEX_QUANTITY.test(row.amount) &&
        typeof row.index === 'string' &&
        row.index.length <= 66 &&
        HEX_QUANTITY.test(row.index) &&
        typeof row.validatorIndex === 'string' &&
        row.validatorIndex.length <= 66 &&
        HEX_QUANTITY.test(row.validatorIndex)
      );
    });
  } catch {
    return false;
  }
}

function parseRuntimeCode(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !HEX_DATA.test(value) ||
    value === '0x' ||
    (value.length - 2) / 2 > MAXIMUM_RUNTIME_CODE_BYTES
  ) {
    return transcriptUnavailable();
  }
  return value;
}

function runtimeCodeSha256(code: string): string {
  return createHash('sha256')
    .update(Buffer.from(code.slice(2), 'hex'))
    .digest('hex');
}

function decodeUnsignedWord(value: unknown): bigint {
  if (typeof value !== 'string' || !UINT256_WORD.test(value)) return transcriptUnavailable();
  return BigInt(value);
}

function decodeAddress(value: unknown): string {
  if (typeof value !== 'string' || !UINT256_WORD.test(value) || !/^0x0{24}/u.test(value)) {
    return transcriptUnavailable();
  }
  const address = `0x${value.slice(-40)}`;
  if (!ADDRESS.test(address) || address === '0x0000000000000000000000000000000000000000') {
    return transcriptUnavailable();
  }
  return address;
}

function decodeAbiString(value: unknown): string {
  if (typeof value !== 'string' || !HEX_DATA.test(value)) return transcriptUnavailable();
  const data = value.slice(2);
  if (data.length < 128 || data.length > 512 || data.length % 64 !== 0) {
    return transcriptUnavailable();
  }
  const offset = BigInt(`0x${data.slice(0, 64)}`);
  const byteLength = BigInt(`0x${data.slice(64, 128)}`);
  if (offset !== 32n || byteLength < 3n || byteLength > 128n) return transcriptUnavailable();
  const paddedLength = Number(((byteLength + 31n) / 32n) * 32n);
  if (data.length !== 128 + paddedLength * 2) return transcriptUnavailable();
  const textHex = data.slice(128, 128 + Number(byteLength) * 2);
  if (!/^0*$/u.test(data.slice(128 + Number(byteLength) * 2))) return transcriptUnavailable();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(textHex, 'hex'));
  } catch {
    return transcriptUnavailable();
  }
  if (!DESCRIPTION.test(text)) return transcriptUnavailable();
  return text;
}

function decodeLatestRoundData(value: unknown): ChainlinkRound {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{320}$/u.test(value)) {
    return transcriptUnavailable();
  }
  const words = Array.from({ length: 5 }, (_unused, index) =>
    BigInt(`0x${value.slice(2 + index * 64, 2 + (index + 1) * 64)}`),
  );
  const [roundId, unsignedAnswer, startedAt, updatedAt, answeredInRound] = words;
  if (
    roundId === undefined ||
    unsignedAnswer === undefined ||
    startedAt === undefined ||
    updatedAt === undefined ||
    answeredInRound === undefined ||
    roundId === 0n ||
    roundId > MAXIMUM_UINT80 ||
    unsignedAnswer === 0n ||
    unsignedAnswer > MAXIMUM_INT256 ||
    startedAt === 0n ||
    startedAt > MAXIMUM_UINT256 ||
    updatedAt === 0n ||
    updatedAt > MAXIMUM_UINT256 ||
    answeredInRound !== roundId
  ) {
    return transcriptUnavailable();
  }
  return Object.freeze({
    roundId,
    answer: unsignedAnswer,
    startedAt,
    updatedAt,
    answeredInRound,
  });
}

function sameBlock(left: EthereumBlockHeader, right: EthereumBlockHeader): boolean {
  return (
    left.number === right.number &&
    left.hash === right.hash &&
    left.parentHash === right.parentHash &&
    left.stateRoot === right.stateRoot &&
    left.timestamp === right.timestamp
  );
}
