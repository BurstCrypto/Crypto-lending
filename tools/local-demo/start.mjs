import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  assertLocalDockerEndpoint,
  createLocalDemoEnvironments,
  LOCAL_DEMO_API_ORIGIN,
  LOCAL_DEMO_WEB_ORIGIN,
} from './environment.mjs';
import { composeArguments, runChecked, spawnOwned } from './processes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const environments = createLocalDemoEnvironments();

const dockerEndpoint = runChecked(
  'docker',
  ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
  { cwd: root, env: environments.identity, capture: true, label: 'Docker context inspection' },
);
let parsedDockerEndpoint;
try {
  parsedDockerEndpoint = JSON.parse(dockerEndpoint);
} catch {
  throw new Error('Docker context inspection returned an invalid endpoint');
}
assertLocalDockerEndpoint(parsedDockerEndpoint);

runChecked('docker', composeArguments('up'), {
  cwd: root,
  env: environments.identity,
  label: 'Local dependency startup',
});
runChecked('npm', ['run', 'db:migrate', '--workspace', '@crypto-lending/api'], {
  cwd: root,
  env: environments.migration,
  label: 'Local database migration',
});

const children = [
  spawnOwned(process.execPath, ['tools/local-demo/identity-provider.mjs'], {
    cwd: root,
    env: environments.identity,
  }),
  spawnOwned('npm', ['run', 'start:dev', '--workspace', '@crypto-lending/api'], {
    cwd: root,
    env: environments.api,
  }),
  spawnOwned('npm', ['run', 'dev', '--workspace', '@crypto-lending/web'], {
    cwd: root,
    env: environments.web,
  }),
  spawnOwned('npm', ['run', 'worker:outbox', '--workspace', '@crypto-lending/api'], {
    cwd: root,
    env: environments.worker,
  }),
];

let stopping = false;
function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 250).unref();
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
    'No wallet relay, RPC, oracle, cloud, or vendor endpoint is configured.',
    'Press Ctrl+C to stop application processes; run npm run demo:local:teardown to remove demo-owned containers and volumes.',
    '',
  ].join('\n'),
);
