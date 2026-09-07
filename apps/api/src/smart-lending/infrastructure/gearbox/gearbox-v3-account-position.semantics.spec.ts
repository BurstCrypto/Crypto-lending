import { readFileSync } from 'node:fs';

import { toFunctionSelector } from 'viem';

import {
  aggregateGearboxV3CreditAccountDebtAtomic,
  GEARBOX_V3_ACCOUNT_POSITION_ABI,
  GEARBOX_V3_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS,
  GEARBOX_V3_ACCOUNT_POSITION_DEBT_SEMANTICS,
  GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES,
  GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS,
  GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
  GEARBOX_V3_ACCOUNT_POSITION_SOURCE_PINS,
  GEARBOX_V3_ACCOUNT_POSITION_SUPPLY_SEMANTICS,
  GEARBOX_V3_ACCOUNT_POSITION_TOPOLOGY_REQUIREMENTS,
  GearboxV3AccountPositionSemanticsUnavailableError,
  projectGearboxV3CreditAccountDebt,
  projectGearboxV3DieselSharesToUnderlyingDown,
} from './gearbox-v3-account-position.semantics';

const MAX_UINT256 = (1n << 256n) - 1n;

async function expectUnavailable(action: () => unknown): Promise<void> {
  try {
    await action();
    throw new Error('expected unavailable');
  } catch (error) {
    expect(error).toBeInstanceOf(GearboxV3AccountPositionSemanticsUnavailableError);
    expect(error).toMatchObject({
      name: 'GearboxV3AccountPositionSemanticsUnavailableError',
      code: 'GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE',
      message: 'Gearbox V3 account-position semantics are unavailable.',
    });
  }
}

describe('Gearbox V3 account-position semantics', () => {
  it('pins canonical content hashes for every reviewed immutable primary source', () => {
    expect(GEARBOX_V3_ACCOUNT_POSITION_SOURCE_PINS).toMatchObject({
      hashAlgorithm: 'SHA256_OF_GIT_BLOB_PAYLOAD',
      securityRepository: 'Gearbox-protocol/security',
      securityCommitSha: '684522eae18dea73a8aecda25d8743bfa724446a',
      securityFiles: [
        {
          path: 'bug-bounty/v3-scope.md',
          bytes: 25_378,
          sha256: '17fb638e4ef642a41eda0c5af1aa8bbd15e5b603d382905c0e3cafa4b146cb96',
        },
      ],
      coreRepository: 'Gearbox-protocol/core-v3',
      coreCommitSha: 'e16559ae82f0f24c3dc29693c444f40d676ebff9',
      openZeppelinRepository: 'OpenZeppelin/openzeppelin-contracts',
      openZeppelinTag: 'v4.9.3',
      openZeppelinCommitSha: 'fd81a96f01cc42ef1c9a5399364968d0e07e9e90',
    });
    expect(GEARBOX_V3_ACCOUNT_POSITION_SOURCE_PINS.coreFiles).toEqual(
      [
        [
          'contracts/pool/PoolV3.sol',
          34_840,
          '77bea7983c43b88dfb4b9057935209115fcdeedff7768962c4ccde8c0c285295',
        ],
        [
          'contracts/interfaces/IPoolV3.sol',
          4_834,
          '81e0de5531f70f06fe035fff6f24401ac5466cb316fe4ff2882adc6b55e56542',
        ],
        [
          'contracts/credit/CreditManagerV3.sol',
          61_776,
          'e303bfced701240189ada2aa25ee4dca1a3ccbccd45c59cbf138dc20bea978f6',
        ],
        [
          'contracts/interfaces/ICreditManagerV3.sol',
          9_648,
          '8835e0f770d5eb58962efc660593c9fbac972daa437bfa2949aaf91d34747699',
        ],
        [
          'contracts/credit/CreditFacadeV3.sol',
          52_798,
          '8d0eaa4b8d1b3031ef6f437c4e063fe6416c862534c02d4b063bcec50d94a3a4',
        ],
        [
          'contracts/interfaces/ICreditFacadeV3.sol',
          5_670,
          'ae03dfc802061058b6baec63205036fd2174ad1c2b5cd39421ba5063cc527070',
        ],
        [
          'contracts/credit/CreditAccountV3.sol',
          3_349,
          '0d4a3b57a68f4954c5b4160e89c5ae4261683053651e5a2f05e29d8a06042cb7',
        ],
        [
          'contracts/interfaces/ICreditAccountV3.sol',
          1_112,
          'dcc9da3edef8dfb82558e423be9fe62c736543cbb3966fe116dee4b8576f0948',
        ],
        [
          'contracts/libraries/CreditLogic.sol',
          13_158,
          '2ba36f42b407a4bbe439882253975b2a216eb3dd972d0330a450c5fa5bb475a7',
        ],
        [
          'contracts/pool/PoolQuotaKeeperV3.sol',
          22_031,
          '6a9a46b86bf058a489b2c08cc8a6feb3c72df24817ed3abfb493bfb71acb197e',
        ],
        [
          'contracts/interfaces/IPoolQuotaKeeperV3.sol',
          3_747,
          'bdb7546ef76f12e67a58b1873e6984d48d832c03b3b02dc59d8b868fab0ac997',
        ],
        [
          'contracts/core/AccountFactoryV3.sol',
          7_169,
          '3ece291f97f9f4f340add8e0bd332cd524d621b1fb28c9cdb77e5877ef4b35ea',
        ],
        [
          'contracts/interfaces/IAccountFactoryV3.sol',
          1_921,
          '8aa1a2b6e3ead5d14debd0fc8de6a012ad84cd320cbed95ca7cfac05b0dd07ec',
        ],
        [
          'contracts/interfaces/IAddressProviderV3.sol',
          1_502,
          '0b33ce0bcf2221468d9f71d2539b4f018d4b5a5d4fc1e1ca823a9320a6985a39',
        ],
        [
          'contracts/traits/ContractsRegisterTrait.sol',
          2_392,
          '2722cd5fa153550615b9da2c46a232ad55a271873802a1cad5c87b0560af39ca',
        ],
        ['package.json', 1_318, '15482626ae1e470032300bfcb6b4ebcea6be414f4462fae7d38f4c2615a1271a'],
        ['yarn.lock', 219_517, '905e1eb9c71b71e8757695daf84c93cb6410d5b963f0753d9280663ee45e48e0'],
      ].map(([path, bytes, sha256]) => ({ path, bytes, sha256 })),
    );
    expect(GEARBOX_V3_ACCOUNT_POSITION_SOURCE_PINS.openZeppelinFiles).toEqual(
      [
        [
          'contracts/utils/math/Math.sol',
          12_785,
          '85a2caf3bd06579fb55236398c1321e15fd524a8fe140dff748c0f73d7a52345',
        ],
        [
          'contracts/token/ERC20/extensions/ERC4626.sol',
          11_447,
          '0610f62eeae3a7dee46c4c37cc80c59060fd56cea7fb1e00a950f1e6a2f981ac',
        ],
        [
          'contracts/utils/structs/EnumerableSet.sol',
          12_960,
          'a64e5d0e83019d9caa51e6fe6f68ac54b583ac15792b8557cb8e4fab20711b9f',
        ],
        [
          'contracts/proxy/Clones.sol',
          4_031,
          'fe993ed37cc4c1951524e9572498f897df00ea6f0525620fda327992f789261c',
        ],
      ].map(([path, bytes, sha256]) => ({ path, bytes, sha256 })),
    );
  });

  it('pins the exact pool identity and separates diesel supply from credit-account debt', () => {
    expect(GEARBOX_V3_ACCOUNT_POSITION_IDENTITIES).toEqual({
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
    expect(GEARBOX_V3_ACCOUNT_POSITION_SUPPLY_SEMANTICS.positionIdentity).toContain(
      'DIESEL_SHARES',
    );
    expect(GEARBOX_V3_ACCOUNT_POSITION_DEBT_SEMANTICS.positionIdentity).toContain(
      'CREDIT_ACCOUNT_DEBT',
    );
    expect(GEARBOX_V3_ACCOUNT_POSITION_ABI.poolTotalDebtLimit).toEqual({
      signature: 'totalDebtLimit()',
      selector: '0x183ace90',
      meaning: 'POOL_WIDE_DEBT_CAP_NEVER_WALLET_DEBT',
    });
    expect(GEARBOX_V3_ACCOUNT_POSITION_DEBT_SEMANTICS.totalDebtLimitPolicy).toContain('NEVER USE');
  });

  it('pins every selector needed for manager, facade, account, supply, and debt topology', () => {
    for (const entry of Object.values(GEARBOX_V3_ACCOUNT_POSITION_ABI)) {
      expect(entry.selector).toBe(toFunctionSelector(entry.signature));
    }
    expect(GEARBOX_V3_ACCOUNT_POSITION_ABI).toMatchObject({
      addressProviderGetAddressOrRevert: { selector: '0x57b5a1c6' },
      contractsRegisterIsPool: { selector: '0x5b16ebb7' },
      poolBalanceOf: { selector: '0x70a08231' },
      poolTotalSupply: { selector: '0x18160ddd' },
      poolTotalAssets: { selector: '0x01e1d114' },
      poolAsset: { selector: '0x38d52e0f' },
      poolCreditManagers: { selector: '0xdac54431' },
      managerPool: { selector: '0x16f0115b' },
      managerCreditFacade: { selector: '0x2f7a1881' },
      managerAccountFactory: { selector: '0x687cd9c1' },
      managerCreditAccountsLength: { selector: '0xf13d0fc6' },
      managerCreditAccountsPage: { selector: '0x2c9db6f1' },
      managerCreditAccountInfo: { selector: '0x3c5bc3b2' },
      managerDebtAndCollateral: {
        selector: '0x0d334ca6',
        task: 'DEBT_ONLY_ENUM_VALUE_1',
      },
      facadeCreditManager: { selector: '0xc12c21c0' },
      creditAccountManager: { selector: '0xc12c21c0' },
      creditAccountFactory: { selector: '0xc45a0155' },
      quotaKeeperPool: { selector: '0x16f0115b' },
      quotaKeeperUnderlying: { selector: '0x6f307dc3' },
      tokenDecimals: { selector: '0x313ce567' },
    });
    expect(GEARBOX_V3_ACCOUNT_POSITION_ABI.managerDebtAndCollateral.returnTypes).toEqual([
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
    ]);
  });

  it('projects gross wallet diesel shares with protocol floor rounding', () => {
    expect(projectGearboxV3DieselSharesToUnderlyingDown('3', '10', '4')).toEqual({
      sharesAtomic: '3',
      totalAssetsAtomic: '10',
      totalSupplyAtomic: '4',
      branch: 'MULDIV_DOWN',
      exactNumerator: '30',
      denominator: '4',
      fractionalRemainder: '2',
      suppliedUnderlyingAtomic: '7',
      rounding: 'SUPPLY_FLOOR',
    });
    expect(projectGearboxV3DieselSharesToUnderlyingDown('0', '9', '0')).toMatchObject({
      branch: 'ZERO_TOTAL_SUPPLY_ONE_TO_ONE',
      suppliedUnderlyingAtomic: '0',
      denominator: '1',
    });
    expect(projectGearboxV3DieselSharesToUnderlyingDown('0', '99', '7')).toMatchObject({
      suppliedUnderlyingAtomic: '0',
      fractionalRemainder: '0',
    });
  });

  it('matches 512-bit mulDiv behavior without rejecting a large safe intermediate', () => {
    const maximum = MAX_UINT256.toString(10);
    const result = projectGearboxV3DieselSharesToUnderlyingDown(maximum, maximum, maximum);
    expect(result.exactNumerator).toBe((MAX_UINT256 * MAX_UINT256).toString(10));
    expect(result.suppliedUnderlyingAtomic).toBe(maximum);
  });

  it('rejects impossible wallet ratio inputs before they can produce an oversized quotient', async () => {
    await expectUnavailable(() =>
      projectGearboxV3DieselSharesToUnderlyingDown(
        MAX_UINT256.toString(10),
        MAX_UINT256.toString(10),
        '1',
      ),
    );
  });

  it('rejects a wallet share balance above the same-block total supply', async () => {
    await expectUnavailable(() => projectGearboxV3DieselSharesToUnderlyingDown('1', '0', '0'));
    await expectUnavailable(() => projectGearboxV3DieselSharesToUnderlyingDown('11', '100', '10'));
  });

  it('uses the exact protocol debt components and checked aggregation', () => {
    expect(projectGearboxV3CreditAccountDebt('1000000', '25000', '2500')).toEqual({
      principalDebtAtomic: '1000000',
      accruedInterestAtomic: '25000',
      accruedFeesAtomic: '2500',
      debtAtomic: '1027500',
      rounding: 'PROTOCOL_INTEGER_COMPONENTS_CHECKED_SUM',
    });
    expect(projectGearboxV3CreditAccountDebt('0', '0', '0').debtAtomic).toBe('0');
    expect(aggregateGearboxV3CreditAccountDebtAtomic(['1027500', '2500000', '0'])).toEqual({
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      maySign: false,
      mayAccessWalletPrivateKey: false,
      mayEstablishCompletePosition: false,
      calculationStatus: 'OFFLINE_CALLER_SUPPLIED_VALUES_ONLY',
      completenessStatus: 'NOT_ESTABLISHED_BY_MATH_ONLY',
      creditAccountCount: '3',
      debtAtomic: '3527500',
    });
    expect(aggregateGearboxV3CreditAccountDebtAtomic([])).toMatchObject({
      mayEstablishCompletePosition: false,
      completenessStatus: 'NOT_ESTABLISHED_BY_MATH_ONLY',
      debtAtomic: '0',
    });
  });

  it.each([
    ['number', 1, '1', '1'],
    ['negative', '-1', '1', '1'],
    ['leading zero', '01', '1', '1'],
    ['hex', '0x1', '1', '1'],
    ['too large', (MAX_UINT256 + 1n).toString(10), '1', '1'],
  ])('rejects noncanonical supply input: %s', async (_label, shares, assets, supply) => {
    await expectUnavailable(() =>
      projectGearboxV3DieselSharesToUnderlyingDown(shares, assets, supply),
    );
  });

  it('rejects debt-component and aggregate uint256 overflow', async () => {
    await expectUnavailable(() =>
      projectGearboxV3CreditAccountDebt(MAX_UINT256.toString(10), '1', '0'),
    );
    await expectUnavailable(() =>
      aggregateGearboxV3CreditAccountDebtAtomic([MAX_UINT256.toString(10), '1']),
    );
  });

  it('processes the admitted account bound linearly and rejects one account beyond it', async () => {
    expect(aggregateGearboxV3CreditAccountDebtAtomic(new Array(65_536).fill('0'))).toMatchObject({
      creditAccountCount: '65536',
      debtAtomic: '0',
      mayEstablishCompletePosition: false,
    });
    await expectUnavailable(() =>
      aggregateGearboxV3CreditAccountDebtAtomic(new Array(65_537).fill('0')),
    );
  });

  it('rejects sparse, accessor-bearing, symbolic, and proxied aggregate inputs', async () => {
    const sparse = new Array(2) as unknown[];
    sparse[1] = '1';
    await expectUnavailable(() => aggregateGearboxV3CreditAccountDebtAtomic(sparse));

    let invoked = false;
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get: () => {
        invoked = true;
        return '1';
      },
    });
    Object.defineProperty(accessor, 'length', { value: 1 });
    await expectUnavailable(() => aggregateGearboxV3CreditAccountDebtAtomic(accessor));
    expect(invoked).toBe(false);

    const symbolic = ['1'];
    Object.defineProperty(symbolic, Symbol('hostile'), { value: true });
    await expectUnavailable(() => aggregateGearboxV3CreditAccountDebtAtomic(symbolic));
    await expectUnavailable(() => aggregateGearboxV3CreditAccountDebtAtomic(new Proxy(['1'], {})));
  });

  it('requires exhaustive same-block topology and never grants completeness', () => {
    expect(GEARBOX_V3_ACCOUNT_POSITION_TOPOLOGY_REQUIREMENTS).toMatchObject({
      root: {
        runtimeCodeSha256Required: [
          'POOL',
          'UNDERLYING_USDC',
          'ADDRESS_PROVIDER',
          'CONTRACTS_REGISTER',
        ],
      },
      poolManagerUniverse: {
        source: 'POOL.creditManagers()',
        maximumManagers: 64,
        requireUniqueNonzeroAddresses: true,
      },
      perManager: {
        unsupportedManagerPolicy: 'FAIL_THE_WHOLE_POSITION_READ_NEVER_SKIP',
      },
      currentPoolQuotaKeeper: {
        runtimeCodeSha256Required: true,
      },
      creditAccountUniverse: {
        lengthSource: 'MANAGER.creditAccountsLen()',
        pageSource: 'MANAGER.creditAccounts(OFFSET,LIMIT)',
        pageSize: 128,
        maximumAccountsAcrossManagers: 65_536,
        inspectEveryAccount: true,
        sameBlockDebtCrossChecks: [
          'DEBT_ONLY.debt == CREDIT_ACCOUNT_INFO.debt',
          'DEBT_ONLY.cumulativeIndexLastUpdate == CREDIT_ACCOUNT_INFO.cumulativeIndexLastUpdate',
          'DEBT_ONLY.enabledTokensMask == CREDIT_ACCOUNT_INFO.enabledTokensMask',
          'DEBT_ONLY.poolQuotaKeeper == BOUND_CURRENT_POOL_QUOTA_KEEPER',
        ],
      },
      mayEstablishCompletePosition: false,
    });
    expect(GEARBOX_V3_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS).toMatchObject({
      initialBlockSelector: 'finalized',
      eip1898Parameter: { blockHash: 'SELECTED_FINALIZED_BLOCK_HASH', requireCanonical: true },
      responseBounds: { exceededPolicy: 'FAIL_CLOSED_NEVER_TRUNCATE' },
      failureLifecycle: {
        absoluteDeadlineRequired: true,
        abortSignalRequired: true,
        stopSchedulingAfterFailure: true,
        settleEveryStartedOperation: true,
        drainOrCancelEveryResponseBody: true,
      },
    });
    expect(GEARBOX_V3_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS.durableContextFirst).toContain(
      'AUTHENTICATED WALLET',
    );
  });

  it('content-hashes the complete immutable false-authority semantics', () => {
    expect(GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256).toBe(
      'cb8505cdd5192fc9e02de42be49df4823b483717682979fdf069ef2f1587509e',
    );
    expect(GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS).toMatchObject({
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      maySign: false,
      mayAccessWalletPrivateKey: false,
      mayEstablishCompletePosition: false,
      semanticsFingerprintSha256: GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    });
    expect(Object.isFrozen(GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS)).toBe(true);
    expect(Object.isFrozen(GEARBOX_V3_ACCOUNT_POSITION_SOURCE_PINS.coreFiles)).toBe(true);
  });

  it('contains no transport, endpoint, runtime registration, persistence, or transaction path', () => {
    const source = readFileSync(__filename.replace(/\.spec\.ts$/u, '.ts'), 'utf8');
    expect(source).not.toMatch(
      /process\.env|fetch\s*\(|axios|https?:\/\/|@(Injectable|Module|Controller)|readTranscript|sendTransaction|signTransaction|privateKey|\.adapter['"]/u,
    );
    expect(source).not.toContain("from './gearbox-v3-ethereum-usdc.manifest'");
    expect(source).toContain('POOL_WIDE_DEBT_CAP_NEVER_WALLET_DEBT');
  });
});
