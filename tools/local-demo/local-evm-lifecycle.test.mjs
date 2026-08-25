import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { waitForLocalEvm } from '../local-evm/json-rpc.mjs';
import {
  localEvmEndpointsAreAbsent,
  sendLocalEvmControlCommand,
} from '../local-evm/control-channel.mjs';
import { readLocalEvmControlRecord } from '../local-evm/runtime-state.mjs';
import { createLocalDemoEnvironments } from './environment.mjs';

const root = new URL('../..', import.meta.url);

async function waitForOwnership() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const record = readLocalEvmControlRecord();
      if (record?.state === 'RUNNING') {
        await sendLocalEvmControlCommand(record, 'STATUS');
        return record;
      }
    } catch {
      // Wait through the supervisor's atomic STARTING -> RUNNING transition.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Demo local EVM ownership was not recorded');
}

async function stopped(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => child.once('exit', resolve));
}

test('demo-managed local EVM is stopped by a separate verified teardown', async (t) => {
  const demoEnvironment = createLocalDemoEnvironments({ sourceEnvironment: {} }).identity;
  const managed = spawn(process.execPath, ['tools/local-evm/start.mjs'], {
    cwd: root,
    env: demoEnvironment,
    stdio: 'ignore',
    windowsHide: true,
  });
  t.after(async () => {
    if (readLocalEvmControlRecord() !== null) {
      spawnSync(process.execPath, ['tools/local-evm/teardown.mjs'], {
        cwd: root,
        env: demoEnvironment,
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    if (managed.exitCode === null && managed.signalCode === null) managed.kill('SIGTERM');
    await stopped(managed);
  });

  await waitForLocalEvm();
  const ownership = await waitForOwnership();
  assert.equal(ownership.state, 'RUNNING');
  assert.equal(ownership.purpose, 'LOCAL_DEMO');
  assert.equal(ownership.ownerPid, managed.pid);
  assert.notEqual(ownership.nodePid, managed.pid);
  assert.match(ownership.launchId, /^[0-9a-f]{32}$/u);

  const teardown = spawnSync(process.execPath, ['tools/local-evm/teardown.mjs'], {
    cwd: root,
    env: demoEnvironment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 20_000,
  });
  assert.equal(teardown.status, 0);
  assert.equal(teardown.stderr, '');
  await stopped(managed);
  assert.equal(managed.exitCode, 0);
  assert.equal(readLocalEvmControlRecord(), null);
  assert.equal(await localEvmEndpointsAreAbsent(), true);
});
