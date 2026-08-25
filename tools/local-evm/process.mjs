import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCAL_EVM_MANIFEST } from './manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hardhatCli = resolve(root, 'node_modules', 'hardhat', 'dist', 'src', 'cli.js');
const hardhatConfig = resolve(root, 'tools', 'local-evm', 'hardhat.config.ts');

const SAFE_INHERITED_NAMES = new Set([
  'APPDATA',
  'CI',
  'COLORTERM',
  'COMSPEC',
  'ComSpec',
  'FORCE_COLOR',
  'LOCALAPPDATA',
  'NO_COLOR',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'Path',
  'PROCESSOR_ARCHITECTURE',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'USERPROFILE',
  'WINDIR',
  'windir',
]);

const FORBIDDEN_AMBIENT_NAMES = new Set([
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALCHEMY_API_KEY',
  'INFURA_API_KEY',
  'QUICKNODE_API_KEY',
  'HELIUS_API_KEY',
  'WALLETCONNECT_PROJECT_ID',
  'EVM_RPC_URL',
  'SOLANA_RPC_URL',
  'BLOCKCHAIN_PROVIDER_URL',
  'ORACLE_URL',
  'PRICE_PROVIDER_URL',
]);

export function assertNoAmbientProviderConfiguration(source = process.env) {
  const forbidden = Object.keys(source).find((name) =>
    FORBIDDEN_AMBIENT_NAMES.has(name.toUpperCase()),
  );
  if (forbidden !== undefined) {
    throw new Error(`Local EVM refused ambient provider configuration: ${forbidden}`);
  }
  if (
    source.LOCAL_EVM_RPC_URL !== undefined &&
    source.LOCAL_EVM_RPC_URL !== LOCAL_EVM_MANIFEST.rpc.url
  ) {
    throw new Error('Local EVM refused a non-canonical local endpoint');
  }
}

export function localEvmProcessEnvironment(source = process.env) {
  assertNoAmbientProviderConfiguration(source);
  const safe = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && SAFE_INHERITED_NAMES.has(name)) safe[name] = value;
  }
  return Object.freeze({
    ...safe,
    HARDHAT_DISABLE_TELEMETRY: 'true',
    HARDHAT_TEST_TELEMETRY_ENABLED: 'false',
    LOCAL_EVM_RPC_URL: LOCAL_EVM_MANIFEST.rpc.url,
  });
}

export function localEvmNodeArguments() {
  return Object.freeze([
    hardhatCli,
    '--config',
    hardhatConfig,
    'node',
    '--network',
    'node',
    '--hostname',
    LOCAL_EVM_MANIFEST.rpc.host,
    '--port',
    String(LOCAL_EVM_MANIFEST.rpc.port),
    '--chain-id',
    String(LOCAL_EVM_MANIFEST.chainIdDecimal),
  ]);
}

/** Starts an owned child whose complete stdout/stderr is discarded. */
export function spawnLocalEvmNode(options = {}) {
  if (!existsSync(hardhatCli) || !existsSync(hardhatConfig)) {
    throw new Error('Pinned local EVM runtime is not installed');
  }
  const spawnImpl = options.spawnImpl ?? spawn;
  const child = spawnImpl(process.execPath, localEvmNodeArguments(), {
    cwd: root,
    env: localEvmProcessEnvironment(options.sourceEnvironment ?? process.env),
    // The IPC descriptor is a child-death tether, not an RPC/control channel.
    // If the supervisor is force-terminated, the OS closes it and the exact
    // Hardhat child exits through the disconnect handler in its config.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  // Hardhat's node logger can include RPC call data. No child output is ever
  // forwarded, retained, or included in an error.
  child.stdout?.resume();
  child.stderr?.resume();
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
    stopLocalEvmNode(child);
    throw new Error('Local EVM child did not expose a process identity');
  }
  return child;
}

export function stopLocalEvmNode(child) {
  if (typeof child !== 'object' || child === null || typeof child.kill !== 'function') {
    throw new TypeError('Invalid owned local EVM process');
  }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
}

/** Stops only the supplied owned ChildProcess handle and awaits that exact child. */
export async function stopLocalEvmNodeAndWait(child, options = {}) {
  if (typeof child !== 'object' || child === null || typeof child.kill !== 'function') {
    throw new TypeError('Invalid owned local EVM process');
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new TypeError('Invalid local EVM child stop timeout');
  }
  let timeout;
  const exited = new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
    timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      const forcedTimeout = setTimeout(
        () => reject(new Error('Owned local EVM child did not stop within the bounded window')),
        2_000,
      );
      forcedTimeout.unref();
      child.once('exit', () => clearTimeout(forcedTimeout));
    }, timeoutMs);
    timeout.unref();
  });
  stopLocalEvmNode(child);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

export const LOCAL_EVM_REPOSITORY_ROOT = root;
