import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { LOCAL_EVM_MANIFEST } from './manifest.mjs';
import { LOCAL_EVM_REPOSITORY_ROOT } from './process.mjs';

export const LOCAL_EVM_CONTROL_HOST = '127.0.0.1';
export const LOCAL_EVM_CONTROL_PORT = 18_546;
export const LOCAL_EVM_CONTROL_URL = `http://${LOCAL_EVM_CONTROL_HOST}:${LOCAL_EVM_CONTROL_PORT}/control`;
export const LOCAL_EVM_CONTROL_FILE = resolve(
  LOCAL_EVM_REPOSITORY_ROOT,
  '.local-validation',
  'kan-256',
  'local-evm.owner.json',
);

const LEGACY_STATE_FILES = Object.freeze([
  resolve(LOCAL_EVM_REPOSITORY_ROOT, '.local-validation', 'kan-256', 'local-evm.pid.json'),
  resolve(LOCAL_EVM_REPOSITORY_ROOT, '.local-validation', 'kan-256', 'local-evm.snapshot.json'),
]);
const LAUNCH_ID = /^[0-9a-f]{32}$/u;
const NODE_INSTANCE_ID = /^[0-9a-f]{32}$/u;
const CAPABILITY = /^[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'runtimeIdentity',
  'state',
  'purpose',
  'ownerPid',
  'nodePid',
  'nodeInstanceId',
  'controlHost',
  'controlPort',
  'launchId',
  'controlCapability',
]);

function exactOwnDataRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid local EVM control record');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== RECORD_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !RECORD_KEYS.includes(key))
  ) {
    throw new TypeError('Invalid local EVM control record');
  }
  const record = Object.create(null);
  for (const key of RECORD_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError('Invalid local EVM control record');
    }
    record[key] = descriptor.value;
  }
  return record;
}

export function parseLocalEvmControlRecord(value) {
  const record = exactOwnDataRecord(value);
  const spawnedChildIdentity =
    Number.isSafeInteger(record.nodePid) &&
    record.nodePid >= 1 &&
    record.ownerPid !== record.nodePid &&
    typeof record.nodeInstanceId === 'string' &&
    NODE_INSTANCE_ID.test(record.nodeInstanceId);
  if (
    record.schemaVersion !== 3 ||
    record.runtimeIdentity !== LOCAL_EVM_MANIFEST.runtimeIdentity ||
    !['STARTING', 'RUNNING', 'RESETTING', 'STOPPING'].includes(record.state) ||
    !['STANDALONE', 'LOCAL_DEMO'].includes(record.purpose) ||
    !Number.isSafeInteger(record.ownerPid) ||
    record.ownerPid < 1 ||
    !(
      (record.state === 'STARTING' && record.nodePid === null && record.nodeInstanceId === null) ||
      spawnedChildIdentity
    ) ||
    record.controlHost !== LOCAL_EVM_CONTROL_HOST ||
    record.controlPort !== LOCAL_EVM_CONTROL_PORT ||
    typeof record.launchId !== 'string' ||
    !LAUNCH_ID.test(record.launchId) ||
    typeof record.controlCapability !== 'string' ||
    !CAPABILITY.test(record.controlCapability)
  ) {
    throw new TypeError('Invalid local EVM control record');
  }
  return Object.freeze(record);
}

export function sameLocalEvmControlRecord(left, right) {
  return RECORD_KEYS.every((key) => left?.[key] === right?.[key]);
}

export function readLocalEvmControlRecord() {
  try {
    return parseLocalEvmControlRecord(JSON.parse(readFileSync(LOCAL_EVM_CONTROL_FILE, 'utf8')));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function writeExclusive(path, record) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(record)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

export function writeLocalEvmControlRecord(value) {
  const record = parseLocalEvmControlRecord(value);
  writeExclusive(LOCAL_EVM_CONTROL_FILE, record);
  return record;
}

export function replaceLocalEvmControlRecord(expected, value) {
  const replacement = parseLocalEvmControlRecord(value);
  const suffix = `${process.pid}.${randomBytes(8).toString('hex')}`;
  const claimed = `${LOCAL_EVM_CONTROL_FILE}.${suffix}.claimed`;
  try {
    renameSync(LOCAL_EVM_CONTROL_FILE, claimed);
    const current = parseLocalEvmControlRecord(JSON.parse(readFileSync(claimed, 'utf8')));
    if (!sameLocalEvmControlRecord(current, expected)) {
      renameSync(claimed, LOCAL_EVM_CONTROL_FILE);
      throw new Error('Local EVM control ownership changed');
    }
    writeExclusive(LOCAL_EVM_CONTROL_FILE, replacement);
    rmSync(claimed, { force: true });
  } catch (error) {
    if (existsSync(claimed) && !existsSync(LOCAL_EVM_CONTROL_FILE)) {
      renameSync(claimed, LOCAL_EVM_CONTROL_FILE);
    }
    throw error;
  }
  return replacement;
}

export function removeLocalEvmControlRecord(expected) {
  const claimed = `${LOCAL_EVM_CONTROL_FILE}.${process.pid}.${randomBytes(8).toString('hex')}.claimed`;
  try {
    renameSync(LOCAL_EVM_CONTROL_FILE, claimed);
  } catch (error) {
    if (error && error.code === 'ENOENT') return expected === undefined;
    throw error;
  }
  try {
    if (expected !== undefined) {
      const claimedRecord = parseLocalEvmControlRecord(JSON.parse(readFileSync(claimed, 'utf8')));
      if (!sameLocalEvmControlRecord(claimedRecord, expected)) {
        if (!existsSync(LOCAL_EVM_CONTROL_FILE)) renameSync(claimed, LOCAL_EVM_CONTROL_FILE);
        else rmSync(claimed, { force: true });
        return false;
      }
    }
    rmSync(claimed, { force: true });
    return true;
  } catch (error) {
    if (existsSync(claimed) && !existsSync(LOCAL_EVM_CONTROL_FILE)) {
      renameSync(claimed, LOCAL_EVM_CONTROL_FILE);
    }
    throw error;
  }
}

/** Only call after proving both the RPC and control endpoints are absent. */
export function removeStaleLocalEvmState() {
  const claimed = `${LOCAL_EVM_CONTROL_FILE}.${process.pid}.${randomBytes(8).toString('hex')}.stale`;
  try {
    renameSync(LOCAL_EVM_CONTROL_FILE, claimed);
    let claimedValid = false;
    try {
      parseLocalEvmControlRecord(JSON.parse(readFileSync(claimed, 'utf8')));
      claimedValid = true;
    } catch {
      // Invalid state is the only state this recovery path may remove.
    }
    if (claimedValid) {
      if (!existsSync(LOCAL_EVM_CONTROL_FILE)) renameSync(claimed, LOCAL_EVM_CONTROL_FILE);
      throw new Error('Local EVM control ownership changed during stale-state cleanup');
    }
    rmSync(claimed, { force: true });
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  for (const path of LEGACY_STATE_FILES) rmSync(path, { force: true });
}

export function removeLegacyLocalEvmState() {
  for (const path of LEGACY_STATE_FILES) rmSync(path, { force: true });
}
