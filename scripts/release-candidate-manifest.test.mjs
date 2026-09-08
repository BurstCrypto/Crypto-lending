import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  RELEASE_COMPONENTS,
  RELEASE_MANIFEST_DOMAIN,
  RELEASE_MANIFEST_PATH,
  RELEASE_STAGE_PATH,
  REPOSITORY_ROOT,
  ReleaseManifestError,
  canonicalJson,
  closeReleaseFileDescriptorForTest,
  copyReleaseArtifactFileForTest,
  createReleaseManifest,
  fingerprintReleaseArtifactFileForTest,
  inspectCleanGitSource,
  isVerifiedReleaseManifest,
  loadAndVerifyReleaseManifest,
  parseReleaseManifest,
  readReleaseManifestFileForTest,
  revalidateVerifiedReleaseManifest,
  runCli,
  sealReleaseCandidateStage,
  validateReleaseManifest,
  verifyReleaseManifest,
} from './release-candidate-manifest.mjs';

const SOURCE = Object.freeze({ revision: 'a'.repeat(40), tree: 'b'.repeat(40) });
const BUILDER = Object.freeze({
  architecture: 'x64',
  nodeVersion: 'v22.22.0',
  platform: 'linux',
});
const DEPLOYMENT_RUNTIME_ENTRIES = Object.freeze([
  'infra/aws/validate-production-deployment-intent.mjs',
  'scripts/production-deployment-enrollment.mjs',
  'infra/aws/validate-production-deployment-chain-protocol.mjs',
]);
const DEPLOYMENT_RUNTIME_MODULE_POLICY = Object.freeze({
  [DEPLOYMENT_RUNTIME_ENTRIES[0]]: Object.freeze({
    imports: Object.freeze([
      '../../scripts/production-deployment-target.mjs|isVerifiedProductionDeploymentDestination,resolveProductionDeploymentDestination,resolveProductionDeploymentDestinationWithTestRegistry',
      '../shared/parse-strict-json.mjs|parseStrictJsonBytes',
      '../shared/read-secure-local-file.mjs|readSecureLocalFile',
      '../shared/validate-ed25519-public-key.mjs|validateEd25519PublicKeyBytes',
      'node:crypto|createHash,createPublicKey,verify as verifySignature',
      'node:path|dirname,isAbsolute,join,relative,resolve',
      'node:perf_hooks|performance',
      'node:url|fileURLToPath',
      'node:util|TextDecoder,types as utilTypes',
    ]),
    processMembers: Object.freeze(['argv', 'exitCode', 'platform', 'stderr', 'stdout']),
  }),
  [DEPLOYMENT_RUNTIME_ENTRIES[1]]: Object.freeze({
    imports: Object.freeze([
      '../infra/shared/parse-strict-json.mjs|parseStrictJsonBytes',
      '../infra/shared/validate-ed25519-public-key.mjs|validateEd25519PublicKeyBytes',
      './production-deployment-target.mjs|isVerifiedProductionDeploymentDestination,productionDeploymentTargetSha256,resolveProductionDeploymentDestination,resolveProductionDeploymentDestinationWithTestRegistry',
      'node:crypto|createHash,createPublicKey,verify as verifySignature',
      'node:perf_hooks|performance',
      'node:util|TextDecoder,types as utilTypes',
    ]),
    processMembers: Object.freeze([]),
  }),
  [DEPLOYMENT_RUNTIME_ENTRIES[2]]: Object.freeze({
    imports: Object.freeze(['node:crypto|createHash', 'node:util|types as utilTypes']),
    processMembers: Object.freeze([]),
  }),
  'infra/shared/parse-strict-json.mjs': Object.freeze({
    imports: Object.freeze(['node:util|TextDecoder']),
    processMembers: Object.freeze([]),
  }),
  'infra/shared/read-secure-local-file.mjs': Object.freeze({
    imports: Object.freeze([
      'node:fs|closeSync,constants as fsConstants,fstatSync,lstatSync,openSync,readSync,realpathSync',
      'node:path|isAbsolute,join,normalize,parse,relative,resolve',
    ]),
    processMembers: Object.freeze(['platform']),
  }),
  'infra/shared/validate-ed25519-public-key.mjs': Object.freeze({
    imports: Object.freeze(['node:util|types as utilTypes']),
    processMembers: Object.freeze([]),
  }),
  'scripts/production-deployment-target.mjs': Object.freeze({
    imports: Object.freeze(['node:crypto|createHash', 'node:net|isIP']),
    processMembers: Object.freeze([]),
  }),
});
const FORBIDDEN_DIRECT_CAPABILITIES = new Set([
  'EventSource',
  'Function',
  'WebSocket',
  'XMLHttpRequest',
  'eval',
  'fetch',
  'module',
  'navigator',
  'require',
]);
const FORBIDDEN_REFLECTIVE_PROPERTIES = new Set(['__proto__', 'constructor']);
const temporaryDirectories = [];

function makeRemovable(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) makeRemovable(resolve(path, name));
    return;
  }
  chmodSync(path, 0o600);
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    makeRemovable(path);
    rmSync(path, { recursive: true, force: true });
  }
});

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'crypto-lending-release-manifest-'));
  temporaryDirectories.push(path);
  return path;
}

function write(root, path, contents = path) {
  const absolutePath = resolve(root, ...path.split('/'));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, 'utf8');
  return absolutePath;
}

function createWorkspace() {
  const root = temporaryDirectory();
  for (const component of RELEASE_COMPONENTS) {
    if (component.kind === 'file') {
      write(root, component.path, `${component.name}\n`);
      continue;
    }
    for (const requiredFile of component.requiredFiles) {
      write(root, `${component.path}/${requiredFile}`, `${component.name}:${requiredFile}\n`);
    }
    if (component.requiredFiles.length === 0) {
      write(root, `${component.path}/asset.js`, `${component.name}\n`);
    }
  }
  return root;
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initializeRepository(root) {
  write(root, '.gitignore', '.local-validation\n');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Release Test']);
  git(root, ['config', 'user.email', 'release-test@example.invalid']);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  return {
    revision: git(root, ['rev-parse', 'HEAD']),
    tree: git(root, ['rev-parse', 'HEAD^{tree}']),
  };
}

function importDescriptor(node) {
  assert.ok(ts.isStringLiteral(node.moduleSpecifier));
  assert.equal(node.attributes, undefined);
  const bindings = [];
  const clause = node.importClause;
  assert.ok(
    clause,
    'Side-effect-only imports are not permitted in the offline deployment closure.',
  );
  if (clause.name) bindings.push(`default as ${clause.name.text}`);
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push(`* as ${clause.namedBindings.name.text}`);
    } else {
      for (const element of clause.namedBindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        bindings.push(
          imported === element.name.text ? imported : `${imported} as ${element.name.text}`,
        );
      }
    }
  }
  return `${node.moduleSpecifier.text}|${bindings.sort().join(',')}`;
}

function processMember(node) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return parent.name.text;
  if (
    ts.isElementAccessExpression(parent) &&
    parent.expression === node &&
    ts.isStringLiteral(parent.argumentExpression)
  ) {
    return parent.argumentExpression.text;
  }
  return undefined;
}

function accessedStaticProperty(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    (ts.isStringLiteral(node.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function identifierIsValueReference(node) {
  const parent = node.parent;
  if (ts.isDeclarationName(node)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  return true;
}

function unwrapExpression(node) {
  return ts.isParenthesizedExpression(node) ? unwrapExpression(node.expression) : node;
}

function isFsConstant(node, name) {
  const expression = unwrapExpression(node);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'fsConstants' &&
    expression.name.text === name
  );
}

function isSafeNoFollowInitializer(node) {
  const expression = unwrapExpression(node);
  if (ts.isNumericLiteral(expression)) return expression.text === '0';
  if (isFsConstant(expression, 'O_NOFOLLOW')) return true;
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    return (
      isSafeNoFollowInitializer(expression.left) && isSafeNoFollowInitializer(expression.right)
    );
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      isSafeNoFollowInitializer(expression.whenTrue) &&
      isSafeNoFollowInitializer(expression.whenFalse)
    );
  }
  return false;
}

function isReadOnlyOpenFlags(node, safeNoFollowBinding) {
  const expression = unwrapExpression(node);
  if (isFsConstant(expression, 'O_RDONLY') || isFsConstant(expression, 'O_NOFOLLOW')) return true;
  if (ts.isNumericLiteral(expression)) return expression.text === '0';
  if (ts.isIdentifier(expression)) return expression.text === 'noFollow' && safeNoFollowBinding;
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.BarToken &&
    isReadOnlyOpenFlags(expression.left, safeNoFollowBinding) &&
    isReadOnlyOpenFlags(expression.right, safeNoFollowBinding)
  );
}

function inspectDeploymentRuntimeModule(modulePath, source) {
  const policy = DEPLOYMENT_RUNTIME_MODULE_POLICY[modulePath];
  assert.ok(policy, `Unreviewed local module in deployment-runtime closure: ${modulePath}`);
  const parsed = ts.createSourceFile(
    modulePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(parsed.parseDiagnostics.length, 0, `Invalid JavaScript in ${modulePath}`);
  const imports = [];
  const localImports = [];
  let safeNoFollowDeclaration;

  function inspectBinding(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'noFollow'
    ) {
      assert.equal(
        safeNoFollowDeclaration,
        undefined,
        `Duplicate noFollow binding in ${modulePath}`,
      );
      assert.ok(
        node.initializer &&
          ts.isVariableDeclarationList(node.parent) &&
          (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
          isSafeNoFollowInitializer(node.initializer),
        `Unsafe noFollow binding in ${modulePath}`,
      );
      safeNoFollowDeclaration = node.name;
    }
    ts.forEachChild(node, inspectBinding);
  }
  inspectBinding(parsed);

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const descriptor = importDescriptor(node);
      imports.push(descriptor);
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith('./') || specifier.startsWith('../')) localImports.push(specifier);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      assert.fail(`Runtime re-exports are not permitted in ${modulePath}`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.fail(`Dynamic import is not permitted in ${modulePath}`);
    }
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      FORBIDDEN_REFLECTIVE_PROPERTIES.has(accessedStaticProperty(node))
    ) {
      assert.fail(`Direct reflective capability access is not permitted in ${modulePath}`);
    }
    if (
      ts.isIdentifier(node) &&
      identifierIsValueReference(node) &&
      FORBIDDEN_DIRECT_CAPABILITIES.has(node.text)
    ) {
      assert.fail(`Direct ${node.text} capability is not permitted in ${modulePath}`);
    }
    if (
      ts.isIdentifier(node) &&
      identifierIsValueReference(node) &&
      (node.text === 'global' ||
        node.text === 'globalThis' ||
        node.text === 'Bun' ||
        node.text === 'Deno')
    ) {
      assert.fail(`Ambient ${node.text} capability is not permitted in ${modulePath}`);
    }
    if (ts.isIdentifier(node) && node.text === 'openSync' && identifierIsValueReference(node)) {
      const call = node.parent;
      assert.ok(
        ts.isCallExpression(call) &&
          call.expression === node &&
          call.arguments.length === 2 &&
          isReadOnlyOpenFlags(call.arguments[1], safeNoFollowDeclaration !== undefined),
        `openSync must remain a direct read-only call in ${modulePath}`,
      );
    }
    if (
      ts.isIdentifier(node) &&
      node.text === 'noFollow' &&
      ts.isDeclarationName(node) &&
      node !== safeNoFollowDeclaration
    ) {
      assert.fail(`Shadowed noFollow binding is not permitted in ${modulePath}`);
    }
    if (ts.isIdentifier(node) && node.text === 'process') {
      assert.ok(
        policy.processMembers.includes(processMember(node)),
        `Unreviewed process capability in ${modulePath}`,
      );
    }
    if (ts.isIdentifier(node) && node.text === 'fsConstants' && identifierIsValueReference(node)) {
      const access = node.parent;
      assert.ok(
        ts.isPropertyAccessExpression(access) &&
          access.expression === node &&
          (access.name.text === 'O_RDONLY' || access.name.text === 'O_NOFOLLOW'),
        `Only read-only filesystem flags are permitted in ${modulePath}`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.deepEqual(
    imports.sort(),
    [...policy.imports].sort(),
    `Import capability drift in ${modulePath}`,
  );
  return localImports;
}

function deploymentRuntimeLocalClosure(entries, root = REPOSITORY_ROOT) {
  const pending = [...entries];
  const inspected = new Set();
  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (inspected.has(modulePath)) continue;
    inspected.add(modulePath);
    const absolutePath = resolve(root, ...modulePath.split('/'));
    const source = readFileSync(absolutePath, 'utf8');
    for (const specifier of inspectDeploymentRuntimeModule(modulePath, source)) {
      assert.match(specifier, /^\.\.?\/.+\.mjs$/u);
      const dependencyPath = relative(root, resolve(dirname(absolutePath), specifier)).replaceAll(
        '\\',
        '/',
      );
      assert.doesNotMatch(dependencyPath, /^\.\.\//u);
      pending.push(dependencyPath);
    }
  }
  return [...inspected].sort();
}

function resignComponent(component) {
  component.fileCount = component.files.length;
  component.totalBytes = component.files.reduce((sum, file) => sum + file.size, 0);
  const payload = {
    kind: component.kind,
    name: component.name,
    path: component.path,
    files: component.files,
  };
  component.sha256 = createHash('sha256')
    .update(`crypto-lending/release-component/v1/${component.name}\0`, 'utf8')
    .update(canonicalJson(payload), 'utf8')
    .digest('hex');
}

function expandComponentToFileCount(component, fileCount) {
  const filesByPath = new Map(component.files.map((file) => [file.path, file]));
  for (let index = 0; filesByPath.size < fileCount; index += 1) {
    const path = `generated/${String(index).padStart(5, '0')}.js`;
    filesByPath.set(path, { path, sha256: '0'.repeat(64), size: 0 });
  }
  component.files = [...filesByPath.values()].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')),
  );
  resignComponent(component);
}

test('creates a deterministic canonical manifest for the fixed release surface', () => {
  const root = createWorkspace();
  const first = createReleaseManifest(root, SOURCE, BUILDER);
  const second = createReleaseManifest(root, SOURCE, BUILDER);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.components.map(({ name, path }) => ({ name, path })),
    RELEASE_COMPONENTS.map(({ name, path }) => ({ name, path })),
  );
  assert.match(first.payloadSha256, /^[0-9a-f]{64}$/u);
  assert.equal(RELEASE_MANIFEST_DOMAIN, 'crypto-lending/release-candidate-manifest/v1\0');

  const text = `${canonicalJson(first)}\n`;
  assert.deepEqual(parseReleaseManifest(text), first);
  assert.deepEqual(verifyReleaseManifest(root, first), first);
});

test('requires the compiled dormant balance-consumer CLI in the API runtime', () => {
  const requiredPath = 'blockchain-sync/application/balance-sync-consumer.cli.js';
  const apiRuntime = RELEASE_COMPONENTS.find(({ name }) => name === 'api-runtime');
  assert.ok(apiRuntime);
  assert.ok(apiRuntime.requiredFiles.includes(requiredPath));

  const root = createWorkspace();
  rmSync(resolve(root, 'apps/api/dist', ...requiredPath.split('/')));
  assert.throws(() => createReleaseManifest(root, SOURCE, BUILDER), /entry point/u);
});

test('binds both exact production image SBOM, native, and archive records as staged components', () => {
  const root = createWorkspace();
  const apiBytes = '{"name":"api-exact-sbom-bytes"}\n';
  const webBytes = '{"name":"web-exact-sbom-bytes"}\n';
  const apiBindingBytes = '{"name":"api-exact-image-binding-bytes"}\n';
  const webBindingBytes = '{"name":"web-exact-image-binding-bytes"}\n';
  const apiArchiveBindingBytes = '{"name":"api-exact-image-archive-binding-bytes"}\n';
  const webArchiveBindingBytes = '{"name":"web-exact-image-archive-binding-bytes"}\n';
  writeFileSync(
    resolve(root, '.local-validation/production-sbom/api-image.spdx.json'),
    apiBytes,
    'utf8',
  );
  writeFileSync(
    resolve(root, '.local-validation/production-sbom/web-image.spdx.json'),
    webBytes,
    'utf8',
  );
  writeFileSync(
    resolve(root, '.local-validation/production-sbom/api-image.syft.json'),
    apiBindingBytes,
    'utf8',
  );
  writeFileSync(
    resolve(root, '.local-validation/production-sbom/web-image.syft.json'),
    webBindingBytes,
    'utf8',
  );
  writeFileSync(
    resolve(root, '.local-validation/production-sbom/api-image.binding.json'),
    apiArchiveBindingBytes,
    'utf8',
  );
  writeFileSync(
    resolve(root, '.local-validation/production-sbom/web-image.binding.json'),
    webArchiveBindingBytes,
    'utf8',
  );

  const manifest = createReleaseManifest(root, SOURCE, BUILDER);
  const api = manifest.components.find(({ name }) => name === 'api-production-image-sbom');
  const web = manifest.components.find(({ name }) => name === 'web-production-image-sbom');
  const apiBinding = manifest.components.find(
    ({ name }) => name === 'api-production-image-binding-record',
  );
  const webBinding = manifest.components.find(
    ({ name }) => name === 'web-production-image-binding-record',
  );
  const apiArchiveBinding = manifest.components.find(
    ({ name }) => name === 'api-production-image-archive-binding',
  );
  const webArchiveBinding = manifest.components.find(
    ({ name }) => name === 'web-production-image-archive-binding',
  );
  assert.equal(api.path, '.local-validation/production-sbom/api-image.spdx.json');
  assert.equal(web.path, '.local-validation/production-sbom/web-image.spdx.json');
  assert.equal(api.files[0].sha256, createHash('sha256').update(apiBytes).digest('hex'));
  assert.equal(web.files[0].sha256, createHash('sha256').update(webBytes).digest('hex'));
  assert.equal(
    apiBinding.files[0].sha256,
    createHash('sha256').update(apiBindingBytes).digest('hex'),
  );
  assert.equal(
    webBinding.files[0].sha256,
    createHash('sha256').update(webBindingBytes).digest('hex'),
  );
  assert.equal(
    apiArchiveBinding.files[0].sha256,
    createHash('sha256').update(apiArchiveBindingBytes).digest('hex'),
  );
  assert.equal(
    webArchiveBinding.files[0].sha256,
    createHash('sha256').update(webArchiveBindingBytes).digest('hex'),
  );

  appendFileSync(
    resolve(root, '.local-validation/production-sbom/api-image.spdx.json'),
    'drift',
    'utf8',
  );
  assert.throws(() => verifyReleaseManifest(root, manifest), ReleaseManifestError);
});

test('binds the deployable observability child template as an exact release component', () => {
  const root = createWorkspace();
  const templateBytes = 'Resources:\n  AlarmTopic:\n    Type: AWS::SNS::Topic\n';
  const templatePath = resolve(root, 'infra/aws/application-observability.yaml');
  writeFileSync(templatePath, templateBytes, 'utf8');

  const manifest = createReleaseManifest(root, SOURCE, BUILDER);
  const component = manifest.components.find(
    ({ name }) => name === 'application-observability-cloudformation',
  );
  assert.equal(component.path, 'infra/aws/application-observability.yaml');
  assert.equal(component.files[0].sha256, createHash('sha256').update(templateBytes).digest('hex'));

  appendFileSync(templatePath, '# drift\n', 'utf8');
  assert.throws(() => verifyReleaseManifest(root, manifest), ReleaseManifestError);
});

test('binds the dormant balance-consumer envelope exactly and rejects hostile substitution', () => {
  const specification = RELEASE_COMPONENTS.find(
    ({ name }) => name === 'balance-consumer-deployment-envelope-cloudformation',
  );
  assert.deepEqual(specification, {
    name: 'balance-consumer-deployment-envelope-cloudformation',
    path: 'infra/aws/balance-consumer-deployment-envelope.yaml',
    kind: 'file',
    requiredFiles: ['.'],
  });

  const root = createWorkspace();
  const reviewedBytes = [
    'AWSTemplateFormatVersion: 2010-09-09',
    'Resources:',
    '  BalanceConsumerTaskDefinition:',
    '    Type: AWS::ECS::TaskDefinition',
    '',
  ].join('\n');
  const templatePath = resolve(root, specification.path);
  writeFileSync(templatePath, reviewedBytes, 'utf8');

  const manifest = createReleaseManifest(root, SOURCE, BUILDER);
  const component = manifest.components.find(({ name }) => name === specification.name);
  assert.equal(component.path, specification.path);
  assert.equal(component.kind, 'file');
  assert.equal(component.fileCount, 1);
  assert.equal(component.files[0].path, '.');
  assert.equal(component.files[0].sha256, createHash('sha256').update(reviewedBytes).digest('hex'));
  assert.doesNotThrow(() => verifyReleaseManifest(root, manifest));

  const hostileBytes = reviewedBytes.replace(
    'BalanceConsumerTaskDefinition',
    'UnreviewedBalanceConsumerService',
  );
  writeFileSync(templatePath, hostileBytes, 'utf8');
  assert.throws(() => verifyReleaseManifest(root, manifest), ReleaseManifestError);

  const substitutedManifest = structuredClone(manifest);
  const componentIndex = substitutedManifest.components.findIndex(
    ({ name }) => name === specification.name,
  );
  substitutedManifest.components[componentIndex] = structuredClone(
    substitutedManifest.components.find(({ name }) => name === 'application-cloudformation'),
  );
  assert.throws(() => validateReleaseManifest(substitutedManifest), /component shape/u);
});

test('binds the inert production infrastructure contract as an exact release component', () => {
  const specification = RELEASE_COMPONENTS.find(
    ({ name }) => name === 'production-infrastructure-contract-cloudformation',
  );
  assert.deepEqual(specification, {
    name: 'production-infrastructure-contract-cloudformation',
    path: 'infra/aws/production-infrastructure-contract.yaml',
    kind: 'file',
    requiredFiles: ['.'],
  });

  const root = createWorkspace();
  const contractBytes = [
    "AWSTemplateFormatVersion: '2010-09-09'",
    'Parameters:',
    '  ActivationMode:',
    '    Default: DISABLED',
    'Resources: {}',
    '',
  ].join('\n');
  const contractPath = resolve(root, specification.path);
  writeFileSync(contractPath, contractBytes, 'utf8');

  const manifest = createReleaseManifest(root, SOURCE, BUILDER);
  const component = manifest.components.find(({ name }) => name === specification.name);
  assert.equal(component.path, specification.path);
  assert.equal(component.kind, 'file');
  assert.equal(component.fileCount, 1);
  assert.equal(component.files[0].path, '.');
  assert.equal(component.files[0].sha256, createHash('sha256').update(contractBytes).digest('hex'));
  assert.doesNotThrow(() => verifyReleaseManifest(root, manifest));

  appendFileSync(contractPath, '# drift\n', 'utf8');
  assert.throws(() => verifyReleaseManifest(root, manifest), ReleaseManifestError);
});

test('binds the production deployment runtimes and inert intent example exactly', () => {
  const specifications = [
    {
      name: 'production-deployment-target-validator',
      path: 'scripts/production-deployment-target.mjs',
      kind: 'file',
      requiredFiles: ['.'],
    },
    {
      name: 'production-deployment-target-identity-enrollment-validator',
      path: 'scripts/production-deployment-enrollment.mjs',
      kind: 'file',
      requiredFiles: ['.'],
    },
    {
      name: 'production-deployment-intent-validator',
      path: 'infra/aws/validate-production-deployment-intent.mjs',
      kind: 'file',
      requiredFiles: ['.'],
    },
    {
      name: 'production-deployment-chain-protocol-validator',
      path: 'infra/aws/validate-production-deployment-chain-protocol.mjs',
      kind: 'file',
      requiredFiles: ['.'],
    },
    {
      name: 'production-deployment-intent-strict-json-runtime',
      path: 'infra/shared/parse-strict-json.mjs',
      kind: 'file',
      requiredFiles: ['.'],
    },
    {
      name: 'production-deployment-intent-secure-file-runtime',
      path: 'infra/shared/read-secure-local-file.mjs',
      kind: 'file',
      requiredFiles: ['.'],
    },
    {
      name: 'production-ed25519-public-key-validator',
      path: 'infra/shared/validate-ed25519-public-key.mjs',
      kind: 'file',
      requiredFiles: ['.'],
    },
    {
      name: 'production-deployment-intent-inert-example',
      path: 'infra/aws/production-deployment-intent.example.json',
      kind: 'file',
      requiredFiles: ['.'],
    },
  ];
  for (const specification of specifications) {
    assert.deepEqual(
      RELEASE_COMPONENTS.find(({ name }) => name === specification.name),
      specification,
    );
    const root = createWorkspace();
    const manifest = createReleaseManifest(root, SOURCE, BUILDER);
    const component = manifest.components.find(({ name }) => name === specification.name);
    const componentPath = resolve(root, specification.path);
    const reviewedBytes = readFileSync(componentPath);
    assert.equal(component.path, specification.path);
    assert.equal(component.kind, 'file');
    assert.equal(component.fileCount, 1);
    assert.equal(component.files[0].path, '.');
    assert.equal(
      component.files[0].sha256,
      createHash('sha256').update(reviewedBytes).digest('hex'),
    );
    assert.doesNotThrow(() => verifyReleaseManifest(root, manifest));

    appendFileSync(componentPath, 'drift', 'utf8');
    assert.throws(() => verifyReleaseManifest(root, manifest), ReleaseManifestError);
  }
});

test('stages all exact offline deployment module closures with reviewed direct capabilities', () => {
  const expectedClosures = Object.freeze({
    [DEPLOYMENT_RUNTIME_ENTRIES[0]]: Object.freeze([
      'infra/aws/validate-production-deployment-intent.mjs',
      'infra/shared/parse-strict-json.mjs',
      'infra/shared/read-secure-local-file.mjs',
      'infra/shared/validate-ed25519-public-key.mjs',
      'scripts/production-deployment-target.mjs',
    ]),
    [DEPLOYMENT_RUNTIME_ENTRIES[1]]: Object.freeze([
      'infra/shared/parse-strict-json.mjs',
      'infra/shared/validate-ed25519-public-key.mjs',
      'scripts/production-deployment-enrollment.mjs',
      'scripts/production-deployment-target.mjs',
    ]),
    [DEPLOYMENT_RUNTIME_ENTRIES[2]]: Object.freeze([
      'infra/aws/validate-production-deployment-chain-protocol.mjs',
    ]),
  });
  for (const entry of DEPLOYMENT_RUNTIME_ENTRIES) {
    assert.deepEqual(deploymentRuntimeLocalClosure([entry]), expectedClosures[entry], entry);
  }
  const expectedClosure = Object.keys(DEPLOYMENT_RUNTIME_MODULE_POLICY).sort();
  assert.deepEqual(deploymentRuntimeLocalClosure(DEPLOYMENT_RUNTIME_ENTRIES), expectedClosure);
  for (const modulePath of expectedClosure) {
    const components = RELEASE_COMPONENTS.filter(({ path }) => path === modulePath);
    assert.equal(components.length, 1, modulePath);
    const [component] = components;
    assert.equal(component.kind, 'file');
    assert.deepEqual(component.requiredFiles, ['.']);
  }

  for (const entry of DEPLOYMENT_RUNTIME_ENTRIES) {
    const entrySource = readFileSync(resolve(REPOSITORY_ROOT, entry), 'utf8');
    for (const forbiddenSource of [
      "import('node:https');",
      "require('node:child_process');",
      'const loadBuiltin = require; void loadBuiltin;',
      "fetch('https://example.invalid');",
      'const sendNetworkRequest = fetch; void sendNetworkRequest;',
      'const DynamicFunction = Function; void DynamicFunction;',
      "process.getBuiltinModule('node:child_process');",
      'process.env.AWS_PROFILE;',
      "import { writeFileSync } from 'node:fs';",
      "import { spawnSync } from 'node:child_process';",
      "import { CloudFormationClient } from '@aws-sdk/client-cloudformation';",
      "export * from '../infra/shared/parse-strict-json.mjs';",
    ]) {
      assert.throws(
        () => inspectDeploymentRuntimeModule(entry, `${entrySource}\n${forbiddenSource}\n`),
        undefined,
        `${entry}: ${forbiddenSource}`,
      );
    }
  }
  const secureFileModule = 'infra/shared/read-secure-local-file.mjs';
  const secureFileSource = readFileSync(resolve(REPOSITORY_ROOT, secureFileModule), 'utf8');
  assert.throws(() =>
    inspectDeploymentRuntimeModule(
      secureFileModule,
      secureFileSource.replace('fsConstants.O_RDONLY | noFollow', "'w'"),
    ),
  );
  assert.throws(() =>
    inspectDeploymentRuntimeModule(
      secureFileModule,
      `${secureFileSource}\nfunction shadowed(noFollow) { openSync('unsafe', noFollow); }\n`,
    ),
  );
  const publicKeyModule = 'infra/shared/validate-ed25519-public-key.mjs';
  const publicKeySource = readFileSync(resolve(REPOSITORY_ROOT, publicKeyModule), 'utf8');
  assert.throws(() =>
    inspectDeploymentRuntimeModule(
      publicKeyModule,
      `${publicKeySource}\nimport { randomBytes } from 'node:crypto';\n`,
    ),
  );
  const targetModule = 'scripts/production-deployment-target.mjs';
  const targetSource = readFileSync(resolve(REPOSITORY_ROOT, targetModule), 'utf8');
  assert.throws(() =>
    inspectDeploymentRuntimeModule(
      targetModule,
      `${targetSource}\nimport { connect } from 'node:net';\n`,
    ),
  );
  assert.throws(() =>
    inspectDeploymentRuntimeModule(
      targetModule,
      `${targetSource}\nisIP.constructor("process.getBuiltinModule('node:fs').writeFileSync('escaped', 'x')")();\n`,
    ),
  );

  const root = createWorkspace();
  for (const modulePath of expectedClosure) {
    writeFileSync(
      resolve(root, ...modulePath.split('/')),
      readFileSync(resolve(REPOSITORY_ROOT, ...modulePath.split('/'))),
    );
  }
  const source = initializeRepository(root);
  runCli(['create', '--source-revision', source.revision], root);
  runCli(['stage', '--source-revision', source.revision], root);
  const stageRoot = resolve(root, ...RELEASE_STAGE_PATH.split('/'));
  for (const entry of DEPLOYMENT_RUNTIME_ENTRIES) {
    const stagedEntryUrl = pathToFileURL(resolve(stageRoot, ...entry.split('/'))).href;
    const nativeImport = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', 'await import(process.argv[1]);', stagedEntryUrl],
      {
        cwd: stageRoot,
        encoding: 'utf8',
        env: Object.fromEntries(
          ['SystemRoot', 'TEMP', 'TMP', 'WINDIR'].flatMap((name) =>
            typeof process.env[name] === 'string' ? [[name, process.env[name]]] : [],
          ),
        ),
        windowsHide: true,
      },
    );
    assert.equal(nativeImport.status, 0, `${entry}: ${nativeImport.stderr}`);
    assert.equal(nativeImport.stdout, '', entry);
  }
});

test('detects drift in build output and every preflight decision binding', () => {
  const paths = RELEASE_COMPONENTS.map((component) =>
    component.kind === 'file'
      ? component.path
      : `${component.path}/${component.requiredFiles[0] ?? 'asset.js'}`,
  );

  for (const path of paths) {
    const root = createWorkspace();
    const manifest = createReleaseManifest(root, SOURCE, BUILDER);
    appendFileSync(resolve(root, ...path.split('/')), 'drift', 'utf8');
    assert.throws(() => verifyReleaseManifest(root, manifest), ReleaseManifestError, path);
  }
});

test('rejects missing entry points, links, empty directories, and unexpected special topology', (t) => {
  const missingRoot = createWorkspace();
  rmSync(resolve(missingRoot, 'apps/api/dist/main.js'));
  assert.throws(() => createReleaseManifest(missingRoot, SOURCE, BUILDER), /entry point/u);

  const emptyRoot = createWorkspace();
  rmSync(resolve(emptyRoot, 'apps/web/.next/static/asset.js'));
  assert.throws(() => createReleaseManifest(emptyRoot, SOURCE, BUILDER), /empty/u);

  const linkedRoot = createWorkspace();
  const link = resolve(linkedRoot, 'apps/api/dist/linked-main.js');
  try {
    symlinkSync(resolve(linkedRoot, 'apps/api/dist/main.js'), link, 'file');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
      t.diagnostic('Symbolic-link creation is not permitted on this host.');
      return;
    }
    throw error;
  }
  assert.throws(() => createReleaseManifest(linkedRoot, SOURCE, BUILDER), /symbolic links/u);
});

test('rejects an intermediate build-output junction that resolves outside the workspace', () => {
  const root = createWorkspace();
  const externalRoot = temporaryDirectory();
  const externalNext = resolve(externalRoot, 'outside-next');
  const nextPath = resolve(root, 'apps/web/.next');
  renameSync(nextPath, externalNext);
  symlinkSync(externalNext, nextPath, 'junction');

  assert.throws(() => createReleaseManifest(root, SOURCE, BUILDER), /links or reparse points/u);
});

test('exclusive manifest creation rejects an ignored output junction and an existing hardlink', () => {
  const junctionRoot = createWorkspace();
  const junctionSource = initializeRepository(junctionRoot);
  const externalOutput = resolve(temporaryDirectory(), 'outside-local-validation');
  renameSync(resolve(junctionRoot, '.local-validation'), externalOutput);
  symlinkSync(externalOutput, resolve(junctionRoot, '.local-validation'), 'junction');

  assert.throws(
    () => runCli(['create', '--source-revision', junctionSource.revision], junctionRoot),
    /links or reparse points/u,
  );
  assert.equal(existsSync(resolve(externalOutput, 'release-candidate-manifest.json')), false);

  const hardlinkRoot = createWorkspace();
  const hardlinkSource = initializeRepository(hardlinkRoot);
  const externalHardlink = resolve(temporaryDirectory(), 'outside.json');
  writeFileSync(externalHardlink, 'outside-must-remain-unchanged\n', 'utf8');
  linkSync(externalHardlink, resolve(hardlinkRoot, ...RELEASE_MANIFEST_PATH.split('/')));

  assert.throws(
    () => runCli(['create', '--source-revision', hardlinkSource.revision], hardlinkRoot),
    /created exclusively/u,
  );
  assert.equal(readFileSync(externalHardlink, 'utf8'), 'outside-must-remain-unchanged\n');
});

test('rejects noncanonical, duplicate-key, unknown-key, traversal, and digest-tampered manifests', () => {
  const root = createWorkspace();
  const manifest = createReleaseManifest(root, SOURCE, BUILDER);
  const canonical = `${canonicalJson(manifest)}\n`;

  assert.throws(() => parseReleaseManifest(JSON.stringify(manifest, null, 2)), /canonical/u);
  assert.throws(
    () =>
      parseReleaseManifest(
        canonical.replace(
          '"artifactType":"CRYPTO_LENDING_RELEASE_CANDIDATE_MANIFEST"',
          '"artifactType":"CRYPTO_LENDING_RELEASE_CANDIDATE_MANIFEST","artifactType":"CRYPTO_LENDING_RELEASE_CANDIDATE_MANIFEST"',
        ),
      ),
    /canonical/u,
  );

  const unknown = structuredClone(manifest);
  unknown.unreviewed = true;
  assert.throws(() => validateReleaseManifest(unknown), /shape/u);

  const traversal = structuredClone(manifest);
  traversal.components[0].files[0].path = '../escape';
  assert.throws(() => validateReleaseManifest(traversal), /file entry/u);

  const tampered = structuredClone(manifest);
  tampered.components[0].files[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateReleaseManifest(tampered), /component digest/u);

  for (const invalidPath of ['CON.txt', 'trailing-dot.', 'trailing-space ', 'name:stream']) {
    const platformAlias = structuredClone(manifest);
    platformAlias.components[0].files[0].path = invalidPath;
    assert.throws(() => validateReleaseManifest(platformAlias), /file entry/u, invalidPath);
  }
});

test('rejects a manifest whose individually valid components exceed the aggregate byte limit', () => {
  const root = createWorkspace();
  const manifest = structuredClone(createReleaseManifest(root, SOURCE, BUILDER));

  for (const component of manifest.components) {
    component.files[0].size = 100 * 1024 * 1024;
    resignComponent(component);
  }

  assert.throws(() => validateReleaseManifest(manifest), /aggregate byte limit/u);
});

test('rejects a manifest whose individually valid components exceed the aggregate file limit', () => {
  const root = createWorkspace();
  const manifest = structuredClone(createReleaseManifest(root, SOURCE, BUILDER));
  const directoryComponents = manifest.components.filter(({ kind }) => kind === 'directory');
  assert.ok(directoryComponents.length >= 2);

  expandComponentToFileCount(directoryComponents[0], 25_000);
  expandComponentToFileCount(directoryComponents[1], 25_000);

  assert.throws(() => validateReleaseManifest(manifest), /aggregate file limit/u);
});

test('rejects non-NFC paths and Unicode compatibility aliases in generated output', () => {
  const nonCanonicalRoot = createWorkspace();
  write(nonCanonicalRoot, 'apps/api/dist/e\u0301.js', 'non-NFC\n');
  assert.throws(() => createReleaseManifest(nonCanonicalRoot, SOURCE, BUILDER), /unsafe path/u);

  const aliasRoot = createWorkspace();
  write(aliasRoot, 'apps/api/dist/fi.js', 'ascii\n');
  write(aliasRoot, 'apps/api/dist/\ufb01.js', 'compatibility ligature\n');
  assert.throws(() => createReleaseManifest(aliasRoot, SOURCE, BUILDER), /unsafe path/u);
});

test('binds generation to exact clean HEAD and rejects dirty or mismatched source', () => {
  const root = createWorkspace();
  const source = initializeRepository(root);
  assert.deepEqual(inspectCleanGitSource(root, source.revision), source);
  assert.throws(() => inspectCleanGitSource(root, 'f'.repeat(40)), /does not match/u);

  appendFileSync(resolve(root, 'package-lock.json'), 'dirty', 'utf8');
  assert.throws(() => inspectCleanGitSource(root, source.revision), /not clean/u);
});

test('ignores ambient Git worktree, repository, index, object, config, and PATH spoofing', () => {
  const root = createWorkspace();
  const source = initializeRepository(root);
  const external = temporaryDirectory();
  const cleanWorktree = resolve(external, 'clean-worktree');
  cpSync(root, cleanWorktree, { recursive: true });
  rmSync(resolve(cleanWorktree, '.git'), { recursive: true, force: true });
  appendFileSync(resolve(root, 'infra/aws/application-baseline.yaml'), 'dirty\n', 'utf8');

  const spoofed = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: cleanWorktree,
    GIT_DIR: resolve(external, 'fake-git-dir'),
    GIT_INDEX_FILE: resolve(external, 'fake-index'),
    GIT_OBJECT_DIRECTORY: resolve(external, 'fake-objects'),
    GIT_WORK_TREE: cleanWorktree,
    PATH: external,
  };
  const prior = new Map(Object.keys(spoofed).map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, spoofed);
    assert.throws(() => inspectCleanGitSource(root, source.revision), /not clean/u);
  } finally {
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('CLI creates and then independently verifies the fixed local manifest path', () => {
  const root = createWorkspace();
  const source = initializeRepository(root);

  runCli(['create', '--source-revision', source.revision], root);
  const manifestPath = resolve(root, ...RELEASE_MANIFEST_PATH.split('/'));
  assert.equal(existsSync(manifestPath), true);
  assert.doesNotThrow(() => parseReleaseManifest(readFileSync(manifestPath, 'utf8')));
  assert.doesNotThrow(() => runCli(['verify', '--source-revision', source.revision], root));

  appendFileSync(resolve(root, 'apps/api/dist/main.js'), 'post-manifest-drift', 'utf8');
  assert.throws(
    () => runCli(['verify', '--source-revision', source.revision], root),
    /Release candidate manifest is invalid/u,
  );
});

test('brands only sanitized load-and-verify results and accepts an explicit regular manifest path', () => {
  const root = createWorkspace();
  const source = initializeRepository(root);
  runCli(['create', '--source-revision', source.revision], root);
  const generatedPath = resolve(root, ...RELEASE_MANIFEST_PATH.split('/'));
  const direct = parseReleaseManifest(readFileSync(generatedPath, 'utf8'));
  assert.equal(isVerifiedReleaseManifest(direct), false);

  const externalDirectory = temporaryDirectory();
  const explicitPath = resolve(externalDirectory, 'candidate.json');
  writeFileSync(explicitPath, readFileSync(generatedPath));
  const verified = loadAndVerifyReleaseManifest(root, explicitPath, source.revision);
  assert.equal(isVerifiedReleaseManifest(verified), true);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.components), true);
  assert.equal(isVerifiedReleaseManifest(structuredClone(verified)), false);

  writeFileSync(explicitPath, '{"private":"content"}\n', 'utf8');
  assert.throws(
    () => loadAndVerifyReleaseManifest(root, explicitPath, source.revision),
    (error) => {
      assert.equal(error.name, 'ReleaseManifestInvalidError');
      assert.equal(error.message, 'Release candidate manifest is invalid.');
      assert.doesNotMatch(error.message, /private|tmp|crypto-lending-release-manifest-/iu);
      return true;
    },
  );
});

test('revalidates a branded manifest against current source and build bytes', () => {
  const root = createWorkspace();
  const source = initializeRepository(root);
  runCli(['create', '--source-revision', source.revision], root);
  const manifestPath = resolve(root, ...RELEASE_MANIFEST_PATH.split('/'));
  const verified = loadAndVerifyReleaseManifest(root, manifestPath, source.revision);

  assert.equal(revalidateVerifiedReleaseManifest(root, verified, source.revision), verified);
  appendFileSync(resolve(root, 'apps/api/dist/main.js'), 'ignored-output-drift\n', 'utf8');
  assert.throws(
    () => revalidateVerifiedReleaseManifest(root, verified, source.revision),
    /Release candidate manifest is invalid/u,
  );
  assert.equal(isVerifiedReleaseManifest(verified), true);
});

test('stages a self-contained verified candidate without rereading mutable build paths', () => {
  const root = createWorkspace();
  const source = initializeRepository(root);
  runCli(['create', '--source-revision', source.revision], root);
  runCli(['stage', '--source-revision', source.revision], root);

  const stageRoot = resolve(root, ...RELEASE_STAGE_PATH.split('/'));
  const stageManifestPath = resolve(stageRoot, 'release-candidate-manifest.json');
  const stagedManifest = parseReleaseManifest(readFileSync(stageManifestPath, 'utf8'));
  assert.doesNotThrow(() => verifyReleaseManifest(stageRoot, stagedManifest));
  const stagedMain = lstatSync(resolve(stageRoot, 'apps/api/dist/main.js'));
  const stagedBalanceConsumer = lstatSync(
    resolve(stageRoot, 'apps/api/dist/blockchain-sync/application/balance-sync-consumer.cli.js'),
  );
  assert.equal(stagedMain.nlink, 1);
  assert.equal(stagedBalanceConsumer.nlink, 1);
  assert.equal(stagedMain.mode & 0o222, 0);
  assert.equal(stagedBalanceConsumer.mode & 0o222, 0);
  if (process.platform !== 'win32') {
    assert.equal(stagedMain.mode & 0o777, 0o400);
    assert.equal(lstatSync(stageRoot).mode & 0o777, 0o500);
  }
  for (const component of RELEASE_COMPONENTS) {
    assert.equal(
      existsSync(resolve(stageRoot, ...component.path.split('/'))),
      true,
      component.path,
    );
  }

  appendFileSync(resolve(root, 'apps/api/dist/main.js'), 'post-stage-drift\n', 'utf8');
  assert.doesNotThrow(() => verifyReleaseManifest(stageRoot, stagedManifest));
  assert.throws(
    () => runCli(['stage', '--source-revision', source.revision], root),
    /Release candidate manifest is invalid|already exists/u,
  );
});

test('stage sealing never applies path-based chmod or recursively follows discovered entries', () => {
  const implementation = readFileSync(
    resolve(REPOSITORY_ROOT, 'scripts/release-candidate-manifest.mjs'),
    'utf8',
  );
  assert.doesNotMatch(implementation, /\bchmodSync\s*\(/u);

  const start = implementation.indexOf('function sealStageDirectories');
  const end = implementation.indexOf('export function sealReleaseCandidateStage', start);
  assert.ok(start >= 0 && end > start);
  const sealingImplementation = implementation.slice(start, end);
  assert.doesNotMatch(sealingImplementation, /readdirSync/u);
  assert.match(sealingImplementation, /O_DIRECTORY/u);
  assert.match(sealingImplementation, /O_NOFOLLOW/u);
  assert.match(sealingImplementation, /fstatSync/u);
  assert.match(sealingImplementation, /fchmodSync\(descriptor/u);
});

test('rejects an injected stage junction without modifying its external target', () => {
  const root = createWorkspace();
  const source = initializeRepository(root);
  runCli(['create', '--source-revision', source.revision], root);
  runCli(['stage', '--source-revision', source.revision], root);

  const stageRoot = resolve(root, ...RELEASE_STAGE_PATH.split('/'));
  const stageManifest = parseReleaseManifest(
    readFileSync(resolve(stageRoot, 'release-candidate-manifest.json'), 'utf8'),
  );
  const external = temporaryDirectory();
  const externalFile = write(external, 'must-not-change.txt', 'external-content\n');
  chmodSync(external, 0o700);
  chmodSync(externalFile, 0o600);
  const directoryMode = lstatSync(external).mode;
  const fileMode = lstatSync(externalFile).mode;

  chmodSync(stageRoot, 0o700);
  symlinkSync(external, resolve(stageRoot, 'injected-junction'), 'junction');
  assert.throws(() => sealReleaseCandidateStage(stageRoot, stageManifest), /unknown path/u);
  assert.equal(readFileSync(externalFile, 'utf8'), 'external-content\n');
  assert.equal(lstatSync(external).mode, directoryMode);
  assert.equal(lstatSync(externalFile).mode, fileMode);
});

test('sanitized loader rejects a final symlink without disclosing its target', (t) => {
  const root = createWorkspace();
  const source = initializeRepository(root);
  runCli(['create', '--source-revision', source.revision], root);
  const target = resolve(root, ...RELEASE_MANIFEST_PATH.split('/'));
  const externalDirectory = temporaryDirectory();
  const link = resolve(externalDirectory, 'linked.json');
  try {
    symlinkSync(target, link, 'file');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
      t.diagnostic('Symbolic-link creation is not permitted on this host.');
      return;
    }
    throw error;
  }
  assert.throws(
    () => loadAndVerifyReleaseManifest(root, link, source.revision),
    (error) => {
      assert.equal(error.message, 'Release candidate manifest is invalid.');
      assert.doesNotMatch(error.message, /linked|local-validation/iu);
      return true;
    },
  );
});

test('sanitized loader rejects a linked intermediate manifest path', (t) => {
  const root = createWorkspace();
  const source = initializeRepository(root);
  runCli(['create', '--source-revision', source.revision], root);
  const targetDirectory = temporaryDirectory();
  const target = resolve(targetDirectory, 'candidate.json');
  writeFileSync(target, readFileSync(resolve(root, ...RELEASE_MANIFEST_PATH.split('/'))));
  const linkedParent = resolve(temporaryDirectory(), 'linked-parent');
  try {
    symlinkSync(targetDirectory, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
      t.diagnostic('directory-link creation is not permitted on this host.');
      return;
    }
    throw error;
  }

  assert.throws(
    () =>
      loadAndVerifyReleaseManifest(root, resolve(linkedParent, 'candidate.json'), source.revision),
    (error) => {
      assert.equal(error.name, 'ReleaseManifestInvalidError');
      assert.equal(error.message, 'Release candidate manifest is invalid.');
      assert.doesNotMatch(error.message, /linked-parent|crypto-lending-release-manifest-/u);
      return true;
    },
  );
});

test('unbranded file seam rejects a same-size rewrite between descriptor reads', () => {
  const root = createWorkspace();
  const source = initializeRepository(root);
  runCli(['create', '--source-revision', source.revision], root);
  const manifestPath = resolve(root, ...RELEASE_MANIFEST_PATH.split('/'));
  const original = readFileSync(manifestPath);
  const originalText = original.toString('utf8');
  const digestOffset = originalText.indexOf('"payloadSha256":"') + '"payloadSha256":"'.length;
  assert.ok(digestOffset >= '"payloadSha256":"'.length);
  const replacement = originalText[digestOffset] === 'f' ? 'e' : 'f';
  const changed = Buffer.from(
    `${originalText.slice(0, digestOffset)}${replacement}${originalText.slice(digestOffset + 1)}`,
    'utf8',
  );
  assert.equal(changed.length, original.length);
  assert.throws(
    () => readReleaseManifestFileForTest(manifestPath, () => writeFileSync(manifestPath, changed)),
    (error) => {
      assert.equal(error.name, 'ReleaseManifestInvalidError');
      assert.equal(error.message, 'Release candidate manifest is invalid.');
      return true;
    },
  );
});

test('caps a concurrently growing artifact read at its inspected size', () => {
  const root = temporaryDirectory();
  const artifactPath = write(root, 'artifact.bin', 'x');
  let consumedChunks = 0;

  assert.throws(
    () =>
      fingerprintReleaseArtifactFileForTest(artifactPath, () => {
        consumedChunks += 1;
        if (consumedChunks < 4) appendFileSync(artifactPath, 'x');
      }),
    (error) => {
      assert.equal(error.name, 'ReleaseManifestInvalidError');
      assert.equal(error.message, 'Release candidate manifest is invalid.');
      return true;
    },
  );
  assert.equal(consumedChunks, 1);
});

test('staging rejects concurrent source growth without exceeding the manifest size', () => {
  const sourceRoot = createWorkspace();
  const stageRoot = temporaryDirectory();
  const manifest = createReleaseManifest(sourceRoot, SOURCE, BUILDER);
  const component = manifest.components.find(({ name }) => name === 'root-package-manifest');
  assert.ok(component);
  const file = component.files[0];
  assert.ok(file);
  const sourcePath = resolve(sourceRoot, ...component.path.split('/'));
  const stagePath = resolve(stageRoot, ...component.path.split('/'));
  let consumedChunks = 0;

  assert.throws(
    () =>
      copyReleaseArtifactFileForTest(sourceRoot, stageRoot, component, file, () => {
        consumedChunks += 1;
        if (consumedChunks < 4) appendFileSync(sourcePath, 'x');
      }),
    (error) => {
      assert.equal(error.name, 'ReleaseManifestInvalidError');
      assert.equal(error.message, 'Release candidate manifest is invalid.');
      return true;
    },
  );
  assert.equal(consumedChunks, 1);
  assert.ok(lstatSync(sourcePath).size > file.size);
  assert.equal(lstatSync(stagePath).size, file.size);
  assert.equal(readFileSync(stagePath).length, file.size);
});

test('descriptor close failures retain the fixed manifest error contract', () => {
  assert.throws(
    () => closeReleaseFileDescriptorForTest(-1),
    (error) => {
      assert.equal(error.name, 'ReleaseManifestInvalidError');
      assert.equal(error.message, 'Release candidate manifest is invalid.');
      return true;
    },
  );
});

test('rejects malformed CLI arguments without inspecting Git or writing output', () => {
  const root = createWorkspace();
  assert.throws(() => runCli(['create'], root), /Usage/u);
  assert.equal(existsSync(resolve(root, ...RELEASE_MANIFEST_PATH.split('/'))), false);
});

test('CI publishes only the permission-sealed stage from trusted main after integration acceptance', () => {
  const workflow = readFileSync(resolve(REPOSITORY_ROOT, '.github/workflows/ci.yml'), 'utf8');
  const containerBuild = workflow.indexOf(
    '- name: Build production container images from the reviewed definitions',
  );
  const containerRuntime = workflow.indexOf(
    '- name: Verify hardened production container runtime boundaries',
  );
  const createManifest = workflow.indexOf(
    '- name: Create and verify revision-bound release candidate manifest',
  );
  const migrations = workflow.indexOf('- name: Verify migration commands');
  const integration = workflow.indexOf('- name: Run live infrastructure tests');
  const teardown = workflow.indexOf('- name: Stop local dependencies');
  const stage = workflow.indexOf('- name: Stage immutable release candidate');
  const upload = workflow.indexOf('- name: Upload immutable release candidate');

  assert.ok(
    containerBuild >= 0 &&
      containerBuild < containerRuntime &&
      containerRuntime < createManifest &&
      createManifest < migrations,
  );
  assert.ok(migrations >= 0 && migrations < integration);
  assert.ok(integration < teardown && teardown < stage && stage < upload);
  const publication = workflow.slice(stage, workflow.indexOf('- name:', upload + 10));
  assert.match(
    publication,
    /success\(\).*\(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\).*github\.ref == 'refs\/heads\/main'/u,
  );
  assert.match(publication, /release:manifest -- stage/u);
  assert.match(publication, /\.local-validation\/release-candidate-stage\//u);
  assert.doesNotMatch(publication, /apps\/api\/dist|apps\/web\/\.next/u);
});
