import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  parseSolanaWalletAddress,
  solanaWalletAddressBytes,
} from '../../../wallets/domain/wallet-identity';

const NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' as const;
const PROGRAM_ADDRESS = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo' as const;
const MARKET_ADDRESS = '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY' as const;
const RESERVE_ADDRESS = 'BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw' as const;
const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as const;

export const SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_VERSION = 1 as const;
export const SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_USE =
  'DORMANT_SAVE_LEND_ACCOUNT_POSITION_SUPPLIED_SNAPSHOT_ONLY' as const;

const WAD = 1_000_000_000_000_000_000n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const U192_MAX = (1n << 192n) - 1n;
const OBLIGATION_BYTES = 1_300;
const RESERVE_BYTES = 619;
const OBLIGATION_DATA_OFFSET = 204;
const OBLIGATION_DATA_BYTES = 1_096;
const COLLATERAL_ENTRY_BYTES = 88;
const BORROW_ENTRY_BYTES = 112;
const MAX_OBLIGATION_RESERVES = 10;
const MAX_SUPPLIED_OBLIGATIONS = 256;
const SHA256 = /^[0-9a-f]{64}$/u;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,19})$/u;
const ZERO_PUBLIC_KEY = new Uint8Array(32);

const ENVELOPE_KEYS = Object.freeze([
  'accountAddress',
  'ownerProgramAddress',
  'executable',
  'contextSlot',
  'space',
  'accountDataBase64',
  'accountDataSha256',
] as const);
const SNAPSHOT_KEYS = Object.freeze([
  'semanticsVersion',
  'use',
  'mayPersist',
  'mayAuthorizeFinancialAction',
  'mayEstablishCompletePosition',
  'networkId',
  'genesisHash',
  'programAddress',
  'lendingMarketAddress',
  'reserveAddress',
  'assetMintAddress',
  'assetDecimals',
  'ownerAddress',
  'commitment',
  'contextSlot',
  'finalizedRootSlot',
  'finalizedRootBlockhash',
  'accountSetStatus',
  'responseTruncated',
  'reserveAccount',
  'obligationAccounts',
] as const);

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export const SAVE_LEND_ACCOUNT_POSITION_SOURCE_PINS = frozen({
  programRepository: 'solendprotocol/solana-program-library',
  programCommitSha: 'd04ce00bbf4356c4fd32b3be38eb9760b696bb3e',
  rustObligationPath: 'token-lending/sdk/src/state/obligation.rs',
  rustObligationSha256: '836e2120836970196994becb01f03129e88cb88ec234e297e810e5f508c27b91',
  rustReservePath: 'token-lending/sdk/src/state/reserve.rs',
  rustReserveSha256: '3f470697c67ba43e12e6b61638607cf025d129c0f59884e80c58cbb2b94c7c85',
  rustStatePath: 'token-lending/sdk/src/state/mod.rs',
  rustStateSha256: '5ebfe1021ba6bb9d63c97eebbaafae2b9b4cdbc55e6605815558bd13107546a0',
  rustDecimalPath: 'token-lending/sdk/src/math/decimal.rs',
  rustDecimalSha256: '7cabaf64a733dd2891a2c8c64459f952b3a623b7e9c6eb1655024a5e0b8ffec7',
  rustMathCommonPath: 'token-lending/sdk/src/math/common.rs',
  rustMathCommonSha256: '889d649766e06bf8e5c3b86aa6d7e0f77c98bc14dfcbbe67b893cffe0bff1409',
  publicRepository: 'solendprotocol/public',
  publicCommitSha: 'b3b46ffbc2f5162b6e5680dd3cad1042c2eb3f8e',
  sdkObligationPath: 'solend-sdk/src/state/obligation.ts',
  sdkObligationSha256: '2f150df321c08739cdeb18187f6dd0c3df898f3e8b383c7f2b177f1438f6852b',
  sdkReservePath: 'solend-sdk/src/state/reserve.ts',
  sdkReserveSha256: '81e41065981ecfc3bd30508d78eb1ac9393d5d882b00ace5ada87bdb78a66b16',
});

export const SAVE_LEND_ACCOUNT_POSITION_IDENTITIES = frozen({
  networkId: NETWORK_ID,
  genesisHash: GENESIS_HASH,
  programAddress: PROGRAM_ADDRESS,
  lendingMarketAddress: MARKET_ADDRESS,
  reserveAddress: RESERVE_ADDRESS,
  usdcMintAddress: USDC_MINT_ADDRESS,
  usdcDecimals: 6 as const,
});

export const SAVE_LEND_ACCOUNT_POSITION_LAYOUT = frozen({
  obligation: frozen({
    accountBytes: OBLIGATION_BYTES,
    supportedVersion: 1,
    versionOffset: 0,
    lastUpdateSlotOffset: 1,
    lastUpdateStaleOffset: 9,
    lendingMarketOffset: 10,
    ownerOffset: 42,
    depositsLengthOffset: 202,
    borrowsLengthOffset: 203,
    dataOffset: OBLIGATION_DATA_OFFSET,
    dataBytes: OBLIGATION_DATA_BYTES,
    collateralEntryBytes: COLLATERAL_ENTRY_BYTES,
    collateralReserveOffset: 0,
    collateralAmountOffset: 32,
    borrowEntryBytes: BORROW_ENTRY_BYTES,
    borrowReserveOffset: 0,
    borrowCumulativeRateWadsOffset: 32,
    borrowedAmountWadsOffset: 48,
    maximumCombinedEntries: MAX_OBLIGATION_RESERVES,
  }),
  reserve: frozen({
    accountBytes: RESERVE_BYTES,
    supportedVersion: 1,
    versionOffset: 0,
    lastUpdateSlotOffset: 1,
    lastUpdateStaleOffset: 9,
    lendingMarketOffset: 10,
    liquidityMintOffset: 42,
    liquidityMintDecimalsOffset: 74,
    liquidityAvailableAmountOffset: 171,
    liquidityBorrowedAmountWadsOffset: 179,
    liquidityCumulativeBorrowRateWadsOffset: 195,
    collateralMintOffset: 227,
    collateralMintTotalSupplyOffset: 259,
    accumulatedProtocolFeesWadsOffset: 373,
  }),
  decimal: frozen({ scale: 18, wad: WAD.toString(10), serializedBytes: 16 }),
  unsupportedAccountLengthPolicy: 'REJECT',
  nonCanonicalBooleanPolicy: 'REJECT',
  overflowPolicy: 'REJECT_BEYOND_PINNED_U192_INTERMEDIATE_OR_U64_ATOMIC_RESULT',
});

export const SAVE_LEND_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS = frozen({
  method: 'getProgramAccounts',
  programAddress: PROGRAM_ADDRESS,
  commitment: 'finalized',
  encoding: 'base64',
  withContext: true,
  minContextSlotFromAuthenticatedDurableState: true,
  filters: frozen([
    frozen({ dataSize: OBLIGATION_BYTES }),
    frozen({ memcmp: frozen({ offset: 10, bytes: MARKET_ADDRESS }) }),
    frozen({ memcmp: frozen({ offset: 42, bytes: 'OWNER_ADDRESS' }) }),
  ]),
  inspectEveryReturnedObligationAndEveryDeclaredEntry: true,
  deduplicateByAccountAddress: true,
  maximumSuppliedObligations: MAX_SUPPLIED_OBLIGATIONS,
  reserveAndEveryObligationMustShareFinalizedContext: true,
  reserveMustBeFreshAtExactContextSlot: true,
  standardJsonRpcCompletenessLimitation:
    'NO_AUTHENTICATED_NON_TRUNCATION_OR_EXHAUSTIVE_RESULT_SET_PROOF',
  mayEstablishCompletePosition: false,
});

export const SAVE_LEND_ACCOUNT_POSITION_CROSS_LANGUAGE_VECTORS = frozen([
  frozen({
    id: 'PINNED_RUST_EQUAL_COLLATERAL_RATE',
    collateralAmount: '250000',
    availableAmount: '1000000',
    reserveBorrowedAmountWads: '0',
    accumulatedProtocolFeesWads: '0',
    collateralMintTotalSupply: '1000000',
    expectedSupplyAtomicFloor: '250000',
  }),
  frozen({
    id: 'PINNED_RUST_PROTOCOL_FEES_EXCLUDED_FROM_SUPPLY',
    collateralAmount: '8',
    availableAmount: '900',
    reserveBorrowedAmountWads: '100500000000000000000',
    accumulatedProtocolFeesWads: '500000000000000000',
    collateralMintTotalSupply: '4000',
    expectedSupplyAtomicFloor: '2',
  }),
  frozen({
    id: 'PINNED_RUST_FRACTIONAL_SUPPLY_FLOORS',
    collateralAmount: '1',
    availableAmount: '3',
    reserveBorrowedAmountWads: '0',
    accumulatedProtocolFeesWads: '0',
    collateralMintTotalSupply: '2',
    expectedSupplyAtomicFloor: '1',
  }),
  frozen({
    id: 'PINNED_RUST_BORROW_ACCRUAL_AND_REPAY_CEILING',
    borrowedAmountWads: '2500000000000000000',
    obligationCumulativeBorrowRateWads: '1000000000000000000',
    reserveCumulativeBorrowRateWads: '1200000000000000000',
    expectedBorrowAtomicCeil: '3',
  }),
  frozen({
    id: 'PINNED_RUST_ONE_WAD_ULP_DEBT_CEILS',
    borrowedAmountWads: '1',
    obligationCumulativeBorrowRateWads: '1000000000000000000',
    reserveCumulativeBorrowRateWads: '1000000000000000000',
    expectedBorrowAtomicCeil: '1',
  }),
]);

export interface SaveLendSuppliedAccountV1 {
  readonly accountAddress: string;
  readonly ownerProgramAddress: string;
  readonly executable: false;
  readonly contextSlot: string;
  readonly space: string;
  readonly accountDataBase64: string;
  readonly accountDataSha256: string;
}

export interface EvaluateSaveLendAccountPositionSnapshotV1 {
  readonly semanticsVersion: typeof SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_VERSION;
  readonly use: typeof SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_USE;
  readonly mayPersist: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayEstablishCompletePosition: false;
  readonly networkId: typeof NETWORK_ID;
  readonly genesisHash: typeof GENESIS_HASH;
  readonly programAddress: typeof PROGRAM_ADDRESS;
  readonly lendingMarketAddress: typeof MARKET_ADDRESS;
  readonly reserveAddress: typeof RESERVE_ADDRESS;
  readonly assetMintAddress: typeof USDC_MINT_ADDRESS;
  readonly assetDecimals: 6;
  readonly ownerAddress: string;
  readonly commitment: 'finalized';
  readonly contextSlot: string;
  readonly finalizedRootSlot: string;
  readonly finalizedRootBlockhash: string;
  readonly accountSetStatus: 'CALLER_ASSERTED_COMPLETE_UNVERIFIED';
  readonly responseTruncated: false;
  readonly reserveAccount: SaveLendSuppliedAccountV1;
  readonly obligationAccounts: readonly SaveLendSuppliedAccountV1[];
}

export interface DormantSaveLendAccountPositionSemanticsResultV1 {
  readonly semanticsVersion: 1;
  readonly use: typeof SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_USE;
  readonly providerId: 'save';
  readonly protocolId: 'save-lend';
  readonly networkId: typeof NETWORK_ID;
  readonly ownerAddress: string;
  readonly reserveAddress: typeof RESERVE_ADDRESS;
  readonly assetMintAddress: typeof USDC_MINT_ADDRESS;
  readonly assetDecimals: 6;
  readonly sourcePosition: string;
  readonly finalizedRootBlockhash: string;
  readonly obligationAccountCount: number;
  readonly matchedDepositCount: number;
  readonly matchedBorrowCount: number;
  readonly suppliedAtomicFloor: string;
  readonly borrowedAtomicCeil: string;
  readonly completeness: 'INCOMPLETE_UNVERIFIED_DISCOVERY';
  readonly snapshotFingerprintSha256: string;
  readonly mayPersist: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayEstablishCompletePosition: false;
}

export class SaveLendAccountPositionSemanticsUnavailableError extends Error {
  readonly code = 'SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE';

  constructor() {
    super('Save Lend account-position semantics are unavailable.');
    this.name = 'SaveLendAccountPositionSemanticsUnavailableError';
  }
}

function unavailable(): never {
  throw new SaveLendAccountPositionSemanticsUnavailableError();
}

function exactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
    return unavailable();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return unavailable();
  if (Object.getOwnPropertySymbols(value).length !== 0) return unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(value).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== [...expectedKeys].sort()[index])
  ) {
    return unavailable();
  }
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      return unavailable();
    }
  }
  return value as Record<string, unknown>;
}

function canonicalUnsigned(value: unknown, maximum: bigint): bigint {
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED_INTEGER.test(value)) return unavailable();
  const parsed = BigInt(value);
  if (parsed > maximum) return unavailable();
  return parsed;
}

function canonicalAddress(value: unknown): string {
  try {
    return parseSolanaWalletAddress(value);
  } catch {
    return unavailable();
  }
}

function parseBase64(value: unknown, exactBytes: number): Uint8Array {
  if (typeof value !== 'string' || !CANONICAL_BASE64.test(value)) return unavailable();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.byteLength !== exactBytes || decoded.toString('base64') !== value)
    return unavailable();
  return Uint8Array.from(decoded);
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function readU64(data: Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let index = 7; index >= 0; index -= 1)
    result = (result << 8n) | BigInt(data[offset + index] ?? 0);
  return result;
}

function readU128(data: Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let index = 15; index >= 0; index -= 1)
    result = (result << 8n) | BigInt(data[offset + index] ?? 0);
  return result;
}

function publicKeyAt(data: Uint8Array, offset: number): Uint8Array {
  return data.slice(offset, offset + 32);
}

function checkedMultiply(left: bigint, right: bigint): bigint {
  const product = left * right;
  if (product > U192_MAX) return unavailable();
  return product;
}

function ceilWadToU64(value: bigint): bigint {
  if (value > U192_MAX - (WAD - 1n)) return unavailable();
  const result = (value + WAD - 1n) / WAD;
  if (result > U64_MAX) return unavailable();
  return result;
}

export function projectSaveLendCollateralToLiquidityAtomic(input: {
  readonly collateralAmount: bigint;
  readonly availableAmount: bigint;
  readonly reserveBorrowedAmountWads: bigint;
  readonly accumulatedProtocolFeesWads: bigint;
  readonly collateralMintTotalSupply: bigint;
}): bigint {
  const values = [input.collateralAmount, input.availableAmount, input.collateralMintTotalSupply];
  if (values.some((value) => value < 0n || value > U64_MAX)) return unavailable();
  if (
    input.reserveBorrowedAmountWads < 0n ||
    input.reserveBorrowedAmountWads > U128_MAX ||
    input.accumulatedProtocolFeesWads < 0n ||
    input.accumulatedProtocolFeesWads > U128_MAX
  ) {
    return unavailable();
  }

  const availableWads = checkedMultiply(input.availableAmount, WAD);
  const grossLiquidityWads = availableWads + input.reserveBorrowedAmountWads;
  if (grossLiquidityWads > U192_MAX || input.accumulatedProtocolFeesWads > grossLiquidityWads) {
    return unavailable();
  }
  const totalLiquidityWads = grossLiquidityWads - input.accumulatedProtocolFeesWads;
  let exchangeRateWads = WAD;
  if (input.collateralMintTotalSupply !== 0n && totalLiquidityWads !== 0n) {
    const collateralSupplyWads = checkedMultiply(input.collateralMintTotalSupply, WAD);
    exchangeRateWads = checkedMultiply(collateralSupplyWads, WAD) / totalLiquidityWads;
    if (exchangeRateWads === 0n || exchangeRateWads > U128_MAX) return unavailable();
  }
  const collateralAmountWads = checkedMultiply(input.collateralAmount, WAD);
  const liquidityWads = checkedMultiply(collateralAmountWads, WAD) / exchangeRateWads;
  const result = liquidityWads / WAD;
  if (result > U64_MAX) return unavailable();
  return result;
}

export function projectSaveLendBorrowToLiquidityAtomic(input: {
  readonly borrowedAmountWads: bigint;
  readonly obligationCumulativeBorrowRateWads: bigint;
  readonly reserveCumulativeBorrowRateWads: bigint;
}): bigint {
  for (const value of [
    input.borrowedAmountWads,
    input.obligationCumulativeBorrowRateWads,
    input.reserveCumulativeBorrowRateWads,
  ]) {
    if (value < 0n || value > U128_MAX) return unavailable();
  }
  if (
    input.obligationCumulativeBorrowRateWads === 0n ||
    input.reserveCumulativeBorrowRateWads < input.obligationCumulativeBorrowRateWads
  ) {
    return unavailable();
  }
  const compoundedRateWads =
    checkedMultiply(input.reserveCumulativeBorrowRateWads, WAD) /
    input.obligationCumulativeBorrowRateWads;
  if (compoundedRateWads > U128_MAX) return unavailable();
  const currentBorrowedAmountWads =
    checkedMultiply(input.borrowedAmountWads, compoundedRateWads) / WAD;
  if (currentBorrowedAmountWads > U128_MAX) return unavailable();
  return ceilWadToU64(currentBorrowedAmountWads);
}

export function createSaveLendOwnerDiscoveryPlan(
  ownerAddressValue: unknown,
  minimumContextSlotValue: unknown,
): Readonly<Record<string, unknown>> {
  const ownerAddress = canonicalAddress(ownerAddressValue);
  const minimumContextSlot = canonicalUnsigned(
    minimumContextSlotValue,
    BigInt(Number.MAX_SAFE_INTEGER),
  );
  return frozen({
    jsonrpc: '2.0',
    id: 1,
    method: 'getProgramAccounts',
    params: frozen([
      PROGRAM_ADDRESS,
      frozen({
        commitment: 'finalized',
        encoding: 'base64',
        withContext: true,
        minContextSlot: Number(minimumContextSlot),
        filters: frozen([
          frozen({ dataSize: OBLIGATION_BYTES }),
          frozen({ memcmp: frozen({ offset: 10, bytes: MARKET_ADDRESS }) }),
          frozen({ memcmp: frozen({ offset: 42, bytes: ownerAddress }) }),
        ]),
      }),
    ]),
  });
}

interface ParsedEnvelope {
  readonly accountAddress: string;
  readonly data: Uint8Array;
  readonly dataSha256: string;
}

function parseEnvelope(
  value: unknown,
  exactBytes: number,
  expectedContextSlot: bigint,
): ParsedEnvelope {
  const record = exactDataRecord(value, ENVELOPE_KEYS);
  const accountAddress = canonicalAddress(record.accountAddress);
  if (
    record.ownerProgramAddress !== PROGRAM_ADDRESS ||
    record.executable !== false ||
    canonicalUnsigned(record.contextSlot, U64_MAX) !== expectedContextSlot ||
    canonicalUnsigned(record.space, U64_MAX) !== BigInt(exactBytes) ||
    typeof record.accountDataSha256 !== 'string' ||
    !SHA256.test(record.accountDataSha256)
  ) {
    return unavailable();
  }
  const data = parseBase64(record.accountDataBase64, exactBytes);
  if (sha256(data) !== record.accountDataSha256) return unavailable();
  return frozen({ accountAddress, data, dataSha256: record.accountDataSha256 });
}

interface ParsedReserve {
  readonly availableAmount: bigint;
  readonly borrowedAmountWads: bigint;
  readonly cumulativeBorrowRateWads: bigint;
  readonly accumulatedProtocolFeesWads: bigint;
  readonly collateralMintTotalSupply: bigint;
}

function parseReserve(envelope: ParsedEnvelope, contextSlot: bigint): ParsedReserve {
  const data = envelope.data;
  if (
    envelope.accountAddress !== RESERVE_ADDRESS ||
    data[0] !== 1 ||
    readU64(data, 1) !== contextSlot ||
    data[9] !== 0 ||
    !equalBytes(publicKeyAt(data, 10), solanaWalletAddressBytes(MARKET_ADDRESS)) ||
    !equalBytes(publicKeyAt(data, 42), solanaWalletAddressBytes(USDC_MINT_ADDRESS)) ||
    data[74] !== 6 ||
    equalBytes(publicKeyAt(data, 227), ZERO_PUBLIC_KEY)
  ) {
    return unavailable();
  }
  const parsed = frozen({
    availableAmount: readU64(data, 171),
    borrowedAmountWads: readU128(data, 179),
    cumulativeBorrowRateWads: readU128(data, 195),
    collateralMintTotalSupply: readU64(data, 259),
    accumulatedProtocolFeesWads: readU128(data, 373),
  });
  const availableAmountWads = checkedMultiply(parsed.availableAmount, WAD);
  const grossLiquidityWads = availableAmountWads + parsed.borrowedAmountWads;
  if (
    parsed.cumulativeBorrowRateWads === 0n ||
    grossLiquidityWads > U192_MAX ||
    parsed.accumulatedProtocolFeesWads > grossLiquidityWads
  ) {
    return unavailable();
  }
  return parsed;
}

interface ParsedObligationTargetPosition {
  readonly suppliedAtomicFloor: bigint;
  readonly borrowedAtomicCeil: bigint;
  readonly matchedDepositCount: number;
  readonly matchedBorrowCount: number;
}

function parseObligation(
  envelope: ParsedEnvelope,
  ownerBytes: Uint8Array,
  contextSlot: bigint,
  reserve: ParsedReserve,
): ParsedObligationTargetPosition {
  const data = envelope.data;
  const stale = data[9];
  if (
    data[0] !== 1 ||
    (stale !== 0 && stale !== 1) ||
    readU64(data, 1) > contextSlot ||
    !equalBytes(publicKeyAt(data, 10), solanaWalletAddressBytes(MARKET_ADDRESS)) ||
    !equalBytes(publicKeyAt(data, 42), ownerBytes)
  ) {
    return unavailable();
  }
  const depositsLength = data[202] ?? 0;
  const borrowsLength = data[203] ?? 0;
  if (
    depositsLength + borrowsLength > MAX_OBLIGATION_RESERVES ||
    depositsLength * COLLATERAL_ENTRY_BYTES + borrowsLength * BORROW_ENTRY_BYTES >
      OBLIGATION_DATA_BYTES
  ) {
    return unavailable();
  }

  const seenDeposits = new Set<string>();
  const seenBorrows = new Set<string>();
  let suppliedAtomicFloor = 0n;
  let borrowedAtomicCeil = 0n;
  let matchedDepositCount = 0;
  let matchedBorrowCount = 0;
  let offset = OBLIGATION_DATA_OFFSET;

  for (let index = 0; index < depositsLength; index += 1) {
    const reserveBytes = publicKeyAt(data, offset);
    const reserveKey = Buffer.from(reserveBytes).toString('hex');
    const collateralAmount = readU64(data, offset + 32);
    if (
      equalBytes(reserveBytes, ZERO_PUBLIC_KEY) ||
      seenDeposits.has(reserveKey) ||
      collateralAmount === 0n
    )
      return unavailable();
    seenDeposits.add(reserveKey);
    if (equalBytes(reserveBytes, solanaWalletAddressBytes(RESERVE_ADDRESS))) {
      matchedDepositCount += 1;
      suppliedAtomicFloor += projectSaveLendCollateralToLiquidityAtomic({
        collateralAmount,
        ...reserve,
        reserveBorrowedAmountWads: reserve.borrowedAmountWads,
      });
    }
    offset += COLLATERAL_ENTRY_BYTES;
  }
  for (let index = 0; index < borrowsLength; index += 1) {
    const reserveBytes = publicKeyAt(data, offset);
    const reserveKey = Buffer.from(reserveBytes).toString('hex');
    const obligationCumulativeBorrowRateWads = readU128(data, offset + 32);
    const borrowedAmountWads = readU128(data, offset + 48);
    if (
      equalBytes(reserveBytes, ZERO_PUBLIC_KEY) ||
      seenBorrows.has(reserveKey) ||
      obligationCumulativeBorrowRateWads === 0n ||
      borrowedAmountWads === 0n
    )
      return unavailable();
    seenBorrows.add(reserveKey);
    if (equalBytes(reserveBytes, solanaWalletAddressBytes(RESERVE_ADDRESS))) {
      matchedBorrowCount += 1;
      borrowedAtomicCeil += projectSaveLendBorrowToLiquidityAtomic({
        obligationCumulativeBorrowRateWads,
        borrowedAmountWads,
        reserveCumulativeBorrowRateWads: reserve.cumulativeBorrowRateWads,
      });
    }
    offset += BORROW_ENTRY_BYTES;
  }
  if (
    matchedDepositCount > 1 ||
    matchedBorrowCount > 1 ||
    suppliedAtomicFloor > U64_MAX ||
    borrowedAtomicCeil > U64_MAX
  ) {
    return unavailable();
  }
  return frozen({
    suppliedAtomicFloor,
    borrowedAtomicCeil,
    matchedDepositCount,
    matchedBorrowCount,
  });
}

export function evaluateSaveLendAccountPositionSnapshot(
  value: unknown,
): DormantSaveLendAccountPositionSemanticsResultV1 {
  const record = exactDataRecord(value, SNAPSHOT_KEYS);
  if (
    record.semanticsVersion !== SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_VERSION ||
    record.use !== SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_USE ||
    record.mayPersist !== false ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayEstablishCompletePosition !== false ||
    record.networkId !== NETWORK_ID ||
    record.genesisHash !== GENESIS_HASH ||
    record.programAddress !== PROGRAM_ADDRESS ||
    record.lendingMarketAddress !== MARKET_ADDRESS ||
    record.reserveAddress !== RESERVE_ADDRESS ||
    record.assetMintAddress !== USDC_MINT_ADDRESS ||
    record.assetDecimals !== 6 ||
    record.commitment !== 'finalized' ||
    record.accountSetStatus !== 'CALLER_ASSERTED_COMPLETE_UNVERIFIED' ||
    record.responseTruncated !== false ||
    !Array.isArray(record.obligationAccounts) ||
    record.obligationAccounts.length > MAX_SUPPLIED_OBLIGATIONS
  ) {
    return unavailable();
  }

  const ownerAddress = canonicalAddress(record.ownerAddress);
  const finalizedRootBlockhash = canonicalAddress(record.finalizedRootBlockhash);
  const contextSlot = canonicalUnsigned(record.contextSlot, U64_MAX);
  if (canonicalUnsigned(record.finalizedRootSlot, U64_MAX) !== contextSlot) return unavailable();
  const reserveEnvelope = parseEnvelope(record.reserveAccount, RESERVE_BYTES, contextSlot);
  const reserve = parseReserve(reserveEnvelope, contextSlot);
  const ownerBytes = solanaWalletAddressBytes(ownerAddress);
  const accountAddresses = new Set<string>();
  const accountEvidence: Array<Readonly<{ accountAddress: string; dataSha256: string }>> = [];
  let suppliedAtomicFloor = 0n;
  let borrowedAtomicCeil = 0n;
  let matchedDepositCount = 0;
  let matchedBorrowCount = 0;

  for (const candidate of record.obligationAccounts) {
    const envelope = parseEnvelope(candidate, OBLIGATION_BYTES, contextSlot);
    if (
      envelope.accountAddress === RESERVE_ADDRESS ||
      accountAddresses.has(envelope.accountAddress)
    ) {
      return unavailable();
    }
    accountAddresses.add(envelope.accountAddress);
    const position = parseObligation(envelope, ownerBytes, contextSlot, reserve);
    suppliedAtomicFloor += position.suppliedAtomicFloor;
    borrowedAtomicCeil += position.borrowedAtomicCeil;
    matchedDepositCount += position.matchedDepositCount;
    matchedBorrowCount += position.matchedBorrowCount;
    if (suppliedAtomicFloor > U64_MAX || borrowedAtomicCeil > U64_MAX) return unavailable();
    accountEvidence.push(
      frozen({ accountAddress: envelope.accountAddress, dataSha256: envelope.dataSha256 }),
    );
  }
  accountEvidence.sort((left, right) => left.accountAddress.localeCompare(right.accountAddress));

  const fingerprintMaterial = frozen({
    semanticsVersion: 1,
    use: SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_USE,
    networkId: NETWORK_ID,
    programAddress: PROGRAM_ADDRESS,
    lendingMarketAddress: MARKET_ADDRESS,
    reserveAddress: RESERVE_ADDRESS,
    assetMintAddress: USDC_MINT_ADDRESS,
    ownerAddress,
    contextSlot: contextSlot.toString(10),
    finalizedRootBlockhash,
    reserveAccountDataSha256: reserveEnvelope.dataSha256,
    obligationAccounts: accountEvidence,
    suppliedAtomicFloor: suppliedAtomicFloor.toString(10),
    borrowedAtomicCeil: borrowedAtomicCeil.toString(10),
  });

  return frozen({
    semanticsVersion: 1,
    use: SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_USE,
    providerId: 'save',
    protocolId: 'save-lend',
    networkId: NETWORK_ID,
    ownerAddress,
    reserveAddress: RESERVE_ADDRESS,
    assetMintAddress: USDC_MINT_ADDRESS,
    assetDecimals: 6,
    sourcePosition: contextSlot.toString(10),
    finalizedRootBlockhash,
    obligationAccountCount: accountEvidence.length,
    matchedDepositCount,
    matchedBorrowCount,
    suppliedAtomicFloor: suppliedAtomicFloor.toString(10),
    borrowedAtomicCeil: borrowedAtomicCeil.toString(10),
    completeness: 'INCOMPLETE_UNVERIFIED_DISCOVERY',
    snapshotFingerprintSha256: sha256(JSON.stringify(fingerprintMaterial)),
    mayPersist: false,
    mayAuthorizeFinancialAction: false,
    mayEstablishCompletePosition: false,
  });
}
