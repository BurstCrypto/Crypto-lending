import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import test, { type TestContext } from 'node:test';

import { LocalAaveReadError, type LocalAaveSnapshot } from './reader';
import { createLocalAaveServer } from './server';

async function start(
  t: TestContext,
  read: (wallet: string | null, signal: AbortSignal) => Promise<LocalAaveSnapshot> = async () => {
    throw new LocalAaveReadError('UNAVAILABLE');
  },
) {
  const server = createLocalAaveServer({ read });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  assert.equal(address.address, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'Content-Type': 'application/json', Origin: url };
  return { url, headers };
}

function rawPost(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${url}/api/read`, { method: 'POST', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode!));
    });
    req.on('error', reject);
    req.end('{"address":null}');
  });
}

test('serves the local UI with restrictive browser headers and no RPC on page GET', async (t) => {
  let reads = 0;
  const { url } = await start(t, async () => {
    reads++;
    throw new Error('unexpected');
  });
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Your local window/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy')!, /connect-src 'self'/);
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  for (const path of ['/app.js', '/style.css', '/health'])
    assert.equal((await fetch(`${url}${path}`)).status, 200);
  assert.equal(reads, 0);
});

test('rejects forged hosts, cross-site requests and missing origins before RPC', async (t) => {
  let reads = 0;
  const { url, headers } = await start(t, async () => {
    reads++;
    throw new Error('unexpected');
  });
  for (const bad of [
    { ...headers, Host: 'attacker.example' },
    { ...headers, Origin: 'https://attacker.example' },
    { 'Content-Type': 'application/json' },
    { ...headers, 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    assert.equal(await rawPost(url, bad), 403);
  }
  assert.equal(reads, 0);
});

test('rejects malformed, oversized and non-JSON input without RPC', async (t) => {
  let reads = 0;
  const { url, headers } = await start(t, async () => {
    reads++;
    throw new Error('unexpected');
  });
  for (const body of [
    '{',
    '{}',
    '[]',
    '{"address":"0x1"}',
    '{"address":null,"endpoint":"https://other.example"}',
    ' '.repeat(257),
  ]) {
    assert.equal((await fetch(`${url}/api/read`, { method: 'POST', headers, body })).status, 400);
  }
  assert.equal(
    (
      await fetch(`${url}/api/read`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'text/plain' },
        body: '{"address":null}',
      })
    ).status,
    400,
  );
  assert.equal(reads, 0);
});

test('has no generic RPC proxy, transaction route, or query-string wallet lookup', async (t) => {
  const { url, headers } = await start(t);
  for (const path of ['/rpc', '/api/transaction', '/api/read?address=0x1']) {
    assert.equal(
      (await fetch(`${url}${path}`, { method: 'POST', headers, body: '{"address":null}' })).status,
      404,
    );
  }
  assert.equal((await fetch(`${url}/api/read`)).status, 404);
});

test('sanitizes upstream errors and enforces the refresh cooldown', async (t) => {
  const { url, headers } = await start(t, async () => {
    throw new Error('private upstream details');
  });
  const response = await fetch(`${url}/api/read`, {
    method: 'POST',
    headers,
    body: '{"address":null}',
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Live Aave data is temporarily unavailable. Please try again.',
  });
  assert.equal(
    (await fetch(`${url}/api/read`, { method: 'POST', headers, body: '{"address":null}' })).status,
    429,
  );
});

test(
  'bounds concurrency and cancels RPC when the browser disconnects',
  { timeout: 5000 },
  async (t) => {
    let markStarted!: () => void;
    let markAborted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const { url, headers } = await start(
      t,
      (_wallet, signal) =>
        new Promise((_resolve, reject) => {
          markStarted();
          signal.addEventListener(
            'abort',
            () => {
              markAborted();
              reject(new Error('cancelled'));
            },
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const first = fetch(`${url}/api/read`, {
      method: 'POST',
      headers,
      body: '{"address":null}',
      signal: controller.signal,
    });
    const rejected = assert.rejects(first);
    await started;
    assert.equal(
      (await fetch(`${url}/api/read`, { method: 'POST', headers, body: '{"address":null}' }))
        .status,
      429,
    );
    controller.abort();
    await rejected;
    await aborted;
  },
);

test('refuses production startup', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => createLocalAaveServer(), /development tool/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
