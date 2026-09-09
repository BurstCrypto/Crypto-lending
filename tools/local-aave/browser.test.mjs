import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const SOLANA = 'EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY';
const ETHEREUM = `0x${'ab'.repeat(20)}`;
const common = {
  block: { number: '100', hash: 'public-block-hash', timestamp: '2026-09-09T16:00:00.000Z' },
  observedAt: '2026-09-09T16:00:10.000Z',
  sources: ['test RPC one', 'test RPC two'],
  walletAddress: null,
};
const eth = {
  ...common,
  assets: [
    {
      symbol: 'USDC',
      supplyAprPercent: '3.5',
      variableBorrowAprPercent: '4.5',
      totalSupplied: '100',
      totalVariableDebt: '10',
      availableLiquidity: '90',
    },
  ],
};
const sol = {
  ...common,
  market: {
    totalSupplied: '100',
    totalBorrowed: '10',
    availableLiquidity: '90',
    lastUpdateSlot: 99,
  },
  walletBalances: null,
  positions: null,
  positionCoverage: 'Default Kamino accounts only.',
  contextSlots: [100, 101],
};
function setup(t) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:3300/', runScripts: 'outside-only' });
  const calls = [];
  dom.window.fetch = (url, options) =>
    new Promise((resolve) => calls.push({ url, options, resolve }));
  dom.window.eval(script);
  t.after(() => dom.window.close());
  const query = (selector) => dom.window.document.querySelector(selector);
  const fill = (text) => {
    query('#address').value = text;
    query('#address').dispatchEvent(new dom.window.Event('input'));
  };
  const respond = async (index, data) => {
    calls[index].resolve({ ok: true, json: async () => data });
    await setImmediate();
  };
  return { dom, calls, query, fill, respond };
}

test('switching to Solana aborts Ethereum and ignores its late result', async (t) => {
  const { calls, query, respond } = setup(t);
  query('[data-chain="solana"]').click();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(calls[1].url, '/api/solana/read');
  await respond(1, sol);
  await respond(0, eth);
  assert.equal(query('#results').hidden, false);
  assert.match(query('#snapshot-heading').textContent, /Solana/);
  assert.doesNotMatch(query('#markets').textContent, /Supply APR/);
});

test('keeps Ethereum and case-sensitive Solana addresses separate while switching networks', (t) => {
  const { calls, query, fill } = setup(t);
  fill(ETHEREUM);
  query('[data-chain="solana"]').click();
  assert.equal(query('#address').value, '');
  assert.equal(query('#address').maxLength, 44);
  fill(SOLANA);
  query('[data-chain="ethereum"]').click();
  assert.equal(query('#address').value, ETHEREUM);
  assert.equal(JSON.parse(calls.at(-1).options.body).address, ETHEREUM);
  query('[data-chain="solana"]').click();
  assert.equal(query('#address').value, SOLANA);
  assert.equal(JSON.parse(calls.at(-1).options.body).address, SOLANA);
});

test('editing the wallet invalidates an in-flight snapshot', async (t) => {
  const { query, fill, respond } = setup(t);
  fill(ETHEREUM);
  await respond(0, eth);
  assert.equal(query('#results').hidden, true);
  assert.match(query('#status').textContent, /Press Refresh/);
});

test('late Ethereum wallet connection cannot select an address after switching to Solana', async (t) => {
  const { dom, query } = setup(t);
  let finish;
  dom.window.ethereum = {
    request: ({ method }) => {
      assert.equal(method, 'eth_requestAccounts');
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  query('#use-wallet').click();
  query('[data-chain="solana"]').click();
  finish([ETHEREUM]);
  await setImmediate();
  assert.equal(query('#address').value, '');
});

test('Phantom selection reads only its public address and requests no signature', async (t) => {
  const { dom, calls, query } = setup(t);
  const operations = [];
  dom.window.phantom = {
    solana: {
      isPhantom: true,
      connect: async () => {
        operations.push('connect');
        return { publicKey: { toString: () => SOLANA } };
      },
      signMessage: () => assert.fail('no signing'),
      signTransaction: () => assert.fail('no transaction'),
      signAndSendTransaction: () => assert.fail('no broadcast'),
    },
  };
  query('[data-chain="solana"]').click();
  query('#use-wallet').click();
  await setImmediate();
  assert.deepEqual(operations, ['connect']);
  assert.equal(query('#address').value, SOLANA);
  assert.equal(calls.at(-1).url, '/api/solana/read');
  assert.equal(JSON.parse(calls.at(-1).options.body).address, SOLANA);
});

test('rejects an Ethereum address in the Solana form before network access', (t) => {
  const { calls, query, fill } = setup(t);
  query('[data-chain="solana"]').click();
  const before = calls.length;
  fill(ETHEREUM);
  query('#refresh').click();
  assert.equal(calls.length, before);
  assert.match(query('#status').textContent, /Solana base58/);
});

test('shows single-lamport balances and explicit missing-position status', async (t) => {
  const { query, respond } = setup(t);
  query('[data-chain="solana"]').click();
  await respond(1, {
    ...sol,
    walletAddress: SOLANA,
    walletBalances: [{ symbol: 'SOL', amount: '0.000000001' }],
    positions: [{ label: 'USDC lending', status: 'NOT_FOUND' }],
  });
  assert.match(query('#wallet-balances').textContent, /0\.000000001/);
  assert.match(query('#positions').textContent, /not found/);
  assert.doesNotMatch(query('#positions').textContent, /Supplied USDC/);
});
