import { createHash } from 'node:crypto';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Keypair,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  SOLANA,
  SOLANA_USDC,
  TOKEN_PROGRAM,
  associatedUsdcAccount,
  assertSourceBridgePlan,
  type SourceBridgePlan,
} from './source-plan.ts';

// Circle's v2 programs are shared between mainnet and devnet. Chain admission is mandatory at the wallet/RPC boundary.
export const CCTP_MESSAGE_TRANSMITTER = new PublicKey(
  'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
);
export const CCTP_TOKEN_MESSENGER = new PublicKey('CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe');
const pda = (program: PublicKey, ...seeds: (string | Buffer)[]) =>
  PublicKey.findProgramAddressSync(
    seeds.map((seed) => (typeof seed === 'string' ? Buffer.from(seed) : seed)),
    program,
  )[0];
const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});

/** Account order/layout pinned to Circle source commit ec16e95d28ee47f7832df4203ae07b5981d146fc. */
export function cctpBurnInstruction(
  plan: SourceBridgePlan,
  eventAccount: PublicKey,
): TransactionInstruction {
  assertSourceBridgePlan(plan);
  if (plan.sourceNetwork !== SOLANA) throw new Error('WRONG_SOURCE_CHAIN');
  const owner = new PublicKey(plan.sourceWallet);
  const data = Buffer.alloc(136);
  createHash('sha256').update('global:deposit_for_burn_with_hook').digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(plan.principal, 8);
  data.writeUInt32LE(0, 16); // Circle domain 0 is Ethereum; this is NOT EVM chain ID 1.
  Buffer.from(plan.mintRecipient.slice(2), 'hex').copy(data, 20);
  // bytes 52..83: zero destinationCaller; the mint recipient remains fixed.
  data.writeBigUInt64LE(plan.maxBridgeFee, 84);
  data.writeUInt32LE(2000, 92); // Standard finality.
  data.writeUInt32LE(36, 96);
  Buffer.from('BNS1').copy(data, 100);
  Buffer.from(plan.intentId.slice(2), 'hex').copy(data, 104);
  return new TransactionInstruction({
    programId: CCTP_TOKEN_MESSENGER,
    data,
    keys: [
      meta(owner, false, true),
      meta(owner, true, true),
      meta(pda(CCTP_TOKEN_MESSENGER, 'sender_authority')),
      meta(associatedUsdcAccount(owner), true),
      meta(pda(CCTP_TOKEN_MESSENGER, 'denylist_account', owner.toBuffer())),
      meta(pda(CCTP_MESSAGE_TRANSMITTER, 'message_transmitter'), true),
      meta(pda(CCTP_TOKEN_MESSENGER, 'token_messenger')),
      meta(pda(CCTP_TOKEN_MESSENGER, 'remote_token_messenger', '0')),
      meta(pda(CCTP_TOKEN_MESSENGER, 'token_minter')),
      meta(pda(CCTP_TOKEN_MESSENGER, 'local_token', SOLANA_USDC.toBuffer()), true),
      meta(SOLANA_USDC, true),
      meta(eventAccount, true, true),
      meta(CCTP_MESSAGE_TRANSMITTER),
      meta(CCTP_TOKEN_MESSENGER),
      meta(TOKEN_PROGRAM),
      meta(SystemProgram.programId),
      meta(pda(CCTP_TOKEN_MESSENGER, '__event_authority')),
      meta(CCTP_TOKEN_MESSENGER),
    ],
  });
}

export interface PreparedSolanaBridge {
  readonly plan: SourceBridgePlan;
  readonly transaction: Transaction;
  readonly message: Uint8Array;
  readonly lastValidBlockHeight: number;
}

const preparedMessages = new WeakMap<PreparedSolanaBridge, Buffer>();

/** Builds one source transaction: treasury ATA, source USDC fee, and actual Circle burn. */
export function prepareSolanaSourceBridge(input: {
  plan: SourceBridgePlan;
  eventSigner: Keypair;
  blockhash: string;
  lastValidBlockHeight: number;
  nowSeconds: bigint;
  computeUnits: number;
  microLamportsPerComputeUnit: bigint;
}): PreparedSolanaBridge {
  const { plan } = input;
  assertSourceBridgePlan(plan);
  if (plan.sourceNetwork !== SOLANA || input.nowSeconds >= plan.deadline)
    throw new Error('INVALID_OR_EXPIRED_PLAN');
  if (
    !Number.isInteger(input.computeUnits) ||
    input.computeUnits < 1 ||
    input.computeUnits > 1_400_000 ||
    input.microLamportsPerComputeUnit < 0n ||
    (BigInt(input.computeUnits) * input.microLamportsPerComputeUnit + 999_999n) / 1_000_000n >
      1_000_000n ||
    !Number.isSafeInteger(input.lastValidBlockHeight) ||
    input.lastValidBlockHeight <= 0
  ) {
    throw new Error('INVALID_NETWORK_FEE_OR_EXPIRY');
  }
  const owner = new PublicKey(plan.sourceWallet);
  const treasury = new PublicKey(plan.treasury);
  if (owner.equals(input.eventSigner.publicKey) || treasury.equals(input.eventSigner.publicKey))
    throw new Error('INVALID_EVENT_SIGNER');
  const treasuryAta = associatedUsdcAccount(treasury);
  const transaction = new Transaction({ feePayer: owner, recentBlockhash: input.blockhash });
  transaction.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: input.computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: input.microLamportsPerComputeUnit }),
  );
  if (plan.platformFee > 0n) {
    transaction.add(
      new TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM,
        data: Buffer.from([1]), // CreateIdempotent.
        keys: [
          meta(owner, true, true),
          meta(treasuryAta, true),
          meta(treasury),
          meta(SOLANA_USDC),
          meta(SystemProgram.programId),
          meta(TOKEN_PROGRAM),
        ],
      }),
    );
    const feeData = Buffer.alloc(10);
    feeData[0] = 12; // SPL TransferChecked.
    feeData.writeBigUInt64LE(plan.platformFee, 1);
    feeData[9] = 6;
    transaction.add(
      new TransactionInstruction({
        programId: TOKEN_PROGRAM,
        data: feeData,
        keys: [
          meta(associatedUsdcAccount(owner), true),
          meta(SOLANA_USDC),
          meta(treasuryAta, true),
          meta(owner, false, true),
        ],
      }),
    );
  }
  transaction.add(cctpBurnInstruction(plan, input.eventSigner.publicKey));
  transaction.partialSign(input.eventSigner);
  const message = Uint8Array.from(transaction.serializeMessage());
  if (transaction.serialize({ requireAllSignatures: false }).length > 1232)
    throw new Error('TRANSACTION_TOO_LARGE');
  const prepared = Object.freeze({
    plan,
    transaction,
    message,
    lastValidBlockHeight: input.lastValidBlockHeight,
  });
  preparedMessages.set(prepared, Buffer.from(message));
  return prepared;
}

/** Verify BEFORE browser-side broadcast. Any fee removal, recipient change or wallet addition is rejected. */
export function verifySignedSolanaSourceBridge(
  prepared: PreparedSolanaBridge,
  signed: Transaction,
): Uint8Array {
  const expected = preparedMessages.get(prepared);
  if (
    !expected ||
    !Buffer.from(signed.serializeMessage()).equals(expected) ||
    !signed.verifySignatures()
  ) {
    throw new Error('SIGNED_SOURCE_TRANSACTION_MISMATCH');
  }
  return signed.serialize();
}
