import { clearProvenStaleLocalEvmState, sendLocalEvmControlCommand } from './control-channel.mjs';
import { readLocalEvmControlRecord } from './runtime-state.mjs';

function requiredPurpose(environment) {
  const launchOwner = environment.LOCAL_EVM_LAUNCH_OWNER;
  if (launchOwner === undefined) return undefined;
  if (launchOwner !== 'LOCAL_DEMO_KAN_253') {
    throw new Error('Local EVM refused an unknown launch owner');
  }
  return 'LOCAL_DEMO';
}

async function clearStaleRecord(record, claimInvalidRecord = false) {
  return clearProvenStaleLocalEvmState(record, { invalidRecord: claimInvalidRecord });
}

export async function findAuthenticatedLocalEvmOwner(options = {}) {
  const purpose = requiredPurpose(options.environment ?? process.env);
  let record;
  try {
    record = readLocalEvmControlRecord();
  } catch {
    if (await clearStaleRecord(undefined, true)) return null;
    throw new Error('Local EVM refused invalid ownership while a loopback endpoint is occupied');
  }
  if (record === null) {
    if (await clearStaleRecord()) return null;
    throw new Error('Local EVM refused an unowned process on a fixed loopback endpoint');
  }
  if (record.state !== 'RUNNING') {
    let liveTransition = false;
    try {
      await sendLocalEvmControlCommand(record, 'STATUS');
      liveTransition = true;
    } catch {
      // Missing authentication is recoverable only when both endpoints are absent.
    }
    if (liveTransition) {
      throw new Error('Local EVM lifecycle transition is already in progress');
    }
    if (await clearStaleRecord(record)) return null;
    throw new Error('Local EVM refused ambiguous transition ownership');
  }
  try {
    await sendLocalEvmControlCommand(record, 'STATUS');
  } catch {
    if (await clearStaleRecord(record)) return null;
    throw new Error('Local EVM refused ambiguous or unauthenticated ownership');
  }
  if (purpose !== undefined && record.purpose !== purpose) {
    throw new Error('Local EVM command refused a process owned by another lifecycle');
  }
  return record;
}

export async function requireAuthenticatedLocalEvmOwner(options = {}) {
  const record = await findAuthenticatedLocalEvmOwner(options);
  if (record === null) throw new Error('Local EVM has no authenticated owner');
  return record;
}
