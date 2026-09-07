import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

const API_SOURCE_ROOT = realpathSync(resolve(__dirname, '../..'));
const REGISTRATION_ENTRY = realpathSync(
  resolve(__dirname, 'provider-position-read-runtime.registration.ts'),
);
const MAX_RUNTIME_CLOSURE_FILES = 15;
const EXPECTED_RUNTIME_CLOSURE = Object.freeze([
  'accounts/domain/account-profile.ts',
  'blockchain/domain/chain-observation-policy.ts',
  'blockchain/domain/local-evm-development-manifest.json',
  'blockchain/domain/local-evm-development.ts',
  'blockchain/domain/mainnet-launch-network-policy.ts',
  'blockchain/domain/supported-asset-registry.ts',
  'mainnet-platforms/application/ports/mainnet-provider-position-reader.port.ts',
  'mainnet-platforms/domain/mainnet-provider-position-chain-assessment.ts',
  'mainnet-platforms/domain/mainnet-provider-position-coverage.ts',
  'mainnet-platforms/domain/mainnet-provider-position-observation-policy.ts',
  'mainnet-platforms/domain/mainnet-provider-position-observation.ts',
  'mainnet-platforms/infrastructure/provider-position-read-runtime.registration.ts',
  'portfolio/domain/active-portfolio-wallet-registrations.ts',
  'wallets/application/ports/wallet-registration-repository.port.ts',
  'wallets/domain/wallet-registration-launch-policy.ts',
] as const);
const EXPECTED_EXTERNAL_RUNTIME_IMPORTS = Object.freeze(['@nestjs/common', 'node:crypto']);
const FORBIDDEN_AMBIENT_CALLS = new Set([
  'Bun.connect',
  'Bun.file',
  'Bun.serve',
  'Bun.spawn',
  'Bun.write',
  'Deno.connect',
  'Deno.createHttpClient',
  'Deno.listen',
  'Deno.open',
  'Deno.openKv',
  'Deno.serve',
  'Deno.writeFile',
  'Deno.writeTextFile',
  'eval',
  'fetch',
  'Function',
  'globalThis.eval',
  'globalThis.fetch',
  'globalThis.Function',
  'globalThis.queueMicrotask',
  'globalThis.setImmediate',
  'globalThis.setInterval',
  'globalThis.setTimeout',
  'module.require',
  'navigator.sendBeacon',
  'process.getBuiltinModule',
  'queueMicrotask',
  'require',
  'setImmediate',
  'setInterval',
  'setTimeout',
]);
const FORBIDDEN_AMBIENT_CONSTRUCTORS = new Set([
  'EventSource',
  'Function',
  'WebSocket',
  'WebTransport',
  'Worker',
  'globalThis.EventSource',
  'globalThis.WebSocket',
  'globalThis.WebTransport',
  'globalThis.Worker',
  'globalThis.XMLHttpRequest',
  'XMLHttpRequest',
]);

interface ClosureAudit {
  readonly ambientViolations: readonly string[];
  readonly externalRuntimeImports: readonly string[];
  readonly files: readonly string[];
  readonly sideEffectImports: readonly string[];
}

interface RuntimeDependency {
  readonly sideEffectOnly: boolean;
  readonly specifier: string;
}

function portableRelative(filePath: string): string {
  return relative(API_SOURCE_ROOT, filePath).split(sep).join('/');
}

function expressionPath(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const receiver = expressionPath(expression.expression);
    return receiver === null ? null : `${receiver}.${expression.name.text}`;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    const receiver = expressionPath(expression.expression);
    return receiver === null ? null : `${receiver}.${expression.argumentExpression.text}`;
  }
  return null;
}

function importDeclarationIsRuntime(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined || clause.namedBindings === undefined) return true;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  if (clause.namedBindings.elements.length === 0) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationIsRuntime(statement: ts.ExportDeclaration): boolean {
  if (statement.isTypeOnly || statement.moduleSpecifier === undefined) return false;
  if (statement.exportClause === undefined || ts.isNamespaceExport(statement.exportClause)) {
    return true;
  }
  if (statement.exportClause.elements.length === 0) return true;
  return statement.exportClause.elements.some((element) => !element.isTypeOnly);
}

function inspectTypeScriptSource(filePath: string): {
  readonly ambientViolations: readonly string[];
  readonly dependencies: readonly RuntimeDependency[];
} {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const dependencies: RuntimeDependency[] = [];
  const ambientViolations: string[] = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      importDeclarationIsRuntime(statement)
    ) {
      dependencies.push({
        sideEffectOnly: statement.importClause === undefined,
        specifier: statement.moduleSpecifier.text,
      });
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier) &&
      exportDeclarationIsRuntime(statement)
    ) {
      dependencies.push({
        sideEffectOnly: false,
        specifier: statement.moduleSpecifier.text,
      });
    }
    if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly) {
      ambientViolations.push(`${portableRelative(filePath)}: import-equals`);
    }
  }

  function inspectNode(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        ambientViolations.push(`${portableRelative(filePath)}: dynamic-import`);
      } else {
        const callPath = expressionPath(node.expression);
        if (callPath !== null && FORBIDDEN_AMBIENT_CALLS.has(callPath)) {
          ambientViolations.push(`${portableRelative(filePath)}: call ${callPath}`);
        }
      }
    }
    if (ts.isNewExpression(node)) {
      const constructorPath = expressionPath(node.expression);
      if (constructorPath !== null && FORBIDDEN_AMBIENT_CONSTRUCTORS.has(constructorPath)) {
        ambientViolations.push(`${portableRelative(filePath)}: construct ${constructorPath}`);
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const accessPath = expressionPath(node);
      if (accessPath === 'process.env' || accessPath === 'Deno.env' || accessPath === 'Bun.env') {
        ambientViolations.push(`${portableRelative(filePath)}: access ${accessPath}`);
      }
    }
    ts.forEachChild(node, inspectNode);
  }

  inspectNode(sourceFile);
  return { ambientViolations, dependencies };
}

function resolveLocalRuntimeImport(importer: string, specifier: string): string {
  const unresolved = resolve(dirname(importer), specifier);
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${unresolved}.json`,
    resolve(unresolved, 'index.ts'),
    resolve(unresolved, 'index.tsx'),
  ];
  const match = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );

  if (match === undefined) {
    throw new Error(
      `Unresolved runtime import ${JSON.stringify(specifier)} from ${portableRelative(importer)}`,
    );
  }
  const resolved = realpathSync(match);
  const relativePath = portableRelative(resolved);
  if (relativePath === '..' || relativePath.startsWith('../')) {
    throw new Error(`Runtime import escaped the API source root: ${relativePath}`);
  }
  return resolved;
}

function auditRuntimeImportClosure(entryPath: string): ClosureAudit {
  const pending = [entryPath];
  const visited = new Set<string>();
  const externalRuntimeImports = new Set<string>();
  const ambientViolations: string[] = [];
  const sideEffectImports: string[] = [];

  while (pending.length > 0) {
    pending.sort((left, right) => left.localeCompare(right));
    const current = pending.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);

    if (visited.size > MAX_RUNTIME_CLOSURE_FILES) {
      throw new Error(
        `Provider-position registration runtime closure exceeded ${MAX_RUNTIME_CLOSURE_FILES} files`,
      );
    }
    if (extname(current) === '.json') continue;

    const inspection = inspectTypeScriptSource(current);
    ambientViolations.push(...inspection.ambientViolations);
    for (const dependency of inspection.dependencies) {
      if (dependency.sideEffectOnly) {
        sideEffectImports.push(
          `${portableRelative(current)} -> ${JSON.stringify(dependency.specifier)}`,
        );
      }
      if (!dependency.specifier.startsWith('.')) {
        externalRuntimeImports.add(dependency.specifier);
        continue;
      }
      const resolvedDependency = resolveLocalRuntimeImport(current, dependency.specifier);
      if (!visited.has(resolvedDependency)) pending.push(resolvedDependency);
    }
  }

  return {
    ambientViolations: ambientViolations.sort(),
    externalRuntimeImports: [...externalRuntimeImports].sort(),
    files: [...visited].map(portableRelative).sort(),
    sideEffectImports: sideEffectImports.sort(),
  };
}

describe('provider-position read runtime import closure', () => {
  it('stays inside the reviewed pure 15-file closure without loading any closure module', () => {
    const audit = auditRuntimeImportClosure(REGISTRATION_ENTRY);

    expect(audit.files).toEqual(EXPECTED_RUNTIME_CLOSURE);
    expect(audit.externalRuntimeImports).toEqual(EXPECTED_EXTERNAL_RUNTIME_IMPORTS);
    expect(audit.sideEffectImports).toEqual([]);
    expect(audit.ambientViolations).toEqual([]);
  });
});
