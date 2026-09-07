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
const FORBIDDEN_AMBIENT_VALUE_REFERENCES = new Set([
  'BroadcastChannel',
  'Bun',
  'Deno',
  'EventSource',
  'Function',
  'SharedWorker',
  'WebSocket',
  'WebTransport',
  'Worker',
  'XMLHttpRequest',
  'eval',
  'fetch',
  'global',
  'globalThis',
  'module',
  'navigator',
  'process',
  'queueMicrotask',
  'require',
  'self',
  'setImmediate',
  'setInterval',
  'setTimeout',
  'window',
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

/**
 * Property and declaration names do not read an ambient capability. Shorthand
 * properties are the exception because `{ fetch }` evaluates the identifier.
 * All other value references to reserved ambient roots are rejected, even
 * when a local binding shadows the global, so this source-only audit cannot be
 * bypassed by rebinding a dangerous global before use.
 */
function identifierIsValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (ts.isQualifiedName(parent) && parent.right === identifier) return false;
  if (ts.isBindingElement(parent)) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  if (
    (ts.isLabeledStatement(parent) ||
      ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) &&
    parent.label === identifier
  ) {
    return false;
  }
  return !('name' in parent && parent.name === identifier);
}

function inspectTypeScriptText(
  sourceText: string,
  sourceName: string,
): {
  readonly ambientViolations: readonly string[];
  readonly dependencies: readonly RuntimeDependency[];
} {
  const sourceFile = ts.createSourceFile(
    sourceName,
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
      ambientViolations.push(`${sourceName}: import-equals`);
    }
  }

  function inspectNode(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      ambientViolations.push(`${sourceName}: dynamic-import`);
    }
    if (
      ts.isIdentifier(node) &&
      FORBIDDEN_AMBIENT_VALUE_REFERENCES.has(node.text) &&
      identifierIsValueReference(node)
    ) {
      ambientViolations.push(`${sourceName}: reference ${node.text}`);
    }
    ts.forEachChild(node, inspectNode);
  }

  inspectNode(sourceFile);
  return { ambientViolations, dependencies };
}

function inspectTypeScriptSource(filePath: string): {
  readonly ambientViolations: readonly string[];
  readonly dependencies: readonly RuntimeDependency[];
} {
  return inspectTypeScriptText(readFileSync(filePath, 'utf8'), portableRelative(filePath));
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

  it('rejects indirect references that can alias ambient I/O and scheduling capabilities', () => {
    const inspection = inspectTypeScriptText(
      [
        'const request = globalThis.fetch;',
        'const delay = setTimeout;',
        'const runtime = process;',
        'const denoRuntime = Deno;',
        'const bunRuntime = Bun;',
        'const Socket = WebSocket;',
        'const beacon = navigator.sendBeacon;',
      ].join('\n'),
      'ambient-alias-fixture.ts',
    );

    expect(inspection.ambientViolations).toEqual([
      'ambient-alias-fixture.ts: reference globalThis',
      'ambient-alias-fixture.ts: reference setTimeout',
      'ambient-alias-fixture.ts: reference process',
      'ambient-alias-fixture.ts: reference Deno',
      'ambient-alias-fixture.ts: reference Bun',
      'ambient-alias-fixture.ts: reference WebSocket',
      'ambient-alias-fixture.ts: reference navigator',
    ]);
  });

  it('does not confuse inert property-name declarations with ambient references', () => {
    const inspection = inspectTypeScriptText(
      [
        'interface CapabilityLabels { readonly fetch: string; readonly process: string }',
        "const labels = { fetch: 'read', setTimeout: 'deferred', WebSocket: 'socket' };",
        'class NamesOnly { process(): string { return labels.fetch; } }',
        'const { fetch: readLabel, WebSocket: socketLabel } = labels;',
        'void [readLabel, socketLabel, NamesOnly];',
      ].join('\n'),
      'property-name-fixture.ts',
    );

    expect(inspection.ambientViolations).toEqual([]);
  });
});
