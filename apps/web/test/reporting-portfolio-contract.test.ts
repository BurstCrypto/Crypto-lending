import { describe, expect, it } from 'vitest';

import {
  parseReportingPortfolioResponse,
  ReportingPortfolioResponseError,
} from '../lib/portfolio/reporting-portfolio';
import {
  REPORTING_PORTFOLIO_RESPONSE,
  REPORTING_PORTFOLIO_SNAPSHOT,
} from './fixtures/reporting-portfolio';

function cloneResponse(): Record<string, unknown> {
  return structuredClone(REPORTING_PORTFOLIO_RESPONSE) as unknown as Record<string, unknown>;
}

describe('production reporting portfolio contract', () => {
  it('validates and reconciles the API contract into a privacy-minimized projection', () => {
    expect(REPORTING_PORTFOLIO_SNAPSHOT.overallTotal.usdValue?.decimal).toBe(
      '11000.000000000000000000',
    );
    expect(REPORTING_PORTFOLIO_SNAPSHOT.chainTotals).toHaveLength(1);
    expect(REPORTING_PORTFOLIO_SNAPSHOT.assetTotals).toHaveLength(1);
    expect(REPORTING_PORTFOLIO_SNAPSHOT.balanceCoverage).toEqual({
      status: 'COMPLETE',
      targetCount: 2,
      completeTargetCount: 2,
      partialTargetCount: 0,
      unavailableTargetCount: 0,
    });

    const retained = JSON.stringify(REPORTING_PORTFOLIO_SNAPSHOT);
    expect(retained).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(retained).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(retained).not.toContain('private-reference');
    expect(retained).not.toContain(REPORTING_PORTFOLIO_RESPONSE.sources[0].asset.identity);
  });

  it('fails closed on extra fields, aggregate drift, and financial-use flags', () => {
    expect(() =>
      parseReportingPortfolioResponse({ ...REPORTING_PORTFOLIO_RESPONSE, unexpected: true }),
    ).toThrow(ReportingPortfolioResponseError);

    const aggregateDrift = cloneResponse();
    aggregateDrift.overallTotal = {
      ...(aggregateDrift.overallTotal as Record<string, unknown>),
      includedSourceCount: 1,
    };
    expect(() => parseReportingPortfolioResponse(aggregateDrift)).toThrow(
      ReportingPortfolioResponseError,
    );

    expect(() =>
      parseReportingPortfolioResponse({
        ...REPORTING_PORTFOLIO_RESPONSE,
        mayAuthorizeFinancialUse: true,
      }),
    ).toThrow(ReportingPortfolioResponseError);
  });

  it.each(['eip155:56', 'eip155:8453', 'eip155:42161', 'eip155:11155111'])(
    'rejects an out-of-scope %s source',
    (networkId) => {
      const outOfScope = cloneResponse();
      const sources = outOfScope.sources as Record<string, unknown>[];
      sources[0] = {
        ...sources[0],
        networkId,
        asset: {
          ...(sources[0]?.asset as Record<string, unknown>),
          networkId,
        },
      };
      expect(() => parseReportingPortfolioResponse(outOfScope)).toThrow(
        ReportingPortfolioResponseError,
      );
    },
  );

  it('retains missing-only Ethereum and Solana coverage as unavailable instead of zero', () => {
    const missing = cloneResponse();
    const ethereumWalletId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const solanaWalletId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    missing.balanceCoverage = {
      status: 'UNAVAILABLE',
      targets: [
        { walletId: ethereumWalletId, networkId: 'eip155:1', status: 'UNAVAILABLE' },
        {
          walletId: solanaWalletId,
          networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          status: 'UNAVAILABLE',
        },
      ],
    };
    missing.oldestBalanceObservedAt = null;
    missing.sources = [];
    missing.excludedSources = [];
    missing.overallTotal = {
      usdValue: null,
      freshnessClass: 'UNAVAILABLE',
      completeness: 'UNAVAILABLE',
      sourceCount: 0,
      includedSourceCount: 0,
    };
    missing.walletTotals = [
      {
        walletId: ethereumWalletId,
        ...(missing.overallTotal as Record<string, unknown>),
      },
      {
        walletId: solanaWalletId,
        ...(missing.overallTotal as Record<string, unknown>),
      },
    ];
    missing.chainTotals = [
      {
        networkId: 'eip155:1',
        ...(missing.overallTotal as Record<string, unknown>),
      },
      {
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        ...(missing.overallTotal as Record<string, unknown>),
      },
    ];
    missing.assetTotals = [];

    const parsed = parseReportingPortfolioResponse(missing);
    expect(parsed.overallTotal).toMatchObject({
      usdValue: null,
      freshnessClass: 'UNAVAILABLE',
      completeness: 'UNAVAILABLE',
    });
    expect(parsed.balanceCoverage).toEqual({
      status: 'UNAVAILABLE',
      targetCount: 2,
      completeTargetCount: 0,
      partialTargetCount: 0,
      unavailableTargetCount: 2,
    });
    expect(parsed.chainTotals).toEqual([
      expect.objectContaining({ networkId: 'eip155:1', usdValue: null }),
      expect.objectContaining({
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        usdValue: null,
      }),
    ]);
  });

  it('reconciles exact conservative totals when a Solana target is missing', () => {
    const partial = cloneResponse();
    partial.balanceCoverage = {
      status: 'PARTIAL',
      targets: [
        ...((partial.balanceCoverage as Record<string, unknown>).targets as unknown[]),
        {
          walletId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          status: 'UNAVAILABLE',
        },
      ],
    };
    const conservative = {
      usdValue: (partial.overallTotal as Record<string, unknown>).usdValue,
      freshnessClass: 'UNAVAILABLE',
      completeness: 'PARTIAL',
      sourceCount: 2,
      includedSourceCount: 2,
    };
    partial.overallTotal = conservative;
    partial.walletTotals = [
      ...(partial.walletTotals as unknown[]),
      {
        walletId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        usdValue: null,
        freshnessClass: 'UNAVAILABLE',
        completeness: 'UNAVAILABLE',
        sourceCount: 0,
        includedSourceCount: 0,
      },
    ];
    partial.chainTotals = [
      ...(partial.chainTotals as unknown[]),
      {
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        usdValue: null,
        freshnessClass: 'UNAVAILABLE',
        completeness: 'UNAVAILABLE',
        sourceCount: 0,
        includedSourceCount: 0,
      },
    ];
    partial.assetTotals = [
      {
        stablecoin: 'USDC',
        ...conservative,
      },
    ];

    const parsed = parseReportingPortfolioResponse(partial);
    expect(parsed.overallTotal).toMatchObject({
      freshnessClass: 'UNAVAILABLE',
      completeness: 'PARTIAL',
    });
    expect(parsed.balanceCoverage).toMatchObject({
      status: 'PARTIAL',
      targetCount: 3,
      completeTargetCount: 2,
      unavailableTargetCount: 1,
    });
    expect(parsed.chainTotals.at(-1)).toMatchObject({
      networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      usdValue: null,
    });

    const inflated = structuredClone(partial);
    (inflated.overallTotal as Record<string, unknown>).usdValue = {
      currency: 'USD',
      mantissa: '12000000000000000000000',
      scale: 18,
      decimal: '12000.000000000000000000',
    };
    expect(() => parseReportingPortfolioResponse(inflated)).toThrow(
      ReportingPortfolioResponseError,
    );
  });

  it('rejects coverage manifests that omit, duplicate, or misclassify a source target', () => {
    const omitted = cloneResponse();
    const omittedCoverage = omitted.balanceCoverage as Record<string, unknown>;
    omittedCoverage.targets = (omittedCoverage.targets as unknown[]).slice(0, 1);
    expect(() => parseReportingPortfolioResponse(omitted)).toThrow(ReportingPortfolioResponseError);

    const duplicate = cloneResponse();
    const duplicateCoverage = duplicate.balanceCoverage as Record<string, unknown>;
    const targets = duplicateCoverage.targets as unknown[];
    duplicateCoverage.targets = [...targets, structuredClone(targets[0])];
    expect(() => parseReportingPortfolioResponse(duplicate)).toThrow(
      ReportingPortfolioResponseError,
    );

    const unavailableWithObservation = cloneResponse();
    const unavailableCoverage = unavailableWithObservation.balanceCoverage as Record<
      string,
      unknown
    >;
    unavailableCoverage.status = 'PARTIAL';
    const unavailableTargets = unavailableCoverage.targets as Record<string, unknown>[];
    unavailableTargets[0] = { ...unavailableTargets[0], status: 'UNAVAILABLE' };
    expect(() => parseReportingPortfolioResponse(unavailableWithObservation)).toThrow(
      ReportingPortfolioResponseError,
    );
  });

  it('rejects an unregistered Ethereum stablecoin identity', () => {
    const unknownIdentity = cloneResponse();
    const unknownSources = unknownIdentity.sources as Record<string, unknown>[];
    unknownSources[0] = {
      ...unknownSources[0],
      asset: {
        ...(unknownSources[0]?.asset as Record<string, unknown>),
        identity: 'not-a-registered-stablecoin',
      },
    };
    expect(() => parseReportingPortfolioResponse(unknownIdentity)).toThrow(
      ReportingPortfolioResponseError,
    );
  });

  it('pins Ethereum USDC decimals to the approved registry value', () => {
    const wrongDecimals = cloneResponse();
    const source = (wrongDecimals.sources as Record<string, unknown>[])[0]!;
    source.asset = { ...(source.asset as Record<string, unknown>), decimals: 18 };
    source.balance = {
      ...(source.balance as Record<string, unknown>),
      decimals: 18,
      decimal: '0.000000007500000000',
    };

    expect(() => parseReportingPortfolioResponse(wrongDecimals)).toThrow(
      ReportingPortfolioResponseError,
    );
  });

  it('pins the exact Mainnet-v1 asset registry fingerprint', () => {
    const wrongRegistry = cloneResponse();
    const source = (wrongRegistry.sources as Record<string, unknown>[])[0]!;
    source.asset = {
      ...(source.asset as Record<string, unknown>),
      registryFingerprintSha256: 'a'.repeat(64),
    };

    expect(() => parseReportingPortfolioResponse(wrongRegistry)).toThrow(
      ReportingPortfolioResponseError,
    );
  });

  it('rejects observations captured after their declared balance snapshot', () => {
    const timeTravelingObservation = cloneResponse();
    timeTravelingObservation.balanceSnapshot = {
      ...(timeTravelingObservation.balanceSnapshot as Record<string, unknown>),
      capturedAt: '2026-08-24T17:59:49.000Z',
    };

    expect(() => parseReportingPortfolioResponse(timeTravelingObservation)).toThrow(
      ReportingPortfolioResponseError,
    );
  });

  it('rejects current source totals inside a stale balance snapshot', () => {
    const inconsistentFreshness = cloneResponse();
    inconsistentFreshness.balanceSnapshot = {
      ...(inconsistentFreshness.balanceSnapshot as Record<string, unknown>),
      freshnessClass: 'STALE',
    };
    inconsistentFreshness.overallTotal = {
      ...(inconsistentFreshness.overallTotal as Record<string, unknown>),
      freshnessClass: 'STALE',
    };

    expect(() => parseReportingPortfolioResponse(inconsistentFreshness)).toThrow(
      ReportingPortfolioResponseError,
    );
  });
});
