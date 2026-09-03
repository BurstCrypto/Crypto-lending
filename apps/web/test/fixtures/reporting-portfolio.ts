import { parseReportingPortfolioResponse } from '../../lib/portfolio/reporting-portfolio';
import {
  PORTFOLIO_ASSET_IDENTITIES,
  type StablecoinSymbol,
} from '../../lib/portfolio/unified-balance';

const AS_OF = '2026-08-24T18:00:00.000Z';
const REGISTRY_FINGERPRINT = '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d';
const WALLET_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WALLET_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fixedDecimal(mantissa: string, scale: number): string {
  const padded = mantissa.padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function usd(mantissa: string) {
  return {
    currency: 'USD',
    mantissa,
    scale: 18,
    decimal: fixedDecimal(mantissa, 18),
  } as const;
}

function aggregate(mantissa: string, sourceCount: number) {
  return {
    usdValue: usd(mantissa),
    freshnessClass: 'CURRENT',
    completeness: 'COMPLETE',
    sourceCount,
    includedSourceCount: sourceCount,
  } as const;
}

function source(input: {
  readonly observationId: string;
  readonly walletId: string;
  readonly networkId: 'eip155:1';
  readonly stablecoin: StablecoinSymbol;
  readonly identity: string;
  readonly atomic: string;
  readonly usdMantissa: string;
  readonly observedAt: string;
}) {
  return {
    observationId: input.observationId,
    walletId: input.walletId,
    networkId: input.networkId,
    asset: {
      registryEnvironment: 'MAINNET',
      registryVersion: 1,
      registryFingerprintSha256: REGISTRY_FINGERPRINT,
      stablecoin: input.stablecoin,
      networkId: input.networkId,
      identity: input.identity,
      decimals: 6,
    },
    balance: {
      atomic: input.atomic,
      decimals: 6,
      decimal: fixedDecimal(input.atomic, 6),
    },
    balanceObservedAt: input.observedAt,
    balanceFreshnessClass: 'CURRENT',
    freshnessClass: 'CURRENT',
    includedInOverallTotal: true,
    usdValue: usd(input.usdMantissa),
    valuation: {
      priceSnapshotId: `price-${input.observationId}`,
      policyVersion: 1,
      policyApprovalState: 'PENDING_EXTERNAL_APPROVAL',
      availability: 'AVAILABLE',
      selection: 'PRIMARY',
      selectedSourceId: 'PYTH_CORE',
      selectedSourceReference: `private-reference-${input.observationId}`,
      selectedSourceSequence: '1',
      pricedAt: '2026-08-24T17:59:45.000Z',
      observedAt: '2026-08-24T17:59:45.000Z',
      usdRateMantissa: '100000000',
      usdRateScale: 8,
      freshnessClass: 'CURRENT',
      confidenceClass: 'MEDIUM',
      depegClass: 'WITHIN_POLICY',
      downsideBand: 'NORMAL',
      sourceAgreement: 'SINGLE_SOURCE',
      reasons: ['SINGLE_SOURCE'],
      reportingUse: 'CONSERVATIVE_REPORTING_ONLY',
      mayIncreaseBuyingPower: false,
      mayAuthorizeFinancialUse: false,
    },
  } as const;
}

export const REPORTING_PORTFOLIO_RESPONSE = {
  schemaVersion: 1,
  asOf: AS_OF,
  balanceSnapshot: {
    snapshotId: 'idx5-snapshot-11000',
    capturedAt: '2026-08-24T17:59:59.000Z',
    freshnessClass: 'CURRENT',
  },
  balanceCoverage: {
    status: 'COMPLETE',
    targets: [
      { walletId: WALLET_A, networkId: 'eip155:1', status: 'COMPLETE' },
      { walletId: WALLET_B, networkId: 'eip155:1', status: 'COMPLETE' },
    ],
  },
  oldestBalanceObservedAt: '2026-08-24T17:59:50.000Z',
  overallTotal: aggregate('11000000000000000000000', 2),
  walletTotals: [
    { walletId: WALLET_A, ...aggregate('7500000000000000000000', 1) },
    { walletId: WALLET_B, ...aggregate('3500000000000000000000', 1) },
  ],
  chainTotals: [{ networkId: 'eip155:1', ...aggregate('11000000000000000000000', 2) }],
  assetTotals: [{ stablecoin: 'USDC', ...aggregate('11000000000000000000000', 2) }],
  sources: [
    source({
      observationId: '11111111-1111-4111-8111-111111111111',
      walletId: WALLET_A,
      networkId: 'eip155:1',
      stablecoin: 'USDC',
      identity: PORTFOLIO_ASSET_IDENTITIES['eip155:1'].USDC,
      atomic: '7500000000',
      usdMantissa: '7500000000000000000000',
      observedAt: '2026-08-24T17:59:50.000Z',
    }),
    source({
      observationId: '22222222-2222-4222-8222-222222222222',
      walletId: WALLET_B,
      networkId: 'eip155:1',
      stablecoin: 'USDC',
      identity: PORTFOLIO_ASSET_IDENTITIES['eip155:1'].USDC,
      atomic: '3500000000',
      usdMantissa: '3500000000000000000000',
      observedAt: '2026-08-24T17:59:54.000Z',
    }),
  ],
  excludedSources: [],
  reportingUse: 'CONSERVATIVE_REPORTING_ONLY',
  mayIncreaseBuyingPower: false,
  mayAuthorizeFinancialUse: false,
} as const;

export const REPORTING_PORTFOLIO_SNAPSHOT = parseReportingPortfolioResponse(
  REPORTING_PORTFOLIO_RESPONSE,
);
