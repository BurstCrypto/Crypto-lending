import { randomBytes } from 'node:crypto';

import {
  clearProvenStaleLocalEvmState,
  closeLocalEvmControlServerAndDrain,
  localEvmEndpointsAreAbsent,
  sendLocalEvmControlCommand,
  startLocalEvmControlServer,
} from './control-channel.mjs';
import { waitForLocalEvm } from './json-rpc.mjs';
import { LOCAL_EVM_MANIFEST } from './manifest.mjs';
import { spawnLocalEvmNode, stopLocalEvmNodeAndWait } from './process.mjs';
import {
  LOCAL_EVM_CONTROL_HOST,
  LOCAL_EVM_CONTROL_PORT,
  readLocalEvmControlRecord,
  removeLegacyLocalEvmState,
  removeLocalEvmControlRecord,
  replaceLocalEvmControlRecord,
  writeLocalEvmControlRecord,
} from './runtime-state.mjs';
import { initializeFreshLocalEvm, seedLocalEvmWallets } from './seed.mjs';

const UINT256 = /^(?:0|[1-9][0-9]{0,77})$/u;
const launchOwner = process.env.LOCAL_EVM_LAUNCH_OWNER;
if (launchOwner !== undefined && launchOwner !== 'LOCAL_DEMO_KAN_253') {
  throw new Error('Local EVM refused an unknown launch owner');
}
const launchPurpose = launchOwner === 'LOCAL_DEMO_KAN_253' ? 'LOCAL_DEMO' : 'STANDALONE';
const forcedDeathResetBarrier = process.env.LOCAL_EVM_TEST_FORCE_DEATH_RESET_BARRIER;
if (
  forcedDeathResetBarrier !== undefined &&
  (forcedDeathResetBarrier !== 'KAN_256_TEST_ONLY' || typeof process.send !== 'function')
) {
  throw new Error('Local EVM refused an invalid reset test barrier');
}

async function clearOnlyProvenStaleState(expected = undefined, claimInvalidRecord = false) {
  return clearProvenStaleLocalEvmState(expected, { invalidRecord: claimInvalidRecord });
}

let prior;
let invalidPrior = false;
try {
  prior = readLocalEvmControlRecord();
} catch {
  prior = null;
  invalidPrior = true;
}
if (prior !== null) {
  if (prior.state !== 'RUNNING') {
    let liveTransition = false;
    try {
      await sendLocalEvmControlCommand(prior, 'STATUS');
      liveTransition = true;
    } catch {
      // Only an exact authenticated owner can attest a live transition.
    }
    if (liveTransition) {
      throw new Error('Local EVM lifecycle transition is already in progress');
    }
    if (!(await clearOnlyProvenStaleState(prior))) {
      throw new Error(
        'Local EVM refused ambiguous transition ownership while a loopback endpoint is occupied',
      );
    }
  } else {
    try {
      await sendLocalEvmControlCommand(prior, 'STATUS');
      if (prior.purpose !== launchPurpose) {
        throw new Error('Local EVM is already owned by another local lifecycle');
      }
      await sendLocalEvmControlCommand(prior, 'RESET');
      process.stdout.write(
        `${LOCAL_EVM_MANIFEST.runtimeIdentity} was already running and was reset by its authenticated owner.\n`,
      );
      process.exit(0);
    } catch (error) {
      if (error?.message === 'Local EVM is already owned by another local lifecycle') throw error;
      if (!(await clearOnlyProvenStaleState(prior))) {
        throw new Error(
          'Local EVM refused ambiguous ownership while a loopback endpoint is occupied',
        );
      }
    }
  }
} else if (invalidPrior) {
  if (!(await clearOnlyProvenStaleState(undefined, true))) {
    throw new Error('Local EVM refused invalid ownership while a loopback endpoint is occupied');
  }
} else if (!(await localEvmEndpointsAreAbsent())) {
  throw new Error('Local EVM refused an unowned process on a fixed loopback endpoint');
}
removeLegacyLocalEvmState();

let currentChild = null;
let currentRecord = null;
let controlServer = null;
let recordPublished = false;
const expectedStops = new WeakSet();
let shutdownCode;
let resolveShutdown;
const shutdownRequested = new Promise((resolve) => {
  resolveShutdown = resolve;
});
const OWNED_PARENT_SHUTDOWN_MESSAGE = 'LOCAL_EVM_SUPERVISOR_SHUTDOWN';

function requestShutdown(code) {
  if (shutdownCode !== undefined) return;
  shutdownCode = code;
  resolveShutdown(code);
}

function watchChild(child) {
  child.once('exit', (code) => {
    if (!expectedStops.has(child) && child === currentChild) {
      requestShutdown(1);
    }
  });
  child.once('error', () => {
    if (!expectedStops.has(child) && child === currentChild) requestShutdown(1);
  });
}

function nextNodeInstanceId(previous) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = randomBytes(16).toString('hex');
    if (candidate !== previous) return candidate;
  }
  throw new Error('Local EVM could not allocate a fresh child instance identity');
}

async function spawnFreshOwnedChild() {
  const child = spawnLocalEvmNode();
  currentChild = child;
  watchChild(child);
  try {
    const before = currentRecord;
    if (before === null) throw new Error('Local EVM startup ownership was not reserved');
    currentRecord = replaceLocalEvmControlRecord(before, {
      ...before,
      nodePid: child.pid,
      nodeInstanceId: nextNodeInstanceId(before.nodeInstanceId),
    });
    await waitForLocalEvm();
    if (!childIsRunning(child)) throw new Error('Owned local EVM child exited during startup');
    await initializeFreshLocalEvm();
    if (!childIsRunning(child)) {
      throw new Error('Owned local EVM child exited during initialization');
    }
    return child;
  } catch (error) {
    expectedStops.add(child);
    await stopLocalEvmNodeAndWait(child).catch(() => undefined);
    if (currentChild === child) currentChild = null;
    throw error;
  }
}

function childIsRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function stopCurrentOwnedChild() {
  const child = currentChild;
  if (child === null) return;
  expectedStops.add(child);
  await stopLocalEvmNodeAndWait(child);
  if (currentChild === child) currentChild = null;
}

async function closeControlAdmissionAndDrain() {
  const server = controlServer;
  if (server === null) return;
  controlServer = null;
  await closeLocalEvmControlServerAndDrain(server);
}

function exactControlSeedPayload(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new TypeError('Invalid local EVM control balance payload');
  }
  const seen = new Set();
  return Object.freeze(
    value.map((seed) => {
      if (typeof seed !== 'object' || seed === null || Array.isArray(seed)) {
        throw new TypeError('Invalid local EVM control balance payload');
      }
      const descriptors = Object.getOwnPropertyDescriptors(seed);
      const keys = Reflect.ownKeys(descriptors);
      if (
        keys.length !== 2 ||
        keys.some(
          (key) => typeof key !== 'string' || !['walletAddress', 'balanceAtomic'].includes(key),
        )
      ) {
        throw new TypeError('Invalid local EVM control balance payload');
      }
      const wallet = descriptors.walletAddress;
      const balance = descriptors.balanceAtomic;
      if (
        !wallet ||
        !('value' in wallet) ||
        wallet.enumerable !== true ||
        typeof wallet.value !== 'string' ||
        !balance ||
        !('value' in balance) ||
        balance.enumerable !== true ||
        typeof balance.value !== 'string' ||
        !UINT256.test(balance.value) ||
        seen.has(wallet.value.toLowerCase())
      ) {
        throw new TypeError('Invalid local EVM control balance payload');
      }
      seen.add(wallet.value.toLowerCase());
      return Object.freeze({
        walletAddress: wallet.value,
        balances: Object.freeze({ USDC: BigInt(balance.value) }),
      });
    }),
  );
}

async function resetOwnedChild() {
  const before = currentRecord;
  if (before === null) throw new Error('Local EVM control owner is unavailable');
  currentRecord = replaceLocalEvmControlRecord(before, { ...before, state: 'RESETTING' });
  try {
    if (forcedDeathResetBarrier === 'KAN_256_TEST_ONLY') {
      // The real forced-supervisor-death regression holds the authenticated
      // RESET after publishing RESETTING. Only an owning IPC parent can enable
      // this unreachable-in-normal-launch barrier, and that test force-kills
      // the wrapper to prove the Hardhat IPC tether closes both endpoints.
      await new Promise(() => undefined);
    }
    await stopCurrentOwnedChild();
    const replacement = await spawnFreshOwnedChild();
    const resetting = currentRecord;
    currentRecord = replaceLocalEvmControlRecord(resetting, {
      ...resetting,
      state: 'RUNNING',
      nodePid: replacement.pid,
    });
  } catch (error) {
    requestShutdown(1);
    throw error;
  }
}

async function handleControlCommand(action, payload) {
  if (action === 'STATUS') {
    if (payload !== null) throw new TypeError('Invalid local EVM status payload');
    return;
  }
  if (action === 'RESET') {
    if (payload !== null) throw new TypeError('Invalid local EVM reset payload');
    await resetOwnedChild();
    return;
  }
  if (action === 'SET_BALANCES') {
    await seedLocalEvmWallets(exactControlSeedPayload(payload));
    return;
  }
  if (action === 'STOP') {
    if (payload !== null) throw new TypeError('Invalid local EVM stop payload');
    const before = currentRecord;
    if (before === null) throw new Error('Local EVM control owner is unavailable');
    currentRecord = replaceLocalEvmControlRecord(before, { ...before, state: 'STOPPING' });
    return;
  }
  throw new TypeError('Invalid local EVM control action');
}

process.once('SIGINT', () => requestShutdown(0));
process.once('SIGTERM', () => requestShutdown(0));
// Windows ChildProcess.kill terminates abruptly instead of delivering the
// JavaScript SIGTERM handler. An owning parent that deliberately created an IPC
// channel can request the exact same graceful drain path for lifecycle tests
// and process-manager composition. Ordinary CLI launches have no IPC channel.
if (typeof process.send === 'function') {
  process.on('message', (message) => {
    if (message === OWNED_PARENT_SHUTDOWN_MESSAGE) requestShutdown(0);
  });
}

try {
  currentRecord = Object.freeze({
    schemaVersion: 3,
    runtimeIdentity: LOCAL_EVM_MANIFEST.runtimeIdentity,
    state: 'STARTING',
    purpose: launchPurpose,
    ownerPid: process.pid,
    nodePid: null,
    nodeInstanceId: null,
    controlHost: LOCAL_EVM_CONTROL_HOST,
    controlPort: LOCAL_EVM_CONTROL_PORT,
    launchId: randomBytes(16).toString('hex'),
    controlCapability: randomBytes(32).toString('hex'),
  });
  controlServer = await startLocalEvmControlServer({
    getRecord: () => currentRecord,
    handleCommand: handleControlCommand,
    onStopAcknowledged: () => requestShutdown(0),
  });
  currentRecord = writeLocalEvmControlRecord(currentRecord);
  recordPublished = true;
  const child = await spawnFreshOwnedChild();
  const starting = currentRecord;
  currentRecord = replaceLocalEvmControlRecord(starting, {
    ...starting,
    state: 'RUNNING',
    nodePid: child.pid,
  });
  process.stdout.write(
    [
      `${LOCAL_EVM_MANIFEST.runtimeIdentity} is ready.`,
      `RPC: ${LOCAL_EVM_MANIFEST.rpc.url}`,
      `Network: ${LOCAL_EVM_MANIFEST.networkId}`,
      'Accounts: none; zero-fee mined local fixture transactions use a keyless controller.',
      'Lifecycle: authenticated loopback supervisor control.',
      'Press Ctrl+C or run npm run local-evm:teardown to stop it.',
      '',
    ].join('\n'),
  );
  await shutdownRequested;
} catch (error) {
  requestShutdown(1);
  shutdownCode = 1;
  await closeControlAdmissionAndDrain().catch(() => undefined);
  await stopCurrentOwnedChild().catch(() => undefined);
  if (recordPublished && currentRecord !== null) {
    removeLocalEvmControlRecord(currentRecord);
    recordPublished = false;
  }
  throw error;
}

await closeControlAdmissionAndDrain().catch(() => {
  shutdownCode = 1;
});
await stopCurrentOwnedChild().catch(() => {
  shutdownCode = 1;
});
if (recordPublished && currentRecord !== null) {
  removeLocalEvmControlRecord(currentRecord);
  recordPublished = false;
}
removeLegacyLocalEvmState();
process.exit(shutdownCode ?? 1);
