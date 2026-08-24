import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function runtimeTypescriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ['.next', 'coverage', 'node_modules', 'test'].includes(entry.name)) {
      continue;
    }
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

describe('application logging source policy', () => {
  const sourceRoot = resolve(__dirname, '../..');
  const repositoryRoot = resolve(sourceRoot, '../../..');
  const webRoot = resolve(repositoryRoot, 'apps/web');

  it('rejects free-form runtime output, Nest Logger, and noisy dotenv imports', () => {
    const violations: string[] = [];
    const forbidden = [
      /\bconsole\.(?:debug|error|info|log|warn)\s*\(/u,
      /process\.(?:stderr|stdout)\.write\s*\(/u,
      /\bnew\s+Logger\s*\(/u,
      /['"]dotenv\/config['"]/u,
    ];

    for (const root of [sourceRoot, webRoot]) {
      for (const file of runtimeTypescriptFiles(root)) {
        const source = readFileSync(file, 'utf8');
        for (const pattern of forbidden) {
          if (pattern.test(source)) {
            violations.push(`${relative(repositoryRoot, file)} matched ${String(pattern)}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('requires the fatal boundary in every application-owned executable', () => {
    for (const relativePath of [
      'main.ts',
      'infrastructure/database/migration.cli.ts',
      'infrastructure/outbox/outbox-worker.cli.ts',
      'infrastructure/outbox/outbox-worker-health.cli.ts',
      'openapi/generate-openapi.ts',
    ]) {
      const source = readFileSync(resolve(sourceRoot, relativePath), 'utf8');
      expect(source).toContain('installFatalProcessBoundary(');
    }

    const webInstrumentation = readFileSync(resolve(webRoot, 'instrumentation.ts'), 'utf8');
    expect(webInstrumentation).toContain('registerWebNodeRuntime()');
    expect(webInstrumentation).toContain('recordWebRequestFailure(error, request, context)');
  });
});
