import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_CREDIT_ACCOUNTS = 65_536;
const CANONICAL_UINT256 = /^(?:0|[1-9][0-9]{0,77})$/u;

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

export const GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_VERSION = 1 as const;
export const GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_USE =
  'DORMANT_GEARBOX_V3_USDC_ACCOUNT_POSITION_SEMANTICS_ONLY' as const;

/** SHA-256 covers exact Git blob payload bytes at each immutable commit. */
export const GEARBOX_V3_ACCOUNT_POSITION_SOURCE_PINS = frozen({
  hashAlgorithm: 'SHA256_OF_GIT_BLOB_PAYLOAD',
  securityRepository: 'Gearbox-protocol/security',
  securityCommitSha: '684522eae18dea73a8aecda25d8743bfa724446a',
  securityFiles: frozen([
    sourceFile(
      'bug-bounty/v3-scope.md',
      25_378,
      '17fb638e4ef642a41eda0c5af1aa8bbd15e5b603d382905c0e3cafa4b146cb96',
    ),
  ]),
  coreRepository: 'Gearbox-protocol/core-v3',
  coreCommitSha: 'e16559ae82f0f24c3dc29693c444f40d676ebff9',
  coreFiles: frozen([
    sourceFile(
      'contracts/pool/PoolV3.sol',
      34_840,
      '77bea7983c43b88dfb4b9057935209115fcdeedff7768962c4ccde8c0c285295',
    ),
    sourceFile(
      'contracts/interfaces/IPoolV3.sol',
      4_834,
      '81e0de5531f70f06fe035fff6f24401ac5466cb316fe4ff2882adc6b55e56542',
    ),
    sourceFile(
      'contracts/credit/CreditManagerV3.sol',
      61_776,
      'e303bfced701240189ada2aa25ee4dca1a3ccbccd45c59cbf138dc20bea978f6',
    ),
    sourceFile(
      'contracts/interfaces/ICreditManagerV3.sol',
      9_648,
      '8835e0f770d5eb58962efc660593c9fbac972daa437bfa2949aaf91d34747699',
    ),
    sourceFile(
      'contracts/credit/CreditFacadeV3.sol',
      52_798,
      '8d0eaa4b8d1b3031ef6f437c4e063fe6416c862534c02d4b063bcec50d94a3a4',
    ),
    sourceFile(
      'contracts/interfaces/ICreditFacadeV3.sol',
      5_670,
      'ae03dfc802061058b6baec63205036fd2174ad1c2b5cd39421ba5063cc527070',
    ),
    sourceFile(
      'contracts/credit/CreditAccountV3.sol',
      3_349,
      '0d4a3b57a68f4954c5b4160e89c5ae4261683053651e5a2f05e29d8a06042cb7',
    ),
    sourceFile(
      'contracts/interfaces/ICreditAccountV3.sol',
      1_112,
      'dcc9da3edef8dfb82558e423be9fe62c736543cbb3966fe116dee4b8576f0948',
    ),
    sourceFile(
      'contracts/libraries/CreditLogic.sol',
      13_158,
      '2ba36f42b407a4bbe439882253975b2a216eb3dd972d0330a450c5fa5bb475a7',
    ),
    sourceFile(
      'contracts/pool/PoolQuotaKeeperV3.sol',
      22_031,
      '6a9a46b86bf058a489b2c08cc8a6feb3c72df24817ed3abfb493bfb71acb197e',
    ),
    sourceFile(
      'contracts/interfaces/IPoolQuotaKeeperV3.sol',
      3_747,
      'bdb7546ef76f12e67a58b1873e6984d48d832c03b3b02dc59d8b868fab0ac997',
    ),
    sourceFile(
      'contracts/core/AccountFactoryV3.sol',
      7_169,
      '3ece291f97f9f4f340add8e0bd332cd524d621b1fb28c9cdb77e5877ef4b35ea',
    ),
    sourceFile(
      'contracts/interfaces/IAccountFactoryV3.sol',
      1_921,
      '8aa1a2b6e3ead5d14debd0fc8de6a012ad84cd320cbed95ca7cfac05b0dd07ec',
    ),
    sourceFile(
      'contracts/interfaces/IAddressProviderV3.sol',
      1_502,
      '0b33ce0bcf2221468d9f71d2539b4f018d4b5a5d4fc1e1ca823a9320a6985a39',
    ),
    sourceFile(
      'contracts/traits/ContractsRegisterTrait.sol',
      2_392,
      '2722cd5fa153550615b9da2c46a232ad55a271873802a1cad5c87b0560af39ca',
    ),
    sourceFile(
      'package.json',
      1_318,
      '15482626ae1e470032300bfcb6b4ebcea6be414f4462fae7d38f4c2615a1271a',
    ),
    sourceFile(
      'yarn.lock',
      219_517,
      '905e1eb9c71b71e8757695daf84c93cb6410d5b963f0753d9280663ee45e48e0',
    ),
  ]),
  openZeppelinRepository: 'OpenZeppelin/openzeppelin-contracts',
  openZeppelinTag: 'v4.9.3',
  openZeppelinCommitSha: 'fd81a96f01cc42ef1c9a5399364968d0e07e9e90',
  openZeppelinFiles: frozen([
    sourceFile(
      'contracts/utils/math/Math.sol',
      12_785,
      '85a2caf3bd06579fb55236398c1321e15fd524a8fe140dff748c0f73d7a52345',
    ),
    sourceFile(
      'contracts/token/ERC20/extensions/ERC4626.sol',
      11_447,
      '0610f62eeae3a7dee46c4c37cc80c59060fd56cea7fb1e00a950f1e6a2f981ac',
    ),
    sourceFile(
      'contracts/utils/structs/EnumerableSet.sol',
      12_960,
      'a64e5d0e83019d9caa51e6fe6f68ac54b583ac15792b8557cb8e4fab20711b9f',
    ),
    sourceFile(
      'contracts/proxy/Clones.sol',
      4_031,
      'fe993ed37cc4c1951524e9572498f897df00ea6f0525620fda327992f789261c',
    ),
  ]),
});

export const GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES = frozen({
  networkId: 'eip155:1',
  chainId: '0x1',
  poolAddress: '0xda00000035fef4082f78def6a8903bee419fbf8e',
  underlyingUsdcAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  addressProviderAddress: '0x9ea7b04da02a5373317d745c1571c84aad03321d',
  contractsRegisterAddress: '0xa50d4e7d8946a7c90652339cdbd262c375d54d99',
  accountFactoryAddress: '0x444cd42baeddeb707eed823f7177b9abcc779c04',
  poolAndUnderlyingDecimals: 6,
  supportedContractVersion: '300',
  deploymentModel: 'DIRECT_IMMUTABLE_POOL_V3_00',
});

export const GEARBOX_V3_ACCOUNT_POSITION_ABI = frozen({
  addressProviderGetAddressOrRevert: frozen({
    signature: 'getAddressOrRevert(bytes32,uint256)',
    selector: '0x57b5a1c6',
    requiredKeys: frozen([
      'CONTRACTS_REGISTER_ASCII_RIGHT_PADDED_BYTES32_NO_VERSION_CONTROL_0',
      'ACCOUNT_FACTORY_ASCII_RIGHT_PADDED_BYTES32_NO_VERSION_CONTROL_0',
    ]),
  }),
  contractsRegisterIsPool: frozen({
    signature: 'isPool(address)',
    selector: '0x5b16ebb7',
    returnType: 'bool',
  }),
  poolBalanceOf: frozen({
    signature: 'balanceOf(address)',
    selector: '0x70a08231',
    returnType: 'uint256',
  }),
  poolTotalSupply: frozen({
    signature: 'totalSupply()',
    selector: '0x18160ddd',
    returnType: 'uint256',
  }),
  poolTotalAssets: frozen({
    signature: 'totalAssets()',
    selector: '0x01e1d114',
    returnType: 'uint256',
  }),
  poolAsset: frozen({ signature: 'asset()', selector: '0x38d52e0f', returnType: 'address' }),
  poolPreviewRedeem: frozen({ signature: 'previewRedeem(uint256)', selector: '0x4cdad506' }),
  poolWithdrawFee: frozen({ signature: 'withdrawFee()', selector: '0xe941fa78' }),
  poolCreditManagers: frozen({ signature: 'creditManagers()', selector: '0xdac54431' }),
  poolAddressProvider: frozen({ signature: 'addressProvider()', selector: '0x2954018c' }),
  poolUnderlyingToken: frozen({ signature: 'underlyingToken()', selector: '0x2495a599' }),
  poolQuotaKeeper: frozen({ signature: 'poolQuotaKeeper()', selector: '0xbe8da14b' }),
  poolTotalDebtLimit: frozen({
    signature: 'totalDebtLimit()',
    selector: '0x183ace90',
    meaning: 'POOL_WIDE_DEBT_CAP_NEVER_WALLET_DEBT',
  }),
  managerPool: frozen({ signature: 'pool()', selector: '0x16f0115b' }),
  managerUnderlying: frozen({ signature: 'underlying()', selector: '0x6f307dc3' }),
  managerAddressProvider: frozen({ signature: 'addressProvider()', selector: '0x2954018c' }),
  managerCreditFacade: frozen({ signature: 'creditFacade()', selector: '0x2f7a1881' }),
  managerAccountFactory: frozen({ signature: 'accountFactory()', selector: '0x687cd9c1' }),
  managerQuotaKeeper: frozen({ signature: 'poolQuotaKeeper()', selector: '0xbe8da14b' }),
  managerCreditAccountsLength: frozen({ signature: 'creditAccountsLen()', selector: '0xf13d0fc6' }),
  managerCreditAccountsPage: frozen({
    signature: 'creditAccounts(uint256,uint256)',
    selector: '0x2c9db6f1',
  }),
  managerCreditAccountInfo: frozen({
    signature: 'creditAccountInfo(address)',
    selector: '0x3c5bc3b2',
    returnTypes: frozen([
      'uint256 debt',
      'uint256 cumulativeIndexLastUpdate',
      'uint128 cumulativeQuotaInterest',
      'uint128 quotaFees',
      'uint256 enabledTokensMask',
      'uint16 flags',
      'uint64 lastDebtUpdate',
      'address borrower',
    ]),
  }),
  managerDebtAndCollateral: frozen({
    signature: 'calcDebtAndCollateral(address,uint8)',
    selector: '0x0d334ca6',
    task: 'DEBT_ONLY_ENUM_VALUE_1',
    returnTypes: frozen([
      'uint256 debt',
      'uint256 cumulativeIndexNow',
      'uint256 cumulativeIndexLastUpdate',
      'uint128 cumulativeQuotaInterest',
      'uint256 accruedInterest',
      'uint256 accruedFees',
      'uint256 totalDebtUSD',
      'uint256 totalValue',
      'uint256 totalValueUSD',
      'uint256 twvUSD',
      'uint256 enabledTokensMask',
      'uint256 quotedTokensMask',
      'address[] quotedTokens',
      'address poolQuotaKeeper',
    ]),
  }),
  facadeCreditManager: frozen({ signature: 'creditManager()', selector: '0xc12c21c0' }),
  creditAccountManager: frozen({ signature: 'creditManager()', selector: '0xc12c21c0' }),
  creditAccountFactory: frozen({ signature: 'factory()', selector: '0xc45a0155' }),
  quotaKeeperPool: frozen({ signature: 'pool()', selector: '0x16f0115b' }),
  quotaKeeperUnderlying: frozen({ signature: 'underlying()', selector: '0x6f307dc3' }),
  contractVersion: frozen({ signature: 'version()', selector: '0x54fd4d50' }),
  tokenDecimals: frozen({ signature: 'decimals()', selector: '0x313ce567' }),
});

export const GEARBOX_V3_ACCOUNT_POSITION_SUPPLY_SEMANTICS = frozen({
  positionIdentity: 'DIRECT_WALLET_BALANCE_OF_USDC_POOL_DIESEL_SHARES',
  excludedBalances: frozen([
    'UNDERLYING_USDC_BALANCE_IN_WALLET',
    'DIESEL_SHARES_HELD_BY_A_ZAPPER_OR_FARMING_WRAPPER',
    'CREDIT_ACCOUNT_COLLATERAL',
  ]),
  grossUnderlyingFormula:
    'TOTAL_SUPPLY_IS_ZERO ? SHARES : FLOOR(SHARES * TOTAL_ASSETS / TOTAL_SUPPLY)',
  totalAssetsMeaning: 'POOL_EXPECTED_LIQUIDITY_IN_UNDERLYING_USDC_ATOMIC_UNITS',
  rounding: 'SUPPLY_FLOOR',
  multiplication:
    'OPENZEPPELIN_512_BIT_MULDIV; INTERMEDIATE MAY EXCEED_UINT256; REJECT IF QUOTIENT_EXCEEDS_UINT256',
  sameBlockInvariant:
    'WALLET balanceOf MUST NOT EXCEED totalSupply; NONZERO WALLET SHARES WITH ZERO totalSupply FAIL CLOSED',
  previewRedeemMeaning:
    'OPTIONAL_NET_REDEMPTION_ESTIMATE_AFTER_WITHDRAWAL_FEE_NOT_THE_GROSS_SUPPLIED_POSITION',
  strictZero:
    'ZERO_SHARES_MEANS_ZERO_DIRECT_SUPPLY; ZERO_OUTPUT_NEVER PROVES COMPLETENESS WITHOUT THE FULL TRANSCRIPT',
});

export const GEARBOX_V3_ACCOUNT_POSITION_DEBT_SEMANTICS = frozen({
  positionIdentity: 'WALLET_OWNED_ACTIVE_CREDIT_ACCOUNT_DEBT_IN_POOL_UNDERLYING_USDC',
  canonicalRead: 'CREDIT_MANAGER.calcDebtAndCollateral(CREDIT_ACCOUNT, DEBT_ONLY_ENUM_VALUE_1)',
  protocolTotalDebtFormula: 'DEBT + ACCRUED_INTEREST + ACCRUED_FEES',
  creditAccountInfoDebtMeaning:
    'STORED PRINCIPAL ONLY; NEVER REPORT creditAccountInfo.debt ALONE AS CURRENT TOTAL DEBT',
  quotaInterestTreatment:
    'ACCRUED_INTEREST_ALREADY_INCLUDES STORED_AND_OUTSTANDING_CUMULATIVE_QUOTA_INTEREST',
  rounding: 'USE_PROTOCOL_RETURNED_INTEGER_COMPONENTS; CHECKED_UINT256_SUM_WITH_NO LOSSY DOWNCAST',
  totalDebtLimitPolicy:
    'NEVER USE POOL.totalDebtLimit OR MANAGER DEBT LIMIT AS A WALLET DEBT OR POSITION',
  strictZero:
    'ZERO BORROW REQUIRES EVERY ACTIVE CREDIT ACCOUNT OF EVERY POOL MANAGER TO BE ENUMERATED AND EVERY WALLET-OWNED ACCOUNT TO SUM TO ZERO',
});

export const GEARBOX_V3_ACCOUNT_POSITION_TOPOLOGY_REQUIREMENTS = frozen({
  root: frozen({
    requiredRelations: frozen([
      'POOL.addressProvider == EXACT_ADDRESS_PROVIDER',
      'POOL.underlyingToken == EXACT_USDC',
      'POOL.asset == EXACT_USDC',
      'CONTRACTS_REGISTER.isPool(EXACT_USDC_POOL) == true',
      'ADDRESS_PROVIDER.CONTRACTS_REGISTER == EXACT_CONTRACTS_REGISTER',
      'ADDRESS_PROVIDER.ACCOUNT_FACTORY == EXACT_ACCOUNT_FACTORY',
      'POOL.version == 300',
      'POOL.decimals == 6',
      'UNDERLYING_USDC.decimals == 6',
    ]),
    runtimeCodeSha256Required: frozen([
      'POOL',
      'UNDERLYING_USDC',
      'ADDRESS_PROVIDER',
      'CONTRACTS_REGISTER',
    ]),
  }),
  poolManagerUniverse: frozen({
    source: 'POOL.creditManagers()',
    semantics: 'ALL MANAGERS EVER CONNECTED TO THIS POOL; DO NOT FILTER ZERO-LIMIT MANAGERS',
    maximumManagers: 64,
    requireUniqueNonzeroAddresses: true,
    repeatedManagerList: 'REPEAT AFTER ALL ACCOUNT READS AND REQUIRE THE IDENTICAL ORDERED LIST',
    securityScopeListsAreNotTopology:
      'THE PINNED SECURITY FILE LISTS DEPLOYMENTS BUT DOES NOT MAP MANAGERS TO THIS POOL',
  }),
  perManager: frozen({
    requiredRelations: frozen([
      'MANAGER.pool == EXACT_USDC_POOL',
      'MANAGER.underlying == EXACT_USDC',
      'MANAGER.addressProvider == EXACT_ADDRESS_PROVIDER',
      'MANAGER.accountFactory == EXACT_ACCOUNT_FACTORY',
      'MANAGER.creditFacade == ENUMERATED_FACADE',
      'FACADE.creditManager == MANAGER',
      'MANAGER.poolQuotaKeeper == POOL.poolQuotaKeeper',
      'MANAGER.version == 300',
      'FACADE.version == 300',
      'ACCOUNT_FACTORY.version == 300',
    ]),
    runtimeCodeSha256Required: frozen([
      'MANAGER',
      'FACADE',
      'POOL_QUOTA_KEEPER',
      'ACCOUNT_FACTORY',
    ]),
    versionMustEqual: '300',
    unsupportedManagerPolicy: 'FAIL_THE_WHOLE_POSITION_READ_NEVER_SKIP',
  }),
  currentPoolQuotaKeeper: frozen({
    requiredRelations: frozen([
      'POOL_QUOTA_KEEPER.pool == EXACT_USDC_POOL',
      'POOL_QUOTA_KEEPER.underlying == EXACT_USDC',
      'POOL_QUOTA_KEEPER.version == 300',
    ]),
    runtimeCodeSha256Required: true,
    replacementPolicy:
      'USE ONLY POOL.poolQuotaKeeper FROM THE BOUND BLOCK; A HISTORICAL KEEPER ADDRESS IS NOT CURRENT TOPOLOGY',
  }),
  creditAccountUniverse: frozen({
    lengthSource: 'MANAGER.creditAccountsLen()',
    pageSource: 'MANAGER.creditAccounts(OFFSET,LIMIT)',
    pageSize: 128,
    maximumAccountsAcrossManagers: MAX_CREDIT_ACCOUNTS,
    coverage:
      'GAPLESS [0,LENGTH) PAGES; EXACT EXPECTED PAGE LENGTHS; REPEATED LENGTH; UNIQUE NONZERO ADDRESSES GLOBALLY',
    inspectEveryAccount: true,
    requiredRelations: frozen([
      'CREDIT_ACCOUNT.creditManager == ENUMERATING_MANAGER',
      'CREDIT_ACCOUNT.factory == MANAGER.accountFactory',
      'CREDIT_ACCOUNT.version == 300',
      'MANAGER.creditAccountInfo(CREDIT_ACCOUNT).borrower IS NONZERO',
    ]),
    sameBlockDebtCrossChecks: frozen([
      'DEBT_ONLY.debt == CREDIT_ACCOUNT_INFO.debt',
      'DEBT_ONLY.cumulativeIndexLastUpdate == CREDIT_ACCOUNT_INFO.cumulativeIndexLastUpdate',
      'DEBT_ONLY.enabledTokensMask == CREDIT_ACCOUNT_INFO.enabledTokensMask',
      'DEBT_ONLY.poolQuotaKeeper == BOUND_CURRENT_POOL_QUOTA_KEEPER',
    ]),
    runtimeCodeSha256Required: true,
    reusePolicy:
      'ATTRIBUTE ONLY THE SAME-BLOCK BORROWER FIELD; NEVER INFER CURRENT OWNERSHIP FROM HISTORICAL FACADE EVENTS',
  }),
  walletDebtAggregation:
    'FOR EVERY ENUMERATED ACCOUNT WHOSE SAME-BLOCK BORROWER EQUALS THE AUTHENTICATED WALLET, SUM THE DEBT_ONLY COMPONENTS; PRESERVE MANAGER AND ACCOUNT EVIDENCE INTERNALLY',
  walletSupplyAggregation:
    'READ THE EXACT POOL balanceOf(AUTHENTICATED_WALLET) ONCE; CREDIT-ACCOUNT TOKEN BALANCES ARE NOT DIESEL SUPPLY',
  mayEstablishCompletePosition: false,
  reason:
    'SEMANTICS ONLY; NO AUTHENTICATED EXHAUSTIVE TRANSCRIPT, CALLER-APPROVED TOPOLOGY HASHES, OR INDEPENDENT FINALITY SOURCE IS WIRED',
});

export const GEARBOX_V3_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS = frozen({
  durableContextFirst:
    'AUTHENTICATED WALLET ADDRESS AND RETAINED CONTINUITY FLOOR BEFORE ANY TRANSCRIPT WORK',
  initialBlockSelector: 'finalized',
  eip1898Parameter: frozen({ blockHash: 'SELECTED_FINALIZED_BLOCK_HASH', requireCanonical: true }),
  bindEveryOperation: frozen([
    'all eth_getCode reads and code hashes',
    'pool identity, supply, manager-list, and quota-keeper reads',
    'every manager and facade topology read',
    'every manager account-length and gapless page read',
    'every credit-account topology, borrower, and DEBT_ONLY read',
  ]),
  responseBounds: frozen({
    maximumManagers: 64,
    maximumAccountsAcrossManagers: MAX_CREDIT_ACCOUNTS,
    maximumPageSize: 128,
    exceededPolicy: 'FAIL_CLOSED_NEVER_TRUNCATE',
  }),
  failureLifecycle: frozen({
    absoluteDeadlineRequired: true,
    abortSignalRequired: true,
    stopSchedulingAfterFailure: true,
    settleEveryStartedOperation: true,
    drainOrCancelEveryResponseBody: true,
    sanitizedFailureOnly: 'GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE',
  }),
  closeout:
    'RE-READ SELECTED HEIGHT AND REQUIRE IDENTICAL NUMBER HASH PARENT STATE ROOT TIMESTAMP; RECHECK CHAIN ID AND CONTINUITY FLOOR',
  contentBinding:
    'CALLER-APPROVED RUNTIME CODE SHA256 VALUES PLUS A DOMAIN-SEPARATED HASH OF THE COMPLETE ORDERED TOPOLOGY AND ACCOUNT TRANSCRIPT',
  sourceAuthenticity:
    'EIP-1898 MAKES CALLS STATE-COHERENT BUT ONE RPC DOES NOT AUTHENTICATE RESULTS OR INDEPENDENT FINALITY',
});

const SEMANTICS_FINGERPRINT_BODY = frozen({
  semanticsVersion: GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_VERSION,
  use: GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_USE,
  mayPersist: false,
  mayAuthorizeFinancialAction: false,
  maySign: false,
  mayAccessWalletPrivateKey: false,
  mayEstablishCompletePosition: false,
  sources: GEARBOX_V3_ACCOUNT_POSITION_SOURCE_PINS,
  identities: GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES,
  abi: GEARBOX_V3_ACCOUNT_POSITION_ABI,
  supply: GEARBOX_V3_ACCOUNT_POSITION_SUPPLY_SEMANTICS,
  debt: GEARBOX_V3_ACCOUNT_POSITION_DEBT_SEMANTICS,
  topology: GEARBOX_V3_ACCOUNT_POSITION_TOPOLOGY_REQUIREMENTS,
  context: GEARBOX_V3_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS,
});

export const GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256 = createHash('sha256')
  .update('crypto-lending:gearbox-v3-account-position-semantics:v1\0', 'utf8')
  .update(JSON.stringify(SEMANTICS_FINGERPRINT_BODY), 'utf8')
  .digest('hex');

export const GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS = frozen({
  ...SEMANTICS_FINGERPRINT_BODY,
  semanticsFingerprintSha256: GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
});

export class GearboxV3AccountPositionSemanticsUnavailableError extends Error {
  readonly code = 'GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE' as const;

  constructor() {
    super('Gearbox V3 account-position semantics are unavailable.');
    this.name = 'GearboxV3AccountPositionSemanticsUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

function fail(): never {
  throw new GearboxV3AccountPositionSemanticsUnavailableError();
}

function canonicalUint256(value: unknown): bigint {
  if (typeof value !== 'string' || !CANONICAL_UINT256.test(value)) return fail();
  try {
    const parsed = BigInt(value);
    if (parsed > MAX_UINT256) return fail();
    return parsed;
  } catch {
    return fail();
  }
}

export interface GearboxV3DieselSupplyProjection {
  readonly sharesAtomic: string;
  readonly totalAssetsAtomic: string;
  readonly totalSupplyAtomic: string;
  readonly branch: 'ZERO_TOTAL_SUPPLY_ONE_TO_ONE' | 'MULDIV_DOWN';
  readonly exactNumerator: string;
  readonly denominator: string;
  readonly fractionalRemainder: string;
  readonly suppliedUnderlyingAtomic: string;
  readonly rounding: 'SUPPLY_FLOOR';
}

export function projectGearboxV3DieselSharesToUnderlyingDown(
  sharesValue: unknown,
  totalAssetsValue: unknown,
  totalSupplyValue: unknown,
): GearboxV3DieselSupplyProjection {
  const shares = canonicalUint256(sharesValue);
  const totalAssets = canonicalUint256(totalAssetsValue);
  const totalSupply = canonicalUint256(totalSupplyValue);
  if (shares > totalSupply) return fail();
  if (totalSupply === 0n) {
    return frozen({
      sharesAtomic: shares.toString(10),
      totalAssetsAtomic: totalAssets.toString(10),
      totalSupplyAtomic: '0',
      branch: 'ZERO_TOTAL_SUPPLY_ONE_TO_ONE' as const,
      exactNumerator: '0',
      denominator: '1',
      fractionalRemainder: '0',
      suppliedUnderlyingAtomic: '0',
      rounding: 'SUPPLY_FLOOR' as const,
    });
  }
  const numerator = shares * totalAssets;
  const supplied = numerator / totalSupply;
  if (supplied > MAX_UINT256) return fail();
  return frozen({
    sharesAtomic: shares.toString(10),
    totalAssetsAtomic: totalAssets.toString(10),
    totalSupplyAtomic: totalSupply.toString(10),
    branch: 'MULDIV_DOWN' as const,
    exactNumerator: numerator.toString(10),
    denominator: totalSupply.toString(10),
    fractionalRemainder: (numerator % totalSupply).toString(10),
    suppliedUnderlyingAtomic: supplied.toString(10),
    rounding: 'SUPPLY_FLOOR' as const,
  });
}

export interface GearboxV3CreditAccountDebtProjection {
  readonly principalDebtAtomic: string;
  readonly accruedInterestAtomic: string;
  readonly accruedFeesAtomic: string;
  readonly debtAtomic: string;
  readonly rounding: 'PROTOCOL_INTEGER_COMPONENTS_CHECKED_SUM';
}

export function projectGearboxV3CreditAccountDebt(
  principalDebtValue: unknown,
  accruedInterestValue: unknown,
  accruedFeesValue: unknown,
): GearboxV3CreditAccountDebtProjection {
  const principal = canonicalUint256(principalDebtValue);
  const interest = canonicalUint256(accruedInterestValue);
  const fees = canonicalUint256(accruedFeesValue);
  if (principal > MAX_UINT256 - interest) return fail();
  const debtWithInterest = principal + interest;
  if (debtWithInterest > MAX_UINT256 - fees) return fail();
  return frozen({
    principalDebtAtomic: principal.toString(10),
    accruedInterestAtomic: interest.toString(10),
    accruedFeesAtomic: fees.toString(10),
    debtAtomic: (debtWithInterest + fees).toString(10),
    rounding: 'PROTOCOL_INTEGER_COMPONENTS_CHECKED_SUM' as const,
  });
}

function exactDebtArray(value: unknown): readonly unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return fail();
    }
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      !length ||
      !('value' in length) ||
      typeof length.value !== 'number' ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > MAX_CREDIT_ACCOUNTS
    ) {
      return fail();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const expected = [
      ...Array.from({ length: length.value }, (_, index) => String(index)),
      'length',
    ];
    const actual = Reflect.ownKeys(descriptors);
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      return fail();
    }
    return expected.slice(0, -1).map((key) => {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
      return descriptor.value;
    });
  } catch (error) {
    if (error instanceof GearboxV3AccountPositionSemanticsUnavailableError) throw error;
    return fail();
  }
}

export interface DormantGearboxV3DebtAggregate {
  readonly mayPersist: false;
  readonly mayAuthorizeFinancialAction: false;
  readonly maySign: false;
  readonly mayAccessWalletPrivateKey: false;
  readonly mayEstablishCompletePosition: false;
  readonly calculationStatus: 'OFFLINE_CALLER_SUPPLIED_VALUES_ONLY';
  readonly completenessStatus: 'NOT_ESTABLISHED_BY_MATH_ONLY';
  readonly creditAccountCount: string;
  readonly debtAtomic: string;
}

export function aggregateGearboxV3CreditAccountDebtAtomic(
  debtValues: unknown,
): DormantGearboxV3DebtAggregate {
  const values = exactDebtArray(debtValues);
  let total = 0n;
  for (const value of values) {
    const debt = canonicalUint256(value);
    if (total > MAX_UINT256 - debt) return fail();
    total += debt;
  }
  return frozen({
    mayPersist: false as const,
    mayAuthorizeFinancialAction: false as const,
    maySign: false as const,
    mayAccessWalletPrivateKey: false as const,
    mayEstablishCompletePosition: false as const,
    calculationStatus: 'OFFLINE_CALLER_SUPPLIED_VALUES_ONLY' as const,
    completenessStatus: 'NOT_ESTABLISHED_BY_MATH_ONLY' as const,
    creditAccountCount: values.length.toString(10),
    debtAtomic: total.toString(10),
  });
}
