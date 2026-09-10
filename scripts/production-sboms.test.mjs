import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  ProductionImageBindingCaptureError,
  captureProductionImageBinding,
  readDockerSaveArchive,
  writeProductionImageBindingEvidence,
} from './capture-production-image-bindings.mjs';
import {
  MAX_PRODUCTION_SBOM_BYTES,
  PRODUCTION_IMAGE_BINDING_FILES,
  PRODUCTION_SBOM_BINDING_FILES,
  PRODUCTION_SBOM_FILES,
  ProductionSbomValidationError,
  closeSecureFileDescriptorForTest,
  readSecureRegularFile,
  SBOM_ACTION_COMMIT,
  SYFT_VERSION,
  loadProductionSbomExpectations,
  validateProductionSbomFiles,
  validateProductionSbomWorkflowText,
  validateProductionImageBindingBytes,
  validateProductionSpdxBytes,
  validateProductionSyftBindingBytes,
} from './validate-production-sboms.mjs';

const SOURCE_REVISION = 'c'.repeat(40);
const OCI_SOURCE = 'https://github.com/BurstCrypto/Crypto-lending';
const API_IMAGE_ID = imageMaterial('api').manifestDigest;
const WEB_IMAGE_ID = imageMaterial('web').manifestDigest;
const temporaryDirectories = [];
let fixtureRoot;

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'production-image-sbom-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function write(relativePath, contents) {
  const absolutePath = path.join(fixtureRoot, ...relativePath.split('/'));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, { flag: 'wx' });
  return absolutePath;
}

function json(relativePath, value) {
  return write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function tarEntry(pathname, contents) {
  const bytes = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(pathname, 0, 100, 'ascii');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512);
  return Buffer.concat([header, bytes, padding]);
}

function tarArchive(entries) {
  return Buffer.concat([
    ...entries.map(({ contents, pathname }) => tarEntry(pathname, contents)),
    Buffer.alloc(1024),
  ]);
}

function classicDockerArchive(kind, includeLayers = true) {
  const base = imageMaterial(kind);
  const layerEntries = [
    { contents: Buffer.from(`${kind}-first-layer\n`), pathname: 'first/layer.tar' },
    { contents: Buffer.from(`${kind}-second-layer\n`), pathname: 'second/layer.tar' },
  ];
  const config = JSON.parse(base.configBytes.toString('utf8'));
  config.rootfs.diff_ids = layerEntries.map(
    ({ contents }) => `sha256:${createHash('sha256').update(contents).digest('hex')}`,
  );
  const configBytes = Buffer.from(JSON.stringify(config));
  const imageId = `sha256:${createHash('sha256').update(configBytes).digest('hex')}`;
  const configPath = `${imageId.slice('sha256:'.length)}.json`;
  const manifestBytes = Buffer.from(
    JSON.stringify([
      {
        Config: configPath,
        Layers: layerEntries.map(({ pathname }) => pathname),
        RepoTags: [`crypto-lending-${kind}:ci`],
      },
    ]),
  );
  return Object.freeze({
    bytes: tarArchive([
      { contents: configBytes, pathname: configPath },
      { contents: manifestBytes, pathname: 'manifest.json' },
      ...(includeLayers ? layerEntries : []),
    ]),
    imageId,
  });
}

function makeRepositoryFixture() {
  fixtureRoot = temporaryDirectory();
  const apiDependencies = {
    '@nestjs/common': '^11.2.1',
    '@nestjs/core': '^11.2.1',
    '@nestjs/platform-express': '^11.2.1',
    '@nestjs/swagger': '^11.4.7',
    'reflect-metadata': '^0.2.2',
    rxjs: '^7.8.2',
  };
  const webDependencies = {
    next: '^16.3.1',
    react: '^19.2.8',
    'react-dom': '^19.2.8',
  };
  const versions = {
    '@nestjs/common': '11.2.1',
    '@nestjs/core': '11.2.1',
    '@nestjs/platform-express': '11.2.1',
    '@nestjs/swagger': '11.4.7',
    next: '16.3.1',
    react: '19.2.8',
    'react-dom': '19.2.8',
    'reflect-metadata': '0.2.2',
    rxjs: '7.8.2',
  };
  json('package.json', { name: 'crypto-lending', version: '0.1.0', private: true });
  json('apps/api/package.json', {
    name: '@crypto-lending/api',
    version: '0.1.0',
    private: true,
    dependencies: apiDependencies,
  });
  json('apps/web/package.json', {
    name: '@crypto-lending/web',
    version: '0.1.0',
    private: true,
    dependencies: webDependencies,
  });
  const packages = {
    '': { name: 'crypto-lending', version: '0.1.0' },
    'apps/api': {
      name: '@crypto-lending/api',
      version: '0.1.0',
      dependencies: apiDependencies,
    },
    'apps/web': {
      name: '@crypto-lending/web',
      version: '0.1.0',
      dependencies: webDependencies,
    },
  };
  for (const [name, version] of Object.entries(versions)) {
    packages[`node_modules/${name}`] = { version };
  }
  json('package-lock.json', {
    name: 'crypto-lending',
    version: '0.1.0',
    lockfileVersion: 3,
    packages,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

beforeEach(() => makeRepositoryFixture());

function packageId(name) {
  return `SPDXRef-Package-npm-${name.replaceAll('@', '').replaceAll('/', '-')}`;
}

function packageRecord(name, version) {
  return {
    name,
    SPDXID: packageId(name),
    versionInfo: version,
    supplier: 'NOASSERTION',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:npm/${encodeURIComponent(name)}@${version}`,
      },
    ],
  };
}

function imageMaterial(kind) {
  const imageName = `crypto-lending-${kind}`;
  const layerDigests = [
    kind === 'api' ? `sha256:${'d'.repeat(64)}` : `sha256:${'e'.repeat(64)}`,
    kind === 'api' ? `sha256:${'1'.repeat(64)}` : `sha256:${'2'.repeat(64)}`,
  ];
  const labels = {
    'org.opencontainers.image.created': '2026-09-04T12:00:00Z',
    'org.opencontainers.image.licenses': 'UNLICENSED',
    'org.opencontainers.image.revision': SOURCE_REVISION,
    'org.opencontainers.image.source': OCI_SOURCE,
    'org.opencontainers.image.title': imageName,
  };
  const configBytes = Buffer.from(
    JSON.stringify({
      architecture: 'amd64',
      config: { Labels: labels },
      created: '2026-09-04T12:00:00Z',
      history: [{ created: '2026-09-04T12:00:00Z', created_by: 'fixture' }],
      os: 'linux',
      rootfs: { type: 'layers', diff_ids: layerDigests },
    }),
  );
  const configDigest = `sha256:${createHash('sha256').update(configBytes).digest('hex')}`;
  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: {
      mediaType: 'application/vnd.docker.container.image.v1+json',
      size: configBytes.length,
      digest: configDigest,
    },
    layers: layerDigests.map((digest, index) => ({
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      size: 123 + index,
      digest,
    })),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  return Object.freeze({
    configBytes,
    configDigest,
    imageName,
    labels,
    layerDigests,
    manifestBytes,
    manifestDigest: `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`,
  });
}

function bindingBlob(bytes, mediaType) {
  return {
    bytes: bytes.toString('base64'),
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    mediaType,
    size: bytes.length,
  };
}

function imageBindingDocument(kind, mutate) {
  const material = imageMaterial(kind);
  const imageId = kind === 'api' ? API_IMAGE_ID : WEB_IMAGE_ID;
  const document = {
    schemaVersion: 'crypto-lending.production-image-archive-binding.v1',
    workspace: kind,
    imageReference: `${material.imageName}:ci`,
    capturedImageId: imageId,
    inspectBeforeImageId: imageId,
    inspectAfterImageId: imageId,
    archiveFormat: 'oci',
    chainType: 'manifest-config',
    platform: { architecture: 'amd64', os: 'linux' },
    index: null,
    manifest: bindingBlob(
      material.manifestBytes,
      'application/vnd.docker.distribution.manifest.v2+json',
    ),
    config: bindingBlob(material.configBytes, 'application/vnd.docker.container.image.v1+json'),
  };
  mutate?.(document);
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function indexedImageBindingDocument(kind, mutateIndex) {
  const material = imageMaterial(kind);
  const index = {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      {
        mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        digest: material.manifestDigest,
        size: material.manifestBytes.length,
        platform: { architecture: 'amd64', os: 'linux' },
      },
    ],
  };
  mutateIndex?.(index);
  const indexBytes = Buffer.from(JSON.stringify(index));
  const imageId = `sha256:${createHash('sha256').update(indexBytes).digest('hex')}`;
  const document = JSON.parse(imageBindingDocument(kind).toString('utf8'));
  document.capturedImageId = imageId;
  document.inspectBeforeImageId = imageId;
  document.inspectAfterImageId = imageId;
  document.chainType = 'index-manifest-config';
  document.index = bindingBlob(indexBytes, 'application/vnd.oci.image.index.v1+json');
  return { bytes: Buffer.from(`${JSON.stringify(document, null, 2)}\n`), imageId };
}

function directConfigImageBindingDocument(kind) {
  const material = imageMaterial(kind);
  const document = JSON.parse(imageBindingDocument(kind).toString('utf8'));
  document.capturedImageId = material.configDigest;
  document.inspectBeforeImageId = material.configDigest;
  document.inspectAfterImageId = material.configDigest;
  document.archiveFormat = 'docker';
  document.chainType = 'config';
  document.index = null;
  document.manifest = null;
  return {
    bytes: Buffer.from(`${JSON.stringify(document, null, 2)}\n`),
    imageId: material.configDigest,
  };
}

function validatedImageBinding(kind, bytes = imageBindingDocument(kind)) {
  const expectations = loadProductionSbomExpectations(fixtureRoot);
  return validateProductionImageBindingBytes(
    bytes,
    kind,
    expectations,
    kind === 'api' ? API_IMAGE_ID : WEB_IMAGE_ID,
  );
}

function imageRoot(kind, imageId, material) {
  const digest = material.manifestDigest.slice('sha256:'.length);
  const inputDigest = imageId.slice('sha256:'.length);
  return {
    name: 'sha256',
    SPDXID: 'SPDXRef-DocumentRoot-Image-sha256',
    versionInfo: inputDigest,
    supplier: 'NOASSERTION',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    checksums: [{ algorithm: 'SHA256', checksumValue: digest }],
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:oci/sha256@sha256%3A${digest}?arch=amd64&tag=${inputDigest}`,
      },
    ],
    primaryPackagePurpose: 'CONTAINER',
  };
}

function spdxDocument(kind, mutate) {
  const imageId = kind === 'api' ? API_IMAGE_ID : WEB_IMAGE_ID;
  const material = imageMaterial(kind);
  const required =
    kind === 'api'
      ? [
          ['@nestjs/common', '11.2.1'],
          ['@nestjs/core', '11.2.1'],
          ['@nestjs/platform-express', '11.2.1'],
          ['@nestjs/swagger', '11.4.7'],
          ['reflect-metadata', '0.2.2'],
          ['rxjs', '7.8.2'],
        ]
      : [
          ['next', '16.3.1'],
          ['react', '19.2.8'],
          ['react-dom', '19.2.8'],
        ];
  const root = imageRoot(kind, imageId, material);
  const packages = [root, ...required.map(([name, version]) => packageRecord(name, version))];
  const file = {
    fileName: `app/apps/${kind}/runtime.js`,
    SPDXID: `SPDXRef-File-app-apps-${kind}-runtime.js`,
    fileTypes: ['SOURCE'],
    checksums: [
      { algorithm: 'SHA1', checksumValue: '1'.repeat(40) },
      { algorithm: 'SHA256', checksumValue: '2'.repeat(64) },
    ],
    licenseConcluded: 'NOASSERTION',
    licenseInfoInFiles: ['NOASSERTION'],
    copyrightText: 'NOASSERTION',
  };
  const document = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: 'sha256',
    documentNamespace: `https://anchore.com/syft/image/sha256-${
      kind === 'api'
        ? '11111111-1111-4111-8111-111111111111'
        : '22222222-2222-4222-8222-222222222222'
    }`,
    creationInfo: {
      licenseListVersion: '3.28',
      creators: ['Organization: Anchore, Inc', `Tool: syft-${SYFT_VERSION}`],
      created: '2026-09-04T12:00:00Z',
    },
    packages,
    files: [file],
    hasExtractedLicensingInfos: [
      {
        licenseId: `LicenseRef-${kind}`,
        extractedText: 'NOASSERTION',
        name: `fixture-${kind}`,
      },
    ],
    relationships: [
      {
        spdxElementId: 'SPDXRef-DOCUMENT',
        relatedSpdxElement: root.SPDXID,
        relationshipType: 'DESCRIBES',
      },
      ...packages.slice(1).map((item) => ({
        spdxElementId: root.SPDXID,
        relatedSpdxElement: item.SPDXID,
        relationshipType: 'CONTAINS',
      })),
      {
        spdxElementId: root.SPDXID,
        relatedSpdxElement: file.SPDXID,
        relationshipType: 'CONTAINS',
      },
    ],
  };
  mutate?.(document);
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function nativeId(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function syftBindingDocument(kind, mutate) {
  const imageId = kind === 'api' ? API_IMAGE_ID : WEB_IMAGE_ID;
  const material = imageMaterial(kind);
  const required =
    kind === 'api'
      ? [
          ['@nestjs/common', '11.2.1'],
          ['@nestjs/core', '11.2.1'],
          ['@nestjs/platform-express', '11.2.1'],
          ['@nestjs/swagger', '11.4.7'],
          ['reflect-metadata', '0.2.2'],
          ['rxjs', '7.8.2'],
        ]
      : [
          ['next', '16.3.1'],
          ['react', '19.2.8'],
          ['react-dom', '19.2.8'],
        ];
  const artifacts = required.map(([name, version]) => ({
    id: nativeId(`${kind}:package:${name}`),
    name,
    version,
  }));
  const files = [{ id: nativeId(`${kind}:file:runtime`) }];
  const document = {
    artifacts,
    artifactRelationships: [
      ...artifacts.map(({ id }) => ({
        parent: material.manifestDigest.slice('sha256:'.length),
        child: id,
        type: 'contains',
      })),
      {
        parent: material.manifestDigest.slice('sha256:'.length),
        child: files[0].id,
        type: 'contains',
      },
    ],
    files,
    source: {
      id: material.manifestDigest.slice('sha256:'.length),
      name: 'sha256',
      version: imageId.slice('sha256:'.length),
      type: 'image',
      metadata: {
        userInput: imageId,
        imageID: material.configDigest,
        manifestDigest: material.manifestDigest,
        mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
        tags: [`${material.imageName}:ci`],
        imageSize: 1234,
        layers: material.layerDigests.map((digest, index) => ({
          mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
          digest,
          size: 321 + index,
        })),
        manifest: material.manifestBytes.toString('base64'),
        config: material.configBytes.toString('base64'),
        repoDigests: [`${material.imageName}@${imageId}`],
        architecture: 'amd64',
        os: 'linux',
        labels: material.labels,
      },
    },
    distro: {},
    descriptor: {
      name: 'syft',
      version: SYFT_VERSION,
      configuration: {
        packages: {
          cpp: { 'vcpkg-allow-git-clone': false },
          'java-archive': { 'use-network': false },
          javascript: { 'search-remote-licenses': false },
          golang: { 'search-remote-licenses': false },
        },
      },
    },
    schema: {
      version: '16.1.10',
      url: 'https://raw.githubusercontent.com/anchore/syft/main/schema/json/schema-16.1.10.json',
    },
  };
  mutate?.(document);
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function replaceNativeManifest(document, mutate) {
  const oldSourceId = document.source.id;
  const manifest = JSON.parse(
    Buffer.from(document.source.metadata.manifest, 'base64').toString('utf8'),
  );
  mutate(manifest);
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestDigest = `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`;
  document.source.id = manifestDigest.slice('sha256:'.length);
  document.source.metadata.manifest = manifestBytes.toString('base64');
  document.source.metadata.manifestDigest = manifestDigest;
  for (const relationship of document.artifactRelationships) {
    if (relationship.parent === oldSourceId) relationship.parent = document.source.id;
    if (relationship.child === oldSourceId) relationship.child = document.source.id;
  }
  return manifest;
}

function replaceNativeConfig(document, configBytes) {
  const configDigest = `sha256:${createHash('sha256').update(configBytes).digest('hex')}`;
  document.source.metadata.config = configBytes.toString('base64');
  document.source.metadata.imageID = configDigest;
  replaceNativeManifest(document, (manifest) => {
    manifest.config.digest = configDigest;
    manifest.config.size = configBytes.length;
  });
  return configDigest;
}

function claimNativeImageId(document, imageId, kind = 'api') {
  document.source.version = imageId.slice('sha256:'.length);
  document.source.metadata.userInput = imageId;
  document.source.metadata.repoDigests = [`crypto-lending-${kind}@${imageId}`];
}

function writeBindingPair(
  apiBinding = syftBindingDocument('api'),
  webBinding = syftBindingDocument('web'),
  apiImageBinding = imageBindingDocument('api'),
  webImageBinding = imageBindingDocument('web'),
) {
  return {
    apiBindingPath: write('sboms/api.syft.json', apiBinding),
    webBindingPath: write('sboms/web.syft.json', webBinding),
    apiImageBindingPath: write('sboms/api.binding.json', apiImageBinding),
    webImageBindingPath: write('sboms/web.binding.json', webImageBinding),
    sourceRevision: SOURCE_REVISION,
  };
}

function writeSbomPair(
  api = spdxDocument('api'),
  web = spdxDocument('web'),
  apiBinding = syftBindingDocument('api'),
  webBinding = syftBindingDocument('web'),
) {
  return {
    apiPath: write('sboms/api.spdx.json', api),
    webPath: write('sboms/web.spdx.json', web),
    ...writeBindingPair(apiBinding, webBinding),
  };
}

function assertCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof ProductionSbomValidationError, true);
    assert.equal(error.code, code);
    return true;
  });
}

function assertCaptureCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof ProductionImageBindingCaptureError, true);
    assert.equal(error.code, code);
    return true;
  });
}

describe('local Docker image archive binding validation', () => {
  it('accepts manifest, OCI index, and classic config identity chains', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const manifest = validateProductionImageBindingBytes(
      imageBindingDocument('api'),
      'api',
      expectations,
      API_IMAGE_ID,
    );
    assert.equal(manifest.chainType, 'manifest-config');
    assert.equal(manifest.rootDigest, API_IMAGE_ID);

    const indexed = indexedImageBindingDocument('api');
    const index = validateProductionImageBindingBytes(
      indexed.bytes,
      'api',
      expectations,
      indexed.imageId,
    );
    assert.equal(index.chainType, 'index-manifest-config');
    assert.equal(index.manifestDigest, imageMaterial('api').manifestDigest);

    const direct = directConfigImageBindingDocument('api');
    const config = validateProductionImageBindingBytes(
      direct.bytes,
      'api',
      expectations,
      direct.imageId,
    );
    assert.equal(config.chainType, 'config');
    assert.equal(config.configDigest, direct.imageId);
  });

  it('rejects index, manifest, and config substitutions even when claims are rewritten', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const cases = [
      imageBindingDocument('api', (document) => {
        document.capturedImageId = document.config.digest;
        document.inspectBeforeImageId = document.config.digest;
        document.inspectAfterImageId = document.config.digest;
      }),
      imageBindingDocument('api', (document) => {
        document.manifest.bytes = Buffer.from('{}').toString('base64');
      }),
      imageBindingDocument('api', (document) => {
        const forged = Buffer.from('{"architecture":"amd64","os":"linux"}');
        document.config = bindingBlob(forged, 'application/vnd.docker.container.image.v1+json');
      }),
    ];
    for (const bytes of cases) {
      assert.throws(
        () => validateProductionImageBindingBytes(bytes, 'api', expectations, API_IMAGE_ID),
        ProductionSbomValidationError,
      );
    }

    const indexed = indexedImageBindingDocument('api');
    const document = JSON.parse(indexed.bytes.toString('utf8'));
    const index = JSON.parse(Buffer.from(document.index.bytes, 'base64').toString('utf8'));
    index.manifests[0].digest = `sha256:${'f'.repeat(64)}`;
    const indexBytes = Buffer.from(JSON.stringify(index));
    const forgedId = `sha256:${createHash('sha256').update(indexBytes).digest('hex')}`;
    document.index = bindingBlob(indexBytes, 'application/vnd.oci.image.index.v1+json');
    document.capturedImageId = forgedId;
    document.inspectBeforeImageId = forgedId;
    document.inspectAfterImageId = forgedId;
    assertCode(
      () =>
        validateProductionImageBindingBytes(
          Buffer.from(JSON.stringify(document)),
          'api',
          expectations,
          forgedId,
        ),
      'IMAGE_BINDING_MANIFEST_DESCRIPTOR_INVALID',
    );
  });

  it('rejects wrong-platform, attestation, and duplicate index descriptors', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const mutations = [
      {
        code: 'IMAGE_BINDING_PLATFORM_SELECTION_INVALID',
        mutate(index) {
          index.manifests[0].platform.architecture = 'arm64';
        },
      },
      {
        code: 'IMAGE_BINDING_ATTESTATION_INVALID',
        mutate(index) {
          index.manifests[0].annotations = {
            'vnd.docker.reference.type': 'attestation-manifest',
          };
        },
      },
      {
        code: 'IMAGE_BINDING_DESCRIPTOR_DUPLICATE',
        mutate(index) {
          index.manifests.push(JSON.parse(JSON.stringify(index.manifests[0])));
        },
      },
    ];
    for (const { code, mutate } of mutations) {
      const indexed = indexedImageBindingDocument('api', mutate);
      assertCode(
        () =>
          validateProductionImageBindingBytes(indexed.bytes, 'api', expectations, indexed.imageId),
        code,
      );
    }
  });

  it('rejects duplicate keys and before/after tag identity drift', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const duplicate = imageBindingDocument('api')
      .toString('utf8')
      .replace('"workspace": "api",', '"workspace": "api", "\\u0077orkspace": "web",');
    assertCode(
      () =>
        validateProductionImageBindingBytes(
          Buffer.from(duplicate),
          'api',
          expectations,
          API_IMAGE_ID,
        ),
      'JSON_DUPLICATE_KEY',
    );
    const drift = imageBindingDocument('api', (document) => {
      document.inspectAfterImageId = `sha256:${'f'.repeat(64)}`;
    });
    assertCode(
      () => validateProductionImageBindingBytes(drift, 'api', expectations, API_IMAGE_ID),
      'IMAGE_BINDING_IDENTITY_INVALID',
    );
  });
});

describe('local Docker image archive capture boundaries', () => {
  it('captures a complete classic archive with every ordered layer present', () => {
    const outputDirectory = path.join(fixtureRoot, '.local-validation', 'production-sbom');
    mkdirSync(outputDirectory, { recursive: true });
    const archive = classicDockerArchive('api');
    const outputPath = path.join(outputDirectory, 'api-image.binding.json');

    const evidence = captureProductionImageBinding({
      workspaceKind: 'api',
      imageReference: 'crypto-lending-api:ci',
      expectedImageId: archive.imageId,
      outputPath,
      repoRoot: fixtureRoot,
      inspect() {
        return archive.imageId;
      },
      save(_docker, _image, archivePath) {
        writeFileSync(archivePath, archive.bytes);
      },
    });

    assert.equal(evidence.archiveFormat, 'docker');
    assert.equal(evidence.chainType, 'config');
    assert.equal(existsSync(outputPath), true);
  });

  it('rejects omitted classic layer payloads before writing binding evidence', () => {
    const outputDirectory = path.join(fixtureRoot, '.local-validation', 'production-sbom');
    mkdirSync(outputDirectory, { recursive: true });
    const archive = classicDockerArchive('api', false);
    const outputPath = path.join(outputDirectory, 'api-image.binding.json');

    assertCaptureCode(
      () =>
        captureProductionImageBinding({
          workspaceKind: 'api',
          imageReference: 'crypto-lending-api:ci',
          expectedImageId: archive.imageId,
          outputPath,
          repoRoot: fixtureRoot,
          inspect() {
            return archive.imageId;
          },
          save(_docker, _image, archivePath) {
            writeFileSync(archivePath, archive.bytes);
          },
        }),
      'ARCHIVE_DOCKER_LAYER_BINDING_INVALID',
    );
    assert.equal(existsSync(outputPath), false);
  });

  it('streams and rejects a forged content-addressed blob above the retention ceiling', () => {
    const payload = Buffer.alloc(16 * 1024 * 1024 + 1, 0x61);
    const archivePath = path.join(fixtureRoot, 'forged-large-blob.tar');
    writeFileSync(
      archivePath,
      tarArchive([{ contents: payload, pathname: `blobs/sha256/${'0'.repeat(64)}` }]),
    );

    assertCaptureCode(() => readDockerSaveArchive(archivePath), 'ARCHIVE_BLOB_DIGEST_INVALID');
  });

  it('fails before parsing when the image tag changes across docker save', () => {
    const outputDirectory = path.join(fixtureRoot, '.local-validation', 'production-sbom');
    mkdirSync(outputDirectory, { recursive: true });
    const observed = [API_IMAGE_ID, `sha256:${'f'.repeat(64)}`];
    assertCaptureCode(
      () =>
        captureProductionImageBinding({
          workspaceKind: 'api',
          imageReference: 'crypto-lending-api:ci',
          expectedImageId: API_IMAGE_ID,
          outputPath: path.join(outputDirectory, 'api-image.binding.json'),
          repoRoot: fixtureRoot,
          inspect() {
            return observed.shift();
          },
          save(_docker, _image, archivePath) {
            writeFileSync(archivePath, Buffer.alloc(1024));
          },
        }),
      'IMAGE_TAG_DRIFT',
    );
    assert.equal(existsSync(path.join(outputDirectory, 'api-image.binding.json')), false);
  });

  it('rejects a pre-created output link without modifying its target', (t) => {
    const outputDirectory = path.join(fixtureRoot, '.local-validation', 'production-sbom');
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, 'api-image.binding.json');
    const targetPath = path.join(fixtureRoot, 'outside-binding.json');
    writeFileSync(targetPath, 'unchanged\n');
    try {
      symlinkSync(targetPath, outputPath, 'file');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
        t.diagnostic('Symbolic-link creation is not permitted on this host.');
        return;
      }
      throw error;
    }
    assertCaptureCode(
      () =>
        writeProductionImageBindingEvidence(
          outputPath,
          { bounded: true },
          {
            repoRoot: fixtureRoot,
            workspaceKind: 'api',
          },
        ),
      'OUTPUT_WRITE_FAILED',
    );
    assert.equal(readFileSync(targetPath, 'utf8'), 'unchanged\n');
  });

  it('detects an output-parent identity swap between validation and exclusive open', () => {
    const outputDirectory = path.join(fixtureRoot, '.local-validation', 'production-sbom');
    const movedDirectory = path.join(fixtureRoot, '.local-validation', 'production-sbom-before');
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = path.join(outputDirectory, 'api-image.binding.json');
    assertCaptureCode(
      () =>
        writeProductionImageBindingEvidence(
          outputPath,
          { bounded: true },
          {
            repoRoot: fixtureRoot,
            workspaceKind: 'api',
            beforeOpen() {
              renameSync(outputDirectory, movedDirectory);
              mkdirSync(outputDirectory);
            },
          },
        ),
      'OUTPUT_PATH_RACE',
    );
  });
});

describe('actual-image SPDX validation', () => {
  it('accepts exact Syft image documents and reports exact byte identities', () => {
    const files = writeSbomPair();
    const result = validateProductionSbomFiles({
      ...files,
      repoRoot: fixtureRoot,
      apiImageId: API_IMAGE_ID,
      webImageId: WEB_IMAGE_ID,
    });

    assert.equal(result.api.image, `docker:${API_IMAGE_ID}`);
    assert.equal(result.web.image, `docker:${WEB_IMAGE_ID}`);
    assert.equal(result.api.taggedImage, 'docker:crypto-lending-api:ci');
    assert.equal(result.api.syftVersion, SYFT_VERSION);
    assert.equal(result.api.packageCount, 7);
    assert.equal(result.web.packageCount, 4);
    assert.match(result.api.sha256, /^[0-9a-f]{64}$/u);
    assert.notEqual(result.api.sha256, result.web.sha256);
  });

  it('binds the retained Syft source record to the captured local input and OCI revision', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const apiImageBinding = validatedImageBinding('api');
    const accepted = validateProductionSyftBindingBytes(
      syftBindingDocument('api'),
      'api',
      expectations,
      API_IMAGE_ID,
      SOURCE_REVISION,
      apiImageBinding,
    );
    assert.equal(accepted.image, `docker:${API_IMAGE_ID}`);
    assert.equal(accepted.taggedImage, 'docker:crypto-lending-api:ci');
    assert.match(accepted.imageConfigDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(accepted.imageManifestDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.notEqual(accepted.imageConfigDigest, accepted.imageManifestDigest);

    assertCode(
      () =>
        validateProductionSyftBindingBytes(
          syftBindingDocument('api'),
          'api',
          expectations,
          `sha256:${'f'.repeat(64)}`,
          SOURCE_REVISION,
          { ...apiImageBinding, imageId: `sha256:${'f'.repeat(64)}` },
        ),
      'SYFT_IMAGE_INPUT_BINDING_INVALID',
    );
    assertCode(
      () =>
        validateProductionSyftBindingBytes(
          syftBindingDocument('api'),
          'api',
          expectations,
          API_IMAGE_ID,
          'f'.repeat(40),
          apiImageBinding,
        ),
      'SYFT_OCI_IDENTITY_INVALID',
    );
  });

  it('rejects forged source evidence, content digests, schema, and network-enabled cataloging', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const apiImageBinding = validatedImageBinding('api');
    const cases = [
      [
        'SYFT_IMAGE_INPUT_BINDING_INVALID',
        (document) => {
          document.source.metadata.userInput = `sha256:${'f'.repeat(64)}`;
        },
      ],
      [
        'SYFT_IMAGE_INPUT_BINDING_INVALID',
        (document) => {
          document.source.metadata.repoDigests[0] = `crypto-lending-api@sha256:${'f'.repeat(64)}`;
        },
      ],
      [
        'SYFT_IMAGE_CONTENT_BINDING_INVALID',
        (document) => {
          document.source.metadata.manifest = Buffer.from('{}').toString('base64');
        },
      ],
      [
        'SYFT_OCI_IDENTITY_INVALID',
        (document) => {
          document.source.metadata.labels['org.opencontainers.image.title'] = 'crypto-lending-web';
        },
      ],
      [
        'SYFT_DESCRIPTOR_INVALID',
        (document) => {
          document.descriptor.configuration.packages['java-archive']['use-network'] = true;
        },
      ],
      [
        'SYFT_SCHEMA_INVALID',
        (document) => {
          document.schema.version = '16.1.9';
        },
      ],
      [
        'SYFT_ARTIFACTS_INVALID',
        (document) => {
          document.artifacts[1].id = document.artifacts[0].id;
        },
      ],
    ];
    for (const [code, mutate] of cases) {
      assertCode(
        () =>
          validateProductionSyftBindingBytes(
            syftBindingDocument('api', mutate),
            'api',
            expectations,
            API_IMAGE_ID,
            SOURCE_REVISION,
            apiImageBinding,
          ),
        code,
      );
    }
  });

  it('rejects self-consistent forged evidence whose config bytes cannot match the captured image ID', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const apiImageBinding = validatedImageBinding('api');
    const forged = syftBindingDocument('api', (document) => {
      const config = JSON.parse(
        Buffer.from(document.source.metadata.config, 'base64').toString('utf8'),
      );
      config.history[0].created_by = 'forged-build';
      replaceNativeConfig(document, Buffer.from(JSON.stringify(config)));
      claimNativeImageId(document, API_IMAGE_ID);
      document.artifacts = [{ id: nativeId('forged-package'), name: 'forged', version: '9.9.9' }];
      document.files = [{ id: nativeId('forged-file') }];
      document.artifactRelationships = [
        {
          parent: document.source.id,
          child: document.artifacts[0].id,
          type: 'contains',
        },
        {
          parent: document.source.id,
          child: document.files[0].id,
          type: 'contains',
        },
      ];
    });
    assertCode(
      () =>
        validateProductionSyftBindingBytes(
          forged,
          'api',
          expectations,
          API_IMAGE_ID,
          SOURCE_REVISION,
          apiImageBinding,
        ),
      'SYFT_ARCHIVE_CONFIG_BINDING_INVALID',
    );
  });

  it('rejects reordered or substituted native synthetic rootfs layers', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const apiImageBinding = validatedImageBinding('api');

    const layerMutations = [
      (document) => {
        document.source.metadata.layers.reverse();
        replaceNativeManifest(document, (manifest) => manifest.layers.reverse());
      },
      (document) => {
        const replacement = `sha256:${'9'.repeat(64)}`;
        document.source.metadata.layers[0].digest = replacement;
        replaceNativeManifest(document, (manifest) => {
          manifest.layers[0].digest = replacement;
        });
      },
    ];
    for (const mutate of layerMutations) {
      assertCode(
        () =>
          validateProductionSyftBindingBytes(
            syftBindingDocument('api', mutate),
            'api',
            expectations,
            API_IMAGE_ID,
            SOURCE_REVISION,
            apiImageBinding,
          ),
        'SYFT_ROOTFS_BINDING_INVALID',
      );
    }
  });

  it('rejects duplicate JSON keys in repository, SPDX, and native Syft inputs', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    writeFileSync(
      path.join(fixtureRoot, 'package.json'),
      '{"name":"crypto-lending","\\u006eame":"forged","version":"0.1.0","private":true}\n',
    );
    assertCode(() => loadProductionSbomExpectations(fixtureRoot), 'JSON_DUPLICATE_KEY');

    const spdx = spdxDocument('api')
      .toString('utf8')
      .replace(
        '"spdxVersion": "SPDX-2.3",',
        '"spdxVersion": "SPDX-2.3", "\\u0073pdxVersion": "SPDX-2.3",',
      );
    assertCode(
      () => validateProductionSpdxBytes(Buffer.from(spdx), 'api', expectations, API_IMAGE_ID),
      'JSON_DUPLICATE_KEY',
    );

    const native = syftBindingDocument('api')
      .toString('utf8')
      .replace(
        `"userInput": "${API_IMAGE_ID}",`,
        `"userInput": "${API_IMAGE_ID}", "\\u0075serInput": "${API_IMAGE_ID}",`,
      );
    assertCode(
      () =>
        validateProductionSyftBindingBytes(
          Buffer.from(native),
          'api',
          expectations,
          API_IMAGE_ID,
          SOURCE_REVISION,
          validatedImageBinding('api'),
        ),
      'JSON_DUPLICATE_KEY',
    );
  });

  it('rejects cross-format inventory divergence and swapped binding records', () => {
    const divergent = syftBindingDocument('api', (document) => {
      document.artifacts.find(({ name }) => name === '@nestjs/core').version = '0.0.0';
    });
    const divergentFiles = writeSbomPair(spdxDocument('api'), spdxDocument('web'), divergent);
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...divergentFiles,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
        }),
      'SBOM_CROSS_FORMAT_BINDING_INVALID',
    );

    makeRepositoryFixture();
    const swapped = writeSbomPair();
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...swapped,
          apiBindingPath: swapped.webBindingPath,
          webBindingPath: swapped.apiBindingPath,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
        }),
      'SYFT_IMAGE_INPUT_BINDING_INVALID',
    );
  });

  it('rejects missing runtime packages, wrong versions, and missing containment', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const missing = spdxDocument('api', (document) => {
      document.packages = document.packages.filter((item) => item.name !== '@nestjs/core');
      document.relationships = document.relationships.filter(
        (item) => !item.relatedSpdxElement.includes('nestjs-core'),
      );
    });
    assertCode(
      () => validateProductionSpdxBytes(missing, 'api', expectations, API_IMAGE_ID),
      'REQUIRED_RUNTIME_PACKAGE_MISSING',
    );

    const wrongVersion = spdxDocument('web', (document) => {
      document.packages.find((item) => item.name === 'react').versionInfo = '0.0.0';
    });
    assertCode(
      () => validateProductionSpdxBytes(wrongVersion, 'web', expectations, WEB_IMAGE_ID),
      'REQUIRED_RUNTIME_PACKAGE_MISSING',
    );

    const uncontained = spdxDocument('web', (document) => {
      document.relationships = document.relationships.filter(
        (item) => !item.relatedSpdxElement.includes('react-dom'),
      );
    });
    assertCode(
      () => validateProductionSpdxBytes(uncontained, 'web', expectations, WEB_IMAGE_ID),
      'REQUIRED_RUNTIME_RELATIONSHIP_MISSING',
    );
  });

  it('rejects development-only Solana code and package managers in either runtime image', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    for (const forbiddenName of ['@solana/web3.js', 'npm']) {
      const bytes = spdxDocument('api', (document) => {
        const forbidden = packageRecord(forbiddenName, '1.0.0');
        document.packages.push(forbidden);
        document.relationships.push({
          spdxElementId: document.packages[0].SPDXID,
          relatedSpdxElement: forbidden.SPDXID,
          relationshipType: 'CONTAINS',
        });
      });
      assertCode(
        () => validateProductionSpdxBytes(bytes, 'api', expectations, API_IMAGE_ID),
        'FORBIDDEN_RUNTIME_PACKAGE',
      );
    }
  });

  it('rejects malformed image identity, creator, namespace, and SPDX version', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const cases = [
      [
        'SPDX_DOCUMENT_INVALID',
        (document) => {
          document.spdxVersion = 'SPDX-2.2';
        },
      ],
      [
        'SPDX_CREATION_INFO_INVALID',
        (document) => {
          document.creationInfo.creators[1] = 'Tool: syft-1.51.0';
        },
      ],
      [
        'SPDX_NAMESPACE_INVALID',
        (document) => {
          document.documentNamespace = 'https://example.com/syft/image/not-ours';
        },
      ],
      [
        'IMAGE_INPUT_BINDING_INVALID',
        (document) => {
          document.packages[0].versionInfo = 'latest';
        },
      ],
      [
        'IMAGE_INPUT_BINDING_INVALID',
        (document) => {
          document.packages[0].checksums[0].checksumValue = 'c'.repeat(64);
        },
      ],
    ];
    for (const [code, mutate] of cases) {
      assertCode(
        () =>
          validateProductionSpdxBytes(
            spdxDocument('api', mutate),
            'api',
            expectations,
            API_IMAGE_ID,
          ),
        code,
      );
    }
    assertCode(
      () =>
        validateProductionSpdxBytes(
          spdxDocument('api'),
          'api',
          expectations,
          `sha256:${'f'.repeat(64)}`,
        ),
      'IMAGE_INPUT_BINDING_INVALID',
    );
  });

  it('rejects duplicate IDs, duplicate relationships, dangling relationships, and unsafe image paths', () => {
    const expectations = loadProductionSbomExpectations(fixtureRoot);
    const duplicateId = spdxDocument('api', (document) => {
      document.packages[2].SPDXID = document.packages[1].SPDXID;
    });
    assertCode(
      () => validateProductionSpdxBytes(duplicateId, 'api', expectations, API_IMAGE_ID),
      'SPDX_PACKAGE_ID_DUPLICATE',
    );

    const duplicateRelationship = spdxDocument('api', (document) => {
      document.relationships.push({ ...document.relationships[0] });
    });
    assertCode(
      () => validateProductionSpdxBytes(duplicateRelationship, 'api', expectations, API_IMAGE_ID),
      'SPDX_RELATIONSHIP_DUPLICATE',
    );

    const dangling = spdxDocument('api', (document) => {
      document.relationships[1].relatedSpdxElement = 'SPDXRef-Package-missing';
    });
    assertCode(
      () => validateProductionSpdxBytes(dangling, 'api', expectations, API_IMAGE_ID),
      'SPDX_RELATIONSHIP_DANGLING',
    );

    const unsafePath = spdxDocument('api', (document) => {
      document.files[0].fileName = '../outside';
    });
    assertCode(
      () => validateProductionSpdxBytes(unsafePath, 'api', expectations, API_IMAGE_ID),
      'SPDX_FILE_INVALID',
    );
  });

  it('rejects malformed, duplicate-path, non-regular, hard-linked, symlink, and oversized inputs', (t) => {
    const malformed = write('bad.spdx.json', '{');
    const good = write('good-web.spdx.json', spdxDocument('web'));
    const bindings = writeBindingPair();
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...bindings,
          apiPath: malformed,
          webPath: good,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
        }),
      'SPDX_JSON_INVALID',
    );
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...bindings,
          apiPath: good,
          webPath: good,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
        }),
      'SBOM_PATHS_DUPLICATE',
    );
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...bindings,
          apiPath: fixtureRoot,
          webPath: good,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
        }),
      'SBOM_FILE_UNSAFE',
    );

    const oversized = write('oversized.spdx.json', 'x');
    truncateSync(oversized, MAX_PRODUCTION_SBOM_BYTES + 1);
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...bindings,
          apiPath: oversized,
          webPath: good,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
        }),
      'SBOM_FILE_UNSAFE',
    );

    const linkedSource = write('linked-source.spdx.json', spdxDocument('api'));
    const hardLink = path.join(fixtureRoot, 'hard-link.spdx.json');
    linkSync(linkedSource, hardLink);
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...bindings,
          apiPath: linkedSource,
          webPath: good,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
        }),
      'SBOM_FILE_UNSAFE',
    );

    const symlink = path.join(fixtureRoot, 'symlink.spdx.json');
    try {
      symlinkSync(good, symlink, 'file');
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'EPERM') {
        t.diagnostic('Symbolic-link creation is unavailable on this host.');
        return;
      }
      throw error;
    }
    assert.equal(lstatSync(symlink).isSymbolicLink(), true);
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...bindings,
          apiPath: symlink,
          webPath: malformed,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
        }),
      'SBOM_FILE_UNSAFE',
    );
  });

  it('rejects a same-size rewrite between the two descriptor reads', () => {
    const original = Buffer.from('{"releaseGate":"original"}\n', 'utf8');
    const changed = Buffer.from('{"releaseGate":"modified"}\n', 'utf8');
    assert.equal(changed.length, original.length);
    const unstable = write('unstable.spdx.json', original);

    assertCode(
      () =>
        readSecureRegularFile(unstable, MAX_PRODUCTION_SBOM_BYTES, () =>
          writeFileSync(unstable, changed),
        ),
      'SBOM_FILE_UNSAFE',
    );
  });

  it('rejects artifact and repository rewrites across the complete validation pass', () => {
    const files = writeSbomPair();
    const apiBytes = readFileSync(files.apiPath);
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...files,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
          afterDocumentValidationForTest() {
            writeFileSync(files.apiPath, Buffer.concat([apiBytes, Buffer.from(' ')]));
          },
        }),
      'SBOM_FILE_SET_CHANGED',
    );

    writeFileSync(files.apiPath, apiBytes);
    const rootManifestPath = path.join(fixtureRoot, 'package.json');
    const rootManifestBytes = readFileSync(rootManifestPath);
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...files,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
          afterDocumentValidationForTest() {
            writeFileSync(rootManifestPath, Buffer.concat([rootManifestBytes, Buffer.from(' ')]));
          },
        }),
      'REPOSITORY_STATE_CHANGED',
    );
  });

  it('sanitizes descriptor close failures to the fixed unsafe-file code', () => {
    assertCode(() => closeSecureFileDescriptorForTest(-1), 'SBOM_FILE_UNSAFE');
  });

  it('rejects reused namespaces and image IDs across the two exact documents', () => {
    const sameNamespace = spdxDocument('web', (document) => {
      document.documentNamespace =
        'https://anchore.com/syft/image/sha256-33333333-3333-4333-8333-333333333333';
    });
    const files = writeSbomPair(spdxDocument('api'), sameNamespace);
    const accepted = validateProductionSbomFiles({
      ...files,
      repoRoot: fixtureRoot,
      apiImageId: API_IMAGE_ID,
      webImageId: WEB_IMAGE_ID,
    });
    assert.notEqual(accepted.api.namespace, accepted.web.namespace);
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...files,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: API_IMAGE_ID,
        }),
      'IMAGE_IDS_DUPLICATE',
    );

    const apiDocument = JSON.parse(readFileSync(files.apiPath, 'utf8'));
    const webDocument = JSON.parse(readFileSync(files.webPath, 'utf8'));
    webDocument.documentNamespace = apiDocument.documentNamespace;
    writeFileSync(files.webPath, `${JSON.stringify(webDocument)}\n`);
    assertCode(
      () =>
        validateProductionSbomFiles({
          ...files,
          repoRoot: fixtureRoot,
          apiImageId: API_IMAGE_ID,
          webImageId: WEB_IMAGE_ID,
        }),
      'SBOM_IDENTITIES_DUPLICATE',
    );
  });
});

describe('SBOM CI integration policy', () => {
  it('pins the official action and Syft, forces local Docker inputs, disables uploads, and orders validation before release binding', () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '..');
    const workflow = readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
    assert.equal(validateProductionSbomWorkflowText(workflow), true);
    assert.equal(SBOM_ACTION_COMMIT.length, 40);
    assert.equal(
      existsSync(path.join(repositoryRoot, 'scripts/generate-production-sboms.mjs')),
      false,
    );
    assert.deepEqual(PRODUCTION_SBOM_FILES, {
      api: '.local-validation/production-sbom/api-image.spdx.json',
      web: '.local-validation/production-sbom/web-image.spdx.json',
    });
    assert.deepEqual(PRODUCTION_SBOM_BINDING_FILES, {
      api: '.local-validation/production-sbom/api-image.syft.json',
      web: '.local-validation/production-sbom/web-image.syft.json',
    });
    assert.deepEqual(PRODUCTION_IMAGE_BINDING_FILES, {
      api: '.local-validation/production-sbom/api-image.binding.json',
      web: '.local-validation/production-sbom/web-image.binding.json',
    });
  });

  it('rejects provenance, action, upload, OCI source, local input, binding, tag-check, and order mutations', () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '..');
    const workflow = readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
    const mutations = [
      workflow.replace(
        'docker build --provenance=false --file Dockerfile.api',
        'docker build --file Dockerfile.api',
      ),
      workflow.replace(SBOM_ACTION_COMMIT, 'f'.repeat(40)),
      workflow.replace('upload-artifact: false', 'upload-artifact: true'),
      workflow.replace(
        '--build-arg "OCI_SOURCE=https://github.com/BurstCrypto/Crypto-lending"',
        '--build-arg "OCI_SOURCE=https://example.invalid/repository"',
      ),
      workflow.replace(
        'output-file: .local-validation/production-sbom/api-image.spdx.json',
        'output-file: /tmp/api.spdx.json',
      ),
      workflow.replace(
        'image: docker:${{ steps.production-image-identities.outputs.api_id }}',
        'image: docker:crypto-lending-api:ci',
      ),
      workflow.replace(
        'output-file: .local-validation/production-sbom/api-image.syft.json',
        'output-file: /tmp/api.syft.json',
      ),
      workflow.replace(
        'production:sbom:capture -- api crypto-lending-api:ci "$API_IMAGE_ID" .local-validation/production-sbom/api-image.binding.json',
        'production:sbom:capture -- api crypto-lending-api:ci "$API_IMAGE_ID" /tmp/api.binding.json',
      ),
      workflow.replace(
        'test "$CURRENT_API_IMAGE_ID" = "$API_IMAGE_ID"',
        'test -n "$CURRENT_API_IMAGE_ID"',
      ),
      workflow.replace(
        '- name: Validate exact production image SBOMs',
        '- name: ZZZ temporarily moved validation',
      ),
    ];
    for (const mutation of mutations) {
      assertCode(
        () => validateProductionSbomWorkflowText(mutation),
        mutation.includes('ZZZ') ? 'CI_SBOM_ORDER_INVALID' : 'CI_SBOM_CONFIGURATION_INVALID',
      );
    }
  });
});
