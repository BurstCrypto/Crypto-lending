import { createHash } from 'node:crypto';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from '@solana/web3.js';
import { encodeFunctionData, isAddress, parseAbi, type Address, type Hex } from 'viem';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  ETHEREUM,
  SOLANA,
  ETHEREUM_USDC,
  SOLANA_USDC,
  TOKEN_PROGRAM,
  assertSourceBridgePlan,
  associatedUsdcAccount,
  type SourceBridgePlan,
} from './source-plan.ts';
import { CCTP_MESSAGE_TRANSMITTER, CCTP_TOKEN_MESSENGER } from './solana-source.ts';
import { rememberSolanaDestination } from './solana-destination-verification.ts';

export interface CctpDeployment {
  readonly ethereumTokenMessenger: Address;
  readonly ethereumMessageTransmitter: Address;
  readonly ethereumSourceRouter: Address;
}

function evmBytes(address: Address): Buffer {
  if (!isAddress(address) || /^0x0{40}$/iu.test(address))
    throw new Error('INVALID_DEPLOYMENT_ADDRESS');
  return Buffer.from(address.slice(2).padStart(64, '0'), 'hex');
}
function hexBytes(value: Hex, minimum: number, maximum: number): Buffer {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})+$/iu.test(value))
    throw new Error('INVALID_MESSAGE_ENCODING');
  const bytes = Buffer.from(value.slice(2), 'hex');
  if (bytes.length < minimum || bytes.length > maximum) throw new Error('INVALID_MESSAGE_LENGTH');
  return bytes;
}

export interface BoundCctpMessage {
  readonly plan: SourceBridgePlan;
  readonly message: Hex;
  readonly attestation: Hex;
  readonly nonce: Hex;
  readonly expectedReceivedAmount: bigint;
  readonly circleFee: bigint;
  readonly ethereumMessageTransmitter: Address;
}
const boundMessages = new WeakSet<BoundCctpMessage>();

export function assertBoundCctpMessage(bound: BoundCctpMessage): void {
  if (!boundMessages.has(bound)) throw new Error('UNVALIDATED_CCTP_MESSAGE');
}

/**
 * Checks all transfer fields and the intent hook. This is NOT signature/finality evidence.
 * Circle's destination MessageTransmitter authenticates the attestation on chain.
 * The caller must first match the source receipt and request attestation by that transaction ID.
 */
export function bindCctpMintMessage(input: {
  plan: SourceBridgePlan;
  deployment: CctpDeployment;
  message: Hex;
  attestation: Hex;
}): BoundCctpMessage {
  const { plan, deployment } = input;
  assertSourceBridgePlan(plan);
  evmBytes(deployment.ethereumMessageTransmitter);
  const message = hexBytes(input.message, 412, 412); // v2 header + burn body + BNS1/intentId hook.
  const attestation = hexBytes(input.attestation, 65, 65 * 10);
  if (attestation.length % 65 !== 0) throw new Error('INVALID_ATTESTATION_LENGTH');
  const fromEthereum = plan.sourceNetwork === ETHEREUM;
  const messenger = evmBytes(deployment.ethereumTokenMessenger);
  const sourceSender = fromEthereum
    ? evmBytes(deployment.ethereumSourceRouter)
    : new PublicKey(plan.sourceWallet).toBuffer();
  const sourceToken = fromEthereum ? evmBytes(ETHEREUM_USDC) : SOLANA_USDC.toBuffer();
  const equal = (start: number, expected: Buffer) =>
    message.subarray(start, start + expected.length).equals(expected);
  const uint256 = (offset: number) =>
    BigInt(`0x${message.subarray(offset, offset + 32).toString('hex')}`);
  const circleFee = uint256(312);
  if (
    message.readUInt32BE(0) !== 1 ||
    message.readUInt32BE(148) !== 1 ||
    message.readUInt32BE(4) !== (fromEthereum ? 0 : 5) ||
    message.readUInt32BE(8) !== (fromEthereum ? 5 : 0) ||
    message.subarray(12, 44).every((byte) => byte === 0) ||
    !equal(44, fromEthereum ? messenger : CCTP_TOKEN_MESSENGER.toBuffer()) ||
    !equal(76, fromEthereum ? CCTP_TOKEN_MESSENGER.toBuffer() : messenger) ||
    !equal(108, Buffer.alloc(32)) ||
    message.readUInt32BE(140) !== 2000 ||
    message.readUInt32BE(144) < 2000 ||
    !equal(152, sourceToken) ||
    !equal(184, Buffer.from(plan.mintRecipient.slice(2), 'hex')) ||
    uint256(216) !== plan.principal ||
    !equal(248, sourceSender) ||
    uint256(280) !== plan.maxBridgeFee ||
    circleFee > plan.maxBridgeFee ||
    plan.principal - circleFee < plan.minimumDestinationAmount ||
    uint256(344) !== 0n ||
    !equal(376, Buffer.from('BNS1')) ||
    !equal(380, Buffer.from(plan.intentId.slice(2), 'hex'))
  ) {
    throw new Error('CCTP_MESSAGE_DOES_NOT_MATCH_INTENT');
  }
  const bound = Object.freeze({
    plan,
    message: input.message,
    attestation: input.attestation,
    nonce: `0x${message.subarray(12, 44).toString('hex')}` as Hex,
    expectedReceivedAmount: plan.principal - circleFee,
    circleFee,
    ethereumMessageTransmitter: deployment.ethereumMessageTransmitter,
  });
  boundMessages.add(bound);
  return bound;
}

export function prepareEthereumCctpMint(bound: BoundCctpMessage) {
  if (!boundMessages.has(bound) || bound.plan.destinationNetwork !== ETHEREUM)
    throw new Error('INVALID_MINT_DIRECTION');
  return Object.freeze({
    from: bound.plan.destinationWallet as Address,
    to: bound.ethereumMessageTransmitter,
    chainId: '0x1' as const,
    value: '0x0' as const,
    data: encodeFunctionData({
      abi: parseAbi(['function receiveMessage(bytes message, bytes attestation) returns (bool)']),
      functionName: 'receiveMessage',
      args: [bound.message, bound.attestation],
    }),
  });
}

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
const pda = (program: PublicKey, ...seeds: (string | Buffer)[]) =>
  PublicKey.findProgramAddressSync(
    seeds.map((seed) => (typeof seed === 'string' ? Buffer.from(seed) : seed)),
    program,
  )[0];

/** No Bonsai fee instruction on the destination chain. Circle's fee is bounded by the original burn. */
export function solanaCctpMintInstructions(input: {
  bound: BoundCctpMessage;
  circleFeeRecipient: PublicKey;
}): readonly TransactionInstruction[] {
  const { bound } = input;
  if (!boundMessages.has(bound) || bound.plan.destinationNetwork !== SOLANA)
    throw new Error('INVALID_MINT_DIRECTION');
  const owner = new PublicKey(bound.plan.destinationWallet);
  const recipient = associatedUsdcAccount(owner);
  const message = Buffer.from(bound.message.slice(2), 'hex');
  const attestation = Buffer.from(bound.attestation.slice(2), 'hex');
  const data = Buffer.alloc(16 + message.length + attestation.length);
  createHash('sha256').update('global:receive_message').digest().copy(data, 0, 0, 8);
  data.writeUInt32LE(message.length, 8);
  message.copy(data, 12);
  data.writeUInt32LE(attestation.length, 12 + message.length);
  attestation.copy(data, 16 + message.length);
  const createRecipient = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    data: Buffer.from([1]),
    keys: [
      meta(owner, true, true),
      meta(recipient, true),
      meta(owner),
      meta(SOLANA_USDC),
      meta(SystemProgram.programId),
      meta(TOKEN_PROGRAM),
    ],
  });
  const mint = new TransactionInstruction({
    programId: CCTP_MESSAGE_TRANSMITTER,
    data,
    keys: [
      meta(owner, true, true),
      meta(owner, false, true),
      meta(
        pda(
          CCTP_MESSAGE_TRANSMITTER,
          'message_transmitter_authority',
          CCTP_TOKEN_MESSENGER.toBuffer(),
        ),
      ),
      meta(pda(CCTP_MESSAGE_TRANSMITTER, 'message_transmitter')),
      meta(pda(CCTP_MESSAGE_TRANSMITTER, 'used_nonce', message.subarray(12, 44)), true),
      meta(CCTP_TOKEN_MESSENGER),
      meta(SystemProgram.programId),
      meta(pda(CCTP_MESSAGE_TRANSMITTER, '__event_authority')),
      meta(CCTP_MESSAGE_TRANSMITTER),
      // Receiver's remaining accounts, including BOTH Circle's fee ATA and the user's ATA.
      meta(pda(CCTP_TOKEN_MESSENGER, 'token_messenger')),
      meta(pda(CCTP_TOKEN_MESSENGER, 'remote_token_messenger', '0')),
      meta(pda(CCTP_TOKEN_MESSENGER, 'token_minter')),
      meta(pda(CCTP_TOKEN_MESSENGER, 'local_token', SOLANA_USDC.toBuffer()), true),
      meta(pda(CCTP_TOKEN_MESSENGER, 'token_pair', '0', evmBytes(ETHEREUM_USDC))),
      meta(associatedUsdcAccount(input.circleFeeRecipient), true),
      meta(recipient, true),
      meta(pda(CCTP_TOKEN_MESSENGER, 'custody', SOLANA_USDC.toBuffer()), true),
      meta(TOKEN_PROGRAM),
      meta(pda(CCTP_TOKEN_MESSENGER, '__event_authority')),
      meta(CCTP_TOKEN_MESSENGER),
    ],
  });
  return [createRecipient, mint];
}

export function prepareSolanaCctpMint(input: {
  bound: BoundCctpMessage;
  blockhash: string;
  circleFeeRecipient: PublicKey;
  lookupTables: readonly AddressLookupTableAccount[];
}): VersionedTransaction {
  const owner = new PublicKey(input.bound.plan.destinationWallet);
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: owner,
      recentBlockhash: input.blockhash,
      instructions: [...solanaCctpMintInstructions(input)],
    }).compileToV0Message([...input.lookupTables]),
  );
  if (transaction.serialize().length > 1232) throw new Error('DESTINATION_LOOKUP_TABLE_REQUIRED');
  return rememberSolanaDestination(transaction);
}
