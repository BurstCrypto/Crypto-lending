import { spawn, spawnSync } from 'node:child_process';

import {
  LOCAL_DEMO_COMPOSE_PROJECT,
  LOCAL_DEMO_LOCALSTACK_IMAGE,
  LOCAL_DEMO_OWNERSHIP_LABEL,
  LOCAL_DEMO_OWNERSHIP_VALUE,
} from './environment.mjs';

export function executable(name) {
  return process.platform === 'win32' && name === 'npm' ? 'npm.cmd' : name;
}

export function runChecked(command, args, options) {
  const result = spawnSync(executable(command), args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout || '').trim() : '';
    throw new Error(`${options.label} failed${detail ? `: ${detail}` : ''}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

export function spawnOwned(command, args, options) {
  return spawn(executable(command), args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit',
    windowsHide: true,
  });
}

export function composeArguments(action) {
  const prefix = [
    'compose',
    '--project-directory',
    '.',
    '--env-file',
    'tools/local-demo/compose.safe.env',
    '--file',
    'docker-compose.yml',
    '--file',
    'tools/local-demo/docker-compose.local-demo.yml',
    '--project-name',
    LOCAL_DEMO_COMPOSE_PROJECT,
  ];
  if (action === 'up') {
    return [
      ...prefix,
      'up',
      '--detach',
      '--wait',
      '--pull',
      'never',
      '--no-build',
      'postgres',
      'redis',
      'localstack',
    ];
  }
  if (action === 'down') {
    return [...prefix, 'down', '--volumes', '--remove-orphans'];
  }
  throw new Error('Unknown local demo compose action');
}

const LOCAL_DEMO_RESOURCE_QUERIES = Object.freeze([
  Object.freeze({
    kind: 'container',
    list: Object.freeze([
      'container',
      'ls',
      '--all',
      '--filter',
      `label=com.docker.compose.project=${LOCAL_DEMO_COMPOSE_PROJECT}`,
      '--format',
      '{{.ID}}',
    ]),
    inspectPath: '.Config.Labels',
  }),
  Object.freeze({
    kind: 'volume',
    list: Object.freeze([
      'volume',
      'ls',
      '--filter',
      `label=com.docker.compose.project=${LOCAL_DEMO_COMPOSE_PROJECT}`,
      '--format',
      '{{.Name}}',
    ]),
    inspectPath: '.Labels',
  }),
  Object.freeze({
    kind: 'network',
    list: Object.freeze([
      'network',
      'ls',
      '--filter',
      `label=com.docker.compose.project=${LOCAL_DEMO_COMPOSE_PROJECT}`,
      '--format',
      '{{.ID}}',
    ]),
    inspectPath: '.Labels',
  }),
]);

export function localDemoResourceQueries() {
  return LOCAL_DEMO_RESOURCE_QUERIES;
}

export function parseLocalDemoResourceIdentifiers(output) {
  if (typeof output !== 'string') throw new Error('Invalid Docker resource listing');
  const identifiers = output.split(/\r?\n/u).filter(Boolean);
  if (identifiers.some((identifier) => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/u.test(identifier))) {
    throw new Error('Invalid Docker resource identifier');
  }
  return identifiers;
}

export function resourceLabelInspectionArguments(query, identifier) {
  if (!LOCAL_DEMO_RESOURCE_QUERIES.includes(query)) {
    throw new Error('Unknown local demo Docker resource query');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/u.test(identifier)) {
    throw new Error('Invalid Docker resource identifier');
  }
  return [query.kind, 'inspect', '--format', `{{json ${query.inspectPath}}}`, identifier];
}

export function assertLocalDemoResourceOwnership(rawLabels) {
  let labels;
  try {
    labels = JSON.parse(rawLabels);
  } catch {
    throw new Error('Local demo teardown found an unreadable Docker resource label set');
  }
  if (
    typeof labels !== 'object' ||
    labels === null ||
    Array.isArray(labels) ||
    labels['com.docker.compose.project'] !== LOCAL_DEMO_COMPOSE_PROJECT ||
    labels[LOCAL_DEMO_OWNERSHIP_LABEL] !== LOCAL_DEMO_OWNERSHIP_VALUE
  ) {
    throw new Error('Local demo teardown refused a resource not owned by KAN-253');
  }
}

export function localStackBuildArguments() {
  return [
    'build',
    '--pull=false',
    '--network',
    'none',
    '--tag',
    LOCAL_DEMO_LOCALSTACK_IMAGE,
    '--file',
    'infra/localstack/Dockerfile',
    'infra/localstack',
  ];
}
