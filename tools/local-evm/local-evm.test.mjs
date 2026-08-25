import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MOCK_STABLECOIN_RUNTIME_BYTECODE } from './evm-bytecode.mjs';
import {
  assertLocalEvmIdentity,
  parseLocalEvmRpcResponse,
  requestLocalEvm,
  waitForLocalEvm,
} from './json-rpc.mjs';
import {
  localEvmEndpointsAreAbsent,
  sendLocalEvmControlCommand,
  startLocalEvmControlServer,
} from './control-channel.mjs';
import { findAuthenticatedLocalEvmOwner } from './lifecycle-client.mjs';
import { LOCAL_EVM_MANIFEST } from './manifest.mjs';
import {
  assertNoAmbientProviderConfiguration,
  localEvmNodeArguments,
  localEvmProcessEnvironment,
  spawnLocalEvmNode,
  stopLocalEvmNodeAndWait,
} from './process.mjs';
import {
  LOCAL_EVM_CONTROL_FILE,
  LOCAL_EVM_CONTROL_HOST,
  LOCAL_EVM_CONTROL_PORT,
  readLocalEvmControlRecord,
  removeLocalEvmControlRecord,
  replaceLocalEvmControlRecord,
  writeLocalEvmControlRecord,
} from './runtime-state.mjs';

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const root = new URL('../..', import.meta.url);
const wallet = '0x1111111111111111111111111111111111111111';
const contract = LOCAL_EVM_MANIFEST.assets[0].contractAddress;
const balanceCall = `0x70a08231${'0'.repeat(24)}${wallet.slice(2)}`;
const unauthorizedSetCall = `0xe30443bc${'0'.repeat(24)}${wallet.slice(2)}${123n
  .toString(16)
  .padStart(64, '0')}`;
const legacySnapshotFile = resolve(
  fileURLToPath(root),
  '.local-validation',
  'kan-256',
  'local-evm.snapshot.json',
);

function childIsRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function stopped(child, timeoutMs = 10_000) {
  if (!childIsRunning(child)) return;
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Child did not stop in time')), timeoutMs),
    ),
  ]);
}

async function waitForOwnership() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const record = readLocalEvmControlRecord();
      if (record?.state === 'RUNNING') {
        await sendLocalEvmControlCommand(record, 'STATUS');
        return record;
      }
    } catch {
      // Atomic state transitions may make the record briefly unavailable.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('Authenticated local EVM ownership was not published');
}

async function waitForEndpointsToClose() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await localEvmEndpointsAreAbsent()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('Local EVM endpoints did not close');
}

function runLifecycleScript(script, args = [], extraEnvironment = {}) {
  return spawnSync(process.execPath, [`tools/local-evm/${script}.mjs`, ...args], {
    cwd: root,
    env: { ...localEvmProcessEnvironment({}), ...extraEnvironment },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 20_000,
  });
}

function runLifecycleScriptAsync(script, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [`tools/local-evm/${script}.mjs`, ...args], {
      cwd: root,
      env: localEvmProcessEnvironment({}),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Lifecycle script timed out'));
    }, 10_000);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolvePromise({ status: code, stdout: stdout.join(''), stderr: stderr.join('') });
    });
  });
}

function startManagedLocalEvm(options = {}) {
  const output = [];
  const errors = [];
  const child = spawn(process.execPath, ['tools/local-evm/start.mjs'], {
    cwd: root,
    env: {
      ...localEvmProcessEnvironment({}),
      ...(options.forceDeathResetBarrier
        ? { LOCAL_EVM_TEST_FORCE_DEATH_RESET_BARRIER: 'KAN_256_TEST_ONLY' }
        : {}),
    },
    stdio: options.ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => output.push(chunk));
  child.stderr.on('data', (chunk) => errors.push(chunk));
  return Object.freeze({ child, output, errors });
}

function forgedRecord(nodePid, overrides = {}) {
  const state = overrides.state ?? 'RUNNING';
  const effectiveNodePid = Object.hasOwn(overrides, 'nodePid') ? overrides.nodePid : nodePid;
  return Object.freeze({
    schemaVersion: 3,
    runtimeIdentity: LOCAL_EVM_MANIFEST.runtimeIdentity,
    state,
    purpose: 'STANDALONE',
    ownerPid: process.pid,
    nodePid: effectiveNodePid,
    nodeInstanceId:
      effectiveNodePid === null
        ? null
        : (overrides.nodeInstanceId ?? randomBytes(16).toString('hex')),
    controlHost: LOCAL_EVM_CONTROL_HOST,
    controlPort: LOCAL_EVM_CONTROL_PORT,
    launchId: randomBytes(16).toString('hex'),
    controlCapability: randomBytes(32).toString('hex'),
    ...overrides,
  });
}

async function balanceAt(blockTag = 'latest') {
  return BigInt(await requestLocalEvm('eth_call', [{ to: contract, data: balanceCall }, blockTag]));
}

test('authenticated lifecycle preserves history, resets by restart, and exercises the product', async (t) => {
  assert.equal(readLocalEvmControlRecord(), null, 'test starts without an ownership record');
  const managed = startManagedLocalEvm();
  const sentinels = [];
  t.after(async () => {
    for (const sentinel of sentinels) {
      if (childIsRunning(sentinel)) sentinel.kill('SIGTERM');
      await stopped(sentinel).catch(() => undefined);
    }
    if (readLocalEvmControlRecord() !== null) runLifecycleScript('teardown');
    if (childIsRunning(managed.child)) managed.child.kill('SIGTERM');
    await stopped(managed.child).catch(() => undefined);
  });

  await waitForLocalEvm();
  const ownership = await waitForOwnership();
  assert.equal(ownership.state, 'RUNNING');
  assert.equal(ownership.purpose, 'STANDALONE');
  assert.equal(ownership.ownerPid, managed.child.pid);
  assert.notEqual(ownership.nodePid, managed.child.pid);
  assert.match(ownership.nodeInstanceId, /^[0-9a-f]{32}$/u);
  assert.match(ownership.launchId, /^[0-9a-f]{32}$/u);
  assert.equal(/^[0-9a-f]{64}$/u.test(ownership.controlCapability), true);
  assert.deepEqual(await sendLocalEvmControlCommand(ownership, 'STATUS'), {
    status: 'RUNNING',
    nodeInstanceId: ownership.nodeInstanceId,
  });
  assert.deepEqual(await assertLocalEvmIdentity(), {
    runtimeIdentity: 'LOCAL_EVM_HARDHAT',
    networkId: 'eip155:31337',
  });
  assert.deepEqual(await requestLocalEvm('eth_accounts', []), []);
  assert.equal(
    await requestLocalEvm('eth_getCode', [contract, 'latest']),
    MOCK_STABLECOIN_RUNTIME_BYTECODE,
  );
  await assert.rejects(
    requestLocalEvm('eth_call', [
      { from: wallet, to: contract, data: unauthorizedSetCall },
      'latest',
    ]),
  );
  assert.equal(await balanceAt(), 0n, 'the sender-gated setter rejects an unowned caller');

  const beforeFirst = await requestLocalEvm('eth_getBlockByNumber', ['latest', false]);
  const beforeFirstCode = await requestLocalEvm('eth_getCode', [contract, beforeFirst.number]);
  assert.equal(await balanceAt(beforeFirst.number), 0n);
  const firstMutation = runLifecycleScript('set-balance', [
    '--wallet',
    wallet,
    '--usdc-atomic',
    '123456789',
  ]);
  assert.equal(firstMutation.status, 0);
  assert.equal(firstMutation.stderr, '');
  const firstPublished = await requestLocalEvm('eth_getBlockByNumber', ['latest', false]);
  assert.equal(BigInt(firstPublished.number), BigInt(beforeFirst.number) + 1n);
  assert.equal(
    (await requestLocalEvm('eth_getBlockByNumber', [beforeFirst.number, false])).hash,
    beforeFirst.hash,
  );
  assert.equal(
    await requestLocalEvm('eth_getCode', [contract, beforeFirst.number]),
    beforeFirstCode,
  );
  assert.equal(await balanceAt(beforeFirst.number), 0n);
  assert.equal(await balanceAt(firstPublished.number), 123_456_789n);

  const secondMutation = runLifecycleScript('set-balance', [
    '--wallet',
    wallet,
    '--usdc-atomic',
    '456000000',
  ]);
  assert.equal(secondMutation.status, 0);
  assert.equal(secondMutation.stderr, '');
  const secondPublished = await requestLocalEvm('eth_getBlockByNumber', ['latest', false]);
  assert.equal(BigInt(secondPublished.number), BigInt(firstPublished.number) + 1n);
  assert.notEqual(secondPublished.hash, firstPublished.hash);
  const preserved = await requestLocalEvm('eth_getBlockByNumber', [firstPublished.number, false]);
  assert.equal(preserved.hash, firstPublished.hash);
  assert.equal(await balanceAt(firstPublished.number), 123_456_789n);
  assert.equal(await balanceAt(secondPublished.number), 456_000_000n);

  rmSync(legacySnapshotFile, { force: true });
  assert.equal(existsSync(legacySnapshotFile), false);
  const consumedSnapshot = await requestLocalEvm('evm_snapshot', []);
  assert.match(consumedSnapshot, /^0x[0-9a-f]+$/u);
  assert.equal(await requestLocalEvm('evm_revert', [consumedSnapshot]), true);
  assert.equal(await requestLocalEvm('evm_revert', [consumedSnapshot]), false);
  const dirtyMutation = runLifecycleScript('set-balance', [
    '--wallet',
    wallet,
    '--usdc-atomic',
    '789000000',
  ]);
  assert.equal(dirtyMutation.status, 0);
  assert.equal(await balanceAt(), 789_000_000n);

  const beforeResetOwner = readLocalEvmControlRecord();
  const reset = runLifecycleScript('reset');
  assert.equal(reset.status, 0);
  assert.equal(reset.stderr, '');
  assert.match(reset.stdout, /fresh-child reset complete/u);
  const afterResetOwner = await waitForOwnership();
  assert.equal(afterResetOwner.ownerPid, beforeResetOwner.ownerPid);
  assert.notEqual(afterResetOwner.nodePid, beforeResetOwner.nodePid);
  assert.notEqual(afterResetOwner.nodeInstanceId, beforeResetOwner.nodeInstanceId);
  assert.equal(afterResetOwner.launchId, beforeResetOwner.launchId);
  assert.equal(
    afterResetOwner.controlCapability === beforeResetOwner.controlCapability,
    true,
    'control capability remains stable across the owned generation restart',
  );
  assert.equal(await balanceAt(), 0n);
  assert.deepEqual(await requestLocalEvm('eth_accounts', []), []);
  assert.equal(
    await requestLocalEvm('eth_getCode', [contract, 'latest']),
    MOCK_STABLECOIN_RUNTIME_BYTECODE,
  );
  assert.equal(existsSync(legacySnapshotFile), false);

  const repeatedStart = runLifecycleScript('start');
  assert.equal(repeatedStart.status, 0);
  assert.equal(repeatedStart.stderr, '');
  assert.match(repeatedStart.stdout, /reset by its authenticated owner/u);
  const afterRepeatedStart = await waitForOwnership();
  assert.equal(afterRepeatedStart.ownerPid, ownership.ownerPid);
  assert.notEqual(afterRepeatedStart.nodePid, afterResetOwner.nodePid);
  assert.notEqual(afterRepeatedStart.nodeInstanceId, afterResetOwner.nodeInstanceId);
  assert.equal(afterRepeatedStart.launchId, ownership.launchId);

  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  sentinels.push(sentinel);
  const untampered = readLocalEvmControlRecord();
  const tampered = Object.freeze({ ...untampered, nodePid: sentinel.pid });
  replaceLocalEvmControlRecord(untampered, tampered);
  const refusedTamperedReset = runLifecycleScript('reset');
  assert.notEqual(refusedTamperedReset.status, 0);
  assert.equal(childIsRunning(sentinel), true);
  replaceLocalEvmControlRecord(tampered, untampered);
  await sendLocalEvmControlCommand(untampered, 'STATUS');

  const probe = spawnSync(
    process.execPath,
    [tsxCli, '--tsconfig', 'apps/api/tsconfig.json', 'tools/local-evm/product-probe.ts'],
    {
      cwd: root,
      env: {
        ...localEvmProcessEnvironment({}),
        NODE_ENV: 'test',
        LOCAL_EVM_CONTROL_LAUNCH_ID: untampered.launchId,
        LOCAL_EVM_CONTROL_CAPABILITY: untampered.controlCapability,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 20_000,
    },
  );
  assert.equal(probe.status, 0, 'product probe exits successfully');
  assert.equal(probe.stderr, '');
  assert.deepEqual(JSON.parse(probe.stdout), {
    runtimeIdentity: 'LOCAL_EVM_HARDHAT',
    networkId: 'eip155:31337',
    stablecoin: 'USDC',
    initialAmountAtomic: '7000000000',
    updatedAmountAtomic: '1234500000',
    updatedPortfolioValueUsdMinor: '123450',
    sourceBlockAdvanced: true,
    portfolioSnapshotChanged: true,
    mayAuthorizeFinancialAction: false,
  });

  const teardown = runLifecycleScript('teardown');
  assert.equal(teardown.status, 0);
  assert.equal(teardown.stderr, '');
  assert.match(teardown.stdout, /teardown complete/u);
  await stopped(managed.child);
  assert.equal(managed.child.exitCode, 0);
  assert.equal(readLocalEvmControlRecord(), null);
  assert.equal(managed.errors.join(''), '');
  const safeOutput = managed.output.join('');
  assert.ok(Buffer.byteLength(safeOutput, 'utf8') < 4_096);
  assert.match(safeOutput, /Accounts: none/u);
  assert.equal(
    safeOutput.includes(ownership.controlCapability),
    false,
    'owner capability is absent from output',
  );
  assert.doesNotMatch(safeOutput, /private key|mnemonic|secret phrase/iu);
  assert.match(safeOutput, /zero-fee mined local fixture transactions/u);
});

test('signal shutdown drains an in-flight reset before stopping the final owned child', async (t) => {
  assert.equal(readLocalEvmControlRecord(), null);
  const managed = startManagedLocalEvm({ ipc: process.platform === 'win32' });
  t.after(async () => {
    if (readLocalEvmControlRecord() !== null) runLifecycleScript('teardown');
    if (childIsRunning(managed.child)) managed.child.kill('SIGTERM');
    await stopped(managed.child).catch(() => undefined);
  });

  await waitForLocalEvm();
  const ownership = await waitForOwnership();
  const resetCommand = sendLocalEvmControlCommand(ownership, 'RESET');
  let resettingRecord;
  const transitionDeadline = Date.now() + 10_000;
  while (Date.now() < transitionDeadline) {
    try {
      const candidate = readLocalEvmControlRecord();
      if (candidate?.state === 'RESETTING') {
        resettingRecord = candidate;
        break;
      }
    } catch {
      // Exact record replacement can make the transition briefly unavailable.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
  }
  assert.ok(resettingRecord, 'the real reset exposes its authenticated transition state');
  if (process.platform === 'win32') {
    managed.child.send('LOCAL_EVM_SUPERVISOR_SHUTDOWN');
  } else {
    assert.equal(managed.child.kill('SIGTERM'), true);
  }

  const resetResult = await resetCommand;
  assert.equal(resetResult.status, 'RUNNING');
  assert.notEqual(resetResult.nodeInstanceId, ownership.nodeInstanceId);
  await stopped(managed.child);
  assert.equal(managed.child.exitCode, 0);
  await waitForEndpointsToClose();
  assert.equal(readLocalEvmControlRecord(), null);
  assert.equal(managed.errors.join(''), '');
});

test('a forced supervisor death during reset cannot orphan its IPC-tethered child', async (t) => {
  assert.equal(readLocalEvmControlRecord(), null);
  const managed = startManagedLocalEvm({ ipc: true, forceDeathResetBarrier: true });
  let subsequent;
  t.after(async () => {
    if (readLocalEvmControlRecord() !== null) runLifecycleScript('teardown');
    if (subsequent !== undefined && childIsRunning(subsequent.child)) {
      subsequent.child.kill('SIGKILL');
    }
    if (subsequent !== undefined) await stopped(subsequent.child).catch(() => undefined);
    if (childIsRunning(managed.child)) managed.child.kill('SIGKILL');
    await stopped(managed.child).catch(() => undefined);
  });

  await waitForLocalEvm();
  const ownership = await waitForOwnership();
  const resetOutcome = sendLocalEvmControlCommand(ownership, 'RESET').then(
    (value) => Object.freeze({ value, error: null }),
    (error) => Object.freeze({ value: null, error }),
  );
  let resettingRecord;
  const transitionDeadline = Date.now() + 10_000;
  while (Date.now() < transitionDeadline) {
    try {
      const candidate = readLocalEvmControlRecord();
      if (candidate?.state === 'RESETTING') {
        resettingRecord = candidate;
        break;
      }
    } catch {
      // Exact record replacement can make the transition briefly unavailable.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
  }
  assert.ok(resettingRecord, 'the forced-death case intersects the real reset transition');
  assert.equal(managed.child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGKILL'), true);
  await stopped(managed.child);
  await resetOutcome;
  await waitForEndpointsToClose();

  assert.notEqual(readLocalEvmControlRecord(), null, 'forced death leaves only stale state');
  const recovery = runLifecycleScript('teardown');
  assert.equal(recovery.status, 0);
  assert.equal(recovery.stderr, '');
  assert.match(recovery.stdout, /no authenticated owner/u);
  assert.equal(readLocalEvmControlRecord(), null);

  subsequent = startManagedLocalEvm();
  const subsequentOwner = await waitForOwnership();
  assert.equal(subsequentOwner.ownerPid, subsequent.child.pid);
  const subsequentTeardown = runLifecycleScript('teardown');
  assert.equal(subsequentTeardown.status, 0);
  assert.equal(subsequentTeardown.stderr, '');
  await stopped(subsequent.child);
  assert.equal(readLocalEvmControlRecord(), null);
});

test('external commands never signal reused PIDs or mutate an unowned matching endpoint', async (t) => {
  assert.equal(readLocalEvmControlRecord(), null);
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  let rawNode;
  let unrelatedControl;
  let activeForgedRecord;
  t.after(async () => {
    if (unrelatedControl?.listening) {
      await new Promise((resolvePromise) => unrelatedControl.close(resolvePromise));
    }
    if (activeForgedRecord !== undefined) removeLocalEvmControlRecord(activeForgedRecord);
    if (rawNode !== undefined) await stopLocalEvmNodeAndWait(rawNode).catch(() => undefined);
    if (childIsRunning(sentinel)) sentinel.kill('SIGTERM');
    await stopped(sentinel).catch(() => undefined);
  });

  activeForgedRecord = writeLocalEvmControlRecord(forgedRecord(sentinel.pid));
  const staleTeardown = runLifecycleScript('teardown');
  assert.equal(staleTeardown.status, 0);
  assert.match(staleTeardown.stdout, /no authenticated owner/u);
  assert.equal(childIsRunning(sentinel), true);
  assert.equal(readLocalEvmControlRecord(), null);
  activeForgedRecord = undefined;

  for (const state of ['STARTING', 'RESETTING', 'STOPPING']) {
    activeForgedRecord = writeLocalEvmControlRecord(
      forgedRecord(sentinel.pid, {
        state,
        nodePid: state === 'STARTING' ? null : sentinel.pid,
      }),
    );
    const recoveredTransition = runLifecycleScript('teardown');
    assert.equal(recoveredTransition.status, 0, `${state} stale state is recoverable`);
    assert.match(recoveredTransition.stdout, /no authenticated owner/u);
    assert.equal(readLocalEvmControlRecord(), null);
    assert.equal(childIsRunning(sentinel), true);
    activeForgedRecord = undefined;
  }

  let capturedControlBody = '';
  unrelatedControl = http.createServer((request, response) => {
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      capturedControlBody += chunk;
    });
    request.on('end', () => {
      response.writeHead(403, { 'content-type': 'application/json', connection: 'close' });
      response.end('{}');
    });
  });
  await new Promise((resolvePromise, reject) => {
    unrelatedControl.once('error', reject);
    unrelatedControl.listen(LOCAL_EVM_CONTROL_PORT, LOCAL_EVM_CONTROL_HOST, resolvePromise);
  });
  activeForgedRecord = writeLocalEvmControlRecord(forgedRecord(sentinel.pid));
  const refusedUnrelatedControl = await runLifecycleScriptAsync('teardown');
  assert.notEqual(refusedUnrelatedControl.status, 0);
  assert.equal(childIsRunning(sentinel), true);
  assert.ok(capturedControlBody.length > 0);
  assert.equal(capturedControlBody.includes(activeForgedRecord.controlCapability), false);
  assert.equal(readLocalEvmControlRecord().launchId, activeForgedRecord.launchId);
  await new Promise((resolvePromise) => unrelatedControl.close(resolvePromise));
  removeLocalEvmControlRecord(activeForgedRecord);
  activeForgedRecord = undefined;

  rawNode = spawnLocalEvmNode({ sourceEnvironment: {} });
  await waitForLocalEvm();
  const rawBlock = await requestLocalEvm('eth_getBlockByNumber', ['latest', false]);
  assert.equal(await requestLocalEvm('eth_getCode', [contract, 'latest']), '0x');
  activeForgedRecord = writeLocalEvmControlRecord(forgedRecord(sentinel.pid));
  for (const [script, args] of [
    ['start', []],
    ['reset', []],
    ['set-balance', ['--wallet', wallet, '--usdc-atomic', '999']],
    ['teardown', []],
  ]) {
    const refused = runLifecycleScript(script, args);
    assert.notEqual(refused.status, 0, `${script} refuses an unowned matching endpoint`);
    assert.equal(childIsRunning(rawNode), true);
    assert.equal(childIsRunning(sentinel), true);
  }
  const rawBlockAfter = await requestLocalEvm('eth_getBlockByNumber', ['latest', false]);
  assert.equal(rawBlockAfter.number, rawBlock.number);
  assert.equal(rawBlockAfter.hash, rawBlock.hash);
  assert.equal(await requestLocalEvm('eth_getCode', [contract, 'latest']), '0x');
  removeLocalEvmControlRecord(activeForgedRecord);
  activeForgedRecord = undefined;
  for (const state of ['STARTING', 'RESETTING', 'STOPPING']) {
    activeForgedRecord = writeLocalEvmControlRecord(
      forgedRecord(sentinel.pid, {
        state,
        nodePid: state === 'STARTING' ? null : sentinel.pid,
      }),
    );
    const refusedOccupiedRecovery = runLifecycleScript('teardown');
    assert.notEqual(
      refusedOccupiedRecovery.status,
      0,
      `${state} remains fail-closed while the RPC endpoint is occupied`,
    );
    assert.equal(readLocalEvmControlRecord().state, state);
    assert.equal(childIsRunning(rawNode), true);
    assert.equal(childIsRunning(sentinel), true);
    removeLocalEvmControlRecord(activeForgedRecord);
    activeForgedRecord = undefined;
  }
});

test('start recovers every proven-stale transition and concurrent launchers preserve one owner', async (t) => {
  assert.equal(readLocalEvmControlRecord(), null);
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const managedChildren = [];
  let activeRecord;
  t.after(async () => {
    try {
      if (readLocalEvmControlRecord() !== null) runLifecycleScript('teardown');
    } catch {
      // Direct handles below remain the final cleanup authority for test-owned wrappers.
    }
    if (activeRecord !== undefined) removeLocalEvmControlRecord(activeRecord);
    for (const managed of managedChildren) {
      if (childIsRunning(managed.child)) managed.child.kill('SIGTERM');
      await stopped(managed.child).catch(() => undefined);
    }
    try {
      if (readLocalEvmControlRecord() !== null) runLifecycleScript('teardown');
    } catch {
      // A failed test must still leave the next fixed-port test isolated.
    }
    if (childIsRunning(sentinel)) sentinel.kill('SIGTERM');
    await stopped(sentinel).catch(() => undefined);
  });

  for (const state of ['STARTING', 'RESETTING', 'STOPPING']) {
    const staleRecord = writeLocalEvmControlRecord(
      forgedRecord(sentinel.pid, {
        state,
        nodePid: state === 'STARTING' ? null : sentinel.pid,
      }),
    );
    activeRecord = staleRecord;
    const managed = startManagedLocalEvm();
    managedChildren.push(managed);
    const ownership = await waitForOwnership();
    activeRecord = undefined;
    assert.equal(ownership.state, 'RUNNING');
    assert.equal(ownership.ownerPid, managed.child.pid);
    assert.notEqual(ownership.launchId, staleRecord.launchId);
    assert.equal(childIsRunning(sentinel), true);

    const teardown = runLifecycleScript('teardown');
    assert.equal(teardown.status, 0);
    await stopped(managed.child);
    assert.equal(managed.child.exitCode, 0);
    assert.equal(readLocalEvmControlRecord(), null);
  }

  const first = startManagedLocalEvm();
  const second = startManagedLocalEvm();
  managedChildren.push(first, second);
  const concurrentOwner = await waitForOwnership();
  assert.equal(
    [first.child.pid, second.child.pid].includes(concurrentOwner.ownerPid),
    true,
    'one concurrent wrapper owns the authenticated record',
  );
  const owner = concurrentOwner.ownerPid === first.child.pid ? first : second;
  const nonOwner = owner === first ? second : first;
  await stopped(nonOwner.child);
  const retained = readLocalEvmControlRecord();
  assert.equal(retained.ownerPid, owner.child.pid);
  await sendLocalEvmControlCommand(retained, 'STATUS');
  assert.equal(childIsRunning(owner.child), true);
  assert.equal(childIsRunning(sentinel), true);

  const teardown = runLifecycleScript('teardown');
  assert.equal(teardown.status, 0);
  await stopped(owner.child);
  assert.equal(readLocalEvmControlRecord(), null);
});

test('authenticated transition status fails closed while a live control owner is bound', async (t) => {
  assert.equal(readLocalEvmControlRecord(), null);
  let activeServer;
  let activeRecord;
  t.after(async () => {
    if (activeServer?.listening) {
      await new Promise((resolvePromise) => activeServer.close(resolvePromise));
    }
    if (activeRecord !== undefined) removeLocalEvmControlRecord(activeRecord);
  });

  for (const state of ['STARTING', 'RESETTING', 'STOPPING']) {
    activeRecord = writeLocalEvmControlRecord(
      forgedRecord(91_001, { state, nodePid: state === 'STARTING' ? null : 91_001 }),
    );
    activeServer = await startLocalEvmControlServer({
      getRecord: () => activeRecord,
      async handleCommand(action) {
        assert.equal(action, 'STATUS');
      },
      onStopAcknowledged() {},
    });
    assert.deepEqual(await sendLocalEvmControlCommand(activeRecord, 'STATUS'), {
      status: state,
      nodeInstanceId: activeRecord.nodeInstanceId,
    });
    await assert.rejects(findAuthenticatedLocalEvmOwner(), /transition is already in progress/u);
    assert.equal(readLocalEvmControlRecord().state, state);
    await new Promise((resolvePromise) => activeServer.close(resolvePromise));
    activeServer = undefined;
    removeLocalEvmControlRecord(activeRecord);
    activeRecord = undefined;
  }
});

test('only the admitted mutation can release the control operation lock', async (t) => {
  assert.equal(readLocalEvmControlRecord(), null);
  let activeRecord = writeLocalEvmControlRecord(forgedRecord(91_002));
  let releaseFirst;
  let markFirstEntered;
  const firstEntered = new Promise((resolvePromise) => {
    markFirstEntered = resolvePromise;
  });
  const firstGate = new Promise((resolvePromise) => {
    releaseFirst = resolvePromise;
  });
  let handlerEntries = 0;
  const server = await startLocalEvmControlServer({
    getRecord: () => activeRecord,
    async handleCommand(action) {
      assert.notEqual(action, 'STATUS');
      handlerEntries += 1;
      if (handlerEntries === 1) {
        markFirstEntered();
        await firstGate;
      }
      if (action === 'RESET') {
        const before = activeRecord;
        activeRecord = replaceLocalEvmControlRecord(before, {
          ...before,
          nodeInstanceId: randomBytes(16).toString('hex'),
        });
      }
    },
    onStopAcknowledged() {},
  });
  t.after(async () => {
    releaseFirst();
    if (server.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
    if (activeRecord !== undefined) removeLocalEvmControlRecord(activeRecord);
  });

  const mutationA = sendLocalEvmControlCommand(activeRecord, 'SET_BALANCES', []);
  await firstEntered;
  await assert.rejects(sendLocalEvmControlCommand(activeRecord, 'RESET'));
  await assert.rejects(sendLocalEvmControlCommand(activeRecord, 'SET_BALANCES', []));
  assert.equal(handlerEntries, 1, 'rejected B and C never enter the mutation handler');
  releaseFirst();
  await mutationA;
  await sendLocalEvmControlCommand(activeRecord, 'RESET');
  assert.equal(handlerEntries, 2, 'D enters only after A releases its own lock');

  await new Promise((resolvePromise) => server.close(resolvePromise));
  removeLocalEvmControlRecord(activeRecord);
  activeRecord = undefined;
});

test('launcher has an exact host/chain and rejects ambient provider configuration', () => {
  const args = localEvmNodeArguments();
  assert.equal(args[args.indexOf('--hostname') + 1], '127.0.0.1');
  assert.equal(args[args.indexOf('--port') + 1], '18545');
  assert.equal(args[args.indexOf('--chain-id') + 1], '31337');
  assert.equal(args.includes('0.0.0.0'), false);
  assert.equal(localEvmProcessEnvironment({ NODE_OPTIONS: '--inspect' }).NODE_OPTIONS, undefined);
  assert.throws(
    () => assertNoAmbientProviderConfiguration({ EVM_RPC_URL: 'http://127.0.0.1:9' }),
    /ambient provider/u,
  );
  assert.throws(
    () => assertNoAmbientProviderConfiguration({ https_proxy: 'http://proxy.invalid' }),
    /ambient provider/u,
  );
  assert.throws(
    () => localEvmProcessEnvironment({ LOCAL_EVM_RPC_URL: 'http://localhost:18545' }),
    /non-canonical/u,
  );
});

test('JSON-RPC parser requires the exact own-data success envelope', () => {
  assert.equal(parseLocalEvmRpcResponse({ jsonrpc: '2.0', id: 7, result: 'ok' }, 7), 'ok');
  assert.throws(
    () => parseLocalEvmRpcResponse({ jsonrpc: '2.0', id: 7, result: 'ok', arbitrary: true }, 7),
    /LOCAL_EVM_RPC_INVALID_RESPONSE/u,
  );
  const getter = () => {
    throw new Error('must not read accessor');
  };
  const hostile = Object.create(null);
  Object.defineProperties(hostile, {
    jsonrpc: { enumerable: true, value: '2.0' },
    id: { enumerable: true, value: 7 },
    result: { enumerable: true, get: getter },
  });
  assert.throws(() => parseLocalEvmRpcResponse(hostile, 7), /LOCAL_EVM_RPC_INVALID_RESPONSE/u);
});

test('ownership records reject accessors, extra fields, and non-loopback control drift', () => {
  const source = forgedRecord(99_999);
  const hostile = Object.create(null);
  Object.defineProperties(hostile, {
    ...Object.fromEntries(
      Object.entries(source).map(([key, value]) => [key, { enumerable: true, value }]),
    ),
    launchId: {
      enumerable: true,
      get() {
        throw new Error('must not read accessor');
      },
    },
  });
  assert.throws(() => writeLocalEvmControlRecord(hostile), /Invalid local EVM control record/u);
  assert.equal(existsSync(LOCAL_EVM_CONTROL_FILE), false);
  assert.throws(() => writeLocalEvmControlRecord({ ...source, arbitrary: true }));
  assert.throws(() => writeLocalEvmControlRecord({ ...source, controlHost: '0.0.0.0' }));
  assert.equal(existsSync(LOCAL_EVM_CONTROL_FILE), false);
});
