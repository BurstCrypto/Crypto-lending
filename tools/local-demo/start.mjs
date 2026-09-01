import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  assertLocalDockerEndpoint,
  createLocalDemoEnvironments,
  LOCAL_DEMO_API_ORIGIN,
  LOCAL_DEMO_REQUIRED_DOCKER_IMAGES,
  LOCAL_DEMO_WEB_ORIGIN,
  withLocalEvmControlCredentials,
} from './environment.mjs';
import {
  composeArguments,
  localStackBuildArguments,
  resolveComposeInvocation,
  runChecked,
  spawnOwned,
} from './processes.mjs';
import { waitForLocalEvm } from '../local-evm/json-rpc.mjs';
import { LOCAL_EVM_MANIFEST } from '../local-evm/manifest.mjs';
import { sendLocalEvmControlCommand } from '../local-evm/control-channel.mjs';
import { readLocalEvmControlRecord } from '../local-evm/runtime-state.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiRoot = resolve(root, 'apps', 'api');
const webRoot = resolve(root, 'apps', 'web');
const require = createRequire(import.meta.url);
const nestCli = require.resolve('@nestjs/cli/bin/nest.js');
const nextCli = require.resolve('next/dist/bin/next');
const tsNodeCli = require.resolve('ts-node/dist/bin.js');
const tsxCli = require.resolve('tsx/cli');
// Next can otherwise download an SWC fallback on first use. Prove the locked,
// installed native compiler is usable before touching Docker.
require('next/dist/build/swc').transformSync('const localDemoCompilerProbe = true;', {});
const environments = createLocalDemoEnvironments();

runChecked(process.execPath, [tsxCli, 'tools/local-demo/configuration-preflight.ts'], {
  cwd: root,
  env: environments.identity,
  label: 'Local application configuration preflight',
});

const dockerEndpoint = runChecked(
  'docker',
  ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
  { cwd: root, env: environments.docker, capture: true, label: 'Docker context inspection' },
);
let parsedDockerEndpoint;
try {
  parsedDockerEndpoint = JSON.parse(dockerEndpoint);
} catch {
  throw new Error('Docker context inspection returned an invalid endpoint');
}
assertLocalDockerEndpoint(parsedDockerEndpoint);

const compose = resolveComposeInvocation({ cwd: root, env: environments.docker });

for (const imageName of LOCAL_DEMO_REQUIRED_DOCKER_IMAGES) {
  runChecked('docker', ['image', 'inspect', '--format', '{{.Id}}', imageName], {
    cwd: root,
    env: environments.docker,
    capture: true,
    label: 'Required cached Docker image inspection',
  });
}

runChecked('docker', localStackBuildArguments(), {
  cwd: root,
  env: environments.docker,
  label: 'Offline LocalStack image build',
});

runChecked(compose.command, [...compose.prefix, ...composeArguments('up')], {
  cwd: root,
  env: environments.docker,
  label: 'Local dependency startup',
});
runChecked(process.execPath, [tsxCli, 'src/infrastructure/database/migration.cli.ts', 'up'], {
  cwd: apiRoot,
  env: environments.migration,
  label: 'Local database migration',
});

const localEvm = spawnOwned(process.execPath, ['tools/local-evm/start.mjs'], {
  cwd: root,
  env: environments.identity,
});
let localEvmOwnership;
try {
  await waitForLocalEvm();
  const ownershipDeadline = Date.now() + 5_000;
  while (Date.now() < ownershipDeadline && localEvm.exitCode === null) {
    try {
      const candidate = readLocalEvmControlRecord();
      if (candidate?.state === 'RUNNING') {
        await sendLocalEvmControlCommand(candidate, 'STATUS');
        localEvmOwnership = candidate;
        break;
      }
    } catch {
      // The owner publishes its final authenticated record atomically.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  if (
    localEvmOwnership?.ownerPid !== localEvm.pid ||
    localEvmOwnership?.purpose !== 'LOCAL_DEMO' ||
    localEvm.exitCode !== null
  ) {
    throw new Error('Local demo refused a local EVM process it does not own');
  }
} catch (error) {
  if (localEvm.exitCode === null) localEvm.kill('SIGTERM');
  throw error;
}
const apiEnvironment = withLocalEvmControlCredentials(environments.api, localEvmOwnership);

const children = [
  localEvm,
  spawnOwned(process.execPath, ['tools/local-demo/identity-provider.mjs'], {
    cwd: root,
    env: environments.identity,
  }),
  // Keep the demo API on one compiled process. A Nest watch restart briefly
  // drops the listener and clears the authenticated in-memory demo wallet roster.
  spawnOwned(process.execPath, [nestCli, 'start'], {
    cwd: apiRoot,
    env: apiEnvironment,
  }),
  // Webpack can resolve the shared node_modules directory used by Git worktrees;
  // Turbopack intentionally refuses files outside its detected worktree root.
  spawnOwned(process.execPath, [nextCli, 'dev', '--webpack', '--hostname', '127.0.0.1'], {
    cwd: webRoot,
    env: environments.web,
  }),
  // ts-node preserves Nest's decorator metadata; tsx intentionally does not.
  spawnOwned(process.execPath, [tsNodeCli, 'src/infrastructure/outbox/outbox-worker.cli.ts'], {
    cwd: apiRoot,
    env: environments.worker,
  }),
];

let stopping = false;
function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children.slice(1)) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  let finalExitCode = exitCode;
  try {
    runChecked(process.execPath, ['tools/local-evm/teardown.mjs'], {
      cwd: root,
      env: environments.identity,
      capture: true,
      label: 'Local EVM teardown',
    });
  } catch {
    finalExitCode = 1;
  }
  setTimeout(() => process.exit(finalExitCode), 250).unref();
}

for (const child of children) {
  child.once('error', () => stop(1));
  child.once('exit', (code) => {
    if (!stopping) stop(code === 0 ? 0 : 1);
  });
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));

process.stdout.write(
  [
    '',
    'Synthetic local demo processes are starting.',
    `Web: ${LOCAL_DEMO_WEB_ORIGIN}`,
    `API: ${LOCAL_DEMO_API_ORIGIN}/api/v1/health`,
    `EVM: ${LOCAL_EVM_MANIFEST.runtimeIdentity} (${LOCAL_EVM_MANIFEST.networkId}) at ${LOCAL_EVM_MANIFEST.rpc.url}`,
    'The managed model stays local. Two independent optional proofs are available: exactly 0.00005 native ETH through the fixed Aave WETH route on Base Sepolia and exactly 0.01 native SOL through the fixed Save/Solend route on Solana Devnet.',
    'Use a selected MetaMask or Coinbase Wallet for Base and a selected Wallet Standard wallet for Solana. Running both requires two separate approvals; there is no atomic cross-chain transaction or ERC-20 allowance approval.',
    'Fund the EVM test wallet to at least 0.0001 Base Sepolia ETH with the official Coinbase CDP faucet, and use only free, valueless Devnet SOL from https://faucet.solana.com/. Never use Mainnet funds or share a seed phrase.',
    'Each chain has an independent write lock and read-only recovery path and never automatically resends an ambiguous transaction. The dashboards show current on-chain supply APY, not a usual or historical APY, and provide one coordinated full-position withdrawal action for eligible Base Sepolia and Solana Devnet positions.',
    'Withdrawals are not atomic across chains: Base may require an aWETH approval plus an Aave withdrawal confirmation, while Solana uses one redeem-and-unwrap confirmation. A completed chain is never rolled back or retried because the other chain fails.',
    'Press Ctrl+C to stop application processes; run npm run demo:local:teardown to remove demo-owned containers and volumes.',
    '',
  ].join('\n'),
);
