import { webcrypto } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createDevnetSignInMessage,
  SOLANA_DEVNET_CHAIN,
  verifySolanaOwnership,
  type DevnetSignInInput,
  type SolanaSignInResult,
  type SolanaSignMessageResult,
} from '../src/solana';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const NOW = Date.parse('2026-08-18T22:00:00.000Z');
const subtle = webcrypto.subtle as unknown as SubtleCrypto;

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.every((byte) => byte === 0)) return '1'.repeat(bytes.length);
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeroes = 0;
  while (bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return (
    '1'.repeat(leadingZeroes) +
    digits
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit])
      .join('')
  );
}

async function createSigningAccount() {
  const keyPair = (await subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
  return { keyPair, publicKey, address: encodeBase58(publicKey) };
}

function signInInput(address: string): DevnetSignInInput {
  return {
    domain: '127.0.0.1:4173',
    address,
    statement: 'Prove control of this devnet account.',
    uri: 'http://127.0.0.1:4173/wallet-lab',
    version: '1',
    chainId: SOLANA_DEVNET_CHAIN,
    nonce: 'nonce12345678',
    issuedAt: new Date(NOW).toISOString(),
    expirationTime: new Date(NOW + 5 * 60_000).toISOString(),
    notBefore: new Date(NOW - 1_000).toISOString(),
    requestId: 'request-solana-1',
    resources: ['http://127.0.0.1:4173/wallet-lab/policy'],
  };
}

async function signInProof(
  input: DevnetSignInInput,
  keyPair: CryptoKeyPair,
  publicKey: Uint8Array,
): Promise<SolanaSignInResult> {
  const signedMessage = createDevnetSignInMessage(input);
  const signature = new Uint8Array(
    await subtle.sign(
      { name: 'Ed25519' },
      keyPair.privateKey,
      Uint8Array.from(signedMessage).buffer,
    ),
  );
  return {
    method: 'solana:signIn',
    chain: SOLANA_DEVNET_CHAIN,
    address: input.address,
    account: { address: input.address, publicKey },
    signedMessage,
    signature,
    signatureType: 'ed25519',
  };
}

describe('Solana ownership verification', () => {
  it('constructs the published SIWS field order and verifies its exact Ed25519 proof', async () => {
    const { keyPair, publicKey, address } = await createSigningAccount();
    const input = signInInput(address);
    const result = await signInProof(input, keyPair, publicKey);

    expect(new TextDecoder().decode(result.signedMessage)).toBe(
      `${input.domain} wants you to sign in with your Solana account:\n` +
        `${address}\n\n` +
        `${input.statement}\n\n` +
        `URI: ${input.uri}\n` +
        `Version: 1\n` +
        `Chain ID: solana:devnet\n` +
        `Nonce: ${input.nonce}\n` +
        `Issued At: ${input.issuedAt}\n` +
        `Expiration Time: ${input.expirationTime}\n` +
        `Not Before: ${input.notBefore}\n` +
        `Request ID: ${input.requestId}\n` +
        `Resources:\n- ${input.resources?.[0]}`,
    );
    await expect(
      verifySolanaOwnership(
        {
          method: 'solana:signIn',
          expectedOrigin: 'http://127.0.0.1:4173',
          input,
          result,
        },
        { now: NOW, subtle },
      ),
    ).resolves.toEqual({
      status: 'locally-verified',
      reason: null,
      method: 'solana:signIn',
      chain: SOLANA_DEVNET_CHAIN,
      address,
    });
  });

  it('blocks changed SIWS fields, origins, time windows, and signatures', async () => {
    const { keyPair, publicKey, address } = await createSigningAccount();
    const input = signInInput(address);
    const result = await signInProof(input, keyPair, publicKey);
    const verify = (
      requestInput: DevnetSignInInput,
      expectedOrigin = 'http://127.0.0.1:4173',
      now = NOW,
      proof = result,
    ) =>
      verifySolanaOwnership(
        {
          method: 'solana:signIn',
          expectedOrigin,
          input: requestInput,
          result: proof,
        },
        { now, subtle },
      );

    await expect(verify({ ...input, nonce: 'changed123456' })).resolves.toMatchObject({
      status: 'blocked',
      reason: 'message_mismatch',
    });
    await expect(verify(input, 'http://127.0.0.1:4174')).resolves.toMatchObject({
      status: 'blocked',
      reason: 'origin_mismatch',
    });
    await expect(
      verify({
        ...input,
        domain: 'localhost:4173',
        uri: 'http://localhost:4173/wallet-lab',
      }),
    ).resolves.toMatchObject({ status: 'blocked', reason: 'origin_mismatch' });
    await expect(verify(input, undefined, NOW + 5 * 60_000)).resolves.toMatchObject({
      status: 'blocked',
      reason: 'expired',
    });

    const invalidSignature = Uint8Array.from(result.signature);
    invalidSignature[0] = (invalidSignature[0] ?? 0) ^ 1;
    await expect(
      verify(input, undefined, undefined, { ...result, signature: invalidSignature }),
    ).resolves.toMatchObject({ status: 'blocked', reason: 'invalid_signature' });
  });

  it('verifies the exact sign-message fallback and blocks unavailable crypto', async () => {
    const { keyPair, publicKey, address } = await createSigningAccount();
    const signedMessage = new TextEncoder().encode('exact server-issued devnet challenge');
    const signature = new Uint8Array(
      await subtle.sign(
        { name: 'Ed25519' },
        keyPair.privateKey,
        Uint8Array.from(signedMessage).buffer,
      ),
    );
    const result: SolanaSignMessageResult = {
      method: 'solana:signMessage',
      chain: SOLANA_DEVNET_CHAIN,
      address,
      account: { address, publicKey },
      signedMessage: Uint8Array.from(signedMessage),
      signature,
      signatureType: 'ed25519',
    };
    const request = {
      method: 'solana:signMessage' as const,
      expectedAddress: address,
      expectedMessage: signedMessage,
      result,
    };

    const verification = verifySolanaOwnership(request, { subtle });
    result.signature.fill(0);
    await expect(verification).resolves.toMatchObject({
      status: 'locally-verified',
      address,
    });
    await expect(verifySolanaOwnership(request, { subtle: null })).resolves.toMatchObject({
      status: 'blocked',
      reason: 'crypto_unavailable',
    });
  });
});
