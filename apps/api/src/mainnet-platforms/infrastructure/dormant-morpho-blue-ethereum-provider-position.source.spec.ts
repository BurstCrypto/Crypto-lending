import { readFileSync } from 'node:fs';

import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  createMorphoBlueEthereumMarketManifest,
  MORPHO_BLUE_ETHEREUM_ADDRESS,
  type MorphoBlueEthereumMarketManifest,
  type MorphoBlueEthereumMarketManifestDefinition,
} from '../../smart-lending/infrastructure/morpho/morpho-blue-ethereum-finalized-transcript.adapter';
import { MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256 } from '../../smart-lending/infrastructure/morpho/morpho-blue-account-position.semantics';
import {
  PROVIDER_POSITION_ADMISSION_SOURCE_USE,
  PROVIDER_POSITION_ADMISSION_VERSION,
  type ReadProviderPositionAdmissionTargetRequestV1,
} from '../application/provider-position-admission.coordinator';
import {
  DormantMorphoBlueEthereumProviderPositionSource,
  DormantMorphoBlueEthereumProviderPositionSourceError,
  MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_USE,
  MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
  MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE,
  MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
  type MorphoBlueEthereumDurableTargetContextReaderPort,
  type MorphoBlueEthereumFinalizedPositionTranscriptPort,
  type ReadMorphoBlueEthereumDurableTargetContextRequestV1,
  type ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1,
} from './dormant-morpho-blue-ethereum-provider-position.source';

const ACCOUNT_ID = parseAccountId('99999999-9999-4999-8999-999999999999');
const WALLET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WALLET_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FEE_RECIPIENT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const COLLATERAL = '0x1111111111111111111111111111111111111111';
const ORACLE = '0x2222222222222222222222222222222222222222';
const IRM = '0x870ac11d48b15db9a138cf899d20f13f79ba00bc';
const LLTV = 860_000_000_000_000_000n;
const CONTEXT_SOURCE_FAMILY_ID = 'durable-wallet-anchor';
const CONTEXT_SOURCE_ID = 'morpho-target-context';
const SOURCE_FAMILY_ID = 'morpho-rpc-operator';
const SOURCE_ID = 'morpho-rpc-primary';
const CORRELATION_ID = 'morpho-position-read-20260907';
const STARTED_AT = '2026-09-07T20:00:00.000Z';
const CONTEXT_SETTLED_AT = '2026-09-07T20:00:01.000Z';
const TRANSCRIPT_SETTLED_AT = '2026-09-07T20:00:02.000Z';
const COMPLETED_AT = '2026-09-07T20:00:03.000Z';
const DEADLINE_AT = '2026-09-07T20:00:25.000Z';
const FLOOR_HASH = `0x${'1'.repeat(64)}`;
const SELECTED_HASH = `0x${'2'.repeat(64)}`;
const SELECTED_PARENT_HASH = `0x${'3'.repeat(64)}`;
const SELECTED_STATE_ROOT = `0x${'4'.repeat(64)}`;
const FLOOR_PARENT_HASH = `0x${'5'.repeat(64)}`;
const FLOOR_STATE_ROOT = `0x${'6'.repeat(64)}`;
const FLOOR_NUMBER = '100';
const FLOOR_NUMBER_HEX = '0x64';
const SELECTED_NUMBER = '101';
const SELECTED_NUMBER_HEX = '0x65';
const SELECTED_TIMESTAMP_SECONDS = Math.floor(Date.parse(COMPLETED_AT) / 1_000) - 60;
const SELECTED_TIMESTAMP_HEX = `0x${SELECTED_TIMESTAMP_SECONDS.toString(16)}`;
const TRUE_WORD = `0x${'0'.repeat(63)}1`;

const CODES = Object.freeze({
  morpho: '0x6001',
  loan: '0x6002',
  collateral: '0x6003',
  oracle: '0x6004',
  irm: '0x6005',
});

type MutableRecord = Record<string, unknown>;

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function cloneMutable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => cloneMutable(entry));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, cloneMutable(member)]),
    );
  }
  return value;
}

function runtimeHash(code: string): string {
  return keccak256(code as Hex);
}

function marketId(): string {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
      ],
      [USDC as Address, COLLATERAL as Address, ORACLE as Address, IRM as Address, LLTV],
    ),
  );
}

function manifestDefinition(): MorphoBlueEthereumMarketManifestDefinition {
  return {
    schemaVersion: 1,
    use: 'DORMANT_MORPHO_BLUE_MARKET_CORROBORATION_ONLY',
    registryVersion: 1,
    registryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    networkId: 'eip155:1',
    chainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    maximumFinalizedBlockAgeSeconds: '1800',
    deployment: {
      kind: 'DIRECT_NON_PROXY',
      morphoAddress: MORPHO_BLUE_ETHEREUM_ADDRESS,
      morphoRuntimeCodeKeccak256: runtimeHash(CODES.morpho),
      implementationAddress: MORPHO_BLUE_ETHEREUM_ADDRESS,
      implementationRuntimeCodeKeccak256: runtimeHash(CODES.morpho),
    },
    market: {
      marketId: marketId(),
      loanStablecoin: 'USDC',
      loanToken: USDC,
      collateralToken: COLLATERAL,
      oracle: ORACLE,
      irm: IRM,
      lltv: LLTV.toString(10),
      loanTokenRuntimeCodeKeccak256: runtimeHash(CODES.loan),
      collateralTokenRuntimeCodeKeccak256: runtimeHash(CODES.collateral),
      oracleRuntimeCodeKeccak256: runtimeHash(CODES.oracle),
      irmRuntimeCodeKeccak256: runtimeHash(CODES.irm),
    },
  };
}

const MANIFEST = createMorphoBlueEthereumMarketManifest(manifestDefinition());
const TARGET_MARKET_ID = `morpho-blue-ethereum-${MANIFEST.market.marketId.slice(2)}`;

interface RawMarket {
  readonly totalSupplyAssets: bigint;
  readonly totalSupplyShares: bigint;
  readonly totalBorrowAssets: bigint;
  readonly totalBorrowShares: bigint;
  readonly lastUpdate: bigint;
  readonly fee: bigint;
}

const DEFAULT_MARKET = Object.freeze({
  totalSupplyAssets: 999_999_999n,
  totalSupplyShares: 999_000_000n,
  totalBorrowAssets: 699_999_999n,
  totalBorrowShares: 699_000_000n,
  lastUpdate: BigInt(SELECTED_TIMESTAMP_SECONDS),
  fee: 100_000_000_000_000_000n,
});

interface FixtureOptions {
  readonly contextMutate?: (value: MutableRecord) => void;
  readonly transcriptMutate?: (value: MutableRecord) => void;
  readonly clockValues?: readonly string[];
  readonly controller?: AbortController;
  readonly market?: Partial<RawMarket>;
  readonly supplyShares?: bigint;
  readonly borrowShares?: bigint;
  readonly collateralAtomic?: bigint;
  readonly feeRecipient?: string;
  readonly borrowRatePerSecondWad?: bigint;
  readonly contextReview?: boolean;
  readonly transcriptReview?: boolean;
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function abiUint(value: bigint): string {
  return `0x${word(value)}`;
}

function abiAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

function encodeParams(manifest: MorphoBlueEthereumMarketManifest): string {
  return `0x${[
    abiAddress(manifest.market.loanToken).slice(2),
    abiAddress(manifest.market.collateralToken).slice(2),
    abiAddress(manifest.market.oracle).slice(2),
    abiAddress(manifest.market.irm).slice(2),
    word(BigInt(manifest.market.lltv)),
  ].join('')}`;
}

function encodeMarket(value: RawMarket): string {
  return `0x${[
    value.totalSupplyAssets,
    value.totalSupplyShares,
    value.totalBorrowAssets,
    value.totalBorrowShares,
    value.lastUpdate,
    value.fee,
  ]
    .map(word)
    .join('')}`;
}

function encodePosition(supplyShares: bigint, borrowShares: bigint, collateral: bigint): string {
  return `0x${[supplyShares, borrowShares, collateral].map(word).join('')}`;
}

function selectedHeader(overrides: MutableRecord = {}): MutableRecord {
  return {
    number: SELECTED_NUMBER_HEX,
    hash: SELECTED_HASH,
    parentHash: SELECTED_PARENT_HASH,
    stateRoot: SELECTED_STATE_ROOT,
    timestamp: SELECTED_TIMESTAMP_HEX,
    ...overrides,
  };
}

function floorHeader(overrides: MutableRecord = {}): MutableRecord {
  return {
    number: FLOOR_NUMBER_HEX,
    hash: FLOOR_HASH,
    parentHash: FLOOR_PARENT_HASH,
    stateRoot: FLOOR_STATE_ROOT,
    timestamp: `0x${(SELECTED_TIMESTAMP_SECONDS - 12).toString(16)}`,
    ...overrides,
  };
}

function blockRead(selector: string, result: MutableRecord): MutableRecord {
  return { method: 'eth_getBlockByNumber', selector, includeTransactions: false, result };
}

function blockParameter(): MutableRecord {
  return { blockHash: SELECTED_HASH, requireCanonical: true };
}

function contextCapability(
  request: ReadMorphoBlueEthereumDurableTargetContextRequestV1,
): MutableRecord {
  return {
    contextVersion: MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    maySign: false,
    mayAccessWalletPrivateKey: false,
    accountId: request.accountId,
    correlationId: request.correlationId,
    deadlineAt: request.deadlineAt,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: request.sourceKind,
    walletId: request.walletId,
    providerId: request.providerId,
    protocolId: request.protocolId,
    marketId: request.marketId,
    networkId: request.networkId,
    contextSourceFamilyId: CONTEXT_SOURCE_FAMILY_ID,
    contextSourceId: CONTEXT_SOURCE_ID,
    walletAddress: WALLET_ADDRESS,
    continuityFloor: {
      kind: 'EVM_BLOCK',
      blockNumber: FLOOR_NUMBER,
      blockHash: FLOOR_HASH,
    },
  };
}

function codeForAddress(address: string): string {
  const entries = [
    [MORPHO_BLUE_ETHEREUM_ADDRESS, CODES.morpho],
    [MANIFEST.market.loanToken, CODES.loan],
    [MANIFEST.market.collateralToken, CODES.collateral],
    [MANIFEST.market.oracle, CODES.oracle],
    [MANIFEST.market.irm, CODES.irm],
  ];
  const match = entries.find(([candidate]) => candidate === address);
  if (match === undefined) throw new Error('Unexpected fixture code address');
  return match[1] as string;
}

function rateCallData(
  request: ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1,
  market: RawMarket,
): string {
  return `${request.borrowRateReadPolicy.selector}${[
    abiAddress(request.manifest.market.loanToken).slice(2),
    abiAddress(request.manifest.market.collateralToken).slice(2),
    abiAddress(request.manifest.market.oracle).slice(2),
    abiAddress(request.manifest.market.irm).slice(2),
    word(BigInt(request.manifest.market.lltv)),
    word(market.totalSupplyAssets),
    word(market.totalSupplyShares),
    word(market.totalBorrowAssets),
    word(market.totalBorrowShares),
    word(market.lastUpdate),
    word(market.fee),
  ].join('')}`;
}

function transcriptCapability(
  request: ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1,
  options: FixtureOptions,
): MutableRecord {
  const market: RawMarket = Object.freeze({ ...DEFAULT_MARKET, ...options.market });
  const results: Readonly<Record<string, unknown>> = Object.freeze({
    'market-params': encodeParams(request.manifest),
    'market-state': encodeMarket(market),
    'fee-recipient': abiAddress(options.feeRecipient ?? FEE_RECIPIENT),
    'irm-enabled': TRUE_WORD,
    'lltv-enabled': TRUE_WORD,
    'wallet-position': encodePosition(
      options.supplyShares ?? 100_000_000n,
      options.borrowShares ?? 70_000_000n,
      options.collateralAtomic ?? 30_000_000n,
    ),
  });
  const shouldReadRate =
    market.lastUpdate < BigInt(SELECTED_TIMESTAMP_SECONDS) && market.totalBorrowAssets !== 0n;
  return {
    transcriptVersion: MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    maySign: false,
    mayAccessWalletPrivateKey: false,
    accountId: request.accountId,
    correlationId: request.correlationId,
    deadlineAt: request.deadlineAt,
    sourceFamilyId: request.sourceFamilyId,
    sourceId: request.sourceId,
    sourceKind: request.sourceKind,
    walletId: request.walletId,
    providerId: request.providerId,
    protocolId: request.protocolId,
    marketId: request.marketId,
    networkId: request.networkId,
    walletAddress: request.walletAddress,
    manifestFingerprintSha256: request.manifestFingerprintSha256,
    semanticsFingerprintSha256: request.semanticsFingerprintSha256,
    chainIdBefore: '0x1',
    chainIdAfter: '0x1',
    selectedBlockBefore: blockRead('finalized', selectedHeader()),
    floorBlockBefore: blockRead(FLOOR_NUMBER_HEX, floorHeader()),
    codeReads: request.codeReads.map((read) => ({
      operationId: read.operationId,
      method: 'eth_getCode',
      address: read.address,
      blockParameter: blockParameter(),
      result: codeForAddress(read.address),
    })),
    stateReads: request.stateReads.map((read) => ({
      operationId: read.operationId,
      method: 'eth_call',
      to: read.to,
      data: read.data,
      from: read.from,
      blockParameter: blockParameter(),
      result: results[read.operationId],
    })),
    borrowRateRead: shouldReadRate
      ? {
          operationId: request.borrowRateReadPolicy.operationId,
          method: 'eth_call',
          to: request.borrowRateReadPolicy.to,
          data: rateCallData(request, market),
          from: null,
          blockParameter: blockParameter(),
          result: abiUint(options.borrowRatePerSecondWad ?? 1_000_000_000n),
        }
      : null,
    floorBlockAfter: blockRead(FLOOR_NUMBER_HEX, floorHeader()),
    selectedBlockAfter: blockRead(SELECTED_NUMBER_HEX, selectedHeader()),
    status: 'COMPLETE',
    coverageScope: 'EXACT_APPROVED_MARKET_DIRECT_LOAN_ASSET_POSITION_ONLY',
    authorizationTraversal: false,
    indirectExposureIncluded: false,
    zeroPositionSemantics:
      'EXACT_ZERO_PROJECTED_LOAN_ASSET_SUPPLY_AND_BORROW_FOR_BOUND_WALLET_AND_MARKET',
  };
}

function request(controller = new AbortController()): ReadProviderPositionAdmissionTargetRequestV1 {
  return Object.freeze({
    admissionVersion: PROVIDER_POSITION_ADMISSION_VERSION,
    accountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
    deadlineAt: DEADLINE_AT,
    signal: controller.signal,
    sourceFamilyId: SOURCE_FAMILY_ID,
    sourceId: SOURCE_ID,
    sourceKind: 'RPC' as const,
    walletId: WALLET_ID,
    providerId: 'morpho',
    protocolId: 'morpho-blue',
    marketId: TARGET_MARKET_ID,
    networkId: 'eip155:1',
    assets: Object.freeze([
      Object.freeze({
        stablecoin: 'USDC' as const,
        networkId: 'eip155:1',
        identity: USDC,
        decimals: 6,
      }),
    ]),
  });
}

interface Fixture {
  readonly source: DormantMorphoBlueEthereumProviderPositionSource;
  readonly contextPort: MorphoBlueEthereumDurableTargetContextReaderPort;
  readonly transcriptPort: MorphoBlueEthereumFinalizedPositionTranscriptPort;
  readonly contextRequests: readonly ReadMorphoBlueEthereumDurableTargetContextRequestV1[];
  readonly transcriptRequests: readonly ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1[];
}

function fixture(options: FixtureOptions = {}): Fixture {
  const contextRequests: ReadMorphoBlueEthereumDurableTargetContextRequestV1[] = [];
  const transcriptRequests: ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1[] = [];
  const contextBindings = new WeakMap<
    object,
    ReadMorphoBlueEthereumDurableTargetContextRequestV1
  >();
  const transcriptBindings = new WeakMap<
    object,
    ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1
  >();
  const contextPort: MorphoBlueEthereumDurableTargetContextReaderPort = {
    contextVersion: MORPHO_BLUE_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    sourceFamilyId: CONTEXT_SOURCE_FAMILY_ID,
    sourceId: CONTEXT_SOURCE_ID,
    readContext: async (issuedRequest) => {
      contextRequests.push(issuedRequest);
      const value = contextCapability(issuedRequest);
      options.contextMutate?.(value);
      const capability = deepFreeze(value);
      contextBindings.set(capability, issuedRequest);
      return capability;
    },
    reviewContext: (capability, issuedRequest) =>
      options.contextReview !== false &&
      typeof capability === 'object' &&
      capability !== null &&
      contextBindings.get(capability) === issuedRequest
        ? capability
        : null,
  };
  const transcriptPort: MorphoBlueEthereumFinalizedPositionTranscriptPort = {
    transcriptVersion: MORPHO_BLUE_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    sourceFamilyId: SOURCE_FAMILY_ID,
    sourceId: SOURCE_ID,
    readTranscript: async (issuedRequest) => {
      transcriptRequests.push(issuedRequest);
      const value = transcriptCapability(issuedRequest, options);
      options.transcriptMutate?.(value);
      const capability = deepFreeze(value);
      transcriptBindings.set(capability, issuedRequest);
      return capability;
    },
    reviewTranscript: (capability, issuedRequest) =>
      options.transcriptReview !== false &&
      typeof capability === 'object' &&
      capability !== null &&
      transcriptBindings.get(capability) === issuedRequest
        ? capability
        : null,
  };
  const clockValues = options.clockValues ?? [
    STARTED_AT,
    CONTEXT_SETTLED_AT,
    TRANSCRIPT_SETTLED_AT,
    COMPLETED_AT,
  ];
  let clockIndex = 0;
  const clock = {
    now: (): Date =>
      new Date(clockValues[Math.min(clockIndex++, clockValues.length - 1)] as string),
  };
  return {
    source: new DormantMorphoBlueEthereumProviderPositionSource(
      MANIFEST,
      MANIFEST.manifestFingerprintSha256,
      MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
      contextPort,
      transcriptPort,
      clock,
    ),
    contextPort,
    transcriptPort,
    contextRequests,
    transcriptRequests,
  };
}

function unavailable(code = 'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_UNAVAILABLE'): object {
  return expect.objectContaining({
    name: 'DormantMorphoBlueEthereumProviderPositionSourceError',
    code,
    message: 'Morpho Blue Ethereum provider-position source is unavailable.',
  });
}

describe('dormant Morpho Blue Ethereum provider-position source', () => {
  it('binds durable wallet context and emits exact market-scoped accrued loan positions', async () => {
    const { source, contextRequests, transcriptRequests } = fixture();

    await expect(source.readTarget(request())).resolves.toEqual({
      evidenceVersion: PROVIDER_POSITION_ADMISSION_VERSION,
      use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
      mayAuthorizeFinancialAction: false,
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      sourceKind: 'RPC',
      sourceObservationId: `ethereum-block-${SELECTED_NUMBER}`,
      walletId: WALLET_ID,
      providerId: 'morpho',
      protocolId: 'morpho-blue',
      marketId: TARGET_MARKET_ID,
      networkId: 'eip155:1',
      assets: [{ stablecoin: 'USDC', networkId: 'eip155:1', identity: USDC, decimals: 6 }],
      status: 'COMPLETE',
      observedAt: COMPLETED_AT,
      staleAfter: DEADLINE_AT,
      continuityFloor: { kind: 'EVM_BLOCK', blockNumber: FLOOR_NUMBER, blockHash: FLOOR_HASH },
      chainAnchor: {
        kind: 'EVM_BLOCK',
        blockNumber: SELECTED_NUMBER,
        blockHash: SELECTED_HASH,
      },
      positions: [
        {
          positionId: `${TARGET_MARKET_ID}-supply`,
          positionKind: 'SUPPLY',
          asset: { stablecoin: 'USDC', networkId: 'eip155:1', identity: USDC, decimals: 6 },
          balance: { atomic: '100000000', decimal: '100.000000' },
        },
        {
          positionId: `${TARGET_MARKET_ID}-borrow`,
          positionKind: 'BORROW',
          asset: { stablecoin: 'USDC', networkId: 'eip155:1', identity: USDC, decimals: 6 },
          balance: { atomic: '70000000', decimal: '70.000000' },
        },
      ],
    });

    expect(contextRequests).toHaveLength(1);
    expect(transcriptRequests).toHaveLength(1);
    const context = contextRequests[0] as ReadMorphoBlueEthereumDurableTargetContextRequestV1;
    const transcript =
      transcriptRequests[0] as ReadMorphoBlueEthereumFinalizedPositionTranscriptRequestV1;
    expect(context.admissionRequest).toBeDefined();
    expect(context.signal).toBe(context.admissionRequest.signal);
    expect(transcript.admissionRequest).toBe(context.admissionRequest);
    expect(transcript.contextRequest).toBe(context);
    expect(transcript.contextCapability.walletAddress).toBe(WALLET_ADDRESS);
    expect(transcript.signal).toBe(context.signal);
    expect(transcript.continuityFloor).toEqual(transcript.contextCapability.continuityFloor);
    expect(transcript.manifest).toEqual(MANIFEST);
    expect(transcript.manifestFingerprintSha256).toBe(MANIFEST.manifestFingerprintSha256);
    expect(transcript.semanticsFingerprintSha256).toBe(
      MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    );
    expect(transcript.marketId).toBe(TARGET_MARKET_ID);
    expect(transcript.blockSelector).toBe('finalized');
    expect(transcript.blockBinding).toBe('EIP1898_BLOCK_HASH_REQUIRE_CANONICAL');
    expect(transcript.codeReads).toHaveLength(5);
    expect(transcript.stateReads.map(({ operationId }) => operationId)).toEqual([
      'market-params',
      'market-state',
      'fee-recipient',
      'irm-enabled',
      'lltv-enabled',
      'wallet-position',
    ]);
    expect(transcript.stateReads.at(-1)?.data).toBe(
      `0x93c52062${MANIFEST.market.marketId.slice(2)}${abiAddress(WALLET_ADDRESS).slice(2)}`,
    );
    expect(transcript.borrowRateReadPolicy).toEqual({
      operationId: 'borrow-rate-view',
      to: IRM,
      selector: '0x8c00bf6b',
      from: null,
      condition: 'ELAPSED_NONZERO_AND_TOTAL_BORROW_ASSETS_NONZERO_AND_MANIFEST_IRM_NONZERO',
      arguments: 'EXACT_MANIFEST_MARKET_PARAMS_AND_SAME_BLOCK_RAW_MARKET_TUPLE',
    });
    expect(Object.isFrozen(transcript)).toBe(true);
  });

  it('requires explicit zero projection for both loan sides before returning no positions', async () => {
    const { source } = fixture({ supplyShares: 0n, borrowShares: 0n, collateralAtomic: 9n });

    await expect(source.readTarget(request())).resolves.toEqual(
      expect.objectContaining({ status: 'COMPLETE', positions: [] }),
    );
  });

  it('uses the exact same-block IRM rate branch and fee-recipient adjustment', async () => {
    const raw = {
      totalSupplyAssets: 1_000_000_000n,
      totalSupplyShares: 999_000_000n,
      totalBorrowAssets: 700_000_000n,
      totalBorrowShares: 699_000_000n,
      lastUpdate: BigInt(SELECTED_TIMESTAMP_SECONDS - 60),
      fee: 100_000_000_000_000_000n,
    };
    const ordinary = fixture({
      market: raw,
      supplyShares: 100_000_000n,
      borrowShares: 70_000_000n,
      borrowRatePerSecondWad: 1_000_000_000n,
    });
    const feeRecipient = fixture({
      market: raw,
      supplyShares: 100_000_000n,
      borrowShares: 70_000_000n,
      borrowRatePerSecondWad: 1_000_000_000n,
      feeRecipient: WALLET_ADDRESS,
    });

    const ordinaryEvidence = await ordinary.source.readTarget(request());
    const recipientEvidence = await feeRecipient.source.readTarget(request());
    const ordinarySupply = ordinaryEvidence.positions.find(
      ({ positionKind }) => positionKind === 'SUPPLY',
    );
    const recipientSupply = recipientEvidence.positions.find(
      ({ positionKind }) => positionKind === 'SUPPLY',
    );
    expect(BigInt(recipientSupply?.balance.atomic ?? '0')).toBeGreaterThan(
      BigInt(ordinarySupply?.balance.atomic ?? '0'),
    );
  });

  it.each([
    ['providerId', 'aave'],
    ['protocolId', 'morpho-v1'],
    ['marketId', 'morpho-blue-ethereum-usdc'],
    ['networkId', 'eip155:8453'],
    ['sourceKind', 'INDEXER'],
    ['sourceFamilyId', 'other-family'],
    ['sourceId', 'other-source'],
  ] as const)('rejects a mismatched %s before durable access', async (key, value) => {
    const { source, contextRequests } = fixture();
    const changed = Object.freeze({ ...request(), [key]: value });

    await expect(source.readTarget(changed)).rejects.toEqual(
      unavailable('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST'),
    );
    expect(contextRequests).toHaveLength(0);
  });

  it('rejects a substituted loan asset and non-frozen request before durable access', async () => {
    const first = fixture();
    const wrongAsset = Object.freeze({
      ...request(),
      assets: Object.freeze([
        Object.freeze({
          stablecoin: 'USDT' as const,
          networkId: 'eip155:1',
          identity: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          decimals: 6,
        }),
      ]),
    });
    await expect(first.source.readTarget(wrongAsset)).rejects.toEqual(
      unavailable('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST'),
    );

    const second = fixture();
    await expect(second.source.readTarget({ ...request() })).rejects.toEqual(
      unavailable('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST'),
    );
    expect(first.contextRequests).toHaveLength(0);
    expect(second.contextRequests).toHaveLength(0);
  });

  it('requires opaque context and transcript authentication against exact request identity', async () => {
    await expect(fixture({ contextReview: false }).source.readTarget(request())).rejects.toEqual(
      unavailable(),
    );
    await expect(fixture({ transcriptReview: false }).source.readTarget(request())).rejects.toEqual(
      unavailable(),
    );
  });

  it.each([
    ['walletAddress', '0x0000000000000000000000000000000000000000'],
    ['marketId', 'morpho-blue-ethereum-wrong'],
    ['contextSourceId', 'wrong-context'],
    ['maySign', true],
  ] as const)('rejects context capability %s drift', async (key, value) => {
    const { source } = fixture({ contextMutate: (capability) => (capability[key] = value) });
    await expect(source.readTarget(request())).rejects.toEqual(unavailable());
  });

  it.each([
    ['chainIdAfter', '0x2'],
    ['walletAddress', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    ['manifestFingerprintSha256', 'f'.repeat(64)],
    ['semanticsFingerprintSha256', 'e'.repeat(64)],
    ['coverageScope', 'COMPLETE_ACCOUNT'],
    ['authorizationTraversal', true],
    ['indirectExposureIncluded', true],
    ['mayPersist', true],
  ] as const)('rejects transcript %s drift', async (key, value) => {
    const { source } = fixture({ transcriptMutate: (capability) => (capability[key] = value) });
    await expect(source.readTarget(request())).rejects.toEqual(unavailable());
  });

  it('rejects selected/floor reorgs, regression, and noncanonical EIP-1898 bindings', async () => {
    const mutations: readonly ((capability: MutableRecord) => void)[] = [
      (capability) => {
        const after = capability.selectedBlockAfter as MutableRecord;
        (after.result as MutableRecord).hash = `0x${'9'.repeat(64)}`;
      },
      (capability) => {
        const selected = capability.selectedBlockBefore as MutableRecord;
        (selected.result as MutableRecord).number = '0x63';
      },
      (capability) => {
        const floor = capability.floorBlockAfter as MutableRecord;
        (floor.result as MutableRecord).hash = `0x${'8'.repeat(64)}`;
      },
      (capability) => {
        const reads = capability.codeReads as MutableRecord[];
        (reads[0]?.blockParameter as MutableRecord).requireCanonical = false;
      },
    ];
    for (const mutate of mutations) {
      await expect(
        fixture({ transcriptMutate: mutate }).source.readTarget(request()),
      ).rejects.toEqual(unavailable());
    }
  });

  it('rejects code, market, wallet-position, enablement, and dynamic rate substitution', async () => {
    const mutations: readonly ((capability: MutableRecord) => void)[] = [
      (capability) => {
        const reads = capability.codeReads as MutableRecord[];
        (reads[0] as MutableRecord).result = '0x6009';
      },
      (capability) => {
        const reads = capability.stateReads as MutableRecord[];
        (reads[0] as MutableRecord).result = `0x${'0'.repeat(64 * 5)}`;
      },
      (capability) => {
        const reads = capability.stateReads as MutableRecord[];
        (reads[3] as MutableRecord).result = `0x${'0'.repeat(64)}`;
      },
      (capability) => {
        const reads = capability.stateReads as MutableRecord[];
        (reads[5] as MutableRecord).data = '0x93c52062';
      },
      (capability) => {
        const rate = capability.borrowRateRead as MutableRecord;
        rate.data = `${rate.data as string}00`;
      },
    ];
    for (const mutate of mutations) {
      const options: FixtureOptions = {
        market: { lastUpdate: BigInt(SELECTED_TIMESTAMP_SECONDS - 60) },
        transcriptMutate: mutate,
      };
      await expect(fixture(options).source.readTarget(request())).rejects.toEqual(unavailable());
    }
  });

  it('requires the conditional IRM result exactly when the pinned semantics require it', async () => {
    const withElapsed = fixture({
      market: { lastUpdate: BigInt(SELECTED_TIMESTAMP_SECONDS - 60) },
      transcriptMutate: (capability) => (capability.borrowRateRead = null),
    });
    await expect(withElapsed.source.readTarget(request())).rejects.toEqual(unavailable());

    const withoutElapsed = fixture({
      transcriptMutate: (capability) => {
        capability.borrowRateRead = {
          operationId: 'borrow-rate-view',
          method: 'eth_call',
          to: IRM,
          data: '0x',
          from: null,
          blockParameter: blockParameter(),
          result: abiUint(0n),
        };
      },
    });
    await expect(withoutElapsed.source.readTarget(request())).rejects.toEqual(unavailable());
  });

  it.each([
    [{ fee: 250_000_000_000_000_001n }, 'fee above Morpho MAX_FEE'],
    [{ totalBorrowAssets: 1n, totalBorrowShares: 0n }, 'unpaired borrow state'],
    [{ totalBorrowAssets: 1_000_000_000n }, 'borrow above supply'],
    [{ lastUpdate: BigInt(SELECTED_TIMESTAMP_SECONDS + 1) }, 'future last update'],
  ] as const)('fails closed on %s', async (market, description) => {
    expect(description).toEqual(expect.any(String));
    await expect(fixture({ market }).source.readTarget(request())).rejects.toEqual(unavailable());
  });

  it('fails closed on abort before and during dependency work while draining started work', async () => {
    const before = new AbortController();
    before.abort();
    const beforeFixture = fixture({ controller: before });
    await expect(beforeFixture.source.readTarget(request(before))).rejects.toEqual(
      unavailable('MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST'),
    );
    expect(beforeFixture.contextRequests).toHaveLength(0);

    const during = new AbortController();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = fixture({ controller: during });
    const original = base.transcriptPort.readTranscript.bind(base.transcriptPort);
    const delayedTranscriptPort: MorphoBlueEthereumFinalizedPositionTranscriptPort = {
      ...base.transcriptPort,
      readTranscript: async (issuedRequest) => {
        const result = original(issuedRequest);
        await pending;
        return result;
      },
    };
    const source = new DormantMorphoBlueEthereumProviderPositionSource(
      MANIFEST,
      MANIFEST.manifestFingerprintSha256,
      MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
      base.contextPort,
      delayedTranscriptPort,
      { now: () => new Date(COMPLETED_AT) },
    );
    let settled = false;
    const read = source.readTarget(request(during)).finally(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    during.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await expect(read).rejects.toEqual(unavailable());
  });

  it('rejects deadline expiry and a regressing server clock after awaited work', async () => {
    await expect(
      fixture({
        clockValues: [STARTED_AT, CONTEXT_SETTLED_AT, DEADLINE_AT],
      }).source.readTarget(request()),
    ).rejects.toEqual(unavailable());
    await expect(
      fixture({
        clockValues: [STARTED_AT, CONTEXT_SETTLED_AT, STARTED_AT],
      }).source.readTarget(request()),
    ).rejects.toEqual(unavailable());
  });

  it('rejects accessor, cyclic, unfrozen, and oversized transcript capabilities', async () => {
    const mutations: readonly ((capability: MutableRecord) => void)[] = [
      (capability) => {
        Object.defineProperty(capability, 'status', { enumerable: true, get: () => 'COMPLETE' });
      },
      (capability) => {
        capability.extra = capability;
      },
      (capability) => {
        const reads = capability.codeReads as MutableRecord[];
        (reads[0] as MutableRecord).result = `0x${'60'.repeat(65_537)}`;
      },
    ];
    for (const mutate of mutations) {
      await expect(
        fixture({ transcriptMutate: mutate }).source.readTarget(request()),
      ).rejects.toEqual(unavailable());
    }

    const { source } = fixture({
      transcriptMutate: (capability) => {
        capability.codeReads = (capability.codeReads as MutableRecord[]).map((read) =>
          Object.freeze(read),
        );
      },
    });
    await expect(source.readTarget(request())).rejects.toEqual(unavailable());
  });

  it('rejects unreviewed manifest/semantics fingerprints and dependency identity laundering', () => {
    const valid = fixture();
    expect(
      () =>
        new DormantMorphoBlueEthereumProviderPositionSource(
          MANIFEST,
          'f'.repeat(64),
          MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
          valid.contextPort,
          valid.transcriptPort,
          { now: () => new Date(STARTED_AT) },
        ),
    ).toThrow(
      new DormantMorphoBlueEthereumProviderPositionSourceError(
        'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION',
      ),
    );
    expect(
      () =>
        new DormantMorphoBlueEthereumProviderPositionSource(
          MANIFEST,
          MANIFEST.manifestFingerprintSha256,
          'e'.repeat(64),
          valid.contextPort,
          valid.transcriptPort,
          { now: () => new Date(STARTED_AT) },
        ),
    ).toThrow(
      new DormantMorphoBlueEthereumProviderPositionSourceError(
        'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION',
      ),
    );
    const sameFamily = { ...valid.contextPort, sourceFamilyId: SOURCE_FAMILY_ID };
    expect(
      () =>
        new DormantMorphoBlueEthereumProviderPositionSource(
          MANIFEST,
          MANIFEST.manifestFingerprintSha256,
          MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
          sameFamily,
          valid.transcriptPort,
          { now: () => new Date(STARTED_AT) },
        ),
    ).toThrow(
      new DormantMorphoBlueEthereumProviderPositionSourceError(
        'MORPHO_BLUE_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION',
      ),
    );
  });

  it('maps private dependency failures to one sanitized error', async () => {
    const valid = fixture();
    const transcriptPort = {
      ...valid.transcriptPort,
      readTranscript: async () => {
        throw new Error('https://secret-rpc.example account=private');
      },
    };
    const source = new DormantMorphoBlueEthereumProviderPositionSource(
      MANIFEST,
      MANIFEST.manifestFingerprintSha256,
      MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
      valid.contextPort,
      transcriptPort,
      { now: () => new Date(STARTED_AT) },
    );
    await expect(source.readTarget(request())).rejects.toEqual(unavailable());
  });

  it('is direct-import-only and contains no endpoint, environment, Nest, signer, or write path', () => {
    const source = readFileSync(__filename.replace(/\.spec\.ts$/u, '.ts'), 'utf8');
    const barrel = readFileSync(`${__dirname}/../index.ts`, 'utf8');
    const moduleSource = readFileSync(`${__dirname}/../mainnet-platforms.module.ts`, 'utf8');
    const registration = readFileSync(
      `${__dirname}/provider-position-read-runtime.registration.ts`,
      'utf8',
    );
    expect(source).not.toMatch(
      /@nestjs|process\.env|\bfetch\b|https?:\/\/|WebSocket|createPublicClient/u,
    );
    expect(source).not.toMatch(/privateKey|sendTransaction|writeContract|eth_sendRawTransaction/u);
    expect(barrel).not.toContain('DormantMorphoBlueEthereumProviderPositionSource');
    expect(moduleSource).not.toContain('DormantMorphoBlueEthereumProviderPositionSource');
    expect(registration).not.toContain('DormantMorphoBlueEthereumProviderPositionSource');
  });

  it('does not accept clones as authenticated capabilities', async () => {
    const valid = fixture();
    const contextPort = {
      ...valid.contextPort,
      reviewContext: (capability: unknown) => cloneMutable(capability),
    };
    const source = new DormantMorphoBlueEthereumProviderPositionSource(
      MANIFEST,
      MANIFEST.manifestFingerprintSha256,
      MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
      contextPort,
      valid.transcriptPort,
      { now: () => new Date(STARTED_AT) },
    );
    await expect(source.readTarget(request())).rejects.toEqual(unavailable());
  });
});
