import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  AAVE_V3_ETHEREUM_POOL,
  AAVE_V3_ETHEREUM_USDC,
  AAVE_V3_ETHEREUM_USDC_A_TOKEN,
  AAVE_V3_ETHEREUM_USDC_VARIABLE_DEBT_TOKEN,
  AAVE_V3_ETHEREUM_USDT,
  AAVE_V3_ETHEREUM_USDT_A_TOKEN,
  AAVE_V3_ETHEREUM_USDT_VARIABLE_DEBT_TOKEN,
} from '../../smart-lending/infrastructure/aave/aave-v3-ethereum-deployment.manifest';
import {
  PROVIDER_POSITION_ADMISSION_SOURCE_USE,
  PROVIDER_POSITION_ADMISSION_VERSION,
  type ReadProviderPositionAdmissionTargetRequestV1,
} from '../application/provider-position-admission.coordinator';
import {
  AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
  AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
  AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
  AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
  DormantAaveV3EthereumProviderPositionSource,
  DormantAaveV3EthereumProviderPositionSourceError,
  type AaveV3EthereumDurableTargetContextReaderPort,
  type AaveV3EthereumFinalizedPositionTranscriptPort,
  type AaveV3EthereumProviderPositionSourceClock,
  type ReadAaveV3EthereumDurableTargetContextRequestV1,
  type ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
} from './dormant-aave-v3-ethereum-provider-position.source';

const ACCOUNT_ID = parseAccountId('11111111-1111-4111-8111-111111111111');
const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NETWORK_ID = 'eip155:1';
const SOURCE_FAMILY_ID = 'rpc-operator-a';
const SOURCE_ID = 'rpc-a';
const CONTEXT_SOURCE_FAMILY_ID = 'durable-postgres';
const CONTEXT_SOURCE_ID = 'wallet-anchor-context';
const CORRELATION_ID = '33333333-3333-4333-8333-333333333333';
const STARTED_AT = '2026-09-06T18:00:00.000Z';
const DEADLINE_AT = '2026-09-06T18:00:25.000Z';
const STALE_AFTER = '2026-09-06T18:00:30.000Z';
const FLOOR_HASH = `0x${'1'.repeat(64)}`;
const BLOCK_HASH = `0x${'2'.repeat(64)}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type MutableRecord = Record<string, unknown>;

const ASSETS = Object.freeze([
  Object.freeze({
    stablecoin: 'USDC' as const,
    networkId: NETWORK_ID,
    identity: AAVE_V3_ETHEREUM_USDC,
    decimals: 6,
  }),
  Object.freeze({
    stablecoin: 'USDT' as const,
    networkId: NETWORK_ID,
    identity: AAVE_V3_ETHEREUM_USDT,
    decimals: 6,
  }),
]);

function request(
  overrides: Partial<ReadProviderPositionAdmissionTargetRequestV1> = {},
): ReadProviderPositionAdmissionTargetRequestV1 {
  return {
    admissionVersion: PROVIDER_POSITION_ADMISSION_VERSION,
    accountId: ACCOUNT_ID,
    correlationId: CORRELATION_ID,
    deadlineAt: DEADLINE_AT,
    signal: new AbortController().signal,
    sourceFamilyId: SOURCE_FAMILY_ID,
    sourceId: SOURCE_ID,
    sourceKind: 'RPC',
    walletId: WALLET_ID,
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: AAVE_V3_ETHEREUM_POOL,
    networkId: NETWORK_ID,
    assets: ASSETS,
    ...overrides,
  };
}

function uint256(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function reserveTokens(): readonly MutableRecord[] {
  return [
    {
      stablecoin: 'USDC',
      underlyingAsset: AAVE_V3_ETHEREUM_USDC,
      aTokenAddress: AAVE_V3_ETHEREUM_USDC_A_TOKEN,
      stableDebtTokenAddress: ZERO_ADDRESS,
      variableDebtTokenAddress: AAVE_V3_ETHEREUM_USDC_VARIABLE_DEBT_TOKEN,
    },
    {
      stablecoin: 'USDT',
      underlyingAsset: AAVE_V3_ETHEREUM_USDT,
      aTokenAddress: AAVE_V3_ETHEREUM_USDT_A_TOKEN,
      stableDebtTokenAddress: ZERO_ADDRESS,
      variableDebtTokenAddress: AAVE_V3_ETHEREUM_USDT_VARIABLE_DEBT_TOKEN,
    },
  ];
}

function contextCapability(
  requestInput: ReadAaveV3EthereumDurableTargetContextRequestV1,
  overrides: MutableRecord = {},
): MutableRecord {
  return {
    contextVersion: AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    accountId: requestInput.accountId,
    correlationId: requestInput.correlationId,
    walletId: requestInput.walletId,
    networkId: requestInput.networkId,
    contextSourceFamilyId: CONTEXT_SOURCE_FAMILY_ID,
    contextSourceId: CONTEXT_SOURCE_ID,
    walletAddress: WALLET_ADDRESS,
    continuityFloor: {
      kind: 'EVM_BLOCK',
      blockNumber: '100',
      blockHash: FLOOR_HASH,
    },
    resolvedAt: STARTED_AT,
    ...overrides,
  };
}

function transcriptCapability(
  requestInput: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  balanceByOperation: Readonly<Record<string, bigint>> = {},
  overrides: MutableRecord = {},
): MutableRecord {
  return {
    transcriptVersion: AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    accountId: requestInput.accountId,
    correlationId: requestInput.correlationId,
    walletId: requestInput.walletId,
    walletAddress: requestInput.walletAddress,
    providerId: requestInput.providerId,
    protocolId: requestInput.protocolId,
    marketId: requestInput.marketId,
    networkId: requestInput.networkId,
    sourceFamilyId: requestInput.sourceFamilyId,
    sourceId: requestInput.sourceId,
    chainIdBefore: '0x1',
    chainIdAfter: '0x1',
    blockBefore: { number: '0x65', hash: BLOCK_HASH },
    blockAfter: { number: '0x65', hash: BLOCK_HASH },
    reserveTokens: reserveTokens().filter(({ underlyingAsset }) =>
      requestInput.assets.some(({ identity }) => identity === underlyingAsset),
    ),
    balanceReads: requestInput.balanceReads.map((read) => ({
      ...read,
      method: 'eth_call',
      blockParameter: { blockHash: BLOCK_HASH, requireCanonical: true },
      result: uint256(balanceByOperation[read.operationId] ?? 0n),
    })),
    observedAt: STARTED_AT,
    staleAfter: STALE_AFTER,
    status: 'COMPLETE',
    zeroPositionSemantics: 'EXPLICIT_ZERO_BALANCE_FOR_EVERY_REQUESTED_ASSET',
    ...overrides,
  };
}

interface Fixture {
  readonly order: string[];
  readonly contextReader: AaveV3EthereumDurableTargetContextReaderPort;
  readonly transcriptReader: AaveV3EthereumFinalizedPositionTranscriptPort;
  readonly clock: AaveV3EthereumProviderPositionSourceClock;
  readonly contextRead: jest.Mock;
  readonly contextVerify: jest.Mock;
  readonly transcriptRead: jest.Mock;
  readonly transcriptVerify: jest.Mock;
  readonly setContextFactory: (
    factory: (request: ReadAaveV3EthereumDurableTargetContextRequestV1) => unknown,
  ) => void;
  readonly setTranscriptFactory: (
    factory: (request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1) => unknown,
  ) => void;
}

function fixture(): Fixture {
  const order: string[] = [];
  let makeContext: (request: ReadAaveV3EthereumDurableTargetContextRequestV1) => unknown =
    contextCapability;
  let makeTranscript: (
    request: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
  ) => unknown = (input) =>
    transcriptCapability(input, {
      'usdc-supply': 1_234_567n,
      'usdc-borrow': 200_000n,
    });
  const issuedContexts = new WeakMap<object, ReadAaveV3EthereumDurableTargetContextRequestV1>();
  const issuedTranscripts = new WeakMap<
    object,
    ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1
  >();
  const contextRead = jest.fn(
    async (input: ReadAaveV3EthereumDurableTargetContextRequestV1): Promise<unknown> => {
      order.push('context-read');
      const result = makeContext(input);
      if (typeof result === 'object' && result !== null) issuedContexts.set(result, input);
      return result;
    },
  );
  const contextVerify = jest.fn(
    (capability: unknown, input: ReadAaveV3EthereumDurableTargetContextRequestV1): boolean => {
      order.push('context-verify');
      return (
        typeof capability === 'object' &&
        capability !== null &&
        issuedContexts.get(capability) === input
      );
    },
  );
  const transcriptRead = jest.fn(
    async (input: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1): Promise<unknown> => {
      order.push('transcript-read');
      const result = makeTranscript(input);
      if (typeof result === 'object' && result !== null) issuedTranscripts.set(result, input);
      return result;
    },
  );
  const transcriptVerify = jest.fn(
    (
      capability: unknown,
      input: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1,
    ): boolean => {
      order.push('transcript-verify');
      return (
        typeof capability === 'object' &&
        capability !== null &&
        issuedTranscripts.get(capability) === input
      );
    },
  );
  return {
    order,
    contextReader: {
      contextVersion: AAVE_V3_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
      sourceFamilyId: CONTEXT_SOURCE_FAMILY_ID,
      sourceId: CONTEXT_SOURCE_ID,
      readContext: contextRead,
      verifyContext: contextVerify,
    },
    transcriptReader: {
      transcriptVersion: AAVE_V3_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      readTranscript: transcriptRead,
      verifyTranscript: transcriptVerify,
    },
    clock: { now: () => new Date(STARTED_AT) },
    contextRead,
    contextVerify,
    transcriptRead,
    transcriptVerify,
    setContextFactory: (factory) => {
      makeContext = factory;
    },
    setTranscriptFactory: (factory) => {
      makeTranscript = factory;
    },
  };
}

function source(testFixture: Fixture): DormantAaveV3EthereumProviderPositionSource {
  return new DormantAaveV3EthereumProviderPositionSource(
    testFixture.contextReader,
    testFixture.transcriptReader,
    testFixture.clock,
  );
}

const FIXED_ERROR = {
  name: 'DormantAaveV3EthereumProviderPositionSourceError',
  message: 'Aave V3 Ethereum provider-position source is unavailable.',
};

describe('DormantAaveV3EthereumProviderPositionSource', () => {
  it('reads durable context first and emits only complete account-bound Aave positions', async () => {
    const testFixture = fixture();
    const result = await source(testFixture).readTarget(request());

    expect(testFixture.order).toEqual([
      'context-read',
      'context-verify',
      'transcript-read',
      'transcript-verify',
    ]);
    expect(result).toEqual({
      evidenceVersion: 1,
      use: PROVIDER_POSITION_ADMISSION_SOURCE_USE,
      mayAuthorizeFinancialAction: false,
      accountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      sourceKind: 'RPC',
      sourceObservationId: 'ethereum-block-101',
      walletId: WALLET_ID,
      providerId: 'aave',
      protocolId: 'aave-v3',
      marketId: AAVE_V3_ETHEREUM_POOL,
      networkId: NETWORK_ID,
      assets: ASSETS,
      status: 'COMPLETE',
      observedAt: STARTED_AT,
      staleAfter: STALE_AFTER,
      continuityFloor: { kind: 'EVM_BLOCK', blockNumber: '100', blockHash: FLOOR_HASH },
      chainAnchor: { kind: 'EVM_BLOCK', blockNumber: '101', blockHash: BLOCK_HASH },
      positions: [
        {
          positionId: `aave-v3-${WALLET_ID}-usdc-supply`,
          positionKind: 'SUPPLY',
          asset: ASSETS[0],
          balance: { atomic: '1234567', decimal: '1.234567' },
        },
        {
          positionId: `aave-v3-${WALLET_ID}-usdc-borrow`,
          positionKind: 'BORROW',
          asset: ASSETS[0],
          balance: { atomic: '200000', decimal: '0.200000' },
        },
      ],
    });
    expect(result).not.toHaveProperty('walletAddress');

    const contextRequest = testFixture.contextRead.mock.calls[0]?.[0] as MutableRecord;
    const transcriptRequest = testFixture.transcriptRead.mock.calls[0]?.[0] as MutableRecord;
    expect(contextRequest.signal).toBe(transcriptRequest.signal);
    expect(transcriptRequest.durableContext).toBe(testFixture.contextVerify.mock.calls[0]?.[0]);
    expect(transcriptRequest.continuityFloor).toEqual(
      (testFixture.contextVerify.mock.calls[0]?.[0] as MutableRecord).continuityFloor,
    );
    expect(JSON.stringify(result)).not.toContain(WALLET_ADDRESS);
  });

  it('requires explicit zero reads for every asset and returns proven empty positions', async () => {
    const testFixture = fixture();
    testFixture.setTranscriptFactory((input) => transcriptCapability(input));

    const result = await source(testFixture).readTarget(request());

    expect(result.positions).toEqual([]);
    const transcriptRequest = testFixture.transcriptRead.mock
      .calls[0]?.[0] as ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1;
    expect(transcriptRequest.balanceReads).toHaveLength(4);
  });

  it.each([
    ['providerId', 'compound'],
    ['protocolId', 'aave-v2'],
    ['marketId', 'other-market'],
    ['networkId', 'eip155:8453'],
    ['sourceKind', 'INDEXER'],
    ['sourceFamilyId', 'rpc-operator-b'],
    ['sourceId', 'rpc-b'],
  ] as const)('rejects mismatched %s before any durable or RPC read', async (key, value) => {
    const testFixture = fixture();
    await expect(source(testFixture).readTarget(request({ [key]: value }))).rejects.toMatchObject({
      ...FIXED_ERROR,
      code: 'AAVE_V3_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    });
    expect(testFixture.contextRead).not.toHaveBeenCalled();
    expect(testFixture.transcriptRead).not.toHaveBeenCalled();
  });

  it('rejects a missing requested-asset result instead of treating it as zero', async () => {
    const testFixture = fixture();
    testFixture.setTranscriptFactory((input) => {
      const candidate = transcriptCapability(input);
      candidate.balanceReads = (candidate.balanceReads as readonly unknown[]).slice(0, -1);
      return candidate;
    });

    await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
  });

  it.each([
    [
      'chain identity',
      (candidate: MutableRecord): void => {
        candidate.chainIdAfter = '0x2';
      },
    ],
    [
      'block consistency',
      (candidate: MutableRecord): void => {
        candidate.blockAfter = { number: '0x66', hash: `0x${'3'.repeat(64)}` };
      },
    ],
    [
      'stable-debt absence',
      (candidate: MutableRecord) => {
        const reserves = candidate.reserveTokens as MutableRecord[];
        reserves[0] = { ...reserves[0], stableDebtTokenAddress: WALLET_ADDRESS };
      },
    ],
    [
      'canonical block binding',
      (candidate: MutableRecord) => {
        const reads = candidate.balanceReads as MutableRecord[];
        reads[0] = {
          ...reads[0],
          blockParameter: { blockHash: BLOCK_HASH, requireCanonical: false },
        };
      },
    ],
    [
      'zero semantics',
      (candidate: MutableRecord): void => {
        candidate.zeroPositionSemantics = 'MISSING_MEANS_ZERO';
      },
    ],
    [
      'stateless continuity-floor laundering',
      (candidate: MutableRecord): void => {
        candidate.continuityFloor = {
          kind: 'EVM_BLOCK',
          blockNumber: '101',
          blockHash: BLOCK_HASH,
        };
      },
    ],
  ] as const)('fails closed on hostile transcript %s drift', async (_label, mutate) => {
    const testFixture = fixture();
    testFixture.setTranscriptFactory((input) => {
      const candidate = transcriptCapability(input);
      mutate(candidate);
      return candidate;
    });

    await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
  });

  it('rejects anchor regression and an equal-height hash conflict', async () => {
    for (const blockBefore of [
      { number: '0x63', hash: BLOCK_HASH },
      { number: '0x64', hash: BLOCK_HASH },
    ]) {
      const testFixture = fixture();
      testFixture.setTranscriptFactory((input) =>
        transcriptCapability(input, {}, { blockBefore, blockAfter: blockBefore }),
      );
      await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
    }
  });

  it('authenticates both opaque capabilities before inspecting their properties', async () => {
    const testFixture = fixture();
    let traps = 0;
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          traps += 1;
          throw new Error('private capability detail');
        },
      },
    );
    testFixture.setContextFactory(() => hostile);
    testFixture.contextVerify.mockReturnValueOnce(false);

    await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
    expect(traps).toBe(0);
    expect(testFixture.transcriptRead).not.toHaveBeenCalled();

    const second = fixture();
    second.setTranscriptFactory(() => hostile);
    second.transcriptVerify.mockReturnValueOnce(false);
    await expect(source(second).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
    expect(traps).toBe(0);
  });

  it('rejects same-receiver and same-identity laundering during construction', () => {
    const shared = {
      contextVersion: 1 as const,
      transcriptVersion: 1 as const,
      sourceFamilyId: 'shared-family',
      sourceId: 'shared-source',
      readContext: jest.fn(),
      verifyContext: jest.fn(),
      readTranscript: jest.fn(),
      verifyTranscript: jest.fn(),
    };
    expect(
      () =>
        new DormantAaveV3EthereumProviderPositionSource(shared, shared, {
          now: () => new Date(STARTED_AT),
        }),
    ).toThrow(DormantAaveV3EthereumProviderPositionSourceError);

    const testFixture = fixture();
    const sameFamily = {
      ...testFixture.contextReader,
      sourceFamilyId: SOURCE_FAMILY_ID,
    };
    expect(
      () =>
        new DormantAaveV3EthereumProviderPositionSource(
          sameFamily,
          testFixture.transcriptReader,
          testFixture.clock,
        ),
    ).toThrow(DormantAaveV3EthereumProviderPositionSourceError);
  });

  it('waits for started transcript work to settle, then rejects an aborted request', async () => {
    const testFixture = fixture();
    const controller = new AbortController();
    let release: ((value: unknown) => void) | undefined;
    testFixture.transcriptReader.readTranscript = jest.fn(
      (input: ReadAaveV3EthereumFinalizedPositionTranscriptRequestV1) =>
        new Promise<unknown>((resolve) => {
          release = (value) => resolve(value);
          testFixture.order.push('transcript-read');
          void input;
        }),
    );
    const adapter = source(testFixture);
    const pending = adapter.readTarget(request({ signal: controller.signal }));
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release?.({});
    await expect(pending).rejects.toMatchObject(FIXED_ERROR);
  });

  it('maps private dependency failures to one fixed path-free error', async () => {
    const testFixture = fixture();
    testFixture.contextRead.mockRejectedValueOnce(
      new Error(`credential at ${WALLET_ADDRESS} and https://rpc.invalid/private`),
    );

    let caught: unknown;
    try {
      await source(testFixture).readTarget(request());
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject(FIXED_ERROR);
    expect(String(caught)).not.toContain(WALLET_ADDRESS);
    expect(String(caught)).not.toContain('rpc.invalid');
  });
});
