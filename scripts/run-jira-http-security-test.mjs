#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const candidates = process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe'] : ['pwsh'];
const script = resolve(import.meta.dirname, '..', 'jira_http_security.test.ps1');
const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];

for (const executable of candidates) {
  const result = spawnSync(executable, args, {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') continue;
  if (result.error) throw result.error;

  process.exitCode = result.status ?? 1;
  process.exit();
}

process.stderr.write('PowerShell is required to run the Jira HTTP security tests.\n');
process.exitCode = 1;
