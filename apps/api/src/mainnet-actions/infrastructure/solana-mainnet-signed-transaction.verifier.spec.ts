import {
  AddressLookupTableAccount,
  Keypair,
  MessageV0,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import {
  SolanaMainnetSignedTransactionVerificationError,
  verifySolanaMainnetSignedTransaction,
  type VerifiedSolanaMainnetSignedTransaction,
} from './solana-mainnet-signed-transaction.verifier';
import {
  decodeCanonicalSolanaPublicKey,
  encodeSolanaBase58,
} from './solana-mainnet-public-key.codec';

const WALLET = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const SECOND_SIGNER = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 33));
const PROGRAM = Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 77)).publicKey;
const ACCOUNT = Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 88)).publicKey;
const BLOCKHASH = new PublicKey(Uint8Array.from({ length: 32 }, () => 99)).toBase58();

function instruction(extraSigner?: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM,
    keys: [
      { pubkey: WALLET.publicKey, isSigner: true, isWritable: true },
      { pubkey: ACCOUNT, isSigner: false, isWritable: true },
      ...(extraSigner === undefined
        ? []
        : [{ pubkey: extraSigner, isSigner: true, isWritable: false }]),
    ],
    data: Buffer.from('0123456789abcdef', 'hex'),
  });
}

function signedWire(version: 'legacy' | 0 = 'legacy'): string {
  const builder = new TransactionMessage({
    payerKey: WALLET.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [instruction()],
  });
  const message =
    version === 'legacy' ? builder.compileToLegacyMessage() : builder.compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([WALLET]);
  return Buffer.from(transaction.serialize()).toString('base64');
}

function verify(
  wire: string,
  wallet = WALLET.publicKey.toBase58(),
): VerifiedSolanaMainnetSignedTransaction {
  return verifySolanaMainnetSignedTransaction({
    signedTransactionBase64: wire,
    expectedWalletAddress: wallet,
  });
}

describe('Solana mainnet signed-transaction verifier', () => {
  it('matches SDK public-key encoding including zero prefixes and rejects noncanonical keys', () => {
    for (let leadingZeros = 0; leadingZeros <= 32; leadingZeros += 1) {
      const bytes = Uint8Array.from({ length: 32 }, (_, index) =>
        index < leadingZeros ? 0 : index + 1,
      );
      const address = new PublicKey(bytes).toBase58();
      expect(encodeSolanaBase58(bytes)).toBe(address);
      expect(decodeCanonicalSolanaPublicKey(address)).toEqual(Buffer.from(bytes));
      expect(() => decodeCanonicalSolanaPublicKey('1' + address)).toThrow();
    }
    expect(() => decodeCanonicalSolanaPublicKey('z'.repeat(44))).toThrow();
  });

  it.each(['legacy', 0] as const)(
    'rejects every truncated %s message, trailing bytes and overlong vectors',
    (version) => {
      const wire = Buffer.from(signedWire(version), 'base64');
      for (let length = 0; length < wire.length; length += 1) {
        expect(() => verify(wire.subarray(0, length).toString('base64'))).toThrow();
      }
      for (const prefix of [
        [0x81, 0],
        [0x81, 0x80, 0],
        [0xff, 0xff, 0x04],
      ]) {
        const overlong = Buffer.concat([Buffer.from(prefix), wire.subarray(1)]);
        expect(() => verify(overlong.toString('base64'))).toThrow(
          expect.objectContaining({ code: 'INVALID_SOLANA_SIGNED_TRANSACTION' }),
        );
      }
      expect(() => verify(Buffer.concat([wire, Buffer.from([0])]).toString('base64'))).toThrow();
      const accountLengthOffset = 65 + (version === 0 ? 1 : 0) + 3;
      const overlongAccountLength = Buffer.concat([
        wire.subarray(0, accountLengthOffset),
        Buffer.from([(wire[accountLengthOffset] ?? 0) | 0x80, 0]),
        wire.subarray(accountLengthOffset + 1),
      ]);
      expect(() => verify(overlongAccountLength.toString('base64'))).toThrow(
        expect.objectContaining({ code: 'INVALID_SOLANA_SIGNED_TRANSACTION' }),
      );
    },
  );

  it.each(['legacy', 0] as const)(
    'verifies a canonical complete %s wire transaction and every required signature',
    (version) => {
      const result = verify(signedWire(version));
      expect(result).toMatchObject({
        kind: 'VERIFIED_SOLANA_SIGNED_TRANSACTION',
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        messageVersion: version,
        signerWalletAddress: WALLET.publicKey.toBase58(),
        recentBlockhash: BLOCKHASH,
        instructions: [
          {
            programId: PROGRAM.toBase58(),
            accounts: [
              {
                address: WALLET.publicKey.toBase58(),
                isSigner: true,
                isWritable: true,
              },
              { address: ACCOUNT.toBase58(), isSigner: false, isWritable: true },
            ],
            dataHex: '0123456789abcdef',
          },
        ],
      });
      expect(result.transactionId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/u);
      expect(result.signedEnvelopeSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(result.signingPayloadSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(result.signatureEvidenceSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(Object.isFrozen(result.instructions[0]?.accounts)).toBe(true);
    },
  );

  it('rejects a wrong fee payer, altered signature, noncanonical base64, and unknown version', () => {
    const wire = signedWire(0);
    expect(() => verify(wire, SECOND_SIGNER.publicKey.toBase58())).toThrow(
      expect.objectContaining({ code: 'SOLANA_SIGNER_MISMATCH' }),
    );

    const altered = VersionedTransaction.deserialize(Buffer.from(wire, 'base64'));
    const signature = altered.signatures[0];
    if (signature === undefined) throw new Error('fixture signature missing');
    signature[0] = (signature[0] ?? 0) ^ 1;
    expect(() => verify(Buffer.from(altered.serialize()).toString('base64'))).toThrow(
      expect.objectContaining({ code: 'INVALID_SOLANA_SIGNED_TRANSACTION' }),
    );
    expect(() => verify(`${wire}\n`)).toThrow(SolanaMainnetSignedTransactionVerificationError);

    const unknownVersion = Buffer.from(wire, 'base64');
    unknownVersion[65] = 0x81;
    expect(() => verify(unknownVersion.toString('base64'))).toThrow(
      expect.objectContaining({ code: 'INVALID_SOLANA_SIGNED_TRANSACTION' }),
    );
  });

  it('rejects additional signers, address lookup tables, and durable nonce transactions', () => {
    const multisignerMessage = new TransactionMessage({
      payerKey: WALLET.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: [instruction(SECOND_SIGNER.publicKey)],
    }).compileToV0Message();
    const multisigner = new VersionedTransaction(multisignerMessage);
    multisigner.sign([WALLET, SECOND_SIGNER]);
    expect(() => verify(Buffer.from(multisigner.serialize()).toString('base64'))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_SOLANA_TRANSACTION' }),
    );

    const lookup = new AddressLookupTableAccount({
      key: Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 44)).publicKey,
      state: {
        deactivationSlot: BigInt('18446744073709551615'),
        lastExtendedSlot: 1,
        lastExtendedSlotStartIndex: 0,
        authority: WALLET.publicKey,
        addresses: [ACCOUNT],
      },
    });
    const lookupMessage = new TransactionMessage({
      payerKey: WALLET.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: [
        new TransactionInstruction({
          programId: PROGRAM,
          keys: [{ pubkey: ACCOUNT, isSigner: false, isWritable: true }],
          data: Buffer.from([1]),
        }),
      ],
    }).compileToV0Message([lookup]);
    const lookupTransaction = new VersionedTransaction(lookupMessage);
    lookupTransaction.sign([WALLET]);
    expect(() => verify(Buffer.from(lookupTransaction.serialize()).toString('base64'))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_SOLANA_TRANSACTION' }),
    );

    const nonceMessage = new TransactionMessage({
      payerKey: WALLET.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: [
        SystemProgram.nonceAdvance({ noncePubkey: ACCOUNT, authorizedPubkey: WALLET.publicKey }),
      ],
    }).compileToLegacyMessage();
    const nonceTransaction = new VersionedTransaction(nonceMessage);
    nonceTransaction.sign([WALLET]);
    expect(() => verify(Buffer.from(nonceTransaction.serialize()).toString('base64'))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_SOLANA_TRANSACTION' }),
    );
  });

  it('rejects unused static keys and invalid small-order signer keys', () => {
    const unusedKeyMessage = new MessageV0({
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 2,
      },
      staticAccountKeys: [WALLET.publicKey, PROGRAM, ACCOUNT],
      recentBlockhash: BLOCKHASH,
      compiledInstructions: [
        { programIdIndex: 1, accountKeyIndexes: [0], data: Uint8Array.from([1]) },
      ],
      addressTableLookups: [],
    });
    const unusedKeyTransaction = new VersionedTransaction(unusedKeyMessage);
    unusedKeyTransaction.sign([WALLET]);
    expect(() => verify(Buffer.from(unusedKeyTransaction.serialize()).toString('base64'))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_SOLANA_TRANSACTION' }),
    );

    const identityEncoding = new Uint8Array(32);
    identityEncoding[0] = 1;
    const smallOrderSigner = new PublicKey(identityEncoding);
    const smallOrderMessage = new MessageV0({
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 1,
      },
      staticAccountKeys: [smallOrderSigner, PROGRAM],
      recentBlockhash: BLOCKHASH,
      compiledInstructions: [
        { programIdIndex: 1, accountKeyIndexes: [0], data: Uint8Array.from([1]) },
      ],
      addressTableLookups: [],
    });
    const smallOrderTransaction = new VersionedTransaction(smallOrderMessage, [
      Uint8Array.from({ length: 64 }, () => 1),
    ]);
    expect(() =>
      verify(
        Buffer.from(smallOrderTransaction.serialize()).toString('base64'),
        smallOrderSigner.toBase58(),
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_SOLANA_SIGNED_TRANSACTION' }));
  });
});
