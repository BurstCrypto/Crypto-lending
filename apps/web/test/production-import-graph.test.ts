// @vitest-environment node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = process.cwd();
const APP_ROOT = resolve(WEB_ROOT, 'app');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;
const NEXT_ENTRY_NAMES = new Set([
  'default',
  'error',
  'forbidden',
  'global-error',
  'global-not-found',
  'icon',
  'apple-icon',
  'layout',
  'loading',
  'manifest',
  'not-found',
  'opengraph-image',
  'page',
  'robots',
  'route',
  'sitemap',
  'template',
  'twitter-image',
  'unauthorized',
]);
const EXPECTED_SHIPPED_ROUTES = [
  { kind: 'PAGE', route: '/', source: 'app/page.tsx' },
  { kind: 'PAGE', route: '/account', source: 'app/account/page.tsx' },
  { kind: 'ROUTE', route: '/api/health', source: 'app/api/health/route.ts' },
  { kind: 'ROUTE', route: '/api/version', source: 'app/api/version/route.ts' },
  { kind: 'PAGE', route: '/login', source: 'app/login/page.tsx' },
  { kind: 'PAGE', route: '/platforms', source: 'app/platforms/page.tsx' },
  { kind: 'PAGE', route: '/portfolio', source: 'app/portfolio/page.tsx' },
  { kind: 'PAGE', route: '/register', source: 'app/register/page.tsx' },
] as const;

interface ImportEdge {
  readonly importer: string;
  readonly specifier: string;
  readonly target: string;
}

interface ImportGraph {
  readonly modules: ReadonlySet<string>;
  readonly edges: readonly ImportEdge[];
}

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ? [path]
      : [];
  });
}

function relativeWebPath(path: string): string {
  return relative(WEB_ROOT, path).split(sep).join('/');
}

function isWithinWebRoot(path: string): boolean {
  const candidate = relative(WEB_ROOT, path);
  return (
    candidate === '' ||
    (!candidate.startsWith(`..${sep}`) && candidate !== '..' && !isAbsolute(candidate))
  );
}

function sourceStem(path: string): string {
  const fileName = path.split(sep).at(-1);
  if (fileName === undefined) throw new Error(`Cannot determine source name for ${path}`);
  const extension = SOURCE_EXTENSIONS.find((candidate) => fileName.endsWith(candidate));
  return extension === undefined ? fileName : fileName.slice(0, -extension.length);
}

function productionEntries(): readonly string[] {
  return sourceFiles(APP_ROOT)
    .filter((path) => NEXT_ENTRY_NAMES.has(sourceStem(path)))
    .sort((left, right) => relativeWebPath(left).localeCompare(relativeWebPath(right)));
}

function addModuleSpecifier(specifiers: Set<string>, node: ts.Expression | undefined): void {
  if (node !== undefined && ts.isStringLiteralLike(node)) specifiers.add(node.text);
}

function parseModuleSpecifiers(path: string, sourceText: string): readonly string[] {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, false);
  const specifiers = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addModuleSpecifier(specifiers, node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addModuleSpecifier(specifiers, node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (
        node.arguments.length !== 1 ||
        argument === undefined ||
        !ts.isStringLiteralLike(argument)
      ) {
        throw new Error(
          `Production import graph cannot resolve a non-literal dynamic import in ${relativeWebPath(path)}`,
        );
      }
      specifiers.add(argument.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return [...specifiers];
}

function moduleSpecifiers(path: string): readonly string[] {
  return parseModuleSpecifiers(path, readFileSync(path, 'utf8'));
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('@/');
}

function isIgnoredAsset(specifier: string): boolean {
  return /\.(?:css|less|sass|scss)(?:[?#].*)?$/u.test(specifier);
}

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function existingFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function resolveLocalModule(importer: string, specifier: string): string | null {
  if (!isLocalSpecifier(specifier) || isIgnoredAsset(specifier)) return null;

  const cleanSpecifier = specifier.replace(/[?#].*$/u, '');
  const base = specifier.startsWith('@/')
    ? resolve(WEB_ROOT, cleanSpecifier.slice(2))
    : resolve(dirname(importer), cleanSpecifier);
  if (!isWithinWebRoot(base)) {
    throw new Error(
      `Production import escapes the web root: ${relativeWebPath(importer)} -> ${specifier}`,
    );
  }

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => resolve(base, `index${extension}`)),
  ];
  if (base.endsWith('.js')) {
    candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
  } else if (base.endsWith('.jsx')) {
    candidates.push(`${base.slice(0, -4)}.ts`, `${base.slice(0, -4)}.tsx`);
  }

  const resolved = candidates.find(existingFile);
  if (resolved === undefined) {
    throw new Error(
      `Production import graph could not resolve ${specifier} from ${relativeWebPath(importer)}`,
    );
  }
  return isSourceFile(resolved) ? resolved : null;
}

function buildImportGraph(entry: string): ImportGraph {
  const modules = new Set<string>();
  const edges: ImportEdge[] = [];
  const pending = [entry];

  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || modules.has(path)) continue;
    modules.add(path);

    for (const specifier of moduleSpecifiers(path)) {
      const target = resolveLocalModule(path, specifier);
      if (target === null) continue;
      edges.push({ importer: path, specifier, target });
      if (!modules.has(target)) pending.push(target);
    }
  }

  return { modules, edges };
}

function routePathFor(entry: string): string {
  const directory = relative(APP_ROOT, dirname(entry));
  if (directory === '') return '/';
  const segments = directory
    .split(sep)
    .filter((segment) => !segment.startsWith('(') && !segment.startsWith('@'));
  return `/${segments.join('/')}`;
}

function shippedRoutes(): readonly {
  readonly kind: 'PAGE' | 'ROUTE';
  readonly route: string;
  readonly source: string;
}[] {
  return productionEntries()
    .filter((entry) => ['page', 'route'].includes(sourceStem(entry)))
    .map((entry) => ({
      kind: sourceStem(entry) === 'page' ? ('PAGE' as const) : ('ROUTE' as const),
      route: routePathFor(entry),
      source: relativeWebPath(entry),
    }))
    .sort((left, right) => left.route.localeCompare(right.route));
}

function retiredSurface(path: string): string | null {
  const normalized = `/${relativeWebPath(path).toLowerCase()}`;
  if (normalized.includes('local-demo')) return 'local-demo';
  if (normalized.includes('evm-public-testnet')) return 'evm-public-testnet';
  if (normalized.includes('transaction-executor')) return 'transaction-executor';
  if (normalized.includes('public-testnet')) return 'public-testnet';
  if (normalized.includes('wallet-lab') || normalized.includes('/wallets/lab/')) {
    return 'wallet-lab';
  }
  return null;
}

function importChain(entry: string, graph: ImportGraph, target: string): readonly string[] {
  const parents = new Map<string, ImportEdge>();
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.shift();
    if (path === undefined || visited.has(path)) continue;
    visited.add(path);
    if (path === target) break;
    for (const edge of graph.edges.filter(({ importer }) => importer === path)) {
      if (!parents.has(edge.target)) parents.set(edge.target, edge);
      pending.push(edge.target);
    }
  }

  const chain = [target];
  while (chain[0] !== entry) {
    const parent = parents.get(chain[0] as string);
    if (parent === undefined) break;
    chain.unshift(parent.importer);
  }
  return chain.map(relativeWebPath);
}

describe('production import graph', () => {
  it('locks the exact shipped page and route-handler set', () => {
    const routes = shippedRoutes();

    expect(routes).toEqual(EXPECTED_SHIPPED_ROUTES);
    expect(routes.map(({ route }) => route)).not.toContainEqual(
      expect.stringMatching(/\/(?:demo|internal|testnet)(?:\/|$)/u),
    );
  });

  it('resolves static imports, re-exports, literal dynamic imports, aliases, and index files', () => {
    expect(
      parseModuleSpecifiers(
        'synthetic.ts',
        [
          "import './static';",
          "import type { Contract } from './contract';",
          "export * from './re-export';",
          "export { value } from './named-re-export';",
          "void import('./dynamic');",
          "import external from 'external-package';",
        ].join('\n'),
      ),
    ).toEqual([
      './static',
      './contract',
      './re-export',
      './named-re-export',
      './dynamic',
      'external-package',
    ]);

    const portfolioEntry = resolve(APP_ROOT, 'portfolio', 'page.tsx');
    const graph = buildImportGraph(portfolioEntry);
    const reached = [...graph.modules].map(relativeWebPath);

    expect(reached).toContain('components/portfolio/production-portfolio.tsx');
    expect(reached).toContain('lib/authentication/index.ts');
    expect(
      moduleSpecifiers(resolve(WEB_ROOT, 'lib', 'authentication', 'index.ts')).length,
    ).toBeGreaterThan(0);
  });

  it('keeps every deployable Next entry detached from retired runtime surfaces', () => {
    const violations = productionEntries().flatMap((entry) => {
      const graph = buildImportGraph(entry);
      return [...graph.modules].flatMap((modulePath) => {
        const surface = retiredSurface(modulePath);
        return surface === null
          ? []
          : [
              {
                entry: relativeWebPath(entry),
                surface,
                module: relativeWebPath(modulePath),
                importChain: importChain(entry, graph, modulePath),
              },
            ];
      });
    });

    expect(violations).toEqual([]);
  });
});
