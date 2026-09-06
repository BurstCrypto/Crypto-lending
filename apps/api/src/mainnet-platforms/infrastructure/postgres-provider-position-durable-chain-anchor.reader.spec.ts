import type { PostgresService } from '../../infrastructure/database/postgres.service';
import {
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE,
  type ReadProviderPositionDurableChainAnchorRequestV1,
} from '../application/ports/provider-position-durable-chain-anchor-reader.port';
import {
  PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_ERROR,
  PostgresProviderPositionDurableChainAnchorReader,
} from './postgres-provider-position-durable-chain-anchor.reader';

const ACCOUNT_ID = '99999999-9999-4999-8999-999999999999';
const WALLET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const HASH_A = `0x${'1'.repeat(64)}`;
const HASH_B = `0x${'2'.repeat(64)}`;
const SHA256 = 'a'.repeat(64);
const OBSERVED_AT = '2026-09-05T16:59:50.000Z';
const CAPTURED_AT = '2026-09-05T17:00:00.000Z';
const EVALUATED_AT = '2026-09-05T17:00:01.000Z';
const DEADLINE_AT = '2026-09-05T17:00:05.000Z';

const ROW_COLUMNS = Object.freeze([
  'reader_version',
  'assessment_use',
  'may_authorize_financial_action',
  'may_persist',
  'network_id',
  'continuity_floor_json',
  'chain_anchor_json',
  'assessed_at',
  'identity_status',
  'progression_status',
  'finality_status',
] as const);

function frozenNull<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as object, value)) as Readonly<T>;
}

function ethereumRequest(
  overrides: Partial<ReadProviderPositionDurableChainAnchorRequestV1> = {},
): ReadProviderPositionDurableChainAnchorRequestV1 {
  return frozenNull({
    readerVersion: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READER_VERSION,
    use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    accountId: ACCOUNT_ID,
    correlationId: 'provider-position-anchor-ethereum-1',
    candidateFingerprintSha256: SHA256,
    targetId: 'ethereum-target-1',
    walletId: WALLET_ID,
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
    networkId: ETHEREUM,
    sourceFamilyId: 'ethereum-rpc-family-a',
    sourceId: 'ethereum-rpc-primary',
    sourceKind: 'RPC' as const,
    sourceObservationId: 'ethereum-block-50000001',
    continuityFloor: Object.freeze({
      kind: 'EVM_BLOCK' as const,
      blockNumber: '50000000',
      blockHash: HASH_A,
    }),
    chainAnchor: Object.freeze({
      kind: 'EVM_BLOCK' as const,
      blockNumber: '50000001',
      blockHash: HASH_B,
    }),
    observedAt: OBSERVED_AT,
    capturedAt: CAPTURED_AT,
    evaluatedAt: EVALUATED_AT,
    deadlineAt: DEADLINE_AT,
    signal: new AbortController().signal,
    ...overrides,
  }) as ReadProviderPositionDurableChainAnchorRequestV1;
}

function solanaRequest(
  overrides: Partial<ReadProviderPositionDurableChainAnchorRequestV1> = {},
): ReadProviderPositionDurableChainAnchorRequestV1 {
  return frozenNull({
    ...ethereumRequest(),
    correlationId: 'provider-position-anchor-solana-1',
    targetId: 'solana-target-1',
    providerId: 'jupiter',
    protocolId: 'jupiter-lend',
    marketId: 'JupiterUsdcEarnVault',
    networkId: SOLANA,
    sourceFamilyId: 'solana-rpc-family-a',
    sourceId: 'solana-rpc-primary',
    sourceObservationId: 'solana-slot-441990796',
    continuityFloor: Object.freeze({
      kind: 'SOLANA_SLOT' as const,
      slot: '441990700',
      root: '441990699',
    }),
    chainAnchor: Object.freeze({
      kind: 'SOLANA_SLOT' as const,
      slot: '441990796',
      root: '441990700',
    }),
    signal: new AbortController().signal,
    ...overrides,
  }) as ReadProviderPositionDurableChainAnchorRequestV1;
}

function rowFor(request: ReadProviderPositionDurableChainAnchorRequestV1): Record<string, unknown> {
  return {
    reader_version: 1,
    assessment_use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
    may_authorize_financial_action: false,
    may_persist: false,
    network_id: request.networkId,
    continuity_floor_json: JSON.stringify(request.continuityFloor),
    chain_anchor_json: JSON.stringify(request.chainAnchor),
    assessed_at: request.capturedAt,
    identity_status: 'VERIFIED',
    progression_status: 'CURRENT',
    finality_status: 'HEALTHY',
  };
}

function fixture(rows: readonly Record<string, unknown>[]): Readonly<{
  postgres: {
    queryWithCancellation: ReturnType<typeof jest.fn>;
    query: ReturnType<typeof jest.fn>;
    withTransaction: ReturnType<typeof jest.fn>;
    recordProviderPositionChainAnchorEvidence: ReturnType<typeof jest.fn>;
    invalidateProviderPositionChainAnchorEvidence: ReturnType<typeof jest.fn>;
  };
  query: ReturnType<typeof jest.fn>;
  forbidden: readonly ReturnType<typeof jest.fn>[];
  reader: PostgresProviderPositionDurableChainAnchorReader;
}> {
  const query = jest.fn().mockResolvedValue({ rows });
  const forbidden = Object.freeze([jest.fn(), jest.fn(), jest.fn(), jest.fn()] as const);
  const postgres = {
    queryWithCancellation: query,
    query: forbidden[0],
    withTransaction: forbidden[1],
    recordProviderPositionChainAnchorEvidence: forbidden[2],
    invalidateProviderPositionChainAnchorEvidence: forbidden[3],
  };
  const reader = new PostgresProviderPositionDurableChainAnchorReader(
    postgres as unknown as PostgresService,
  );
  return { postgres, query, forbidden, reader };
}

function expectSanitized(operation: Promise<unknown>): Promise<void> {
  return operation.then(
    () => {
      throw new Error('expected the operation to reject');
    },
    (error: unknown) => {
      expect(error).toBe(PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_ERROR);
      expect(Object.isFrozen(error)).toBe(true);
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain('secret');
    },
  );
}

function expectSanitizedThrow(operation: () => unknown): void {
  let captured: unknown;
  try {
    operation();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBe(PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_ERROR);
  expect(Object.isFrozen(captured)).toBe(true);
  expect(captured).not.toHaveProperty('cause');
}

describe('PostgresProviderPositionDurableChainAnchorReader', () => {
  it.each([
    ['Ethereum', ethereumRequest()],
    ['Solana', solanaRequest()],
  ] as const)(
    'issues one exact cancellable migration-0029 read and authenticates the %s capability',
    async (_name, request) => {
      const test = fixture([rowFor(request)]);
      expect(test.query).not.toHaveBeenCalled();

      const capability = await test.reader.readAnchor(request);

      expect(test.query).toHaveBeenCalledTimes(1);
      const [sql, values, signal] = test.query.mock.calls[0] as [
        string,
        readonly unknown[],
        AbortSignal,
      ];
      expect(sql).toBe(
        `SELECT
  assessment.reader_version,
  assessment.assessment_use,
  assessment.may_authorize_financial_action,
  assessment.may_persist,
  assessment.network_id,
  assessment.continuity_floor::text AS continuity_floor_json,
  assessment.chain_anchor::text AS chain_anchor_json,
  pg_catalog.to_char(
    assessment.assessed_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS assessed_at,
  assessment.identity_status,
  assessment.progression_status,
  assessment.finality_status
FROM read_provider_position_chain_anchor_evidence(
  $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text,
  $8::jsonb, $9::jsonb, $10::timestamptz, $11::timestamptz,
  $12::timestamptz, $13::timestamptz
) AS assessment`,
      );
      expect(values).toEqual([
        request.accountId,
        request.walletId,
        request.networkId,
        request.sourceFamilyId,
        request.sourceId,
        request.sourceKind,
        request.sourceObservationId,
        JSON.stringify(request.continuityFloor),
        JSON.stringify(request.chainAnchor),
        request.observedAt,
        request.capturedAt,
        request.evaluatedAt,
        request.deadlineAt,
      ]);
      expect(signal).toBe(request.signal);
      for (const forbidden of test.forbidden) expect(forbidden).not.toHaveBeenCalled();
      expect(capability).toEqual({
        readerVersion: 1,
        use: PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_ASSESSMENT_USE,
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        networkId: request.networkId,
        continuityFloor: request.continuityFloor,
        chainAnchor: request.chainAnchor,
        assessedAt: request.capturedAt,
        identityStatus: 'VERIFIED',
        progressionStatus: 'CURRENT',
        finalityStatus: 'HEALTHY',
      });
      expect(Object.getPrototypeOf(capability as object)).toBeNull();
      expect(Object.isFrozen(capability)).toBe(true);
      expect(Object.isFrozen((capability as { continuityFloor: object }).continuityFloor)).toBe(
        true,
      );
      expect(test.reader.verifyAnchor(capability, request)).toBe(true);
      expect(test.reader.verifyAnchor(frozenNull({}), request)).toBe(false);
      expect(test.reader.verifyAnchor(structuredClone(capability), request)).toBe(false);
      expect(test.reader.verifyAnchor(capability, frozenNull({ ...request }))).toBe(false);
      expect(fixture([rowFor(request)]).reader.verifyAnchor(capability, request)).toBe(false);
    },
  );

  it('captures the query method without I/O and ignores later member replacement', async () => {
    const request = ethereumRequest();
    const original = jest.fn().mockResolvedValue({ rows: [rowFor(request)] });
    const replacement = jest.fn().mockRejectedValue(new Error('secret replacement'));
    const postgres = { queryWithCancellation: original };
    const reader = new PostgresProviderPositionDurableChainAnchorReader(
      postgres as unknown as PostgresService,
    );
    expect(original).not.toHaveBeenCalled();
    postgres.queryWithCancellation = replacement;

    await expect(reader.readAnchor(request)).resolves.toBeDefined();
    expect(original).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
  });

  it('rejects accessor, proxied, and missing query methods during construction without I/O', () => {
    const getter = jest.fn(() => jest.fn());
    const accessor = {};
    Object.defineProperty(accessor, 'queryWithCancellation', {
      configurable: true,
      enumerable: true,
      get: getter,
    });
    expectSanitizedThrow(
      () =>
        new PostgresProviderPositionDurableChainAnchorReader(
          accessor as unknown as PostgresService,
        ),
    );
    expect(getter).not.toHaveBeenCalled();

    expectSanitizedThrow(
      () =>
        new PostgresProviderPositionDurableChainAnchorReader(
          new Proxy({ queryWithCancellation: jest.fn() }, {}) as unknown as PostgresService,
        ),
    );
    expectSanitizedThrow(
      () =>
        new PostgresProviderPositionDurableChainAnchorReader({
          queryWithCancellation: new Proxy(jest.fn(), {}),
        } as unknown as PostgresService),
    );
    expectSanitizedThrow(
      () => new PostgresProviderPositionDurableChainAnchorReader({} as PostgresService),
    );
  });

  it.each([
    ['an object-prototype request', () => Object.freeze({ ...ethereumRequest() })],
    ['a mutable request', () => Object.assign(Object.create(null) as object, ethereumRequest())],
    ['a proxied request', () => new Proxy(ethereumRequest(), {})],
    [
      'an unexpected request field',
      () => frozenNull({ ...ethereumRequest(), unexpectedAuthority: true }),
    ],
    ['an unsupported reader version', () => ethereumRequest({ readerVersion: 2 as 1 })],
    ['persistence authority', () => ethereumRequest({ mayPersist: true as false })],
    ['financial authority', () => ethereumRequest({ mayAuthorizeFinancialAction: true as false })],
    [
      'a malformed account UUID',
      () =>
        ethereumRequest({
          accountId:
            '99999999-9999-1999-8999-999999999999' as ReadProviderPositionDurableChainAnchorRequestV1['accountId'],
        }),
    ],
    [
      'a non-mainnet launch network',
      () => ethereumRequest({ networkId: 'eip155:8453' as typeof ETHEREUM }),
    ],
    [
      'a caller-chosen source observation id',
      () => ethereumRequest({ sourceObservationId: 'request-wallet-specific-1' }),
    ],
    [
      'a regressing continuity anchor',
      () =>
        ethereumRequest({
          continuityFloor: Object.freeze({
            kind: 'EVM_BLOCK',
            blockNumber: '50000002',
            blockHash: HASH_A,
          }),
        }),
    ],
    [
      'a zero Ethereum block hash',
      () =>
        ethereumRequest({
          chainAnchor: Object.freeze({
            kind: 'EVM_BLOCK',
            blockNumber: '50000001',
            blockHash: `0x${'0'.repeat(64)}`,
          }),
        }),
    ],
    [
      'an uppercase Ethereum block hash',
      () =>
        ethereumRequest({
          chainAnchor: Object.freeze({
            kind: 'EVM_BLOCK',
            blockNumber: '50000001',
            blockHash: `0x${'A'.repeat(64)}`,
          }),
        }),
    ],
    [
      'an overflowing Ethereum block number',
      () =>
        ethereumRequest({
          chainAnchor: Object.freeze({
            kind: 'EVM_BLOCK',
            blockNumber:
              '115792089237316195423570985008687907853269984665640564039457584007913129639936',
            blockHash: HASH_B,
          }),
        }),
    ],
    [
      'a wrong-chain anchor shape',
      () =>
        ethereumRequest({
          chainAnchor: Object.freeze({
            kind: 'SOLANA_SLOT',
            slot: '50000001',
            root: '50000000',
          }) as ReadProviderPositionDurableChainAnchorRequestV1['chainAnchor'],
        }),
    ],
    [
      'a Solana root above its slot',
      () =>
        solanaRequest({
          chainAnchor: Object.freeze({
            kind: 'SOLANA_SLOT',
            slot: '441990796',
            root: '441990797',
          }),
        }),
    ],
    [
      'an observed-at time after capture',
      () => ethereumRequest({ observedAt: '2026-09-05T17:00:00.001Z' }),
    ],
    [
      'a captured-at time after evaluation',
      () => ethereumRequest({ capturedAt: '2026-09-05T17:00:01.001Z' }),
    ],
    ['a deadline at evaluation time', () => ethereumRequest({ deadlineAt: EVALUATED_AT })],
    [
      'an excessive deadline span',
      () => ethereumRequest({ deadlineAt: '2026-09-05T17:00:31.001Z' }),
    ],
    [
      'a pre-aborted signal',
      () => {
        const controller = new AbortController();
        controller.abort();
        return ethereumRequest({ signal: controller.signal });
      },
    ],
  ])('rejects %s before SQL', async (_name, createRequest) => {
    const test = fixture([]);
    await expectSanitized(
      test.reader.readAnchor(createRequest() as ReadProviderPositionDurableChainAnchorRequestV1),
    );
    expect(test.query).not.toHaveBeenCalled();
  });

  it('rejects an accessor request field without invoking it or issuing SQL', async () => {
    const mutable = Object.assign(Object.create(null) as object, ethereumRequest()) as Record<
      string,
      unknown
    >;
    const getter = jest.fn(() => ACCOUNT_ID);
    Object.defineProperty(mutable, 'accountId', { enumerable: true, get: getter });
    Object.freeze(mutable);
    const test = fixture([]);

    await expectSanitized(
      test.reader.readAnchor(mutable as unknown as ReadProviderPositionDurableChainAnchorRequestV1),
    );
    expect(getter).not.toHaveBeenCalled();
    expect(test.query).not.toHaveBeenCalled();
  });

  it.each([
    ['no row', []],
    ['multiple rows', [rowFor(ethereumRequest()), rowFor(ethereumRequest())]],
    [
      'an unexpected row column',
      [{ ...rowFor(ethereumRequest()), evidence_fingerprint_sha256: SHA256 }],
    ],
    [
      'a custom-prototype row',
      [Object.assign(Object.create({ poisoned: true }) as object, rowFor(ethereumRequest()))],
    ],
    ['malformed anchor JSON', [{ ...rowFor(ethereumRequest()), chain_anchor_json: '{' }]],
    [
      'an extra anchor JSON field',
      [
        {
          ...rowFor(ethereumRequest()),
          chain_anchor_json: JSON.stringify({
            ...ethereumRequest().chainAnchor,
            walletId: WALLET_ID,
          }),
        },
      ],
    ],
    [
      'an authority-bearing status',
      [{ ...rowFor(ethereumRequest()), may_authorize_financial_action: true }],
    ],
    [
      'the wrong assessment use',
      [{ ...rowFor(ethereumRequest()), assessment_use: 'UNTRUSTED_ASSESSMENT' }],
    ],
    ['the wrong returned network', [{ ...rowFor(ethereumRequest()), network_id: SOLANA }]],
    ['a failed identity status', [{ ...rowFor(ethereumRequest()), identity_status: 'FAILED' }]],
    ['a stale progression status', [{ ...rowFor(ethereumRequest()), progression_status: 'STALE' }]],
    [
      'an unhealthy finality status',
      [{ ...rowFor(ethereumRequest()), finality_status: 'STALLED' }],
    ],
    [
      'a noncanonical database timestamp',
      [{ ...rowFor(ethereumRequest()), assessed_at: '2026-09-05T17:00:00Z' }],
    ],
    [
      'an assessment before observation',
      [{ ...rowFor(ethereumRequest()), assessed_at: '2026-09-05T16:59:49.999Z' }],
    ],
    [
      'an assessment after capture',
      [{ ...rowFor(ethereumRequest()), assessed_at: '2026-09-05T17:00:00.001Z' }],
    ],
    [
      'a mismatched returned anchor',
      [
        {
          ...rowFor(ethereumRequest()),
          chain_anchor_json: JSON.stringify({
            kind: 'EVM_BLOCK',
            blockNumber: '50000001',
            blockHash: HASH_A,
          }),
        },
      ],
    ],
  ])('fails closed on %s', async (_name, rows) => {
    const request = ethereumRequest();
    const test = fixture(rows as readonly Record<string, unknown>[]);

    await expectSanitized(test.reader.readAnchor(request));
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('rejects accessor database fields without invoking them', async () => {
    const request = ethereumRequest();
    const returned = rowFor(request);
    const getter = jest.fn(() => 1);
    Object.defineProperty(returned, 'reader_version', { enumerable: true, get: getter });
    const test = fixture([returned]);

    await expectSanitized(test.reader.readAnchor(request));
    expect(getter).not.toHaveBeenCalled();
  });

  it('rejects a result when the exact admission signal aborts while SQL settles', async () => {
    const controller = new AbortController();
    const request = ethereumRequest({ signal: controller.signal });
    const test = fixture([rowFor(request)]);
    test.query.mockImplementation(async () => {
      controller.abort();
      return { rows: [rowFor(request)] };
    });

    await expectSanitized(test.reader.readAnchor(request));
    expect(test.query.mock.calls[0]?.[2]).toBe(controller.signal);
  });

  it('maps database failures to one fixed cause-free error', async () => {
    const request = ethereumRequest();
    const test = fixture([]);
    const lookalike = Object.assign(
      new Error('Provider position durable chain anchor read failed'),
      {
        name: 'ProviderPositionDurableChainAnchorReadError',
        code: 'PROVIDER_POSITION_DURABLE_CHAIN_ANCHOR_READ_FAILED',
        privateDetail: 'secret database address and SQL details',
      },
    );
    test.query.mockImplementation(() => Promise.reject(lookalike));

    await expectSanitized(test.reader.readAnchor(request));
    expect(test.query).toHaveBeenCalledTimes(1);
  });

  it('pins the exact returned row column contract', () => {
    expect(Object.keys(rowFor(ethereumRequest())).sort()).toEqual([...ROW_COLUMNS].sort());
  });
});
