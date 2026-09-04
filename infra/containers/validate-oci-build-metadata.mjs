import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const EXPECTED_SOURCE = 'https://github.com/Trey-Gleason/Crypto-lending';
const LOWERCASE_GIT_REVISION = /^[0-9a-f]{40}$/u;
const CANONICAL_UTC_SECOND =
  /^(20[2-9][0-9]|21[0-9]{2})-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/u;
const UNSET_REVISION = '0'.repeat(40);

export function validateOciBuildMetadata(environment) {
  const source = environment.OCI_SOURCE;
  const revision = environment.OCI_REVISION;
  const created = environment.OCI_CREATED;
  const sourceDateEpoch = environment.SOURCE_DATE_EPOCH;
  const errors = [];

  if (source !== EXPECTED_SOURCE) errors.push('OCI_SOURCE must identify the canonical repository');
  if (!revision || !LOWERCASE_GIT_REVISION.test(revision) || revision === UNSET_REVISION) {
    errors.push('OCI_REVISION must be an explicit nonzero lowercase 40-character Git commit');
  }
  if (
    !created ||
    !CANONICAL_UTC_SECOND.test(created) ||
    new Date(created).toISOString() !== created.replace('Z', '.000Z')
  ) {
    errors.push(
      'OCI_CREATED must be an explicit canonical UTC timestamp at whole-second precision',
    );
  }
  if (sourceDateEpoch !== '0') {
    errors.push('SOURCE_DATE_EPOCH must stay fixed at 0 for reproducible image timestamps');
  }

  return Object.freeze(errors);
}

function isDirectExecution() {
  const script = process.argv[1];
  return script !== undefined && pathToFileURL(resolve(script)).href === import.meta.url;
}

if (isDirectExecution()) {
  const errors = validateOciBuildMetadata(process.env);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
  }
}
