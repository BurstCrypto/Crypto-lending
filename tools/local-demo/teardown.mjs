import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { assertLocalDockerEndpoint, createLocalDemoEnvironments } from './environment.mjs';
import { composeArguments, runChecked } from './processes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const environment = createLocalDemoEnvironments().identity;
const rawEndpoint = runChecked(
  'docker',
  ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
  { cwd: root, env: environment, capture: true, label: 'Docker context inspection' },
);
let endpoint;
try {
  endpoint = JSON.parse(rawEndpoint);
} catch {
  throw new Error('Docker context inspection returned an invalid endpoint');
}
assertLocalDockerEndpoint(endpoint);
runChecked('docker', composeArguments('down'), {
  cwd: root,
  env: environment,
  label: 'Local demo teardown',
});
process.stdout.write('Removed only crypto-lending-local-demo containers and volumes.\n');
