import { describe, expect, it } from 'vitest';

import {
  UNAVAILABLE_BUYING_POWER_DEMO_PAYLOAD,
  UNIFIED_BALANCE_DEMO_PAYLOAD,
} from '@/lib/portfolio/unified-balance.fixtures';
import {
  addressEnding,
  formatUsdMinor,
  maskPortfolioAddress,
  parseUnifiedBalanceResponse,
  UnifiedBalanceResponseError,
} from '@/lib/portfolio/unified-balance';

function clonePayload(payload: unknown = UNIFIED_BALANCE_DEMO_PAYLOAD): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function wallets(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  return payload.wallets as Array<Record<string, unknown>>;
}

function firstWallet(payload: Record<string, unknown>): Record<string, unknown> {
  const wallet = wallets(payload)[0];
  if (wallet === undefined) throw new Error('fixture wallet missing');
  return wallet;
}

function firstAsset(payload: Record<string, unknown>): Record<string, unknown> {
  const chains = firstWallet(payload).chains as Array<Record<string, unknown>>;
  const assets = chains[0]?.assets as Array<Record<string, unknown>>;
  return assets[0] as Record<string, unknown>;
}

describe('unified balance API boundary', () => {
  it('accepts and deeply freezes reconciled available and unavailable fixtures', () => {
    const available = parseUnifiedBalanceResponse(UNIFIED_BALANCE_DEMO_PAYLOAD);
    const unavailable = parseUnifiedBalanceResponse(UNAVAILABLE_BUYING_POWER_DEMO_PAYLOAD);

    expect(available.portfolioValueUsdMinor).toBe('1100000');
    expect(available.buyingPower.amountUsdMinor).toBe('750000');
    expect(available.wallets.map(({ portfolioValueUsdMinor }) => portfolioValueUsdMinor)).toEqual([
      '700000',
      '400000',
    ]);
    expect(unavailable.buyingPower).toMatchObject({
      status: 'UNAVAILABLE',
      amountUsdMinor: null,
      reasons: ['ROUTE_COST_UNAVAILABLE'],
    });
    expect(Object.isFrozen(available)).toBe(true);
    expect(Object.isFrozen(available.wallets)).toBe(true);
    expect(Object.isFrozen(available.wallets[0]?.chains[0]?.assets[0])).toBe(true);
  });

  it('rejects inconsistent portfolio, wallet, chain, buying-power, and deduction totals', () => {
    const portfolioMismatch = clonePayload();
    portfolioMismatch.portfolioValueUsdMinor = '1100001';
    expect(() => parseUnifiedBalanceResponse(portfolioMismatch)).toThrow(
      UnifiedBalanceResponseError,
    );

    const walletMismatch = clonePayload();
    const firstWallet = wallets(walletMismatch)[0] as Record<string, unknown>;
    firstWallet.portfolioValueUsdMinor = '700001';
    expect(() => parseUnifiedBalanceResponse(walletMismatch)).toThrow(UnifiedBalanceResponseError);

    const chainMismatch = clonePayload();
    const chainWallet = wallets(chainMismatch)[0] as Record<string, unknown>;
    const chains = chainWallet.chains as Array<Record<string, unknown>>;
    (chains[0] as Record<string, unknown>).buyingPowerUsdMinor = '449999';
    expect(() => parseUnifiedBalanceResponse(chainMismatch)).toThrow(UnifiedBalanceResponseError);

    const buyingPowerTooHigh = clonePayload();
    const buyingPower = buyingPowerTooHigh.buyingPower as Record<string, unknown>;
    buyingPower.amountUsdMinor = '1100001';
    expect(() => parseUnifiedBalanceResponse(buyingPowerTooHigh)).toThrow(
      UnifiedBalanceResponseError,
    );

    const deductionMismatch = clonePayload();
    const deductionBuyingPower = deductionMismatch.buyingPower as Record<string, unknown>;
    const deductions = deductionBuyingPower.deductions as Array<Record<string, unknown>>;
    (deductions[0] as Record<string, unknown>).amountUsdMinor = '199999';
    expect(() => parseUnifiedBalanceResponse(deductionMismatch)).toThrow(
      UnifiedBalanceResponseError,
    );
  });

  it('rejects duplicate sources, cross-namespace chains, malformed addresses, and future data', () => {
    const duplicateWallet = clonePayload();
    wallets(duplicateWallet).push(structuredClone(firstWallet(duplicateWallet)));
    expect(() => parseUnifiedBalanceResponse(duplicateWallet)).toThrow(UnifiedBalanceResponseError);

    const duplicateAssetIdentity = clonePayload();
    const solanaWallet = wallets(duplicateAssetIdentity)[1] as Record<string, unknown>;
    const solanaChains = solanaWallet.chains as Array<Record<string, unknown>>;
    const solanaAssets = (solanaChains[0] as Record<string, unknown>).assets as Array<
      Record<string, unknown>
    >;
    (solanaAssets[1] as Record<string, unknown>).assetIdentity = (
      solanaAssets[0] as Record<string, unknown>
    ).assetIdentity;
    expect(() => parseUnifiedBalanceResponse(duplicateAssetIdentity)).toThrow(
      UnifiedBalanceResponseError,
    );

    const wrongNamespace = clonePayload();
    const wallet = firstWallet(wrongNamespace);
    const chains = wallet.chains as Array<Record<string, unknown>>;
    (chains[0] as Record<string, unknown>).networkId = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
    expect(() => parseUnifiedBalanceResponse(wrongNamespace)).toThrow(UnifiedBalanceResponseError);

    const uppercaseEvm = clonePayload();
    firstWallet(uppercaseEvm).address = '0x71C7656Ec7ab88b098defB751B7401B5f6d8976F';
    expect(() => parseUnifiedBalanceResponse(uppercaseEvm)).toThrow(UnifiedBalanceResponseError);

    const futureObservation = clonePayload();
    firstAsset(futureObservation).observedAt = '2026-08-24T18:30:00.001Z';
    expect(() => parseUnifiedBalanceResponse(futureObservation)).toThrow(
      UnifiedBalanceResponseError,
    );
  });

  it('requires freshness and unavailable explanations to agree with source state', () => {
    const hiddenStaleness = clonePayload();
    hiddenStaleness.freshness = 'CURRENT';
    expect(() => parseUnifiedBalanceResponse(hiddenStaleness)).toThrow(UnifiedBalanceResponseError);

    const unexplainedUnavailable = clonePayload(UNAVAILABLE_BUYING_POWER_DEMO_PAYLOAD);
    const buyingPower = unexplainedUnavailable.buyingPower as Record<string, unknown>;
    buyingPower.reasons = [];
    expect(() => parseUnifiedBalanceResponse(unexplainedUnavailable)).toThrow(
      UnifiedBalanceResponseError,
    );

    const falseZero = clonePayload(UNAVAILABLE_BUYING_POWER_DEMO_PAYLOAD);
    (falseZero.buyingPower as Record<string, unknown>).amountUsdMinor = '0';
    expect(() => parseUnifiedBalanceResponse(falseZero)).toThrow(UnifiedBalanceResponseError);
  });

  it('rejects extra fields and accessors without invoking or exposing them', () => {
    const extra = clonePayload();
    extra.providerMessage = 'sensitive provider detail';
    expect(() => parseUnifiedBalanceResponse(extra)).toThrowError(
      'Unified balance data is unavailable.',
    );

    let invoked = false;
    const accessor = clonePayload();
    Object.defineProperty(accessor, 'asOf', {
      enumerable: true,
      get: () => {
        invoked = true;
        throw new Error('sensitive provider detail');
      },
    });
    expect(() => parseUnifiedBalanceResponse(accessor)).toThrowError(
      'Unified balance data is unavailable.',
    );
    expect(invoked).toBe(false);

    const hostileArray = clonePayload();
    const walletArray = wallets(hostileArray);
    Object.defineProperty(walletArray, 'map', {
      value: () => [],
    });
    expect(() => parseUnifiedBalanceResponse(hostileArray)).toThrowError(
      'Unified balance data is unavailable.',
    );
  });

  it('formats exact cents accessibly and masks both address families', () => {
    expect(formatUsdMinor('1100000')).toEqual({
      visible: '$11,000.00',
      accessible: '11,000 US dollars',
      decimal: '11000.00',
    });
    expect(formatUsdMinor('125')).toEqual({
      visible: '$1.25',
      accessible: '1 US dollar and 25 cents',
      decimal: '1.25',
    });
    expect(maskPortfolioAddress('0x71c7656ec7ab88b098defb751b7401b5f6d8976f', 'EVM')).toBe(
      '0x71c7…976f',
    );
    expect(maskPortfolioAddress('7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8', 'SOLANA')).toBe(
      '7Ytt…FrA8',
    );
    expect(addressEnding('7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8', 'SOLANA')).toBe('FrA8');
  });
});
