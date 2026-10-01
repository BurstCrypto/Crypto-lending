import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { createSourceBridgePlan, ETHEREUM, SOLANA } from '../src/source-plan.js';
import { getCircleStandardFee, pollCircleAttestation } from '../src/circle-client.js';

const response =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });
const plan = createSourceBridgePlan({
  sourceNetwork: ETHEREUM,
  sourceWallet: '0x1234567890123456789012345678901234567890',
  destinationWallet: Keypair.generate().publicKey.toBase58(),
  principal: 1_000_000_000n,
  maxBridgeFee: 100_000n,
  minimumDestinationAmount: 999_900_000n,
  nowSeconds: 1n,
  deadline: 200n,
  treasuries: {
    ethereum: '0x9876543210987654321098765432109876543210',
    solana: Keypair.generate().publicKey.toBase58(),
  },
});
const input = {
  plan,
  sourceTransactionId: `0x${'19'.repeat(32)}`,
  deployment: {
    ethereumTokenMessenger: '0x5555555555555555555555555555555555555555',
    ethereumMessageTransmitter: '0x6666666666666666666666666666666666666666',
    ethereumSourceRouter: '0x7777777777777777777777777777777777777777',
  },
} as const;

test('Circle fee reads use the source/destination domains and round decimal bps up independently from the platform fee', async () => {
  const seen: string[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    seen.push(String(url));
    assert.equal(options?.method, 'GET');
    assert.equal(options?.redirect, 'error');
    return new Response(
      JSON.stringify([
        { finalityThreshold: 1000, minimumFee: 1 },
        { finalityThreshold: 2000, minimumFee: 0.001 },
      ]),
    );
  };
  assert.equal(await getCircleStandardFee({ sourceNetwork: ETHEREUM, principal: 1n, fetcher }), 1n);
  assert.equal(
    await getCircleStandardFee({ sourceNetwork: SOLANA, principal: 1_000_000_000n, fetcher }),
    100n,
  );
  assert.deepEqual(seen, [
    'https://iris-api.circle.com/v2/burn/USDC/fees/0/5',
    'https://iris-api.circle.com/v2/burn/USDC/fees/5/0',
  ]);
  assert.equal(
    await getCircleStandardFee({
      sourceNetwork: ETHEREUM,
      principal: 10n,
      fetcher: response([{ finalityThreshold: 2000, minimumFee: 0 }]),
    }),
    0n,
  );
  for (const body of [
    [],
    [{ finalityThreshold: 2000, minimumFee: -1 }],
    [{ finalityThreshold: 2000, minimumFee: '0' }],
  ]) {
    await assert.rejects(
      getCircleStandardFee({ sourceNetwork: ETHEREUM, principal: 10n, fetcher: response(body) }),
      /INVALID_CIRCLE_FEES/,
    );
  }
});

test('pending or absent attestations remain pending without any source transaction submission', async () => {
  assert.deepEqual(await pollCircleAttestation({ ...input, fetcher: response({}, 404) }), {
    status: 'PENDING',
  });
  const fetcher: typeof fetch = async (url) => {
    assert.equal(
      String(url),
      `https://iris-api.circle.com/v2/messages/0?transactionHash=${input.sourceTransactionId}`,
    );
    return response({ messages: [{ status: 'pending_confirmations' }] })(url);
  };
  assert.deepEqual(await pollCircleAttestation({ ...input, fetcher }), { status: 'PENDING' });
});

test('unavailable, oversized, invalid and nonmatching Circle responses never produce a ready mint', async () => {
  await assert.rejects(
    pollCircleAttestation({ ...input, fetcher: response({}, 500) }),
    /UNAVAILABLE/,
  );
  await assert.rejects(
    pollCircleAttestation({ ...input, fetcher: response('x'.repeat(70_000)) }),
    /TOO_LARGE/,
  );
  await assert.rejects(
    pollCircleAttestation({
      ...input,
      fetcher: response({
        messages: [{ status: 'complete', cctpVersion: 2, message: '0x00', attestation: '0x00' }],
      }),
    }),
    /NOT_FOUND/,
  );
  await assert.rejects(
    pollCircleAttestation({ ...input, sourceTransactionId: '../etc', fetcher: response({}) }),
    /INVALID_SOURCE/,
  );
});
