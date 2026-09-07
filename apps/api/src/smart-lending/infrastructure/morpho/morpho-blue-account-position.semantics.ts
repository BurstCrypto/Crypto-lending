import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { isAddress } from 'viem';

const NETWORK_ID = 'eip155:1' as const;
const CHAIN_ID = '0x1' as const;
const MORPHO_BLUE_ETHEREUM_ADDRESS = '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb' as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const WAD = 1_000_000_000_000_000_000n;
const MAX_FEE_WAD = 250_000_000_000_000_000n;
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;

const SNAPSHOT_KEYS = Object.freeze([
  'semanticsVersion',
  'use',
  'mayPersist',
  'mayAuthorizeFinancialAction',
  'mayEstablishCompletePosition',
  'walletAddress',
  'feeRecipientAddress',
  'irmAddress',
  'blockTimestamp',
  'borrowRatePerSecondWad',
  'market',
  'position',
] as const);
const MARKET_KEYS = Object.freeze([
  'totalSupplyAssets',
  'totalSupplyShares',
  'totalBorrowAssets',
  'totalBorrowShares',
  'lastUpdate',
  'feeWad',
] as const);
const POSITION_KEYS = Object.freeze(['supplyShares', 'borrowShares', 'collateralAtomic'] as const);

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function sourceFile(
  path: string,
  bytes: number,
  sha256: string,
): Readonly<{ path: string; bytes: number; sha256: string }> {
  return frozen({ path, bytes, sha256 });
}

export const MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION = 1 as const;
export const MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE =
  'DORMANT_MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_ONLY' as const;

/** Hashes cover the exact Git blob payload bytes at the immutable v1.0.0 commit. */
export const MORPHO_BLUE_ACCOUNT_POSITION_SOURCE_PINS = frozen({
  repository: 'morpho-org/morpho-blue',
  releaseTag: 'v1.0.0',
  commitSha: '55d2d99304fb3fb930c688462ae2ccabb1d533ad',
  hashAlgorithm: 'SHA256_OF_GIT_BLOB_PAYLOAD',
  deployedBuildEquivalenceStatus: 'NOT_ESTABLISHED_BY_SOURCE_TAG_ALONE',
  files: frozen([
    sourceFile(
      'src/Morpho.sol',
      22_065,
      '7f66c064ad0bdc046382fa65f449bb5a0b9181d5d03b65e3c8438226d437b9ce',
    ),
    sourceFile(
      'src/interfaces/IMorpho.sol',
      19_695,
      '24f96c2860c42cd5834c56cdb159c56435acaee0716d34d54ca18bd755edc97c',
    ),
    sourceFile(
      'src/interfaces/IIrm.sol',
      899,
      '3ba6e6164cd0ed25d2b1d8d3766667ef016712705fe30094a97fe3801d14e915',
    ),
    sourceFile(
      'src/libraries/ConstantsLib.sol',
      777,
      'd450cc5f56d70f6460ed81c5e2e7a294f5b7644307a4c742754e0d41a8789567',
    ),
    sourceFile(
      'src/libraries/MathLib.sol',
      1_633,
      '2c6728d1bc8f5db81f2a7946f226c3c4a8cffe4134c55450ca445b05727011bc',
    ),
    sourceFile(
      'src/libraries/SharesMathLib.sol',
      2_360,
      '4580deb1b1a3f2ea0b60f2305708428975613d1e94d404d647bcc573a7b2a2f0',
    ),
    sourceFile(
      'src/libraries/MarketParamsLib.sol',
      823,
      '94af290e2a2094b8547b925449484d247bce87cce4fed8902ecf82dd2b49242e',
    ),
    sourceFile(
      'src/libraries/UtilsLib.sol',
      1_196,
      '9d0c8a0855b2f9e9f92111cdf32bdbbd1ff97b7584f0f958b695f2c4cb0d1b34',
    ),
    sourceFile(
      'src/libraries/EventsLib.sol',
      6_232,
      'c267b23c5a3086ed00a712b841ef12b674be508ac8b8cf2e3f289ae09bd1677a',
    ),
    sourceFile(
      'src/libraries/periphery/MorphoBalancesLib.sol',
      5_549,
      'dc5015f71b5cb2bf52876ed2c2b47ba37f4d7ab5970c42aa5a719ffba4f9e4a8',
    ),
    sourceFile(
      'src/libraries/periphery/MorphoLib.sol',
      2_894,
      '76225c63b32442f382744b9726175af03b710872ce122d7eb193b38480bcc353',
    ),
    sourceFile(
      'src/libraries/periphery/MorphoStorageLib.sol',
      4_481,
      '7a693f85512dde527c9ada9e5cbacf3d4ff5ba58c9c29f104d946cbfc596df36',
    ),
  ]),
});

export const MORPHO_BLUE_ACCOUNT_POSITION_ABI = frozen({
  position: frozen({
    signature: 'position(bytes32,address)',
    selector: '0x93c52062',
    returnTypes: frozen(['uint256', 'uint128', 'uint128']),
    meaning: frozen(['supplyShares', 'borrowShares', 'collateral']),
  }),
  market: frozen({
    signature: 'market(bytes32)',
    selector: '0x5c60e39a',
    returnTypes: frozen(['uint128', 'uint128', 'uint128', 'uint128', 'uint128', 'uint128']),
    meaning: frozen([
      'totalSupplyAssets',
      'totalSupplyShares',
      'totalBorrowAssets',
      'totalBorrowShares',
      'lastUpdate',
      'fee',
    ]),
  }),
  idToMarketParams: frozen({
    signature: 'idToMarketParams(bytes32)',
    selector: '0x2c3c9157',
    returnTypes: frozen(['address', 'address', 'address', 'address', 'uint256']),
  }),
  feeRecipient: frozen({
    signature: 'feeRecipient()',
    selector: '0x46904840',
    returnType: 'address',
  }),
  isAuthorized: frozen({
    signature: 'isAuthorized(address,address)',
    selector: '0x65e4ad9e',
    returnType: 'bool',
    meaning: 'DELEGATED_MANAGEMENT_AUTHORITY_NOT_POSITION_OWNERSHIP',
  }),
  borrowRateView: frozen({
    signature:
      'borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128))',
    selector: '0x8c00bf6b',
    returnType: 'uint256',
    meaning: 'BORROW_RATE_PER_SECOND_WAD_FOR_RAW_MARKET_ARGUMENT',
  }),
  accrueInterest: frozen({
    signature: 'accrueInterest((address,address,address,address,uint256))',
    selector: '0x151c1ade',
    stateMutability: 'nonpayable',
    canonicalReaderUse: 'NEVER_SEND; REPRODUCE_PINNED_VIEW_SEMANTICS',
  }),
  createMarketEvent: frozen({
    signature: 'CreateMarket(bytes32,(address,address,address,address,uint256))',
    topic0: '0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac',
    indexed: frozen(['id']),
  }),
});

export const MORPHO_BLUE_ACCOUNT_POSITION_STORAGE = frozen({
  position: frozen({
    supplyShares: 'uint256',
    borrowShares: 'uint128',
    collateral: 'uint128',
    feeRecipientWarning: 'RAW_SUPPLY_SHARES_EXCLUDES_UNACCRUED_FEE_SHARES',
  }),
  market: frozen({
    totalSupplyAssets: 'uint128',
    totalSupplyShares: 'uint128',
    totalBorrowAssets: 'uint128',
    totalBorrowShares: 'uint128',
    lastUpdate: 'uint128',
    fee: 'uint128_WAD_MAX_25_PERCENT',
    warning: 'ASSET_TOTALS_AND_FEE_RECIPIENT_SHARES_ARE_RAW_UNACCRUED_STORAGE',
  }),
});

export const MORPHO_BLUE_ACCOUNT_POSITION_ACCRUAL = frozen({
  wad: WAD.toString(10),
  maximumFeeWad: MAX_FEE_WAD.toString(10),
  elapsed: 'SELECTED_BLOCK_TIMESTAMP - RAW_MARKET_LAST_UPDATE',
  staleRawStatePolicy: 'ALWAYS_PROJECT_TO_SELECTED_BLOCK_WHEN ELAPSED > 0',
  irmCallGate:
    'PINNED VIEW LIBRARY CALLS borrowRateView ONLY WHEN ELAPSED != 0, TOTAL_BORROW_ASSETS != 0, AND IRM != ZERO',
  irmInput: 'EXACT MARKET_PARAMS AND RAW MARKET TUPLE FROM THE SAME EIP_1898 BLOCK',
  genericIrmLimitation:
    'CORE SOURCE DEFINES THE INTERFACE BUT NOT AN ENABLED IRM IMPLEMENTATION; EACH MARKET IRM NEEDS ITS OWN PINNED SOURCE_BUILD_AND_CODE IDENTITY OR THE READER FAILS CLOSED',
  taylor:
    'FIRST = RATE * ELAPSED; SECOND = FLOOR(FIRST^2 / (2*WAD)); THIRD = FLOOR(SECOND*FIRST / (3*WAD)); COMPOUNDED = FIRST+SECOND+THIRD',
  interest: 'FLOOR(RAW_TOTAL_BORROW_ASSETS * COMPOUNDED / WAD)',
  accruedAssets: 'ADD INTEREST TO BOTH TOTAL_BORROW_ASSETS AND TOTAL_SUPPLY_ASSETS',
  feeAmount: 'FLOOR(INTEREST * FEE_WAD / WAD)',
  feeShares:
    'FLOOR(FEE_AMOUNT * (RAW_TOTAL_SUPPLY_SHARES + 1e6) / ((ACCRUED_TOTAL_SUPPLY_ASSETS - FEE_AMOUNT) + 1))',
  feeRecipientPosition:
    'ADD PENDING FEE_SHARES TO RAW POSITION SUPPLY_SHARES ONLY WHEN WALLET EQUALS THE SAME_BLOCK FEE_RECIPIENT',
  overflow:
    'EVERY MULTIPLICATION ADDITION SUBTRACTION AND uint128 CAST USES SOLIDITY_0_8_CHECKED SEMANTICS; ANY REVERT_PATH FAILS CLOSED',
});

export const MORPHO_BLUE_ACCOUNT_POSITION_SHARE_CONVERSION = frozen({
  virtualShares: VIRTUAL_SHARES.toString(10),
  virtualAssets: VIRTUAL_ASSETS.toString(10),
  supplyAssets:
    'FLOOR(ADJUSTED_POSITION_SUPPLY_SHARES * (ACCRUED_TOTAL_SUPPLY_ASSETS + 1) / (ACCRUED_TOTAL_SUPPLY_SHARES + 1e6))',
  supplyRounding: 'DOWN',
  borrowAssets:
    'CEIL(POSITION_BORROW_SHARES * (ACCRUED_TOTAL_BORROW_ASSETS + 1) / (TOTAL_BORROW_SHARES + 1e6))',
  borrowRounding: 'UP',
  borrowWarning:
    'PER_POSITION CEIL CAN EXCEED THE MARKET EXPECTED_TOTAL_BORROW_ASSETS; PRESERVE THE OBSERVED RESULT',
});

export const MORPHO_BLUE_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS = frozen({
  directOwnerKey: 'position(marketId, connectedWalletAddress)',
  authorizationPolicy:
    'isAuthorized ONLY GRANTS MANAGEMENT AUTHORITY; NEVER ATTRIBUTE AN AUTHORIZER POSITION TO AN AUTHORIZED WALLET',
  builtInSubaccounts: false,
  marketEnumeration: frozen({
    coreHasEnumerableMarketList: false,
    requiredSource:
      'COMPLETE NON_TRUNCATED CreateMarket EVENT HISTORY FROM AUTHENTICATED DEPLOYMENT BLOCK THROUGH SELECTED BLOCK',
    eventTopic0: MORPHO_BLUE_ACCOUNT_POSITION_ABI.createMarketEvent.topic0,
    forEveryId:
      'RECOMPUTE ID FROM PARAMS, VERIFY idToMarketParams AND CREATED market STATE, THEN QUERY THE WALLET POSITION',
    deduplicateByMarketId: true,
    skipUnsupportedMarketOrIrm: false,
    standardEthGetLogsCompleteness:
      'NOT PROVEN; RANGE LIMITS OR SILENT TRUNCATION MUST BE DETECTED BY AN APPROVED AUTHENTICATED INDEX OR INDEPENDENT COMPLETE SOURCE',
  }),
  indirectExposure:
    'METAMORPHO_ERC4626_VAULT SHARES ARE NOT DIRECT BLUE position(id,wallet) STORAGE AND REQUIRE A SEPARATE EXHAUSTIVE VAULT_TO_MARKET TOPOLOGY IF INCLUDED IN THE PRODUCT CLAIM',
  mayEstablishCompletePosition: false,
});

export const MORPHO_BLUE_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS = frozen({
  networkId: NETWORK_ID,
  chainId: CHAIN_ID,
  morphoAddress: MORPHO_BLUE_ETHEREUM_ADDRESS,
  deploymentKind: 'DIRECT_NON_PROXY',
  runtimeCodeKeccak256Required: true,
  sourceBuildEquivalenceRequired: true,
  initialBlockSelector: 'finalized',
  eip1898Parameter: frozen({ blockHash: 'SELECTED_FINALIZED_BLOCK_HASH', requireCanonical: true }),
  bindEveryRead: frozen([
    'Morpho and dependency code identities',
    'market params and raw market',
    'feeRecipient',
    'wallet position',
    'IRM borrowRateView with exact raw tuple',
    'complete market discovery evidence',
  ]),
  closeout:
    'RE_READ_SELECTED_HEIGHT AND REQUIRE IDENTICAL NUMBER_HASH_PARENT_STATE_ROOT_TIMESTAMP; RECHECK_CHAIN_ID',
  authenticityLimitation:
    'EIP_1898 PREVENTS INTERNAL BLOCK SKEW BUT DOES NOT AUTHENTICATE AN RPC OR PROVE FINALITY_OR_LOG_COMPLETENESS',
});

const SEMANTICS_FINGERPRINT_BODY = frozen({
  semanticsVersion: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION,
  use: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE,
  mayPersist: false,
  mayAuthorizeFinancialAction: false,
  mayEstablishCompletePosition: false,
  sources: MORPHO_BLUE_ACCOUNT_POSITION_SOURCE_PINS,
  abi: MORPHO_BLUE_ACCOUNT_POSITION_ABI,
  storage: MORPHO_BLUE_ACCOUNT_POSITION_STORAGE,
  accrual: MORPHO_BLUE_ACCOUNT_POSITION_ACCRUAL,
  conversion: MORPHO_BLUE_ACCOUNT_POSITION_SHARE_CONVERSION,
  discovery: MORPHO_BLUE_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS,
  context: MORPHO_BLUE_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS,
});

export const MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256 = createHash('sha256')
  .update('crypto-lending:morpho-blue-account-position-semantics:v1\0', 'utf8')
  .update(JSON.stringify(SEMANTICS_FINGERPRINT_BODY), 'utf8')
  .digest('hex');

export const MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS = frozen({
  ...SEMANTICS_FINGERPRINT_BODY,
  semanticsFingerprintSha256: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
});

export interface EvaluateMorphoBlueAccountPositionSnapshotV1 {
  readonly semanticsVersion: typeof MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION;
  readonly use: typeof MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE;
  readonly mayPersist: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayEstablishCompletePosition: false;
  readonly walletAddress: string;
  readonly feeRecipientAddress: string;
  readonly irmAddress: string;
  readonly blockTimestamp: string;
  readonly borrowRatePerSecondWad: string | null;
  readonly market: Readonly<{
    readonly totalSupplyAssets: string;
    readonly totalSupplyShares: string;
    readonly totalBorrowAssets: string;
    readonly totalBorrowShares: string;
    readonly lastUpdate: string;
    readonly feeWad: string;
  }>;
  readonly position: Readonly<{
    readonly supplyShares: string;
    readonly borrowShares: string;
    readonly collateralAtomic: string;
  }>;
}

export interface MorphoBlueTaylorProjection {
  readonly borrowRatePerSecondWad: string;
  readonly elapsedSeconds: string;
  readonly firstTerm: string;
  readonly secondTerm: string;
  readonly thirdTerm: string;
  readonly compoundedRateWad: string;
}

export interface MorphoBlueShareAssetProjection {
  readonly shares: string;
  readonly assetsAtomic: string;
  readonly exactNumerator: string;
  readonly denominator: string;
  readonly fractionalRemainder: string;
  readonly rounding: 'SUPPLY_DOWN' | 'BORROW_UP';
}

export interface DormantMorphoBlueAccountPositionProjectionV1 {
  readonly semanticsVersion: typeof MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION;
  readonly use: typeof MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE;
  readonly mayPersist: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly mayEstablishCompletePosition: false;
  readonly calculationStatus: 'OFFLINE_CALLER_SUPPLIED_STATE_ONLY';
  readonly completenessStatus: 'NOT_ESTABLISHED';
  readonly currentAt: string;
  readonly elapsedSeconds: string;
  readonly irmReadStatus:
    | 'ZERO_IRM_NO_RATE_READ'
    | 'NO_ELAPSED_TIME_NO_RATE_READ'
    | 'ZERO_BORROW_ASSETS_NO_RATE_READ'
    | 'BORROW_RATE_VIEW_SUPPLIED_UNAUTHENTICATED';
  readonly taylor: MorphoBlueTaylorProjection;
  readonly interestAtomic: string;
  readonly feeAmountAtomic: string;
  readonly pendingFeeShares: string;
  readonly walletIsFeeRecipient: boolean;
  readonly accruedMarket: Readonly<{
    readonly totalSupplyAssets: string;
    readonly totalSupplyShares: string;
    readonly totalBorrowAssets: string;
    readonly totalBorrowShares: string;
  }>;
  readonly position: Readonly<{
    readonly rawSupplyShares: string;
    readonly adjustedSupplyShares: string;
    readonly borrowShares: string;
    readonly collateralAtomic: string;
    readonly supply: MorphoBlueShareAssetProjection;
    readonly borrow: MorphoBlueShareAssetProjection;
  }>;
}

export class MorphoBlueAccountPositionSemanticsUnavailableError extends Error {
  readonly code = 'MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE' as const;

  constructor() {
    super('Morpho Blue account-position semantics are unavailable.');
    this.name = 'MorphoBlueAccountPositionSemanticsUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

function fail(): never {
  throw new MorphoBlueAccountPositionSemanticsUnavailableError();
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
    if (error instanceof MorphoBlueAccountPositionSemanticsUnavailableError) throw error;
    return fail();
  }
}

function canonicalUint(value: unknown, maximum: bigint): bigint {
  if (typeof value !== 'string' || !CANONICAL_UNSIGNED_INTEGER.test(value)) return fail();
  try {
    const parsed = BigInt(value);
    if (parsed > maximum) return fail();
    return parsed;
  } catch {
    return fail();
  }
}

function canonicalAddress(value: unknown, allowZero: boolean): string {
  if (
    typeof value !== 'string' ||
    !EVM_ADDRESS.test(value) ||
    !isAddress(value, { strict: true }) ||
    (!allowZero && value.toLowerCase() === ZERO_ADDRESS)
  ) {
    return fail();
  }
  return value.toLowerCase();
}

function checkedAdd(left: bigint, right: bigint): bigint {
  if (left > MAX_UINT256 - right) return fail();
  return left + right;
}

function checkedMul(left: bigint, right: bigint): bigint {
  if (left !== 0n && right > MAX_UINT256 / left) return fail();
  return left * right;
}

function checkedUint128Add(left: bigint, right: bigint): bigint {
  if (right > MAX_UINT128 || left > MAX_UINT128 - right) return fail();
  return left + right;
}

function mulDivDown(left: bigint, right: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return fail();
  return checkedMul(left, right) / denominator;
}

function taylor(
  borrowRatePerSecondWad: bigint,
  elapsedSeconds: bigint,
): MorphoBlueTaylorProjection {
  const firstTerm = checkedMul(borrowRatePerSecondWad, elapsedSeconds);
  const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD);
  const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD);
  const compoundedRateWad = checkedAdd(checkedAdd(firstTerm, secondTerm), thirdTerm);
  return frozen({
    borrowRatePerSecondWad: borrowRatePerSecondWad.toString(10),
    elapsedSeconds: elapsedSeconds.toString(10),
    firstTerm: firstTerm.toString(10),
    secondTerm: secondTerm.toString(10),
    thirdTerm: thirdTerm.toString(10),
    compoundedRateWad: compoundedRateWad.toString(10),
  });
}

export function projectMorphoBlueTaylorCompounded(
  borrowRatePerSecondWadValue: unknown,
  elapsedSecondsValue: unknown,
): MorphoBlueTaylorProjection {
  return taylor(
    canonicalUint(borrowRatePerSecondWadValue, MAX_UINT256),
    canonicalUint(elapsedSecondsValue, MAX_UINT256),
  );
}

function shareProjection(
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
  rounding: MorphoBlueShareAssetProjection['rounding'],
): MorphoBlueShareAssetProjection {
  const numerator = checkedMul(shares, checkedAdd(totalAssets, VIRTUAL_ASSETS));
  const denominator = checkedAdd(totalShares, VIRTUAL_SHARES);
  const remainder = numerator % denominator;
  const assetsAtomic =
    rounding === 'BORROW_UP'
      ? checkedAdd(numerator, denominator - 1n) / denominator
      : numerator / denominator;
  return frozen({
    shares: shares.toString(10),
    assetsAtomic: assetsAtomic.toString(10),
    exactNumerator: numerator.toString(10),
    denominator: denominator.toString(10),
    fractionalRemainder: remainder.toString(10),
    rounding,
  });
}

export function evaluateMorphoBlueAccountPositionSnapshot(
  value: unknown,
): DormantMorphoBlueAccountPositionProjectionV1 {
  const record = exactRecord(value, SNAPSHOT_KEYS);
  if (
    record.semanticsVersion !== MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION ||
    record.use !== MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE ||
    record.mayPersist !== false ||
    record.mayAuthorizeFinancialAction !== false ||
    record.mayEstablishCompletePosition !== false
  ) {
    return fail();
  }

  const walletAddress = canonicalAddress(record.walletAddress, false);
  const feeRecipientAddress = canonicalAddress(record.feeRecipientAddress, true);
  const irmAddress = canonicalAddress(record.irmAddress, true);
  const blockTimestamp = canonicalUint(record.blockTimestamp, MAX_UINT256);
  const marketRecord = exactRecord(record.market, MARKET_KEYS);
  const totalSupplyAssets = canonicalUint(marketRecord.totalSupplyAssets, MAX_UINT128);
  const totalSupplyShares = canonicalUint(marketRecord.totalSupplyShares, MAX_UINT128);
  const totalBorrowAssets = canonicalUint(marketRecord.totalBorrowAssets, MAX_UINT128);
  const totalBorrowShares = canonicalUint(marketRecord.totalBorrowShares, MAX_UINT128);
  const lastUpdate = canonicalUint(marketRecord.lastUpdate, MAX_UINT128);
  const feeWad = canonicalUint(marketRecord.feeWad, MAX_FEE_WAD);
  if (
    lastUpdate === 0n ||
    lastUpdate > blockTimestamp ||
    totalBorrowAssets > totalSupplyAssets ||
    (totalBorrowAssets === 0n) !== (totalBorrowShares === 0n) ||
    (totalSupplyAssets !== 0n && totalSupplyShares === 0n)
  ) {
    return fail();
  }

  const positionRecord = exactRecord(record.position, POSITION_KEYS);
  const rawSupplyShares = canonicalUint(positionRecord.supplyShares, MAX_UINT256);
  const borrowShares = canonicalUint(positionRecord.borrowShares, MAX_UINT128);
  const collateralAtomic = canonicalUint(positionRecord.collateralAtomic, MAX_UINT128);
  if (rawSupplyShares > totalSupplyShares || borrowShares > totalBorrowShares) return fail();

  const elapsedSeconds = blockTimestamp - lastUpdate;
  const shouldReadRate =
    elapsedSeconds !== 0n && totalBorrowAssets !== 0n && irmAddress !== ZERO_ADDRESS;
  let borrowRatePerSecondWad = 0n;
  let irmReadStatus: DormantMorphoBlueAccountPositionProjectionV1['irmReadStatus'];
  if (shouldReadRate) {
    borrowRatePerSecondWad = canonicalUint(record.borrowRatePerSecondWad, MAX_UINT256);
    irmReadStatus = 'BORROW_RATE_VIEW_SUPPLIED_UNAUTHENTICATED';
  } else {
    if (record.borrowRatePerSecondWad !== null) return fail();
    irmReadStatus =
      irmAddress === ZERO_ADDRESS
        ? 'ZERO_IRM_NO_RATE_READ'
        : elapsedSeconds === 0n
          ? 'NO_ELAPSED_TIME_NO_RATE_READ'
          : 'ZERO_BORROW_ASSETS_NO_RATE_READ';
  }

  const taylorProjection = taylor(borrowRatePerSecondWad, shouldReadRate ? elapsedSeconds : 0n);
  const compoundedRateWad = BigInt(taylorProjection.compoundedRateWad);
  const interestAtomic = mulDivDown(totalBorrowAssets, compoundedRateWad, WAD);
  const accruedTotalBorrowAssets = checkedUint128Add(totalBorrowAssets, interestAtomic);
  const accruedTotalSupplyAssets = checkedUint128Add(totalSupplyAssets, interestAtomic);
  const feeAmountAtomic = mulDivDown(interestAtomic, feeWad, WAD);
  if (feeAmountAtomic > accruedTotalSupplyAssets) return fail();
  const feeConversionAssets = accruedTotalSupplyAssets - feeAmountAtomic;
  const pendingFeeShares = mulDivDown(
    feeAmountAtomic,
    checkedAdd(totalSupplyShares, VIRTUAL_SHARES),
    checkedAdd(feeConversionAssets, VIRTUAL_ASSETS),
  );
  const accruedTotalSupplyShares = checkedUint128Add(totalSupplyShares, pendingFeeShares);
  const walletIsFeeRecipient = walletAddress === feeRecipientAddress;
  const adjustedSupplyShares = walletIsFeeRecipient
    ? checkedAdd(rawSupplyShares, pendingFeeShares)
    : rawSupplyShares;
  if (adjustedSupplyShares > accruedTotalSupplyShares) return fail();

  const supply = shareProjection(
    adjustedSupplyShares,
    accruedTotalSupplyAssets,
    accruedTotalSupplyShares,
    'SUPPLY_DOWN',
  );
  const borrow = shareProjection(
    borrowShares,
    accruedTotalBorrowAssets,
    totalBorrowShares,
    'BORROW_UP',
  );

  return frozen({
    semanticsVersion: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION,
    use: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE,
    mayPersist: false as const,
    mayAuthorizeFinancialAction: false as const,
    mayEstablishCompletePosition: false as const,
    calculationStatus: 'OFFLINE_CALLER_SUPPLIED_STATE_ONLY' as const,
    completenessStatus: 'NOT_ESTABLISHED' as const,
    currentAt: blockTimestamp.toString(10),
    elapsedSeconds: elapsedSeconds.toString(10),
    irmReadStatus,
    taylor: taylorProjection,
    interestAtomic: interestAtomic.toString(10),
    feeAmountAtomic: feeAmountAtomic.toString(10),
    pendingFeeShares: pendingFeeShares.toString(10),
    walletIsFeeRecipient,
    accruedMarket: frozen({
      totalSupplyAssets: accruedTotalSupplyAssets.toString(10),
      totalSupplyShares: accruedTotalSupplyShares.toString(10),
      totalBorrowAssets: accruedTotalBorrowAssets.toString(10),
      totalBorrowShares: totalBorrowShares.toString(10),
    }),
    position: frozen({
      rawSupplyShares: rawSupplyShares.toString(10),
      adjustedSupplyShares: adjustedSupplyShares.toString(10),
      borrowShares: borrowShares.toString(10),
      collateralAtomic: collateralAtomic.toString(10),
      supply,
      borrow,
    }),
  });
}
