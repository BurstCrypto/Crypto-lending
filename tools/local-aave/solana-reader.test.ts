import assert from 'node:assert/strict';
import test from 'node:test';

import type { BalanceJsonRpcRequest } from '../../apps/api/src/blockchain-sync/infrastructure/rpc/balance-json-rpc';
import type { BoundedBalanceJsonRpcTransport } from '../../apps/api/src/blockchain-sync/infrastructure/rpc/node-https-balance-json-rpc.transport';
import {
  decodeCanonicalSolanaPublicKey as decode,
  encodeSolanaBase58 as encode,
} from '../../apps/api/src/mainnet-actions/infrastructure/solana-mainnet-public-key.codec';
import { KAMINO_LEND_SOLANA_MAINNET_IDENTITIES as ID } from '../../apps/api/src/smart-lending/infrastructure/kamino/kamino-lend-solana-finalized-transcript.adapter';
import captured from './fixtures/kamino-main-market.json';
import {
  LocalSolanaReader,
  SOLANA_MINTS,
  kaminoDefaultObligations,
  solanaWalletAddress,
} from './solana-reader';

const WALLET = encode(Buffer.alloc(32, 19));
const OTHER = encode(Buffer.alloc(32, 20));
const HASH = encode(Buffer.alloc(32, 21));
const SLOT = captured.slot + 100;
const TIME = Math.floor(Date.now() / 1000) - 20;
const Q = 1n << 60n;
const targets = kaminoDefaultObligations(WALLET);
const TOKEN_ADDRESSES = [22, 23, 24].map((byte) => encode(Buffer.alloc(32, byte)));
function writeWide(b: Buffer, offset: number, n: bigint, count = 2): void {
  for (let i = 0; i < count; i++) {
    b.writeBigUInt64LE(n & ((1n << 64n) - 1n), offset + i * 8);
    n >>= 64n;
  }
}
function rpcAccount(data: Buffer, owner = ID.programAddress as string, lamports = 2039280) {
  return {
    owner,
    lamports,
    executable: false,
    space: data.length,
    data: [data.toString('base64'), 'base64'],
  };
}
function token(mint: string, amount: bigint) {
  const data = Buffer.alloc(165);
  decode(mint).copy(data, 0);
  decode(WALLET).copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return rpcAccount(data, ID.legacyTokenProgramAddress);
}
function mint() {
  const d = Buffer.alloc(82);
  d[44] = 6;
  d[45] = 1;
  return rpcAccount(d, ID.legacyTokenProgramAddress);
}
function balances() {
  const reserve = Buffer.from(captured.reserve.data[0]!, 'base64');
  reserve.writeBigUInt64LE(30_000_000n, 224);
  writeWide(reserve, 232, 90_000_000n * Q);
  writeWide(reserve, 296, 2n * Q, 4);
  writeWide(reserve, 344, 5_000_000n * Q);
  writeWide(reserve, 360, 2_000_000n * Q);
  writeWide(reserve, 376, 3_000_000n * Q);
  reserve.writeBigUInt64LE(100_000_000n, 2592);
  const obligation = Buffer.alloc(3344);
  Buffer.from([168, 206, 141, 106, 88, 76, 172, 167]).copy(obligation);
  obligation.writeBigUInt64LE(BigInt(SLOT - 1), 16);
  decode(ID.lendingMarketAddress).copy(obligation, 32);
  decode(WALLET).copy(obligation, 64);
  decode(ID.usdcReserveAddress).copy(obligation, 96);
  obligation.writeBigUInt64LE(10_000_000n, 128);
  decode(ID.usdcReserveAddress).copy(obligation, 1208);
  writeWide(obligation, 1240, Q, 4);
  writeWide(obligation, 1296, 3_000_000n * Q + 1n);
  return new Map<string, unknown>([
    [ID.lendingMarketAddress, structuredClone(captured.market)],
    [ID.usdcReserveAddress, rpcAccount(reserve)],
    ...SOLANA_MINTS.map((a) => [a.mint, mint()] as [string, unknown]),
    [WALLET, rpcAccount(Buffer.alloc(0), '11111111111111111111111111111111', 50_000_001)],
    [targets[0]!.address, rpcAccount(obligation)],
    [targets[1]!.address, null],
    [TOKEN_ADDRESSES[0]!, token(ID.usdcMintAddress, 1_000_000n)],
    [TOKEN_ADDRESSES[1]!, token(ID.usdcMintAddress, 1_500_000n)],
    [TOKEN_ADDRESSES[2]!, token(SOLANA_MINTS[1]!.mint, 6_000_000n)],
  ]);
}
type Mutate = (r: BalanceJsonRpcRequest, result: unknown, count: number) => unknown;
function source(index: number, data = balances(), mutate: Mutate = (_r, v) => v, bytes = 200) {
  const requests: BalanceJsonRpcRequest[] = [];
  const budgets: number[] = [];
  const transport: BoundedBalanceJsonRpcTransport = {
    async exchangeBounded(request, signal, budget) {
      assert.equal(signal.aborted, false);
      requests.push(request);
      budgets.push(budget);
      let result: unknown;
      if (request.method === 'getGenesisHash') result = ID.genesisHash;
      else if (request.method === 'getSlot') result = SLOT;
      else if (request.method === 'getTokenAccountsByOwner') {
        // PublicNode requires credentials for indexed calls. Discovery uses the public Solana RPC.
        assert.equal(index, 1);
        assert.equal(request.params[0], WALLET);
        const m = (request.params[1] as { mint: string }).mint;
        result = {
          context: { slot: SLOT },
          value: TOKEN_ADDRESSES.filter((_a, i) =>
            m === ID.usdcMintAddress ? i < 2 : i === 2,
          ).map((a) => ({ pubkey: a, account: data.get(a) })),
        };
      } else if (request.method === 'getMultipleAccounts') {
        const opts = request.params[1] as Record<string, unknown>;
        assert.equal(opts.commitment, 'finalized');
        assert.equal(opts.encoding, 'base64');
        assert.ok(Number(opts.minContextSlot) >= SLOT);
        result = {
          context: { slot: Number(opts.minContextSlot) },
          value: (request.params[0] as string[]).map((a) => data.get(a) ?? null),
        };
      } else if (request.method === 'getBlock')
        result = {
          blockhash: HASH,
          parentSlot: Number(request.params[0]) - 1,
          previousBlockhash: OTHER,
          blockTime: TIME,
        };
      else assert.fail(`Unexpected method ${request.method}`);
      return {
        value: { jsonrpc: '2.0', id: request.id, result: mutate(request, result, requests.length) },
        bodyBytes: bytes,
      };
    },
  };
  return { transport, requests, budgets };
}
const code = (expected: string) => (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === expected;
const read = (
  a: ReturnType<typeof source>,
  b: ReturnType<typeof source>,
  wallet: string | null = WALLET,
) => new LocalSolanaReader([a.transport, b.transport]).read(wallet, new AbortController().signal);

test('decodes the captured public Kamino reserve against the recorded expected totals', async () => {
  const data = balances();
  data.set(ID.usdcReserveAddress, captured.reserve);
  const result = await read(source(0, data), source(1, data), null);
  assert.deepEqual(
    {
      totalSupplied: result.market.totalSupplied,
      totalBorrowed: result.market.totalBorrowed,
      availableLiquidity: result.market.availableLiquidity,
    },
    captured.expected,
  );
  assert.equal(result.walletBalances, null);
  assert.equal(result.positions, null);
  assert.equal(result.mayAuthorizeFinancialAction, false);
});

test('aggregates multiple token accounts and converts collateral, fees and debt indexes without rounding debt down', async () => {
  const a = source(0);
  const b = source(1);
  const result = await read(a, b);
  assert.deepEqual(result.walletBalances, [
    { symbol: 'SOL', amount: '0.050000001', decimals: 9 },
    { symbol: 'USDC', amount: '2.500000', decimals: 6 },
    { symbol: 'USDT', amount: '6.000000', decimals: 6 },
  ]);
  assert.equal(result.market.totalSupplied, '110.000000');
  assert.equal(result.positions![0]!.suppliedUsdc, '11.000000');
  assert.equal(result.positions![0]!.borrowedUsdc, '6.000001');
  assert.equal(result.positions![1]!.status, 'NOT_FOUND');
  assert.match(result.positionCoverage, /Other markets/);
  assert.equal(b.requests.filter((r) => r.method === 'getTokenAccountsByOwner').length, 4);
  assert.equal(a.budgets[0], 1024 * 1024);
  assert.ok(a.budgets.at(-1)! < a.budgets[0]!);
});

test('preserves case-sensitive Solana addresses and rejects Ethereum, noncanonical and zero addresses before RPC', async () => {
  const a = source(0);
  const reader = new LocalSolanaReader([a.transport, source(1).transport]);
  assert.equal(solanaWalletAddress(WALLET), WALLET);
  for (const address of [
    `0x${'12'.repeat(20)}`,
    '11111111111111111111111111111111',
    '0OIl',
    'z'.repeat(44),
  ])
    await assert.rejects(
      reader.read(address, new AbortController().signal),
      code('INVALID_ADDRESS'),
    );
  assert.equal(a.requests.length, 0);
});

test('PDA derivation matches the public Kamino SDK example without generating a private key', () => {
  assert.deepEqual(
    kaminoDefaultObligations('EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY').map((a) => a.address),
    [
      '5Rvm48nSVMsqmNJovS4kVAWUS6HX9jRiG3UsPq5VsyPV',
      '3Sqx9ZBAM3Z8FasKGad8vckjkkAhNw868DYrkT4hihRw',
    ],
  );
});

test('accepts matching account bytes at nearby finalized slots and exposes both contexts', async () => {
  const b = source(1, undefined, (r, v) =>
    r.method === 'getMultipleAccounts' ? { ...(v as object), context: { slot: SLOT + 1 } } : v,
  );
  const result = await read(source(0), b, null);
  assert.deepEqual(result.contextSlots, [SLOT, SLOT + 1]);
  assert.equal(result.block.number, String(SLOT));
});

test('retries account disagreement once and rejects persistent disagreement', async () => {
  const data = balances();
  data.set(WALLET, rpcAccount(Buffer.alloc(0), '11111111111111111111111111111111', 1));
  const a = source(0);
  const b = source(1, data);
  await assert.rejects(read(a, b), code('SOURCE_DISAGREEMENT'));
  assert.equal(a.requests.filter((r) => r.method === 'getMultipleAccounts').length, 2);
});

test('rechecks token discovery and rejects newly appeared accounts instead of reporting incomplete totals', async () => {
  let scans = 0;
  const b = source(1, undefined, (r, v) => {
    if (r.method === 'getTokenAccountsByOwner' && ++scans > 2)
      return { context: { slot: SLOT }, value: [] };
    return v;
  });
  await assert.rejects(read(source(0), b), code('SOURCE_DISAGREEMENT'));
});

for (const variant of [
  'wrong chain',
  'stale block',
  'future block',
  'regressing context',
  'different block',
  'unbounded slot gap',
] as const)
  test(`rejects ${variant}`, async () => {
    const b = source(1, undefined, (r, v) => {
      if (variant === 'wrong chain' && r.method === 'getGenesisHash') return OTHER;
      if (variant === 'unbounded slot gap' && r.method === 'getSlot') return SLOT + 500;
      if (variant === 'regressing context' && r.method === 'getMultipleAccounts')
        return { ...(v as object), context: { slot: SLOT - 1 } };
      if (r.method === 'getBlock') {
        if (variant === 'different block') return { ...(v as object), blockhash: WALLET };
        if (variant === 'stale block') return { ...(v as object), blockTime: TIME - 600 };
        if (variant === 'future block') return { ...(v as object), blockTime: TIME + 600 };
      }
      return v;
    });
    await assert.rejects(
      read(source(0), b, null),
      code(variant === 'different block' ? 'SOURCE_DISAGREEMENT' : 'UNAVAILABLE'),
    );
  });

for (const variant of [
  'foreign obligation owner',
  'truncated obligation',
  'foreign token owner',
  'wrong mint decimals',
  'bad reserve discriminator',
  'unsafe lamports',
  'negative net reserve supply',
] as const)
  test(`rejects ${variant} even if both RPCs agree`, async () => {
    const data = balances();
    const address = variant.includes('obligation')
      ? targets[0]!.address
      : variant === 'foreign token owner'
        ? TOKEN_ADDRESSES[0]!
        : variant === 'wrong mint decimals'
          ? ID.usdcMintAddress
          : variant === 'unsafe lamports'
            ? WALLET
            : ID.usdcReserveAddress;
    const account = data.get(address) as ReturnType<typeof rpcAccount>;
    let d = Buffer.from(account.data[0]!, 'base64');
    if (variant === 'foreign obligation owner') decode(OTHER).copy(d, 64);
    if (variant === 'truncated obligation') d = d.subarray(0, 100);
    if (variant === 'foreign token owner') decode(OTHER).copy(d, 32);
    if (variant === 'wrong mint decimals') d[44] = 9;
    if (variant === 'bad reserve discriminator') d[0] = 0;
    if (variant === 'negative net reserve supply') writeWide(d, 344, 1n << 127n);
    data.set(
      address,
      rpcAccount(
        d,
        account.owner,
        variant === 'unsafe lamports' ? Number.MAX_SAFE_INTEGER + 1 : account.lamports,
      ),
    );
    await assert.rejects(read(source(0, data), source(1, data)), code('UNAVAILABLE'));
  });

test('bounds total response bytes and does not accept padded provider data beyond the budget', async () => {
  const a = source(0, undefined, undefined, 600_000);
  await assert.rejects(read(a, source(1), null), code('UNAVAILABLE'));
  assert.equal(a.requests.length, 2);
});

test('starts no exchange for a pre-aborted caller', async () => {
  const a = source(0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new LocalSolanaReader([a.transport, source(1).transport]).read(null, controller.signal),
    code('UNAVAILABLE'),
  );
  assert.equal(a.requests.length, 0);
});

test('drains both RPC exchanges when the caller cancels', async () => {
  let started = 0;
  let drained = 0;
  const controller = new AbortController();
  const transport: BoundedBalanceJsonRpcTransport = {
    exchangeBounded(_r, signal) {
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
    new LocalSolanaReader([transport, transport]).read(null, controller.signal),
    code('UNAVAILABLE'),
  );
  assert.equal(drained, 2);
});

test('retries a correctly bound minimum-slot error and then accepts the finalized account snapshot', async () => {
  const a = source(0);
  let attempts = 0;
  const transport: BoundedBalanceJsonRpcTransport = {
    async exchangeBounded(request, signal, budget) {
      if (request.method === 'getMultipleAccounts' && attempts++ === 0)
        return {
          value: {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32016,
              message: 'Minimum context slot has not been reached',
              data: { contextSlot: SLOT - 1 },
            },
          },
          bodyBytes: 500,
        };
      return a.transport.exchangeBounded(request, signal, budget);
    },
  };
  const result = await new LocalSolanaReader([transport, source(1).transport]).read(
    null,
    new AbortController().signal,
  );
  assert.equal(result.agreement, 'MATCHED_ACCOUNT_DATA');
  assert.equal(attempts, 2);
  assert.equal(a.budgets[2], 1024 * 1024 - 900);
});

test('caps minimum-slot retries at two and retains the original request floor', async () => {
  let calls = 0;
  const a = source(0);
  const transport: BoundedBalanceJsonRpcTransport = {
    async exchangeBounded(request, signal, budget) {
      if (request.method !== 'getMultipleAccounts')
        return a.transport.exchangeBounded(request, signal, budget);
      calls++;
      assert.equal((request.params[1] as { minContextSlot: number }).minContextSlot, SLOT);
      return {
        value: {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32016,
            message: 'Minimum context slot has not been reached',
            data: { contextSlot: SLOT - 1 },
          },
        },
        bodyBytes: 500,
      };
    },
  };
  await assert.rejects(
    new LocalSolanaReader([transport, source(1).transport]).read(
      null,
      new AbortController().signal,
    ),
    code('UNAVAILABLE'),
  );
  assert.equal(calls, 3);
});

test('does not retry an unbound RPC error or continue a slot wait after cancellation', async () => {
  for (const variant of ['wrong id', 'cancelled'] as const) {
    let calls = 0;
    const a = source(0);
    const controller = new AbortController();
    const transport: BoundedBalanceJsonRpcTransport = {
      async exchangeBounded(request, signal, budget) {
        if (request.method !== 'getMultipleAccounts')
          return a.transport.exchangeBounded(request, signal, budget);
        calls++;
        if (variant === 'cancelled') setTimeout(() => controller.abort(), 20);
        return {
          value: {
            jsonrpc: '2.0',
            id: variant === 'wrong id' ? 'wrong' : request.id,
            error: { code: -32016, message: 'Minimum context slot has not been reached' },
          },
          bodyBytes: 200,
        };
      },
    };
    await assert.rejects(
      new LocalSolanaReader([transport, source(1).transport]).read(null, controller.signal),
      code('UNAVAILABLE'),
    );
    assert.equal(calls, 1);
  }
});
