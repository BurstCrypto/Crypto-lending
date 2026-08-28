import assert from 'node:assert/strict';
import test from 'node:test';

import { assertLocalPublicTestnetOperatorBoundary } from './boundary';
import {
  PUBLIC_TESTNET_PROFILES,
  validatePublicTestnetProfiles,
  type PublicTestnetProfile,
} from './profiles';
import { runPublicTestnetSmoke } from './smoke';

const EVM_BLOCK = Object.freeze({
  number: '0x123',
  hash: `0x${'1'.repeat(64)}`,
  parentHash: `0x${'2'.repeat(64)}`,
});

function rpcResponse(id: number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function successFetch(calls: { url: string; method: string }[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: readonly unknown[];
    };
    calls.push({ url: String(input), method: body.method });
    const profile = PUBLIC_TESTNET_PROFILES.find(({ endpoint }) => endpoint === String(input));
    assert.ok(profile);

    if (body.method === profile.identityProbe.method) {
      return rpcResponse(body.id, profile.identityProbe.expectedResult);
    }
    if (body.method === 'eth_getBlockByNumber') return rpcResponse(body.id, EVM_BLOCK);
    if (body.method === 'getSlot') return rpcResponse(body.id, 456_789);
    throw new Error('unexpected test method');
  }) as typeof fetch;
}

test('the fixed setup contains every supported EVM and SVM testnet with no credential-bearing URL', () => {
  validatePublicTestnetProfiles(PUBLIC_TESTNET_PROFILES);
  assert.equal(PUBLIC_TESTNET_PROFILES.length, 4);
  assert.deepEqual(
    PUBLIC_TESTNET_PROFILES.map(({ networkId }) => networkId),
    ['eip155:11155111', 'eip155:84532', 'eip155:421614', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
  );
  for (const profile of PUBLIC_TESTNET_PROFILES) {
    const url = new URL(profile.endpoint);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.doesNotMatch(
      `${profile.identityProbe.method} ${profile.finalizedProbe.method}`,
      /airdrop|send|sign|transaction/iu,
    );
  }
});

test('configuration drift to an arbitrary endpoint fails closed', () => {
  const profiles = structuredClone(PUBLIC_TESTNET_PROFILES) as PublicTestnetProfile[];
  profiles[0] = { ...profiles[0], endpoint: 'https://attacker.example/rpc' };
  assert.throws(() => validatePublicTestnetProfiles(profiles), /PUBLIC_TESTNET_ENDPOINT_INVALID/u);
});

test('live smoke sends only identity and finalized-head reads and returns sanitized positions', async () => {
  const calls: { url: string; method: string }[] = [];
  const results = await runPublicTestnetSmoke(PUBLIC_TESTNET_PROFILES, {
    fetch: successFetch(calls),
    timeoutMs: 100,
  });

  assert.equal(calls.length, 8);
  assert.deepEqual(
    calls.map(({ method }) => method),
    [
      'eth_chainId',
      'eth_getBlockByNumber',
      'eth_chainId',
      'eth_getBlockByNumber',
      'eth_chainId',
      'eth_getBlockByNumber',
      'getGenesisHash',
      'getSlot',
    ],
  );
  assert.deepEqual(
    results.map(({ finalizedPosition }) => finalizedPosition),
    ['291', '291', '291', '456789'],
  );
});

test('an identity mismatch stops before accepting a head from the wrong chain', async () => {
  let calls = 0;
  const fetchMock = (async () => {
    calls += 1;
    return rpcResponse(1, '0x1');
  }) as typeof fetch;

  await assert.rejects(
    runPublicTestnetSmoke(PUBLIC_TESTNET_PROFILES, { fetch: fetchMock, timeoutMs: 100 }),
    /PUBLIC_TESTNET_IDENTITY_MISMATCH:eip155:11155111/u,
  );
  assert.equal(calls, 1);
});

test('RPC errors are sanitized and are never retried', async () => {
  let calls = 0;
  const fetchMock = (async () => {
    calls += 1;
    throw new Error('credential-bearing upstream detail');
  }) as typeof fetch;

  await assert.rejects(
    runPublicTestnetSmoke(PUBLIC_TESTNET_PROFILES, { fetch: fetchMock, timeoutMs: 100 }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'PUBLIC_TESTNET_REQUEST_FAILED:eip155:11155111');
      assert.doesNotMatch(error.message, /credential|upstream/iu);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('redirected and oversized RPC responses fail closed', async () => {
  const redirectedFetch = (async () => {
    const response = rpcResponse(1, '0xaa36a7');
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  }) as typeof fetch;
  await assert.rejects(
    runPublicTestnetSmoke(PUBLIC_TESTNET_PROFILES, {
      fetch: redirectedFetch,
      timeoutMs: 100,
    }),
    /PUBLIC_TESTNET_HTTP_FAILED:eip155:11155111/u,
  );

  const oversizedFetch = (async () =>
    new Response('{}', {
      status: 200,
      headers: { 'content-length': '65537', 'content-type': 'application/json' },
    })) as typeof fetch;
  await assert.rejects(
    runPublicTestnetSmoke(PUBLIC_TESTNET_PROFILES, {
      fetch: oversizedFetch,
      timeoutMs: 100,
    }),
    /PUBLIC_TESTNET_HTTP_FAILED:eip155:11155111/u,
  );
});

test('a timed-out RPC is aborted once and reports no upstream detail', async () => {
  let calls = 0;
  const timeoutFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    await new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('upstream timeout detail')), {
        once: true,
      });
    });
  }) as typeof fetch;

  await assert.rejects(
    runPublicTestnetSmoke(PUBLIC_TESTNET_PROFILES, { fetch: timeoutFetch, timeoutMs: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'PUBLIC_TESTNET_REQUEST_FAILED:eip155:11155111');
      assert.doesNotMatch(error.message, /upstream|timeout detail/iu);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('the live command is blocked in production and hosted CI', () => {
  assert.doesNotThrow(() => assertLocalPublicTestnetOperatorBoundary({}));
  assert.doesNotThrow(() => assertLocalPublicTestnetOperatorBoundary({ CI: 'false' }));
  for (const NODE_ENV of ['production', 'Production', 'PRODUCTION', ' production ']) {
    assert.throws(
      () => assertLocalPublicTestnetOperatorBoundary({ NODE_ENV }),
      /PUBLIC_TESTNET_LIVE_PRODUCTION_BLOCKED/u,
    );
  }
  assert.throws(
    () => assertLocalPublicTestnetOperatorBoundary({ CI: 'true' }),
    /PUBLIC_TESTNET_LIVE_CI_BLOCKED/u,
  );
});
