import {
  parseIssueWalletOwnershipChallengeBody,
  parseSubmitWalletOwnershipProofBody,
  WalletRegistrationBodyError,
} from './wallet-registration-body';

const CHALLENGE_ID = '11111111-1111-4111-8111-111111111111';
const SOLANA_ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function encodedBytes(length: number, byte = 1): string {
  return Buffer.alloc(length, byte).toString('base64url');
}

function evmProof(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    kind: 'EVM_EIP191_EOA',
    challengeId: CHALLENGE_ID,
    message: 'exact server-authored message',
    signature: `0x${'ab'.repeat(65)}`,
    ...overrides,
  };
}

function solanaProof(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    kind: 'SOLANA_ED25519',
    challengeId: CHALLENGE_ID,
    address: SOLANA_ADDRESS,
    publicKey: encodedBytes(32),
    signedMessage: encodedBytes(24, 2),
    signature: encodedBytes(64, 3),
    ...overrides,
  };
}

function expectBodyRejection(value: unknown, submit = true): void {
  const parse = submit
    ? parseSubmitWalletOwnershipProofBody
    : parseIssueWalletOwnershipChallengeBody;
  expect(() => parse(value)).toThrow(WalletRegistrationBodyError);
}

describe('wallet registration HTTP body parsing', () => {
  describe('challenge requests', () => {
    it('accepts and snapshots only the exact two-field request', () => {
      const input = Object.assign(Object.create(null) as Record<string, unknown>, {
        chainId: 'eip155:11155111',
        address: '0xde709f2102306220921060314715629080e2fb77',
      });

      const parsed = parseIssueWalletOwnershipChallengeBody(input);

      expect(parsed).toEqual(input);
      expect(Object.isFrozen(parsed)).toBe(true);
      input.address = 'attacker mutation after parse';
      expect(parsed.address).toBe('0xde709f2102306220921060314715629080e2fb77');
    });

    it.each([null, undefined, [], 'text', 1, {}, { chainId: 'eip155:1' }])(
      'rejects non-records and incomplete records',
      (value) => expectBodyRejection(value, false),
    );

    it('rejects unknown, symbol, inherited, and accessor properties without invoking getters', () => {
      const getter = jest.fn(() => 'eip155:1');
      const accessor = {
        address: '0xde709f2102306220921060314715629080e2fb77',
      } as Record<string, unknown>;
      Object.defineProperty(accessor, 'chainId', { enumerable: true, get: getter });
      const inherited = Object.create({ inherited: true }) as Record<string, unknown>;
      inherited.chainId = 'eip155:1';
      inherited.address = '0xde709f2102306220921060314715629080e2fb77';
      const symbol = {
        chainId: 'eip155:1',
        address: '0xde709f2102306220921060314715629080e2fb77',
        [Symbol('hidden')]: 'value',
      };

      for (const value of [
        { chainId: 'eip155:1', address: 'value', unknown: true },
        accessor,
        inherited,
        symbol,
      ]) {
        expectBodyRejection(value, false);
      }
      expect(getter).not.toHaveBeenCalled();
    });

    it('rejects arrays, controls, and overlong text fields', () => {
      for (const value of [
        { chainId: ['eip155:1'], address: 'value' },
        { chainId: 'eip155:1', address: ['value'] },
        { chainId: 'eip155:1\r', address: 'value' },
        { chainId: 'eip155:1', address: `a${'b'.repeat(128)}` },
      ]) {
        expectBodyRejection(value, false);
      }
    });
  });

  describe('EVM proofs', () => {
    it('accepts only an exact canonical EIP-191 EOA wire shape', () => {
      const parsed = parseSubmitWalletOwnershipProofBody(evmProof());

      expect(parsed).toEqual(evmProof());
      expect(Object.isFrozen(parsed)).toBe(true);
    });

    it.each([
      evmProof({ unknown: true }),
      evmProof({ challengeId: 'not-a-uuid' }),
      evmProof({ message: [] }),
      evmProof({ message: `m${'x'.repeat(4_096)}` }),
      evmProof({ signature: '0x01' }),
      evmProof({ signature: `0X${'ab'.repeat(65)}` }),
      evmProof({ signature: `0x${'AB'.repeat(65)}` }),
      evmProof({ signature: `0x${'gg'.repeat(65)}` }),
      evmProof({ signature: [`0x${'ab'.repeat(65)}`] }),
    ])('rejects non-canonical or out-of-bounds proof fields', (value) => {
      expectBodyRejection(value);
    });

    it('rejects accessors without executing attacker-controlled code', () => {
      const getter = jest.fn(() => 'EVM_EIP191_EOA');
      const value = evmProof();
      Object.defineProperty(value, 'kind', { enumerable: true, get: getter });

      expectBodyRejection(value);
      expect(getter).not.toHaveBeenCalled();
    });
  });

  describe('Solana proofs', () => {
    it('decodes canonical, unpadded base64url fields into bounded byte arrays', () => {
      const parsed = parseSubmitWalletOwnershipProofBody(solanaProof());

      expect(parsed).toMatchObject({
        kind: 'SOLANA_ED25519',
        challengeId: CHALLENGE_ID,
        address: SOLANA_ADDRESS,
      });
      if (parsed.kind !== 'SOLANA_ED25519') throw new Error('unexpected proof kind');
      expect(parsed.publicKey).toEqual(Uint8Array.from(Buffer.alloc(32, 1)));
      expect(parsed.signedMessage).toEqual(Uint8Array.from(Buffer.alloc(24, 2)));
      expect(parsed.signature).toEqual(Uint8Array.from(Buffer.alloc(64, 3)));
      expect(Object.isFrozen(parsed)).toBe(true);
    });

    it('accepts exactly 4,096 signed-message bytes and rejects empty or larger payloads', () => {
      const maximum = parseSubmitWalletOwnershipProofBody(
        solanaProof({ signedMessage: encodedBytes(4_096, 4) }),
      );
      if (maximum.kind !== 'SOLANA_ED25519') throw new Error('unexpected proof kind');
      expect(maximum.signedMessage).toHaveLength(4_096);

      expectBodyRejection(solanaProof({ signedMessage: '' }));
      expectBodyRejection(solanaProof({ signedMessage: encodedBytes(4_097, 4) }));
    });

    it.each([
      solanaProof({ unknown: true }),
      solanaProof({ challengeId: 'not-a-uuid' }),
      solanaProof({ address: 'not-base58' }),
      solanaProof({ publicKey: encodedBytes(31) }),
      solanaProof({ publicKey: encodedBytes(33) }),
      solanaProof({ publicKey: `${encodedBytes(32)}=` }),
      solanaProof({ publicKey: '+' + encodedBytes(31) }),
      solanaProof({ publicKey: [encodedBytes(32)] }),
      solanaProof({ signature: encodedBytes(63) }),
      solanaProof({ signature: encodedBytes(65) }),
      solanaProof({ signature: `${encodedBytes(64)}=` }),
      solanaProof({ signedMessage: ['not-a-string'] }),
    ])('rejects malformed, non-canonical, or incorrectly sized fields', (value) => {
      expectBodyRejection(value);
    });
  });
});
