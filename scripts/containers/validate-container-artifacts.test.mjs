import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  loadContainerSources,
  repositoryRoot,
  validateContainerSources,
} from './validate-container-artifacts.mjs';

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
  changed.backendDockerfile = changed.backendDockerfile.replace('npm@11.6.4', 'npm@11.6.5');
  const report = validateContainerSources(changed);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('npm@11.6.4')));
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
    /ADD --checksum=sha256:[a-f0-9]{64}/u,
    'ADD',
  );

  const report = validateContainerSources(sources);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('global-bundle.pem')));
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
