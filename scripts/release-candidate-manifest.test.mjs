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
import { dirname, join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  RELEASE_COMPONENTS,
  RELEASE_MANIFEST_DOMAIN,
  RELEASE_MANIFEST_PATH,
  RELEASE_STAGE_PATH,
  REPOSITORY_ROOT,
  ReleaseManifestError,
  canonicalJson,
  createReleaseManifest,
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
  write(root, '.gitignore', '.local-validation/\n');
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
  assert.equal(stagedMain.nlink, 1);
  assert.equal(stagedMain.mode & 0o222, 0);
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
