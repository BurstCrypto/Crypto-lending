import { toFunctionSelector } from 'viem';

import { EULER_V2_ETHEREUM_IDENTITIES } from './euler-v2-ethereum-finalized-transcript.adapter';
import {
  deriveEulerV2EvcAccountCandidates,
  EULER_V2_ACCOUNT_POSITION_ABI,
  EULER_V2_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS,
  EULER_V2_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS,
  EULER_V2_ACCOUNT_POSITION_IDENTITY_REQUIREMENTS,
  EULER_V2_ACCOUNT_POSITION_SEMANTICS,
  EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
  EULER_V2_ACCOUNT_POSITION_SOURCE_PINS,
  EulerV2AccountPositionSemanticsUnavailableError,
  projectEulerV2CurrentDebtExact,
  projectEulerV2DebtExactToAssetsUp,
  projectEulerV2SharesToAssetsDown,
} from './euler-v2-account-position.semantics';

const INTERNAL_DEBT_SCALE = 2_147_483_648n;
const MAX_UINT112 = (1n << 112n) - 1n;
const MAX_SANE_DEBT = MAX_UINT112 * INTERNAL_DEBT_SCALE;
const MAX_UINT256 = (1n << 256n) - 1n;
const OWNER = '0x1111111111111111111111111111111111111180';

describe('Euler V2 account-position semantics', () => {
  it('pins the immutable official source payloads and semantic fingerprint', () => {
    expect(EULER_V2_ACCOUNT_POSITION_SOURCE_PINS).toMatchObject({
      repository: 'euler-xyz/euler-vault-kit',
      commitSha: '9e3c760e051f5d769f7c6edb9be30198a55117d4',
      evcRepository: 'euler-xyz/ethereum-vault-connector',
      evcSubmoduleCommitSha: '084b32284ba643921f8d21bff3ddaf0c4e08d754',
      hashAlgorithm: 'SHA256_OF_GIT_BLOB_PAYLOAD',
    });
    expect(EULER_V2_ACCOUNT_POSITION_SOURCE_PINS.files).toHaveLength(18);
    expect(EULER_V2_ACCOUNT_POSITION_SOURCE_PINS.evcFiles).toHaveLength(2);
    expect(EULER_V2_ACCOUNT_POSITION_SOURCE_PINS.files).toContainEqual({
      path: 'src/EVault/modules/Borrowing.sol',
      bytes: 6_016,
      sha256: 'bafcbdbf224eaf0c0c9aad14a1d4e99acc31881d06dfddfdf95a48aa536cf326',
    });
    expect(EULER_V2_ACCOUNT_POSITION_SOURCE_PINS.evcFiles).toContainEqual({
      path: 'src/EthereumVaultConnector.sol',
      bytes: 54_419,
      sha256: '636d4567dcf9b9d6ce1090ac187386d2b5c2723039c1cff0fc56c7d9651dd6f2',
    });
    expect(EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256).toBe(
      'b934a77b395439af669496617b63349d61d34ac86108cc3f2a76259e3c801c6f',
    );
    expect(EULER_V2_ACCOUNT_POSITION_SEMANTICS.semanticsFingerprintSha256).toBe(
      EULER_V2_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    );
  });

  it('pins every ABI selector to its canonical signature', () => {
    for (const definition of Object.values(EULER_V2_ACCOUNT_POSITION_ABI)) {
      expect(definition.selector).toBe(toFunctionSelector(definition.signature));
    }
    expect(EULER_V2_ACCOUNT_POSITION_ABI.evaultBalanceOf.meaning).toBe('SUPPLY_SHARES_UINT112');
    expect(EULER_V2_ACCOUNT_POSITION_ABI.dTokenBalanceOf.meaning).toBe(
      'ALIAS_OF_EVAULT_DEBT_OF_NOT_SUPPLY_SHARES',
    );
  });

  it('requires the already pinned proxy, implementation, modules, EVC, and asset identities', () => {
    expect(EULER_V2_ACCOUNT_POSITION_IDENTITY_REQUIREMENTS.exactDeploymentAddresses).toBe(
      EULER_V2_ETHEREUM_IDENTITIES,
    );
    expect(EULER_V2_ACCOUNT_POSITION_IDENTITY_REQUIREMENTS.callPathCodeIdentities).toMatchObject({
      debtOf: ['factory', 'vaultProxy', 'implementation'],
      debtOfExact: ['factory', 'vaultProxy', 'implementation', 'modules.borrowing'],
      evcRelation: ['vaultProxy', 'implementation', 'modules.governance', 'evc'],
    });
    expect(EULER_V2_ACCOUNT_POSITION_IDENTITY_REQUIREMENTS.dTokenRequiredForCanonicalRead).toBe(
      false,
    );
  });

  it('derives all and only the 256 XOR-addressed EVC account candidates', () => {
    const accounts = deriveEulerV2EvcAccountCandidates(OWNER);
    expect(accounts).toHaveLength(256);
    expect(new Set(accounts.map((account) => account.accountAddress)).size).toBe(256);
    expect(accounts[0]).toEqual({ accountId: '0', accountAddress: OWNER });
    expect(accounts[1]).toEqual({
      accountId: '1',
      accountAddress: '0x1111111111111111111111111111111111111181',
    });
    expect(accounts[255]).toEqual({
      accountId: '255',
      accountAddress: '0x111111111111111111111111111111111111117f',
    });
    expect(
      accounts.every((account) => account.accountAddress.slice(0, 40) === OWNER.slice(0, 40)),
    ).toBe(true);
    expect(Object.isFrozen(accounts)).toBe(true);
    expect(accounts.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    ['zero address', '0x0000000000000000000000000000000000000000'],
    ['short address', '0x1234'],
    ['non-address value', 1],
  ])('rejects an invalid EVC owner candidate: %s', (_label, value) => {
    expect(() => deriveEulerV2EvcAccountCandidates(value)).toThrow(
      EulerV2AccountPositionSemanticsUnavailableError,
    );
  });

  it.each([
    ['0', '0', '0'],
    ['1', '1', '1'],
    [(INTERNAL_DEBT_SCALE - 1n).toString(10), '1', (INTERNAL_DEBT_SCALE - 1n).toString(10)],
    [INTERNAL_DEBT_SCALE.toString(10), '1', '0'],
    [(INTERNAL_DEBT_SCALE + 1n).toString(10), '2', '1'],
    [MAX_SANE_DEBT.toString(10), MAX_UINT112.toString(10), '0'],
  ])(
    'converts exact debt %s to conservative atomic debt %s',
    (exactDebt, expectedAtomic, expectedRemainder) => {
      expect(projectEulerV2DebtExactToAssetsUp(exactDebt)).toMatchObject({
        exactDebt,
        assetsAtomic: expectedAtomic,
        fractionalRemainder: expectedRemainder,
        rounding: 'BORROW_CEIL',
      });
    },
  );

  it('reconstructs the pinned current-debt floor before the atomic-unit ceiling', () => {
    expect(projectEulerV2CurrentDebtExact('0', '0', '0')).toBe('0');
    expect(projectEulerV2CurrentDebtExact(INTERNAL_DEBT_SCALE.toString(10), '3', '2')).toBe(
      '3221225472',
    );
    expect(projectEulerV2CurrentDebtExact('1', '1', '2')).toBe('0');
  });

  it.each([
    ['nonzero debt with zero account accumulator', '1', '1', '0'],
    [
      'checked uint256 multiplication overflow',
      MAX_SANE_DEBT.toString(10),
      MAX_UINT256.toString(10),
      '1',
    ],
    ['max-sane-debt cast overflow', MAX_SANE_DEBT.toString(10), '2', '1'],
    ['noncanonical integer', '01', '1', '1'],
  ])(
    'fails closed for current-debt arithmetic: %s',
    (_label, stored, currentAccumulator, accountAccumulator) => {
      expect(() =>
        projectEulerV2CurrentDebtExact(stored, currentAccumulator, accountAccumulator),
      ).toThrow(EulerV2AccountPositionSemanticsUnavailableError);
    },
  );

  it('reconstructs convertToAssets with accrued borrows, virtual deposit, and floor rounding', () => {
    expect(projectEulerV2SharesToAssetsDown('1', '2', '1', '0')).toMatchObject({
      accruedTotalBorrowAssetsAtomic: '0',
      conversionTotalAssetsAtomic: '1000001',
      conversionTotalShares: '1000002',
      exactNumerator: '1000001',
      fractionalRemainder: '1000001',
      assetsAtomic: '0',
      rounding: 'SUPPLY_FLOOR',
    });
    expect(projectEulerV2SharesToAssetsDown('1', '1', '0', '1')).toMatchObject({
      accruedTotalBorrowAssetsAtomic: '1',
      assetsAtomic: '1',
    });
    expect(
      projectEulerV2SharesToAssetsDown(
        MAX_UINT112.toString(10),
        MAX_UINT112.toString(10),
        MAX_UINT112.toString(10),
        '0',
      ),
    ).toMatchObject({ assetsAtomic: MAX_UINT112.toString(10) });
  });

  it.each([
    ['uint112 shares input overflow', (MAX_UINT112 + 1n).toString(10), '0', '0', '0'],
    [
      'uint112 conversion output overflow',
      MAX_UINT112.toString(10),
      MAX_UINT112.toString(10),
      MAX_UINT112.toString(10),
      MAX_SANE_DEBT.toString(10),
    ],
    ['noncanonical cash', '0', '0', '01', '0'],
    ['negative debt', '0', '0', '0', '-1'],
  ])(
    'fails closed for convertToAssets arithmetic: %s',
    (_label, shares, totalShares, cash, totalDebt) => {
      expect(() => projectEulerV2SharesToAssetsDown(shares, totalShares, cash, totalDebt)).toThrow(
        EulerV2AccountPositionSemanticsUnavailableError,
      );
    },
  );

  it('remains dormant and records the exact completeness and same-context blockers', () => {
    expect(EULER_V2_ACCOUNT_POSITION_SEMANTICS).toMatchObject({
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      mayEstablishCompletePosition: false,
    });
    expect(EULER_V2_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS).toMatchObject({
      evc: {
        accountCount: 256,
        zeroOwnerPolicy: 'FAIL_CLOSED_FOR_COMPLETE_FAMILY_ATTRIBUTION',
        inspectEveryAccount: true,
      },
      vaults: {
        inspectEveryFactoryProxy: true,
        skipUnsupportedProxyVersions: false,
      },
      mayEstablishCompletePosition: false,
    });
    expect(EULER_V2_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS.eip1898Parameter).toEqual({
      blockHash: 'SELECTED_FINALIZED_BLOCK_HASH',
      requireCanonical: true,
    });
    expect(JSON.stringify(EULER_V2_ACCOUNT_POSITION_SEMANTICS)).not.toMatch(
      /endpoint|credential|private.?key|transaction.?sender/iu,
    );
  });
});
