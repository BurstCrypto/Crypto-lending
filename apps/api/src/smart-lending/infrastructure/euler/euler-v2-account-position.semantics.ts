import { createHash } from 'node:crypto';

import { parseEvmWalletAddress } from '../../../wallets/domain/wallet-identity';
import {
  EULER_V2_ETHEREUM_IDENTITIES,
  EULER_V2_ETHEREUM_SOURCE_PINS,
} from './euler-v2-ethereum-finalized-transcript.adapter';

const NETWORK_ID = 'eip155:1' as const;
const CHAIN_ID = '0x1' as const;
const INTERNAL_DEBT_PRECISION_SHIFT = 31n;
const INTERNAL_DEBT_SCALE = 1n << INTERNAL_DEBT_PRECISION_SHIFT;
const VIRTUAL_DEPOSIT_ATOMIC = 1_000_000n;
const MAX_UINT112 = (1n << 112n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_SANE_DEBT = MAX_UINT112 << INTERNAL_DEBT_PRECISION_SHIFT;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]{0,77})$/u;

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function sourceFile(path: string, bytes: number, sha256: string) {
  return frozen({ path, bytes, sha256 });
}

export const EULER_V2_ACCOUNT_POSITION_SEMANTICS_VERSION = 1 as const;
export const EULER_V2_ACCOUNT_POSITION_SEMANTICS_USE =
  'DORMANT_EULER_V2_ACCOUNT_AND_EVC_SEMANTICS_ONLY' as const;

/**
 * SHA-256 values cover the exact LF-normalized Git blob payload at the pinned
 * commit, not a checkout whose line endings may have been rewritten.
 */
export const EULER_V2_ACCOUNT_POSITION_SOURCE_PINS = frozen({
  repository: 'euler-xyz/euler-vault-kit',
  commitSha: EULER_V2_ETHEREUM_SOURCE_PINS.eulerVaultKitCommitSha,
  evcRepository: 'euler-xyz/ethereum-vault-connector',
  evcSubmoduleCommitSha: '084b32284ba643921f8d21bff3ddaf0c4e08d754',
  hashAlgorithm: 'SHA256_OF_GIT_BLOB_PAYLOAD',
  files: frozen([
    sourceFile(
      'src/GenericFactory/GenericFactory.sol',
      8_348,
      'fb2f048598dcec7053fae385c2a5deebc50a167d2d51cbdd48a9a9da0ba2f349',
    ),
    sourceFile(
      'src/EVault/IEVault.sol',
      29_286,
      'ea502ec1a275780537ca593e1e930a8d5feac0d5fd64e5c7de3793c77f640b67',
    ),
    sourceFile(
      'src/EVault/EVault.sol',
      13_572,
      'dac010ff9fcec8f18b62cf230079916eb1d5a17c3815e76da49492e6c691832d',
    ),
    sourceFile(
      'src/EVault/Dispatch.sol',
      8_481,
      '22757d54986a71249607bbac0642e2dcf9303ac62200a95c417388ae401cc4eb',
    ),
    sourceFile(
      'src/EVault/DToken.sol',
      3_180,
      '0ab1e50214d9bc35d070492720df0d9d23b35ed6a5613ac57241a70da37fd52c',
    ),
    sourceFile(
      'src/EVault/modules/Token.sol',
      3_828,
      '8d509687f1c562e26a7abf9907220e736ec1704d8d5a6587dc08f9a06f152cb6',
    ),
    sourceFile(
      'src/EVault/modules/Vault.sol',
      10_666,
      'a42eb3070b0012f2e7562607c7d0924314ac090b811f6f2d5ed7e39bfae41728',
    ),
    sourceFile(
      'src/EVault/modules/Borrowing.sol',
      6_016,
      'bafcbdbf224eaf0c0c9aad14a1d4e99acc31881d06dfddfdf95a48aa536cf326',
    ),
    sourceFile(
      'src/EVault/shared/BorrowUtils.sol',
      8_517,
      '60d38739c1722a8a596cc8d1928eca6a9b7e7ea2433d0e5f33152b5370a8568b',
    ),
    sourceFile(
      'src/EVault/shared/Cache.sol',
      6_486,
      '1b22f19d27c470c2d9631b0a56c9e3668f3c17b445f86e291e0712e2c81b42b0',
    ),
    sourceFile(
      'src/EVault/shared/Constants.sol',
      2_873,
      '624814ccf0c09fe04d3c937f4e4b28118c57786b52e2d1df1feadd15ab1caf00',
    ),
    sourceFile(
      'src/EVault/shared/EVCClient.sol',
      5_264,
      '59d5f27f1b3a1403b7f1f6aef80ddc52ead1898ba4cfc702b2d754dfd0790846',
    ),
    sourceFile(
      'src/EVault/shared/lib/ConversionHelpers.sol',
      980,
      '038a88d2bd192140b261cf080b9dbc63ec3ee591af5905d1f65f6b04a3f0aec1',
    ),
    sourceFile(
      'src/EVault/shared/types/Types.sol',
      2_301,
      '8167584586695cbd6197ffc957b94b459ad85b725f9eff73993c5dc6d3456cea',
    ),
    sourceFile(
      'src/EVault/shared/types/Assets.sol',
      3_096,
      '78d86ff8682b400533abfaa465a041223109e60522f119ccb76a9d21b9955d76',
    ),
    sourceFile(
      'src/EVault/shared/types/Shares.sol',
      2_531,
      '68ca6aef9922c1a22a6cf0bae4f28a6edf3d530de776063cf0071cb633798b78',
    ),
    sourceFile(
      'src/EVault/shared/types/Owed.sol',
      2_781,
      'b5aec966c148f558aca616af7ac4463c4aeffae11f0891fa7779a6fcf2b5f8d4',
    ),
    sourceFile(
      'src/EVault/shared/types/UserStorage.sol',
      3_154,
      'b87ac89f0dda13639e3f0762c647215f3ac9ac84a9b3edced47e854f3e67377b',
    ),
  ]),
  evcFiles: frozen([
    sourceFile(
      'src/EthereumVaultConnector.sol',
      54_419,
      '636d4567dcf9b9d6ce1090ac187386d2b5c2723039c1cff0fc56c7d9651dd6f2',
    ),
    sourceFile(
      'src/interfaces/IEthereumVaultConnector.sol',
      30_446,
      '0ca652e50c648b62dc71e10c66f4afac04b63d4961770231f404866aed1d3dae',
    ),
  ]),
});

export const EULER_V2_ACCOUNT_POSITION_ABI = frozen({
  evaultBalanceOf: frozen({
    signature: 'balanceOf(address)',
    selector: '0x70a08231',
    target: 'EVAULT_PROXY',
    returnType: 'uint256',
    meaning: 'SUPPLY_SHARES_UINT112',
    execution: 'EMBEDDED_IN_PINNED_EVAULT_IMPLEMENTATION',
  }),
  evaultConvertToAssets: frozen({
    signature: 'convertToAssets(uint256)',
    selector: '0x07a2d13a',
    target: 'EVAULT_PROXY',
    returnType: 'uint256',
    meaning: 'CURRENT_UNDERLYING_ATOMIC_FLOOR',
    execution: 'EMBEDDED_IN_PINNED_EVAULT_IMPLEMENTATION',
  }),
  evaultDebtOf: frozen({
    signature: 'debtOf(address)',
    selector: '0xd283e75f',
    target: 'EVAULT_PROXY',
    returnType: 'uint256',
    meaning: 'CURRENT_UNDERLYING_ATOMIC_CEIL',
    execution: 'EMBEDDED_IN_PINNED_EVAULT_IMPLEMENTATION',
  }),
  evaultDebtOfExact: frozen({
    signature: 'debtOfExact(address)',
    selector: '0xab49b7f1',
    target: 'EVAULT_PROXY',
    returnType: 'uint256',
    meaning: 'CURRENT_INTERNAL_DEBT_WITH_31_FRACTION_BITS',
    execution: 'STATIC_DELEGATE_TO_MODULE_BORROWING',
  }),
  dTokenBalanceOf: frozen({
    signature: 'balanceOf(address)',
    selector: '0x70a08231',
    target: 'DTOKEN_RETURNED_BY_EVAULT',
    returnType: 'uint256',
    meaning: 'ALIAS_OF_EVAULT_DEBT_OF_NOT_SUPPLY_SHARES',
    execution: 'DTOKEN_CALLS_EVAULT_DEBT_OF',
  }),
  evcGetAccountOwner: frozen({
    signature: 'getAccountOwner(address)',
    selector: '0x442b172c',
    target: 'EVC',
    returnType: 'address',
    meaning: 'REGISTERED_PREFIX_OWNER_OR_ZERO',
  }),
  evcGetAddressPrefix: frozen({
    signature: 'getAddressPrefix(address)',
    selector: '0x506d8c92',
    target: 'EVC',
    returnType: 'bytes19',
    meaning: 'FIRST_19_ADDRESS_BYTES',
  }),
  evcGetOperator: frozen({
    signature: 'getOperator(bytes19,address)',
    selector: '0xb03c130d',
    target: 'EVC',
    returnType: 'uint256',
    meaning: 'KNOWN_PREFIX_OPERATOR_ACCOUNT_ID_BITFIELD',
  }),
  evcIsAccountOperatorAuthorized: frozen({
    signature: 'isAccountOperatorAuthorized(address,address)',
    selector: '0x1647292a',
    target: 'EVC',
    returnType: 'bool',
    meaning: 'ACTION_AUTHORITY_NOT_ASSET_OWNERSHIP',
  }),
  factoryGetProxyListLength: frozen({
    signature: 'getProxyListLength()',
    selector: '0x0a68b7ba',
    returnType: 'uint256',
  }),
  factoryGetProxyListSlice: frozen({
    signature: 'getProxyListSlice(uint256,uint256)',
    selector: '0xc0e96df6',
    returnType: 'address[]',
  }),
  factoryGetProxyConfig: frozen({
    signature: 'getProxyConfig(address)',
    selector: '0xa20ea5c1',
    returnType: '(bool,address,bytes)',
  }),
  evaultEvc: frozen({
    signature: 'EVC()',
    selector: '0xa70354a1',
    target: 'EVAULT_PROXY',
    returnType: 'address',
    execution: 'STATIC_DELEGATE_TO_MODULE_GOVERNANCE',
  }),
  evaultModuleBorrowing: frozen({
    signature: 'MODULE_BORROWING()',
    selector: '0x14c054bc',
    returnType: 'address',
  }),
  evaultModuleGovernance: frozen({
    signature: 'MODULE_GOVERNANCE()',
    selector: '0xb4cd541b',
    returnType: 'address',
  }),
});

export const EULER_V2_ACCOUNT_POSITION_IDENTITY_REQUIREMENTS = frozen({
  networkId: NETWORK_ID,
  chainId: CHAIN_ID,
  exactDeploymentAddresses: EULER_V2_ETHEREUM_IDENTITIES,
  runtimeCodeKeccak256RequiredAtBoundBlock: true,
  vaultProxy: frozen({
    factoryRecognized: true,
    proxyKind: 'IMMUTABLE_META_PROXY_ONLY',
    upgradeable: false,
    implementationMustEqualPinnedDeployment: true,
    trailingMetadataMustBindAssetOracleAndUnitOfAccount: true,
  }),
  callPathCodeIdentities: frozen({
    balanceOf: frozen(['factory', 'vaultProxy', 'implementation']),
    convertToAssets: frozen(['factory', 'vaultProxy', 'implementation']),
    debtOf: frozen(['factory', 'vaultProxy', 'implementation']),
    debtOfExact: frozen(['factory', 'vaultProxy', 'implementation', 'modules.borrowing']),
    getAccountOwner: frozen(['evc']),
    evcRelation: frozen(['vaultProxy', 'implementation', 'modules.governance', 'evc']),
    assetAttribution: frozen(['vaultProxy', 'implementation', 'asset']),
  }),
  dTokenRequiredForCanonicalRead: false,
  dTokenReason: 'DIRECT_EVAULT_DEBT_OF_AVOIDS_AN_EXTRA_DERIVED_CONTRACT_IDENTITY',
});

export const EULER_V2_ACCOUNT_POSITION_DEBT_SEMANTICS = frozen({
  internalDebtPrecisionShiftBits: INTERNAL_DEBT_PRECISION_SHIFT.toString(10),
  internalDebtScale: INTERNAL_DEBT_SCALE.toString(10),
  storedDebtBits: 144,
  maximumExactDebt: MAX_SANE_DEBT.toString(10),
  currentExactFormula:
    'FLOOR(STORED_OWED_EXACT * CURRENT_VAULT_INTEREST_ACCUMULATOR / ACCOUNT_INTEREST_ACCUMULATOR)',
  currentExactOverflow:
    'SOLIDITY_CHECKED_UINT256_MULTIPLICATION_AND_MAX_SANE_DEBT_CAST; REVERT_ON_ZERO_DIVISOR_FOR_NONZERO_OWED',
  zeroDebtShortCircuit: 'ZERO_WITHOUT_READING_OR_DIVIDING_BY_ACCOUNT_ACCUMULATOR',
  conservativeCurrentGetter: 'debtOf(address)',
  conservativeReason:
    'BOTH_GETTERS_LOAD_CURRENT_ACCRUED_VAULT_STATE; debtOf CEILS debtOfExact FROM 31-BIT INTERNAL PRECISION INTO UNDERLYING ATOMIC UNITS',
  requiredSameBlockCoherence: 'debtOf == CEIL(debtOfExact / 2^31)',
  loadVaultAccrualOverflow:
    'PINNED CACHE RETAINS THE PRIOR ACCUMULATOR WHEN RPOW OR ACCUMULATOR MULTIPLICATION OVERFLOWS AND ONLY ACCEPTS TOTAL DEBT AT OR BELOW MAX_SANE_DEBT',
});

export const EULER_V2_ACCOUNT_POSITION_SUPPLY_SEMANTICS = frozen({
  balanceGetter: 'EVAULT.balanceOf(address)',
  balanceUnit: 'EVAULT_SHARES_UINT112',
  assetGetter: 'EVAULT.convertToAssets(balanceOf)',
  virtualDepositAtomic: VIRTUAL_DEPOSIT_ATOMIC.toString(10),
  currentFormula:
    'FLOOR(SHARES * (CASH + CEIL(TOTAL_BORROWS_EXACT / 2^31) + 1e6) / (TOTAL_SHARES + 1e6))',
  rounding: 'SUPPLY_ASSETS_FLOOR',
  inputOverflow:
    'convertToAssets REVERTS WHEN SHARES EXCEEDS uint112; PINNED BOUNDS KEEP TOTAL ADDITION AND MULTIPLICATION BELOW uint256',
  outputOverflow: 'REVERT_WHEN THE FLOOR RESULT EXCEEDS uint112',
});

export const EULER_V2_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS = frozen({
  evc: frozen({
    accountCount: 256,
    accountIdRange: frozen({ first: 0, last: 255 }),
    addressFormula: 'ACCOUNT_ADDRESS = REGISTERED_OWNER_ADDRESS XOR uint8(ACCOUNT_ID)',
    prefixFormula: 'bytes19(uint152(uint160(account) >> 8))',
    ownerGate:
      'getAccountOwner(WALLET) MUST EQUAL THE SAME WALLET AT THE BOUND BLOCK BEFORE THE 256-ACCOUNT FAMILY MAY BE ATTRIBUTED',
    zeroOwnerPolicy: 'FAIL_CLOSED_FOR_COMPLETE_FAMILY_ATTRIBUTION',
    nonMatchingOwnerPolicy: 'FAIL_CLOSED',
    inspectEveryAccount: true,
    operatorPolicy:
      'NEVER EXPAND OWNERSHIP FROM OPERATOR AUTHORITY; EVC HAS NO REVERSE OPERATOR INDEX FOR EXHAUSTIVE DISCOVERY',
  }),
  vaults: frozen({
    factoryMethod: 'getProxyListLength + gapless getProxyListSlice coverage of [0,length)',
    inspectEveryFactoryProxy: true,
    skipUnsupportedProxyVersions: false,
    perProxyRequirements:
      'VERIFY FACTORY CONFIG, IMPLEMENTATION, MODULE/EVC RELATIONS, ASSET IDENTITY, THEN READ ALL 256 ACCOUNTS',
    residualUniverseRequirement:
      'AN APPROVED IMMUTABLE INVENTORY MUST PROVE THE PINNED FACTORY IS THE COMPLETE IN-SCOPE EULER V2 VAULT UNIVERSE',
  }),
  aggregation: frozen({
    supply: 'SUM FLOOR convertToAssets(balanceOf(account)) PER VAULT AND ACCOUNT',
    borrow: 'SUM CEIL debtOfExact PER VAULT AND ACCOUNT; debtOf MUST MATCH',
    preservePerAssetAndPerVaultRows: true,
    crossAssetSummationWithoutIndependentValuation: false,
  }),
  mayEstablishCompletePosition: false,
  reason:
    'SEMANTICS ONLY; NO AUTHENTICATED EXHAUSTIVE VAULT INVENTORY, TRANSPORT, OR INDEPENDENT FINALIZED SOURCE IS WIRED',
});

export const EULER_V2_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS = frozen({
  initialBlockSelector: 'finalized',
  eip1898Parameter: frozen({ blockHash: 'SELECTED_FINALIZED_BLOCK_HASH', requireCanonical: true }),
  bindEveryOperation: frozen([
    'eth_getCode',
    'factory list length and every slice',
    'factory/proxy configuration',
    'vault implementation/module/EVC/asset identity',
    'EVC owner and operator observations',
    'balanceOf, convertToAssets, debtOf, and debtOfExact for every account and vault',
  ]),
  forbiddenBlockParameters: frozen(['latest', 'safe', 'block number without EIP-1898']),
  closeout:
    'RE-READ SELECTED HEIGHT AND REQUIRE IDENTICAL NUMBER HASH PARENT STATE ROOT TIMESTAMP; RECHECK CHAIN ID',
  sourceAuthenticity:
    'EIP-1898 BINDS STATE WITHIN A TRANSCRIPT BUT DOES NOT AUTHENTICATE AN RPC OR PROVE INDEPENDENT FINALITY',
});

const SEMANTICS_FINGERPRINT_BODY = frozen({
  semanticsVersion: EULER_V2_ACCOUNT_POSITION_SEMANTICS_VERSION,
  use: EULER_V2_ACCOUNT_POSITION_SEMANTICS_USE,
  mayPersist: false,
  mayAuthorizeFinancialAction: false,
  mayEstablishCompletePosition: false,
  sources: EULER_V2_ACCOUNT_POSITION_SOURCE_PINS,
  abi: EULER_V2_ACCOUNT_POSITION_ABI,
  identities: EULER_V2_ACCOUNT_POSITION_IDENTITY_REQUIREMENTS,
  debt: EULER_V2_ACCOUNT_POSITION_DEBT_SEMANTICS,
  supply: EULER_V2_ACCOUNT_POSITION_SUPPLY_SEMANTICS,
  discovery: EULER_V2_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS,
  context: EULER_V2_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS,
});

export const EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256 = createHash('sha256')
  .update('crypto-lending:euler-v2-account-position-semantics:v1\0', 'utf8')
  .update(JSON.stringify(SEMANTICS_FINGERPRINT_BODY), 'utf8')
  .digest('hex');

export const EULER_V2_ACCOUNT_POSITION_SEMANTICS = frozen({
  ...SEMANTICS_FINGERPRINT_BODY,
  semanticsFingerprintSha256: EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
});

export class EulerV2AccountPositionSemanticsUnavailableError extends Error {
  readonly code = 'EULER_V2_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE' as const;

  constructor() {
    super('Euler V2 account-position semantics are unavailable.');
    this.name = 'EulerV2AccountPositionSemanticsUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

function fail(): never {
  throw new EulerV2AccountPositionSemanticsUnavailableError();
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

function checkedDebtAssetsUp(exactDebt: bigint): bigint {
  if (exactDebt === 0n) return 0n;
  return (exactDebt + INTERNAL_DEBT_SCALE - 1n) >> INTERNAL_DEBT_PRECISION_SHIFT;
}

export interface EulerV2DebtProjection {
  readonly exactDebt: string;
  readonly internalDebtScale: string;
  readonly fractionalRemainder: string;
  readonly assetsAtomic: string;
  readonly rounding: 'BORROW_CEIL';
}

export function projectEulerV2DebtExactToAssetsUp(value: unknown): EulerV2DebtProjection {
  const exactDebt = canonicalUint(value, MAX_SANE_DEBT);
  return frozen({
    exactDebt: exactDebt.toString(10),
    internalDebtScale: INTERNAL_DEBT_SCALE.toString(10),
    fractionalRemainder: (exactDebt % INTERNAL_DEBT_SCALE).toString(10),
    assetsAtomic: checkedDebtAssetsUp(exactDebt).toString(10),
    rounding: 'BORROW_CEIL' as const,
  });
}

export function projectEulerV2CurrentDebtExact(
  storedOwedExactValue: unknown,
  currentVaultInterestAccumulatorValue: unknown,
  accountInterestAccumulatorValue: unknown,
): string {
  const storedOwedExact = canonicalUint(storedOwedExactValue, MAX_SANE_DEBT);
  if (storedOwedExact === 0n) return '0';
  const currentVaultInterestAccumulator = canonicalUint(
    currentVaultInterestAccumulatorValue,
    MAX_UINT256,
  );
  const accountInterestAccumulator = canonicalUint(accountInterestAccumulatorValue, MAX_UINT256);
  if (accountInterestAccumulator === 0n) return fail();
  if (currentVaultInterestAccumulator > MAX_UINT256 / storedOwedExact) return fail();
  const currentExact =
    (storedOwedExact * currentVaultInterestAccumulator) / accountInterestAccumulator;
  if (currentExact > MAX_SANE_DEBT) return fail();
  return currentExact.toString(10);
}

export interface EulerV2SupplyProjection {
  readonly shares: string;
  readonly accruedTotalBorrowAssetsAtomic: string;
  readonly conversionTotalAssetsAtomic: string;
  readonly conversionTotalShares: string;
  readonly exactNumerator: string;
  readonly fractionalRemainder: string;
  readonly assetsAtomic: string;
  readonly rounding: 'SUPPLY_FLOOR';
}

export function projectEulerV2SharesToAssetsDown(
  sharesValue: unknown,
  totalSharesValue: unknown,
  cashAtomicValue: unknown,
  currentTotalBorrowsExactValue: unknown,
): EulerV2SupplyProjection {
  const shares = canonicalUint(sharesValue, MAX_UINT112);
  const totalShares = canonicalUint(totalSharesValue, MAX_UINT112);
  const cashAtomic = canonicalUint(cashAtomicValue, MAX_UINT112);
  const currentTotalBorrowsExact = canonicalUint(currentTotalBorrowsExactValue, MAX_SANE_DEBT);
  const accruedTotalBorrowAssetsAtomic = checkedDebtAssetsUp(currentTotalBorrowsExact);
  const conversionTotalAssetsAtomic =
    cashAtomic + accruedTotalBorrowAssetsAtomic + VIRTUAL_DEPOSIT_ATOMIC;
  const conversionTotalShares = totalShares + VIRTUAL_DEPOSIT_ATOMIC;
  const exactNumerator = shares * conversionTotalAssetsAtomic;
  if (exactNumerator > MAX_UINT256) return fail();
  const assetsAtomic = exactNumerator / conversionTotalShares;
  if (assetsAtomic > MAX_UINT112) return fail();
  return frozen({
    shares: shares.toString(10),
    accruedTotalBorrowAssetsAtomic: accruedTotalBorrowAssetsAtomic.toString(10),
    conversionTotalAssetsAtomic: conversionTotalAssetsAtomic.toString(10),
    conversionTotalShares: conversionTotalShares.toString(10),
    exactNumerator: exactNumerator.toString(10),
    fractionalRemainder: (exactNumerator % conversionTotalShares).toString(10),
    assetsAtomic: assetsAtomic.toString(10),
    rounding: 'SUPPLY_FLOOR' as const,
  });
}

export interface EulerV2EvcAccountCandidate {
  readonly accountId: string;
  readonly accountAddress: string;
}

/**
 * Derives candidates only. Ownership attribution still requires the same-block
 * getAccountOwner(owner) == owner gate captured above.
 */
export function deriveEulerV2EvcAccountCandidates(
  ownerValue: unknown,
): readonly EulerV2EvcAccountCandidate[] {
  let owner: string;
  try {
    owner = parseEvmWalletAddress(ownerValue);
  } catch {
    return fail();
  }
  const ownerInteger = BigInt(owner);
  return frozen(
    Array.from({ length: 256 }, (_, accountId) =>
      frozen({
        accountId: accountId.toString(10),
        accountAddress: `0x${(ownerInteger ^ BigInt(accountId)).toString(16).padStart(40, '0')}`,
      }),
    ),
  );
}
