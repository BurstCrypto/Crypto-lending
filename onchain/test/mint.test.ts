import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import {
  createSourceBridgePlan,
  ETHEREUM,
  SOLANA,
  ETHEREUM_USDC,
  SOLANA_USDC,
  associatedUsdcAccount,
  TOKEN_PROGRAM,
  MAX_U64,
} from '../src/source-plan.js';
import { CCTP_TOKEN_MESSENGER, CCTP_MESSAGE_TRANSMITTER } from '../src/solana-source.js';
import {
  bindCctpMintMessage,
  prepareEthereumCctpMint,
  prepareSolanaCctpMint,
  solanaCctpMintInstructions,
} from '../src/cctp-mint.js';
import {
  AAVE_SUPPLY_ROUTER_ABI,
  KAMINO_PROGRAM,
  KAMINO_MARKET,
  KAMINO_USDC_RESERVE,
  KAMINO_COLLATERAL_MINT,
  KAMINO_LIQUIDITY_VAULT,
  kaminoUsdcSupplyInstructions,
  prepareEthereumCctpMintAndSupply,
  prepareSolanaCctpMintAndSupply,
} from '../src/destination-lending.js';
import { verifySignedSolanaDestination } from '../src/solana-destination-verification.js';
import { pollCircleAttestation } from '../src/circle-client.js';

const ethereumUser = '0x1234567890123456789012345678901234567890';
const solanaUser = Keypair.generate();
const deployment = {
  ethereumTokenMessenger: '0x5555555555555555555555555555555555555555',
  ethereumMessageTransmitter: '0x6666666666666666666666666666666666666666',
  ethereumSourceRouter: '0x7777777777777777777777777777777777777777',
} as const;
const evm = (address: Address) => Buffer.from(address.slice(2).padStart(64, '0'), 'hex');

function fixture(sourceNetwork: typeof ETHEREUM | typeof SOLANA) {
  const fromEthereum = sourceNetwork === ETHEREUM;
  const plan = createSourceBridgePlan({
    sourceNetwork,
    sourceWallet: fromEthereum ? ethereumUser : solanaUser.publicKey.toBase58(),
    destinationWallet: fromEthereum ? solanaUser.publicKey.toBase58() : ethereumUser,
    treasuries: {
      ethereum: '0x9876543210987654321098765432109876543210',
      solana: Keypair.generate().publicKey.toBase58(),
    },
    principal: 1_000_000_000n,
    maxBridgeFee: 100_000n,
    minimumDestinationAmount: 999_900_000n,
    nowSeconds: 1n,
    deadline: 200n,
  });
  const message = Buffer.alloc(412);
  message.writeUInt32BE(1, 0);
  message.writeUInt32BE(fromEthereum ? 0 : 5, 4);
  message.writeUInt32BE(fromEthereum ? 5 : 0, 8);
  message.fill(1, 12, 44);
  (fromEthereum ? evm(deployment.ethereumTokenMessenger) : CCTP_TOKEN_MESSENGER.toBuffer()).copy(
    message,
    44,
  );
  (fromEthereum ? CCTP_TOKEN_MESSENGER.toBuffer() : evm(deployment.ethereumTokenMessenger)).copy(
    message,
    76,
  );
  message.writeUInt32BE(2000, 140);
  message.writeUInt32BE(2000, 144);
  message.writeUInt32BE(1, 148);
  (fromEthereum ? evm(ETHEREUM_USDC) : SOLANA_USDC.toBuffer()).copy(message, 152);
  Buffer.from(plan.mintRecipient.slice(2), 'hex').copy(message, 184);
  message.writeBigUInt64BE(plan.principal, 240);
  (fromEthereum ? evm(deployment.ethereumSourceRouter) : solanaUser.publicKey.toBuffer()).copy(
    message,
    248,
  );
  message.writeBigUInt64BE(plan.maxBridgeFee, 304);
  message.writeBigUInt64BE(1000n, 336);
  Buffer.from('BNS1').copy(message, 376);
  Buffer.from(plan.intentId.slice(2), 'hex').copy(message, 380);
  // Deliberately NOT an authentic Circle signature: these tests exercise construction/field binding only.
  const attestation = `0x${'11'.repeat(130)}` as Hex;
  const args = { plan, deployment, message: `0x${message.toString('hex')}` as Hex, attestation };
  return { args, raw: message };
}

test('destination mint binds the original intent, source sender, token, recipient, domains and bounded Circle fee', () => {
  for (const direction of [ETHEREUM, SOLANA] as const) {
    const { args } = fixture(direction);
    const bound = bindCctpMintMessage(args);
    assert.equal(bound.expectedReceivedAmount, 999_999_000n);
    assert.equal(bound.circleFee, 1000n);
    for (const offset of [
      0, 4, 8, 44, 76, 108, 140, 144, 148, 152, 184, 216, 248, 280, 312, 344, 376, 380,
    ]) {
      const bad = Buffer.from(args.message.slice(2), 'hex');
      bad[offset] ^= 1;
      // Executed finality >= 2000 is legal; make it unfinalized explicitly.
      if (offset === 144) bad.writeUInt32BE(1000, 144);
      assert.throws(
        () => bindCctpMintMessage({ ...args, message: `0x${bad.toString('hex')}` }),
        /DOES_NOT_MATCH/,
      );
    }
    assert.throws(() => bindCctpMintMessage({ ...args, attestation: '0x1234' }));
  }
});

test('Circle polling selects the bound intent among other source messages and rejects ambiguous complete transfers', async () => {
  for (const direction of [ETHEREUM, SOLANA] as const) {
    const { args } = fixture(direction);
    const entry = {
      status: 'complete',
      cctpVersion: 2,
      message: args.message,
      attestation: args.attestation,
    };
    const options = {
      plan: args.plan,
      deployment,
      sourceTransactionId: direction === ETHEREUM ? `0x${'22'.repeat(32)}` : '2'.repeat(88),
    };
    const result = await pollCircleAttestation({
      ...options,
      fetcher: async () =>
        new Response(JSON.stringify({ messages: [{ ...entry, message: '0x00' }, entry] })),
    });
    assert.equal(result.status, 'READY');
    if (result.status === 'READY') assert.equal(result.bound.plan.intentId, args.plan.intentId);
    await assert.rejects(
      pollCircleAttestation({
        ...options,
        fetcher: async () => new Response(JSON.stringify({ messages: [entry, entry] })),
      }),
      /AMBIGUOUS/,
    );
  }
});

test('Ethereum destination calls only receiveMessage and charges no new platform fee', () => {
  const { args } = fixture(SOLANA);
  const bound = bindCctpMintMessage(args);
  const transaction = prepareEthereumCctpMint(bound);
  assert.equal(transaction.to, deployment.ethereumMessageTransmitter);
  assert.equal(transaction.from, ethereumUser);
  assert.equal(transaction.value, '0x0');
  const decoded = decodeFunctionData({
    abi: parseAbi(['function receiveMessage(bytes message, bytes attestation) returns (bool)']),
    data: transaction.data,
  });
  assert.deepEqual(decoded.args, [bound.message, bound.attestation]);
  assert.throws(() =>
    prepareEthereumCctpMint({ ...bound, ethereumMessageTransmitter: ethereumUser }),
  );
});

test('Solana destination creates the user ATA and supplies the exact v2 receive accounts without a platform fee transfer', () => {
  const { args } = fixture(ETHEREUM);
  const bound = bindCctpMintMessage(args);
  const circleFeeRecipient = Keypair.generate().publicKey;
  const instructions = solanaCctpMintInstructions({ bound, circleFeeRecipient });
  assert.equal(instructions.length, 2);
  assert.equal(instructions.filter((ix) => ix.programId.equals(TOKEN_PROGRAM)).length, 0);
  const mint = instructions[1];
  assert.equal(mint.programId.toBase58(), CCTP_MESSAGE_TRANSMITTER.toBase58());
  assert.equal(mint.keys.length, 20);
  assert.equal(
    mint.keys[14].pubkey.toBase58(),
    associatedUsdcAccount(circleFeeRecipient).toBase58(),
  );
  assert.equal(
    mint.keys[15].pubkey.toBase58(),
    associatedUsdcAccount(solanaUser.publicKey).toBase58(),
  );
  const addresses = [
    ...new Map(
      instructions
        .flatMap((ix) => ix.keys)
        .filter((key) => !key.isSigner)
        .map((key) => [key.pubkey.toBase58(), key.pubkey]),
    ).values(),
  ];
  const table = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: MAX_U64,
      lastExtendedSlot: 1,
      lastExtendedSlotStartIndex: 0,
      addresses,
    },
  });
  const transaction = prepareSolanaCctpMint({
    bound,
    circleFeeRecipient,
    blockhash: Keypair.generate().publicKey.toBase58(),
    lookupTables: [table],
  });
  assert.ok(transaction.serialize().length <= 1232);
  transaction.sign([solanaUser]);
  assert.ok(verifySignedSolanaDestination(transaction, transaction).length <= 1232);
  const message = TransactionMessage.decompile(transaction.message, {
    addressLookupTableAccounts: [table],
  });
  assert.ok(message.instructions[1].data.equals(mint.data));
});

test('destination Ethereum calldata supplies the net CCTP amount into the configured router with no source fee', () => {
  const bound = bindCctpMintMessage(fixture(SOLANA).args);
  const tx = prepareEthereumCctpMintAndSupply({
    bound,
    supplyRouter: ethereumUser,
    minimumATokens: bound.expectedReceivedAmount,
  });
  const decoded = decodeFunctionData({ abi: AAVE_SUPPLY_ROUTER_ABI, data: tx.data });
  assert.equal(decoded.functionName, 'mintAndSupply');
  assert.deepEqual(decoded.args, [
    bound.message,
    bound.attestation,
    bound.expectedReceivedAmount,
    bound.expectedReceivedAmount,
  ]);
  assert.throws(() =>
    prepareEthereumCctpMintAndSupply({
      bound,
      supplyRouter: '0x0000000000000000000000000000000000000000',
      minimumATokens: 1n,
    }),
  );
});

test('Solana destination combines CCTP mint and net USDC reserve supply; cTokens belong to the user', () => {
  const bound = bindCctpMintMessage(fixture(ETHEREUM).args);
  const circleFeeRecipient = Keypair.generate().publicKey;
  const supplyIxs = kaminoUsdcSupplyInstructions({
    user: solanaUser.publicKey,
    principal: bound.expectedReceivedAmount,
  });
  const supply = supplyIxs[1];
  assert.equal(supply.programId.toBase58(), KAMINO_PROGRAM.toBase58());
  // Official generated IDL discriminator, compared independently of the builder's name hash.
  assert.deepEqual([...supply.data.subarray(0, 8)], [169, 201, 30, 126, 6, 205, 102, 68]);
  assert.equal(supply.data.readBigUInt64LE(8), bound.expectedReceivedAmount);
  assert.equal(supply.keys[1].pubkey.toBase58(), KAMINO_USDC_RESERVE.toBase58());
  assert.equal(supply.keys[2].pubkey.toBase58(), KAMINO_MARKET.toBase58());
  assert.equal(supply.keys[5].pubkey.toBase58(), KAMINO_LIQUIDITY_VAULT.toBase58());
  assert.equal(supply.keys[6].pubkey.toBase58(), KAMINO_COLLATERAL_MINT.toBase58());
  assert.equal(
    supply.keys[7].pubkey.toBase58(),
    associatedUsdcAccount(solanaUser.publicKey).toBase58(),
  );
  assert.equal(supplyIxs[0].keys[2].pubkey.toBase58(), solanaUser.publicKey.toBase58());
  assert.equal(supply.keys[8].pubkey.toBase58(), supplyIxs[0].keys[1].pubkey.toBase58());
  assert.throws(() => kaminoUsdcSupplyInstructions({ user: PublicKey.default, principal: 1n }));
  const all = [...solanaCctpMintInstructions({ bound, circleFeeRecipient }), ...supplyIxs];
  const addresses = [
    ...new Map(
      all
        .flatMap((ix) => ix.keys)
        .filter((key) => !key.isSigner)
        .map((key) => [key.pubkey.toBase58(), key.pubkey]),
    ).values(),
  ];
  const table = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: MAX_U64,
      lastExtendedSlot: 1,
      lastExtendedSlotStartIndex: 0,
      addresses,
    },
  });
  const prepare = () =>
    prepareSolanaCctpMintAndSupply({
      bound,
      circleFeeRecipient,
      blockhash: Keypair.generate().publicKey.toBase58(),
      lookupTables: [table],
      computeUnits: 800_000,
    });
  const tx = prepare();
  assert.throws(() => verifySignedSolanaDestination(tx, tx), /SIGNATURE/);
  tx.sign([solanaUser]);
  assert.ok(verifySignedSolanaDestination(tx, tx).length <= 1232);
  const message = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: [table] });
  assert.equal(message.instructions.length, 5);
  assert.equal(message.instructions[2].programId.toBase58(), CCTP_MESSAGE_TRANSMITTER.toBase58());
  assert.ok(message.instructions[4].data.equals(supply.data));
  message.instructions.pop();
  const tampered = new VersionedTransaction(message.compileToV0Message([table]));
  tampered.sign([solanaUser]);
  assert.throws(() => verifySignedSolanaDestination(tx, tampered), /MISMATCH/);
  const modifiedInPlace = prepare();
  modifiedInPlace.message.compiledInstructions.pop();
  modifiedInPlace.sign([solanaUser]);
  assert.throws(() => verifySignedSolanaDestination(modifiedInPlace, modifiedInPlace), /MISMATCH/);
});
