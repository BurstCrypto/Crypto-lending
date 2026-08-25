import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { assertLocalDockerEndpoint, createLocalDemoEnvironments } from './environment.mjs';
import {
  assertLocalDemoResourceOwnership,
  composeArguments,
  localDemoResourceQueries,
  parseLocalDemoResourceIdentifiers,
  resolveComposeInvocation,
  resourceLabelInspectionArguments,
  runChecked,
} from './processes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const environments = createLocalDemoEnvironments();
const environment = environments.docker;
runChecked(process.execPath, ['tools/local-evm/teardown.mjs'], {
  cwd: root,
  env: environments.identity,
  label: 'Local EVM teardown',
});
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
const compose = resolveComposeInvocation({ cwd: root, env: environment });
for (const query of localDemoResourceQueries()) {
  const rawIdentifiers = runChecked('docker', query.list, {
    cwd: root,
    env: environment,
    capture: true,
    label: `Local demo ${query.kind} ownership listing`,
  });
  for (const identifier of parseLocalDemoResourceIdentifiers(rawIdentifiers)) {
    const rawLabels = runChecked('docker', resourceLabelInspectionArguments(query, identifier), {
      cwd: root,
      env: environment,
      capture: true,
      label: `Local demo ${query.kind} ownership inspection`,
    });
    assertLocalDemoResourceOwnership(rawLabels);
  }
}
runChecked(compose.command, [...compose.prefix, ...composeArguments('down')], {
  cwd: root,
  env: environment,
  label: 'Local demo teardown',
});
process.stdout.write('Removed only KAN-253-owned crypto-lending-local-demo resources.\n');
