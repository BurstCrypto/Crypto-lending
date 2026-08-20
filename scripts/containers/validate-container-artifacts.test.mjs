import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  CONTAINER_POLICY,
  loadContainerSources,
  repositoryRoot,
  validateContainerSources,
} from './validate-container-artifacts.mjs';
import { createGitBuildContext, resolveNpmCli } from './run-local-container-checks.mjs';

function currentSources() {
  const { errors, sources } = loadContainerSources(repositoryRoot);
  assert.deepEqual(errors, []);
  return sources;
}

test('current container definitions satisfy the offline artifact policy', () => {
  const report = validateContainerSources(currentSources());

  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(report.cloudCallsMade, 0);
  assert.equal(report.networkCallsMade, 0);
});

test('resolves and executes an exact npm JavaScript CLI without a shell shim', () => {
  const temporaryAppData = mkdtempSync(join(tmpdir(), 'kan228-npm-cli-'));
  try {
    const npmRoot = join(temporaryAppData, 'npm', 'node_modules', 'npm');
    const npmCliFixture = join(npmRoot, 'bin', 'npm-cli.js');
    mkdirSync(dirname(npmCliFixture), { recursive: true });
    writeFileSync(
      join(npmRoot, 'package.json'),
      JSON.stringify({ version: CONTAINER_POLICY.npmVersion }),
      'utf8',
    );
    writeFileSync(
      npmCliFixture,
      `process.stdout.write('${CONTAINER_POLICY.npmVersion}\\n');\n`,
      'utf8',
    );

    const npmCli = resolveNpmCli(
      { APPDATA: temporaryAppData },
      join(temporaryAppData, 'node', 'node.exe'),
    );
    assert.equal(npmCli, npmCliFixture);
    const version = execFileSync(process.execPath, [npmCli, '--version'], {
      encoding: 'utf8',
    }).trim();
    assert.equal(version, CONTAINER_POLICY.npmVersion);
  } finally {
    rmSync(temporaryAppData, { force: true, recursive: true });
  }
});

test('Git-derived Docker context excludes ignored and untracked files', () => {
  const temporaryRepository = mkdtempSync(join(tmpdir(), 'kan228-source-repository-'));
  const temporaryOutput = mkdtempSync(join(tmpdir(), 'kan228-source-context-'));
  try {
    writeFileSync(join(temporaryRepository, '.dockerignore'), '*\n!tracked.txt\n', 'utf8');
    writeFileSync(join(temporaryRepository, '.gitignore'), '*.tmp\n', 'utf8');
    writeFileSync(join(temporaryRepository, 'tracked.txt'), 'reviewed\n', 'utf8');
    execFileSync('git', ['init', '--quiet'], { cwd: temporaryRepository, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: temporaryRepository, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'commit.gpgSign=false',
        '-c',
        'user.name=KAN-228 Test',
        '-c',
        'user.email=kan-228@example.invalid',
        'commit',
        '--quiet',
        '--message',
        'test fixture',
      ],
      { cwd: temporaryRepository, stdio: 'ignore' },
    );
    writeFileSync(join(temporaryRepository, 'ignored.tmp'), 'must-not-enter-context\n', 'utf8');

    const context = createGitBuildContext('HEAD', temporaryOutput, temporaryRepository);
    assert.equal(existsSync(join(context, 'tracked.txt')), true);
    assert.equal(existsSync(join(context, 'ignored.tmp')), false);
  } finally {
    rmSync(temporaryOutput, { force: true, recursive: true });
    rmSync(temporaryRepository, { force: true, recursive: true });
  }
});

test('changed literal base image fails closed', () => {
  const sources = currentSources();
  sources.backendDockerfile = sources.backendDockerfile.replace(
    /node:22-slim@sha256:[a-f0-9]{64}/u,
    'node:22-slim',
  );

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('literal stage graph')));
});

test('changed npm toolchain input fails closed', () => {
  const changed = currentSources();
  changed.backendDockerfile = changed.backendDockerfile.replace(
    'https://registry.npmjs.org/npm/-/npm-11.6.4.tgz',
    'https://registry.npmjs.org/npm/-/npm-11.6.5.tgz',
  );
  const report = validateContainerSources(changed);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('npm-11.6.4.tgz')));
});

test('overrideable Node and npm toolchain inputs fail closed', () => {
  for (const argument of ['ARG NODE_IMAGE=node:22-slim', 'ARG NPM_VERSION=11.6.4']) {
    const sources = currentSources();
    sources.backendDockerfile = `${argument}\n${sources.backendDockerfile}`;
    const report = validateContainerSources(sources);
    assert.equal(report.ok, false, `accepted ${argument}`);
    assert.ok(report.errors.some((error) => error.includes('build arguments')));
  }
});

test('an unpinned RDS bundle fails closed', () => {
  const sources = currentSources();
  sources.backendDockerfile = sources.backendDockerfile.replace(
    'ADD --checksum=sha256:e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3',
    'ADD',
  );

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('global-bundle.pem')));
});

test('an unpinned npm CLI tarball fails closed', () => {
  const sources = currentSources();
  sources.backendDockerfile = sources.backendDockerfile.replace(
    'ADD --checksum=sha256:9c07edca12853cddbf4fed4e372485aa60c064f9bf3e4cd157a2db5518a1792b',
    'ADD',
  );

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('npm-11.6.4.tgz')));
});

test('npm dependency installs cannot enable audit or funding network calls', () => {
  for (const dockerfile of ['backendDockerfile', 'webDockerfile']) {
    const sources = currentSources();
    sources[dockerfile] = sources[dockerfile].replace(' --no-audit --no-fund', '');

    const report = validateContainerSources(sources);
    assert.equal(report.ok, false, `${dockerfile} accepted npm ci without network guards`);
    assert.ok(
      report.errors.some(
        (error) => error.includes('--no-audit --no-fund') || error.includes('canonical SHA-256'),
      ),
    );
  }
});

test('application build layers cannot access the network', () => {
  for (const [dockerfile, workspace] of [
    ['backendDockerfile', 'api'],
    ['webDockerfile', 'web'],
  ]) {
    const sources = currentSources();
    sources[dockerfile] = sources[dockerfile].replace(
      `RUN --network=none npm run build --workspace @crypto-lending/${workspace}`,
      `RUN npm run build --workspace @crypto-lending/${workspace}`,
    );

    const report = validateContainerSources(sources);
    assert.equal(report.ok, false, `${dockerfile} accepted a network-enabled build layer`);
    assert.ok(
      report.errors.some(
        (error) => error.includes('--network=none') || error.includes('canonical SHA-256'),
      ),
    );
  }
});

test('an inaccessible RDS bundle parent directory fails closed', () => {
  const sources = currentSources();
  sources.backendDockerfile = sources.backendDockerfile.replace(
    'install --directory --owner 0 --group 0 --mode 0755 /etc/ssl/certs',
    'install --directory --owner 0 --group 0 --mode 0444 /etc/ssl/certs',
  );

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('/etc/ssl/certs')));
});

test('a broad Docker context inclusion fails closed', () => {
  const sources = currentSources();
  sources.dockerignore += '\n!apps/**\n';

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('exact reviewed')));
});

test('an environment-file Docker context inclusion fails closed', () => {
  const sources = currentSources();
  sources.dockerignore += '\n!**/*.env\n';

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('exact reviewed')));
});

test('a later root USER fails closed for every runtime target', () => {
  for (const dockerfile of ['backendDockerfile', 'webDockerfile']) {
    const sources = currentSources();
    sources[dockerfile] += '\nUSER 0:0\n';

    const report = validateContainerSources(sources);
    assert.equal(report.ok, false, `${dockerfile} accepted USER 0:0`);
    assert.ok(report.errors.some((error) => error.includes('root or alternate USER')));
    assert.ok(report.errors.some((error) => error.includes('exactly one final USER')));
  }
});

test('a later command or entrypoint override fails closed', () => {
  for (const instruction of ['CMD ["sh"]', 'ENTRYPOINT ["sh"]']) {
    const sources = currentSources();
    sources.backendDockerfile += `\n${instruction}\n`;

    const report = validateContainerSources(sources);
    assert.equal(report.ok, false, `accepted ${instruction}`);
    assert.ok(
      report.errors.some(
        (error) => error.includes('reviewed command') || error.includes('ENTRYPOINT'),
      ),
    );
  }
});

test('an appended privileged runtime instruction fails the reviewed Dockerfile digest', () => {
  const sources = currentSources();
  sources.backendDockerfile += '\nRUN chmod 4755 /bin/bash\n';

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('canonical SHA-256')));
});

test('an extra unchecked remote ADD fails the reviewed Dockerfile digest', () => {
  const sources = currentSources();
  sources.backendDockerfile += '\nADD https://example.invalid/payload /tmp/payload\n';

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('canonical SHA-256')));
});

test('a dependency without lock integrity fails closed', () => {
  const sources = currentSources();
  const lock = JSON.parse(sources.packageLock);
  const entry = Object.entries(lock.packages).find(
    ([path, metadata]) => path.startsWith('node_modules/') && !metadata.link,
  );
  assert.ok(entry);
  delete entry[1].integrity;
  sources.packageLock = JSON.stringify(lock);

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('missing an integrity value')));
});

test('removing deterministic Next build ID support fails closed', () => {
  const sources = currentSources();
  sources.nextConfig = sources.nextConfig.replace('generateBuildId: () => resolveBuildId(),', '');

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('generateBuildId')));
});

test('production smoke configuration cannot weaken transport policy', () => {
  const sources = currentSources();
  sources.localRunner = sources.localRunner.replace(
    "DATABASE_RUNTIME_SSL_MODE: 'verify-full'",
    "DATABASE_RUNTIME_SSL_MODE: 'disable'",
  );

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('preserve TLS')));
});

test('local harness isolation, clean-source, and migration controls fail closed on change', () => {
  for (const [reviewed, changed] of [
    ["'--internal'", "'--attachable'"],
    ['assertCleanCheckout(revision);', '// source check removed'],
    ["['up', 'verify']", "['up']"],
    [
      "'dist/infrastructure/outbox/outbox-worker-health.cli.js'",
      "'dist/infrastructure/outbox/outbox-worker.cli.js'",
    ],
  ]) {
    const sources = currentSources();
    assert.ok(sources.localRunner.includes(reviewed), `missing reviewed fixture: ${reviewed}`);
    sources.localRunner = sources.localRunner.replace(reviewed, changed);

    const report = validateContainerSources(sources);
    assert.equal(report.ok, false, `accepted local runner mutation: ${changed}`);
    assert.ok(report.errors.some((error) => error.includes('canonical SHA-256')));
  }
});
