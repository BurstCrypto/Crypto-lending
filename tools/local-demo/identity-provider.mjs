import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

export const LOCAL_DEMO_IDENTITY_HOST = '127.0.0.1';
export const LOCAL_DEMO_IDENTITY_PORT = 3400;
export const LOCAL_DEMO_IDENTITY_ORIGIN = `http://${LOCAL_DEMO_IDENTITY_HOST}:${LOCAL_DEMO_IDENTITY_PORT}`;
export const LOCAL_DEMO_ISSUER = `${LOCAL_DEMO_IDENTITY_ORIGIN}/local-demo`;
export const LOCAL_DEMO_CLIENT_ID = 'crypto-lending-local-demo';
export const LOCAL_DEMO_REDIRECT_URI = 'http://127.0.0.1:3000/api/v1/auth/callback';

const AUTHORIZATION_KEYS = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
  'fixture',
]);
const TOKEN_KEYS = new Set(['grant_type', 'code', 'redirect_uri', 'code_verifier', 'client_id']);
const OPAQUE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const FIXTURES = Object.freeze([
  Object.freeze({ id: 'primary', label: 'Primary demo account', subject: 'local-demo-primary-v1' }),
  Object.freeze({
    id: 'secondary',
    label: 'Secondary demo account',
    subject: 'local-demo-secondary-v1',
  }),
]);
const FIXTURE_BY_ID = new Map(FIXTURES.map((fixture) => [fixture.id, fixture]));
const MAX_BODY_BYTES = 8_192;
const AUTHORIZATION_CODE_TTL_MS = 120_000;
const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
});

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function htmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hasExactParameters(parameters, allowed) {
  const keys = [...parameters.keys()];
  return keys.every((key) => allowed.has(key)) && new Set(keys).size === keys.length;
}

function isExactHost(request, origin) {
  const expected = new URL(origin).host;
  const hosts = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'host') {
      hosts.push(request.rawHeaders[index + 1]);
    }
  }
  return hosts.length === 1 && hosts[0] === expected;
}

function send(response, status, headers, body = '') {
  response.writeHead(status, { ...RESPONSE_HEADERS, ...headers });
  response.end(body);
}

function reject(response, status = 400) {
  send(response, status, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Request rejected');
}

async function readFormBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body-too-large');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function authorizationInput(url) {
  const parameters = url.searchParams;
  if (
    !hasExactParameters(parameters, AUTHORIZATION_KEYS) ||
    parameters.get('response_type') !== 'code' ||
    parameters.get('client_id') !== LOCAL_DEMO_CLIENT_ID ||
    parameters.get('redirect_uri') !== LOCAL_DEMO_REDIRECT_URI ||
    parameters.get('scope') !== 'openid' ||
    parameters.get('code_challenge_method') !== 'S256' ||
    !OPAQUE_VALUE_PATTERN.test(parameters.get('state') ?? '') ||
    !OPAQUE_VALUE_PATTERN.test(parameters.get('nonce') ?? '') ||
    !OPAQUE_VALUE_PATTERN.test(parameters.get('code_challenge') ?? '')
  ) {
    return null;
  }
  return Object.freeze({
    state: parameters.get('state'),
    nonce: parameters.get('nonce'),
    codeChallenge: parameters.get('code_challenge'),
    fixture: parameters.get('fixture'),
  });
}

function identitySelectionHtml(input) {
  const hidden = [
    ['response_type', 'code'],
    ['client_id', LOCAL_DEMO_CLIENT_ID],
    ['redirect_uri', LOCAL_DEMO_REDIRECT_URI],
    ['scope', 'openid'],
    ['state', input.state],
    ['nonce', input.nonce],
    ['code_challenge', input.codeChallenge],
    ['code_challenge_method', 'S256'],
  ]
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${htmlEscape(value)}">`)
    .join('');
  const choices = FIXTURES.map(
    (fixture) =>
      `<button type="submit" name="fixture" value="${fixture.id}">${fixture.label}</button>`,
  ).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Crypto Lending local demo identity</title><style>body{font:16px system-ui;max-width:42rem;margin:5rem auto;padding:0 1rem;background:#08110f;color:#f4f8f6}main{padding:2rem;border:1px solid #385047;border-radius:1rem}p{line-height:1.6;color:#b8c8c1}form{display:grid;gap:.8rem}button{padding:1rem;border:0;border-radius:.6rem;background:#70e1b3;color:#06100c;font-weight:750;cursor:pointer}</style></head><body><main><h1>Local demo identity</h1><p>Synthetic loopback-only identity. No external identity provider or customer account is involved.</p><form method="get" action="/authorize">${hidden}${choices}</form></main></body></html>`;
}

function compactJwt(privateKey, kid, payload) {
  const header = base64UrlJson({ alg: 'ES256', kid, typ: 'JWT' });
  const claims = base64UrlJson(payload);
  const signingInput = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(signingInput, 'ascii'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${signingInput}.${signature}`;
}

export function createLocalDemoIdentityProvider(options = {}) {
  const origin = options.origin ?? LOCAL_DEMO_IDENTITY_ORIGIN;
  const now = options.now ?? (() => Date.now());
  const random = options.randomBytes ?? randomBytes;
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = 'local_demo_ephemeral';
  const publicJwk = publicKey.export({ format: 'jwk' });
  const codes = new Map();

  const handler = async (request, response) => {
    try {
      if (!isExactHost(request, origin) || request.headers.authorization !== undefined) {
        return reject(response);
      }
      const url = new URL(request.url ?? '/', origin);

      if (request.method === 'GET' && url.pathname === '/health' && url.search === '') {
        return send(
          response,
          200,
          { 'Content-Type': 'application/json; charset=utf-8' },
          JSON.stringify({ status: 'ok', mode: 'synthetic-local' }),
        );
      }

      if (request.method === 'GET' && url.pathname === '/jwks.json' && url.search === '') {
        return send(
          response,
          200,
          { 'Content-Type': 'application/json; charset=utf-8' },
          JSON.stringify({
            keys: [{ ...publicJwk, alg: 'ES256', kid, key_ops: ['verify'], use: 'sig' }],
          }),
        );
      }

      if (request.method === 'GET' && url.pathname === '/authorize') {
        const input = authorizationInput(url);
        if (!input) return reject(response);
        if (input.fixture === null) {
          return send(
            response,
            200,
            {
              'Content-Security-Policy':
                "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
              'Content-Type': 'text/html; charset=utf-8',
            },
            identitySelectionHtml(input),
          );
        }
        const fixture = FIXTURE_BY_ID.get(input.fixture);
        if (!fixture) return reject(response);
        const code = random(32).toString('base64url');
        codes.set(createHash('sha256').update(code, 'ascii').digest('hex'), {
          codeChallenge: input.codeChallenge,
          expiresAt: now() + AUTHORIZATION_CODE_TTL_MS,
          nonce: input.nonce,
          subject: fixture.subject,
        });
        const redirect = new URL(LOCAL_DEMO_REDIRECT_URI);
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', input.state);
        redirect.searchParams.set('iss', LOCAL_DEMO_ISSUER);
        return send(response, 302, { Location: redirect.href });
      }

      if (request.method === 'POST' && url.pathname === '/token' && url.search === '') {
        if (request.headers['content-type'] !== 'application/x-www-form-urlencoded') {
          return reject(response);
        }
        const form = await readFormBody(request);
        if (
          !hasExactParameters(form, TOKEN_KEYS) ||
          form.get('grant_type') !== 'authorization_code' ||
          form.get('client_id') !== LOCAL_DEMO_CLIENT_ID ||
          form.get('redirect_uri') !== LOCAL_DEMO_REDIRECT_URI ||
          !OPAQUE_VALUE_PATTERN.test(form.get('code') ?? '') ||
          !CODE_VERIFIER_PATTERN.test(form.get('code_verifier') ?? '')
        ) {
          return reject(response);
        }
        const code = form.get('code');
        const codeDigest = createHash('sha256').update(code, 'ascii').digest('hex');
        const authorization = codes.get(codeDigest);
        codes.delete(codeDigest);
        const verifierChallenge = createHash('sha256')
          .update(form.get('code_verifier'), 'ascii')
          .digest('base64url');
        if (
          !authorization ||
          authorization.expiresAt < now() ||
          authorization.codeChallenge !== verifierChallenge
        ) {
          return reject(response);
        }
        const issuedAt = Math.floor(now() / 1_000);
        const idToken = compactJwt(privateKey, kid, {
          iss: LOCAL_DEMO_ISSUER,
          sub: authorization.subject,
          aud: LOCAL_DEMO_CLIENT_ID,
          azp: LOCAL_DEMO_CLIENT_ID,
          exp: issuedAt + 120,
          iat: issuedAt,
          nonce: authorization.nonce,
        });
        return send(
          response,
          200,
          { 'Content-Type': 'application/json; charset=utf-8' },
          JSON.stringify({ id_token: idToken }),
        );
      }

      return reject(response, 404);
    } catch {
      return reject(response);
    }
  };

  return Object.freeze({ handler });
}

export function assertPinnedLocalDemoIdentityBinding(host, port) {
  if (host !== LOCAL_DEMO_IDENTITY_HOST) throw new Error('Local demo identity host is not pinned');
  if (port !== LOCAL_DEMO_IDENTITY_PORT) throw new Error('Local demo identity port is not pinned');
}

export async function startLocalDemoIdentityProvider() {
  assertPinnedLocalDemoIdentityBinding(LOCAL_DEMO_IDENTITY_HOST, LOCAL_DEMO_IDENTITY_PORT);
  const { handler } = createLocalDemoIdentityProvider();
  const server = createServer(handler);
  await new Promise((resolve, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(
      { host: LOCAL_DEMO_IDENTITY_HOST, port: LOCAL_DEMO_IDENTITY_PORT, exclusive: true },
      () => {
        server.off('error', rejectStart);
        resolve();
      },
    );
  });
  return server;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) {
  const server = await startLocalDemoIdentityProvider();
  process.stdout.write(
    `Synthetic local identity is listening on ${LOCAL_DEMO_IDENTITY_ORIGIN}; no external calls are enabled.\n`,
  );
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
