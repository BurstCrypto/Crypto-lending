import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import { canonicalPositionId } from '../infrastructure/rpc/balance-json-rpc';
import {
  createBalanceSyncExecutionContext,
  INERT_BALANCE_SYNC_EXECUTION_CONTEXT,
  type BalanceIndexerCandidate,
  type BalanceIndexerReadRequest,
  type BalanceSyncExecutionContext,
} from './ports/balance-sync.ports';
import {
  DormantMainnetBalanceTwoSourceAgreementCoordinator,
  ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
  MAINNET_BALANCE_SOURCE_PAIR_REGISTRY_V1,
  MainnetBalanceTwoSourceAgreementUnavailableError,
  SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
  fingerprintMainnetBalanceSourcePairRegistryV1,
  type MainnetBalanceAgreementClock,
  type MainnetBalanceAgreementNetworkId,
  type MainnetBalanceAgreementSourceBinding,
  type MainnetBalanceSourcePairRegistryContentV1,
  type MainnetBalanceSourcePairRegistryV1,
} from './mainnet-balance-two-source-agreement.coordinator';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const WALLET_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-04T17:00:00.000Z';
const APPROVED_AT = '2026-09-04T16:00:00.000Z';
const EXPIRES_AT = '2026-09-04T18:00:00.000Z';
const RETRIEVED_AT = '2026-09-04T16:59:55.000Z';
const ETHEREUM_BLOCK_HASH = `0x${'1'.repeat(64)}`;
const ETHEREUM_PARENT_HASH = `0x${'2'.repeat(64)}`;
const SOLANA_BLOCK_IDENTITY = '5'.repeat(44);
const SOLANA_PARENT_BLOCK_IDENTITY = '6'.repeat(44);

type MutableRecord = Record<string, unknown>;

class SyntheticBalanceReader {
  readonly calls: BalanceIndexerReadRequest[] = [];
  readonly contexts: BalanceSyncExecutionContext[] = [];
  error: Error | undefined;
  operation:
    | ((
        request: BalanceIndexerReadRequest,
        context: BalanceSyncExecutionContext,
      ) => Promise<unknown>)
    | undefined;

  constructor(public response: unknown) {}

  async readCurrent(
    request: BalanceIndexerReadRequest,
    context: BalanceSyncExecutionContext,
  ): Promise<unknown> {
    this.calls.push(request);
    this.contexts.push(context);
    if (this.operation) return this.operation(request, context);
    if (this.error) throw this.error;
    return this.response;
  }
}

class SyntheticClock implements MainnetBalanceAgreementClock {
  constructor(private readonly values: readonly Date[] = [new Date(NOW)]) {}

  private index = 0;

  now(): Date {
    const value = this.values[Math.min(this.index, this.values.length - 1)];
    this.index += 1;
    if (!value) throw new Error('synthetic clock exhausted');
    return value;
  }
}

interface Harness {
  readonly registry: MainnetBalanceSourcePairRegistryV1;
  readonly bindings: MainnetBalanceAgreementSourceBinding[];
  readonly readers: Readonly<{
    ethereumPrimary: SyntheticBalanceReader;
    ethereumCorroborating: SyntheticBalanceReader;
    solanaPrimary: SyntheticBalanceReader;
    solanaCorroborating: SyntheticBalanceReader;
  }>;
  clock: MainnetBalanceAgreementClock;
}

function registryContent(): MainnetBalanceSourcePairRegistryContentV1 {
  return {
    schemaVersion: 1,
    environment: 'MAINNET',
    approvalStatus: 'APPROVED',
    pairs: [
      {
        networkId: ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
        approvedAt: APPROVED_AT,
        expiresAt: EXPIRES_AT,
        primary: { sourceFamilyId: 'synthetic-eth-family-a', sourceId: 'synthetic-eth-a' },
        corroborating: {
          sourceFamilyId: 'synthetic-eth-family-b',
          sourceId: 'synthetic-eth-b',
        },
      },
      {
        networkId: SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
        approvedAt: APPROVED_AT,
        expiresAt: EXPIRES_AT,
        primary: { sourceFamilyId: 'synthetic-sol-family-a', sourceId: 'synthetic-sol-a' },
        corroborating: {
          sourceFamilyId: 'synthetic-sol-family-b',
          sourceId: 'synthetic-sol-b',
        },
      },
    ],
  };
}

function registry(mutate?: (content: MutableRecord) => void): MainnetBalanceSourcePairRegistryV1 {
  const content = clone(registryContent()) as unknown as MutableRecord;
  mutate?.(content);
  return {
    ...(content as unknown as MainnetBalanceSourcePairRegistryContentV1),
    fingerprintSha256: fingerprintMainnetBalanceSourcePairRegistryV1(content),
  };
}

function request(
  networkId: MainnetBalanceAgreementNetworkId = ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
): BalanceIndexerReadRequest {
  return {
    accountId: ACCOUNT_ID,
    walletId: WALLET_ID,
    networkId,
    tier: 'FINANCIAL',
    selector: 'finalized',
  };
}

function positions(
  networkId: MainnetBalanceAgreementNetworkId,
): BalanceIndexerCandidate['positions'] {
  return MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets
    .filter(
      ({ activationState, networkId: assetNetworkId }) =>
        activationState === 'ACTIVE' && assetNetworkId === networkId,
    )
    .map((asset, index) => ({
      positionId: canonicalPositionId([ACCOUNT_ID, WALLET_ID, networkId, asset.identity]),
      stablecoin: asset.stablecoin,
      assetIdentity: asset.identity,
      amountAtomic: String((index + 1) * 1_000_000),
    }));
}

function candidate(
  networkId: MainnetBalanceAgreementNetworkId,
  overrides: Partial<BalanceIndexerCandidate> = {},
): BalanceIndexerCandidate {
  const source =
    networkId === ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID
      ? {
          position: '22000000',
          hash: ETHEREUM_BLOCK_HASH,
          parentHash: ETHEREUM_PARENT_HASH,
          selector: 'finalized' as const,
          retrievedAt: RETRIEVED_AT,
          identityValidated: true,
        }
      : {
          position: '300000000',
          hash: SOLANA_BLOCK_IDENTITY,
          parentHash: SOLANA_PARENT_BLOCK_IDENTITY,
          selector: 'finalized' as const,
          retrievedAt: RETRIEVED_AT,
          identityValidated: true,
        };
  return {
    walletId: WALLET_ID,
    networkId,
    tier: 'FINANCIAL',
    source,
    positions: positions(networkId),
    ...overrides,
  };
}

function harness(): Harness {
  const readers = {
    ethereumPrimary: new SyntheticBalanceReader(
      candidate(ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID),
    ),
    ethereumCorroborating: new SyntheticBalanceReader(
      candidate(ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID),
    ),
    solanaPrimary: new SyntheticBalanceReader(
      candidate(SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID),
    ),
    solanaCorroborating: new SyntheticBalanceReader(
      candidate(SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID),
    ),
  };
  return {
    registry: registry(),
    bindings: [
      {
        networkId: ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
        role: 'PRIMARY',
        sourceFamilyId: 'synthetic-eth-family-a',
        sourceId: 'synthetic-eth-a',
        reader: readers.ethereumPrimary,
      },
      {
        networkId: ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
        role: 'CORROBORATING',
        sourceFamilyId: 'synthetic-eth-family-b',
        sourceId: 'synthetic-eth-b',
        reader: readers.ethereumCorroborating,
      },
      {
        networkId: SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
        role: 'PRIMARY',
        sourceFamilyId: 'synthetic-sol-family-a',
        sourceId: 'synthetic-sol-a',
        reader: readers.solanaPrimary,
      },
      {
        networkId: SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
        role: 'CORROBORATING',
        sourceFamilyId: 'synthetic-sol-family-b',
        sourceId: 'synthetic-sol-b',
        reader: readers.solanaCorroborating,
      },
    ],
    readers,
    clock: new SyntheticClock(),
  };
}

interface TestAgreementCoordinator {
  readonly readCurrentAgreement: (
    request: BalanceIndexerReadRequest,
    context?: BalanceSyncExecutionContext,
  ) => ReturnType<DormantMainnetBalanceTwoSourceAgreementCoordinator['readCurrentAgreement']>;
}

function coordinator(value: Harness): Readonly<TestAgreementCoordinator> {
  const runtime = new DormantMainnetBalanceTwoSourceAgreementCoordinator(
    value.registry,
    value.bindings,
    value.clock,
  );
  return Object.freeze({
    readCurrentAgreement: (
      request: BalanceIndexerReadRequest,
      context: BalanceSyncExecutionContext = INERT_BALANCE_SYNC_EXECUTION_CONTEXT,
    ) => runtime.readCurrentAgreement(request, context),
  });
}

function readerFor(
  value: Harness,
  networkId: MainnetBalanceAgreementNetworkId,
  role: 'PRIMARY' | 'CORROBORATING',
): SyntheticBalanceReader {
  if (networkId === ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID) {
    return role === 'PRIMARY' ? value.readers.ethereumPrimary : value.readers.ethereumCorroborating;
  }
  return role === 'PRIMARY' ? value.readers.solanaPrimary : value.readers.solanaCorroborating;
}

function responseRecord(reader: SyntheticBalanceReader): MutableRecord {
  const copied = clone(reader.response) as unknown as MutableRecord;
  reader.response = copied;
  return copied;
}

function sourceRecord(reader: SyntheticBalanceReader): MutableRecord {
  const source = responseRecord(reader).source;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new Error('synthetic source fixture');
  }
  return source as MutableRecord;
}

function positionRecords(reader: SyntheticBalanceReader): MutableRecord[] {
  const response = responseRecord(reader);
  if (!Array.isArray(response.positions)) throw new Error('synthetic position fixture');
  return response.positions as MutableRecord[];
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

async function expectUnavailable(
  promise: Promise<unknown>,
  code: MainnetBalanceTwoSourceAgreementUnavailableError['code'],
): Promise<MainnetBalanceTwoSourceAgreementUnavailableError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toEqual(
      expect.objectContaining({
        name: 'MainnetBalanceTwoSourceAgreementUnavailableError',
        message: 'Mainnet balance source agreement is unavailable.',
        code,
      }),
    );
    if (error instanceof MainnetBalanceTwoSourceAgreementUnavailableError) return error;
  }
  throw new Error('expected unavailable agreement');
}

function totalReaderCalls(value: Harness): number {
  return Object.values(value.readers).reduce((total, reader) => total + reader.calls.length, 0);
}

describe('DormantMainnetBalanceTwoSourceAgreementCoordinator', () => {
  it('keeps the checked-in production source registry empty, unapproved, immutable, and inert', async () => {
    expect(MAINNET_BALANCE_SOURCE_PAIR_REGISTRY_V1).toMatchObject({
      schemaVersion: 1,
      environment: 'MAINNET',
      approvalStatus: 'NOT_APPROVED',
      pairs: [],
      fingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(Object.isFrozen(MAINNET_BALANCE_SOURCE_PAIR_REGISTRY_V1)).toBe(true);
    expect(Object.isFrozen(MAINNET_BALANCE_SOURCE_PAIR_REGISTRY_V1.pairs)).toBe(true);
    const dormant = new DormantMainnetBalanceTwoSourceAgreementCoordinator(
      MAINNET_BALANCE_SOURCE_PAIR_REGISTRY_V1,
      [],
      new SyntheticClock(),
    );
    await expectUnavailable(
      dormant.readCurrentAgreement(request(), INERT_BALANCE_SYNC_EXECUTION_CONTEXT),
      'UNTRUSTED_SOURCE_IDENTITY',
    );
  });

  it.each(['DEADLINE', 'SHUTDOWN'] as const)(
    'rejects a pre-aborted authenticated %s context before either source reader starts',
    async (abortKind) => {
      const value = harness();
      const owner = createBalanceSyncExecutionContext();
      owner.abort(abortKind);

      await expectUnavailable(
        coordinator(value).readCurrentAgreement(request(), owner.context),
        'SOURCE_UNAVAILABLE',
      );

      expect(totalReaderCalls(value)).toBe(0);
    },
  );

  it('waits for a fast-failure sibling to abort and settle before returning a sanitized error', async () => {
    const value = harness();
    const owner = createBalanceSyncExecutionContext();
    value.readers.ethereumPrimary.error = new Error('private primary failure');
    let markSiblingStarted: (() => void) | undefined;
    const siblingStarted = new Promise<void>((resolve) => {
      markSiblingStarted = resolve;
    });
    let siblingAborted = false;
    value.readers.ethereumCorroborating.operation = async (_request, context) => {
      void _request;
      return new Promise((_resolve, reject) => {
        expect(context).toBe(owner.context);
        markSiblingStarted?.();
        context.signal.addEventListener(
          'abort',
          () => {
            siblingAborted = true;
            reject(new Error('private sibling abort detail'));
          },
          { once: true },
        );
      });
    };

    const pending = coordinator(value).readCurrentAgreement(request(), owner.context);
    let outcomeSettled = false;
    void pending.then(
      () => {
        outcomeSettled = true;
      },
      () => {
        outcomeSettled = true;
      },
    );
    await siblingStarted;
    await Promise.resolve();

    expect(outcomeSettled).toBe(false);
    owner.abort('SHUTDOWN');
    const error = await expectUnavailable(pending, 'SOURCE_UNAVAILABLE');

    expect(siblingAborted).toBe(true);
    expect(value.readers.ethereumPrimary.calls).toHaveLength(1);
    expect(value.readers.ethereumCorroborating.calls).toHaveLength(1);
    expect(JSON.stringify(error)).not.toContain('private');
  });

  it('emits a frozen Ethereum agreement bound to the exact block and both source attestations', async () => {
    const value = harness();
    const result = await coordinator(value).readCurrentAgreement(request());

    expect(value.readers.ethereumPrimary.contexts).toEqual([INERT_BALANCE_SYNC_EXECUTION_CONTEXT]);
    expect(value.readers.ethereumCorroborating.contexts).toEqual([
      INERT_BALANCE_SYNC_EXECUTION_CONTEXT,
    ]);

    expect(result).toMatchObject({
      agreementVersion: 1,
      use: 'DORMANT_MAINNET_BALANCE_OBSERVATION_CANDIDATE_ONLY',
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      accountId: ACCOUNT_ID,
      observationCandidate: {
        walletId: WALLET_ID,
        networkId: ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
        tier: 'FINANCIAL',
        source: {
          position: '22000000',
          hash: ETHEREUM_BLOCK_HASH,
          parentHash: ETHEREUM_PARENT_HASH,
          selector: 'finalized',
          identityValidated: true,
        },
      },
      agreement: {
        status: 'EXACT_CHECKPOINT_AND_BALANCE_MATCH',
        checkpoint: {
          kind: 'ETHEREUM_BLOCK',
          blockNumber: '22000000',
          blockHash: ETHEREUM_BLOCK_HASH,
          parentBlockHash: ETHEREUM_PARENT_HASH,
        },
        sourcePairRegistryFingerprintSha256: value.registry.fingerprintSha256,
        sourcePairApprovalExpiresAt: EXPIRES_AT,
        positionSetFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        agreementFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    expect(result.observationCandidate.positions).toHaveLength(3);
    expect(result.agreement.sourceAttestations).toEqual([
      expect.objectContaining({
        role: 'PRIMARY',
        sourceFamilyId: 'synthetic-eth-family-a',
        sourceId: 'synthetic-eth-a',
        chainIdentityValidated: true,
        candidateFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
      expect.objectContaining({
        role: 'CORROBORATING',
        sourceFamilyId: 'synthetic-eth-family-b',
        sourceId: 'synthetic-eth-b',
        chainIdentityValidated: true,
        candidateFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    ]);
    expect(value.readers.ethereumPrimary.calls[0]).toBe(
      value.readers.ethereumCorroborating.calls[0],
    );
    expect(Object.isFrozen(value.readers.ethereumPrimary.calls[0])).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.observationCandidate)).toBe(true);
    expect(Object.isFrozen(result.agreement.sourceAttestations)).toBe(true);
  });

  it('emits a Solana finalized block identity and an explicit rooted-slot checkpoint', async () => {
    const value = harness();
    const result = await coordinator(value).readCurrentAgreement(
      request(SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID),
    );

    expect(result.agreement.checkpoint).toEqual({
      kind: 'SOLANA_ROOTED_BLOCK',
      finalizedSlot: '300000000',
      blockIdentity: SOLANA_BLOCK_IDENTITY,
      parentBlockIdentity: SOLANA_PARENT_BLOCK_IDENTITY,
      rootSlot: '300000000',
      rootDerivation: 'FINALIZED_SLOT_IS_ROOTED',
    });
    expect(
      result.agreement.sourceAttestations.map(({ role, checkpoint }) => ({ role, checkpoint })),
    ).toEqual([
      { role: 'PRIMARY', checkpoint: result.agreement.checkpoint },
      { role: 'CORROBORATING', checkpoint: result.agreement.checkpoint },
    ]);
    if (result.agreement.checkpoint.kind !== 'SOLANA_ROOTED_BLOCK') {
      throw new Error('expected synthetic Solana checkpoint');
    }
    expect(result.observationCandidate.source).toMatchObject({
      selector: 'finalized',
      position: result.agreement.checkpoint.rootSlot,
    });
  });

  it('canonicalizes registry, binding, and position ordering into deterministic fingerprints', async () => {
    const first = harness();
    const second = harness();
    second.bindings.reverse();
    for (const reader of Object.values(second.readers)) {
      const response = responseRecord(reader);
      if (!Array.isArray(response.positions)) throw new Error('synthetic position fixture');
      response.positions.reverse();
    }
    const originalContent = clone(registryContent());
    const reversedContent = {
      ...originalContent,
      pairs: [...originalContent.pairs].reverse(),
    };

    const firstResult = await coordinator(first).readCurrentAgreement(request());
    const secondResult = await coordinator(second).readCurrentAgreement(request());
    expect(secondResult.agreement.agreementFingerprintSha256).toBe(
      firstResult.agreement.agreementFingerprintSha256,
    );
    expect(secondResult.agreement.sourceAttestations).toEqual(
      firstResult.agreement.sourceAttestations,
    );
    expect(fingerprintMainnetBalanceSourcePairRegistryV1(reversedContent)).toBe(
      first.registry.fingerprintSha256,
    );
  });

  it.each([
    [
      'Ethereum block number',
      ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
      (source: MutableRecord): void => {
        source.position = '22000001';
      },
    ],
    [
      'Ethereum block hash',
      ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
      (source: MutableRecord): void => {
        source.hash = `0x${'3'.repeat(64)}`;
      },
    ],
    [
      'Ethereum parent hash',
      ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
      (source: MutableRecord): void => {
        source.parentHash = `0x${'4'.repeat(64)}`;
      },
    ],
    [
      'Solana finalized slot/root',
      SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
      (source: MutableRecord): void => {
        source.position = '300000001';
      },
    ],
    [
      'Solana block identity',
      SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
      (source: MutableRecord): void => {
        source.hash = '7'.repeat(44);
      },
    ],
    [
      'Solana parent block identity',
      SOLANA_MAINNET_BALANCE_AGREEMENT_NETWORK_ID,
      (source: MutableRecord): void => {
        source.parentHash = '8'.repeat(44);
      },
    ],
  ] as const)('fails closed on %s disagreement', async (_name, networkId, mutate) => {
    const value = harness();
    mutate(sourceRecord(readerFor(value, networkId, 'CORROBORATING')));
    await expectUnavailable(
      coordinator(value).readCurrentAgreement(request(networkId)),
      'CHECKPOINT_MISMATCH',
    );
  });

  it.each([
    [
      'atomic balance',
      (records: MutableRecord[]): void => {
        records[0]!.amountAtomic = '999999';
      },
    ],
  ] as const)('fails closed on valid but divergent %s', async (_name, mutate) => {
    const value = harness();
    mutate(positionRecords(value.readers.ethereumCorroborating));
    await expectUnavailable(coordinator(value).readCurrentAgreement(request()), 'BALANCE_MISMATCH');
  });

  it('accepts response-order differences but never infers a missing asset as zero', async () => {
    const ordered = harness();
    const records = responseRecord(ordered.readers.ethereumCorroborating);
    if (!Array.isArray(records.positions)) throw new Error('synthetic position fixture');
    records.positions.reverse();
    await expect(coordinator(ordered).readCurrentAgreement(request())).resolves.toMatchObject({
      agreement: { status: 'EXACT_CHECKPOINT_AND_BALANCE_MATCH' },
    });

    const missing = harness();
    const missingPositions = responseRecord(missing.readers.ethereumCorroborating);
    if (!Array.isArray(missingPositions.positions)) throw new Error('synthetic position fixture');
    missingPositions.positions.pop();
    await expectUnavailable(
      coordinator(missing).readCurrentAgreement(request()),
      'SOURCE_DATA_INVALID',
    );
  });

  it.each([
    [
      'unvalidated chain identity',
      (source: MutableRecord): void => {
        source.identityValidated = false;
      },
    ],
    [
      'noncanonical position',
      (source: MutableRecord): void => {
        source.position = '0300000000';
      },
    ],
    [
      'uint64 overflow',
      (source: MutableRecord): void => {
        source.position = '18446744073709551616';
      },
    ],
    [
      'zero checkpoint',
      (source: MutableRecord): void => {
        source.position = '0';
      },
    ],
    [
      'self-parent block',
      (source: MutableRecord): void => {
        source.parentHash = source.hash;
      },
    ],
    [
      'noncanonical uppercase EVM hash',
      (source: MutableRecord): void => {
        source.hash = `0x${'A'.repeat(64)}`;
      },
    ],
  ] as const)('rejects malformed source data: %s', async (_name, mutate) => {
    const value = harness();
    mutate(sourceRecord(value.readers.ethereumCorroborating));
    await expectUnavailable(
      coordinator(value).readCurrentAgreement(request()),
      'SOURCE_DATA_INVALID',
    );
  });

  it.each([
    ['stale retrieval', '2026-09-04T16:58:59.999Z'],
    ['future retrieval', '2026-09-04T17:00:00.001Z'],
  ] as const)('rejects %s', async (_name, retrievedAt) => {
    const value = harness();
    sourceRecord(value.readers.ethereumCorroborating).retrievedAt = retrievedAt;
    await expectUnavailable(coordinator(value).readCurrentAgreement(request()), 'SOURCE_STALE');
  });

  it('rejects wrong scope, incomplete/duplicate assets, and noncanonical amounts', async () => {
    const wrongScope = harness();
    responseRecord(wrongScope.readers.ethereumCorroborating).walletId =
      '33333333-3333-4333-8333-333333333333';
    await expectUnavailable(
      coordinator(wrongScope).readCurrentAgreement(request()),
      'SOURCE_DATA_INVALID',
    );

    const duplicate = harness();
    const duplicatePositions = positionRecords(duplicate.readers.ethereumCorroborating);
    duplicatePositions[1] = clone(duplicatePositions[0]!);
    await expectUnavailable(
      coordinator(duplicate).readCurrentAgreement(request()),
      'SOURCE_DATA_INVALID',
    );

    const noncanonical = harness();
    positionRecords(noncanonical.readers.ethereumCorroborating)[0]!.amountAtomic = '01';
    await expectUnavailable(
      coordinator(noncanonical).readCurrentAgreement(request()),
      'SOURCE_DATA_INVALID',
    );
  });

  it('rejects a SHA-shaped position ID that is not canonical for the request scope and asset', async () => {
    const value = harness();
    positionRecords(value.readers.ethereumCorroborating)[0]!.positionId = 'f'.repeat(64);
    await expectUnavailable(
      coordinator(value).readCurrentAgreement(request()),
      'SOURCE_DATA_INVALID',
    );
  });

  it('rejects accessor-backed, extra, custom-prototype, and aliased source payloads', async () => {
    const accessor = harness();
    let invoked = false;
    const accessorSource = sourceRecord(accessor.readers.ethereumCorroborating);
    Object.defineProperty(accessorSource, 'hash', {
      enumerable: true,
      get: () => {
        invoked = true;
        return ETHEREUM_BLOCK_HASH;
      },
    });
    await expectUnavailable(
      coordinator(accessor).readCurrentAgreement(request()),
      'SOURCE_DATA_INVALID',
    );
    expect(invoked).toBe(false);

    const extra = harness();
    responseRecord(extra.readers.ethereumCorroborating).endpoint = 'must-not-pass';
    await expectUnavailable(
      coordinator(extra).readCurrentAgreement(request()),
      'SOURCE_DATA_INVALID',
    );

    const custom = harness();
    custom.readers.ethereumCorroborating.response = Object.assign(
      Object.create({ inherited: true }) as MutableRecord,
      candidate(ETHEREUM_MAINNET_BALANCE_AGREEMENT_NETWORK_ID),
    );
    await expectUnavailable(
      coordinator(custom).readCurrentAgreement(request()),
      'SOURCE_DATA_INVALID',
    );

    const aliased = harness();
    aliased.readers.ethereumCorroborating.response = aliased.readers.ethereumPrimary.response;
    await expectUnavailable(
      coordinator(aliased).readCurrentAgreement(request()),
      'UNTRUSTED_SOURCE_IDENTITY',
    );
  });

  it('rejects corrupt, duplicate, aliased, and registry-unbound source configuration', () => {
    const corrupt = harness();
    expect(
      () =>
        new DormantMainnetBalanceTwoSourceAgreementCoordinator(
          { ...corrupt.registry, fingerprintSha256: 'f'.repeat(64) },
          corrupt.bindings,
          corrupt.clock,
        ),
    ).toThrow(new MainnetBalanceTwoSourceAgreementUnavailableError('INVALID_CONFIGURATION'));

    const duplicateReader = harness();
    duplicateReader.bindings[1] = {
      ...duplicateReader.bindings[1]!,
      reader: duplicateReader.bindings[0]!.reader,
    };
    expect(() => coordinator(duplicateReader)).toThrow(
      new MainnetBalanceTwoSourceAgreementUnavailableError('INVALID_CONFIGURATION'),
    );

    const unbound = harness();
    unbound.bindings[0] = { ...unbound.bindings[0]!, sourceId: 'synthetic-untrusted' };
    expect(() => coordinator(unbound)).toThrow(
      new MainnetBalanceTwoSourceAgreementUnavailableError('INVALID_CONFIGURATION'),
    );

    const duplicateFamilyContent = clone(registryContent()) as unknown as MutableRecord;
    const pairs = duplicateFamilyContent.pairs as MutableRecord[];
    const ethereum = pairs[0]!;
    const primary = ethereum.primary as MutableRecord;
    const corroborating = ethereum.corroborating as MutableRecord;
    corroborating.sourceFamilyId = primary.sourceFamilyId;
    expect(() => fingerprintMainnetBalanceSourcePairRegistryV1(duplicateFamilyContent)).toThrow(
      new MainnetBalanceTwoSourceAgreementUnavailableError('INVALID_CONFIGURATION'),
    );

    const duplicateIdContent = clone(registryContent()) as unknown as MutableRecord;
    const duplicateIdPairs = duplicateIdContent.pairs as MutableRecord[];
    const duplicateIdEthereum = duplicateIdPairs[0]!;
    const duplicateIdPrimary = duplicateIdEthereum.primary as MutableRecord;
    const duplicateIdCorroborating = duplicateIdEthereum.corroborating as MutableRecord;
    duplicateIdCorroborating.sourceId = duplicateIdPrimary.sourceId;
    expect(() => fingerprintMainnetBalanceSourcePairRegistryV1(duplicateIdContent)).toThrow(
      new MainnetBalanceTwoSourceAgreementUnavailableError('INVALID_CONFIGURATION'),
    );
  });

  it('captures only data methods and rejects reader/clock accessors or proxies without invoking traps', () => {
    const readerAccessor = harness();
    let readerGetterInvoked = false;
    const accessorReader = {} as MutableRecord;
    Object.defineProperty(accessorReader, 'readCurrent', {
      enumerable: true,
      get: () => {
        readerGetterInvoked = true;
        return async (): Promise<unknown> => undefined;
      },
    });
    readerAccessor.bindings[0] = {
      ...readerAccessor.bindings[0]!,
      reader: accessorReader as unknown as MainnetBalanceAgreementSourceBinding['reader'],
    };
    expect(() => coordinator(readerAccessor)).toThrow(
      new MainnetBalanceTwoSourceAgreementUnavailableError('INVALID_CONFIGURATION'),
    );
    expect(readerGetterInvoked).toBe(false);

    const clockAccessor = harness();
    let clockGetterInvoked = false;
    const accessorClock = {} as MutableRecord;
    Object.defineProperty(accessorClock, 'now', {
      enumerable: true,
      get: () => {
        clockGetterInvoked = true;
        return (): Date => new Date(NOW);
      },
    });
    clockAccessor.clock = accessorClock as unknown as MainnetBalanceAgreementClock;
    expect(() => coordinator(clockAccessor)).toThrow(
      new MainnetBalanceTwoSourceAgreementUnavailableError('INVALID_CONFIGURATION'),
    );
    expect(clockGetterInvoked).toBe(false);

    const proxyBinding = harness();
    let proxyTrapInvoked = false;
    const proxyReader = new Proxy(
      {},
      {
        get: () => {
          proxyTrapInvoked = true;
          return async (): Promise<unknown> => undefined;
        },
        getPrototypeOf: () => {
          proxyTrapInvoked = true;
          return Object.prototype;
        },
      },
    );
    proxyBinding.bindings[0] = {
      ...proxyBinding.bindings[0]!,
      reader: proxyReader as MainnetBalanceAgreementSourceBinding['reader'],
    };
    expect(() => coordinator(proxyBinding)).toThrow(
      new MainnetBalanceTwoSourceAgreementUnavailableError('INVALID_CONFIGURATION'),
    );
    expect(proxyTrapInvoked).toBe(false);

    const proxyMethodBinding = harness();
    let proxyMethodInvoked = false;
    const proxiedReadCurrent = new Proxy(async (): Promise<unknown> => undefined, {
      apply: () => {
        proxyMethodInvoked = true;
        return Promise.resolve(undefined);
      },
    });
    proxyMethodBinding.bindings[0] = {
      ...proxyMethodBinding.bindings[0]!,
      reader: { readCurrent: proxiedReadCurrent },
    };
    expect(() => coordinator(proxyMethodBinding)).toThrow(
      new MainnetBalanceTwoSourceAgreementUnavailableError('INVALID_CONFIGURATION'),
    );
    expect(proxyMethodInvoked).toBe(false);
  });

  it.each([
    ['not-yet-effective identity approval', '2026-09-04T15:59:59.999Z'],
    ['expired identity approval', EXPIRES_AT],
  ] as const)('fails before source access for %s', async (_name, now) => {
    const value = harness();
    value.clock = new SyntheticClock([new Date(now)]);
    await expectUnavailable(
      coordinator(value).readCurrentAgreement(request()),
      'UNTRUSTED_SOURCE_IDENTITY',
    );
    expect(totalReaderCalls(value)).toBe(0);
  });

  it('fails if source-pair approval expires while the agreement is being assembled', async () => {
    const value = harness();
    value.clock = new SyntheticClock([new Date(NOW), new Date(EXPIRES_AT)]);
    await expectUnavailable(
      coordinator(value).readCurrentAgreement(request()),
      'UNTRUSTED_SOURCE_IDENTITY',
    );
    expect(value.readers.ethereumPrimary.calls).toHaveLength(1);
    expect(value.readers.ethereumCorroborating.calls).toHaveLength(1);
  });

  it('rejects unsupported chains and non-finalized requests before invoking a source', async () => {
    const unsupported = harness();
    await expectUnavailable(
      coordinator(unsupported).readCurrentAgreement({
        ...request(),
        networkId: 'eip155:8453',
      } as BalanceIndexerReadRequest),
      'UNSUPPORTED_CHAIN',
    );
    expect(totalReaderCalls(unsupported)).toBe(0);

    const provisional = harness();
    await expectUnavailable(
      coordinator(provisional).readCurrentAgreement({
        ...request(),
        tier: 'PROVISIONAL',
        selector: 'latest',
      }),
      'INVALID_REQUEST',
    );
    expect(totalReaderCalls(provisional)).toBe(0);
  });

  it('sanitizes injected source failures and never exposes provider details', async () => {
    const value = harness();
    const sensitiveProviderDetail = ['https:', '', 'credential', 'synthetic-provider.invalid']
      .join('/')
      .replace('/synthetic-provider', '@synthetic-provider');
    value.readers.ethereumPrimary.error = new Error(sensitiveProviderDetail);
    const first = await expectUnavailable(
      coordinator(value).readCurrentAgreement(request()),
      'SOURCE_UNAVAILABLE',
    );
    const second = await expectUnavailable(
      coordinator(value).readCurrentAgreement(request()),
      'SOURCE_UNAVAILABLE',
    );
    expect(first).not.toBe(second);
    expect(first.message).not.toContain('credential');
    expect(JSON.stringify(first)).not.toContain('synthetic-provider');
  });

  it('rejects hostile requests and invalid or regressing clocks without invoking source readers', async () => {
    const accessor = harness();
    let invoked = false;
    const hostileRequest = { ...request() } as MutableRecord;
    Object.defineProperty(hostileRequest, 'walletId', {
      enumerable: true,
      get: () => {
        invoked = true;
        return WALLET_ID;
      },
    });
    await expectUnavailable(
      coordinator(accessor).readCurrentAgreement(
        hostileRequest as unknown as BalanceIndexerReadRequest,
      ),
      'INVALID_REQUEST',
    );
    expect(invoked).toBe(false);
    expect(totalReaderCalls(accessor)).toBe(0);

    const proxyRequestHarness = harness();
    let proxyTrapInvoked = false;
    const proxyRequest = new Proxy(request(), {
      get: () => {
        proxyTrapInvoked = true;
        return undefined;
      },
      getOwnPropertyDescriptor: () => {
        proxyTrapInvoked = true;
        return undefined;
      },
      getPrototypeOf: () => {
        proxyTrapInvoked = true;
        return Object.prototype;
      },
      ownKeys: () => {
        proxyTrapInvoked = true;
        return [];
      },
    });
    await expectUnavailable(
      coordinator(proxyRequestHarness).readCurrentAgreement(proxyRequest),
      'INVALID_REQUEST',
    );
    expect(proxyTrapInvoked).toBe(false);
    expect(totalReaderCalls(proxyRequestHarness)).toBe(0);

    const invalid = harness();
    invalid.clock = new SyntheticClock([new Date(Number.NaN)]);
    await expectUnavailable(
      coordinator(invalid).readCurrentAgreement(request()),
      'INVALID_CONFIGURATION',
    );
    expect(totalReaderCalls(invalid)).toBe(0);

    const regressing = harness();
    regressing.clock = new SyntheticClock([new Date(NOW), new Date('2026-09-04T16:59:59.999Z')]);
    await expectUnavailable(
      coordinator(regressing).readCurrentAgreement(request()),
      'INVALID_CONFIGURATION',
    );
  });
});
