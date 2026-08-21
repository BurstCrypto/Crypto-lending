#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_SCANNABLE_TEXT_BYTES = 2_000_000;

const MAX_GIT_OUTPUT_BYTES = 96 * 1024 * 1024;
const BLOB_BATCH_SIZE = 32;
const OBJECT_ID_PATTERN = /^[0-9a-f]{40,64}$/u;
const KNOWN_BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avi',
  '.bmp',
  '.bz2',
  '.class',
  '.dll',
  '.dylib',
  '.eot',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.o',
  '.otf',
  '.pdf',
  '.png',
  '.so',
  '.tar',
  '.tgz',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xz',
  '.zip',
]);

const REVIEWED_DUMMY_VALUES = new Set([
  ['AK', 'IA', 'IOSFODNN7EXAMPLE'].join(''),
  'Bearer actual-token-material',
  'a-long-preview-only-password',
  'correct-horse-battery-staple-lab',
  'local-acl-operator',
  'local-api-current',
  'local_admin_only',
  'local_api_database_a',
  'local_migration_only',
  'local_only_password',
  'local_worker_database_a',
  'replace-with-an-atlassian-api-token',
  'test-only-placeholder',
  'token with:/reserved@characters',
  'wc:pairing-topic@2?symKey=do-not-leak',
]);

// These tuples are deliberately narrow: protocol, decoded username, decoded
// password, and host must all match a reviewed local or negative-test fixture.
const REVIEWED_DUMMY_URL_CREDENTIALS = new Set([
  'postgres|crypto_admin|local_admin_only|localhost',
  'postgres|crypto_api_login_a|local_api_database_a|localhost',
  'postgres|crypto_lending|local_only_password|localhost',
  'postgres|crypto_migration|local_migration_only|localhost',
  'postgres|openapi|openapi|127.0.0.1',
  'postgres|test|test|127.0.0.1',
  'postgresql|crypto_admin|local_admin_only|127.0.0.1',
  'postgresql|crypto_admin|local_admin_only|localhost',
  'postgresql|crypto_admin|secret|db.internal.example',
  'postgresql|crypto_api_login_a||db.internal.example',
  'postgresql|crypto_api_login_a|local_api_database_a|127.0.0.1',
  'postgresql|crypto_api_login_a|local_api_database_a|localhost',
  'postgresql|crypto_api_login_blue|secret|db.internal.example',
  'postgresql|crypto_lending|local_only_password|127.0.0.1',
  'postgresql|crypto_lending|local_only_password|localhost',
  'postgresql|crypto_migration|local|127.0.0.1',
  'postgresql|crypto_migration|local_migration_only|127.0.0.1',
  'postgresql|crypto_migration|local_migration_only|localhost',
  'postgresql|crypto_migration|secret|db.internal.example',
  'postgresql|crypto_runtime|secret|db.internal.example',
  'postgresql|crypto_runtime||db.internal.example',
  'postgresql|crypto_worker_login_a|local|127.0.0.1',
  'postgresql|crypto_worker_login_a|secret|db.internal.example',
  'postgresql|legacy|local|127.0.0.1',
  'postgresql|legacy|secret|db.internal.example',
  'postgresql|local|local|127.0.0.1',
  'postgresql|migration|secret|db.internal.example',
  'postgresql|service user|p@ss:/word|db.internal.example',
  'postgresql|service|secret|db.internal.example',
  'rediss||\n|cache.internal.example',
  'rediss||%ZZ|cache.internal.example',
  'rediss||bad\\npassword|cache.internal.example',
  'rediss||not-exported|cache.internal.example',
  'rediss||token with:/reserved@characters|cache.internal.example',
  'rediss|${username}|not-exported|cache.internal.example',
  'rediss|crypto_api_a|not-exported|cache.internal.example',
  'rediss|crypto_api_test_a|not-exported|cache.internal.example',
  'rediss|local_api|token with:/reserved@characters|cache.internal.example',
  'rediss|user|do-not-log|cache',
  'https|user|secret|evidence.example.test',
  'https|user|token|team.atlassian.net',
  'https|user||example.test',
]);

const PROVIDER_RULES = Object.freeze([
  {
    id: 'provider.aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}\b/gu,
  },
  {
    id: 'provider.github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
  },
  {
    id: 'provider.slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/gu,
  },
  {
    id: 'provider.stripe-live-key',
    pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{12,}\b/gu,
  },
  {
    id: 'provider.npm-token',
    pattern: /\bnpm_[A-Za-z0-9]{20,}\b/gu,
  },
  {
    id: 'provider.pypi-token',
    pattern: /\bpypi-[A-Za-z0-9_-]{30,}\b/gu,
  },
  {
    id: 'provider.google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/gu,
  },
  {
    id: 'provider.sendgrid-key',
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/gu,
  },
]);

const PRIVATE_KEY_HEADER_PATTERN = new RegExp(
  [
    '-{5}BEGIN ',
    '(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?',
    'PRIVATE KEY-{5}|-{5}BEGIN PGP PRIVATE KEY BLOCK-{5}',
  ].join(''),
  'gu',
);
const URL_TOKEN_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]+/gu;
const JWT_CANDIDATE_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const ASSIGNMENT_NAME_SOURCE = '[A-Za-z_][A-Za-z0-9_.-]{0,255}';
const QUOTED_SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `(?<![A-Za-z0-9_.:-])["']?(${ASSIGNMENT_NAME_SOURCE})["']?\\s*[:=]\\s*(["'\x60])([^"'\x60\\r\\n]{1,512})\\2`,
  'giu',
);
const UNQUOTED_SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `^\\s*["']?(${ASSIGNMENT_NAME_SOURCE})["']?\\s*[:=]\\s*([A-Za-z0-9_+./=@:%-]{1,512})\\s*,?\\s*(?:#.*)?$`,
  'iu',
);

class ScannerOperationalError extends Error {}

function gitEnvironment() {
  return {
    ...process.env,
    GIT_NO_LAZY_FETCH: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd,
    encoding: options.encoding,
    env: gitEnvironment(),
    input: options.input,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });

  if (result.error || result.signal || result.status !== 0) {
    throw new ScannerOperationalError('Git operation failed.');
  }
  return result.stdout;
}

function runGitText(args, options = {}) {
  return runGit(args, { ...options, encoding: 'utf8' });
}

function repositoryHasHead(cwd) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    env: gitEnvironment(),
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal) throw new ScannerOperationalError('Git operation failed.');
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new ScannerOperationalError('Git operation failed.');
}

function parseTreeRecord(record, scope, entries) {
  const tab = record.indexOf('\t');
  if (tab < 0) throw new ScannerOperationalError('Malformed Git tree record.');
  const metadata = record.slice(0, tab).trim().split(/\s+/u);
  const path = record.slice(tab + 1);
  const [mode, type, blob] = metadata;
  if (mode === '160000' || type === 'commit') {
    entries.push({ blob: '-', mode, path, scope, unscannedGitlink: true });
    return;
  }
  if (type !== 'blob' || !OBJECT_ID_PATTERN.test(blob ?? '')) {
    throw new ScannerOperationalError('Malformed Git tree object.');
  }
  entries.push({ blob, mode, path, scope, unscannedGitlink: false });
}

function collectIndexEntries(cwd) {
  const output = runGit(['ls-files', '--stage', '-z'], { cwd });
  const entries = [];
  for (const rawRecord of output.toString('utf8').split('\0')) {
    if (!rawRecord) continue;
    const tab = rawRecord.indexOf('\t');
    if (tab < 0) throw new ScannerOperationalError('Malformed Git index record.');
    const [mode, blob] = rawRecord.slice(0, tab).trim().split(/\s+/u);
    const path = rawRecord.slice(tab + 1);
    if (mode === '160000') {
      entries.push({ blob: '-', mode, path, scope: 'index', unscannedGitlink: true });
      continue;
    }
    if (!OBJECT_ID_PATTERN.test(blob ?? '') || /^0+$/u.test(blob)) {
      throw new ScannerOperationalError('Malformed Git index object.');
    }
    entries.push({ blob, mode, path, scope: 'index', unscannedGitlink: false });
  }
  return entries;
}

function collectHistoryEntries(cwd) {
  if (!repositoryHasHead(cwd)) return [];
  const commits = runGitText(['rev-list', 'HEAD'], { cwd }).trim().split(/\s+/u).filter(Boolean);
  const entries = [];
  for (const commit of commits) {
    if (!OBJECT_ID_PATTERN.test(commit)) throw new ScannerOperationalError('Malformed commit ID.');
    const output = runGit(['ls-tree', '-r', '-z', '--full-tree', commit], { cwd });
    for (const record of output.toString('utf8').split('\0')) {
      if (record) parseTreeRecord(record, 'history', entries);
    }
  }
  return entries;
}

function deduplicateEntries(entries) {
  const deduplicated = new Map();
  for (const entry of entries) {
    const key = `${entry.scope}\0${entry.path}\0${entry.blob}\0${entry.mode}`;
    if (!deduplicated.has(key)) deduplicated.set(key, entry);
  }
  return [...deduplicated.values()];
}

function readBlobMetadata(cwd, blobIds) {
  if (blobIds.length === 0) return new Map();
  const output = runGitText(
    ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    { cwd, input: `${blobIds.join('\n')}\n` },
  );
  const metadata = new Map();
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    const [blob, type, rawSize] = line.trim().split(/\s+/u);
    const size = Number(rawSize);
    if (!OBJECT_ID_PATTERN.test(blob ?? '') || type !== 'blob' || !Number.isSafeInteger(size)) {
      throw new ScannerOperationalError('Git object is unavailable or malformed.');
    }
    metadata.set(blob, { size, type });
  }
  if (metadata.size !== blobIds.length) {
    throw new ScannerOperationalError('Git object metadata is incomplete.');
  }
  return metadata;
}

function parseBatchBlobOutput(output, expectedBlobIds) {
  const blobs = new Map();
  let offset = 0;
  for (const expectedBlob of expectedBlobIds) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) throw new ScannerOperationalError('Malformed Git blob stream.');
    const header = output.subarray(offset, newline).toString('ascii');
    const [blob, type, rawSize] = header.trim().split(/\s+/u);
    const size = Number(rawSize);
    if (
      blob !== expectedBlob ||
      type !== 'blob' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      newline + 1 + size >= output.length
    ) {
      throw new ScannerOperationalError('Malformed Git blob stream.');
    }
    const start = newline + 1;
    const end = start + size;
    if (output[end] !== 0x0a) throw new ScannerOperationalError('Malformed Git blob boundary.');
    blobs.set(blob, output.subarray(start, end));
    offset = end + 1;
  }
  if (offset !== output.length) throw new ScannerOperationalError('Unexpected Git blob data.');
  return blobs;
}

function readBlobs(cwd, blobIds) {
  const blobs = new Map();
  for (let index = 0; index < blobIds.length; index += BLOB_BATCH_SIZE) {
    const chunk = blobIds.slice(index, index + BLOB_BATCH_SIZE);
    const output = runGit(['cat-file', '--batch'], {
      cwd,
      input: Buffer.from(`${chunk.join('\n')}\n`, 'ascii'),
    });
    for (const [blob, value] of parseBatchBlobOutput(output, chunk)) blobs.set(blob, value);
  }
  return blobs;
}

function normalizedPath(path) {
  return path.replaceAll('\\', '/');
}

function sensitiveFilenameRule(path) {
  const normalized = normalizedPath(path).toLowerCase();
  const segments = normalized.split('/');
  const name = segments.at(-1) ?? '';
  if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) {
    return 'filename.dotenv';
  }
  if (name === '.jira.env') return 'filename.jira-env';
  if (['.npmrc', '.netrc', '_netrc', '.dockercfg'].includes(name)) {
    return 'filename.credential-store';
  }
  if (
    ['credentials', 'credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml'].includes(
      name,
    ) ||
    /^(?:service[-_]account)(?:[-_.].*)?\.json$/u.test(name)
  ) {
    return 'filename.credential-data';
  }
  if (/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\..*)?$/u.test(name)) {
    return 'filename.private-key';
  }
  if (/\.(?:pem|key|p12|pfx|jks|keystore)$/u.test(name)) return 'filename.private-key';
  if (/\.tfvars(?:\.json)?$/u.test(name)) return 'filename.terraform-variables';
  if (/\.secrets?\.(?:json|ya?ml)$/u.test(name)) return 'filename.credential-data';
  if (name === 'kubeconfig' || normalized.endsWith('/.kube/config')) {
    return 'filename.credential-store';
  }
  if (normalized.endsWith('/.aws/credentials') || normalized.endsWith('/.docker/config.json')) {
    return 'filename.credential-store';
  }
  return undefined;
}

function isKnownBinaryPath(path) {
  return KNOWN_BINARY_EXTENSIONS.has(extname(basename(path)).toLowerCase());
}

function decodeUtf16BigEndian(buffer) {
  const swapped = Buffer.allocUnsafe(buffer.length - 2);
  for (let index = 2; index + 1 < buffer.length; index += 2) {
    swapped[index - 2] = buffer[index + 1];
    swapped[index - 1] = buffer[index];
  }
  return swapped.toString('utf16le');
}

function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decodeUtf16BigEndian(buffer);
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let nulBytes = 0;
  let evenNuls = 0;
  let oddNuls = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) {
      nulBytes += 1;
      if (index % 2 === 0) evenNuls += 1;
      else oddNuls += 1;
    }
  }
  if (nulBytes > 0) {
    const expectedUtf16Nuls = Math.floor(sample.length / 4);
    if (oddNuls >= expectedUtf16Nuls && evenNuls === 0) return buffer.toString('utf16le');
    if (evenNuls >= expectedUtf16Nuls && oddNuls === 0)
      return decodeUtf16BigEndian(Buffer.concat([Buffer.from([0xfe, 0xff]), buffer]));
    return undefined;
  }
  return buffer.toString('utf8').replace(/^\uFEFF/u, '');
}

function shannonEntropy(value) {
  if (value.length === 0) return 0;
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function characterClassCount(value) {
  return [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u].reduce(
    (count, pattern) => count + Number(pattern.test(value)),
    0,
  );
}

function isReviewedPlaceholder(value) {
  const trimmed = value.trim();
  return (
    REVIEWED_DUMMY_VALUES.has(trimmed) ||
    /^<[^>]+>$/u.test(trimmed) ||
    /^\$\{(?:\{)?.+\}?(?:\})?$/u.test(trimmed) ||
    /^(?:process\.env|import\.meta\.env|env\.)/u.test(trimmed) ||
    /^\{\{resolve:/u.test(trimmed)
  );
}

function isDigestContext(name, value) {
  return (
    /(?:sha(?:256|384|512)?|hash|digest|checksum|fingerprint|etag)/iu.test(name) &&
    /^(?:sha256:)?[0-9a-f]{40,128}$/iu.test(value)
  );
}

function isHighEntropySecret(name, value) {
  const candidate = value.trim();
  if (candidate.length < 20 || candidate.length > 512) return false;
  if (isReviewedPlaceholder(candidate) || isDigestContext(name, candidate)) return false;
  const entropy = shannonEntropy(candidate);
  return entropy >= 3.8 && (characterClassCount(candidate) >= 2 || entropy >= 4.5);
}

function assignmentNameComponents(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .toLowerCase()
    .split(/[_.-]+/u)
    .filter(Boolean);
}

function isSecretAssignmentName(name) {
  const components = assignmentNameComponents(name);
  const componentSet = new Set(components);
  const containsSecretMaterialName =
    [
      'secret',
      'secrets',
      'token',
      'tokens',
      'password',
      'passwords',
      'passwd',
      'pwd',
      'credential',
      'credentials',
      'apikey',
      'apikeys',
      'accesskey',
      'accesskeys',
      'privatekey',
      'privatekeys',
      'clientsecret',
      'clientsecrets',
    ].some((component) => componentSet.has(component)) ||
    [
      ['api', 'key'],
      ['api', 'keys'],
      ['access', 'key'],
      ['access', 'keys'],
      ['private', 'key'],
      ['private', 'keys'],
      ['client', 'secret'],
      ['client', 'secrets'],
    ].some(([left, right]) => componentSet.has(left) && componentSet.has(right));
  if (!containsSecretMaterialName) return false;

  return ![
    'uri',
    'uris',
    'url',
    'urls',
    'path',
    'paths',
    'file',
    'files',
    'reference',
    'references',
    'ref',
    'refs',
    'endpoint',
    'endpoints',
  ].includes(components.at(-1));
}

function decodeComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isReviewedDummyCredentialUrl(url) {
  const tuple = [
    url.protocol.replace(/:$/u, '').toLowerCase(),
    decodeComponent(url.username),
    decodeComponent(url.password),
    url.hostname.toLowerCase(),
  ].join('|');
  return REVIEWED_DUMMY_URL_CREDENTIALS.has(tuple);
}

function decodedUrlCredentials(candidate) {
  const scheme = candidate.indexOf('://');
  const at = candidate.lastIndexOf('@');
  if (scheme < 0 || at <= scheme + 3) return [];
  const userinfo = candidate.slice(scheme + 3, at);
  const separator = userinfo.indexOf(':');
  const components =
    separator < 0 ? [userinfo] : [userinfo.slice(0, separator), userinfo.slice(separator + 1)];
  return components.map(decodeComponent).filter(Boolean);
}

function areExactCredentialPlaceholders(credentials) {
  return credentials.length > 0 && credentials.every(isReviewedPlaceholder);
}

function isStructurallyValidJwt(value) {
  const segments = value.split('.');
  if (segments.length !== 3) return false;
  try {
    const header = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return (
      header !== null &&
      typeof header === 'object' &&
      !Array.isArray(header) &&
      payload !== null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (typeof header.alg === 'string' || typeof header.typ === 'string')
    );
  } catch {
    return false;
  }
}

function fingerprint(rule, value) {
  return createHash('sha256').update(rule).update('\0').update(value).digest('hex').slice(0, 16);
}

function finding(rule, scope, path, line, blob, secretValue) {
  return {
    blob,
    fingerprint: fingerprint(rule, secretValue),
    line,
    path,
    rule,
    scope,
  };
}

function scanLine(line, lineNumber, blob, entries) {
  const matches = [];
  for (const rule of PROVIDER_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of line.matchAll(rule.pattern)) {
      if (!REVIEWED_DUMMY_VALUES.has(match[0])) {
        matches.push({ rule: rule.id, value: match[0] });
      }
    }
  }

  PRIVATE_KEY_HEADER_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(PRIVATE_KEY_HEADER_PATTERN)) {
    matches.push({ rule: 'key.private-key-header', value: match[0] });
  }

  JWT_CANDIDATE_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(JWT_CANDIDATE_PATTERN)) {
    if (isStructurallyValidJwt(match[0])) {
      matches.push({ rule: 'token.jwt', value: match[0] });
    }
  }

  URL_TOKEN_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(URL_TOKEN_PATTERN)) {
    const candidate = match[0].replace(/[,.;)\]}]+$/u, '');
    let url;
    try {
      url = new URL(candidate);
    } catch {
      if (/^rediss:\/\/:%(?:0A|ZZ)@cache\.internal\.example:6379$/iu.test(candidate)) continue;
      if (areExactCredentialPlaceholders(decodedUrlCredentials(candidate))) continue;
      if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@\s]*:[^/@\s]+@/u.test(candidate)) {
        matches.push({ rule: 'url.embedded-credentials', value: candidate });
      }
      continue;
    }
    const decodedCredentials = [
      decodeComponent(url.username),
      decodeComponent(url.password),
    ].filter(Boolean);
    if (
      decodedCredentials.length > 0 &&
      !areExactCredentialPlaceholders(decodedCredentials) &&
      !isReviewedDummyCredentialUrl(url)
    ) {
      matches.push({ rule: 'url.embedded-credentials', value: candidate });
    }
  }

  QUOTED_SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(QUOTED_SECRET_ASSIGNMENT_PATTERN)) {
    if (isSecretAssignmentName(match[1]) && isHighEntropySecret(match[1], match[3])) {
      matches.push({ rule: 'assignment.high-entropy-secret', value: match[3] });
    }
  }
  const unquoted = UNQUOTED_SECRET_ASSIGNMENT_PATTERN.exec(line);
  if (
    unquoted &&
    isSecretAssignmentName(unquoted[1]) &&
    isHighEntropySecret(unquoted[1], unquoted[2])
  ) {
    matches.push({ rule: 'assignment.high-entropy-secret', value: unquoted[2] });
  }

  const results = [];
  for (const match of matches) {
    for (const entry of entries) {
      results.push(finding(match.rule, entry.scope, entry.path, lineNumber, blob, match.value));
    }
  }
  return results;
}

function scanText(text, blob, entries) {
  const findings = [];
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    findings.push(...scanLine(lines[index], index + 1, blob, entries));
  }
  return findings;
}

function containsUnsafePathCharacters(value) {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function pathContainsDetectedSecret(value) {
  return scanLine(value, 0, '-', [{ blob: '-', path: '-', scope: 'path' }]).length > 0;
}

export function sanitizeOutputPath(path) {
  const value = String(path);
  if (!containsUnsafePathCharacters(value) && !pathContainsDetectedSecret(value)) return value;
  const digest = createHash('sha256')
    .update('output-path')
    .update('\0')
    .update(value)
    .digest('hex')
    .slice(0, 16);
  return `[redacted-path:${digest}]`;
}

function percentEncodeControl(character) {
  return [...Buffer.from(character, 'utf8')]
    .map((byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`)
    .join('');
}

export function escapeOutputField(value) {
  return String(value)
    .replaceAll('%', '%25')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, percentEncodeControl);
}

function emitFindings(findings) {
  const deduplicated = new Map();
  for (const item of findings) {
    const key = [item.rule, item.scope, item.path, item.line, item.blob, item.fingerprint].join(
      '\0',
    );
    if (!deduplicated.has(key)) deduplicated.set(key, item);
  }
  const ordered = [...deduplicated.values()].sort((left, right) =>
    [left.scope, left.path, left.line, left.rule, left.blob]
      .join('\0')
      .localeCompare([right.scope, right.path, right.line, right.rule, right.blob].join('\0')),
  );
  for (const item of ordered) {
    process.stdout.write(
      `rule=${escapeOutputField(item.rule)}\tscope=${escapeOutputField(item.scope)}\tpath=${escapeOutputField(sanitizeOutputPath(item.path))}\tline=${item.line}\tblob=${escapeOutputField(item.blob)}\tfingerprint=${item.fingerprint}\n`,
    );
  }
  return ordered.length;
}

function operationalFinding(rule, path = '-') {
  return finding(rule, 'repository', path, 0, '-', `${rule}\0${path}`);
}

export function scanRepository(cwd = process.cwd()) {
  const shallow = runGitText(['rev-parse', '--is-shallow-repository'], { cwd }).trim();
  if (shallow !== 'false') {
    return {
      findings: [operationalFinding('repository.shallow-history', '.git/shallow')],
      operational: true,
    };
  }

  const entries = deduplicateEntries([...collectIndexEntries(cwd), ...collectHistoryEntries(cwd)]);
  const findings = [];
  const entriesByBlob = new Map();

  for (const entry of entries) {
    if (entry.unscannedGitlink) {
      findings.push(operationalFinding('repository.unscanned-gitlink', entry.path));
      continue;
    }
    const filenameRule = sensitiveFilenameRule(entry.path);
    if (filenameRule) {
      findings.push(finding(filenameRule, entry.scope, entry.path, 0, entry.blob, entry.path));
    }
    if (containsUnsafePathCharacters(entry.path)) {
      findings.push(
        finding('filename.unsafe-characters', entry.scope, entry.path, 0, entry.blob, entry.path),
      );
    }
    findings.push(...scanLine(entry.path, 0, entry.blob, [entry]));
    const blobEntries = entriesByBlob.get(entry.blob) ?? [];
    blobEntries.push(entry);
    entriesByBlob.set(entry.blob, blobEntries);
  }

  const blobIds = [...entriesByBlob.keys()].sort();
  const metadata = readBlobMetadata(cwd, blobIds);
  const readableBlobIds = [];
  for (const blob of blobIds) {
    const blobEntries = entriesByBlob.get(blob) ?? [];
    const size = metadata.get(blob)?.size;
    if (!Number.isSafeInteger(size))
      throw new ScannerOperationalError('Missing Git blob metadata.');
    if (size > MAX_SCANNABLE_TEXT_BYTES) {
      for (const entry of blobEntries) {
        findings.push(finding('content.oversized-text', entry.scope, entry.path, 0, blob, blob));
      }
    } else {
      readableBlobIds.push(blob);
    }
  }

  const blobs = readBlobs(cwd, readableBlobIds);
  for (const blob of readableBlobIds) {
    const buffer = blobs.get(blob);
    if (!buffer) throw new ScannerOperationalError('Missing Git blob content.');
    const text = decodeText(buffer);
    const blobEntries = entriesByBlob.get(blob) ?? [];
    if (text === undefined) {
      for (const entry of blobEntries) {
        if (!isKnownBinaryPath(entry.path)) {
          findings.push(
            finding('content.unscannable-text', entry.scope, entry.path, 0, blob, blob),
          );
        }
      }
      continue;
    }
    findings.push(...scanText(text, blob, blobEntries));
  }

  const operational = findings.some((item) => item.scope === 'repository');
  return { findings, operational };
}

function main() {
  try {
    const result = scanRepository();
    const count = emitFindings(result.findings);
    process.exitCode = result.operational ? 2 : count > 0 ? 1 : 0;
  } catch (error) {
    if (!(error instanceof ScannerOperationalError)) {
      // Convert unexpected failures to the same redacted operational record.
    }
    emitFindings([operationalFinding('repository.scan-operational-error')]);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
