import { createHash } from 'node:crypto';

import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

import {
  MAINNET_SUPPORTED_ASSET_REGISTRY,
  SUPPORTED_STABLECOINS,
  type SupportedStablecoin,
} from '../../../blockchain/domain/supported-asset-registry';

export const MORPHO_BLUE_ETHEREUM_ADDRESS = '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb' as const;
export const MORPHO_BLUE_ID_TO_MARKET_PARAMS_SELECTOR = '0x2c3c9157' as const;
export const MORPHO_BLUE_MARKET_SELECTOR = '0x5c60e39a' as const;
export const MORPHO_BLUE_IS_IRM_ENABLED_SELECTOR = '0xf2b863ce' as const;
export const MORPHO_BLUE_IS_LLTV_ENABLED_SELECTOR = '0xb485f3b8' as const;

const NETWORK_ID = 'eip155:1' as const;
const CHAIN_ID = '0x1' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_WORD = `0x${'0'.repeat(64)}`;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const WAD = 1_000_000_000_000_000_000n;
const MAX_UNIX_SECONDS = 253_402_300_799n;
const MAX_RUNTIME_CODE_BYTES = 49_152;
const MAX_FINALIZED_BLOCK_AGE_SECONDS = 3_600n;
const RESPONSE_BOUNDS = Object.freeze({
  maximumBytes: 2 * 1024 * 1024,
  maximumNodes: 120_000,
  maximumDepth: 16,
  maximumArrayLength: 100_000,
});
const MANIFEST_BOUNDS = Object.freeze({
  maximumBytes: 24 * 1024,
  maximumNodes: 128,
  maximumDepth: 8,
  maximumArrayLength: 0,
});
const REQUEST_BOUNDS = Object.freeze({
  maximumBytes: 1_024,
  maximumNodes: 8,
  maximumDepth: 2,
  maximumArrayLength: 0,
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

export interface MorphoBlueEthereumJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call';
  readonly params: readonly unknown[];
}

/** Owns no endpoint, client, retry, credential, DNS, TLS, or egress policy. */
export interface MorphoBlueEthereumJsonRpcTranscriptTransport {
  exchange(request: MorphoBlueEthereumJsonRpcRequest): Promise<unknown>;
}

export interface MorphoBlueEthereumTranscriptClock {
  now(): Date;
}

export interface MorphoBlueEthereumMarketManifestDefinition {
  readonly schemaVersion: 1;
  readonly use: 'DORMANT_MORPHO_BLUE_MARKET_CORROBORATION_ONLY';
  readonly registryVersion: 1;
  readonly registryFingerprintSha256: string;
  readonly networkId: 'eip155:1';
  readonly chainId: '0x1';
  readonly blockSelector: 'finalized';
  readonly blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL';
  /** Caller-owned freshness bound. This repository supplies no production value. */
  readonly maximumFinalizedBlockAgeSeconds: string;
  readonly deployment: Readonly<{
    readonly kind: 'DIRECT_NON_PROXY';
    readonly morphoAddress: string;
    readonly morphoRuntimeCodeKeccak256: string;
    readonly implementationAddress: string;
    readonly implementationRuntimeCodeKeccak256: string;
  }>;
  readonly market: Readonly<{
    readonly marketId: string;
    readonly loanStablecoin: SupportedStablecoin;
    readonly loanToken: string;
    readonly collateralToken: string;
    readonly oracle: string;
    readonly irm: string;
    readonly lltv: string;
    readonly loanTokenRuntimeCodeKeccak256: string;
    readonly collateralTokenRuntimeCodeKeccak256: string;
    readonly oracleRuntimeCodeKeccak256: string;
    readonly irmRuntimeCodeKeccak256: string;
  }>;
}

export interface MorphoBlueEthereumMarketManifest extends MorphoBlueEthereumMarketManifestDefinition {
  readonly manifestFingerprintSha256: string;
}

export interface ReadMorphoBlueEthereumMarketTranscriptRequest {
  readonly marketId: string;
  readonly loanStablecoin: SupportedStablecoin;
}

export interface DormantMorphoBlueEthereumMarketTranscriptCandidate {
  readonly schemaVersion: 1;
  readonly sourceId: 'MORPHO_BLUE_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT';
  readonly use: 'DORMANT_MORPHO_BLUE_MARKET_CORROBORATION_ONLY';
  readonly providerId: 'morpho';
  readonly protocolId: 'morpho-blue';
  readonly networkId: 'eip155:1';
  readonly manifestFingerprintSha256: string;
  readonly transcriptFingerprintSha256: string;
  readonly observedAt: string;
  readonly staleAfter: string;
  readonly sourcePosition: string;
  readonly sourceFinality: 'ETHEREUM_FINALIZED_BLOCK';
  readonly sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED';
  readonly sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT';
  readonly freshnessStatus: 'CURRENT_WITHIN_CALLER_MANIFEST_BOUND';
  readonly interestAccrualStatus: 'NOT_ACCRUED_RAW_MARKET_STORAGE';
  readonly persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_VERIFICATION';
  readonly mayPersist: false;
  readonly mayEstablishRecommendationEligibility: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly block: Readonly<{
    readonly number: string;
    readonly hash: string;
    readonly parentHash: string;
    readonly stateRoot: string;
    readonly timestamp: string;
  }>;
  readonly deployment: Readonly<{
    readonly kind: 'DIRECT_NON_PROXY';
    readonly morphoAddress: string;
    readonly implementationAddress: string;
    readonly runtimeCodeKeccak256: string;
  }>;
  readonly market: Readonly<{
    readonly marketId: string;
    readonly loanStablecoin: SupportedStablecoin;
    readonly loanToken: string;
    readonly collateralToken: string;
    readonly oracle: string;
    readonly irm: string;
    readonly lltv: string;
  }>;
  readonly rawState: Readonly<{
    readonly totalSupplyAssets: string;
    readonly totalSupplyShares: string;
    readonly totalBorrowAssets: string;
    readonly totalBorrowShares: string;
    readonly lastUpdate: string;
    readonly fee: string;
  }>;
}

interface EthereumBlockHeader {
  readonly number: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly timestamp: string;
}

interface DecodedMarketParams {
  readonly loanToken: string;
  readonly collateralToken: string;
  readonly oracle: string;
  readonly irm: string;
  readonly lltv: bigint;
}

interface DecodedMarketState {
  readonly totalSupplyAssets: bigint;
  readonly totalSupplyShares: bigint;
  readonly totalBorrowAssets: bigint;
  readonly totalBorrowShares: bigint;
  readonly lastUpdate: bigint;
  readonly fee: bigint;
}

export class MorphoBlueEthereumTranscriptUnavailableError extends Error {
  readonly code = 'MORPHO_BLUE_ETHEREUM_TRANSCRIPT_UNAVAILABLE' as const;

  constructor() {
    super('Morpho Blue Ethereum transcript is unavailable');
    this.name = 'MorphoBlueEthereumTranscriptUnavailableError';
  }
}

export function createMorphoBlueEthereumMarketManifest(
  value: unknown,
): MorphoBlueEthereumMarketManifest {
  try {
    assertBoundedData(value, MANIFEST_BOUNDS);
    const raw = dataRecord(value);
    const includesFingerprint = Object.hasOwn(raw, 'manifestFingerprintSha256');
    const record = exactDataRecord(value, [
      'schemaVersion',
      'use',
      'registryVersion',
      'registryFingerprintSha256',
      'networkId',
      'chainId',
      'blockSelector',
      'blockBinding',
      'maximumFinalizedBlockAgeSeconds',
      'deployment',
      'market',
      ...(includesFingerprint ? ['manifestFingerprintSha256'] : []),
    ]);
    const registryFingerprint = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256;
    if (
      record.schemaVersion !== 1 ||
      record.use !== 'DORMANT_MORPHO_BLUE_MARKET_CORROBORATION_ONLY' ||
      record.registryVersion !== 1 ||
      record.registryFingerprintSha256 !== registryFingerprint ||
      record.networkId !== NETWORK_ID ||
      record.chainId !== CHAIN_ID ||
      record.blockSelector !== 'finalized' ||
      record.blockBinding !== 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL'
    ) {
      return unavailable();
    }
    const maximumFinalizedBlockAgeSeconds = positiveCanonicalInteger(
      record.maximumFinalizedBlockAgeSeconds,
      MAX_FINALIZED_BLOCK_AGE_SECONDS,
    ).toString(10);
    const deployment = parseDeployment(record.deployment);
    const market = parseMarket(record.market);
    const canonical = Object.freeze({
      schemaVersion: 1 as const,
      use: 'DORMANT_MORPHO_BLUE_MARKET_CORROBORATION_ONLY' as const,
      registryVersion: 1 as const,
      registryFingerprintSha256: registryFingerprint,
      networkId: NETWORK_ID,
      chainId: CHAIN_ID,
      blockSelector: 'finalized' as const,
      blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL' as const,
      maximumFinalizedBlockAgeSeconds,
      deployment,
      market,
    });
    const manifestFingerprintSha256 = fingerprint(
      'crypto-lending:morpho-blue-ethereum-market-manifest:v1',
      [canonical],
    );
    if (
      includesFingerprint &&
      (typeof record.manifestFingerprintSha256 !== 'string' ||
        record.manifestFingerprintSha256 !== manifestFingerprintSha256)
    ) {
      return unavailable();
    }
    return Object.freeze({ ...canonical, manifestFingerprintSha256 });
  } catch (error) {
    if (error instanceof MorphoBlueEthereumTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

/**
 * Dormant, single-source transcript parser. Matching the manifest fingerprint
 * is only a substitution guard; it is not product approval or source
 * authentication. No transport is registered by this file.
 */
export class MorphoBlueEthereumFinalizedTranscriptAdapter {
  private readonly manifest!: MorphoBlueEthereumMarketManifest;

  constructor(
    manifest: unknown,
    requiredManifestFingerprintSha256: string,
    private readonly transport: MorphoBlueEthereumJsonRpcTranscriptTransport,
    private readonly clock: MorphoBlueEthereumTranscriptClock,
  ) {
    try {
      this.manifest = createMorphoBlueEthereumMarketManifest(manifest);
      if (
        !SHA256.test(requiredManifestFingerprintSha256) ||
        requiredManifestFingerprintSha256 !== this.manifest.manifestFingerprintSha256
      ) {
        return unavailable();
      }
    } catch (error) {
      if (error instanceof MorphoBlueEthereumTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  async read(
    request: ReadMorphoBlueEthereumMarketTranscriptRequest,
  ): Promise<DormantMorphoBlueEthereumMarketTranscriptCandidate> {
    try {
      assertBoundedData(request, REQUEST_BOUNDS);
      const requested = exactDataRecord(request, ['marketId', 'loanStablecoin']);
      if (
        requested.marketId !== this.manifest.market.marketId ||
        requested.loanStablecoin !== this.manifest.market.loanStablecoin
      ) {
        return unavailable();
      }

      if ((await this.rpc(1, 'eth_chainId', [])) !== CHAIN_ID) return unavailable();
      const before = parseBlock(
        await this.rpc(2, 'eth_getBlockByNumber', [this.manifest.blockSelector, false]),
      );
      const blockParameter = Object.freeze({ blockHash: before.hash, requireCanonical: true });
      const deployment = this.manifest.deployment;
      const market = this.manifest.market;

      const morphoCode = parseRuntimeCode(
        await this.rpc(3, 'eth_getCode', [deployment.morphoAddress, blockParameter]),
      );
      const morphoCodeHash = runtimeCodeKeccak256(morphoCode);
      if (
        morphoCodeHash !== deployment.morphoRuntimeCodeKeccak256 ||
        morphoCodeHash !== deployment.implementationRuntimeCodeKeccak256
      ) {
        return unavailable();
      }

      const loanCode = parseRuntimeCode(
        await this.rpc(4, 'eth_getCode', [market.loanToken, blockParameter]),
      );
      if (runtimeCodeKeccak256(loanCode) !== market.loanTokenRuntimeCodeKeccak256) {
        return unavailable();
      }
      const collateralCode = parseRuntimeCode(
        await this.rpc(5, 'eth_getCode', [market.collateralToken, blockParameter]),
      );
      if (runtimeCodeKeccak256(collateralCode) !== market.collateralTokenRuntimeCodeKeccak256) {
        return unavailable();
      }
      const oracleCode = parseRuntimeCode(
        await this.rpc(6, 'eth_getCode', [market.oracle, blockParameter]),
      );
      if (runtimeCodeKeccak256(oracleCode) !== market.oracleRuntimeCodeKeccak256) {
        return unavailable();
      }
      const irmCode = parseRuntimeCode(
        await this.rpc(7, 'eth_getCode', [market.irm, blockParameter]),
      );
      if (runtimeCodeKeccak256(irmCode) !== market.irmRuntimeCodeKeccak256) {
        return unavailable();
      }

      const marketParamsData = `${MORPHO_BLUE_ID_TO_MARKET_PARAMS_SELECTOR}${market.marketId.slice(2)}`;
      const observedParams = decodeMarketParams(
        await this.call(8, marketParamsData, blockParameter),
      );
      if (!sameMarketParams(observedParams, market)) return unavailable();

      const marketStateData = `${MORPHO_BLUE_MARKET_SELECTOR}${market.marketId.slice(2)}`;
      const state = decodeMarketState(await this.call(9, marketStateData, blockParameter));
      if (
        state.lastUpdate === 0n ||
        state.lastUpdate > BigInt(before.timestamp) ||
        state.fee > WAD ||
        (state.totalBorrowAssets === 0n) !== (state.totalBorrowShares === 0n) ||
        state.totalBorrowAssets > state.totalSupplyAssets ||
        (state.totalSupplyShares === 0n && state.totalSupplyAssets !== 0n)
      ) {
        return unavailable();
      }

      const irmEnabledData = `${MORPHO_BLUE_IS_IRM_ENABLED_SELECTOR}${addressWord(market.irm)}`;
      if (!(await this.enabled(10, irmEnabledData, blockParameter))) return unavailable();
      const lltvEnabledData = `${MORPHO_BLUE_IS_LLTV_ENABLED_SELECTOR}${uint256Word(
        BigInt(market.lltv),
      )}`;
      if (!(await this.enabled(11, lltvEnabledData, blockParameter))) return unavailable();

      const after = parseBlock(await this.rpc(12, 'eth_getBlockByNumber', [before.number, false]));
      if (!sameBlock(before, after) || (await this.rpc(13, 'eth_chainId', [])) !== CHAIN_ID) {
        return unavailable();
      }

      const now = canonicalClock(this.clock.now());
      const maximumAge = BigInt(this.manifest.maximumFinalizedBlockAgeSeconds);
      const blockTimestamp = BigInt(before.timestamp);
      const blockMilliseconds = blockTimestamp * 1_000n;
      const observedMilliseconds = BigInt(now.milliseconds);
      if (
        blockMilliseconds > observedMilliseconds ||
        observedMilliseconds - blockMilliseconds >= maximumAge * 1_000n
      ) {
        return unavailable();
      }
      const staleAfter = unixSecondsToTimestamp(blockTimestamp + maximumAge);
      const rawState = Object.freeze({
        totalSupplyAssets: state.totalSupplyAssets.toString(10),
        totalSupplyShares: state.totalSupplyShares.toString(10),
        totalBorrowAssets: state.totalBorrowAssets.toString(10),
        totalBorrowShares: state.totalBorrowShares.toString(10),
        lastUpdate: state.lastUpdate.toString(10),
        fee: state.fee.toString(10),
      });
      const block = Object.freeze({ ...before });
      const candidateMarket = Object.freeze({
        marketId: market.marketId,
        loanStablecoin: market.loanStablecoin,
        loanToken: market.loanToken,
        collateralToken: market.collateralToken,
        oracle: market.oracle,
        irm: market.irm,
        lltv: market.lltv,
      });
      const candidateDeployment = Object.freeze({
        kind: deployment.kind,
        morphoAddress: deployment.morphoAddress,
        implementationAddress: deployment.implementationAddress,
        runtimeCodeKeccak256: morphoCodeHash,
      });
      return Object.freeze({
        schemaVersion: 1,
        sourceId: 'MORPHO_BLUE_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT',
        use: 'DORMANT_MORPHO_BLUE_MARKET_CORROBORATION_ONLY',
        providerId: 'morpho',
        protocolId: 'morpho-blue',
        networkId: NETWORK_ID,
        manifestFingerprintSha256: this.manifest.manifestFingerprintSha256,
        transcriptFingerprintSha256: fingerprint(
          'crypto-lending:morpho-blue-ethereum-finalized-transcript:v1',
          [
            this.manifest.manifestFingerprintSha256,
            before,
            morphoCode,
            loanCode,
            collateralCode,
            oracleCode,
            irmCode,
            candidateMarket,
            rawState,
            after,
            now.timestamp,
          ],
        ),
        observedAt: now.timestamp,
        staleAfter,
        sourcePosition: BigInt(before.number).toString(10),
        sourceFinality: 'ETHEREUM_FINALIZED_BLOCK',
        sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
        sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
        freshnessStatus: 'CURRENT_WITHIN_CALLER_MANIFEST_BOUND',
        interestAccrualStatus: 'NOT_ACCRUED_RAW_MARKET_STORAGE',
        persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_SOURCE_VERIFICATION',
        mayPersist: false,
        mayEstablishRecommendationEligibility: false,
        mayAuthorizeFinancialAction: false,
        block,
        deployment: candidateDeployment,
        market: candidateMarket,
        rawState,
      });
    } catch (error) {
      if (error instanceof MorphoBlueEthereumTranscriptUnavailableError) throw error;
      return unavailable();
    }
  }

  private call(
    id: number,
    data: string,
    blockParameter: Readonly<{ blockHash: string; requireCanonical: true }>,
  ): Promise<unknown> {
    return this.rpc(id, 'eth_call', [
      Object.freeze({ to: this.manifest.deployment.morphoAddress, data }),
      blockParameter,
    ]);
  }

  private async enabled(
    id: number,
    data: string,
    blockParameter: Readonly<{ blockHash: string; requireCanonical: true }>,
  ): Promise<boolean> {
    return decodeBoolean(await this.call(id, data, blockParameter));
  }

  private async rpc(
    id: number,
    method: MorphoBlueEthereumJsonRpcRequest['method'],
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
      return unavailable();
    }
    assertBoundedData(response, RESPONSE_BOUNDS);
    const envelope = exactDataRecord(response, ['jsonrpc', 'id', 'result']);
    if (envelope.jsonrpc !== '2.0' || envelope.id !== id) return unavailable();
    return envelope.result;
  }
}

function parseDeployment(value: unknown): MorphoBlueEthereumMarketManifest['deployment'] {
  const record = exactDataRecord(value, [
    'kind',
    'morphoAddress',
    'morphoRuntimeCodeKeccak256',
    'implementationAddress',
    'implementationRuntimeCodeKeccak256',
  ]);
  if (
    record.kind !== 'DIRECT_NON_PROXY' ||
    record.morphoAddress !== MORPHO_BLUE_ETHEREUM_ADDRESS ||
    record.implementationAddress !== MORPHO_BLUE_ETHEREUM_ADDRESS ||
    typeof record.morphoRuntimeCodeKeccak256 !== 'string' ||
    !BYTES32.test(record.morphoRuntimeCodeKeccak256) ||
    record.morphoRuntimeCodeKeccak256 === ZERO_WORD ||
    record.implementationRuntimeCodeKeccak256 !== record.morphoRuntimeCodeKeccak256
  ) {
    return unavailable();
  }
  return Object.freeze({
    kind: 'DIRECT_NON_PROXY',
    morphoAddress: MORPHO_BLUE_ETHEREUM_ADDRESS,
    morphoRuntimeCodeKeccak256: record.morphoRuntimeCodeKeccak256,
    implementationAddress: MORPHO_BLUE_ETHEREUM_ADDRESS,
    implementationRuntimeCodeKeccak256: record.morphoRuntimeCodeKeccak256,
  });
}

function parseMarket(value: unknown): MorphoBlueEthereumMarketManifest['market'] {
  const record = exactDataRecord(value, [
    'marketId',
    'loanStablecoin',
    'loanToken',
    'collateralToken',
    'oracle',
    'irm',
    'lltv',
    'loanTokenRuntimeCodeKeccak256',
    'collateralTokenRuntimeCodeKeccak256',
    'oracleRuntimeCodeKeccak256',
    'irmRuntimeCodeKeccak256',
  ]);
  if (
    typeof record.loanStablecoin !== 'string' ||
    !SUPPORTED_STABLECOINS.includes(record.loanStablecoin as SupportedStablecoin)
  ) {
    return unavailable();
  }
  const loanStablecoin = record.loanStablecoin as SupportedStablecoin;
  const loanToken = canonicalAddress(record.loanToken);
  const collateralToken = nonzeroAddress(record.collateralToken);
  const oracle = nonzeroAddress(record.oracle);
  const irm = nonzeroAddress(record.irm);
  if (new Set([loanToken, collateralToken, oracle, irm]).size !== 4) return unavailable();
  const registered = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.identifyAsset(NETWORK_ID, loanToken);
  if (
    registered?.stablecoin !== loanStablecoin ||
    registered.activationState !== 'ACTIVE' ||
    registered.decimals !== 6 ||
    registered.registryVersion !== 1
  ) {
    return unavailable();
  }
  const lltv = positiveCanonicalInteger(record.lltv, WAD - 1n);
  const marketId = bytes32(record.marketId);
  const computedMarketId = keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [loanToken as Address, collateralToken as Address, oracle as Address, irm as Address, lltv],
    ),
  );
  if (marketId !== computedMarketId) return unavailable();
  const codeHashes = [
    record.loanTokenRuntimeCodeKeccak256,
    record.collateralTokenRuntimeCodeKeccak256,
    record.oracleRuntimeCodeKeccak256,
    record.irmRuntimeCodeKeccak256,
  ];
  if (
    codeHashes.some(
      (candidate) =>
        typeof candidate !== 'string' || !BYTES32.test(candidate) || candidate === ZERO_WORD,
    )
  ) {
    return unavailable();
  }
  return Object.freeze({
    marketId,
    loanStablecoin,
    loanToken,
    collateralToken,
    oracle,
    irm,
    lltv: lltv.toString(10),
    loanTokenRuntimeCodeKeccak256: codeHashes[0] as string,
    collateralTokenRuntimeCodeKeccak256: codeHashes[1] as string,
    oracleRuntimeCodeKeccak256: codeHashes[2] as string,
    irmRuntimeCodeKeccak256: codeHashes[3] as string,
  });
}

function decodeMarketParams(value: unknown): DecodedMarketParams {
  const words = abiWords(value, 5);
  return Object.freeze({
    loanToken: addressFromWord(words[0]),
    collateralToken: addressFromWord(words[1]),
    oracle: addressFromWord(words[2]),
    irm: addressFromWord(words[3]),
    lltv: unsignedWord(words[4], MAX_UINT256),
  });
}

function decodeMarketState(value: unknown): DecodedMarketState {
  const words = abiWords(value, 6).map((word) => unsignedWord(word, MAX_UINT128));
  return Object.freeze({
    totalSupplyAssets: words[0] as bigint,
    totalSupplyShares: words[1] as bigint,
    totalBorrowAssets: words[2] as bigint,
    totalBorrowShares: words[3] as bigint,
    lastUpdate: words[4] as bigint,
    fee: words[5] as bigint,
  });
}

function decodeBoolean(value: unknown): boolean {
  const words = abiWords(value, 1);
  if (words[0] === '0'.repeat(64)) return false;
  if (words[0] === `${'0'.repeat(63)}1`) return true;
  return unavailable();
}

function sameMarketParams(
  observed: DecodedMarketParams,
  expected: MorphoBlueEthereumMarketManifest['market'],
): boolean {
  return (
    observed.loanToken === expected.loanToken &&
    observed.collateralToken === expected.collateralToken &&
    observed.oracle === expected.oracle &&
    observed.irm === expected.irm &&
    observed.lltv.toString(10) === expected.lltv
  );
}

function abiWords(value: unknown, count: number): readonly string[] {
  if (
    typeof value !== 'string' ||
    value.length !== 2 + count * 64 ||
    !/^0x[0-9a-f]+$/u.test(value)
  ) {
    return unavailable();
  }
  const words: string[] = [];
  for (let index = 0; index < count; index += 1) {
    words.push(value.slice(2 + index * 64, 2 + (index + 1) * 64));
  }
  return Object.freeze(words);
}

function addressFromWord(word: string | undefined): string {
  if (typeof word !== 'string' || !/^0{24}[0-9a-f]{40}$/u.test(word)) return unavailable();
  return `0x${word.slice(24)}`;
}

function unsignedWord(word: string | undefined, maximum: bigint): bigint {
  if (typeof word !== 'string' || !/^[0-9a-f]{64}$/u.test(word)) return unavailable();
  const parsed = BigInt(`0x${word}`);
  if (parsed > maximum) return unavailable();
  return parsed;
}

function parseBlock(value: unknown): EthereumBlockHeader {
  const record = allowedDataRecord(
    value,
    ['number', 'hash', 'parentHash', 'stateRoot', 'timestamp'],
    BLOCK_KEYS,
  );
  const number = hexQuantity(record.number, MAX_UINT64, true);
  const timestamp = hexQuantity(record.timestamp, MAX_UNIX_SECONDS, false);
  const hash = bytes32(record.hash);
  const parentHash = bytes32(record.parentHash);
  const stateRoot = bytes32(record.stateRoot);
  if (hash === ZERO_WORD || parentHash === ZERO_WORD || stateRoot === ZERO_WORD)
    return unavailable();
  return Object.freeze({ number, hash, parentHash, stateRoot, timestamp });
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

function parseRuntimeCode(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !HEX_DATA.test(value) ||
    value === '0x' ||
    (value.length - 2) / 2 > MAX_RUNTIME_CODE_BYTES
  ) {
    return unavailable();
  }
  return value;
}

function runtimeCodeKeccak256(value: string): string {
  try {
    return keccak256(value as Hex);
  } catch {
    return unavailable();
  }
}

function canonicalAddress(value: unknown): string {
  if (typeof value !== 'string' || !ADDRESS.test(value)) return unavailable();
  return value;
}

function nonzeroAddress(value: unknown): string {
  const address = canonicalAddress(value);
  if (address === ZERO_ADDRESS) return unavailable();
  return address;
}

function bytes32(value: unknown): string {
  if (typeof value !== 'string' || !BYTES32.test(value)) return unavailable();
  return value;
}

function hexQuantity(value: unknown, maximum: bigint, positive: boolean): string {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value) || value.length > 66) {
    return unavailable();
  }
  const parsed = BigInt(value);
  if (parsed > maximum || (positive && parsed === 0n)) return unavailable();
  return value;
}

function positiveCanonicalInteger(value: unknown, maximum: bigint): bigint {
  if (
    typeof value !== 'string' ||
    !CANONICAL_UNSIGNED_INTEGER.test(value) ||
    value.length > maximum.toString(10).length
  ) {
    return unavailable();
  }
  const parsed = BigInt(value);
  if (parsed === 0n || parsed > maximum) return unavailable();
  return parsed;
}

function addressWord(address: string): string {
  return `${'0'.repeat(24)}${address.slice(2)}`;
}

function uint256Word(value: bigint): string {
  if (value < 0n || value > MAX_UINT256) return unavailable();
  return value.toString(16).padStart(64, '0');
}

function canonicalClock(value: unknown): Readonly<{ timestamp: string; milliseconds: number }> {
  try {
    if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) {
      return unavailable();
    }
    const milliseconds = Date.prototype.getTime.call(value);
    if (!Number.isSafeInteger(milliseconds)) return unavailable();
    const timestamp = Date.prototype.toISOString.call(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp)) {
      return unavailable();
    }
    return Object.freeze({ timestamp, milliseconds });
  } catch (error) {
    if (error instanceof MorphoBlueEthereumTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function unixSecondsToTimestamp(value: bigint): string {
  if (value < 0n || value > MAX_UNIX_SECONDS) return unavailable();
  const milliseconds = value * 1_000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return unavailable();
  const timestamp = new Date(Number(milliseconds)).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp)) {
    return unavailable();
  }
  return timestamp;
}

interface DataBounds {
  readonly maximumBytes: number;
  readonly maximumNodes: number;
  readonly maximumDepth: number;
  readonly maximumArrayLength: number;
}

/** Traverses descriptors, so an accessor is rejected without being invoked. */
function assertBoundedData(value: unknown, bounds: DataBounds): void {
  try {
    const seen = new WeakSet<object>();
    let bytes = 0;
    let nodes = 0;
    const visit = (candidate: unknown, depth: number): void => {
      nodes += 1;
      if (nodes > bounds.maximumNodes || depth > bounds.maximumDepth) return unavailable();
      if (candidate === null || typeof candidate === 'boolean') {
        bytes += 5;
      } else if (typeof candidate === 'number') {
        if (!Number.isSafeInteger(candidate)) return unavailable();
        bytes += 32;
      } else if (typeof candidate === 'string') {
        bytes += Buffer.byteLength(candidate, 'utf8') + 2;
      } else if (typeof candidate === 'object') {
        if (seen.has(candidate)) return unavailable();
        seen.add(candidate);
        const array = Array.isArray(candidate);
        const prototype = Object.getPrototypeOf(candidate);
        if (
          (array && prototype !== Array.prototype) ||
          (!array && prototype !== Object.prototype && prototype !== null) ||
          Object.getOwnPropertySymbols(candidate).length !== 0
        ) {
          return unavailable();
        }
        const descriptors = Object.getOwnPropertyDescriptors(candidate);
        const keys: string[] = [];
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (array && key === 'length') continue;
          if (!descriptor.enumerable || !('value' in descriptor)) return unavailable();
          keys.push(key);
          bytes += Buffer.byteLength(key, 'utf8') + 3;
          visit(descriptor.value, depth + 1);
        }
        if (
          array &&
          (candidate.length > bounds.maximumArrayLength ||
            keys.length !== candidate.length ||
            keys.some((key, index) => key !== String(index)))
        ) {
          return unavailable();
        }
      } else {
        return unavailable();
      }
      if (bytes > bounds.maximumBytes) return unavailable();
    };
    visit(value, 0);
  } catch (error) {
    if (error instanceof MorphoBlueEthereumTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return unavailable();
    }
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
  } catch (error) {
    if (error instanceof MorphoBlueEthereumTranscriptUnavailableError) throw error;
    return unavailable();
  }
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> {
  const record = dataRecord(value);
  const actual = Object.keys(record);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    return unavailable();
  }
  return record;
}

function allowedDataRecord(
  value: unknown,
  required: readonly string[],
  allowed: readonly string[],
): Readonly<Record<string, unknown>> {
  const record = dataRecord(value);
  const actual = Object.keys(record);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowed.includes(key))
  ) {
    return unavailable();
  }
  return record;
}

function fingerprint(domain: string, values: readonly unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify([domain, ...values]), 'utf8')
    .digest('hex');
}

function unavailable(): never {
  throw new MorphoBlueEthereumTranscriptUnavailableError();
}
