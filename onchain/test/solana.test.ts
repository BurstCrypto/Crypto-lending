import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  createSourceBridgePlan,
  ETHEREUM,
  SOLANA,
  SOLANA_USDC,
  TOKEN_PROGRAM,
  associatedUsdcAccount,
  MAX_U64,
} from '../src/source-plan.js';
import {
  CCTP_TOKEN_MESSENGER,
  prepareSolanaSourceBridge,
  verifySignedSolanaSourceBridge,
} from '../src/solana-source.js';

const solanaUser = Keypair.generate();
const solanaTreasury = Keypair.generate().publicKey;
const ethereumUser = '0x1234567890123456789012345678901234567890';
const treasuries = {
  ethereum: '0x9876543210987654321098765432109876543210',
  solana: solanaTreasury.toBase58(),
};
const input = {
  sourceNetwork: SOLANA,
  sourceWallet: solanaUser.publicKey.toBase58(),
  destinationWallet: ethereumUser,
  principal: 1_000_000_000n,
  maxBridgeFee: 100_000n,
  minimumDestinationAmount: 999_900_000n,
  nowSeconds: 1_789_000_000n,
  deadline: 1_789_000_240n,
  treasuries,
} as const;
function prepared() {
  return prepareSolanaSourceBridge({
    plan: createSourceBridgePlan(input),
    eventSigner: Keypair.generate(),
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 12345,
    nowSeconds: input.nowSeconds,
    computeUnits: 300_000,
    microLamportsPerComputeUnit: 1000n,
  });
}

test('both directions select the source token and source treasury, with fee added on top', () => {
  const sol = createSourceBridgePlan(input);
  assert.equal(sol.treasury, treasuries.solana);
  assert.equal(sol.sourceAsset, SOLANA_USDC.toBase58());
  assert.equal(sol.platformFee, 2_000_000n);
  assert.equal(sol.totalSourceDebit, 1_002_000_000n);
  assert.equal(sol.mintRecipient, `0x${ethereumUser.slice(2).padStart(64, '0')}`);
  const eth = createSourceBridgePlan({
    ...input,
    sourceNetwork: ETHEREUM,
    sourceWallet: ethereumUser,
    destinationWallet: solanaUser.publicKey.toBase58(),
  });
  assert.equal(eth.treasury, treasuries.ethereum);
  assert.equal(eth.destinationNetwork, SOLANA);
  assert.equal(eth.platformFee, sol.platformFee);
  assert.equal(
    eth.mintRecipient,
    `0x${associatedUsdcAccount(solanaUser.publicKey).toBuffer().toString('hex')}`,
  );
  assert.notEqual(eth.mintRecipient, `0x${solanaUser.publicKey.toBuffer().toString('hex')}`);
});

test('Solana source message contains the exact USDC fee and real Circle burn, authorized together', () => {
  const source = prepared();
  const transfers = source.transaction.instructions.filter((ix) =>
    ix.programId.equals(TOKEN_PROGRAM),
  );
  assert.equal(transfers.length, 1);
  const transfer = transfers[0];
  assert.equal(transfer.data[0], 12);
  assert.equal(transfer.data.readBigUInt64LE(1), 2_000_000n);
  assert.equal(transfer.data[9], 6);
  assert.equal(transfer.keys[1].pubkey.toBase58(), SOLANA_USDC.toBase58());
  assert.equal(
    transfer.keys[2].pubkey.toBase58(),
    associatedUsdcAccount(solanaTreasury).toBase58(),
  );
  const burns = source.transaction.instructions.filter((ix) =>
    ix.programId.equals(CCTP_TOKEN_MESSENGER),
  );
  assert.equal(burns.length, 1);
  const burn = burns[0];
  assert.equal(burn.data.length, 136);
  assert.equal(burn.data.readBigUInt64LE(8), input.principal);
  assert.equal(burn.data.readUInt32LE(16), 0);
  assert.equal(burn.data.subarray(20, 52).toString('hex'), ethereumUser.slice(2).padStart(64, '0'));
  assert.equal(burn.data.readBigUInt64LE(84), input.maxBridgeFee);
  assert.equal(burn.data.readUInt32LE(92), 2000);
  assert.equal(burn.data.readUInt32LE(96), 36);
  assert.equal(burn.data.subarray(100, 104).toString(), 'BNS1');
  assert.equal(burn.data.subarray(104).toString('hex'), source.plan.intentId.slice(2));
  assert.equal(burn.keys.length, 18);
  assert.equal(
    burn.keys[4].pubkey.toBase58(),
    PublicKey.findProgramAddressSync(
      [Buffer.from('denylist_account'), solanaUser.publicKey.toBuffer()],
      CCTP_TOKEN_MESSENGER,
    )[0].toBase58(),
  );
  source.transaction.partialSign(solanaUser);
  const signed = verifySignedSolanaSourceBridge(source, source.transaction);
  assert.ok(signed.length <= 1232);
  assert.equal(Transaction.from(signed).signatures.length, 2);
});

test('removed or changed fee, altered bridge recipient, extra instruction and invalid signature are rejected before broadcast', () => {
  for (const mutation of [
    'removeFee',
    'changeFee',
    'recipient',
    'extra',
    'unsigned',
    'publishedMessage',
  ] as const) {
    const source = prepared();
    const tx = source.transaction;
    const fee = tx.instructions.find((ix) => ix.programId.equals(TOKEN_PROGRAM))!;
    if (mutation === 'removeFee') tx.instructions = tx.instructions.filter((ix) => ix !== fee);
    if (mutation === 'changeFee') fee.data.writeBigUInt64LE(1n, 1);
    if (mutation === 'recipient' || mutation === 'publishedMessage')
      tx.instructions.find((ix) => ix.programId.equals(CCTP_TOKEN_MESSENGER))!.data.fill(0, 20, 52);
    if (mutation === 'extra') tx.add(fee);
    if (mutation !== 'unsigned') tx.partialSign(solanaUser);
    if (mutation === 'publishedMessage') source.message.set(tx.serializeMessage());
    assert.throws(() => verifySignedSolanaSourceBridge(source, tx), /MISMATCH/);
  }
});

test('invalid chain, excessive amounts, stale quote, fees exceeding delivery limits, and unvalidated plans fail', () => {
  for (const change of [
    { sourceNetwork: 'eip155:8453' },
    { principal: MAX_U64 },
    { deadline: input.nowSeconds },
    { maxBridgeFee: input.principal },
    { minimumDestinationAmount: input.principal },
    { tier: 'UNKNOWN' },
  ])
    assert.throws(() => createSourceBridgePlan({ ...input, ...change } as typeof input));
  const source = prepared();
  assert.throws(
    () =>
      prepareSolanaSourceBridge({
        plan: { ...source.plan, platformFee: 0n },
        eventSigner: Keypair.generate(),
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 10,
        nowSeconds: input.nowSeconds,
        computeUnits: 300_000,
        microLamportsPerComputeUnit: 1000n,
      }),
    /UNVALIDATED/,
  );
});
