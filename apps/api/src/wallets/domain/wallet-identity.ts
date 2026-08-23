import { isAddress } from 'viem';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const ZERO_EVM_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO_SOLANA_ADDRESS = '11111111111111111111111111111111';

export const WALLET_OWNERSHIP_CHAIN_IDS = Object.freeze([
  'eip155:1',
  'eip155:8453',
  'eip155:42161',
  'eip155:11155111',
  'eip155:84532',
  'eip155:421614',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
] as const);

export type WalletOwnershipChainId = (typeof WALLET_OWNERSHIP_CHAIN_IDS)[number];
export type WalletNamespace = 'eip155' | 'solana';

declare const evmWalletAddressBrand: unique symbol;
declare const solanaWalletAddressBrand: unique symbol;
declare const walletAccountIdBrand: unique symbol;

export type EvmWalletAddress = string & { readonly [evmWalletAddressBrand]: true };
export type SolanaWalletAddress = string & { readonly [solanaWalletAddressBrand]: true };
export type WalletAddress = EvmWalletAddress | SolanaWalletAddress;
export type WalletAccountId = string & { readonly [walletAccountIdBrand]: true };

export type WalletIdentityValidationCode =
  'INVALID_WALLET_CHAIN_ID' | 'INVALID_WALLET_ADDRESS' | 'INVALID_WALLET_ACCOUNT_ID';

export class WalletIdentityValidationError extends Error {
  constructor(readonly code: WalletIdentityValidationCode) {
    super(code);
    this.name = 'WalletIdentityValidationError';
  }
}

function isSupportedChainId(value: string): value is WalletOwnershipChainId {
  return (WALLET_OWNERSHIP_CHAIN_IDS as readonly string[]).includes(value);
}

/**
 * Parses only KAN-61 registry-bound CAIP-2 identifiers. An arbitrary syntactically
 * valid CAIP-2 value is not enough to authorize a wallet registration network.
 */
export function parseWalletChainId(value: unknown): WalletOwnershipChainId {
  if (typeof value !== 'string' || !isSupportedChainId(value)) {
    throw new WalletIdentityValidationError('INVALID_WALLET_CHAIN_ID');
  }
  return value;
}

export function walletNamespaceOf(chainId: WalletOwnershipChainId): WalletNamespace {
  return chainId.startsWith('eip155:') ? 'eip155' : 'solana';
}

function decodeBase58(value: string): Uint8Array | null {
  if (!SOLANA_ADDRESS_PATTERN.test(value)) return null;

  const littleEndianBytes = [0];
  for (const character of value) {
    let carry = BASE58_ALPHABET.indexOf(character);
    if (carry < 0) return null;
    for (let index = 0; index < littleEndianBytes.length; index += 1) {
      carry += (littleEndianBytes[index] ?? 0) * 58;
      littleEndianBytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      littleEndianBytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroBytes = 0;
  while (value[leadingZeroBytes] === '1') leadingZeroBytes += 1;
  const significantLength =
    littleEndianBytes.length === 1 && littleEndianBytes[0] === 0 ? 0 : littleEndianBytes.length;
  const decoded = new Uint8Array(leadingZeroBytes + significantLength);
  for (let index = 0; index < significantLength; index += 1) {
    decoded[decoded.length - index - 1] = littleEndianBytes[index] ?? 0;
  }
  return decoded;
}

function encodeBase58(value: Uint8Array): string {
  if (value.length === 0) return '';

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

export function parseEvmWalletAddress(value: unknown): EvmWalletAddress {
  if (
    typeof value !== 'string' ||
    !EVM_ADDRESS_PATTERN.test(value) ||
    !isAddress(value, { strict: true }) ||
    value.toLowerCase() === ZERO_EVM_ADDRESS
  ) {
    throw new WalletIdentityValidationError('INVALID_WALLET_ADDRESS');
  }
  return value.toLowerCase() as EvmWalletAddress;
}

export function parseSolanaWalletAddress(value: unknown): SolanaWalletAddress {
  if (typeof value !== 'string' || value === ZERO_SOLANA_ADDRESS) {
    throw new WalletIdentityValidationError('INVALID_WALLET_ADDRESS');
  }
  const decoded = decodeBase58(value);
  if (decoded === null || decoded.length !== 32 || encodeBase58(decoded) !== value) {
    throw new WalletIdentityValidationError('INVALID_WALLET_ADDRESS');
  }
  return value as SolanaWalletAddress;
}

export function parseWalletAddress(chainIdValue: unknown, addressValue: unknown): WalletAddress {
  const chainId = parseWalletChainId(chainIdValue);
  return walletNamespaceOf(chainId) === 'eip155'
    ? parseEvmWalletAddress(addressValue)
    : parseSolanaWalletAddress(addressValue);
}

export function formatWalletAccountId(
  chainIdValue: unknown,
  addressValue: unknown,
): WalletAccountId {
  const chainId = parseWalletChainId(chainIdValue);
  const address = parseWalletAddress(chainId, addressValue);
  return `${chainId}:${address}` as WalletAccountId;
}

export function parseWalletAccountId(value: unknown): WalletAccountId {
  if (typeof value !== 'string' || value.length > 128) {
    throw new WalletIdentityValidationError('INVALID_WALLET_ACCOUNT_ID');
  }
  for (const chainId of WALLET_OWNERSHIP_CHAIN_IDS) {
    const prefix = `${chainId}:`;
    if (!value.startsWith(prefix)) continue;
    const canonical = formatWalletAccountId(chainId, value.slice(prefix.length));
    if (canonical !== value) {
      throw new WalletIdentityValidationError('INVALID_WALLET_ACCOUNT_ID');
    }
    return canonical;
  }
  throw new WalletIdentityValidationError('INVALID_WALLET_ACCOUNT_ID');
}

/** Returns a defensive copy of the canonical 32-byte Solana public key. */
export function solanaWalletAddressBytes(addressValue: unknown): Uint8Array {
  const address = parseSolanaWalletAddress(addressValue);
  const decoded = decodeBase58(address);
  if (decoded === null || decoded.length !== 32) {
    throw new WalletIdentityValidationError('INVALID_WALLET_ADDRESS');
  }
  return Uint8Array.from(decoded);
}
