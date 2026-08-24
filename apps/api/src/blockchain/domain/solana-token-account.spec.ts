import {
  decodeSolanaPublicKey,
  normalizeSolanaPublicKey,
  parseSolanaTokenAccount,
  SOLANA_TOKEN_PROGRAM_IDS,
  SolanaTokenAccountValidationError,
  type SolanaTokenProgramId,
} from './solana-token-account';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OWNER = '7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8';
const OTHER_OWNER = '3wyAj7b2zVzNRPc1K7AB5g3Zcw99oFGCBZRwBvZxr9FQ';

interface TokenAccountFixtureOptions {
  readonly programId?: SolanaTokenProgramId;
  readonly mint?: string;
  readonly owner?: string;
  readonly amount?: bigint;
  readonly state?: number;
  readonly extensionBytes?: number;
}

function tokenAccountFixture(options: TokenAccountFixtureOptions = {}): Uint8Array {
  const programId = options.programId ?? SOLANA_TOKEN_PROGRAM_IDS.LEGACY;
  const extensionBytes = options.extensionBytes ?? 8;
  const data = new Uint8Array(
    programId === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022 ? 166 + extensionBytes : 165,
  );
  data.set(decodeSolanaPublicKey(options.mint ?? USDC_MINT), 0);
  data.set(decodeSolanaPublicKey(options.owner ?? OWNER), 32);
  new DataView(data.buffer).setBigUint64(64, options.amount ?? 12_345_678_901_234_567_890n, true);
  data[108] = options.state ?? 1;
  if (programId === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022) data[165] = 2;
  return data;
}

function expectValidationCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error('Expected validation error');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SolanaTokenAccountValidationError);
    expect((error as SolanaTokenAccountValidationError).code).toBe(code);
  }
}

describe('Solana token account parsing', () => {
  it('decodes legacy SPL accounts in exact base units without Number coercion', () => {
    const account = parseSolanaTokenAccount({
      data: tokenAccountFixture(),
      tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      expectedOwner: OWNER,
    });

    expect(account).toEqual({
      mint: USDC_MINT,
      owner: OWNER,
      amountBaseUnits: 12_345_678_901_234_567_890n,
      state: 'ACTIVE',
      tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
    });
    expect(Object.isFrozen(account)).toBe(true);
  });

  it.each([
    [0, 'UNINITIALIZED'],
    [1, 'ACTIVE'],
    [2, 'FROZEN'],
  ] as const)('maps account state %i to %s', (state, expected) => {
    expect(
      parseSolanaTokenAccount({
        data: tokenAccountFixture({ state }),
        tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      }).state,
    ).toBe(expected);
  });

  it('accepts bounded Token-2022 account extensions with an account discriminator', () => {
    const account = parseSolanaTokenAccount({
      data: tokenAccountFixture({ programId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022 }),
      tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
    });

    expect(account.tokenProgramId).toBe(SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022);
    expect(account.mint).toBe(USDC_MINT);
    expect(
      parseSolanaTokenAccount({
        data: tokenAccountFixture().slice(),
        tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
      }).tokenProgramId,
    ).toBe(SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022);
  });

  it('rejects owner mismatches instead of attributing another wallet balance', () => {
    expectValidationCode(
      () =>
        parseSolanaTokenAccount({
          data: tokenAccountFixture({ owner: OTHER_OWNER }),
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
          expectedOwner: OWNER,
        }),
      'OWNER_MISMATCH',
    );
  });

  it('rejects unsupported programs, non-canonical layouts, and malformed state', () => {
    expectValidationCode(
      () =>
        parseSolanaTokenAccount({
          data: tokenAccountFixture(),
          tokenProgramId: '11111111111111111111111111111111',
        }),
      'INVALID_TOKEN_PROGRAM',
    );
    expectValidationCode(
      () =>
        parseSolanaTokenAccount({
          data: tokenAccountFixture().slice(0, 164),
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
        }),
      'INVALID_ACCOUNT_LENGTH',
    );
    expectValidationCode(
      () =>
        parseSolanaTokenAccount({
          data: tokenAccountFixture({ state: 3 }),
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
        }),
      'INVALID_ACCOUNT_STATE',
    );
    expectValidationCode(
      () =>
        parseSolanaTokenAccount({
          data: {
            length: 165,
            [Symbol.toStringTag]: 'Uint8Array',
          } as unknown as Uint8Array,
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
        }),
      'INVALID_ACCOUNT_DATA',
    );
  });

  it('rejects malformed Token-2022 discriminators and oversized extension payloads', () => {
    const wrongType = tokenAccountFixture({ programId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022 });
    wrongType[165] = 1;
    expectValidationCode(
      () =>
        parseSolanaTokenAccount({
          data: wrongType,
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
        }),
      'INVALID_ACCOUNT_TYPE',
    );
    expectValidationCode(
      () =>
        parseSolanaTokenAccount({
          data: new Uint8Array(4_097),
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
        }),
      'INVALID_ACCOUNT_LENGTH',
    );
  });

  it('validates every COption discriminator and absent-value payload', () => {
    const invalidDiscriminator = tokenAccountFixture();
    new DataView(invalidDiscriminator.buffer).setUint32(72, 2, true);
    expectValidationCode(
      () =>
        parseSolanaTokenAccount({
          data: invalidDiscriminator,
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
        }),
      'INVALID_COPTION',
    );

    const nonzeroAbsentValue = tokenAccountFixture();
    nonzeroAbsentValue[76] = 1;
    expectValidationCode(
      () =>
        parseSolanaTokenAccount({
          data: nonzeroAbsentValue,
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
        }),
      'INVALID_COPTION',
    );
  });

  it('round-trips canonical public keys and rejects zero, invalid, and non-32-byte keys', () => {
    expect(normalizeSolanaPublicKey(OWNER)).toBe(OWNER);
    expectValidationCode(
      () => decodeSolanaPublicKey('11111111111111111111111111111111'),
      'INVALID_PUBLIC_KEY',
    );
    expectValidationCode(() => decodeSolanaPublicKey('0'.repeat(32)), 'INVALID_PUBLIC_KEY');
    expectValidationCode(() => decodeSolanaPublicKey('2'.repeat(32)), 'INVALID_PUBLIC_KEY');
  });
});
