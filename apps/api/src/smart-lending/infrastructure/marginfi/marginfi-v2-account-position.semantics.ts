import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  parseSolanaWalletAddress,
  solanaWalletAddressBytes,
} from '../../../wallets/domain/wallet-identity';

const NETWORK_ID = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' as const;
const PROGRAM_ADDRESS = 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA' as const;
const GROUP_ADDRESS = '4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8' as const;
const BANK_ADDRESS = '3uxNepDbmkDNq6JhRja5Z8QwbTrfmkKP8AKZV5chYDGG' as const;
const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as const;

export const MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_VERSION = 1 as const;
export const MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_USE =
  'DORMANT_MARGINFI_V2_ACCOUNT_POSITION_SUPPLIED_SNAPSHOT_ONLY' as const;

const ACCOUNT_DISCRIMINATOR = Uint8Array.from([67, 178, 130, 109, 126, 114, 28, 42]);
const BANK_DISCRIMINATOR = Uint8Array.from([142, 49, 166, 242, 50, 66, 97, 188]);
const ACCOUNT_DISCRIMINATOR_BASE58 = 'CKkRR4La3xu';
const ACCOUNT_BYTES = 2_312;
const BANK_BYTES = 1_864;
const BALANCES_OFFSET = 72;
const BALANCE_BYTES = 104;
const BALANCE_COUNT = 16;
const BALANCE_ACTIVE_OFFSET = 0;
const BALANCE_BANK_OFFSET = 1;
const BALANCE_ASSET_TAG_OFFSET = 33;
const BALANCE_TAG_OFFSET = 34;
const BALANCE_PAD_OFFSET = 36;
const BALANCE_ASSET_SHARES_OFFSET = 40;
const BALANCE_LIABILITY_SHARES_OFFSET = 56;
const BALANCE_EMISSIONS_OFFSET = 72;
const BALANCE_LAST_UPDATE_OFFSET = 88;
const BALANCE_PADDING_OFFSET = 96;
const GROUP_OFFSET = 8;
const AUTHORITY_OFFSET = 40;
const BANK_MINT_OFFSET = 8;
const BANK_MINT_DECIMALS_OFFSET = 40;
const BANK_GROUP_OFFSET = 41;
const BANK_ASSET_SHARE_VALUE_OFFSET = 80;
const BANK_LIABILITY_SHARE_VALUE_OFFSET = 96;
const BANK_OPERATIONAL_STATE_OFFSET = 608;
const BANK_RISK_TIER_OFFSET = 784;
const BANK_ASSET_TAG_OFFSET = 785;
const BANK_INTEGRATION_ACCOUNTS_OFFSET = 1_560;
const BANK_INTEGRATION_ACCOUNTS_BYTES = 96;
const MAX_SUPPLIED_ACCOUNTS = 256;
const I80F48_SCALE = 1n << 48n;
const I80F48_ATOMIC_DENOMINATOR = I80F48_SCALE * I80F48_SCALE;
const I80F48_MAX_RAW = (1n << 127n) - 1n;
const U64_MAX = (1n << 64n) - 1n;
const SHA256 = /^[0-9a-f]{64}$/u;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,19})$/u;
const I80F48_LE_HEX = /^[0-9a-f]{32}$/u;
const ZERO_PUBLIC_KEY = new Uint8Array(32);

const ACCOUNT_KEYS = Object.freeze([
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
  'groupAddress',
  'bankAddress',
  'assetMintAddress',
  'assetDecimals',
  'authorityAddress',
  'commitment',
  'contextSlot',
  'finalizedRootSlot',
  'finalizedRootBlockhash',
  'accountSetStatus',
  'responseTruncated',
  'bankAccount',
  'accounts',
] as const);

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export const MARGINFI_V2_ACCOUNT_POSITION_SOURCE_PINS = frozen({
  sourceFileHashBytes: 'GIT_BLOB_CONTENT_AT_PINNED_COMMIT',
  marginfiV2Repository: '0dotxyz/marginfi-v2',
  marginfiV2CommitSha: '5c97c5efb68a24f68041d2bb7d90917b8dc989e2',
  p0TsSdkRepository: '0dotxyz/p0-ts-sdk',
  p0TsSdkCommitSha: '64773b237961c17e5dacbbf4bfe87b8af22e885b',
  rustUserAccountPath: 'type-crate/src/types/user_account.rs',
  rustUserAccountSha256: '2d0e1a62870f91a6a6a7e5d6125181ed2aebf534fd78106b26d695796c757854',
  rustBankPath: 'type-crate/src/types/bank.rs',
  rustBankSha256: '5c69b0563487c6021aea604d7af2febf8b936969b086ffa8035ba57bb9daf634',
  rustWrappedI80F48Path: 'type-crate/src/types/wrapped_i80f48.rs',
  rustWrappedI80F48Sha256: '2a9108b2e7971ebd95116c83430eef8f435942d077292c1cba8f5772459d1a92',
  rustConstantsPath: 'type-crate/src/constants.rs',
  rustConstantsSha256: '4c7ccf066a02ef349ebc6e467de0f43212272d0e1f7746a2d81017e06a62a522',
  rustAccountStatePath: 'programs/marginfi/src/state/marginfi_account.rs',
  rustAccountStateSha256: 'a187a9dbb67aa9c8dab0df0d7fea12fbf295926999b5084e5a747271322fbd85',
  sdkDiscoveryPath: 'src/services/account/utils/fetch.utils.ts',
  sdkDiscoverySha256: '61952621b02b8c729373f8109af1d5e7fcf9869a4da824b75e281b2bc3a410f6',
  sdkI80F48Path: 'src/utils/conversion.utils.ts',
  sdkI80F48Sha256: '55c672e3844ed9b85100f709078ee07e8f7641474e4f8b8c88e3d91980d7bae7',
  sdkShareConversionPath: 'src/services/bank/utils/compute/share-conversions.utils.ts',
  sdkShareConversionSha256: 'beac5ede978a3d6c1d788da37e6bffc24a6e0e25b6bdf198765342ac52b36114',
  sdkIdlPath: 'src/idl/marginfi_0.1.11.json',
  sdkIdlSha256: '3722ae1bcb29bcbdff1b0194802c3f77ab27af8ada34cbb2bb89c5228ef4cb95',
});

export const MARGINFI_V2_ACCOUNT_POSITION_IDENTITIES = frozen({
  networkId: NETWORK_ID,
  genesisHash: GENESIS_HASH,
  programAddress: PROGRAM_ADDRESS,
  groupAddress: GROUP_ADDRESS,
  bankAddress: BANK_ADDRESS,
  usdcMintAddress: USDC_MINT_ADDRESS,
  usdcDecimals: 6 as const,
});

const BANK_SLOT_OFFSETS = frozen(
  Array.from(
    { length: BALANCE_COUNT },
    (_, index) => BALANCES_OFFSET + BALANCE_BANK_OFFSET + index * BALANCE_BYTES,
  ),
);

export const MARGINFI_V2_ACCOUNT_POSITION_LAYOUT = frozen({
  supportedAccountVersions: frozen([
    frozen({
      id: 'MARGINFI_ACCOUNT_0_1_11_CURRENT',
      discriminator: frozen([...ACCOUNT_DISCRIMINATOR]),
      discriminatorBase58: ACCOUNT_DISCRIMINATOR_BASE58,
      payloadBytes: 2_304,
      accountBytes: ACCOUNT_BYTES,
      groupOffset: GROUP_OFFSET,
      authorityOffset: AUTHORITY_OFFSET,
      balancesOffset: BALANCES_OFFSET,
      balanceCount: BALANCE_COUNT,
      balanceBytes: BALANCE_BYTES,
      balanceOffsets: frozen({
        active: BALANCE_ACTIVE_OFFSET,
        bankPublicKey: BALANCE_BANK_OFFSET,
        bankAssetTag: BALANCE_ASSET_TAG_OFFSET,
        tag: BALANCE_TAG_OFFSET,
        padding: BALANCE_PAD_OFFSET,
        assetShares: BALANCE_ASSET_SHARES_OFFSET,
        liabilityShares: BALANCE_LIABILITY_SHARES_OFFSET,
        emissionsOutstanding: BALANCE_EMISSIONS_OFFSET,
        lastUpdate: BALANCE_LAST_UPDATE_OFFSET,
        trailingPadding: BALANCE_PADDING_OFFSET,
      }),
    }),
  ]),
  unsupportedAccountLengthPolicy: 'REJECT',
  activeBytePolicy: 'ONLY_CANONICAL_0_OR_1_DUE_TO_PINNED_RUST_SDK_DISAGREEMENT',
  emptyBalanceThresholdI80F48Raw: I80F48_SCALE.toString(10),
  i80f48: frozen({
    bytes: 16,
    signed: true,
    byteOrder: 'LITTLE_ENDIAN',
    fractionalBits: 48,
    atomicDenominator: I80F48_ATOMIC_DENOMINATOR.toString(10),
  }),
  bank: frozen({
    id: 'BANK_0_1_11_CURRENT',
    payloadBytes: 1_856,
    accountBytes: BANK_BYTES,
    discriminator: frozen([...BANK_DISCRIMINATOR]),
    mintOffset: BANK_MINT_OFFSET,
    mintDecimalsOffset: BANK_MINT_DECIMALS_OFFSET,
    groupOffset: BANK_GROUP_OFFSET,
    assetShareValueOffset: BANK_ASSET_SHARE_VALUE_OFFSET,
    liabilityShareValueOffset: BANK_LIABILITY_SHARE_VALUE_OFFSET,
    operationalStateOffset: BANK_OPERATIONAL_STATE_OFFSET,
    riskTierOffset: BANK_RISK_TIER_OFFSET,
    assetTagOffset: BANK_ASSET_TAG_OFFSET,
    integrationAccountsOffset: BANK_INTEGRATION_ACCOUNTS_OFFSET,
    integrationAccountsBytes: BANK_INTEGRATION_ACCOUNTS_BYTES,
  }),
});

export const MARGINFI_V2_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS = frozen({
  method: 'getProgramAccounts',
  programAddress: PROGRAM_ADDRESS,
  commitment: 'finalized',
  encoding: 'base64',
  withContext: true,
  minContextSlotFromAuthenticatedDurableState: true,
  filters: frozen({
    discriminator: frozen({ offset: 0, bytes: ACCOUNT_DISCRIMINATOR_BASE58 }),
    dataSize: ACCOUNT_BYTES,
    group: frozen({ offset: GROUP_OFFSET, bytes: GROUP_ADDRESS }),
    authorityOffset: AUTHORITY_OFFSET,
  }),
  bankPublicKeyOffsets: BANK_SLOT_OFFSETS,
  inspectEveryReturnedAccountAndEveryBalanceSlot: true,
  deduplicateByAccountAddress: true,
  maximumSuppliedAccounts: MAX_SUPPLIED_ACCOUNTS,
  sameContextRequirement:
    'BANK_AND_EVERY_WALLET_ACCOUNT_MUST_SHARE_THE_EXACT_FINALIZED_ROOT_SLOT_AND_BLOCKHASH',
  standardJsonRpcCompletenessLimitation:
    'NO_AUTHENTICATED_NON_TRUNCATION_OR_SAME_SLOT_CROSS_CALL_PROOF',
  mayEstablishCompletePosition: false,
});

export const MARGINFI_V2_ACCOUNT_POSITION_CROSS_LANGUAGE_VECTORS = frozen([
  frozen({
    id: 'PINNED_RUST_AND_SDK_EXACT_INTEGER',
    sharesI80F48LeHexRaw: '00000000000080841e00000000000000',
    shareValueI80F48LeHexRaw: '00000000004001000000000000000000',
    expectedSupplyAtomicFloor: '2500000',
    expectedBorrowAtomicCeil: '2500000',
  }),
  frozen({
    id: 'PINNED_RUST_AND_SDK_ONE_FIXED_ULP',
    sharesI80F48LeHexRaw: '00000000000001000000000000000000',
    shareValueI80F48LeHexRaw: '01000000000001000000000000000000',
    expectedSupplyAtomicFloor: '1',
    expectedBorrowAtomicCeil: '2',
  }),
  frozen({
    id: 'PINNED_RUST_AND_SDK_FRACTIONAL_PRODUCT',
    sharesI80F48LeHexRaw: '00000000008001000000000000000000',
    shareValueI80F48LeHexRaw: '00000000008001000000000000000000',
    expectedSupplyAtomicFloor: '2',
    expectedBorrowAtomicCeil: '3',
  }),
  frozen({
    id: 'PINNED_RUST_AND_SDK_U64_BOUNDARY',
    sharesI80F48LeHexRaw: '000000000000ffffffffffffffff0000',
    shareValueI80F48LeHexRaw: '00000000000001000000000000000000',
    expectedSupplyAtomicFloor: U64_MAX.toString(10),
    expectedBorrowAtomicCeil: U64_MAX.toString(10),
  }),
]);

export interface MarginfiV2SuppliedAccountV1 {
  readonly accountAddress: string;
  readonly ownerProgramAddress: string;
  readonly executable: false;
  readonly contextSlot: string;
  readonly space: string;
  readonly accountDataBase64: string;
  readonly accountDataSha256: string;
}

export interface EvaluateMarginfiV2SuppliedAccountSnapshotV1 {
  readonly semanticsVersion: typeof MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_VERSION;
  readonly use: typeof MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_USE;
  readonly mayPersist: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayEstablishCompletePosition: false;
  readonly networkId: typeof NETWORK_ID;
  readonly genesisHash: typeof GENESIS_HASH;
  readonly programAddress: typeof PROGRAM_ADDRESS;
  readonly groupAddress: typeof GROUP_ADDRESS;
  readonly bankAddress: typeof BANK_ADDRESS;
  readonly assetMintAddress: typeof USDC_MINT_ADDRESS;
  readonly assetDecimals: 6;
  readonly authorityAddress: string;
  readonly commitment: 'finalized';
  readonly contextSlot: string;
  readonly finalizedRootSlot: string;
  readonly finalizedRootBlockhash: string;
  readonly accountSetStatus: 'CALLER_ASSERTED_COMPLETE_UNVERIFIED';
  readonly responseTruncated: false;
  readonly bankAccount: MarginfiV2SuppliedAccountV1;
  readonly accounts: readonly MarginfiV2SuppliedAccountV1[];
}

export interface MarginfiV2ConservativeAtomicProjection {
  readonly rounding: 'SUPPLY_FLOOR' | 'BORROW_CEIL';
  readonly atomic: string;
  readonly exactNumerator: string;
  readonly denominator: string;
  readonly fractionalRemainder: string;
}

export interface DormantMarginfiV2SuppliedAccountSnapshotResultV1 {
  readonly semanticsVersion: typeof MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_VERSION;
  readonly use: typeof MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_USE;
  readonly mayPersist: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayEstablishCompletePosition: false;
  readonly calculationStatus: 'OFFLINE_SUPPLIED_ACCOUNT_SET_ONLY';
  readonly completenessStatus: 'NOT_ESTABLISHED';
  readonly currentInterestStatus: 'RECORDED_ON_CHAIN_SHARE_VALUES_ONLY_NOT_HYPOTHETICALLY_ACCRUED';
  readonly contextSlot: string;
  readonly suppliedAccountCount: string;
  readonly matchedBalanceCount: string;
  readonly supply: MarginfiV2ConservativeAtomicProjection;
  readonly borrow: MarginfiV2ConservativeAtomicProjection;
}

export class MarginfiV2AccountPositionSemanticsUnavailableError extends Error {
  readonly code = 'MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE' as const;

  constructor() {
    super('Marginfi v2 account-position semantics are unavailable.');
    this.name = 'MarginfiV2AccountPositionSemanticsUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

function fail(): never {
  throw new MarginfiV2AccountPositionSemanticsUnavailableError();
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || isProxy(value)) {
      return fail();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) {
      return fail();
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof MarginfiV2AccountPositionSemanticsUnavailableError) throw error;
    return fail();
  }
}

function exactArray(value: unknown, maximum: number): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const length = descriptors['length'];
    if (
      !length ||
      !('value' in length) ||
      typeof length.value !== 'number' ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > maximum
    ) {
      return fail();
    }
    const expectedKeys = [
      ...Array.from({ length: length.value }, (_, index) => String(index)),
      'length',
    ];
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail();
    }
    return expectedKeys.slice(0, -1).map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      return descriptor.value;
    });
  } catch (error) {
    if (error instanceof MarginfiV2AccountPositionSemanticsUnavailableError) throw error;
    return fail();
  }
}

function canonicalSlot(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED_INTEGER.test(value)) return fail();
  try {
    if (BigInt(value) === 0n || BigInt(value) > U64_MAX) return fail();
  } catch {
    return fail();
  }
  return value;
}

function publicKey(value: unknown): string {
  try {
    return parseSolanaWalletAddress(value);
  } catch {
    return fail();
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function allZero(value: Uint8Array): boolean {
  return value.every((byte) => byte === 0);
}

function canonicalAccountData(value: unknown, expectedBytes: number): Buffer {
  if (typeof value !== 'string' || !CANONICAL_BASE64.test(value)) return fail();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength !== expectedBytes || bytes.toString('base64') !== value) return fail();
  return bytes;
}

interface ParsedEnvelope {
  readonly address: string;
  readonly contextSlot: string;
  readonly data: Buffer;
}

function parseEnvelope(
  value: unknown,
  expectedBytes: number,
  expectedContextSlot: string,
): ParsedEnvelope {
  const record = exactRecord(value, ACCOUNT_KEYS);
  const address = publicKey(record.accountAddress);
  const contextSlot = canonicalSlot(record.contextSlot);
  const data = canonicalAccountData(record.accountDataBase64, expectedBytes);
  if (
    record.ownerProgramAddress !== PROGRAM_ADDRESS ||
    record.executable !== false ||
    contextSlot !== expectedContextSlot ||
    record.space !== expectedBytes.toString(10) ||
    typeof record.accountDataSha256 !== 'string' ||
    !SHA256.test(record.accountDataSha256) ||
    record.accountDataSha256 === '0'.repeat(64) ||
    createHash('sha256').update(data).digest('hex') !== record.accountDataSha256
  ) {
    return fail();
  }
  return frozen({ address, contextSlot, data });
}

function readI80F48Raw(data: Uint8Array, offset: number): bigint {
  let unsigned = 0n;
  for (let index = 15; index >= 0; index -= 1) {
    unsigned = (unsigned << 8n) | BigInt(data[offset + index] ?? 0);
  }
  return unsigned >= 1n << 127n ? unsigned - (1n << 128n) : unsigned;
}

function i80F48RawFromHex(value: unknown): bigint {
  if (typeof value !== 'string' || !I80F48_LE_HEX.test(value)) return fail();
  return readI80F48Raw(Buffer.from(value, 'hex'), 0);
}

function checkedQuantityNumerator(sharesRaw: bigint, shareValueRaw: bigint): bigint {
  if (sharesRaw < 0n || shareValueRaw <= 0n) return fail();
  const numerator = sharesRaw * shareValueRaw;
  // Marginfi uses I80F48::checked_mul. Reject any exact product outside the
  // positive I80F48 range before applying this product's conservative policy.
  if (numerator > I80F48_MAX_RAW * I80F48_SCALE) return fail();
  return numerator;
}

function projection(
  numerator: bigint,
  rounding: MarginfiV2ConservativeAtomicProjection['rounding'],
): MarginfiV2ConservativeAtomicProjection {
  const quotient = numerator / I80F48_ATOMIC_DENOMINATOR;
  const remainder = numerator % I80F48_ATOMIC_DENOMINATOR;
  const atomic = rounding === 'BORROW_CEIL' && remainder !== 0n ? quotient + 1n : quotient;
  if (atomic > U64_MAX) return fail();
  return frozen({
    rounding,
    atomic: atomic.toString(10),
    exactNumerator: numerator.toString(10),
    denominator: I80F48_ATOMIC_DENOMINATOR.toString(10),
    fractionalRemainder: remainder.toString(10),
  });
}

export function projectMarginfiV2I80F48SharesToAtomic(
  sharesI80F48LeHexRaw: unknown,
  shareValueI80F48LeHexRaw: unknown,
  rounding: unknown,
): MarginfiV2ConservativeAtomicProjection {
  if (rounding !== 'SUPPLY_FLOOR' && rounding !== 'BORROW_CEIL') return fail();
  const numerator = checkedQuantityNumerator(
    i80F48RawFromHex(sharesI80F48LeHexRaw),
    i80F48RawFromHex(shareValueI80F48LeHexRaw),
  );
  return projection(numerator, rounding);
}

function comparePublicKeyBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < 32; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

interface ParsedAccountAmounts {
  readonly supplyNumerator: bigint;
  readonly borrowNumerator: bigint;
  readonly matchedBalances: number;
}

function parseAccountAmounts(
  data: Uint8Array,
  expectedGroup: Uint8Array,
  expectedAuthority: Uint8Array,
  expectedBank: Uint8Array,
  assetShareValueRaw: bigint,
  liabilityShareValueRaw: bigint,
): ParsedAccountAmounts {
  if (
    !bytesEqual(data.subarray(0, 8), ACCOUNT_DISCRIMINATOR) ||
    !bytesEqual(data.subarray(GROUP_OFFSET, GROUP_OFFSET + 32), expectedGroup) ||
    !bytesEqual(data.subarray(AUTHORITY_OFFSET, AUTHORITY_OFFSET + 32), expectedAuthority)
  ) {
    return fail();
  }

  let previousActiveBank: Uint8Array | undefined;
  let encounteredInactive = false;
  let supplyNumerator = 0n;
  let borrowNumerator = 0n;
  let matchedBalances = 0;
  for (let index = 0; index < BALANCE_COUNT; index += 1) {
    const offset = BALANCES_OFFSET + index * BALANCE_BYTES;
    const active = data[offset + BALANCE_ACTIVE_OFFSET];
    if (active !== 0 && active !== 1) return fail();
    const balanceBytes = data.subarray(offset, offset + BALANCE_BYTES);
    if (active === 0) {
      if (!allZero(balanceBytes)) return fail();
      encounteredInactive = true;
      continue;
    }
    if (encounteredInactive) return fail();

    const bank = data.subarray(offset + BALANCE_BANK_OFFSET, offset + BALANCE_BANK_OFFSET + 32);
    if (bytesEqual(bank, ZERO_PUBLIC_KEY)) return fail();
    if (previousActiveBank !== undefined && comparePublicKeyBytes(previousActiveBank, bank) <= 0) {
      return fail();
    }
    previousActiveBank = Uint8Array.from(bank);
    const bankAssetTag = data[offset + BALANCE_ASSET_TAG_OFFSET];
    if (bankAssetTag === undefined || bankAssetTag > 6) return fail();
    if (!allZero(data.subarray(offset + BALANCE_PAD_OFFSET, offset + BALANCE_PAD_OFFSET + 4))) {
      return fail();
    }
    if (
      !allZero(data.subarray(offset + BALANCE_PADDING_OFFSET, offset + BALANCE_PADDING_OFFSET + 8))
    ) {
      return fail();
    }
    const assetSharesRaw = readI80F48Raw(data, offset + BALANCE_ASSET_SHARES_OFFSET);
    const liabilitySharesRaw = readI80F48Raw(data, offset + BALANCE_LIABILITY_SHARES_OFFSET);
    const emissionsRaw = readI80F48Raw(data, offset + BALANCE_EMISSIONS_OFFSET);
    if (assetSharesRaw < 0n || liabilitySharesRaw < 0n || emissionsRaw < 0n) return fail();
    const hasAssets = assetSharesRaw >= I80F48_SCALE;
    const hasLiabilities = liabilitySharesRaw >= I80F48_SCALE;
    if (hasAssets && hasLiabilities) return fail();

    if (!bytesEqual(bank, expectedBank)) continue;
    if (bankAssetTag !== 0 || matchedBalances !== 0) return fail();
    matchedBalances = 1;
    if (hasAssets) {
      supplyNumerator = checkedQuantityNumerator(assetSharesRaw, assetShareValueRaw);
    } else if (hasLiabilities) {
      borrowNumerator = checkedQuantityNumerator(liabilitySharesRaw, liabilityShareValueRaw);
    }
  }
  return frozen({ supplyNumerator, borrowNumerator, matchedBalances });
}

function parseBankShareValues(data: Uint8Array): Readonly<{ asset: bigint; liability: bigint }> {
  const mint = solanaWalletAddressBytes(USDC_MINT_ADDRESS);
  const group = solanaWalletAddressBytes(GROUP_ADDRESS);
  if (
    !bytesEqual(data.subarray(0, 8), BANK_DISCRIMINATOR) ||
    !bytesEqual(data.subarray(BANK_MINT_OFFSET, BANK_MINT_OFFSET + 32), mint) ||
    data[BANK_MINT_DECIMALS_OFFSET] !== 6 ||
    !bytesEqual(data.subarray(BANK_GROUP_OFFSET, BANK_GROUP_OFFSET + 32), group) ||
    data[BANK_OPERATIONAL_STATE_OFFSET] !== 1 ||
    data[BANK_RISK_TIER_OFFSET] !== 0 ||
    data[BANK_ASSET_TAG_OFFSET] !== 0 ||
    !allZero(
      data.subarray(
        BANK_INTEGRATION_ACCOUNTS_OFFSET,
        BANK_INTEGRATION_ACCOUNTS_OFFSET + BANK_INTEGRATION_ACCOUNTS_BYTES,
      ),
    )
  ) {
    return fail();
  }
  const asset = readI80F48Raw(data, BANK_ASSET_SHARE_VALUE_OFFSET);
  const liability = readI80F48Raw(data, BANK_LIABILITY_SHARE_VALUE_OFFSET);
  if (asset <= 0n || liability <= 0n) return fail();
  return frozen({ asset, liability });
}

export function createMarginfiV2AuthorityDiscoveryPlan(authorityValue: unknown): Readonly<{
  method: 'getProgramAccounts';
  programAddress: typeof PROGRAM_ADDRESS;
  configuration: Readonly<Record<string, unknown>>;
  postDecodeBankAddress: typeof BANK_ADDRESS;
  bankPublicKeyOffsets: readonly number[];
  completenessStatus: 'NOT_ESTABLISHED_BY_STANDARD_JSON_RPC';
}> {
  const authorityAddress = publicKey(authorityValue);
  return frozen({
    method: 'getProgramAccounts' as const,
    programAddress: PROGRAM_ADDRESS,
    configuration: frozen({
      commitment: 'finalized',
      encoding: 'base64',
      withContext: true,
      minContextSlot: 'AUTHENTICATED_DURABLE_FLOOR_REQUIRED',
      filters: frozen([
        frozen({ memcmp: frozen({ offset: 0, bytes: ACCOUNT_DISCRIMINATOR_BASE58 }) }),
        frozen({ dataSize: ACCOUNT_BYTES }),
        frozen({ memcmp: frozen({ offset: GROUP_OFFSET, bytes: GROUP_ADDRESS }) }),
        frozen({ memcmp: frozen({ offset: AUTHORITY_OFFSET, bytes: authorityAddress }) }),
      ]),
    }),
    postDecodeBankAddress: BANK_ADDRESS,
    bankPublicKeyOffsets: BANK_SLOT_OFFSETS,
    completenessStatus: 'NOT_ESTABLISHED_BY_STANDARD_JSON_RPC' as const,
  });
}

export function evaluateMarginfiV2SuppliedAccountSnapshot(
  value: unknown,
): DormantMarginfiV2SuppliedAccountSnapshotResultV1 {
  const record = exactRecord(value, SNAPSHOT_KEYS);
  if (
    record.semanticsVersion !== MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_VERSION ||
    record.use !== MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_USE ||
    record.mayPersist !== false ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayEstablishCompletePosition !== false ||
    record.networkId !== NETWORK_ID ||
    record.genesisHash !== GENESIS_HASH ||
    record.programAddress !== PROGRAM_ADDRESS ||
    record.groupAddress !== GROUP_ADDRESS ||
    record.bankAddress !== BANK_ADDRESS ||
    record.assetMintAddress !== USDC_MINT_ADDRESS ||
    record.assetDecimals !== 6 ||
    record.commitment !== 'finalized' ||
    record.accountSetStatus !== 'CALLER_ASSERTED_COMPLETE_UNVERIFIED' ||
    record.responseTruncated !== false
  ) {
    return fail();
  }
  const authorityAddress = publicKey(record.authorityAddress);
  const contextSlot = canonicalSlot(record.contextSlot);
  if (canonicalSlot(record.finalizedRootSlot) !== contextSlot) return fail();
  publicKey(record.finalizedRootBlockhash);

  const bankEnvelope = parseEnvelope(record.bankAccount, BANK_BYTES, contextSlot);
  if (bankEnvelope.address !== BANK_ADDRESS) return fail();
  const shareValues = parseBankShareValues(bankEnvelope.data);
  const accounts = exactArray(record.accounts, MAX_SUPPLIED_ACCOUNTS);
  const groupBytes = solanaWalletAddressBytes(GROUP_ADDRESS);
  const authorityBytes = solanaWalletAddressBytes(authorityAddress);
  const bankBytes = solanaWalletAddressBytes(BANK_ADDRESS);
  const seen = new Set<string>();
  let supplyNumerator = 0n;
  let borrowNumerator = 0n;
  let matchedBalanceCount = 0;
  for (const candidate of accounts) {
    const envelope = parseEnvelope(candidate, ACCOUNT_BYTES, contextSlot);
    if (seen.has(envelope.address) || envelope.address === BANK_ADDRESS) return fail();
    seen.add(envelope.address);
    const amounts = parseAccountAmounts(
      envelope.data,
      groupBytes,
      authorityBytes,
      bankBytes,
      shareValues.asset,
      shareValues.liability,
    );
    supplyNumerator += amounts.supplyNumerator;
    borrowNumerator += amounts.borrowNumerator;
    matchedBalanceCount += amounts.matchedBalances;
  }

  return frozen({
    semanticsVersion: MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_VERSION,
    use: MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_USE,
    mayPersist: false as const,
    mayAuthorizeFinancialAction: false as const,
    mayEstablishCompletePosition: false as const,
    calculationStatus: 'OFFLINE_SUPPLIED_ACCOUNT_SET_ONLY' as const,
    completenessStatus: 'NOT_ESTABLISHED' as const,
    currentInterestStatus:
      'RECORDED_ON_CHAIN_SHARE_VALUES_ONLY_NOT_HYPOTHETICALLY_ACCRUED' as const,
    contextSlot,
    suppliedAccountCount: accounts.length.toString(10),
    matchedBalanceCount: matchedBalanceCount.toString(10),
    supply: projection(supplyNumerator, 'SUPPLY_FLOOR'),
    borrow: projection(borrowNumerator, 'BORROW_CEIL'),
  });
}
