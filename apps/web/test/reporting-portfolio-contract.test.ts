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

  it.each([
    'eip155:1',
    'eip155:42161',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    'eip155:11155111',
  ])('rejects an out-of-scope %s source', (networkId) => {
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
  });

  it('rejects an unregistered Base stablecoin identity', () => {
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

  it('pins Base USDC decimals to the approved registry value', () => {
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
