import { MAX_JOB_MESSAGE_BYTES } from './job-message-policy';
import { runJobEnvelopeRolloutPreflight } from './job-envelope-rollout-preflight';

const ids = {
  correlation: '00000000-0000-4000-8000-000000000001',
  currentJob: '00000000-0000-4000-8000-000000000002',
  legacyJob: 'legacy-job-1',
} as const;

function envelope(payload: unknown, correlated = true): Record<string, unknown> {
  return {
    id: correlated ? ids.currentJob : ids.legacyJob,
    kind: 'ledger.journal-committed',
    version: 1,
    occurredAt: '2026-08-21T20:00:00.000Z',
    ...(correlated ? { correlation: { correlationId: ids.correlation } } : {}),
    payload,
  };
}

function row(
  id: string,
  payload: unknown,
  messageAttributes: unknown = {},
): Record<string, unknown> {
  return { id, queueName: 'jobs', payload, messageAttributes };
}

function nestedPayload(objectCount: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < objectCount; index += 1) value = { child: value };
  return value;
}

function attributes(count: number): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`custom.${index}`, `value-${index}`]),
  );
}

describe('job envelope rollout preflight', () => {
  it('deterministically inventories compatible current and legacy rows', () => {
    const report = runJobEnvelopeRolloutPreflight([
      row('z-current', envelope({ journalId: 'journal-1' })),
      row('a-legacy', envelope({ journalId: 'journal-2' }, false)),
    ]);

    expect(report).toMatchObject({
      schemaVersion: 1,
      scannedRows: 2,
      compatibleRows: 2,
      incompatibleRows: 0,
      legacyRows: 1,
      reasonCounts: {},
    });
    expect(report.rows.map(({ rowId }) => rowId)).toEqual(['a-legacy', 'z-current']);
    expect(report.rows[0]).toMatchObject({
      envelopeShape: 'legacy-correlationless',
      normalizedLegacyCorrelation: true,
      status: 'compatible',
      reasons: [],
    });
    expect(report.rows[1]).toMatchObject({
      envelopeShape: 'correlated',
      normalizedLegacyCorrelation: false,
      status: 'compatible',
      reasons: [],
    });
  });

  it('reports a legacy row that consumes the former seven-attribute capacity', () => {
    const report = runJobEnvelopeRolloutPreflight([
      row('legacy-seven', envelope({}, false), attributes(7)),
    ]);

    expect(report.incompatibleRows).toBe(1);
    expect(report.reasonCounts).toEqual({ LEGACY_SEVEN_ATTRIBUTE_ENVELOPE: 1 });
    expect(report.rows[0]).toMatchObject({
      customAttributeCount: 7,
      envelopeShape: 'legacy-correlationless',
      normalizedLegacyCorrelation: true,
      status: 'incompatible',
    });
  });

  it('reports case-insensitive collisions with every reserved correlation attribute', () => {
    const report = runJobEnvelopeRolloutPreflight([
      row('reserved', envelope({}), {
        CORRELATIONID: 'caller-root',
        JobId: 'caller-job',
        JOBKIND: 'caller-kind',
        jobversion: '99',
      }),
    ]);

    expect(report.rows[0]?.reasons).toEqual([
      {
        code: 'RESERVED_ATTRIBUTE_COLLISION',
        detail:
          'A stored custom attribute collides case-insensitively with correlated envelope metadata.',
        attributeNames: ['correlationId', 'jobId', 'jobKind', 'jobVersion'],
      },
    ]);
  });

  it('accepts projected JSON at depth 64 and rejects depth 65', () => {
    const report = runJobEnvelopeRolloutPreflight([
      row('depth-64', envelope(nestedPayload(63))),
      row('depth-65', envelope(nestedPayload(64))),
    ]);

    expect(report.rows.find(({ rowId }) => rowId === 'depth-64')?.status).toBe('compatible');
    expect(report.rows.find(({ rowId }) => rowId === 'depth-65')?.reasons).toEqual([
      {
        code: 'JSON_DEPTH_EXCEEDED',
        detail: 'Projected correlated job JSON exceeds depth 64.',
      },
    ]);
  });

  it('accepts 100,000 projected JSON nodes and rejects node 100,001', () => {
    // The correlated envelope and its fixed metadata consume eight JSON nodes.
    const report = runJobEnvelopeRolloutPreflight([
      row('nodes-100000', envelope(Array.from({ length: 99_992 }, () => 0))),
      row('nodes-100001', envelope(Array.from({ length: 99_993 }, () => 0))),
    ]);

    expect(report.rows.find(({ rowId }) => rowId === 'nodes-100000')?.status).toBe('compatible');
    expect(report.rows.find(({ rowId }) => rowId === 'nodes-100001')?.reasons).toEqual([
      {
        code: 'JSON_NODE_LIMIT_EXCEEDED',
        detail: 'Projected correlated job JSON exceeds 100000 nodes.',
      },
    ]);
  });

  it('accepts the exact SQS byte ceiling and reports one byte of missing headroom', () => {
    const baseline = runJobEnvelopeRolloutPreflight([row('size-baseline', envelope(''))]).rows[0]
      ?.projectedMessageBytes;
    expect(baseline).toBeDefined();

    const exactPayloadLength = MAX_JOB_MESSAGE_BYTES - (baseline as number);
    const report = runJobEnvelopeRolloutPreflight([
      row('size-exact', envelope('x'.repeat(exactPayloadLength))),
      row('size-over', envelope('x'.repeat(exactPayloadLength + 1))),
    ]);

    expect(report.rows.find(({ rowId }) => rowId === 'size-exact')).toMatchObject({
      status: 'compatible',
      projectedMessageBytes: MAX_JOB_MESSAGE_BYTES,
      messageHeadroomBytes: 0,
    });
    expect(report.rows.find(({ rowId }) => rowId === 'size-over')).toMatchObject({
      status: 'incompatible',
      projectedMessageBytes: MAX_JOB_MESSAGE_BYTES + 1,
      messageHeadroomBytes: -1,
      reasons: [
        {
          code: 'MESSAGE_SIZE_HEADROOM_INSUFFICIENT',
          detail:
            'Stored row has insufficient SQS byte headroom for the projected correlated envelope.',
        },
      ],
    });
  });

  it('rejects superseded or ambiguous envelope shapes without silently normalizing them', () => {
    const superseded = {
      ...envelope({}),
      correlationId: ids.correlation,
    };
    const report = runJobEnvelopeRolloutPreflight([
      row('superseded-top-level-correlation', superseded),
    ]);

    expect(report.rows[0]).toMatchObject({
      envelopeShape: 'unsupported',
      status: 'incompatible',
      normalizedLegacyCorrelation: false,
      reasons: [
        {
          code: 'ENVELOPE_SHAPE_UNSUPPORTED',
          detail:
            'Stored envelope keys do not exactly match the correlated or correlation-less legacy contract.',
        },
      ],
    });
    expect(superseded).toHaveProperty('correlationId', ids.correlation);
  });

  it('reports every incompatible row and leaves snapshot data unchanged', () => {
    const snapshot = [
      row('seven', envelope({}, false), attributes(7)),
      row('collision', envelope({}), { correlationId: 'spoofed' }),
      row('shape', { ...envelope({}), source: 'old-api' }),
    ];
    const before = JSON.stringify(snapshot);

    const first = runJobEnvelopeRolloutPreflight(snapshot);
    const second = runJobEnvelopeRolloutPreflight(snapshot);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ scannedRows: 3, compatibleRows: 0, incompatibleRows: 3 });
    expect(first.rows.map(({ rowId }) => rowId)).toEqual(['collision', 'seven', 'shape']);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('rejects a non-array snapshot and reports malformed entries deterministically', () => {
    expect(() => runJobEnvelopeRolloutPreflight({ rows: [] })).toThrow(
      'Job envelope preflight snapshot must be an array',
    );

    const report = runJobEnvelopeRolloutPreflight([null]);
    expect(report.rows).toEqual([
      {
        rowId: 'snapshot-row:0',
        envelopeShape: 'unsupported',
        status: 'incompatible',
        normalizedLegacyCorrelation: false,
        reasons: [
          {
            code: 'ROW_INVALID',
            detail:
              'Snapshot row must contain data-only id, queueName, payload, and messageAttributes.',
          },
        ],
      },
    ]);
  });
});
