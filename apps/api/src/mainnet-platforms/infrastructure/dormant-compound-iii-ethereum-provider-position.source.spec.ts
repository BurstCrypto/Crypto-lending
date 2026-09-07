import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  compoundIIIUSDCManifestFingerprintSha256,
  type CompoundIIIUSDCFinalizedManifest,
} from '../../smart-lending/infrastructure/compound/compound-iii-ethereum-usdc.manifest';
import {
  PROVIDER_POSITION_ADMISSION_SOURCE_USE,
  PROVIDER_POSITION_ADMISSION_VERSION,
  type ReadProviderPositionAdmissionTargetRequestV1,
} from '../application/provider-position-admission.coordinator';
import {
  COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_USE,
  COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
  COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE,
  COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
  DormantCompoundIIIEthereumProviderPositionSource,
  DormantCompoundIIIEthereumProviderPositionSourceError,
  type CompoundIIIEthereumDurableTargetContextReaderPort,
  type CompoundIIIEthereumFinalizedPositionTranscriptPort,
  type ReadCompoundIIIEthereumDurableTargetContextRequestV1,
  type ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
} from './dormant-compound-iii-ethereum-provider-position.source';

const ACCOUNT_ID = parseAccountId('99999999-9999-4999-8999-999999999999');
const OTHER_ACCOUNT_ID = parseAccountId('88888888-8888-4888-8888-888888888888');
const WALLET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_WALLET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WALLET_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PROXY = '0xc3d688b66703497daa19211eedff47f25384cdc3';
const ADMIN = '0x1111111111111111111111111111111111111111';
const IMPLEMENTATION = '0x2222222222222222222222222222222222222222';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const NETWORK_ID = 'eip155:1';
const PROVIDER_ID = 'compound';
const PROTOCOL_ID = 'compound-iii';
const MARKET_ID = 'compound-iii-ethereum-usdc';
const CONTEXT_SOURCE_FAMILY_ID = 'durable-wallet-anchor';
const CONTEXT_SOURCE_ID = 'compound-target-context';
const SOURCE_FAMILY_ID = 'compound-rpc-operator';
const SOURCE_ID = 'compound-rpc-primary';
const CORRELATION_ID = 'compound-position-read-20260906';
const STARTED_AT = '2026-09-06T20:00:00.000Z';
const CONTEXT_SETTLED_AT = '2026-09-06T20:00:01.000Z';
const TRANSCRIPT_SETTLED_AT = '2026-09-06T20:00:02.000Z';
const COMPLETED_AT = '2026-09-06T20:00:03.000Z';
const DEADLINE_AT = '2026-09-06T20:00:25.000Z';
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
const SELECTED_TIMESTAMP_SECONDS = Math.floor(Date.parse(COMPLETED_AT) / 1_000) - 600;
const SELECTED_TIMESTAMP_HEX = `0x${SELECTED_TIMESTAMP_SECONDS.toString(16)}`;

type MutableRecord = Record<string, unknown>;

const CODES = Object.freeze({
  proxy: '0x6001',
  implementation: '0x6002',
  baseAsset: '0x6003',
});

function sha256Code(code: string): string {
  return createHash('sha256')
    .update(Buffer.from(code.slice(2), 'hex'))
    .digest('hex');
}

const MANIFEST = {
  schemaVersion: 1,
  providerId: PROVIDER_ID,
  protocolId: PROTOCOL_ID,
  networkId: NETWORK_ID,
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
  maximumBlockAgeSeconds: '3600',
  assetRegistry: {
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  },
  marketId: MARKET_ID,
  cometProxy: PROXY,
  proxyAdmin: ADMIN,
  implementation: IMPLEMENTATION,
  baseAsset: { symbol: 'USDC', address: USDC, decimals: 6, scale: '1000000' },
  runtimeCodeSha256: {
    cometProxy: sha256Code(CODES.proxy),
    implementation: sha256Code(CODES.implementation),
    baseAsset: sha256Code(CODES.baseAsset),
  },
  officialSource: {
    repository: 'compound-finance/comet',
    commit: 'f766f51583c23acc33b2a7824654ef2029a96804',
    deploymentPath: 'deployments/mainnet/usdc',
  },
} as const satisfies CompoundIIIUSDCFinalizedManifest;
const MANIFEST_FINGERPRINT = compoundIIIUSDCManifestFingerprintSha256(MANIFEST);

interface FixtureOptions {
  readonly contextMutate?: (value: MutableRecord) => void;
  readonly transcriptMutate?: (value: MutableRecord) => void;
  readonly clockValues?: readonly string[];
  readonly controller?: AbortController;
  readonly supplyAtomic?: bigint;
  readonly borrowAtomic?: bigint;
}

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

function abiUint(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function abiAddress(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
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
  request: ReadCompoundIIIEthereumDurableTargetContextRequestV1,
): MutableRecord {
  return {
    contextVersion: COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_USE,
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

function codeResult(
  read: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1['codeReads'][number],
): MutableRecord {
  const result =
    read.operationId === 'comet-proxy-code'
      ? CODES.proxy
      : read.operationId === 'comet-implementation-code'
        ? CODES.implementation
        : CODES.baseAsset;
  return {
    operationId: read.operationId,
    method: 'eth_getCode',
    address: read.address,
    blockParameter: blockParameter(),
    result,
  };
}

function identityResult(
  read: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1['identityReads'][number],
): MutableRecord {
  const result =
    read.operationId === 'proxy-implementation'
      ? abiAddress(IMPLEMENTATION)
      : read.operationId === 'base-token'
        ? abiAddress(USDC)
        : read.operationId === 'base-scale'
          ? abiUint(1_000_000n)
          : abiUint(6n);
  return {
    operationId: read.operationId,
    method: 'eth_call',
    to: read.to,
    data: read.data,
    from: read.from,
    blockParameter: blockParameter(),
    result,
  };
}

function accountResult(
  read: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1['accountReads'][number],
  supplyAtomic: bigint,
  borrowAtomic: bigint,
): MutableRecord {
  return {
    operationId: read.operationId,
    positionKind: read.positionKind,
    method: 'eth_call',
    to: read.to,
    data: read.data,
    from: read.from,
    blockParameter: blockParameter(),
    result: abiUint(read.positionKind === 'SUPPLY' ? supplyAtomic : borrowAtomic),
  };
}

function transcriptCapability(
  request: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
  supplyAtomic: bigint,
  borrowAtomic: bigint,
): MutableRecord {
  return {
    transcriptVersion: COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_USE,
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
    walletAddress: request.walletAddress,
    manifestFingerprintSha256: request.manifestFingerprintSha256,
    chainIdBefore: '0x1',
    chainIdAfter: '0x1',
    selectedBlockBefore: blockRead('finalized', selectedHeader()),
    floorBlockBefore: blockRead(FLOOR_NUMBER_HEX, floorHeader()),
    codeReads: request.codeReads.map((read) => codeResult(read)),
    identityReads: request.identityReads.map((read) => identityResult(read)),
    accountReads: request.accountReads.map((read) =>
      accountResult(read, supplyAtomic, borrowAtomic),
    ),
    floorBlockAfter: blockRead(FLOOR_NUMBER_HEX, floorHeader()),
    selectedBlockAfter: blockRead(SELECTED_NUMBER_HEX, selectedHeader()),
    status: 'COMPLETE',
    zeroPositionSemantics: 'EXACT_ZERO_RESULT_FOR_BOTH_COMET_BASE_BALANCE_CALLS',
  };
}

class FakeContextReader implements CompoundIIIEthereumDurableTargetContextReaderPort {
  readonly contextVersion = COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION;
  readonly sourceFamilyId = CONTEXT_SOURCE_FAMILY_ID;
  readonly sourceId = CONTEXT_SOURCE_ID;
  readonly calls: ReadCompoundIIIEthereumDurableTargetContextRequestV1[] = [];
  readonly reviews: ReadCompoundIIIEthereumDurableTargetContextRequestV1[] = [];
  readonly issued = new WeakMap<object, ReadCompoundIIIEthereumDurableTargetContextRequestV1>();
  error: Error | undefined;
  issueCapability = true;
  issueAgainstClone = false;
  reviewClone = false;
  afterRead: (() => void) | undefined;
  gate: Promise<void> | undefined;
  lastCapability: object | undefined;

  constructor(
    private readonly order: string[],
    private readonly mutate?: (value: MutableRecord) => void,
  ) {}

  async readContext(
    request: ReadCompoundIIIEthereumDurableTargetContextRequestV1,
  ): Promise<unknown> {
    this.calls.push(request);
    this.order.push('context-read');
    if (this.error !== undefined) throw this.error;
    if (this.gate !== undefined) await this.gate;
    const value = contextCapability(request);
    this.mutate?.(value);
    const capability = deepFreeze(value);
    this.lastCapability = capability;
    if (this.issueCapability) {
      this.issued.set(
        capability,
        this.issueAgainstClone
          ? ({ ...request } as ReadCompoundIIIEthereumDurableTargetContextRequestV1)
          : request,
      );
    }
    this.afterRead?.();
    return capability;
  }

  reviewContext(
    capability: unknown,
    request: ReadCompoundIIIEthereumDurableTargetContextRequestV1,
  ): unknown | null {
    this.reviews.push(request);
    this.order.push('context-review');
    if (
      typeof capability !== 'object' ||
      capability === null ||
      this.issued.get(capability) !== request
    ) {
      return null;
    }
    return this.reviewClone ? deepFreeze(cloneMutable(capability)) : capability;
  }
}

class FakeTranscriptReader implements CompoundIIIEthereumFinalizedPositionTranscriptPort {
  readonly transcriptVersion = COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION;
  readonly sourceFamilyId = SOURCE_FAMILY_ID;
  readonly sourceId = SOURCE_ID;
  readonly calls: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1[] = [];
  readonly reviews: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1[] = [];
  readonly issued = new WeakMap<
    object,
    ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1
  >();
  error: Error | undefined;
  issueCapability = true;
  issueAgainstClone = false;
  reviewClone = false;
  afterRead: (() => void) | undefined;
  gate: Promise<void> | undefined;
  rawCapability: object | undefined;
  lastCapability: object | undefined;

  constructor(
    private readonly order: string[],
    private readonly mutate?: (value: MutableRecord) => void,
    private readonly supplyAtomic = 1_234_567n,
    private readonly borrowAtomic = 0n,
  ) {}

  async readTranscript(
    request: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
  ): Promise<unknown> {
    this.calls.push(request);
    this.order.push('transcript-read');
    if (this.error !== undefined) throw this.error;
    if (this.gate !== undefined) await this.gate;
    const value = transcriptCapability(request, this.supplyAtomic, this.borrowAtomic);
    this.mutate?.(value);
    const capability = this.rawCapability ?? deepFreeze(value);
    this.lastCapability = capability;
    if (this.issueCapability) {
      this.issued.set(
        capability,
        this.issueAgainstClone
          ? ({ ...request } as ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1)
          : request,
      );
    }
    this.afterRead?.();
    return capability;
  }

  reviewTranscript(
    capability: unknown,
    request: ReadCompoundIIIEthereumFinalizedPositionTranscriptRequestV1,
  ): unknown | null {
    this.reviews.push(request);
    this.order.push('transcript-review');
    if (
      typeof capability !== 'object' ||
      capability === null ||
      this.issued.get(capability) !== request
    ) {
      return null;
    }
    return this.reviewClone ? deepFreeze(cloneMutable(capability)) : capability;
  }
}

class SequenceClock {
  private index = 0;

  constructor(private readonly values: readonly string[]) {}

  now(): Date {
    const value = this.values[Math.min(this.index, this.values.length - 1)] ?? STARTED_AT;
    this.index += 1;
    return new Date(value);
  }
}

function request(
  controller = new AbortController(),
  overrides: Partial<ReadProviderPositionAdmissionTargetRequestV1> = {},
): ReadProviderPositionAdmissionTargetRequestV1 {
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
    providerId: PROVIDER_ID,
    protocolId: PROTOCOL_ID,
    marketId: MARKET_ID,
    networkId: NETWORK_ID,
    assets: Object.freeze([
      Object.freeze({
        stablecoin: 'USDC' as const,
        networkId: NETWORK_ID,
        identity: USDC,
        decimals: 6,
      }),
    ]),
    ...overrides,
  });
}

function fixture(options: FixtureOptions = {}): Readonly<{
  source: DormantCompoundIIIEthereumProviderPositionSource;
  context: FakeContextReader;
  transcript: FakeTranscriptReader;
  request: ReadProviderPositionAdmissionTargetRequestV1;
  controller: AbortController;
  order: string[];
}> {
  const order: string[] = [];
  const controller = options.controller ?? new AbortController();
  const context = new FakeContextReader(order, options.contextMutate);
  const transcript = new FakeTranscriptReader(
    order,
    options.transcriptMutate,
    options.supplyAtomic,
    options.borrowAtomic,
  );
  const source = new DormantCompoundIIIEthereumProviderPositionSource(
    MANIFEST,
    MANIFEST_FINGERPRINT,
    context,
    transcript,
    new SequenceClock(
      options.clockValues ?? [STARTED_AT, CONTEXT_SETTLED_AT, TRANSCRIPT_SETTLED_AT, COMPLETED_AT],
    ),
  );
  return Object.freeze({
    source,
    context,
    transcript,
    request: request(controller),
    controller,
    order,
  });
}

async function expectUnavailable(
  promise: Promise<unknown>,
  code: DormantCompoundIIIEthereumProviderPositionSourceError['code'] = 'COMPOUND_III_ETHEREUM_POSITION_SOURCE_UNAVAILABLE',
): Promise<DormantCompoundIIIEthereumProviderPositionSourceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DormantCompoundIIIEthereumProviderPositionSourceError);
    const unavailable = error as DormantCompoundIIIEthereumProviderPositionSourceError;
    expect(unavailable).toMatchObject({
      name: 'DormantCompoundIIIEthereumProviderPositionSourceError',
      message: 'Compound III Ethereum provider-position source is unavailable.',
      code,
    });
    return unavailable;
  }
  throw new Error('Expected Compound III source to be unavailable');
}

function firstRecord(value: unknown, key: string): MutableRecord {
  const list = (value as MutableRecord)[key] as MutableRecord[];
  const record = list[0];
  if (record === undefined) throw new Error(`Missing ${key} fixture`);
  return record;
}

describe('dormant Compound III Ethereum provider-position source', () => {
  it('reads durable context first and emits one exact address-free USDC supply position', async () => {
    const value = fixture();
    const evidence = await value.source.readTarget(value.request);

    expect(value.order).toEqual([
      'context-read',
      'context-review',
      'transcript-read',
      'transcript-review',
      'context-review',
    ]);
    expect(evidence).toEqual({
      evidenceVersion: 1,
      use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
      mayAuthorizeFinancialAction: false,
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      sourceKind: 'RPC',
      sourceObservationId: `ethereum-block-${SELECTED_NUMBER}`,
      walletId: WALLET_ID,
      providerId: PROVIDER_ID,
      protocolId: PROTOCOL_ID,
      marketId: MARKET_ID,
      networkId: NETWORK_ID,
      assets: [{ stablecoin: 'USDC', networkId: NETWORK_ID, identity: USDC, decimals: 6 }],
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
          positionId: `${PROTOCOL_ID}-${WALLET_ID}-usdc-supply`,
          positionKind: 'SUPPLY',
          asset: { stablecoin: 'USDC', networkId: NETWORK_ID, identity: USDC, decimals: 6 },
          balance: { atomic: '1234567', decimal: '1.234567' },
        },
      ],
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(WALLET_ADDRESS);
    expect(evidence).not.toHaveProperty('manifest');
  });

  it('emits one exact borrow position and rejects simultaneous nonzero base sides', async () => {
    const borrow = fixture({ supplyAtomic: 0n, borrowAtomic: 250_000n });
    await expect(borrow.source.readTarget(borrow.request)).resolves.toMatchObject({
      positions: [
        {
          positionId: `${PROTOCOL_ID}-${WALLET_ID}-usdc-borrow`,
          positionKind: 'BORROW',
          balance: { atomic: '250000', decimal: '0.250000' },
        },
      ],
    });

    const impossible = fixture({ supplyAtomic: 1n, borrowAtomic: 1n });
    await expectUnavailable(impossible.source.readTarget(impossible.request));
  });

  it('requires two explicit COMPLETE zero results before returning an empty position set', async () => {
    const value = fixture({ supplyAtomic: 0n, borrowAtomic: 0n });
    await expect(value.source.readTarget(value.request)).resolves.toMatchObject({
      status: 'COMPLETE',
      positions: [],
    });
    expect(value.transcript.calls[0]?.accountReads.map(({ operationId }) => operationId)).toEqual([
      'usdc-supply',
      'usdc-borrow',
    ]);
  });

  it('binds exact context, manifest, calldata, EIP-1898 plan, deadline, and signal identities', async () => {
    const value = fixture();
    await value.source.readTarget(value.request);
    const contextRequest = value.context.calls[0];
    const transcriptRequest = value.transcript.calls[0];
    expect(contextRequest).toMatchObject({
      admissionRequest: value.request,
      accountId: ACCOUNT_ID,
      walletId: WALLET_ID,
      providerId: PROVIDER_ID,
      protocolId: PROTOCOL_ID,
      marketId: MARKET_ID,
      networkId: NETWORK_ID,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      deadlineAt: DEADLINE_AT,
      signal: value.request.signal,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      maySign: false,
      mayAccessWalletPrivateKey: false,
    });
    expect(transcriptRequest).toMatchObject({
      admissionRequest: value.request,
      contextRequest,
      contextCapability: value.context.lastCapability,
      walletAddress: WALLET_ADDRESS,
      continuityFloor: { kind: 'EVM_BLOCK', blockNumber: FLOOR_NUMBER, blockHash: FLOOR_HASH },
      floorBlockSelector: FLOOR_NUMBER_HEX,
      expectedChainId: '0x1',
      blockSelector: 'finalized',
      blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
      manifest: expect.objectContaining({ cometProxy: PROXY, implementation: IMPLEMENTATION }),
      manifestFingerprintSha256: MANIFEST_FINGERPRINT,
      maximumResponseBytes: 512 * 1024,
      deadlineAt: DEADLINE_AT,
      signal: value.request.signal,
    });
    expect(transcriptRequest?.accountReads).toEqual([
      {
        operationId: 'usdc-supply',
        positionKind: 'SUPPLY',
        to: PROXY,
        data: `0x70a08231${'0'.repeat(24)}${WALLET_ADDRESS.slice(2)}`,
        from: null,
      },
      {
        operationId: 'usdc-borrow',
        positionKind: 'BORROW',
        to: PROXY,
        data: `0x374c49b4${'0'.repeat(24)}${WALLET_ADDRESS.slice(2)}`,
        from: null,
      },
    ]);
    expect(transcriptRequest?.executionOrder).toEqual([
      'chain-id-before',
      'selected-block-before',
      'floor-block-before',
      'comet-proxy-code',
      'comet-implementation-code',
      'base-usdc-code',
      'proxy-implementation',
      'base-token',
      'base-scale',
      'comet-decimals',
      'base-usdc-decimals',
      'usdc-supply',
      'usdc-borrow',
      'floor-block-after',
      'selected-block-after',
      'chain-id-after',
    ]);
    expect(Object.isFrozen(contextRequest)).toBe(true);
    expect(Object.isFrozen(transcriptRequest)).toBe(true);
  });

  it.each([
    ['account', { accountId: 'not-an-account' }],
    ['provider', { providerId: 'aave' }],
    ['protocol', { protocolId: 'compound-ii' }],
    ['market', { marketId: 'other-market' }],
    ['network', { networkId: 'eip155:8453' }],
    ['source family', { sourceFamilyId: 'other-family' }],
    ['source id', { sourceId: 'other-source' }],
    ['source kind', { sourceKind: 'INDEXER' }],
    ['wallet id', { walletId: 'not-a-uuid' }],
    [
      'asset',
      {
        assets: Object.freeze([
          Object.freeze({
            stablecoin: 'USDC',
            networkId: NETWORK_ID,
            identity: PROXY,
            decimals: 6,
          }),
        ]),
      },
    ],
    ['extra field', { endpoint: 'forbidden' }],
  ])('rejects %s request drift before durable access', async (_label, overrides) => {
    const value = fixture();
    const changed = Object.freeze({ ...value.request, ...overrides });
    await expectUnavailable(
      value.source.readTarget(changed as ReadProviderPositionAdmissionTargetRequestV1),
      'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    );
    expect(value.context.calls).toHaveLength(0);
    expect(value.transcript.calls).toHaveLength(0);
  });

  it('rejects non-frozen requests and an overlong or expired deadline before durable access', async () => {
    const value = fixture();
    await expectUnavailable(
      value.source.readTarget({ ...value.request }),
      'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    );

    const overlong = fixture({ clockValues: ['2026-09-06T19:59:00.000Z'] });
    await expectUnavailable(
      overlong.source.readTarget(overlong.request),
      'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    );

    const expired = fixture({ clockValues: [DEADLINE_AT] });
    await expectUnavailable(
      expired.source.readTarget(expired.request),
      'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    );
    expect(value.context.calls).toHaveLength(0);
    expect(overlong.context.calls).toHaveLength(0);
    expect(expired.context.calls).toHaveLength(0);
  });

  it.each([
    ['account', (record: MutableRecord) => (record.accountId = OTHER_ACCOUNT_ID)],
    ['wallet', (record: MutableRecord) => (record.walletId = OTHER_WALLET_ID)],
    ['network', (record: MutableRecord) => (record.networkId = 'eip155:8453')],
    ['source', (record: MutableRecord) => (record.sourceId = 'other-source')],
    ['provider', (record: MutableRecord) => (record.providerId = 'aave')],
    ['deadline', (record: MutableRecord) => (record.deadlineAt = COMPLETED_AT)],
    ['authority', (record: MutableRecord) => (record.maySign = true)],
    ['context source', (record: MutableRecord) => (record.contextSourceId = 'other-context')],
    ['wallet address', (record: MutableRecord) => (record.walletAddress = PROXY.toUpperCase())],
  ])('rejects durable context %s laundering before transcript access', async (_label, mutate) => {
    const value = fixture({ contextMutate: mutate });
    await expectUnavailable(value.source.readTarget(value.request));
    expect(value.transcript.calls).toHaveLength(0);
  });

  it('authenticates context capabilities against exact object and request identity', async () => {
    const unissued = fixture();
    unissued.context.issueCapability = false;
    await expectUnavailable(unissued.source.readTarget(unissued.request));

    const clone = fixture();
    clone.context.reviewClone = true;
    await expectUnavailable(clone.source.readTarget(clone.request));

    const equalRequest = fixture();
    equalRequest.context.issueAgainstClone = true;
    await expectUnavailable(equalRequest.source.readTarget(equalRequest.request));
  });

  it('authenticates transcript capabilities and re-authenticates durable context afterward', async () => {
    const unissued = fixture();
    unissued.transcript.issueCapability = false;
    await expectUnavailable(unissued.source.readTarget(unissued.request));

    const clone = fixture();
    clone.transcript.reviewClone = true;
    await expectUnavailable(clone.source.readTarget(clone.request));

    const equalRequest = fixture();
    equalRequest.transcript.issueAgainstClone = true;
    await expectUnavailable(equalRequest.source.readTarget(equalRequest.request));

    const revoked = fixture();
    const originalReview = revoked.context.reviewContext.bind(revoked.context);
    let reviews = 0;
    revoked.context.reviewContext = (capability, issuedRequest): unknown | null => {
      reviews += 1;
      return reviews === 1 ? originalReview(capability, issuedRequest) : null;
    };
    const source = new DormantCompoundIIIEthereumProviderPositionSource(
      MANIFEST,
      MANIFEST_FINGERPRINT,
      revoked.context,
      revoked.transcript,
      new SequenceClock([STARTED_AT, CONTEXT_SETTLED_AT, TRANSCRIPT_SETTLED_AT, COMPLETED_AT]),
    );
    await expectUnavailable(source.readTarget(revoked.request));
  });

  it('does not accept a floor or caller-authored observation time from the transcript', async () => {
    for (const extra of [
      {
        continuityFloor: {
          kind: 'EVM_BLOCK',
          blockNumber: SELECTED_NUMBER,
          blockHash: SELECTED_HASH,
        },
      },
      { observedAt: '2020-01-01T00:00:00.000Z' },
      { staleAfter: '2099-01-01T00:00:00.000Z' },
    ]) {
      const value = fixture({ transcriptMutate: (transcript) => Object.assign(transcript, extra) });
      await expectUnavailable(value.source.readTarget(value.request));
    }
  });

  it.each([
    [
      'floor before hash',
      (record: MutableRecord) =>
        (((record.floorBlockBefore as MutableRecord).result as MutableRecord).hash = SELECTED_HASH),
    ],
    [
      'floor after hash',
      (record: MutableRecord) =>
        (((record.floorBlockAfter as MutableRecord).result as MutableRecord).hash = SELECTED_HASH),
    ],
    [
      'floor after state root',
      (record: MutableRecord) =>
        (((record.floorBlockAfter as MutableRecord).result as MutableRecord).stateRoot =
          SELECTED_STATE_ROOT),
    ],
    [
      'selected after hash',
      (record: MutableRecord) =>
        (((record.selectedBlockAfter as MutableRecord).result as MutableRecord).hash = FLOOR_HASH),
    ],
    [
      'selected after state root',
      (record: MutableRecord) =>
        (((record.selectedBlockAfter as MutableRecord).result as MutableRecord).stateRoot =
          FLOOR_STATE_ROOT),
    ],
    [
      'selected after timestamp',
      (record: MutableRecord) =>
        (((record.selectedBlockAfter as MutableRecord).result as MutableRecord).timestamp = '0x1'),
    ],
  ])('rejects %s reorg or replacement evidence', async (_label, mutate) => {
    const value = fixture({ transcriptMutate: mutate });
    await expectUnavailable(value.source.readTarget(value.request));
  });

  it('rejects selected regression and an equal-height durable hash conflict', async () => {
    const regression = fixture({
      transcriptMutate: (record) => {
        record.selectedBlockBefore = blockRead('finalized', {
          ...floorHeader(),
          number: '0x63',
          hash: SELECTED_HASH,
        });
        record.selectedBlockAfter = blockRead('0x63', {
          ...floorHeader(),
          number: '0x63',
          hash: SELECTED_HASH,
        });
      },
    });
    await expectUnavailable(regression.source.readTarget(regression.request));

    const conflict = fixture({
      transcriptMutate: (record) => {
        const sameHeight = { ...floorHeader(), hash: SELECTED_HASH };
        record.selectedBlockBefore = blockRead('finalized', { ...sameHeight });
        record.selectedBlockAfter = blockRead(FLOOR_NUMBER_HEX, { ...sameHeight });
      },
    });
    await expectUnavailable(conflict.source.readTarget(conflict.request));
  });

  it.each([
    ['chain before', (record: MutableRecord) => (record.chainIdBefore = '0x5')],
    ['chain after', (record: MutableRecord) => (record.chainIdAfter = '0x5')],
    [
      'manifest fingerprint',
      (record: MutableRecord) => (record.manifestFingerprintSha256 = 'a'.repeat(64)),
    ],
    ['status', (record: MutableRecord) => (record.status = 'PARTIAL')],
    [
      'zero semantics',
      (record: MutableRecord) => (record.zeroPositionSemantics = 'MISSING_MEANS_ZERO'),
    ],
    ['authority', (record: MutableRecord) => (record.mayAuthorizeFinancialAction = true)],
  ])('rejects transcript %s drift', async (_label, mutate) => {
    const value = fixture({ transcriptMutate: mutate });
    await expectUnavailable(value.source.readTarget(value.request));
  });

  it.each([
    [
      'runtime code',
      (record: MutableRecord) => {
        firstRecord(record, 'codeReads').result = '0x6004';
      },
    ],
    [
      'code address',
      (record: MutableRecord) => {
        firstRecord(record, 'codeReads').address = USDC;
      },
    ],
    [
      'code method',
      (record: MutableRecord) => {
        firstRecord(record, 'codeReads').method = 'eth_call';
      },
    ],
    [
      'canonical hash binding',
      (record: MutableRecord) => {
        firstRecord(record, 'codeReads').blockParameter = {
          blockHash: SELECTED_HASH,
          requireCanonical: false,
        };
      },
    ],
  ])('rejects code proof %s drift', async (_label, mutate) => {
    const value = fixture({ transcriptMutate: mutate });
    await expectUnavailable(value.source.readTarget(value.request));
  });

  it.each([
    ['implementation result', 'proxy-implementation', abiAddress(ADMIN)],
    ['base-token result', 'base-token', abiAddress(PROXY)],
    ['base-scale result', 'base-scale', abiUint(1n)],
    ['comet decimals result', 'comet-decimals', abiUint(18n)],
    ['USDC decimals result', 'base-usdc-decimals', abiUint(18n)],
  ])('rejects %s drift', async (_label, operationId, result) => {
    const value = fixture({
      transcriptMutate: (record) => {
        const calls = record.identityReads as MutableRecord[];
        const call = calls.find((candidate) => candidate.operationId === operationId);
        if (call === undefined) throw new Error('missing identity call');
        call.result = result;
      },
    });
    await expectUnavailable(value.source.readTarget(value.request));
  });

  it('rejects missing, reordered, duplicate, and malformed account results', async () => {
    const cases: Array<(record: MutableRecord) => void> = [
      (record) => {
        (record.accountReads as MutableRecord[]).pop();
      },
      (record) => {
        (record.accountReads as MutableRecord[]).reverse();
      },
      (record) => {
        const reads = record.accountReads as MutableRecord[];
        reads[1] = { ...reads[0] };
      },
      (record) => {
        firstRecord(record, 'accountReads').result = '0x01';
      },
      (record) => {
        firstRecord(record, 'accountReads').data = '0x70a08231';
      },
      (record) => {
        firstRecord(record, 'accountReads').blockParameter = {
          blockHash: FLOOR_HASH,
          requireCanonical: true,
        };
      },
    ];
    for (const mutate of cases) {
      const value = fixture({ transcriptMutate: mutate });
      await expectUnavailable(value.source.readTarget(value.request));
    }
  });

  it('rejects reordered and malformed identity reads', async () => {
    for (const mutate of [
      (record: MutableRecord) => (record.identityReads as MutableRecord[]).reverse(),
      (record: MutableRecord) => {
        firstRecord(record, 'identityReads').from = null;
      },
      (record: MutableRecord) => {
        firstRecord(record, 'identityReads').result = '0x01';
      },
    ]) {
      const value = fixture({ transcriptMutate: mutate });
      await expectUnavailable(value.source.readTarget(value.request));
    }
  });

  it('rejects a future, stale-boundary, and malformed selected block timestamp', async () => {
    const completionSeconds = Math.floor(Date.parse(COMPLETED_AT) / 1_000);
    for (const timestamp of [
      `0x${(completionSeconds + 1).toString(16)}`,
      `0x${(completionSeconds - 900).toString(16)}`,
      '0x00',
    ]) {
      const value = fixture({
        transcriptMutate: (record) => {
          ((record.selectedBlockBefore as MutableRecord).result as MutableRecord).timestamp =
            timestamp;
          ((record.selectedBlockAfter as MutableRecord).result as MutableRecord).timestamp =
            timestamp;
        },
      });
      await expectUnavailable(value.source.readTarget(value.request));
    }
  });

  it('fails closed on abort before, during context, and during transcript', async () => {
    const before = fixture();
    before.controller.abort();
    await expectUnavailable(
      before.source.readTarget(before.request),
      'COMPOUND_III_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    );
    expect(before.context.calls).toHaveLength(0);

    const duringContext = fixture();
    duringContext.context.afterRead = () => duringContext.controller.abort();
    await expectUnavailable(duringContext.source.readTarget(duringContext.request));
    expect(duringContext.transcript.calls).toHaveLength(0);

    const duringTranscript = fixture();
    duringTranscript.transcript.afterRead = () => duringTranscript.controller.abort();
    await expectUnavailable(duringTranscript.source.readTarget(duringTranscript.request));
  });

  it('drains started transcript work before rejecting an aborted request', async () => {
    const value = fixture();
    let release: (() => void) | undefined;
    value.transcript.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = value.source.readTarget(value.request);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(value.transcript.calls).toHaveLength(1);
    value.controller.abort();
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release?.();
    await expectUnavailable(pending);
  });

  it('rejects deadline expiry and clock regression after awaited work', async () => {
    const expiredAfterContext = fixture({
      clockValues: [STARTED_AT, DEADLINE_AT],
    });
    await expectUnavailable(expiredAfterContext.source.readTarget(expiredAfterContext.request));
    expect(expiredAfterContext.transcript.calls).toHaveLength(0);

    const regressed = fixture({
      clockValues: [STARTED_AT, '2026-09-06T19:59:59.999Z'],
    });
    await expectUnavailable(regressed.source.readTarget(regressed.request));
  });

  it('rejects accessor, cyclic, unfrozen, and oversized transcript capabilities', async () => {
    const accessor = fixture();
    let invoked = false;
    accessor.transcript.rawCapability = Object.freeze(
      Object.defineProperty({}, 'transcriptVersion', {
        enumerable: true,
        get: () => {
          invoked = true;
          return 1;
        },
      }),
    );
    await expectUnavailable(accessor.source.readTarget(accessor.request));
    expect(invoked).toBe(false);

    const cyclic = fixture();
    const cycle: MutableRecord = {};
    cycle.self = cycle;
    cyclic.transcript.rawCapability = Object.freeze(cycle);
    await expectUnavailable(cyclic.source.readTarget(cyclic.request));

    const unfrozen = fixture();
    unfrozen.transcript.rawCapability = {};
    await expectUnavailable(unfrozen.source.readTarget(unfrozen.request));

    const oversized = fixture({
      transcriptMutate: (record) => Object.assign(record, { extra: 'x'.repeat(512 * 1024) }),
    });
    await expectUnavailable(oversized.source.readTarget(oversized.request));
  });

  it('rejects an unreviewed manifest fingerprint and invalid caller manifest during construction', () => {
    const value = fixture();
    expect(
      () =>
        new DormantCompoundIIIEthereumProviderPositionSource(
          MANIFEST,
          'a'.repeat(64),
          value.context,
          value.transcript,
          new SequenceClock([STARTED_AT]),
        ),
    ).toThrow(DormantCompoundIIIEthereumProviderPositionSourceError);
    expect(
      () =>
        new DormantCompoundIIIEthereumProviderPositionSource(
          { ...MANIFEST, cometProxy: ADMIN },
          MANIFEST_FINGERPRINT,
          value.context,
          value.transcript,
          new SequenceClock([STARTED_AT]),
        ),
    ).toThrow(DormantCompoundIIIEthereumProviderPositionSourceError);
  });

  it('rejects same-receiver, same-family, and accessor dependency laundering', () => {
    const value = fixture();
    const shared = {
      contextVersion: COMPOUND_III_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
      transcriptVersion: COMPOUND_III_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
      sourceFamilyId: 'shared-family',
      sourceId: 'shared-source',
      readContext: async () => undefined,
      reviewContext: () => null,
      readTranscript: async () => undefined,
      reviewTranscript: () => null,
    };
    expect(
      () =>
        new DormantCompoundIIIEthereumProviderPositionSource(
          MANIFEST,
          MANIFEST_FINGERPRINT,
          shared,
          shared,
          new SequenceClock([STARTED_AT]),
        ),
    ).toThrow(DormantCompoundIIIEthereumProviderPositionSourceError);

    const sameFamilyTranscript = {
      ...value.transcript,
      sourceFamilyId: CONTEXT_SOURCE_FAMILY_ID,
      readTranscript: value.transcript.readTranscript.bind(value.transcript),
      reviewTranscript: value.transcript.reviewTranscript.bind(value.transcript),
    };
    expect(
      () =>
        new DormantCompoundIIIEthereumProviderPositionSource(
          MANIFEST,
          MANIFEST_FINGERPRINT,
          value.context,
          sameFamilyTranscript,
          new SequenceClock([STARTED_AT]),
        ),
    ).toThrow(DormantCompoundIIIEthereumProviderPositionSourceError);

    let invoked = false;
    const accessorContext = Object.defineProperty({}, 'contextVersion', {
      get: () => {
        invoked = true;
        return 1;
      },
    });
    expect(
      () =>
        new DormantCompoundIIIEthereumProviderPositionSource(
          MANIFEST,
          MANIFEST_FINGERPRINT,
          accessorContext as CompoundIIIEthereumDurableTargetContextReaderPort,
          value.transcript,
          new SequenceClock([STARTED_AT]),
        ),
    ).toThrow(DormantCompoundIIIEthereumProviderPositionSourceError);
    expect(invoked).toBe(false);
  });

  it('maps private dependency failures to one address- and path-free error', async () => {
    const contextFailure = fixture();
    contextFailure.context.error = new Error(`secret context for ${WALLET_ADDRESS}`);
    const first = await expectUnavailable(contextFailure.source.readTarget(contextFailure.request));
    expect(String(first)).not.toContain(WALLET_ADDRESS);

    const transcriptFailure = fixture();
    transcriptFailure.transcript.error = new Error('secret endpoint credential');
    const second = await expectUnavailable(
      transcriptFailure.source.readTarget(transcriptFailure.request),
    );
    expect(String(second)).not.toContain('endpoint');
  });

  it('contains no endpoint, environment, client, Nest registration, signer, or write path', () => {
    const source = readFileSync(__filename.replace(/\.spec\.ts$/u, '.ts'), 'utf8');
    expect(source).not.toMatch(
      /process\.env|fetch\s*\(|axios|@nestjs|https?:\/\/|JsonRpcProvider|sendTransaction|signTransaction|\.query\s*\(/u,
    );
    expect(source).toContain('intentionally not registered or exported through a runtime module');
    expect(source).toContain(
      'no endpoint, credential, database handle, timer, signer, persistence path',
    );
  });
});
