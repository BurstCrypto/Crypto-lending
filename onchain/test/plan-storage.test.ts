import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { createSourceBridgePlan, ETHEREUM } from '../src/source-plan.ts';
import {
  restoreSourcePlan,
  serializeSourcePlan,
  verifyEmittedCctpMessage,
} from '../src/plan-storage.ts';
import {
  KAMINO_COLLATERAL_MINT,
  KAMINO_LIQUIDITY_VAULT,
  kaminoUsdcSupplyInstructions,
} from '../src/destination-lending.ts';

test('expired source plans restore the original identity and amounts for destination recovery', () => {
  const solana = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey.toBase58();
  const treasuries = { ethereum: '0x2222222222222222222222222222222222222222', solana };
  const plan = createSourceBridgePlan({
    sourceNetwork: ETHEREUM,
    sourceWallet: '0x1111111111111111111111111111111111111111',
    destinationWallet: solana,
    principal: 1_000_000n,
    maxBridgeFee: 1000n,
    minimumDestinationAmount: 999000n,
    treasuries,
    nowSeconds: 1000n,
    deadline: 1300n,
  });
  const saved = serializeSourcePlan(plan);
  assert.deepEqual(serializeSourcePlan(restoreSourcePlan(saved, treasuries)), saved);
  const changes: Record<string, string>[] = [
    { platformFee: '0' },
    { totalSourceDebit: '1000000' },
    { deadline: '1.3e3' },
    { sourceAsset: 'wrong' },
  ];
  for (const change of changes)
    assert.throws(() => restoreSourcePlan({ ...saved, ...change }, treasuries));
  assert.throws(() =>
    restoreSourcePlan(saved, {
      ...treasuries,
      ethereum: '0x3333333333333333333333333333333333333333',
    }),
  );
});
test('attestation may fill Circle execution fields but cannot change a burned message recipient, amount, or sender', () => {
  const emitted = Buffer.alloc(412),
    attested = Buffer.from(emitted);
  for (const offset of [12, 144, 312, 344]) attested[offset] = 1;
  const hex = (b: Buffer) => `0x${b.toString('hex')}` as const;
  assert.doesNotThrow(() => verifyEmittedCctpMessage(hex(emitted), hex(attested)));
  for (const offset of [0, 44, 76, 108, 148, 184, 248, 280, 376]) {
    const changed = Buffer.from(attested);
    changed[offset] = 1;
    assert.throws(() => verifyEmittedCctpMessage(hex(emitted), hex(changed)));
  }
});
test('the Kamino main reserve instruction uses its actual recorded legacy vault and collateral mint', () => {
  const instructions = kaminoUsdcSupplyInstructions({
    user: Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey,
    principal: 1000000n,
  });
  assert.equal(KAMINO_COLLATERAL_MINT.toBase58(), 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D');
  assert.equal(KAMINO_LIQUIDITY_VAULT.toBase58(), 'Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6');
  for (const key of [KAMINO_COLLATERAL_MINT, KAMINO_LIQUIDITY_VAULT])
    assert.ok(instructions.some((ix) => ix.keys.some((meta) => meta.pubkey.equals(key))));
});
