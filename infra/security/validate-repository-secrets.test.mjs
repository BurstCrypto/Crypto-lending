import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import {
  escapeOutputField,
  filterReviewedFalsePositiveFindings,
  loadReviewedFalsePositiveLedger,
  parseReviewedFalsePositiveLedger,
  sanitizeOutputPath,
} from './validate-repository-secrets.mjs';

const scannerPath = fileURLToPath(new URL('./validate-repository-secrets.mjs', import.meta.url));
const scannerTestPath = fileURLToPath(import.meta.url);
const falsePositiveLedgerPath = fileURLToPath(
  new URL('./repository-secret-false-positive-ledger.json', import.meta.url),
);
const oversizedTextBytes = 2_000_001;

function gitEnvironment() {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
  };
}

function runGit(repository, ...args) {
  const result = spawnSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    env: gitEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function write(repository, path, content) {
  const absolutePath = join(repository, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function createRepository() {
  const repository = mkdtempSync(join(tmpdir(), 'kan-243-secret-scan-'));
  runGit(repository, 'init', '--quiet', '--initial-branch=main');
  runGit(repository, 'config', 'user.email', 'kan-243@example.invalid');
  runGit(repository, 'config', 'user.name', 'KAN-243 Test');
  return repository;
}

function commitAll(repository, message) {
  runGit(repository, 'add', '--all');
  runGit(repository, 'commit', '--quiet', '--message', message);
}

function runScanner(repository) {
  return spawnSync(process.execPath, [scannerPath], {
    cwd: repository,
    encoding: 'utf8',
    env: gitEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

function assertRedacted(result, ...values) {
  for (const value of values) {
    assert.equal(result.stdout.includes(value), false, 'stdout exposed matched material');
    assert.equal(result.stderr.includes(value), false, 'stderr exposed matched material');
  }
  assert.equal(result.stderr, '');
}

function assertFinding(result, rule, scope) {
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stdout, new RegExp(`rule=${rule}\\tscope=${scope}\\t`, 'u'));
  for (const line of result.stdout.trim().split('\n')) {
    assert.match(
      line,
      /^rule=[^\t]+\tscope=[^\t]+\tpath=[^\t]+\tline=\d+\tblob=[^\t]+\tfingerprint=[0-9a-f]{16}$/u,
    );
  }
}

test('binds reviewed fixture exceptions to every exact redacted finding field', () => {
  const reviewed = loadReviewedFalsePositiveLedger();
  const exact = {
    blob: 'acaacb1dd3553d5a47128e530e4c53792e2eabac',
    fingerprint: '1ccde239b7031a46',
    line: 49,
    path: 'apps/api/src/blockchain-sync/application/balance-sync-consumer.cli-mode.spec.ts',
    rule: 'url.embedded-credentials',
    scope: 'index',
  };
  const nearMisses = [
    { ...exact, blob: `${exact.blob.slice(0, -1)}b` },
    { ...exact, fingerprint: `${exact.fingerprint.slice(0, -1)}7` },
    { ...exact, line: exact.line + 1 },
    { ...exact, path: exact.path.replace('.spec.ts', '.copy.spec.ts') },
    { ...exact, rule: 'assignment.high-entropy-secret' },
    { ...exact, scope: 'history', line: exact.line + 1 },
    { ...exact, scope: 'repository' },
  ];

  assert.equal(reviewed.size, 37);
  assert.deepEqual(
    filterReviewedFalsePositiveFindings([exact, ...nearMisses], reviewed),
    nearMisses,
  );
});

test('fails closed when the reviewed fixture ledger bytes drift', () => {
  const reviewedBytes = readFileSync(falsePositiveLedgerPath);

  assert.equal(parseReviewedFalsePositiveLedger(reviewedBytes).size, 37);
  assert.throws(
    () => parseReviewedFalsePositiveLedger(Buffer.concat([reviewedBytes, Buffer.from('\n')])),
    /Reviewed false-positive ledger is invalid/u,
  );
});

test('scans the staged index instead of an unstaged working-tree replacement', () => {
  const repository = createRepository();
  const sentinel = ['zQ7vN2', 'pL9xR4', 'mT8kW3', 'cF6sH1', 'yU5aD0'].join('');
  try {
    write(repository, 'config.env.example', `API_TOKEN=${sentinel}\n`);
    runGit(repository, 'add', 'config.env.example');
    write(repository, 'config.env.example', 'API_TOKEN=<set-at-runtime>\n');

    const result = runScanner(repository);

    assertFinding(result, 'assignment.high-entropy-secret', 'index');
    assertRedacted(result, sentinel);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('detects exact secret assignment names in quoted and unquoted forms', () => {
  const repository = createRepository();
  const fixtures = {
    accessKey: ['aB3dE5', 'fG7hJ9', 'kL2mN4', 'pQ6rS8', 'tU0vW1'].join(''),
    apiKey: ['bC4eF6', 'gH8jK1', 'mN3pQ5', 'rS7tU9', 'vW2xY0'].join(''),
    credential: ['cD5fG7', 'hJ9kL2', 'mN4pQ6', 'rS8tU1', 'vW3xY0'].join(''),
    password: ['dE6gH8', 'jK1mN3', 'pQ5rS7', 'tU9vW2', 'xY4zA0'].join(''),
    passwords: ['gH9kL2', 'mN4pQ6', 'rS8tU1', 'vW3xY5', 'zA7bC0'].join(''),
    secret: ['eF7hJ9', 'kL2mN4', 'pQ6rS8', 'tU1vW3', 'xY5zA0'].join(''),
    secretFileContents: ['hJ1mN3', 'pQ5rS7', 'tU9vW2', 'xY4zA6', 'bC8dE0'].join(''),
    secrets: ['jK2mN4', 'pQ6rS8', 'tU1vW3', 'xY5zA7', 'bC9dE0'].join(''),
    token: ['fG8jK1', 'mN3pQ5', 'rS7tU9', 'vW2xY4', 'zA6bC0'].join(''),
    tokenFileValue: ['kL3mN5', 'pQ7rS9', 'tU2vW4', 'xY6zA8', 'bC1dE0'].join(''),
    tokens: ['mN4pQ6', 'rS8tU1', 'vW3xY5', 'zA7bC9', 'dE2fG0'].join(''),
    apiKeys: ['nP5qR7', 'sT9uV2', 'wX4yZ6', 'aB8cD1', 'eF3gH0'].join(''),
    clientSecrets: ['pQ6rS8', 'tU1vW3', 'xY5zA7', 'bC9dE2', 'fG4hJ0'].join(''),
    credentialEndpointAuthToken: ['qR7sT9', 'uV2wX4', 'yZ6aB8', 'cD1eF3', 'gH5jK0'].join(''),
  };
  try {
    write(
      repository,
      'exact-assignments.txt',
      [
        `password="${fixtures.password}"`,
        `secret=${fixtures.secret}`,
        `"token": '${fixtures.token}'`,
        `api_key=${fixtures.apiKey}`,
        `access_key="${fixtures.accessKey}"`,
        `credential=${fixtures.credential}`,
        `SECRETS="${fixtures.secrets}"`,
        `TOKENS=${fixtures.tokens}`,
        `PASSWORDS="${fixtures.passwords}"`,
        `apiKeys=${fixtures.apiKeys}`,
        `clientSecrets="${fixtures.clientSecrets}"`,
        `secretFileContents=${fixtures.secretFileContents}`,
        `token_file_value="${fixtures.tokenFileValue}"`,
        `credential_endpoint_auth_token=${fixtures.credentialEndpointAuthToken}`,
        `apikey=${fixtures.apiKey}`,
        `APIKEY="${fixtures.apiKey}"`,
        `APIKey=${fixtures.apiKey}`,
        `accesskey="${fixtures.accessKey}"`,
        `privatekey=${fixtures.credential}`,
        `clientsecret="${fixtures.clientSecrets}"`,
        '',
      ].join('\n'),
    );
    runGit(repository, 'add', 'exact-assignments.txt');

    const result = runScanner(repository);

    assertFinding(result, 'assignment.high-entropy-secret', 'index');
    assert.equal(
      result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('rule=assignment.high-entropy-secret\t')).length,
      Object.keys(fixtures).length + 6,
    );
    assertRedacted(result, ...Object.values(fixtures));
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('ignores source-code references and symbolic ternary branches but detects literal secrets', () => {
  const repository = createRepository();
  const sentinel = ['zQ7vN2', 'pL9xR4', 'mT8kW3', 'cF6sH1', 'yU5aD0'].join('');
  const reviewedInstrumentationBinding = [
    '       - { Name: OTEL_TRACES_EXPORTER, ValueFrom: ',
    'prohibited',
    ' }',
  ].join('');
  const instrumentationBindingNearMiss = reviewedInstrumentationBinding.replace(
    'prohibited',
    ['production', 'secret', 'material'].join('-'),
  );
  try {
    write(
      repository,
      'authentication.ts',
      [
        "const outcome = response.status === 400 ? 'OIDC_TOKEN_EXCHANGE_REJECTED' : 'OIDC_TOKEN_SERVICE_UNAVAILABLE';",
        'const rotated = {',
        '  credentialId: input.successorCredentialId,',
        '  variableDebtToken: PUBLIC_DEBT_TOKEN_ADDRESS,',
        '};',
        'record_dispatch_token_sha256 = requested_dispatch_token_sha256',
        'api_token = requested_dispatch_token_sha256',
        'record_dispatch_token_sha256 = requested_dispatch_token_sha256_changed',
        'record_dispatch_token_sha256 = requested_dispatch_token_sha512',
        `record_dispatch_token_sha256 = '${sentinel}'`,
        `const secretBinding = '${reviewedInstrumentationBinding}';`,
        `const apiToken = '${reviewedInstrumentationBinding}';`,
        `const secretBinding = '${instrumentationBindingNearMiss}';`,
        `const token = '${sentinel}';`,
        '',
      ].join('\n'),
    );
    runGit(repository, 'add', 'authentication.ts');

    const result = runScanner(repository);

    assertFinding(result, 'assignment.high-entropy-secret', 'index');
    assert.equal(
      result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('rule=assignment.high-entropy-secret\t')).length,
      7,
    );
    assertRedacted(
      result,
      sentinel,
      reviewedInstrumentationBinding,
      instrumentationBindingNearMiss,
    );
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('allows only an exact reviewed public protocol identifier', () => {
  const repository = createRepository();
  const publicIdentifier = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  const publicProgramIdentifier = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const publicContractAddress = '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c';
  const publicDebtContractAddress = '0x72e95b8931767c79ba4eee721354d6e99a61d004';
  const nearbySecret = ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuE', 'a'].join('');
  try {
    write(
      repository,
      'protocol-identifiers.ts',
      [
        'const programs = {',
        `  TOKEN_2022: '${publicIdentifier}',`,
        `  API_TOKEN: '${publicIdentifier}',`,
        `  PUBLIC_TESTNET_TOKEN_PROGRAM: '${publicProgramIdentifier}',`,
        `  TOKEN_2022: '${publicProgramIdentifier}',`,
        `  TOKEN_PROGRAM: '${publicProgramIdentifier}',`,
        `  LEGACY_TOKEN_PROGRAM: '${publicProgramIdentifier}',`,
        `  TOKEN_2022_PROGRAM: '${publicIdentifier}',`,
        `  SESSION_TOKEN: '${publicProgramIdentifier}',`,
        `  aToken: '${publicContractAddress}',`,
        `  AAVE_V3_ETHEREUM_USDC_A_TOKEN: '${publicContractAddress}',`,
        `  API_TOKEN: '${publicContractAddress}',`,
        `  variableDebtToken: '${publicDebtContractAddress}',`,
        `  SESSION_TOKEN: '${publicDebtContractAddress}',`,
        `  TOKEN_2022_PROGRAM: '${nearbySecret}',`,
        '};',
        '',
      ].join('\n'),
    );
    runGit(repository, 'add', 'protocol-identifiers.ts');

    const result = runScanner(repository);

    assertFinding(result, 'assignment.high-entropy-secret', 'index');
    assert.equal(
      result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('rule=assignment.high-entropy-secret\t')).length,
      5,
    );
    assertRedacted(
      result,
      publicIdentifier,
      publicProgramIdentifier,
      publicContractAddress,
      publicDebtContractAddress,
      nearbySecret,
    );
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('binds production public identifiers to their exact reviewed assignment names', () => {
  const repository = createRepository();
  const solanaProgramIdentifier = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const solanaAccountIdentifier = 'BGocb4GEpbTFm8UFV2VsDSaBXHELPfAXrvd4vtt8QWrA';
  const reserveIdentifier = '94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu';
  const layoutIdentifier = 'SPL_TOKEN_0087CA54_ACCOUNT_PACK_165';
  const sparkReceiptIdentifier = '0x377c3bd93f2a2984e1e7be6a5c22c525ed4a4815';
  const sparkImplementationIdentifier = '0x6175ddec3b9b38c88157c10a01ed4a3fa8639cc6';
  const secretArnIdentifier =
    'arn:aws:secretsmanager:us-west-2:111122223333:secret:crypto-lending/test/auth-wallet-keys-AbCdEf';
  const redisSecretArnIdentifier =
    'arn:aws:secretsmanager:us-west-2:111122223333:secret:crypto-lending/test/redis-operator-AbCdEf';
  try {
    write(
      repository,
      'production-public-identifiers.ts',
      [
        'const identifiers = {',
        `  TOKEN_PROGRAM: '${solanaProgramIdentifier}',`,
        `  legacyTokenProgramAddress: '${solanaProgramIdentifier}',`,
        `  TOKEN_ACCOUNT: '${solanaAccountIdentifier}',`,
        `  usdcTokenReserveAddress: '${reserveIdentifier}',`,
        `  tokenAccountLayout: '${layoutIdentifier}',`,
        `  spToken: '${sparkReceiptIdentifier}',`,
        `  spTokenImplementation: '${sparkImplementationIdentifier}',`,
        `  AuthWalletKeysSecretArn: '${secretArnIdentifier}',`,
        `  redisOperatorSecretArn: '${redisSecretArnIdentifier}',`,
        `  API_TOKEN: '${solanaProgramIdentifier}',`,
        `  tokenAccountCopy: '${solanaAccountIdentifier}',`,
        `  reserveTokenAddress: '${reserveIdentifier}',`,
        `  tokenAccountLayoutCopy: '${layoutIdentifier}',`,
        `  spTokenCopy: '${sparkReceiptIdentifier}',`,
        `  spTokenImplementationCopy: '${sparkImplementationIdentifier}',`,
        `  OtherSecretArn: '${secretArnIdentifier}',`,
        `  OtherRedisSecretArn: '${redisSecretArnIdentifier}',`,
        '};',
        '',
      ].join('\n'),
    );
    runGit(repository, 'add', 'production-public-identifiers.ts');

    const result = runScanner(repository);

    assertFinding(result, 'assignment.high-entropy-secret', 'index');
    assert.equal(
      result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('rule=assignment.high-entropy-secret\t')).length,
      8,
    );
    assertRedacted(
      result,
      solanaProgramIdentifier,
      solanaAccountIdentifier,
      reserveIdentifier,
      layoutIdentifier,
      sparkReceiptIdentifier,
      sparkImplementationIdentifier,
      secretArnIdentifier,
      redisSecretArnIdentifier,
    );
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('redacts credential-bearing paths and safely encodes every control character', () => {
  const repository = createRepository();
  const sentinel = ['gh', 'p_', 'Path5Sentinel7Material9Value2Token4'].join('');
  const suspiciousPath = ['evidence/', sentinel, '.txt'].join('');
  const controlPath = ['evidence/', String.fromCharCode(0x1b), 'name.txt'].join('');
  try {
    assert.equal(sanitizeOutputPath('.env'), '.env');
    assert.match(sanitizeOutputPath(suspiciousPath), /^\[redacted-path:[0-9a-f]{16}\]$/u);
    assert.equal(sanitizeOutputPath(suspiciousPath).includes(sentinel), false);
    assert.match(sanitizeOutputPath(controlPath), /^\[redacted-path:[0-9a-f]{16}\]$/u);
    assert.equal(sanitizeOutputPath(controlPath).includes(String.fromCharCode(0x1b)), false);
    assert.equal(
      escapeOutputField(['safe', String.fromCharCode(0x1b), '\t', '\u202e'].join('')),
      'safe%1B%09%E2%80%AE',
    );

    write(repository, suspiciousPath, 'SAFE=true\n');
    runGit(repository, 'add', '--force', suspiciousPath);

    const result = runScanner(repository);

    assertFinding(result, 'provider.github-token', 'index');
    assert.match(result.stdout, /\tpath=\[redacted-path:[0-9a-f]{16}\]\t/u);
    assertRedacted(result, sentinel);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('does not let a path placeholder exempt literal URL credentials', () => {
  const repository = createRepository();
  const sentinel = ['qN7!', 'vB2@', 'mK9#', 'xD4$', 'sT8%', 'cR3^', 'pL6&'].join('');
  const routePlaceholder = ['$', '{ROUTE}'].join('');
  const credentialUrl = [
    'https://service:',
    encodeURIComponent(sentinel),
    '@localhost/',
    routePlaceholder,
  ].join('');
  try {
    write(repository, 'mixed-placeholder-url.txt', `${credentialUrl}\n`);
    runGit(repository, 'add', 'mixed-placeholder-url.txt');

    const result = runScanner(repository);

    assertFinding(result, 'url.embedded-credentials', 'index');
    assertRedacted(result, sentinel, credentialUrl);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('finds a secret in deleted reachable history', () => {
  const repository = createRepository();
  const sentinel = ['gh', 'p_', 'Ab3Def5Gh7Jk9Lm2Np4Qr6St8Uv0Wx1Yz3'].join('');
  try {
    write(repository, 'historical.txt', `token=${sentinel}\n`);
    commitAll(repository, 'add historical fixture');
    runGit(repository, 'rm', '--quiet', 'historical.txt');
    runGit(repository, 'commit', '--quiet', '--message', 'delete historical fixture');

    const result = runScanner(repository);

    assertFinding(result, 'provider.github-token', 'history');
    assertRedacted(result, sentinel);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('finds a secret reachable only through a merged second-parent history', () => {
  const repository = createRepository();
  const sentinel = ['pypi', '-', 'Ab3Def5Gh7Jk9Lm2Np4Qr6St8Uv0Wx1Yz3'].join('');
  try {
    write(repository, 'base.txt', 'safe\n');
    commitAll(repository, 'base');
    runGit(repository, 'checkout', '--quiet', '-b', 'side-history');
    write(repository, 'side-secret.txt', `${sentinel}\n`);
    commitAll(repository, 'add side-parent fixture');
    runGit(repository, 'rm', '--quiet', 'side-secret.txt');
    runGit(repository, 'commit', '--quiet', '--message', 'delete side-parent fixture');
    runGit(repository, 'checkout', '--quiet', 'main');
    write(repository, 'main.txt', 'mainline\n');
    commitAll(repository, 'advance main');
    runGit(
      repository,
      'merge',
      '--quiet',
      '--no-ff',
      'side-history',
      '--message',
      'merge side history',
    );

    const result = runScanner(repository);

    assertFinding(result, 'provider.pypi-token', 'history');
    assertRedacted(result, sentinel);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('rejects a force-added dotenv file while allowing the exact example name', () => {
  const repository = createRepository();
  try {
    write(repository, '.gitignore', '.env\n.env.*\n!.env.example\n');
    write(repository, '.env.example', 'API_TOKEN=<set-at-runtime>\n');
    commitAll(repository, 'add safe environment example');
    write(repository, '.env', 'LOCAL_ONLY=true\n');
    runGit(repository, 'add', '--force', '.env');

    const result = runScanner(repository);

    assertFinding(result, 'filename.dotenv', 'index');
    assert.match(result.stdout, /path=\.env\t/u);
    assert.doesNotMatch(result.stdout, /path=\.env\.example\t/u);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('fails closed on a staged text blob larger than two megabytes', () => {
  const repository = createRepository();
  try {
    write(repository, 'oversized.txt', 'A'.repeat(oversizedTextBytes));
    runGit(repository, 'add', 'oversized.txt');

    const result = runScanner(repository);

    assertFinding(result, 'content.oversized-text', 'index');
    assert.match(result.stdout, /line=0/u);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('fails closed on mixed-NUL content in the index and deleted history', () => {
  const repository = createRepository();
  const sentinel = ['gh', 'p_', 'Nul5Bypass7Sentinel9Material2Value4'].join('');
  try {
    write(repository, 'mixed-content.dat', Buffer.from(`prefix\0${sentinel}\n`, 'utf8'));
    runGit(repository, 'add', 'mixed-content.dat');

    const indexResult = runScanner(repository);
    assertFinding(indexResult, 'content.unscannable-text', 'index');
    assertRedacted(indexResult, sentinel);

    commitAll(repository, 'add mixed-NUL fixture');
    runGit(repository, 'rm', '--quiet', 'mixed-content.dat');
    runGit(repository, 'commit', '--quiet', '--message', 'delete mixed-NUL fixture');

    const historyResult = runScanner(repository);
    assertFinding(historyResult, 'content.unscannable-text', 'history');
    assertRedacted(historyResult, sentinel);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('fails closed with the operational exit code in a shallow clone', () => {
  const source = createRepository();
  const cloneParent = mkdtempSync(join(tmpdir(), 'kan-243-shallow-parent-'));
  const shallow = join(cloneParent, 'shallow');
  try {
    write(source, 'first.txt', 'first\n');
    commitAll(source, 'first');
    write(source, 'second.txt', 'second\n');
    commitAll(source, 'second');
    runGit(cloneParent, 'clone', '--quiet', '--depth=1', pathToFileURL(source).href, shallow);

    const result = runScanner(shallow);

    assert.equal(result.status, 2, result.stdout || result.stderr);
    assert.match(
      result.stdout,
      /^rule=repository\.shallow-history\tscope=repository\tpath=\.git\/shallow\tline=0\tblob=-\tfingerprint=[0-9a-f]{16}\r?\n$/u,
    );
    assert.equal(result.stderr, '');
  } finally {
    rmSync(source, { force: true, recursive: true });
    rmSync(cloneParent, { force: true, recursive: true });
  }
});

test('accepts exact reviewed dummy fixtures, dotenv examples, and digest contexts', () => {
  const repository = createRepository();
  const reviewedAwsExample = ['AK', 'IA', 'IOSFODNN7EXAMPLE'].join('');
  try {
    write(
      repository,
      '.env.example',
      [
        'DATABASE_URL=postgresql://crypto_lending:local_only_password@localhost:5432/crypto_lending',
        'DATABASE_RUNTIME_URL=postgresql://crypto_api_login_a:local_api_database_a@127.0.0.1:5432/crypto_lending',
        'MIGRATION_DATABASE_URL=postgresql://crypto_migration:local_migration_only@127.0.0.1:5432/crypto_lending',
        'TEST_DATABASE_URL=postgresql://crypto_admin:local_admin_only@127.0.0.1:5432/crypto_lending',
        'JIRA_API_TOKEN=replace-with-an-atlassian-api-token',
        `AWS_ACCESS_KEY_ID=${reviewedAwsExample}`,
        '',
      ].join('\n'),
    );
    write(
      repository,
      'fixtures.ts',
      [
        "const PASSWORD = 'correct-horse-battery-staple-lab';",
        "const credentialRelativeUri = '/v2/credentials/task-role';",
        "const credentialsFilePath = '/run/credentials/task-role';",
        "const reviewed = 'https://user:token@team.atlassian.net';",
        "const reviewedQuickNodeNegativeFixture = 'https://user@www.quicknode.com/docs';",
        "const SECRET_CANARY = 'private-key-signature-challenge-canary';",
        "const localDemoRemoteNegativeFixture = 'postgresql://demo:demo@database.example/crypto_lending';",
        "const workerLocal = 'postgresql://crypto_worker_login_a:local@127.0.0.1:5432/crypto_lending';",
        "const workerProduction = 'postgresql://crypto_worker_login_a:secret@db.internal.example:5432/crypto_lending';",
        "const missingApiCredentialUrl = 'postgresql://crypto_api_login_a:@db.internal.example:5432/crypto_lending';",
        "const invalidApiSlot = 'postgresql://crypto_api_login_blue:secret@db.internal.example:5432/crypto_lending';",
        "const apiRedis = 'rediss://crypto_api_test_a:not-exported@cache.internal.example:6379';",
        "const moduleRedis = 'rediss://crypto_api_a:not-exported@cache.internal.example:6379';",
        "const encodedRedis = 'rediss://local_api:token%20with%3A%2Freserved%40characters@cache.internal.example:6379';",
        "const redactionSentinel = 'rediss://user:do-not-log@cache';",
        "const username = 'crypto_api_test_a';",
        'const parameterizedRedis = `rediss://${username}:not-exported@cache.internal.example:6379`;',
        "const scripts = { 'security:test:secrets': 'node --test infra/security/example.test.mjs' };",
        `const SECRET_FINGERPRINT_SHA256 = '${'a1'.repeat(32)}';`,
        '',
      ].join('\n'),
    );
    commitAll(repository, 'add reviewed dummy fixtures');

    const result = runScanner(repository);

    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('keeps reviewed dummy URL credentials exact to protocol, user, password, and host', () => {
  const repository = createRepository();
  const wrongUser = ['https://', 'operator', '@www.quicknode.com/docs'].join('');
  const wrongHost = ['https://user@', 'api.quicknode.com/docs'].join('');
  const wrongDemoPassword = ['postgresql://demo:', 'different', '@database.example/db'].join('');
  const wrongDemoHost = ['postgresql', '://demo:demo@', 'database.example.test', '/db'].join('');
  const wrongCanary = ['private-key-signature-challenge-canary', '-different'].join('');
  try {
    write(
      repository,
      'near-miss-url-fixtures.txt',
      `${wrongUser}\n${wrongHost}\n${wrongDemoPassword}\n${wrongDemoHost}\nSECRET_CANARY=${wrongCanary}\n`,
    );
    runGit(repository, 'add', 'near-miss-url-fixtures.txt');

    const result = runScanner(repository);

    assertFinding(result, 'url.embedded-credentials', 'index');
    assert.equal(
      result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('rule=url.embedded-credentials\t')).length,
      4,
    );
    assertFinding(result, 'assignment.high-entropy-secret', 'index');
    assertRedacted(result, wrongUser, wrongHost, wrongDemoPassword, wrongDemoHost, wrongCanary);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('allows only the exact reviewed production-test URL and secret canaries', () => {
  const repository = createRepository();
  const reviewedUrls = [
    'postgres://worker:secret@example.invalid/key',
    'postgres://api:secret@example.invalid/key',
    'postgresql://user:secret@internal/outbox',
    'https://credential@secret-provider.example/rpc',
    'postgres://secret@example/key',
    'postgres://secret:credential@host/key',
    'postgresql://crypto_balance_consumer_login_test:test-placeholder@localhost:5432/crypto_lending',
    'postgresql://crypto_balance_consumer_login_a:local@127.0.0.1:5432/crypto_lending',
    'postgresql://crypto_balance_consumer_login_blue:local@127.0.0.1:5432/crypto_lending',
    'postgresql://credential@private-host/redaction',
    'postgresql://crypto_api_login_a:test@localhost:5432/crypto_lending',
    'postgresql://wrong_identity:test@localhost:5432/crypto_lending',
    'postgresql://crypto_api_login_a@localhost:5432/crypto_lending',
    'postgresql://crypto_api_login_a:test@database.example:5432/crypto_lending',
    'postgresql://user:sensitive@database.invalid:5432/db',
  ];
  const changedUrls = reviewedUrls.map((value) => {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = `${decodeURIComponent(parsed.password)}-changed`;
    else parsed.username = `${decodeURIComponent(parsed.username)}-changed`;
    return parsed.href;
  });
  const reviewedCanaries = [
    'private-key-stateful-proxy-canary',
    'wallet=0xdeadbeef provider-token=private',
  ];
  const changedCanaries = reviewedCanaries.map((value) => `${value}-${['near', 'miss'].join('-')}`);
  try {
    write(
      repository,
      'reviewed-production-test-fixtures.ts',
      [
        ...reviewedUrls.map((value) => `void '${value}';`),
        ...changedUrls.map((value) => `void '${value}';`),
        ...reviewedCanaries.map((value, index) => `const secret${index} = '${value}';`),
        ...changedCanaries.map((value, index) => `const secretChanged${index} = '${value}';`),
        '',
      ].join('\n'),
    );
    runGit(repository, 'add', 'reviewed-production-test-fixtures.ts');

    const result = runScanner(repository);

    assert.equal(
      result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('rule=url.embedded-credentials\t')).length,
      changedUrls.length,
    );
    assert.equal(
      result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('rule=assignment.high-entropy-secret\t')).length,
      changedCanaries.length,
    );
    assertRedacted(
      result,
      ...reviewedUrls,
      ...changedUrls,
      ...reviewedCanaries,
      ...changedCanaries,
    );
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('detects every promised content rule without echoing matched values', () => {
  const repository = createRepository();
  const fixtures = {
    aws: ['AK', 'IA', '1A2B3C4D5E6F7G8H'].join(''),
    assignment: ['qN7!', 'vB2@', 'mK9#', 'xD4$', 'sT8%', 'cR3^', 'pL6&'].join(''),
    google: ['AI', 'za', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'].join(''),
    github: ['github', '_pat_', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv'].join(''),
    npm: ['npm', '_', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv'].join(''),
    privateKeyHeader: ['-----BEGIN ', 'ENCRYPTED PRIVATE KEY-----'].join(''),
    pypi: ['pypi', '-', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv'].join(''),
    sendgrid: ['SG', '.', 'Ab1Cd2Ef3Gh4Ij5K', '.', 'Lm6No7Pq8Rs9Tu0Vw1Xy2Za3'].join(''),
    slack: ['xox', 'b-', '1234567890AbCdEfGhIjKlMn'].join(''),
    stripe: ['sk', '_live_', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn'].join(''),
  };
  const jwt = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'kan-243-fixture' })).toString('base64url'),
    'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8',
  ].join('.');
  const credentialUrl = ['https://service:', fixtures.assignment, '@localhost/private'].join('');
  const encodedCredentialUrl = [
    'https://service:',
    encodeURIComponent(fixtures.assignment),
    '@localhost/encoded',
  ].join('');
  try {
    write(
      repository,
      'fixtures.txt',
      [
        fixtures.aws,
        fixtures.github,
        fixtures.google,
        fixtures.npm,
        fixtures.pypi,
        fixtures.privateKeyHeader,
        fixtures.sendgrid,
        fixtures.slack,
        fixtures.stripe,
        jwt,
        credentialUrl,
        encodedCredentialUrl,
        `CLIENT_SECRET='${fixtures.assignment}'`,
        '',
      ].join('\n'),
    );
    runGit(repository, 'add', 'fixtures.txt');

    const result = runScanner(repository);

    assert.equal(result.status, 1, result.stdout || result.stderr);
    for (const rule of [
      'provider.aws-access-key-id',
      'provider.github-token',
      'provider.google-api-key',
      'provider.npm-token',
      'provider.pypi-token',
      'key.private-key-header',
      'provider.sendgrid-key',
      'provider.slack-token',
      'provider.stripe-live-key',
      'token.jwt',
      'url.embedded-credentials',
      'assignment.high-entropy-secret',
    ]) {
      assert.match(result.stdout, new RegExp(`rule=${rule}\\t`, 'u'));
    }
    assertRedacted(result, ...Object.values(fixtures), jwt, credentialUrl, encodedCredentialUrl);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test('the scanner and mutation test sources scan themselves without exclusions', () => {
  const repository = createRepository();
  try {
    write(repository, 'infra/security/validate-repository-secrets.mjs', readFileSync(scannerPath));
    write(
      repository,
      'infra/security/repository-secret-false-positive-ledger.json',
      readFileSync(falsePositiveLedgerPath),
    );
    write(
      repository,
      'infra/security/validate-repository-secrets.test.mjs',
      readFileSync(scannerTestPath),
    );
    commitAll(repository, 'add scanner sources');

    const result = runScanner(repository);

    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});
