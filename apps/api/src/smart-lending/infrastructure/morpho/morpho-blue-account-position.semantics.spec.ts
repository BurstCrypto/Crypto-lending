import { toEventSelector, toFunctionSelector } from 'viem';

import {
  evaluateMorphoBlueAccountPositionSnapshot,
  type EvaluateMorphoBlueAccountPositionSnapshotV1,
  MORPHO_BLUE_ACCOUNT_POSITION_ABI,
  MORPHO_BLUE_ACCOUNT_POSITION_ACCRUAL,
  MORPHO_BLUE_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS,
  MORPHO_BLUE_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS,
  MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS,
  MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
  MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE,
  MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION,
  MORPHO_BLUE_ACCOUNT_POSITION_SOURCE_PINS,
  MorphoBlueAccountPositionSemanticsUnavailableError,
  projectMorphoBlueTaylorCompounded,
} from './morpho-blue-account-position.semantics';

const WAD = 1_000_000_000_000_000_000n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const WALLET = '0x1111111111111111111111111111111111111111';
const FEE_RECIPIENT = '0x2222222222222222222222222222222222222222';
const IRM = '0x3333333333333333333333333333333333333333';

function validSnapshot(): EvaluateMorphoBlueAccountPositionSnapshotV1 {
  return {
    semanticsVersion: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_VERSION,
    use: MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_USE,
    mayPersist: false,
    mayAuthorizeFinancialAction: false,
    mayEstablishCompletePosition: false,
    walletAddress: WALLET,
    feeRecipientAddress: FEE_RECIPIENT,
    irmAddress: IRM,
    blockTimestamp: '101',
    borrowRatePerSecondWad: WAD.toString(10),
    market: {
      totalSupplyAssets: '2000',
      totalSupplyShares: '2000000',
      totalBorrowAssets: '500',
      totalBorrowShares: '500000',
      lastUpdate: '100',
      feeWad: '250000000000000000',
    },
    position: {
      supplyShares: '1000000',
      borrowShares: '100000',
      collateralAtomic: '42',
    },
  };
}

function unaccruedRoundingSnapshot(): EvaluateMorphoBlueAccountPositionSnapshotV1 {
  return {
    ...validSnapshot(),
    blockTimestamp: '100',
    borrowRatePerSecondWad: null,
    market: {
      totalSupplyAssets: '1',
      totalSupplyShares: '2',
      totalBorrowAssets: '1',
      totalBorrowShares: '2',
      lastUpdate: '100',
      feeWad: '0',
    },
    position: {
      supplyShares: '1',
      borrowShares: '1',
      collateralAtomic: '0',
    },
  };
}

describe('Morpho Blue account-position semantics', () => {
  it('pins immutable official source payloads and the complete semantics fingerprint', () => {
    expect(MORPHO_BLUE_ACCOUNT_POSITION_SOURCE_PINS).toMatchObject({
      repository: 'morpho-org/morpho-blue',
      releaseTag: 'v1.0.0',
      commitSha: '55d2d99304fb3fb930c688462ae2ccabb1d533ad',
      hashAlgorithm: 'SHA256_OF_GIT_BLOB_PAYLOAD',
      deployedBuildEquivalenceStatus: 'NOT_ESTABLISHED_BY_SOURCE_TAG_ALONE',
    });
    expect(MORPHO_BLUE_ACCOUNT_POSITION_SOURCE_PINS.files).toHaveLength(12);
    expect(MORPHO_BLUE_ACCOUNT_POSITION_SOURCE_PINS.files).toContainEqual({
      path: 'src/Morpho.sol',
      bytes: 22_065,
      sha256: '7f66c064ad0bdc046382fa65f449bb5a0b9181d5d03b65e3c8438226d437b9ce',
    });
    expect(MORPHO_BLUE_ACCOUNT_POSITION_SOURCE_PINS.files).toContainEqual({
      path: 'src/libraries/periphery/MorphoBalancesLib.sol',
      bytes: 5_549,
      sha256: 'dc5015f71b5cb2bf52876ed2c2b47ba37f4d7ab5970c42aa5a719ffba4f9e4a8',
    });
    expect(MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256).toBe(
      '06825a41d6d93686df57e6c4e8e14b1026e8f0bcc8e4473b5517c3021eb73d4b',
    );
    expect(MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS.semanticsFingerprintSha256).toBe(
      MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    );
  });

  it('pins every ABI selector and the CreateMarket topic to canonical signatures', () => {
    for (const definition of [
      MORPHO_BLUE_ACCOUNT_POSITION_ABI.position,
      MORPHO_BLUE_ACCOUNT_POSITION_ABI.market,
      MORPHO_BLUE_ACCOUNT_POSITION_ABI.idToMarketParams,
      MORPHO_BLUE_ACCOUNT_POSITION_ABI.feeRecipient,
      MORPHO_BLUE_ACCOUNT_POSITION_ABI.isAuthorized,
      MORPHO_BLUE_ACCOUNT_POSITION_ABI.borrowRateView,
      MORPHO_BLUE_ACCOUNT_POSITION_ABI.accrueInterest,
    ]) {
      expect(definition.selector).toBe(toFunctionSelector(definition.signature));
    }
    expect(MORPHO_BLUE_ACCOUNT_POSITION_ABI.createMarketEvent.topic0).toBe(
      toEventSelector(MORPHO_BLUE_ACCOUNT_POSITION_ABI.createMarketEvent.signature),
    );
  });

  it('remains dormant and records the IRM, discovery, authority, and context gaps', () => {
    expect(MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS).toMatchObject({
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      mayEstablishCompletePosition: false,
    });
    expect(MORPHO_BLUE_ACCOUNT_POSITION_ACCRUAL.genericIrmLimitation).toMatch(
      /EACH MARKET IRM NEEDS ITS OWN PINNED SOURCE_BUILD_AND_CODE IDENTITY/iu,
    );
    expect(MORPHO_BLUE_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS).toMatchObject({
      authorizationPolicy:
        'isAuthorized ONLY GRANTS MANAGEMENT AUTHORITY; NEVER ATTRIBUTE AN AUTHORIZER POSITION TO AN AUTHORIZED WALLET',
      marketEnumeration: {
        coreHasEnumerableMarketList: false,
        deduplicateByMarketId: true,
        skipUnsupportedMarketOrIrm: false,
      },
      mayEstablishCompletePosition: false,
    });
    expect(MORPHO_BLUE_ACCOUNT_POSITION_CONTEXT_REQUIREMENTS.eip1898Parameter).toEqual({
      blockHash: 'SELECTED_FINALIZED_BLOCK_HASH',
      requireCanonical: true,
    });
    expect(JSON.stringify(MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS)).not.toMatch(
      /endpoint|credential|private.?key|transaction.?sender/iu,
    );
  });

  it.each([
    ['zero rate', '0', '999', '0', '0', '0', '0'],
    ['single wei rate', '1', '1', '1', '0', '0', '1'],
    [
      'one WAD for one second',
      WAD.toString(10),
      '1',
      WAD.toString(10),
      (WAD / 2n).toString(10),
      '166666666666666666',
      '1666666666666666666',
    ],
  ])(
    'reproduces the three-term Taylor projection: %s',
    (_label, rate, elapsed, first, second, third, compounded) => {
      expect(projectMorphoBlueTaylorCompounded(rate, elapsed)).toEqual({
        borrowRatePerSecondWad: rate,
        elapsedSeconds: elapsed,
        firstTerm: first,
        secondTerm: second,
        thirdTerm: third,
        compoundedRateWad: compounded,
      });
    },
  );

  it.each([
    ['first-term overflow', MAX_UINT256.toString(10), '2'],
    ['second-term multiplication overflow', MAX_UINT256.toString(10), '1'],
    ['noncanonical rate', '01', '1'],
    ['negative elapsed', '1', '-1'],
  ])('fails closed for Taylor arithmetic: %s', (_label, rate, elapsed) => {
    expect(() => projectMorphoBlueTaylorCompounded(rate, elapsed)).toThrow(
      MorphoBlueAccountPositionSemanticsUnavailableError,
    );
  });

  it('accrues interest, mints fee shares, and applies supply-down and borrow-up rounding', () => {
    expect(evaluateMorphoBlueAccountPositionSnapshot(validSnapshot())).toMatchObject({
      calculationStatus: 'OFFLINE_CALLER_SUPPLIED_STATE_ONLY',
      completenessStatus: 'NOT_ESTABLISHED',
      currentAt: '101',
      elapsedSeconds: '1',
      irmReadStatus: 'BORROW_RATE_VIEW_SUPPLIED_UNAUTHENTICATED',
      taylor: {
        compoundedRateWad: '1666666666666666666',
      },
      interestAtomic: '833',
      feeAmountAtomic: '208',
      pendingFeeShares: '237623',
      walletIsFeeRecipient: false,
      accruedMarket: {
        totalSupplyAssets: '2833',
        totalSupplyShares: '2237623',
        totalBorrowAssets: '1333',
        totalBorrowShares: '500000',
      },
      position: {
        rawSupplyShares: '1000000',
        adjustedSupplyShares: '1000000',
        borrowShares: '100000',
        collateralAtomic: '42',
        supply: {
          assetsAtomic: '875',
          exactNumerator: '2834000000',
          denominator: '3237623',
          fractionalRemainder: '1079875',
          rounding: 'SUPPLY_DOWN',
        },
        borrow: {
          assetsAtomic: '89',
          exactNumerator: '133400000',
          denominator: '1500000',
          fractionalRemainder: '1400000',
          rounding: 'BORROW_UP',
        },
      },
    });
  });

  it('adds pending shares only to the exact same-block fee recipient position', () => {
    const ordinary = evaluateMorphoBlueAccountPositionSnapshot(validSnapshot());
    const recipient = evaluateMorphoBlueAccountPositionSnapshot({
      ...validSnapshot(),
      walletAddress: FEE_RECIPIENT,
    });

    expect(recipient).toMatchObject({
      pendingFeeShares: '237623',
      walletIsFeeRecipient: true,
      position: {
        rawSupplyShares: '1000000',
        adjustedSupplyShares: '1237623',
        supply: {
          assetsAtomic: '1083',
          exactNumerator: '3507423582',
          fractionalRemainder: '1077873',
        },
      },
    });
    expect(recipient.accruedMarket).toEqual(ordinary.accruedMarket);
  });

  it('preserves virtual shares/assets with supply floor and debt ceiling at the one-unit edge', () => {
    expect(evaluateMorphoBlueAccountPositionSnapshot(unaccruedRoundingSnapshot())).toMatchObject({
      irmReadStatus: 'NO_ELAPSED_TIME_NO_RATE_READ',
      interestAtomic: '0',
      pendingFeeShares: '0',
      position: {
        supply: {
          assetsAtomic: '0',
          exactNumerator: '2',
          denominator: '1000002',
          fractionalRemainder: '2',
          rounding: 'SUPPLY_DOWN',
        },
        borrow: {
          assetsAtomic: '1',
          exactNumerator: '2',
          denominator: '1000002',
          fractionalRemainder: '2',
          rounding: 'BORROW_UP',
        },
      },
    });
  });

  it.each([
    [
      'zero IRM',
      {
        irmAddress: '0x0000000000000000000000000000000000000000',
        borrowRatePerSecondWad: null,
      },
      'ZERO_IRM_NO_RATE_READ',
    ],
    [
      'no elapsed time',
      { blockTimestamp: '100', borrowRatePerSecondWad: null },
      'NO_ELAPSED_TIME_NO_RATE_READ',
    ],
    [
      'zero borrowed assets',
      {
        borrowRatePerSecondWad: null,
        market: {
          ...validSnapshot().market,
          totalBorrowAssets: '0',
          totalBorrowShares: '0',
        },
        position: { ...validSnapshot().position, borrowShares: '0' },
      },
      'ZERO_BORROW_ASSETS_NO_RATE_READ',
    ],
  ])(
    'does not invent an IRM read when the official view library skips it: %s',
    (_label, patch, status) => {
      expect(
        evaluateMorphoBlueAccountPositionSnapshot({ ...validSnapshot(), ...patch }),
      ).toMatchObject({
        irmReadStatus: status,
        interestAtomic: '0',
      });
    },
  );

  it('requires the exact caller-supplied IRM observation only on the official read branch', () => {
    expect(() =>
      evaluateMorphoBlueAccountPositionSnapshot({
        ...validSnapshot(),
        borrowRatePerSecondWad: null,
      }),
    ).toThrow(MorphoBlueAccountPositionSemanticsUnavailableError);
    expect(() =>
      evaluateMorphoBlueAccountPositionSnapshot({
        ...unaccruedRoundingSnapshot(),
        borrowRatePerSecondWad: '0',
      }),
    ).toThrow(MorphoBlueAccountPositionSemanticsUnavailableError);
  });

  it.each([
    ['uncreated market', { lastUpdate: '0' }],
    ['future last update', { lastUpdate: '102' }],
    ['fee above maximum', { feeWad: '250000000000000001' }],
    ['borrow assets without shares', { totalBorrowShares: '0' }],
    ['borrow shares without assets', { totalBorrowAssets: '0' }],
    ['borrow assets above supplied assets', { totalBorrowAssets: '2001' }],
    ['positive supply assets without shares', { totalSupplyShares: '0' }],
  ])('fails closed for an impossible raw market state: %s', (_label, patch) => {
    expect(() =>
      evaluateMorphoBlueAccountPositionSnapshot({
        ...validSnapshot(),
        market: { ...validSnapshot().market, ...patch },
      }),
    ).toThrow(MorphoBlueAccountPositionSemanticsUnavailableError);
  });

  it.each([
    ['supply shares above market total', { supplyShares: '2000001' }],
    ['borrow shares above market total', { borrowShares: '500001' }],
    ['uint128 collateral overflow', { collateralAtomic: (MAX_UINT128 + 1n).toString(10) }],
    ['noncanonical supply shares', { supplyShares: '01' }],
  ])('fails closed for an impossible raw position: %s', (_label, patch) => {
    expect(() =>
      evaluateMorphoBlueAccountPositionSnapshot({
        ...validSnapshot(),
        position: { ...validSnapshot().position, ...patch },
      }),
    ).toThrow(MorphoBlueAccountPositionSemanticsUnavailableError);
  });

  it('fails closed when accrued uint128 totals would overflow', () => {
    expect(() =>
      evaluateMorphoBlueAccountPositionSnapshot({
        ...validSnapshot(),
        borrowRatePerSecondWad: '1',
        market: {
          totalSupplyAssets: MAX_UINT128.toString(10),
          totalSupplyShares: MAX_UINT128.toString(10),
          totalBorrowAssets: MAX_UINT128.toString(10),
          totalBorrowShares: MAX_UINT128.toString(10),
          lastUpdate: '100',
          feeWad: '0',
        },
        position: { supplyShares: '0', borrowShares: '0', collateralAtomic: '0' },
      }),
    ).toThrow(MorphoBlueAccountPositionSemanticsUnavailableError);
  });

  it('fails closed when the borrow-up numerator adjustment would overflow uint256', () => {
    expect(() =>
      evaluateMorphoBlueAccountPositionSnapshot({
        ...validSnapshot(),
        blockTimestamp: '100',
        borrowRatePerSecondWad: null,
        market: {
          totalSupplyAssets: MAX_UINT128.toString(10),
          totalSupplyShares: MAX_UINT128.toString(10),
          totalBorrowAssets: MAX_UINT128.toString(10),
          totalBorrowShares: MAX_UINT128.toString(10),
          lastUpdate: '100',
          feeWad: '0',
        },
        position: {
          supplyShares: '0',
          borrowShares: MAX_UINT128.toString(10),
          collateralAtomic: '0',
        },
      }),
    ).toThrow(MorphoBlueAccountPositionSemanticsUnavailableError);
  });

  it.each([
    ['proxy input', (): unknown => new Proxy(validSnapshot(), {})],
    ['unknown field', (): unknown => ({ ...validSnapshot(), unexpected: true })],
    [
      'accessor field',
      (): unknown => {
        const value = { ...validSnapshot() } as Record<string, unknown>;
        Object.defineProperty(value, 'walletAddress', {
          enumerable: true,
          get: () => WALLET,
        });
        return value;
      },
    ],
    [
      'nested symbol field',
      (): unknown => ({
        ...validSnapshot(),
        market: { ...validSnapshot().market, [Symbol('hostile')]: true },
      }),
    ],
  ])('rejects hostile object shapes without reading through them: %s', (_label, createValue) => {
    expect(() => evaluateMorphoBlueAccountPositionSnapshot(createValue())).toThrow(
      MorphoBlueAccountPositionSemanticsUnavailableError,
    );
  });

  it('returns a frozen, non-authoritative projection and a sanitized error surface', () => {
    const projection = evaluateMorphoBlueAccountPositionSnapshot(validSnapshot());
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.accruedMarket)).toBe(true);
    expect(Object.isFrozen(projection.position)).toBe(true);
    expect(Object.isFrozen(projection.position.supply)).toBe(true);
    expect(projection).toMatchObject({
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      mayEstablishCompletePosition: false,
    });

    try {
      evaluateMorphoBlueAccountPositionSnapshot(null);
      throw new Error('expected the semantics evaluator to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MorphoBlueAccountPositionSemanticsUnavailableError);
      expect(error).toMatchObject({
        code: 'MORPHO_BLUE_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE',
        message: 'Morpho Blue account-position semantics are unavailable.',
      });
    }
  });
});
