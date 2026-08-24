// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SKIPPED_DIRECTORIES = new Set(['.next', 'coverage', 'node_modules', 'test']);

function runtimeTypescriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...runtimeTypescriptFiles(path));
    if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      files.push(path);
    }
  }
  return files;
}

describe('web logging source policy', () => {
  const webRoot = resolve(__dirname, '..');

  it('rejects free-form output and Edge runtime escapes in application-owned sources', () => {
    const violations: string[] = [];
    const forbidden = [
      /\bconsole\.(?:debug|error|info|log|warn)\s*\(/u,
      /process\.(?:stderr|stdout)\.write\s*\(/u,
      /export\s+const\s+runtime\s*=\s*['"]edge['"]/u,
    ];

    for (const file of runtimeTypescriptFiles(webRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(source)) {
          violations.push(`${relative(webRoot, file)} matched ${String(pattern)}`);
        }
      }
      if (
        /^\s*['"]use client['"];?/u.test(source) &&
        /(?:lib\/logging|lib\\logging|structured-logger\.server|web-runtime\.server)/u.test(source)
      ) {
        violations.push(`${relative(webRoot, file)} imports server logging from a client module`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('requires Next.js instrumentation to install both reviewed Node boundaries', () => {
    const source = readFileSync(resolve(webRoot, 'instrumentation.ts'), 'utf8');
    expect(source).toContain("process.env.NEXT_RUNTIME !== 'nodejs'");
    expect(source).toContain('registerWebNodeRuntime()');
    expect(source).toContain('recordWebRequestFailure(error, request, context)');
  });
});
