const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const SOLANA_PUBLIC_KEY_BYTES = 32;
const SPL_TOKEN_ACCOUNT_BYTES = 165;
const TOKEN_2022_ACCOUNT_TYPE_OFFSET = SPL_TOKEN_ACCOUNT_BYTES;
const TOKEN_2022_ACCOUNT_TYPE = 2;
export const MAX_SOLANA_TOKEN_ACCOUNT_BYTES = 4_096;

export const SOLANA_TOKEN_PROGRAM_IDS = Object.freeze({
  LEGACY: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
} as const);

export type SolanaTokenProgramId =
  (typeof SOLANA_TOKEN_PROGRAM_IDS)[keyof typeof SOLANA_TOKEN_PROGRAM_IDS];

export type SolanaTokenAccountState = 'UNINITIALIZED' | 'ACTIVE' | 'FROZEN';

export type SolanaTokenAccountValidationCode =
  | 'INVALID_PUBLIC_KEY'
  | 'INVALID_TOKEN_PROGRAM'
  | 'INVALID_ACCOUNT_DATA'
  | 'INVALID_ACCOUNT_LENGTH'
  | 'INVALID_ACCOUNT_TYPE'
  | 'INVALID_COPTION'
  | 'INVALID_ACCOUNT_STATE'
  | 'OWNER_MISMATCH';

export class SolanaTokenAccountValidationError extends Error {
  constructor(readonly code: SolanaTokenAccountValidationCode) {
    super(code);
    this.name = 'SolanaTokenAccountValidationError';
  }
}

export interface ParsedSolanaTokenAccount {
  readonly mint: string;
  readonly owner: string;
  readonly amountBaseUnits: bigint;
  readonly state: SolanaTokenAccountState;
  readonly tokenProgramId: SolanaTokenProgramId;
}

export interface ParseSolanaTokenAccountInput {
  readonly data: Uint8Array;
  readonly tokenProgramId: string;
  readonly expectedOwner?: string;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value) && value instanceof Uint8Array;
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

function encodeBase58(bytes: Uint8Array): string {
  let numericValue = 0n;
  for (const byte of bytes) numericValue = numericValue * 256n + BigInt(byte);

  let encoded = '';
  while (numericValue > 0n) {
    const remainder = Number(numericValue % 58n);
    encoded = `${BASE58_ALPHABET[remainder]}${encoded}`;
    numericValue /= 58n;
  }

  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return `${'1'.repeat(leadingZeroes)}${encoded}`;
}

export function decodeSolanaPublicKey(publicKey: string): Uint8Array {
  if (typeof publicKey !== 'string' || publicKey.length < 32 || publicKey.length > 44) {
    throw new SolanaTokenAccountValidationError('INVALID_PUBLIC_KEY');
  }

  let numericValue = 0n;
  for (const character of publicKey) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) throw new SolanaTokenAccountValidationError('INVALID_PUBLIC_KEY');
    numericValue = numericValue * 58n + BigInt(digit);
  }

  const reversedBytes: number[] = [];
  while (numericValue > 0n) {
    reversedBytes.push(Number(numericValue % 256n));
    numericValue /= 256n;
  }

  const leadingZeroes = publicKey.match(/^1*/u)?.[0].length ?? 0;
  const decoded = Uint8Array.from([
    ...new Array<number>(leadingZeroes).fill(0),
    ...reversedBytes.reverse(),
  ]);
  if (
    decoded.length !== SOLANA_PUBLIC_KEY_BYTES ||
    isZero(decoded) ||
    encodeBase58(decoded) !== publicKey
  ) {
    throw new SolanaTokenAccountValidationError('INVALID_PUBLIC_KEY');
  }
  return decoded;
}

export function normalizeSolanaPublicKey(publicKey: string): string {
  return encodeBase58(decodeSolanaPublicKey(publicKey));
}

function readPublicKey(data: Uint8Array, offset: number): string {
  const bytes = data.slice(offset, offset + SOLANA_PUBLIC_KEY_BYTES);
  if (isZero(bytes)) throw new SolanaTokenAccountValidationError('INVALID_PUBLIC_KEY');
  return encodeBase58(bytes);
}

function validateCOption(data: Uint8Array, offset: number, valueBytes: number): void {
  const discriminator = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    offset,
    true,
  );
  if (discriminator !== 0 && discriminator !== 1) {
    throw new SolanaTokenAccountValidationError('INVALID_COPTION');
  }
  if (discriminator === 0 && !isZero(data.subarray(offset + 4, offset + 4 + valueBytes))) {
    throw new SolanaTokenAccountValidationError('INVALID_COPTION');
  }
}

function validateLayout(data: Uint8Array, tokenProgramId: SolanaTokenProgramId): void {
  if (tokenProgramId === SOLANA_TOKEN_PROGRAM_IDS.LEGACY) {
    if (data.length !== SPL_TOKEN_ACCOUNT_BYTES) {
      throw new SolanaTokenAccountValidationError('INVALID_ACCOUNT_LENGTH');
    }
    return;
  }

  if (data.length < SPL_TOKEN_ACCOUNT_BYTES || data.length > MAX_SOLANA_TOKEN_ACCOUNT_BYTES) {
    throw new SolanaTokenAccountValidationError('INVALID_ACCOUNT_LENGTH');
  }
  if (data.length === SPL_TOKEN_ACCOUNT_BYTES) return;
  if (data[TOKEN_2022_ACCOUNT_TYPE_OFFSET] !== TOKEN_2022_ACCOUNT_TYPE) {
    throw new SolanaTokenAccountValidationError('INVALID_ACCOUNT_TYPE');
  }
}

function normalizeTokenProgramId(tokenProgramId: string): SolanaTokenProgramId {
  if (tokenProgramId === SOLANA_TOKEN_PROGRAM_IDS.LEGACY) return tokenProgramId;
  if (tokenProgramId === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022) return tokenProgramId;
  throw new SolanaTokenAccountValidationError('INVALID_TOKEN_PROGRAM');
}

function parseState(state: number | undefined): SolanaTokenAccountState {
  if (state === 0) return 'UNINITIALIZED';
  if (state === 1) return 'ACTIVE';
  if (state === 2) return 'FROZEN';
  throw new SolanaTokenAccountValidationError('INVALID_ACCOUNT_STATE');
}

export function parseSolanaTokenAccount(
  input: ParseSolanaTokenAccountInput,
): ParsedSolanaTokenAccount {
  if (!isUint8Array(input.data)) {
    throw new SolanaTokenAccountValidationError('INVALID_ACCOUNT_DATA');
  }

  const tokenProgramId = normalizeTokenProgramId(input.tokenProgramId);
  const data = Uint8Array.from(input.data);
  validateLayout(data, tokenProgramId);
  validateCOption(data, 72, 32);
  validateCOption(data, 109, 8);
  validateCOption(data, 129, 32);

  const owner = readPublicKey(data, 32);
  if (
    input.expectedOwner !== undefined &&
    owner !== normalizeSolanaPublicKey(input.expectedOwner)
  ) {
    throw new SolanaTokenAccountValidationError('OWNER_MISMATCH');
  }

  return Object.freeze({
    mint: readPublicKey(data, 0),
    owner,
    amountBaseUnits: new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(
      64,
      true,
    ),
    state: parseState(data[108]),
    tokenProgramId,
  });
}
