import { spawn, spawnSync } from 'node:child_process';

import { LOCAL_DEMO_COMPOSE_PROJECT } from './environment.mjs';

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
