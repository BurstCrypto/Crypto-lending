// @ts-expect-error The audited shared strict-JSON boundary is an ESM JavaScript module.
import * as strictJsonModule from '../infra/shared/parse-strict-json.mjs';
// @ts-expect-error The audited shared local-file boundary is an ESM JavaScript module.
import * as secureLocalFileModule from '../infra/shared/read-secure-local-file.mjs';

import {
  JOB_ENVELOPE_ROLLOUT_PREFLIGHT_SCHEMA_VERSION,
  runJobEnvelopeRolloutPreflight,
} from '../apps/api/src/infrastructure/outbox/job-envelope-rollout-preflight';

export const MAX_JOB_ENVELOPE_SNAPSHOT_BYTES = 32 * 1_024 * 1_024;
export const MAX_JOB_ENVELOPE_SNAPSHOT_ROWS = 10_000;

export type PreflightCliErrorCode =
  | 'PREFLIGHT_ARGUMENT_INVALID'
  | 'SNAPSHOT_READ_FAILED'
  | 'SNAPSHOT_JSON_INVALID'
  | 'SNAPSHOT_CONTRACT_INVALID'
  | 'PREFLIGHT_FAILED';

export interface JobEnvelopeRolloutPreflightCliResult {
  readonly exitCode: 0 | 2;
  readonly stdout: string;
}

export type JobEnvelopeSnapshotReader = (filePath: string, maximumBytes: number) => Uint8Array;

const parseStrictJsonBytes = strictJsonModule.parseStrictJsonBytes as (
  bytes: Uint8Array,
) => unknown;
const readSecureLocalFile = secureLocalFileModule.readSecureLocalFile as JobEnvelopeSnapshotReader;
const PREFLIGHT_CLI_ERROR_CODES = new Set<PreflightCliErrorCode>([
  'PREFLIGHT_ARGUMENT_INVALID',
  'SNAPSHOT_READ_FAILED',
  'SNAPSHOT_JSON_INVALID',
  'SNAPSHOT_CONTRACT_INVALID',
  'PREFLIGHT_FAILED',
]);

class JobEnvelopeRolloutPreflightCliError extends Error {
  constructor(readonly code: PreflightCliErrorCode) {
    super('Job envelope rollout preflight failed');
    this.name = 'JobEnvelopeRolloutPreflightCliError';
  }
}

function fail(errorCode: PreflightCliErrorCode): never {
  throw new JobEnvelopeRolloutPreflightCliError(errorCode);
}

export function jobEnvelopeRolloutPreflightCliErrorCode(error: unknown): PreflightCliErrorCode {
  try {
    if (Object.getPrototypeOf(error) !== JobEnvelopeRolloutPreflightCliError.prototype) {
      return 'PREFLIGHT_FAILED';
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !PREFLIGHT_CLI_ERROR_CODES.has(descriptor.value as PreflightCliErrorCode)
    ) {
      return 'PREFLIGHT_FAILED';
    }
    return descriptor.value as PreflightCliErrorCode;
  } catch {
    return 'PREFLIGHT_FAILED';
  }
}

export function formatJobEnvelopeRolloutPreflightCliError(error: unknown): string {
  return `${JSON.stringify({
    schemaVersion: JOB_ENVELOPE_ROLLOUT_PREFLIGHT_SCHEMA_VERSION,
    status: 'error',
    errorCode: jobEnvelopeRolloutPreflightCliErrorCode(error),
  })}\n`;
}

export function parseJobEnvelopeRolloutPreflightArguments(args: readonly string[]): string {
  try {
    if (!Array.isArray(args) || Object.getPrototypeOf(args) !== Array.prototype) {
      return fail('PREFLIGHT_ARGUMENT_INVALID');
    }
    const descriptors = Object.getOwnPropertyDescriptors(args) as unknown as PropertyDescriptorMap;
    const pathDescriptor = descriptors['0'];
    const lengthDescriptor = descriptors.length;
    if (
      Reflect.ownKeys(descriptors).length !== 2 ||
      !pathDescriptor?.enumerable ||
      !('value' in pathDescriptor) ||
      !lengthDescriptor ||
      !('value' in lengthDescriptor) ||
      lengthDescriptor.value !== 1
    ) {
      return fail('PREFLIGHT_ARGUMENT_INVALID');
    }
    const snapshotPath = pathDescriptor.value as unknown;
    if (
      typeof snapshotPath !== 'string' ||
      snapshotPath.length === 0 ||
      snapshotPath.length > 4_096 ||
      snapshotPath.includes('\u0000') ||
      snapshotPath.startsWith('--')
    ) {
      return fail('PREFLIGHT_ARGUMENT_INVALID');
    }
    return snapshotPath;
  } catch {
    return fail('PREFLIGHT_ARGUMENT_INVALID');
  }
}

export function snapshotRows(value: unknown): readonly unknown[] {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return fail('SNAPSHOT_CONTRACT_INVALID');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const schemaVersionDescriptor = descriptors.schemaVersion;
    const rowsDescriptor = descriptors.rows;
    if (
      keys.length !== 2 ||
      keys.some((key) => key !== 'schemaVersion' && key !== 'rows') ||
      !schemaVersionDescriptor?.enumerable ||
      !('value' in schemaVersionDescriptor) ||
      schemaVersionDescriptor.value !== JOB_ENVELOPE_ROLLOUT_PREFLIGHT_SCHEMA_VERSION ||
      !rowsDescriptor?.enumerable ||
      !('value' in rowsDescriptor) ||
      !Array.isArray(rowsDescriptor.value) ||
      Object.getPrototypeOf(rowsDescriptor.value) !== Array.prototype ||
      rowsDescriptor.value.length > MAX_JOB_ENVELOPE_SNAPSHOT_ROWS
    ) {
      return fail('SNAPSHOT_CONTRACT_INVALID');
    }
    return Object.freeze(rowsDescriptor.value.slice() as unknown[]);
  } catch {
    return fail('SNAPSHOT_CONTRACT_INVALID');
  }
}

export function loadJobEnvelopeRolloutSnapshot(
  snapshotPath: string,
  reader: JobEnvelopeSnapshotReader = readSecureLocalFile,
): readonly unknown[] {
  let bytes: Uint8Array;
  try {
    bytes = reader(snapshotPath, MAX_JOB_ENVELOPE_SNAPSHOT_BYTES);
    if (!(bytes instanceof Uint8Array)) return fail('SNAPSHOT_READ_FAILED');
  } catch {
    return fail('SNAPSHOT_READ_FAILED');
  }

  let snapshot: unknown;
  try {
    snapshot = parseStrictJsonBytes(bytes);
  } catch {
    return fail('SNAPSHOT_JSON_INVALID');
  }
  return snapshotRows(snapshot);
}

export function evaluateJobEnvelopeRolloutPreflightCli(
  args: readonly string[],
  reader: JobEnvelopeSnapshotReader = readSecureLocalFile,
): JobEnvelopeRolloutPreflightCliResult {
  const snapshotPath = parseJobEnvelopeRolloutPreflightArguments(args);
  const rows = loadJobEnvelopeRolloutSnapshot(snapshotPath, reader);
  try {
    const report = runJobEnvelopeRolloutPreflight(rows);
    return Object.freeze({
      exitCode: report.incompatibleRows > 0 ? 2 : 0,
      stdout: `${JSON.stringify(report, null, 2)}\n`,
    });
  } catch {
    return fail('PREFLIGHT_FAILED');
  }
}

function main(): void {
  try {
    const result = evaluateJobEnvelopeRolloutPreflightCli(process.argv.slice(2));
    process.stdout.write(result.stdout);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(formatJobEnvelopeRolloutPreflightCliError(error));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
