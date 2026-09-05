import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { linkSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';

// @ts-expect-error The audited shared local-file fault seam is an ESM JavaScript module.
import * as secureLocalFileModule from '../infra/shared/read-secure-local-file.mjs';
import {
  evaluateJobEnvelopeRolloutPreflightCli,
  formatJobEnvelopeRolloutPreflightCliError,
  jobEnvelopeRolloutPreflightCliErrorCode,
  loadJobEnvelopeRolloutSnapshot,
  MAX_JOB_ENVELOPE_SNAPSHOT_BYTES,
  MAX_JOB_ENVELOPE_SNAPSHOT_ROWS,
  parseJobEnvelopeRolloutPreflightArguments,
  snapshotRows,
  type JobEnvelopeSnapshotReader,
  type PreflightCliErrorCode,
} from './job-envelope-rollout-preflight';

const SCRIPT_PATH = resolve(__dirname, 'job-envelope-rollout-preflight.ts');
const REPOSITORY_ROOT = resolve(__dirname, '..');
const EMPTY_SNAPSHOT = Buffer.from('{"schemaVersion":1,"rows":[]}\n', 'utf8');
const readSecureLocalFileForTest = secureLocalFileModule.readSecureLocalFileForTest as (
  filePath: string,
  maximumBytes: number,
  afterFirstRead: () => void,
) => Uint8Array;

function fixtureDirectory(context: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'job-envelope-preflight-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function capturedCode(operation: () => unknown): PreflightCliErrorCode {
  let thrown = false;
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    thrown = true;
    error = caught;
  }
  assert.equal(thrown, true);
  return jobEnvelopeRolloutPreflightCliErrorCode(error);
}

function runCli(...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT_PATH, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function errorLine(errorCode: PreflightCliErrorCode): string {
  return `${JSON.stringify({ schemaVersion: 1, status: 'error', errorCode })}\n`;
}

test('argument and error classification are exact and hostile-value safe', () => {
  assert.equal(parseJobEnvelopeRolloutPreflightArguments(['snapshot.json']), 'snapshot.json');
  assert.equal(
    capturedCode(() => parseJobEnvelopeRolloutPreflightArguments([])),
    'PREFLIGHT_ARGUMENT_INVALID',
  );
  assert.equal(
    capturedCode(() => parseJobEnvelopeRolloutPreflightArguments(['one.json', 'two.json'])),
    'PREFLIGHT_ARGUMENT_INVALID',
  );
  assert.equal(
    capturedCode(() => parseJobEnvelopeRolloutPreflightArguments(['--snapshot.json'])),
    'PREFLIGHT_ARGUMENT_INVALID',
  );

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(jobEnvelopeRolloutPreflightCliErrorCode(revoked.proxy), 'PREFLIGHT_FAILED');
  assert.equal(
    formatJobEnvelopeRolloutPreflightCliError(revoked.proxy),
    errorLine('PREFLIGHT_FAILED'),
  );
});

test('strict snapshot parsing rejects BOM, malformed UTF-8, and escaped duplicate keys', (context) => {
  const directory = fixtureDirectory(context);
  const cases = [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), EMPTY_SNAPSHOT]),
    Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d]),
    Buffer.from('{"schemaVersion":1,"schema\\u0056ersion":1,"rows":[]}', 'utf8'),
    Buffer.from('{"schemaVersion":1,"rows":[{"payload":{"id":1,"\\u0069d":2}}]}', 'utf8'),
  ];

  for (const [index, bytes] of cases.entries()) {
    const path = join(directory, `invalid-${index}.json`);
    writeFileSync(path, bytes);
    assert.equal(
      capturedCode(() => loadJobEnvelopeRolloutSnapshot(path)),
      'SNAPSHOT_JSON_INVALID',
    );
  }
});

test('snapshot contract is exact and caps the materialized row set', () => {
  assert.deepEqual(snapshotRows({ schemaVersion: 1, rows: [] }), []);
  for (const snapshot of [
    { schemaVersion: 2, rows: [] },
    { schemaVersion: 1, rows: [], extra: 'not-allowed' },
    {
      schemaVersion: 1,
      rows: Array.from({ length: MAX_JOB_ENVELOPE_SNAPSHOT_ROWS + 1 }, () => null),
    },
  ]) {
    assert.equal(
      capturedCode(() => snapshotRows(snapshot)),
      'SNAPSHOT_CONTRACT_INVALID',
    );
  }
});

test('secure snapshot reads reject oversized and mid-read-mutated files', (context) => {
  const directory = fixtureDirectory(context);
  const oversized = join(directory, 'oversized.json');
  writeFileSync(oversized, EMPTY_SNAPSHOT);
  truncateSync(oversized, MAX_JOB_ENVELOPE_SNAPSHOT_BYTES + 1);
  assert.equal(
    capturedCode(() => loadJobEnvelopeRolloutSnapshot(oversized)),
    'SNAPSHOT_READ_FAILED',
  );

  const changing = join(directory, 'changing.json');
  writeFileSync(changing, EMPTY_SNAPSHOT);
  const unstableReader: JobEnvelopeSnapshotReader = (filePath, maximumBytes) =>
    readSecureLocalFileForTest(filePath, maximumBytes, () => {
      writeFileSync(changing, '{"schemaVersion":1,"rows":[null]}\n', 'utf8');
    });
  assert.equal(
    capturedCode(() => loadJobEnvelopeRolloutSnapshot(changing, unstableReader)),
    'SNAPSHOT_READ_FAILED',
  );
});

test('single-link enforcement rejects hard-linked snapshots with fixed CLI output', (context) => {
  const directory = fixtureDirectory(context);
  const target = join(directory, 'target.json');
  const linked = join(directory, 'linked.json');
  writeFileSync(target, EMPTY_SNAPSHOT);
  try {
    linkSync(target, linked);
  } catch (error) {
    context.skip(`Hard links are unavailable on this host: ${String(error)}`);
    return;
  }

  assert.equal(
    capturedCode(() => loadJobEnvelopeRolloutSnapshot(linked)),
    'SNAPSHOT_READ_FAILED',
  );
  const result = runCli(linked);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, errorLine('SNAPSHOT_READ_FAILED'));
  assert.equal(result.stderr.includes(linked), false);
});

test('CLI success and incompatibility exits are deterministic and local', (context) => {
  const directory = fixtureDirectory(context);
  const compatible = join(directory, 'compatible.json');
  const incompatible = join(directory, 'incompatible.json');
  writeFileSync(compatible, EMPTY_SNAPSHOT);
  writeFileSync(incompatible, '{"schemaVersion":1,"rows":[null]}\n', 'utf8');

  const evaluated = evaluateJobEnvelopeRolloutPreflightCli([compatible]);
  assert.equal(evaluated.exitCode, 0);
  assert.deepEqual(JSON.parse(evaluated.stdout), {
    schemaVersion: 1,
    scannedRows: 0,
    compatibleRows: 0,
    incompatibleRows: 0,
    legacyRows: 0,
    reasonCounts: {},
    rows: [],
  });

  const success = runCli(compatible);
  assert.equal(success.status, 0);
  assert.equal(success.stderr, '');
  assert.deepEqual(JSON.parse(success.stdout), JSON.parse(evaluated.stdout));

  const refused = runCli(incompatible);
  assert.equal(refused.status, 2);
  assert.equal(refused.stderr, '');
  assert.equal((JSON.parse(refused.stdout) as { incompatibleRows: unknown }).incompatibleRows, 1);
});

test('CLI JSON failures disclose only the fixed error contract', (context) => {
  const directory = fixtureDirectory(context);
  const path = join(directory, 'operator-secret.json');
  writeFileSync(path, '{"schemaVersion":1,"rows":[],"r\\u006fws":["customer-secret"]}', 'utf8');

  const result = runCli(path);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, errorLine('SNAPSHOT_JSON_INVALID'));
  assert.equal(result.stderr.includes('operator-secret'), false);
  assert.equal(result.stderr.includes('customer-secret'), false);

  const missingArgument = runCli();
  assert.equal(missingArgument.status, 1);
  assert.equal(missingArgument.stdout, '');
  assert.equal(missingArgument.stderr, errorLine('PREFLIGHT_ARGUMENT_INVALID'));
});
