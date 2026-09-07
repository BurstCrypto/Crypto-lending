import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  sparkLendManifestFingerprintSha256,
  type SparkLendEthereumUSDCManifest,
} from '../../smart-lending/infrastructure/spark/sparklend-ethereum-usdc.manifest';
import {
  PROVIDER_POSITION_ADMISSION_SOURCE_USE,
  PROVIDER_POSITION_ADMISSION_VERSION,
  type ReadProviderPositionAdmissionTargetRequestV1,
} from '../application/provider-position-admission.coordinator';
import {
  DormantSparkLendEthereumProviderPositionSource,
  SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
  SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
  SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
  SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
  type ReadSparkLendEthereumDurableTargetContextRequestV1,
  type ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  type SparkLendEthereumDurableTargetContextReaderPort,
  type SparkLendEthereumFinalizedPositionTranscriptPort,
  type SparkLendEthereumProviderPositionSourceClock,
} from './dormant-sparklend-ethereum-provider-position.source';

const ACCOUNT_ID = parseAccountId('11111111-1111-4111-8111-111111111111');
const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const CORRELATION_ID = '33333333-3333-4333-8333-333333333333';
const WALLET_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VARIABLE_DEBT_TOKEN = '0xdddddddddddddddddddddddddddddddddddddddd';
const STABLE_DEBT_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const VARIABLE_DEBT_IMPLEMENTATION = '0xffffffffffffffffffffffffffffffffffffffff';
const STABLE_DEBT_IMPLEMENTATION = '0x9999999999999999999999999999999999999999';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SOURCE_FAMILY_ID = 'rpc-operator-a';
const SOURCE_ID = 'rpc-a';
const CONTEXT_SOURCE_FAMILY_ID = 'durable-postgres';
const CONTEXT_SOURCE_ID = 'wallet-anchor-context';
const STARTED_AT = '2026-09-06T18:00:00.000Z';
const DEADLINE_AT = '2026-09-06T18:00:25.000Z';
const STALE_AFTER = '2026-09-06T18:00:30.000Z';
const FLOOR_HASH = `0x${'1'.repeat(64)}`;
const BLOCK_HASH = `0x${'2'.repeat(64)}`;
const BLOCK_TIMESTAMP = `0x${Math.floor(Date.parse(STARTED_AT) / 1000 - 60).toString(16)}`;
const SHA = (digit: string): string => digit.repeat(64);

const CONTRACTS = Object.freeze({
  provider: '0x02c3ea4e34c0cbd694d2adfa2c690eecbc1793ee',
  pool: '0xc13e21b648a5ee794902342038ff3adab66be987',
  configurator: '0x542dba469bde58faee189ffb60c6b49ce60e0738',
  implementation: '0x5ae329203e00f76891094dcfedd5aca082a50e1b',
  dataProvider: '0xfc21d6d146e6086b8359705c8b28512a983db0cb',
  usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  spToken: '0x377c3bd93f2a2984e1e7be6a5c22c525ed4a4815',
  spTokenImplementation: '0x6175ddec3b9b38c88157c10a01ed4a3fa8639cc6',
});

const MANIFEST = Object.freeze({
  schemaVersion: 1,
  providerId: 'spark',
  protocolId: 'sparklend',
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  maximumBlockAgeSeconds: '3600',
  assetRegistry: Object.freeze({
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  }),
  marketId: 'sparklend-ethereum-usdc',
  contracts: CONTRACTS,
  asset: Object.freeze({ symbol: 'USDC', decimals: 6 }),
  runtimeCodeSha256: Object.freeze({
    provider: SHA('1'),
    pool: SHA('2'),
    configurator: SHA('3'),
    implementation: SHA('4'),
    dataProvider: SHA('5'),
    usdc: SHA('6'),
    spToken: SHA('7'),
    spTokenImplementation: SHA('8'),
  }),
  source: Object.freeze({
    repository: 'sparkdotfi/spark-address-registry',
    commit: 'ecea29bd2a1546bbbf4999e486b3c04f0e10b748',
    contractsPath: 'src/SparkLend.sol',
    assetPath: 'src/Ethereum.sol',
  }),
}) satisfies SparkLendEthereumUSDCManifest;
const MANIFEST_FINGERPRINT = sparkLendManifestFingerprintSha256(MANIFEST);
const ASSET = Object.freeze({
  stablecoin: 'USDC' as const,
  networkId: 'eip155:1',
  identity: CONTRACTS.usdc,
  decimals: 6,
});

type MutableRecord = Record<string, unknown>;
type TranscriptFactory = (
  request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
) => unknown | Promise<unknown>;

function uint256(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function addressWord(value: string): string {
  return `0x${'0'.repeat(24)}${value.slice(2)}`;
}

function reserveTuple(stableDebtAddress: string): string {
  return `0x${addressWord(CONTRACTS.spToken).slice(2)}${addressWord(stableDebtAddress).slice(2)}${addressWord(VARIABLE_DEBT_TOKEN).slice(2)}`;
}

function blockParameter(): MutableRecord {
  return { blockHash: BLOCK_HASH, requireCanonical: true };
}

function deepImmutable(value: unknown, root = true): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => deepImmutable(entry, false)));
  }
  if (typeof value === 'object' && value !== null) {
    const output = root ? Object.create(null) : ({} as MutableRecord);
    for (const [key, entry] of Object.entries(value)) {
      (output as MutableRecord)[key] = deepImmutable(entry, false);
    }
    return Object.freeze(output);
  }
  return value;
}

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
    providerId: 'spark',
    protocolId: 'sparklend',
    marketId: 'sparklend-ethereum-usdc',
    networkId: 'eip155:1',
    assets: Object.freeze([ASSET]),
    ...overrides,
  };
}

function contextObject(
  input: ReadSparkLendEthereumDurableTargetContextRequestV1,
  overrides: MutableRecord = {},
): MutableRecord {
  return {
    contextVersion: SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
    use: SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    accountId: input.accountId,
    correlationId: input.correlationId,
    walletId: input.walletId,
    networkId: input.networkId,
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

function call(
  to: string,
  callData: string,
  result: string,
  extra: MutableRecord = {},
): MutableRecord {
  return {
    method: 'eth_call',
    to,
    callData,
    blockParameter: blockParameter(),
    result,
    ...extra,
  };
}

function codeRead(address: string, resultSha256: string): MutableRecord {
  return {
    method: 'eth_getCode',
    address,
    blockParameter: blockParameter(),
    resultSha256,
  };
}

function tokenProof(
  input: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  role: 'SUPPLY' | 'VARIABLE_BORROW' | 'STABLE_BORROW',
  balance: bigint,
): MutableRecord {
  const supply = role === 'SUPPLY';
  const stable = role === 'STABLE_BORROW';
  const tokenAddress = supply
    ? CONTRACTS.spToken
    : stable
      ? STABLE_DEBT_TOKEN
      : VARIABLE_DEBT_TOKEN;
  const implementationAddress = supply
    ? CONTRACTS.spTokenImplementation
    : stable
      ? STABLE_DEBT_IMPLEMENTATION
      : VARIABLE_DEBT_IMPLEMENTATION;
  return {
    role,
    tokenAddress,
    identityStatus: supply ? 'MANIFEST_PINNED' : 'RELATIONSHIP_VERIFIED_REQUIRES_PRODUCTION_PIN',
    runtimeCodeRead: codeRead(tokenAddress, supply ? MANIFEST.runtimeCodeSha256.spToken : SHA('a')),
    implementationRead: call(tokenAddress, '0x5c60da1b', addressWord(implementationAddress), {
      from: CONTRACTS.configurator,
    }),
    implementationRuntimeCodeRead: codeRead(
      implementationAddress,
      supply ? MANIFEST.runtimeCodeSha256.spTokenImplementation : SHA(stable ? 'c' : 'b'),
    ),
    poolRead: call(tokenAddress, '0x7535d246', addressWord(CONTRACTS.pool)),
    underlyingAssetRead: call(tokenAddress, '0xb16a19de', addressWord(CONTRACTS.usdc)),
    decimalsRead: call(tokenAddress, '0x313ce567', uint256(6n)),
    balanceRead: call(tokenAddress, input.walletBalanceCallData, uint256(balance)),
  };
}

function transcriptObject(
  input: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  options: Readonly<{
    stableDebt?: boolean;
    supply?: bigint;
    variableDebt?: bigint;
    stableDebtBalance?: bigint;
  }> = {},
): MutableRecord {
  const stableDebt = options.stableDebt === true;
  return {
    transcriptVersion: SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
    use: SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    accountId: input.accountId,
    correlationId: input.correlationId,
    walletId: input.walletId,
    walletAddress: input.walletAddress,
    providerId: input.providerId,
    protocolId: input.protocolId,
    marketId: input.marketId,
    networkId: input.networkId,
    sourceFamilyId: input.sourceFamilyId,
    sourceId: input.sourceId,
    manifestFingerprintSha256: input.manifestFingerprintSha256,
    chainIdBefore: '0x1',
    chainIdAfter: '0x1',
    blockBefore: { number: '0x65', hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    blockAfter: { number: '0x65', hash: BLOCK_HASH, timestamp: BLOCK_TIMESTAMP },
    reserveTokenRead: call(
      input.reserveTokenRead.to,
      input.reserveTokenRead.callData,
      reserveTuple(stableDebt ? STABLE_DEBT_TOKEN : ZERO_ADDRESS),
    ),
    tokenProofs: [
      tokenProof(input, 'SUPPLY', options.supply ?? 1_234_567n),
      tokenProof(input, 'VARIABLE_BORROW', options.variableDebt ?? 200_000n),
      ...(stableDebt
        ? [tokenProof(input, 'STABLE_BORROW', options.stableDebtBalance ?? 300_000n)]
        : []),
    ],
    observedAt: STARTED_AT,
    staleAfter: STALE_AFTER,
    status: 'COMPLETE',
    zeroPositionSemantics: 'EXPLICIT_ZERO_BALANCE_FOR_SUPPLY_AND_EVERY_DISCOVERED_DEBT_TOKEN',
  };
}

interface Fixture {
  readonly order: string[];
  readonly contextReader: SparkLendEthereumDurableTargetContextReaderPort;
  readonly transcriptReader: SparkLendEthereumFinalizedPositionTranscriptPort;
  readonly clock: SparkLendEthereumProviderPositionSourceClock;
  readonly contextRead: jest.Mock;
  readonly contextVerify: jest.Mock;
  readonly transcriptRead: jest.Mock;
  readonly transcriptVerify: jest.Mock;
  readonly setContextFactory: (
    factory: (request: ReadSparkLendEthereumDurableTargetContextRequestV1) => unknown,
  ) => void;
  readonly setTranscriptFactory: (factory: TranscriptFactory) => void;
  readonly setClockTimes: (times: readonly string[]) => void;
}

function fixture(): Fixture {
  const order: string[] = [];
  let makeContext = (input: ReadSparkLendEthereumDurableTargetContextRequestV1): unknown =>
    deepImmutable(contextObject(input));
  let makeTranscript: TranscriptFactory = (input) => deepImmutable(transcriptObject(input));
  let clockTimes: string[] = [];
  const issuedContexts = new WeakMap<object, ReadSparkLendEthereumDurableTargetContextRequestV1>();
  const issuedTranscripts = new WeakMap<
    object,
    ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1
  >();
  const contextRead = jest.fn(
    async (input: ReadSparkLendEthereumDurableTargetContextRequestV1): Promise<unknown> => {
      order.push('context-read');
      const result = makeContext(input);
      if (typeof result === 'object' && result !== null) issuedContexts.set(result, input);
      return result;
    },
  );
  const contextVerify = jest.fn(
    (capability: unknown, input: ReadSparkLendEthereumDurableTargetContextRequestV1): boolean => {
      order.push('context-verify');
      return (
        typeof capability === 'object' &&
        capability !== null &&
        issuedContexts.get(capability) === input
      );
    },
  );
  const transcriptRead = jest.fn(
    async (input: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1): Promise<unknown> => {
      order.push('transcript-read');
      const result = await makeTranscript(input);
      if (typeof result === 'object' && result !== null) issuedTranscripts.set(result, input);
      return result;
    },
  );
  const transcriptVerify = jest.fn(
    (
      capability: unknown,
      input: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
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
      contextVersion: SPARKLEND_ETHEREUM_DURABLE_TARGET_CONTEXT_VERSION,
      sourceFamilyId: CONTEXT_SOURCE_FAMILY_ID,
      sourceId: CONTEXT_SOURCE_ID,
      readContext: contextRead,
      verifyContext: contextVerify,
    },
    transcriptReader: {
      transcriptVersion: SPARKLEND_ETHEREUM_FINALIZED_POSITION_TRANSCRIPT_VERSION,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceId: SOURCE_ID,
      readTranscript: transcriptRead,
      verifyTranscript: transcriptVerify,
    },
    clock: {
      now: () => new Date(clockTimes.shift() ?? STARTED_AT),
    },
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
    setClockTimes: (times) => {
      clockTimes = [...times];
    },
  };
}

function source(testFixture: Fixture): DormantSparkLendEthereumProviderPositionSource {
  return new DormantSparkLendEthereumProviderPositionSource(
    MANIFEST,
    MANIFEST_FINGERPRINT,
    testFixture.contextReader,
    testFixture.transcriptReader,
    testFixture.clock,
  );
}

const FIXED_ERROR = Object.freeze({
  name: 'DormantSparkLendEthereumProviderPositionSourceError',
  message: 'SparkLend Ethereum provider-position source is unavailable.',
});

function mutateTranscript(
  testFixture: Fixture,
  mutation: (
    candidate: MutableRecord,
    request: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
  ) => void,
  stableDebt = false,
): void {
  testFixture.setTranscriptFactory((input) => {
    const candidate = transcriptObject(input, { stableDebt });
    mutation(candidate, input);
    return deepImmutable(candidate);
  });
}

describe('DormantSparkLendEthereumProviderPositionSource', () => {
  it('reads durable context first and emits only complete address-free SparkLend evidence', async () => {
    const testFixture = fixture();
    const result = await source(testFixture).readTarget(request());

    expect(testFixture.order).toEqual([
      'context-read',
      'context-verify',
      'transcript-read',
      'transcript-verify',
      'context-verify',
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
      providerId: 'spark',
      protocolId: 'sparklend',
      marketId: 'sparklend-ethereum-usdc',
      networkId: 'eip155:1',
      assets: [ASSET],
      status: 'COMPLETE',
      observedAt: STARTED_AT,
      staleAfter: STALE_AFTER,
      continuityFloor: { kind: 'EVM_BLOCK', blockNumber: '100', blockHash: FLOOR_HASH },
      chainAnchor: { kind: 'EVM_BLOCK', blockNumber: '101', blockHash: BLOCK_HASH },
      positions: [
        {
          positionId: `sparklend-${WALLET_ID}-usdc-supply`,
          positionKind: 'SUPPLY',
          asset: ASSET,
          balance: { atomic: '1234567', decimal: '1.234567' },
        },
        {
          positionId: `sparklend-${WALLET_ID}-usdc-borrow`,
          positionKind: 'BORROW',
          asset: ASSET,
          balance: { atomic: '200000', decimal: '0.200000' },
        },
      ],
    });
    const contextRequest = testFixture.contextRead.mock
      .calls[0]?.[0] as ReadSparkLendEthereumDurableTargetContextRequestV1;
    const transcriptRequest = testFixture.transcriptRead.mock
      .calls[0]?.[0] as ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1;
    expect(Object.isFrozen(contextRequest)).toBe(true);
    expect(Object.isFrozen(transcriptRequest)).toBe(true);
    expect(contextRequest).toMatchObject({
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      mayCreatePositionSnapshot: false,
    });
    expect(transcriptRequest).toMatchObject({
      expectedChainId: '0x1',
      blockSelector: 'finalized',
      blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
      manifestFingerprintSha256: MANIFEST_FINGERPRINT,
      manifest: MANIFEST,
      maximumTokenProofs: 3,
      maximumResponseBytes: 96 * 1024,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      mayCreatePositionSnapshot: false,
    });
    expect(transcriptRequest.signal).toBe(contextRequest.signal);
    expect(transcriptRequest.durableContext).toBe(testFixture.contextVerify.mock.calls[0]?.[0]);
    expect(transcriptRequest.reserveTokenRead).toEqual({
      method: 'eth_call',
      to: CONTRACTS.dataProvider,
      callData: `0xd2493b6c${'0'.repeat(24)}${CONTRACTS.usdc.slice(2)}`,
    });
    expect(transcriptRequest.walletBalanceCallData).toBe(
      `0x70a08231${'0'.repeat(24)}${WALLET_ADDRESS.slice(2)}`,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(WALLET_ADDRESS);
    expect(serialized).not.toContain(VARIABLE_DEBT_TOKEN);
    expect(serialized).not.toContain(VARIABLE_DEBT_IMPLEMENTATION);
  });

  it('reads and aggregates a discovered nonzero stable-debt token', async () => {
    const testFixture = fixture();
    testFixture.setTranscriptFactory((input) =>
      deepImmutable(
        transcriptObject(input, {
          stableDebt: true,
          supply: 0n,
          variableDebt: 200_000n,
          stableDebtBalance: 300_000n,
        }),
      ),
    );

    const result = await source(testFixture).readTarget(request());

    expect(result.positions).toEqual([
      {
        positionId: `sparklend-${WALLET_ID}-usdc-borrow`,
        positionKind: 'BORROW',
        asset: ASSET,
        balance: { atomic: '500000', decimal: '0.500000' },
      },
    ]);
    const issued = testFixture.transcriptRead.mock
      .calls[0]?.[0] as ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1;
    const capability = testFixture.transcriptVerify.mock.calls[0]?.[0] as MutableRecord;
    expect(capability.tokenProofs).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain(STABLE_DEBT_TOKEN);
    expect(JSON.stringify(result)).not.toContain(STABLE_DEBT_IMPLEMENTATION);
    expect(issued.manifestFingerprintSha256).toBe(MANIFEST_FINGERPRINT);
  });

  it('accepts explicit zero for supply and every discovered debt token as a complete empty set', async () => {
    const testFixture = fixture();
    testFixture.setTranscriptFactory((input) =>
      deepImmutable(
        transcriptObject(input, {
          stableDebt: true,
          supply: 0n,
          variableDebt: 0n,
          stableDebtBalance: 0n,
        }),
      ),
    );

    const result = await source(testFixture).readTarget(request());

    expect(result.status).toBe('COMPLETE');
    expect(result.positions).toEqual([]);
  });

  it.each([
    [
      'missing stable-debt proof',
      (candidate: MutableRecord): void => {
        (candidate.tokenProofs as unknown[]).pop();
      },
      true,
    ],
    [
      'extra stable proof when tuple says zero',
      (
        candidate: MutableRecord,
        input: ReadSparkLendEthereumFinalizedPositionTranscriptRequestV1,
      ) => {
        (candidate.tokenProofs as unknown[]).push(tokenProof(input, 'STABLE_BORROW', 0n));
      },
      false,
    ],
    [
      'stable/variable alias',
      (candidate: MutableRecord): void => {
        const read = candidate.reserveTokenRead as MutableRecord;
        read.result = reserveTuple(VARIABLE_DEBT_TOKEN);
      },
      true,
    ],
    [
      'known-contract variable debt',
      (candidate: MutableRecord): void => {
        const read = candidate.reserveTokenRead as MutableRecord;
        read.result = `${addressWord(CONTRACTS.spToken)}${addressWord(ZERO_ADDRESS).slice(2)}${addressWord(CONTRACTS.pool).slice(2)}`;
      },
      false,
    ],
  ] as const)('fails closed for %s', async (_name, mutation, stableDebt) => {
    const testFixture = fixture();
    mutateTranscript(testFixture, mutation, stableDebt);

    await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
  });

  it.each([
    [
      'manifest aToken mismatch',
      (candidate: MutableRecord): void => {
        const reserveRead = candidate.reserveTokenRead as MutableRecord;
        reserveRead.result = `${addressWord(WALLET_ADDRESS)}${addressWord(ZERO_ADDRESS).slice(2)}${addressWord(VARIABLE_DEBT_TOKEN).slice(2)}`;
      },
    ],
    [
      'supply runtime hash mismatch',
      (candidate: MutableRecord): void => {
        const proof = (candidate.tokenProofs as MutableRecord[])[0];
        (proof?.runtimeCodeRead as MutableRecord).resultSha256 = SHA('f');
      },
    ],
    [
      'unapproved debt represented as pinned',
      (candidate: MutableRecord): void => {
        const proof = (candidate.tokenProofs as MutableRecord[])[1];
        if (proof) proof.identityStatus = 'MANIFEST_PINNED';
      },
    ],
    [
      'proxy implementation mismatch',
      (candidate: MutableRecord): void => {
        const proof = (candidate.tokenProofs as MutableRecord[])[0];
        (proof?.implementationRead as MutableRecord).result = addressWord(
          VARIABLE_DEBT_IMPLEMENTATION,
        );
      },
    ],
    [
      'pool relationship mismatch',
      (candidate: MutableRecord): void => {
        const proof = (candidate.tokenProofs as MutableRecord[])[1];
        (proof?.poolRead as MutableRecord).result = addressWord(CONTRACTS.provider);
      },
    ],
    [
      'underlying relationship mismatch',
      (candidate: MutableRecord): void => {
        const proof = (candidate.tokenProofs as MutableRecord[])[1];
        (proof?.underlyingAssetRead as MutableRecord).result = addressWord(CONTRACTS.pool);
      },
    ],
    [
      'decimals mismatch',
      (candidate: MutableRecord): void => {
        const proof = (candidate.tokenProofs as MutableRecord[])[1];
        (proof?.decimalsRead as MutableRecord).result = uint256(18n);
      },
    ],
    [
      'balance wallet mismatch',
      (candidate: MutableRecord): void => {
        const proof = (candidate.tokenProofs as MutableRecord[])[1];
        (proof?.balanceRead as MutableRecord).callData = `0x70a08231${'0'.repeat(64)}`;
      },
    ],
    [
      'noncanonical relationship read',
      (candidate: MutableRecord): void => {
        const proof = (candidate.tokenProofs as MutableRecord[])[1];
        ((proof?.poolRead as MutableRecord).blockParameter as MutableRecord).requireCanonical =
          false;
      },
    ],
  ] as const)(
    'rejects %s instead of admitting incomplete token evidence',
    async (_name, mutation) => {
      const testFixture = fixture();
      mutateTranscript(testFixture, mutation);

      await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
    },
  );

  it.each([
    [
      'financial authority',
      (candidate: MutableRecord): void => {
        candidate.mayAuthorizeFinancialAction = true;
      },
    ],
    [
      'persistence authority',
      (candidate: MutableRecord): void => {
        candidate.mayPersist = true;
      },
    ],
    [
      'snapshot authority',
      (candidate: MutableRecord): void => {
        candidate.mayCreatePositionSnapshot = true;
      },
    ],
    [
      'chain switch',
      (candidate: MutableRecord): void => {
        candidate.chainIdAfter = '0x2';
      },
    ],
    [
      'mixed block transcript',
      (candidate: MutableRecord): void => {
        candidate.blockAfter = {
          number: '0x66',
          hash: `0x${'3'.repeat(64)}`,
          timestamp: BLOCK_TIMESTAMP,
        };
      },
    ],
    [
      'equal-height fork',
      (candidate: MutableRecord): void => {
        candidate.blockBefore = {
          number: '0x64',
          hash: BLOCK_HASH,
          timestamp: BLOCK_TIMESTAMP,
        };
        candidate.blockAfter = {
          number: '0x64',
          hash: BLOCK_HASH,
          timestamp: BLOCK_TIMESTAMP,
        };
        const apply = (entry: unknown): void => {
          const block = (entry as MutableRecord).blockParameter as MutableRecord;
          block.blockHash = BLOCK_HASH;
        };
        apply(candidate.reserveTokenRead);
        for (const proof of candidate.tokenProofs as MutableRecord[]) {
          for (const key of [
            'runtimeCodeRead',
            'implementationRead',
            'implementationRuntimeCodeRead',
            'poolRead',
            'underlyingAssetRead',
            'decimalsRead',
            'balanceRead',
          ]) {
            apply(proof[key]);
          }
        }
      },
    ],
    [
      'missing COMPLETE status',
      (candidate: MutableRecord): void => {
        candidate.status = 'PARTIAL';
      },
    ],
    [
      'implicit zero semantics',
      (candidate: MutableRecord): void => {
        candidate.zeroPositionSemantics = 'MISSING_MEANS_ZERO';
      },
    ],
    [
      'stale block timestamp',
      (candidate: MutableRecord): void => {
        const timestamp = `0x${Math.floor(Date.parse(STARTED_AT) / 1000 - 3601).toString(16)}`;
        (candidate.blockBefore as MutableRecord).timestamp = timestamp;
        (candidate.blockAfter as MutableRecord).timestamp = timestamp;
      },
    ],
  ] as const)('rejects %s from the finalized transcript', async (_name, mutation) => {
    const testFixture = fixture();
    mutateTranscript(testFixture, mutation);

    await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
  });

  it('authenticates exact capability/request identity before inspection and again before return', async () => {
    const testFixture = fixture();
    testFixture.transcriptVerify
      .mockImplementationOnce(() => true)
      .mockImplementationOnce(() => false);

    await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
    expect(testFixture.transcriptVerify).toHaveBeenCalledTimes(2);
    expect(testFixture.transcriptVerify.mock.calls[0]?.[0]).toBe(
      testFixture.transcriptVerify.mock.calls[1]?.[0],
    );
    expect(testFixture.transcriptVerify.mock.calls[0]?.[1]).toBe(
      testFixture.transcriptVerify.mock.calls[1]?.[1],
    );
    expect(testFixture.contextVerify.mock.invocationCallOrder.at(-1)).toBeLessThan(
      testFixture.transcriptVerify.mock.invocationCallOrder.at(-1) ?? 0,
    );
  });

  it('rejects an authenticated but mutable or non-null-prototype capability', async () => {
    const testFixture = fixture();
    testFixture.setTranscriptFactory((input) => transcriptObject(input));

    await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
  });

  it('rejects accessors and proxies without invoking attacker code', async () => {
    const testFixture = fixture();
    const getter = jest.fn(() => '0x1');
    testFixture.setTranscriptFactory((input) => {
      const candidate = transcriptObject(input);
      Object.defineProperty(candidate, 'chainIdBefore', { enumerable: true, get: getter });
      const capability = Object.create(null) as MutableRecord;
      Object.defineProperties(capability, Object.getOwnPropertyDescriptors(candidate));
      return Object.freeze(capability);
    });

    await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
    expect(getter).not.toHaveBeenCalled();

    const proxyFixture = fixture();
    proxyFixture.setTranscriptFactory(() => Object.freeze(new Proxy(Object.create(null), {})));
    await expect(source(proxyFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
  });

  it.each([
    ['providerId', 'aave'],
    ['protocolId', 'spark-v0'],
    ['marketId', 'other-market'],
    ['networkId', 'eip155:8453'],
    ['sourceKind', 'INDEXER'],
    ['sourceFamilyId', 'rpc-operator-b'],
    ['sourceId', 'rpc-b'],
  ] as const)('rejects mismatched %s before durable or transcript reads', async (key, value) => {
    const testFixture = fixture();

    await expect(source(testFixture).readTarget(request({ [key]: value }))).rejects.toMatchObject({
      ...FIXED_ERROR,
      code: 'SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    });
    expect(testFixture.contextRead).not.toHaveBeenCalled();
    expect(testFixture.transcriptRead).not.toHaveBeenCalled();
  });

  it('rejects a mismatched manifest fingerprint before any source read', () => {
    const testFixture = fixture();

    expect(
      () =>
        new DormantSparkLendEthereumProviderPositionSource(
          MANIFEST,
          SHA('f'),
          testFixture.contextReader,
          testFixture.transcriptReader,
          testFixture.clock,
        ),
    ).toThrow(
      expect.objectContaining({
        ...FIXED_ERROR,
        code: 'SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_CONFIGURATION',
      }),
    );
    expect(testFixture.contextRead).not.toHaveBeenCalled();
  });

  it('uses the server clock and fails closed on regression and exclusive deadlines', async () => {
    const regressing = fixture();
    regressing.setClockTimes([STARTED_AT, '2026-09-06T17:59:59.999Z']);
    await expect(source(regressing).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
    expect(regressing.transcriptRead).not.toHaveBeenCalled();

    const deadline = fixture();
    deadline.setClockTimes([STARTED_AT, STARTED_AT, DEADLINE_AT]);
    await expect(source(deadline).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);

    const callerClock = fixture();
    await expect(
      source(callerClock).readTarget(request({ deadlineAt: '2026-09-06T18:00:30.001Z' })),
    ).rejects.toMatchObject({
      code: 'SPARKLEND_ETHEREUM_POSITION_SOURCE_INVALID_REQUEST',
    });
  });

  it('drains an in-flight transcript read before rejecting an aborted request', async () => {
    const testFixture = fixture();
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    testFixture.setTranscriptFactory(async (input) => {
      await gate;
      return deepImmutable(transcriptObject(input));
    });
    const pending = source(testFixture).readTarget(request({ signal: controller.signal }));
    while (testFixture.transcriptRead.mock.calls.length === 0) await Promise.resolve();
    controller.abort();
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    release?.();
    await expect(pending).rejects.toMatchObject(FIXED_ERROR);
  });

  it('normalizes transport failures to one sanitized error without sensitive values', async () => {
    const testFixture = fixture();
    testFixture.setTranscriptFactory(() => {
      throw new Error(`rpc token secret for ${WALLET_ADDRESS}`);
    });

    await expect(source(testFixture).readTarget(request())).rejects.toMatchObject(FIXED_ERROR);
    await source(testFixture)
      .readTarget(request())
      .catch((error: unknown) => {
        expect(JSON.stringify(error)).not.toContain(WALLET_ADDRESS);
        expect(String(error)).not.toContain('secret');
      });
  });

  it('remains source-only and absent from runtime, module, barrel, controller, and ambient IO', () => {
    const directory = join(__dirname);
    const sourceText = readFileSync(
      join(directory, 'dormant-sparklend-ethereum-provider-position.source.ts'),
      'utf8',
    );
    for (const relative of [
      '../mainnet-platforms.module.ts',
      '../index.ts',
      '../http/mainnet-platforms.controller.ts',
      'provider-position-admission-runtime.composition.ts',
    ]) {
      expect(readFileSync(join(directory, relative), 'utf8')).not.toContain(
        'DormantSparkLendEthereumProviderPositionSource',
      );
    }
    expect(sourceText).not.toMatch(/@(?:Module|Injectable|Controller)\b/u);
    expect(sourceText).not.toMatch(/process\.env|fetch\(|axios|console\.|Logger|setTimeout/u);
    expect(sourceText).not.toMatch(/eth_sendRawTransaction|eth_sendTransaction|personal_sign/u);
    expect(sourceText).not.toMatch(/from ['"]@nestjs\//u);
  });
});
