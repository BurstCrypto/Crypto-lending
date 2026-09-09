import assert from 'node:assert/strict';
import test from 'node:test';

import type { BalanceJsonRpcRequest } from '../../apps/api/src/blockchain-sync/infrastructure/rpc/balance-json-rpc';
import type { BoundedBalanceJsonRpcTransport } from '../../apps/api/src/blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST as manifest } from '../../apps/api/src/smart-lending/infrastructure/aave/aave-v3-ethereum-deployment.manifest';
import { ASSETS, LocalAaveReader, RESERVE_DATA_SELECTOR, walletAddress } from './reader';

const WALLET = `0x${'ab'.repeat(20)}`;
const HASH = `0x${'12'.repeat(32)}`;
const FIXTURE_TIMESTAMP = `0x${Math.floor(Date.now() / 1000 - 600).toString(16)}`;
const head = () => ({
  number: '0x100',
  hash: HASH,
  timestamp: FIXTURE_TIMESTAMP,
});
const abi = (...values: (bigint | string)[]) =>
  `0x${values.map((value) => BigInt(value).toString(16).padStart(64, '0')).join('')}`;
type Mutation = (request: BalanceJsonRpcRequest, result: unknown, call: number) => unknown;

function source(mutate: Mutation = (_request, result) => result, bodyBytes = 100) {
  const requests: BalanceJsonRpcRequest[] = [];
  const budgets: number[] = [];
  const block = head();
  const transport: BoundedBalanceJsonRpcTransport = {
    async exchangeBounded(request, signal, maximumResponseBytes) {
      assert.equal(signal.aborted, false);
      requests.push(request);
      budgets.push(maximumResponseBytes);
      let result: unknown;
      if (request.method === 'eth_chainId') result = '0x1';
      else if (request.method === 'eth_getBlockByNumber') result = block;
      else if (request.method === 'eth_call') {
        const anchor = request.params[1] as Record<string, unknown>;
        assert.equal(anchor.blockHash, HASH);
        assert.equal(anchor.requireCanonical, true);
        assert.deepEqual(Object.keys(anchor).sort(), ['blockHash', 'requireCanonical']);
        const call = request.params[0] as { to: string; data: string };
        const selector = call.data.slice(0, 10);
        if (selector === manifest.selectors.getPool || selector === manifest.selectors.pool)
          result = abi(manifest.contracts.poolProxy);
        else if (selector === manifest.selectors.getReserveTokensAddresses) {
          const asset = ASSETS.find((a) => call.data.endsWith(a.underlyingAsset.slice(2)));
          assert.ok(asset);
          result = abi(asset.aToken, 0n, asset.variableDebtToken);
        } else if (selector === RESERVE_DATA_SELECTOR) {
          result = abi(
            0n,
            0n,
            123456789000000n,
            0n,
            100000000000000n,
            35n * 10n ** 24n,
            45n * 10n ** 24n,
            0n,
            0n,
            10n ** 27n,
            10n ** 27n,
            BigInt(block.timestamp),
          );
        } else {
          assert.equal(selector, '0x70a08231');
          result = abi(call.data.endsWith(WALLET.slice(2)) ? 0n : 23456789000000n);
        }
      } else assert.fail(`Unexpected RPC method ${request.method}`);
      return {
        value: { jsonrpc: '2.0', id: request.id, result: mutate(request, result, requests.length) },
        bodyBytes,
      };
    },
  };
  return { transport, requests, budgets };
}

const errorCode = (code: string) => (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

test('reads real-shaped finalized ABI responses, preserves units and optional wallet absence', async () => {
  const a = source();
  const b = source();
  const result = await new LocalAaveReader([a.transport, b.transport]).read(
    null,
    new AbortController().signal,
  );
  assert.equal(result.block.number, '256');
  assert.equal(result.agreement, 'MATCHED');
  assert.equal(result.mayAuthorizeFinancialAction, false);
  assert.deepEqual(
    result.assets.map(({ symbol, supplyAprPercent, totalSupplied, walletSupply }) => ({
      symbol,
      supplyAprPercent,
      totalSupplied,
      walletSupply,
    })),
    ['USDC', 'USDT'].map((symbol) => ({
      symbol,
      supplyAprPercent: '3.500000000000000000000000000',
      totalSupplied: '123456789.000000',
      walletSupply: null,
    })),
  );
  assert.equal(a.requests.length, 12);
  assert.equal(a.budgets[0], 1024 * 1024);
  assert.equal(a.budgets.at(-1), 1024 * 1024 - 1100);
});

test('wallet lookup distinguishes explicit zero balances from an absent lookup', async () => {
  const result = await new LocalAaveReader([source().transport, source().transport]).read(
    `0x${'AB'.repeat(20)}`,
    new AbortController().signal,
  );
  assert.equal(result.walletAddress, WALLET);
  assert.ok(
    result.assets.every(
      (a) => a.walletSupply === '0.000000' && a.walletVariableDebt === '0.000000',
    ),
  );
});

test('invalid and zero addresses are rejected before any network read', async () => {
  const a = source();
  const reader = new LocalAaveReader([a.transport, source().transport]);
  for (const value of ['0x123', `0x${'00'.repeat(20)}`, 'https://rpc.example', '']) {
    if (value === '') assert.equal(walletAddress(value), null);
    else
      await assert.rejects(
        reader.read(value, new AbortController().signal),
        errorCode('INVALID_ADDRESS'),
      );
  }
  assert.equal(a.requests.length, 0);
});

test('chooses the lower finalized height and verifies its hash on the newer source', async () => {
  const b = source((request, result) =>
    request.method === 'eth_getBlockByNumber' && request.params[0] === 'finalized'
      ? { ...(result as object), number: '0x101', hash: `0x${'34'.repeat(32)}` }
      : result,
  );
  const result = await new LocalAaveReader([source().transport, b.transport]).read(
    null,
    new AbortController().signal,
  );
  assert.equal(result.block.number, '256');
  assert.equal(
    b.requests.filter((r) => r.method === 'eth_getBlockByNumber' && r.params[0] === '0x100').length,
    2,
  );
});

for (const kind of ['head hash', 'closing hash', 'balance'] as const) {
  test(`fails closed on ${kind} disagreement`, async () => {
    const b = source((request, result, call) => {
      if (
        request.method === 'eth_getBlockByNumber' &&
        (kind === 'head hash' || (kind === 'closing hash' && call > 2))
      )
        return { ...(result as object), hash: `0x${'34'.repeat(32)}` };
      if (
        kind === 'balance' &&
        request.method === 'eth_call' &&
        (request.params[0] as { data: string }).data.startsWith('0x70a08231')
      )
        return abi(1n);
      return result;
    });
    await assert.rejects(
      new LocalAaveReader([source().transport, b.transport]).read(
        null,
        new AbortController().signal,
      ),
      errorCode('SOURCE_DISAGREEMENT'),
    );
  });
}

for (const kind of [
  'chain',
  'closing chain',
  'stale',
  'future',
  'reserve mapping',
  'truncated ABI',
  'stable debt',
  'future reserve update',
] as const) {
  test(`rejects ${kind} evidence`, async () => {
    const b = source((request, result, call) => {
      if (
        request.method === 'eth_chainId' &&
        (kind === 'chain' || (kind === 'closing chain' && call > 2))
      )
        return '0xa';
      if (request.method === 'eth_getBlockByNumber' && (kind === 'stale' || kind === 'future'))
        return {
          ...(result as object),
          timestamp: `0x${Math.floor(Date.now() / 1000 + (kind === 'future' ? 600 : -3600)).toString(16)}`,
        };
      const data =
        request.method === 'eth_call' ? (request.params[0] as { data: string }).data : '';
      if (
        kind === 'reserve mapping' &&
        data.startsWith(manifest.selectors.getReserveTokensAddresses)
      )
        return abi(0n, 0n, 0n);
      if (data.startsWith(RESERVE_DATA_SELECTOR)) {
        if (kind === 'truncated ABI') return abi(0n);
        if (kind === 'stable debt' || kind === 'future reserve update') {
          const value = String(result);
          const index = kind === 'stable debt' ? 3 : 11;
          const replacement =
            kind === 'stable debt' ? 1n : BigInt(Math.floor(Date.now() / 1000) + 600);
          return `${value.slice(0, 2 + index * 64)}${abi(replacement).slice(2)}${value.slice(2 + (index + 1) * 64)}`;
        }
      }
      return result;
    });
    await assert.rejects(
      new LocalAaveReader([source().transport, b.transport]).read(
        null,
        new AbortController().signal,
      ),
      errorCode('UNAVAILABLE'),
    );
  });
}

test('enforces aggregate wire bytes including padding before accepting market data', async () => {
  const a = source(undefined, 600_000);
  await assert.rejects(
    new LocalAaveReader([a.transport, source().transport]).read(null, new AbortController().signal),
    errorCode('UNAVAILABLE'),
  );
  assert.equal(a.requests.length, 2);
});

test('a pre-aborted read starts no RPC work', async () => {
  const a = source();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new LocalAaveReader([a.transport, source().transport]).read(null, controller.signal),
    errorCode('UNAVAILABLE'),
  );
  assert.equal(a.requests.length, 0);
});

test('caller cancellation aborts and drains both accepted exchanges', async () => {
  let started = 0;
  let drained = 0;
  const controller = new AbortController();
  const transport: BoundedBalanceJsonRpcTransport = {
    exchangeBounded(_request, signal) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            drained++;
            reject(new Error('cancelled'));
          },
          { once: true },
        );
        if (++started === 2) controller.abort();
      });
    },
  };
  await assert.rejects(
    new LocalAaveReader([transport, transport]).read(null, controller.signal),
    errorCode('UNAVAILABLE'),
  );
  assert.equal(drained, 2);
});

test('a source failure aborts its accepted peer and returns only a safe error', async () => {
  let drained = false;
  const broken: BoundedBalanceJsonRpcTransport = {
    async exchangeBounded() {
      throw new Error('sensitive upstream response');
    },
  };
  const pending: BoundedBalanceJsonRpcTransport = {
    exchangeBounded(_request, signal) {
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            drained = true;
            reject(new Error('cancelled'));
          },
          { once: true },
        ),
      );
    },
  };
  await assert.rejects(
    new LocalAaveReader([broken, pending]).read(null, new AbortController().signal),
    errorCode('UNAVAILABLE'),
  );
  assert.equal(drained, true);
});
