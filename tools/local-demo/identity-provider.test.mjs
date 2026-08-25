import { createHash, createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPinnedLocalDemoIdentityBinding,
  createLocalDemoIdentityProvider,
  LOCAL_DEMO_CLIENT_ID,
  LOCAL_DEMO_IDENTITY_HOST,
  LOCAL_DEMO_IDENTITY_PORT,
  LOCAL_DEMO_ISSUER,
  LOCAL_DEMO_REDIRECT_URI,
} from './identity-provider.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function fixtureServer(options = {}) {
  let origin = '';
  let provider;
  const server = createServer((request, response) => provider.handler(request, response));
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  origin = `http://127.0.0.1:${address.port}`;
  provider = createLocalDemoIdentityProvider({ ...options, origin });
  return origin;
}

function authorizationUrl(origin, challenge, fixture) {
  const url = new URL('/authorize', origin);
  const entries = {
    response_type: 'code',
    client_id: LOCAL_DEMO_CLIENT_ID,
    redirect_uri: LOCAL_DEMO_REDIRECT_URI,
    scope: 'openid',
    state: 's'.repeat(43),
    nonce: 'n'.repeat(43),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(fixture ? { fixture } : {}),
  };
  for (const [name, value] of Object.entries(entries)) url.searchParams.set(name, value);
  return url;
}

describe('local demo identity provider', () => {
  it('serves a no-store selector and exchanges one PKCE-bound code for a valid ES256 token', async () => {
    const origin = await fixtureServer();
    const verifier = 'v'.repeat(43);
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');

    const selector = await fetch(authorizationUrl(origin, challenge), { redirect: 'manual' });
    assert.equal(selector.status, 200);
    assert.equal(selector.headers.get('cache-control'), 'no-store');
    assert.match(
      selector.headers.get('content-security-policy'),
      /form-action 'self' http:\/\/127\.0\.0\.1:3000/u,
    );
    assert.match(await selector.text(), /Synthetic loopback-only identity/u);

    const authorization = await fetch(authorizationUrl(origin, challenge, 'primary'), {
      redirect: 'manual',
    });
    assert.equal(authorization.status, 302);
    const callback = new URL(authorization.headers.get('location'));
    assert.equal(callback.origin + callback.pathname, LOCAL_DEMO_REDIRECT_URI);
    assert.equal(callback.searchParams.get('state'), 's'.repeat(43));
    assert.equal(callback.searchParams.get('iss'), LOCAL_DEMO_ISSUER);
    const code = callback.searchParams.get('code');
    assert.match(code, /^[A-Za-z0-9_-]{43}$/u);

    const tokenResponse = await fetch(`${origin}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LOCAL_DEMO_REDIRECT_URI,
        code_verifier: verifier,
        client_id: LOCAL_DEMO_CLIENT_ID,
      }),
    });
    assert.equal(tokenResponse.status, 200);
    const { id_token: idToken } = await tokenResponse.json();
    const [encodedHeader, encodedPayload, encodedSignature] = idToken.split('.');
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    assert.deepEqual({ alg: header.alg, typ: header.typ }, { alg: 'ES256', typ: 'JWT' });
    assert.equal(payload.iss, LOCAL_DEMO_ISSUER);
    assert.equal(payload.sub, 'local-demo-primary-v1');
    assert.equal(payload.aud, LOCAL_DEMO_CLIENT_ID);
    assert.equal(payload.nonce, 'n'.repeat(43));

    const jwks = await (await fetch(`${origin}/jwks.json`)).json();
    const publicKey = createPublicKey({ key: jwks.keys[0], format: 'jwk' });
    assert.equal(
      verify(
        'sha256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(encodedSignature, 'base64url'),
      ),
      true,
    );

    const replay = await fetch(`${origin}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LOCAL_DEMO_REDIRECT_URI,
        code_verifier: verifier,
        client_id: LOCAL_DEMO_CLIENT_ID,
      }),
    });
    assert.equal(replay.status, 400);
  });

  it('rejects unknown fixtures, duplicate parameters, bad PKCE, and ambient authorization', async () => {
    const origin = await fixtureServer();
    const verifier = 'v'.repeat(43);
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    assert.equal((await fetch(authorizationUrl(origin, challenge, 'unknown'))).status, 400);

    const duplicate = authorizationUrl(origin, challenge);
    duplicate.searchParams.append('state', 'x'.repeat(43));
    assert.equal((await fetch(duplicate)).status, 400);

    assert.equal(
      (
        await fetch(`${origin}/health`, {
          headers: { Authorization: 'Bearer forbidden' },
        })
      ).status,
      400,
    );
  });

  it('pins the executable listener to one loopback host and port', () => {
    assert.equal(LOCAL_DEMO_ISSUER, 'https://127.0.0.1:3400/local-demo');
    assert.doesNotThrow(() =>
      assertPinnedLocalDemoIdentityBinding(LOCAL_DEMO_IDENTITY_HOST, LOCAL_DEMO_IDENTITY_PORT),
    );
    assert.throws(() => assertPinnedLocalDemoIdentityBinding('0.0.0.0', 3400));
    assert.throws(() => assertPinnedLocalDemoIdentityBinding('127.0.0.1', 8080));
  });
});
