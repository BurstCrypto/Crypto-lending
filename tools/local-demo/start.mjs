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
  spawnOwned(process.execPath, [nestCli, 'start', '--watch'], {
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
    'No public RPC, wallet relay, oracle, cloud, or vendor endpoint is configured.',
    'Press Ctrl+C to stop application processes; run npm run demo:local:teardown to remove demo-owned containers and volumes.',
    '',
  ].join('\n'),
);
