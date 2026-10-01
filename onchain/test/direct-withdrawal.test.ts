import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  kaminoUsdcWithdrawInstructions,
  KAMINO_PROGRAM,
  KAMINO_MARKET,
  KAMINO_USDC_RESERVE,
  KAMINO_COLLATERAL_MINT,
  KAMINO_LIQUIDITY_VAULT,
} from '../src/destination-lending.js';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  SOLANA_USDC,
  TOKEN_PROGRAM,
  MAX_U64,
  associatedUsdcAccount,
} from '../src/source-plan.js';

test('Kamino redemption burns the exact wallet-held cTokens and returns native USDC to that wallet', () => {
  const user = Keypair.fromSeed(new Uint8Array(32).fill(21));
  const instructions = kaminoUsdcWithdrawInstructions({
    user: user.publicKey,
    collateralAmount: 900_001n,
  });
  assert.equal(instructions.length, 2);
  const [create, redeem] = instructions;
  assert.equal(create.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM.toBase58());
  assert.deepEqual(create.data, Buffer.from([1]));
  assert.equal(create.keys[1].pubkey.toBase58(), associatedUsdcAccount(user.publicKey).toBase58());
  assert.equal(create.keys[2].pubkey.toBase58(), user.publicKey.toBase58());
  assert.equal(create.keys[3].pubkey.toBase58(), SOLANA_USDC.toBase58());
  assert.equal(redeem.programId.toBase58(), KAMINO_PROGRAM.toBase58());
  assert.deepEqual(
    redeem.data.subarray(0, 8),
    createHash('sha256').update('global:redeem_reserve_collateral').digest().subarray(0, 8),
  );
  assert.equal(redeem.data.length, 16);
  assert.equal(redeem.data.readBigUInt64LE(8), 900_001n);
  const collateral = PublicKey.findProgramAddressSync(
    [user.publicKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), KAMINO_COLLATERAL_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
  const authority = PublicKey.findProgramAddressSync(
    [Buffer.from('lma'), KAMINO_MARKET.toBuffer()],
    KAMINO_PROGRAM,
  )[0];
  assert.deepEqual(
    redeem.keys.map((key) => key.pubkey.toBase58()),
    [
      user.publicKey,
      KAMINO_MARKET,
      KAMINO_USDC_RESERVE,
      authority,
      SOLANA_USDC,
      KAMINO_COLLATERAL_MINT,
      KAMINO_LIQUIDITY_VAULT,
      collateral,
      associatedUsdcAccount(user.publicKey),
      TOKEN_PROGRAM,
      TOKEN_PROGRAM,
      SYSVAR_INSTRUCTIONS_PUBKEY,
    ].map(String),
  );
  assert.deepEqual(
    redeem.keys.filter((key) => key.isSigner).map((key) => key.pubkey.toBase58()),
    [user.publicKey.toBase58()],
  );
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: user.publicKey,
      recentBlockhash: user.publicKey.toBase58(),
      instructions: [...instructions],
    }).compileToV0Message(),
  );
  tx.sign([user]);
  assert.ok(tx.serialize().length <= 1232);
  assert.equal(tx.message.addressTableLookups.length, 0);
});

test('Kamino redemption rejects invalid owners and non-positive or overflowing receipt-token amounts', () => {
  const user = Keypair.fromSeed(new Uint8Array(32).fill(22)).publicKey;
  for (const collateralAmount of [0n, -1n, MAX_U64 + 1n])
    assert.throws(
      () => kaminoUsdcWithdrawInstructions({ user, collateralAmount }),
      /INVALID_KAMINO_WITHDRAWAL/,
    );
  for (const owner of [PublicKey.default, KAMINO_LIQUIDITY_VAULT])
    assert.throws(
      () => kaminoUsdcWithdrawInstructions({ user: owner, collateralAmount: 1n }),
      /INVALID_KAMINO_WITHDRAWAL/,
    );
});
