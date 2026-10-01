import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFunctionData } from 'viem';
import { Keypair } from '@solana/web3.js';
import { createSourceBridgePlan, ETHEREUM } from '../src/source-plan.js';
import { CCTP_SOURCE_ROUTER_ABI, prepareEthereumSourceBridge } from '../src/ethereum-source.js';
import {
  advanceBridgeProgress,
  submitSourceOnce,
  type SourceSubmissionJournal,
} from '../src/source-submission.js';

test('prepared Ethereum calldata routes the signed source principal and fee through the chosen router', () => {
  const plan = createSourceBridgePlan({
    sourceNetwork: ETHEREUM,
    sourceWallet: '0x1234567890123456789012345678901234567890',
    destinationWallet: Keypair.generate().publicKey.toBase58(),
    treasuries: {
      ethereum: '0x9876543210987654321098765432109876543210',
      solana: Keypair.generate().publicKey.toBase58(),
    },
    principal: 1_000_000_000n,
    maxBridgeFee: 1_000n,
    minimumDestinationAmount: 999_999_000n,
    nowSeconds: 1n,
    deadline: 200n,
  });
  const transaction = prepareEthereumSourceBridge({
    plan,
    router: '0x5555555555555555555555555555555555555555',
    quoteSignature: '0xabcd',
  });
  assert.equal(transaction.chainId, '0x1');
  assert.equal(transaction.value, '0x0');
  const call = decodeFunctionData({ abi: CCTP_SOURCE_ROUTER_ABI, data: transaction.data });
  assert.equal(call.functionName, 'bridge');
  if (call.functionName !== 'bridge') throw new Error('wrong call');
  assert.equal(call.args[0].mintRecipient, plan.mintRecipient);
  assert.equal(call.args[0].principal, plan.principal);
  assert.equal(call.args[0].feeBps, 20);
});

function journal(): SourceSubmissionJournal {
  const reserved = new Set<string>();
  return {
    async reserve(id) {
      if (reserved.has(id)) return false;
      reserved.add(id);
      return true;
    },
    async recordSubmission() {},
  };
}
const intentId = `0x${'22'.repeat(32)}`;
const transactionFingerprint = '33'.repeat(32);

test('concurrent source submissions, reload recovery and destination failures cannot charge a source fee twice', async () => {
  let sends = 0;
  const durable = journal(); // Fake journal exercises the host's required atomic reserve contract.
  const input = {
    intentId,
    transactionFingerprint,
    journal: durable,
    assertReady: async () => {},
    submitFromUserWallet: async () => {
      sends++;
      return 'source-transaction';
    },
  };
  const results = await Promise.allSettled([submitSourceOnce(input), submitSourceOnce(input)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(sends, 1);
  await assert.rejects(submitSourceOnce({ ...input }), /ALREADY_RESERVED/);
  assert.equal(
    advanceBridgeProgress('AWAITING_ATTESTATION', 'DESTINATION_RECOVERY'),
    'DESTINATION_RECOVERY',
  );
  assert.throws(() => advanceBridgeProgress('DESTINATION_RECOVERY', 'SOURCE_PENDING'));
  assert.throws(() => advanceBridgeProgress('AWAITING_ATTESTATION', 'LENT'));
  assert.equal(
    advanceBridgeProgress('READY_TO_MINT', 'MINT_AND_SUPPLY_PENDING'),
    'MINT_AND_SUPPLY_PENDING',
  );
  assert.equal(advanceBridgeProgress('MINT_AND_SUPPLY_PENDING', 'LENT'), 'LENT');
  assert.equal(
    advanceBridgeProgress('MINT_AND_SUPPLY_PENDING', 'DESTINATION_RECOVERY'),
    'DESTINATION_RECOVERY',
  );
  assert.throws(() => advanceBridgeProgress('MINT_AND_SUPPLY_PENDING', 'SOURCE_PENDING'));
});

test('ambiguous broadcast and persistence failure retain the source reservation', async () => {
  for (const failDuring of ['broadcast', 'record'] as const) {
    const durable = journal();
    let sends = 0;
    if (failDuring === 'record')
      durable.recordSubmission = async () => {
        throw new Error('persistence unavailable');
      };
    const input = {
      intentId,
      transactionFingerprint,
      journal: durable,
      assertReady: async () => {},
      submitFromUserWallet: async () => {
        sends++;
        if (failDuring === 'broadcast') throw new Error('unknown broadcast outcome');
        return 'tx';
      },
    };
    await assert.rejects(submitSourceOnce(input));
    await assert.rejects(submitSourceOnce(input), /ALREADY_RESERVED/);
    assert.equal(sends, 1);
  }
});

test('failed readiness or unavailable journal makes no wallet request', async () => {
  let sends = 0;
  const input = {
    intentId,
    transactionFingerprint,
    journal: journal(),
    assertReady: async () => {
      throw new Error('wrong chain or expired quote');
    },
    submitFromUserWallet: async () => {
      sends++;
      return 'tx';
    },
  };
  await assert.rejects(submitSourceOnce(input));
  await assert.rejects(
    submitSourceOnce({
      ...input,
      assertReady: async () => {},
      journal: {
        reserve: async () => {
          throw new Error('durable journal unavailable');
        },
        recordSubmission: async () => {},
      },
    }),
  );
  assert.equal(sends, 0);
});
