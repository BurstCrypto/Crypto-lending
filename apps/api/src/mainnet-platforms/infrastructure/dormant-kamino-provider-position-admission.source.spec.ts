import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  KAMINO_LEND_SOLANA_MAINNET_IDENTITIES,
  KAMINO_LEND_SOLANA_SOURCE_PINS,
} from '../../smart-lending/infrastructure/kamino/kamino-lend-solana-finalized-transcript.adapter';
import {
  PROVIDER_POSITION_ADMISSION_VERSION,
  type ReadProviderPositionAdmissionTargetRequestV1,
} from '../application/provider-position-admission.coordinator';
import {
  DORMANT_KAMINO_POSITION_TARGET_CONTEXT_USE,
  DORMANT_KAMINO_POSITION_TARGET_CONTEXT_VERSION,
  DORMANT_KAMINO_POSITION_TRANSCRIPT_USE,
  DORMANT_KAMINO_POSITION_TRANSCRIPT_VERSION,
  DormantKaminoProviderPositionAdmissionSource,
  DormantKaminoProviderPositionAdmissionSourceUnavailableError,
  type DormantKaminoFinalizedAccountTranscriptTransport,
  type DormantKaminoPositionTargetContextReader,
  type ReadDormantKaminoFinalizedAccountTranscriptRequestV1,
  type ReadDormantKaminoPositionTargetContextRequestV1,
} from './dormant-kamino-provider-position-admission.source';

const ID = KAMINO_LEND_SOLANA_MAINNET_IDENTITIES;
const ACCOUNT_ID = parseAccountId('99999999-9999-4999-8999-999999999999');
const WALLET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NETWORK_ID = ID.networkId;
const PROVIDER_ID = 'kamino';
const PROTOCOL_ID = 'kamino-lend';
const MARKET_ID = 'kamino-lend-solana-mainnet-main-usdc';
const SOURCE_FAMILY_ID = 'kamino-solana-rpc';
const SOURCE_ID = 'kamino-solana-rpc-primary';
const CANONICAL_WALLET_ADDRESS = ID.legacyTokenProgramAddress;
const OBLIGATION_ACCOUNT = ID.upgradeableLoaderAddress;
const OTHER_OBLIGATION_ACCOUNT = ID.usdcMintAddress;
const FLOOR_SLOT = '1000';
const ROOT_SLOT = '1002';
const FLOOR_BLOCKHASH = ID.programAddress;
const MIDDLE_BLOCKHASH = ID.usdcReserveAddress;
const ROOT_BLOCKHASH = ID.lendingMarketAddress;
const PRIOR_BLOCKHASH = ID.usdcMintAddress;
const NOW = '2026-09-06T18:00:00.000Z';
const AFTER_CONTEXT = '2026-09-06T18:00:01.000Z';
const OBSERVED_AT = '2026-09-06T18:00:02.000Z';
const DEADLINE_AT = '2026-09-06T18:00:20.000Z';

type MutableRecord = Record<string, unknown>;

interface FixtureOptions {
  readonly contextMutate?: (value: MutableRecord) => void;
  readonly transcriptMutate?: (value: MutableRecord) => void;
  readonly clockValues?: readonly string[];
  readonly controller?: AbortController;
}

function frozenCapability(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => frozenCapability(entry)));
  if (typeof value === 'object' && value !== null) {
    const result = Object.create(null) as MutableRecord;
    for (const [key, member] of Object.entries(value)) result[key] = frozenCapability(member);
    return Object.freeze(result);
  }
  return value;
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

function accountData(value: readonly number[] = [1, 2, 3, 4]): Readonly<{
  base64: string;
  sha256: string;
}> {
  const bytes = Buffer.from(value);
  return Object.freeze({
    base64: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

function obligationAccount(
  accountAddress: string = OBLIGATION_ACCOUNT,
  positions: readonly MutableRecord[] = [
    {
      positionKind: 'SUPPLY',
      reserveAddress: ID.usdcReserveAddress,
      assetMintAddress: ID.usdcMintAddress,
      amountAtomic: '1500000',
    },
    {
      positionKind: 'BORROW',
      reserveAddress: ID.usdcReserveAddress,
      assetMintAddress: ID.usdcMintAddress,
      amountAtomic: '250000',
    },
  ],
): MutableRecord {
  const data = accountData();
  return {
    accountAddress,
    ownerProgramAddress: ID.programAddress,
    executable: false,
    lamports: '2039280',
    rentEpoch: '0',
    space: '4',
    accountDataBase64: data.base64,
    accountDataSha256: data.sha256,
    decodeStatus: 'COMPLETE',
    decodedOwnerAddress: CANONICAL_WALLET_ADDRESS,
    lendingMarketAddress: ID.lendingMarketAddress,
    positions: positions.map((position) => ({ ...position })),
  };
}

function contextValue(request: ReadDormantKaminoPositionTargetContextRequestV1): MutableRecord {
  return {
    contextVersion: DORMANT_KAMINO_POSITION_TARGET_CONTEXT_VERSION,
    use: DORMANT_KAMINO_POSITION_TARGET_CONTEXT_USE,
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
    canonicalWalletAddress: CANONICAL_WALLET_ADDRESS,
    continuityFloor: { kind: 'SOLANA_SLOT', slot: FLOOR_SLOT, root: FLOOR_SLOT },
    continuityFloorBlockhash: FLOOR_BLOCKHASH,
  };
}

function transcriptValue(
  request: ReadDormantKaminoFinalizedAccountTranscriptRequestV1,
): MutableRecord {
  return {
    transcriptVersion: DORMANT_KAMINO_POSITION_TRANSCRIPT_VERSION,
    use: DORMANT_KAMINO_POSITION_TRANSCRIPT_USE,
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
    canonicalWalletAddress: request.canonicalWalletAddress,
    commitment: 'finalized',
    genesisHash: ID.genesisHash,
    programAddress: ID.programAddress,
    lendingMarketAddress: ID.lendingMarketAddress,
    reserveAddress: ID.usdcReserveAddress,
    assetMintAddress: ID.usdcMintAddress,
    decoderCommitSha: KAMINO_LEND_SOLANA_SOURCE_PINS.klendSdkCommitSha,
    finalizedRootSlot: ROOT_SLOT,
    finalizedRootBlockhash: ROOT_BLOCKHASH,
    lineage: [
      {
        slot: FLOOR_SLOT,
        blockhash: FLOOR_BLOCKHASH,
        parentSlot: '999',
        previousBlockhash: PRIOR_BLOCKHASH,
      },
      {
        slot: '1001',
        blockhash: MIDDLE_BLOCKHASH,
        parentSlot: FLOOR_SLOT,
        previousBlockhash: FLOOR_BLOCKHASH,
      },
      {
        slot: ROOT_SLOT,
        blockhash: ROOT_BLOCKHASH,
        parentSlot: '1001',
        previousBlockhash: MIDDLE_BLOCKHASH,
      },
    ],
    coverage: {
      status: 'COMPLETE',
      contextSlot: ROOT_SLOT,
      nextPageToken: null,
      matchedAccountCount: '1',
      accounts: [obligationAccount()],
    },
  };
}

class FakeContextReader implements DormantKaminoPositionTargetContextReader {
  readonly calls: ReadDormantKaminoPositionTargetContextRequestV1[] = [];
  readonly reviewCalls: ReadDormantKaminoPositionTargetContextRequestV1[] = [];
  readonly issued = new WeakMap<object, ReadDormantKaminoPositionTargetContextRequestV1>();
  lastCapability: object | undefined;
  error: Error | undefined;
  reviewMode: 'ISSUED' | 'NULL' | 'CLONE' = 'ISSUED';
  issueAgainstClone = false;
  issueCapability = true;
  afterRead: (() => void) | undefined;

  constructor(
    private readonly order: string[],
    private readonly mutate?: (value: MutableRecord) => void,
  ) {}

  async readContext(request: ReadDormantKaminoPositionTargetContextRequestV1): Promise<unknown> {
    this.calls.push(request);
    this.order.push('context');
    if (this.error !== undefined) throw this.error;
    const value = contextValue(request);
    this.mutate?.(value);
    const capability = frozenCapability(value) as object;
    this.lastCapability = capability;
    if (this.issueCapability) {
      this.issued.set(
        capability,
        this.issueAgainstClone
          ? ({ ...request } as ReadDormantKaminoPositionTargetContextRequestV1)
          : request,
      );
    }
    this.afterRead?.();
    return capability;
  }

  reviewContext(
    capability: unknown,
    request: ReadDormantKaminoPositionTargetContextRequestV1,
  ): unknown | null {
    this.reviewCalls.push(request);
    if (
      typeof capability !== 'object' ||
      capability === null ||
      this.issued.get(capability) !== request ||
      this.reviewMode === 'NULL'
    ) {
      return null;
    }
    return this.reviewMode === 'CLONE' ? frozenCapability(cloneMutable(capability)) : capability;
  }
}

class FakeTranscriptTransport implements DormantKaminoFinalizedAccountTranscriptTransport {
  readonly calls: ReadDormantKaminoFinalizedAccountTranscriptRequestV1[] = [];
  readonly reviewCalls: ReadDormantKaminoFinalizedAccountTranscriptRequestV1[] = [];
  readonly issued = new WeakMap<object, ReadDormantKaminoFinalizedAccountTranscriptRequestV1>();
  lastCapability: object | undefined;
  error: Error | undefined;
  reviewMode: 'ISSUED' | 'NULL' | 'CLONE' = 'ISSUED';
  issueAgainstClone = false;
  issueCapability = true;
  rawCapability: object | undefined;
  afterRead: (() => void) | undefined;

  constructor(
    private readonly order: string[],
    private readonly mutate?: (value: MutableRecord) => void,
  ) {}

  async readTranscript(
    request: ReadDormantKaminoFinalizedAccountTranscriptRequestV1,
  ): Promise<unknown> {
    this.calls.push(request);
    this.order.push('transcript');
    if (this.error !== undefined) throw this.error;
    const mutable = transcriptValue(request);
    this.mutate?.(mutable);
    const capability = this.rawCapability ?? (frozenCapability(mutable) as object);
    this.lastCapability = capability;
    if (this.issueCapability) {
      this.issued.set(
        capability,
        this.issueAgainstClone
          ? ({ ...request } as ReadDormantKaminoFinalizedAccountTranscriptRequestV1)
          : request,
      );
    }
    this.afterRead?.();
    return capability;
  }

  reviewTranscript(
    capability: unknown,
    request: ReadDormantKaminoFinalizedAccountTranscriptRequestV1,
  ): unknown | null {
    this.reviewCalls.push(request);
    if (
      typeof capability !== 'object' ||
      capability === null ||
      this.issued.get(capability) !== request ||
      this.reviewMode === 'NULL'
    ) {
      return null;
    }
    return this.reviewMode === 'CLONE' ? frozenCapability(cloneMutable(capability)) : capability;
  }
}

class SequenceClock {
  private index = 0;

  constructor(private readonly values: readonly string[]) {}

  now(): Date {
    const value = this.values[Math.min(this.index, this.values.length - 1)] ?? NOW;
    this.index += 1;
    return new Date(value);
  }
}

function admissionRequest(
  controller = new AbortController(),
): ReadProviderPositionAdmissionTargetRequestV1 {
  return Object.freeze({
    admissionVersion: PROVIDER_POSITION_ADMISSION_VERSION,
    accountId: ACCOUNT_ID,
    correlationId: 'kamino-position-read-20260906',
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
        identity: ID.usdcMintAddress,
        decimals: 6,
      }),
    ]),
  });
}

function fixture(options: FixtureOptions = {}): Readonly<{
  source: DormantKaminoProviderPositionAdmissionSource;
  context: FakeContextReader;
  transport: FakeTranscriptTransport;
  request: ReadProviderPositionAdmissionTargetRequestV1;
  order: string[];
  controller: AbortController;
}> {
  const order: string[] = [];
  const controller = options.controller ?? new AbortController();
  const context = new FakeContextReader(order, options.contextMutate);
  const transport = new FakeTranscriptTransport(order, options.transcriptMutate);
  const source = new DormantKaminoProviderPositionAdmissionSource(
    {
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      sourceKind: 'RPC',
    },
    context,
    transport,
    new SequenceClock(options.clockValues ?? [NOW, AFTER_CONTEXT, OBSERVED_AT]),
  );
  return Object.freeze({
    source,
    context,
    transport,
    request: admissionRequest(controller),
    order,
    controller,
  });
}

async function expectUnavailable(
  promise: Promise<unknown>,
  code?: DormantKaminoProviderPositionAdmissionSourceUnavailableError['code'],
): Promise<DormantKaminoProviderPositionAdmissionSourceUnavailableError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DormantKaminoProviderPositionAdmissionSourceUnavailableError);
    const unavailable = error as DormantKaminoProviderPositionAdmissionSourceUnavailableError;
    if (code !== undefined) expect(unavailable.code).toBe(code);
    return unavailable;
  }
  throw new Error('Expected Kamino source to be unavailable');
}

describe('dormant Kamino provider-position admission source', () => {
  it('reads durable context first and returns an address-free COMPLETE finalized observation', async () => {
    const value = fixture({
      transcriptMutate: (transcript) => {
        const coverage = transcript.coverage as MutableRecord;
        coverage.matchedAccountCount = '2';
        coverage.accounts = [
          obligationAccount(OBLIGATION_ACCOUNT),
          obligationAccount(OTHER_OBLIGATION_ACCOUNT, [
            {
              positionKind: 'SUPPLY',
              reserveAddress: ID.usdcReserveAddress,
              assetMintAddress: ID.usdcMintAddress,
              amountAtomic: '500000',
            },
          ]),
        ];
      },
    });

    const evidence = await value.source.readTarget(value.request);

    expect(value.order).toEqual(['context', 'transcript']);
    expect(evidence).toEqual({
      evidenceVersion: 1,
      use: 'DORMANT_PROVIDER_POSITION_TARGET_EVIDENCE_ONLY',
      mayAuthorizeFinancialAction: false,
      accountId: ACCOUNT_ID,
      correlationId: value.request.correlationId,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      sourceKind: 'RPC',
      sourceObservationId: `solana-slot-${ROOT_SLOT}`,
      walletId: WALLET_ID,
      providerId: PROVIDER_ID,
      protocolId: PROTOCOL_ID,
      marketId: MARKET_ID,
      networkId: NETWORK_ID,
      assets: [
        {
          stablecoin: 'USDC',
          networkId: NETWORK_ID,
          identity: ID.usdcMintAddress,
          decimals: 6,
        },
      ],
      status: 'COMPLETE',
      observedAt: OBSERVED_AT,
      staleAfter: '2026-09-06T18:00:17.000Z',
      continuityFloor: { kind: 'SOLANA_SLOT', slot: FLOOR_SLOT, root: FLOOR_SLOT },
      chainAnchor: { kind: 'SOLANA_SLOT', slot: ROOT_SLOT, root: ROOT_SLOT },
      positions: [
        {
          positionId: 'kamino-usdc-supply',
          positionKind: 'SUPPLY',
          asset: {
            stablecoin: 'USDC',
            networkId: NETWORK_ID,
            identity: ID.usdcMintAddress,
            decimals: 6,
          },
          balance: { atomic: '2000000', decimal: '2.000000' },
        },
        {
          positionId: 'kamino-usdc-borrow',
          positionKind: 'BORROW',
          asset: {
            stablecoin: 'USDC',
            networkId: NETWORK_ID,
            identity: ID.usdcMintAddress,
            decimals: 6,
          },
          balance: { atomic: '250000', decimal: '0.250000' },
        },
      ],
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(CANONICAL_WALLET_ADDRESS);
    expect(JSON.stringify(evidence)).not.toContain(OBLIGATION_ACCOUNT);
  });

  it('binds both issued capabilities to the exact admission, context, signal, and floor identities', async () => {
    const value = fixture();
    await value.source.readTarget(value.request);
    const contextRequest = value.context.calls[0];
    const transcriptRequest = value.transport.calls[0];
    expect(contextRequest).toBeDefined();
    expect(transcriptRequest).toBeDefined();
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
      sourceKind: 'RPC',
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
      canonicalWalletAddress: CANONICAL_WALLET_ADDRESS,
      continuityFloor: { kind: 'SOLANA_SLOT', slot: FLOOR_SLOT, root: FLOOR_SLOT },
      continuityFloorBlockhash: FLOOR_BLOCKHASH,
      commitment: 'finalized',
      signal: value.request.signal,
      deadlineAt: DEADLINE_AT,
    });
    expect(Object.isFrozen(contextRequest)).toBe(true);
    expect(Object.isFrozen(transcriptRequest)).toBe(true);
    expect(value.context.reviewCalls).toEqual([contextRequest, contextRequest]);
    expect(value.transport.reviewCalls).toEqual([transcriptRequest]);
  });

  it('represents a verified COMPLETE zero as an empty position set', async () => {
    const value = fixture({
      transcriptMutate: (transcript) => {
        const coverage = transcript.coverage as MutableRecord;
        coverage.matchedAccountCount = '0';
        coverage.accounts = [];
      },
    });
    await expect(value.source.readTarget(value.request)).resolves.toMatchObject({
      status: 'COMPLETE',
      positions: [],
    });
  });

  it.each([
    ['account', { accountId: 'not-an-account' }],
    ['provider', { providerId: 'marginfi' }],
    ['protocol', { protocolId: 'other' }],
    ['market', { marketId: 'other' }],
    ['network', { networkId: 'eip155:1' }],
    ['source family', { sourceFamilyId: 'other-family' }],
    ['source id', { sourceId: 'other-source' }],
    ['source kind', { sourceKind: 'INDEXER' }],
    ['wallet id', { walletId: 'not-a-uuid' }],
    [
      'asset mint',
      {
        assets: Object.freeze([
          Object.freeze({ ...admissionRequest().assets[0], identity: ID.usdcReserveAddress }),
        ]),
      },
    ],
    ['extra field', { endpoint: 'forbidden' }],
  ])('rejects %s request drift before durable-state access', async (_label, override) => {
    const value = fixture();
    const request = Object.freeze({ ...value.request, ...override });
    await expectUnavailable(
      value.source.readTarget(request as ReadProviderPositionAdmissionTargetRequestV1),
      'INVALID_REQUEST',
    );
    expect(value.context.calls).toHaveLength(0);
    expect(value.transport.calls).toHaveLength(0);
  });

  it.each([
    [
      'account',
      (record: MutableRecord) =>
        (record.accountId = parseAccountId('88888888-8888-4888-8888-888888888888')),
    ],
    [
      'wallet',
      (record: MutableRecord) => (record.walletId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ],
    [
      'network',
      (record: MutableRecord) => (record.networkId = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
    ],
    ['source', (record: MutableRecord) => (record.sourceId = 'other-source')],
    ['provider', (record: MutableRecord) => (record.providerId = 'other')],
    ['deadline', (record: MutableRecord) => (record.deadlineAt = '2026-09-06T18:00:19.000Z')],
    ['authority', (record: MutableRecord) => (record.maySign = true)],
    ['wallet address', (record: MutableRecord) => (record.canonicalWalletAddress = 'not-base58')],
    ['floor hash', (record: MutableRecord) => (record.continuityFloorBlockhash = 'not-base58')],
  ])('rejects durable context %s laundering before transcript access', async (_label, mutate) => {
    const value = fixture({ contextMutate: mutate });
    await expectUnavailable(value.source.readTarget(value.request), 'CONTEXT_UNAVAILABLE');
    expect(value.transport.calls).toHaveLength(0);
  });

  it('rejects unissued, cloned-review, and equal-request context capabilities', async () => {
    const unissued = fixture();
    unissued.context.issueCapability = false;
    await expectUnavailable(unissued.source.readTarget(unissued.request), 'CONTEXT_UNAVAILABLE');

    const clonedReview = fixture();
    clonedReview.context.reviewMode = 'CLONE';
    await expectUnavailable(
      clonedReview.source.readTarget(clonedReview.request),
      'CONTEXT_UNAVAILABLE',
    );

    const equalRequest = fixture();
    equalRequest.context.issueAgainstClone = true;
    await expectUnavailable(
      equalRequest.source.readTarget(equalRequest.request),
      'CONTEXT_UNAVAILABLE',
    );
  });

  it('rejects unissued, cloned-review, and equal-request transcript capabilities', async () => {
    const unissued = fixture();
    unissued.transport.issueCapability = false;
    await expectUnavailable(unissued.source.readTarget(unissued.request), 'TRANSCRIPT_UNAVAILABLE');

    const clonedReview = fixture();
    clonedReview.transport.reviewMode = 'CLONE';
    await expectUnavailable(
      clonedReview.source.readTarget(clonedReview.request),
      'TRANSCRIPT_UNAVAILABLE',
    );

    const equalRequest = fixture();
    equalRequest.transport.issueAgainstClone = true;
    await expectUnavailable(
      equalRequest.source.readTarget(equalRequest.request),
      'TRANSCRIPT_UNAVAILABLE',
    );
  });

  it('does not accept a continuity floor or a caller timestamp from the transcript', async () => {
    for (const extra of [
      { continuityFloor: { kind: 'SOLANA_SLOT', slot: ROOT_SLOT, root: ROOT_SLOT } },
      { observedAt: '2020-01-01T00:00:00.000Z' },
    ]) {
      const value = fixture({ transcriptMutate: (transcript) => Object.assign(transcript, extra) });
      await expectUnavailable(value.source.readTarget(value.request), 'TRANSCRIPT_UNAVAILABLE');
    }
  });

  it.each([
    [
      'first slot',
      (record: MutableRecord) =>
        (((record.lineage as MutableRecord[])[0] as MutableRecord).slot = '999'),
    ],
    [
      'first blockhash',
      (record: MutableRecord) =>
        (((record.lineage as MutableRecord[])[0] as MutableRecord).blockhash = ROOT_BLOCKHASH),
    ],
    [
      'parent slot',
      (record: MutableRecord) =>
        (((record.lineage as MutableRecord[])[1] as MutableRecord).parentSlot = '999'),
    ],
    [
      'previous blockhash',
      (record: MutableRecord) =>
        (((record.lineage as MutableRecord[])[1] as MutableRecord).previousBlockhash =
          ROOT_BLOCKHASH),
    ],
    [
      'root blockhash',
      (record: MutableRecord) => (record.finalizedRootBlockhash = PRIOR_BLOCKHASH),
    ],
    ['root slot', (record: MutableRecord) => (record.finalizedRootSlot = '999')],
    ['empty lineage', (record: MutableRecord) => (record.lineage = [])],
  ])('rejects finalized lineage drift: %s', async (_label, mutate) => {
    const value = fixture({ transcriptMutate: mutate });
    await expectUnavailable(value.source.readTarget(value.request), 'TRANSCRIPT_UNAVAILABLE');
  });

  it.each([
    ['commitment', (record: MutableRecord) => (record.commitment = 'confirmed')],
    ['genesis', (record: MutableRecord) => (record.genesisHash = ID.usdcMintAddress)],
    ['program', (record: MutableRecord) => (record.programAddress = ID.usdcReserveAddress)],
    ['market', (record: MutableRecord) => (record.lendingMarketAddress = ID.usdcReserveAddress)],
    ['reserve', (record: MutableRecord) => (record.reserveAddress = ID.lendingMarketAddress)],
    ['mint', (record: MutableRecord) => (record.assetMintAddress = ID.usdcReserveAddress)],
    ['decoder pin', (record: MutableRecord) => (record.decoderCommitSha = 'a'.repeat(40))],
    ['wallet', (record: MutableRecord) => (record.canonicalWalletAddress = ID.usdcReserveAddress)],
  ])('rejects transcript %s identity drift', async (_label, mutate) => {
    const value = fixture({ transcriptMutate: mutate });
    await expectUnavailable(value.source.readTarget(value.request), 'TRANSCRIPT_UNAVAILABLE');
  });

  it.each([
    ['incomplete status', (coverage: MutableRecord) => (coverage.status = 'PARTIAL')],
    ['page token', (coverage: MutableRecord) => (coverage.nextPageToken = 'next')],
    ['count mismatch', (coverage: MutableRecord) => (coverage.matchedAccountCount = '2')],
    ['context slot', (coverage: MutableRecord) => (coverage.contextSlot = FLOOR_SLOT)],
  ])('rejects non-COMPLETE coverage: %s', async (_label, mutate) => {
    const value = fixture({
      transcriptMutate: (record) => mutate(record.coverage as MutableRecord),
    });
    await expectUnavailable(value.source.readTarget(value.request), 'TRANSCRIPT_UNAVAILABLE');
  });

  it.each([
    [
      'owner program',
      (account: MutableRecord) => (account.ownerProgramAddress = ID.usdcReserveAddress),
    ],
    ['executable', (account: MutableRecord) => (account.executable = true)],
    [
      'decoded owner',
      (account: MutableRecord) => (account.decodedOwnerAddress = ID.usdcReserveAddress),
    ],
    ['market', (account: MutableRecord) => (account.lendingMarketAddress = ID.usdcReserveAddress)],
    ['decode status', (account: MutableRecord) => (account.decodeStatus = 'PARTIAL')],
    ['hash', (account: MutableRecord) => (account.accountDataSha256 = 'a'.repeat(64))],
    ['base64', (account: MutableRecord) => (account.accountDataBase64 = 'not-base64')],
    ['space', (account: MutableRecord) => (account.space = '5')],
    ['lamports', (account: MutableRecord) => (account.lamports = '0')],
  ])('rejects hostile account data: %s', async (_label, mutate) => {
    const value = fixture({
      transcriptMutate: (record) => {
        const account = ((record.coverage as MutableRecord).accounts as MutableRecord[])[0];
        if (account === undefined) throw new Error('missing fixture account');
        mutate(account);
      },
    });
    await expectUnavailable(value.source.readTarget(value.request), 'TRANSCRIPT_UNAVAILABLE');
  });

  it('rejects duplicate accounts, duplicate kinds, zero positions, and uint64 aggregate overflow', async () => {
    const duplicateAccount = fixture({
      transcriptMutate: (record) => {
        const coverage = record.coverage as MutableRecord;
        coverage.matchedAccountCount = '2';
        coverage.accounts = [obligationAccount(), obligationAccount()];
      },
    });
    await expectUnavailable(duplicateAccount.source.readTarget(duplicateAccount.request));

    const duplicateKind = fixture({
      transcriptMutate: (record) => {
        const account = ((record.coverage as MutableRecord).accounts as MutableRecord[])[0];
        if (account === undefined) throw new Error('missing fixture account');
        account.positions = [
          {
            positionKind: 'SUPPLY',
            reserveAddress: ID.usdcReserveAddress,
            assetMintAddress: ID.usdcMintAddress,
            amountAtomic: '1',
          },
          {
            positionKind: 'SUPPLY',
            reserveAddress: ID.usdcReserveAddress,
            assetMintAddress: ID.usdcMintAddress,
            amountAtomic: '2',
          },
        ];
      },
    });
    await expectUnavailable(duplicateKind.source.readTarget(duplicateKind.request));

    const zero = fixture({
      transcriptMutate: (record) => {
        const account = ((record.coverage as MutableRecord).accounts as MutableRecord[])[0];
        if (account === undefined) throw new Error('missing fixture account');
        (account.positions as MutableRecord[])[0]!.amountAtomic = '0';
      },
    });
    await expectUnavailable(zero.source.readTarget(zero.request));

    const overflow = fixture({
      transcriptMutate: (record) => {
        const coverage = record.coverage as MutableRecord;
        coverage.matchedAccountCount = '2';
        coverage.accounts = [
          obligationAccount(OBLIGATION_ACCOUNT, [
            {
              positionKind: 'SUPPLY',
              reserveAddress: ID.usdcReserveAddress,
              assetMintAddress: ID.usdcMintAddress,
              amountAtomic: ((1n << 64n) - 1n).toString(10),
            },
          ]),
          obligationAccount(OTHER_OBLIGATION_ACCOUNT, [
            {
              positionKind: 'SUPPLY',
              reserveAddress: ID.usdcReserveAddress,
              assetMintAddress: ID.usdcMintAddress,
              amountAtomic: '1',
            },
          ]),
        ];
      },
    });
    await expectUnavailable(overflow.source.readTarget(overflow.request));
  });

  it('rejects oversized account data and too many lineage blocks', async () => {
    const oversized = Buffer.alloc(32 * 1024 + 1, 1);
    const accountDataTooLarge = fixture({
      transcriptMutate: (record) => {
        const account = ((record.coverage as MutableRecord).accounts as MutableRecord[])[0];
        if (account === undefined) throw new Error('missing fixture account');
        account.space = oversized.byteLength.toString(10);
        account.accountDataBase64 = oversized.toString('base64');
        account.accountDataSha256 = createHash('sha256').update(oversized).digest('hex');
      },
    });
    await expectUnavailable(accountDataTooLarge.source.readTarget(accountDataTooLarge.request));

    const tooManyBlocks = fixture({
      transcriptMutate: (record) => {
        record.lineage = Array.from({ length: 129 }, (_, index) => ({
          slot: String(1000 + index),
          blockhash: FLOOR_BLOCKHASH,
          parentSlot: String(999 + index),
          previousBlockhash: PRIOR_BLOCKHASH,
        }));
      },
    });
    await expectUnavailable(tooManyBlocks.source.readTarget(tooManyBlocks.request));
  });

  it('rejects accessors without invoking them and rejects cyclic transcript data', async () => {
    const accessor = fixture();
    let invoked = false;
    accessor.transport.rawCapability = Object.freeze(
      Object.defineProperty(Object.create(null) as object, 'transcriptVersion', {
        enumerable: true,
        get: () => {
          invoked = true;
          return 1;
        },
      }),
    );
    await expectUnavailable(accessor.source.readTarget(accessor.request), 'TRANSCRIPT_UNAVAILABLE');
    expect(invoked).toBe(false);

    const cyclic = fixture();
    const cycle = Object.create(null) as MutableRecord;
    cycle.self = cycle;
    cyclic.transport.rawCapability = Object.freeze(cycle);
    await expectUnavailable(cyclic.source.readTarget(cyclic.request), 'TRANSCRIPT_UNAVAILABLE');
  });

  it('fails closed on abort before, after context, and after transcript', async () => {
    const before = fixture();
    before.controller.abort();
    await expectUnavailable(before.source.readTarget(before.request), 'ABORTED');
    expect(before.context.calls).toHaveLength(0);

    const duringContext = fixture();
    duringContext.context.afterRead = () => duringContext.controller.abort();
    await expectUnavailable(duringContext.source.readTarget(duringContext.request), 'ABORTED');
    expect(duringContext.transport.calls).toHaveLength(0);

    const duringTranscript = fixture();
    duringTranscript.transport.afterRead = () => duringTranscript.controller.abort();
    await expectUnavailable(
      duringTranscript.source.readTarget(duringTranscript.request),
      'ABORTED',
    );
  });

  it('fails closed on deadline expiry, an overlong deadline, and clock regression', async () => {
    const expired = fixture({ clockValues: [NOW, DEADLINE_AT] });
    await expectUnavailable(expired.source.readTarget(expired.request), 'DEADLINE_EXCEEDED');
    expect(expired.transport.calls).toHaveLength(0);

    const tooLong = fixture({ clockValues: ['2026-09-06T17:59:00.000Z'] });
    await expectUnavailable(tooLong.source.readTarget(tooLong.request), 'INVALID_REQUEST');
    expect(tooLong.context.calls).toHaveLength(0);

    const regressed = fixture({ clockValues: [NOW, '2026-09-06T17:59:59.999Z'] });
    await expectUnavailable(regressed.source.readTarget(regressed.request), 'CLOCK_REGRESSION');
  });

  it('sanitizes dependency failures', async () => {
    const contextFailure = fixture();
    contextFailure.context.error = new Error('sensitive database detail');
    const contextError = await expectUnavailable(
      contextFailure.source.readTarget(contextFailure.request),
    );
    expect(contextError.message).not.toContain('sensitive');

    const transcriptFailure = fixture();
    transcriptFailure.transport.error = new Error('sensitive endpoint detail');
    const transcriptError = await expectUnavailable(
      transcriptFailure.source.readTarget(transcriptFailure.request),
    );
    expect(transcriptError.message).not.toContain('endpoint');
  });

  it('captures methods without invoking accessors or accepting proxied dependencies', () => {
    let invoked = false;
    const accessorContext = Object.defineProperty({}, 'readContext', {
      get: () => {
        invoked = true;
        return async () => undefined;
      },
    });
    const value = fixture();
    expect(
      () =>
        new DormantKaminoProviderPositionAdmissionSource(
          { sourceFamilyId: SOURCE_FAMILY_ID, sourceId: SOURCE_ID, sourceKind: 'RPC' },
          accessorContext as DormantKaminoPositionTargetContextReader,
          value.transport,
          new SequenceClock([NOW]),
        ),
    ).toThrow(DormantKaminoProviderPositionAdmissionSourceUnavailableError);
    expect(invoked).toBe(false);
    expect(
      () =>
        new DormantKaminoProviderPositionAdmissionSource(
          { sourceFamilyId: SOURCE_FAMILY_ID, sourceId: SOURCE_ID, sourceKind: 'RPC' },
          new Proxy(value.context, {}),
          value.transport,
          new SequenceClock([NOW]),
        ),
    ).toThrow(DormantKaminoProviderPositionAdmissionSourceUnavailableError);
  });

  it('contains no endpoint, environment, client, signer, Nest registration, or direct network path', () => {
    const source = readFileSync(__filename.replace(/\.spec\.ts$/u, '.ts'), 'utf8');
    expect(source).not.toMatch(
      /process\.env|fetch\s*\(|axios|@nestjs|https?:\/\/|new\s+Connection|sendTransaction|signTransaction/u,
    );
    expect(source).toContain('current public admission anchor carries only slot/root');
    expect(source).toContain('registers no provider or runtime');
  });
});
