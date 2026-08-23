import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as signNodeMessage,
  type KeyObject,
} from 'node:crypto';

import { hashMessage, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

import { parseAccountId } from '../../accounts/domain/account-profile';
import {
  createWalletOwnershipChallenge,
  hashWalletChallengeNonce,
  hashWalletOwnershipMessage,
  parseWalletChallengeId,
  parseWalletChallengeNonce,
  parseWalletDigest,
  parseWalletOrigin,
  parseWalletOwnershipChallengeRecord,
  parseWalletUri,
  verifyWalletOwnershipProof,
  WalletOwnershipValidationError,
  type CreatedWalletOwnershipChallenge,
  type Erc1271ContractSignatureVerifierPort,
  type WalletOwnershipProof,
  type WalletOwnershipVerificationRequest,
} from './wallet-ownership-proof';
import {
  parseEvmWalletAddress,
  parseSolanaWalletAddress,
  parseWalletChainId,
} from './wallet-identity';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const NOW = Date.parse('2026-08-22T18:00:00.000Z');
const CHALLENGE_ID = parseWalletChallengeId('123e4567-e89b-42d3-a456-426614174000');
const OTHER_CHALLENGE_ID = parseWalletChallengeId('423e4567-e89b-42d3-a456-426614174001');
const NONCE = parseWalletChallengeNonce('ab'.repeat(32));
const ORIGIN = parseWalletOrigin('http://127.0.0.1:3000');
const URI = parseWalletUri('http://127.0.0.1:3000/wallets/ownership', ORIGIN);
const ACCOUNT_ID = parseAccountId('7b119930-99b8-4f32-960a-723ffa216e01');
const OTHER_ACCOUNT_ID = parseAccountId('7b119930-99b8-4f32-960a-723ffa216e02');
function subjectBinding(
  challengeId = CHALLENGE_ID,
  accountId = ACCOUNT_ID,
): ReturnType<typeof parseWalletDigest<'subject-binding'>> {
  return parseWalletDigest<'subject-binding'>(
    createHash('sha256')
      .update(JSON.stringify([accountId, challengeId]), 'utf8')
      .digest('hex'),
  );
}

function createEvmAccount(): PrivateKeyAccount {
  for (;;) {
    try {
      return privateKeyToAccount(`0x${randomBytes(32).toString('hex')}` as Hex);
    } catch {
      // The invalid secp256k1 scalar range is vanishingly small, but stay deterministic on failure.
    }
  }
}

function evmChallenge(address: string): CreatedWalletOwnershipChallenge {
  return createWalletOwnershipChallenge({
    challengeId: CHALLENGE_ID,
    subjectBindingDigest: subjectBinding(),
    chainId: parseWalletChainId('eip155:11155111'),
    address: parseEvmWalletAddress(address),
    origin: ORIGIN,
    uri: URI,
    operation: 'REGISTER_WALLET',
    nonce: NONCE,
    issuedAtEpochMilliseconds: NOW,
    expiresAtEpochMilliseconds: NOW + 5 * 60_000,
  });
}

function encodeBase58(value: Uint8Array): string {
  const littleEndianDigits = [0];
  for (const byte of value) {
    let carry = byte;
    for (let index = 0; index < littleEndianDigits.length; index += 1) {
      carry += (littleEndianDigits[index] ?? 0) << 8;
      littleEndianDigits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      littleEndianDigits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeroBytes = 0;
  while (value[leadingZeroBytes] === 0) leadingZeroBytes += 1;
  const significantDigits =
    littleEndianDigits.length === 1 && littleEndianDigits[0] === 0 ? [] : littleEndianDigits;
  return (
    '1'.repeat(leadingZeroBytes) +
    significantDigits
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit] ?? '')
      .join('')
  );
}

function createSolanaAccount(): Readonly<{
  privateKey: KeyObject;
  publicKey: Uint8Array;
  address: string;
}> {
  const pair = generateKeyPairSync('ed25519');
  const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
  const publicKey = Uint8Array.from(spki.subarray(spki.length - 32));
  return { privateKey: pair.privateKey, publicKey, address: encodeBase58(publicKey) };
}

function solanaChallenge(address: string): CreatedWalletOwnershipChallenge {
  return createWalletOwnershipChallenge({
    challengeId: CHALLENGE_ID,
    subjectBindingDigest: subjectBinding(),
    chainId: parseWalletChainId('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
    address: parseSolanaWalletAddress(address),
    origin: ORIGIN,
    uri: URI,
    operation: 'REGISTER_WALLET',
    nonce: NONCE,
    issuedAtEpochMilliseconds: NOW,
    expiresAtEpochMilliseconds: NOW + 5 * 60_000,
  });
}

function request(
  created: CreatedWalletOwnershipChallenge,
  proof: WalletOwnershipProof,
  overrides: Partial<WalletOwnershipVerificationRequest> = {},
): WalletOwnershipVerificationRequest {
  return {
    record: created.record,
    proof,
    expectedSubjectBindingDigest: created.record.subjectBindingDigest,
    expectedOrigin: created.record.origin,
    expectedOperation: 'REGISTER_WALLET',
    challengeState: 'PENDING',
    nowEpochMilliseconds: NOW + 1_000,
    ...overrides,
  };
}

describe('wallet ownership challenge construction', () => {
  it('constructs exact canonical SIWE with decimal EIP-155 chain reference and opaque binding', () => {
    const created = evmChallenge('0xde709f2102306220921060314715629080e2fb77');

    expect(created.publicChallenge.message).toBe(
      `127.0.0.1:3000 wants you to sign in with your Ethereum account:\n` +
        `0xde709f2102306220921060314715629080e2fb77\n\n` +
        `Verify this wallet for Crypto Lending. This proof does not authorize login, transactions, transfers, or loans.\n\n` +
        `URI: http://127.0.0.1:3000/wallets/ownership\n` +
        `Version: 1\n` +
        `Chain ID: 11155111\n` +
        `Nonce: ${NONCE}\n` +
        `Issued At: 2026-08-22T18:00:00.000Z\n` +
        `Expiration Time: 2026-08-22T18:05:00.000Z\n` +
        `Not Before: 2026-08-22T18:00:00.000Z\n` +
        `Request ID: ${CHALLENGE_ID}\n` +
        `Resources:\n` +
        `- urn:crypto-lending:wallet-ownership:v1\n` +
        `- urn:crypto-lending:wallet-subject-binding:hmac-sha-256:${subjectBinding()}\n` +
        `- urn:crypto-lending:wallet-operation:register-wallet`,
    );
    expect(created.publicChallenge).toMatchObject({
      version: 1,
      messageFormat: 'SIWE',
      chainId: 'eip155:11155111',
      expiresAt: '2026-08-22T18:05:00.000Z',
    });
    expect(created.record.nonceDigest).toBe(hashWalletChallengeNonce(NONCE));
    expect(created.record.messageDigest).toBe(
      hashWalletOwnershipMessage(created.publicChallenge.message),
    );
  });

  it('returns a persistence record containing neither raw nonce nor message', () => {
    const created = evmChallenge('0xde709f2102306220921060314715629080e2fb77');
    const persisted = JSON.stringify(created.record);

    expect(persisted).not.toContain(NONCE);
    expect(persisted).not.toContain('wants you to sign in');
    expect(Object.hasOwn(created.record, 'nonce')).toBe(false);
    expect(Object.hasOwn(created.record, 'message')).toBe(false);
    expect(Object.isFrozen(created.record)).toBe(true);
    expect(Object.isFrozen(created.publicChallenge)).toBe(true);
  });

  it('binds each challenge to an opaque account-specific digest', () => {
    const first = subjectBinding();
    expect(first).toBe(subjectBinding());
    expect(first).not.toBe(subjectBinding(CHALLENGE_ID, OTHER_ACCOUNT_ID));
    expect(first).not.toBe(subjectBinding(OTHER_CHALLENGE_ID));
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('fails closed on malformed IDs, non-CSPRNG nonce shapes, origins, URIs, and TTLs', () => {
    expect(() => parseWalletChallengeId(CHALLENGE_ID.toUpperCase())).toThrow(
      WalletOwnershipValidationError,
    );
    expect(() => parseWalletChallengeNonce('g0'.repeat(32))).toThrow(
      WalletOwnershipValidationError,
    );
    expect(() => parseWalletDigest('A'.repeat(64))).toThrow(WalletOwnershipValidationError);
    expect(() => parseWalletOrigin('http://example.com')).toThrow(WalletOwnershipValidationError);
    expect(() => parseWalletOrigin(['https://', 'user', '@', 'example.com'].join(''))).toThrow(
      WalletOwnershipValidationError,
    );
    expect(() => parseWalletUri('http://localhost:3000/#fragment', ORIGIN)).toThrow(
      WalletOwnershipValidationError,
    );

    const valid = evmChallenge('0xde709f2102306220921060314715629080e2fb77');
    expect(() =>
      createWalletOwnershipChallenge({
        ...valid.record,
        nonce: NONCE,
        expiresAtEpochMilliseconds: NOW + 5 * 60_000 + 1,
      }),
    ).toThrow(WalletOwnershipValidationError);
  });

  it('strictly rehydrates only a closed, self-consistent persistence shape', () => {
    const created = evmChallenge('0xde709f2102306220921060314715629080e2fb77');
    expect(parseWalletOwnershipChallengeRecord({ ...created.record })).toEqual(created.record);
    expect(() => parseWalletOwnershipChallengeRecord({ ...created.record, ignored: true })).toThrow(
      WalletOwnershipValidationError,
    );
    expect(() =>
      parseWalletOwnershipChallengeRecord({
        ...created.record,
        accountId: 'eip155:1:0xde709f2102306220921060314715629080e2fb77',
      }),
    ).toThrow(WalletOwnershipValidationError);

    let getterCalled = false;
    const exotic = { ...created.record } as Record<string, unknown>;
    Object.defineProperty(exotic, 'nonceDigest', {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return created.record.nonceDigest;
      },
    });
    expect(() => parseWalletOwnershipChallengeRecord(exotic)).toThrow(
      WalletOwnershipValidationError,
    );
    expect(getterCalled).toBe(false);
  });

  it('rejects accessor-bearing or open challenge-construction inputs without invoking them', () => {
    let getterCalled = false;
    const input = {
      challengeId: CHALLENGE_ID,
      subjectBindingDigest: subjectBinding(),
      chainId: parseWalletChainId('eip155:11155111'),
      address: parseEvmWalletAddress('0xde709f2102306220921060314715629080e2fb77'),
      origin: ORIGIN,
      uri: URI,
      operation: 'REGISTER_WALLET' as const,
      nonce: NONCE,
      issuedAtEpochMilliseconds: NOW,
      expiresAtEpochMilliseconds: NOW + 60_000,
    };
    Object.defineProperty(input, 'nonce', {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return NONCE;
      },
    });
    expect(() => createWalletOwnershipChallenge(input)).toThrow(WalletOwnershipValidationError);
    expect(getterCalled).toBe(false);
    expect(() => createWalletOwnershipChallenge({ ...input, unexpected: true } as never)).toThrow(
      WalletOwnershipValidationError,
    );
  });
});

describe('EVM EIP-191 wallet ownership verification', () => {
  it('recovers the exact EOA that signed the canonical SIWE challenge', async () => {
    const account = createEvmAccount();
    const created = evmChallenge(account.address);
    const signature = await account.signMessage({ message: created.publicChallenge.message });

    await expect(
      verifyWalletOwnershipProof(
        request(created, {
          kind: 'EVM_EIP191_EOA',
          challengeId: CHALLENGE_ID,
          message: created.publicChallenge.message,
          signature,
        }),
      ),
    ).resolves.toEqual({
      status: 'VERIFIED',
      challengeId: CHALLENGE_ID,
      proofKind: 'EVM_EIP191_EOA',
      chainId: 'eip155:11155111',
      address: account.address.toLowerCase(),
      accountId: `eip155:11155111:${account.address.toLowerCase()}`,
      messageDigest: created.record.messageDigest,
    });

    const recoveryByte = Number.parseInt(signature.slice(-2), 16);
    const zeroBasedRecoveryByte = recoveryByte >= 27 ? recoveryByte - 27 : recoveryByte;
    const zeroBasedSignature = `${signature.slice(0, -2)}${zeroBasedRecoveryByte
      .toString(16)
      .padStart(2, '0')}`;
    await expect(
      verifyWalletOwnershipProof(
        request(created, {
          kind: 'EVM_EIP191_EOA',
          challengeId: CHALLENGE_ID,
          message: created.publicChallenge.message,
          signature: zeroBasedSignature,
        }),
      ),
    ).resolves.toMatchObject({ status: 'VERIFIED', address: account.address.toLowerCase() });
  });

  it('rejects wrong keys, mutated messages, malformed signatures, and challenge substitution', async () => {
    const account = createEvmAccount();
    const wrongAccount = createEvmAccount();
    const created = evmChallenge(account.address);
    const signature = await account.signMessage({ message: created.publicChallenge.message });
    const wrongSignature = await wrongAccount.signMessage({
      message: created.publicChallenge.message,
    });
    const proof = {
      kind: 'EVM_EIP191_EOA' as const,
      challengeId: CHALLENGE_ID,
      message: created.publicChallenge.message,
      signature,
    };

    await expect(
      verifyWalletOwnershipProof(request(created, { ...proof, signature: wrongSignature })),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'SIGNATURE_INVALID' });
    await expect(
      verifyWalletOwnershipProof(request(created, { ...proof, message: `${proof.message} ` })),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'MESSAGE_MISMATCH' });
    await expect(
      verifyWalletOwnershipProof(
        request(created, { ...proof, signature: signature.toUpperCase() }),
      ),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'MALFORMED_REQUEST' });
    await expect(
      verifyWalletOwnershipProof(request(created, { ...proof, challengeId: OTHER_CHALLENGE_ID })),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'BINDING_MISMATCH' });
  });

  it('rejects high-s malleable signatures before recovery', async () => {
    const account = createEvmAccount();
    const created = evmChallenge(account.address);
    const signature = await account.signMessage({ message: created.publicChallenge.message });
    const order = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
    const s = BigInt(`0x${signature.slice(66, 130)}`);
    const highS = (order - s).toString(16).padStart(64, '0');
    const highSignature = `${signature.slice(0, 66)}${highS}${signature.slice(130)}`;

    await expect(
      verifyWalletOwnershipProof(
        request(created, {
          kind: 'EVM_EIP191_EOA',
          challengeId: CHALLENGE_ID,
          message: created.publicChallenge.message,
          signature: highSignature,
        }),
      ),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'MALFORMED_REQUEST' });
  });
});

describe('Solana Ed25519 wallet ownership verification', () => {
  it('verifies exact canonical SIWS bytes against the address-bound public key', async () => {
    const account = createSolanaAccount();
    const created = solanaChallenge(account.address);
    const signedMessage = new TextEncoder().encode(created.publicChallenge.message);
    const signature = Uint8Array.from(
      signNodeMessage(null, Buffer.from(signedMessage), account.privateKey),
    );

    expect(created.publicChallenge.message).toContain(
      'Chain ID: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    );
    await expect(
      verifyWalletOwnershipProof(
        request(created, {
          kind: 'SOLANA_ED25519',
          challengeId: CHALLENGE_ID,
          address: parseSolanaWalletAddress(account.address),
          publicKey: account.publicKey,
          signedMessage,
          signature,
        }),
      ),
    ).resolves.toMatchObject({
      status: 'VERIFIED',
      proofKind: 'SOLANA_ED25519',
      address: account.address,
    });
  });

  it('snapshots byte inputs and rejects key, message, and signature substitution', async () => {
    const account = createSolanaAccount();
    const wrongAccount = createSolanaAccount();
    const created = solanaChallenge(account.address);
    const signedMessage = new TextEncoder().encode(created.publicChallenge.message);
    const signature = Uint8Array.from(
      signNodeMessage(null, Buffer.from(signedMessage), account.privateKey),
    );
    const proof = {
      kind: 'SOLANA_ED25519' as const,
      challengeId: CHALLENGE_ID,
      address: parseSolanaWalletAddress(account.address),
      publicKey: Uint8Array.from(account.publicKey),
      signedMessage: Uint8Array.from(signedMessage),
      signature: Uint8Array.from(signature),
    };

    const verification = verifyWalletOwnershipProof(request(created, proof));
    proof.signature.fill(0);
    proof.signedMessage.fill(0);
    proof.publicKey.fill(0);
    await expect(verification).resolves.toMatchObject({ status: 'VERIFIED' });

    await expect(
      verifyWalletOwnershipProof(
        request(created, {
          ...proof,
          publicKey: wrongAccount.publicKey,
          signedMessage,
          signature,
        }),
      ),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'SIGNATURE_INVALID' });

    const changedMessage = Uint8Array.from(signedMessage);
    changedMessage[0] = (changedMessage[0] ?? 0) ^ 1;
    await expect(
      verifyWalletOwnershipProof(
        request(created, { ...proof, signedMessage: changedMessage, signature }),
      ),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'MESSAGE_MISMATCH' });

    const changedSignature = Uint8Array.from(signature);
    changedSignature[0] = (changedSignature[0] ?? 0) ^ 1;
    await expect(
      verifyWalletOwnershipProof(
        request(created, { ...proof, signedMessage, signature: changedSignature }),
      ),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'SIGNATURE_INVALID' });
  });

  it('rejects typed-array subclasses without invoking attacker-controlled iteration', async () => {
    const account = createSolanaAccount();
    const created = solanaChallenge(account.address);
    let iteratorCalled = false;
    class ExoticBytes extends Uint8Array {
      override [Symbol.iterator](): ArrayIterator<number> {
        iteratorCalled = true;
        return super[Symbol.iterator]();
      }
    }
    const signedMessage = new ExoticBytes(
      new TextEncoder().encode(created.publicChallenge.message),
    );
    const signature = Uint8Array.from(
      signNodeMessage(null, Buffer.from(signedMessage), account.privateKey),
    );

    await expect(
      verifyWalletOwnershipProof(
        request(created, {
          kind: 'SOLANA_ED25519',
          challengeId: CHALLENGE_ID,
          address: parseSolanaWalletAddress(account.address),
          publicKey: account.publicKey,
          signedMessage,
          signature,
        }),
      ),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'MALFORMED_REQUEST' });
    expect(iteratorCalled).toBe(false);
  });
});

describe('wallet ownership binding, replay, and ERC-1271 gates', () => {
  it('rejects wrong user, wrong origin, replayed, not-yet-valid, and expired challenges', async () => {
    const account = createEvmAccount();
    const created = evmChallenge(account.address);
    const signature = await account.signMessage({ message: created.publicChallenge.message });
    const proof = {
      kind: 'EVM_EIP191_EOA' as const,
      challengeId: CHALLENGE_ID,
      message: created.publicChallenge.message,
      signature,
    };

    await expect(
      verifyWalletOwnershipProof(
        request(created, proof, {
          expectedSubjectBindingDigest: subjectBinding(CHALLENGE_ID, OTHER_ACCOUNT_ID),
        }),
      ),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'BINDING_MISMATCH' });
    await expect(
      verifyWalletOwnershipProof(
        request(created, proof, { expectedOrigin: parseWalletOrigin('http://localhost:3000') }),
      ),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'BINDING_MISMATCH' });
    await expect(
      verifyWalletOwnershipProof(request(created, proof, { challengeState: 'CONSUMED' })),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'CHALLENGE_REPLAYED' });
    await expect(
      verifyWalletOwnershipProof(request(created, proof, { nowEpochMilliseconds: NOW - 1 })),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'CHALLENGE_NOT_YET_VALID' });
    await expect(
      verifyWalletOwnershipProof(
        request(created, proof, { nowEpochMilliseconds: NOW + 5 * 60_000 }),
      ),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'CHALLENGE_EXPIRED' });
  });

  it('fails ERC-1271 closed without a verifier and accepts only an explicit valid decision', async () => {
    const created = evmChallenge('0xde709f2102306220921060314715629080e2fb77');
    const proof = {
      kind: 'EVM_ERC1271' as const,
      challengeId: CHALLENGE_ID,
      message: created.publicChallenge.message,
      signature: '0x1234',
    };

    await expect(verifyWalletOwnershipProof(request(created, proof))).resolves.toEqual({
      status: 'REJECTED',
      reason: 'CONTRACT_VERIFICATION_UNAVAILABLE',
    });

    const verifier: Erc1271ContractSignatureVerifierPort = {
      verify: jest.fn().mockResolvedValue('VALID'),
    };
    await expect(
      verifyWalletOwnershipProof(request(created, proof), { erc1271Verifier: verifier }),
    ).resolves.toMatchObject({ status: 'VERIFIED', proofKind: 'EVM_ERC1271' });
    expect(verifier.verify).toHaveBeenCalledWith({
      challengeId: CHALLENGE_ID,
      chainId: 'eip155:11155111',
      contractAddress: created.record.address,
      eip191MessageHash: hashMessage(created.publicChallenge.message),
      signature: '0x1234',
    });

    verifier.verify = jest.fn().mockResolvedValue('INVALID');
    await expect(
      verifyWalletOwnershipProof(request(created, proof), { erc1271Verifier: verifier }),
    ).resolves.toEqual({ status: 'REJECTED', reason: 'SIGNATURE_INVALID' });
    verifier.verify = jest.fn().mockRejectedValue(new Error('provider detail must be sanitized'));
    await expect(
      verifyWalletOwnershipProof(request(created, proof), { erc1271Verifier: verifier }),
    ).resolves.toEqual({
      status: 'REJECTED',
      reason: 'CONTRACT_VERIFICATION_UNAVAILABLE',
    });
  });

  it('does not invoke accessor payloads or echo a nonce, message, or signature on failure', async () => {
    const created = evmChallenge('0xde709f2102306220921060314715629080e2fb77');
    let getterCalled = false;
    const proof = {
      kind: 'EVM_EIP191_EOA',
      challengeId: CHALLENGE_ID,
      signature: `0x${'01'.repeat(65)}`,
    } as Record<string, unknown>;
    Object.defineProperty(proof, 'message', {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return created.publicChallenge.message;
      },
    });

    const result = await verifyWalletOwnershipProof(
      request(created, proof as unknown as WalletOwnershipProof),
    );
    expect(result).toEqual({ status: 'REJECTED', reason: 'MALFORMED_REQUEST' });
    expect(getterCalled).toBe(false);
    expect(JSON.stringify(result)).not.toContain(NONCE);
    expect(JSON.stringify(result)).not.toContain(created.publicChallenge.message);
    expect(JSON.stringify(result)).not.toContain(proof.signature as string);
  });
});
