import { readFileSync } from 'node:fs';

import {
  JOB_ENVELOPE_ROLLOUT_PREFLIGHT_SCHEMA_VERSION,
  runJobEnvelopeRolloutPreflight,
} from '../apps/api/src/infrastructure/outbox/job-envelope-rollout-preflight';

type PreflightCliErrorCode =
  | 'PREFLIGHT_ARGUMENT_INVALID'
  | 'SNAPSHOT_READ_FAILED'
  | 'SNAPSHOT_JSON_INVALID'
  | 'SNAPSHOT_CONTRACT_INVALID'
  | 'PREFLIGHT_FAILED';

function fail(errorCode: PreflightCliErrorCode): never {
  process.stderr.write(
    `${JSON.stringify({
      schemaVersion: JOB_ENVELOPE_ROLLOUT_PREFLIGHT_SCHEMA_VERSION,
      status: 'error',
      errorCode,
    })}\n`,
  );
  process.exit(1);
}

function snapshotRows(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('SNAPSHOT_CONTRACT_INVALID');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== 2 ||
    !Object.hasOwn(descriptors, 'schemaVersion') ||
    !Object.hasOwn(descriptors, 'rows')
  ) {
    return fail('SNAPSHOT_CONTRACT_INVALID');
  }
  const schemaVersionDescriptor = descriptors.schemaVersion;
  const rowsDescriptor = descriptors.rows;
  if (
    !schemaVersionDescriptor ||
    !('value' in schemaVersionDescriptor) ||
    schemaVersionDescriptor.value !== JOB_ENVELOPE_ROLLOUT_PREFLIGHT_SCHEMA_VERSION ||
    !rowsDescriptor ||
    !('value' in rowsDescriptor) ||
    !Array.isArray(rowsDescriptor.value)
  ) {
    return fail('SNAPSHOT_CONTRACT_INVALID');
  }
  return rowsDescriptor.value as unknown[];
}

const [snapshotPath, ...unexpectedArguments] = process.argv.slice(2);
if (!snapshotPath || unexpectedArguments.length > 0) fail('PREFLIGHT_ARGUMENT_INVALID');

let source: string;
try {
  source = readFileSync(snapshotPath, 'utf8');
} catch {
  fail('SNAPSHOT_READ_FAILED');
}

let snapshot: unknown;
try {
  snapshot = JSON.parse(source) as unknown;
} catch {
  fail('SNAPSHOT_JSON_INVALID');
}

try {
  const report = runJobEnvelopeRolloutPreflight(snapshotRows(snapshot));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.incompatibleRows > 0) process.exitCode = 2;
} catch {
  fail('PREFLIGHT_FAILED');
}
